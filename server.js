#!/usr/bin/env node
/* ============================================================
   The marketplace server — every KCS-2 collection on Koinos.

   Deliberately thin. The order book lives ON CHAIN (the contract's
   get_orders is a plain paginated read), ownership lives on chain, and
   accounts are keys the user holds in their browser — so this server
   keeps no user state at all. What it actually does:

     * serves the site;
     * keeps the COLLECTION REGISTRY — the one curated thing here: which
       collections appear on the home page (anything else is reachable by
       address, listed or not);
     * caches chain reads so browsing does not hammer the RPC;
     * proxies metadata fetches (never an open proxy — only URLs derived
       from a collection's own on-chain uri are fetched);
     * bridges SIGN-IN to the Aurvania game server, so the same Google or
       email account resolves to the SAME Koinos wallet there and here;
     * SPONSORS MANA: users sign as payee, this server co-signs as payer
       with the dev wallet, so nobody needs KOIN mana to trade. The
       validation below is what keeps that wallet from being drained.

   Env:
     PORT               (default 3100)
     DATA_DIR           runtime state dir (default ./data-live)
     KOINOS_NETWORK     mainnet | harbinger   (default mainnet)
     KOINOS_RPC         override RPC url(s), comma separated
     MARKET_ADDR        the deployed marketplace contract address
     KOINOS_DEV_WIF     the mana payer (sponsorship off without it)
     SPONSOR_RC_PER_OP  mana ceiling per operation in satoshis (default 3 KOIN)
     SPONSOR_RC_MAX     absolute per-tx mana ceiling (default 15 KOIN)
     INDEX_MAX_TOKENS   how deep a collection is indexed for filters (default 1500)
     AURVANIA_API       game server for shared sign-in (default aurvania.quest)
     ADMIN_KEY          enables POST /api/collections (registry writes)
   ============================================================ */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Signer, Provider, Contract, Transaction, Serializer, utils } = require('koilib');

/* A background chain walk, a stray rejection, a bad response shape — none
   of it should ever take the site down. A logged error serves everyone
   better than a process that exits and leaves the host answering 503. */
process.on('unhandledRejection', (e) => {
  console.error('[unhandled rejection]', (e && e.stack) || e);
});
process.on('uncaughtException', (e) => {
  console.error('[uncaught exception]', (e && e.stack) || e);
});

const NETWORKS = {
  harbinger: {
    label: 'Koinos Harbinger testnet',
    rpcs: ['https://harbinger-api.koinos.io'],
    koinContract: '1FaSvLjQJsCJKq5ybmGsMMQs8RQYyVv8ju',
    explorer: 'https://harbinger.koinosblocks.com',
  },
  mainnet: {
    label: 'Koinos',
    rpcs: ['https://api.koinos.io'],
    koinContract: '19GYjDBVXU7keLbYvMLazsGQn3GTWHjHkK',
    explorer: 'https://koinosblocks.com',
  },
};

/* Env numbers, parsed so a typo cannot kill the process. BigInt('5e8')
   throws, and a throw out here happens at module load — before anything
   is listening and before any log line, which from outside is an
   unexplained 503. A bad value falls back and says so. */
function bigEnv(name, fallback) {
  const raw = (process.env[name] || '').trim();
  if (!raw) return BigInt(Math.round(fallback));
  try {
    const n = /^[0-9]+$/.test(raw) ? BigInt(raw) : BigInt(Math.round(Number(raw)));
    if (n > 0n) return n;
    throw new Error('must be positive');
  } catch (_) {
    console.error(`[config] ${name}="${raw}" is not a whole number of satoshis — using ${fallback}`);
    return BigInt(Math.round(fallback));
  }
}

const CFG = {
  PORT: parseInt(process.env.PORT || '3100', 10),
  DATA_DIR: path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data-live')),
  NETWORK: (process.env.KOINOS_NETWORK || 'mainnet').trim(),
  MARKET_ADDR: (process.env.MARKET_ADDR || '').trim(),
  DEV_WIF: (process.env.KOINOS_DEV_WIF || '').trim(),
  /* Mana ceilings. A Koinos contract call really costs ~0.4–1.3 KOIN of
     mana, so a ceiling is per-OPERATION with a hard absolute cap; a flat
     5 KOIN cap rejected nothing but did let the old 2-op listing squeak
     under a limit too small to actually execute. rc_limit is a ceiling,
     not a charge — only rc_used leaves the payer. */
  SPONSOR_RC_PER_OP: bigEnv('SPONSOR_RC_PER_OP', 3e8),
  SPONSOR_RC_MAX: bigEnv('SPONSOR_RC_MAX', 15e8),
  AURVANIA_API: (process.env.AURVANIA_API || 'https://aurvania.quest').replace(/\/$/, ''),
  ADMIN_KEY: (process.env.ADMIN_KEY || '').trim(),
};
const NET = NETWORKS[CFG.NETWORK] || NETWORKS.mainnet;
const RPCS = (process.env.KOINOS_RPC || '').split(',').map(s => s.trim()).filter(Boolean);
if (!RPCS.length) RPCS.push(...NET.rpcs);

