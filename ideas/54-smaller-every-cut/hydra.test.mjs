// Checks for Smaller Every Cut. Run from the repo root:
//   node --test ideas/54-smaller-every-cut/hydra.test.mjs
//
// hydra.js keeps hydras as ordinals in Cantor normal form. To avoid trusting it with
// its own report card, this file carries a second, deliberately plain model: a hydra
// is a nested array of children, cut exactly as Kirby and Paris describe, compared as
// ordinals by Goodstein's hereditary base-B evaluation (a different construction from
// the term-by-term comparison in hydra.js). The two are compared on every game below.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const H = require('./hydra.js');
const here = (p) => new URL(p, import.meta.url);
const README = fs.readFileSync(here('./README.md'), 'utf8');
const INDEX = fs.readFileSync(here('./index.html'), 'utf8');
const APP = fs.readFileSync(here('./app.js'), 'utf8');

/* ------------------------------------------------------------------ */
/* The plain model                                                     */
/* ------------------------------------------------------------------ */

// A tree is an array of child trees; a head is []. The body is the outermost array.
const clone = (t) => t.map(clone);
const canon = (t) => '(' + t.map(canon).sort().join('') + ')';

// Every head, as a list of child indices from the body.
function headPaths(t, pre = [], out = []) {
  t.forEach((c, i) => (c.length ? headPaths(c, pre.concat([i]), out) : out.push(pre.concat([i]))));
  return out;
}

// Kirby–Paris, cut number n: remove the head; if its parent P is not the body, the
// joint G below P gets n more copies of P (as it is after the cut).
function plainCut(body, path, n) {
  const b = clone(body);
  const chain = [b];
  for (const i of path) chain.push(chain[chain.length - 1][i]);
  const head = chain[chain.length - 1];
  assert.equal(head.length, 0, 'path must end at a head');
  const parent = chain[chain.length - 2];
  parent.splice(path[path.length - 1], 1);
  if (path.length >= 2) {
    // the copies go right after the original (trees are unordered; this order matches the page)
    const g = chain[chain.length - 3];
    const copies = [];
    for (let k = 0; k < n; k++) copies.push(clone(parent));
    g.splice(path[path.length - 2] + 1, 0, ...copies);
  }
  return b;
}

// Ordinal order on plain trees, straight from the definition of the reading: sort each
// joint's necks biggest first and compare the lists lexicographically.
const cmpMemo = new Map();
function plainCmp(a, b) {
  const ka = canon(a);
  const kb = canon(b);
  if (ka === kb) return 0;
  const key = ka + '|' + kb;
  if (cmpMemo.has(key)) return cmpMemo.get(key);
  const sa = a.slice().sort((x, y) => plainCmp(y, x));
  const sb = b.slice().sort((x, y) => plainCmp(y, x));
  let r = 0;
  for (let i = 0; i < Math.min(sa.length, sb.length) && !r; i++) r = plainCmp(sa[i], sb[i]);
  if (!r) r = sa.length - sb.length;
  r = Math.sign(r);
  if (cmpMemo.size > 200000) cmpMemo.clear();
  cmpMemo.set(key, r);
  return r;
}

const nodes = (t) => t.reduce((s, c) => s + 1 + nodes(c), 0);
const headsOf = (t) => t.reduce((s, c) => s + (c.length ? headsOf(c) : 1), 0);
const depthOf = (t) => t.reduce((d, c) => Math.max(d, 1 + depthOf(c)), 0);
const maxKids = (t) => t.reduce((m, c) => Math.max(m, maxKids(c)), t.length);

// Goodstein's hereditary base-B value: v(t) = sum over children of B^v(child). If B is larger
// than every multiplicity of identical children anywhere, v is strictly increasing in the
// ordinal, so it compares ordinals without any Cantor-normal-form code.
function baseVal(t, B) {
  let s = 0n;
  for (const c of t) {
    const e = baseVal(c, B);
    if (e > 200000n) throw new Error('too big for the base-B check');
    s += B ** e;
  }
  return s;
}

// The ordinal of a plain tree, built with hydra.js's constructor (only for comparing results).
const toOrd = (t) => H.fromTerms(t.map((c) => [toOrd(c), 1n]));

// Seeded random numbers.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function randomTree(r, size, maxDepth) {
  const body = [];
  const all = [{ t: body, d: 0 }];
  for (let k = 0; k < size; k++) {
    const options = all.filter((x) => x.d < maxDepth);
    const at = options[Math.floor(r() * options.length)];
    const child = [];
    at.t.push(child);
    all.push({ t: child, d: at.d + 1 });
  }
  return body;
}

const PRESET = Object.fromEntries(H.PRESETS.map((p) => [p.id, p]));

/* ------------------------------------------------------------------ */
/* 1. The rules: hydra.js cuts what the plain model cuts               */
/* ------------------------------------------------------------------ */

