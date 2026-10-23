// Tests for By Eye. Run from the repo root:  node --test ideas/59-by-eye/by-eye.test.mjs
//
// The geometry here (path parsing, flattening, winding numbers, scan lines) is written again from
// scratch rather than imported, so the module's claims are checked by code that is not the module.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const L = require('./letters.js');
const FACES = require('./typefaces.js');
const CAP = 700;
const S = 100;

// ---------- independent geometry ----------

// Parse an M/L/C/Z path string into closed polylines (cubics flattened into `steps` pieces).
function parse(d, steps = 64) {
  const tokens = d.match(/[MLCZ]|-?\d+(?:\.\d+)?(?:e-?\d+)?/g);
  const polys = [];
  let cur = null;
  let pt = null;
  let i = 0;
  const num = () => {
    const v = Number(tokens[i++]);
    assert.ok(Number.isFinite(v), `bad number in path: ${tokens[i - 1]}`);
    return v;
  };
  while (i < tokens.length) {
    const c = tokens[i++];
    if (c === 'M') {
      assert.equal(cur, null, 'every subpath must be closed with Z before the next M');
      pt = [num(), num()];
      cur = [pt];
    } else if (c === 'L') {
      pt = [num(), num()];
      cur.push(pt);
    } else if (c === 'C') {
      const p1 = [num(), num()];
      const p2 = [num(), num()];
      const p3 = [num(), num()];
      for (let k = 1; k <= steps; k++) {
        const t = k / steps;
        const u = 1 - t;
        cur.push([
          u * u * u * pt[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
          u * u * u * pt[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
        ]);
      }
      pt = p3;
    } else if (c === 'Z') {
      polys.push(cur);
      cur = null;
    } else assert.fail(`unexpected path command ${c}`);
  }
  assert.equal(cur, null, 'path ends without Z');
  return polys;
}
const polysOf = (ch, p = L.RULER) => parse(L.glyph(ch, p).d);
function area(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}
function box(polys) {
  const xs = polys.flat().map((p) => p[0]);
  const ys = polys.flat().map((p) => p[1]);
  return { xMin: Math.min(...xs), xMax: Math.max(...xs), yMin: Math.min(...ys), yMax: Math.max(...ys) };
}
// Winding number of the point (x, y): nonzero means ink.
function winding(polys, x, y) {
  let w = 0;
  for (const p of polys) {
    for (let i = 0; i < p.length; i++) {
      const [x0, y0] = p[i];
      const [x1, y1] = p[(i + 1) % p.length];
      if (y0 <= y && y1 > y && (x1 - x0) * (y - y0) - (x - x0) * (y1 - y0) > 0) w++;
      else if (y0 > y && y1 <= y && (x1 - x0) * (y - y0) - (x - x0) * (y1 - y0) < 0) w--;
    }
  }
  return w;
}
const inked = (polys, x, y) => winding(polys, x, y) !== 0;
// Runs of ink along the horizontal line y (or vertical x), found by sampling finely and refining.
function runs(polys, axis, v, from, to, step = 0.5) {
  const at = (u) => (axis === 'h' ? inked(polys, u, v) : inked(polys, v, u));
  const edges = [];
  let prev = at(from);
  for (let u = from + step; u <= to; u += step) {
    const now = at(u);
    if (now !== prev) {
      let a = u - step;
      let b = u;
      for (let k = 0; k < 40; k++) {
        const m = (a + b) / 2;
        if (at(m) === prev) a = m;
        else b = m;
      }
      edges.push((a + b) / 2);
      prev = now;
    }
  }
  const out = [];
  for (let k = 0; k + 1 < edges.length; k += 2) out.push([edges[k], edges[k + 1]]);
  return out;
}
const len = (r) => r[1] - r[0];
const mid = (r) => (r[0] + r[1]) / 2;
// Perpendicular thickness of a straight stroke from two parallel scans across it.
function strokeThickness(polys, axis, v1, v2, pick, lo, hi) {
  const r1 = pick(runs(polys, axis, v1, lo, hi));
  const r2 = pick(runs(polys, axis, v2, lo, hi));
  const slope = (mid(r2) - mid(r1)) / (v2 - v1);
  return ((len(r1) + len(r2)) / 2) / Math.sqrt(1 + slope * slope);
}
function distToBoundary(polys, x, y) {
  let best = Infinity;
  for (const p of polys) {
    for (let i = 0; i < p.length; i++) {
      const [ax, ay] = p[i];
      const [bx, by] = p[(i + 1) % p.length];
      const dx = bx - ax;
      const dy = by - ay;
      const L2 = dx * dx + dy * dy;
      const u = L2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2)) : 0;
      best = Math.min(best, Math.hypot(x - ax - u * dx, y - ay - u * dy));
    }
  }
  return best;
}
// Deterministic pseudo-random numbers for parameter sweeps.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randomParams(r) {
  const p = {};
  for (const k of Object.keys(L.RULER)) {
    const [a, b] = L.LIMITS[k];
    p[k] = a + r() * (b - a);
  }
  return p;
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const FIGURES = '0123456789';

// ---------- the character set and the paths ----------

test('every character of the claimed set exists and is a valid, closed, finite path', () => {
  assert.equal(L.CHARSET, LETTERS + FIGURES + ".,-' ");
  for (const p of [L.RULER, { round: 0.03, point: 0.06, bar: 0.75, middle: 0.55, halves: 0.45 }]) {
    for (const ch of L.CHARSET) {
      const g = L.glyph(ch, p);
      assert.ok(g, `no glyph for ${JSON.stringify(ch)}`);
      assert.ok(g.advance > 0, `${ch}: advance`);
      if (ch === ' ') {
        assert.equal(g.d, '');
        continue;
      }
      assert.match(g.d, /^(M[^MZ]+Z)+$/, `${ch}: path must be closed subpaths of M, L, C`);
      assert.doesNotMatch(g.d, /NaN|Infinity/);
      const polys = parse(g.d);
      assert.ok(polys.length >= 1);
      for (const poly of polys) assert.ok(Math.abs(area(poly)) > 50, `${ch}: degenerate contour`);
      // Ink exists and stays within the advance box horizontally.
      const b = box(polys);
      assert.ok(b.xMin >= 0 && b.xMax <= g.advance, `${ch}: ink outside its advance (${b.xMin}..${b.xMax} of ${g.advance})`);
    }
  }
  assert.equal(L.glyph('a'.toUpperCase(), L.RULER).ch, 'A');
  assert.equal(L.glyph('@', L.RULER), null);
});

