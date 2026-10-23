// Verification for The Extinction Debt. From the repo root run:
//   node --test ideas/44-extinction-debt/model.test.mjs
// Prints the measured numbers as it goes; the README quotes the ones marked "README".
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const M = createRequire(import.meta.url)('./model.js');
const log = (...a) => console.log('   ', ...a);
const fmt = (arr, d = 4) => Array.from(arr, (v) => v.toFixed(d)).join(' ');

const GRID = [];
for (const S of [5, 10, 20]) for (const q of [0.05, 0.1, 0.2, 0.35]) GRID.push({ S, q });

// ---------------------------------------------------------------- closed forms

test('geometric trade-off: equilibrium abundances are q(1−q)^(i−1), summing to 1 − (1−q)^S', () => {
  let worst = 0;
  for (const { S, q } of GRID) {
    const c = M.geometricRates(S, q, 0.02);
    const eq = M.equilibrium(c, 0.02, 0);
    const expected = M.geometricAbundances(S, q);
    for (let i = 0; i < S; i++) worst = Math.max(worst, Math.abs(eq[i] - expected[i]));
    const sum = eq.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - (1 - Math.pow(1 - q, S))) < 1e-12, `occupied fraction ${sum} for S=${S}, q=${q}`);
  }
  log(`max |p* − q(1−q)^(i−1)| over ${GRID.length} (S, q) pairs: ${worst.toExponential(2)}`);
  assert.ok(worst < 1e-12);
  // README: the default forest
  const c = M.geometricRates(10, 0.2, 0.02);
  const eq = M.equilibrium(c, 0.02, 0);
  log('README default (S=10, q=0.2): shares', fmt(eq, 4), '| bare ground', (1 - eq.reduce((a, b) => a + b, 0)).toFixed(4));
  log('README default colonization rates c_i/m:', fmt(Array.from(c, (v) => v / 0.02), 2));
  assert.ok(Math.abs(1 - eq.reduce((a, b) => a + b, 0) - 0.1073741824) < 1e-12);
  assert.ok(Math.abs(c[9] / 0.02 - 69.39) < 0.01);
});

test('destruction thresholds: species k dies iff D ≥ 1 − (1−q)^(2k−1); extinctions are a prefix of the ranking, in order', () => {
  let worst = 0;
  for (const { S, q } of GRID) {
    const c = M.geometricRates(S, q, 0.02);
    for (let i = 0; i < S; i++) {
      const numeric = M.threshold(c, 0.02, i);
      const closed = M.geometricThreshold(i + 1, q);
      worst = Math.max(worst, Math.abs(numeric - closed));
    }
    // prefix property on a fine D grid (avoiding the thresholds themselves, where the parity
    // knife-edge of the next test puts every same-parity rank below at exactly zero), and the
    // number lost never decreases with D
    let lastLost = 0;
    const thresholds = Array.from({ length: S }, (_, k) => M.geometricThreshold(k + 1, q));
    for (let n = 0; n <= 999; n++) {
      const D = n / 1000;
      if (thresholds.some((t) => Math.abs(t - D) < 1e-9)) continue;
      const eq = M.equilibrium(c, 0.02, D);
      let lost = 0;
      while (lost < S && eq[lost] === 0) lost++;
      for (let i = lost; i < S; i++) assert.ok(eq[i] > 0, `non-prefix extinction set at S=${S} q=${q} D=${D}: ${fmt(eq, 5)}`);
      assert.ok(lost >= lastLost, `lost count fell at D=${D}`);
      lastLost = lost;
    }
  }
  log(`max |bisection threshold − closed form| : ${worst.toExponential(2)}`);
  assert.ok(worst < 1e-8);
  // README: default thresholds, and the shrinking gaps between them
  const q = 0.2;
  const thr = Array.from({ length: 10 }, (_, k) => M.geometricThreshold(k + 1, q));
  log('README thresholds (% destroyed) for ranks 1..10:', thr.map((v) => (100 * v).toFixed(1)).join(' '));
  assert.ok(Math.abs(thr[0] - 0.2) < 1e-12 && Math.abs(thr[1] - 0.488) < 1e-12 && Math.abs(thr[2] - 0.67232) < 1e-12 && Math.abs(thr[3] - 0.7902848) < 1e-12);
  for (let k = 1; k < 9; k++) assert.ok(thr[k + 1] - thr[k] < thr[k] - thr[k - 1], 'gaps between thresholds must shrink');
  log('gap to the next threshold shrinks every rank: already-fragmented habitat loses more species per extra % destroyed');
});

