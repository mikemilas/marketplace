/* ============================================================
   OURO — the app. Hash-routed, no framework: four views over a thin
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
      <div class="g-wrap" id="w-google-wrap">
        <button class="btn big g-face" type="button" tabindex="-1" aria-hidden="true">
          <svg class="g-mark" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"/>
            <path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"/>
            <path fill="#FBBC05" d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"/>
            <path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"/>
          </svg>
          <span>Sign in with Google</span>
        </button>
        <div class="g-overlay" id="w-google-slot" aria-label="Sign in with Google"></div>
      </div>
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

  /* Google, as its own RENDERED button rather than One Tap. The first version
     called google.accounts.id.prompt(), and One Tap is silently suppressed all
     the time — third-party cookie settings, a previously dismissed prompt
     (hours of backoff), private windows — which reads as a button that simply
     does nothing. Only Google's iframe may open the popup and it cannot be
     styled, so it is stretched invisibly over a button of ours (the pattern
     the game already ships). */
  const wrap = m.querySelector('#w-google-wrap');
  const slot = m.querySelector('#w-google-slot');
  const cid = Wallet.cfg.googleClientId;
  const googleDead = (why) => {
    if (!wrap.isConnected) return;
    wrap.classList.add('g-dead');
    wrap.onclick = () => toast(why, 'bad', 6000);
  };
  const renderGoogle = () => {
    window.google.accounts.id.initialize({
      client_id: cid,
      ux_mode: 'popup',
      callback: async (resp) => {
        try { await Wallet.hostedLogin({ action: 'google', idToken: resp.credential }); closeModal(); toast('Signed in — same wallet as Aurvania', 'good'); }
        catch (e) { toast(esc(e.message), 'bad'); }
      },
    });
    /* Match our face exactly so the invisible hit area covers all of it. */
    const w = Math.max(200, Math.min(400, Math.round(wrap.getBoundingClientRect().width) || 320));
    window.google.accounts.id.renderButton(slot, {
      theme: 'filled_black', size: 'large', text: 'signin_with',
      shape: 'rectangular', width: w,
    });
  };
  if (!cid) {
    googleDead('Google sign-in is not configured — use email');
  } else {
    /* The GSI script is async: the modal can open before it lands. Our button
       is on screen either way, so wait for Google rather than declaring it
       broken on the first look. */
    let waited = 0;
    (function awaitGsi() {
      if (!wrap.isConnected) return;
      if (window.google?.accounts?.id) {
        try { renderGoogle(); }
        catch (e) { console.warn('Google button failed to render', e); googleDead('Google sign-in could not start — use email'); }
        return;
      }
      if ((waited += 150) > 8000) return googleDead('The Google sign-in script could not load — check for blockers, or use email');
      setTimeout(awaitGsi, 150);
    })();
  }
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
      <h1>Every Koinos collection.<br>One <em>endless</em> market.</h1>
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

/* The collection page keeps its filters IN THE URL, so a filtered view can
   be shared, bookmarked and reloaded. Changing a filter rewrites the query
   and repaints the grid alone — repainting the whole page would throw away
   the sidebar's scroll position on every click. */
