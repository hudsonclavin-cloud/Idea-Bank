// Structural tests for Party Wall. Run from the repo root: node --test ideas/25-party-wall/wall.test.mjs
//
// These drive the state machine in wall.js with scripted knocks and a fake clock, and assert the
// pacing, stages, ending and determinism that the README claims. Nothing here touches a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { createWall, T, hashSeed } = require('./wall.js');
const HERE = path.dirname(fileURLToPath(import.meta.url));

// Drive a wall with a script of [t, x, y] knocks, like a page whose frames come every `cadence` ms,
// from the wall's current time up to exactly `until` (never past it). Knock times are visited
// exactly, in order. Returns every event the wall emitted, in order.
function run({ seed = 1, script = [], until = 0, cadence = 16, wall = null } = {}) {
  const w = wall || createWall({ seed });
  const log = [];
  const knocks = script.slice().sort((a, b) => a[0] - b[0]);
  let i = 0;
  const end = Math.max(until, knocks.length ? knocks[knocks.length - 1][0] : 0);
  let now = w.state().time;
  while (now < end || i < knocks.length) {
    let next = Math.min(end, now + cadence);
    if (i < knocks.length && knocks[i][0] <= next) {
      const [t, x, y] = knocks[i++];
      log.push(...w.knock(t, x ?? 0.5, y ?? 0.5));
      now = Math.max(now, t);
      continue;
    }
    now = next;
    log.push(...w.step(now));
  }
  return { wall: w, log };
}

// Step a wall (16 ms frames) until their current reply has finished and they are listening again.
// Returns the events. Stops at the moment of their last knock, so nothing later has happened yet.
function settle(w, log = []) {
  const start = w.state().time;
  let now = start;
  while (w.state().phase !== 'listening' || w.state().pending > 0 || w.state().phraseLength > 0) {
    now += 16;
    log.push(...w.step(now));
    if (now > start + 30000) throw new Error('reply never finished');
  }
  return log;
}

const HOUR = 3600 * 1000;
const theirs = (log) => log.filter((e) => e.type === 'knock' && e.who === 'them');
const ofType = (log, type) => log.filter((e) => e.type === type);

// A standard opening: five phrases, each answered, with enough quiet between them for the reply
// to finish. Returns the wall and the log, positioned after the 5th reply has ended.
function fiveReplies(seed = 1) {
  const w = createWall({ seed });
  const log = [];
  let t = 1000;
  const phrases = [
    [0, 300],
    [0, 250, 500],
    [0, 400, 600, 1000],
    [0, 200],
    [0, 350, 700],
  ];
  for (const ph of phrases) {
    for (const dt of ph) log.push(...w.knock(t + dt, 0.5, 0.6));
    assert.ok(w.state().scheduledReplyAt, 'a reply is scheduled');
    settle(w, log);
    t = Math.max(w.state().time, w.state().quietSince) + 1000; // next phrase 1 s after their reply ended
  }
  return { wall: w, log };
}

test('the constants the README quotes', () => {
  assert.equal(T.PHRASE_GAP, 1400);
  assert.equal(T.FIRST_DELAY, 3000);
  assert.equal(T.REPLY_DELAY, 900);
  assert.equal(T.PHRASE_MAX, 10);
  assert.equal(T.PLAIN_ECHOES, 2);
  assert.equal(T.TAG_GAP, 600);
  assert.equal(T.TAG_INTERVAL, 170);
  assert.equal(T.JITTER, 0.07);
  assert.equal(T.QUIET_FOR_BEAT, 4000);
  assert.equal(T.REPLIES_BEFORE_BEAT, 5);
  assert.equal(T.REPLIES_FORCE_BEAT, 7);
  assert.equal(T.BEAT_INTERVAL, 900);
  assert.equal(T.BEAT_COUNT, 12);
  assert.equal(T.BEAT_TOLERANCE, 180);
  assert.equal(T.LAG_MAX, 200);
  assert.equal(T.MATCHES_TO_END, 4);
  assert.equal(T.ENDED_REPLY_DELAY, 40);
});

