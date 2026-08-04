/* ============================================================
   Bazaar — the app. Hash-routed, no framework: four views over a thin
   API, with every mutating action going through Wallet.send.
   ============================================================ */
'use strict';

const $ = (s) => document.querySelector(s);
const view = $('#view');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const KOIN = (sats) => {
  const n = Number(BigInt(sats || '0')) / 1e8;
  return n >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 2 })
    : n.toLocaleString('en-US', { maximumFractionDigits: 8 });
};
const short = (a) => a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—';

function toast(msg, cls = '', ms = 4000) {
  const el = document.createElement('div');
  el.className = 'toast ' + cls;
  el.innerHTML = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), ms);
}

async function api(path) {
  const r = await fetch('/api' + path);
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Request failed');
  return data;
}

/* ---------------- modal ---------------- */

function modal(html) {
  $('#modal').innerHTML = html;
  $('#modal-back').classList.remove('hidden');
  return $('#modal');
}
function closeModal() { $('#modal-back').classList.add('hidden'); }
$('#modal-back').addEventListener('mousedown', (e) => { if (e.target === $('#modal-back')) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

/* ---------------- connect ---------------- */

function connectModal() {
  const m = modal(`
    <h3>Connect</h3>
    <p class="sub">Kondor if you hold your own keys — or the same Google /
    email sign-in as Aurvania, which opens the <b>same wallet</b> you have
    in the game. Mana fees are on us either way.</p>
    <div class="stack">
      <button class="btn big" id="w-kondor">🦅 Kondor wallet</button>
      <button class="btn big" id="w-google">Sign in with Google</button>
      <div class="alt">— or email —</div>
      <input id="w-email" type="email" placeholder="email" autocomplete="email">
      <input id="w-pass" type="password" placeholder="password" autocomplete="current-password">
      <button class="btn primary big" id="w-login">Log in</button>
      <div class="alt">New here? <button class="linkish" id="w-register">Create an account</button></div>
    </div>
  `);
  m.querySelector('#w-kondor').onclick = async () => {
    try { await Wallet.connectKondor(); closeModal(); toast('Kondor connected', 'good'); }
    catch (e) { toast(esc(e.message), 'bad'); }
  };
  m.querySelector('#w-google').onclick = () => {
    const cid = Wallet.cfg.googleClientId;
    if (!cid || !window.google?.accounts?.id) return toast('Google sign-in is not available right now', 'bad');
    window.google.accounts.id.initialize({
      client_id: cid,
      callback: async (resp) => {
        try { await Wallet.hostedLogin({ action: 'google', idToken: resp.credential }); closeModal(); toast('Signed in — same wallet as Aurvania', 'good'); }
        catch (e) { toast(esc(e.message), 'bad'); }
      },
    });
    window.google.accounts.id.prompt();
  };
  const emailAction = (action) => async () => {
    const email = m.querySelector('#w-email').value.trim();
    const password = m.querySelector('#w-pass').value;
    if (!email || !password) return toast('Email and password required', 'bad');
    try {
      await Wallet.hostedLogin({ action, email, password });
      closeModal(); toast(action === 'register' ? 'Account created' : 'Signed in', 'good');
    } catch (e) { toast(esc(e.message), 'bad'); }
  };
  m.querySelector('#w-login').onclick = emailAction('login');
  m.querySelector('#w-register').onclick = emailAction('register');
}

function walletModal() {
  const a = Wallet.account;
  const m = modal(`
    <h3>Your wallet</h3>
    <div class="wallet-row">
      <div>
        <div class="mono" style="font-size:13px;word-break:break-all">${esc(a.address)}</div>
        <div class="sub" style="margin:4px 0 0">${a.kind === 'kondor' ? 'Kondor' : 'Aurvania account (hosted key)'} · <span id="wm-bal"><span class="spin"></span></span></div>
      </div>
    </div>
    <div class="stack">
      <button class="btn" id="wm-copy">Copy address</button>
      <a class="btn" style="text-align:center" href="${Wallet.cfg.explorer}/address/${esc(a.address)}" target="_blank" rel="noopener">View on koinosblocks</a>
      <button class="btn danger" id="wm-out">Disconnect</button>
    </div>
  `);
  api('/balance?address=' + a.address).then((b) => {
    const el = m.querySelector('#wm-bal');
    if (el) el.textContent = `${KOIN(b.koin)} KOIN`;
  }).catch(() => {});
  m.querySelector('#wm-copy').onclick = async () => {
    try { await navigator.clipboard.writeText(a.address); toast('Address copied', 'good'); } catch (_) {}
  };
  m.querySelector('#wm-out').onclick = () => { Wallet.disconnect(); closeModal(); };
}

/* ---------------- shared renderers ---------------- */

const tokCard = (colAddr, t) => `
  <a class="tok-card" href="#/t/${colAddr}/${encodeURIComponent(t.tokenId)}">
    <div class="tok-art">${t.image ? `<img src="${esc(t.image)}" alt="" loading="lazy">` : '<div class="ph">🖼️</div>'}</div>
    <div class="tok-body">
      <span class="tok-name">${esc(t.name || t.label)}</span>
      ${t.order ? `<span class="price">${KOIN(t.order.price)} <small>KOIN</small></span>` : ''}
    </div>
  </a>`;

/* ---------------- views ---------------- */

async function homeView() {
  view.innerHTML = '<div class="loading"><span class="spin"></span> Loading collections…</div>';
  const { collections } = await api('/collections');
  const listed = collections.reduce((s, c) => s + (c.listed || 0), 0);
  view.innerHTML = `
    <section class="hero">
      <h1>Every Koinos collection.<br>One <em>bazaar</em>.</h1>
      <p>Buy and sell NFTs in KOIN with zero mana fees — the marketplace pays
      them for you. 2.5% platform fee, collection royalties honored, and your
      Aurvania account works here out of the box.</p>
      <div class="hero-stats">
        <div class="hstat"><b>${collections.length}</b><span>collections</span></div>
        <div class="hstat"><b>${listed}</b><span>live listings</span></div>
        <div class="hstat"><b>2.5%</b><span>platform fee</span></div>
      </div>
    </section>
    <div class="section-head">Collections</div>
    <div class="grid">
      ${collections.map((c) => `
        <a class="col-card" href="#/c/${c.address}">
          <div class="col-art">${c.image ? `<img src="${esc(c.image)}" alt="" loading="lazy">` : '<div class="ph">◆</div>'}</div>
          <div class="col-body">
            <div class="col-name">${esc(c.name || c.address)}</div>
            <div class="col-desc">${esc(c.description || '')}</div>
            <div class="col-meta">
              <div><b>${c.floor != null ? KOIN(c.floor) : '—'}</b><span>floor</span></div>
              <div><b>${c.listed || 0}</b><span>listed</span></div>
              <div><b>${Number(c.totalSupply || 0).toLocaleString('en-US')}</b><span>items</span></div>
            </div>
          </div>
        </a>`).join('')}
    </div>
    ${collections.length ? '' : '<div class="empty">No collections registered yet.</div>'}`;
}

async function collectionView(addr) {
  view.innerHTML = '<div class="loading"><span class="spin"></span> Loading collection…</div>';
  const data = await api('/collections/' + addr);
  const info = data.info || {};
  const tab = (name, label) => `<button class="tab" data-tab="${name}">${label}</button>`;
  view.innerHTML = `
    <div class="c-head">
      <div class="c-title">
        <h2>${esc(info.name || addr)} ${info.symbol ? `<span class="dim-chip chip">${esc(info.symbol)}</span>` : ''}</h2>
        <a class="mono" href="${Wallet.cfg.explorer}/address/${addr}" target="_blank" rel="noopener">${addr}</a>
        <p>${esc((data.meta && data.meta.description) || info.description || '')}</p>
      </div>
      <div class="c-stats">
        <div class="hstat"><b>${data.orders.length}</b><span>listed</span></div>
        <div class="hstat"><b>${Number(info.totalSupply || 0).toLocaleString('en-US')}</b><span>items</span></div>
        <div class="hstat"><b>${((info.royaltyBps || 0) / 100).toFixed(1)}%</b><span>royalty</span></div>
      </div>
    </div>
    <div class="tabs">${tab('listings', 'Listings')}${tab('browse', 'Browse')}${tab('mine', 'My items')}</div>
    <div id="c-body"></div>`;

  const body = $('#c-body');
  const tabs = [...view.querySelectorAll('.tab')];
  const activate = async (name) => {
    tabs.forEach((t) => t.classList.toggle('on', t.dataset.tab === name));
    if (name === 'listings') {
      if (!data.orders.length) { body.innerHTML = '<div class="empty">Nothing listed right now.</div>'; return; }
      body.innerHTML = '<div class="loading"><span class="spin"></span></div>';
      // The orders carry ids; the art comes per token.
      const cards = await Promise.all(data.orders.map(async (o) => {
        try {
          const t = await api(`/collections/${addr}/token/${encodeURIComponent(o.tokenId)}`);
          return tokCard(addr, { tokenId: o.tokenId, label: o.label, name: t.meta?.name, image: t.meta?.image, order: o });
        } catch (_) { return tokCard(addr, { tokenId: o.tokenId, label: o.label, order: o }); }
      }));
      body.innerHTML = `<div class="grid">${cards.join('')}</div>`;
    } else if (name === 'browse') {
      body.innerHTML = '<div class="loading"><span class="spin"></span></div>';
      let start = '';
      const page = async () => {
        const q = await api(`/collections/${addr}/tokens?limit=24${start ? '&start=' + encodeURIComponent(start) : ''}`);
        const grid = body.querySelector('.grid') || (() => { body.innerHTML = '<div class="grid"></div>'; return body.querySelector('.grid'); })();
        grid.insertAdjacentHTML('beforeend', q.tokens.map((t) => tokCard(addr, t)).join(''));
        body.querySelector('.load-more')?.remove();
        if (q.nextStart) {
          start = q.nextStart;
          body.insertAdjacentHTML('beforeend', '<button class="btn load-more">Load more</button>');
          body.querySelector('.load-more').onclick = page;
        } else if (!grid.children.length) {
          body.innerHTML = '<div class="empty">This collection has not minted anything yet — or does not support browsing.</div>';
        }
      };
      await page();
    } else if (name === 'mine') {
      if (!Wallet.account) { body.innerHTML = '<div class="empty">Connect a wallet to see your items.</div>'; return; }
      body.innerHTML = '<div class="loading"><span class="spin"></span></div>';
      const mine = await api('/owned?address=' + Wallet.account.address);
      const col = mine.collections.find((c) => c.collection.address === addr);
      body.innerHTML = col && col.tokens.length
        ? `<div class="grid">${col.tokens.map((t) => tokCard(addr, t)).join('')}</div>`
        : '<div class="empty">You own nothing from this collection yet.</div>';
    }
  };
  tabs.forEach((t) => (t.onclick = () => activate(t.dataset.tab)));
  activate(data.orders.length ? 'listings' : 'browse');
}

async function tokenView(addr, tokenId) {
  view.innerHTML = '<div class="loading"><span class="spin"></span> Loading item…</div>';
  const t = await api(`/collections/${addr}/token/${encodeURIComponent(tokenId)}`);
  const me = Wallet.account && Wallet.account.address;
  const isOwner = me && t.owner === me;
  const order = t.order && !t.order.dead ? t.order : null;
  const feeBps = Wallet.cfg.feeBps || 250;
  const royBps = t.collection.royaltyBps || 0;

  const dealHtml = () => {
    if (order && !isOwner) {
      const sellerGets = (BigInt(order.price) * BigInt(10000 - feeBps - royBps)) / 10000n;
      return `
        <div class="big-price">${KOIN(order.price)} <small style="font-size:16px">KOIN</small></div>
        <div class="fee-note">seller receives ${KOIN(sellerGets.toString())} · ${(feeBps / 100).toFixed(1)}% platform fee${royBps ? ` · ${(royBps / 100).toFixed(1)}% creator royalty` : ''} · mana on us</div>
        <div class="row"><button class="btn primary big" id="t-buy">Buy now</button></div>`;
    }
    if (order && isOwner) {
      return `
        <div class="big-price">${KOIN(order.price)} <small style="font-size:16px">KOIN</small></div>
        <div class="fee-note">your listing</div>
        <div class="row"><button class="btn danger big" id="t-cancel">Cancel listing</button></div>`;
    }
    if (isOwner) {
      return `
        <label for="t-price">List for sale — price in KOIN</label>
        <input id="t-price" type="number" min="0" step="0.00000001" placeholder="e.g. 25">
        <div class="fee-note" style="margin-top:6px">You receive the price minus ${(feeBps / 100).toFixed(1)}% platform fee${royBps ? ` and ${(royBps / 100).toFixed(1)}% creator royalty` : ''}. The NFT stays in your wallet until it sells.</div>
        <div class="row"><button class="btn primary big" id="t-list">List it</button></div>`;
    }
    return `<div class="fee-note">Not listed for sale.${t.owner ? '' : ' This token may not exist yet.'}</div>`;
  };

  view.innerHTML = `
    <div class="t-wrap">
      <div class="t-art">${t.meta?.image ? `<img src="${esc(t.meta.image)}" alt="">` : '<div class="ph">🖼️</div>'}</div>
      <div class="t-info">
        <a class="crumb" href="#/c/${addr}">← ${esc(t.collection.name || addr)}</a>
        <h2>${esc(t.meta?.name || t.label)}</h2>
        ${t.meta?.description ? `<p style="color:var(--dim);margin-top:6px">${esc(t.meta.description)}</p>` : ''}
        <div class="kv">Owner <a class="mono" href="${Wallet.cfg.explorer}/address/${esc(t.owner || '')}" target="_blank" rel="noopener">${esc(short(t.owner))}</a>
          · Token <span class="mono">${esc(t.label)}</span></div>
        <div class="deal" id="t-deal">${dealHtml()}</div>
        ${t.meta?.attributes?.length ? `<div class="attrs">${t.meta.attributes.map((a) => `
          <div class="attr"><span>${esc(a.trait_type || a.name || '')}</span><b>${esc(String(a.value ?? ''))}</b></div>`).join('')}</div>` : ''}
      </div>
    </div>`;

  /* An action, then patient polling: the receipt comes back fast but the
     read layer only sees the new state once the block lands and the cache
     rolls. The poll watches for the STATE CHANGE, not the receipt. */
  const busy = (btn, label) => { btn.disabled = true; btn.innerHTML = `<span class="spin"></span> ${label}`; };
  async function follow(test, done) {
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const fresh = await api(`/collections/${addr}/token/${encodeURIComponent(tokenId)}`);
        if (test(fresh)) { toast(done, 'good', 6000); return tokenView(addr, tokenId); }
      } catch (_) {}
    }
    toast('Still settling — refresh in a moment.', '', 6000);
  }

  const buyBtn = $('#t-buy');
  if (buyBtn) buyBtn.onclick = async () => {
    if (!Wallet.account) return connectModal();
    busy(buyBtn, 'Buying…');
    try {
      await Wallet.buyToken(addr, tokenId, order.price);
      toast('Purchase sent — waiting for the block…');
      follow((f) => f.owner === Wallet.account.address, '🎉 It is yours — the NFT is in your wallet.');
    } catch (e) { toast(esc(e.message), 'bad', 7000); tokenView(addr, tokenId); }
  };

  const listBtn = $('#t-list');
  if (listBtn) listBtn.onclick = async () => {
    const koin = parseFloat($('#t-price').value);
    if (!(koin > 0)) return toast('Set a price first', 'bad');
    const sats = BigInt(Math.round(koin * 1e8)).toString();
    busy(listBtn, 'Listing…');
    try {
      await Wallet.listToken(addr, tokenId, sats, { approved: t.approved });
      toast('Listing sent — waiting for the block…');
      follow((f) => f.order && !f.order.dead, 'Listed. It stays in your wallet until it sells.');
    } catch (e) { toast(esc(e.message), 'bad', 7000); tokenView(addr, tokenId); }
  };

  const cancelBtn = $('#t-cancel');
  if (cancelBtn) cancelBtn.onclick = async () => {
    busy(cancelBtn, 'Cancelling…');
    try {
      await Wallet.cancelOrder(addr, tokenId);
      toast('Cancel sent — waiting for the block…');
      follow((f) => !f.order || f.order.dead, 'Listing cancelled.');
    } catch (e) { toast(esc(e.message), 'bad', 7000); tokenView(addr, tokenId); }
  };
}

