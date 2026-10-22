// Tests for the language core. Run from the repo root: node --test ideas/04-autogram-forge/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// autogram.js is a classic browser script. Evaluate it the way a <script> tag would (it
// defines globalThis.Autogram), so the test does not depend on how Node classifies .js files.
const src = fs.readFileSync(new URL('./autogram.js', import.meta.url), 'utf8');
vm.runInThisContext(src, { filename: 'autogram.js' });
const AG = globalThis.Autogram;

const counts = (obj) => {
  const c = new Array(26).fill(0);
  for (const [k, v] of Object.entries(obj)) c[k.charCodeAt(0) - 97] = v;
  return c;
};

/** Run solvers for several harmless variants in turn until one finds a true sentence. */
function forge(base, { seed = 1, maxSweeps = 4_000_000 } = {}) {
  const conjs = ['and', '&', ''];
  const bonuses = base.list && base.list !== 'auto' ? [false] : [false, true];
  const solvers = [];
  for (const bonus of bonuses) for (const conj of conjs) solvers.push(new AG.Solver({ ...base, conj, bonus }, seed + solvers.length));
  for (let done = 0; done < maxSweeps; done += 200 * solvers.length) {
    for (const s of solvers) if (s.run(200)) return s;
  }
  return null;
}

test('number words: small, tens, hundreds, both "and" styles', () => {
  assert.equal(AG.numberWord(0), 'zero');
  assert.equal(AG.numberWord(1), 'one');
  assert.equal(AG.numberWord(13), 'thirteen');
  assert.equal(AG.numberWord(20), 'twenty');
  assert.equal(AG.numberWord(21), 'twenty-one');
  assert.equal(AG.numberWord(40), 'forty');
  assert.equal(AG.numberWord(99), 'ninety-nine');
  assert.equal(AG.numberWord(100), 'one hundred');
  assert.equal(AG.numberWord(105, true), 'one hundred and five');
  assert.equal(AG.numberWord(105, false), 'one hundred five');
  assert.equal(AG.numberWord(197, true), 'one hundred and ninety-seven');
  assert.equal(AG.numberWord(999, false), 'nine hundred ninety-nine');
  for (const bad of [-1, 1000, 1.5, NaN, '3', null]) assert.throws(() => AG.numberWord(bad), RangeError);
});

test('number words read back: every value, both styles, odd spacing and case', () => {
  for (let n = 0; n <= 999; n++) {
    assert.equal(AG.parseNumberWord(AG.numberWord(n, true)), n);
    assert.equal(AG.parseNumberWord(AG.numberWord(n, false)), n);
  }
  assert.equal(AG.parseNumberWord('Twenty-Three'), 23);
  assert.equal(AG.parseNumberWord('twenty   three'), 23);
  assert.equal(AG.parseNumberWord('twenty–three'), 23); // en dash
  for (const bad of ['', 'and', 'hundred', 'twenty twenty', 'one two', 'ten one', 'twenty ten',
    'twenty zero', 'thirteen hundred', 'one hundred and', 'eleventy', 'one hundred one hundred']) {
    assert.equal(AG.parseNumberWord(bad), -1, bad);
  }
});

test('letter folding: case, accents, ligatures, and things that are not a-z', () => {
  assert.equal(AG.foldLetters('Hello, World!'), 'helloworld');
  assert.equal(AG.foldLetters('Café DÉJÀ naïve'), 'cafedejanaive');
  assert.equal(AG.foldLetters('ﬁne'), 'fine'); // the fi ligature splits into two letters
  assert.equal(AG.foldLetters('Æsir straße'), 'sirstrae'); // æ and ß are not among the 26
  assert.equal(AG.foldLetters('абв 123 \u{1F600} 中'), ''); // Cyrillic, digits, emoji, Han
  assert.equal(AG.foldLetters(''), '');
  assert.equal(AG.foldLetters(null), '');
  const c = AG.countLetters('Hello, World!');
  assert.deepEqual([c[7], c[4], c[11], c[14], c[22], c[17], c[3]], [1, 1, 3, 2, 1, 1, 1]);
});

test('letters used by number words', () => {
  // The well-known sixteen, plus d and a from "hundred" / "and".
  assert.equal(AG.lettersInNumberWords(false), 'defghilnorstuvwxy');
  assert.equal(AG.lettersInNumberWords(true), 'adefghilnorstuvwxy');
});

