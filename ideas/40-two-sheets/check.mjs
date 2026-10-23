#!/usr/bin/env node
// End-to-end check of the page in headless Chromium. Exits non-zero on any failure.
// Run from the repo root: node ideas/40-two-sheets/check.mjs [--out DIR]
//
// What it checks, with the real page and the real pixels on the table canvas:
//  1. typing a new message leaves sheet A's fingerprint unchanged and changes sheet B's;
//  2. with the sheets aligned, reading the table canvas back cell by cell decodes EXACTLY the
//     message picture (two sheets, three sheets with any pair, and two-pictures mode);
//  3. one subpixel of misregistration makes the same count read-back wrong for many cells, yet the
//     canvas's full subpixel pattern, decoded with leak.js, still gives much of the message away,
//     and the status line no longer says there is nothing to read;
//  3b. switching scheme draws a fresh key, and so does the first change after printing or saving a
//     non-key sheet; the stated estimator bias in two-pictures mode is the corrected one; without
//     crypto.getRandomValues the page refuses to print or save and says why;
//  4. a real touch drag (CDP touch events) on the phone layout moves a sheet and snaps it;
//  5. the arrow keys nudge by one subpixel; the mode buttons work; dark mode and the print
//     layout render with no console errors; no horizontal overflow at 390 px.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const localRequire = createRequire(import.meta.url);
const VC = localRequire('./vc.js');
const Leak = localRequire('./leak.js');
const ROOT = path.resolve(HERE, '..', '..');
const OUT = (() => {
  const i = process.argv.indexOf('--out');
  return i > 0 ? path.resolve(process.argv[i + 1]) : path.join(os.tmpdir(), 'two-sheets-check');
})();
fs.mkdirSync(OUT, { recursive: true });

function loadPlaywright() {
  const req = createRequire(import.meta.url);
  try {
    return req('playwright');
  } catch {
    const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
    return createRequire(path.join(globalRoot, 'noop.js'))('playwright');
  }
}

function serve() {
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.md': 'text/markdown' };
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
      fs.readFile(p, (err, data) => {
        if (err) return res.writeHead(404).end();
        res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }).end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

let failures = 0;
function check(ok, label, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
}

// Decode the sheets as they are drawn on the table canvas: sample the centre of every subpixel
// of the base sheet's area, count black subpixels per cell, threshold, compare with the message.
function READBACK({ threshold, exclude }) {
  const T = window.__twoSheets;
  const g = T.geometry();
  const c = document.getElementById('tableCanvas').getContext('2d');
  const top = T.state.z[T.state.z.length - 1];
  const [dx, dy] = T.state.offsets[0];
  const x0 = (g.baseX + dx) * g.k, y0 = (g.padY + dy) * g.k;
  const img = c.getImageData(x0, y0, T.SW * g.k, T.SH * g.k).data;
  const stride = T.SW * g.k * 4;
  let wrong = 0, black = 0, cells = 0;
  const bits = T.state.bits;
  // optionally skip the cells lying under another sheet (one that is not part of the overlay)
  let ex = null;
  if (exclude !== undefined) {
    const [ox, oy] = T.state.offsets[exclude];
    ex = { x0: ox - dx, y0: oy - dy, x1: ox - dx + T.SW, y1: oy - dy + T.SH };
  }
  for (let cy = 0; cy < T.H; cy++) for (let cx = 0; cx < T.W; cx++) {
    if (ex && 2 * cx + 2 > ex.x0 && 2 * cx < ex.x1 && 2 * cy + 2 > ex.y0 && 2 * cy < ex.y1) continue;
    cells++;
    let n = 0;
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      const px = (2 * cx + i) * g.k + Math.floor(g.k / 2);
      const py = (2 * cy + j) * g.k + Math.floor(g.k / 2);
      const o = py * stride + px * 4;
      if (img[o + 3] > 200 && img[o] < 80) n++; // opaque and dark: ink, not the film's tint or shadow
    }
    const bit = n >= threshold ? 1 : 0;
    if (bit !== bits[cy * T.W + cx]) wrong++;
    if (bits[cy * T.W + cx]) black++;
  }
  return { wrong, cells, black, offsets: T.state.offsets.map((o) => o.slice()), top };
}

