// Physics verification for The Hill That Holds.  From the repo root run:
//   node --test ideas/03-hill-that-holds/physics.test.mjs
// (or plain `node` on the file). Prints the measured numbers as it goes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const P = createRequire(import.meta.url)('./physics.js');
const { TAU, DT, STEPS_PER_ORBIT, TICK_STEPS, ROUTH_MU } = P;
const ORBIT = STEPS_PER_ORBIT; // steps per planet-year
const log = (...a) => console.log('   ', ...a);

/** Integrate n planet-years in chunks of one tick, calling probe(state, tick) after every tick. */
function run(s, mu, coriolis, years, probe, radii = null, rEsc = 0) {
  const ticks = Math.round((years * ORBIT) / TICK_STEPS);
  for (let k = 1; k <= ticks; k++) {
    const fate = P.integrate(s, mu, coriolis, TICK_STEPS, radii, rEsc);
    if (probe) probe(s, k);
    if (fate) return { fate, ticks: k };
  }
  return { fate: 0, ticks };
}

function jacobiDrift(s0, mu, coriolis, years, radii = null) {
  const s = { ...s0 };
  const C0 = P.jacobi(s, mu);
  let max = 0;
  const res = run(s, mu, coriolis, years, (st) => { max = Math.max(max, Math.abs(P.jacobi(st, mu) - C0)); }, radii, radii ? 5 : 0);
  return { max, rel: max / Math.abs(C0), C0, ...res };
}

test('Lagrange points are equilibria; L4/L5 form equilateral triangles', () => {
  const g = [0, 0];
  for (const mu of [1e-4, 0.000954, 0.0122, 0.0385, 0.1086]) {
    const L = P.lagrangePoints(mu);
    for (const [name, [x, y]] of Object.entries(L)) {
      P.gradOmega(x, y, mu, g);
      assert.ok(Math.hypot(g[0], g[1]) < 1e-11, `${name} grad ${g} at mu=${mu}`);
    }
    const [x4, y4] = L.L4;
    assert.ok(Math.abs(Math.hypot(x4 + mu, y4) - 1) < 1e-14);
    assert.ok(Math.abs(Math.hypot(x4 - 1 + mu, y4) - 1) < 1e-14);
  }
});

test('L4 is a hilltop of effective potential energy (−Ω has a local maximum there)', () => {
  for (const mu of [0.000954, 0.01, 0.1]) {
    const [x, y] = P.lagrangePoints(mu).L4;
    const h = 1e-4;
    const f = (a, b) => -P.omega(a, b, mu);
    const fxx = (f(x + h, y) - 2 * f(x, y) + f(x - h, y)) / (h * h);
    const fyy = (f(x, y + h) - 2 * f(x, y) + f(x, y - h)) / (h * h);
    const fxy = (f(x + h, y + h) - f(x + h, y - h) - f(x - h, y + h) + f(x - h, y - h)) / (4 * h * h);
    const tr = fxx + fyy, det = fxx * fyy - fxy * fxy;
    // Analytic Hessian of Ω at L4: Ωxx = 3/4, Ωyy = 9/4, Ωxy = (3√3/4)(1−2μ).
    assert.ok(Math.abs(fxx + 0.75) < 1e-5 && Math.abs(fyy + 2.25) < 1e-5);
    assert.ok(Math.abs(fxy + (3 * Math.sqrt(3) / 4) * (1 - 2 * mu)) < 1e-5);
    assert.ok(tr < 0 && det > 0, `negative definite at mu=${mu}: tr=${tr} det=${det}`);
  }
});

