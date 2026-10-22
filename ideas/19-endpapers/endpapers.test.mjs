// Endpapers — tests. Run from the repo root: node --test ideas/19-endpapers/endpapers.test.mjs
//
// The traversal below is written here, in the test, and walks the passage graph
// through the engine's real choice/state logic (visibleChoices + set). It then
// compares its count with the engine's own traverse() so two implementations
// must agree. Everything the README claims about the structure is asserted here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('./engine.js');
const story = require('./story.js');

// ---------- helpers ----------
function freshState() {
  const s = { ...story.vars };
  applySet(s, story.passages[story.start].set);
  return s;
}
function applySet(state, set) {
  if (set) for (const k of Object.keys(set)) state[k] = set[k];
}
function step(state, passageId, choice) {
  const s = { ...state };
  applySet(s, choice.set);
  applySet(s, story.passages[choice.to].set);
  return s;
}

// Independent walk: every (passage, state) from the start, recording the states
// that arrive at each ending and the choice sequence of every complete path.
function walk() {
  const seenPassages = new Set();
  const endingStates = new Map(); // ending id -> [state]
  const deadEnds = new Set();
  const missing = new Set();
  let paths = 0;
  let longest = 0;
  const stack = [];
  const seenKey = new Set();
  function go(id, state, depth) {
    const key = id + JSON.stringify(state);
    assert.ok(!stack.includes(key), `cycle through ${id}`);
    seenPassages.add(id);
    const p = story.passages[id];
    assert.ok(p, `missing passage ${id}`);
    seenKey.add(key);
    if (p.ending) {
      paths++;
      if (depth > longest) longest = depth;
      if (!endingStates.has(id)) endingStates.set(id, []);
      endingStates.get(id).push({ ...state });
      return;
    }
    const cs = E.visibleChoices(story, p, state);
    if (cs.length === 0) deadEnds.add(id);
    stack.push(key);
    for (const c of cs) {
      if (!c.to || !story.passages[c.to]) { missing.add(`${id} -> ${c.to}`); continue; }
      go(c.to, step(state, id, c), depth + 1);
    }
    stack.pop();
  }
  go(story.start, freshState(), 0);
  return { seenPassages, endingStates, deadEnds, missing, paths, longest, statePairs: seenKey.size };
}

const W = walk();
const T = E.traverse(story);
const ALL = Object.keys(story.passages);
const ENDINGS = ALL.filter((id) => story.passages[id].ending);

// ---------- structure ----------
test('every passage is reachable from the start', () => {
  const unreachable = ALL.filter((id) => !W.seenPassages.has(id));
  assert.deepEqual(unreachable, []);
  assert.deepEqual(T.unreachable, []);
});

test('there are at least three endings and every one is reachable', () => {
  assert.ok(ENDINGS.length >= 3, `only ${ENDINGS.length} endings`);
  for (const id of ENDINGS) assert.ok(W.endingStates.has(id), `ending ${id} never reached`);
  assert.deepEqual([...W.endingStates.keys()].sort(), ENDINGS.sort());
});

test('no dead ends: every non-ending passage offers at least one choice in every reachable state', () => {
  assert.deepEqual([...W.deadEnds], []);
  assert.deepEqual(T.deadEnds, []);
});

test('no choice links to a missing passage (statically and dynamically)', () => {
  for (const id of ALL) {
    for (const c of story.passages[id].choices || []) {
      const targets = typeof c.to === 'string' ? [c.to] : c.to.map((t) => t.id);
      for (const t of targets) assert.ok(story.passages[t], `${id} -> ${t} is missing`);
    }
  }
  assert.deepEqual([...W.missing], []);
  assert.deepEqual(T.missing, []);
});

test('endings have no choices; non-endings do', () => {
  for (const id of ALL) {
    const p = story.passages[id];
    if (p.ending) assert.ok(!(p.choices && p.choices.length), `${id} is an ending with choices`);
    else assert.ok(p.choices && p.choices.length, `${id} has no choices`);
  }
});

