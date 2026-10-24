// Drives the real page in headless Chromium, when Playwright is installed (skips otherwise).
// Run from the repo root: node --test ideas/71-first-light/ui.test.mjs
//
// The model tests (firstlight.test.mjs) check the light; these check that the page passes it on. Each
// pins something the independent review found the page saying wrongly or not at all: the second stripe
// your slot lets in, light that passes the end of the far wall, the slit shutting to steep light, the
// band of direct sun under a raised skyline, why grooves are left out, a column left by your slot, the
// days a degree of turning costs, and the stops Play makes when asked not to animate. The last test pins
// two things a second check found: a second beam that lands on the far slit's flared sides, and the
// reason the page gives when your slot is not cut.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const F = require('./firstlight.js');
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

// Open the page, set the place fields as a person would, and move the day slider to day n of the year.
async function open(set, n, opts = {}) {
  const ctx = await (await browser()).newContext({ viewport: { width: 1280, height: 900 }, ...opts });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(URL_);
  for (const [id, v] of Object.entries(set)) {
    if (id === 'yourMonth' || id === 'yourDate') await page.selectOption('#' + id, String(v));
    else await page.fill('#' + id, String(v));
  }
  await page.waitForTimeout(300); // the page rebuilds 120 ms after the last change
  if (n) await page.$eval('#day', (el, n) => { el.value = String(n); el.dispatchEvent(new Event('input', { bubbles: true })); }, n);
  const text = (sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim());
  return { ctx, page, errors, text };
}
const year = Math.min(2100, Math.max(2000, new Date().getFullYear()));

test('the readout names the second stripe your slot lets in, and the facts say how to stop it', { skip }, async () => {
  // 45 N, your day 14 May, 9 February: the slot in the east wall puts a second stripe near a groove
  const o = await open({ lat: 45, yourMonth: 5, yourDate: 14 }, 40);
  const d = F.design({ lat: 45, day: '05-14' }), track = F.yearTrack(d, year);
  const k = F.slotLeak(d, 'rise', track[39].ampRise);
  const readout = await o.text('#readout');
  assert.match(readout, new RegExp(`A second stripe, let in by your slot in the east wall, falls ${Math.abs(k.mm).toFixed(1)} mm south of the slit`));
  const facts = await o.text('#facts');
  const lk = F.leaks(d, track);
  assert.match(facts, new RegExp(`on ${lk.rise.length} mornings and ${lk.set.length} evenings`));
  assert.match(facts, /opaque tape over the outside of each slot/);
  assert.deepEqual(o.errors, []);
  await o.ctx.close();
});

test('light past the end of the far wall is not given a place on it, and grooves left out get their real reason', { skip }, async () => {
  // 58 N with 5 degree skylines, 21 December: the first version said it landed 106.6 mm along a wall 100.8 mm long
  const o = await open({ lat: 58, horizonE: 5, horizonW: 5 }, F.isLeap(year) ? 356 : 355);
  const readout = await o.text('#readout');
  assert.match(readout, /passes the end of the west wall and falls on the inside of the east wall, near the north tip/);
  assert.doesNotMatch(readout, /lands [\d.]+ mm/);
  const drop = await o.text('#dropNote');
  assert.match(drop, /2 grooves that would sit within 4 mm of a tip/);
  assert.doesNotMatch(drop, /crowded/);
  await o.ctx.close();
});

test('the page says how much of a narrow slit steep light gets through, and when none does', { skip }, async () => {
  let o = await open({ lat: 58, slit: 0.8 }, 172);
  const note = await o.text('#slitNote');
  assert.match(note, /0\.13 mm of the 0\.8 mm slit lets it through \(16%\)/);
  assert.match(note, /choose a wider slit than the narrowest clean one on the coupon/);
  await o.ctx.close();
  o = await open({ lat: 58, slit: 0.8, horizonE: 5, horizonW: 5 }, F.isLeap(year) ? 356 : 355);
  assert.match(await o.text('#readout'), /Morning light does not get in/);
  assert.match(await o.text('#slitNote'), /no light gets in at all/);
  await o.ctx.close();
});

