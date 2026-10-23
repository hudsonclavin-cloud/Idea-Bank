// Verifies every formal claim the README makes about the cycle, from poems.txt alone.
// Run: node --test ideas/14-minimus/form.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const TEXT = fs.readFileSync(path.join(DIR, 'poems.txt'), 'utf8');

const WORDS = ['round', 'hand', 'still', 'home']; // bells 1–4: treble, second, third, tenor
const PLACE_NOTATION = ['x', '14', 'x', '14', 'x', '14', 'x', '12']; // one lead of Plain Bob Minimus
const LEADS = 3;
const MAX_LINE = 44; // characters: 14% headroom at 390 px in Liberation Serif; the page's fit step covers wider faces
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/* ---------- an independent implementation of the method ---------- */
function applyChange(row, change) {
  const out = row.slice();
  if (change === 'x') {
    for (let i = 0; i + 1 < row.length; i += 2) [out[i], out[i + 1]] = [row[i + 1], row[i]];
    return out;
  }
  const stay = new Set(change.split('').map(Number));
  for (let i = 0; i < row.length; ) {
    if (stay.has(i + 1)) { i += 1; continue; }
    [out[i], out[i + 1]] = [row[i + 1], row[i]];
    i += 2;
  }
  return out;
}
function plainBobMinimus() {
  const rows = [[1, 2, 3, 4]];
  for (let l = 0; l < LEADS; l++) for (const c of PLACE_NOTATION) rows.push(applyChange(rows.at(-1), c));
  return rows;
}
function isAdjacentSwapChange(a, b) {
  for (let j = 0; j < a.length; ) {
    if (a[j] === b[j]) { j += 1; continue; }
    if (j + 1 < a.length && a[j] === b[j + 1] && a[j + 1] === b[j]) { j += 2; continue; }
    return false;
  }
  return true;
}

/* ---------- the text ---------- */
function parse(text) {
  const poems = [];
  let title = '';
  let cur = null;
  let stanza = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (line.startsWith('# ')) { title = line.slice(2); continue; }
    if (line.startsWith('## ')) {
      if (stanza.length && cur) cur.stanzas.push(stanza);
      stanza = [];
      cur = { title: line.slice(3), stanzas: [] };
      poems.push(cur);
      continue;
    }
    if (!line.trim()) { if (stanza.length && cur) { cur.stanzas.push(stanza); stanza = []; } continue; }
    stanza.push(line);
  }
  if (stanza.length && cur) cur.stanzas.push(stanza);
  return { title, poems };
}
// The end-word: the last run of letters/apostrophes in the line, minus any possessive, lower-cased.
const endWord = (line) => (line.match(/[A-Za-z']+(?=[^A-Za-z']*$)/) || [''])[0].toLowerCase().replace(/'s$/, '');
// A word counts as a bell only if it is exactly the bell's word (no plurals, no inflections).
const bellOf = (w) => WORDS.indexOf(w) + 1;

const cycle = parse(TEXT);
const stanzas = cycle.poems.flatMap((p) => p.stanzas.map((lines) => ({ poem: p.title, lines })));
const rows = plainBobMinimus();

/* ---------- the method itself ---------- */
test('Plain Bob Minimus from its place notation is the full extent on four bells', () => {
  assert.equal(rows.length, 25);
  const keys = rows.map((r) => r.join(''));
  assert.equal(new Set(keys.slice(0, 24)).size, 24, 'the 24 rows before the return are all different');
  assert.equal(keys[0], '1234', 'starts in rounds');
  assert.equal(keys[24], '1234', 'comes round at the 25th row');
  for (let i = 1; i < rows.length; i++) assert.ok(isAdjacentSwapChange(rows[i - 1], rows[i]), `change ${i} swaps only neighbours`);
  assert.deepEqual([keys[8], keys[16], keys[24]], ['1342', '1423', '1234'], 'the three lead heads of the plain course');
  const treble = rows.map((r) => r.indexOf(1) + 1).join('');
  assert.equal(treble, '1234432112344321123443211', 'the treble plain hunts throughout');
});

/* ---------- shape ---------- */
test('shape: twelve poems named for the months, 25 stanzas of four lines, 100 lines', () => {
  assert.equal(cycle.title, 'Minimus');
  assert.deepEqual(cycle.poems.map((p) => p.title), MONTHS);
  assert.equal(stanzas.length, 25);
  for (const s of stanzas) assert.equal(s.lines.length, 4, `${s.poem}: stanza has ${s.lines.length} lines`);
  assert.equal(stanzas.flatMap((s) => s.lines).length, 100);
  const perPoem = cycle.poems.map((p) => p.stanzas.length);
  assert.deepEqual(perPoem, [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3], 'two rows a month, and December carries the rounds');
});

/* ---------- the central claim ---------- */
test('each stanza’s four line-endings are, in order, that row of the extent', () => {
  stanzas.forEach((s, i) => {
    const got = s.lines.map((l) => bellOf(endWord(l)));
    assert.deepEqual(got, rows[i], `stanza ${i + 1} (${s.poem}) ends ${s.lines.map(endWord).join('/')}, row ${i + 1} is ${rows[i].map((b) => WORDS[b - 1]).join('/')}`);
  });
});

test('read directly from the text, without the method: no word jumps, no row repeats, rounds at both ends', () => {
  const got = stanzas.map((s) => s.lines.map((l) => bellOf(endWord(l))));
  for (const g of got) assert.deepEqual([...g].sort(), [1, 2, 3, 4], 'every stanza ends on each of the four words once');
  for (let i = 1; i < got.length; i++) assert.ok(isAdjacentSwapChange(got[i - 1], got[i]), `stanza ${i + 1} is an adjacent-swap change of stanza ${i}`);
  const keys = got.map((g) => g.join(''));
  assert.equal(new Set(keys.slice(0, 24)).size, 24, 'all 24 orderings appear once before the return');
  assert.equal(keys[0], '1234');
  assert.equal(keys[24], '1234');
});

test('the end-words are exactly the four bare words: no plurals, no inflections, no compounds', () => {
  const allowed = new Set(WORDS);
  const used = new Map();
  for (const s of stanzas) for (const l of s.lines) {
    const w = endWord(l);
    assert.ok(allowed.has(w), `end-word "${w}" in "${l}"`);
    // the word must stand alone at the end, not be the tail of a longer word (e.g. "around")
    assert.match(l, new RegExp(`(^|[^A-Za-z])${w}[^A-Za-z']*$`, 'i'), `"${w}" is not a whole word at the end of "${l}"`);
    used.set(w, (used.get(w) || 0) + 1);
  }
  for (const w of WORDS) assert.equal(used.get(w), 25, `${w} ends 25 lines`);
});

/* ---------- typography ---------- */
test(`no line is longer than ${MAX_LINE} characters`, () => {
  for (const s of stanzas) for (const l of s.lines) {
    assert.ok(l.length <= MAX_LINE, `${l.length} chars: "${l}"`);
    assert.equal(l, l.trimEnd(), `trailing whitespace: "${l}"`);
    assert.ok(!/\t/.test(l), `tab in line: "${l}"`);
  }
});

/* ---------- the page cannot drift from the source ---------- */
test('index.html carries poems.txt verbatim', () => {
  const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
  const m = html.match(/<script type="text\/plain" id="poems">\n([\s\S]*?)\n<\/script>/);
  assert.ok(m, 'the page has a text/plain script block holding the poems');
  assert.equal(m[1], TEXT.replace(/^\n+|\n+$/g, ''));
  assert.ok(/<meta name="viewport" content="width=device-width, initial-scale=1">/.test(html), 'viewport meta');
});