fs.mkdirSync(CFG.DATA_DIR, { recursive: true });

/* ---------------- tiny persistent store ---------------- */

function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}
function saveJson(file, data) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

/* The registry: seeded from the repo's data/collections.json on first
   boot, then owned by DATA_DIR. The seed ships with Aurvania; everything
   else arrives through the admin endpoint. */
const REGISTRY_FILE = path.join(CFG.DATA_DIR, 'collections.json');
let registry = loadJson(REGISTRY_FILE, null);
if (!registry) {
  registry = loadJson(path.join(__dirname, 'data', 'collections.json'), { collections: [] });
  saveJson(REGISTRY_FILE, registry);
}

/* ---------------- chain ---------------- */

const provider = new Provider(RPCS);
const dev = CFG.DEV_WIF ? Signer.fromWif(CFG.DEV_WIF) : null;
if (dev) dev.provider = provider;

function sanitizeAbi(abi) {
  const k = abi.koilib_types?.nested?.koinos?.nested;
  if (k) { delete k.btype; delete k._btype; }
  return abi;
}
const NFT_ABI = sanitizeAbi(loadJson(path.join(__dirname, 'server-abi', 'nft-abi.json'), {}));
const MARKET_ABI = sanitizeAbi(loadJson(path.join(__dirname, 'server-abi', 'market-abi.json'), {}));

const marketC = CFG.MARKET_ADDR
  ? new Contract({ id: CFG.MARKET_ADDR, provider, abi: MARKET_ABI })
  : null;

const nftContracts = new Map();
function nftC(addr) {
  if (!nftContracts.has(addr)) {
    nftContracts.set(addr, new Contract({ id: addr, provider, abi: NFT_ABI }));
  }
  return nftContracts.get(addr);
}

/* ---------------- caches ---------------- */

const caches = new Map();
async function cached(key, ttlMs, fn) {
  const hit = caches.get(key);
  const t = Date.now();
  if (hit && t - hit.at < ttlMs) return hit.value;
  const value = await fn();
  caches.set(key, { at: t, value });
  if (caches.size > 5000) {
    // drop the oldest half rather than tracking LRU precisely
    const entries = [...caches.entries()].sort((a, b) => a[1].at - b[1].at);
    for (let i = 0; i < entries.length / 2; i++) caches.delete(entries[i][0]);
  }
  return value;
}

const isAddr = (s) => typeof s === 'string' && /^1[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(s);

/** Token ids travel as 0x-hex. Shown to people as utf8 when printable. */
const hexToLabel = (hex) => {
  try {
    const b = Buffer.from(String(hex).replace(/^0x/, ''), 'hex');
    const s = b.toString('utf8');
    return /^[\x20-\x7e]+$/.test(s) ? s : hex;
  } catch (_) { return hex; }
};

/* ---------------- collection reads ---------------- */

async function collectionInfo(addr) {
  return cached('info:' + addr, 300000, async () => {
    const c = nftC(addr);
    const out = { address: addr };
    try {
      const { result } = await c.functions.get_info({});
      if (result) { out.name = result.name; out.symbol = result.symbol; out.uri = result.uri; out.description = result.description; }
    } catch (_) {
      // KCS-2 without get_info: fall back to the individual getters.
      try { out.name = (await c.functions.name({})).result?.value; } catch (_) {}
      try { out.symbol = (await c.functions.symbol({})).result?.value; } catch (_) {}
      try { out.uri = (await c.functions.uri({})).result?.value; } catch (_) {}
    }
    try { out.totalSupply = (await c.functions.total_supply({})).result?.value || '0'; } catch (_) {}
    try {
      const { result } = await c.functions.royalties({});
      out.royaltyBps = (result?.value || []).reduce((s, r) => s + Number(r.percentage || 0), 0);
    } catch (_) { out.royaltyBps = 0; }
    return out;
  });
}

async function collectionOrders(addr) {
  if (!marketC) return [];
  return cached('orders:' + addr, 10000, async () => {
    const rows = [];
    let startAfter = '';
    for (let page = 0; page < 20; page++) {
      const args = { collection: addr, limit: 100 };
      if (startAfter) args.start_after = startAfter;
      const { result } = await marketC.functions.get_orders(args);
      const batch = result?.value || [];
      rows.push(...batch);
      if (batch.length < 100) break;
      startAfter = batch[batch.length - 1].token_id;
    }
    const now = Date.now();
    return rows
      .filter(o => !Number(o.expires) || Number(o.expires) > now)
      .map(o => ({
        seller: o.seller, collection: o.collection, tokenId: o.token_id,
        label: hexToLabel(o.token_id),
        price: o.price, expires: o.expires || '0', created: o.created || '0',
      }));
  });
}

/** On-chain metadata first, uri fetch second — never an open proxy. */
async function tokenMeta(addr, tokenIdHex) {
  return cached(`meta:${addr}:${tokenIdHex}`, 3600000, async () => {
    const c = nftC(addr);
    try {
      const { result } = await c.functions.metadata_of({ token_id: tokenIdHex });
      if (result?.value) { try { return JSON.parse(result.value); } catch (_) {} }
    } catch (_) {}
    const info = await collectionInfo(addr);
    let base = String(info.uri || '').trim();
    if (!base) return null;
    if (base.startsWith('ipfs://')) base = 'https://ipfs.io/ipfs/' + base.slice(7);
    if (!/^https?:\/\//.test(base)) return null;
    const label = hexToLabel(tokenIdHex);
    const url = base.replace(/\/$/, '') + '/' + encodeURIComponent(label);
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(8000), size: 1048576 });
      if (!r.ok) return null;
      const text = (await r.text()).slice(0, 262144);
      return JSON.parse(text);
    } catch (_) { return null; }
  });
}

