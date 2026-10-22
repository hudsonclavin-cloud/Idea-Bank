// Independent checks for every number the essay states.
// Run from anywhere: node --test ideas/06-self-overlap/test/
//
// The module under test (js/overlap.js) uses Conway's closed-form correlations. These
// tests recompute everything a different way: exact rational Markov chains (BigInt
// Gaussian elimination), brute-force enumeration of every flip sequence, and Monte
// Carlo with a PRNG unrelated to the one the module ships.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const here = (p) => new URL(p, import.meta.url);

// Load the classic-script module in a sandbox so the test does not depend on how
// Node would classify a .js file (CommonJS vs ESM) in whatever repo hosts it.
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(here('../js/overlap.js'), 'utf8'), sandbox);
const O = sandbox.Overlap;
const plain = (x) => JSON.parse(JSON.stringify(x)); // strip cross-realm prototypes

/* ------------------------------------------------------------------ */
/* Exact rational arithmetic                                           */
/* ------------------------------------------------------------------ */
const babs = (x) => (x < 0n ? -x : x);
const bgcd = (a, b) => {
  a = babs(a);
  b = babs(b);
  while (b) [a, b] = [b, a % b];
  return a;
};
class Q {
  constructor(n, d = 1n) {
    n = BigInt(n);
    d = BigInt(d);
    if (d === 0n) throw new Error('zero denominator');
    if (d < 0n) [n, d] = [-n, -d];
    const g = bgcd(n, d) || 1n;
    this.n = n / g;
    this.d = d / g;
  }
  add(o) { return new Q(this.n * o.d + o.n * this.d, this.d * o.d); }
  sub(o) { return new Q(this.n * o.d - o.n * this.d, this.d * o.d); }
  mul(o) { return new Q(this.n * o.n, this.d * o.d); }
  div(o) { return new Q(this.n * o.d, this.d * o.n); }
  isZero() { return this.n === 0n; }
  eq(o) { return this.n === o.n && this.d === o.d; }
  valueOf() { return Number(this.n) / Number(this.d); }
  toString() { return this.d === 1n ? `${this.n}` : `${this.n}/${this.d}`; }
}
const ZERO = new Q(0);
const ONE = new Q(1);
const HALF = new Q(1, 2);

// Solve A x = b exactly (A square, nonsingular) by Gauss-Jordan elimination.
function solve(A, b) {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    const r = M.findIndex((row, i) => i >= c && !row[c].isZero());
    if (r < 0) throw new Error('singular system');
    [M[c], M[r]] = [M[r], M[c]];
    const piv = M[c][c];
    for (let j = c; j <= n; j++) M[c][j] = M[c][j].div(piv);
    for (let i = 0; i < n; i++) {
      if (i === c || M[i][c].isZero()) continue;
      const f = M[i][c];
      for (let j = c; j <= n; j++) M[i][j] = M[i][j].sub(f.mul(M[c][j]));
    }
  }
  return M.map((row) => row[n]);
}

/* ------------------------------------------------------------------ */
/* Markov chains built from scratch (no use of the module)             */
/* ------------------------------------------------------------------ */
// States are the distinct proper prefixes of the target patterns (including '').
// After appending a letter, the new state is the longest suffix of the history that
// is a prefix of some target; reaching a full target absorbs.
function chain(targets) {
  const prefixes = new Set();
  for (const t of targets) for (let k = 0; k < t.length; k++) prefixes.add(t.slice(0, k));
  const states = [...prefixes];
  const idx = new Map(states.map((s, i) => [s, i]));
  const step = (s, c) => {
    const x = s + c;
    for (const t of targets) if (x.endsWith(t)) return { absorbed: t };
    for (let k = x.length; k >= 0; k--) {
      const suf = x.slice(x.length - k);
      if (idx.has(suf)) return { state: idx.get(suf) };
    }
    throw new Error('unreachable');
  };
  return { states, idx, step };
}

