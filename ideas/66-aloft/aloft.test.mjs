// Tests for Aloft: every lesson, the parser, every error, the semantics rule by rule,
// runaway programs, and the language's claimed properties over many generated programs,
// against a reference interpreter written separately from the spec in the README.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const A = require('./aloft.js');
const LESSONS = require('./examples.js');
const HERE = path.dirname(fileURLToPath(import.meta.url));

// ------------------------------------------------------------------ helpers
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, xs) => xs[Math.floor(r() * xs.length)];
const int = (r, a, b) => a + Math.floor(r() * (b - a + 1));

// Run one expression on an empty beat and return what it says (or the error).
function sayOf(expr, opts) {
  const r = A.run(`catch\n  say ${expr}\n  stop\n`, opts);
  return r.error ? r.error : r.output[0];
}
// Strip source positions from an AST so two parses can be compared.
function strip(x) {
  if (Array.isArray(x)) return x.map(strip);
  if (x && typeof x === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(x)) {
      if (['line', 'col', 'hLine', 'hCol', 'nameLine', 'nameCol'].includes(k)) continue;
      o[k] = strip(v);
    }
    return o;
  }
  return x;
}
function errorOf(src) {
  const r = A.analyze(src);
  assert.equal(r.ok, false, `expected an error for:\n${src}`);
  return r.error;
}

// ------------------------------------------------------------------ lessons
test('every lesson produces its documented result', () => {
  assert.equal(LESSONS.length, 12);
  for (const ex of LESSONS) {
    const r = A.run(ex.src);
    const e = ex.expect;
    if (e.error) {
      assert.equal(r.status, 'error', ex.id);
      assert.equal(r.error.kind, e.error.kind, ex.id);
      assert.equal(r.error.line, e.error.line, ex.id);
      assert.equal(r.error.col, e.error.col, ex.id);
      assert.ok(r.error.message.includes(e.error.includes), `${ex.id}: ${r.error.message}`);
      continue;
    }
    assert.equal(r.status, e.status, ex.id);
    assert.equal(r.beats, e.beats, ex.id);
    assert.equal(r.info.siteswap, e.siteswap, ex.id);
    assert.equal(r.info.ballCount, e.balls, ex.id);
    assert.deepEqual(r.output, e.output, ex.id);
  }
});

test('lesson claims: the stories the lesson texts tell are true', () => {
  const byId = Object.fromEntries(LESSONS.map((l) => [l.id, l]));
  // Broken on purpose: swapping any two heights makes it run.
  const broken = byId.broken.src;
  const hs = [...broken.matchAll(/up (\d)/g)].map((m) => m[1]);
  assert.deepEqual(hs, ['3', '2', '1']);
  for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) {
    const s = hs.slice();
    [s[i], s[j]] = [s[j], s[i]];
    let k = 0;
    const fixed = broken.replace(/up (\d)/g, () => `up ${s[k++]}`);
    const r = A.run(fixed);
    assert.equal(r.status, 'stopped', `swap ${i},${j}: ${r.error && r.error.message}`);
  }
  // 531: ball 2 only ever goes up 3; balls 1 and 3 take turns at 5 and 1.
  const out = A.run(byId['531'].src, { maxBeats: 3000 }).output;
  for (const line of out) {
    const [, ball, h] = line.match(/ball (\d) goes up (\d)/);
    if (ball === '2') assert.equal(h, '3');
    else assert.notEqual(h, '3');
  }
  // Remembering twice: the same numbers, one more ball.
  assert.deepEqual(A.run(byId.twice.src).output.slice(0, 11), A.run(byId['two-at-once'].src).output.slice(1, 12));
  // FRACTRAN: 2^a 3^b ends at 5^(ab).
  for (let a = 0; a <= 4; a++) {
    for (let b = 0; b <= 4; b++) {
      const start = 2n ** BigInt(a) * 3n ** BigInt(b);
      const r = A.run(byId.fractran.src.replace('balls 648', `balls ${start}`), { maxBeats: 100000 });
      assert.equal(r.status, 'stopped');
      assert.deepEqual(r.output, [String(5n ** BigInt(a * b))], `${a} x ${b}`);
    }
  }
  // e: the digits are e's.
  assert.equal(A.run(byId.e.src).output.join(''), '718281828');
  // Josephus: agrees with a direct simulation of the circle.
  const circle = [1, 2, 3, 4, 5, 6, 7];
  const order = [];
  let at = 0;
  while (circle.length) {
    at = (at + 2) % circle.length;
    order.push(String(circle.splice(at, 1)[0]));
  }
  assert.deepEqual(A.run(byId.josephus.src).output, order);
  // Window: the third column is the sum of the last three squares.
  for (const line of A.run(byId.window.src).output) {
    const [k, sq, s] = line.split(' ').map(Number);
    assert.equal(sq, k * k);
    assert.equal(s, [k, k - 1, k - 2].filter((x) => x > 0).reduce((t, x) => t + x * x, 0));
  }
});

// ------------------------------------------------------------------ parser
test('parser: format and parse round-trip on every lesson', () => {
  for (const ex of LESSONS) {
    const p = A.parse(ex.src);
    const f = A.format(p);
    assert.deepEqual(strip(A.parse(f)), strip(p), ex.id);
    assert.equal(A.format(A.parse(f)), f, `${ex.id}: format is idempotent`);
  }
});

test('parser: deep but valid source formats to valid source (nested minus prints as "- -x")', () => {
  for (const k of [1, 2, 3, 150, 199]) {
    const src = `catch\n  say ${'-'.repeat(k)}1, 2 - -3, - -(4 + 1)\n  stop\n`;
    const p = A.parse(src);
    const f = A.format(p);
    assert.deepEqual(strip(A.parse(f)), strip(p), `${k} minus signs`);
    assert.deepEqual(A.run(f).output, A.run(src).output, `${k} minus signs`);
  }
  assert.equal(A.format(A.parse('catch\n  say - - -x\n')).trim().split('\n')[1], '  say - - -x');
});

test('parser: positions, comments, CRLF, tabs, continuation and wide characters', () => {
  const p = A.parse('# c\r\nballs 1 -2\r\n\tcatch  a b # two\r\n  say "é😀", a when (a\r\n  > 0)\r\n  throw a up 1\r\n  throw b up 1\r\n');
  assert.deepEqual(p.balls.map((b) => b.value), [1n, -2n]);
  assert.equal(p.beats[0].line, 3);
  assert.equal(p.beats[0].col, 2); // a tab is one column
  assert.deepEqual(p.beats[0].catches.map((c) => [c.name, c.line, c.col]), [['a', 3, 9], ['b', 3, 11]]);
  const say = p.beats[0].stmts[0];
  assert.equal(say.items[0].value, 'é😀');
  assert.equal(say.items[1].col, 13); // the emoji counts as one column
  assert.equal(say.when.line, 5); // the comparison sits on the continued line
  assert.equal(say.when.col, 3);
  assert.equal(p.beats[0].stmts.length, 3);
  // An error after a wide character points at the right column.
  assert.deepEqual(pos(errorOf('catch\n  say "😀" @\n')), [2, 11]);
});

function pos(e) {
  return [e.line, e.col];
}

