// claims.test.mjs — the README's numbers and wording, checked against what the code produces.
//
// Run from the repo root: node --test ideas/36-prolation/claims.test.mjs
//
// Added after the independent review, which found the README's summaries had drifted from the
// shipped code (a duration range, percentiles, a solve rate, a DC bound) and that some wording said
// more than the rules do. Every statistic the README quotes "over 150 seeds" is recomputed here on
// those same seeds (i·7919 + 13 for i < 150, the first 150 of prolation.test.mjs's set) and the
// README must contain it exactly as computed. Like prolation.test.mjs, nothing here calls the
// composer's own rule code: everything is measured from the note events.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { solveRate } from './solve-rates.mjs';

const require = createRequire(import.meta.url);
const P = require('./compose.js');
const README = fs.readFileSync(new URL('./README.md', import.meta.url), 'utf8');
const INDEX = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');

const STAT_SEEDS = Array.from({ length: 150 }, (_, i) => String(i * 7919 + 13));
let cache = null;
const pieces = () => (cache ||= STAT_SEEDS.map((s) => P.compose(s)));

const mod12 = (x) => ((x % 12) + 12) % 12;
const pct = (x) => Math.round(100 * x);
const quantile = (arr, p) => {
  const a = arr.slice().sort((x, y) => x - y);
  const i = (a.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return a[lo] + (a[hi] - a[lo]) * (i - lo);
};
const says = (phrase) => assert.ok(README.includes(phrase), `README should say: "${phrase}"`);
const section = (md, heading) => {
  const i = md.indexOf(heading);
  assert.ok(i >= 0, `README has no "${heading}"`);
  const j = md.indexOf('\n#', i + heading.length);
  return md.slice(i, j < 0 ? undefined : j);
};

/** Each voice's notes in time order, with prev/next links and "joined" (no rest before). */
function voices(p) {
  const out = p.voices.map(() => []);
  for (const e of p.events) out[e.voice].push({ ...e, end: e.onUnits + e.durUnits });
  for (const l of out) {
    l.sort((a, b) => a.onUnits - b.onUnits);
    l.forEach((e, i) => {
      e.prev = l[i - 1] || null;
      e.next = l[i + 1] || null;
    });
    for (const e of l) e.joined = !!e.prev && e.prev.end === e.onUnits;
  }
  return out;
}
const degreeOf = (p, midi) => {
  const rel = midi - p.mode.final;
  return Math.floor(rel / 12) * 7 + p.mode.steps.indexOf(mod12(rel));
};

/**
 * Consecutive perfect intervals in the textbook sense: two voices, each moving from one note to its
 * next (any timing, rests allowed), where both the old pair and the new pair sound together and
 * both form the same perfect interval class (unison/octave or fifth).
 */
function consecutivePerfects(p) {
  const L = voices(p);
  const rMin = p.ratios[p.ratios.length - 1];
  const out = [];
  for (let a = 0; a < L.length; a++) {
    for (let b = a + 1; b < L.length; b++) {
      for (const x of L[a]) {
        if (!x.next) continue;
        for (const y of L[b]) {
          if (y.onUnits >= x.end) break;
          if (!y.next || y.end <= x.onUnits) continue;
          const x2 = x.next, y2 = y.next;
          if (!(x2.onUnits < y2.end && y2.onUnits < x2.end)) continue;
          if (x2.midi === x.midi || y2.midi === y.midi) continue;
          const before = mod12(Math.abs(x.midi - y.midi)), after = mod12(Math.abs(x2.midi - y2.midi));
          if (before !== after || (after !== 0 && after !== 7)) continue;
          const joined = x2.joined && y2.joined;
          const gap = Math.abs(x2.onUnits - y2.onUnits) / rMin; // in fast pulses
          out.push({ joined, gap, sameInstant: gap === 0, similar: Math.sign(x2.midi - x.midi) === Math.sign(y2.midi - y.midi) });
        }
      }
    }
  }
  return out;
}

test('wording the independent review corrected stays corrected', () => {
  const tagline = README.match(/^> (.+)$/m)[1];
  assert.ok(!/never clash/.test(tagline), 'the tagline must not say the voices never clash: passing dissonances are allowed');
  assert.match(tagline, /clash only in passing/);
  const description = INDEX.match(/<meta name="description" content="([^"]+)"/)[1];
  assert.ok(!/never clash/.test(description), 'the page description must not say the voices never clash');
  // rule 3 is narrower than "no parallel fifths or octaves": every summary of it must say so
  const help = INDEX.slice(INDEX.indexOf('<section id="help"'), INDEX.indexOf('</section>'));
  assert.match(help, /parallel fifths or octaves/);
  assert.match(help, /within a fast beat/);
  assert.match(help, /after a rest/);
  const oneSentence = README.match(/\*\*The rule in one sentence:\*\*[^\n]+/)[0];
  assert.ok(!/with no parallel fifths or octaves\.$/.test(oneSentence), 'the one-sentence rule must qualify "no parallel fifths or octaves"');
  assert.match(oneSentence, /within one fast pulse/);
  // rule 4's leap rule, like its repeated-note rule, applies only to notes joined with no rest
  const rule4 = README.match(/^4\. \*\*The melody\.\*\*[^\n]+/m)[0];
  assert.match(rule4, /apply only to three notes in a row with no rest between them/);
  // Pärt and Nancarrow did not solve the consonance puzzle
  const why = section(README, '## Why I made it');
  assert.ok(!/In every case one person solves the puzzle/.test(why));
  assert.match(why, /Pärt and Nancarrow kept the speeds and dropped the consonance/);
});

