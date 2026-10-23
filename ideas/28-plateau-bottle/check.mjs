#!/usr/bin/env node
// Verifies the Plateau Bottle dossier. Run from anywhere:  node ideas/28-plateau-bottle/check.mjs
//  1. index.html carries model.js verbatim and every tagged number matches a fresh build.
//  2. The headline numbers are recomputed by an INDEPENDENT solver written below (smeared phase
//     change instead of a sharp one, 10 wax slices instead of 6, rubber and foam split differently,
//     a 1 s step) and by closed forms using constants re-typed here.
//  3. A small dimensional-analysis kernel checks the units of every formula used.
//  4. Physics sanity: energy closure, explicit-scheme stability, the melting-point ceiling,
//     and that the phase change (not the extra insulation) does the work.
//  5. The first test: a model-perfect jacket passes; the designs it must reject are rejected;
//     the pass survives plausible errors in the phantom.
//  6. Every claim in the prose that is a comparison is asserted, and README.md quotes the model.
//  7. No network, size budget. 8. If Playwright is available, the live calculator matches the model.
// Exits non-zero on any failure.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
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

const modelCode = fs.readFileSync(path.join(DIR, 'model.js'), 'utf8');
const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
const readme = fs.readFileSync(path.join(DIR, 'README.md'), 'utf8');
const M = loadModel(modelCode);
const q = M.quoted();
const num = (k) => {
  if (!(k in q)) throw new Error(`no quoted key ${k}`);
  return Number(q[k]);
};
const A = (...a) => Object.assign({}, ...a);

// ---------------------------------------------------------------- 1. page vs model
{
  const a = html.indexOf('/*MODEL:BEGIN*/') + '/*MODEL:BEGIN*/'.length;
  const b = html.indexOf('/*MODEL:END*/');
  ok(html.slice(a, b).trim() === modelCode.trim(), 'inline model in index.html is byte-identical to model.js');
  const fresh = render(html, modelCode, q);
  if (fresh.html !== html) {
    let i = 0;
    while (i < html.length && html[i] === fresh.html[i]) i++;
    ok(false, `index.html is stale vs model.js (run node build.mjs); first difference near: ${JSON.stringify(html.slice(Math.max(0, i - 80), i + 40))}`);
  } else ok(true, '');
  ok(fresh.count > 300, `expected >300 tagged numbers, found ${fresh.count}`);
  const tags = [...html.matchAll(/data-v="([^"]+)"[^>]*>([^<]*)</g)];
  for (const [, key, text] of tags) ok(/^-?\d+(\.\d+)?$/.test(text), `tag ${key} holds a clean number (got "${text}")`);
  for (const [k, v] of Object.entries(q)) ok(/^-?\d+(\.\d+)?$/.test(v), `quoted ${k} is a finite number (got "${v}")`);
  // the burn-cause bar is drawn with flex weights that must match the evidence
  for (const [cls, share] of [['s1', M.EVIDENCE.shareRupture], ['s2', M.EVIDENCE.shareSpill], ['s3', M.EVIDENCE.shareContact]]) {
    const m = new RegExp(`class="seg ${cls}" style="flex:([0-9.]+)"`).exec(html);
    ok(m && Math.abs(Number(m[1]) - share) < 1e-9, `bar segment ${cls} drawn at ${m && m[1]} vs evidence ${share}`);
  }
  near(M.EVIDENCE.shareRupture + M.EVIDENCE.shareSpill + M.EVIDENCE.shareContact, 100, 0.05, 'burn-cause shares sum to 100%');
}

// ---------------------------------------------------------------- 2a. constants, re-typed
const K = {
  cW: 4186, rhoW: 1000, hW: 200, kR: 0.13, rhoR: 1100, cR: 1900,
  Tm: 43.8, L: 175000, kS: 0.37, kL: 0.19, rhoS: 1007, rhoL: 868, cX: 2020,
  TmSAT: 58, LSAT: 264000, cSAT: 2500, rhoSAT: 1450,
  kF: 0.04, rcF: 45000, kSkin: 0.37, rhoSkin: 1100, cSkin: 3500, tog: 0.1,
};
{
  const P = M.PHYS;
  const map = { cW: 'cWater', rhoW: 'rhoWater', hW: 'hWater', kR: 'kRubber', rhoR: 'rhoRubber', cR: 'cRubber', Tm: 'TmWax', L: 'LWax', kS: 'kWaxS', kL: 'kWaxL', rhoS: 'rhoWaxS', rhoL: 'rhoWaxL', cX: 'cWax', TmSAT: 'TmSAT', LSAT: 'LSAT', cSAT: 'cSAT', rhoSAT: 'rhoSAT', kF: 'kFoam', rcF: 'rhoCFoam', kSkin: 'kSkin', rhoSkin: 'rhoSkin', cSkin: 'cSkin', tog: 'tog' };
  for (const [k, mk] of Object.entries(map)) ok(P[mk] === K[k], `constant ${mk}: model ${P[mk]} vs re-typed ${K[k]}`);
}

