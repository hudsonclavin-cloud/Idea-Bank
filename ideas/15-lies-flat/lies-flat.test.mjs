// Tests for Lies Flat. Run from the repo root: node --test ideas/15-lies-flat/lies-flat.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const MODULE = path.join(here, 'fold.js');
const LF = require(MODULE);

const SEEDS = ['1', '2', '3', '7', '42', '1234', '99999', 'hello-world'];
const cache = new Map();
const gen = (seed) => {
  if (!cache.has(seed)) cache.set(seed, LF.generate(seed));
  return cache.get(seed);
};

// ---------------------------------------------------------------- a small, strict SVG reader
// Accepts only what this generator should emit: an XML prolog, then elements with
// double-quoted attributes, text only inside <title> and <desc>.
function parseSvg(src) {
  assert.ok(src.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n'), 'XML prolog');
  let i = src.indexOf('\n') + 1;
  const root = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const tagRe = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"<>]*")*)\s*(\/?)>/y;
  while (i < src.length) {
    if (src[i] === '<') {
      tagRe.lastIndex = i;
      const m = tagRe.exec(src);
      assert.ok(m, 'well-formed tag at ' + i + ': ' + src.slice(i, i + 40));
      const [whole, close, name, attrText, selfClose] = m;
      if (close) {
        const top = stack.pop();
        assert.equal(top.name, name, 'tags nest properly');
      } else {
        const attrs = {};
        for (const a of attrText.matchAll(/([\w:-]+)="([^"]*)"/g)) {
          assert.ok(!(a[1] in attrs), 'no duplicate attribute ' + a[1]);
          attrs[a[1]] = a[2];
        }
        const el = { name, attrs, children: [], text: '' };
        stack[stack.length - 1].children.push(el);
        if (!selfClose) stack.push(el);
      }
      i += whole.length;
    } else {
      const j = src.indexOf('<', i);
      const text = src.slice(i, j < 0 ? src.length : j);
      stack[stack.length - 1].text += text;
      i = j < 0 ? src.length : j;
    }
  }
  assert.equal(stack.length, 1, 'all tags closed');
  assert.equal(root.children.length, 1, 'one root element');
  return root.children[0];
}

const NUM = '-?\\d+(?:\\.\\d{1,2})?';
const PATH_RE = new RegExp(`^M${NUM} ${NUM}(?:L${NUM} ${NUM})+$`);
const pointsOf = (d) => [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => ({ x: +m[1], y: +m[2] }));

function strokes(svgRoot) {
  const out = [];
  for (const g of svgRoot.children.filter((c) => c.name === 'g')) {
    for (const p of g.children) out.push({ pen: g.attrs.stroke, pts: pointsOf(p.attrs.d) });
  }
  return out;
}

// ---------------------------------------------------------------- determinism
test('the same seed gives a byte-identical SVG, even from a fresh copy of the module', () => {
  for (const seed of SEEDS.slice(0, 5)) {
    const a = LF.generate(seed).svg;
    const b = LF.generate(seed).svg;
    assert.equal(a, b, 'seed ' + seed);
    delete require.cache[require.resolve(MODULE)];
    const fresh = require(MODULE);
    assert.equal(fresh.generate(seed).svg, a, 'fresh module, seed ' + seed);
  }
});

test('the artwork never touches Math.random', () => {
  const orig = Math.random;
  Math.random = () => { throw new Error('Math.random was called'); };
  try {
    assert.equal(LF.generate('1234').svg, gen('1234').svg);
  } finally {
    Math.random = orig;
  }
});

test('different seeds give different drawings', () => {
  const svgs = SEEDS.map((s) => gen(s).svg);
  assert.equal(new Set(svgs).size, svgs.length);
  // and not merely different titles: the drawn paths differ too
  const bodies = svgs.map((s) => s.slice(s.indexOf('<g ')));
  assert.equal(new Set(bodies).size, bodies.length);
});