test('below the first threshold: the runner-up gains, odd ranks fall in step with the leader (exact parity structure)', () => {
  for (const { S, q } of GRID) {
    const c = M.geometricRates(S, q, 0.02);
    const x = 1 - q;
    for (const D of [0, 0.25 * q, 0.5 * q, 0.9 * q]) {
      const eq = M.equilibrium(c, 0.02, D);
      for (let k = 0; 2 * k < S; k++) assert.ok(Math.abs(eq[2 * k] - Math.pow(x, 2 * k) * (q - D)) < 1e-12, 'odd rank formula');
      for (let k = 0; 2 * k + 1 < S; k++) assert.ok(Math.abs(eq[2 * k + 1] - (q * Math.pow(x, 2 * k + 1) + D * Math.pow(x, 2 * k + 2))) < 1e-12, 'even rank formula');
    }
  }
  const c = M.geometricRates(10, 0.2, 0.02);
  const a = M.equilibrium(c, 0.02, 0.1);
  const b = M.equilibrium(c, 0.02, 0);
  log(`README: at D = 10% the runner-up's share rises from ${b[1].toFixed(3)} to ${a[1].toFixed(3)} (slope (1−q)^2 = ${(0.8 * 0.8).toFixed(2)}) while the leader falls from ${b[0].toFixed(3)} to ${a[0].toFixed(3)}`);
  assert.ok(Math.abs(a[1] - 0.224) < 1e-12 && Math.abs(a[0] - 0.1) < 1e-12);
  // at exactly D = q every odd rank is at zero and every even rank at its peak
  const at = M.equilibrium(c, 0.02, 0.2);
  for (let i = 0; i < 10; i += 2) assert.equal(at[i], 0);
  for (let i = 1; i < 10; i += 2) assert.ok(at[i] > 0);
  log('at exactly D = q: odd ranks', fmt([at[0], at[2], at[4], at[6], at[8]], 4), '| even ranks', fmt([at[1], at[3], at[5], at[7], at[9]], 4));
});

test('the threshold statement, knife-edges included: rank k persists iff D < D_k and D is not D_j for a better rank j of the same parity', () => {
  let checked = 0;
  for (const { S, q } of GRID) {
    const c = M.geometricRates(S, q, 0.02);
    const thr = Array.from({ length: S }, (_, k) => M.geometricThreshold(k + 1, q));
    const Ds = [];
    for (let n = 0; n <= 400; n++) Ds.push(n / 400);
    for (const t of thr) Ds.push(t, t - 1e-4, t + 1e-4); // the thresholds themselves and a hair either side
    for (const D of Ds) {
      if (D < 0 || D > 1) continue;
      const eq = M.equilibrium(c, 0.02, D);
      const edge = M.knifeEdges(c, 0.02, D);
      for (let k = 0; k < S; k++) {
        const onEdge = thr.some((t, j) => j < k && (k - j) % 2 === 0 && Math.abs(D - t) < 1e-12);
        const expected = D < thr[k] - 1e-12 && !onEdge;
        if (Math.abs(D - thr[k]) < 1e-12) assert.equal(eq[k], 0, `at its own threshold rank ${k + 1} is at 0`);
        else assert.equal(eq[k] > 0, expected, `S=${S} q=${q} D=${D} rank ${k + 1}: eq ${eq[k]}`);
        // the knife-edge flag is set exactly on the isolated zeros, never on a real threshold (checked
        // up to D = 0.99: beyond that the shares a hair either side fall below the 1e-12 resolution)
        if (D <= 0.99) assert.equal(edge[k], onEdge && D < thr[k], `knife-edge flag S=${S} q=${q} D=${D} rank ${k + 1}`);
        checked++;
      }
    }
  }
  const c = M.geometricRates(10, 0.2, 0.02);
  const zeroAt = (D) => Array.from(M.equilibrium(c, 0.02, D)).map((v, i) => (v === 0 ? i + 1 : 0)).filter(Boolean).join(',');
  log(`README: zero sets at D = q: {${zeroAt(0.2)}}; at D = 0.488: {${zeroAt(0.488)}}; a hair either side of q: {${zeroAt(0.2 - 1e-6)}} and {${zeroAt(0.2 + 1e-6)}}  (${checked} checks)`);
  assert.equal(zeroAt(0.2), '1,3,5,7,9');
  assert.equal(zeroAt(0.488), '1,2,4,6,8,10');
  // README: populations at 19 % cleared, N = 10,000: the odd ranks settle thin, not briefly thin
  const eq19 = M.equilibrium(c, 0.02, 0.19);
  const thin = [2, 4, 6, 8].map((i) => Math.round(eq19[i] * 10000));
  log(`README: at 19 % cleared #3, #5, #7, #9 settle at ${thin.join(', ')} of 10,000 sites`);
  assert.deepEqual(thin, [64, 41, 26, 17]);
});