test('before you knock, nothing happens, however long you wait', () => {
  const { wall, log } = run({ until: 60000, cadence: 100 });
  assert.equal(log.length, 0);
  assert.equal(wall.state().phase, 'idle');
});

test('the first answer is one faint knock, 4.4 s after your last knock, where your hand was', () => {
  const { log } = run({ script: [[1000, 0.3, 0.4], [1300, 0.35, 0.4], [1600, 0.7, 0.2]], until: 8000, cadence: 10 });
  const them = theirs(log);
  assert.equal(them.length, 1);
  const k = them[0];
  assert.equal(k.t, 1600 + T.PHRASE_GAP + T.FIRST_DELAY); // 6000
  assert.equal(k.kind, 'first');
  assert.equal(k.gain, T.GAIN.first);
  assert.equal(k.clarity, 0);
  assert.equal(k.x, 0.7);
  assert.equal(k.y, 0.2);
  // and nothing from them before that moment
  const before = log.filter((e) => e.who === 'them' && e.t < 6000);
  assert.equal(before.length, 0);
});

test('knocking again before the answer comes postpones it: they wait until you are quiet', () => {
  const { log } = run({ script: [[1000], [5000]], until: 12000, cadence: 10 });
  const them = theirs(log);
  assert.equal(them.length, 1);
  assert.equal(them[0].t, 5000 + T.PHRASE_GAP + T.FIRST_DELAY); // 9400
});

test('replies 2 and 3 echo your rhythm: same count, intervals within ±7%, positions follow your hand', () => {
  const w = createWall({ seed: 42 });
  const log = [];
  log.push(...w.knock(1000, 0.5, 0.5));
  log.push(...run({ wall: w, until: 6000, cadence: 10 }).log);
  assert.equal(theirs(log).length, 1, 'first answer done');
  const quiet = w.state().quietSince;
  const phrase = [
    [quiet + 1000, 0.2, 0.3],
    [quiet + 1250, 0.4, 0.3],
    [quiet + 1750, 0.6, 0.3],
    [quiet + 1900, 0.8, 0.3],
  ];
  const log2 = [];
  for (const [t, x, y] of phrase) log2.push(...w.knock(t, x, y));
  log2.push(...run({ wall: w, until: quiet + 8000, cadence: 10 }).log);
  const echo = theirs(log2);
  assert.equal(echo.length, 4);
  assert.ok(echo.every((k) => k.kind === 'echo' && k.clarity === 0));
  // starts 2.3 s after your last knock
  assert.equal(echo[0].t, quiet + 1900 + T.PHRASE_GAP + T.REPLY_DELAY);
  for (let i = 1; i < 4; i++) {
    const mine = phrase[i][0] - phrase[i - 1][0];
    const theirsI = echo[i].t - echo[i - 1].t;
    assert.ok(Math.abs(theirsI / mine - 1) <= T.JITTER + 1e-9, `interval ${i} within jitter: ${theirsI} vs ${mine}`);
    assert.notEqual(theirsI, mine, 'jittered, not a metronome');
  }
  echo.forEach((k, i) => {
    assert.equal(k.x, phrase[i][1]);
    assert.equal(k.y, phrase[i][2]);
    assert.ok(Math.abs(k.gain / T.GAIN.echo - 1) <= T.GAIN_JITTER + 1e-9);
  });
  assert.equal(w.state().replies, 2);
});

