// Drives the page in headless Chromium, when Playwright is installed (skips otherwise).
// Run from the repo root: node --test ideas/64-smaller-every-cut/ui.test.mjs
//
// The flash checks measure the rendered picture itself, pixel by pixel; see measureFlashes.
// The safety rule they pin: whatever the input (taps, clicks, held or repeated keys, buttons,
// Hercules), the hydra picture is replaced at most twice a second.
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

let browserP = null;
const browser = () => (browserP ||= pw.chromium.launch());
test.after(async () => {
  if (browserP) await (await browserP).close();
});

async function withPage(opts, fn) {
  const ctx = await (await browser()).newContext(opts);
  try {
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(URL_);
    await ready(page);
    await fn(page);
    assert.deepEqual(errors, []);
  } finally {
    await ctx.close();
  }
}

// Wait until a new cut would show at once (the picture last changed at least half a second ago).
const ready = (page) => page.waitForFunction(() => window.__hydraDebug.ready(), null, { timeout: 5000 });

// The shortest time between two replacements of the picture, in ms.
async function minGap(page) {
  const t = await page.evaluate(() => window.__hydraDebug.changes());
  let g = Infinity;
  for (let i = 1; i < t.length; i++) g = Math.min(g, t[i] - t[i - 1]);
  return { gap: g, changes: t.length };
}

const DESK = { viewport: { width: 1280, height: 800 } };
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