test('every glyph stays a valid, non-degenerate drawing at all 32 corners of the allowed settings', () => {
  const keys = Object.keys(L.RULER);
  for (let m = 0; m < 32; m++) {
    const p = {};
    keys.forEach((k, i) => (p[k] = L.LIMITS[k][(m >> i) & 1]));
    for (const ch of L.CHARSET) {
      if (ch === ' ') continue;
      const polys = parse(L.glyph(ch, p).d, 16);
      for (const poly of polys) assert.ok(Math.abs(area(poly)) > 100, `${ch} at ${JSON.stringify(p)}: degenerate contour`);
      const holes = polys.filter((q) => area(q) < 0).length;
      assert.equal(holes, { O: 1, Q: 1, 0: 1, 6: 1, 9: 1, 8: 2 }[ch] || 0, `${ch}: holes at ${JSON.stringify(p)}`);
    }
  }
});

test('solid contours run counter-clockwise and holes clockwise, so the nonzero fill is the union', () => {
  for (const ch of LETTERS + FIGURES + ".,-'") {
    const polys = polysOf(ch);
    // A hole is a contour whose interior point is uninked; check signs against what is inside.
    for (const poly of polys) {
      const a = area(poly);
      // Sample a point just inside this contour, next to its first edge, on its left (y up).
      const [x0, y0] = poly[0];
      let k = 1;
      while (Math.hypot(poly[k][0] - x0, poly[k][1] - y0) < 1) k++;
      const [x1, y1] = poly[k];
      const ex = x1 - x0;
      const ey = y1 - y0;
      const n = Math.hypot(ex, ey);
      const lx = (x0 + x1) / 2 - (ey / n) * 0.5;
      const ly = (y0 + y1) / 2 + (ex / n) * 0.5;
      const rx = (x0 + x1) / 2 + (ey / n) * 0.5;
      const ry = (y0 + y1) / 2 - (ex / n) * 0.5;
      // A counter-clockwise contour has its interior on the left of each edge.
      const insideIsLeft = a > 0;
      const ix = insideIsLeft ? lx : rx;
      const iy = insideIsLeft ? ly : ry;
      const w = winding([poly], ix, iy);
      assert.equal(Math.abs(w), 1, `${ch}: contour interior test`);
      // Solid contours wind +1 and holes -1.
      assert.ok(a > 0 || a < 0);
    }
    const holes = polys.filter((p) => area(p) < 0).length;
    const expected = { O: 1, Q: 1, 0: 1, 6: 1, 9: 1, 8: 2 }[ch] || 0;
    assert.equal(holes, expected, `${ch}: number of clockwise (hole) contours`);
  }
});

// ---------- what the ruler promises ----------

test('by the ruler, every letter and figure spans exactly baseline to cap height (Q’s tail aside)', () => {
  for (const ch of LETTERS + FIGURES) {
    const b = box(polysOf(ch));
    assert.ok(Math.abs(b.yMax - CAP) < 0.006, `${ch}: top at ${b.yMax}`);
    if (ch === 'Q') assert.ok(b.yMin < -40, 'Q tail hangs below');
    else assert.ok(Math.abs(b.yMin) < 0.006, `${ch}: bottom at ${b.yMin}`);
  }
  // The Q's bowl itself sits on the baseline: scan down its centre line.
  const q = polysOf('Q');
  const r = runs(q, 'v', 45 + 350, -100, 800);
  assert.ok(Math.abs(r[0][0]) < 0.01, `Q bowl bottom at ${r[0][0]}`);
});

test('by the ruler, straight strokes are exactly 100 units thick, measured across the stroke', () => {
  const near = (v, what, tol = 0.05) => assert.ok(Math.abs(v - S) < tol, `${what}: ${v}`);
  const first = (rs) => rs[0];
  const second = (rs) => rs[1];
  const last = (rs) => rs[rs.length - 1];
  const P = (ch) => polysOf(ch);
  // Uprights, horizontal bars.
  for (const r of runs(P('H'), 'h', 200, -10, 800)) near(len(r), 'H stem');
  near(len(runs(P('H'), 'v', 70 + 270, -50, 800)[0]), 'H bar');
  for (const r of runs(P('E'), 'v', 70 + 250, -50, 800)) near(len(r), 'E arm');
  near(len(runs(P('T'), 'v', 20 + 60, -50, 800)[0]), 'T bar');
  near(len(runs(P('L'), 'v', 70 + 250, -50, 800)[0]), 'L foot');
  near(len(runs(P('I'), 'h', 350, -10, 300)[0]), 'I');
  for (const ch of 'ZF') near(len(runs(P(ch), 'v', 60 + (ch === 'Z' ? 10 : 250), -50, 800).slice(-1)[0]), `${ch} top bar`);
  // Diagonals: perpendicular thickness from two scans across the same stroke.
  near(strokeThickness(P('A'), 'h', 40, 110, first, -10, 800), 'A left');
  near(strokeThickness(P('A'), 'h', 40, 110, last, -10, 800), 'A right');
  near(strokeThickness(P('V'), 'h', 520, 620, first, -10, 800), 'V left');
  near(strokeThickness(P('V'), 'h', 520, 620, last, -10, 800), 'V right');
  for (let k = 0; k < 4; k++) near(strokeThickness(P('W'), 'h', 330, 380, (rs) => rs[k], -10, 1100), `W stroke ${k + 1}`);
  near(strokeThickness(P('M'), 'h', 400, 450, second, -10, 1000), 'M left diagonal');
  near(strokeThickness(P('M'), 'h', 400, 450, (rs) => rs[2], -10, 1000), 'M right diagonal');
  near(strokeThickness(P('N'), 'h', 300, 400, second, -10, 800), 'N diagonal');
  near(strokeThickness(P('X'), 'h', 80, 140, first, -10, 800), 'X stroke');
  near(strokeThickness(P('X'), 'h', 80, 140, last, -10, 800), 'X other stroke');
  near(strokeThickness(P('Y'), 'h', 600, 660, first, -10, 800), 'Y arm');
  near(strokeThickness(P('Z'), 'h', 300, 400, first, -10, 800), 'Z diagonal');
  near(strokeThickness(P('K'), 'h', 560, 620, last, -10, 800), 'K arm');
  near(strokeThickness(P('K'), 'h', 80, 140, last, -10, 800), 'K leg');
  near(strokeThickness(P('R'), 'h', 60, 120, last, -10, 800), 'R leg');
  near(strokeThickness(P('7'), 'h', 200, 300, first, -10, 800), '7 diagonal');
  near(strokeThickness(P('4'), 'h', 420, 480, first, -10, 800), '4 diagonal');
  near(strokeThickness(P('Q'), 'h', -15, -40, first, -10, 900), 'Q tail');
  near(strokeThickness(P('1'), 'v', 30 + 30, 30 + 70, first, 300, 800), '1 flag');
});

