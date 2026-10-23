/* Lies Flat — seeded crease patterns that fold flat, drawn beside the shape they fold into.

   Pure module: seed in, SVG string out (plus statistics and a verification report).
   Loads as a classic browser script (window.LiesFlat) or as a CommonJS module in Node.
   Nothing here uses Math.random: every choice flows from makeRng(seed).

   The sheet is a quadrilateral mesh. Its columns are straight parallel lines; its rows are
   zigzags, and at every vertex the two row arms are mirror images across the column. That one
   rule gives Kawasaki's condition at every vertex and makes each strip between two columns the
   mirror image of its neighbour. With columns that are all-mountain or all-valley in turn, and
   rows checkerboarded, the sheet folds flat in two stages of plain accordion pleats (README,
   "How it works"). The left panel of the drawing is the crease pattern. The right panel is the
   same creases after folding, each in its own colour, moved by the composition of reflections
   that folding applies to it, as if the paper were transparent (the cut edges are left out). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LiesFlat = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEG = Math.PI / 180;
  const TAU = Math.PI * 2;

  // ------------------------------------------------------------------ PRNG
  // cyrb128: string -> four 32-bit words. sfc32: small fast counter generator.
  function cyrb128(str) {
    let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
    for (let i = 0; i < str.length; i++) {
      const k = str.charCodeAt(i);
      h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
      h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
      h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
      h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
    }
    h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
    h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
    h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
    h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
    return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
  }
  function sfc32(a, b, c, d) {
    return function () {
      a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
      let t = (a + b) | 0;
      a = b ^ (b >>> 9);
      b = (c + (c << 3)) | 0;
      c = (c << 21) | (c >>> 11);
      d = (d + 1) | 0;
      t = (t + d) | 0;
      c = (c + t) | 0;
      return (t >>> 0) / 4294967296;
    };
  }
  function makeRng(seed) {
    const s = cyrb128(String(seed));
    const f = sfc32(s[0], s[1], s[2], s[3]);
    for (let i = 0; i < 16; i++) f();
    return {
      next: f,
      range: (lo, hi) => lo + (hi - lo) * f(),
      int: (lo, hi) => lo + Math.floor((hi - lo + 1) * f()),
      chance: (p) => f() < p,
      sign: () => (f() < 0.5 ? -1 : 1),
      weighted: (items) => {
        let tot = 0;
        for (const it of items) tot += it[1];
        let x = f() * tot;
        for (const it of items) {
          x -= it[1];
          if (x < 0) return it[0];
        }
        return items[items.length - 1][0];
      },
    };
  }

  // ------------------------------------------------------------------ deterministic arithmetic
  // JavaScript fixes + - * / and sqrt to IEEE 754 double rounding, but not sin, cos, tan, atan2 or
  // hypot: engines may differ in the last bit (Node 22 and Chromium 141 do, for sin and cos).
  // These versions use only + - * / and sqrt, so every engine computes the same bits and the
  // same seed gives the same SVG everywhere. Accuracy is about 1e-16 on the ranges used here.
  const HALF_PI = Math.PI / 2;
  function sinCos(x) { // [sin x, cos x]
    const k = Math.round(x / HALF_PI);
    const r = (x - k * 1.5707963267948966) - k * 6.123233995736766e-17; // two-part pi/2
    const r2 = r * r;
    let s = 1 / 355687428096000; // 1/17!
    s = 1 / 1307674368000 - r2 * s;
    s = 1 / 6227020800 - r2 * s;
    s = 1 / 39916800 - r2 * s;
    s = 1 / 362880 - r2 * s;
    s = 1 / 5040 - r2 * s;
    s = 1 / 120 - r2 * s;
    s = 1 / 6 - r2 * s;
    s = r - r * r2 * s;
    let c = 1 / 6402373705728000; // 1/18!
    c = 1 / 20922789888000 - r2 * c;
    c = 1 / 87178291200 - r2 * c;
    c = 1 / 479001600 - r2 * c;
    c = 1 / 3628800 - r2 * c;
    c = 1 / 40320 - r2 * c;
    c = 1 / 720 - r2 * c;
    c = 1 / 24 - r2 * c;
    c = 1 / 2 - r2 * c;
    c = 1 - r2 * c;
    switch (((k % 4) + 4) % 4) {
      case 0: return [s, c];
      case 1: return [c, -s];
      case 2: return [-s, -c];
      default: return [-c, s];
    }
  }
  const dsin = (x) => sinCos(x)[0];
  const dtan = (x) => { const [s, c] = sinCos(x); return s / c; };
  function datan(x) {
    if (x < 0) return -datan(-x);
    if (x > 1) return HALF_PI - datan(1 / x);
    // halve the argument twice: atan(x) = 2 atan(x / (1 + sqrt(1 + x^2)))
    let y = x / (1 + Math.sqrt(1 + x * x));
    y = y / (1 + Math.sqrt(1 + y * y));
    const y2 = y * y;
    let p = 0;
    for (let n = 21; n >= 3; n -= 2) p = 1 / n - y2 * p; // series 1/3 - y^2/5 + ... (alternating)
    return 4 * (y - y * y2 * p);
  }
  function datan2(y, x) {
    if (x > 0) return datan(y / x);
    if (x < 0) return y >= 0 ? datan(y / x) + Math.PI : datan(y / x) - Math.PI;
    return y > 0 ? HALF_PI : y < 0 ? -HALF_PI : 0;
  }
  const hyp = (x, y) => Math.sqrt(x * x + y * y);

  // ------------------------------------------------------------------ vectors
  const v = (x, y) => ({ x, y });
  const sub = (a, b) => v(a.x - b.x, a.y - b.y);
  const dot = (a, b) => a.x * b.x + a.y * b.y;
  const cross = (a, b) => a.x * b.y - a.y * b.x;
  const len = (a) => hyp(a.x, a.y);
  const norm = (a) => { const l = len(a); return v(a.x / l, a.y / l); };
  const dist = (a, b) => hyp(a.x - b.x, a.y - b.y);
  // Reflect a direction across the line (through the origin) with unit direction m.
  const reflect = (d, m) => { const k = 2 * dot(d, m); return v(k * m.x - d.x, k * m.y - d.y); };
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => t * t * (3 - 2 * t);

  // ------------------------------------------------------------------ paper, pens, plotter
  const PAGE = { w: 420, h: 297 }; // A3 landscape, millimetres
  const PEN_WIDTH = 0.3; // mm, both pens
  const PENS = [
    { id: 'pen-1-black', name: 'black', colour: '#000000' },
    { id: 'pen-2-red', name: 'red', colour: '#c8102e' },
  ];
  const PLOT = { draw: 40, travel: 80, lift: 0.25 }; // mm/s pen down, mm/s pen up, s per pen lift (estimate only)
  const MARGIN = 34; // mm, at least, on all four sides
  const GUTTER = 30; // mm between the two panels
  const SHEET_H = 200; // sheet units; the sheet is scaled onto the page afterwards
  const MIN_SIDE = 2.5; // sheet units: shortest side allowed on any quad that touches the sheet
  const MIN_SECTOR = 40; // degrees: sharpest corner allowed at any vertex
  const MERGE_TOL = 0.06; // mm: folded lines closer than this (and touching) are drawn once
  const DIGITS = 2; // decimals in the SVG: 0.01 mm

  const MOUNTAIN = 1, VALLEY = 0;

  // ------------------------------------------------------------------ the design (seed -> parameters)
  // With constant zigzag angle phi the folded strip turns 4*phi every two rows; phi = 90k/n brings
  // it back to its start after n turns, an {n/k} rosette. Only n >= 7: smaller n retrace too soon.
  const CLOSING = [[9, 2], [13, 3], [11, 3], [7, 2], [10, 3], [13, 4], [11, 4], [8, 3]]
    .map(([n, k]) => ({ n, k, phi: (90 * k) / n }));

  function makeDesign(rng) {
    const d = {};
    // "rich": columns of graded width, so the folded columns fan out into bands of lines.
    // "sparse": equal columns, so every strip folds onto the same lines and the drawing stays open.
    d.register = rng.weighted([['rich', 3], ['sparse', 2]]);
    d.aspect = rng.weighted([[1, 3], [0.8, 2], [0.7, 1]]); // width : height of the sheet
    d.H = SHEET_H;
    d.W = d.aspect * d.H;
    // A sparse drawing shows every irregularity of the folded strip's winding, so it gets only
    // a constant angle or a gentle wave; ramps are kept for the rich register.
    d.phiMode = d.register === 'rich' ? rng.weighted([['constant', 4], ['ramp', 3], ['wave', 2]])
      : rng.weighted([['constant', 3], ['wave', 1]]);
    d.phiA = rng.range(17, 31);
    d.phiB = d.phiA;
    d.closing = null;
    if (d.phiMode === 'constant' && rng.chance(0.5)) {
      d.closing = CLOSING[Math.floor(rng.next() * CLOSING.length)];
      d.phiA = d.phiB = d.closing.phi;
    } else if (d.phiMode === 'constant') {
      // keep clear of the angles that close after 3, 4 or 5 turns (30, 22.5, 18 degrees): there the
      // folded strip nearly retraces itself and the drawing collapses into a few thick bundles
      for (const bad of [18, 22.5, 30]) if (Math.abs(d.phiA - bad) < 1) d.phiA = bad + (d.phiA < bad ? -1 : 1);
      d.phiB = d.phiA;
    } else if (d.phiMode === 'ramp') {
      d.phiB = clamp(d.phiA + rng.sign() * rng.range(5, 12), 15, 33);
    } else if (d.phiMode === 'wave') {
      d.phiB = d.register === 'rich' ? rng.range(3, 7) : rng.range(2, 4); // amplitude, degrees
      d.waveN = rng.range(0.6, 1.6);
      d.wavePh = rng.range(0, TAU);
    }
    d.gapGrad = rng.chance(0.45) ? rng.sign() * rng.range(0.3, 0.75) : 0;
    if (d.register === 'rich') {
      d.widthGrad = rng.sign() * rng.range(0.25, 0.6);
      d.C = clamp(Math.round(d.W / rng.range(10, 16)), 8, 24);
      d.gapRatio = rng.range(0.35, 0.9);
    } else {
      d.widthGrad = 0;
      d.C = clamp(Math.round(d.W / rng.range(8, 12)), 10, 28);
      d.gapRatio = rng.range(0.3, 0.6);
    }
    d.mvCol = rng.int(0, 1); // which pen the first column gets
    d.mvRow = rng.int(0, 1);
    return d;
  }

  function phiAt(d, u) {
    u = clamp(u, 0, 1);
    if (d.phiMode === 'constant') return d.phiA * DEG;
    if (d.phiMode === 'ramp') return lerp(d.phiA, d.phiB, smooth(u)) * DEG;
    return (d.phiA + d.phiB * dsin(TAU * d.waveN * u + d.wavePh)) * DEG;
  }

  // ------------------------------------------------------------------ the mesh
  // Columns are the vertical lines x = xs[i]. Row r is a zigzag through one vertex on each column,
  // P[r][i] = (xs[i], y). Its first arm leaves column 0 at angle phi above or below the horizontal
  // (alternating row by row), and at each column the next arm is the mirror image of the arriving
  // one across the column. Rows are stacked so that the smallest vertical step between
  // consecutive rows equals the gap.
  function columnXs(d) {
    const wts = [];
    for (let i = 0; i < d.C; i++) wts.push(1 + d.widthGrad * ((i + 0.5) / d.C - 0.5));
    const tot = wts.reduce((a, b) => a + b, 0);
    const xs = [0];
    for (let i = 0; i < d.C; i++) xs.push(xs[i] + (d.W * wts[i]) / tot);
    xs[d.C] = d.W;
    return xs;
  }

  // Heights of a row's vertices relative to its first, for zigzag angle phi and first-arm sign s.
  // Mirroring a direction across a vertical line negates its x; arms always travel rightwards, so
  // each arm climbs or falls by (its width) * tan(phi), alternately.
  function rowShape(xs, phi, s) {
    const t = [0];
    const k = dtan(phi);
    let sign = -s; // SVG y points down: s = +1 means the first arm rises on the page
    for (let i = 0; i + 1 < xs.length; i++) {
      t.push(t[i] + sign * (xs[i + 1] - xs[i]) * k);
      sign = -sign;
    }
    return t;
  }

  function buildMesh(d) {
    const xs = columnXs(d);
    const C = d.C, H = d.H;
    const wMid = d.W / C;
    const gapAt = (u) => d.gapRatio * wMid * (1 + d.gapGrad * (clamp(u, 0, 1) - 0.5));
    const rows = [];
    let s = 1;
    let sh = rowShape(xs, phiAt(d, 0), s);
    let mx = -Infinity;
    for (const x of sh) mx = Math.max(mx, x);
    rows.push({ y: sh.map((x) => x - mx), s }); // its lowest vertex touches y = 0
    for (let r = 1; r < 400; r++) {
      const prev = rows[r - 1].y;
      let mn = Infinity;
      for (const y of prev) mn = Math.min(mn, y);
      const u = mn / H;
      s = -s;
      sh = rowShape(xs, phiAt(d, u), s);
      let m = Infinity;
      for (let i = 0; i <= C; i++) m = Math.min(m, sh[i] - prev[i]);
      const y0 = gapAt(u) - m; // the smallest step between the two rows is the gap
      const row = { y: sh.map((x) => x + y0), s };
      rows.push(row);
      let lo = Infinity;
      for (const y of row.y) lo = Math.min(lo, y);
      if (lo > H) break; // wholly below y = H
      if (r === 399) return null;
    }
    const R = rows.length - 1;
    const P = rows.map((row) => row.y.map((y, i) => v(xs[i], y)));
    return { d, xs, rows, P, R, C };
  }

  // ------------------------------------------------------------------ the sheet's edges
  // The sheet is cut along whole rows: its side edges are columns 0 and C, its top edge is the
  // first row lying wholly at y >= 0 and its bottom edge the last row lying wholly at y <= H.
  // So no crease is ever cut short, and the folded drawing has no stray stubs.
  function chooseEdges(mesh) {
    let r0 = -1, r1 = -1;
    for (let r = 0; r <= mesh.R; r++) {
      let lo = Infinity, hi = -Infinity;
      for (const p of mesh.P[r]) { lo = Math.min(lo, p.y); hi = Math.max(hi, p.y); }
      if (r0 < 0 && lo >= 0) r0 = r;
      if (hi <= mesh.d.H) r1 = r;
    }
    if (r0 < 0 || r1 - r0 < 6) return null;
    let top = Infinity, bottom = -Infinity;
    for (const p of mesh.P[r0]) top = Math.min(top, p.y);
    for (const p of mesh.P[r1]) bottom = Math.max(bottom, p.y);
    return { r0, r1, top, bottom };
  }

  // ------------------------------------------------------------------ mountains and valleys
  // Columns: each column is one kind all the way along, alternating column by column.
  // Rows: a checkerboard, alternating along each row and down each strip.
  // At every vertex the two row arms differ and both halves of the column match one of them:
  // three of one kind and one of the other (Maekawa), the odd one beside a smallest angle.
  function colType(d, i) { return (i + d.mvCol) % 2 === 0 ? MOUNTAIN : VALLEY; }
  function rowType(d, r, i) { return (r + i + d.mvRow) % 2 === 0 ? MOUNTAIN : VALLEY; }

  // ------------------------------------------------------------------ checks at every vertex
  function vertexCreases(mesh, r, i) {
    const p = mesh.P[r][i], d = mesh.d;
    const cr = [
      { d: sub(mesh.P[r][i + 1], p), type: rowType(d, r, i) },
      { d: sub(mesh.P[r + 1][i], p), type: colType(d, i) },
      { d: sub(mesh.P[r][i - 1], p), type: rowType(d, r, i - 1) },
      { d: sub(mesh.P[r - 1][i], p), type: colType(d, i) },
    ];
    for (const c of cr) c.ang = datan2(c.d.y, c.d.x);
    cr.sort((a, b) => a.ang - b.ang);
    const sectors = [];
    for (let k = 0; k < 4; k++) {
      let s = cr[(k + 1) % 4].ang - cr[k].ang;
      if (k === 3) s += TAU;
      sectors.push(s); // sector k lies between crease k and crease k+1
    }
    return { creases: cr, sectors };
  }

  function isInterior(mesh, ed, r, i) {
    return i > 0 && i < mesh.C && r > ed.r0 && r < ed.r1;
  }

  function verify(mesh, ed) {
    const rep = { vertices: 0, kawasakiMax: 0, maekawaFail: 0, oddFail: 0, mirrorMax: 0, minSector: Infinity, ok: true };
    for (let r = 1; r < mesh.R; r++) {
      for (let i = 1; i < mesh.C; i++) {
        if (!isInterior(mesh, ed, r, i)) continue;
        const { creases, sectors } = vertexCreases(mesh, r, i);
        rep.vertices++;
        // Kawasaki: alternate sectors sum to 180 degrees
        const dev = Math.max(Math.abs(sectors[0] + sectors[2] - Math.PI), Math.abs(sectors[1] + sectors[3] - Math.PI));
        rep.kawasakiMax = Math.max(rep.kawasakiMax, dev);
        // Maekawa: mountains minus valleys is +-2
        let m = 0;
        for (const c of creases) m += c.type;
        if (m !== 1 && m !== 3) { rep.maekawaFail++; continue; }
        // big-little-big: the odd crease must bound a smallest sector
        const oddType = m === 3 ? VALLEY : MOUNTAIN;
        const odd = creases.findIndex((c) => c.type === oddType);
        const mn = Math.min(...sectors);
        if (!(Math.min(sectors[odd], sectors[(odd + 3) % 4]) - mn < 1e-9)) rep.oddFail++;
        rep.minSector = Math.min(rep.minSector, mn);
        // the mirror rule: the row arms are reflections of each other across the (vertical) column
        const aR = norm(sub(mesh.P[r][i + 1], mesh.P[r][i])), aL = norm(sub(mesh.P[r][i - 1], mesh.P[r][i]));
        rep.mirrorMax = Math.max(rep.mirrorMax, len(sub(reflect(aL, v(0, 1)), aR)));
      }
    }
    rep.ok = rep.vertices > 0 && rep.kawasakiMax < 1e-9 && rep.maekawaFail === 0 && rep.oddFail === 0 &&
      rep.mirrorMax < 1e-9 && rep.minSector >= MIN_SECTOR * DEG;
    return rep;
  }

  // The preconditions of the two-stage folding argument (README, "How it works"):
  //  1. every column is one straight vertical line;
  //  2. at every vertex of every row, the two row arms are mirror images across the column (so
  //     after the columns are pleated, each row lies on one line in all layers);
  //  3. each column is all one kind, and neighbouring columns differ (stage 1 is an accordion);
  //  4. along each row the kind alternates column by column, so that once the columns are pleated
  //     (which turns every other layer over) every layer sees the row as the same kind; and
  //     consecutive rows differ (stage 2 is an accordion too);
  //  5. rows never cross inside a strip (checked by quadsOk).
  function twoStageOk(mesh) {
    const { R, C, P, d, xs } = mesh;
    for (let r = 0; r <= R; r++) for (let i = 0; i <= C; i++) if (P[r][i].x !== xs[i]) return false;
    for (let r = 0; r <= R; r++) {
      for (let i = 1; i < C; i++) {
        const aR = norm(sub(P[r][i + 1], P[r][i])), aL = norm(sub(P[r][i - 1], P[r][i]));
        if (len(sub(reflect(aL, v(0, 1)), aR)) > 1e-9) return false;
      }
    }
    for (let i = 1; i + 1 < C; i++) if (colType(d, i) === colType(d, i + 1)) return false;
    for (let r = 0; r <= R; r++) {
      const seen = rowType(d, r, 0);
      for (let i = 1; i < C; i++) if ((rowType(d, r, i) ^ (i % 2)) !== seen) return false;
      if (r > 0 && rowType(d, r, 0) === rowType(d, r - 1, 0)) return false;
    }
    return true;
  }

  // Every quad of the sheet must be convex with no tiny side, so rows never meet in a strip.
  const onSheet = (r, ed) => r >= ed.r0 && r < ed.r1; // face row r lies between rows r and r+1
  function quadsOk(mesh, ed) {
    for (let r = 0; r < mesh.R; r++) {
      for (let i = 0; i < mesh.C; i++) {
        const q = [mesh.P[r][i], mesh.P[r][i + 1], mesh.P[r + 1][i + 1], mesh.P[r + 1][i]];
        if (!onSheet(r, ed)) continue;
        let sgn = 0;
        for (let k = 0; k < 4; k++) {
          const a = sub(q[(k + 1) % 4], q[k]), b = sub(q[(k + 2) % 4], q[(k + 1) % 4]);
          if (len(a) < MIN_SIDE) return false;
          const c = cross(a, b);
          if (Math.abs(c) < 1e-9) return false;
          if (sgn === 0) sgn = Math.sign(c);
          else if (Math.sign(c) !== sgn) return false;
        }
      }
    }
    return true;
  }

  // ------------------------------------------------------------------ the folded state
  // Each face carries an isometry: the composition of the reflections across the creases crossed
  // on a path from the root face. Kawasaki at every vertex makes it independent of the path; the
  // breadth-first walk measures how far two paths' answers disagree (the "holonomy").
  function reflectionAcross(p, m) {
    const a = 2 * m.x * m.x - 1, b = 2 * m.x * m.y, c = b, d = 2 * m.y * m.y - 1;
    return [a, b, c, d, p.x - (a * p.x + b * p.y), p.y - (c * p.x + d * p.y)];
  }
  const applyM = (M, q) => v(M[0] * q.x + M[1] * q.y + M[4], M[2] * q.x + M[3] * q.y + M[5]);
  const composeM = (A, B) => [
    A[0] * B[0] + A[1] * B[2], A[0] * B[1] + A[1] * B[3],
    A[2] * B[0] + A[3] * B[2], A[2] * B[1] + A[3] * B[3],
    A[0] * B[4] + A[1] * B[5] + A[4], A[2] * B[4] + A[3] * B[5] + A[5],
  ];
  const invertM = (M) => { // an isometry: the inverse of the linear part is its transpose
    const a = M[0], b = M[2], c = M[1], d = M[3];
    return [a, b, c, d, -(a * M[4] + b * M[5]), -(c * M[4] + d * M[5])];
  };

  function foldFaces(mesh, ed) {
    const { R, C, P } = mesh;
    const maps = new Array(R * C).fill(null);
    const fid = (r, i) => r * C + i;
    const quad = (r, i) => [P[r][i], P[r][i + 1], P[r + 1][i + 1], P[r + 1][i]];
    const iMid = Math.floor(C / 2), rootR = Math.floor((ed.r0 + ed.r1) / 2);
    maps[fid(rootR, iMid)] = [1, 0, 0, 1, 0, 0];
    const queue = [[rootR, iMid]];
    let holonomy = 0;
    for (let qh = 0; qh < queue.length; qh++) {
      const [r, i] = queue[qh];
      const M = maps[fid(r, i)];
      const nb = [
        [r, i + 1, P[r][i + 1], P[r + 1][i + 1]],
        [r, i - 1, P[r][i], P[r + 1][i]],
        [r + 1, i, P[r + 1][i], P[r + 1][i + 1]],
        [r - 1, i, P[r][i], P[r][i + 1]],
      ];
      for (const [rr, ii, a, b] of nb) {
        if (rr < 0 || rr >= R || ii < 0 || ii >= C) continue;
        if (!onSheet(rr, ed)) continue;
        const Mg = composeM(M, reflectionAcross(a, norm(sub(b, a))));
        const g = fid(rr, ii);
        if (maps[g]) {
          holonomy = Math.max(holonomy, dist(applyM(maps[g], a), applyM(Mg, a)), dist(applyM(maps[g], b), applyM(Mg, b)));
        } else {
          maps[g] = Mg;
          queue.push([rr, ii]);
        }
      }
    }
    return { maps, holonomy, fid, quad };
  }

  // Every crease of the sheet, in sheet coordinates, with the face whose isometry carries it
  // (either face beside a crease gives the same answer). The edge rows are cut edges, not creases.
  function sheetLines(mesh, ed) {
    const { C, P, d } = mesh;
    const out = [];
    for (let r = ed.r0 + 1; r < ed.r1; r++) {
      for (let i = 0; i < C; i++) out.push({ a: P[r][i], b: P[r][i + 1], kind: 'row', type: rowType(d, r, i), face: [r, i] });
    }
    for (let r = ed.r0; r < ed.r1; r++) {
      for (let i = 1; i < C; i++) out.push({ a: P[r][i], b: P[r + 1][i], kind: 'col', type: colType(d, i), face: [r, i] });
    }
    return out;
  }

  // How many layers of paper lie over the thickest of n x n sample points of the folded shape.
  // A generator: it pauses after every few columns of samples (see steps).
  function* sampleLayers(mesh, fold, box, n) {
    const faces = [];
    for (let r = 0; r < mesh.R; r++) for (let i = 0; i < mesh.C; i++) {
      const M = fold.maps[fold.fid(r, i)];
      if (M) faces.push({ inv: invertM(M), q: fold.quad(r, i) });
    }
    let layers = 0;
    for (let a = 0; a < n; a++) {
      for (let b = 0; b < n; b++) {
        const p = v(box.x0 + ((a + 0.5) / n) * (box.x1 - box.x0), box.y0 + ((b + 0.5) / n) * (box.y1 - box.y0));
        let k = 0;
        for (const f of faces) {
          if (inConvexQuad(applyM(f.inv, p), f.q)) k++;
        }
        layers = Math.max(layers, k);
      }
      if (a % 6 === 5) yield 'layers';
    }
    return layers;
  }
  function inConvexQuad(p, q) {
    let sgn = 0;
    for (let k = 0; k < 4; k++) {
      const c = cross(sub(q[(k + 1) % 4], q[k]), sub(p, q[k]));
      if (c === 0) continue;
      if (sgn === 0) sgn = Math.sign(c);
      else if (Math.sign(c) !== sgn) return false;
    }
    return true;
  }

  // ------------------------------------------------------------------ merging coincident lines
  // In the folded state many layers share a line. Segments that lie on the same line (within tol)
  // and touch or overlap are drawn once. Each segment has a pen (0 black, 1 red); where black and
  // red coincide, black is drawn, and red only where no black covers it.
  function mergeCollinear(segs, tol) {
    const n = segs.length;
    if (!n) return [];
    let cx = 0, cy = 0;
    for (const s of segs) { cx += s.a.x + s.b.x; cy += s.a.y + s.b.y; }
    cx /= 2 * n; cy /= 2 * n;
    const info = segs.map((s) => {
      let dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
      const L = hyp(dx, dy);
      dx /= L; dy /= L;
      if (dy < 0 || (dy === 0 && dx < 0)) { dx = -dx; dy = -dy; }
      let th = datan2(dy, dx); // [0, pi]
      if (th >= Math.PI) th -= Math.PI;
      return { dx, dy, th, c: dx * (s.a.y - cy) - dy * (s.a.x - cx), L };
    });
    const ANG = 0.004;
    const nth = Math.ceil(Math.PI / ANG);
    const cellT = (th) => Math.min(nth - 1, Math.floor(th / ANG));
    const cellC = (c) => Math.floor(c / tol);
    const grid = new Map();
    for (let k = 0; k < n; k++) {
      const kk = cellT(info[k].th) * 1e6 + cellC(info[k].c);
      let list = grid.get(kk);
      if (!list) { list = []; grid.set(kk, list); }
      list.push(k);
    }
    const parent = new Int32Array(n);
    for (let k = 0; k < n; k++) parent[k] = k;
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const off = (p, s, inf) => Math.abs(inf.dx * (p.y - s.a.y) - inf.dy * (p.x - s.a.x));
    for (let k = 0; k < n; k++) {
      const ta = cellT(info[k].th);
      for (let dt = -1; dt <= 1; dt++) {
        let t2 = ta + dt, flip = false;
        if (t2 < 0) { t2 += nth; flip = true; }
        if (t2 >= nth) { t2 -= nth; flip = true; }
        const cc = cellC(flip ? -info[k].c : info[k].c);
        for (let dc = -1; dc <= 1; dc++) {
          const list = grid.get(t2 * 1e6 + cc + dc);
          if (!list) continue;
          for (const j of list) {
            if (j <= k) continue;
            const A = segs[k], B = segs[j], ia = info[k], ib = info[j];
            if (off(B.a, A, ia) > tol || off(B.b, A, ia) > tol || off(A.a, B, ib) > tol || off(A.b, B, ib) > tol) continue;
            const pa0 = ia.dx * A.a.x + ia.dy * A.a.y, pa1 = ia.dx * A.b.x + ia.dy * A.b.y;
            const pb0 = ia.dx * B.a.x + ia.dy * B.a.y, pb1 = ia.dx * B.b.x + ia.dy * B.b.y;
            if (Math.min(pb0, pb1) > Math.max(pa0, pa1) + 1e-6 || Math.max(pb0, pb1) < Math.min(pa0, pa1) - 1e-6) continue;
            const fa = find(k), fb = find(j);
            if (fa !== fb) parent[Math.max(fa, fb)] = Math.min(fa, fb);
          }
        }
      }
    }
    const groups = new Map();
    for (let k = 0; k < n; k++) {
      const f = find(k);
      let g = groups.get(f);
      if (!g) { g = []; groups.set(f, g); }
      g.push(k);
    }
    const union = (iv) => {
      iv.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
      const u = [];
      for (const q of iv) {
        if (u.length && q[0] <= u[u.length - 1][1] + 1e-6) u[u.length - 1][1] = Math.max(u[u.length - 1][1], q[1]);
        else u.push(q.slice());
      }
      return u;
    };
    const minus = (A, B) => { // the parts of A not covered by B (both sorted unions)
      const res = [];
      for (const a of A) {
        let pieces = [a.slice()];
        for (const b of B) {
          const next = [];
          for (const p of pieces) {
            if (b[1] <= p[0] || b[0] >= p[1]) { next.push(p); continue; }
            if (b[0] > p[0]) next.push([p[0], b[0]]);
            if (b[1] < p[1]) next.push([b[1], p[1]]);
          }
          pieces = next;
        }
        for (const p of pieces) if (p[1] - p[0] > 0.05) res.push(p);
      }
      return res;
    };
    const out = [];
    for (const [, g] of groups) {
      if (g.length === 1) { out.push(segs[g[0]]); continue; }
      let ref = g[0];
      for (const k of g) if (info[k].L > info[ref].L) ref = k;
      const R0 = segs[ref].a, ir = info[ref];
      const proj = (p) => ir.dx * (p.x - R0.x) + ir.dy * (p.y - R0.y);
      const ivs = [[], []];
      for (const k of g) {
        const a = proj(segs[k].a), b = proj(segs[k].b);
        ivs[segs[k].pen].push([Math.min(a, b), Math.max(a, b)]);
      }
      const blk = union(ivs[0]);
      const red = minus(union(ivs[1]), blk);
      const at = (s) => v(R0.x + ir.dx * s, R0.y + ir.dy * s);
      for (const q of blk) out.push({ a: at(q[0]), b: at(q[1]), pen: 0 });
      for (const q of red) out.push({ a: at(q[0]), b: at(q[1]), pen: 1 });
    }
    return out;
  }

  // ------------------------------------------------------------------ pen paths
  // Join segments into continuous strokes (walking straight on where possible), then order the
  // strokes nearest-first so the pen travels little in the air. Points are in page millimetres.
  const pkey = (p) => Math.round(p.x * 100) + ':' + Math.round(p.y * 100);
  function chainSegments(segs) {
    const adj = new Map();
    const used = new Uint8Array(segs.length);
    const keys = segs.map((s) => [pkey(s.a), pkey(s.b)]);
    const addAdj = (kk, k) => { let l = adj.get(kk); if (!l) { l = []; adj.set(kk, l); } l.push(k); };
    segs.forEach((s, k) => { addAdj(keys[k][0], k); addAdj(keys[k][1], k); });
    const strokes = [];
    const starts = [];
    for (const [kk, list] of adj) if (list.length % 2 === 1) starts.push(kk); // odd points first (Euler trails)
    for (const [kk] of adj) starts.push(kk);
    for (const sk of starts) {
      for (;;) {
        let k0 = -1;
        for (const k of adj.get(sk)) if (!used[k]) { k0 = k; break; }
        if (k0 < 0) break;
        const s0 = segs[k0];
        const pts = [keys[k0][0] === sk ? s0.a : s0.b];
        let cur = sk, k = k0;
        while (k >= 0) {
          used[k] = 1;
          const s = segs[k];
          const forward = keys[k][0] === cur;
          const nx = forward ? s.b : s.a;
          const from = pts[pts.length - 1];
          pts.push(nx);
          const dir = norm(sub(nx, from));
          cur = forward ? keys[k][1] : keys[k][0];
          let best = -1, bestDot = -Infinity;
          for (const j of adj.get(cur)) {
            if (used[j]) continue;
            const t = segs[j];
            const far = keys[j][0] === cur ? t.b : t.a;
            const dd = dot(dir, norm(sub(far, nx)));
            if (dd > bestDot) { bestDot = dd; best = j; }
          }
          k = best;
        }
        strokes.push(pts);
      }
    }
    return strokes;
  }

  function orderStrokes(strokes, start) {
    const n = strokes.length;
    const done = new Uint8Array(n);
    const out = [];
    let at = start;
    for (let m = 0; m < n; m++) {
      let best = -1, bestD = Infinity, rev = false;
      for (let k = 0; k < n; k++) {
        if (done[k]) continue;
        const s = strokes[k];
        const d0 = dist(at, s[0]), d1 = dist(at, s[s.length - 1]);
        if (d0 < bestD) { bestD = d0; best = k; rev = false; }
        if (d1 < bestD) { bestD = d1; best = k; rev = true; }
      }
      done[best] = 1;
      const s = rev ? strokes[best].slice().reverse() : strokes[best];
      out.push(s);
      at = s[s.length - 1];
    }
    return out;
  }

  // ------------------------------------------------------------------ layout and composition checks
  // Two panels of equal height, side by side, centred on the page.
  function layout(sheetBox, foldBox) {
    const as = sheetBox.w / sheetBox.h, af = foldBox.w / foldBox.h;
    const h = Math.min(PAGE.h - 2 * MARGIN, (PAGE.w - 2 * MARGIN - GUTTER) / (as + af));
    const sw = as * h, fw = af * h;
    const x0 = (PAGE.w - (sw + GUTTER + fw)) / 2, y0 = (PAGE.h - h) / 2;
    return {
      sheet: { x: x0, y: y0, w: sw, h, k: h / sheetBox.h },
      fold: { x: x0 + sw + GUTTER, y: y0, w: fw, h, k: h / foldBox.h },
    };
  }

  // The rotation (to half a degree) at which the folded drawing fits the smallest square.
  function bestRotation(points) {
    let best = null;
    for (let k = 0; k < 180; k++) {
      const a = k * 0.5 * DEG, [s, c] = sinCos(a);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of points) {
        const x = c * p.x - s * p.y, y = s * p.x + c * p.y;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
      const score = Math.max(x1 - x0, y1 - y0);
      if (!best || score < best.score - 1e-9) best = { a, score };
    }
    return best.a;
  }

  // How the folded drawing sits in its panel: is it round (isotropy of its ink), centred (ink
  // centroid against the box centre) and neither empty nor clogged (ink length per square mm)?
  function inkMetrics(segs, box) {
    let W = 0, mx = 0, my = 0;
    for (const s of segs) { const L = dist(s.a, s.b); W += L; mx += (L * (s.a.x + s.b.x)) / 2; my += (L * (s.a.y + s.b.y)) / 2; }
    mx /= W; my /= W;
    let sxx = 0, syy = 0, sxy = 0;
    for (const s of segs) {
      const L = dist(s.a, s.b);
      for (const t of [0.25, 0.75]) {
        const x = s.a.x + (s.b.x - s.a.x) * t - mx, y = s.a.y + (s.b.y - s.a.y) * t - my;
        sxx += L * x * x; syy += L * y * y; sxy += L * x * y;
      }
    }
    const tr = sxx + syy, det = sxx * syy - sxy * sxy;
    const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
    const isotropy = (tr / 2 - disc) / (tr / 2 + disc);
    // ink in 12 equal angular sectors around the ink's centroid: a rosette spreads it evenly
    const sec = new Array(12).fill(0);
    for (const s of segs) {
      const L = dist(s.a, s.b), n = Math.max(1, Math.ceil(L));
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const an = datan2(s.a.y + (s.b.y - s.a.y) * t - my, s.a.x + (s.b.x - s.a.x) * t - mx);
        sec[Math.min(11, Math.floor(((an + Math.PI) / TAU) * 12))] += L / n;
      }
    }
    const mean = W / 12;
    let varS = 0;
    for (const q of sec) varS += (q - mean) * (q - mean);
    const unevenness = Math.sqrt(varS / 12) / mean;
    const offset = dist(v(mx, my), v(box.x + box.w / 2, box.y + box.h / 2)) / Math.max(box.w, box.h);
    const density = W / (box.w * box.h);
    return { isotropy, unevenness, offset, density, ink: W };
  }

  // Total length (mm) along which two distinct, nearly parallel folded lines run closer than
  // 0.3 mm: there a 0.3 mm pen would draw what looks like one thick line, twice.
  function closeOverlap(segs) {
    const info = segs.map((s) => {
      let dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
      const L = hyp(dx, dy);
      dx /= L; dy /= L;
      if (dy < 0 || (dy === 0 && dx < 0)) { dx = -dx; dy = -dy; }
      return { s, dx, dy, th: datan2(dy, dx) };
    });
    info.sort((p, q) => p.th - q.th);
    const win = 0.4 * DEG;
    let total = 0;
    const n = info.length;
    for (let i = 0; i < n; i++) {
      // the window wraps around from just below pi to just above 0
      for (let jj = i + 1; jj < i + n; jj++) {
        const j = jj % n;
        const dth = jj < n ? info[j].th - info[i].th : info[j].th + Math.PI - info[i].th;
        if (dth > win) break;
        const A = info[i], B = info[j];
        const o = Math.abs(A.dx * (B.s.a.y - A.s.a.y) - A.dy * (B.s.a.x - A.s.a.x));
        if (o > 0.3) continue;
        const pa0 = A.dx * A.s.a.x + A.dy * A.s.a.y, pa1 = A.dx * A.s.b.x + A.dy * A.s.b.y;
        const pb0 = A.dx * B.s.a.x + A.dy * B.s.a.y, pb1 = A.dx * B.s.b.x + A.dy * B.s.b.y;
        const ov = Math.min(Math.max(pa0, pa1), Math.max(pb0, pb1)) - Math.max(Math.min(pa0, pa1), Math.min(pb0, pb1));
        if (ov > 1) total += ov;
      }
    }
    return total;
  }

  const CURATE = { isotropy: 0.9, unevenness: 0.16, offset: 0.04, densityMin: 0.16, densityMax: 1.35, closeOverlap: 150 };
  const curated = (ink) => ink.isotropy >= CURATE.isotropy && ink.unevenness <= CURATE.unevenness &&
    ink.offset <= CURATE.offset && ink.density >= CURATE.densityMin && ink.density <= CURATE.densityMax &&
    ink.closeOverlap <= CURATE.closeOverlap;

  // ------------------------------------------------------------------ one attempt at a design
  function attempt(rng) {
    const d = makeDesign(rng);
    const mesh = buildMesh(d);
    if (!mesh) return { fail: 'rows' };
    const ed = chooseEdges(mesh);
    if (!ed) return { fail: 'edges' };
    if (!quadsOk(mesh, ed)) return { fail: 'quads' };
    const report = verify(mesh, ed);
    report.twoStage = twoStageOk(mesh);
    if (!report.ok || !report.twoStage) return { fail: 'verify' };
    if (report.vertices < 120 || report.vertices > 1200) return { fail: 'size' };
    const fold = foldFaces(mesh, ed);
    if (!fold || fold.holonomy > 1e-7) return { fail: 'fold' };
    return { d, mesh, ed, report, fold };
  }

  // Lay out one attempt and draw both panels (still as segments, in page millimetres).
  function compose(a) {
    const { mesh, ed, fold } = a;
    const lines = sheetLines(mesh, ed);
    // the outline: along the top row, down column C, back along the bottom row, up column 0
    const outline = mesh.P[ed.r0].concat(mesh.P[ed.r1].slice().reverse(), [mesh.P[ed.r0][0]]);
    const folded = lines.map((s) => {
      const M = fold.maps[fold.fid(s.face[0], s.face[1])];
      return { a: applyM(M, s.a), b: applyM(M, s.b), pen: s.type === VALLEY ? 1 : 0 };
    });
    const fpts = [];
    for (const s of folded) fpts.push(s.a, s.b);
    const rot = bestRotation(fpts);
    const [rs, rc] = sinCos(rot);
    const rotP = (p) => v(rc * p.x - rs * p.y, rs * p.x + rc * p.y);
    let fx0 = Infinity, fy0 = Infinity, fx1 = -Infinity, fy1 = -Infinity;
    for (const p of fpts) {
      const q = rotP(p);
      fx0 = Math.min(fx0, q.x); fx1 = Math.max(fx1, q.x); fy0 = Math.min(fy0, q.y); fy1 = Math.max(fy1, q.y);
    }
    const L = layout({ w: mesh.d.W, h: ed.bottom - ed.top }, { w: fx1 - fx0, h: fy1 - fy0 });
    const toSheet = (p) => v(L.sheet.x + p.x * L.sheet.k, L.sheet.y + (p.y - ed.top) * L.sheet.k);
    const toFold = (p) => { const q = rotP(p); return v(L.fold.x + (q.x - fx0) * L.fold.k, L.fold.y + (q.y - fy0) * L.fold.k); };
    const sheetSegs = [];
    for (const s of lines) {
      const a2 = toSheet(s.a), b2 = toSheet(s.b);
      if (dist(a2, b2) > 0.02) sheetSegs.push({ a: a2, b: b2, pen: s.type === VALLEY ? 1 : 0 });
    }
    const foldRaw = folded.map((s) => ({ a: toFold(s.a), b: toFold(s.b), pen: s.pen })).filter((s) => dist(s.a, s.b) > 0.02);
    return { L, sheetSegs, outline: outline.map(toSheet), foldRaw, foldBox: { w: fx1 - fx0, h: fy1 - fy0 }, fpts };
  }

  // ------------------------------------------------------------------ generate (stepwise)
  // steps(seed) is a generator; each yield is a natural pause so a page can spread the work over
  // several frames. generate(seed) runs it to the end and returns the result.
  function* steps(seed) {
    seed = String(seed);
    const rng = makeRng(seed);
    let tries = 0, res = null;
    const fails = {};
    while (!res) {
      tries++;
      if (tries > 200) throw new Error('Lies Flat: no design passed after 200 attempts for seed ' + seed);
      const a = attempt(rng);
      if (a.fail) {
        fails[a.fail] = (fails[a.fail] || 0) + 1;
        if (tries % 3 === 0) yield 'design';
        continue;
      }
      yield 'folded';
      const c = compose(a);
      yield 'composed';
      const foldSegs = mergeCollinear(c.foldRaw, MERGE_TOL);
      yield 'merged';
      const ink = inkMetrics(foldSegs, c.L.fold);
      ink.closeOverlap = closeOverlap(foldSegs);
      if (!curated(ink)) {
        fails.composition = (fails.composition || 0) + 1;
        yield 'composition';
        continue;
      }
      res = { a, c, foldSegs, ink };
    }
    yield 'curated';
    const { d, mesh, ed, report, fold } = res.a;
    const { L, sheetSegs, outline, foldRaw, fpts } = res.c;
    const { foldSegs, ink } = res;

    // pens: each pen's strokes, joined and ordered; the outline is one closed black stroke
    const sheetByPen = [[], []], foldByPen = [[], []];
    for (const s of sheetSegs) sheetByPen[s.pen].push(s);
    for (const s of foldSegs) foldByPen[s.pen].push(s);
    const black = orderStrokes([outline].concat(chainSegments(sheetByPen[0]), chainSegments(foldByPen[0])), v(0, 0));
    yield 'paths';
    const red = orderStrokes(chainSegments(sheetByPen[1]).concat(chainSegments(foldByPen[1])), v(0, 0));
    yield 'paths';

    // layers of paper over the thickest sampled point of the folded shape
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const p of fpts) { bx0 = Math.min(bx0, p.x); bx1 = Math.max(bx1, p.x); by0 = Math.min(by0, p.y); by1 = Math.max(by1, p.y); }
    const layers = yield* sampleLayers(mesh, fold, { x0: bx0, y0: by0, x1: bx1, y1: by1 }, 24);

    // ---- SVG
    const f = (x) => {
      let s = x.toFixed(DIGITS);
      if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
      return s === '-0' ? '0' : s;
    };
    const pathD = (pts) => {
      let s = 'M' + f(pts[0].x) + ' ' + f(pts[0].y);
      for (let k = 1; k < pts.length; k++) s += 'L' + f(pts[k].x) + ' ' + f(pts[k].y);
      return s;
    };
    const penStats = (strokes) => {
      let draw = 0, travel = 0, at = v(0, 0);
      for (const s of strokes) {
        travel += dist(at, s[0]);
        for (let k = 1; k < s.length; k++) draw += dist(s[k - 1], s[k]);
        at = s[s.length - 1];
      }
      travel += dist(at, v(0, 0)); // and home again
      return { draw, travel, lifts: strokes.length };
    };
    const sb = penStats(black), sr = penStats(red);
    const seconds = (sb.draw + sr.draw) / PLOT.draw + (sb.travel + sr.travel) / PLOT.travel + (sb.lifts + sr.lifts) * PLOT.lift;
    const desc = `Lies Flat, seed ${seed}. A3 landscape, ${PAGE.w} x ${PAGE.h} mm. Two pens, both ${PEN_WIDTH} mm: ` +
      `black (${PENS[0].colour}) for the sheet's outline and its mountain folds, red (${PENS[1].colour}) for its valley folds. ` +
      `Left: the crease pattern; each of its ${report.vertices} interior vertices passes Kawasaki's and Maekawa's conditions. ` +
      `Right: the same creases after the sheet is folded flat, as if the paper were transparent (cut edges left out); where creases of both colours coincide, black is drawn.`;
    let svg = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE.w}mm" height="${PAGE.h}mm" viewBox="0 0 ${PAGE.w} ${PAGE.h}">\n` +
      `<title>Lies Flat ${escapeXml(seed)}</title>\n<desc>${escapeXml(desc)}</desc>\n`;
    const group = (pen, strokes) => {
      let s = `<g id="${pen.id}" fill="none" stroke="${pen.colour}" stroke-width="${PEN_WIDTH}" stroke-linecap="round" stroke-linejoin="round">\n`;
      for (const st of strokes) s += `<path d="${pathD(st)}"/>\n`;
      return s + '</g>\n';
    };
    svg += group(PENS[0], black) + group(PENS[1], red) + '</svg>\n';
    yield 'svg';

    const stats = {
      seed, tries, fails,
      page: { ...PAGE }, penWidth: PEN_WIDTH, pens: PENS.map((p) => ({ ...p })),
      panels: {
        sheet: { x: L.sheet.x, y: L.sheet.y, w: L.sheet.w, h: L.sheet.h },
        fold: { x: L.fold.x, y: L.fold.y, w: L.fold.w, h: L.fold.h },
      },
      register: d.register,
      columns: d.C, rows: mesh.R + 1,
      foldedScale: L.fold.k / L.sheet.k, // the right panel is drawn this many times larger than the left
      phi: { mode: d.phiMode, a: d.phiA, b: d.phiB, closing: d.closing ? `${d.closing.n}/${d.closing.k}` : null },
      gapGrad: d.gapGrad, widthGrad: d.widthGrad,
      vertices: report.vertices,
      kawasakiMaxDeg: report.kawasakiMax / DEG, mirrorMax: report.mirrorMax, minSectorDeg: report.minSector / DEG,
      maekawaFail: report.maekawaFail, oddFail: report.oddFail, twoStage: report.twoStage,
      holonomy: fold.holonomy, // in sheet units
      sheetScale: L.sheet.k, // page millimetres per sheet unit
      layers,
      foldedLines: { raw: foldRaw.length, drawn: foldSegs.length },
      ink: { isotropy: ink.isotropy, unevenness: ink.unevenness, offset: ink.offset, density: ink.density, closeOverlap: ink.closeOverlap },
      pen: { black: sb, red: sr },
      length: sb.draw + sr.draw, travel: sb.travel + sr.travel, lifts: sb.lifts + sr.lifts, seconds,
      plot: { ...PLOT },
      bytes: svg.length,
    };
    return { svg, stats, mesh, edges: ed, report, design: d };
  }

  function generate(seed) {
    const it = steps(seed);
    for (;;) {
      const r = it.next();
      if (r.done) return r.value;
    }
  }

  function escapeXml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
  }

  return {
    generate, steps, makeRng, cyrb128,
    PAGE, PEN_WIDTH, PENS, PLOT, MIN_SECTOR, MOUNTAIN, VALLEY,
    internals: { sinCos, datan2, makeDesign, buildMesh, chooseEdges, verify, twoStageOk, foldFaces, sheetLines, attempt, compose, colType, rowType, mergeCollinear, chainSegments, rowShape, inkMetrics, closeOverlap, CURATE },
  };
});
