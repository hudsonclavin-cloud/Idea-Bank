#!/usr/bin/env node
// End-to-end check of the Backtime page in headless Chromium, mostly at phone size.
// Does the real job through the UI: edit a dish, add dishes, tick jobs, reload with and without
// storage, save and load a file, share a link, print, dark mode, reduced motion, file:// loading.
//
// Run from the repo root: node ideas/27-backtime/ui-check.mjs [--shots DIR]
// Needs the globally installed Playwright that tools/smoke.mjs uses.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const SHOTS = argv.includes('--shots') ? path.resolve(argv[argv.indexOf('--shots') + 1]) : path.join(os.tmpdir(), 'backtime-ui');
fs.mkdirSync(SHOTS, { recursive: true });

function loadPlaywright() {
  const req = createRequire(import.meta.url);
  try {
    return req('playwright');
  } catch {
    const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
    return createRequire(path.join(globalRoot, 'noop.js'))('playwright');
  }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };
function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
      let p = path.join(HERE, decodeURIComponent(url.pathname));
      if (!p.startsWith(HERE)) return res.writeHead(403).end();
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
      fs.readFile(p, (err, data) => {
        if (err) return res.writeHead(404).end('not found');
        res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' }).end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail !== undefined ? `  (${typeof detail === 'string' ? detail : JSON.stringify(detail)})` : ''}`);
}

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

async function newPage(browser, origin, opts = {}) {
  const context = await browser.newContext(Object.assign({}, PHONE, { acceptDownloads: true }, opts.context || {}));
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => (opts.accept ? d.accept() : d.dismiss()).catch(() => {}));
  if (opts.media) await page.emulateMedia(opts.media);
  await page.goto(opts.url || `${origin}/index.html`, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  return { context, page, errors };
}

const rowsText = (page) => page.$$eval('#timeline .ev', (rows) => rows.map((r) => r.innerText.replace(/\s+/g, ' ').trim()));
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const planOf = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.backtime.plan)));

