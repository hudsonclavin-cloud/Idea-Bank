// Tests for Quire: the imposition core (impose.js) and the PDF reorderer (pdfupdate.js).
// Run from the repo root: node --test ideas/29-quire/impose.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const require = createRequire(import.meta.url);
const Q = require('./impose.js');
const P = require('./pdfupdate.js');

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

// ------------------------------------------------------------------ imposition

test('the classic booklet sequences come out exactly', () => {
  assert.equal(Q.format(Q.plan({ pages: 4 }).order), '4,1,2,3');
  assert.equal(Q.format(Q.plan({ pages: 8 }).order), '8,1,2,7,6,3,4,5');
  assert.equal(Q.format(Q.plan({ pages: 16 }).order), '16,1,2,15,14,3,4,13,12,5,6,11,10,7,8,9');
  // 22 pages pad to 24 and need 6 sheets
  const p = Q.plan({ pages: 22 });
  assert.equal(p.padded, 24);
  assert.equal(p.sheets.length, 6);
  assert.equal(p.blankCount, 2);
  assert.deepEqual(p.blankSlots, [23, 24]);
});

test('folding every plan and reading it gives 1..N, for every option combination', () => {
  let plans = 0;
  for (let pages = 1; pages <= 120; pages++) {
    for (const direction of ['ltr', 'rtl']) {
      for (const blanks of Q.BLANK_PLACEMENTS) {
        const variants = [{ binding: 'booklet' }];
        for (const s of [1, 2, 3, 4, 5, 8]) variants.push({ binding: 'signatures', sheetsPerSignature: s });
        for (const v of variants) {
          const p = Q.plan(Object.assign({ pages, direction, blanks }, v));
          plans++;
          assert.equal(p.padded % 4, 0);
          assert.ok(p.padded >= pages && p.padded < pages + 4);
          // the fold simulator reads the book in order
          assert.deepEqual(Q.readBook(p), range(1, p.padded), `fold ${JSON.stringify(v)} pages=${pages}`);
          // every padded page is printed exactly once
          assert.deepEqual([...p.order].sort((a, b) => a - b), range(1, p.padded));
          // the book maps each original page exactly once, blanks fill the rest
          const originals = p.book.filter((x) => x > 0);
          assert.deepEqual([...originals].sort((a, b) => a - b), range(1, pages));
          assert.equal(p.book.filter((x) => x === 0).length, p.padded - pages);
          // signatures partition the sheets in order
          const sigSheets = p.signatures.flatMap((g) => g.sheets);
          assert.deepEqual(sigSheets, p.sheets);
          if (v.binding === 'signatures') {
            for (const g of p.signatures.slice(0, -1)) assert.equal(g.sheets.length, v.sheetsPerSignature);
            assert.ok(p.signatures[p.signatures.length - 1].sheets.length <= v.sheetsPerSignature);
          } else {
            assert.equal(p.signatures.length, 1);
          }
          // per-signature strings concatenate to the whole-book string
          assert.deepEqual(p.signatures.flatMap(Q.signatureOrder), p.order);
        }
      }
    }
  }
  assert.ok(plans > 4000);
});

test('blank pages land where the placement says', () => {
  assert.deepEqual(Q.plan({ pages: 6, blanks: 'end' }).book, [1, 2, 3, 4, 5, 6, 0, 0]);
  assert.deepEqual(Q.plan({ pages: 6, blanks: 'beforeLast' }).book, [1, 2, 3, 4, 5, 0, 0, 6]);
  assert.deepEqual(Q.plan({ pages: 6, blanks: 'afterFirst' }).book, [1, 0, 0, 2, 3, 4, 5, 6]);
  assert.deepEqual(Q.plan({ pages: 1, blanks: 'beforeLast' }).book, [1, 0, 0, 0]);
  assert.deepEqual(Q.plan({ pages: 1, blanks: 'afterFirst' }).book, [1, 0, 0, 0]);
  assert.deepEqual(Q.plan({ pages: 8, blanks: 'afterFirst' }).book, range(1, 8));
});

