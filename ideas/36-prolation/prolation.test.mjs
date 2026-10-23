// prolation.test.mjs — checks the rules README.md claims, on the note events themselves.
//
// Run from the repo root: node --test ideas/36-prolation/prolation.test.mjs
// More seeds: PROLATION_SEEDS=300 node --test ideas/36-prolation/prolation.test.mjs
//
// Nothing here calls the composer's own rule code (buildModel, pairCost, melodyCost, violations).
// Every check is re-derived from the events a listener would hear: voice, onset, duration, MIDI
// note, plus the mode and proportions the piece declares. Times are compared in the events' exact
// integer units (onUnits, durUnits), which the tests also confirm match the seconds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('./compose.js');
const { midiFile } = require('./midi.js');

const COUNT = Number(process.env.PROLATION_SEEDS || 60);
const SEEDS = Array.from({ length: COUNT }, (_, i) => String(i * 7919 + 13));
const pieces = new Map();
const piece = (s) => {
  if (!pieces.has(s)) pieces.set(s, P.compose(s));
  return pieces.get(s);
};

const CONSONANT = new Set([0, 3, 4, 7, 8, 9]); // + the fourth (5) between two upper voices
const mod12 = (x) => ((x % 12) + 12) % 12;

/** Each voice's events in order, with prev/next links and "joined" flags (no rest between). */
function byVoice(p) {
  const out = p.voices.map(() => []);
  for (const e of p.events) out[e.voice].push(e);
  for (const list of out) {
    list.sort((a, b) => a.onUnits - b.onUnits);
    list.forEach((e, i) => {
      e._i = i;
      e._prev = list[i - 1] || null;
      e._next = list[i + 1] || null;
      e._joinedPrev = !!e._prev && e._prev.onUnits + e._prev.durUnits === e.onUnits;
      e._joinedNext = !!e._next && e.onUnits + e.durUnits === e._next.onUnits;
    });
  }
  return out;
}

/** Every pair of notes in different voices that sound at the same time (open intervals). */
function overlaps(p) {
  const evs = p.events.slice().sort((a, b) => a.onUnits - b.onUnits);
  const out = [];
  const active = [];
  for (const e of evs) {
    for (let i = active.length - 1; i >= 0; i--) if (active[i].onUnits + active[i].durUnits <= e.onUnits) active.splice(i, 1);
    for (const o of active) if (o.voice !== e.voice) out.push([o, e]); // o started no later than e
    active.push(e);
  }
  return out;
}

/** Scale degree of a MIDI note in the piece's mode, counted from the final (independent of compose). */
function degreeOf(p, midi) {
  const rel = midi - p.mode.final;
  const oct = Math.floor(rel / 12);
  const step = p.mode.steps.indexOf(mod12(rel));
  assert.ok(step >= 0, `MIDI ${midi} is not in ${p.mode.name} on ${p.mode.final}`);
  return oct * 7 + step;
}

test('the same seed always gives the same performance; different seeds differ', () => {
  for (const s of ['1', '42', 'hello', SEEDS[3]]) {
    const a = JSON.stringify(P.compose(s).events);
    const b = JSON.stringify(P.compose(s).events);
    assert.equal(a, b, `seed ${s} is not deterministic`);
  }
  const fingerprints = new Set(SEEDS.slice(0, 20).map((s) => JSON.stringify(piece(s).events.map((e) => [e.midi, e.onUnits]))));
  assert.equal(fingerprints.size, 20, 'twenty seeds should give twenty different pieces');
});

test('times are exact: seconds are the integer units times a dyadic unit, so notes meet exactly', () => {
  for (const s of SEEDS) {
    const p = piece(s);
    assert.ok(Number.isInteger(p.unit * 2 ** 20), 'unit is a multiple of 2^-20 s');
    for (const e of p.events) {
      assert.ok(Number.isInteger(e.onUnits) && Number.isInteger(e.durUnits) && e.durUnits > 0);
      assert.equal(e.t, e.onUnits * p.unit);
      assert.equal(e.dur, e.durUnits * p.unit);
      assert.equal(e.t + e.dur, (e.onUnits + e.durUnits) * p.unit, 'end time is exact');
    }
    assert.equal(p.duration, p.durationUnits * p.unit);
  }
});