test('tapping heads on a phone plays the rules, and the clock falls at every cut', { skip, timeout: 90000 }, async () => {
  await withPage(PHONE, async (page) => {
    for (let k = 0; k < 3; k++) {
      await ready(page);
      const pt = await page.evaluate(() => window.__hydraDebug.headPoint(0));
      await page.touchscreen.tap(pt.x, pt.y);
    }
    await ready(page);
    const st = await page.evaluate(() => window.__hydraDebug.state());
    assert.equal(st.cuts, 3);
    assert.equal(st.clock, 'w*2+4');
    assert.deepEqual(st.trail, ['w^(w)', 'w^2', 'w*3', 'w*2+4']);
    for (let i = 1; i < st.trail.length; i++) assert.ok(H.cmp(H.parse(st.trail[i]), H.parse(st.trail[i - 1])) < 0);
    // Now tap fast, about 12 times a second, until it dies: the hydra takes a cut at most
    // twice a second, and the Stick still dies within 20 to 37 cuts.
    const t0 = Date.now();
    while (Date.now() - t0 < 40000) {
      const pt = await page.evaluate(() => window.__hydraDebug.headPoint(1));
      if (!pt) break;
      await page.touchscreen.tap(pt.x, pt.y);
      await page.waitForTimeout(80);
    }
    const end = await page.evaluate(() => window.__hydraDebug.state());
    assert.equal(end.clock, '0');
    assert.ok(end.cuts >= 20 && end.cuts <= 37, `died after ${end.cuts}`);
    for (let i = 1; i < end.trail.length; i++) assert.ok(H.cmp(H.parse(end.trail[i]), H.parse(end.trail[i - 1])) < 0);
    const { gap } = await minGap(page);
    assert.ok(gap >= 499, `the picture changed twice within ${gap} ms`);
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
// luminance of 0.1 or more, where the darker state is below 0.8. Content fails if something
// flashes more than three times in one second over a combined area of 0.006 sr or more,
// which WCAG takes as 25% of a 341 x 256 px rectangle at 1024 x 768 (its 10-degree field).
//
// On every animation frame this reads every device pixel of the hydra canvas and tracks its
// relative luminance: a change of 0.1 or more against the last extreme, opposite to the
// previous one, is a transition. It returns the most transitions any pixel made in any one
// second (counted only up to 9, from the last 8 remembered, which is enough for every limit
// checked here; independent meters found up to 20 under the cross-fade at 60 frames a second
// and 34 at 120), and the total area
// (CSS px²) of the pixels that made more than 6 (more than three flashes) in some second.
// That total is over the whole canvas, so it is an upper bound on the flashing area inside
// any one 341 x 256 rectangle, and pixels are not averaged together.
// It also returns the same worst count for the selection ring's own pixels alone (ringWorst):
// the pixels that ever showed exactly the ring's colour, which in the light scheme nothing
// else on the canvas uses, and their area (ringArea).
//
// `drive` optionally plays input from inside the page at a fixed rate while measuring:
// a held key ('key', with repeat set after the first keydown, as a held key sends), separate
// presses of a key ('press'), taps on a head ('tap'), clicks on a cycle of buttons ('click'),
// or the mouse swept to and fro across the heads, or across everything a tap can grow from
// ('sweep', one pointermove per tick landing on the next one, with a click every `tapEvery`).
async function measureFlashes(page, ms, drive) {
  return page.evaluate(
    async ({ ms, drive }) => {
      const cv = document.getElementById('hydra');
      const ctx = cv.getContext('2d');
      const lin = new Float32Array(256);
      for (let i = 0; i < 256; i++) {
        const c = i / 255;
        lin[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      }
      const w = cv.width;
      const h = cv.height;
      const n = w * h;
      const ringHex = getComputedStyle(document.documentElement).getPropertyValue('--ring').trim();
      const rgb = [1, 3, 5].map((j) => parseInt(ringHex.slice(j, j + 2), 16));
      const isRing = new Uint8Array(n);
      const R = 8; // remembered transition times per pixel
      const anchor = new Float32Array(n).fill(NaN);
      const dir = new Int8Array(n);
      const ring = new Float32Array(n * R).fill(-1e9);
      const pos = new Uint8Array(n);
      const worst = new Uint8Array(n);
      let timer = 0;
      let k = 0;
      if (drive) {
        timer = setInterval(() => {
          if (drive.kind === 'key') {
            cv.focus();
            cv.dispatchEvent(new KeyboardEvent('keydown', { key: drive.key, repeat: k > 0, bubbles: true, cancelable: true }));
          } else if (drive.kind === 'tap') {
            const p = window.__hydraDebug.headPoint(k % 5);
            if (p) {
              const o = { clientX: p.x, clientY: p.y, bubbles: true, pointerType: 'touch', isPrimary: true };
              cv.dispatchEvent(new PointerEvent('pointerdown', o));
              cv.dispatchEvent(new PointerEvent('pointerup', o));
            }
          } else if (drive.kind === 'press') {
            cv.focus();
            cv.dispatchEvent(new KeyboardEvent('keydown', { key: drive.key, repeat: false, bubbles: true, cancelable: true }));
          } else if (drive.kind === 'sweep') {
            const pts = [];
            for (let i = 0; i < 60; i++) {
              const q = drive.all ? window.__hydraDebug.anyPoint(i) : window.__hydraDebug.headPoint(i);
              if (!q || pts.some((o) => o.x === q.x && o.y === q.y)) break;
              pts.push(q);
            }
            pts.sort((a, b) => a.x - b.x || a.y - b.y);
            const per = Math.max(1, 2 * (pts.length - 1));
            const m = k % per;
            const p = pts[m < pts.length ? m : per - m];
            if (p) {
              const o = { clientX: p.x, clientY: p.y, bubbles: true, pointerType: 'mouse', isPrimary: true };
              cv.dispatchEvent(new PointerEvent('pointermove', o));
              if (drive.tapEvery && k % drive.tapEvery === 0) {
                cv.dispatchEvent(new PointerEvent('pointerdown', o));
                cv.dispatchEvent(new PointerEvent('pointerup', o));
              }
            }
          } else if (drive.kind === 'click') {
            document.querySelector(drive.sel[k % drive.sel.length]).click();
          }
          k++;
        }, 1000 / drive.rate);
      }
      let frames = 0;
      const t0 = performance.now();
      await new Promise((resolve) => {
        function frame(now) {
          const data = ctx.getImageData(0, 0, w, h).data;
          for (let i = 0; i < n; i++) {
            const o = i * 4;
            if (Math.abs(data[o] - rgb[0]) <= 3 && Math.abs(data[o + 1] - rgb[1]) <= 3 && Math.abs(data[o + 2] - rgb[2]) <= 3) isRing[i] = 1;
            const L = 0.2126 * lin[data[o]] + 0.7152 * lin[data[o + 1]] + 0.0722 * lin[data[o + 2]];
            const A = anchor[i];
            if (A !== A) {
              anchor[i] = L;
              continue;
            }
            const d = L - A;
            if (d >= 0.1 || d <= -0.1) {
              const s = d > 0 ? 1 : -1;
              if (s !== dir[i]) {
                if (Math.min(A, L) < 0.8) {
                  let c = 1;
                  const b = i * R;
                  for (let j = 0; j < R; j++) if (now - ring[b + j] < 1000) c++;
                  if (c > worst[i]) worst[i] = c;
                  ring[b + pos[i]] = now;
                  pos[i] = (pos[i] + 1) % R;
                }
                dir[i] = s;
              }
              anchor[i] = L;
            } else if ((dir[i] > 0 && L > A) || (dir[i] < 0 && L < A)) anchor[i] = L;
          }
          frames++;
          if (now - t0 < ms) requestAnimationFrame(frame);
          else resolve();
        }
        requestAnimationFrame(frame);
      });
      clearInterval(timer);
      const rect = cv.getBoundingClientRect();
      const px = (rect.width / w) * (rect.height / h); // CSS px² per device pixel
      let flagged = 0;
      let maxT = 0;
      let ringWorst = 0;
      let ringPx = 0;
      for (let i = 0; i < n; i++) {
        if (worst[i] > maxT) maxT = worst[i];
        if (worst[i] > 6) flagged++;
        if (isRing[i]) {
          ringPx++;
          if (worst[i] > ringWorst) ringWorst = worst[i];
        }
      }
      return { fps: (frames * 1000) / (performance.now() - t0), worst: maxT, flaggedArea: flagged * px, ringWorst, ringArea: ringPx * px, cuts: window.__hydraDebug.state().cuts };
    },
    { ms, drive }
  );
}

// 25% of WCAG's 341 x 256 px rectangle.
const AREA_LIMIT = (341 * 256) / 4;

function report(label, r, gap) {
  console.log(`flash check, ${label}: worst pixel ${r.worst} changes/s, ${Math.round(r.flaggedArea)} px² over 3 flashes/s; ${r.cuts} cuts; ${r.fps.toFixed(0)} fps${gap ? `; picture changes at least ${Math.round(gap)} ms apart` : ''}`);
}

function checkFlashes(label, r) {
  assert.ok(r.fps >= 20, `${label}: sampled at only ${r.fps.toFixed(1)} frames a second`);
  assert.ok(r.flaggedArea < AREA_LIMIT, `${label}: ${Math.round(r.flaggedArea)} px² flashed more than 3 times in a second`);
}

test('flash check: Hercules playing as fast as he can, and at 2 cuts a second', { skip, timeout: 120000 }, async () => {
  await withPage(DESK, async (page) => {
    for (const [label, preset, speed, button] of [
      ['as fast as it can, slow way, tall stick', 'tall', '0', '#autoSlow'],
      ['as fast as it can, fast way, tall stick', 'tall', '0', '#autoFast'],
      ['2 cuts a second, fast way, two sticks', 'twosticks', '2', '#autoFast'],
      ['2 cuts a second, slow way, tall stick', 'tall', '2', '#autoSlow'],
    ]) {
      await page.click(`[data-preset=${preset}]`);
      await page.selectOption('#speed', speed);
      await ready(page);
      await page.click(button);
      const r = await measureFlashes(page, 4000);
      if (await page.evaluate(() => window.__hydraDebug.state().auto)) await page.click(button);
      const { gap } = await minGap(page);
      report(label, r, gap);
      checkFlashes(label, r);
      assert.ok(gap >= 499, `${label}: the picture changed twice within ${gap} ms`);
    }
  });
});

// The reviewer's case: with reduced motion, a held Enter (12 to 30 key repeats a second) or
// fast tapping used to replace the whole picture at that rate, about 143,000 px² flashing.
test('flash check: held keys, fast taps and mashed buttons, both motion modes, desktop and phone', { skip, timeout: 240000 }, async () => {
  const scenarios = [
    ['held Enter, reduced motion, desktop', { ...DESK, reducedMotion: 'reduce' }, 'twosticks', { kind: 'key', key: 'Enter', rate: 30 }],
    ['held Space, reduced motion, phone, dark', { ...PHONE, reducedMotion: 'reduce', colorScheme: 'dark' }, 'twosticks', { kind: 'key', key: ' ', rate: 30 }],
    ['taps 8 a second, reduced motion, desktop', { ...DESK, reducedMotion: 'reduce' }, 'tall', { kind: 'tap', rate: 8 }],
    ['taps 12 a second, reduced motion, phone', { ...PHONE, reducedMotion: 'reduce' }, 'tall', { kind: 'tap', rate: 12 }],
    ['taps 12 a second, cross-fade, desktop', DESK, 'tall', { kind: 'tap', rate: 12 }],
    ['held Enter, cross-fade, phone', PHONE, 'twosticks', { kind: 'key', key: 'Enter', rate: 30 }],
    ['held arrow key on the Fork (the selection ring), reduced motion, desktop', { ...DESK, reducedMotion: 'reduce' }, 'fork', { kind: 'key', key: 'ArrowRight', rate: 30 }],
    ['undo, presets and Hercules mashed 10 a second, reduced motion, desktop', { ...DESK, reducedMotion: 'reduce' }, 'stick', { kind: 'click', rate: 10, sel: ['#autoFast', '[data-preset=twosticks]', '#undo', '[data-preset=fork]', '#labels', '#restart'] }],
    // The selection ring. Before it had its own limit, separate arrow presses blinked both of
    // the Fork's rings (about 730 px²), and sweeping the mouse to and fro across the Tall
    // stick's heads blinked every ring it crossed (about 4,300 px², worst pixel 8 or more).
    ['arrow pressed 30 times a second on the Fork, reduced motion, desktop', { ...DESK, reducedMotion: 'reduce' }, 'fork', { kind: 'press', key: 'ArrowRight', rate: 30 }],
    ['arrow pressed 30 times a second in Grow your own, reduced motion, phone', { ...PHONE, reducedMotion: 'reduce' }, 'grow', { kind: 'press', key: 'ArrowRight', rate: 30 }],
    ['mouse swept across the heads, 60 moves a second, reduced motion, desktop', { ...DESK, reducedMotion: 'reduce' }, 'tall', { kind: 'sweep', rate: 60 }, 5],
    ['mouse swept across the heads while clicking, reduced motion, desktop, dark', { ...DESK, reducedMotion: 'reduce', colorScheme: 'dark' }, 'tall', { kind: 'sweep', rate: 60, tapEvery: 7 }, 5],
    ['mouse swept across the heads while clicking, cross-fade, desktop', DESK, 'tall', { kind: 'sweep', rate: 60, tapEvery: 7 }, 5],
    ['mouse swept across body and heads in Grow your own, reduced motion, desktop', { ...DESK, reducedMotion: 'reduce' }, 'grow', { kind: 'sweep', rate: 60, all: true }, 0, 6],
    // The ring hides while Hercules plays. It used to read that straight from whether he was
    // playing, so during a cut's cross-fade, clicking Fast way on and off blinked the ring at
    // the click rate (a ring pixel changed 13 times in a second at 15 clicks a second, 21 under
    // a held Enter). Now hiding it is a move of the ring like any other, within its limit.
    ['Fast way clicked on and off 15 times a second, a head picked, cross-fade, desktop', DESK, 'twosticks', { kind: 'click', rate: 15, sel: ['#autoFast'] }, 0, 0, true],
  ];
  for (const [label, opts, preset, drive, cutsFirst = 0, sproutsFirst = 0, pick = false] of scenarios) {
    await withPage(opts, async (page) => {
      await page.click(`[data-preset=${preset}]`);
      for (let i = 0; i < cutsFirst + sproutsFirst; i++) {
        await ready(page);
        const pt = await page.evaluate((s) => (s ? window.__hydraDebug.anyPoint(0) : window.__hydraDebug.headPoint(0)), sproutsFirst);
        await page.mouse.click(pt.x, pt.y);
      }
      await ready(page);
      if (pick) {
        await page.focus('#hydra');
        await page.keyboard.press('ArrowRight');
      }
      await page.mouse.move(0, 0);
      const before = await page.evaluate(() => window.__hydraDebug.state().cuts);
      const r = await measureFlashes(page, 4000, drive);
      r.cuts -= before;
      const { gap } = await minGap(page);
      report(label, r, gap);
      if (pick) console.log(`  the ring alone: ${Math.round(r.ringArea)} px² of it drawn, worst pixel ${r.ringWorst} changes/s`);
      checkFlashes(label, r);
      const ring = /Arrow/.test(drive.key) || drive.kind === 'sweep';
      // Under reduced motion every change is a swap: the picture at most twice a second, so no
      // pixel changes more than 3 times in a second, and the selection ring on its own at most
      // 4 times a second (5 allows for frame timing), 6 counting the picture's own changes.
      if (opts.reducedMotion) assert.ok(r.worst <= (drive.tapEvery ? 6 : ring ? 5 : 3), `${label}: a pixel changed ${r.worst} times in one second`);
      if (ring && opts.reducedMotion) assert.ok(r.flaggedArea <= 100, `${label}: ${Math.round(r.flaggedArea)} px² of the selection ring flashed more than 3 times in a second`);
      assert.ok(gap >= 499, `${label}: the picture changed twice within ${gap} ms`);
      if (drive.kind === 'key') assert.equal(r.cuts, ring ? 0 : 1, `${label}: a held key cut ${r.cuts} times`);
      if (drive.kind === 'press') assert.equal(r.cuts, 0);
      if (drive.kind === 'tap') assert.ok(r.cuts >= 6 && r.cuts <= 9, `${label}: ${r.cuts} cuts in 4 s of fast tapping`);
      // The ring on its own moves at most 4 times a second and the picture changes at most
      // twice, so a pixel of the ring changes at most 6 times in a second, cross-fade or not.
      if (pick) {
        assert.ok(r.ringArea > 0, `${label}: the ring was never drawn`);
        assert.ok(r.ringWorst <= 6, `${label}: a pixel of the ring changed ${r.ringWorst} times in one second`);
      }
    });
  }
});

test('real keyboard: holding Enter cuts once; fast presses and a held Enter on Undo wait their turn; a held Enter on Fast way switches Hercules on once', { skip, timeout: 60000 }, async () => {
  for (const opts of [{ ...DESK, reducedMotion: 'reduce' }, PHONE]) {
    await withPage(opts, async (page) => {
      await page.focus('#hydra');
      for (let i = 0; i < 30; i++) {
        await page.keyboard.down('Enter'); // Playwright marks every keydown after the first as a repeat
        await page.waitForTimeout(33);
      }
      await page.keyboard.up('Enter');
      await ready(page);
      assert.equal((await page.evaluate(() => window.__hydraDebug.state())).cuts, 1);
      // separate presses, 15 a second for about 2 seconds: the gate lets one through at once and
      // then one every half second while presses keep coming, plus at most one left waiting at the end
      const t0 = Date.now();
      for (let i = 0; i < 30; i++) {
        await page.keyboard.press('Enter');
        await page.waitForTimeout(66);
      }
      const slots = Math.floor((Date.now() - t0) / 500);
      await ready(page);
      const cuts = (await page.evaluate(() => window.__hydraDebug.state())).cuts - 1;
      assert.ok(cuts >= slots - 1 && cuts <= slots + 2, `${cuts} cuts from ${slots} half-second slots of presses`);
      // a held Enter on the Undo button undoes at the gate's pace, and stops when let go: the
      // key's repeats don't pile up behind the gate
      await page.focus('#undo');
      for (let i = 0; i < 30; i++) {
        await page.keyboard.down('Enter');
        await page.waitForTimeout(33);
      }
      await page.keyboard.up('Enter');
      const atRelease = (await page.evaluate(() => window.__hydraDebug.state())).cuts;
      await ready(page);
      const after = (await page.evaluate(() => window.__hydraDebug.state())).cuts;
      assert.ok(cuts - atRelease >= 1, `a held Enter on Undo undid ${cuts - atRelease} steps`);
      assert.ok(atRelease - after <= 1, `Undo went on for ${atRelease - after} steps after the key was let go`);
      const { gap, changes } = await minGap(page);
      assert.ok(changes >= 6);
      assert.ok(gap >= 499, `the picture changed twice within ${gap} ms`);
      // A held Enter on Fast way switches Hercules on once. (Its key repeats used to switch
      // him on and off 30 times a second, and the button with him.)
      await page.evaluate(() => {
        window.__toggles = 0;
        new MutationObserver(() => window.__toggles++).observe(document.getElementById('autoFast'), { attributes: true, attributeFilter: ['class'] });
      });
      await page.focus('#autoFast');
      for (let i = 0; i < 30; i++) {
        await page.keyboard.down('Enter');
        await page.waitForTimeout(33);
      }
      await page.keyboard.up('Enter');
      assert.equal(await page.evaluate(() => window.__toggles), 1, 'a held Enter on Fast way switched Hercules more than once');
      assert.equal((await page.evaluate(() => window.__hydraDebug.state())).auto, true);
      await page.click('#autoFast');
    });
  }
});

// A held Enter repeats a button's click about 30 times a second, and quick clicks queue up at
// the gate too. None of it may pile up there. The version before this one queued every click
// of a hydra button, Start over or Clear: a held Enter on Start over left 55 requests waiting,
// and taps on the hydra did nothing for 28 seconds while the page worked through them.
test('no backlog: a held Enter on a button acts once, quick clicks leave at most one request of each kind, and a tap then works within about a second', { skip, timeout: 150000 }, async () => {
  const hydraButtons = ['[data-preset=sprout]', '#restart', '[data-preset=fork]', '[data-preset=twosticks]', '#restart', '[data-preset=tall]'];
  const scenarios = [
    ['a held Enter on Start over', 'stick', '#restart'],
    ['a held Enter on the Fork button', 'stick', '[data-preset=fork]'],
    ['a held Enter on Clear in Grow your own', 'grow', '#growClear'],
    ['the hydra buttons and Start over clicked 10 times a second', 'stick', hydraButtons],
    ['Undo clicked 10 times a second', 'twosticks', ['#undo']],
    ['Undo, hydra buttons, Hercules, labels and Start over clicked 10 times a second', 'stick', ['#undo', '[data-preset=twosticks]', '#autoFast', '#labels', '[data-preset=fork]', '#restart', '#undo', '#autoSlow']],
  ];
  for (const [label, preset, input] of scenarios) {
    await withPage({ ...DESK, reducedMotion: 'reduce' }, async (page) => {
      const state = () => page.evaluate(() => window.__hydraDebug.state());
      const grow = preset === 'grow';
      await page.click(`[data-preset=${preset}]`);
      for (let i = 0; i < (grow ? 3 : 6); i++) {
        await ready(page);
        const pt = await page.evaluate((g) => (g ? window.__hydraDebug.anyPoint(0) : window.__hydraDebug.headPoint(0)), grow);
        await page.mouse.click(pt.x, pt.y);
      }
      await ready(page);
      const changes0 = (await page.evaluate(() => window.__hydraDebug.changes())).length;
      if (typeof input === 'string') {
        await page.focus(input);
        for (let i = 0; i < 60; i++) {
          await page.keyboard.down('Enter');
          await page.waitForTimeout(33);
        }
        await page.keyboard.up('Enter');
      } else {
        const t0 = Date.now();
        for (let k = 0; Date.now() - t0 < 2000; ) {
          await page.evaluate((sel) => document.querySelector(sel).click(), input[k % input.length]);
          k++;
          const w = t0 + k * 100 - Date.now();
          if (w > 0) await page.waitForTimeout(w);
        }
      }
      const waiting = await page.evaluate(() => window.__hydraDebug.waiting());
      assert.equal(new Set(waiting).size, waiting.length, `${label}: waiting at the gate: ${waiting.join(', ')}`);
      if (typeof input === 'string') {
        const changes = (await page.evaluate(() => window.__hydraDebug.changes())).length - changes0;
        assert.equal(changes, 1, `${label}: the picture changed ${changes} times`);
      }
      // Now tap the hydra every 150 ms until a tap cuts (or sprouts).
      const t0 = Date.now();
      let took = null;
      while (took === null && Date.now() - t0 < 6000) {
        const before = await state();
        const pt = await page.evaluate((g) => (g ? window.__hydraDebug.anyPoint(0) : window.__hydraDebug.headPoint(0)), grow);
        await page.mouse.click(pt.x, pt.y);
        for (let j = 0; j < 3 && took === null; j++) {
          await page.waitForTimeout(50);
          const now = await state();
          if (grow ? now.clock !== before.clock : now.cuts > before.cuts) took = Date.now() - t0;
        }
      }
      console.log(`no backlog, ${label}: waiting at release [${waiting.join(', ')}]; a tap worked after ${took} ms`);
      assert.ok(took !== null && took <= 1600, `${label}: the first tap that worked came ${took} ms after the input stopped`);
    });
  }
});

// Undo goes through the gate too, but every click counts: quick clicks add up, each taking back
// one step, and an Undo clicked while a cut is still waiting cancels that cut. (A version that
// let each Undo replace a waiting cut or undo dropped clicks, and turned "cut, cut, Undo" into
// no cut at all.)
test('undo: three quick clicks undo three steps; tap, tap, Undo leaves one new cut', { skip, timeout: 90000 }, async () => {
  for (const opts of [{ ...DESK, reducedMotion: 'reduce' }, DESK]) {
    await withPage(opts, async (page) => {
      const state = () => page.evaluate(() => window.__hydraDebug.state());
      await page.click('[data-preset=twosticks]');
      const clocks = [];
      for (let k = 0; k < 5; k++) {
        await ready(page);
        clocks.push((await state()).clock);
        const pt = await page.evaluate(() => window.__hydraDebug.headPoint(0));
        await page.mouse.click(pt.x, pt.y);
      }
      await ready(page);
      assert.equal((await state()).cuts, 5);
      for (let i = 0; i < 3; i++) {
        await page.click('#undo');
        await page.waitForTimeout(150);
      }
      await ready(page);
      let st = await state();
      assert.equal(st.cuts, 2, `three quick Undo clicks left ${st.cuts} of 5 cuts`);
      assert.equal(st.clock, clocks[2]);
      // tap a head (cut at once), tap another 200 ms later (it waits its turn), Undo 150 ms later
      let pt = await page.evaluate(() => window.__hydraDebug.headPoint(0));
      await page.mouse.click(pt.x, pt.y);
      const one = await state();
      assert.equal(one.cuts, 3, 'the first tap cut at once');
      await page.waitForTimeout(200);
      pt = await page.evaluate(() => window.__hydraDebug.headPoint(1));
      await page.mouse.click(pt.x, pt.y);
      assert.deepEqual(await page.evaluate(() => window.__hydraDebug.waiting()), ['move']);
      await page.waitForTimeout(150);
      await page.evaluate(() => document.getElementById('undo').click());
      await ready(page);
      await page.waitForTimeout(600);
      st = await state();
      assert.equal(st.cuts, 3, `tap, tap, Undo left ${st.cuts - 2} new cuts`);
      assert.equal(st.clock, one.clock);
      const { gap } = await minGap(page);
      assert.ok(gap >= 499, `the picture changed twice within ${gap} ms`);
    });
  }
});

// The ring that marks the head under the mouse follows it at once when it has been still a
// moment, and at most 4 times a second when it moves faster (see the sweeps above).
test('the selection ring follows a still mouse at once, a fast one at most 4 times a second', { skip, timeout: 60000 }, async () => {
  await withPage({ ...DESK, reducedMotion: 'reduce' }, async (page) => {
    await page.click('[data-preset=fork]');
    await ready(page);
    await page.waitForTimeout(300);
    const ring = () => page.evaluate(() => window.__hydraDebug.ring());
    const a = await page.evaluate(() => window.__hydraDebug.headPoint(0));
    const b = await page.evaluate(() => window.__hydraDebug.headPoint(1));
    await page.mouse.move(a.x, a.y);
    const r1 = await ring();
    assert.ok(r1.wanted && r1.shown === r1.wanted, 'the ring is on the head under the mouse at once');
    await page.mouse.move(b.x, b.y);
    const r2 = await ring();
    assert.ok(r2.wanted && r2.wanted !== r1.wanted);
    assert.equal(r2.shown, r1.shown, 'a second move within 250 ms waits');
    await page.waitForTimeout(300);
    const r3 = await ring();
    assert.equal(r3.shown, r2.wanted, 'and then the ring catches up');
    await page.mouse.move(0, 0);
    await page.waitForTimeout(300);
    assert.equal((await ring()).shown, null);
  });
});

test('grow your own: sprouting raises the clock, fighting it lowers it', { skip, timeout: 60000 }, async () => {
  await withPage(DESK, async (page) => {
    await page.click('[data-preset=grow]');
    const readings = [];
    for (let k = 0; k < 5; k++) {
      await ready(page);
      const pt = await page.evaluate((k) => window.__hydraDebug.anyPoint(k), k);
      await page.mouse.click(pt.x, pt.y);
      await ready(page);
      readings.push((await page.evaluate(() => window.__hydraDebug.state())).clock);
    }
    for (let i = 1; i < readings.length; i++) assert.ok(H.cmp(H.parse(readings[i]), H.parse(readings[i - 1])) > 0);
    await page.click('#growFight');
    await ready(page);
    const pt = await page.evaluate(() => window.__hydraDebug.headPoint(0));
    await page.mouse.click(pt.x, pt.y);
    await ready(page);
    const st = await page.evaluate(() => window.__hydraDebug.state());
    assert.equal(st.mode, 'play');
    assert.ok(H.cmp(H.parse(st.trail[1]), H.parse(st.trail[0])) < 0);
    const facts = await page.evaluate(() => document.getElementById('facts').innerText);
    assert.match(facts, /This hydra/);
  });
});

test('Hercules buttons: switching to Pause and back never resizes a button or moves anything on the page', { skip, timeout: 90000 }, async () => {
  // At some phone widths a label change that resized the button re-wrapped the row, and tapping it
  // fast shifted everything below; the button now keeps its size whichever face shows.
  const rects = (page) =>
    page.evaluate(() => {
      const els = [...document.querySelectorAll('.controls *, main > *, h1, footer')];
      return { h: document.documentElement.scrollHeight, r: els.map((e) => { const b = e.getBoundingClientRect(); return [Math.round(b.x * 4), Math.round((b.y + scrollY) * 4), Math.round(b.width * 4), Math.round(b.height * 4)].join(','); }) };
    });
  // the row's own layout, relative to the row (a cut by Hercules may change the clock card above it)
  const row = (page) =>
    page.evaluate(() => {
      const top = document.querySelector('.controls .auto').getBoundingClientRect();
      return [...document.querySelectorAll('.controls .auto, .controls .auto *:not(option)')].map((e) => {
        const b = e.getBoundingClientRect();
        return [b.x - top.x, b.y - top.y, b.width, b.height].map((v) => Math.round(v * 4)).join(',');
      });
    });
  for (let w = 360; w <= 430; w++) {
    await withPage({ viewport: { width: w, height: 844 }, isMobile: true, hasTouch: true }, async (page) => {
      const before = await rects(page);
      for (const id of ['autoFast', 'autoSlow']) {
        await page.evaluate((id) => document.getElementById(id).classList.add('on'), id);
        const shown = await page.evaluate((id) => document.getElementById(id).innerText.trim(), id);
        assert.equal(shown, 'Pause', `${w}px: ${id} shows ${shown}`);
        assert.deepEqual(await rects(page), before, `${w}px: ${id} switched to Pause moved something`);
        await page.evaluate((id) => document.getElementById(id).classList.remove('on'), id);
      }
      assert.deepEqual(await rects(page), before, `${w}px: switching back moved something`);
    });
  }
  // and through the real button, at the widths where it used to happen
  for (const w of [390, 393, 402]) {
    await withPage({ viewport: { width: w, height: 844 }, isMobile: true, hasTouch: true }, async (page) => {
      const before = await row(page);
      await page.tap('#autoSlow');
      await page.waitForFunction(() => document.getElementById('autoSlow').classList.contains('on'));
      assert.equal(await page.evaluate(() => document.getElementById('autoSlow').innerText.trim()), 'Pause');
      const during = await row(page);
      await page.tap('#autoSlow');
      await page.waitForFunction(() => !document.getElementById('autoSlow').classList.contains('on'));
      assert.equal(await page.evaluate(() => document.getElementById('autoSlow').innerText.trim()), 'Slow way');
      // the counts and facts change while Hercules plays, so compare the row the button sits in
      assert.deepEqual(during, before, `${w}px: the Hercules row moved when Slow way became Pause`);
      assert.deepEqual(await row(page), before, `${w}px: the Hercules row moved when Pause became Slow way`);
    });
  }
});

test('whole page: tapping a Hercules button 15 times a second does not make the page jump faster than the gate allows', { skip, timeout: 120000 }, async () => {
  // Chromium reports every movement of laid-out content as a layout shift. A button that resized when
  // its label changed re-wrapped its row at these widths and shifted everything below on every tap.
  for (const w of [390, 393, 402, 411]) {
    await withPage({ viewport: { width: w, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: 'reduce' }, async (page) => {
      await page.evaluate(() => {
        window.__shifts = [];
        window.__clicks = [];
        new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.value > 0) window.__shifts.push(e.startTime); }).observe({ type: 'layout-shift', buffered: false });
        document.getElementById('autoSlow').addEventListener('click', () => window.__clicks.push(performance.now()), true);
      });
      await page.locator('#autoSlow').scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      const box = await page.locator('#autoSlow').boundingBox();
      const t0 = await page.evaluate(() => performance.now());
      // real touch taps on the button's centre, by the clock: one every 1/15 s (page.tap would wait
      // for the button to be ready each time and so manage only about 8 a second)
      const start = Date.now();
      for (let i = 0; i < 30; i++) {
        const wait = start + (i * 1000) / 15 - Date.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      }
      await page.waitForTimeout(600);
      const { shifts, clicks } = await page.evaluate(() => ({ shifts: window.__shifts, clicks: window.__clicks }));
      assert.equal(clicks.length, 30, `${w}px: ${clicks.length} of 30 taps reached the button`);
      const rate = (clicks.length - 1) / ((clicks[clicks.length - 1] - clicks[0]) / 1000);
      assert.ok(rate >= 13, `${w}px: the taps came only ${rate.toFixed(1)} times a second`);
      const t = shifts.filter((x) => x >= t0);
      let worst = 0;
      for (const a of t) worst = Math.max(worst, t.filter((b) => b >= a && b < a + 1000).length);
      assert.ok(worst <= 3, `${w}px: ${worst} layout shifts in one second (${t.length} in all, taps ${rate.toFixed(1)} a second)`);
    });
  }
});