test('from reply 4 they add a two-knock tag after the echo (600 ms, then 170 ms)', () => {
  const w = createWall({ seed: 3 });
  // three replies first
  let t = 1000;
  for (let r = 0; r < 3; r++) {
    w.knock(t, 0.5, 0.5);
    w.knock(t + 300, 0.5, 0.5);
    settle(w);
    t = w.state().time + 500;
  }
  assert.equal(w.state().replies, 3);
  const log = [];
  log.push(...w.knock(t, 0.3, 0.3), ...w.knock(t + 400, 0.6, 0.6), ...w.knock(t + 800, 0.9, 0.9));
  log.push(...run({ wall: w, until: t + 8000, cadence: 10 }).log);
  const reply = theirs(log);
  assert.equal(reply.length, 3 + 2);
  assert.ok(reply.slice(0, 3).every((k) => k.kind === 'ask' && !k.tag));
  assert.ok(reply.slice(3).every((k) => k.kind === 'ask' && k.tag));
  assert.equal(reply[3].t - reply[2].t, T.TAG_GAP);
  assert.equal(reply[4].t - reply[3].t, T.TAG_INTERVAL);
  assert.equal(reply[3].x, 0.9);
  assert.equal(reply[4].y, 0.9);
});

test('a knock while they are answering stops the rest of their answer', () => {
  const w = createWall({ seed: 5 });
  w.knock(1000, 0.5, 0.5);
  run({ wall: w, until: 6000, cadence: 10 });
  const q = w.state().quietSince;
  const base = q + 1000;
  for (const dt of [0, 500, 1000, 1500, 2000]) w.knock(base + dt, 0.5, 0.5);
  const replyAt = w.state().scheduledReplyAt;
  const log = run({ wall: w, until: replyAt + 700, cadence: 10 }).log;
  const got = theirs(log);
  assert.equal(got.length, 2, 'two echo knocks have sounded (0 ms and ~500 ms)');
  const cut = w.knock(replyAt + 700, 0.5, 0.5);
  const ph = cut.find((e) => e.type === 'phase' && e.interrupted);
  assert.ok(ph, 'interruption recorded');
  assert.equal(ph.dropped, 3);
  assert.equal(w.state().pending, 0);
  // and nothing more from them until the new phrase gets its own reply
  const later = run({ wall: w, until: replyAt + 700 + T.PHRASE_GAP + T.REPLY_DELAY - 10, cadence: 10 }).log;
  assert.equal(theirs(later).length, 0);
  const then = run({ wall: w, until: replyAt + 700 + T.PHRASE_GAP + T.REPLY_DELAY + 10, cadence: 10 }).log;
  assert.equal(theirs(then).length, 1);
  assert.equal(w.state().replies, 3, 'the cut-off reply still counted, because it had begun');
});

test('after five replies and four seconds of quiet, they offer their beat: 12 knocks, 900 ms apart', () => {
  const { wall } = fiveReplies(9);
  assert.equal(wall.state().replies, 5);
  const q = wall.state().quietSince;
  const early = run({ wall, until: q + T.QUIET_FOR_BEAT - 10, cadence: 10 }).log;
  assert.equal(theirs(early).length, 0);
  const log = run({ wall, until: q + T.QUIET_FOR_BEAT + 12 * T.BEAT_INTERVAL + 1000, cadence: 10 }).log;
  const beats = theirs(log);
  assert.equal(beats.length, T.BEAT_COUNT);
  beats.forEach((b, k) => {
    assert.equal(b.kind, 'beat');
    assert.equal(b.t, q + T.QUIET_FOR_BEAT + k * T.BEAT_INTERVAL);
    assert.equal(b.clarity, 0, 'no matches, no clarity');
  });
  assert.equal(wall.state().offerings, 1);
  // Nobody joined: back to listening, and no second offer until another 4 s of quiet.
  assert.equal(wall.state().phase, 'listening');
  const lastClose = beats[11].t + T.BEAT_TOLERANCE;
  const again = run({ wall, until: lastClose + T.QUIET_FOR_BEAT + 10, cadence: 10 }).log;
  const second = theirs(again);
  assert.equal(second.length, 1);
  assert.equal(second[0].t, lastClose + T.QUIET_FOR_BEAT);
  assert.equal(wall.state().offerings, 2);
});

