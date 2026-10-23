/* By Eye: how a reader's setting is taken (the method), separate from the drawing so that the
 * tests can run it against simulated observers.
 *
 * Each test is a method of adjustment: the reader changes one setting until two things look
 * equal. People tend to stop short of where things look right, so where a try starts pulls on
 * where it stops. The design below makes that pull drop out of the result:
 *
 *   tries 1 and 2  start far off on either side of the RULER's value (further off than any
 *                  measured typeface goes), in random order;
 *   tries 3 and 4  start nearer, on either side of the mean of tries 1 and 2, in random order.
 *
 * The result is not the mean of the stops. It is the fixed point of the straight line fitted (least
 * squares) to stop = a + b * start + c * side, where side is +1 for a try that started above and
 * -1 for one that started below: the setting from which the reader would not have moved, averaged
 * over both directions, a / (1 - b). b is the share of the starting error the reader left in
 * place. For a reader who stops a fixed fraction short (b > 0), who stops at the edge of a band
 * in which they cannot tell the difference (c > 0), who overshoots by a fixed fraction of less
 * than half (b < 0), or any mix of these, this is exactly their setting when there is no noise,
 * provided no try is stopped by an end of the control's range and, for a reader with a band, every
 * try starts on the side of their setting that was planned for it (side is the planned side, set
 * before the try; a near try can start on the other side when the first two stops' mean is far
 * from the reader's setting, and then the band is not fully allowed for). The tests check all of
 * this with simulated observers. A reader who leaves more than half the starting error in place
 * (b > 0.5) gets no result: their stops say more about the starts than about the letters.
 *
 * The control cannot go past the ends of its window, so a try that ends there may have been
 * stopped by the window rather than by the reader's eye. Where that try would have stopped is
 * unknown, and fitting the line through the end instead gives a wrong setting with nothing to say
 * so (in the thickness test, for an eye near the strongest typeface's correction that overshoots
 * by a sixth or more). So a set of tries with a stop at either end gets no result either.
 *
 * There is no slider track: the control is a strip with no visible ends and no middle, so nothing
 * on screen shows where the ruler's value, or any other value, lies.
 *
 * Classic script: in a browser it defines window.ByEyeMethod; under Node it is a CommonJS module.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ByEyeMethod = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // For each setting: the ruler's value; the window the control can reach (the same as the
  // alphabet's LIMITS); how far from the ruler the first two tries start (far) and how far from
  // the first answer the last two start (near); one press of - or +; and the change per pixel of
  // drag. Every band is symmetric: the same distances above and below.
  const PLAN = Object.freeze({
    round: Object.freeze({ ruler: 0, window: [-0.07, 0.07], far: [0.04, 0.055], near: [0.015, 0.022], nudge: 0.0007 }),
    point: Object.freeze({ ruler: 0, window: [-0.1, 0.1], far: [0.06, 0.08], near: [0.022, 0.03], nudge: 0.0007 }),
    bar: Object.freeze({ ruler: 1, window: [0.6, 1.4], far: [0.31, 0.37], near: [0.11, 0.15], nudge: 0.005 }),
    middle: Object.freeze({ ruler: 0.5, window: [0.41, 0.59], far: [0.055, 0.075], near: [0.02, 0.028], nudge: 0.001 }),
    halves: Object.freeze({ ruler: 0.5, window: [0.42, 0.58], far: [0.05, 0.065], near: [0.018, 0.025], nudge: 0.001 }),
  });
  const TRIES = 4;
  const MAX_LEFT = 0.5; // largest share of the starting error that may be left in place
  // A stop this close to an end of the window counts as at the end (the page keeps stops to five
  // decimals, and the control holds a value at an end exactly).
  const AT_END = 1e-6;
  // Index of the first try that stopped at an end of the window, or -1.
  const atEnd = (key, tries) => {
    const [w0, w1] = PLAN[key].window;
    return tries.findIndex((q) => q.stop <= w0 + AT_END || q.stop >= w1 - AT_END);
  };
  // A drag across about 240 px covers the farthest start.
  const perPx = (key) => PLAN[key].far[1] / 240;

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // Random order of sides for one pair: [+1, -1] or [-1, +1].
  const pairOrder = (rand) => (rand() < 0.5 ? [1, -1] : [-1, 1]);

  // Where try number n (0-based) starts, given the tries already made and the planned sides.
  // tries: [{ start, stop, side }]; sides: four entries of +1 / -1, one pair after the other.
  function startFor(key, n, tries, sides, rand) {
    const p = PLAN[key];
    const side = sides[n];
    let centre;
    let band;
    if (n < 2) {
      centre = p.ruler;
      band = p.far;
    } else {
      centre = (tries[0].stop + tries[1].stop) / 2;
      // Keep the near starts inside the window.
      centre = clamp(centre, p.window[0] + p.near[1], p.window[1] - p.near[1]);
      band = p.near;
    }
    const d = band[0] + rand() * (band[1] - band[0]);
    return { start: clamp(centre + side * d, p.window[0], p.window[1]), side, centre };
  }

  // Least squares for y = X beta (a few rows, three columns).
  function lsq(X, y) {
    const k = X[0].length;
    const A = Array.from({ length: k }, () => new Array(k).fill(0));
    const r = new Array(k).fill(0);
    for (let i = 0; i < X.length; i++) {
      for (let j = 0; j < k; j++) {
        r[j] += X[i][j] * y[i];
        for (let m = 0; m < k; m++) A[j][m] += X[i][j] * X[i][m];
      }
    }
    for (let i = 0; i < k; i++) {
      let piv = i;
      for (let j = i + 1; j < k; j++) if (Math.abs(A[j][i]) > Math.abs(A[piv][i])) piv = j;
      [A[i], A[piv]] = [A[piv], A[i]];
      [r[i], r[piv]] = [r[piv], r[i]];
      if (Math.abs(A[i][i]) < 1e-14) return null;
      for (let j = i + 1; j < k; j++) {
        const f = A[j][i] / A[i][i];
        for (let m = i; m < k; m++) A[j][m] -= f * A[i][m];
        r[j] -= f * r[i];
      }
    }
    const x = new Array(k).fill(0);
    for (let i = k - 1; i >= 0; i--) {
      let s = r[i];
      for (let m = i + 1; m < k; m++) s -= A[i][m] * x[m];
      x[i] = s / A[i][i];
    }
    return x;
  }

  // The reader's setting from four tries. Returns { ok, value, left, offset, why }.
  //   value   the fixed point a / (1 - b), when ok
  //   left    b: the share of the starting error left in place (0 for a reader who goes all the way)
  //   offset  c: half the gap between stops approached from above and from below
  //   why     when not ok: 'unmoved' (a try was committed without moving), 'end' (a try stopped
  //           at an end of the window, so where it would have stopped is unknown; `at` is its
  //           index), 'anchored' (b > 0.5), 'overshot' (b < -0.5), 'outside' (the fixed point
  //           lies outside the window), 'singular' (the starts do not pin the line down)
  function estimate(key, tries) {
    const p = PLAN[key];
    if (!tries || tries.length < TRIES) return { ok: false, why: 'incomplete' };
    const t = tries.slice(0, TRIES);
    if (t.some((q) => q.moved === false)) return { ok: false, why: 'unmoved' };
    const end = atEnd(key, t);
    if (end >= 0) return { ok: false, why: 'end', at: end };
    const fit = lsq(t.map((q) => [1, q.start, q.side]), t.map((q) => q.stop));
    if (!fit) return { ok: false, why: 'singular' };
    const [a, b, c] = fit;
    const base = { left: b, offset: c };
    if (b > MAX_LEFT) return { ok: false, why: 'anchored', ...base };
    if (b < -MAX_LEFT) return { ok: false, why: 'overshot', ...base };
    const value = a / (1 - b);
    if (!(value >= p.window[0] && value <= p.window[1])) return { ok: false, why: 'outside', ...base };
    return { ok: true, value, ...base };
  }

  return { PLAN, TRIES, MAX_LEFT, AT_END, perPx, pairOrder, startFor, atEnd, estimate, lsq };
});
