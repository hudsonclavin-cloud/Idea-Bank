#!/usr/bin/env node
// Headless walk through the museum: operates every exhibit the way a visitor
// would (slow drags, taps, twists, holds), checks that each does what its plaque
// says, listens for the sounds that should be heard, then behaves like a bored
// visitor (hammering, resizing, hiding the tab, reduced motion) and makes sure
// nothing breaks and the animation loop goes back to sleep.
//
// Run from anywhere: node ideas/30-open-circuit/check.mjs
// Needs the globally installed Playwright that tools/smoke.mjs uses.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.md': 'text/markdown' };

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

async function main() {
  const server = http.createServer((req, res) => {
    let p = path.join(HERE, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(HERE)) return res.writeHead(403).end();
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
    fs.readFile(p, (err, data) => {
      if (err) return res.writeHead(404).end();
      res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  try {
    await visit(browser, origin, { name: 'desktop', viewport: { width: 1280, height: 800 } });
    await visit(browser, origin, { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, true);
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failures ? `\n${failures} check(s) failed, ${passes} passed` : `\nall ${passes} checks passed`);
  process.exit(failures ? 1 : 0);
}

async function visit(browser, origin, vp, phoneOnly = false) {
  console.log(`\n[${vp.name}]`);
  const context = await browser.newContext({ viewport: vp.viewport, isMobile: !!vp.isMobile, hasTouch: !!vp.hasTouch, deviceScaleFactor: vp.deviceScaleFactor || 1, colorScheme: 'light' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`uncaught: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.goto(`${origin}/index.html`, { waitUntil: 'load' });
  await page.waitForTimeout(300);

  // Record every sound the museum tries to play, and unlock audio so it tries.
  await page.evaluate(() => {
    window.__sounds = [];
    const orig = window.Sound.play;
    window.Sound.play = (name, delay) => { window.__sounds.push(name); return orig(name, delay); };
  });
  const sounds = () => page.evaluate(() => window.__sounds.splice(0));
  const state = (i, expr) => page.evaluate(([i, expr]) => { const x = window.OpenCircuit.exhibits[i]; const m = x.model; return eval(expr); }, [i, expr]);
  const svgs = page.locator('.vitrine svg');
  // SVG user units -> page pixels for exhibit i
  async function at(i, ux, uy) {
    const box = await svgs.nth(i).boundingBox();
    await svgs.nth(i).scrollIntoViewIfNeeded();
    const b = await svgs.nth(i).boundingBox();
    return { x: b.x + (ux / 240) * b.width, y: b.y + (uy / 170) * b.height, s: b.width / 240 };
  }
  async function drag(i, x0, y0, x1, y1, steps = 24, hold = 0) {
    const a = await at(i, x0, y0);
    const b = await at(i, x1, y1);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    for (let k = 1; k <= steps; k++) {
      await page.mouse.move(a.x + ((b.x - a.x) * k) / steps, a.y + ((b.y - a.y) * k) / steps);
      await page.waitForTimeout(8);
    }
    if (hold) await page.waitForTimeout(hold);
    await page.mouse.up();
  }
  async function tap(i, ux, uy) {
    const p = await at(i, ux, uy);
    if (vp.hasTouch) await page.touchscreen.tap(p.x, p.y);
    else await page.mouse.click(p.x, p.y);
  }
  const settle = (ms = 700) => page.waitForTimeout(ms);
  const T = { toggle: 0, rotary: 1, lights: 2, sound: 3, bell: 4, latch: 5, key: 6, dip: 7, chain: 8, knife: 9, breaker: 10, guard: 11, estop: 12, box: 13, tally: 14 };
  // What the tally's drums show, read from the drawing itself: for each drum,
  // the digit most visible in the window. A drum is square when that digit sits
  // on the window's rest line (7 units above its bottom edge) and the drum's
  // other digit is wholly out of sight.
  const drumsShown = () => page.evaluate((i) => {
    const svg = window.OpenCircuit.exhibits[i].svg;
    const w = svg.querySelector('#cDrums rect').getBBox();
    const restLine = w.y + w.height - 7;
    const drums = [];
    for (let d = 0; d < 4; d++) {
      const seen = [...svg.querySelectorAll(`text[data-drum="${d}"]`)].map((t) => {
        const b = t.getBBox();
        return { digit: t.textContent, y: Number(t.getAttribute('y')), vis: Math.max(0, Math.min(b.y + b.height, w.y + w.height) - Math.max(b.y, w.y)) / b.height };
      }).sort((a, b) => b.vis - a.vis);
      drums.push(seen);
    }
    return {
      reads: drums.map((s) => s[0].digit).join(''),
      square: drums.map((s) => Math.abs(s[0].y - restLine) < 0.01 && s[0].vis > 0.99 && s[1].vis < 0.01),
    };
  }, T.tally);
  // Put the tally at reading v, still (count and drums together), and draw it.
  const setTally = (v) => page.evaluate(([i, v]) => {
    const x = window.OpenCircuit.exhibits[i];
    x.model.count = Math.floor(v);
    x.model.shown = v;
    x.model.vel = 0;
    x.render();
  }, [T.tally, v]);
  // Send keys straight to an exhibit within one task, so nothing animates in between.
  const keysNow = (i, keys) => page.evaluate(([i, keys]) => {
    const svg = window.OpenCircuit.exhibits[i].svg;
    for (const key of keys) svg.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  }, [i, keys]);

  if (phoneOnly) {
    // On the phone: touch taps work every exhibit, nothing scrolls sideways, nothing throws.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(overflow <= 1, `phone: no horizontal overflow (${overflow}px)`);
    await tap(T.toggle, 120, 126);
    await settle();
    check(await state(T.toggle, 'm.on'), 'phone: tap flips the toggle');
    await tap(T.rotary, 160, 92);
    await settle();
    check((await state(T.rotary, 'm.index')) === 1, 'phone: tap on the right half of the knob advances it');
    await tap(T.bell, 120, 74);
    await settle();
    const s = await sounds();
    check(s.includes('down') && s.includes('up'), `phone: bell push sounds down and up (${s})`);
    // The e-stop latches under a finger that is held down, or that drifts a little.
    {
      const cdp = await context.newCDPSession(page);
      const touch = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y }] : [] });
      const p = await at(T.estop, 120, 88);
      await touch('touchStart', p);
      await page.waitForTimeout(600);
      check(await state(T.estop, 'm.latched'), 'phone: the e-stop latches while a finger is still held on it');
      await touch('touchEnd');
      await settle(300);
      check(await state(T.estop, 'm.latched'), 'phone: and stays latched when the finger lifts after 0.6 s');
      await page.evaluate((i) => { const m = window.OpenCircuit.exhibits[i].model; m.latched = false; }, T.estop);
      await settle(500);
      await touch('touchStart', p);
      await touch('touchMove', { x: p.x + 5, y: p.y + 2 });
      await touch('touchEnd');
      await settle(300);
      check(await state(T.estop, 'm.latched'), 'phone: a quick touch that drifts 5 px still latches the e-stop');
      await page.evaluate((i) => { const m = window.OpenCircuit.exhibits[i].model; m.latched = false; }, T.estop);
      await settle(500);
    }
    await tap(T.box, 72, 60);
    await page.waitForTimeout(6500);
    check(!(await state(T.box, 'm.toggle.on')), 'phone: the useless machine switched itself off');
    // At rest after all that, the tally's drums read the count on its plaque.
    await settle(500);
    {
      const shown = await drumsShown();
      const digits = await state(T.tally, 'm.digits()');
      check(shown.reads === digits && shown.square.every(Boolean), `phone: the tally's drums read ${digits} at rest (${shown.reads}, square ${shown.square})`);
    }
    // Hammer everything with touch taps.
    for (let r = 0; r < 4; r++) for (let i = 0; i < 15; i++) await tap(i, 120, 90);
    await settle(1500);
    check(errors.length === 0, `phone: no errors after hammering (${errors.join('; ')})`);
    await context.close();
    return;
  }

  /* 1. Toggle: over-centre */
  {
    const a = await at(T.toggle, 120, 126);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    // drag up to just short of the centre (lever at -0.15): nothing
    await page.mouse.move(a.x, a.y - 34 * a.s, { steps: 10 });
    await page.waitForTimeout(50);
    check(!(await state(T.toggle, 'm.on')), 'toggle: short of centre, still off');
    check(Math.abs((await state(T.toggle, 'm.pos')) + 0.15) < 0.08, 'toggle: lever follows the finger');
    await page.mouse.move(a.x, a.y - 46 * a.s, { steps: 6 });
    await page.waitForTimeout(50);
    check(await state(T.toggle, 'm.on'), 'toggle: past the centre, on');
    let s = await sounds();
    check(s.filter((n) => n === 'snap').length === 1, `toggle: exactly one snap (${s})`);
    await page.mouse.up();
    await settle();
    check((await state(T.toggle, 'm.pos')) === 1, 'toggle: lever settles fully on');
    // released short of centre: comes back
    await drag(T.toggle, 120, 46, 120, 70);
    await settle();
    check((await state(T.toggle, 'm.on && m.pos === 1')), 'toggle: released short of centre it returns');
    s = await sounds();
    check(!s.includes('snap'), 'toggle: no snap for a drag that stays on one side');
    await tap(T.toggle, 120, 46);
    await settle();
    check(!(await state(T.toggle, 'm.on')), 'toggle: tap flips it off');
  }

  /* 2. Rotary: detents */
  {
    await sounds();
    // turn from position 1 around to about position 6
    const c = await at(T.rotary, 120, 92);
    const r = 50 * c.s;
    const a0 = (-105 * Math.PI) / 180;
    await page.mouse.move(c.x + r * Math.sin(a0), c.y - r * Math.cos(a0));
    await page.mouse.down();
    for (let k = 1; k <= 40; k++) {
      const a = a0 + (k / 40) * ((150 * Math.PI) / 180);
      await page.mouse.move(c.x + r * Math.sin(a), c.y - r * Math.cos(a));
      await page.waitForTimeout(5);
    }
    await page.mouse.up();
    await settle();
    const idx = await state(T.rotary, 'm.index');
    const s = await sounds();
    check(idx === 5, `rotary: 150 degrees of turning lands on position 6 (got position ${idx + 1})`);
    check(s.filter((n) => n === 'detent').length === 5, `rotary: five detents heard (${s})`);
    check(Math.abs((await state(T.rotary, 'm.pos - m.index * 30'))) < 1e-9, 'rotary: never rests between positions');
    await tap(T.rotary, 90, 92);
    await settle();
    check((await state(T.rotary, 'm.index')) === 4, 'rotary: tap on the left half goes back one');
  }

  /* 3. Lights */
  {
    const dark0 = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    await tap(T.lights, 120, 84);
    await settle();
    const dark1 = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    check(dark0 === false && dark1 === true, 'lights: the light switch turns the gallery dark');
    check((await page.evaluate(() => localStorage.getItem('oc-lights'))) === 'off', 'lights: remembered');
    const s = await sounds();
    check(s.includes('rocker'), 'lights: rocker sound');
    await tap(T.lights, 120, 84);
    await settle();
    check(!(await page.evaluate(() => document.documentElement.classList.contains('dark'))), 'lights: and back on');
  }

  /* 4. Loudspeakers */
  {
    await drag(T.sound, 168, 83, 60, 83);
    await settle();
    check((await state(T.sound, 'm.index')) === 0, 'sound: slid to OFF');
    check((await page.evaluate(() => localStorage.getItem('oc-sound'))) === '0', 'sound: remembered');
    await sounds();
    await tap(T.bell, 120, 74);
    await settle();
    // play() is still called; the level gate inside Sound mutes it. Make sure the gate is 0.
    await tap(T.sound, 168, 83);
    await tap(T.sound, 168, 83);
    await settle();
    check((await state(T.sound, 'm.index')) === 2, 'sound: two taps on the right bring it back to FULL');
  }

  /* 5. Bell push: momentary */
  {
    await sounds();
    const p = await at(T.bell, 120, 74);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.waitForTimeout(400);
    check(await state(T.bell, 'm.closed'), 'bell: closed while held');
    let s = await sounds();
    check(s.join() === 'down', `bell: only "down" while held (${s})`);
    await page.mouse.up();
    await settle();
    check(!(await state(T.bell, 'm.closed')), 'bell: open when let go');
    s = await sounds();
    check(s.join() === 'up', `bell: "up" on release (${s})`);
  }

  /* 6. Push-on push-off */
  {
    await sounds();
    await tap(T.latch, 120, 82);
    await settle();
    check(await state(T.latch, 'm.latched'), 'latch: first push latches');
    check(Math.abs((await state(T.latch, 'm.depth')) - 0.45) < 1e-9, 'latch: rests part way down');
    let s = await sounds();
    check(s[0] === 'click' && s.includes('latch'), `latch: click then latch (${s})`);
    await tap(T.latch, 120, 82);
    await settle();
    check(!(await state(T.latch, 'm.latched')), 'latch: second push releases');
  }

  /* 7. Any key */
  {
    await sounds();
    await tap(T.key, 120, 68);
    await settle();
    const s = await sounds();
    check(s.join() === 'keydown,bottom,keyup', `key: keydown, bottom, keyup (${s})`);
  }

  /* 8. DIP */
  {
    const before = await state(T.dip, 'm.toString()');
    await tap(T.dip, 58, 86);
    await settle(200);
    const after = await state(T.dip, 'm.toString()');
    check(before === '01011010' && after === '11011010', `dip: way 1 flipped (${before} -> ${after})`);
    const note = await page.locator('.note').nth(T.dip).textContent();
    check(note === 'Present setting: 11011010.', `dip: plaque updates (${note})`);
    // From the keyboard: Right chooses a way, Enter flips that way and no other,
    // Up puts it ON, Down OFF.
    await svgs.nth(T.dip).focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await settle(100);
    check((await state(T.dip, 'm.toString()')) === '11011010', 'dip keys: choosing a way flips nothing');
    check((await svgs.nth(T.dip).getAttribute('aria-label')).includes('way 3 selected'), 'dip keys: the chosen way is announced');
    const mark = await page.evaluate((i) => { const e = window.OpenCircuit.exhibits[i].svg.querySelector('.kbd-only'); return e ? getComputedStyle(e).opacity : 'missing'; }, T.dip);
    check(mark === '1', `dip keys: the chosen way is marked (opacity ${mark})`);
    await page.keyboard.press('Enter');
    check((await state(T.dip, 'm.toString()')) === '11111010', 'dip keys: Enter flips way 3 and only way 3');
    await page.keyboard.press('ArrowUp');
    check((await state(T.dip, 'm.toString()')) === '11111010', 'dip keys: Up on a way already ON leaves it');
    await page.keyboard.press('ArrowDown');
    check((await state(T.dip, 'm.toString()')) === '11011010', 'dip keys: Down puts it OFF');
  }

  /* 9. Pull chain */
  {
    await sounds();
    await drag(T.chain, 150, 126, 150, 150, 16); // a short pull
    await settle();
    let s = await sounds();
    check(!s.includes('clunk') && s.includes('tick'), `chain: a short pull ticks but changes nothing (${s})`);
    check(!(await state(T.chain, 'm.on')), 'chain: still off after a short pull');
    await drag(T.chain, 150, 126, 150, 200, 30, 500); // a full pull, hanging on
    await settle();
    s = await sounds();
    check(s.filter((n) => n === 'clunk').length === 1, `chain: exactly one clunk for a full pull (${s})`);
    check(await state(T.chain, 'm.on'), 'chain: ratchet advanced');
    check((await state(T.chain, 'm.pos')) === 0, 'chain: sprang back up');
    // Two full strokes without letting go: down, back up, down again.
    await sounds();
    const t0 = await state(T.tally, 'm.count');
    const top = await at(T.chain, 150, 126);
    const bottom = await at(T.chain, 150, 200);
    await page.mouse.move(top.x, top.y);
    await page.mouse.down();
    for (const p of [bottom, top, bottom]) {
      await page.mouse.move(p.x, p.y, { steps: 20 });
      await page.waitForTimeout(40);
    }
    await page.mouse.up();
    await settle();
    s = await sounds();
    check(s.filter((n) => n === 'clunk').length === 2 && (await state(T.chain, 'm.on')), `chain: two full strokes in one hold advance it twice (${s})`);
    const counted = (await state(T.tally, 'm.count')) - t0;
    check(counted === 2, `chain: the tally counts both strokes (+${counted})`);
  }

  /* 10. Knife */
  {
    await sounds();
    await drag(T.knife, 150, 40, 170, 100); // lower it to about a third open, let go
    await settle(1500);
    let s = await sounds();
    check(s.filter((n) => n === 'clack').length === 1 && (await state(T.knife, 'm.closed')), `knife: dropped on the lower half it falls home with one clack (${s})`);
    const counted = await state(T.tally, 'm.count');
    await tap(T.knife, 120, 80);
    await settle(1500);
    check(!(await state(T.knife, 'm.closed')) && (await state(T.knife, 'm.pos')) === 1, 'knife: tap throws it open');
    check((await state(T.tally, 'm.count')) === counted + 1, 'knife: throwing it open counts as one operation on the tally');
  }

  /* 11. Breaker */
  {
    await sounds();
    await tap(T.breaker, 145, 126); // TEST
    await settle();
    let s = await sounds();
    check(s.includes('trip') && (await state(T.breaker, "m.state === 'tripped'")), `breaker: TEST trips it (${s})`);
    await drag(T.breaker, 120, 78, 120, 40); // push toward ON
    await settle();
    s = await sounds();
    check(s.includes('refuse') && (await state(T.breaker, "m.state === 'tripped' && m.pos === 0.5")), `breaker: refuses to go ON, flops back (${s})`);
    await drag(T.breaker, 120, 78, 120, 120); // push fully OFF
    await settle();
    s = await sounds();
    check(s.includes('reset') && (await state(T.breaker, "m.state === 'off'")), `breaker: pushed OFF resets it (${s})`);
    await tap(T.breaker, 120, 78);
    await settle();
    check(await state(T.breaker, "m.state === 'on' && m.pos === 1"), 'breaker: and now it goes ON');
    // The same from the keyboard: Left is TEST, Up pushes toward ON, Down toward OFF.
    await svgs.nth(T.breaker).focus();
    await sounds();
    const press = async (key) => { await page.keyboard.press(key); await settle(250); return [await state(T.breaker, 'm.state'), await sounds()]; };
    let [st, ks] = await press('ArrowLeft');
    check(st === 'tripped' && ks.includes('trip'), `breaker keys: Left presses TEST and trips it (${st}; ${ks})`);
    [st, ks] = await press('ArrowUp');
    check(st === 'tripped' && ks.includes('refuse'), `breaker keys: Up on a tripped breaker is refused (${st}; ${ks})`);
    [st, ks] = await press('Enter');
    check(st === 'tripped', `breaker keys: Enter does not force it ON either (${st})`);
    [st, ks] = await press('ArrowDown');
    check(st === 'off' && ks.includes('reset'), `breaker keys: Down pushes it fully OFF and resets it (${st}; ${ks})`);
    check((await svgs.nth(T.breaker).getAttribute('aria-label')) === 'Miniature circuit breaker: off', 'breaker keys: announced as off');
    [st, ks] = await press('ArrowDown');
    check(st === 'off' && ks.length === 0, `breaker keys: Down on an OFF breaker leaves it OFF (${st}; ${ks})`);
    [st, ks] = await press('ArrowUp');
    check(st === 'on' && ks.includes('snap'), `breaker keys: Up switches it ON (${st}; ${ks})`);
    [st, ks] = await press('ArrowUp');
    check(st === 'on' && ks.length === 0, `breaker keys: Up on an ON breaker leaves it ON (${st}; ${ks})`);
    check((await state(T.breaker, 'm.pos')) === 1, 'breaker keys: lever at ON');
  }

  /* 12. Guarded toggle */
  {
    await sounds();
    await svgs.nth(T.guard).focus();
    await page.keyboard.press('ArrowUp'); // try to arm it through the cover
    await settle();
    let s = await sounds();
    check(s.join() === 'blocked' && !(await state(T.guard, 'm.toggle.on')), `guard: nothing moves under the cover (${s})`);
    await tap(T.guard, 120, 92); // the cover is in the way, so this tap lifts the cover
    await settle();
    check(await state(T.guard, 'm.coverOpen && m.cover === 1'), 'guard: tapping the cover lifts it');
    await tap(T.guard, 120, 92); // now the lever is exposed
    await settle();
    check(await state(T.guard, 'm.toggle.on'), 'guard: with the cover up the toggle arms');
    await sounds();
    await tap(T.guard, 120, 14); // the open cover stands above the hinge; tap it down
    await settle();
    s = await sounds();
    check(!(await state(T.guard, 'm.coverOpen')) && !(await state(T.guard, 'm.toggle.on')) && s.includes('drop') && s.includes('snap'), `guard: closing the cover forces it off (${s})`);
    // a cover dragged only part way falls shut again
    await drag(T.guard, 120, 100, 120, 80);
    await settle();
    check(!(await state(T.guard, 'm.coverOpen')) && (await state(T.guard, 'm.cover === 0')), 'guard: a cover dragged less than half way falls shut');
    // lift it fully by dragging, then drag the lever itself across centre
    await drag(T.guard, 120, 110, 120, 30);
    await settle();
    check(await state(T.guard, 'm.coverOpen'), 'guard: a cover dragged most of the way up stays up');
    await sounds();
    await drag(T.guard, 120, 126, 120, 50);
    await settle();
    s = await sounds();
    check((await state(T.guard, 'm.toggle.on && m.toggle.pos === 1')) && s.join() === 'snap', `guard: dragging the lever arms it with one snap (${s})`);
    // Armed, then the cover is dragged shut and held there: the switch goes OFF
    // as the cover comes down, before it is let go.
    await sounds();
    const c0 = await at(T.guard, 120, 14);
    const c1 = await at(T.guard, 120, 110);
    await page.mouse.move(c0.x, c0.y);
    await page.mouse.down();
    await page.mouse.move(c1.x, c1.y, { steps: 20 });
    await page.waitForTimeout(100);
    s = await sounds();
    check(!(await state(T.guard, 'm.toggle.on')) && !(await state(T.guard, 'm.coverOpen')) && s.includes('drop') && s.includes('snap'), `guard: a cover held shut has already forced the switch OFF (${s})`);
    check((await svgs.nth(T.guard).getAttribute('aria-label')) === 'Guarded toggle: cover down, safe', 'guard: and says so while held');
    await page.mouse.up();
    await settle();
    s = await sounds();
    check(!s.includes('snap') && (await state(T.guard, 'm.cover === 0')), `guard: letting go changes nothing more (${s})`);
    // From the keyboard: Right lifts the cover, but Up cannot arm the switch
    // until the cover is actually up.
    await keysNow(T.guard, ['ArrowRight', 'ArrowUp']);
    check((await state(T.guard, 'm.coverOpen && !m.toggle.on')), 'guard keys: Up straight after Right is blocked while the cover is still down');
    await settle();
    await page.keyboard.press('ArrowUp');
    await settle(300);
    check(await state(T.guard, 'm.toggle.on'), 'guard keys: with the cover up, Up arms it');
    await page.keyboard.press('ArrowLeft');
    await settle();
    check(!(await state(T.guard, 'm.toggle.on')) && !(await state(T.guard, 'm.coverOpen')), 'guard keys: closing the cover forces it OFF');
  }

  /* 13. E-stop */
  {
    await sounds();
    await tap(T.estop, 120, 88);
    await settle();
    check((await state(T.estop, 'm.latched')) && (await sounds()).includes('thunk'), 'estop: push latches with a thunk');
    await drag(T.estop, 110, 88, 130, 88, 10); // a small twist: 15 degrees
    await settle();
    check(await state(T.estop, 'm.latched'), 'estop: a small twist does not release it');
    await drag(T.estop, 100, 88, 160, 88, 20);
    await settle();
    const s = await sounds();
    check(!(await state(T.estop, 'm.latched')) && s.includes('pop') && (await state(T.estop, 'm.depth')) === 0, `estop: a full twist pops it up (${s})`);
    // A deliberate press-and-hold latches it, on the push.
    const p = await at(T.estop, 120, 88);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.waitForTimeout(600);
    check((await state(T.estop, 'm.latched')) && (await sounds()).includes('thunk'), 'estop: pressed and held, it latches with a thunk before it is let go');
    await page.mouse.up();
    await settle();
    check(await state(T.estop, 'm.latched'), 'estop: and stays latched after a 0.6 s hold');
    // Pressed again while latched: a dead push, nothing changes.
    await tap(T.estop, 120, 88);
    await settle();
    check((await state(T.estop, 'm.latched')) && (await sounds()).includes('dead'), 'estop: pushing a latched head does nothing');
    await drag(T.estop, 100, 88, 160, 88, 20);
    await settle();
    check(!(await state(T.estop, 'm.latched')), 'estop: twisted free again');
    // A quick press whose finger drifts 6 px still latches it.
    await sounds();
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x + 6, p.y + 1, { steps: 3 });
    await page.mouse.up();
    await settle();
    check((await state(T.estop, 'm.latched')) && (await sounds()).includes('thunk'), 'estop: a press that drifts 6 px latches it');
    await drag(T.estop, 100, 88, 160, 88, 20);
    await settle();
  }

  /* 14. Useless machine */
  {
    await sounds();
    await tap(T.box, 72, 60);
    check(await state(T.box, 'm.toggle.on'), 'box: switched on');
    let off = false;
    for (let t = 0; t < 70 && !off; t++) {
      await page.waitForTimeout(100);
      off = !(await state(T.box, 'm.toggle.on'));
    }
    check(off, 'box: switched itself off within 7 s');
    await settle(2500);
    const s = await sounds();
    check(s.includes('motor') && s.includes('snap'), `box: motor heard, then a snap (${s})`);
    check((await state(T.box, 'm.lid === 0 && m.arm === 0 && m.flips === 1')), 'box: lid shut, arm in, one flip');
    const note = await page.locator('.note').nth(T.box).textContent();
    check(note === 'It has switched itself off 1 time this visit.', `box: plaque notes it (${note})`);
    // provoke it by grabbing the lever where it is drawn (switched off, its ball
    // hangs over the front of the box), dragging it slowly across centre, and
    // keeping hold. In its 'instant' mood the arm may already have snatched it
    // back by the time we look, so a second flip also counts as provoked.
    await sounds();
    const a = await at(T.box, 72, 98);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x, a.y - 34 * a.s, { steps: 12 });
    await page.waitForTimeout(50);
    check((await state(T.box, 'm.active && (m.toggle.on || m.flips === 2)')), 'box: a slow drag past centre provokes it');
    await page.mouse.up();
    off = false;
    for (let t = 0; t < 70 && !off; t++) {
      await page.waitForTimeout(100);
      off = !(await state(T.box, 'm.toggle.on'));
    }
    check(off && Number.isFinite(await state(T.box, 'm.toggle.pos')), 'box: and it switches that off too');
    await settle(3000);
  }

  /* 15. Tally */
  {
    const count = await state(T.tally, 'm.count');
    check(count > 20, `tally: has been counting (${count})`);
    await sounds();
    await tap(T.tally, 122, 56);
    await settle();
    check((await state(T.tally, 'm.count')) === count + 1 && (await sounds()).includes('tally'), 'tally: its own press counts once, with a click');
    const note = await page.locator('.note').nth(T.tally).textContent();
    check(note === `Operations so far: ${String(count + 1).padStart(4, '0')}.`, `tally: plaque reads the count (${note})`);
    // The drums themselves, read from the drawing, agree with the plaque at rest.
    let shown = await drumsShown();
    check(shown.reads === String(count + 1).padStart(4, '0') && shown.square.every(Boolean), `tally: the drums read ${String(count + 1).padStart(4, '0')} at rest (${shown.reads}, square ${shown.square})`);
    // At rest, every count reads true with every drum square.
    const wrong = [];
    for (const n of [0, 7, 9, 15, 58, 95, 100, 999, 1009, 1099, 4321, 5050, 8765, 9990, 9999]) {
      await setTally(n);
      shown = await drumsShown();
      if (shown.reads !== String(n).padStart(4, '0') || !shown.square.every(Boolean)) wrong.push(`${n}: ${shown.reads} ${shown.square}`);
    }
    check(wrong.length === 0, `tally: every test count reads true at rest (${wrong.join('; ')})`);
    // Mid-roll: only the drums being carried are between digits.
    await setTally(1099.5);
    shown = await drumsShown();
    check(shown.reads[0] === '1' && shown.square.join() === 'true,false,false,false', `tally: from 1099 to 1100 the thousands drum stays put while the others carry (${shown.reads} ${shown.square})`);
    await setTally(1234.5);
    shown = await drumsShown();
    check(shown.reads.slice(0, 3) === '123' && shown.square.join() === 'true,true,true,false', `tally: from 1234 to 1235 only the units drum turns (${shown.reads} ${shown.square})`);
    await setTally(count + 1);
  }

  /* keyboard */
  {
    await svgs.nth(T.toggle).focus();
    await page.keyboard.press('Enter');
    await settle();
    check(await state(T.toggle, 'm.on'), 'keys: Enter flips the focused toggle');
    await page.keyboard.press('ArrowDown');
    await settle();
    check(!(await state(T.toggle, 'm.on')), 'keys: ArrowDown turns it off');
    await svgs.nth(T.rotary).focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await settle();
    check((await state(T.rotary, 'm.index')) === 6, 'keys: arrows turn the knob');
  }

  /* the loop sleeps */
  {
    await settle(2500);
    check(!(await page.evaluate(() => window.OpenCircuit.running())), 'loop: animation loop sleeps when nothing moves');
  }

  /* a bored visitor */
  {
    await sounds();
    for (let r = 0; r < 6; r++) for (let i = 0; i < 15; i++) await tap(i, 120, 90);
    for (let r = 0; r < 20; r++) await tap(T.toggle, 120, 86);
    // hold things and resize in the middle
    const a = await at(T.toggle, 120, 126);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x, a.y - 30, { steps: 5 });
    await page.setViewportSize({ width: 700, height: 900 });
    await page.mouse.move(a.x + 10, a.y - 40, { steps: 5 });
    await page.mouse.up();
    await page.setViewportSize({ width: 1280, height: 800 });
    // the tab goes into the background and comes back
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await settle(1000);
    // hammer the useless machine while it is working
    for (let r = 0; r < 12; r++) {
      await tap(T.box, 72, 60);
      await page.waitForTimeout(150);
    }
    await settle(8000);
    check(!(await state(T.box, 'm.toggle.on')), 'bored: the machine still wins');
    check((await state(T.box, 'm.lid === 0 && m.arm === 0')), 'bored: and tidies up');
    check(errors.length === 0, `bored: no errors (${errors.join('; ')})`);
    check(!(await page.evaluate(() => window.OpenCircuit.running())), 'bored: loop asleep again');
  }

  /* reduced motion */
  {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await sounds();
    await tap(T.toggle, 120, 86);
    await page.waitForTimeout(80);
    check(Math.abs(await state(T.toggle, 'm.pos')) === 1, 'reduced motion: the lever jumps straight to its end');
    await tap(T.bell, 120, 74);
    await settle();
    const s = await sounds();
    check(s.includes('down') && s.includes('up'), `reduced motion: the bell still sounds (${s})`);
    await tap(T.box, 72, 60);
    await page.waitForTimeout(7000);
    check(!(await state(T.box, 'm.toggle.on')) && (await state(T.box, 'm.arm === 0')), 'reduced motion: the machine still switches itself off');
    check(errors.length === 0, `reduced motion: no errors (${errors.join('; ')})`);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  }

  check(errors.length === 0, `no console errors or uncaught exceptions (${errors.join('; ')})`);
  await context.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
