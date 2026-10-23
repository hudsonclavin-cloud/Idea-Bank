#!/usr/bin/env node
// Headless playthrough of After You with two simulated players, from file://.
//
//  1. Phone, facing seats: for all four order combinations, the page's DOM during the deal is
//     identical until a player holds their own card, and each card shows its owner's order.
//  2. Phone, two simultaneous touches (CDP Input.dispatchTouchEvent with two touch points): a
//     whole scored round played in two tabs at once, Orange leading a slow path and Blue following
//     300 ms behind. In one tab the orders are LEAD/FOLLOW, in the other FOLLOW/FOLLOW, and
//     Orange answers differently in each: the DOM during the guess is still identical. The
//     reveals then name the right leader and the right points.
//  3. Desktop, side-by-side seats, keyboard only: a practice round with Orange on W A S D and
//     Blue copying on the arrow keys 300 ms later; the trace names Orange.
//  4. Dark scheme and reduced motion load and play without errors; no page ever scrolls sideways.
//  5. The held card looks the same from outside whichever order it shows: at phone and desktop
//     sizes (and on a phone forced side by side, the narrowest card), its box, its line boxes and
//     its wrapping are measured for LEAD and for FOLLOW and must match, nothing may overflow, its
//     transitions must match, and a screenshot of the whole screen with the card's letters made
//     transparent must be pixel-identical for the two orders.
//  6. A whole game (practice, four rounds, summary, back to the title) with Playwright's fake
//     clock and both players steering on the keyboard, the glass intact; then a game in which
//     nobody moves, so the glass breaks in round 1 and nobody wins.
//
// The harness learns the orders by replacing crypto.getRandomValues before the page loads; the
// page itself never exposes them. Run: node ideas/57-after-you/check.mjs (about 2 minutes).
// Set AFTER_YOU_SHOTS=/some/dir to keep screenshots.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const URL_ = pathToFileURL(path.join(HERE, 'index.html')).href;
const SHOTS = process.env.AFTER_YOU_SHOTS || path.join(os.tmpdir(), 'after-you-check');
fs.mkdirSync(SHOTS, { recursive: true });

function loadPlaywright() {
  const req = createRequire(import.meta.url);
  try {
    return req('playwright');
  } catch {
    const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
    return createRequire(path.join(globalRoot, 'noop.js'))('playwright');
  }
}

let failures = 0;
let passes = 0;
function check(cond, what) {
  if (cond) passes++;
  else {
    failures++;
    console.log(`  FAIL ${what}`);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Every call to crypto.getRandomValues fills from this cycle of words: [orange, blue, buttons, buttons].
const rig = (words) => `(() => {
  const q = ${JSON.stringify(words)};
  let i = 0;
  crypto.getRandomValues = (a) => { for (let k = 0; k < a.length; k++) a[k] = q[i++ % q.length]; return a; };
})();`;

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const DESKTOP = { viewport: { width: 1280, height: 800 } };

async function open(browser, opts, words, extra = {}, fakeClock = false) {
  const context = await browser.newContext({ ...opts, ...extra });
  await context.addInitScript(rig(words));
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  if (fakeClock) await page.clock.install();
  await page.goto(URL_);
  const cdp = await context.newCDPSession(page);
  return { context, page, errors, cdp };
}
async function touch(t, type, pts) {
  await t.cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: pts.map((p) => ({ x: p.x, y: p.y, id: p.id, radiusX: 6, radiusY: 6, force: 1 })),
  });
}
async function centre(page, sel) {
  const b = await page.locator(sel).first().boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
async function holdCard(t, p) {
  const c = await centre(t.page, `#half${p} .card`);
  await touch(t, 'touchStart', [{ ...c, id: 9 }]);
  await sleep(250);
  const text = await t.page.locator(`#half${p} .card`).innerText();
  return { c, text };
}
const fieldHtml = (page) => page.evaluate(() => document.getElementById('field-wrap').outerHTML + '|' + document.body.className);
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name + '.png') });

