/*
 * attitude.js — rigid-body attitude dynamics with three reaction wheels, pure and DOM-free.
 *
 * Works as a classic browser script (exposes globalThis.Attitude, so index.html can be opened
 * straight from disk) and as a CommonJS module for the node:test suite.
 *
 * Frames and conventions
 *   Body axes: x right, y up, z forward (the camera boresight). Right-handed.
 *   q = [w, x, y, z] is a unit quaternion mapping body vectors to inertial vectors: v_in = R(q) v_b.
 *   Kinematics: q̇ = ½ q ⊗ (0, ω_b), where ω_b is the body angular rate in body axes.
 *
 * State (all SI)
 *   H  [3]  total angular momentum of body + wheels, expressed in body axes (N·m·s)
 *   h  [3]  ABSOLUTE axial angular momentum of each wheel, I_w·(ω_i + Ω_i), one wheel per body
 *           axis (N·m·s); Ω_i is the wheel's spin relative to the body
 *   ω = (H − h) / J componentwise, where J = principal inertias of the body EXCLUDING each wheel's
 *   axial inertia about its own spin axis (J_locked − I_w; the difference is ~1e-4 of J here).
 *   With these definitions the equations below are exact for symmetric wheels. (Read h as momentum
 *   relative to the body and J as the locked inertia and they are off by O(I_w/J): the wheel equation
 *   would need −I_w·ω̇_i and the energy a cross term ω·h. The tests check this against a model built
 *   in relative coordinates.)
 *
 * Dynamics
 *   Ḣ = −ω × H + τ_ext,b          (Euler's equation; motor torques are internal and never touch H)
 *   ḣ_i = τ_motor,i                (the motor spins the wheel; the body gets −τ_motor)
 *   With τ_ext = 0 the inertial momentum R(q) H is constant. That is the whole game.
 *
 * Integrator (fixed step DT = 0.02 s)
 *   Kick–drift–kick. Torques are kicks on H (external) and h (motor). The drift is the torque-free
 *   gyrostat, split into three single-axis rotations (the explicit Lie–Poisson splitting of McLachlan,
 *   Phys. Rev. Lett. 71, 1993, often credited jointly to McLachlan and Reich): the flow of
 *   (H_i − h_i)²/(2J_i) alone is an exact rotation of the body about axis i by θ = ω_i dt, under which
 *   H_b rotates by −θ about the same axis and h is unchanged. Each piece is solved exactly, preserves
 *   |H| and the inertial momentum R(q)H to round-off, and a Strang (1,2,3,2,1) arrangement composed
 *   with Yoshida's 4th-order weights gives the drift. Kinetic energy is then conserved with bounded,
 *   non-growing error. The overall scheme is 2nd order in the torques, 4th order in free rotation.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Attitude = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DT = 0.02; // s, fixed physics step (50 Hz, also the controller's sample rate)
  const G0 = 9.80665; // m/s², standard gravity (for specific impulse)
  const W1 = 1 / (2 - Math.cbrt(2)); // Yoshida 4th-order weights
  const W0 = 1 - 2 * W1;

  /** Default spacecraft: a ~60 kg microsatellite box, long axis along the boresight. */
  const DEFAULTS = Object.freeze({
    box: [0.5, 0.7, 1.0], // m, the body's dimensions along x, y, z (z, the boresight, is the long side)
    // kg·m², principal inertias (body without the wheels' axial inertia, see above): about a uniform
    // 60 kg box of that size, rounded. x > y > z, so x (the SHORT side) has the most inertia, y is the
    // middle axis, and z (the LONG side) has the least.
    J: [7.5, 6.0, 3.5],
    Iw: 8e-4, // kg·m², axial inertia of one wheel (only for the rpm readout)
    hMax: 0.5, // N·m·s, momentum capacity of each wheel (±)
    tauMax: 0.02, // N·m, motor torque limit per wheel
    tauThr: 0.016, // N·m, thruster couple torque per axis (two 0.02 N thrusters, each 0.4 m from the axis)
    // m, thruster lever arm, the same idealised 0.4 m on every axis. Pitch and yaw pairs fit easily along
    // the 1 m length; the roll pair has only the 0.5 × 0.7 m cross-section, so it sits on two corners,
    // canted (see thrusterLayout). Thrusters firing straight out of a face would get only 0.35 m for roll.
    thrArm: 0.4,
    isp: 65, // s, cold-gas specific impulse
    propMass: 2.0, // kg, propellant loaded at start
    tauDist: [0, 0, 1e-5], // N·m, steady disturbance torque, fixed in the INERTIAL frame
    // controller
    kRate: 4, // 1/s, rate-loop gain
    kAtt: 0.5, // 1/s, attitude-loop gain inside the linear region
    accelFrac: 0.7, // fraction of τ_max/J used by the slew profile
    rateFrac: 0.8, // fraction of h_max/J used as the slew rate limit
    desatBand: 0.01, // fraction of h_max: thrusters stop when |H_i| is below this
  });

  /**
   * Where the thrusters sit (body axes, m), for the drawing and the tests. For each axis i there are two
   * couples: `pos` gives +arm·F of torque about i, `neg` gives −arm·F. Each couple is two thrusters
   * [r, f] (position, unit force direction on the body) at r and −r firing f and −f, so the net force is
   * zero and r × f = arm·e_i exactly. Every thruster sits on the box surface and its exhaust (−f) leaves
   * the box.
   */
  function thrusterLayout(p) {
    const bx = p.box[0] / 2, by = p.box[1] / 2, a = p.thrArm;
    // roll: canted at the corners (±bx, ±by) of the cross-section so that bx·f_y − by·f_x = a
    const R = Math.hypot(bx, by);
    const beta = Math.atan2(by, bx) + Math.PI - Math.asin(Math.min(1, a / R));
    const fr = [Math.cos(beta), Math.sin(beta), 0];
    const pair = (r, f) => [[r, f], [r.map((v) => -v), f.map((v) => -v)]];
    return [
      // pitch (x): on the ±y faces, a along the length, firing straight out of the face
      { pos: pair([0, by, a], [0, -1, 0]), neg: pair([0, -by, a], [0, 1, 0]) },
      // yaw (y): on the ±x faces, a along the length
      { pos: pair([bx, 0, -a], [-1, 0, 0]), neg: pair([-bx, 0, -a], [1, 0, 0]) },
      // roll (z): mirror images across the xz plane flip the sign of the torque
      { pos: pair([bx, by, 0], fr), neg: pair([bx, -by, 0], [fr[0], -fr[1], 0]) },
    ];
  }

  // ---------- small vector / quaternion helpers (no allocation in the hot path) ----------
  function qmul(a, b, out) {
    const w = a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3];
    const x = a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2];
    const y = a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1];
    const z = a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0];
    out[0] = w; out[1] = x; out[2] = y; out[3] = z;
    return out;
  }
  function qconj(a, out) { out[0] = a[0]; out[1] = -a[1]; out[2] = -a[2]; out[3] = -a[3]; return out; }
  function qnormalize(q) {
    const n = Math.hypot(q[0], q[1], q[2], q[3]);
    q[0] /= n; q[1] /= n; q[2] /= n; q[3] /= n;
    return q;
  }
  function qFromAxisAngle(axis, angle, out) {
    const n = Math.hypot(axis[0], axis[1], axis[2]) || 1;
    const s = Math.sin(angle / 2) / n;
    out[0] = Math.cos(angle / 2); out[1] = axis[0] * s; out[2] = axis[1] * s; out[3] = axis[2] * s;
    return out;
  }
  /** Rotation matrix (row-major 3×3) of q: v_in = R v_b. */
  function qToMat(q, m) {
    const w = q[0], x = q[1], y = q[2], z = q[3];
    m[0] = 1 - 2 * (y * y + z * z); m[1] = 2 * (x * y - w * z); m[2] = 2 * (x * z + w * y);
    m[3] = 2 * (x * y + w * z); m[4] = 1 - 2 * (x * x + z * z); m[5] = 2 * (y * z - w * x);
    m[6] = 2 * (x * z - w * y); m[7] = 2 * (y * z + w * x); m[8] = 1 - 2 * (x * x + y * y);
    return m;
  }
  function matVec(m, v, out) {
    const a = m[0] * v[0] + m[1] * v[1] + m[2] * v[2];
    const b = m[3] * v[0] + m[4] * v[1] + m[5] * v[2];
    const c = m[6] * v[0] + m[7] * v[1] + m[8] * v[2];
    out[0] = a; out[1] = b; out[2] = c;
    return out;
  }
  function matTVec(m, v, out) {
    const a = m[0] * v[0] + m[3] * v[1] + m[6] * v[2];
    const b = m[1] * v[0] + m[4] * v[1] + m[7] * v[2];
    const c = m[2] * v[0] + m[5] * v[1] + m[8] * v[2];
    out[0] = a; out[1] = b; out[2] = c;
    return out;
  }
  /** Body → inertial. */
  function rotate(q, v, out) { return matVec(qToMat(q, TMP_M), v, out); }
  /** Inertial → body. */
  function rotateInv(q, v, out) { return matTVec(qToMat(q, TMP_M), v, out); }
  /**
   * Rotation vector (axis × angle, angle in [0, π]) of the body-frame rotation that takes attitude
   * q to attitude qT: qT = q ⊗ exp(e/2).
   */
  function errorVector(q, qT, out) {
    const e = qmul(qconj(q, TMP_Q1), qT, TMP_Q2);
    if (e[0] < 0) { e[0] = -e[0]; e[1] = -e[1]; e[2] = -e[2]; e[3] = -e[3]; }
    const s = Math.hypot(e[1], e[2], e[3]);
    const angle = 2 * Math.atan2(s, e[0]);
    const k = s > 1e-12 ? angle / s : 2; // small angle: e ≈ 2·vector part
    out[0] = e[1] * k; out[1] = e[2] * k; out[2] = e[3] * k;
    return out;
  }
  const TMP_M = new Float64Array(9);
  const TMP_Q1 = [1, 0, 0, 0], TMP_Q2 = [1, 0, 0, 0], TMP_Q3 = [1, 0, 0, 0];
  const TMP_V1 = [0, 0, 0], TMP_V2 = [0, 0, 0], TMP_V3 = [0, 0, 0];
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  // ---------- state ----------
  function makeParams(over) {
    const p = Object.assign({}, DEFAULTS, over || {});
    p.J = p.J.slice(); p.tauDist = p.tauDist.slice(); p.box = p.box.slice();
    return p;
  }

  /** Fresh state: at rest, pointing along inertial +z with body y up, wheels empty, ledger zeroed. */
  function makeState(p) {
    const s = {
      t: 0,
      q: [1, 0, 0, 0],
      H: [0, 0, 0],
      h: [0, 0, 0],
      prop: p.propMass,
      propUsed: 0,
      ledger: { H0: [0, 0, 0], dep: [0, 0, 0], thr: [0, 0, 0] },
      ctrl: {
        mode: 'hold', // 'hold' (autopilot) or 'raw' (your drag is the motor torque, nothing damps)
        phase: 'hold', // autopilot sub-state: 'detumble' | 'hold'
        lost: false, // in 'hold': the target needs more momentum than the wheels can carry, so only rates are damped
        qT: [1, 0, 0, 0], // held/commanded attitude
        raw: [0, 0, 0], // raw mode: commanded motor torque as a fraction of τ_max, per axis
        desat: false,
      },
      // diagnostics from the last step
      tauMotor: [0, 0, 0], // motor torque actually delivered (N·m)
      tauThr: [0, 0, 0], // thruster torque this step (N·m, body axes)
      sat: [false, false, false], // wheel at capacity and asked for more
      thrusting: false,
    };
    return s;
  }

  function omega(s, p, out) {
    out[0] = (s.H[0] - s.h[0]) / p.J[0];
    out[1] = (s.H[1] - s.h[1]) / p.J[1];
    out[2] = (s.H[2] - s.h[2]) / p.J[2];
    return out;
  }
  /** Kinetic energy: ½ΣJω² + ½Σh²/I_w, exact with h the wheels' absolute axial momentum (see the header). */
  function kineticEnergy(s, p) {
    const w = omega(s, p, TMP_V1);
    let T = 0;
    for (let i = 0; i < 3; i++) T += 0.5 * p.J[i] * w[i] * w[i] + 0.5 * s.h[i] * s.h[i] / p.Iw;
    return T;
  }
  /** Total angular momentum in the inertial frame. */
  function inertialMomentum(s, out) { return rotate(s.q, s.H, out); }

  /** Start the ledger from the current state (call after any direct state edit, e.g. a tumble preset). */
  function resetLedger(s) {
    inertialMomentum(s, s.ledger.H0);
    s.ledger.dep = [0, 0, 0];
    s.ledger.thr = [0, 0, 0];
  }
  /**
   * The bookkeeping identity: inertial momentum now = H0 + sun deposits + thruster withdrawals.
   * Returns |residual| in N·m·s; it should be at the level of floating-point round-off.
   */
  function ledgerResidual(s) {
    const Hn = inertialMomentum(s, TMP_V1);
    const L = s.ledger;
    return Math.hypot(Hn[0] - L.H0[0] - L.dep[0] - L.thr[0], Hn[1] - L.H0[1] - L.dep[1] - L.thr[1], Hn[2] - L.H0[2] - L.dep[2] - L.thr[2]);
  }

  // ---------- exact single-axis rotation of the gyrostat ----------
  const AXIS_Q = [[1, 0, 0, 0], [1, 0, 0, 0], [1, 0, 0, 0]];
  function rotStep(s, p, i, dt) {
    const th = ((s.H[i] - s.h[i]) / p.J[i]) * dt;
    const c = Math.cos(th / 2), sn = Math.sin(th / 2);
    const C = c * c - sn * sn, S = 2 * sn * c; // cos θ, sin θ from the half angle (same numbers R(q_i) uses)
    const j = (i + 1) % 3, k = (i + 2) % 3;
    const Hj = s.H[j], Hk = s.H[k];
    s.H[j] = C * Hj + S * Hk; // H_b ← Rot_i(−θ) H_b
    s.H[k] = -S * Hj + C * Hk;
    const r = AXIS_Q[i];
    r[0] = c; r[1] = 0; r[2] = 0; r[3] = 0; r[i + 1] = sn;
    qmul(s.q, r, s.q); // q ← q ⊗ q_i(θ)
  }
  function strang(s, p, dt) {
    rotStep(s, p, 0, dt / 2);
    rotStep(s, p, 1, dt / 2);
    rotStep(s, p, 2, dt);
    rotStep(s, p, 1, dt / 2);
    rotStep(s, p, 0, dt / 2);
  }
  function drift(s, p, dt) {
    strang(s, p, W1 * dt);
    strang(s, p, W0 * dt);
    strang(s, p, W1 * dt);
  }

  // ---------- controller ----------
  const CTRL_E = [0, 0, 0], CTRL_W = [0, 0, 0], CTRL_WC = [0, 0, 0], CTRL_G = [0, 0, 0], CTRL_HT = [0, 0, 0];
  /** True if the wheels could hold the commanded attitude at rest: every component of the total momentum,
   *  expressed in the target's body axes, is within a wheel's capacity. */
  function targetHoldable(s, p) {
    const r = qmul(qconj(s.ctrl.qT, TMP_Q1), s.q, TMP_Q2); // target axes ← body axes
    const Ht = rotate(r, s.H, CTRL_HT);
    return Math.abs(Ht[0]) <= p.hMax && Math.abs(Ht[1]) <= p.hMax && Math.abs(Ht[2]) <= p.hMax;
  }
  /** Writes motor torque (N·m) into tauM and thruster torque into tauT. Pure function of the state. */
  function control(s, p, tauM, tauT) {
    const c = s.ctrl;
    const w = omega(s, p, CTRL_W);
    // thrusters (desaturation drives the TOTAL body-frame momentum toward zero)
    let anyThr = false;
    for (let i = 0; i < 3; i++) {
      tauT[i] = 0;
      if (c.desat && s.prop > 0 && Math.abs(s.H[i]) > p.desatBand * p.hMax) {
        tauT[i] = -Math.sign(s.H[i]) * p.tauThr;
        anyThr = true;
      }
    }
    if (c.desat && !anyThr) c.desat = false;
    if (c.desat && c.mode === 'raw') { c.mode = 'hold'; c.phase = 'detumble'; }

    if (c.mode === 'raw') {
      c.lost = false;
      for (let i = 0; i < 3; i++) tauM[i] = clamp(c.raw[i], -1, 1) * p.tauMax;
      return;
    }
    // autopilot: detumble if spinning fast, else hold/slew to qT
    const wmag = Math.hypot(w[0], w[1], w[2]);
    const rateLim = (p.rateFrac * p.hMax) / Math.max(p.J[0], p.J[1], p.J[2]);
    if (c.phase === 'detumble') {
      if (wmag < 0.5 * rateLim) { c.phase = 'hold'; c.qT[0] = s.q[0]; c.qT[1] = s.q[1]; c.qT[2] = s.q[2]; c.qT[3] = s.q[3]; }
    } else if (wmag > 2.5 * rateLim) {
      c.phase = 'detumble';
    }
    // Can the wheels hold the target at all? At rest there, they would have to carry the whole momentum,
    // h = R(qT)ᵀ·H_inertial. If any component is over capacity, no attitude law can hold that pointing.
    // A plain PD law would keep chasing it, and once the error passed 180° it would go "the other way
    // round", spinning the full wheel down into a fast body whip and then refilling it. So the autopilot
    // gives up the hold (c.lost) and only damps the body rate. A full wheel stays pinned and the sky drifts
    // at exactly (H − h_max)/J. It picks the target up again once the momentum fits: after the thrusters,
    // or if you point somewhere the wheels can carry it.
    c.lost = c.phase === 'hold' && !targetHoldable(s, p);
    if (c.phase === 'detumble' || c.lost) {
      CTRL_WC[0] = CTRL_WC[1] = CTRL_WC[2] = 0;
    } else {
      const e = errorVector(s.q, c.qT, CTRL_E);
      for (let i = 0; i < 3; i++) {
        const a = (p.accelFrac * p.tauMax) / p.J[i];
        const wmax = (p.rateFrac * p.hMax) / p.J[i];
        const eLin = (2 * a) / (p.kAtt * p.kAtt); // below this the sqrt profile is replaced by a linear one
        const ae = Math.abs(e[i]);
        const mag = ae < eLin ? p.kAtt * ae : Math.sqrt(2 * a * ae);
        CTRL_WC[i] = Math.sign(e[i]) * Math.min(mag, wmax);
      }
    }
    // τ_m = −ω×H − J·α_des + τ_thr   (gyroscopic decoupling + rate loop + thruster feed-forward)
    const H = s.H, g = CTRL_G;
    g[0] = w[1] * H[2] - w[2] * H[1]; g[1] = w[2] * H[0] - w[0] * H[2]; g[2] = w[0] * H[1] - w[1] * H[0];
    for (let i = 0; i < 3; i++) {
      const aMax = p.tauMax / p.J[i];
      const aDes = clamp(p.kRate * (CTRL_WC[i] - w[i]), -aMax, aMax);
      tauM[i] = clamp(-g[i] - p.J[i] * aDes + tauT[i], -p.tauMax, p.tauMax);
    }
  }

  // ---------- one fixed step ----------
  const STEP_TM = [0, 0, 0], STEP_TT = [0, 0, 0], STEP_TD = [0, 0, 0];
  function kick(s, p, tauM, tauT, dtHalf) {
    // external torques → H (the disturbance is an inertial vector; express it in body axes right now)
    const td = rotateInv(s.q, p.tauDist, STEP_TD);
    for (let i = 0; i < 3; i++) {
      s.H[i] += (tauT[i] + td[i]) * dtHalf;
      s.ledger.dep[i] += p.tauDist[i] * dtHalf; // exact: R·(Rᵀ τ_d) = τ_d
    }
    // thruster withdrawals, in the inertial frame, with the attitude at which they fired
    const tin = rotate(s.q, tauT, TMP_V2);
    for (let i = 0; i < 3; i++) s.ledger.thr[i] += tin[i] * dtHalf;
    // motor torques → h, hard-capped at the wheel's capacity
    for (let i = 0; i < 3; i++) {
      const want = s.h[i] + tauM[i] * dtHalf;
      const got = clamp(want, -p.hMax, p.hMax);
      s.sat[i] = s.sat[i] || want !== got;
      s.h[i] = got;
    }
  }

  function step(s, p) {
    const tauM = STEP_TM, tauT = STEP_TT;
    control(s, p, tauM, tauT);
    const h0 = s.h[0], h1 = s.h[1], h2 = s.h[2];
    s.sat[0] = s.sat[1] = s.sat[2] = false;
    kick(s, p, tauM, tauT, DT / 2);
    drift(s, p, DT);
    kick(s, p, tauM, tauT, DT / 2);
    qnormalize(s.q);
    // propellant: two thrusters per axis as a couple; mass flow = |τ| / (arm · Isp · g0)
    let flow = 0;
    for (let i = 0; i < 3; i++) flow += Math.abs(tauT[i]);
    const dm = (flow * DT) / (p.thrArm * p.isp * G0);
    s.prop = Math.max(0, s.prop - dm);
    s.propUsed += dm;
    s.thrusting = flow > 0;
    s.tauMotor[0] = (s.h[0] - h0) / DT; s.tauMotor[1] = (s.h[1] - h1) / DT; s.tauMotor[2] = (s.h[2] - h2) / DT;
    s.tauThr[0] = tauT[0]; s.tauThr[1] = tauT[1]; s.tauThr[2] = tauT[2];
    s.t += DT;
  }

  // ---------- commands ----------
  /** Rotate the held attitude by a small body-frame rotation vector (radians). */
  function nudgeTarget(s, dx, dy, dz) {
    const c = s.ctrl;
    const ang = Math.hypot(dx, dy, dz);
    if (ang === 0) return;
    const r = qFromAxisAngle([dx, dy, dz], ang, TMP_Q3);
    qmul(c.qT, r, c.qT);
    qnormalize(c.qT);
  }
  function setMode(s, mode) {
    const c = s.ctrl;
    if (mode === c.mode) return;
    c.mode = mode;
    if (mode === 'hold') { c.phase = 'detumble'; c.raw[0] = c.raw[1] = c.raw[2] = 0; }
  }
  /** Put the body into a free tumble about a principal axis (rad/s) with a small cross-axis nudge, wheels emptied. */
  function setTumble(s, p, axis, rate, nudge) {
    s.h[0] = s.h[1] = s.h[2] = 0;
    const w = [nudge, nudge, nudge];
    w[axis] = rate;
    for (let i = 0; i < 3; i++) s.H[i] = p.J[i] * w[i];
    s.ctrl.mode = 'raw';
    s.ctrl.raw[0] = s.ctrl.raw[1] = s.ctrl.raw[2] = 0;
    s.ctrl.desat = false;
    resetLedger(s);
  }

  // ---------- closed-form checks the tests and the page quote ----------
  /** Torque-free growth rate of a perturbation to a spin at `rate` about the middle axis (index 1). */
  function intermediateGrowthRate(J, rate) {
    return Math.abs(rate) * Math.sqrt(((J[0] - J[1]) * (J[1] - J[2])) / (J[0] * J[2]));
  }
  /** Body-frame precession rate of the transverse rate for an axisymmetric body J=(Jt,Jt,Ja) spinning at ω_a. */
  function axisymmetricPrecession(Jt, Ja, wa) { return ((Ja - Jt) / Jt) * wa; }
  /** Time for a rest-to-rest slew of `angle` about axis i with torque limit τ and rate limit ωmax. */
  function slewTime(J, tau, wmax, angle) {
    const a = tau / J;
    const tBang = 2 * Math.sqrt(angle / a);
    if (a * tBang / 2 <= wmax) return tBang;
    return angle / wmax + wmax / a;
  }
  /** Momentum a thruster pair can dump per kilogram of propellant (N·m·s/kg). */
  function momentumPerKg(p) { return p.thrArm * p.isp * G0; }
  /** Propellant to dump `dh` N·m·s (kg). */
  function propellantFor(p, dh) { return dh / momentumPerKg(p); }
  /** Seconds until an empty wheel is full under a steady torque component tau. */
  function fillTime(p, tau) { return p.hMax / Math.abs(tau); }
  /** Seconds the propellant lasts against a steady disturbance torque of magnitude tau. */
  function lifetime(p, propKg, tau) { return (propKg * momentumPerKg(p)) / tau; }

  // ---------- fixed-timestep clock ----------
  function makeClock() { return { acc: 0, steps: 0 }; }
  /** Steps to run this frame at `rate`× real time; excess beyond maxSteps is dropped (slow device slows down, never spirals). */
  function clockSteps(clock, wallDt, rate, maxSteps) {
    clock.acc += (Math.min(Math.max(wallDt, 0), 0.25) * rate) / DT;
    let n = Math.floor(clock.acc);
    clock.acc -= n;
    if (maxSteps !== undefined && n > maxSteps) { n = maxSteps; clock.acc = 0; }
    clock.steps += n;
    return n;
  }

  return {
    DT, G0, W0, W1, DEFAULTS, thrusterLayout, targetHoldable,
    qmul, qconj, qnormalize, qFromAxisAngle, qToMat, rotate, rotateInv, errorVector,
    makeParams, makeState, omega, kineticEnergy, inertialMomentum, resetLedger, ledgerResidual,
    drift, control, step, nudgeTarget, setMode, setTumble,
    intermediateGrowthRate, axisymmetricPrecession, slewTime, momentumPerKg, propellantFor, fillTime, lifetime,
    makeClock, clockSteps,
  };
});