test('knocks within ±180 ms of a beat count; four in a row end it with one clear knock on the next beat', () => {
  const { wall } = fiveReplies(11);
  const q = wall.state().quietSince;
  const t0 = q + T.QUIET_FOR_BEAT;
  run({ wall, until: t0 - 1, cadence: 10 });
  const bt = (k) => t0 + k * T.BEAT_INTERVAL;
  const log = [];
  // one early, one late, two on the very edge of the window
  const joins = [bt(0) + 100, bt(1) - 150, bt(2) + T.BEAT_TOLERANCE, bt(3) - T.BEAT_TOLERANCE];
  let now = t0 - 1;
  for (const jt of joins) {
    log.push(...run({ wall, until: jt - 1, cadence: 1 }).log);
    log.push(...wall.knock(jt, 0.5, 0.5));
    now = jt;
  }
  log.push(...run({ wall, until: now + 3000, cadence: 10 }).log);
  const matches = ofType(log, 'match');
  assert.deepEqual(matches.map((m) => m.streak), [1, 2, 3, 4]);
  const closes = ofType(log, 'beat');
  assert.deepEqual(closes.slice(0, 4).map((c) => c.matched), [true, true, true, true]);
  // clarity rises on each beat after a match: beat 1 → 0.25, beat 2 → 0.5, beat 3 → 0.75
  const beats = theirs(log).filter((k) => k.kind === 'beat');
  assert.deepEqual(beats.slice(0, 4).map((b) => b.clarity), [0, 0.25, 0.5, 0.75]);
  const final = theirs(log).find((k) => k.kind === 'final');
  assert.ok(final, 'a final knock');
  assert.equal(final.t, bt(4));
  assert.equal(final.clarity, 1);
  assert.equal(final.gain, T.GAIN.final);
  assert.equal(beats.length, 4, 'no further beats after the fourth match');
  const end = ofType(log, 'end');
  assert.equal(end.length, 1);
  assert.equal(end[0].t, bt(4));
  assert.equal(wall.state().phase, 'ended');
  assert.equal(wall.state().endedAt, bt(4));
});

test('a knock 181 ms off the beat is a miss, and a beat nobody joined resets the streak', () => {
  const { wall } = fiveReplies(13);
  const q = wall.state().quietSince;
  const t0 = q + T.QUIET_FOR_BEAT;
  const bt = (k) => t0 + k * T.BEAT_INTERVAL;
  run({ wall, until: t0 - 1, cadence: 10 });
  const log = [];
  const plan = [
    [bt(0) + 50, 'match'],
    [bt(1) + T.BEAT_TOLERANCE + 1, 'miss'],
    // beat 2 skipped entirely
    [bt(3) - 40, 'match'],
    [bt(4) + 10, 'match'],
    [bt(5) - 10, 'match'],
    [bt(6) + 90, 'match'],
  ];
  let now = t0 - 1;
  for (const [jt, expect] of plan) {
    log.push(...run({ wall, until: jt - 1, cadence: 1 }).log);
    const ev = wall.knock(jt, 0.5, 0.5);
    log.push(...ev);
    assert.ok(ev.some((e) => e.type === expect), `${expect} at ${jt - t0}`);
    now = jt;
  }
  log.push(...run({ wall, until: now + 3000, cadence: 10 }).log);
  const closes = ofType(log, 'beat');
  assert.deepEqual(
    closes.map((c) => [c.index, c.matched, c.streak]),
    [
      [0, true, 1],
      [1, false, 0],
      [2, false, 0],
      [3, true, 1],
      [4, true, 2],
      [5, true, 3],
      [6, true, 4],
    ],
  );
  const final = theirs(log).find((k) => k.kind === 'final');
  assert.equal(final.t, bt(7));
  assert.equal(wall.state().phase, 'ended');
});

