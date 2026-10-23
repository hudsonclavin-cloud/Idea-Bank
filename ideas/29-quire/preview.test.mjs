// Browser tests for Quire's page (index.html), run in headless Chromium when Playwright is
// installed (globally is fine) and skipped otherwise. They pin what the Node tests cannot see:
//   - the page-turn preview draws what the model printer and fold produce, so a broken
//     impose.js shows wrong numbers instead of a reassuring 1, 2, 3;
//   - once a PDF is loaded its page count is locked, and the save refuses a mismatched count
//     instead of silently dropping pages;
//   - the troubleshooting example follows the plan, and the encryption note makes no promise
//     about passwords.
// Run from the repo root: node --test ideas/29-quire/preview.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);

function loadPlaywright() {
  for (const base of [HERE, (() => { try { return execSync('npm root -g', { encoding: 'utf8' }).trim(); } catch { return null; } })()]) {
    if (!base) continue;
    try {
      return createRequire(path.join(base, 'noop.js'))('playwright');
    } catch {
      /* try the next place */
    }
  }
  return null;
}
const pw = loadPlaywright();
const skip = pw ? false : 'Playwright is not installed';

// A minimal flat PDF with `pages` pages; `encrypt` adds an /Encrypt entry to the trailer.
function tinyPdf(pages, encrypt) {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', null, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids = [];
  for (let i = 0; i < pages; i++) {
    const t = `BT /F1 24 Tf 72 700 Td (P${i + 1}) Tj ET`;
    objs.push(`<< /Length ${t.length} >>\nstream\n${t}\nendstream`);
    const c = objs.length;
    objs.push(`<< /Type /Page /Parent 2 0 R /Contents ${c} 0 R /MediaBox [0 0 420 595] /Resources << /Font << /F1 3 0 R >> >> >>`);
    kids.push(`${objs.length} 0 R`);
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages} >>`;
  if (encrypt) objs.push('<< /Filter /Standard /V 1 /R 2 /Length 40 /P -1 /O <00> /U <00> >>');
  let out = '%PDF-1.4\n';
  const off = [];
  objs.forEach((o, i) => {
    off.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f\r\n` + off.map((o) => `${String(o).padStart(10, '0')} 00000 n\r\n`).join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R${encrypt ? ` /Encrypt ${objs.length} 0 R` : ''} >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

async function withPage(dir, fn) {
  const browser = await pw.chromium.launch();
  try {
    const page = await browser.newPage({ reducedMotion: 'reduce', acceptDownloads: true });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('file://' + path.join(dir, 'index.html'));
    await fn(page);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
}

const setPages = (page, n) => page.evaluate((v) => {
  const el = document.getElementById('pages');
  el.value = String(v);
  el.dispatchEvent(new Event('input'));
}, n);

// Fold, then turn through every spread; returns the numbers drawn on each.
async function readPreview(page) {
  await page.click('#btnFold');
  const spreads = [];
  while (!(await page.$eval('#btnNext', (b) => b.disabled))) {
    await page.click('#btnNext');
    spreads.push(await page.$$eval('#stage text', (ts) => ts.map((t) => t.textContent).filter((s) => /^(\d+|blank)$/.test(s)).join('|')));
  }
  return spreads;
}

test('the page-turn preview shows what printing and folding the order produces', { skip }, async () => {
  await withPage(HERE, async (page) => {
    await setPages(page, 8);
    assert.equal(await page.textContent('#order-all'), '8,1,2,7,6,3,4,5');
    assert.deepEqual(await readPreview(page), ['2|3', '4|5', '6|7', '8']);
    assert.equal(await page.$$eval('#warnings .err', (e) => e.length), 0);
  });
  // The same page with a deliberately broken impose.js (each back's halves swapped). Before
  // the revision the preview still read 2|3, 4|5, 6|7 here; now it shows the damage.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quire-broken-'));
  try {
    for (const f of ['index.html', 'pdfupdate.js']) fs.copyFileSync(path.join(HERE, f), path.join(tmp, f));
    const src = fs.readFileSync(path.join(HERE, 'impose.js'), 'utf8');
    const bad = src.replace('return { front: [last, first], back: [first + 1, last - 1] };', 'return { front: [last, first], back: [last - 1, first + 1] };');
    assert.notEqual(bad, src);
    fs.writeFileSync(path.join(tmp, 'impose.js'), bad);
    await withPage(tmp, async (page) => {
      await setPages(page, 8);
      assert.equal(await page.textContent('#order-all'), '8,1,7,2,6,3,5,4');
      assert.deepEqual(await readPreview(page), ['7|3', '5|4', '6|2', '8']);
      assert.match(await page.textContent('#warnings'), /do not print it/);
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a loaded PDF locks the page count, and the save refuses a different count', { skip }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quire-pdf-'));
  try {
    const file = path.join(tmp, 'twentytwo.pdf');
    fs.writeFileSync(file, tinyPdf(22));
    await withPage(HERE, async (page) => {
      await page.setInputFiles('#file', file);
      await page.waitForSelector('#pdfpath:not([hidden])');
      assert.equal(await page.inputValue('#pages'), '22');
      assert.equal(await page.$eval('#pages', (e) => e.readOnly), true);
      assert.match(await page.textContent('#pdfexplain'), /with its 22 pages in booklet order/);
      // force the field anyway (as the old page allowed): the save must refuse, not drop 17-22
      await setPages(page, 16);
      let downloaded = false;
      page.on('download', () => (downloaded = true));
      await page.click('button[data-pdf=all]');
      await page.waitForFunction(() => document.getElementById('pdferr').textContent.length > 0);
      assert.match(await page.textContent('#pdferr'), /set to 16, but the PDF has 22 pages/);
      assert.equal(downloaded, false);
      // with the right count it saves all 22 pages plus 2 blanks
      await setPages(page, 22);
      const dl = page.waitForEvent('download');
      await page.click('button[data-pdf=all]');
      const saved = path.join(tmp, 'out.pdf');
      await (await dl).saveAs(saved);
      const P = createRequire(import.meta.url)('./pdfupdate.js');
      assert.equal(P.inspect(fs.readFileSync(saved)).pages, 24);
      // forgetting the PDF unlocks the field
      await page.click('#forget');
      assert.equal(await page.$eval('#pages', (e) => e.readOnly), false);
      assert.equal(await page.$eval('#pdfpath', (e) => e.hidden), true);
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('the wrong-flip example follows the plan, and the encryption note makes no password promise', { skip }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quire-enc-'));
  try {
    const file = path.join(tmp, 'locked.pdf');
    fs.writeFileSync(file, tinyPdf(8, true));
    await withPage(HERE, async (page) => {
      assert.match(await page.textContent('#wrongflip'), /page 23 behind the cover/);
      await setPages(page, 8);
      assert.match(await page.textContent('#wrongflip'), /page 7 behind the cover/);
      await setPages(page, 40);
      await page.click('label:has(input[name=binding][value=signatures])');
      assert.match(await page.textContent('#wrongflip'), /page 15 behind the cover/); // 4-sheet signatures
      await page.setInputFiles('#file', file);
      await page.waitForSelector('#pdfpath:not([hidden])');
      const info = await page.textContent('#fileinfo');
      assert.match(info, /encrypted/);
      assert.doesNotMatch(info, /opens without a password/);
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