test('rendering: list punctuation, plurals, conjunctions, totals', () => {
  const spec = (o) => AG.makeSpec(o);
  assert.equal(AG.render(spec({}), counts({ z: 1 })), 'This sentence contains one z.');
  assert.equal(AG.render(spec({}), counts({ a: 1, b: 2 })), "This sentence contains one a and two b's.");
  assert.equal(AG.render(spec({}), counts({ a: 1, b: 2, c: 3 })), "This sentence contains one a, two b's, and three c's.");
  assert.equal(AG.render(spec({ oxford: false }), counts({ a: 1, b: 2, c: 3 })), "This sentence contains one a, two b's and three c's.");
  assert.equal(AG.render(spec({ conj: '&' }), counts({ a: 1, b: 2, c: 3 })), "This sentence contains one a, two b's, & three c's.");
  assert.equal(AG.render(spec({ conj: '' }), counts({ a: 1, b: 2, c: 3 })), "This sentence contains one a, two b's, three c's.");
  assert.equal(AG.render(spec({ apostrophe: false }), counts({ a: 2 })), 'This sentence contains two as.');
  assert.equal(AG.render(spec({ prefix: '', suffix: '!' }), counts({ q: 1 })), 'one q!');
  assert.equal(AG.render(spec({ prefix: 'Trailing space   ' }), counts({ q: 1 })), 'Trailing space one q.');
  assert.equal(AG.render(spec({ total: true }), counts({ a: 2 }), 30), "This sentence contains thirty letters: two a's.");
  assert.equal(AG.render(spec({ total: true, hundredAnd: false }), counts({ a: 2 }), 105), "This sentence contains one hundred five letters: two a's.");
  assert.equal(AG.render(spec({ list: 'custom', custom: 'E, A!' }), counts({ a: 1, e: 4, z: 9 })), "This sentence contains one a and four e's.");
  // 'all' lists every letter, in order.
  assert.equal(AG.listedLetters(spec({ list: 'all' }), counts({})).length, 26);
});

test('makeSpec rejects nonsense', () => {
  assert.throws(() => AG.makeSpec({ list: 'some' }));
  assert.throws(() => AG.makeSpec({ conj: 'or' }));
  assert.throws(() => AG.makeSpec({ list: 'custom', custom: '123 !' }));
  assert.equal(AG.makeSpec({ list: 'custom', custom: 'uOiaé' }).custom, 'aeiou');
  assert.equal(AG.makeSpec({ notAnOption: 1 }).notAnOption, undefined);
});

const SALLOWS = 'This pangram contains four as, one b, two cs, one d, thirty es, six fs, five gs, seven hs, eleven is, one j, one k, two ls, two ms, eighteen ns, fifteen os, two ps, one q, five rs, twenty-seven ss, eighteen ts, two us, seven vs, eight ws, two xs, three ys, & one z.';
const EMPLOYS = "This sentence employs two a's, two c's, two d's, twenty-eight e's, five f's, three g's, eight h's, eleven i's, three l's, two m's, thirteen n's, nine o's, two p's, five r's, twenty-five s's, twenty-three t's, six v's, ten w's, two x's, five y's, and one z.";
const TOTAL197 = "This sentence contains one hundred and ninety-seven letters: four a's, one b, three c's, five d's, thirty-four e's, seven f's, one g, six h's, twelve i's, three l's, twenty-six n's, ten o's, ten r's, twenty-nine s's, nineteen t's, six u's, seven v's, four w's, four x's, five y's, and one z.";

test('checker: the classic autograms really are true', () => {
  for (const s of [SALLOWS, EMPLOYS, TOTAL197]) {
    const r = AG.check(s);
    assert.ok(r.ok && r.complete, s.slice(0, 40));
  }
  assert.equal(AG.check(SALLOWS).claims.length, 26);
  const t = AG.check(TOTAL197);
  assert.equal(t.totals.length, 1);
  assert.equal(t.totals[0].n, 197);
  assert.equal(t.letterTotal, 197);
});

test('checker: finds false, duplicate and missing claims; reads curly quotes and capitals', () => {
  const nearMiss = "Café déjà vu: this naïve sentence contains six a's, four c's, three d's, thirty-two e's, seven f's, three g's, nine h's, fourteen i's, two j's, one l, nineteen n's, eight o's, nine r's, twenty-six s's, eighteen t's, five u's, five v's, four w's, three x's, and three y's.";
  const r = AG.check(nearMiss);
  assert.equal(r.ok, false);
  assert.deepEqual(r.wrong.map((w) => [w.letter, w.n, w.actual]), [['v', 5, 6]]);

  const dup = AG.check("One a, one a.");
  assert.deepEqual(dup.duplicates, ['a']);
  assert.equal(dup.ok, false);

  assert.equal(AG.check('').ok, false);
  assert.equal(AG.check('No claims at all here.').claims.length, 0);

  const curly = AG.check('THREE “A”’S and one z: aa');
  assert.deepEqual(curly.claims.map((c) => [c.letter, c.n]), [['a', 3], ['z', 1]]);

  const andClaim = AG.check("Two a's and one z.");
  assert.equal(andClaim.claims[1].text, 'one z'); // the list's "and" is not part of the claim
  assert.equal(andClaim.claims[1].index, "Two a's and ".length);

  const partial = AG.check('This has one z.'); // true claim, but t, h, i, s, ... go unmentioned
  assert.equal(partial.ok, true);
  assert.equal(partial.complete, false);
  assert.ok(partial.unlisted.includes('t'));
});

