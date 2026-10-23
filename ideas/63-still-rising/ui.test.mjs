// Drives the real page in headless Chromium, when Playwright is installed (skips otherwise).
// Run from the repo root: node --test ideas/63-still-rising/ui.test.mjs
//
// The module tests call the grader and the feedback directly; these check that the page
// passes the answer on. They pin a bug the second check of the revision found: the grader
// returns 'flat' for a nearly flat line, and the page treated every result other than
// 'graded' as too short, so a flat line drawn right across the chart was never marked
// (a toast said "Draw across more of the chart first." under "Ready to check.").
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const Tub = require('./tub.js');
const Bank = require('./bank.js');
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

let browserP = null;
const browser = () => (browserP ||= pw.chromium.launch());
test.after(async () => {
  if (browserP) await (await browserP).close();
});

const DESK = { name: 'desktop', viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' };
const PHONE = { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' };

// Opens the page on a given sketch exercise, as the third rung would ask it.
async function openSketch(ctx, id) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(URL_);
  await page.evaluate((id) => {
    const st = { v: 1, q: 9, seen: {}, box: {}, last: {}, streak: {}, cleared: { 1: true, 2: true }, stats: {}, sinceReview: 0, gen: 1, lastRungAt: {}, cold: { id: 'shop', ok: false }, twin: null, log: [], current: { id, mode: 'ladder', rung: 3 } };
    localStorage.setItem('still-rising-v1', JSON.stringify(st));
  }, id);
  await page.reload();
  const start = await page.$('#startBtn');
  if (start && (await start.isVisible())) await start.click();
  await page.waitForSelector('.drawpad');
  return { page, errors };
}

// Draws a piecewise-linear line [[time, level], ...] across the level panel, with the
// mouse or, on a phone, as one finger stroke sent as touch events.
async function draw(ctx, page, id, line, touch) {
  const pts = await page.evaluate(
    ({ id, line }) => {
      const it = window.TubBank.byId[id];
      const f = (t) => {
        if (t <= line[0][0]) return line[0][1];
        for (let i = 1; i < line.length; i++) if (t <= line[i][0]) return line[i - 1][1] + ((line[i][1] - line[i - 1][1]) * (t - line[i - 1][0])) / (line[i][0] - line[i - 1][0]);
        return line[line.length - 1][1];
      };
      const r = document.querySelector('.drawpad').getBoundingClientRect();
      const svg = document.querySelector('#chart svg');
      const sc = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
      const [lo, hi] = window.Tub.stockAxis(it);
      const pw = r.width - 12 * sc;
      const ph = r.height - 12 * sc;
      const a = line[0][0];
      const b = line[line.length - 1][0];
      const out = [];
      for (let i = 0; i <= 60; i++) {
        const t = a + ((b - a) * i) / 60;
        out.push({ x: r.left + 6 * sc + ((t - it.time.from) / (it.time.to - it.time.from)) * pw, y: r.top + 6 * sc + ph - ((f(t) - lo) / (hi - lo)) * ph });
      }
      return out;
    },
    { id, line }
  );
  if (touch) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pts[0]] });
    for (const p of pts.slice(1)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [p] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse.move(pts[0].x, pts[0].y);
    await page.mouse.down();
    for (const p of pts.slice(1)) await page.mouse.move(p.x, p.y);
    await page.mouse.up();
  }
}

const state = (page) =>
  page.evaluate(() => ({
    hint: document.getElementById('chartHint').textContent,
    check: !document.getElementById('checkBtn').disabled,
    toast: document.getElementById('toast').classList.contains('show') ? document.getElementById('toast').textContent : '',
    shown: !document.getElementById('feedback').hidden,
    feedback: document.getElementById('feedback').innerText.replace(/\s+/g, ' '),
    bands: document.querySelectorAll('#chart .acceptband').length,
  }));

for (const opts of [DESK, PHONE]) {
  test(`Draw it in the page (${opts.name}): a flat or nearly flat line right across the chart is marked wrong, and says so`, { skip, timeout: 120000 }, async () => {
    const ctx = await (await browser()).newContext(opts);
    try {
      const cases = [
        // [exercise, line drawn, what it is]
        ['debt', [[0, 600], [20, 600]], 'a flat line'],
        ['debt', [[0, 600], [13, 660], [20, 650]], 'a hump 3% of the panel high'],
        ['savings', [[0, 2000], [24, 2000]], 'a flat line'],
      ];
      for (const [id, line, what] of cases) {
        const { page, errors } = await openSketch(ctx, id);
        await draw(ctx, page, id, line, !!opts.hasTouch);
        const before = await state(page);
        assert.ok(before.check && /Ready to check/.test(before.hint), `${id}, ${what}: the page should be ready to check (${before.hint})`);
        await page.click('#checkBtn');
        await page.waitForTimeout(300);
        const after = await state(page);
        assert.equal(after.toast, '', `${id}, ${what}: sent back with "${after.toast}" instead of being marked`);
        assert.ok(after.shown, `${id}, ${what}: no feedback`);
        assert.match(after.feedback, /Not this time\./, `${id}, ${what}`);
        assert.match(after.feedback, /Your line is nearly flat/, `${id}, ${what}`);
        assert.ok(after.bands >= 1, `${id}, ${what}: the bands where the level turns should be shaded`);
        assert.deepEqual(errors, []);
        await page.close();
      }
    } finally {
      await ctx.close();
    }
  });

  test(`Draw it in the page (${opts.name}): the true shape passes, and a line across half the chart cannot be checked yet`, { skip, timeout: 120000 }, async () => {
    const ctx = await (await browser()).newContext(opts);
    try {
      let { page, errors } = await openSketch(ctx, 'debt');
      await draw(ctx, page, 'debt', Tub.stockCurve(Bank.byId.debt, 40), !!opts.hasTouch);
      await page.click('#checkBtn');
      await page.waitForTimeout(300);
      const ok = await state(page);
      assert.ok(ok.shown && /Right\./.test(ok.feedback), ok.feedback);
      assert.deepEqual(errors, []);
      await page.close();
      ({ page, errors } = await openSketch(ctx, 'debt'));
      await draw(ctx, page, 'debt', [[0, 600], [10, 1300]], !!opts.hasTouch);
      const half = await state(page);
      assert.ok(!half.check, 'Check should wait until the line reaches across the chart');
      assert.match(half.hint, /of the way so far/);
      assert.ok(!half.shown);
      assert.deepEqual(errors, []);
      await page.close();
    } finally {
      await ctx.close();
    }
  });
}
