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
    await tap(T.box, 72, 60);
    await page.waitForTimeout(6500);
    check(!(await state(T.box, 'm.toggle.on')), 'phone: the useless machine switched itself off');
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
    await tap(T.guard, 120, 14);
    await settle();
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