test('display-tree cuts, ordinal cuts and the plain model agree on random games', () => {
  const r = rng(54);
  let games = 0;
  let cuts = 0;
  for (let g = 0; g < 300; g++) {
    let plain = randomTree(r, 1 + Math.floor(r() * 6), 1 + Math.floor(r() * 3));
    let body = H.fromSpec(plain);
    let cnf = toOrd(plain);
    assert.equal(H.str(H.ordinalOf(body)), H.str(cnf));
    for (let n = 1; n <= 25 && plain.length; n++) {
      // choose a drawn head of the display tree, cut it everywhere
      const L = H.layout(body, { width: 4000, height: 600, minSlot: 1 });
      const hs = L.items.filter((it) => it.kind === 'head');
      if (H.heads(body) < 3000n) assert.equal(BigInt(hs.length), H.heads(body), 'every head is drawn when there is room');
      const it = hs[Math.floor(r() * hs.length)];
      // the same head in the plain model: follow the copy structure down
      let t = body;
      const plainPath = [];
      let pt = plain;
      for (let d = 0; d < it.path.length; d++) {
        // index of this copy among pt's children, in display order
        let k = 0;
        for (let gi = 0; gi < it.path[d]; gi++) k += Number(t.g[gi].m);
        k += Number(it.copies[d]);
        plainPath.push(k);
        t = t.g[it.path[d]].t;
        pt = pt[k];
      }
      assert.equal(pt.length, 0);
      const before = H.ordinalOf(body);
      const res = H.cut(body, it.path, it.copies, n, n);
      body = res.body;
      plain = plainCut(plain, plainPath, n);
      // the ordinal-only cut, on the head's path in the canonical form of the same tree
      cnf = toOrd(plain);
      assert.equal(H.str(H.ordinalOf(body)), H.str(cnf), 'display cut matches the plain model');
      assert.equal(H.heads(body), BigInt(headsOf(plain)));
      assert.equal(H.countNodes(body), BigInt(nodes(plain)));
      assert.ok(H.cmp(H.ordinalOf(body), before) < 0, 'the clock went down');
      cuts++;
    }
    games++;
  }
  assert.ok(games === 300 && cuts > 2000, `played ${games} games, ${cuts} cuts`);
});

test('every distinct cut of the ordinal form matches a cut of the plain model', () => {
  const r = rng(7);
  for (let g = 0; g < 200; g++) {
    const plain = randomTree(r, 1 + Math.floor(r() * 7), 1 + Math.floor(r() * 4));
    const a = toOrd(plain);
    const n = 1 + Math.floor(r() * 5);
    const fromPlain = new Set(headPaths(plain).map((p) => canon(plainCut(plain, p, n))));
    const fromCnf = new Set(H.leafPaths(a).map((p) => H.str(H.cnfCut(a, p, n))));
    const plainAsOrd = new Set([...fromPlain].map((c) => H.str(toOrd(parseCanon(c)))));
    assert.deepEqual([...fromCnf].sort(), [...plainAsOrd].sort());
  }
});

function parseCanon(s) {
  let i = 0;
  function tree() {
    assert.equal(s[i++], '(');
    const kids = [];
    while (s[i] === '(') kids.push(tree());
    assert.equal(s[i++], ')');
    return kids;
  }
  return tree();
}

/* ------------------------------------------------------------------ */
/* 2. The clock goes down, checked by a different construction         */
/* ------------------------------------------------------------------ */

test('hydra.js compares ordinals the way hereditary base-B values do', () => {
  const r = rng(11);
  let checked = 0;
  for (let k = 0; k < 3000; k++) {
    const a = randomTree(r, 1 + Math.floor(r() * 7), 1 + Math.floor(r() * 3));
    const b = randomTree(r, 1 + Math.floor(r() * 7), 1 + Math.floor(r() * 3));
    const B = BigInt(Math.max(maxKids(a), maxKids(b)) + 1);
    const va = baseVal(a, B);
    const vb = baseVal(b, B);
    const c = H.cmp(toOrd(a), toOrd(b));
    assert.equal(Math.sign(c), va < vb ? -1 : va > vb ? 1 : 0, `${canon(a)} vs ${canon(b)}`);
    if (va === vb) assert.equal(canon(a), canon(b), 'equal readings means the same shape');
    checked++;
  }
  assert.equal(checked, 3000);
});

test('every cut lowers the base-B value: all orders on Sprout, Fork and Stick', () => {
  // Explore every reachable position of the three small presets and check every cut.
  let edges = 0;
  for (const id of ['sprout', 'fork', 'stick']) {
    const seen = new Set();
    const stack = [{ t: PRESET[id].spec, n: 1 }];
    while (stack.length) {
      const { t, n } = stack.pop();
      const key = canon(t) + '@' + n;
      if (seen.has(key) || !t.length) continue;
      seen.add(key);
      for (const p of headPaths(t)) {
        const u = plainCut(t, p, n);
        const B = BigInt(Math.max(maxKids(t), maxKids(u)) + 1);
        assert.ok(baseVal(u, B) < baseVal(t, B), `${canon(t)} -> ${canon(u)} at cut ${n}`);
        edges++;
        stack.push({ t: u, n: n + 1 });
      }
    }
  }
  assert.ok(edges > 1000, `${edges} cuts checked`);
});