const rewriteImg = (u) => {
  if (typeof u !== 'string') return null;
  if (u.startsWith('ipfs://')) return 'https://ipfs.io/ipfs/' + u.slice(7);
  /* Aurvania relics minted before the domain move carry the RETIRED domain
     in their on-chain metadata — immutable history. Rewriting here keeps
     the art loading directly (no redirect hop) and keeps working on the
     day koinoscrusaders.com finally lapses. */
  u = u.replace(/^https?:\/\/(www\.)?koinoscrusaders\.com\//, 'https://aurvania.quest/');
  return /^https:\/\//.test(u) ? u : null;
};

/* ---------------- the collection index ----------------

   Filtering has to see the WHOLE collection: a sidebar built from the 24
   tokens that happen to be on screen would give wrong counts and hide
   matches further down. So each collection gets walked once — ids from
   get_tokens, traits from each token's metadata — and the result is held
   for a while. Metadata reads are individually cached too, so refreshes
   are cheap after the first walk.

   Big collections are capped rather than allowed to stall a request; the
   response says so instead of quietly pretending the index is complete. */

const INDEX_MAX_TOKENS = parseInt(process.env.INDEX_MAX_TOKENS || '1500', 10);
const INDEX_TTL_MS = 600000;
const META_CONCURRENCY = 8;

async function mapPool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try { out[i] = await fn(items[i], i); } catch (_) { out[i] = null; }
    }
  }));
  return out;
}

/** Traits, flattened to strings so they can be compared and counted.
    Numbers stay printable ("Level 3"), everything else is trimmed. */
function traitsOf(meta) {
  const t = {};
  for (const a of (meta && Array.isArray(meta.attributes) ? meta.attributes : [])) {
    const key = String(a.trait_type ?? a.name ?? '').trim();
    if (!key) continue;
    const val = a.value;
    if (val === null || val === undefined || val === '') continue;
    t[key] = String(val).trim().slice(0, 60);
  }
  return t;
}

async function collectionIndex(addr) {
  return cached('index:' + addr, INDEX_TTL_MS, async () => {
    const c = nftC(addr);
    const ids = [];
    let start = '';
    let partial = false;
    for (let page = 0; page < 200; page++) {
      const args = { limit: 100, descending: false };
      if (start) args.start = start;
      let batch = [];
      try { batch = (await c.functions.get_tokens(args)).result?.token_ids || []; }
      catch (_) { break; }
      ids.push(...batch);
      if (batch.length < 100) break;
      start = batch[batch.length - 1];
      if (ids.length >= INDEX_MAX_TOKENS) { partial = true; break; }
    }
    const capped = ids.slice(0, INDEX_MAX_TOKENS);

    const tokens = (await mapPool(capped, META_CONCURRENCY, async (tid) => {
      const meta = await tokenMeta(addr, tid).catch(() => null);
      return {
        tokenId: tid, label: hexToLabel(tid),
        name: meta?.name || hexToLabel(tid),
        image: rewriteImg(meta?.image),
        traits: traitsOf(meta),
      };
    })).filter(Boolean);

    // Facets, ordered by how often the trait appears then alphabetically,
    // so the sidebar leads with the traits that actually divide the set.
    const byTrait = new Map();
    for (const t of tokens) {
      for (const [k, v] of Object.entries(t.traits)) {
        if (!byTrait.has(k)) byTrait.set(k, new Map());
        const vals = byTrait.get(k);
        vals.set(v, (vals.get(v) || 0) + 1);
      }
    }
    const facets = [...byTrait.entries()]
      .map(([trait, vals]) => ({
        trait,
        total: [...vals.values()].reduce((a, b) => a + b, 0),
        values: [...vals.entries()]
          .map(([value, count]) => ({ value, count }))
          .sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value), undefined, { numeric: true })),
      }))
      .filter(f => f.values.length > 1 || f.total < tokens.length)
      .sort((a, b) => b.values.length - a.values.length || a.trait.localeCompare(b.trait));

    return { tokens, facets, total: tokens.length, partial: partial || ids.length > capped.length };
  });
}

