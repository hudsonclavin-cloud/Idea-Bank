/* Hinge — the computational core.
 *
 * Pure functions, no DOM. The page loads this as a classic script (window.Hinge)
 * and the tests import it under Node (module.exports).
 *
 * A "case" is a list of rows (assumptions) and a list of options (formulas over
 * those assumptions). Each uncertain row is a probability distribution; the
 * options are evaluated by Monte Carlo over the joint distribution of the rows.
 * For each uncertain row the engine then asks: if you could learn this one
 * value before choosing, how often would the best option change, at which
 * values, and how much would that knowledge be worth? The definitions used are
 * spelled out next to each function and recapped in README.md.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Hinge = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const Z95 = 1.6448536269514722; // Φ⁻¹(0.95); a 90% interval is ±Z95 standard deviations
  const SQRT2PI = 2.5066282746310002;

  class HingeError extends Error {
    constructor(message, where) {
      super(message);
      this.where = where || null;
    }
  }

  // ------------------------------------------------------------ numbers

  const SUFFIX = { k: 1e3, K: 1e3, m: 1e6, M: 1e6, b: 1e9, B: 1e9, t: 1e12, T: 1e12 };
  const NUM_RE = /^(\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;

  /** Parse "160k", "1.5M", "25%", "-3", "1e6". Returns NaN when the text is not a number. */
  function parseNumber(text) {
    if (typeof text === 'number') return text;
    let s = String(text == null ? '' : text).trim().replace(/[,\s_]/g, '');
    if (!s) return NaN;
    let sign = 1;
    if (s[0] === '-' || s[0] === '−') { sign = -1; s = s.slice(1); }
    else if (s[0] === '+') s = s.slice(1);
    const m = NUM_RE.exec(s);
    if (!m) return NaN;
    let v = Number(m[0]);
    const rest = s.slice(m[0].length);
    if (rest === '') return sign * v;
    if (rest === '%') return sign * v / 100;
    if (rest.length === 1 && SUFFIX[rest]) return sign * v * SUFFIX[rest];
    return NaN;
  }

  const CURRENCY = new Set(['$', '€', '£', '¥', '₹', 'US$', 'CA$', 'A$', 'CHF ', 'kr ']);

  /** Compact formatting with 3 significant figures and k / M / B suffixes. */
  function fmt(x, unit, opts) {
    if (x == null || !Number.isFinite(x)) return '—';
    if (opts && opts.pct) return (x < 0 ? '−' : '') + String(+(Math.abs(x) * 100).toPrecision(3)) + '%';
    const neg = x < 0;
    let a = Math.abs(x);
    let body;
    if (a === 0) body = '0';
    else {
      const tiers = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'k']];
      body = null;
      for (const [div, suf] of tiers) {
        if (a >= div * 0.9995) {
          let mant = +(a / div).toPrecision(3);
          if (mant >= 1000) { mant = 1; body = `1${tiers[tiers.indexOf(tiers.find((t) => t[0] === div)) - 1]?.[1] || 'T'}`; break; }
          body = `${+mant.toPrecision(3)}${suf}`;
          break;
        }
      }
      if (body === null) body = String(+a.toPrecision(3));
    }
    let out = body;
    if (unit) {
      const u = String(unit);
      if (CURRENCY.has(u) || /^[^\w\s]{1,3}$/.test(u)) out = u + body;
      else out = `${body} ${u}`;
    }
    return (neg ? '−' : '') + out;
  }

  function fmtPct(p, signed) {
    if (p == null || !Number.isFinite(p)) return '—';
    const neg = p < 0;
    const a = Math.abs(p) * 100;
    let s;
    if (a === 0) s = '0%';
    else if (a < 0.1) s = '<0.1%';
    else if (a < 10) s = `${+a.toFixed(1)}%`;
    else if (a > 99.5 && a < 100) s = '>99.5%';
    else s = `${Math.round(a)}%`;
    return (neg && signed ? '−' : '') + s;
  }

  /** Turn free text into a usable identifier: "Exit value ($)" → "exit_value". */
  function toIdent(text) {
    let s = String(text || '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').replace(/_+/g, '_');
    if (!s) return '';
    if (/^[0-9]/.test(s)) s = '_' + s;
    if (KEYWORDS.has(s) || FUNCTIONS[s]) s += '_';
    return s;
  }

  // ------------------------------------------------------------ normal distribution

  /** Φ(x): Hart's algorithm as given by West (2005), accurate to ~1e-14. */
  function normCdf(x) {
    const z = Math.abs(x);
    let c;
    if (z > 37) c = 0;
    else {
      const e = Math.exp(-z * z / 2);
      if (z < 7.07106781186547) {
        let n = 0.0352624965998911 * z + 0.700383064443688;
        n = n * z + 6.37396220353165;
        n = n * z + 33.912866078383;
        n = n * z + 112.079291497871;
        n = n * z + 221.213596169931;
        n = n * z + 220.206867912376;
        n *= e;
        let d = 0.0883883476483184 * z + 1.75566716318264;
        d = d * z + 16.064177579207;
        d = d * z + 86.7807322029461;
        d = d * z + 296.564248779674;
        d = d * z + 637.333633378831;
        d = d * z + 793.826512519948;
        d = d * z + 440.413735824752;
        c = n / d;
      } else {
        const n = e / (z + 1 / (z + 2 / (z + 3 / (z + 4 / (z + 0.65)))));
        c = n / SQRT2PI;
      }
    }
    return x > 0 ? 1 - c : c;
  }

  function normPdf(x) {
    return Math.exp(-x * x / 2) / SQRT2PI;
  }

  /** Φ⁻¹(p): Wichura's algorithm AS241 (PPND16), accurate to ~1e-16. */
  function normQuantile(p) {
    if (!(p > 0 && p < 1)) {
      if (p === 0) return -Infinity;
      if (p === 1) return Infinity;
      return NaN;
    }
    const q = p - 0.5;
    if (Math.abs(q) <= 0.425) {
      const r = 0.180625 - q * q;
      return q * (((((((2509.0809287301226727 * r + 33430.575583588128105) * r + 67265.770927008700853) * r + 45921.953931549871457) * r + 13731.693765509461125) * r + 1971.5909503065514427) * r + 133.14166789178437745) * r + 3.387132872796366608)
        / (((((((5226.495278852545925 * r + 28729.085735721942674) * r + 39307.89580009271061) * r + 21213.794301586595867) * r + 5394.1960214247511077) * r + 687.1870074920579083) * r + 42.313330701600911252) * r + 1);
    }
    let r = q < 0 ? p : 1 - p;
    r = Math.sqrt(-Math.log(r));
    let val;
    if (r <= 5) {
      r -= 1.6;
      val = (((((((7.7454501427834140764e-4 * r + 0.0227238449892691845833) * r + 0.24178072517745061177) * r + 1.27045825245236838258) * r + 3.64784832476320460504) * r + 5.7694972214606914055) * r + 4.6303378461565452959) * r + 1.42343711074968357734)
        / (((((((1.05075007164441684324e-9 * r + 5.475938084995344946e-4) * r + 0.0151986665636164571966) * r + 0.14810397642748007459) * r + 0.68976733498510000455) * r + 1.6763848301838038494) * r + 2.05319162663775882187) * r + 1);
    } else {
      r -= 5;
      val = (((((((2.01033439929228813265e-7 * r + 2.71155556874348757815e-5) * r + 0.0012426609473880784386) * r + 0.026532189526576123093) * r + 0.29656057182850489123) * r + 1.7848265399172913358) * r + 5.4637849111641143699) * r + 6.6579046435011037772)
        / (((((((2.04426310338993978564e-15 * r + 1.4215117583164458887e-7) * r + 1.8463183175100546818e-5) * r + 7.868691311456132591e-4) * r + 0.0148753612908506148525) * r + 0.13692988092273580531) * r + 0.59983220655588793769) * r + 1);
    }
    return q < 0 ? -val : val;
  }

  // ------------------------------------------------------------ distributions

  /**
   * A "range" row is a 90% interval [lo, hi]. Shape 'auto' is lognormal when
   * lo > 0 (quantities that cannot go negative and are known to within a factor)
   * and normal otherwise. 'uniform' treats lo and hi as hard limits instead.
   */
  function rangeShape(lo, hi, shape) {
    if (shape === 'lognormal' || shape === 'normal' || shape === 'uniform') return shape;
    return lo > 0 ? 'lognormal' : 'normal';
  }

  function makeDist(row) {
    if (row.kind === 'chance') {
      const p = row.p;
      return {
        type: 'bernoulli', p,
        quantile: (u) => (u < 1 - p ? 0 : 1),
        cdf: (x) => (x < 0 ? 0 : x < 1 ? 1 - p : 1),
        pdf: () => 0,
        median: p > 0.5 ? 1 : 0,
        mean: p,
      };
    }
    if (row.kind === 'fixed') {
      const v = row.value;
      return { type: 'fixed', quantile: () => v, cdf: (x) => (x < v ? 0 : 1), pdf: () => 0, median: v, mean: v };
    }
    const lo = row.lo, hi = row.hi;
    const shape = rangeShape(lo, hi, row.shape);
    if (shape === 'uniform') {
      const w = hi - lo;
      return {
        type: 'uniform', lo, hi,
        quantile: (u) => lo + u * w,
        cdf: (x) => (x <= lo ? 0 : x >= hi ? 1 : (x - lo) / w),
        pdf: (x) => (x < lo || x > hi ? 0 : 1 / w),
        median: lo + w / 2,
        mean: lo + w / 2,
      };
    }
    if (shape === 'lognormal') {
      const mu = (Math.log(lo) + Math.log(hi)) / 2;
      const sigma = (Math.log(hi) - Math.log(lo)) / (2 * Z95);
      return {
        type: 'lognormal', mu, sigma,
        quantile: (u) => Math.exp(mu + sigma * normQuantile(u)),
        cdf: (x) => (x <= 0 ? 0 : normCdf((Math.log(x) - mu) / sigma)),
        pdf: (x) => (x <= 0 ? 0 : normPdf((Math.log(x) - mu) / sigma) / (x * sigma)),
        median: Math.exp(mu),
        mean: Math.exp(mu + sigma * sigma / 2),
      };
    }
    const mu = (lo + hi) / 2;
    const sigma = (hi - lo) / (2 * Z95);
    return {
      type: 'normal', mu, sigma,
      quantile: (u) => mu + sigma * normQuantile(u),
      cdf: (x) => normCdf((x - mu) / sigma),
      pdf: (x) => normPdf((x - mu) / sigma) / sigma,
      median: mu,
      mean: mu,
    };
  }

  // ------------------------------------------------------------ expressions

  const KEYWORDS = new Set(['and', 'or', 'not']);

  // name → [arity (or -1 for 1+), implementation]
  const FUNCTIONS = {
    min: [-1, (...a) => Math.min(...a)],
    max: [-1, (...a) => Math.max(...a)],
    abs: [1, Math.abs],
    sqrt: [1, Math.sqrt],
    ln: [1, Math.log],
    log: [1, Math.log],
    log10: [1, Math.log10],
    log2: [1, Math.log2],
    exp: [1, Math.exp],
    round: [1, Math.round],
    floor: [1, Math.floor],
    ceil: [1, Math.ceil],
    pow: [2, Math.pow],
    clamp: [3, (x, lo, hi) => Math.min(hi, Math.max(lo, x))],
    if: [3, null], // lazy; handled in compile
  };

  function tokenize(src) {
    const toks = [];
    let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      if (/[0-9.]/.test(c)) {
        const m = NUM_RE.exec(src.slice(i));
        if (!m || m[0] === '.') throw new HingeError(`Bad number at position ${i + 1}`, i);
        let text = m[0];
        let value = Number(text);
        let j = i + text.length;
        const nxt = src[j];
        if (nxt === '%') { value /= 100; j++; }
        else if (nxt && SUFFIX[nxt] && !/[A-Za-z0-9_]/.test(src[j + 1] || '')) { value *= SUFFIX[nxt]; j++; }
        if (/[A-Za-z_]/.test(src[j] || '')) throw new HingeError(`Unexpected "${src[j]}" right after the number at position ${i + 1} (missing an operator?)`, j);
        toks.push({ t: 'num', v: value, pos: i });
        i = j;
        continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
        toks.push({ t: KEYWORDS.has(m[0]) ? m[0] : 'id', v: m[0], pos: i });
        i += m[0].length;
        continue;
      }
      const two = src.slice(i, i + 2);
      if (['<=', '>=', '==', '!=', '<>'].includes(two)) { toks.push({ t: 'op', v: two === '<>' ? '!=' : two, pos: i }); i += 2; continue; }
      if ('+-*/^(),<>='.includes(c)) { toks.push({ t: 'op', v: c === '=' ? '==' : c, pos: i }); i++; continue; }
      if (c === '−') { toks.push({ t: 'op', v: '-', pos: i }); i++; continue; }
      if (c === '×') { toks.push({ t: 'op', v: '*', pos: i }); i++; continue; }
      if (c === '÷') { toks.push({ t: 'op', v: '/', pos: i }); i++; continue; }
      throw new HingeError(`Unexpected character "${c}" at position ${i + 1}`, i);
    }
    toks.push({ t: 'end', pos: src.length });
    return toks;
  }

  /** Parse an expression into an AST. Grammar (low → high precedence):
   *  or · and · not · comparison · + - · * / · unary - · ^ (right-assoc) · atoms. */
  function parse(src) {
    const toks = tokenize(String(src));
    let k = 0;
    const peek = () => toks[k];
    const next = () => toks[k++];
    const isOp = (v) => peek().t === 'op' && peek().v === v;
    const expect = (v) => {
      if (!isOp(v)) throw new HingeError(`Expected "${v}" at position ${peek().pos + 1}`, peek().pos);
      next();
    };
    function orExpr() {
      let l = andExpr();
      while (peek().t === 'or') { next(); l = { k: 'bin', op: 'or', l, r: andExpr() }; }
      return l;
    }
    function andExpr() {
      let l = notExpr();
      while (peek().t === 'and') { next(); l = { k: 'bin', op: 'and', l, r: notExpr() }; }
      return l;
    }
    function notExpr() {
      if (peek().t === 'not') { next(); return { k: 'un', op: 'not', a: notExpr() }; }
      return cmpExpr();
    }
    function cmpExpr() {
      const l = addExpr();
      if (peek().t === 'op' && ['<', '>', '<=', '>=', '==', '!='].includes(peek().v)) {
        const op = next().v;
        return { k: 'bin', op, l, r: addExpr() };
      }
      return l;
    }
    function addExpr() {
      let l = mulExpr();
      while (isOp('+') || isOp('-')) { const op = next().v; l = { k: 'bin', op, l, r: mulExpr() }; }
      return l;
    }
    function mulExpr() {
      let l = unary();
      while (isOp('*') || isOp('/')) { const op = next().v; l = { k: 'bin', op, l, r: unary() }; }
      return l;
    }
    function unary() {
      if (isOp('-')) { next(); return { k: 'un', op: 'neg', a: unary() }; }
      if (isOp('+')) { next(); return unary(); }
      return power();
    }
    function power() {
      const base = atom();
      if (isOp('^')) { next(); return { k: 'bin', op: '^', l: base, r: unary() }; }
      return base;
    }
    function atom() {
      const t = peek();
      if (t.t === 'num') { next(); return { k: 'num', v: t.v }; }
      if (t.t === 'id') {
        next();
        if (isOp('(')) {
          next();
          const args = [];
          if (!isOp(')')) {
            args.push(orExpr());
            while (isOp(',')) { next(); args.push(orExpr()); }
          }
          expect(')');
          const f = FUNCTIONS[t.v];
          if (!f) throw new HingeError(`Unknown function "${t.v}"`, t.pos);
          if (f[0] === -1 ? args.length < 1 : args.length !== f[0]) {
            throw new HingeError(`${t.v}() takes ${f[0] === -1 ? 'at least 1 argument' : `${f[0]} argument${f[0] === 1 ? '' : 's'}`}`, t.pos);
          }
          return { k: 'call', f: t.v, args };
        }
        if (FUNCTIONS[t.v]) throw new HingeError(`"${t.v}" is a function; write ${t.v}(…)`, t.pos);
        return { k: 'var', name: t.v, pos: t.pos };
      }
      if (isOp('(')) { next(); const e = orExpr(); expect(')'); return e; }
      if (t.t === 'end') throw new HingeError(src.trim() ? 'The formula ends too early' : 'Empty formula', t.pos);
      throw new HingeError(`Unexpected "${t.v}" at position ${t.pos + 1}`, t.pos);
    }
    const ast = orExpr();
    if (peek().t !== 'end') throw new HingeError(`Unexpected "${peek().v}" at position ${peek().pos + 1}`, peek().pos);
    return ast;
  }

  function astVars(ast, out) {
    out = out || new Set();
    switch (ast.k) {
      case 'var': out.add(ast.name); break;
      case 'bin': astVars(ast.l, out); astVars(ast.r, out); break;
      case 'un': astVars(ast.a, out); break;
      case 'call': ast.args.forEach((a) => astVars(a, out)); break;
      default: break;
    }
    return out;
  }

  /** Compile an AST to a function (X, base) → number, where variable i is read at X[base + index(i)]. */
  function compile(ast, index) {
    switch (ast.k) {
      case 'num': { const v = ast.v; return () => v; }
      case 'var': {
        const i = index(ast.name);
        if (i == null) throw new HingeError(`Unknown name "${ast.name}"`, ast.pos);
        return (X, b) => X[b + i];
      }
      case 'un': {
        const a = compile(ast.a, index);
        if (ast.op === 'neg') return (X, b) => -a(X, b);
        return (X, b) => (a(X, b) ? 0 : 1);
      }
      case 'bin': {
        const l = compile(ast.l, index), r = compile(ast.r, index);
        switch (ast.op) {
          case '+': return (X, b) => l(X, b) + r(X, b);
          case '-': return (X, b) => l(X, b) - r(X, b);
          case '*': return (X, b) => l(X, b) * r(X, b);
          case '/': return (X, b) => l(X, b) / r(X, b);
          case '^': return (X, b) => Math.pow(l(X, b), r(X, b));
          case '<': return (X, b) => (l(X, b) < r(X, b) ? 1 : 0);
          case '>': return (X, b) => (l(X, b) > r(X, b) ? 1 : 0);
          case '<=': return (X, b) => (l(X, b) <= r(X, b) ? 1 : 0);
          case '>=': return (X, b) => (l(X, b) >= r(X, b) ? 1 : 0);
          case '==': return (X, b) => (l(X, b) === r(X, b) ? 1 : 0);
          case '!=': return (X, b) => (l(X, b) !== r(X, b) ? 1 : 0);
          case 'and': return (X, b) => (l(X, b) && r(X, b) ? 1 : 0);
          case 'or': return (X, b) => (l(X, b) || r(X, b) ? 1 : 0);
          default: throw new HingeError(`Bad operator ${ast.op}`);
        }
      }
      case 'call': {
        const args = ast.args.map((a) => compile(a, index));
        if (ast.f === 'if') {
          const [c, a, d] = args;
          return (X, b) => (c(X, b) ? a(X, b) : d(X, b));
        }
        const impl = FUNCTIONS[ast.f][1];
        if (args.length === 1) { const a = args[0]; return (X, b) => impl(a(X, b)); }
        if (args.length === 2) { const [a, c] = args; return (X, b) => impl(a(X, b), c(X, b)); }
        if (args.length === 3) { const [a, c, d] = args; return (X, b) => impl(a(X, b), c(X, b), d(X, b)); }
        return (X, b) => impl(...args.map((f) => f(X, b)));
      }
      default: throw new HingeError('Bad expression node');
    }
  }

  const JS_FUNCS = { min: 'Math.min', max: 'Math.max', abs: 'Math.abs', sqrt: 'Math.sqrt', ln: 'Math.log', log: 'Math.log', log10: 'Math.log10', log2: 'Math.log2', exp: 'Math.exp', round: 'Math.round', floor: 'Math.floor', ceil: 'Math.ceil', pow: 'Math.pow' };

  /** Emit JavaScript for an AST. Only numbers, whitelisted operators/functions and X[b+i] reads appear in the output. */
  function emitJS(ast, index) {
    switch (ast.k) {
      case 'num': return `(${Number(ast.v)})`;
      case 'var': {
        const i = index(ast.name);
        if (i == null) throw new HingeError(`Unknown name "${ast.name}"`, ast.pos);
        return `X[b+${i | 0}]`;
      }
      case 'un': return ast.op === 'neg' ? `(-${emitJS(ast.a, index)})` : `(${emitJS(ast.a, index)}?0:1)`;
      case 'bin': {
        const l = emitJS(ast.l, index), r = emitJS(ast.r, index);
        switch (ast.op) {
          case '+': case '-': case '*': case '/': return `(${l}${ast.op}${r})`;
          case '^': return `Math.pow(${l},${r})`;
          case '<': case '>': case '<=': case '>=': return `(${l}${ast.op}${r}?1:0)`;
          case '==': return `(${l}===${r}?1:0)`;
          case '!=': return `(${l}!==${r}?1:0)`;
          case 'and': return `(${l}&&${r}?1:0)`;
          case 'or': return `(${l}||${r}?1:0)`;
          default: throw new HingeError(`Bad operator ${ast.op}`);
        }
      }
      case 'call': {
        const a = ast.args.map((x) => emitJS(x, index));
        if (ast.f === 'if') return `(${a[0]}?${a[1]}:${a[2]})`;
        if (ast.f === 'clamp') return `Math.min(${a[2]},Math.max(${a[1]},${a[0]}))`;
        if (!JS_FUNCS[ast.f]) throw new HingeError(`Unknown function "${ast.f}"`);
        return `${JS_FUNCS[ast.f]}(${a.join(',')})`;
      }
      default: throw new HingeError('Bad expression node');
    }
  }

  /** Compile to a native function via the emitted source; falls back to closures where Function() is not allowed. */
  function compileFast(ast, index) {
    const slow = compile(ast, index); // validates names, and is the fallback
    try {
      const src = emitJS(ast, index);
      // eslint-disable-next-line no-new-func
      return new Function('X', 'b', `"use strict"; return ${src};`);
    } catch (e) {
      return slow;
    }
  }

  /** Evaluate a formula with a plain {name: value} environment (used by tests and quick checks). */
  function evalExpr(src, env) {
    const names = Object.keys(env || {});
    const X = Float64Array.from(names.map((n) => env[n]));
    return compile(parse(src), (n) => (names.indexOf(n) >= 0 ? names.indexOf(n) : null))(X, 0);
  }

  // ------------------------------------------------------------ the model

  const ROW_KINDS = ['range', 'chance', 'fixed', 'formula'];

  /**
   * Validate and compile a case. Returns { errors, compiled }. `errors` is a list
   * of { where: 'row'|'option'|'case', id, message }; compiled is null if any.
   */
  function compileModel(model) {
    const errors = [];
    const rows = Array.isArray(model.rows) ? model.rows : [];
    const options = Array.isArray(model.options) ? model.options : [];
    const names = new Map();
    const crow = [];

    rows.forEach((row, i) => {
      const name = typeof row.name === 'string' ? row.name.trim() : '';
      const err = (message) => errors.push({ where: 'row', id: row.id, index: i, message });
      if (!name) err('Give this assumption a name.');
      else if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) err(`"${name}" is not a usable name (letters, digits and _ only).`);
      else if (KEYWORDS.has(name) || FUNCTIONS[name]) err(`"${name}" is a reserved word; pick another name.`);
      else if (names.has(name)) err(`The name "${name}" is used twice.`);
      const kind = ROW_KINDS.includes(row.kind) ? row.kind : null;
      if (!kind) err('Unknown kind of assumption.');
      const c = { id: row.id, name, kind, index: i, dist: null, fn: null, deps: [] };
      if (kind === 'range') {
        const lo = Number(row.lo), hi = Number(row.hi);
        if (!Number.isFinite(lo) || !Number.isFinite(hi)) err('Give a low and a high value.');
        else if (lo > hi) err('The low value is above the high value.');
        else if (lo === hi) err('Low and high are equal; make this a fixed value instead.');
        else if (row.shape === 'lognormal' && lo <= 0) err('A lognormal range must be positive.');
        else c.dist = makeDist({ kind, lo, hi, shape: row.shape });
      } else if (kind === 'chance') {
        const p = Number(row.p);
        if (!Number.isFinite(p) || p < 0 || p > 1) err('Give a probability between 0 and 1 (or 0% and 100%).');
        else if (p === 0 || p === 1) err('A certainty is not a chance; make this a fixed value (0 or 1).');
        else c.dist = makeDist({ kind, p });
      } else if (kind === 'fixed') {
        const v = Number(row.value);
        if (!Number.isFinite(v)) err('Give a value.');
        else c.dist = makeDist({ kind, value: v });
      } else if (kind === 'formula') {
        if (!(row.expr || '').trim()) err('Empty formula.');
      }
      if (name && !names.has(name) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) names.set(name, i);
      crow.push(c);
    });
    // Second pass: formula rows may use any row, in any order, as long as there is no cycle.
    rows.forEach((row, i) => {
      if (row.kind !== 'formula' || errors.some((e) => e.where === 'row' && e.index === i)) return;
      const c = crow[i];
      try {
        const ast = parse(row.expr || '');
        const vars = [...astVars(ast)];
        const missing = vars.filter((v) => !names.has(v));
        if (missing.length) { errors.push({ where: 'row', id: row.id, index: i, message: `Unknown name${missing.length > 1 ? 's' : ''} ${missing.map((v) => `"${v}"`).join(', ')}.` }); return; }
        c.fn = compileFast(ast, (n) => names.get(n));
        c.deps = vars.map((v) => names.get(v));
      } catch (e) {
        errors.push({ where: 'row', id: row.id, index: i, message: e instanceof HingeError ? e.message : String(e.message || e) });
      }
    });
    // Evaluation order (Kahn's algorithm); a cycle is an error on every row in it.
    const order = [];
    {
      const indeg = crow.map((c) => (c.kind === 'formula' ? c.deps.filter((d) => crow[d].kind === 'formula').length : 0));
      const users = crow.map(() => []);
      crow.forEach((c) => { if (c.kind === 'formula') c.deps.forEach((d) => users[d].push(c.index)); });
      const queue = crow.filter((c) => c.kind !== 'formula').map((c) => c.index);
      crow.forEach((c) => { if (c.kind === 'formula' && indeg[c.index] === 0) queue.push(c.index); });
      const seen = new Set();
      while (queue.length) {
        const r = queue.shift();
        if (seen.has(r)) continue;
        seen.add(r);
        order.push(r);
        for (const u of users[r]) { indeg[u]--; if (indeg[u] === 0) queue.push(u); }
      }
      crow.forEach((c) => {
        if (c.kind === 'formula' && !seen.has(c.index) && !errors.some((e) => e.where === 'row' && e.index === c.index)) {
          errors.push({ where: 'row', id: c.id, index: c.index, message: 'This formula depends on itself (through other rows).' });
        }
      });
    }

    const copt = [];
    if (!options.length) errors.push({ where: 'case', message: 'Add at least one option (or one outcome formula).' });
    if (options.length > 4) errors.push({ where: 'case', message: 'At most four options.' });
    options.forEach((opt, j) => {
      const err = (message) => errors.push({ where: 'option', id: opt.id, index: j, message });
      const c = { id: opt.id, name: (opt.name || '').trim() || `Option ${j + 1}`, fn: null, deps: [] };
      try {
        const ast = parse(opt.expr || '');
        const vars = [...astVars(ast)];
        const idx = (n) => (names.has(n) ? names.get(n) : null);
        const missing = vars.filter((v) => !names.has(v));
        if (missing.length) err(`Unknown name${missing.length > 1 ? 's' : ''} ${missing.map((m) => `"${m}"`).join(', ')}.`);
        else { c.fn = compileFast(ast, idx); c.deps = vars.map(idx); }
      } catch (e) {
        err(e instanceof HingeError ? e.message : String(e.message || e));
      }
      copt.push(c);
    });

    const goal = model.goal === 'min' ? 'min' : 'max';
    const target = model.target == null || model.target === '' ? null : Number(model.target);
    if (target !== null && !Number.isFinite(target)) errors.push({ where: 'case', message: 'The target must be a number.' });

    if (errors.length) return { errors, compiled: null };

    // Transitive dependents: which formula rows and options change when row i changes.
    const nR = crow.length;
    const rowUsers = crow.map(() => []);
    crow.forEach((c) => c.deps.forEach((d) => rowUsers[d].push(c.index)));
    const optUsers = crow.map(() => []);
    copt.forEach((c, j) => c.deps.forEach((d) => optUsers[d].push(j)));
    const downstream = crow.map((c, i) => {
      const rowsSeen = new Set();
      const stack = [i];
      const opts = new Set();
      while (stack.length) {
        const r = stack.pop();
        optUsers[r].forEach((j) => opts.add(j));
        for (const u of rowUsers[r]) if (!rowsSeen.has(u)) { rowsSeen.add(u); stack.push(u); }
      }
      const pos = new Map(order.map((r, k) => [r, k]));
      return { rows: [...rowsSeen].sort((a, b) => pos.get(a) - pos.get(b)), opts: [...opts].sort((a, b) => a - b) };
    });

    return {
      errors: [],
      compiled: { rows: crow, options: copt, nRows: nR, goal, sign: goal === 'min' ? -1 : 1, target, downstream, names, order },
    };
  }

  // ------------------------------------------------------------ Monte Carlo

  /** mulberry32, seeded. */
  function rng(seed) {
    let a = (seed >>> 0) || 1;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** n uniforms, one in each of n equal strata, in random order (Latin hypercube column). */
  function stratifiedUniforms(n, rand) {
    const u = new Float64Array(n);
    for (let i = 0; i < n; i++) u[i] = (i + rand()) / n;
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = u[i]; u[i] = u[j]; u[j] = t;
    }
    return u;
  }

  /**
   * Draw n joint samples. Rows are independent; each sampled row gets its own
   * stratified uniform column (Latin hypercube sampling), so that each
   * 1/n-probability slice of every input is hit exactly once.
   * Returns X (n × nRows, row-major by sample) and F (one Float64Array per option).
   */
  function simulate(compiled, n, seed) {
    const { rows, options, nRows, order } = compiled;
    const rand = rng(seed);
    const U = rows.map((r) => (r.kind === 'range' || r.kind === 'chance' ? stratifiedUniforms(n, rand) : null));
    const X = new Float64Array(n * nRows);
    for (let k = 0; k < n; k++) {
      const b = k * nRows;
      for (const r of order) {
        const row = rows[r];
        X[b + r] = row.fn ? row.fn(X, b) : row.dist.quantile(U[r] ? U[r][k] : 0.5);
      }
    }
    const F = options.map((o) => {
      const f = new Float64Array(n);
      for (let k = 0; k < n; k++) f[k] = o.fn(X, k * nRows);
      return f;
    });
    return { n, seed, U, X, F };
  }

  function mean(a) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i];
    return s / a.length;
  }

  function variance(a) {
    const m = mean(a);
    let s = 0;
    for (let i = 0; i < a.length; i++) { const d = a[i] - m; s += d * d; }
    return s / a.length;
  }

  function quantiles(a, qs) {
    const s = Float64Array.from(a).sort();
    return qs.map((q) => {
      const pos = q * (s.length - 1);
      const lo = Math.floor(pos), hi = Math.ceil(pos);
      return s[lo] + (s[hi] - s[lo]) * (pos - lo);
    });
  }

  function histogram(a, lo, hi, bins) {
    const counts = new Array(bins).fill(0);
    const w = (hi - lo) / bins;
    for (let i = 0; i < a.length; i++) {
      const b = Math.floor((a[i] - lo) / w);
      if (b >= 0 && b < bins) counts[b]++; // values outside the drawn range are left out, not piled on the edge
    }
    return counts;
  }

  // ------------------------------------------------------------ analysis

  const QS = [0.05, 0.25, 0.5, 0.75, 0.95];

  /**
   * The whole analysis. opts: { n = 5000, seed = 1, slices = 32 }.
   *
   * Decision mode (two or more options): the "best" option is the one with the
   * highest expected value (lowest, if goal is 'min'). For each uncertain row i,
   * with CRN (the same joint samples of every other row) the engine computes
   *   m_j(x)  = E[option j | row i = x]           (point conditional means)
   *   m_j(g)  = E[option j | row i in slice g]    (slice conditional means; G equal-probability slices)
   * and from them
   *   evpi_i  = Σ_g (1/G) max_j m_j(g) − max_j Σ_g (1/G) m_j(g)
   *             (the value of learning which slice row i is in before choosing;
   *              for a chance row the two slices are its two states, weighted by p)
   *   share_i = Var_g(E[margin | slice g]) / Var(margin), margin = best − runner-up
   *   flip    = the set of values x of row i where argmax_j m_j(x) is not the best,
   *             found by scanning m_j(x) at the slice medians and bisecting, with
   *             its probability under row i's own distribution.
   * Estimate mode (one option): share_i and swing_i = m(q95) − m(q05) replace
   * the decision quantities.
   */
  function analyze(model, opts) {
    opts = opts || {};
    const { errors, compiled } = compileModel(model);
    if (errors.length) throw new HingeError(errors.map((e) => e.message).join(' '));
    const n = opts.n || 5000;
    const seed = opts.seed == null ? 1 : opts.seed;
    const G = opts.slices || 32;
    const t0 = Date.now();
    const sim = simulate(compiled, n, seed);
    const { rows, options, nRows, sign, goal, downstream } = compiled;
    const m = options.length;
    const { X, F } = sim;

    // Non-finite outcomes are a modelling error (division by zero, log of a negative number…).
    const bad = options.map((o, j) => { let c = 0; for (let k = 0; k < n; k++) if (!Number.isFinite(F[j][k])) c++; return c; });
    if (bad.some((c) => c > 0)) {
      const j = bad.findIndex((c) => c > 0);
      throw new HingeError(`"${options[j].name}" gave a non-finite value in ${bad[j]} of ${n} samples (division by zero, or log/sqrt of a negative number?).`);
    }

    // Per-option summaries, in the user's units.
    const allLo = Math.min(...options.map((o, j) => quantiles(F[j], [0.005])[0]));
    const allHi = Math.max(...options.map((o, j) => quantiles(F[j], [0.995])[0]));
    const optionStats = options.map((o, j) => {
      const q = quantiles(F[j], QS);
      return { name: o.name, id: o.id, mean: mean(F[j]), sd: Math.sqrt(variance(F[j])), q05: q[0], q25: q[1], median: q[2], q75: q[3], q95: q[4], hist: histogram(F[j], allLo, allHi, 48) };
    });

    // Signed values: bigger is always better internally.
    const V = F.map((f) => (sign === 1 ? f : f.map((v) => -v)));
    const means = V.map(mean);
    let best = 0;
    for (let j = 1; j < m; j++) if (means[j] > means[best]) best = j;

    const result = {
      mode: m >= 2 ? 'decision' : 'estimate',
      n, seed, slices: G, goal, unit: model.unit || '',
      options: optionStats,
      range: [allLo, allHi],
      best,
      rows: [],
    };

    // Which option wins per sample; the margin of the best over the runner-up.
    const D = new Float64Array(n);
    if (m >= 2) {
      const wins = new Array(m).fill(0);
      for (let k = 0; k < n; k++) {
        let bj = 0, bv = V[0][k], other = -Infinity;
        for (let j = 1; j < m; j++) if (V[j][k] > bv) { bv = V[j][k]; bj = j; }
        wins[bj]++;
        for (let j = 0; j < m; j++) if (j !== best && V[j][k] > other) other = V[j][k];
        D[k] = V[best][k] - other;
      }
      result.pBest = wins.map((w) => w / n);
      let eMax = 0;
      for (let k = 0; k < n; k++) eMax += D[k] > 0 ? V[best][k] : V[best][k] - D[k];
      eMax /= n;
      result.evpi = eMax - means[best];
      result.margin = { mean: mean(D), pPositive: wins[best] / n, q: quantiles(D, QS) };
      if (m === 2) {
        // the margin of the best option over the other, in the user's units, positive when the best is ahead
        const other = 1 - best;
        const diff = Float64Array.from(F[best], (v, k) => (v - F[other][k]) * sign);
        const q = quantiles(diff, [0.005, 0.05, 0.25, 0.5, 0.75, 0.95, 0.995]);
        const lo = Math.min(q[0], 0), hi = Math.max(q[6], 0);
        const pad = (hi - lo) * 0.04;
        result.diff = { best, other, mean: mean(diff), q05: q[1], q25: q[2], median: q[3], q75: q[4], q95: q[5], range: [lo - pad, hi + pad] };
        result.diff.hist = histogram(diff, result.diff.range[0], result.diff.range[1], 48);
      }
    } else {
      for (let k = 0; k < n; k++) D[k] = V[0][k];
      if (compiled.target != null) {
        let below = 0;
        for (let k = 0; k < n; k++) if (F[0][k] <= compiled.target) below++;
        result.target = { value: compiled.target, pBelow: below / n, pAbove: 1 - below / n };
      }
    }
    const varD = variance(D);
    const meanD = mean(D);

    // ---- per-row conditional analysis with common random numbers
    const Xs = new Float64Array(X); // scratch copy
    const Fs = options.map(() => new Float64Array(n));
    const Dk = new Float64Array(n);

    // Means of every option, and of the margin / estimate, when row i is pinned by `setter(k)`.
    function condMeans(i, setter) {
      const down = downstream[i];
      for (let k = 0; k < n; k++) {
        const b = k * nRows;
        Xs[b + i] = setter(k);
        for (const r of down.rows) Xs[b + r] = rows[r].fn(Xs, b);
        for (const j of down.opts) Fs[j][k] = options[j].fn(Xs, b);
      }
      const isDown = options.map((o, j) => down.opts.includes(j));
      const mj = options.map((o, j) => (isDown[j] ? mean(Fs[j]) * sign : means[j]));
      // conditional mean of D (margin or estimate), in signed units
      let sD = 0;
      for (let k = 0; k < n; k++) {
        let vb, other = -Infinity;
        if (m >= 2) {
          vb = (isDown[best] ? Fs[best][k] : F[best][k]) * sign;
          for (let j = 0; j < m; j++) if (j !== best) { const v = (isDown[j] ? Fs[j][k] : F[j][k]) * sign; if (v > other) other = v; }
          Dk[k] = vb - other;
        } else Dk[k] = (isDown[0] ? Fs[0][k] : F[0][k]) * sign;
        sD += Dk[k];
      }
      return { mj, mD: sD / n };
    }
    // Put the scratch copy back the way the main simulation left it: the pinned column and everything downstream of it.
    function restoreColumn(i) {
      const cols = [i, ...downstream[i].rows];
      for (let k = 0; k < n; k++) {
        const b = k * nRows;
        for (const r of cols) Xs[b + r] = X[b + r];
      }
    }
    // g(x) = m_best(x) − max_{j≠best} m_j(x): positive where the best option stays best.
    const gap = (mj) => {
      if (m < 2) return 0;
      let other = -Infinity;
      for (let j = 0; j < m; j++) if (j !== best && mj[j] > other) other = mj[j];
      return mj[best] - other;
    };

    for (let i = 0; i < nRows; i++) {
      const row = rows[i];
      if (row.kind !== 'range' && row.kind !== 'chance') continue;
      const dist = row.dist;
      const U = sim.U[i];
      const entry = { index: i, id: row.id, name: row.name, kind: row.kind, dist: dist.type, median: dist.median };

      if (row.kind === 'chance') {
        const p = dist.p;
        const at0 = condMeans(i, () => 0);
        const at1 = condMeans(i, () => 1);
        const w = [1 - p, p];
        const states = [at0, at1];
        entry.p = p;
        entry.curve = [{ u: 0, x: 0, mj: at0.mj, mD: at0.mD }, { u: 1, x: 1, mj: at1.mj, mD: at1.mD }];
        entry.slices = entry.curve.map((c, s) => ({ w: w[s], ...c }));
        // share of variance (first-order Sobol index of the two-state variable)
        const mD = w[0] * at0.mD + w[1] * at1.mD;
        entry.share = varD > 0 ? (w[0] * (at0.mD - mD) ** 2 + w[1] * (at1.mD - mD) ** 2) / varD : 0;
        if (m >= 2) {
          const eMax = w[0] * Math.max(...at0.mj) + w[1] * Math.max(...at1.mj);
          const maxE = Math.max(...options.map((o, j) => w[0] * at0.mj[j] + w[1] * at1.mj[j]));
          entry.evpi = Math.max(0, eMax - maxE);
          const flips = [];
          states.forEach((st, s) => { if (gap(st.mj) < 0) flips.push(s); });
          entry.flip = {
            kind: flips.length === 0 ? 'none' : flips.length === 2 ? 'always' : flips[0] === 1 ? 'yes' : 'no',
            p: flips.reduce((acc, s) => acc + w[s], 0),
            winner: flips.length ? argmax(states[flips[0]].mj) : null,
          };
        } else {
          entry.swing = (at1.mD - at0.mD) * sign;
        }
        restoreColumn(i);
        result.rows.push(entry);
        continue;
      }

      // Continuous row: G equal-probability slices (CRN; every sample's u is mapped into the slice).
      const slices = [];
      for (let g = 0; g < G; g++) {
        const r = condMeans(i, (k) => dist.quantile((g + (U[k] * G - Math.floor(U[k] * G))) / G));
        slices.push({ g, w: 1 / G, uMid: (g + 0.5) / G, x: dist.quantile((g + 0.5) / G), mj: r.mj, mD: r.mD });
      }
      entry.slices = slices;
      const mDbar = slices.reduce((a, s) => a + s.mD, 0) / G;
      entry.share = varD > 0 ? slices.reduce((a, s) => a + (s.mD - mDbar) ** 2, 0) / G / varD : 0;

      // Point curve at a fixed grid of quantiles: slice medians plus the tails and the 5%/95% marks.
      const grid = [0.001, 0.05, 0.95, 0.999];
      for (let g = 0; g < G; g++) grid.push((g + 0.5) / G);
      grid.sort((a, b) => a - b);
      const curve = grid.map((u) => {
        const x = dist.quantile(u);
        const r = condMeans(i, () => x);
        return { u, x, mj: r.mj, mD: r.mD, gap: gap(r.mj) };
      });
      entry.curve = curve;
      const at = (u) => curve.find((c) => c.u === u);
      entry.swing = (at(0.95).mD - at(0.05).mD) * sign;
      entry.q05 = at(0.05).x;
      entry.q95 = at(0.95).x;

      if (m >= 2) {
        const eMax = slices.reduce((a, s) => a + Math.max(...s.mj), 0) / G;
        const maxE = Math.max(...options.map((o, j) => slices.reduce((a, s) => a + s.mj[j], 0) / G));
        entry.evpi = Math.max(0, eMax - maxE);

        // Flip set in u-space: intervals where the best option is no longer best.
        const gu = (u) => { const x = dist.quantile(u); return gap(condMeans(i, () => x).mj); };
        const roots = [];
        for (let a = 0; a + 1 < curve.length; a++) {
          const ga = curve[a].gap, gb = curve[a + 1].gap;
          if (ga === 0) roots.push({ u: curve[a].u, dir: Math.sign(gb) });
          if (ga * gb < 0) {
            let lo = curve[a].u, hi = curve[a + 1].u, glo = ga;
            for (let it = 0; it < 20; it++) {
              const mid = (lo + hi) / 2;
              const gm = gu(mid);
              if (gm === 0) { lo = hi = mid; break; }
              if ((gm < 0) === (glo < 0)) { lo = mid; glo = gm; } else hi = mid;
            }
            roots.push({ u: (lo + hi) / 2, dir: Math.sign(gb) });
          }
        }
        const intervals = [];
        let open = curve[0].gap < 0 ? 0 : null;
        for (const r of roots) {
          if (r.dir > 0 && open !== null) { intervals.push([open, r.u]); open = null; }
          else if (r.dir < 0 && open === null) open = r.u;
        }
        if (open !== null) intervals.push([open, 1]);
        const p = intervals.reduce((a, [lo, hi]) => a + (hi - lo), 0);
        let kind = 'none';
        if (intervals.length === 1) {
          const [lo, hi] = intervals[0];
          kind = lo === 0 && hi === 1 ? 'always' : lo === 0 ? 'below' : hi === 1 ? 'above' : 'between';
        } else if (intervals.length === 2 && intervals[0][0] === 0 && intervals[1][1] === 1) kind = 'outside';
        else if (intervals.length >= 2) kind = 'several';
        entry.flip = {
          kind, p,
          intervals: intervals.map(([lo, hi]) => [lo, hi]),
          at: intervals.map(([lo, hi]) => [lo === 0 ? null : dist.quantile(lo), hi === 1 ? null : dist.quantile(hi)]),
          winner: intervals.length ? argmax(condMeans(i, () => dist.quantile((intervals[0][0] + intervals[0][1]) / 2)).mj) : null,
        };
      }
      restoreColumn(i);
      result.rows.push(entry);
    }

    result.sumShare = result.rows.reduce((a, r) => a + r.share, 0);
    result.ms = Date.now() - t0;
    result.meanD = meanD * sign;
    result.sdD = Math.sqrt(varD);
    return result;
  }

  function argmax(a) {
    let b = 0;
    for (let i = 1; i < a.length; i++) if (a[i] > a[b]) b = i;
    return b;
  }

  // ------------------------------------------------------------ words

  /** Describe a flip set in words, e.g. "below $253M". */
  function flipText(entry, unit, pctRow) {
    const f = entry.flip;
    if (!f) return '';
    const fx = (x) => fmt(x, '', { pct: pctRow });
    if (entry.kind === 'chance') {
      if (f.kind === 'none') return 'cannot flip it alone';
      if (f.kind === 'always') return 'either way';
      return f.kind === 'yes' ? 'if it happens' : 'if it does not happen';
    }
    const a = f.at;
    switch (f.kind) {
      case 'none': return 'cannot flip it alone';
      case 'always': return 'at any value';
      case 'below': return `below ${fx(a[0][1])}`;
      case 'above': return `above ${fx(a[0][0])}`;
      case 'between': return `between ${fx(a[0][0])} and ${fx(a[0][1])}`;
      case 'outside': return `outside ${fx(a[0][1])} to ${fx(a[1][0])}`;
      default: return 'in several ranges';
    }
  }

  /** The plain-language summary. Returns an array of strings with **bold** markers. */
  function narrate(result, model) {
    const unit = model.unit || '';
    const money = (x) => fmt(x, unit);
    const out = [];
    const rowOf = (r) => model.rows.find((x) => x.id === r.id) || {};
    if (result.mode === 'decision') {
      const b = result.options[result.best];
      const others = result.options.filter((o, j) => j !== result.best);
      const runner = others.reduce((a, o) => (result.goal === 'min' ? (o.mean < a.mean ? o : a) : (o.mean > a.mean ? o : a)));
      const lead = Math.abs(b.mean - runner.mean);
      const pb = result.pBest[result.best];
      const verb = result.goal === 'min' ? 'is cheaper than' : 'beats';
      out.push(`On expected value, **${b.name}** ${verb} **${runner.name}** by ${money(lead)}.`);
      if (pb < 0.5) out.push(`But it actually comes out ahead in only **${fmtPct(pb)}** of runs: its average is carried by a minority of big wins, and most of the time you would end up ${result.goal === 'min' ? 'paying more' : 'worse off'}.`);
      else if (pb < 0.8) out.push(`It comes out ahead in **${fmtPct(pb)}** of runs, so there is a real chance you would regret it.`);
      else out.push(`It comes out ahead in **${fmtPct(pb)}** of runs.`);
      const evpi = result.evpi;
      if (evpi > 0) out.push(`Knowing everything before choosing would be worth about **${money(evpi)}** on average (the value of perfect information).`);
      const sorted = [...result.rows].sort((a, c) => c.evpi - a.evpi);
      const top = sorted[0];
      const floor = Math.max(evpi * 0.02, 1e-9);
      if (top && top.evpi > floor) {
        const share = top.evpi / evpi;
        out.push(`The one thing most worth finding out is **${top.name}**, worth ${money(top.evpi)} on its own${share > 0.5 ? ` (${fmtPct(share)} of the total)` : ''}.`);
      }
      const flippers = result.rows.filter((r) => r.flip && r.flip.p > 0).sort((a, c) => c.flip.p - a.flip.p);
      if (flippers.length) {
        const f = flippers[0];
        const row = rowOf(f);
        const w = f.flip.winner != null ? result.options[f.flip.winner].name : runner.name;
        out.push(`The most likely single thing to change the answer: **${f.name}** ${flipText(f, unit, row.pct)} — you put that at **${fmtPct(f.flip.p)}** — and then **${w}** wins.`);
      } else if (result.rows.length) {
        out.push(`No single assumption can change the answer on its own within the ranges you gave; only combinations can.`);
      }
      const cannot = result.rows.filter((r) => r.flip && r.flip.p === 0).map((r) => r.name);
      if (cannot.length && flippers.length) out.push(`${cannot.map((c) => `**${c}**`).join(', ')} cannot change it alone, however ${cannot.length > 1 ? 'they turn' : 'it turns'} out.`);
    } else {
      const o = result.options[0];
      out.push(`**${o.name}**: most likely around **${money(o.median)}**, and 90% of runs fall between ${money(o.q05)} and ${money(o.q95)}.`);
      if (Math.abs(o.mean - o.median) > 0.1 * Math.abs(o.median)) out.push(`The average (${money(o.mean)}) is ${o.mean > o.median ? 'above' : 'below'} the median: the distribution is skewed.`);
      if (result.target) {
        const t = result.target;
        out.push(`Chance of landing at or below **${money(t.value)}**: **${fmtPct(t.pBelow)}**.`);
      }
      const sorted = [...result.rows].sort((a, c) => c.share - a.share);
      if (sorted.length >= 2 && sorted[0].share > 0) {
        out.push(`Most of the uncertainty comes from **${sorted[0].name}** (${fmtPct(sorted[0].share)} of the variance); next is **${sorted[1].name}** (${fmtPct(sorted[1].share)}).`);
        const last = sorted[sorted.length - 1];
        if (last.share < 0.05) out.push(`**${last.name}** barely matters (${fmtPct(last.share)}): time spent sharpening it is wasted.`);
      }
    }
    return out;
  }

  // ------------------------------------------------------------ import / export

  function normalizeModel(raw) {
    if (!raw || typeof raw !== 'object') throw new HingeError('Not a Hinge case.');
    const model = {
      version: 1,
      title: String(raw.title || 'Untitled').slice(0, 200),
      unit: String(raw.unit || '').slice(0, 12),
      goal: raw.goal === 'min' ? 'min' : 'max',
      target: raw.target == null || raw.target === '' ? null : Number(raw.target),
      notes: String(raw.notes || '').slice(0, 4000),
      rows: [],
      options: [],
    };
    let counter = 1;
    const id = (prefix) => `${prefix}${counter++}_${Math.random().toString(36).slice(2, 7)}`;
    for (const r of Array.isArray(raw.rows) ? raw.rows : []) {
      if (!r || typeof r !== 'object') continue;
      const row = { id: typeof r.id === 'string' ? r.id : id('r'), name: String(r.name || '').slice(0, 40), kind: ROW_KINDS.includes(r.kind) ? r.kind : 'range', note: String(r.note || '').slice(0, 300) };
      if (row.kind === 'range') { row.lo = Number(r.lo); row.hi = Number(r.hi); row.shape = ['auto', 'lognormal', 'normal', 'uniform'].includes(r.shape) ? r.shape : 'auto'; row.pct = !!r.pct; }
      else if (row.kind === 'chance') row.p = Number(r.p);
      else if (row.kind === 'fixed') { row.value = Number(r.value); row.pct = !!r.pct; }
      else row.expr = String(r.expr || '').slice(0, 2000);
      model.rows.push(row);
    }
    for (const o of Array.isArray(raw.options) ? raw.options : []) {
      if (!o || typeof o !== 'object') continue;
      model.options.push({ id: typeof o.id === 'string' ? o.id : id('o'), name: String(o.name || '').slice(0, 60), expr: String(o.expr || '').slice(0, 2000) });
    }
    return model;
  }

  return {
    HingeError, Z95, parseNumber, fmt, fmtPct, toIdent,
    normCdf, normPdf, normQuantile, makeDist, rangeShape,
    tokenize, parse, compile, compileFast, emitJS, evalExpr, astVars, FUNCTIONS,
    compileModel, rng, stratifiedUniforms, simulate, mean, variance, quantiles, histogram,
    analyze, narrate, flipText, normalizeModel, ROW_KINDS,
  };
});
