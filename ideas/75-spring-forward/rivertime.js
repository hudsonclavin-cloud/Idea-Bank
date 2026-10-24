/* rivertime.js — the arithmetic behind "Does the River Spring Forward?"
 *
 * Pure functions only: no DOM, no clock, and no randomness except one seeded generator (for the
 * clock-keeper simulation and a bootstrap), so every run gives the same numbers. Loaded as a
 * classic script in the page (window.RiverTime) and with require() in Node (tests and
 * data/fetch.mjs).
 *
 * Two methods, both written down in PREREGISTRATION.md before they were run on the Colorado:
 *   1. (part 1, registered before any data) hourly means in the site's standard time ->
 *      subtract a centred 2x24-hour moving average -> one 24-hour Fourier component per day
 *      (amplitude A, crest time tau) -> for each clock change, a robust weighted regression of
 *      tau on a drift, a step on the night of the change and day-of-week effects.
 *   2. (part 2, registered after method 1 failed on the controls, before it was run on Lees
 *      Ferry) the same residuals, each day scaled to unit RMS, the hour-by-hour median day over
 *      the 14 days before and the 14 after, and the shift within +/-3 h that lines them up.
 * Either way K = (fall step - spring step)/2 per year: 60 = keeps clock time, 0 = keeps
 * standard time. Functions marked "exploratory" were written after the results were seen.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RiverTime = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAY_MS = 86400000;
  const HOUR_MS = 3600000;
  const OMEGA = (2 * Math.PI) / 24; // radians per hour

  // ---------------------------------------------------------------- calendar

  /** Day number (days since 1970-01-01) of a calendar date. month is 1-12. */
  function dayNumber(y, m, d) {
    return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
  }
  /** Calendar date of a day number, as [y, m, d]. */
  function dateOf(dn) {
    const t = new Date(dn * DAY_MS);
    return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
  }
  function isoDate(dn) {
    const [y, m, d] = dateOf(dn);
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  /** Day of week, 0 = Sunday ... 6 = Saturday. 1970-01-01 was a Thursday. */
  function dow(dn) {
    return (((dn + 4) % 7) + 7) % 7;
  }
  /** The n-th Sunday (1-based) of a month, or the last one if n = -1. */
  function nthSunday(y, m, n) {
    if (n > 0) {
      const first = dayNumber(y, m, 1);
      return first + ((7 - dow(first)) % 7) + 7 * (n - 1);
    }
    const last = dayNumber(y, m + 1, 1) - 1; // Date.UTC rolls month 13 into January
    return last - dow(last);
  }
  /**
   * US clock-change Sundays for a year under a rule.
   * 'new' (Energy Policy Act of 2005, from 2007): second Sunday of March, first Sunday of November.
   * 'old' (1987-2006): first Sunday of April, last Sunday of October.
   */
  function transitions(y, rule) {
    if (rule === 'old') return { spring: nthSunday(y, 4, 1), fall: nthSunday(y, 10, -1) };
    if (rule === 'new') return { spring: nthSunday(y, 3, 2), fall: nthSunday(y, 11, 1) };
    throw new Error(`unknown rule ${rule}`);
  }
  /** The rule actually in force in year y (for the years this page uses). */
  function ruleInForce(y) {
    return y >= 2007 ? 'new' : 'old';
  }

  // ---------------------------------------------------------------- series

  /**
   * Hourly means in a fixed standard time.
   * points: array of [utcMillis, value]; offsetHours: e.g. -7 for MST.
   * Returns { start, values } where start is the standard-time hour index (hours since
   * 1970-01-01 00:00 standard time) of values[0]. Hours with no reading are NaN, then gaps
   * of up to maxGap hours are filled by straight-line interpolation.
   */
  function hourlyMeans(points, offsetHours, maxGap = 3) {
    if (!points.length) return { start: 0, values: [] };
    const sums = new Map();
    let lo = Infinity;
    let hi = -Infinity;
    for (const [t, v] of points) {
      if (!Number.isFinite(v)) continue;
      const h = Math.floor((t + offsetHours * HOUR_MS) / HOUR_MS);
      const s = sums.get(h);
      if (s) {
        s[0] += v;
        s[1] += 1;
      } else sums.set(h, [v, 1]);
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
    if (lo === Infinity) return { start: 0, values: [] };
    const values = new Array(hi - lo + 1).fill(NaN);
    for (const [h, [s, n]] of sums) values[h - lo] = s / n;
    fillGaps(values, maxGap);
    return { start: lo, values };
  }

  /** Fill runs of NaN no longer than maxGap that have a finite value on both sides. In place. */
  function fillGaps(values, maxGap) {
    let i = 0;
    while (i < values.length) {
      if (!Number.isNaN(values[i])) {
        i++;
        continue;
      }
      let j = i;
      while (j < values.length && Number.isNaN(values[j])) j++;
      const len = j - i;
      if (i > 0 && j < values.length && len <= maxGap) {
        const a = values[i - 1];
        const b = values[j];
        for (let k = i; k < j; k++) values[k] = a + ((b - a) * (k - i + 1)) / (len + 1);
      }
      i = j;
    }
    return values;
  }

  /**
   * Centred 2x24-hour moving average: weights 1/48, 1/24 x 23, 1/48 over 25 hours.
   * Its gain is exactly zero at periods of 24, 12, 8, ... hours, so subtracting it leaves a
   * daily cycle untouched while removing anything slow. NaN where any of the 25 is missing.
   */
  function movingAverage24(values) {
    const n = values.length;
    const out = new Array(n).fill(NaN);
    for (let h = 12; h < n - 12; h++) {
      let s = (values[h - 12] + values[h + 12]) / 2;
      for (let k = -11; k <= 11; k++) s += values[h + k];
      out[h] = s / 24; // NaN propagates
    }
    return out;
  }

  /** Residual after the moving average. */
  function detrend(values) {
    const ma = movingAverage24(values);
    return values.map((v, i) => v - ma[i]);
  }

  /**
   * The 24-hour Fourier component of one day's 24 hourly residuals, with hour h placed at
   * h + 0.5 as registered. (For readings every quarter hour the mean over [h, h+1) is really
   * centred at h + 0.375, so tau as a time of day is 7.5 minutes late; that is the same for every
   * day and cancels in every step. The page's clock times use HOUR_CENTRE instead.)
   * Returns { A, tau, re, im }:
   * A is the amplitude of the daily wave (same units as the data) and tau its crest time in
   * hours after midnight, in [0, 24). For r_h = A cos(omega (h + 0.5 - tau)) both are exact.
   */
  function dailyComponent(r24) {
    let re = 0;
    let im = 0;
    for (let h = 0; h < 24; h++) {
      const ang = OMEGA * (h + 0.5);
      re += r24[h] * Math.cos(ang);
      im -= r24[h] * Math.sin(ang);
    }
    const A = Math.hypot(re, im) / 12;
    let tau = (-Math.atan2(im, re) / OMEGA) % 24;
    if (tau < 0) tau += 24;
    return { A, tau, re, im };
  }

  /**
   * Per-day statistics from an hourly series ({start, values} in standard-time hours).
   * Returns a Map dayNumber -> { A, tau, mean, resid (24 residuals) } for every whole day whose
   * 24 residuals are all defined.
   */
  function dailyStats(series) {
    const { start, values } = series;
    const resid = detrend(values);
    const out = new Map();
    const firstDay = Math.ceil(start / 24);
    const lastDay = Math.floor((start + values.length) / 24) - 1;
    for (let d = firstDay; d <= lastDay; d++) {
      const i0 = d * 24 - start;
      const r = resid.slice(i0, i0 + 24);
      const x = values.slice(i0, i0 + 24);
      if (r.length < 24 || r.some((v) => !Number.isFinite(v))) continue;
      const c = dailyComponent(r);
      const mean = x.reduce((a, b) => a + b, 0) / 24;
      out.set(d, { A: c.A, tau: c.tau, mean, resid: r });
    }
    return out;
  }

  // ---------------------------------------------------------------- regression

  /** Solve a small symmetric positive (semi)definite system by Gaussian elimination with pivoting. */
  function solve(M, v) {
    const n = v.length;
    const a = M.map((row, i) => [...row, v[i]]);
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
      if (Math.abs(a[p][c]) < 1e-12) return null;
      [a[c], a[p]] = [a[p], a[c]];
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = a[r][c] / a[c][c];
        if (f === 0) continue;
        for (let k = c; k <= n; k++) a[r][k] -= f * a[c][k];
      }
    }
    return a.map((row, i) => row[n] / row[i]);
  }

  /** Inverse of a small matrix (for standard errors). */
  function invert(M) {
    const n = M.length;
    const cols = [];
    for (let j = 0; j < n; j++) {
      const e = new Array(n).fill(0);
      e[j] = 1;
      const x = solve(M, e);
      if (!x) return null;
      cols.push(x);
    }
    return M.map((_, i) => cols.map((c) => c[i]));
  }

  /** Weighted least squares: returns coefficient vector or null. */
  function wls(X, y, w) {
    const p = X[0].length;
    const XtWX = Array.from({ length: p }, () => new Array(p).fill(0));
    const XtWy = new Array(p).fill(0);
    for (let i = 0; i < y.length; i++) {
      if (!(w[i] > 0)) continue;
      const xi = X[i];
      for (let a = 0; a < p; a++) {
        XtWy[a] += w[i] * xi[a] * y[i];
        for (let b = 0; b < p; b++) XtWX[a][b] += w[i] * xi[a] * xi[b];
      }
    }
    const beta = solve(XtWX, XtWy);
    return beta ? { beta, XtWX } : null;
  }

  function median(xs) {
    const s = Float64Array.from(xs).sort(); // numeric order
    const n = s.length;
    if (!n) return NaN;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }

  const BIWEIGHT_C = 4.685;

  /**
   * Estimate the step on the night of a clock change.
   * days: array of { dn, A, tau } (any order; days outside T-14..T+14 and day T are ignored).
   * Returns null if fewer than minSide usable days on either side, else
   * { step (minutes), drift (minutes/day), se (minutes), nBefore, nAfter, center (hours), fitted }.
   */
  function estimateStep(days, T, opts = {}) {
    const half = opts.half ?? 14;
    const minSide = opts.minSide ?? 10;
    const robust = opts.robust ?? true;
    const weekday = opts.weekday ?? true;
    const gap = opts.gap ?? 0; // days either side of T left out besides T itself
    const use = days.filter(
      (d) => Math.abs(d.dn - T) > gap && Math.abs(d.dn - T) <= half && Number.isFinite(d.tau) && d.A > 0,
    );
    const nBefore = use.filter((d) => d.dn < T).length;
    const nAfter = use.filter((d) => d.dn > T).length;
    if (nBefore < minSide || nAfter < minSide) return null;

    // Weights: the square of min(A / median A, median A / A). A day with a weak daily wave has
    // a noisy crest time and counts for less; a day with an unusually strong "wave" is usually a
    // one-off (a storm, a ramp up to a high release) and counts for less too.
    const Amed = median(use.map((d) => d.A));
    const w0 = use.map((d) => Math.min(d.A / Amed, Amed / d.A) ** 2);

    // Unwrap tau around the weighted circular mean.
    let cx = 0;
    let cy = 0;
    use.forEach((d, i) => {
      cx += w0[i] * Math.cos(OMEGA * d.tau);
      cy += w0[i] * Math.sin(OMEGA * d.tau);
    });
    const mu = Math.atan2(cy, cx) / OMEGA;
    const y = use.map((d) => {
      let v = d.tau - mu;
      v -= 24 * Math.round(v / 24);
      if (v <= -12) v += 24;
      return mu + v;
    });

    // Design: 1, (d - T), [d > T], weekday dummies (reference = first weekday present).
    const present = [...new Set(use.map((d) => dow(d.dn)))].sort((a, b) => a - b);
    const dummies = weekday ? present.slice(1) : [];
    const X = use.map((d) => [1, d.dn - T, d.dn > T ? 1 : 0, ...dummies.map((k) => (dow(d.dn) === k ? 1 : 0))]);
    let w = w0.slice();
    let fit = wls(X, y, w);
    if (!fit) return null;
    const resid = (beta) => y.map((yi, i) => yi - X[i].reduce((s, x, j) => s + x * beta[j], 0));
    if (robust) {
      // Start from a least-absolute-deviations fit (IRLS), which a few wild days cannot drag
      // far, then refine with Tukey's biweight.
      for (let it = 0; it < 200; it++) {
        const r = resid(fit.beta);
        const wl = w0.map((wi, i) => wi / Math.max(1e-6, Math.abs(r[i]) * Math.sqrt(wi)));
        const next = wls(X, y, wl);
        if (!next) break;
        const change = Math.max(...next.beta.map((b, j) => Math.abs(b - fit.beta[j])));
        fit = next;
        if (change < 1e-9) break;
      }
      for (let it = 0; it < 100; it++) {
        const res = y.map((yi, i) => yi - X[i].reduce((s, x, j) => s + x * fit.beta[j], 0));
        const z = res.map((r, i) => r * Math.sqrt(w0[i]));
        const scale = 1.4826 * median(z.map(Math.abs));
        if (!(scale > 1e-9)) break;
        const wNew = w0.map((wi, i) => {
          const u = z[i] / (BIWEIGHT_C * scale);
          return Math.abs(u) < 1 ? wi * (1 - u * u) ** 2 : 0;
        });
        const next = wls(X, y, wNew);
        if (!next) break;
        const change = Math.abs(next.beta[2] - fit.beta[2]);
        w = wNew;
        fit = next;
        if (change < 1e-10) break;
      }
    }
    // Standard error of the step from the final weighted fit (indicative only).
    const p = X[0].length;
    const res = y.map((yi, i) => yi - X[i].reduce((s, x, j) => s + x * fit.beta[j], 0));
    const nEff = w.filter((x) => x > 0).length;
    const s2 = res.reduce((s, r, i) => s + w[i] * r * r, 0) / Math.max(1, nEff - p);
    const inv = invert(fit.XtWX);
    const se = inv ? Math.sqrt(Math.max(0, s2 * inv[2][2])) * 60 : NaN;
    return {
      step: fit.beta[2] * 60,
      drift: fit.beta[1] * 60,
      se,
      nBefore,
      nAfter,
      center: mu,
      level: fit.beta[0],
    };
  }

  // ---------------------------------------------------------------- statistics

  /** log Gamma (Lanczos). */
  function lgamma(x) {
    const g = 7;
    const c = [
      0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
      -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
      1.5056327351493116e-7,
    ];
    if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
    x -= 1;
    let a = c[0];
    const t = x + g + 0.5;
    for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
  }

  /** Continued fraction for the incomplete beta function (Numerical Recipes betacf). */
  function betacf(a, b, x) {
    const MAXIT = 300;
    const EPS = 3e-16;
    const FPMIN = 1e-300;
    const qab = a + b;
    const qap = a + 1;
    const qam = a - 1;
    let c = 1;
    let d = 1 - (qab * x) / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d;
    let h = d;
    for (let m = 1; m <= MAXIT; m++) {
      const m2 = 2 * m;
      let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c;
      if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      h *= d * c;
      aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c;
      if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  }

  /** Regularized incomplete beta I_x(a, b). */
  function ibeta(x, a, b) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a;
    return 1 - (bt * betacf(b, a, 1 - x)) / b;
  }

  /** Student t CDF. */
  function tCdf(t, df) {
    const x = df / (df + t * t);
    const tail = 0.5 * ibeta(x, df / 2, 0.5);
    return t >= 0 ? 1 - tail : tail;
  }

  /** Student t quantile by bisection. */
  function tQuantile(p, df) {
    let lo = -1000;
    let hi = 1000;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (tCdf(mid, df) < p) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /** Mean, sd, n and the 95% t-interval of the mean. */
  function summarize(xs) {
    const v = xs.filter(Number.isFinite);
    const n = v.length;
    if (n === 0) return { n: 0, mean: NaN, sd: NaN, lo: NaN, hi: NaN, median: NaN };
    const mean = v.reduce((a, b) => a + b, 0) / n;
    if (n < 2) return { n, mean, sd: NaN, lo: NaN, hi: NaN, median: mean };
    const sd = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1));
    const half = tQuantile(0.975, n - 1) * (sd / Math.sqrt(n));
    return { n, mean, sd, lo: mean - half, hi: mean + half, median: median(v) };
  }

  /**
   * The decision rule on K's 95% interval (minutes), as amended before any data were seen
   * (PREREGISTRATION.md, amendment 1): within 10 minutes of the hour counts as the hour, and
   * within 10 minutes of zero as zero, because the method itself is good only to a few minutes.
   */
  const MARGIN = 10;
  function verdict(s) {
    if (!(s.n >= 2) || !Number.isFinite(s.lo)) return 'cannot tell';
    if (s.lo > 60 + MARGIN) return 'moves more than the hour';
    if (s.hi < -MARGIN) return 'moves the wrong way';
    const nearHour = s.lo <= 60 + MARGIN && s.hi >= 60 - MARGIN;
    const nearZero = s.lo <= MARGIN && s.hi >= -MARGIN;
    if (nearHour && !nearZero) return 'keeps clock time';
    if (nearZero && !nearHour) return 'keeps standard time';
    if (!nearZero && !nearHour) return 'keeps part of the hour';
    return 'cannot tell';
  }

  // ---------------------------------------------------------------- data encoding
  //
  // data/rivers.js stores, per site, a run of days for each window as a string of 6-character
  // records, one per day: tau (2 chars) and A (2 chars). '~~~~' = no data.
  // Characters come from a 64-symbol alphabet, so 2 characters hold 0..4095.
  //   tau: round(tau * 4096 / 24) mod 4096     (resolution 21 s)
  //   A, mean: log-coded, code = round((log10(x) - LOG_MIN) * 4096 / LOG_SPAN), x > 0
  // Hourly residual profiles (for the pictures) are 24 characters per day:
  //   round(31 * r / max|r|) + 31, i.e. 63 levels, the day's own scale.

  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const LOG_MIN = -4;
  const LOG_SPAN = 10; // codes cover 1e-4 .. 1e6
  const CODE = new Map([...ALPHABET].map((c, i) => [c, i]));

  function enc2(n) {
    return ALPHABET[(n >> 6) & 63] + ALPHABET[n & 63];
  }
  function dec2(s, i) {
    return CODE.get(s[i]) * 64 + CODE.get(s[i + 1]);
  }
  function encLog(x) {
    const c = Math.round(((Math.log10(x) - LOG_MIN) * 4096) / LOG_SPAN);
    return Math.max(1, Math.min(4095, c));
  }
  function decLog(c) {
    return 10 ** (LOG_MIN + (c * LOG_SPAN) / 4096);
  }
  const DAY_CHARS = 4;
  function encodeDay(rec) {
    if (!rec || !(rec.A > 0) || !Number.isFinite(rec.tau)) return '~~~~';
    return enc2(Math.round((rec.tau * 4096) / 24) % 4096) + enc2(encLog(rec.A));
  }
  function decodeDay(s, i) {
    if (s[i] === '~') return null;
    return { tau: (dec2(s, i) * 24) / 4096, A: decLog(dec2(s, i + 2)) };
  }
  function encodeProfile(r) {
    if (!r) return '~'.repeat(24);
    const m = Math.max(...r.map(Math.abs));
    if (!(m > 0)) return 'f'.repeat(24); // 31 = flat
    return r.map((v) => ALPHABET[Math.round((31 * v) / m) + 31]).join('');
  }
  function decodeProfile(s, i) {
    if (s[i] === '~') return null;
    const out = new Array(24);
    for (let h = 0; h < 24; h++) out[h] = (CODE.get(s[i + h]) - 31) / 31;
    return out;
  }

  /** Decode one window string starting at day `first` into [{dn, A, tau}]. */
  function decodeWindow(str, first) {
    const out = [];
    for (let k = 0; k * DAY_CHARS < str.length; k++) {
      const rec = decodeDay(str, k * DAY_CHARS);
      if (rec) out.push({ dn: first + k, ...rec });
    }
    return out;
  }

  // ---------------------------------------------------------------- the analysis

  /** Fake clock changes: a whole number of days before and after each real one. */
  const PLACEBO_OFFSETS = [-35, 35];

  const siteCache = new WeakMap();
  /** All decoded days of a site, as a Map dayNumber -> { dn, A, tau, mean }. */
  function siteDays(site) {
    let m = siteCache.get(site);
    if (!m) {
      m = new Map();
      for (const run of site.runs) for (const rec of decodeWindow(run.days, run.first)) m.set(rec.dn, rec);
      siteCache.set(site, m);
    }
    return m;
  }
  /** The decoded days within `half` days of a centre. */
  function daysAround(site, center, half = 14) {
    const m = siteDays(site);
    const out = [];
    for (let d = center - half; d <= center + half; d++) if (m.has(d)) out.push(m.get(d));
    return out;
  }
  /** One estimate of the step at a (real or fake) clock change, or null. */
  function stepAt(site, center, opts = {}) {
    return estimateStep(daysAround(site, center, opts.half ?? 14), center, opts);
  }

  /**
   * Run the whole pre-registered analysis for one site.
   * years: the years to include (2008-2025 for the main result); opts.rule picks which dates
   * are treated as the clock changes ('new' or 'old'), whatever the law was in those years.
   * Returns per-year steps, K values, summaries, verdict and placebo summaries.
   */
  function analyseSite(site, years, opts = {}) {
    const rule = opts.rule ?? 'new';
    const at = (c) => {
      if (opts.cache && opts.cache.has(c)) return opts.cache.get(c);
      return opts.method === 'profile' ? shiftAt(site, c, opts) : stepAt(site, c, opts);
    };
    const rows = years.map((y) => {
      const t = transitions(y, rule);
      const sp = at(t.spring);
      const fa = at(t.fall);
      const K = sp && fa ? (fa.step - sp.step) / 2 : NaN;
      return { year: y, spring: sp, fall: fa, K };
    });
    const spring = summarize(rows.map((r) => (r.spring ? r.spring.step : NaN)));
    const fall = summarize(rows.map((r) => (r.fall ? r.fall.step : NaN)));
    const K = summarize(rows.map((r) => r.K));
    const validTransitions = rows.reduce((n, r) => n + (r.spring ? 1 : 0) + (r.fall ? 1 : 0), 0);
    const result = { rows, spring, fall, K, verdict: verdict(K), validTransitions, coverage: validTransitions / (2 * years.length) };
    if (opts.placebo === false) return result;
    const placebo = PLACEBO_OFFSETS.map((off) => {
      const pr = years.map((y) => {
        const t = transitions(y, rule);
        const sp = at(t.spring + off);
        const fa = at(t.fall + off);
        return {
          year: y,
          spring: sp ? sp.step : NaN,
          fall: fa ? fa.step : NaN,
          K: sp && fa ? (fa.step - sp.step) / 2 : NaN,
        };
      });
      return { offset: off, rows: pr, K: summarize(pr.map((r) => r.K)), verdict: verdict(summarize(pr.map((r) => r.K))) };
    });
    const placeboSteps = placebo.flatMap((p) => p.rows.flatMap((r) => [r.spring, r.fall])).filter(Number.isFinite);
    // K less the average of that year's two placebo K values: what is left after a steady
    // seasonal change in the shape of the day, measured five weeks either side, is taken out.
    const Kc = rows.map((r, i) => {
      const a = placebo[0].rows[i].K;
      const b = placebo[1].rows[i].K;
      return Number.isFinite(r.K) && Number.isFinite(a) && Number.isFinite(b) ? r.K - (a + b) / 2 : NaN;
    });
    rows.forEach((r, i) => (r.Kc = Kc[i]));
    const Kcorr = summarize(Kc);
    return {
      ...result,
      Kcorr,
      verdictCorrected: verdict(Kcorr),
      placebo,
      placeboSteps,
      placeboAbsOver30: placeboSteps.filter((x) => Math.abs(x) > 30).length,
      placeboCount: placeboSteps.length,
      placeboMaxAbs: placeboSteps.length ? Math.max(...placeboSteps.map(Math.abs)) : NaN,
    };
  }

  /**
   * The law-change test: the same estimator at the old-rule dates and at the new-rule dates,
   * in each era. eras: { name: years }. Returns { [era]: { old: summary, new: summary } }.
   */
  function lawChange(site, eras, opts = {}) {
    const out = {};
    for (const [name, years] of Object.entries(eras)) {
      out[name] = {};
      for (const rule of ['old', 'new']) {
        const a = analyseSite(site, years, { ...opts, rule, placebo: false });
        out[name][rule] = { spring: a.spring, fall: a.fall, K: a.K, verdict: a.verdict, rows: a.rows };
      }
    }
    return out;
  }

  /** Difference of two means with a Welch 95% interval. */
  function welch(a, b) {
    const x = a.filter(Number.isFinite);
    const y = b.filter(Number.isFinite);
    const sx = summarize(x);
    const sy = summarize(y);
    const d = sx.mean - sy.mean;
    if (x.length < 2 || y.length < 2) return { diff: d, lo: NaN, hi: NaN, n: [x.length, y.length] };
    const vx = (sx.sd * sx.sd) / x.length;
    const vy = (sy.sd * sy.sd) / y.length;
    const se = Math.sqrt(vx + vy);
    const df = (vx + vy) ** 2 / ((vx * vx) / (x.length - 1) + (vy * vy) / (y.length - 1));
    const half = tQuantile(0.975, df) * se;
    return { diff: d, lo: d - half, hi: d + half, df, n: [x.length, y.length] };
  }

  /**
   * The law-change comparison (difference in differences). At the dates the 2007 law moved
   * the clock change to (second Sunday of March, first Sunday of November): K in 2008-2025,
   * when the clocks changed then, less K in 1990-2006, when they did not. And at the old dates
   * (first Sunday of April, last Sunday of October): K in 1990-2006 less K in 2008-2025.
   * Anything tied to the calendar rather than the law (monthly release volumes, seasons)
   * appears in both eras and cancels. Part 2 of the pre-registration says a river that keeps
   * clock time gives about 60 in both; it can't, because the two fall dates are a week apart and
   * each fall window at the date that wasn't a change date holds the other rule's real change
   * (found by the independent review; see simulateClockKeeper for what it does give).
   */
  function lawDiD(site, eras, opts = {}) {
    const L = lawChange(site, eras, opts);
    const Ks = (era, rule) => L[era][rule].rows.map((r) => r.K);
    const atNew = welch(Ks('new', 'new'), Ks('old', 'new'));
    const atOld = welch(Ks('old', 'old'), Ks('new', 'old'));
    return { L, atNew, atOld };
  }

  /** The years of the main analysis and of the old-law comparison. */
  const YEARS = Array.from({ length: 18 }, (_, i) => 2008 + i);
  const OLD_YEARS = Array.from({ length: 17 }, (_, i) => 1990 + i);

  /**
   * The law-change comparison season by season (exploratory, not registered): the spring step
   * and the fall step at each pair of dates, new era less old era (Welch 95% intervals).
   */
  function lawBySeason(L) {
    const steps = (era, rule, season) => L[era][rule].rows.map((r) => (r[season] ? r[season].step : NaN));
    const out = {};
    for (const season of ['spring', 'fall']) {
      out[season] = {
        atNew: welch(steps('new', 'new', season), steps('old', 'new', season)),
        atOld: welch(steps('old', 'old', season), steps('new', 'old', season)),
      };
    }
    return out;
  }

  /** The stored hourly profile of one day (normalised residuals, -1..1), or null. */
  function profileOf(site, dn) {
    for (const run of site.profiles || []) {
      const i = (dn - run.first) * 24;
      if (i >= 0 && i < run.days.length) return decodeProfile(run.days, i);
    }
    return null;
  }

  /** Average profile per day offset from T, across years, for a picture. */
  function meanRaster(site, years, season, rule = 'new', half = 14) {
    const grid = Array.from({ length: 2 * half + 1 }, () => ({ sum: new Array(24).fill(0), n: 0 }));
    for (const y of years) {
      const T = transitions(y, rule)[season];
      for (let k = -half; k <= half; k++) {
        const p = profileOf(site, T + k);
        if (!p) continue;
        const g = grid[k + half];
        for (let h = 0; h < 24; h++) g.sum[h] += p[h];
        g.n++;
      }
    }
    return grid.map((g) => (g.n ? g.sum.map((v) => v / g.n) : null));
  }

  // ---------------------------------------------------------------- the second method
  //
  // Written after the first method failed its own checks (README, "What went wrong"), and frozen
  // in PREREGISTRATION.md (part 2) before it was run on the Colorado or the Green River.
  // Instead of one crest time per day, it compares the typical shape of the day before and after
  // a clock change: each day's 24 residuals scaled to unit RMS, the hour-by-hour median over the
  // 14 days on each side, and the time shift (within +/-3 h) that best lines the two up.

  /** Scale a day's residuals to unit root-mean-square, or null if the day is flat. */
  function rmsNormalize(r) {
    const rms = Math.sqrt(r.reduce((a, v) => a + v * v, 0) / r.length);
    return rms > 0 ? r.map((v) => v / rms) : null;
  }

  /** Hour-by-hour median of a set of 24-value profiles; null if fewer than minDays. */
  function medianProfile(profiles, minDays = 7) {
    const n = profiles.length;
    if (n < minDays) return null;
    const col = new Float64Array(n);
    const out = new Array(24);
    for (let h = 0; h < 24; h++) {
      for (let i = 0; i < n; i++) col[i] = profiles[i][h];
      col.sort(); // numeric order; the same median as median()
      out[h] = n % 2 ? col[(n - 1) / 2] : (col[n / 2 - 1] + col[n / 2]) / 2;
    }
    return out;
  }

  /**
   * Where, within its hour, an hourly mean sits in time. Lees Ferry's readings come every quarter
   * hour, stamped :00, :15, :30 and :45 (every one of the 2,784 in each March window of 2008-2025,
   * in the raw downloads; data.test.mjs checks the bundled fixture day), so the mean over
   * [h, h+1) is the value at h + 22.5 minutes, not at the half hour. Found by the
   * independent review (2026-10-24): placed at h + 0.5, every clock time on the page read 7.5
   * minutes late. Steps are unaffected: a common offset cancels when two days are compared.
   */
  const HOUR_CENTRE = 0.375;

  /** Harmonics 1..11 of a 24-value profile whose value h is placed at hour h + centre. */
  const harmonicTables = new Map();
  function harmonics(p, centre = 0.5) {
    // cos and sin of OMEGA * k * (h + centre), computed once per centre (same numbers as before)
    let table = harmonicTables.get(centre);
    if (!table) {
      table = new Float64Array(11 * 24 * 2);
      for (let k = 1; k <= 11; k++) {
        for (let h = 0; h < 24; h++) {
          const a = OMEGA * k * (h + centre);
          table[((k - 1) * 24 + h) * 2] = Math.cos(a);
          table[((k - 1) * 24 + h) * 2 + 1] = Math.sin(a);
        }
      }
      harmonicTables.set(centre, table);
    }
    const c = [];
    for (let k = 1; k <= 11; k++) {
      let re = 0;
      let im = 0;
      for (let h = 0; h < 24; h++) {
        const i = ((k - 1) * 24 + h) * 2;
        re += p[h] * table[i];
        im -= p[h] * table[i + 1];
      }
      c.push([re, im]);
    }
    return c;
  }

  // cos and sin of OMEGA * k * (m / 60) for every whole-minute shift m, computed once per limit
  // (the same expressions bestShift used to evaluate on every call, so the same numbers).
  const shiftTables = new Map();
  function shiftTable(limit) {
    let t = shiftTables.get(limit);
    if (!t) {
      t = [];
      for (let m = -limit; m <= limit; m++) {
        const sh = m / 60;
        const row = new Float64Array(22);
        for (let k = 1; k <= 11; k++) {
          const ang = OMEGA * k * sh;
          row[2 * k - 2] = Math.cos(ang);
          row[2 * k - 1] = Math.sin(ang);
        }
        t.push(row);
      }
      shiftTables.set(limit, t);
    }
    return t;
  }

  /**
   * The shift, in whole minutes within +/-limit, that best lines `after` up with `before`:
   * the s maximising the circular cross-correlation sum_t before(t) after(t + s), with both
   * profiles read as smooth curves through their 24 hourly values (harmonics 1..11).
   * Positive = the after pattern happens later. For after(t) = before(t - d) it returns d.
   */
  function bestShift(before, after, limit = 180) {
    const A = harmonics(before);
    const B = harmonics(after);
    // A profile with no shape at all (every hour zero) has no timing to line up: no estimate.
    // (Before this check, such a pair returned -180, the first shift tried. Found 2026-10-24;
    // it affects one centre, Buford 2008-04-06, used only in the law-change comparison.)
    const power = (H) => H.reduce((a, [re, im]) => a + re * re + im * im, 0);
    if (!(power(A) > 1e-18) || !(power(B) > 1e-18)) return null;
    const RE = new Float64Array(11);
    const IM = new Float64Array(11);
    for (let k = 1; k <= 11; k++) {
      const [ar, ai] = A[k - 1];
      const [br, bi] = B[k - 1];
      RE[k - 1] = ar * br + ai * bi;
      IM[k - 1] = ar * bi - ai * br;
    }
    const table = shiftTable(limit);
    let best = -Infinity;
    let arg = 0;
    for (let m = -limit; m <= limit; m++) {
      const row = table[m + limit];
      let v = 0;
      for (let k = 1; k <= 11; k++) v += RE[k - 1] * row[2 * k - 2] - IM[k - 1] * row[2 * k - 1];
      if (v > best + 1e-12) {
        best = v;
        arg = m;
      }
    }
    return arg;
  }

  /**
   * The two half-window median profiles around a centre, from a Map dayNumber -> {resid}.
   * Days centre-14..centre-1 and centre+1..centre+14; the centre day itself is left out.
   */
  function halfProfiles(dayMap, center, half = 14) {
    const side = (a, b) => {
      const ps = [];
      for (let d = a; d <= b; d++) {
        const v = dayMap.get(d);
        const n = v && v.resid && rmsNormalize(v.resid);
        if (n) ps.push(n);
      }
      return { profile: medianProfile(ps), n: ps.length };
    };
    const b = side(center - half, center - 1);
    const a = side(center + 1, center + half);
    return { before: b.profile, after: a.profile, nBefore: b.n, nAfter: a.n };
  }

  // ---------------------------------------------------------------- stored centres
  //
  // data/rivers.js keeps, for every centre a site's analyses ask about (see centresForSite),
  // one fixed-width record of RECORD_CHARS characters, in the order of centresForSite:
  //   [nBefore][nAfter][coherence before][coherence after][before: 24 x 2 chars][after: 24 x 2]
  // n: days used (0..14, one character). Coherence: the root-mean-square of the median day,
  // whose days were each scaled to unit RMS, times 50, one character (about 1 when every day has
  // the same shape, about 0.3 when the days are noise). Profiles: 12 bits per hour,
  // round(2047 * r / max|r|) + 2048 in two characters; '~' x 48 = fewer than 7 usable days;
  // 'A' x 48 = a flat median day (every hour zero).
  // Stored at 12 bits, the steps equal those from unrounded profiles at all but a handful of
  // centres, where they differ by 1 to 3 minutes (data.test.mjs checks every centre).

  const PROFILE_CHARS = 48;
  const RECORD_CHARS = 4 + 2 * PROFILE_CHARS;

  function encodeProfile12(r) {
    if (!r) return '~'.repeat(PROFILE_CHARS);
    const m = Math.max(...r.map(Math.abs));
    if (!(m > 0)) return 'A'.repeat(PROFILE_CHARS);
    return r.map((v) => enc2(Math.round((2047 * v) / m) + 2048)).join('');
  }
  function decodeProfile12(s, i) {
    if (s[i] === '~') return null;
    if (s.slice(i, i + PROFILE_CHARS) === 'A'.repeat(PROFILE_CHARS)) return new Array(24).fill(0);
    const out = new Array(24);
    for (let h = 0; h < 24; h++) out[h] = (dec2(s, i + 2 * h) - 2048) / 2047;
    return out;
  }
  function rmsOf(p) {
    return Math.sqrt(p.reduce((a, v) => a + v * v, 0) / p.length);
  }
  /** One centre's record from its two half-window results (see halfProfiles). */
  function encodeCentre(h) {
    const c = (x) => ALPHABET[Math.max(0, Math.min(63, x))];
    return (
      c(h.nBefore) +
      c(h.nAfter) +
      c(h.before ? Math.round(50 * rmsOf(h.before)) : 0) +
      c(h.after ? Math.round(50 * rmsOf(h.after)) : 0) +
      encodeProfile12(h.before) +
      encodeProfile12(h.after)
    );
  }
  function decodeCentre(s, i) {
    return {
      nBefore: CODE.get(s[i]),
      nAfter: CODE.get(s[i + 1]),
      coherenceBefore: CODE.get(s[i + 2]) / 50,
      coherenceAfter: CODE.get(s[i + 3]) / 50,
      before: decodeProfile12(s, i + 4),
      after: decodeProfile12(s, i + 4 + PROFILE_CHARS),
    };
  }

  /**
   * Every centre the analyses ask about, sorted: the real clock changes of 2008-2025 and the
   * fake ones 35 days either side; for the law-change sites also the old-rule dates of
   * 2008-2025 and both sets of dates in 1990-2006.
   */
  function centresForSite(law) {
    const set = new Set();
    for (const y of YEARS) {
      for (const T of Object.values(transitions(y, 'new'))) for (const off of [0, ...PLACEBO_OFFSETS]) set.add(T + off);
      if (law) for (const T of Object.values(transitions(y, 'old'))) set.add(T);
    }
    if (law) for (const y of OLD_YEARS) for (const rule of ['old', 'new']) for (const T of Object.values(transitions(y, rule))) set.add(T);
    return [...set].sort((a, b) => a - b);
  }

  const centreIndex = new WeakMap();
  /** The decoded record at a centre (day number), or null if the site has none there. */
  function centreAt(site, center) {
    let idx = centreIndex.get(site);
    if (!idx) {
      idx = new Map(centresForSite(site.law).map((c, k) => [c, k]));
      centreIndex.set(site, idx);
    }
    const k = idx.get(center);
    if (k === undefined || !site.centres) return null;
    return decodeCentre(site.centres, k * RECORD_CHARS);
  }

  /** The second method's step at a centre, from the stored record, or null. */
  function shiftAt(site, center, opts = {}) {
    const h = centreAt(site, center);
    if (!h || !h.before || !h.after) return null;
    const step = bestShift(h.before, h.after, opts.limit ?? 180);
    if (step === null) return null;
    return { step, nBefore: h.nBefore, nAfter: h.nAfter, coherenceBefore: h.coherenceBefore, coherenceAfter: h.coherenceAfter };
  }

  /**
   * Time of the highest point of a daily profile, in hours after midnight (standard time), to
   * the minute: the maximum of the smooth curve through its 24 hourly values (harmonics 1..11),
   * each hourly value placed at h + centre (HOUR_CENTRE for hourly means of quarter-hour readings).
   */
  function crest(profile, centre = HOUR_CENTRE) {
    const H = harmonics(profile, centre);
    let best = -Infinity;
    let arg = 0;
    for (let m = 0; m < 1440; m++) {
      const t = m / 60;
      let v = 0;
      for (let k = 1; k <= 11; k++) {
        const [re, im] = H[k - 1];
        // inverse of the transform in harmonics(): the curve's value at time t
        v += re * Math.cos(OMEGA * k * t) - im * Math.sin(OMEGA * k * t);
      }
      if (v > best) {
        best = v;
        arg = m;
      }
    }
    return arg / 60;
  }

  /**
   * The smooth curve through a profile's 24 values, sampled every `step` minutes from midnight
   * (for drawing and for clock times). Value h is placed at h + centre.
   */
  const curveTables = new Map();
  function smoothCurve(profile, step = 10, centre = HOUR_CENTRE) {
    const H = harmonics(profile, centre);
    let table = curveTables.get(step);
    if (!table) {
      table = [];
      for (let m = 0; m <= 1440; m += step) {
        const t = m / 60;
        const row = new Float64Array(22);
        for (let k = 1; k <= 11; k++) {
          row[2 * k - 2] = Math.cos(OMEGA * k * t);
          row[2 * k - 1] = Math.sin(OMEGA * k * t);
        }
        table.push(row);
      }
      curveTables.set(step, table);
    }
    const out = [];
    for (const row of table) {
      let v = 0;
      for (let k = 1; k <= 11; k++) {
        const [re, im] = H[k - 1];
        v += re * row[2 * k - 2] - im * row[2 * k - 1];
      }
      out.push(v / 12);
    }
    return out;
  }

  /**
   * The average median day before and after the real clock changes of one season, over the
   * given years (each year's median day scaled to unit RMS first). For pictures and the crest.
   */
  function averageHalves(site, years, season, rule = 'new') {
    const B = new Array(24).fill(0);
    const A = new Array(24).fill(0);
    let n = 0;
    for (const y of years) {
      const h = centreAt(site, transitions(y, rule)[season]);
      if (!h || !h.before || !h.after) continue;
      const rb = rmsOf(h.before);
      const ra = rmsOf(h.after);
      if (!(rb > 0) || !(ra > 0)) continue;
      for (let i = 0; i < 24; i++) {
        B[i] += h.before[i] / rb;
        A[i] += h.after[i] / ra;
      }
      n++;
    }
    return n ? { before: B.map((v) => v / n), after: A.map((v) => v / n), n } : null;
  }

  // ---------------------------------------------------------------- the report
  //
  // Everything the page and README say, computed in one place so the tests can pin it.

  /** Minutes with a true minus sign, to one decimal: -3.5 -> "\u22123.5". */
  function fmtMin(x, digits = 1) {
    if (!Number.isFinite(x)) return '\u2013';
    const v = Math.abs(x) < 0.5 * 10 ** -digits ? 0 : x;
    const t = Math.abs(v).toFixed(digits);
    return v < 0 ? `\u2212${t}` : t;
  }
  /** "5.4 (95% interval \u221222.8 to 33.5)" */
  function fmtCI(s) {
    if (!(s && s.n >= 2)) return 'no estimate';
    return `${fmtMin(s.mean)} (95% interval ${fmtMin(s.lo)} to ${fmtMin(s.hi)})`;
  }
  /** Clock time from minutes after midnight: 1406 -> "23:26". */
  function fmtClock(minutes) {
    const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }

  /**
   * Exploratory, descriptive: the times at which the average day crosses its daily mean,
   * upward and downward, and its highest and lowest points, in minutes after midnight
   * (standard time), from the smooth curve sampled each minute.
   */
  function dayEvents(profile) {
    const c = smoothCurve(profile, 1);
    const up = [];
    const down = [];
    let hi = 0;
    let lo = 0;
    for (let m = 1; m < 1440; m++) {
      if (c[m - 1] < 0 && c[m] >= 0) up.push(m);
      if (c[m - 1] >= 0 && c[m] < 0) down.push(m);
      if (c[m] > c[hi]) hi = m;
      if (c[m] < c[lo]) lo = m;
    }
    return { up, down, high: hi, low: lo };
  }

  /** Steps at the real changes of one season, by year (null where there is no estimate). */
  function seasonSteps(site, years, season, opts = {}) {
    return years.map((y) => {
      const r = opts.method === 'first' ? stepAt(site, transitions(y, 'new')[season]) : shiftAt(site, transitions(y, 'new')[season]);
      return r ? r.step : null;
    });
  }

  /** The years of the Glen Canyon fall steady-flow experiment (September-October, 2008-2012). */
  const STEADY_FALL_YEARS = [2008, 2009, 2010, 2011, 2012];

  // ---------------------------------------------------------------- added after the review
  //
  // Everything below up to report() was written on 24 October 2026, after an independent review,
  // and after every result had been seen. None of it is registered.

  /** A day's mean flow at Lees Ferry from the stored picture data (cubic feet per second), or null. */
  function dayMeanFlow(site, dn) {
    for (const run of site.profiles || []) {
      const k = dn - run.first;
      if (run.means && k >= 0 && 2 * k < run.means.length && run.means[2 * k] !== '~') return decLog(dec2(run.means, 2 * k));
    }
    return null;
  }

  /** Mean flow above which a day is counted as part of a high-flow release. */
  const HIGH_FLOW_CFS = 30000;

  /** Offsets k (T-14..T+14, T left out) of the days whose mean flow is above HIGH_FLOW_CFS. */
  function highFlowDays(site, T, half = 14) {
    const out = [];
    for (let k = -half; k <= half; k++) {
      if (k === 0) continue;
      const q = dayMeanFlow(site, T + k);
      if (q !== null && q > HIGH_FLOW_CFS) out.push(k);
    }
    return out;
  }

  /**
   * Other disturbances inside the fortnights around the real changes, found in the raw readings
   * after the review, that are not high flows. March 2021: the two weeks after the change hold
   * steady releases of about 4,200 cfs (16-19 March) and then about 20,000 (23-25 March).
   * November 2024: the two weeks after the change have lost most of their daily rise and fall
   * (in the raw readings the typical day's rise and fall shrinks from 34% of its mean flow to 12%; the median day's coherence is the lowest
   * of any November outside 2008-2012). Reclamation began "cool mix" releases below the dam on
   * 9 July 2024; I found no date for their end, so the cause is not established.
   */
  const OTHER_DISTURBED = [
    { year: 2021, season: 'spring', why: 'steady releases' },
    { year: 2024, season: 'fall', why: 'a damped daily cycle' },
  ];

  /**
   * The sharp features of a day (from dayEvents), in minutes after midnight: the morning rise
   * (upward mean-crossing between 06:00 and 12:00), the afternoon fall (downward, 12:00-20:00),
   * the evening rise (upward, 15:00-22:00), the daily low, and the crest (the highest point,
   * which on a broad, flat top is poorly fixed). null where a feature is missing.
   */
  function dayFeatures(ev) {
    const find = (xs, a, b) => {
      const m = xs.find((x) => x >= a && x < b);
      return m === undefined ? null : m;
    };
    return { morningRise: find(ev.up, 360, 720), afternoonFall: find(ev.down, 720, 1200), eveningRise: find(ev.up, 900, 1320), low: ev.low, crest: ev.high };
  }

  /** How far each feature moved from one day to another, in minutes (negative = earlier). */
  function featureMoves(before, after) {
    const fb = dayFeatures(dayEvents(before));
    const fa = dayFeatures(dayEvents(after));
    const moves = {};
    for (const k of Object.keys(fb)) {
      if (fb[k] === null || fa[k] === null) moves[k] = null;
      else {
        const d = fa[k] - fb[k];
        moves[k] = d - 1440 * Math.round(d / 1440);
      }
    }
    return { before: fb, after: fa, moves };
  }

  /** A small seeded generator (mulberry32), uniform on [0, 1). */
  function seeded(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * How well each feature's move in the average day is fixed: resample the years with
   * replacement, rebuild the two average days, and take the 2.5% and 97.5% points of each move
   * (resamples where a feature is missing are left out of that feature, and counted).
   */
  function bootstrapMoves(site, years, season, opts = {}) {
    const reps = opts.reps ?? 2000;
    const r = seeded(opts.seed ?? 7);
    const per = [];
    for (const y of years) {
      const h = centreAt(site, transitions(y, 'new')[season]);
      if (!h || !h.before || !h.after) continue;
      const rb = rmsOf(h.before);
      const ra = rmsOf(h.after);
      if (rb > 0 && ra > 0) per.push({ b: h.before.map((v) => v / rb), a: h.after.map((v) => v / ra) });
    }
    const got = {};
    for (let i = 0; i < reps; i++) {
      const B = new Array(24).fill(0);
      const A = new Array(24).fill(0);
      for (let j = 0; j < per.length; j++) {
        const s = per[Math.floor(r() * per.length)];
        for (let h = 0; h < 24; h++) {
          B[h] += s.b[h];
          A[h] += s.a[h];
        }
      }
      const m = featureMoves(B, A).moves;
      for (const [k, v] of Object.entries(m)) {
        if (!got[k]) got[k] = [];
        got[k].push(v);
      }
    }
    const out = {};
    for (const [k, vs] of Object.entries(got)) {
      const v = vs.filter((x) => x !== null).sort((a, b) => a - b);
      out[k] = { lo: v[Math.floor(0.025 * v.length)], hi: v[Math.ceil(0.975 * v.length) - 1], n: v.length, missing: vs.length - v.length };
    }
    return out;
  }

  /**
   * What the registered law-change comparison gives for a river that keeps clock time exactly.
   * The old and new fall dates are always exactly seven days apart (the last Sunday of October
   * and the first of November), so each 14-day window at the fall date that was not a change date
   * holds the other rule's real change, and a clock-keeper does not score 60 there. (The spring
   * dates are three or four weeks apart, outside each other's windows.)
   * Each simulated day is a fixed day shape (24 hourly values: by default Lees Ferry's average
   * March day for the spring dates and its average November day for the fall dates), turned one
   * hour earlier on the days the clocks are on daylight time under that year's law (the
   * change-over Sunday counts as the new time), plus independent noise of sd `noise` at each hour
   * (the shape is scaled to unit RMS). The days go through the second method as the real ones do
   * (unit RMS, the median day of the 14 days each side, the best shift within +/-3 h), at both
   * sets of dates in both eras, for `reps` simulated histories. keepsClock: false gives a river
   * that keeps standard time.
   */
  function simulateClockKeeper(shapes, opts = {}) {
    const noise = opts.noise ?? 0.2;
    const reps = opts.reps ?? 8;
    const keepsClock = opts.keepsClock ?? true;
    const r = seeded(opts.seed ?? 1);
    let spare = null;
    const gauss = () => {
      if (spare !== null) {
        const g = spare;
        spare = null;
        return g;
      }
      const u = Math.max(1e-12, r());
      const v = r();
      const m = Math.sqrt(-2 * Math.log(u));
      spare = m * Math.sin(2 * Math.PI * v);
      return m * Math.cos(2 * Math.PI * v);
    };
    const base = {};
    const early = {};
    for (const season of ['spring', 'fall']) {
      const p = shapes[season];
      const s = rmsOf(p);
      base[season] = p.map((v) => v / s);
      early[season] = base[season].map((_, h) => base[season][(h + 1) % 24]); // an hour earlier
    }
    const cohs = [];
    const step = (season, T, y) => {
      const law = transitions(y, ruleInForce(y));
      const side = (a, b) => {
        const ps = [];
        for (let d = a; d <= b; d++) {
          const src = keepsClock && d >= law.spring && d < law.fall ? early[season] : base[season];
          const day = new Array(24);
          for (let h = 0; h < 24; h++) day[h] = src[h] + noise * gauss();
          ps.push(rmsNormalize(day));
        }
        return medianProfile(ps);
      };
      const before = side(T - 14, T - 1);
      const after = side(T + 1, T + 14);
      cohs.push(rmsOf(before), rmsOf(after));
      return bestShift(before, after);
    };
    const eras = { old: OLD_YEARS, new: YEARS };
    const atNew = [];
    const atOld = [];
    const fall = { oldAtNew: [], newAtOld: [] };
    for (let i = 0; i < reps; i++) {
      const K = {};
      for (const [era, years] of Object.entries(eras)) {
        for (const rule of ['old', 'new']) {
          K[`${era}/${rule}`] = years.map((y) => {
            const t = transitions(y, rule);
            const sp = step('spring', t.spring, y);
            const fa = step('fall', t.fall, y);
            if (era === 'old' && rule === 'new') fall.oldAtNew.push(fa);
            if (era === 'new' && rule === 'old') fall.newAtOld.push(fa);
            return (fa - sp) / 2;
          });
        }
      }
      atNew.push(welch(K['new/new'], K['old/new']).diff);
      atOld.push(welch(K['old/old'], K['new/old']).diff);
    }
    return {
      noise,
      reps,
      keepsClock,
      atNew: summarize(atNew),
      atOld: summarize(atOld),
      fallOldAtNew: summarize(fall.oldAtNew),
      fallNewAtOld: summarize(fall.newAtOld),
      coherence: median(cohs),
    };
  }

  /**
   * The second method's whole report for every site: the registered analysis, the law-change
   * comparison (registered as supporting), and the exploratory pieces (labelled as such).
   */
  function report(data) {
    const out = { sites: {} };
    for (const site of data.sites) {
      const a = analyseSite(site, YEARS, { method: 'profile' });
      const r = {
        key: site.key,
        K: a.K,
        Kc: a.Kcorr,
        verdict: a.verdict,
        verdictCorrected: a.verdictCorrected,
        placebo: a.placebo.map((p) => ({
          offset: p.offset,
          K: p.K,
          spring: summarize(p.rows.map((x) => x.spring)),
          fall: summarize(p.rows.map((x) => x.fall)),
        })),
        spring: a.spring,
        fall: a.fall,
        rows: a.rows.map((row) => ({
          year: row.year,
          spring: row.spring ? row.spring.step : null,
          fall: row.fall ? row.fall.step : null,
          K: Number.isFinite(row.K) ? row.K : null,
          Kc: Number.isFinite(row.Kc) ? row.Kc : null,
        })),
      };
      if (site.law) {
        const d = lawDiD(site, { old: OLD_YEARS, new: YEARS }, { method: 'profile' });
        r.law = {
          atNew: d.atNew,
          atOld: d.atOld,
          eras: { oldAtOld: d.L.old.old.K, oldAtNew: d.L.old.new.K, newAtOld: d.L.new.old.K, newAtNew: d.L.new.new.K },
          eraSeasons: {
            oldAtOld: { spring: d.L.old.old.spring, fall: d.L.old.old.fall },
            oldAtNew: { spring: d.L.old.new.spring, fall: d.L.old.new.fall },
            newAtOld: { spring: d.L.new.old.spring, fall: d.L.new.old.fall },
            newAtNew: { spring: d.L.new.new.spring, fall: d.L.new.new.fall },
          },
          bySeason: lawBySeason(d.L), // exploratory
        };
      }
      out.sites[site.key] = r;
    }
    const lees = data.sites.find((s) => s.key === 'lees');
    if (lees) {
      const r = out.sites.lees;
      const later = YEARS.filter((y) => !STEADY_FALL_YEARS.includes(y));
      const b = analyseSite(lees, later, { method: 'profile' });
      const springSteps = r.rows.map((x) => x.spring).filter(Number.isFinite);
      const avg = { spring: averageHalves(lees, YEARS, 'spring'), fall: averageHalves(lees, YEARS, 'fall') };
      // Added after the review: the windows around the real changes that hold a high-flow
      // release, and K over the years whose windows hold no experiment found so far.
      const highFlow = [];
      for (const y of YEARS) {
        for (const season of ['spring', 'fall']) {
          const days = highFlowDays(lees, transitions(y, 'new')[season]);
          if (days.length) highFlow.push({ year: y, season, days });
        }
      }
      const highFlowFallYears = highFlow.filter((w) => w.season === 'fall').map((w) => w.year);
      // every window known to hold an experiment or a disturbance, with the reason
      const disturbed = [
        ...STEADY_FALL_YEARS.map((year) => ({ year, season: 'fall', why: 'the fall steady flows' })),
        ...highFlow.map((w) => ({ year: w.year, season: w.season, why: 'a high-flow release' })),
        ...OTHER_DISTURBED,
      ];
      const badFall = new Set(disturbed.filter((w) => w.season === 'fall').map((w) => w.year));
      const badAny = new Set(disturbed.map((w) => w.year));
      const quietNovYears = YEARS.filter((y) => !badFall.has(y));
      const quietYears = YEARS.filter((y) => !badAny.has(y));
      const qn = analyseSite(lees, quietNovYears, { method: 'profile' });
      const q = analyseSite(lees, quietYears, { method: 'profile' });
      const hf = analyseSite(lees, highFlowFallYears, { method: 'profile', placebo: false });
      const cut = (x, years) => ({ years, K: x.K, Kc: x.Kcorr, spring: x.spring, fall: x.fall, verdict: x.verdict, verdictCorrected: x.verdictCorrected });
      r.exploratory = {
        springEarlier: springSteps.filter((x) => x < 0).length,
        springCount: springSteps.length,
        springMedian: median(springSteps),
        fallMedian: median(r.rows.map((x) => x.fall).filter(Number.isFinite)),
        after2012: { years: later, K: b.K, Kc: b.Kcorr, spring: b.spring, fall: b.fall, verdict: b.verdict, verdictCorrected: b.verdictCorrected },
        highFlow,
        disturbed,
        highFlowFall: { years: highFlowFallYears, fall: hf.fall },
        quietNovembers: cut(qn, quietNovYears),
        quiet: cut(q, quietYears),
        averageDay: {
          spring: avg.spring && { before: dayEvents(avg.spring.before), after: dayEvents(avg.spring.after), shift: bestShift(avg.spring.before, avg.spring.after), features: featureMoves(avg.spring.before, avg.spring.after) },
          fall: avg.fall && { before: dayEvents(avg.fall.before), after: dayEvents(avg.fall.after), shift: bestShift(avg.fall.before, avg.fall.after), features: featureMoves(avg.fall.before, avg.fall.after) },
        },
      };
      // Added after the review: a river that keeps clock time exactly, built from Lees Ferry's
      // average days, through the law-change comparison; and, for comparison with its noise,
      // the coherence of Lees Ferry's own median days at the real changes of 2008-2025.
      if (r.law && avg.spring && avg.fall) {
        r.law.clockKeeper = simulateClockKeeper({ spring: avg.spring.before, fall: avg.fall.after });
        const cohs = [];
        for (const y of YEARS) {
          for (const T of Object.values(transitions(y, 'new'))) {
            const h = centreAt(lees, T);
            if (h && h.before && h.after) cohs.push(h.coherenceBefore, h.coherenceAfter);
          }
        }
        r.law.realCoherence = median(cohs);
      }
    }
    return out;
  }

  return {
    DAY_MS,
    HOUR_MS,
    OMEGA,
    dayNumber,
    dateOf,
    isoDate,
    dow,
    nthSunday,
    transitions,
    ruleInForce,
    hourlyMeans,
    fillGaps,
    movingAverage24,
    detrend,
    dailyComponent,
    dailyStats,
    solve,
    wls,
    median,
    estimateStep,
    lgamma,
    ibeta,
    tCdf,
    tQuantile,
    summarize,
    MARGIN,
    verdict,
    ALPHABET,
    DAY_CHARS,
    encodeDay,
    decodeDay,
    encodeProfile,
    decodeProfile,
    decodeWindow,
    encLog,
    decLog,
    PLACEBO_OFFSETS,
    siteDays,
    daysAround,
    stepAt,
    analyseSite,
    lawChange,
    profileOf,
    meanRaster,
    welch,
    lawDiD,
    YEARS,
    OLD_YEARS,
    lawBySeason,
    rmsNormalize,
    medianProfile,
    bestShift,
    halfProfiles,
    shiftAt,
    PROFILE_CHARS,
    RECORD_CHARS,
    encodeProfile12,
    decodeProfile12,
    encodeCentre,
    decodeCentre,
    centresForSite,
    centreAt,
    rmsOf,
    crest,
    smoothCurve,
    averageHalves,
    fmtMin,
    fmtCI,
    fmtClock,
    dayEvents,
    seasonSteps,
    STEADY_FALL_YEARS,
    HOUR_CENTRE,
    harmonics,
    dayMeanFlow,
    HIGH_FLOW_CFS,
    highFlowDays,
    OTHER_DISTURBED,
    dayFeatures,
    featureMoves,
    seeded,
    bootstrapMoves,
    simulateClockKeeper,
    report,
  };
});
