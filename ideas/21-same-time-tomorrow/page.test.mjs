// The page itself, driven in headless Chromium: the generated sentences say what the model computes.
// From the repo root: node --test ideas/21-same-time-tomorrow/page.test.mjs
// Needs the globally installed Playwright that tools/smoke.mjs uses; without it these tests skip.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = pathToFileURL(path.join(HERE, 'index.html')).href;

function loadPlaywright() {
  try {
    return createRequire(import.meta.url)('playwright');
  } catch {
    try {
      const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
      return createRequire(path.join(globalRoot, 'noop.js'))('playwright');
    } catch {
      return null;
    }
  }
}

test('page: polar verdicts, the Jupiter preset and the section-2 wording', async (t) => {
  const pw = loadPlaywright();
  let browser = null;
  try {
    browser = pw && (await pw.chromium.launch());
  } catch {
    browser = null;
  }
  if (!browser) {
    t.skip('Playwright with Chromium is not available');
    return;
  }
  try {
    const context = await browser.newContext({ timezoneId: 'UTC', viewport: { width: 1100, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.clock.setFixedTime(new Date('2026-10-22T12:00:00Z')); // the page computes "this year": pin it to 2026
    await page.goto(PAGE);
    const set = (id, value, ev) =>
      page.evaluate(([i, v, e]) => {
        const el = document.getElementById(i);
        el.value = String(v);
        el.dispatchEvent(new Event(e, { bubbles: true }));
      }, [id, value, ev]);
    const verdict = () => page.locator('#verdict').innerText();

    // 70°N, 60°W, UTC−4: both pairs fall on the same side of their polar stretch.
    await set('lon', -60, 'change');
    await set('zone', -4, 'change');
    await set('lat', 70, 'input');
    let v = await verdict();
    assert.match(v, /neither solstice has a sunrise or a sunset/);
    assert.match(v, /25 Nov at 11:52 and the latest sunrise 25 Nov at 11:41, both before the polar night/);
    assert.match(v, /15 May at 23:35, both before the midnight sun/);
    assert.doesNotMatch(v, /either side/);

    // Same latitude on the Greenwich meridian: now they really do straddle both stretches.
    await set('lon', 0, 'change');
    await set('zone', 0, 'change');
    v = await verdict();
    assert.match(v, /on either side of the polar night/);
    assert.match(v, /on either side of the midnight sun/);

    // 66°N: a midnight sun but no polar night, so the December solstice still has a sunrise and a sunset.
    await set('lat', 66, 'input');
    v = await verdict();
    assert.match(v, /stays down for no days, so the summer solstice has no sunset/);
    assert.doesNotMatch(v, /polar night/);

    // Jupiter: perihelion season 57.5°, which on Earth's calendar is mid-May; a single loop.
    await page.click('[data-preset="jupiter"]');
    const peri = await page.locator('#periOut').innerText();
    assert.match(peri, /May/);
    assert.match(await page.locator('#shapeReadout').innerText(), /single loop with no crossing/);

    const why = await page.locator('#why-section').innerText();
    assert.match(why, /very nearly the sum of the two; for Earth the dashed curves add up to the solid one to within 0\.6 min/);
    assert.match(why, /hour circles/);
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser.close();
  }
});
