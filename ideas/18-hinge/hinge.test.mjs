// Run from the repo root: node --test ideas/18-hinge/hinge.test.mjs
// Checks the engine against closed forms, against an independent Monte Carlo with a
// different generator, and recomputes the built-in examples' headline numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import H from './js/hinge.js';
import EXAMPLES from './js/examples.js';

const Z95 = 1.6448536269514722;

// ---------------------------------------------------------------- independent helpers

/** Φ(x) by Abramowitz & Stegun 7.1.26 (error < 1.5e-7): independent of the engine's Hart algorithm. */
function PhiIndep(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}
const phi = (z) => Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);
const Phi = (z) => H.normCdf(z);
const PhiInv = (p) => H.normQuantile(p);

/** E[max(N(m, s), 0)] */
const expMaxNormal = (m, s) => m * Phi(m / s) + s * phi(m / s);

/** E[Z | Z in equal-probability slice g of G] for a standard normal. */
function sliceMeanZ(g, G) {
  const a = g === 0 ? -Infinity : PhiInv(g / G);
  const b = g === G - 1 ? Infinity : PhiInv((g + 1) / G);
  return G * ((isFinite(a) ? phi(a) : 0) - (isFinite(b) ? phi(b) : 0));
}

/** E[X | u in slice g] for a lognormal(mu, sigma): G * E[X; slice]. */
function sliceMeanLognormal(g, G, mu, sigma) {
  const a = g === 0 ? -Infinity : PhiInv(g / G);
  const b = g === G - 1 ? Infinity : PhiInv((g + 1) / G);
  return G * Math.exp(mu + sigma * sigma / 2) * (Phi(b - sigma) - Phi(a - sigma));
}

/** The fraction of a normal variable's variance retained by G equal-probability slices. */
function sliceFactor(G) {
  let s = 0;
  for (let g = 0; g < G; g++) s += sliceMeanZ(g, G) ** 2;
  return s / G;
}

const lnParams = (lo, hi) => ({ mu: (Math.log(lo) + Math.log(hi)) / 2, sigma: (Math.log(hi) - Math.log(lo)) / (2 * Z95) });
const lnMean = (lo, hi) => { const { mu, sigma } = lnParams(lo, hi); return Math.exp(mu + sigma * sigma / 2); };
const nParams = (lo, hi) => ({ mu: (lo + hi) / 2, sigma: (hi - lo) / (2 * Z95) });

