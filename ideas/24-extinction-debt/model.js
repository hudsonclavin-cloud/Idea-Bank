/*
 * model.js — the competition–colonization metapopulation model with habitat destruction,
 * pure and DOM-free. Works as a classic browser script (exposes globalThis.ExtinctionDebt,
 * so index.html opens straight from disk) and as a CommonJS module for the node:test suite.
 *
 * THE MODEL (Levins 1969 for one species; Nee & May 1992 for two; Tilman 1994 and
 * Tilman, May, Lehman & Nowak 1994 for the ranked multispecies version with destruction):
 *
 *   The habitat is a huge number of identical sites. A site is destroyed (fraction D),
 *   empty, or held by exactly one individual of species i. Species are ranked 1..S by
 *   competitive ability: a propagule of species j landing on a site held by species i > j
 *   takes the site instantly; a propagule landing on a site held by a better competitor
 *   dies. Propagules of species i rain on every site at rate c_i * p_i (global dispersal),
 *   and every individual dies at rate m. With p_i the fraction of ALL sites held by i:
 *
 *     dp_i/dt = c_i p_i (1 − D − Σ_{j≤i} p_j)  −  m p_i  −  p_i Σ_{j<i} c_j p_j
 *
 *   Equilibrium, solved top-down (each species' equation involves only better competitors):
 *
 *     p_i* = 1 − D − m/c_i − Σ_{j<i, p_j*>0} p_j* (1 + c_j / c_i),   clipped at 0.
 *
 *   The "geometric" trade-off, c_i = m / (1 − q)^(2i − 1), gives, with no destruction,
 *   p_i* = q (1 − q)^(i − 1): the best competitor is the commonest species and abundance
 *   falls geometrically down the ranks (every formula here is checked in model.test.mjs).
 *
 * TIME UNITS. Rates are per year; m = 1 / (mean lifetime of an occupant in years).
 *
 * THE LATTICE is a finite, stochastic version of the same rules on W×H sites, stepped
 * synchronously with per-site event probabilities equal to (rate × dt), dt capped so that
 * the largest per-site probability is small. In expectation that is an explicit Euler step
 * of the ODE above; the difference is demographic noise of order sqrt(p / N).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.ExtinctionDebt = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ---------------------------------------------------------------- parameters

  /** Colonization rates of the geometric trade-off: c_i = m / (1 − q)^(2i − 1), i = 1..S. */
  function geometricRates(S, q, m) {
    if (!(S >= 1) || !(q > 0 && q < 1) || !(m > 0)) throw new Error('geometricRates: bad arguments');
    const c = new Float64Array(S);
    for (let i = 0; i < S; i++) c[i] = m / Math.pow(1 - q, 2 * i + 1);
    return c;
  }

  /** Undisturbed equilibrium of the geometric trade-off in closed form: q (1 − q)^(i − 1). */
  function geometricAbundances(S, q) {
    const p = new Float64Array(S);
    for (let i = 0; i < S; i++) p[i] = q * Math.pow(1 - q, i);
    return p;
  }

  // ---------------------------------------------------------------- equilibrium

  /**
   * Equilibrium fractions for colonization rates c, mortality m, destroyed fraction D.
   * Species whose equilibrium would be ≤ 0 cannot invade the community of their superiors
   * and are set to exactly 0; the rest follow the top-down formula in the header.
   */
  function equilibrium(c, m, D) {
    const S = c.length;
    const p = new Float64Array(S);
    for (let i = 0; i < S; i++) {
      let v = 1 - D - m / c[i];
      for (let j = 0; j < i; j++) if (p[j] > 0) v -= p[j] * (1 + c[j] / c[i]);
      // Exactly-marginal species (v = 0 up to round-off, which happens at every threshold of the
      // geometric trade-off) count as absent: they could not hold on in any finite habitat.
      p[i] = v > 1e-12 ? v : 0;
    }
    return p;
  }

  /** Per-capita growth rate of species i when it is rare and its superiors sit at p (invasion rate). */
  function invasionRate(c, m, D, p, i) {
    let free = 1 - D;
    let displaced = 0;
    for (let j = 0; j < i; j++) {
      free -= p[j];
      displaced += c[j] * p[j];
    }
    return c[i] * free - m - displaced;
  }

  /**
   * Destruction threshold of species i (0-based): the smallest D at which its equilibrium is 0.
   * Found by bisection on the equilibrium, assuming {D : p_i*(D) > 0} is an interval from 0
   * (true for the geometric trade-off; model.test.mjs checks it on a grid). Returns 0 if the
   * species is absent even with no destruction.
   */
  function threshold(c, m, i, tol = 1e-10) {
    if (equilibrium(c, m, 0)[i] <= 0) return 0;
    let lo = 0;
    let hi = 1;
    while (hi - lo > tol) {
      const mid = 0.5 * (lo + hi);
      if (equilibrium(c, m, mid)[i] > 0) lo = mid;
      else hi = mid;
    }
    return 0.5 * (lo + hi);
  }

  /** Closed-form threshold for the geometric trade-off: species k (1-based) dies iff D ≥ 1 − (1 − q)^(2k − 1). */
  function geometricThreshold(k, q) {
    return 1 - Math.pow(1 - q, 2 * k - 1);
  }

  // ---------------------------------------------------------------- dynamics

  /** dp/dt of the mean-field model, written into out (Float64Array of length S). */
  function derivs(p, c, m, D, out) {
    const S = c.length;
    let cum = 0; // Σ_{j<i} p_j
    let disp = 0; // Σ_{j<i} c_j p_j
    for (let i = 0; i < S; i++) {
      const pi = p[i];
      out[i] = c[i] * pi * (1 - D - cum - pi) - m * pi - pi * disp;
      cum += pi;
      disp += c[i] * pi;
    }
    return out;
  }

  /** One classical RK4 step of length dt, in place. Negative round-off is clipped to 0. */
  function rk4Step(p, c, m, D, dt, scratch) {
    const S = p.length;
    const k1 = scratch.k1;
    const k2 = scratch.k2;
    const k3 = scratch.k3;
    const k4 = scratch.k4;
    const tmp = scratch.tmp;
    derivs(p, c, m, D, k1);
    for (let i = 0; i < S; i++) tmp[i] = p[i] + 0.5 * dt * k1[i];
    derivs(tmp, c, m, D, k2);
    for (let i = 0; i < S; i++) tmp[i] = p[i] + 0.5 * dt * k2[i];
    derivs(tmp, c, m, D, k3);
    for (let i = 0; i < S; i++) tmp[i] = p[i] + dt * k3[i];
    derivs(tmp, c, m, D, k4);
    for (let i = 0; i < S; i++) {
      const v = p[i] + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
      p[i] = v > 0 ? v : 0;
    }
  }

  function makeScratch(S) {
    return {
      k1: new Float64Array(S),
      k2: new Float64Array(S),
      k3: new Float64Array(S),
      k4: new Float64Array(S),
      tmp: new Float64Array(S),
    };
  }

  /** A safe RK4 step for these rates: a small fraction of the fastest per-capita rate. */
  function suggestedDt(c, m) {
    let cmax = m;
    for (let i = 0; i < c.length; i++) if (c[i] > cmax) cmax = c[i];
    return 0.05 / cmax;
  }

  /**
   * Integrate the ODE from p0 for `years`, sampling every `every` years.
   * Returns { t: Float64Array, p: Array<Float64Array> (one row per sample), final: Float64Array }.
   */
  function integrate(p0, c, m, D, years, every, dt) {
    const S = c.length;
    dt = dt || suggestedDt(c, m);
    const p = Float64Array.from(p0);
    const scratch = makeScratch(S);
    const ts = [0];
    const rows = [Float64Array.from(p)];
    let t = 0;
    let nextSample = every;
    while (t < years - 1e-12) {
      const h = Math.min(dt, years - t);
      rk4Step(p, c, m, D, h, scratch);
      t += h;
      if (t >= nextSample - 1e-9 || t >= years - 1e-12) {
        ts.push(t);
        rows.push(Float64Array.from(p));
        nextSample += every;
      }
    }
    return { t: Float64Array.from(ts), p: rows, final: p };
  }

  /**
   * Forecast each species' fate from state p0 under destruction D.
   * A species is "doomed" if its equilibrium is 0; its predicted extinction year is when the
   * ODE first carries it below `floor` (one individual in N sites: floor = 1/N).
   * Returns { doomed: boolean[], eta: number[] (years from now, Infinity if beyond horizon or safe),
   *           eq: Float64Array, trajectory: { t, p } sampled every `every` years }.
   */
  function forecast(p0, c, m, D, floor, horizon, every, opts) {
    const S = c.length;
    const eq = equilibrium(c, m, D);
    const doomed = Array.from(eq, (v) => v <= 0);
    const eta = new Array(S).fill(Infinity);
    const dt = (opts && opts.dt) || suggestedDt(c, m);
    const minHorizon = (opts && opts.minHorizon) || 0;
    const p = Float64Array.from(p0);
    const scratch = makeScratch(S);
    const ts = [0];
    const rows = [Float64Array.from(p)];
    let t = 0;
    let nextSample = every;
    let open = 0;
    for (let i = 0; i < S; i++) if (doomed[i] && p[i] >= floor) open++;
    for (let i = 0; i < S; i++) if (doomed[i] && p[i] < floor) eta[i] = 0;
    while (t < horizon) {
      rk4Step(p, c, m, D, dt, scratch);
      t += dt;
      for (let i = 0; i < S; i++) {
        if (doomed[i] && eta[i] === Infinity && p[i] < floor) {
          eta[i] = t;
          open--;
        }
      }
      if (t >= nextSample - 1e-9) {
        ts.push(t);
        rows.push(Float64Array.from(p));
        nextSample += every;
      }
      if (open === 0 && t > every * 4 && t >= minHorizon) {
        // every doomed species has crossed the floor; keep sampling a little so the chart settles
        if (ts[ts.length - 1] > Math.max(...eta.filter((v) => v !== Infinity), 0) + 4 * every) break;
      }
    }
    return { doomed, eta, eq, trajectory: { t: Float64Array.from(ts), p: rows } };
  }

  /**
   * Species 1 obeys an exact logistic equation (nothing displaces it):
   *   dp/dt = p (r − c_1 p),  r = c_1 (1 − D) − m,
   * whose solution is p(t) = r p0 e^{rt} / (r + c_1 p0 (e^{rt} − 1)) for any sign of r.
   */
  function topSpeciesClosedForm(p0, c1, m, D, t) {
    const r = c1 * (1 - D) - m;
    if (Math.abs(r) < 1e-14) return p0 / (1 + c1 * p0 * t);
    const e = Math.exp(r * t);
    return (r * p0 * e) / (r + c1 * p0 * (e - 1));
  }

  /** Decline rate of the best competitor after destruction D: r_1 = c_1 (1 − D) − m (negative when doomed). */
  function topSpeciesRate(c1, m, D) {
    return c1 * (1 - D) - m;
  }

  // ---------------------------------------------------------------- random numbers

  /** mulberry32: small, fast, seedable; good enough for a toy's demographic noise. */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------------------------------------------------------------- the lattice

  const EMPTY = 0;
  const DESTROYED = -1;

  /**
   * A W×H lattice of sites. state[k] is EMPTY (0), DESTROYED (−1) or a 1-based species index.
   * counts[i] (i = 1..S) = number of sites held by species i; counts[0] = empty sites.
   */
  class Lattice {
    constructor(W, H, c, m, seed) {
      this.W = W;
      this.H = H;
      this.N = W * H;
      this.S = c.length;
      this.c = Float64Array.from(c);
      this.m = m;
      this.rand = mulberry32(seed == null ? 1 : seed);
      this.state = new Int16Array(this.N);
      this.counts = new Int32Array(this.S + 1);
      this.destroyed = 0;
      this.time = 0;
      this.maxEventProb = 0.05; // caps dt: largest per-site event probability per step
      this.maxDt = 1; // years
      this.lastDt = 0;
      this._rates = new Float64Array(this.S + 1); // _rates[i] = c_i p_i (1-based)
      this._cum = new Float64Array(this.S + 1); // _cum[i] = Σ_{j≤i} c_j p_j
      this.extinctAt = new Float64Array(this.S).fill(NaN); // year a species' last site emptied
      this.counts[0] = this.N;
    }

    /** Fraction of all sites destroyed. */
    get D() {
      return this.destroyed / this.N;
    }

    /** Fractions of all sites held by each species (0-based array of length S). */
    fractions() {
      const p = new Float64Array(this.S);
      for (let i = 0; i < this.S; i++) p[i] = this.counts[i + 1] / this.N;
      return p;
    }

    /** Seed the lattice: each non-destroyed site becomes species i with probability p[i] (independently). */
    seed(p) {
      const S = this.S;
      const cum = new Float64Array(S + 1);
      for (let i = 0; i < S; i++) cum[i + 1] = cum[i] + p[i];
      if (cum[S] > 1 + 1e-9) throw new Error('seed: fractions exceed 1');
      this.counts.fill(0);
      for (let k = 0; k < this.N; k++) {
        if (this.state[k] === DESTROYED) continue;
        const u = this.rand();
        let s = EMPTY;
        for (let i = 0; i < S; i++) if (u < cum[i + 1]) { s = i + 1; break; }
        this.state[k] = s;
        this.counts[s]++;
      }
      this.extinctAt.fill(NaN);
      for (let i = 0; i < S; i++) if (this.counts[i + 1] === 0) this.extinctAt[i] = this.time;
    }

    /** Destroy site k (anything on it dies). Returns true if the site changed. */
    destroySite(k) {
      const s = this.state[k];
      if (s === DESTROYED) return false;
      this.counts[s]--;
      this.state[k] = DESTROYED;
      this.destroyed++;
      if (s > 0 && this.counts[s] === 0) this.extinctAt[s - 1] = this.time;
      return true;
    }

    /** Restore site k to empty ground. Returns true if the site changed. */
    restoreSite(k) {
      if (this.state[k] !== DESTROYED) return false;
      this.state[k] = EMPTY;
      this.counts[0]++;
      this.destroyed--;
      return true;
    }

    /** Destroy sites chosen uniformly at random until the destroyed fraction is at least `fraction`. */
    destroyRandom(fraction) {
      const target = Math.min(this.N, Math.round(fraction * this.N));
      let guard = 0;
      while (this.destroyed < target && guard < this.N * 50) {
        this.destroySite(Math.floor(this.rand() * this.N));
        guard++;
      }
    }

    /** Restore destroyed sites chosen uniformly at random until the destroyed fraction is at most `fraction`. */
    restoreRandom(fraction) {
      const target = Math.max(0, Math.round(fraction * this.N));
      if (this.destroyed <= target) return;
      const idx = [];
      for (let k = 0; k < this.N; k++) if (this.state[k] === DESTROYED) idx.push(k);
      // partial Fisher–Yates
      let n = this.destroyed - target;
      for (let a = 0; a < n; a++) {
        const b = a + Math.floor(this.rand() * (idx.length - a));
        const t = idx[a];
        idx[a] = idx[b];
        idx[b] = t;
        this.restoreSite(idx[a]);
      }
    }

    /** The dt the next step would use. */
    nextDt() {
      const S = this.S;
      const N = this.N;
      let total = 0;
      for (let i = 1; i <= S; i++) total += this.c[i - 1] * (this.counts[i] / N);
      const lambdaMax = this.m + total; // an empty site sees `total`; an occupied one at most m + total
      return Math.min(this.maxDt, this.maxEventProb / lambdaMax);
    }

    /**
     * Advance by one synchronous step of length dt (default: nextDt()). Every site is visited;
     * per-site event probabilities are rate × dt using the fractions at the start of the step.
     * Returns the dt used.
     */
    step(dt) {
      const S = this.S;
      const N = this.N;
      const rates = this._rates;
      const cum = this._cum;
      if (dt == null) dt = this.nextDt();
      cum[0] = 0;
      for (let i = 1; i <= S; i++) {
        rates[i] = this.c[i - 1] * (this.counts[i] / N) * dt; // probability a given site receives a propagule of i this step
        cum[i] = cum[i - 1] + rates[i];
      }
      const mdt = this.m * dt;
      const state = this.state;
      const counts = this.counts;
      const rand = this.rand;
      const extinctAt = this.extinctAt;
      const time = this.time + dt;
      for (let k = 0; k < N; k++) {
        const s = state[k];
        if (s === DESTROYED) continue;
        const u = rand();
        if (s === EMPTY) {
          if (u < cum[S]) {
            // colonised: which species? the first i whose cumulative rate exceeds u
            let i = 1;
            while (u >= cum[i]) i++;
            state[k] = i;
            counts[0]--;
            counts[i]++;
            if (counts[i] === 1) extinctAt[i - 1] = NaN;
          }
        } else if (u < mdt) {
          state[k] = EMPTY;
          counts[s]--;
          counts[0]++;
          if (counts[s] === 0) extinctAt[s - 1] = time;
        } else {
          const v = u - mdt;
          if (v < cum[s - 1]) {
            // displaced by a better competitor j < s
            let j = 1;
            while (v >= cum[j]) j++;
            state[k] = j;
            counts[s]--;
            counts[j]++;
            if (counts[s] === 0) extinctAt[s - 1] = time;
            if (counts[j] === 1) extinctAt[j - 1] = NaN;
          }
        }
      }
      this.time = time;
      this.lastDt = dt;
      return dt;
    }

    /** Advance by `years` (a whole number of steps, overshooting by less than one step). Returns years advanced. */
    advance(years) {
      const t0 = this.time;
      while (this.time - t0 < years) this.step();
      return this.time - t0;
    }

    /** Sanity check used by the tests: counts agree with the state array. */
    audit() {
      const counts = new Int32Array(this.S + 1);
      let destroyed = 0;
      for (let k = 0; k < this.N; k++) {
        const s = this.state[k];
        if (s === DESTROYED) destroyed++;
        else counts[s]++;
      }
      let ok = destroyed === this.destroyed;
      for (let i = 0; i <= this.S; i++) ok = ok && counts[i] === this.counts[i];
      return ok;
    }
  }

  return {
    EMPTY,
    DESTROYED,
    geometricRates,
    geometricAbundances,
    equilibrium,
    invasionRate,
    threshold,
    geometricThreshold,
    derivs,
    rk4Step,
    makeScratch,
    suggestedDt,
    integrate,
    forecast,
    topSpeciesClosedForm,
    topSpeciesRate,
    mulberry32,
    Lattice,
  };
});