// ---------------------------------------------------------------- what the SVG may contain
test('only svg, title, desc, g and path; strokes only; one stated width; two fixed colours', () => {
  const ALLOWED = {
    svg: ['xmlns', 'xmlns:inkscape', 'width', 'height', 'viewBox'],
    title: [], desc: [],
    g: ['id', 'inkscape:groupmode', 'inkscape:label', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin'],
    path: ['d'],
  };
  const colours = LF.PENS.map((p) => p.colour);
  for (const seed of SEEDS) {
    const { svg, stats } = gen(seed);
    assert.doesNotMatch(svg, /style=|transform|filter|gradient|opacity|<image|<text|<rect|<circle|<use|fill="(?!none")/i);
    const root = parseSvg(svg);
    assert.equal(root.name, 'svg');
    assert.equal(root.attrs.xmlns, 'http://www.w3.org/2000/svg');
    assert.equal(root.attrs.width, '420mm');
    assert.equal(root.attrs.height, '297mm');
    assert.equal(root.attrs.viewBox, '0 0 420 297');
    const walk = (el) => {
      assert.ok(el.name in ALLOWED, 'element <' + el.name + '>');
      for (const a of Object.keys(el.attrs)) assert.ok(ALLOWED[el.name].includes(a), `attribute ${a} on <${el.name}>`);
      if (el.name !== 'title' && el.name !== 'desc') assert.equal(el.text.trim(), '', 'no stray text in <' + el.name + '>');
      el.children.forEach(walk);
    };
    walk(root);
    const groups = root.children.filter((c) => c.name === 'g');
    assert.equal(groups.length, 2, 'one group per pen');
    for (const g of groups) {
      assert.equal(g.attrs.fill, 'none');
      assert.equal(g.attrs['stroke-width'], String(LF.PEN_WIDTH));
      assert.equal(LF.PEN_WIDTH, 0.3);
      assert.ok(colours.includes(g.attrs.stroke), 'pen colour ' + g.attrs.stroke);
      assert.ok(g.children.length > 0);
      for (const p of g.children) {
        assert.equal(p.name, 'path');
        assert.match(p.attrs.d, PATH_RE, 'path data is M/L with at most 2 decimals');
        for (const q of pointsOf(p.attrs.d)) {
          assert.ok(q.x >= 30 && q.x <= 390 && q.y >= 30 && q.y <= 267, `point ${q.x},${q.y} inside the margins`);
        }
      }
    }
    assert.notEqual(groups[0].attrs.stroke, groups[1].attrs.stroke);
    // every path stays in one panel
    const sp = stats.panels.sheet, fp = stats.panels.fold;
    const inBox = (q, b) => q.x >= b.x - 0.02 && q.x <= b.x + b.w + 0.02 && q.y >= b.y - 0.02 && q.y <= b.y + b.h + 0.02;
    for (const s of strokes(root)) {
      assert.ok(s.pts.every((q) => inBox(q, sp)) || s.pts.every((q) => inBox(q, fp)), 'a stroke never crosses the gutter');
    }
  }
});

// ---------------------------------------------------------------- the proof, re-checked from the drawing alone
// Rebuild the crease pattern from the left panel of the SVG (black = mountain, red = valley),
// find every vertex where four creases meet, and test Kawasaki, Maekawa and the crimp condition there.
// Coordinates in the file are rounded to 0.01 mm, so angles are only good to a few hundredths
// of a degree; the generator's own double-precision check is reported alongside.
function checkFromSvg(seed) {
  const { svg, stats } = gen(seed);
  const root = parseSvg(svg);
  const sp = stats.panels.sheet;
  const black = LF.PENS[0].colour;
  const segs = [];
  for (const s of strokes(root)) {
    if (!s.pts.every((q) => q.x <= sp.x + sp.w + 0.02)) continue; // right panel
    for (let k = 1; k < s.pts.length; k++) segs.push({ a: s.pts[k - 1], b: s.pts[k], m: s.pen === black });
  }
  const key = (q) => Math.round(q.x * 50) + ':' + Math.round(q.y * 50);
  const at = new Map();
  for (const s of segs) {
    for (const [p, o] of [[s.a, s.b], [s.b, s.a]]) {
      const k = key(p);
      if (!at.has(k)) at.set(k, []);
      at.get(k).push({ ang: Math.atan2(o.y - p.y, o.x - p.x), m: s.m });
    }
  }
  let n = 0, kawasaki = 0, maekawaFail = 0, oddFail = 0, other = 0;
  for (const list of at.values()) {
    if (list.length !== 4) { if (list.length > 4) other++; continue; }
    n++;
    list.sort((p, q) => p.ang - q.ang);
    const sec = list.map((c, k) => { let s = list[(k + 1) % 4].ang - c.ang; if (k === 3) s += 2 * Math.PI; return s * 180 / Math.PI; });
    kawasaki = Math.max(kawasaki, Math.abs(sec[0] + sec[2] - 180), Math.abs(sec[1] + sec[3] - 180));
    const mountains = list.filter((c) => c.m).length;
    if (mountains !== 1 && mountains !== 3) { maekawaFail++; continue; }
    const odd = list.findIndex((c) => c.m === (mountains === 1));
    const mn = Math.min(...sec);
    if (Math.min(sec[odd], sec[(odd + 3) % 4]) - mn > 0.25) oddFail++;
  }
  return { n, kawasaki, maekawaFail, oddFail, other, stats };
}