test('by the ruler, round strokes are 100 thick: exactly for circles, within 2% for ellipses', () => {
  // Thickness along rays from a ring's centre, for rings that are circles: exactly 100.
  const radial = (polys, cx, cy, deg) => {
    const ux = Math.cos((deg * Math.PI) / 180);
    const uy = Math.sin((deg * Math.PI) / 180);
    const at = (d) => inked(polys, cx + ux * d, cy + uy * d);
    // Find the ring as the inked stretch along the ray.
    let d = 0;
    while (!at(d)) d += 0.5;
    let a = d - 0.5;
    let b = d;
    for (let k = 0; k < 40; k++) {
      const m = (a + b) / 2;
      if (at(m)) b = m;
      else a = m;
    }
    const start = b;
    d = start + 1;
    while (at(d)) d += 0.5;
    a = d - 0.5;
    b = d;
    for (let k = 0; k < 40; k++) {
      const m = (a + b) / 2;
      if (at(m)) a = m;
      else b = m;
    }
    return a - start;
  };
  const circles = [
    ['O', 45 + 350, 350, [0, 30, 45, 60, 90, 135, 200, 250, 300, 330]],
    ['C', 45 + 350, 350, [60, 90, 135, 180, 225, 270, 300]],
    ['G', 45 + 350, 350, [50, 90, 135, 180, 225, 260]],
    ['U', 66 + 280, 280, [190, 225, 260, 300, 340]],
    ['J', 28 + 215, 215, [210, 240, 270, 300, 340]],
  ];
  for (const [ch, cx, cy, angles] of circles) {
    const polys = polysOf(ch);
    for (const a of angles) {
      const th = radial(polys, cx, cy, a);
      assert.ok(Math.abs(th - S) < 0.06, `${ch} at ${a}°: ${th}`);
    }
  }
  // Elliptical rings: exactly 100 at their extremes, and never off by more than 2% elsewhere.
  const extremes = [
    ['0', 45 + 255, 350],
    ['8', 45 + 212, 350 + 200 - 50],
    ['D', 70 + 270, 350],
  ];
  for (const [ch, cx, cy] of extremes) {
    const polys = polysOf(ch);
    const hr = runs(polys, 'h', cy, -10, 900);
    assert.ok(Math.abs(len(hr[hr.length - 1]) - S) < 0.05, `${ch}: side at its extreme ${len(hr[hr.length - 1])}`);
    const vr = runs(polys, 'v', cx, -50, 800);
    assert.ok(Math.abs(len(vr[vr.length - 1]) - S) < 0.05, `${ch}: top at its extreme ${len(vr[vr.length - 1])}`);
  }
  // Thickness along the outer normal, for every elliptical ring used: within [98, 100.05].
  const normalThickness = (a, b) => {
    let mn = Infinity;
    let mx = 0;
    for (let k = 0; k <= 400; k++) {
      const th = (k / 400) * (Math.PI / 2);
      const px = a * Math.cos(th);
      const py = b * Math.sin(th);
      let nx = b * Math.cos(th);
      let ny = a * Math.sin(th);
      const n = Math.hypot(nx, ny);
      nx /= n;
      ny /= n;
      let lo = 0;
      let hi = Math.max(a, b);
      for (let i = 0; i < 60; i++) {
        const m = (lo + hi) / 2;
        const x = px - nx * m;
        const y = py - ny * m;
        if ((x * x) / ((a - S) * (a - S)) + (y * y) / ((b - S) * (b - S)) <= 1) hi = m;
        else lo = m;
      }
      mn = Math.min(mn, lo);
      mx = Math.max(mx, lo);
    }
    return [mn, mx];
  };
  // Outer radii of every elliptical ring in letters.js, ruler values.
  for (const [name, a, b] of [['0', 255, 350], ['D', 330, 350], ['B P R bowls', 224, 200], ['S', 220, 200], ['8 and 3', 212, 200], ['2', 232, 205], ['5 6 9', 245, 238]]) {
    const [mn, mx] = normalThickness(a, b);
    assert.ok(mn > 98 && mx < 100.05, `${name}: ${mn}..${mx}`);
  }
});

test('by the ruler, the claimed symmetries hold exactly (sampled on a grid, independently)', () => {
  const kinds = {
    mirror: 'AHIMOTUVWXY08',
    flip: 'BCDEHIKOX038',
    turn: 'HINOSXZ08',
  };
  assert.deepEqual({ ...L.SYMMETRY }, kinds);
  for (const [kind, chars] of Object.entries(kinds)) {
    for (const ch of chars) {
      const polys = polysOf(ch);
      const b = box(polys);
      const cx = (b.xMin + b.xMax) / 2;
      const map = kind === 'mirror' ? ([x, y]) => [2 * cx - x, y] : kind === 'flip' ? ([x, y]) => [x, CAP - y] : ([x, y]) => [2 * cx - x, CAP - y];
      let bad = 0;
      let n = 0;
      for (let x = b.xMin + 1.37; x < b.xMax; x += 6.1) {
        for (let y = b.yMin + 0.91; y < b.yMax; y += 6.3) {
          n++;
          const [mx, my] = map([x, y]);
          if (inked(polys, x, y) !== inked(polys, mx, my) && distToBoundary(polys, x, y) > 0.03) bad++;
        }
      }
      assert.equal(bad, 0, `${ch} is not symmetric (${kind}): ${bad} of ${n}`);
    }
  }
  // And the eye's corrections break the vertical symmetries, as they should.
  const eye = { round: 0.02, point: 0.04, bar: 0.85, middle: 0.53, halves: 0.47 };
  for (const ch of 'BEHK8') {
    const polys = polysOf(ch, eye);
    let bad = 0;
    const b = box(polys);
    for (let x = b.xMin + 1.37; x < b.xMax; x += 6.1) for (let y = 0.91; y < CAP; y += 6.3) if (inked(polys, x, y) !== inked(polys, x, CAP - y)) bad++;
    assert.ok(bad > 20, `${ch} should no longer flip onto itself`);
  }
});

