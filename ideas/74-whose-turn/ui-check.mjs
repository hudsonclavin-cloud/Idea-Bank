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
const W = createRequire(import.meta.url)(path.join(here, 'turns.js'));
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
  ok((await page.locator('#log-pick').getAttribute('aria-disabled')) === 'true', 'the button rests for a moment after logging');
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
  ok(await B.page.locator('#bring-code').isVisible(), 'which also offers to paste a code from another phone');
  await B.page.locator('#bring-code').fill(`here: ${codeA} thanks`);
  await B.page.locator('#bring-merge').tap();
  ok(/Added/.test(await B.page.locator('#toast').textContent()), 'phone B adds the circle from the code');
  await B.page.evaluate(() => (document.getElementById('share').open = true));
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

// ------------------------------------------------------------------ added after the independent review
// A store holding just this circle, for addInitScript.
function storeWith(circle, extra = {}) {
  const s = JSON.stringify({ v: 1, circles: [circle], current: circle.id, present: {}, exampleGone: true, ...extra });
  return `localStorage.setItem('whose-turn.v1', ${JSON.stringify(s)})`;
}
function circleOf(kind, names, attendance, doers) {
  const members = names.map((name, i) => ({ id: `mem${String(i).padStart(5, '0')}`, name, nameT: 0, gone: false, goneT: 0, pos: i }));
  const c = { id: 'circle00001', name: 'Injected', nameT: 0, kind, created: Date.now() - 86400000, members, events: [], removed: [] };
  const t0 = Math.floor(Date.now() / 1000) * 1000 - attendance.length * 3600000;
  attendance.forEach((S, i) => {
    const who = S.map((j) => members[j].id);
    const by = doers && doers[i] !== undefined ? members[doers[i]].id : W.pick(c, who).top.id;
    c.events.push({ id: `ev${String(i).padStart(6, '0')}`, t: t0 + i * 3600000, by, who });
  });
  return c;
}
const countAnims = (page) => page.evaluate(() => {
  window.__anims = [];
  document.addEventListener('animationstart', () => window.__anims.push(performance.now()), true);
});
const anims = (page) => page.evaluate(() => window.__anims.slice());

// 8. The pick's name moves only when it changes, at most once every 400 ms, and never on its own.
{
  const { context, page } = await open(PHONE);
  await countAnims(page);
  const dev = page.locator('.person', { hasText: 'Dev' });
  const names = [];
  for (let i = 0; i < 12; i++) {
    await dev.tap();
    names.push(await whose(page));
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(400);
  const a = await anims(page);
  const gaps = a.slice(1).map((t, i) => t - a[i]);
  ok(new Set(names).size > 1, `tapping Dev in and out changes the pick (${[...new Set(names)].join(', ')})`);
  ok(a.length >= 1 && a.length <= 4 && gaps.every((g) => g >= 380), `12 quick taps start ${a.length} animations, gaps ${gaps.map(Math.round).join(', ')} ms (at most one per 400 ms)`);
  if ((await dev.getAttribute('aria-pressed')) !== 'true') await dev.tap();
  await page.waitForTimeout(500);
  // someone whose tap leaves the pick as it is
  const pick = await whose(page);
  let still = null;
  for (const n of ['Ana', 'Ben', 'Cleo', 'Dev']) {
    if (n === pick) continue;
    await page.locator('.person', { hasText: n }).tap();
    const p = await whose(page);
    await page.locator('.person', { hasText: n }).tap();
    if (p === pick) {
      still = n;
      break;
    }
  }
  await page.waitForTimeout(500);
  await page.evaluate(() => (window.__anims = []));
  for (let i = 0; i < 6 && still; i++) {
    await page.locator('.person', { hasText: still }).tap();
    await page.waitForTimeout(500);
  }
  ok(still !== null && (await anims(page)).length === 0, `six slow taps on ${still} that leave the pick as ${pick} start no animation (${(await anims(page)).length})`);
  if ((await page.locator('.person', { hasText: still }).getAttribute('aria-pressed')) !== 'true') await page.locator('.person', { hasText: still }).tap();
  await page.waitForTimeout(500);
  let late = 0;
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => (window.__anims = []));
    const t = await page.evaluate(() => performance.now());
    await page.locator('#log-pick').tap();
    await page.waitForTimeout(1500);
    late += (await anims(page)).filter((x) => x - t > 600).length;
  }
  ok(late === 0, `after logging, nothing animates again when the rest ends (${late} late animations)`);
  await context.close();
}