test('verify audits a rendered sentence directly against its claims', () => {
  const spec = { prefix: 'This pangram lists', list: 'all' };
  const s = new AG.Solver(spec, 3);
  while (!s.run(1000));
  const c = s.claims('best');
  assert.ok(AG.verify(spec, c.counts, c.total).ok);
  const off = c.counts.slice();
  off[4] += 1;
  const v = AG.verify(spec, off, c.total);
  assert.equal(v.ok, false);
  assert.ok(v.wrong.includes('e'));
  // An empty claim list is never "true".
  assert.equal(AG.verify({ prefix: '' }, counts({}), 0).ok, false);
});

test('solver bookkeeping: incremental counts always match a full re-count', () => {
  const specs = [
    { prefix: 'This sentence contains' },
    { prefix: 'Count: ', list: 'all', conj: '&' },
    { prefix: 'Vowels:', list: 'custom', custom: 'aeiou', total: true },
    { prefix: 'x', conj: '', total: true, bonus: true },
    { prefix: '', bonus: true }
  ];
  for (const spec of specs) {
    const s = new AG.Solver(spec, 42);
    for (let step = 0; step < 300; step++) {
      s.run(1);
      // Random jolts, including dropping claims to 0 so the list length (and the "and") changes.
      const i = Math.floor(s.rand() * 27);
      if (s.claimable[i]) s.setClaim(i, s.clamp(i, Math.floor(s.rand() * 40)));
      const c = s.claims('current');
      const text = AG.render(s.spec, c.counts, c.total);
      const real = AG.countLetters(text);
      for (let k = 0; k < 26; k++) assert.equal(s.a[k], real[k], `${JSON.stringify(spec)} letter ${k}`);
      assert.equal(s.sumA, AG.foldLetters(text).length);
    }
  }
});

test('solver finds true sentences in every list mode (seeded, so repeatable)', () => {
  const cases = [
    { prefix: 'This sentence contains' },
    { prefix: 'This pangram lists', list: 'all' },
    { prefix: 'Vowels, by my own count:', list: 'custom', custom: 'aeiou' },
    { prefix: 'In this line there are', list: 'custom', custom: 'aeiouy', total: true },
    { prefix: 'This sentence contains', total: true },
    { prefix: 'Look closely and you will see that I hold' }
  ];
  for (const base of cases) {
    const s = forge(base);
    assert.ok(s, `no sentence for ${JSON.stringify(base)}`);
    const c = s.claims('best');
    const v = AG.verify(s.spec, c.counts, c.total);
    assert.ok(v.ok, v.sentence);
    const r = AG.check(v.sentence);
    assert.ok(r.ok, v.sentence);
    if (s.spec.list !== 'custom') assert.ok(r.complete, v.sentence);
    if (!s.spec.bonus && s.spec.list === 'auto') {
      // Without the lone-letter liberty, no claim may be true only because it names itself.
      assert.deepEqual(AG.loneLetters(s.spec, c.counts, c.total), [], v.sentence);
    }
  }
});

test('solver copes with awkward openings: empty, letterless, accented, shouty', () => {
  for (const prefix of ['', '12345 ...', 'Café déjà vu: this naïve sentence contains', 'WHY ARE WE SHOUTING? I CONTAIN']) {
    const s = forge({ prefix });
    assert.ok(s, `no sentence for ${JSON.stringify(prefix)}`);
    const c = s.claims('best');
    const v = AG.verify(s.spec, c.counts, c.total);
    assert.ok(v.ok, v.sentence);
    assert.ok(AG.listedLetters(s.spec, c.counts).length > 0);
    assert.ok(v.sentence.startsWith(prefix.trim()));
  }
});

test('reject() makes a solver look for a different sentence', () => {
  const spec = { prefix: 'This sentence contains', list: 'all' };
  const s = new AG.Solver(spec, 7);
  while (!s.run(1000));
  const first = s.sentence('best');
  const found = new Set([first]);
  for (let k = 0; k < 3; k++) {
    s.reject();
    assert.equal(s.solved, false);
    let n = 0;
    while (!s.run(1000) && n++ < 4000);
    assert.ok(s.solved);
    const c = s.claims('best');
    assert.ok(AG.verify(spec, c.counts, c.total).ok);
    found.add(s.sentence('best'));
  }
  assert.ok(found.size >= 2, 'expected more than one distinct solution');
});
