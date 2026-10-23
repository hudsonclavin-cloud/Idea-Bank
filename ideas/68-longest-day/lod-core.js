/* The Longest Day of Your Life: pure computation, no DOM.
 * Loaded by index.html as a classic script (window.LODCore) and by the Node checks via require().
 * Every number the page draws or states comes out of these functions and the embedded data.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LODCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------------------------------
  // Dates. MJD = Modified Julian Date; MJD 0 = 1858-11-17, MJD 51544 = 2000-01-01.
  var MJD_EPOCH_MS = Date.UTC(1858, 10, 17);
  var MJD_2000 = 51544;
  // Before the mid-1980s the file's short-period detail is heavily smoothed, with the zonal tide put back
  // afterwards from a model (see analyse(), step 8), so every test of the Moon uses the days from here on.
  var MEASURED_FROM = '1985-01-01';

  function isoFromMJD(mjd) {
    return new Date(MJD_EPOCH_MS + mjd * 86400000).toISOString().slice(0, 10);
  }
  function mjdFromISO(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
    if (!m) return NaN;
    var y = +m[1], mo = +m[2], d = +m[3];
    var ms = Date.UTC(y, mo - 1, d);
    var back = new Date(ms);
    if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return NaN;
    return Math.round((ms - MJD_EPOCH_MS) / 86400000);
  }
  function ymdFromMJD(mjd) {
    var dt = new Date(MJD_EPOCH_MS + mjd * 86400000);
    return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
  }
  function dayOfYear(mjd) {
    var p = ymdFromMJD(mjd);
    return Math.round((Date.UTC(p.y, p.m - 1, p.d) - Date.UTC(p.y, 0, 1)) / 86400000) + 1;
  }

  // ---------------------------------------------------------------------------------------------
  // Data
  function decodeInts(str) {
    var parts = str.split(',');
    var out = new Float64Array(parts.length);
    for (var i = 0; i < parts.length; i++) out[i] = parseInt(parts[i], 10) / 10000;
    return out;
  }
  /** LOD_DATA -> { mjd0, n, lod (ms excess over 86 400 s), err (ms) } */
  function load(D) {
    var lod = decodeInts(D.lod), err = decodeInts(D.err);
    if (lod.length !== D.n || err.length !== D.n) throw new Error('LOD data length mismatch');
    return { mjd0: D.firstMJD, n: D.n, lod: lod, err: err };
  }

  // ---------------------------------------------------------------------------------------------
  // The Moon's and Sun's mean motions, degrees per Julian century, from the mean-element
  // polynomials in Meeus, Astronomical Algorithms (2nd ed., 1998), ch. 22 and 47.
  var RATE = {
    Lmoon: 481267.88123421, // Moon's mean longitude      -> tropical month 27.321582 d
    Mmoon: 477198.8675055, // Moon's mean anomaly         -> anomalistic month 27.554550 d
    D: 445267.1114034, // mean elongation               -> synodic month 29.530589 d
    F: 483202.0175233, // argument of latitude          -> draconic month 27.212221 d
    Omega: -1934.1362891, // longitude of ascending node -> 18.61-year nodal cycle
    Lsun: 36000.76983 // Sun's mean longitude           -> tropical year 365.24219 d
  };
  var EPOCH = { Lmoon: 218.3164477, Mmoon: 134.9633964, Omega: 125.0445479 }; // at J2000.0 = MJD 51544.5
  function cpd(rateDegPerCentury) {
    return rateDegPerCentury / 360 / 36525; // cycles per day
  }
  var s = cpd(RATE.Lmoon), h = cpd(RATE.Lsun), p = s - cpd(RATE.Mmoon), Nn = -cpd(RATE.Omega);
  var MONTHS = {
    tropical: 1 / s,
    anomalistic: 1 / cpd(RATE.Mmoon),
    synodic: 1 / cpd(RATE.D),
    draconic: 1 / cpd(RATE.F),
    year: 1 / h,
    nodal: 1 / Nn
  };
  // Long-period tidal lines (Doodson combinations) and the seasonal harmonics, in cycles/day.
  var LINES = [
    { id: 'Mf', f: 2 * s, lunar: true, label: 'half a tropical month', what: 'the Moon crossing the equator, twice a month' },
    { id: "Mf'", f: 2 * s + Nn, lunar: true, label: 'nodal sideband of Mf', what: 'the 18.6-year tilt cycle modulating Mf' },
    { id: 'Mm', f: s - p, lunar: true, label: 'anomalistic month', what: 'the Moon swinging nearer and farther' },
    { id: 'MSf', f: 2 * s - 2 * h, lunar: true, label: 'half a synodic month', what: 'the Sun and Moon lining up, new or full' },
    { id: 'MSm', f: s - 2 * h + p, lunar: true, label: 'evection month', what: "the Sun stretching the Moon's orbit" },
    { id: 'Mtm', f: 3 * s - p, lunar: true, label: 'Mf and Mm combined', what: 'a combination of the two' },
    { id: 'Sa', f: h, lunar: false, label: 'one year' },
    { id: 'Ssa', f: 2 * h, lunar: false, label: 'half a year' },
    { id: 'Sta', f: 3 * h, lunar: false, label: 'a third of a year' }
  ];
  function line(id) {
    for (var i = 0; i < LINES.length; i++) if (LINES[i].id === id) return LINES[i];
    throw new Error('no line ' + id);
  }
  function moonArgs(mjd) {
    var T = (mjd - 51544.5) / 36525;
    var md = function (x) { x = x % 360; return x < 0 ? x + 360 : x; };
    return {
      L: md(EPOCH.Lmoon + RATE.Lmoon * T),
      M: md(EPOCH.Mmoon + RATE.Mmoon * T),
      Omega: md(EPOCH.Omega + RATE.Omega * T)
    };
  }
  /** Decimal years at which the Moon's mean node passes the vernal equinox (major lunar standstill). */
  function majorStandstills(fromYear, toYear) {
    var out = [];
    for (var k = -10; k <= 10; k++) {
      var T = (EPOCH.Omega + 360 * k) / -RATE.Omega; // centuries from J2000 where Omega = 0
      var y = 2000 + T * 100;
      if (y >= fromYear && y <= toYear) out.push(y);
    }
    return out;
  }
  function minorStandstills(fromYear, toYear) {
    var out = [];
    for (var k = -10; k <= 10; k++) {
      var T = (EPOCH.Omega - 180 + 360 * k) / -RATE.Omega;
      var y = 2000 + T * 100;
      if (y >= fromYear && y <= toYear) out.push(y);
    }
    return out;
  }

  // ---------------------------------------------------------------------------------------------
  // Filters and fits
  /** Centred running mean of odd width w; NaN where the window is incomplete or holds a NaN. */
  function runningMean(x, w) {
    var n = x.length, half = (w - 1) / 2, out = new Float64Array(n).fill(NaN);
    var c = new Float64Array(n + 1), bad = new Int32Array(n + 1);
    for (var i = 0; i < n; i++) {
      var ok = isFinite(x[i]);
      c[i + 1] = c[i] + (ok ? x[i] : 0);
      bad[i + 1] = bad[i] + (ok ? 0 : 1);
    }
    for (var j = half; j < n - half; j++) {
      if (bad[j + half + 1] - bad[j - half] === 0) out[j] = (c[j + half + 1] - c[j - half]) / w;
    }
    return out;
  }
  /** Day length minus its own centred 365-day mean: removes the slow drift, keeps everything faster than a year. */
  function highPass(lod) {
    var rm = runningMean(lod, 365), out = new Float64Array(lod.length);
    for (var i = 0; i < lod.length; i++) out[i] = lod[i] - rm[i];
    return out;
  }

  function solveSPD(A, b) {
    // Cholesky solve of a small symmetric positive-definite system.
    var n = b.length, L = [], i, j, k;
    for (i = 0; i < n; i++) L.push(new Float64Array(n));
    for (i = 0; i < n; i++) {
      for (j = 0; j <= i; j++) {
        var sum = A[i][j];
        for (k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
        if (i === j) {
          if (!(sum > 0)) throw new Error('matrix not positive definite');
          L[i][i] = Math.sqrt(sum);
        } else L[i][j] = sum / L[j][j];
      }
    }
    var yv = new Float64Array(n), xv = new Float64Array(n);
    for (i = 0; i < n; i++) {
      var s1 = b[i];
      for (k = 0; k < i; k++) s1 -= L[i][k] * yv[k];
      yv[i] = s1 / L[i][i];
    }
    for (i = n - 1; i >= 0; i--) {
      var s2 = yv[i];
      for (k = i + 1; k < n; k++) s2 -= L[k][i] * xv[k];
      xv[i] = s2 / L[i][i];
    }
    return xv;
  }

  /**
   * Least-squares fit of y(t) = c + sum_k [a_k cos(2 pi f_k t) + b_k sin(2 pi f_k t)], t in days
   * from 2000-01-01. Points with non-finite y, or where use(i) is false, are skipped.
   */
  function fitHarmonics(mjd0, y, freqs, use) {
    var m = 1 + 2 * freqs.length, A = [], b = new Float64Array(m), row = new Float64Array(m), i, j, k, count = 0;
    for (i = 0; i < m; i++) A.push(new Float64Array(m));
    for (i = 0; i < y.length; i++) {
      if (!isFinite(y[i]) || (use && !use(i))) continue;
      var t = mjd0 + i - MJD_2000;
      row[0] = 1;
      for (k = 0; k < freqs.length; k++) {
        var w = 2 * Math.PI * freqs[k] * t;
        row[1 + 2 * k] = Math.cos(w);
        row[2 + 2 * k] = Math.sin(w);
      }
      for (j = 0; j < m; j++) {
        b[j] += row[j] * y[i];
        for (k = 0; k <= j; k++) A[j][k] += row[j] * row[k];
      }
      count++;
    }
    for (j = 0; j < m; j++) for (k = j + 1; k < m; k++) A[j][k] = A[k][j];
    var coef = solveSPD(A, b);
    var terms = freqs.map(function (f, q) {
      var a = coef[1 + 2 * q], bb = coef[2 + 2 * q];
      return { f: f, a: a, b: bb, amp: Math.hypot(a, bb) };
    });
    return { c: coef[0], terms: terms, count: count };
  }
  /** Value at MJD of the chosen terms of a harmonic fit (indices into fit.terms; all if omitted). */
  function evalTerms(fit, mjd, which) {
    var t = mjd - MJD_2000, v = 0;
    for (var q = 0; q < fit.terms.length; q++) {
      if (which && which.indexOf(q) < 0) continue;
      var T = fit.terms[q], w = 2 * Math.PI * T.f * t;
      v += T.a * Math.cos(w) + T.b * Math.sin(w);
    }
    return v;
  }

  // ---------------------------------------------------------------------------------------------
  // Spectrum
  function fft(re, im) {
    var n = re.length, i, j, k, len;
    for (i = 1, j = 0; i < n; i++) {
      var bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        var tr = re[i]; re[i] = re[j]; re[j] = tr;
        var ti = im[i]; im[i] = im[j]; im[j] = ti;
      }
    }
    for (len = 2; len <= n; len <<= 1) {
      var ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (i = 0; i < n; i += len) {
        var cr = 1, ci = 0;
        for (k = 0; k < len / 2; k++) {
          var ur = re[i + k], ui = im[i + k];
          var vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
          var vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
          re[i + k] = ur + vr; im[i + k] = ui + vi;
          re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
          var nr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr;
          cr = nr;
        }
      }
    }
  }
  /** Hann-tapered periodogram of the finite run of x, zero-padded to 2^pow2. freq in cycles/day. */
  function spectrum(x, pow2) {
    var a = 0, b = x.length - 1;
    while (a < x.length && !isFinite(x[a])) a++;
    while (b > a && !isFinite(x[b])) b--;
    var n = b - a + 1, mean = 0, i;
    for (i = a; i <= b; i++) mean += x[i];
    mean /= n;
    var N = 1 << (pow2 || 17);
    var re = new Float64Array(N), im = new Float64Array(N);
    for (i = 0; i < n; i++) re[i] = (x[a + i] - mean) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)));
    fft(re, im);
    var half = N / 2 + 1, freq = new Float64Array(half), power = new Float64Array(half);
    for (i = 0; i < half; i++) {
      freq[i] = i / N;
      power[i] = re[i] * re[i] + im[i] * im[i];
    }
    return { freq: freq, power: power, n: n, N: N };
  }
  function median(arr) {
    var v = Array.prototype.slice.call(arr).sort(function (p1, p2) { return p1 - p2; });
    var m = v.length >> 1;
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  }
  var LINE_GUARD = 4e-4; // cycles/day kept clear around every known line when estimating background
  /**
   * Power at the bin nearest f0 divided by the median power of the band |f - f0| < 15% f0 with every
   * known line (and f0 itself) masked. Under a no-line null each ordinate is ~ exponential, so the
   * ratio to the median exceeds r with probability 2^-r.
   */
  function lineRatio(spec, f0, knownFreqs) {
    var df = spec.freq[1], j0 = Math.round(f0 / df), band = [];
    var lo = Math.max(1, Math.ceil(0.85 * f0 / df)), hi = Math.min(spec.freq.length - 1, Math.floor(1.15 * f0 / df));
    for (var j = lo; j <= hi; j++) {
      var f = spec.freq[j];
      if (Math.abs(f - f0) < LINE_GUARD) continue;
      var clear = true;
      for (var q = 0; q < knownFreqs.length; q++) if (Math.abs(f - knownFreqs[q]) < LINE_GUARD) { clear = false; break; }
      if (clear) band.push(spec.power[j]);
    }
    var med = median(band);
    // local maximum within the guard, refined by a parabola through the top three bins
    var best = j0, w = Math.round(LINE_GUARD / df);
    for (var k = j0 - w; k <= j0 + w; k++) if (spec.power[k] > spec.power[best]) best = k;
    var y0 = spec.power[best - 1], y1 = spec.power[best], y2 = spec.power[best + 1];
    var shift = 0.5 * (y0 - y2) / (y0 - 2 * y1 + y2);
    var fPeak = (best + (isFinite(shift) ? shift : 0)) * df;
    var ratio = spec.power[j0] / med;
    return { ratio: ratio, log10p: -ratio * Math.LOG10E * Math.LN2, peakPeriod: 1 / fPeak, background: med, bandSize: band.length };
  }

  // ---------------------------------------------------------------------------------------------
  // Statistics
  function mean(a) { var s0 = 0; for (var i = 0; i < a.length; i++) s0 += a[i]; return s0 / a.length; }
  function pearson(x, y) {
    var mx = mean(x), my = mean(y), sxy = 0, sxx = 0, syy = 0;
    for (var i = 0; i < x.length; i++) {
      var dx = x[i] - mx, dy = y[i] - my;
      sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
    }
    return sxy / Math.sqrt(sxx * syy);
  }
  /** Sample autocorrelation at lags 0..K (biased estimator, mean removed). */
  function acf(x, K) {
    var m = mean(x), den = 0, out = new Float64Array(K + 1), i, k;
    for (i = 0; i < x.length; i++) den += (x[i] - m) * (x[i] - m);
    for (k = 0; k <= K; k++) {
      var num = 0;
      for (i = k; i < x.length; i++) num += (x[i] - m) * (x[i - k] - m);
      out[k] = num / den;
    }
    return out;
  }
  function lag1(x) { return acf(x, 1)[1]; }
  function logGamma(z) {
    var c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    var x = z, y = z, tmp = x + 5.5, ser = 1.000000000190015;
    tmp -= (x + 0.5) * Math.log(tmp);
    for (var j = 0; j < 6; j++) ser += c[j] / ++y;
    return -tmp + Math.log(2.5066282746310005 * ser / x);
  }
  function betacf(a, b, x) {
    var qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    d = 1 / d;
    var hh = d;
    for (var m = 1; m <= 300; m++) {
      var m2 = 2 * m, aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < 1e-300) d = 1e-300;
      c = 1 + aa / c; if (Math.abs(c) < 1e-300) c = 1e-300;
      d = 1 / d; hh *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < 1e-300) d = 1e-300;
      c = 1 + aa / c; if (Math.abs(c) < 1e-300) c = 1e-300;
      d = 1 / d;
      var del = d * c;
      hh *= del;
      if (Math.abs(del - 1) < 1e-14) break;
    }
    return hh;
  }
  function betaInc(a, b, x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    var bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
  }
  /** Two-sided p for Student's t with (possibly fractional) df. */
  function tTwoSided(t, df) {
    return betaInc(df / 2, 0.5, df / (df + t * t));
  }
  /**
   * Pearson r between two autocorrelated series, with an effective sample size from the general lag-by-lag
   * form N / (1 + 2 sum_k rho_x(k) rho_y(k)), summed to lag floor(N/4). The AR(1) shortcut
   * N (1 - r1 r2) / (1 + r1 r2) (usually cited to Bretherton et al. 1999) is the special case rho(k) = r1^k;
   * it is kept as neffAR1/pAR1, a conservative bound here, because twelve-month changes lose their memory
   * within about a year instead of decaying geometrically from lag 1.
   */
  function correlationTest(x, y) {
    var r = pearson(x, y), n = x.length, K = Math.floor(n / 4);
    var ax = acf(x, K), ay = acf(y, K), sum = 0;
    for (var k = 1; k <= K; k++) sum += ax[k] * ay[k];
    var neff = n / (1 + 2 * sum);
    var t = r * Math.sqrt((neff - 2) / (1 - r * r));
    var r1 = ax[1], r2 = ay[1], neffAR1 = n * (1 - r1 * r2) / (1 + r1 * r2);
    var tAR1 = r * Math.sqrt((neffAR1 - 2) / (1 - r * r));
    return {
      r: r, n: n, lags: K, lag1x: r1, lag1y: r2, neff: neff, t: t, p: tTwoSided(t, neff - 2),
      neffAR1: neffAR1, tAR1: tAR1, pAR1: tTwoSided(tAR1, neffAR1 - 2)
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Monthly series and the Pacific
  /** Calendar-month means over complete months: [{y, m, v}] */
  function monthlyMeans(mjd0, x) {
    var out = [], cur = null, sum = 0, cnt = 0, days = 0;
    for (var i = 0; i < x.length; i++) {
      var p0 = ymdFromMJD(mjd0 + i);
      if (!cur || cur.y !== p0.y || cur.m !== p0.m) {
        if (cur && cnt === days) out.push({ y: cur.y, m: cur.m, v: sum / cnt });
        cur = p0; sum = 0; cnt = 0;
        days = new Date(Date.UTC(p0.y, p0.m, 0)).getUTCDate();
      }
      sum += x[i]; cnt++;
    }
    if (cur && cnt === days) out.push({ y: cur.y, m: cur.m, v: sum / cnt });
    return out;
  }
  function monthKey(y, m) { return y * 12 + (m - 1); }
  /**
   * Comparison chosen before computing (not formally pre-registered): the 3-month-mean day length against
   * the ONI (itself a 3-month mean), both as 12-month changes, same centre month, lag 0.
   */
  function pacific(L, ONI) {
    var mon = monthlyMeans(L.mjd0, L.lod), byKey = {}, k;
    mon.forEach(function (r) { byKey[monthKey(r.y, r.m)] = r.v; });
    var lod3 = {};
    mon.forEach(function (r) {
      var kk = monthKey(r.y, r.m);
      if (byKey[kk - 1] !== undefined && byKey[kk + 1] !== undefined) lod3[kk] = (byKey[kk - 1] + byKey[kk] + byKey[kk + 1]) / 3;
    });
    var oni = {};
    ONI.rows.forEach(function (r) { oni[monthKey(r[0], r[1] + 1)] = r[2]; });
    var keys = Object.keys(lod3).map(Number).sort(function (a, b) { return a - b; });
    var rows = [];
    for (var i = 0; i < keys.length; i++) {
      k = keys[i];
      if (lod3[k - 12] === undefined || oni[k] === undefined || oni[k - 12] === undefined) continue;
      rows.push({ key: k, y: Math.floor(k / 12), m: (k % 12) + 1, dLod: lod3[k] - lod3[k - 12], dOni: oni[k] - oni[k - 12], lod3: lod3[k], oni: oni[k] });
    }
    var test = correlationTest(rows.map(function (r) { return r.dLod; }), rows.map(function (r) { return r.dOni; }));
    return { rows: rows, test: test };
  }

  // ---------------------------------------------------------------------------------------------
  // The whole analysis, in one place, so the page and the checks read the same numbers.
  function analyse(D, ONI, LEAP) {
    var L = load(D), n = L.n, i;
    var hp = highPass(L.lod);
    var freqs = LINES.map(function (l) { return l.f; });
    var lunarIdx = [], seasIdx = [];
    LINES.forEach(function (l, q) { (l.lunar ? lunarIdx : seasIdx).push(q); });

    // 1. Full harmonic fit of the high-passed series (used for the seasons, the sound and the date box),
    // and the same fit on the measured era only (used for every statement about the Moon).
    var i85 = mjdFromISO(MEASURED_FROM) - L.mjd0, measuredYear = ymdFromMJD(L.mjd0 + i85).y;
    var fit = fitHarmonics(L.mjd0, hp, freqs);
    var fitM = fitHarmonics(L.mjd0, hp, freqs, function (q) { return q >= i85; });
    var amps = {}, ampsM = {};
    LINES.forEach(function (l, q) { amps[l.id] = fit.terms[q].amp; ampsM[l.id] = fitM.terms[q].amp; });
    var resid = new Float64Array(n), noSeason = new Float64Array(n), lunarModel = new Float64Array(n);
    var ssRes = 0, ssTot = 0, cntFit = 0, mhp = 0;
    for (i = 0; i < n; i++) if (isFinite(hp[i])) { mhp += hp[i]; cntFit++; }
    mhp /= cntFit;
    for (i = 0; i < n; i++) {
      var mj = L.mjd0 + i;
      lunarModel[i] = evalTerms(fit, mj, lunarIdx);
      noSeason[i] = hp[i] - fit.c - evalTerms(fit, mj, seasIdx);
      resid[i] = noSeason[i] - lunarModel[i];
      if (isFinite(hp[i])) { ssRes += resid[i] * resid[i]; ssTot += (hp[i] - mhp) * (hp[i] - mhp); }
    }

    // 2. Seasonal curve (Sa + Ssa + Sta) through a calendar year; extremes.
    var seasCurve = [];
    for (var dd = 0; dd < 365; dd++) seasCurve.push(evalTerms(fit, mjdFromISO('2001-01-01') + dd, seasIdx));
    var seasMax = 0, seasMin = 0;
    for (dd = 1; dd < 365; dd++) {
      if (seasCurve[dd] > seasCurve[seasMax]) seasMax = dd;
      if (seasCurve[dd] < seasCurve[seasMin]) seasMin = dd;
    }
    var monthHp = [];
    for (var mm = 1; mm <= 12; mm++) monthHp.push({ m: mm, sum: 0, n: 0 });
    for (i = 0; i < n; i++) if (isFinite(hp[i])) { var mo = ymdFromMJD(L.mjd0 + i).m; monthHp[mo - 1].sum += hp[i]; monthHp[mo - 1].n++; }
    monthHp = monthHp.map(function (r) { return { m: r.m, v: r.sum / r.n, n: r.n }; });

    // 3. Out-of-sample: fit on the measured days before 2016-01-01 (1985-2015), predict the Moon's part from 2016 on.
    var cut = mjdFromISO('2016-01-01');
    var fitTrain = fitHarmonics(L.mjd0, hp, freqs, function (q) { return q >= i85 && L.mjd0 + q < cut; });
    var oos = { fromISO: MEASURED_FROM, cutISO: '2016-01-01', target: [], pred: [], mjd: [] };
    for (i = 0; i < n; i++) {
      var m2 = L.mjd0 + i;
      if (m2 < cut || !isFinite(hp[i])) continue;
      oos.mjd.push(m2);
      oos.target.push(hp[i] - fitTrain.c - evalTerms(fitTrain, m2, seasIdx));
      oos.pred.push(evalTerms(fitTrain, m2, lunarIdx));
    }
    var ssr = 0, sst = 0, mt = mean(oos.target);
    for (i = 0; i < oos.target.length; i++) {
      ssr += (oos.target[i] - oos.pred[i]) * (oos.target[i] - oos.pred[i]);
      sst += (oos.target[i] - mt) * (oos.target[i] - mt);
    }
    oos.r2 = 1 - ssr / sst;
    oos.r = pearson(oos.target, oos.pred);
    oos.lastISO = isoFromMJD(oos.mjd[oos.mjd.length - 1]);

    // 4. Spectrum and line tests: on the measured era (1985 on), and over the whole record for comparison.
    var hpM = new Float64Array(n);
    for (i = 0; i < n; i++) hpM[i] = i >= i85 ? hp[i] : NaN;
    var known = freqs.slice();
    function lineSet(sp) {
      var t0 = {};
      LINES.forEach(function (l) { t0[l.id] = lineRatio(sp, l.f, known); });
      return t0;
    }
    function controlSet(sp) {
      return {
        synodic: lineRatio(sp, 1 / MONTHS.synodic, known),
        tropical: lineRatio(sp, 1 / MONTHS.tropical, known),
        draconic: lineRatio(sp, 1 / MONTHS.draconic, known)
      };
    }
    var spec = spectrum(hpM, 17), specAll = spectrum(hp, 17);
    var lineTests = lineSet(spec), controls = controlSet(spec);
    var lineTestsAll = lineSet(specAll), controlsAll = controlSet(specAll);

    // 5. The fortnightly ripple, year by year, against the Moon's 18.6-year tilt cycle.
    var yearly = [];
    var fy = ymdFromMJD(L.mjd0).y, ly = ymdFromMJD(L.mjd0 + n - 1).y;
    var mfIdx = 0; // Mf is the first term in the per-year fit below
    var perYearFreqs = [line('Mf').f, line('Mm').f, line('MSf').f, line('MSm').f, line('Mtm').f];
    for (var yr = fy; yr <= ly; yr++) {
      var a0 = mjdFromISO(yr + '-01-01') - L.mjd0, a1 = mjdFromISO((yr + 1) + '-01-01') - L.mjd0;
      if (a0 < 0 || a1 > n) continue;
      var complete = true;
      for (i = a0; i < a1; i++) if (!isFinite(noSeason[i])) { complete = false; break; }
      if (!complete) continue;
      var fy1 = fitHarmonics(L.mjd0, noSeason, perYearFreqs, (function (lo, hi) { return function (q) { return q >= lo && q < hi; }; })(a0, a1));
      var mid = mjdFromISO(yr + '-07-02');
      yearly.push({ year: yr, amp: fy1.terms[mfIdx].amp, cosOmega: Math.cos(moonArgs(mid).Omega * Math.PI / 180), measured: yr >= measuredYear });
    }
    var yearlyM = yearly.filter(function (r) { return r.measured; });
    var ampMax = yearlyM.reduce(function (b, r) { return r.amp > b.amp ? r : b; }, yearlyM[0]);
    var ampMin = yearlyM.reduce(function (b, r) { return r.amp < b.amp ? r : b; }, yearlyM[0]);
    function ampTilt(rows) { return pearson(rows.map(function (r) { return r.amp; }), rows.map(function (r) { return r.cosOmega; })); }

    // 6. Phase: when do the Mf and Mm terms peak, in terms of the Moon's position?
    // Correlate each fitted term with cos(2L) (Moon at the equinoxes, i.e. over the equator) and
    // with cos(M) (Moon at perigee) over 10 000 days sampled every 0.25 d.
    var cf = [], c2L = [], cm = [], cM = [];
    var qMf = LINES.indexOf(line('Mf')), qMm = LINES.indexOf(line('Mm'));
    for (var tq = 0; tq < 40000; tq++) {
      var mjq = 51544.5 + tq * 0.25, args = moonArgs(mjq);
      cf.push(evalTerms(fitM, mjq, [qMf])); c2L.push(Math.cos(2 * args.L * Math.PI / 180));
      cm.push(evalTerms(fitM, mjq, [qMm])); cM.push(Math.cos(args.M * Math.PI / 180));
    }

    // 7. Record, drift and leap seconds.
    var maxI = 0, minI = 0, zeros = [], firstNeg = -1, sumAll = 0;
    for (i = 0; i < n; i++) {
      if (L.lod[i] > L.lod[maxI]) maxI = i;
      if (L.lod[i] < L.lod[minI]) minI = i;
      if (L.lod[i] === 0) zeros.push(i);
      if (firstNeg < 0 && L.lod[i] < 0) firstNeg = i;
      sumAll += L.lod[i];
    }
    var lastMJD = L.mjd0 + n - 1;
    var leapsIn = LEAP.steps.filter(function (st) { return st[0] > L.mjd0 && st[0] <= lastMJD; });
    var lastLeap = LEAP.steps[LEAP.steps.length - 1];
    var byYear = {};
    for (i = 0; i < n; i++) {
      var yy = ymdFromMJD(L.mjd0 + i).y;
      (byYear[yy] = byYear[yy] || { sum: 0, n: 0, neg: 0 });
      byYear[yy].sum += L.lod[i]; byYear[yy].n++; if (L.lod[i] < 0) byYear[yy].neg++;
    }
    var firstNegYear = null;
    Object.keys(byYear).map(Number).sort(function (a, b) { return a - b; }).forEach(function (y0) {
      var r = byYear[y0];
      if (firstNegYear === null && r.n >= 365 && r.sum < 0) firstNegYear = y0;
    });
    var sinceLastLeap = 0;
    for (i = 0; i < n; i++) if (L.mjd0 + i >= lastLeap[0]) sinceLastLeap += L.lod[i];

    // 8. The early record. The wiggle the fitted Moon and seasons leave behind, band-passed to roughly a week
    // to a month (7-day minus 35-day running mean), compared between 1974-1982 and 1985-2025, beside the
    // fortnightly line fitted to each era. Heavy smoothing with the tide restored afterwards shows up as a
    // much quieter background under a full-strength line.
    var bp7 = runningMean(resid, 7), bp35 = runningMean(resid, 35);
    function era(y0, y1) {
      var ss = 0, cnt = 0, errs = [];
      for (i = 0; i < n; i++) {
        var yy0 = ymdFromMJD(L.mjd0 + i).y;
        if (yy0 < y0 || yy0 > y1) continue;
        errs.push(L.err[i]);
        var v = bp7[i] - bp35[i];
        if (isFinite(v)) { ss += v * v; cnt++; }
      }
      var fe = fitHarmonics(L.mjd0, hp, freqs, function (q) { var yq = ymdFromMJD(L.mjd0 + q).y; return yq >= y0 && yq <= y1; });
      return { from: y0, to: y1, bandRms: Math.sqrt(ss / cnt), mfAmp: fe.terms[0].amp, medianErr: median(errs) };
    }
    var eras = { early: era(1974, 1982), measured: era(measuredYear, ly - 1) };

    var pac = pacific(L, ONI);
    var lastPac = pac.rows[pac.rows.length - 1];
    var maxDLod = pac.rows.reduce(function (b, r) { return r.dLod > b.dLod ? r : b; }, pac.rows[0]);

    return {
      L: L, hp: hp, fit: fit, amps: amps, noSeason: noSeason, lunarModel: lunarModel, resid: resid,
      fitR2: 1 - ssRes / ssTot, fitM: fitM, ampsM: ampsM, measuredFrom: MEASURED_FROM, measuredYear: measuredYear, eras: eras,
      seasonal: { curve: seasCurve, maxDay: seasMax, minDay: seasMin, maxISO: isoFromMJD(mjdFromISO('2001-01-01') + seasMax), minISO: isoFromMJD(mjdFromISO('2001-01-01') + seasMin), max: seasCurve[seasMax], min: seasCurve[seasMin], range: seasCurve[seasMax] - seasCurve[seasMin], months: monthHp },
      oos: oos, spec: spec, lineTests: lineTests, controls: controls,
      specAll: specAll, lineTestsAll: lineTestsAll, controlsAll: controlsAll,
      yearly: yearly, ampMax: ampMax, ampMin: ampMin, ampVsTilt: ampTilt(yearlyM), ampVsTiltAll: ampTilt(yearly),
      phase: { mfVsEquator: pearson(cf, c2L), mmVsPerigee: pearson(cm, cM) },
      record: {
        n: n, firstISO: isoFromMJD(L.mjd0), lastISO: isoFromMJD(lastMJD),
        maxISO: isoFromMJD(L.mjd0 + maxI), max: L.lod[maxI], maxErr: L.err[maxI],
        minISO: isoFromMJD(L.mjd0 + minI), min: L.lod[minI], minErr: L.err[minI],
        zeroISO: zeros.map(function (q) { return isoFromMJD(L.mjd0 + q); }), zeroErr: zeros.map(function (q) { return L.err[q]; }),
        firstNegISO: isoFromMJD(L.mjd0 + firstNeg),
        negDays: Array.prototype.filter.call(L.lod, function (v) { return v < 0; }).length,
        mean: sumAll / n, driftSeconds: sumAll / 1000,
        leapsIn: leapsIn.length, leapsTotal1972: LEAP.steps[LEAP.steps.length - 1][1] - LEAP.steps[0][1],
        lastLeapISO: isoFromMJD(lastLeap[0] - 1), sinceLastLeapSeconds: sinceLastLeap / 1000,
        lastLod: L.lod[n - 1], lastErr: L.err[n - 1],
        byYear: byYear, firstNegYear: firstNegYear
      },
      pacific: pac, pacificLast: lastPac, pacificMax: maxDLod,
      months: MONTHS
    };
  }

  /** Everything the "your day" panel shows, for a day given as MJD. */
  function personal(L, LEAP, mjd) {
    var last = L.mjd0 + L.n - 1;
    if (!isFinite(mjd)) return { status: 'invalid' };
    if (mjd > last) return { status: 'future', lastISO: isoFromMJD(last) };
    var clamped = mjd < L.mjd0;
    var i0 = clamped ? 0 : mjd - L.mjd0;
    var lod = L.lod[i0], longer = 0, maxI = i0, minI = i0, sum = 0;
    for (var i = 0; i < L.n; i++) if (L.lod[i] < lod) longer++;
    for (i = i0; i < L.n; i++) {
      if (L.lod[i] > L.lod[maxI]) maxI = i;
      if (L.lod[i] < L.lod[minI]) minI = i;
      sum += L.lod[i];
    }
    var leaps = LEAP.steps.filter(function (st) { return st[0] > mjd && st[0] <= last; }).length;
    return {
      status: clamped ? 'before' : 'ok',
      iso: isoFromMJD(L.mjd0 + i0), lod: lod, err: L.err[i0],
      percentLonger: 100 * longer / L.n,
      longestISO: isoFromMJD(L.mjd0 + maxI), longest: L.lod[maxI], longestErr: L.err[maxI],
      shortestISO: isoFromMJD(L.mjd0 + minI), shortest: L.lod[minI], shortestErr: L.err[minI],
      days: L.n - i0, driftSeconds: sum / 1000, leaps: leaps, lastISO: isoFromMJD(last)
    };
  }

  return {
    isoFromMJD: isoFromMJD, mjdFromISO: mjdFromISO, ymdFromMJD: ymdFromMJD, dayOfYear: dayOfYear,
    load: load, LINES: LINES, MONTHS: MONTHS, RATE: RATE, MEASURED_FROM: MEASURED_FROM, line: line, moonArgs: moonArgs,
    majorStandstills: majorStandstills, minorStandstills: minorStandstills,
    runningMean: runningMean, highPass: highPass, fitHarmonics: fitHarmonics, evalTerms: evalTerms,
    spectrum: spectrum, lineRatio: lineRatio, pearson: pearson, acf: acf, lag1: lag1, tTwoSided: tTwoSided,
    correlationTest: correlationTest, monthlyMeans: monthlyMeans, pacific: pacific,
    analyse: analyse, personal: personal
  };
});