/* ---------------- trade history ----------------

   Every listing, cancellation and sale is already recorded: the contract
   emits an event for each, and Koinos indexes a contract's own events
   under its address. So history is READ FROM THE CHAIN rather than kept
   here — a trade done straight against the contract, bypassing this site
   entirely, still shows up.

   The walk is incremental. Records arrive newest-first with a sequence
   number, so once a sequence has been seen it is never fetched again, and
   what has been decoded is written to DATA_DIR to survive a restart.
   Block timestamps cost two extra reads per transaction, so they are
   resolved once and stored with the event. */

const HISTORY_FILE = path.join(CFG.DATA_DIR, 'history.json');
const EVENT_TYPES = {
  'market.create_order': 'market.create_order_event',
  'market.execute_order': 'market.execute_order_event',
  'market.cancel_order': 'market.cancel_order_event',
};
const EVENT_KIND = {
  'market.create_order': 'listed',
  'market.execute_order': 'sold',
  'market.cancel_order': 'cancelled',
};
/* No defaultTypeName: koilib's Serializer lets a default SILENTLY win over
   the type passed per call, which would decode every event as whichever
   type was named first.

   Built defensively because this runs at MODULE LOAD: a throw here would
   kill the process before it ever listened, taking the whole site down for
   the sake of the history panel. Losing history is the right failure. */
let marketSerializer = null;
try {
  if (MARKET_ABI.koilib_types) marketSerializer = new Serializer(MARKET_ABI.koilib_types);
} catch (e) {
  console.error('[history] event decoding unavailable —', String((e && e.message) || e));
}

let history = loadJson(HISTORY_FILE, null) || { events: [], lastSeq: -1 };
/* How many account-history records the last walk actually read. Without
   it, "no trades yet" and "the walk never reached the chain" look
   identical from the outside — including to the tests. */
let historyScanned = 0;
let historyAt = 0;
let historyRun = null;

async function blockTimeOf(txId) {
  return cached('txtime:' + txId, 86400000, async () => {
    try {
      const t = await provider.call('transaction_store.get_transactions_by_id', { transaction_ids: [txId] });
      const blockId = ((t.transactions || [])[0] || {}).containing_blocks?.[0];
      if (!blockId) return null;
      const b = await provider.call('block_store.get_blocks_by_id', {
        block_ids: [blockId], return_block: true, return_receipt: false,
      });
      const hdr = ((b.block_items || [])[0] || {}).block?.header || {};
      return hdr.timestamp ? Number(hdr.timestamp) : null;
    } catch (_) { return null; }
  });
}

async function refreshHistory({ force = false } = {}) {
  if (!marketC || !marketSerializer) return history;
  if (!force && Date.now() - historyAt < 20000) return history;
  if (historyRun) return historyRun;          // one walk at a time
  historyRun = (async () => {
    const seen = new Set(history.events.map(e => e.seq));
    const fresh = [];
    let seq = null;
    let scanned = 0;
    for (let page = 0; page < 20; page++) {
      const args = { address: CFG.MARKET_ADDR, limit: 100, ascending: false, irreversible: false };
      if (seq !== null) args.seq_num = seq;
      let res;
      try { res = await provider.call('account_history.get_account_history', args); }
      catch (_) { break; }
      const values = res.values || [];
      if (!values.length) break;
      scanned += values.length;
      let reachedKnown = false;
      for (const v of values) {
        const n = Number(v.seq_num);
        if (n <= history.lastSeq || seen.has(n)) { reachedKnown = true; continue; }
        const txId = v.trx?.transaction?.id || null;
        for (const ev of (v.trx?.receipt?.events || [])) {
          const type = EVENT_TYPES[ev.name];
          if (!type) continue;
          let data = null;
          try { data = await marketSerializer.deserialize(utils.decodeBase64url(ev.data), type); }
          catch (_) { continue; }
          fresh.push({
            seq: n, kind: EVENT_KIND[ev.name], tx: txId,
            at: await blockTimeOf(txId),
            collection: data.collection, tokenId: data.token_id,
            seller: data.seller || null, buyer: data.buyer || null,
            price: data.price || null,
            fee: data.protocol_fee || null, royalty: data.royalties_paid || null,
            expires: data.expires || null,
          });
        }
      }
      const oldest = Number(values[values.length - 1].seq_num);
      if (reachedKnown || oldest <= 0) break;
      seq = oldest - 1;
      if (seq < 0) break;
    }
    if (fresh.length) {
      history.events = [...fresh, ...history.events]
        .sort((a, b) => b.seq - a.seq)
        .slice(0, 20000);
      history.lastSeq = Math.max(history.lastSeq, ...fresh.map(e => e.seq));
      try { saveJson(HISTORY_FILE, history); } catch (_) {}
    }
    historyScanned = scanned;
    historyAt = Date.now();
    return history;
  })().finally(() => { historyRun = null; });
  return historyRun;
}