test('the graph is acyclic (so the path count is exact)', () => {
  assert.deepEqual(T.cycles, []);
});

test('every variable that is read is written somewhere, and vice versa', () => {
  const unwritten = T.reads.filter((v) => !T.writes.includes(v));
  const unread = T.writes.filter((v) => !T.reads.includes(v));
  assert.deepEqual(unwritten, []);
  assert.deepEqual(unread, []);
});

test('every condition in the story parses', () => {
  for (const c of T.conds) assert.doesNotThrow(() => E.parseCond(c), `bad condition: ${c}`);
  assert.throws(() => E.parseCond('entry = '));
  assert.throws(() => E.parseCond('and entry'));
  assert.throws(() => E.parseCond('(entry=tick'));
});

test('the condition language behaves', () => {
  const s = { a: true, b: false, k: 'tick', n: '1989' };
  assert.equal(E.test('a', s), true);
  assert.equal(E.test('b', s), false);
  assert.equal(E.test('not b', s), true);
  assert.equal(E.test('k=tick', s), true);
  assert.equal(E.test('k!=tick', s), false);
  assert.equal(E.test('n=1989', s), true);
  assert.equal(E.test('a and k=tick', s), true);
  assert.equal(E.test('b or k=tick', s), true);
  assert.equal(E.test('not (a and k=tick)', s), false);
  assert.equal(E.test('b or not b and a', s), true);
  assert.deepEqual(E.condVars('a and (k=tick or not n=1989)').sort(), ['a', 'k', 'n']);
});

test('the two traversals agree on the number of distinct complete paths', () => {
  assert.equal(W.paths, T.paths);
  assert.ok(W.paths > 100, `only ${W.paths} paths`);
  const perEnding = Object.values(T.pathsPerEnding).reduce((a, b) => a + b, 0);
  assert.equal(perEnding, T.paths);
});

// ---------- the state claims the README makes ----------
test('ending gates: "The river" needs Carol\'s phone number; "The tenth" needs a harrier in the register', () => {
  for (const s of W.endingStates.get('end-return')) {
    assert.equal(s.slip, 'contact');
    assert.equal(s.fate, 'keep');
    assert.equal(s.given, '2024');
  }
  for (const s of W.endingStates.get('end-dungeness')) assert.notEqual(s.entry, 'none');
  // and both gates really bite: some chapter-III states lack them
  const c3 = W.endingStates.get('end-shelf');
  assert.ok(c3.some((s) => s.slip !== 'contact'));
  assert.ok(c3.some((s) => s.entry === 'none'));
});

test('"Monday" is the only ending that can be reached without Chapter III; it has both an opened and an unopened variant', () => {
  const skip = W.endingStates.get('end-skip');
  assert.ok(skip.some((s) => s.opened) && skip.some((s) => !s.opened));
  for (const s of skip) assert.equal(s.fate, 'skip');
  for (const id of ENDINGS) {
    if (id === 'end-skip' || id === 'end-kept') continue;
    for (const s of W.endingStates.get(id)) assert.notEqual(s.phone, 'none', `${id} reached without Chapter III`);
  }
  for (const s of W.endingStates.get('end-kept')) assert.equal(s.phone, 'none');
});

test('Eileen\'s note reaches Jas only when Carol never opened the book', () => {
  for (const id of ['end-continue', 'end-return', 'end-dungeness', 'end-shelf']) {
    for (const s of W.endingStates.get(id)) {
      assert.equal(s.note === 'book', !s.opened, `${id}: note=${s.note} opened=${s.opened}`);
    }
  }
});

test('the committee\'s letter exists only if Ron wrote the bird as certain, and is accepted only if he watched and stayed', () => {
  for (const id of ENDINGS) {
    for (const s of W.endingStates.get(id)) {
      if (s.letter !== 'none') assert.equal(s.entry, 'tick');
      if (s.letter === 'accepted') assert.ok(s.stayed && s.watched === 'bird');
      if (s.letter === 'rejected') assert.ok(!(s.stayed && s.watched === 'bird'));
    }
  }
});

