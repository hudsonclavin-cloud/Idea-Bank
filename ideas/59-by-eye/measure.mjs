#!/usr/bin/env node
// Measures the five corrections that By Eye asks about in real, openly licensed typefaces.
// It reads TrueType outlines straight from the font files installed on this machine, flattens
// them, and scans them with horizontal and vertical lines. No outline is copied anywhere: only
// the handful of numbers below come out. Run from the repo root:
//
//   node ideas/59-by-eye/measure.mjs          print the table
//   node ideas/59-by-eye/measure.mjs --write  rewrite typefaces.js, the numbers the page shows
//
// The test file imports measureAll() and re-measures every face whose file is present.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const L = createRequire(import.meta.url)('./letters.js');

export const FACES = [
  { name: 'DejaVu Sans', style: 'Book', file: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf' },
  { name: 'DejaVu Sans', style: 'Bold', file: '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' },
  { name: 'Liberation Sans', style: 'Regular', file: '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf' },
  { name: 'Liberation Sans', style: 'Bold', file: '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf' },
  { name: 'Carlito', style: 'Regular', file: '/usr/share/fonts/truetype/crosextra/Carlito-Regular.ttf' },
  { name: 'Carlito', style: 'Bold', file: '/usr/share/fonts/truetype/crosextra/Carlito-Bold.ttf' },
  { name: 'FreeSans', style: 'Regular', file: '/usr/share/fonts/truetype/freefont/FreeSans.ttf' },
  { name: 'FreeSans', style: 'Bold', file: '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf' },
];
// Serif faces whose V ends in a narrow vertex that sinks below the baseline (3-11% of the cap
// height wide, 1% above its lowest point; the sans Vs above are 13-31% wide there and stop flat on
// the baseline). None of the sans faces has a pointed V or A, so these stand in for them.
export const POINTED = [
  { name: 'Liberation Serif', style: 'Regular', file: '/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf' },
  { name: 'Liberation Serif', style: 'Bold', file: '/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf' },
  { name: 'FreeSerif', style: 'Regular', file: '/usr/share/fonts/truetype/freefont/FreeSerif.ttf' },
  { name: 'FreeSerif', style: 'Bold', file: '/usr/share/fonts/truetype/freefont/FreeSerifBold.ttf' },
];

// ---------- a minimal TrueType reader: head, maxp, cmap (format 4), loca, glyf ----------

function readFont(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const numTables = dv.getUint16(4);
  const tables = {};
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + 16 * i;
    const tag = String.fromCharCode(buf[rec], buf[rec + 1], buf[rec + 2], buf[rec + 3]);
    tables[tag] = { offset: dv.getUint32(rec + 8), length: dv.getUint32(rec + 12) };
  }
  for (const t of ['head', 'maxp', 'cmap', 'loca', 'glyf']) {
    if (!tables[t]) throw new Error(`not a TrueType-outline font (no ${t} table)`);
  }
  const head = tables.head.offset;
  const unitsPerEm = dv.getUint16(head + 18);
  const longLoca = dv.getInt16(head + 50) === 1;
  const numGlyphs = dv.getUint16(tables.maxp.offset + 4);

  // cmap: find a Unicode BMP subtable in format 4.
  const cmap = tables.cmap.offset;
  const nSub = dv.getUint16(cmap + 2);
  let sub = -1;
  for (let i = 0; i < nSub; i++) {
    const p = dv.getUint16(cmap + 4 + 8 * i);
    const e = dv.getUint16(cmap + 6 + 8 * i);
    const off = cmap + dv.getUint32(cmap + 8 + 8 * i);
    if (dv.getUint16(off) === 4 && ((p === 3 && e === 1) || p === 0)) {
      sub = off;
      if (p === 3) break;
    }
  }
  if (sub < 0) throw new Error('no format-4 Unicode cmap');
  const segX2 = dv.getUint16(sub + 6);
  const endA = sub + 14;
  const startA = endA + segX2 + 2;
  const deltaA = startA + segX2;
  const rangeA = deltaA + segX2;
  function glyphId(code) {
    for (let i = 0; i < segX2 / 2; i++) {
      const end = dv.getUint16(endA + 2 * i);
      if (code > end) continue;
      const start = dv.getUint16(startA + 2 * i);
      if (code < start) return 0;
      const delta = dv.getInt16(deltaA + 2 * i);
      const ro = dv.getUint16(rangeA + 2 * i);
      if (ro === 0) return (code + delta) & 0xffff;
      const g = dv.getUint16(rangeA + 2 * i + ro + 2 * (code - start));
      return g === 0 ? 0 : (g + delta) & 0xffff;
    }
    return 0;
  }
  function locaAt(i) {
    return longLoca ? dv.getUint32(tables.loca.offset + 4 * i) : 2 * dv.getUint16(tables.loca.offset + 2 * i);
  }

  // Returns contours as arrays of {x, y, on}, plus the glyph's stored bounding box.
  function glyph(gid, depth = 0) {
    if (gid >= numGlyphs) throw new Error(`glyph ${gid} out of range`);
    const start = locaAt(gid);
    const end = locaAt(gid + 1);
    if (end === start) return { contours: [], bbox: null };
    let p = tables.glyf.offset + start;
    const nC = dv.getInt16(p);
    const bbox = { xMin: dv.getInt16(p + 2), yMin: dv.getInt16(p + 4), xMax: dv.getInt16(p + 6), yMax: dv.getInt16(p + 8) };
    p += 10;
    if (nC >= 0) {
      const ends = [];
      for (let i = 0; i < nC; i++) ends.push(dv.getUint16(p + 2 * i));
      p += 2 * nC;
      const insLen = dv.getUint16(p);
      p += 2 + insLen;
      const nPts = nC ? ends[nC - 1] + 1 : 0;
      const flags = [];
      while (flags.length < nPts) {
        const f = buf[p++];
        flags.push(f);
        if (f & 8) {
          let r = buf[p++];
          while (r--) flags.push(f);
        }
      }
      const xs = [];
      let v = 0;
      for (const f of flags) {
        if (f & 2) {
          const d = buf[p++];
          v += f & 16 ? d : -d;
        } else if (!(f & 16)) {
          v += dv.getInt16(p);
          p += 2;
        }
        xs.push(v);
      }
      const ys = [];
      v = 0;
      for (const f of flags) {
        if (f & 4) {
          const d = buf[p++];
          v += f & 32 ? d : -d;
        } else if (!(f & 32)) {
          v += dv.getInt16(p);
          p += 2;
        }
        ys.push(v);
      }
      const contours = [];
      let s = 0;
      for (const e of ends) {
        const c = [];
        for (let i = s; i <= e; i++) c.push({ x: xs[i], y: ys[i], on: !!(flags[i] & 1) });
        contours.push(c);
        s = e + 1;
      }
      return { contours, bbox };
    }
    // Composite glyph: offsets only (no scaled components are needed for the letters measured).
    if (depth > 4) throw new Error('composite nesting too deep');
    const contours = [];
    let more = true;
    while (more) {
      const flags = dv.getUint16(p);
      const comp = dv.getUint16(p + 2);
      p += 4;
      let dx, dy;
      if (flags & 1) {
        dx = dv.getInt16(p);
        dy = dv.getInt16(p + 2);
        p += 4;
      } else {
        dx = dv.getInt8(p);
        dy = dv.getInt8(p + 1);
        p += 2;
      }
      if (!(flags & 2)) throw new Error('point-matched composite not supported');
      if (flags & (8 | 64 | 128)) throw new Error('scaled composite not supported');
      for (const c of glyph(comp, depth + 1).contours) contours.push(c.map((q) => ({ x: q.x + dx, y: q.y + dy, on: q.on })));
      more = !!(flags & 32);
    }
    return { contours, bbox };
  }
  return { unitsPerEm, glyph: (ch) => glyph(glyphId(ch.codePointAt(0))) };
}