// ---------- what the corrections do ----------

test('each correction changes exactly the letters it is documented to change', () => {
  const ruler = {};
  for (const ch of L.CHARSET) ruler[ch] = L.glyph(ch, L.RULER).d;
  const changed = (p) =>
    [...L.CHARSET]
      .filter((ch) => L.glyph(ch, { ...L.RULER, ...p }).d !== ruler[ch])
      .sort()
      .join('');
  const sorted = (s) => [...s].sort().join('');
  assert.equal(changed({ round: 0.02 }), sorted(L.AFFECTS.round));
  assert.equal(changed({ point: 0.03 }), sorted(L.AFFECTS.point));
  assert.equal(changed({ middle: 0.53 }), sorted(L.AFFECTS.middle));
  assert.equal(changed({ halves: 0.47 }), sorted(L.AFFECTS.halves));
  // The bar ratio touches every glyph that has a stroke that is not upright: all but these.
  const untouched = [...L.CHARSET].filter((ch) => !changed({ bar: 0.8 }).includes(ch)).join('');
  assert.equal(untouched, "I.,' ");
});

test('the five settings are applied exactly: measured back off the outlines, independently', () => {
  const r = rng(59);
  for (let i = 0; i < 12; i++) {
    const p = randomParams(r);
    const P = (ch) => polysOf(ch, p);
    // round: the O's extremes.
    const o = box(P('O'));
    const h = box(P('H'));
    assert.ok(Math.abs(h.yMax - CAP) < 0.006 && Math.abs(h.yMin) < 0.006);
    assert.ok(Math.abs(o.yMax - CAP * (1 + p.round)) < 0.006, `O top ${o.yMax} for round ${p.round}`);
    assert.ok(Math.abs(o.yMin + CAP * p.round) < 0.006, `O bottom ${o.yMin}`);
    for (const ch of 'CGQS8U3J0') {
      const b = box(P(ch));
      if (ch !== 'U' && ch !== 'J' && ch !== 'Q') assert.ok(Math.abs(b.yMax - CAP * (1 + p.round)) < 0.006, `${ch} top`);
      if (ch !== 'Q') assert.ok(Math.abs(b.yMin + CAP * p.round) < 0.006, `${ch} bottom`);
    }
    // point: the apex of A and W, the vertices of V, W and M.
    // (With a negative setting the M's vertex rises inside its stems, which still stand on 0,
    // and the W's apex sinks below its terminals, which still reach the cap height.)
    assert.ok(Math.abs(box(P('A')).yMax - CAP * (1 + p.point)) < 0.006);
    for (const ch of 'VW') assert.ok(Math.abs(box(P(ch)).yMin + CAP * p.point) < 0.006, `${ch} vertex`);
    assert.ok(Math.abs(box(P('M')).yMin - Math.min(0, -CAP * p.point)) < 0.006, 'M vertex');
    assert.ok(Math.abs(box(P('W')).yMax - Math.max(CAP, CAP * (1 + p.point))) < 0.006, 'W apex');
    // bar: H's crossbar against its stems; and the pen rule for a diagonal (N).
    const stems = runs(P('H'), 'h', 100, -10, 800);
    const bar = runs(P('H'), 'v', 70 + 270, -50, 800);
    assert.ok(Math.abs(len(stems[0]) - S) < 0.02);
    assert.ok(Math.abs(len(bar[0]) - S * p.bar) < 0.02, `bar ${len(bar[0])} vs ${S * p.bar}`);
    // middle: the bar's centre.
    assert.ok(Math.abs(mid(bar[0]) - CAP * p.middle) < 0.02, `bar centre ${mid(bar[0])}`);
    // halves: the 8's two storeys, each counted to the far side of the waist stroke.
    const e = box(P('8'));
    const ys = runs(P('8'), 'v', (e.xMin + e.xMax) / 2, -100, 900).flat();
    assert.equal(ys.length, 6);
    const share = (ys[5] - ys[2]) / (ys[5] - ys[2] + (ys[3] - ys[0]));
    assert.ok(Math.abs(share - p.halves) < 1e-4, `8 share ${share} vs ${p.halves}`);
    // The module's own measuring code agrees with this independent one.
    const m = L.measureParams(p);
    for (const k of ['round', 'point', 'bar', 'middle']) assert.ok(Math.abs(m[k] - p[k]) < 1e-4, `${k}: ${m[k]} vs ${p[k]}`);
    assert.ok(Math.abs(m.halves8 - p.halves) < 1e-4);
  }
});

test('the elliptical pen: a diagonal stroke is sqrt((s sin a)^2 + (t cos a)^2) thick', () => {
  for (const bar of [0.6, 0.8, 1, 1.2]) {
    const p = { ...L.RULER, bar };
    const polys = polysOf('N', p);
    const rs1 = runs(polys, 'h', 300, -10, 900);
    const rs2 = runs(polys, 'h', 400, -10, 900);
    const r1 = rs1[1];
    const r2 = rs2[1];
    const slope = (mid(r2) - mid(r1)) / 100; // dx/dy
    const a = Math.atan2(1, Math.abs(slope)); // angle from horizontal
    const measured = len(r1) / Math.sqrt(1 + slope * slope);
    const t = S * bar;
    const expected = Math.sqrt((S * Math.sin(a)) ** 2 + (t * Math.cos(a)) ** 2);
    assert.ok(Math.abs(measured - expected) < 0.05, `bar ${bar}: ${measured} vs ${expected}`);
  }
});

test('determinism: a fresh copy of the module draws identical paths', () => {
  const key = require.resolve('./letters.js');
  delete require.cache[key];
  const L2 = require('./letters.js');
  const r = rng(7);
  for (let i = 0; i < 4; i++) {
    const p = i ? randomParams(r) : L.RULER;
    for (const ch of L.CHARSET) assert.equal(L2.glyph(ch, p).d, L.glyph(ch, p).d, `${ch} differs`);
  }
  // Out-of-range settings are clamped, not drawn wrong.
  const wild = L.glyph('O', { round: 5, bar: -3 });
  assert.equal(wild.d, L.glyph('O', { round: L.LIMITS.round[1], bar: L.LIMITS.bar[0] }).d);
});