test('every cut of the two sticks, played the fast way, lowers the base-B value', () => {
  let t = PRESET.twosticks.spec;
  let n = 1;
  let a = toOrd(t);
  while (t.length) {
    // the fast way in the plain model: follow the biggest child (by base-B value) to a head
    const B0 = BigInt(maxKids(t) + 1);
    const path = [];
    let x = t;
    while (x.length) {
      let best = 0;
      for (let i = 1; i < x.length; i++) if (baseVal(x[i], B0) > baseVal(x[best], B0)) best = i;
      path.push(best);
      x = x[best];
    }
    const u = plainCut(t, path, n);
    const B = BigInt(Math.max(maxKids(t), maxKids(u)) + 1);
    assert.ok(baseVal(u, B) < baseVal(t, B));
    a = H.cnfCut(a, H.largestPath(a), n);
    assert.equal(H.str(a), H.str(toOrd(u)), 'hydra.js fast way = plain fast way');
    t = u;
    n++;
  }
  assert.equal(n - 1, 988, 'the fast way kills the two sticks in 988 cuts');
});

/* ------------------------------------------------------------------ */
/* 3. Exact counts, by exhaustive search in the plain model            */
/* ------------------------------------------------------------------ */

// Fewest and most cuts over every order, memoised on (shape, cut number).
function plainExtremes(spec) {
  const memo = new Map();
  function rec(t, n) {
    if (!t.length) return [0, 0];
    const key = canon(t) + '@' + n;
    if (memo.has(key)) return memo.get(key);
    let lo = Infinity;
    let hi = -Infinity;
    const done = new Set();
    for (const p of headPaths(t)) {
      const u = plainCut(t, p, n);
      const k = canon(u);
      if (done.has(k)) continue;
      done.add(k);
      const [a, b] = rec(u, n + 1);
      lo = Math.min(lo, a + 1);
      hi = Math.max(hi, b + 1);
    }
    const v = [lo, hi];
    memo.set(key, v);
    return v;
  }
  return rec(spec, 1);
}

test('Sprout, Fork and Stick: fastest and slowest over every order of cuts', () => {
  for (const id of ['sprout', 'fork', 'stick']) {
    const [lo, hi] = plainExtremes(PRESET[id].spec);
    assert.equal(BigInt(lo), PRESET[id].claims.fastest, id + ' fastest');
    assert.equal(BigInt(hi), PRESET[id].claims.slowest, id + ' slowest');
    const a = toOrd(PRESET[id].spec);
    assert.equal(H.fewestCuts(a, 1), BigInt(lo));
    assert.equal(H.mostCuts(a, 1), BigInt(hi));
    assert.equal(H.fastWay(a, 1).value, BigInt(lo), 'the fast way is the fastest');
    assert.equal(H.slowWay(a).value, BigInt(hi), 'the slow way is the slowest');
  }
  assert.deepEqual(plainExtremes([[[[]]]]), [20, 37]);
});

// Branch and bound in the plain model. Lower bound: every non-root node at depth d is
// worth n^(d-1) cuts at least (a cut at depth d >= 2 removes n^(d-1) and regrows n copies
// of a neck worth at least n^(d-2) each; a cut at depth 1 removes exactly 1).
function plainFewest(spec, upper) {
  const memo = new Map();
  const pot = (t, n) => {
    let s = 0;
    const rec = (x, w) => {
      for (const c of x) {
        s += w;
        rec(c, w * n);
      }
    };
    rec(t, 1);
    return s;
  };
  function rec(t, n, budget) {
    if (!t.length) return 0;
    const key = canon(t) + '@' + n;
    const m = memo.get(key);
    if (m && m.exact) return m.v;
    const lb = Math.max(pot(t, n), m ? m.v : 0);
    if (lb >= budget) return lb;
    let best = Infinity;
    const done = new Set();
    for (const p of headPaths(t)) {
      const u = plainCut(t, p, n);
      const k = canon(u);
      if (done.has(k)) continue;
      done.add(k);
      const v = 1 + rec(u, n + 1, Math.min(best, budget) - 1);
      if (v < best) best = v;
    }
    memo.set(key, best < budget ? { exact: true, v: best } : { exact: false, v: Math.max(lb, best) });
    return best;
  }
  return rec(spec, 1, upper + 1);
}

test('hydra.js\'s branch and bound agrees with the plain search on random small hydras', () => {
  const r = rng(77);
  let compared = 0;
  for (let k = 0; k < 60; k++) {
    const t = randomTree(r, 1 + Math.floor(r() * 5), 1 + Math.floor(r() * 3));
    const a = toOrd(t);
    const fw = H.fastWay(a, 1);
    if (fw.value > 300n) continue;
    const plain = plainFewest(t, Number(fw.value));
    assert.equal(H.fewestCuts(a, 1, 1e6), BigInt(plain), canon(t));
    compared++;
  }
  assert.ok(compared >= 40, `${compared} hydras compared`);
});

test('Two sticks: no order of cuts is faster than 988', { timeout: 600000 }, () => {
  const a = toOrd(PRESET.twosticks.spec);
  assert.equal(PRESET.twosticks.claims.fastest, 988n);
  assert.equal(H.fastWay(a, 1).value, 988n);
  // the plain model's fast way also takes 988 (checked cut by cut above); this is the
  // exhaustive part, in hydra.js (about 40 s)
  assert.equal(H.fewestCuts(a, 1, 5e6), 988n);
});

/* ------------------------------------------------------------------ */
/* 4. Fundamental sequences, the slow way and Hardy functions          */
/* ------------------------------------------------------------------ */

