// Tests for solera.js. Run from the repo root: node --test ideas/70-solera/solera.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const S = require('./solera.js');
const P = { ...S.DEFAULTS }; // the solera on the page: 4 rows, a quarter drawn, 3.5% evaporation
const P0 = { ...P, evap: 0 }; // the same solera with no evaporation (the first version of the page)

// ---- exact rational arithmetic ----------------------------------------------------------

function bchoose(a, b) {
  if (b < 0n || b > a) return 0n;
  let r = 1n;
  for (let i = 1n; i <= b; i++) r = (r * (a - b + i)) / i;
  return r;
}

/** Run the scales step by step with exact fractions. f = p/q. Returns, for each year after
 * the founding, every row's numerators (Map vintage -> numerator) over the common
 * denominator q^t, and the glass drawn that year (the bottom row before its draw). */
function exactCascade(n, p, q, years, y0 = 0) {
  const P_ = BigInt(p);
  const Q = BigInt(q);
  let rows = Array.from({ length: n }, () => new Map([[y0, 1n]])); // rows[0] = top
  let den = 1n;
  const out = [];
  for (let t = 1; t <= years; t++) {
    const glass = new Map(rows[n - 1]);
    const glassDen = den;
    const next = [];
    for (let d = 0; d < n; d++) {
      const m = new Map();
      for (const [v, x] of rows[d]) m.set(v, (m.get(v) || 0n) + (Q - P_) * x);
      if (d === 0) m.set(y0 + t, (m.get(y0 + t) || 0n) + P_ * den);
      else for (const [v, x] of rows[d - 1]) m.set(v, (m.get(v) || 0n) + P_ * x);
      next.push(m);
    }
    rows = next;
    den *= Q;
    out.push({ year: y0 + t, glass, glassDen, rows: rows.map((r) => new Map(r)), den });
  }
  return out;
}

