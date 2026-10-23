// Independent recomputation of every number on the page and in the README.
// Written separately from lod-core.js: its own parsing, calendar, running mean, least squares (QR rather
// than normal equations), direct DFT rather than FFT, and its own t-distribution integral. It reads the
// raw ONI and tai-utc files rather than the generated oni.js / leapsec.js.
// It then (a) checks that each tagged number in index.html reads exactly what this code computes,
// (b) checks the README quotes, and (c) checks that lod-core.js (what the page draws) agrees.
//   node --test ideas/58-longest-day/claims.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(HERE, p), 'utf8');

// ------------------------------------------------------------------------------------------------
// Data, parsed by hand
const lodSrc = read('data/lod.js');
const MJD0 = Number(/firstMJD:\s*(\d+)/.exec(lodSrc)[1]);
const LOD = /lod:\s*'([^']*)'/.exec(lodSrc)[1].split(',').map((v) => Number(v) / 1e4);
const ERR = /err:\s*'([^']*)'/.exec(lodSrc)[1].split(',').map((v) => Number(v) / 1e4);
const N = LOD.length;

// Calendar: Fliegel & Van Flandern (1968) integer algorithm, JD -> Gregorian.
function civil(mjd) {
  const jd = mjd + 2400001; // JD number of the civil day starting at 0h UT on that MJD
  let l = jd + 68569;
  const n = Math.floor((4 * l) / 146097);
  l = l - Math.floor((146097 * n + 3) / 4);
  const i = Math.floor((4000 * (l + 1)) / 1461001);
  l = l - Math.floor((1461 * i) / 4) + 31;
  const j = Math.floor((80 * l) / 2447);
  const d = l - Math.floor((2447 * j) / 80);
  l = Math.floor(j / 11);
  return { y: 100 * (n - 49) + i + l, m: j + 2 - 12 * l, d };
}
function mjdOf(y, m, d) {
  const a = Math.floor((14 - m) / 12), yy = y + 4800 - a, mm = m + 12 * a - 3;
  const jdn = d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
  return jdn - 2400001;
}
const YEAR_OF = LOD.map((_, i) => civil(MJD0 + i).y);
const SURROGATES = 20000;
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const words = (mjd) => { const c = civil(mjd); return `${c.d} ${MONTH[c.m - 1]} ${c.y}`; };

// Raw ONI and leap-second files
const SEAS = ['DJF', 'JFM', 'FMA', 'MAM', 'AMJ', 'MJJ', 'JJA', 'JAS', 'ASO', 'SON', 'OND', 'NDJ'];
const ONI = read('data/oni.ascii.txt').split('\n').map((l) => l.trim().split(/\s+/)).filter((p) => p.length === 4 && SEAS.includes(p[0]))
  .map((p) => ({ y: Number(p[1]), m: SEAS.indexOf(p[0]) + 1, anom: Number(p[3]) }));
const LEAPS = read('data/tai-utc.dat').split('\n').filter((l) => /TAI-UTC=/.test(l))
  .map((l) => ({ mjd: Number(/=JD\s+([\d.]+)/.exec(l)[1]) - 2400000.5, v: Number(/TAI-UTC=\s*([\d.]+)/.exec(l)[1]) })).filter((r) => r.mjd >= 41317);

// ------------------------------------------------------------------------------------------------
// Formatting exactly as the page prints
const MINUS = '−';
function f(v, dp) {
  const s = Math.abs(v).toFixed(dp);
  const [a, b] = s.split('.');
  const g = a.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (v < 0 && Number(s) !== 0 ? MINUS : '') + (b !== undefined ? g + '.' + b : g);
}
const plus = (v, dp) => (v > 0 ? '+' : '') + f(v, dp);

// ------------------------------------------------------------------------------------------------
// Periods from the Meeus mean motions (deg per Julian century), derived here independently
const DEGCY = { L: 481267.88123421, M: 477198.8675055, D: 445267.1114034, F: 483202.0175233, Om: -1934.1362891, Sun: 36000.76983 };
const P = (rate) => (360 * 36525) / Math.abs(rate);
const TROP = P(DEGCY.L), ANOM = P(DEGCY.M), SYN = P(DEGCY.D), DRAC = P(DEGCY.F), YEAR = P(DEGCY.Sun), NODE = P(DEGCY.Om);
const fs_ = 1 / TROP, fh = 1 / YEAR, fp = 1 / TROP - 1 / ANOM, fN = 1 / NODE;
const FREQ = {
  Mf: 2 * fs_, "Mf'": 2 * fs_ + fN, Mm: fs_ - fp, MSf: 2 * fs_ - 2 * fh, MSm: fs_ - 2 * fh + fp, Mtm: 3 * fs_ - fp,
  Sa: fh, Ssa: 2 * fh, Sta: 3 * fh,
};
const LUNAR = ['Mf', "Mf'", 'Mm', 'MSf', 'MSm', 'Mtm'], SEASONAL = ['Sa', 'Ssa', 'Sta'], ALL = [...LUNAR, ...SEASONAL];

// ------------------------------------------------------------------------------------------------
// 365-day centred mean by direct summation
const HALF = 182;
const HP = new Array(N).fill(NaN);
for (let i = HALF; i < N - HALF; i++) {
  let s = 0;
  for (let k = i - HALF; k <= i + HALF; k++) s += LOD[k];
  HP[i] = LOD[i] - s / 365;
}

// Least squares by modified Gram-Schmidt QR
function lsq(cols, y) {
  const m = cols.length, n = y.length;
  const Q = cols.map((c) => Float64Array.from(c)), R = Array.from({ length: m }, () => new Float64Array(m));
  for (let j = 0; j < m; j++) {
    for (let k = 0; k < j; k++) {
      let d = 0;
      for (let i = 0; i < n; i++) d += Q[k][i] * Q[j][i];
      R[k][j] = d;
      for (let i = 0; i < n; i++) Q[j][i] -= d * Q[k][i];
    }
    let nr = 0;
    for (let i = 0; i < n; i++) nr += Q[j][i] * Q[j][i];
    nr = Math.sqrt(nr);
    R[j][j] = nr;
    for (let i = 0; i < n; i++) Q[j][i] /= nr;
  }
  const qty = Q.map((q) => q.reduce((s, v, i) => s + v * y[i], 0));
  const b = new Float64Array(m);
  for (let j = m - 1; j >= 0; j--) {
    let s = qty[j];
    for (let k = j + 1; k < m; k++) s -= R[j][k] * b[k];
    b[j] = s / R[j][j];
  }
  return b;
}
function harmonicFit(idx, y, names) {
  const t = idx.map((i) => MJD0 + i - 51544);
  const cols = [t.map(() => 1)];
  for (const nm of names) {
    cols.push(t.map((tt) => Math.cos(2 * Math.PI * FREQ[nm] * tt)));
    cols.push(t.map((tt) => Math.sin(2 * Math.PI * FREQ[nm] * tt)));
  }
  const b = lsq(cols, y);
  const terms = {};
  names.forEach((nm, q) => { terms[nm] = { a: b[1 + 2 * q], b: b[2 + 2 * q], amp: Math.hypot(b[1 + 2 * q], b[2 + 2 * q]) }; });
  return { c: b[0], terms, at: (mjd, which) => which.reduce((s, nm) => { const w = 2 * Math.PI * FREQ[nm] * (mjd - 51544); return s + terms[nm].a * Math.cos(w) + terms[nm].b * Math.sin(w); }, 0) };
}
const okIdx = HP.map((v, i) => (Number.isFinite(v) ? i : -1)).filter((i) => i >= 0);
const FIT = harmonicFit(okIdx, okIdx.map((i) => HP[i]), ALL);
// The measured era. Before the mid-1980s the file's short-period detail is heavily smoothed with the tide
// put back from a model (test "the early record" below), so every claim about the Moon uses 1985 on.
const MEAS_Y = 1985, I85 = mjdOf(MEAS_Y, 1, 1) - MJD0;
const okM = okIdx.filter((i) => i >= I85);
const FIT_M = harmonicFit(okM, okM.map((i) => HP[i]), ALL);

// Direct DFT power of the Hann-tapered high-passed series at frequency fr (cycles/day), for a chosen span
function tapered(idx) {
  const run = idx.map((i) => HP[i]), m = run.reduce((a, b) => a + b, 0) / run.length;
  return run.map((v, i) => (v - m) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (run.length - 1))));
}
const TAP_ALL = tapered(okIdx), TAP_M = tapered(okM);
function powerOf(tap, fr) {
  // rotate a phasor rather than calling cos/sin per sample
  const c = Math.cos(2 * Math.PI * fr), s = Math.sin(2 * Math.PI * fr);
  let re = 0, im = 0, wr = 1, wi = 0;
  for (let i = 0; i < tap.length; i++) {
    re += tap[i] * wr; im -= tap[i] * wi;
    const nr = wr * c - wi * s; wi = wr * s + wi * c; wr = nr;
  }
  return re * re + im * im;
}
const NPAD = 131072, GUARD = 4e-4;
const KNOWN = ALL.map((k) => FREQ[k]);
function lineRatioOf(tap, f0) {
  const band = [];
  for (let j = Math.ceil((0.85 * f0) * NPAD); j <= Math.floor(1.15 * f0 * NPAD); j++) {
    const fr = j / NPAD;
    if (Math.abs(fr - f0) < GUARD || KNOWN.some((L) => Math.abs(fr - L) < GUARD)) continue;
    band.push(powerOf(tap, fr));
  }
  band.sort((a, b) => a - b);
  const med = band.length % 2 ? band[band.length >> 1] : (band[band.length / 2 - 1] + band[band.length / 2]) / 2;
  return powerOf(tap, Math.round(f0 * NPAD) / NPAD) / med;
}
function peakPeriodOf(tap, f0, halfWidth = GUARD) {
  const power = (fr) => powerOf(tap, fr);
  // golden-section search for the maximum of continuous DFT power near f0
  let a = f0 - halfWidth, b = f0 + halfWidth;
  // coarse scan first, so the search starts on the right lobe
  let best = a, bp = -1;
  for (let k = 0; k <= 80; k++) { const fr = a + ((b - a) * k) / 80; const p = power(fr); if (p > bp) { bp = p; best = fr; } }
  a = best - (2 * halfWidth) / 80; b = best + (2 * halfWidth) / 80;
  const g = (Math.sqrt(5) - 1) / 2;
  let c = b - g * (b - a), d = a + g * (b - a), pc = power(c), pd = power(d);
  for (let it = 0; it < 40; it++) {
    if (pc > pd) { b = d; d = c; pd = pc; c = b - g * (b - a); pc = power(c); } else { a = c; c = d; pc = pd; d = a + g * (b - a); pd = power(d); }
  }
  return 1 / ((a + b) / 2);
}
// The page's tests of the Moon: measured era
const lineRatio = (f0) => lineRatioOf(TAP_M, f0);
const peakPeriod = (f0, hw) => peakPeriodOf(TAP_M, f0, hw);