test('parallels the rules let through: as common as the README says, and none of the kind rule 3 forbids', () => {
  const per = [];
  let withAny = 0, staggeredSeeds = 0, sameInstantSeeds = 0, similar = 0, total = 0;
  const gaps = [];
  for (const p of pieces()) {
    const c = consecutivePerfects(p);
    // rule 3 as the README states it: both joined, onsets within one fast pulse
    assert.equal(c.filter((x) => x.joined && x.gap <= 1).length, 0, `seed ${p.seed}: a parallel rule 3 forbids`);
    per.push(c.length);
    total += c.length;
    similar += c.filter((x) => x.similar).length;
    if (c.length) withAny++;
    if (c.some((x) => x.joined)) staggeredSeeds++;
    if (c.some((x) => !x.joined && x.sameInstant)) sameInstantSeeds++;
    for (const x of c) if (x.joined) gaps.push(x.gap);
  }
  says(`${withAny} of 150 seeds contain at least one`);
  says(`a median of ${quantile(per, 0.5)} per piece and up to ${Math.max(...per)}`);
  says(`In ${staggeredSeeds} of 150 seeds`);
  says(`${Math.min(...gaps).toFixed(2)} to ${Math.max(...gaps).toFixed(0)} fast pulses (median ${quantile(gaps, 0.5).toFixed(1)})`);
  says(`in ${sameInstantSeeds} of 150 seeds`);
  says(`${similar} of the ${total}`);
});

test('the melody rules that apply only without a rest really do meet rests', () => {
  let seeds = 0;
  for (const p of pieces()) {
    const bass = voices(p)[0];
    const n = bass.filter((e) => {
      if (!e.prev || !e.prev.prev) return false;
      const s1 = degreeOf(p, e.prev.midi) - degreeOf(p, e.prev.prev.midi);
      const s2 = degreeOf(p, e.midi) - degreeOf(p, e.prev.midi);
      return Math.abs(s1) >= 3 && Math.abs(s2) >= 2 && Math.sign(s1) === Math.sign(s2);
    });
    for (const e of n) assert.ok(!(e.joined && e.prev.joined), `seed ${p.seed}: two leaps the same way with no rest`);
    if (n.length) seeds++;
  }
  says(`${seeds} of 150 seeds have a leap followed by a leap the same way across a rest`);
});

test('length: the README range is the measured range', () => {
  const d = pieces().map((p) => p.duration);
  says(`${Math.floor(Math.min(...d))} to ${Math.ceil(Math.max(...d))} s over 150 seeds`);
});

