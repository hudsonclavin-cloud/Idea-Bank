/* Doubletake — geometry core.
 *
 * Pure functions, no DOM. Runs in the browser (global `Doubletake`, works from file://)
 * and under Node (CommonJS) so the page and the tests share one mesh generator.
 *
 * The object is a pot whose rim is a space curve chosen so that, seen from a fixed
 * elevation φ, the rim projects to one planar shape for the eye and to a different
 * shape in a vertical mirror behind the pot. Kokichi Sugihara's "ambiguous cylinder"
 * construction, done with orthographic projection:
 *
 *   eye    sees image height  h1 = z·cosφ − y·sinφ      (viewer on the +y side, above)
 *   mirror shows image height  h2 = z·cosφ + y·sinφ      (mirror plane y = const, behind)
 *
 * Both images share the horizontal coordinate x. Give the eye shape A and the mirror
 * shape B as x-monotone outlines (a top and a bottom function of x over [−1, 1] that
 * meet at the ends), and each rim point is fixed by two linear equations:
 *
 *   near branch (toward the viewer):  h1 = A.bottom(x), h2 = B.top(x)
 *   far branch  (away from viewer):   h1 = A.top(x),    h2 = B.bottom(x)
 *
 *   z = (h1 + h2) / (2cosφ),   y = (h2 − h1) / (2sinφ)
 *
 * Since y_near − y_far = (heightA(x) + heightB(x)) / (2sinφ) ≥ 0, the plan outline is
 * x-monotone: a lower chain (far branch) and an upper chain (near branch) over the same
 * x range, meeting at the two pinch points. The pot is that outline extruded upward as a
 * vertical wall, cut off at the top by the rim, standing on a flat floor:
 *
 *   - Inner wall = the outline eroded by the wall thickness. For an x-monotone region the
 *     erosion is exact and simple: a disk of radius d fits under the upper chain U iff
 *     its centre is below U_d(x) = min over x' of U(x') − √(d² − (x'−x)²), and above the
 *     lower chain iff above L_d(x) (the mirror image). The cavity is L_d ≤ y ≤ U_d.
 *   - Base chamfer = the outline eroded by 0.4 mm at z = 0, joined to the outline at
 *     z = 0.5 mm: the only downward-facing surface that is not on the bed.
 *   - Bands between two rings (rim top, chamfer) are triangulated by dynamic programming
 *     that accepts only triangles that are counter-clockwise in plan. Every such
 *     triangle chain covers each point of the annulus exactly once (its boundary is the
 *     two rings, so the coverage count is their winding number), so the band cannot
 *     fold or overlap.
 *
 * Every vertical line through the footprint therefore meets the solid in one interval
 * from the bed (or the chamfer) up to the floor or the rim: no overhang beyond the
 * chamfer and no enclosed void. Units are mm.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Doubletake = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const { sqrt, abs, sin, cos, atan2, asin, PI, max, min, hypot, ceil } = Math;
  const clamp = (v, lo, hi) => min(hi, max(lo, v));
  const r01 = (v) => sqrt(max(0, 1 - v * v));
  const DEG = 180 / PI;

  // ------------------------------------------------------------------ shapes
  // Each shape is normalised to half-width 1 and vertically centred on its bounding
  // box. top(x) ≥ bottom(x) on (−1, 1); top(±1) = bottom(±1). `knots` are x values of
  // corners that must land exactly on a rim vertex so the projection is exact there.
  const H3 = sqrt(3);
  const PENT = (() => {
    // Regular pentagon, apex up, scaled to half-width 1 and centred vertically.
    const s = 1 / cos(18 * PI / 180); // 1 / 0.951
    const apex = 1 * s, shoulder = sin(18 * PI / 180) * s, base = -sin(54 * PI / 180) * s;
    const bx = cos(54 * PI / 180) * s; // base corners at ±bx
    const mid = (apex + base) / 2;
    return { apex: apex - mid, shoulder: shoulder - mid, base: base - mid, bx };
  })();
  const STAR_C = 0.32;   // inner-corner radius of the four-point star
  const HEART_Y0 = 0.35; // centre height of the two lobes
  const HEART_K = 1.2;   // slope of the lower sides
  // Crescent: the lower half of the unit circle minus a bigger circle centred higher up.
  // MOON_D sets how fat it is (0.59 thick in the middle); a thinner crescent paired with
  // itself makes a pot too narrow to stand up (see LIMITS).
  const MOON_D = 1.0, MOON_R = sqrt(1 + MOON_D * MOON_D);

  const SHAPES = [
    { id: 'circle', name: 'Circle', knots: [],
      top: (x) => r01(x), bottom: (x) => -r01(x) },
    { id: 'square', name: 'Square', knots: [],
      // superellipse |x|^6 + |y|^6 = 1: reads as a rounded square, still x-monotone
      top: (x) => Math.pow(max(0, 1 - Math.pow(abs(x), 6)), 1 / 6),
      bottom: (x) => -Math.pow(max(0, 1 - Math.pow(abs(x), 6)), 1 / 6) },
    { id: 'diamond', name: 'Diamond', knots: [0],
      top: (x) => 1 - abs(x), bottom: (x) => abs(x) - 1 },
    { id: 'hexagon', name: 'Hexagon', knots: [0.5],
      top: (x) => (abs(x) <= 0.5 ? H3 / 2 : H3 * (1 - abs(x))),
      bottom: (x) => -(abs(x) <= 0.5 ? H3 / 2 : H3 * (1 - abs(x))) },
    { id: 'triangle', name: 'Triangle', knots: [0],
      top: (x) => -H3 / 2 + H3 * (1 - abs(x)), bottom: () => -H3 / 2 },
    { id: 'pentagon', name: 'Pentagon', knots: [0, PENT.bx],
      top: (x) => PENT.shoulder + (PENT.apex - PENT.shoulder) * (1 - abs(x)),
      bottom: (x) => (abs(x) <= PENT.bx ? PENT.base
        : PENT.shoulder + (PENT.base - PENT.shoulder) * (1 - abs(x)) / (1 - PENT.bx)) },
    { id: 'star', name: 'Star', knots: [0, STAR_C],
      top: (x) => (abs(x) >= STAR_C ? STAR_C * (1 - abs(x)) / (1 - STAR_C)
        : STAR_C + (1 - STAR_C) * (1 - abs(x) / STAR_C)),
      bottom: (x) => -(abs(x) >= STAR_C ? STAR_C * (1 - abs(x)) / (1 - STAR_C)
        : STAR_C + (1 - STAR_C) * (1 - abs(x) / STAR_C)) },
    { id: 'heart', name: 'Heart', knots: [0],
      top: (x) => HEART_Y0 + sqrt(max(0, 0.25 - (abs(x) - 0.5) ** 2)),
      bottom: (x) => HEART_Y0 - HEART_K * (1 - abs(x)) },
    { id: 'moon', name: 'Crescent', knots: [],
      top: (x) => MOON_D - sqrt(max(0, MOON_R * MOON_R - x * x)) + 0.5,
      bottom: (x) => -r01(x) + 0.5 },
    { id: 'oval', name: 'Oval', knots: [],
      top: (x) => 0.72 * r01(x), bottom: (x) => -0.72 * r01(x) },
  ];
  const shapeById = (id) => SHAPES.find((s) => s.id === id) || null;

  // ---------------------------------------------------------------- parameters
  const PARAMS = {
    eye: { def: 'square', kind: 'shape', label: 'To the eye' },
    mirror: { def: 'circle', kind: 'shape', label: 'In the mirror' },
    angle: { def: 45, min: 30, max: 60, step: 1, unit: '°', label: 'Viewing angle' },
    width: { def: 60, min: 30, max: 80, step: 1, unit: 'mm', label: 'Width' },
    height: { def: 70, min: 15, max: 100, step: 1, unit: 'mm', label: 'Height at the lowest rim point' },
    wall: { def: 1.6, min: 1.2, max: 3.2, step: 0.4, unit: 'mm', label: 'Wall' },
    floor: { def: 2, min: 1.2, max: 4, step: 0.2, unit: 'mm', label: 'Floor' },
    detail: { def: 96, min: 48, max: 192, step: 8, unit: '', label: 'Detail (rim vertices per side)' },
  };
  // Base edge chamfer: 0.4 mm in over 0.5 mm up, atan(0.4/0.5) = 38.7° from vertical
  // along straight runs. The triangulation refuses any chamfer facet steeper than maxDeg.
  const CHAMFER = { inset: 0.4, rise: 0.5, maxDeg: 42 };
  // Size rules: the whole pot fits a 180 mm cube (the smallest common consumer build
  // volume), and is never more than 4× taller than the narrowest width of its outline
  // (the usual tip-over / layer-shear rule of thumb for FDM). The narrowest width is the
  // minimum caliper width, measured in every direction, not the smaller side of the
  // bounding box: a diamond-shaped footprint 30 mm by 30 mm is only 21.2 mm across.
  const LIMITS = { zMax: 180, slender: 4 };
  // Inner rings are computed at the target offset plus this margin, so the chords
  // between computed points cannot cut into the wall; the result is then measured.
  // A chord may bow toward the outer wall by at most half the margin, or away from it
  // (making the wall locally thicker) by at most SLACK.
  const MARGIN = 0.004, MAX_CHORD = 1.2, SLACK = 0.03, GRID = 1.0, TIP_AREA2 = 4e-3, MIN_EDGE = 0.02;

  function defaults() {
    const p = {};
    for (const k in PARAMS) p[k] = PARAMS[k].def;
    return p;
  }
  function normalize(p) {
    const q = { ...defaults(), ...p };
    for (const k in PARAMS) {
      const spec = PARAMS[k];
      if (spec.kind === 'shape') { if (!shapeById(q[k])) q[k] = spec.def; continue; }
      let v = Number(q[k]);
      if (!Number.isFinite(v)) v = spec.def;
      q[k] = clamp(v, spec.min, spec.max);
    }
    q.detail = Math.round(q.detail);
    const out = {};
    for (const k in PARAMS) out[k] = q[k];
    return out;
  }

  // ------------------------------------------------------------------- rim
  /**
   * The rim as a closed ring of stations, CCW seen from above: far branch left→right
   * (the lower chain in plan), then the near branch right→left (the upper chain).
   * Also applies the size rules: the requested height is lowered if the pot would be
   * taller than LIMITS allow.
   */
  function rim(params) {
    const p = normalize(params);
    const A = shapeById(p.eye), B = shapeById(p.mirror);
    const R = p.width / 2, phi = p.angle * PI / 180, s = sin(phi), c = cos(phi);

    const far = (u) => {
      const h1 = A.top(u), h2 = B.bottom(u);
      return { u, x: u * R, y: (h2 - h1) * R / (2 * s), z: (h1 + h2) * R / (2 * c), eye: h1 * R, mirror: h2 * R, branch: 'far' };
    };
    const near = (u) => {
      const h1 = A.bottom(u), h2 = B.top(u);
      return { u, x: u * R, y: (h2 - h1) * R / (2 * s), z: (h1 + h2) * R / (2 * c), eye: h1 * R, mirror: h2 * R, branch: 'near' };
    };
    const knots = [...new Set([...A.knots, ...B.knots].flatMap((k) => [-k, k]))].filter((k) => abs(k) < 1);

    const farPts = sampleBranch(far, p.detail, knots);
    const nearPts = sampleBranch(near, p.detail, knots);
    // Both pinch points come from the far branch; the near branch agrees there by construction.
    farPts[0].branch = farPts[farPts.length - 1].branch = 'pinch';
    const ring = [...farPts, ...nearPts.slice(1, -1).reverse()];
    const lowerN = farPts.length; // ring[0 .. lowerN-1] is the lower chain

    let zMin = Infinity, zMax = -Infinity;
    for (const q of ring) { zMin = min(zMin, q.z); zMax = max(zMax, q.z); }
    const variation = zMax - zMin, narrowest = minWidth(ring);
    const heightCap = min(PARAMS.height.max, LIMITS.zMax - variation, LIMITS.slender * narrowest - variation);
    const height = max(PARAMS.height.min, min(p.height, heightCap));
    const zShift = height - zMin;
    for (const q of ring) q.z += zShift;
    if (signedArea(ring) <= 0) throw new Error('rim is not counter-clockwise');
    return {
      params: { ...p, height }, requestedHeight: p.height, capped: height < p.height - 1e-9,
      heightCap, sizeOK: heightCap >= PARAMS.height.min,
      R, phi, ring, lowerN, zShift, rimLow: height, rimHigh: zMax + zShift, variation, narrowest, A, B,
    };
  }

  /**
   * Minimum caliper width of a set of plan points: the narrowest strip between two
   * parallel lines that holds them all, over every direction. One side of the narrowest
   * strip always lies along an edge of the convex hull, so each hull edge is tried with
   * the hull vertex farthest from it.
   */
  function minWidth(pts) {
    const h = convexHull(pts);
    if (h.length < 3) return 0;
    let best = Infinity;
    for (let i = 0; i < h.length; i++) {
      const a = h[i], b = h[(i + 1) % h.length];
      const dx = b.x - a.x, dy = b.y - a.y, l = hypot(dx, dy);
      let far = 0;
      for (const q of h) far = max(far, abs((q.x - a.x) * dy - (q.y - a.y) * dx) / l);
      best = min(best, far);
    }
    return best;
  }
  /** Convex hull (Andrew's monotone chain), CCW, without collinear points. */
  function convexHull(pts) {
    const P = pts.map((q) => ({ x: q.x, y: q.y })).sort((a, b) => a.x - b.x || a.y - b.y);
    const cr = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lo = [], up = [];
    for (const q of P) {
      while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
      lo.push(q);
    }
    for (let i = P.length - 1; i >= 0; i--) {
      const q = P[i];
      while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
      up.push(q);
    }
    lo.pop(); up.pop();
    return lo.concat(up);
  }

  /** Sample one branch at equal 3-D arc length, keeping corners exact. */
  function sampleBranch(f, n, knots) {
    // A fine polyline first: Chebyshev nodes in u, then any chord longer than 0.5 mm is
    // bisected in u until it is not (the sides of the squircle rise ~0.4·R within a
    // sliver of u near the pinch, and plain Chebyshev nodes would not resolve them).
    const K = 2048;
    let fine = [];
    for (let k = 0; k <= K; k++) fine.push(f(clamp(-cos(PI * k / K), -1, 1)));
    fine[0] = f(-1); fine[K] = f(1);
    for (let pass = 0; pass < 40; pass++) {
      const next = [fine[0]];
      let split = false;
      for (let k = 1; k < fine.length; k++) {
        if (dist3(fine[k - 1], fine[k]) > 0.5 && fine[k].u - fine[k - 1].u > 1e-13) {
          next.push(f((fine[k - 1].u + fine[k].u) / 2));
          split = true;
        }
        next.push(fine[k]);
      }
      fine = next;
      if (!split) break;
    }
    const F = fine.length - 1;
    const cum = [0];
    for (let k = 1; k <= F; k++) cum.push(cum[k - 1] + dist3(fine[k - 1], fine[k]));
    const S = cum[F];
    const us = [-1];
    let k = 1;
    for (let j = 1; j < n; j++) {
      const target = S * j / n;
      while (k < F && cum[k] < target) k++;
      const t = (target - cum[k - 1]) / max(1e-300, cum[k] - cum[k - 1]);
      us.push(fine[k - 1].u + t * (fine[k].u - fine[k - 1].u));
    }
    us.push(1);
    // Insert the corner knots as mandatory stations, then drop ordinary stations that
    // crowd a corner (closer than 0.35 of the nominal spacing), so no edge is tiny.
    const corners = new Set([-1, 1, ...knots]);
    const all = [...new Set([...us, ...knots])].sort((a, b) => a - b);
    let pts = all.map(f);
    pts[0] = f(-1); pts[pts.length - 1] = f(1);
    for (const q of pts) q.corner = corners.has(q.u);
    const gap = 0.35 * S / n;
    pts = pts.filter((q, i) => {
      if (q.corner) return true;
      const a = pts[i - 1], b = pts[i + 1];
      return !((a && a.corner && dist3(a, q) < gap) || (b && b.corner && dist3(b, q) < gap));
    });
    return pts;
  }

  const dist3 = (a, b) => sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);

  function signedArea(ring) {
    let a = 0;
    for (let i = 0, n = ring.length; i < n; i++) {
      const p = ring[i], q = ring[(i + 1) % n];
      a += p.x * q.y - q.x * p.y;
    }
    return a / 2;
  }

  // ----------------------------------------------------------------- erosion
  /**
   * Envelope of an x-monotone chain (points with strictly increasing x). With sign +1
   * (the upper chain) it returns U_d(x), the highest centre height at abscissa x of a
   * disk of radius d that stays under the chain; with sign −1 (the lower chain) the
   * lowest centre height of a disk that stays above it.
   */
  function envelope(chain, d, sign) {
    const n = chain.length;
    const X = Float64Array.from(chain, (q) => q.x), Y = Float64Array.from(chain, (q) => sign * q.y);
    return function (x) {
      // first segment whose right end reaches x − d
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (X[m] < x - d) lo = m; else hi = m; }
      let best = Infinity;
      for (let i = lo; i < n - 1 && X[i] <= x + d; i++) {
        const ax = X[i], ay = Y[i], bx = X[i + 1], by = Y[i + 1];
        const a = max(ax, x - d), b = min(bx, x + d);
        if (a > b) continue;
        const dx = bx - ax, dy = by - ay, len = hypot(dx, dy);
        const at = (xp) => ay + dy * ((xp - ax) / dx);
        // the disk-top constraint is convex along a segment: endpoints or tangency
        best = min(best, at(a) - sqrt(max(0, d * d - (a - x) ** 2)), at(b) - sqrt(max(0, d * d - (b - x) ** 2)));
        const xt = x - d * dy / len;
        if (xt > a && xt < b) best = min(best, at(xt) - d * dx / len);
      }
      return sign * best;
    };
  }

  /**
   * x of the mitre point of every interior vertex of a chain: where the offsets (by d,
   * toward the region) of its two edges meet. At a convex corner that is exactly the
   * kink of the envelope, so sampling there puts a vertex of the eroded ring right
   * inside every vertex of the chain. sgn = +1 for the upper chain, −1 for the lower.
   */
  function mitreXs(chain, d, sgn) {
    const xs = [];
    for (let k = 1; k < chain.length - 1; k++) {
      const a = chain[k - 1], p = chain[k], b = chain[k + 1];
      let e0x = p.x - a.x, e0y = p.y - a.y, e1x = b.x - p.x, e1y = b.y - p.y;
      const l0 = hypot(e0x, e0y), l1 = hypot(e1x, e1y);
      e0x /= l0; e0y /= l0; e1x /= l1; e1y /= l1;
      // inward normals: below the upper chain, above the lower chain
      const n0x = sgn * e0y, n0y = -sgn * e0x, n1x = sgn * e1y, n1y = -sgn * e1x;
      const dot = n0x * n1x + n0y * n1y;
      if (dot < -0.97) continue; // a near-hairpin turn: the mitre runs off to infinity
      xs.push(p.x + d * (n0x + n1x) / (1 + dot));
    }
    return xs;
  }

  /**
   * Erode the x-monotone region between `lower` and `upper` (point chains sharing their
   * end points) by d. Returns a CCW ring with its own lower and upper chains (index
   * lists into the ring). Throws if nothing is left or the region would split in two.
   * With `align`, each chain is also sampled at the mitre points of the matching outer
   * chain (used for the chamfer, whose facets must stay close to 38.7°).
   */
  function erode(lower, upper, d, align) { return run(erodeSteps(lower, upper, d, align)); }
  function* erodeSteps(lower, upper, d, align) {
    const Ud = envelope(upper, d, 1), Ld = envelope(lower, d, -1);
    const f = (x) => Ud(x) - Ld(x);
    const x0 = lower[0].x, x1 = lower[lower.length - 1].x;
    const N = max(48, ceil((x1 - x0) / GRID));
    const gx = [], fv = [];
    for (let k = 0; k <= N; k++) { const x = x0 + (x1 - x0) * k / N; gx.push(x); fv.push(f(x)); }
    let first = -1, last = -1;
    for (let k = 0; k <= N; k++) if (fv[k] > 0) { if (first < 0) first = k; last = k; }
    if (first < 0) throw new Error(`no room for a ${d.toFixed(2)} mm wall`);
    for (let k = first; k <= last; k++) if (!(fv[k] > 0)) throw new Error('the cavity would split in two');
    if (first === 0 || last === N) throw new Error('erosion reached the pinch');
    yield;
    // Ends: bisect to where the two envelopes meet, keeping the positive side.
    const bis = (out, inn) => {
      for (let it = 0; it < 100; it++) {
        const m = (out + inn) / 2;
        if (m === out || m === inn) break;
        if (f(m) > 0) inn = m; else out = m;
      }
      return inn;
    };
    const xl = bis(gx[first - 1], gx[first]), xr = bis(gx[last + 1], gx[last]);
    const endL = { x: xl, y: (Ud(xl) + Ld(xl)) / 2 }, endR = { x: xr, y: (Ud(xr) + Ld(xr)) / 2 };
    const inside = (x) => x - xl > 1e-3 && xr - x > 1e-3;
    const xs = gx.slice(first, last + 1).filter(inside);
    // sgn = +1 for the upper chain (the outer wall is above it), −1 for the lower chain.
    const refine = (F, sgn) => {
      let sx = xs;
      if (align) {
        const extra = mitreXs(sgn > 0 ? upper : lower, d, sgn).filter(inside);
        sx = [...xs, ...extra].sort((a, b) => a - b).filter((x, i, arr) => i === 0 || x - arr[i - 1] > 1e-4);
      }
      let pts = [endL, ...sx.map((x) => ({ x, y: F(x) })), endR];
      for (let pass = 0; pass < 40; pass++) {
        const out = [pts[0]];
        let split = false;
        for (let k = 1; k < pts.length; k++) {
          const a = pts[k - 1], b = pts[k];
          if (b.x - a.x > 2e-6) {
            const mx = (a.x + b.x) / 2, my = F(mx);
            const bow = sgn * ((a.y + b.y) / 2 - my); // > 0: chord bows toward the outer wall
            if (hypot(b.x - a.x, b.y - a.y) > MAX_CHORD || bow > MARGIN / 2 || -bow > SLACK) {
              out.push({ x: mx, y: my });
              split = true;
            }
          }
          out.push(b);
        }
        pts = out;
        if (!split) break;
      }
      // drop interior points that crowd a neighbour (keeps every edge ≥ MIN_EDGE)
      const kept = [pts[0]];
      for (let k = 1; k < pts.length - 1; k++) {
        const a = kept[kept.length - 1], q = pts[k];
        if (hypot(q.x - a.x, q.y - a.y) >= MIN_EDGE && hypot(q.x - pts[pts.length - 1].x, q.y - pts[pts.length - 1].y) >= MIN_EDGE) kept.push(q);
      }
      kept.push(pts[pts.length - 1]);
      return kept;
    };
    const lo = refine(Ld, -1);
    yield;
    const up = refine(Ud, 1);
    yield;
    // At a rounded tip the two chains leave the end vertex almost tangent, so the
    // triangle (end, first lower, first upper) can be a sliver. Thin the points next to
    // each tip until it is not. (Near a tip the eroded region is locally convex, so a
    // dropped point only moves the chord away from the outer wall; the gap is measured
    // afterwards anyway.)
    const tipArea2 = (e, a, b) => abs((a.x - e.x) * (b.y - e.y) - (a.y - e.y) * (b.x - e.x));
    for (const end of [0, 1]) {
      for (let guard = 0; guard < 200 && lo.length > 3 && up.length > 3; guard++) {
        const k = end ? lo.length - 2 : 1, ku = end ? up.length - 2 : 1, e = end ? lo[lo.length - 1] : lo[0];
        if (tipArea2(e, lo[k], up[ku]) >= TIP_AREA2) break;
        if (hypot(lo[k].x - e.x, lo[k].y - e.y) < hypot(up[ku].x - e.x, up[ku].y - e.y)) lo.splice(k, 1);
        else up.splice(ku, 1);
      }
    }
    // CCW ring: lower chain left→right, then upper chain right→left (ends shared).
    const ring = [...lo, ...up.slice(1, -1).reverse()];
    const lowerIdx = lo.map((_, i) => i);
    const upperIdx = [0, ...up.slice(1, -1).map((_, i) => ring.length - 1 - i), lo.length - 1];
    if (signedArea(ring) <= 0 || !isSimple(ring)) throw new Error(`offset by ${d.toFixed(3)} mm is not a simple polygon`);
    return { ring, lowerIdx, upperIdx };
  }

  // --------------------------------------------------------------- 2-D helpers
  function closestOnSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
    const ex = ax + t * dx - px, ey = ay + t * dy - py;
    return { d2: ex * ex + ey * ey, t };
  }
  /**
   * Exact minimum distance between two closed polylines that do not cross: the
   * closest pair of points between two segments always includes an endpoint, so it is
   * the smaller of (every vertex of A to the segments of B) and (every vertex of B to
   * the segments of A). Also returns, for each vertex of B, its closest segment on A.
   */
  function ringGap(A, B) { return run(ringGapSteps(A, B)); }
  function* ringGapSteps(A, B) {
    const n = A.length, m = B.length;
    let best = Infinity;
    const foot = new Array(m);
    for (let j = 0; j < m; j++) {
      const q = B[j];
      let bd = Infinity, bk = 0, bt = 0;
      for (let k = 0; k < n; k++) {
        const a = A[k], b = A[(k + 1) % n];
        const r = closestOnSeg(q.x, q.y, a.x, a.y, b.x, b.y);
        if (r.d2 < bd) { bd = r.d2; bk = k; bt = r.t; }
      }
      foot[j] = { k: bk, t: bt };
      best = min(best, bd);
      if ((j & 63) === 63) yield;
    }
    for (let k = 0; k < n; k++) {
      const q = A[k];
      for (let j = 0; j < m; j++) {
        const a = B[j], b = B[(j + 1) % m];
        best = min(best, closestOnSeg(q.x, q.y, a.x, a.y, b.x, b.y).d2);
      }
      if ((k & 63) === 63) yield;
    }
    return { gap: sqrt(best), foot };
  }

  function segsCross(a, b, c, d) {
    // Boxes first: far-apart segments on one straight line would otherwise give
    // orientation products that are pure round-off.
    if (max(a.x, b.x) < min(c.x, d.x) || max(c.x, d.x) < min(a.x, b.x) ||
        max(a.y, b.y) < min(c.y, d.y) || max(c.y, d.y) < min(a.y, b.y)) return false;
    const o = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
    return o1 * o2 < 0 && o3 * o4 < 0;
  }
  /** True when no two non-adjacent edges of the ring cross (O(n²)). */
  function isSimple(ring) {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n];
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        if (segsCross(a, b, ring[j], ring[(j + 1) % n])) return false;
      }
    }
    return true;
  }

  // ------------------------------------------------------- band triangulation
  /**
   * Triangulate the band between an outer CCW ring O and an inner CCW ring I (vertex
   * index lists) by dynamic programming over the grid of (outer, inner) positions: each
   * step adds one triangle, (O_i, O_i+1, I_j) or (O_i, I_j+1, I_j), and only triangles
   * that `ok` accepts are allowed (`ok` must at least demand counter-clockwise in
   * plan). The path minimising total rung length wins. Generator: yields while working.
   */
  function* zipRings(O, I, ok, rung, s0) {
    const n = O.length, m = I.length, W = m + 1;
    // start from outer vertex s0 (mid-wall, away from the pinch tips) and its nearest inner vertex
    const t0 = argmin(m, (j) => rung(O[s0], I[j]));
    const o = (i) => O[(s0 + i) % n], q = (j) => I[(t0 + j) % m];
    const cost = new Float64Array((n + 1) * W).fill(Infinity);
    const from = new Uint8Array((n + 1) * W);
    cost[0] = 0;
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= m; j++) {
        const c = cost[i * W + j];
        if (c === Infinity) continue;
        if (i < n && ok(o(i), o(i + 1), q(j))) {
          const v = c + rung(o(i + 1), q(j)), at = (i + 1) * W + j;
          if (v < cost[at]) { cost[at] = v; from[at] = 1; }
        }
        if (j < m && ok(o(i), q(j + 1), q(j))) {
          const v = c + rung(o(i), q(j + 1)), at = i * W + j + 1;
          if (v < cost[at]) { cost[at] = v; from[at] = 2; }
        }
      }
      if ((i & 15) === 15) yield;
    }
    if (cost[n * W + m] === Infinity) throw new Error('no valid band triangulation');
    const tris = [];
    for (let i = n, j = m; i > 0 || j > 0;) {
      if (from[i * W + j] === 1) { tris.push(o(i - 1), o(i), q(j)); i--; }
      else { tris.push(o(i), q(j), q(j - 1)); j--; }
    }
    return tris;
  }
  function argmin(n, f) {
    let bi = 0, bv = Infinity;
    for (let i = 0; i < n; i++) { const v = f(i); if (v < bv) { bv = v; bi = i; } }
    return bi;
  }

  /**
   * Triangulate an x-monotone polygon given as a lower and an upper chain (index lists,
   * left to right, sharing both end vertices) by the same kind of dynamic programme:
   * every triangle joins a rung between the chains to the next vertex of one chain.
   * Returns CCW index triples, or null if no all-CCW ladder exists.
   */
  function* ladder(lower, upper, ok, rung) {
    const p = lower.length - 1, qn = upper.length - 1, W = qn + 1;
    const cost = new Float64Array((p + 1) * W).fill(Infinity);
    const from = new Uint8Array((p + 1) * W);
    if (!ok(lower[0], lower[1], upper[1])) return null;
    cost[1 * W + 1] = 0;
    for (let i = 1; i <= p; i++) {
      for (let j = 1; j <= qn; j++) {
        const c = cost[i * W + j];
        if (c === Infinity) continue;
        if (i < p && !(i + 1 === p && j === qn) && ok(lower[i], lower[i + 1], upper[j])) {
          const v = c + rung(lower[i + 1], upper[j]), at = (i + 1) * W + j;
          if (v < cost[at]) { cost[at] = v; from[at] = 1; }
        }
        if (j < qn && !(i === p && j + 1 === qn) && ok(lower[i], upper[j + 1], upper[j])) {
          const v = c + rung(lower[i], upper[j + 1]), at = i * W + j + 1;
          if (v < cost[at]) { cost[at] = v; from[at] = 2; }
        }
      }
      if ((i & 15) === 15) yield;
    }
    // Finish: the last rung must touch the right end vertex, i.e. state (p, qn−1) or (p−1, qn).
    const endA = cost[p * W + qn - 1], endB = cost[(p - 1) * W + qn];
    if (endA === Infinity && endB === Infinity) return null;
    let i, j;
    if (endA <= endB) { i = p; j = qn - 1; } else { i = p - 1; j = qn; }
    const tris = [];
    while (!(i === 1 && j === 1)) {
      if (from[i * W + j] === 1) { tris.push(lower[i - 1], lower[i], upper[j]); i--; }
      else { tris.push(lower[i], upper[j], upper[j - 1]); j--; }
    }
    tris.push(lower[0], lower[1], upper[1]);
    return tris;
  }

  /**
   * Ear clipping of a CCW simple polygon; returns CCW index triples. Used only as a
   * fallback when the monotone ladder finds no triangulation.
   */
  function earClip(pts) {
    const idx = Array.from({ length: pts.length }, (_, i) => i);
    const tris = [];
    const EPS = 1e-12;
    const cr = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    while (idx.length > 3) {
      const m = idx.length;
      let pick = -1, bestCr = EPS;
      for (let i = 0; i < m; i++) {
        const a = pts[idx[(i - 1 + m) % m]], b = pts[idx[i]], c = pts[idx[(i + 1) % m]];
        const v = cr(a, b, c);
        if (v <= bestCr) continue;
        let blocked = false;
        for (const j of idx) {
          const p = pts[j];
          if (p === a || p === b || p === c) continue;
          if (cr(a, b, p) >= -EPS && cr(b, c, p) >= -EPS && cr(c, a, p) >= -EPS) { blocked = true; break; }
        }
        if (!blocked) { pick = i; bestCr = v; if (v > 0.05) break; }
      }
      if (pick < 0) throw new Error('ear clipping found no ear');
      tris.push(idx[(pick - 1 + m) % m], idx[pick], idx[(pick + 1) % m]);
      idx.splice(pick, 1);
    }
    tris.push(idx[0], idx[1], idx[2]);
    return tris;
  }

  // ------------------------------------------------------------------ mesh
  /**
   * Build the closed triangle mesh, step by step (a generator, so a page can spread the
   * work over several frames). Returns { positions: Float64Array (xyz triples),
   * triangles: Uint32Array (index triples, outward CCW), ring, inner, base, stats... }.
   */
  function* buildSteps(params) {
    const r = rim(params);
    const p = r.params;
    const ring = r.ring;
    const M = ring.length;
    if (!isSimple(ring)) throw new Error('the outline crosses itself');
    yield 'rim';
    const lowerChain = ring.slice(0, r.lowerN);
    const upperChain = [ring[0], ...ring.slice(r.lowerN).reverse(), ring[r.lowerN - 1]];

    // Inner wall: erode by the wall plus a small margin, then measure the true gap.
    let inner, gap;
    for (let extra = MARGIN; ; extra *= 4) {
      inner = yield* erodeSteps(lowerChain, upperChain, p.wall + extra);
      gap = yield* ringGapSteps(ring, inner.ring);
      if (gap.gap >= p.wall + 5e-4) break; // 0.5 µm to spare, so float32 STL rounding cannot eat it
      if (extra > 0.1) throw new Error(`wall came out ${gap.gap.toFixed(4)} mm`);
    }
    yield 'inner';
    const base = yield* erodeSteps(lowerChain, upperChain, CHAMFER.inset, true);
    const baseGap = (yield* ringGapSteps(ring, base.ring)).gap;
    yield 'base';

    // Rim height on the inner edge: the rim height at the nearest point of the outline,
    // so the rim's top surface runs level across the wall.
    const innerZ = gap.foot.map(({ k, t }) => ring[k].z + t * (ring[(k + 1) % M].z - ring[k].z));

    const V = [];
    const add = (x, y, z) => { V.push(x, y, z); return V.length / 3 - 1; };
    const iB = base.ring.map((q) => add(q.x, q.y, 0));
    const iC = ring.map((q) => add(q.x, q.y, CHAMFER.rise));
    const iR = ring.map((q) => add(q.x, q.y, q.z));
    const iI = inner.ring.map((q, j) => add(q.x, q.y, innerZ[j]));
    const iF = inner.ring.map((q) => add(q.x, q.y, p.floor));

    const px = (i) => V[3 * i], py = (i) => V[3 * i + 1], pz = (i) => V[3 * i + 2];
    const area2 = (a, b, c) => (px(b) - px(a)) * (py(c) - py(a)) - (py(b) - py(a)) * (px(c) - px(a));
    const rung = (a, b) => hypot(px(a) - px(b), py(a) - py(b));
    // Triangles must be counter-clockwise in plan with at least this much (twice) plan
    // area in mm². Each triangulation first tries a strict floor and relaxes it only if
    // no triangulation exists, so slivers appear only where the outline forces them.
    const FLOORS = [2e-2, 2e-3, 2e-4];
    let a2min = FLOORS[0];
    const ccw = (a, b, c) => area2(a, b, c) > a2min;
    const relaxing = function* (job) {
      for (const f of FLOORS) {
        a2min = f;
        try { const r = yield* job(); if (r) return r; } catch (e) { if (f === FLOORS[FLOORS.length - 1]) throw e; }
      }
      return null;
    };
    // A chamfer facet (CCW in plan; it is emitted flipped, facing down and out) must not
    // lean more than maxDeg from vertical.
    const sinMax = sin(CHAMFER.maxDeg / DEG);
    const chamferOK = (a, b, c) => {
      if (!ccw(a, b, c)) return false;
      const ux = px(b) - px(a), uy = py(b) - py(a), uz = pz(b) - pz(a);
      const vx = px(c) - px(a), vy = py(c) - py(a), vz = pz(c) - pz(a);
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      return nz / hypot(nx, ny, nz) <= sinMax;
    };

    const T = [];
    const band = (lo, hi, flip) => {
      const n = lo.length;
      for (let k = 0; k < n; k++) {
        const k1 = (k + 1) % n;
        if (flip) T.push(lo[k], hi[k1], lo[k1], lo[k], hi[k], hi[k1]);
        else T.push(lo[k], lo[k1], hi[k1], lo[k], hi[k1], hi[k]);
      }
    };
    const mid = r.lowerN >> 1; // middle of the lower chain
    const chamfer = yield* relaxing(() => zipRings(iC, iB, chamferOK, rung, mid));
    for (let t = 0; t < chamfer.length; t += 3) T.push(chamfer[t], chamfer[t + 2], chamfer[t + 1]);
    yield 'chamfer';
    band(iC, iR, false);                       // outer wall
    const top = yield* relaxing(() => zipRings(iR, iI, ccw, rung, mid));
    T.push(...top);                            // rim top band
    yield 'rim band';
    band(iF, iI, true);                        // inner wall, facing the cavity

    // Flat caps (bottom face, floor top). The ladder only needs the ring split into two
    // chains that share their end vertices, not x-monotone ones, so if the natural split
    // (leftmost and rightmost points) fails, e.g. at a blunt end where the cavity ends in
    // a nearly vertical straight edge, try the extreme points along tilted directions.
    let earClipped = 0;
    const cap = function* (ringIdx, chains, pts) {
      const n = pts.length;
      const splits = [[chains.lowerIdx[0], chains.lowerIdx[chains.lowerIdx.length - 1]]];
      for (const th of [0.35, -0.35, 0.7, -0.7, 1.1, -1.1]) {
        const c = cos(th), sn = sin(th);
        const a = argmin(n, (i) => pts[i].x * c + pts[i].y * sn), b = argmin(n, (i) => -(pts[i].x * c + pts[i].y * sn));
        if (a !== b) splits.push([a, b]);
      }
      const lad = yield* relaxing(function* () {
        for (const [a, b] of splits) {
          const lo = [], up = [];
          for (let i = a; ; i = (i + 1) % n) { lo.push(ringIdx[i]); if (i === b) break; }
          for (let i = a; ; i = (i - 1 + n) % n) { up.push(ringIdx[i]); if (i === b) break; }
          if (lo.length < 2 || up.length < 2) continue;
          const r = yield* ladder(lo, up, ccw, rung);
          if (r) return r;
        }
        return null;
      });
      if (lad) return lad;
      earClipped++;
      return earClip(pts).map((i) => ringIdx[i]);
    };
    const bottom = yield* cap(iB, base, base.ring);
    for (let t = 0; t < bottom.length; t += 3) T.push(bottom[t], bottom[t + 2], bottom[t + 1]); // faces down
    const floorTop = yield* cap(iF, inner, inner.ring);
    T.push(...floorTop);                       // faces up
    yield 'caps';

    const positions = Float64Array.from(V);
    const triangles = Uint32Array.from(T);
    const stats = meshStats(positions, triangles);
    let yMin = Infinity, yMax = -Infinity;
    for (const q of ring) { yMin = min(yMin, q.y); yMax = max(yMax, q.y); }
    let worstChamfer = 0;
    for (let t = 0; t < chamfer.length; t += 3) {
      const a = chamfer[t], b = chamfer[t + 1], c = chamfer[t + 2];
      const ux = px(b) - px(a), uy = py(b) - py(a), uz = pz(b) - pz(a);
      const vx = px(c) - px(a), vy = py(c) - py(a), vz = pz(c) - pz(a);
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      worstChamfer = max(worstChamfer, asin(clamp(nz / hypot(nx, ny, nz), -1, 1)) * DEG);
    }
    const depth = yMax - yMin;
    return {
      ...r,
      positions, triangles, inner: inner.ring, base: base.ring,
      index: { bottom: iB, chamfer: iC, rim: iR, rimInner: iI, floor: iF },
      bbox: { x: [-r.R, r.R], y: [yMin, yMax], z: [0, r.rimHigh] },
      footprint: { width: 2 * r.R, depth, narrowest: r.narrowest },
      slenderness: r.rimHigh / r.narrowest,
      minWall: gap.gap, chamferInset: baseGap, worstOverhang: worstChamfer, earClipped,
      stats,
      massPLA: stats.volume / 1000 * 1.24, // g, at 100% infill, PLA 1.24 g/cm³
    };
  }

  /** Drive a generator to completion synchronously. */
  function run(it) {
    for (;;) { const s = it.next(); if (s.done) return s.value; }
  }
  function buildMesh(params) { return run(buildSteps(params)); }

  /** Volume (signed, divergence theorem), surface area, centroid, bbox, counts. */
  function meshStats(P, T) {
    let vol = 0, area = 0, cx = 0, cy = 0, cz = 0;
    const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = 0; i < P.length; i += 3) {
      for (let k = 0; k < 3; k++) { bb[k] = min(bb[k], P[i + k]); bb[3 + k] = max(bb[3 + k], P[i + k]); }
    }
    for (let t = 0; t < T.length; t += 3) {
      const a = T[t] * 3, b = T[t + 1] * 3, c = T[t + 2] * 3;
      const ax = P[a], ay = P[a + 1], az = P[a + 2];
      const bx = P[b], by = P[b + 1], bz = P[b + 2];
      const cx_ = P[c], cy_ = P[c + 1], cz_ = P[c + 2];
      const nx = (by - ay) * (cz_ - az) - (bz - az) * (cy_ - ay);
      const ny = (bz - az) * (cx_ - ax) - (bx - ax) * (cz_ - az);
      const nz = (bx - ax) * (cy_ - ay) - (by - ay) * (cx_ - ax);
      area += sqrt(nx * nx + ny * ny + nz * nz) / 2;
      const v = (ax * (by * cz_ - bz * cy_) + ay * (bz * cx_ - bx * cz_) + az * (bx * cy_ - by * cx_)) / 6;
      vol += v;
      cx += v * (ax + bx + cx_) / 4; cy += v * (ay + by + cy_) / 4; cz += v * (az + bz + cz_) / 4;
    }
    return { volume: vol, area, centroid: [cx / vol, cy / vol, cz / vol], bbox: bb, vertices: P.length / 3, triangles: T.length / 3 };
  }

  // ------------------------------------------------------------ projection
  /** Orthographic image coordinates of a point for the eye and for the mirror. */
  function project(x, y, z, angleDeg, zShift) {
    const phi = angleDeg * PI / 180, s = sin(phi), c = cos(phi);
    const zz = z - (zShift || 0);
    return { eye: [x, zz * c - y * s], mirror: [x, zz * c + y * s] };
  }

  /** Polyline of the target shape in image space (for drawing the proof). */
  function shapeOutline(shape, R, n) {
    const sh = typeof shape === 'string' ? shapeById(shape) : shape;
    const top = [], bottom = [];
    const xs = [];
    for (let k = 0; k <= n; k++) xs.push(-cos(PI * k / n));
    for (const q of sh.knots) xs.push(q, -q);
    xs.sort((a, b) => a - b);
    for (const u of xs) { top.push([u * R, sh.top(u) * R]); bottom.push([u * R, sh.bottom(u) * R]); }
    return [...top, ...bottom.slice(1, -1).reverse()];
  }

  /**
   * How far the rim's projections land from the two target shapes, in mm, measured at
   * every rim station (the shape is evaluated at the station's own parameter u).
   */
  function illusionError(mesh) {
    const { ring, A, B, R, zShift } = mesh;
    const ang = mesh.params.angle;
    let worst = 0;
    for (const q of ring) {
      const pr = project(q.x, q.y, q.z, ang, zShift);
      const near = q.branch === 'near';
      const e = [q.u * R, (near ? A.bottom(q.u) : A.top(q.u)) * R];
      const m = [q.u * R, (near ? B.top(q.u) : B.bottom(q.u)) * R];
      worst = max(worst, hypot(pr.eye[0] - e[0], pr.eye[1] - e[1]), hypot(pr.mirror[0] - m[0], pr.mirror[1] - m[1]));
    }
    return worst;
  }

  /**
   * How far the straight rim edges between stations stray from the target shapes, in mm
   * in image space (the projection of a chord is the chord of the projections, so this
   * is the sagitta of each shape over each rim edge). Each edge is sampled at 16 points.
   */
  function chordError(mesh) {
    const { ring, A, B, R, zShift } = mesh;
    const ang = mesh.params.angle;
    const n = ring.length;
    let eye = 0, mirror = 0;
    const segD = (px, py, a, b) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? clamp(((px - a[0]) * dx + (py - a[1]) * dy) / l2, 0, 1) : 0;
      return hypot(a[0] + t * dx - px, a[1] + t * dy - py);
    };
    for (let i = 0; i < n; i++) {
      const q0 = ring[i], q1 = ring[(i + 1) % n];
      const nearEdge = q0.branch === 'near' || q1.branch === 'near';
      const p0 = project(q0.x, q0.y, q0.z, ang, zShift), p1 = project(q1.x, q1.y, q1.z, ang, zShift);
      for (let k = 1; k < 16; k++) {
        const u = q0.u + (q1.u - q0.u) * k / 16;
        const he = (nearEdge ? A.bottom(u) : A.top(u)) * R, hm = (nearEdge ? B.top(u) : B.bottom(u)) * R;
        eye = max(eye, segD(u * R, he, p0.eye, p1.eye));
        mirror = max(mirror, segD(u * R, hm, p0.mirror, p1.mirror));
      }
    }
    return { eye, mirror, worst: max(eye, mirror) };
  }

  // ------------------------------------------------------------------- STL
  function toSTL(mesh, label) {
    const P = mesh.positions, T = mesh.triangles;
    const n = T.length / 3;
    const buf = new ArrayBuffer(84 + 50 * n);
    const dv = new DataView(buf);
    const head = (label || 'Doubletake').slice(0, 79);
    for (let i = 0; i < head.length; i++) dv.setUint8(i, head.charCodeAt(i) & 0x7f);
    for (let i = head.length; i < 80; i++) dv.setUint8(i, 0x20);
    dv.setUint32(80, n, true);
    let o = 84;
    for (let t = 0; t < T.length; t += 3) {
      const a = T[t] * 3, b = T[t + 1] * 3, c = T[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= l; ny /= l; nz /= l;
      dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true);
      o += 12;
      for (const i of [a, b, c]) {
        dv.setFloat32(o, P[i], true); dv.setFloat32(o + 4, P[i + 1], true); dv.setFloat32(o + 8, P[i + 2], true);
        o += 12;
      }
      dv.setUint16(o, 0, true);
      o += 2;
    }
    return buf;
  }

  function parseSTL(buf) {
    const dv = new DataView(buf);
    const n = dv.getUint32(80, true);
    if (buf.byteLength !== 84 + 50 * n) throw new Error('not a binary STL of the declared size');
    const tris = new Float32Array(n * 9), normals = new Float32Array(n * 3);
    let o = 84;
    for (let t = 0; t < n; t++) {
      for (let k = 0; k < 3; k++) normals[t * 3 + k] = dv.getFloat32(o + 4 * k, true);
      o += 12;
      for (let k = 0; k < 9; k++) tris[t * 9 + k] = dv.getFloat32(o + 4 * k, true);
      o += 36 + 2;
    }
    return { count: n, tris, normals };
  }

  function fileName(p) {
    const q = normalize(p);
    return `doubletake-${q.eye}-eye-${q.mirror}-mirror-${q.angle}deg-${q.width}x${Math.round(q.height)}mm.stl`;
  }

  return {
    SHAPES, PARAMS, CHAMFER, LIMITS, shapeById, defaults, normalize,
    rim, minWidth, buildSteps, buildMesh, meshStats, erode, ringGap, isSimple, signedArea, earClip,
    project, shapeOutline, illusionError, chordError, toSTL, parseSTL, fileName,
  };
});
