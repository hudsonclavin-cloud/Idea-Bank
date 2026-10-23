// Browser checks for Doubletake, in headless Chromium. From the repo root:
//   node --test ideas/12-doubletake/ui.test.mjs
// Needs the global Playwright that tools/smoke.mjs uses; skips itself if Playwright is missing.
// Each check pins what the independent review found on the page:
//   1. the height-cap note called the smaller side of the bounding box the footprint's
//      narrowest width (triangle on triangle at 60° and 30 mm: "30.0 mm across", really 21.2);
//   2. the verdict called a 0.207 mm faceting error "far below" a 0.4 mm line, and said
//      nothing about the layer stepping, which is bigger than the faceting at the defaults.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function loadPlaywright() {
  try { return createRequire(import.meta.url)('playwright'); } catch { /* fall through to the global install */ }
  try { return createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'noop.js'))('playwright'); } catch { return null; }
}
const playwright = loadPlaywright();

test('page checks in headless Chromium', { skip: playwright ? false : 'Playwright not installed' }, async (t) => {
  const browser = await playwright.chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`uncaught: ${e.message}`));
  await page.goto(pathToFileURL(path.join(HERE, 'index.html')).href, { waitUntil: 'load' });
  const built = () => page.waitForFunction(() => !document.getElementById('btnDownload').disabled, null, { timeout: 20000 });
  // Set shapes and sliders the way a person would (click, input events), then wait for the build.
  const set = async (p) => {
    await page.evaluate((p) => {
      for (const [k, v] of Object.entries(p)) {
        if (k === 'eye' || k === 'mirror') { document.querySelector(`#pick${k === 'eye' ? 'Eye' : 'Mirror'} [data-id="${v}"]`).click(); continue; }
        const el = document.getElementById(`p-${k}`);
        el.value = String(v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, p);
    await built();
  };
  const row = (name) => page.evaluate((name) => {
    const dt = [...document.querySelectorAll('#stats dt')].find((d) => d.textContent === name);
    return dt ? dt.nextElementSibling.textContent : null;
  }, name);
  try {
    await built();
    await t.test('defaults: faceting far below a line, layer stepping stated, not capped', async () => {
      const v = await page.locator('#verdict').innerText();
      assert.match(v, /at most 0\.011 mm, far below the 0\.4 mm width of a printed line/);
      assert.match(v, /0\.2 mm layers steps the rim's top to the layer grid, which moves the outline by up to about 0\.07 mm/);
      assert.equal(await page.locator('#capNote').isHidden(), true);
      assert.equal(await row('Tall ÷ narrowest'), '91.2 ÷ 60.0 mm = 1.52 (limit 4)');
    });
    await t.test('triangle on triangle at 60° and 30 mm: capped by its true narrowest width, 21.2 mm', async () => {
      await set({ eye: 'triangle', mirror: 'triangle', angle: 60, width: 30, height: 100 });
      const note = await page.locator('#capNote').innerText();
      assert.match(note, /^Height capped at 58\.9 mm \(you asked for 100 mm\): this footprint is only 21\.2 mm across at its narrowest/);
      assert.equal(await row('Tall ÷ narrowest'), '84.9 ÷ 21.2 mm = 4.00 (limit 4)');
      assert.equal(await row('Footprint'), '30.0 × 30.0 mm');
    });
    await t.test('square to the eye, star in the mirror, 60°, 80 mm, detail 48: the worst faceting is "below", not "far below"', async () => {
      await set({ eye: 'square', mirror: 'star', angle: 60, width: 80, height: 70, detail: 48 });
      const v = await page.locator('#verdict').innerText();
      assert.match(v, /at most 0\.207 mm, below the 0\.4 mm width of a printed line/);
      assert.doesNotMatch(v, /far below/);
      assert.match(v, /by up to about 0\.05 mm/);
    });
    assert.deepEqual(errors, [], 'no console errors or uncaught exceptions');
  } finally {
    await browser.close();
  }
});