test('read back from the SVG: every four-crease vertex obeys Kawasaki, Maekawa and the crimp condition', () => {
  for (const seed of SEEDS) {
    const r = checkFromSvg(seed);
    assert.equal(r.other, 0, 'no vertex has more than four creases');
    assert.equal(r.n, r.stats.vertices, 'the drawing has exactly the vertices the generator checked');
    assert.ok(r.kawasaki < 0.25, `Kawasaki from the file: worst ${r.kawasaki.toFixed(3)} deg`);
    assert.equal(r.maekawaFail, 0, 'Maekawa');
    assert.equal(r.oddFail, 0, 'odd crease beside a smallest angle');
    console.log(`  seed ${seed}: ${r.n} vertices; Kawasaki error ${r.kawasaki.toFixed(3)} deg read from the file, ` +
      `${r.stats.kawasakiMaxDeg.toExponential(1)} deg in double precision`);
  }
});

test('the generator\'s own checks pass for 80 seeds: local conditions, two-stage preconditions, consistent folding', () => {
  for (let s = 1; s <= 80; s++) {
    const st = LF.generate(String(s)).stats;
    assert.ok(st.kawasakiMaxDeg < 1e-7, 'Kawasaki ' + s);
    assert.equal(st.maekawaFail, 0, 'Maekawa ' + s);
    assert.equal(st.oddFail, 0, 'crimp condition ' + s);
    assert.ok(st.mirrorMax < 1e-9, 'mirror rule ' + s);
    assert.equal(st.twoStage, true, 'two-stage preconditions ' + s);
    assert.ok(st.holonomy < 1e-9, 'folded positions agree ' + s);
    assert.ok(st.minSectorDeg >= LF.MIN_SECTOR, 'no sharp corners ' + s);
    assert.ok(st.bytes < 150 * 1024, 'file size ' + s);
  }
});

// ---------------------------------------------------------------- plotter facts
test('path length and pen lifts recomputed from the file match the reported ones; plot time estimate', () => {
  for (const seed of ['1', '42', '1234', 'hello-world']) {
    const { svg, stats } = gen(seed);
    const root = parseSvg(svg);
    let length = 0, lifts = 0, travel = 0;
    for (const g of root.children.filter((c) => c.name === 'g')) {
      let at = { x: 0, y: 0 };
      for (const p of g.children) {
        const pts = pointsOf(p.attrs.d);
        lifts++;
        travel += Math.hypot(pts[0].x - at.x, pts[0].y - at.y);
        for (let k = 1; k < pts.length; k++) length += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y);
        at = pts[pts.length - 1];
      }
      travel += Math.hypot(at.x, at.y);
    }
    assert.equal(lifts, stats.lifts);
    assert.ok(Math.abs(length - stats.length) < 0.002 * stats.length, 'length within rounding');
    const { draw, travel: tv, lift } = LF.PLOT;
    const minutes = (length / draw + travel / tv + lifts * lift) / 60;
    console.log(`  seed ${seed}: ${(length / 1000).toFixed(2)} m of line (black ${(stats.pen.black.draw / 1000).toFixed(2)}, red ${(stats.pen.red.draw / 1000).toFixed(2)}), ` +
      `${lifts} pen lifts, ${(travel / 1000).toFixed(2)} m pen-up travel, about ${minutes.toFixed(0)} min at ${draw} mm/s`);
  }
});