/** log10 of a positive BigInt, good to ~15 significant figures. */
function blog10(x) {
  const s = x.toString();
  const head = s.slice(0, 16);
  return s.length - head.length + Math.log10(Number(head));
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- the formulas are the cascade, exactly ---------------------------------------------------

test('closed forms equal a step-by-step exact cascade (glass and every row)', () => {
  const cases = [
    [1, 1, 4],
    [2, 1, 3],
    [4, 1, 4],
    [4, 2, 5],
    [6, 1, 3],
    [3, 3, 7],
  ];
  for (const [n, p, q] of cases) {
    const N = BigInt(n);
    const Pb = BigInt(p);
    const Qb = BigInt(q);
    const steps = exactCascade(n, p, q, 40, 1826);
    for (const { year, glass, glassDen, rows, den } of steps) {
      const t = year - 1826;
      // Glass of `year`: founding share P(Bin(t-1, f) <= n-1); vintage of age k: NegBin.
      let found = 0n;
      for (let j = 0n; j <= N - 1n && j <= BigInt(t - 1); j++) found += bchoose(BigInt(t - 1), j) * Pb ** j * (Qb - Pb) ** (BigInt(t - 1) - j);
      if (t - 1 < n) assert.equal(glass.get(1826), glassDen, `glass ${year} is all founding wine`);
      else assert.equal(glass.get(1826) * 1n, found, `founding share in glass ${year}, n=${n} f=${p}/${q}`);
      for (let v = 1827; v < year; v++) {
        const k = BigInt(year - v);
        const num = k < N ? 0n : bchoose(k - 1n, N - 1n) * Pb ** N * (Qb - Pb) ** (k - N) * Qb ** (BigInt(t - 1) - k);
        assert.equal(glass.get(v) || 0n, num, `glass ${year} vintage ${v}`);
      }
      // Rows after the scales of `year` have run.
      for (let d = 1; d <= n; d++) {
        const D = BigInt(d);
        const r = rows[d - 1];
        let fd = 0n;
        for (let j = 0n; j <= D - 1n && j <= BigInt(t); j++) fd += bchoose(BigInt(t), j) * Pb ** j * (Qb - Pb) ** (BigInt(t) - j);
        if (t < d) assert.equal(r.get(1826), den);
        else assert.equal(r.get(1826), fd, `row ${d} founding ${year}`);
        for (let v = 1827; v <= year; v++) {
          const a = BigInt(year - v);
          const num = a + 1n < D ? 0n : bchoose(a, D - 1n) * Pb ** D * (Qb - Pb) ** (a + 1n - D) * Qb ** (BigInt(t) - a - 1n);
          assert.equal(r.get(v) || 0n, num, `row ${d} ${year} vintage ${v}`);
        }
      }
      // And the float module agrees with the exact numbers.
      const g = S.glass({ rows: n, draw: p / q, founded: 1826, molecules: 1 }, year);
      for (const e of g) {
        const exact = Number(glass.get(e.year) || 0n) / Number(glassDen);
        const got = e.ln === -Infinity ? 0 : Math.exp(e.ln);
        assert.ok(Math.abs(got - exact) <= 1e-12 * Math.max(1, exact) + 1e-300, `float glass ${year} ${e.year}: ${got} vs ${exact}`);
      }
    }
  }
});

test('log-space shares match exact rationals far into the tail (t = 200 and 500)', () => {
  for (const [n, p, q] of [
    [4, 1, 4],
    [4, 1, 3],
    [1, 1, 4],
    [8, 1, 10],
  ]) {
    for (const t of [200, 500]) {
      const N = BigInt(n);
      const Pb = BigInt(p);
      const Qb = BigInt(q);
      const T = BigInt(t - 1);
      let found = 0n;
      for (let j = 0n; j <= N - 1n; j++) found += bchoose(T, j) * Pb ** j * (Qb - Pb) ** (T - j);
      const exactL10 = blog10(found) - Number(T) * Math.log10(q);
      const got = S.lnFoundingShare(t - 1, n, p / q) / Math.LN10;
      assert.ok(Math.abs(got - exactL10) < 1e-9 * Math.max(1, Math.abs(exactL10)), `founding n=${n} f=${p}/${q} t=${t}: ${got} vs ${exactL10}`);
      // The row-by-row recursion the page uses gives the same tail.
      const pp = { rows: n, draw: p / q, evap: 0, founded: 1826, molecules: 1 };
      const rec = S.lnFounding(pp, t - 1) / Math.LN10;
      assert.ok(Math.abs(rec - exactL10) < 1e-9 * Math.max(1, Math.abs(exactL10)), `recursion founding n=${n} f=${p}/${q} t=${t}: ${rec} vs ${exactL10}`);
      for (const k of [n, n + 7, 60, 199, 399]) {
        if (k < n) continue;
        const K = BigInt(k);
        const num = bchoose(K - 1n, N - 1n) * Pb ** N * (Qb - Pb) ** (K - N);
        const ex = blog10(num) - k * Math.log10(q);
        const g = S.lnAgeShare(k, n, p / q) / Math.LN10;
        assert.ok(Math.abs(g - ex) < 1e-9 * Math.max(1, Math.abs(ex)), `age share k=${k}: ${g} vs ${ex}`);
        const r = S.lnAge({ rows: n, draw: p / q, evap: 0, founded: 1826, molecules: 1 }, k) / Math.LN10;
        assert.ok(Math.abs(r - ex) < 1e-9 * Math.max(1, Math.abs(ex)), `recursion age share k=${k}: ${r} vs ${ex}`);
      }
    }
  }
});

test('every glass and every cask sums to one', () => {
  for (const rows of [1, 2, 4, 7]) {
    for (const [draw, evap] of [[0.05, 0], [0.25, 0], [1 / 3, 0], [0.5, 0], [0.25, 0.035], [0.05, 0.06], [0.5, 0.06]]) {
      const p = { ...P, rows, draw, evap };
      for (const y of [1827, 1830, 1900, 2026, 2326]) {
        assert.ok(Math.abs(S.totalShare(S.glass(p, y)) - 1) < 1e-10, `glass ${rows} ${draw} ${y}`);
        for (let d = 1; d <= rows; d++) assert.ok(Math.abs(S.totalShare(S.row(p, y, d)) - 1) < 1e-10, `row ${d}`);
      }
    }
  }
});

/** Forward simulation: rows of M labelled molecules. Each year: every row loses e*M molecules
 * picked at random (evaporation); f*M are drawn at random from the bottom row into the glass;
 * the bottom row's gaps are refilled with molecules drawn at random from the row above, whose
 * gaps (what it gave and what it lost) are refilled from the row above it, and so on; the top
 * row's gaps get young wine. No formula is used; this is the physical procedure with random
 * mixing. Returns age tallies of the glasses of the last 20 of `years` years. */
function forwardSimulation(seed, n, f, M, years, e = 0) {
  const rand = mulberry32(seed);
  const m = Math.round(M * f);
  const E = Math.round(M * e);
  const y0 = 1826;
  const rows = Array.from({ length: n }, () => new Array(M).fill(y0));
  // Remove k entries picked at random and return them.
  const take = (arr, k) => {
    const out = [];
    for (let i = 0; i < k; i++) {
      const j = Math.floor(rand() * arr.length);
      out.push(arr[j]);
      arr[j] = arr[arr.length - 1];
      arr.pop();
    }
    return out;
  };
  const tallies = new Map();
  const lastYear = y0 + years;
  for (let year = y0 + 1; year <= lastYear; year++) {
    for (const r of rows) take(r, E);
    const glass = take(rows[n - 1], m);
    if (year > lastYear - 20) for (const v of glass) tallies.set(v === y0 ? 'founding' : year - v, (tallies.get(v === y0 ? 'founding' : year - v) || 0) + 1);
    for (let d = n - 1; d >= 0; d--) {
      const need = M - rows[d].length;
      const src = d === 0 ? new Array(need).fill(year) : take(rows[d - 1], need);
      for (const v of src) rows[d].push(v);
    }
  }
  return { tallies, m, lastYear };
}

/** Chi-square of simulated glasses against the glass formula with (rows, draw, evap). Ages
 * beyond 40 are lumped with the founding wine so every bin is well populated. */
function chiSquare(sim, rows, draw, evap = 0) {
  const expected = new Map();
  for (let year = sim.lastYear - 19; year <= sim.lastYear; year++) {
    for (const e of S.glass({ rows, draw, evap, founded: 1826, molecules: 1 }, year)) {
      const key = e.founding || e.age > 40 ? 'old' : e.age;
      expected.set(key, (expected.get(key) || 0) + Math.exp(e.ln) * sim.m);
    }
  }
  const observed = new Map();
  for (const [age, c] of sim.tallies) {
    const key = age === 'founding' || age > 40 ? 'old' : age;
    observed.set(key, (observed.get(key) || 0) + c);
  }
  let chi = 0;
  let bins = 0;
  for (const [key, e] of expected) {
    if (e < 20) continue;
    const o = observed.get(key) || 0;
    chi += ((o - e) * (o - e)) / e;
    bins++;
  }
  return { chi, bins, limit: bins + 6 * Math.sqrt(2 * bins), observed };
}

test('a forward simulation of single molecules agrees with the backward argument (no evaporation)', () => {
  for (const seed of [60, 1826]) {
    const sim = forwardSimulation(seed, 4, 0.25, 20000, 70);
    const ok = chiSquare(sim, 4, 0.25);
    assert.ok(ok.chi < ok.limit, `seed ${seed}: chi-square ${ok.chi.toFixed(1)} over ${ok.bins} bins (limit ${ok.limit.toFixed(1)})`);
    assert.equal(ok.observed.get(1) || 0, 0, 'nothing reaches the glass in under four years');
    assert.equal(ok.observed.get(3) || 0, 0);
    // The same check has teeth: slightly wrong rules fail it by a wide margin.
    for (const [rows, draw] of [
      [3, 0.25],
      [5, 0.25],
      [4, 0.22],
      [4, 0.28],
    ]) {
      const bad = chiSquare(sim, rows, draw);
      assert.ok(bad.chi > 10 * bad.limit, `wrong rules (${rows}, ${draw}) should fail: ${bad.chi.toFixed(1)}`);
    }
  }
});

// ---- evaporation: the recursion is the physical procedure, exactly ------------------------

const bgcd = (a, b) => {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
};
/** An exact fraction of BigInts. */
class Q {
  constructor(n, d = 1n) {
    if (d < 0n) [n, d] = [-n, -d];
    const g = bgcd(n, d) || 1n;
    this.n = n / g;
    this.d = d / g;
  }
  add(o) { return new Q(this.n * o.d + o.n * this.d, this.d * o.d); }
  sub(o) { return new Q(this.n * o.d - o.n * this.d, this.d * o.d); }
  mul(o) { return new Q(this.n * o.n, this.d * o.d); }
  div(o) { return new Q(this.n * o.d, this.d * o.n); }
  eq(o) { return this.n === o.n && this.d === o.d; }
  /** Natural log, good to ~15 significant figures however large the numbers. */
  ln() { return (blog10(this.n) - blog10(this.d)) * Math.LN10; }
}
const sumQ = (m) => [...m.values()].reduce((a, b) => a.add(b), new Q(0n));

/** The solera worked by volumes, with exact fractions and no turnover formula: every cask
 * loses a fraction e of its wine (every vintage alike); the glass is the bottom row as it
 * stands; f is drawn; then each row, from the bottom up, is filled back to full from the row
 * above, and the top row with young wine. */
function exactVolumes(n, f, e, years, y0 = 1826) {
  const one = new Q(1n);
  let rows = Array.from({ length: n }, () => new Map([[y0, one]]));
  const out = [];
  for (let t = 1; t <= years; t++) {
    const year = y0 + t;
    for (const r of rows) for (const [v, x] of r) r.set(v, x.mul(one.sub(e)));
    const b = rows[n - 1];
    const tot = sumQ(b);
    const glass = new Map([...b].map(([v, x]) => [v, x.div(tot)]));
    for (const [v, x] of b) b.set(v, x.mul(tot.sub(f)).div(tot));
    let young = null;
    for (let d = n - 1; d >= 0; d--) {
      const need = one.sub(sumQ(rows[d]));
      if (d === 0) {
        rows[0].set(year, need);
        young = need;
        continue;
      }
      const src = rows[d - 1];
      const st = sumQ(src);
      for (const [v, x] of src) {
        const moved = x.mul(need).div(st);
        rows[d].set(v, (rows[d].get(v) || new Q(0n)).add(moved));
        src.set(v, x.sub(moved));
      }
    }
    out.push({ year, glass, young, rows: rows.map((r) => new Map(r)) });
  }
  return out;
}

test('with evaporation, the row-by-row recursion equals the solera worked by volumes, exactly', () => {
  const cases = [
    [4, [1n, 4n], [1n, 25n]],
    [4, [1n, 4n], [7n, 200n]],
    [2, [1n, 3n], [1n, 20n]],
    [1, [1n, 5n], [1n, 10n]],
    [3, [1n, 2n], [3n, 50n]],
  ];
  for (const [n, [fp, fq], [ep, eq]] of cases) {
    const f = new Q(fp, fq);
    const e = new Q(ep, eq);
    const p = { rows: n, draw: Number(fp) / Number(fq), evap: Number(ep) / Number(eq), founded: 1826, molecules: 1 };
    for (const { year, glass, young, rows } of exactVolumes(n, f, e, 30)) {
      // The young wine at the top replaces the draw and every row's loss: f + n e.
      assert.ok(young.eq(f.add(e.mul(new Q(BigInt(n))))), `young wine ${year}`);
      for (const c of S.glass(p, year)) {
        const x = glass.get(c.year);
        if (!x || x.n === 0n) {
          assert.equal(c.ln, -Infinity, `glass ${year} ${c.year} should be absent`);
          continue;
        }
        assert.ok(Math.abs(c.ln - x.ln()) < 1e-11 * Math.max(1, Math.abs(x.ln())), `n=${n} glass ${year} vintage ${c.year}: ${c.ln} vs ${x.ln()}`);
      }
      for (let d = 1; d <= n; d++) {
        for (const c of S.row(p, year, d)) {
          const x = rows[d - 1].get(c.year);
          if (!x || x.n === 0n) {
            assert.equal(c.ln, -Infinity, `row ${d} ${year} ${c.year} should be absent`);
            continue;
          }
          assert.ok(Math.abs(c.ln - x.ln()) < 1e-11 * Math.max(1, Math.abs(x.ln())), `n=${n} row ${d} ${year} vintage ${c.year}`);
        }
      }
    }
  }
});

test('a forward simulation of single molecules agrees with the recursion when casks evaporate', () => {
  for (const seed of [35, 2026]) {
    const sim = forwardSimulation(seed, 4, 0.25, 20000, 70, 0.035);
    const ok = chiSquare(sim, 4, 0.25, 0.035);
    assert.ok(ok.chi < ok.limit, `seed ${seed}: chi-square ${ok.chi.toFixed(1)} over ${ok.bins} bins (limit ${ok.limit.toFixed(1)})`);
    // Leaving evaporation out, or getting it wrong, fails by a wide margin.
    for (const [rows, draw, evap] of [
      [4, 0.25, 0],
      [4, 0.25, 0.02],
      [4, 0.25, 0.05],
      [4, 0.285, 0], // the bottom row's turnover alone, as if every row turned over like it
    ]) {
      const bad = chiSquare(sim, rows, draw, evap);
      assert.ok(bad.chi > 10 * bad.limit, `wrong rules (${rows}, ${draw}, ${evap}) should fail: ${bad.chi.toFixed(1)}`);
    }
  }
});

// ---- the numbers the page and README quote -----------------------------------------------

const lnN = Math.log(P.molecules);

test('the defaults: 4 rows, a quarter drawn, 3.5% lost to evaporation, made up from above', () => {
  assert.equal(P.rows, 4);
  assert.equal(P.draw, 0.25);
  assert.equal(P.evap, 0.035);
  const g = S.rates(P);
  assert.deepEqual(g.slice(1).map((x) => +(x * 100).toFixed(1)), [39, 35.5, 32, 28.5]);
});

test('the glass of 2026, with evaporation: the figures quoted on the page and in the README', () => {
  const g = S.glassStats(P, 2026);
  assert.equal(g.meanAge.toFixed(1), '12.0');
  assert.equal(g.medianYear, 2015);
  assert.equal(g.youngest, 2022, 'young wine takes four years to reach the glass');
  assert.equal(g.runFrom, 1846, 'every year from 1846 to 2022 has at least one expected molecule');
  assert.equal(g.scarcest.year, 1846);
  assert.equal(S.countText(g.scarcest.ln + lnN), '1');
  assert.ok(S.glass(P, 2026).find((e) => e.year === 1845).ln + lnN < 0, '1845 is below one molecule');
  assert.equal(g.founding.counted, false);
  assert.equal(g.unbroken, false);
  assert.equal(S.shareText(g.founding.ln), '2 parts in 10²⁷');
  assert.equal(Math.exp(g.founding.lnCount).toFixed(4), '0.0052');
  assert.equal(+(g.founding.pAny * 100).toPrecision(1), 0.5, 'a 0.5% chance of even one molecule of 1826');
  const y1990 = g.composition.find((e) => e.year === 1990).ln;
  assert.equal(S.shareText(y1990), '0.022%');
  assert.equal(S.countText(y1990 + lnN), '6.6 × 10²⁰');
});

test('milestones with evaporation: 1826 below one molecule from 2011; 2026 arrives 2030, peaks 2035, below one from 2207', () => {
  assert.equal(S.foundingGone(P), 2011);
  const c10 = Math.exp(S.glass(P, 2010)[0].ln + lnN);
  const ln11 = S.glass(P, 2011)[0].ln + lnN;
  assert.equal(c10.toFixed(2), '1.12');
  assert.equal(Math.exp(ln11).toFixed(2), '0.80');
  assert.equal(Math.round(S.probAtLeastOne(ln11) * 100), 55);
  const life = S.vintageLife(P, 2026);
  assert.equal(life.first, 2030);
  assert.equal(S.shareText(life.firstLn), '1.26%');
  assert.deepEqual(life.peaks, [2035]);
  assert.equal(S.shareText(life.peakLn), '9.09%');
  assert.equal(life.last, 2206);
  assert.equal(life.gone, 2207);
  const y1990 = S.vintageLife(P, 1990);
  assert.equal(y1990.first, 1994);
  assert.deepEqual(y1990.peaks, [1999]);
  assert.equal(y1990.gone, 2171);
});

test('how much evaporation moves the founding wine: 2063 with none, 2011 at 3.5%', () => {
  const years = [0, 0.01, 0.02, 0.03, 0.035, 0.04, 0.05].map((e) => S.foundingGone({ ...P, evap: e }));
  assert.deepEqual(years, [2063, 2041, 2027, 2016, 2011, 2006, 1998]);
  // At the Consejo's wet-year and dry-year figures the founding wine is gone before 2026 either way.
  for (const e of [0.03, 0.04]) assert.ok(S.glassStats({ ...P, evap: e }, 2026).founding.lnCount < 0);
  // Mean age of the 2026 glass falls from 16 to 12 years.
  assert.equal(S.glassStats(P0, 2026).meanAge.toFixed(1), '16.0');
});

test('without evaporation (the first version of the page): its figures, still quoted for comparison', () => {
  const g = S.glassStats(P0, 2026);
  assert.ok(Math.abs(g.meanAge - 16) < 1e-9, `mean age ${g.meanAge}`);
  assert.equal(g.medianYear, 2011);
  assert.equal(g.youngest, 2022);
  assert.equal(g.unbroken, true, 'every year from 1826 to 2022 has at least one expected molecule');
  assert.equal(g.runFrom, 1827);
  assert.equal(g.scarcest.year, 1827, '1827 is the scarcest year');
  const scarce = Math.exp(g.scarcest.ln) * P0.molecules;
  assert.ok(scarce > 6000 && scarce < 7000, `1827: ${scarce}`);
  assert.equal(S.shareText(g.founding.ln), '7 parts in 10²¹');
  assert.equal(S.countText(g.founding.lnCount), '21,000');
  assert.equal(S.shareText(g.composition.find((e) => e.year === 1990).ln), '0.26%');
  assert.equal(S.foundingGone(P0), 2063);
  const ln63 = S.glass(P0, 2063)[0].ln + lnN;
  assert.equal(Math.exp(ln63).toFixed(2), '0.82');
  assert.equal(Math.round(S.probAtLeastOne(ln63) * 100), 56);
  const life = S.vintageLife(P0, 2026);
  assert.equal(life.first, 2030);
  assert.deepEqual(life.peaks, [2038, 2039]);
  assert.equal(S.shareText(life.peakLn), '6.45%');
  assert.equal(S.shareText(life.firstLn), '0.39%');
  assert.equal(life.gone, 2258);
  assert.equal(S.vintageLife(P0, 1990).gone, 2222);
  // The tie is exact: C(11,3)·3^8/4^12 = C(12,3)·3^9/4^13.
  assert.equal(bchoose(11n, 3n) * 3n ** 8n * 4n, bchoose(12n, 3n) * 3n ** 9n);
  // Comparisons: a third drawn a year, or one row.
  assert.equal(S.foundingGone({ ...P0, draw: 1 / 3 }), 1995);
  assert.equal(S.foundingGone({ ...P0, rows: 1 }), 2023);
});

test('the glass facts never claim an unbroken run that is not there (the 2059-2062 bug)', () => {
  // Without evaporation the founding wine outlasts 1827-1830 by a few years.
  const expect = { 2058: [1827, true, true], 2059: [1828, true, false], 2060: [1829, true, false], 2061: [1830, true, false], 2062: [1831, true, false], 2063: [1832, false, false] };
  for (const [Y, [runFrom, counted, unbroken]] of Object.entries(expect)) {
    const g = S.glassStats(P0, +Y);
    assert.equal(g.runFrom, runFrom, `${Y} runFrom`);
    assert.equal(g.founding.counted, counted, `${Y} founding`);
    assert.equal(g.unbroken, unbroken, `${Y} unbroken`);
  }
  // With evaporation the same thing happens in 2008-2010.
  assert.deepEqual([2007, 2008, 2009, 2010, 2011].map((Y) => S.glassStats(P, Y).runFrom), [1827, 1828, 1829, 1830, 1831]);
  assert.deepEqual([2007, 2008, 2009, 2010, 2011].map((Y) => S.glassStats(P, Y).founding.counted), [true, true, true, true, false]);
  // In general: every year in the run has a molecule, and no year older than the run does.
  for (const [rows, draw, evap] of [[4, 0.25, 0], [4, 0.25, 0.035], [1, 0.5, 0.02], [8, 0.05, 0], [6, 0.5, 0.06], [2, 0.1, 0.01]]) {
    const p = { ...P, rows, draw, evap };
    for (let Y = 1827; Y <= 2326; Y += 7) {
      const g = S.glassStats(p, Y);
      for (const e of g.composition) {
        if (e.founding || e.year > g.youngest) continue;
        const inRun = g.runFrom !== null && e.year >= g.runFrom;
        assert.equal(e.ln + lnN >= 0, inRun, `${rows}/${draw}/${evap} ${Y}: ${e.year}`);
      }
      if (g.unbroken) assert.ok(g.runFrom === 1827 && g.founding.counted);
    }
  }
});

test('how the milestones move with the molecule count', () => {
  // A 100 ml glass of 15-20% wine holds 2.88-2.99 x 10^24 molecules of water and ethanol
  // (water volume taken as the rest of the glass; mixing contraction would add ~2%).
  for (const abv of [0.15, 0.17, 0.2]) {
    const c = S.moleculesInGlass(100, abv);
    assert.ok(c > 2.85e24 && c < 3.0e24, `${abv}: ${c}`);
  }
  // A 17% mixture is about 0.977 g/ml at 20 C; with the contraction counted the figure is ~3.0e24.
  assert.ok(Math.abs(S.moleculesInGlass(100, 0.17, 0.977) / 3.0e24 - 1) < 0.01);
  // With evaporation: 2011 holds for any count from 2.67 to 3.73 x 10^24.
  assert.equal(S.foundingGone({ ...P, molecules: 2.66e24 }), 2010);
  assert.equal(S.foundingGone({ ...P, molecules: 2.67e24 }), 2011);
  assert.equal(S.foundingGone({ ...P, molecules: 3.73e24 }), 2011);
  assert.equal(S.foundingGone({ ...P, molecules: 3.74e24 }), 2012);
  // A 75 ml glass (2.25e24) brings it forward a year.
  assert.equal(S.foundingGone({ ...P, molecules: 2.25e24 }), 2010);
  // 2026's last glass is 2206 for any count from 2.45 to 3.42 x 10^24, so for 15-20% wine either way.
  assert.equal(S.vintageLife({ ...P, molecules: 2.44e24 }, 2026).last, 2205);
  assert.equal(S.vintageLife({ ...P, molecules: 2.45e24 }, 2026).last, 2206);
  assert.equal(S.vintageLife({ ...P, molecules: 3.42e24 }, 2026).last, 2206);
  assert.equal(S.vintageLife({ ...P, molecules: 3.43e24 }, 2026).last, 2207);
  for (const N of [S.moleculesInGlass(100, 0.2), S.moleculesInGlass(100, 0.15), S.moleculesInGlass(100, 0.17, 0.977)]) assert.equal(S.vintageLife({ ...P, molecules: N }, 2026).last, 2206);
  // Without evaporation: 2063 for 2.79 to 3.67 x 10^24, 2062 in a 75 ml glass; 2026's last glass
  // is 2257 only from 2.94 x 10^24 (20% wine without the contraction gives 2256).
  assert.equal(S.foundingGone({ ...P0, molecules: 2.78e24 }), 2062);
  assert.equal(S.foundingGone({ ...P0, molecules: 2.79e24 }), 2063);
  assert.equal(S.foundingGone({ ...P0, molecules: 3.67e24 }), 2063);
  assert.equal(S.foundingGone({ ...P0, molecules: 3.68e24 }), 2064);
  assert.equal(S.foundingGone({ ...P0, molecules: 2.25e24 }), 2062);
  assert.equal(S.vintageLife({ ...P0, molecules: 2.94e24 }, 2026).last, 2257);
  assert.equal(S.vintageLife({ ...P0, molecules: 2.93e24 }, 2026).last, 2256);
  assert.equal(S.vintageLife({ ...P0, molecules: S.moleculesInGlass(100, 0.2) }, 2026).last, 2256);
});

test('the comparisons in the README, with evaporation', () => {
  // A third drawn a year: the founding wine would have been below one molecule from 1963. One row: 1996.
  assert.equal(S.foundingGone({ ...P, draw: 1 / 3 }), 1963);
  assert.equal(S.foundingGone({ ...P, rows: 1 }), 1996);
});

/** The solera with evaporation that takes only water (doubles; volumes add, no contraction).
 * Tracks the founding water and the founding ethanol separately; a 100 ml glass is counted at
 * the bottom row's strength, whatever it has become. */
function waterOnly(n, f, e, years, abv = 0.17, y0 = 1826) {
  const mE = (0.7893 / 46.068) * S.AVOGADRO;
  const mW = (0.9982 / 18.015) * S.AVOGADRO;
  const rows = Array.from({ length: n }, () => ({ W: 1 - abv, A: abv, fW: 1 - abv, fA: abv })); // totals and founding parts
  const out = new Map();
  for (let year = y0 + 1; year <= y0 + years; year++) {
    for (const r of rows) {
      const k = (r.W - e) / r.W;
      r.W *= k;
      r.fW *= k;
    }
    const b = rows[n - 1];
    const tot = b.W + b.A;
    out.set(year, { abv: b.A / tot, founding: ((b.fW / tot) * mW + (b.fA / tot) * mE) * 100 });
    for (const key of ['W', 'A', 'fW', 'fA']) b[key] *= (tot - f) / tot;
    for (let d = n - 1; d >= 0; d--) {
      const r = rows[d];
      const need = 1 - r.W - r.A;
      if (d === 0) {
        r.W += need * (1 - abv);
        r.A += need * abv;
        continue;
      }
      const s = rows[d - 1];
      const k = need / (s.W + s.A);
      for (const key of ['W', 'A', 'fW', 'fA']) {
        r[key] += s[key] * k;
        s[key] -= s[key] * k;
      }
    }
  }
  return out;
}

test('the caveat: if only water evaporated, 1826 would last to 2023, at a strength of 26.5%', () => {
  const gone = (o) => [...o].find(([, x]) => x.founding < 1)[0];
  // With no evaporation the variant is the page's model (for this glass's molecule count).
  assert.equal(gone(waterOnly(4, 0.25, 0, 300)), S.foundingGone({ ...P0, molecules: S.moleculesInGlass(100, 0.17) }));
  const o = waterOnly(4, 0.25, 0.035, 300);
  assert.equal(gone(o), 2023);
  assert.equal((o.get(2026).abv * 100).toFixed(1), '26.5');
  // The page's model, every molecule alike, with the same molecule count: 2011.
  assert.equal(S.foundingGone({ ...P, molecules: S.moleculesInGlass(100, 0.17) }), 2011);
  // Across the Consejo's wet-year to dry-year range (3-4%), with either extreme of what
  // evaporates, a 2026 glass holds less than one expected molecule of 1826.
  assert.equal(gone(waterOnly(4, 0.25, 0.03, 300)), 2026);
  assert.equal(gone(waterOnly(4, 0.25, 0.04, 300)), 2021);
  for (const e of [0.03, 0.04]) assert.ok(S.foundingGone({ ...P, evap: e }) <= 2026);
});

test('when a year leaves the glass, every later year that has had time to arrive is still in it', () => {
  for (const [rows, draw, evap] of [
    [4, 0.25, 0],
    [4, 0.25, 0.035],
    [1, 0.25, 0],
    [3, 0.4, 0.02],
    [8, 0.05, 0],
    [8, 0.05, 0.06],
    [6, 0.5, 0.06],
  ]) {
    const p = { ...P, rows, draw, evap };
    for (const v of [1827, 1990, 2026]) {
      const life = S.vintageLife(p, v);
      if (life.gone === null || life.gone > 1826 + 4000) continue;
      const g = S.glass(p, life.gone);
      assert.ok(g.find((e) => e.year === v).ln + lnN < 0, 'gone means below one molecule');
      for (const e of g) if (e.year > v && e.year <= life.gone - rows) assert.ok(e.ln + lnN >= 0, `${rows}/${draw}/${evap}: ${e.year} in ${life.gone}`);
      // and it never comes back
      for (let y = life.gone; y < life.gone + 30; y++) assert.ok(S.lnAge(p, y - v) + lnN < 0);
    }
  }
});

test('long-run mean age is the sum of 1 / g over the rows, and the spread matches too', () => {
  for (const [rows, draw, evap] of [
    [4, 0.25, 0],
    [1, 1 / 16, 0],
    [3, 0.4, 0],
    [4, 0.25, 0.035],
    [2, 0.1, 0.05],
  ]) {
    const p = { ...P, rows, draw, evap };
    const g = S.glass(p, 1826 + 3000);
    const mean = S.meanAge(g);
    let v = 0;
    for (const e of g) if (e.ln > -Infinity) v += Math.exp(e.ln) * (e.age - mean) ** 2;
    assert.ok(Math.abs(mean - S.steadyMeanAge(p)) < 1e-6, `mean ${mean}`);
    assert.ok(Math.abs(Math.sqrt(v) - S.steadyAgeSd(p)) < 1e-6, `sd ${Math.sqrt(v)}`);
    if (evap === 0) assert.ok(Math.abs(mean - rows / draw) < 1e-6);
  }
  assert.ok(Math.abs(S.steadyMeanAge(P) - (1 / 0.39 + 1 / 0.355 + 1 / 0.32 + 1 / 0.285)) < 1e-12);
  assert.equal(S.steadyAgeSd(P).toFixed(1), '5.0');
  assert.ok(Math.abs(S.steadyAgeSd(P0) - 6.928) < 1e-3);
  // Row d of the lossless steady state has mean age d/f - 1 just after the scales run.
  for (let d = 1; d <= 4; d++) assert.ok(Math.abs(S.meanAge(S.row(P0, 1826 + 3000, d)) - (d / 0.25 - 1)) < 1e-6);
  // ...so the bottom row, just after the scales, is a year younger than the glass drawn before them.
  for (const p of [P, P0]) assert.ok(Math.abs(S.meanAge(S.row(p, 1826 + 3000, 4)) + 1 - S.meanAge(S.glass(p, 1826 + 3000))) < 1e-6);
});

test('what the rows buy is a steadier glass from year to year, not a narrower spread of ages', () => {
  // Sum of squared year-to-year changes in the glass's weights, with no evaporation.
  const sq = (p) => S.yearToYearChange(p) ** 2;
  assert.equal(sq(P0).toFixed(5), '0.00076');
  // One cask drawn at 1/16: f^2 + f^3 / (2 - f), exactly.
  const f = 1 / 16;
  assert.ok(Math.abs(sq({ ...P0, rows: 1, draw: f }) - (f * f + (f * f * f) / (2 - f))) < 1e-12);
  assert.equal((S.yearToYearChange({ ...P0, rows: 1, draw: f }) / S.yearToYearChange(P0)).toFixed(1), '2.3');
  // The single cask matched to the same average age, with evaporation: 1.8 times the change.
  const one = S.singleCaskLike(P);
  assert.ok(Math.abs(S.steadyMeanAge(one) - S.steadyMeanAge(P)) < 1e-9);
  assert.equal((S.yearToYearChange(one) / S.yearToYearChange(P)).toFixed(1), '1.8');
  assert.equal(S.steadyAgeSd(one).toFixed(1), '11.5');
  // The single cask actually averages more years together; and eight rows at a half have a
  // narrower age spread than four at a quarter but change more from year to year. So the age
  // spread is not the measure of consistency the first version of the README took it for.
  const eff = (p) => {
    let s = 0;
    for (const e of S.glass(p, 1826 + 3000)) if (e.ln > -Infinity) s += Math.exp(2 * e.ln);
    return 1 / s;
  };
  assert.ok(eff({ ...P0, rows: 1, draw: f }) > eff(P0));
  const eight = { ...P0, rows: 8, draw: 0.5 };
  assert.ok(S.steadyAgeSd(eight) < S.steadyAgeSd(P0));
  assert.ok(S.yearToYearChange(eight) > 1.5 * S.yearToYearChange(P0));
});

test('the founding wine\'s share of the glass never increases', () => {
  for (const p of [P, P0]) {
    let prev = 1;
    for (let y = 1827; y <= 2326; y++) {
      const s = Math.exp(S.glass(p, y)[0].ln);
      assert.ok(s <= prev + 1e-15);
      prev = s;
    }
  }
});

test('words', () => {
  assert.equal(S.shareText(Math.log(0.0645)), '6.45%');
  assert.equal(S.shareText(Math.log(0.137)), '13.7%');
  assert.equal(S.shareText(Math.log(0.2)), '20%');
  assert.equal(S.shareText(Math.log(0.00026)), '0.026%');
  assert.equal(S.shareText(Math.log(2.6e-5)), '3 parts in 10⁵');
  assert.equal(S.shareText(Math.log(1e-21)), '1 part in 10²¹');
  assert.equal(S.shareText(Math.log(9.7e-21)), '1 part in 10²⁰');
  assert.equal(S.shareText(0), '100%');
  assert.equal(S.shareText(-Infinity), 'none');
  assert.equal(S.countText(Math.log(20229)), '20,000');
  assert.equal(S.countText(Math.log(6343)), '6,300');
  assert.equal(S.countText(Math.log(57)), '57');
  assert.equal(S.countText(Math.log(1.2)), '1');
  assert.equal(S.countText(Math.log(7.6e21)), '7.6 × 10²¹');
  assert.equal(S.countText(Math.log(1e22)), '10²²');
  assert.equal(S.countText(Math.log(0.8)), 'less than one');
  assert.ok(Math.abs(S.probAtLeastOne(Math.log(0.8)) - (1 - Math.exp(-0.8))) < 1e-12);
});

test('loads as a classic script in a browser-like global', () => {
  const src = fs.readFileSync(path.join(here, 'solera.js'), 'utf8');
  const ctx = { self: {} };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  assert.equal(typeof ctx.Solera.glass, 'function');
  assert.equal(ctx.Solera.foundingGone(ctx.Solera.DEFAULTS), 2011);
});

test('bad parameters are refused', () => {
  assert.throws(() => S.glass({ ...P, draw: 0 }, 2026));
  assert.throws(() => S.glass({ ...P, draw: 1 }, 2026));
  assert.throws(() => S.glass({ ...P, rows: 0 }, 2026));
  assert.throws(() => S.glass({ ...P, evap: -0.01 }, 2026));
  assert.throws(() => S.glass({ ...P, rows: 8, draw: 0.5, evap: 0.07 }, 2026), 'the top row would be replaced entirely');
  assert.throws(() => S.glass(P, 1826));
  assert.throws(() => S.row(P, 2026, 5));
  // The page's sliders never ask for an impossible solera.
  assert.doesNotThrow(() => S.glass({ ...P, rows: 8, draw: 0.5, evap: 0.06 }, 2026));
});