test('errors: every syntax and check error has the documented message and position', () => {
  const cases = [
    // [source, kind, line, col, fragment]
    ['', 'syntax', 1, 1, 'at least one beat'],
    ['balls 1\n', 'syntax', 1, 1, 'at least one beat'],
    ['# only a comment\n\n', 'syntax', 1, 1, 'at least one beat'],
    ['catch\n  say "a" "b"\n', 'syntax', 2, 11, 'say items are separated by commas'],
    ['x = 3\n', 'syntax', 1, 1, 'There are no variables in Aloft'],
    ['catch\n  x = 3\n', 'syntax', 2, 3, 'There are no variables'],
    ['catch\n  say 1 @ 2\n', 'syntax', 2, 9, 'Unexpected character "@"'],
    ['catch\n  say "abc\n', 'syntax', 2, 7, 'never ends'],
    ['catch\n  say (1 +\n  2\n', 'syntax', 2, 7, 'never closed'],
    ['catch\n  say 3x\n', 'syntax', 2, 7, "can't run into letters"],
    ['catch\n  say 1 ! 2\n', 'syntax', 2, 9, '!='],
    ['catch\n  say 1\u00a0+ 2\n', 'syntax', 2, 8, 'invisible character U+00A0'],
    ['catch\n  say 1 < 2 < 3\n', 'syntax', 2, 13, "don't chain"],
    ['catch\n  say 1 = 1\n', 'syntax', 2, 9, 'write =='],
    ['catch\n  say if 1 then 2\n', 'syntax', 2, 18, 'needs an "else"'],
    ['catch\n  say if 1 2 else 3\n', 'syntax', 2, 12, '"then"'],
    ['catch\n  say "a" + 1\n', 'syntax', 2, 11, 'Strings can only be said'],
    ['catch\n  say 1 + "a"\n', 'syntax', 2, 11, 'Strings can only be said'],
    ['catch\n  say 1 2\n', 'syntax', 2, 9, 'each statement goes on its own line'],
    ['catch\n  say min 1\n', 'syntax', 2, 11, 'brackets'],
    ['catch\n  say (1\n  ', 'syntax', 2, 7, 'never closed'],
    ['catch\n  say 1)\n', 'syntax', 2, 8, 'Unexpected ")"'],
    ['catch\n  say then\n', 'syntax', 2, 7, 'keyword "then"'],
    ['catch up\n', 'syntax', 1, 7, '"up" is a keyword'],
    ['catch 3\n', 'syntax', 1, 7, 'name of a caught ball'],
    ['catch\n  let up = 1\n', 'syntax', 2, 7, '"up" is a keyword'],
    ['catch\n  let x 1\n', 'syntax', 2, 9, 'Expected "="'],
    ['catch x\n  throw x\n', 'syntax', 2, 10, 'needs a height'],
    ['catch x\n  throw x up y\n', 'syntax', 2, 14, 'number written out'],
    ['catch x\n  throw x up 0\n', 'syntax', 2, 14, 'at least 1'],
    ['catch x\n  throw x up 10000\n', 'syntax', 2, 14, 'at most 9999'],
    ['catch x\n  throw x up 1 when x\n', 'syntax', 2, 16, 'can\'t have "when"'],
    ['say 1\n', 'syntax', 1, 1, 'has to belong to a beat'],
    ['catch\nballs 1\n', 'syntax', 2, 1, 'go at the top'],
    ['balls 1 x\ncatch\n', 'syntax', 1, 9, 'plain whole numbers'],
    ['frobnicate\n', 'syntax', 1, 1, 'Each line starts with one of'],
    [`catch\n  say ${'('.repeat(300)}1${')'.repeat(300)}\n`, 'syntax', 2, 207, 'nested too deeply'],
    [`catch\n  say ${Array(300).fill('1').join(' + ')}\n`, 'syntax', 2, 7, 'nested too deeply'],
    [`catch\n  say ${'1'.repeat(1300)}\n`, 'syntax', 2, 7, 'too big'],
    // checker
    ['catch\n  say x\n', 'check', 2, 7, '"x" isn\'t in your hand'],
    ['balls 1\ncatch x\n  throw x up 2\ncatch y\n  say x\n  throw y up 2\n', 'check', 5, 7, 'Names last one beat'],
    ['catch\n  say y\n  let y = 1\n', 'check', 2, 7, '"y" isn\'t in your hand'],
    ['catch x x\n', 'check', 1, 9, 'caught twice'],
    ['catch x\n  let x = 1\n', 'check', 2, 7, 'already in your hand'],
    ['catch\n  let a = 1\n  let a = 2\n', 'check', 3, 7, 'already in your hand'],
    ['catch\n  say abs(1, 2)\n', 'check', 2, 7, 'abs takes exactly one'],
    ['catch\n  say min(1)\n', 'check', 2, 7, 'min takes two or more'],
    ['catch\n  say max(1)\n', 'check', 2, 7, 'max takes two or more'],
    ['balls 1\ncatch x\n', 'check', 2, 1, 'throws 0'],
    ['balls 1\ncatch x\n  throw x up 1\n  throw x up 1\n', 'check', 2, 1, "only throw a ball you're holding"],
    ['catch\n  throw 1 up 1\n', 'check', 1, 1, "only throw a ball you're holding"],
    ['balls 1 2\ncatch x\n  throw x up 3\ncatch x\n  throw x up 2\ncatch x\n  throw x up 1\n', 'check', 2, 1, '3 balls land on this beat'],
    ['balls 1\ncatch x\n  throw x up 2\ncatch x\n  throw x up 1\n', 'check', 2, 1, '2 balls land'],
    ['balls 1\ncatch x\n  throw x up 2\ncatch x\n  throw x up 2\n', 'check', 1, 1, 'keeps 2 balls in the air, (2 + 2) / 2 beats'],
    ['balls 1\ncatch x\n  throw x up 1\ncatch y\n  throw y up 1\ncatch z\n  throw z up 2\n', 'check', 2, 1, 'Nothing lands on this beat'],
    ['balls 1\ncatch\ncatch x\n  throw x up 1\n', 'check', 2, 1, 'A ball lands on this beat (from line 4 (up 1)) but it catches nothing: it falls to the floor'],
    ['balls 1 2\ncatch a b\n  throw a up 2\n  throw b up 1\ncatch x\n  throw x up 2\n', 'check', 2, 1, 'Only 1 ball lands on this beat (from line 3 (up 2)) but it catches 2'],
    ['balls 1 2\ncatch x\n  throw x up 3\n', 'check', 1, 1, 'keeps 3 balls in the air, (3) / 1 beat, but "balls" lists 2'],
    ['catch x\n  throw x up 3\n', 'check', 1, 1, 'keeps 3 balls'],
    ['balls 1\nballs 2\ncatch a b\n  throw a up 1\n  throw b up 3\n', 'check', 1, 1, 'keeps 4 balls'],
    ['balls 7\ncatch\n  stop\n', 'check', 1, 1, 'keeps 0 balls'],
  ];
  for (const [src, kind, line, col, frag] of cases) {
    const e = errorOf(src);
    assert.equal(e.kind, kind, `${JSON.stringify(src)}: ${e.message}`);
    assert.deepEqual(pos(e), [line, col], `${JSON.stringify(src)}: ${e.message}`);
    assert.ok(e.message.includes(frag), `${JSON.stringify(src)}: "${e.message}" lacks "${frag}"`);
  }
});

test('errors: a wrong ball count says the landing order by name', () => {
  const e = errorOf('balls 1\ncatch old sum k\n  throw old up 3\n  throw sum up 1\n  throw k up 1\n');
  assert.ok(e.message.includes('keeps 5 balls in the air, (3 + 1 + 1) / 1 beat'), e.message);
  assert.ok(e.message.includes('t=0: old, sum, k; t=1: old; t=2: old'), e.message);
});

test('errors: the checker reports the first pass that fails, in the documented order', () => {
  // names before counts before landing before ball count
  assert.ok(errorOf('catch x\n  say y\n').message.includes("isn't in your hand"));
  assert.ok(errorOf('balls 1\ncatch x\ncatch y\n  throw y up 5\n').message.includes('throws 0'));
  assert.ok(errorOf('catch x\n  throw x up 1\ncatch y\n  throw y up 1\ncatch z\n  throw z up 2\n').message.includes('land'));
});