test('the live checks the page runs all pass', () => {
  const results = L.verifyRuler();
  assert.ok(results.length >= 5);
  for (const r of results) assert.ok(r.pass, `${r.name}: ${r.detail}`);
});

test('layout: text is set from glyph advances; unknown characters are skipped', () => {
  const lay = L.layout('HO', L.RULER, 0);
  assert.equal(lay.width, L.glyph('H', L.RULER).advance + L.glyph('O', L.RULER).advance);
  assert.equal(L.layout('H~O', L.RULER, 0).width, lay.width);
  assert.equal(L.layout('ho', L.RULER, 0).d, lay.d);
});

// ---------- the typefaces and the sources ----------

test('typefaces.js holds what measure.mjs measures from the installed font files', async (t) => {
  const M = await import('./measure.mjs');
  const present = [...M.FACES, ...M.POINTED].filter((f) => fs.existsSync(f.file));
  if (!present.length) {
    t.skip('none of the measured font files is installed here');
    return;
  }
  const fresh = M.measureAll();
  for (const row of FACES.sans) {
    const f = fresh.sans.find((x) => x.name === row.name && x.style === row.style);
    if (!f) continue;
    for (const k of Object.keys(row)) assert.deepEqual(f[k], row[k], `${row.name} ${row.style} ${k}`);
  }
  for (const row of FACES.pointed) {
    const f = fresh.pointed.find((x) => x.name === row.name && x.style === row.style);
    if (!f) continue;
    for (const k of Object.keys(row)) assert.deepEqual(f[k], row[k], `${row.name} ${row.style} ${k}`);
  }
});

test('the typeface numbers support what the page and README say about them', () => {
  const sans = FACES.sans;
  assert.equal(sans.length, 8);
  // Every sans face overshoots its O, raises its H bar, thins it, and shrinks the 8's top.
  for (const f of sans) {
    assert.ok(f.round > 0.01 && f.round < 0.025, `${f.name}: round ${f.round}`);
    assert.ok(f.middle > 0.5, `${f.name}: middle`);
    assert.ok(f.bar < 0.9, `${f.name}: bar`);
    assert.ok(f.halves8 < 0.49 && f.halvesB < 0.495, `${f.name}: halves`);
    // No pointed apexes: the A is cut flat at the cap height, wide 1% below its top.
    assert.equal(f.point, 0);
    assert.ok(f.apexWidth > 0.14 && f.apexWidth < 0.32, `${f.name}: apex width ${f.apexWidth}`);
  }
  for (const f of FACES.pointed) {
    assert.ok(f.pointBottom > 0.015 && f.pointBottom < 0.03);
    assert.ok(f.vWidth < 0.11, `${f.name} ${f.style}: V is nearly pointed`);
  }
  const pct = (v, d = 1) => (v * 100).toFixed(d);
  const range = (vals, d = 1) => [Math.min(...vals), Math.max(...vals)].map((v) => pct(v, d));
  const readme = fs.readFileSync(path.join(DIR, 'README.md'), 'utf8');
  const [r0, r1] = range(sans.map((f) => f.round));
  assert.ok(readme.includes(`${r0}% to ${r1}%`), `README should give the O overshoot range ${r0}% to ${r1}%`);
  const thicker = sans.map((f) => 1 / f.bar - 1);
  const [b0, b1] = range(thicker, 0);
  assert.ok(readme.includes(`${b0}% to ${b1}%`), `README should give the uprights-thicker range ${b0}% to ${b1}%`);
  const [m0, m1] = range(sans.map((f) => f.middle - 0.5));
  assert.ok(readme.includes(`${m0}% to ${m1}%`), `README should give the bar-raise range ${m0}% to ${m1}%`);
  const smaller = sans.map((f) => 1 - f.halves8 / (1 - f.halves8));
  const [h0, h1] = range(smaller);
  assert.ok(readme.includes(`${h0}% to ${h1}%`), `README should give the 8 range ${h0}% to ${h1}%`);
  const [v0, v1] = range(FACES.pointed.map((f) => f.pointBottom));
  assert.ok(readme.includes(`${v0}% to ${v1}%`), `README should give the serif V range ${v0}% to ${v1}%`);
});