test('no dots: every stroke is at least 0.6 mm long', () => {
  for (const seed of SEEDS) {
    for (const s of strokes(parseSvg(gen(seed).svg))) {
      let L = 0;
      for (let k = 1; k < s.pts.length; k++) L += Math.hypot(s.pts[k].x - s.pts[k - 1].x, s.pts[k].y - s.pts[k - 1].y);
      assert.ok(L >= 0.6, `seed ${seed}: stroke of ${L.toFixed(2)} mm`);
    }
  }
});

// ---------------------------------------------------------------- speed and chunking
test('generation is quick, and the stepwise version never runs long between pauses', () => {
  LF.generate('warm-up');
  let worst = 0, worstStep = 0;
  for (let s = 1; s <= 60; s++) {
    const it = LF.steps(String(s));
    const t0 = performance.now();
    let last = t0;
    for (;;) {
      const r = it.next();
      const now = performance.now();
      worstStep = Math.max(worstStep, now - last);
      last = now;
      if (r.done) break;
    }
    worst = Math.max(worst, last - t0);
  }
  console.log(`  60 seeds: slowest ${worst.toFixed(0)} ms in all, longest stretch between pauses ${worstStep.toFixed(0)} ms`);
  assert.ok(worst < 2000);
  assert.ok(worstStep < 400);
});

// ---------------------------------------------------------------- the saved examples
test('the example SVGs are exactly what their seeds generate, and small', () => {
  const dir = path.join(here, 'examples');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.svg'));
  assert.ok(files.length >= 2 && files.length <= 3);
  for (const f of files) {
    const m = /^lies-flat-(.+)\.svg$/.exec(f);
    assert.ok(m, 'example named lies-flat-<seed>.svg: ' + f);
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(src.length < 150 * 1024, f + ' under 150 KB');
    assert.equal(src, LF.generate(m[1]).svg, f + ' matches its seed');
  }
});

// ---------------------------------------------------------------- pinned by the independent review
// Each test below would have failed on the version the reviewer checked.

// The left panel's segments, in page millimetres, with their pen colour.
function leftSegments(seed) {
  const { svg, stats } = gen(seed);
  const sp = stats.panels.sheet;
  const segs = [];
  for (const s of strokes(parseSvg(svg))) {
    if (!s.pts.every((q) => q.x <= sp.x + sp.w + 0.02)) continue;
    for (let k = 1; k < s.pts.length; k++) segs.push({ a: s.pts[k - 1], b: s.pts[k], pen: s.pen });
  }
  return segs;
}

test('the sheet size on the page counts the rows that are on the sheet, as read from the SVG', () => {
  for (const seed of [...SEEDS, '125']) {
    const st = gen(seed).stats;
    const segs = leftSegments(seed);
    // columns: distinct x of the vertical lines (column creases and the two side edges)
    const xs = [...new Set(segs.filter((s) => Math.abs(s.a.x - s.b.x) < 0.005).map((s) => s.a.x.toFixed(2)))].map(Number).sort((a, b) => a - b);
    assert.equal(xs.length - 1, st.columns, `seed ${seed}: columns`);
    // rows: zigzag edges crossing the first strip (interior row creases plus the top and bottom cut edges)
    const inStrip = segs.filter((s) => Math.abs(s.a.x - s.b.x) > 0.005 &&
      Math.min(s.a.x, s.b.x) >= xs[0] - 0.01 && Math.max(s.a.x, s.b.x) <= xs[1] + 0.01);
    assert.equal(inStrip.length - 1, st.rows, `seed ${seed}: rows of faces`);
    assert.equal(st.vertices, (st.columns - 1) * (st.rows - 1), `seed ${seed}: interior vertices`);
  }
  assert.equal(gen('125').stats.rows, 18, 'seed 125 is 18 x 18, not 18 x 21');
});