test('errors: within the syntax pass the first failure in reading order wins, lexical or grammatical', () => {
  // The lexer is lazy, so a bad character or an unterminated string on a later line
  // can't hide a grammar error (and its teaching message) on an earlier one.
  const cases = [
    ['catch\n  x = 3\n  say "oops\n', 2, 3, 'There are no variables in Aloft'],
    ['catch\n  say 1 +\n  say (2\n', 2, 10, 'Expected a value but found the end of the line'],
    ['catch\n  say 1 2\n  say 12ab\n', 2, 9, 'each statement goes on its own line'],
    ['catch\n  frob\n  say 1 @ 2\n', 2, 3, 'Each line starts with one of'],
    ['catch\n  x 3abc\n', 2, 3, 'Each line starts with one of'], // the lookahead token is unreadable, but x comes first
    // ...and a lexical error still wins when it comes first.
    ['catch\n  say "oops\n  x = 3\n', 2, 7, 'never ends'],
    ['catch\n  say 1 @ 2\n  say 1 2\n', 2, 9, 'Unexpected character "@"'],
    // A "(" that is never closed counts as failing at the bracket, so a forgotten ")"
    // is named as such instead of as a puzzling error on a later line.
    ['catch\n  say (1 +\n  2\n', 2, 7, 'never closed'],
    ['catch\n  say (1\n  say 2\n', 2, 7, 'never closed'],
    ['catch\n  let x = (1 + 2\n  throw x up 1\n', 2, 11, 'never closed'],
    ['catch\n  say "(" # (\n  say (2 @\n', 3, 7, 'never closed'], // brackets in strings and comments don't count
    ['catch\n  say "😀(", (1\n', 2, 13, 'never closed'],
    ['catch\n  say 1 +\n  say (2 @\n', 2, 10, 'Expected a value'], // ...and an earlier error still wins
  ];
  for (const [src, line, col, frag] of cases) {
    const e = errorOf(src);
    assert.equal(e.kind, 'syntax', JSON.stringify(src));
    assert.deepEqual(pos(e), [line, col], `${JSON.stringify(src)}: ${e.message}`);
    assert.ok(e.message.includes(frag), `${JSON.stringify(src)}: "${e.message}" lacks "${frag}"`);
  }
  // The eager token list is the same stream.
  assert.deepEqual(A.lex('catch\n  say (1\n  + 2)\n').map((t) => t.type), ['kw', 'nl', 'kw', 'op', 'int', 'op', 'int', 'op', 'nl', 'eof']);
  // Remove one ")" from a valid program: the parser names the same unclosed bracket as the
  // eager lexer, which only finds it at the end of the input.
  const r = rng(1729);
  let tried = 0;
  for (let i = 0; i < 400; i++) {
    const src = printProgram(genProgram(r));
    const closers = [...src.matchAll(/\)/g)].map((m) => m.index);
    if (!closers.length) continue;
    const at = pick(r, closers);
    const broken = src.slice(0, at) + src.slice(at + 1);
    let eager = null;
    try {
      A.lex(broken);
    } catch (e) {
      eager = e.info;
    }
    const e = errorOf(broken);
    assert.ok(eager && eager.message.includes('never closed'), broken);
    assert.deepEqual([e.message, e.line, e.col], [eager.message, eager.line, eager.col], broken);
    tried++;
  }
  assert.ok(tried > 300, `${tried} programs`);
});

// ---------------------------------------------------------------- semantics
test('semantics: / and % round down, and agree with an independent formula', () => {
  const fmod = (a, b) => ((a % b) + b) % b;
  for (let a = -12n; a <= 12n; a++) {
    for (let b = -5n; b <= 5n; b++) {
      if (b === 0n) continue;
      const m = fmod(a, b);
      assert.equal(sayOf(`${a} % ${b}`), String(m), `${a} % ${b}`);
      assert.equal(sayOf(`${a} / ${b}`), String((a - m) / b), `${a} / ${b}`);
      assert.equal(sayOf(`(${a}) / (${b}) * (${b}) + (${a}) % (${b})`), String(a));
    }
  }
  assert.equal(sayOf('-7 / 2'), '-4');
  assert.equal(sayOf('-7 % 2'), '1');
  assert.equal(sayOf('7 % -2'), '-1');
  const z = sayOf('1 + 5 / (3 - 3)');
  assert.deepEqual([z.kind, z.line, z.col, z.message], ['runtime', 2, 13, 'Division by zero']);
  const zm = sayOf('5 % 0');
  assert.deepEqual([zm.kind, zm.col], ['runtime', 9]);
});

test('semantics: precedence and associativity', () => {
  const table = [
    ['2 - 3 - 4', '-5'], ['2 * 3 + 4', '10'], ['2 + 3 * 4', '14'], ['20 / 2 / 5', '2'], ['20 / (2 / 5)', null],
    ['-2 * 3', '-6'], ['- -3', '3'], ['2 - -3', '5'], ['-7 / 2', '-4'], ['-(7 / 2)', '-3'],
    ['1 + 2 == 3', '1'], ['not 1 == 2', '1'], ['not 0 and 0', '0'], ['not (0 and 0)', '1'],
    ['1 or 0 and 0', '1'], ['(1 or 0) and 0', '0'], ['0 == 0 and 1 < 2', '1'],
    ['if 1 then 2 else 3 + 4', '2'], ['if 0 then 2 else 3 + 4', '7'], ['(if 0 then 2 else 3) + 4', '7'],
    ['if 0 then 1 else if 0 then 2 else 3', '3'], ['if if 0 then 0 else 1 then 5 else 6', '5'],
    ['min(3, -1, 2)', '-1'], ['max(3, -1, 2)', '3'], ['abs(-9)', '9'], ['abs(9)', '9'], ['min(2 + 2, 3)', '3'],
    ['(1 < 2) + (2 < 1) + (3 >= 3) + (3 <= 2) + (4 != 4) + (4 > 3)', '3'],
    ['007', '7'], ['1 + 2 * 3 % 4', '3'],
  ];
  for (const [e, want] of table) {
    const got = sayOf(e);
    if (want === null) assert.equal(got.kind, 'runtime', e);
    else assert.equal(got, want, e);
  }
});

test('semantics: truth values are 1 and 0, and/or/if are lazy', () => {
  assert.equal(sayOf('5 and 7'), '1');
  assert.equal(sayOf('0 or -3'), '1');
  assert.equal(sayOf('not 5'), '0');
  assert.equal(sayOf('0 and 1 / 0'), '0');
  assert.equal(sayOf('1 or 1 / 0'), '1');
  assert.equal(sayOf('if 1 then 2 else 1 / 0'), '2');
  assert.equal(sayOf('if 0 then 1 / 0 else 3'), '3');
  assert.equal(sayOf('1 and 1 / 0').kind, 'runtime');
});

test('semantics: say joins items with spaces; say and stop take when', () => {
  const r = A.run('catch\n  say "a", 1 + 1, "b c"\n  say\n  say "x" when 0\n  say "y" when 2\n  stop when 0\n  say "z"\n  stop\n  say "never"\n');
  assert.deepEqual(r.output, ['a 2 b c', '', 'y', 'z']);
  assert.equal(r.status, 'stopped');
  assert.equal(r.beats, 1);
});

test('semantics: beats run in a loop, t mod n; let lasts the rest of one beat', () => {
  const r = A.run('balls 0\ncatch n\n  let m = n * 10\n  say "A", m\n  throw n + 1 up 1\ncatch n\n  say "B", n\n  throw n + 1 up 1\ncatch n\n  say "C", n\n  stop when n > 4\n  throw n + 1 up 1\n');
  assert.deepEqual(r.output, ['A 0', 'B 1', 'C 2', 'A 30', 'B 4', 'C 5']);
  assert.equal(r.beats, 6);
});

test('semantics: a stop ends the run immediately, mid-beat', () => {
  const r = A.run('balls 1\ncatch n\n  say n\n  stop when n == 2\n  say "after", n\n  throw n + 1 up 1\n');
  assert.deepEqual(r.output, ['1', 'after 1', '2']);
  assert.equal(r.beats, 2);
});

