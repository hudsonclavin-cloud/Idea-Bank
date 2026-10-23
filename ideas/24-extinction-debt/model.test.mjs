// Verification for The Extinction Debt. From the repo root run:
//   node --test ideas/24-extinction-debt/model.test.mjs
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
  // README numbers (years, from the moment of clearing, default forest of 10,000 sites)
  assert.ok(Math.abs(etas[0.25] - 4743) < 5, `eta(0.25)=${etas[0.25]}`);
  assert.ok(Math.abs(etas[0.3] - 2548) < 5, `eta(0.3)=${etas[0.3]}`);
  assert.ok(Math.abs(etas[0.4] - 1324) < 5, `eta(0.4)=${etas[0.4]}`);
  assert.ok(Math.abs(etas[0.5] - 883) < 5, `eta(0.5)=${etas[0.5]}`);
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

test('lattice: ten species hold their predicted shares (200×200, long average)', () => {
  const c = M.geometricRates(10, 0.2, 0.02);
  const eq = M.equilibrium(c, 0.02, 0);
  const L = new M.Lattice(200, 200, c, 0.02, 11);
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
  log('lattice average', fmt(avg, 4));
  log('predicted      ', fmt(eq, 4));
  log(`worst |lattice − p*| = ${worst.toFixed(4)} (demographic noise is ~sqrt(p/N) ≈ ${Math.sqrt(0.2 / 40000).toFixed(4)} per snapshot)`);
  assert.ok(worst < 0.008);
  assert.ok(L.audit());
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