// ---------------------------------------------------------------- 2b. independent solver
// A separately written explicit finite-volume solver. Same physics, different numerics:
// smeared melting over Tm +/- 0.1 K, 10 wax slices, rubber in two slices, foam in 5 mm slices,
// a global loop over paths with its own bookkeeping, dt = 1 s.
function indSim(cfg) {
  const p = A(M.BASE, cfg);
  const dt = 1;
  const dM = 0.1; // half-width of the smeared melting range, K
  const area = p.faceW * p.faceH;
  const topW = p.flipped ? p.waxFaces >= 2 : p.waxFaces >= 1;
  const botW = p.flipped ? p.waxFaces >= 1 : p.waxFaces >= 2;
  const lat = K.L * p.latentScale;
  function path(kind, wax, a) {
    const n = [];
    for (let i = 0; i < 2; i++) n.push({ w: false, dx: p.rubberT / 2, k: K.kR, c: K.rhoR * K.cR * (p.rubberT / 2), T: p.tRoom, tag: 'rub' });
    if (wax) {
      const N = 10;
      const dx = p.waxT / N;
      for (let i = 0; i < N; i++) {
        const cs = K.rhoS * K.cX * dx; // J/m2K
        const lt = K.rhoS * lat * dx; // J/m2
        const hA = cs * (K.Tm - dM);
        n.push({ w: true, dx, cs, hA, hB: hA + lt + cs * 2 * dM, H: cs * p.tRoom, tag: 'wax' });
      }
    }
    if (kind === 'mat') {
      const N = 8;
      for (let i = 0; i < N; i++) n.push({ w: false, dx: 0.04 / N, k: K.kF, c: K.rcF * (0.04 / N), T: p.tRoom, tag: 'foam' });
    }
    return { kind, n, a, touching: kind === 'skin' && !(p.preWarmMin > 0) };
  }
  const temp = (x) => {
    if (!x.w) return x.T;
    if (x.H <= x.hA) return x.H / x.cs;
    if (x.H <= x.hB) return K.Tm - dM + (2 * dM * (x.H - x.hA)) / (x.hB - x.hA);
    return K.Tm + dM + (x.H - x.hB) / x.cs;
  };
  const frac = (x) => Math.min(1, Math.max(0, (x.H - x.hA) / (x.hB - x.hA)));
  const half = (x) => {
    if (!x.w) return x.dx / 2 / x.k;
    const f = frac(x);
    return (x.dx / 2) * ((1 - f) / p.kSolid + (f * (K.rhoS / K.rhoL)) / (p.kLiquid * p.convLiq));
  };
  const paths = p.layout === 'bench'
    ? [path('skin', topW, area * p.contactFrac), path('duvet', topW, area * (1 - p.contactFrac)), path('duvet', botW, area)]
    : [path('skin', topW, area * p.contactFrac), path('duvet', topW, area * (1 - p.contactFrac)), path('mat', botW, area)];
  const ins = p.insertKg || 0;
  const Cw = (p.waterL * 1e-3 - (ins ? ins / K.rhoSAT : 0)) * K.rhoW * K.cW;
  const Ctot = Cw + ins * K.cSAT;
  let H = Cw * p.tFill + ins * K.cSAT * p.tRoom;
  const Tw = () => (H <= Ctot * K.TmSAT ? H / Ctot : H <= Ctot * K.TmSAT + ins * K.LSAT ? K.TmSAT : (H - ins * K.LSAT) / Ctot);
  const tC = Math.round((p.preWarmMin || 0) * 60);
  const total = tC + p.hours * 3600;
  const rDuvet = p.rAirGap + p.duvetTog * K.tog;
  const surf = (P) => {
    const last = P.n[P.n.length - 1];
    const rs = half(last) + p.rCover;
    const ro = rs + (P.touching ? p.rTissue : rDuvet);
    const sink = P.touching ? p.tCore : p.tRoom;
    const tl = temp(last);
    return tl - ((tl - sink) / ro) * rs;
  };
  const out = { peak: -1e9, s43: 0, sBand: 0, s48: 0, tw1: NaN, ts1: NaN, melt: 0 };
  for (let t = 0; t <= total; t += dt) {
    if (t >= tC) paths[0].touching = true;
    const sk = paths[0];
    let mw = 0;
    let nw = 0;
    for (const x of sk.n) if (x.w) {
      mw += frac(x);
      nw++;
    }
    if (nw && mw / nw > out.melt) out.melt = mw / nw;
    if (t >= tC) {
      const ts = surf(sk);
      if (ts > out.peak) out.peak = ts;
      if (t < total) {
        if (ts > 43) out.s43 += dt;
        if (ts > 48) out.s48 += dt;
        if (ts >= 38 && ts <= 43) out.sBand += dt;
      }
      if (t - tC === 3600) {
        out.tw1 = Tw();
        out.ts1 = ts;
      }
    }
    if (t === total) break;
    const tw = Tw();
    let draw = 0;
    for (const P of paths) {
      const n = P.n;
      const T = n.map(temp);
      const flux = new Array(n.length + 1);
      flux[0] = (tw - T[0]) / (1 / K.hW + half(n[0]));
      for (let i = 1; i < n.length; i++) {
        let r = half(n[i - 1]) + half(n[i]);
        if (n[i - 1].tag === 'rub' && n[i].tag === 'wax') r += p.rContact + p.rSpacer;
        if (n[i].tag === 'foam' && n[i - 1].tag !== 'foam') r += p.rCover;
        flux[i] = (T[i - 1] - T[i]) / r;
      }
      const last = n[n.length - 1];
      let rOut;
      let sink;
      if (P.kind === 'mat') {
        rOut = half(last) + p.foamRest;
        sink = p.tRoom;
      } else {
        rOut = half(last) + p.rCover + (P.touching ? p.rTissue : rDuvet);
        sink = P.touching ? p.tCore : p.tRoom;
      }
      flux[n.length] = (T[n.length - 1] - sink) / rOut;
      for (let i = 0; i < n.length; i++) {
        const dE = (flux[i] - flux[i + 1]) * dt;
        if (n[i].w) n[i].H += dE;
        else n[i].T += dE / n[i].c;
      }
      draw += flux[0] * P.a;
    }
    H -= (draw + p.uaEdge * (tw - p.tRoom)) * dt;
  }
  return out;
}