// 9. Remove: a double tap removes one entry; Undo puts back every removal the slip covers.
{
  const { context, page, errors } = await open(PHONE);
  const before = await allEntries(page);
  await page.locator('#history li .x').first().tap();
  await page.waitForTimeout(120);
  await page.locator('#history li .x').first().tap();
  await page.waitForTimeout(100);
  ok((await allEntries(page)) === before - 1, `a double tap on Remove removes one entry (${before} -> ${await allEntries(page)})`);
  await page.waitForTimeout(1300);
  await page.locator('#history li .x').first().tap();
  ok((await allEntries(page)) === before - 2, 'a second, deliberate tap later removes another');
  ok(/2 entries removed/.test(await page.locator('#toast').textContent()), `the slip counts both (${await page.locator('#toast').textContent()})`);
  await page.locator('#toast button').tap();
  ok((await allEntries(page)) === before, `one Undo puts both back (${await allEntries(page)})`);
  ok(errors.length === 0, `no console errors removing: ${errors.join('; ')}`);
  await context.close();
}

// 10. Keyboard focus stays where it was: chips, the log button, "Has left", Remove, "someone else".
{
  const { context, page, errors } = await open(DESK);
  const fk = () => page.evaluate(() => {
    const a = document.activeElement;
    return a === document.body ? 'BODY' : a.getAttribute('data-fk') || `#${a.id}`;
  });
  const keys = await page.locator('.person').evaluateAll((els) => els.map((e) => e.getAttribute('data-fk')));
  await page.locator('.person').nth(1).focus();
  await page.keyboard.press('Space');
  ok((await fk()) === keys[1], `Space on a person keeps focus on them (${await fk()})`);
  await page.keyboard.press('Tab');
  ok((await fk()) === keys[2], `and Tab then goes to the next person (${await fk()})`);
  await page.keyboard.press('Space');
  await page.locator('.person').nth(1).focus();
  await page.keyboard.press('Space');
  await page.locator('.person').nth(2).focus();
  await page.keyboard.press('Space');
  ok((await page.locator('.person[aria-pressed="true"]').count()) === 4, 'so Tab and Space toggle the person you meant');
  await page.locator('#log-pick').focus();
  await page.keyboard.press('Enter');
  ok((await fk()) === '#log-pick', `Enter on the log button keeps focus on it (${await fk()})`);
  await page.waitForTimeout(1300);
  ok((await fk()) === '#log-pick' && (await page.locator('#log-pick').getAttribute('aria-disabled')) === 'false', 'and it is still there, ready, after the rest');
  await page.evaluate(() => (document.getElementById('edit').open = true));
  const gk = await page.locator('.gone-toggle').first().getAttribute('data-fk');
  await page.locator('.gone-toggle').first().focus();
  await page.keyboard.press('Enter');
  ok((await fk()) === gk, `Enter on "Has left" keeps focus on that toggle (${await fk()})`);
  await page.keyboard.press('Enter');
  await page.locator('#edit-people input').first().fill('Anabel');
  await page.keyboard.press('Tab');
  ok((await fk()) === gk && (await page.locator('.person').first().textContent()) === 'Anabel', `a rename, then Tab, goes on to that person's "Has left" (${await fk()})`);
  const rk = await page.locator('#history li .x').evaluateAll((els) => els.map((e) => e.getAttribute('data-fk')));
  await page.locator('#history li .x').nth(1).focus();
  await page.keyboard.press('Enter');
  ok((await fk()) === rk[2], `Enter on Remove moves focus to the next entry's Remove (${await fk()})`);
  await page.waitForTimeout(1300);
  await page.locator('#log-other').focus();
  await page.keyboard.press('Enter');
  await page.locator('.other-item').first().focus();
  await page.keyboard.press('Enter');
  ok((await fk()) === '#log-other', `logging from "Someone else did it" returns focus to that button (${await fk()})`);
  ok(errors.length === 0, `no console errors with the keyboard: ${errors.join('; ')}`);
  await context.close();
}