test('at exactly D = q the forecast owes one species, not five: #1 is doomed, the other odd ranks sit on a knife-edge and decay only as 1/t', () => {
  const c = M.geometricRates(10, 0.2, 1);
  const p0 = Float64Array.from(M.equilibrium(c, 1, 0), (v) => v * 0.8);
  const f = M.forecast(p0, c, 1, 0.2, 1e-4, 50, 1);
  const list = (a) => a.map((v, i) => (v ? i + 1 : 0)).filter(Boolean).join(',');
  log(`D = q: doomed {${list(f.doomed)}}, knife-edge {${list(f.edge)}}`);
  assert.equal(list(f.doomed), '1');
  assert.equal(list(f.edge), '3,5,7,9');
  // one step of the slider either way: nobody is on a knife-edge, and the debt is 0 below q, 1 above
  for (const [D, debt] of [[0.19, 0], [0.21, 1]]) {
    const g = M.forecast(Float64Array.from(M.equilibrium(c, 1, 0), (v) => v * (1 - D)), c, 1, D, 1e-4, 50, 1);
    assert.equal(g.doomed.filter(Boolean).length, debt);
    assert.equal(g.edge.filter(Boolean).length, 0);
  }
  // the long-run share at D = q really is zero, but approached algebraically: p1·t → 1/c1, p3/p1 → const
  const r = M.integrate(p0, c, 1, 0.2, 4000, 1000, 0.01);
  const k = r.t.length - 1;
  log(`ODE at D = q after ${r.t[k].toFixed(0)} lifetimes: p1·t = ${(r.p[k][0] * r.t[k]).toFixed(3)} (1/c1 = ${(1 / c[0]).toFixed(3)}), p3/p1 = ${(r.p[k][2] / r.p[k][0]).toFixed(3)}, p5/p1 = ${(r.p[k][4] / r.p[k][0]).toFixed(3)}`);
  assert.ok(Math.abs(r.p[k][0] * r.t[k] - 1 / c[0]) < 0.01);
  assert.ok(r.p[k][2] < 1e-3 && r.p[k][2] > 0 && Math.abs(r.p[k][2] / r.p[k][0] - r.p[k - 1][2] / r.p[k - 1][0]) < 0.01);
});

