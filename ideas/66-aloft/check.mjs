#!/usr/bin/env node
// End-to-end check of the Aloft playground in headless Chromium, through the real UI:
// types a new program at phone size, breaks and fixes it, plays the replay, runs every
// lesson through the page, and loads the page with localStorage throwing and with
// reduced motion. Uses the globally installed Playwright, like tools/smoke.mjs.
//
// It also pastes programs that say tens of megabytes, or juggle 9999 balls, and checks that
// the page stays responsive.
//
// Usage: node ideas/66-aloft/check.mjs [--shots DIR]
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const LESSONS = require('./examples.js');
const URL_ = pathToFileURL(path.join(HERE, 'index.html')).href;
const argShots = process.argv.indexOf('--shots');
const SHOTS = argShots > 0 ? path.resolve(process.argv[argShots + 1]) : path.join(os.tmpdir(), 'aloft-check');
fs.mkdirSync(SHOTS, { recursive: true });

function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    const g = execSync('npm root -g', { encoding: 'utf8' }).trim();
    return createRequire(path.join(g, 'noop.js'))('playwright');
  }
}
const { chromium } = loadPlaywright();
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const DESKTOP = { viewport: { width: 1280, height: 800 } };

let failures = 0;
function ok(cond, what) {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`);
  if (!cond) failures++;
}
const outputOf = (page) => page.$$eval('#output div:not(.empty):not(.note)', (ds) => ds.map((d) => d.textContent));
const settle = (page) => page.waitForTimeout(450);

async function open(browser, opts, init) {
  const ctx = await browser.newContext(opts);
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL_);
  if (!init) {
    // Start from empty storage (file:// pages share it), once.
    await page.evaluate(() => { try { localStorage.clear(); } catch (e) { /* ignore */ } });
    await page.reload();
  }
  await settle(page);
  return { ctx, page, errors };
}

const browser = await chromium.launch();
try {
  // 1. Phone: a new program typed by hand.
  {
    const { ctx, page, errors } = await open(browser, PHONE);
    ok((await outputOf(page)).join(',') === '1,2,3,4,5', 'phone: lesson 1 runs on load');
    await page.tap('#code');
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    const prog = [
      '# Triangle numbers, typed on a phone.',
      'balls 1 0',
      'catch k total',
      'let t = total + k',
      'say k, t',
      'stop when k == 6',
      'throw k + 1 up 1',
      'throw t up 1',
    ];
    for (const line of prog) {
      if (/^(let|say|stop|throw)/.test(line)) await page.keyboard.press('Tab'); // the editor indents with Tab
      await page.keyboard.type(line);
      await page.keyboard.press('Enter');
    }
    await settle(page);
    const typed = await page.$eval('#code', (t) => t.value);
    ok(typed.includes('\n  let t = total + k\n'), 'phone: Tab indents inside the editor');
    ok((await outputOf(page)).join('|') === '1 1|2 3|3 6|4 10|5 15|6 21', 'phone: typed program gives the triangle numbers');
    const verdict = await page.textContent('#verdict');
    ok(verdict.includes('Jugglable') && verdict.includes('siteswap [11]') && verdict.includes('2 balls in the air = (1 + 1) / 1 beat'), `phone: verdict reads "${verdict}"`);
    ok((await page.textContent('#runStatus')).includes('stopped after 6 beats'), 'phone: run status');
    await page.screenshot({ path: path.join(SHOTS, 'phone-typed.png') });

    // Break it: the second throw goes up 2, so the pattern no longer fits.
    await page.$eval('#code', (t) => {
      t.value = t.value.replace('throw t up 1', 'throw t up 2');
      t.dispatchEvent(new Event('input'));
    });
    await settle(page);
    const bad = await page.textContent('#verdict');
    ok(bad.includes("Can't juggle this yet") && bad.includes('Line 2, column 1') && bad.includes('keeps 3 balls in the air, (1 + 2) / 1 beat, but "balls" lists 2'), `phone: ball-count error shown: "${bad.slice(0, 120)}…"`);
    ok((await page.$$eval('.gutter .err', (d) => d.map((x) => x.textContent))).join() === '2', 'phone: gutter marks line 2 (the balls line)');
    ok(await page.isDisabled('#play'), 'phone: Play is disabled while the program does not check out');
    await page.tap('#verdict button');
    const sel = await page.$eval('#code', (t) => [t.selectionStart, t.value.slice(0, t.selectionStart).split('\n').length]);
    ok(sel[1] === 2, `phone: "Go to line" puts the caret on line ${sel[1]}`);
    await page.screenshot({ path: path.join(SHOTS, 'phone-error.png') });

    // A name used outside its beat: the teaching error.
    await page.$eval('#code', (t) => {
      t.value = 'balls 1\ncatch n\n  throw n up 1\ncatch m\n  say n\n  throw m up 1\n';
      t.dispatchEvent(new Event('input'));
    });
    await settle(page);
    ok((await page.textContent('#verdict')).includes('Line 5, column 7') && (await page.textContent('#verdict')).includes('Names last one beat'), 'phone: names-last-one-beat error');

    // Fix it and play: the replay advances and marks the current beat.
    await page.$eval('#code', (t) => {
      t.value = 'balls 100 200 300\ncatch x\n  say x\n  stop when x == 302\n  throw x + 1 up 3\n';
      t.dispatchEvent(new Event('input'));
    });
    await settle(page);
    await page.tap('#restart');
    await page.tap('#play');
    await page.waitForTimeout(1600);
    const desc = await page.textContent('#beatDesc');
    ok(/t = [1-9]/.test(desc) && desc.includes('caught x ='), `phone: replay advances ("${desc.slice(0, 70)}")`);
    ok((await page.$$('.gutter .cur')).length === 1, 'phone: current beat marked in the gutter');
    ok((await page.$$('.band.beat')).length === 1, 'phone: current beat shaded in the code');
    await page.tap('#play'); // pause
    const before = await page.textContent('#beatDesc');
    await page.tap('#step');
    const after = await page.textContent('#beatDesc');
    const tOf = (s) => Number((s.match(/t = (\d+)/) || [])[1]);
    ok(tOf(after) === Math.min(8, tOf(before) + 1), `phone: Step moves one beat (${tOf(before)} -> ${tOf(after)})`);
    ok((await page.$$('#output div.now')).length >= 1, 'phone: output line of the current beat highlighted');
    await page.tap('#sound');
    ok((await page.getAttribute('#sound', 'aria-pressed')) === 'true', 'phone: sound toggles after a tap');
    const width = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    ok(width[0] <= width[1], `phone: no horizontal scroll (${width[0]} <= ${width[1]})`);
    await page.screenshot({ path: path.join(SHOTS, 'phone-playing.png'), fullPage: true });

    // Edits persist per lesson and Reset brings the lesson back.
    await page.reload();
    await settle(page);
    ok((await page.$eval('#code', (t) => t.value)).startsWith('balls 100 200 300'), 'phone: edit survives a reload');
    await page.tap('#resetLesson');
    await settle(page);
    ok((await page.$eval('#code', (t) => t.value)) === LESSONS[0].src, 'phone: Reset lesson restores the original');
    ok(errors.length === 0, `phone: no console errors (${errors.join(' | ')})`);
    await ctx.close();
  }

  // 2. Desktop: every lesson through the real page.
  {
    const { ctx, page, errors } = await open(browser, { ...DESKTOP, colorScheme: 'dark' });
    for (let i = 0; i < LESSONS.length; i++) {
      await page.selectOption('#lessonSelect', String(i));
      await settle(page);
      const e = LESSONS[i].expect;
      if (e.error) {
        const v = await page.textContent('#verdict');
        ok(v.includes(`Line ${e.error.line}, column ${e.error.col}`) && v.includes(e.error.includes), `desktop: lesson ${i + 1} shows its error`);
      } else {
        ok(JSON.stringify(await outputOf(page)) === JSON.stringify(e.output), `desktop: lesson ${i + 1} (${LESSONS[i].title}) output`);
      }
    }
    await page.selectOption('#lessonSelect', String(LESSONS.length - 1));
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(SHOTS, 'desktop-dark-e.png') });
    // keyboard: space plays/pauses, arrows step, when focus is outside the editor
    await page.click('h1');
    const was = await page.textContent('#play');
    await page.keyboard.press('Space');
    await page.waitForTimeout(200);
    const now = await page.textContent('#play');
    await page.keyboard.press('Space');
    await page.waitForTimeout(200);
    ok(was !== now && (await page.textContent('#play')) !== now, `desktop: space toggles play (${was} -> ${now} -> back)`);
    const t0 = Number(((await page.textContent('#beatDesc')).match(/t = (\d+)/) || [])[1]);
    await page.click('h1');
    if ((await page.textContent('#play')) === 'Pause') await page.keyboard.press('Space');
    const t1 = Number(((await page.textContent('#beatDesc')).match(/t = (\d+)/) || [])[1]);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowLeft');
    const t2 = Number(((await page.textContent('#beatDesc')).match(/t = (\d+)/) || [])[1]);
    ok(Number.isFinite(t0) && t2 === t1 + 1, `desktop: arrow keys step (${t1} -> ${t2})`);
    ok(errors.length === 0, `desktop: no console errors (${errors.join(' | ')})`);
    await ctx.close();
  }

  // 3. localStorage that throws on every call.
  {
    const { ctx, page, errors } = await open(browser, PHONE, () => {
      const boom = () => { throw new Error('blocked'); };
      Object.defineProperty(window, 'localStorage', { get: boom, configurable: true });
    });
    ok((await outputOf(page)).join(',') === '1,2,3,4,5', 'no storage: lesson 1 still runs');
    await page.tap('#next');
    await settle(page);
    ok((await outputOf(page)).length === 6, 'no storage: next lesson runs');
    ok(errors.length === 0, `no storage: no console errors (${errors.join(' | ')})`);
    await ctx.close();
  }

  // 4. Runaways: output floods are capped by the interpreter and by the renderer, and a
  //    huge pattern replays without multi-second frames.
  {
    const { ctx, page, errors } = await open(browser, PHONE);
    await page.evaluate(() => {
      window.__long = [];
      new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)); }).observe({ type: 'longtask' });
    });
    const setCode = (src) => page.$eval('#code', (t, v) => {
      t.value = v;
      t.dispatchEvent(new Event('input'));
    }, src);
    // Time from pasting a program to its run status naming the output limit (debounce included).
    const timeTo = async (src, want) => {
      await page.$eval('#runStatus', (s) => { s.textContent = ''; });
      const t0 = Date.now();
      await setCode(src);
      try {
        await page.waitForFunction((w) => document.getElementById('runStatus').textContent.includes(w), want, { timeout: 15000, polling: 50 });
      } catch {
        return Infinity;
      }
      return Date.now() - t0;
    };
    const shown = () => page.$eval('#output', (o) => ({
      chars: [...o.querySelectorAll('div:not(.note)')].reduce((n, d) => n + d.textContent.length, 0),
      lines: o.querySelectorAll('div:not(.note)').length,
      note: (o.querySelector('.note') || {}).textContent || '',
    }));
    // 328 bytes that say about 28 MB inside the 0.6 s time guard, without the character cap.
    const b8 = (x) => Array(8).fill(x).join('*');
    const digits = `balls 0\ncatch k\n  let a = 3\n  let b = ${b8('a')}\n  let c = ${b8('b')}\n  let d = ${b8('c')}\n  let e = d*d*d*d\n  say ${Array(60).fill('e').join(', ')}\n  throw k + 1 up 1\n`;
    let ms = await timeTo(digits, 'output limit (200,000 characters) reached after 4 beats');
    let o = await shown();
    ok(ms < 2500 && o.chars === 200000 && o.note.includes('200,000 characters'), `runaway: a 328-byte flood stops at 200,000 characters, page answers in ${ms} ms`);
    // Strings cost no work units: two 40,000-character strings per line (160 MB before the cap).
    ms = await timeTo(`catch\n  say "${'x'.repeat(40000)}", "${'x'.repeat(40000)}"\n`, 'output limit (200,000 characters) reached after 3 beats');
    o = await shown();
    ok(ms < 2500 && o.chars === 200000, `runaway: an 80 KB string flood stops at 200,000 characters, page answers in ${ms} ms`);
    const desc = await page.textContent('#beatDesc');
    ok(desc.length < 600, `runaway: the beat description stays short (${desc.length} characters)`);
    await page.screenshot({ path: path.join(SHOTS, 'phone-flood.png') });
    // The renderer has its own cap: with the interpreter's caps lifted, 10,000 lines of
    // 1,000 characters (10 MB) still put only 200,000 characters in the page.
    await page.evaluate(() => {
      const run = window.Aloft.run;
      window.Aloft.run = (src, opts) => run(src, Object.assign({}, opts, { maxOutput: Infinity, maxOutputChars: Infinity }));
    });
    ms = await timeTo(`catch\n  say "${'w'.repeat(1000)}"\n`, 'no stop within the beat limit');
    o = await shown();
    ok(ms < 2500 && o.chars === 200000 && o.lines === 200 && o.note.includes('the page shows at most 2,000 lines or 200,000 characters'), `runaway: the renderer caps 10 MB of output at ${o.lines} lines, ${o.chars} characters, in ${ms} ms`);
    await page.evaluate(() => { window.__long = []; });
    // 9999 balls up 9999: every replay frame took over a second when all were drawn.
    await setCode(`balls ${Array(9999).fill('0').join(' ')}\ncatch a\n  throw a up 9999\n`);
    await settle(page);
    if ((await page.textContent('#play')) !== 'Pause') await page.tap('#play');
    await page.waitForTimeout(3000);
    const tNow = Number(((await page.textContent('#beatDesc')).match(/t = (\d+)/) || [])[1]);
    const longest = Math.max(0, ...(await page.evaluate(() => window.__long)));
    ok(tNow >= 3 && longest < 400, `runaway: 9999 balls replay smoothly (t = ${tNow} after 3 s, longest task ${longest} ms)`);
    await page.screenshot({ path: path.join(SHOTS, 'phone-9999-balls.png') });
    const width = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    ok(width[0] <= width[1], `runaway: no horizontal scroll (${width[0]} <= ${width[1]})`);
    ok(errors.length === 0, `runaway: no console errors (${errors.join(' | ')})`);
    await ctx.close();
  }

  // 5. Reduced motion: no automatic play; Play jumps whole beats.
  {
    const { ctx, page, errors } = await open(browser, { ...PHONE, reducedMotion: 'reduce', colorScheme: 'dark' });
    ok((await page.textContent('#play')) === 'Play', 'reduced motion: nothing plays by itself');
    await page.tap('#play');
    await page.waitForTimeout(1300);
    ok(/t = [1-9]/.test(await page.textContent('#beatDesc')), 'reduced motion: Play steps through beats');
    await page.screenshot({ path: path.join(SHOTS, 'phone-dark-reduced.png') });
    ok(errors.length === 0, `reduced motion: no console errors (${errors.join(' | ')})`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : `\nall UI checks passed (screenshots in ${SHOTS})`);
process.exit(failures ? 1 : 0);