// Moon's mean longitude, anomaly and node (Meeus), for phase and standstill claims
const EP = { L: 218.3164477, M: 134.9633964, Om: 125.0445479 };
const moon = (mjd) => { const T = (mjd - 51544.5) / 36525; const m = (x) => ((x % 360) + 360) % 360; return { L: m(EP.L + DEGCY.L * T), M: m(EP.M + DEGCY.M * T), Om: m(EP.Om + DEGCY.Om * T) }; };
function pearson(x, y) {
  const n = x.length, mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let a = 0, b = 0, c = 0;
  for (let i = 0; i < n; i++) { a += (x[i] - mx) * (y[i] - my); b += (x[i] - mx) ** 2; c += (y[i] - my) ** 2; }
  return a / Math.sqrt(b * c);
}

// ------------------------------------------------------------------------------------------------
// Compute everything once
const X = {};
(function compute() {
  // record
  let iMax = 0, iMin = 0, sum = 0;
  LOD.forEach((v, i) => { if (v > LOD[iMax]) iMax = i; if (v < LOD[iMin]) iMin = i; sum += v; });
  const zeros = LOD.map((v, i) => (v === 0 ? i : -1)).filter((i) => i >= 0);
  const firstNeg = LOD.findIndex((v) => v < 0);
  X.first_date = words(MJD0); X.first_date2 = X.first_date; X.last_date = words(MJD0 + N - 1);
  X.first_year = String(civil(MJD0).y); X.last_year = String(civil(MJD0 + N - 1).y);
  X.n_days = f(N, 0);
  X.zero_count = zeros.length;
  X.zero_consistent = f(LOD.filter((v, i) => Math.abs(v) <= ERR[i]).length, 0);
  X.zero_consistent2 = f(LOD.filter((v, i) => Math.abs(v) <= 2 * ERR[i]).length, 0);
  X.zero_date = words(MJD0 + zeros[0]); X.zero_date2 = X.zero_date; X.zero_err_us = f(ERR[zeros[0]] * 1000, 1);
  X.max_ms = f(LOD[iMax], 2); X.max_date = words(MJD0 + iMax); X.max_err = f(ERR[iMax], 2);
  X.min_ms = f(LOD[iMin], 2); X.min_date = words(MJD0 + iMin); X.min_err = f(ERR[iMin], 2);
  X.first_neg = words(MJD0 + firstNeg); X.neg_days = f(LOD.filter((v) => v < 0).length, 0);
  X.mean_ms = f(sum / N, 2); X.drift_s = f(sum / 1000, 2);
  const last = MJD0 + N - 1;
  X.leaps_in = String(LEAPS.filter((r) => r.mjd > MJD0 && r.mjd <= last).length);
  X.leaps_total = String(LEAPS[LEAPS.length - 1].v - LEAPS[0].v);
  X.last_leap = words(LEAPS[LEAPS.length - 1].mjd - 1);
  {
    const before = Number(/ut1MinusUtcBeforeFirst:\s*(-?[\d.]+)/.exec(lodSrc)[1]);
    const lastLine = read('data/finals2000A.excerpt.txt').split('\n').filter((l) => l.length > 0).pop();
    X.ut1pred = f(before + LEAPS.filter((r) => r.mjd > MJD0 && r.mjd <= last).length - sum / 1000, 4);
    X.ut1file = f(Number(lastLine.slice(58, 68)), 4);
  }
  X.since_leap = f(LOD.reduce((s, v, i) => (MJD0 + i >= LEAPS[LEAPS.length - 1].mjd ? s + v : s), 0) / 1000, 2);
  const years = {};
  LOD.forEach((v, i) => { const y = civil(MJD0 + i).y; (years[y] = years[y] || { s: 0, n: 0 }); years[y].s += v; years[y].n++; });
  X.first_neg_year = String(Object.keys(years).map(Number).sort((a, b) => a - b).find((y) => years[y].n >= 365 && years[y].s < 0));
  X.year_means = years;
  X.err_1973 = f(ERR[0], 2);
  X.y2020_mean = f(-years[2020].s / years[2020].n, 3);
  const e70 = ERR.filter((_, i) => civil(MJD0 + i).y < 1980).sort((a, b) => a - b);
  X.e70 = { p10: f(e70[Math.floor(e70.length * 0.1)], 2), p90: f(e70[Math.floor(e70.length * 0.9)], 2), med: f(e70[e70.length >> 1], 2), max: f(e70[e70.length - 1], 2) };
  // The longest day since a birthday, for every birthday inside the record up to the end of 2008. (Births
  // before the record would all be given its maximum, 2 April 1973, only because that is where it starts.)
  // Scan backwards keeping the earliest index of the running maximum, as "the first longest day since".
  const bestFrom = new Int32Array(N);
  for (let i = N - 1, b = N - 1; i >= 0; i--) { if (LOD[i] >= LOD[b]) b = i; bestFrom[i] = b; }
  X.bestFrom = bestFrom;
  const tally = new Map();
  let births = 0;
  for (let i = 0; MJD0 + i <= mjdOf(2008, 12, 31); i++) { tally.set(bestFrom[i], (tally.get(bestFrom[i]) || 0) + 1); births++; }
  const top3 = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  X.err_70s_med = X.e70.med;
  X.longestShareValue = top3.reduce((s, e2) => s + e2[1], 0) / births;
  X.longestShare = f(100 * X.longestShareValue, 0);
  const sorted3 = top3.map((e2) => e2[0]).sort((a, b) => a - b).map((i) => words(MJD0 + i));
  X.longestThree = `${sorted3[0]}, ${sorted3[1]} or ${sorted3[2]}`;
  // and what the earlier version counted: the 15th of Jan, Apr, Jul and Oct from 1940, with pre-record births
  // clamped to the first day (they all land on the record maximum by construction)
  let clampedHits = 0, clampedBirths = 0;
  for (let y = 1940; y <= 1972; y++) for (const m of [1, 4, 7, 10]) { clampedBirths++; if (bestFrom[0] === iMax) clampedHits++; }
  X.clamped = { births: clampedBirths, hits: clampedHits };
  // distinct values: how many days share their published value with another day
  const counts = new Map();
  LOD.forEach((v) => counts.set(v, (counts.get(v) || 0) + 1));
  X.distinct = counts.size; X.sharedDays = [...counts.values()].filter((c) => c > 1).reduce((a, b) => a + b, 0);
  const rec = ERR.filter((_, i) => { const y = civil(MJD0 + i).y; return y >= 2016 && y <= 2025; }).sort((a, b) => a - b);
  X.err_recent = f(rec[rec.length >> 1], 3);

  // periods
  X.tropical = f(TROP, 4); X.tropical2 = X.tropical; X.anomalistic = f(ANOM, 4); X.synodic = f(SYN, 4);
  X.mf_period = f(1 / FREQ.Mf, 4); X.mf_period_short = f(1 / FREQ.Mf, 2); X.msm_period_short = f(1 / FREQ.MSm, 2);
  X.hz_mf = f(4000 * FREQ.Mf, 0); X.hz_mm = f(4000 * FREQ.Mm, 0);

  // spectrum: the measured era (1985 on) for the page, and the whole record for comparison
  X.meas_from = String(MEAS_Y); X.meas_from2 = X.meas_from; X.meas_from3 = X.meas_from; X.meas_from4 = X.meas_from; X.meas_from5 = X.meas_from;
  const peaks = {}, peaksAll = {};
  for (const k of ['Mf', 'Mtm', 'Mm', 'MSf', 'MSm']) { peaks[k] = peakPeriod(FREQ[k]); peaksAll[k] = peakPeriodOf(TAP_ALL, FREQ[k]); }
  X.peaks = peaks; X.peaksAll = peaksAll;
  X.mf_peak = f(peaks.Mf, 3); X.mtm_peak = f(peaks.Mtm, 3); X.mm_peak = f(peaks.Mm, 3); X.msf_peak = f(peaks.MSf, 3); X.msf_peak2 = X.msf_peak; X.msm_peak = f(peaks.MSm, 3);
  X.max_dev_minutes = Math.max(...Object.keys(peaks).map((k) => Math.abs(peaks[k] - 1 / FREQ[k]) * 1440));
  X.max_dev_min = String(Math.ceil(X.max_dev_minutes));
  X.max_dev_minutes_all = Math.max(...Object.keys(peaksAll).map((k) => Math.abs(peaksAll[k] - 1 / FREQ[k]) * 1440));
  X.ratio = {}; X.ratioAll = {};
  for (const k of ['Mf', 'Mm', 'MSf', 'MSm', 'Mtm']) { X.ratio[k] = lineRatio(FREQ[k]); X.ratioAll[k] = lineRatioOf(TAP_ALL, FREQ[k]); }
  X.ratio.syn = lineRatio(1 / SYN); X.ratio.trop = lineRatio(1 / TROP); X.ratio.drac = lineRatio(1 / DRAC);
  X.ratioAll.syn = lineRatioOf(TAP_ALL, 1 / SYN); X.ratioAll.trop = lineRatioOf(TAP_ALL, 1 / TROP); X.ratioAll.drac = lineRatioOf(TAP_ALL, 1 / DRAC);
  X.mf_ratio = f(X.ratio.Mf, 0); X.msm_ratio = f(X.ratio.MSm, 0); X.msm_ratio2 = X.msm_ratio; X.syn_ratio = f(X.ratio.syn, 2); X.trop_ratio = f(X.ratio.trop, 2);
  const odds = Math.pow(2, Math.round(X.ratio.MSm)), e = Math.floor(Math.log10(odds));
  X.msm_odds = `${Math.round(odds / 10 ** e)}×10<sup>${e}</sup>`;
  // smaller spikes: 4s-2p, 4s-2h, 3s-2h+p
  X.extra = { Mqm: 4 * fs_ - 2 * fp, MSqm: 4 * fs_ - 2 * fh, MStm: 3 * fs_ - 2 * fh + fp };
  X.extra_peaks = `${f(1 / X.extra.Mqm, 2)}, ${f(1 / X.extra.MSqm, 2)} and ${f(1 / X.extra.MStm, 2)}`;

  // phase of the fitted lunar terms
  const a = [], b = [], c = [], d = [];
  for (let k = 0; k < 40000; k++) {
    const mj = 51544.5 + k * 0.25, mo = moon(mj);
    a.push(FIT_M.at(mj, ['Mf'])); b.push(Math.cos((2 * mo.L * Math.PI) / 180));
    c.push(FIT_M.at(mj, ['Mm'])); d.push(Math.cos((mo.M * Math.PI) / 180));
  }
  X.phase_mf_r = pearson(a, b); X.phase_mm_r = pearson(c, d);
  X.phase_mf = f(X.phase_mf_r, 3); X.phase_mm = f(X.phase_mm_r, 4);
  const hoursOff = (r, period) => (Math.acos(r) / (2 * Math.PI)) * period * 24;
  X.phase_hours_max = Math.max(hoursOff(X.phase_mf_r, 1 / FREQ.Mf), hoursOff(X.phase_mm_r, 1 / FREQ.Mm));
  X.phase_hours = String(Math.ceil(X.phase_hours_max));

  // forecast
  const cut = mjdOf(2016, 1, 1);
  const train = okM.filter((i) => MJD0 + i < cut), testI = okIdx.filter((i) => MJD0 + i >= cut);
  const FT = harmonicFit(train, train.map((i) => HP[i]), ALL);
  const tgt = testI.map((i) => HP[i] - FT.c - FT.at(MJD0 + i, SEASONAL)), prd = testI.map((i) => FT.at(MJD0 + i, LUNAR));
  const mt = tgt.reduce((s, v) => s + v, 0) / tgt.length;
  const ssr = tgt.reduce((s, v, k) => s + (v - prd[k]) ** 2, 0), sst = tgt.reduce((s, v) => s + (v - mt) ** 2, 0);
  X.oos_r2_value = 1 - ssr / sst; X.oos_r2 = f(100 * X.oos_r2_value, 0); X.oos_cut = '2016';
  const lastT = civil(MJD0 + testI[testI.length - 1]); X.oos_end = `${MONTH[lastT.m - 1]} ${lastT.y}`;
  X.oos_n = testI.length;

  // seasonal curve, over the calendar year 2001
  const s0 = mjdOf(2001, 1, 1), curve = [];
  for (let k = 0; k < 365; k++) curve.push(FIT.at(s0 + k, SEASONAL));
  let kx = 0, kn = 0;
  curve.forEach((v, k) => { if (v > curve[kx]) kx = k; if (v < curve[kn]) kn = k; });
  const cx = civil(s0 + kx), cn = civil(s0 + kn);
  X.seas_max_date = `${cx.d} ${MONTH[cx.m - 1]}`; X.seas_min_date = `${cn.d} ${MONTH[cn.m - 1]}`;
  X.seas_max = plus(curve[kx], 2); X.seas_min = plus(curve[kn], 2); X.seas_range = f(curve[kx] - curve[kn], 2);
  X.amp = Object.fromEntries(ALL.map((k) => [k, FIT.terms[k].amp]));

  // fortnightly ripple per calendar year, fitted to (high-passed minus fitted seasons)
  const noSeason = HP.map((v, i) => v - FIT.c - FIT.at(MJD0 + i, SEASONAL));
  const yearly = [];
  for (let y = civil(MJD0).y; y <= civil(MJD0 + N - 1).y; y++) {
    const a0 = mjdOf(y, 1, 1) - MJD0, a1 = mjdOf(y + 1, 1, 1) - MJD0;
    if (a0 < 0 || a1 > N) continue;
    const idx = [];
    for (let i = a0; i < a1; i++) idx.push(i);
    if (!idx.every((i) => Number.isFinite(noSeason[i]))) continue;
    const fy = harmonicFit(idx, idx.map((i) => noSeason[i]), ['Mf', 'Mm', 'MSf', 'MSm', 'Mtm']);
    yearly.push({ y, amp: fy.terms.Mf.amp, cosOm: Math.cos((moon(mjdOf(y, 7, 2)).Om * Math.PI) / 180) });
  }
  X.yearly = yearly;
  const yearlyM = yearly.filter((r) => r.y >= MEAS_Y);
  X.yearlyM = yearlyM;
  const ymax = yearlyM.reduce((p, r) => (r.amp > p.amp ? r : p)), ymin = yearlyM.reduce((p, r) => (r.amp < p.amp ? r : p));
  X.amp_max = f(ymax.amp, 2); X.amp_max_year = String(ymax.y); X.amp_min = f(ymin.amp, 2); X.amp_min_year = String(ymin.y);
  X.amp_ratio = ymax.amp / ymin.amp;
  X.amp_tilt = pearson(yearlyM.map((r) => r.amp), yearlyM.map((r) => r.cosOm)); X.amp_tilt_r = f(X.amp_tilt, 2);
  X.amp_years = String(yearlyM.length);
  X.amp_tilt_all = pearson(yearly.map((r) => r.amp), yearly.map((r) => r.cosOm));

  // standstills by bisection on the node longitude
  function crossings(target) {
    const out = [];
    for (let y = 1970; y < 2030; y += 0.25) {
      const g = (yy) => { const v = moon(51544.5 + (yy - 2000) * 365.25).Om - target; return ((v + 540) % 360) - 180; };
      let lo = y, hi = y + 0.25;
      if (g(lo) * g(hi) > 0 || Math.abs(g(lo) - g(hi)) > 90) continue;
      for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (g(lo) * g(mid) <= 0) hi = mid; else lo = mid; }
      out.push((lo + hi) / 2);
    }
    return out;
  }
  X.major = crossings(0); X.minor = crossings(180);
  X.major_list = X.major.map((v) => v.toFixed(1)).join(', '); X.minor_list = X.minor.map((v) => v.toFixed(1)).join(', ');
  // the largest measured year near each major standstill
  X.nearMajor = X.major.map((s0) => { const c2 = yearlyM.filter((r0) => Math.abs(r0.y + 0.5 - s0) < 4); return { s: s0, y: c2.reduce((p, q) => (q.amp > p.amp ? q : p)).y }; });

  // The early record. Residual after the full fit (Moon and seasons), band-passed to about a week to a month as
  // a 7-day minus a 35-day running mean (direct sums), compared by era; and the fortnightly line fitted per era.
  const runMean = (arr, w) => {
    const h = (w - 1) / 2, out = new Array(arr.length).fill(NaN);
    for (let i = h; i < arr.length - h; i++) {
      let s2 = 0, ok = true;
      for (let k = i - h; k <= i + h; k++) { if (!Number.isFinite(arr[k])) { ok = false; break; } s2 += arr[k]; }
      if (ok) out[i] = s2 / w;
    }
    return out;
  };
  X.runMean = runMean;
  const RES = HP.map((v, i) => (Number.isFinite(v) ? v - FIT.c - FIT.at(MJD0 + i, ALL) : NaN));
  const r7 = runMean(RES, 7), r35 = runMean(RES, 35), BP = RES.map((_, i) => r7[i] - r35[i]);
  const eraOf = (y0, y1) => {
    const idx = []; for (let i = 0; i < N; i++) if (YEAR_OF[i] >= y0 && YEAR_OF[i] <= y1) idx.push(i);
    const bp = idx.map((i) => BP[i]).filter(Number.isFinite);
    const errs = idx.map((i) => ERR[i]).sort((p, q) => p - q);
    const med = errs.length % 2 ? errs[errs.length >> 1] : (errs[errs.length / 2 - 1] + errs[errs.length / 2]) / 2;
    const fi = idx.filter((i) => Number.isFinite(HP[i]));
    return { rms: Math.sqrt(bp.reduce((p, v) => p + v * v, 0) / bp.length), mf: harmonicFit(fi, fi.map((i) => HP[i]), ALL).terms.Mf.amp, medErr: med };
  };
  X.eraEarly = eraOf(1974, 1982); X.eraMeas = eraOf(MEAS_Y, 2025);
  X.eraMid = eraOf(MEAS_Y, 2001); X.eraLate = eraOf(2002, 2025);
  X.era_from = '1974'; X.era_to = '1982';
  X.eraPower = (X.eraEarly.rms / X.eraMeas.rms) ** 2;
  X.era_power = f(100 * X.eraPower, 0);
  X.era_err_x = f(X.eraEarly.medErr / X.eraMeas.medErr, 0);
  X.era_mf_early = f(X.eraEarly.mf, 2); X.era_mf_meas = f(X.eraMeas.mf, 2);
  X.yearPower = (y) => { const v = BP.filter((q, i) => YEAR_OF[i] === y && Number.isFinite(q)); return v.reduce((p, q) => p + q * q, 0) / v.length / X.eraMeas.rms ** 2; };

  // the Pacific
  const months = [];
  let cur = null;
  LOD.forEach((v, i) => {
    const c2 = civil(MJD0 + i);
    if (!cur || cur.y !== c2.y || cur.m !== c2.m) { cur = { y: c2.y, m: c2.m, s: 0, n: 0 }; months.push(cur); }
    cur.s += v; cur.n++;
  });
  const dim = (y, m) => mjdOf(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1) - mjdOf(y, m, 1);
  const mm = new Map();
  months.filter((r) => r.n === dim(r.y, r.m)).forEach((r) => mm.set(r.y * 12 + r.m - 1, r.s / r.n));
  const m3 = new Map();
  for (const [k, v] of mm) if (mm.has(k - 1) && mm.has(k + 1)) m3.set(k, (mm.get(k - 1) + v + mm.get(k + 1)) / 3);
  const oni = new Map(ONI.map((r) => [r.y * 12 + r.m - 1, r.anom]));
  const rows = [...m3.keys()].sort((p, q) => p - q).filter((k) => m3.has(k - 12) && oni.has(k) && oni.has(k - 12))
    .map((k) => ({ k, dl: m3.get(k) - m3.get(k - 12), do: oni.get(k) - oni.get(k - 12), oni: oni.get(k) }));
  X.pac_rows = rows;
  const xs = rows.map((r) => r.dl), ys = rows.map((r) => r.do);
  const r = pearson(xs, ys);
  // autocorrelation at lag k, written out
  const acAt = (v, k) => { const m = v.reduce((p, q) => p + q, 0) / v.length; let num = 0, den = 0; v.forEach((x, i) => { den += (x - m) ** 2; if (i >= k) num += (x - m) * (v[i - k] - m); }); return num / den; };
  const ac = (v) => acAt(v, 1);
  // effective sample size, general lag-by-lag form N / (1 + 2 sum rho_x(k) rho_y(k)) to lag N/4;
  // and the AR(1) shortcut N (1 - r1 r2) / (1 + r1 r2), kept as a conservative bound
  const neffSum = (u, v) => { const K = Math.floor(u.length / 4); let S = 0; for (let k = 1; k <= K; k++) S += acAt(u, k) * acAt(v, k); return u.length / (1 + 2 * S); };
  X.neffSum = neffSum;
  const r1 = ac(xs), r2 = ac(ys), neffAR1 = (rows.length * (1 - r1 * r2)) / (1 + r1 * r2), neff = neffSum(xs, ys);
  const t = r * Math.sqrt((neff - 2) / (1 - r * r)), tAR1 = r * Math.sqrt((neffAR1 - 2) / (1 - r * r));
  X.pac = { r, n: rows.length, r1, r2, neff, t, p: tPValue(t, neff - 2), neffAR1, tAR1, pAR1: tPValue(tAR1, neffAR1 - 2) };
  X.acfAt = { x: [3, 6, 9, 12].map((k) => acAt(xs, k)), y: [3, 6, 9, 12].map((k) => acAt(ys, k)) };
  X.pac_r = f(r, 2); X.pac_n = f(rows.length, 0); X.pac_neff = f(neff, 0);
  const sci = (v) => { const e = Math.floor(Math.log10(v)); let m = Math.round(v / 10 ** e); return m === 10 ? `1×10<sup>${MINUS}${-(e + 1)}</sup>` : `${m}×10<sup>${MINUS}${-e}</sup>`; };
  X.pac_p = sci(X.pac.p);
  X.sci = sci;
  // the same comparison in each third of the record
  const third = Math.floor(rows.length / 3);
  X.thirds = [0, 1, 2].map((q) => { const a2 = rows.slice(q * third, q === 2 ? rows.length : (q + 1) * third); return pearson(a2.map((r0) => r0.dl), a2.map((r0) => r0.do)); });
  X.pac_third_lo = f(Math.min(...X.thirds), 2); X.pac_third_hi = f(Math.max(...X.thirds), 2);
  const k0 = rows[0].k, k1 = rows[rows.length - 1].k;
  X.pac_first = `${MONTH[k0 % 12]} ${Math.floor(k0 / 12)}`; X.pac_last = `${MONTH[k1 % 12]} ${Math.floor(k1 / 12)}`;
  X.dlod_last = f(rows[rows.length - 1].dl, 2); X.oni_last = plus(rows[rows.length - 1].oni, 2);
  // Sensitivity (README only): a different high-pass. Monthly means minus their calendar-month average,
  // minus a centred 85-month (7-year) running mean, then a 3-month mean; compared with the ONI itself.
  const clim = Array.from({ length: 12 }, () => ({ s: 0, n: 0 }));
  for (const [k, v] of mm) { clim[k % 12].s += v; clim[k % 12].n++; }
  const anomM = new Map([...mm].map(([k, v]) => [k, v - clim[k % 12].s / clim[k % 12].n]));
  const hp85 = new Map();
  for (const k of anomM.keys()) {
    let s = 0, ok = true;
    for (let q = k - 42; q <= k + 42; q++) { if (!anomM.has(q)) { ok = false; break; } s += anomM.get(q); }
    if (ok) hp85.set(k, anomM.get(k) - s / 85);
  }
  const sx = [], sy = [];
  for (const k of [...hp85.keys()].sort((p2, q2) => p2 - q2)) {
    if (hp85.has(k - 1) && hp85.has(k + 1) && oni.has(k)) { sx.push((hp85.get(k - 1) + hp85.get(k) + hp85.get(k + 1)) / 3); sy.push(oni.get(k)); }
  }
  {
    const rr = pearson(sx, sy), q1 = ac(sx), q2 = ac(sy), neAR1 = (sx.length * (1 - q1 * q2)) / (1 + q1 * q2), ne = neffSum(sx, sy);
    const tt = rr * Math.sqrt((ne - 2) / (1 - rr * rr)), ttAR1 = rr * Math.sqrt((neAR1 - 2) / (1 - rr * rr));
    X.sens = { r: rr, n: sx.length, neff: ne, p: tPValue(tt, ne - 2), neffAR1: neAR1, pAR1: tPValue(ttAR1, neAR1 - 2) };
  }
  X.lags = [];
  for (let L = -12; L <= 12; L++) {
    const a1 = [], b1 = [];
    rows.forEach((row, i) => { const j = i - L; if (j >= 0 && j < rows.length && rows[j].k === row.k - L) { a1.push(row.dl); b1.push(rows[j].do); } });
    X.lags.push({ L, r: pearson(a1, b1) });
  }
  X.lagDev = Math.max(...X.lags.filter((q) => Math.abs(q.L) === 1).map((q) => Math.abs(q.r - r)));
  X.pac_lag_dev = f(X.lagDev, 2);
  // How much the lag-by-lag effective n depends on where the sum stops (6 to 200 lags), and the p range that
  // goes with it; the same for the sensitivity variant.
  const acx = [], acy = [], asx = [], asy = [];
  for (let k = 0; k <= 200; k++) { acx.push(acAt(xs, k)); acy.push(acAt(ys, k)); asx.push(acAt(sx, k)); asy.push(acAt(sy, k)); }
  const spanOf = (ax, ay, n) => { const v = []; let S = 0; for (let K = 1; K <= 200; K++) { S += ax[K] * ay[K]; if (K >= 6) v.push(n / (1 + 2 * S)); } return [Math.min(...v), Math.max(...v)]; };
  X.neffSpan = spanOf(acx, acy, xs.length); X.sensSpan = spanOf(asx, asy, sx.length);
  const pAt = (ne) => tPValue(r * Math.sqrt((ne - 2) / (1 - r * r)), ne - 2);
  X.pSpan = [pAt(X.neffSpan[1]), pAt(X.neffSpan[0])];
  // scientific notation with Unicode superscripts, as the README writes it
  const SUP = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
  X.sciU = (v) => { const e = Math.floor(Math.log10(v)); let m = Math.round(v / 10 ** e), ee = e; if (m === 10) { m = 1; ee = e + 1; } return `${m}×10⁻${String(-ee).split('').map((c) => SUP[c]).join('')}`; };
  // the last day with a complete centred 365-day window
  X.hp_last = words(MJD0 + okIdx[okIdx.length - 1]); X.hp_first = words(MJD0 + okIdx[0]);
})();

