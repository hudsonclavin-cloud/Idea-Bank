// End-to-end check of the page in headless Chromium: typing, dragging, tapping,
// warping, examples, the formula builder, Save SVG and Print.
// Uses the same globally installed Playwright as tools/smoke.mjs.
// Run from the repo root: node ideas/10-alignment-charts/tests/ui-check.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

function loadPlaywright() {
  const req = createRequire(import.meta.url);
  try {
    return req('playwright');
  } catch {
    const g = execSync('npm root -g', { encoding: 'utf8' }).trim();
    return createRequire(path.join(g, 'noop.js'))('playwright');
  }
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(ROOT)) return res.writeHead(403).end();
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  fs.readFile(p, (err, data) => {
    if (err) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

let failures = 0;
let passes = 0;
function check(cond, msg) {
  if (cond) passes++;
  else {
    failures++;
    console.log(`  FAIL ${msg}`);
  }
}

const { chromium } = loadPlaywright();
const browser = await chromium.launch();
const errors = [];

async function open(context, hash) {
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}/index.html#${hash}`);
  await page.waitForFunction(() => window.alignmentCharts?.state?.g);
  await page.waitForTimeout(150);
  return page;
}
const val = (page, key) => page.inputValue(`#in-${key}`);
const settle = (page) => page.waitForTimeout(120);
const pt = (page, key, v) => page.evaluate(([k, x]) => window.alignmentCharts.clientPoint(k, x), [key, v]);

// ---------------------------------------------------------------- desktop, mouse
{
  console.log('desktop');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
  const page = await open(ctx, 'bayes');
  check((await val(page, 'post')) === '63.2', `default reading 63.2, got ${await val(page, 'post')}`);

  await page.fill('#in-pre', '10');
  await settle(page);
  check((await val(page, 'post')) === '30.8', `typed pre 10 -> post 30.8, got ${await val(page, 'post')}`);

  // Drag the pre-test pin from 10% to 50% along its scale (the input still has focus).
  await page.locator('#stage').scrollIntoViewIfNeeded();
  const [x0, y0] = await pt(page, 'pre', 10);
  const [x1, y1] = await pt(page, 'pre', 50);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x0 + 3, y0 + ((y1 - y0) * i) / 8);
  await page.mouse.up();
  await settle(page);
  const pre = parseFloat(await val(page, 'pre'));
  check(Math.abs(pre - 50) < 0.6, `dragged pre to ~50, got ${pre}`);
  check(Math.abs(parseFloat(await val(page, 'post')) - 80) < 1, `post after drag ~80, got ${await val(page, 'post')}`);

  // Tap the post-test scale: the older pin (LR) swings over, so LR becomes the reading.
  const [px, py] = await pt(page, 'post', 90);
  await page.mouse.click(px, py);
  await settle(page);
  const lrNow = parseFloat(await val(page, 'lr'));
  const preNow = parseFloat(await val(page, 'pre'));
  const want = (90 / 10) / (preNow / (100 - preNow));
  check(Math.abs(lrNow - want) / want < 0.01, `tap post=90 reads LR ${lrNow}, formula ${want.toFixed(3)}`);
  check((await page.textContent('.row[data-key="lr"] .tag')) === 'read', 'LR row is now the read row');

  // Warp: drag a corner, then shuffle. Readings must not move.
  const before = await val(page, 'lr');
  await page.click('#btn-warp');
  check((await page.getAttribute('#btn-warp', 'aria-pressed')) === 'true', 'warp mode on');
  const [cx, cy] = await page.evaluate(() => window.alignmentCharts.cornerPoint(1));
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(cx - 20 * i, cy + 15 * i);
  await page.mouse.up();
  await settle(page);
  const corner = await page.evaluate(() => window.alignmentCharts.state.corners[1]);
  check(Math.abs(corner[0] - 1) > 0.05, `corner moved (u = ${corner[0].toFixed(3)})`);
  check((await val(page, 'lr')) === before, `reading unchanged by corner drag: ${before} -> ${await val(page, 'lr')}`);
  check((await page.locator('#layer-warp .ac-corner').count()) === 4, 'four corner handles shown');
  await page.click('#btn-shuffle');
  await page.waitForTimeout(950);
  check((await val(page, 'lr')) === before, `reading unchanged by shuffle: ${await val(page, 'lr')}`);
  await page.click('#btn-flatten');
  await page.waitForTimeout(950);
  const flat = await page.evaluate(() => window.alignmentCharts.state.corners.flat().map((x) => +x.toFixed(6)));
  check(JSON.stringify(flat) === '[0,0,1,0,1,1,0,1]', `flatten restores the sheet: ${flat}`);
  await page.click('#btn-warp');

  // Quadratic: two roots, a touch, a miss.
  await page.click('.picker button[data-id="quadratic"]');
  await settle(page);
  check((await val(page, 'z')) === '2 or 5', `quadratic default roots "2 or 5", got "${await val(page, 'z')}"`);
  check((await page.locator('#layer-edge .ac-read').count()) === 2, 'two reading rings on the curve');
  await page.getByRole('button', { name: /just touches/ }).click();
  await settle(page);
  check((await val(page, 'z')) === '3', `double root 3, got "${await val(page, 'z')}"`);
  await page.getByRole('button', { name: /misses/ }).click();
  await settle(page);
  check((await val(page, 'z')) === '', `no real roots -> empty, got "${await val(page, 'z')}"`);
  check((await page.textContent('#check')).includes('No answer'), 'check line explains the miss');

  // Pace: solve for distance by typing a pace into the read row.
  await page.click('.picker button[data-id="pace"]');
  await settle(page);
  check((await val(page, 'pace')) === '5:41', `sub-4 marathon pace 5:41, got ${await val(page, 'pace')}`);
  await page.fill('#in-time', '3h30');
  await settle(page);
  await page.fill('#in-pace', '5:00');
  await settle(page);
  check((await val(page, 'dist')) === '42', `3h30 at 5:00/km reads 42 km, got ${await val(page, 'dist')}`);
  await page.locator('#in-pace').blur();

  // Out-of-range input is flagged, not applied.
  await page.fill('#in-pace', '1:00');
  await settle(page);
  check((await page.getAttribute('#in-pace', 'aria-invalid')) === 'true', 'out-of-range pace flagged');
  await page.locator('#in-pace').blur();

  // Builder: error, recovery, preset.
  await page.click('.picker button[data-id="custom"]');
  await settle(page);
  check(await page.isVisible('#builder'), 'builder visible for custom chart');
  await page.fill('#b-u-min', '0');
  await page.waitForTimeout(300);
  check((await page.textContent('#b-error')).includes('positive'), `zero range rejected: "${await page.textContent('#b-error')}"`);
  await page.fill('#b-u-min', '0.01');
  await page.waitForTimeout(300);
  check((await page.textContent('#b-error')) === '', 'error clears when fixed');
  await page.selectOption('#b-preset', 'bmi');
  await page.waitForTimeout(300);
  check((await page.innerHTML('#chart-formula')).includes('<sup>−2</sup>'), 'BMI formula shows the -2 power');
  await page.fill('#in-u', '70');
  await settle(page);
  await page.fill('#in-v', '1.75');
  await settle(page);
  check((await val(page, 'w')) === '22.9', `BMI 70 kg, 1.75 m = 22.9, got ${await val(page, 'w')}`);

  // Save SVG produces a standalone, printable sheet.
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-svg')]);
  const file = path.join(os.tmpdir(), `alignment-${Date.now()}.svg`);
  await dl.saveAs(file);
  const svg = fs.readFileSync(file, 'utf8');
  check(svg.startsWith('<?xml') && svg.includes('<svg') && svg.includes('class="ac-sheet"'), 'SVG download is a standalone sheet');
  check(svg.includes('Worked example') && svg.includes('BMI'), 'sheet carries the worked example');
  fs.rmSync(file);

  // Print renders the sheet into the print container.
  await page.evaluate(() => {
    window.__printed = 0;
    window.print = () => window.__printed++;
  });
  await page.click('#btn-print');
  check((await page.evaluate(() => window.__printed)) === 1, 'print called once');
  check((await page.locator('#print-sheet svg.ac-sheet').count()) === 1, 'print sheet rendered');
  await ctx.close();
}