function markovExpectedWait(p) {
  const { states, step } = chain([p]);
  const n = states.length;
  // E_s - 1/2 E_{s+H} - 1/2 E_{s+T} = 1, with E = 0 once absorbed.
  const A = states.map(() => states.map(() => ZERO));
  const b = states.map(() => ONE);
  states.forEach((s, i) => {
    A[i][i] = A[i][i].add(ONE);
    for (const c of 'HT') {
      const r = step(s, c);
      if (r.state !== undefined) A[i][r.state] = A[i][r.state].sub(HALF);
    }
  });
  return solve(A, b)[0]; // state '' is index 0
}

// Exact probability that b appears before a.
function markovRace(a, b) {
  const { states, step } = chain([a, b]);
  const A = states.map(() => states.map(() => ZERO));
  const rhs = states.map(() => ZERO);
  states.forEach((s, i) => {
    A[i][i] = A[i][i].add(ONE);
    for (const c of 'HT') {
      const r = step(s, c);
      if (r.state !== undefined) A[i][r.state] = A[i][r.state].sub(HALF);
      else if (r.absorbed === b) rhs[i] = rhs[i].add(HALF);
    }
  });
  return solve(A, rhs)[0];
}

/* ------------------------------------------------------------------ */
/* Brute force and an unrelated PRNG                                   */
/* ------------------------------------------------------------------ */
function* sequences(len) {
  for (let i = 0; i < 1 << len; i++) {
    let s = '';
    for (let j = len - 1; j >= 0; j--) s += (i >> j) & 1 ? 'T' : 'H';
    yield s;
  }
}
const firstEnd = (p, s) => {
  const i = s.indexOf(p);
  return i < 0 ? 0 : i + p.length;
};
const countOcc = (p, s) => {
  let c = 0;
  for (let i = 0; i + p.length <= s.length; i++) if (s.startsWith(p, i)) c++;
  return c;
};