async function collectionView(addr, queryString) {
  view.innerHTML = '<div class="loading"><span class="spin"></span> Loading collection…</div>';
  const state = new URLSearchParams(queryString || '');
  const [data, facetData] = await Promise.all([
    api('/collections/' + addr),
    api(`/collections/${addr}/facets`).catch(() => ({ facets: [], indexed: 0, partial: false })),
  ]);
  const info = data.info || {};

  const activeTraits = () => {
    const m = new Map();
    for (const raw of state.getAll('t')) {
      const i = raw.indexOf(':');
      if (i < 1) continue;
      const k = raw.slice(0, i);
      if (!m.has(k)) m.set(k, new Set());
      m.get(k).add(raw.slice(i + 1));
    }
    return m;
  };
  const filterCount = () => state.getAll('t').length
    + (state.get('status') && state.get('status') !== 'all' ? 1 : 0)
    + (state.get('q') ? 1 : 0);

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
    <div class="c-layout">
      <aside class="c-side" id="c-side"></aside>
      <div class="c-main">
        <div class="c-toolbar">
          <button class="btn filt-toggle" id="c-filt-open">☰ Filters<span id="c-filt-n"></span></button>
          <input id="c-search" type="search" placeholder="Search by name" value="${esc(state.get('q') || '')}">
          <select id="c-sort">
            <option value="default">Sort: default</option>
            <option value="price_asc">Price: low to high</option>
            <option value="price_desc">Price: high to low</option>
            <option value="name">Name A–Z</option>
          </select>
          <span class="c-count" id="c-count"></span>
        </div>
        <div id="c-grid"></div>
      </div>
    </div>`;

  const side = $('#c-side');
  const grid = $('#c-grid');
  $('#c-sort').value = state.get('sort') || 'default';

  /* Rewrite the address bar without navigating: a hashchange here would
     re-enter route() and rebuild the page we are standing on. */
  const syncUrl = () => {
    const qs = state.toString();
    history.replaceState(null, '', `#/c/${addr}${qs ? '?' + qs : ''}`);
  };

  const paintSidebar = () => {
    const active = activeTraits();
    const status = state.get('status') || 'all';
    const n = filterCount();
    $('#c-filt-n').textContent = n ? ` (${n})` : '';
    side.innerHTML = `
      <div class="side-head">
        <b>Filters</b>
        ${n ? '<button class="linkish" id="c-clear">Clear all</button>' : ''}
        <button class="side-x" id="c-filt-close" aria-label="Close filters">✕</button>
      </div>
      <div class="facet">
        <div class="facet-h">Status</div>
        ${[['all', 'Everything'], ['listed', 'For sale'], ['unlisted', 'Not listed'], ['mine', 'Mine']]
          .map(([v, label]) => `
          <label class="fopt${v === 'mine' && !Wallet.account ? ' dim' : ''}">
            <input type="radio" name="c-status" value="${v}"${status === v ? ' checked' : ''}>
            <span>${label}</span>
          </label>`).join('')}
      </div>
      ${facetData.facets.map((f, i) => `
        <div class="facet">
          <div class="facet-h">${esc(f.trait)}</div>
          <div class="facet-vals${f.values.length > 8 ? ' scrolly' : ''}">
            ${f.values.map((v) => {
              const on = active.get(f.trait)?.has(String(v.value));
              return `<label class="fopt">
                <input type="checkbox" data-trait="${esc(f.trait)}" value="${esc(String(v.value))}"${on ? ' checked' : ''}>
                <span>${esc(String(v.value))}</span><em>${v.count}</em>
              </label>`;
            }).join('')}
          </div>
        </div>`).join('')}
      ${facetData.facets.length ? '' : '<div class="facet dim">This collection publishes no traits to filter on.</div>'}
      ${facetData.partial ? `<div class="facet dim">Filters cover the first ${facetData.indexed} items of this collection.</div>` : ''}`;

    side.querySelectorAll('input[name="c-status"]').forEach((el) => {
      el.onchange = () => {
        if (el.value === 'mine' && !Wallet.account) { connectModal(); return paintSidebar(); }
        state.set('status', el.value);
        apply();
      };
    });
    side.querySelectorAll('input[type="checkbox"][data-trait]').forEach((el) => {
      el.onchange = () => {
        const key = `${el.dataset.trait}:${el.value}`;
        const kept = state.getAll('t').filter((x) => x !== key);
        state.delete('t');
        for (const k of kept) state.append('t', k);
        if (el.checked) state.append('t', key);
        apply();
      };
    });
    const clear = side.querySelector('#c-clear');
    if (clear) clear.onclick = () => {
      for (const k of ['t', 'status', 'q']) state.delete(k);
      $('#c-search').value = '';
      apply();
    };
    side.querySelector('#c-filt-close').onclick = () => {
      side.classList.remove('open');
      view.querySelector('.c-layout')?.classList.remove('filters-open');
    };
  };

  let reqId = 0;
  const paintGrid = async () => {
    const mine = state.get('status') === 'mine';
    const params = new URLSearchParams();
    for (const t of state.getAll('t')) params.append('t', t);
    const status = state.get('status') || 'all';
    if (status !== 'all' && status !== 'mine') params.set('status', status);
    if (mine && Wallet.account) params.set('owner', Wallet.account.address);
    if (state.get('q')) params.set('q', state.get('q'));
    if (state.get('sort') && state.get('sort') !== 'default') params.set('sort', state.get('sort'));

    const mine_ = ++reqId;
    grid.innerHTML = '<div class="loading"><span class="spin"></span></div>';
    let offset = 0;
    const page = async () => {
      const q = await api(`/collections/${addr}/tokens?limit=24&offset=${offset}&${params}`);
      if (mine_ !== reqId) return;                 // a newer filter won
      $('#c-count').textContent = `${q.matched.toLocaleString('en-US')} item${q.matched === 1 ? '' : 's'}`;
      if (!offset) {
        grid.innerHTML = q.matched
          ? '<div class="grid"></div>'
          : '<div class="empty">Nothing matches these filters.</div>';
      }
      const g = grid.querySelector('.grid');
      if (!g) return;
      g.insertAdjacentHTML('beforeend', q.tokens.map((t) => tokCard(addr, t)).join(''));
      grid.querySelector('.load-more')?.remove();
      if (q.nextOffset != null) {
        offset = q.nextOffset;
        grid.insertAdjacentHTML('beforeend', '<button class="btn load-more">Load more</button>');
        grid.querySelector('.load-more').onclick = page;
      }
    };
    try { await page(); }
    catch (e) { if (mine_ === reqId) grid.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  };

  const apply = () => { syncUrl(); paintSidebar(); paintGrid(); };

  $('#c-sort').onchange = (e) => { state.set('sort', e.target.value); apply(); };
  let searchTimer;
  $('#c-search').oninput = (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const v = e.target.value.trim();
      if (v) state.set('q', v); else state.delete('q');
      syncUrl(); paintGrid();
    }, 250);
  };
  const layout = view.querySelector('.c-layout');
  const drawer = (open) => {
    side.classList.toggle('open', open);
    layout.classList.toggle('filters-open', open);
  };
  $('#c-filt-open').onclick = () => drawer(true);
  // The backdrop is a pseudo-element, so its clicks land on the layout.
  layout.onclick = (e) => { if (e.target === layout) drawer(false); };
  document.addEventListener('keydown', function esc(e) {
    if (!layout.isConnected) return document.removeEventListener('keydown', esc);
    if (e.key === 'Escape') drawer(false);
  });

  // Land on what is for sale when there is something for sale.
  if (!state.get('status') && data.orders.length) state.set('status', 'listed');
  apply();
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
        <div class="fee-note">You own this. Listing it costs you nothing — the NFT stays in your wallet until it sells.</div>
        <div class="row"><a class="btn primary big" href="#/list/${addr}/${encodeURIComponent(tokenId)}">List Item</a></div>`;
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
        <div id="t-history"></div>
      </div>
    </div>`;

  paintHistory($('#t-history'), addr, tokenId);

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