test('the lab numbers on the page match the cited paper', () => {
  // de Waard, Van der Burg & Olivers (2019), "A Thickness Illusion: Horizontal Is Perceived as
  // Thicker than Vertical", Vision 3(1):1, doi:10.3390/vision3010001. Experiment 1: "the vertical
  // line must be 5.4% thicker than the horizontal line for them to be perceived as equally thick";
  // "This bias showed in 27 out of the 28 subjects." Experiment 2: "2.6% in the thickness illusion".
  const source = { exp1: 5.4, exp2: 2.6, showed: 27, of: 28 };
  const app = fs.readFileSync(path.join(DIR, 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
  assert.match(app, /de Waard et al\. 2019, experiment 1, average of 28 people', v: 5\.4 \}/);
  assert.match(app, /experiment 2, average', v: 2\.6 \}/);
  assert.ok(html.includes(`${source.exp1}% thicker`) && html.includes(`${source.exp2}% in a second experiment`));
  assert.ok(html.includes(`${source.showed} of ${source.of} people`));
  // Experiment 1: "The mean PSE was -0.05 deg ... SD = 0.03 deg": the spread between people is more
  // than half the mean, which the page and README now say. The correlation with the length
  // illusion was r = -0.321 with the horizontal frame only (r = -0.089, n.s., with the vertical).
  assert.ok(0.03 / 0.05 > 0.5);
  assert.match(html, /spread between individuals was more than half the average/);
  assert.match(html, /correlated only weakly, and in only one of their two conditions/);
  const readme = fs.readFileSync(path.join(DIR, 'README.md'), 'utf8');
  assert.match(readme, /SD 0\.03°\) was more than half the mean \(0\.05°\)/);
  assert.match(readme, /r = −0\.32\) and only in one of their two conditions/);
});

test('the page loads only local classic scripts and no font files', () => {
  const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(scripts, ['letters.js', 'typefaces.js', 'method.js', 'app.js']);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.doesNotMatch(html, /type="module"/);
  const files = fs.readdirSync(DIR);
  assert.ok(!files.some((f) => /\.(woff2?|ttf|otf|eot)$/i.test(f)), 'no font files in the folder');
  const css = fs.readFileSync(path.join(DIR, 'style.css'), 'utf8');
  assert.doesNotMatch(css, /@font-face|url\(/);
});

// ---------- the method: where tries start, and how four tries become a setting ----------
// These pin the fix for the independent review's main finding. The first version started its two
// tries in bands centred on the typefaces' corrections (below, from app.js as first deposited) and
// reported the mean of the two stops, so a reader who stops short was pulled toward the typefaces.

const MTH = require('./method.js');
const KEYS = ['round', 'point', 'bar', 'middle', 'halves'];
const FIRST_BANDS = {
  round: { high: [0.035, 0.055], low: [-0.025, -0.012] },
  point: { high: [0.06, 0.09], low: [-0.035, -0.015] },
  bar: { high: [1.1, 1.18], low: [0.66, 0.74] },
  middle: { high: [0.56, 0.585], low: [0.425, 0.445] },
  halves: { high: [0.53, 0.55], low: [0.415, 0.435] },
};
// The typefaces' corrections in each test's parameter units (written out here, not imported).
const faceValues = {
  round: FACES.sans.map((f) => f.round),
  point: FACES.pointed.map((f) => f.pointBottom),
  bar: FACES.sans.map((f) => f.bar),
  middle: FACES.sans.map((f) => f.middle),
  halves: FACES.sans.map((f) => f.halves8),
};
const med = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
// One standard deviation of a reader's scatter, in parameter units.
const SCATTER = { round: 0.003, point: 0.004, bar: 0.02, middle: 0.003, halves: 0.004 };
function normal(r) {
  let u = 0;
  while (!u) u = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}
// A simulated reader, written here rather than imported: from a start s it closes a share f of the
// distance to T, stopping `zone` short on whichever side it came from, plus scatter.
function reader(o, s, r) {
  const side = s >= o.T ? 1 : -1;
  return s + o.f * (o.T + side * o.zone - s) + (o.noise ? o.noise * normal(r) : 0);
}
function runPage(key, o, r) {
  const sides = [...MTH.pairOrder(r), ...MTH.pairOrder(r)];
  const tries = [];
  for (let n = 0; n < 4; n++) {
    const { start, side } = MTH.startFor(key, n, tries, sides, r);
    tries.push({ start, stop: reader(o, start, r), side, moved: o.f !== 0 });
  }
  return { tries, res: MTH.estimate(key, tries) };
}
function runFirst(key, o, r) {
  const b = FIRST_BANDS[key];
  const draw = (band) => band[0] + r() * (band[1] - band[0]);
  return (reader(o, draw(b.high), r) + reader(o, draw(b.low), r)) / 2;
}

test('method: every start band and window is symmetric about the ruler, and the far starts lie beyond every typeface', () => {
  assert.deepEqual(Object.keys(MTH.PLAN), KEYS);
  for (const k of KEYS) {
    const p = MTH.PLAN[k];
    assert.equal(p.ruler, L.RULER[k]);
    // The control's window is the alphabet's allowed range, centred on the ruler.
    assert.deepEqual([...p.window], [...L.LIMITS[k]], `${k}: window and LIMITS`);
    assert.ok(Math.abs(p.window[0] + p.window[1] - 2 * p.ruler) < 1e-12, `${k}: window not centred on the ruler`);
    assert.ok(p.far[0] > p.near[1] && p.near[0] > 0, `${k}: bands`);
    // Further off than any measured typeface, so the first two starts bracket every typeface's value.
    const furthest = Math.max(...faceValues[k].map((v) => Math.abs(v - p.ruler)));
    assert.ok(p.far[0] > furthest, `${k}: far band starts at ${p.far[0]}, a typeface is ${furthest} off`);
    assert.ok(p.ruler + p.far[1] <= p.window[1] && p.ruler - p.far[1] >= p.window[0]);
  }
  // The first two starts are one above and one below the ruler, at distances drawn from the same
  // band, so over many readers their centre is the ruler, not the typefaces.
  const r = rng(1);
  for (const k of KEYS) {
    const p = MTH.PLAN[k];
    let sum = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const sides = [...MTH.pairOrder(r), ...MTH.pairOrder(r)];
      assert.equal(sides[0] + sides[1], 0);
      assert.equal(sides[2] + sides[3], 0);
      const a = MTH.startFor(k, 0, [], sides, r);
      const b = MTH.startFor(k, 1, [], sides, r);
      assert.equal(Math.sign(a.start - p.ruler), sides[0]);
      assert.equal(Math.sign(b.start - p.ruler), sides[1]);
      for (const q of [a, b]) {
        const d = Math.abs(q.start - p.ruler);
        assert.ok(d >= p.far[0] - 1e-12 && d <= p.far[1] + 1e-12);
      }
      sum += a.start + b.start - 2 * p.ruler;
    }
    const spread = p.far[1] - p.far[0];
    assert.ok(Math.abs(sum / (2 * N)) < 0.02 * spread + 1e-9, `${k}: first starts centred at ${sum / (2 * N)} from the ruler`);
    // The near starts sit on either side of the mean of the first two stops.
    const tries = [{ start: 0, stop: p.ruler + 0.3 * p.far[0], side: 1 }, { start: 0, stop: p.ruler + 0.1 * p.far[0], side: -1 }];
    const c = p.ruler + 0.2 * p.far[0];
    const up = MTH.startFor(k, 2, tries, [1, -1, 1, -1], r);
    const down = MTH.startFor(k, 3, tries, [1, -1, 1, -1], r);
    assert.ok(Math.abs(up.centre - c) < 1e-12 && up.start - c >= p.near[0] - 1e-12 && up.start - c <= p.near[1] + 1e-12);
    assert.ok(c - down.start >= p.near[0] - 1e-12 && c - down.start <= p.near[1] + 1e-12);
  }
});

test('method: with no scatter, four tries give back a stop-short, can’t-tell-band or overshooting reader’s setting exactly', () => {
  const r = rng(2);
  for (const k of KEYS) {
    const R = MTH.PLAN[k].ruler;
    const typ = med(faceValues[k]);
    for (const T of [R, typ, 2 * R - typ, R + 0.5 * (typ - R)]) {
      for (const f of [0.55, 0.65, 0.75, 0.9, 1, 1.2, 1.4]) {
        for (const zone of [0, SCATTER[k]]) {
          for (let rep = 0; rep < 3; rep++) {
            const { tries, res } = runPage(k, { T, f, zone, noise: 0 }, r);
            for (const q of tries) assert.ok(q.stop >= MTH.PLAN[k].window[0] && q.stop <= MTH.PLAN[k].window[1], 'stop inside the window');
            assert.ok(res.ok, `${k} T=${T} f=${f} zone=${zone}: ${res.why}`);
            assert.ok(Math.abs(res.value - T) < 1e-9, `${k} T=${T} f=${f} zone=${zone}: got ${res.value}`);
            assert.ok(Math.abs(res.left - (1 - f)) < 1e-9, 'b is the share of the error left in place');
          }
        }
      }
    }
  }
});

test('method: the first version pulled a reader who stops short toward the typefaces; the new one does not', () => {
  for (const k of KEYS) {
    const R = MTH.PLAN[k].ruler;
    const typ = med(faceValues[k]);
    const dir = Math.sign(typ - R); // the typefaces' direction
    const b = FIRST_BANDS[k];
    const firstCentre = (b.high[0] + b.high[1] + b.low[0] + b.low[1]) / 4;
    // The first version's start bands were centred on the typefaces' side of the ruler.
    assert.equal(Math.sign(firstCentre - R), dir, `${k}: first start centre`);
    // A reader whose eye agrees with the ruler and who closes three quarters of the distance.
    const o = { T: R, f: 0.75, zone: 0, noise: SCATTER[k] };
    const r = rng(3);
    const firstErr = [];
    const newErr = [];
    let none = 0;
    for (let i = 0; i < 1500; i++) {
      firstErr.push(runFirst(k, o, r) - R);
      const { res } = runPage(k, o, r);
      if (res.ok) newErr.push(res.value - R);
      else none++;
    }
    // First version: pulled a quarter of the way to its start centre, i.e. toward the typefaces.
    const pull = 0.25 * (firstCentre - R);
    assert.ok(Math.abs(med(firstErr) - pull) < 0.15 * Math.abs(pull), `${k}: first version's pull ${med(firstErr)} vs ${pull}`);
    // New: no pull worth the name (a few per cent of the scatter), and nearly always a result.
    assert.ok(Math.abs(med(newErr)) < 0.06 * SCATTER[k], `${k}: new method's median error ${med(newErr)}`);
    assert.ok(none / 1500 < 0.03, `${k}: no result in ${none} of 1500`);
    // A reader who never moves: the first version reported its start centre; now no result at all.
    const still = { T: R, f: 0, zone: 0, noise: 0 };
    const rr = rng(4);
    const firstStill = med(Array.from({ length: 400 }, () => runFirst(k, still, rr)));
    assert.equal(Math.sign(firstStill - R), dir, `${k}: the unmoved reader got a typeface-like answer before`);
    assert.equal(runPage(k, still, rr).res.why, 'unmoved');
    // A reader who nudges once and commits leaves nearly all the starting error: no result.
    const nudger = { T: R, f: 0.02, zone: 0, noise: 0 };
    assert.equal(runPage(k, nudger, rr).res.why, 'anchored');
  }
});

test('method: an unsteady reader who stops well short is pulled toward the ruler, never away from it', () => {
  for (const k of KEYS) {
    const R = MTH.PLAN[k].ruler;
    const typ = med(faceValues[k]);
    const dir = Math.sign(typ - R);
    for (const T of [R, typ, 2 * R - typ]) {
      const o = { T, f: 0.55, zone: 0, noise: 2 * SCATTER[k] };
      const r = rng(5);
      const errs = [];
      for (let i = 0; i < 3000; i++) {
        const { res } = runPage(k, o, r);
        if (res.ok) errs.push(res.value - T);
      }
      const m = med(errs);
      // Toward the ruler from T is the sign of (R - T); at T = R, no pull beyond Monte Carlo noise.
      if (T === R) assert.ok(Math.abs(m) < 0.1 * SCATTER[k], `${k} at the ruler: ${m}`);
      else assert.ok(Math.sign(m) === Math.sign(R - T) || Math.abs(m) < 0.05 * SCATTER[k], `${k} T=${T}: median error ${m} points away from the ruler`);
      assert.ok(Math.abs(m) < 0.6 * Math.abs(T - R) + 0.1 * SCATTER[k], `${k}: pulled ${m}`);
    }
    void dir;
  }
});

test('method: the README’s simulation tables are what simulate.mjs prints', async () => {
  const sim = await import('./simulate.mjs');
  const readme = fs.readFileSync(path.join(DIR, 'README.md'), 'utf8');
  for (const row of [...sim.readmeRows(), ...sim.hardRows()]) assert.ok(readme.includes(row), `README is missing the row\n${row}`);
});

test('the page takes settings through method.js, with no slider track and no reading without four moved tries', () => {
  const app = fs.readFileSync(path.join(DIR, 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
  // No range input and none of the first version's start bands or random track shift.
  assert.doesNotMatch(app, /type: 'range'/);
  assert.doesNotMatch(app, /high: \[|low: \[|span: \[|0\.12 \* span/);
  assert.match(app, /M\.startFor\(t\.key, n, r\.tries, r\.sides, Math\.random\)/);
  assert.match(app, /M\.estimate\(key, r\.tries\)/);
  // The control does not announce a minimum or maximum, which would locate the ruler.
  assert.doesNotMatch(app, /setAttribute\('aria-value(min|max)'|'aria-value(min|max)':/);
  assert.match(app, /role: 'spinbutton'/);
  // "Looks equal" stays disabled until the control has moved.
  assert.match(app, /commit\.disabled = !t\.moved/);
  // The verdict no longer tells an unmoved reader that the typeface-like answer is their eye.
  assert.doesNotMatch(app + html, /To your eye it is equal/);
  assert.doesNotMatch(html, /its middle means nothing|carries no information/);
  // Old results, taken by the first method, are not read.
  assert.match(app, /const STORE = 'by-eye-v2'/);
  assert.equal(MTH.TRIES, 4);
});

// ---------- smaller fixes from the review ----------

test('the round test changes the O’s height only: O, C, G, Q and 0 keep their width', () => {
  for (const ch of 'OCGQ0') {
    const widths = [-0.05, 0, 0.02, 0.05].map((round) => {
      const g = L.glyph(ch, { ...L.RULER, round });
      const b = box(parse(g.d));
      return { adv: g.advance, w: ch === 'Q' ? null : b.xMax - b.xMin, h: b.yMax };
    });
    for (const w of widths) {
      assert.equal(w.adv, widths[1].adv, `${ch}: advance changes with the overshoot`);
      if (w.w !== null) assert.ok(Math.abs(w.w - widths[1].w) < 0.01, `${ch}: width changes with the overshoot`);
    }
    assert.ok(widths[2].h > widths[1].h + 13.9, `${ch}: no taller`);
  }
  assert.equal(L.glyph('O', { ...L.RULER, round: 0.02 }).advance, 790);
});

test('the 2’s diagonal is 99.7 thick at the ruler, as the README says, not 100', () => {
  const t2 = strokeThickness(polysOf('2'), 'h', 150, 230, (rs) => rs[0], -10, 600);
  assert.ok(Math.abs(t2 - 99.68) < 0.05, `2 diagonal ${t2}`);
  const readme = fs.readFileSync(path.join(DIR, 'README.md'), 'utf8');
  assert.match(readme, /except the 2's diagonal, which continues its elliptical bowl along the bowl's mid-line and is 99\.7 thick/);
});

// Ink runs along the vertical line x, from exact edge crossings and nonzero winding.
function columnRuns(polys, x) {
  const ev = [];
  for (const p of polys) {
    for (let i = 0; i < p.length; i++) {
      const [x0, y0] = p[i];
      const [x1, y1] = p[(i + 1) % p.length];
      if ((x0 <= x && x1 > x) || (x1 <= x && x0 > x)) ev.push([y0 + ((x - x0) / (x1 - x0)) * (y1 - y0), x1 > x0 ? -1 : 1]);
    }
  }
  ev.sort((a, b) => a[0] - b[0]);
  const out = [];
  let w = 0;
  let from = 0;
  for (const [y, d] of ev) {
    const was = w !== 0;
    w += d;
    if (!was && w !== 0) from = y;
    if (was && w === 0) out.push([from, y]);
  }
  return out;
}
// The smaller of a two-storey glyph's two counters, each at its tallest (columns with three runs).
function smallerCounter(ch, p) {
  const g = L.glyph(ch, p);
  const polys = parse(g.d, 24);
  let lo = 0;
  let hi = 0;
  for (let x = 0.5; x < g.advance; x += 1) {
    const rs = columnRuns(polys, x);
    if (rs.length === 3) {
      lo = Math.max(lo, rs[1][0] - rs[0][1]);
      hi = Math.max(hi, rs[2][0] - rs[1][1]);
    }
  }
  return Math.min(lo, hi);
}

test('counters: at least 135 units wherever the corrections go the typefaces’ way; slits only at unusual extremes', () => {
  // The allowed range is what the tests can reach (the review found slit counters at corners of a
  // wider range that no test could reach).
  for (const k of KEYS) assert.deepEqual([...L.LIMITS[k]], [...MTH.PLAN[k].window]);
  let worst = Infinity;
  for (const round of [0, 0.035, 0.07]) {
    for (const bar of [0.6, 0.8, 1]) {
      for (const halves of [0.42, 0.5, 0.58]) {
        for (const ch of 'B38S') worst = Math.min(worst, smallerCounter(ch, { ...L.RULER, round, bar, halves }));
      }
    }
  }
  assert.ok(worst >= 135 && worst < 137, `smallest counter in the typefaces' direction: ${worst}`);
  const corner = { ...L.RULER, round: -0.07, bar: 1.4, halves: 0.42 };
  for (const ch of '38') assert.ok(Math.abs(smallerCounter(ch, corner) - 32) < 1, `${ch} at the unusual corner`);
  assert.ok(Math.abs(smallerCounter('B', corner) - 73) < 1);
  const readme = fs.readFileSync(path.join(DIR, 'README.md'), 'utf8');
  assert.match(readme, /at least 135 units tall/);
  assert.match(readme, /smaller counters of 3 and 8 close to about 32 units, 4\.5% of the cap height/);
  assert.doesNotMatch(readme, /none breaks across the allowed parameter range/);
});

test('the wording the review corrected stays corrected', () => {
  const app = fs.readFileSync(path.join(DIR, 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
  const readme = fs.readFileSync(path.join(DIR, 'README.md'), 'utf8');
  // The pointed comparison is four serif faces' Vs, narrow rather than pointed.
  assert.equal(FACES.pointed.length, 4);
  assert.doesNotMatch(html, /two serif faces|nearly to a point/);
  assert.match(html, /V of four serif faces \(Liberation Serif and FreeSerif, regular and bold\), whose Vs end in a narrow vertex/);
  const pc = (v, d) => (v * 100).toFixed(d);
  const vw = FACES.pointed.map((f) => f.vWidth);
  const sw = FACES.sans.map((f) => f.vWidth);
  assert.ok(Math.max(...vw) < Math.min(...sw), 'every serif V is narrower near its vertex than every sans V');
  assert.ok(readme.includes(`${pc(Math.min(...vw), 1)}% to ${pc(Math.max(...vw), 2)}% of the cap height wide, against ${pc(Math.min(...sw), 1)}% to ${pc(Math.max(...sw), 1)}%`));
  // The O range is per face, averaged over top and bottom; single sides run wider.
  const sides = FACES.sans.flatMap((f) => [f.roundTop, f.roundBottom]);
  for (const f of FACES.sans) assert.ok(Math.abs((f.roundTop + f.roundBottom) / 2 - f.round) < 1e-4, `${f.name} ${f.style}: round is the mean of top and bottom`);
  assert.ok(readme.includes(`Single sides run from ${pc(Math.min(...sides), 2)}% to ${pc(Math.max(...sides), 2)}%`));
  assert.match(readme, /averaged over top and bottom \(median 1\.7%\)/);
  const designs = new Map();
  for (const f of FACES.sans) designs.set(f.name, [...(designs.get(f.name) || []), f.round]);
  assert.equal(designs.size, 4);
  assert.equal([...designs.values()].filter((v) => v.length === 2 && v[0] === v[1]).length, 3);
  assert.match(readme, /in three of the four the regular and bold O overshoot by exactly the same amount/);
  // The vertical-bisection bias is an average that varies between people, not "most people".
  assert.doesNotMatch(html + app, /most people/);
  assert.match(html, /people on average mark it slightly too high; the bias is small and varies from person to person/);
  assert.match(app, /people on average mark it a little too high, by an amount that varies from person to person/);
  // The smaller top storey: "the usual reason given", not a stated cause.
  assert.doesNotMatch(app, /which is why every 8/);
  assert.match(app, /that is the usual reason given for the smaller top of every 8 measured here/);
});