test('each pen is an Inkscape layer: AxiDraw and vpype number them 1 and 2, and AxiDraw pauses before red', () => {
  // AxiDraw (path_objects.LayerProperties.parse): a leading "!" forces a pause, then a leading integer is
  // the layer number. vpype (read): the label's digits are the layer ID.
  const axidraw = (label) => {
    const pause = label[0] === '!';
    const m = /^\d+/.exec(pause ? label.slice(1) : label);
    return { pause, number: m ? Number(m[0]) : null };
  };
  const vpype = (label) => Number(label.replace(/\D/g, ''));
  for (const seed of SEEDS) {
    const root = parseSvg(gen(seed).svg);
    assert.equal(root.attrs['xmlns:inkscape'], 'http://www.inkscape.org/namespaces/inkscape');
    const groups = root.children.filter((c) => c.name === 'g');
    assert.deepEqual(groups.map((g) => g.attrs['inkscape:groupmode']), ['layer', 'layer']);
    assert.deepEqual(groups.map((g) => g.attrs.stroke), LF.PENS.map((p) => p.colour), 'black first, then red');
    const labels = groups.map((g) => g.attrs['inkscape:label']);
    assert.deepEqual(labels.map(axidraw), [{ pause: false, number: 1 }, { pause: true, number: 2 }]);
    assert.deepEqual(labels.map(vpype), [1, 2]);
  }
});

test('the page names the vertex condition it checks: the crimp condition, not big-little-big', () => {
  const app = fs.readFileSync(path.join(here, 'app.js'), 'utf8');
  assert.match(app, /\['Crimp condition'/);
  assert.doesNotMatch(app, /Big–little–big/);
});

// One-vertex crimp reduction. Creases are { ang, t } (t: 1 mountain, 0 valley). Repeatedly find a
// sector no larger than either neighbour whose two creases differ, and fold it away: the two creases
// vanish and the neighbouring sectors merge into prev - it + next. The vertex folds flat if this ends
// with two creases of the same kind and equal sectors.
function crimpsFlat(creases) {
  const c = creases.slice().sort((p, q) => p.ang - q.ang);
  let t = c.map((x) => x.t);
  let s = c.map((x, k) => (k === c.length - 1 ? c[0].ang + 2 * Math.PI : c[k + 1].ang) - x.ang);
  while (t.length > 2) {
    const n = t.length;
    let k = -1;
    for (let j = 0; j < n && k < 0; j++) {
      if (s[j] <= s[(j + n - 1) % n] + 1e-9 && s[j] <= s[(j + 1) % n] + 1e-9 && t[j] !== t[(j + 1) % n]) k = j;
    }
    if (k < 0) return false;
    const nt = [], ns = [];
    for (let m = 0; m < n - 2; m++) {
      const idx = (k + 2 + m) % n;
      nt.push(t[idx]);
      ns.push(m === n - 3 ? s[(k + n - 1) % n] - s[k] + s[(k + 1) % n] : s[idx]);
    }
    t = nt; s = ns;
  }
  return t[0] === t[1] && Math.abs(s[0] - s[1]) < 1e-9;
}

test('every vertex has two equal smallest angles (so strict big-little-big does not apply) and crimps flat; controls fail', () => {
  const { vertexCreases, colType } = LF.internals;
  let n = 0;
  for (const seed of SEEDS) {
    const { mesh, edges: ed, design: d } = gen(seed);
    for (let r = ed.r0 + 1; r < ed.r1; r++) {
      for (let i = 1; i < mesh.C; i++) {
        const { creases, sectors } = vertexCreases(mesh, r, i);
        n++;
        const sorted = sectors.slice().sort((a, b) => a - b);
        assert.ok(sorted[1] - sorted[0] < 1e-9, 'the two smallest sectors are equal');
        assert.ok(sorted[2] - sorted[1] > 1e-3, 'and the other two are larger');
        const small = sectors.map((x, k) => (x - sorted[0] < 1e-9 ? k : -1)).filter((k) => k >= 0);
        assert.ok(small[1] - small[0] === 1 || (small[0] === 0 && small[1] === 3), 'the two smallest sectors are neighbours');
        const cs = creases.map((c) => ({ ang: c.ang, t: c.type }));
        assert.ok(crimpsFlat(cs), `seed ${seed}, vertex ${r},${i} crimps flat`);
        // control 1: flip the odd crease, making two of each kind (breaks Maekawa)
        const odd = cs.findIndex((c) => cs.filter((x) => x.t === c.t).length === 1);
        assert.equal(crimpsFlat(cs.map((c, k) => ({ ...c, t: k === odd ? 1 - c.t : c.t }))), false, 'control: 2-2 fails');
        // control 2: three of a kind still, but the odd crease is the column half between the two large sectors
        const shared = small[0] === 0 && small[1] === 3 ? 0 : small[1]; // crease between the two small sectors
        const maj = 1 - cs[odd].t;
        const isCol = (k) => creases[k].type === colType(d, i) && k !== odd;
        const other = [0, 1, 2, 3].find((k) => k !== shared && isCol(k) && Math.abs(Math.abs(creases[k].ang - creases[shared].ang) - Math.PI) < 1e-6);
        assert.ok(other !== undefined, 'found the opposite column half');
        assert.equal(crimpsFlat(cs.map((c, k) => ({ ...c, t: k === other ? 1 - maj : maj }))), false, 'control: odd crease on the large side fails');
      }
    }
  }
  console.log(`  ${n} vertices crimp flat; both controls fail at every one`);
});

test('the worst Kawasaki error read from the file is about 0.1 degrees (seed 129), as the README says', () => {
  const worst = Math.max(...['129', '31337', ...SEEDS].map((s) => checkFromSvg(s).kawasaki));
  const at129 = checkFromSvg('129').kawasaki;
  console.log(`  seed 129: ${at129.toFixed(3)} deg read from the file`);
  assert.ok(at129 >= 0.1 && at129 < 0.11, 'seed 129 is near 0.1 deg');
  assert.ok(worst < 0.11, 'no test seed is worse');
  const readme = fs.readFileSync(path.join(here, 'README.md'), 'utf8');
  assert.match(readme, new RegExp(`at most about 0\\.1° \\(${at129.toFixed(3)}° at seed 129`));
});

// ---------------------------------------------------------------- why rings: when does the strip close?
const ap = (M, p) => ({ x: M[0] * p.x + M[1] * p.y + M[4], y: M[2] * p.x + M[3] * p.y + M[5] });
// Folded corners of every face in band-row b.
function bandCorners(mesh, fold, b) {
  const pts = [];
  for (let i = 0; i < mesh.C; i++) for (const p of fold.quad(b, i)) pts.push(ap(fold.maps[fold.fid(b, i)], p));
  return pts;
}
const sameSet = (A, B, tol) => A.every((p) => B.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < tol)) &&
  B.every((p) => A.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < tol));
