/*
 * tub.js: the arithmetic of a bathtub, with no DOM in it.
 *
 * A stock (people in a shop, water in a reservoir, money in an account) changes
 * only by what flows in minus what flows out:
 *
 *     S(t) = S(t0) + integral from t0 to t of ( in(u) - out(u) ) du
 *
 * Every graph exercise gives its inflow and outflow as piecewise-linear curves
 * (a list of [time, rate] knots). Their difference is then linear between the
 * union of the knots, so the integral is a sum of exact trapezoids and every
 * answer below (the level at a time, when it peaks, which way it is moving) is
 * exact, not sampled.
 *
 * Also here: grading for each kind of question, the misconception diagnostics
 * the feedback uses, and a seeded generator of fresh graph exercises for extra
 * practice.
 *
 * Loads as a classic browser script (window.Tub) and under Node (module.exports),
 * so the page and the tests share one source.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.Tub = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ---------------------------------------------------------------- */
  /* Piecewise-linear curves                                            */
  /* ---------------------------------------------------------------- */

  // Value of a piecewise-linear curve at t (held flat beyond its ends).
  function val(pts, t) {
    const n = pts.length;
    if (t <= pts[0][0]) return pts[0][1];
    if (t >= pts[n - 1][0]) return pts[n - 1][1];
    for (let i = 1; i < n; i++) {
      const [b, vb] = pts[i];
      if (t <= b) {
        const [a, va] = pts[i - 1];
        if (b === a) return vb;
        return va + ((vb - va) * (t - a)) / (b - a);
      }
    }
    return pts[n - 1][1];
  }

  function span(item) {
    return [item.time.from, item.time.to];
  }

  // Sorted union of the knot times of both flows, clipped to the time span,
  // with the level at each knot. Exercises are treated as immutable once built,
  // so this is computed once per exercise and cached.
  const CACHE = new WeakMap();
  function prep(item) {
    let c = CACHE.get(item);
    if (c && c.inflow === item.inflow && c.outflow === item.outflow && c.s0 === item.s0) return c;
    const [t0, t1] = span(item);
    const set = new Set([t0, t1]);
    for (const p of item.inflow) if (p[0] > t0 && p[0] < t1) set.add(p[0]);
    for (const p of item.outflow) if (p[0] > t0 && p[0] < t1) set.add(p[0]);
    const ks = [...set].sort((a, b) => a - b);
    const net = ks.map((t) => val(item.inflow, t) - val(item.outflow, t));
    const cum = [item.s0];
    for (let i = 1; i < ks.length; i++) cum.push(cum[i - 1] + ((net[i - 1] + net[i]) / 2) * (ks[i] - ks[i - 1]));
    c = { inflow: item.inflow, outflow: item.outflow, s0: item.s0, ks, net, cum };
    CACHE.set(item, c);
    return c;
  }

  function knots(item) {
    return prep(item).ks.slice();
  }

  function inAt(item, t) {
    return val(item.inflow, t);
  }
  function outAt(item, t) {
    return val(item.outflow, t);
  }
  function netAt(item, t) {
    return val(item.inflow, t) - val(item.outflow, t);
  }

  // The level at time t: exact, by trapezoids over the knot intervals (the
  // level at each knot is precomputed; the last part-interval is added here).
  function stockAt(item, t) {
    const { ks, cum } = prep(item);
    const [t0, t1] = span(item);
    const end = Math.max(t0, Math.min(t1, t));
    let lo = 0;
    let hi = ks.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (ks[mid] <= end) lo = mid;
      else hi = mid;
    }
    if (end >= ks[hi]) lo = hi;
    const a = ks[lo];
    if (end === a) return cum[lo];
    return cum[lo] + ((netAt(item, a) + netAt(item, end)) / 2) * (end - a);
  }

  // Times inside the span where the net flow changes sign (the flows cross).
  // Returns [{t, from: +1|-1, to: +1|-1}], 'from' being the sign just before.
  // Where the net sits at exactly zero for a while and then changes sign, the
  // crossing is put at the start of that zero stretch.
  function crossings(item) {
    const ks = knots(item);
    const out = [];
    let prevSign = 0;
    let zeroStart = null;
    for (let i = 0; i < ks.length; i++) {
      const v = netAt(item, ks[i]);
      const sg = Math.sign(v);
      if (i > 0) {
        const a = ks[i - 1];
        const va = netAt(item, a);
        if (va !== 0 && v !== 0 && Math.sign(va) !== sg) {
          out.push({ t: a + ((ks[i] - a) * va) / (va - v), from: Math.sign(va), to: sg });
        }
      }
      if (sg === 0) {
        if (zeroStart === null) zeroStart = ks[i];
        continue;
      }
      if (zeroStart !== null) {
        if (prevSign !== 0 && sg !== prevSign) out.push({ t: zeroStart, from: prevSign, to: sg });
        zeroStart = null;
      }
      prevSign = sg;
    }
    return out;
  }

  // Highest and lowest level over the span. A level's extremes can only sit at
  // the ends of the span or where the net flow is zero, so those are the only
  // candidates (and the integral is exact at each).
  function extremes(item) {
    const [t0, t1] = span(item);
    const cand = new Set([t0, t1]);
    for (const c of crossings(item)) cand.add(c.t);
    for (const k of knots(item)) if (netAt(item, k) === 0) cand.add(k);
    let max = { t: t0, s: -Infinity };
    let min = { t: t0, s: Infinity };
    for (const t of [...cand].sort((a, b) => a - b)) {
      const s = stockAt(item, t);
      if (s > max.s + 1e-9) max = { t, s };
      if (s < min.s - 1e-9) min = { t, s };
    }
    return { max, min };
  }

  // Sampled curve, for drawing.
  function stockCurve(item, n) {
    const [t0, t1] = span(item);
    const pts = [];
    const N = n || 120;
    const ks = knots(item).concat(crossings(item).map((c) => c.t));
    const ts = new Set(ks);
    for (let i = 0; i <= N; i++) ts.add(t0 + ((t1 - t0) * i) / N);
    for (const t of [...ts].sort((a, b) => a - b)) pts.push([t, stockAt(item, t)]);
    return pts;
  }

  // Time where a flow (or the net) is largest. Ties: earliest.
  function argmaxCurve(item, f) {
    const ks = knots(item);
    let best = ks[0];
    let bv = -Infinity;
    for (const t of ks) {
      const v = f(t);
      if (v > bv + 1e-12) {
        bv = v;
        best = t;
      }
    }
    return { t: best, v: bv };
  }

  function maxFlow(item) {
    let m = 0;
    for (const p of item.inflow) m = Math.max(m, p[1]);
    for (const p of item.outflow) m = Math.max(m, p[1]);
    return m;
  }

  /* ---------------------------------------------------------------- */
  /* Grading                                                            */
  /* ---------------------------------------------------------------- */

  // A tap for "when was it fullest" is right when the level at the tapped time
  // is within TOL of the true highest level, measured as a fraction of how far
  // the level travels over the whole span. You are graded on how full it really
  // was at the moment you picked, so a broad flat top forgives more than a spike.
  const PEAK_TOL = 0.03;

  function snapTime(item, t) {
    const [t0, t1] = span(item);
    const s = item.time.snap || 0;
    let v = Math.max(t0, Math.min(t1, t));
    if (s > 0) v = t0 + Math.round((v - t0) / s) * s;
    return Math.max(t0, Math.min(t1, v));
  }

  function extremeScore(item, which, t, ex) {
    const { max, min } = ex || extremes(item);
    const range = max.s - min.s;
    const s = stockAt(item, t);
    if (range <= 0) return 1;
    return which === 'max' ? (s - min.s) / range : (max.s - s) / range;
  }

  // The accepted region as a list of [from, to] intervals, found on a fine grid
  // and refined by bisection (used for feedback and tests; grading itself only
  // needs extremeScore).
  function acceptIntervals(item, which, tol) {
    const T = tol == null ? PEAK_TOL : tol;
    const [t0, t1] = span(item);
    const N = 600;
    const ex = extremes(item);
    const ok = (t) => extremeScore(item, which, t, ex) >= 1 - T - 1e-12;
    const out = [];
    let start = null;
    let prevT = t0;
    for (let i = 0; i <= N; i++) {
      const t = t0 + ((t1 - t0) * i) / N;
      const good = ok(t);
      if (good && start === null) {
        start = i === 0 ? t0 : bisect(ok, prevT, t);
      } else if (!good && start !== null) {
        out.push([start, bisect((x) => !ok(x), prevT, t)]);
        start = null;
      }
      prevT = t;
    }
    if (start !== null) out.push([start, t1]);
    return out;
  }

  // f(lo) false, f(hi) true: find the switch.
  function bisect(f, lo, hi) {
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      if (f(mid)) hi = mid;
      else lo = mid;
    }
    return (lo + hi) / 2;
  }

  // What a wrong "when was it fullest/emptiest" tap most likely mistook. The
  // order matters: an answer that is right is never diagnosed.
  function diagnoseExtreme(item, which, t) {
    const [t0, t1] = span(item);
    const w = t1 - t0;
    const score = extremeScore(item, which, t);
    if (score >= 1 - PEAK_TOL - 1e-12) return 'ok';
    const near = (a) => Math.abs(t - a) <= 0.04 * w;
    // Near a turning point of the right kind that is not the highest (lowest) one.
    const ex = extremes(item);
    const bestT = which === 'max' ? ex.max.t : ex.min.t;
    let nearest = null;
    for (const c of crossings(item)) {
      const right = which === 'max' ? c.from > 0 && c.to < 0 : c.from < 0 && c.to > 0;
      if (!right) continue;
      if (nearest === null || Math.abs(t - c.t) < Math.abs(t - nearest)) nearest = c.t;
    }
    if (nearest !== null && Math.abs(nearest - bestT) > 1e-9 && Math.abs(t - nearest) <= 0.06 * w) return 'localTurn';
    if (which === 'max') {
      const inPk = argmaxCurve(item, (u) => inAt(item, u));
      if (near(inPk.t) || inAt(item, t) >= 0.95 * inPk.v) return 'inflowPeak';
      const fast = argmaxCurve(item, (u) => netAt(item, u));
      if (fast.v > 0 && near(fast.t)) return 'fastest';
      const outLow = argmaxCurve(item, (u) => -outAt(item, u));
      if (near(outLow.t) && outLow.t !== t0 && outLow.t !== t1) return 'outflowLow';
    } else {
      const outPk = argmaxCurve(item, (u) => outAt(item, u));
      if (near(outPk.t) || outAt(item, t) >= 0.95 * outPk.v) return 'outflowPeak';
      const fast = argmaxCurve(item, (u) => -netAt(item, u));
      if (fast.v > 0 && near(fast.t)) return 'fastest';
      const inLow = argmaxCurve(item, (u) => -inAt(item, u));
      if (near(inLow.t) && inLow.t !== t0 && inLow.t !== t1) return 'inflowLow';
    }
    const n = netAt(item, t);
    if (Math.abs(n) < 1e-9) return 'otherTurn';
    return n > 0 ? 'risingThen' : 'fallingThen';
  }

  // Direction of the level at a moment: 'rising' | 'falling' | 'steady'.
  function direction(item, t) {
    const n = netAt(item, t);
    const eps = 1e-9 * Math.max(1, maxFlow(item));
    if (n > eps) return 'rising';
    if (n < -eps) return 'falling';
    return 'steady';
  }

  // A sketch is graded on what the tool claims to tell you: where the level
  // turns, and which way it moves in between. Not its height or its scale.
  //
  //  1. The drawing is resampled on a grid of 121 times and smoothed (a moving
  //     average over 4% of the span either side), so hand wobble is not read
  //     as turning points. Turns are then placed on a lightly smoothed copy
  //     (1.5% either side), so a sharp drawn corner stays where it was drawn.
  //  2. Its turning points are found by hysteresis: a turn counts once the line
  //     has come back by at least 5% of its own height range (turnMin).
  //  3. Every true turn (a crossing of the flows) must be matched, in order, by
  //     a drawn turn of the same kind (a top for a top, a bottom for a bottom)
  //     inside that turn's window: within 5% of the span of the crossing, or
  //     wider where the true level stays within 3% of its range of the turning
  //     level, the same rule rung 2 uses for taps (turnTol, levelTol).
  //  4. No other clear drawn turn may sit outside every window of its kind.
  //     These are looked for on the lightly smoothed copy, so a short extra
  //     wiggle is not averaged away: a turn there counts once the line comes
  //     back by 10% of that copy's height range (bigTurn). Smaller turns there
  //     (from 5%) outside every window are returned as `minor`: not marked,
  //     but named in the feedback, so a pass does not claim more than it checks.
  //  5. Away from the windows, wherever the true level clearly moves (by 1% of
  //     its range over 5% of the span), the drawn line must go the same way at
  //     80% of the moments. A stretch that moves less than 0.8% of the line's
  //     own range over that window counts as level, which is wrong there.
  //  A line whose whole height range is under 4% of the panel is flat and fails.
  const SKETCH = {
    grid: 120,
    cover: 0.8,
    smooth: 0.04,
    fine: 0.015,
    turnMin: 0.05,
    bigTurn: 0.1,
    near: 0.005,
    turnTol: 0.05,
    levelTol: PEAK_TOL,
    win: 0.025,
    moving: 0.01,
    flat: 0.008,
    flatLine: 0.04,
    pass: 0.8,
  };

  // The true turning points, each with the window a drawn turn must land in
  // (cached per exercise, like the knots).
  const WINDOWS = new WeakMap();
  function turnWindows(item) {
    const c = WINDOWS.get(item);
    if (c && c.inflow === item.inflow && c.outflow === item.outflow && c.s0 === item.s0) return c.list;
    const list = computeWindows(item);
    WINDOWS.set(item, { inflow: item.inflow, outflow: item.outflow, s0: item.s0, list });
    return list;
  }
  function computeWindows(item) {
    const [t0, t1] = span(item);
    const w = t1 - t0;
    const ex = extremes(item);
    const range = Math.max(1e-12, ex.max.s - ex.min.s);
    const step = w / 2400;
    return crossings(item).map((c) => {
      const sT = stockAt(item, c.t);
      const close = (t) => Math.abs(stockAt(item, t) - sT) <= SKETCH.levelTol * range;
      let a = c.t;
      let b = c.t;
      while (a - step >= t0 && close(a - step)) a -= step;
      while (b + step <= t1 && close(b + step)) b += step;
      return {
        t: c.t,
        kind: c.from > 0 ? 'top' : 'bottom',
        win: [Math.max(t0, Math.min(a, c.t - SKETCH.turnTol * w)), Math.min(t1, Math.max(b, c.t + SKETCH.turnTol * w))],
      };
    });
  }

  // Turning points of a sampled line by hysteresis: a top counts once the
  // smoothed line `ys` has fallen back from its running high by at least
  // `theta` (a bottom, the same upside down). Each turn is then placed on a
  // lightly smoothed copy (`raw`), at its extreme within `reach` samples, so
  // the heavy smoothing does not drag a sharp corner towards the gentler side;
  // its time is the middle of the stretch that stays within `band` of that
  // extreme, so a drawn plateau turns in its middle.
  function lineTurns(ts, ys, raw, i0, i1, theta, band, reach) {
    const out = [];
    const place = (e0, kind) => {
      const sg = kind === 'top' ? 1 : -1;
      let e = e0;
      for (let j = Math.max(i0, e0 - reach); j <= Math.min(i1, e0 + reach); j++) if (sg * (raw[j] - raw[e]) > 0) e = j;
      const near = (j) => sg * (raw[e] - raw[j]) <= band;
      let a = e;
      let b = e;
      while (a - 1 >= i0 && near(a - 1)) a--;
      while (b + 1 <= i1 && near(b + 1)) b++;
      out.push({ kind, t: (ts[a] + ts[b]) / 2, y: raw[e] });
    };
    let mode = 0;
    let hiI = i0;
    let loI = i0;
    let ext = i0;
    for (let i = i0 + 1; i <= i1; i++) {
      const y = ys[i];
      if (mode === 0) {
        if (y > ys[hiI]) hiI = i;
        if (y < ys[loI]) loI = i;
        if (ys[hiI] - ys[loI] >= theta) {
          if (hiI > loI) {
            if (ys[i0] - ys[loI] >= theta) place(loI, 'bottom');
            mode = 1;
            ext = hiI;
          } else {
            if (ys[hiI] - ys[i0] >= theta) place(hiI, 'top');
            mode = -1;
            ext = loI;
          }
        }
      } else if (mode === 1) {
        if (y > ys[ext]) ext = i;
        else if (ys[ext] - y >= theta) {
          place(ext, 'top');
          mode = -1;
          ext = i;
        }
      } else if (y < ys[ext]) ext = i;
      else if (y - ys[ext] >= theta) {
        place(ext, 'bottom');
        mode = 1;
        ext = i;
      }
    }
    return out;
  }

  function gradeSketch(item, path, panelTop) {
    const [t0, t1] = span(item);
    const w = t1 - t0;
    const G = SKETCH.grid;
    const dt = w / G;
    const ts = [];
    for (let i = 0; i <= G; i++) ts.push(t0 + dt * i);
    if (!path || path.length < 2) return { ok: false, coverage: 0, agree: 0, counted: 0, reason: 'empty' };
    const xs = path.map((p) => p[0]);
    const xlo = Math.max(t0, Math.min(...xs));
    const xhi = Math.min(t1, Math.max(...xs));
    const coverage = (xhi - xlo) / w;
    if (coverage < SKETCH.cover) return { ok: false, coverage, agree: 0, counted: 0, reason: 'short' };
    // resample (sorted by time), then smooth with a moving average
    const p = path.slice().sort((a, b) => a[0] - b[0]);
    const raw = ts.map((t) => (t < p[0][0] || t > p[p.length - 1][0] ? null : val(p, t)));
    let i0 = 0;
    while (raw[i0] === null) i0++;
    let i1 = G;
    while (raw[i1] === null) i1--;
    const smooth = (h) =>
      raw.map((v, i) => {
        if (v === null) return null;
        let s = 0;
        let n = 0;
        for (let j = Math.max(i0, i - h); j <= Math.min(i1, i + h); j++) {
          s += raw[j];
          n++;
        }
        return s / n;
      });
    const m = Math.max(1, Math.round(SKETCH.smooth * G));
    const ys = smooth(m);
    const fine = smooth(Math.round(SKETCH.fine * G));
    let yHi = -Infinity;
    let yLo = Infinity;
    for (let i = i0; i <= i1; i++) {
      yHi = Math.max(yHi, ys[i]);
      yLo = Math.min(yLo, ys[i]);
    }
    const height = yHi - yLo;
    const ex = extremes(item);
    const panel = panelTop || Math.max(1, ex.max.s);
    const truth = turnWindows(item).map((tr) => Object.assign({}, tr, { win: tr.win.slice() }));
    const base = { coverage, truth, from: ts[i0], to: ts[i1] };
    if (height < SKETCH.flatLine * panel) {
      return Object.assign(base, { ok: false, reason: 'flat', agree: 0, counted: 0, marks: [], drawn: [], matched: [], missing: truth, extra: [], minor: [] });
    }
    const drawn = lineTurns(ts, ys, fine, i0, i1, SKETCH.turnMin * height, SKETCH.near * height, m);
    // extra turns are looked for on the lightly smoothed line, against its own
    // height, so a short extra wiggle is not halved by the heavy smoothing
    let fHi = -Infinity;
    let fLo = Infinity;
    for (let i = i0; i <= i1; i++) {
      fHi = Math.max(fHi, fine[i]);
      fLo = Math.min(fLo, fine[i]);
    }
    const big = lineTurns(ts, fine, fine, i0, i1, SKETCH.bigTurn * (fHi - fLo), SKETCH.near * height, m);
    const inWin = (d, tr) => d.kind === tr.kind && d.t >= tr.win[0] && d.t <= tr.win[1];
    // 3. every true turn matched, in order, by a drawn turn of its kind in its window
    const used = new Set();
    const matched = [];
    const missing = [];
    let after = -Infinity;
    for (const tr of truth) {
      const d = drawn.find((x) => x.t > after && inWin(x, tr));
      if (d) {
        used.add(d);
        matched.push(d);
        after = d.t;
      } else {
        // the nearest unmatched drawn turn of the same kind, to say where yours was
        let near = null;
        for (const x of drawn) if (!used.has(x) && x.kind === tr.kind && (!near || Math.abs(x.t - tr.t) < Math.abs(near.t - tr.t))) near = x;
        missing.push(Object.assign({}, tr, { drawn: near, beyond: tr.t < ts[i0] ? 'before' : tr.t > ts[i1] ? 'after' : false }));
      }
    }
    // 4. no clear drawn turn outside every window of its kind
    const extra = big.filter((d) => !truth.some((tr) => inWin(d, tr)));
    // smaller turns outside every band (found on the same light copy, from 5%
    // of its height): not marked, but not hidden either
    const near3 = (a, b) => a.kind === b.kind && Math.abs(a.t - b.t) <= 0.03 * w;
    const minor = lineTurns(ts, fine, fine, i0, i1, SKETCH.turnMin * (fHi - fLo), SKETCH.near * height, m).filter(
      (d) => !truth.some((tr) => d.t >= tr.win[0] && d.t <= tr.win[1]) && !extra.some((x) => near3(x, d)) && !missing.some((mm) => mm.drawn && near3(mm.drawn, d))
    );
    // 5. the way the line goes, wherever the true level clearly moves
    const k = Math.max(1, Math.round(SKETCH.win * G));
    const range = Math.max(1e-12, ex.max.s - ex.min.s);
    const marks = [];
    let counted = 0;
    let agree = 0;
    for (let i = i0 + k; i <= i1 - k; i++) {
      const t = ts[i];
      if (truth.some((tr) => t >= tr.win[0] - k * dt && t <= tr.win[1] + k * dt)) continue;
      const dS = stockAt(item, ts[i + k]) - stockAt(item, ts[i - k]);
      if (Math.abs(dS) < SKETCH.moving * range) continue;
      const dY = ys[i + k] - ys[i - k];
      const dir = dY > SKETCH.flat * height ? 1 : dY < -SKETCH.flat * height ? -1 : 0;
      const good = dir === Math.sign(dS);
      counted++;
      if (good) agree++;
      marks.push({ t, good, dir });
    }
    const frac = counted ? agree / counted : 1;
    const ok = missing.length === 0 && extra.length === 0 && frac >= SKETCH.pass;
    return Object.assign(base, { ok, reason: 'graded', agree: frac, counted, marks, drawn, matched, missing, extra, minor });
  }

  // Multiple-choice options for "how much is in it at time t?". The correct
  // answer is S0 + integral of net. Each distractor is one specific mistake.
  function amountOptions(item, t) {
    const correct = stockAt(item, t);
    let inArea = 0;
    let outArea = 0;
    const ks = knots(item).filter((k) => k <= t);
    if (ks[ks.length - 1] < t) ks.push(t);
    for (let i = 1; i < ks.length; i++) {
      const a = ks[i - 1];
      const b = ks[i];
      inArea += ((inAt(item, a) + inAt(item, b)) / 2) * (b - a);
      outArea += ((outAt(item, a) + outAt(item, b)) / 2) * (b - a);
    }
    const net = inArea - outArea;
    const cands = [
      { v: correct, why: 'ok' },
      { v: item.s0 + inArea, why: 'forgotOut' },
      { v: net, why: 'forgotStart' },
      { v: item.s0 - net, why: 'reversed' },
      { v: item.s0 + inArea + outArea, why: 'addedBoth' },
      { v: item.s0 - outArea, why: 'forgotIn' },
      { v: 2 * item.s0 + net, why: 'doubleStart' },
      { v: item.s0 + netAt(item, t) * (t - item.time.from), why: 'rateNow' },
    ];
    return { correct, inArea, outArea, net, cands };
  }

  // The correct answer and three distractors, each a named mistake, clearly
  // different from it and from each other, not negative, and whole numbers
  // when the answer is. Which three is chosen so that the right answer's size
  // gives nothing away: each exercise says how many distractors should sit
  // below the right answer (`below`, 0 to 3; generated exercises step through
  // it with their seed, hand-made ones state it), and the first set in order
  // of preference that does so is used (or the nearest it can get). The order
  // on screen is shuffled separately.
  function pickAmountChoices(item, t) {
    const a = amountOptions(item, t);
    const gap = Math.max(2, 0.08 * Math.abs(a.correct));
    const whole = Math.abs(a.correct - Math.round(a.correct)) < 1e-9;
    const ds = a.cands
      .slice(1)
      .filter((c) => c.v >= 0 && Math.abs(c.v - a.correct) >= gap && (!whole || Math.abs(c.v - Math.round(c.v)) < 1e-9));
    let want = item.below;
    if (!Number.isInteger(want)) {
      let h = 7;
      for (const ch of String(item.id)) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;
      want = h % 4;
    }
    let best = null;
    let bestMiss = Infinity;
    for (let i = 0; i < ds.length; i++) {
      for (let j = i + 1; j < ds.length; j++) {
        for (let k = j + 1; k < ds.length; k++) {
          const set = [ds[i], ds[j], ds[k]];
          if (Math.abs(set[0].v - set[1].v) < gap || Math.abs(set[0].v - set[2].v) < gap || Math.abs(set[1].v - set[2].v) < gap) continue;
          const miss = Math.abs(set.filter((c) => c.v < a.correct).length - want);
          if (miss < bestMiss) {
            best = set;
            bestMiss = miss;
          }
        }
      }
    }
    if (best) return [a.cands[0], ...best];
    // fewer than three usable distractors: as many as fit
    const chosen = [a.cands[0]];
    for (const c of ds) if (chosen.every((d) => Math.abs(d.v - c.v) >= gap)) chosen.push(c);
    return chosen.slice(0, 4);
  }

  /* ---------------------------------------------------------------- */
  /* Seeded generator for extra graph practice                          */
  /* ---------------------------------------------------------------- */

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // A smooth-ish hump sampled on the knots: base + height * (1 - x^2)+.
  function hump(ts, base, height, centre, width) {
    return ts.map((t) => {
      const x = (t - centre) / width;
      return [t, base + height * Math.max(0, 1 - x * x)];
    });
  }

  // Checks a generated (or hand-made) graph exercise is fair: flows and level
  // never negative, the level moves visibly, and the question it asks has a
  // crisp answer. Returns null when fine or a string saying what is wrong.
  function fairness(item) {
    const [t0, t1] = span(item);
    const w = t1 - t0;
    for (const p of item.inflow.concat(item.outflow)) if (p[1] < 0) return 'negative flow';
    const { max, min } = extremes(item);
    if (min.s < 0) return 'level goes negative';
    if (item.s0 === 0 && netAt(item, t0) < 0) return 'drains an empty tub';
    const [floor, top] = stockAxis(item);
    if (min.s < floor) return 'level dips below the axis';
    if ((max.s - min.s) / (top - floor) < 0.25) return 'level barely moves';
    const kind = item.kind;
    if (kind === 'peak' || kind === 'trough') {
      const which = kind === 'peak' ? 'max' : 'min';
      const iv = acceptIntervals(item, which);
      const width = iv.reduce((s, [a, b]) => s + (b - a), 0) / w;
      if (width < 0.02) return 'answer window too narrow';
      if (width > 0.25) return 'answer window too wide';
      if (iv.length !== 1) return 'two separate right answers';
      // at least one snap point inside
      const s = item.time.snap || 0;
      if (s > 0) {
        const [a, b] = iv[0];
        if (Math.floor((b - t0) / s) * s + t0 < a - 1e-9) return 'no snap point inside answer';
      }
    }
    if (kind === 'sketch') {
      // Every turn must be plain to see and to draw: between turns (and to and
      // from the ends) the level moves at least 15% of its range; turns sit at
      // least 8% of the span from the ends and 15% from each other.
      const cr = crossings(item);
      if (!cr.length) return 'no turning point';
      const times = [t0, ...cr.map((c) => c.t), t1];
      for (let i = 1; i < times.length; i++) {
        if (Math.abs(stockAt(item, times[i]) - stockAt(item, times[i - 1])) < 0.15 * (max.s - min.s)) return 'a turn too slight to draw';
      }
      for (const c of cr) if (c.t - t0 < 0.08 * w || t1 - c.t < 0.08 * w) return 'a turn too near the end';
      for (let i = 1; i < cr.length; i++) if (cr[i].t - cr[i - 1].t < 0.15 * w) return 'turns too close together';
      // the true curve passes, and a sketch shaped like the inflow fails
      const truth = stockCurve(item, 120);
      if (!gradeSketch(item, truth, top - floor).ok) return 'the true curve fails the grader';
      const fmax = Math.max(...item.inflow.map((q) => q[1]));
      const shaped = truth.map(([t]) => [t, floor + (0.9 * (top - floor) * inAt(item, t)) / fmax]);
      if (gradeSketch(item, shaped, top - floor).ok) return 'a sketch shaped like the inflow passes';
    }
    if (kind === 'dir') {
      const n = netAt(item, item.at);
      if (item.answer !== 'steady' && Math.abs(n) < 0.12 * maxFlow(item)) return 'flows too close at the asked moment';
    }
    return null;
  }

  // The stock panel's vertical range: from the item's floor (0 unless the level
  // is large next to its changes, as with a population) to a round number a
  // little above the highest level.
  function stockAxis(item) {
    const floor = item.floor || 0;
    const { max } = extremes(item);
    return [floor, floor + niceCeil((max.s - floor) * 1.12)];
  }

  function niceCeil(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v - 1e-9) return m * p;
    return 10 * p;
  }

  // Build one fresh exercise of a given kind from a template, deterministically
  // from the seed. Retries until the exercise passes `fairness` (and, for the
  // kinds that test the core mistake, until that mistake gives a wrong answer).
  function generate(kind, template, seed) {
    let h = 2166136261;
    for (const ch of `${kind}:${template.key}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    const rnd = mulberry32((h ^ Math.imul(seed >>> 0, 2654435761)) >>> 0);
    const T = template;
    const [t0, t1] = [T.time.from, T.time.to];
    const ts = [];
    for (let t = t0; t <= t1 + 1e-9; t += T.knotStep) ts.push(Math.round(t * 1000) / 1000);
    const q = (v) => Math.max(0, Math.round(v / T.quantum) * T.quantum);
    // for 'How much?': how many of the three wrong options sit below the right
    // one, kept through the retries, so that the right answer's size gives
    // nothing away. It steps through 0 to 3 with the seed: the trainer numbers
    // fresh exercises one after another, so the few a learner meets cover every
    // rank (a random draw left the low seeds everyone meets leaning to 0). The
    // draw is still taken, so the rest of the exercise is built as before.
    let below = 0;
    if (kind === 'amount') {
      rnd();
      below = (seed >>> 0) % 4;
    }
    for (let attempt = 0; attempt < 400; attempt++) {
      const M = T.flowMax;
      const w = t1 - t0;
      let inPts;
      let outPts;
      const shape = rnd();
      if (kind === 'trough') {
        // out hump first, in hump later (a dry spell, then rain)
        const c1 = t0 + w * (0.15 + 0.25 * rnd());
        const c2 = c1 + w * (0.2 + 0.3 * rnd());
        outPts = hump(ts, M * (0.15 + 0.2 * rnd()), M * (0.4 + 0.4 * rnd()), c1, w * (0.3 + 0.3 * rnd()));
        inPts = hump(ts, M * (0.1 + 0.2 * rnd()), M * (0.4 + 0.45 * rnd()), c2, w * (0.3 + 0.3 * rnd()));
      } else {
        const c1 = t0 + w * (0.1 + 0.3 * rnd());
        const c2 = c1 + w * (0.15 + 0.35 * rnd());
        inPts = hump(ts, M * (0.05 + 0.25 * rnd()), M * (0.45 + 0.5 * rnd()), c1, w * (0.25 + 0.35 * rnd()));
        outPts = hump(ts, M * (0.05 + 0.25 * rnd()), M * (0.3 + 0.5 * rnd()), c2, w * (0.3 + 0.4 * rnd()));
        if (shape < 0.25 && kind !== 'peak') {
          // swap roles sometimes, so not every picture fills first
          const tmp = inPts;
          inPts = outPts;
          outPts = tmp;
        }
      }
      inPts = inPts.map(([t, v]) => [t, Math.min(M, q(v))]);
      outPts = outPts.map(([t, v]) => [t, Math.min(M, q(v))]);
      // Start high enough that the level never goes below zero, plus a margin.
      const probe = { time: T.time, inflow: inPts, outflow: outPts, s0: 0 };
      const lowest = Math.min(0, extremes(probe).min.s);
      const s0 = q(-lowest + T.s0[0] + (T.s0[1] - T.s0[0]) * rnd());
      const item = {
        id: `gen:${kind}:${T.key}:${seed}`,
        generated: true,
        kind,
        template: T.key,
        story: T.story,
        stock: T.stock,
        inName: T.inName,
        outName: T.outName,
        flowUnit: T.flowUnit,
        stockUnit: T.stockUnit,
        time: T.time,
        inflow: inPts,
        outflow: outPts,
        s0,
      };
      if (kind === 'dir') {
        // ask at a knot where the inflow's trend points the wrong way
        const cands = [];
        for (let i = 1; i < ts.length - 1; i++) {
          const t = ts[i];
          const n = netAt(item, t);
          const trend = inAt(item, ts[i + 1]) - inAt(item, ts[i - 1]);
          if (Math.abs(n) >= 0.15 * M && trend !== 0 && Math.sign(trend) !== Math.sign(n)) cands.push(t);
        }
        if (!cands.length) continue;
        item.at = cands[Math.floor(rnd() * cands.length)];
        item.answer = direction(item, item.at);
      } else if (kind === 'amount') {
        const late = ts.filter((t) => t >= t0 + 0.4 * w && t < t1);
        item.at = late[Math.floor(rnd() * late.length)];
        item.below = below;
        const exact = stockAt(item, item.at);
        if (Math.abs(exact - Math.round(exact)) > 1e-9) continue;
        const ch = pickAmountChoices(item, item.at);
        if (ch.length < 4 || ch.filter((c) => c.v < exact).length !== item.below) continue;
      }
      if (fairness(item)) continue;
      if (kind === 'peak') {
        // the "it peaks when the inflow peaks" answer must be wrong
        const inPk = argmaxCurve(item, (u) => inAt(item, u)).t;
        if (extremeScore(item, 'max', inPk) >= 1 - PEAK_TOL) continue;
        const { max } = extremes(item);
        if (max.t === t0 || max.t === t1) continue;
      }
      if (kind === 'trough') {
        const outPk = argmaxCurve(item, (u) => outAt(item, u)).t;
        if (extremeScore(item, 'min', outPk) >= 1 - PEAK_TOL) continue;
        const { min } = extremes(item);
        if (min.t === t0 || min.t === t1) continue;
      }
      if (kind === 'sketch') {
        if (crossings(item).length < 1) continue;
      }
      return item;
    }
    return null;
  }

  /* ---------------------------------------------------------------- */
  /* Formatting                                                         */
  /* ---------------------------------------------------------------- */

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function fmtNum(v, dp) {
    const d = dp == null ? (Math.abs(v - Math.round(v)) < 1e-9 ? 0 : 1) : dp;
    const s = Math.abs(v).toFixed(d);
    const [i, f] = s.split('.');
    const withSep = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (v < 0 ? '−' : '') + withSep + (f ? '.' + f : '');
  }

  // Long form of a time, for sentences ("minute 13", "14:30", "day 9", "mid-March").
  function fmtTime(time, t) {
    const u = time.unit;
    const r = (x) => Math.round(x * 100) / 100;
    if (u === 'clock') {
      const mins = Math.round(t * 60);
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return `${h}:${String(m).padStart(2, '0')}`;
    }
    if (u === 'calendar') {
      const i = Math.min(11, Math.floor(t));
      const f = t - Math.floor(t);
      if (t >= 12) return 'the end of December';
      const part = f < 1 / 3 ? 'early' : f < 2 / 3 ? 'mid-' : 'late';
      return part === 'mid-' ? `mid-${MONTHS_LONG[i]}` : `${part} ${MONTHS_LONG[i]}`;
    }
    if (u === 'year') return String(Math.round(t + (time.base || 0)));
    return `${time.word || u} ${fmtNum(r(t), Math.abs(r(t) - Math.round(t)) < 1e-9 ? 0 : 1)}`;
  }

  // Short form for axis ticks.
  function fmtTick(time, t) {
    const u = time.unit;
    if (u === 'clock') return `${Math.floor(t)}:${String(Math.round((t % 1) * 60)).padStart(2, '0')}`;
    if (u === 'calendar') return t >= 12 ? '' : MONTHS[Math.floor(t)];
    if (u === 'year') return String(Math.round(t + (time.base || 0)));
    return fmtNum(t);
  }

  return {
    val,
    knots,
    inAt,
    outAt,
    netAt,
    stockAt,
    crossings,
    extremes,
    stockCurve,
    argmaxCurve,
    maxFlow,
    PEAK_TOL,
    snapTime,
    extremeScore,
    acceptIntervals,
    diagnoseExtreme,
    direction,
    SKETCH,
    turnWindows,
    lineTurns,
    gradeSketch,
    amountOptions,
    pickAmountChoices,
    mulberry32,
    generate,
    fairness,
    stockAxis,
    niceCeil,
    fmtNum,
    fmtTime,
    fmtTick,
    MONTHS,
  };
});