test('two-body limit (mu = 0): circular orbit period matches 2π√(a³/GM)', () => {
  for (const a of [0.6, 1.5, 2.0]) {
    // Inertial circular orbit, GM_star = 1, start on +x axis, converted to rotating coordinates at t = 0.
    const v = Math.sqrt(1 / a);
    const s = P.fromInertial({ x: a, y: 0, vx: 0, vy: v }, 0);
    let t = 0, prevAng = 0, unwrapped = 0, rDev = 0, tCross = NaN;
    const revs = 3;
    const target = revs * TAU;
    const Tkepler = TAU * Math.sqrt(a ** 3);
    while (t < Tkepler * revs * 1.01) {
      P.integrate(s, 0, true, 1, null, 0);
      t += DT;
      const I = P.toInertial(s, t);
      const ang = Math.atan2(I.y, I.x);
      let d = ang - prevAng;
      if (d < -Math.PI) d += TAU;
      if (d > Math.PI) d -= TAU;
      const before = unwrapped;
      unwrapped += d;
      prevAng = ang;
      rDev = Math.max(rDev, Math.abs(Math.hypot(I.x, I.y) - a) / a);
      if (before < target && unwrapped >= target) tCross = t - DT + DT * (target - before) / (unwrapped - before);
    }
    const T = tCross / revs;
    const relErr = Math.abs(T - Tkepler) / Tkepler;
    log(`a=${a}: period ${T.toFixed(10)} vs 2π√a³ = ${Tkepler.toFixed(10)}  rel.err ${relErr.toExponential(2)}, radius dev ${rDev.toExponential(2)}`);
    assert.ok(relErr < 1e-6, `period error ${relErr}`);
    assert.ok(rDev < 1e-7, `radius deviation ${rDev}`);
  }
});

test('two-body limit: eccentric orbit conserves energy (bounded) and angular momentum (to round-off) over 300 orbits', () => {
  const a = 1.3, e = 0.5;
  const rp = a * (1 - e), vp = Math.sqrt((1 + e) / rp); // GM = 1
  const s = P.fromInertial({ x: rp, y: 0, vx: 0, vy: vp }, 0);
  const E = (I) => 0.5 * (I.vx ** 2 + I.vy ** 2) - 1 / Math.hypot(I.x, I.y);
  const Lz = (I) => I.x * I.vy - I.y * I.vx;
  const I0 = P.toInertial(s, 0);
  const E0 = E(I0), L0 = Lz(I0);
  const Torb = TAU * Math.sqrt(a ** 3);
  const n = Math.round((300 * Torb) / DT);
  let dE = 0, dL = 0, t = 0, dEfirst = 0;
  for (let i = 1; i <= n; i++) {
    P.integrate(s, 0, true, 1, null, 0);
    t += DT;
    if (i % 7 === 0) {
      const I = P.toInertial(s, t);
      const de = Math.abs(E(I) - E0) / Math.abs(E0);
      dE = Math.max(dE, de);
      if (t < 10 * Torb) dEfirst = Math.max(dEfirst, de);
      dL = Math.max(dL, Math.abs(Lz(I) - L0) / Math.abs(L0));
    }
  }
  log(`e=0.5 orbit, 300 orbits (${n} steps): max |ΔE/E| = ${dE.toExponential(2)} (first 10 orbits: ${dEfirst.toExponential(2)}), max |ΔL/L| = ${dL.toExponential(2)}`);
  assert.ok(dE < 1e-7, `energy drift ${dE}`);
  assert.ok(dE < 3 * dEfirst + 1e-15, 'energy error should stay bounded, not grow secularly');
  assert.ok(dL < 1e-12, `angular momentum drift ${dL}`); // exact in exact arithmetic; what remains is round-off
});

test('CR3BP: Jacobi constant conserved for tadpole, horseshoe, close-encounter and Coriolis-off orbits', () => {
  const muJ = 0.000954;
  const L = P.lagrangePoints(muJ);
  const phi = Math.PI / 3 + 0.4;
  const rc = P.crestRadius(phi, muJ);
  const tadpole = P.makeState(rc * Math.cos(phi), rc * Math.sin(phi), 0, 0);
  const horseshoe = P.makeState(-1.002, 0.01, 0, 0);
  const close = P.makeState(Math.cos(0.35), Math.sin(0.35), 0, 0); // drops toward the planet's L1/L2 region at mu=0.01
  const offHill = P.makeState(L.L4[0] + 1e-3, L.L4[1], 0, 0);

  const a = jacobiDrift(tadpole, muJ, true, 1000);
  log(`tadpole (mu=${muJ}), 1000 planet-years: C0=${a.C0.toFixed(9)} max |ΔC| = ${a.max.toExponential(2)} (rel ${a.rel.toExponential(2)})`);
  assert.ok(a.rel < 1e-10);

  const b = jacobiDrift(horseshoe, muJ, true, 1000);
  log(`horseshoe (mu=${muJ}), 1000 planet-years: max |ΔC| = ${b.max.toExponential(2)} (rel ${b.rel.toExponential(2)})`);
  assert.ok(b.rel < 1e-9);

  const radii = P.bodyRadii(0.01);
  const c = jacobiDrift(close, 0.01, true, 200, radii);
  log(`close-encounter orbit (mu=0.01), ${(c.ticks * TICK_STEPS / ORBIT).toFixed(1)} planet-years until fate=${c.fate}: max |ΔC| = ${c.max.toExponential(2)} (rel ${c.rel.toExponential(2)})`);
  assert.ok(c.rel < 1e-6);

  const d = jacobiDrift(offHill, muJ, false, 4, P.bodyRadii(muJ));
  log(`Coriolis OFF, rolling off L4: ${(d.ticks * TICK_STEPS / ORBIT).toFixed(2)} planet-years until fate=${d.fate}: max |ΔC| = ${d.max.toExponential(2)} (rel ${d.rel.toExponential(2)})`);
  assert.ok(d.rel < 1e-8);
});