test('semantics: a throw at time t with height h lands at t + h, and the ball keeps its value', () => {
  // One ball thrown up 7 on a 1-beat loop: 7 balls, each seen once every 7 beats.
  const r = A.run(`balls ${[10, 20, 30, 40, 50, 60, 70].join(' ')}\ncatch x\n  say x\n  stop when x > 100\n  throw x + 1 up 7\n`);
  assert.deepEqual(r.output.slice(0, 15), ['10', '20', '30', '40', '50', '60', '70', '11', '21', '31', '41', '51', '61', '71', '12']);
});

test('semantics: balls landing together are caught in the order they were thrown', () => {
  // The up-1 throw is written first, but the up-3 ball was thrown earlier, so it is caught first.
  const r = A.run('balls 900 1 901 902\ncatch a b\n  say a, b\n  stop when b == 6\n  throw b + 1 up 1\n  throw b * 100 up 3\n');
  assert.deepEqual(r.output, ['900 1', '901 2', '902 3', '100 4', '200 5', '300 6']);
  // Thrown on the same beat at the same height: the order of the throw lines.
  const s = A.run('balls 1 2\ncatch a b\n  say a, b\n  stop when a > 20\n  throw b + 10 up 1\n  throw a + 10 up 1\n');
  assert.deepEqual(s.output, ['1 2', '12 11', '21 22']);
});

test('semantics: balls lists the values in the air at the start, in landing order (excited pattern 51)', () => {
  // 51: at the start balls land at t = 0, 1 and 3; t = 2 catches the ball thrown at t = 1.
  const src = 'balls 10 20 30\ncatch x\n  say x\n  throw x up 5\ncatch x\n  say x\n  throw x up 1\n';
  const r = A.run(src, { maxBeats: 10 });
  assert.equal(r.status, 'limit');
  assert.deepEqual(r.output, ['10', '20', '20', '30', '30', '10', '10', '20', '20', '30']);
  assert.deepEqual(r.info.schedule.map((s) => [s.time, s.throwTime, s.value]), [[0, -1, 10n], [1, -4, 20n], [3, -2, 30n]]);
  // Several balls lines are one list.
  const two = A.run('balls 10\nballs 20\nballs 30\ncatch x\n  say x\n  throw x up 5\ncatch x\n  say x\n  throw x up 1\n', { maxBeats: 10 });
  assert.deepEqual(two.output, r.output);
});

test('semantics: numbers are exact up to 2^4096 and an error beyond', () => {
  const p = A.run('balls 1\ncatch x\n  say x when x > 10 ** 0\n  stop when x == 0\n  throw x up 1\n');
  assert.equal(p.error.kind, 'syntax'); // there is no ** operator
  const big = A.run('balls 2\ncatch x\n  say x\n  throw x * x up 1\n');
  assert.equal(big.status, 'error');
  assert.equal(big.error.kind, 'runtime');
  assert.deepEqual([big.error.line, big.error.col, big.error.time], [4, 11, 11]);
  assert.equal(big.output.length, 12);
  assert.equal(big.output[11], (2n ** 2048n).toString()); // 2^(2^11) is still fine
  const edge = A.run(`catch\n  say ${(2n ** 4096n - 1n).toString()} - 1\n  stop\n`);
  assert.equal(edge.output[0], (2n ** 4096n - 2n).toString());
  assert.equal(sayOf(`${(2n ** 4096n - 1n).toString()} + 1`).kind, 'runtime');
  assert.equal(sayOf(`-${(2n ** 4096n - 1n).toString()} - 1`).kind, 'runtime');
});

// ------------------------------------------------------------------ runaways
test('runaways: every kind of runaway stops cleanly and quickly', () => {
  const t0 = Date.now();
  const forever = A.run('balls 1\ncatch x\n  throw x + 1 up 1\n');
  assert.equal(forever.status, 'limit');
  assert.equal(forever.beats, A.DEFAULTS.maxBeats);
  const long = A.run('balls 1\ncatch x\n  throw x + 1 up 1\n', { maxBeats: 100000 });
  assert.equal(long.beats, 100000);
  const flood = A.run('balls 1\ncatch x\n  say x\n  say x\n  throw x up 1\n', { maxOutput: 500 });
  assert.equal(flood.status, 'output-limit');
  assert.equal(flood.output.length, 500);
  const heavy = A.run(`balls 1\ncatch x\n  say min(${Array(20000).fill('x').join(', ')})\n  throw x up 1\n`, { maxBeats: 100000 });
  assert.equal(heavy.status, 'work-limit');
  // Big-number arithmetic is costly per step, so a wall-clock guard exists for interactive use.
  const big = (2n ** 2047n - 12345n).toString();
  const slowSrc = `balls ${big}\ncatch x\n  let y = x * x / x * x / x * x / x\n  throw y up 1\n`;
  const t1 = Date.now();
  const slow = A.run(slowSrc, { maxBeats: 100000, maxMillis: 150 });
  assert.equal(slow.status, 'time-limit');
  assert.ok(Date.now() - t1 < 1500, `time guard took ${Date.now() - t1} ms`);
  assert.equal(A.DEFAULTS.maxMillis, Infinity, 'no time limit by default: runs are deterministic');
  const grow = A.run('balls 3\ncatch x\n  throw x * x up 1\n');
  assert.equal(grow.status, 'error');
  const huge = A.analyze(`catch ${Array.from({ length: 400 }, (_, i) => `a${i}`).join(' ')}\n${Array.from({ length: 400 }, (_, i) => `  throw a${i} up 9999`).join('\n')}\n`);
  assert.ok(huge.error.message.includes('3999600 balls'));
  assert.ok(Date.now() - t0 < 8000, `took ${Date.now() - t0} ms`);
});

test('runaways: output is capped in characters as well as lines, so a tiny program cannot flood the page', () => {
  const PLAY = { maxBeats: 10000, maxOutput: 2000, maxOutputChars: 200000, maxMillis: 600 }; // the playground's options
  const ui = fs.readFileSync(path.join(HERE, 'ui.js'), 'utf8');
  assert.match(ui, /const MAX_OUTPUT = 2000;/);
  assert.match(ui, /const MAX_OUTPUT_CHARS = 200000;/);
  assert.match(ui, /maxOutputChars: MAX_OUTPUT_CHARS/);
  // A 328-byte form of the reviewer's program: 60 copies of a 978-digit number per line. Without a
  // character cap it said about 28 MB inside the 0.6 s time guard.
  const b8 = (x) => Array(8).fill(x).join('*');
  const digits = `balls 0\ncatch k\n  let a = 3\n  let b = ${b8('a')}\n  let c = ${b8('b')}\n  let d = ${b8('c')}\n  let e = d*d*d*d\n  say ${Array(60).fill('e').join(', ')}\n  throw k + 1 up 1\n`;
  assert.equal(digits.length, 328);
  const t0 = Date.now();
  const r = A.run(digits, PLAY);
  assert.equal(r.status, 'output-limit');
  assert.equal(r.outputChars, 200000);
  assert.equal(r.output.reduce((n, l) => n + l.length, 0), 200000);
  assert.equal(r.beats, 4);
  assert.equal(r.output[0], Array(60).fill((3n ** 2048n).toString()).join(' '));
  assert.ok(r.output[3].length < r.output[0].length, 'the line that reached the limit is cut');
  // Strings cost no work units, so only the character cap stops this one (it said 160 MB before).
  const strings = `catch\n  say "${'x'.repeat(40000)}", "${'x'.repeat(40000)}"\n`;
  const s = A.run(strings, PLAY);
  assert.deepEqual([s.status, s.beats, s.outputChars], ['output-limit', 3, 200000]);
  // A line that reaches the limit stops there: its later items are not evaluated.
  const cut = A.run(`catch\n  say "${'y'.repeat(150)}", 1 / 0\n`, { maxOutputChars: 100 });
  assert.deepEqual([cut.status, cut.output, cut.error], ['output-limit', ['y'.repeat(100)], null]);
  // The trace (what the replay shows) holds the cut line too.
  const tr = A.run(`catch\n  say "${'z'.repeat(150)}"\n`, { maxOutputChars: 100, traceBeats: 5 });
  assert.equal(tr.trace.beats[0].said[0].length, 100);
  // A cut never splits a character outside the Basic Multilingual Plane.
  const emoji = A.run('catch\n  say "😀😀😀"\n', { maxOutputChars: 3 });
  assert.deepEqual([emoji.status, emoji.output], ['output-limit', ['😀']]);
  // Exactly reaching the limit counts as reaching it, as with lines.
  const exact = A.run('catch\n  say "abcd"\n', { maxOutputChars: 4 });
  assert.deepEqual([exact.status, exact.output, exact.beats], ['output-limit', ['abcd'], 1]);
  // The module's own default is larger, and every lesson is far below both caps.
  assert.equal(A.DEFAULTS.maxOutputChars, 1000000);
  assert.equal(A.run(digits).outputChars, 1000000);
  for (const ex of LESSONS) assert.ok(A.run(ex.src, PLAY).outputChars < 2000, ex.id);
  assert.ok(Date.now() - t0 < 3000, `took ${Date.now() - t0} ms`);
});