// Student t two-sided p by Simpson integration of the density (independent of the incomplete beta)
function tPValue(t, df) {
  const lg = (z) => { // Lanczos
    const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lg(1 - z);
    z -= 1; let x = c[0]; for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
    const tt = z + g + 0.5; return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(tt) - tt + Math.log(x);
  };
  const k = Math.exp(lg((df + 1) / 2) - lg(df / 2)) / Math.sqrt(df * Math.PI);
  const dens = (x) => k * Math.pow(1 + (x * x) / df, -(df + 1) / 2);
  const a = 0, b = Math.abs(t), n = 20000, h = (b - a) / n;
  let s = dens(a) + dens(b);
  for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * dens(a + i * h);
  return 2 * (0.5 - (s * h) / 3);
}

// ------------------------------------------------------------------------------------------------
// Tests
const html = read('index.html');
const spans = new Map([...html.matchAll(/<span data-c="([a-z0-9_]+)">([\s\S]*?)<\/span>/g)].map((m) => [m[1], m[2]]));

// The expected text of every tagged number on the page. check.mjs requires a "key:" entry here for each.
const EXPECT = {
  first_date: X.first_date, first_date2: X.first_date2, last_date: X.last_date, first_year: X.first_year, last_year: X.last_year,
  n_days: X.n_days, zero_date: X.zero_date, zero_date2: X.zero_date2, zero_err_us: X.zero_err_us,
  max_ms: X.max_ms, max_date: X.max_date, max_err: X.max_err, min_ms: X.min_ms, min_date: X.min_date, min_err: X.min_err,
  mf_peak: X.mf_peak, mtm_peak: X.mtm_peak, mm_peak: X.mm_peak, msf_peak: X.msf_peak, msm_peak: X.msm_peak, msf_peak2: X.msf_peak2,
  tropical: X.tropical, tropical2: X.tropical2, mf_period: X.mf_period, anomalistic: X.anomalistic, synodic: X.synodic,
  max_dev_min: X.max_dev_min, mf_period_short: X.mf_period_short, msm_period_short: X.msm_period_short,
  mf_ratio: X.mf_ratio, msm_ratio: X.msm_ratio, msm_odds: X.msm_odds, syn_ratio: X.syn_ratio, trop_ratio: X.trop_ratio,
  extra_peaks: X.extra_peaks, phase_mf: X.phase_mf, phase_mm: X.phase_mm,
  oos_cut: X.oos_cut, oos_end: X.oos_end, oos_r2: X.oos_r2,
  amp_min: X.amp_min, amp_min_year: X.amp_min_year, amp_max: X.amp_max, amp_max_year: X.amp_max_year, amp_tilt_r: X.amp_tilt_r, amp_years: X.amp_years,
  meas_from: X.meas_from, meas_from2: X.meas_from2, meas_from3: X.meas_from3, meas_from4: X.meas_from4, meas_from5: X.meas_from5, msm_ratio2: X.msm_ratio2,
  era_from: X.era_from, era_to: X.era_to, era_power: X.era_power, era_err_x: X.era_err_x, era_mf_early: X.era_mf_early, era_mf_meas: X.era_mf_meas,
  pac_lag_dev: X.pac_lag_dev, pac_third_lo: X.pac_third_lo, pac_third_hi: X.pac_third_hi, pac_sur_n: f(SURROGATES, 0),
  major_list: X.major_list, minor_list: X.minor_list, hz_mf: X.hz_mf, hz_mm: X.hz_mm,
  seas_max_date: X.seas_max_date, seas_max: X.seas_max, seas_min_date: X.seas_min_date, seas_min: X.seas_min, seas_range: X.seas_range,
  pac_first: X.pac_first, pac_last: X.pac_last, pac_r: X.pac_r, pac_n: X.pac_n, pac_neff: X.pac_neff, pac_p: X.pac_p,
  oni_last: X.oni_last, dlod_last: X.dlod_last,
  mean_ms: X.mean_ms, drift_s: X.drift_s, leaps_in: X.leaps_in, leaps_total: X.leaps_total, last_leap: X.last_leap, since_leap: X.since_leap,
  first_neg: X.first_neg, neg_days: X.neg_days, first_neg_year: X.first_neg_year, err_1973: X.err_1973, err_recent: X.err_recent,
  y2020_mean: X.y2020_mean, zero_consistent: X.zero_consistent, err_70s_med: X.err_70s_med, phase_hours: X.phase_hours,
};