test('symplectic: no secular Jacobi drift (error in years 900–1000 ≈ error in years 0–100)', () => {
  const mu = 0.01;
  const phi = Math.PI / 3 + 0.25;
  const rc = P.crestRadius(phi, mu);
  const s = P.makeState(rc * Math.cos(phi), rc * Math.sin(phi), 0, 0);
  const C0 = P.jacobi(s, mu);
  const perYear = ORBIT / TICK_STEPS;
  let early = 0, late = 0;
  run(s, mu, true, 1000, (st, k) => {
    const d = Math.abs(P.jacobi(st, mu) - C0);
    if (k <= 100 * perYear) early = Math.max(early, d);
    if (k > 900 * perYear) late = Math.max(late, d);
  });
  log(`mu=0.01 tadpole: max |ΔC| years 0–100 = ${early.toExponential(2)}, years 900–1000 = ${late.toExponential(2)}`);
  assert.ok(late < 3 * early + 1e-15);
});

test('small libration about L4 has the linear-theory period 2π/s, s² = (1 − √(1 − 27μ(1−μ)))/2', () => {
  for (const mu of [0.001, 0.01, 0.03]) {
    const [x4, y4] = P.lagrangePoints(mu).L4;
    const tx = -y4, ty = x4; // tangential direction
    const s = P.makeState(x4 + 1e-5 * tx, y4 + 1e-5 * ty, 0, 0);
    const samples = [];
    run(s, mu, true, 80, (st, k) => samples.push([k * TICK_STEPS * DT, (st.x - x4) * tx + (st.y - y4) * ty]));
    // Average over one planet-year to remove the fast (≈1/year) epicycle, then time the zero crossings.
    const W = ORBIT / TICK_STEPS;
    const sm = [];
    let acc = 0;
    for (let i = 0; i < samples.length; i++) {
      acc += samples[i][1];
      if (i >= W) acc -= samples[i - W][1];
      if (i >= W) sm.push([samples[i][0] - (W * TICK_STEPS * DT) / 2, acc / W]);
    }
    const zc = [];
    for (let i = 1; i < sm.length; i++) {
      if ((sm[i - 1][1] < 0) !== (sm[i][1] < 0)) zc.push(sm[i - 1][0] + ((sm[i][0] - sm[i - 1][0]) * -sm[i - 1][1]) / (sm[i][1] - sm[i - 1][1]));
    }
    const T = (2 * (zc[zc.length - 1] - zc[0])) / (zc.length - 1);
    const Tlin = TAU / P.l4Linear(mu).sLong;
    const rel = Math.abs(T - Tlin) / Tlin;
    log(`mu=${mu}: libration period ${(T / TAU).toFixed(5)} planet-years, linear theory ${(Tlin / TAU).toFixed(5)}  (rel.err ${rel.toExponential(2)})`);
    assert.ok(rel < 1e-3);
  }
});