// The fundamental sequence on plain trees, written from the hydra picture:
// take the smallest child c of the body. If c is a head, drop it. If c's smallest child is a
// head (c = b + 1), replace c by n copies of c-without-that-head. Otherwise recurse into c.
function treeFs(t, n) {
  const kids = t.map(clone);
  // smallest child (ties: any, since equal readings are equal shapes)
  let s = 0;
  for (let i = 1; i < kids.length; i++) if (plainCmp(kids[i], kids[s]) < 0) s = i;
  const c = kids[s];
  if (!c.length) {
    kids.splice(s, 1);
    return kids;
  }
  let cs = 0;
  for (let i = 1; i < c.length; i++) if (plainCmp(c[i], c[cs]) < 0) cs = i;
  if (!c[cs].length) {
    const shorter = c.slice();
    shorter.splice(cs, 1);
    kids.splice(s, 1);
    for (let k = 0; k < n; k++) kids.push(clone(shorter));
    return kids;
  }
  kids[s] = treeFs(c, n);
  return kids;
}

// Hardy's H_a(n) = H_{a[n]}(n+1), H_0(n) = n, straight from the definition.
function plainHardy(spec, n, limit) {
  let t = spec;
  let m = n;
  while (t.length) {
    t = treeFs(t, m);
    m++;
    if (m - n > limit) return null;
  }
  return m;
}

test('the fundamental sequences of hydra.js are the hydra-picture ones', () => {
  const r = rng(3);
  for (let k = 0; k < 400; k++) {
    const t = randomTree(r, 1 + Math.floor(r() * 7), 1 + Math.floor(r() * 3));
    const n = Math.floor(r() * 6);
    assert.equal(H.str(H.fs(toOrd(t), n)), H.str(toOrd(treeFs(t, n))));
    if (n > 0) assert.ok(H.cmp(H.fs(toOrd(t), n), toOrd(t)) < 0);
  }
});

test('the slow way moves the clock from a to a[n+1] on cut n, and lasts H_a(2) - 2 cuts', () => {
  const r = rng(99);
  let compared = 0;
  for (let k = 0; k < 250; k++) {
    const t = randomTree(r, 1 + Math.floor(r() * 6), 1 + Math.floor(r() * 3));
    let a = toOrd(t);
    let n = 1;
    let display = H.fromSpec(t);
    while (a.length && n < 1500) {
      const next = H.cnfCut(a, H.smallestPath(a), n);
      assert.equal(H.str(next), H.str(H.fs(a, n + 1)));
      const p = H.pick(display, 'slow');
      display = H.cut(display, p.path, p.copies, n, n).body;
      assert.equal(H.str(H.ordinalOf(display)), H.str(next), 'the page’s slow way is the same');
      a = next;
      n++;
    }
    if (!a.length) {
      const plain = plainHardy(t, 2, 1e6);
      assert.equal(BigInt(n - 1), BigInt(plain - 2), canon(t));
      assert.equal(H.slowWay(toOrd(t)).value, BigInt(n - 1));
      compared++;
    }
  }
  assert.ok(compared > 80, `${compared} games played to the end`);
});

test('Hardy values: hydra.js against the definition, and the closed forms used in the floors', () => {
  const cases = ['1', '5', 'w', 'w+3', 'w*2', 'w*3+1', 'w^2', 'w^2+w', 'w^2*2', 'w^(w)', 'w^3'];
  for (const s of cases) {
    const a = H.parse(s);
    for (let n = 1; n <= 4; n++) {
      const h = H.hardy(a, n);
      const spec = fromOrd(a);
      const p = plainHardy(spec, n, 3000);
      if (p === null) continue;
      assert.equal(h, BigInt(p), `H_${s}(${n})`);
    }
  }
  for (let n = 1n; n <= 40n; n++) {
    assert.equal(H.hardy(H.parse('w'), n), 2n * n + 1n);
    for (let k = 1n; k <= 5n; k++) assert.equal(H.hardy(H.parse('w*' + k), n), 2n ** k * (n + 1n) - 1n);
    assert.equal(H.hardy(H.parse('w^2'), n), 2n ** n * (n + 2n) - 1n);
  }
  // (1) H_{g+d}(x) = H_g(H_d(x)) for normal-form sums
  for (const [g, d] of [['w^2', 'w'], ['w^2', '3'], ['w*2', 'w'], ['w^(w)', 'w^2'], ['w^3', 'w^2*2']]) {
    for (let x = 1n; x <= 3n; x++) {
      const whole = H.hardy(H.parse(g + '+' + d), x);
      const inner = H.hardy(H.parse(d), x);
      if (whole === null || inner === null) continue;
      assert.equal(whole, H.hardy(H.parse(g), inner));
    }
  }
  assert.equal(H.hardy(H.parse('w^(w)'), 2n), 39n);
  assert.equal(H.hardy(H.parse('w^3'), 2n), 22539988369407n); // 2^39 * 41 - 1
});

function fromOrd(a) {
  const out = [];
  for (const [e, c] of a) for (let k = 0n; k < c; k++) out.push(fromOrd(e));
  return out;
}

/* ------------------------------------------------------------------ */
/* 5. The fast way in batches, and the tall stick                      */
/* ------------------------------------------------------------------ */