test('every tagged number on the page matches the independent recomputation', () => {
  const wrong = [];
  for (const [k, v] of spans) {
    assert.ok(k in EXPECT, `no expectation for data-c="${k}"`);
    if (v !== EXPECT[k]) wrong.push(`${k}: page "${v}" vs computed "${EXPECT[k]}"`);
  }
  assert.deepEqual(wrong, []);
  assert.equal(spans.size, Object.keys(EXPECT).length, 'every expectation is used on the page');
});

test('the record: one exact 86,400 s day, and the extremes', () => {
  assert.equal(N, 19650);
  assert.equal(X.zero_count, 1);
  assert.equal(X.first_date, '3 January 1973');
  assert.equal(X.last_date, '21 October 2026');
});

test('the lunar peaks sit at the predicted periods and stand far above background (measured era and whole record)', (t) => {
  t.diagnostic(`peaks 1985 on: ${Object.entries(X.peaks).map(([k, v]) => `${k} ${v.toFixed(4)}`).join(', ')}; whole record: ${Object.entries(X.peaksAll).map(([k, v]) => `${k} ${v.toFixed(4)}`).join(', ')}`);
  t.diagnostic(`ratios 1985 on: ${JSON.stringify(Object.fromEntries(Object.entries(X.ratio).map(([k, v]) => [k, +v.toFixed(2)])))}; whole record: ${JSON.stringify(Object.fromEntries(Object.entries(X.ratioAll).map(([k, v]) => [k, +v.toFixed(2)])))}`);
  // 1985 on: within 8 minutes (the weakest line, 31.81 d, where a 41-year record resolves about 97 minutes)
  assert.ok(X.max_dev_minutes < 8, `largest peak offset ${X.max_dev_minutes.toFixed(2)} min`);
  assert.ok(X.max_dev_minutes_all < 4, `whole record: largest peak offset ${X.max_dev_minutes_all.toFixed(2)} min`);
  for (const k of ['Mf', 'Mm', 'MSf', 'MSm', 'Mtm']) assert.ok(X.ratio[k] > 50 && X.ratioAll[k] > 50, `${k} ratio ${X.ratio[k]} ${X.ratioAll[k]}`);
  // the phases, the tropical month itself and the draconic month: nothing above background
  assert.ok(X.ratio.syn < 1.5 && X.ratio.trop < 1.5 && X.ratio.drac < 1.5, `controls ${X.ratio.syn} ${X.ratio.trop} ${X.ratio.drac}`);
  assert.ok(X.ratioAll.syn < 1.5 && X.ratioAll.trop < 1.5 && X.ratioAll.drac < 1.5, 'whole-record controls');
  // the unlabelled spikes are local maxima within 0.005 d of their predicted combinations, well above background
  for (const [k, f0] of Object.entries(X.extra)) {
    const pk = peakPeriod(f0, 2e-4);
    t.diagnostic(`${k}: peak ${pk.toFixed(4)} vs ${(1 / f0).toFixed(4)}, ratio ${lineRatio(f0).toFixed(0)}`);
    assert.ok(Math.abs(pk - 1 / f0) < 0.005, `${k} peak ${pk} vs ${1 / f0}`);
    assert.ok(lineRatio(f0) > 30, `${k} ratio ${lineRatio(f0)}`);
  }
});