test('Routh threshold: L4 holds below mu = 0.03852 and fails above, at the predicted growth rate', () => {
  assert.ok(Math.abs(27 * ROUTH_MU * (1 - ROUTH_MU) - 1) < 1e-12);
  assert.equal(P.l4Linear(ROUTH_MU - 1e-6).stable, true);
  assert.equal(P.l4Linear(ROUTH_MU + 1e-6).stable, false);

  const kick = 1e-7;
  for (const mu of [0.03, 0.037]) {
    const [x4, y4] = P.lagrangePoints(mu).L4;
    const s = P.makeState(x4 + kick, y4, 0, 0);
    let maxd = 0;
    run(s, mu, true, 100, (st) => { maxd = Math.max(maxd, Math.hypot(st.x - x4, st.y - y4)); });
    log(`mu=${mu} (below Routh): 1e-7 nudge, max excursion over 100 years = ${maxd.toExponential(2)}`);
    assert.ok(maxd < 1e-4);
  }
  for (const mu of [0.045, 0.06]) {
    const [x4, y4] = P.lagrangePoints(mu).L4;
    const s = P.makeState(x4 + kick, y4, 0, 0);
    const pts = [];
    run(s, mu, true, 30, (st, k) => pts.push([k * TICK_STEPS * DT, Math.hypot(st.x - x4, st.y - y4)]));
    // Fit the exponential growth rate between excursions of 1e-5 and 1e-3 (still linear regime).
    // The excursion oscillates on top of the growth, so this two-point fit is only good to ~10%.
    const i1 = pts.findIndex((p) => p[1] > 1e-5), i2 = pts.findIndex((p) => p[1] > 1e-3);
    const rate = Math.log(pts[i2][1] / pts[i1][1]) / (pts[i2][0] - pts[i1][0]);
    const pred = P.l4Linear(mu).growthRate;
    log(`mu=${mu} (above Routh): measured growth rate ${rate.toFixed(4)} /time unit, linear theory ${pred.toFixed(4)}; reaches 1e-3 after ${(pts[i2][0] / TAU).toFixed(1)} years`);
    assert.ok(Math.abs(rate - pred) / pred < 0.15);
  }
});

test('linear stability is necessary, not sufficient: 3:1 and 2:1 resonances, and the marginal limit', () => {
  // Analytic: sShort/sLong = n  ⇔  27μ(1−μ) = 4n²/(1+n²)². Literature values: 0.0135160 (3:1), 0.0242939 (2:1).
  assert.ok(Math.abs(P.resonantMu(1) - ROUTH_MU) < 1e-15);
  assert.ok(Math.abs(P.resonantMu(3) - 0.013516) < 1e-6);
  assert.ok(Math.abs(P.resonantMu(2) - 0.0242939) < 1e-6);
  for (const n of [2, 3]) assert.ok(Math.abs(P.l4Linear(P.resonantMu(n)).ratio - n) < 1e-9);
  // Exactly at the limit the frequencies merge (double root): flagged marginal, not linearly stable.
  const lim = P.l4Linear(ROUTH_MU);
  assert.equal(lim.marginal, true);
  assert.equal(lim.stable, false);
  assert.equal(P.l4Linear(0.0385).marginal, false);
  assert.equal(P.l4Linear(0.0385).stable, true);

  // Numerical: an at-rest 0.01 nudge from L4 along +x, 100 planet-years, app collision radii.
  function nudge(mu) {
    const [x4, y4] = P.lagrangePoints(mu).L4;
    const s = P.makeState(x4 + 0.01, y4, 0, 0);
    let maxd = 0, lostAt = NaN;
    const r = run(s, mu, true, 100, (st, k) => {
      maxd = Math.max(maxd, Math.hypot(st.x - x4, st.y - y4));
      if (Number.isNaN(lostAt) && maxd > 0.5) lostAt = (k * TICK_STEPS) / ORBIT;
    }, P.bodyRadii(mu), 3);
    if (r.fate && Number.isNaN(lostAt)) lostAt = (r.ticks * TICK_STEPS) / ORBIT;
    return { maxd, lostAt };
  }
  for (const n of [3, 2]) {
    const mu = P.resonantMu(n), o = nudge(mu);
    log(`${n}:1 resonance, mu=${mu.toFixed(6)} (27μ(1−μ)=${(27 * mu * (1 - mu)).toFixed(3)} < 1): 0.01 nudge lost after ${o.lostAt.toFixed(1)} years`);
    assert.ok(o.lostAt < 100);
  }
  for (const mu of [0.0145, 0.02]) {
    const o = nudge(mu);
    log(`non-resonant neighbour mu=${mu}: same nudge, max excursion ${o.maxd.toFixed(3)} over 100 years`);
    assert.ok(Number.isNaN(o.lostAt) && o.maxd < 0.3);
  }
});