test('history matters: the equilibrium is taken over the species still standing, and a loss moves the thresholds below it', () => {
  const m = 1;
  const c = M.geometricRates(10, 0.2, m);
  // 1. the masked equilibrium is where the ODE actually goes, for random sets of survivors
  const rand = M.mulberry32(2024);
  let worst = 0;
  let cases = 0;
  while (cases < 6) {
    const present = Array.from({ length: 10 }, () => rand() < 0.6);
    const D = 0.9 * rand();
    const ranges = M.survivalRanges(c, m, present, 500);
    // keep away from any edge, where convergence is algebraic rather than exponential
    if (ranges.some((rs) => rs.some(([lo, hi]) => Math.abs(D - lo) < 0.02 || Math.abs(D - hi) < 0.02))) continue;
    if (Array.from({ length: 10 }, (_, k) => M.geometricThreshold(k + 1, 0.2)).some((t) => Math.abs(D - t) < 0.02)) continue;
    const p0 = Float64Array.from(present, (v) => (v ? 0.05 : 0));
    const r = M.integrate(p0, c, m, D, 1500, 1500, 0.01);
    const eq = M.equilibrium(c, m, D, present);
    for (let i = 0; i < 10; i++) worst = Math.max(worst, Math.abs(r.final[i] - eq[i]));
    cases++;
  }
  log(`masked equilibrium vs ODE after 1,500 lifetimes, 6 random survivor sets: max error ${worst.toExponential(1)}`);
  assert.ok(worst < 1e-6);
  // 2. losing rank j alone dooms rank j+2 whenever less than D_j is cleared
  for (let j = 1; j <= 8; j++) {
    const present = new Array(10).fill(true);
    present[j - 1] = false;
    const R = M.survivalRanges(c, m, present)[j + 1];
    assert.equal(R.length, 1);
    assert.ok(Math.abs(R[0][0] - M.geometricThreshold(j, 0.2)) < 1e-8 && Math.abs(R[0][1] - M.geometricThreshold(j + 2, 0.2)) < 1e-8, `rank ${j + 2} after losing ${j}: ${R}`);
  }
  const full = M.survivalRanges(c, m, new Array(10).fill(true));
  for (let k = 0; k < 10; k++) assert.ok(full[k].length === 1 && full[k][0][0] === 0 && Math.abs(full[k][0][1] - M.geometricThreshold(k + 1, 0.2)) < 1e-8);
  log('losing rank j alone: rank j+2 then persists only for D_j < D < D_{j+2} (j = 1..8); with nobody lost the ranges are [0, D_k)');
  // 3. the reviewer's scenario: #1 has died out at 40 % cleared, then the land is restored to 10 %
  const p0 = Float64Array.from(M.equilibrium(c, m, 0.4));
  p0[0] = 0;
  const f = M.forecast(p0, c, m, 0.1, 1e-4, 400, 0.25, { dt: 0.004 });
  const doomed = f.doomed.map((v, i) => (v ? i + 1 : 0)).filter(Boolean);
  const ode = M.integrate(p0, c, m, 0.1, 50, 50, 0.002);
  log(`README: #1 gone, land restored from 40 % to 10 %: doomed {${doomed}}, #3's long-run share ${f.eq[2]}; ODE after 50 lifetimes: #3 at ${ode.final[2].toExponential(1)}; #3 below 1/10,000 after ${(50 * f.eta[2]).toFixed(0)} yr`);
  assert.deepEqual(doomed, [3]);
  assert.equal(f.eq[2], 0);
  assert.ok(ode.final[2] < 1e-5, 'the ODE takes #3 to zero');
  assert.ok(f.eta[2] < 400);
  // with #1 gone, #3's long-run share is (1−q)²(D − q) below D_2: positive only above q
  for (const D of [0.05, 0.1, 0.3, 0.45]) {
    const e = M.equilibrium(c, m, D, [false, true, true, true, true, true, true, true, true, true]);
    assert.ok(Math.abs(e[2] - Math.max(0, 0.64 * (D - 0.2))) < 1e-12);
  }
});

// ---------------------------------------------------------------- dynamics

test('ODE: converges to the equilibrium from a perturbed start; no NaN, non-negative, never over-fills the habitat', () => {
  for (const D of [0, 0.3, 0.55]) {
    const c = M.geometricRates(10, 0.2, 0.02);
    const p0 = new Float64Array(10).fill(0.02);
    const r = M.integrate(p0, c, 0.02, D, 6000, 50);
    const eq = M.equilibrium(c, 0.02, D);
    let worst = 0;
    for (let i = 0; i < 10; i++) worst = Math.max(worst, Math.abs(r.final[i] - eq[i]));
    for (const row of r.p) {
      let sum = 0;
      for (const v of row) {
        assert.ok(Number.isFinite(v) && v >= 0);
        sum += v;
      }
      assert.ok(sum <= 1 - D + 1e-9, `over-filled: ${sum} > ${1 - D}`);
    }
    log(`D=${D}: after 6000 yr max |p − p*| = ${worst.toExponential(2)}; lost ${eq.filter((v) => v === 0).length} species`);
    assert.ok(worst < 1e-6);
  }
});