// Orange's path in the mirror frame (x along the line, y away from it), t in seconds.
function orangePath(t, Lu, Lv) {
  const x = Lu / 2 + 0.22 * Lu * Math.sin((2 * Math.PI * t) / 8) + 0.05 * Lu * Math.sin((2 * Math.PI * t) / 3.3);
  const y = 0.3 * Lv + 0.18 * Lv * (1 - Math.cos((2 * Math.PI * t) / 10));
  return { x, y };
}

async function hiddenDeal(browser) {
  console.log('deal: the DOM hides both orders until a card is held');
  const combos = [
    [1, 1],
    [1, 0],
    [0, 1],
    [0, 0],
  ];
  const tabs = [];
  for (const [o, b] of combos) tabs.push(await open(browser, PHONE, [o, b, 0, 0]));
  for (const t of tabs) await t.page.locator('#go-play').tap();
  await sleep(300);
  const before = await Promise.all(tabs.map((t) => fieldHtml(t.page)));
  check(before.every((h) => h === before[0]), 'deal DOM identical for all four order combinations');
  check(!/LEAD|FOLLOW/.test(before[0]), 'no order word anywhere in the deal DOM');
  await shot(tabs[1].page, 'phone-deal');
  // Orange holds their card in every tab.
  const held = [];
  for (const [i, t] of tabs.entries()) {
    const h = await holdCard(t, 0);
    held.push(await fieldHtml(t.page));
    check(h.text.includes(combos[i][0] ? 'LEAD' : 'FOLLOW'), `Orange's card shows Orange's order (${combos[i]})`);
    check(!(await t.page.locator('#half1').innerText()).match(/LEAD|FOLLOW/), "Blue's half never shows an order while Orange holds");
    if (i === 1) await shot(t.page, 'phone-card-held');
    if (i === 3) await shot(t.page, 'phone-card-held-follow');
    await touch(t, 'touchEnd', []);
  }
  check(held[0] === held[1] && held[2] === held[3] && held[0] !== held[2], 'while Orange holds, the DOM depends on Orange’s order only');
  await sleep(150);
  const after = await Promise.all(tabs.map((t) => fieldHtml(t.page)));
  check(after.every((h) => h === after[0]), 'after Orange lets go, the DOM is identical again for all four');
  check(!/LEAD|FOLLOW/.test(after[0]), 'no order word left in the DOM after letting go');
  for (const t of tabs) {
    check(t.errors.length === 0, `no console errors (${t.errors.join('; ')})`);
    await t.context.close();
  }
}

