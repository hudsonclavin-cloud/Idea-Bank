#!/usr/bin/env node
// Drives the real page in headless Chromium: builds a case from scratch through the UI,
// edits it, renames a row (formulas follow), reloads with and without localStorage,
// exports and imports, exercises the two-step row delete and the confirmed case delete,
// taps hinge rows on a phone, and checks that blind button-mashing cannot destroy the example.
// Run from the repo root: node ideas/18-hinge/ui-check.mjs   (needs the global Playwright that tools/smoke.mjs uses)
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const req = createRequire(import.meta.url);
let playwright;
try { playwright = req('playwright'); } catch { playwright = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'noop.js'))('playwright'); }
const { chromium } = playwright;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.md': 'text/markdown' };
const server = http.createServer((rq, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(rq.url, 'http://x').pathname));
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' }).end(data);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const URL_ = `http://127.0.0.1:${server.address().port}/ideas/18-hinge/index.html`;

let passed = 0, failed = 0;
const check = (ok, what) => { if (ok) passed++; else failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const wrap = (page, errors) => {
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`uncaught: ${e.message}`));
};
const settle = (page, ms = 700) => page.waitForTimeout(ms);
const summary = (page) => page.locator('#summary').innerText();

const browser = await chromium.launch();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hinge-ui-'));
let exported = null;