// 11. Words: tiny balances, a fence of "about ±2.1", the chart's label after a missed pick, the edit note.
{
  // five people; three entries that follow the rule leave Ana and Ben at 1/30 each
  const tiny = circleOf('turns', ['Ana', 'Ben', 'Cleo', 'Dev', 'Eve'], [[0, 1], [0, 1, 2], [0, 1, 2, 3, 4]]);
  const { context, page, errors } = await open(DESK, storeWith(tiny, { present: { [tiny.id]: [tiny.members[0].id, tiny.members[1].id] } }));
  const why = await page.locator('#verdict').textContent();
  ok(!/about 0(?![.\d])/.test(why) && /less than 0\.1 of a turn/.test(why), `a tiny balance is "less than 0.1 of a turn", not "about 0" (${why})`);
  const vals = await page.locator('#rows .val').allTextContents();
  ok(vals.every((v) => !/about 0(?![.\d])/.test(v)), `rows never say "about 0" (${vals.join(' | ')})`);
  ok(/fixed when a circle is created/.test(await page.locator('#edit-note').textContent()), 'the edit note says the kind is fixed when a circle is created');
  ok(errors.length === 0, `no console errors with tiny balances: ${errors.join('; ')}`);
  await context.close();
  // two people: Ana twice (the second time it was Ben's turn), then Ben: the fence is back to ±½
  const off = circleOf('turns', ['Ana', 'Ben'], [[0, 1], [0, 1], [0, 1]], [0, 0, 1]);
  const X = await open(DESK, storeWith(off));
  await X.page.locator('summary', { hasText: 'Over time' }).click();
  const label = await X.page.locator('#chart svg').getAttribute('aria-label');
  ok(!/all inside/.test(label) && /some were outside/.test(label), `the chart does not claim every balance was inside today's fence (${label})`);
  ok(/±½/.test(await X.page.locator('#promise').textContent()), 'with the fence back at ±½');
  await X.context.close();
}

// 12. Two phones that both log before swapping codes: the page says that can be why.
{
  const EMPTY = () => localStorage.setItem('whose-turn.v1', JSON.stringify({ v: 1, circles: [], current: null, present: {}, exampleGone: true }));
  const A = await open(PHONE, EMPTY);
  await A.page.locator('#create-name').fill('Coffee');
  await A.page.locator('input[value="rounds"]').check();
  await A.page.locator('#create-people').fill('Ana, Ben, Cleo');
  await A.page.locator('#create-form button[type="submit"]').tap();
  await A.page.evaluate(() => (document.getElementById('share').open = true));
  const code0 = await A.page.locator('#code-out').inputValue();
  const B = await open(PHONE, EMPTY);
  await B.page.locator('#bring-code').fill(code0);
  await B.page.locator('#bring-merge').tap();
  await B.page.evaluate(() => (document.getElementById('share').open = true));
  await A.page.locator('#log-pick').tap();
  await A.page.waitForTimeout(1200);
  await A.page.locator('#log-pick').tap();
  await B.page.evaluate(() => (document.getElementById('edit').open = true));
  await B.page.locator('#add-name').fill('Dev');
  await B.page.locator('#add-person button').tap();
  await B.page.locator('#log-pick').tap();
  const cA = await A.page.locator('#code-out').inputValue();
  const cB = await B.page.locator('#code-out').inputValue();
  await A.page.locator('#code-in').fill(cB);
  await A.page.locator('#merge-code').tap();
  await B.page.locator('#code-in').fill(cA);
  await B.page.locator('#merge-code').tap();
  const pa = await A.page.locator('#promise').textContent();
  ok(/two phones each logged before swapping codes/.test(pa), `after both phones logged, the promise names that as a cause (${pa})`);
  ok(/another phone/.test(await A.page.locator('#replay').textContent()), 'and so does the replay line');
  ok(JSON.stringify(await A.page.locator('#rows .val').allTextContents()) === JSON.stringify(await B.page.locator('#rows .val').allTextContents()), 'both phones still agree');
  await A.context.close();
  await B.context.close();
}

// 13. The reminder to keep a copy comes after two entries, and again a week after the last copy.
{
  const EMPTY = () => localStorage.setItem('whose-turn.v1', JSON.stringify({ v: 1, circles: [], current: null, present: {}, exampleGone: true }));
  const { context, page, errors } = await open(DESK, EMPTY);
  await page.locator('#create-name').fill('Bins');
  await page.locator('#create-people').fill('Ana, Ben, Cleo');
  await page.locator('#create-form button[type="submit"]').click();
  await page.locator('#log-pick').click();
  ok(!/Keep a copy/.test(await page.locator('#notices').textContent()), 'no reminder after one entry');
  await page.waitForTimeout(1200);
  await page.locator('#log-pick').click();
  ok(/Keep a copy/.test(await page.locator('#notices').textContent()), 'a reminder to keep a copy after the second entry');
  await page.locator('#notices button', { hasText: 'Copy the ledger code' }).click();
  ok(!/Keep a copy/.test(await page.locator('#notices').textContent()), 'gone once the code is copied');
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('whose-turn.v1'));
    s.copied[s.current] = Date.now() - 8 * 86400000;
    localStorage.setItem('whose-turn.v1', JSON.stringify(s));
  });
  const later = await context.newPage(); // a fresh page, without the init script that empties storage
  await later.goto(URL0);
  ok(/Keep a copy/.test(await later.locator('#notices').textContent()), 'and back when the last copy is over a week old and there are newer entries');
  ok(errors.length === 0, `no console errors with the reminder: ${errors.join('; ')}`);
  await context.close();
}