async function scoredRound(browser) {
  console.log('round: two fingers at once, in two tabs with different hidden orders');
  // Tab A: Orange LEAD, Blue FOLLOW. Tab B: both FOLLOW. Same button orders in both.
  const tabs = [await open(browser, PHONE, [1, 0, 1, 1]), await open(browser, PHONE, [0, 0, 1, 1])];
  for (const t of tabs) {
    await t.page.locator('#go-play').tap();
    for (const p of [0, 1]) {
      await holdCard(t, p);
      await touch(t, 'touchEnd', []);
    }
  }
  const W = 390;
  const H = 844;
  const Lu = W;
  const Lv = H / 2;
  const scr = (p, m) => ({ x: m.x, y: p === 0 ? H / 2 + m.y : H / 2 - m.y });
  const start = orangePath(0, Lu, Lv);
  const fingers = (t) => [
    { ...scr(0, orangePath(Math.max(0, t), Lu, Lv)), id: 1 },
    { ...scr(1, orangePath(Math.max(0, t - 0.3), Lu, Lv)), id: 2 },
  ];
  // Both fingers go down on their dots at once: the countdown starts by itself.
  for (const t of tabs) await touch(t, 'touchStart', [{ ...scr(0, start), id: 1 }, { ...scr(1, start), id: 2 }]);
  await sleep(300);
  for (const t of tabs) check((await t.page.locator('#half0 .count').innerText()).trim() !== '', 'two fingers down start the countdown');
  await shot(tabs[0].page, 'phone-countdown');
  // Wait for "Go." in tab A, then play 30 s of motion (tab B started within a few ms of A).
  const t0 = Date.now();
  while (Date.now() - t0 < 5000 && (await tabs[0].page.locator('#announce').innerText()) !== 'Go.') await sleep(10);
  const go = Date.now();
  let shotDone = false;
  while (true) {
    const t = (Date.now() - go) / 1000;
    const done = await tabs[0].page.locator('#half0 .choices, #half0 .locked').count();
    if (done || t > 34) break;
    for (const tab of tabs) await touch(tab, 'touchMove', fingers(t));
    if (!shotDone && t > 14) {
      await shot(tabs[0].page, 'phone-play');
      shotDone = true;
    }
    await sleep(12);
  }
  for (const t of tabs) await touch(t, 'touchEnd', []);
  await sleep(300);
  check((await tabs[0].page.locator('#half0 .choice').count()) === 2, 'guess: two answers offered to Orange');
  await shot(tabs[0].page, 'phone-guess');
  // Orange answers FOLLOW in tab A and LEAD in tab B; the guess-phase DOM must still match.
  await tabs[0].page.locator('#half0 .choice', { hasText: 'FOLLOW' }).tap();
  await tabs[1].page.locator('#half0 .choice', { hasText: 'LEAD' }).tap();
  await sleep(150);
  const g = await Promise.all(tabs.map((t) => fieldHtml(t.page)));
  check(g[0] === g[1], 'guess DOM identical across different orders and different answers');
  check((await tabs[0].page.locator('#half0 .choice').count()) === 0, 'an answer cannot be changed: the buttons are gone');
  // Blue answers LEAD in both.
  for (const t of tabs) await t.page.locator('#half1 .choice', { hasText: 'LEAD' }).tap();
  await sleep(400);
  const textA = await tabs[0].page.locator('#screen').innerText();
  const textB = await tabs[1].page.locator('#screen').innerText();
  check(/Orange led and Blue followed, as ordered\./.test(textA), 'tab A reveal: Orange led, as ordered');
  check(/Somebody had to go first, and it was Orange\./.test(textB), 'tab B reveal: two followers, Orange went first');
  check(/And each of you guessed the other had been told to lead\./.test(textB), 'tab B: two followers who each guessed the other was told to lead are told so, as a guess');
  check(!/thought the other was leading/.test(textB), 'tab B: the guesses are not presented as who was leading');
  check(/the glass is whole/.test(textA) && /the glass is whole/.test(textB), 'the mirror held: the glass is whole');
  check(/You both read each other right\./.test(textA), 'tab A: both read right');
  const pts = async (t) =>
    t.page.evaluate(() => {
      const row = [...document.querySelectorAll('table.points tr')].find((r) => r.textContent.startsWith('This round'));
      return row ? [...row.querySelectorAll('td.n')].map((td) => Number(td.textContent)) : null;
    });
  const pa = await pts(tabs[0]);
  const pb = await pts(tabs[1]);
  check(JSON.stringify(pa) === '[2,2]', `tab A points 2/2 (kept, read), got ${pa}`);
  // Tab B: kept: Orange (FOLLOW) no, Blue (FOLLOW, Orange led) yes; read: Orange guessed LEAD (wrong), Blue guessed LEAD (wrong).
  check(JSON.stringify(pb) === '[0,1]', `tab B points 0/1, got ${pb}`);
  const heldPct = Number((textA.match(/the mirror held \((\d+)% of the round\)/) || [])[1]);
  check(heldPct >= 50, `the mirror held for a 300 ms follower (${heldPct}%)`);
  const lag = Number((textA.match(/Orange ahead by about ([\d.]+) s/) || [])[1]);
  check(lag > 0.2 && lag < 0.45, `measured lag about 0.3 s (got ${lag})`);
  check(await noOverflow(tabs[0].page), 'reveal fits 390 px');
  await tabs[0].page.screenshot({ path: path.join(SHOTS, 'phone-reveal.png'), fullPage: true });
  // Scrub the timeline and go on to round 2.
  const svg = tabs[0].page.locator('.timeline svg');
  const bb = await svg.boundingBox();
  await tabs[0].page.touchscreen.tap(bb.x + bb.width * 0.3, bb.y + bb.height / 3);
  check((await svg.getAttribute('aria-valuenow')) !== '30.0', 'the timeline scrubs');
  await tabs[0].page.locator('#next').tap();
  await sleep(200);
  check((await tabs[0].page.locator('#half0 .card').count()) === 1, 'next round deals new cards');
  for (const t of tabs) {
    check(t.errors.length === 0, `no console errors (${t.errors.join('; ')})`);
    await t.context.close();
  }
}