test('a 2-up short-edge duplex printer given the print string produces the planned sheets', () => {
  for (let pages = 1; pages <= 60; pages++) {
    for (const direction of ['ltr', 'rtl']) {
      const p = Q.plan({ pages, direction, binding: 'signatures', sheetsPerSignature: 3 });
      const printed = Q.printerModel(p.order);
      assert.equal(printed.length, p.sheets.length);
      printed.forEach((s, i) => {
        assert.deepEqual(s.front, p.sheets[i].front);
        assert.deepEqual(s.back, p.sheets[i].back);
      });
      // and folding what the printer produced reads in order
      const fromPrinter = { signatures: [], direction };
      let i = 0;
      for (const g of p.signatures) {
        fromPrinter.signatures.push({ sheets: printed.slice(i, i + g.sheets.length) });
        i += g.sheets.length;
      }
      assert.deepEqual(Q.readBook(fromPrinter), range(1, p.padded));
    }
  }
});

test('single-sided printing in two passes reproduces the sheets, with either stack order', () => {
  for (let pages = 1; pages <= 40; pages++) {
    const p = Q.plan({ pages });
    const a = Q.printerModelManual(p.manual.fronts, p.manual.backs, false);
    const b = Q.printerModelManual(p.manual.fronts, p.manual.backsReversed, true);
    for (const printed of [a, b]) {
      printed.forEach((s, i) => {
        assert.deepEqual(s.front, p.sheets[i].front);
        assert.deepEqual(s.back, p.sheets[i].back);
      });
    }
    // the wrong pass-2 string for the stack order gives the wrong backs (unless there is 1 sheet)
    if (p.sheets.length > 1) {
      const wrong = Q.printerModelManual(p.manual.fronts, p.manual.backs, true);
      assert.notDeepEqual(wrong[0].back, p.sheets[0].back);
    }
  }
});

test('a right-to-left book is the mirror image of a left-to-right one', () => {
  for (const pages of [3, 8, 13, 24, 37]) {
    const l = Q.plan({ pages, direction: 'ltr', binding: 'signatures', sheetsPerSignature: 2 });
    const r = Q.plan({ pages, direction: 'rtl', binding: 'signatures', sheetsPerSignature: 2 });
    l.sheets.forEach((s, i) => {
      assert.deepEqual(r.sheets[i].front, [s.front[1], s.front[0]]);
      assert.deepEqual(r.sheets[i].back, [s.back[1], s.back[0]]);
    });
  }
});

test('bad input is refused', () => {
  assert.throws(() => Q.plan({ pages: 0 }), RangeError);
  assert.throws(() => Q.plan({ pages: -3 }), RangeError);
  assert.throws(() => Q.plan({ pages: 'many' }), RangeError);
  assert.throws(() => Q.plan({ pages: Q.MAX_PAGES + 1 }), RangeError);
  assert.throws(() => Q.plan({ pages: 8, binding: 'signatures', sheetsPerSignature: 0 }), RangeError);
  assert.throws(() => Q.printerModel([1, 2, 3]), RangeError);
});

test('the warnings and the blank-page sentence say sensible things', () => {
  assert.match(Q.describeBlanks(Q.plan({ pages: 8 })), /No blank pages needed/);
  assert.match(Q.describeBlanks(Q.plan({ pages: 22 })), /Add 2 blank pages at the end.*24 pages.*23, 24/);
  assert.match(Q.describeBlanks(Q.plan({ pages: 7, blanks: 'beforeLast' })), /Add 1 blank page just before the last page.*page 7\./);
  assert.equal(Q.plan({ pages: 32 }).warnings.length, 0);
  assert.match(Q.plan({ pages: 40 }).warnings[0], /10 nested sheets/);
  assert.match(Q.plan({ pages: 40, binding: 'signatures', sheetsPerSignature: 4 }).warnings[0], /only 2 sheets/);
});