test('the fitted lunar terms peak when the Moon is over the equator and at perigee', () => {
  assert.ok(X.phase_mf_r > 0.99 && X.phase_mm_r > 0.99);
});

test('out-of-sample forecast and the 18.6-year modulation, measured era', () => {
  assert.ok(X.oos_r2_value > 0.7 && X.oos_r2_value < 0.8, `R2 ${X.oos_r2_value}`);
  assert.ok(X.amp_tilt > 0.95 && X.amp_tilt_all > 0.95, `${X.amp_tilt} ${X.amp_tilt_all}`);
  assert.ok(X.amp_ratio > 2.1 && X.amp_ratio < 2.5, `max/min ${X.amp_ratio}`);
  // the smallest and largest measured years are both from 1985 on (the old 1978 minimum was in the model era)
  assert.ok(Number(X.amp_min_year) >= MEAS_Y && Number(X.amp_max_year) >= MEAS_Y);
  // the largest year near each major standstill falls within 1.5 years of it (two of the three largest years
  // overall, 2024 and 2025, share one standstill, so "the three largest years" was the wrong way to say it)
  for (const q of X.nearMajor) assert.ok(Math.abs(q.y + 0.5 - q.s) < 1.5, `standstill ${q.s} largest year ${q.y}`);
  const top3 = [...X.yearly].sort((a, b) => b.amp - a.amp).slice(0, 3).map((r) => r.y);
  assert.ok(top3.includes(2024) && top3.includes(2025), `top three ${top3}`);
});

test('the early record: heavily smoothed, with the tide put back (page, README)', (t) => {
  // a much quieter background in 1974-1982, though the stated errors were far larger...
  assert.ok(X.eraPower < 0.4, `early/measured band power ${X.eraPower}`);
  assert.ok(X.eraEarly.medErr > 20 * X.eraMeas.medErr, `errors ${X.eraEarly.medErr} vs ${X.eraMeas.medErr}`);
  assert.ok(X.yearPower(1974) < 0.1 && X.yearPower(1975) < 0.1, `${X.yearPower(1974)} ${X.yearPower(1975)}`);
  t.diagnostic(`band power vs 1985-2025: 1974-82 ${X.eraPower.toFixed(3)}; by year ${Array.from({ length: 12 }, (_, q) => `${1974 + q} ${X.yearPower(1974 + q).toFixed(2)}`).join(', ')}; Mf ${X.eraEarly.mf.toFixed(3)} vs ${X.eraMeas.mf.toFixed(3)}; errors ${X.eraEarly.medErr} vs ${X.eraMeas.medErr}`);
  for (let y = 1974; y <= 1980; y++) assert.ok(X.yearPower(y) < 0.45, `year ${y}: ${X.yearPower(y)}`);
  // 1981-1984 are in between, so "most of all before 1981" on the page and "1974-1980 are the most smoothed"
  for (let y = 1981; y <= 1984; y++) assert.ok(X.yearPower(y) > 0.4 && X.yearPower(y) < 0.8, `year ${y}: ${X.yearPower(y)}`);
  assert.ok(html.includes('(most of all before 1981)') && read('app.js').includes('(most of all before 1981)'));
  assert.ok(read('README.md').includes('1974–1980 are the most smoothed, 1981–1984 are in between'));
  // the fastest wiggles (the residual minus its own 5-day mean: periods under about five days) stay damped
  // until about 2002 (README: "Shorter periods (under about four days) stay heavily smoothed until about 2002")
  const RES5 = HP.map((v, i) => (Number.isFinite(v) ? v - FIT.c - FIT.at(MJD0 + i, ALL) : NaN));
  const m5 = X.runMean(RES5, 5), FAST = RES5.map((v, i) => v - m5[i]);
  const fastPow = (y0, y1) => { const v = FAST.filter((q, i) => YEAR_OF[i] >= y0 && YEAR_OF[i] <= y1 && Number.isFinite(q)); return v.reduce((p, q) => p + q * q, 0) / v.length; };
  const fastMid = fastPow(MEAS_Y, 2001) / fastPow(2002, 2025);
  t.diagnostic(`power under ~5 d, 1985-2001 vs 2002-2025: ${fastMid.toFixed(2)}`);
  assert.ok(fastMid < 0.5, `fast power ratio ${fastMid}`);
  for (let y = MEAS_Y; y <= 2025; y++) assert.ok(X.yearPower(y) > 0.4, `year ${y}: ${X.yearPower(y)}`);
  // from 1985 on the background at these periods is as strong as today's (1985-2001 against 2002-2025)
  const midLate = (X.eraMid.rms / X.eraLate.rms) ** 2;
  assert.ok(midLate > 0.8 && midLate < 1.25, `1985-2001 vs 2002-2025 band power ${midLate}`);
  // ...under a fortnightly line of full strength: only possible if the tide was removed and restored
  assert.ok(Math.abs(X.eraEarly.mf - X.eraMeas.mf) < 0.03 * X.eraMeas.mf, `Mf ${X.eraEarly.mf} vs ${X.eraMeas.mf}`);
  // the page now says so plainly, and tests the Moon on the measured era only
  assert.ok(!html.includes("can't rule it out"), 'the old hedge is gone');
  assert.ok(html.includes("before the mid-1980s the 9–32-day ripple in this file is mostly the producers' tide model"));
  const md = read('README.md');
  assert.ok(!md.includes('this file alone cannot settle it'), 'README no longer says the file cannot settle it');
  // the lunar lines stand far above background in the measured era alone
  for (const k of ['Mf', 'Mm', 'MSf', 'MSm', 'Mtm']) assert.ok(X.ratio[k] > 50, `${k} ${X.ratio[k]}`);
  assert.ok(X.max_dev_minutes < 10, `measured-era offset ${X.max_dev_minutes}`);
});

