// Pins the fixes made after the independent review (README, "Revision note").
// Each check here fails on the pre-review text. Run: node --test ideas/14-minimus/review.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
const POEMS = read('poems.txt');
const README_ALL = read('README.md');
// The README's claims, without the Revision note (which quotes the old wording on purpose).
const CUT = README_ALL.indexOf('## Revision note');
const README = CUT < 0 ? README_ALL : README_ALL.slice(0, CUT);
const HTML = read('index.html');
const CSS = read('style.css');
const flat = (s) => s.replace(/\s+/g, ' '); // README paragraphs and page prose, whitespace-normalised

/* ---------- the text, by month and by stanza (own small parser) ---------- */
const months = {};
const stanzas = [];
let month = null;
let cur = [];
for (const raw of POEMS.split('\n')) {
  const line = raw.trimEnd();
  if (line.startsWith('## ')) { month = line.slice(3); months[month] = []; continue; }
  if (!month) continue;
  if (!line) { if (cur.length) { stanzas.push({ month, lines: cur }); cur = []; } continue; }
  months[month].push(line);
  cur.push(line);
}
if (cur.length) stanzas.push({ month, lines: cur });
const lines = stanzas.flatMap((s) => s.lines);
const monthText = (m) => months[m].join(' ').toLowerCase();

/* ---------- a third, minimal implementation of the method ---------- */
function change(row, pn) {
  const out = row.slice();
  for (let i = 0; i < row.length; ) {
    if (pn !== 'x' && pn.includes(String(i + 1))) { i += 1; continue; }
    [out[i], out[i + 1]] = [row[i + 1], row[i]];
    i += 2;
  }
  return out;
}
const LEAD = ['x', '14', 'x', '14', 'x', '14', 'x', '12'];
const rows = [[1, 2, 3, 4]];
for (let l = 0; l < 3; l++) for (const pn of LEAD) rows.push(change(rows.at(-1), pn));

/* ---------- ringing counts and terms ---------- */
test('ringers count 24 changes after the opening rounds; the 24th is rounds, and the page says so', () => {
  const changes = rows.slice(1).map((r) => r.join(''));
  assert.equal(changes.length, 24);
  assert.equal(new Set(changes).size, 24, 'the 24 changes are every possible order exactly once');
  assert.equal(changes[23], '1234', 'the twenty-fourth change is rounds');
  const how = flat(HTML.slice(HTML.indexOf('<section id="how">'), HTML.indexOf('</section>', HTML.indexOf('<section id="how">'))));
  assert.ok(!/twenty-four changes, every possible order[^.]*and then rounds/.test(how), 'the page must not count rounds as a 25th change');
  assert.match(how, /twenty-four changes take them through every possible order exactly once, and the twenty-fourth brings them back to rounds/);
  assert.match(flat(README), /Ringers count it as 24 \*changes\*: the opening rounds is not a change, and the 24th change is the return to rounds/);
});

test('place notation names places, not bells: "14" applied to 2143 keeps bells 2 and 3', () => {
  assert.deepEqual(change([2, 1, 4, 3], '14'), [2, 4, 1, 3]);
  assert.deepEqual(change([3, 1, 4, 2], '12'), [3, 1, 2, 4], '"12" keeps whatever is in places 1 and 2');
  assert.ok(!/holds the first and fourth bells/.test(README));
  assert.match(flat(README), /`14` keeps whatever bells are in first and fourth places where they are/);
});

test('a bell "can be" half a ton; the treble of a ring of four is not', () => {
  for (const [name, text] of [['index.html', HTML], ['README.md', README]]) {
    assert.ok(!/a bell is half a ton/i.test(flat(text)), `${name} states every bell is half a ton`);
    assert.match(flat(text), /a bell can be half a ton of bronze/);
  }
});

/* ---------- the poems: ringing usage and the band's arithmetic ---------- */
test('no line "rings round": ringers ring rounds, and "ring round" is British for phoning people', () => {
  for (const l of lines) assert.ok(!/\bring round\b/i.test(l), `"${l}"`);
});