/* ---------------- mana sponsorship ---------------- */

/* The rules that keep the dev wallet safe while it pays for strangers:

     1. payer must be the dev address — we never co-sign someone else's bill;
     2. payee must be set, must not be dev, and MUST have signed — the
        chain also enforces the payee signature (the payee's nonce is
        consumed), this check just fails fast and keeps garbage off chain;
     3. every operation must target the marketplace, or be an approval on
        a REGISTERED collection (the op that precedes a listing) — the dev
        wallet does not fund arbitrary computation;
     4. the rc ceiling is capped, and each payee and IP is rate limited. */

const entryIds = (abi) => {
  const ids = {};
  for (const [name, m] of Object.entries(abi.methods || {})) {
    ids[name] = typeof m['entry-point'] === 'string' ? parseInt(m['entry-point'], 16) : m['entry-point'];
  }
  return ids;
};
const NFT_ENTRIES = entryIds(loadJson(path.join(__dirname, 'server-abi', 'nft-abi.json'), {}));
const APPROVAL_ENTRIES = new Set([NFT_ENTRIES.approve, NFT_ENTRIES.set_approval_for_all].filter(Boolean));

const sponsorHits = new Map();
function rateLimited(key, max, windowMs) {
  const t = Date.now();
  const arr = (sponsorHits.get(key) || []).filter(x => t - x < windowMs);
  arr.push(t);
  sponsorHits.set(key, arr);
  return arr.length > max;
}

async function sponsor(txJson, ip) {
  if (!dev) return { status: 503, body: { error: 'Sponsorship is not configured on this server' } };
  if (!marketC) return { status: 503, body: { error: 'Marketplace contract is not configured' } };
  const tx = txJson;
  const h = tx && tx.header;
  if (!h || !Array.isArray(tx.operations) || !tx.operations.length) {
    return { status: 400, body: { error: 'A prepared transaction is required' } };
  }
  const devAddr = dev.getAddress();
  if (h.payer !== devAddr) return { status: 400, body: { error: 'payer must be the marketplace mana wallet' } };
  if (!h.payee || h.payee === devAddr) return { status: 400, body: { error: 'payee must be the acting account' } };
  let rc;
  try { rc = BigInt(h.rc_limit); } catch (_) { return { status: 400, body: { error: 'bad rc_limit' } }; }
  /* Budget the ceiling against the work actually being authorized, so a
     bigger transaction gets the mana it needs without handing every
     transaction the maximum. */
  const opBudget = CFG.SPONSOR_RC_PER_OP * BigInt(tx.operations.length);
  const ceiling = opBudget < CFG.SPONSOR_RC_MAX ? opBudget : CFG.SPONSOR_RC_MAX;
  if (rc <= 0n || rc > ceiling) {
    return { status: 400, body: { error: 'rc_limit above the sponsorship ceiling' } };
  }

  const registered = new Set(registry.collections.map(c => c.address));
  for (const op of tx.operations) {
    const call = op.call_contract;
    if (!call) return { status: 400, body: { error: 'only contract calls are sponsored' } };
    const target = call.contract_id;
    const entry = Number(call.entry_point);
    const isMarket = target === CFG.MARKET_ADDR;
    const isApproval = registered.has(target) && APPROVAL_ENTRIES.has(entry);
    if (!isMarket && !isApproval) {
      return { status: 400, body: { error: 'that operation is not something this wallet pays for' } };
    }
  }

  if (rateLimited('payee:' + h.payee, 30, 3600000) || rateLimited('ip:' + ip, 90, 3600000)) {
    return { status: 429, body: { error: 'Too many sponsored transactions — slow down' } };
  }

  // The payee must already have signed what we are about to pay for.
  let signers = [];
  try { signers = await Signer.recoverAddresses(tx); } catch (_) {}
  if (!signers.includes(h.payee)) {
    return { status: 400, body: { error: 'the payee has not signed this transaction' } };
  }

  await dev.signTransaction(tx);
  try {
    const receipt = await provider.sendTransaction(tx);
    return { status: 200, body: { ok: true, id: tx.id, receipt: receipt && receipt.receipt } };
  } catch (e) {
    /* Keep the chain's own words in the log — that is where a rejection
       gets diagnosed — while the caller gets something a person can act on. */
    const raw = String(e && e.message || e);
    console.error('[sponsor] rejected', raw.slice(0, 300));
    return { status: 400, body: { error: raw.slice(0, 300) } };
  }
}

/* ---------------- http plumbing ---------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.json': 'application/json', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};
function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(data);
}
function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 262144) { req.destroy(); resolve({}); } });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (_) { resolve({}); } });
  });
}
function serveStatic(res, urlPath) {
  const clean = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  let file = path.join(__dirname, 'public', clean);
  if (!file.startsWith(path.join(__dirname, 'public'))) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    // hash-routed SPA: any extensionless miss is the app
    if (!path.extname(clean)) file = path.join(__dirname, 'public', 'index.html');
    else { res.writeHead(404); return res.end('not found'); }
  }
  const ext = path.extname(file);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
  });
  fs.createReadStream(file).pipe(res);
}

/* ---------------- api ---------------- */