test('harmony: chord-tone share, vertical intervals and melodic steps match the README', () => {
  const share = [];
  const count = { octave: 0, third: 0, sixth: 0, fifth: 0, fourth: 0, dissonant: 0 };
  let pairs = 0;
  const steps = { repeat: 0, step: 0, third: 0, leap: 0 };
  let moves = 0;
  for (const p of pieces()) {
    const L = voices(p);
    const written = L[0].map((e) => degreeOf(p, e.midi)); // the bass sings the written line an octave down
    share.push(written.filter((d) => [0, 2, 4].includes(((d % 7) + 7) % 7)).length / written.length);
    for (let i = 1; i < written.length; i++) {
      const s = Math.abs(written[i] - written[i - 1]);
      moves++;
      if (s === 0) steps.repeat++;
      else if (s === 1) steps.step++;
      else if (s === 2) steps.third++;
      else steps.leap++;
    }
    const evs = p.events.slice().sort((a, b) => a.onUnits - b.onUnits);
    for (let i = 0; i < evs.length; i++) {
      for (let j = i + 1; j < evs.length && evs[j].onUnits < evs[i].onUnits + evs[i].durUnits; j++) {
        const x = evs[i], y = evs[j];
        if (x.voice === y.voice) continue;
        const iv = mod12(Math.abs(x.midi - y.midi));
        pairs++;
        if (iv === 0) count.octave++;
        else if (iv === 3 || iv === 4) count.third++;
        else if (iv === 8 || iv === 9) count.sixth++;
        else if (iv === 7) count.fifth++;
        else if (iv === 5 && x.voice !== 0 && y.voice !== 0) count.fourth++;
        else count.dissonant++;
      }
    }
  }
  says(`A median ${pct(quantile(share, 0.5))}% of melody notes`);
  says(`roughly ${pct(quantile(share, 0.1))}% to ${pct(quantile(share, 0.9))}% from the 10th to the 90th percentile`);
  const f = (k) => pct(count[k] / pairs);
  says(`${f('octave')}% unisons and octaves, ${f('third')}% thirds, ${f('sixth')}% sixths, ${f('fifth')}% fifths and ${f('fourth')}% fourths, and ${((100 * count.dissonant) / pairs).toFixed(1)}% are the permitted passing dissonances`);
  const g = (k) => pct(steps[k] / moves);
  says(`by a third ${g('third')}% of the time, by step ${g('step')}%, repeats a note ${g('repeat')}% of the time, and leaps a fourth or fifth ${g('leap')}%`);
});

test("texture, opening and arch: rests, density, the bass solo and the melody's high point", () => {
  const rests = [], together = [], solo = [], soloShare = [], peak = [];
  for (const p of pieces()) {
    rests.push(p.values.filter((x) => x < 0).reduce((a, b) => a - b, 0) / p.pulses);
    // from the last entry to the end: the share of time in which every voice is sounding
    const V = p.voices.length, from = p.voices[V - 1].startUnits, to = p.durationUnits;
    const cuts = [...new Set([from, to, ...p.events.flatMap((e) => [e.onUnits, e.onUnits + e.durUnits])])].filter((x) => x >= from && x <= to).sort((a, b) => a - b);
    let all = 0;
    for (let i = 0; i + 1 < cuts.length; i++) {
      const mid = (cuts[i] + cuts[i + 1]) / 2;
      const on = new Set(p.events.filter((e) => e.onUnits <= mid && mid < e.onUnits + e.durUnits).map((e) => e.voice));
      if (on.size === V) all += cuts[i + 1] - cuts[i];
    }
    together.push(all / (to - from));
    const second = Math.min(...p.events.filter((e) => e.voice === 1).map((e) => e.t));
    solo.push(second);
    soloShare.push(second / p.duration);
    // where the written line first reaches its highest note, counted in notes
    const bass = voices(p)[0].map((e) => e.midi);
    peak.push(bass.indexOf(Math.max(...bass)) / bass.length);
  }
  says(`Rests make up ${pct(quantile(rests, 0.5))}% of the line`);
  says(`only ${pct(quantile(together, 0.5))}% of the time after the last voice enters (median; ${pct(quantile(together, 0.1))}% to ${pct(quantile(together, 0.9))}% from the 10th to the 90th percentile of seeds)`);
  says(`The bass sings alone for ${Math.floor(Math.min(...solo))} to ${Math.ceil(Math.max(...solo))} s, between ${pct(Math.min(...soloShare))}% and ${pct(Math.max(...soloShare))}% of the piece`);
  says(`first reaches its highest note a median ${pct(quantile(peak, 0.5))}% of the way through (counted in notes)`);
});

