// Endpapers — tests. Run from the repo root: node --test ideas/39-endpapers/endpapers.test.mjs
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

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
function weekday(line) {
  const m = line.match(/(\d{1,2}) (\w{3}) (\d{2})/);
  assert.ok(m, `no date in "${line}"`);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(Date.UTC(1900 + Number(m[3]), MONTHS[m[2]], Number(m[1]))).getUTCDay()];
}
// Plain-English numbers and clock times, as the prose writes them.
const NUM = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
  twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, hundred: 100 };
function num(words) {
  return words.toLowerCase().split(/[\s-]+/).reduce((n, w) => {
    assert.ok(w in NUM, `not a number word: ${w}`);
    return NUM[w] === 100 ? n * 100 : n + NUM[w];
  }, 0);
}
// "eight minutes to two", "half past three", "a quarter past six" -> minutes after midnight, afternoon hours.
function clock(phrase) {
  const m = phrase.toLowerCase().match(/^(?:(.+?)(?: minutes)? (to|past) )?(\w+)$/);
  assert.ok(m, `not a clock time: ${phrase}`);
  const hour = num(m[3]) % 12 + 12;
  if (!m[2]) return hour * 60;
  const mins = m[1] === 'half' ? 30 : m[1] === 'a quarter' ? 15 : num(m[1]);
  return hour * 60 + (m[2] === 'to' ? -mins : mins);
}
const text = (id, s) => E.renderBlocks(story, story.passages[id], s)
  .map((b) => (b.type === 'list' ? b.entries.map((e) => e.text).join('\n') : b.text)).join('\n');

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
  const minDepth = {}; // ending id -> fewest choices that reach it
  const statesAt = new Map(); // passage id -> Map(key -> state): every reachable state at every passage
  function go(id, state, depth, viaC3) {
    const key = id + JSON.stringify(state);
    assert.ok(!stack.includes(key), `cycle through ${id}`);
    seenPassages.add(id);
    const p = story.passages[id];
    assert.ok(p, `missing passage ${id}`);
    seenKey.add(key);
    if (!statesAt.has(id)) statesAt.set(id, new Map());
    statesAt.get(id).set(key, { ...state });
    viaC3 = viaC3 || id.startsWith('c3-');
    if (viaC3) jasKeys.add(key);
    if (p.ending) {
      paths++;
      if (depth > longest) longest = depth;
      if (!(minDepth[id] <= depth)) minDepth[id] = depth;
      if (!endingStates.has(id)) endingStates.set(id, []);
      endingStates.get(id).push({ ...state });
      return;
    }
    const cs = E.visibleChoices(story, p, state);
    if (cs.length === 0) deadEnds.add(id);
    stack.push(key);
    for (const c of cs) {
      if (!c.to || !story.passages[c.to]) { missing.add(`${id} -> ${c.to}`); continue; }
      go(c.to, step(state, id, c), depth + 1, viaC3);
    }
    stack.pop();
  }
  const jasKeys = new Set(); // (passage, state) pairs in Chapter III or an ending reached through it
  go(story.start, freshState(), 0, false);
  const states = (id) => [...(statesAt.get(id) || new Map()).values()];
  const jasPairs = () => [...statesAt.entries()].flatMap(([id, m]) => [...m.entries()].filter(([k]) => jasKeys.has(k)).map(([, s]) => [id, s]));
  return { seenPassages, endingStates, deadEnds, missing, paths, longest, minDepth, statePairs: seenKey.size, states, jasPairs };
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

test('"Monday" (1989) and "The flat" (the interleaf) are the only endings that never pass through Chapter III; Monday has an opened and an unopened variant', () => {
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
  // every one of Ron's dates is a Sunday; Carol's one line (the funeral) is a Friday
  for (const entry of ['tick', 'query', 'none']) {
    for (const e of E.listEntries(story, { ...base, entry, stayed: true, wrote: true })) {
      assert.equal(weekday(e.text), e.by === 'ron' ? 'Sun' : 'Fri', e.text);
    }
  }
});