/* What has happened to this token before — read from the contract's own
   events, so a sale made straight against the contract still shows up. */
const WHEN = (ms) => {
  if (!ms) return '';
  const d = new Date(Number(ms));
  const days = (Date.now() - Number(ms)) / 86400000;
  if (days < 1) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (days < 300) return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
};

async function paintHistory(el, addr, tokenId) {
  if (!el) return;
  let events = [];
  try {
    const r = await api(`/history?collection=${addr}&token_id=${encodeURIComponent(tokenId)}`);
    events = r.events || [];
  } catch (_) { return; }
  if (!events.length) {
    el.innerHTML = '<div class="hist"><div class="hist-h">History</div><div class="fee-note">No listings or sales yet — this one has never been to market.</div></div>';
    return;
  }
  const who = (a) => `<a class="mono" href="${Wallet.cfg.explorer}/address/${esc(a || '')}" target="_blank" rel="noopener">${esc(short(a))}</a>`;
  const line = (e) => {
    const tx = e.tx ? `<a class="hist-tx" href="${Wallet.cfg.explorer}/tx/${esc(e.tx)}" target="_blank" rel="noopener" title="View transaction">↗</a>` : '';
    if (e.kind === 'sold') {
      const net = e.price ? (BigInt(e.price) - BigInt(e.fee || 0) - BigInt(e.royalty || 0)).toString() : null;
      return `<div class="hist-row sold">
        <span class="hist-tag">Sold</span>
        <span class="hist-what">${who(e.seller)} → ${who(e.buyer)}${net ? `<em>seller received ${KOIN(net)} KOIN</em>` : ''}</span>
        <span class="hist-amt">${KOIN(e.price)} KOIN</span>
        <span class="hist-when">${WHEN(e.at)}${tx}</span></div>`;
    }
    if (e.kind === 'cancelled') {
      return `<div class="hist-row cancelled">
        <span class="hist-tag">Cancelled</span>
        <span class="hist-what">by ${who(e.seller)}</span>
        <span class="hist-amt">—</span>
        <span class="hist-when">${WHEN(e.at)}${tx}</span></div>`;
    }
    return `<div class="hist-row listed">
      <span class="hist-tag">Listed</span>
      <span class="hist-what">by ${who(e.seller)}</span>
      <span class="hist-amt">${KOIN(e.price)} KOIN</span>
      <span class="hist-when">${WHEN(e.at)}${tx}</span></div>`;
  };
  el.innerHTML = `<div class="hist"><div class="hist-h">History</div>${events.map(line).join('')}</div>`;
}

