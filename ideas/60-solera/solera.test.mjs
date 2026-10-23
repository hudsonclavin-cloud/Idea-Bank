// Tests for solera.js. Run from the repo root: node --test ideas/60-solera/solera.test.mjs
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
const P = { ...S.DEFAULTS };

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
      for (const k of [n, n + 7, 60, 199, 399]) {
        if (k < n) continue;
        const K = BigInt(k);
        const num = bchoose(K - 1n, N - 1n) * Pb ** N * (Qb - Pb) ** (K - N);
        const ex = blog10(num) - k * Math.log10(q);
        const g = S.lnAgeShare(k, n, p / q) / Math.LN10;
        assert.ok(Math.abs(g - ex) < 1e-9 * Math.max(1, Math.abs(ex)), `age share k=${k}: ${g} vs ${ex}`);
      }
    }
  }
});

test('every glass and every cask sums to one', () => {
  for (const rows of [1, 2, 4, 7]) {
    for (const draw of [0.05, 0.25, 1 / 3, 0.5]) {
      const p = { ...P, rows, draw };
      for (const y of [1827, 1830, 1900, 2026, 2326]) {
        assert.ok(Math.abs(S.totalShare(S.glass(p, y)) - 1) < 1e-10, `glass ${rows} ${draw} ${y}`);
        for (let d = 1; d <= rows; d++) assert.ok(Math.abs(S.totalShare(S.row(p, y, d)) - 1) < 1e-10, `row ${d}`);
      }
    }
  }
});

/** Forward simulation: rows of M labelled molecules. Each year: draw f*M at random from the
 * bottom row into the glass, refill its gaps with f*M drawn at random from the row above, and
 * so on; the top row's gaps get young wine. No formula is used; this is the physical procedure
 * with random mixing. Returns age tallies of the glasses of the last 20 of `years` years. */
function forwardSimulation(seed, n, f, M, years) {
  const rand = mulberry32(seed);
  const m = M * f;
  const y0 = 1826;
  const rows = Array.from({ length: n }, () => new Int32Array(M).fill(y0));
  const pick = (arr, k) => {
    // Partial Fisher-Yates: move k random entries to the front and return their values.
    const out = [];
    for (let i = 0; i < k; i++) {
      const j = i + Math.floor(rand() * (arr.length - i));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
      out.push(arr[i]);
    }
    return out;
  };
  const tallies = new Map();
  const lastYear = y0 + years;
  for (let year = y0 + 1; year <= lastYear; year++) {
    const taken = pick(rows[n - 1], m);
    if (year > lastYear - 20) for (const v of taken) tallies.set(v === y0 ? 'founding' : year - v, (tallies.get(v === y0 ? 'founding' : year - v) || 0) + 1);
    for (let d = n - 1; d >= 0; d--) {
      // The first m slots of rows[d] were just picked; refill them from the row above.
      const src = d === 0 ? null : pick(rows[d - 1], m);
      for (let i = 0; i < m; i++) rows[d][i] = d === 0 ? year : src[i];
    }
  }
  return { tallies, m, lastYear };
}

/** Chi-square of simulated glasses against the glass formula with (rows, draw). Ages beyond
 * 40 are lumped with the founding wine so every bin is well populated. */