// Quadratic TrueType contours -> closed polylines (y up, font units).
function flatten(contours, steps = 24) {
  const polys = [];
  for (const c of contours) {
    const n = c.length;
    if (n < 2) continue;
    // Start at an on-curve point (or the midpoint of two off-curve points).
    let k = c.findIndex((q) => q.on);
    const pts = [];
    let start;
    if (k < 0) {
      start = { x: (c[0].x + c[1].x) / 2, y: (c[0].y + c[1].y) / 2 };
      k = 0;
    } else start = c[k];
    pts.push([start.x, start.y]);
    let prev = start;
    let ctrl = null;
    for (let i = 1; i <= n; i++) {
      const q = c[(k + i) % n];
      const qq = i === n ? start : q;
      if (i === n && !ctrl) {
        pts.push([start.x, start.y]);
        break;
      }
      if (q.on || i === n) {
        const end = i === n ? start : q;
        if (ctrl) {
          for (let s = 1; s <= steps; s++) {
            const t = s / steps;
            const a = (1 - t) * (1 - t);
            const b = 2 * (1 - t) * t;
            const d = t * t;
            pts.push([a * prev.x + b * ctrl.x + d * end.x, a * prev.y + b * ctrl.y + d * end.y]);
          }
        } else pts.push([end.x, end.y]);
        prev = end;
        ctrl = null;
      } else if (ctrl) {
        const mid = { x: (ctrl.x + qq.x) / 2, y: (ctrl.y + qq.y) / 2 };
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          const a = (1 - t) * (1 - t);
          const b = 2 * (1 - t) * t;
          const d = t * t;
          pts.push([a * prev.x + b * ctrl.x + d * mid.x, a * prev.y + b * ctrl.y + d * mid.y]);
        }
        prev = mid;
        ctrl = qq;
      } else ctrl = qq;
    }
    polys.push(pts);
  }
  return polys;
}