async function keyboardPractice(browser) {
  console.log('practice: keyboard only, side by side');
  const t = await open(browser, DESKTOP, [5, 6, 7, 8]);
  await t.page.locator('#go-practice').click();
  await sleep(200);
  check(await t.page.evaluate(() => document.body.classList.contains('side')), 'landscape desktop seats you side by side');
  await t.page.locator('#begin').click();
  const t0 = Date.now();
  while (Date.now() - t0 < 5000 && (await t.page.locator('#announce').innerText()) !== 'Go.') await sleep(10);
  const go = Date.now();
  // Orange's key script; Blue presses the mirror-image keys 300 ms later.
  const MIRROR = { KeyW: 'ArrowUp', KeyS: 'ArrowDown', KeyA: 'ArrowRight', KeyD: 'ArrowLeft' };
  const script = [
    ['KeyW', 300, 1300],
    ['KeyA', 1500, 2600],
    ['KeyS', 2900, 4200],
    ['KeyD', 4300, 5000],
    ['KeyW', 5200, 6000],
    ['KeyA', 5600, 6600],
    ['KeyS', 7000, 8400],
    ['KeyD', 8600, 9900],
    ['KeyW', 10200, 11500],
    ['KeyA', 11800, 12500],
    ['KeyS', 12700, 13600],
    ['KeyD', 13800, 15000],
    ['KeyW', 15300, 16400],
    ['KeyA', 16600, 17800],
  ];
  const events = [];
  for (const [k, a, b] of script) {
    events.push([a, 'down', k], [b, 'up', k], [a + 300, 'down', MIRROR[k]], [b + 300, 'up', MIRROR[k]]);
  }
  events.sort((x, y) => x[0] - y[0]);
  for (const [at, kind, key] of events) {
    const wait = go + at - Date.now();
    if (wait > 0) await sleep(wait);
    if (kind === 'down') await t.page.keyboard.down(key);
    else await t.page.keyboard.up(key);
  }
  while (Date.now() - go < 24000 && (await t.page.locator('#half0 .choice').count()) === 0) await sleep(50);
  check((await t.page.locator('#half0 .choice').count()) === 3, 'practice asks who led, with three answers');
  await t.page.locator('#half0 .choice', { hasText: 'Me' }).click();
  await t.page.locator('#half1 .choice', { hasText: 'Orange' }).click();
  await sleep(400);
  const text = await t.page.locator('#screen').innerText();
  check(/The trace says Orange led/.test(text), 'keyboard practice: the trace names Orange');
  check(/You both felt it right\./.test(text), 'both felt answers match the trace');
  await t.page.screenshot({ path: path.join(SHOTS, 'desktop-practice-reveal.png'), fullPage: true });
  check(t.errors.length === 0, `no console errors (${t.errors.join('; ')})`);
  await t.context.close();
}

async function schemes(browser) {
  console.log('dark scheme and reduced motion');
  const t = await open(browser, PHONE, [1, 1, 0, 0], { colorScheme: 'dark', reducedMotion: 'reduce' });
  check(await noOverflow(t.page), 'title fits 390 px in dark');
  await shot(t.page, 'phone-dark-title');
  await t.page.locator('#go-play').tap();
  await holdCard(t, 1);
  await shot(t.page, 'phone-dark-card');
  await touch(t, 'touchEnd', []);
  await t.page.locator('#quit').tap();
  await sleep(100);
  check((await t.page.locator('#go-play').count()) === 1, 'the × goes back to the title');
  check(t.errors.length === 0, `no console errors (${t.errors.join('; ')})`);
  await t.context.close();
}