/* Listing is its own page: the price, what each cut takes, and what
   actually lands in your wallet — all visible before you commit. */
async function listView(addr, tokenId) {
  if (!Wallet.account) { connectModal(); }
  view.innerHTML = '<div class="loading"><span class="spin"></span> Loading item…</div>';
  const t = await api(`/collections/${addr}/token/${encodeURIComponent(tokenId)}`);
  const me = Wallet.account && Wallet.account.address;
  const back = `#/t/${addr}/${encodeURIComponent(tokenId)}`;

  if (!me) {
    view.innerHTML = `<div class="empty">Connect a wallet to list this item. <a href="${back}">Back to the item</a></div>`;
    return;
  }
  if (t.owner !== me) {
    view.innerHTML = `<div class="empty">This item is not in your wallet, so you cannot list it. <a href="${back}">Back to the item</a></div>`;
    return;
  }

  const feeBps = Wallet.cfg.feeBps || 250;
  const royBps = t.collection.royaltyBps || 0;

  view.innerHTML = `
    <a class="crumb" href="${back}">← ${esc(t.meta?.name || t.label)}</a>
    <div class="list-wrap">
      <div class="list-item">
        <div class="t-art">${t.meta?.image ? `<img src="${esc(t.meta.image)}" alt="">` : '<div class="ph">🖼️</div>'}</div>
        <div>
          <h2>${esc(t.meta?.name || t.label)}</h2>
          <div class="kv">${esc(t.collection.name || addr)} · <span class="mono">${esc(t.label)}</span></div>
          ${t.meta?.description ? `<p class="sub" style="margin-top:8px">${esc(t.meta.description)}</p>` : ''}
          ${t.meta?.attributes?.length ? `<div class="attrs">${t.meta.attributes.map((a) => `
            <div class="attr"><span>${esc(a.trait_type || a.name || '')}</span><b>${esc(String(a.value ?? ''))}</b></div>`).join('')}</div>` : ''}
        </div>
      </div>

      <div class="list-panel">
        <h3>List for sale</h3>
        <label for="l-price">Your price</label>
        <div class="price-field">
          <input id="l-price" type="number" min="0" step="0.00000001" placeholder="0.00" inputmode="decimal" autofocus>
          <span>KOIN</span>
        </div>

        <div class="breakdown" id="l-break"></div>

        <button class="btn primary big" id="l-go" disabled>List it</button>
        <div class="fee-note">The NFT stays in your wallet until someone buys it. You can cancel any
        time. Mana fees are on us${t.approved ? '' : ', including the one-off approval this first listing needs'}.</div>
      </div>
    </div>`;

  const priceEl = $('#l-price');
  const breakEl = $('#l-break');
  const goBtn = $('#l-go');

  const row = (label, value, cls = '') => `<div class="brow ${cls}"><span>${label}</span><b>${value}</b></div>`;
  const repaint = () => {
    const koin = parseFloat(priceEl.value);
    const ok = koin > 0 && Number.isFinite(koin);
    goBtn.disabled = !ok;
    if (!ok) {
      breakEl.innerHTML =
        row('Platform fee', `${(feeBps / 100).toFixed(2)}%`) +
        (royBps ? row('Collection royalty', `${(royBps / 100).toFixed(2)}%`) : '') +
        row('You receive', 'enter a price', 'total');
      return;
    }
    const sats = BigInt(Math.round(koin * 1e8));
    const fee = (sats * BigInt(feeBps)) / 10000n;
    const roy = (sats * BigInt(royBps)) / 10000n;
    const net = sats - fee - roy;
    breakEl.innerHTML =
      row('Listing price', `${KOIN(sats.toString())} KOIN`) +
      row(`Platform fee · ${(feeBps / 100).toFixed(2)}%`, `− ${KOIN(fee.toString())} KOIN`, 'minus') +
      (royBps ? row(`Collection royalty · ${(royBps / 100).toFixed(2)}%`, `− ${KOIN(roy.toString())} KOIN`, 'minus') : '') +
      row('You receive', `${KOIN(net.toString())} KOIN`, 'total');
  };
  priceEl.oninput = repaint;
  repaint();

  goBtn.onclick = async () => {
    const koin = parseFloat(priceEl.value);
    if (!(koin > 0)) return toast('Set a price first', 'bad');
    const sats = BigInt(Math.round(koin * 1e8)).toString();
    goBtn.disabled = true;
    goBtn.innerHTML = '<span class="spin"></span> Listing…';
    try {
      await Wallet.listToken(addr, tokenId, sats, { approved: t.approved });
      toast('Listing sent — waiting for the block…');
      location.hash = back;
      // The token page polls for the order to appear.
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        try {
          const f = await api(`/collections/${addr}/token/${encodeURIComponent(tokenId)}`);
          if (f.order && !f.order.dead) { toast('Listed. It stays in your wallet until it sells.', 'good', 6000); return route(); }
        } catch (_) {}
      }
    } catch (e) {
      toast(esc(e.message), 'bad', 8000);
      goBtn.disabled = false;
      goBtn.textContent = 'List it';
    }
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
    if ((m = /^#\/c\/([1-9A-HJ-NP-Za-km-z]+)(?:\?(.*))?$/.exec(h))) return await collectionView(m[1], m[2] || '');
    if ((m = /^#\/t\/([1-9A-HJ-NP-Za-km-z]+)\/([^/?]+)$/.exec(h))) return await tokenView(m[1], decodeURIComponent(m[2]));
    if ((m = /^#\/list\/([1-9A-HJ-NP-Za-km-z]+)\/([^/?]+)$/.exec(h))) return await listView(m[1], decodeURIComponent(m[2]));
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
  $('#foot-market').textContent = cfg.market
    ? `${cfg.networkLabel || cfg.network} · market ${cfg.market}`
    : 'contract not deployed yet';
  paintHeader();
  Wallet.onChange(() => { paintHeader(); route(); });
  $('#btn-connect').onclick = () => (Wallet.account ? walletModal() : connectModal());
  $('#btn-me').onclick = () => { location.hash = '#/me'; };
  window.addEventListener('hashchange', route);
  route();
})();