test('the register is a function of state: the harrier line appears, with a question mark, with the evening time', () => {
  const base = freshState();
  const lines = (s) => E.listEntries(story, s).map((e) => e.text);
  assert.equal(lines(base).filter((l) => /Montagu/.test(l)).length, 0);
  assert.equal(lines({ ...base, entry: 'tick' }).filter((l) => /Montagu/.test(l)).length, 1);
  assert.match(lines({ ...base, entry: 'query' }).find((l) => /Montagu/.test(l)), /\(\?\)/);
  assert.match(lines({ ...base, entry: 'tick', stayed: true }).find((l) => /Montagu/.test(l)), /6\.15/);
  assert.doesNotMatch(lines({ ...base, entry: 'tick', stayed: false }).find((l) => /Montagu/.test(l)), /6\.15/);
  assert.ok(lines({ ...base, wrote: true }).some((l) => /Woodpecker/.test(l)));
  assert.ok(!lines(base).some((l) => /Woodpecker/.test(l)));
  // every date in the register is a Sunday, as Chapter III claims
  const months = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  for (const l of lines({ ...base, entry: 'tick', wrote: false })) {
    const m = l.match(/(\d{1,2}) (\w{3}) (\d{2})/);
    assert.ok(m, `no date in "${l}"`);
    const d = new Date(Date.UTC(1900 + Number(m[3]), months[m[2]], Number(m[1])));
    assert.equal(d.getUTCDay(), 0, `${l} is not a Sunday`);
  }
});

test('later chapters change their text with earlier state (not just which passage comes next)', () => {
  const text = (id, s) => E.renderBlocks(story, story.passages[id], s).map((b) => b.type === 'list' ? b.entries.map((e) => e.text).join('\n') : b.text).join('\n');
  const base = freshState();
  // Carol's reading of the register
  const none = text('c2-open', { ...base, opened: true, entry: 'none' });
  const tick = text('c2-open', { ...base, opened: true, entry: 'tick', stayed: true });
  const query = text('c2-open', { ...base, opened: true, entry: 'query', stayed: false });
  assert.notEqual(none, tick);
  assert.match(tick, /quarter past six/);
  assert.doesNotMatch(query, /quarter past six/);
  assert.match(query, /question mark/);
  assert.match(none, /keeping the place of nothing/);
  // Jas finds the note, the letter, the slip, the woodpecker
  const jasBase = { ...base, phone: 'look', given: '1989', fate: 'charity' };
  assert.match(text('c3-list', { ...jasBase, note: 'book' }), /Back by two/);
  assert.doesNotMatch(text('c3-list', { ...jasBase, note: 'carol' }), /Back by two/);
  assert.match(text('c3-list', { ...jasBase, letter: 'rejected', entry: 'tick' }), /harrier sp/);
  assert.match(text('c3-list', { ...jasBase, wrote: true }), /Woodpecker/);
  assert.match(text('c3-shop', { ...jasBase, given: '2024', slip: 'contact' }), /Ring me/);
  assert.doesNotMatch(text('c3-shop', { ...jasBase }), /Ring me/);
  assert.match(text('c3-shop', { ...jasBase }), /D\. Ashby/);
  // the recorder's reply has four different outcomes
  const outcomes = new Set([
    text('c3-report', { ...jasBase, letter: 'accepted', entry: 'tick' }),
    text('c3-report', { ...jasBase, letter: 'rejected', entry: 'tick' }),
    text('c3-report', { ...jasBase, letter: 'none', entry: 'query' }),
    text('c3-report', { ...jasBase, letter: 'none', entry: 'none' }),
  ]);
  assert.equal(outcomes.size, 4);
});