test('mensuration canon: every voice sings the same melody, scaled by its proportion and transposed', () => {
  for (const s of SEEDS) {
    const p = piece(s);
    const V = p.voices.length;
    assert.ok(V === 3 || V === 4);
    // proportions are distinct small whole numbers, slowest first, and the voices use them
    for (let v = 1; v < V; v++) assert.ok(p.ratios[v] < p.ratios[v - 1] && Number.isInteger(p.ratios[v]) && p.ratios[v] >= 1);
    assert.ok(p.ratios[0] <= 8);
    const lists = byVoice(p);
    const base = lists[0];
    const r0 = p.ratios[0];
    for (let v = 1; v < V; v++) {
      const list = lists[v];
      const rv = p.ratios[v];
      assert.equal(list.length, base.length, `seed ${s}: voice ${v} sings a different number of notes`);
      const transposition = degreeOf(p, list[0].midi) - degreeOf(p, base[0].midi);
      for (let i = 0; i < list.length; i++) {
        // same note of the melody, a fixed number of scale steps away
        assert.equal(degreeOf(p, list[i].midi) - degreeOf(p, base[i].midi), transposition, `seed ${s} v${v} note ${i}: not the same melody`);
        // every duration in exact proportion
        assert.equal(list[i].durUnits * r0, base[i].durUnits * rv, `seed ${s} v${v} note ${i}: duration not in proportion ${r0}:${rv}`);
        // every onset (so every rest too) in exact proportion, measured from the voice's own entry
        assert.equal((list[i].onUnits - list[0].onUnits) * r0, (base[i].onUnits - base[0].onUnits) * rv, `seed ${s} v${v} note ${i}: onset not in proportion`);
      }
      // the transposition is the one declared, and is diatonic (the same scale degrees, shifted)
      assert.equal(transposition, p.shifts[v] - p.shifts[0]);
    }
  }
});

test('form: the slowest voice begins alone, the others enter in turn, and all end on the same instant', () => {
  for (const s of SEEDS) {
    const p = piece(s);
    const lists = byVoice(p);
    const firstOn = lists.map((l) => l[0].onUnits);
    assert.equal(firstOn[0], 0, `seed ${s}: the bass does not start at 0`);
    for (let v = 1; v < lists.length; v++) assert.ok(firstOn[v] > firstOn[v - 1], `seed ${s}: voice ${v} does not enter after voice ${v - 1}`);
    // nobody but the bass sounds before the second entry
    for (const e of p.events) if (e.onUnits < firstOn[1]) assert.equal(e.voice, 0);
    // every voice's last note ends exactly at the end, and that is the piece's length
    const ends = lists.map((l) => l[l.length - 1].onUnits + l[l.length - 1].durUnits);
    for (const e of ends) assert.equal(e, p.durationUnits, `seed ${s}: voices do not end together`);
    for (const e of p.events) assert.ok(e.onUnits >= 0 && e.onUnits + e.durUnits <= p.durationUnits);
    // the last note is each voice's longest, and the last notes all sound together at the end
    for (const l of lists) {
      const last = l[l.length - 1];
      assert.ok(last.last === true && l.slice(0, -1).every((e) => e.durUnits < last.durUnits && !e.last));
    }
    const lastStarts = lists.map((l) => l[l.length - 1].onUnits);
    assert.ok(Math.max(...lastStarts) < p.durationUnits);
    // a finite piece of about three to four minutes
    assert.ok(p.duration > 150 && p.duration < 260, `seed ${s}: ${p.duration.toFixed(1)} s`);
  }
});

test('every note is in the declared mode; the bass begins on the final or its fifth and ends on the final', () => {
  for (const s of SEEDS) {
    const p = piece(s);
    const pcs = new Set(p.mode.steps.map((x) => mod12(p.mode.final + x)));
    for (const e of p.events) assert.ok(pcs.has(mod12(e.midi)), `seed ${s}: MIDI ${e.midi} is outside ${p.mode.finalName} ${p.mode.name}`);
    const bass = byVoice(p)[0];
    assert.ok([0, 7].includes(mod12(bass[0].midi - p.mode.final)), `seed ${s}: bass starts off the final/fifth`);
    assert.equal(mod12(bass[bass.length - 1].midi - p.mode.final), 0, `seed ${s}: bass does not end on the final`);
  }
});

test('ranges: each voice spans at most a ninth, and the bass never reaches any other voice\'s lowest note', () => {
  for (const s of SEEDS) {
    const p = piece(s);
    const lists = byVoice(p);
    const deg = lists.map((l) => l.map((e) => degreeOf(p, e.midi)));
    for (let v = 0; v < lists.length; v++) {
      const span = Math.max(...deg[v]) - Math.min(...deg[v]);
      assert.ok(span <= 8, `seed ${s} v${v}: range ${span + 1} degrees`);
      const midis = lists[v].map((e) => e.midi);
      assert.ok(Math.min(...midis) >= p.voices[v].lowMidi && Math.max(...midis) <= p.voices[v].highMidi);
      assert.ok(Math.min(...midis) >= 28 && Math.max(...midis) <= 96);
    }
    const bassTop = Math.max(...lists[0].map((e) => e.midi));
    for (let v = 1; v < lists.length; v++) {
      const low = Math.min(...lists[v].map((e) => e.midi));
      assert.ok(low > bassTop, `seed ${s}: voice ${v} reaches down into the bass's range`);
    }
  }
});