// ------------------------------------------------------------ the held card, from outside
// Everything about a held card except its letters: the box, each line's box and number of line
// boxes, overflow, transitions; and the whole screen with the letters made transparent.
async function cardLooks(t, p, desktop) {
  const c = await centre(t.page, `#half${p} .card`);
  if (desktop) {
    await t.page.mouse.move(c.x, c.y);
    await t.page.mouse.down();
  } else await touch(t, 'touchStart', [{ ...c, id: 9 }]);
  await sleep(250);
  const geo = await t.page.evaluate((p) => {
    const card = document.querySelector(`#half${p} .card`);
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 100) / 100);
    };
    const kids = [...card.children].map((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return { cls: el.className, box: box(el), lineBoxes: range.getClientRects().length, overflow: el.scrollWidth > el.clientWidth + 0.5 };
    });
    const cs = getComputedStyle(card);
    return {
      held: card.classList.contains('held'),
      card: box(card),
      cardOverflow: card.scrollWidth > card.clientWidth + 0.5 || card.scrollHeight > card.clientHeight + 0.5,
      kids,
      looks: [cs.transition, cs.animationName, cs.boxShadow, cs.borderRadius, cs.backgroundColor].join(' | '),
    };
  }, p);
  const style = await t.page.addStyleTag({ content: '.card .word, .card .line { color: transparent !important; text-shadow: none !important; }' });
  await sleep(60);
  const png = await t.page.screenshot();
  await style.evaluate((el) => el.remove());
  if (desktop) await t.page.mouse.up();
  else await touch(t, 'touchEnd', []);
  await sleep(120);
  return { geo, png };
}

async function heldCardGeometry(browser) {
  console.log('the held card: same outline, lines and pixels for LEAD and FOLLOW');
  const configs = [
    { name: 'phone 390', opts: PHONE },
    { name: 'phone 320', opts: { ...PHONE, viewport: { width: 320, height: 568 } } },
    { name: 'phone 390 forced side by side', opts: PHONE, side: true },
    { name: 'desktop', opts: DESKTOP, desktop: true },
  ];
  for (const cfg of configs) {
    for (const motion of cfg.name === 'phone 390' ? ['reduce', 'no-preference'] : ['reduce']) {
      const seen = {};
      for (const ord of [1, 0]) {
        const t = await open(browser, cfg.opts, [ord, ord, 0, 0], { reducedMotion: motion });
        if (cfg.side) await t.page.locator('[data-set="seat"][data-val="side"]').click();
        await t.page.locator('#go-play').click();
        await sleep(250);
        seen[ord] = [];
        for (const p of [0, 1]) seen[ord].push(await cardLooks(t, p, cfg.desktop));
        check(t.errors.length === 0, `no console errors (${t.errors.join('; ')})`);
        await t.context.close();
      }
      for (const p of [0, 1]) {
        const L = seen[1][p];
        const F = seen[0][p];
        const label = `${cfg.name}, ${motion} motion, ${p ? 'Blue' : 'Orange'}`;
        check(L.geo.held && F.geo.held, `${label}: the card is held`);
        check(JSON.stringify(L.geo.card) === JSON.stringify(F.geo.card), `${label}: held card box LEAD ${L.geo.card} = FOLLOW ${F.geo.card}`);
        const lines = (g) => g.kids.map((k) => `${k.cls}:${k.box}:${k.lineBoxes}`).join(' ');
        check(lines(L.geo) === lines(F.geo), `${label}: same line boxes and wrapping (${lines(L.geo)} vs ${lines(F.geo)})`);
        check(L.geo.kids.length === 3 && L.geo.kids.every((k) => k.lineBoxes === 1), `${label}: a word and two lines, none wrapped`);
        check(![L, F].some((x) => x.geo.cardOverflow || x.geo.kids.some((k) => k.overflow)), `${label}: nothing overflows or is clipped`);
        check(L.geo.looks === F.geo.looks, `${label}: same border, shadow and transitions`);
        if (motion === 'reduce') check(L.png.equals(F.png), `${label}: the screen, letters aside, is pixel-identical for LEAD and FOLLOW`);
      }
    }
  }
}