test('the best competitor declines as an exact logistic: RK4 matches the closed form to 1e-10', () => {
  const c = M.geometricRates(10, 0.2, 0.02);
  let worst = 0;
  for (const D of [0.25, 0.3, 0.4, 0.5]) {
    const p0 = M.equilibrium(c, 0.02, 0);
    for (let i = 0; i < 10; i++) p0[i] *= 1 - D; // clearing kills what stands on the cleared sites
    const r = M.integrate(p0, c, 0.02, D, 2000, 10);
    for (let k = 0; k < r.t.length; k++) {
      const cf = M.topSpeciesClosedForm(p0[0], c[0], 0.02, D, r.t[k]);
      worst = Math.max(worst, Math.abs(cf - r.p[k][0]));
    }
    const rate = M.topSpeciesRate(c[0], 0.02, D);
    assert.ok(Math.abs(rate - 0.02 * (0.2 - D) / 0.8) < 1e-15, 'r_1 = m (q − D) / (1 − q)');
    log(`README D=${D}: r_1 = ${rate.toFixed(5)}/yr, time constant 1/|r_1| = ${(1 / Math.abs(rate)).toFixed(0)} yr`);
  }
  log(`max |closed form − RK4| = ${worst.toExponential(2)}`);
  assert.ok(worst < 1e-10);
});

test('invasion rate sign agrees with the equilibrium formula', () => {
  const c = M.geometricRates(12, 0.15, 0.1);
  for (let n = 0; n < 200; n++) {
    const D = n / 200;
    const eq = M.equilibrium(c, 0.1, D);
    for (let i = 0; i < 12; i++) {
      const g = M.invasionRate(c, 0.1, D, eq, i);
      if (eq[i] > 0) assert.ok(g > -1e-9, `present species should be able to invade (D=${D}, i=${i}, g=${g})`);
      else assert.ok(g <= 1e-9, `absent species should not be able to invade (D=${D}, i=${i}, g=${g})`);
    }
  }
});

test('forecast: extinction years and the debt count', () => {
  const c = M.geometricRates(10, 0.2, 0.02);
  const eq0 = M.equilibrium(c, 0.02, 0);
  const N = 10000;
  const etas = {};
  for (const D of [0.25, 0.3, 0.4, 0.5]) {
    const p0 = Float64Array.from(eq0, (v) => v * (1 - D));
    const f = M.forecast(p0, c, 0.02, D, 1 / N, 50000, 10);
    const debt = f.doomed.filter(Boolean).length;
    etas[D] = f.eta[0];
    log(`README D=${D}: debt = ${debt} species; rank 1 falls below 1 tree in ${N} after ${f.eta[0].toFixed(0)} yr` + (debt > 1 ? `; rank 2 after ${f.eta[1].toFixed(0)} yr` : ''));
    assert.equal(debt, D < 0.488 ? 1 : 2);
    for (let i = 0; i < 10; i++) assert.equal(f.doomed[i], f.eq[i] === 0);
    // the forecast year is consistent with the closed form crossing of the floor
    const t = f.eta[0];
    assert.ok(M.topSpeciesClosedForm(p0[0], c[0], 0.02, D, t) <= 1 / N && M.topSpeciesClosedForm(p0[0], c[0], 0.02, D, t - 1) > 1 / N);
  }
  // README: #1 starts as the commonest tree but is overtaken within about a century, a few % of its decline
  for (const D of [0.21, 0.25, 0.3, 0.4, 0.5]) {
    const p0 = Float64Array.from(eq0, (v) => v * (1 - D));
    const r = M.integrate(p0, c, 0.02, D, 400, 1, 0.5);
    const k = r.p.findIndex((row) => Math.max(...row.slice(1)) > row[0]);
    const f = M.forecast(p0, c, 0.02, D, 1 / N, 50000, 10);
    log(`README D=${D}: #1 stops being the commonest after ${r.t[k].toFixed(0)} yr, ${((100 * r.t[k]) / f.eta[0]).toFixed(1)} % of the ${f.eta[0].toFixed(0)} yr it takes to fall below 1/${N}`);
    assert.ok(r.t[k] > 60 && r.t[k] < 125 && r.t[k] / f.eta[0] < 0.08);
  }
  // README numbers (years, from the moment of clearing, default forest of 10,000 sites)
  assert.ok(Math.abs(etas[0.25] - 4743) < 5, `eta(0.25)=${etas[0.25]}`);
  assert.ok(Math.abs(etas[0.3] - 2548) < 5, `eta(0.3)=${etas[0.3]}`);
  assert.ok(Math.abs(etas[0.4] - 1324) < 5, `eta(0.4)=${etas[0.4]}`);
  assert.ok(Math.abs(etas[0.5] - 883) < 5, `eta(0.5)=${etas[0.5]}`);
  // README: "clear 30 % … gone by about year 2,560"; a third would be about 1,950
  const third = M.forecast(Float64Array.from(eq0, (v) => (v * 2) / 3), c, 0.02, 1 / 3, 1 / N, 50000, 10).eta[0];
  log(`README: a third cleared, #1 below 1/${N} after ${third.toFixed(0)} yr`);
  assert.ok(Math.abs(third - 1951) < 5);
});

