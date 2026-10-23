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

// Direct DFT power of the Hann-tapered high-passed series at frequency fr (cycles/day)
const RUN = okIdx.map((i) => HP[i]);
const RUNMEAN = RUN.reduce((a, b) => a + b, 0) / RUN.length;
const TAPERED = RUN.map((v, i) => (v - RUNMEAN) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (RUN.length - 1))));
function power(fr) {
  // rotate a phasor rather than calling cos/sin per sample
  const c = Math.cos(2 * Math.PI * fr), s = Math.sin(2 * Math.PI * fr);
  let re = 0, im = 0, wr = 1, wi = 0;
  for (let i = 0; i < TAPERED.length; i++) {
    re += TAPERED[i] * wr; im -= TAPERED[i] * wi;
    const nr = wr * c - wi * s; wi = wr * s + wi * c; wr = nr;
  }
  return re * re + im * im;
}
const NPAD = 131072, GUARD = 4e-4;
const KNOWN = ALL.map((k) => FREQ[k]);
function lineRatio(f0) {
  const band = [];
  for (let j = Math.ceil((0.85 * f0) * NPAD); j <= Math.floor(1.15 * f0 * NPAD); j++) {
    const fr = j / NPAD;
    if (Math.abs(fr - f0) < GUARD || KNOWN.some((L) => Math.abs(fr - L) < GUARD)) continue;
    band.push(power(fr));
  }
  band.sort((a, b) => a - b);
  const med = band.length % 2 ? band[band.length >> 1] : (band[band.length / 2 - 1] + band[band.length / 2]) / 2;
  return power(Math.round(f0 * NPAD) / NPAD) / med;
}
function peakPeriod(f0, halfWidth = GUARD) {
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
  // the longest day since a birthday, for birthdays on the 15th of Jan, Apr, Jul, Oct, 1940-2008
  const tally = new Map();
  let births = 0;
  for (let y = 1940; y <= 2008; y++) for (const m of [1, 4, 7, 10]) {
    const i0 = Math.max(0, mjdOf(y, m, 15) - MJD0);
    let best = i0;
    for (let i = i0; i < N; i++) if (LOD[i] > LOD[best]) best = i;
    tally.set(best, (tally.get(best) || 0) + 1); births++;
  }
  const top3 = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  X.err_70s_med = X.e70.med;
  X.longestShare = f((100 * top3.reduce((s, e2) => s + e2[1], 0)) / births, 0);
  const sorted3 = top3.map((e2) => e2[0]).sort((a, b) => a - b).map((i) => words(MJD0 + i));
  X.longestThree = `${sorted3[0]}, ${sorted3[1]} or ${sorted3[2]}`;
  const rec = ERR.filter((_, i) => { const y = civil(MJD0 + i).y; return y >= 2016 && y <= 2025; }).sort((a, b) => a - b);
  X.err_recent = f(rec[rec.length >> 1], 3);

  // periods
  X.tropical = f(TROP, 4); X.tropical2 = X.tropical; X.anomalistic = f(ANOM, 4); X.synodic = f(SYN, 4);
  X.mf_period = f(1 / FREQ.Mf, 4); X.mf_period_short = f(1 / FREQ.Mf, 2); X.msm_period_short = f(1 / FREQ.MSm, 2);
  X.hz_mf = f(4000 * FREQ.Mf, 0); X.hz_mm = f(4000 * FREQ.Mm, 0);

  // spectrum
  const peaks = {};
  for (const k of ['Mf', 'Mtm', 'Mm', 'MSf', 'MSm']) peaks[k] = peakPeriod(FREQ[k]);
  X.peaks = peaks;
  X.mf_peak = f(peaks.Mf, 3); X.mtm_peak = f(peaks.Mtm, 3); X.mm_peak = f(peaks.Mm, 3); X.msf_peak = f(peaks.MSf, 3); X.msf_peak2 = X.msf_peak; X.msm_peak = f(peaks.MSm, 3);
  X.max_dev_minutes = Math.max(...Object.keys(peaks).map((k) => Math.abs(peaks[k] - 1 / FREQ[k]) * 1440));
  X.max_dev_min = String(Math.ceil(X.max_dev_minutes));
  X.ratio = {};
  for (const k of ['Mf', 'Mm', 'MSf', 'MSm', 'Mtm']) X.ratio[k] = lineRatio(FREQ[k]);
  X.ratio.syn = lineRatio(1 / SYN); X.ratio.trop = lineRatio(1 / TROP); X.ratio.drac = lineRatio(1 / DRAC);
  X.mf_ratio = f(X.ratio.Mf, 0); X.msm_ratio = f(X.ratio.MSm, 0); X.syn_ratio = f(X.ratio.syn, 2); X.trop_ratio = f(X.ratio.trop, 2);
  const odds = Math.pow(2, Math.round(X.ratio.MSm)), e = Math.floor(Math.log10(odds));
  X.msm_odds = `${Math.round(odds / 10 ** e)}×10<sup>${e}</sup>`;
  // smaller spikes: 4s-2p, 4s-2h, 3s-2h+p
  X.extra = { Mqm: 4 * fs_ - 2 * fp, MSqm: 4 * fs_ - 2 * fh, MStm: 3 * fs_ - 2 * fh + fp };
  X.extra_peaks = `${f(1 / X.extra.Mqm, 2)}, ${f(1 / X.extra.MSqm, 2)} and ${f(1 / X.extra.MStm, 2)}`;

  // phase of the fitted lunar terms
  const a = [], b = [], c = [], d = [];
  for (let k = 0; k < 40000; k++) {
    const mj = 51544.5 + k * 0.25, mo = moon(mj);
    a.push(FIT.at(mj, ['Mf'])); b.push(Math.cos((2 * mo.L * Math.PI) / 180));
    c.push(FIT.at(mj, ['Mm'])); d.push(Math.cos((mo.M * Math.PI) / 180));
  }
  X.phase_mf_r = pearson(a, b); X.phase_mm_r = pearson(c, d);
  X.phase_mf = f(X.phase_mf_r, 3); X.phase_mm = f(X.phase_mm_r, 4);
  const hoursOff = (r, period) => (Math.acos(r) / (2 * Math.PI)) * period * 24;
  X.phase_hours_max = Math.max(hoursOff(X.phase_mf_r, 1 / FREQ.Mf), hoursOff(X.phase_mm_r, 1 / FREQ.Mm));
  X.phase_hours = String(Math.ceil(X.phase_hours_max));

  // forecast
  const cut = mjdOf(2016, 1, 1);
  const train = okIdx.filter((i) => MJD0 + i < cut), testI = okIdx.filter((i) => MJD0 + i >= cut);
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
  const ymax = yearly.reduce((p, r) => (r.amp > p.amp ? r : p)), ymin = yearly.reduce((p, r) => (r.amp < p.amp ? r : p));
  X.amp_max = f(ymax.amp, 2); X.amp_max_year = String(ymax.y); X.amp_min = f(ymin.amp, 2); X.amp_min_year = String(ymin.y);
  X.amp_ratio = ymax.amp / ymin.amp;
  X.amp_tilt = pearson(yearly.map((r) => r.amp), yearly.map((r) => r.cosOm)); X.amp_tilt_r = f(X.amp_tilt, 2);

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
  const ac = (v) => { const m = v.reduce((p, q) => p + q, 0) / v.length; let num = 0, den = 0; v.forEach((x, i) => { den += (x - m) ** 2; if (i) num += (x - m) * (v[i - 1] - m); }); return num / den; };
  const r1 = ac(xs), r2 = ac(ys), neff = (rows.length * (1 - r1 * r2)) / (1 + r1 * r2);
  const t = r * Math.sqrt((neff - 2) / (1 - r * r));
  X.pac = { r, n: rows.length, r1, r2, neff, t, p: tPValue(t, neff - 2) };
  X.pac_r = f(r, 2); X.pac_n = f(rows.length, 0); X.pac_neff = f(neff, 0); X.pac_p = f(X.pac.p, 3);
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
    const rr = pearson(sx, sy), q1 = ac(sx), q2 = ac(sy), ne = (sx.length * (1 - q1 * q2)) / (1 + q1 * q2);
    const tt = rr * Math.sqrt((ne - 2) / (1 - rr * rr));
    X.sens = { r: rr, n: sx.length, neff: ne, p: tPValue(tt, ne - 2) };
  }
  X.lags = [];
  for (let L = -12; L <= 12; L++) {
    const a1 = [], b1 = [];
    rows.forEach((row, i) => { const j = i - L; if (j >= 0 && j < rows.length && rows[j].k === row.k - L) { a1.push(row.dl); b1.push(rows[j].do); } });
    X.lags.push({ L, r: pearson(a1, b1) });
  }
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
  amp_min: X.amp_min, amp_min_year: X.amp_min_year, amp_max: X.amp_max, amp_max_year: X.amp_max_year, amp_tilt_r: X.amp_tilt_r,
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