let aurvaniaInfo = null;
async function gameInfo() {
  if (aurvaniaInfo) return aurvaniaInfo;
  try {
    const r = await fetch(CFG.AURVANIA_API + '/api/chain-info', { signal: AbortSignal.timeout(8000) });
    if (r.ok) aurvaniaInfo = await r.json();
  } catch (_) {}
  return aurvaniaInfo || {};
}

const api = {
  async config(req, res) {
    const gi = await gameInfo();
    let feeBps = 250, treasury = null;
    if (marketC) {
      try {
        const cfg = await cached('marketcfg', 300000, async () => (await marketC.functions.get_config({})).result);
        if (cfg) { feeBps = Number(cfg.fee_bps || 0); treasury = cfg.treasury || null; }
      } catch (_) {}
    }
    json(res, 200, {
      network: CFG.NETWORK, networkLabel: NET.label, rpc: RPCS[0], rpcs: RPCS,
      explorer: NET.explorer, koin: NET.koinContract,
      market: CFG.MARKET_ADDR || null, feeBps, treasury,
      sponsor: !!dev, sponsorPayer: dev ? dev.getAddress() : null,
      googleClientId: gi.googleClientId || null,
      aurvania: CFG.AURVANIA_API,
    });
  },

  async collections(req, res) {
    if (req.method === 'POST') {
      const body = await readBody(req);
      if (!CFG.ADMIN_KEY || body.key !== CFG.ADMIN_KEY) return json(res, 403, { error: 'Forbidden' });
      const addr = String(body.address || '').trim();
      if (!isAddr(addr)) return json(res, 400, { error: 'A Koinos address is required' });
      if (registry.collections.some(c => c.address === addr)) return json(res, 400, { error: 'Already registered' });
      const info = await collectionInfo(addr);
      if (!info.name && !info.symbol) return json(res, 400, { error: 'That address does not answer as a KCS-2 collection' });
      registry.collections.push({
        address: addr, name: String(body.name || info.name || addr),
        description: String(body.description || info.description || ''),
        image: String(body.image || ''), featured: !!body.featured, addedAt: Date.now(),
      });
      saveJson(REGISTRY_FILE, registry);
      return json(res, 200, { ok: true, collection: info });
    }
    const out = [];
    for (const c of registry.collections) {
      const info = await collectionInfo(c.address).catch(() => ({ address: c.address }));
      const orders = await collectionOrders(c.address).catch(() => []);
      const floor = orders.length ? orders.reduce((m, o) => BigInt(o.price) < m ? BigInt(o.price) : m, BigInt(orders[0].price)) : null;
      out.push({
        ...c, ...info,
        listed: orders.length,
        floor: floor === null ? null : floor.toString(),
      });
    }
    json(res, 200, { collections: out });
  },

  async collection(req, res, addr) {
    if (!isAddr(addr)) return json(res, 400, { error: 'bad address' });
    const reg = registry.collections.find(c => c.address === addr) || null;
    const info = await collectionInfo(addr);
    const orders = await collectionOrders(addr);
    json(res, 200, { registered: !!reg, meta: reg, info, orders });
  },

  /** The browse grid, filtered and sorted across the WHOLE collection.
      Filters arrive as repeated t=Trait:Value; several values of the SAME
      trait are an OR (rare or epic), different traits are an AND. */
  async tokens(req, res, addr, q) {
    if (!isAddr(addr)) return json(res, 400, { error: 'bad address' });
    const offset = Math.max(0, parseInt(q.get('offset') || '0', 10));
    const limit = Math.min(60, Math.max(1, parseInt(q.get('limit') || '24', 10)));
    const status = String(q.get('status') || 'all');
    const sort = String(q.get('sort') || 'default');
    const search = String(q.get('q') || '').trim().toLowerCase();

    const wanted = new Map();
    for (const raw of q.getAll('t')) {
      const i = String(raw).indexOf(':');
      if (i < 1) continue;
      const trait = raw.slice(0, i), value = raw.slice(i + 1);
      if (!wanted.has(trait)) wanted.set(trait, new Set());
      wanted.get(trait).add(value);
    }

    const idx = await collectionIndex(addr);
    const orders = await collectionOrders(addr).catch(() => []);
    const listed = new Map(orders.map(o => [o.tokenId, o]));

    /* "Mine" is just another filter, so it composes with the traits
       instead of being a separate view with its own half of the rules. */
    const owner = String(q.get('owner') || '');
    let ownedIds = null;
    if (isAddr(owner)) {
      try {
        const { result } = await cached(`owned:${addr}:${owner}`, 20000,
          async () => nftC(addr).functions.get_tokens_by_owner({ owner, limit: 500 }));
        ownedIds = new Set(result?.token_ids || []);
      } catch (_) { ownedIds = new Set(); }
    }

    let rows = idx.tokens.filter((t) => {
      for (const [trait, values] of wanted) {
        if (!values.has(t.traits[trait])) return false;
      }
      if (ownedIds && !ownedIds.has(t.tokenId)) return false;
      if (status === 'listed' && !listed.has(t.tokenId)) return false;
      if (status === 'unlisted' && listed.has(t.tokenId)) return false;
      if (search && !(`${t.name} ${t.label}`.toLowerCase().includes(search))) return false;
      return true;
    }).map(t => ({ ...t, order: listed.get(t.tokenId) || null }));

    const priceOf = (t) => (t.order ? BigInt(t.order.price) : null);
    if (sort === 'price_asc' || sort === 'price_desc') {
      rows.sort((a, b) => {
        const pa = priceOf(a), pb = priceOf(b);
        // Unlisted tokens have no price; they sort after everything priced.
        if (pa === null && pb === null) return 0;
        if (pa === null) return 1;
        if (pb === null) return -1;
        if (pa === pb) return 0;
        const cmp = pa < pb ? -1 : 1;
        return sort === 'price_asc' ? cmp : -cmp;
      });
    } else if (sort === 'name') {
      rows.sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true }));
    }

    json(res, 200, {
      tokens: rows.slice(offset, offset + limit).map(t => ({
        tokenId: t.tokenId, label: t.label, name: t.name, image: t.image, order: t.order,
      })),
      matched: rows.length,
      indexed: idx.total,
      partial: idx.partial,
      nextOffset: offset + limit < rows.length ? offset + limit : null,
    });
  },

  /** The sidebar: every trait in the collection with real counts. */
  async facets(req, res, addr) {
    if (!isAddr(addr)) return json(res, 400, { error: 'bad address' });
    const idx = await collectionIndex(addr);
    const orders = await collectionOrders(addr).catch(() => []);
    json(res, 200, {
      facets: idx.facets, indexed: idx.total, partial: idx.partial, listed: orders.length,
    });
  },

  /** What has happened to a token: listed, cancelled, sold — from chain
      events, so trades made outside this site are included. */
  async history(req, res, q) {
    const addr = String(q.get('collection') || '');
    const tokenId = String(q.get('token_id') || '');
    if (!isAddr(addr)) return json(res, 400, { error: 'bad address' });
    const h = await refreshHistory().catch(() => history);
    const rows = h.events
      .filter(e => e.collection === addr && (!tokenId || e.tokenId === tokenId))
      .sort((a, b) => (b.at || 0) - (a.at || 0) || b.seq - a.seq)
      .slice(0, 100);
    json(res, 200, { events: rows, scanned: historyScanned, known: h.events.length });
  },

  async token(req, res, addr, tokenId) {
    if (!isAddr(addr)) return json(res, 400, { error: 'bad address' });
    const c = nftC(addr);
    let owner = null;
    try { owner = (await c.functions.owner_of({ token_id: tokenId })).result?.value || null; } catch (_) {}
    const meta = await tokenMeta(addr, tokenId).catch(() => null);
    let order = null;
    if (marketC) {
      try {
        const { result } = await marketC.functions.get_order({ collection: addr, token_id: tokenId });
        if (result?.seller) order = {
          seller: result.seller, price: result.price,
          expires: result.expires || '0',
          dead: Number(result.expires) !== 0 && Number(result.expires) < Date.now(),
        };
      } catch (_) {}
    }
    let approved = false;
    if (CFG.MARKET_ADDR && owner) {
      try {
        const a1 = (await c.functions.get_approved({ token_id: tokenId })).result?.value;
        if (a1 === CFG.MARKET_ADDR) approved = true;
        if (!approved) {
          const a2 = (await c.functions.is_approved_for_all({ owner, operator: CFG.MARKET_ADDR })).result?.value;
          approved = !!a2;
        }
      } catch (_) {}
    }
    const info = await collectionInfo(addr);
    json(res, 200, {
      collection: info, tokenId, label: hexToLabel(tokenId), owner,
      meta: meta ? { name: meta.name, description: meta.description, image: rewriteImg(meta.image), attributes: meta.attributes || [] } : null,
      order, approved,
    });
  },

  async owned(req, res, q) {
    const addr = String(q.get('address') || '');
    if (!isAddr(addr)) return json(res, 400, { error: 'bad address' });
    const out = [];
    for (const c of registry.collections) {
      try {
        const { result } = await cached(`owned:${c.address}:${addr}`, 20000,
          async () => nftC(c.address).functions.get_tokens_by_owner({ owner: addr, limit: 100 }));
        const ids = result?.token_ids || [];
        if (!ids.length) continue;
        const orders = await collectionOrders(c.address).catch(() => []);
        const listed = new Map(orders.map(o => [o.tokenId, o]));
        const info = await collectionInfo(c.address);
        out.push({
          collection: { address: c.address, name: info.name || c.name },
          tokens: await Promise.all(ids.map(async (tid) => {
            const meta = await tokenMeta(c.address, tid).catch(() => null);
            return { tokenId: tid, label: hexToLabel(tid), name: meta?.name || hexToLabel(tid), image: rewriteImg(meta?.image), order: listed.get(tid) || null };
          })),
        });
      } catch (_) {}
    }
    json(res, 200, { collections: out });
  },

  /** The auth bridge: the SAME Google/email account resolves to the SAME
      Koinos wallet as in Aurvania, because Aurvania answers the question.
      Only the three stateless actions are bridged. */
  async account(req, res) {
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
    const body = await readBody(req);
    const action = String(body.action || '');
    if (!['register', 'login', 'google'].includes(action)) {
      return json(res, 400, { error: 'Unsupported action' });
    }
    try {
      const r = await fetch(CFG.AURVANIA_API + '/api/account', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
      });
      const data = await r.json();
      return json(res, r.status, data);
    } catch (_) {
      return json(res, 502, { error: 'Could not reach the account server — try again shortly' });
    }
  },

  async sponsor(req, res) {
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
    const body = await readBody(req);
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    const r = await sponsor(body.transaction, ip);
    json(res, r.status, r.body);
  },

  async balance(req, res, q) {
    const addr = String(q.get('address') || '');
    if (!isAddr(addr)) return json(res, 400, { error: 'bad address' });
    let koin = '0', mana = '0';
    try {
      const koinC = new Contract({ id: NET.koinContract, provider, abi: utils.tokenAbi });
      koin = (await koinC.functions.balanceOf({ owner: addr })).result?.value || '0';
    } catch (_) {}
    try { mana = String(await provider.getAccountRc(addr)); } catch (_) {}
    json(res, 200, { koin, mana });
  },
};