const indDiffs = { n: 0, peak: 0, h43: 0, band: 0 };
{
  const tolPeak = 0.4;
  const tolH = 0.2;
  const tolBand = 0.3;
  const cmp = (label, cfg, keys) => {
    const r = indSim(cfg);
    if (keys.peak) indDiffs.peak = Math.max(indDiffs.peak, Math.abs(r.peak - num(keys.peak)));
    if (keys.h43) indDiffs.h43 = Math.max(indDiffs.h43, Math.abs(r.s43 / 3600 - num(keys.h43)));
    if (keys.band) indDiffs.band = Math.max(indDiffs.band, Math.abs(r.sBand / 3600 - num(keys.band)));
    indDiffs.n++;
    if (keys.peak) near(r.peak, num(keys.peak), tolPeak, `${label}: peak (independent solver)`);
    if (keys.h43) near(r.s43 / 3600, num(keys.h43), tolH, `${label}: hours above 43 (independent solver)`);
    if (keys.band) near(r.sBand / 3600, num(keys.band), tolBand, `${label}: hours in band (independent solver)`);
    if (keys.min48) near(r.s48 / 60, num(keys.min48), 3, `${label}: minutes above 48 (independent solver)`);
    if (keys.tw1) near(r.tw1, num(keys.tw1), 1.0, `${label}: water at 1 h (independent solver)`);
    if (keys.ts1) near(r.ts1, num(keys.ts1), tolPeak, `${label}: skin at 1 h (independent solver)`);
    return r;
  };
  const thick = M.thickCover();
  cmp('original as instructed', M.ORIGINAL, { peak: 'O_peak', h43: 'O_h43', band: 'O_band', min48: 'O_min48', tw1: 'O_Tw1h', ts1: 'O_Ts1h' });
  cmp('plateau as instructed', M.REDESIGN, { peak: 'R_peak', h43: 'R_h43', band: 'R_band', tw1: 'R_Tw1h', ts1: 'R_Ts1h' });
  cmp('thick cover as instructed', thick, { peak: 'S_asTold_thick_peak', band: 'S_asTold_thick_band' });
  const bad = M.SCENARIOS.find((s) => s.id === 'poorKettle').o;
  cmp('plateau, bad night', A(M.REDESIGN, bad), { peak: 'S_poorKettle_plateau_peak', h43: 'S_poorKettle_plateau_h43' });
  cmp('original, bad night', A(M.ORIGINAL, bad), { peak: 'S_poorKettle_orig_peak', h43: 'S_poorKettle_orig_h43' });
  cmp('thick, bad night', A(thick, bad), { peak: 'S_poorKettle_thick_peak', h43: 'S_poorKettle_thick_h43' });
  cmp('plateau, kettle-hot', A(M.REDESIGN, { tFill: 95 }), { peak: 'S_kettle_plateau_peak', h43: 'S_kettle_plateau_h43' });
  cmp('plateau, warm skin', A(M.REDESIGN, { rTissue: 0.015 }), { peak: 'S_warmSkin_plateau_peak' });
  cmp('no-spacer jacket, bad night', A(M.REDESIGN, bad, { rSpacer: 0 }), { peak: 'A_noSpacer_badPeak', h43: 'A_noSpacer_badH43' });
  cmp('dummy jacket, bad night', A(M.REDESIGN, bad, { latentScale: 0 }), { peak: 'A_dummy_badPeak' });
  cmp('salt insert, as instructed', A(M.ORIGINAL, { insertKg: 0.4 }), { peak: 'A_insert_peak', h43: 'A_insert_h43' });
  cmp('plateau, kettle + 2 h empty bed', A(M.REDESIGN, { tFill: 95, preWarmMin: 120 }), { peak: 'P_120_peak' });
  cmp('bench A, plateau', A(M.REDESIGN, M.BENCH_A), { peak: 'BA_plateau_peak', band: 'BA_plateau_band' });
  cmp('bench B, plateau', A(M.REDESIGN, M.BENCH_B), { peak: 'BB_plateau_peak', band: 'BB_plateau_band' });
  cmp('bench B, thick cover', A(thick, M.BENCH_B), { peak: 'BB_thick_peak' });
  cmp('bench B, seal-line bound', A(M.REDESIGN, M.BENCH_B, { waxT: M.SEAL_LAYER_T }), { peak: 'BB_half_peak' });

  // thinnest safe cover by an independent bisection on the independent solver
  let lo = 0.05;
  let hi = 0.6;
  for (let i = 0; i < 16; i++) {
    const mid = 0.5 * (lo + hi);
    if (indSim(A(M.ORIGINAL, { rCover: mid })).peak > 43) lo = mid;
    else hi = mid;
  }
  near(hi, num('T_thinnest'), 0.006, 'thinnest safe cover (independent bisection, independent solver)');
}