test('counterpoint: every simultaneity is consonant except a short stepwise note that arrives late', () => {
  let pairs = 0, passing = 0;
  for (const s of SEEDS) {
    const p = piece(s);
    byVoice(p);
    const rMin = p.ratios[p.ratios.length - 1];
    for (const [a, b] of overlaps(p)) {
      pairs++;
      const iv = mod12(Math.abs(a.midi - b.midi));
      const ok = CONSONANT.has(iv) || (iv === 5 && a.voice !== 0 && b.voice !== 0);
      if (ok) continue;
      // a dissonance: the two notes must not start together; the later one must be short, joined to
      // a note before and after it in its own voice, and move by step into and out of the clash
      assert.notEqual(a.onUnits, b.onUnits, `seed ${s}: dissonance (${iv}) struck together at ${a.t.toFixed(2)} s`);
      const n = b;
      const d = (x) => degreeOf(p, x.midi);
      const stepwise = n._joinedPrev && n._joinedNext && Math.abs(d(n) - d(n._prev)) === 1 && Math.abs(d(n._next) - d(n)) === 1;
      assert.ok(stepwise, `seed ${s}: dissonance (${iv}) at ${n.t.toFixed(2)} s, voice ${n.voice}, is not approached and left by step`);
      assert.ok(n.durUnits <= 2 * rMin, `seed ${s}: dissonant note at ${n.t.toFixed(2)} s lasts ${n.durUnits} units > two fast pulses`);
      passing++;
    }
  }
  assert.ok(pairs > 0);
  // the exception is real (it happens) and rare (most of the time everything is consonant)
  assert.ok(passing > 0 && passing / pairs < 0.15, `passing dissonances ${passing} of ${pairs} overlaps`);
});

test('counterpoint: no parallel fifths or octaves between voices that move together', () => {
  for (const s of SEEDS) {
    const p = piece(s);
    byVoice(p);
    const rMin = p.ratios[p.ratios.length - 1];
    for (const [a, b] of overlaps(p)) {
      if (Math.abs(a.onUnits - b.onUnits) > rMin) continue; // "together": onsets within one fast pulse
      if (!a._joinedPrev || !b._joinedPrev) continue; // both arrive from a note, not a rest
      const now = mod12(Math.abs(a.midi - b.midi));
      const before = mod12(Math.abs(a._prev.midi - b._prev.midi));
      if (now !== 0 && now !== 7) continue;
      assert.notEqual(before, now, `seed ${s}: parallel ${now ? 'fifths' : 'octaves'} into ${a.t.toFixed(2)} s (voices ${a.voice}, ${b.voice})`);
    }
  }
});

test('melody: no leap beyond a fifth, no tritone, no note three times running, leaps recovered', () => {
  for (const s of SEEDS) {
    const p = piece(s);
    for (const list of byVoice(p)) {
      for (const e of list) {
        if (!e._prev) continue;
        const step = degreeOf(p, e.midi) - degreeOf(p, e._prev.midi);
        assert.ok(Math.abs(step) <= 4, `seed ${s}: leap of ${Math.abs(step) + 1} degrees at ${e.t.toFixed(2)} s`);
        assert.notEqual(Math.abs(e.midi - e._prev.midi), 6, `seed ${s}: melodic tritone at ${e.t.toFixed(2)} s in voice ${e.voice}`);
        if (e._joinedPrev && e._prev._joinedPrev) {
          const before = degreeOf(p, e._prev.midi) - degreeOf(p, e._prev._prev.midi);
          assert.ok(!(step === 0 && before === 0), `seed ${s}: the same note three times at ${e.t.toFixed(2)} s`);
          assert.ok(!(Math.abs(before) >= 3 && Math.abs(step) >= 2 && Math.sign(step) === Math.sign(before)), `seed ${s}: two leaps the same way at ${e.t.toFixed(2)} s`);
        }
      }
    }
  }
});