// 13b. A backup downloaded before a circle was made does not hold it, so it does not put off that
// circle's first reminder; a backup downloaded after the circle was made does count as a copy.
{
  const OLD_BACKUP = () => localStorage.setItem('whose-turn.v1', JSON.stringify({ v: 1, circles: [], current: null, present: {}, exampleGone: true, lastCopy: Date.now() - 86400000 }));
  const { context, page, errors } = await open(DESK, OLD_BACKUP);
  await page.locator('#create-name').fill('Bins');
  await page.locator('#create-people').fill('Ana, Ben, Cleo');
  await page.locator('#create-form button[type="submit"]').click();
  await page.locator('#log-pick').click();
  ok(!/Keep a copy/.test(await page.locator('#notices').textContent()), 'with an older backup, no reminder after one entry');
  await page.waitForTimeout(1200);
  await page.locator('#log-pick').click();
  ok(/Keep a copy/.test(await page.locator('#notices').textContent()), 'a backup from before the circle was made does not hold back the reminder after its second entry');
  const again = await context.newPage(); // without the init script
  await again.goto(URL0);
  ok(/Keep a copy/.test(await again.locator('#notices').textContent()), 'and the reminder is still there after a reload');
  ok(errors.length === 0, `no console errors with an older backup: ${errors.join('; ')}`);
  await context.close();
  const B = await open(DESK, () => localStorage.setItem('whose-turn.v1', JSON.stringify({ v: 1, circles: [], current: null, present: {}, exampleGone: true })));
  await B.page.locator('#create-name').fill('Bins');
  await B.page.locator('#create-people').fill('Ana, Ben, Cleo');
  await B.page.locator('#create-form button[type="submit"]').click();
  await B.page.waitForTimeout(1100); // backups are timed to the second
  await B.page.locator('#share summary').click();
  await B.page.locator('#download').click();
  await B.page.locator('#log-pick').click();
  await B.page.waitForTimeout(1200);
  await B.page.locator('#log-pick').click();
  ok(!/Keep a copy/.test(await B.page.locator('#notices').textContent()), 'a backup downloaded after the circle was made counts as its copy');
  ok(B.errors.length === 0, `no console errors after a backup: ${B.errors.join('; ')}`);
  await B.context.close();
}

// 14. With no circles at all, a code can still be pasted and a bad link does not break the page.
{
  const A = await open(PHONE);
  await A.page.locator('#share summary').tap();
  const code = await A.page.locator('#code-out').inputValue();
  await A.context.close();
  const { context, page, errors } = await open(PHONE);
  await page.locator('#notices button', { hasText: 'Remove the example' }).tap();
  await page.locator('#create-cancel').tap();
  const btn = page.locator('#notices button', { hasText: 'Paste a code or restore' });
  ok(await btn.isVisible(), 'with no circles, the notice offers to paste a code or restore a backup');
  await btn.tap();
  ok(await page.locator('#bring-restore').evaluate((e) => !!e.closest('label').getClientRects().length), 'the restore button is there');
  await page.locator('#bring-code').fill(code);
  await page.locator('#bring-merge').tap();
  ok((await page.locator('#circle-name').textContent()) === 'School run (example)' && !(await page.locator('#main').isHidden()), 'and pasting brings the circle in');
  ok(errors.length === 0, `no console errors bringing a circle in: ${errors.join('; ')}`);
  await context.close();
  const B = await open(PHONE, null, `${URL0}#WHOSETURN1:%E0%A4%A`);
  ok(B.errors.length === 0, `a link with a malformed %-escape raises no error (${B.errors.join('; ')})`);
  await B.context.close();
}

await browser.close();
console.log(`${checks - failures}/${checks} UI checks passed`);
process.exit(failures ? 1 : 0);
