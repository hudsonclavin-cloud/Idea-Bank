#!/usr/bin/env node
// Drives the page in headless Chromium and checks what a person would do with it, at phone
// width by touch and at desktop width by mouse and keyboard. Not run by tools/check.mjs (it
// needs a browser); run it from the repo root with: node ideas/74-whose-turn/ui-check.mjs
// Uses the globally installed Playwright, as tools/smoke.mjs does.
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const URL0 = pathToFileURL(path.join(here, 'index.html')).href;
let pw;
try {
  pw = createRequire(import.meta.url)('playwright');
} catch {
  pw = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'noop.js'))('playwright');
}
const browser = await pw.chromium.launch();
let failures = 0;
let checks = 0;
function ok(cond, msg) {
  checks++;
  if (!cond) {
    failures++;
    console.log(`FAIL ${msg}`);
  }
}
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const DESK = { viewport: { width: 1280, height: 860 } };

async function open(opts, init, url = URL0) {
  const context = await browser.newContext(opts);
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  if (init) await page.addInitScript(init);
  await page.goto(url);
  await page.waitForTimeout(150);
  return { context, page, errors };
}
const historyCount = (page) => page.locator('#history li .x').count();
const allEntries = (page) => page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('whose-turn.v1'));
  const c = s.circles.find((x) => x.id === s.current);
  const removed = new Set(c.removed);
  return c.events.filter((e) => !removed.has(e.id)).length;
});
const whose = (page) => page.locator('.whose .nm').textContent();
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);

// 1. Phone, touch: the example, toggling people, logging, the cool-down, undo.
{
  const { context, page, errors } = await open(PHONE);
  ok((await page.locator('.person[aria-pressed="true"]').count()) === 4, 'example starts with four people in');
  const first = await whose(page);
  ok(['Ana', 'Ben', 'Cleo', 'Dev'].includes(first), `a pick is shown (${first})`);
  await page.locator('.person', { hasText: first }).tap();
  const second = await whose(page);
  ok(second !== first, `taking ${first} out changes the pick (now ${second})`);
  await page.locator('.person', { hasText: first }).tap();
  ok((await whose(page)) === first, 'putting them back restores the pick');
  const before = await allEntries(page);
  await page.locator('#log-pick').tap();
  ok((await allEntries(page)) === before + 1, 'tapping the button logs one entry');
  ok(await page.locator('#log-pick').isDisabled(), 'the button rests for a moment after logging');
  for (let i = 0; i < 5; i++) await page.locator('#log-pick').dispatchEvent('click');
  ok((await allEntries(page)) === before + 1, 'fast repeated taps during the rest log nothing more');
  ok(await page.locator('#toast').isVisible(), 'a toast confirms the entry');
  await page.locator('#toast button').tap();
  ok((await allEntries(page)) === before, 'undo removes it');
  ok(!(await overflow(page)), 'no sideways scroll at 390 px');
  // someone else did it
  await page.waitForTimeout(1200);
  await page.locator('#log-other').tap();
  const items = page.locator('.other-item');
  ok((await items.count()) === 3, 'three other people offered');
  const effects = await page.locator('.other-item .eff').allTextContents();
  ok(effects.every((t) => /^fence (stays the same|widens to ±|narrows to ±)/.test(t)), `each says what happens to the fence (${effects.join(' | ')})`);
  await items.last().tap();
  ok((await allEntries(page)) === before + 1, 'logging someone else adds one entry');
  const replay = await page.locator('#replay').textContent();
  ok(/went to the pick/.test(replay), `the replay line reports it (${replay})`);
  ok(errors.length === 0, `no console errors on phone: ${errors.join('; ')}`);
  await context.close();
}

// 2. Desktop, keyboard: a held Enter logs once; Space toggles a person.
{
  const { context, page, errors } = await open(DESK);
  const before = await allEntries(page);
  await page.locator('#log-pick').focus();
  for (let i = 0; i < 25; i++) await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  ok((await allEntries(page)) === before + 1, 'holding Enter on the button logs exactly once');
  await page.waitForTimeout(1200);
  const chip = page.locator('.person').first();
  await chip.focus();
  const was = await chip.getAttribute('aria-pressed');
  await page.keyboard.press('Space');
  ok((await page.locator('.person').first().getAttribute('aria-pressed')) !== was, 'Space toggles a person');
  ok(errors.length === 0, `no console errors on desktop: ${errors.join('; ')}`);
  await context.close();
}

// 3. A new rounds circle, from the form.
{
  const { context, page, errors } = await open(PHONE);
  await page.locator('#new-circle').tap();
  await page.locator('#create-name').fill('Coffee');
  await page.locator('input[value="rounds"]').check();
  await page.locator('#create-people').fill('Ines, Jo, Kofi\nLiu, Mo');
  await page.locator('#create form button[type="submit"], #create-form button[type="submit"]').first().tap();
  ok((await page.locator('#circle-name').textContent()) === 'Coffee', 'the new circle is shown');
  ok((await page.locator('.person').count()) === 5, 'with five people');
  ok(/’s round$/.test(await page.locator('.whose').textContent()), 'rounds say "round"');
  const promise = await page.locator('#promise').textContent();
  ok(/±4 portions/.test(promise), `a rounds circle of five promises ±4 portions (${promise})`);
  await page.locator('.person', { hasText: 'Mo' }).tap();
  await page.locator('.person', { hasText: 'Liu' }).tap();
  const p1 = await whose(page);
  await page.locator('#log-pick').tap();
  const rows = await page.locator('#rows .val').allTextContents();
  ok(rows.some((t) => /has bought 2 more than had/.test(t)), `the buyer for three is 2 portions ahead (${rows.join(' | ')})`);
  ok(p1 === 'Ines', `the first round goes to the first name (${p1})`);
  ok(errors.length === 0, `no console errors creating a circle: ${errors.join('; ')}`);
  await context.close();
}