test('what is and is not a property of the geometric trade-off: abundance order, and strict best-first extinction', () => {
  const m = 1;
  // 1. any abundances can come from a competition–colonisation trade-off: invert p* for c (Tilman 1994's form)
  const S = 10;
  const target = Array.from({ length: S }, (_, i) => 0.2 * Math.pow(0.8, S - 1 - i)); // #1 the RAREST
  const c = [];
  for (let i = 0; i < S; i++) {
    let num = m;
    let den = 1 - target[i];
    for (let j = 0; j < i; j++) {
      num += c[j] * target[j];
      den -= target[j];
    }
    c.push(num / den);
  }
  for (let i = 1; i < S; i++) assert.ok(c[i] > c[i - 1], 'still a trade-off: worse competitors colonise faster');
  const eq = M.equilibrium(c, m, 0);
  for (let i = 0; i < S; i++) assert.ok(Math.abs(eq[i] - target[i]) < 1e-12);
  const t1 = M.threshold(c, m, 0);
  log(`README: reversed abundances (#1 rarest at ${(100 * target[0]).toFixed(1)} %) need c/m = ${c.map((v) => v.toFixed(2)).join(' ')}; #1 is then doomed from D = ${(100 * t1).toFixed(1)} %`);
  // whatever the rates, #1 is doomed once the cleared share exceeds its own undisturbed share 1 − m/c1
  assert.ok(Math.abs(t1 - eq[0]) < 1e-8);
  // 2. strict rank order is a knife-edge: nudge every c_i of the geometric trade-off at random
  const c0 = M.geometricRates(10, 0.2, m);
  const rand = M.mulberry32(7);
  for (const amp of [0.001, 0.01]) {
    let oneFirst = 0;
    const widths = [];
    for (let draw = 0; draw < 200; draw++) {
      const cc = Array.from(c0, (v) => v * (1 + 2 * amp * (rand() - 0.5)));
      let first = 0;
      let outOfOrder = 0;
      const n = 4000;
      for (let k = 1; k <= n; k++) {
        const D = (0.99 * k) / n;
        const e = M.equilibrium(cc, m, D);
        let lost = 0;
        while (lost < 10 && e[lost] === 0) lost++;
        let bad = false;
        for (let i = lost; i < 10; i++) if (e[i] === 0) bad = true;
        if (bad) outOfOrder++;
        if (!first) {
          const z = e.findIndex((v) => v === 0);
          if (z >= 0) first = z + 1;
        }
      }
      if (first === 1) oneFirst++;
      assert.equal(first % 2, 1, 'when #1 is not first, an odd rank is');
      widths.push((0.99 * outOfOrder) / n);
    }
    widths.sort((a, b) => a - b);
    log(`README: c_i nudged by up to ±${100 * amp} %: #1 is the first species lost in ${oneFirst}/200 draws; out-of-order range of D, median ${(100 * widths[100]).toFixed(1)} percentage points`);
    assert.ok(oneFirst < 100, 'best-first is not robust');
    assert.ok(widths[100] > 0);
  }
});