test('the batched fast way equals a cut-by-cut fast way', () => {
  const r = rng(5);
  let compared = 0;
  for (let k = 0; k < 300; k++) {
    const t = randomTree(r, 1 + Math.floor(r() * 7), 1 + Math.floor(r() * 4));
    const a = toOrd(t);
    const sim = H.play(a, H.largestPath, 1, 50000);
    if (sim === null) continue;
    assert.equal(H.fastWay(a, 1).value, sim, canon(t));
    // and the display tree's fast way agrees with the ordinal one, for short games
    if (sim < 400n) {
      let body = H.fromSpec(t);
      let n = 1;
      while (body.g.length) {
        const p = H.pick(body, 'fast');
        body = H.cut(body, p.path, p.copies, n, n).body;
        n++;
      }
      assert.equal(BigInt(n - 1), sim);
    }
    compared++;
  }
  assert.ok(compared > 150, `${compared} hydras compared`);
});

// The fast way on omega^k (one neck carrying k heads) from cut t, level by level:
// all c copies of omega^j are cut on consecutive cuts s, each leaving s+1 copies of omega^(j-1).
function levelCount(k, t) {
  // (for c < 100000 the sum is added up term by term; above that, the closed form)
  let c = BigInt(t) + 1n;
  let s = BigInt(t) + 1n;
  let total = 1n + c;
  for (let j = 1; j < k; j++) {
    let made = 0n;
    for (let q = 0n; q < c && q < 100000n; q++) made += s + q + 1n;
    if (c >= 100000n) made = c * (s + 1n) + (c * (c - 1n)) / 2n;
    s += c;
    c = made;
    total += c;
  }
  return total;
}

test('the tall stick, the fast way: five cuts to omega^15, then a 13,597-digit count', () => {
  // the closed form for the sum, against adding it up
  for (const [c, s] of [[1n, 1n], [7n, 4n], [999n, 123n], [4081n, 91n]]) {
    let sum = 0n;
    for (let q = 0n; q < c; q++) sum += s + q + 1n;
    assert.equal(sum, c * (s + 1n) + (c * (c - 1n)) / 2n);
  }
  // the level formula against cut-by-cut play
  for (let k = 1; k <= 4; k++) {
    for (let t = 1; t <= 4; t++) {
      const a = [[H.nat(k), 1n]];
      assert.equal(levelCount(k, t), H.play(a, H.largestPath, t, 2e6), `omega^${k} from cut ${t}`);
    }
  }
  // the first five cuts in the plain model
  let t = PRESET.tall.spec;
  for (let n = 1; n <= 5; n++) {
    const B0 = BigInt(maxKids(t) + 1);
    const path = [];
    let x = t;
    while (x.length) {
      let best = 0;
      for (let i = 1; i < x.length; i++) if (baseVal(x[i], B0) > baseVal(x[best], B0)) best = i;
      path.push(best);
      x = x[best];
    }
    t = plainCut(t, path, n);
  }
  assert.equal(canon(t), canon([Array.from({ length: 15 }, () => [])]), 'one neck with 15 heads');
  const total = 5n + levelCount(15, 6);
  const got = H.fastWay(toOrd(PRESET.tall.spec), 1);
  assert.equal(got.kind, 'exact');
  assert.equal(got.value, total);
  assert.equal(String(total).length, PRESET.tall.claims.fastDigits);
  assert.equal(String(total).length, 13597);
});

/* ------------------------------------------------------------------ */
/* 6. Floors under the slow way                                         */
/* ------------------------------------------------------------------ */

// Knuth arrows for tiny arguments, to check H_{w^3}(x) >= 2^^(x+1), H_{w^4}(x) >= 2^^^(x+1).
test('the floor lemmas hold where they can be computed', () => {
  // H_{w^2}(x) = 2^x (x+2) - 1 >= 2^x, and iterating gives the towers, for x >= 1.
  // At x = 0 the x-fold iterate in (2) is the identity, and the tower floors fail:
  assert.equal(H.hardy(H.parse('w^3'), 0n), 1n); // < 2^^1 = 2
  assert.equal(H.hardy(H.parse('w^4'), 0n), 1n); // < 2^^^1 = 2
  assert.equal(H.hardy(H.parse('w^2'), 0n), 1n); // < 2^1, the base of the arrow lemma
  assert.ok(H.hardy(H.parse('w^(w+1)'), 0n) < H.hardy(H.parse('w^(w)'), 1n)); // (2) fails at 0
  assert.ok(H.hardy(H.parse('w^3'), 1n) >= 2n ** 2n); // 15 >= 2^^2 = 4
  assert.ok(H.hardy(H.parse('w^3'), 2n) >= 2n ** 2n ** 2n); // 22539988369407 >= 2^^3 = 16
  assert.ok(H.hardy(H.parse('w^4'), 1n) >= 4n); // >= 2^^^2 = 4
  // the base of the arrow lemma: H_{w^2}(x) >= 2^(x+1)
  for (let x = 1n; x <= 60n; x++) assert.ok(H.hardy(H.parse('w^2'), x) >= 2n ** (x + 1n));
  // (2) H_{w^(b+1)}(x) = H_{w^b}^x(x+1)
  for (const b of ['1', '2', 'w']) {
    for (let x = 1n; x <= 2n; x++) {
      const lhs = H.hardy(H.parse('w^(' + b + '+1)'), x);
      if (lhs === null) continue;
      let y = x + 1n;
      for (let k = 0n; k < x; k++) y = H.hardy(H.parse('w^(' + b + ')'), y);
      assert.equal(lhs, y);
    }
  }
});