// ------------------------------------------------------- generated programs
// A reference interpreter, written from the README's semantics without looking
// at aloft.js: its own expression trees, printer, start schedule and catch order.
function refFloorMod(a, b) {
  return ((a % b) + b) % b;
}
const LIMIT = 2n ** 4096n;
class RefError extends Error {
  constructor(kind, msg, at) {
    super(msg);
    this.kind = kind;
    this.at = at;
  }
}
function refEval(e, env) {
  switch (e[0]) {
    case 'int': return e[1];
    case 'var': return env[e[1]];
    case 'neg': return -refEval(e[1], env);
    case 'not': return refEval(e[1], env) === 0n ? 1n : 0n;
    case 'if': return refEval(e[1], env) !== 0n ? refEval(e[2], env) : refEval(e[3], env);
    case 'call': {
      const v = e[2].map((x) => refEval(x, env));
      if (e[1] === 'abs') return v[0] < 0n ? -v[0] : v[0];
      const s = v.slice().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      return e[1] === 'min' ? s[0] : s[s.length - 1];
    }
    case 'bin': {
      const op = e[1];
      if (op === 'and') return refEval(e[2], env) === 0n ? 0n : (refEval(e[3], env) === 0n ? 0n : 1n);
      if (op === 'or') return refEval(e[2], env) !== 0n ? 1n : (refEval(e[3], env) === 0n ? 0n : 1n);
      const a = refEval(e[2], env);
      const b = refEval(e[3], env);
      const chk = (v) => {
        if (v >= LIMIT || -v >= LIMIT) throw new RefError('runtime', 'big', e.at);
        return v;
      };
      if (op === '+') return chk(a + b);
      if (op === '-') return chk(a - b);
      if (op === '*') return chk(a * b);
      if (op === '/' || op === '%') {
        if (b === 0n) throw new RefError('runtime', 'zero', e.at);
        const m = refFloorMod(a, b);
        return op === '%' ? m : (a - m) / b;
      }
      const cmp = { '==': a === b, '!=': a !== b, '<': a < b, '<=': a <= b, '>': a > b, '>=': a >= b }[op];
      return cmp ? 1n : 0n;
    }
    default: throw new Error(e[0]);
  }
}

// Printer: fully bracketed, recording where each operator lands (errors point there).
function printExpr(e, out) {
  const w = (s) => {
    out.text += s;
    out.col += [...s].length;
  };
  const here = () => ({ line: out.line, col: out.col });
  switch (e[0]) {
    case 'int':
      if (e[1] < 0n) {
        w('(');
        e.at = here();
        w(`-${-e[1]})`);
      } else w(String(e[1]));
      break;
    case 'var': w(e[1]); break;
    case 'neg': w('(-'); printExpr(e[1], out); w(')'); break;
    case 'not': w('(not '); printExpr(e[1], out); w(')'); break;
    case 'if': w('(if '); printExpr(e[1], out); w(' then '); printExpr(e[2], out); w(' else '); printExpr(e[3], out); w(')'); break;
    case 'call':
      w(`${e[1]}(`);
      e[2].forEach((x, i) => {
        if (i) w(', ');
        printExpr(x, out);
      });
      w(')');
      break;
    case 'bin':
      w('(');
      printExpr(e[2], out);
      w(' ');
      e.at = here();
      w(e[1]);
      w(' ');
      printExpr(e[3], out);
      w(')');
      break;
    default: throw new Error(e[0]);
  }
}

function genExpr(r, names, depth) {
  const leaf = () => (names.length && r() < 0.6 ? ['var', pick(r, names)] : ['int', BigInt(int(r, -12, 12))]);
  if (depth <= 0 || r() < 0.3) return leaf();
  const k = r();
  if (k < 0.55) return ['bin', pick(r, ['+', '-', '*', '/', '%', '==', '!=', '<', '<=', '>', '>=', 'and', 'or', '+', '-', '%']), genExpr(r, names, depth - 1), genExpr(r, names, depth - 1)];
  if (k < 0.65) return ['neg', genExpr(r, names, depth - 1)];
  if (k < 0.72) return ['not', genExpr(r, names, depth - 1)];
  if (k < 0.85) return ['if', genExpr(r, names, depth - 1), genExpr(r, names, depth - 1), genExpr(r, names, depth - 1)];
  const fn = pick(r, ['min', 'max', 'abs']);
  const n = fn === 'abs' ? 1 : int(r, 2, 3);
  return ['call', fn, Array.from({ length: n }, () => genExpr(r, names, depth - 1))];
}

// A random valid program: catch counts per beat, then a random bijection from
// throws to catches decides each throw's landing beat; height = distance + n·m.
function genProgram(r) {
  const n = int(r, 1, 4);
  const counts = Array.from({ length: n }, () => int(r, 0, 3));
  const throwSlots = [];
  const catchSlots = [];
  counts.forEach((c, i) => {
    for (let k = 0; k < c; k++) {
      throwSlots.push(i);
      catchSlots.push(i);
    }
  });
  for (let i = catchSlots.length - 1; i > 0; i--) {
    const j = int(r, 0, i);
    [catchSlots[i], catchSlots[j]] = [catchSlots[j], catchSlots[i]];
  }
  const heights = counts.map(() => []);
  throwSlots.forEach((i, idx) => {
    let h = (((catchSlots[idx] - i) % n) + n) % n + n * int(r, 0, 2);
    if (h === 0) h = n;
    heights[i].push(h);
  });
  const total = heights.flat().reduce((a, b) => a + b, 0);
  const B = total / n;
  const beats = counts.map((c, i) => {
    const names = Array.from({ length: c }, (_, k) => `c${i}${k}`);
    const bound = names.slice();
    const stmts = [];
    const throws = heights[i].map((h) => ({ kind: 'throw', h }));
    const extra = int(r, 0, 3);
    const pool = throws.slice();
    for (let x = 0; x < extra; x++) pool.push({ kind: pick(r, ['let', 'say', 'say', 'stop']) });
    for (let x = pool.length - 1; x > 0; x--) {
      const j = int(r, 0, x);
      [pool[x], pool[j]] = [pool[j], pool[x]];
    }
    let letN = 0;
    for (const p of pool) {
      if (p.kind === 'throw') stmts.push({ kind: 'throw', h: p.h, e: genExpr(r, bound, 3) });
      else if (p.kind === 'let') {
        const name = `v${i}${letN++}`;
        stmts.push({ kind: 'let', name, e: genExpr(r, bound, 3) });
        bound.push(name);
      } else if (p.kind === 'say') {
        const items = Array.from({ length: int(r, 0, 2) }, () => (r() < 0.2 ? { str: pick(r, ['hi', 'x y', '']) } : genExpr(r, bound, 3)));
        stmts.push({ kind: 'say', items, when: r() < 0.4 ? genExpr(r, bound, 2) : null });
      } else stmts.push({ kind: 'stop', when: r() < 0.9 ? genExpr(r, bound, 2) : null });
    }
    return { names, stmts };
  });
  const balls = Array.from({ length: B }, () => BigInt(int(r, -9, 30)));
  return { n, beats, balls, B };
}

