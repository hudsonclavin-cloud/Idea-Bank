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
    svg: ['xmlns', 'width', 'height', 'viewBox'],
    title: [], desc: [],
    g: ['id', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin'],
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
// find every vertex where four creases meet, and test Kawasaki, Maekawa and big-little-big there.
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
  let n = 0, kawasaki = 0, maekawaFail = 0, bigLittleFail = 0, other = 0;
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
    if (Math.min(sec[odd], sec[(odd + 3) % 4]) - mn > 0.25) bigLittleFail++;
  }
  return { n, kawasaki, maekawaFail, bigLittleFail, other, stats };
}

test('read back from the SVG: every four-crease vertex obeys Kawasaki, Maekawa and big-little-big', () => {
  for (const seed of SEEDS) {
    const r = checkFromSvg(seed);
    assert.equal(r.other, 0, 'no vertex has more than four creases');
    assert.equal(r.n, r.stats.vertices, 'the drawing has exactly the vertices the generator checked');
    assert.ok(r.kawasaki < 0.25, `Kawasaki from the file: worst ${r.kawasaki.toFixed(3)} deg`);
    assert.equal(r.maekawaFail, 0, 'Maekawa');
    assert.equal(r.bigLittleFail, 0, 'big-little-big');
    console.log(`  seed ${seed}: ${r.n} vertices; Kawasaki error ${r.kawasaki.toFixed(3)} deg read from the file, ` +
      `${r.stats.kawasakiMaxDeg.toExponential(1)} deg in double precision`);
  }
});

test('the generator\'s own checks pass for 80 seeds: local conditions, two-stage preconditions, consistent folding', () => {
  for (let s = 1; s <= 80; s++) {
    const st = LF.generate(String(s)).stats;
    assert.ok(st.kawasakiMaxDeg < 1e-7, 'Kawasaki ' + s);
    assert.equal(st.maekawaFail, 0, 'Maekawa ' + s);
    assert.equal(st.oddFail, 0, 'big-little-big ' + s);
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