// ---------------------------------------------------------------- 2c. closed forms from re-typed constants
{
  const eS = Math.sqrt(K.kSkin * K.rhoSkin * K.cSkin);
  const eR = Math.sqrt(K.kR * K.rhoR * K.cR);
  near(eS, num('E_skin'), 0.5, 'skin effusivity');
  near(eR, num('E_rubber'), 0.5, 'rubber effusivity');
  near((eS * 33 + eR * 80) / (eS + eR), num('C_bareFirst'), 0.05, 'first-second contact temperature, bare rubber at 80 C');
  const rW = 1 / K.hW + 0.002 / K.kR;
  near(rW, num('C_rWall'), 5e-5, 'wall resistance incl. water film');
  const st = (tHot, rWall, rT) => 37 + ((tHot - 37) * rT) / (rT + rWall);
  near(st(80, rW, 0.03), num('C_bareSteady'), 0.05, 'steady skin, bare bottle');
  near(st(80, rW + 0.05, 0.03), num('C_fleeceSteady'), 0.05, 'steady skin, fleece');
  near(st(K.Tm, 0.015, 0.03), num('C_plateauHi'), 0.05, 'plateau, front at the sleeve');
  near(st(K.Tm, 0.015 + 0.0075 / K.kS, 0.03), num('C_plateauLo'), 0.05, 'plateau, front at the water side');
  near(st(K.Tm, 0.015, 0.06), num('C_plateauPoor'), 0.05, 'plateau, poor circulation');
  near(K.Tm, num('C_plateauBare'), 0.05, 'ceiling = melting point');
  const cv = (tw, rT) => (rT * (tw - 37)) / (43 - 37) - rT - rW;
  near(cv(80, 0.03), num('CV_asTold'), 5e-4, 'cover needed, as instructed');
  near(cv(95, 0.03), num('CV_kettle'), 5e-4, 'cover needed, kettle');
  near(cv(80, 0.06), num('CV_poor'), 5e-4, 'cover needed, poor circulation');
  near(cv(95, 0.06), num('CV_poorKettle'), 5e-4, 'cover needed, both');
  near(cv(95, 0.06) * 0.04 * 1000, num('CV_poorKettleMM'), 0.5, 'that cover in mm of fleece');
  near(st(60, rW + cv(95, 0.06), 0.015), num('CV_heavyCool'), 0.05, 'heavy cover on a careful, warm-skinned night');
  const area = 0.18 * 0.28;
  const wax = 2 * area * 0.0075 * K.rhoS;
  near(wax * 1000, num('G_waxTotal'), 0.5, 'wax mass');
  near(area * 1e4, num('G_faceA'), 0.5, 'face area cm2');
  near((K.rhoS / K.rhoL - 1) * 100, num('G_swellPct'), 0.5, 'swell on melting %');
  // two layers of six 42 x 174 mm tubes at 4.3 mm average the stated 7.5 mm over the face
  near((2 * 0.0043 * 6 * 0.042 * 0.174) / area, 0.0075, 0.0075 * 0.01, 'two layers of 4.3 mm tubes = 7.5 mm average');
  near(1.4 * K.cW * (80 - K.Tm) / 1000, num('B_excess80'), 0.5, 'excess heat at 80 C');
  near(1.4 * K.cW * (95 - K.Tm) / 1000, num('B_excess95'), 0.5, 'excess heat at 95 C');
  near(wax * K.L / 1000, num('B_latent'), 0.5, 'latent store');
  near(wax * K.cX * (K.Tm - 18) / 1000, num('B_sensible'), 0.5, 'sensible store');
  near((wax * K.L + wax * K.cX * (K.Tm - 18)) / 1000, num('B_store'), 0.5, 'total store');
  near((K.rhoS * K.L * 0.0075 ** 2) / (2 * K.kL * (80 - K.Tm)) / 60, num('S_stefanMin'), 0.5, 'Stefan melt time at 80 C');
  near((K.rhoS * K.L * 0.0075 ** 2) / (2 * K.kL * (95 - K.Tm)) / 60, num('S_stefan95Min'), 0.5, 'Stefan melt time at 95 C');
  // lumped time constant, terms written out
  const rSkin = 1 / K.hW + 0.002 / K.kR + 0.05 + 0.03;
  const rDuv = 1 / K.hW + 0.002 / K.kR + 0.05 + 0.15 + 10.5 * 0.1;
  const ua = (area * 0.5) / rSkin + (area * 0.5) / rDuv + 0.05;
  const C = 1.4 * K.cW + 0.35 * K.cR;
  near(ua, num('O_ua'), 0.005, 'plain bottle UA');
  near(C / 1000, num('O_C_kJK'), 0.005, 'plain bottle heat capacity');
  near(C / ua / 3600, num('O_tauH'), 0.05, 'plain bottle time constant');
  // weights
  near(1.4 + 0.35 + 0.08, num('W_orig'), 0.005, 'plain bottle filled weight');
  near(1.4 + 0.35 + wax + 0.12, num('W_new'), 0.005, 'plateau bottle filled weight');
  near((wax + 0.04) * 1000, num('W_added'), 0.5, 'added weight g');
  // cost
  const lows = [1.2, 1.3, 0.15, 1.2, 0.6, 0.3];
  const highs = [2.5, 2.3, 0.4, 2.5, 1.5, 0.6];
  near(lows.reduce((a, b) => a + b, 0), num('BOM_low'), 0.005, 'BOM low total');
  near(highs.reduce((a, b) => a + b, 0), num('BOM_high'), 0.005, 'BOM high total');
  near(2150 / 1000 / 1.33, num('BOM_waxGBPkg'), 0.005, 'lauric acid GBP/kg at the dock');
  near(wax * 2150 / 1000 / 1.33, num('BOM_waxPerBottle'), 0.005, 'lauric acid per bottle at the dock');
  ok(num('BOM_wax_low') >= num('BOM_waxPerBottle') && num('BOM_wax_low') <= num('BOM_waxPerBottle') * 1.1 + 0.01, 'BOM wax low = dock price + about 10%');
  ok(num('BOM_wax_high') >= num('BOM_waxPerBottle') * 1.4 * 1.2, 'BOM wax high covers +40% and a cosmetic-grade premium');
  near([50, 25, 8, 4, 15, 6, 12, 40, 40].reduce((a, b) => a + b, 0), num('KIT_total'), 0.5, 'test kit total');
  // evidence arithmetic
  near(5944 / 10, num('EV_perYear'), 0.5, 'burns per year');
  near((423 / 295 - 1) * 100, num('EV_risePct'), 0.5, 'winter 2022 rise %');
  near((5944 / 10) * 0.188, num('EV_contactPerYear'), 0.5, 'contact burns per year (rough)');
  // risks: product of survivals
  const ps = [0.4, 0.2, 0.25, 0.25, 0.2, 0.15, 0.1, 0.1, 0.1, 0.1];
  near(ps.reduce((s, x) => s * (1 - x), 1) * 100, num('P_survive'), 0.5, 'chance no pre-mortem risk happens');
  ok(M.RISKS.length === ps.length && M.RISKS.every((r) => ps.includes(r.p)), 'risk list matches the re-typed probabilities');
}

// ---------------------------------------------------------------- 3. dimensional analysis
{
  // a unit is a vector of exponents over [m, kg, s, K, GBP]
  const U = (m = 0, kg = 0, s = 0, Kel = 0, gbp = 0) => [m, kg, s, Kel, gbp];
  const mul = (a, b) => a.map((x, i) => x + b[i]);
  const div = (a, b) => a.map((x, i) => x - b[i]);
  const pow = (a, n) => a.map((x) => x * n);
  const same = (a, b) => a.every((x, i) => Math.abs(x - b[i]) < 1e-12);
  const one = U();
  const m = U(1);
  const kg = U(0, 1);
  const s = U(0, 0, 1);
  const Kv = U(0, 0, 0, 1);
  const gbp = U(0, 0, 0, 0, 1);
  const J = U(2, 1, -2);
  const W = U(2, 1, -3);
  const k = div(W, mul(m, Kv)); // W/(m K)
  const rho = div(kg, pow(m, 3));
  const c = div(J, mul(kg, Kv));
  const R = div(mul(pow(m, 2), Kv), W); // m2 K / W
  const h = div(W, mul(pow(m, 2), Kv));
  const L = div(J, kg);
  const unit = (name, got, want) => ok(same(got, want), `units of ${name}: ${got} vs ${want}`);
  unit('rubber resistance dx/k', div(m, k), R);
  unit('water film 1/h', div(one, h), R);
  unit('effusivity sqrt(k rho c)', pow(mul(mul(k, rho), c), 0.5), div(mul(W, pow(s, 0.5)), mul(pow(m, 2), Kv)));
  unit('contact temperature (e1 T1 + e2 T2)/(e1 + e2)', div(mul(pow(mul(mul(k, rho), c), 0.5), Kv), pow(mul(mul(k, rho), c), 0.5)), Kv);
  unit('steady skin T + dT R/(R + R)', mul(Kv, div(R, R)), Kv);
  unit('heat flux dT/R', div(Kv, R), div(W, pow(m, 2)));
  unit('node energy step q dt', mul(div(Kv, R), s), div(J, pow(m, 2)));
  unit('slice capacity rho c dx', mul(mul(rho, c), m), div(J, mul(pow(m, 2), Kv)));
  unit('slice latent rho L dx', mul(mul(rho, L), m), div(J, pow(m, 2)));
  unit('UA = A/R', div(pow(m, 2), R), div(W, Kv));
  unit('tau = C/UA', div(div(J, Kv), div(W, Kv)), s);
  unit('Stefan rho L x^2/(2 k dT)', div(mul(mul(rho, L), pow(m, 2)), mul(k, Kv)), s);
  unit('excess heat m c dT', mul(mul(kg, c), Kv), J);
  unit('wax mass A t rho', mul(mul(pow(m, 2), m), rho), kg);
  unit('cover needed R dT/dT - R - R', div(mul(R, Kv), Kv), R);
  unit('edge loss UA dT', mul(div(W, Kv), Kv), W);
  unit('wax price (GBP/t)/(kg/t)', div(div(gbp, mul(kg, U())), one), div(gbp, kg));
  unit('wax cost per bottle', mul(div(gbp, kg), kg), gbp);
  unit('stability dt < C/sumG', div(div(J, mul(pow(m, 2), Kv)), div(W, mul(pow(m, 2), Kv))), s);
}