// For an evenly spaced closing design: after how many bands does the folded drawing repeat (n or 2n)?
// Built on a sheet five times as tall, so that the band exists.
function closesAfter(design, n) {
  const { buildMesh, chooseEdges, foldFaces } = LF.internals;
  const mesh = buildMesh({ ...design, H: design.H * 5 });
  const ed = chooseEdges(mesh);
  const fold = foldFaces(mesh, ed);
  const b0 = ed.r0 + 2, A = bandCorners(mesh, fold, b0);
  for (const m of [n, 2 * n]) if (sameSet(A, bandCorners(mesh, fold, b0 + m), 1e-6)) return m;
  return null;
}
// How far apart the strip's two ends land after 2n bands of a sheet with a gap gradient (in column widths).
function missAfter2n(res, n) {
  const { mesh, edges: ed, design: d } = res;
  const fold = LF.internals.foldFaces(mesh, ed);
  let off = 0;
  for (let i = 0; i < mesh.C; i++) {
    const Ma = fold.maps[fold.fid(ed.r0, i)], Mb = fold.maps[fold.fid(ed.r0 + 2 * n - 1, i)];
    for (const j of [i, i + 1]) {
      const a = ap(Ma, mesh.P[ed.r0][j]), b = ap(Mb, mesh.P[ed.r0 + 2 * n][j]);
      off = Math.max(off, Math.hypot(a.x - b.x, a.y - b.y));
    }
  }
  return off / (d.W / d.C);
}

