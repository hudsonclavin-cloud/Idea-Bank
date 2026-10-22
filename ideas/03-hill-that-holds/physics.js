/*
 * physics.js — circular restricted three-body problem (CR3BP), pure and DOM-free.
 *
 * Works as a classic browser script (exposes globalThis.HillPhysics, so index.html can be
 * opened straight from disk) and as a CommonJS module for the node:test suite.
 *
 * Units (the standard dimensionless CR3BP units):
 *   G (M_star + M_planet) = 1, star–planet separation = 1, frame angular velocity n = 1.
 *   One planet orbit ("planet-year") therefore lasts 2π time units.
 *   mu = M_planet / (M_star + M_planet). Star sits at (-mu, 0), planet at (1 - mu, 0),
 *   barycentre at the origin, frame rotating counter-clockwise with the planet.
 *
 * Marble state is {x, y, px, py}: rotating-frame position plus the canonical momenta
 *   p = v + Ω×r = (vx − y, vy + x), i.e. the *inertial* velocity expressed in the rotating
 *   basis. Storing p (not v) means the real-physics integrator never round-trips through a
 *   conversion, so angular momentum in the two-body limit is conserved to round-off.
 *   Use makeState(x, y, vx, vy) / velocity(s) to work with rotating-frame velocities.
 *
 * Integrator: 4th-order Yoshida composition of a 2nd-order symplectic splitting.
 *   Coriolis ON (real physics): rotating-frame Hamiltonian
 *       H = ½|p|² − (x p_y − y p_x) − U(x, y),   p = v + Ω×r = (vx − y, vy + x)
 *     split as  H = [½|p|² − L_z]  +  [−U].
 *     The first part is solved exactly (straight-line drift, then rotate q and p by −h:
 *     the two pieces commute), the second is a kick. Kick–drift–kick is symplectic, so the
 *     Jacobi constant C = 2Ω − |v|² shows bounded error with no secular drift.
 *   Coriolis OFF (counterfactual): H' = ½|v|² − Ω(x, y), plain kick–drift–kick leapfrog.
 *     Coriolis does no work, so the same Jacobi function is conserved in both worlds.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HillPhysics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TAU = Math.PI * 2;
  const STEPS_PER_ORBIT = 1200;
  const DT = TAU / STEPS_PER_ORBIT;
  /** Steps per physics tick. The app only ever advances whole ticks, so results never depend on frame rate. */
  const TICK_STEPS = 6;
  const TICKS_PER_ORBIT = STEPS_PER_ORBIT / TICK_STEPS;
  /** Gascheau–Routh criterion: L4/L5 are linearly stable iff 27 mu (1 - mu) < 1. */
  const ROUTH_MU = (1 - Math.sqrt(23 / 27)) / 2;

  // Yoshida (1990) 4th-order composition weights.
  const CBRT2 = Math.cbrt(2);
  const W1 = 1 / (2 - CBRT2);
  const W0 = -CBRT2 / (2 - CBRT2);

  /** Effective potential Ω = ½(x²+y²) + (1−μ)/r1 + μ/r2. Effective potential *energy* is −Ω. */
  function omega(x, y, mu) {
    const dx1 = x + mu, dx2 = x - 1 + mu;
    const r1 = Math.sqrt(dx1 * dx1 + y * y);
    const r2 = Math.sqrt(dx2 * dx2 + y * y);
    return 0.5 * (x * x + y * y) + (1 - mu) / r1 + mu / r2;
  }

  /** ∇U for the gravitational part only, U = (1−μ)/r1 + μ/r2. Writes into out[0..1]. */
  function gradU(x, y, mu, out) {
    const dx1 = x + mu, dx2 = x - 1 + mu;
    const q1 = dx1 * dx1 + y * y, q2 = dx2 * dx2 + y * y;
    const a = (1 - mu) / (q1 * Math.sqrt(q1));
    const b = mu / (q2 * Math.sqrt(q2));
    out[0] = -a * dx1 - b * dx2;
    out[1] = -(a + b) * y;
    return out;
  }

  /** ∇Ω = r + ∇U. */
  function gradOmega(x, y, mu, out) {
    gradU(x, y, mu, out);
    out[0] += x;
    out[1] += y;
    return out;
  }

  /** Build a state from rotating-frame position and rotating-frame velocity. */
  function makeState(x, y, vx, vy) {
    return { x, y, px: vx - y, py: vy + x };
  }

  /** Rotating-frame velocity [vx, vy] of a state. */
  function velocity(s) {
    return [s.px + s.y, s.py - s.x];
  }

  /** Jacobi constant C = 2Ω − v². Larger C = less energy in the rotating frame. */
  function jacobi(s, mu) {
    const vx = s.px + s.y, vy = s.py - s.x;
    return 2 * omega(s.x, s.y, mu) - (vx * vx + vy * vy);
  }

  function bisect(f, lo, hi) {
    let flo = f(lo);
    for (let i = 0; i < 200; i++) {
      const mid = 0.5 * (lo + hi);
      if (mid === lo || mid === hi) break;
      const fm = f(mid);
      if ((fm < 0) === (flo < 0)) { lo = mid; flo = fm; } else hi = mid;
    }
    return 0.5 * (lo + hi);
  }

  /** The five Lagrange points for a given mu, as [x, y] pairs in rotating coordinates. */
  function lagrangePoints(mu) {
    const g = [0, 0];
    const fx = (x) => gradOmega(x, 0, mu, g)[0];
    const eps = 1e-12;
    const xp = 1 - mu, xs = -mu;
    return {
      L1: [bisect(fx, xs + eps, xp - eps), 0],
      L2: [bisect(fx, xp + eps, 3), 0],
      L3: [bisect(fx, -3, xs - eps), 0],
      L4: [0.5 - mu, Math.sqrt(3) / 2],
      L5: [0.5 - mu, -Math.sqrt(3) / 2],
    };
  }

  /**
   * Radius of the potential ridge (where ∂Ω/∂r = 0) along the ray at angle phi from the
   * barycentre, searched in [0.75, 1.25]. Returns NaN if the ray has no crest there
   * (e.g. it passes through the planet's well).
   */
  function crestRadius(phi, mu) {
    const g = [0, 0];
    const c = Math.cos(phi), sn = Math.sin(phi);
    const f = (r) => { gradOmega(r * c, r * sn, mu, g); return g[0] * c + g[1] * sn; };
    const lo = 0.75, hi = 1.25;
    if ((f(lo) < 0) === (f(hi) < 0)) return NaN;
    return bisect(f, lo, hi);
  }

  /**
   * Collision radii. Real bodies are tiny at this scale, so both are exaggerated for visibility;
   * the planet scales like its Hill radius so close encounters look alike at every mu.
   */
  function bodyRadii(mu) {
    const L = lagrangePoints(mu);
    const hill = (1 - mu) - L.L1[0]; // planet-to-L1 distance (≈ (mu/3)^(1/3) for small mu)
    const star = 0.09 * Math.cbrt(1 - mu);
    return { star, planet: Math.min(0.3 * hill, 0.8 * star), hill };
  }

  /**
   * Linearised motion about L4: λ⁴ + λ² + (27/4) μ(1−μ) = 0.
   * Below the Gascheau–Routh limit (27μ(1−μ) < 1) there are two oscillations: a slow libration
   * sLong (the "tadpole") and a fast epicycle sShort (≈ 1 per planet-year), with ratio = sShort/sLong.
   * Linear stability is necessary but not sufficient: where ratio is 2 or 3 (resonantMu(2), resonantMu(3))
   * the nonlinear terms can still destabilise L4, and wide tadpoles nearby are fragile.
   * Exactly at the limit (marginal) the two frequencies merge into a double root; the linear
   * solution then grows like t·sin(t/√2), so it is reported as not linearly stable.
   */
  function l4Linear(mu) {
    const k = 27 * mu * (1 - mu);
    const disc = 1 - k;
    if (Math.abs(disc) < 1e-9) {
      const s = Math.SQRT1_2;
      return { stable: false, marginal: true, growthRate: 0, sLong: s, sShort: s, ratio: 1 };
    }
    if (disc < 0) {
      // Complex λ²: one root pair has a positive real part → exponential growth.
      const re = -0.5, im = 0.5 * Math.sqrt(-disc);
      const mod = Math.sqrt(Math.hypot(re, im));
      const arg = Math.atan2(im, re) / 2;
      return { stable: false, marginal: false, growthRate: mod * Math.cos(arg), sLong: NaN, sShort: NaN, ratio: NaN };
    }
    const sq = Math.sqrt(disc);
    const sLong = Math.sqrt((1 - sq) / 2), sShort = Math.sqrt((1 + sq) / 2);
    return { stable: true, marginal: false, growthRate: 0, sLong, sShort, ratio: sShort / sLong };
  }

  /**
   * The mass ratio at which the fast and slow L4 frequencies are in n:1 resonance.
   * From sLong² + sShort² = 1 and sLong²·sShort² = 27μ(1−μ)/4 with sShort = n·sLong:
   * 27μ(1−μ) = 4n²/(1+n²)². n = 1 gives the Routh limit; n = 2, 3 give ≈ 0.024294, 0.013516.
   */
  function resonantMu(n) {
    const q = (4 * n * n) / (27 * (1 + n * n) * (1 + n * n));
    return (1 - Math.sqrt(1 - 4 * q)) / 2;
  }

  /*
   * The frame rotation by −h is applied as three shears (Paeth):
   *   x += T·y;  y −= S·x;  x += T·y,   with T = tan(h/2), S = sin(h).
   * Each shear has determinant exactly 1 whatever the rounding of T and S, so the
   * angular momentum q×p is not biased by the coefficients. (A plain cos/sin matrix has
   * c² + s² ≈ 1 − 1e-16, which scales q×p every step and accumulates linearly.)
   */
  const _g = [0, 0];
  const TW1 = Math.tan((W1 * DT) / 2), SW1 = Math.sin(W1 * DT);
  const TW0 = Math.tan((W0 * DT) / 2), SW0 = Math.sin(W0 * DT);

  /**
   * Advance one marble n steps of size DT in place.
   * Returns 0 if alive, 1 if it hit the star, 2 if it hit the planet, 3 if it escaped (r > rEscape).
   */
  function integrate(s, mu, coriolis, n, radii, rEscape) {
    const rs2 = radii ? radii.star * radii.star : 0;
    const rp2 = radii ? radii.planet * radii.planet : 0;
    const re2 = rEscape ? rEscape * rEscape : Infinity;
    const xs = -mu, xp = 1 - mu;
    let x = s.x, y = s.y, fate = 0;
    const g = _g;
    if (coriolis) {
      let px = s.px, py = s.py;
      gradU(x, y, mu, g);
      let gx = g[0], gy = g[1];
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < 3; k++) {
          const mid = k === 1;
          const h = (mid ? W0 : W1) * DT;
          const T = mid ? TW0 : TW1, S = mid ? SW0 : SW1;
          px += 0.5 * h * gx; py += 0.5 * h * gy;
          // Exact flow of ½|p|² − L_z: drift, then rotate q and p by −h (three shears).
          x += h * px; y += h * py;
          x += T * y; y -= S * x; x += T * y;
          px += T * py; py -= S * px; px += T * py;
          gradU(x, y, mu, g); gx = g[0]; gy = g[1];
          px += 0.5 * h * gx; py += 0.5 * h * gy;
        }
        const d1 = (x - xs) * (x - xs) + y * y, d2 = (x - xp) * (x - xp) + y * y;
        if (d1 < rs2) { fate = 1; break; }
        if (d2 < rp2) { fate = 2; break; }
        if (x * x + y * y > re2) { fate = 3; break; }
      }
      s.x = x; s.y = y; s.px = px; s.py = py;
    } else {
      let vx = s.px + y, vy = s.py - x;
      gradOmega(x, y, mu, g);
      let gx = g[0], gy = g[1];
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < 3; k++) {
          const h = (k === 1 ? W0 : W1) * DT;
          vx += 0.5 * h * gx; vy += 0.5 * h * gy;
          x += h * vx; y += h * vy;
          gradOmega(x, y, mu, g); gx = g[0]; gy = g[1];
          vx += 0.5 * h * gx; vy += 0.5 * h * gy;
        }
        const d1 = (x - xs) * (x - xs) + y * y, d2 = (x - xp) * (x - xp) + y * y;
        if (d1 < rs2) { fate = 1; break; }
        if (d2 < rp2) { fate = 2; break; }
        if (x * x + y * y > re2) { fate = 3; break; }
      }
      s.x = x; s.y = y; s.px = vx - y; s.py = vy + x;
    }
    return fate;
  }

  /** Rotating-frame state at time t → inertial (barycentric, non-rotating) position and velocity. */
  function toInertial(s, t) {
    const c = Math.cos(t), sn = Math.sin(t);
    const px = s.px, py = s.py; // inertial velocity, rotating basis
    return {
      x: c * s.x - sn * s.y,
      y: sn * s.x + c * s.y,
      vx: c * px - sn * py,
      vy: sn * px + c * py,
    };
  }

  /** Inverse of toInertial. */
  function fromInertial(X, t) {
    const c = Math.cos(t), sn = Math.sin(t);
    const x = c * X.x + sn * X.y, y = -sn * X.x + c * X.y;
    const px = c * X.vx + sn * X.vy, py = -sn * X.vx + c * X.vy;
    return { x, y, px, py };
  }

  /**
   * Fixed-timestep clock. Wall time accumulates; physics advances only in whole ticks of
   * TICK_STEPS * DT, so the trajectory is bit-for-bit independent of frame rate.
   * orbitSeconds = wall seconds per planet-year at 1× speed.
   */
  function makeClock(orbitSeconds) {
    return { acc: 0, ticks: 0, orbitSeconds };
  }

  /** Returns the number of ticks to run for this frame (capped; excess is dropped so a slow device slows down instead of spiralling). */
  function clockTicks(clock, wallDt, speed, maxTicks) {
    const ticksPerSecond = (TICKS_PER_ORBIT * speed) / clock.orbitSeconds;
    clock.acc += Math.min(Math.max(wallDt, 0), 0.25) * ticksPerSecond;
    let n = Math.floor(clock.acc);
    clock.acc -= n;
    if (maxTicks !== undefined && n > maxTicks) n = maxTicks;
    clock.ticks += n;
    return n;
  }

  return {
    TAU, DT, STEPS_PER_ORBIT, TICK_STEPS, TICKS_PER_ORBIT, ROUTH_MU, W0, W1,
    omega, gradU, gradOmega, makeState, velocity, jacobi, lagrangePoints, crestRadius, bodyRadii, l4Linear, resonantMu,
    integrate, toInertial, fromInertial, makeClock, clockTicks,
  };
});