test('the lunar peaks sit at the predicted periods and stand far above background', () => {
  assert.ok(X.max_dev_minutes < 4, `largest peak offset ${X.max_dev_minutes.toFixed(2)} min`);
  for (const k of ['Mf', 'Mm', 'MSf', 'MSm', 'Mtm']) assert.ok(X.ratio[k] > 50, `${k} ratio ${X.ratio[k]}`);
  // the phases, the tropical month itself and the draconic month: nothing above background
  assert.ok(X.ratio.syn < 1.5 && X.ratio.trop < 1.5 && X.ratio.drac < 1.5, `controls ${X.ratio.syn} ${X.ratio.trop} ${X.ratio.drac}`);
  // the unlabelled spikes are local maxima within 0.005 d of their predicted combinations, well above background
  for (const [k, f0] of Object.entries(X.extra)) {
    const pk = peakPeriod(f0, 2e-4);
    assert.ok(Math.abs(pk - 1 / f0) < 0.005, `${k} peak ${pk} vs ${1 / f0}`);
    assert.ok(lineRatio(f0) > 30, `${k} ratio ${lineRatio(f0)}`);
  }
});

test('the fitted lunar terms peak when the Moon is over the equator and at perigee', () => {
  assert.ok(X.phase_mf_r > 0.99 && X.phase_mm_r > 0.99);
});