// The five numbers, in the units By Eye uses (see measureSet in letters.js, the same code that
// measures the page's own alphabet):
//   round   overshoot of O beyond baseline and cap height, per side, as a fraction of the H's height
//   point   how far A's apex rises above and V's vertex sinks below, per side, same units
//   bar     H crossbar thickness / H stem width
//   middle  height of the centre of H's crossbar / H's height
//   halves  top storey's outer height / sum of both storeys' outer heights (each counted to the far
//           side of the shared waist stroke), scanned at the middle of the 8 and at 62% of the B
// plus two that the page does not ask about but the README discusses:
//   apexWidth  width of the A 1% of the cap height below its top (a flat-cut apex is wide there)
//   vWidth     width of the V 1% of the cap height above its bottom
export function measureFont(file) {
  const f = readFont(fs.readFileSync(file));
  const cache = new Map();
  const getPolys = (ch) => {
    if (!cache.has(ch)) cache.set(ch, flatten(f.glyph(ch).contours));
    return cache.get(ch);
  };
  const m = L.measureSet(getPolys);
  if (Math.abs(L.bboxOf(getPolys('H')).yMin) > 0.5) throw new Error('H does not sit on the baseline');
  const A = getPolys('A');
  const V = getPolys('V');
  const aBox = L.bboxOf(A);
  const vBox = L.bboxOf(V);
  const ax = L.scanLine(A, 'h', aBox.yMax - 0.01 * m.cap);
  const vx = L.scanLine(V, 'h', vBox.yMin + 0.01 * m.cap);
  const r4 = (v) => +v.toFixed(4);
  return {
    unitsPerEm: f.unitsPerEm,
    capHeight: m.cap,
    stem: +m.stem.toFixed(1),
    round: r4(m.round),
    roundTop: r4(m.roundTop),
    roundBottom: r4(m.roundBottom),
    point: r4(m.point),
    pointTop: r4(m.pointTop),
    pointBottom: r4(m.pointBottom),
    apexWidth: r4((ax[ax.length - 1] - ax[0]) / m.cap),
    vWidth: r4((vx[vx.length - 1] - vx[0]) / m.cap),
    bar: r4(m.bar),
    middle: r4(m.middle),
    halves8: r4(m.halves8),
    halvesB: r4(m.halvesB),
  };
}

export function measureAll() {
  const rows = (list, pick) =>
    list.filter((f) => fs.existsSync(f.file)).map((f) => ({ name: f.name, style: f.style, ...pick(measureFont(f.file)) }));
  return {
    sans: rows(FACES, (m) => ({
      capHeight: m.capHeight, round: m.round, roundTop: m.roundTop, roundBottom: m.roundBottom,
      point: m.point, apexWidth: m.apexWidth, vWidth: m.vWidth,
      bar: m.bar, middle: m.middle, halves8: m.halves8, halvesB: m.halvesB,
    })),
    pointed: rows(POINTED, (m) => ({ capHeight: m.capHeight, pointBottom: m.pointBottom, vWidth: m.vWidth, pointTop: m.pointTop })),
  };
}

export function dataFile(data) {
  return `/* By Eye: numbers measured from openly licensed typefaces by measure.mjs (do not edit by hand;
 * regenerate with  node ideas/59-by-eye/measure.mjs --write ). Only these numbers are kept;
 * no outline is copied. Units: fractions of each face's own H height (bar: of its H stem). */
(function (root) {
  const data = ${JSON.stringify(data, null, 2).replace(/\n/g, '\n  ')};
  if (typeof module === 'object' && module.exports) module.exports = data;
  else root.ByEyeTypefaces = data;
})(typeof self !== 'undefined' ? self : this);
`;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1]);
if (isMain) {
  const data = measureAll();
  if (process.argv.includes('--write')) {
    const out = new URL('./typefaces.js', import.meta.url);
    fs.writeFileSync(out, dataFile(data));
    console.log(`wrote ${fileURLToPath(out)}: ${data.sans.length} sans faces, ${data.pointed.length} pointed`);
  } else {
    console.table(data.sans);
    console.table(data.pointed);
  }
}