test('if you never leave a four-second gap, the beat takes the place of the eighth reply', () => {
  const w = createWall({ seed: 17 });
  let t = 1000;
  for (let r = 0; r < 7; r++) {
    w.knock(t, 0.5, 0.5);
    w.knock(t + 300, 0.5, 0.5);
    settle(w);
    assert.equal(w.state().replies, r + 1);
    t = w.state().time + 1500; // well inside the 4 s
  }
  assert.equal(w.state().offerings, 0);
  const log = [...w.knock(t, 0.4, 0.4), ...w.knock(t + 300, 0.4, 0.4)];
  const replyAt = w.state().scheduledReplyAt;
  assert.equal(replyAt, t + 300 + T.PHRASE_GAP + T.REPLY_DELAY);
  log.push(...run({ wall: w, until: replyAt + 2000, cadence: 10 }).log);
  const got = theirs(log);
  assert.ok(got.length >= 2);
  assert.equal(got[0].kind, 'beat');
  assert.equal(got[0].t, replyAt);
  assert.equal(got[1].t, replyAt + T.BEAT_INTERVAL);
  assert.equal(w.state().offerings, 1);
  assert.equal(w.state().replies, 7);
});

test('after the end, every knock is answered 40 ms later, clear, where you knocked', () => {
  const { wall } = fiveReplies(21);
  const q = wall.state().quietSince;
  const t0 = q + T.QUIET_FOR_BEAT;
  run({ wall, until: t0 - 1, cadence: 10 });
  for (let k = 0; k < 4; k++) {
    run({ wall, until: t0 + k * T.BEAT_INTERVAL - 1, cadence: 1 });
    wall.knock(t0 + k * T.BEAT_INTERVAL, 0.5, 0.5);
  }
  run({ wall, until: t0 + 5 * T.BEAT_INTERVAL, cadence: 10 });
  assert.equal(wall.state().phase, 'ended');
  const te = t0 + 20000;
  const ev = [...wall.knock(te, 0.1, 0.9), ...run({ wall, until: te + 500, cadence: 10 }).log];
  const them = theirs(ev);
  assert.equal(them.length, 1);
  assert.equal(them[0].t, te + T.ENDED_REPLY_DELAY);
  assert.equal(them[0].clarity, 1);
  assert.equal(them[0].gain, T.GAIN.ended);
  assert.equal(them[0].x, 0.1);
  assert.equal(them[0].y, 0.9);
  assert.equal(wall.state().phase, 'ended', 'the end stays ended');
});

test('their beat follows your hand: each beat lands where you last knocked', () => {
  const { wall } = fiveReplies(23);
  const q = wall.state().quietSince;
  const t0 = q + T.QUIET_FOR_BEAT;
  run({ wall, until: t0 + 10, cadence: 10 });
  const log = [...wall.knock(t0 + 400, 0.12, 0.88)]; // a miss, but it moves the hand
  log.push(...run({ wall, until: t0 + T.BEAT_INTERVAL + 10, cadence: 10 }).log);
  const b1 = theirs(log).find((k) => k.kind === 'beat' && k.index === 1);
  assert.equal(b1.x, 0.12);
  assert.equal(b1.y, 0.88);
});

test('a phrase is remembered as its last ten knocks', () => {
  const w = createWall({ seed: 2 });
  w.knock(1000, 0.5, 0.5);
  run({ wall: w, until: 6000, cadence: 10 });
  const q = w.state().quietSince;
  const times = [];
  for (let i = 0; i < 14; i++) times.push(q + 1000 + i * 200);
  const log = [];
  for (const t of times) log.push(...w.knock(t, (times.indexOf(t) + 1) / 15, 0.5));
  log.push(...run({ wall: w, until: times[13] + 6000, cadence: 10 }).log);
  const echo = theirs(log);
  assert.equal(echo.length, T.PHRASE_MAX);
  assert.equal(echo[0].x, 5 / 15, 'the echo starts from your fifth knock');
});

