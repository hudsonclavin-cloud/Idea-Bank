#!/usr/bin/env node
// Drives the page in headless Chromium (the globally installed Playwright that tools/smoke.mjs
// uses): the downloaded STLs are byte-for-byte the committed ones, keys, buttons and dragging turn
// the machine, a body change re-cuts the wheels, and with reduced motion "Turn steadily" moves one
// dot at a time instead of continuously. Not part of `node --test` because it needs a browser.
//   node ideas/73-kepler-pair/ui-check.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'noop.js'))('playwright');
const url = pathToFileURL(path.join(here, 'index.html')).href;
let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};
const ready = (p) => p.waitForFunction(() => !/Cutting/.test(document.getElementById('cut-status').textContent), null, { timeout: 15000 });
const now = (p) => p.evaluate(() => +document.getElementById('machine').getAttribute('aria-valuenow'));

const browser = await chromium.launch();
try {
  // downloads, keys, buttons, dragging, a body change
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await p.goto(url);
    await ready(p);
    const files = { coupon: 'coupon.stl', base: 'default.stl', time: 'default-time-wheel.stl', kepler: 'default-kepler-wheel.stl' };
    for (const [part, file] of Object.entries(files)) {
      const [dl] = await Promise.all([p.waitForEvent('download'), p.click(`.downloads button[data-part=${part}]`)]);
      const got = fs.readFileSync(await dl.path());
      check(Buffer.compare(got, fs.readFileSync(path.join(here, file))) === 0, `download "${part}" (${dl.suggestedFilename()}) is byte-identical to ${file}`);
    }
    await p.focus('#machine');
    for (let i = 0; i < 5; i++) await p.keyboard.press('PageUp');
    await p.waitForTimeout(900);
    check(Math.abs((await now(p)) - 20) < 0.051, `PageUp x5 turns five dots: day ${await now(p)} (5 x 4.0 days)`);
    await p.keyboard.press('End');
    await p.waitForTimeout(900);
    check(Math.abs((await now(p)) - 44) < 0.051, `End goes to aphelion, half an orbit: day ${await now(p)}`);
    await p.keyboard.press('Home');
    await p.waitForTimeout(900);
    check((await now(p)) === 0, 'Home goes back to perihelion');
    for (let i = 0; i < 3; i++) await p.click('#fwd');
    await p.waitForTimeout(700);
    check(Math.abs((await now(p)) - 12) < 0.051, `three quick taps on "one dot" land on dot 3: day ${await now(p)}`);
    // drag the knob's wheel a quarter turn clockwise
    await p.focus('#machine');
    await p.keyboard.press('Home');
    await p.waitForTimeout(900);
    const box = await p.locator('#machine').boundingBox();
    const toPx = await p.evaluate(() => {
      const svg = document.getElementById('machine');
      const m = svg.querySelector('g').getScreenCTM();
      const pt = (x, y) => {
        const q = svg.createSVGPoint();
        q.x = x;
        q.y = y;
        const r = q.matrixTransform(m);
        return [r.x, r.y];
      };
      return [pt(-70, 30), pt(-70 + 30 * Math.sin(Math.PI / 4), 30 * Math.cos(Math.PI / 4)), pt(-40, 0)];
    });
    check(!!box, 'machine is on screen');
    await p.mouse.move(...toPx[0]);
    await p.mouse.down();
    await p.mouse.move(...toPx[1], { steps: 8 });
    await p.mouse.move(...toPx[2], { steps: 8 });
    await p.mouse.up();
    check(Math.abs((await now(p)) - 22) < 0.3, `dragging the time wheel a quarter turn clockwise is a quarter orbit: day ${await now(p)}`);
    await p.check('input[name=body][value=mars]');
    await p.waitForFunction(() => /^Mars/.test(document.getElementById('cut-status').textContent), null, { timeout: 15000 });
    const status = await p.textContent('#cut-status');
    const range = await p.evaluate(() => [document.getElementById('size').min, document.getElementById('size').max]);
    check(/Mars/.test(status) && range[0] === '56' && range[1] === '76', `choosing Mars re-cuts the wheels (${status}; sizes ${range.join('-')} mm)`);
    // the stats say how far inside its boss the Kepler wheel's centre of mass sits; Pluto's needs a counterweight
    await p.check('input[name=body][value=pluto]');
    await p.waitForFunction(() => /^Pluto/.test(document.getElementById('cut-status').textContent), null, { timeout: 15000 });
    const balance = await p.evaluate(() => [...document.querySelectorAll('#stats div')].map((d) => d.textContent).find((t) => /^Balance/.test(t)) || '');
    const inside = +((balance.match(/([\d.]+) mm inside the boss/) || [])[1] || 0);
    check(inside >= 1.5 && /counterweight [\d.]+ mm tall/.test(balance), `Pluto's stats give the Kepler wheel's balance (${balance})`);
    check(errors.length === 0, `no page errors (${errors.join('; ')})`);
    await ctx.close();
  }
  // reduced motion: one dot at a time, never continuous
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', isMobile: true, hasTouch: true });
    const p = await ctx.newPage();
    await p.goto(url);
    await ready(p);
    await p.click('#run');
    const seen = [];
    for (let i = 0; i < 40; i++) {
      seen.push(await now(p));
      await p.waitForTimeout(100);
    }
    await p.click('#run');
    const distinct = [...new Set(seen)];
    check(distinct.every((v) => Math.abs(v / 4 - Math.round(v / 4)) < 0.03), `with reduced motion the machine only ever rests on dots (${distinct.join(', ')})`);
    check(distinct.length >= 2 && distinct.length <= 4, `and moves about once every 1.5 s (${distinct.length} positions in 4 s)`);
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    check(overflow <= 0, 'no sideways scroll at 390 px');
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