// ---------------------------------------------------------------- desktop: build a case from scratch
{
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  wrap(page, errors);
  await page.goto(URL_, { waitUntil: 'load' });
  await settle(page, 1000);
  check((await summary(page)).includes('Startup'), 'the worked example loads first and names its best option');
  check(await page.locator('#hinges tr.hrow').count() === 7, 'the example has seven uncertain assumptions in the hinge table');

  // new blank case through the UI
  await page.locator('.manage summary').click();
  await page.locator('#btn-new').click();
  await settle(page);
  check((await page.locator('#title').inputValue()) === 'Untitled decision', 'New blank case opens');
  await page.locator('#title').fill('Fly or drive?');
  await page.locator('#unit').fill('$');
  await page.locator('#goal').selectOption('min');
  // rename the blank row "a" to "fare" (the option formula should follow)
  const name0 = page.locator('#rows .row').nth(0).locator('.name');
  await name0.click();
  await name0.fill('fare');
  await name0.press('Tab');
  await settle(page, 300);
  check((await page.locator('#options .opt .expr').nth(0).inputValue()) === 'fare', 'renaming a row rewrites the formulas that use it');
  await page.locator('#rows .row').nth(0).locator('.lo').fill('180');
  await page.locator('#rows .row').nth(0).locator('.hi').fill('320');
  // add a chance and a range
  await page.locator('.adders .add[data-kind="chance"]').click();
  let li = page.locator('#rows .row').nth(1);
  await li.locator('.name').fill('delayed');
  await li.locator('.name').press('Tab');
  await li.locator('.p').fill('25%');
  await page.locator('.adders .add[data-kind="range"]').click();
  li = page.locator('#rows .row').nth(2);
  await li.locator('.name').fill('Fuel cost');
  await li.locator('.name').press('Tab');
  check((await li.locator('.name').inputValue()) === 'fuel_cost', 'names are cleaned into identifiers on blur');
  await li.locator('.lo').fill('90');
  await li.locator('.hi').fill('140');
  await page.locator('.adders .add[data-kind="fixed"]').click();
  li = page.locator('#rows .row').nth(3);
  await li.locator('.name').fill('hotel');
  await li.locator('.name').press('Tab');
  await li.locator('.value').fill('150');
  // options
  await page.locator('#options .opt').nth(0).locator('.oname').fill('Fly');
  await page.locator('#options .opt').nth(0).locator('.expr').fill('fare + if(delayed, 120, 0)');
  await page.locator('#btn-add-option').click();
  await page.locator('#options .opt').nth(1).locator('.oname').fill('Drive');
  await page.locator('#options .opt').nth(1).locator('.expr').fill('fuel_cost + hotel');
  await settle(page, 1200);
  let text = await summary(page);
  check(/On expected value, \*?\*?(Fly|Drive)/.test(text) || /is cheaper than/.test(text), `a decision summary appears: ${text.split('\n')[0]}`);
  check(await page.locator('#errors').isHidden(), 'no errors for the new case');
  check((await page.locator('#hinges tr.hrow').count()) === 3, 'three uncertain rows in the hinge table');
  // an invalid formula shows an inline error and keeps the old results dimmed
  await page.locator('#options .opt').nth(1).locator('.expr').fill('fuel_cost + hotl');
  await settle(page, 600);
  check((await page.locator('#options .opt').nth(1).locator('.err').innerText()).includes('Unknown name "hotl"'), 'typo in a formula is reported inline');
  check(await page.locator('#out').evaluate((el) => el.classList.contains('stale')), 'results are marked stale while the case is broken');
  await page.locator('#options .opt').nth(1).locator('.expr').fill('fuel_cost + hotel');
  await settle(page, 900);
  check(await page.locator('#errors').isHidden() && !(await page.locator('#out').evaluate((el) => el.classList.contains('stale'))), 'fixing the formula clears the error');
  // edit a value and see the mean change
  const meanBefore = await page.locator('#strips .strip-head .nums').nth(1).innerText();
  await page.locator('#rows .row').nth(3).locator('.value').fill('400');
  await settle(page, 900);
  const meanAfter = await page.locator('#strips .strip-head .nums').nth(1).innerText();
  check(meanBefore !== meanAfter, `editing a fixed value changes the outcome (${meanBefore} → ${meanAfter})`);
  // tap a hinge row: the curve title follows
  await page.locator('#hinges tr.hrow').nth(1).click();
  const picked = await page.locator('#hinges tr.hrow').nth(1).locator('td.name').innerText();
  const title = await page.locator('#curve-title').innerText();
  check(title.includes(picked.split('\n')[0]), `tapping a row shows its curve (${title})`);
  // hover readout on the curve
  const box = await page.locator('#curve svg').boundingBox();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.4);
  await settle(page, 200);
  check(await page.locator('#tip').isVisible(), 'hovering the curve shows a readout');
  // two-step delete: one click arms, a second deletes
  const rowsBefore = await page.locator('#rows .row').count();
  await page.locator('#rows .row').nth(3).locator('.del').click();
  await settle(page, 200);
  check((await page.locator('#rows .row').count()) === rowsBefore, 'one click on × does not delete');
  await page.locator('#rows .row').nth(3).locator('.del').click();
  await settle(page, 400);
  check((await page.locator('#rows .row').count()) === rowsBefore - 1, 'a second click deletes the row');
  await settle(page, 900);
  check((await page.locator('#options .opt').nth(1).locator('.err').innerText()).includes('Unknown name "hotel"'), 'the formula that used it now reports the missing name');
  await page.locator('#options .opt').nth(1).locator('.expr').fill('fuel_cost + 150');
  await settle(page, 900);
  // reload: the case and the edits persist
  await page.reload({ waitUntil: 'load' });
  await settle(page, 1000);
  check((await page.locator('#title').inputValue()) === 'Fly or drive?', 'the new case is still current after a reload');
  check((await page.locator('#rows .row').count()) === 3 && (await page.locator('#options .opt').nth(1).locator('.expr').inputValue()) === 'fuel_cost + 150', 'edits persisted');
  check((await page.locator('#case-select option').count()) === 2, 'two cases are listed');
  // export
  await page.locator('.manage summary').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-export').click()]);
  const file = path.join(tmp, download.suggestedFilename());
  await download.saveAs(file);
  exported = JSON.parse(fs.readFileSync(file, 'utf8'));
  check(exported.title === 'Fly or drive?' && exported.rows.length === 3 && exported.options.length === 2 && exported.goal === 'min', `export is a complete case (${download.suggestedFilename()})`);
  // duplicate, then delete with confirmation (dismiss first, then accept)
  await page.locator('#btn-dup').click();
  await settle(page, 600);
  check((await page.locator('#case-select option').count()) === 3 && (await page.locator('#title').inputValue()).endsWith('(copy)'), 'duplicate makes a copy');
  page.once('dialog', (d) => d.dismiss());
  await page.locator('#btn-delete').click();
  await settle(page, 300);
  check((await page.locator('#case-select option').count()) === 3, 'dismissing the dialog keeps the case');
  page.once('dialog', (d) => d.accept());
  await page.locator('#btn-delete').click();
  await settle(page, 600);
  check((await page.locator('#case-select option').count()) === 2, 'accepting the dialog deletes it');
  // switch back to the example via the select, and load another example
  await page.locator('#case-select').selectOption({ index: 0 });
  await settle(page, 1000);
  check((await summary(page)).includes('Startup'), 'switching cases restores the example');
  await page.locator('#example-select').selectOption('rewrite');
  await settle(page, 1200);
  check((await page.locator('#hinge-title').innerText()).includes('uncertainty comes from'), 'an estimate example shows the variance table');
  check((await page.locator('#strips').innerText()).includes('Target 12 weeks'), 'the target line appears for an estimate');
  check((await page.locator('#hinges tr.total td.name').innerText()) === 'the rest', 'an estimate labels what the shares leave over "the rest" (interactions plus slicing loss)');
  // one uncertain input: it carries all the variance, and there is no interactions row
  await page.evaluate(() => window.hinge.loadExample('blank'));
  await settle(page, 900);
  check((await page.locator('#hinges tr.total').count()) === 0, 'with one uncertain input there is no interactions row');
  const share1 = await page.locator('#hinges tr.hrow td.bar span').first().innerText();
  check(parseFloat(share1) >= 98, `one uncertain input carries all the variance (${share1})`);
  // a normal range that starts at zero says how often it goes below zero
  const li0 = page.locator('#rows .row').nth(0);
  await li0.locator('.lo').fill('0');
  await li0.locator('.hi').fill('3');
  check(/5% chance below 0/.test(await li0.locator('.dist-note').innerText()), 'a range from 0 to 3 warns that it goes below zero 5% of the time');
  // a decision shows each row's share of the variance under its bar
  await page.evaluate(() => window.hinge.loadExample('house'));
  await settle(page, 1300);
  const shareTxt = await page.locator('#hinges tr.hrow', { hasText: 'market_return' }).locator('small.share').innerText();
  check(/^7(\.\d)?% of variance$/.test(shareTxt), `a decision shows each row's share of the variance (market_return: ${shareTxt})`);
  // three options: each stretch of the flip set names the option that wins there
  await page.evaluate(() => window.hinge.importText(JSON.stringify({ title: 'Three ways', rows: [{ name: 'x', kind: 'range', lo: -1.5449, hi: 1.7449, shape: 'normal' }], options: [{ name: 'A', expr: 'x' }, { name: 'B', expr: '0.3' }, { name: 'C', expr: '-x' }] })));
  await settle(page, 1200);
  const flipCell = await page.locator('#hinges tr.hrow td.flip').first().innerText();
  check(/below −0\.3 → C \(34%\)/.test(flipCell) && /above 0\.3 → A \(42%\)/.test(flipCell), `three options: each stretch names its own winner (${flipCell.replace(/\n/g, ' / ')})`);
  check(!/big wins/.test(await summary(page)), 'and the verdict does not blame big wins for a constant option');
  check(errors.length === 0, `no console errors on desktop${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await ctx.close();
}

// ---------------------------------------------------------------- fresh context: import the export
{
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  wrap(page, errors);
  await page.goto(URL_, { waitUntil: 'load' });
  await settle(page, 800);
  check((await page.locator('#case-select option').count()) === 1, 'a fresh browser starts with just the example');
  await page.locator('.manage summary').click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#btn-import').click()]);
  const file = path.join(tmp, 'import.json');
  fs.writeFileSync(file, JSON.stringify(exported));
  await chooser.setFiles(file);
  await settle(page, 1200);
  check((await page.locator('#title').inputValue()) === 'Fly or drive?' && (await page.locator('#rows .row').count()) === 3, 'importing the exported file recreates the case');
  check((await page.locator('#case-msg').innerText()).includes('Imported'), 'import is confirmed');
  // junk import is refused politely
  const [chooser2] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#btn-import').click()]);
  const bad = path.join(tmp, 'bad.json');
  fs.writeFileSync(bad, 'not json');
  await chooser2.setFiles(bad);
  await settle(page, 500);
  check((await page.locator('#case-msg').innerText()).includes('not JSON'), 'junk import is refused');
  check(errors.length === 0, `no console errors on import${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await ctx.close();
}

// ---------------------------------------------------------------- no localStorage at all
{
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('storage disabled'); } });
  });
  const page = await ctx.newPage();
  wrap(page, errors);
  await page.goto(URL_, { waitUntil: 'load' });
  await settle(page, 1000);
  check((await summary(page)).includes('Startup'), 'without localStorage the example still loads and computes');
  await page.locator('#rows .row').nth(1).locator('.lo').fill('150k');
  await settle(page, 900);
  check(await page.locator('#errors').isHidden(), 'editing works without storage');
  check(errors.length === 0, `no console errors without storage${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await ctx.close();
}

// ---------------------------------------------------------------- phone: touch, reduced motion, dark, button-mashing
{
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: 'dark', reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  wrap(page, errors);
  await page.goto(URL_, { waitUntil: 'load' });
  await settle(page, 1200);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(over <= 0, `no horizontal overflow on a phone (${over}px)`);
  const resultsTop = await page.locator('#results').evaluate((el) => el.getBoundingClientRect().top);
  const modelTop = await page.locator('.model').evaluate((el) => el.getBoundingClientRect().top);
  check(resultsTop < modelTop, 'on a phone the verdict comes before the editor');
  const row = page.locator('#hinges tr.hrow').nth(2);
  await row.scrollIntoViewIfNeeded();
  const b = await row.boundingBox();
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  await settle(page, 400);
  check(await row.evaluate((el) => el.classList.contains('selected')), 'tapping a hinge row on a phone selects it');
  const svg = page.locator('#curve svg');
  await svg.scrollIntoViewIfNeeded();
  const sb = await svg.boundingBox();
  await page.touchscreen.tap(sb.x + sb.width * 0.5, sb.y + sb.height * 0.5);
  await settle(page, 300);
  check(await page.locator('#tip').isVisible(), 'touching the curve shows the readout');
  // blind clicks on the first dozen visible buttons (what the smoke test does) must not damage the example
  const rowsBefore = await page.locator('#rows .row').count();
  const optsBefore = await page.locator('#options .opt').count();
  const buttons = page.locator('button:visible');
  const n = Math.min(await buttons.count(), 12);
  for (let i = 0; i < n; i++) { try { await buttons.nth(i).click({ timeout: 800 }); await settle(page, 120); } catch { /* obscured */ } }
  await settle(page, 3500);
  check((await page.locator('#rows .row').count()) >= rowsBefore && (await page.locator('#options .opt').count()) >= optsBefore, 'a dozen blind clicks delete nothing (only add)');
  check(!(await page.locator('#rows .row .del.armed').count()), 'armed delete buttons disarm by themselves');
  check((await page.locator('#case-select option').count()) >= 1, 'the example case is still there');
  check(errors.length === 0, `no console errors on a phone${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