test('why rings: seed 11 stops short of its star; seed 99999 closes; seed 77 winds round with its ends apart', () => {
  const s11 = gen('11');
  assert.equal(s11.stats.phi.closing, '13/3');
  assert.equal(s11.stats.rows, 20);
  assert.equal(closesAfter(s11.design, 13), 26, 'its star needs 26 rows');
  const s99 = LF.generate('99999');
  assert.equal(s99.stats.phi.closing, '9/2');
  assert.equal(s99.design.gapGrad, 0);
  assert.ok(s99.stats.rows >= 18);
  assert.ok(missAfter2n(s99, 9) < 1e-9, 'evenly spaced, 2n rows: the strip comes back exactly');
  {
    // and its folded sheet has 9-fold symmetry: turning it by 40 degrees about its centre maps it onto itself
    const { mesh, edges: ed } = s99;
    const fold = LF.internals.foldFaces(mesh, ed);
    const uniq = new Map();
    for (let b = ed.r0; b < ed.r1; b++) for (const p of bandCorners(mesh, fold, b)) uniq.set(p.x.toFixed(4) + ',' + p.y.toFixed(4), p);
    const pts = [...uniq.values()];
    const cx = pts.reduce((t, p) => t + p.x, 0) / pts.length, cy = pts.reduce((t, p) => t + p.y, 0) / pts.length;
    const turn = (a) => pts.map((p) => ({ x: cx + Math.cos(a) * (p.x - cx) - Math.sin(a) * (p.y - cy), y: cy + Math.sin(a) * (p.x - cx) + Math.cos(a) * (p.y - cy) }));
    assert.ok(sameSet(pts, turn((2 * Math.PI) / 9), 1e-6), '9-fold symmetry');
    assert.equal(sameSet(pts, turn((2 * Math.PI) / 10), 1e-6), false, 'control: not 10-fold');
  }
  const s77 = LF.generate('77');
  assert.equal(s77.stats.phi.closing, '7/2');
  assert.notEqual(s77.design.gapGrad, 0);
  assert.ok(s77.stats.rows >= 14);
  const miss = missAfter2n(s77, 7);
  assert.ok(miss > 0.03 && miss < 0.25, `gap gradient: the ends miss by ${(100 * miss).toFixed(1)}% of a column`);
});

test('why rings, over seeds 1-1000: the counts the README gives', () => {
  let closing = 0, longEnough = 0, exact = 0, whole = 0, missMin = Infinity, missMax = 0;
  for (let s = 1; s <= 1000; s++) {
    const res = LF.generate(String(s));
    const c = res.stats.phi.closing;
    if (!c) continue;
    closing++;
    const n = Number(c.split('/')[0]);
    const rows = res.stats.rows, even = res.design.gapGrad === 0;
    if (rows >= 2 * n) {
      longEnough++;
      if (even) exact++;
      else {
        const m = missAfter2n(res, n);
        missMin = Math.min(missMin, m); missMax = Math.max(missMax, m);
      }
    }
    if (even) {
      const after = closesAfter(res.design, n);
      assert.ok(after === n || after === 2 * n, `seed ${s}: the drawing repeats after n or 2n rows`);
      if (rows >= after) whole++;
    }
  }
  console.log(`  ${closing} closing designs; ${longEnough} with 2n rows or more; ${exact} close exactly; ${whole} draw a whole star; ` +
    `with a gap gradient the ends miss by ${(100 * missMin).toFixed(0)}-${(100 * missMax).toFixed(0)}% of a column`);
  assert.deepEqual([closing, longEnough, exact, whole], [332, 146, 82, 104]);
  assert.ok(missMin >= 0.035 && missMax <= 0.235, 'the ends miss by 4-23% of a column width');
  const readme = fs.readFileSync(path.join(here, 'README.md'), 'utf8');
  assert.match(readme, /332 have a closing angle and 146 of those have 2n rows or more\. Only the 82 /);
  assert.match(readme, /4–23% of a column's width/);
  assert.match(readme, /104 seeds in 1000 draw a whole star/);
});
