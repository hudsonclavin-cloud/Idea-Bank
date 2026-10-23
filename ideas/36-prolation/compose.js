// compose.js — Prolation: a mensuration canon that composes itself.
//
// Pure: a seed goes in, a list of note events comes out. No DOM, no audio, no Math.random.
// Loads as a classic <script> (window.Prolation) and as a CommonJS module (require), so the page
// and the Node tests share exactly this code.
//
// The piece: ONE melody, sung by three or four voices at once, each at its own speed. The speeds
// are small whole-number proportions (4:3:2, 6:5:4, ...). The slowest voice starts first and
// alone; every voice ends on the same instant. The melody is found by search so that every
// simultaneity the proportions produce is a consonance (short stepwise notes that arrive late
// excepted) and no pair of voices moves together (onsets within one fast pulse, both straight from
// a previous note) into parallel fifths or octaves. Staggered parallels and parallels after a rest
// are not checked; README.md says how often they occur. README.md states the exact rules;
// prolation.test.mjs checks them on the realised events with its own code.
//
// From a shell: node compose.js <seed>   prints that performance's events as JSON.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Prolation = Object.assign(root.Prolation || {}, factory());
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- randomness
  function cyrb128(str) {
    let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
    for (let i = 0; i < str.length; i++) {
      const k = str.charCodeAt(i);
      h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
      h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
      h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
      h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
    }
    h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
    h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
    h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
    h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
    return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
  }

  function sfc32(a, b, c, d) {
    return function () {
      a |= 0; b |= 0; c |= 0; d |= 0;
      const t = (((a + b) | 0) + d) | 0;
      d = (d + 1) | 0;
      a = b ^ (b >>> 9);
      b = (c + (c << 3)) | 0;
      c = (c << 21) | (c >>> 11);
      c = (c + t) | 0;
      return (t >>> 0) / 4294967296;
    };
  }

  function makeRng(seed) {
    const s = cyrb128(String(seed));
    const r = sfc32(s[0], s[1], s[2], s[3]);
    for (let i = 0; i < 12; i++) r();
    return r;
  }

  const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
  function pickWeighted(rng, items) {
    let total = 0;
    for (const it of items) total += it[1];
    let x = rng() * total;
    for (const it of items) {
      x -= it[1];
      if (x <= 0) return it[0];
    }
    return items[items.length - 1][0];
  }

  // ---------------------------------------------------------------- material
  // Each mode is a set of semitone offsets from its final. The final sits in the tenor register
  // because the bass voice sings an octave below it and the top voice up to a tenth above.
  const MODES = [
    { name: 'Dorian', steps: [0, 2, 3, 5, 7, 9, 10], final: 57 },
    { name: 'Aeolian', steps: [0, 2, 3, 5, 7, 8, 10], final: 55 },
    { name: 'Phrygian', steps: [0, 1, 3, 5, 7, 8, 10], final: 57 },
    { name: 'Mixolydian', steps: [0, 2, 4, 5, 7, 9, 10], final: 55 },
    { name: 'Lydian', steps: [0, 2, 4, 6, 7, 9, 11], final: 53 },
    { name: 'Ionian', steps: [0, 2, 4, 5, 7, 9, 11], final: 55 },
  ];
  const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

  // Proportions, slowest first. A voice with proportion r sings every value of the melody r times
  // as long as the fastest voice would at proportion 1.
  const RATIO_SETS = {
    3: [[4, 3, 2], [5, 4, 3], [6, 5, 4], [3, 2, 1], [6, 4, 3]],
    4: [[6, 5, 4, 3], [5, 4, 3, 2], [8, 6, 5, 4]],
  };
  // Diatonic transposition per voice (scale steps), slowest/lowest first. The bass is always seven
  // steps (an octave) below the written melody and every other voice is at least two steps above
  // it, so with the melody's range of [-1, 7] the bass is never above another voice.
  // Dropped: [-7, 4, 7] and every four-voice set with a voice a twelfth above the bass. With them the
  // search finds a legal melody for under a third of rhythms (solve-rates.mjs: [-7, 4, 7] 29%, the
  // four-voice ones 0-13%, against 48% for [-7, 2, 7, 9]). [-7, 4, 9], kept, is close behind at 36%.
  const SHIFT_SETS = {
    3: [[-7, 2, 7], [-7, 2, 4], [-7, 2, 9], [-7, 4, 9]],
    4: [[-7, 2, 7, 9]],
  };
  // If a seed's first choice keeps failing, it falls back to these, which succeed most readily.
  const SAFE_SHIFTS = { 3: [-7, 2, 9], 4: [-7, 2, 7, 9] };
  const SAFE_RATIOS = [6, 4, 3];
  const TIMBRES = { 3: ['organ', 'flute', 'pluck'], 4: ['organ', 'flute', 'bell', 'pluck'] };
  const MELODY_LO = -1; // a step below the final ...
  const MELODY_HI = 7; // ... up to the octave above it

  // Pitch-class intervals (semitones mod 12) that count as consonant between any two voices.
  // The fourth (5) is consonant only when neither note belongs to the bass voice.
  const CONSONANT = new Set([0, 3, 4, 7, 8, 9]);
  const PERFECT = new Set([0, 7]);

  function degreeToMidi(mode, final, degree) {
    const oct = Math.floor(degree / 7);
    const step = ((degree % 7) + 7) % 7;
    return final + 12 * oct + mode.steps[step];
  }

  // Quarter-comma meantone, centred on the final: every diatonic pitch class is reached from the
  // final by a chain of fifths of ratio 5^(1/4). The seven notes of any one mode form an unbroken
  // chain, so there is no wolf inside the mode. Pure major thirds, slightly narrow fifths.
  const MEANTONE_FIFTH = Math.pow(5, 0.25);
  function midiToFreq(midi, final) {
    const semis = midi - final;
    const pc = ((semis % 12) + 12) % 12;
    let n = (7 * pc) % 12;
    if (n > 6) n -= 12; // position on the chain of fifths, -5 .. +6
    let ratio = Math.pow(MEANTONE_FIFTH, n);
    while (ratio >= 2) ratio /= 2;
    while (ratio < 1) ratio *= 2;
    const base = 440 * Math.pow(2, (final - 69) / 12);
    return base * ratio * Math.pow(2, Math.floor(semis / 12));
  }

  // ---------------------------------------------------------------- rhythm
  // The melody's rhythm is a talea: one short pattern of cells, repeated for the whole piece, then
  // a long final note. Values are in pulses (think eighth notes); a negative value is a rest. The
  // rests are what make a canon at several speeds possible: a line that breathes overlaps itself
  // far less than one that never stops.
  const CELLS = [
    [[2, 2], 0.22],
    [[4], 0.10],
    [[2, 1, 1], 0.12],
    [[1, 1, 2], 0.12],
    [[3, 1], 0.07],
    [[2, -2], 0.16],
    [[1, 1, -2], 0.07],
    [[-2, 2], 0.07],
    [[-4], 0.07],
  ];
  const FINAL_DUR = 8;
  // After the last talea the line dissolves: one long note, a rest, and the final. As the voices
  // converge in time they converge in melody too, so the convergence zone must be sparse.
  const TAIL = [4, -4, FINAL_DUR];

  // Four voices overlap more than three, so their talea breathes more.
  const SPARSE_CELLS = [
    [[2, 2], 0.14],
    [[4], 0.08],
    [[2, 1, 1], 0.08],
    [[1, 1, 2], 0.08],
    [[3, 1], 0.05],
    [[2, -2], 0.20],
    [[1, 1, -2], 0.09],
    [[-2, 2], 0.10],
    [[-4], 0.10],
    [[4, -4], 0.08],
  ];

  function makeTalea(rng, sparse) {
    const cells = pick(rng, [4, 4, 5, 6]);
    const out = [];
    for (let c = 0; c < cells; c++) {
      let cell;
      if (c === 0) cell = pick(rng, [[4], [2, 2], [3, 1], [2, 2]]);
      else if (c === cells - 1) cell = pick(rng, [[4, -4], [2, 2, -4], [2, -2, -4], [4, -2, -2], [2, 2, -2, -2]]);
      else cell = pickWeighted(rng, sparse ? SPARSE_CELLS : CELLS);
      out.push(...cell);
    }
    return out;
  }

  // ---------------------------------------------------------------- the search
  /**
   * The model of one rhythm under one set of proportions: when every voice sings every note, which
   * notes overlap which, and which notes are short enough to carry a passing dissonance. Pure
   * bookkeeping; the rules themselves live in pairCost and melodyCost below.
   */
  function buildModel(values, spec) {
    const { ratios, shifts, mode, final, lo, hi } = spec;
    const V = ratios.length;
    const N = values.length;
    const durs = values.map((x) => Math.abs(x));
    const rest = values.map((x) => x < 0);
    const cum = new Array(N + 1);
    cum[0] = 0;
    for (let k = 0; k < N; k++) cum[k + 1] = cum[k] + durs[k];
    const L = cum[N];
    const rMax = ratios[0];
    const rMin = ratios[V - 1];
    const T = L * rMax; // every voice ends here (in pulse units)
    const W = rMin; // "both voices moved together": onsets within one pulse of the fastest voice
    const PASS_MAX = 2 * rMin; // a passing dissonance may last at most two pulses of the fastest voice
    const on = (v, k) => T - ratios[v] * (L - cum[k]);
    const end = (v, k) => T - ratios[v] * (L - cum[k + 1]);

    const midiCache = new Map();
    const midiOf = (deg) => {
      let m = midiCache.get(deg);
      if (m === undefined) {
        m = degreeToMidi(mode, final, deg);
        midiCache.set(deg, m);
      }
      return m;
    };
    // Interval tables over the melody's degree range: consTab = consonant?, perfTab = perfect class
    // (0 for unison/octave, 7 for fifth, -1 otherwise), indexed by voice pair and both degrees.
    const SPAN = hi - lo + 1;
    const consTab = new Int8Array(V * V * SPAN * SPAN);
    const perfTab = new Int8Array(V * V * SPAN * SPAN);
    const tabIndex = (a, da, b, db) => ((a * V + b) * SPAN + (da - lo)) * SPAN + (db - lo);
    for (let a = 0; a < V; a++) {
      for (let b = 0; b < V; b++) {
        for (let da = lo; da <= hi; da++) {
          for (let db = lo; db <= hi; db++) {
            const diff = Math.abs(midiOf(da + shifts[a]) - midiOf(db + shifts[b])) % 12;
            const i = tabIndex(a, da, b, db);
            consTab[i] = CONSONANT.has(diff) || (diff === 5 && a !== 0 && b !== 0) ? 1 : 0;
            perfTab[i] = PERFECT.has(diff) ? diff : -1;
          }
        }
      }
    }
    const consonantPair = (a, da, b, db) => consTab[tabIndex(a, da, b, db)] === 1;
    const perfectClass = (a, da, b, db) => perfTab[tabIndex(a, da, b, db)];

    // canPass[v][k]: note k, sung by voice v, is short enough to carry a passing dissonance, and has
    // sounding neighbours on both sides.
    const canPass = [];
    for (let v = 0; v < V; v++) {
      canPass[v] = new Array(N);
      for (let k = 0; k < N; k++) {
        canPass[v][k] = !rest[k] && k > 0 && k < N - 1 && !rest[k - 1] && !rest[k + 1] && durs[k] * ratios[v] <= PASS_MAX;
      }
    }

    // Every overlapping pair of sounding notes, once: {a, k, b, j, ta, tb} meaning voice a's note k
    // overlaps voice b's note j in time, with onsets ta and tb. byIndex[i] lists the pairs touching i.
    const pairs = [];
    const byIndex = [];
    for (let i = 0; i < N; i++) byIndex[i] = [];
    for (let a = 0; a < V; a++) {
      for (let b = a + 1; b < V; b++) {
        let j0 = 0;
        for (let k = 0; k < N; k++) {
          if (rest[k]) continue;
          const s = on(a, k), e = end(a, k);
          while (j0 < N && end(b, j0) <= s) j0++;
          for (let j = j0; j < N && on(b, j) < e; j++) {
            if (rest[j]) continue;
            const p = { a, k, b, j, ta: s, tb: on(b, j) };
            pairs.push(p);
            byIndex[k].push(p);
            if (j !== k) byIndex[j].push(p);
          }
        }
      }
    }

    // prev[k]: the previous sounding index (or -1); adj[k]: it is k-1 (no rest between)
    const prev = new Array(N).fill(-1);
    const next = new Array(N).fill(-1);
    for (let k = 0, last = -1; k < N; k++) {
      if (rest[k]) continue;
      prev[k] = last;
      if (last >= 0) next[last] = k;
      last = k;
    }

    // A melodic move from degree x to degree y is a tritone if it is one in ANY voice: the voices
    // sing the melody at different diatonic transpositions, so a perfect fourth in one can be an
    // augmented fourth in another.
    const triTab = new Int8Array(SPAN * SPAN);
    for (let x = lo; x <= hi; x++) {
      for (let y = lo; y <= hi; y++) {
        let t = 0;
        for (let v = 0; v < V; v++) if (Math.abs(midiOf(x + shifts[v]) - midiOf(y + shifts[v])) === 6) t = 1;
        triTab[(x - lo) * SPAN + (y - lo)] = t;
      }
    }
    const tritone = (x, y) => triTab[(x - lo) * SPAN + (y - lo)] === 1;

    return { V, N, durs, rest, cum, L, T, W, lo, hi, ratios, shifts, on, end, midiOf, consonantPair, perfectClass, tritone, canPass, pairs, byIndex, prev, next };
  }

  // Hard rule cost (0, 1 or 2) of one overlapping pair under melody `mel`.
  function pairCost(M, p, mel) {
    const x = mel[p.k], y = mel[p.j];
    let cost = 0;
    if (!M.consonantPair(p.a, x, p.b, y)) {
      if (p.ta === p.tb) cost++; // two voices may not start a dissonance together
      else {
        // the newer note must be a passing tone: short enough in its voice, stepped into and out of
        const nv = p.ta > p.tb ? p.a : p.b;
        const ni = p.ta > p.tb ? p.k : p.j;
        const ok = M.canPass[nv][ni] && Math.abs(mel[ni] - mel[ni - 1]) === 1 && Math.abs(mel[ni + 1] - mel[ni]) === 1;
        if (!ok) cost++;
      }
    }
    if (Math.abs(p.ta - p.tb) <= M.W && p.k >= 1 && p.j >= 1 && !M.rest[p.k - 1] && !M.rest[p.j - 1]) {
      const after = M.perfectClass(p.a, x, p.b, y);
      if (after >= 0 && M.perfectClass(p.a, mel[p.k - 1], p.b, mel[p.j - 1]) === after) cost++;
    }
    return cost;
  }

  // Melodic cost of note k: [hard, soft]. Hard rules are stated in the README; soft ones are taste.
  function melodyCost(M, k, mel) {
    const { N, durs, prev, lo, hi } = M;
    const d = mel[k];
    let hard = 0, soft = 0;
    if (k === 0 && d !== 0 && d !== 4) hard++;
    if (k === N - 1 && d !== 0) hard++;
    const p1 = prev[k];
    if (p1 >= 0) {
      const step = d - mel[p1];
      const a = Math.abs(step);
      if (a > 4) hard++; // no leap beyond a fifth
      if (M.tritone(d, mel[p1])) hard++; // no melodic tritone
      const adjacent = p1 === k - 1;
      const p2 = prev[p1];
      if (adjacent && p2 >= 0 && p2 === p1 - 1) {
        const lastLeap = mel[p1] - mel[p2];
        if (a === 0 && lastLeap === 0) hard++; // at most one immediate repetition
        if (Math.abs(lastLeap) >= 3 && a >= 2 && Math.sign(step) === Math.sign(lastLeap)) hard++; // after a leap, no further leap the same way
      }
      soft += a === 0 ? 0.16 : a === 1 ? 0 : a === 2 ? 0.1 : 0.3;
      if (durs[k] === 1 && a >= 2) soft += 0.15; // short notes like to move by step
      if (durs[k] === 1 && a === 0) soft += 0.1;
      // runs: five or more steps in one direction get dull
      if (adjacent && a === 1) {
        let run = 1, i = p1;
        while (run < 5 && i >= 1 && prev[i] === i - 1 && mel[i] - mel[i - 1] === step) { run++; i--; }
        if (run >= 5) soft += 0.3;
      }
    }
    // a slow arch: the line is nudged upward until about two thirds through, then back down
    const x = k / N;
    const arch = x < 0.65 ? Math.sin((Math.PI / 2) * (x / 0.65)) : Math.cos((Math.PI / 2) * ((x - 0.65) / 0.35));
    const target = lo + (hi - lo) * (0.3 + 0.5 * arch);
    soft += 0.03 * Math.abs(d - target);
    return [hard, soft];
  }

  // Every hard-rule violation of a complete melody, for self-checking.
  function violations(M, mel) {
    const out = [];
    for (const p of M.pairs) if (pairCost(M, p, mel) > 0) out.push({ kind: 'pair', ...p });
    for (let k = 0; k < M.N; k++) if (!M.rest[k] && melodyCost(M, k, mel)[0] > 0) out.push({ kind: 'melody', k });
    return out;
  }

  const HARD = 4; // one broken rule costs this much soft taste

  /**
   * Finds a melody for a fixed rhythm by seeded simulated annealing over the whole line, then
   * reports it only if no hard rule is broken. Returns {mel, moves, hard}.
   */
  function searchMelody(rng, values, spec, budgetMoves) {
    const M = buildModel(values, spec);
    const { N, rest, lo, hi, byIndex, next } = M;
    const sounding = [];
    for (let k = 0; k < N; k++) if (!rest[k]) sounding.push(k);

    // a stepwise random walk to start from, pinned at the ends
    const mel = new Array(N).fill(null);
    let cur = 0;
    for (let i = 0; i < sounding.length; i++) {
      const k = sounding[i];
      if (i > 0) {
        const step = Math.floor(rng() * 5) - 2;
        cur = Math.max(lo, Math.min(hi, cur + step));
      }
      mel[k] = cur;
    }
    mel[sounding[0]] = rng() < 0.65 ? 0 : 4;
    mel[sounding[sounding.length - 1]] = 0;

    // Everything whose cost depends on mel[k]: pairs touching k-1, k, k+1 (passing status) and the
    // melodic terms of the next five sounding notes (they look back at k).
    const stamp = new Int32Array(M.pairs.length);
    M.pairs.forEach((p, i) => (p.id = i));
    let epoch = 0;
    const scratch = [];
    function affected(k) {
      epoch++;
      scratch.length = 0;
      for (let i = Math.max(0, k - 1); i <= Math.min(N - 1, k + 1); i++) {
        const list = byIndex[i];
        for (let q = 0; q < list.length; q++) {
          const p = list[q];
          if (stamp[p.id] !== epoch) { stamp[p.id] = epoch; scratch.push(p); }
        }
      }
      return scratch;
    }
    const local = [0, 0];
    function localCost(k) {
      let hard = 0, soft = 0;
      const ps = affected(k);
      for (let i = 0; i < ps.length; i++) hard += pairCost(M, ps[i], mel);
      for (let i = k, n = 0; i >= 0 && n < 6; i = next[i], n++) {
        const c = melodyCost(M, i, mel);
        hard += c[0];
        soft += c[1];
      }
      local[0] = hard;
      local[1] = soft;
      return local;
    }
    function totalHard() {
      let h = 0;
      for (const p of M.pairs) h += pairCost(M, p, mel);
      for (const k of sounding) h += melodyCost(M, k, mel)[0];
      return h;
    }

    function totalSoft() {
      let x = 0;
      for (let i = 0; i < sounding.length; i++) x += melodyCost(M, sounding[i], mel)[1];
      return x;
    }

    let hard = totalHard();
    let soft = totalSoft();
    let best = null;
    let bestSoft = Infinity;
    let it = 0;
    const tryMove = (k, d, T) => {
      const old = mel[k];
      localCost(k);
      const hB = local[0], sB = local[1];
      mel[k] = d;
      localCost(k);
      const hA = local[0], sA = local[1];
      const dE = HARD * (hA - hB) + (sA - sB);
      if (dE <= 0 || (T > 0 && rng() < Math.exp(-dE / T))) {
        hard += hA - hB;
        soft += sA - sB;
        return true;
      }
      mel[k] = old;
      return false;
    };
    const consider = () => {
      if (hard === 0 && soft < bestSoft - 1e-9) {
        bestSoft = soft;
        best = mel.slice();
      }
    };
    // Notes currently involved in a broken rule (with multiplicity), refreshed every few moves so
    // proposals can concentrate where the trouble is.
    const culprits = [];
    const rebuildCulprits = () => {
      culprits.length = 0;
      for (let i = 0; i < M.pairs.length; i++) {
        const p = M.pairs[i];
        if (pairCost(M, p, mel) > 0) {
          for (let q = Math.max(0, p.k - 1); q <= Math.min(N - 1, p.k + 1); q++) if (!rest[q]) culprits.push(q);
          for (let q = Math.max(0, p.j - 1); q <= Math.min(N - 1, p.j + 1); q++) if (!rest[q]) culprits.push(q);
        }
      }
      for (let i = 0; i < sounding.length; i++) {
        const k = sounding[i];
        if (melodyCost(M, k, mel)[0] > 0) {
          culprits.push(k);
          if (M.prev[k] >= 0) culprits.push(M.prev[k]);
          if (M.prev[k] >= 0 && M.prev[M.prev[k]] >= 0) culprits.push(M.prev[M.prev[k]]);
        }
      }
    };
    const pickIndex = () => (culprits.length && rng() < 0.6 ? culprits[Math.floor(rng() * culprits.length)] : sounding[Math.floor(rng() * sounding.length)]);

    // Cost of every term that can change when the notes in [i0, i1] change: the pairs touching
    // i0-1 .. i1+1 (passing status looks at neighbours, parallels at predecessors) and the melodic
    // terms of the notes from i0 to six sounding notes past i1 (they look back).
    const region = [0, 0];
    function regionCost(i0, i1) {
      epoch++;
      let h = 0, so = 0;
      for (let i = Math.max(0, i0 - 1); i <= Math.min(N - 1, i1 + 1); i++) {
        const list = byIndex[i];
        for (let q = 0; q < list.length; q++) {
          const p = list[q];
          if (stamp[p.id] !== epoch) {
            stamp[p.id] = epoch;
            h += pairCost(M, p, mel);
          }
        }
      }
      for (let i = i0, n = 0; i >= 0 && (i <= i1 || n < 6); i = next[i]) {
        if (i > i1) n++;
        const c = melodyCost(M, i, mel);
        h += c[0];
        so += c[1];
      }
      region[0] = h;
      region[1] = so;
      return region;
    }

    // 1. Anneal over the whole line, for taste as much as for the rules.
    // 2. If rules are still broken, a tabu min-conflicts repair: take a note involved in a broken
    //    rule and give it (or it and a sounding neighbour, jointly) the values that cost least, even
    //    if that is worse than now, but never straight back to a value it just left. Single-note
    //    moves alone get stuck, because a note that fixes a clash breaks a melodic rule next door.
    // 3. If that stalls, reheat and go again, up to the move budget.
    const S = hi - lo + 1;
    const tabu = new Int32Array(N * S).fill(-1);
    let step = 0;
    const cycles = Math.max(1, Math.round(budgetMoves / (80 * N)));
    for (let cycle = 0; cycle < cycles && !best; cycle++) {
      const span = (cycle === 0 ? 80 : 110) * N;
      const Ta = cycle === 0 ? 1.6 : 0.6, Tb = 0.04;
      for (let i = 0; i < span; i++, it++) {
        const T = Ta * Math.pow(Tb / Ta, i / span);
        if ((it & 31) === 0) rebuildCulprits();
        const k = pickIndex();
        const old = mel[k];
        let d;
        if (rng() < 0.5) d = old + (rng() < 0.5 ? -1 : 1);
        else d = lo + Math.floor(rng() * S);
        if (d < lo || d > hi || d === old) continue;
        if (tryMove(k, d, T)) consider();
      }
      let bestHard = hard, lastGain = 0;
      for (let r = 0; r < 12 * N && hard > 0 && r - lastGain < 4 * N; r++, it++, step++) {
        if ((r & 3) === 0) rebuildCulprits();
        if (!culprits.length) break;
        const k = culprits[Math.floor(rng() * culprits.length)];
        if (rest[k]) continue;
        const k2 = rng() < 0.5 ? next[k] : M.prev[k];
        const a = k2 >= 0 ? Math.min(k, k2) : k;
        const b = k2 >= 0 ? Math.max(k, k2) : k;
        const oa = mel[a], ob = mel[b];
        regionCost(a, b);
        const h0 = region[0], s0 = region[1];
        let bestE = Infinity, bd1 = oa, bd2 = ob, bh = 0, bs = 0;
        for (let d1 = lo; d1 <= hi; d1++) {
          for (let d2 = lo; d2 <= hi; d2++) {
            if (a === b && d2 !== d1) continue;
            if (d1 === oa && d2 === ob) continue;
            mel[a] = d1;
            mel[b] = d2;
            regionCost(a, b);
            const dh = region[0] - h0, ds = region[1] - s0;
            const isTabu = (d1 !== oa && tabu[a * S + d1 - lo] > step) || (d2 !== ob && tabu[b * S + d2 - lo] > step);
            if (isTabu && hard + dh >= bestHard) continue; // aspiration: a new best is always allowed
            const e = HARD * dh + ds + rng() * 1e-3;
            if (e < bestE) {
              bestE = e;
              bd1 = d1;
              bd2 = d2;
              bh = dh;
              bs = ds;
            }
          }
        }
        mel[a] = oa;
        mel[b] = ob;
        if (bestE === Infinity) continue;
        const tenure = 6 + Math.floor(rng() * 6);
        if (bd1 !== oa) tabu[a * S + oa - lo] = step + tenure;
        if (bd2 !== ob) tabu[b * S + ob - lo] = step + tenure;
        mel[a] = bd1;
        mel[b] = bd2;
        hard += bh;
        soft += bs;
        if (hard < bestHard) {
          bestHard = hard;
          lastGain = r;
        }
        consider();
      }
      consider();
    }
    // 4. Polish: once a legal melody exists, spend a little longer on taste alone. Only moves that
    //    leave the hard-rule count at zero are accepted (one note, or two neighbours together), so
    //    this can make a legal melody nicer but never illegal.
    if (best) {
      for (let k = 0; k < N; k++) mel[k] = best[k];
      soft = bestSoft;
      const polishN = 60 * N;
      for (let i = 0; i < polishN; i++, it++) {
        const T = 0.25 * Math.pow(0.02 / 0.25, i / polishN);
        const k = sounding[Math.floor(rng() * sounding.length)];
        const k2 = rng() < 0.4 ? (rng() < 0.5 ? next[k] : M.prev[k]) : -1;
        const a = k2 >= 0 ? Math.min(k, k2) : k;
        const b = k2 >= 0 ? Math.max(k, k2) : k;
        const oa = mel[a], ob = mel[b];
        const d1 = rng() < 0.6 ? oa + (rng() < 0.5 ? -1 : 1) : lo + Math.floor(rng() * S);
        const d2 = a === b ? d1 : rng() < 0.6 ? ob + (rng() < 0.5 ? -1 : 1) : lo + Math.floor(rng() * S);
        if (d1 < lo || d1 > hi || d2 < lo || d2 > hi || (d1 === oa && d2 === ob)) continue;
        regionCost(a, b);
        const h0 = region[0], s0 = region[1];
        mel[a] = d1;
        mel[b] = d2;
        regionCost(a, b);
        const dh = region[0] - h0, ds = region[1] - s0;
        if (dh === 0 && (ds <= 0 || rng() < Math.exp(-ds / T))) {
          soft += ds;
          if (soft < bestSoft - 1e-9) {
            bestSoft = soft;
            for (let q = 0; q < N; q++) best[q] = mel[q];
          }
        } else {
          mel[a] = oa;
          mel[b] = ob;
        }
      }
    }
    return { mel: best, moves: it, hard: best ? 0 : hard, N, last: mel.slice() };
  }


  // ---------------------------------------------------------------- the piece
  /**
   * The whole piece for one seed. Deterministic: the same seed always gives the same events.
   * The seed fixes a mode, a final, the number of voices, their proportions and transpositions, a
   * tempo and a target length. Then: draw a talea, search for a melody that keeps every rule under
   * it; if the search fails, draw a fresh talea (attempts 1-4), then fall back to the easiest
   * transpositions for this many voices (5-8), then to three voices at 6:4:3 (9+). Every fallback
   * is itself drawn from the seed's random stream, so it is still a pure function of the seed.
   * Each attempt is kept short on purpose: a rhythm that has a legal melody is usually solved in a
   * tenth of a second, and a fresh rhythm is a better bet than a long search on a hard one.
   */
  function compose(seed, options) {
    const opts = options || {};
    const rng = makeRng(seed);
    const mode = opts.mode ? MODES.find((m) => m.name === opts.mode) : pick(rng, MODES);
    const final = mode.final + pick(rng, [-2, -1, 0, 0, 1, 2]);
    const V0 = opts.voices || (rng() < 0.6 ? 3 : 4);
    const ratios0 = opts.ratios || pick(rng, RATIO_SETS[V0]);
    const shifts0 = opts.shifts || pick(rng, SHIFT_SETS[V0]);
    const fastPulse = 0.24 + rng() * 0.07; // seconds per pulse in the fastest voice
    const targetSeconds = opts.seconds || 185 + rng() * 45;
    const maxAttempts = opts.attempts || 24;

    let V, ratios, shifts, unit, values, mel, talea, spec, attempts = 0, totalMoves = 0;
    for (;;) {
      attempts++;
      if (attempts <= 4 || opts.attempts) {
        V = V0;
        ratios = ratios0;
        shifts = shifts0;
      } else if (attempts <= 8) {
        V = V0;
        ratios = ratios0;
        shifts = SAFE_SHIFTS[V0];
      } else {
        V = 3;
        ratios = SAFE_RATIOS;
        shifts = SAFE_SHIFTS[3];
      }
      const rMax = ratios[0], rMin = ratios[V - 1];
      // seconds per pulse unit, rounded to a multiple of 2^-20 s (under a microsecond) so that every
      // time below is an exact binary fraction: t + dur of one note equals the next onset exactly
      unit = Math.round((fastPulse / rMin) * 1048576) / 1048576;
      spec = { ratios, shifts, mode, final, lo: MELODY_LO, hi: MELODY_HI };
      talea = makeTalea(rng, opts.sparse !== undefined ? opts.sparse : V === 4);
      const P = talea.reduce((a, b) => a + Math.abs(b), 0);
      const tailPulses = TAIL.reduce((a, b) => a + Math.abs(b), 0);
      const reps = Math.max(2, Math.round((targetSeconds / (rMax * unit) - tailPulses) / P));
      values = [];
      for (let i = 0; i < reps; i++) values.push(...talea);
      values.push(...TAIL);
      const res = searchMelody(rng, values, spec, (opts.cycles || 1) * 80 * values.length);
      totalMoves += res.moves;
      if (opts.trace) opts.trace({ attempt: attempts, hard: res.hard, N: res.N, moves: res.moves, ratios, shifts, mode: mode.name });
      if (res.mel) {
        mel = res.mel;
        break;
      }
      if (attempts >= maxAttempts) throw new Error('Prolation: no melody found for seed ' + seed);
    }
    // belt and braces: the melody that leaves the search breaks no rule
    const broken = violations(buildModel(values, spec), mel);
    if (broken.length) throw new Error('Prolation: internal rule violation for seed ' + seed);

    // Times are computed in whole pulse units first (exact integers), then scaled to seconds by a
    // dyadic unit, so every onset, duration and end is exact in floating point: two notes that meet
    // or coincide in the score meet or coincide exactly in the events too.
    const rMax = ratios[0];
    const N = values.length;
    const durs = values.map((x) => Math.abs(x));
    const cum = [0];
    for (let k = 0; k < N; k++) cum.push(cum[k] + durs[k]);
    const L = cum[N];
    const TU = L * rMax; // the end, in units
    const voices = [];
    const events = [];
    for (let v = 0; v < V; v++) {
      const r = ratios[v];
      const startU = TU - L * r;
      voices.push({
        index: v,
        ratio: r,
        shift: shifts[v],
        timbre: TIMBRES[V][v],
        start: startU * unit,
        startUnits: startU,
        pulse: r * unit,
        lowMidi: degreeToMidi(mode, final, MELODY_LO + shifts[v]),
        highMidi: degreeToMidi(mode, final, MELODY_HI + shifts[v]),
      });
      for (let k = 0; k < N; k++) {
        if (mel[k] === null) continue;
        const degree = mel[k] + shifts[v];
        const midi = degreeToMidi(mode, final, degree);
        const onU = startU + cum[k] * r;
        const lenU = durs[k] * r;
        events.push({
          voice: v,
          index: k,
          t: onU * unit,
          dur: lenU * unit,
          onUnits: onU,
          durUnits: lenU,
          degree,
          midi,
          freq: midiToFreq(midi, final),
          last: k === N - 1,
        });
      }
    }
    events.sort((a, b) => a.onUnits - b.onUnits || a.voice - b.voice);

    return {
      seed: String(seed),
      mode: { name: mode.name, steps: mode.steps.slice(), final, finalName: NOTE_NAMES[final % 12] },
      voices,
      ratios: ratios.slice(),
      shifts: shifts.slice(),
      unit,
      fastPulse,
      talea: talea.slice(),
      values,
      melody: mel,
      pulses: L,
      durationUnits: TU,
      duration: TU * unit,
      events,
      stats: { attempts, moves: totalMoves, notes: mel.filter((x) => x !== null).length, slots: N, fallback: attempts > 4 && !opts.attempts },
    };
  }

  function describeProportions(ratios) {
    return ratios.join(':');
  }

  return {
    compose,
    searchMelody,
    buildModel,
    violations,
    makeRng,
    degreeToMidi,
    midiToFreq,
    describeProportions,
    MODES,
    RATIO_SETS,
    SHIFT_SETS,
    CONSONANT,
    PERFECT,
    SAFE_SHIFTS,
    SAFE_RATIOS,
    TIMBRES,
    NOTE_NAMES,
    MELODY_LO,
    MELODY_HI,
    FINAL_DUR,
    TAIL,
  };
});

// node compose.js <seed>: print one performance as JSON (for anyone who wants to check it themselves)
if (typeof module === 'object' && typeof require === 'function' && require.main === module) {
  const piece = module.exports.compose(process.argv[2] || '1');
  process.stdout.write(JSON.stringify(piece, null, 1) + '\n');
}