test('the provenance is a different document for every ending, and never empty', () => {
  const docs = new Set();
  for (const id of ENDINGS) {
    for (const s of W.endingStates.get(id)) {
      const lines = E.provenance(story, s);
      assert.ok(lines.length >= 3, `${id}: ${lines.length} lines`);
      assert.ok(lines.every((l) => l.length > 0 && !/\{\w+\}/.test(l)));
      docs.add(lines.join('\n'));
    }
  }
  assert.ok(docs.size >= ENDINGS.length);
  const s = { ...freshState(), entry: 'tick', end: 'continue' };
  assert.match(E.provenance(story, s)[1], /^Ronald Pettit.*\b24 lines/);
});

// ---------- the game object ----------
test('createGame plays through to two different endings and start() resets everything', () => {
  const g = E.createGame(story);
  const pickText = (re) => {
    const cs = g.choices();
    const i = cs.findIndex((c) => re.test(c.text));
    assert.ok(i >= 0, `no choice matching ${re} at ${g.at}: ${cs.map((c) => c.text).join(' | ')}`);
    g.choose(i);
  };
  // Path A: stayed, certain, posted, accepted; Carol keeps; writes number; Jas rings.
  pickText(/Drive/); pickText(/glasses/); pickText(/Stay/); pickText(/female/); pickText(/post it/);
  assert.equal(g.at, 'c1-reply-yes');
  assert.equal(g.state.letter, 'accepted');
  pickText(/years after/); pickText(/Chapter II/); pickText(/Open it/); pickText(/Go on/);
  pickText(/Woodpecker/); pickText(/Keep it/); pickText(/Interleaf/); pickText(/mobile number/);
  pickText(/Chapter III/); pickText(/Stand still/); pickText(/One pound fifty/); pickText(/Recorder/);
  pickText(/Saturday/); pickText(/Ring the number/);
  assert.equal(g.at, 'end-return');
  assert.ok(g.isEnding());
  assert.equal(g.state.end, 'return');
  assert.equal(g.taken.length, 19);
  assert.match(g.blocks().map((b) => b.text).join('\n'), /only record of the year/);
  assert.match(g.provenance().join('\n'), /Returned/);

  // Restart: everything back to the defaults.
  g.start();
  assert.equal(g.at, story.start);
  assert.deepEqual(g.state, freshState());
  assert.deepEqual(g.taken, []);

  // Path B: the shortest: never open the book.
  pickText(/Drive/); pickText(/book open/); pickText(/Go now/);
  assert.ok(!g.choices().some((c) => /female/.test(c.text)), 'tick must not be offered after reaching for the book and leaving');
  pickText(/Write nothing/); pickText(/Chapter II/); pickText(/chair for Monday/);
  assert.equal(g.at, 'end-skip');
  assert.match(g.blocks().map((b) => b.text).join('\n'), /Nobody reads the note again/);
  assert.equal(g.taken.length, 6);
});

test('choose() refuses a choice that is not visible', () => {
  const g = E.createGame(story);
  g.choose(0); g.choose(1); g.choose(0); // book, go home
  assert.equal(g.at, 'c1-home');
  assert.equal(g.choices().length, 2);
  assert.throws(() => g.choose(2));
});

// ---------- the numbers ----------
test('report', () => {
  const words = T.words;
  console.log(`\n  passages: ${T.passages}\n  endings: ${ENDINGS.length} (${ENDINGS.join(', ')})\n  words in the story file (all variants, choices included): ${words}` +
    `\n  words on one path: ${T.pathWords.min}–${T.pathWords.max}\n  choices on one path: ${T.pathChoices.min}–${T.pathChoices.max}` +
    `\n  distinct complete paths: ${T.paths} (per ending: ${JSON.stringify(T.pathsPerEnding)})` +
    `\n  (passage, state) pairs visited: ${W.statePairs}\n  variables: ${T.writes.length} (${T.writes.join(', ')})\n`);
  assert.ok(words > 5000);
});
