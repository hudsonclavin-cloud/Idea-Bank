#!/usr/bin/env node
// Verifies the Honey Brake dossier. Run from anywhere:  node ideas/11-honey-brake/check.mjs
//  1. index.html carries model.js verbatim and every tagged number matches a fresh build.
//  2. INDEPENDENT recomputation of the physics, written separately from model.js:
//     - the gap field by a Fourier transfer function (model: magnetic charges + image series),
//     - the ring's eddy currents by a stream function and SOR (model: potential and conjugate gradients),
//     - everything downstream (speeds, heat, iron, mass, the pipe, the ramp) with re-typed constants.
//  3. Theory tests of the model's own solvers (c = 1/2 for a round pole, wide-pole limit, energy).
//  4. A small dimensional-analysis kernel checks the units of every formula used.
//  5. The first experiment is simulated end to end: a model-perfect prototype must PASS it, and a late
//     release frame moves a reading near the kill line by as much as the page says.
//  6. README.md quotes the same numbers; folder rules (size, no network).
//  7. Pins for the fixes from the independent review (wording that must not come back).
import fs from 'node:fs';
import path from 'node:path';
import { render, loadModel, DIR } from './build.mjs';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) pass++;
  else {
    fail++;
    console.log(`FAIL  ${msg}`);
  }
}
function near(a, b, tol, msg) {
  ok(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ${b} (tol ${tol})`);
}
function rel(a, b, r, msg) {
  ok(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= r * Math.abs(b), `${msg}: got ${a}, expected ${b} (rel ${r})`);
}
// a quoted string must equal the independent value rounded the same way (one unit of slack in the last place)
function quotes(str, value, msg) {
  const d = (String(str).split('.')[1] || '').length;
  near(Number(str), Number(value.toFixed(d)), 1.01 * 10 ** -d, `quoted ${msg}`);
}

const t0 = Date.now();
const modelCode = fs.readFileSync(path.join(DIR, 'model.js'), 'utf8');
const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
const readme = fs.readFileSync(path.join(DIR, 'README.md'), 'utf8');
const M = loadModel(modelCode);
const q = M.quoted();
const B = M.BASE;

// ---------------------------------------------------------------- 1. page vs model
{
  const a = html.indexOf('/*MODEL:BEGIN*/') + '/*MODEL:BEGIN*/'.length;
  const b = html.indexOf('/*MODEL:END*/');
  ok(html.slice(a, b).trim() === modelCode.trim(), 'inline model in index.html is byte-identical to model.js');
  const fresh = render(html, modelCode);
  if (fresh.html !== html) {
    let i = 0;
    while (i < html.length && html[i] === fresh.html[i]) i++;
    ok(false, `index.html is stale vs model.js (run node build.mjs); first difference near: ${JSON.stringify(html.slice(Math.max(0, i - 60), i + 40))}`);
  } else ok(true, '');
  ok(fresh.count > 250, `expected >250 tagged numbers, found ${fresh.count}`);
  const tags = [...html.matchAll(/data-v="([^"]+)"[^>]*>([^<]*)</g)];
  for (const [, key, text] of tags) ok(/^-?\d+(\.\d+)?$/.test(text), `tag ${key} holds a clean number (got "${text}")`);
  for (const [k, v] of Object.entries(q)) ok(/^-?\d+(\.\d+)?$/.test(v), `quoted ${k} is finite (got "${v}")`);
  const used = new Set(tags.map((t) => t[1]));
  const unused = Object.keys(q).filter((k) => !used.has(k) && !readme.includes(q[k]));
  ok(unused.length === 0, `quoted() keys neither on the page nor in the README: ${unused.join(', ')}`);
}

// ---------------------------------------------------------------- 2. independent recomputation
// Own constants, re-typed.
const G0 = 9.80665;
const MU0 = 1.25663706212e-6;
const IACS = 5.8e7;
const MUREC = 1.05;
const BR52 = 1.44;
const BR42 = 1.3;

// 2a. radix-2 FFT (in place, complex as two Float64Arrays)
function fft1(re, im, inv) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inv ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k + len / 2] = re[i + k] - ar;
        im[i + k + len / 2] = im[i + k] - ai;
        re[i + k] += ar;
        im[i + k] += ai;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
  if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}
function fft2(re, im, nx, ny, inv) {
  const rr = new Float64Array(nx);
  const ri = new Float64Array(nx);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) { rr[i] = re[j * nx + i]; ri[i] = im[j * nx + i]; }
    fft1(rr, ri, inv);
    for (let i = 0; i < nx; i++) { re[j * nx + i] = rr[i]; im[j * nx + i] = ri[i]; }
  }
  const cr = new Float64Array(ny);
  const ci = new Float64Array(ny);
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) { cr[j] = re[j * nx + i]; ci[j] = im[j * nx + i]; }
    fft1(cr, ci, inv);
    for (let j = 0; j < ny; j++) { re[j * nx + i] = cr[j]; im[j * nx + i] = ci[j]; }
  }
}

// 2b. Fourier field of an alternating row of square poles between ideal iron planes.
// Charge sheets +-1 (units of M) at z = +-g2, iron (phi = 0) at z = +-D. Transfer functions derived
// from the 1-D Green's function in z for each in-plane wavenumber k (see the dossier, section 3.2).
function fourierField({ a, pitch, n, g2, Lm1, t, NY = 256, Y0 = 64 }) {
  const h = 0.5;
  const NX = 1024;
  const D = g2 + Lm1;
  const X0 = 150; // mm, first pole centre in FFT coordinates
  const src = new Float64Array(NX * NY);
  const w1 = (u) => (Math.abs(u) < a / 2 - 1e-9 ? 1 : Math.abs(Math.abs(u) - a / 2) < 1e-9 ? 0.5 : 0);
  for (let k = 0; k < n; k++) {
    const cx = X0 + k * pitch;
    for (let j = 0; j < NY; j++) {
      const wy = w1(j * h - Y0);
      if (!wy) continue;
      for (let i = 0; i < NX; i++) {
        const wx = w1(i * h - cx);
        if (wx) src[j * NX + i] += (k % 2 ? -1 : 1) * wx * wy;
      }
    }
  }
  const sre = Float64Array.from(src);
  const sim = new Float64Array(NX * NY);
  fft2(sre, sim, NX, NY, false);
  const kOf = (i, N) => ((2 * Math.PI) / (N * h)) * (i <= N / 2 ? i : i - N);
  const make = (T, deriv) => {
    const re = new Float64Array(NX * NY);
    const im = new Float64Array(NX * NY);
    for (let j = 0; j < NY; j++) {
      const ky = kOf(j, NY);
      for (let i = 0; i < NX; i++) {
        const kx = kOf(i, NX);
        const kk = Math.hypot(kx, ky);
        const tf = T(kk);
        let r = sre[j * NX + i] * tf;
        let m = sim[j * NX + i] * tf;
        if (deriv) { const r2 = -m * kx; m = r * kx; r = r2; } // multiply by i kx
        re[j * NX + i] = r;
        im[j * NX + i] = m;
      }
    }
    fft2(re, im, NX, NY, true);
    return re;
  };
  const sh = (x) => Math.sinh(x);
  const Tavg = (k) => (k < 1e-12 ? Lm1 / D : (sh(k * Lm1) / sh(k * D)) * (sh((k * t) / 2) / ((k * t) / 2)));
  const Tmid = (k) => (k < 1e-12 ? Lm1 / D : sh(k * Lm1) / sh(k * D));
  const Tiron = (k) => (k < 1e-12 ? -g2 / D : -sh(k * g2) / sh(k * D)); // downward H at the iron face
  return { h, NX, NY, X0, Y0, src, Bavg: make(Tavg), dBdx: make(Tavg, true), Bmid: make(Tmid), Hiron: make(Tiron) };
}

// 2c. stream-function eddy solve on the ring strip: lap(psi) = dB/dx, psi = 0 on the boundary (SOR).
function streamSolve(F, { a, pitch, n, W, off = 0 }, sharp) {
  const hs = 1;
  const margin = 50;
  const L = (n - 1) * pitch + a + 2 * margin;
  const nx = Math.round(L / hs);
  const ny = Math.round(W / hs);
  const xc0 = margin + a / 2; // first pole centre, strip coordinates
  const at = (arr, x, y) => {
    const i = Math.round((x - xc0 + F.X0) / F.h);
    const j = Math.round((y - W / 2 - off + F.Y0) / F.h);
    return arr[j * F.NX + i];
  };
  const S = new Float64Array((nx + 1) * (ny + 1));
  for (let j = 1; j < ny; j++) {
    for (let i = 1; i < nx; i++) {
      const x = i * hs;
      const y = j * hs;
      if (sharp) {
        const bAt = (xx) => {
          for (let k = 0; k < n; k++) if (Math.abs(xx - (xc0 + k * pitch)) < a / 2 && Math.abs(y - W / 2) < a / 2) return k % 2 ? -1 : 1;
          return 0;
        };
        S[j * (nx + 1) + i] = (bAt(x + hs / 2) - bAt(x - hs / 2)) / hs;
      } else S[j * (nx + 1) + i] = at(F.dBdx, x, y);
    }
  }
  const psi = new Float64Array((nx + 1) * (ny + 1));
  const om = 1.9;
  for (let it = 0; it < 20000; it++) {
    let dmax = 0;
    for (let j = 1; j < ny; j++) {
      for (let i = 1; i < nx; i++) {
        const k = j * (nx + 1) + i;
        const gs = 0.25 * (psi[k - 1] + psi[k + 1] + psi[k - nx - 1] + psi[k + nx + 1] - hs * hs * S[k]);
        const d = om * (gs - psi[k]);
        psi[k] += d;
        if (Math.abs(d) > dmax) dmax = Math.abs(d);
      }
    }
    if (dmax < 1e-11) break;
  }
  let F1 = 0;
  for (let k = 0; k < psi.length; k++) F1 -= psi[k] * S[k] * hs * hs;
  return F1; // drag per unit sigma, thickness, speed, in (B/Br)^2 mm^2
}

const geomBase = { a: 25, pitch: 32, n: 6, W: 60, g2: 4.5, Lm1: 10, t: 5 };
const bc1 = (g) => g.Lm1 / (g.Lm1 + g.g2);
const Fbase = fourierField(geomBase);
let indepOffPpm = NaN;
const kappaInd = streamSolve(Fbase, geomBase) / (6 * 625 * bc1(geomBase) ** 2);
const cSharpInd = streamSolve(Fbase, geomBase, true) / (6 * 625);
const K = M.kappaSolve(B);
{
  // field: centre of the third pole (an interior one), Fourier vs image series
  const xi = Fbase.X0 + 2 * geomBase.pitch;
  const iF = Math.round(xi / Fbase.h);
  const jF = Math.round(Fbase.Y0 / Fbase.h);
  const zg = (Math.sqrt(3 / 5) * 5) / 2;
  let img = 0;
  let imgMid = 0;
  for (let k = 0; k < 6; k++) {
    const dx = (2 - k) * 32;
    const s = k % 2 ? -1 : 1;
    img += s * ((8 / 9) * M.poleB(dx, 0, 0, 25, 4.5, 10, 8) + (5 / 9) * (M.poleB(dx, 0, zg, 25, 4.5, 10, 8) + M.poleB(dx, 0, -zg, 25, 4.5, 10, 8))) / 2;
    imgMid += s * M.poleB(dx, 0, 0, 25, 4.5, 10, 8);
  }
  near(Fbase.Bavg[jF * Fbase.NX + iF], img, 2e-3, 'ring-averaged field at a pole centre: Fourier vs image series');
  near(Fbase.Bmid[jF * Fbase.NX + iF], imgMid, 2e-3, 'mid-plane field at a pole centre: Fourier vs image series');
  // footprint mean (lambda), attraction integral, yoke flux
  let foot = 0;
  let cnt = 0;
  let b2 = 0;
  for (let j = 0; j < Fbase.NY; j++) {
    const y = j * Fbase.h - Fbase.Y0;
    for (let i = 0; i < Fbase.NX; i++) {
      const x = i * Fbase.h - Fbase.X0;
      if (Math.abs(y) <= 30 - 1e-9 && x > -60 && x < 5 * 32 + 60) b2 += Fbase.Bmid[j * Fbase.NX + i] ** 2 * Fbase.h ** 2;
      for (let k = 0; k < 6; k++) {
        const wx = Math.abs(x - k * 32) < 12.5 - 1e-9 ? 1 : Math.abs(Math.abs(x - k * 32) - 12.5) < 1e-9 ? 0.5 : 0;
        const wy = Math.abs(y) < 12.5 - 1e-9 ? 1 : Math.abs(Math.abs(y) - 12.5) < 1e-9 ? 0.5 : 0;
        if (wx && wy) {
          foot += (k % 2 ? -1 : 1) * wx * wy * Fbase.Bavg[j * Fbase.NX + i];
          cnt += wx * wy;
        }
      }
    }
  }
  const lambdaInd = foot / cnt / bc1(geomBase);
  rel(lambdaInd, K.lambda, 0.015, 'lambda (mean field under a pole / 1-D value), Fourier vs model');
  rel(b2 / (6 * 625), K.clampRel, 0.02, 'attraction integral, Fourier vs model');
  let yk = 0;
  for (let j = 0; j < Fbase.NY; j++) {
    const y = j * Fbase.h - Fbase.Y0;
    const wy = Math.abs(y) < 20 - 1e-9 ? 1 : Math.abs(Math.abs(y) - 20) < 1e-9 ? 0.5 : 0;
    if (!wy) continue;
    for (let i = 0; i < Fbase.NX; i++) {
      const x = i * Fbase.h - Fbase.X0;
      const wx = x < 16 - 1e-9 ? 1 : Math.abs(x - 16) < 1e-9 ? 0.5 : 0;
      if (!wx) continue;
      yk += wx * wy * (Fbase.Hiron[j * Fbase.NX + i] + Fbase.src[j * Fbase.NX + i]) * Fbase.h ** 2;
    }
  }
  rel(yk / 625, K.yokeRel, 0.02, 'yoke flux / (Br A), Fourier vs model');
  rel(kappaInd, K.kappa, 0.02, 'kappa: stream function + SOR on the Fourier field vs model');
  rel(cSharpInd, Number(q.cSharp), 0.02, 'sharp-footprint c, independent solve');
  near(K.energyCheck, 1, 1e-6, 'model sheet solve: dissipation equals drag x speed');
  for (const [pairs, key] of [[4, 'kappa4'], [10, 'kappa10']]) {
    const g = Object.assign({}, geomBase, { n: pairs });
    const kk = streamSolve(fourierField(g), g) / (pairs * 625 * bc1(g) ** 2);
    rel(kk, Number(q[key]), 0.02, `kappa with ${pairs} poles, independent`);
  }
  {
    const g = Object.assign({}, geomBase, { g2: 5.5 });
    const kk = streamSolve(fourierField(g), g) / (6 * 625 * bc1(g) ** 2);
    rel(kk, Number(q.kappa_cl3), 0.02, 'kappa with 3 mm clearances, independent');
  }
  {
    // the bracket slid off (poles 10 mm clear of the ring's edge): Fourier field on a taller grid, stream function
    const g = Object.assign({}, geomBase, { NY: 512, Y0: 128 });
    const Fo = fourierField(g);
    const on = streamSolve(Fo, g);
    const offF = streamSolve(Fo, Object.assign({}, g, { off: (0.19 - (0.16 - 0.0125) + 0.01) * 1000 }));
    const frac = offF / on;
    ok(frac > 0 && frac < 1e-4, `bracket slid off: leftover drag ${(frac * 1e6).toFixed(1)} ppm of engaged, independent`);
    indepOffPpm = frac * 1e6;
    rel(frac * 1e6, Number(q.offDrag_ppm), 0.2, 'leftover drag with the bracket slid off (ppm), Fourier + stream function vs model');
  }
}

// 2d. downstream, from the INDEPENDENT kappa, re-typed constants
const indep = {};
{
  const th = Math.atan(1 / 12);
  const Wt = 100 * G0;
  const fNet = Wt * Math.sin(th) - 0.012 * Wt * Math.cos(th);
  quotes(q.fNet, fNet, 'net push on 1:12 (N)');
  quotes(q.thetaDeg, (th * 180) / Math.PI, 'slope angle');
  const bC = BR52 / (1 + (MUREC * 0.009) / 0.02);
  quotes(q.bClosed, bC, '1-D closed-circuit field (T)');
  const sig = 0.43 * IACS;
  const kPair = 0.9 * kappaInd * sig * 0.005 * bC * bC * 0.025 ** 2;
  const r = (0.38 - 0.06) / 2;
  const R = 0.61 / 2;
  const kW = (6 * kPair * r * r) / (R * R);
  const kC = 2 * kW;
  const vT = fNet / kC;
  rel(kPair, Number(q.kPair), 0.025, 'force per pole position per m/s (independent kappa)');
  rel(kC, Number(q.kChair), 0.025, 'chair brake coefficient (independent kappa)');
  rel(vT, Number(q.vT), 0.025, 'steady speed on 1:12 (independent kappa)');
  // the same chain with the model's kappa must match the quoted numbers to the last digit
  const kPairM = 0.9 * K.kappa * sig * 0.005 * bC * bC * 0.025 ** 2;
  const kCM = (2 * 6 * kPairM * r * r) / (R * R);
  const vTM = fNet / kCM;
  quotes(q.kPair, kPairM, 'kPair');
  quotes(q.kWheel, kCM / 2, 'kWheel');
  quotes(q.kChair, kCM, 'kChair');
  quotes(q.vT, vTM, 'vT');
  quotes(q.vKmh, vTM * 3.6, 'vT km/h');
  quotes(q.vRing, (vTM * r) / R, 'ring speed');
  quotes(q.power, fNet * vTM, 'brake power (W)');
  quotes(q.levelDrag, kCM * 1.0, 'drag on the flat at 1 m/s');
  quotes(q.w, 2 / (MU0 * sig * 0.005), 'thin-sheet characteristic speed');
  // plate: annulus + hub ring + six spokes, 5 mm 6061
  const ro = 0.19;
  const ri = 0.13;
  const aRing = Math.PI * (ro * ro - ri * ri);
  const aHub = Math.PI * (0.05 ** 2 - 0.03 ** 2);
  const aSp = 6 * 0.02 * (ri - 0.05);
  const mPlate = (aRing + aHub + aSp) * 0.005 * 2700;
  quotes(q.plateMass, mPlate, 'plate mass');
  const Ipl = 0.005 * 2700 * (aRing * (ro * ro + ri * ri) / 2 + aHub * (0.05 ** 2 + 0.03 ** 2) / 2 + aSp * (ri * ri + ri * 0.05 + 0.05 * 0.05) / 3);
  const mEff = 100 + (2 * (0.15 + Ipl)) / (R * R);
  quotes(q.mEff, mEff, 'effective mass');
  quotes(q.tau, mEff / kCM, 'time constant');
  for (const [run, key] of [[20, 'vT_20'], [8, 'vT_8'], [5, 'vT_5']]) {
    const t2 = Math.atan(1 / run);
    quotes(q[key], (Wt * Math.sin(t2) - 0.012 * Wt * Math.cos(t2)) / kCM, `steady speed on 1:${run}`);
  }
  quotes(q.vT_m70, (fNet * 0.7) / kCM, 'steady speed, 70 kg');
  quotes(q.vT_m130, (fNet * 1.3) / kCM, 'steady speed, 130 kg');
  quotes(q.vT_1100, (vTM * 0.43) / 0.57, 'steady speed, 1100 alloy');
  quotes(q.vT_copper, (vTM * 0.43) / 1.0, 'steady speed, copper');
  quotes(q.vT_sh, vTM * (BR52 / BR42) ** 2, 'steady speed, N42SH');
  quotes(q.vT_eta75, (vTM * 0.9) / 0.75, 'steady speed, eta 0.75');
  // heat: steady rise with resistivity feedback, closed form dT = c / (1 - alpha c)
  const UA = 8 * 2 * (aRing + aHub + aSp);
  const cTh = (fNet * fNet) / (2 * kCM * UA);
  const rise = cTh / (1 - 0.004 * cTh);
  quotes(q.steadyRise, rise, 'steady ring temperature rise');
  quotes(q.vTHot, vTM * (1 + 0.004 * rise), 'hot steady speed');
  quotes(q.tauThermal_min, (mPlate * 900) / UA / 60, 'thermal time constant');
  const drop = 1000 / Math.hypot(1, 12);
  const fRoll = 0.012 * Wt * Math.cos(th);
  quotes(q.hillAdiabatic_K, (100 * G0 * drop - fRoll * 1000) / 2 / (mPlate * 900), '1 km adiabatic bound');
  quotes(q.hFlat, (0.664 * 0.026 * Math.sqrt((vTM * 0.38) / 1.6e-5) * Math.cbrt(0.71)) / 0.38, 'flat-plate convection');
  // ramp run: free roll vs braked, by RK4 integration
  {
    const L = 9.144;
    const aF = fNet / mEff;
    quotes(q.rampFree, Math.sqrt(0.25 + 2 * aF * L), 'free-rolling speed at the foot of the ramp');
    let x = 0;
    let v = 0.5;
    let t = 0;
    const dt = 1e-4;
    const f = (vv) => (fNet - kCM * vv) / mEff;
    while (x < L) {
      const k1 = f(v);
      const k2 = f(v + 0.5 * dt * k1);
      const k3 = f(v + 0.5 * dt * k2);
      const k4 = f(v + dt * k3);
      x += v * dt;
      v += (dt * (k1 + 2 * k2 + 2 * k3 + k4)) / 6;
      t += dt;
    }
    quotes(q.rampEnd, v, 'braked speed at the foot of the ramp (RK4)');
    quotes(q.rampTBrake, t, 'braked ramp time (RK4)');
    quotes(q.rampHands, 100 * G0 * L * Math.sin(th) - 0.012 * Wt * Math.cos(th) * L, 'energy for the hands on one ramp run');
  }
  // iron, mass, size
  const yokeFlux = K.yokeRel * BR52 * 0.025 ** 2;
  const tY = yokeFlux / (1.5 * 0.04);
  quotes(q.yokeT_mm, tY * 1000, 'yoke thickness (mm)');
  const mMag = 12 * 0.025 * 0.025 * 0.01 * 7500;
  const mYoke = 6 * 0.04 * tY * 0.032 * 7850;
  const arc = 6 * 0.032 + 0.02;
  const ang = arc / 0.16; // rad, the bracket's span
  const mJaw = 2 * (ang / 2) * (0.2 ** 2 - 0.14 ** 2) * 0.006 * 2700; // two annular sectors, r 140..200 mm
  const stack = 2 * (0.006 + tY + 0.01 + 0.002) + 0.005;
  const mBridge = ang * 0.203 * stack * 0.006 * 2700; // curved band joining the jaws, at r 200..206 mm
  quotes(q.jawMass, mJaw, 'jaw mass');
  quotes(q.bridgeMass, mBridge, 'bridge mass');
  quotes(q.structureMass, mJaw + mBridge + 0.15, 'jaws, bridge and fittings');
  const perWheel = mPlate + mMag + mYoke + mJaw + mBridge + 0.15;
  quotes(q.magnetMass, mMag, 'magnet mass per wheel');
  quotes(q.yokeMass, mYoke, 'tapered yoke mass');
  quotes(q.perWheel, perWheel, 'mass per wheel');
  quotes(q.perChair, 2 * perWheel, 'mass per chair');
  quotes(q.stack_mm, stack * 1000, 'bracket thickness across the ring');
  quotes(q.widenMax_cm, 2 * stack * 100, 'worst-case widening of the chair');
  quotes(q.offPushN, 2 * perWheel * 0.012 * G0, 'extra rolling resistance from the added mass');
  quotes(q.offPushPct, ((2 * perWheel) / (100 - 2 * perWheel)) * 100, 'extra push on the flat, brake off (%)');
  quotes(q.half_mm, (0.006 + tY + 0.01 + 0.002) * 1000, 'bracket thickness on one side');
  quotes(q.slide_mm, (0.19 - (0.16 - 0.0125) + 0.01) * 1000, 'disengage travel');
  const clampPair = (K.clampRel * (BR52 * (bC / (BR52 / (1 + 0.009 / 0.02)))) ** 2 * 0.025 ** 2) / (2 * MU0);
  quotes(q.clamp, clampPair, 'attraction per pole position');
  quotes(q.clampTotal, 6 * clampPair, 'attraction per bracket');
  {
    // jaw deflection by virtual work round the U-frame (jaw, bridge, jaw), integrated numerically:
    // relative closing of the two pole lines = sum of M m / EI ds with m the moment of a unit pair of loads
    const F = 6 * clampPair;
    const Ij = (arc * 0.006 ** 3) / 12;
    const Ib = (ang * 0.203 * 0.006 ** 3) / 12;
    const Lb = stack - 0.006; // jaw centre to jaw centre
    let closing = 0;
    const nq = 2000;
    for (let i = 0; i < nq; i++) {
      const x = ((i + 0.5) * 0.04) / nq; // along a jaw, from the pole line
      closing += (2 * (F * x) * x * (0.04 / nq)) / (69e9 * Ij);
    }
    for (let i = 0; i < nq; i++) closing += ((F * 0.04) * 0.04 * (Lb / nq)) / (69e9 * Ib);
    quotes(q.jawDeflect_mm, (closing / 2) * 1000, 'jaw deflection at the pole line (virtual work, jaws + bridge)');
    quotes(q.jawBend_mm, ((F * 0.04 ** 3) / (3 * 69e9 * Ij)) * 1000, 'jaw bending alone');
    ok(Number(q.jawDeflect_mm) < 0.1 * 2, 'jaw deflection under a tenth of the 2 mm clearance');
  }
  quotes(q.arcDeg, ((6 * 0.032) / r) * (180 / Math.PI), 'bracket arc');
  quotes(q.cost, 12 * 5 + 40 + 20 + 60, 'cost per wheel');
  Object.assign(indep, { fNet, kC, kCM, mEff, R, r, Ipl });
}

// 2e. the copper pipe: direct quadrature of EMF^2 / R over rings, sphere magnet
{
  const rs = 0.00635;
  const m = (BR42 * (4 / 3) * Math.PI * rs ** 3) / MU0;
  const sig = 0.85 * IACS;
  const ri = 0.01384 / 2;
  const ro = 0.015875 / 2;
  // P/v^2 = sigma * sum over shells dr and slices dz of (dPhi/dz)^2 * dr dz / (2 pi rr)
  const dPhidz = (rr, z) => {
    const e = 1e-7;
    const Phi = (zz) => (MU0 * m * rr * rr) / (2 * (rr * rr + zz * zz) ** 1.5);
    return (Phi(z + e) - Phi(z - e)) / (2 * e);
  };
  let k = 0;
  const nr = 40;
  const nth = 400;
  for (let a = 0; a < nr; a++) {
    const rr = ri + ((a + 0.5) * (ro - ri)) / nr;
    let s = 0;
    for (let b = 0; b < nth; b++) {
      const thv = -Math.PI / 2 + ((b + 0.5) * Math.PI) / nth;
      const z = rr * Math.tan(thv);
      const dz = (rr / Math.cos(thv) ** 2) * (Math.PI / nth);
      s += dPhidz(rr, z) ** 2 * dz;
    }
    k += (sig * s * ((ro - ri) / nr)) / (2 * Math.PI * rr);
  }
  rel(k, Number(q.pipeK), 0.005, 'pipe drag coefficient by direct quadrature');
  const mass = 7500 * (4 / 3) * Math.PI * rs ** 3;
  quotes(q.pipeV_cm, ((mass * G0) / k) * 100, 'sphere terminal speed (cm/s)');
  quotes(q.pipeT, 1.5 / ((mass * G0) / k), 'sphere fall time over 1.5 m');
  // moment ACROSS the pipe: Fourier transform of B_r(z) on a thin shell (a = 1), m = 1 charge projection
  // k^2/(k^2 + 1/a^2), against the axial dipole's integral 2 pi * (5 pi / 128) * 9 = 45 pi^2 / 64... per pi
  const gTr = (z) => (2 - z * z) / (1 + z * z) ** 2.5;
  const Zm = 80;
  const nz = 16000;
  const dzz = (2 * Zm) / nz;
  let num = 0;
  const nk = 3000;
  const kmax = 30;
  for (let j = 0; j < nk; j++) {
    const kk = ((j + 0.5) * kmax) / nk;
    let G = 0;
    for (let i = 0; i < nz; i++) {
      const z = -Zm + (i + 0.5) * dzz;
      G += gTr(z) * Math.cos(kk * z) * dzz;
    }
    num += G * G * ((kk * kk) / (kk * kk + 1)) * (kmax / nk);
  }
  const trans = num / Math.PI;                 // (1/pi) ∫0^inf |G|^2 k^2/(k^2+1) dk = ∫ (J^2) dz / pi, per pi a
  const axial = 2 * ((9 * 5 * Math.PI) / 128); // 2 ∫ (3z)^2/(1+z^2)^5 dz, the Wallis integral
  rel(trans / axial, M.pipeTransverseRatio(), 0.003, 'pipe: transverse/axial drag ratio, Fourier vs model ODE');
  quotes(q.pipeTransRatio, trans / axial, 'pipe: transverse/axial drag ratio');
  quotes(q.pipeTTrans, (1.5 / ((mass * G0) / k)) * (trans / axial), 'sphere fall time with its moment across the pipe');
  ok(Number(q.pipeTTrans) < Number(q.pipeT), 'a sphere with its moment across the pipe falls FASTER');
}

// 2f. pre-mortem products
{
  const tech = 0.85 * 0.8 * 0.9 * 0.95;
  quotes(q.pPhysics, 85, 'physics-only survival % (the field risk alone)');
  quotes(q.pTechnical, tech * 100, 'technical survival %');
  quotes(q.pProduct, tech * 0.6 * 0.65 * 0.8 * 0.85 * 0.8 * 100, 'overall survival %');
}

// ---------------------------------------------------------------- 3. theory tests of the model's solvers
{
  // c = 1/2: a round pole on a large sheet (model's own sheetSolve). Finite sheets read a little low.
  const run = (L, shape) => {
    const h = 1;
    const n = Math.round(L / h);
    const Bf = new Float64Array(n * (n + 1));
    let area = 0;
    for (let jf = 1; jf < n; jf++) {
      for (let i = 0; i < n; i++) {
        const x = (i + 0.5) * h - L / 2;
        const y = jf * h - L / 2;
        const inside = shape === 'disc' ? x * x + y * y < 14.1 ** 2 : Math.abs(x) < 12.5 && Math.abs(y) < 12.5;
        if (inside) { Bf[jf * n + i] = 1; area += h * h; }
      }
    }
    return M.sheetSolve(Bf, n, n, h, 1e-9).drag / area;
  };
  const c150 = run(150, 'disc');
  const c300 = run(300, 'disc');
  ok(c300 > c150, `round pole: c grows toward 1/2 as the sheet grows (${c150.toFixed(4)} -> ${c300.toFixed(4)})`);
  near(c300, 0.5, 0.015, 'round pole on a 300 mm sheet: c close to 1/2');
  near(run(300, 'square'), 0.5, 0.025, 'square pole on a 300 mm sheet: c close to 1/2');
  // wide-pole limit of the image-series field equals the 1-D circuit with muRec = 1
  near(M.poleB(0, 0, 0, 400, 4.5, 10, 400), 10 / 14.5, 2e-4, 'image-series field of a very wide pole equals the 1-D value');
  // monotonic sanity
  ok(Number(q.kappa4) < Number(q.kappa) && Number(q.kappa) < Number(q.kappa10), 'kappa grows with the number of poles (end effects shrink)');
  ok(Number(q.kappa_cl3) < Number(q.kappa), 'kappa falls as the clearance grows');
  ok(Number(q.cSharpSingle) < 0.5 && Number(q.cSharp) > 0.5, 'one pole on a narrow ring: c < 1/2; alternating row: c > 1/2');
  ok(Number(q.vOverW_pct) < 10, 'ring speed is far below the thin-sheet speed w (linear brake law holds)');
  const T = M.thermal();
  ok(T.vTHot > M.descent().vT, 'a hot ring brakes less');
  ok(M.descent({ pairs: 8 }).vT < M.descent().vT && M.descent().vT < M.descent({ pairs: 4 }).vT, 'more poles -> slower');
  ok(M.descent({ massTotal: 130 }).vT > M.descent().vT, 'heavier rider -> faster');
  ok(M.descent({ slopeRun: 1e6 }).vT < 1e-9 || M.hill({ slopeRun: 1e6 }).fNet < 0, 'on the flat the chair does not roll by itself');
  ok(M.premortem().pProduct < M.premortem().pTechnical, 'adoption risks only lower the odds');
  ok(M.RISKS.every((r) => r.p > 0 && r.p < 1), 'each risk is a probability');
  ok(B.pairs % 2 === 0, 'pole count is even (each yoke pairs two poles)');
  ok(M.pipe().clearance > 0, 'the sphere fits the pipe');
}

// ---------------------------------------------------------------- 4. dimensional analysis
{
  const DIMS = ['kg', 'm', 's', 'A', 'K'];
  const U = (v, d = {}) => ({ v, d: Object.fromEntries(DIMS.map((k) => [k, d[k] || 0])) });
  const mul = (a, b) => U(a.v * b.v, Object.fromEntries(DIMS.map((k) => [k, a.d[k] + b.d[k]])));
  const div = (a, b) => U(a.v / b.v, Object.fromEntries(DIMS.map((k) => [k, a.d[k] - b.d[k]])));
  const pow = (a, n) => U(a.v ** n, Object.fromEntries(DIMS.map((k) => [k, a.d[k] * n])));
  const add = (a, b) => {
    ok(DIMS.every((k) => Math.abs(a.d[k] - b.d[k]) < 1e-12), `unit mismatch in addition: ${JSON.stringify(a.d)} + ${JSON.stringify(b.d)}`);
    return U(a.v + b.v, a.d);
  };
  const is = (a, d, name) => ok(DIMS.every((k) => Math.abs(a.d[k] - (d[k] || 0)) < 1e-12), `units of ${name}: got ${JSON.stringify(a.d)}`);
  const N = { kg: 1, m: 1, s: -2 };
  const W = { kg: 1, m: 2, s: -3 };
  const Tesla = { kg: 1, s: -2, A: -1 };
  const mu0 = U(MU0, { kg: 1, m: 1, s: -2, A: -2 });
  const sigma = U(2.5e7, { kg: -1, m: -3, s: 3, A: 2 });
  const Bt = U(0.98, Tesla);
  const d = U(0.005, { m: 1 });
  const A = U(6.25e-4, { m: 2 });
  const v = U(1, { m: 1, s: -1 });
  const mass = U(100, { kg: 1 });
  const g = U(G0, { m: 1, s: -2 });
  is(mul(mass, g), N, 'weight (N)');
  is(div(pow(Bt, 1), mu0), { A: 1, m: -1 }, 'B / mu0 = H (A/m)');
  const kp = mul(mul(mul(sigma, d), pow(Bt, 2)), A);
  is(kp, { kg: 1, s: -1 }, 'kappa sigma d B^2 A (N s/m)');
  is(mul(kp, v), N, 'eddy drag (N)');
  const r = U(0.16, { m: 1 });
  const R = U(0.305, { m: 1 });
  is(mul(kp, pow(r, 2)), { kg: 1, m: 2, s: -1 }, 'torque coefficient (N m s)');
  is(div(mul(kp, pow(r, 2)), pow(R, 2)), { kg: 1, s: -1 }, 'ground brake coefficient (N s/m)');
  is(div(mul(mass, g), kp), { m: 1, s: -1 }, 'steady speed (m/s)');
  is(div(mass, kp), { s: 1 }, 'time constant (s)');
  is(mul(mul(mass, g), v), W, 'brake power (W)');
  is(mul(mul(mu0, sigma), mul(d, v)), {}, 'magnetic Reynolds number mu0 sigma d v');
  is(div(U(2), mul(mul(mu0, sigma), d)), { m: 1, s: -1 }, 'thin-sheet speed w = 2/(mu0 sigma d)');
  is(div(mul(pow(Bt, 2), A), mu0), N, 'attraction B^2 A / (2 mu0)');
  is(div(mul(Bt, A), mul(Bt, U(0.04, { m: 1 }))), { m: 1 }, 'yoke thickness = flux / (B_sat width)');
  const UA = mul(U(8, { kg: 1, s: -3, K: -1 }), U(0.15, { m: 2 }));
  is(div(U(30, W), UA), { K: 1 }, 'steady temperature rise');
  is(div(mul(U(1, { kg: 1 }), U(900, { m: 2, s: -2, K: -1 })), UA), { s: 1 }, 'thermal time constant');
  const mom = div(mul(Bt, U(1e-6, { m: 3 })), mu0);
  is(mom, { A: 1, m: 2 }, 'dipole moment Br V / mu0');
  is(mul(mul(pow(mu0, 2), pow(mom, 2)), mul(sigma, U(1e6, { m: -3 }))), { kg: 1, s: -1 }, 'pipe drag coefficient mu0^2 m^2 sigma / r^3');
  is(div(mul(U(2, { kg: 1 }), g), U(0.5, { m: 1, s: -1 })), { kg: 1, s: -1 }, 'experiment: delta(m g) / delta(v)');
  is(add(mul(mass, g), U(-11.7, N)), N, 'net push = weight component - rolling resistance');
  const h = U(5.8, { kg: 1, s: -3, K: -1 });
  is(div(mul(mul(U(0.664), U(0.026, { kg: 1, m: 1, s: -3, K: -1 })), pow(div(mul(v, U(0.38, { m: 1 })), U(1.6e-5, { m: 2, s: -1 })), 0.5)), U(0.38, { m: 1 })), h.d, 'flat-plate h');
}

// ---------------------------------------------------------------- 5. the first experiment, simulated
// Integrate the falling weight (RK4) for a prototype with a given true brake coefficient, timestamp
// release and both marks with 240 fps video frames (plus a deliberate one-frame slip in spotting the
// release), then analyse the frames two ways: the model's analyse() and an independent Newton fit.
{
  const E = M.experiment();
  const X = M.EXP;
  const Rr = indep.R;
  const I = 0.15 + indep.Ipl;
  function film(kTrue, friction, phase, slip, exact) {
    const out = [];
    for (const m of [X.m1, X.m2]) {
      const mEff = m + I / (Rr * Rr);
      let x = 0;
      let v = 0;
      let t = 0;
      const dt = 2e-5;
      let tA = null;
      let tB = null;
      const acc = (vv) => (m * G0 - friction - kTrue * vv) / mEff;
      while (tB === null) {
        const k1 = acc(v);
        const k2 = acc(v + 0.5 * dt * k1);
        const k3 = acc(v + 0.5 * dt * k2);
        const k4 = acc(v + dt * k3);
        const xn = x + dt * (v + (dt * (k1 + k2 + k3)) / 6);
        const vn = v + (dt * (k1 + 2 * k2 + 2 * k3 + k4)) / 6;
        if (tA === null && xn >= X.runUp) tA = t + ((X.runUp - x) / (xn - x)) * dt;
        if (xn >= X.runUp + X.timed) tB = t + ((X.runUp + X.timed - x) / (xn - x)) * dt;
        x = xn;
        v = vn;
        t += dt;
      }
        if (exact) {
        out.push([tA - slip / X.fps, tB - slip / X.fps]);
        continue;
      }
      const frame = (tt) => (Math.ceil(tt * X.fps + phase) - phase) / X.fps;
      const t0 = frame(0) + slip / X.fps;
      out.push([frame(tA) - t0, frame(tB) - t0]);
    }
    return out;
  }
  // independent fit: Newton on (v, tau) with an analytic Jacobian
  function fitNewton(L1, t1, L2, t2) {
    let v = L2 / t2;
    let tau = 0.1;
    for (let i = 0; i < 100; i++) {
      const e1 = Math.exp(-t1 / tau);
      const e2 = Math.exp(-t2 / tau);
      const s1 = t1 - tau * (1 - e1);
      const s2 = t2 - tau * (1 - e2);
      const r1 = v * s1 - L1;
      const r2 = v * s2 - L2;
      const d1 = -(1 - e1) + (t1 / tau) * e1;
      const d2 = -(1 - e2) + (t2 / tau) * e2;
      const det = s1 * v * d2 - s2 * v * d1;
      const dv = (r1 * v * d2 - r2 * v * d1) / det;
      const dtau = (s1 * r2 - s2 * r1) / det;
      v -= dv;
      tau = Math.max(1e-5, tau - dtau);
      if (Math.abs(dv) < 1e-14 && Math.abs(dtau) < 1e-14) break;
    }
    return v;
  }
  const kOf = (tt, which) => {
    if (which === 'model') return M.analyse(null, tt[0][0], tt[0][1], tt[1][0], tt[1][1]).k;
    const v1 = fitNewton(X.runUp, tt[0][0], X.runUp + X.timed, tt[0][1]);
    const v2 = fitNewton(X.runUp, tt[1][0], X.runUp + X.timed, tt[1][1]);
    return ((X.m2 - X.m1) * G0) / (v2 - v1);
  };
  // exact (unquantised) predicted times from the model reproduce kWheel through both analyses
  const exact = [[E.A.tA, E.A.tB], [E.B.tA, E.B.tB]];
  rel(kOf(exact, 'model'), E.kWheel, 1e-6, 'analyse() recovers kWheel from the predicted times');
  rel(kOf(exact, 'newton'), E.kWheel, 1e-6, 'independent Newton fit recovers kWheel from the predicted times');
  for (const f of [0, X.friction, 1.0]) {
    for (const phase of [0.1, 0.5, 0.9]) {
      for (const slip of [-1, 0, 1]) {
        const tt = film(E.kWheel, f, phase, slip);
        const k = kOf(tt, 'model');
        ok(k >= E.kPass, `model-perfect prototype PASSES (friction ${f} N, phase ${phase}, release slip ${slip} frame): reads ${k.toFixed(2)} >= ${E.kPass.toFixed(2)}`);
        rel(k, E.kWheel, 0.03, `model-perfect prototype reads its own k within 3% (friction ${f}, phase ${phase}, slip ${slip})`);
        rel(kOf(tt, 'newton'), k, 1e-6, 'Newton fit agrees with analyse() on filmed data');
      }
    }
  }
  quotes(q.expTA1, E.A.tA, 'time to mark A, 2 kg');
  quotes(q.expTB2, E.B.tB, 'time to mark B, 4 kg');
  ok(E.kKill < E.kPass && E.kPass < E.kWheel, 'kill line < pass line < model prediction');
  quotes(q.expPass, indep.fNet / (2 * X.vTarget), 'pass line = fNet / (2 v_target)');
  quotes(q.expKill, (indep.fNet / (2 * X.vTarget)) * (6 / 10) * (Number(q.kappa) / Number(q.kappa10)), 'kill line: even 10 poles miss the target');
  for (const slip of [-1, 0, 1]) {
    ok(kOf(film(E.kPass * 1.04, X.friction, 0.5, slip), 'model') >= E.kPass, `a prototype 4% above the pass line reads above it (slip ${slip})`);
    ok(kOf(film(E.kKill * 0.96, X.friction, 0.5, slip), 'model') < E.kKill, `a prototype 4% below the kill line reads below it (slip ${slip})`);
  }
  // release-frame sensitivity (the page's warning): RK4 times, the release read whole frames late
  const slipPct = (k, frames) => (kOf(film(k, X.friction, 0, frames, true), 'model') / k - 1) * 100;
  quotes(q.expSlipKill3_pct, slipPct(E.kKill, 3), 'k error at the kill line, release read 3 frames late (%)');
  quotes(q.expSlipKill6_pct, slipPct(E.kKill, 6), 'k error at the kill line, release read 6 frames late (%)');
  quotes(q.expSlipModel6_pct, slipPct(E.kWheel, 6), 'k error at the model value, release read 6 frames late (%)');
  quotes(q.expSlip3_ms, (3 / X.fps) * 1000, 'three frames (ms)');
  ok(kOf(film(E.kKill * 0.96, X.friction, 0, 6, true), 'model') > E.kKill, 'a release read 6 frames late lifts a wheel 4% below the kill line above it (why the page warns)');
  ok(Math.abs(slipPct(E.kKill, -3)) > 4, 'near the kill line, 3 frames of release error exceed the 4% margin either way');
  {
    // how far the 4 kg weight has fallen 3 frames after release (RK4)
    const mEff = X.m2 + I / (Rr * Rr);
    let x = 0;
    let v = 0;
    const dt = 1e-6;
    const acc = (vv) => (X.m2 * G0 - X.friction - E.kWheel * vv) / mEff;
    for (let t = 0; t < 3 / X.fps - 1e-12; t += dt) {
      const k1 = acc(v);
      const k2 = acc(v + 0.5 * dt * k1);
      const k3 = acc(v + 0.5 * dt * k2);
      const k4 = acc(v + dt * k3);
      x += dt * (v + (dt * (k1 + k2 + k3)) / 6);
      v += (dt * (k1 + 2 * k2 + 2 * k3 + k4)) / 6;
    }
    quotes(q.expRelease3_mm, x * 1000, '4 kg weight fall 3 frames after release (mm)');
  }
  // why the fit: the naive mean-speed reading would rescue a dead prototype
  ok(Number(q.expWeakNaive) > E.kKill && Number(q.expWeakTrue) < E.kKill, 'naive mean-speed analysis would read a below-kill prototype as alive (the fit does not)');
  near(Number(q.expWeakFit), Number(q.expWeakTrue), 0.11, 'the fit reads the weak prototype correctly');
  quotes(q.expV2, (X.m2 * G0 - X.friction) / E.kWheel, 'heavy-weight speed');
  quotes(q.expV1, (X.m1 * G0 - X.friction) / E.kWheel, 'light-weight speed');
  ok(X.vTarget > Number(q.vT), 'model speed on 1:12 is inside the target');
}

// ---------------------------------------------------------------- 6. README agrees, folder rules
{
  const pct = (x) => `${Math.round(x * 100)}%`;
  const need = [
    `**Kind:** dossier`, `**Run:** open index.html in a browser`, `**Made by:** Lenzwright`,
    '## What it is', '## Why I made it', '## The key numbers', '## Honest assessment', '## The first experiment',
    `**κ = ${q.kappa}, the brake's shape factor`, `B = ${q.bClosed} T`, `only ${q.lambda} of B`, `c = ${q.cSharp}`,
    `giving ${q.kappaEta}`, `It gets ${kappaInd.toFixed(3)}`, `η = ${B.eta.toFixed(2)}`,
    `**${q.kChair} N·s/m of braking for the chair, so ${q.vT} m/s (${q.vKmh} km/h) on 1:12.**`,
    `${q.kPair} N per m/s of ring speed`, `${q.rRing_mm} mm radius on a ${q.R_mm} mm tyre`, `(r/R)² = ${q.speedRatio2}`,
    `${q.fNet} N net push`, `time constant of ${q.tau} s`, `${q.rampRun} m ADA ramp run at ${q.rampFree} m/s`,
    `${q.vT_20} m/s on 1:20, ${q.vT_8} m/s on 1:8`,
    `**${q.perChair} kg added to the chair (${q.perWheel} kg per wheel).**`, `the disc, ${q.plateMass} kg`, `twelve magnets, ${q.magnetMass} kg`,
    `six tapered steel yokes, ${q.yokeMass} kg`, `(${q.yokeFlux_uWb} µWb`, `${q.yokeT_mm} mm thick at ${M.PHYS.bSteelMax} T and ${B.barW * 1000} mm wide`,
    `jaws, the bridge that joins them, and fittings, ${q.structureMass} kg`, `${q.perChair4} kg per chair and is faster, at ${q.vT_4pairs} m/s`,
    `**${q.stack_mm} mm across the disc, ${q.half_mm} mm of it on the spoke side.**`,
    `${q.power} W into heat, ${q.powerPerRing} W per disc`, `h ≈ ${B.hConv} W/m²K`, `gives ${q.hFlat} at walking pace`,
    `levels off ${q.steadyRise} K above the air`, `by only ${q.hillAdiabatic_K} K`,
    `${q.vOverW_pct}% of the thin-sheet speed scale w = ${q.w} m/s`, `about ${q.linearErr_pct}%`,
    `Going to 3 mm costs ${q.brakeLoss_cl3}% of the braking`, `${q.clampTotal} N per bracket`, `about ${q.jawDeflect_mm} mm of deflection`,
    `$${q.costChair} a chair`, `to ${M.EXP.vTarget} m/s, a brisk walk`,
    `**Overall:** ${q.pPhysics}% that a well-built prototype brakes well enough to clear the experiment's kill line`,
    `${q.pTechnical}% that it also survives the other three`, `And ${q.pProduct}% that it becomes`,
    `at worst makes the chair ${q.widenMax_cm} cm wider`, `each wheel then carries its ${q.plateMass} kg disc`, `about ${q.offPushPct}% more push`,
    `3 frames (${q.expSlip3_ms} ms) late puts k_wheel about ${q.expSlipKill3_pct}% high`, `6 frames about ${q.expSlipKill6_pct}%`,
    `6 frames move it only ${q.expSlipModel6_pct}%`, `has moved just ${q.expRelease3_mm} mm`,
    '## Revision note: independent review', `It is now ${q.pPhysics}% that the brake clears the experiment's kill line, ${q.pTechnical}% that it also survives`,
    `the brake adds ${q.perChair} kg a chair instead of 5.6`, `(4-pole: ${q.perChair4} instead of 4.5 kg)`, `The jaws deflect ${q.jawDeflect_mm} mm instead of 0.06`,
    `sees ${q.pipeTransRatio}× the drag and falls in about ${q.pipeTTrans} s, faster than the ${q.pipeT} s`,
    `mounting (${pct(M.RISKS.find((r) => r.id === 'mounting').p)}) and weight (${pct(M.RISKS.find((r) => r.id === 'weight').p)})`,
    `about $${M.EXP.costUSD} and a weekend`, `drop a ${M.EXP.m1} kg and then a ${M.EXP.m2} kg weight`, `Film at ${M.EXP.fps} fps`,
    `a mark ${M.EXP.runUp} m down, and a mark ${q.expMarkB} m down`, `divide ${M.EXP.timed} m by the time`,
    `A prototype at ${q.expWeakTrue} N·s/m`, `would read ${q.expWeakNaive} N·s/m`,
    `k_wheel = ${q.kWheel} N·s/m`, `passes the marks at ${q.expTA1} s and ${q.expTB1} s`, `at ${q.expTA2} s and ${q.expTB2} s`,
    `k_wheel ≥ ${q.expPass} N·s/m`, `it is ${q.expPassFrac}% of the model`, `Every case reads ${q.expRead} ± 3%`,
    `k_wheel < ${q.expKill} N·s/m (${q.expKillFrac}% of the model)`, `(${q.arcDeg10}° of arc, ${q.perWheel10} kg per wheel)`,
    `a product of ${q.draftKappa}`, `κ = ${q.kappa} (${q.kappaEta} after η)`, `${q.draftRatio}× stronger`, `from ${q.vT_draft} m/s to ${q.vT} m/s`,
    `disagreed by ${pct(Number(q.draftRatio) - 1)}`, `lifts the factor to ${q.cSharp}`, `the honest blocker is ${q.perChair} kg and a ${q.stack_mm} mm-thick bracket`,
    `from 15 to ${B.hConv} W/m²K`,
  ];
  for (const s of need) ok(readme.includes(s), `README mentions "${s}"`);
  ok(!readme.includes(`**Overall:** ${q.pTechnical}%`), 'README no longer puts the 58% on "brakes as the page says"');
  ok(readme.trimEnd().split('\n## ').pop().startsWith('Revision note: independent review'), 'README ends with the independent-review revision note');
  let bytes = 0;
  for (const f of fs.readdirSync(DIR)) if (!/^preview\.(jpg|png)$/.test(f)) bytes += fs.statSync(path.join(DIR, f)).size;
  ok(bytes < 500 * 1024, `folder under 500 KB (is ${(bytes / 1024).toFixed(0)} KB)`);
  const urls = [...html.matchAll(/https?:\/\/[^\s"'<)]+/g)].map((m) => m[0]).filter((u) => u !== 'http://www.w3.org/2000/svg');
  ok(urls.length === 0, `no external URLs in index.html (${urls.join(', ')})`);
  ok(!/\bfetch\(|XMLHttpRequest|<link\b|<script[^>]+src=|@import/i.test(html), 'no network calls or external assets');
  ok(/<meta name="viewport" content="width=device-width, initial-scale=1">/.test(html), 'viewport meta present');
  ok(/prefers-color-scheme: dark/.test(html), 'dark theme present');
}

// ---------------------------------------------------------------- 7. pins for the independent review's fixes
{
  const page = html.slice(0, html.indexOf('/*MODEL:BEGIN*/'));
  ok(!page.includes('braking as this page says'), 'verdict no longer puts the technical-survival % on "braking as this page says"');
  ok(page.includes('<span data-v="pPhysics">') && page.includes('clear the experiment\'s kill line'), 'verdict and pre-mortem quote the physics-only probability');
  ok(!/steepest ramp the ADA allows \(1:12\)/.test(page) && page.includes('ADA maximum for new ramps') && page.includes('Table 405.2'), '1:12 is the ADA maximum for new ramps, with the existing-site exception');
  ok(!page.includes('speed limits on walkers') && /10,864,393 \(Burke\)[^<]*is not a walker\. A trolley runs along a guide rail/.test(page), 'US 10,864,393 described as a rail-and-trolley system, not a walker');
  ok(!page.includes('tumbles or rubs the wall will fall slower') && page.includes('data-v="pipeTTrans"'), 'pipe caveat: a transverse moment falls faster');
  ok(page.includes('data-v="bridgeMass"') && page.includes('data-v="bridgeTip_mm"'), 'bridge counted in the mass table and the deflection');
  ok(page.includes('cutting the thread in shot') && page.includes('data-v="expSlipKill6_pct"') && html.includes('Close to a line: re-read the release frame'), 'experiment warns about the release frame, and the analyser flags readings near a line');
  ok(page.includes('Living with it') && page.includes('data-v="offDrag_ppm"') && page.includes('quick-release') && page.includes('camber'), '§3.7 covers wheel removal, camber, width and the off-state cost');
  ok(page.includes('id="review"') && page.includes('href="#review"'), 'page carries the independent-review revision note');
  const Hw = M.hardware();
  ok(Hw.bridgeMass > 0 && Math.abs(Hw.structureMass - (Hw.jawMass + Hw.bridgeMass + B.fittingsMass)) < 1e-12, 'model: structure mass includes the bridge');
  ok(Hw.jawDeflect > Hw.jawBend * 2, 'model: the bridge\'s bending more than doubles the jaw deflection');
}

console.log(`\ncheck: ${pass} passed, ${fail} failed  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
console.log(`slid off: ${q.offDrag_ppm} ppm of the engaged drag (independent ${indepOffPpm.toFixed(1)}); pipe across/along ${q.pipeTransRatio}`);
console.log(`base case: kappa ${q.kappa} (independent ${kappaInd.toFixed(3)}), ${q.vT} m/s on 1:12, ${q.perChair} kg per chair, bracket ${q.stack_mm} mm thick; experiment pass ${q.expPass} / model ${q.kWheel} / kill ${q.expKill} N s/m`);
process.exit(fail ? 1 : 0);