// ---------------------------------------------------------------- 4. physics sanity
{
  // energy closure on the runs the page leans on
  const runs = [
    ['original', M.ORIGINAL],
    ['plateau', M.REDESIGN],
    ['plateau bad night', A(M.REDESIGN, { tFill: 95, rTissue: 0.06 })],
    ['plateau pre-warm', A(M.REDESIGN, { tFill: 95, preWarmMin: 120 })],
    ['salt insert', A(M.ORIGINAL, { insertKg: 0.4 })],
    ['bench B', A(M.REDESIGN, M.BENCH_B)],
  ];
  for (const [label, cfg] of runs) {
    const r = M.simulate(cfg);
    const e = r.energy;
    ok(Math.abs(e.e0 - e.eEnd - e.eOut) < 1e-6 * Math.abs(e.e0), `${label}: energy closes (residual ${(e.e0 - e.eEnd - e.eOut).toExponential(2)} J)`);
    ok(e.eOut > 0, `${label}: heat leaves the bottle`);
  }
  // explicit stability: dt below the smallest C / sum(G) of any node, using the largest conductances
  {
    const p = M.REDESIGN;
    const dxW = p.waxT / p.waxSlices;
    const cW = K.rhoS * K.cX * dxW;
    const gWW = K.kS / dxW; // two solid halves in series: 1/(dx/2k + dx/2k)
    const limWax = cW / (2 * gWW);
    const cRub = K.rhoR * K.cR * p.rubberT;
    const gWaterRub = 1 / (1 / K.hW + p.rubberT / 2 / K.kR);
    const gRubOut = 1 / (p.rubberT / 2 / K.kR + 0 + p.rCover);
    const limRub = cRub / (gWaterRub + gRubOut);
    const cFoam = K.rcF * p.foamSliceT;
    const limFoam = cFoam / (2 * (K.kF / p.foamSliceT));
    const lim = Math.min(limWax, limRub, limFoam);
    ok(p.dt < 0.75 * lim, `explicit step ${p.dt} s is under 75% of the stability limit ${lim.toFixed(2)} s`);
  }
  // the ceiling: whenever the skin-side wax never fully melted, the skin never exceeded the melting point
  const sweep = [];
  for (const tFill of [60, 80, 95, 100]) for (const rTissue of [0.015, 0.03, 0.06]) for (const preWarmMin of [0, 60]) sweep.push({ tFill, rTissue, preWarmMin });
  let checked = 0;
  for (const o of sweep) {
    const r = M.simulate(A(M.REDESIGN, o, { hours: 4 }));
    if (r.metrics.meltMax < 0.999) {
      checked++;
      ok(r.metrics.peakTs <= K.Tm + 1e-9, `ceiling holds while solid wax remains (${JSON.stringify(o)}): peak ${r.metrics.peakTs.toFixed(2)}`);
    }
  }
  ok(checked >= 12, `ceiling was exercised on ${checked} runs`);
  // the plain bottle gets hotter with hotter water, monotonically
  let prev = -1;
  for (const tFill of [60, 70, 80, 90, 100]) {
    const pk = M.simulate(A(M.ORIGINAL, { tFill, hours: 1 })).metrics.peakTs;
    ok(pk > prev, `plain bottle peak rises with fill temperature (${tFill} C: ${pk.toFixed(2)})`);
    prev = pk;
  }
  // the phase change does the work: same jacket without it is much hotter on the bad night
  ok(num('A_dummy_badPeak') - num('A_plateau_badPeak') > 5, 'removing the latent heat raises the bad-night peak by more than 5 K');
  // zero wax reduces the redesign to a plain bottle with the same sleeve
  {
    const a = M.simulate(A(M.REDESIGN, { waxFaces: 0, waxT: 0, rSpacer: 0 })).metrics.peakTs;
    const b = M.simulate(A(M.ORIGINAL, { rCover: M.REDESIGN.rCover })).metrics.peakTs;
    near(a, b, 1e-9, 'a jacket with no wax is a plain bottle in the sleeve');
  }
  // the salt insert's water really is pinned at 58 C for a while
  {
    const r = M.simulate(A(M.ORIGINAL, { insertKg: 0.4 }));
    near(r.at(1).tWater, K.TmSAT, 0.01, 'salt insert pins the water at its melting point at 1 h');
  }
}

