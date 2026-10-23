// Browser checks for "The Forgiving Code", in headless Chromium. From the repo root:
//   node --test ideas/43-forgiving-code/ui.test.mjs
// Needs the global Playwright that tools/smoke.mjs uses; skips itself if Playwright is missing.
// Each check pins a bug the independent review found in the page itself:
//   1. hovering a stop codon claimed all nine neighbours "read on" (UAA has two stop neighbours);
//   2. the sickle-cell button fed a hand-picked typo into the random-typo tally (47.61 after 1 typo);
//   3. the Weighting menu was 519 px wide and overflowed every phone width, which the smoke test's
//      mobile emulation hid by widening the layout viewport to fit.
// and one found while fixing those:
//   4. tapping a codon on a phone never showed the inspector (the emulated mouseenter focused it,
//      then the click toggled it straight off); a desktop click did the same.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

function loadPlaywright() {
  const req = createRequire(import.meta.url);
  try { return req('playwright'); } catch { /* fall through to the global install */ }
  try { return createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'noop.js'))('playwright'); } catch { return null; }
}
const playwright = loadPlaywright();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg' };

test('page checks in headless Chromium', { skip: playwright ? false : 'Playwright not installed' }, async (t) => {
  const server = http.createServer((rq, res) => {
    const p = path.join(ROOT, decodeURIComponent(new URL(rq.url, 'http://x').pathname));
    if (!p.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(p, (err, data) => {
      if (err) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' }).end(data);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/ideas/43-forgiving-code/index.html`;
  const browser = await playwright.chromium.launch();
  const errors = [];
  const open = async (opts) => {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`uncaught: ${e.message}`));
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(300);
    return { ctx, page };
  };
  try {
    await t.test('the inspector counts a stop codon\'s stop neighbours (UAA 7 + 2, UAG 8 + 1, UGA 8 + 1)', async () => {
      const { ctx, page } = await open({ viewport: { width: 1280, height: 900 } });
      const expected = { UAA: [7, '2 are other stops'], UAG: [8, '1 is another stop'], UGA: [8, '1 is another stop'] };
      for (const [stop, [read, still]] of Object.entries(expected)) {
        await page.hover(`.cell[data-codon="${stop}"]`);
        const text = await page.locator('#inspector').innerText();
        assert.ok(text.includes(`${read} of its nine`) && text.includes(still), `${stop}: ${text}`);
        const readOn = await page.$$eval('.cell.is-near', (els) => els.filter((e) => e.dataset.delta === 'read on').map((e) => e.dataset.codon));
        assert.equal(readOn.length, read, `${stop}: cells labelled "read on": ${readOn}`);
        for (const c of readOn) assert.ok(!['UAA', 'UAG', 'UGA'].includes(c), `${stop}: stop neighbour ${c} labelled "read on"`);
      }
      await ctx.close();
    });

    await t.test('tapping a codon on a phone pins the inspector, and tapping it again unpins it', async () => {
      const { ctx, page } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      await page.tap('.cell[data-codon="GAG"]');
      assert.match(await page.locator('#inspector').innerText(), /^GAG = Glutamic acid/);
      await page.tap('.cell[data-codon="GAG"]');
      assert.match(await page.locator('#inspector').innerText(), /^Hover or tap a codon/);
      await ctx.close();
      const desk = await open({ viewport: { width: 1280, height: 900 } });
      await desk.page.click('.cell[data-codon="UUU"]');
      await desk.page.mouse.move(5, 5);
      assert.match(await desk.page.locator('#inspector').innerText(), /^UUU = Phenylalanine/, 'a click pins the codon after the mouse leaves');
      await desk.ctx.close();
    });

    await t.test('the sickle-cell button changes the protein but not the random-typo tally or the round\'s typo count', async () => {
      const { ctx, page } = await open({ viewport: { width: 1280, height: 900 } });
      await page.selectOption('#sel-gene', 'hbb');
      await page.click('#btn-landmark');
      const tally = await page.locator('#strip-real .tally').innerText();
      assert.ok(tally.includes('after 0 typos'), tally);
      assert.equal(await page.locator('#strip-real .tile').nth(6).innerText(), 'V', 'codon 7 now reads Val');
      assert.match(await page.locator('#last-hit').innerText(), /left out of the typo counts/);
      // Random typos after it are all counted, and only they are.
      await page.locator('#rng-speed').fill('12');
      await page.click('#btn-play');
      await page.waitForFunction(() => /typo (\d+)\/60/.test(document.querySelector('#last-hit').textContent) && Number(document.querySelector('#last-hit').textContent.match(/typo (\d+)\/60/)[1]) >= 5, null, { timeout: 8000 });
      await page.click('#btn-play'); // pause
      const hits = Number((await page.locator('#last-hit').innerText()).match(/typo (\d+)\/60/)[1]);
      const after = await page.locator('#strip-real .tally').innerText();
      assert.ok(after.includes(`after ${hits} typos`), `${after} (hits ${hits})`);
      const silent = Number((await page.locator('#strip-real .strip-stats span').nth(0).innerText()).replace(/\D/g, ''));
      const changed = Number((await page.locator('#strip-real .strip-stats span').nth(1).innerText()).replace(/\D/g, ''));
      assert.equal(silent + changed, hits, 'silent + changed = random typos');
      await ctx.close();
    });

    for (const width of [320, 360, 390, 414]) {
      for (const isMobile of [false, true]) {
        await t.test(`no sideways scrolling at ${width} px (${isMobile ? 'mobile emulation' : 'plain viewport'})`, async () => {
          const { ctx, page } = await open({ viewport: { width, height: 800 }, isMobile, hasTouch: isMobile, deviceScaleFactor: 2 });
          const m = await page.evaluate(() => ({
            scroll: document.documentElement.scrollWidth,
            inner: window.innerWidth,
            selects: [...document.querySelectorAll('select')].map((s) => Math.ceil(s.getBoundingClientRect().right)),
          }));
          // With mobile emulation a too-wide page widens innerWidth itself, so compare with the device width too.
          assert.ok(m.scroll <= width, `content ${m.scroll}px wider than the ${width}px screen`);
          assert.equal(m.inner, width, 'layout viewport was not widened to fit the content');
          for (const r of m.selects) assert.ok(r <= width - 16 + 1, `a menu ends at ${r}px, inside the 16px gutter of ${width}px`);
          await ctx.close();
        });
      }
    }
    assert.deepEqual(errors, [], 'no console errors or uncaught exceptions');
  } finally {
    await browser.close();
    server.close();
  }
});