test('what the self-critique first missed: hollow final chord, unheard mode, periodic rhythm, exposed fourths', () => {
  // the note that tells each mode apart from its nearest neighbour
  const CHARACTERISTIC = { Dorian: 9, Phrygian: 1, Lydian: 6, Mixolydian: 10, Aeolian: 8, Ionian: 11 };
  let noFifth = 0, doubledThird = 0, unheard = 0, fourths = 0, fourthsBassSilent = 0;
  const share = [], repeats = [];
  for (const p of pieces()) {
    const L = voices(p);
    const last = L.map((l) => mod12(l[l.length - 1].midi - p.mode.final));
    assert.equal(last[0], 0);
    if (!last.includes(7)) noFifth++;
    if (last.filter((x) => x === 3 || x === 4).length >= 2) doubledThird++;
    let time = 0, all = 0;
    for (const e of p.events) {
      all += e.durUnits;
      if (mod12(e.midi - p.mode.final) === CHARACTERISTIC[p.mode.name]) time += e.durUnits;
    }
    if (time === 0) unheard++;
    share.push(time / all);
    repeats.push((p.values.length - P.TAIL.length) / p.talea.length);
    // fourths between upper voices, and how much of their time the bass is silent
    for (let a = 1; a < L.length; a++) {
      for (let b = a + 1; b < L.length; b++) {
        for (const x of L[a]) {
          for (const y of L[b]) {
            const s = Math.max(x.onUnits, y.onUnits), e = Math.min(x.end, y.end);
            if (e <= s || mod12(Math.abs(x.midi - y.midi)) !== 5) continue;
            let bassOn = 0;
            for (const z of L[0]) bassOn += Math.max(0, Math.min(e, z.end) - Math.max(s, z.onUnits));
            fourths += e - s;
            fourthsBassSilent += e - s - bassOn;
          }
        }
      }
    }
  }
  says(`In ${noFifth} of 150 seeds (${pct(noFifth / 150)}%) the closing chord has no fifth, and in ${doubledThird} (${pct(doubledThird / 150)}%) its third is doubled`);
  says(`In ${unheard} of 150 seeds the piece never sounds the note`);
  says(`a median ${pct(quantile(share, 0.5))}% of the sounding time`);
  says(`between ${Math.min(...repeats)} and ${Math.max(...repeats)} times (median ${Math.round(quantile(repeats, 0.5))})`);
  says(`${pct(fourthsBassSilent / fourths)}% of the time that two upper voices sound a fourth, the bass is silent`);
});

test('the solve rate quoted for the kept four-voice set is what the shipped search gets', () => {
  // the cheapest cell of solve-rates.mjs's table; the rest of the table takes minutes
  const ok = solveRate([-7, 2, 7, 9], [6, 5, 4, 3], 64);
  says(`${ok} of 64 rhythms at 6:5:4:3`);
});