// ---------------------------------------------------------------- 5. the first test
{
  const thick = M.thickCover();
  const v = (cfg, rig) => M.benchTest(cfg, rig).verdict;
  ok(v(M.REDESIGN) === 'pass', 'a jacket performing exactly as modelled passes the first test');
  for (const [label, cfg] of [
    ['plain bottle, fleece', M.ORIGINAL],
    ['plain bottle, thick cover', thick],
    ['jacket whose filler does not melt', A(M.REDESIGN, { latentScale: 0 })],
    ['seal line as bad as the 1-D bound', A(M.REDESIGN, { waxT: M.SEAL_LAYER_T })],
    ['wax with 60% of its latent heat', A(M.REDESIGN, { latentScale: 0.6 })],
    ['one panel, wrong way round', A(M.REDESIGN, { waxFaces: 1, flipped: true })],
  ]) ok(v(cfg) === 'kill', `the first test kills: ${label} (got ${v(cfg)})`);
  ok(v(A(M.REDESIGN, { rSpacer: 0 })) === 'inconclusive', 'the first test calls the no-spacer jacket inconclusive');
  ok(v(A(M.REDESIGN, { rContact: 0.2 })) !== 'pass', 'a jacket with big air gaps under the wax does not pass');
  ok(v(A(M.REDESIGN, { rCover: 0.2 })) === 'kill', 'a jacket in a sleeve so thick the skin never reaches 38 C is killed');
  // the pass survives plausible errors in the phantom (controls run on the same imperfect rig)
  const AK = 0.19;
  const FILM = 0.002;
  for (const [label, rig] of [
    ['acrylic k -10%', (n) => ({ rTissue: n.plateMM / 1000 / (AK * 0.9) + FILM })],
    ['acrylic k +10%', (n) => ({ rTissue: n.plateMM / 1000 / (AK * 1.1) + FILM })],
    ['bath film x0.5', (n) => ({ rTissue: n.plateMM / 1000 / AK + FILM * 0.5 })],
    ['bath film x1.5', (n) => ({ rTissue: n.plateMM / 1000 / AK + FILM * 1.5 })],
    ['60% contact', () => ({ contactFrac: 0.6 })],
    ['full contact', () => ({ contactFrac: 1.0 })],
    ['room 15 C', () => ({ tRoom: 15 })],
    ['room 21 C', () => ({ tRoom: 21 })],
  ]) {
    const r = M.benchTest(M.REDESIGN, rig);
    ok(r.verdict === 'pass', `model-perfect jacket still passes with the phantom ${label} (got ${r.verdict}: peak ${r.peak.toFixed(2)}, band ${r.band.toFixed(2)} vs thick ${r.thickBand.toFixed(2)}, plain ${r.plainBand.toFixed(2)})`);
    ok(M.benchTest(M.ORIGINAL, rig).verdict === 'kill' && M.benchTest(thick, rig).verdict === 'kill', `controls still killed with the phantom ${label}`);
  }
  // the bench rig's numbers as quoted
  near(M.BENCH_A.rTissue, 0.005 / AK + FILM, 1e-12, 'night A phantom resistance');
  near(M.BENCH_B.rTissue, 0.01 / AK + FILM, 1e-12, 'night B phantom resistance');
  const kp = M.benchTest(M.REDESIGN, (n) => ({ rTissue: n.plateMM / 1000 / (AK * 1.1) + FILM }));
  near(kp.band, num('TEST_bandKplus'), 0.05, 'k+10% rig: jacket hours in band as quoted');
  near(kp.thickBand, num('TEST_thickBandKplus'), 0.05, 'k+10% rig: thick-cover hours in band as quoted');
  ok(num('BA_plateau_band') - num('TEST_bandKplus') > 1.5, 'an absolute band line would indeed be fragile (a 10% phantom error moves it by >1.5 h)');
  // the page's bench table states these verdicts
  const benchRows = [...html.matchAll(/<tr( class="me")?><td>([^<]+)<\/td><td class="r"><b><span data-v="BA_([A-Za-z]+)_peak">[^<]*<\/span>°<\/b>[\s\S]*?<td(?: class="(?:good|bad)")?>(pass|kill|inconclusive)<\/td><\/tr>/g)];
  const want = { plateau: 'pass', orig: 'kill', thick: 'kill', dummy: 'kill', half: 'kill', noSpacer: 'inconclusive' };
  const map = { plateau: M.REDESIGN, orig: M.ORIGINAL, thick, dummy: A(M.REDESIGN, { latentScale: 0 }), half: A(M.REDESIGN, { waxT: M.SEAL_LAYER_T }), noSpacer: A(M.REDESIGN, { rSpacer: 0 }) };
  ok(benchRows.length === 6, `bench table has 6 rows (found ${benchRows.length})`);
  for (const row of benchRows) {
    const key = row[3];
    const stated = row[4];
    ok(stated === want[key] && v(map[key]) === stated, `bench table verdict for ${key}: page says ${stated}, model gives ${v(map[key])}`);
  }
  // pass and kill lines are ordered and leave a margin for the model-perfect design
  ok(M.TEST.passPeak < M.TEST.killPeak && M.TEST.killPeak <= K.Tm, 'pass line below kill line, kill line at the melting point');
  ok(num('BB_plateau_peak') <= M.TEST.passPeak - 0.5, 'model-perfect bad-night peak sits at least 0.5 K under the pass line');
  ok(num('BA_plateau_band') >= num('BA_thick_band') + 1, 'model-perfect night-A band beats the thick-cover control by over 1 h');
}