// ---------------------------------------------------------------- the lattice

test('lattice: one species sits at q on average, counts stay consistent, and clearing is exact', () => {
  const c = M.geometricRates(1, 0.2, 0.02);
  const L = new M.Lattice(100, 100, c, 0.02, 7);
  L.seed(M.equilibrium(c, 0.02, 0));
  let sum = 0;
  let n = 0;
  while (L.time < 3000) {
    L.step();
    if (L.time > 200) {
      sum += L.fractions()[0];
      n++;
    }
  }
  const avg = sum / n;
  log(`S=1 lattice (100×100, 2800 yr average): ${avg.toFixed(4)} vs q = 0.2`);
  assert.ok(Math.abs(avg - 0.2) < 0.004);
  assert.ok(L.audit());
  assert.equal(L.counts[0] + L.counts[1] + L.destroyed, L.N);
  L.destroyRandom(0.37);
  assert.equal(L.destroyed, 3700);
  assert.ok(L.audit());
  L.restoreRandom(0.1);
  assert.equal(L.destroyed, 1000);
  assert.ok(L.audit());
  // the hand tools
  assert.ok(L.destroySite(5) || L.state[5] === M.DESTROYED);
  assert.ok(L.restoreSite(5));
  assert.equal(L.state[5], M.EMPTY);
  assert.ok(L.audit());
});

test('lattice: ten species hold their predicted shares (200×200, long average, 8 seeds)', () => {
  const c = M.geometricRates(10, 0.2, 0.02);
  const eq = M.equilibrium(c, 0.02, 0);
  const gaps = [];
  let L;
  for (let seed = 11; seed <= 18; seed++) {
    L = new M.Lattice(200, 200, c, 0.02, seed);
    L.seed(eq);
    const avg = new Float64Array(10);
    let n = 0;
    while (L.time < 2000) {
      L.step();
      if (L.time > 400) {
        const f = L.fractions();
        for (let i = 0; i < 10; i++) avg[i] += f[i];
        n++;
      }
    }
    let worst = 0;
    for (let i = 0; i < 10; i++) {
      avg[i] /= n;
      worst = Math.max(worst, Math.abs(avg[i] - eq[i]));
    }
    if (seed === 11) {
      log('lattice average (seed 11)', fmt(avg, 4));
      log('predicted                ', fmt(eq, 4));
    }
    gaps.push(worst);
    assert.ok(L.audit());
  }
  log(`README: worst |lattice − p*| per seed 11–18: ${gaps.map((v) => v.toFixed(4)).join(' ')} (range ${Math.min(...gaps).toFixed(3)}–${Math.max(...gaps).toFixed(3)}; demographic noise is ~sqrt(p/N) ≈ ${Math.sqrt(0.2 / 40000).toFixed(4)} per snapshot)`);
  for (const g of gaps) assert.ok(g < 0.01);
  const f = L.fractions();
  const lambdaMax = 0.02 + Array.from(c).reduce((a, ci, i) => a + ci * f[i], 0);
  log(`per-site event probability per step: ${(L.nextDt() * lambdaMax).toFixed(4)} (cap 0.05), dt = ${L.nextDt().toFixed(3)} yr`);
  assert.ok(L.nextDt() * lambdaMax <= 0.05 + 1e-12, 'per-site event probability stays ≤ 5% per step');
});

