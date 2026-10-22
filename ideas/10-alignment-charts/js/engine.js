/* Alignment Charts — geometry engine.
 *
 * Pure functions, no DOM: this module runs in the browser and under node:test.
 *
 * A chart is three scales. Each scale maps a value v to a "natural coordinate"
 * s = fwd(v), and s to a point pos(s) on the paper (chart space, y pointing up).
 * The chart is correct when, for every solution (u, v, w) of its formula, the
 * three points are collinear. Everything on screen is chart space pushed through
 * one 3x3 matrix H (an affine fit, optionally composed with a projective warp).
 * Projective maps send lines to lines, so a chart keeps working however it is
 * warped; the reading code below never consults the formula, only the geometry.
 */
(function (root, factory) {
  const cjs = typeof module === 'object' && module.exports;
  const load = (file, name) => (cjs ? require(file) : root[name]);
  const api = factory({  });
  if (cjs) module.exports = api;
  else root.ACEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';

  // ---------------------------------------------------------------- numbers

  /** Round away binary noise so 0.1 * 3 prints as 0.3 and dedupes cleanly. */
  const clean = (x) => +x.toPrecision(12);

  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

  // ---------------------------------------------------------------- 3x3 matrices (row-major)

  const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

  function matMul(A, B) {
    const C = new Array(9);
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        C[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
      }
    }
    return C;
  }

  function applyH(H, p) {
    const x = p[0];
    const y = p[1];
    const w = H[6] * x + H[7] * y + H[8];
    return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
  }

  /** Gaussian elimination with partial pivoting. Returns null if singular. */
  function solveLinear(M, rhs) {
    const n = rhs.length;
    const A = M.map((row, i) => [...row, rhs[i]]);
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      if (Math.abs(A[piv][c]) < 1e-12) return null;
      [A[c], A[piv]] = [A[piv], A[c]];
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = A[r][c] / A[c][c];
        if (f !== 0) for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k];
      }
    }
    return A.map((row, i) => row[n] / row[i]);
  }

  /** The projective map taking four source points to four destination points. */
  function homography(src, dst) {
    const A = [];
    const b = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = src[i];
      const [X, Y] = dst[i];
      A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]);
      b.push(X);
      A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]);
      b.push(Y);
    }
    const h = solveLinear(A, b);
    return h ? [...h, 1] : null;
  }

  /** True when the four points, in order, form a strictly convex quadrilateral. */
  function isConvexQuad(q) {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = q[i];
      const b = q[(i + 1) % 4];
      const c = q[(i + 2) % 4];
      const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (Math.abs(cr) < 1e-6) return false;
      const s = Math.sign(cr);
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
    return true;
  }

  /**
   * Affine map from a chart-space box (y up) into a screen rectangle (y down).
   * maxDistort limits how far the x and y scale factors may differ (Infinity = fill).
   */
  function fitTransform(bbox, rect, maxDistort = Infinity) {
    const bw = bbox.x1 - bbox.x0 || 1;
    const bh = bbox.y1 - bbox.y0 || 1;
    let sx = rect.w / bw;
    let sy = rect.h / bh;
    if (Number.isFinite(maxDistort)) {
      const s0 = Math.min(sx, sy);
      sx = Math.min(sx, s0 * maxDistort);
      sy = Math.min(sy, s0 * maxDistort);
    }
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    const mx = (bbox.x0 + bbox.x1) / 2;
    const my = (bbox.y0 + bbox.y1) / 2;
    return [sx, 0, cx - sx * mx, 0, -sy, cy + sy * my, 0, 0, 1];
  }

  // ---------------------------------------------------------------- scales

  /** The scale's extent in its natural coordinate, low to high. */
  function sRange(sc) {
    const a = sc.fwd(sc.min);
    const b = sc.fwd(sc.max);
    return a < b ? [a, b] : [b, a];
  }

  function chartBBox(chart, n = 200) {
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const sc of chart.scales) {
      const [s0, s1] = sRange(sc);
      for (let i = 0; i <= n; i++) {
        const [x, y] = sc.pos(s0 + ((s1 - s0) * i) / n);
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    return { x0, x1, y0, y1 };
  }

  const screenAtS = (sc, H, s) => applyH(H, sc.pos(s));
  const screenAtV = (sc, H, v) => applyH(H, sc.pos(sc.fwd(v)));

  function sampleScale(sc, H, n = 240) {
    const [s0, s1] = sRange(sc);
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const s = s0 + ((s1 - s0) * i) / n;
      const [x, y] = screenAtS(sc, H, s);
      pts.push({ s, x, y });
    }
    return pts;
  }

  /** Nearest point on a scale to screen point P. Returns { s, v, dist }. */
  function projectToScale(sc, H, samples, P) {
    let best = Infinity;
    let bi = 0;
    for (let i = 0; i < samples.length - 1; i++) {
      const a = samples[i];
      const b = samples[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const L2 = dx * dx + dy * dy;
      const t = L2 > 0 ? clamp(((P[0] - a.x) * dx + (P[1] - a.y) * dy) / L2, 0, 1) : 0;
      const qx = a.x + t * dx;
      const qy = a.y + t * dy;
      const d2 = (P[0] - qx) ** 2 + (P[1] - qy) ** 2;
      if (d2 < best) {
        best = d2;
        bi = i;
      }
    }
    const f = (s) => {
      const q = screenAtS(sc, H, s);
      return (q[0] - P[0]) ** 2 + (q[1] - P[1]) ** 2;
    };
    let lo = samples[Math.max(0, bi - 1)].s;
    let hi = samples[Math.min(samples.length - 1, bi + 2)].s;
    for (let k = 0; k < 60; k++) {
      const m1 = lo + (hi - lo) / 3;
      const m2 = hi - (hi - lo) / 3;
      if (f(m1) < f(m2)) hi = m2;
      else lo = m1;
    }
    const s = (lo + hi) / 2;
    return { s, v: clamp(sc.inv(s), sc.min, sc.max), dist: Math.sqrt(f(s)) };
  }

  /** Distance from screen point P to the polyline of a sampled scale. */
  function distanceToSamples(samples, P) {
    let best = Infinity;
    for (let i = 0; i < samples.length - 1; i++) {
      const a = samples[i];
      const b = samples[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const L2 = dx * dx + dy * dy;
      const t = L2 > 0 ? clamp(((P[0] - a.x) * dx + (P[1] - a.y) * dy) / L2, 0, 1) : 0;
      const d = Math.hypot(P[0] - (a.x + t * dx), P[1] - (a.y + t * dy));
      if (d < best) best = d;
    }
    return best;
  }

  /**
   * Every value at which the infinite line through screen points A and B crosses
   * the scale. This is the straightedge reading: pure geometry, no formula.
   * Exact tangency (a double root on a curved scale) is detected as a touch.
   */
  function lineCrossings(sc, H, A, B, n = 480) {
    const [s0, s1] = sRange(sc);
    const dx = B[0] - A[0];
    const dy = B[1] - A[1];
    const L = Math.hypot(dx, dy);
    if (!(L > 1e-9)) return [];
    const g = (s) => {
      const p = screenAtS(sc, H, s);
      return (dx * (p[1] - A[1]) - dy * (p[0] - A[0])) / L; // signed distance from the line
    };
    const S = [];
    const G = [];
    for (let i = 0; i <= n; i++) {
      const s = s0 + ((s1 - s0) * i) / n;
      S.push(s);
      G.push(g(s));
    }
    const p0 = screenAtS(sc, H, s0);
    const p1 = screenAtS(sc, H, s1);
    const touchTol = 1e-7 * Math.max(1, Math.hypot(p1[0] - p0[0], p1[1] - p0[1]));
    const roots = [];
    for (let i = 0; i <= n; i++) {
      if (G[i] === 0) {
        roots.push(S[i]);
        continue;
      }
      if (i > 0 && G[i - 1] !== 0 && Math.sign(G[i]) !== Math.sign(G[i - 1])) {
        let lo = S[i - 1];
        let hi = S[i];
        let glo = G[i - 1];
        for (let k = 0; k < 64; k++) {
          const mid = (lo + hi) / 2;
          const gm = g(mid);
          if (gm === 0) {
            lo = hi = mid;
            break;
          }
          if (Math.sign(gm) === Math.sign(glo)) {
            lo = mid;
            glo = gm;
          } else hi = mid;
        }
        roots.push((lo + hi) / 2);
        continue;
      }
      // A local minimum of |g| that does not change sign: the line may just touch.
      if (
        i > 0 &&
        i < n &&
        Math.abs(G[i]) <= Math.abs(G[i - 1]) &&
        Math.abs(G[i]) <= Math.abs(G[i + 1]) &&
        Math.sign(G[i - 1]) === Math.sign(G[i]) &&
        Math.sign(G[i + 1]) === Math.sign(G[i])
      ) {
        let lo = S[i - 1];
        let hi = S[i + 1];
        for (let k = 0; k < 80; k++) {
          const m1 = lo + (hi - lo) / 3;
          const m2 = hi - (hi - lo) / 3;
          if (Math.abs(g(m1)) < Math.abs(g(m2))) hi = m2;
          else lo = m1;
        }
        const sm = (lo + hi) / 2;
        if (Math.abs(g(sm)) <= touchTol) roots.push(sm);
      }
    }
    roots.sort((a, b) => a - b);
    const out = [];
    const ds = (s1 - s0) / n / 4;
    for (const r of roots) if (!out.length || r - out[out.length - 1] > ds) out.push(r);
    return out.map((s) => sc.inv(s));
  }

  // ---------------------------------------------------------------- ticks

  /** Steps 5, 1, 0.5, 0.1, ... times a power of ten, each dividing the last, all below maxStep. */
  function decimalLadder(maxStep) {
    const out = [];
    let p = Math.pow(10, Math.ceil(Math.log10(maxStep)));
    for (let i = 0; i < 16 && out.length < 8; i++) {
      const st = clean(i % 2 === 0 ? p * 0.5 : p * 0.1);
      if (i % 2 === 1) p /= 10;
      if (st < maxStep * (1 - 1e-9)) out.push(st);
    }
    return out;
  }

  /** Steps in seconds for clock-time scales: 5 h, 1 h, 30 min, ... 1 s. */
  function timeLadder(maxStep) {
    return [18000, 3600, 1800, 900, 300, 60, 30, 10, 5, 1].filter((s) => s < maxStep * (1 - 1e-9));
  }

  /**
   * Locally adaptive ticks. Anchors are level 0. Each gap between anchors is then
   * filled with multiples of successively finer "nice" steps; a tick is kept only
   * where its neighbours at that step are at least minGap screen pixels away, so a
   * logarithmic or logit scale gets fine ticks where it is stretched and coarse
   * ticks where it is crowded, and a warped chart re-thins itself automatically.
   *
   * set: { min, max, anchors, ladder(maxStep) }   toScreen: v -> [x, y]
   */
  function genTicks(set, toScreen, { minGap = 5, maxLevel = 3 } = {}) {
    const { min, max } = set;
    const ticks = new Map();
    const key = (v) => v.toPrecision(10); // 10 digits absorbs float noise such as 0.1 * 3
    const has = (v) => ticks.has(key(v));
    const add = (v, level, extra) => ticks.set(key(v), { v: clean(v), level, ...extra });
    const far = (p, b) => {
      const q = toScreen(b);
      return Math.hypot(p[0] - q[0], p[1] - q[1]) >= minGap;
    };
    const span = max - min;
    const eps = 1e-9 * Math.max(Math.abs(min), Math.abs(max), span);
    const anchors = [...new Set(set.anchors || [])]
      .filter((v) => v >= min - eps && v <= max + eps)
      .sort((a, b) => a - b);
    for (const v of anchors) add(v, 0);

    const bounds = [{ v: min, tick: has(min) }];
    for (const v of anchors) {
      if (Math.abs(v - bounds[bounds.length - 1].v) > eps) bounds.push({ v, tick: true });
    }
    if (Math.abs(max - bounds[bounds.length - 1].v) > eps) bounds.push({ v: max, tick: has(max) });

    const subdivide = (A, B, interval) => {
      const a = A.v;
      const b = B.v;
      if (!(b > a)) return;
      const tol = 1e-9 * Math.max(Math.abs(a), Math.abs(b), b - a);
      let level = 1;
      for (const step of set.ladder(b - a)) {
        if (level > maxLevel) break;
        const k0 = Math.ceil((a - tol) / step);
        const k1 = Math.floor((b + tol) / step);
        if (k1 - k0 > 800) break;
        let any = false;
        let added = 0;
        for (let k = k0; k <= k1; k++) {
          const m = k * step;
          if (m < a - tol || m > b + tol) continue;
          if ((A.tick && Math.abs(m - a) <= tol) || (B.tick && Math.abs(m - b) <= tol)) continue;
          if (has(m)) continue;
          any = true;
          const pm = toScreen(m);
          const lo = Math.max(a, m - step);
          const hi = Math.min(b, m + step);
          if (lo < m - tol && !far(pm, lo)) continue;
          if (hi > m + tol && !far(pm, hi)) continue;
          add(m, level, { interval, lo: A.tick ? A.v : null, hi: B.tick ? B.v : null });
          added++;
        }
        if (!any) continue; // no multiples of this step here; try finer without spending a level
        if (!added) break; // too crowded at this step, so finer steps are too
        level++;
      }
    };
    for (let i = 0; i < bounds.length - 1; i++) subdivide(bounds[i], bounds[i + 1], i);
    return [...ticks.values()].sort((p, q) => p.v - q.v);
  }

  // ---------------------------------------------------------------- labels

  const approxMeasure = (text, size) => String(text).length * size * 0.58 + 1;

  /**
   * How "round" a tick value is (lower = rounder), used to choose which labels
   * win when space is short: 0, then 1·10^k, then 5·10^k, then 2·10^k, then the
   * rest, fewer significant digits first. Returns a number in [0, 0.2).
   */
  function decimalRoundness(v) {
    if (v === 0) return 0;
    const m = Math.abs(clean(v)).toExponential(11).split('e')[0].replace('.', '').replace(/0+$/, '');
    const lead = { 1: 0, 5: 1, 2: 2 }[m[0]] ?? 3;
    return Math.min(0.199, ((m.length - 1) * 4 + lead + 1) * 0.004);
  }

  /** Roundness for clock times in seconds: whole hours, then half hours, ... */
  function clockRoundness(v) {
    const units = [3600, 1800, 900, 600, 300, 60, 30, 10, 5, 1];
    const i = units.findIndex((u) => Math.abs(v / u - Math.round(v / u)) < 1e-9);
    return (i < 0 ? units.length : i) * 0.015;
  }

  /** Uniform-grid spatial index of axis-aligned rectangles [x, y, w, h]. */
  class RectGrid {
    constructor(cell = 32) {
      this.cell = cell;
      this.map = new Map();
    }
    cellsOf(r) {
      const c = this.cell;
      const out = [];
      for (let i = Math.floor(r[0] / c); i <= Math.floor((r[0] + r[2]) / c); i++) {
        for (let j = Math.floor(r[1] / c); j <= Math.floor((r[1] + r[3]) / c); j++) out.push(i + ',' + j);
      }
      return out;
    }
    insert(r) {
      for (const k of this.cellsOf(r)) {
        if (!this.map.has(k)) this.map.set(k, []);
        this.map.get(k).push(r);
      }
    }
    hits(r) {
      for (const k of this.cellsOf(r)) {
        const list = this.map.get(k);
        if (!list) continue;
        for (const o of list) {
          if (r[0] < o[0] + o[2] && o[0] < r[0] + r[2] && r[1] < o[1] + o[3] && o[1] < r[1] + r[3]) return true;
        }
      }
      return false;
    }
  }

  /** Points every `step` px along a polyline, as tiny obstacle rectangles. */
  function polylineObstacles(pts, step = 3, r = 0.8) {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(1, Math.ceil(L / step));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        out.push([a[0] + (b[0] - a[0]) * t - r, a[1] + (b[1] - a[1]) * t - r, 2 * r, 2 * r]);
      }
    }
    const z = pts[pts.length - 1];
    if (z) out.push([z[0] - r, z[1] - r, 2 * r, 2 * r]);
    return out;
  }

  // ---------------------------------------------------------------- full layout

  /**
   * Lay out a chart on screen: sampled scale curves, ticks on the label side of
   * each scale (alternate-unit ticks and named marks on the other side), titles,
   * and collision-free tick labels chosen by priority (coarse ticks first).
   */
  function layoutChart(chart, H, opts = {}) {
    const o = {
      width: 600,
      height: 800,
      font: 12,
      titleFont: 13,
      minGap: 5,
      tickLen: [11, 8, 5.5, 3.5],
      maxLevel: 3,
      labelLevel: 2,
      labelPad: 2,
      measure: approxMeasure,
      ...opts,
    };
    const bb = chartBBox(chart);
    const eps = 1e-3 * Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0);
    const grid = new RectGrid(32);
    const cands = [];
    const scales = [];
    const titles = [];
    const forced = [];

    chart.scales.forEach((sc, index) => {
      const samples = sampleScale(sc, H);
      const [s0, s1] = sRange(sc);
      const geo = { key: sc.key, index, samples, ticks: [] };
      const labelDir = sc.labelDir || [1, 0];

      const frame = (s) => {
        const P = screenAtS(sc, H, s);
        const h = (s1 - s0) * 1e-4;
        const A = screenAtS(sc, H, Math.max(s0, s - h));
        const B = screenAtS(sc, H, Math.min(s1, s + h));
        let tx = B[0] - A[0];
        let ty = B[1] - A[1];
        const tl = Math.hypot(tx, ty) || 1;
        tx /= tl;
        ty /= tl;
        let nx = -ty;
        let ny = tx;
        const c = sc.pos(s);
        const R = applyH(H, [c[0] + labelDir[0] * eps, c[1] + labelDir[1] * eps]);
        if ((R[0] - P[0]) * nx + (R[1] - P[1]) * ny < 0) {
          nx = -nx;
          ny = -ny;
        }
        return { P, tx, ty, nx, ny };
      };

      for (const r of polylineObstacles(samples.map((p) => [p.x, p.y]))) grid.insert(r);

      const pushLabel = (f, side, text, fs, pri, kind, extraOff = 0, meta = {}) => {
        const nx = f.nx * side;
        const ny = f.ny * side;
        const w = o.measure(text, fs, kind);
        const h = fs * 1.05;
        const off = o.tickLen[0] + 3 + extraOff + (Math.abs(nx) * w) / 2 + (Math.abs(ny) * h) / 2;
        cands.push({ x: f.P[0] + nx * off, y: f.P[1] + ny * off, w, h, text, fs, pri, kind, scale: index, ...meta });
      };

      const tickSet = (set, side, kind) => {
        const toScreen = (v) => screenAtS(sc, H, set.map(v));
        const ts = genTicks(set, toScreen, o);
        for (const t of ts) {
          const f = frame(set.map(t.v));
          const len = o.tickLen[Math.min(t.level, o.tickLen.length - 1)];
          const x2 = f.P[0] + f.nx * side * len;
          const y2 = f.P[1] + f.ny * side * len;
          geo.ticks.push({ x1: f.P[0], y1: f.P[1], x2, y2, level: t.level, kind });
          for (const r of polylineObstacles([f.P, [x2, y2]], 3, 0.6)) grid.insert(r);
          if (t.level <= o.labelLevel) {
            const fs = kind === 'alt' ? o.font - 1 : o.font;
            const round = (set.roundness || decimalRoundness)(t.v);
            const base = `${index}|${kind}`;
            const vk = (v) => `${base}|v${clean(v)}`;
            const meta =
              t.level === 0
                ? { anchorKey: vk(t.v) }
                : {
                    gbase: `${base}|${t.interval}`,
                    group: `${base}|${t.interval}|${t.level}`,
                    level: t.level,
                    needs: [t.lo, t.hi].filter((v) => v !== null && v !== undefined).map(vk),
                  };
            pushLabel(f, side, set.fmt(t.v), fs, t.level + (kind === 'alt' ? 0.3 : 0) + round, kind, 0, meta);
          }
        }
      };

      tickSet(
        {
          min: sc.min,
          max: sc.max,
          anchors: sc.ticks.anchors,
          ladder: sc.ticks.ladder,
          roundness: sc.ticks.roundness,
          map: sc.fwd,
          fmt: sc.fmt,
        },
        1,
        'main',
      );
      if (sc.alt) {
        const a = sc.alt;
        tickSet(
          {
            min: a.min,
            max: a.max,
            anchors: a.anchors,
            ladder: a.ladder,
            roundness: a.roundness,
            map: (x) => sc.fwd(a.toPrimary(x)),
            fmt: a.fmt,
          },
          -1,
          'alt',
        );
      }
      if (sc.marks) {
        for (const m of sc.marks) {
          if (m.v < sc.min || m.v > sc.max) continue;
          const f = frame(sc.fwd(m.v));
          const len = o.tickLen[0] + 2;
          const x2 = f.P[0] - f.nx * len;
          const y2 = f.P[1] - f.ny * len;
          geo.ticks.push({ x1: f.P[0], y1: f.P[1], x2, y2, level: 0, kind: 'mark' });
          for (const r of polylineObstacles([f.P, [x2, y2]], 3, 0.6)) grid.insert(r);
          pushLabel(f, -1, m.label, o.font - 1, 0.5, 'mark', 2);
        }
      }

      // Title beyond one end of the scale, pushed outward along the tangent.
      // titleEnd names a value end ('min' | 'max'); by default, whichever end is higher on screen.
      let end = sc.titleEnd;
      if (end !== 'min' && end !== 'max') {
        end = screenAtV(sc, H, sc.max)[1] <= screenAtV(sc, H, sc.min)[1] ? 'max' : 'min';
      }
      const sEnd = end === 'max' ? sc.fwd(sc.max) : sc.fwd(sc.min);
      const sIn = sEnd === s1 ? s1 - (s1 - s0) * 0.002 : s0 + (s1 - s0) * 0.002;
      const PE = screenAtS(sc, H, sEnd);
      const PI = screenAtS(sc, H, sIn);
      let ux = PE[0] - PI[0];
      let uy = PE[1] - PI[1];
      const ul = Math.hypot(ux, uy) || 1;
      ux /= ul;
      uy /= ul;
      // Column captions (say, degrees C on one side and F on the other), just past the end.
      const caps = [];
      if (sc.caption) caps.push([sc.caption, 1]);
      if (sc.alt && sc.alt.caption) caps.push([sc.alt.caption, -1]);
      let capReach = 0;
      if (caps.length) {
        const fE = frame(sEnd);
        const fs = o.font - 1;
        const hC = fs * 1.05;
        for (const [text, side] of caps) {
          const w = o.measure(text, fs, 'unit');
          const nx = fE.nx * side;
          const ny = fE.ny * side;
          const along = (o.font * 1.05) / 2 + 5 + (Math.abs(ux) * w) / 2 + (Math.abs(uy) * hC) / 2;
          const sideOff = o.tickLen[0] + 3 + (Math.abs(nx) * w) / 2 + (Math.abs(ny) * hC) / 2;
          const c = { x: PE[0] + ux * along + nx * sideOff, y: PE[1] + uy * along + ny * sideOff, w, h: hC, text, fs, kind: 'cap', scale: index };
          c.x = clamp(c.x, w / 2 + 2, o.width - w / 2 - 2);
          forced.push(c);
          grid.insert([c.x - w / 2 - 1, c.y - hC / 2 - 1, w + 2, hC + 2]);
          capReach = Math.max(capReach, along + (Math.abs(ux) * w) / 2 + (Math.abs(uy) * hC) / 2);
        }
      }

      const lines = [sc.name, sc.unit].filter(Boolean);
      const tw = Math.max(o.measure(sc.name, o.titleFont, 'title'), sc.unit ? o.measure(sc.unit, o.font - 1, 'unit') : 0);
      const th = o.titleFont * 1.2 + (sc.unit ? (o.font - 1) * 1.25 : 0);
      const gap = Math.max(13, capReach + 6);
      let cx = PE[0] + ux * (gap + (Math.abs(ux) * tw) / 2 + (Math.abs(uy) * th) / 2);
      let cy = PE[1] + uy * (gap + (Math.abs(ux) * tw) / 2 + (Math.abs(uy) * th) / 2);
      cx = clamp(cx, tw / 2 + 2, o.width - tw / 2 - 2);
      cy = clamp(cy, th / 2 + 2, o.height - th / 2 - 2);
      titles.push({ x: cx, y: cy, w: tw, h: th, lines, scale: index });
      grid.insert([cx - tw / 2 - 1, cy - th / 2 - 1, tw + 2, th + 2]);

      scales.push(geo);
    });

    // Label placement, most important first. Anchor labels are placed one by one,
    // roundest first. Finer labels go in as a whole group per interval (all of an
    // interval's 5s, or all of its units) and only beneath labels one level up,
    // so a scale reads 10, 15, 20 or 10, 11, 12 but never 10, 13, 18.
    cands.sort((a, b) => a.pri - b.pri);
    const labels = [...forced];
    const pad = o.labelPad;
    const rectOf = (c) => [c.x - c.w / 2 - pad, c.y - c.h / 2 - pad, c.w + 2 * pad, c.h + 2 * pad];
    const inBounds = (r) => r[0] >= 1 && r[1] >= 1 && r[0] + r[2] <= o.width - 1 && r[1] + r[3] <= o.height - 1;
    const overlap = (r, q) => r[0] < q[0] + q[2] && q[0] < r[0] + r[2] && r[1] < q[1] + q[3] && q[1] < r[1] + r[3];
    const groups = new Map();
    for (const c of cands) {
      if (!c.group) continue;
      if (!groups.has(c.group)) groups.set(c.group, []);
      groups.get(c.group).push(c);
    }
    const placedAnchors = new Set();
    const placedGroups = new Set();
    const tried = new Set();
    for (const c of cands) {
      if (!c.group) {
        const r = rectOf(c);
        if (!inBounds(r) || grid.hits(r)) continue;
        grid.insert(r);
        labels.push(c);
        if (c.anchorKey) placedAnchors.add(c.anchorKey);
        continue;
      }
      if (tried.has(c.group)) continue;
      tried.add(c.group);
      // Subdivide only beside at least one labelled anchor.
      if (c.needs.length && !c.needs.some((k) => placedAnchors.has(k))) continue;
      let eligible = true;
      for (let L = 1; L < c.level; L++) {
        const gk = `${c.gbase}|${L}`;
        if (groups.has(gk) && !placedGroups.has(gk)) eligible = false;
      }
      if (!eligible) continue;
      const members = groups.get(c.group);
      const rects = members.map(rectOf);
      let ok = rects.every((r) => inBounds(r) && !grid.hits(r));
      for (let i = 0; ok && i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          if (overlap(rects[i], rects[j])) {
            ok = false;
            break;
          }
        }
      }
      if (!ok) continue;
      rects.forEach((r) => grid.insert(r));
      labels.push(...members);
      placedGroups.add(c.group);
    }
    // How far the most important labels would reach if nothing were clipped:
    // the page uses this to widen its margins until they fit.
    const extent = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
    for (const c of cands) {
      if (c.pri >= 1) continue;
      extent.x0 = Math.min(extent.x0, c.x - c.w / 2 - pad);
      extent.x1 = Math.max(extent.x1, c.x + c.w / 2 + pad);
      extent.y0 = Math.min(extent.y0, c.y - c.h / 2 - pad);
      extent.y1 = Math.max(extent.y1, c.y + c.h / 2 + pad);
    }
    return { scales, labels, titles, extent, width: o.width, height: o.height };
  }

  return { clean, clamp, IDENTITY, matMul, applyH, solveLinear, homography, isConvexQuad, fitTransform, sRange, chartBBox, screenAtS, screenAtV, sampleScale, projectToScale, distanceToSamples, lineCrossings, decimalLadder, timeLadder, genTicks, approxMeasure, decimalRoundness, clockRoundness, layoutChart };
});