test('variety: seeds reach every mode, both voice counts and several proportions', () => {
  const modes = new Set(), counts = new Set(), props = new Set();
  for (const s of SEEDS) {
    const p = piece(s);
    modes.add(p.mode.name);
    counts.add(p.voices.length);
    props.add(p.ratios.join(':'));
  }
  if (COUNT >= 40) {
    assert.equal(modes.size, 6);
    assert.deepEqual([...counts].sort(), [3, 4]);
    assert.ok(props.size >= 6);
  }
});

// ---------------------------------------------------------------- MIDI, read back with our own parser
function parseSmf(bytes) {
  let i = 0;
  const u8 = () => bytes[i++];
  const u16 = () => (u8() << 8) | u8();
  const u32 = () => ((u8() << 24) | (u8() << 16) | (u8() << 8) | u8()) >>> 0;
  const tag = () => String.fromCharCode(u8(), u8(), u8(), u8());
  const vlq = () => {
    let n = 0, b;
    do {
      b = u8();
      n = (n << 7) | (b & 0x7f);
    } while (b & 0x80);
    return n;
  };
  assert.equal(tag(), 'MThd');
  assert.equal(u32(), 6);
  const format = u16(), ntrks = u16(), division = u16();
  const tracks = [];
  for (let t = 0; t < ntrks; t++) {
    assert.equal(tag(), 'MTrk');
    const len = u32();
    const end = i + len;
    let tick = 0, status = 0;
    const evs = [];
    while (i < end) {
      tick += vlq();
      let b = u8();
      if (b === 0xff) {
        const type = u8(), n = vlq();
        evs.push({ tick, meta: type, data: Array.from(bytes.slice(i, i + n)) });
        i += n;
        continue;
      }
      if (b & 0x80) status = b;
      else i--; // running status
      const hi = status & 0xf0, ch = status & 0x0f;
      if (hi === 0xc0 || hi === 0xd0) evs.push({ tick, type: hi, ch, a: u8() });
      else evs.push({ tick, type: hi, ch, a: u8(), b: u8() });
    }
    assert.equal(i, end, 'track length matches its contents');
    tracks.push(evs);
  }
  assert.equal(i, bytes.length, 'no trailing bytes');
  return { format, division, tracks };
}

test('Download MIDI: the file parses back to exactly the performance', () => {
  for (const s of SEEDS.slice(0, 12)) {
    const p = piece(s);
    const smf = parseSmf(midiFile(p));
    assert.equal(smf.format, 0);
    assert.equal(smf.tracks.length, 1);
    const evs = smf.tracks[0];
    const tempo = evs.find((e) => e.meta === 0x51);
    const usPerQuarter = (tempo.data[0] << 16) | (tempo.data[1] << 8) | tempo.data[2];
    const secPerTick = usPerQuarter / 1e6 / smf.division;
    assert.equal(evs[evs.length - 1].meta, 0x2f, 'ends with End of Track');
    // pair note-ons with note-offs per channel and key; nothing may be left hanging
    const open = new Map();
    const notes = [];
    for (const e of evs) {
      if (e.type === 0x90 && e.b > 0) {
        const k = e.ch * 128 + e.a;
        assert.ok(!open.has(k), `seed ${s}: key ${e.a} re-struck on channel ${e.ch} before release`);
        open.set(k, e.tick);
      } else if (e.type === 0x80 || (e.type === 0x90 && e.b === 0)) {
        const k = e.ch * 128 + e.a;
        assert.ok(open.has(k), `seed ${s}: note-off without note-on`);
        notes.push({ ch: e.ch, key: e.a, on: open.get(k), off: e.tick });
        open.delete(k);
      }
    }
    assert.equal(open.size, 0, `seed ${s}: stuck notes in the MIDI file`);
    assert.equal(notes.length, p.events.length);
    // a voice never overlaps itself, so per channel the order of notes is unambiguous
    const tol = secPerTick * 0.51 + 1e-9;
    p.voices.forEach((v, ch) => {
      const got = notes.filter((n) => n.ch === ch).sort((a, b) => a.on - b.on);
      const want = p.events.filter((e) => e.voice === ch).sort((a, b) => a.t - b.t);
      assert.equal(got.length, want.length);
      for (let i = 0; i < got.length; i++) {
        assert.equal(got[i].key, want[i].midi);
        assert.ok(Math.abs(got[i].on * secPerTick - want[i].t) <= tol, `onset off by ${(got[i].on * secPerTick - want[i].t).toFixed(4)} s`);
        assert.ok(Math.abs(got[i].off * secPerTick - (want[i].t + want[i].dur)) <= tol);
      }
    });
    // one channel per voice, each with its own program
    const programs = evs.filter((e) => e.type === 0xc0).map((e) => e.ch);
    assert.deepEqual(programs, p.voices.map((v, i) => i));
  }
});