// The full subpixel raster of sheet A's frame as drawn on the table canvas (ink = 1).
function READRASTER() {
  const T = window.__twoSheets;
  const g = T.geometry();
  const c = document.getElementById('tableCanvas').getContext('2d');
  const [dx, dy] = T.state.offsets[0];
  const x0 = (g.baseX + dx) * g.k, y0 = (g.padY + dy) * g.k;
  const img = c.getImageData(x0, y0, T.SW * g.k, T.SH * g.k).data;
  const stride = T.SW * g.k * 4;
  const out = new Array(T.SW * T.SH);
  for (let y = 0; y < T.SH; y++) for (let x = 0; x < T.SW; x++) {
    const o = (y * g.k + Math.floor(g.k / 2)) * stride + (x * g.k + Math.floor(g.k / 2)) * 4;
    out[y * T.SW + x] = img[o + 3] > 200 && img[o] < 80 ? 1 : 0;
  }
  return { raster: out, bits: [...T.state.bits], W: T.W, H: T.H, offsets: T.state.offsets.map((o) => o.slice()) };
}

const keyPrint = (page) => page.evaluate(() => window.__twoSheets.VC.fingerprint(window.__twoSheets.state.key));

async function run() {
  const { chromium } = loadPlaywright();
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const url = `${origin}/ideas/40-two-sheets/index.html`;
  const browser = await chromium.launch();
  const consoleErrors = [];
  const hook = (page, tag) => {
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`${tag}: ${m.text()}`); });
    page.on('pageerror', (e) => consoleErrors.push(`${tag}: uncaught ${e.message}`));
  };

  try {
    // ---- desktop ----
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();
      hook(page, 'desktop');
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForTimeout(300);

      const fpBefore = await page.evaluate(() => [...document.querySelectorAll('#fps code')].map((c) => c.textContent));
      await page.fill('#msg', 'A NEW MESSAGE');
      await page.waitForTimeout(200);
      const fpAfter = await page.evaluate(() => [...document.querySelectorAll('#fps code')].map((c) => c.textContent));
      check(fpBefore[0] === fpAfter[0], 'sheet A fingerprint unchanged after editing the message', fpAfter[0]);
      check(fpBefore[1] !== fpAfter[1], 'sheet B fingerprint changed after editing the message');
      const unchangedNote = await page.textContent('#fps');
      check(/unchanged through the last 1 message edit/.test(unchangedNote), 'the page says sheet A is unchanged', unchangedNote.trim());

      // two sheets: aligned read-back is exact
      await page.click('#btnAlign');
      await page.waitForTimeout(100);
      let r = await page.evaluate(READBACK, { threshold: 4 });
      check(r.wrong === 0 && r.black > 200, 'two sheets, aligned: the table canvas decodes to the exact message', `${r.wrong} wrong of ${r.cells}, ${r.black} black cells`);
      check(/Aligned/.test(await page.textContent('#status')), 'status says aligned');
      await page.screenshot({ path: path.join(OUT, 'desktop-two-aligned.png') });

      // one subpixel off: not readable
      await page.click('[data-nudge="1,0"]');
      await page.waitForTimeout(100);
      r = await page.evaluate(READBACK, { threshold: 4 });
      check(r.wrong > 0.15 * r.cells, 'one subpixel to the right: many cells read wrong', `${r.wrong} wrong of ${r.cells}`);
      check(r.offsets[1][0] - r.offsets[0][0] === 1, 'nudge moved the top sheet by exactly one subpixel');
      const slipStatus = await page.textContent('#status');
      check(/1 subpixel right/.test(slipStatus), 'status reports the one-subpixel offset');
      check(!/Nothing to read/.test(slipStatus) && /ghost/.test(slipStatus), 'status warns of a ghost rather than claiming nothing is left', slipStatus);
      // what a camera gets: decode the slipped canvas from its full subpixel pattern
      {
        const rr = await page.evaluate(READRASTER);
        const [dx, dy] = [rr.offsets[1][0] - rr.offsets[0][0], rr.offsets[1][1] - rr.offsets[0][1]];
        // Rows are independent chains at a sideways slip. Leave out the top cell row, whose first
        // subpixel row the sheets' paper tabs overlap by half a subpixel on screen.
        const W = rr.W, H = rr.H - 1;
        const bits = Uint8Array.from(rr.bits.slice(rr.W));
        const raster = Uint8Array.from(rr.raster.slice(2 * 2 * rr.W));
        const p = bits.reduce((a, b) => a + b, 0) / bits.length;
        const res = Leak.analyseObserved(VC, Leak.cellPatterns(raster, W, H), W, H, dx, dy, { bits, p });
        let tp = 0, tn = 0, black = 0;
        for (let i = 0; i < bits.length; i++) { if (bits[i]) { black++; if (res.decoded[i]) tp++; } else if (!res.decoded[i]) tn++; }
        const balanced = (tp / black + tn / (bits.length - black)) / 2;
        check(res.impossible === 0, 'the slipped canvas is exactly the modelled overlay', `${res.impossible} cells unexplained`);
        check(balanced > 0.75 && res.infoPerCell > 0.3 * res.entropyPerCell,
          'one subpixel off, the canvas still gives the message away to a computer',
          `${tp} of ${black} black cells and ${tn} of ${bits.length - black} white cells decoded right (balanced ${(balanced * 100).toFixed(1)}%, coin toss 50%); ${res.infoPerCell.toFixed(3)} of ${res.entropyPerCell.toFixed(3)} bits per cell`);
      }
      // keyboard nudge
      await page.focus('#table');
      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(100);
      r = await page.evaluate(READBACK, { threshold: 4 });
      check(r.wrong === 0, 'ArrowLeft nudges back to alignment and the read-back is exact again');

      // one key, one printing
      {
        const k0 = await keyPrint(page);
        await page.fill('#msg', 'ANOTHER ONE');
        await page.waitForTimeout(200);
        check((await keyPrint(page)) === k0, 'before anything is printed or saved, editing the message keeps the key (the demonstration)');
        const dlA = page.waitForEvent('download');
        await page.click('#downloads button:nth-child(1)');
        await dlA;
        await page.fill('#msg', 'A THIRD ONE');
        await page.waitForTimeout(200);
        check((await keyPrint(page)) === k0, 'saving only the key sheet A keeps the key (make B later)');
        const dlB = page.waitForEvent('download');
        await page.click('#downloads button:nth-child(2)');
        await dlB;
        check(!(await page.isHidden('#keyNote')), 'after saving sheet B the page says the next change draws a fresh key', await page.textContent('#keyNote'));
        await page.fill('#msg', 'A NEW MESSAGE');
        await page.waitForTimeout(200);
        const k1 = await keyPrint(page);
        check(k1 !== k0, 'the first change after saving sheet B draws a fresh key');
        await page.fill('#msg', 'A NEW MESSAGES');
        await page.waitForTimeout(200);
        check((await keyPrint(page)) === k1, 'and only the first: further edits keep the new key until the next save');
        await page.fill('#msg', 'A NEW MESSAGE');
        await page.waitForTimeout(200);
        await page.click('#btnAlign');
        await page.waitForTimeout(100);
      }

      // three sheets: each pair decodes
      const keyBeforeMode = await keyPrint(page);
      await page.click('[data-mode="three"]');
      await page.waitForTimeout(200);
      check((await page.$$('#downloads button')).length === 3, 'three-sheet mode offers three downloads');
      check((await keyPrint(page)) !== keyBeforeMode, 'switching scheme draws a fresh key');
      await page.click('#btnAlign');
      await page.waitForTimeout(100);
      r = await page.evaluate(READBACK, { threshold: 2 });
      check(r.wrong === 0, 'three sheets, all aligned: the read-back is exact (threshold 2)', `${r.wrong} wrong`);
      // move C as far away as the table allows: A+B alone must still read, in the cells C does not cover
      await page.evaluate(() => { const T = window.__twoSheets; const g = T.geometry(); T.state.offsets[2] = [g.fanX, 1000]; T.nudge(0, 0); });
      await page.waitForTimeout(100);
      r = await page.evaluate(READBACK, { threshold: 2, exclude: 2 });
      check(r.wrong === 0 && r.black > 20 && r.cells > 500, 'three sheets, only A and B aligned: still exact where C is out of the way', `${r.wrong} wrong of ${r.cells} uncovered cells, ${r.black} black`);
      check(/Sheets A and B are aligned/.test(await page.textContent('#status')), 'status names the aligned pair');
      await page.screenshot({ path: path.join(OUT, 'desktop-three.png') });

      // two pictures: aligned decodes the secret; each sheet has the darkness of its own cover
      await page.click('[data-mode="cover"]');
      await page.waitForTimeout(200);
      await page.click('#btnAlign');
      await page.waitForTimeout(100);
      r = await page.evaluate(READBACK, { threshold: 4 });
      check(r.wrong === 0, 'two pictures, aligned: the read-back is the exact secret', `${r.wrong} wrong`);
      const coverOk = await page.evaluate(() => {
        const T = window.__twoSheets;
        const covers = [T.state.coverBitsA, T.state.coverBitsB];
        let bad = 0;
        T.state.sheets.forEach((s, i) => { for (let j = 0; j < s.length; j++) if (T.VC.popcount(s[j]) !== (covers[i][j] ? 3 : 2)) bad++; });
        return bad;
      });
      check(coverOk === 0, 'two pictures: every cell of each sheet has its own cover\'s darkness');
      const floorText = await page.textContent('#miFloor');
      const floor = Math.max(...floorText.split(/[–-]/).map(Number));
      check(floor > 0.001 && floor < 0.0018, 'two pictures: the stated bias of the estimate is the conditional one, about 8/(2N ln 2)', floorText);
      await page.screenshot({ path: path.join(OUT, 'desktop-cover-aligned.png'), fullPage: true });

      // print layout
      await page.click('[data-mode="two"]');
      await page.waitForTimeout(200);
      await page.evaluate(() => window.__twoSheets.buildPrintArea());
      const imgs = await page.evaluate(() => [...document.querySelectorAll('#printArea img')].map((i) => [i.naturalWidth, i.naturalHeight]));
      check(imgs.length === 2 && imgs.every(([w, h]) => w === 2200 && h === 1000), 'print area holds two 2200×1000 sheet images', JSON.stringify(imgs));
      await page.emulateMedia({ media: 'print' });
      await page.screenshot({ path: path.join(OUT, 'desktop-print.png'), fullPage: true });
      await page.emulateMedia({ media: 'screen' });
      await ctx.close();
    }

    // ---- phone, touch, dark ----
    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: 'dark' });
      const page = await ctx.newPage();
      hook(page, 'phone');
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForTimeout(300);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(overflow <= 0, 'no horizontal overflow at 390 px', `${overflow}px`);
      const g = await page.evaluate(() => window.__twoSheets.geometry());
      check(g.k >= 3, 'phone layout uses at least 3 device pixels per subpixel', `k=${g.k}, table ${g.tableW} subpixels wide`);
      await page.screenshot({ path: path.join(OUT, 'phone-dark-scattered.png') });

      // a real touch drag of sheet B onto sheet A
      const box = await page.evaluate(() => { const r = document.getElementById('tableCanvas').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
      const before = await page.evaluate(() => window.__twoSheets.state.offsets.map((o) => o.slice()));
      const cssPerSub = box.w / g.tableW;
      const bCenter = { x: box.x + (g.baseX + before[1][0] + 100) * cssPerSub, y: box.y + (g.padY + before[1][1] + 40) * cssPerSub };
      const target = { x: bCenter.x - before[1][0] * cssPerSub + 0.6 * cssPerSub, y: bCenter.y - before[1][1] * cssPerSub - 0.4 * cssPerSub }; // within snap range
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bCenter.x, y: bCenter.y }] });
      for (let i = 1; i <= 8; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: bCenter.x + (target.x - bCenter.x) * (i / 8), y: bCenter.y + (target.y - bCenter.y) * (i / 8) }] });
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(150);
      const after = await page.evaluate(() => window.__twoSheets.state.offsets.map((o) => o.slice()));
      check(after[1][0] === after[0][0] && after[1][1] === after[0][1], 'touch drag moved sheet B onto sheet A and it snapped', `from ${JSON.stringify(before[1])} to ${JSON.stringify(after[1])}`);
      const r = await page.evaluate(READBACK, { threshold: 4 });
      check(r.wrong === 0, 'phone, dark mode, after the touch drag: the read-back is exact', `${r.wrong} wrong`);
      await page.screenshot({ path: path.join(OUT, 'phone-dark-aligned.png') });

      // drawing on the message canvas changes the message and sheet B, not sheet A
      const fpBefore = await page.evaluate(() => [...document.querySelectorAll('#fps code')].map((c) => c.textContent));
      await page.evaluate(() => document.getElementById('msgCanvas').scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(100);
      const mbox = await page.evaluate(() => { const r = document.getElementById('msgCanvas').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: mbox.x + mbox.w * 0.1, y: mbox.y + mbox.h * 0.15 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: mbox.x + mbox.w * 0.3, y: mbox.y + mbox.h * 0.15 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(150);
      const fpAfter = await page.evaluate(() => [...document.querySelectorAll('#fps code')].map((c) => c.textContent));
      const drawn = await page.evaluate(() => window.__twoSheets.state.drawBits.reduce((a, b) => a + b, 0));
      check(drawn > 0, 'touch drawing painted cells on the message', `${drawn} cells`);
      check(fpBefore[0] === fpAfter[0] && fpBefore[1] !== fpAfter[1], 'drawing changed sheet B only');
      await ctx.close();
    }

    // ---- a browser without crypto.getRandomValues: the page must refuse to make sheets ----
    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await ctx.addInitScript(() => { Object.defineProperty(window, 'crypto', { value: undefined, configurable: true }); });
      const page = await ctx.newPage();
      hook(page, 'no-crypto');
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForTimeout(200);
      const st = await page.evaluate(() => ({
        secure: window.__twoSheets.secure,
        print: document.getElementById('btnPrint').disabled,
        saves: [...document.querySelectorAll('#downloads button')].map((b) => b.disabled),
        note: !document.getElementById('noCrypto').hidden,
      }));
      await page.evaluate(() => window.__twoSheets.buildPrintArea());
      const printed = await page.evaluate(() => document.querySelectorAll('#printArea img').length);
      check(!st.secure && st.print && st.saves.length === 2 && st.saves.every(Boolean) && st.note && printed === 0,
        'without crypto.getRandomValues, printing and saving are off and the page says so', JSON.stringify({ ...st, printed }));
      const ctxSecure = await page.evaluate(() => typeof window.crypto);
      check(ctxSecure === 'undefined', 'the no-crypto browser really had no crypto');
      await ctx.close();
    }

    check(consoleErrors.length === 0, 'no console errors or uncaught exceptions', consoleErrors.join(' | '));
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failures ? `\n${failures} check(s) failed` : `\nall checks passed; screenshots in ${OUT}`);
  process.exit(failures ? 1 : 0);
}

run().catch((e) => {
  console.error(e);
  process.exit(2);
});
