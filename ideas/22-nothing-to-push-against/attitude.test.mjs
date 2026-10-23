// Physics verification for Nothing to Push Against. From the repo root:
//   node --test ideas/22-nothing-to-push-against/attitude.test.mjs
// Prints the measured numbers as it goes; the README quotes them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const A = createRequire(import.meta.url)('./attitude.js');
const { DT, G0 } = A;
const log = (...a) => console.log('   ', ...a);
const deg = (r) => (r * 180) / Math.PI;

function fresh(over) {
  const p = A.makeParams(Object.assign({ tauDist: [0, 0, 0] }, over || {}));
  const s = A.makeState(p);
  return { p, s };
}
function run(s, p, seconds, probe) {
  const n = Math.round(seconds / DT);
  for (let k = 1; k <= n; k++) {
    A.step(s, p);
    if (probe) probe(s, k);
  }
  return n;
}
/** Set a free tumble with wheels empty and controller silent. */
function freeBody(s, p, w) {
  s.ctrl.mode = 'raw';
  s.h = [0, 0, 0];
  s.H = [p.J[0] * w[0], p.J[1] * w[1], p.J[2] * w[2]];
  A.resetLedger(s);
}

// ---------- an independent reference: RK4 on the raw ODE, written without the splitting ----------
//   q̇ = ½ q ⊗ (0, ω),  Ḣ = −ω×H + τ_ext,b,  ḣ = τ_m,   ω = (H − h)/J
function deriv(y, p, tauM, tauExtBody) {
  const q = y.slice(0, 4), H = y.slice(4, 7), h = y.slice(7, 10);
  const w = [(H[0] - h[0]) / p.J[0], (H[1] - h[1]) / p.J[1], (H[2] - h[2]) / p.J[2]];
  const wq = [0, w[0], w[1], w[2]];
  const dq = A.qmul(q, wq, [0, 0, 0, 0]).map((v) => v / 2);
  const dH = [
    -(w[1] * H[2] - w[2] * H[1]) + tauExtBody[0],
    -(w[2] * H[0] - w[0] * H[2]) + tauExtBody[1],
    -(w[0] * H[1] - w[1] * H[0]) + tauExtBody[2],
  ];
  return [...dq, ...dH, ...tauM];
}
function rk4(y, p, dt, tauM, tauExt) {
  const add = (a, b, f) => a.map((v, i) => v + f * b[i]);
  const k1 = deriv(y, p, tauM, tauExt);
  const k2 = deriv(add(y, k1, dt / 2), p, tauM, tauExt);
  const k3 = deriv(add(y, k2, dt / 2), p, tauM, tauExt);
  const k4 = deriv(add(y, k3, dt), p, tauM, tauExt);
  const out = y.map((v, i) => v + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
  const n = Math.hypot(out[0], out[1], out[2], out[3]);
  for (let i = 0; i < 4; i++) out[i] /= n;
  return out;
}

test('quaternion conventions: R(q) matches Rodrigues, q̇ = ½q⊗ω matches the exact single-axis rotation', () => {
  const axis = [0.3, -0.5, 0.8];
  const n = Math.hypot(...axis);
  const u = axis.map((v) => v / n);
  const th = 0.7;
  const q = A.qFromAxisAngle(axis, th, [0, 0, 0, 0]);
  const m = A.qToMat(q, new Float64Array(9));
  const c = Math.cos(th), sn = Math.sin(th);
  // Rodrigues: R = cI + s[u]× + (1−c)uuᵀ
  const R = [
    c + (1 - c) * u[0] * u[0], (1 - c) * u[0] * u[1] - sn * u[2], (1 - c) * u[0] * u[2] + sn * u[1],
    (1 - c) * u[1] * u[0] + sn * u[2], c + (1 - c) * u[1] * u[1], (1 - c) * u[1] * u[2] - sn * u[0],
    (1 - c) * u[2] * u[0] - sn * u[1], (1 - c) * u[2] * u[1] + sn * u[0], c + (1 - c) * u[2] * u[2],
  ];
  for (let i = 0; i < 9; i++) assert.ok(Math.abs(m[i] - R[i]) < 1e-14, `R[${i}]`);
  // active rotation about +z by +90° takes +x to +y
  const qz = A.qFromAxisAngle([0, 0, 1], Math.PI / 2, [0, 0, 0, 0]);
  const v = A.rotate(qz, [1, 0, 0], [0, 0, 0]);
  assert.ok(Math.abs(v[0]) < 1e-15 && Math.abs(v[1] - 1) < 1e-15);
  // a body spinning about its own z at ω for time t ends at q_z(ωt): the drift reproduces it
  const { p, s } = fresh({ J: [2, 2, 2] });
  freeBody(s, p, [0, 0, 0.5]);
  A.drift(s, p, 0.4);
  const want = A.qFromAxisAngle([0, 0, 1], 0.2, [0, 0, 0, 0]);
  for (let i = 0; i < 4; i++) assert.ok(Math.abs(s.q[i] - want[i]) < 1e-15);
  // error vector round-trips
  const e = A.errorVector(q, A.qmul(q, A.qFromAxisAngle([1, 2, 3], 0.9, [0, 0, 0, 0]), [0, 0, 0, 0]), [0, 0, 0]);
  const en = Math.hypot(...e);
  assert.ok(Math.abs(en - 0.9) < 1e-14);
  assert.ok(Math.abs(e[0] / en - 1 / Math.sqrt(14)) < 1e-14);
});

test('splitting agrees with an RK4 reference of the raw ODE (free tumble + wheels + torques)', () => {
  const { p, s } = fresh();
  s.ctrl.mode = 'raw';
  s.h = [0.2, -0.1, 0.05];
  s.H = [p.J[0] * 0.4 + 0.2, p.J[1] * 0.3 - 0.1, p.J[2] * -0.25 + 0.05];
  // constant motor torques and a constant body-frame external torque, both small
  s.ctrl.raw = [0.5, -0.25, 0.1];
  const tauM = s.ctrl.raw.map((f) => f * p.tauMax);
  const tauExt = [2e-4, -1e-4, 3e-4];
  // the splitting takes external torque as an inertial vector; here we want a body-fixed one, so
  // compare the drift+motor part only: run both with tauDist = 0, then a second comparison with an
  // inertial disturbance using the reference's own rotation of it.
  const T = 20;
  let y = [...s.q, ...s.H, ...s.h];
  const n = Math.round(T / DT);
  const fine = 20; // reference sub-steps per DT
  for (let k = 0; k < n; k++) {
    A.step(s, p);
    for (let j = 0; j < fine; j++) y = rk4(y, p, DT / fine, tauM, [0, 0, 0]);
  }
  let maxq = 0, maxH = 0, maxh = 0;
  for (let i = 0; i < 4; i++) maxq = Math.max(maxq, Math.abs(s.q[i] - y[i]));
  for (let i = 0; i < 3; i++) maxH = Math.max(maxH, Math.abs(s.H[i] - y[4 + i]));
  for (let i = 0; i < 3; i++) maxh = Math.max(maxh, Math.abs(s.h[i] - y[7 + i]));
  log(`vs RK4 (dt/20) after ${T} s of tumbling at ~0.5 rad/s with motor torques: max|Δq| = ${maxq.toExponential(2)}, max|ΔH| = ${maxH.toExponential(2)} N·m·s, max|Δh| = ${maxh.toExponential(2)}`);
  assert.ok(maxq < 1e-6 && maxH < 1e-6 && maxh < 1e-12);

  // now with an inertial-fixed disturbance torque, rotated into the body frame by the reference itself
  const { p: p2, s: s2 } = fresh({ tauDist: tauExt });
  s2.ctrl.mode = 'raw';
  s2.H = [p2.J[0] * 0.4, p2.J[1] * 0.3, p2.J[2] * -0.25];
  A.resetLedger(s2);
  let y2 = [...s2.q, ...s2.H, ...s2.h];
  for (let k = 0; k < n; k++) {
    A.step(s2, p2);
    for (let j = 0; j < fine; j++) {
      const tb = A.rotateInv(y2.slice(0, 4), tauExt, [0, 0, 0]);
      y2 = rk4(y2, p2, DT / fine, [0, 0, 0], tb);
    }
  }
  let m2 = 0;
  for (let i = 0; i < 7; i++) m2 = Math.max(m2, Math.abs(s2[i < 4 ? 'q' : 'H'][i < 4 ? i : i - 4] - y2[i]));
  log(`vs RK4 with an inertial disturbance torque: max state difference ${m2.toExponential(2)}`);
  assert.ok(m2 < 1e-6);
});

test('free tumble: inertial momentum conserved to round-off, kinetic energy bounded, quaternion unit', () => {
  const { p, s } = fresh();
  freeBody(s, p, [0.3, 0.45, -0.2]);
  const H0 = A.inertialMomentum(s, [0, 0, 0]);
  const T0 = A.kineticEnergy(s, p);
  let maxH = 0, maxT = 0, maxQ = 0, firstT = 0, lastT = 0;
  const n = run(s, p, 2000, (st, k) => {
    const Hn = A.inertialMomentum(st, [0, 0, 0]);
    const dH = Math.hypot(Hn[0] - H0[0], Hn[1] - H0[1], Hn[2] - H0[2]) / Math.hypot(...H0);
    const dT = Math.abs(A.kineticEnergy(st, p) - T0) / T0;
    maxH = Math.max(maxH, dH); maxT = Math.max(maxT, dT);
    maxQ = Math.max(maxQ, Math.abs(Math.hypot(...st.q) - 1));
    if (k <= 10000) firstT = Math.max(firstT, dT);
    if (k > 90000) lastT = Math.max(lastT, dT);
  });
  log(`free tumble, ${n} steps (2000 s): max |ΔH_inertial|/|H| = ${maxH.toExponential(2)}, max |ΔT|/T = ${maxT.toExponential(2)} (first 200 s: ${firstT.toExponential(2)}, last 200 s: ${lastT.toExponential(2)}), |q|−1 ≤ ${maxQ.toExponential(1)}`);
  assert.ok(maxH < 1e-12, 'momentum'); // 1.5 million exact rotations: round-off alone gives ~1e-13
  assert.ok(maxT < 1e-8, 'energy');
  assert.ok(lastT < 2 * firstT + 1e-12, 'energy error does not grow');
  assert.ok(maxQ < 1e-14);
});

test('axisymmetric body: transverse rate precesses at (Ja−Jt)/Jt · ωa in the body frame', () => {
  const Jt = 5, Ja = 3, wa = 0.6;
  const { p, s } = fresh({ J: [Jt, Jt, Ja] });
  freeBody(s, p, [0.1, 0, wa]);
  const want = A.axisymmetricPrecession(Jt, Ja, wa); // −0.24 rad/s
  const period = (2 * Math.PI) / Math.abs(want);
  // measure the period as the time between successive maxima of ω_x (via zero crossings of ω_y)
  let prev = 0, crossings = [];
  run(s, p, 10 * period, (st) => {
    const w = A.omega(st, p, [0, 0, 0]);
    if (prev < 0 && w[1] >= 0) crossings.push(st.t - (w[1] * DT) / (w[1] - prev));
    prev = w[1];
  });
  const measured = (crossings[crossings.length - 1] - crossings[0]) / (crossings.length - 1);
  const rel = Math.abs(measured - period) / period;
  // sense: with Ja < Jt the transverse rate turns clockwise about +z (negative rate)
  const s2 = fresh({ J: [Jt, Jt, Ja] }).s; freeBody(s2, p, [0.1, 0, wa]);
  run(s2, p, 0.5);
  const w2 = A.omega(s2, p, [0, 0, 0]);
  log(`precession period: measured ${measured.toFixed(6)} s vs analytic ${period.toFixed(6)} s (rel. error ${rel.toExponential(1)}); ω_y after 0.5 s = ${w2[1].toFixed(5)} (expect ${(0.1 * Math.sin(want * 0.5)).toFixed(5)})`);
  assert.ok(rel < 1e-5);
  assert.ok(Math.abs(w2[1] - 0.1 * Math.sin(want * 0.5)) < 1e-6);
  assert.ok(Math.abs(w2[2] - wa) < 1e-12, 'spin rate about the symmetry axis is exactly constant');
});

test('middle-axis spin is unstable at the analytic growth rate; long and short axes are stable', () => {
  const rate = 0.3, eps = 1e-4;
  const { p, s } = fresh();
  const lam = A.intermediateGrowthRate(p.J, rate);
  freeBody(s, p, [eps, rate, eps]);
  // fit the exponential while the perturbation is still small (|ω_x| from 1e-4 to 1e-2)
  let t1 = null, t2 = null;
  run(s, p, 200, (st) => {
    const w = A.omega(st, p, [0, 0, 0]);
    const a = Math.hypot(w[0], w[2]);
    if (t1 === null && a > 10 * eps * Math.SQRT2) t1 = st.t;
    if (t2 === null && a > 100 * eps * Math.SQRT2) t2 = st.t;
  });
  const measured = Math.log(10) / (t2 - t1);
  log(`middle axis at ${rate} rad/s: growth rate measured ${measured.toFixed(4)} /s vs analytic ${lam.toFixed(4)} /s (×10 took ${(t2 - t1).toFixed(2)} s)`);
  assert.ok(Math.abs(measured - lam) / lam < 0.02);
  // the flips: ω_y changes sign (the body turns over) and keeps doing so; count sign changes in 600 s
  // the page starts its tumble with a 0.003 rad/s nudge (1%); count the flips of the spin sense
  const s3 = fresh().s; freeBody(s3, p, [0.003, rate, 0.003]);
  const flipTimes = [];
  let prevSign = 1;
  run(s3, p, 600, (st) => {
    const sg = Math.sign(A.omega(st, p, [0, 0, 0])[1]);
    if (sg !== prevSign && sg !== 0) { prevSign = sg; flipTimes.push(st.t); }
  });
  const gaps = flipTimes.slice(1).map((t, i) => t - flipTimes[i]);
  log(`flips of the spin sense in 600 s (1% nudge, as on the page): ${flipTimes.length}, at ${flipTimes.map((t) => t.toFixed(0)).join(', ')} s; gaps ${gaps.map((g) => g.toFixed(0)).join(', ')} s`);
  assert.ok(flipTimes.length >= 4);
  for (const axis of [0, 2]) {
    const { s: ss } = fresh(); freeBody(ss, p, axis === 0 ? [rate, eps, eps] : [eps, eps, rate]);
    let maxPert = 0;
    run(ss, p, 600, (st) => {
      const w = A.omega(st, p, [0, 0, 0]);
      maxPert = Math.max(maxPert, axis === 0 ? Math.hypot(w[1], w[2]) : Math.hypot(w[0], w[1]));
    });
    log(`${axis === 0 ? 'long' : 'short'} axis: cross-axis rate stays ≤ ${maxPert.toExponential(2)} rad/s over 600 s (started ${(eps * Math.SQRT2).toExponential(2)})`);
    assert.ok(maxPert < 3 * eps * Math.SQRT2);
  }
});

test('single wheel: body takes exactly the opposite momentum (ω = −h/J), inertial total stays zero', () => {
  const { p, s } = fresh();
  s.ctrl.mode = 'raw';
  s.ctrl.raw = [0, 1, 0]; // full motor torque on the y wheel
  run(s, p, 10);
  const w = A.omega(s, p, [0, 0, 0]);
  const Hn = A.inertialMomentum(s, [0, 0, 0]);
  log(`after 10 s at τ_max on wheel y: h_y = ${s.h[1].toFixed(6)} N·m·s (expect ${(p.tauMax * 10).toFixed(6)}), ω_y = ${w[1].toExponential(6)} rad/s (expect ${(-p.tauMax * 10 / p.J[1]).toExponential(6)}), |H_inertial| = ${Math.hypot(...Hn).toExponential(1)}`);
  assert.ok(Math.abs(s.h[1] - p.tauMax * 10) < 1e-12);
  assert.ok(Math.abs(w[1] + s.h[1] / p.J[1]) < 1e-15);
  assert.ok(Math.hypot(...Hn) < 1e-15);
  assert.ok(s.h[0] === 0 && s.h[2] === 0);
  // keep pushing: the wheel hits its cap and the body rate tops out at h_max/J
  run(s, p, 40);
  const w2 = A.omega(s, p, [0, 0, 0]);
  log(`after 50 s: wheel at ${s.h[1]} of ${p.hMax} (saturated: ${s.sat[1]}), body rate ${deg(-w2[1]).toFixed(3)} °/s = h_max/J_y = ${deg(p.hMax / p.J[1]).toFixed(3)} °/s`);
  assert.equal(s.h[1], p.hMax);
  assert.ok(s.sat[1]);
  assert.ok(Math.abs(w2[1] + p.hMax / p.J[1]) < 1e-15);
});

test('the ledger balances: sun deposits + thruster withdrawals = change of inertial momentum', () => {
  const { p, s } = fresh({ tauDist: [3e-6, -8e-6, 5e-6] });
  s.h = [0.3, -0.2, 0.4]; s.H = [0.3, -0.2, 0.4]; // preloaded wheels, body at rest
  A.resetLedger(s);
  // a busy 1200 s: slews, a desaturation, a raw-mode spell, another slew
  let maxRes = 0, thrImpulse = 0;
  const probe = (st) => {
    maxRes = Math.max(maxRes, A.ledgerResidual(st));
    thrImpulse += (Math.abs(st.tauThr[0]) + Math.abs(st.tauThr[1]) + Math.abs(st.tauThr[2])) * DT;
  };
  A.nudgeTarget(s, 0.5, -1.2, 0.3);
  run(s, p, 300, probe);
  s.ctrl.desat = true;
  run(s, p, 200, probe);
  A.setMode(s, 'raw'); s.ctrl.raw = [0.3, -0.6, 0.9];
  run(s, p, 100, probe);
  A.setMode(s, 'hold');
  run(s, p, 200, probe);
  A.nudgeTarget(s, -2.0, 0.4, -0.9);
  run(s, p, 400, probe);
  const dep = Math.hypot(...s.ledger.dep), thr = Math.hypot(...s.ledger.thr);
  const depWant = Math.hypot(...p.tauDist) * s.t;
  log(`1200 s with slews, thrusters and raw torque: deposits ${dep.toExponential(6)} N·m·s (τ_d·t = ${depWant.toExponential(6)}), withdrawals ${thr.toExponential(4)}, worst bookkeeping residual ${maxRes.toExponential(2)} N·m·s, propellant used ${(s.propUsed * 1e3).toFixed(3)} g`);
  assert.ok(Math.abs(dep - depWant) < 1e-12);
  assert.ok(maxRes < 1e-11); // 60,000 thruster kicks of ~3e-4 N·m·s each, rounding at 1e-16 of a ~1 N·m·s total
  assert.ok(thr > 0 && s.propUsed > 0);
  // the withdrawals are what the thrusters actually removed: |Σ τ_thr dt| equals the propellant × momentum-per-kg
  // only when every firing is along one inertial direction, so check the scalar impulse instead
  assert.ok(Math.abs(s.propUsed * A.momentumPerKg(p) - thrImpulse) < 1e-9, `${s.propUsed * A.momentumPerKg(p)} vs ${thrImpulse}`);
});

test('long haul: 24 simulated hours at 100 µN·m with a desaturation every 2 h keeps the ledger at round-off', () => {
  const { p, s } = fresh({ tauDist: [-7.86e-5, 0, -6.18e-5] });
  let maxRes = 0, dumps = 0;
  const hours = 24;
  for (let hr = 0; hr < hours; hr++) {
    if (hr % 2 === 1) { s.ctrl.desat = true; dumps++; }
    A.nudgeTarget(s, 0.3 * Math.sin(hr), 0.5 * Math.cos(hr), 0.1 * hr);
    run(s, p, 3600, (st, k) => { if (k % 50 === 0) maxRes = Math.max(maxRes, A.ledgerResidual(st)); });
  }
  const Hn = Math.hypot(...A.inertialMomentum(s, [0, 0, 0]));
  log(`${hours} h = ${(hours * 3600 / DT).toExponential(2)} steps, ${dumps} desaturations, ${(s.propUsed * 1e3).toFixed(1)} g used, |H| up to ~1 N·m·s (now ${Hn.toFixed(3)}): worst ledger residual ${maxRes.toExponential(2)} N·m·s = ${(maxRes / (hours * 3600 / DT)).toExponential(1)} per step`);
  // Each half-kick adds τ·dt/2 ≈ 1e-6 to a ~1 N·m·s total, on both sides of the ledger but in different
  // frames, so the rounding bias (≤ ½ ulp ≈ 1e-16 per add) does not cancel and accumulates linearly.
  assert.ok(maxRes < 1e-8);
});

test('rest-to-rest 90° slew: autopilot lands on target, takes a sane multiple of the bang-bang bound, wheels return to zero', () => {
  const { p, s } = fresh();
  A.nudgeTarget(s, 0, Math.PI / 2, 0);
  const bound = A.slewTime(p.J[1], p.tauMax, (p.rateFrac * p.hMax) / p.J[1], Math.PI / 2);
  let settled = null, maxH = 0;
  run(s, p, 200, (st) => {
    const e = A.errorVector(st.q, st.ctrl.qT, [0, 0, 0]);
    const w = A.omega(st, p, [0, 0, 0]);
    maxH = Math.max(maxH, Math.abs(st.h[1]));
    if (settled === null && Math.hypot(...e) < 0.05 * Math.PI / 180 && Math.hypot(...w) < 1e-4) settled = st.t;
  });
  const e = A.errorVector(s.q, s.ctrl.qT, [0, 0, 0]);
  log(`90° yaw slew: settled (within 0.05°, rate < 1e-4 rad/s) at ${settled?.toFixed(1)} s; bang-bang bound ${bound.toFixed(1)} s; peak wheel momentum ${maxH.toFixed(4)} N·m·s; final error ${deg(Math.hypot(...e)).toExponential(2)}°; wheels after ${s.h.map((v) => v.toExponential(1)).join(', ')}`);
  assert.ok(settled !== null && settled > bound && settled < 1.6 * bound);
  assert.ok(Math.hypot(...s.h) < 1e-4, 'an internal manoeuvre leaves no net momentum in the wheels');
});

test('stored momentum moves between wheels when you turn: h = (0.3,0,0), yaw 90° about y → h = (0,0,0.3)', () => {
  const { p, s } = fresh();
  s.h = [0.3, 0, 0];
  s.H = [0.3, 0, 0]; // body at rest, so H = h
  A.resetLedger(s);
  A.nudgeTarget(s, 0, Math.PI / 2, 0);
  run(s, p, 200);
  const e = A.errorVector(s.q, s.ctrl.qT, [0, 0, 0]);
  log(`after the slew: h = (${s.h.map((v) => v.toFixed(5)).join(', ')}), pointing error ${deg(Math.hypot(...e)).toExponential(1)}°, residual ${A.ledgerResidual(s).toExponential(1)}`);
  assert.ok(Math.abs(s.h[0]) < 1e-3 && Math.abs(s.h[1]) < 1e-3 && Math.abs(s.h[2] - 0.3) < 1e-3);
  assert.ok(deg(Math.hypot(...e)) < 0.05);
});

test('a steady torque fills a wheel at the analytic time; after that the hold is lost', () => {
  const tau = 1e-5;
  const { p, s } = fresh({ tauDist: [0, 0, tau] }); // inertial z = body z while pointing along z
  const tFill = A.fillTime(p, tau);
  let tSat = null, errAtSat = 0, errLater = 0;
  run(s, p, tFill + 3600, (st) => {
    const e = deg(Math.hypot(...A.errorVector(st.q, st.ctrl.qT, [0, 0, 0])));
    if (tSat === null && st.h[2] >= p.hMax) { tSat = st.t; errAtSat = e; }
    if (tSat !== null) errLater = e;
  });
  const w = A.omega(s, p, [0, 0, 0]);
  log(`τ_d = ${tau} N·m: wheel z full at ${tSat.toFixed(1)} s (analytic h_max/τ = ${tFill.toFixed(1)} s = ${(tFill / 3600).toFixed(2)} h); pointing error at that moment ${errAtSat.toExponential(2)}°, one hour later ${errLater.toFixed(2)}°, body rate then ${deg(Math.hypot(...w)).toExponential(2)} °/s`);
  assert.ok(Math.abs(tSat - tFill) / tFill < 0.01);
  assert.ok(errAtSat < 0.01 && errLater > 1);
  // body rate after an hour of unresisted torque: ω = τ·Δt/J_z (the wheel can give nothing more)
  const wWant = (tau * 3600) / p.J[2];
  assert.ok(Math.abs(Math.abs(w[2]) - wWant) / wWant < 0.05, `${w[2]} vs ${wWant}`);
});

test('desaturation: propellant per dump matches τ·t/(arm·Isp·g0); lifetime formula', () => {
  const { p, s } = fresh();
  s.h = [p.hMax, -p.hMax, p.hMax];
  s.H = [p.hMax, -p.hMax, p.hMax];
  A.resetLedger(s);
  s.ctrl.desat = true;
  let tDone = null, maxErr = 0;
  run(s, p, 300, (st) => {
    maxErr = Math.max(maxErr, deg(Math.hypot(...A.errorVector(st.q, st.ctrl.qT, [0, 0, 0]))));
    if (tDone === null && !st.ctrl.desat) tDone = st.t;
  });
  const dumped = 3 * p.hMax * (1 - p.desatBand);
  const want = A.propellantFor(p, dumped);
  const perFull = A.propellantFor(p, p.hMax);
  log(`three full wheels dumped in ${tDone.toFixed(1)} s (per axis h_max/τ_thr = ${(p.hMax / p.tauThr).toFixed(1)} s); propellant ${(s.propUsed * 1e3).toFixed(3)} g vs ${(want * 1e3).toFixed(3)} g expected; pointing wobble during firing ≤ ${maxErr.toFixed(3)}°; wheels now ${s.h.map((v) => v.toFixed(4)).join(', ')}`);
  assert.ok(Math.abs(s.propUsed - want) / want < 0.03);
  assert.ok(maxErr < 0.5);
  assert.ok(s.h.every((v) => Math.abs(v) < 0.02 * p.hMax));
  const perKg = A.momentumPerKg(p);
  const life = A.lifetime(p, p.propMass, 1e-5);
  log(`one full wheel costs ${(perFull * 1e3).toFixed(2)} g; ${perKg.toFixed(1)} N·m·s per kg; ${p.propMass} kg lasts ${(life / 86400).toFixed(0)} days = ${(life / 3.15576e7).toFixed(2)} years against 10 µN·m`);
  assert.ok(Math.abs(perKg - 0.4 * 65 * G0) < 1e-9);
  assert.ok(Math.abs(perFull - 0.5 / perKg) < 1e-12);
  assert.ok(Math.abs(life / 86400 - 590) < 1);
});

test('catching a tumble: wheels alone cannot absorb more than their capacity, thrusters finish the job', () => {
  const { p, s } = fresh();
  A.setTumble(s, p, 1, 0.3, 0.003); // middle axis, 17°/s, needs J_y·ω = 1.8 N·m·s, wheels hold 0.5 each
  run(s, p, 100);
  A.setMode(s, 'hold');
  run(s, p, 300);
  const w1 = A.omega(s, p, [0, 0, 0]);
  const Hmag = Math.hypot(...A.inertialMomentum(s, [0, 0, 0]));
  log(`autopilot alone after 300 s: body rate ${deg(Math.hypot(...w1)).toFixed(2)} °/s, |H| = ${Hmag.toFixed(3)} N·m·s, wheels ${s.h.map((v) => v.toFixed(3)).join(', ')} (cap ±${p.hMax})`);
  assert.ok(Math.hypot(...w1) > 0.05, 'still tumbling');
  s.ctrl.desat = true;
  let tDone = null;
  run(s, p, 600, (st) => { if (tDone === null && !st.ctrl.desat) tDone = st.t - 400; });
  run(s, p, 200);
  const w2 = A.omega(s, p, [0, 0, 0]);
  log(`with thrusters: momentum nulled after ${tDone?.toFixed(0)} s, ${(s.propUsed * 1e3).toFixed(2)} g used; final body rate ${deg(Math.hypot(...w2)).toExponential(2)} °/s, wheels ${s.h.map((v) => v.toFixed(4)).join(', ')}`);
  assert.ok(Math.hypot(...w2) < 1e-3);
  assert.ok(tDone !== null);
});

test('frame-rate independence: 30, 60, 144 Hz and jittery frames give bit-identical states', () => {
  const schedule = (hz, jitter) => {
    const { p, s } = fresh({ tauDist: [2e-6, 5e-6, -4e-6] });
    const clock = A.makeClock();
    A.nudgeTarget(s, 0.4, -0.8, 0.2);
    const checkpoints = [];
    let wall = 0, stepsDone = 0, seed = 7;
    const targetSteps = 20000; // 400 s simulated at 10×
    let i = 0;
    while (stepsDone < targetSteps) {
      let dt = 1 / hz;
      if (jitter) { seed = (seed * 1103515245 + 12345) % 2147483648; dt *= 0.5 + seed / 2147483648; }
      wall += dt;
      const n = A.clockSteps(clock, dt, 10, 5000);
      for (let k = 0; k < n && stepsDone < targetSteps; k++) {
        if (stepsDone === 5000) s.ctrl.desat = true; // same scripted events at the same step numbers
        if (stepsDone === 12000) A.nudgeTarget(s, -1, 0.3, 0);
        A.step(s, p); stepsDone++;
        if (stepsDone % 4000 === 0) checkpoints.push([...s.q, ...s.H, ...s.h, s.prop]);
      }
      i++;
    }
    return checkpoints;
  };
  const ref = schedule(60, false);
  for (const [hz, j] of [[30, false], [144, false], [60, true], [24, true]]) {
    const c = schedule(hz, j);
    assert.equal(c.length, ref.length);
    for (let k = 0; k < c.length; k++) for (let i = 0; i < c[k].length; i++) assert.equal(c[k][i], ref[k][i], `${hz} Hz${j ? ' jitter' : ''} checkpoint ${k}`);
  }
  log(`5 frame schedules × ${ref.length} checkpoints: all 11 state numbers identical to the last bit`);
});

test('the numbers the page and README quote', () => {
  const p = A.makeParams();
  const rates = p.J.map((J) => deg(p.hMax / J));
  log(`max body rate from a full wheel: x ${rates[0].toFixed(2)}, y ${rates[1].toFixed(2)}, z ${rates[2].toFixed(2)} °/s`);
  assert.ok(Math.abs(rates[1] - 4.77) < 0.01 && Math.abs(rates[2] - 8.19) < 0.01);
  const rpm = (p.hMax / p.Iw) * 60 / (2 * Math.PI);
  log(`wheel speed at capacity: ${rpm.toFixed(0)} rpm`);
  assert.ok(Math.abs(rpm - 5968) < 1);
  log(`90° yaw bang-bang bound ${A.slewTime(p.J[1], p.tauMax, 1e9, Math.PI / 2).toFixed(1)} s; 180° with the rate limit ${A.slewTime(p.J[1], p.tauMax, (p.rateFrac * p.hMax) / p.J[1], Math.PI).toFixed(1)} s`);
  log(`middle-axis growth rate at 0.3 rad/s: ${A.intermediateGrowthRate(p.J, 0.3).toFixed(4)} /s (e-fold ${(1 / A.intermediateGrowthRate(p.J, 0.3)).toFixed(1)} s)`);
  log(`fill time at 10 µN·m: ${(A.fillTime(p, 1e-5) / 3600).toFixed(2)} h; propellant lifetime ${(A.lifetime(p, p.propMass, 1e-5) / 86400).toFixed(0)} days`);
  assert.ok(Math.abs(A.fillTime(p, 1e-5) / 3600 - 13.89) < 0.01);
});