async function main() {
  const { chromium } = loadPlaywright();
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  try {
    // ---- 1. the example, as a new visitor sees it ----
    const { context, page, errors } = await newPage(browser, origin, { context: { locale: 'en-GB', timezoneId: 'Europe/London' } });
    const firstServe = (await planOf(page)).serveAt;
    const expectFirst = (Math.ceil((await page.evaluate(() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; }) + 150) / 5) * 5) % 1440;
    check('first visit: the example is set to serve about 2½ h from now', Math.abs(firstServe - expectFirst) <= 5 || Math.abs(firstServe - expectFirst) >= 1435, [firstServe, expectFirst]);
    check('first visit: the next job is in the future, not "behind"', /^In /.test(await page.innerText('#next .big')), await page.innerText('#next .big'));
    await page.fill('#serveAt', '19:00');
    await page.waitForTimeout(150);
    let rows = await rowsText(page);
    check('example loads with 13 timeline rows', rows.length === 13, rows.length);
    check('first job is the oven going on', /Oven on, 200°C/.test(rows[0]), rows[0]);
    check('last row is Serve at 19:00', /19:00.*Serve/.test(rows[12]), rows[12]);
    check('the Yorkshires row notes the oven going up', /oven to 220°C/.test(rows.join(' ')));
    check('summary counts 6 dishes and 13 jobs', /6 dishes, 13 jobs/.test(await page.innerText('#summary')));
    check('no clashes in the example', (await page.$$('#flags .flag')).length === 0);
    check('serve input shows 19:00', (await page.inputValue('#serveAt')) === '19:00' && (await planOf(page)).serveAt === 1140);
    check('no horizontal overflow on the phone', (await overflow(page)) <= 0, await overflow(page));
    await page.screenshot({ path: path.join(SHOTS, '01-phone-example.png'), fullPage: false });

    // ---- 2. edit a dish: potatoes get an hour instead of 55 min ----
    await page.locator('.dish-head', { hasText: 'Roast potatoes' }).tap();
    await page.waitForTimeout(150);
    check('tapping a dish opens its editor', await page.isVisible('.dish.open .dish-body'));
    check('editor open: still no overflow', (await overflow(page)) <= 0, await overflow(page));
    const ovenMinutes = page.locator('.dish.open .steprow').nth(2).locator('.minutes');
    await ovenMinutes.fill('1h');
    await page.waitForTimeout(100);
    rows = await rowsText(page);
    check('typing "1h" moves the potatoes into the oven at 18:00', rows.some((r) => /18:00.*Roast potatoes: In the oven/.test(r)), rows.find((r) => /Roast potatoes: In the oven/.test(r)));
    check('the dish card says when it starts', /starts 17:45/.test(await page.innerText('.dish.open .starts')));
    await ovenMinutes.fill('nonsense');
    check('an unreadable duration is marked, not applied', (await ovenMinutes.getAttribute('class')).includes('invalid') && (await planOf(page)).dishes[1].steps[2].minutes === 60);
    await page.locator('.dish.open .steprow').nth(2).locator('button', { hasText: '-5' }).tap();
    check('-5 takes the oven step to 55 again', (await planOf(page)).dishes[1].steps[2].minutes === 55);
    await page.screenshot({ path: path.join(SHOTS, '02-phone-editor.png'), fullPage: false });

    // ---- 3. remove a step, undo it ----
    const before = (await planOf(page)).dishes[1].steps.length;
    await page.locator('.dish.open .steprow').nth(0).locator('.remove').tap();
    await page.waitForTimeout(100);
    check('× removes the step', (await planOf(page)).dishes[1].steps.length === before - 1);
    check('a toast offers Undo', await page.isVisible('#toast.show button'));
    await page.locator('#toast button').tap();
    await page.waitForTimeout(100);
    const steps = (await planOf(page)).dishes[1].steps;
    check('Undo brings it back in the same place', steps.length === before && steps[0].label === 'Parboil');

    // ---- 4. an oven clash appears when it should ----
    await page.locator('.dish-head', { hasText: 'Yorkshire' }).tap();
    await page.locator('.dish.open .steprow').nth(1).locator('.temp').fill('250');
    await page.waitForTimeout(100);
    let flags = await page.$$eval('#flags .flag', (f) => f.map((x) => x.innerText));
    check('250° Yorkshires beside 200° potatoes is an oven clash', flags.some((f) => /Oven clash/.test(f) && /200°C and 250°C/.test(f)), flags);
    await page.locator('.dish.open .steprow').nth(1).locator('.temp').fill('220');
    await page.waitForTimeout(100);
    check('back at 220° the clash goes away', (await page.$$('#flags .flag')).length === 0);

    // ---- 5. add dishes: a preset, and one typed from scratch ----
    await page.selectOption('#preset', { label: 'Apple crumble (for after)' });
    await page.waitForTimeout(150);
    rows = await rowsText(page);
    check('the crumble preset lands after serving (19:05)', rows.some((r) => /19:05.*Apple crumble.*In the oven/.test(r)), rows.slice(-3));
    flags = await page.$$eval('#flags .flag', (f) => f.map((x) => x.innerText));
    check('assembling the crumble while carving is flagged as two hands-on jobs', flags.some((f) => /Two hands-on/.test(f)), flags);
    await page.locator('#addDish').tap();
    await page.waitForTimeout(150);
    await page.locator('.dish.open input[type="text"]').first().fill('Peas');
    await page.locator('.dish.open .steprow .kind').selectOption('hob');
    await page.locator('.dish.open .steprow .minutes').fill('4');
    await page.waitForTimeout(100);
    rows = await rowsText(page);
    check('a new hob dish shows up at 18:56 with a default title', rows.some((r) => /18:56.*Peas: onto the hob/.test(r)), rows.find((r) => /Peas/.test(r)));
    check('8 dishes now', (await planOf(page)).dishes.length === 8);
    check('still no overflow with everything open', (await overflow(page)) <= 0, await overflow(page));

    // ---- 6. tick a job from the Next-up card and from the list ----
    check('with nothing ticked the card never says "behind": it is "for another day" or a countdown', /has passed|^In |^Now$/.test(await page.innerText('#next .big')) && !/behind/.test(await page.innerText('#next')), await page.innerText('#next .big'));
    await page.locator('#startNow').tap();
    await page.waitForTimeout(150);
    check('Start now: the first job is due within the 5-min rounding', /^(Now|In (under a minute|[1-5] min))$/.test(await page.innerText('#next .big')), await page.innerText('#next .big'));
    await page.locator('#next button.primary').tap();
    await page.waitForTimeout(100);
    let plan = await planOf(page);
    check('Done ticks the first job', plan.done['preheat:0'] === true);
    check('the card moves on to the chicken', /Roast chicken: In the oven/.test(await page.innerText('#next')));
    await page.locator('#timeline .item[data-key="chicken/s1"] input').tap();
    await page.waitForTimeout(100);
    plan = await planOf(page);
    check('a checkbox in the list ticks too', plan.done['chicken/s1'] === true);
    check('the card moves on again', /Roast potatoes: Parboil/.test(await page.innerText('#next')));
    await page.screenshot({ path: path.join(SHOTS, '03-phone-ticked.png'), fullPage: false });

    // ---- 7. reload: everything persists ----
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(300);
    plan = await planOf(page);
    check('after reload: 8 dishes and the ticks are still there', plan.dishes.length === 8 && plan.done['chicken/s1'] === true);
    check('after reload: the typed dish survived', plan.dishes[7].name === 'Peas' && plan.dishes[7].steps[0].kind === 'hob');

    // ---- 8. save to a file, then load a changed copy ----
    await page.locator('details.tools summary').tap();
    await page.waitForTimeout(100);
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export').tap()]);
    const saved = path.join(SHOTS, 'exported.json');
    await download.saveAs(saved);
    const exported = JSON.parse(fs.readFileSync(saved, 'utf8'));
    check('the saved file is the plan', exported.dishes.length === 8 && exported.serveAt === (await planOf(page)).serveAt && download.suggestedFilename() === 'backtime-roast-chicken.json', download.suggestedFilename());
    exported.serveAt = 20 * 60;
    exported.dishes = exported.dishes.slice(0, 3);
    const changed = path.join(SHOTS, 'changed.json');
    fs.writeFileSync(changed, JSON.stringify(exported));
    await page.setInputFiles('#file', changed);
    await page.waitForTimeout(300);
    plan = await planOf(page);
    check('loading a file replaces the plan', plan.dishes.length === 3 && plan.serveAt === 1200);
    check('the serve input follows', (await page.inputValue('#serveAt')) === '20:00');
    const junk = path.join(SHOTS, 'junk.json');
    fs.writeFileSync(junk, '{"hello": "world"}');
    await page.setInputFiles('#file', junk);
    await page.waitForTimeout(300);
    check('a non-plan file changes nothing and says so', (await planOf(page)).dishes.length === 3 && /not a Backtime dinner/.test(await page.innerText('#toast')));
    fs.writeFileSync(junk, 'not json at all');
    await page.setInputFiles('#file', junk);
    await page.waitForTimeout(300);
    check('a non-JSON file changes nothing and says so', (await planOf(page)).dishes.length === 3 && /not JSON/.test(await page.innerText('#toast')));

    // ---- 9. share a link; open it somewhere with no storage ----
    await page.locator('#copyLink').tap();
    await page.waitForTimeout(200);
    const link = await page.inputValue('#linkbox');
    check('Copy link produces a #plan= link', /#plan=[A-Za-z0-9_-]+$/.test(link), link.slice(0, 60));
    const fresh = await newPage(browser, origin, { url: link });
    const freshPlan = await planOf(fresh.page);
    check('a fresh browser opens the link and gets that dinner', freshPlan.dishes.length === 3 && freshPlan.serveAt === 1200);
    check('the hash is cleared so later edits are not undone by a reload', !(await fresh.page.evaluate(() => location.hash)));
    check('no console errors in the fresh browser', fresh.errors.length === 0, fresh.errors);
    await fresh.context.close();

    // ---- 10. a clean browser gets the example; a broken store does not break the page ----
    const clean = await newPage(browser, origin);
    check('without stored data the example shows', (await planOf(clean.page)).dishes.length === 6);
    await clean.context.close();
    const noStore = await browser.newContext(PHONE);
    const nsPage = await noStore.newPage();
    const nsErrors = [];
    nsPage.on('pageerror', (e) => nsErrors.push(e.message));
    await nsPage.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new Error('storage disabled');
        },
      });
    });
    await nsPage.goto(`${origin}/index.html`, { waitUntil: 'load' });
    await nsPage.waitForTimeout(300);
    await nsPage.locator('#addDish').tap();
    await nsPage.waitForTimeout(100);
    check('with localStorage throwing, the page still works', nsErrors.length === 0 && (await planOf(nsPage)).dishes.length === 7, nsErrors);
    await noStore.close();

    // ---- 11. the big-picture states of the Next-up card ----
    await page.evaluate(() => {
      window.backtime.plan = { serveAt: 1140, dishes: [] };
    });
    check('no dishes: the timeline says so instead of showing nothing', /No dishes yet/.test(await page.innerText('#timeline')) && /Nothing yet/.test(await page.innerText('#next')));
    await page.locator('#reset').tap();
    await page.waitForTimeout(200);
    check('Reset to the example works without a confirm when there is nothing to lose', (await planOf(page)).dishes.length === 6);
    await page.locator('#reset').tap();
    await page.waitForTimeout(200);
    check('with dishes present, a dismissed confirm leaves the plan alone', (await planOf(page)).dishes.length === 6);
    await page.evaluate(() => {
      const p = window.backtime.plan;
      const now = new Date();
      p.serveAt = (now.getHours() * 60 + now.getMinutes() + 100) % 1440;
      window.backtime.plan = p;
    });
    await page.waitForTimeout(100);
    check('serving in 100 min: the first job reads as behind', /behind/.test(await page.innerText('#next')));
    await page.evaluate(() => {
      const p = window.backtime.plan;
      const now = new Date();
      p.serveAt = (now.getHours() * 60 + now.getMinutes() - 60 + 1440) % 1440;
      p.done = {};
      window.backtime.plan = p;
    });
    await page.waitForTimeout(100);
    check('serve time an hour ago with nothing ticked: "for another day", not "behind"', /has passed/.test(await page.innerText('#next')) && !/behind/.test(await page.innerText('#next')), await page.innerText('#next'));
    await page.evaluate(() => {
      const p = window.backtime.plan;
      const now = new Date();
      p.serveAt = (now.getHours() * 60 + now.getMinutes() + 100) % 1440;
      window.backtime.plan = p;
    });
    await page.waitForTimeout(100);
    check('a "serve later" nudge is offered', await page.isVisible('#next .hint button'));
    check('the now line is drawn in the timeline', await page.isVisible('#timeline .now'));
    await page.locator('#startNow').tap();
    await page.waitForTimeout(100);
    check('Start now makes the first job due within 5 min', /^(Now|In (under a minute|[1-5] min))$/.test(await page.innerText('#next .big')), await page.innerText('#next .big'));
    await page.evaluate(() => {
      const p = window.backtime.plan;
      for (const g of window.backtime.schedule.events) for (const i of g.items) p.done[i.key] = true;
      window.backtime.plan = p;
    });
    check('everything ticked: All done', /All done/.test(await page.innerText('#next')));

    // ---- 12. keyboard: a dish opens with Enter ----
    await page.evaluate(() => document.querySelector('.dish-head').focus());
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);
    check('Enter on a focused dish header opens it', await page.isVisible('.dish.open .dish-body'));
    check('no console errors through all of that', errors.length === 0, errors);
    await context.close();

    // ---- 13. dark, reduced motion, print, 12-hour clock ----
    const dark = await newPage(browser, origin, { media: { colorScheme: 'dark', reducedMotion: 'reduce' } });
    const bg = await dark.page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check('dark scheme gives a dark background', /rgb\((\d+), (\d+), (\d+)\)/.test(bg) && Number(bg.match(/\d+/)[0]) < 60, bg);
    await dark.page.fill('#serveAt', '19:00');
    await dark.page.waitForTimeout(100);
    const anim = await dark.page.evaluate(() => {
      const p = window.backtime.plan;
      const now = new Date();
      p.serveAt = (now.getHours() * 60 + now.getMinutes() + 300) % 1440;
      window.backtime.plan = p;
      const line = document.querySelector('.now .now-line');
      return line ? getComputedStyle(line, '::before').animationName : 'no now line';
    });
    check('reduced motion stops the now-line pulse', anim === 'none', anim);
    await dark.page.screenshot({ path: path.join(SHOTS, '04-phone-dark.png') });
    await dark.page.emulateMedia({ media: 'print' });
    const printHidden = await dark.page.evaluate(() => getComputedStyle(document.querySelector('.dishes-col')).display === 'none' && getComputedStyle(document.querySelector('#printHead')).display !== 'none');
    check('print hides the editor and shows the sheet heading', printHidden);
    await dark.page.screenshot({ path: path.join(SHOTS, '05-print.png'), fullPage: true });
    await dark.context.close();

    const us = await newPage(browser, origin, { context: Object.assign({}, PHONE, { locale: 'en-US', timezoneId: 'America/New_York' }) });
    await us.page.fill('#serveAt', '19:00');
    await us.page.waitForTimeout(150);
    const usRows = await rowsText(us.page);
    check('a US locale gets a 12-hour clock automatically', /4:55 pm/.test(usRows[0]) && /7:00 pm/.test(usRows[12]), [usRows[0], usRows[12]]);
    check('12-hour times do not overflow', (await overflow(us.page)) <= 0);
    await us.page.locator('details.settings summary').tap();
    await us.page.selectOption('#clock', '24');
    await us.page.waitForTimeout(100);
    check('the clock can be forced to 24-hour', /16:55/.test((await rowsText(us.page))[0]));
    await us.context.close();

    // ---- 14. desktop, and file:// (double-clicking index.html) ----
    const desk = await newPage(browser, origin, { context: { viewport: { width: 1280, height: 800 } } });
    check('desktop: two columns side by side', await desk.page.evaluate(() => document.querySelector('.dishes-col').getBoundingClientRect().left > document.querySelector('.timeline-col').getBoundingClientRect().right));
    await desk.page.screenshot({ path: path.join(SHOTS, '06-desktop.png') });
    await desk.context.close();
    const fileUrl = 'file://' + path.join(HERE, 'index.html');
    const local = await newPage(browser, origin, { url: fileUrl });
    check('opens from file:// with the example and no errors', (await rowsText(local.page)).length === 13 && local.errors.length === 0, local.errors);
    await local.context.close();
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`\n${passed} passed, ${failed} failed. Screenshots in ${SHOTS}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