test('the sound: the 1970s are the smoothest stretch, not hiss (page, README)', (t) => {
  // the audio series exactly as app.js builds it: high-passed, minus fitted seasons, minus its own 61-day mean
  const NS = HP.map((v, i) => v - FIT.c - FIT.at(MJD0 + i, SEASONAL));
  const a = NS.findIndex(Number.isFinite), b = N - 1 - [...NS].reverse().findIndex(Number.isFinite);
  const build = (withMoon) => {
    const x = NS.slice(a, b + 1).map((v, k) => (withMoon ? v : v - FIT.at(MJD0 + a + k, LUNAR)));
    const rm = X.runMean(x, 61);
    return x.map((v, k) => (Number.isFinite(rm[k]) ? v - rm[k] : 0));
  };
  // rms of each 4-year block, either in full or only of its components with periods under 8 days (what would
  // be heard as hiss), the latter from the block's own DFT by Parseval
  const blocks = (vals, under8) => {
    const out = [];
    for (let y0 = 1974; y0 <= 2022; y0 += 4) {
      const v = [];
      vals.forEach((q, k) => { const y = YEAR_OF[a + k]; if (y >= y0 && y < y0 + 4) v.push(q); });
      const n2 = v.length, m2 = v.reduce((p, q) => p + q, 0) / n2, c = v.map((q) => q - m2);
      let ms = 0;
      if (!under8) ms = c.reduce((p, q) => p + q * q, 0) / n2;
      else {
        for (let k = Math.ceil(n2 / 8) + (n2 % 8 === 0 ? 1 : 0); k <= Math.floor(n2 / 2); k++) {
          let re = 0, im = 0;
          for (let i = 0; i < n2; i++) { const w = (2 * Math.PI * k * i) / n2; re += c[i] * Math.cos(w); im -= c[i] * Math.sin(w); }
          ms += (2 * k === n2 ? 1 : 2) * (re * re + im * im) / (n2 * n2);
        }
      }
      out.push({ y0, rms: Math.sqrt(ms) });
    }
    return out;
  };
  const withMoon = build(true), noMoon = build(false);
  const fast = blocks(withMoon, true);
  const quiet = blocks(noMoon, false);
  X.audioFast = fast; X.audioQuiet = quiet;
  t.diagnostic(`audio rms under 8 d by 4-year block: ${fast.map((q) => `${q.y0} ${q.rms.toFixed(4)}`).join(', ')}`);
  t.diagnostic(`audio rms with the Moon out: ${quiet.map((q) => `${q.y0} ${q.rms.toFixed(3)}`).join(', ')}`);
  const byFast = [...fast].sort((p, q) => p.rms - q.rms).map((q) => q.y0);
  assert.deepEqual(byFast.slice(0, 2).sort(), [1974, 1978], `quietest fast blocks ${byFast}`);
  const late = fast.filter((q) => q.y0 >= 2002).map((q) => q.rms);
  assert.ok(fast[0].rms < 0.5 * Math.min(...late), `${fast[0].rms} vs ${Math.min(...late)}`);
  assert.equal([...quiet].sort((p, q) => p.rms - q.rms)[0].y0, 1974, 'with the Moon out, the first block is the quietest');
  assert.ok(!/hiss/i.test(html), 'the page no longer says the start is hiss');
  assert.ok(html.includes('The start is the smoothest stretch, not the noisiest'));
  assert.ok(!/audible as hiss/.test(read('README.md')));
});

test('the Pacific: lag-0 correlation, effective-n p, insensitive to lag and era, events', (t) => {
  // the AR(1) shortcut reproduces the earlier figure; the general lag-by-lag form gives about 100 effective months
  assert.ok(Math.abs(X.pac.pAR1 - 0.0037) < 0.0005, `AR(1) p ${X.pac.pAR1}`);
  assert.ok(X.pac.neff > 85 && X.pac.neff < 115 && X.pac.p < 1e-5, `neff ${X.pac.neff} p ${X.pac.p}`);
  // one month either way, and each third of the record
  assert.ok(X.lagDev < 0.05, `lag sensitivity ${X.lagDev}`);
  assert.ok(Math.min(...X.thirds) > 0.4, `thirds ${X.thirds}`);
  const best = X.lags.reduce((p, q) => (q.r > p.r ? q : p));
  X.bestLag = best;
  t.diagnostic(`sensitivity (7-year high-pass, ONI level): r ${X.sens.r.toFixed(4)} n ${X.sens.n} neff ${X.sens.neff.toFixed(1)} p ${X.sens.p.toExponential(2)} (AR(1): ${X.sens.neffAR1.toFixed(1)}, ${X.sens.pAR1.toFixed(4)})`);
  assert.ok(X.sens.r > 0.3, 'the alternative high-pass agrees in sign and roughly in size');
  t.diagnostic(`r ${X.pac.r.toFixed(4)} n ${X.pac.n} lag1 ${X.pac.r1.toFixed(3)} ${X.pac.r2.toFixed(3)} neff ${X.pac.neff.toFixed(2)} t ${X.pac.t.toFixed(3)} p ${X.pac.p.toExponential(3)}; AR(1) neff ${X.pac.neffAR1.toFixed(2)} p ${X.pac.pAR1.toFixed(5)}; best lag ${best.L} (r ${best.r.toFixed(4)}); thirds ${X.thirds.map((v) => v.toFixed(3))}`);
  assert.ok(Math.abs(best.L) <= 1 && best.r - X.pac.r < 0.02, `best lag ${best.L} r ${best.r}`);
  const R = X.pac_rows;
  const peakIn = (y0, m0, y1, m1) => Math.max(...R.filter((r) => r.k >= y0 * 12 + m0 - 1 && r.k <= y1 * 12 + m1 - 1).map((r) => r.dl));
  assert.ok(peakIn(1982, 10, 1983, 3) > 0.5 && peakIn(2015, 9, 2016, 3) > 0.5, 'the two events that stand out');
  assert.ok(peakIn(1997, 9, 1998, 3) < 0.25 && peakIn(2023, 9, 2024, 3) < 0.25, 'the two that barely register');
  // the latest twelve-month change is the largest in the record; the latest ONI is the highest since early 2016
  assert.equal(Math.max(...R.map((r) => r.dl)), R[R.length - 1].dl);
  const lastOni = R[R.length - 1].oni;
  const since = ONI.filter((o) => o.y * 12 + o.m > 2016 * 12 + 2 && !(o.y === 2026 && o.m === 8));
  assert.ok(since.every((o) => o.anom < lastOni), 'nothing since FMA 2016 reaches the latest value');
  assert.ok(ONI.some((o) => o.y === 2016 && o.m === 2 && o.anom >= lastOni), 'JFM 2016 did');
});

test('phase-randomised surrogates: the Pacific correlation is not chance; they imply about 100 effective months', (t) => {
  // Keep every Fourier amplitude of the day-length series (so its autocorrelation), randomise the phases, and
  // correlate with the unchanged ONI series. Done in the frequency domain: r = Re sum S_k conj(Y_k) / (|S||Y|).
  const xs = X.pac_rows.map((r) => r.dl), ys = X.pac_rows.map((r) => r.do), n = xs.length;
  const mx = xs.reduce((p, q) => p + q, 0) / n, my = ys.reduce((p, q) => p + q, 0) / n;
  const x0 = xs.map((v) => v - mx), y0 = ys.map((v) => v - my);
  const H = Math.floor(n / 2), XR = [], XI = [], YR = [], YI = [];
  for (let k = 0; k <= H; k++) {
    let a = 0, b = 0, c = 0, d = 0;
    for (let i = 0; i < n; i++) { const w = (2 * Math.PI * k * i) / n, cw = Math.cos(w), sw = Math.sin(w); a += x0[i] * cw; b -= x0[i] * sw; c += y0[i] * cw; d -= y0[i] * sw; }
    XR.push(a); XI.push(b); YR.push(c); YI.push(d);
  }
  const wt = (k) => (k === 0 || (n % 2 === 0 && k === H) ? 1 : 2);
  let sxx = 0, syy = 0;
  for (let k = 0; k <= H; k++) { sxx += wt(k) * (XR[k] ** 2 + XI[k] ** 2); syy += wt(k) * (YR[k] ** 2 + YI[k] ** 2); }
  const AMP = XR.map((v, k) => Math.hypot(v, XI[k])), norm = Math.sqrt(sxx * syy);
  const rOf = (phase) => { let num = 0; for (let k = 1; k <= H; k++) num += wt(k) * AMP[k] * (Math.cos(phase(k)) * YR[k] + Math.sin(phase(k)) * YI[k]); return num / norm; };
  // with the original phases this reproduces r exactly
  const orig = rOf((k) => Math.atan2(XI[k], XR[k]));
  assert.ok(Math.abs(orig - X.pac.r) < 1e-9, `reconstructed r ${orig} vs ${X.pac.r}`);
  let st = 58;
  const rnd = () => { st = (st + 0x6d2b79f5) | 0; let z = Math.imul(st ^ (st >>> 15), 1 | st); z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z; return ((z ^ (z >>> 14)) >>> 0) / 4294967296; };
  let hits = 0, s1 = 0, s2 = 0, maxAbs = 0;
  const ph = new Float64Array(H + 1);
  for (let sIdx = 0; sIdx < SURROGATES; sIdx++) {
    for (let k = 1; k <= H; k++) ph[k] = n % 2 === 0 && k === H ? (XR[k] >= 0 ? 0 : Math.PI) : 2 * Math.PI * rnd();
    const r = rOf((k) => ph[k]);
    s1 += r; s2 += r * r; maxAbs = Math.max(maxAbs, Math.abs(r));
    if (Math.abs(r) >= Math.abs(X.pac.r)) hits++;
  }
  const sd = Math.sqrt(s2 / SURROGATES - (s1 / SURROGATES) ** 2), neffSur = 1 + 1 / sd ** 2;
  X.surrogate = { hits, S: SURROGATES, sd, neff: neffSur, maxAbs };
  t.diagnostic(`surrogates as extreme as r = ${X.pac.r.toFixed(4)}: ${hits} of ${SURROGATES}; sd ${sd.toFixed(4)} -> N_eff ${neffSur.toFixed(1)}; largest |r| ${maxAbs.toFixed(3)}`);
  t.diagnostic(`effective n: lag-by-lag sum ${X.pac.neff.toFixed(1)} (p ${X.pac.p.toExponential(2)}), AR(1) ${X.pac.neffAR1.toFixed(1)} (p ${X.pac.pAR1.toFixed(4)})`);
  assert.equal(hits, 0, `${hits} of ${SURROGATES} surrogates as extreme`);
  // the surrogates and the lag-by-lag sum agree on about 100 effective months; the AR(1) shortcut's 35 does not
  assert.ok(neffSur > 85 && neffSur < 115 && Math.abs(neffSur - X.pac.neff) < 0.15 * X.pac.neff, `${neffSur} vs ${X.pac.neff}`);
  assert.ok(X.pac.neffAR1 < 0.5 * neffSur, 'AR(1) is the conservative bound');
  // if p really were the AR(1) value, seeing no surrogate that extreme in 20,000 would itself be absurdly unlikely
  assert.ok(Math.pow(1 - X.pac.pAR1, SURROGATES) < 1e-20);
  // the AR(1) memory assumption fails: lag-1 autocorrelation 0.93 implies 0.53 at lag 9, the data say about 0.24
  assert.ok(X.acfAt.x[2] < 0.6 * Math.pow(X.pac.r1, 9), `acf(9) ${X.acfAt.x[2]} vs AR(1) ${Math.pow(X.pac.r1, 9)}`);
});

