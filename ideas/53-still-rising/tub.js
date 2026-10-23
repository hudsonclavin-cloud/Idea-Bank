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

  // A sketch is graded on the one thing the tool claims to tell you: which way
  // the level is moving at each moment. The drawing is resampled on a grid; at
  // every grid time where the flows clearly differ (|net| at least 6% of the
  // largest flow), the drawn slope over a short window must have the same sign
  // as the net flow. A drawn stretch flatter than FLAT (as a fraction of the
  // panel height per window) counts as "level", which is wrong there. The level
  // itself is not graded: a sketch is about shape, not scale.
  const SKETCH = { grid: 60, win: 2, dead: 0.06, flat: 0.012, pass: 0.8, cover: 0.8 };

  function resample(path, ts) {
    // path: [[t, s], ...] in any order; keep the last-drawn value per x by sorting.
    const p = path.slice().sort((a, b) => a[0] - b[0]);
    const lo = p[0][0];
    const hi = p[p.length - 1][0];
    return ts.map((t) => {
      if (t < lo || t > hi) return null;
      return val(p, t);
    });
  }

  function gradeSketch(item, path, panelTop) {
    const [t0, t1] = span(item);
    const G = SKETCH.grid;
    const ts = [];
    for (let i = 0; i <= G; i++) ts.push(t0 + ((t1 - t0) * i) / G);
    if (!path || path.length < 2) return { ok: false, coverage: 0, agree: 0, counted: 0, reason: 'empty' };
    const xs = path.map((p) => p[0]);
    const coverage = (Math.min(t1, Math.max(...xs)) - Math.max(t0, Math.min(...xs))) / (t1 - t0);
    if (coverage < SKETCH.cover) return { ok: false, coverage, agree: 0, counted: 0, reason: 'short' };
    const ys = resample(path, ts);
    const top = panelTop || Math.max(1, extremes(item).max.s);
    const dead = SKETCH.dead * maxFlow(item);
    let counted = 0;
    let agree = 0;
    const marks = [];
    for (let i = SKETCH.win; i <= G - SKETCH.win; i++) {
      const n = netAt(item, ts[i]);
      if (Math.abs(n) < dead) continue;
      const a = ys[i - SKETCH.win];
      const b = ys[i + SKETCH.win];
      if (a === null || b === null) continue;
      counted++;
      const d = (b - a) / top;
      const drawn = d > SKETCH.flat ? 1 : d < -SKETCH.flat ? -1 : 0;
      const good = drawn === Math.sign(n);
      if (good) agree++;
      marks.push({ t: ts[i], good });
    }
    const frac = counted ? agree / counted : 0;
    return { ok: counted > 0 && frac >= SKETCH.pass, coverage, agree: frac, counted, marks, reason: 'graded' };
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
    ];
    return { correct, inArea, outArea, net, cands };
  }

  // Keep the correct answer and the first three distractors that are clearly
  // different from it and from each other (and not negative), in a stable order.
  function pickAmountChoices(item, t) {
    const a = amountOptions(item, t);
    const gap = Math.max(2, 0.08 * Math.abs(a.correct));
    const chosen = [a.cands[0]];
    for (const c of a.cands.slice(1)) {
      if (chosen.length >= 4) break;
      if (c.v < 0) continue;
      if (chosen.every((d) => Math.abs(d.v - c.v) >= gap)) chosen.push(c);
    }
    return chosen;
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
      // a faithful drawing must pass easily: nowhere may the true level move so
      // little, where it counts, that a correct line reads as flat
      const g = gradeSketch(item, stockCurve(item, 120), top - floor);
      if (g.agree < 0.95) return 'true curve too flat to draw';
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
        const exact = stockAt(item, item.at);
        if (Math.abs(exact - Math.round(exact)) > 1e-9) continue;
        if (pickAmountChoices(item, item.at).length < 4) continue;
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
