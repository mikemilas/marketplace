#!/usr/bin/env node
/* The OURO frontend, driven in a real browser against live mainnet
   reads: home -> collection -> token, plus the connect modal. */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const SCRATCH = process.env.TEST_TMP || os.tmpdir();
/* Playwright is not a dependency of the marketplace itself — point
   PLAYWRIGHT_DIR at any install that has it (and CHROMIUM at a browser). */
const { chromium } = require(process.env.PLAYWRIGHT_DIR || 'playwright');
const PORT = 3979;
let srv, browser, fails = 0;
const check = (label, ok, detail) => {
  console.log(`  ${ok ? '✅' : '❌'} ${label}${ok ? '' : ' — ' + String(detail).slice(0, 160)}`);
  if (!ok) fails++;
};
process.on('exit', () => { try { browser && browser.close(); } catch (_) {} try { srv && srv.kill(); } catch (_) {} });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const dataDir = path.join(SCRATCH, 'mk-ui-' + process.pid);
  fs.rmSync(dataDir, { recursive: true, force: true });
  srv = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dataDir, KOINOS_NETWORK: 'mainnet' }),
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/api/config`); if (r.ok) break; } catch (_) {}
    await sleep(250);
  }

  browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  /* Resource-load failures are NOT script errors — and this sandbox's
     browser has no route to the public internet at all (proven earlier in
     the session: even a control load of the live site fails), so external
     images and the GSI script can never arrive here. pageerror stays
     strict; console noise about unreachable resources is expected. */
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push('console: ' + m.text());
  });
  /* Probe egress the way an <img> experiences it — from the RENDERER.
     (page.request goes out through Node, which has the proxy; the
     renderer does not, and the renderer is what loads images.) */
  await page.goto('about:blank');
  const hasEgress = await page.evaluate(() => new Promise((resolve) => {
    const i = new Image();
    const t = setTimeout(() => resolve(false), 8000);
    i.onload = () => { clearTimeout(t); resolve(true); };
    i.onerror = () => { clearTimeout(t); resolve(false); };
    i.src = 'https://aurvania.quest/assets/img/icon-192.png?probe=' + Math.random();
  }));

  const RELICS = '1E8hw3NiDPz9gcZ8BiWoTHzFz4H48dpFKq';
  const TOKEN = '0x4352534449544d30303031';   // Blood Blade +1, minted on mainnet

  // ---- home ----
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.col-card', { timeout: 30000 });
  const t1 = await page.evaluate(() => document.body.innerText);
  check('the home page renders the hero', /endless market/i.test(t1) || /OURO/.test(t1), t1.slice(0, 80));
  check('…with the relics collection from live mainnet', /Relic/i.test(t1), 'collection missing');
  check('…and the fee is stated', t1.includes('2.5%'), 'fee not stated');
  await page.screenshot({ path: `${SCRATCH}/mk-1-home.png` });

  // ---- collection ----
  await page.click('.col-card');
  await page.waitForSelector('.tok-card', { timeout: 45000 });
  const t2 = await page.evaluate(() => document.body.innerText);
  check('the collection page reaches its tokens', (await page.$$('.tok-card')).length > 0, 'no token cards');
  check('…with real relic names from on-chain metadata', /Blade|Armor|Ring|Helm|Shield/i.test(t2), t2.slice(0, 200));
  const imgTags = await page.$$eval('.tok-art img', (els) => els.length);
  check('…and the cards carry image urls from the metadata', imgTags > 0, 'no <img> tags at all');
  if (hasEgress) {
    const imgs = await page.$$eval('.tok-art img', (els) => els.filter((i) => i.complete && i.naturalWidth > 0).length);
    check('…and the relic art actually loads (through the old-domain 301)', imgs > 0, `${imgs} images loaded`);
  } else {
    console.log('  ⚪ relic art load skipped — this sandbox browser has no internet egress');
  }
  await page.screenshot({ path: `${SCRATCH}/mk-2-collection.png` });

  // ---- token page ----
  await page.click('.tok-card');
  await page.waitForSelector('.deal', { timeout: 30000 });
  const t3 = await page.evaluate(() => document.body.innerText);
  check('the token page shows owner and deal box', /Owner/.test(t3), t3.slice(0, 120));
  check('…and an unlisted token says so', /Not listed/i.test(t3), 'deal box copy missing');
  await page.screenshot({ path: `${SCRATCH}/mk-3-token.png` });

  // ---- connect modal ----
  await page.click('#btn-connect');
  await page.waitForSelector('.modal', { timeout: 5000 });
  const t4 = await page.evaluate(() => document.querySelector('.modal').innerText);
  check('the connect modal offers Kondor', /Kondor/.test(t4), t4.slice(0, 100));
  check('…and Google', /Google/.test(t4), 'no google');
  check('…and email, promising the same wallet as the game', /same wallet/i.test(t4), 'promise missing');
  await page.screenshot({ path: `${SCRATCH}/mk-4-connect.png` });

  /* The Google control is ours to look at and Google's to click. Only
     Google's iframe may open the popup and it cannot be styled, so our
     button is the face and Google's lands invisibly on top — which is worth
     nothing unless it actually covers the face. GSI can never load in this
     sandbox, so stand in for it with an element the size Google renders and
     measure where a click would land. */
  const g = await page.evaluate(() => {
    const face = document.querySelector('.g-face');
    const kondor = document.querySelector('#w-kondor');
    const cs = (el) => { const s = getComputedStyle(el); return { h: Math.round(el.getBoundingClientRect().height), r: s.borderRadius, fs: s.fontSize, bg: s.backgroundColor, pe: s.pointerEvents }; };
    return { face: cs(face), kondor: cs(kondor), mark: !!face.querySelector('svg.g-mark'), text: face.innerText.trim() };
  });
  check('Google wears our button, not a stock Google widget',
    g.mark && /Sign in with Google/i.test(g.text), g.text);
  check('…sized and styled exactly like the Kondor button beside it',
    g.face.h === g.kondor.h && g.face.r === g.kondor.r && g.face.fs === g.kondor.fs && g.face.bg === g.kondor.bg,
    JSON.stringify(g));
  check('…and never eats the click itself', g.face.pe === 'none', g.face.pe);

  const cover = await page.evaluate(() => {
    const slot = document.querySelector('#w-google-slot');
    const wrap = document.querySelector('#w-google-wrap');
    const r = wrap.getBoundingClientRect();
    // Google renders an iframe of the asked-for width, ~44px tall.
    const fake = document.createElement('div');
    fake.style.cssText = `width:${Math.round(r.width)}px;height:44px`;
    slot.appendChild(fake);
    const at = (x, y) => { const el = document.elementFromPoint(x, y); return !!(el && slot.contains(el)); };
    return {
      centre: at(r.left + r.width / 2, r.top + r.height / 2),
      left: at(r.left + 6, r.top + r.height / 2),
      right: at(r.right - 6, r.top + r.height / 2),
      top: at(r.left + r.width / 2, r.top + 2),
      bottom: at(r.left + r.width / 2, r.bottom - 2),
      slotH: Math.round(slot.getBoundingClientRect().height),
      wrapH: Math.round(r.height),
    };
  });
  check('the invisible Google button covers our face, so the click reaches Google',
    cover.centre && cover.left && cover.right && cover.slotH === cover.wrapH, JSON.stringify(cover));
  check('…right to the top and bottom edges, not just the middle',
    cover.top && cover.bottom, JSON.stringify(cover));

  await page.keyboard.press('Escape');

  /* ---- the filter sidebar ---- */
  await page.goto(`http://127.0.0.1:${PORT}/#/c/${RELICS}`, { waitUntil: 'load' });
  await page.waitForSelector('.c-side .facet', { timeout: 30000 });
  await page.waitForFunction(() => /\d/.test(document.querySelector('#c-count')?.textContent || ''), { timeout: 30000 });

  const sidebar = await page.evaluate(() => {
    const traits = [...document.querySelectorAll('.c-side .facet-h')].map(e => e.textContent);
    const counts = [...document.querySelectorAll('.c-side .fopt em')].map(e => Number(e.textContent));
    return { traits, counts, total: document.querySelector('#c-count').textContent };
  });
  check('the collection page has a filter sidebar built from the metadata',
    sidebar.traits.includes('Status') && sidebar.traits.includes('Rarity'), JSON.stringify(sidebar.traits));
  check('…every trait value shows how many items carry it',
    sidebar.counts.length > 3 && sidebar.counts.every(n => n > 0), JSON.stringify(sidebar.counts.slice(0, 6)));

  // Everything, then narrowed to one rarity — the grid and count must follow.
  await page.click('.c-side .fopt input[value="all"]');
  await page.waitForFunction(() => !/^0 /.test(document.querySelector('#c-count').textContent), { timeout: 20000 });
  const before = await page.evaluate(() => ({
    count: document.querySelector('#c-count').textContent,
    cards: document.querySelectorAll('.tok-card').length,
  }));
  const rareCount = await page.evaluate(() => {
    const box = [...document.querySelectorAll('.c-side .facet')].find(f => f.querySelector('.facet-h')?.textContent === 'Rarity');
    const opt = [...box.querySelectorAll('.fopt')].find(o => /rare/i.test(o.querySelector('span').textContent));
    const n = Number(opt.querySelector('em').textContent);
    opt.querySelector('input').click();
    return n;
  });
  await page.waitForFunction((n) => document.querySelector('#c-count').textContent.startsWith(String(n)),
    rareCount, { timeout: 20000 });
  const after = await page.evaluate(() => ({
    count: document.querySelector('#c-count').textContent,
    cards: document.querySelectorAll('.tok-card').length,
    hash: location.hash,
  }));
  check('ticking a trait filters the whole collection, not just the loaded page',
    after.count.startsWith(String(rareCount)) && after.count !== before.count, `${before.count} -> ${after.count}`);
  check('…the grid actually repaints to the filtered set',
    after.cards > 0 && after.cards <= rareCount, `${after.cards} cards for ${rareCount} matches`);
  check('…and the filter lives in the URL, so the view can be shared',
    /t=Rarity/.test(decodeURIComponent(after.hash)), after.hash);
  await page.screenshot({ path: `${SCRATCH}/mk-5-filters.png`, fullPage: false });

  // A shared filtered URL must come back filtered.
  await page.goto(`http://127.0.0.1:${PORT}/#/c/${RELICS}?t=Rarity%3Arare`, { waitUntil: 'load' });
  await page.waitForFunction(() => /\d/.test(document.querySelector('#c-count')?.textContent || ''), { timeout: 30000 });
  const reloaded = await page.evaluate(() => ({
    count: document.querySelector('#c-count').textContent,
    checked: !!document.querySelector('.c-side input[type=checkbox]:checked'),
  }));
  check('a shared filter URL reopens filtered, with the box still ticked',
    reloaded.count.startsWith(String(rareCount)) && reloaded.checked, JSON.stringify(reloaded));

  /* ---- the item page hands listing to its own page ---- */
  const owned = await (await fetch(`http://127.0.0.1:${PORT}/api/collections/${RELICS}/token/${TOKEN}`)).json();
  await page.goto(`http://127.0.0.1:${PORT}/#/t/${RELICS}/${TOKEN}`, { waitUntil: 'load' });
  await page.waitForSelector('.t-info h2', { timeout: 20000 });
  await page.waitForSelector('#t-history .hist', { timeout: 20000 });
  const hist = await page.evaluate(() => document.querySelector('#t-history').innerText);
  check('the item page carries a history section', /History/i.test(hist), hist.slice(0, 80));
  check('…which says so plainly when the item has never been to market',
    /never been to market|No listings/i.test(hist), hist.slice(0, 120));

  /* Pretend to be the holder — the real one, from chain — so the owner's
     path can be driven without a funded wallet in the sandbox. */
  await page.evaluate((addr) => {
    Object.defineProperty(Wallet, 'account', { get: () => ({ kind: 'hosted', address: addr }), configurable: true });
  }, owned.owner);
  await page.evaluate(() => route());
  await page.waitForSelector('.deal a[href^="#/list/"]', { timeout: 20000 });
  const listCta = await page.evaluate(() => {
    const a = document.querySelector('.deal a[href^="#/list/"]');
    return { text: a.textContent.trim(), href: a.getAttribute('href'), priceInputs: document.querySelectorAll('.deal input').length };
  });
  check('the owner gets a single "List Item" button, not a price form',
    /List Item/i.test(listCta.text) && listCta.priceInputs === 0, JSON.stringify(listCta));
  const ctaBox = await page.evaluate(() => {
    const a = document.querySelector('.deal a[href^="#/list/"]');
    const r = a.getBoundingClientRect();
    return { h: Math.round(r.height), display: getComputedStyle(a).display };
  });
  check('…and it renders as a real button, not a bare link',
    ctaBox.h >= 40 && /flex/.test(ctaBox.display), JSON.stringify(ctaBox));
  await page.screenshot({ path: `${SCRATCH}/mk-7-owner.png` });

  /* ---- the listing page ---- */
  await page.goto(`http://127.0.0.1:${PORT}/#/list/${RELICS}/${TOKEN}`, { waitUntil: 'load' });
  await page.evaluate((addr) => {
    Object.defineProperty(Wallet, 'account', { get: () => ({ kind: 'hosted', address: addr }), configurable: true });
  }, owned.owner);
  await page.evaluate(() => route());
  await page.waitForSelector('#l-price', { timeout: 20000 });
  const listPage = await page.evaluate(() => ({
    art: !!document.querySelector('.list-item .t-art img'),
    name: document.querySelector('.list-item h2')?.textContent,
    attrs: document.querySelectorAll('.list-item .attr').length,
    disabled: document.querySelector('#l-go').disabled,
  }));
  check('the listing page shows the item art, name and details',
    listPage.art && !!listPage.name && listPage.attrs > 0, JSON.stringify(listPage));
  check('…and will not list until a price is entered', listPage.disabled === true, String(listPage.disabled));

  await page.fill('#l-price', '200');
  await page.waitForFunction(() => /200/.test(document.querySelector('#l-break').innerText), { timeout: 10000 });
  const breakdown = await page.evaluate(() => ({
    text: document.querySelector('#l-break').innerText,
    total: document.querySelector('.brow.total b').textContent,
    disabled: document.querySelector('#l-go').disabled,
  }));
  check('…the breakdown names the platform fee', /Platform fee/i.test(breakdown.text), breakdown.text);
  // 200 KOIN at 2.5% = 5 KOIN platform fee; relics carry no royalty, so 195 lands.
  check('…and the final received amount is the price minus every cut',
    /5\b/.test(breakdown.text) && /195/.test(breakdown.total), `${breakdown.text} | total=${breakdown.total}`);
  check('…with the List button live once a price is set', breakdown.disabled === false, String(breakdown.disabled));
  await page.screenshot({ path: `${SCRATCH}/mk-6-list.png` });

  /* ---- the header chip is gone ---- */
  const chip = await page.evaluate(() => ({
    net: !!document.querySelector('#net-chip'),
    header: document.querySelector('.top-actions').innerText.trim(),
  }));
  check('the network chip beside "My items" is gone', !chip.net && !/Koinos/.test(chip.header), JSON.stringify(chip));

  check('no script errors anywhere', errs.length === 0, errs.slice(0, 2).join(' | '));

  console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