function printProgram(p) {
  const out = { text: '', line: 1, col: 1 };
  const nl = () => {
    out.text += '\n';
    out.line++;
    out.col = 1;
  };
  const w = (s) => {
    out.text += s;
    out.col += [...s].length;
  };
  // balls in up to two lines, to exercise concatenation
  const cut = Math.floor(p.balls.length / 2);
  if (p.balls.length) {
    w(`balls ${p.balls.slice(0, cut).join(' ')}`.trimEnd());
    nl();
    w(`balls ${p.balls.slice(cut).join(' ')}`);
    nl();
  }
  p.beats.forEach((b) => {
    b.line = out.line;
    w(`catch${b.names.map((x) => ` ${x}`).join('')}`);
    nl();
    for (const s of b.stmts) {
      s.line = out.line;
      w('  ');
      if (s.kind === 'throw') {
        w('throw ');
        printExpr(s.e, out);
        w(` up ${s.h}`);
      } else if (s.kind === 'let') {
        w(`let ${s.name} = `);
        printExpr(s.e, out);
      } else if (s.kind === 'say') {
        w('say');
        s.items.forEach((it, i) => {
          w(i ? ', ' : ' ');
          if (it.str != null) w(`"${it.str}"`);
          else printExpr(it, out);
        });
        if (s.when) {
          w(' when ');
          printExpr(s.when, out);
        }
      } else {
        w('stop');
        if (s.when) {
          w(' when ');
          printExpr(s.when, out);
        }
      }
      nl();
    }
  });
  return out.text;
}

// Run per the spec: start schedule from the virtual history, catches ordered by
// (throw time, throw line order), every beat checked for exactly the right count.
function refRun(p, maxBeats) {
  const { n, beats } = p;
  const maxH = Math.max(1, ...beats.flatMap((b) => b.stmts.filter((s) => s.kind === 'throw').map((s) => s.h)));
  const virtual = [];
  for (let s = -1; s >= -maxH; s--) {
    const b = beats[((s % n) + n) % n];
    b.stmts.filter((x) => x.kind === 'throw').forEach((th, k) => {
      if (s + th.h >= 0) virtual.push({ land: s + th.h, s, k });
    });
  }
  virtual.sort((x, y) => x.land - y.land || x.s - y.s || x.k - y.k);
  assert.equal(virtual.length, p.balls.length, 'reference: ball count');
  let air = virtual.map((v, i) => ({ ...v, value: p.balls[i] }));
  const output = [];
  let t = 0;
  try {
    for (; t < maxBeats; t++) {
      const b = beats[t % n];
      const caught = air.filter((x) => x.land === t).sort((x, y) => x.s - y.s || x.k - y.k);
      air = air.filter((x) => x.land !== t);
      if (caught.length !== b.names.length) return { status: 'drop', t };
      const env = {};
      b.names.forEach((nm, i) => { env[nm] = caught[i].value; });
      let k = 0;
      let stopped = false;
      for (const s of b.stmts) {
        if (s.kind === 'let') env[s.name] = refEval(s.e, env);
        else if (s.kind === 'throw') air.push({ land: t + s.h, s: t, k: k++, value: refEval(s.e, env) });
        else if (s.kind === 'say') {
          if (!s.when || refEval(s.when, env) !== 0n) output.push(s.items.map((it) => (it.str != null ? it.str : String(refEval(it, env)))).join(' '));
        } else if (!s.when || refEval(s.when, env) !== 0n) {
          stopped = true;
          break;
        }
      }
      if (stopped) return { status: 'stopped', output, beats: t + 1 };
    }
    return { status: 'limit', output, beats: t };
  } catch (e) {
    if (!(e instanceof RefError)) throw e;
    return { status: 'error', output, beats: t + 1, error: { kind: e.kind, line: e.at.line, col: e.at.col, time: t } };
  }
}

test('reference: the interpreter agrees with an independent reference on 3000 random programs', () => {
  const r = rng(56);
  let stopped = 0;
  let errors = 0;
  let multiplex = 0;
  for (let i = 0; i < 3000; i++) {
    const p = genProgram(r);
    const src = printProgram(p);
    const got = A.run(src, { maxBeats: 40, maxWork: Infinity });
    const want = refRun(p, 40);
    assert.notEqual(want.status, 'drop', 'reference: a valid program dropped a ball');
    assert.equal(got.status, want.status, `#${i}\n${src}\n${JSON.stringify(got.error)}`);
    assert.deepEqual(got.output, want.output, `#${i}\n${src}`);
    assert.equal(got.beats, want.beats, `#${i}\n${src}`);
    assert.equal(got.info.ballCount, p.B);
    if (want.error) {
      assert.deepEqual([got.error.kind, got.error.line, got.error.col, got.error.time], [want.error.kind, want.error.line, want.error.col, want.error.time], `#${i}\n${src}`);
      errors++;
    }
    if (want.status === 'stopped') stopped++;
    if (p.beats.some((b) => b.names.length > 1)) multiplex++;
  }
  // The sample exercises every outcome and plenty of multi-ball catches.
  assert.ok(stopped > 300 && errors > 100 && multiplex > 1500, `${stopped} stopped, ${errors} errors, ${multiplex} multiplex`);
});

test('parser: random programs round-trip through format, and print back to the same tree', () => {
  const r = rng(7);
  for (let i = 0; i < 1500; i++) {
    const src = printProgram(genProgram(r));
    const p = A.parse(src);
    const f = A.format(p);
    assert.deepEqual(strip(A.parse(f)), strip(p), src);
    assert.equal(A.format(A.parse(f)), f);
  }
});

// Expressions printed with only the brackets the README's precedence table requires
// (plus a few spare), so the parser's precedence is checked against the spec.
const LEVEL = { if: 0, or: 1, and: 2, not: 3, cmp: 4, add: 5, mul: 6, neg: 7, atom: 8 };
function levelOf(e) {
  if (e[0] === 'if') return LEVEL.if;
  if (e[0] === 'not') return LEVEL.not;
  if (e[0] === 'neg') return LEVEL.neg;
  if (e[0] === 'bin') {
    if (e[1] === 'or') return LEVEL.or;
    if (e[1] === 'and') return LEVEL.and;
    if ('+-'.includes(e[1])) return LEVEL.add;
    if ('*/%'.includes(e[1])) return LEVEL.mul;
    return LEVEL.cmp;
  }
  if (e[0] === 'int' && e[1] < 0n) return LEVEL.neg;
  return LEVEL.atom;
}
function lean(e, r, need) {
  let s;
  const lv = levelOf(e);
  switch (e[0]) {
    case 'int': s = String(e[1]); break;
    case 'var': s = e[1]; break;
    case 'neg': s = `-${lean(e[1], r, LEVEL.neg)}`; break;
    case 'not': s = `not ${lean(e[1], r, LEVEL.not)}`; break;
    case 'if': s = `if ${lean(e[1], r, 0)} then ${lean(e[2], r, 0)} else ${lean(e[3], r, 0)}`; break;
    case 'call': s = `${e[1]}(${e[2].map((x) => lean(x, r, 0)).join(', ')})`; break;
    case 'bin': {
      const cmp = lv === LEVEL.cmp;
      s = `${lean(e[2], r, cmp ? lv + 1 : lv)} ${e[1]} ${lean(e[3], r, lv + 1)}`;
      break;
    }
    default: throw new Error(e[0]);
  }
  if (s.startsWith('--')) s = `- ${s.slice(1)}`;
  return lv < need || r() < 0.08 ? `(${s})` : s;
}