test('deterministic: same seed and same knocks give the same events whatever the frame rate', () => {
  const script = [
    [1000, 0.5, 0.5],
    [1300, 0.52, 0.5],
    [7000, 0.4, 0.4],
    [7250, 0.4, 0.4],
    [7750, 0.4, 0.4],
    [14000, 0.6, 0.6],
    [14100, 0.6, 0.6],
    [14600, 0.6, 0.6],
    [21000, 0.5, 0.5],
    [21500, 0.5, 0.5],
    [22000, 0.5, 0.5],
    [30000, 0.5, 0.5],
  ];
  const strip = (log) => JSON.stringify(log.map((e) => ({ ...e })));
  const a = run({ seed: 'neighbour', script, until: 60000, cadence: 7 }).log;
  const b = run({ seed: 'neighbour', script, until: 60000, cadence: 53 }).log;
  const c = run({ seed: 'neighbour', script, until: 60000, cadence: 1000 }).log;
  assert.equal(strip(a), strip(b));
  assert.equal(strip(a), strip(c));
  assert.ok(theirs(a).length >= 6, 'the script got through several exchanges');
  const d = run({ seed: 'someone else', script, until: 60000, cadence: 7 }).log;
  assert.notEqual(strip(a), strip(d), 'a different seed knocks a little differently');
  // and the *structure* is seed-independent: same count and kinds of their knocks
  assert.deepEqual(theirs(a).map((k) => k.kind), theirs(d).map((k) => k.kind));
  assert.equal(hashSeed('neighbour'), hashSeed('neighbour'));
  assert.notEqual(hashSeed('neighbour'), hashSeed('someone else'));
});

test('the clock may stall but never run backwards', () => {
  const w = createWall({ seed: 1 });
  w.knock(1000, 0.5, 0.5);
  w.step(2000);
  assert.doesNotThrow(() => w.step(1500));
  assert.equal(w.state().time, 2000);
  assert.doesNotThrow(() => w.knock(1900, 0.5, 0.5), 'a knock stamped slightly in the past is tolerated');
  assert.equal(w.state().time, 2000);
});

