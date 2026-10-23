/* The Honey Brake: feasibility model.
 * One file, no dependencies. It runs as a classic <script> in the page (global HoneyBrake)
 * and in Node (module.exports / vm). Every number quoted in index.html and README.md comes
 * from quoted() below, and check.mjs recomputes them with separately written code.
 *
 * Units are SI unless a name says otherwise. The two numerical solvers (the gap field and
 * the eddy currents in the ring) work internally in millimetres, because their only output
 * is a dimensionless shape factor.
 */
const HoneyBrake = (() => {
  'use strict';
  // Local aliases: global lookups are slow inside Node's vm sandbox, which build.mjs and check.mjs use.
  const Math = globalThis.Math;
  const Float64Array = globalThis.Float64Array;
  const Map = globalThis.Map;

  // ---------------------------------------------------------------- physical constants
  const PHYS = {
    g: 9.80665,                 // m/s^2
    mu0: 4e-7 * Math.PI,        // H/m
    sigmaIACS: 5.8e7,           // S/m, 100 % IACS (annealed copper standard)
    muRec: 1.05,                // recoil permeability of sintered NdFeB
    rhoNd: 7500,                // kg/m^3 sintered NdFeB
    rhoSteel: 7850,             // kg/m^3 low-carbon steel (back yokes)
    rhoAl: 2700,                // kg/m^3 aluminium (jaws)
    eAl: 69e9,                  // Pa, Young's modulus of aluminium
    bSteelMax: 1.5,             // T, flux density the yokes are sized for
    kAir: 0.026,                // W/m K
    nuAir: 1.6e-5,              // m^2/s
    prAir: 0.71,
  };

  // Conductor choices for the ring. iacs = conductivity as a fraction of the copper standard at 20 C,
  // alpha = temperature coefficient of resistivity (1/K).
  const ALLOYS = {
    '6061-T6': { iacs: 0.43, rho: 2700, cp: 900, alpha: 0.0040, label: 'aluminium 6061-T6' },
    '1100-H14': { iacs: 0.57, rho: 2710, cp: 900, alpha: 0.0040, label: 'aluminium 1100-H14' },
    'C110': { iacs: 1.0, rho: 8940, cp: 385, alpha: 0.0039, label: 'copper C110' },
  };

  // Sintered NdFeB: typical remanence Br at 20 C in tesla (datasheet spreads are about +-0.03 T),
  // and the maximum working temperature of the grade.
  const GRADES = {
    N42: { br: 1.30, tMax: 80 },
    N52: { br: 1.44, tMax: 80 },
    N42SH: { br: 1.30, tMax: 150 },
  };

  // ---------------------------------------------------------------- base case
  const BASE = {
    massTotal: 100,      // kg: rider + chair + bag
    slopeRun: 12,        // slope written as 1:slopeRun (1:12 is the ADA maximum for new ramps)
    crr: 0.012,          // rolling-resistance coefficient of the whole chair on smooth hard ground
    wheelDia: 0.610,     // m, 24-inch rear wheel (ISO 540 rim) tyre outside diameter
    wheelInertia: 0.15,  // kg m^2 per rear wheel (rim, tyre, spokes, handrim)
    ringOD: 0.380,       // m, outer diameter of the aluminium disc's braking ring
    ringW: 0.060,        // m, radial width of the ring (the poles run along its centre line)
    ringT: 0.005,        // m, ring (plate) thickness
    spokes: 6,           // plate spokes joining the ring to a hub flange (one laser-cut part)
    spokeW: 0.020,       // m
    hubOD: 0.100,        // m
    hubID: 0.060,        // m
    alloy: '6061-T6',
    grade: 'N52',
    magA: 0.025,         // m, square pole face side
    magL: 0.010,         // m, magnet length along its magnetisation (one magnet; two per pole)
    clearance: 0.002,    // m, running clearance between the ring and each pole face
    pairs: 6,            // pole positions per wheel (one magnet each side), alternating, even
    pitch: 0.032,        // m, centre-to-centre spacing of the poles along the arc
    eta: 0.90,           // allowance for what the idealised field model leaves out (see 3.3)
    tempRise: 0,         // K, ring temperature above 20 C
    hConv: 8,            // W/m^2 K, heat transfer from the moving disc (see 3.6)
    barW: 0.040,         // m, yoke width (radial), wider than the magnets to keep the yoke thin
    jawT: 0.006,         // m, aluminium jaw plate holding the yokes
    fittingsMass: 0.15,  // kg, slide, lever share, fasteners (estimate)
    magnetUSD: 5,        // $ per 25 x 25 x 10 mm N52 block, one-off (estimate, not a quote)
    ringUSD: 40,         // $ laser-cut 5 mm 6061 disc, one-off
    steelUSD: 20,        // $ yoke steel
    structureUSD: 60,    // $ jaws, slide, lever, cable, fasteners
  };

  // Numerical settings for the two solvers (millimetres).
  const NUM = { h: 1, margin: 50, cutoff: 50, nImg: 8, tol: 1e-9 };

  // Copper-pipe kitchen check: a magnet SPHERE (whose outside field is exactly a dipole)
  const PIPE = {
    sphereD: 0.0127,     // m, 1/2-inch sphere
    grade: 'N42',
    pipeOD: 0.015875,    // m, 1/2-inch type L copper tube, 0.625 in outside
    pipeID: 0.01384,     // m, 0.545 in bore (wall 1.02 mm)
    iacs: 0.85,          // plumbing copper (C12200, phosphorus-deoxidised) is roughly 85 % IACS
    length: 1.5,         // m, pipe length
  };

  // The first experiment: a braked wheel driven by falling weights.
  const EXP = {
    m1: 2,               // kg, light weight
    m2: 4,               // kg, heavy weight
    friction: 0.3,       // N at the tyre, bearing + string (cancels in the two-weight method)
    runUp: 0.5,          // m, fall before the first mark
    timed: 1.0,          // m, between the marks
    fps: 240,            // phone slow-motion video
    vTarget: 1.25,       // m/s, the most the brake may allow on 1:12 (a brisk walk, 4.5 km/h)
    maxPairs: 10,        // the largest bracket I'd accept (115 degrees of arc)
    costUSD: 200,        // whole kit, one wheel (see section 8)
  };

  // ADA ramp run: 1:12 slope, 30 in (0.76 m) of rise between landings
  const RAMP = { run: 9.144, v0: 0.5 };

  const SLOPES = [
    { run: 20, name: '1:20' },
    { run: 12, name: '1:12' },
    { run: 8, name: '1:8' },
    { run: 5, name: '1:5' },
  ];

  // ---------------------------------------------------------------- helpers
  function merge(p) {
    return Object.assign({}, BASE, p || {});
  }
  function sigmaOf(p) {
    const a = ALLOYS[p.alloy] || ALLOYS['6061-T6'];
    return (a.iacs * PHYS.sigmaIACS) / (1 + a.alpha * p.tempRise);
  }
  function brOf(p) {
    return (GRADES[p.grade] || GRADES.N52).br;
  }

  // ---------------------------------------------------------------- 3.1 the hill's push
  function hill(p) {
    p = merge(p);
    const theta = Math.atan(1 / p.slopeRun);
    const W = p.massTotal * PHYS.g;
    const fDown = W * Math.sin(theta);
    const fRoll = W * Math.cos(theta) * p.crr;
    return { theta, thetaDeg: (theta * 180) / Math.PI, gradePct: 100 / p.slopeRun, weight: W, fDown, fRoll, fNet: fDown - fRoll };
  }

  // ---------------------------------------------------------------- 3.2 the gap field
  // 1-D magnetic circuit: two magnets in series round a loop with two gaps, ideal iron.
  // Ampere (no free current) + flux continuity + recoil line B = Br + mu0 muRec H.
  function circuit(p) {
    p = merge(p);
    const Br = brOf(p);
    const Lm = 2 * p.magL;                    // m, magnet length per gap
    const g = p.ringT + 2 * p.clearance;      // m, gap: ring plus two clearances (aluminium is non-magnetic)
    const bClosed = Br / (1 + (PHYS.muRec * g) / Lm);
    const bClosed1 = Br / (1 + g / Lm);       // same with muRec = 1, the normalisation of the 3-D solve
    return { Br, Lm, g, bClosed, bClosed1, muScale: bClosed / bClosed1 };
  }

  // Field of ONE pole position (top magnet's face +M at z=+g2, bottom magnet's face -M at z=-g2),
  // between ideal back iron at z = +-D (D = g2 + Lm1). Magnetic charge sheets plus their images in
  // the two iron planes; muRec = 1. Returns the downward field as a fraction of Br. All in mm.
  function omegaRect(x1, x2, y1, y2, h) {
    const f = (x, y) => Math.atan2(x * y, h * Math.sqrt(x * x + y * y + h * h));
    return f(x2, y2) - f(x1, y2) - f(x2, y1) + f(x1, y1);
  }
  function poleB(x, y, z, a, g2, Lm1, nImg) {
    const D = g2 + Lm1;
    let s = 0;
    const add = (q, zq) => {
      const hgt = Math.abs(z - zq);
      if (hgt < 1e-12) return;
      const om = omegaRect(-a / 2 - x, a / 2 - x, -a / 2 - y, a / 2 - y, hgt);
      s += (q * om * (zq > z ? 1 : -1)) / (4 * Math.PI);
    };
    for (let n = -nImg; n <= nImg; n++) {
      add(1, g2 + 4 * n * D);
      add(-1, 2 * D - g2 + 4 * n * D);
      add(-1, -g2 + 4 * n * D);
      add(1, 2 * D + g2 + 4 * n * D);
    }
    return s;
  }

  // Thin-sheet eddy currents at low magnetic Reynolds number. Cell-centred potential phi on an
  // nx-by-ny grid (spacing h); the sheet moves along +x at unit speed with unit conductivity and
  // thickness; Bf holds the field on the horizontal cell faces (row jf = 0..ny, edges carry no current).
  // Ohm's law J = E_s - grad(phi) with E_s = v x B = -B y-hat; div J = 0; solved by conjugate gradients.
  // Returns the drag (positive) and the dissipation, which must be equal.
  function sheetSolve(Bf, nx, ny, h, tol) {
    const N = nx * ny;
    const rhs = new Float64Array(N);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const top = j + 1 < ny ? -Bf[(j + 1) * nx + i] : 0;
        const bot = j > 0 ? -Bf[j * nx + i] : 0;
        rhs[j * nx + i] = -h * (top - bot);
      }
    }
    let mean = 0;
    for (let k = 0; k < N; k++) mean += rhs[k];
    mean /= N;
    for (let k = 0; k < N; k++) rhs[k] -= mean;
    const L = (u, out) => {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const k = j * nx + i;
          const c = u[k];
          let s = 0;
          if (i > 0) s += c - u[k - 1];
          if (i < nx - 1) s += c - u[k + 1];
          if (j > 0) s += c - u[k - nx];
          if (j < ny - 1) s += c - u[k + nx];
          out[k] = s;
        }
      }
    };
    const phi = new Float64Array(N);
    const r = Float64Array.from(rhs);
    const d = Float64Array.from(rhs);
    const Ad = new Float64Array(N);
    let rr = 0;
    for (let k = 0; k < N; k++) rr += r[k] * r[k];
    const r0 = Math.sqrt(rr) || 1;
    let it = 0;
    for (; it < 20000; it++) {
      L(d, Ad);
      let dAd = 0;
      for (let k = 0; k < N; k++) dAd += d[k] * Ad[k];
      const alpha = rr / dAd;
      let rr2 = 0;
      for (let k = 0; k < N; k++) {
        phi[k] += alpha * d[k];
        r[k] -= alpha * Ad[k];
        rr2 += r[k] * r[k];
      }
      if (Math.sqrt(rr2) < tol * r0) break;
      const beta = rr2 / rr;
      rr = rr2;
      for (let k = 0; k < N; k++) d[k] = r[k] + beta * d[k];
    }
    let drag = 0;
    let diss = 0;
    for (let jf = 1; jf < ny; jf++) {
      for (let i = 0; i < nx; i++) {
        const B = Bf[jf * nx + i];
        const Jy = -B - (phi[jf * nx + i] - phi[(jf - 1) * nx + i]) / h;
        drag -= Jy * B * h * h;
        diss += Jy * Jy * h * h;
      }
    }
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const Jx = -(phi[j * nx + i + 1] - phi[j * nx + i]) / h;
        diss += Jx * Jx * h * h;
      }
    }
    return { drag, diss, it, phi };
  }

  // The array on the ring, unrolled into a straight strip of the ring's width.
  function arrayGeom(p) {
    const mm = (x) => x * 1000;
    const a = mm(p.magA);
    const pitch = mm(p.pitch);
    const n = p.pairs;
    const W = mm(p.ringW);
    const g2 = mm(p.ringT + 2 * p.clearance) / 2;
    const Lm1 = mm(p.magL);
    const t = mm(p.ringT);
    const h = NUM.h;
    const L = (n - 1) * pitch + a + 2 * NUM.margin;
    const nx = Math.round(L / h);
    const ny = Math.round(W / h);
    const xc = [];
    for (let k = 0; k < n; k++) xc.push(NUM.margin + a / 2 + k * pitch);
    return { a, pitch, n, W, g2, Lm1, t, h, nx, ny, xc, barW: mm(p.barW) };
  }

  // Ring-thickness-averaged field of the whole alternating row on the strip's faces, plus the
  // mid-plane field (for the attraction force). Single-pole values are cached by offset.
  function fieldOnFaces(G) {
    const { a, n, W, g2, Lm1, t, h, nx, ny, xc } = G;
    const zg = (Math.sqrt(3 / 5) * t) / 2;
    const cacheAvg = new Map();
    const cacheMid = new Map();
    const one = (dx, dy) => {
      const key = `${dx.toFixed(6)},${dy.toFixed(6)}`;
      let v = cacheAvg.get(key);
      if (v === undefined) {
        if (Math.abs(dx) > NUM.cutoff) {
          v = 0;
          cacheMid.set(key, 0);
        } else {
          const m = poleB(dx, dy, 0, a, g2, Lm1, NUM.nImg);
          v = ((8 / 9) * m + (5 / 9) * (poleB(dx, dy, zg, a, g2, Lm1, NUM.nImg) + poleB(dx, dy, -zg, a, g2, Lm1, NUM.nImg))) / 2;
          cacheMid.set(key, m);
        }
        cacheAvg.set(key, v);
      }
      return key;
    };
    const Bf = new Float64Array(nx * (ny + 1));
    const Bm = new Float64Array(nx * (ny + 1));
    for (let jf = 0; jf <= ny; jf++) {
      for (let i = 0; i < nx; i++) {
        const x = (i + 0.5) * h;
        const y = jf * h - W / 2 - (G.yOff || 0);
        let s = 0;
        let sm = 0;
        for (let k = 0; k < n; k++) {
          const dx = x - xc[k];
          if (Math.abs(dx) > NUM.cutoff) continue;
          const key = one(dx, y);
          const sign = k % 2 ? -1 : 1;
          s += sign * cacheAvg.get(key);
          sm += sign * cacheMid.get(key);
        }
        Bf[jf * nx + i] = s;
        Bm[jf * nx + i] = sm;
      }
    }
    return { Bf, Bm };
  }

  // Flux carried by one back yoke (between the first two poles), from the field at the iron face,
  // integrated over the yoke width. Grid aligned to the magnet edges. Fraction of Br * A.
  function yokeFlux(G) {
    const { a, n, pitch, g2, Lm1, barW } = G;
    const D = g2 + Lm1;
    const h = 0.5;
    const xs = [];
    for (let k = 0; k < n; k++) xs.push(k * pitch);
    const cache = new Map();
    let cum = 0;
    const nyy = Math.round(barW / h);
    for (let i = -Math.round((NUM.cutoff + a / 2) / h); (-a / 2 + (i + 0.5) * h) < pitch / 2; i++) {
      const x = -a / 2 + (i + 0.5) * h;
      for (let j = 0; j < nyy; j++) {
        const y = -barW / 2 + (j + 0.5) * h;
        let s = 0;
        for (let k = 0; k < n; k++) {
          const dx = x - xs[k];
          if (Math.abs(dx) > NUM.cutoff) continue;
          const key = `${dx.toFixed(6)},${y.toFixed(6)}`;
          let v = cache.get(key);
          if (v === undefined) {
            v = poleB(dx, y, D - 1e-9, a, g2, Lm1, NUM.nImg);
            cache.set(key, v);
          }
          s += (k % 2 ? -1 : 1) * v;
        }
        const inside = Math.abs(x) < a / 2 && Math.abs(y) < a / 2 ? 1 : 0;
        cum += (s + inside) * h * h;
      }
    }
    return cum / (a * a);
  }

  // kappa: braking force of the row = eta * kappa * sigma * d * bClosed^2 * A * v per pole position.
  const KCACHE = new Map();
  function geomKey(p) {
    return [p.magA, p.magL, p.clearance, p.ringT, p.ringW, p.pitch, p.pairs, p.barW].join('|');
  }
  function kappaSolve(p) {
    p = merge(p);
    const key = geomKey(p);
    if (KCACHE.has(key)) return KCACHE.get(key);
    const G = arrayGeom(p);
    const { Bf, Bm } = fieldOnFaces(G);
    const S = sheetSolve(Bf, G.nx, G.ny, G.h, NUM.tol);
    const A = G.a * G.a;
    const bc1 = G.Lm1 / (G.Lm1 + G.g2);      // 1-D closed-circuit field / Br, muRec = 1
    // mean field over the pole footprints, and the mid-plane attraction integral
    let foot = 0;
    let nfoot = 0;
    let b2 = 0;
    for (let jf = 1; jf < G.ny; jf++) {
      for (let i = 0; i < G.nx; i++) {
        const x = (i + 0.5) * G.h;
        const y = jf * G.h - G.W / 2;
        b2 += Bm[jf * G.nx + i] ** 2 * G.h * G.h;
        for (let k = 0; k < G.n; k++) {
          if (Math.abs(x - G.xc[k]) < G.a / 2 && Math.abs(y) < G.a / 2) {
            foot += (k % 2 ? -1 : 1) * Bf[jf * G.nx + i];
            nfoot++;
          }
        }
      }
    }
    const out = {
      kappa: S.drag / (G.n * A * bc1 * bc1),
      lambda: foot / nfoot / bc1,
      clampRel: b2 / (G.n * A),               // integral of B_mid^2 per pole / (Br^2 A)
      yokeRel: yokeFlux(G),                   // yoke flux / (Br A)
      energyCheck: S.diss / S.drag,
      iterations: S.it,
      grid: { nx: G.nx, ny: G.ny, h: G.h, xc: G.xc, a: G.a, W: G.W },
      phi: S.phi,
      Bf,
    };
    KCACHE.set(key, out);
    return out;
  }

  // The same sheet solve with an idealised field: exactly B under each pole face, zero elsewhere.
  function sharpFactor(p) {
    p = merge(p);
    const G = arrayGeom(p);
    const Bf = new Float64Array(G.nx * (G.ny + 1));
    for (let jf = 0; jf <= G.ny; jf++) {
      for (let i = 0; i < G.nx; i++) {
        const x = (i + 0.5) * G.h;
        const y = jf * G.h - G.W / 2;
        for (let k = 0; k < G.n; k++) if (Math.abs(x - G.xc[k]) < G.a / 2 && Math.abs(y) < G.a / 2) Bf[jf * G.nx + i] = k % 2 ? -1 : 1;
      }
    }
    const S = sheetSolve(Bf, G.nx, G.ny, G.h, NUM.tol);
    return S.drag / (G.n * G.a * G.a);
  }

  function gap(p) {
    p = merge(p);
    const C = circuit(p);
    const K = kappaSolve(p);
    const area = p.magA * p.magA;
    const bFoot = K.lambda * C.bClosed;                       // T, mean field under a pole face
    const clamp = (K.clampRel * (C.Br * C.muScale) ** 2 * area) / (2 * PHYS.mu0);  // N per pole position
    return Object.assign({}, C, { area, kappa: K.kappa, lambda: K.lambda, bFoot, clamp, yokeRel: K.yokeRel });
  }

  // ---------------------------------------------------------------- 3.3 eddy force per pole position
  function pair(p) {
    p = merge(p);
    const G = gap(p);
    const sigma = sigmaOf(p);
    const kPair = p.eta * G.kappa * sigma * p.ringT * G.bClosed * G.bClosed * G.area;  // N per (m/s) of ring speed
    const w = 2 / (PHYS.mu0 * sigma * p.ringT);               // m/s, thin-sheet characteristic speed
    return { sigma, kPair, kappa: G.kappa, bClosed: G.bClosed, area: G.area, w };
  }

  // ---------------------------------------------------------------- 3.4 from the ring to the ground
  function wheel(p) {
    p = merge(p);
    const P = pair(p);
    const rRing = (p.ringOD - p.ringW) / 2;
    const R = p.wheelDia / 2;
    const kTau = p.pairs * P.kPair * rRing * rRing;           // N m s, torque per rad/s
    const kWheel = kTau / (R * R);                            // N s/m at the ground, one wheel
    const kChair = 2 * kWheel;
    const arcDeg = ((p.pairs * p.pitch) / rRing) * (180 / Math.PI);
    return { rRing, R, speedRatio: rRing / R, kPair: P.kPair, kTau, kWheel, kChair, arcDeg, sigma: P.sigma, w: P.w, kappa: P.kappa };
  }

  // ---------------------------------------------------------------- 3.5 the steady speed
  function descent(p) {
    p = merge(p);
    const H = hill(p);
    const Wh = wheel(p);
    const M = plateMass(p);
    const vT = Math.max(0, H.fNet) / Wh.kChair;
    const vRing = vT * Wh.speedRatio;
    const mEff = p.massTotal + (2 * (p.wheelInertia + M.inertia)) / (Wh.R * Wh.R);
    const tau = mEff / Wh.kChair;
    const power = H.fNet * vT;
    return {
      vT, vKmh: vT * 3.6, vRing, speedRatioW: vRing / Wh.w, mEff, tau, power, powerPerRing: power / 2,
      fNet: H.fNet, kChair: Wh.kChair, levelDrag1: Wh.kChair * 1.0,
    };
  }

  function speedAt(p, t, v0) {
    const D = descent(p);
    const u = v0 || 0;
    return D.vT + (u - D.vT) * Math.exp(-t / D.tau);
  }

  // A ramp run, entered at v0: braked (exponential approach) against free rolling.
  function ramp(p, L, v0) {
    p = merge(p);
    L = L || RAMP.run;
    v0 = v0 === undefined ? RAMP.v0 : v0;
    const D = descent(p);
    const H = hill(p);
    const aFree = H.fNet / D.mEff;
    const vFree = Math.sqrt(v0 * v0 + 2 * aFree * L);
    const tFree = (vFree - v0) / aFree;
    const x = (t) => D.vT * t + (v0 - D.vT) * D.tau * (1 - Math.exp(-t / D.tau));
    let t = L / Math.max(D.vT, 1e-6);
    for (let i = 0; i < 60; i++) {
      const v = D.vT + (v0 - D.vT) * Math.exp(-t / D.tau);
      t -= (x(t) - L) / v;
    }
    const vEnd = D.vT + (v0 - D.vT) * Math.exp(-t / D.tau);
    const rise = L * Math.sin(H.theta);
    const eHands = p.massTotal * PHYS.g * rise - H.fRoll * L;  // J the hands absorb holding a crawl
    return { L, v0, aFree, vFree, tFree, tBrake: t, vEnd, rise, eHands };
  }

  // ---------------------------------------------------------------- 3.6 heat
  function plateMass(p) {
    p = merge(p);
    const a = ALLOYS[p.alloy];
    const ro = p.ringOD / 2;
    const ri = ro - p.ringW;
    const r1 = p.hubOD / 2;
    const ringArea = Math.PI * (ro * ro - ri * ri);
    const hubArea = Math.PI * (r1 ** 2 - (p.hubID / 2) ** 2);
    const spokeArea = p.spokes * p.spokeW * (ri - r1);
    const area = ringArea + hubArea + spokeArea;
    const dens = p.ringT * a.rho;
    const mass = area * dens;
    const inertia = dens * (ringArea * (ro * ro + ri * ri) / 2 + hubArea * (r1 ** 2 + (p.hubID / 2) ** 2) / 2 + spokeArea * (ri * ri + ri * r1 + r1 * r1) / 3);
    return { ringArea, hubArea, spokeArea, area, mass, inertia, heatCap: mass * a.cp, convArea: 2 * area };
  }

  // Laminar flat-plate forced convection at chair speed (the justification for hConv).
  function hFlatPlate(v, L) {
    const Re = (v * L) / PHYS.nuAir;
    return (0.664 * PHYS.kAir * Math.sqrt(Re) * Math.cbrt(PHYS.prAir)) / L;
  }

  function thermal(p) {
    p = merge(p);
    const a = ALLOYS[p.alloy];
    const M = plateMass(p);
    const cold = descent(p);
    const UA = p.hConv * M.convArea;
    let rise = cold.powerPerRing / UA;
    let D = cold;
    for (let i = 0; i < 200; i++) {
      D = descent(Object.assign({}, p, { tempRise: rise }));
      const next = D.powerPerRing / UA;
      if (Math.abs(next - rise) < 1e-10) {
        rise = next;
        break;
      }
      rise = next;
    }
    return {
      adiabaticRate: cold.powerPerRing / M.heatCap, UA, steadyRise: rise, tauThermal: M.heatCap / UA,
      derateAtSteady: 1 - 1 / (1 + a.alpha * rise), vTHot: D.vT, heatCap: M.heatCap, hFlat: hFlatPlate(cold.vT, p.ringOD),
    };
  }

  // ---------------------------------------------------------------- 3.7 iron, force, weight, size, cost
  function hardware(p) {
    p = merge(p);
    const G = gap(p);
    const M = plateMass(p);
    const Wh = wheel(p);
    const magnetVol = p.magA * p.magA * p.magL;
    const magnetsPerWheel = 2 * p.pairs;
    const magnetMass = magnetsPerWheel * magnetVol * PHYS.rhoNd;
    // Yokes: each pairs two neighbouring poles; the bar between them carries a whole pole's flux.
    const yokeFlux = G.yokeRel * G.Br * G.area;                // Wb
    const yokeT = yokeFlux / (PHYS.bSteelMax * p.barW);        // m, full thickness between the magnets
    const yokes = p.pairs;                                     // pairs/2 per side, two sides
    const yokeMassTapered = yokes * p.barW * yokeT * p.pitch * PHYS.rhoSteel;
    const yokeMassUniform = yokes * p.barW * yokeT * (p.pitch + p.magA) * PHYS.rhoSteel;
    // Jaws: two aluminium plates, annular sectors over the bracket's arc, from the yoke's inner edge to a
    // bridge 10 mm past the ring. The bridge is a curved band of the same plate that joins the two jaws
    // across the whole stack, just outside that radius (Fig. 2).
    const ro = p.ringOD / 2;
    const arcLen = p.pairs * p.pitch + 0.020;                  // m, measured along the pole line
    const span = arcLen / Wh.rRing;                            // rad, the bracket's angular span
    const rIn = Wh.rRing - p.barW / 2;                         // m, the jaws' inner edge
    const rBr = ro + 0.010;                                    // m, inner face of the bridge
    const jawMass = 2 * ((span * (rBr * rBr - rIn * rIn)) / 2) * p.jawT * PHYS.rhoAl;
    const half = p.jawT + yokeT + p.magL + p.clearance;        // m, one side of the ring
    const stack = 2 * half + p.ringT;                          // m, whole bracket across the ring
    const bridgeLen = span * (rBr + p.jawT / 2);                // m, along the arc at the bridge's mid-thickness
    const bridgeMass = bridgeLen * stack * p.jawT * PHYS.rhoAl;
    // Stiffness. Each jaw carries the whole attraction at the pole line, a lever arm from its root at the
    // bridge: it bends as a cantilever, and the bridge, under the constant root moment clampTotal * arm
    // along its span (jaw centre to jaw centre), lets each root turn by M L / (2 E I), which tips the jaw.
    const clampTotal = G.clamp * p.pairs;                      // N pulling the jaws together
    const arm = rBr - Wh.rRing;                                // m, bridge to the pole line
    const jawI = (arcLen * p.jawT ** 3) / 12;
    const jawBend = (clampTotal * arm ** 3) / (3 * PHYS.eAl * jawI);   // m, cantilever on a rigid root
    const bridgeI = (bridgeLen * p.jawT ** 3) / 12;
    const bridgeTilt = (clampTotal * arm * (stack - p.jawT)) / (2 * PHYS.eAl * bridgeI);  // rad at each end
    const jawDeflect = jawBend + bridgeTilt * arm;             // m, each jaw toward the ring at the pole line
    const structureMass = jawMass + bridgeMass + p.fittingsMass;
    const bracketMass = magnetMass + yokeMassTapered + structureMass;
    const perWheel = M.mass + bracketMass;
    const slide = ro - (Wh.rRing - p.magA / 2) + 0.010;        // m, travel to pull the poles 10 mm clear of the ring
    const cost = magnetsPerWheel * p.magnetUSD + p.ringUSD + p.steelUSD + p.structureUSD;
    return {
      magnetVol, magnetsPerWheel, magnetMass, magnetMassEach: magnetVol * PHYS.rhoNd,
      yokeFlux, yokeT, yokeMassTapered, yokeMassUniform, jawMass, bridgeMass, structureMass, bracketMass,
      plateMass: M.mass, perWheel, perChair: 2 * perWheel, clampPerPair: G.clamp, clampTotal, jawBend, bridgeTilt, jawDeflect,
      half, stack, slide, arcDeg: Wh.arcDeg, cost, costChair: 2 * cost,
    };
  }

  // Drag left with the bracket slid off: the same field and current solves with the ring offset radially
  // by the slide travel, as a fraction of the engaged drag. Ideal (infinite) yokes, so this is the field
  // model's answer, not a bound on what real yokes leak.
  function offDrag(p) {
    p = merge(p);
    const slide = hardware(p).slide;
    const G = Object.assign(arrayGeom(p), { yOff: slide * 1000 });
    const { Bf } = fieldOnFaces(G);
    const S = sheetSolve(Bf, G.nx, G.ny, G.h, NUM.tol);
    const bc1 = G.Lm1 / (G.Lm1 + G.g2);
    return S.drag / (kappaSolve(p).kappa * G.n * G.a * G.a * bc1 * bc1);
  }

  // ---------------------------------------------------------------- 3.8 the copper pipe
  // A uniformly magnetised sphere is exactly a dipole outside itself, m = Br V / mu0.
  // Flux through a ring of radius r at axial distance z: Phi = mu0 m r^2 / (2 (r^2 + z^2)^1.5).
  // A thin shell (radius r, thickness dr) of rings gives drag (45/1024) mu0^2 m^2 sigma dr v / r^4;
  // integrating dr / r^4 across the wall gives the (1/3)(ri^-3 - ro^-3) below.
  // A sphere has no marked poles, so it may fall with its moment ACROSS the pipe. Then B_r on a thin shell
  // of radius a varies as cos(phi) (2a^2 - z^2)/(a^2 + z^2)^2.5, the azimuthal EMF piles charge on the wall,
  // and the current must close along the pipe. The wall potential is s(z) sin(phi) with
  // s'' - s/a^2 = g(z)/a; solved here by finite differences, scale-free (a = 1). Returns the drag of the
  // transverse moment over that of the axial one, which is the same at every radius.
  let TRANS = null;
  function pipeTransverseRatio() {
    if (TRANS !== null) return TRANS;
    const Z = 60;
    const n = 12001;
    const dz = (2 * Z) / (n - 1);
    const gAx = new Float64Array(n);
    const gTr = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const z = -Z + i * dz;
      const r5 = (1 + z * z) ** 2.5;
      gAx[i] = (3 * z) / r5;
      gTr[i] = (2 - z * z) / r5;
    }
    // tridiagonal (Thomas) solve, s = 0 at both ends
    const b = new Float64Array(n);
    const d = new Float64Array(n);
    const c = 1 / (dz * dz);
    b[0] = 1;
    b[n - 1] = 1;
    for (let i = 1; i < n - 1; i++) {
      b[i] = -2 * c - 1;
      d[i] = gTr[i];
    }
    for (let i = 1; i < n; i++) {
      const lo = i < n - 1 ? c : 0;
      const up = i - 1 > 0 ? c : 0;
      const m = lo / b[i - 1];
      b[i] -= m * up;
      d[i] -= m * d[i - 1];
    }
    const sv = new Float64Array(n);
    sv[n - 1] = d[n - 1] / b[n - 1];
    for (let i = n - 2; i >= 0; i--) sv[i] = (d[i] - (i > 0 ? c : 0) * sv[i + 1]) / b[i];
    let ax = 0;
    let tr = 0;
    for (let i = 1; i < n - 1; i++) {
      const sp = (sv[i + 1] - sv[i - 1]) / (2 * dz);
      ax += 2 * gAx[i] * gAx[i];                               // 2 pi a  ∫ B_r^2 dz, over pi
      tr += (gTr[i] + sv[i]) ** 2 + sp * sp;                   // pi a ∫ (J_phi^2 + J_z^2) dz, over pi
    }
    TRANS = tr / ax;
    return TRANS;
  }

  function pipe(q) {
    q = Object.assign({}, PIPE, q || {});
    const Br = GRADES[q.grade].br;
    const rs = q.sphereD / 2;
    const vol = (4 / 3) * Math.PI * rs ** 3;
    const moment = (Br * vol) / PHYS.mu0;
    const mass = vol * PHYS.rhoNd;
    const ri = q.pipeID / 2;
    const ro = q.pipeOD / 2;
    const sigma = q.iacs * PHYS.sigmaIACS;
    const kPipe = (45 / 1024) * PHYS.mu0 ** 2 * moment ** 2 * sigma * ((ri ** -3 - ro ** -3) / 3);  // N per (m/s)
    const aMean = (ri + ro) / 2;
    const kThin = (45 / 1024) * PHYS.mu0 ** 2 * moment ** 2 * sigma * (ro - ri) / aMean ** 4;
    const vT = (mass * PHYS.g) / kPipe;
    const transRatio = pipeTransverseRatio();
    return {
      Br, vol, moment, mass, ri, ro, sigma, kPipe, kThin, vT, vCmS: vT * 100, tFall: q.length / vT,
      transRatio, tFallTrans: (q.length * transRatio) / vT,
      tFree: Math.sqrt((2 * q.length) / PHYS.g), tau: mass / kPipe, clearance: ri - rs,
    };
  }

  // ---------------------------------------------------------------- everything at once
  function run(p) {
    p = merge(p);
    return { input: p, hill: hill(p), gap: gap(p), wheel: wheel(p), descent: descent(p), thermal: thermal(p), hardware: hardware(p), plate: plateMass(p), ramp: ramp(p) };
  }

  // Steady speed against grade for a few pole counts (the calculator's chart).
  function sweep(p, pairsList, grades) {
    p = merge(p);
    return pairsList.map((n) => ({
      pairs: n,
      points: grades.map((gp) => ({ gradePct: gp, vT: descent(Object.assign({}, p, { pairs: n, slopeRun: 100 / gp })).vT })),
    }));
  }

  // ---------------------------------------------------------------- pre-mortem
  // Each p is a separate estimate of the chance that this failure ALONE sinks the idea.
  const RISKS = [
    { id: 'field', p: 0.15, kind: 'technical', title: 'The real brake is much weaker than the field solve says' },
    { id: 'debris', p: 0.20, kind: 'technical', title: 'Steel grit, water and ice foul the 2 mm clearances' },
    { id: 'heatmag', p: 0.10, kind: 'technical', title: 'A hot car boot weakens the magnets for good' },
    { id: 'pull', p: 0.05, kind: 'technical', title: 'Left and right brake differently and the chair pulls' },
    { id: 'mounting', p: 0.40, kind: 'adoption', title: 'It will not fit between the wheel and the frame' },
    { id: 'weight', p: 0.35, kind: 'adoption', title: 'More than five kilograms is too much for the people who would want it' },
    { id: 'fit', p: 0.20, kind: 'adoption', title: 'The speed it picks is wrong for the hills people actually have' },
    { id: 'lever', p: 0.15, kind: 'adoption', title: 'Switching it on and off is a chore, so it is left off' },
    { id: 'liability', p: 0.20, kind: 'adoption', title: 'Standards and liability' },
  ];

  function premortem() {
    let tech = 1;
    let all = 1;
    for (const r of RISKS) {
      all *= 1 - r.p;
      if (r.kind === 'technical') tech *= 1 - r.p;
    }
    const field = RISKS.find((r) => r.id === 'field');
    return { pPhysics: 1 - field.p, pTechnical: tech, pProduct: all };
  }

  // ---------------------------------------------------------------- the first experiment
  // A braked wheel on a fixed axle, a string wound round the tyre, a weight hanging from it.
  // From rest the weight obeys mEff dv/dt = m g - f - kWheel v, so it falls as
  //   x(t) = v (t - tau (1 - exp(-t / tau))),   v = (m g - f) / kWheel,   tau = mEff / kWheel.
  // Reading the video frames at release and at two marks gives two points on that curve, which fix
  // v and tau whether or not the weight has settled. Two weights then give
  //   kWheel = (m2 - m1) g / (v2 - v1)   (the friction f cancels).
  function fallPos(v, tau, t) {
    return v * (t - tau * (1 - Math.exp(-t / tau)));
  }
  function fallTime(v, tau, x) {
    let t = x / v + tau;
    for (let i = 0; i < 80; i++) t -= (fallPos(v, tau, t) - x) / (v * (1 - Math.exp(-t / tau)));
    return t;
  }
  // Fit v and tau through (t1, L1) and (t2, L2), times measured from release.
  function fitFall(L1, t1, L2, t2) {
    const s = (tau, t) => t - tau * (1 - Math.exp(-t / tau));
    const g = (tau) => s(tau, t2) * L1 - s(tau, t1) * L2;
    let lo = Math.log(1e-5);
    let hi = Math.log(1e4);
    if (g(Math.exp(lo)) > 0) return { v: L2 / t2, tau: 0 };   // no visible transient: straight line
    for (let i = 0; i < 200; i++) {
      const mid = 0.5 * (lo + hi);
      if (g(Math.exp(mid)) > 0) hi = mid;
      else lo = mid;
    }
    const tau = Math.exp(0.5 * (lo + hi));
    return { v: L1 / s(tau, t1), tau };
  }
  function analyse(e, tA1, tB1, tA2, tB2) {
    e = Object.assign({}, EXP, e || {});
    const f1 = fitFall(e.runUp, tA1, e.runUp + e.timed, tB1);
    const f2 = fitFall(e.runUp, tA2, e.runUp + e.timed, tB2);
    const k = ((e.m2 - e.m1) * PHYS.g) / (f2.v - f1.v);
    return { f1, f2, k, friction: e.m1 * PHYS.g - k * f1.v };
  }
  function experiment(p, e) {
    p = merge(p);
    e = Object.assign({}, EXP, e || {});
    const Wh = wheel(p);
    const I = p.wheelInertia + plateMass(p).inertia;
    const one = (m) => {
      const mEff = m + I / (Wh.R * Wh.R);
      const v = (m * PHYS.g - e.friction) / Wh.kWheel;
      const tau = mEff / Wh.kWheel;
      const tA = fallTime(v, tau, e.runUp);
      const tB = fallTime(v, tau, e.runUp + e.timed);
      return { m, v, tau, mEff, tA, tB, tTimed: tB - tA, settled: Math.exp(-tA / tau), vRing: v * Wh.speedRatio };
    };
    const A = one(e.m1);
    const B = one(e.m2);
    const kRead = analyse(e, A.tA, A.tB, B.tA, B.tB).k;
    const kMean = ((e.m2 - e.m1) * PHYS.g) / (e.timed / B.tTimed - e.timed / A.tTimed);  // the naive reading
    const H = hill(p);
    const kPass = H.fNet / (2 * e.vTarget);
    const kBig = wheel(Object.assign({}, p, { pairs: e.maxPairs })).kWheel;
    const kKill = kPass * (Wh.kWheel / kBig);
    return { A, B, I, kWheel: Wh.kWheel, kRead, kMean, kPass, kKill, passFrac: kPass / Wh.kWheel, killFrac: kKill / Wh.kWheel, drop: e.runUp + e.timed };
  }

  // Spotting the release frame late (frames > 0) or early shifts all four measured times by the same amount.
  // Returns the fractional error this puts on kWheel, for a wheel that really brakes at kFrac of the model.
  function releaseSlip(kFrac, frames, p, e) {
    p = merge(p);
    e = Object.assign({}, EXP, e || {});
    const X = experiment(Object.assign({}, p, { eta: p.eta * kFrac }), e);
    const d = frames / e.fps;
    return analyse(e, X.A.tA - d, X.A.tB - d, X.B.tA - d, X.B.tB - d).k / X.kWheel - 1;
  }

  // ---------------------------------------------------------------- numbers quoted in the page and README
  function fmt(x, d) {
    return Number(x).toFixed(d);
  }
  function quoted() {
    const R = run();
    const T = R.thermal;
    const Hw = R.hardware;
    const E = experiment();
    const Pp = pipe();
    const PM = premortem();
    const K = kappaSolve(BASE);
    const q = {};
    // hill
    q.thetaDeg = fmt(R.hill.thetaDeg, 2);
    q.weight = fmt(R.hill.weight, 0);
    q.fDown = fmt(R.hill.fDown, 1);
    q.fRoll = fmt(R.hill.fRoll, 1);
    q.fNet = fmt(R.hill.fNet, 1);
    // gap
    q.Lm_mm = fmt(R.gap.Lm * 1000, 0);
    q.g_mm = fmt(R.gap.g * 1000, 0);
    q.g2_mm = fmt(R.gap.g * 500, 1);
    q.bClosed = fmt(R.gap.bClosed, 3);
    q.bClosed1 = fmt(R.gap.bClosed1, 3);
    q.lambda = fmt(R.gap.lambda, 2);
    q.bFoot = fmt(R.gap.bFoot, 2);
    q.area_cm2 = fmt(R.gap.area * 1e4, 2);
    q.clamp = fmt(R.gap.clamp, 0);
    q.kappa = fmt(R.gap.kappa, 3);
    q.kappaEta = fmt(R.gap.kappa * BASE.eta, 3);
    q.cSharp = fmt(sharpFactor(BASE), 2);
    q.cSharpSingle = fmt(sharpFactor({ pairs: 1 }), 2);
    q.kappa4 = fmt(kappaSolve({ pairs: 4 }).kappa, 3);
    q.kappa10 = fmt(kappaSolve({ pairs: 10 }).kappa, 3);
    q.kappaIter = fmt(K.iterations, 0);
    q.energyCheck = fmt(K.energyCheck, 4);
    q.draftKappa = fmt(0.4 * 0.75 * 0.75, 3);
    q.draftRatio = fmt(R.gap.kappa * BASE.eta / (0.4 * 0.75 * 0.75), 2);
    // pair and wheel
    q.sigma_MS = fmt(R.wheel.sigma / 1e6, 1);
    q.kPair = fmt(R.wheel.kPair, 1);
    q.w = fmt(R.wheel.w, 1);
    q.rRing_mm = fmt(R.wheel.rRing * 1000, 0);
    q.R_mm = fmt(R.wheel.R * 1000, 0);
    q.speedRatio = fmt(R.wheel.speedRatio, 3);
    q.speedRatio2 = fmt(R.wheel.speedRatio ** 2, 3);
    q.kTau = fmt(R.wheel.kTau, 2);
    q.kWheel = fmt(R.wheel.kWheel, 1);
    q.kChair = fmt(R.wheel.kChair, 1);
    q.arcDeg = fmt(R.wheel.arcDeg, 0);
    // descent
    q.vT = fmt(R.descent.vT, 2);
    q.vKmh = fmt(R.descent.vKmh, 1);
    q.vRing = fmt(R.descent.vRing, 2);
    q.vOverW_pct = fmt(R.descent.speedRatioW * 100, 1);
    q.mEff = fmt(R.descent.mEff, 1);
    q.tau = fmt(R.descent.tau, 2);
    q.power = fmt(R.descent.power, 0);
    q.powerPerRing = fmt(R.descent.powerPerRing, 0);
    q.levelDrag = fmt(R.descent.levelDrag1, 0);
    q.levelRatio = fmt(R.descent.levelDrag1 / hill({ slopeRun: 1e9 }).fRoll, 0);
    q.fRollLevel = fmt(hill({ slopeRun: 1e9 }).fRoll, 1);
    for (const s of SLOPES) q['vT_' + s.run] = fmt(descent({ slopeRun: s.run }).vT, 2);
    q.vT_m70 = fmt(descent({ massTotal: 70 }).vT, 2);
    q.vT_m130 = fmt(descent({ massTotal: 130 }).vT, 2);
    q.vT_4pairs = fmt(descent({ pairs: 4 }).vT, 2);
    q.vT_8pairs = fmt(descent({ pairs: 8 }).vT, 2);
    q.vT_4pairs_8 = fmt(descent({ pairs: 4, slopeRun: 8 }).vT, 2);
    q.vT_cl3 = fmt(descent({ clearance: 0.003 }).vT, 2);
    q.kappa_cl3 = fmt(kappaSolve({ clearance: 0.003 }).kappa, 3);
    q.bClosed_cl3 = fmt(circuit({ clearance: 0.003 }).bClosed, 3);
    q.brakeLoss_cl3 = fmt((1 - wheel({ clearance: 0.003 }).kWheel / R.wheel.kWheel) * 100, 0);
    q.vT_1100 = fmt(descent({ alloy: '1100-H14' }).vT, 2);
    q.vT_copper = fmt(descent({ alloy: 'C110' }).vT, 2);
    q.massCopper = fmt(plateMass({ alloy: 'C110' }).mass, 2);
    q.vT_sh = fmt(descent({ grade: 'N42SH' }).vT, 2);
    q.shLoss_pct = fmt((1 - wheel({ grade: 'N42SH' }).kWheel / R.wheel.kWheel) * 100, 0);
    q.vT_eta75 = fmt(descent({ eta: 0.75 }).vT, 2);
    q.vT_eta100 = fmt(descent({ eta: 1.0 }).vT, 2);
    q.vT_crr6 = fmt(descent({ crr: 0.006 }).vT, 2);
    q.vT_crr20 = fmt(descent({ crr: 0.02 }).vT, 2);
    q.vT_t4 = fmt(descent({ ringT: 0.004 }).vT, 2);
    q.vT_t6 = fmt(descent({ ringT: 0.006 }).vT, 2);
    q.vT_draft = fmt(R.descent.vT * R.gap.kappa * BASE.eta / (0.4 * 0.75 * 0.75), 2);
    q.pull10 = fmt(0.1 * R.descent.fNet / 2, 1);
    // ramp run
    q.rampRun = fmt(RAMP.run, 2);
    q.rampRise = fmt(R.ramp.rise, 2);
    q.rampV0 = fmt(RAMP.v0, 1);
    q.rampFree = fmt(R.ramp.vFree, 1);
    q.rampFreeKmh = fmt(R.ramp.vFree * 3.6, 0);
    q.rampTFree = fmt(R.ramp.tFree, 1);
    q.rampEnd = fmt(R.ramp.vEnd, 2);
    q.rampTBrake = fmt(R.ramp.tBrake, 1);
    q.rampHands = fmt(R.ramp.eHands, 0);
    q.aFree = fmt(R.ramp.aFree, 2);
    // thermal
    q.plateMass = fmt(R.plate.mass, 2);
    q.plateInertia = fmt(R.plate.inertia * 1000, 0);
    q.heatCap = fmt(T.heatCap, 0);
    q.adiabaticPerMin = fmt(T.adiabaticRate * 60, 1);
    q.convArea_m2 = fmt(R.plate.convArea, 3);
    q.UA = fmt(T.UA, 2);
    q.hFlat = fmt(T.hFlat, 1);
    q.steadyRise = fmt(T.steadyRise, 0);
    q.tauThermal_min = fmt(T.tauThermal / 60, 0);
    q.derateAtSteady_pct = fmt(T.derateAtSteady * 100, 0);
    q.vTHot = fmt(T.vTHot, 2);
    const drop = 1000 / Math.sqrt(1 + BASE.slopeRun ** 2);
    const ePot = BASE.massTotal * PHYS.g * drop;
    const eRoll = R.hill.fRoll * 1000;
    q.hillDrop = fmt(drop, 0);
    q.hillPot_kJ = fmt(ePot / 1000, 0);
    q.hillRoll_kJ = fmt(eRoll / 1000, 0);
    q.hillRing_kJ = fmt((ePot - eRoll) / 2000, 0);
    q.hillAdiabatic_K = fmt((ePot - eRoll) / 2 / T.heatCap, 0);
    q.hillMinutes = fmt(1000 / R.descent.vT / 60, 0);
    // hardware
    q.magnetMassEach_g = fmt(Hw.magnetMassEach * 1000, 0);
    q.magnetsPerWheel = fmt(Hw.magnetsPerWheel, 0);
    q.magnetMass = fmt(Hw.magnetMass, 2);
    q.yokeRel = fmt(R.gap.yokeRel, 2);
    q.yokeFlux_uWb = fmt(Hw.yokeFlux * 1e6, 0);
    q.yokeT_mm = fmt(Hw.yokeT * 1000, 1);
    q.yokeMass = fmt(Hw.yokeMassTapered, 2);
    q.yokeMassUniform = fmt(Hw.yokeMassUniform, 2);
    q.jawMass = fmt(Hw.jawMass, 2);
    q.bridgeMass = fmt(Hw.bridgeMass, 2);
    q.jawBend_mm = fmt(Hw.jawBend * 1000, 2);
    q.bridgeTip_mm = fmt(Hw.bridgeTilt * (BASE.ringOD / 2 + 0.010 - R.wheel.rRing) * 1000, 2);
    q.structureMass = fmt(Hw.structureMass, 2);
    q.bracketMass = fmt(Hw.bracketMass, 2);
    q.perWheel = fmt(Hw.perWheel, 1);
    q.perChair = fmt(Hw.perChair, 1);
    q.perWheel4 = fmt(hardware({ pairs: 4 }).perWheel, 1);
    q.perChair4 = fmt(hardware({ pairs: 4 }).perChair, 1);
    q.clampTotal = fmt(Hw.clampTotal, 0);
    q.jawDeflect_mm = fmt(Hw.jawDeflect * 1000, 2);
    q.stack_mm = fmt(Hw.stack * 1000, 0);
    q.half_mm = fmt(Hw.half * 1000, 0);
    q.slide_mm = fmt(Hw.slide * 1000, 0);
    q.cost = fmt(Hw.cost, 0);
    q.costChair = fmt(Hw.costChair, 0);
    q.arcDeg10 = fmt(wheel({ pairs: 10 }).arcDeg, 0);
    q.perWheel10 = fmt(hardware({ pairs: 10 }).perWheel, 1);
    // living with it: the brake switched off, and the wheel taken off
    q.offDrag_ppm = fmt(offDrag(BASE) * 1e6, 0);
    q.offPushN = fmt(Hw.perChair * BASE.crr * PHYS.g, 1);
    q.offPushPct = fmt((Hw.perChair / (BASE.massTotal - Hw.perChair)) * 100, 0);
    q.widenMax_cm = fmt(2 * Hw.stack * 100, 0);
    // pipe
    q.pipeMoment = fmt(Pp.moment, 2);
    q.pipeMass_g = fmt(Pp.mass * 1000, 1);
    q.pipeRi_mm = fmt(Pp.ri * 1000, 2);
    q.pipeRo_mm = fmt(Pp.ro * 1000, 2);
    q.pipeClear_mm = fmt(Pp.clearance * 1000, 2);
    q.pipeK = fmt(Pp.kPipe, 2);
    q.pipeThinPct = fmt(Math.abs(Pp.kThin / Pp.kPipe - 1) * 100, 1);   // the thin-wall shortcut reads low
    q.pipeV_cm = fmt(Pp.vCmS, 1);
    q.pipeT = fmt(Pp.tFall, 0);
    q.pipeTransRatio = fmt(Pp.transRatio, 2);
    q.pipeTTrans = fmt(Pp.tFallTrans, 0);
    q.pipeFree = fmt(Pp.tFree, 2);
    q.pipeTau_ms = fmt(Pp.tau * 1000, 1);
    // experiment
    q.expV1 = fmt(E.A.v, 2);
    q.expV2 = fmt(E.B.v, 2);
    q.expTA1 = fmt(E.A.tA, 2);
    q.expTB1 = fmt(E.A.tB, 2);
    q.expTA2 = fmt(E.B.tA, 2);
    q.expTB2 = fmt(E.B.tB, 2);
    q.expT1 = fmt(E.A.tTimed, 2);
    q.expT2 = fmt(E.B.tTimed, 2);
    q.expTau1 = fmt(E.A.tau, 2);
    q.expTau2 = fmt(E.B.tau, 2);
    q.expRead = fmt(E.kRead, 1);
    q.expPass = fmt(E.kPass, 1);
    q.expKill = fmt(E.kKill, 1);
    q.expPassFrac = fmt(E.passFrac * 100, 0);
    q.expKillFrac = fmt(E.killFrac * 100, 0);
    q.expVRing2 = fmt(E.B.vRing, 2);
    q.expDrop = fmt(E.drop, 1);
    {
      // a prototype just under the kill line, read the naive way (mean speed between the marks)
      const weak = experiment({ eta: BASE.eta * 0.97 * E.killFrac });
      q.expWeakTrue = fmt(weak.kWheel, 1);
      q.expWeakNaive = fmt(weak.kMean, 1);
      q.expWeakFit = fmt(weak.kRead, 1);
      q.expWeakSettled_pct = fmt(weak.B.settled * 100, 0);
    }
    {
      // timing resolution: each of the four times off by one video frame, combined in quadrature
      const base = analyse(null, E.A.tA, E.A.tB, E.B.tA, E.B.tB).k;
      const tt = [E.A.tA, E.A.tB, E.B.tA, E.B.tB];
      let s2 = 0;
      for (let i = 0; i < 4; i++) {
        const t2 = tt.slice();
        t2[i] += 1 / EXP.fps;
        s2 += (analyse(null, t2[0], t2[1], t2[2], t2[3]).k / base - 1) ** 2;
      }
      q.expRes_pct = fmt(Math.sqrt(s2) * 100, 1);
    }
    q.expMarkB = fmt(EXP.runUp + EXP.timed, 1);
    {
      // how much the fit leans on the release frame, at the kill line and at the model's value
      q.expSlip3_ms = fmt((3 / EXP.fps) * 1000, 1);
      q.expSlipKill3_pct = fmt(releaseSlip(E.killFrac, 3) * 100, 0);
      q.expSlipKill6_pct = fmt(releaseSlip(E.killFrac, 6) * 100, 0);
      q.expSlipModel6_pct = fmt(releaseSlip(1, 6) * 100, 1);
      q.expRelease3_mm = fmt(fallPos(E.B.v, E.B.tau, 3 / EXP.fps) * 1000, 1);
    }
    // small derived facts quoted in the prose
    q.Br = fmt(R.gap.Br, 2);
    q.BrSH = fmt(GRADES.N42SH.br, 2);
    q.tMaxN52 = fmt(GRADES.N52.tMax, 0);
    q.iacs6061 = fmt(ALLOYS['6061-T6'].iacs * 100, 0);
    q.iacs1100 = fmt(ALLOYS['1100-H14'].iacs * 100, 0);
    q.iacsPipe = fmt(PIPE.iacs * 100, 0);
    q.spacing_mm = fmt((BASE.pitch - BASE.magA) * 1000, 0);
    const fPole = R.descent.vRing / (2 * BASE.pitch);                       // Hz, field reversal rate seen by the ring
    q.poleHz = fmt(fPole, 0);
    q.skin_mm = fmt(Math.sqrt(1 / (Math.PI * fPole * PHYS.mu0 * R.wheel.sigma)) * 1000, 0);
    q.linearErr_pct = fmt((R.descent.vRing / R.wheel.w) ** 2 * 100, 1);
    q.wheelEqMass = fmt(BASE.wheelInertia / (R.wheel.R * R.wheel.R), 1);
    q.draftCylRatio = fmt(0.0254 / ((0.0138 + 0.001) / 2), 1);              // the draft's 1 in magnet / its pipe's mean radius
    // pre-mortem
    q.pPhysics = fmt(PM.pPhysics * 100, 0);
    q.pTechnical = fmt(PM.pTechnical * 100, 0);
    q.pProduct = fmt(PM.pProduct * 100, 0);
    return q;
  }

  return {
    PHYS, ALLOYS, GRADES, BASE, NUM, PIPE, EXP, RAMP, SLOPES, RISKS,
    merge, hill, circuit, poleB, sheetSolve, kappaSolve, sharpFactor, gap, pair, wheel, descent, speedAt, ramp,
    plateMass, hFlatPlate, thermal, hardware, offDrag, pipeTransverseRatio, pipe, run, sweep, premortem,
    fallPos, fallTime, fitFall, analyse, experiment, releaseSlip, quoted,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = HoneyBrake;