// ---------------------------------------------------------------- phone, touch
{
  console.log('phone');
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await open(ctx, 'harmonic');
  check((await val(page, 'c')) === '2', `harmonic default 3 || 6 = 2, got ${await val(page, 'c')}`);
  // Tap the b scale at 12: b's pin moves there, a stays at 3 -> c = 2.4
  await page.locator('#stage').scrollIntoViewIfNeeded();
  const [bx, by] = await pt(page, 'b', 12);
  await page.touchscreen.tap(bx, by);
  await settle(page);
  const b = parseFloat(await val(page, 'b'));
  check(Math.abs(b - 12) < 0.3, `tapped b ~12, got ${b}`);
  const c = parseFloat(await val(page, 'c'));
  check(Math.abs(c - (3 * b) / (3 + b)) < 0.02, `c = 3b/(3+b) for b=${b}, got ${c}`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, `no horizontal overflow on phone (${overflow}px)`);
  for (const id of ['bayes', 'dew', 'pace', 'quadratic', 'custom']) {
    await page.click(`.picker button[data-id="${id}"]`);
    await settle(page);
    const labels = await page.locator('#layer-scales .ac-lb').count();
    check(labels >= 20, `${id}: ${labels} tick labels on phone`);
  }
  await ctx.close();
}

await browser.close();
server.close();
check(errors.length === 0, `no console errors (${errors.join(' | ')})`);
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
