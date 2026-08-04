#!/usr/bin/env node
/* The marketplace server: API surface, registry rules, and above all the
   SPONSOR — the endpoint that spends the dev wallet's mana on strangers'
   transactions. Every rule that protects that wallet is exercised with a
   crafted transaction that breaks exactly one of them.

   The payer here is a THROWAWAY key with zero KOIN, so even the
   transaction that passes every check cannot land on chain: the mempool
   refuses it for having no mana. "passed validation, died at broadcast"
   is therefore the SUCCESS signal for the happy path.  */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Signer, Provider, Contract, Transaction } = require('koilib');

const os = require('os');
const SCRATCH = process.env.TEST_TMP || os.tmpdir();
const ROOT = path.join(__dirname, '..');
const PORT = 3981;
let fails = 0;
const check = (label, ok, detail) => {
  console.log(`  ${ok ? '✅' : '❌'} ${label}${ok ? '' : ' — ' + String(detail).slice(0, 200)}`);
  if (!ok) fails++;
};

const newSigner = () => new Signer({ privateKey: crypto.randomBytes(32).toString('hex') });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let srv;
process.on('exit', () => { try { srv && srv.kill(); } catch (_) {} });

(async () => {
  const dev = newSigner();                       // zero-mana payer
  const MARKET = newSigner().getAddress();       // pretend contract address
  const RELICS = '1E8hw3NiDPz9gcZ8BiWoTHzFz4H48dpFKq';
  const dataDir = path.join(SCRATCH, 'mk-check-' + process.pid);
  fs.rmSync(dataDir, { recursive: true, force: true });

  srv = spawn('node', ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATA_DIR: dataDir,
      KOINOS_NETWORK: 'mainnet',
      MARKET_ADDR: MARKET,
      KOINOS_DEV_WIF: dev.getPrivateKey('wif', true),
      ADMIN_KEY: 'test-admin-key',
    }),
    stdio: process.env.KC_TEST_STDIO ? 'inherit' : ['ignore', 'ignore', 'ignore'],
  });
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/api/config`); if (r.ok) break; } catch (_) {}
    await sleep(250);
  }

  const api = async (p, opts) => {
    const r = await fetch(`http://127.0.0.1:${PORT}${p}`, opts);
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };

  /* ---- surface ---- */
  const cfg = (await api('/api/config')).body;
  check('config names the sponsor payer', cfg.sponsor === true && cfg.sponsorPayer === dev.getAddress(), JSON.stringify(cfg).slice(0, 120));
  check('config carries the Google client id from Aurvania', !!cfg.googleClientId, 'missing');

  const home = await fetch(`http://127.0.0.1:${PORT}/`);
  const html = await home.text();
  check('the site is served', home.status === 200 && html.includes('OURO'), String(home.status));
  const spa = await fetch(`http://127.0.0.1:${PORT}/c/whatever`);
  check('extensionless routes fall back to the app', (await spa.text()).includes('OURO'), String(spa.status));

  /* ---- registry rules ---- */
  let r = await api('/api/collections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'wrong', address: RELICS }) });
  check('registry writes need the admin key', r.status === 403, JSON.stringify(r.body));
  r = await api('/api/collections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'test-admin-key', address: 'not-an-address' }) });
  check('…and a real address', r.status === 400, JSON.stringify(r.body));
  r = await api('/api/collections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'test-admin-key', address: RELICS }) });
  check('…and a duplicate is refused', r.status === 400 && /Already/.test(r.body.error || ''), JSON.stringify(r.body));

  /* ---- the auth bridge only forwards the stateless actions ---- */
  r = await api('/api/account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'link', email: 'x@x.com' }) });
  check('the auth bridge refuses non-login actions', r.status === 400, JSON.stringify(r.body));

  /* ---- sponsor gates, one broken rule per case ---- */
  const user = newSigner();
  const provider = new Provider(['https://api.koinos.io']);
  const marketAbi = JSON.parse(fs.readFileSync(path.join(ROOT, 'server-abi', 'market-abi.json'), 'utf8'));
  const nftAbi = JSON.parse(fs.readFileSync(path.join(ROOT, 'server-abi', 'nft-abi.json'), 'utf8'));
  for (const abi of [marketAbi, nftAbi]) {
    const k = abi.koilib_types?.nested?.koinos?.nested;
    if (k) { delete k.btype; delete k._btype; }
  }
  const marketC = new Contract({ id: MARKET, abi: marketAbi, provider });
  const relicsC = new Contract({ id: RELICS, abi: nftAbi, provider });
  const koinC = new Contract({ id: '19GYjDBVXU7keLbYvMLazsGQn3GTWHjHkK', abi: nftAbi, provider });

  const goodOp = await marketC.encodeOperation({
    name: 'create_order',
    args: { collection: RELICS, token_id: '0x01', price: '100000000', expires: '0' },
  });
  const approveOp = await relicsC.encodeOperation({
    name: 'approve',
    args: { approver_address: user.getAddress(), to: MARKET, token_id: '0x01' },
  });
  // The op the wallet must never pay for: a call to a foreign contract.
  const evilOp = await koinC.encodeOperation({
    name: 'transfer',
    args: { from: user.getAddress(), to: dev.getAddress(), token_id: '0x01' },
  });

  async function craft({ ops, payer = dev.getAddress(), payee = user.getAddress(), rcLimit = '200000000', sign = true }) {
    const tx = new Transaction({ signer: user, provider, options: { payer, payee, rcLimit } });
    for (const op of ops) await tx.pushOperation(op);
    // Nonce/chain-id come from mainnet for realism; the tx never lands.
    await tx.prepare();
    if (sign) await tx.sign();
    return tx.transaction;
  }
  const sponsor = async (transaction) => api('/api/sponsor', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transaction }),
  });

  r = await sponsor(await craft({ ops: [goodOp], payer: user.getAddress() }));
  check('a transaction not paid by the dev wallet is refused', r.status === 400 && /payer/.test(r.body.error), JSON.stringify(r.body));

  {
    const tx = new Transaction({ signer: user, provider, options: { payer: dev.getAddress(), rcLimit: '200000000' } });
    await tx.pushOperation(goodOp); await tx.prepare(); await tx.sign();
    r = await sponsor(tx.transaction);
    check('a transaction with no payee is refused', r.status === 400 && /payee/.test(r.body.error), JSON.stringify(r.body));
  }

  r = await sponsor(await craft({ ops: [goodOp], rcLimit: '99900000000' }));
  check('an rc limit above the ceiling is refused', r.status === 400 && /ceiling/.test(r.body.error), JSON.stringify(r.body));

  r = await sponsor(await craft({ ops: [goodOp, evilOp] }));
  check('an op on a foreign contract is refused even next to a good one', r.status === 400 && /not something/.test(r.body.error), JSON.stringify(r.body));

  r = await sponsor(await craft({ ops: [evilOp] }));
  check('a KOIN-contract call is never sponsored', r.status === 400, JSON.stringify(r.body));

  r = await sponsor(await craft({ ops: [goodOp], sign: false }));
  check('an unsigned payee is refused', r.status === 400 && /not signed/.test(r.body.error), JSON.stringify(r.body));

  {
    // Signed by SOMEBODY — just not the payee it names.
    const other = newSigner();
    const tx = new Transaction({ signer: other, provider, options: { payer: dev.getAddress(), payee: user.getAddress(), rcLimit: '200000000' } });
    await tx.pushOperation(goodOp); await tx.prepare(); await tx.sign();
    r = await sponsor(tx.transaction);
    check('a signature from the wrong account is refused', r.status === 400 && /not signed/.test(r.body.error), JSON.stringify(r.body));
  }

  /* The happy path: market op + approval on a REGISTERED collection,
     payee signed, payer dev. Validation passes; the zero-mana payer then
     dies at the mempool — which is exactly the proof we want offline. */
  r = await sponsor(await craft({ ops: [approveOp, goodOp] }));
  const passed = r.status === 200 || (r.status === 400 && /rc|resource|mana|reverted|failed|account/i.test(r.body.error || ''));
  check('a well-formed listing passes validation (dies only at the mempool, having no mana)',
    passed && !/payer|payee|ceiling|not something|not signed/.test(r.body.error || ''), JSON.stringify(r.body));

  /* ---- rate limit ---- */
  let limited = false;
  for (let i = 0; i < 35; i++) {
    const rr = await sponsor(await craft({ ops: [goodOp] }));
    if (rr.status === 429) { limited = true; break; }
  }
  check('a payee hammering the sponsor gets rate limited', limited, 'never hit 429');

  console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