test('the counterfactual: without Coriolis a marble rolls off the L4 hilltop; with it, it stays', () => {
  const mu = 0.000954;
  const [x4, y4] = P.lagrangePoints(mu).L4;
  const on = P.makeState(x4 + 1e-6, y4, 0, 0);
  const off = { ...on };
  let maxOn = 0;
  run(on, mu, true, 50, (st) => { maxOn = Math.max(maxOn, Math.hypot(st.x - x4, st.y - y4)); });
  let tOff = NaN;
  run(off, mu, false, 5, (st, k) => {
    if (Number.isNaN(tOff) && Math.hypot(st.x - x4, st.y - y4) > 0.1) tOff = (k * TICK_STEPS) / ORBIT;
  });
  log(`1e-6 nudge at L4: Coriolis ON max excursion in 50 years = ${maxOn.toExponential(2)}; Coriolis OFF reaches 0.1 away after ${tOff.toFixed(2)} years`);
  assert.ok(maxOn < 1e-4);
  assert.ok(tOff < 3);
});

test('tadpoles circle the hilltop clockwise (like wind round a northern-hemisphere high)', () => {
  const mu = 0.01;
  const [x4, y4] = P.lagrangePoints(mu).L4;
  const phi = Math.PI / 3 + 0.15, rc = P.crestRadius(phi, mu);
  const s = P.makeState(rc * Math.cos(phi), rc * Math.sin(phi), 0, 0);
  let area = 0, px = s.x - x4, py = s.y - y4;
  run(s, mu, true, 20, (st) => {
    const qx = st.x - x4, qy = st.y - y4;
    area += px * qy - py * qx;
    px = qx; py = qy;
  });
  log(`signed area swept about L4 over 20 years: ${area.toFixed(4)} (negative = clockwise)`);
  assert.ok(area < 0);
});

test('frame-rate independence: 30 Hz, 60 Hz, 144 Hz and jittery frames give bit-identical trajectories', () => {
  const mu = 0.01;
  const start = P.makeState(0.3, 0.9, 0.01, -0.02);
  const radii = P.bodyRadii(mu);
  function drive(frameDt, seconds, jitter) {
    const clock = P.makeClock(2.5);
    const s = { ...start };
    let wall = 0, seed = 7;
    const snaps = new Map();
    while (wall < seconds) {
      let dt = frameDt;
      if (jitter) { seed = (seed * 16807) % 2147483647; dt = frameDt * (0.3 + 1.4 * (seed / 2147483647)); }
      wall += dt;
      const n = P.clockTicks(clock, dt, 4, Infinity);
      for (let i = 0; i < n; i++) {
        P.integrate(s, mu, true, TICK_STEPS, radii, 5);
        const tick = clock.ticks - n + i + 1;
        if (tick % 500 === 0) snaps.set(tick, `${s.x},${s.y},${s.px},${s.py}`);
      }
    }
    return { snaps, ticks: clock.ticks, wall };
  }
  const runs = [drive(1 / 30, 20, false), drive(1 / 60, 20, false), drive(1 / 144, 20, false), drive(1 / 60, 20, true)];
  const common = [...runs[0].snaps.keys()].filter((k) => runs.every((r) => r.snaps.has(k)));
  assert.ok(common.length >= 5);
  for (const k of common) for (const r of runs) assert.equal(r.snaps.get(k), runs[0].snaps.get(k), `tick ${k}`);
  const rate = (4 * P.TICKS_PER_ORBIT) / 2.5; // ticks per wall second at 4×
  log(`ticks after ~20 s at 4×: ${runs.map((r) => `${r.ticks} (wall ${r.wall.toFixed(4)} s → expect ${Math.floor(r.wall * rate + 1e-9)})`).join(', ')}; ${common.length} checkpoints bit-identical`);
  for (const r of runs) assert.ok(Math.abs(r.ticks - r.wall * rate) < 1.5);
});

test('rotating ↔ inertial conversion round-trips', () => {
  const s = P.makeState(0.3, -0.7, 0.12, 0.05);
  for (const t of [0, 1.234, 1e4 + 0.5]) {
    const back = P.fromInertial(P.toInertial(s, t), t);
    for (const k of ['x', 'y', 'px', 'py']) assert.ok(Math.abs(back[k] - s[k]) < 1e-12);
  }
  const [vx, vy] = P.velocity(s);
  assert.ok(Math.abs(vx - 0.12) < 1e-15 && Math.abs(vy - 0.05) < 1e-15);
});