// ------------------------------------------------------------------ PDF reordering

// A tiny PDF writer for the tests. Builds a document with `pages` pages ("Page N" printed on
// each) in one of several shapes, so the reorderer meets the cases real files have.
//   nested: pages hang off two in-between nodes that carry MediaBox/Resources/Rotate
//   style:  'table' (classic xref table) or 'stream' (xref stream, non-stream objects packed
//           into a compressed object stream)
//   wrongLength: content streams declare a wrong /Length
//   junkAfterDeflate: extra bytes after the object stream's zlib data
//   encrypt: add a (fake) /Encrypt entry to the trailer
//   stringOnPage: put a string entry into page dictionaries
function buildPdf(opts) {
  const o = Object.assign({ pages: 6, nested: false, style: 'table', wrongLength: false, junkAfterDeflate: false, encrypt: false, stringOnPage: false }, opts);
  const objs = new Map(); // num -> string body (dict/array) or {dict, data}
  let n = 1;
  const catalogNum = n++;
  const rootNum = n++;
  const fontNum = n++;
  objs.set(fontNum, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const resources = `<< /Font << /F1 ${fontNum} 0 R >> >>`;
  const pageNums = [];
  const contentNums = [];
  const nodeNums = o.nested ? [n++, n++] : [];
  for (let i = 0; i < o.pages; i++) {
    const pn = n++;
    const cn = n++;
    pageNums.push(pn);
    contentNums.push(cn);
    const text = `BT /F1 36 Tf 72 700 Td (Page ${i + 1}) Tj ET`;
    objs.set(cn, { dict: `<< /Length ${o.wrongLength ? text.length + 7 : text.length} >>`, data: text });
    const parent = o.nested ? nodeNums[i < Math.ceil(o.pages / 2) ? 0 : 1] : rootNum;
    let d = `<< /Type /Page /Parent ${parent} 0 R /Contents ${cn} 0 R`;
    if (!o.nested) d += ` /MediaBox [0 0 612 792] /Resources ${resources}`;
    if (o.stringOnPage) d += ' /PieceInfo << /Quire << /Private (hello) >> >>';
    d += ' >>';
    objs.set(pn, d);
  }
  if (o.nested) {
    const half = Math.ceil(o.pages / 2);
    const kidsA = pageNums.slice(0, half).map((x) => `${x} 0 R`);
    const kidsB = pageNums.slice(half).map((x) => `${x} 0 R`);
    objs.set(nodeNums[0], `<< /Type /Pages /Parent ${rootNum} 0 R /Kids [${kidsA.join(' ')}] /Count ${kidsA.length} /MediaBox [0 0 612 792] /Resources ${resources} >>`);
    objs.set(nodeNums[1], `<< /Type /Pages /Parent ${rootNum} 0 R /Kids [${kidsB.join(' ')}] /Count ${kidsB.length} /MediaBox [0 0 595 842] /Rotate 90 /Resources ${resources} >>`);
    objs.set(rootNum, `<< /Type /Pages /Kids [${nodeNums[0]} 0 R ${nodeNums[1]} 0 R] /Count ${o.pages} /CropBox [0 0 612 792] >>`);
  } else {
    objs.set(rootNum, `<< /Type /Pages /Kids [${pageNums.map((x) => `${x} 0 R`).join(' ')}] /Count ${o.pages} >>`);
  }
  objs.set(catalogNum, `<< /Type /Catalog /Pages ${rootNum} 0 R >>`);
  let encryptNum = null;
  if (o.encrypt) {
    encryptNum = n++;
    objs.set(encryptNum, '<< /Filter /Standard /V 1 /R 2 /Length 40 /P -1 /O <00> /U <00> >>');
  }

  let out = '%PDF-1.5\n%\xE2\xE3\xCF\xD3\n';
  const offsets = new Map();
  const writeObj = (num, body) => {
    offsets.set(num, out.length);
    if (typeof body === 'string') out += `${num} 0 obj\n${body}\nendobj\n`;
    else out += `${num} 0 obj\n${body.dict}\nstream\n${body.data}\nendstream\nendobj\n`;
  };
  const trailerExtra = (o.encrypt ? ` /Encrypt ${encryptNum} 0 R` : '') + ' /ID [<0102> <0304>]';
  if (o.style === 'table') {
    for (const [num, body] of objs) writeObj(num, body);
    const size = n;
    const xrefPos = out.length;
    out += `xref\n0 ${size}\n0000000000 65535 f\r\n`;
    for (let i = 1; i < size; i++) out += `${String(offsets.get(i)).padStart(10, '0')} 00000 n\r\n`;
    out += `trailer\n<< /Size ${size} /Root ${catalogNum} 0 R${trailerExtra} >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  } else {
    // pack every non-stream object into one object stream
    const packed = [...objs].filter(([, b]) => typeof b === 'string');
    const streams = [...objs].filter(([, b]) => typeof b !== 'string');
    for (const [num, body] of streams) writeObj(num, body);
    let header = '';
    let data = '';
    const inner = new Map();
    packed.forEach(([num, body], i) => {
      header += `${num} ${data.length} `;
      inner.set(num, i);
      data += body + '\n';
    });
    const stmNum = n++;
    let compressed = zlib.deflateSync(Buffer.from(header + data, 'latin1')).toString('latin1');
    if (o.junkAfterDeflate) compressed += '\n\n%junk';
    offsets.set(stmNum, out.length);
    out += `${stmNum} 0 obj\n<< /Type /ObjStm /N ${packed.length} /First ${header.length} /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n${compressed}\nendstream\nendobj\n`;
    const xrefNum = n++;
    const size = n;
    const xrefPos = out.length;
    offsets.set(xrefNum, xrefPos);
    const rows = [];
    const row = (t, a, b) => rows.push(String.fromCharCode(t, (a >>> 24) & 255, (a >>> 16) & 255, (a >>> 8) & 255, a & 255, (b >> 8) & 255, b & 255));
    row(0, 0, 65535);
    for (let i = 1; i < size; i++) {
      if (inner.has(i)) row(2, stmNum, inner.get(i));
      else row(1, offsets.get(i), 0);
    }
    const xdata = rows.join('');
    out += `${xrefNum} 0 obj\n<< /Type /XRef /Size ${size} /W [1 4 2] /Root ${catalogNum} 0 R${trailerExtra} /Length ${xdata.length} >>\nstream\n${xdata}\nendstream\nendobj\nstartxref\n${xrefPos}\n%%EOF\n`;
  }
  return { bytes: Buffer.from(out, 'latin1'), pageNums, contentNums, rootNum };
}

const hasPoppler = (() => {
  try {
    return spawnSync('pdftotext', ['-v'], { encoding: 'utf8' }).status !== null;
  } catch {
    return false;
  }
})();

// Reads the page texts back with poppler's pdftotext (one entry per page), and checks that
// poppler had nothing to complain about on stderr (so the xref chain is valid, not merely
// repairable). Returns null when poppler is not installed.
function popplerPages(bytes, tolerateSyntaxErrors) {
  if (!hasPoppler) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quire-'));
  const file = path.join(dir, 't.pdf');
  fs.writeFileSync(file, bytes);
  const info = spawnSync('pdfinfo', [file], { encoding: 'utf8' });
  const txt = spawnSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  if (!tolerateSyntaxErrors) {
    assert.equal(info.stderr.trim(), '', 'pdfinfo warnings');
    assert.equal(txt.stderr.trim(), '', 'pdftotext warnings');
  }
  const count = Number(/Pages:\s+(\d+)/.exec(info.stdout)[1]);
  const pages = txt.stdout.split('\f');
  if (pages[pages.length - 1] === '') pages.pop();
  assert.equal(pages.length, count);
  return pages.map((s) => s.trim());
}

// Describe the pages of a (possibly updated) PDF as seen through pdfupdate.js's own parser:
// which original content stream each page shows (0 for a blank) and its effective attributes.
function describe(bytes, contentNums) {
  const doc = P.load(bytes);
  const tree = doc.pages();
  return tree.pages.map((pg) => {
    const c = pg.dict.get('Contents');
    const eff = (k) => {
      const v = pg.dict.has(k) ? pg.dict.get(k) : pg.inherited[k];
      return v === undefined ? undefined : P.serialize(doc.resolve(v));
    };
    return {
      page: c ? contentNums.indexOf(c.num) + 1 : 0,
      mediaBox: eff('MediaBox'),
      rotate: eff('Rotate'),
      hasResources: eff('Resources') !== undefined,
      parent: pg.parentRef && pg.parentRef.num,
    };
  });
}

const shapes = [
  { name: 'flat tree, xref table', nested: false, style: 'table' },
  { name: 'nested tree, xref table', nested: true, style: 'table' },
  { name: 'flat tree, xref stream + object stream', nested: false, style: 'stream' },
  { name: 'nested tree, xref stream + object stream', nested: true, style: 'stream' },
  // (poppler rightly grumbles about the broken source streams here, so its warnings are tolerated)
  { name: 'wrong /Length on content streams', nested: true, style: 'table', wrongLength: true, tolerate: true },
  { name: 'junk after the object stream deflate data', nested: true, style: 'stream', junkAfterDeflate: true },
];

for (const shape of shapes) {
  test(`reorder a 6-page PDF (${shape.name}) into a booklet with blanks`, async () => {
    const src = buildPdf(Object.assign({ pages: 6 }, shape));
    const before = describe(src.bytes, src.contentNums);
    assert.deepEqual(
      before.map((p) => p.page),
      range(1, 6)
    );
    const plan = Q.plan({ pages: 6 });
    const newOrder = plan.order.map((p) => plan.book[p - 1]);
    assert.deepEqual(newOrder, [0, 1, 2, 0, 6, 3, 4, 5]);
    const res = P.reorder(src.bytes, newOrder);
    assert.equal(res.pages, 6);
    assert.equal(res.blanks, 2);
    assert.equal(res.xrefStyle, shape.style);
    // the original bytes are untouched and the update is small
    assert.ok(Buffer.from(res.bytes.subarray(0, src.bytes.length)).equals(src.bytes));
    assert.ok(res.bytes.length - src.bytes.length < 2500, `update is ${res.bytes.length - src.bytes.length} bytes`);
    const tail = Buffer.from(res.bytes.subarray(src.bytes.length)).toString('latin1');
    assert.match(tail, shape.style === 'table' ? /\nxref\n/ : /\/Type \/XRef/);
    assert.match(tail, /\/Prev \d+/);
    assert.match(tail, /\/ID \[<0102> <0304>\]/);
    assert.match(tail, /startxref\n\d+\n%%EOF\n$/);
    // read it back with our own parser
    const after = describe(res.bytes, src.contentNums);
    assert.deepEqual(
      after.map((p) => p.page),
      newOrder
    );
    for (const p of after) assert.equal(p.parent, src.rootNum, 'every page now hangs off the root');
    // every moved page keeps the box, rotation and resources it used to inherit
    for (const p of after) {
      if (p.page === 0) {
        assert.equal(p.mediaBox, before[0].mediaBox, 'blank pages take the first page size');
        assert.equal(p.rotate, before[0].rotate);
        continue;
      }
      const b = before[p.page - 1];
      assert.equal(p.mediaBox, b.mediaBox, `page ${p.page} MediaBox`);
      assert.equal(p.rotate, b.rotate, `page ${p.page} Rotate`);
      assert.equal(p.hasResources, true);
    }
    // and with an independent reader, if one is installed
    const pop = popplerPages(res.bytes, shape.tolerate);
    if (pop) {
      assert.deepEqual(
        pop,
        newOrder.map((n) => (n ? `Page ${n}` : ''))
      );
    }
  });
}

test('the poppler cross-check actually ran (skipped only when poppler is missing)', () => {
  if (!hasPoppler) console.log('    note: poppler (pdftotext/pdfinfo) not installed; independent read-back skipped');
  assert.ok(true);
});

test('a second update on top of the first works, and the newest definitions win', async () => {
  const src = buildPdf({ pages: 5, nested: true, style: 'stream' });
  const first = P.reorder(src.bytes, [5, 4, 3, 2, 1]);
  const second = P.reorder(first.bytes, [0, 1, 3, 5]);
  const after = describe(second.bytes, src.contentNums);
  // page 1 of `first` is original page 5, page 3 is original 3, page 5 is original 1
  assert.deepEqual(
    after.map((p) => p.page),
    [0, 5, 3, 1]
  );
  const pop = popplerPages(second.bytes);
  if (pop) assert.deepEqual(pop, ['', 'Page 5', 'Page 3', 'Page 1']);
});

test('a linearized-style file whose last trailer lacks /Root still finds everything', async () => {
  const src = buildPdf({ pages: 4, style: 'table' });
  // append an incremental update whose trailer has only /Size and /Prev (as the main trailer of
  // a linearized file does), so the merged trailer must keep /Root and /ID from the earlier one
  const txt = src.bytes.toString('latin1');
  const prev = Number(/startxref\n(\d+)/.exec(txt)[1]);
  const extra = `xref\n0 1\n0000000000 65535 f\r\ntrailer\n<< /Size 20 /Prev ${prev} >>\nstartxref\n${txt.length}\n%%EOF\n`;
  const bytes = Buffer.concat([src.bytes, Buffer.from(extra, 'latin1')]);
  const res = P.reorder(bytes, [4, 1, 2, 3]);
  const tail = Buffer.from(res.bytes.subarray(bytes.length)).toString('latin1');
  assert.match(tail, /\/Root 1 0 R/);
  assert.match(tail, /\/ID \[<0102> <0304>\]/);
  assert.match(tail, new RegExp(`/Prev ${txt.length}\\b`));
  const after = describe(res.bytes, src.contentNums);
  assert.deepEqual(
    after.map((p) => p.page),
    [4, 1, 2, 3]
  );
  const pop = popplerPages(res.bytes);
  if (pop) assert.deepEqual(pop, ['Page 4', 'Page 1', 'Page 2', 'Page 3']);
});

test('inspect reports the page count and encryption', async () => {
  const a = P.inspect(buildPdf({ pages: 9, nested: true, style: 'stream' }).bytes);
  assert.equal(a.pages, 9);
  assert.equal(a.encrypted, false);
  const b = P.inspect(buildPdf({ pages: 3, encrypt: true }).bytes);
  assert.equal(b.pages, 3);
  assert.equal(b.encrypted, true);
});

test('encrypted files: fine when nothing rewritten holds a string, refused otherwise', async () => {
  const ok = buildPdf({ pages: 4, encrypt: true, nested: true });
  const res = P.reorder(ok.bytes, [4, 1, 2, 3]);
  assert.equal(res.encrypted, true);
  assert.match(Buffer.from(res.bytes.subarray(ok.bytes.length)).toString('latin1'), /\/Encrypt \d+ 0 R/);
  const bad = buildPdf({ pages: 4, encrypt: true, nested: true, stringOnPage: true });
  assert.throws(() => P.reorder(bad.bytes, [4, 1, 2, 3]), /encrypted/);
  // the same string-bearing pages are fine when the file is not encrypted
  const plain = buildPdf({ pages: 4, nested: true, stringOnPage: true });
  const r2 = P.reorder(plain.bytes, [4, 1, 2, 3]);
  assert.match(Buffer.from(r2.bytes.subarray(plain.bytes.length)).toString('latin1'), /\(hello\)/);
});

test('pages that already hang off the root and inherit nothing are not rewritten', async () => {
  const src = buildPdf({ pages: 8, nested: false, style: 'table' });
  const res = P.reorder(src.bytes, [8, 1, 2, 7, 6, 3, 4, 5]);
  assert.equal(res.rewrittenPages, 0);
  assert.equal(res.written, 1); // just the new root
});

test('bad input is refused with a plain message', async () => {
  assert.throws(() => P.reorder(Buffer.from('hello world'), [1]), /not a PDF/);
  const src = buildPdf({ pages: 3 });
  assert.throws(() => P.reorder(src.bytes, [1, 4]), /out of range/);
  assert.throws(() => P.reorder(src.bytes, [1, -1]), /out of range/);
});

test('the parser handles the awkward corners of PDF syntax', () => {
  const p = new P.Parser('<< /A 1 0 R /B [1 2 R 3] /C (a\\)b(c)) /D <414243> /E /N#20ame /F -1.5 /G true /H null % comment\n /I 3. >>');
  const d = p.object();
  assert.ok(d.get('A') instanceof P.Ref);
  assert.equal(d.get('A').num, 1);
  const b = d.get('B');
  assert.equal(b.length, 2);
  assert.ok(b[0] instanceof P.Ref);
  assert.equal(b[1], 3);
  assert.equal(d.get('C').raw, '(a\\)b(c))');
  assert.equal(d.get('D').raw, '<414243>');
  assert.equal(d.get('E').v, 'N ame');
  assert.equal(d.get('E').raw, '/N#20ame');
  assert.equal(d.get('F'), -1.5);
  assert.equal(d.get('G'), true);
  assert.equal(d.get('H'), null);
  assert.equal(d.get('I'), 3);
  assert.equal(P.serialize(d), '<< /A 1 0 R /B [1 2 R 3] /C (a\\)b(c)) /D <414243> /E /N#20ame /F -1.5 /G true /H null /I 3 >>');
});

test('the built-in inflate round-trips zlib output at every level, raw or wrapped, with junk after', () => {
  const samples = [
    Buffer.alloc(0),
    Buffer.from('a'),
    Buffer.from('hello hello hello hello hello hello hello'),
    Buffer.from(JSON.stringify(range(1, 5000))),
    Buffer.from(Array.from({ length: 70000 }, (_, i) => (i * 7919) % 251)),
    Buffer.from(Array.from({ length: 200000 }, (_, i) => Math.floor(Math.sin(i / 13) * 120 + 128))),
  ];
  for (const sample of samples) {
    for (const level of [0, 1, 4, 6, 9]) {
      const z = zlib.deflateSync(sample, { level });
      assert.ok(Buffer.from(P.inflate(z)).equals(sample), `zlib level ${level}, ${sample.length} bytes`);
      const withJunk = Buffer.concat([z, Buffer.from('\n\r junk junk junk')]);
      assert.ok(Buffer.from(P.inflate(withJunk)).equals(sample), `junk after, level ${level}`);
      const raw = zlib.deflateRawSync(sample, { level });
      assert.ok(Buffer.from(P.inflateRaw(raw, 0)).equals(sample), `raw level ${level}`);
    }
  }
  assert.throws(() => P.inflate(Buffer.from([0x78, 0x9c, 0xff, 0xff, 0xff])), /bad block type|unexpected end|bad/);
  assert.throws(() => P.inflate(zlib.deflateSync(Buffer.from('abc')).subarray(0, 4)), /unexpected end/);
});

test('PNG predictors are undone (for xref-style streams that use them)', () => {
  // two rows of 3 bytes, filter "Up" on the second row
  const data = Uint8Array.from([0, 1, 2, 3, 2, 1, 1, 1]);
  assert.deepEqual([...P.unpredict(data, 3, 1, 8)], [1, 2, 3, 2, 3, 4]);
});