test('precedence: 4000 random expressions with minimal brackets evaluate as the spec says', () => {
  const r = rng(4096);
  let checked = 0;
  for (let i = 0; i < 4000; i++) {
    const e = genExpr(r, [], 5);
    const text = lean(e, r, 0);
    let want;
    try {
      want = String(refEval(e, {}));
    } catch (err) {
      if (!(err instanceof RefError)) throw err;
      want = 'runtime';
    }
    const got = sayOf(text);
    assert.equal(typeof got === 'string' ? got : got.kind, want, text);
    checked++;
  }
  assert.equal(checked, 4000);
});

// --------------------------------------------------------------- properties
function vanillaProgram(hs, b) {
  const lines = [`balls ${Array.from({ length: b }, (_, i) => i + 1).join(' ')}`.trim()];
  for (const h of hs) lines.push(h === 0 ? 'catch' : `catch x\n  throw x up ${h}`);
  return `${lines.join('\n')}\n`;
}
function permutationTest(hs) {
  const n = hs.length;
  const seen = new Set(hs.map((h, i) => (i + h) % n));
  return seen.size === n;
}

test('theorem: one-ball-per-beat programs check out exactly when i + h_i mod n is a permutation', () => {
  for (let n = 1; n <= 4; n++) {
    const H = 6;
    const total = (H + 1) ** n;
    for (let code = 0; code < total; code++) {
      const hs = [];
      let c = code;
      for (let i = 0; i < n; i++) {
        hs.push(c % (H + 1));
        c = Math.floor(c / (H + 1));
      }
      const sum = hs.reduce((a, b) => a + b, 0);
      const perm = permutationTest(hs);
      // Give it the right number of balls when that number is whole, so only the pattern decides.
      const b = sum % n === 0 ? sum / n : 0;
      const res = A.analyze(vanillaProgram(hs, b));
      assert.equal(res.ok, perm && sum % n === 0, `${hs.join('')}: ${res.ok ? 'ok' : res.error.message}`);
      if (perm) assert.equal(sum % n, 0, 'a permutation always has a whole-number average');
      if (res.ok) assert.equal(res.info.ballCount, sum / n);
    }
  }
});

test('theorem: there are (b+1)^n - b^n such programs with n beats and b balls (Buhler, Eisenbud, Graham, Wright)', () => {
  for (let n = 1; n <= 4; n++) {
    for (let b = 0; b <= 3; b++) {
      const H = b * n; // no throw can be higher than the sum of all heights
      let count = 0;
      const total = (H + 1) ** n;
      for (let code = 0; code < total; code++) {
        const hs = [];
        let c = code;
        for (let i = 0; i < n; i++) {
          hs.push(c % (H + 1));
          c = Math.floor(c / (H + 1));
        }
        if (hs.reduce((x, y) => x + y, 0) !== b * n) continue;
        if (A.analyze(vanillaProgram(hs, b)).ok) count++;
      }
      assert.equal(count, (b + 1) ** n - b ** n, `n=${n} b=${b}`);
    }
  }
  // The count is of height patterns, and only while b·n <= 9999: a juggling sequence can
  // contain a throw as high as b·n, and heights above 9999 can't be written. For n = 1 and
  // b = 10000 the formula counts the sequence [10000], which Aloft can't express.
  assert.ok(errorOf('catch a\n  throw a up 10000\n').message.includes('at most 9999'));
});

test('theorem: a checked program never drops a ball, and holds exactly (sum of heights)/n balls at every moment', () => {
  const r = rng(531);
  for (let i = 0; i < 400; i++) {
    const p = genProgram(r);
    // Values that never fail, so the run goes the distance.
    for (const b of p.beats) for (const s of b.stmts) {
      if (s.kind === 'throw') s.e = ['int', 1n];
      if (s.kind === 'stop') s.when = ['int', 0n];
      if (s.kind === 'say') s.items = [];
      if (s.kind === 'let') s.e = ['int', 0n];
      s.when = s.kind === 'stop' || s.kind === 'say' ? ['int', 0n] : s.when;
    }
    const src = printProgram(p);
    const res = A.run(src, { maxBeats: 300, traceBeats: 300 });
    assert.equal(res.status, 'limit', src);
    const flights = [
      ...res.trace.initial.map((x) => [x.throwTime, x.time]),
      ...res.trace.beats.flatMap((b) => b.thrown.map((x) => [b.t, b.t + x.height])),
    ];
    for (let t = 0; t < 300; t++) {
      const up = flights.filter(([s, land]) => s <= t && t < land).length;
      assert.equal(up, p.B, `t=${t}\n${src}`);
      assert.equal(res.trace.beats[t].caught.length, p.beats[t % p.n].names.length);
    }
  }
});

test('theorem: a pattern the checker rejects collides or drops within (max height + n) beats, wherever its balls start', () => {
  const r = rng(321);
  let rejected = 0;
  for (let i = 0; i < 600; i++) {
    const p = genProgram(r);
    const throws = p.beats.flatMap((b) => b.stmts.filter((s) => s.kind === 'throw'));
    if (!throws.length) continue;
    // Nudge one height so its landing beat changes (or the ball count goes fractional).
    const victim = pick(r, throws);
    victim.h += int(r, 1, Math.max(1, p.n - 1));
    if (p.n === 1) continue; // one beat: every height lands on the same beat, so nudging can't break it
    const src = printProgram(p);
    const res = A.analyze(src);
    if (res.ok) continue;
    assert.equal(res.error.kind, 'check');
    rejected++;
    // Simulate the bare pattern with balls dropped in anywhere: it still fails.
    const maxH = Math.max(...throws.map((s) => s.h));
    for (let trial = 0; trial < 5; trial++) {
      const counts = new Map();
      const B = int(r, 0, 12);
      for (let b = 0; b < B; b++) {
        const at = int(r, 0, 3 * maxH + p.n);
        counts.set(at, (counts.get(at) || 0) + 1);
      }
      let failedAt = -1;
      for (let t = 0; t < maxH + p.n + 1 && failedAt < 0; t++) {
        const b = p.beats[t % p.n];
        if ((counts.get(t) || 0) !== b.names.length) failedAt = t;
        counts.delete(t);
        for (const s of b.stmts) if (s.kind === 'throw') counts.set(t + s.h, (counts.get(t + s.h) || 0) + 1);
      }
      assert.ok(failedAt >= 0 && failedAt <= maxH + p.n, `pattern never failed:\n${src}`);
    }
  }
  assert.ok(rejected > 200, `only ${rejected} rejected patterns tried`);
});