async function meView() {
  if (!Wallet.account) { connectModal(); view.innerHTML = '<div class="empty">Connect a wallet to see your items.</div>'; return; }
  view.innerHTML = '<div class="loading"><span class="spin"></span> Reading your wallet…</div>';
  const me = Wallet.account.address;
  const [mine, bal] = await Promise.all([api('/owned?address=' + me), api('/balance?address=' + me)]);
  view.innerHTML = `
    <section class="hero" style="padding-bottom:6px">
      <h1 style="font-size:24px">Your items</h1>
      <p class="mono" style="word-break:break-all">${esc(me)}</p>
      <div class="hero-stats"><div class="hstat"><b>${KOIN(bal.koin)}</b><span>KOIN</span></div></div>
    </section>
    ${mine.collections.length ? mine.collections.map((c) => `
      <div class="section-head">${esc(c.collection.name || c.collection.address)}</div>
      <div class="grid">${c.tokens.map((t) => tokCard(c.collection.address, t)).join('')}</div>`).join('')
      : '<div class="empty">Nothing yet — everything you buy lands here, and Aurvania relics you mint show up too.</div>'}`;
}

/* ---------------- router / boot ---------------- */

async function route() {
  const h = location.hash || '#/';
  try {
    let m;
    if ((m = /^#\/c\/([1-9A-HJ-NP-Za-km-z]+)$/.exec(h))) return await collectionView(m[1]);
    if ((m = /^#\/t\/([1-9A-HJ-NP-Za-km-z]+)\/([^/]+)$/.exec(h))) return await tokenView(m[1], decodeURIComponent(m[2]));
    if (h === '#/me') return await meView();
    return await homeView();
  } catch (e) {
    view.innerHTML = `<div class="empty">${esc(e.message || 'Something went wrong')}</div>`;
  }
}

function paintHeader() {
  const a = Wallet.account;
  $('#btn-connect').textContent = a ? short(a.address) : 'Connect';
  $('#btn-me').classList.toggle('hidden', !a);
}

(async () => {
  const cfg = await Wallet.init();
  $('#net-chip').textContent = cfg.networkLabel || cfg.network;
  $('#foot-market').textContent = cfg.market ? `market ${cfg.market}` : 'contract not deployed yet';
  paintHeader();
  Wallet.onChange(() => { paintHeader(); route(); });
  $('#btn-connect').onclick = () => (Wallet.account ? walletModal() : connectModal());
  $('#btn-me').onclick = () => { location.hash = '#/me'; };
  window.addEventListener('hashchange', route);
  route();
})();