// An independent walk of the floor chain, on plain trees: exponent e at argument m.
// Each step uses (2) for a successor exponent (drop one head, argument + 1) or (3) for a limit
// exponent (take its fundamental sequence at the argument, argument + 1), until the exponent
// is a whole number; from k > 4 down to 4 costs k - 4 more.
function plainChain(eSpec, m) {
  let e = eSpec;
  let x = m;
  const finite = (t) => t.every((c) => !c.length);
  while (!finite(e)) {
    const h = e.findIndex((c) => !c.length);
    if (h >= 0) e = e.slice(0, h).concat(e.slice(h + 1));
    else e = treeFs(e, x);
    x += 1;
  }
  if (e.length > 4) {
    x += e.length - 4;
    return { k: 4, x };
  }
  return { k: e.length, x };
}

test('the floors for the two sticks and the tall stick', () => {
  // two sticks: H_{w^w * 2}(2) = H_{w^w}(H_{w^w}(2)) = H_{w^w}(39)
  assert.equal(H.hardy(H.parse('w^(w)'), 2n), 39n);
  const two = plainChain([[[]]], 39); // exponent omega, at 39
  assert.deepEqual(two, { k: 4, x: 75 });
  const s2 = H.slowWay(toOrd(PRESET.twosticks.spec));
  assert.equal(s2.kind, 'floor');
  assert.equal(s2.arrows, 3);
  assert.equal(s2.height, 76n);
  assert.deepEqual(PRESET.twosticks.claims.slowFloor, { arrows: 3, height: 76n });
  // tall stick: exponent omega^omega, at 2
  const tall = plainChain([[[[]]]], 2);
  assert.deepEqual(tall, { k: 4, x: 35 });
  const s4 = H.slowWay(toOrd(PRESET.tall.spec));
  assert.equal(s4.kind, 'floor');
  assert.equal(s4.arrows, 3);
  assert.equal(s4.height, 36n);
  assert.deepEqual(PRESET.tall.claims.slowFloor, { arrows: 3, height: 36n });
});

/* ------------------------------------------------------------------ */
/* 7. The picture                                                       */
/* ------------------------------------------------------------------ */

test('layout: inside the canvas, unique keys, every drawn head is a real head', () => {
  const r = rng(21);
  for (let k = 0; k < 200; k++) {
    const t = randomTree(r, 1 + Math.floor(r() * 20), 1 + Math.floor(r() * 6));
    let body = H.fromSpec(t);
    const n = Math.floor(r() * 30);
    for (let c = 1; c <= n && body.g.length; c++) {
      const p = H.pick(body, r() < 0.5 ? 'fast' : 'slow');
      body = H.cut(body, p.path, p.copies, c, c).body;
    }
    for (const w of [358, 900]) {
      const L = H.layout(body, { width: w, height: 420, padX: 14, minSlot: 17 });
      const keys = new Set();
      for (const it of L.items) {
        assert.ok(!keys.has(it.key), 'unique key');
        keys.add(it.key);
        assert.ok(Number.isFinite(it.x) && Number.isFinite(it.y));
        assert.ok(it.x >= 0 && it.x <= w && it.y >= 0 && it.y <= 420, 'inside the canvas');
        let node = body;
        for (let d = 0; d < it.path.length; d++) {
          assert.ok(it.copies[d] < node.g[it.path[d]].m);
          node = node.g[it.path[d]].t;
        }
        assert.equal(it.kind === 'head', node.g.length === 0 && it.kind !== 'body');
      }
    }
  }
});

test('a cut keeps the shortened neck in place and marks only the regrowth as new', () => {
  let body = H.fromSpec(PRESET.stick.spec);
  const L0 = H.layout(body, { width: 400, height: 400 });
  const head = L0.items.find((it) => it.kind === 'head');
  const res = H.cut(body, head.path, head.copies, 1, 7);
  body = res.body;
  const L1 = H.layout(body, { width: 400, height: 400 });
  const parentKey = head.parentKey;
  const kept = L1.items.find((it) => it.key === parentKey);
  assert.ok(kept, 'the neck that lost its head keeps its key');
  assert.equal(kept.kind, 'head');
  assert.equal(L1.items.filter((it) => it.fresh === 7).length, 1, 'one regrown copy on cut 1');
});

/* ------------------------------------------------------------------ */
/* 8. Safety: one gate for every change to the picture                 */
/* ------------------------------------------------------------------ */

