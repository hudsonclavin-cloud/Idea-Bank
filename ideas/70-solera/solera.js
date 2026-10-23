/* solera.js: the arithmetic of a solera, with no DOM, no clock and no randomness.
 *
 * A solera is n rows of casks. Through the year every cask loses a fraction e of its wine
 * through the wood (evaporation, the merma). Once a year:
 *   1. a fraction f of the bottom row (the solera itself) is drawn off and bottled (the saca);
 *   2. the bottom row is topped up from the row above it, enough to replace the draw and its
 *      own evaporation; that row is topped up from the one above it, enough to replace what it
 *      gave and what it lost; and so on up the rows;
 *   3. the top row is topped up with young wine, which is labelled with the year it went in.
 * At the founding, every cask is filled with one wine, the founding wine.
 *
 * So each year row d (1 = top, n = bottom) has a share g_d = f + (n - d + 1) e of its wine
 * replaced from above: the draw, plus the evaporation of itself and of every row below it.
 *
 * Assumptions (also in the README): every row holds the same volume, each row is perfectly
 * mixed, evaporation takes every molecule with the same chance (water or ethanol), and nothing
 * changes chemically. Under those assumptions the shares below are exact; they are computed in
 * natural-log space so that shares as small as 1e-300 survive.
 *
 * The one idea behind every formula: follow a single molecule in a row backwards, one year at
 * a time. In any year, a share g_d of row d had just come down from the row above, so (the row
 * being mixed) the molecule had just arrived with chance g_d, independently of every other year.
 * A molecule in row d therefore went in at the top when it completed one arrival in each of rows
 * d, d-1, ..., 1, counting back. Its age is a sum of geometric waiting times (a negative binomial
 * when e = 0, since then every g_d = f), and the founding wine is whatever has not finished
 * those arrivals since the founding.
 *
 * Loads as a classic browser script (window.Solera) and with require()/createRequire.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.Solera = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // The solera on the page. Invented, as is its bodega.
  const DEFAULTS = Object.freeze({
    rows: 4, // the solera and three criaderas
    draw: 0.25, // a quarter of the bottom row is drawn off once a year
    // Each cask loses 3.5% of its wine a year through the wood, made up from the row above:
    // the Consejo Regulador's average for sherry butts (about 3% in wet years, 4% in dry).
    evap: 0.035,
    founded: 1826,
    // Molecules in a 100 ml glass of 17% wine: see moleculesInGlass() and the README.
    molecules: 3.0e24,
    glassMl: 100,
  });

  const AVOGADRO = 6.02214076e23;

  // ---- log-space combinatorics ----------------------------------------------------
  const LF = [0];
  function lnFact(m) {
    while (LF.length <= m) {
      const i = LF.length;
      LF.push(LF[i - 1] + Math.log(i));
    }
    return LF[m];
  }
  function lnChoose(a, b) {
    if (b < 0 || b > a) return -Infinity;
    return lnFact(a) - lnFact(b) - lnFact(a - b);
  }
  function logSumExp(xs) {
    let m = -Infinity;
    for (const x of xs) if (x > m) m = x;
    if (m === -Infinity) return -Infinity;
    let s = 0;
    for (const x of xs) s += Math.exp(x - m);
    return m + Math.log(s);
  }
  /** ln(e^a + e^b), exact for -Infinity. */
  function lae(a, b) {
    if (a === -Infinity) return b;
    if (b === -Infinity) return a;
    return a > b ? a + Math.log1p(Math.exp(b - a)) : b + Math.log1p(Math.exp(a - b));
  }

  function evapOf(p) {
    return p.evap === undefined ? 0 : p.evap;
  }

  /** The share of each row replaced from above each year, g[d] for d = 1 (top) .. n (bottom). */
  function rates(p) {
    const n = p.rows;
    const f = p.draw;
    const e = evapOf(p);
    if (!Number.isInteger(n) || n < 1) throw new RangeError('rows must be a positive integer');
    if (!(f > 0 && f < 1)) throw new RangeError('draw must be strictly between 0 and 1');
    if (!(e >= 0 && e < 1)) throw new RangeError('evaporation must be at least 0 and below 1');
    if (!(f + n * e < 1)) throw new RangeError('the top row cannot be replaced entirely every year');
    const g = [NaN];
    for (let d = 1; d <= n; d++) g.push(f + (n - d + 1) * e);
    return g;
  }

  function check(p) {
    const g = rates(p);
    return { n: p.rows, f: p.draw, e: evapOf(p), g, y0: p.founded };
  }

  // ---- the closed forms for a solera without evaporation ------------------------------------
  // With e = 0 every row turns over the same share f, the age is negative binomial and the
  // founding share a binomial tail. These are kept as an independent check on the recursion below.

  /** ln P(K_d = k) with no evaporation: the share of a row-d cask that is exactly k draws old,
   * counted so that wine which just went in at the top of a one-row solera has k = 1. */
  function lnAgeShare(k, d, f) {
    if (!(k >= d)) return -Infinity;
    return lnChoose(k - 1, d - 1) + d * Math.log(f) + (k - d) * Math.log1p(-f);
  }

  /** ln P(Bin(s, f) <= d - 1): with no evaporation, the founding share left in row d after s draws. */
  function lnFoundingShare(s, d, f) {
    if (s < d) return 0; // too few draws for anything to have come all the way down
    const terms = [];
    for (let j = 0; j <= d - 1; j++) terms.push(lnChoose(s, j) + j * Math.log(f) + (s - j) * Math.log1p(-f));
    return Math.min(0, logSumExp(terms));
  }

  // ---- the general case: one recursion, row by row ------------------------------------------
  // Let S_d = G_1 + ... + G_d, with G_j geometric on {1, 2, ...} with chance g_j: the age of a
  // molecule in row d. Then (the cascade itself, written for ages)
  //   P(S_d = k) = (1 - g_d) P(S_d = k - 1) + g_d P(S_{d-1} = k - 1),   S_0 = 0,
  //   P(S_d > s) = (1 - g_d) P(S_d > s - 1) + g_d P(S_{d-1} > s - 1),   P(S_0 > s) = 0, P(S_d > 0) = 1.
  // Every term is positive, so in log space nothing cancels and tiny tails stay accurate.

  const MODELS = new Map();
  function model(p) {
    const { n, g } = check(p);
    const key = n + '|' + p.draw + '|' + evapOf(p);
    let m = MODELS.get(key);
    if (m) return m;
    if (MODELS.size > 24) MODELS.clear();
    const lng = g.map((x) => Math.log(x));
    const ln1g = g.map((x) => Math.log1p(-x));
    const A = []; // A[d][k] = ln P(S_d = k)
    const T = []; // T[d][s] = ln P(S_d > s)
    for (let d = 0; d <= n; d++) {
      A.push([d === 0 ? 0 : -Infinity]);
      T.push([d === 0 ? -Infinity : 0]);
    }
    m = {
      n,
      g,
      A,
      T,
      ensure(K) {
        for (let k = A[0].length; k <= K; k++) {
          A[0].push(-Infinity);
          T[0].push(-Infinity);
          for (let d = 1; d <= n; d++) {
            A[d].push(lae(ln1g[d] + A[d][k - 1], lng[d] + A[d - 1][k - 1]));
            T[d].push(Math.min(0, lae(ln1g[d] + T[d][k - 1], lng[d] + T[d - 1][k - 1])));
          }
        }
      },
    };
    MODELS.set(key, m);
    return m;
  }

  /** ln of the share of a row-d cask (after the scales) that is k years old, counting k = 1 for
   * wine that went in at the top this year; d defaults to the bottom row. For the glass, whose
   * wine is a year older than the bottom row it is drawn from, k is the glass year minus the vintage. */
  function lnAge(p, k, d) {
    const m = model(p);
    const D = d === undefined ? m.n : d;
    if (!(Number.isInteger(k) && k >= 1)) return -Infinity;
    m.ensure(k);
    return m.A[D][k];
  }

  /** ln of the founding share left in row d (default: the bottom row) after s scales. */
  function lnFounding(p, s, d) {
    const m = model(p);
    const D = d === undefined ? m.n : d;
    if (s <= 0) return 0;
    m.ensure(s);
    return m.T[D][s];
  }

  // ---- compositions -----------------------------------------------------------------
  // A composition lists every year present: { year, age, ln, founding }.
  // `ln` is the natural log of that year's share (-Infinity when absent).

  /** What is in a glass drawn in `year` (the saca of that year). Requires year > founded. */
  function glass(p, year) {
    const { n, y0 } = check(p);
    const t = year - y0;
    if (!(Number.isInteger(t) && t >= 1)) throw new RangeError('the first glass is drawn the year after the founding');
    const out = [{ year: y0, age: t, ln: lnFounding(p, t - 1, n), founding: true }];
    for (let v = y0 + 1; v <= year - 1; v++) out.push({ year: v, age: year - v, ln: lnAge(p, year - v, n), founding: false });
    return out;
  }

  /** What is in a cask of row d (1 = top, n = bottom) once the scales of `year` have run. */
  function row(p, year, d) {
    const { n, y0 } = check(p);
    if (!(Number.isInteger(d) && d >= 1 && d <= n)) throw new RangeError('no such row');
    const t = year - y0;
    if (!(Number.isInteger(t) && t >= 0)) throw new RangeError('the solera did not exist yet');
    const out = [{ year: y0, age: t, ln: lnFounding(p, t, d), founding: true }];
    for (let v = y0 + 1; v <= year; v++) out.push({ year: v, age: year - v, ln: lnAge(p, year - v + 1, d), founding: false });
    return out;
  }

  function meanAge(comp) {
    let s = 0;
    for (const e of comp) if (e.ln > -Infinity) s += Math.exp(e.ln) * e.age;
    return s;
  }

  function totalShare(comp) {
    let s = 0;
    for (const e of comp) if (e.ln > -Infinity) s += Math.exp(e.ln);
    return s;
  }

  /** The year Y such that at least half of the composition went in at Y or later, and at
   * least half at Y or earlier (the founding counts as its founding year). */
  function medianYear(comp) {
    const sorted = comp.slice().sort((a, b) => b.year - a.year);
    let s = 0;
    for (const e of sorted) {
      if (e.ln > -Infinity) s += Math.exp(e.ln);
      if (s >= 0.5) return e.year;
    }
    return sorted[sorted.length - 1].year;
  }

  /** ln of the expected number of molecules of a share `ln` in a glass. */
  function lnCount(ln, molecules) {
    return ln + Math.log(molecules);
  }

  /** Summary of the glass drawn in `year`.
   * `runFrom` is the oldest year of the unbroken run of years, counting back from the youngest,
   * that each have at least one expected molecule in the glass; `scarcest` is the scarcest year
   * of that run. The founding wine is reported on its own: it is everything that has not yet
   * come all the way down, not one year's wine, so it can outlast the oldest years. Each year's
   * share falls with age once past its peak, so no year older than `runFrom` is counted
   * (the tests check this). `unbroken` says whether every year from the founding to the
   * youngest, founding wine included, has at least one expected molecule. */
  function glassStats(p, year) {
    const comp = glass(p, year);
    const N = p.molecules;
    const y0 = p.founded;
    const present = comp.filter((e) => e.ln > -Infinity);
    const youngest = present.reduce((a, e) => Math.max(a, e.year), -Infinity);
    let runFrom = null;
    let scarcest = null;
    for (let v = youngest; v > y0; v--) {
      const e = comp[v - y0];
      if (!(lnCount(e.ln, N) >= 0)) break;
      runFrom = v;
      if (scarcest === null || e.ln < scarcest.ln) scarcest = e;
    }
    const founding = comp[0];
    const foundingCounted = lnCount(founding.ln, N) >= 0;
    const unbroken = youngest > y0 && runFrom === y0 + 1 && foundingCounted;
    return {
      year,
      composition: comp,
      meanAge: meanAge(comp),
      medianYear: medianYear(comp),
      youngest,
      runFrom,
      scarcest,
      unbroken,
      founding: {
        ln: founding.ln,
        lnCount: lnCount(founding.ln, N),
        counted: foundingCounted,
        pAny: probAtLeastOne(lnCount(founding.ln, N)),
      },
    };
  }

  /** Chance of at least one molecule when the expected count is e^lnLambda (Poisson). */
  function probAtLeastOne(lnLambda) {
    if (lnLambda > 4) return 1 - Math.exp(-Math.exp(lnLambda));
    return -Math.expm1(-Math.exp(lnLambda));
  }

  // ---- milestones -------------------------------------------------------------------

  /** First glass year in which the founding wine is below one expected molecule. */
  function foundingGone(p, limit) {
    const { y0 } = check(p);
    const lnN = Math.log(p.molecules);
    const max = limit || 20000;
    for (let t = 1; t <= max; t++) if (lnFounding(p, t - 1) + lnN < 0) return y0 + t;
    return null;
  }

  /** The life of one year's young wine in the glass: when it first arrives, when it is at
   * its most (ties are all listed), and the last glass with one expected molecule of it. */
  function vintageLife(p, v) {
    const { n, y0 } = check(p);
    if (!(Number.isInteger(v) && v > y0)) throw new RangeError('young wine goes in the year after the founding at the earliest');
    const lnN = Math.log(p.molecules);
    const L = (k) => lnAge(p, k);
    // A sum of geometric waiting times is unimodal; walk up to its peak and down its tail.
    let k = n;
    while (L(k + 1) >= L(k) - 1e-12) k++;
    const best = L(k);
    const peaks = [];
    for (let j = Math.max(n, k - 2); j <= k + 2; j++) if (Math.abs(L(j) - best) < 1e-9) peaks.push(v + j);
    let last = null;
    if (L(n) + lnN >= 0 || best + lnN >= 0) {
      let j = k;
      while (L(j + 1) + lnN >= 0) j++;
      last = v + j;
    }
    return {
      year: v,
      first: v + n,
      firstLn: L(n),
      peaks,
      peakLn: best,
      last, // last glass year with at least one expected molecule
      gone: last === null ? null : last + 1,
    };
  }

  // ---- the long run (no founding wine left) ---------------------------------------------

  /** Mean age of a glass in the long run: the sum over rows of 1 / g_d (n / f with no evaporation). */
  function steadyMeanAge(p) {
    const { n, g } = check(p);
    let s = 0;
    for (let d = 1; d <= n; d++) s += 1 / g[d];
    return s;
  }
  /** Standard deviation of the age of a glass in the long run. */
  function steadyAgeSd(p) {
    const { n, g } = check(p);
    let v = 0;
    for (let d = 1; d <= n; d++) v += (1 - g[d]) / (g[d] * g[d]);
    return Math.sqrt(v);
  }

  /** How much one year's glass differs from the last, in the long run, if each year's young
   * wine differs from the others at random (independently, with the same spread). A glass is
   * sum_k w_k x_(Y-k), so the change from one year's glass to the next has standard deviation
   * sqrt(sum_k (w_k - w_(k-1))^2) times the spread of the young wine. */
  function yearToYearChange(p) {
    const m = model(p);
    let s = 0;
    let prev = 0;
    let peak = 0;
    for (let k = 1; ; k++) {
      m.ensure(k);
      const w = Math.exp(m.A[m.n][k]);
      s += (w - prev) * (w - prev);
      if (w > peak) peak = w;
      prev = w;
      if (k > m.n && w < peak * 1e-12) break;
    }
    return Math.sqrt(s + prev * prev);
  }

  /** A single cask that loses the same share to evaporation, drawn so that its glass has the
   * same long-run average age as `p`; null when no draw can make it that old. */
  function singleCaskLike(p) {
    const e = evapOf(p);
    const draw = 1 / steadyMeanAge(p) - e;
    if (!(draw > 0)) return null;
    return { ...p, rows: 1, draw, evap: e };
  }

  // ---- molecules ----------------------------------------------------------------------

  /** Molecules in `ml` of wine at `abv` (volume fraction), counting only ethanol and water.
   * `mixDensity` is the density of the mixture in g/ml; by default the water volume is taken
   * as (1 - abv) * ml at 0.9982 g/ml, which ignores the small contraction on mixing and so
   * slightly undercounts. */
  function moleculesInGlass(ml, abv, mixDensity) {
    const ethanolG = abv * ml * 0.7893;
    const waterG = mixDensity ? ml * mixDensity - ethanolG : (1 - abv) * ml * 0.9982;
    return (ethanolG / 46.068 + waterG / 18.015) * AVOGADRO;
  }

  // ---- words --------------------------------------------------------------------------

  const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
  function sup(s) {
    return String(s).split('').map((c) => SUP[c] || c).join('');
  }

  /** e^ln written as "a × 10ⁿ" with `sig` significant figures. */
  function sci(ln, sig) {
    const digits = sig || 2;
    const l10 = ln / Math.LN10;
    let e = Math.floor(l10);
    let m = Math.pow(10, l10 - e);
    let ms = m.toPrecision(digits);
    if (Number(ms) >= 10) {
      e += 1;
      ms = (m / 10).toPrecision(digits);
    }
    ms = ms.replace(/\.?0+$/, '');
    if (ms === '1') return '10' + sup(e);
    return ms + ' × 10' + sup(e);
  }

  function withCommas(x) {
    return String(x).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /** Round to two significant figures, keeping integers integral. */
  function round2(x) {
    if (x < 100) return Math.round(x);
    const p = Math.pow(10, Math.floor(Math.log10(x)) - 1);
    return Math.round(x / p) * p;
  }

  /** A share as words: "6.45%", "0.026%", or "7 parts in 10²¹" style. */
  function shareText(ln) {
    if (ln === -Infinity) return 'none';
    const s = Math.exp(ln);
    if (s >= 0.9995) return '100%';
    if (s >= 1e-4) {
      const pct = s * 100;
      return (pct >= 10 ? pct.toPrecision(3) : pct >= 1 ? pct.toPrecision(3) : pct.toPrecision(2)).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') + '%';
    }
    // "x parts in 10^k" with a whole number x from 1 to 9.
    const l10 = ln / Math.LN10;
    let k = Math.ceil(-l10);
    let parts = Math.round(Math.pow(10, l10 + k)); // 10^(l10 + k) is in [1, 10)
    if (parts >= 10) {
      parts = 1;
      k -= 1;
    }
    return parts + (parts === 1 ? ' part in 10' : ' parts in 10') + sup(k);
  }

  /** An expected molecule count as words. */
  function countText(lnC) {
    if (lnC === -Infinity) return 'none';
    const c = Math.exp(lnC);
    if (c < 1) return 'less than one';
    if (c < 1e6) return withCommas(round2(c));
    return sci(lnC, 2);
  }

  return {
    DEFAULTS,
    AVOGADRO,
    lnFact,
    lnChoose,
    lnAgeShare,
    lnFoundingShare,
    rates,
    lnAge,
    lnFounding,
    glass,
    row,
    meanAge,
    totalShare,
    medianYear,
    glassStats,
    probAtLeastOne,
    foundingGone,
    vintageLife,
    steadyMeanAge,
    steadyAgeSd,
    yearToYearChange,
    singleCaskLike,
    moleculesInGlass,
    sci,
    shareText,
    countText,
    withCommas,
    sup,
  };
});