/* ---------------- server ---------------- */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  try {
    if (p === '/api/config') return await api.config(req, res);
    if (p === '/api/collections') return await api.collections(req, res);
    let m;
    if ((m = /^\/api\/collections\/([1-9A-HJ-NP-Za-km-z]+)$/.exec(p))) return await api.collection(req, res, m[1]);
    if ((m = /^\/api\/collections\/([1-9A-HJ-NP-Za-km-z]+)\/tokens$/.exec(p))) return await api.tokens(req, res, m[1], url.searchParams);
    if ((m = /^\/api\/collections\/([1-9A-HJ-NP-Za-km-z]+)\/facets$/.exec(p))) return await api.facets(req, res, m[1]);
    if ((m = /^\/api\/collections\/([1-9A-HJ-NP-Za-km-z]+)\/token\/([0-9a-fx]+)$/i.exec(p))) return await api.token(req, res, m[1], m[2]);
    if (p === '/api/owned') return await api.owned(req, res, url.searchParams);
    if (p === '/api/account') return await api.account(req, res);
    if (p === '/api/sponsor') return await api.sponsor(req, res);
    if (p === '/api/balance') return await api.balance(req, res, url.searchParams);
    if (p === '/api/history') return await api.history(req, res, url.searchParams);
    if (p.startsWith('/api/')) return json(res, 404, { error: 'no such endpoint' });
    return serveStatic(res, p === '/' ? '/index.html' : p);
  } catch (e) {
    console.error('[api]', p, String(e && e.message || e).slice(0, 200));
    if (!res.headersSent) json(res, 500, { error: 'Internal error' });
  }
});

