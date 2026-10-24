/* The Kepler Pair: the pure model. No DOM, no clock, no randomness.
   In the page it is a classic script (window.KeplerPair; load mesh.js first). In Node, require() it.
   Units: millimetres, radians, days. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./mesh.js'));
  else root.KeplerPair = factory(root.KPMesh);
})(typeof self !== 'undefined' ? self : this, function (Mesh) {
  'use strict';
  const TAU = 2 * Math.PI;
  const DEG = 180 / Math.PI;
  // sqrt(x*x + y*y) is correctly rounded in every JavaScript engine; Math.hypot is not, and the
  // committed STLs must come out byte-identical wherever this runs.
  const hyp = (x, y) => Math.sqrt(x * x + y * y);

  /* --------------------------------------------------- deterministic trigonometry */
  // JavaScript engines differ in the last bit of Math.sin, cos and atan2 (Chrome 141 and Node 22
  // do), and the tooth-cutting turns such differences into visible ones. These use only + - * /
  // and sqrt, which IEEE 754 fixes to the bit, so the STLs are byte-identical in any engine.
  // Good to about 1e-15 for the arguments used here.
  const PI = Math.PI;
  const HALF_PI = PI / 2;
  const PIO2_HI = 1.5707963267341256; // pi/2 split in two (fdlibm's pio2_1 and pio2_1t)
  const PIO2_LO = 6.077100506506192e-11;
  function sinP(x) {
    const z = x * x;
    return x * (1 - (z / 6) * (1 - (z / 20) * (1 - (z / 42) * (1 - (z / 72) * (1 - (z / 110) * (1 - (z / 156) * (1 - (z / 210) * (1 - (z / 272) * (1 - z / 342)))))))));
  }
  function cosP(x) {
    const z = x * x;
    return 1 - (z / 2) * (1 - (z / 12) * (1 - (z / 30) * (1 - (z / 56) * (1 - (z / 90) * (1 - (z / 132) * (1 - (z / 182) * (1 - (z / 240) * (1 - (z / 306) * (1 - z / 380)))))))));
  }
  function reduce(x) {
    const k = Math.round(x / HALF_PI);
    return [x - k * PIO2_HI - k * PIO2_LO, ((k % 4) + 4) % 4];
  }
  function sin(x) {
    const [r, q] = reduce(x);
    return q === 0 ? sinP(r) : q === 1 ? cosP(r) : q === 2 ? -sinP(r) : -cosP(r);
  }
  function cos(x) {
    const [r, q] = reduce(x);
    return q === 0 ? cosP(r) : q === 1 ? -sinP(r) : q === 2 ? -cosP(r) : sinP(r);
  }
  function atanSmall(t) {
    // two half-angle steps take |t| <= 1 to |u| <= tan(pi/16), then the series to u^31
    const t1 = t / (1 + Math.sqrt(1 + t * t));
    const u = t1 / (1 + Math.sqrt(1 + t1 * t1));
    const z = u * u;
    let s = 0;
    for (let k = 31; k >= 3; k -= 2) s = z * (1 / k - s);
    return 4 * u * (1 - s);
  }
  function atan2(y, x) {
    if (x === 0 && y === 0) return 1 / x > 0 ? y : 1 / y > 0 ? PI : -PI; // as Math.atan2 does
    const ax = Math.abs(x);
    const ay = Math.abs(y);
    let a = ay <= ax ? atanSmall(ay / ax) : HALF_PI - atanSmall(ax / ay);
    if (x < 0) a = PI - a;
    return y < 0 || (y === 0 && 1 / y < 0) ? -a : a; // signed zeros as Math.atan2 has them
  }
  const tan = (x) => sin(x) / cos(x);
  const asin = (x) => atan2(x, Math.sqrt(1 - x * x));

  /* ---------------------------------------------------------------- orbits */
  // Mercury, Mars and the Earth-Moon barycentre: e at J2000 and the anomalistic period
  // 360 deg / (rate of mean longitude - rate of longitude of perihelion), from Table 1 of JPL's
  // "Approximate Positions of the Planets" (Standish & Williams 1992; valid 1800-2050).
  // Pluto (system barycentre) is not in that table any more. Its e and period are measured from
  // DE441 (perihelia 1741.66, 1989.68, 2237.70; aphelia 1866.43, 2114.13): see reduce-sky.mjs.
  // dots: equal steps of time per orbit on each dial. C: the centre distances offered (mm).
  const BODIES = {
    mercury: { name: 'Mercury', e: 0.20563593, a: 0.38709927, P: (36525 * 360) / (149472.67411175 - 0.16047689), dots: 22, C: [62, 74] },
    mars: { name: 'Mars', e: 0.0933941, a: 1.52371034, P: (36525 * 360) / (19140.30268499 - 0.44441088), dots: 23, C: [56, 76] },
    earth: { name: 'Earth', e: 0.01671123, a: 1.00000261, P: (36525 * 360) / (35999.37244981 - 0.32327364), dots: 26, C: [56, 76] },
    pluto: { name: 'Pluto', e: 0.24896, a: 39.48, P: 90588.8, dots: 25, C: [68, 72] },
  };

  function wrapPi(a) {
    return a - TAU * Math.round(a / TAU);
  }
  // Kepler's equation M = E - e sin E, solved for E by Newton's method; continuous in M.
  function eccentricAnomaly(M, e) {
    const Mr = wrapPi(M);
    let E = Mr + (e * sin(Mr)) / (1 - e * cos(Mr));
    for (let i = 0; i < 60; i++) {
      const dE = (E - e * sin(E) - Mr) / (1 - e * cos(E));
      E -= dE;
      if (Math.abs(dE) < 1e-15) break;
    }
    return E + (M - Mr);
  }
  // With b = e / (1 + sqrt(1 - e^2)) these two are continuous (no branch cuts).
  function trueFromEcc(E, e) {
    const b = e / (1 + Math.sqrt(1 - e * e));
    return E + 2 * atan2(b * sin(E), 1 - b * cos(E));
  }
  function eccFromTrue(th, e) {
    const b = e / (1 + Math.sqrt(1 - e * e));
    return th - 2 * atan2(b * sin(th), 1 + b * cos(th));
  }
  // Time (as mean anomaly) to angle from perihelion (true anomaly): needs an iteration.
  function trueFromMean(M, e) {
    return trueFromEcc(eccentricAnomaly(M, e), e);
  }
  // The inverse needs none.
  function meanFromTrue(th, e) {
    const E = eccFromTrue(th, e);
    return E - e * sin(E);
  }
  // d(theta)/dM: the planet's angular speed in units of its average one (Kepler's second law).
  function rate(th, e) {
    const c = 1 + e * cos(th);
    const q = 1 - e * e;
    return (c * c) / (q * Math.sqrt(q));
  }
  function radius(th, e, a) {
    return (a * (1 - e * e)) / (1 + e * cos(th));
  }
  // The older answer: uniform turning about the empty focus, tan(theta/2) = ((1+e)/(1-e)) tan(M/2).
  // Two identical elliptical gears, each turning on a focus, do exactly this (tested by rolling them).
  function ellipsePairTrue(M, e) {
    const k = (1 + e) / (1 - e);
    const Mr = wrapPi(M);
    return M - Mr + 2 * atan2(k * sin(Mr / 2), cos(Mr / 2));
  }

  /* ----------------------------------------------------------- pitch curves */
  // Kepler wheel (on the Sun's peg, B at the origin) turns anticlockwise by theta; time wheel (A at
  // (-C, 0)) turns clockwise by M. They roll on the line of centres, so r1 + r2 = C and
  // r1 / r2 = d(theta)/dM. Both are written as functions of theta: no iteration needed.
  function keplerPitchR(th, e, C) {
    return C / (1 + rate(th, e));
  }
  function timePitchR(th, e, C) {
    return C - keplerPitchR(th, e, C);
  }
  // Dense pitch polylines in each wheel's own frame (the frame at perihelion). The Kepler wheel
  // touches at local angle (pi - theta), the time wheel at local angle +M.
  function pitchCurves(e, C, n) {
    n = n || 4096;
    const K = [];
    const T = [];
    for (let i = 0; i < n; i++) {
      const th = (TAU * i) / n;
      const r2 = keplerPitchR(th, e, C);
      const b = Math.PI - th;
      K.push([r2 * cos(b), r2 * sin(b)]);
      const M = meanFromTrue(th, e);
      const r1 = C - r2;
      T.push([r1 * cos(M), r1 * sin(M)]);
    }
    return { K: arcTable(K), T: arcTable(T) };
  }
  function arcTable(P) {
    const n = P.length;
    const s = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) {
      const a = P[i];
      const b = P[(i + 1) % n];
      s[i + 1] = s[i] + hyp(b[0] - a[0], b[1] - a[1]);
    }
    return { P, s, L: s[n] };
  }
  // Point, unit tangent (direction of increasing s) and unit normal towards the wheel's centre.
  function pitchAt(tab, s) {
    const P = tab.P;
    const S = tab.s;
    const L = tab.L;
    const n = P.length;
    s = ((s % L) + L) % L;
    let lo = 0;
    let hi = n;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (S[mid] <= s) lo = mid;
      else hi = mid;
    }
    const a = P[lo];
    const b = P[(lo + 1) % n];
    const seg = S[lo + 1] - S[lo];
    const f = seg > 0 ? (s - S[lo]) / seg : 0;
    const x = a[0] + f * (b[0] - a[0]);
    const y = a[1] + f * (b[1] - a[1]);
    const p0 = P[(lo - 2 + n) % n];
    const p1 = P[(lo + 3) % n];
    let tx = p1[0] - p0[0];
    let ty = p1[1] - p0[1];
    const tl = hyp(tx, ty);
    tx /= tl;
    ty /= tl;
    let nx = -ty;
    let ny = tx;
    if (nx * -x + ny * -y < 0) {
      nx = -nx;
      ny = -ny;
    }
    return { x, y, tx, ty, nx, ny };
  }

  /* -------------------------------------------------------- tooth generation */
  // Both wheels are cut by the same straight rack (pressure angle alpha) rolled along their pitch
  // curves without slipping, so the teeth are conjugate. The wheel's radius in each direction is
  // the nearest point of the rack's outline over all rack positions (7200 directions).
  // phase 0: a tooth centred at s = 0; phase 0.5: a space there.
  function cutWheel(tab, g, phase, bins) {
    bins = bins || 7200;
    const p = g.pitch;
    const ta = tan(g.alpha);
    const w = p / 4 + g.thin / 2; // half-width of a cutter tooth at the pitch line
    const U = [];
    const V = [];
    const step = 0.04;
    const seg = (u0, v0, u1, v1) => {
      const k = Math.max(1, Math.ceil(hyp(u1 - u0, v1 - v0) / step));
      for (let i = 0; i < k; i++) {
        U.push(u0 + ((u1 - u0) * i) / k);
        V.push(v0 + ((v1 - v0) * i) / k);
      }
    };
    // one period of the cutter, centred on a cutter tooth; v is depth into the wheel
    const rootL = -(w + g.add * ta);
    const tipL = -(w - g.ded * ta);
    seg(-p / 2, -g.add, rootL, -g.add);
    seg(rootL, -g.add, tipL, g.ded);
    seg(tipL, g.ded, -tipL, g.ded);
    seg(-tipL, g.ded, -rootL, -g.add);
    seg(-rootL, -g.add, p / 2, -g.add);
    const no = U.length;
    const R = new Float64Array(bins).fill(Infinity);
    const PX = new Float64Array(bins);
    const PY = new Float64Array(bins);
    const L = tab.L;
    const nPos = Math.round(L / (p / 90)); // 90 rack positions per tooth (round, not ceil: L / p is N)
    const c0 = (phase + 0.5) * p; // cutter teeth sit where the wheel has spaces
    const kb = bins / TAU;
    for (let j = 0; j < nPos; j++) {
      const s = (j * L) / nPos;
      const f = pitchAt(tab, s);
      const kc = Math.round((s - c0) / p);
      for (let k = kc - 1; k <= kc + 1; k++) {
        const du0 = c0 + k * p - s;
        for (let q = 0; q < no; q++) {
          const du = du0 + U[q];
          const v = V[q];
          const x = f.x + du * f.tx + v * f.nx;
          const y = f.y + du * f.ty + v * f.ny;
          const r = hyp(x, y);
          let ang = atan2(y, x);
          if (ang < 0) ang += TAU;
          const bi = Math.min(bins - 1, Math.floor(ang * kb));
          if (r < R[bi]) {
            R[bi] = r;
            PX[bi] = x;
            PY[bi] = y;
          }
        }
      }
    }
    return { R, PX, PY };
  }

  // A wheel's tooth outline, and the same outline eroded by ch (the bottom chamfer), as two loops
  // with matching vertices: the eroded wheel is the one cut by the rack grown by ch, and both are
  // read at the same directions, so the band between them cannot cross itself.
  function toothLoops(tab, g, phase, ch, tol) {
    const bins = 7200;
    const top = cutWheel(tab, g, phase, bins);
    const ca = cos(g.alpha);
    const low = cutWheel(tab, { pitch: g.pitch, alpha: g.alpha, thin: g.thin + (2 * ch) / ca, add: g.add - ch, ded: g.ded + ch }, phase, bins);
    const idx = [];
    for (let i = 0; i < bins; i++) if (isFinite(top.R[i]) && isFinite(low.R[i])) idx.push(i);
    const dense = idx.map((i) => [top.PX[i], top.PY[i]]);
    const keep = simplifyClosed(dense, tol);
    return {
      top: keep.map((k) => dense[k]),
      low: keep.map((k) => [low.PX[idx[k]], low.PY[idx[k]]]),
    };
  }
  // Douglas-Peucker on a closed polyline; returns the indices kept.
  function simplifyClosed(pts, tol) {
    const n = pts.length;
    const keep = new Uint8Array(n);
    keep[0] = 1;
    keep[n >> 1] = 1;
    const dp = (i0, i1) => {
      const stack = [[i0, i1]];
      while (stack.length) {
        const [a, b] = stack.pop();
        if (b - a < 2) continue;
        const A = pts[a % n];
        const B = pts[b % n];
        const dx = B[0] - A[0];
        const dy = B[1] - A[1];
        const dl = hyp(dx, dy) || 1e-12;
        let best = -1;
        let bi = -1;
        for (let i = a + 1; i < b; i++) {
          const P = pts[i % n];
          const dd = Math.abs((P[0] - A[0]) * dy - (P[1] - A[1]) * dx) / dl;
          if (dd > best) {
            best = dd;
            bi = i;
          }
        }
        if (best > tol) {
          keep[bi % n] = 1;
          stack.push([a, bi], [bi, b]);
        }
      }
    };
    dp(0, n >> 1);
    dp(n >> 1, n);
    const out = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
    return out;
  }

  /* ------------------------------------------------------------- meshing check */
  // A loop that is star-shaped about its own centre, as a function: its radius in any direction.
  function polarProfile(loop) {
    const n = loop.length;
    const ang = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let a = atan2(loop[i][1], loop[i][0]);
      if (a < 0) a += TAU;
      ang[i] = a;
    }
    let i0 = 0;
    for (let i = 1; i < n; i++) if (ang[i] < ang[i0]) i0 = i;
    const A = new Float64Array(n + 1);
    const X = new Float64Array(n + 1);
    const Y = new Float64Array(n + 1);
    for (let k = 0; k <= n; k++) {
      const j = (i0 + k) % n;
      A[k] = ang[j] + (k === n ? TAU : 0);
      X[k] = loop[j][0];
      Y[k] = loop[j][1];
    }
    for (let k = 1; k <= n; k++) if (!(A[k] > A[k - 1])) throw new Error('loop is not star-shaped about its centre');
    let rmax = 0;
    for (let k = 0; k < n; k++) rmax = Math.max(rmax, hyp(X[k], Y[k]));
    function at(a) {
      a %= TAU;
      if (a < 0) a += TAU;
      if (a < A[0]) a += TAU;
      let lo = 0;
      let hi = n;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (A[mid] <= a) lo = mid;
        else hi = mid;
      }
      const dx = cos(a);
      const dy = sin(a);
      const ex = X[lo + 1] - X[lo];
      const ey = Y[lo + 1] - Y[lo];
      const den = ex * dy - ey * dx;
      if (Math.abs(den) < 1e-14) return hyp(X[lo], Y[lo]);
      const t = (X[lo] * dy - Y[lo] * dx) / -den;
      return hyp(X[lo] + t * ex, Y[lo] + t * ey);
    }
    return { at, rmax };
  }
  function densify(loop, step) {
    const out = [];
    const n = loop.length;
    for (let i = 0; i < n; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % n];
      const k = Math.max(1, Math.ceil(hyp(b[0] - a[0], b[1] - a[1]) / step));
      for (let j = 0; j < k; j++) out.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
    }
    return out;
  }
  // Time wheel at A = (-C, 0) + (ax, ay), turned clockwise by M; Kepler wheel at B = (0, 0), turned
  // anticlockwise by psi. overlaps() is true if a point of either outline (densified every 0.25 mm)
  // lies more than eps inside the other. Only points within +-w radians of the line of centres are
  // tried (the tests check this finds the same answers as trying them all).
  function makeMesher(timeLoop, keplerLoop, C, w) {
    const PT = polarProfile(timeLoop);
    const PK = polarProfile(keplerLoop);
    const wT = w || 0.5;
    const prep = (loop) => {
      const pts = densify(loop, 0.25).map((p) => {
        let a = atan2(p[1], p[0]);
        if (a < 0) a += TAU;
        return [a, p[0], p[1]];
      });
      pts.sort((u, v) => u[0] - v[0]);
      return { A: Float64Array.from(pts, (p) => p[0]), X: Float64Array.from(pts, (p) => p[1]), Y: Float64Array.from(pts, (p) => p[2]), n: pts.length };
    };
    const dT = prep(timeLoop);
    const dK = prep(keplerLoop);
    const lower = (A, a) => {
      let lo = 0;
      let hi = A.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (A[mid] < a) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };
    const visit = (D, c, fn) => {
      c = ((c % TAU) + TAU) % TAU;
      const a0 = c - wT;
      const a1 = c + wT;
      const ranges = a0 < 0 ? [[a0 + TAU, TAU], [0, a1]] : a1 > TAU ? [[a0, TAU], [0, a1 - TAU]] : [[a0, a1]];
      for (const [u, v] of ranges) {
        for (let i = lower(D.A, u); i < D.n && D.A[i] <= v; i++) if (fn(D.X[i], D.Y[i])) return true;
      }
      return false;
    };
    function overlaps(M, psi, ax, ay, eps) {
      const cT = cos(-M);
      const sT = sin(-M);
      const cK = cos(psi);
      const sK = sin(psi);
      const Ax = -C + ax;
      const Ay = ay;
      const hitT = visit(dT, M + atan2(-Ay, -Ax), (qx, qy) => {
        const wx = Ax + cT * qx - sT * qy;
        const wy = Ay + sT * qx + cT * qy;
        const r = hyp(wx, wy);
        if (r > PK.rmax) return false;
        return r < PK.at(atan2(-sK * wx + cK * wy, cK * wx + sK * wy)) - eps;
      });
      if (hitT) return true;
      return visit(dK, atan2(Ay, Ax) - psi, (qx, qy) => {
        const wx = cK * qx - sK * qy - Ax;
        const wy = sK * qx + cK * qy - Ay;
        const r = hyp(wx, wy);
        if (r > PT.rmax) return false;
        return r < PT.at(atan2(-sT * wx + cT * wy, cT * wx + sT * wy)) - eps;
      });
    }
    // The range of Kepler-wheel angles (relative to psi0) the teeth allow at time-wheel angle M,
    // or null if nothing within +-maxDev is free (the pair would bind).
    function freeRange(M, psi0, ax, ay, opt) {
      opt = opt || {};
      const eps = opt.eps || 1e-3;
      const maxDev = opt.maxDev || 0.15;
      const step = opt.step || 0.01; // outward from a free angle, overlap only grows within maxDev
      const seek = opt.seek || 0.002; // finer than the narrowest free band found (0.0025, both wheels 2 x play closer)
      let start = null;
      if (!overlaps(M, psi0, ax, ay, eps)) start = 0;
      else {
        for (let k = 1; k * seek <= maxDev && start === null; k++) {
          if (!overlaps(M, psi0 + k * seek, ax, ay, eps)) start = k * seek;
          else if (!overlaps(M, psi0 - k * seek, ax, ay, eps)) start = -k * seek;
        }
      }
      if (start === null) return null;
      const edge = (dir) => {
        let good = start;
        let bad = null;
        for (let x = start + dir * step; Math.abs(x) <= maxDev; x += dir * step) {
          if (overlaps(M, psi0 + x, ax, ay, eps)) {
            bad = x;
            break;
          }
          good = x;
        }
        if (bad === null) return good;
        for (let it = 0; it < 12; it++) {
          const mid = 0.5 * (good + bad);
          if (overlaps(M, psi0 + mid, ax, ay, eps)) bad = mid;
          else good = mid;
        }
        return good;
      };
      return { lo: edge(-1), hi: edge(1) };
    }
    return { overlaps, freeRange };
  }

  /* --------------------------------------------------------------- reading it */
  // Where a line from (ox, oy) in direction dir, shifted sideways by `side` mm, crosses the drawn
  // orbit; returned as the true anomaly it reads.
  function orbitCrossing(d, ox, oy, dir, side) {
    const ux = cos(dir);
    const uy = sin(dir);
    const sx = ox - (side || 0) * uy;
    const sy = oy + (side || 0) * ux;
    const p = d.aD * (1 - d.e * d.e);
    const S = d.F.sigma;
    const g = (t) => {
      const x = sx + t * ux;
      const y = sy + t * uy;
      return hyp(x, y) - p / (1 + d.e * cos(atan2(y, x) - S));
    };
    let lo = 0;
    let hi = 3 * d.QD;
    for (let i = 0; i < 50; i++) {
      const mid = 0.5 * (lo + hi);
      if (g(mid) < 0) lo = mid;
      else hi = mid;
    }
    const t = 0.5 * (lo + hi);
    return atan2(sy + t * uy, sx + t * ux) - S;
  }
  // The reader turns the knob until a time dot sits in the time wheel's window, then reads where
  // the Kepler wheel's window crosses the drawn orbit. Three cases, each the largest error found:
  //   teeth: both wheels centred on their pegs, the Kepler wheel anywhere its teeth allow;
  //   bores: each wheel's centre also anywhere its bore allows (the centre and 8 points on a circle
  //          of radius d.play, for each wheel, in every combination);
  //   loose: as bores, and each dot read anywhere it is still wholly inside its window.
  // Sampled at `per` points per dot interval, dot times included.
  function errorBudget(d, outlines, opt) {
    opt = opt || {};
    const per = opt.per || 3;
    const dirs = opt.dirs || 8;
    const nM = d.dots * per;
    const read = opt.read === undefined ? d.F.read : opt.read;
    const mesher = opt.mesher || makeMesher(outlines.time.top, outlines.kepler.top, d.C);
    const S = d.F.sigma;
    // the seats: the centre, and points round a circle as far out as the 24-sided bore lets the
    // wheel's centre move on its 24-sided peg (d.play, 0.54 mm for a 0.5 mm bore)
    const seats = [[0, 0]];
    for (let k = 0; k < dirs; k++) seats.push([d.play * cos((TAU * k) / dirs), d.play * sin((TAU * k) / dirs)]);
    const out = { teeth: 0, bores: 0, loose: 0, binds: 0, samples: 0, dotBores: new Array(d.dots).fill(0), dotLoose: new Array(d.dots).fill(0) };
    const sides = read ? [-read, read] : [];
    for (const dA of seats)
      for (const dB of seats) {
        const ax = dA[0] - dB[0];
        const ay = dA[1] - dB[1];
        const centred = !dA[0] && !dA[1] && !dB[0] && !dB[1];
        for (let i = 0; i < nM; i++) {
          const Mread = (TAU * i) / nM;
          const truth = trueFromMean(Mread, d.e);
          const X = d.rT * cos(S - Mread) - dA[0];
          const Y = d.rT * sin(S - Mread) - dA[1];
          const dist = hyp(X, Y);
          for (const st of [0].concat(sides)) {
            const Mw = S - (atan2(Y, X) + asin(st / dist));
            const th0 = trueFromMean(Mw, d.e);
            const r = mesher.freeRange(Mw, th0, ax, ay);
            out.samples++;
            if (!r) {
              out.binds++;
              continue;
            }
            for (const psi of [th0 + r.lo, th0 + r.hi])
              for (const sk of st ? [-read, read] : [0].concat(sides)) {
                const err = Math.abs(wrapPi(orbitCrossing(d, dB[0], dB[1], S + psi, sk) - truth));
                const tight = !st && !sk;
                if (tight && centred) out.teeth = Math.max(out.teeth, err);
                if (tight) out.bores = Math.max(out.bores, err);
                out.loose = Math.max(out.loose, err);
                if (i % per === 0) {
                  const k = i / per;
                  if (tight) out.dotBores[k] = Math.max(out.dotBores[k], err);
                  out.dotLoose[k] = Math.max(out.dotLoose[k], err);
                }
              }
          }
        }
      }
    // Is every reading nearer its own dot than either neighbour? margin = smallest (half gap - error).
    const th = [];
    for (let k = 0; k < d.dots; k++) th.push(trueFromMean((TAU * k) / d.dots, d.e));
    const half = th.map((t, k) => 0.5 * Math.min(wrapPi(th[(k + 1) % d.dots] - t) || TAU, wrapPi(t - th[(k - 1 + d.dots) % d.dots]) || TAU));
    out.marginBores = Math.min(...half.map((h, k) => h - out.dotBores[k]));
    out.marginLoose = Math.min(...half.map((h, k) => h - out.dotLoose[k]));
    out.halfGap = half;
    return out;
  }

  /* ------------------------------------------------------------------ design */
  // The fit table (clearance per side, mm) every clearance in the object is taken from.
  const FIT = { snug: [0.15, 0.25], sliding: [0.3, 0.4], rotating: [0.5, Infinity] };
  const FIXED = {
    alpha: (25 * Math.PI) / 180, // rack pressure angle
    module: 4.2, // target module; the tooth count is the whole number nearest to it
    tol: 0.1, // largest departure of a printed tooth polygon from the cut envelope
    H: 6, // wheel thickness
    chamfer: 0.4, // bottom-edge chamfer: 0.4 mm in ...
    chamferH: 0.5, // ... over 0.5 mm up (39 degrees from vertical)
    pegR: 4, // pegs are 8 mm across
    bossH: 1, // the wheels ride 1 mm above the dials, on a boss round each peg
    baseT: 3, // plate thickness
    engrave: 0.6, // dot depth
    band: 2.4, // rim below the tooth roots (measured radially; the tests check the true minimum)
    spokeHalf: 3, // the spoke is 6 mm wide
    slotHalf: 1, // with a 2 mm window down it
    hubWallK: 2.4, // Kepler wheel hub wall
    hubWallT: 6, // time wheel hub wall (it carries the knob)
    collarH: 6, // the Kepler wheel's collar makes its bearing 12 mm long
    knobH: 10,
    dot: 1.4, // dial dots are 1.4 mm squares; each dial's zero dot has a twin 2 mm further out
    twin: 2.0,
    read: 0.3, // a 1.4 mm dot is wholly inside a 2 mm window while within 0.3 mm of its centre line
    margin: 3,
    cornerR: 6,
    sigma: Math.PI / 2, // both spokes point up at perihelion
    // The Kepler wheel is lopsided and rests only on the boss round its peg, so its centre of mass
    // must stay this far inside the boss's flats even with the wheel pushed as far as its bore
    // allows towards its heavy side; a counterweight on its light half, in whole 0.2 mm layers and
    // up to 8 mm tall (2 mm above the collar), makes up what the shape does not.
    steady: 1.0,
    weightMax: 8,
  };
  const OPTIONS = {
    bodies: ['mercury', 'mars', 'earth', 'pluto'],
    C: { step: 2, def: 70 },
    bore: { values: [0.5, 0.6, 0.7], def: 0.5 },
  };
  function cRange(body) {
    const b = BODIES[body] || BODIES.mercury;
    const out = [];
    for (let c = b.C[0]; c <= b.C[1]; c += OPTIONS.C.step) out.push(c);
    return out;
  }
  // Tooth flanks: a sliding fit, widened so the teeth still clear when both wheels sit 2 x bore
  // closer together (each against its peg, towards the other). Tip: likewise from the rotating fit.
  function flankFor(bore) {
    return Math.ceil(Math.max(FIT.sliding[0], 2 * bore * sin(FIXED.alpha) + 0.05) * 100 - 1e-9) / 100;
  }
  function tipFor(bore) {
    return Math.round((2 * bore + 0.45) * 100) / 100;
  }

  function design(input) {
    input = input || {};
    const bodyKey = BODIES[input.body] ? input.body : 'mercury';
    const body = BODIES[bodyKey];
    const cs = cRange(bodyKey);
    let C = Math.round(+input.C);
    if (!cs.includes(C)) C = cs.includes(OPTIONS.C.def) ? OPTIONS.C.def : cs[cs.length - 1];
    const bore = OPTIONS.bore.values.includes(+input.bore) ? +input.bore : OPTIONS.bore.def;
    const e = body.e;
    const F = FIXED;
    const pc = pitchCurves(e, C, 4096);
    const L = pc.K.L;
    const N = Math.max(12, Math.round(L / (Math.PI * F.module)));
    const pitch = L / N;
    const m = pitch / Math.PI;
    const flank = flankFor(bore);
    const tip = tipFor(bore);
    const add = m;
    const ded = m + tip;
    const boreR = F.pegR + bore;
    // The peg's corners are on pegR and the bore's flats on boreR (both 24-sided), so the gap is
    // `bore` everywhere round it, but a wheel's centre can move further where a corner of the bore
    // faces a corner of the peg: up to boreR / cos(pi/24) - pegR.
    const play = boreR / cos(Math.PI / 24) - F.pegR;
    const hubK = boreR + F.hubWallK;
    const hubT = boreR + F.hubWallT;
    const r2min = keplerPitchR(0, e, C);
    const r2max = keplerPitchR(Math.PI, e, C);
    const r1min = C - r2max;
    const r1max = C - r2min;
    const rinK = (beta) => keplerPitchR(Math.PI - beta, e, C) - ded - F.band;
    const rinT = (gamma) => C - keplerPitchR(trueFromMean(gamma, e), e, C) - ded - F.band;
    const rinKmin = r2min - ded - F.band;
    const rinTmin = r1min - ded - F.band;
    const hd = (F.dot / 2) * Math.SQRT2; // half-diagonal of a dot
    // the drawn orbit: as large as the Kepler wheel's open middle allows, with the aphelion dot and
    // the perihelion twin each 1 mm clear of the rim at its narrowest
    const aD = Math.min((rinKmin - hd - 1) / (1 + e), (rinKmin - hd - 1 - F.twin) / (1 - e));
    const qD = aD * (1 - e);
    const QD = aD * (1 + e);
    // the time dial: its zero dot's twin also 1 mm clear of the time wheel's rim
    const rT = rinTmin - F.twin - hd - 1;
    // The Kepler wheel's light half (from its spoke round, anticlockwise, to the opposite direction,
    // the half that touches the time wheel near perihelion) is solid from the rim in to a circle of
    // radius rinKmin, the open middle the dial needs: no dot is ever hidden, and the wheel is less
    // lopsided.
    const fillK = { R: rinKmin, end: Math.PI };
    const slotK = [hubK + 0.8, rinK(F.sigma) - 0.8];
    const slotT = [hubT + 0.8, rinT(F.sigma) - 0.8];
    const outK = r2max + add;
    const outT = r1max + add;
    const plate = {
      x0: -C - outT - F.margin,
      x1: outK + F.margin,
      y0: -Math.max(outK, outT) - F.margin,
      y1: Math.max(outK, outT) + F.margin,
    };
    const problems = [];
    if (qD - hd < hubK + 0.5) problems.push('the drawn orbit would hide under the Kepler wheel hub');
    if (rT - hd < hubT + 0.5) problems.push('the time dial would hide under the knob');
    if (plate.x1 - plate.x0 > 180 || plate.y1 - plate.y0 > 180) problems.push('the plate is larger than a 180 mm bed');
    return {
      body: bodyKey,
      name: body.name,
      e,
      P: body.P,
      a: body.a,
      dots: body.dots,
      C,
      bore,
      flank,
      tip,
      N,
      pitch,
      m,
      add,
      ded,
      alpha: F.alpha,
      boreR,
      play,
      hubK,
      hubT,
      bossK: hubK - 0.4, // the bosses the wheels rest on (24-sided, corners on these radii)
      bossT: hubT - 0.6,
      fillK,
      collarR: hubK - 0.6,
      knobR: hubT - 0.6,
      r1min,
      r1max,
      r2min,
      r2max,
      rinK,
      rinT,
      rinKmin,
      rinTmin,
      aD,
      qD,
      QD,
      rT,
      slotK,
      slotT,
      outK,
      outT,
      plate,
      pc,
      problems,
      F,
      z: { base: F.baseT, wheel: F.baseT + F.bossH, pegB: F.baseT + F.bossH + F.H + F.collarH - 0.5, pegA: F.baseT + F.bossH + F.H + F.knobH - 0.5 },
    };
  }

  /* ------------------------------------------------------------ 2D outlines */
  function circleLoop(r, n, cx, cy, circumscribe, phase) {
    const R = circumscribe ? r / cos(Math.PI / n) : r;
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = (phase || 0) + (TAU * i) / n;
      out.push([(cx || 0) + R * cos(a), (cy || 0) + R * sin(a)]);
    }
    return out;
  }
  function rot(p, a) {
    const c = cos(a);
    const s = sin(a);
    return [c * p[0] - s * p[1], s * p[0] + c * p[1]];
  }
  // The open middle of a wheel: between hub and rim, less the spoke (at local angle sigma).
  // With `fill`, from the spoke's anticlockwise side round to local angle sigma + fill.end it stops
  // at a circle of radius fill.R (no larger than the rim there), so the wheel is solid between that
  // circle and its rim. Returned clockwise, as a hole.
  function cavityLoop(rin, hubR, hw, sigma, stepDeg, fill) {
    const rinE = (a) => {
      if (!fill) return rin(a);
      let u = a - sigma;
      u -= TAU * Math.floor(u / TAU);
      return u < fill.end ? Math.min(rin(a), fill.R) : rin(a);
    };
    const edgeX = (sgn) => {
      let lo = Math.sqrt(hubR * hubR - hw * hw);
      let hi = 200;
      for (let i = 0; i < 80; i++) {
        const x = 0.5 * (lo + hi);
        if (hyp(x, hw) < rinE(atan2(sgn * hw, x) + sigma)) lo = x;
        else hi = x;
      }
      return lo;
    };
    const a1 = atan2(hw, edgeX(1)) + sigma;
    const a2 = atan2(-hw, edgeX(-1)) + sigma + TAU;
    const pts = [];
    const ah = asin(hw / hubR);
    pts.push(rot([hubR * cos(ah), hubR * sin(ah)], sigma));
    let a0 = a1;
    if (fill) {
      // the circle, a vertex every 4 degrees or less (its chords come within 0.02 mm of it),
      // then straight out to the rim
      const ae = sigma + fill.end;
      const nf = Math.max(2, Math.ceil((ae - a1) / (Math.PI / 45)));
      for (let k = 0; k <= nf; k++) {
        const a = a1 + ((ae - a1) * k) / nf;
        pts.push([fill.R * cos(a), fill.R * sin(a)]);
      }
      a0 = ae;
    }
    const nr = Math.max(8, Math.ceil((a2 - a0) / ((stepDeg * Math.PI) / 180)));
    for (let k = 0; k <= nr; k++) {
      const a = a0 + ((a2 - a0) * k) / nr;
      const r = rin(a);
      pts.push([r * cos(a), r * sin(a)]);
    }
    pts.push(rot([hubR * cos(-ah), hubR * sin(-ah)], sigma));
    // the hub side: circumscribed chords, so the hub wall is never thinner than drawn
    const nh = Math.max(4, Math.ceil((TAU - 2 * ah) / (Math.PI / 10)));
    const Rh = hubR / cos((TAU - 2 * ah) / nh / 2);
    for (let k = 1; k < nh; k++) {
      const a = -ah - ((TAU - 2 * ah) * k) / nh + sigma;
      pts.push([Rh * cos(a), Rh * sin(a)]);
    }
    return pts.reverse();
  }
  function slotLoop(r0, r1, hw, sigma) {
    return [
      [r0, -hw],
      [r1, -hw],
      [r1, hw],
      [r0, hw],
    ]
      .map((p) => rot(p, sigma))
      .reverse();
  }
  // Tooth outlines of both wheels, in their own frames.
  function wheelOutlines(d) {
    const g = { pitch: d.pitch, alpha: d.alpha, thin: d.flank / cos(d.alpha), add: d.add, ded: d.ded };
    return {
      kepler: toothLoops(d.pc.K, g, 0, d.F.chamfer, d.F.tol),
      time: toothLoops(d.pc.T, g, 0.5, d.F.chamfer, d.F.tol),
    };
  }
  function knobLoop(r, flutes) {
    const out = [];
    for (let i = 0; i < 2 * flutes; i++) {
      const a = (Math.PI * i) / flutes;
      const rr = i % 2 ? r - 0.6 : r;
      out.push([rr * cos(a), rr * sin(a)]);
    }
    return out;
  }
  // Area and first moments of a closed loop (signed: positive if anticlockwise).
  function loopMoments(L) {
    let A = 0;
    let Sx = 0;
    let Sy = 0;
    for (let i = 0, n = L.length; i < n; i++) {
      const p = L[i];
      const q = L[(i + 1) % n];
      const c = p[0] * q[1] - q[0] * p[1];
      A += c;
      Sx += (p[0] + q[0]) * c;
      Sy += (p[1] + q[1]) * c;
    }
    return { A: A / 2, Sx: Sx / 6, Sy: Sy / 6 };
  }
  // Volume and first moments of a prism h tall on a face (outer loop, then holes; any winding).
  function prism(loops, h) {
    let V = 0;
    let Mx = 0;
    let My = 0;
    loops.forEach((L, i) => {
      const m = loopMoments(L);
      const s = (i ? -1 : 1) * (m.A < 0 ? -1 : 1);
      V += s * m.A * h;
      Mx += s * m.Sx * h;
      My += s * m.Sy * h;
    });
    return { V, Mx, My };
  }
  // A wheel's centre of mass, horizontally, from the prisms it is made of (the 0.4 mm bottom
  // chamfers are left out; parts.test.mjs checks the solids agree), and how far it lies inside the
  // flats of the boss the wheel rests on.
  function balance(w, H, bossR, weightH) {
    const parts = [prism([w.outer, w.cavity, w.slot, w.bore], H), prism([w.top, w.bore], w.topH)];
    if (weightH) parts.push(prism([w.weight], weightH));
    let V = 0;
    let Mx = 0;
    let My = 0;
    for (const p of parts) {
      V += p.V;
      Mx += p.Mx;
      My += p.My;
    }
    const x = Mx / V;
    const y = My / V;
    return { V, x, y, off: hyp(x, y), inside: bossR * cos(Math.PI / 24) - hyp(x, y) };
  }
  // The counterweight's footprint on the Kepler wheel's light half: from 0.4 mm outside the open
  // middle's circle to 0.8 mm inside the tooth roots, clear of the spoke and of the open middle's
  // step back out to the rim. Anticlockwise.
  function weightLoop(d) {
    const F = d.F;
    const a0 = F.sigma + Math.PI / 8;
    const a1 = F.sigma + d.fillK.end - 0.1;
    const n = Math.ceil((a1 - a0) / (Math.PI / 30)); // a vertex every 6 degrees
    const inner = [];
    const outer = [];
    for (let k = 0; k <= n; k++) {
      const a = a0 + ((a1 - a0) * k) / n;
      const ri = d.fillK.R + 0.4;
      const ro = d.rinK(a) + F.band - 0.8;
      inner.push([ri * cos(a), ri * sin(a)]);
      outer.push([ro * cos(a), ro * sin(a)]);
    }
    return outer.concat(inner.reverse());
  }
  function wheel2D(d, which, teeth) {
    const F = d.F;
    const isK = which === 'kepler';
    const hubR = isK ? d.hubK : d.hubT;
    const slot = isK ? d.slotK : d.slotT;
    const w = {
      outer: teeth.top,
      outerLow: teeth.low,
      cavity: cavityLoop(isK ? d.rinK : d.rinT, hubR, F.spokeHalf, F.sigma, 10, isK ? d.fillK : null),
      slot: slotLoop(slot[0], slot[1], F.slotHalf, F.sigma),
      bore: circleLoop(d.boreR, 24, 0, 0, true).reverse(),
      top: isK ? circleLoop(d.collarR, 24) : knobLoop(d.knobR, 12),
      topH: isK ? F.collarH : F.knobH,
      weight: null,
      weightH: 0,
    };
    const bossR = isK ? d.bossK : d.bossT;
    const need = F.steady + d.play;
    if (isK) {
      // the least counterweight, in whole 0.2 mm layers up to weightMax, that keeps the
      // centre of mass `need` inside the boss's flats, with 0.05 mm to spare for the chamfers this
      // calculation leaves out (they move it by up to 0.02 mm)
      w.weight = weightLoop(d);
      let k = 0;
      while (k < F.weightMax * 5 && balance(w, F.H, bossR, k / 5).inside < need + 0.05) k++;
      w.weightH = k / 5;
      if (!w.weightH) w.weight = null;
    }
    w.balance = balance(w, F.H, bossR, w.weightH);
    w.balance.need = need;
    w.balance.steady = w.balance.inside >= need;
    return w;
  }
  // Dial dots on the plate, at equal steps of time: the Kepler dots on the drawn orbit round B
  // (the Sun), the time dots on a circle round A. Each dial's zero dot (perihelion) has a twin.
  function dialDots(d) {
    const F = d.F;
    const K = [];
    const T = [];
    for (let k = 0; k < d.dots; k++) {
      const M = (TAU * k) / d.dots;
      const th = trueFromMean(M, d.e);
      const r = (d.aD * (1 - d.e * d.e)) / (1 + d.e * cos(th));
      const ang = F.sigma + th;
      const at = F.sigma - M;
      for (const t of k ? [0] : [0, F.twin]) {
        K.push({ k, x: (r + t) * cos(ang), y: (r + t) * sin(ang), ang, size: F.dot });
        T.push({ k, x: -d.C + (d.rT + t) * cos(at), y: (d.rT + t) * sin(at), ang: at, size: F.dot });
      }
    }
    return { K, T };
  }
  function dotLoop(dot) {
    const h = dot.size / 2;
    return [
      [-h, -h],
      [h, -h],
      [h, h],
      [-h, h],
    ].map((p) => {
      const q = rot(p, dot.ang);
      return [dot.x + q[0], dot.y + q[1]];
    });
  }
  function roundedRect(x0, y0, x1, y1, r, seg) {
    const out = [];
    const corners = [
      [x1 - r, y0 + r, -Math.PI / 2],
      [x1 - r, y1 - r, 0],
      [x0 + r, y1 - r, Math.PI / 2],
      [x0 + r, y0 + r, Math.PI],
    ];
    for (const [cx, cy, a0] of corners)
      for (let i = 0; i <= seg; i++) {
        const a = a0 + ((Math.PI / 2) * i) / seg;
        out.push([cx + r * cos(a), cy + r * sin(a)]);
      }
    return out;
  }

  /* ------------------------------------------------------------------ solids */
  // Every solid is a stack of closed loops joined by walls; each horizontal face is a cap. The caps
  // are recorded (with their loops and height) so the tests can check them.
  function wheelMesh(w, F) {
    const mb = new Mesh.MeshBuilder();
    const c = F.chamfer;
    const ch = F.chamferH;
    const loops = [w.outer, w.cavity, w.slot, w.bore];
    const low = [w.outerLow].concat(loops.slice(1).map((L) => Mesh.offsetLoop(L, c)));
    mb.cap(low, 0, false);
    loops.forEach((L, i) => mb.wall(low[i], 0, L, ch));
    for (let i = 0; i < 3; i++) mb.wall(loops[i], ch, loops[i], F.H);
    mb.wall(w.bore, ch, w.bore, F.H + w.topH);
    const topHoles = [w.cavity, w.slot, w.top.slice().reverse()];
    if (w.weightH) topHoles.push(w.weight.slice().reverse());
    mb.cap([w.outer].concat(topHoles), F.H, true);
    mb.wall(w.top, F.H, w.top, F.H + w.topH);
    mb.cap([w.top, w.bore], F.H + w.topH, true);
    if (w.weightH) {
      mb.wall(w.weight, F.H, w.weight, F.H + w.weightH);
      mb.cap([w.weight], F.H + w.weightH, true);
    }
    return mb;
  }
  // A boss (z0 .. z0 + bossH; none if bossR is 0) and a peg to `top`, with a 0.8 mm cone at its tip.
  function pegInto(mb, cx, cy, F, bossR, z0, top, holes) {
    const peg = circleLoop(F.pegR, 24, cx, cy);
    const pegTop = circleLoop(F.pegR - 0.8, 24, cx, cy);
    let zp = z0;
    if (bossR) {
      const boss = circleLoop(bossR, 24, cx, cy);
      holes.push(boss.slice().reverse());
      mb.wall(boss, z0, boss, z0 + F.bossH);
      mb.cap([boss, peg.slice().reverse()], z0 + F.bossH, true);
      zp = z0 + F.bossH;
    } else holes.push(peg.slice().reverse());
    mb.wall(peg, zp, peg, top - 0.8);
    mb.wall(peg, top - 0.8, pegTop, top);
    mb.cap([pegTop], top, true);
  }
  function baseMesh(d) {
    const F = d.F;
    const P = d.plate;
    const mb = new Mesh.MeshBuilder();
    const T = F.baseT;
    const outline = roundedRect(P.x0, P.y0, P.x1, P.y1, F.cornerR, 6);
    const low = Mesh.offsetLoop(outline, F.chamfer);
    mb.cap([low], 0, false);
    mb.wall(low, 0, outline, F.chamferH);
    mb.wall(outline, F.chamferH, outline, T);
    const holes = [];
    const dots = dialDots(d);
    for (const dot of dots.K.concat(dots.T)) {
      const L = dotLoop(dot);
      const H = L.slice().reverse();
      holes.push(H);
      mb.wall(H, T - F.engrave, H, T);
      mb.cap([L], T - F.engrave, true);
    }
    pegInto(mb, 0, 0, F, d.bossK, T, d.z.pegB, holes);
    pegInto(mb, -d.C, 0, F, d.bossT, T, d.z.pegA, holes);
    mb.cap([outline].concat(holes), T, true);
    return mb;
  }
  // Calibration coupon: one peg of the same section as the real ones, on a little plate, and one ring
  // for each bore clearance on offer, made exactly like a wheel's bore and told apart by 1, 2 or 3
  // notches.
  function couponMesh() {
    const F = FIXED;
    const mb = new Mesh.MeshBuilder();
    const T = 2.4;
    const outline = roundedRect(-12, -12, 12, 12, 4, 4);
    const low = Mesh.offsetLoop(outline, F.chamfer);
    mb.cap([low], 0, false);
    mb.wall(low, 0, outline, F.chamferH);
    mb.wall(outline, F.chamferH, outline, T);
    const holes = [];
    pegInto(mb, 0, 0, F, 0, T, T + F.H + 2, holes); // the rings rest on the plate
    mb.cap([outline].concat(holes), T, true);
    OPTIONS.bore.values.forEach((cl, i) => {
      const cx = 24 + 20 * i;
      const outer = [];
      for (let k = 0; k < 8; k++) {
        const a0 = (TAU * k) / 8 - Math.PI / 8;
        const a1 = a0 + TAU / 8;
        const R = 8.5;
        const p0 = [R * cos(a0), R * sin(a0)];
        const p1 = [R * cos(a1), R * sin(a1)];
        outer.push(p0);
        if (k <= i) {
          const mx = (p0[0] + p1[0]) / 2;
          const my = (p0[1] + p1[1]) / 2;
          const tl = hyp(p1[0] - p0[0], p1[1] - p0[1]);
          const tx = (p1[0] - p0[0]) / tl;
          const ty = (p1[1] - p0[1]) / tl;
          const ml = hyp(mx, my);
          outer.push([mx - 0.8 * tx, my - 0.8 * ty], [mx - (1.0 * mx) / ml, my - (1.0 * my) / ml], [mx + 0.8 * tx, my + 0.8 * ty]);
        }
      }
      const bore = circleLoop(F.pegR + cl, 24, 0, 0, true).reverse();
      const loops = [outer, bore].map((L) => L.map((p) => [p[0] + cx, p[1]]));
      const lowL = loops.map((L) => Mesh.offsetLoop(L, F.chamfer));
      mb.cap(lowL, 0, false);
      loops.forEach((L, j) => {
        mb.wall(lowL[j], 0, L, F.chamferH);
        mb.wall(L, F.chamferH, L, F.H);
      });
      mb.cap(loops, F.H, true);
    });
    return mb;
  }

  function buildParts(d, outlines) {
    outlines = outlines || wheelOutlines(d);
    const wk = wheel2D(d, 'kepler', outlines.kepler);
    const wt = wheel2D(d, 'time', outlines.time);
    return {
      base: baseMesh(d),
      time: wheelMesh(wt, d.F),
      kepler: wheelMesh(wk, d.F),
      coupon: couponMesh(),
      outlines,
      wk,
      wt,
    };
  }

  return {
    TAU,
    DEG,
    trig: { sin, cos, atan2, tan, asin },
    BODIES,
    wrapPi,
    eccentricAnomaly,
    trueFromEcc,
    eccFromTrue,
    trueFromMean,
    meanFromTrue,
    rate,
    radius,
    ellipsePairTrue,
    keplerPitchR,
    timePitchR,
    pitchCurves,
    pitchAt,
    cutWheel,
    toothLoops,
    simplifyClosed,
    polarProfile,
    densify,
    makeMesher,
    orbitCrossing,
    errorBudget,
    FIT,
    FIXED,
    OPTIONS,
    cRange,
    flankFor,
    tipFor,
    design,
    wheelOutlines,
    wheel2D,
    balance,
    prism,
    dialDots,
    dotLoop,
    roundedRect,
    circleLoop,
    buildParts,
    couponMesh,
    Mesh,
  };
});