test('out-of-sample forecast and the 18.6-year modulation', () => {
  assert.ok(X.oos_r2_value > 0.7 && X.oos_r2_value < 0.8, `R2 ${X.oos_r2_value}`);
  assert.ok(X.amp_tilt > 0.95);
  assert.ok(X.amp_ratio > 2.3 && X.amp_ratio < 2.6, `max/min ${X.amp_ratio}`);
  // the years of largest ripple lie within 1.5 years of a major standstill
  const top = [...X.yearly].sort((a, b) => b.amp - a.amp).slice(0, 3);
  for (const r of top) assert.ok(X.major.some((s) => Math.abs(r.y + 0.5 - s) < 1.5), `top year ${r.y}`);
});

test('the Pacific: pre-registered lag-0 correlation, effective-n p, lag 0 is the peak, events', (t) => {
  assert.ok(Math.abs(X.pac.p - 0.0037) < 0.0005, `p ${X.pac.p}`);
  const best = X.lags.reduce((p, q) => (q.r > p.r ? q : p));
  X.bestLag = best;
  t.diagnostic(`sensitivity (7-year high-pass, ONI level): r ${X.sens.r.toFixed(4)} n ${X.sens.n} neff ${X.sens.neff.toFixed(1)} p ${X.sens.p.toFixed(4)}`);
  assert.ok(X.sens.r > 0.3, 'the alternative high-pass agrees in sign and roughly in size');
  t.diagnostic(`r ${X.pac.r.toFixed(4)} n ${X.pac.n} lag1 ${X.pac.r1.toFixed(3)} ${X.pac.r2.toFixed(3)} neff ${X.pac.neff.toFixed(2)} t ${X.pac.t.toFixed(3)} p ${X.pac.p.toFixed(5)}; best lag ${best.L} (r ${best.r.toFixed(4)})`);
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

test('phase-randomised surrogates agree that the Pacific correlation is not chance (README)', (t) => {
  // Shuffle the Fourier phases of the day-length series (keeps its autocorrelation), 2,000 times.
  const xs = X.pac_rows.map((r) => r.dl), ys = X.pac_rows.map((r) => r.do), n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n, x0 = xs.map((v) => v - mx);
  const K = Math.floor(n / 2), re = [], im = [], COS = [], SIN = [];
  for (let k = 0; k <= K; k++) {
    const ck = new Float64Array(n), sk = new Float64Array(n);
    for (let i = 0; i < n; i++) { ck[i] = Math.cos((2 * Math.PI * k * i) / n); sk[i] = Math.sin((2 * Math.PI * k * i) / n); }
    COS.push(ck); SIN.push(sk);
    let a = 0, b = 0; for (let i = 0; i < n; i++) { a += x0[i] * ck[i]; b -= x0[i] * sk[i]; } re.push(a); im.push(b);
  }
  let seed = 58;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  let hits = 0; const S = 2000;
  for (let sIdx = 0; sIdx < S; sIdx++) {
    const ph = re.map(() => 2 * Math.PI * rnd());
    const sur = new Array(n).fill(0);
    for (let k = 1; k <= K; k++) {
      const amp = Math.hypot(re[k], im[k]), w = (k === K && n % 2 === 0) ? 1 : 2;
      const phase = k === K && n % 2 === 0 ? 0 : ph[k];
      const cp = (w * amp * Math.cos(phase)) / n, sp = (w * amp * Math.sin(phase)) / n, ck = COS[k], sk = SIN[k];
      for (let i = 0; i < n; i++) sur[i] += cp * ck[i] - sp * sk[i];
    }
    if (Math.abs(pearson(sur, ys)) >= Math.abs(X.pac.r)) hits++;
  }
  X.surrogate = { hits, S };
  t.diagnostic(`surrogates as extreme as r = ${X.pac.r.toFixed(4)}: ${hits} of ${S}`);
  assert.ok(hits <= 2, `${hits} of ${S} surrogates as extreme`);
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
  const must = [
    `${X.n_days} days`, X.first_date, X.last_date, `${X.zero_date}`, `+${X.max_ms} ms`, `${X.min_ms} ms`,
    `${X.mf_ratio}×`, `${X.msm_ratio}×`, `${X.syn_ratio}×`, `${X.trop_ratio}×`, `${X.oos_r2}%`,
    `${X.amp_min} ms`, `${X.amp_max} ms`, `r = ${X.amp_tilt_r}`, `${X.seas_max_date}`, `${X.seas_min_date}`, `${X.seas_range} ms`,
    `r = ${X.pac_r}`, `${X.pac_n} months`, `≈ ${X.pac_neff}`, `p ≈ ${X.pac_p}`, `${X.dlod_last} ms`, `${X.oni_last} °C`,
    `${X.drift_s} s`, `${X.leaps_in} leap seconds`, `${X.since_leap} s`, X.first_neg, `${X.neg_days} days`,
    `${X.phase_mf}`, `${X.phase_mm}`, `within ${X.max_dev_min} minutes`, X.extra_peaks,
    `${X.surrogate ? X.surrogate.hits : 0} of 2,000`,
    `${f(X.ratio.Mtm, 0)}× at 9.13 d`, `${f(X.ratio.Mm, 0)}× at 27.55 d`, `${f(X.ratio.MSf, 0)}× at 14.77 d`, `${f(X.ratio.drac, 2)}×`,
    `mean anomaly of about ${f(moon(mjdOf(2016, 11, 14) + 11 / 24).M, 0)}°`, `${f(X.oos_n, 0)} days after`, `(${X.yearly.length} years)`,
    `${f(X.pac.r1, 3)} and ${f(X.pac.r2, 3)}`, `t = ${f(X.pac.t, 2)} on ${f(X.pac.neff - 2, 1)} degrees`,
    `${f(X.lags.find((q) => q.L === 0).r, 3)} at lag 0, ${f(X.lags.find((q) => q.L === 1).r, 3)} with the day one month behind`,
    `r = ${f(X.sens.r, 2)} over ${X.sens.n} months, effective n ≈ ${f(X.sens.neff, 0)}, p ≈ ${f(X.sens.p, 2)}`,
    `${f(X.amp_ratio, 1)}-fold`, `${X.err_1973} ms on the record's first days`, `about ${X.err_recent} ms`,
    `${X.e70.p10}–${X.e70.p90} ms on 80% of days (median ${X.e70.med} ms, maximum ${X.e70.max} ms)`,
    `predicts ${X.ut1pred} s on 21 October 2026; the file says ${X.ut1file} s`,
    `For ${X.longestShare}% of birthdays between 1940 and 2008`, X.longestThree,
    `${f(X.ratio.Mtm, 0)}×`, `${X.mf_peak.slice(0, 6)}`,
    `from ${f(X.rippleWith, 3)} to ${f(X.rippleWithout, 3)} ms rms`,
    `about ${f((1440 * (1 / FREQ.Mf) ** 2) / RUN.length, 0)} minutes at 13.66 days and ${f((1440 * (1 / FREQ.MSm) ** 2) / RUN.length, 0)} minutes at 31.8 days`,
    `within about ${X.phase_hours} hours in both cases`,
    `all ${spans.size} tagged numbers`,
    `${X.zero_consistent} days in all lie within their own stated error of zero (${X.zero_consistent2} within twice it)`,
    `from ${X.mf_ratio}× to ${f(X.after.Mf, 2)}×`, `from ${f(X.ratio.Mm, 0)}× to ${f(X.after.Mm, 2)}×`,
  ];
  const missing = must.filter((s) => !md.includes(s));
  assert.deepEqual(missing, []);
});

test('lod-core.js (what the page draws) agrees with this independent code', () => {
  const require = createRequire(import.meta.url);
  const C = require('./lod-core.js');
  const A = C.analyse(require('./data/lod.js'), require('./data/oni.js'), require('./data/leapsec.js'));
  const close = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: core ${a} vs independent ${b}`);
  for (const k of ALL) close(A.amps[k], X.amp[k], 1e-9, `amplitude ${k}`);
  for (const k of ['Mf', 'Mm', 'MSf', 'MSm', 'Mtm']) close(A.lineTests[k].ratio, X.ratio[k], 1e-6 * X.ratio[k], `ratio ${k}`);
  close(A.controls.synodic.ratio, X.ratio.syn, 1e-9, 'synodic control');
  for (const k of ['Mf', 'Mm', 'MSf', 'MSm', 'Mtm']) close(A.lineTests[k].peakPeriod, X.peaks[k], 0.0015, `peak ${k}`);
  close(A.oos.r2, X.oos_r2_value, 1e-9, 'forecast R2');
  close(A.pacific.test.r, X.pac.r, 1e-12, 'Pacific r');
  close(A.pacific.test.neff, X.pac.neff, 1e-9, 'Neff');
  close(A.pacific.test.p, X.pac.p, 2e-6, 'Pacific p (incomplete beta vs Simpson)');
  close(A.ampVsTilt, X.amp_tilt, 1e-9, 'ripple vs tilt');
  assert.equal(A.yearly.length, X.yearly.length);
  A.yearly.forEach((r, i) => close(r.amp, X.yearly[i].amp, 1e-9, `ripple ${r.year}`));
  close(A.phase.mfVsEquator, X.phase_mf_r, 1e-9, 'Mf phase');
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
