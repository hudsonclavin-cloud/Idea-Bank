/* Unconformity — the geological model.

   A seed becomes a *history*: a chronological list of events (deposit a sequence of beds on an
   erosion surface, fold, fault, tilt, intrude a dyke / sill / pluton). Nothing is ever simulated
   forward. To find out what rock sits at a point of the finished section we walk the history
   BACKWARDS: every deformation is a shear or rotation with an exact closed-form inverse, so we
   undo the youngest event, then the next youngest, until the point lands inside something that
   was created at that moment (a bed, an intrusion) — or falls through to the basement.

   Alongside the position we carry the 2x2 Jacobian of the accumulated inverse map. That lets
   every line (bedding, faults, unconformities, the hatching of each rock pattern) be drawn as an
   antialiased distance field with a constant width on the page, however hard the rock was
   squeezed after it formed. */
(function (G) {
  'use strict';
  const UNC = G.UNC;
  const { hash1, hash2, vnoise1, fbm1 } = UNC;

  // ---------- lithologies ----------
  const LI = {
    SKY: 0, SST: 1, SH: 2, SLT: 3, LS: 4, CGL: 5, COAL: 6, CHK: 7, MRL: 8, EVP: 9, LAVA: 10, TUFF: 11, DOL: 12, SSTX: 13,
    GRANITE: 20, GNEISS: 21, SCHIST: 22, DOLERITE: 23, ALLUV: 30, SOIL: 31, WATER: 32,
  };
  const LNAME = {
    1: 'sandstone', 2: 'shale', 3: 'siltstone', 4: 'limestone', 5: 'conglomerate', 6: 'coal', 7: 'chalk', 8: 'marl',
    9: 'gypsum', 10: 'basalt lava', 11: 'volcanic ash (tuff)', 12: 'dolomite', 13: 'sandstone',
    20: 'granite', 21: 'gneiss', 22: 'schist', 23: 'dolerite', 30: 'gravel and sand', 31: 'soil',
  };
  // bed thickness ranges (world units; the section is 1 unit wide)
  const THK = {
    1: [0.016, 0.048], 2: [0.007, 0.03], 3: [0.008, 0.024], 4: [0.012, 0.04], 5: [0.02, 0.05], 6: [0.0035, 0.008],
    7: [0.03, 0.075], 8: [0.007, 0.018], 9: [0.01, 0.028], 10: [0.024, 0.056], 11: [0.005, 0.013], 12: [0.014, 0.034], 13: [0.02, 0.05],
  };

  // ---------- event types ----------
  const T_SEQ = 1, T_FOLD = 2, T_FAULT = 3, T_ROT = 4, T_DYKE = 5, T_SILL = 6, T_PLUTON = 7;

  // every event has the same shape (keeps property access monomorphic in the hot loop)
  function Ev(type) {
    this.type = type;
    this.px = 0; this.pz = 0; this.tx = 0; this.tz = 0; this.nx = 0; this.nz = 0;
    this.ax = 0; this.az = 0;
    this.A = 0; this.k = 0; this.ph = 0; this.h2 = 0; this.cp2 = 1; this.sp2 = 0; this.chev = 0; this.envC = 0; this.envW = 0;
    this.D = 0; this.dr = 0; this.dw = 1;
    this.ca = 1; this.sa = 0;
    this.w0 = 0; this.wa = 0; this.wf = 1; this.ws = 0; this.tipA = 1e9; this.tipL = 0.1; this.hw = 1; this.hh = 0; this.sl = 0; this.aw = 0;
    this.unit = 0; this.P = 0.007;
    // sequence
    this.L = 0; this.rel = 0; this.ef = 1; this.es = 0; this.chans = null; this.nch = 0;
    this.bowlC = 0; this.bowlW = 0; this.bowlD = 0;
    this.bot = null; this.amp = null; this.lith = null; this.bunit = null; this.bthk = null; this.nb = 0;
    this.g = 0; this.zref = 0; this.bf = 1; this.bs = 0;
    this.lens = null; this.nlens = 0;
    this.idx = 0; this.seqIndex = -1;
  }

  // ---------- small math ----------
  function lineCov(dpx, hw) {
    const a = dpx < 0 ? -dpx : dpx;
    const v = hw + 0.5 - a;
    return v <= 0 ? 0 : v >= 1 ? 1 : v;
  }
  function dotCov(dpx, rpx) {
    const v = rpx + 0.5 - dpx;
    return v <= 0 ? 0 : v >= 1 ? 1 : v;
  }
  function segDist(px, py, ax, ay, bx, by) {
    const pax = px - ax, pay = py - ay, bax = bx - ax, bay = by - ay;
    let h = (pax * bax + pay * bay) / (bax * bax + bay * bay);
    h = h < 0 ? 0 : h > 1 ? 1 : h;
    const dx = pax - bax * h, dy = pay - bay * h;
    return Math.sqrt(dx * dx + dy * dy);
  }
  function ovr(ink, c) {
    return 1 - (1 - ink) * (1 - c);
  }

  // erosion surface of a sequence (z as a function of x, in that sequence's frame)
  function seqE(e, x) {
    if (e.bowlW > 0) {
      // a U-shaped valley cut (young river gravels)
      const t = (x - e.bowlC) / e.bowlW;
      return e.L + e.bowlD * t * t * (1 + 0.15 * vnoise1(x * 9, e.es));
    }
    let z = e.L + e.rel * fbm1(x * e.ef, e.es);
    const ch = e.chans;
    for (let c = 0; c < e.nch; c++) {
      const t = (x - ch[c * 3]) / ch[c * 3 + 1];
      if (t > -1 && t < 1) {
        const q = 1 - t * t;
        z -= ch[c * 3 + 2] * q * Math.sqrt(q);
      }
    }
    return z;
  }
  // bedding plane k of a sequence, in wedge-corrected coordinates
  function bedZ(e, k, x) {
    if (k <= 0) return -1e9;
    if (k >= e.nb) return 1e9;
    return e.bot[k] + e.amp[k] * vnoise1(x * e.bf + k * 7.31, e.bs);
  }

  // ---------- lithology patterns ----------
  // u,v: coordinates in the rock's own (undeformed) frame. kH/kV: page pixels per unit of v/u.
  // Returns ink coverage 0..1.
  function patInk(lith, u, v, kH, kV, P, sd, frac, R) {
    const kI = Math.sqrt(kH * kV);
    const hw = R.hwPat;
    switch (lith) {
      case LI.SST: {
        const c = P * 0.92;
        const j = Math.floor(v / c);
        const uu = u + (j & 1 ? 0.5 * c : 0);
        const i = Math.floor(uu / c);
        const h0 = hash2(i, j, sd);
        if (h0 < 0.3) return 0;
        const cx = (i + 0.2 + 0.6 * hash2(i, j, sd + 1)) * c;
        const cy = (j + 0.2 + 0.6 * hash2(i, j, sd + 2)) * c;
        const du = (uu - cx) * kV, dv = (v - cy) * kH;
        const r = c * (0.085 + 0.07 * h0) * kI;
        return dotCov(Math.sqrt(du * du + dv * dv), r < R.minDot ? R.minDot : r);
      }
      case LI.SSTX: {
        // cross-bedded sandstone: sets of inclined foresets + a few grains
        const setH = P * 3.4;
        const js = Math.floor(v / setH);
        const vb = js * setH;
        const dir = hash1(js, sd) < 0.5 ? -1 : 1;
        const tanT = 0.42 + 0.25 * hash1(js, sd + 3);
        const sp = P * 0.95;
        const phi = v - vb + dir * u * tanT + hash1(js, sd + 9) * sp;
        const f = phi - Math.floor(phi / sp) * sp;
        const dphi = Math.min(f, sp - f);
        const gu = (dir * tanT) / kV, gv = 1 / kH;
        let cov = lineCov(dphi / Math.sqrt(gu * gu + gv * gv), hw * 0.85) * 0.85;
        const dset = (v - vb) * kH;
        cov = Math.max(cov, lineCov(dset, hw * 0.7) * 0.7);
        return cov;
      }
      case LI.SH: {
        const c = P * 0.5;
        const j = Math.floor(v / c);
        const lc = lineCov((v - (j + 0.5) * c) * kH, hw);
        if (lc <= 0) return 0;
        const T = P * 1.55;
        const q = u / T + hash1(j, sd) * 13.7;
        const s = Math.floor(q);
        const f = q - s;
        const df = 0.38 + 0.36 * hash2(s, j, sd);
        if (f > df) return 0;
        const e1 = Math.min(f, df - f) * T * kV;
        return lc * Math.min(1, e1 + 0.5);
      }
      case LI.SLT: {
        const c = P * 0.8;
        const j = Math.floor(v / c);
        const fv = v - j * c;
        if (fv > c * 0.5) {
          // dashes
          const lc = lineCov((fv - c * 0.75) * kH, hw);
          if (lc <= 0) return 0;
          const T = P * 1.3;
          const q = u / T + hash1(j, sd) * 9.1;
          const s = Math.floor(q);
          const f = q - s;
          if (f > 0.42) return 0;
          return lc * Math.min(1, Math.min(f, 0.42 - f) * T * kV + 0.5);
        }
        const cc = P * 0.65;
        const i = Math.floor(u / cc);
        if (hash2(i, j, sd + 4) < 0.45) return 0;
        const cx = (i + 0.5) * cc, cy = (j + 0.25) * c;
        const du = (u - cx) * kV, dv = (v - cy) * kH;
        return dotCov(Math.sqrt(du * du + dv * dv), Math.max(R.minDot, P * 0.07 * kI));
      }
      case LI.LS:
      case LI.DOL:
      case LI.MRL: {
        const hC = P * 1.05, bL = P * 2.3;
        const j = Math.floor(v / hC);
        const fv = v - j * hC;
        let cov = lineCov(Math.min(fv, hC - fv) * kH, hw);
        if (lith === LI.MRL) {
          // marl: courses only half-ruled, short joints
          const q = u / (P * 1.7) + hash1(j, sd) * 5.3;
          const fq = q - Math.floor(q);
          if (fq > 0.55) cov = 0;
        }
        let uu = u + (j & 1 ? 0.5 * bL : 0);
        if (lith === LI.DOL) uu += fv * 0.6; // rhombic joints
        const fu = uu - Math.floor(uu / bL) * bL;
        let jc = lineCov(Math.min(fu, bL - fu) * kV, hw);
        if (lith === LI.MRL && (fv < hC * 0.3 || fv > hC * 0.7)) jc = 0;
        return Math.max(cov, jc);
      }
      case LI.CGL:
      case LI.ALLUV: {
        const c = P * (lith === LI.CGL ? 1.75 : 1.15);
        const j = Math.floor(v / c);
        const uu = u + (j & 1 ? 0.5 * c : 0) + hash1(j, sd) * c;
        const i = Math.floor(uu / c);
        const h0 = hash2(i, j, sd);
        if (h0 < 0.18) {
          // matrix grain
          const du = (uu - (i + 0.5) * c) * kV, dv = (v - (j + 0.5) * c) * kH;
          return dotCov(Math.sqrt(du * du + dv * dv), R.minDot);
        }
        const r = c * (0.17 + 0.2 * h0);
        const ex = 1 + 0.45 * hash2(i, j, sd + 3);
        const cx = i * c + r * ex + (c - 2 * r * ex) * hash2(i, j, sd + 1);
        const cy = j * c + r + (c - 2 * r) * hash2(i, j, sd + 2);
        const du = ((uu - cx) / ex) * kV, dv = (v - cy) * kH;
        const d = Math.sqrt(du * du + dv * dv);
        return lineCov(d - r * kI, hw);
      }
      case LI.COAL:
        return 0;
      case LI.CHK: {
        const bandS = P * 5.6;
        const jb = Math.round(v / bandS);
        const dvb = v - jb * bandS;
        if (dvb < P * 0.55 && dvb > -P * 0.55) {
          const nl = P * 2.6;
          const q = u + hash1(jb, sd) * 7.3;
          const ii = Math.floor(q / nl);
          const hh = hash2(ii, jb, sd);
          if (hh < 0.6) {
            const a = nl * (0.2 + 0.14 * hash2(ii, jb, sd + 1));
            const b = P * (0.2 + 0.12 * hash2(ii, jb, sd + 2));
            const cx = (ii + 0.5) * nl;
            const du = (q - cx) / a, dv = dvb / b;
            const qq = Math.sqrt(du * du + dv * dv) + 0.18 * vnoise1(Math.atan2(dv, du) * 2.2, ii * 31 + jb);
            const dist = (qq - 1) * (b < a ? b : a) * kI;
            return dotCov(dist, 0) * 0.92;
          }
        }
        const c = P * 1.5;
        const j = Math.floor(v / c);
        const i = Math.floor(u / c);
        if (hash2(i, j, sd + 5) < 0.75) return 0;
        const du = (u - (i + 0.5) * c) * kV, dv = (v - (j + 0.5) * c) * kH;
        return dotCov(Math.sqrt(du * du + dv * dv), R.minDot) * 0.7;
      }
      case LI.EVP: {
        // gypsum: short crossed diagonal strokes in a grid
        const c = P * 1.3;
        const j = Math.floor(v / c);
        const uu = u + (j & 1 ? 0.5 * c : 0);
        const i = Math.floor(uu / c);
        const lx = (uu - (i + 0.5) * c) * kV, ly = (v - (j + 0.5) * c) * kH;
        const a = c * 0.22 * kI;
        const d1 = segDist(lx, ly, -a, -a, a, a);
        const d2 = segDist(lx, ly, -a, a, a, -a);
        return Math.max(lineCov(d1, hw), hash2(i, j, sd) < 0.5 ? lineCov(d2, hw) : 0);
      }
      case LI.LAVA: {
        if (frac > 0.74) {
          // vesicles near the top of each flow
          const c = P * 0.9;
          const j = Math.floor(v / c);
          const uu = u + (j & 1 ? 0.5 * c : 0);
          const i = Math.floor(uu / c);
          const h0 = hash2(i, j, sd);
          if (h0 < 0.45) return 0;
          const du = (uu - (i + 0.5) * c) * kV, dv = (v - (j + 0.5) * c) * kH;
          const r = c * (0.12 + 0.12 * h0) * kI;
          return lineCov(Math.sqrt(du * du + dv * dv) - r, hw * 0.8);
        }
        // columnar joints
        const sp = P * 1.55;
        const i = Math.floor(u / sp);
        let best = 1e9;
        for (let o = -1; o <= 1; o++) {
          const xi = (i + o + 0.5 + 0.5 * (hash1(i + o, sd) - 0.5)) * sp;
          const d = Math.abs(u - xi);
          if (d < best) best = d;
        }
        const cov = lineCov(best * kV, hw);
        // occasional cross-joints
        const cj = P * 2.1;
        const jj = Math.floor(v / cj);
        const fv = v - jj * cj;
        const cross = hash2(i, jj, sd + 2) < 0.35 ? lineCov(Math.min(fv, cj - fv) * kH, hw * 0.8) : 0;
        return Math.max(cov, cross);
      }
      case LI.TUFF:
      case LI.DOLERITE: {
        const c = P * (lith === LI.TUFF ? 1.05 : 1.45);
        const j = Math.floor(v / c);
        const uu = u + (j & 1 ? 0.5 * c : 0);
        const i = Math.floor(uu / c);
        const h0 = hash2(i, j, sd);
        if (h0 < 0.3) return 0;
        const lx = (uu - (i + 0.3 + 0.4 * hash2(i, j, sd + 1)) * c) * kV;
        const ly = (v - (j + 0.3 + 0.4 * hash2(i, j, sd + 2)) * c) * kH;
        const a = c * (lith === LI.TUFF ? 0.14 : 0.17) * kI;
        const d = Math.min(segDist(lx, ly, -a, a, 0, -0.75 * a), segDist(lx, ly, 0, -0.75 * a, a, a));
        return lineCov(d, hw * 0.9);
      }
      case LI.GRANITE: {
        const c = P * 1.9;
        const j = Math.floor(v / c);
        const uu = u + (j & 1 ? 0.5 * c : 0);
        const i = Math.floor(uu / c);
        const h0 = hash2(i, j, sd);
        if (h0 < 0.1) return 0;
        const lx = (uu - (i + 0.5 + 0.3 * (hash2(i, j, sd + 1) - 0.5)) * c) * kV;
        const ly = (v - (j + 0.5 + 0.3 * (hash2(i, j, sd + 2) - 0.5)) * c) * kH;
        const ang = (hash2(i, j, sd + 3) - 0.5) * 0.9;
        const cs = Math.cos(ang), sn = Math.sin(ang);
        const rx = lx * cs - ly * sn, ry = lx * sn + ly * cs;
        const arm = c * 0.19 * kI * (0.75 + 0.5 * h0);
        const ax = Math.abs(rx), ay = Math.abs(ry);
        const d1 = Math.sqrt(Math.max(ax - arm, 0) ** 2 + ay * ay);
        const d2 = Math.sqrt(Math.max(ay - arm, 0) ** 2 + ax * ax);
        return lineCov(Math.min(d1, d2), hw);
      }
      case LI.GNEISS:
      case LI.SCHIST: {
        const sch = lith === LI.SCHIST;
        const w = v + P * (sch ? 0.9 : 1.8) * vnoise1(u / (P * (sch ? 4 : 9)), sd) + P * (sch ? 0.35 : 0.7) * Math.sin(u / (P * (sch ? 1.4 : 3.1)) + v / (P * 7));
        const sp = P * (sch ? 0.62 : 0.9);
        const j = Math.floor(w / sp);
        const fw = w - j * sp;
        const hb = hash1(j, sd);
        if (hb < 0.12) return 0;
        const thick = hw * (0.7 + (sch ? 0.4 : 2.2) * hb * hb * hb);
        return lineCov(Math.min(fw, sp - fw) * kH, thick);
      }
      case LI.SOIL: {
        const c = P * 0.8;
        const i = Math.floor(u / c);
        const j = Math.floor(v / c);
        const h0 = hash2(i, j, sd);
        if (h0 < 0.55) return 0;
        const lx = (u - (i + 0.5) * c) * kV, ly = (v - (j + 0.5) * c) * kH;
        const a = c * 0.3 * kI;
        return lineCov(segDist(lx, ly, 0, a, (h0 - 0.75) * a, -a), hw * 0.8);
      }
    }
    return 0;
  }

  // ---------- the evaluator ----------
  // OUT receives secondary results without allocating.
  const OUT = { ink: 0, mod: 0 };

  function inSequence(H, R, e, i, x, z, m00, m01, m10, m11, ink, mod) {
    const ps = R.ps;
    const wf = 1 + e.g * (x - 0.5);
    const zr = e.zref + (z - e.zref) / wf;
    const lenH = Math.sqrt(m10 * m10 + m11 * m11);
    const kH = wf / (lenH * ps);
    const kV = 1 / (Math.sqrt(m00 * m00 + m01 * m01) * ps);

    // channel lenses (erosive base, flat top)
    for (let l = 0; l < e.nlens; l++) {
      const L = e.lens[l];
      const s = (x - L.cx) / L.w;
      if (s <= -1 || s >= 1) continue;
      const base = L.cz - L.t * (1 - s * s);
      if (zr > base && zr < L.cz) {
        const dl = Math.min(zr - base, L.cz - zr) * kH * 0.92;
        const c = lineCov(dl, R.hwBed * 1.1);
        if (c > 0) ink = ovr(ink, c * 0.7);
        const p = patInk(L.lith, x, zr, kH, kV, e.P, L.sd, (zr - base) / (L.cz - base), R);
        if (p > 0) ink = ovr(ink, p * R.patA);
        OUT.ink = ink; OUT.mod = mod;
        return L.unit;
      }
      const dOut = Math.min(Math.abs(zr - base), Math.abs(zr - L.cz)) * kH;
      if (dOut < 3 && zr > base - 0.02 && zr < L.cz + 0.02) {
        const c = lineCov(dOut, R.hwBed * 1.1);
        if (c > 0) ink = ovr(ink, c * 0.7);
      }
    }

    // find the bed: binary search on mean levels, then refine with the bedding undulation
    const bot = e.bot;
    let lo = 0, hi = e.nb - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (bot[mid] <= zr) lo = mid;
      else hi = mid - 1;
    }
    let k = lo;
    let lower = bedZ(e, k, x);
    while (k > 0 && zr < lower) {
      k--;
      lower = bedZ(e, k, x);
    }
    let upper = bedZ(e, k + 1, x);
    while (k < e.nb - 1 && zr >= upper) {
      k++;
      lower = upper;
      upper = bedZ(e, k + 1, x);
    }
    // bedding-plane lines
    let dmin = upper - zr;
    if (k > 0 && zr - lower < dmin) dmin = zr - lower;
    const c = lineCov(dmin * kH, R.hwBed);
    if (c > 0) ink = ovr(ink, c * R.bedA);

    const t = e.bthk[k];
    const lowN = k > 0 ? lower : upper - t;
    let frac = (zr - lowN) / (upper - lowN);
    if (frac < 0) frac = 0;
    const lith = e.lith[k];
    const p = patInk(lith, x, zr, kH, kV, e.P, e.bs + k * 131, frac, R);
    if (p > 0) ink = ovr(ink, p * R.patA);
    OUT.ink = ink;
    OUT.mod = mod;
    return e.bunit[k];
  }

  // X,Z: page world coordinates. S, Sp: land surface height and slope at X.
  // hits (optional Uint8Array per event) records which events left visible evidence.
  function evaluate(H, R, X, Z, S, Sp, hits) {
    const ps = R.ps;
    let ink = 0, mod = 0;
    const dS = Z - S;
    const sn = 1 / Math.sqrt(1 + Sp * Sp);
    const dl = (dS * sn) / ps;
    if (dl < 5 && dl > -5) ink = lineCov(dl, R.hwLand) * 0.95;

    if (dS > 0) {
      // above the ground: sea or sky. The sea surface line straddles both.
      if (H.sea && S < H.seaLevel) {
        const dsl = (Z - H.seaLevel) / ps;
        if (dsl < 4 && dsl > -4) ink = ovr(ink, lineCov(dsl, R.hwBed * 1.2) * 0.75);
      }
      if (H.sea && Z < H.seaLevel) {
        const sp = 0.0042;
        const q = (H.seaLevel - Z) / sp;
        const j = Math.floor(q);
        const dv = (q - j - 0.5) * sp;
        let c = lineCov(dv / ps, R.hwPat * 0.75);
        if (c > 0) {
          const T = 0.05;
          const qq = X / T + hash1(j, 77) * 9.3;
          const f = qq - Math.floor(qq);
          if (f > 0.86) c = 0;
          ink = ovr(ink, c * 0.38);
        }
        OUT.ink = ink;
        OUT.mod = 0;
        return 1;
      }
      OUT.ink = ink;
      OUT.mod = 0;
      return 0;
    }

    // soil
    if (H.soilT > 0 && !(H.sea && S < H.seaLevel + 0.002)) {
      const st = H.soilT * (1 + 0.45 * vnoise1(X * 23, 991));
      if (-dS < st) {
        const p = patInk(LI.SOIL, X, Z, 1 / ps, 1 / ps, 0.0062, 4441, 0.5, R);
        if (p > 0) ink = ovr(ink, p * 0.6);
        OUT.ink = ink;
        OUT.mod = 0;
        return 2;
      }
      const db = ((-dS - st) * sn) / ps;
      if (db < 3) ink = ovr(ink, lineCov(db, R.hwBed) * 0.35);
    }

    let x = X, z = Z;
    let m00 = 1, m01 = 0, m10 = 0, m11 = 1;
    const ev = H.events;
    for (let i = ev.length - 1; i >= 0; i--) {
      const e = ev[i];
      switch (e.type) {
        case T_SEQ: {
          const Ez = seqE(e, x);
          const dE = z - Ez;
          if (dE < 0.03 && dE > -0.03) {
            const h = 0.0015;
            const sl = (seqE(e, x + h) - seqE(e, x - h)) / (2 * h);
            const gx = m10 - m00 * sl, gz = m11 - m01 * sl;
            const dpx = dE / (Math.sqrt(gx * gx + gz * gz) * ps);
            const c = lineCov(dpx, R.hwUnc);
            if (c > 0) ink = ovr(ink, c * 0.9);
          }
          if (dE >= 0) {
            if (hits) hits[i] = 1;
            return inSequence(H, R, e, i, x, z, m00, m01, m10, m11, ink, mod);
          }
          break;
        }
        case T_FOLD: {
          const s = x * e.nx + z * e.nz;
          const a = e.k * s + e.ph;
          const sa = Math.sin(a), ca = Math.cos(a);
          const s2 = 2 * sa * ca, c2 = ca * ca - sa * sa;
          let f = sa + e.h2 * (s2 * e.cp2 + c2 * e.sp2);
          let fp = ca + 2 * e.h2 * (c2 * e.cp2 - s2 * e.sp2);
          if (e.chev !== 0) {
            const sa2 = sa * sa, ca2 = ca * ca;
            const sa3 = sa * (3 - 4 * sa2), ca3 = ca * (4 * ca2 - 3);
            const sa5 = sa * (16 * sa2 * sa2 - 20 * sa2 + 5), ca5 = ca * (16 * ca2 * ca2 - 20 * ca2 + 5);
            f += e.chev * (-sa3 / 9 + sa5 / 25);
            fp += e.chev * (-ca3 / 3 + ca5 / 5);
          }
          fp *= e.k;
          let en = 1, enp = 0;
          if (e.envW > 0) {
            const t = (s - e.envC) / e.envW;
            en = Math.exp(-t * t);
            enp = ((-2 * t) / e.envW) * en;
          }
          const disp = e.A * f * en;
          const c = e.A * (fp * en + f * enp);
          x -= e.ax * disp;
          z -= e.az * disp;
          const j00 = 1 - c * e.ax * e.nx, j01 = -c * e.ax * e.nz, j10 = -c * e.az * e.nx, j11 = 1 - c * e.az * e.nz;
          const n00 = j00 * m00 + j01 * m10, n01 = j00 * m01 + j01 * m11;
          const n10 = j10 * m00 + j11 * m10, n11 = j10 * m01 + j11 * m11;
          m00 = n00; m01 = n01; m10 = n10; m11 = n11;
          break;
        }
        case T_FAULT: {
          const d = (x - e.px) * e.nx + (z - e.pz) * e.nz;
          const gx = m00 * e.nx + m10 * e.nz, gz = m01 * e.nx + m11 * e.nz;
          const dpx = d / (Math.sqrt(gx * gx + gz * gz) * ps);
          if (dpx < 5 && dpx > -5) {
            const c = lineCov(dpx, R.hwFault);
            if (c > 0) ink = ovr(ink, c * 0.92);
            if (hits) hits[i] = 1;
          }
          const ad = d < 0 ? -d : d;
          const ex = e.dr > 0 ? Math.exp(-ad / e.dw) : 0;
          const h = (d > 0 ? 0.5 : -0.5) * (1 - e.dr * ex);
          const hp = ((0.5 * e.dr) / e.dw) * ex;
          x -= e.tx * e.D * h;
          z -= e.tz * e.D * h;
          const c = e.D * hp;
          const j00 = 1 - c * e.tx * e.nx, j01 = -c * e.tx * e.nz, j10 = -c * e.tz * e.nx, j11 = 1 - c * e.tz * e.nz;
          const n00 = j00 * m00 + j01 * m10, n01 = j00 * m01 + j01 * m11;
          const n10 = j10 * m00 + j11 * m10, n11 = j10 * m01 + j11 * m11;
          m00 = n00; m01 = n01; m10 = n10; m11 = n11;
          break;
        }
        case T_ROT: {
          const dx = x - e.px, dz = z - e.pz;
          x = e.px + e.ca * dx - e.sa * dz;
          z = e.pz + e.sa * dx + e.ca * dz;
          const n00 = e.ca * m00 - e.sa * m10, n01 = e.ca * m01 - e.sa * m11;
          const n10 = e.sa * m00 + e.ca * m10, n11 = e.sa * m01 + e.ca * m11;
          m00 = n00; m01 = n01; m10 = n10; m11 = n11;
          break;
        }
        case T_DYKE: {
          const rx = x - e.px, rz = z - e.pz;
          const a = rx * e.tx + rz * e.tz;
          if (a > e.tipA) break;
          const d = rx * e.nx + rz * e.nz - e.wa * vnoise1(a * e.wf, e.ws);
          let half = 0.5 * e.w0 * (1 + 0.22 * vnoise1(a * e.wf * 1.9 + 5.3, e.ws + 7));
          if (a > e.tipA - e.tipL) half *= Math.sqrt((e.tipA - a) / e.tipL);
          const gx = m00 * e.nx + m10 * e.nz, gz = m01 * e.nx + m11 * e.nz;
          const kN = 1 / (Math.sqrt(gx * gx + gz * gz) * ps);
          const ad = d < 0 ? -d : d;
          const dm = (ad - half) * kN;
          if (dm < 5) {
            const c = lineCov(dm, R.hwIgn);
            if (c > 0) ink = ovr(ink, c * 0.88);
            if (hits) hits[i] = 1;
          }
          if (ad < half) {
            // columnar joints run perpendicular to the dyke walls
            const tgx = m00 * e.tx + m10 * e.tz, tgz = m01 * e.tx + m11 * e.tz;
            const kT = 1 / (Math.sqrt(tgx * tgx + tgz * tgz) * ps);
            const sp = e.P * 1.25;
            const q = a / sp;
            const j = Math.floor(q);
            const off = 0.35 * (hash1(j, e.ws) - 0.5);
            const fq = q - j - 0.5 - off;
            let p = lineCov(fq * sp * kT, R.hwPat) * (ad < half - 0.2 * e.P ? 1 : 0);
            const pv = patInk(LI.DOLERITE, a * 0.7, d, kN, kT, e.P * 0.75, e.ws + 3, 0.5, R);
            p = Math.max(p * 0.85, pv * 0.6);
            if (p > 0) ink = ovr(ink, p * R.patA);
            OUT.ink = ink;
            OUT.mod = mod;
            return e.unit;
          }
          break;
        }
        case T_SILL: {
          const s = (x - e.px) / e.hw;
          if (s > -1 && s < 1) {
            const zc = e.pz + e.sl * (x - e.px) + e.wa * vnoise1(x * e.wf, e.ws);
            const half = 0.5 * e.w0 * Math.pow(1 - s * s, 0.35);
            const d = z - zc;
            const gx = m10 - m00 * e.sl, gz = m11 - m01 * e.sl;
            const kN = 1 / (Math.sqrt(gx * gx + gz * gz) * ps);
            const ad = d < 0 ? -d : d;
            const dm = (ad - half) * kN;
            if (dm < 5) {
              const c = lineCov(dm, R.hwIgn);
              if (c > 0) ink = ovr(ink, c * 0.88);
              if (hits) hits[i] = 1;
            }
            if (ad < half) {
              const kX = 1 / (Math.sqrt(m00 * m00 + m01 * m01) * ps);
              const sp = e.P * 1.3;
              const q = x / sp;
              const j = Math.floor(q);
              const fq = q - j - 0.5 - 0.35 * (hash1(j, e.ws) - 0.5);
              let p = lineCov(fq * sp * kX, R.hwPat);
              const pv = patInk(LI.DOLERITE, x, d, kN, kX, e.P * 0.75, e.ws + 3, 0.5, R);
              p = Math.max(p * 0.85, pv * 0.6);
              if (p > 0) ink = ovr(ink, p * R.patA);
              OUT.ink = ink;
              OUT.mod = mod;
              return e.unit;
            }
          }
          break;
        }
        case T_PLUTON: {
          const s = (x - e.px) / e.hw;
          const top = e.pz - e.hh * s * s + e.wa * fbm1(x * e.wf, e.ws);
          const d = z - top;
          const sl = (-2 * e.hh * s) / e.hw;
          const gx = m10 - m00 * sl, gz = m11 - m01 * sl;
          const kN = 1 / (Math.sqrt(gx * gx + gz * gz) * ps);
          const dpx = d * kN;
          if (dpx < 5 && dpx > -5) {
            const c = lineCov(dpx, R.hwIgn * 1.1);
            if (c > 0) ink = ovr(ink, c * 0.9);
            if (hits) hits[i] = 1;
          }
          if (d < 0) {
            const kX = 1 / (Math.sqrt(m00 * m00 + m01 * m01) * ps);
            const kZ = 1 / (Math.sqrt(m10 * m10 + m11 * m11) * ps);
            const p = patInk(LI.GRANITE, x, z, kZ, kX, e.P, e.ws + 11, 0.5, R);
            if (p > 0) ink = ovr(ink, p * R.patA);
            if (hits) hits[i] = 1;
            OUT.ink = ink;
            OUT.mod = mod;
            return e.unit;
          }
          const dn = d / Math.sqrt(1 + sl * sl);
          if (dn < e.aw) {
            const t = 1 - dn / e.aw;
            const m = t * t * (3 - 2 * t);
            const mv = (m * 255) | 0;
            if (mv > mod) mod = mv;
            // hornfels spots
            const kX = 1 / (Math.sqrt(m00 * m00 + m01 * m01) * ps);
            const kZ = 1 / (Math.sqrt(m10 * m10 + m11 * m11) * ps);
            const c = e.P * 1.1;
            const ii = Math.floor(x / c), jj = Math.floor(z / c);
            if (hash2(ii, jj, e.ws + 5) < 0.55 * m) {
              const du = (x - (ii + 0.5) * c) * kX, dv = (z - (jj + 0.5) * c) * kZ;
              const cov = dotCov(Math.sqrt(du * du + dv * dv), Math.max(R.minDot, c * 0.16 * Math.sqrt(kX * kZ)));
              if (cov > 0) ink = ovr(ink, cov * 0.75);
            }
          }
          break;
        }
      }
    }
    // fell through every event: basement (or, with no basement, the oldest sequence's lowest bed)
    const B = H.basement;
    if (B) {
      if (hits) hits[ev.length] = 1;
      const kX = 1 / (Math.sqrt(m00 * m00 + m01 * m01) * ps);
      const kZ = 1 / (Math.sqrt(m10 * m10 + m11 * m11) * ps);
      const p = patInk(B.lith, x, z, kZ, kX, B.P, B.sd, 0.5, R);
      if (p > 0) ink = ovr(ink, p * R.patA);
      OUT.ink = ink;
      OUT.mod = mod;
      return B.unit;
    }
    OUT.ink = ink;
    OUT.mod = mod;
    return 0;
  }

  // ---------- land surface ----------
  function landZ(H, x) {
    const L = H.land;
    let s = L.Ls + L.relA * fbm1(x * L.relF, L.rs) + L.tilt * (x - 0.5);
    if (L.vw > 0) {
      const t = (x - L.vc) / L.vw;
      if (t > -1 && t < 1) {
        const q = 1 - t * t;
        s -= L.vd * q * q;
        if (L.flood !== null && s < L.flood) s = L.flood;
      }
    }
    if (L.coast) {
      const t = L.coast > 0 ? x : 1 - x; // coast toward the right (east) if coast>0
      const u = (t - L.cx0) / (1 - L.cx0);
      if (u > 0) s -= L.cDepth * (u < 1 ? u * u * (3 - 2 * u) : 1) + 0.02 * u;
    }
    return s;
  }

  // ---------- environments of deposition ----------
  const ENVS = {
    shelf: {
      name: 'shelf',
      desc: 'laid down in a warm, shallow sea',
      members: [['alt', [LI.LS, LI.SH], 3], ['mass', [LI.LS], 2.2], ['alt', [LI.MRL, LI.LS], 2], ['mix', [[LI.SH, 3], [LI.LS, 1], [LI.SLT, 1]], 2], ['mix', [[LI.SST, 2], [LI.SLT, 1], [LI.SH, 1]], 1], ['mass', [LI.DOL], 0.7]],
    },
    delta: {
      name: 'delta',
      desc: 'from a swampy, forested delta — each coal seam is a buried forest floor',
      members: [['cyclo', [], 4], ['mix', [[LI.SH, 2], [LI.SLT, 2], [LI.SST, 1]], 2], ['mass', [LI.SSTX], 1.2]],
    },
    redbeds: {
      name: 'redbeds',
      desc: 'dumped by rivers wandering across a dry plain',
      members: [['fine', [], 3], ['mass', [LI.SSTX], 2], ['alt', [LI.SLT, LI.SH], 1.4], ['mix', [[LI.SST, 2], [LI.SLT, 2], [LI.CGL, 0.6]], 2]],
    },
    deep: {
      name: 'deep',
      desc: 'shed by submarine avalanches (turbidity currents) onto a deep sea floor',
      members: [['rhythm', [LI.SST, LI.SH], 5], ['mass', [LI.SST], 1], ['mass', [LI.SH], 1.2], ['alt', [LI.SLT, LI.SH], 1]],
    },
    chalk: {
      name: 'chalk',
      desc: 'the ooze of countless microscopic shells, with bands of flint',
      members: [['mass', [LI.CHK], 5], ['alt', [LI.CHK, LI.MRL], 2]],
    },
    evap: {
      name: 'evap',
      desc: 'left by a shallow lagoon drying under a hot sun',
      members: [['alt', [LI.EVP, LI.MRL], 2], ['alt', [LI.DOL, LI.SH], 2], ['mass', [LI.EVP], 1], ['mix', [[LI.MRL, 2], [LI.SH, 1], [LI.LS, 1]], 1.5]],
    },
    volc: {
      name: 'volc',
      desc: 'from eruptions — lava flows, ash falls and the sand washed in between',
      members: [['mass', [LI.LAVA], 2.2], ['alt', [LI.TUFF, LI.SLT], 2], ['mix', [[LI.SST, 1], [LI.TUFF, 1], [LI.SH, 1]], 2], ['alt', [LI.LAVA, LI.TUFF], 1.5]],
    },
  };

  const PERIODS = [
    ['Precambrian', 2500, 541], ['Cambrian', 541, 485], ['Ordovician', 485, 444], ['Silurian', 444, 419], ['Devonian', 419, 359],
    ['Carboniferous', 359, 299], ['Permian', 299, 252], ['Triassic', 252, 201], ['Jurassic', 201, 145], ['Cretaceous', 145, 66],
    ['Paleogene', 66, 23], ['Neogene', 23, 2.6], ['Quaternary', 2.6, 0],
  ];
  const PERIOD_ENVS = {
    1: [['shelf', 3], ['deep', 2], ['redbeds', 1]],
    2: [['deep', 3], ['shelf', 2], ['volc', 1.2]],
    3: [['deep', 3], ['shelf', 2]],
    4: [['redbeds', 4], ['shelf', 1.5]],
    5: [['delta', 3], ['shelf', 3]],
    6: [['redbeds', 3], ['evap', 2]],
    7: [['redbeds', 3], ['evap', 2]],
    8: [['shelf', 3], ['delta', 1], ['evap', 1]],
    9: [['chalk', 3], ['shelf', 2], ['delta', 1]],
    10: [['delta', 2], ['shelf', 2], ['volc', 1.5]],
    11: [['redbeds', 2], ['delta', 2], ['volc', 1.5]],
  };

  function thk(rng, lith, s) {
    const r = THK[lith] || [0.01, 0.03];
    return rng.range(r[0], r[1]) * s;
  }

  // emit beds from z0 up to z1
  function buildBeds(rng, env, bs, z0, z1, basal) {
    const beds = [];
    let z = z0;
    let member = 0;
    const push = (lith, t) => {
      if (lith === LI.SST && t > 0.022 && (env.name === 'redbeds' || env.name === 'delta') && rng.chance(0.4)) lith = LI.SSTX;
      beds.push({ lith, t, member });
      z += t;
    };
    if (basal) {
      push(rng.chance(0.65) ? LI.CGL : LI.SST, rng.range(0.014, 0.035) * bs);
    }
    let last = null;
    while (z < z1) {
      let m = rng.weighted(env.members.map((mm) => [mm, mm[2]]));
      if (m === last && rng.chance(0.6)) m = rng.weighted(env.members.map((mm) => [mm, mm[2]]));
      last = m;
      const kind = m[0];
      const ms = rng.range(0.75, 1.3) * bs;
      const mEnd = z + rng.range(0.07, 0.26) * bs;
      if (kind === 'alt') {
        let flip = rng.chance(0.5) ? 1 : 0;
        while (z < mEnd) {
          push(m[1][flip], thk(rng, m[1][flip], ms));
          flip ^= 1;
        }
      } else if (kind === 'mass') {
        while (z < mEnd) push(m[1][0], thk(rng, m[1][0], ms * 1.1));
      } else if (kind === 'mix') {
        let prev = -1, run = 0;
        while (z < mEnd) {
          let l = rng.weighted(m[1]);
          if (l === prev) run++;
          else run = 0;
          if (run > 1) {
            l = rng.weighted(m[1]);
          }
          prev = l;
          push(l, thk(rng, l, ms));
        }
      } else if (kind === 'cyclo') {
        while (z < mEnd) {
          push(LI.SH, thk(rng, LI.SH, ms));
          if (rng.chance(0.7)) push(LI.SLT, thk(rng, LI.SLT, ms));
          push(LI.SST, thk(rng, LI.SST, ms * 0.8));
          if (rng.chance(0.75)) push(LI.COAL, thk(rng, LI.COAL, ms));
          if (rng.chance(0.25)) push(LI.LS, thk(rng, LI.LS, ms * 0.6));
        }
      } else if (kind === 'fine') {
        while (z < mEnd) {
          if (rng.chance(0.5)) push(LI.CGL, thk(rng, LI.CGL, ms * 0.8));
          push(LI.SST, thk(rng, LI.SST, ms));
          push(LI.SLT, thk(rng, LI.SLT, ms));
          if (rng.chance(0.3)) push(LI.SH, thk(rng, LI.SH, ms * 0.7));
        }
      } else if (kind === 'rhythm') {
        while (z < mEnd) {
          push(LI.SST, thk(rng, LI.SST, ms * 0.32));
          push(LI.SH, thk(rng, LI.SH, ms * 0.38));
        }
      }
      member++;
    }
    return beds;
  }

  // ---------- history construction ----------
  function newHistory(seed) {
    return {
      seed, events: [], units: [], steps: [], basement: null, land: null, sea: false, seaLevel: 0, soilT: 0,
      trees: [], seqs: [], arch: '', facing: 1,
    };
  }
  function addUnit(H, u) {
    u.id = H.units.length;
    H.units.push(u);
    return u.id;
  }
  function pushEvent(H, e) {
    e.idx = H.events.length;
    H.events.push(e);
    return e;
  }

  function pickPeriods(rng, n) {
    // strictly increasing period indices 1..11, gaps leave room for the events between
    for (let tries = 0; tries < 50; tries++) {
      const out = [];
      let p = rng.int(1, n === 1 ? 9 : n === 2 ? 7 : 4);
      out.push(p);
      let ok = true;
      for (let i = 1; i < n; i++) {
        const lo = p + (rng.chance(0.65) ? 2 : 1);
        const hi = Math.min(11, lo + 3);
        if (lo > 11) { ok = false; break; }
        p = rng.int(lo, hi);
        out.push(p);
      }
      if (ok) return out;
    }
    return n === 1 ? [5] : n === 2 ? [3, 7] : [2, 5, 9];
  }

  function chooseEnv(rng, period, prefer) {
    if (prefer && rng.chance(0.75)) return ENVS[prefer];
    return ENVS[rng.weighted(PERIOD_ENVS[period])];
  }

  // add a depositional sequence on top of an erosion surface
  function addSequence(H, rng, o) {
    const e = new Ev(T_SEQ);
    e.L = o.L;
    e.rel = o.rel || 0;
    e.ef = o.ef || rng.range(2, 5);
    e.es = rng.int(1, 60000);
    const chans = o.chans || [];
    e.nch = chans.length;
    e.chans = new Float64Array(Math.max(3, chans.length * 3));
    let deepest = 0;
    chans.forEach((c, i) => {
      e.chans[i * 3] = c[0];
      e.chans[i * 3 + 1] = c[1];
      e.chans[i * 3 + 2] = c[2];
      deepest = Math.max(deepest, c[2]);
    });
    const startZ = o.L < -100 ? o.zStart : o.L - Math.abs(e.rel) - deepest - 0.006;
    const env = o.env;
    const bs = o.bs || 1;
    const beds = o.beds || buildBeds(rng, env, bs, startZ, o.zEnd == null ? 1.6 : o.zEnd, !!o.basal);
    const nb = beds.length;
    e.nb = nb;
    e.bot = new Float64Array(nb + 1);
    e.amp = new Float64Array(nb + 1);
    e.bthk = new Float64Array(nb);
    e.lith = new Uint8Array(nb);
    e.bunit = new Uint16Array(nb);
    e.bot[0] = -1e9;
    e.bot[nb] = 1e9;
    let z = startZ + beds[0].t;
    for (let k = 1; k < nb; k++) {
      e.bot[k] = z;
      z += beds[k].t;
    }
    const undul = o.undul == null ? rng.range(0.1, 0.4) : o.undul;
    for (let k = 1; k < nb; k++) {
      const below = k > 1 ? e.bot[k] - e.bot[k - 1] : beds[0].t;
      const above = k < nb - 1 ? e.bot[k + 1] - e.bot[k] : beds[k].t;
      e.amp[k] = Math.min(below, above) * undul * rng.range(0.3, 1);
    }
    e.bf = rng.range(2.5, 8);
    e.bs = rng.int(1, 60000);
    e.g = o.g || 0;
    // growth wedges pivot about a level inside the frame (a pivot far below would turn a gentle
    // thickening into a steep dip)
    e.zref = Math.max(startZ, -0.6);
    e.P = 0.0066 * rng.range(0.9, 1.12);
    e.seqIndex = H.seqs.length;
    for (let k = 0; k < nb; k++) {
      e.bthk[k] = beds[k].t;
      e.lith[k] = beds[k].lith;
      e.bunit[k] = addUnit(H, { kind: o.kind || 'bed', lith: beds[k].lith, seq: e.seqIndex, member: beds[k].member, j: rng.next() });
    }
    // channel-sandstone lenses cut into muddy members
    const lens = [];
    if (o.lenses) {
      const n = rng.int(0, o.lenses);
      for (let l = 0; l < n; l++) {
        const k = rng.int(2, nb - 3);
        const host = e.lith[k];
        if (host === LI.SST || host === LI.SSTX || host === LI.CGL || host === LI.CHK || host === LI.LAVA) continue;
        const cz = e.bot[k + 1];
        const L = { cx: rng.range(0.05, 0.95), w: rng.range(0.05, 0.16), t: rng.range(0.012, 0.03) * bs, cz, lith: rng.chance(0.75) ? LI.SSTX : LI.CGL, sd: rng.int(1, 60000) };
        L.unit = addUnit(H, { kind: 'lens', lith: L.lith, seq: e.seqIndex, member: beds[k].member + 0.5, j: rng.next() });
        lens.push(L);
      }
    }
    e.lens = lens;
    e.nlens = lens.length;
    pushEvent(H, e);
    const seq = { ev: e, env, period: o.period, basal: !!o.basal, onBasement: !!o.onBasement, unconf: o.unconf || null, kind: o.kind || 'bed' };
    H.seqs.push(seq);
    H.steps.push({ k: 'seq', seq });
    return e;
  }

  function addFold(H, rng, o) {
    const e = new Ev(T_FOLD);
    const lam = o.lam;
    e.k = (2 * Math.PI) / lam;
    const tilt = o.axTilt || 0; // axial plane tilt from vertical (radians)
    e.ax = Math.sin(tilt);
    e.az = Math.cos(tilt);
    e.nx = Math.cos(tilt);
    e.nz = -Math.sin(tilt);
    e.h2 = o.h2 || 0;
    const ph2 = rng.range(0, Math.PI * 2);
    e.cp2 = Math.cos(ph2);
    e.sp2 = Math.sin(ph2);
    e.chev = o.chev || 0;
    e.ph = rng.range(0, Math.PI * 2);
    const slopeGain = 1 + 2 * e.h2 + 0.6 * e.chev;
    e.A = Math.tan(o.dip) / (e.k * slopeGain);
    if (o.env) {
      e.envC = o.env[0];
      e.envW = o.env[1];
    }
    pushEvent(H, e);
    H.steps.push({ k: 'fold', ev: e, dip: o.dip, lam, tilt, chev: e.chev, local: !!o.env });
    return e;
  }

  // dipDir: +1 the fault plane dips east (to the right), -1 west. sense: 'normal' | 'reverse'
  function addFault(H, rng, o) {
    const e = new Ev(T_FAULT);
    const dip = o.dip;
    const dd = o.dipDir;
    e.px = o.x;
    e.pz = o.z == null ? -0.4 : o.z;
    e.tx = dd * Math.cos(dip);
    e.tz = -Math.sin(dip);
    e.nx = dd * Math.sin(dip);
    e.nz = Math.cos(dip);
    e.D = (o.sense === 'normal' ? 1 : -1) * o.slip;
    e.dr = o.drag == null ? rng.range(0, 0.6) : o.drag;
    e.dw = rng.range(0.01, 0.035);
    pushEvent(H, e);
    H.steps.push({ k: 'fault', ev: e, dip, dipDir: dd, sense: o.sense, slip: o.slip, thrust: o.sense === 'reverse' && dip < 0.8 });
    return e;
  }

  function addRot(H, rng, o) {
    const e = new Ev(T_ROT);
    e.px = o.cx;
    e.pz = o.cz;
    // stored as the inverse rotation
    e.ca = Math.cos(-o.angle);
    e.sa = Math.sin(-o.angle);
    pushEvent(H, e);
    H.steps.push({ k: 'tilt', ev: e, angle: o.angle });
    return e;
  }

  function addDyke(H, rng, o) {
    const e = new Ev(T_DYKE);
    const ang = o.angle; // from vertical
    e.px = o.x;
    e.pz = o.z == null ? -0.5 : o.z;
    e.tx = Math.sin(ang);
    e.tz = Math.cos(ang);
    e.nx = Math.cos(ang);
    e.nz = -Math.sin(ang);
    e.w0 = o.w;
    e.wa = o.wobble == null ? Math.min(rng.range(0.002, 0.012), o.w * 0.45) : o.wobble;
    e.wf = rng.range(3, 8);
    e.ws = rng.int(1, 60000);
    e.tipA = o.tip == null ? 1e9 : o.tip;
    e.tipL = rng.range(0.04, 0.12);
    e.P = 0.0066;
    e.unit = addUnit(H, { kind: 'dyke', lith: LI.DOLERITE, j: rng.next() });
    pushEvent(H, e);
    H.steps.push({ k: 'dyke', ev: e, angle: ang, w: o.w, late: !!o.late });
    return e;
  }

  function addSill(H, rng, o) {
    const e = new Ev(T_SILL);
    e.px = o.x;
    e.pz = o.z;
    e.hw = o.hw;
    e.sl = o.slope || 0;
    e.w0 = o.w;
    e.wa = rng.range(0.002, 0.008);
    e.wf = rng.range(3, 8);
    e.ws = rng.int(1, 60000);
    e.P = 0.0066;
    e.unit = addUnit(H, { kind: 'sill', lith: LI.DOLERITE, j: rng.next() });
    pushEvent(H, e);
    H.steps.push({ k: 'sill', ev: e });
    return e;
  }

  function addPluton(H, rng, o) {
    const e = new Ev(T_PLUTON);
    e.px = o.x;
    e.pz = o.top;
    e.hw = o.hw;
    e.hh = o.hh;
    e.wa = rng.range(0.008, 0.025);
    e.wf = rng.range(3, 7);
    e.ws = rng.int(1, 60000);
    e.aw = o.aureole;
    e.P = 0.0075;
    e.unit = addUnit(H, { kind: 'pluton', lith: LI.GRANITE, j: rng.next() });
    pushEvent(H, e);
    H.steps.push({ k: 'pluton', ev: e });
    return e;
  }

  function setBasement(H, rng, lith) {
    H.basement = { lith, unit: 0, P: lith === LI.GRANITE ? 0.0074 : 0.0068, sd: rng.int(1, 60000) };
    H.basement.unit = addUnit(H, { kind: 'basement', lith, j: rng.next() });
    H.steps.unshift({ k: 'basement', lith });
  }

  function erosion(rng, L, o) {
    o = o || {};
    const chans = [];
    const n = o.chans == null ? rng.int(0, 2) : o.chans;
    for (let i = 0; i < n; i++) chans.push([rng.range(0.05, 0.95), rng.range(0.04, 0.12), rng.range(0.008, 0.03)]);
    return { L, rel: o.rel == null ? rng.range(0.005, 0.02) : o.rel, ef: rng.range(1.5, 4), chans };
  }

  const deg = Math.PI / 180;

  // --- archetypes: recipes for plausible, legible histories ---
  const ARCH = {
    // Hutton's Siccar Point: steep folded strata beneath gently tilted younger beds
    siccar(H, rng) {
      const [p1, p2] = pickPeriods(rng, 2);
      addSequence(H, rng, { L: -1e9, zStart: -3, env: chooseEnv(rng, p1, rng.chance(0.6) ? 'deep' : null), period: p1, bs: rng.range(0.7, 1.15), g: rng.range(-0.15, 0.15), lenses: 1 });
      addFold(H, rng, { lam: rng.range(0.24, 0.6), dip: rng.range(48, 82) * deg, axTilt: rng.range(-24, 24) * deg, chev: rng.chance(0.55) ? rng.range(0.4, 1) : 0, h2: rng.range(0, 0.2) });
      if (rng.chance(0.45)) addFault(H, rng, { x: rng.range(0.15, 0.85), dip: rng.range(60, 82) * deg, dipDir: rng.sign(), sense: rng.chance(0.6) ? 'normal' : 'reverse', slip: rng.range(0.04, 0.12) });
      if (rng.chance(0.3)) addDyke(H, rng, { x: rng.range(0.1, 0.9), angle: rng.range(-20, 20) * deg, w: rng.range(0.012, 0.03) });
      const L1 = rng.range(-0.58, -0.3);
      const tiltA = rng.range(4, 14) * deg * rng.sign();
      addSequence(H, rng, { ...erosion(rng, L1, { chans: rng.int(0, 2) }), env: chooseEnv(rng, p2, rng.chance(0.55) ? 'redbeds' : null), period: p2, bs: rng.range(0.8, 1.3), basal: true, unconf: 'angular' });
      addRot(H, rng, { cx: 0.5, cz: L1, angle: tiltA });
      if (rng.chance(0.4)) addFault(H, rng, { x: rng.range(0.15, 0.85), dip: rng.range(58, 80) * deg, dipDir: rng.sign(), sense: 'normal', slip: rng.range(0.015, 0.05) });
    },
    // the Grand Canyon's Great Unconformity: basement, tilted older strata, flat younger cover
    canyon(H, rng) {
      setBasement(H, rng, rng.weighted([[LI.SCHIST, 2], [LI.GNEISS, 2], [LI.GRANITE, 1.5]]));
      const [p1, p2] = pickPeriods(rng, 2);
      const L0 = rng.range(-0.8, -0.58);
      addSequence(H, rng, { ...erosion(rng, L0, { chans: 0 }), env: chooseEnv(rng, p1), period: p1, bs: rng.range(0.75, 1.15), basal: true, onBasement: true, g: rng.range(-0.2, 0.2), lenses: 1 });
      const nf = rng.int(1, 2);
      for (let i = 0; i < nf; i++) addFault(H, rng, { x: rng.range(0.15, 0.85), z: -0.5, dip: rng.range(55, 75) * deg, dipDir: rng.sign(), sense: 'normal', slip: rng.range(0.05, 0.14) });
      const ta = rng.range(14, 32) * deg * rng.sign();
      addRot(H, rng, { cx: 0.5, cz: -0.55, angle: ta });
      if (rng.chance(0.35)) addDyke(H, rng, { x: rng.range(0.15, 0.85), z: -0.6, angle: rng.range(-15, 15) * deg, w: rng.range(0.01, 0.025) });
      const L1 = rng.range(-0.5, -0.34);
      addSequence(H, rng, { ...erosion(rng, L1, { rel: rng.range(0.004, 0.014), chans: rng.int(0, 1) }), env: chooseEnv(rng, p2, rng.chance(0.5) ? 'shelf' : null), period: p2, bs: rng.range(0.9, 1.4), basal: true, unconf: 'angular', g: rng.range(-0.08, 0.08) });
      if (rng.chance(0.6)) addFault(H, rng, { x: rng.range(0.15, 0.85), dip: rng.range(62, 84) * deg, dipDir: rng.sign(), sense: 'normal', slip: rng.range(0.01, 0.04) });
      if (rng.chance(0.4)) addRot(H, rng, { cx: 0.5, cz: -0.3, angle: rng.range(1, 3) * deg * rng.sign() });
    },
    // a fold-and-thrust belt
    foldbelt(H, rng) {
      const two = rng.chance(0.45);
      const ps = pickPeriods(rng, two ? 2 : 1);
      if (rng.chance(0.4)) setBasement(H, rng, rng.chance(0.5) ? LI.GNEISS : LI.GRANITE);
      const base = H.basement ? { ...erosion(rng, rng.range(-0.98, -0.85), { chans: 0 }), onBasement: true, basal: true } : { L: -1e9, zStart: -3 };
      addSequence(H, rng, { ...base, env: chooseEnv(rng, ps[0], rng.chance(0.5) ? 'shelf' : null), period: ps[0], bs: rng.range(0.6, 1.0), g: rng.range(-0.1, 0.1) });
      const verg = rng.sign();
      const nt = rng.int(1, 3);
      let x = rng.range(0.15, 0.35);
      for (let i = 0; i < nt; i++) {
        addFault(H, rng, { x: x, z: -0.55, dip: rng.range(24, 38) * deg, dipDir: -verg, sense: 'reverse', slip: rng.range(0.09, 0.2), drag: rng.range(0.3, 0.8) });
        x += rng.range(0.22, 0.34);
      }
      addFold(H, rng, { lam: rng.range(0.38, 0.85), dip: rng.range(30, 62) * deg, axTilt: verg * rng.range(14, 34) * deg, chev: rng.chance(0.5) ? rng.range(0.3, 1) : 0, h2: rng.range(0.05, 0.25) });
      if (rng.chance(0.45)) addFold(H, rng, { lam: rng.range(0.07, 0.14), dip: rng.range(12, 28) * deg, axTilt: verg * rng.range(5, 25) * deg, chev: rng.range(0, 1), env: [rng.range(0.2, 0.8), rng.range(0.15, 0.35)] });
      if (two) {
        addSequence(H, rng, { ...erosion(rng, rng.range(-0.3, -0.16), { chans: rng.int(0, 2) }), env: chooseEnv(rng, ps[1]), period: ps[1], bs: rng.range(0.6, 1), basal: true, unconf: 'angular' });
        if (rng.chance(0.5)) addRot(H, rng, { cx: 0.5, cz: -0.2, angle: rng.range(2, 6) * deg * rng.sign() });
      }
    },
    // rifting: tilted fault blocks buried by younger sediment
    rift(H, rng) {
      setBasement(H, rng, rng.weighted([[LI.GRANITE, 2], [LI.GNEISS, 1]]));
      const [p1, p2] = pickPeriods(rng, 2);
      addSequence(H, rng, { ...erosion(rng, rng.range(-0.88, -0.66), { chans: 0 }), env: chooseEnv(rng, p1), period: p1, bs: rng.range(0.7, 1.1), basal: true, onBasement: true });
      const dd = rng.sign();
      const nf = rng.int(2, 4);
      const sp = rng.range(0.22, 0.34);
      let x = rng.range(0.05, 0.2);
      const domino = rng.chance(0.65);
      for (let i = 0; i < nf; i++) {
        const dir = domino ? dd : i % 2 === 0 ? dd : -dd;
        addFault(H, rng, { x, z: -0.5, dip: rng.range(52, 66) * deg, dipDir: dir, sense: 'normal', slip: rng.range(0.06, 0.15) });
        x += sp * rng.range(0.85, 1.15);
      }
      if (domino) addRot(H, rng, { cx: 0.5, cz: -0.5, angle: dd * rng.range(8, 18) * deg });
      const L1 = rng.range(-0.46, -0.3);
      addSequence(H, rng, { ...erosion(rng, L1, { rel: rng.range(0.01, 0.03), chans: rng.int(0, 2) }), env: chooseEnv(rng, p2), period: p2, bs: rng.range(0.85, 1.3), basal: true, unconf: 'angular', g: rng.range(-0.25, 0.25), lenses: 2 });
      if (rng.chance(0.55)) addFault(H, rng, { x: rng.range(0.2, 0.8), dip: rng.range(55, 70) * deg, dipDir: dd, sense: 'normal', slip: rng.range(0.015, 0.045) });
    },
    // magma: a granite pluton with its baked aureole, dykes and sills, lavas above
    igneous(H, rng) {
      const [p1, p2] = pickPeriods(rng, 2);
      addSequence(H, rng, { L: -1e9, zStart: -3, env: chooseEnv(rng, p1), period: p1, bs: rng.range(0.7, 1.1), g: rng.range(-0.15, 0.15), lenses: 1 });
      if (rng.chance(0.6)) addFold(H, rng, { lam: rng.range(0.6, 1.3), dip: rng.range(8, 26) * deg, axTilt: rng.range(-10, 10) * deg });
      const px = rng.chance(0.5) ? rng.range(0.3, 0.7) : rng.chance(0.5) ? rng.range(0.05, 0.3) : rng.range(0.7, 0.95);
      const L1 = rng.range(-0.36, -0.22);
      const unroofed = rng.chance(0.35);
      const top = unroofed ? L1 + rng.range(0.02, 0.1) : rng.range(-0.72, -0.5);
      addPluton(H, rng, unroofed
        ? { x: px, top, hw: rng.range(0.11, 0.2), hh: rng.range(0.4, 0.8), aureole: rng.range(0.03, 0.06) }
        : { x: px, top, hw: rng.range(0.2, 0.4), hh: rng.range(0.15, 0.4), aureole: rng.range(0.035, 0.07) });
      const ns = rng.int(0, 2);
      for (let i = 0; i < ns; i++) addSill(H, rng, { x: px + rng.range(-0.3, 0.3), z: top + rng.range(0.12, 0.3), hw: rng.range(0.15, 0.35), w: rng.range(0.012, 0.028), slope: rng.range(-0.1, 0.1) });
      const nd = rng.int(unroofed ? 0 : 1, 3);
      for (let i = 0; i < nd; i++) addDyke(H, rng, { x: px + rng.range(-0.25, 0.25), z: Math.min(top, -0.5), angle: rng.range(-22, 22) * deg, w: rng.range(0.01, 0.026), tip: rng.chance(0.35) ? rng.range(0.15, 0.3) : null });
      addSequence(H, rng, { ...erosion(rng, L1, { chans: rng.int(0, 1) }), env: chooseEnv(rng, p2, rng.chance(0.6) ? 'volc' : null), period: p2, bs: rng.range(0.85, 1.2), basal: rng.chance(0.6), unconf: 'angular' });
      if (rng.chance(0.4)) addRot(H, rng, { cx: 0.5, cz: L1, angle: rng.range(2, 7) * deg * rng.sign() });
    },
    // a quiet basin: near-flat layer cake, small faults, a disconformity
    basin(H, rng) {
      const two = rng.chance(0.65);
      const ps = pickPeriods(rng, two ? 2 : 1);
      addSequence(H, rng, { L: -1e9, zStart: -3, env: chooseEnv(rng, ps[0]), period: ps[0], bs: rng.range(0.55, 1.35), g: rng.range(-0.3, 0.3), lenses: 3 });
      if (rng.chance(0.4)) addFold(H, rng, { lam: rng.range(0.9, 1.8), dip: rng.range(4, 12) * deg, axTilt: 0 });
      if (two) {
        addRot(H, rng, { cx: 0.5, cz: -0.5, angle: rng.range(1.5, 6) * deg * rng.sign() });
        addSequence(H, rng, { ...erosion(rng, rng.range(-0.55, -0.3), { chans: rng.int(1, 3) }), env: chooseEnv(rng, ps[1]), period: ps[1], bs: rng.range(0.6, 1.3), basal: rng.chance(0.5), unconf: 'disconformity', g: rng.range(-0.2, 0.2), lenses: 2 });
      }
      const nf = rng.int(1, 3);
      for (let i = 0; i < nf; i++) addFault(H, rng, { x: rng.range(0.12, 0.88), dip: rng.range(58, 84) * deg, dipDir: rng.sign(), sense: rng.chance(0.8) ? 'normal' : 'reverse', slip: rng.range(0.008, 0.035), drag: rng.range(0.2, 0.8) });
      if (rng.chance(0.5)) addRot(H, rng, { cx: 0.5, cz: -0.4, angle: rng.range(0.5, 3.5) * deg * rng.sign() });
    },
  };

  function buildLand(H, rng) {
    const L = {
      Ls: rng.range(-0.06, 0.07),
      relA: rng.range(0.012, 0.05),
      relF: rng.range(1.2, 3.2),
      rs: rng.int(1, 60000),
      tilt: rng.range(-0.06, 0.06),
      vc: 0, vw: 0, vd: 0, flood: null, coast: 0, cx0: 0, cDepth: 0,
    };
    H.land = L;
    // the coast first, so a valley can be placed on the landward side of it
    if (rng.chance(0.2)) {
      H.sea = true;
      H.seaLevel = 0;
      L.Ls = Math.max(L.Ls, 0.035) + L.relA * 0.6;
      L.coast = rng.sign();
      L.cx0 = rng.range(0.55, 0.75);
      L.cDepth = rng.range(0.07, 0.13) + L.Ls;
    }
    // a valley, sometimes floored with young river gravels
    if (rng.chance(0.5)) {
      let vc = rng.range(0.12, 0.88);
      if (L.coast) {
        // keep the valley inland: the coast starts at fraction cx0 from the landward edge
        const inland = rng.range(0.1, Math.max(0.12, L.cx0 - 0.2));
        vc = L.coast > 0 ? inland : 1 - inland;
      }
      L.vc = vc;
      L.vw = rng.range(0.09, 0.22);
      L.vd = rng.range(0.03, 0.09);
    }
    const wantFill = L.vw > 0 && rng.chance(0.45);
    if (L.coast) {
      // keep the landward side (valley floor included) above the sea: no stranded inland lakes
      let m = 1e9;
      for (let i = 0; i <= 100; i++) {
        const x = i / 100;
        const t = L.coast > 0 ? x : 1 - x;
        if (t < L.cx0) m = Math.min(m, landZ(H, x));
      }
      if (m < 0.012) {
        L.Ls += 0.012 - m;
        L.cDepth += 0.012 - m;
      }
    }
    if (wantFill) {
      // the surface before the valley was cut
      const vw = L.vw;
      L.vw = 0;
      const base = landZ(H, L.vc);
      L.vw = vw;
      L.flood = base - L.vd * rng.range(0.55, 0.75);
      // alluvium: a sequence whose erosion surface is a U-shaped valley cut
      const cutD = L.vd * rng.range(1.3, 1.9);
      const beds = [];
      let z = base - cutD - 0.01;
      while (z < 0.9) {
        const r = rng.next();
        const lith = r < 0.45 ? LI.ALLUV : r < 0.8 ? LI.SST : LI.SLT;
        const t = lith === LI.ALLUV ? rng.range(0.008, 0.018) : rng.range(0.005, 0.012);
        beds.push({ lith, t, member: 0 });
        z += t;
      }
      const e = addSequence(H, rng, { L: base - cutD, rel: 0, chans: [], beds, env: { name: 'alluv', desc: '' }, period: 12, kind: 'alluv', undul: 0.2 });
      e.bowlC = L.vc + rng.range(-0.15, 0.15) * L.vw;
      e.bowlW = L.vw * rng.range(0.55, 0.8);
      e.bowlD = cutD;
      e.P = 0.0058;
      H.seqs[H.seqs.length - 1].alluvium = true;
    }
    H.soilT = rng.chance(0.75) ? rng.range(0.005, 0.01) : 0;
    // vegetation along the skyline
    const kind = rng.weighted([['conifer', 2], ['broadleaf', 2], ['tuft', 2], ['mixed', 1.5], ['none', 0.8]]);
    H.treeKind = kind;
    if (kind !== 'none') {
      const dens = rng.range(0.25, 1);
      let x = rng.range(0, 0.03);
      while (x < 1) {
        const groupy = vnoise1(x * 7, L.rs + 5) * 0.5 + 0.5;
        if (rng.next() < dens * groupy * groupy * 1.6) {
          let k = kind === 'mixed' ? rng.pick(['conifer', 'broadleaf', 'tuft']) : kind;
          if (k !== 'tuft' && rng.chance(0.35)) k = 'tuft';
          H.trees.push({ x, k, s: rng.range(0.7, 1.25), r: rng.next() });
        }
        x += rng.range(0.008, 0.03);
      }
    }
  }

  // late sprinkles that can happen to any history
  function sprinkles(H, rng) {
    if (rng.chance(0.18)) addDyke(H, rng, { x: rng.range(0.12, 0.88), angle: rng.range(-12, 12) * deg, w: rng.range(0.008, 0.02), late: true, tip: rng.chance(0.5) ? rng.range(0.25, 0.45) : null });
  }

  // ---------- survey: a coarse look at the finished section, used to curate compositions ----------
  const SURVEY_W = 64;
  function survey(H) {
    const Rs = { ps: 1 / SURVEY_W, hwLand: 0.5, hwUnc: 0.5, hwFault: 0.5, hwIgn: 0.5, hwBed: 0.4, hwPat: 0.4, minDot: 0.5, patA: 0.6, bedA: 0.4 };
    const hits = new Uint8Array(H.events.length + 1);
    const counts = new Float64Array(H.units.length);
    const zTop = UNC.GEOM.zTop, zBot = UNC.GEOM.zBot;
    const nh = Math.round((zTop - zBot) * SURVEY_W);
    let rock = 0, sky = 0;
    for (let i = 0; i < SURVEY_W; i++) {
      const X = (i + 0.5) / SURVEY_W;
      const S = landZ(H, X);
      const Sp = (landZ(H, X + 0.002) - landZ(H, X - 0.002)) / 0.004;
      for (let j = 0; j < nh; j++) {
        const Z = zTop - (j + 0.5) / SURVEY_W;
        const u = evaluate(H, Rs, X, Z, S, Sp, hits);
        if (u > 2) {
          counts[u]++;
          rock++;
        } else if (u === 0) sky++;
      }
    }
    H.hits = hits;
    H.unitFrac = new Float64Array(H.units.length);
    let distinct = 0, maxF = 0;
    const massive = H.basement ? H.basement.unit : -1;
    for (let u = 3; u < H.units.length; u++) {
      const f = counts[u] / Math.max(1, rock);
      H.unitFrac[u] = f;
      if (f > 0.002) distinct++;
      // a single bed should not swamp the picture; the crystalline basement is judged separately
      if (f > maxF && u !== massive && H.units[u].kind !== 'pluton') maxF = f;
    }
    const seqFrac = H.seqs.map((s) => {
      let f = 0;
      const e = s.ev;
      for (let k = 0; k < e.nb; k++) f += H.unitFrac[e.bunit[k]];
      for (let l = 0; l < e.nlens; l++) f += H.unitFrac[e.lens[l].unit];
      return f;
    });
    H.seqFrac = seqFrac;
    const skyFrac = sky / (SURVEY_W * nh);
    const faultsSeen = H.events.filter((e) => e.type === T_FAULT && hits[e.idx]).length;
    const ignSeen = H.events.filter((e) => (e.type === T_DYKE || e.type === T_SILL || e.type === T_PLUTON) && hits[e.idx]).length;
    const plutonFrac = H.events.filter((e) => e.type === T_PLUTON).reduce((a, e) => a + H.unitFrac[e.unit], 0);
    const baseFrac = H.basement ? H.unitFrac[H.basement.unit] : 0;
    const main = H.seqs.map((s, i) => (s.alluvium ? 0 : seqFrac[i]));
    let key = true;
    switch (H.arch) {
      case 'siccar': key = main[0] > 0.18 && main[1] > 0.15; break;
      case 'canyon': key = baseFrac > 0.03 && main[0] > 0.1 && main[1] > 0.15; break;
      case 'foldbelt': key = faultsSeen >= 1; break;
      case 'rift': key = faultsSeen >= 2 && main[1] > 0.1; break;
      case 'igneous': key = (plutonFrac > 0.04 || ignSeen >= 2) && plutonFrac < 0.28; break;
      case 'basin': key = faultsSeen >= 1; break;
    }
    let score = 0;
    score += Math.min(1, distinct / 18) * 0.5;
    score += maxF < 0.25 ? 0.3 : (0.3 * 0.25) / maxF;
    score += key ? 0.5 : 0;
    score += skyFrac > 0.07 && skyFrac < 0.32 ? 0.2 : 0;
    score += baseFrac < 0.38 ? 0.2 : 0;
    H.score = score;
    H.ok = key && distinct >= 12 && maxF < 0.3 && baseFrac < 0.38 && skyFrac > 0.07 && skyFrac < 0.32;
    H.skyFrac = skyFrac;
    H.distinct = distinct;
  }

  function build(seed, attempt) {
    const rng = UNC.makeRng('unconformity|' + seed + '|' + attempt);
    const H = newHistory(seed);
    addUnit(H, { kind: 'sky' });
    addUnit(H, { kind: 'water' });
    addUnit(H, { kind: 'soil', lith: LI.SOIL });
    H.arch = UNC.makeRng('arch|' + seed).weighted([['siccar', 20], ['canyon', 17], ['foldbelt', 15], ['rift', 15], ['igneous', 13], ['basin', 16]]);
    ARCH[H.arch](H, rng);
    sprinkles(H, rng);
    buildLand(H, rng);
    H.attempt = attempt;
    return H;
  }

  function generate(seed) {
    let best = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      const H = build(seed, attempt);
      survey(H);
      if (!best || H.score > best.score) best = H;
      if (H.ok) {
        best = H;
        break;
      }
    }
    UNC.describe(best);
    return best;
  }

  Object.assign(UNC, {
    LI, LNAME, ENVS, PERIODS, T_SEQ, T_FOLD, T_FAULT, T_ROT, T_DYKE, T_SILL, T_PLUTON,
    evaluate, OUT, landZ, generate, survey,
  });
})(typeof window !== 'undefined' ? window : globalThis);