test('lattice vs forecast after clearing 40%: the mean of 8 forests tracks the ODE, and the last tree dies near the forecast year', () => {
  const c = M.geometricRates(10, 0.2, 0.02);
  const eq0 = M.equilibrium(c, 0.02, 0);
  const D = 0.4;
  const checks = [200, 400, 800, 1200];
  const R = 8;
  const sums = checks.map(() => new Float64Array(10));
  const p0mean = new Float64Array(10);
  const lastTree = [];
  for (let r = 0; r < R; r++) {
    const L = new M.Lattice(100, 100, c, 0.02, 100 + r);
    L.seed(eq0);
    L.advance(300);
    L.destroyRandom(D);
    assert.equal(L.D, 0.4);
    const start = L.time;
    const p0 = L.fractions();
    for (let i = 0; i < 10; i++) p0mean[i] += p0[i] / R;
    let ci = 0;
    while (ci < checks.length) {
      L.step();
      if (L.time - start >= checks[ci]) {
        const f = L.fractions();
        for (let i = 0; i < 10; i++) sums[ci][i] += f[i] / R;
        ci++;
      }
    }
    while (L.counts[1] > 0 && L.time - start < 6000) L.step();
    assert.ok(L.audit());
    lastTree.push(L.extinctAt[0] - start);
  }
  const ode = M.integrate(p0mean, c, 0.02, D, 1200, 200);
  // Early on the ensemble mean must follow the ODE closely. Later, rank 1 dies by chance in some
  // forests centuries before the deterministic curve reaches 1/N, which releases the ranks beneath
  // it in those forests only, so the mean of a nonlinear system drifts from the ODE of the mean.
  const tolerance = (t) => (t <= 400 ? 0.015 : 0.045);
  for (let ci = 0; ci < checks.length; ci++) {
    const row = ode.p[ci + 1];
    let w = 0;
    for (let i = 0; i < 10; i++) w = Math.max(w, Math.abs(row[i] - sums[ci][i]));
    log(`t=+${checks[ci]} yr: lattice mean ${fmt(sums[ci], 3)} | ODE ${fmt(row, 3)} | worst gap ${w.toFixed(3)} (allowed ${tolerance(checks[ci])})`);
    assert.ok(w < tolerance(checks[ci]), `lattice mean departs from the ODE by ${w} at +${checks[ci]} yr`);
  }
  const f = M.forecast(p0mean, c, 0.02, D, 1e-4, 20000, 10);
  const mean = lastTree.reduce((a, b) => a + b, 0) / R;
  log(`README: last tree of rank 1 died after ${lastTree.map((v) => v.toFixed(0)).join(', ')} yr (mean ${mean.toFixed(0)}); forecast crossing of 1/N: ${f.eta[0].toFixed(0)} yr`);
  for (const t of lastTree) assert.ok(t > 0.4 * f.eta[0] && t < 1.4 * f.eta[0], `last-tree time ${t} far from forecast ${f.eta[0]}`);
  assert.ok(Math.abs(mean - f.eta[0]) < 0.3 * f.eta[0]);
});

test('lattice: restoring the land before the debt is paid rescues the doomed species', () => {
  const c = M.geometricRates(10, 0.2, 0.02);
  const eq0 = M.equilibrium(c, 0.02, 0);
  const L = new M.Lattice(100, 100, c, 0.02, 5);
  L.seed(eq0);
  L.advance(200);
  L.destroyRandom(0.4);
  const start = L.time;
  L.advance(400); // rank 1 is sliding toward extinction
  const mid = L.fractions()[0];
  assert.ok(mid > 0 && mid < 0.05, `rank 1 should be rare but present: ${mid}`);
  assert.ok(M.equilibrium(c, 0.02, L.D)[0] === 0, 'doomed while D = 0.4');
  L.restoreRandom(0.1);
  assert.equal(L.D, 0.1);
  assert.ok(M.equilibrium(c, 0.02, L.D)[0] > 0, 'safe again at D = 0.1');
  L.advance(1500);
  const after = L.fractions()[0];
  log(`rank 1 share: ${mid.toFixed(4)} at +400 yr under 40% destruction → ${after.toFixed(4)} 1500 yr after restoring to 10% (predicted ${M.equilibrium(c, 0.02, 0.1)[0].toFixed(3)})`);
  assert.ok(Math.abs(after - 0.1) < 0.02);
  assert.ok(L.time - start > 1900);
});
