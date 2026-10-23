// Drives the page in headless Chromium, when Playwright is installed (skips otherwise).
// Run from the repo root: node --test ideas/54-smaller-every-cut/ui.test.mjs
//
// The flash check measures the rendered picture itself; see measureFlashes below.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const H = require('./hydra.js');
const DIR = path.dirname(fileURLToPath(import.meta.url));
const URL_ = pathToFileURL(path.join(DIR, 'index.html')).href;

function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    try {
      const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
      return createRequire(path.join(root, 'noop.js'))('playwright');
    } catch {
      return null;
    }
  }
}
const pw = loadPlaywright();
const skip = pw ? false : 'Playwright is not installed';

async function withPage(opts, fn) {
  const browser = await pw.chromium.launch();
  try {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(URL_);
    await page.waitForTimeout(300);
    await fn(page);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
}

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

test('tapping heads on a phone plays the rules, and the clock falls at every cut', { skip, timeout: 60000 }, async () => {
  await withPage(PHONE, async (page) => {
    for (let k = 0; k < 3; k++) {
      const pt = await page.evaluate(() => window.__hydraDebug.headPoint(0));
      await page.touchscreen.tap(pt.x, pt.y);
      await page.waitForTimeout(500);
    }
    const st = await page.evaluate(() => window.__hydraDebug.state());
    assert.equal(st.cuts, 3);
    assert.equal(st.clock, 'w*2+4');
    assert.deepEqual(st.trail, ['w^(w)', 'w^2', 'w*3', 'w*2+4']);
    for (let i = 1; i < st.trail.length; i++) assert.ok(H.cmp(H.parse(st.trail[i]), H.parse(st.trail[i - 1])) < 0);
    // keep cutting until it dies; the Stick always dies within 20 to 37 cuts
    for (let k = 0; k < 40; k++) {
      const pt = await page.evaluate(() => window.__hydraDebug.headPoint(1));
      if (!pt) break;
      await page.touchscreen.tap(pt.x, pt.y);
      await page.waitForTimeout(80);
    }
    const end = await page.evaluate(() => window.__hydraDebug.state());
    assert.equal(end.clock, '0');
    assert.ok(end.cuts >= 20 && end.cuts <= 37, `died after ${end.cuts}`);
    for (let i = 1; i < end.trail.length; i++) assert.ok(H.cmp(H.parse(end.trail[i]), H.parse(end.trail[i - 1])) < 0);
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(width <= 390);
  });
});

test('reduced motion: a cut shows its result at once, with no animation', { skip, timeout: 60000 }, async () => {
  await withPage({ ...PHONE, reducedMotion: 'reduce' }, async (page) => {
    const pt = await page.evaluate(() => window.__hydraDebug.headPoint(0));
    await page.touchscreen.tap(pt.x, pt.y);
    assert.equal(await page.evaluate(() => window.__hydraDebug.animating()), false);
    assert.equal((await page.evaluate(() => window.__hydraDebug.state())).clock, 'w^2');
  });
});

// WCAG 2.3.1 (general flash threshold): a flash is a pair of opposing changes in relative
// luminance of 0.1 or more; content fails if it flashes more than three times in any one
// second over a combined area of at least 0.006 sr, which WCAG approximates as a 341 x 256 px
// rectangle at 1024 x 768. On every animation frame this reads the hydra canvas and averages
// relative luminance over two grids: a fine one (cells about 10 x 12 px) and a coarse one
// (4 x 4 cells, each about a quarter of that rectangle). It returns, for each grid, the most
// flashes any cell made in any one-second window, and for the fine grid the total area of the
// cells that ever went over three.
async function measureFlashes(page, ms) {
  return page.evaluate(async (ms) => {
    const cv = document.getElementById('hydra');
    const rect = cv.getBoundingClientRect();
    const lin = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const c = i / 255;
      lin[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }
    const ctx = cv.getContext('2d');
    const grids = [
      { gx: 64, gy: 48 },
      { gx: 4, gy: 4 },
    ].map((g) => {
      const n = g.gx * g.gy;
      return { ...g, n, anchor: new Float32Array(n).fill(NaN), dir: new Int8Array(n), events: Array.from({ length: n }, () => []) };
    });
    let frames = 0;
    const t0 = performance.now();
    await new Promise((resolve) => {
      function frame(now) {
        const w = cv.width;
        const h = cv.height;
        const data = ctx.getImageData(0, 0, w, h).data;
        const sums = grids.map((g) => ({ s: new Float64Array(g.n), c: new Float64Array(g.n) }));
        for (let y = 0; y < h; y += 2) {
          for (let x = 0; x < w; x += 2) {
            const o = (y * w + x) * 4;
            const a = data[o + 3] / 255;
            // transparent canvas pixels show the stage colour behind (relative luminance about 0.77)
            const L = a * (0.2126 * lin[data[o]] + 0.7152 * lin[data[o + 1]] + 0.0722 * lin[data[o + 2]]) + (1 - a) * 0.77;
            grids.forEach((g, gi) => {
              const k = Math.min(g.gy - 1, Math.floor((y * g.gy) / h)) * g.gx + Math.min(g.gx - 1, Math.floor((x * g.gx) / w));
              sums[gi].s[k] += L;
              sums[gi].c[k] += 1;
            });
          }
        }
        grids.forEach((g, gi) => {
          for (let k = 0; k < g.n; k++) {
            const L = sums[gi].s[k] / sums[gi].c[k];
            if (Number.isNaN(g.anchor[k])) g.anchor[k] = L;
            const d = L - g.anchor[k];
            if (Math.abs(d) >= 0.1) {
              const sgn = Math.sign(d);
              if (g.dir[k] !== 0 && sgn !== g.dir[k]) g.events[k].push(now);
              g.dir[k] = sgn;
              g.anchor[k] = L;
            } else if ((g.dir[k] > 0 && L > g.anchor[k]) || (g.dir[k] < 0 && L < g.anchor[k])) g.anchor[k] = L;
          }
        });
        frames++;
        if (now - t0 < ms) requestAnimationFrame(frame);
        else resolve();
      }
      requestAnimationFrame(frame);
    });
    const worstOf = (ev) => {
      let worst = ev.length ? 0.5 : 0;
      for (let i = 0; i < ev.length; i++) {
        let j = i;
        while (j < ev.length && ev[j] - ev[i] < 1000) j++;
        worst = Math.max(worst, (j - i + 1) / 2); // reversals in the window, plus the change that opened it
      }
      return worst;
    };
    const [fine, coarse] = grids;
    const fineWorst = fine.events.map(worstOf);
    const cellArea = (rect.width / fine.gx) * (rect.height / fine.gy);
    return {
      fps: (frames * 1000) / (performance.now() - t0),
      fineMax: Math.max(...fineWorst),
      flaggedArea: fineWorst.filter((f) => f > 3).length * cellArea,
      coarseMax: Math.max(...coarse.events.map(worstOf)),
    };
  }, ms);
}

// A quarter of WCAG's 341 x 256 px rectangle: the flagged fine cells must stay under this.
const AREA_LIMIT = (341 * 256) / 4;

test('flash check: Hercules playing as fast as he can, and at 2 cuts a second', { skip, timeout: 120000 }, async () => {
  await withPage({ viewport: { width: 1280, height: 900 } }, async (page) => {
    const results = {};
    for (const [label, preset, speed, button] of [
      ['as fast as it can, slow way, tall stick', 'tall', '0', '#autoSlow'],
      ['as fast as it can, fast way, tall stick', 'tall', '0', '#autoFast'],
      ['2 cuts a second, fast way, two sticks', 'twosticks', '2', '#autoFast'],
      ['2 cuts a second, slow way, tall stick', 'tall', '2', '#autoSlow'],
    ]) {
      await page.click(`[data-preset=${preset}]`);
      await page.selectOption('#speed', speed);
      await page.click(button);
      const r = await measureFlashes(page, 4000);
      if (await page.evaluate(() => window.__hydraDebug.state().auto)) await page.click(button);
      results[label] = r;
      assert.ok(r.fps >= 15, `${label}: sampled at ${r.fps.toFixed(1)} frames a second`);
      assert.ok(r.coarseMax <= 3, `${label}: a quarter-size region flashed ${r.coarseMax} times in a second`);
      assert.ok(r.flaggedArea < AREA_LIMIT, `${label}: ${Math.round(r.flaggedArea)} px² of small cells went over 3 a second`);
    }
    for (const [k, r] of Object.entries(results)) {
      console.log(`flash check, ${k}: regions ${r.coarseMax}/s; small cells worst ${r.fineMax}/s over ${Math.round(r.flaggedArea)} px²; ${r.fps.toFixed(0)} fps`);
    }
  });
});

test('grow your own: sprouting raises the clock, fighting it lowers it', { skip, timeout: 60000 }, async () => {
  await withPage({ viewport: { width: 1280, height: 900 } }, async (page) => {
    await page.click('[data-preset=grow]');
    const readings = [];
    for (let k = 0; k < 5; k++) {
      const pt = await page.evaluate((k) => window.__hydraDebug.anyPoint(k), k);
      await page.mouse.click(pt.x, pt.y);
      await page.waitForTimeout(450);
      readings.push((await page.evaluate(() => window.__hydraDebug.state())).clock);
    }
    for (let i = 1; i < readings.length; i++) assert.ok(H.cmp(H.parse(readings[i]), H.parse(readings[i - 1])) > 0);
    await page.click('#growFight');
    const pt = await page.evaluate(() => window.__hydraDebug.headPoint(0));
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(450);
    const st = await page.evaluate(() => window.__hydraDebug.state());
    assert.equal(st.mode, 'play');
    assert.ok(H.cmp(H.parse(st.trail[1]), H.parse(st.trail[0])) < 0);
    const facts = await page.evaluate(() => document.getElementById('facts').innerText);
    assert.match(facts, /This hydra/);
  });
});