// ------------------------------------------------------------ whole games, fast-forwarded
const C_COUNT = 3000;
// Facing seats: Blue mirrors Orange's D A S W with Right Left Up Down.
const MIRROR_KEYS = { KeyD: 'ArrowRight', KeyA: 'ArrowLeft', KeyS: 'ArrowUp', KeyW: 'ArrowDown' };
// One lap of a rectangle in 6 s at the keyboard's pace; three laps, then hands still for the rest
// of the round (fast-forwarded); Blue 300 ms behind Orange throughout.
const LAP = [
  ['KeyD', 1000],
  ['KeyS', 1000],
  ['KeyA', 2000],
  ['KeyW', 1000],
  ['KeyD', 1000],
];

async function wholeGame(browser) {
  console.log('a whole game, with a fake clock and both players steering on the keys: practice, four rounds, summary, title');
  const t = await open(browser, { ...PHONE, deviceScaleFactor: 1 }, [1, 0, 2, 3], {}, true);
  // Stop the fake clock from also flowing in real time, so a slow machine cannot shift the key
  // script against the round: from here on, time moves only when the check moves it.
  await t.page.clock.pauseAt((await t.page.evaluate(() => Date.now())) + 50);
  // Under a fake clock, tap by coordinates: Playwright's own waiting for elements to settle uses frames.
  const tap = async (loc) => {
    await loc.first().evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const b = await loc.first().boundingBox();
    await t.page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  };
  await tap(t.page.locator('#go-practice'));
  await t.page.clock.runFor(300);
  await tap(t.page.locator('#begin'));
  await t.page.clock.fastForward(C_COUNT + 20000 + 500); // like a tab left in the background: one late frame catches up
  await t.page.clock.runFor(200);
  await tap(t.page.locator('#half0 .choice', { hasText: 'Nobody' }));
  await tap(t.page.locator('#half1 .choice', { hasText: 'Nobody' }));
  await t.page.clock.runFor(300);
  check(/nobody was ahead/.test(await t.page.locator('.punch').innerText()), 'a still practice round: the trace names nobody');
  check(!/glass broke/.test(await t.page.locator('#screen').innerText()), 'a still practice round breaks nothing');
  await tap(t.page.locator('#next'));
  for (let r = 1; r <= 4; r++) {
    await t.page.clock.runFor(300);
    for (const p of [0, 1]) await tap(t.page.locator(`#half${p} .card`));
    await t.page.clock.runFor(300);
    await tap(t.page.locator('#begin'));
    await t.page.clock.runFor(C_COUNT + 50);
    const events = [];
    let at = 0;
    for (let lap = 0; lap < 3; lap++)
      for (const [k, ms] of LAP) {
        events.push([at, 'down', k], [at + ms, 'up', k], [at + 300, 'down', MIRROR_KEYS[k]], [at + ms + 300, 'up', MIRROR_KEYS[k]]);
        at += ms;
      }
    events.sort((x, y) => x[0] - y[0] || (x[1] === 'up' ? -1 : 1));
    let now = 0;
    for (const [when, kind, key] of events) {
      if (when > now) await t.page.clock.runFor(when - now);
      now = Math.max(now, when);
      if (kind === 'down') await t.page.keyboard.down(key);
      else await t.page.keyboard.up(key);
    }
    await t.page.clock.fastForward(30000 - now + 400); // hands still: one late frame catches up
    await t.page.clock.runFor(200);
    await tap(t.page.locator('#half0 .choice').first());
    await tap(t.page.locator('#half1 .choice').first());
    await t.page.clock.runFor(300);
    const text = await t.page.locator('#screen').innerText();
    check(new RegExp(`round ${r} of 4`, 'i').test(await t.page.locator('.kicker').innerText()), `round ${r} reveal`);
    const heldLine = (text.match(/The mirror held for [\d.]+ s \(10 s needed\)[^\n]*/) || [''])[0];
    if (process.env.AFTER_YOU_VERBOSE) console.log('   ', heldLine, '|', (text.match(/ahead by about [^\n]*/) || [''])[0]);
    check(/the glass is whole/.test(text), `round ${r}: two players steering on the keys keep the glass whole (${heldLine}; ${(text.match(/ahead by about [^\n]*/) || [''])[0]})`);
    check(/Orange led and Blue followed/.test(text), `round ${r}: Orange, 300 ms ahead on the keys, is measured leading`);
    await tap(t.page.locator('#next'));
  }
  await t.page.clock.runFor(300);
  const summary = await t.page.locator('#screen').innerText();
  check(/After 4 rounds/i.test(summary) && /Level\.|wins by/.test(summary) && !/Nobody wins/.test(summary), 'summary: four rounds and a result');
  check((await t.page.locator('#answer').isHidden()) && (await t.page.locator('#show').count()) === 1, 'summary: the bar waits until you have answered out loud');
  await tap(t.page.locator('#show'));
  check(await t.page.locator('#answer').isVisible(), 'summary: the bar appears on request');
  check(await noOverflow(t.page), 'summary fits 390 px');
  await t.page.screenshot({ path: path.join(SHOTS, 'phone-summary.png'), fullPage: true });
  await tap(t.page.locator('#again'));
  check((await t.page.locator('#go-play').count()) === 1, 'play again returns to the title');
  check(t.errors.length === 0, `no console errors (${t.errors.join('; ')})`);
  await t.context.close();
}