test('with the six lunar sine waves subtracted, the lunar lines are gone (the "notes go")', (t) => {
  const resid = okIdx.map((i) => HP[i] - FIT.c - FIT.at(MJD0 + i, SEASONAL) - FIT.at(MJD0 + i, LUNAR));
  const m = resid.reduce((a, b) => a + b, 0) / resid.length;
  const tap = resid.map((v, i) => (v - m) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (resid.length - 1))));
  const pw = (fr) => {
    const c = Math.cos(2 * Math.PI * fr), s = Math.sin(2 * Math.PI * fr);
    let re = 0, im = 0, wr = 1, wi = 0;
    for (let i = 0; i < tap.length; i++) { re += tap[i] * wr; im -= tap[i] * wi; const nr = wr * c - wi * s; wi = wr * s + wi * c; wr = nr; }
    return re * re + im * im;
  };
  const ratioR = (f0) => {
    const band = [];
    for (let j = Math.ceil(0.85 * f0 * NPAD); j <= Math.floor(1.15 * f0 * NPAD); j += 4) {
      const fr = j / NPAD;
      if (KNOWN.some((L) => Math.abs(fr - L) < GUARD)) continue;
      band.push(pw(fr));
    }
    band.sort((a, b) => a - b);
    return pw(f0) / band[band.length >> 1];
  };
  const after = { Mf: ratioR(FREQ.Mf), Mm: ratioR(FREQ.Mm) };
  t.diagnostic(`power / background after subtraction: Mf ${after.Mf.toFixed(2)}, Mm ${after.Mm.toFixed(2)}`);
  X.after = after;
  assert.ok(after.Mf < 10 && after.Mm < 10, JSON.stringify(after));
});

test('the seasonal dots: part of their ripple is lunar (README)', () => {
  const cum = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const means = (fn) => {
    const s = new Float64Array(365), n = new Float64Array(365);
    okIdx.forEach((i) => { const c = civil(MJD0 + i); const d = cum[c.m - 1] + Math.min(c.d, c.m === 2 ? 28 : 31) - 1; s[d] += fn(i); n[d]++; });
    return Array.from(s, (v, k) => v / n[k]);
  };
  const s0 = mjdOf(2001, 1, 1);
  const rms = (arr) => Math.sqrt(arr.reduce((acc, v, k) => acc + (v - FIT.c - FIT.at(s0 + k, SEASONAL)) ** 2, 0) / arr.length);
  X.rippleWith = rms(means((i) => HP[i]));
  X.rippleWithout = rms(means((i) => HP[i] - FIT.at(MJD0 + i, LUNAR)));
  assert.ok(X.rippleWithout < 0.75 * X.rippleWith && X.rippleWithout > 0.02);
});

test('README quotes the recomputed numbers', () => {
  const md = read('README.md');
  const P = X.peaks, PR = (k) => `${f(P[k], 4)} (${f(1 / FREQ[k], 4)})`;
  const RA = X.ratioAll;
  const lagR = (L) => f(X.lags.find((q) => q.L === L).r, 3);
  const fast = (y0) => X.audioFast.find((q) => q.y0 === y0).rms, late = X.audioFast.filter((q) => q.y0 >= 2002).map((q) => q.rms);
  const quiet = X.audioQuiet.filter((q) => q.y0 > 1974).map((q) => q.rms);
  const must = [
    `${X.n_days} days`, X.first_date, X.last_date, `${X.zero_date}`, `+${X.max_ms} ms`, `${X.min_ms} ms`,
    `${X.mf_ratio}× at 13.66 d`, `${X.msm_ratio}× at 31.81 d`, `${X.syn_ratio}×`, `${X.trop_ratio}×`, `${X.oos_r2}%`,
    `${X.amp_min} ms (${X.amp_min_year}) to ${X.amp_max} ms (${X.amp_max_year})`, `r = ${X.amp_tilt_r}`, `(${X.amp_years} years`,
    `${X.seas_max_date}`, `${X.seas_min_date}`, `${X.seas_range} ms`,
    `r = ${X.pac_r}`, `${X.pac_n} months`, `effective n ≈ ${X.pac_neff}`, `p ≈ ${X.sciU(X.pac.p)}`, `${X.dlod_last} ms`, `${X.oni_last} °C`,
    `${X.drift_s} s`, `${X.leaps_in} leap seconds`, `${X.since_leap} s`, X.first_neg, `${X.neg_days} days`,
    `correlates ${X.phase_mf} with`, `${X.phase_mm} with cos(mean anomaly)`, `within about ${X.phase_hours} hours in both cases`,
    `the weakest within ${X.max_dev_min} minutes`, `"within ${X.max_dev_min} minutes"`, X.extra_peaks,
    // the measured era's peaks, ratios and controls
    `${f(P.Mf, 4)} (predicted ${f(1 / FREQ.Mf, 4)}), ${PR('Mtm')}, ${PR('Mm')}, ${PR('MSf')}, ${PR('MSm')} days`,
    `${f(X.ratio.Mtm, 0)}× at 9.13 d`, `${f(X.ratio.Mm, 0)}× at 27.55 d`, `${f(X.ratio.MSf, 0)}× at 14.77 d`, `the draconic month ${f(X.ratio.drac, 2)}×`,
    `${X.msm_ratio} gives about ${X.sciU(Math.pow(2, -Math.round(X.ratio.MSm)))}`,
    `about ${f((1440 * (1 / FREQ.Mf) ** 2) / TAP_M.length, 0)} minutes at 13.66 days and ${f((1440 * (1 / FREQ.MSm) ** 2) / TAP_M.length, 0)} minutes at 31.8 days`,
    // and over the whole record, for comparison
    `${f(RA.Mf, 0)}×, ${f(RA.Mtm, 0)}×, ${f(RA.Mm, 0)}×, ${f(RA.MSf, 0)}× and ${f(RA.MSm, 0)}×, every peak lies within ${Math.ceil(X.max_dev_minutes_all)} minutes, and the controls read ${f(RA.syn, 2)}×, ${f(RA.trop, 2)}× and ${f(RA.drac, 2)}×`,
    `from ${f(RA.Mf, 0)}× to ${f(X.after.Mf, 2)}×`, `from ${f(RA.Mm, 0)}× to ${f(X.after.Mm, 2)}×`,
    `mean anomaly of about ${f(moon(mjdOf(2016, 11, 14) + 11 / 24).M, 0)}°`, `${f(X.oos_n, 0)} days after`, `Fitted only to ${MEAS_Y}–2015`,
    `${f(X.amp_ratio, 1)}-fold`,
    // the early record
    `${X.era_power}% of its ${MEAS_Y}–2025 power`, `median stated error then was ${f(X.eraEarly.medErr, 4)} ms against ${f(X.eraMeas.medErr, 4)} ms, ${X.era_err_x} times larger`,
    `${f(X.eraEarly.mf, 3)} ms, against ${f(X.eraMeas.mf, 3)} ms from ${MEAS_Y} on`,
    // the sound's start
    `${f(fast(1974), 3)} ms in 1974–1977 and ${f(fast(1978), 3)} ms in 1978–1981, against ${f(Math.min(...late), 3)}–${f(Math.max(...late), 3)} ms`,
    `(${f(X.audioQuiet[0].rms, 3)} ms rms against ${f(Math.min(...quiet), 2)}–${f(Math.max(...quiet), 2)} ms)`,
    // the Pacific
    `${lagR(-1)} with the day one month ahead of the ocean, ${lagR(0)} at lag 0, ${lagR(1)} with the day one month behind`,
    `${X.thirds.map((v) => f(v, 2)).slice(0, 2).join(', ')} and ${f(X.thirds[2], 2)} in each third`,
    `about ${X.pac_neff}, giving t = ${f(X.pac.t, 2)} on ${f(X.pac.neff - 2, 1)} degrees`,
    `0 of ${f(SURROGATES, 0)} surrogates with |r| as large (the largest was ${f(X.surrogate.maxAbs, 2)})`, `(SD ${f(X.surrogate.sd, 3)}) implies an effective sample size of about ${f(X.surrogate.neff, 0)}`,
    `gives ${f(X.pac.neffAR1, 0)} and p ≈ ${f(X.pac.pAR1, 3)} from lag-1 autocorrelations of ${f(X.pac.r1, 3)} and ${f(X.pac.r2, 3)}`,
    `${X.acfAt.x.map((v) => f(v, 2)).slice(0, 3).join(', ')} and ${f(X.acfAt.x[3], 2)} for the day; ${X.acfAt.y.map((v) => f(v, 2)).slice(0, 3).join(', ')} and ${f(X.acfAt.y[3], 2)} for the ONI`,
    `gives ${f(X.neffSpan[0], 0)} to ${f(X.neffSpan[1], 0)} depending on where it is truncated`, `p lies between about ${X.sciU(X.pSpan[0])} and ${X.sciU(X.pSpan[1])}`,
    `r = ${f(X.sens.r, 2)} over ${X.sens.n} months, effective n ≈ ${f(X.sens.neff, 0)}, p ≈ ${X.sciU(X.sens.p)}`,
    `from effective n ≈ ${f(X.sens.neffAR1, 0)} and p ≈ ${f(X.sens.pAR1, 2)} to ${f(X.sens.neff, 0)} and ${X.sciU(X.sens.p)} (${f(X.sensSpan[0], 0)} to ${f(X.sensSpan[1], 0)} depending on truncation)`,
    // the record and its errors
    `${X.err_1973} ms on the record's first days`, `about ${X.err_recent} ms`,
    `${X.e70.p10}–${X.e70.p90} ms on 80% of days (median ${X.e70.med} ms, maximum ${X.e70.max} ms)`,
    `predicts ${X.ut1pred} s on 21 October 2026; the file says ${X.ut1file} s`,
    `${f(X.distinct, 0)} distinct values cover the ${X.n_days} days`,
    `from ${X.hp_first} to ${X.hp_last}`,
    // the birthday line, in-record births only
    `For ${X.longestShare}% of days of birth from ${X.first_date} to the end of 2008, the longest day since was one of three ordinary days: ${X.longestThree}`,
    `Anyone born before 1973 gets ${X.max_date}, but only because that is where the record begins`,
    // standstills
    `The largest year near each major standstill (${X.nearMajor.map((q) => q.y).join(', ')}) falls within 1.5 years of it (${X.major_list}`,
    `from ${f(X.rippleWith, 3)} to ${f(X.rippleWithout, 3)} ms rms`,
    `all ${spans.size} tagged numbers`,
    `${X.zero_consistent} days in all lie within their own stated error of zero (${X.zero_consistent2} within twice it)`,
    // the cited long-term trend: net 1.8 ms/cy, against 2.3 from tidal friction alone
    'about 1.8 ms per century on average over 2,700 years, significantly less than the 2.3 ms per century that tidal friction alone predicts',
  ];
  const missing = must.filter((s) => !md.includes(s));
  assert.deepEqual(missing, []);
  // and what the review found wrong is gone (outside the revision note, which names it)
  const body = md.slice(0, md.indexOf('## Revision note'));
  const gone = ['82%', 'between 1940 and 2008', 'audible as hiss', 'this file alone cannot settle it', 'No two were the same',
    'no two were the same;', '21 April 2026', 'long-term braking (tides, about 1.8 ms', 'The three largest years are each within'];
  assert.deepEqual(gone.filter((s) => body.includes(s)), []);
});

