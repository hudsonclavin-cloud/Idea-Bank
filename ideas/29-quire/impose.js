// impose.js — Quire's imposition core. Pure functions, no DOM.
//
// Loads as a classic <script> (defines window.Quire) and as a CommonJS module (module.exports),
// so the page and the Node tests run exactly the same code.
//
// Vocabulary. A document has `pages`. A booklet needs a multiple of four, so it is padded with
// blank pages to `padded`. The padded book is printed two pages to a side of a landscape sheet,
// each sheet folded once down its middle, so every sheet carries four pages: front-left,
// front-right, back-left, back-right. A `signature` is a stack of sheets nested one inside the
// next and folded together. "One booklet" is a single signature holding every sheet.
//
// Every page number in a plan is a *padded* page number: what the document will have once
// the blank pages have been inserted. `plan.book[p - 1]` maps padded page p back to the
// original page (or 0 for a blank).
(function (root, factory) {
  if (typeof module === 'object' && module && module.exports) module.exports = factory();
  else root.Quire = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BLANK_PLACEMENTS = ['end', 'beforeLast', 'afterFirst'];
  const MAX_PAGES = 4000;

  function pad4(n) {
    return Math.ceil(n / 4) * 4;
  }

  // The padded book as an array: index i holds the original page number that padded page i+1
  // shows, or 0 if that padded page is a blank.
  function paddedBook(pages, placement) {
    const padded = pad4(pages);
    const k = padded - pages;
    const blanks = new Array(k).fill(0);
    const seq = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
    if (placement === 'afterFirst' && pages >= 1) return [1, ...blanks, ...seq(2, pages)];
    if (placement === 'beforeLast' && pages >= 2) return [...seq(1, pages - 1), ...blanks, pages];
    return [...seq(1, pages), ...blanks];
  }

  // One sheet of a signature. `first` and `last` are the lowest and highest page it carries.
  // Folded with the front outward, the front-right half is the sheet's first page for a book
  // that reads left to right (the fold is on the left), and the front-left half for a book
  // that reads right to left (the fold is on the right).
  function sheetPages(first, last, direction) {
    if (direction === 'rtl') return { front: [first, last], back: [last - 1, first + 1] };
    return { front: [last, first], back: [first + 1, last - 1] };
  }

  function plan(opts) {
    const o = Object.assign(
      { pages: 1, binding: 'booklet', sheetsPerSignature: 4, direction: 'ltr', blanks: 'end' },
      opts || {}
    );
    const pages = Math.floor(Number(o.pages));
    if (!Number.isFinite(pages) || pages < 1) throw new RangeError('pages must be a whole number of at least 1');
    if (pages > MAX_PAGES) throw new RangeError(`pages must be at most ${MAX_PAGES}`);
    const direction = o.direction === 'rtl' ? 'rtl' : 'ltr';
    const placement = BLANK_PLACEMENTS.includes(o.blanks) ? o.blanks : 'end';
    const book = paddedBook(pages, placement);
    const padded = book.length;
    const totalSheets = padded / 4;
    let perSig;
    if (o.binding === 'signatures') {
      perSig = Math.floor(Number(o.sheetsPerSignature));
      if (!Number.isFinite(perSig) || perSig < 1) throw new RangeError('sheetsPerSignature must be at least 1');
    } else {
      perSig = totalSheets;
    }

    const sheets = [];
    const signatures = [];
    let base = 0; // pages already assigned to earlier signatures
    for (let g = 0; base < padded; g++) {
      const count = Math.min(perSig, totalSheets - g * perSig);
      const sig = { n: g + 1, sheets: [], firstPage: base + 1, lastPage: base + 4 * count };
      for (let j = 0; j < count; j++) {
        const first = base + 2 * j + 1;
        const last = base + 4 * count - 2 * j;
        const s = Object.assign({ n: sheets.length + 1, sig: g + 1, inSig: j }, sheetPages(first, last, direction));
        sheets.push(s);
        sig.sheets.push(s);
      }
      signatures.push(sig);
      base += 4 * count;
    }

    const order = [];
    const fronts = [];
    const backs = [];
    for (const s of sheets) {
      order.push(s.front[0], s.front[1], s.back[0], s.back[1]);
      fronts.push(s.front[0], s.front[1]);
      backs.push(s.back[0], s.back[1]);
    }
    const backsReversed = [];
    for (let i = sheets.length - 1; i >= 0; i--) backsReversed.push(sheets[i].back[0], sheets[i].back[1]);

    const blankSlots = [];
    book.forEach((orig, i) => {
      if (orig === 0) blankSlots.push(i + 1);
    });

    const warnings = [];
    const biggest = Math.max(...signatures.map((g) => g.sheets.length));
    if (biggest > 8) {
      warnings.push(
        `${biggest} nested sheets is a thick fold: ordinary office paper creeps (inner pages stick out past the outer ones) by roughly a sheet's thickness per sheet of nesting, and many staplers give up around a dozen sheets. Consider sewn signatures of 4–6 sheets.`
      );
    }
    if (o.binding === 'signatures' && signatures.length > 1) {
      const lastCount = signatures[signatures.length - 1].sheets.length;
      if (lastCount < perSig) warnings.push(`The last signature has only ${lastCount} sheet${lastCount === 1 ? '' : 's'}; that is normal, just sew it like the others.`);
    }

    return {
      pages,
      padded,
      blankCount: padded - pages,
      blankPlacement: placement,
      blankSlots,
      book,
      direction,
      binding: o.binding === 'signatures' ? 'signatures' : 'booklet',
      sheetsPerSignature: perSig,
      sheets,
      signatures,
      order,
      manual: { fronts, backs, backsReversed },
      warnings,
    };
  }

  // Page-range text for a print dialog: "8,1,2,7,6,3,4,5".
  function format(seq) {
    return seq.join(',');
  }

  // Per-signature print order (for printing the cover sheet on card, or one sewn section at a time).
  function signatureOrder(sig) {
    const out = [];
    for (const s of sig.sheets) out.push(s.front[0], s.front[1], s.back[0], s.back[1]);
    return out;
  }

  // ---- Simulators. These are what the tests trust, so they are written from the physical
  // ---- description, not from the formulas above.

  // Fold a signature and read it. Sheets are listed outermost first. Each is folded once down
  // its middle with the front side outward. For a left-to-right book the fold is the left edge:
  // the first thing you see is the outer sheet's front-right half; turn it and the back of that
  // half (back-left, because flipping a sheet over swaps its halves) faces the next sheet's
  // front-right half, and so on inward. After the innermost sheet's back-right half you climb
  // back out through the back-right and then front-left halves. A right-to-left book is the
  // mirror image: the fold is the right edge and you start on the outer sheet's front-left half.
  function readingOrder(sheets, direction) {
    const rtl = direction === 'rtl';
    const out = [];
    for (const s of sheets) out.push(rtl ? s.front[0] : s.front[1], rtl ? s.back[1] : s.back[0]);
    for (let i = sheets.length - 1; i >= 0; i--) {
      const s = sheets[i];
      out.push(rtl ? s.back[0] : s.back[1], rtl ? s.front[1] : s.front[0]);
    }
    return out;
  }

  // Read the whole book: signatures stacked in order, each folded and read as above.
  function readBook(p) {
    const out = [];
    for (const sig of p.signatures) out.push(...readingOrder(sig.sheets, p.direction));
    return out;
  }

  // A printer told "2 pages per sheet, two-sided, flip on the short edge" and given this page
  // sequence: it lays the 1st page on the front-left, the 2nd on the front-right, then images
  // the back so that it reads upright once the sheet is turned over around its short edge
  // (the vertical edge of a landscape sheet). Viewed that way, the 3rd page is on the back's
  // left and the 4th on its right.
  function printerModel(seq) {
    if (seq.length % 4) throw new RangeError('a two-sided 2-up job needs a multiple of 4 pages');
    const sheets = [];
    for (let i = 0; i < seq.length; i += 4) sheets.push({ front: [seq[i], seq[i + 1]], back: [seq[i + 2], seq[i + 3]] });
    return sheets;
  }

  // A single-sided printer: pass 1 prints the fronts (2-up), the stack is turned over and fed
  // again, pass 2 prints the backs. `reversed` models an output tray that stacks face up, so the
  // sheet printed first is re-fed last.
  function printerModelManual(fronts, backs, reversed) {
    if (fronts.length !== backs.length || fronts.length % 2) throw new RangeError('passes must be equal, even lengths');
    const n = fronts.length / 2;
    const sheets = [];
    for (let i = 0; i < n; i++) {
      const b = reversed ? n - 1 - i : i;
      sheets.push({ front: [fronts[2 * i], fronts[2 * i + 1]], back: [backs[2 * b], backs[2 * b + 1]] });
    }
    return sheets;
  }

  // Print a plan's own page string(s) on the model printer, fold the sheets that come out into
  // the plan's signatures, and read the book. This is what the page's preview shows, so a wrong
  // print string would show up there as wrong numbers rather than be drawn as 1, 2, 3 regardless.
  // `printer` is 'duplex' (one two-sided job) or 'simplex' (fronts, stack turned, backs).
  function printAndRead(p, printer) {
    const printed = printer === 'simplex' ? printerModelManual(p.manual.fronts, p.manual.backs, false) : printerModel(p.order);
    return readBook(foldInto(p, printed));
  }

  // Group printed sheets the way the fold steps say: consecutive runs, one per signature.
  function foldInto(p, printed) {
    const signatures = [];
    let i = 0;
    for (const g of p.signatures) {
      signatures.push({ sheets: printed.slice(i, i + g.sheets.length) });
      i += g.sheets.length;
    }
    return { signatures, direction: p.direction };
  }

  // What a sheet looks like when its back was imaged for the other flip: the duplex unit turned
  // it on the long edge instead of the short one, or a single-sided stack went back in rotated.
  // Either way the back image is half a turn out relative to the front, so, seen the right way
  // round, the back's two halves have swapped places and each is upside down. A negative page
  // number means that page upside down.
  function backsTurned(sheets) {
    return sheets.map((s) => ({ front: s.front.slice(), back: [-s.back[1], -s.back[0]] }));
  }

  // The symptom of a wrong flip for this plan: the book as read, and the page found behind the
  // cover (upside down) where page 2 should be.
  function wrongFlip(p) {
    const read = readBook(foldInto(p, backsTurned(printerModel(p.order))));
    return {
      read,
      upsideDown: read.filter((x) => x < 0).map((x) => -x).sort((a, b) => a - b),
      behindCover: -read[1],
    };
  }

  // The original-page sequence to write into a reordered copy of a PDF. Refuses when the plan
  // was made for a different page count than the file has: a shorter plan would silently drop
  // the file's last pages.
  function pdfSequence(p, which, filePages) {
    if (p.pages !== filePages) {
      throw new RangeError(
        `The page count is set to ${p.pages}, but the PDF has ${filePages} page${filePages === 1 ? '' : 's'}. The booklet has to hold every page, so set it back to ${filePages}.`
      );
    }
    const seq = which === 'fronts' ? p.manual.fronts : which === 'backs' ? p.manual.backs : which === 'backsrev' ? p.manual.backsReversed : p.order;
    return seq.map((n) => p.book[n - 1]);
  }

  // Human description of where the blank pages go.
  function describeBlanks(p) {
    if (p.blankCount === 0) return 'No blank pages needed: the page count is already a multiple of four.';
    const n = p.blankCount;
    const s = n === 1 ? '' : 's';
    const where =
      p.blankPlacement === 'afterFirst'
        ? `right after page 1, so the inside of the front cover is blank`
        : p.blankPlacement === 'beforeLast'
          ? `just before the last page, so your last page stays the back cover`
          : `at the end`;
    return `Add ${n} blank page${s} ${where}. The document then has ${p.padded} pages; the blank${s} ${n === 1 ? 'is' : 'are'} page${s} ${p.blankSlots.join(', ')}.`;
  }

  return {
    MAX_PAGES,
    BLANK_PLACEMENTS,
    pad4,
    paddedBook,
    plan,
    format,
    signatureOrder,
    readingOrder,
    readBook,
    printerModel,
    printerModelManual,
    printAndRead,
    foldInto,
    backsTurned,
    wrongFlip,
    pdfSequence,
    describeBlanks,
  };
});