// 4. Two phones: copy a code, merge, log on both, merge back. Then a link with the code in it.
{
  const A = await open(PHONE);
  await A.page.locator('#share summary').tap();
  const codeA = await A.page.locator('#code-out').inputValue();
  ok(/^WHOSETURN1:/.test(codeA), 'phone A shows a ledger code');
  const B = await open(PHONE, () => localStorage.setItem('whose-turn.v1', JSON.stringify({ v: 1, circles: [], current: null, present: {}, exampleGone: true })));
  ok(await B.page.locator('#create').isVisible(), 'an empty phone opens on "Start a circle"');
  await B.page.locator('#create-cancel').tap();
  await B.page.evaluate(() => (document.getElementById('share').open = true));
  await B.page.locator('#main').evaluate((m) => (m.hidden = false));
  await B.page.locator('#code-in').fill(`here: ${codeA} thanks`);
  await B.page.locator('#merge-code').tap();
  ok(/Added/.test(await B.page.locator('#share-msg').textContent()), 'phone B adds the circle from the code');
  const nA = await allEntries(A.page);
  ok((await allEntries(B.page)) === nA, 'with every entry');
  await A.page.locator('#log-pick').tap();
  await B.page.waitForTimeout(1200);
  await B.page.locator('#log-pick').tap();
  const codeB = await B.page.locator('#code-out').inputValue();
  await A.page.locator('#code-in').fill(codeB);
  await A.page.locator('#merge-code').tap();
  ok(/1 new entry/.test(await A.page.locator('#share-msg').textContent()), `merging back brings one new entry (${await A.page.locator('#share-msg').textContent()})`);
  ok((await allEntries(A.page)) === nA + 2, 'phone A now has both new entries');
  const codeA2 = await A.page.locator('#code-out').inputValue();
  await B.page.locator('#code-in').fill(codeA2);
  await B.page.locator('#merge-code').tap();
  ok((await allEntries(B.page)) === nA + 2, 'and so does phone B after one more merge');
  const balA = await A.page.locator('#rows .val').allTextContents();
  const balB = await B.page.locator('#rows .val').allTextContents();
  ok(JSON.stringify(balA) === JSON.stringify(balB), 'both phones show the same balances');
  // a link
  const C = await open(PHONE, () => localStorage.setItem('whose-turn.v1', JSON.stringify({ v: 1, circles: [], current: null, present: {}, exampleGone: true })), `${URL0}#${codeA2}`);
  ok(/This link carries a ledger/.test(await C.page.locator('#notices').textContent()), 'a link with a code offers to add it');
  await C.page.locator('#notices button', { hasText: 'Add it' }).tap();
  ok((await allEntries(C.page)) === nA + 2, 'and adds it');
  for (const X of [A, B, C]) {
    ok(X.errors.length === 0, `no console errors while sharing: ${X.errors.join('; ')}`);
    await X.context.close();
  }
}

// 5. Storage blocked: still works, and says so.
{
  const { context, page, errors } = await open(PHONE, () => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });
  });
  ok(/isn't letting the page keep anything/.test(await page.locator('#notices').textContent()), 'blocked storage is explained');
  const n = await page.locator('#history li .x').count();
  await page.locator('#log-pick').tap();
  ok((await page.locator('#history li .x').count()) === Math.min(n + 1, 12), 'logging still works without storage');
  ok(errors.length === 0, `no console errors without storage: ${errors.join('; ')}`);
  await context.close();
}

// 6. Reduced motion: the pick changes without animation.
{
  const { context, page } = await open({ ...PHONE, reducedMotion: 'reduce' });
  await page.locator('.person').nth(1).tap();
  await page.locator('.person').nth(2).tap();
  const anim = await page.locator('.whose').evaluate((e) => getComputedStyle(e).animationName);
  ok(anim === 'none', `no animation with reduced motion (${anim})`);
  const trans = await page.locator('.track .mark').first().evaluate((e) => getComputedStyle(e).transitionDuration);
  ok(trans === '0s', `no marker transition with reduced motion (${trans})`);
  await context.close();
}

// 7. Dark scheme and wide screen: no overflow, nothing hidden that should show.
for (const [opts, label] of [[{ ...PHONE, colorScheme: 'dark' }, 'phone dark'], [{ ...DESK, colorScheme: 'dark' }, 'desktop dark']]) {
  const { context, page, errors } = await open(opts);
  for (const s of await page.locator('summary').all()) await s.click();
  ok(!(await overflow(page)), `${label}: no sideways scroll with everything open`);
  ok(await page.locator('#chart svg').isVisible(), `${label}: the chart draws`);
  ok(!(await page.locator('#toast').isVisible()), `${label}: the toast is hidden until needed`);
  ok(errors.length === 0, `${label}: no console errors`);
  await context.close();
}

await browser.close();
console.log(`${checks - failures}/${checks} UI checks passed`);
process.exit(failures ? 1 : 0);