// xoshiro128** (Blackman & Vigna), seeded by splitmix32. Deliberately not mulberry32.
function xoshiro(seed) {
  let x = seed >>> 0;
  const sm = () => {
    x = (x + 0x9e3779b9) >>> 0;
    let z = x;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
  let s0 = sm(), s1 = sm(), s2 = sm(), s3 = sm();
  const rotl = (v, k) => (v << k) | (v >>> (32 - k));
  return () => {
    const r = Math.imul(rotl(Math.imul(s1, 5), 7), 9) >>> 0;
    const t = s1 << 9;
    s2 ^= s0; s3 ^= s1; s1 ^= s2; s0 ^= s3; s2 ^= t; s3 = rotl(s3, 11);
    return r;
  };
}
function coin(seed) {
  const r = xoshiro(seed);
  let w = 0, left = 0;
  return () => {
    if (!left) { w = r(); left = 32; }
    left--;
    const c = w & 1 ? 'H' : 'T';
    w >>>= 1;
    return c;
  };
}
function mcWait(p, games, seed) {
  const flip = coin(seed);
  let sum = 0, sumSq = 0;
  for (let g = 0; g < games; g++) {
    let s = '', t = 0;
    for (;;) {
      s = (s + flip()).slice(-p.length);
      t++;
      if (s === p) break;
    }
    sum += t;
    sumSq += t * t;
  }
  const mean = sum / games;
  const se = Math.sqrt((sumSq / games - mean * mean) / games);
  return { mean, se };
}

const fib = (k) => {
  let a = 0, b = 1;
  for (let i = 0; i < k; i++) [a, b] = [b, a + b];
  return a; // fib(1) = fib(2) = 1
};

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

test('expected waits: Conway formula equals an exact Markov chain for every pattern up to length 8', () => {
  for (let n = 1; n <= 8; n++) {
    for (const p of O.allPatterns(n)) {
      const exact = markovExpectedWait(p);
      assert.equal(exact.d, 1n, `${p}: wait should be an integer`);
      assert.equal(O.expectedWait(p), Number(exact.n), p);
    }
  }
});

test('expected waits agree with Monte Carlo (within 5 standard errors)', () => {
  const cases = ['HH', 'HT', 'HTH', 'HHT', 'HHHH', 'HTHT', 'HHTT', 'HTHH', 'THTH', 'HTHHT'];
  cases.forEach((p, i) => {
    const { mean, se } = mcWait(p, 40000, 1000 + i);
    assert.ok(Math.abs(mean - O.expectedWait(p)) < 5 * se, `${p}: simulated ${mean} vs ${O.expectedWait(p)} (se ${se})`);
  });
});

test('fastest and slowest patterns of each length: 2^n and 2^(n+1) - 2', () => {
  for (let n = 1; n <= 10; n++) {
    const waits = O.allPatterns(n).map((p) => [p, O.expectedWait(p)]);
    const min = Math.min(...waits.map((w) => w[1]));
    const max = Math.max(...waits.map((w) => w[1]));
    assert.equal(min, 2 ** n);
    assert.equal(max, 2 ** (n + 1) - 2);
    // Fastest = exactly the patterns with no proper self-overlap.
    for (const [p, w] of waits) {
      const proper = O.selfOverlaps(p).slice(1).some((o) => o.match);
      assert.equal(w === 2 ** n, !proper, p);
    }
    // Slowest = exactly the two constant patterns.
    const slow = [...waits.filter((w) => w[1] === max).map((w) => w[0])].sort();
    assert.deepEqual(slow, ['H'.repeat(n), 'T'.repeat(n)]);
  }
});

test('selfOverlaps is the sliding picture: sum of values equals the expected wait', () => {
  for (let n = 1; n <= 8; n++) {
    for (const p of O.allPatterns(n)) {
      const rows = plain(O.selfOverlaps(p));
      assert.equal(rows.length, n);
      assert.equal(rows[0].match, true);
      assert.equal(rows.reduce((s, r) => s + r.value, 0), O.expectedWait(p));
    }
  }
});

test('first-occurrence distributions: HT is (t-1)/2^t, HH is Fibonacci(t-1)/2^t, and both match enumeration', () => {
  const L = 16;
  const counts = { HH: new Array(L + 1).fill(0), HT: new Array(L + 1).fill(0) };
  for (const s of sequences(L)) for (const p of ['HH', 'HT']) counts[p][firstEnd(p, s)]++;
  const pmfHH = O.waitPMF('HH', L);
  const pmfHT = O.waitPMF('HT', L);
  for (let t = 2; t <= L; t++) {
    assert.equal(counts.HT[t] / 2 ** L, (t - 1) / 2 ** t, `HT t=${t}`);
    assert.equal(counts.HH[t] / 2 ** L, fib(t - 1) / 2 ** t, `HH t=${t}`);
    assert.ok(Math.abs(pmfHT[t] - (t - 1) / 2 ** t) < 1e-15);
    assert.ok(Math.abs(pmfHH[t] - fib(t - 1) / 2 ** t) < 1e-15);
  }
});

test('race probabilities: Conway odds equal an exact Markov chain for all pairs up to length 5', () => {
  for (let n = 2; n <= 5; n++) {
    const ps = O.allPatterns(n);
    for (const a of ps) for (const b of ps) {
      if (a === b) continue;
      const exact = markovRace(a, b);
      const r = O.race(a, b);
      assert.equal(`${r.pB.num}/${r.pB.den}`, exact.d === 1n ? `${exact.n}/1` : exact.toString(), `${a} vs ${b}`);
    }
  }
});

test('race probabilities agree with Monte Carlo', () => {
  const pairs = [['HH', 'HT'], ['HHT', 'THH'], ['HTHH', 'THTH'], ['HTT', 'HHT'], ['HHH', 'THH']];
  pairs.forEach(([a, b], i) => {
    const flip = coin(77 + i);
    const N = 60000;
    let bWins = 0;
    for (let g = 0; g < N; g++) {
      let s = '';
      for (;;) {
        s = (s + flip()).slice(-a.length);
        if (s === a) break;
        if (s === b) { bWins++; break; }
      }
    }
    const p = O.race(a, b).pB.value;
    const se = Math.sqrt((p * (1 - p)) / N);
    assert.ok(Math.abs(bWins / N - p) < 5 * se, `${a} vs ${b}: ${bWins / N} vs ${p}`);
  });
});

test('Penney, length 3: every pattern has a counter winning >= 2/3, and Conway\'s recipe finds the best one', () => {
  const expected = { HHH: ['THH', '7/8'], HHT: ['THH', '3/4'], HTH: ['HHT', '2/3'], HTT: ['HHT', '2/3'],
    THH: ['TTH', '2/3'], THT: ['TTH', '2/3'], TTH: ['HTT', '3/4'], TTT: ['HTT', '7/8'] };
  for (const a of O.allPatterns(3)) {
    // exhaustive search with the independent Markov chain
    let best = null;
    for (const b of O.allPatterns(3)) {
      if (b === a) continue;
      const p = markovRace(a, b);
      if (!best || p.valueOf() > best.p.valueOf()) best = { b, p };
    }
    assert.equal(best.b, expected[a][0], a);
    assert.equal(best.p.toString(), expected[a][1], a);
    assert.ok(best.p.valueOf() >= 2 / 3);
    assert.equal(O.conwayReply(a), best.b, `Conway recipe for ${a}`);
    assert.equal(O.bestReply(a).pattern, best.b);
    // ...and the counter is unique
    const ties = O.allPatterns(3).filter((b) => b !== a && markovRace(a, b).eq(best.p));
    assert.equal(ties.length, 1, a);
  }
});

test('Penney nontransitivity: every pattern of length 3..8 is beaten by some pattern of its length', () => {
  for (let n = 3; n <= 8; n++) {
    for (const a of O.allPatterns(n)) {
      const r = O.bestReply(a);
      assert.ok(r.prob.value > 0.5, `${a} unbeaten`);
    }
  }
  // ...but not at length 2: HT and TH can only be tied.
  assert.equal(O.bestReply('HT').prob.value, 0.5);
  assert.equal(O.bestReply('TH').prob.value, 0.5);
});

test('the four-pattern loop HTT -> HHT -> THH -> TTH -> HTT', () => {
  const loop = ['HTT', 'HHT', 'THH', 'TTH'];
  const probs = loop.map((a, i) => markovRace(a, loop[(i + 1) % 4]).toString());
  assert.deepEqual(probs, ['2/3', '3/4', '2/3', '3/4']);
});

test('HHT can only win against THH if the game opens HH (so exactly 1/4)', () => {
  // Enumerate 20-flip prefixes; the race is decided within them unless no H-H ever occurs.
  let hhtWins = 0, openHH = 0, undecided = 0;
  for (const s of sequences(20)) {
    const i = s.indexOf('HHT'), j = s.indexOf('THH');
    if (i < 0 && j < 0) { undecided++; continue; }
    const hhtFirst = j < 0 || (i >= 0 && i + 3 < j + 3);
    if (hhtFirst) hhtWins++;
    if (s.startsWith('HH')) openHH++;
    if (hhtFirst) assert.ok(s.startsWith('HH'), s);
  }
  assert.equal(hhtWins, openHH);
  assert.equal(hhtWins, 2 ** 18 - 1); // every HH... opening except all heads, which is undecided
  assert.ok(undecided / 2 ** 20 < 0.02);
});

test('long-run gaps: mean 2^n for any pattern; HH gaps are 1 half the time, else average 7', () => {
  for (const p of ['HH', 'HT', 'HTH', 'HHHH', 'THTH']) {
    const gap = O.gapPMF(p, 4000);
    const mass = gap.reduce((s, x) => s + x, 0);
    const mean = gap.reduce((s, x, d) => s + d * x, 0);
    assert.ok(Math.abs(mass - 1) < 1e-9);
    assert.ok(Math.abs(mean - 2 ** p.length) < 1e-6, `${p} mean gap ${mean}`);
  }
  const g = O.gapPMF('HH', 4000);
  assert.equal(g[1], 0.5);
  const meanLong = g.reduce((s, x, d) => (d > 1 ? s + d * x : s), 0) / (1 - g[1]);
  assert.ok(Math.abs(meanLong - 7) < 1e-9);
  assert.equal(O.gapPMF('HT', 10)[1], 0, 'HT never repeats one flip later');

  // Same facts from one long simulated string.
  const flip = coin(4242);
  let s = '';
  for (let i = 0; i < 2_000_000; i++) s += flip();
  for (const p of ['HH', 'HT']) {
    const ends = [];
    for (let i = 0; i + 2 <= s.length; i++) if (s.startsWith(p, i)) ends.push(i + 2);
    const gaps = ends.slice(1).map((e, i) => e - ends[i]);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    assert.ok(Math.abs(mean - 4) < 0.02, `${p} simulated mean gap ${mean}`);
    const ones = gaps.filter((x) => x === 1).length / gaps.length;
    if (p === 'HH') {
      assert.ok(Math.abs(ones - 0.5) < 0.005);
      const long = gaps.filter((x) => x > 1);
      assert.ok(Math.abs(long.reduce((a, b) => a + b, 0) / long.length - 7) < 0.05);
    } else assert.equal(ones, 0);
  }
});

test('occurrence counts: mean and variance match exhaustive enumeration and simulation', () => {
  for (const p of ['HH', 'HT', 'HTH', 'HHT', 'HHHH']) {
    for (const N of [5, 9, 14]) {
      let sum = 0, sumSq = 0;
      for (const s of sequences(N)) {
        const c = countOcc(p, s);
        sum += c;
        sumSq += c * c;
      }
      const mean = sum / 2 ** N;
      const variance = sumSq / 2 ** N - mean * mean;
      const m = O.countMoments(p, N);
      assert.ok(Math.abs(m.mean - mean) < 1e-9, `${p} N=${N} mean`);
      assert.ok(Math.abs(m.variance - variance) < 1e-9, `${p} N=${N} variance ${m.variance} vs ${variance}`);
    }
  }
  // N = 160, as in the essay's strip: exact values and a simulation cross-check.
  assert.equal(O.countMoments('HH', 160).variance, 793 / 16);
  assert.equal(O.countMoments('HT', 160).variance, 161 / 16);
  const flip = coin(9);
  const stats = { HH: [0, 0], HT: [0, 0] };
  const R = 40000;
  for (let r = 0; r < R; r++) {
    let s = '';
    for (let i = 0; i < 160; i++) s += flip();
    for (const p of ['HH', 'HT']) {
      const c = countOcc(p, s);
      stats[p][0] += c;
      stats[p][1] += c * c;
    }
  }
  for (const p of ['HH', 'HT']) {
    const mean = stats[p][0] / R;
    const sd = Math.sqrt(stats[p][1] / R - mean * mean);
    assert.ok(Math.abs(mean - 39.75) < 0.15, `${p} mean ${mean}`);
    assert.ok(Math.abs(sd - O.countMoments(p, 160).sd) < 0.1, `${p} sd ${sd}`);
  }
});

test('Li\'s casino: when the pattern appears, the survivors always hold exactly the expected wait', () => {
  for (const p of ['HH', 'HT', 'HTH', 'HHT', 'HTHT', 'THTH', 'HHHH']) {
    const flip = coin(p.length * 31 + p.charCodeAt(1));
    for (let g = 0; g < 300; g++) {
      let s = '';
      while (!s.endsWith(p)) s += flip();
      // independent recount of survivors
      let payout = 0;
      for (let k = 1; k <= p.length; k++) {
        const arrivedAt = s.length - k; // 0-based index of the flip she first bet on
        if (arrivedAt >= 0 && s.slice(arrivedAt) === p.slice(0, k)) payout += 2 ** k;
      }
      assert.equal(payout, O.expectedWait(p));
      const states = plain(O.gamblers(p, s, s.length));
      assert.equal(states.reduce((a, x) => a + x.stake, 0), payout);
      assert.equal(states.filter((x) => x.complete).length, 1, 'exactly one gambler completes');
      assert.equal(states.length, s.length, 'one gambler per flip');
    }
  }
});

test('module simulators are unbiased', () => {
  const bit = O.bitSource(O.mulberry32(12345));
  let sum = 0;
  const N = 40000;
  for (let i = 0; i < N; i++) sum += O.simulateWait('HTH', bit);
  assert.ok(Math.abs(sum / N - 10) < 0.2, `HTH simulated ${sum / N}`);
  let a = 0;
  for (let i = 0; i < N; i++) if (O.simulateRace('HHT', 'THH', bit) === 'b') a++;
  assert.ok(Math.abs(a / N - 0.75) < 0.012);
});

/* ------------------------------------------------------------------ */
/* Every number tagged in the essay                                    */
/* ------------------------------------------------------------------ */
// In index.html, each checkable number is wrapped like <span data-claim="wait:HTH">10</span>.
test('every data-claim in index.html matches an independent computation', () => {
  const html = fs.readFileSync(here('../index.html'), 'utf8');
  const re = /<([a-z]+)[^>]*\sdata-claim="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g;
  const claims = [...html.matchAll(re)].map((m) => ({ key: m[2], text: m[3].replace(/<[^>]+>/g, '').trim() }));
  assert.ok(claims.length >= 20, `expected many tagged claims, found ${claims.length}`);
  const decimals = (t) => (t.includes('.') ? t.split('.')[1].replace(/\D.*$/, '').length : 0);
  const num = (t) => Number(t.replace(/[^0-9.]/g, ''));
  const fracOf = (t) => {
    const m = t.match(/(\d+)\D+(\d+)/);
    assert.ok(m, `cannot read a fraction from "${t}"`);
    return new Q(m[1], m[2]);
  };
  for (const { key, text } of claims) {
    const [kind, ...args] = key.split(':');
    switch (kind) {
      case 'wait': // average flips to see args[0]
        assert.equal(num(text), Number(markovExpectedWait(args[0]).n), key);
        break;
      case 'pow': // 2^k as stated
        assert.equal(num(text), 2 ** Number(args[0]), key);
        break;
      case 'race': // probability that args[1] appears before args[0], written "a ... b" or "a/b"
        assert.ok(fracOf(text).eq(markovRace(args[0], args[1])), `${key}: "${text}"`);
        break;
      case 'racepct': {
        const p = markovRace(args[0], args[1]).valueOf() * 100;
        assert.equal(num(text), Number(p.toFixed(decimals(text))), key);
        break;
      }
      case 'count': { // expected occurrences of args[0] in args[1] flips
        let mean = 0;
        const N = Number(args[1]);
        mean = (N - args[0].length + 1) / 2 ** args[0].length;
        assert.equal(num(text), mean, key);
        break;
      }
      case 'sd': { // standard deviation of the count, checked against the enumeration-verified formula
        const sd = O.countMoments(args[0], Number(args[1])).sd;
        assert.equal(num(text), Number(sd.toFixed(decimals(text))), key);
        break;
      }
      case 'gapmean':
        assert.equal(num(text), 2 ** args[0].length, key);
        break;
      case 'gaplong': { // mean of the gaps longer than one flip
        const g = O.gapPMF(args[0], 4000);
        const v = g.reduce((s, x, d) => (d > 1 ? s + d * x : s), 0) / (1 - g[1]);
        assert.equal(num(text), Number(v.toFixed(decimals(text))), key);
        break;
      }
      case 'ratio': { // wait(args[0]) / wait(args[1]) as a percentage increase
        const r = (Number(markovExpectedWait(args[0]).n) / Number(markovExpectedWait(args[1]).n) - 1) * 100;
        assert.equal(num(text), r, key);
        break;
      }
      case 'pairprob': { // chance that a given window of flips spells args[0]
        const v = { '¼': new Q(1, 4), '½': new Q(1, 2), '⅛': new Q(1, 8) }[text] || fracOf(text);
        let hits = 0;
        for (const s of sequences(args[0].length)) if (s === args[0]) hits++;
        assert.ok(v.eq(new Q(hits, 2 ** args[0].length)), key);
        break;
      }
      case 'corr': { // X·Y: sum of 2^k where the last k of X equal the first k of Y, recomputed letter by letter
        const [x, y] = args;
        let v = 0;
        for (let k = 1; k <= Math.min(x.length, y.length); k++) {
          let same = true;
          for (let i = 0; i < k; i++) if (x[x.length - k + i] !== y[i]) same = false;
          if (same) v += 2 ** k;
        }
        assert.equal(num(text), v, key);
        assert.equal(O.correlation(x, y), v, key);
        break;
      }
      case 'odds': { // "a to b": odds that args[1] appears before args[0]
        const m = text.match(/(\d+)\D+(\d+)/);
        const a = Number(m[1]), b = Number(m[2]);
        assert.ok(new Q(a, a + b).eq(markovRace(args[0], args[1])), `${key}: "${text}"`);
        break;
      }
      default:
        assert.fail(`unknown claim kind ${kind}`);
    }
  }
});
