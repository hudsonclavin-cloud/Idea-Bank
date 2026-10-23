// Pins the memo's wording to its evidence. Each test here guards a correction made after an
// independent review; each would have failed on the first version of the page.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8');
const readme = fs.readFileSync(path.join(HERE, 'README.md'), 'utf8');
const sources = JSON.parse(fs.readFileSync(path.join(HERE, 'sources.json'), 'utf8')).sources;

const section = (id) => {
  const a = html.indexOf(`id="${id}"`);
  assert.ok(a >= 0, `no section #${id}`);
  const b = html.indexOf('</section>', a);
  return html.slice(a, b);
};
const text = (h) => h.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&');
const evidenceItems = [...section('evidence').matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
const itemWith = (needle) => {
  const it = evidenceItems.find((s) => s.includes(needle));
  assert.ok(it, `no evidence point mentions ${needle}`);
  return it;
};

test('every quotation on the page appears in a snippet recorded in sources.json', () => {
  // Normalise away case, spacing, hyphens, quote marks and [editorial] brackets.
  const norm = (s) => s.toLowerCase().replace(/\[[^\]]*\]/g, '').replace(/['‘’"\-]/g, '').replace(/\s+/g, '').replace(/[.,;:]+$/, '');
  const hay = sources
    .flatMap((s) => Object.keys(s).filter((k) => /^seen_in/.test(k)).flatMap((k) => [].concat(s[k])))
    .map((e) => norm(e.snippet)).join('||');
  const MINE = new Set(['why did it wobble?']); // my own phrasing, not a quotation
  const body = text(html.slice(html.indexOf('<main>'), html.indexOf('</main>')));
  const missing = [];
  for (const m of body.matchAll(/"([^"]*)"/g)) {
    const q = m[1];
    if (q.length < 12 || MINE.has(q)) continue;
    if (!hay.includes(norm(q))) missing.push(q);
  }
  assert.deepEqual(missing, [], 'quoted words not found in any recorded snippet');
});

test('the 165-walker threshold is attributed to the north-span test, not the centre span', () => {
  const toy = section('toy');
  assert.ok(!/centre span/.test(text(toy)), 'toy caption should not tie 165 to the centre span');
  assert.match(text(toy), /165 walkers[\s\S]*north span/);
  assert.match(text(toy), /about 1 Hz/);
});

test('the frequency-mismatch point is limited to one mode and not tagged Certain or Likely', () => {
  const it = itemWith('Feldman');
  assert.match(it, /class="tag spec"/);
  for (const f of ['0.49 Hz', '0.77 Hz', '1.05 Hz']) assert.ok(it.includes(f), `should name the ${f} mode`);
  assert.ok(it.includes('href="#ref-18"'), 'should note the parametric route');
  assert.ok(!/could not confirm/.test(it), 'the other frequencies are now known');
});

test("Arup's force law is not presented as evidence that excludes synchrony", () => {
  const it = itemWith('related to the movement');
  assert.ok(it.includes('href="#ref-14"'), 'must say the synchrony model reproduces the same law');
  assert.match(text(it), /does not decide the question/);
  assert.ok(!html.includes("The engineers' empirical model said this in 2001"));
  assert.ok(!/engineers who measured it[^.]*say the crowd/i.test(html + readme), 'Arup read it as synchronisation');
});

test('the strongest case includes the north-span test, the synchronised lab cases and the parametric route', () => {
  const s = section('case-for');
  assert.match(text(s), /Five things hold up/);
  assert.match(text(s), /north span/);
  assert.match(text(s), /few outright synchronised cases/);
  assert.ok(s.includes('href="#ref-18"'));
});

test('the toy caption says what is assumed and no longer calls it the whole argument', () => {
  const s = text(section('toy'));
  assert.ok(!/whole argument in three lines/.test(s));
  assert.ok(!/changes nothing about when the bridge takes off/.test(s));
  assert.match(s, /assumed here/);
  assert.match(s, /not applied/);
});

test('the two probabilities agree across the verdict box, the conclusion and the README', () => {
  const box = Number(html.match(/<dd class="prob">(\d+)%/)[1]);
  const concl = text(section('verdict'));
  const onset = Number(concl.match(/right about the onset[^.]*?at about (\d+) per cent/)[1]);
  const amp = Number(concl.match(/amplitude once the sway was under way at about (\d+) per cent/)[1]);
  const boxAmp = Number(html.match(/about (\d+)% that falling into step helped/)[1]);
  const rd = readme.match(/Probabilities on the page: (\d+)%[^;]*; (\d+)%/);
  assert.ok(rd, 'README should state both probabilities');
  assert.deepEqual([box, onset, Number(rd[1])], [onset, onset, onset], 'onset probability differs between places');
  assert.deepEqual([boxAmp, Number(rd[2])], [amp, amp], 'amplitude probability differs between places');
  assert.equal(onset, 25, 'onset probability after the review');
});

test('the Bocian 2012 quotation matches the abstract', () => {
  assert.ok(!html.includes('"very well"'));
  assert.ok(!sources.find((s) => s.id === 11).claim.includes('very well'));
});