test('fixes from the independent review are pinned (page, README, code)', () => {
  const md = read('README.md'), core = read('lod-core.js'), src = read('data/SOURCE.md');
  const tagline = /^> (.+)$/m.exec(md)[1];
  // one tagline, the same in the README, the page header and the meta description
  assert.ok(html.includes(`<p class="tagline">${tagline}</p>`) && html.includes(`<meta name="description" content="${tagline}">`), 'tagline matches the page');
  // "no two were the same" was false: many days share a published value
  assert.ok(X.distinct < N && X.sharedDays > 0, `${X.distinct} distinct values over ${N} days`);
  assert.equal(X.distinct, 15394);
  assert.ok(!/no two/i.test(tagline) && !/atomic clocks have kept/.test(tagline), tagline);
  // the 82% counted pre-1973 births, every one of which lands on the record maximum by construction
  assert.equal(X.clamped.hits, X.clamped.births);
  assert.equal(X.longestShare, '75');
  assert.ok(X.longestThree.includes('21 October 1976'), X.longestThree);
  // the drift-removal span: 4 July 1973 to 22 April 2026, in the README and SOURCE.md
  assert.equal(X.hp_first, '4 July 1973'); assert.equal(X.hp_last, '22 April 2026');
  assert.ok(src.includes(`defined from ${X.hp_first} to ${X.hp_last}`));
  // the AR(1) shortcut is not presented as the honest figure, and the code no longer says "pre-registered"
  assert.ok(!/Pre-registered/.test(core) && /not formally pre-registered/.test(core));
  assert.ok(!html.includes('35 independent') && !html.includes('probability about 0.004'));
  // Stephenson et al. 2016: tides would give 2.3 ms per century; the net, observed 1.8 is not "tides"
  assert.ok(html.includes('brake the Earth enough to add about 2.3 ms per century') && html.includes('lengthened by about 1.8 ms per century'));
  assert.ok(!html.includes('Tides have been braking the Earth since, lengthening the day by about 1.8'));
  // Yoder, Williams and Parke did the standard calculation, not all of the theory
  assert.ok(!html.includes('was worked out by Yoder') && html.includes("is Yoder, Williams and Parke's (1981)"));
  // the 2026 leap-second vote: reported, with the source's limits stated
  assert.ok(!html.includes('I could not confirm the outcome') && html.includes('15 October 2026') && html.includes('20 May 2027'));
  // the minor standstills: the smallest measured years fall near them, not exactly at them
  for (const s0 of X.minor.filter((v) => v > MEAS_Y)) {
    const near = X.yearlyM.filter((r0) => Math.abs(r0.y + 0.5 - s0) < 4).reduce((p0, q0) => (q0.amp < p0.amp ? q0 : p0));
    assert.ok(Math.abs(near.y + 0.5 - s0) < 2.5, `minor ${s0}: smallest year ${near.y}`);
  }
  assert.ok(html.includes('Its smallest years come near minor standstills'));
});

test('lod-core.js (what the page draws) agrees with this independent code', () => {
  const require = createRequire(import.meta.url);
  const C = require('./lod-core.js');
  const A = C.analyse(require('./data/lod.js'), require('./data/oni.js'), require('./data/leapsec.js'));
  const close = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: core ${a} vs independent ${b}`);
  for (const k of ALL) close(A.amps[k], X.amp[k], 1e-9, `amplitude ${k}`);
  for (const k of ALL) close(A.ampsM[k], FIT_M.terms[k].amp, 1e-9, `measured-era amplitude ${k}`);
  assert.equal(A.measuredYear, MEAS_Y);
  for (const k of ['Mf', 'Mm', 'MSf', 'MSm', 'Mtm']) {
    close(A.lineTests[k].ratio, X.ratio[k], 1e-6 * X.ratio[k], `ratio ${k}`);
    close(A.lineTestsAll[k].ratio, X.ratioAll[k], 1e-6 * X.ratioAll[k], `whole-record ratio ${k}`);
    close(A.lineTests[k].peakPeriod, X.peaks[k], 0.0015, `peak ${k}`);
    close(A.lineTestsAll[k].peakPeriod, X.peaksAll[k], 0.0015, `whole-record peak ${k}`);
  }
  close(A.controls.synodic.ratio, X.ratio.syn, 1e-9, 'synodic control');
  close(A.controls.tropical.ratio, X.ratio.trop, 1e-9, 'tropical control');
  close(A.controlsAll.synodic.ratio, X.ratioAll.syn, 1e-9, 'whole-record synodic control');
  close(A.oos.r2, X.oos_r2_value, 1e-9, 'forecast R2');
  close(A.pacific.test.r, X.pac.r, 1e-12, 'Pacific r');
  close(A.pacific.test.neff, X.pac.neff, 1e-9, 'Neff (lag-by-lag)');
  close(A.pacific.test.neffAR1, X.pac.neffAR1, 1e-9, 'Neff (AR(1))');
  close(A.pacific.test.p, X.pac.p, 1e-9, 'Pacific p (incomplete beta vs Simpson)');
  close(A.pacific.test.pAR1, X.pac.pAR1, 2e-6, 'Pacific AR(1) p');
  close(A.ampVsTilt, X.amp_tilt, 1e-9, 'ripple vs tilt, measured years');
  close(A.ampVsTiltAll, X.amp_tilt_all, 1e-9, 'ripple vs tilt, all years');
  assert.equal(A.yearly.length, X.yearly.length);
  A.yearly.forEach((r, i) => { close(r.amp, X.yearly[i].amp, 1e-9, `ripple ${r.year}`); assert.equal(r.measured, r.year >= MEAS_Y); });
  assert.equal(A.ampMin.year, Number(X.amp_min_year)); assert.equal(A.ampMax.year, Number(X.amp_max_year));
  close(A.eras.early.bandRms, X.eraEarly.rms, 1e-12, 'early band rms');
  close(A.eras.measured.bandRms, X.eraMeas.rms, 1e-12, 'measured band rms');
  close(A.eras.early.mfAmp, X.eraEarly.mf, 1e-9, 'early Mf');
  close(A.eras.measured.mfAmp, X.eraMeas.mf, 1e-9, 'measured Mf');
  close(A.eras.early.medianErr, X.eraEarly.medErr, 0, 'early median error');
  close(A.phase.mfVsEquator, X.phase_mf_r, 1e-9, 'Mf phase');
  close(A.phase.mmVsPerigee, X.phase_mm_r, 1e-9, 'Mm phase');
  close(A.record.driftSeconds, LOD.reduce((a, b) => a + b, 0) / 1000, 1e-9, 'drift');
  // personal(): a birthday's numbers against a brute-force recount
  const L = A.L, mjd = mjdOf(1985, 3, 14), i0 = mjd - MJD0;
  const p = C.personal(L, require('./data/leapsec.js'), mjd);
  close(p.lod, LOD[i0], 0, 'birthday LOD');
  close(p.percentLonger, (100 * LOD.filter((v) => v < LOD[i0]).length) / N, 1e-12, 'percent');
  close(p.driftSeconds, LOD.slice(i0).reduce((a, b) => a + b, 0) / 1000, 1e-9, 'drift since birthday');
  assert.equal(p.leaps, LEAPS.filter((r) => r.mjd > mjd && r.mjd <= MJD0 + N - 1).length);
  assert.equal(p.longest, Math.max(...LOD.slice(i0)));
  assert.equal(p.shortest, Math.min(...LOD.slice(i0)));
});

test('consistency: the summed day lengths reproduce the UT1 drift across the leap seconds', () => {
  // UT1-UTC before the first day (from the file) plus leap seconds minus the summed excess gives UT1-UTC at the
  // end; the last observed UT1-UTC in the excerpt is -0.0414065 s on 2026-10-21.
  const before = Number(/ut1MinusUtcBeforeFirst:\s*(-?[\d.]+)/.exec(lodSrc)[1]);
  const lastLine = read('data/finals2000A.excerpt.txt').split('\n').filter((l) => l.length > 0).pop();
  const ut1Last = Number(lastLine.slice(58, 68));
  const leaps = Number(X.leaps_in);
  // daily excess on day i is the UT1 loss from day i-1 to day i (to within rounding); 0.0002 s allows for that
  const predicted = before + leaps - LOD.reduce((a, b) => a + b, 0) / 1000;
  assert.ok(Math.abs(predicted - ut1Last) < 0.002, `predicted ${predicted} vs file ${ut1Last}`);
});