test('under a raised skyline the page names the sunlit band; a column left by your slot is warned of', { skip }, async () => {
  let o = await open({ lat: 45, horizonE: 5 }, 120);
  assert.match(await o.text('#floodNote'), /the west wall above 21\.5 mm is in direct sun/);
  await o.ctx.close();
  o = await open({ lat: 15, size: 70, slit: 0.8, yourMonth: 3, yourDate: 10 }, 60);
  assert.match(await o.text('#dropNote'), /a column 28 mm tall, joined to the box only through the floor/);
  await o.ctx.close();
});

test('a degree of turning is given in days for the place, not as one to two days everywhere', { skip }, async () => {
  const o = await open({ lat: 0 }, 80);
  const d = F.design({ lat: 0 }), b = F.budget(d, F.yearTrack(d, year), year);
  assert.equal(await o.text('#turnDays'), b.rows.find((r) => r.key === 'turn').daysEq.toFixed(1));
  assert.ok(+(await o.text('#turnDays')) > 2.5);
  await o.ctx.close();
});

test('asked not to animate, Play steps to the next groove date, including the ones the first version skipped', { skip }, async () => {
  // From 1 January at 45 N the first version jumped to 20 January, past 5 January, a date in the key.
  const o = await open({ lat: 45 }, 1, { reducedMotion: 'reduce' });
  await o.page.click('#play');
  const first = await o.text('#dayLabel');
  await o.page.click('#play');
  const d = F.design({ lat: 45 }), track = F.yearTrack(d, year);
  const next = F.readingStops(d, track, year).find((n) => n > 1);
  assert.equal(first, `${track[next - 1].day} January`);
  assert.ok(track[next - 1].day <= 6, first);
  await o.ctx.close();
});

test('a second beam that meets the far slit is named as light in the box, and a slot is said to be lost for the reason it was', { skip }, async () => {
  // 45 N, your day 14 May, 17 January: both second beams land on the flared sides of the far slits, and
  // none of either goes out. The last version drew them leaving the box and the readout said nothing.
  let o = await open({ lat: 45, yourMonth: 5, yourDate: 14 }, 17);
  const readout = await o.text('#readout');
  assert.match(readout, /A second patch of light, let in by your slot in the east wall, falls on the flared sides of the west slit\./);
  assert.match(readout, /A second patch of light, let in by your slot in the west wall, falls on the flared sides of the east slit\./);
  const d = F.design({ lat: 45, day: '05-14' }), lk = F.leaks(d, F.yearTrack(d, year));
  const onSlit = [...lk.rise, ...lk.set].filter((x) => x.onCut === 'slit').length;
  assert.match(await o.text('#facts'), new RegExp(`on ${onSlit} of those mornings and evenings, a patch of light on the flared sides of the far slit`));
  assert.deepEqual(o.errors, []);
  await o.ctx.close();
  // 58 N, 5 degree skylines, your day 21 December: both slots are left out because they would sit within
  // 4 mm of a tip (the light passes the end of the wall). The last version said the day was too close to
  // the far slit, in three places.
  o = await open({ lat: 58, horizonE: 5, horizonW: 5, yourMonth: 12, yourDate: 21 }, F.isLeap(year) ? 356 : 355);
  const d2 = F.design({ lat: 58, horizonE: 5, horizonW: 5, day: '12-21' });
  assert.deepEqual(d2.dropped.filter((x) => x.kind === 'slot').map((x) => x.reason), ['too close to the tip', 'too close to the tip']);
  const drop = await o.text('#dropNote'), facts = await o.text('#facts'), mine = await o.text('#key tr.mine');
  assert.match(drop, /No slot is cut for your day's morning and evening light: it falls too near the ends of the west and east walls, or past them/);
  assert.match(facts, /no slot is cut for the morning light, which falls too near the end of the west wall, or past it/);
  assert.match(facts, /no slot is cut for the evening light, which falls too near the end of the east wall, or past it/);
  assert.match(mine, /not cut: too near the end of the wall, or past it/);
  for (const t of [drop, facts, mine]) assert.doesNotMatch(t, /too close to the far slit|too near the far slit|too close to due east/);
  assert.deepEqual(o.errors, []);
  await o.ctx.close();
  // 45 N, your day 20 March: both slots are left out because they would crowd the far slit, and the page says so
  o = await open({ lat: 45, yourMonth: 3, yourDate: 20 }, 80);
  assert.match(await o.text('#dropNote'), /Your day falls too close to due east and due west for a slot of its own: its morning and evening light passes through the far slit/);
  assert.match(await o.text('#key tr.mine'), /not cut: too near the far slit/);
  await o.ctx.close();
});