/* Say WHY rather than dying silently — a port already held by the previous
   process is the classic restart failure, and it looks identical to a
   crash from the outside. */
server.on('error', (e) => {
  console.error(`[listen] cannot bind port ${CFG.PORT}:`, String((e && e.message) || e));
  if (e && e.code === 'EADDRINUSE') {
    console.error('        something is already serving that port — stop the old process first');
  }
  process.exit(1);
});

server.listen(CFG.PORT, () => {
  console.log(`⭕ OURO marketplace listening on http://0.0.0.0:${CFG.PORT}`);
  console.log(`   chain:   ${NET.label} · ${RPCS.join(', ')}`);
  console.log(`   market:  ${CFG.MARKET_ADDR || 'NOT SET — deploy the contract and set MARKET_ADDR'}`);
  console.log(`   sponsor: ${dev ? `on — payer ${dev.getAddress()}` : 'OFF (KOINOS_DEV_WIF not set)'}`);
  console.log(`   sign-in: bridged to ${CFG.AURVANIA_API}`);
  console.log(`   registry: ${registry.collections.length} collection(s) · admin ${CFG.ADMIN_KEY ? 'enabled' : 'OFF'}`);
  console.log(`   history: ${history.events.length} known event(s)`);
  // Warm the trade history so the first visitor does not pay for the walk.
  refreshHistory({ force: true })
    .then((h) => { if (h.events.length) console.log(`   history: indexed to ${h.events.length} event(s)`); })
    .catch(() => {});
});
