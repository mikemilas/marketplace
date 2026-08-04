/* ============================================================
   Wallet — who you are, and how a transaction leaves the building.

   Two kinds of account, one interface:

     * KONDOR — the browser-extension wallet Kollection users know. We
       ask it for an address and a koilib-compatible signer; keys never
       leave the extension.

     * HOSTED — the Aurvania account. Google or email sign-in is bridged
       to the game's server, which answers with the SAME wallet the same
       login gets in the game (one identity, one address, both sites).
       The key lives in this browser's localStorage, exactly like in the
       game; the server never keeps a session.

   Every transaction goes out MANA-SPONSORED: built with payer = the
   marketplace's dev wallet and payee = you, signed here by you, then
   co-signed and broadcast by the server. You need ZERO KOIN mana to
   trade — the platform pays. If sponsorship is ever down and you are on
   Kondor, we fall back to a plain self-paid transaction.
   ============================================================ */
'use strict';

const Wallet = (() => {
  const LS_WIF = 'mk_wif';
  const LS_KIND = 'mk_kind';

  let cfg = null;              // /api/config, fetched once at boot
  let account = null;          // { kind: 'kondor'|'hosted', address, signer }
  let provider = null;
  const listeners = [];

  async function init() {
    cfg = await (await fetch('/api/config')).json();
    provider = new Provider(cfg.rpcs || [cfg.rpc]);
    // Wake a remembered account.
    const kind = localStorage.getItem(LS_KIND);
    if (kind === 'hosted' && localStorage.getItem(LS_WIF)) {
      try { adoptWif(localStorage.getItem(LS_WIF)); } catch (_) { localStorage.removeItem(LS_WIF); }
    } else if (kind === 'kondor' && window.kondor) {
      // Kondor reconnects only on demand — a page load must never pop the
      // extension. The header shows "Connect" until the user asks.
    }
    return cfg;
  }

  function emit() { for (const fn of listeners) { try { fn(account); } catch (_) {} } }
  function onChange(fn) { listeners.push(fn); }

  function adoptWif(wif) {
    const signer = Signer.fromWif(wif);
    signer.provider = provider;
    account = { kind: 'hosted', address: signer.getAddress(), signer };
    localStorage.setItem(LS_WIF, wif);
    localStorage.setItem(LS_KIND, 'hosted');
    emit();
    return account;
  }

  async function connectKondor() {
    if (!window.kondor) throw new Error('Kondor is not installed — get it from the Chrome or Brave store');
    const accounts = await window.kondor.getAccounts();
    if (!accounts || !accounts.length) throw new Error('Kondor returned no accounts');
    const address = accounts[0].address;
    const signer = window.kondor.getSigner(address);
    account = { kind: 'kondor', address, signer };
    localStorage.setItem(LS_KIND, 'kondor');
    localStorage.removeItem(LS_WIF);
    emit();
    return account;
  }

  /** Google or email — the Aurvania bridge. Returns the same wallet the
      same login owns in the game. */
  async function hostedLogin(body) {
    const r = await fetch('/api/account', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok || !data.wif) throw new Error(data.error || 'Sign-in failed');
    return adoptWif(data.wif);
  }

  function disconnect() {
    account = null;
    localStorage.removeItem(LS_WIF);
    localStorage.removeItem(LS_KIND);
    emit();
  }

  /* ---------------- transactions ---------------- */

  let abis = null;
  async function loadAbis() {
    if (abis) return abis;
    const [market, nft] = await Promise.all([
      (await fetch('/abi/market-abi.json')).json(),
      (await fetch('/abi/nft-abi.json')).json(),
    ]);
    // koilib's protobufjs rejects the btype extension declaration.
    for (const abi of [market, nft]) {
      const k = abi.koilib_types && abi.koilib_types.nested.koinos && abi.koilib_types.nested.koinos.nested;
      if (k) { delete k.btype; delete k._btype; }
    }
    abis = { market, nft };
    return abis;
  }

  async function encodeOp(contractId, abi, name, args) {
    const c = new Contract({ id: contractId, abi, provider });
    return c.encodeOperation({ name, args });
  }

  /** Build, sign and submit a transaction of marketplace operations.
      Sponsored by default; self-paid through Kondor as the fallback. */
  async function send(ops, { rcLimit = '200000000' } = {}) {
    if (!account) throw new Error('Connect a wallet first');

    if (cfg.sponsor && cfg.sponsorPayer) {
      const tx = new Transaction({
        signer: account.signer,
        provider,
        options: { payer: cfg.sponsorPayer, payee: account.address, rcLimit },
      });
      for (const op of ops) await tx.pushOperation(op);
      await tx.prepare();
      await tx.sign();
      const r = await fetch('/api/sponsor', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction: tx.transaction }),
      });
      const data = await r.json();
      if (r.ok && data.ok) return { id: data.id, sponsored: true };
      // A sponsorship outage must not strand Kondor users, who can pay
      // their own mana. Hosted accounts have no mana, so for them the
      // sponsor error is the real answer.
      if (account.kind !== 'kondor') throw new Error(data.error || 'The sponsor declined this transaction');
    }

    const tx = new Transaction({
      signer: account.signer, provider, options: { rcLimit },
    });
    for (const op of ops) await tx.pushOperation(op);
    await tx.prepare();
    await tx.sign();
    await tx.send();
    return { id: tx.transaction.id, sponsored: false };
  }

  /* ---- the four marketplace actions ---- */

  async function listToken(collection, tokenId, priceSats, { approved = false } = {}) {
    const { market, nft } = await loadAbis();
    const ops = [];
    if (!approved) {
      ops.push(await encodeOp(collection, nft, 'approve', {
        approver_address: account.address, to: cfg.market, token_id: tokenId,
      }));
    }
    ops.push(await encodeOp(cfg.market, market, 'create_order', {
      collection, token_id: tokenId, price: String(priceSats), expires: '0',
    }));
    return send(ops);
  }

  async function buyToken(collection, tokenId, priceSats) {
    const { market } = await loadAbis();
    const op = await encodeOp(cfg.market, market, 'execute_order', {
      collection, token_id: tokenId, buyer: account.address, max_price: String(priceSats),
    });
    return send([op]);
  }

  async function cancelOrder(collection, tokenId) {
    const { market } = await loadAbis();
    const op = await encodeOp(cfg.market, market, 'cancel_order', {
      collection, token_id: tokenId,
    });
    return send([op]);
  }

  return {
    init, onChange, connectKondor, hostedLogin, disconnect, adoptWif,
    listToken, buyToken, cancelOrder,
    get account() { return account; },
    get cfg() { return cfg; },
    get provider() { return provider; },
  };
})();