/** xoshiro128**: a different generator from the engine's mulberry32. */
function xoshiro(seed) {
  let a = seed | 0 || 1, b = 0x9e3779b9, c = 0x6a09e667, d = 0xbb67ae85;
  const rotl = (x, k) => (x << k) | (x >>> (32 - k));
  return () => {
    const r = Math.imul(rotl(Math.imul(b, 5), 7), 9) >>> 0;
    const t = b << 9;
    c ^= a; d ^= b; b ^= c; a ^= d; c ^= t; d = rotl(d, 11);
    return r / 4294967296;
  };
}
function gaussian(rand) {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
/** Independent sampler for a row, with plain (non-stratified) sampling. */
function sampler(row, rand) {
  if (row.kind === 'fixed') return () => row.value;
  if (row.kind === 'chance') return () => (rand() < row.p ? 1 : 0);
  const shape = H.rangeShape(row.lo, row.hi, row.shape);
  if (shape === 'uniform') return () => row.lo + rand() * (row.hi - row.lo);
  if (shape === 'lognormal') { const { mu, sigma } = lnParams(row.lo, row.hi); return () => Math.exp(mu + sigma * gaussian(rand)); }
  const { mu, sigma } = nParams(row.lo, row.hi);
  return () => mu + sigma * gaussian(rand);
}

const row = (name, kind, extra) => ({ id: `id_${name}`, name, kind, ...extra });
const range = (name, lo, hi, shape) => row(name, 'range', { lo, hi, shape: shape || 'auto' });
const chance = (name, p) => row(name, 'chance', { p });
const fixed = (name, value) => row(name, 'fixed', { value });
const formula = (name, expr) => row(name, 'formula', { expr });
const opt = (name, expr) => ({ id: `o_${name}`, name, expr });
const model = (rows, options, extra) => ({ title: 't', unit: '', goal: 'max', rows, options, ...extra });
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} ± ${tol}, got ${a}`);
const nearRel = (a, b, rel, msg) => near(a, b, Math.abs(b) * rel, msg);

// ---------------------------------------------------------------- numerics

test('normal CDF and quantile: known values, independent approximation, round trip', () => {
  near(H.normCdf(1.96), 0.9750021048517795, 1e-12);
  near(H.normCdf(-1), 0.15865525393145707, 1e-12);
  near(H.normCdf(3), 0.9986501019683699, 1e-12);
  near(H.normCdf(0), 0.5, 1e-15);
  near(H.normQuantile(0.975), 1.959963984540054, 1e-12);
  near(H.normQuantile(0.95), Z95, 1e-12);
  near(H.normQuantile(0.001), -3.090232306167813, 1e-12);
  for (let x = -6; x <= 6; x += 0.37) near(H.normCdf(x), PhiIndep(x), 2e-7, `Φ(${x})`);
  // beyond |x| ≈ 5 the upper tail 1 − Φ(x) is below double precision, so the round trip is only tested inside it
  for (let x = -5; x <= 5; x += 0.37) near(H.normQuantile(H.normCdf(x)), x, 1e-9, `round trip ${x}`);
  assert.equal(H.normQuantile(0), -Infinity);
  assert.equal(H.normQuantile(1), Infinity);
  assert.ok(Number.isNaN(H.normQuantile(1.5)));
});

test('distributions: a 90% range means the 5th and 95th percentiles, and cdf inverts quantile', () => {
  for (const r of [range('a', 2, 50), range('b', -3, 9), range('c', 1, 4, 'uniform'), range('d', 0.5, 2, 'normal')]) {
    const d = H.makeDist(r);
    if (d.type !== 'uniform') {
      near(d.quantile(0.05), r.lo, 1e-9 * Math.abs(r.lo), `${r.name} q05`);
      near(d.quantile(0.95), r.hi, 1e-9 * Math.abs(r.hi), `${r.name} q95`);
    }
    for (const u of [0.01, 0.2, 0.5, 0.77, 0.99]) near(d.cdf(d.quantile(u)), u, 1e-10, `${r.name} cdf∘quantile`);
    // pdf integrates to one
    const lo = d.quantile(1e-6), hi = d.quantile(1 - 1e-6);
    let area = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) { const x = lo + (hi - lo) * (i + 0.5) / N; area += d.pdf(x); }
    near(area * (hi - lo) / N, 1, 2e-3, `${r.name} pdf area`);
  }
  assert.equal(H.rangeShape(1, 2, 'auto'), 'lognormal');
  assert.equal(H.rangeShape(-1, 2, 'auto'), 'normal');
  assert.equal(H.rangeShape(1, 2, 'uniform'), 'uniform');
  const b = H.makeDist(chance('e', 0.3));
  assert.equal(b.quantile(0.69), 0);
  assert.equal(b.quantile(0.71), 1);
  assert.equal(b.mean, 0.3);
});

// ---------------------------------------------------------------- expressions

test('expression parser: precedence, functions, suffixes, comparisons', () => {
  const ev = (src, env) => H.evalExpr(src, env || {});
  assert.equal(ev('2 + 3 * 4'), 14);
  assert.equal(ev('(2 + 3) * 4'), 20);
  assert.equal(ev('-2^2'), -4);
  assert.equal(ev('2^3^2'), 512);
  assert.equal(ev('2^-1'), 0.5);
  assert.equal(ev('10 / 4 / 5'), 0.5);
  assert.equal(ev('160k + 1.5M + 2B'), 160e3 + 1.5e6 + 2e9);
  assert.equal(ev('25% * 400'), 100);
  assert.equal(ev('1e3 + 2.5e-1'), 1000.25);
  assert.equal(ev('if(a > 1, 10, 100)', { a: 2 }), 10);
  assert.equal(ev('if(a > 1, 10, 100)', { a: 1 }), 100);
  assert.equal(ev('a >= 1 and b < 2', { a: 1, b: 1 }), 1);
  assert.equal(ev('a >= 1 and b < 2', { a: 1, b: 2 }), 0);
  assert.equal(ev('not (a = 1) or b != 3', { a: 1, b: 3 }), 0);
  assert.equal(ev('min(3, 1, 2) + max(4, 9)'), 10);
  assert.equal(ev('clamp(15, 0, 10) + abs(-2) + sqrt(16) + round(2.6)'), 19);
  assert.equal(ev('ln(exp(2)) + log10(1000) + floor(2.7) + ceil(2.1)'), 2 + 3 + 2 + 3);
  assert.equal(ev('pow(2, 10)'), 1024);
  assert.equal(ev('x × 2 − 1', { x: 3 }), 5);
  for (const bad of ['2 +', '(1 + 2', 'foo(1)', '2 k', '1 2', 'a b', 'sqrt', 'max()', 'if(1, 2)', '3 $ 4', '']) {
    assert.throws(() => H.parse(bad), H.HingeError, `should reject "${bad}"`);
  }
  assert.throws(() => ev('y + 1', { x: 1 }), /Unknown name "y"/);
});

test('the native (Function) compiler and the closure compiler agree on random expressions', () => {
  const rand = xoshiro(7);
  const exprs = [
    'a * b - c / (d + 1)', 'if(a > b, a - b, b - a) ^ 2', 'max(a, b, c) * min(d, 1) + 3k', 'a and b or not c',
    '(a < b) * 10 + (c >= d) * 5 + (a = a)', 'clamp(a * 7, -2, 2) + abs(b) + sqrt(abs(c)) + exp(d / 5)',
    'ln(abs(a) + 1) * log10(abs(b) + 10) - round(c) + floor(d) - ceil(a)', '-a ^ 2 + -(b) * 12%', 'pow(abs(a) + 1, b)',
  ];
  const names = ['a', 'b', 'c', 'd'];
  const index = (n) => names.indexOf(n);
  for (const src of exprs) {
    const ast = H.parse(src);
    const fast = H.compileFast(ast, index), slow = H.compile(ast, index);
    const js = H.emitJS(ast, index);
    assert.ok(/^[\w\s.+\-*/<>=!?:&|(),\[\]]+$/.test(js), `emitted source is plain arithmetic: ${js}`);
    for (let k = 0; k < 50; k++) {
      const X = Float64Array.from(names.map(() => (rand() - 0.5) * 20));
      const f = fast(X, 0), s = slow(X, 0);
      assert.ok((Number.isNaN(f) && Number.isNaN(s)) || Math.abs(f - s) <= 1e-9 * Math.max(1, Math.abs(s)), `${src}: ${f} vs ${s}`);
    }
  }
});

test('parseNumber, fmt, fmtPct, toIdent', () => {
  assert.equal(H.parseNumber('160k'), 160000);
  assert.equal(H.parseNumber('1.5M'), 1.5e6);
  assert.equal(H.parseNumber('2B'), 2e9);
  assert.equal(H.parseNumber('25%'), 0.25);
  assert.equal(H.parseNumber('-3'), -3);
  assert.equal(H.parseNumber('−3'), -3);
  assert.equal(H.parseNumber('1,000'), 1000);
  assert.equal(H.parseNumber(' .5 '), 0.5);
  assert.ok(Number.isNaN(H.parseNumber('abc')));
  assert.ok(Number.isNaN(H.parseNumber('2kg')));
  assert.ok(Number.isNaN(H.parseNumber('')));
  assert.equal(H.fmt(1234, '$'), '$1.23k');
  assert.equal(H.fmt(167400, '$'), '$167k');
  assert.equal(H.fmt(999999), '1M');
  assert.equal(H.fmt(-2.5e6, '$'), '−$2.5M');
  assert.equal(H.fmt(12.345, 'weeks'), '12.3 weeks');
  assert.equal(H.fmt(0.00173), '0.00173');
  assert.equal(H.fmt(0), '0');
  assert.equal(H.fmt(NaN), '—');
  assert.equal(H.fmt(0.00115, '', { pct: true }), '0.115%');
  assert.equal(H.fmt(0.0396, '', { pct: true }), '3.96%');
  assert.equal(H.fmtPct(0.237), '24%');
  assert.equal(H.fmtPct(0.0396), '4%');
  assert.equal(H.fmtPct(0.0004), '<0.1%');
  assert.equal(H.fmtPct(1), '100%');
  assert.equal(H.toIdent('Exit value ($)'), 'exit_value');
  assert.equal(H.toIdent('2nd year'), '_2nd_year');
  assert.equal(H.toIdent('max'), 'max_');
  assert.equal(H.toIdent('and'), 'and_');
  assert.equal(H.toIdent('   '), '');
});

// ---------------------------------------------------------------- model compilation

test('compileModel reports the right errors and orders formula rows topologically', () => {
  const errs = (m) => H.compileModel(m).errors.map((e) => e.message);
  assert.match(errs(model([range('a', 1, 2), range('a', 1, 2)], [opt('o', 'a')])).join(' '), /used twice/);
  assert.match(errs(model([range('max', 1, 2)], [opt('o', 'max')])).join(' '), /reserved/);
  assert.match(errs(model([range('a', 5, 2)], [opt('o', 'a')])).join(' '), /low value is above/);
  assert.match(errs(model([range('a', 2, 2)], [opt('o', 'a')])).join(' '), /equal/);
  assert.match(errs(model([range('a', -1, 2, 'lognormal')], [opt('o', 'a')])).join(' '), /positive/);
  assert.match(errs(model([chance('e', 1.5)], [opt('o', 'e')])).join(' '), /between 0 and 1/);
  assert.match(errs(model([chance('e', 1)], [opt('o', 'e')])).join(' '), /certainty/);
  assert.match(errs(model([range('a', 1, 2)], [opt('o', 'a + zz')])).join(' '), /Unknown name "zz"/);
  assert.match(errs(model([range('a', 1, 2)], [])).join(' '), /at least one option/);
  assert.match(errs(model([range('a', 1, 2)], [1, 2, 3, 4, 5].map((i) => opt(`o${i}`, 'a')))).join(' '), /At most four/);
  assert.match(errs(model([formula('p', 'q + 1'), formula('q', 'p + 1')], [opt('o', 'p')])).join(' '), /depends on itself/);
  assert.match(errs(model([range('1bad', 1, 2)], [opt('o', '1')])).join(' '), /not a usable name/);
  // a formula may be defined above the rows it uses
  const m = model([formula('total', 'a * b'), formula('b', 'a + 1'), range('a', 1, 2)], [opt('o', 'total')]);
  const { errors, compiled } = H.compileModel(m);
  assert.deepEqual(errors, []);
  assert.deepEqual(compiled.order, [2, 1, 0]);
  const sim = H.simulate(compiled, 100, 3);
  for (let k = 0; k < 100; k++) {
    const a = sim.X[k * 3 + 2];
    near(sim.X[k * 3 + 1], a + 1, 1e-12);
    near(sim.F[0][k], a * (a + 1), 1e-12);
  }
  // downstream sets are transitive and in evaluation order
  assert.deepEqual(compiled.downstream[2], { rows: [1, 0], opts: [0] });
  assert.deepEqual(compiled.downstream[0], { rows: [], opts: [0] });
});

test('analyze rejects non-finite outcomes', () => {
  assert.throws(() => H.analyze(model([range('a', -1, 1)], [opt('o', 'ln(a)')]), { n: 500 }), /non-finite/);
  assert.throws(() => H.analyze(model([fixed('a', 0)], [opt('o', '1 / a')]), { n: 500 }), /non-finite/);
  assert.throws(() => H.analyze(model([range('a', 1, 2)], [opt('o', 'a +')]), { n: 500 }), H.HingeError);
});

// ---------------------------------------------------------------- simulation

test('simulation: Latin hypercube columns, seeded determinism, sample moments', () => {
  const m = model([range('x', 0, 10), range('y', 1, 100), chance('e', 0.3)], [opt('o', 'x + y + e')]);
  const { compiled } = H.compileModel(m);
  const n = 4000;
  const sim = H.simulate(compiled, n, 11);
  for (const u of sim.U.filter(Boolean)) {
    const hit = new Uint8Array(n);
    for (let k = 0; k < n; k++) hit[Math.floor(u[k] * n)] = 1;
    assert.equal(hit.reduce((a, b) => a + b, 0), n, 'every stratum hit exactly once');
  }
  const col = (i) => Float64Array.from({ length: n }, (_, k) => sim.X[k * 3 + i]);
  const x = col(0), y = col(1), e = col(2);
  near(H.mean(x), 5, 0.02);
  near(Math.sqrt(H.variance(x)), 5 / Z95, 0.06);
  near(H.mean(e), 0.3, 1e-12, 'a stratified Bernoulli column is exact');
  const { mu, sigma } = lnParams(1, 100);
  near(H.quantiles(y, [0.5])[0], Math.exp(mu), 0.15);
  nearRel(H.mean(y), Math.exp(mu + sigma * sigma / 2), 0.03);
  const again = H.simulate(compiled, n, 11);
  assert.deepEqual(Array.from(again.F[0]), Array.from(sim.F[0]), 'same seed, same samples');
  const other = H.simulate(compiled, n, 12);
  assert.notDeepEqual(Array.from(other.F[0]), Array.from(sim.F[0]), 'different seed, different samples');
});

// ---------------------------------------------------------------- analysis against closed forms

test('linear-normal decision: P(best), EVPI, partial EVPI, flip threshold and share match closed forms', () => {
  // x ~ N(5, σ), A = 2 + 3x, B = 20 → D = A − B ~ N(−3, 3σ)
  const { sigma } = nParams(0, 10);
  const m = model([range('x', 0, 10)], [opt('A', '2 + 3 * x'), opt('B', '20')]);
  const r = H.analyze(m, { n: 20000, seed: 5 });
  const G = r.slices;
  const mD = -3, sD = 3 * sigma;
  assert.equal(r.mode, 'decision');
  assert.equal(r.options[r.best].name, 'B');
  near(r.pBest[0], 1 - Phi(-mD / sD), 0.01, 'P(A wins)');
  near(r.evpi, expMaxNormal(mD, sD), 0.06, 'total EVPI');
  const x = r.rows[0];
  // sliced partial EVPI: E[D | slice g] = −3 + 3σ E[Z|g]
  let sliced = 0;
  for (let g = 0; g < G; g++) sliced += Math.max(mD + 3 * sigma * sliceMeanZ(g, G), 0) / G;
  near(x.evpi, sliced, 0.05, 'sliced partial EVPI');
  nearRel(sliced, expMaxNormal(mD, sD), 0.03, 'slicing loses less than 3% of the exact partial EVPI');
  assert.equal(x.flip.kind, 'above');
  near(x.flip.at[0][0], 6, 1e-3, 'A wins when 3x − 18 > 0, i.e. x > 6');
  near(x.flip.p, 1 - Phi((6 - 5) / sigma), 1e-6, 'flip probability is the tail of x past the threshold');
  assert.equal(r.options[x.flip.winner].name, 'A');
  near(x.share, sliceFactor(G), 0.03, 'share of variance');
  assert.ok(sliceFactor(G) > 0.97, 'slicing keeps >97% of a normal variance');
  // the curve is the exact conditional mean, since D depends on x alone
  for (const p of x.curve) { near(p.mj[0], 2 + 3 * p.x, 1e-9); near(p.mj[1], 20, 1e-9); }
});

test('two normal inputs: partial EVPI and shares split the way the closed form says', () => {
  const s1 = 1, s2 = 2;
  const m = model([range('x1', -Z95 * s1, Z95 * s1), range('x2', -Z95 * s2, Z95 * s2)], [opt('A', '2 * x1 + x2'), opt('B', '1')]);
  const r = H.analyze(m, { n: 20000, seed: 9 });
  const G = r.slices;
  assert.equal(r.options[r.best].name, 'B');
  const [x1, x2] = r.rows;
  const varD = 4 * s1 * s1 + s2 * s2;
  near(x1.share, (4 * s1 * s1 / varD) * sliceFactor(G), 0.03, 'share of x1');
  near(x2.share, (s2 * s2 / varD) * sliceFactor(G), 0.03, 'share of x2');
  near(r.sumShare, sliceFactor(G), 0.04, 'additive model: shares sum to the slice factor, no interactions');
  // E[D | x1 slice g] = −1 + 2 s1 E[Z|g]; E[D | x2 slice g] = −1 + s2 E[Z|g]
  let e1 = 0, e2 = 0;
  for (let g = 0; g < G; g++) { e1 += Math.max(-1 + 2 * s1 * sliceMeanZ(g, G), 0) / G; e2 += Math.max(-1 + s2 * sliceMeanZ(g, G), 0) / G; }
  near(x1.evpi, e1, 0.03, 'partial EVPI of x1');
  near(x2.evpi, e2, 0.03, 'partial EVPI of x2');
  near(r.evpi, expMaxNormal(-1, Math.sqrt(varD)), 0.03, 'total EVPI');
  assert.ok(r.evpi > x1.evpi && r.evpi > x2.evpi, 'partial EVPIs never exceed the total');
  near(x1.flip.at[0][0], 0.5, 0.05, 'A beats B when 2 x1 > 1 on average');
  near(x1.flip.p, 1 - Phi(0.5 / s1), 0.02);
});

test('chance variable: exact partial EVPI and flip state', () => {
  const m = model([chance('e', 0.3)], [opt('A', 'if(e, 100, 10)'), opt('B', '40')]);
  const r = H.analyze(m, { n: 10000, seed: 2 });
  assert.equal(r.options[r.best].name, 'B');
  near(r.pBest[0], 0.3, 1e-12);
  near(r.evpi, 18, 1e-9, 'E[max] − max E = 58 − 40');
  const e = r.rows[0];
  near(e.evpi, 18, 1e-9, '0.3·max(100,40) + 0.7·max(10,40) − 40');
  assert.equal(e.flip.kind, 'yes');
  near(e.flip.p, 0.3, 1e-12);
  assert.equal(r.options[e.flip.winner].name, 'A');
  near(e.share, 1, 1e-9, 'all the variance of the margin comes from e');
  assert.equal(H.flipText(e, ''), 'if it happens');
});

test('flip sets with two crossings: "between" and "outside"', () => {
  // A = 4 − (x − 5)², B = 0. A wins for x in (3, 7).
  let m = model([range('x', 0, 10)], [opt('A', '4 - (x - 5)^2'), opt('B', '0')]);
  let r = H.analyze(m, { n: 8000, seed: 1 });
  let { sigma } = nParams(0, 10);
  assert.equal(r.options[r.best].name, 'B', 'E[A] = 4 − σ² < 0');
  let x = r.rows[0];
  assert.equal(x.flip.kind, 'between');
  near(x.flip.at[0][0], 3, 1e-3);
  near(x.flip.at[0][1], 7, 1e-3);
  near(x.flip.p, Phi(2 / sigma) - Phi(-2 / sigma), 1e-6);
  assert.equal(H.flipText(x, ''), 'between 3 and 7');
  // narrower x (explicitly normal, since a positive range would be lognormal): E[A] > 0, so A is best and loses only in the tails
  m = model([range('x', 3.5, 6.5, 'normal')], [opt('A', '4 - (x - 5)^2'), opt('B', '0')]);
  r = H.analyze(m, { n: 8000, seed: 1 });
  sigma = nParams(3.5, 6.5).sigma;
  assert.equal(r.options[r.best].name, 'A');
  x = r.rows[0];
  assert.equal(x.flip.kind, 'outside');
  near(x.flip.at[0][1], 3, 1e-3);
  near(x.flip.at[1][0], 7, 1e-3);
  near(x.flip.p, 2 * Phi(-2 / sigma), 1e-6);
  assert.equal(H.flipText(x, ''), 'outside 3 to 7');
  assert.equal(x.flip.intervals[0][0], 0);
  assert.equal(x.flip.intervals[1][1], 1);
});

test('lognormal product estimate: quantiles, shares and swing against closed forms', () => {
  const rows = [range('x1', 1, 10), range('x2', 2, 8), range('x3', 0.5, 2)];
  const m = model(rows, [opt('y', 'x1 * x2 * x3')], { target: 20 });
  const r = H.analyze(m, { n: 20000, seed: 4 });
  assert.equal(r.mode, 'estimate');
  const ps = rows.map((q) => lnParams(q.lo, q.hi));
  const mu = ps.reduce((a, p) => a + p.mu, 0);
  const s2 = ps.reduce((a, p) => a + p.sigma ** 2, 0);
  const o = r.options[0];
  nearRel(o.median, Math.exp(mu), 0.02, 'median');
  nearRel(o.mean, Math.exp(mu + s2 / 2), 0.03, 'mean');
  nearRel(o.q05, Math.exp(mu - Z95 * Math.sqrt(s2)), 0.04, 'q05');
  nearRel(o.q95, Math.exp(mu + Z95 * Math.sqrt(s2)), 0.04, 'q95');
  near(r.target.pBelow, Phi((Math.log(20) - mu) / Math.sqrt(s2)), 0.01, 'P(y ≤ 20)');
  // exact first-order Sobol indices of a lognormal product: (e^{σi²} − 1) / (e^{σ²} − 1)
  const S = ps.map((p) => (Math.exp(p.sigma ** 2) - 1) / (Math.exp(s2) - 1));
  // and their sliced versions: Var over slices of E[xi | slice] times the other factors' means squared, over Var(y)
  const varY = (Math.exp(s2) - 1) * Math.exp(2 * mu + s2);
  const G = r.slices;
  const sliced = ps.map((p, i) => {
    const means = Array.from({ length: G }, (_, g) => sliceMeanLognormal(g, G, p.mu, p.sigma));
    const m0 = means.reduce((a, b) => a + b, 0) / G;
    const v = means.reduce((a, b) => a + (b - m0) ** 2, 0) / G;
    const others = ps.reduce((a, q, j) => (j === i ? a : a * Math.exp(q.mu + q.sigma ** 2 / 2)), 1);
    return v * others * others / varY;
  });
  r.rows.forEach((x, i) => {
    nearRel(x.share, sliced[i], 0.1, `sliced share of ${x.name} (exact ${S[i]})`);
    assert.ok(x.share <= S[i] * 1.05, `the sliced share of ${x.name} does not exceed the exact index`);
  });
  assert.ok(sliced[0] / S[0] > 0.85, 'a lognormal with σ = 0.7 keeps >85% of its variance in 32 slices');
  assert.ok(r.rows[0].share > r.rows[1].share && r.rows[0].share > r.rows[2].share, 'the widest factor dominates');
  // swing of x1 = (q95 − q05) · E[x2] · E[x3]
  const swing = (10 - 1) * lnMean(2, 8) * lnMean(0.5, 2);
  nearRel(r.rows[0].swing, swing, 0.03, 'swing of x1');
  assert.equal(r.rows[0].evpi, undefined, 'no decision, no EVPI');
});

test('goal "min" is the mirror of goal "max"', () => {
  const house = EXAMPLES.find((e) => e.key === 'house');
  const a = H.analyze(house, { n: 4000, seed: 3 });
  const flipped = { ...house, goal: 'max', options: house.options.map((o) => ({ ...o, expr: `-(${o.expr})` })) };
  const b = H.analyze(flipped, { n: 4000, seed: 3 });
  assert.equal(a.best, b.best);
  assert.deepEqual(a.pBest, b.pBest);
  near(a.evpi, b.evpi, 1e-6);
  a.rows.forEach((x, i) => {
    near(x.evpi, b.rows[i].evpi, 1e-6, x.name);
    near(x.share, b.rows[i].share, 1e-9, x.name);
    assert.equal(x.flip.kind, b.rows[i].flip.kind);
    near(x.flip.p, b.rows[i].flip.p, 1e-9);
  });
  a.options.forEach((o, j) => { near(o.mean, -b.options[j].mean, 1e-6); near(o.q05, -b.options[j].q95, 1e-6); });
});

test('formula rows change nothing: the house case with every formula inlined gives identical numbers', () => {
  const house = EXAMPLES.find((e) => e.key === 'house');
  const defs = {};
  for (const r of house.rows) if (r.kind === 'formula') defs[r.name] = r.expr;
  const inline = (expr) => {
    let prev;
    do {
      prev = expr;
      for (const [name, e] of Object.entries(defs)) expr = expr.replace(new RegExp(`(^|[^A-Za-z0-9_])${name}(?![A-Za-z0-9_])`, 'g'), (m, pre) => `${pre}(${e})`);
    } while (expr !== prev);
    return expr;
  };
  const flat = { ...house, rows: house.rows.filter((r) => r.kind !== 'formula'), options: house.options.map((o) => ({ ...o, expr: inline(o.expr) })) };
  const a = H.analyze(house, { n: 3000, seed: 8 });
  const b = H.analyze(flat, { n: 3000, seed: 8 });
  a.options.forEach((o, j) => nearRel(o.mean, b.options[j].mean, 1e-9, o.name));
  a.rows.forEach((x, i) => {
    nearRel(x.evpi, b.rows[i].evpi, 1e-6, `${x.name} evpi`);
    nearRel(x.share, b.rows[i].share, 1e-6, `${x.name} share`);
    near(x.flip.p, b.rows[i].flip.p, 1e-9, `${x.name} flip`);
    x.curve.forEach((p, k) => p.mj.forEach((v, j) => nearRel(v, b.rows[i].curve[k].mj[j], 1e-9)));
  });
});

// ---------------------------------------------------------------- the worked examples, recomputed

test('startup example: expected values and partial EVPIs of the chance rows from closed forms, P(best) by independent Monte Carlo', () => {
  const ex = EXAMPLES.find((e) => e.key === 'startup');
  const r = H.analyze(ex, { n: 20000, seed: 1 });
  const get = (name) => ex.rows.find((q) => q.name === name);
  const mStay = lnMean(get('stay_comp').lo, get('stay_comp').hi);
  const mS = lnMean(get('startup_comp').lo, get('startup_comp').hi);
  const mEq = lnMean(get('equity').lo, get('equity').hi);
  const mV = lnMean(get('exit_value').lo, get('exit_value').hi);
  const mGap = lnMean(get('gap_months').lo, get('gap_months').hi);
  const pS = get('survives').p, pE = get('exit').p;
  const EStay = 4 * mStay;
  const base = 4 * mS - (1 - pS) * (mGap / 12) * mS;
  const EStartup = base + pS * pE * mEq * mV;
  const stay = r.options.find((o) => o.name === 'Stay'), startup = r.options.find((o) => o.name === 'Startup');
  nearRel(stay.mean, EStay, 0.005, 'E[Stay]');
  nearRel(startup.mean, EStartup, 0.02, 'E[Startup]');
  assert.equal(r.options[r.best].name, 'Startup', 'the startup wins on expected value…');
  assert.ok(r.pBest[r.best] < 0.3, '…but comes out ahead in well under 30% of runs');
  // partial EVPI of the chance rows is exact arithmetic on the conditional means
  const exitRow = r.rows.find((x) => x.name === 'exit');
  const ES0 = base, ES1 = base + pS * mEq * mV;
  const evpiExit = (1 - pE) * Math.max(EStay, ES0) + pE * Math.max(EStay, ES1) - Math.max(EStay, EStartup);
  nearRel(exitRow.evpi, evpiExit, 0.03, 'partial EVPI of exit');
  assert.equal(exitRow.flip.kind, 'no');
  near(exitRow.flip.p, 1 - pE, 1e-12);
  const survRow = r.rows.find((x) => x.name === 'survives');
  const EsurvNo = 4 * mS - (mGap / 12) * mS, EsurvYes = 4 * mS + pE * mEq * mV;
  const evpiSurv = (1 - pS) * Math.max(EStay, EsurvNo) + pS * Math.max(EStay, EsurvYes) - Math.max(EStay, EStartup);
  nearRel(survRow.evpi, evpiSurv, 0.03, 'partial EVPI of survives');
  // exit_value: E[Startup | V = v] − E[Stay] = a·v − b; threshold v* = b/a; sliced EVPI from the lognormal slice means
  const a = pS * pE * mEq, b = EStay - base;
  const vRow = r.rows.find((x) => x.name === 'exit_value');
  assert.equal(vRow.flip.kind, 'below');
  nearRel(vRow.flip.at[0][1], b / a, 0.05, 'exit value below which staying is better');
  const { mu, sigma } = lnParams(get('exit_value').lo, get('exit_value').hi);
  near(vRow.flip.p, Phi((Math.log(b / a) - mu) / sigma), 0.02, 'probability of that');
  let sliced = 0;
  const G = r.slices;
  for (let g = 0; g < G; g++) sliced += Math.max(a * sliceMeanLognormal(g, G, mu, sigma) - b, 0) / G;
  sliced -= Math.max(EStartup - EStay, 0);
  nearRel(vRow.evpi, sliced, 0.12, 'sliced partial EVPI of exit_value');
  // rows that cannot flip the decision on their own
  for (const name of ['stay_comp', 'startup_comp', 'gap_months']) {
    const x = r.rows.find((q) => q.name === name);
    assert.equal(x.flip.kind, 'none', `${name} cannot flip it`);
    assert.ok(x.evpi < 0.01 * r.evpi, `${name} is worth ≈ nothing to learn`);
  }
  assert.ok(exitRow.evpi > survRow.evpi && survRow.evpi > vRow.evpi, 'ranking: exit, survives, exit_value');
  // independent Monte Carlo for P(Startup > Stay) and the total EVPI
  const rand = xoshiro(99);
  const S = Object.fromEntries(ex.rows.map((q) => [q.name, sampler(q, rand)]));
  const N = 200000;
  let wins = 0, eMax = 0, sumStay = 0, sumStart = 0;
  for (let k = 0; k < N; k++) {
    const st = S.stay_comp() * 4;
    const surv = S.survives(), ex1 = S.exit();
    const sc = S.startup_comp();
    const go = sc * 4 - (surv ? 0 : S.gap_months() / 12 * sc) + (surv && ex1 ? S.equity() * S.exit_value() : 0);
    if (go > st) wins++;
    eMax += Math.max(go, st); sumStay += st; sumStart += go;
  }
  near(r.pBest[r.best], wins / N, 0.01, 'P(Startup wins) vs independent MC');
  nearRel(r.evpi, eMax / N - Math.max(sumStay, sumStart) / N, 0.05, 'total EVPI vs independent MC');
});

test('house example: the formulas are the mortgage math, and the appreciation threshold is a real crossing', () => {
  const ex = EXAMPLES.find((e) => e.key === 'house');
  const { errors, compiled } = H.compileModel(ex);
  assert.deepEqual(errors, []);
  // evaluate at the medians with an independent implementation
  const med = {};
  for (const q of ex.rows) if (q.kind !== 'formula') med[q.name] = H.makeDist(q).median;
  const years = med.years, price = med.price, loan = price * (1 - med.down_pct), rm = med.rate / 12;
  const payment = loan * rm / (1 - Math.pow(1 + rm, -360));
  const balance = loan * Math.pow(1 + rm, 12 * years) - payment * (Math.pow(1 + rm, 12 * years) - 1) / rm;
  const sale = price * Math.pow(1 + med.appreciation, years);
  const upfront = price * (med.down_pct + med.buying_cost);
  const buy = upfront + (payment * 12 + med.maintenance * price + med.taxes_insurance) * years + upfront * (Math.pow(1 + med.market_return, years) - 1) - (sale * (1 - med.selling_cost) - balance);
  const rent = med.rent * 12 * (Math.pow(1 + med.rent_growth, years) - 1) / med.rent_growth;
  near(payment, 2216.4, 1, 'monthly payment on 360k at 6.25% over 30 years');
  const X = new Float64Array(compiled.nRows);
  for (const i of compiled.order) X[i] = compiled.rows[i].fn ? compiled.rows[i].fn(X, 0) : med[compiled.rows[i].name];
  nearRel(compiled.options[0].fn(X, 0), buy, 1e-9, 'Buy at the medians');
  nearRel(compiled.options[1].fn(X, 0), rent, 1e-9, 'Rent at the medians');
  const r = H.analyze(ex, { n: 20000, seed: 1 });
  assert.equal(r.options[r.best].name, 'Rent');
  const app = r.rows.find((x) => x.name === 'appreciation');
  assert.equal(app.flip.kind, 'above');
  const aStar = app.flip.at[0][0];
  assert.ok(aStar > 0.03 && aStar < 0.05, `threshold ${aStar} is a few percent a year`);
  // at the threshold, an independent MC puts E[Buy | appreciation = a*] within 1% of E[Rent]
  const rand = xoshiro(5);
  const S = Object.fromEntries(ex.rows.filter((q) => q.kind !== 'formula').map((q) => [q.name, sampler(q, rand)]));
  const N = 100000;
  let sBuy = 0, sRent = 0;
  for (let k = 0; k < N; k++) {
    const mr = S.market_return(), mt = S.maintenance(), sc = S.selling_cost(), rg = S.rent_growth();
    const saleK = price * Math.pow(1 + aStar, years);
    sBuy += upfront + (payment * 12 + mt * price + med.taxes_insurance) * years + upfront * (Math.pow(1 + mr, years) - 1) - (saleK * (1 - sc) - balance);
    sRent += med.rent * 12 * (Math.pow(1 + rg, years) - 1) / rg;
  }
  nearRel(sBuy / N, sRent / N, 0.01, 'E[Buy | a*] ≈ E[Rent]');
  for (const name of ['maintenance', 'market_return', 'selling_cost', 'rent_growth']) {
    assert.equal(r.rows.find((x) => x.name === name).flip.kind, 'none', `${name} cannot flip it alone`);
  }
  assert.ok(app.evpi > 0.8 * r.evpi, 'appreciation carries most of the value of information');
});

test('rewrite example: distribution, target and ranking against an independent Monte Carlo', () => {
  const ex = EXAMPLES.find((e) => e.key === 'rewrite');
  const r = H.analyze(ex, { n: 20000, seed: 1 });
  const rand = xoshiro(21);
  const S = Object.fromEntries(ex.rows.map((q) => [q.name, sampler(q, rand)]));
  const N = 200000;
  const ys = new Float64Array(N);
  let below = 0;
  for (let k = 0; k < N; k++) {
    ys[k] = S.features() * S.hours_each() * (1 + S.rework()) / S.focus_hours() + S.surprises();
    if (ys[k] <= 12) below++;
  }
  const o = r.options[0];
  nearRel(o.median, H.quantiles(ys, [0.5])[0], 0.02, 'median');
  nearRel(o.mean, H.mean(ys), 0.02, 'mean');
  near(r.target.pBelow, below / N, 0.012, 'P(≤ 12 weeks)');
  const byShare = [...r.rows].sort((a, b) => b.share - a.share).map((x) => x.name);
  assert.equal(byShare[0], 'hours_each');
  assert.equal(byShare[byShare.length - 1], 'surprises');
  const hrs = r.rows.find((x) => x.name === 'hours_each');
  assert.ok(hrs.swing > 0, 'more hours per feature, more weeks');
  assert.ok(r.rows.find((x) => x.name === 'focus_hours').swing < 0, 'more focus, fewer weeks');
  assert.ok(r.sumShare > 0.85 && r.sumShare < 1.02, 'a product has modest interactions');
});

// ---------------------------------------------------------------- words and files

test('narrate and flipText say the right things', () => {
  const ex = EXAMPLES.find((e) => e.key === 'startup');
  const r = H.analyze(ex, { n: 5000, seed: 1 });
  const text = H.narrate(r, ex).join(' ');
  assert.match(text, /\*\*Startup\*\* beats \*\*Stay\*\*/);
  assert.match(text, /comes out ahead in only \*\*2\d%\*\*/);
  assert.match(text, /most worth finding out is \*\*exit\*\*/);
  assert.match(text, /\*\*exit\*\* if it does not happen/);
  assert.match(text, /\*\*stay_comp\*\*, \*\*startup_comp\*\*, \*\*gap_months\*\* cannot change it alone/);
  const rw = EXAMPLES.find((e) => e.key === 'rewrite');
  const t2 = H.narrate(H.analyze(rw, { n: 5000, seed: 1 }), rw).join(' ');
  assert.match(t2, /Chance of landing at or below \*\*12 weeks\*\*/);
  assert.match(t2, /Most of the uncertainty comes from \*\*hours_each\*\*/);
  assert.match(t2, /\*\*surprises\*\* barely matters/);
});

test('normalizeModel round-trips a case and rejects junk', () => {
  const ex = EXAMPLES.find((e) => e.key === 'house');
  const m = H.normalizeModel(JSON.parse(JSON.stringify(ex)));
  assert.equal(m.rows.length, ex.rows.length);
  assert.equal(m.options.length, 2);
  assert.equal(m.goal, 'min');
  assert.deepEqual(H.analyze(m, { n: 1000, seed: 1 }).pBest, H.analyze(ex, { n: 1000, seed: 1 }).pBest);
  assert.throws(() => H.normalizeModel(null), H.HingeError);
  const junk = H.normalizeModel({ rows: [{ kind: 'nonsense', name: 'a' }, 'x', { kind: 'chance', p: '0.4' }], options: [{ name: 'o', expr: 'a' }] });
  assert.equal(junk.rows[0].kind, 'range');
  assert.equal(junk.rows.length, 2);
  assert.equal(junk.rows[1].p, 0.4);
  assert.equal(typeof junk.rows[0].id, 'string');
});