// ---------------------------------------------------------------- synth.js, run against a recording mock
function loadSynth() {
  const sandbox = { window: {}, setTimeout: () => 0 };
  vm.runInNewContext(fs.readFileSync(new URL('./synth.js', import.meta.url), 'utf8'), sandbox);
  return sandbox.window.Prolation;
}
function mockContext() {
  const oscillators = [], gains = [];
  const param = () => ({
    value: 0,
    events: [],
    setValueAtTime(x, t) { this.events.push([x, t]); return this; },
    linearRampToValueAtTime(x, t) { this.events.push([x, t]); return this; },
    setTargetAtTime(x, t) { this.events.push([x, t]); return this; },
    cancelScheduledValues() { return this; },
  });
  const node = (params) => {
    const n = { out: [], connect(d) { this.out.push(d); return d; }, disconnect() {}, start() {}, stop() {}, addEventListener() {} };
    for (const k of params) n[k] = param();
    return n;
  };
  const ctx = {
    sampleRate: 8000,
    currentTime: 0,
    destination: node([]),
    createGain: () => { const g = node(['gain']); gains.push(g); return g; },
    createOscillator: () => { const o = node(['frequency', 'detune']); oscillators.push(o); return o; },
    createBiquadFilter: () => node(['frequency', 'Q', 'gain']),
    createConvolver: () => node([]),
    createDynamicsCompressor: () => node(['threshold', 'knee', 'ratio', 'attack', 'release']),
    createWaveShaper: () => node([]),
    createStereoPanner: () => node(['pan']),
    createBufferSource: () => node(['playbackRate']),
    createBuffer: (channels, length, sampleRate) => {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { numberOfChannels: channels, length, sampleRate, getChannelData: (c) => data[c] };
    },
  };
  return { ctx, oscillators, gains };
}

test('the README says how far the synthesis pulls the meantone pitches', () => {
  const S = loadSynth();
  const { ctx, oscillators, gains } = mockContext();
  const perf = S.createEngine(ctx).createPerformance({ voices: [{ timbre: 'organ' }, { timbre: 'flute' }] });
  perf.play({ voice: 0, freq: 110, dur: 1, last: false }, 0);
  const fundamentals = oscillators.filter((o) => o.frequency.value === 110).map((o) => o.detune.value).sort((a, b) => a - b);
  assert.equal(fundamentals.length, 2);
  const fromOsc = oscillators.length, fromGain = gains.length;
  perf.play({ voice: 1, freq: 220, dur: 1, last: false }, 0);
  const detunes = new Set(oscillators.slice(fromOsc).map((o) => o.detune));
  const lfo = gains.slice(fromGain).filter((g) => g.out.some((d) => detunes.has(d)));
  assert.equal(lfo.length, 1, 'one vibrato depth control');
  const depth = Math.max(...lfo[0].gain.events.map((e) => e[0]));
  const signed = (x) => (x < 0 ? `−${-x}` : `+${x}`);
  says(`detuned ${signed(fundamentals[0])} and ${signed(fundamentals[1])} cents`);
  says(`±${depth}-cent vibrato`);
});

test('analyse() reports a small DC offset as it is, and the README bound covers its table', () => {
  const S = loadSynth();
  const n = 48000;
  const left = new Float32Array(n).fill(-1.78e-5), right = new Float32Array(n).fill(-1.19e-5);
  const stats = S.analyse({ sampleRate: 48000, numberOfChannels: 2, length: n, getChannelData: (c) => (c ? right : left) }, 0.5);
  // the old rounding to five decimal places reported this as -1e-5
  assert.ok(Math.abs(stats.dcOffset - -1.485e-5) < 1e-8, `dcOffset ${stats.dcOffset}`);
  assert.ok(Math.abs(stats.dcWorstChannel - -1.78e-5) < 1e-8, `dcWorstChannel ${stats.dcWorstChannel}`);
  // every DC value in the README's audio table lies under the bound the README states for it
  const bound = Number(README.match(/the DC offset of every channel is below ([0-9.e-]+) in magnitude/)[1]);
  const rows = README.split('\n').filter((l) => /^\| \d+ \| \d voices/.test(l));
  assert.equal(rows.length, 8);
  for (const row of rows) {
    const cells = row.split('|').map((c) => c.trim());
    const dc = Number(cells[9].replace('−', '-'));
    assert.ok(Number.isFinite(dc) && Math.abs(dc) < bound, `seed ${cells[1]}: DC ${cells[9]} is not under ${bound}`);
  }
});