// ---------------------------------------------------------------- 6. claims in the prose
{
  const thickAs = [num('S_asTold_thick_peak'), num('S_asTold_thick_band')];
  ok(thickAs[0] <= 43 && thickAs[1] >= num('S_asTold_plateau_band'), '"on the as-instructed night my jacket cannot beat" the thick cover');
  near(num('T_thick') / num('G_fleece'), num('T_thickRatio'), 0.5, 'thick cover is about 3x the fleece');
  ok(num('N_over_orig') === 8 && num('N_over_thick') === 6 && num('N_over_plateau') === 0, 'nights above 43: 8 / 6 / 0 as stated in the README');
  for (const sc of M.SCENARIOS) ok(num(`S_${sc.id}_plateau_peak`) < 48, `plateau never reaches the 10-minute line (${sc.id})`);
  ok(num('S_warmSkin_plateau_band') < num('S_warmSkin_thick_band'), 'warm skin: plateau band shorter than the thick cover (a stated loss)');
  ok(num('S_warmSkin_plateau_peak') >= 38 && num('S_warmSkin_plateau_peak') <= 40, 'warm skin plateau "38-39 C" in the risk text');
  ok(Math.abs(num('S_cool_plateau_band') - num('S_cool_orig_band')) < 1.0, 'careful 60 C fill: plateau about the same as the others');
  ok(num('P_120_peak') > K.Tm && num('P_120_min43') < 10 && num('P_120_peak') < 48, 'kettle + 2 h pre-warm: over the ceiling, briefly, under the 10-minute line');
  ok(num('P_0_peak') < 43 && num('P_30_peak') < 43 && num('P_60_peak') < 43, 'pre-warm up to an hour stays under 43');
  ok(num('R_pw30_tWarmMin') === 0, '"warm from the first touch" after 30 min in the bed');
  const sens = ['base', 'L167', 'L183', 'kS016', 'kL015', 'conv2', 'ribbed', 'noSleeve'];
  const over = sens.filter((k) => num(`V_${k}_peak`) > 43);
  ok(over.length === 2 && over.includes('conv2') && over.includes('noSleeve'), `"two of these push the worst case just over 43": got ${over.join(', ')}`);
  ok(sens.every((k) => num(`V_${k}_peak`) < 48), 'no sensitivity case reaches 48');
  ok(num('H_asTold_peak') < 43 && num('H_kettle_peak') > 43, 'seal-line bound: fine as instructed, over 43 kettle-hot');
  ok(num('A_noSpacer_badPeak') > 43 && num('A_plateau_badPeak') < 43, 'the spacer is what keeps the bad night under 43');
  ok(num('A_onePanelFlipped_peak') > 48, 'one panel the wrong way round is dangerous');
  ok(num('A_insert_peak') > 43, 'the patent-style insert still exceeds 43 as instructed');
  ok(num('R_Tw1h') < num('O_Tw1h') - 8, 'plateau water is cooler at 1 h (late bursts)');
  ok(num('R_qBodyKJ') < 0.5 * num('O_qBodyKJ'), '"less than half the heat" into the body');
  ok(Math.abs(num('W_added') / 1000 - 0.8) < 0.05 && num('W_addedPct') === 44, 'risk text: 0.8 kg, 44% heavier');
  ok(num('BOM_retailLow') === 14 && num('BOM_retailHigh') === 29, 'risk text: retail 14-29 GBP');
  ok(Math.round(num('O_Ts1h')) === 46, 'risk text: a plain bottle gives 46 C in its first hour');
  ok(num('O_peak') > 48 && num('O_min48') > 0, 'as instructed, the plain bottle crosses the 10-minute line');
  ok(num('CV_heavyCool') < 38, 'the heavy cover leaves a careful night with no warmth');
  ok(M.RISKS.length === 10, 'the README and page say ten failure modes');
  ok(num('R_meltDuvetPct') < 100 && num('R_meltDuvetKettlePct') === 100, 'duvet-facing wax: partial as instructed, melts through kettle-hot (as stated)');
  ok(Number(q.BA_orig_peak) > 45, 'the plain-bottle control is expected above the 45 C line the page uses to judge the original');
  ok(num('W_emptyRatio') >= 2.5 && num('W_emptyRatio') <= 3.5, '"about three times as much" empty');
  near(1 - 0.8679 / 0.8744 + 0, 0.0074, 0.0005, 'liquid lauric acid density falls 0.74% from 41.5 to 50 C');
  ok(num('G_liqExpPct') >= 3 && num('G_liqExpPct') <= 5, 'headspace for liquid expansion to 95 C is about 4%');
}