async function brokenGlass(browser) {
  console.log('a game in which nobody moves: the glass breaks in round 1 and nobody wins');
  const t = await open(browser, PHONE, [1, 0, 2, 3], {}, true);
  const tap = async (loc) => {
    await loc.first().evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const b = await loc.first().boundingBox();
    await t.page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  };
  const title = await t.page.locator('#screen').innerText();
  check(/keep travelling/i.test(title) && /fingertip’s width every second/.test(title), 'the title tip says to keep travelling, with the speed floor');
  check(/the glass breaks/i.test(title), 'the title explains the glass');
  await tap(t.page.locator('#go-play'));
  await t.page.clock.runFor(300);
  for (const p of [0, 1]) await tap(t.page.locator(`#half${p} .card`));
  await t.page.clock.runFor(300);
  await tap(t.page.locator('#begin'));
  await t.page.clock.fastForward(C_COUNT + 30000 + 500);
  await t.page.clock.runFor(200);
  await tap(t.page.locator('#half0 .choice').first());
  await tap(t.page.locator('#half1 .choice').first());
  await t.page.clock.runFor(300);
  const text = await t.page.locator('#screen').innerText();
  check(/the glass broke/i.test(text), 'a still round: the reveal says the glass broke');
  check((await t.page.locator('#next').innerText()) === 'See how it went', 'a broken glass goes straight to the end');
  await t.page.screenshot({ path: path.join(SHOTS, 'phone-reveal-broken.png'), fullPage: true });
  await tap(t.page.locator('#next'));
  await t.page.clock.runFor(300);
  const summary = await t.page.locator('#screen').innerText();
  check(/The glass broke in round 1\. Nobody wins\./.test(summary), 'summary: the glass broke in round 1, nobody wins');
  check(/after 1 round\b/i.test(summary), 'summary: after one round');
  check(t.errors.length === 0, `no console errors (${t.errors.join('; ')})`);
  await t.context.close();
}

async function main() {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  // AFTER_YOU_ONLY=heldCardGeometry,brokenGlass runs just those parts.
  const only = (process.env.AFTER_YOU_ONLY || '').split(',').filter(Boolean);
  try {
    for (const step of [hiddenDeal, scoredRound, keyboardPractice, schemes, heldCardGeometry, wholeGame, brokenGlass]) {
      if (!only.length || only.includes(step.name)) await step(browser);
    }
  } finally {
    await browser.close();
  }
  console.log(`${passes} checks passed, ${failures} failed. Screenshots: ${SHOTS}`);
  process.exit(failures ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
