// Kirkwood's Ruler: the pure part. Data, Kepler, the notch finder, the solid and its STL.
// No DOM, no clock, no randomness. Loaded by the page as a classic script (window.Belt)
// and by Node with require(). Units: au for orbits, mm for the object.
(function (root) {
  'use strict';

  var DATA = (typeof module === 'object' && module.exports) ? require('./belt-data.js') : root.BELT_DATA;

  // ---------------------------------------------------------------- Kepler and Jupiter
  // Gaussian gravitational constant k: GM_sun = k^2 in au^3/day^2.
  var GAUSS_K = 0.01720209895;
  // Jupiter's mean longitude advances 3034.74612775 degrees per Julian century and its mean
  // semi-major axis is 5.20288700 au (JPL "Approximate Positions of the Planets", Table 1, after
  // Standish & Williams 1992; valid 1800-2050).
  var JUPITER_LDOT = 3034.74612775;
  var JUPITER_A = 5.202887;
  var JUPITER_N = JUPITER_LDOT * Math.PI / 180 / 36525; // rad/day
  var JUPITER_YEARS = 36000 / JUPITER_LDOT; // sidereal period in Julian years

  // The orbit size (semi-major axis, au) at which a body around the Sun goes round p times while
  // Jupiter goes round q times: its mean motion is (p/q) n_J, and Kepler's third law gives a.
  function resonanceA(p, q) {
    var n = JUPITER_N * p / q;
    return Math.cbrt(GAUSS_K * GAUSS_K / (n * n));
  }
  // Orbital period in Julian years of a small body with semi-major axis a (au).
  function periodYears(a) {
    return 2 * Math.PI / GAUSS_K * Math.pow(a, 1.5) / 365.25;
  }

  // The resonances the ruler marks with a groove, in the order they win a tight spot.
  var MARKS = [
    { p: 3, q: 1, kind: 'gap' },
    { p: 2, q: 1, kind: 'gap' },
    { p: 5, q: 2, kind: 'gap' },
    { p: 3, q: 2, kind: 'group', group: 'Hildas' },
    { p: 1, q: 1, kind: 'group', group: 'Trojans' },
    { p: 7, q: 3, kind: 'gap' },
  ];
  MARKS.forEach(function (m) { m.a = resonanceA(m.p, m.q); m.label = m.p + ':' + m.q; });

  // The longer list the notch finder compares against: every p:q with q <= p <= 9, p and q
  // coprime, order p - q at most 4, inside the data range.
  var RESONANCES = (function () {
    var out = [];
    function gcd(x, y) { return y ? gcd(y, x % y) : x; }
    for (var p = 1; p <= 9; p++) {
      for (var q = 1; q <= p; q++) {
        if (gcd(p, q) !== 1 || p - q > 4) continue;
        var a = resonanceA(p, q);
        if (a > DATA.aMin && a < DATA.aMax) out.push({ p: p, q: q, a: a, label: p + ':' + q });
      }
    }
    out.sort(function (x, y) { return x.a - y.a; });
    return out;
  })();

  // ---------------------------------------------------------------- the data
  var POPS = {
    all: { label: 'Every known asteroid', short: 'all known asteroids',
      note: 'every asteroid in JPL’s Small-Body Database on ' + DATA.queried + ', well-determined orbit or not' },
    good: { label: 'Well-known orbits only', short: 'asteroids with the best-known orbits',
      note: 'orbit condition code 0 (the Minor Planet Center’s U parameter: the smallest uncertainty)' },
    big: { label: 'The larger ones (H < 15)', short: 'asteroids brighter than absolute magnitude 15',
      note: 'absolute magnitude H below 15: roughly 3 to 6 km across and up, depending on how dark they are' },
    first1000: { label: 'The first 1,000 numbered', short: 'the first 1,000 numbered asteroids',
      note: 'asteroids (1) to (1000), discovered between 1801 and 1927' },
    by1866: { label: 'The 91 found by the end of 1866', short: 'the 91 asteroids found by the end of 1866',
      note: 'asteroids (1) to (91), discovered 1801 to November 1866, at their present orbits' },
  };
  var POP_IDS = ['all', 'good', 'big', 'first1000', 'by1866'];

  var rCache = {};
  function population(id) {
    var p = DATA.populations[id];
    if (!p) throw new Error('unknown population: ' + id);
    if (!rCache[id]) rCache[id] = p.rTenths.map(function (t) { return t / 10; });
    return { id: id, counts: p.counts, rcounts: rCache[id], total: p.total, below: p.below, above: p.above,
      unbound: p.unbound, rBelow: p.rBelow, rAbove: p.rAbove,
      label: POPS[id].label, short: POPS[id].short, note: POPS[id].note };
  }
  // What a bar counts: 'a', asteroids by orbit size; 'r', asteroids by distance from the Sun,
  // averaged over each orbit (fractional).
  var COUNTS = ['a', 'r'];
  function fineCounts(pop, count) { return count === 'r' ? pop.rcounts : pop.counts; }

  function fineIndex(a) { return Math.round((a - DATA.aMin) * DATA.perAu); }
  function fineA(i) { return DATA.aMin + i / DATA.perAu; }

  // Sum of fine counts over fine bins [i0, i1).
  function sumFine(counts, i0, i1) {
    var s = 0;
    for (var i = Math.max(0, i0); i < Math.min(counts.length, i1); i++) s += counts[i];
    return s;
  }

  // Bins of `step` fine bins each, from fine index i0, nb of them.
  function rebin(counts, i0, step, nb) {
    var out = new Array(nb);
    for (var b = 0; b < nb; b++) out[b] = sumFine(counts, i0 + b * step, i0 + (b + 1) * step);
    return out;
  }

  // ---------------------------------------------------------------- parameters
  var LIM = {
    aMin: DATA.aMin, aMax: DATA.aMax, minSpan: 0.1,
    length: [50, 170], relief: [4, 40], depth: [8, 30], maxStepFine: 40,
  };
  var MIN_BIN_MM = 1.0; // narrowest bar, and narrowest notch, the ruler will make
  var MARGIN = 3; // plain base at each end, mm
  var DEFAULTS = { pop: 'all', count: 'a', a0: 1.8, a1: 3.4, bin: 0.01, length: 160, relief: 22, depth: 14, scale: 'linear', ledge: true };
  var SCALES = ['linear', 'sqrt', 'log'];

  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }
  function num(x, d) { var v = Number(x); return Number.isFinite(v) ? v : d; }

  // Turns any input into parameters the solid can be built from, and says what it changed.
  function normalize(input) {
    input = input || {};
    var notes = [];
    var pop = POP_IDS.indexOf(input.pop) >= 0 ? input.pop : DEFAULTS.pop;
    var scale = SCALES.indexOf(input.scale) >= 0 ? input.scale : DEFAULTS.scale;
    var count = COUNTS.indexOf(input.count) >= 0 ? input.count : DEFAULTS.count;
    var ledge = input.ledge === undefined ? DEFAULTS.ledge : !!input.ledge && input.ledge !== 'false' && input.ledge !== '0';
    var length = Math.round(clamp(num(input.length, DEFAULTS.length), LIM.length[0], LIM.length[1]));
    var relief = Math.round(10 * clamp(num(input.relief, DEFAULTS.relief), LIM.relief[0], LIM.relief[1])) / 10;
    var depth = Math.round(clamp(num(input.depth, DEFAULTS.depth), LIM.depth[0], LIM.depth[1]));
    var spanFine = Math.round(LIM.minSpan * DATA.perAu);
    var maxFine = fineIndex(LIM.aMax);
    var i0 = clamp(fineIndex(num(input.a0, DEFAULTS.a0)), 0, maxFine - spanFine);
    var i1 = clamp(fineIndex(num(input.a1, DEFAULTS.a1)), 0, maxFine);
    if (i1 - i0 < spanFine) {
      i1 = Math.min(maxFine, i0 + spanFine);
      i0 = i1 - spanFine;
      notes.push('The range is at least ' + LIM.minSpan + ' au wide.');
    }
    var span = i1 - i0;
    // Narrowest bin that is still MIN_BIN_MM wide on the object.
    var minStep = Math.max(1, Math.ceil(MIN_BIN_MM * span / length - 1e-9));
    var step = Math.round(num(input.bin, DEFAULTS.bin) * DATA.perAu);
    var maxStep = Math.min(LIM.maxStepFine, Math.floor(span / 4));
    if (step < minStep) {
      step = minStep;
      notes.push('Bins are at least ' + MIN_BIN_MM.toFixed(1) + ' mm wide on the object, so the narrowest here is ' + (minStep / DATA.perAu).toFixed(4).replace(/0+$/, '') + ' au.');
    }
    step = clamp(step, 1, Math.max(minStep, maxStep));
    var nb = Math.floor(span / step);
    if (nb * step !== span) notes.push('The range ends at ' + fineA(i0 + nb * step).toFixed(4).replace(/0+$/, '').replace(/\.$/, '') + ' au so that it holds a whole number of bins.');
    i1 = i0 + nb * step;
    return {
      pop: pop, count: count, scale: scale, ledge: ledge, length: length, relief: relief, depth: depth,
      i0: i0, step: step, nb: nb,
      a0: fineA(i0), a1: fineA(i1), bin: step / DATA.perAu,
      minBin: minStep / DATA.perAu, notes: notes,
    };
  }

  // ---------------------------------------------------------------- layout of the solid
  var CH_Z = 0.5;   // bottom chamfer: rises 0.5 mm ...
  var CH_XY = 0.4;  // ... while coming in 0.4 mm (38.7 degrees from vertical)
  var ROW_DEPTH = 4; // each ledge terrace, front to back
  var H = {
    tickBase: 1.6, tickMinor: 2.2, tickHalf: 2.6, tickWhole: 3.0,
    markBase: 3.8, groove: 3.0,
    bodyBase: 4.6,
  };
  var TICK_W = 1.0, GROOVE_W = 1.2, TICK_MIN_GAP = 3.0, GROOVE_MIN_SPACING = 2.4;

  function q2(x) { return Math.round(x * 100) / 100; } // everything is on a 0.01 mm grid

  function heightFraction(c, cmax, scale) {
    if (cmax <= 0 || c <= 0) return 0;
    if (scale === 'sqrt') return Math.sqrt(c / cmax);
    if (scale === 'log') return Math.log(1 + c) / Math.log(1 + cmax);
    return c / cmax;
  }

  // Segments [x0, x1) at height h covering [0, total], from a base height and non-overlapping features.
  function rowSegments(total, base, feats) {
    feats = feats.slice().sort(function (a, b) { return a.x0 - b.x0; });
    var segs = [];
    var x = 0;
    feats.forEach(function (f) {
      if (f.x0 > x) segs.push({ x0: x, x1: f.x0, h: base });
      segs.push({ x0: f.x0, x1: f.x1, h: f.h });
      x = f.x1;
    });
    if (x < total) segs.push({ x0: x, x1: total, h: base });
    return mergeSegs(segs);
  }
  function mergeSegs(segs) {
    var out = [];
    segs.forEach(function (s) {
      s = { x0: q2(s.x0), x1: q2(s.x1), h: q2(s.h) };
      if (s.x1 <= s.x0) return;
      var last = out[out.length - 1];
      if (last && last.h === s.h && last.x1 === s.x0) last.x1 = s.x1;
      else out.push(s);
    });
    return out;
  }

  function layout(input) {
    var P = normalize(input);
    var pop = population(P.pop);
    var counts = rebin(fineCounts(pop, P.count), P.i0, P.step, P.nb);
    var cmax = Math.max.apply(null, counts);
    var csum = counts.reduce(function (s, c) { return s + c; }, 0);
    var total = q2(P.length + 2 * MARGIN);
    var mmPerAu = P.length / (P.a1 - P.a0);
    var xOf = function (a) { return MARGIN + (a - P.a0) * mmPerAu; };
    var binMm = P.length / P.nb;

    // The body: one bar per bin.
    var body = [{ x0: 0, x1: MARGIN, h: H.bodyBase }];
    var bars = counts.map(function (c, b) {
      var h = q2(H.bodyBase + P.relief * heightFraction(c, cmax, P.scale));
      return { x0: q2(MARGIN + b * binMm), x1: q2(MARGIN + (b + 1) * binMm), h: h, count: c,
        a0: fineA(P.i0 + b * P.step), a1: fineA(P.i0 + (b + 1) * P.step) };
    });
    bars.forEach(function (b) { body.push({ x0: b.x0, x1: b.x1, h: b.h }); });
    body.push({ x0: q2(MARGIN + P.length), x1: total, h: H.bodyBase });
    body = mergeSegs(body);

    var ticks = [], marks = [], skipped = [];
    var rows;
    if (P.ledge) {
      // Ticks every 0.1 au, taller at 0.5 au and taller again at whole au; finer levels are left out
      // when they would crowd (closer than 3 mm).
      var tenth = 0.1 * mmPerAu;
      var levels = { minor: tenth >= TICK_MIN_GAP, half: 5 * tenth >= TICK_MIN_GAP };
      var k0 = Math.ceil(P.a0 * 10 - 1e-9), k1 = Math.floor(P.a1 * 10 + 1e-9);
      for (var k = k0; k <= k1; k++) {
        var lev = k % 10 === 0 ? 'whole' : (k % 5 === 0 ? 'half' : 'minor');
        if (lev !== 'whole' && !levels[lev]) continue;
        var x = xOf(k / 10);
        ticks.push({ a: k / 10, level: lev, x0: q2(x - TICK_W / 2), x1: q2(x + TICK_W / 2),
          h: lev === 'whole' ? H.tickWhole : (lev === 'half' ? H.tickHalf : H.tickMinor) });
      }
      MARKS.forEach(function (m) {
        if (m.a < P.a0 || m.a > P.a1) return;
        var x = xOf(m.a);
        var clash = marks.filter(function (o) { return Math.abs(o.x - x) < GROOVE_MIN_SPACING + GROOVE_W - 1e-9; })[0];
        if (clash) { skipped.push({ label: m.label, a: m.a, because: clash.label }); return; }
        marks.push({ label: m.label, a: m.a, x: x, kind: m.kind, x0: q2(x - GROOVE_W / 2), x1: q2(x + GROOVE_W / 2), h: H.groove });
      });
      marks.sort(function (a, b) { return a.x - b.x; });
      rows = [
        { y0: 0, y1: ROW_DEPTH, segs: rowSegments(total, H.tickBase, ticks) },
        { y0: ROW_DEPTH, y1: 2 * ROW_DEPTH, segs: rowSegments(total, H.markBase, marks) },
        { y0: 2 * ROW_DEPTH, y1: 2 * ROW_DEPTH + P.depth, segs: body },
      ];
    } else {
      rows = [{ y0: 0, y1: P.depth, segs: body }];
    }
    var top = Math.max.apply(null, body.map(function (s) { return s.h; }));
    // Free-standing fins: bars under 2 mm wide standing 8 mm or more above both neighbours.
    var fins = bars.filter(function (b, i) {
      var left = i ? bars[i - 1].h : H.bodyBase, right = i < bars.length - 1 ? bars[i + 1].h : H.bodyBase;
      return b.x1 - b.x0 < 2 && b.h - Math.max(left, right) >= 8;
    }).length;
    return {
      params: P, population: pop, counts: counts, cmax: cmax, csum: csum, bars: bars,
      ticks: ticks, marks: marks, skipped: skipped, rows: rows, fins: fins,
      size: [total, rows[rows.length - 1].y1, top], mmPerAu: mmPerAu, binMm: binMm,
      // In linear mode the relief is proportional to the count: this many asteroids per mm^3.
      perMm3: P.scale === 'linear' && cmax > 0 ? cmax / (binMm * P.depth * P.relief) : null,
    };
  }

  // ---------------------------------------------------------------- the mesher
  // A solid made of terraces (rows, front to back), each a run of flat-topped segments, on a
  // chamfered footprint. Every face is planar; the result is closed and consistently wound as long
  // as each row is at least as tall as the row in front of it at every x (checked).
  function buildMesh(rows) {
    var total = rows[0].segs[rows[0].segs.length - 1].x1;
    var m = rows.length;
    var Y = rows.map(function (r) { return r.y0; }).concat([rows[m - 1].y1]);
    for (var r = 1; r < m; r++) {
      rows[r].segs.forEach(function (s) {
        [s.x0, (s.x0 + s.x1) / 2, s.x1 - 1e-6].forEach(function (x) {
          if (hAt(r - 1, x) > s.h) throw new Error('row ' + r + ' is lower than the row in front of it at x=' + x);
        });
      });
    }
    rows.forEach(function (row) {
      if (row.segs[0].x0 !== 0 || row.segs[row.segs.length - 1].x1 !== total) throw new Error('rows must span the whole length');
      row.segs.forEach(function (s, i) {
        if (i && row.segs[i - 1].x1 !== s.x0) throw new Error('segments must be contiguous');
        if (!(s.h > CH_Z)) throw new Error('every segment must rise above the chamfer');
      });
    });

    function segIndex(r, x) { // segment of row r containing x (x strictly inside or at its left end)
      var segs = rows[r].segs, lo = 0, hi = segs.length - 1;
      while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (segs[mid].x0 <= x) lo = mid; else hi = mid - 1; }
      return lo;
    }
    function hAt(r, x) { return rows[r].segs[segIndex(r, x)].h; }
    function breaks(r) { var b = rows[r].segs.map(function (s) { return s.x0; }); b.push(total); return b; }
    // Node x positions on each line j (between rows j-1 and j).
    var lineX = [];
    for (var j = 0; j <= m; j++) {
      var set = {};
      if (j > 0) breaks(j - 1).forEach(function (x) { set[x] = 1; });
      if (j < m) breaks(j).forEach(function (x) { set[x] = 1; });
      lineX.push(Object.keys(set).map(Number).sort(function (a, b) { return a - b; }));
    }
    // Heights present on the vertical line at node (j, x).
    function nodeHeights(j, x) {
      var hs = {};
      [j - 1, j].forEach(function (r) {
        if (r < 0 || r >= m) return;
        if (x > 0) hs[rows[r].segs[segIndex(r, x - 1e-6)].h] = 1;
        if (x < total) hs[rows[r].segs[segIndex(r, x)].h] = 1;
      });
      if (j === 0 || j === m || x === 0 || x === total) hs[CH_Z] = 1;
      return Object.keys(hs).map(Number).sort(function (a, b) { return a - b; });
    }

    var verts = [], vindex = new Map(), tris = [];
    function v(x, y, z) {
      var key = x + ',' + y + ',' + z;
      var i = vindex.get(key);
      if (i === undefined) { i = verts.length; verts.push([x, y, z]); vindex.set(key, i); }
      return i;
    }
    function tri(a, b, c, nx, ny, nz) {
      if (a === b || b === c || a === c) throw new Error('degenerate triangle');
      var A = verts[a], B = verts[b], C = verts[c];
      var ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2];
      var wx = C[0] - A[0], wy = C[1] - A[1], wz = C[2] - A[2];
      var cx = uy * wz - uz * wy, cy = uz * wx - ux * wz, cz = ux * wy - uy * wx;
      var d = cx * nx + cy * ny + cz * nz;
      if (Math.abs(d) < 1e-12) throw new Error('triangle lies edge-on to its face');
      tris.push(d > 0 ? [a, b, c] : [a, c, b]);
    }
    // Zip two chains of vertex indices into triangles; pos(i) orders each chain.
    function zip(A, B, pos, n) {
      var i = 0, k = 0;
      while (i < A.length - 1 || k < B.length - 1) {
        if (i < A.length - 1 && (k === B.length - 1 || pos(A[i + 1]) <= pos(B[k + 1]))) {
          tri(A[i], B[k], A[i + 1], n[0], n[1], n[2]); i++;
        } else {
          tri(A[i], B[k], B[k + 1], n[0], n[1], n[2]); k++;
        }
      }
    }
    var px = function (i) { return verts[i][0]; };
    var pz = function (i) { return verts[i][2]; };
    function within(list, lo, hi) { return list.filter(function (h) { return h >= lo && h <= hi; }); }

    // Tops.
    rows.forEach(function (row, rr) {
      row.segs.forEach(function (s) {
        var A = lineX[rr].filter(function (x) { return x >= s.x0 && x <= s.x1; }).map(function (x) { return v(x, Y[rr], s.h); });
        var B = lineX[rr + 1].filter(function (x) { return x >= s.x0 && x <= s.x1; }).map(function (x) { return v(x, Y[rr + 1], s.h); });
        zip(A, B, px, [0, 0, 1]);
      });
    });
    // A vertical wall on line j (constant y) between x = xa and xb spanning [lo, hi].
    function wallY(j, xa, xb, lo, hi, ny) {
      var A = within(nodeHeights(j, xa), lo, hi).map(function (z) { return v(xa, Y[j], z); });
      var B = within(nodeHeights(j, xb), lo, hi).map(function (z) { return v(xb, Y[j], z); });
      zip(A, B, pz, [0, ny, 0]);
    }
    // A vertical wall at constant x across row r, spanning [lo, hi].
    function wallX(r, x, lo, hi, nx) {
      var A = within(nodeHeights(r, x), lo, hi).map(function (z) { return v(x, Y[r], z); });
      var B = within(nodeHeights(r + 1, x), lo, hi).map(function (z) { return v(x, Y[r + 1], z); });
      zip(A, B, pz, [nx, 0, 0]);
    }
    for (j = 0; j <= m; j++) {
      var xs = lineX[j];
      for (var t = 0; t < xs.length - 1; t++) {
        var xa = xs[t], xb = xs[t + 1], mid = (xa + xb) / 2;
        if (j === 0) wallY(0, xa, xb, CH_Z, hAt(0, mid), -1);
        else if (j === m) wallY(m, xa, xb, CH_Z, hAt(m - 1, mid), 1);
        else {
          var hf = hAt(j - 1, mid), hb = hAt(j, mid);
          if (hf !== hb) wallY(j, xa, xb, Math.min(hf, hb), Math.max(hf, hb), hf > hb ? 1 : -1);
        }
      }
    }
    rows.forEach(function (row, rr) {
      wallX(rr, 0, CH_Z, row.segs[0].h, -1);
      wallX(rr, total, CH_Z, row.segs[row.segs.length - 1].h, 1);
      for (var s = 1; s < row.segs.length; s++) {
        var h0 = row.segs[s - 1].h, h1 = row.segs[s].h;
        wallX(rr, row.segs[s].x0, Math.min(h0, h1), Math.max(h0, h1), h0 > h1 ? 1 : -1);
      }
    });
    // Chamfer band and bottom: walk the outline anticlockwise seen from above.
    var loop = [];
    lineX[0].forEach(function (x) { loop.push([x, Y[0]]); });
    for (j = 1; j <= m; j++) loop.push([total, Y[j]]);
    lineX[m].slice().reverse().forEach(function (x) { if (x !== total) loop.push([x, Y[m]]); });
    for (j = m - 1; j >= 1; j--) loop.push([0, Y[j]]);
    var ymax = Y[m];
    function inset(p) {
      var x = p[0], y = p[1];
      return [q2(x === 0 ? CH_XY : (x === total ? total - CH_XY : x)), q2(y === 0 ? CH_XY : (y === ymax ? ymax - CH_XY : y))];
    }
    var bottom = [];
    loop.forEach(function (p, i) {
      var nx = loop[(i + 1) % loop.length];
      var a = v(p[0], p[1], CH_Z), b = v(nx[0], nx[1], CH_Z);
      var pi = inset(p), ni = inset(nx);
      var c = v(ni[0], ni[1], 0), d = v(pi[0], pi[1], 0);
      // outward horizontal direction of this side
      var ox = 0, oy = 0;
      if (p[1] === 0 && nx[1] === 0) oy = -1; else if (p[1] === ymax && nx[1] === ymax) oy = 1;
      else if (p[0] === total && nx[0] === total) ox = 1; else ox = -1;
      tri(a, b, c, ox, oy, -1);
      tri(a, c, d, ox, oy, -1);
      bottom.push(d);
    });
    var cx = 0, cy = 0;
    bottom.forEach(function (i) { cx += verts[i][0]; cy += verts[i][1]; });
    var centre = v(q2(cx / bottom.length), q2(cy / bottom.length), 0);
    bottom.forEach(function (i, k) { tri(centre, i, bottom[(k + 1) % bottom.length], 0, 0, -1); });
    return { vertices: verts, triangles: tris };
  }

  // ---------------------------------------------------------------- mesh facts
  function meshFacts(mesh) {
    var V = mesh.vertices, T = mesh.triangles;
    var directed = new Map();
    var bad = 0;
    T.forEach(function (t) {
      for (var e = 0; e < 3; e++) {
        var a = t[e], b = t[(e + 1) % 3];
        var key = a + '>' + b;
        directed.set(key, (directed.get(key) || 0) + 1);
      }
    });
    var undirected = 0;
    directed.forEach(function (n, key) {
      var ab = key.split('>');
      var back = directed.get(ab[1] + '>' + ab[0]) || 0;
      if (n !== 1 || back !== 1) bad++;
      if (Number(ab[0]) < Number(ab[1])) undirected++;
    });
    var vol = 0, area = 0, minArea = Infinity;
    var lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    V.forEach(function (p) { for (var i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]); } });
    T.forEach(function (t) {
      var A = V[t[0]], B = V[t[1]], C = V[t[2]];
      vol += (A[0] * (B[1] * C[2] - B[2] * C[1]) - A[1] * (B[0] * C[2] - B[2] * C[0]) + A[2] * (B[0] * C[1] - B[1] * C[0])) / 6;
      var ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], wx = C[0] - A[0], wy = C[1] - A[1], wz = C[2] - A[2];
      var a2 = Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) / 2;
      area += a2; minArea = Math.min(minArea, a2);
    });
    return {
      triangles: T.length, vertices: V.length, edges: undirected,
      closedAndOriented: bad === 0, badEdges: bad,
      euler: V.length - undirected + T.length,
      volume: vol, area: area, minTriangleArea: minArea,
      min: lo, max: hi,
    };
  }

  // Volume the solid should have, from the layout alone: columns above the chamfer plus the
  // chamfered frustum below it (prismatoid rule).
  function expectedVolume(L) {
    var v = 0;
    L.rows.forEach(function (row) {
      row.segs.forEach(function (s) { v += (s.x1 - s.x0) * (row.y1 - row.y0) * (s.h - CH_Z); });
    });
    var X = L.size[0], Yd = L.size[1];
    var top = X * Yd, bot = (X - 2 * CH_XY) * (Yd - 2 * CH_XY), mid = (X - CH_XY) * (Yd - CH_XY);
    return v + CH_Z / 6 * (top + bot + 4 * mid);
  }

  // ---------------------------------------------------------------- STL
  function stl(mesh, header) {
    var T = mesh.triangles, V = mesh.vertices;
    var buf = new ArrayBuffer(84 + 50 * T.length);
    var dv = new DataView(buf);
    var h = (header || 'Kirkwood\'s Ruler, binary STL, millimetres').slice(0, 80);
    for (var i = 0; i < 80; i++) dv.setUint8(i, i < h.length ? h.charCodeAt(i) & 0x7f : 32);
    dv.setUint32(80, T.length, true);
    var o = 84;
    T.forEach(function (t) {
      var A = V[t[0]], B = V[t[1]], C = V[t[2]];
      var ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], wx = C[0] - A[0], wy = C[1] - A[1], wz = C[2] - A[2];
      var nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      var len = Math.hypot(nx, ny, nz) || 1;
      [nx / len, ny / len, nz / len].forEach(function (c) { dv.setFloat32(o, c, true); o += 4; });
      [A, B, C].forEach(function (p) { for (var k = 0; k < 3; k++) { dv.setFloat32(o, p[k], true); o += 4; } });
      dv.setUint16(o, 0, true); o += 2;
    });
    return new Uint8Array(buf);
  }

  // Reads a binary STL back into triangles of float32 coordinates (for tests and checks).
  function readStl(bytes) {
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var n = dv.getUint32(80, true);
    var out = [];
    for (var t = 0; t < n; t++) {
      var o = 84 + 50 * t + 12, tr = [];
      for (var k = 0; k < 3; k++) tr.push([dv.getFloat32(o + 12 * k, true), dv.getFloat32(o + 12 * k + 4, true), dv.getFloat32(o + 12 * k + 8, true)]);
      out.push(tr);
    }
    return out;
  }

  function model(input) {
    var L = layout(input);
    var mesh = buildMesh(L.rows);
    return { layout: L, mesh: mesh };
  }

  function fileName(P) {
    return 'kirkwood-ruler_' + P.pop + (P.count === 'r' ? '_by-distance' : '') + '_' + P.a0.toFixed(2) + '-' + P.a1.toFixed(2) + 'au_' + P.scale + '.stl';
  }

  // ---------------------------------------------------------------- reading the data
  // How empty (or full) the belt is at a: the asteroids in the 0.005 au slice centred on a, divided
  // by what the neighbouring belt (0.01 to 0.05 au away on both sides) puts in a slice that wide.
  function emptiness(counts, a) {
    var e = fineIndex(a);
    var n = sumFine(counts, e - 1, e + 1);
    var s = sumFine(counts, e - 20, e - 4) + sumFine(counts, e + 4, e + 20);
    var expected = s / 32 * 2;
    return { a: a, count: n, expected: expected, ratio: expected > 0 ? n / expected : null };
  }

  // A notch finder that is not told where any resonance is. It slices [a0, a1] into 0.005 au bins
  // (fine-bin aligned). For each bin no fuller than its two neighbours it takes the mean count B of
  // the 16 bins 0.015 to 0.05 au away (centre to centre, eight each side; this background may reach
  // past the range) and scores the bin by how many Poisson standard deviations it falls below it,
  // (B - c) / sqrt(B). The highest score wins; nothing within 0.05 au of a winner can win too.
  function findNotches(counts, a0, a1, top, stepFine, score) {
    top = top || 4;
    var key = score === 'depth' ? 'depth' : 'sigma'; // 'depth' is the first version's ranking, kept for the record
    var step = stepFine || 2; // fine bins per slice: 2 = 0.005 au (the page always uses 2)
    var i0 = fineIndex(a0), i1 = fineIndex(a1);
    var near = Math.round(0.015 * DATA.perAu / step), reach = Math.round(0.05 * DATA.perAu / step);
    var nb = Math.floor((i1 - i0) / step);
    var binCount = function (b) { return sumFine(counts, i0 + b * step, i0 + (b + 1) * step); };
    var inData = function (b) { return i0 + b * step >= 0 && i0 + (b + 1) * step <= counts.length; };
    var cand = [];
    for (var b = 0; b < nb; b++) {
      var c = binCount(b);
      if ((inData(b - 1) && binCount(b - 1) < c) || (inData(b + 1) && binCount(b + 1) < c)) continue;
      var s = 0, n = 0;
      for (var d = near; d <= reach; d++) {
        if (inData(b - d)) { s += binCount(b - d); n++; }
        if (inData(b + d)) { s += binCount(b + d); n++; }
      }
      var B = n ? s / n : 0;
      if (B <= 0) continue;
      cand.push({ b: b, a: fineA(i0 + b * step + step / 2), count: c, background: B, depth: 1 - c / B, sigma: (B - c) / Math.sqrt(B) });
    }
    cand.sort(function (x, y) { return y[key] - x[key] || x.b - y.b; });
    var pick = [];
    for (var k = 0; k < cand.length && pick.length < top; k++) {
      var cnd = cand[k];
      if (cnd[key] <= 0) break;
      if (pick.every(function (p) { return Math.abs(p.b - cnd.b) > reach; })) pick.push(cnd);
    }
    pick.forEach(function (p) {
      var best = null;
      RESONANCES.forEach(function (r) { if (!best || Math.abs(r.a - p.a) < Math.abs(best.a - p.a)) best = r; });
      p.nearest = best;
      p.offset = p.a - best.a;
    });
    return pick;
  }

  var api = {
    DATA: DATA, POP_IDS: POP_IDS, POPS: POPS, MARKS: MARKS, RESONANCES: RESONANCES, DEFAULTS: DEFAULTS,
    LIM: LIM, MIN_BIN_MM: MIN_BIN_MM, MARGIN: MARGIN, H: H, CH_Z: CH_Z, CH_XY: CH_XY, ROW_DEPTH: ROW_DEPTH,
    SCALES: SCALES, COUNTS: COUNTS, fineCounts: fineCounts, JUPITER_A: JUPITER_A, JUPITER_LDOT: JUPITER_LDOT, JUPITER_YEARS: JUPITER_YEARS, GAUSS_K: GAUSS_K,
    TICK_W: TICK_W, GROOVE_W: GROOVE_W, TICK_MIN_GAP: TICK_MIN_GAP, GROOVE_MIN_SPACING: GROOVE_MIN_SPACING,
    resonanceA: resonanceA, periodYears: periodYears, population: population, rebin: rebin, sumFine: sumFine,
    fineIndex: fineIndex, fineA: fineA, normalize: normalize, heightFraction: heightFraction,
    layout: layout, buildMesh: buildMesh, meshFacts: meshFacts, expectedVolume: expectedVolume,
    stl: stl, readStl: readStl, model: model, fileName: fileName, emptiness: emptiness, findNotches: findNotches,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Belt = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