// A Minsky register machine compiled to a one-beat Aloft program, pattern [11…1]: one
// ball for the instruction counter s and one per register. Each instruction adds one
// flat `let` to the sum that picks the next instruction and one to its register's change,
// so every expression stays a few levels deep however long the machine is.
// Instructions: ['inc', j, next] and ['dec', j, nextIfPositive, nextIfZero]; s >= length halts.
function compileMinsky(prog, regs, start) {
  const H = prog.length;
  const names = regs.map((_, i) => `r${i}`);
  const lines = [
    `balls ${start} ${regs.join(' ')}`,
    `catch s ${names.join(' ')}`,
    `  say ${names.join(', ')} when s >= ${H}`,
    `  stop when s >= ${H}`,
    '  let n0 = 0',
    ...names.map((r) => `  let d${r}_0 = 0`),
  ];
  const d = regs.map(() => 0); // how many change lets each register has so far
  prog.forEach((ins, k) => {
    const j = ins[1];
    const to = ins[0] === 'inc' ? `${ins[2]}` : `(if r${j} > 0 then ${ins[2]} else ${ins[3]})`;
    lines.push(`  let n${k + 1} = n${k} + (s == ${k}) * ${to}`);
    const change = ins[0] === 'inc' ? `+ (s == ${k})` : `- (s == ${k} and r${j} > 0)`;
    lines.push(`  let dr${j}_${d[j] + 1} = dr${j}_${d[j]} ${change}`);
    d[j]++;
  });
  lines.push(`  throw n${H} up 1`, ...names.map((r, i) => `  throw ${r} + d${r}_${d[i]} up 1`));
  return `${lines.join('\n')}\n`;
}
// The first construction tried: one nested if-chain per register. It is correct, but each
// instruction adds a level, so at 100 instructions it passes the parser's 200-level limit.
function compileMinskyNested(prog, regs, start) {
  const H = prog.length;
  const names = regs.map((_, i) => `r${i}`);
  const nextState = prog.reduceRight((acc, ins, s) => {
    const to = ins[0] === 'inc' ? `${ins[2]}` : `if r${ins[1]} > 0 then ${ins[2]} else ${ins[3]}`;
    return `if s == ${s} then (${to}) else (${acc})`;
  }, 's');
  const regExpr = (ri) => prog.reduceRight((acc, ins, s) => {
    if (ins[1] !== ri) return acc;
    const to = ins[0] === 'inc' ? `r${ri} + 1` : `if r${ri} > 0 then r${ri} - 1 else r${ri}`;
    return `if s == ${s} then (${to}) else (${acc})`;
  }, `r${ri}`);
  return [
    `balls ${start} ${regs.join(' ')}`,
    `catch s ${names.join(' ')}`,
    `  say ${names.join(', ')} when s == ${H}`,
    `  stop when s == ${H}`,
    `  throw ${nextState} up 1`,
    ...regs.map((_, i) => `  throw ${regExpr(i)} up 1`),
  ].join('\n');
}
function runMinsky(prog, regs) {
  const r = regs.slice();
  let s = 0;
  for (let steps = 0; steps < 1e6 && s < prog.length; steps++) {
    const ins = prog[s];
    if (ins[0] === 'inc') {
      r[ins[1]]++;
      s = ins[2];
    } else if (r[ins[1]] > 0) {
      r[ins[1]]--;
      s = ins[2];
    } else s = ins[3];
  }
  return r;
}

test('universality: Minsky machines compiled to [11…1] (one ball per register plus the counter) agree with a direct simulation', () => {
  const add = [['dec', 1, 1, 2], ['inc', 0, 0]]; // r0 += r1
  const mul = [['dec', 0, 1, 6], ['dec', 1, 2, 4], ['inc', 2, 3], ['inc', 3, 1], ['dec', 3, 5, 0], ['inc', 1, 4]]; // r2 = r0 * r1
  const swap = [['dec', 0, 1, 2], ['inc', 2, 0], ['dec', 1, 3, 4], ['inc', 0, 2], ['dec', 2, 5, 6], ['inc', 1, 4]]; // swap r0, r1
  for (const [prog, nregs] of [[add, 2], [mul, 4], [swap, 3]]) {
    for (let a = 0; a <= 5; a++) {
      for (let b = 0; b <= 5; b++) {
        const regs = [a, b, ...Array(nregs - 2).fill(0)];
        const want = [runMinsky(prog, regs).join(' ')];
        const res = A.run(compileMinsky(prog, regs, 0), { maxBeats: 100000 });
        assert.equal(res.status, 'stopped');
        assert.equal(res.info.ballCount, nregs + 1, 'one ball per register, plus one for the counter');
        assert.deepEqual(res.output, want);
        assert.deepEqual(A.run(compileMinskyNested(prog, regs, 0), { maxBeats: 100000 }).output, want);
      }
    }
  }
  // Long machines: blocks that each move one register into the next, round a ring of R registers.
  const chain = (blocks, R) => {
    const p = [];
    for (let i = 0; i < blocks; i++) {
      const at = p.length;
      p.push(['dec', i % R, at + 1, at + 2], ['inc', (i + 1) % R, at]);
    }
    return p;
  };
  const twelve = [2, 7, 1, 8, 2, 8, 1, 8, 2, 8, 4, 5];
  const ring = chain(30, 12);
  const r12 = A.run(compileMinsky(ring, twelve, 0), { maxBeats: 100000 });
  assert.deepEqual([r12.status, r12.info.ballCount, r12.output], ['stopped', 13, [runMinsky(ring, twelve).join(' ')]]);
  const regs = [3, 1, 4, 1, 5];
  for (const blocks of [49, 50, 60]) { // 98, 100 and 120 instructions
    const prog = chain(blocks, 5);
    const res = A.run(compileMinsky(prog, regs, 0), { maxBeats: 100000 });
    assert.equal(res.status, 'stopped', `${prog.length} instructions: ${res.status}`);
    assert.equal(res.info.ballCount, 6);
    assert.deepEqual(res.output, [runMinsky(prog, regs).join(' ')], `${prog.length} instructions`);
    // The nested form works at 98 instructions and is too deep from 100 on.
    const nested = A.run(compileMinskyNested(prog, regs, 0), { maxBeats: 100000 });
    if (prog.length < 100) assert.deepEqual(nested.output, res.output);
    else assert.ok(nested.error && nested.error.message.includes('nested too deeply'), `${prog.length}: nested form`);
  }
});

test('universality: FRACTRAN in one ball (pattern "1") agrees with a direct simulation of PRIMEGAME', () => {
  const primegame = [[17, 91], [78, 85], [19, 51], [23, 38], [29, 33], [77, 29], [95, 23], [77, 19], [1, 17], [11, 13], [13, 11], [15, 2], [1, 7], [55, 1]];
  const chain = primegame.reduceRight((acc, [p, q]) => `if n % ${q} == 0 then n / ${q} * ${p} else (${acc})`, '0');
  const src = `balls 2\ncatch n\n  let next = ${chain}\n  say next\n  stop when next == 0\n  throw next up 1\n`;
  const res = A.run(src, { maxBeats: 2000 });
  assert.equal(res.info.siteswap, '1');
  assert.equal(res.info.ballCount, 1);
  let n = 2n;
  const want = [];
  for (let i = 0; i < 2000; i++) {
    const f = primegame.find(([, q]) => n % BigInt(q) === 0n);
    n = (n / BigInt(f[1])) * BigInt(f[0]);
    want.push(String(n));
  }
  assert.deepEqual(res.output, want);
  // The powers of two it passes through are 2^prime.
  const exps = want.filter((x) => /^[0-9]+$/.test(x) && (BigInt(x) & (BigInt(x) - 1n)) === 0n).map((x) => BigInt(x).toString(2).length - 1);
  assert.deepEqual(exps, [2, 3, 5, 7]);
});

// ------------------------------------------------------------------ README
test('README: header, spec and examples agree with the code', () => {
  const md = fs.readFileSync(path.join(HERE, 'README.md'), 'utf8');
  assert.match(md, /^# Aloft\n> .+\n\n\*\*Kind:\*\* language\n\*\*Run:\*\* .+\n\*\*Made by:\*\* .+/);
  for (const h of ['What it is', 'Why I made it', 'How it works', 'Honest assessment', 'Where it could go next']) {
    assert.ok(md.includes(`\n## ${h}`), h);
  }
  // Every keyword is in the README's keyword list, and nothing else is.
  const m = md.match(/Keywords \(reserved\): (.+)\./);
  assert.ok(m, 'keyword list');
  const listed = m[1].split(',').map((s) => s.trim().replace(/`/g, ''));
  assert.deepEqual(listed.slice().sort(), [...A.KEYWORDS].sort());
  for (const ex of LESSONS) assert.ok(md.includes(ex.title.replace(/'/g, '’')) || md.includes(ex.title), ex.title);
  assert.ok(md.includes(`${A.MAX_HEIGHT}`) && md.includes(`2^${A.MAX_BITS}`) && md.includes(`${A.MAX_DEPTH} levels`));
  assert.ok(md.includes(`${A.DEFAULTS.maxWork.toLocaleString('en-US')}`), 'work budget documented');
  assert.ok(md.includes(`${A.DEFAULTS.maxOutputChars.toLocaleString('en-US')} characters by default, 200,000 in the playground`), 'character cap documented');
  assert.ok(md.includes('10,000 lines by default, 2,000 in the playground'), 'line cap documented');
});