function chiSquare(sim, rows, draw) {
  const expected = new Map();
  for (let year = sim.lastYear - 19; year <= sim.lastYear; year++) {
    for (const e of S.glass({ rows, draw, founded: 1826, molecules: 1 }, year)) {
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

test('a forward simulation of single molecules agrees with the backward argument', () => {
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

// ---- the numbers the page and README quote -----------------------------------------------

test('the 1826 solera in 2026: the figures quoted on the page', () => {
  const g = S.glassStats(P, 2026);
  assert.ok(Math.abs(g.meanAge - 16) < 1e-9, `mean age ${g.meanAge}`);
  assert.equal(g.medianYear, 2011);
  assert.equal(g.youngest, 2022, 'young wine takes four years to reach the glass');
  assert.equal(g.unbroken, true, 'every year from 1826 to 2022 has at least one expected molecule');
  assert.equal(g.oldestCounted, 1826);
  assert.equal(g.scarcest.year, 1827, '1827 is the scarcest year');
  const scarce = Math.exp(g.scarcest.ln) * P.molecules;
  assert.ok(scarce > 6000 && scarce < 7000, `1827: ${scarce}`);
  const founders = Math.exp(g.founding.lnCount);
  assert.ok(founders > 19000 && founders < 22000, `founding molecules ${founders}`);
  assert.equal(S.shareText(g.founding.ln), '7 parts in 10²¹');
  assert.equal(S.countText(g.founding.lnCount), '21,000');
  assert.equal(S.shareText(g.composition.find((e) => e.year === 1990).ln), '0.26%');
});

test('milestones: the founding wine leaves the glass in 2063; 2026 arrives 2030, peaks 2038 and 2039', () => {
  assert.equal(S.foundingGone(P), 2063);
  const life = S.vintageLife(P, 2026);
  assert.equal(life.first, 2030);
  assert.deepEqual(life.peaks, [2038, 2039]);
  assert.equal(S.shareText(life.peakLn), '6.45%');
  assert.equal(S.shareText(life.firstLn), '0.39%');
  assert.equal(life.last, 2257);
  assert.equal(life.gone, 2258);
  const y1990 = S.vintageLife(P, 1990);
  assert.equal(y1990.first, 1994);
  assert.deepEqual(y1990.peaks, [2002, 2003]);
  assert.equal(y1990.gone, 2222);
  // The tie is exact: C(11,3)·3^8/4^12 = C(12,3)·3^9/4^13.
  assert.equal(bchoose(11n, 3n) * 3n ** 8n * 4n, bchoose(12n, 3n) * 3n ** 9n);
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
  // 2063 holds for any count from 2.8 to 3.5 x 10^24.
  for (const N of [2.8e24, 2.9e24, 3.0e24, 3.2e24, 3.5e24]) assert.equal(S.foundingGone({ ...P, molecules: N }), 2063, `N=${N}`);
  // A 75 ml glass (2.25e24) brings it forward a year; 2026's last glass is 2256 or 2257.
  assert.equal(S.foundingGone({ ...P, molecules: 2.25e24 }), 2062);
  for (const N of [2.85e24, 3.0e24]) {
    const last = S.vintageLife({ ...P, molecules: N }, 2026).last;
    assert.ok(last === 2256 || last === 2257, `N=${N}: ${last}`);
  }
});

test('the README comparisons and the 2063 figures', () => {
  // 2063: 0.82 expected molecules of 1826, a 56% chance of at least one; 2062 still above one.
  const ln63 = S.glass(P, 2063)[0].ln + Math.log(P.molecules);
  assert.equal(Math.exp(ln63).toFixed(2), '0.82');
  assert.equal(Math.round(S.probAtLeastOne(ln63) * 100), 56);
  assert.ok(Math.exp(S.glass(P, 2062)[0].ln) * P.molecules > 1);
  // 1990 in the glass of 2026.
  const ln1990 = S.glass(P, 2026).find((e) => e.year === 1990).ln;
  assert.equal(S.countText(ln1990 + Math.log(P.molecules)), '7.7 \u00d7 10\u00b2\u00b9');
  // A third drawn a year: the founding wine would have left the glass in 1995. One row: 2023.
  assert.equal(S.foundingGone({ ...P, draw: 1 / 3 }), 1995);
  assert.equal(S.foundingGone({ ...P, rows: 1 }), 2023);
  // The exact molecule-count window for 2063, and for 2026's last glass being 2257.
  assert.equal(S.foundingGone({ ...P, molecules: 2.79e24 }), 2063);
  assert.equal(S.foundingGone({ ...P, molecules: 3.67e24 }), 2063);
  assert.equal(S.foundingGone({ ...P, molecules: 2.78e24 }), 2062);
  assert.equal(S.foundingGone({ ...P, molecules: 3.68e24 }), 2064);
  assert.equal(S.vintageLife({ ...P, molecules: 2.94e24 }, 2026).last, 2257);
  assert.equal(S.vintageLife({ ...P, molecules: 2.93e24 }, 2026).last, 2256);
  assert.equal(S.vintageLife({ ...P, molecules: S.moleculesInGlass(100, 0.2) }, 2026).last, 2256);
});

test('when a year leaves the glass, every later year that has had time to arrive is still in it', () => {
  for (const [rows, draw] of [
    [4, 0.25],
    [1, 0.25],
    [3, 0.4],
    [8, 0.05],
    [6, 0.5],
  ]) {
    const p = { ...P, rows, draw };
    for (const v of [1827, 1990, 2026]) {
      const life = S.vintageLife(p, v);
      if (life.gone === null || life.gone > 1826 + 4000) continue;
      const g = S.glass(p, life.gone);
      const lnN = Math.log(p.molecules);
      assert.ok(g.find((e) => e.year === v).ln + lnN < 0, 'gone means below one molecule');
      for (const e of g) if (e.year > v && e.year <= life.gone - rows) assert.ok(e.ln + lnN >= 0, `${rows}/${draw}: ${e.year} in ${life.gone}`);
      // and it never comes back
      for (let y = life.gone; y < life.gone + 30; y++) assert.ok(S.lnAgeShare(y - v, rows, draw) + lnN < 0);
    }
  }
});

test('long-run mean age is rows / draw and spread is sqrt(rows (1 - draw)) / draw', () => {
  for (const [rows, draw] of [
    [4, 0.25],
    [1, 1 / 16],
    [3, 0.4],
  ]) {
    const p = { ...P, rows, draw };
    const g = S.glass(p, 1826 + 3000);
    const mean = S.meanAge(g);
    let v = 0;
    for (const e of g) if (e.ln > -Infinity) v += Math.exp(e.ln) * (e.age - mean) ** 2;
    assert.ok(Math.abs(mean - rows / draw) < 1e-6, `mean ${mean}`);
    assert.ok(Math.abs(Math.sqrt(v) - S.steadyAgeSd(p)) < 1e-6, `sd ${Math.sqrt(v)}`);
  }
  // Same 16-year average: four rows give a far narrower spread than one cask.
  assert.ok(Math.abs(S.steadyAgeSd(P) - 6.928) < 1e-3);
  assert.ok(Math.abs(S.steadyAgeSd({ ...P, rows: 1, draw: 1 / 16 }) - 15.49) < 1e-2);
  // Row d of the steady state has mean age d/f - 1 just after the scales run.
  for (let d = 1; d <= 4; d++) assert.ok(Math.abs(S.meanAge(S.row(P, 1826 + 3000, d)) - (d / 0.25 - 1)) < 1e-6);
});

test('the founding wine\'s share of the glass never increases', () => {
  let prev = 1;
  for (let y = 1827; y <= 2326; y++) {
    const s = Math.exp(S.glass(P, y)[0].ln);
    assert.ok(s <= prev + 1e-15);
    prev = s;
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
  assert.equal(ctx.Solera.foundingGone(ctx.Solera.DEFAULTS), 2063);
});

test('bad parameters are refused', () => {
  assert.throws(() => S.glass({ ...P, draw: 0 }, 2026));
  assert.throws(() => S.glass({ ...P, draw: 1 }, 2026));
  assert.throws(() => S.glass({ ...P, rows: 0 }, 2026));
  assert.throws(() => S.glass(P, 1826));
  assert.throws(() => S.row(P, 2026, 5));
});