// ---------------------------------------------------------------- 6b. README quotes the model
{
  const snippets = [
    `holds the skin side near ${q.R_Ts1h} °C instead of starting at ${q.O_peak} °C`,
    `${q.G_waxTotal} g in all`,
    `about ${q.EV_perYear} hot water bottle burns a year`,
    `**${q.O_peak} °C at the skin, used exactly as instructed.**`,
    `closed-form steady value is ${q.C_fleeceSteady} °C`,
    `Skin with better circulation sees ${q.S_warmSkin_orig_peak} °C, and skin with poor circulation ${q.S_poor_orig_peak} °C`,
    `(48 °C) for ${q.O_min48} min`,
    `until ${q.O_tUnder43H} h`,
    `head for ${q.C_bareSteady} °C`,
    `skin plateau of ${q.C_plateauLo}–${q.C_plateauHi} °C`,
    `the plateau is ${q.C_plateauPoor} °C`,
    `peaks at ${q.R_peak} °C and spends ${q.R_band} h of 9`,
    `**${q.T_thick} m²K/W: the cheap fix`,
    `is ${q.T_thinnest} m²K/W`,
    `peaks at ${q.S_asTold_thick_peak} °C with ${q.S_asTold_thick_band} h in band`,
    `${q.CV_kettle} for kettle-hot water, ${q.CV_poor} for poor circulation, ${q.CV_poorKettle} for both`,
    `at ${q.CV_heavyCool} °C`,
    `plain ${q.N_over_orig}, thick cover ${q.N_over_thick}, plateau ${q.N_over_plateau}`,
    `plain bottle peaks at ${q.S_poorKettle_orig_peak} °C, the thick cover at ${q.S_poorKettle_thick_peak} °C, and the plateau bottle at ${q.S_poorKettle_plateau_peak} °C`,
    `**What it costs: ${q.B_store} kJ of storage, ${q.W_added} g, £${q.BOM_low}–${q.BOM_high}.**`,
    `stores ${q.B_latent} kJ latent plus ${q.B_sensible} kJ sensible`,
    `holds ${q.B_excess80} kJ above the melting point at 80 °C and ${q.B_excess95} kJ at 95 °C`,
    `adds ${q.W_added} g (+${q.W_addedPct}%, ${q.W_new} kg filled)`,
    `roughly £${q.BOM_retailLow}–${q.BOM_retailHigh} retail`,
    `(${q.S_asTold_thick_peak} °C peak, ${q.S_asTold_thick_band} h in band)`,
    `peaks at only ${q.S_warmSkin_plateau_peak} °C, with ${q.S_warmSkin_plateau_band} h in band, worse than the thick cover's ${q.S_warmSkin_thick_band} h`,
    `gives ${q.H_asTold_peak} °C as instructed but ${q.H_kettle_peak} °C kettle-hot`,
    `to ${q.V_conv2_peak} °C`,
    `while the water is still ${q.P_120_TwC} °C`,
    `reaches ${q.P_120_peak} °C, for ${q.P_120_min43} min above 43 °C`,
    `still peaks at ${q.A_insert_peak} °C as instructed`,
    `would be ${q.P_survive}%`,
    `it weighs ${q.W_emptyNew} kg against ${q.W_emptyOrig} kg`,
    `The page lists ten failure modes`,
    `about £${q.KIT_total}, or £${q.KIT_withoutOwned} if you own`,
    `is ${q.BA_R} m²K/W`,
    `plate, ${q.BB_R} m²K/W`,
    `predicts a ${q.BA_plateau_peak} °C peak and ${q.BA_plateau_band} h`,
    `predicts a ${q.BB_plateau_peak} °C peak and ${q.BB_plateau_band} h`,
    `exceeds ${q.TEST_passPeak} °C, and on night A the tube probe's hours in the 38–43 °C band are within ${q.TEST_margin} h of the thick-cover control`,
    `exceeds ${q.TEST_killPeak} °C on either night`,
    `hours in band from ${q.BA_plateau_band} to ${q.TEST_bandKplus}`,
    `moves with it, to ${q.TEST_thickBandKplus}`,
    `peaks at ${q.BB_thick_peak} °C on night B`,
    `reaches ${q.BB_dummy_peak} °C`,
    `reaches ${q.BB_half_peak} °C`,
    `peaks at ${q.BB_noSpacer_peak} °C`,
    `${q.EV_rupture}%, spills ${q.EV_spill}%, contact ${q.EV_contact}%`,
    `${q.EV_n} patients`,
    `melts at ${q.G_Tm} °C`,
    `${q.EV_owners}% of UK households`,
  ];
  for (const sn of snippets) ok(readme.includes(sn), `README quotes the model: "${sn}"`);
  // and the four risk probabilities named in the README
  for (const [id, words] of [['tepid', '"lukewarm" at'], ['weight', 'weight and price at'], ['tissue', 'than modelled at']]) {
    ok(readme.includes(`${words} ${q[`K_${id}`]}%`) || readme.includes(`${words} ${q[`K_${id}`]}% each`), `README risk ${id} at ${q[`K_${id}`]}%`);
  }
  ok(q.K_weight === q.K_price, 'README says weight and price share a probability');
  ok(/^# The Plateau Bottle$/m.test(readme) && /^\*\*Kind:\*\* redesign$/m.test(readme) && /^\*\*Made by:\*\* Mushy Zone$/m.test(readme), 'README header fields');
  for (const sec of ['What it is', 'Why I made it', 'The key numbers', 'Honest assessment', 'The first test']) ok(new RegExp(`^## ${sec}$`, 'm').test(readme), `README has "## ${sec}"`);
}

// ---------------------------------------------------------------- 7. no network, size
{
  ok(!/(src|href)\s*=\s*["']?(https?:)?\/\//i.test(html), 'no external src/href in index.html');
  ok(!/url\(\s*["']?(https?:)?\/\//i.test(html), 'no external url() in CSS');
  ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|import\s*\(/.test(html), 'no runtime network calls in index.html');
  let bytes = 0;
  for (const f of fs.readdirSync(DIR)) if (!/^preview\./.test(f)) bytes += fs.statSync(path.join(DIR, f)).size;
  ok(bytes < 500 * 1024, `folder is ${(bytes / 1024).toFixed(0)} KB (< 500 KB)`);
}

// ---------------------------------------------------------------- 8. the live calculator (optional: needs Playwright)
async function uiCheck() {
  let chromium;
  try {
    const req = createRequire(import.meta.url);
    try {
      ({ chromium } = req('playwright'));
    } catch {
      const g = execSync('npm root -g', { encoding: 'utf8' }).trim();
      ({ chromium } = createRequire(path.join(g, 'noop.js'))('playwright'));
    }
  } catch {
    console.log('SKIP  calculator check (Playwright not available)');
    return;
  }
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto('file://' + path.join(DIR, 'index.html'));
    await page.waitForSelector('body[data-calc-ready="1"]', { timeout: 20000 });
    const read = () => page.evaluate(() => {
      const o = {};
      for (const td of document.querySelectorAll('[data-out]')) o[td.getAttribute('data-out')] = td.textContent;
      return o;
    });
    let o = await read();
    const f = (s) => parseFloat(s);
    near(f(o['peak-0']), num('O_peak'), 1e-9, 'calculator default: plain peak');
    near(f(o['peak-1']), num('S_asTold_thick_peak'), 1e-9, 'calculator default: thick-cover peak');
    near(f(o['peak-2']), num('R_peak'), 1e-9, 'calculator default: plateau peak');
    near(f(o['band-0']), num('O_band'), 1e-9, 'calculator default: plain band');
    near(f(o['band-2']), num('R_band'), 1e-9, 'calculator default: plateau band');
    near(f(o['h43-0']), num('O_h43'), 1e-9, 'calculator default: plain hours above 43');
    near(f(o['kg-2']), num('W_new'), 1e-9, 'calculator default: plateau weight');
    await page.evaluate(() => document.body.removeAttribute('data-calc-ready'));
    await page.click('button[data-preset="poorKettle"]');
    await page.waitForSelector('body[data-calc-ready="1"]', { timeout: 20000 });
    o = await read();
    near(f(o['peak-0']), num('S_poorKettle_orig_peak'), 1e-9, 'calculator bad-night preset: plain peak');
    near(f(o['peak-1']), num('S_poorKettle_thick_peak'), 1e-9, 'calculator bad-night preset: thick peak');
    near(f(o['peak-2']), num('S_poorKettle_plateau_peak'), 1e-9, 'calculator bad-night preset: plateau peak');
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    ok(sw <= 391, `no horizontal scroll at 390 px (scrollWidth ${sw})`);
    ok(errors.length === 0, `no page errors (${errors.join(' | ')})`);
  } finally {
    await browser.close();
  }
}

await uiCheck();
console.log(`independent solver: ${indDiffs.n} runs; largest differences vs the model (after rounding for display): peak ${indDiffs.peak.toFixed(2)} K, hours above 43 ${indDiffs.h43.toFixed(2)} h, hours in band ${indDiffs.band.toFixed(2)} h`);
console.log(`\n${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