test('nothing is stored: neither the machine nor the page touches browser storage', () => {
  for (const f of ['wall.js', 'app.js']) {
    const src = fs.readFileSync(path.join(HERE, f), 'utf8');
    for (const bad of ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie', 'fetch(', 'XMLHttpRequest']) {
      assert.ok(!src.includes(bad), `${f} must not use ${bad}`);
    }
  }
  const html = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8');
  assert.ok(/<meta name="viewport" content="width=device-width, initial-scale=1">/.test(html));
  assert.ok(!/https?:\/\//.test(html.replace(/<!--[\s\S]*?-->/g, '')), 'no external resources');
});

// ---------- added after the independent review ----------

test('a tab left in the background for hours: one step catches up without error, same events as small steps', () => {
  // Before the fix a single step() gave up after 10,000 events (about 94 minutes of their beat).
  for (const hours of [1.6, 8, 24]) {
    const a = fiveReplies(31).wall;
    const b = fiveReplies(31).wall;
    const q = a.state().quietSince;
    let one;
    assert.doesNotThrow(() => {
      one = a.step(q + hours * HOUR);
    }, `${hours} h in one step`);
    const many = [];
    for (let t = b.state().time + 1000; t < q + hours * HOUR; t += 1000) many.push(...b.step(t));
    many.push(...b.step(q + hours * HOUR));
    assert.equal(JSON.stringify(one), JSON.stringify(many), `${hours} h: same events`);
    // one offering every 14,080 ms (4 s of quiet + 11 × 900 ms + 180 ms to close the last window)
    const cycle = T.QUIET_FOR_BEAT + (T.BEAT_COUNT - 1) * T.BEAT_INTERVAL + T.BEAT_TOLERANCE;
    assert.equal(a.state().offerings, Math.floor((hours * HOUR - T.QUIET_FOR_BEAT) / cycle) + 1);
    assert.equal(a.state().time, q + hours * HOUR);
  }
});

test('a clock that is not a finite number is ignored, not obeyed', () => {
  const w = fiveReplies(33).wall;
  const t = w.state().time;
  for (const bad of [NaN, Infinity, -Infinity, undefined, '5000']) {
    assert.doesNotThrow(() => w.step(bad));
    assert.equal(w.state().time, t);
  }
  const ev = w.knock(Infinity, 0.5, 0.5);
  assert.equal(ev.find((e) => e.who === 'you').t, t, 'a knock at an impossible time is stamped now');
});

test('the late edge of the beat window stretches by the page lag; the early edge does not', () => {
  const lag = 120;
  const cases = [
    [-T.BEAT_TOLERANCE, 'match'],
    [-T.BEAT_TOLERANCE - 0.001, 'miss'],
    [T.BEAT_TOLERANCE + lag, 'match'],
    [T.BEAT_TOLERANCE + lag + 0.001, 'miss'],
    [T.BEAT_TOLERANCE + 60, 'match'], // a miss without the lag
  ];
  for (const [off, expect] of cases) {
    const { wall } = fiveReplies(41);
    wall.setLag(lag);
    const t0 = wall.state().quietSince + T.QUIET_FOR_BEAT;
    const at = t0 + 2 * T.BEAT_INTERVAL + off;
    run({ wall, until: at - 0.5, cadence: 1 });
    const ev = wall.knock(at, 0.5, 0.5);
    assert.ok(ev.some((e) => e.type === expect), `${off} ms from beat 2 with lag ${lag}: ${expect}`);
  }
  // and each window closes lag ms later than it used to
  const { wall } = fiveReplies(41);
  wall.setLag(lag);
  const t0 = wall.state().quietSince + T.QUIET_FOR_BEAT;
  const log = run({ wall, until: t0 + 3 * T.BEAT_INTERVAL, cadence: 10 }).log;
  assert.deepEqual(
    ofType(log, 'beat').map((c) => c.t - t0),
    [0, 1, 2].map((k) => k * T.BEAT_INTERVAL + T.BEAT_TOLERANCE + lag),
  );
});

test('the lag is clamped to 0–200 ms and fixed for each offering when it starts', () => {
  assert.equal(createWall({ lag: 500 }).state().lag, T.LAG_MAX);
  assert.equal(createWall({ lag: -40 }).state().lag, 0);
  assert.equal(createWall({ lag: NaN }).state().lag, 0);
  assert.equal(createWall({}).state().lag, 0);
  const { wall } = fiveReplies(43);
  const t0 = wall.state().quietSince + T.QUIET_FOR_BEAT;
  run({ wall, until: t0 + 10, cadence: 10 }); // the offering has started with lag 0
  wall.setLag(150);
  assert.equal(wall.state().lag, 150);
  const at = t0 + T.BEAT_INTERVAL + T.BEAT_TOLERANCE + 100;
  run({ wall, until: at - 1, cadence: 1 });
  assert.ok(wall.knock(at, 0.5, 0.5).some((e) => e.type === 'miss'), 'the open offering keeps its own window');
});

test('with a lag, four joins still end it, and the end still comes on the next beat', () => {
  const { wall } = fiveReplies(47);
  wall.setLag(T.LAG_MAX);
  const t0 = wall.state().quietSince + T.QUIET_FOR_BEAT;
  const bt = (k) => t0 + k * T.BEAT_INTERVAL;
  const log = [];
  for (let k = 0; k < 4; k++) {
    const at = bt(k) + T.BEAT_TOLERANCE + T.LAG_MAX; // every knock on the very late edge
    log.push(...run({ wall, until: at - 1, cadence: 1 }).log, ...wall.knock(at, 0.5, 0.5));
  }
  log.push(...run({ wall, until: bt(6), cadence: 10 }).log);
  assert.deepEqual(ofType(log, 'match').map((m) => m.streak), [1, 2, 3, 4]);
  const final = theirs(log).find((k) => k.kind === 'final');
  assert.equal(final.t, bt(4));
  assert.equal(wall.state().phase, 'ended');
});

test('quiet after the fourth answer does nothing; after the fifth, they knock first', () => {
  // README: "From the fourth answer they add something small of their own. After the fifth, if you
  // go quiet, they knock first."
  const w = createWall({ seed: 51 });
  let t = 1000;
  for (let r = 0; r < 4; r++) {
    w.knock(t, 0.5, 0.5);
    w.knock(t + 300, 0.5, 0.5);
    settle(w);
    t = w.state().time + 1000;
  }
  assert.equal(w.state().replies, 4);
  const quiet = run({ wall: w, until: w.state().time + 10 * 60 * 1000, cadence: 100 }).log;
  assert.equal(quiet.length, 0, 'ten minutes of nothing after four answers');
  const { wall } = fiveReplies(51);
  const q = wall.state().quietSince;
  const log = run({ wall, until: q + T.QUIET_FOR_BEAT, cadence: 100 }).log;
  assert.equal(theirs(log).length, 1);
  assert.equal(theirs(log)[0].t, q + T.QUIET_FOR_BEAT);
});

test('a knock just before the first beat of an offering is a new phrase, not a join', () => {
  // README: "for the first beat of an offering, only from the beat onward"
  const { wall } = fiveReplies(53);
  const t0 = wall.state().quietSince + T.QUIET_FOR_BEAT;
  run({ wall, until: t0 - 101, cadence: 10 });
  const ev = wall.knock(t0 - 100, 0.5, 0.5);
  assert.ok(!ev.some((e) => e.type === 'match' || e.type === 'miss'));
  const log = run({ wall, until: t0 + 4000, cadence: 10 }).log;
  assert.ok(!theirs(log).some((k) => k.kind === 'beat'), 'no beat: they answer the phrase instead');
  assert.equal(theirs(log)[0].t, t0 - 100 + T.PHRASE_GAP + T.REPLY_DELAY);
});

test('deterministic through the beat, the ending and after it, with a lag, at any frame rate', () => {
  const play = (cadence, seed = 'whole') => {
    const { wall, log } = fiveReplies(seed);
    wall.setLag(90);
    const t0 = wall.state().quietSince + T.QUIET_FOR_BEAT;
    const script = [
      [t0 + 400], // a miss
      [t0 + 1 * T.BEAT_INTERVAL + 30],
      [t0 + 2 * T.BEAT_INTERVAL + 250], // late, but inside the stretched window
      [t0 + 3 * T.BEAT_INTERVAL - 170],
      [t0 + 4 * T.BEAT_INTERVAL + 5],
      [t0 + 9000, 0.2, 0.8],
      [t0 + 9500, 0.8, 0.2],
    ];
    log.push(...run({ wall, script, until: t0 + 12000, cadence }).log);
    return log;
  };
  const strip = (log) => JSON.stringify(log);
  const a = play(1);
  assert.ok(ofType(a, 'end').length === 1, 'the script reaches the end');
  assert.equal(theirs(a).filter((k) => k.kind === 'ended').length, 2);
  for (const cadence of [7, 16.7, 53, 1000, 5000]) assert.equal(strip(play(cadence)), strip(a), `cadence ${cadence}`);
  assert.notEqual(strip(play(7, 'other')), strip(a));
});

test('the README says what the machine does', () => {
  const md = fs.readFileSync(path.join(HERE, 'README.md'), 'utf8');
  assert.ok(md.includes('After the fifth, if you go quiet, they knock first'));
  assert.ok(!/From the fourth answer[^.]*\.\s*If you then go quiet/.test(md), 'the old fourth-answer claim is gone');
  assert.ok(md.includes(`±${T.BEAT_TOLERANCE} ms`));
  assert.ok(md.includes(`up to ${T.LAG_MAX} ms`));
});