test('later chapters change their text with earlier state (not just which passage comes next)', () => {
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

// ---------- what the independent review caught (each of these failed before the revision) ----------
test('Jas\'s claim about the dates matches the register he is reading, in every reachable state', () => {
  const c3 = W.states('c3-list');
  assert.ok(c3.some((s) => s.wrote) && c3.some((s) => !s.wrote));
  for (const s of c3) {
    const t = text('c3-list', s);
    const days = E.listEntries(story, s).map((e) => weekday(e.text));
    if (days.every((d) => d === 'Sun')) {
      assert.match(t, /every one is a Sunday/);
      assert.doesNotMatch(t, /Friday/);
    } else {
      assert.doesNotMatch(t, /every one is a Sunday/, 'says every date is a Sunday when one is not');
      assert.match(t, /every one of his is a Sunday/);
      assert.match(t, /one Friday, in the round hand/);
    }
  }
});

test('Jas names "R. Pettit" only when he has seen the surname (the committee\'s letter, or Carol\'s name slip)', () => {
  let named = 0, unnamed = 0;
  for (const [id, s] of W.jasPairs()) {
    const t = text(id, s);
    if (!/Pettit/.test(t)) continue;
    assert.ok(s.letter !== 'none' || s.slip === 'name', `${id} names Pettit with letter=${s.letter} slip=${s.slip}`);
  }
  for (const s of W.states('end-continue')) {
    const t = text('end-continue', s);
    if (/who R\. Pettit was/.test(t)) named++;
    else { assert.match(t, /who Ron was/); unnamed++; }
  }
  assert.ok(named > 0 && unnamed > 0);
  // the case the review found: phone-number slip, no letter
  const contactOnly = W.states('end-continue').filter((s) => s.slip === 'contact' && s.letter === 'none');
  assert.ok(contactOnly.length > 0);
  for (const s of contactOnly) assert.match(text('end-continue', s), /who Ron was/);
});

test('"sixty years" in the hawk plate only where the note really lay there sixty years', () => {
  // note=book: still there in 2024. given=2024: Carol took it out in 2024. note=carol + given=1989: out in 1989.
  let early = 0;
  for (const [id, s] of W.jasPairs()) {
    const t = text(id, s);
    if (s.note === 'carol' && s.given === '1989') {
      early++;
      assert.doesNotMatch(t, /\blay\b[^.]*\bsixty years/, `${id} says sixty years with the note gone since 1989`);
    }
  }
  assert.ok(early > 0);
  const late = W.states('c3-choose').filter((s) => s.given === '2024');
  assert.ok(late.length > 0);
  for (const s of late) assert.match(text('c3-choose', s), /lay for sixty years/);
  for (const s of W.states('c3-choose').filter((s) => s.note === 'carol' && s.given === '1989')) {
    assert.match(text('c3-choose', s), /lay for a long time/);
  }
});

test('Chapter I\'s clock adds up: home no earlier than the stated drive allows', () => {
  const s0 = freshState();
  const watch = text('c1-watch', s0);
  const m = watch.match(/([A-Z][a-z]+ minutes to \w+)\. Northfleet is (a hundred|[a-z-]+) minutes away/);
  assert.ok(m, 'c1-watch states the time and the drive');
  const leave = clock(m[1]), drive = num(m[2]);
  assert.equal(leave, 13 * 60 + 52);
  for (const watched of ['bird', 'book']) {
    const home = text('c1-home', { ...s0, watched }).match(/You are home at ([^.]+)\./);
    assert.ok(home);
    assert.ok(clock(home[1]) >= leave + drive, `home at ${home[1]} after leaving at ${m[1]} with a ${drive}-minute drive`);
    const stay = text('c1-stay', { ...s0, watched, stayed: true });
    const back = stay.match(/At (a quarter past six) it comes back/);
    const late = stay.match(/You are home at ([^.]+)\./);
    assert.ok(back && late);
    assert.ok(clock(late[1]) >= clock(back[1]) + drive);
  }
  assert.match(text('c1-book', s0), /Eight minutes to two/);
});

test('word counts the prose states are true counts', () => {
  const s = { ...freshState(), entry: 'tick', stayed: true, watched: 'bird', letter: 'accepted', looked: true, note: 'book', given: '1989', phone: 'look' };
  const report = E.renderBlocks(story, story.passages['c3-report'], s);
  const q = report.find((b) => b.type === 'quote').text;
  const said = report.map((b) => b.text).join('\n').match(/(\w+) words in a county report[^.]*, and his name/);
  assert.ok(said);
  assert.equal(num(said[1]), E.wordsIn(q.replace(/\s*\([^)]*\)/, '')), `"${said[1]} words" for: ${q}`);
  // Eileen's note: "six words", wherever the prose counts them
  const note = 'Back by two. Mind you are.';
  for (const [id, st] of [['c3-list', s], ['end-skip', { ...s, opened: true, fate: 'skip', note: 'carol' }]]) {
    const t = text(id, st);
    assert.ok(t.includes(note) || id === 'end-skip');
    const n = t.match(/(\w+) words (?:on|in)/);
    assert.ok(n, `${id} counts the note`);
    assert.equal(num(n[1]), E.wordsIn(note));
  }
});

test('one line, one spelling: Ron\'s harrier and Carol\'s woodpecker read the same wherever they are quoted', () => {
  // Carol's c2-open hand block is the register's own line, in every state that reaches it
  for (const s of W.states('c2-open').filter((x) => x.entry !== 'none')) {
    const hand = E.renderBlocks(story, story.passages['c2-open'], s).find((b) => b.type === 'hand');
    const reg = E.listEntries(story, s).find((e) => /Montagu/.test(e.text));
    assert.equal(hand.text, reg.text, `entry=${s.entry} stayed=${s.stayed}`);
  }
  // Carol's woodpecker: the choice she writes, the register, and every later quotation are the same string
  const carol = story.list.find((e) => e.by === 'carol').line;
  const choice = story.passages['c2-found'].choices.find((c) => c.hand).text;
  assert.equal(choice, carol);
  let quoted = 0;
  for (const id of Object.keys(story.passages)) {
    for (const s of W.states(id)) {
      const t = E.renderBlocks(story, story.passages[id], s).filter((b) => b.type !== 'list').map((b) => b.text).join('\n');
      for (const m of t.matchAll(/Green Woodpecker\. St Botolph[^*\n]*/g)) { assert.equal(m[0], carol, id); quoted++; }
    }
  }
  assert.ok(quoted > 0);
});

test('prose slips stay fixed: Dungeness geography and the repeated place phrase', () => {
  // The 1961 lighthouse stands east of the 1904 one, the power station west of it (Trinity House):
  // the station is beside the two lighthouses, never between them.
  for (const id of Object.keys(story.passages)) {
    for (const s of W.states(id)) assert.doesNotMatch(text(id, s), /power station[^.]*between them/, id);
  }
  const shingle = text('c1-shingle', freshState());
  assert.equal(shingle.split('by the Long Pits').length - 1, 1);
});

test('the README agrees with the story and with this file', async () => {
  const { readFileSync } = await import('node:fs');
  const readme = readFileSync(new URL('./README.md', import.meta.url), 'utf8');
  const src = readFileSync(new URL(import.meta.url), 'utf8');
  const nTests = src.match(/^test\(/gm).length;
  assert.match(readme, new RegExp(`\\(\`endpapers\\.test\\.mjs\`, ${nTests} tests\\)`));
  assert.ok(readme.includes(T.paths.toLocaleString('en-GB') + ' distinct complete paths'));
  assert.ok(readme.includes(`${T.passages} passages`));
  assert.ok(readme.includes(`${T.writes.length} variables`));
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
  const cap = (w) => w[0].toUpperCase() + w.slice(1);
  assert.ok(readme.includes(`${cap(words[T.pathChoices.min])} to ${words[T.pathChoices.max]} choices per reading`));
  assert.equal(W.minDepth['end-skip'], T.pathChoices.min);
  assert.ok(readme.includes(`*Monday* ending can arrive ${words[W.minDepth['end-skip']]} choices in`));
  assert.ok(readme.includes('the same six words on greaseproof paper'));
  // "every Chapter III passage after the first varies with it": the first renders one way, the rest more than one
  const c3 = Object.keys(story.passages).filter((id) => id.startsWith('c3-'));
  const variants = (id) => new Set(W.states(id).map((s) => text(id, s))).size;
  assert.equal(story.passages[c3[0]].head.chapter, 'III');
  assert.equal(variants(c3[0]), 1);
  for (const id of c3.slice(1)) assert.ok(variants(id) > 1, `${id} never varies`);
  for (const id of ['end-continue', 'end-return', 'end-dungeness', 'end-shelf']) assert.ok(variants(id) > 1, `${id} never varies`);
  assert.match(readme, /every Chapter III passage after the first varies with it/);
  assert.doesNotMatch(readme, /every date in it is a Sunday/);
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