test('the learner does not carry the bell rope from home (ropes stay in the tower)', () => {
  for (const s of stanzas) {
    for (const sentence of s.lines.join(' ').split(/(?<=[.!?])\s+/)) {
      assert.ok(!(/walked from home/i.test(sentence) && /with the rope/i.test(sentence)), `${s.month}: "${sentence}"`);
    }
  }
});

test('the band is four before and after his death, so the funeral borrows no ringer', () => {
  assert.match(monthText('January'), /four ways home/, 'January: four ringers including the old man');
  assert.match(monthText('December'), /four ways home/, 'December: four ringers including the learner');
  assert.ok(!/borrowed hand/.test(monthText('September')), 'a band of four needs no borrowed hand on four bells');
  assert.match(monthText('September'), /old friend's hand\s+on his bell/, 'his bell is given to an old friend');
});

test('no peal boards round the walls of a four-bell tower', () => {
  assert.ok(!/peal boards?/i.test(POEMS));
  assert.ok(!/which is true of real towers/.test(README));
});

/* ---------- the README's claims about its own text ---------- */
test('the March images that the README says July and August need do come back in July or August', () => {
  const m = flat(README).match(/March earns its keep because July and August need it: ([^.]*)\./);
  assert.ok(m, 'README states which March images return');
  const named = [...m[1].matchAll(/\*([a-z]+)\*/g)].map((x) => x[1]);
  assert.ok(named.length >= 3, `named: ${named.join(', ')}`);
  const later = monthText('July') + ' ' + monthText('August');
  for (const w of named) {
    const re = new RegExp(`\\b${w}\\b`);
    assert.match(monthText('March'), re, `${w} is in March`);
    assert.match(later, re, `${w} comes back in July or August`);
  }
  // and the two images it used to claim do not come back at all
  for (const w of ['photograph', 'mantel clock']) {
    const where = Object.keys(months).filter((mo) => monthText(mo).includes(w));
    assert.deepEqual(where, ['March'], `${w} appears only in March`);
  }
  assert.match(flat(README), /The mantel clock never comes back/);
});

test('the README counts round-as-preposition endings and the run of "her hand" correctly', () => {
  // "round" ending a line with no punctuation, its object opening the next line
  let prepositional = 0;
  let runOn = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!/\bround$/i.test(lines[i])) continue;
    const next = lines[i + 1] || '';
    if (/^(the|its|one)\b/i.test(next)) prepositional += 1;
    if (/^and over\b/i.test(next)) runOn += 1;
  }
  assert.equal(prepositional, 11);
  assert.equal(runOn, 3);
  assert.match(flat(README), new RegExp(`${prepositional} of its 25 line-endings are a preposition`));
  assert.match(flat(README), /three more are \*round \/ and over\*/);

  const withHerHand = stanzas.map((s, i) => (s.lines.some((l) => /\bher hand[.,;:]?$/i.test(l)) ? i + 1 : 0)).filter(Boolean);
  let bestStart = 0;
  let bestLen = 0;
  for (let a = 0; a < withHerHand.length; ) {
    let b = a;
    while (b + 1 < withHerHand.length && withHerHand[b + 1] === withHerHand[b] + 1) b += 1;
    if (b - a + 1 > bestLen) { bestLen = b - a + 1; bestStart = withHerHand[a]; }
    a = b + 1;
  }
  assert.deepEqual([bestLen, bestStart], [5, 20], 'longest run of stanzas with a line ending "her hand"');
  assert.match(flat(README), /\*Her hand\* ends a line in five stanzas running \(20–24/);
});

test('the README names the face an iPhone actually uses, and the history it can source', () => {
  const stack = CSS.match(/body\s*\{[^}]*font-family:\s*([^;]+);/)[1];
  const first = stack.split(',')[0].trim().replace(/"/g, '');
  assert.equal(first, 'Iowan Old Style');
  const r = flat(README);
  assert.match(r, new RegExp(`an iPhone \\(or a Mac\\) sets the verse in ${first}`));
  assert.ok(!/Georgia and Noto Serif, the likely phone defaults/.test(r));
  assert.ok(!/Stedman's books of the 1670s is my recollection/.test(r));
  assert.match(r, /\*Tintinnalogia\* is 1668/);
  assert.match(r, /\*Campanalogia\* \(1677\) is Stedman's alone/);
});
