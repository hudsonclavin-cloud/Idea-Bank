/* solera.js: the arithmetic of a solera, with no DOM, no clock and no randomness.
 *
 * A solera is n rows of casks. Once a year:
 *   1. a fraction f of the bottom row (the solera itself) is drawn off and bottled;
 *   2. the bottom row is topped up with the same amount from the row above it,
 *      that row from the one above it, and so on up the rows;
 *   3. the top row is topped up with young wine, which is labelled with the year it went in.
 * At the founding, every cask is filled with one wine, the founding wine.
 *
 * Assumptions (also in the README): every row holds the same volume, each row is
 * perfectly mixed, and nothing evaporates or changes. Under those assumptions the
 * shares below are exact; they are computed in natural-log space so that shares as
 * small as 1e-300 survive.
 *
 * Rows are numbered by depth d: 1 is the top row, n is the bottom row (the solera).
 *
 * The one idea behind every formula: follow a single molecule in a row backwards,
 * one year at a time. In any year, a fraction f of that row had just come down from
 * the row above, so (the row being mixed) the molecule had just arrived with chance f,
 * independently of every other year. A molecule in row d therefore went in at the top
 * when it completed its d-th "arrival", counting back. Its age is a negative-binomial
 * waiting time, and the founding wine is whatever has not finished d arrivals before
 * the founding.
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
    draw: 0.25, // a quarter of each row moves down once a year
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

  function check(p) {
    const n = p.rows;
    const f = p.draw;
    if (!Number.isInteger(n) || n < 1) throw new RangeError('rows must be a positive integer');
    if (!(f > 0 && f < 1)) throw new RangeError('draw must be strictly between 0 and 1');
    return { n, f, lnf: Math.log(f), ln1f: Math.log1p(-f), y0: p.founded };
  }

  /** ln P(K_d = k): the share of a row-d cask that is exactly k draws old, counted so that
   * wine which just went in at the top of a one-row solera has k = 1. Zero below k = d. */
  function lnAgeShare(k, d, f) {
    if (!(k >= d)) return -Infinity;
    return lnChoose(k - 1, d - 1) + d * Math.log(f) + (k - d) * Math.log1p(-f);
  }

  /** ln P(Bin(s, f) <= d - 1): the share of founding wine left in row d after s draws. */
  function lnFoundingShare(s, d, f) {
    if (s < d) return 0; // too few draws for anything to have come all the way down
    const terms = [];
    for (let j = 0; j <= d - 1; j++) terms.push(lnChoose(s, j) + j * Math.log(f) + (s - j) * Math.log1p(-f));
    return Math.min(0, logSumExp(terms));
  }

  // ---- compositions -----------------------------------------------------------------
  // A composition lists every year present: { year, age, ln, founding }.
  // `ln` is the natural log of that year's share (-Infinity when absent).

  /** What is in a glass drawn in `year` (the saca of that year). Requires year > founded. */
  function glass(p, year) {
    const { n, f, y0 } = check(p);
    const t = year - y0;
    if (!(Number.isInteger(t) && t >= 1)) throw new RangeError('the first glass is drawn the year after the founding');
    const out = [{ year: y0, age: t, ln: lnFoundingShare(t - 1, n, f), founding: true }];
    for (let v = y0 + 1; v <= year - 1; v++) out.push({ year: v, age: year - v, ln: lnAgeShare(year - v, n, f), founding: false });
    return out;
  }

  /** What is in a cask of row d (1 = top, n = bottom) once the scales of `year` have run. */
  function row(p, year, d) {
    const { n, f, y0 } = check(p);
    if (!(Number.isInteger(d) && d >= 1 && d <= n)) throw new RangeError('no such row');
    const t = year - y0;
    if (!(Number.isInteger(t) && t >= 0)) throw new RangeError('the solera did not exist yet');
    const out = [{ year: y0, age: t, ln: lnFoundingShare(t, d, f), founding: true }];
    for (let v = y0 + 1; v <= year; v++) out.push({ year: v, age: year - v, ln: lnAgeShare(year - v + 1, d, f), founding: false });
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

  /** Summary of the glass drawn in `year`. */
  function glassStats(p, year) {
    const comp = glass(p, year);
    const N = p.molecules;
    const present = comp.filter((e) => e.ln > -Infinity);
    const youngest = present.reduce((a, e) => Math.max(a, e.year), -Infinity);
    // Years at or above one expected molecule, and the scarcest of those.
    let oldestCounted = null;
    let scarcest = null;
    for (const e of present) {
      if (lnCount(e.ln, N) >= 0) {
        if (oldestCounted === null || e.year < oldestCounted) oldestCounted = e.year;
        if (scarcest === null || e.ln < scarcest.ln) scarcest = e;
      }
    }
    // Is every year from the founding to the youngest present at one molecule or more?
    let unbroken = true;
    for (const e of comp) if (e.year <= youngest && !(lnCount(e.ln, N) >= 0)) unbroken = false;
    const founding = comp[0];
    return {
      year,
      composition: comp,
      meanAge: meanAge(comp),
      medianYear: medianYear(comp),
      youngest,
      oldestCounted,
      scarcest,
      unbroken,
      founding: {
        ln: founding.ln,
        lnCount: lnCount(founding.ln, N),
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
    const { n, f, y0 } = check(p);
    const lnN = Math.log(p.molecules);
    const max = limit || 20000;
    for (let t = 1; t <= max; t++) if (lnFoundingShare(t - 1, n, f) + lnN < 0) return y0 + t;
    return null;
  }

  /** The life of one year's young wine in the glass: when it first arrives, when it is at
   * its most (ties are all listed), and the last glass with one expected molecule of it. */
  function vintageLife(p, v) {
    const { n, f, y0 } = check(p);
    if (!(Number.isInteger(v) && v > y0)) throw new RangeError('young wine goes in the year after the founding at the earliest');
    const lnN = Math.log(p.molecules);
    // The negative binomial is unimodal; walk up to its peak and down its tail.
    let best = -Infinity;
    let k = n;
    while (lnAgeShare(k + 1, n, f) >= lnAgeShare(k, n, f) - 1e-12) k++;
    best = lnAgeShare(k, n, f);
    const peaks = [];
    for (let j = Math.max(n, k - 2); j <= k + 2; j++) if (Math.abs(lnAgeShare(j, n, f) - best) < 1e-9) peaks.push(v + j);
    let last = null;
    if (lnAgeShare(n, n, f) + lnN >= 0 || best + lnN >= 0) {
      let j = k;
      while (lnAgeShare(j + 1, n, f) + lnN >= 0) j++;
      last = v + j;
    }
    return {
      year: v,
      first: v + n,
      firstLn: lnAgeShare(n, n, f),
      peaks,
      peakLn: best,
      last, // last glass year with at least one expected molecule
      gone: last === null ? null : last + 1,
    };
  }

  // Mean and spread of the age of a glass in the long run (no founding wine left).
  function steadyMeanAge(p) {
    const { n, f } = check(p);
    return n / f;
  }
  function steadyAgeSd(p) {
    const { n, f } = check(p);
    return Math.sqrt(n * (1 - f)) / f;
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
    moleculesInGlass,
    sci,
    shareText,
    countText,
    withCommas,
    sup,
  };
});
