/*
 * hydra.js: the mathematics of "Smaller Every Cut", with no DOM in it.
 *
 * The game is Kirby and Paris's hydra (Bull. London Math. Soc. 14, 1982). A hydra is a
 * finite rooted tree; the root is the body, the leaves are heads. On cut number n you
 * remove one head. If the head grew straight from the body, that is all. Otherwise let
 * P be the joint it hung from and G the joint below P: P (now without that head) is
 * kept, and n fresh copies of it, with everything on it, sprout from G.
 *
 * Every hydra has a clock reading, an ordinal below epsilon_0: a head reads 0, and a
 * joint reads omega^a + omega^b + ... (biggest first) over the readings a, b, ... of the
 * necks growing from it. Two hydras read the same exactly when they are the same tree
 * up to the order of necks, so a reading is the hydra, written as an ordinal in Cantor
 * normal form. Every cut lowers the body's reading, and ordinals cannot fall forever.
 *
 * Loads as a classic browser script (window.Hydra) and under Node (module.exports), so
 * the page and the tests share one source.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.Hydra = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ================================================================== */
  /* Ordinals below epsilon_0 in Cantor normal form.                     */
  /* An ordinal is an array of terms [exponent, coefficient]: exponents   */
  /* are ordinals in strictly decreasing order, coefficients are positive */
  /* BigInts. Zero is []. Arrays are never mutated after construction.    */
  /* ================================================================== */

  const ZERO = Object.freeze([]);
  const ONE = Object.freeze([Object.freeze([ZERO, 1n])]);
  const OMEGA = Object.freeze([Object.freeze([ONE, 1n])]);

  function big(n) {
    return typeof n === 'bigint' ? n : BigInt(n);
  }

  function cmp(a, b) {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const c = cmp(a[i][0], b[i][0]);
      if (c) return c;
      if (a[i][1] !== b[i][1]) return a[i][1] < b[i][1] ? -1 : 1;
    }
    return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
  }

  // Natural (Hessenberg) sum of a list of terms given in any order, with repeats.
  function fromTerms(terms) {
    const out = [];
    for (const [e, c] of terms) {
      const cc = big(c);
      if (cc <= 0n) continue;
      let k = 0;
      while (k < out.length && cmp(out[k][0], e) > 0) k++;
      if (k < out.length && cmp(out[k][0], e) === 0) out[k] = [out[k][0], out[k][1] + cc];
      else out.splice(k, 0, [e, cc]);
    }
    return out;
  }

  function nat(k) {
    const n = big(k);
    return n === 0n ? ZERO : [[ZERO, n]];
  }

  function isFinite(a) {
    return a.length === 0 || (a.length === 1 && a[0][0].length === 0);
  }

  function finiteValue(a) {
    if (!isFinite(a)) throw new Error('not finite');
    return a.length ? a[0][1] : 0n;
  }

  // a = (something) + 1 ?
  function isSuccessor(a) {
    return a.length > 0 && a[a.length - 1][0].length === 0;
  }

  function str(a) {
    if (!a.length) return '0';
    return a
      .map(([e, c]) => {
        if (!e.length) return String(c);
        let s;
        if (cmp(e, ONE) === 0) s = 'w';
        else if (isFinite(e)) s = 'w^' + String(finiteValue(e));
        else s = 'w^(' + str(e) + ')';
        return c === 1n ? s : s + '*' + String(c);
      })
      .join('+');
  }

  // Parse the ASCII form produced by str() (used by tests and presets).
  function parse(s) {
    let i = 0;
    function sum() {
      const terms = [];
      for (;;) {
        terms.push(term());
        if (s[i] === '+') i++;
        else break;
      }
      return fromTerms(terms);
    }
    function num() {
      const j = i;
      while (i < s.length && s[i] >= '0' && s[i] <= '9') i++;
      if (j === i) throw new Error('expected a number at ' + j + ' in ' + s);
      return BigInt(s.slice(j, i));
    }
    function term() {
      if (s[i] === 'w') {
        i++;
        let e = ONE;
        if (s[i] === '^') {
          i++;
          if (s[i] === '(') {
            i++;
            e = sum();
            if (s[i] !== ')') throw new Error('expected ) in ' + s);
            i++;
          } else e = nat(num());
        }
        let c = 1n;
        if (s[i] === '*') {
          i++;
          c = num();
        }
        return [e, c];
      }
      return [ZERO, num()];
    }
    if (s === '0') return ZERO;
    const r = sum();
    if (i !== s.length) throw new Error('trailing input in ' + s);
    return r;
  }

  /*
   * Fundamental sequences (the standard ones for Cantor normal form), with
   * a[n] = predecessor for a successor:
   *   (g + 1)[n] = g
   *   (g + w^(b+1))[n] = g + w^b * n
   *   (g + w^L)[n] = g + w^(L[n])       for limit L
   */
  function fs(a, n) {
    if (!a.length) throw new Error('0 has no fundamental sequence');
    const N = big(n);
    const head = a.slice(0, -1);
    const [e, c] = a[a.length - 1];
    if (c > 1n) head.push([e, c - 1n]);
    if (!e.length) return head;
    if (isSuccessor(e)) return appendTerm(head, fs(e, 0n), N);
    return appendTerm(head, fs(e, N), 1n);
  }

  function appendTerm(head, e, c) {
    if (c === 0n) return head;
    const out = head.slice();
    if (out.length && cmp(out[out.length - 1][0], e) === 0) out[out.length - 1] = [e, out[out.length - 1][1] + c];
    else out.push([e, c]);
    return out;
  }

  /* ---------- formatting ---------- */

  const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };

  function groupDigits(s, sep) {
    return s.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  }

  // A BigInt for people: exact up to 9 digits, then "1.23 × 10^45".
  function fmtBig(n, opts) {
    const o = opts || {};
    const s = String(n);
    if (s.length <= (o.exactDigits || 9)) return groupDigits(s, o.sep || ',');
    const mant = s[0] + '.' + s.slice(1, 3);
    const exp = s.length - 1;
    if (o.html) return mant + '×10<sup>' + groupDigits(String(exp), ',') + '</sup>';
    return mant + '×10^' + groupDigits(String(exp), ',');
  }

  function escape(s) {
    return String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  }

  // HTML with nested superscripts. Long sums keep their first terms and their last one.
  function html(a, opts) {
    const o = opts || {};
    const max = o.maxTerms || 4;
    if (!a.length) return '0';
    const term = ([e, c]) => {
      const coef = (x) => fmtBig(x, { html: true, sep: ' ' });
      if (!e.length) return coef(c);
      let s = 'ω';
      if (cmp(e, ONE) !== 0) s += '<sup>' + html(e, { maxTerms: 3, inner: true }) + '</sup>';
      if (c !== 1n) s += '·' + coef(c);
      return s;
    };
    const sep = o.inner ? '+' : ' + ';
    let parts;
    if (a.length > max) {
      parts = a.slice(0, max - 1).map(term);
      parts.push('<span class="ell" title="' + a.length + ' terms">…</span>');
      parts.push(term(a[a.length - 1]));
    } else parts = a.map(term);
    return parts.join(sep);
  }

  // Plain text for canvas labels and screen readers: ω², ω^ω, ω^(ω+1)·3.
  function plain(a, opts) {
    const o = opts || {};
    const max = o.maxTerms || 3;
    if (!a.length) return '0';
    const term = ([e, c]) => {
      if (!e.length) return fmtBig(c, { exactDigits: 6 });
      let s = 'ω';
      if (cmp(e, ONE) === 0) s += '';
      else if (isFinite(e) && finiteValue(e) < 1000000n) s += String(finiteValue(e)).replace(/\d/g, (d) => SUP[d]);
      else if (e.length === 1 && cmp(e[0][0], ONE) === 0 && e[0][1] === 1n) s += '^ω';
      else s += '^(' + plain(e, { maxTerms: 2 }) + ')';
      if (c !== 1n) s += '·' + fmtBig(c, { exactDigits: 6 });
      return s;
    };
    if (a.length > max) return a.slice(0, max - 1).map(term).join('+') + '+…+' + term(a[a.length - 1]);
    return a.map(term).join('+');
  }

  /* ================================================================== */
  /* The game on canonical hydras (the ordinal is the tree).             */
  /* A move is a path of term indices from the body down to a head.      */
  /* ================================================================== */

  function cnfCut(a, path, n) {
    const N = big(n);
    function rec(node, d) {
      const i = path[d];
      if (i < 0 || i >= node.length) throw new Error('bad path');
      const e = node[i][0];
      const rest = [];
      for (let k = 0; k < node.length; k++) {
        const c = k === i ? node[k][1] - 1n : node[k][1];
        if (c > 0n) rest.push([node[k][0], c]);
      }
      if (d === path.length - 1) {
        if (e.length) throw new Error('path does not end at a head');
        return { parentCut: true, node: rest };
      }
      const r = rec(e, d + 1);
      if (r.parentCut) return { parentCut: false, node: fromTerms(rest.concat([[r.node, N + 1n]])) };
      return { parentCut: false, node: fromTerms(rest.concat([[r.node, 1n]])) };
    }
    if (!path.length) throw new Error('empty path');
    return rec(a, 0).node;
  }

  function leafPaths(a) {
    const out = [];
    (function rec(node, pre) {
      for (let i = 0; i < node.length; i++) {
        if (!node[i][0].length) out.push(pre.concat([i]));
        else rec(node[i][0], pre.concat([i]));
      }
    })(a, []);
    return out;
  }

  function cnfHeads(a) {
    let s = 0n;
    for (const [e, c] of a) s += c * (e.length ? cnfHeads(e) : 1n);
    return s;
  }

  function cnfNodes(a) {
    let s = 0n;
    for (const [e, c] of a) s += c * (1n + cnfNodes(e));
    return s;
  }

  function cnfDepth(a) {
    let d = 0;
    for (const [e] of a) d = Math.max(d, 1 + cnfDepth(e));
    return d;
  }

  // "Slow way": always cut in the smallest part (the last term, all the way down).
  function smallestPath(a) {
    const p = [];
    let node = a;
    while (node.length) {
      p.push(node.length - 1);
      node = node[node.length - 1][0];
    }
    return p;
  }

  // "Fast way": always cut in the biggest part (the first term, all the way down).
  function largestPath(a) {
    const p = [];
    let node = a;
    while (node.length) {
      p.push(0);
      node = node[0][0];
    }
    return p;
  }

  function play(a, pick, n0, limit) {
    let n = big(n0 || 1);
    const start = n;
    const lim = big(limit || 1000000);
    let x = a;
    while (x.length) {
      if (n - start >= lim) return null;
      x = cnfCut(x, pick(x), n);
      n++;
    }
    return n - start;
  }

  /* ================================================================== */
  /* Hardy functions: the slow way on a hydra reading a, starting at cut */
  /* 1, ends after exactly H_a(2) - 2 cuts, where H_0(n) = n and         */
  /* H_a(n) = H_{a[n]}(n+1). Exact values only while they stay small.    */
  /* ================================================================== */

  // Budgets keep every search bounded: a count of steps, a size for numbers, and
  // optionally a wall-clock deadline (the page uses one; the tests do not).
  function budget(opts, work, bits) {
    const o = opts || {};
    const maxBits = o.bits || bits;
    return { work: 0, maxWork: o.work || work, maxBits, limit: 1n << BigInt(maxBits), deadline: o.ms ? Date.now() + o.ms : Infinity };
  }

  const TOO_BIG = { tooBig: true };

  function spend(B) {
    if (++B.work > B.maxWork) throw TOO_BIG;
    if ((B.work & 63) === 0 && Date.now() > B.deadline) throw TOO_BIG;
  }

  function guard(x, B) {
    spend(B);
    if (x >= B.limit) throw TOO_BIG;
    return x;
  }

  function hardy(a, n, opts) {
    const B = opts && opts.maxWork ? opts : budget(opts, 200000, 20000);
    try {
      return hardySum(a, big(n), B);
    } catch (e) {
      if (e === TOO_BIG) return null;
      throw e;
    }
  }

  // H_{g + d}(x) = H_g(H_d(x)) when g + d is in normal form, so apply terms smallest first.
  function hardySum(a, x, B) {
    for (let i = a.length - 1; i >= 0; i--) {
      const [e, c] = a[i];
      if (!e.length) x = guard(x + c, B);
      else if (cmp(e, ONE) === 0) {
        if (c > BigInt(B.maxBits)) throw TOO_BIG;
        x = guard((1n << c) * (x + 1n) - 1n, B);
      } else {
        if (c > BigInt(B.maxWork)) throw TOO_BIG;
        for (let k = 0n; k < c; k++) x = hardyPow(e, x, B, 0);
      }
    }
    return x;
  }

  // H_{w^e}(x). Limits are unwound in a loop; successors nest, and deep nesting means
  // the answer is far too big to write down anyway.
  function hardyPow(e, x, B, depth) {
    if (depth > 400) throw TOO_BIG;
    for (;;) {
      guard(x, B);
      if (!e.length) return guard(x + 1n, B);
      if (cmp(e, ONE) === 0) return guard(2n * x + 1n, B);
      if (isFinite(e) && finiteValue(e) === 2n) {
        if (x > BigInt(B.maxBits)) throw TOO_BIG;
        return guard((1n << x) * (x + 2n) - 1n, B);
      }
      if (isSuccessor(e)) {
        // H_{w^(b+1)}(x) = H_{w^b * x}(x+1)
        if (x > BigInt(B.maxWork)) throw TOO_BIG;
        const b = fs(e, 0n);
        let y = x + 1n;
        for (let k = 0n; k < x; k++) y = hardyPow(b, y, B, depth + 1);
        return y;
      }
      if (e.length > 64) throw TOO_BIG; // the exponent itself has become unwieldy
      e = fs(e, x); // H_{w^L}(x) = H_{w^(L[x])}(x+1)
      x = x + 1n;
    }
  }

  /*
   * A floor under the slow way when the exact count is out of reach. Uses only:
   *  (1) H_a(x) > x for a > 0, so H_{g+d}(x) = H_g(H_d(x)) >= H_d(x) and H^k >= H;
   *  (2) H_{w^(b+1)}(x) = H_{w^b}^x(x+1) >= H_{w^b}(x+1);
   *  (3) H_{w^L}(x) = H_{w^(L[x])}(x+1) for limit L;
   *  (4) H_{w^3}(x) >= 2^^(x+1) and H_{w^4}(x) >= 2^^^(x+1) (Knuth arrows), from
   *      H_{w^2}(x) = 2^x (x+2) - 1 >= 2^x by iterating (2).
   * Terms are evaluated exactly from the smallest up while that is possible; the first
   * one that is not is bounded below by walking its exponent down to 3 or 4.
   */
  function slowFloor(a, n0, opts) {
    const o = opts || {};
    let x = big(n0 || 2);
    for (let i = a.length - 1; i >= 0; i--) {
      const [e, c] = a[i];
      for (let k = 0n; k < c; k++) {
        const one = hardy([[e, 1n]], x, { work: 50000, bits: 4000, ms: o.ms });
        if (one !== null) {
          x = one;
          continue;
        }
        return floorPow(e, x, o);
      }
    }
    return { kind: 'exact', value: x };
  }

  // A floor under H_{w^e}(x), dropping every copy and term still to come (allowed by (1)).
  function floorPow(e, x, opts) {
    const deadline = opts && opts.ms ? Date.now() + opts.ms : Infinity;
    let b = e;
    let m = x;
    let steps = 0;
    const chain = [{ exponent: str(b), at: m }];
    while (!isFinite(b) || finiteValue(b) > 4n) {
      if (++steps > 20000 || b.length > 64 || ((steps & 63) === 0 && Date.now() > deadline)) return { kind: 'unknown' };
      if (isFinite(b)) {
        m += finiteValue(b) - 4n; // (2), once per step down from w^k to w^4
        b = nat(4);
      } else {
        b = isSuccessor(b) ? fs(b, 0n) : fs(b, m); // (2) or (3)
        m += 1n;
      }
      if (chain.length < 64) chain.push({ exponent: str(b), at: m });
    }
    const k = finiteValue(b);
    if (k === 4n) return { kind: 'floor', arrows: 3, height: m + 1n, chain };
    if (k === 3n) return { kind: 'floor', arrows: 2, height: m + 1n, chain };
    if (k === 2n) return { kind: 'floor', arrows: 1, height: m, chain }; // H_{w^2}(m) >= 2^m
    return { kind: 'unknown' };
  }

  function slowWay(a, opts) {
    const o = opts || {};
    if (!a.length) return { kind: 'exact', value: 0n };
    const h = hardy(a, 2n, { work: 400000, bits: 60000, ms: o.ms });
    if (h !== null) return { kind: 'exact', value: h - 2n };
    const f = slowFloor(a, 2n, o);
    if (f.kind === 'exact') return { kind: 'exact', value: f.value - 2n };
    return f;
  }

  /*
   * The fast way, counted in batches. While the biggest part is w^m * c with m finite,
   * the next c cuts each turn one copy into (s+1) copies of w^(m-1), at cuts s = n ... n+c-1.
   * A biggest part with an infinite exponent is cut one copy at a time.
   */
  const FAST_LIMIT = 1n << 300000n; // stop before the numbers outgrow memory

  function fastWay(a, n0, maxWork, ms) {
    let n = big(n0 || 1);
    let x = a;
    let count = 0n;
    let work = 0;
    const cap = maxWork || 200000;
    const deadline = ms ? Date.now() + ms : Infinity;
    while (x.length) {
      if (++work > cap || ((work & 63) === 0 && Date.now() > deadline)) return { kind: 'atLeast', value: count };
      const [b, c] = x[0];
      const rest = x.slice(1);
      if (!b.length) {
        count += c;
        n += c;
        x = rest;
      } else if (isFinite(b)) {
        if (c > FAST_LIMIT || n > FAST_LIMIT) return { kind: 'atLeast', value: count + c };
        const made = c * (n + 1n) + (c * (c - 1n)) / 2n;
        count += c;
        n += c;
        x = fromTerms(rest.concat([[nat(finiteValue(b) - 1n), made]]));
      } else {
        const smaller = cnfCut(b, largestPath(b), n);
        const keep = c > 1n ? [[b, c - 1n]] : [];
        x = fromTerms(keep.concat(rest, [[smaller, 1n]]));
        count += 1n;
        n += 1n;
      }
    }
    return { kind: 'exact', value: count };
  }

  /* ---------- exhaustive search over every order of cuts (small hydras only) ---------- */

  // Remaining cuts are at least sum over non-root nodes of n^(depth-1): cutting a head at
  // depth d >= 2 removes n^(d-1) but regrows at least n copies worth n^(d-2) each.
  function potential(a, n) {
    const N = big(n);
    function rec(node, w) {
      let s = 0n;
      for (const [e, c] of node) s += c * (w + rec(e, w * N));
      return s;
    }
    return rec(a, 1n);
  }

  const MAX_SEARCH_DEPTH = 4000;

  function fewestCuts(a, n0, maxVisits, ms) {
    const memo = new Map();
    let visits = 0;
    const cap = maxVisits || 200000;
    const deadline = ms ? Date.now() + ms : Infinity;
    const TOO = {};
    const n00 = big(n0 || 1);
    function rec(x, n, budget) {
      if (!x.length) return 0n;
      if (n - n00 > BigInt(MAX_SEARCH_DEPTH)) throw TOO;
      const k = str(x) + '@' + n;
      const m = memo.get(k);
      if (m && m.exact) return m.v;
      let lb = potential(x, n);
      if (m && m.v > lb) lb = m.v;
      if (lb >= budget) return lb;
      if (++visits > cap || ((visits & 63) === 0 && Date.now() > deadline)) throw TOO;
      let best = -1n;
      for (const p of leafPaths(x)) {
        const lim = best >= 0n && best < budget ? best : budget;
        const v = 1n + rec(cnfCut(x, p, n), n + 1n, lim - 1n);
        if (best < 0n || v < best) best = v;
      }
      if (best < budget) memo.set(k, { exact: true, v: best });
      else memo.set(k, { exact: false, v: lb > budget ? lb : budget });
      return best;
    }
    const fw = fastWay(a, n0, 5000, ms);
    if (fw.kind !== 'exact' || fw.value > BigInt(MAX_SEARCH_DEPTH)) return null;
    try {
      return rec(a, big(n0 || 1), fw.value + 1n);
    } catch (e) {
      if (e === TOO) return null;
      throw e;
    }
  }

  function mostCuts(a, n0, maxVisits, ms) {
    const memo = new Map();
    let visits = 0;
    const cap = maxVisits || 200000;
    const deadline = ms ? Date.now() + ms : Infinity;
    const TOO = {};
    const n00 = big(n0 || 1);
    function rec(x, n) {
      if (!x.length) return 0n;
      if (n - n00 > BigInt(MAX_SEARCH_DEPTH)) throw TOO;
      const k = str(x) + '@' + n;
      const m = memo.get(k);
      if (m !== undefined) return m;
      if (++visits > cap || ((visits & 63) === 0 && Date.now() > deadline)) throw TOO;
      let best = 0n;
      for (const p of leafPaths(x)) {
        const v = 1n + rec(cnfCut(x, p, n), n + 1n);
        if (v > best) best = v;
      }
      memo.set(k, best);
      return best;
    }
    try {
      return rec(a, big(n0 || 1));
    } catch (e) {
      if (e === TOO) return null;
      throw e;
    }
  }

  /* ================================================================== */
  /* Display trees: ordered necks, each group = several identical copies. */
  /* Every drawn joint has a stable key, so the page can animate a cut:   */
  /* the neck that lost its head keeps its key; the regrown copies are    */
  /* new and marked fresh.                                                */
  /* ================================================================== */

  let nextId = 1;
  const LEAF = Object.freeze({ g: Object.freeze([]) });

  function group(t, m, id, off, fresh) {
    return { t, m: big(m), id: id === undefined ? nextId++ : id, off: off === undefined ? 0n : big(off), fresh: fresh || 0 };
  }

  function node(groups) {
    return { g: groups };
  }

  function fromSpec(spec) {
    if (!spec.length) return LEAF;
    return node(spec.map((c) => group(fromSpec(c), 1n)));
  }

  function fromOrdinal(a) {
    if (!a.length) return LEAF;
    return node(a.map(([e, c]) => group(fromOrdinal(e), c)));
  }

  const ordMemo = new WeakMap();
  function ordinalOf(t) {
    if (!t.g.length) return ZERO;
    let o = ordMemo.get(t);
    if (!o) {
      o = fromTerms(t.g.map((gr) => [ordinalOf(gr.t), gr.m]));
      ordMemo.set(t, o);
    }
    return o;
  }

  const headMemo = new WeakMap();
  function headsBelow(t) {
    if (!t.g.length) return 1n;
    let h = headMemo.get(t);
    if (h === undefined) {
      h = 0n;
      for (const gr of t.g) h += gr.m * headsBelow(gr.t);
      headMemo.set(t, h);
    }
    return h;
  }

  function heads(body) {
    return body.g.length ? headsBelow(body) : 0n;
  }

  function countNodes(t) {
    let s = 0n;
    for (const gr of t.g) s += gr.m * (1n + countNodes(gr.t));
    return s;
  }

  function depthOf(t) {
    let d = 0;
    for (const gr of t.g) d = Math.max(d, 1 + depthOf(gr.t));
    return d;
  }

  // Replace copy j of group i of t by the groups in `insert`.
  function replaceCopy(t, i, j, insert) {
    const gr = t.g[i];
    const J = big(j);
    if (J < 0n || J >= gr.m) throw new Error('bad copy index');
    const out = t.g.slice(0, i);
    if (J > 0n) out.push(group(gr.t, J, gr.id, gr.off, gr.fresh));
    for (const x of insert) if (x.m > 0n) out.push(x);
    if (gr.m - 1n - J > 0n) out.push(group(gr.t, gr.m - 1n - J, gr.id, gr.off + J + 1n, gr.fresh));
    for (let k = i + 1; k < t.g.length; k++) out.push(t.g[k]);
    return node(out);
  }

  function chainOf(body, path) {
    const chain = [body];
    for (let d = 0; d < path.length; d++) {
      const t = chain[d];
      if (!t.g[path[d]]) throw new Error('bad path');
      chain.push(t.g[path[d]].t);
    }
    return chain;
  }

  // Rebuild the ancestors of a changed copy; the changed copy keeps its key.
  function rebuild(chain, path, copies, depth, replacement) {
    let cur = replacement;
    for (let d = depth; d >= 0; d--) {
      const gr = chain[d].g[path[d]];
      cur = replaceCopy(chain[d], path[d], copies[d], [group(cur, 1n, gr.id, gr.off + big(copies[d]), gr.fresh)]);
    }
    return cur;
  }

  /*
   * Cut the head at `path` (group indices from the body) / `copies` (which copy in each
   * group) on cut number n. Returns the new body and what happened.
   */
  function cut(body, path, copies, n, stamp) {
    const N = big(n);
    const chain = chainOf(body, path);
    const k = path.length - 1;
    if (k < 0) throw new Error('empty path');
    if (chain[k + 1].g.length) throw new Error('that is a joint, not a head');
    const parent = replaceCopy(chain[k], path[k], copies[k], []);
    if (k === 0) return { body: parent, grew: 0n, depth: k + 1, parentAfter: ordinalOf(parent) };
    const pg = chain[k - 1].g[path[k - 1]];
    const j = big(copies[k - 1]);
    const regrow = [group(parent, 1n, pg.id, pg.off + j, pg.fresh)];
    if (N > 0n) regrow.push(group(parent, N, undefined, 0n, stamp || 0));
    const g2 = replaceCopy(chain[k - 1], path[k - 1], j, regrow);
    const newBody = k - 2 >= 0 ? rebuild(chain, path, copies, k - 2, g2) : g2;
    return { body: newBody, grew: N, depth: k + 1, parentAfter: ordinalOf(parent) };
  }

  // Grow a new head on the joint (or head, or body) at `path` / `copies`.
  function sprout(body, path, copies, stamp) {
    const chain = chainOf(body, path);
    const target = chain[chain.length - 1];
    const grown = node(target.g.concat([group(LEAF, 1n, undefined, 0n, stamp || 0)]));
    if (!path.length) return grown;
    return rebuild(chain, path, copies, path.length - 1, grown);
  }

  // Which head the slow / fast way would cut, on a display tree.
  function pick(body, which) {
    const path = [];
    const copies = [];
    let t = body;
    while (t.g.length) {
      let best = 0;
      for (let i = 1; i < t.g.length; i++) {
        const c = cmp(ordinalOf(t.g[i].t), ordinalOf(t.g[best].t));
        if (which === 'slow' ? c <= 0 : c > 0) best = i;
      }
      path.push(best);
      copies.push(which === 'slow' ? t.g[best].m - 1n : 0n);
      t = t.g[best].t;
    }
    return { path, copies };
  }

  /* ================================================================== */
  /* Layout: where every drawn joint and head goes.                      */
  /* ================================================================== */

  function layout(body, opts) {
    const o = Object.assign({ width: 360, height: 360, padX: 16, padTop: 26, padBottom: 44, minSlot: 18, maxLevel: 120 }, opts || {});
    const usable = Math.max(40, o.width - 2 * o.padX);
    const maxSlots = Math.max(1, Math.floor(usable / o.minSlot));
    const caps = [Infinity, 12, 8, 5, 3, 2, 1];
    let cap = 1;
    let visible = 0;
    for (const c of caps) {
      visible = countVisible(body, c);
      cap = c;
      if (visible <= maxSlots) break;
    }
    const slots = Math.max(1, visible);
    const slot = usable / slots;
    const depth = Math.max(1, depthOf(body));
    const rootY = o.height - o.padBottom;
    const level = Math.min(o.maxLevel, (rootY - o.padTop) / depth);
    const items = [];
    let slotIx = 0;
    const rootItem = { key: 'r', kind: 'body', x: o.width / 2, y: rootY, depth: 0, path: [], copies: [], parentKey: null, fresh: false, badge: null, value: ordinalOf(body) };
    items.push(rootItem);
    // A drawn copy of t; `fresh` is the stamp of the cut that grew it (inherited downwards).
    function place(t, key, depthHere, path, copies, parentKey, fresh) {
      const item = { key, kind: t.g.length ? 'joint' : 'head', x: 0, y: rootY - depthHere * level, depth: depthHere, path, copies, parentKey, fresh, badge: null };
      items.push(item);
      if (!t.g.length) {
        item.x = o.padX + (slotIx + 0.5) * slot;
        slotIx++;
        return item;
      }
      const kids = placeChildren(t, key, depthHere, path, copies, fresh);
      item.x = (kids[0].x + kids[kids.length - 1].x) / 2;
      return item;
    }
    function placeChildren(t, key, depthHere, path, copies, fresh) {
      const kids = [];
      t.g.forEach((gr, i) => {
        // A bundle of more than `cap` identical copies is drawn as `cap` of them plus a badge.
        const whole = !Number.isFinite(cap) || gr.m <= big(cap);
        const nDraw = whole ? Number(gr.m) : cap;
        for (let j = 0; j < nDraw; j++) {
          const copyIx = big(j);
          const ck = key + '/' + gr.id + '.' + (gr.off + copyIx);
          const it = place(gr.t, ck, depthHere + 1, path.concat([i]), copies.concat([copyIx]), key, gr.fresh || fresh);
          if (!whole && j === nDraw - 1) it.badge = gr.m;
          kids.push(it);
        }
      });
      return kids;
    }
    if (body.g.length) placeChildren(body, 'r', 0, [], [], 0);
    return { items, cap, slot, level, visible };
  }

  function countVisible(t, cap) {
    if (!t.g.length) return 1;
    let s = 0;
    for (const gr of t.g) {
      const draw = Number.isFinite(cap) && gr.m > big(cap) ? cap : Number(gr.m > 1000000n ? 1000000n : gr.m);
      s += draw * countVisible(gr.t, cap);
      if (s > 1e9) return Infinity;
    }
    return s;
  }

  /* ================================================================== */
  /* Presets. Every number in `claims` is checked by hydra.test.mjs.     */
  /* ================================================================== */

  const PRESETS = [
    { id: 'sprout', name: 'Sprout', spec: [[[]]], note: 'One neck, one head. Learn the rule.', claims: { fastest: 3n, slowest: 3n } },
    { id: 'fork', name: 'Fork', spec: [[[], []]], note: 'Two heads on one neck.', claims: { fastest: 10n, slowest: 13n } },
    { id: 'stick', name: 'Stick', spec: [[[[]]]], note: 'Three necks in a row. Killable by hand.', claims: { fastest: 20n, slowest: 37n } },
    { id: 'twosticks', name: 'Two sticks', spec: [[[[]]], [[[]]]], note: 'Just one more stick.', claims: { fastest: 988n, slowFloor: { arrows: 3, height: 76n } } },
    { id: 'tall', name: 'Tall stick', spec: [[[[[]]]]], note: 'Four necks in a row.', claims: { fastDigits: 13597, slowFloor: { arrows: 3, height: 36n } } },
  ];

  // The page's limits for a hydra you grow yourself.
  const GROW_LIMITS = { nodes: 24, depth: 6 };

  return {
    ZERO,
    ONE,
    OMEGA,
    cmp,
    fromTerms,
    nat,
    isFinite,
    finiteValue,
    isSuccessor,
    str,
    parse,
    fs,
    fmtBig,
    escape,
    html,
    plain,
    cnfCut,
    leafPaths,
    cnfHeads,
    cnfNodes,
    cnfDepth,
    smallestPath,
    largestPath,
    play,
    hardy,
    slowFloor,
    slowWay,
    fastWay,
    potential,
    fewestCuts,
    mostCuts,
    LEAF,
    fromSpec,
    fromOrdinal,
    ordinalOf,
    heads,
    countNodes,
    depthOf,
    cut,
    sprout,
    pick,
    layout,
    PRESETS,
    GROW_LIMITS,
  };
});
