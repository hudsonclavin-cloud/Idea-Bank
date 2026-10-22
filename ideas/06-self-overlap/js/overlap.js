/*
 * overlap.js: the pure math behind "The Pattern That Trips Over Itself".
 *
 * Patterns are strings over the alphabet {H, T}; the coin is fair throughout.
 * No DOM access here. Loads as a classic browser script (exposes window.Overlap)
 * and under Node (module.exports), so the essay and the tests share one source.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.Overlap = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PATTERN_RE = /^[HT]+$/;

  function check(p) {
    if (typeof p !== 'string' || !PATTERN_RE.test(p)) {
      throw new TypeError('pattern must be a non-empty string of H and T, got ' + JSON.stringify(p));
    }
    return p;
  }

  /**
   * Conway's correlation XY: the sum of 2^k over every k (1 <= k <= min length)
   * for which the last k letters of x equal the first k letters of y.
   */
  function correlation(x, y) {
    check(x);
    check(y);
    const m = Math.min(x.length, y.length);
    let sum = 0;
    for (let k = 1; k <= m; k++) {
      if (x.slice(x.length - k) === y.slice(0, k)) sum += Math.pow(2, k);
    }
    return sum;
  }

  /** Expected number of fair-coin flips until p first appears: the self-correlation PP. */
  function expectedWait(p) {
    return correlation(p, p);
  }

  /**
   * Every shift of a copy of p across p. At shift s the overlap is k = n - s letters:
   * the last k letters of p (top row) against the first k letters of the copy.
   */
  function selfOverlaps(p) {
    check(p);
    const n = p.length;
    const out = [];
    for (let s = 0; s < n; s++) {
      const k = n - s;
      const top = p.slice(s);
      const copy = p.slice(0, k);
      const match = top === copy;
      out.push({ shift: s, k: k, top: top, copy: copy, match: match, value: match ? Math.pow(2, k) : 0 });
    }
    return out;
  }

  /** All 2^n patterns of length n, in lexicographic order with H before T. */
  function allPatterns(n) {
    const out = [];
    for (let i = 0; i < 1 << n; i++) {
      let s = '';
      for (let j = n - 1; j >= 0; j--) s += (i >> j) & 1 ? 'T' : 'H';
      out.push(s);
    }
    return out;
  }

  function gcd(a, b) {
    a = Math.abs(a);
    b = Math.abs(b);
    while (b) {
      const t = a % b;
      a = b;
      b = t;
    }
    return a;
  }

  function fraction(num, den) {
    const g = gcd(num, den) || 1;
    return { num: num / g, den: den / g, value: num / den };
  }

  /**
   * Penney race between two distinct patterns of equal length, flipping until one appears.
   * Conway's rule: the odds that b comes first are (AA - AB) : (BB - BA).
   */
  function race(a, b) {
    check(a);
    check(b);
    if (a.length !== b.length) throw new RangeError('race() expects patterns of equal length');
    if (a === b) throw new RangeError('race() expects two different patterns');
    const aa = correlation(a, a);
    const ab = correlation(a, b);
    const bb = correlation(b, b);
    const ba = correlation(b, a);
    const forB = aa - ab;
    const forA = bb - ba;
    const g = gcd(forA, forB) || 1;
    return {
      aa: aa,
      ab: ab,
      bb: bb,
      ba: ba,
      forA: forA,
      forB: forB,
      odds: { a: forA / g, b: forB / g },
      pA: fraction(forA, forA + forB),
      pB: fraction(forB, forA + forB),
    };
  }

  /** The same-length pattern most likely to appear before a (ties broken by list order). */
  function bestReply(a) {
    check(a);
    let best = null;
    for (const b of allPatterns(a.length)) {
      if (b === a) continue;
      const r = race(a, b);
      if (!best || r.pB.value > best.prob.value + 1e-12) best = { pattern: b, prob: r.pB, race: r };
    }
    return best;
  }

  /** Conway's recipe for a counter to a: opposite of a's 2nd letter, then a minus its last letter. */
  function conwayReply(a) {
    check(a);
    if (a.length < 2) throw new RangeError('conwayReply() needs a pattern of length 2 or more');
    return (a[1] === 'H' ? 'T' : 'H') + a.slice(0, a.length - 1);
  }

  /**
   * Matching automaton for p (as used by Knuth-Morris-Pratt). State i = number of
   * letters of p matched so far, 0..n. Returns next[i] = [after H, after T]. From the
   * full-match state n it keeps going, so occurrences may overlap.
   */
  function automaton(p) {
    check(p);
    const n = p.length;
    const next = [];
    for (let i = 0; i <= n; i++) {
      const row = [];
      for (const c of 'HT') {
        const s = p.slice(0, Math.min(i, n)) + c;
        let k = Math.min(n, s.length);
        while (k > 0 && s.slice(s.length - k) !== p.slice(0, k)) k--;
        row.push(k);
      }
      next.push(row);
    }
    return next;
  }

  /** Distribution of the first time p appears: pmf[t] = P(T = t) for t = 0..tMax. */
  function waitPMF(p, tMax) {
    const n = p.length;
    const next = automaton(p);
    let dist = new Array(n + 1).fill(0);
    dist[0] = 1;
    const pmf = new Array(tMax + 1).fill(0);
    for (let t = 1; t <= tMax; t++) {
      const nd = new Array(n + 1).fill(0);
      for (let i = 0; i < n; i++) {
        if (!dist[i]) continue;
        nd[next[i][0]] += dist[i] / 2;
        nd[next[i][1]] += dist[i] / 2;
      }
      pmf[t] = nd[n];
      nd[n] = 0;
      dist = nd;
    }
    return pmf;
  }

  /**
   * Long-run distribution of the gap between consecutive (possibly overlapping)
   * occurrences of p: gap[d] = P(next occurrence ends d flips after this one).
   */
  function gapPMF(p, dMax) {
    const n = p.length;
    const next = automaton(p);
    let dist = new Array(n + 1).fill(0);
    dist[next[n][0]] += 0.5;
    dist[next[n][1]] += 0.5;
    const gap = new Array(dMax + 1).fill(0);
    gap[1] = dist[n];
    dist[n] = 0;
    for (let d = 2; d <= dMax; d++) {
      const nd = new Array(n + 1).fill(0);
      for (let i = 0; i < n; i++) {
        if (!dist[i]) continue;
        nd[next[i][0]] += dist[i] / 2;
        nd[next[i][1]] += dist[i] / 2;
      }
      gap[d] = nd[n];
      nd[n] = 0;
      dist = nd;
    }
    return gap;
  }

  /**
   * Exact mean and variance of the number of (overlapping) occurrences of p in N flips.
   * Indicators I_j for each of the m = N - n + 1 windows; windows d apart (d < n) can
   * both hold p only if p overlaps itself at shift d.
   */
  function countMoments(p, N) {
    check(p);
    const n = p.length;
    const m = N - n + 1;
    if (m <= 0) return { mean: 0, variance: 0, sd: 0 };
    const q = Math.pow(2, -n);
    let variance = m * q * (1 - q);
    for (let d = 1; d < n && d < m; d++) {
      const both = p.slice(d) === p.slice(0, n - d) ? Math.pow(2, -(n + d)) : 0;
      variance += 2 * (m - d) * (both - q * q);
    }
    return { mean: m * q, variance: variance, sd: Math.sqrt(variance) };
  }

  /* ---------- randomness ---------- */

  /** Mulberry32: a small, fast seeded PRNG returning uint32s. */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return (t ^ (t >>> 14)) >>> 0;
    };
  }

  /** Turns a uint32 source into fair bits, 32 per call. 1 means heads. */
  function bitSource(rng) {
    let word = 0;
    let left = 0;
    return function () {
      if (left === 0) {
        word = rng();
        left = 32;
      }
      left--;
      const bit = word & 1;
      word >>>= 1;
      return bit;
    };
  }

  function code(p) {
    let x = 0;
    for (const c of p) x = (x << 1) | (c === 'H' ? 1 : 0);
    return x;
  }

  /** Flip until p appears; return the flip count. */
  function simulateWait(p, bit) {
    check(p);
    const n = p.length;
    const mask = (1 << n) - 1;
    const target = code(p);
    let x = 0;
    let t = 0;
    for (;;) {
      x = ((x << 1) | bit()) & mask;
      t++;
      if (t >= n && x === target) return t;
    }
  }

  /** Flip until a or b appears (equal lengths); return 'a' or 'b'. */
  function simulateRace(a, b, bit) {
    const n = a.length;
    const mask = (1 << n) - 1;
    const ca = code(a);
    const cb = code(b);
    let x = 0;
    let t = 0;
    for (;;) {
      x = ((x << 1) | bit()) & mask;
      t++;
      if (t >= n) {
        if (x === ca) return 'a';
        if (x === cb) return 'b';
      }
    }
  }

  /** The flips of one game, as a string, stopping the moment p first appears. */
  function playUntil(p, bit) {
    check(p);
    let s = '';
    for (;;) {
      s += bit() ? 'H' : 'T';
      if (s.length >= p.length && s.endsWith(p)) return s;
    }
  }

  /** Start indices (0-based) of every occurrence of p in flips, overlaps included. */
  function occurrences(p, flips) {
    const out = [];
    for (let i = 0; i + p.length <= flips.length; i++) {
      if (flips.startsWith(p, i)) out.push(i);
    }
    return out;
  }

  /**
   * Li's casino. Before flip g (1-based) gambler g arrives with $1 and bets everything,
   * double-or-nothing, on p[0], then p[1], and so on. Returns each arrived gambler's
   * state after the first t flips.
   */
  function gamblers(p, flips, t) {
    const n = p.length;
    const out = [];
    for (let g = 1; g <= t; g++) {
      let matched = 0;
      let bustAt = 0;
      for (let j = 0; j < n && g + j <= t; j++) {
        if (flips[g + j - 1] === p[j]) matched++;
        else {
          bustAt = g + j;
          break;
        }
      }
      const alive = bustAt === 0;
      out.push({
        arrival: g,
        matched: matched,
        alive: alive,
        bustAt: bustAt,
        complete: alive && matched === n,
        stake: alive ? Math.pow(2, matched) : 0,
      });
    }
    return out;
  }

  return {
    correlation: correlation,
    expectedWait: expectedWait,
    selfOverlaps: selfOverlaps,
    allPatterns: allPatterns,
    gcd: gcd,
    fraction: fraction,
    race: race,
    bestReply: bestReply,
    conwayReply: conwayReply,
    automaton: automaton,
    waitPMF: waitPMF,
    gapPMF: gapPMF,
    countMoments: countMoments,
    mulberry32: mulberry32,
    bitSource: bitSource,
    simulateWait: simulateWait,
    simulateRace: simulateRace,
    playUntil: playUntil,
    occurrences: occurrences,
    gamblers: gamblers,
  };
});