// The real checks are in ui.test.mjs, which measures the rendered canvas pixel by pixel under
// held keys, fast taps, mashed buttons and Hercules. This one pins the structure that makes
// them pass, so a change to app.js that bypasses the gate is caught without a browser.
test('the picture is replaced at most twice a second, whatever the input (static check of app.js and style.css)', () => {
  const m = APP.match(/SAFE = Object\.freeze\(\{([^}]*)\}\)/);
  assert.ok(m, 'SAFE constants present');
  const get = (k) => Number(new RegExp(k + ':\\s*([\\d.]+)').exec(m[1])[1]);
  // At most two replacements of the picture a second; animated auto-play no faster than that;
  // a cut's cross-fade ends before the next replacement may start.
  assert.ok(get('PICTURE_HZ') <= 2);
  assert.ok(get('MAX_TWEENED_RATE') <= get('PICTURE_HZ'));
  assert.ok(get('TWEEN_MS') >= 300 && get('TWEEN_MS') < 1000 / get('PICTURE_HZ'));
  // No free-running timers: Hercules's cuts and snapshots both wait for the gate.
  assert.doesNotMatch(APP, /setInterval\(/);
  assert.equal((APP.match(/if \(!gateFree\(\)\)/g) || []).length, 1, 'animated auto-play waits for the gate');
  assert.match(APP, /if \(gateFree\(\) && \(a\.done > a\.shownDone \|\| dead\)\)/);
  // Every replacement is logged by relayout, except a resize (the ResizeObserver's one call).
  assert.match(APP, /function relayout\(animate, resize\) \{\n\s*if \(!resize\) markChange\(\);/);
  assert.equal((APP.match(/relayout\(false, true\)/g) || []).length, 1);
  // Inputs: a held Enter or Space cuts once; taps, keys and picture-changing buttons go through
  // request(); stopping Hercules changes nothing on screen.
  assert.match(APP, /if \(ev\.repeat\) return; \/\/ holding the key down cuts once/);
  assert.doesNotMatch(APP, /addEventListener\('click', (undo\)|\(\) => (loadPreset|startAuto))/);
  for (const call of ['move(() => cutAt(it.path, it.copies))', 'move(() => sproutAt(it))', "request('undo', undo)", "request('load', () => loadPreset(b.dataset.preset))", "request('restart', () => {", "request('clear', () => {", "request('fight', () => {", "request('labels', () => {", "request('now', () => startAuto("]) {
    assert.ok(APP.includes(call), call);
  }
  const kinds = [...APP.matchAll(/request\('(\w+)'/g)].map((x) => x[1]);
  assert.deepEqual([...new Set(kinds)].sort(), ['clear', 'fight', 'labels', 'load', 'move', 'now', 'restart', 'undo']);
  // Nothing piles up behind the gate: at most one request of each kind waits (a newer one takes
  // its place, and Undo clicks add up their steps), and a new hydra drops what would act on the
  // old one. (Every click used to queue, so a held Enter on Start over left 55 waiting.)
  const request = APP.slice(APP.indexOf('  function request(kind, fn) {'), APP.indexOf('  function pump() {'));
  assert.match(request, /gate\.queue = gate\.queue\.filter\(\(r\) => r\.kind !== kind && !drop\.includes\(r\.kind\)\);\n\s*gate\.queue\.push\(\{ kind, fn, steps: kind === 'undo' && old \? old\.steps \+ 1 : 1 \}\);/);
  assert.match(APP, /const DROPS = \{ load: \['move', 'undo', 'now', 'restart', 'clear', 'fight'\], restart: \['move', 'undo', 'now'\] \};/);
  assert.match(APP, /head\.fn\(head\.steps\);/);
  // Undo: one clicked while a cut or sprout waits cancels it. No button acts on a held Enter's
  // repeats, except that Undo goes on at the gate's pace (a repeat adds none while one waits).
  assert.doesNotMatch(APP, /request\('move', undo\)/);
  const undoClick = APP.slice(APP.indexOf('function undoClick()'), APP.indexOf("$('restart')"));
  assert.match(undoClick, /if \(waiting\('move'\)\) \{\n\s*cancel\('move'\);/);
  assert.match(undoClick, /if \(!ev\.repeat \|\| ev\.key !== 'Enter' \|\| !\(ev\.target instanceof Element\) \|\| !ev\.target\.closest\('button'\)\) return;\n\s*ev\.preventDefault\(\);\n\s*if \(ev\.target\.closest\('#undo, #growUndo'\) && !waiting\('undo'\)\) undoClick\(\);\n\s*\},\n\s*true\n/);
  // The selection ring, the one thing drawn outside the gate, moves on its own at most RING_HZ
  // times a second: draw() reads the ring as drawn, and the mouse and the arrow keys only ask
  // it to move (ringUpdate), never redraw themselves.
  assert.ok(get('RING_HZ') <= 4);
  assert.match(APP, /const RING_MS = 1000 \/ SAFE\.RING_HZ;/);
  assert.match(APP, /const wait = ring\.last \+ RING_MS - performance\.now\(\);/);
  assert.match(APP, /if \(!resize\) ringSync\(\);/);
  // Whether the ring shows (it hides while Hercules plays) is part of the ring, under the same
  // limit: draw() used to read state.auto, so switching Hercules on and off blinked the ring.
  assert.match(APP, /ring\.hidden = !!state\.auto;/);
  assert.match(APP, /if \(ring\.hover === state\.hover && ring\.sel === state\.sel && ring\.hidden === !!state\.auto\) return;/);
  const drawFn = APP.slice(APP.indexOf('  function draw(now) {'), APP.indexOf('  function neckPath('));
  assert.doesNotMatch(drawFn, /state\.(hover|sel|auto)\b/);
  assert.match(drawFn, /ring\.hover/);
  assert.match(drawFn, /&& !ring\.hidden\) \{/);
  // A ring is drawn at full size even round a growing head, so the ring itself never moves.
  assert.match(drawFn, /ctx\.arc\(d\.x, d\.y, headR \+ 4, 0, 2 \* Math\.PI\);/);
  assert.doesNotMatch(drawFn, /r \+ 4/);
  for (const fn of ['function startAuto(', 'function stopAuto(']) {
    const body = APP.slice(APP.indexOf(fn), APP.indexOf('\n  }\n', APP.indexOf(fn)));
    assert.match(body, /ringUpdate\(\);/, fn);
  }
  // In Grow your own the selection counts the body and joints too, so the head loop rings a
  // head only in play mode (it used to ring heads[sel] as well as the body or joint picked).
  assert.match(drawFn, /const selKey = play && ring\.sel >= 0/);
  assert.match(drawFn, /\(\(play && ring\.hover === it\.key\) \|\| selKey === it\.key\)/);
  const inputs = APP.slice(APP.indexOf("canvas.addEventListener('pointermove'"), APP.indexOf('// Every button that changes the picture'));
  assert.doesNotMatch(inputs, /draw\(\)/);
  assert.equal((inputs.match(/ringUpdate\(\);/g) || []).length, 3);
  const stop = APP.slice(APP.indexOf('function stopAuto()'), APP.indexOf('function updateAutoButtons()'));
  assert.doesNotMatch(stop, /relayout\(|draw\(/);
  // No CSS animations or blinking.
  const CSS = fs.readFileSync(here('./style.css'), 'utf8');
  assert.doesNotMatch(CSS, /@keyframes|animation:(?!\s*none)|text-decoration:\s*blink/);
  // The speed menu offers nothing animated above the limit (values 1 and 2); the rest snapshot.
  const opts = [...INDEX.matchAll(/<option value="(\d+)"/g)].map((x) => Number(x[1]));
  assert.deepEqual(opts, [1, 2, 30, 1000, 0]);
});

/* ------------------------------------------------------------------ */
/* 9. The words match the numbers                                       */
/* ------------------------------------------------------------------ */

test('README and page state the numbers the tests compute', () => {
  for (const doc of [README, INDEX]) {
    assert.match(doc, /988/);
    assert.match(doc, /13,597/);
    assert.match(doc, /2↑↑↑76/);
    assert.match(doc, /2↑↑↑36/);
  }
  assert.match(INDEX, /<td>Stick<\/td><td class="math">ω<sup>ω<\/sup><\/td><td>20<\/td><td>37<\/td>/);
  assert.match(INDEX, /<td>Fork<\/td><td class="math">ω<sup>2<\/sup><\/td><td>10<\/td><td>13<\/td>/);
  assert.match(INDEX, /<td>Sprout<\/td><td class="math">ω<\/td><td>3<\/td><td>3<\/td>/);
  assert.match(README, /20 to 37|20–37/);
});

test('README and page state the safety rule and the floor conditions as they now hold', () => {
  // (The README's revision note quotes the old wording, so it is left out here.)
  const BODY = README.slice(0, README.indexOf('## Revision note'));
  // The rule as it holds: every input, at most twice a second; no claim that nothing flashes.
  assert.match(INDEX, /the hydra picture changes at most twice a second/);
  assert.match(BODY, /the hydra picture changes at most twice a second/);
  for (const doc of [BODY, INDEX]) {
    assert.doesNotMatch(doc, /nothing on this page flashes/i);
    assert.doesNotMatch(doc, /each pixel moves once/);
  }
  assert.doesNotMatch(APP, /every pixel\s+\*?\s*moves in a straight line/);
  // The selection ring: not the old bound (its outlines blinked over far more); it has a limit.
  assert.doesNotMatch(BODY, /selection ring \(under 400 px²\)/);
  for (const doc of [BODY, INDEX]) assert.match(doc, /moves at most 4 times a second/);
  // ... and showing or hiding it counts as a move (it used to blink as Hercules went on and off).
  assert.match(BODY, /appearing or disappearing counts as a move/);
  assert.match(INDEX, /showing or hiding it \(it hides while Hercules plays\) counts as a move/);
  // Nothing piles up at the gate, and no button acts on a held Enter's repeats.
  assert.match(BODY, /at most one request of each kind waits/);
  assert.match(BODY, /a held Enter on a button acts once/);
  assert.match(INDEX, /a held Enter on a button acts once/);
  // Undo: every click counts; one clicked while a cut waits cancels it.
  assert.match(BODY, /three quick clicks undo three steps/);
  assert.match(INDEX, /Undo cancels a cut that is still waiting/);
  // The floor facts hold for x >= 1 (they fail at x = 0); every argument used is at least 2.
  const floors = README.slice(README.indexOf('**Floors under the slow way.**'), README.indexOf('### The page'));
  const fact = (k) => floors.split('\n').find((l) => l.startsWith(k + '. '));
  assert.match(fact(2), /for \*x\* ≥ 1/);
  assert.match(fact(4), /for \*x\* ≥ 1/);
  assert.match(floors, /for every \*k\* ≥ 2 and \*x\* ≥ 1/);
  // Kirby–Paris: what PA can't prove is about computable strategies.
  assert.doesNotMatch(BODY, /whatever Hercules does/i);
  assert.match(BODY, /every hydra dies, whatever computable strategy Hercules follows/);
  // Matoušek and Loebl recall the short and long strategies; their result is the helper's.
  assert.doesNotMatch(BODY, /Matoušek and Loebl \(1991\) show that Hercules has/);
  assert.match(BODY, /As Matoušek and Loebl \(1991\) recall/);
  assert.doesNotMatch(INDEX, /731–741\. Hercules has a short strategy/);
});
