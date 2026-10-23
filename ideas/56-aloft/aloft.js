// Aloft: a tiny language whose only memory is the air.
// Lexer, parser, checker, interpreter and formatter. Pure: no DOM, no I/O.
// Loads as a classic browser script (window.Aloft) and as a CommonJS module in Node.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Aloft = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const KEYWORDS = new Set([
    'balls', 'catch', 'say', 'stop', 'when', 'throw', 'up', 'let',
    'if', 'then', 'else', 'and', 'or', 'not', 'min', 'max', 'abs',
  ]);
  const STATEMENT_WORDS = ['balls', 'catch', 'say', 'stop', 'throw', 'let'];
  const MAX_HEIGHT = 9999;
  const MAX_BITS = 4096;
  const LIMIT = 1n << BigInt(MAX_BITS); // |value| must stay below 2^4096
  const MAX_DEPTH = 200; // deepest expression nesting the parser accepts
  // maxOutput caps lines and maxOutputChars caps characters (string length) of output, so a
  // short program can't produce more text than a page can show. maxMillis is a wall-clock guard
  // on interpretation for interactive use; by default there is none, so runs are deterministic.
  const DEFAULTS = { maxBeats: 10000, maxOutput: 10000, maxOutputChars: 1000000, maxWork: 5000000, maxMillis: Infinity, traceBeats: 0 };

  function err(kind, message, line, col) {
    return { kind, message, line, col };
  }
  class AloftFail extends Error {
    constructor(e) {
      super(e.message);
      this.info = e;
    }
  }
  function fail(kind, message, line, col) {
    throw new AloftFail(err(kind, message, line, col));
  }

  // ---------------------------------------------------------------- lexer
  // Token types: int, name, kw, str, op, nl, eof. Lines and columns count from 1;
  // a column is one character (a surrogate pair counts once).
  // The lexer is lazy: each call returns the next token, so the parser meets a bad
  // character only when it gets there, and an earlier grammar error is reported first.
  function lexer(src) {
    const open = []; // positions of unclosed "(": line breaks inside brackets are ignored
    let i = 0;
    let line = 1;
    let col = 1;
    const n = src.length;
    const adv = () => {
      const c = src.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < n) {
        const d = src.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) i++;
      }
      i++;
      col++;
    };
    return function nextToken() {
      while (i < n) {
        const ch = src[i];
        if (ch === '\r' || ch === '\n') {
          const tok = open.length ? null : { type: 'nl', value: '\n', line, col };
          if (ch === '\r' && src[i + 1] === '\n') i++;
          i++;
          line++;
          col = 1;
          if (tok) return tok;
          continue;
        }
        if (ch === ' ' || ch === '\t' || ch === '\f' || ch === '\v') {
          adv();
          continue;
        }
        if (ch === '#') {
          while (i < n && src[i] !== '\n' && src[i] !== '\r') adv();
          continue;
        }
        const sl = line;
        const sc = col;
        if (ch >= '0' && ch <= '9') {
          let j = i;
          while (j < n && src[j] >= '0' && src[j] <= '9') j++;
          if (j < n && /[A-Za-z_]/.test(src[j])) {
            fail('syntax', `A number can't run into letters: "${src.slice(i, j + 1)}"`, sl, sc);
          }
          const text = src.slice(i, j);
          const value = BigInt(text);
          if (value >= LIMIT) fail('syntax', `That number is too big (Aloft numbers stay below 2^${MAX_BITS})`, sl, sc);
          col += j - i;
          i = j;
          return { type: 'int', value, text, line: sl, col: sc };
        }
        if (/[A-Za-z_]/.test(ch)) {
          let j = i;
          while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
          const word = src.slice(i, j);
          col += j - i;
          i = j;
          return { type: KEYWORDS.has(word) ? 'kw' : 'name', value: word, line: sl, col: sc };
        }
        if (ch === '"') {
          adv();
          const start = i;
          while (i < n && src[i] !== '"' && src[i] !== '\n' && src[i] !== '\r') adv();
          if (i >= n || src[i] !== '"') fail('syntax', 'This string never ends: close it with " on the same line', sl, sc);
          const value = src.slice(start, i);
          adv();
          return { type: 'str', value, line: sl, col: sc };
        }
        const two = src.slice(i, i + 2);
        if (two === '==' || two === '!=' || two === '<=' || two === '>=') {
          i += 2;
          col += 2;
          return { type: 'op', value: two, line: sl, col: sc };
        }
        if ('+-*/%(),=<>'.includes(ch)) {
          if (ch === '(') open.push({ line: sl, col: sc });
          if (ch === ')') open.pop();
          adv();
          return { type: 'op', value: ch, line: sl, col: sc };
        }
        const shown = String.fromCodePoint(src.codePointAt(i));
        if (/\s/.test(shown)) {
          const code = shown.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
          fail('syntax', `Unexpected invisible character U+${code}: only ordinary spaces and tabs can separate words`, sl, sc);
        }
        if (ch === '!') fail('syntax', 'Unexpected "!": "not equal" is written !=, and "not" is a word', sl, sc);
        fail('syntax', `Unexpected character "${shown}"`, sl, sc);
      }
      if (open.length) fail('syntax', 'This "(" is never closed', open[0].line, open[0].col);
      return { type: 'eof', value: '', line, col };
    };
  }
  // All the tokens at once (the parser itself pulls them one at a time).
  function lex(src) {
    const next = lexer(src);
    const toks = [];
    do toks.push(next()); while (toks[toks.length - 1].type !== 'eof');
    return toks;
  }

  // --------------------------------------------------------------- parser
  function describe(t) {
    if (t.type === 'eof') return 'the end of the program';
    if (t.type === 'nl') return 'the end of the line';
    if (t.type === 'str') return `"${t.value}"`;
    if (t.type === 'int') return t.text;
    return `"${t.value}"`;
  }

  // Depth of an expression tree, without recursion (a long a + b + c + … chain is deep).
  function treeDepth(e) {
    let max = 0;
    const stack = [[e, 1]];
    while (stack.length) {
      const [x, d] = stack.pop();
      if (d > max) max = d;
      if (x.type === 'unary') stack.push([x.arg, d + 1]);
      else if (x.type === 'binary') stack.push([x.left, d + 1], [x.right, d + 1]);
      else if (x.type === 'if') stack.push([x.cond, d + 1], [x.then, d + 1], [x.else, d + 1]);
      else if (x.type === 'call') for (const a of x.args) stack.push([a, d + 1]);
    }
    return max;
  }

  // The first "(" that is never closed, or null. Brackets inside strings and comments
  // don't count, and strings and comments end at a line break, as in the lexer.
  function firstUnclosed(src) {
    const open = [];
    let line = 1;
    let col = 1;
    let mode = 'code'; // or 'string', 'comment'
    const n = src.length;
    for (let i = 0; i < n;) {
      const ch = src[i];
      if (ch === '\r' || ch === '\n') {
        if (ch === '\r' && src[i + 1] === '\n') i++;
        i++;
        line++;
        col = 1;
        mode = 'code';
        continue;
      }
      if (mode === 'code') {
        if (ch === '#') mode = 'comment';
        else if (ch === '"') mode = 'string';
        else if (ch === '(') open.push({ line, col });
        else if (ch === ')') open.pop();
      } else if (mode === 'string' && ch === '"') mode = 'code';
      const c = src.charCodeAt(i);
      const pair = c >= 0xd800 && c <= 0xdbff && i + 1 < n && src.charCodeAt(i + 1) >= 0xdc00 && src.charCodeAt(i + 1) <= 0xdfff;
      i += pair ? 2 : 1;
      col++;
    }
    return open.length ? open[0] : null;
  }

  // Tokens are pulled from the lexer only as the parser reaches them, so the first failure
  // in reading order is the one reported, whether it is a bad character or bad grammar.
  // A "(" that is never closed counts as failing at the bracket: a forgotten ")" otherwise
  // shows up as a puzzling error further on.
  function parse(src) {
    try {
      return parseTokens(src);
    } catch (e) {
      if (e instanceof AloftFail && e.info.kind === 'syntax') {
        const b = firstUnclosed(src);
        if (b && (b.line < e.info.line || (b.line === e.info.line && b.col < e.info.col))) {
          fail('syntax', 'This "(" is never closed', b.line, b.col);
        }
      }
      throw e;
    }
  }
  function parseTokens(src) {
    const pull = lexer(src);
    const toks = [];
    const tok = (k) => {
      while (toks.length <= k) toks.push(pull());
      return toks[k];
    };
    let p = 0;
    const peek = () => tok(p);
    const next = () => tok(p++);
    const isKw = (w) => peek().type === 'kw' && peek().value === w;
    const isOp = (o) => peek().type === 'op' && peek().value === o;
    const expectKw = (w, why) => {
      if (!isKw(w)) fail('syntax', why || `Expected "${w}" but found ${describe(peek())}`, peek().line, peek().col);
      return next();
    };
    const expectOp = (o, why) => {
      if (!isOp(o)) fail('syntax', why || `Expected "${o}" but found ${describe(peek())}`, peek().line, peek().col);
      return next();
    };
    const endOfStatement = () => {
      const t = peek();
      if (t.type === 'nl') {
        next();
        return;
      }
      if (t.type === 'eof') return;
      fail('syntax', `Unexpected ${describe(t)}: the statement already ended here (each statement goes on its own line, and say items are separated by commas)`, t.line, t.col);
    };

    // Expressions, lowest precedence first. `depth` guards against nesting
    // deep enough to exhaust the stack.
    let depth = 0;
    const deeper = (t) => {
      if (++depth > MAX_DEPTH) fail('syntax', `This expression is nested too deeply (more than ${MAX_DEPTH} levels)`, t.line, t.col);
    };
    function topExpr() {
      const t = peek();
      const e = expr();
      if (treeDepth(e) > MAX_DEPTH) fail('syntax', `This expression is nested too deeply (more than ${MAX_DEPTH} levels)`, t.line, t.col);
      return e;
    }
    function expr() {
      deeper(peek());
      try {
        return exprInner();
      } finally {
        depth--;
      }
    }
    function exprInner() {
      if (isKw('if')) {
        const t = next();
        const cond = expr();
        expectKw('then', `Expected "then" after the condition of "if", found ${describe(peek())}`);
        const yes = expr();
        expectKw('else', `An "if" needs an "else" (a value has to be one thing or the other); found ${describe(peek())}`);
        const no = expr();
        return { type: 'if', cond, then: yes, else: no, line: t.line, col: t.col };
      }
      return orExpr();
    }
    function orExpr() {
      let left = andExpr();
      while (isKw('or')) {
        const t = next();
        left = { type: 'binary', op: 'or', left, right: andExpr(), line: t.line, col: t.col };
      }
      return left;
    }
    function andExpr() {
      let left = notExpr();
      while (isKw('and')) {
        const t = next();
        left = { type: 'binary', op: 'and', left, right: notExpr(), line: t.line, col: t.col };
      }
      return left;
    }
    function notExpr() {
      if (isKw('not')) {
        const t = next();
        deeper(t);
        const arg = notExpr();
        depth--;
        return { type: 'unary', op: 'not', arg, line: t.line, col: t.col };
      }
      return cmpExpr();
    }
    const CMP = new Set(['==', '!=', '<', '<=', '>', '>=']);
    function cmpExpr() {
      const left = sumExpr();
      const t = peek();
      if (t.type === 'op' && t.value === '=') {
        fail('syntax', 'To compare, write == (a single = only appears in "let")', t.line, t.col);
      }
      if (t.type === 'op' && CMP.has(t.value)) {
        next();
        const right = sumExpr();
        const u = peek();
        if (u.type === 'op' && (CMP.has(u.value) || u.value === '=')) {
          fail('syntax', 'Comparisons don\'t chain: write "a < b and b < c"', u.line, u.col);
        }
        return { type: 'binary', op: t.value, left, right, line: t.line, col: t.col };
      }
      return left;
    }
    function sumExpr() {
      let left = termExpr();
      while (isOp('+') || isOp('-')) {
        const t = next();
        left = { type: 'binary', op: t.value, left, right: termExpr(), line: t.line, col: t.col };
      }
      return left;
    }
    function termExpr() {
      let left = unaryExpr();
      while (isOp('*') || isOp('/') || isOp('%')) {
        const t = next();
        left = { type: 'binary', op: t.value, left, right: unaryExpr(), line: t.line, col: t.col };
      }
      return left;
    }
    function unaryExpr() {
      if (isOp('-')) {
        const t = next();
        deeper(t);
        const arg = unaryExpr();
        depth--;
        return { type: 'unary', op: '-', arg, line: t.line, col: t.col };
      }
      return atom();
    }
    function atom() {
      const t = peek();
      if (t.type === 'int') {
        next();
        return { type: 'int', value: t.value, line: t.line, col: t.col };
      }
      if (t.type === 'name') {
        next();
        return { type: 'name', name: t.value, line: t.line, col: t.col };
      }
      if (t.type === 'kw' && (t.value === 'min' || t.value === 'max' || t.value === 'abs')) {
        next();
        expectOp('(', `"${t.value}" needs its arguments in brackets, like ${t.value}(a, b)`);
        const args = [expr()];
        while (isOp(',')) {
          next();
          args.push(expr());
        }
        expectOp(')', `Expected ")" to close ${t.value}(, found ${describe(peek())}`);
        return { type: 'call', fn: t.value, args, line: t.line, col: t.col };
      }
      if (isOp('(')) {
        next();
        const e = expr();
        expectOp(')', `Expected ")" but found ${describe(peek())}`);
        return e;
      }
      if (t.type === 'str') fail('syntax', 'Strings can only be said, not computed with', t.line, t.col);
      if (t.type === 'kw') fail('syntax', `Expected a value but found the keyword "${t.value}"`, t.line, t.col);
      fail('syntax', `Expected a value but found ${describe(t)}`, t.line, t.col);
    }

    function nameToken(what) {
      const t = peek();
      if (t.type === 'kw') fail('syntax', `"${t.value}" is a keyword, so it can't be ${what}`, t.line, t.col);
      if (t.type !== 'name') fail('syntax', `Expected ${what} but found ${describe(t)}`, t.line, t.col);
      return next();
    }

    function statement() {
      const t = peek();
      if (t.type === 'kw' && t.value === 'say') {
        next();
        const items = [];
        const startsItem = () => {
          const u = peek();
          return !(u.type === 'nl' || u.type === 'eof' || (u.type === 'kw' && u.value === 'when'));
        };
        if (startsItem()) {
          for (;;) {
            const u = peek();
            if (u.type === 'str') {
              next();
              items.push({ type: 'str', value: u.value, line: u.line, col: u.col });
              const v = peek();
              if (v.type === 'op' && v.value !== ',') fail('syntax', 'Strings can only be said, not computed with', v.line, v.col);
            } else items.push(topExpr());
            if (!isOp(',')) break;
            next();
          }
        }
        let when = null;
        if (isKw('when')) {
          next();
          when = topExpr();
        }
        return { type: 'say', items, when, line: t.line, col: t.col };
      }
      if (t.type === 'kw' && t.value === 'stop') {
        next();
        let when = null;
        if (isKw('when')) {
          next();
          when = topExpr();
        }
        return { type: 'stop', when, line: t.line, col: t.col };
      }
      if (t.type === 'kw' && t.value === 'throw') {
        next();
        const value = topExpr();
        expectKw('up', `A throw needs a height: "throw <value> up <beats>"; found ${describe(peek())}`);
        const h = peek();
        if (h.type !== 'int') {
          fail('syntax', 'A height must be a number written out, like "up 3": heights are checked before the program runs, so they can\'t be computed', h.line, h.col);
        }
        next();
        if (isKw('when')) {
          const w = peek();
          fail('syntax', 'A throw can\'t have "when": the ball has to go up either way. Choose its value instead: throw (if c then x else y) up 1', w.line, w.col);
        }
        if (h.value < 1n || h.value > BigInt(MAX_HEIGHT)) {
          fail('syntax', h.value < 1n
            ? 'A height must be at least 1: a ball has to spend at least one beat in the air (hands can\'t hold anything)'
            : `A height can be at most ${MAX_HEIGHT}`, h.line, h.col);
        }
        return { type: 'throw', value, height: Number(h.value), line: t.line, col: t.col, hLine: h.line, hCol: h.col };
      }
      if (t.type === 'kw' && t.value === 'let') {
        next();
        const nt = nameToken('a name');
        expectOp('=', `Expected "=" after "let ${nt.value}", found ${describe(peek())}`);
        const value = topExpr();
        return { type: 'let', name: nt.value, value, line: t.line, col: t.col, nameLine: nt.line, nameCol: nt.col };
      }
      if (t.type === 'name') {
        // One token of lookahead for "x = 3". If that token is itself unreadable, the
        // error at this name comes first, since it is earlier in the line.
        let after = null;
        try {
          after = tok(p + 1);
        } catch (e) {
          if (!(e instanceof AloftFail)) throw e;
        }
        if (after && after.type === 'op' && after.value === '=') {
          fail('syntax', `There are no variables in Aloft. To keep "${t.value}" for later, throw it; to name a value inside one beat, write "let ${t.value} = ..."`, t.line, t.col);
        }
      }
      fail('syntax', `Each line starts with one of: ${STATEMENT_WORDS.join(', ')}. Found ${describe(t)}`, t.line, t.col);
    }

    const prog = { balls: [], ballsLines: [], beats: [] };
    for (;;) {
      const t = peek();
      if (t.type === 'eof') break;
      if (t.type === 'nl') {
        next();
        continue;
      }
      if (t.type === 'kw' && t.value === 'balls') {
        next();
        if (prog.beats.length) {
          fail('syntax', '"balls" lines go at the top, before the first "catch"', t.line, t.col);
        }
        const group = [];
        while (peek().type !== 'nl' && peek().type !== 'eof') {
          const u = peek();
          let neg = false;
          if (u.type === 'op' && u.value === '-') {
            next();
            neg = true;
          }
          const v = peek();
          if (v.type !== 'int') {
            fail('syntax', `"balls" lists starting values as plain whole numbers; found ${describe(v)}`, v.line, v.col);
          }
          next();
          const item = { value: neg ? -v.value : v.value, line: u.line, col: u.col };
          group.push(item);
          prog.balls.push(item);
        }
        prog.ballsLines.push({ line: t.line, col: t.col, count: group.length });
        endOfStatement();
        continue;
      }
      if (t.type === 'kw' && t.value === 'catch') {
        next();
        const catches = [];
        while (peek().type !== 'nl' && peek().type !== 'eof') {
          const nt = nameToken('the name of a caught ball');
          catches.push({ name: nt.value, line: nt.line, col: nt.col });
        }
        endOfStatement();
        prog.beats.push({ line: t.line, col: t.col, catches, stmts: [] });
        continue;
      }
      if (!prog.beats.length) {
        if (t.type === 'kw' && STATEMENT_WORDS.includes(t.value)) {
          fail('syntax', `"${t.value}" has to belong to a beat: start a beat with a "catch" line above it`, t.line, t.col);
        }
      }
      const s = statement();
      endOfStatement();
      prog.beats[prog.beats.length - 1].stmts.push(s);
    }
    if (!prog.beats.length) fail('syntax', 'A program needs at least one beat: a line starting with "catch"', 1, 1);
    return prog;
  }

  // -------------------------------------------------------------- checker
  function walkNames(e, visit) {
    if (!e) return;
    switch (e.type) {
      case 'name': visit(e); break;
      case 'unary': walkNames(e.arg, visit); break;
      case 'binary': walkNames(e.left, visit); walkNames(e.right, visit); break;
      case 'if': walkNames(e.cond, visit); walkNames(e.then, visit); walkNames(e.else, visit); break;
      case 'call':
        if ((e.fn === 'abs' && e.args.length !== 1) || (e.fn !== 'abs' && e.args.length < 2)) {
          fail('check', e.fn === 'abs' ? 'abs takes exactly one value: abs(x)' : `${e.fn} takes two or more values: ${e.fn}(a, b)`, e.line, e.col);
        }
        e.args.forEach((a) => walkNames(a, visit));
        break;
      default: break;
    }
  }

  function heightName(h) {
    if (h < 10) return String(h);
    if (h < 36) return String.fromCharCode(87 + h); // 10 -> a ... 35 -> z
    return `{${h}}`;
  }

  // Throws per beat, in source order.
  function throwsOf(beat) {
    return beat.stmts.filter((s) => s.type === 'throw');
  }

  // The balls that are already in the air when the program starts, as if the
  // pattern had been running forever: every virtual throw made at a time s < 0
  // that lands at a time t >= 0. Ordered by landing time, then by catch order
  // (earlier throw first; same throw time -> source order of the throw).
  function initialSchedule(beats) {
    const n = beats.length;
    const out = [];
    beats.forEach((beat, i) => {
      throwsOf(beat).forEach((th, k) => {
        for (let m = 1; i - m * n + th.height >= 0; m++) {
          const s = i - m * n;
          out.push({ time: s + th.height, throwTime: s, beat: i, k, height: th.height, throwLine: th.line });
        }
      });
    });
    out.sort((a, b) => a.time - b.time || a.throwTime - b.throwTime || a.k - b.k);
    // Which catch name each initial ball arrives as.
    const seen = new Map();
    for (const b of out) {
      const slot = seen.get(b.time) || 0;
      seen.set(b.time, slot + 1);
      b.slot = slot;
      const landBeat = beats[b.time % n];
      b.catchName = landBeat.catches[slot] ? landBeat.catches[slot].name : '?';
    }
    return out;
  }

  function check(prog) {
    const beats = prog.beats;
    if (!beats.length) fail('syntax', 'A program needs at least one beat: a line starting with "catch"', 1, 1);
    const n = beats.length;

    // Pass 2 (pass 1 is the parser): names and function arity, beat by beat.
    for (const beat of beats) {
      const bound = new Set();
      for (const c of beat.catches) {
        if (bound.has(c.name)) fail('check', `"${c.name}" is caught twice on this beat: give each ball its own name`, c.line, c.col);
        bound.add(c.name);
      }
      const use = (e) => walkNames(e, (v) => {
        if (!bound.has(v.name)) {
          fail('check', `"${v.name}" isn't in your hand on this beat. Names last one beat: catch it here, or "let" it above this line`, v.line, v.col);
        }
      });
      for (const s of beat.stmts) {
        if (s.type === 'say') {
          s.items.forEach((it) => { if (it.type !== 'str') use(it); });
          use(s.when);
        } else if (s.type === 'stop') use(s.when);
        else if (s.type === 'throw') use(s.value);
        else if (s.type === 'let') {
          use(s.value);
          if (bound.has(s.name)) fail('check', `"${s.name}" is already in your hand on this beat: pick a new name`, s.nameLine, s.nameCol);
          bound.add(s.name);
        }
      }
    }

    // Pass 3: every ball caught goes back up; nothing is thrown that wasn't caught.
    for (const beat of beats) {
      const c = beat.catches.length;
      const th = throwsOf(beat).length;
      if (th < c) {
        fail('check', `This beat catches ${plural(c, 'ball')} but throws ${th}. Every ball you catch has to go back up: a ball that isn't thrown is dropped`, beat.line, beat.col);
      }
      if (th > c) {
        fail('check', `This beat catches ${plural(c, 'ball')} but throws ${th}. You can only throw a ball you're holding`, beat.line, beat.col);
      }
    }

    // Pass 4: the landing pattern. A throw at position i with height h lands at (i + h) mod n.
    const landing = beats.map(() => []);
    let total = 0;
    beats.forEach((beat, i) => {
      for (const th of throwsOf(beat)) {
        landing[(i + th.height) % n].push({ from: i, height: th.height, line: th.line });
        total += th.height;
      }
    });
    for (let j = 0; j < n; j++) {
      const want = beats[j].catches.length;
      const got = landing[j];
      if (got.length === want) continue;
      const list = got.map((g) => `line ${g.line} (up ${g.height})`).join(', ');
      let msg;
      if (got.length === 0) {
        msg = `Nothing lands on this beat, but it catches ${plural(want, 'ball')}: the hand reaches for a ball that never comes`;
      } else if (want === 0) {
        msg = `${got.length === 1 ? 'A ball lands' : `${got.length} balls land`} on this beat (from ${list}) but it catches nothing: ${got.length === 1 ? 'it falls' : 'they fall'} to the floor`;
      } else if (got.length > want) {
        msg = `${got.length} balls land on this beat (from ${list}) but it catches ${want}: that's a collision`;
      } else {
        msg = `Only ${plural(got.length, 'ball')} land${got.length === 1 ? 's' : ''} on this beat (from ${list}) but it catches ${want}: the hand reaches for a ball that never comes`;
      }
      fail('check', `${msg}. A throw on beat i with height h lands on beat (i + h) mod ${n}`, beats[j].line, beats[j].col);
    }

    // Pass 5: the average theorem. Balls in the air = sum of heights / period.
    if (total % n !== 0) {
      // Unreachable once pass 4 holds, kept as a guard.
      fail('check', `Internal: heights sum to ${total}, not a multiple of ${n}`, 1, 1);
    }
    const ballCount = total / n;
    if (prog.balls.length !== ballCount) {
      const heights = beats.map((b) => throwsOf(b).map((t) => t.height)).flat();
      const sum = heights.length <= 40 ? (heights.length ? heights.join(' + ') : '0') : `${heights.length} heights adding up to ${total}`;
      const order = ballCount <= 60 ? describeSchedule(initialSchedule(beats)) : 'too many to list';
      const where = prog.ballsLines.length ? prog.ballsLines[0] : { line: beats[0].line, col: beats[0].col };
      fail('check', `This pattern keeps ${plural(ballCount, 'ball')} in the air, (${sum}) / ${plural(n, 'beat')}, but "balls" lists ${prog.balls.length}.${ballCount ? ` They land in this order: ${order}` : ''}`, where.line, where.col);
    }
    // Only now is the schedule built: its length is the number of values listed in "balls".
    const schedule = initialSchedule(beats);
    if (schedule.length !== ballCount) fail('check', 'Internal: start schedule disagrees with the average theorem', 1, 1);

    return {
      period: n,
      ballCount,
      heightSum: total,
      heights: beats.map((b) => throwsOf(b).map((t) => t.height)),
      beats: beats.map((b) => ({ line: b.line, catches: b.catches.map((c) => c.name), throws: throwsOf(b).map((t) => t.height) })),
      siteswap: beats.map((b) => {
        const hs = throwsOf(b).map((t) => heightName(t.height));
        if (hs.length === 0) return '0';
        if (hs.length === 1) return hs[0];
        return `[${hs.join('')}]`;
      }).join(''),
      schedule: schedule.map((s, idx) => ({ ...s, value: prog.balls[idx].value })),
    };
  }

  function describeSchedule(schedule) {
    const byTime = new Map();
    for (const s of schedule) {
      if (!byTime.has(s.time)) byTime.set(s.time, []);
      byTime.get(s.time).push(s.catchName);
    }
    return [...byTime].map(([t, names]) => `t=${t}: ${names.join(', ')}`).join('; ');
  }

  function plural(k, word) {
    return `${k} ${word}${k === 1 ? '' : 's'}`;
  }

  // ------------------------------------------------------------ evaluator
  function floorDiv(a, b) {
    const q = a / b;
    return (a % b !== 0n && (a < 0n) !== (b < 0n)) ? q - 1n : q;
  }
  function floorMod(a, b) {
    const r = a % b;
    return (r !== 0n && (r < 0n) !== (b < 0n)) ? r + b : r;
  }
  function big(v, e) {
    if (v >= LIMIT || v <= -LIMIT) fail('runtime', `Number too big: Aloft numbers stay below 2^${MAX_BITS} in size`, e.line, e.col);
    return v;
  }
  const truth = (v) => v !== 0n;
  const bool = (b) => (b ? 1n : 0n);

  // Work budget: every expression node evaluated costs one unit. Runs out -> the run halts.
  let work = Infinity;
  let deadline = Infinity;
  let ticks = 0;
  class OutOfWork extends Error {}
  class OutOfTime extends Error {}
  function evaluate(e, env) {
    if (--work < 0) throw new OutOfWork();
    if ((++ticks & 1023) === 0 && Date.now() > deadline) throw new OutOfTime();
    switch (e.type) {
      case 'int': return e.value;
      case 'name': return env[e.name];
      case 'unary':
        if (e.op === '-') return -evaluate(e.arg, env);
        return bool(!truth(evaluate(e.arg, env)));
      case 'if':
        return truth(evaluate(e.cond, env)) ? evaluate(e.then, env) : evaluate(e.else, env);
      case 'call': {
        const vals = e.args.map((a) => evaluate(a, env));
        if (e.fn === 'abs') return vals[0] < 0n ? -vals[0] : vals[0];
        return vals.reduce((m, v) => (e.fn === 'min' ? (v < m ? v : m) : (v > m ? v : m)));
      }
      case 'binary': {
        if (e.op === 'and') return truth(evaluate(e.left, env)) ? bool(truth(evaluate(e.right, env))) : 0n;
        if (e.op === 'or') return truth(evaluate(e.left, env)) ? 1n : bool(truth(evaluate(e.right, env)));
        const a = evaluate(e.left, env);
        const b = evaluate(e.right, env);
        switch (e.op) {
          case '+': return big(a + b, e);
          case '-': return big(a - b, e);
          case '*': return big(a * b, e);
          case '/':
            if (b === 0n) fail('runtime', 'Division by zero', e.line, e.col);
            return floorDiv(a, b);
          case '%':
            if (b === 0n) fail('runtime', 'Remainder by zero (x % 0)', e.line, e.col);
            return floorMod(a, b);
          case '==': return bool(a === b);
          case '!=': return bool(a !== b);
          case '<': return bool(a < b);
          case '<=': return bool(a <= b);
          case '>': return bool(a > b);
          case '>=': return bool(a >= b);
          default: throw new Error(`unknown operator ${e.op}`);
        }
      }
      default: throw new Error(`unknown node ${e.type}`);
    }
  }

  // One say line, built item by item. `room` is how many characters of output are left:
  // if the line reaches it, the line is cut there and the remaining items are not evaluated.
  function sayLine(s, env, room) {
    let text = '';
    for (let k = 0; k < s.items.length; k++) {
      const it = s.items[k];
      if (k) text += ' ';
      text += it.type === 'str' ? it.value : evaluate(it, env).toString();
      if (text.length >= room) {
        let end = room;
        const c = text.charCodeAt(end - 1);
        if (end < text.length && c >= 0xd800 && c <= 0xdbff) end--; // don't split a surrogate pair
        return { text: text.slice(0, end), full: true };
      }
    }
    return { text, full: false };
  }

  // ------------------------------------------------------------- analysis
  function analyze(src) {
    try {
      const prog = typeof src === 'string' ? parse(src) : src;
      const info = check(prog);
      return { ok: true, prog, info };
    } catch (e) {
      if (e instanceof AloftFail) return { ok: false, error: e.info };
      throw e;
    }
  }

  // --------------------------------------------------------------- runner
  // Runs a program. Never throws for a problem in the program: returns
  // { ok, status, output, beats, error, info, trace }.
  //   status: 'stopped' (a stop ran), 'limit' (beat limit), 'output-limit' (lines or characters),
  //   'work-limit', 'time-limit', 'error'
  function run(src, options) {
    const opts = Object.assign({}, DEFAULTS, options || {});
    const a = analyze(src);
    if (!a.ok) return { ok: false, status: 'error', output: [], outputBeats: [], outputChars: 0, beats: 0, error: a.error, info: null, trace: null };
    const { prog, info } = a;
    const beats = prog.beats;
    const n = beats.length;
    const output = [];
    const outputBeats = []; // the time t at which each output line was said
    let outputChars = 0;
    let outputFull = false; // the line or character limit has been reached
    const trace = opts.traceBeats > 0 ? { initial: [], beats: [] } : null;

    // The air: landing time -> balls, in catch order. Balls already up at the
    // start go in first: they were thrown before any throw the program makes.
    const air = new Map();
    const land = (time, ball) => {
      let list = air.get(time);
      if (!list) air.set(time, (list = []));
      list.push(ball);
    };
    info.schedule.forEach((s, id) => {
      land(s.time, { id, value: s.value });
      if (trace) trace.initial.push({ id, value: s.value, time: s.time, throwTime: s.throwTime, height: s.height });
    });

    let t = 0;
    let status = 'limit';
    let error = null;
    let rec = null;
    work = opts.maxWork;
    deadline = Date.now() + opts.maxMillis;
    try {
      for (; t < opts.maxBeats; t++) {
        const beat = beats[t % n];
        const caught = air.get(t) || [];
        air.delete(t);
        rec = trace && t < opts.traceBeats ? { t, beat: t % n, caught: caught.map((b) => ({ id: b.id, value: b.value })), thrown: [], said: [] } : null;
        if (rec) trace.beats.push(rec);
        if (caught.length !== beat.catches.length) {
          // Unreachable for a checked program; the checker's theorem says so and the tests try hard to break it.
          fail('runtime', `Internal: ${caught.length} balls landed where ${beat.catches.length} were expected`, beat.line, beat.col);
        }
        const env = Object.create(null);
        beat.catches.forEach((c, k) => { env[c.name] = caught[k].value; });
        let k = 0;
        let stopped = false;
        for (const s of beat.stmts) {
          if (s.type === 'let') env[s.name] = evaluate(s.value, env);
          else if (s.type === 'throw') {
            const value = evaluate(s.value, env);
            const ball = { id: caught[k].id, value };
            land(t + s.height, ball);
            if (rec) rec.thrown.push({ id: ball.id, value, height: s.height });
            k++;
          } else if (s.type === 'say') {
            if (!s.when || truth(evaluate(s.when, env))) {
              const said = sayLine(s, env, opts.maxOutputChars - outputChars);
              output.push(said.text);
              outputBeats.push(t);
              outputChars += said.text.length;
              if (rec) rec.said.push(said.text);
              if (said.full || outputChars >= opts.maxOutputChars || output.length >= opts.maxOutput) outputFull = true;
            }
          } else if (s.type === 'stop') {
            if (!s.when || truth(evaluate(s.when, env))) {
              stopped = true;
              break;
            }
          }
          if (outputFull) break;
        }
        if (stopped) {
          if (rec) rec.stopped = true;
          status = 'stopped';
          t++;
          break;
        }
        if (outputFull) {
          status = 'output-limit';
          t++;
          break;
        }
      }
    } catch (e) {
      if (e instanceof OutOfWork || e instanceof OutOfTime) {
        status = e instanceof OutOfWork ? 'work-limit' : 'time-limit';
        t++;
      } else {
        if (!(e instanceof AloftFail)) throw e;
        status = 'error';
        error = Object.assign({}, e.info, { time: t });
        if (rec) rec.error = true;
        t++;
      }
    } finally {
      work = Infinity;
      deadline = Infinity;
    }
    return { ok: status !== 'error', status, output, outputBeats, outputChars, beats: t, error, info, trace };
  }

  // ------------------------------------------------------------ formatter
  // Canonical source for a parsed program (comments are not kept).
  const PREC = { if: 0, or: 1, and: 2, not: 3, cmp: 4, add: 5, mul: 6, neg: 7, atom: 8 };
  function precOf(e) {
    if (e.type === 'if') return PREC.if;
    if (e.type === 'unary') return e.op === 'not' ? PREC.not : PREC.neg;
    if (e.type === 'binary') {
      if (e.op === 'or') return PREC.or;
      if (e.op === 'and') return PREC.and;
      if (e.op === '+' || e.op === '-') return PREC.add;
      if (e.op === '*' || e.op === '/' || e.op === '%') return PREC.mul;
      return PREC.cmp;
    }
    return PREC.atom;
  }
  function fmtExpr(e, min) {
    let s;
    const p = precOf(e);
    switch (e.type) {
      case 'int': s = e.value.toString(); break;
      case 'name': s = e.name; break;
      case 'call': s = `${e.fn}(${e.args.map((a) => fmtExpr(a, 0)).join(', ')})`; break;
      case 'if': s = `if ${fmtExpr(e.cond, 0)} then ${fmtExpr(e.then, 0)} else ${fmtExpr(e.else, 0)}`; break;
      case 'unary':
        // A minus directly inside a minus prints as "- -x", not "-(-x)": brackets would
        // add nesting levels, and deep but valid source must format to valid source.
        s = e.op === 'not' ? `not ${fmtExpr(e.arg, PREC.not)}` : `-${e.arg.type === 'unary' && e.arg.op === '-' ? ' ' : ''}${fmtExpr(e.arg, PREC.neg)}`;
        break;
      case 'binary': {
        const nonAssoc = p === PREC.cmp;
        s = `${fmtExpr(e.left, nonAssoc ? p + 1 : p)} ${e.op} ${fmtExpr(e.right, p + 1)}`;
        break;
      }
      default: throw new Error(`unknown node ${e.type}`);
    }
    return p < min ? `(${s})` : s;
  }
  function format(prog) {
    const lines = [];
    let at = 0;
    for (const bl of prog.ballsLines) {
      const vals = prog.balls.slice(at, at + bl.count).map((b) => b.value.toString());
      at += bl.count;
      lines.push(vals.length ? `balls ${vals.join(' ')}` : 'balls');
    }
    prog.beats.forEach((beat, i) => {
      if (i > 0 || lines.length) lines.push('');
      lines.push(beat.catches.length ? `catch ${beat.catches.map((c) => c.name).join(' ')}` : 'catch');
      for (const s of beat.stmts) {
        if (s.type === 'say') {
          const items = s.items.map((it) => (it.type === 'str' ? `"${it.value}"` : fmtExpr(it, 0))).join(', ');
          lines.push(`  say${items ? ` ${items}` : ''}${s.when ? ` when ${fmtExpr(s.when, 0)}` : ''}`);
        } else if (s.type === 'stop') lines.push(`  stop${s.when ? ` when ${fmtExpr(s.when, 0)}` : ''}`);
        else if (s.type === 'throw') lines.push(`  throw ${fmtExpr(s.value, 0)} up ${s.height}`);
        else if (s.type === 'let') lines.push(`  let ${s.name} = ${fmtExpr(s.value, 0)}`);
      }
    });
    return `${lines.join('\n')}\n`;
  }

  // Parse errors as values, for callers that prefer not to catch.
  function tryParse(src) {
    try {
      return { ok: true, prog: parse(src) };
    } catch (e) {
      if (e instanceof AloftFail) return { ok: false, error: e.info };
      throw e;
    }
  }

  return {
    KEYWORDS, MAX_HEIGHT, MAX_BITS, MAX_DEPTH, DEFAULTS,
    lex, parse, tryParse, check, analyze, run, format, evaluate, floorDiv, floorMod, heightName, initialSchedule,
  };
});
