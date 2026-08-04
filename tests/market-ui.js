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

  check('no script errors anywhere', errs.length === 0, errs.slice(0, 2).join(' | '));

  console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
