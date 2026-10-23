// Tests for vc.js. Run from the repo root: node --test ideas/20-two-sheets/vc.test.mjs
//
// The secrecy claims are checked EXHAUSTIVELY at the cell level: every scheme consumes one key
// value in [0, 144) per cell, so for each possible secret input we enumerate all 144 keys and
// compare the resulting distribution of patterns on each sheet. "Secure" means: the histogram of
// patterns on a sheet is the same for every value of the secret (and, for the cover scheme, the
// same for every value of the other sheet's cover). The whole-picture tests then check that the
// sheet functions are the cell functions applied cell by cell, that laying the sheets together
// reads back the exact picture, and how much a misregistered overlay still gives away (a lot: only a
// single sheet is secret, never a pair, however it lies).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const VC = require('./vc.js');
const Leak = require('./leak.js');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const { KEY_RANGE, TWO, THREE, ONE, popcount } = VC;

const W = 120;
const H = 44;

function picture(kind) {
  const bits = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = 0;
      if (kind === 'disc') v = (x - 60) ** 2 + (y - 22) ** 2 < 15 ** 2 ? 1 : 0;
      else if (kind === 'bars') v = (x >> 3) % 3 === 0 && y > 8 && y < 36 ? 1 : 0;
      else if (kind === 'blank') v = 0;
      else if (kind === 'full') v = 1;
      bits[y * W + x] = v;
    }
  }
  return bits;
}
function randomPicture(seed, p = 0.5) {
  const rnd = VC.mulberry32(seed);
  const bits = new Uint8Array(W * H);
  for (let i = 0; i < bits.length; i++) bits[i] = rnd() < p ? 1 : 0;
  return bits;
}
function sameBits(a, b) {
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function histOf(masks) {
  return VC.histogram(masks);
}
function assertUniformOver(hist, patterns, expectedCount, label) {
  const total = hist.reduce((s, c) => s + c, 0);
  assert.equal(total, expectedCount * patterns.length, `${label}: total count`);
  for (let m = 0; m < 16; m++) {
    const want = patterns.includes(m) ? expectedCount : 0;
    assert.equal(hist[m], want, `${label}: pattern ${m.toString(2).padStart(4, '0')} count`);
  }
}

// ---- tables and randomness ----------------------------------------------------------------

test('pattern tables are complete and correct', () => {
  assert.deepEqual([...TWO].sort(), [...Array(16).keys()].filter((m) => popcount(m) === 2).sort());
  assert.deepEqual([...THREE].sort(), [...Array(16).keys()].filter((m) => popcount(m) === 3).sort());
  assert.deepEqual([...ONE].sort(), [1, 2, 4]);
  assert.equal(KEY_RANGE, 144);
});

test('randomKey rejects bytes >= 144 and is unbiased over [0, 144)', () => {
  // Feed bytes 0..255 in order, four times. Every value < 144 is accepted exactly once per sweep.
  let next = 0;
  const key = VC.randomKey(4 * KEY_RANGE, (buf) => {
    for (let i = 0; i < buf.length; i++) buf[i] = next++ & 255;
  });
  const counts = new Array(256).fill(0);
  for (const k of key) counts[k]++;
  for (let v = 0; v < 256; v++) assert.equal(counts[v], v < KEY_RANGE ? 4 : 0, `value ${v}`);
});

test('seededKey is deterministic and in range', () => {
  const a = VC.seededKey(1000, 7);
  const b = VC.seededKey(1000, 7);
  const c = VC.seededKey(1000, 8);
  assert.ok(sameBits(a, b));
  assert.ok(!sameBits(a, c));
  for (const k of a) assert.ok(k >= 0 && k < KEY_RANGE);
});

// ---- exhaustive cell-level proofs -----------------------------------------------------------

test('two sheets: each sheet is uniform over the six 2-of-4 patterns whatever the secret bit', () => {
  for (const sheet of [0, 1]) {
    const hists = [0, 1].map((bit) => {
      const masks = [];
      for (let k = 0; k < KEY_RANGE; k++) masks.push(VC.cellTwo(bit, k)[sheet]);
      return histOf(masks);
    });
    assert.deepEqual(hists[0], hists[1], `sheet ${sheet}: same histogram for white and black`);
    assertUniformOver(hists[0], TWO, KEY_RANGE / 6, `sheet ${sheet}`);
  }
});

test('two sheets: sheet A is a function of the key alone; the overlay reads 2 (white) or 4 (black)', () => {
  for (let k = 0; k < KEY_RANGE; k++) {
    const [a0, b0] = VC.cellTwo(0, k);
    const [a1, b1] = VC.cellTwo(1, k);
    assert.equal(a0, a1, 'A does not depend on the secret');
    assert.equal(b0, a0, 'white: B equals A');
    assert.equal(b1, ~a0 & 15, 'black: B is the complement of A');
    assert.equal(popcount(a0 | b0), 2);
    assert.equal(popcount(a1 | b1), 4);
  }
});

test('three sheets: each sheet is uniform over the three 1-of-3 patterns whatever the secret bit', () => {
  for (const sheet of [0, 1, 2]) {
    const hists = [0, 1].map((bit) => {
      const masks = [];
      for (let k = 0; k < KEY_RANGE; k++) masks.push(VC.cellThree(bit, k)[sheet]);
      return histOf(masks);
    });
    assert.deepEqual(hists[0], hists[1], `sheet ${sheet}: same histogram for white and black`);
    assertUniformOver(hists[0], ONE, KEY_RANGE / 3, `sheet ${sheet}`);
  }
});

test('three sheets: any pair reads 1 (white) or 2 (black); sheet A ignores the secret', () => {
  for (let k = 0; k < KEY_RANGE; k++) {
    const s0 = VC.cellThree(0, k);
    const s1 = VC.cellThree(1, k);
    assert.equal(s0[0], s1[0]);
    for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) {
      assert.equal(popcount(s0[i] | s0[j]), 1, `white pair ${i},${j}`);
      assert.equal(popcount(s1[i] | s1[j]), 2, `black pair ${i},${j}`);
    }
    assert.equal(popcount(s0[0] | s0[1] | s0[2]), 1);
    assert.equal(popcount(s1[0] | s1[1] | s1[2]), 3);
    for (const m of [...s0, ...s1]) assert.equal(m & 8, 0, 'bottom-right subpixel is always clear');
  }
});

test('cover sheets: sheet A depends only on cover A; sheet B is distributed by cover B alone', () => {
  // For every (secret, coverA, coverB), the histogram over all 144 keys of sheet A must equal
  // the histogram for every other (secret, coverB) with the same coverA, and be uniform over the
  // 2-of-4 patterns (coverA white) or the 3-of-4 patterns (coverA black). Likewise for B / coverB.
  const histA = {};
  const histB = {};
  for (const bit of [0, 1]) {
    for (const ca of [0, 1]) {
      for (const cb of [0, 1]) {
        const as = [];
        const bs = [];
        for (let k = 0; k < KEY_RANGE; k++) {
          const [a, b] = VC.cellCover(bit, ca, cb, k);
          as.push(a);
          bs.push(b);
          assert.equal(popcount(a), ca ? 3 : 2, 'A shows its cover');
          assert.equal(popcount(b), cb ? 3 : 2, 'B shows its cover');
          const want = bit ? 4 : ca || cb ? 3 : 2;
          assert.equal(popcount(a | b), want, `overlay for secret ${bit} covers ${ca}${cb}`);
          // and A is literally the same regardless of secret and cover B
          assert.equal(a, VC.cellCover(1 - bit, ca, 1 - cb, k)[0]);
        }
        histA[`${bit}${ca}${cb}`] = histOf(as);
        histB[`${bit}${ca}${cb}`] = histOf(bs);
      }
    }
  }
  for (const key of Object.keys(histA)) {
    const ca = Number(key[1]);
    const cb = Number(key[2]);
    assertUniformOver(histA[key], ca ? THREE : TWO, ca ? KEY_RANGE / 4 : KEY_RANGE / 6, `A ${key}`);
    assertUniformOver(histB[key], cb ? THREE : TWO, cb ? KEY_RANGE / 4 : KEY_RANGE / 6, `B ${key}`);
  }
});

test('cover sheets: the ghost is a choice; a variant with a uniform three-subpixel white has none', () => {
  // Change only (white secret, both covers white): B shares exactly one subpixel with A, chosen by
  // the second key value. Each sheet's histogram must still depend only on its own cover, and every
  // white cell must then show three black subpixels, every black cell four.
  const variant = (bit, ca, cb, k) => {
    const [A, B] = VC.cellCover(bit, ca, cb, k);
    if (bit || ca || cb) return [A, B];
    const h = (k / 12) | 0;
    return [A, (1 << VC.bitsOf(A)[h % 2]) | (1 << VC.bitsOf(~A & 15)[(h >> 1) % 2])];
  };
  const hists = {};
  for (const bit of [0, 1]) for (const ca of [0, 1]) for (const cb of [0, 1]) {
    const as = [];
    const bs = [];
    for (let k = 0; k < KEY_RANGE; k++) {
      const [a, b] = variant(bit, ca, cb, k);
      as.push(a);
      bs.push(b);
      assert.equal(popcount(b), cb ? 3 : 2);
      assert.equal(popcount(a | b), bit ? 4 : 3, 'no ghost: white is always three');
    }
    for (const [name, list, c] of [['A', as, ca], ['B', bs, cb]]) {
      const key = `${name}${c}`;
      const h = histOf(list).join();
      if (hists[key] === undefined) hists[key] = h;
      assert.equal(h, hists[key], `${name}'s histogram depends only on its own cover`);
    }
  }
});

// ---- whole pictures -------------------------------------------------------------------------

test('two sheets: a new message leaves sheet A byte-identical and the aligned overlay reads back exactly', () => {
  const key = VC.seededKey(W * H, 42);
  const p1 = picture('disc');
  const p2 = picture('bars');
  const [a1, b1] = VC.twoSheets(p1, key);
  const [a2, b2] = VC.twoSheets(p2, key);
  assert.ok(sameBits(a1, a2), 'sheet A identical for two different pictures under one key');
  assert.equal(VC.fingerprint(a1), VC.fingerprint(a2));
  assert.ok(!sameBits(b1, b2), 'sheet B differs');
  assert.notEqual(VC.fingerprint(b1), VC.fingerprint(b2));
  for (const [p, a, b] of [[p1, a1, b1], [p2, a2, b2]]) {
    const over = VC.overlay([VC.rasterize(a, W, H), VC.rasterize(b, W, H)], [[0, 0], [0, 0]], W, H);
    const counts = VC.cellCounts(over, W, H);
    assert.ok(sameBits(VC.decode(counts, 4), p), 'decoded picture equals the secret');
    // rasterize/overlay agrees with the direct mask OR
    const direct = VC.orMasks([a, b]);
    for (let i = 0; i < counts.length; i++) assert.equal(counts[i], popcount(direct[i]));
  }
});

test('two sheets: empirical mutual information, single sheets vs the overlay', () => {
  const key = VC.seededKey(W * H, 3);
  const bits = picture('disc');
  const [a, b] = VC.twoSheets(bits, key);
  const miA = VC.mutualInformation(bits, a).bits;
  const miB = VC.mutualInformation(bits, b).bits;
  const counts = VC.cellCounts(VC.overlay([VC.rasterize(a, W, H), VC.rasterize(b, W, H)], [[0, 0], [0, 0]], W, H), W, H);
  const miOver = VC.mutualInformation(bits, counts).bits;
  const entropy = VC.mutualInformation(bits, bits).bits;
  // Plug-in MI estimates are biased upward by about (|X|-1)(|Y|-1)/(2 N ln 2) bits: here ~0.0007.
  assert.ok(miA < 0.005, `MI(secret; sheet A) = ${miA}`);
  assert.ok(miB < 0.005, `MI(secret; sheet B) = ${miB}`);
  assert.ok(Math.abs(miOver - entropy) < 1e-9, `MI(secret; overlay) = ${miOver}, H = ${entropy}`);
  console.log(`  MI bits: A ${miA.toFixed(5)}, B ${miB.toFixed(5)}, overlay ${miOver.toFixed(5)} (entropy ${entropy.toFixed(5)})`);
});

test('misregistration: the black-subpixel count per cell (what the eye averages) carries little or nothing', () => {
  // This is the statistic the eye uses, and the one an earlier version of this entry mistook for
  // "the" information in a slipped stack. It is small at one subpixel and zero at a whole cell.
  const key = VC.seededKey(W * H, 11);
  const results = {};
  for (const kind of ['disc', 'bars']) {
    const bits = picture(kind);
    const [a, b] = VC.twoSheets(bits, key);
    const ra = VC.rasterize(a, W, H);
    const rb = VC.rasterize(b, W, H);
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1], [2, 0], [0, 2]]) {
      const counts = VC.cellCounts(VC.overlay([ra, rb], [[0, 0], [dx, dy]], W, H), W, H);
      const dec = VC.decode(counts, 4);
      let right = 0;
      for (let i = 0; i < bits.length; i++) if (dec[i] === bits[i]) right++;
      const acc = right / bits.length;
      const mi = VC.mutualInformation(bits, counts).bits;
      results[`${kind} ${dx},${dy}`] = { acc, mi };
      if (dx === 0 && dy === 0) assert.equal(acc, 1);
      else if (dx >= 2 || dy >= 2) assert.ok(mi < 0.01, `one whole cell off: count MI ${mi}`);
    }
  }
  for (const [k, v] of Object.entries(results)) console.log(`  ${k.padEnd(10)} count decoder ${(v.acc * 100).toFixed(1)}%  MI(message; count) ${v.mi.toFixed(4)} bits`);
  assert.ok(results['disc 1,0'].mi < 0.25 * results['disc 0,0'].mi);
  assert.ok(results['bars 1,0'].mi < 0.25 * results['bars 0,0'].mi);
  // Exactly, for one cell in the middle of a row, with a 50/50 message:
  const sub = Leak.oneCellInformation(VC, 1, 0, 0.5);
  assert.ok(Math.abs(sub.count - 0.0366) < 5e-4, `one subpixel, count: ${sub.count}`);
  assert.ok(Math.abs(sub.meanCountWhite - 19 / 6) < 1e-12 && Math.abs(sub.meanCountBlack - 17 / 6) < 1e-12, 'a faint negative: white cells darker');
  assert.ok(Math.abs(sub.pattern - 0.2683) < 5e-4, `one subpixel, the cell's own 2x2 pattern: ${sub.pattern}`);
  for (const [dx, dy] of [[2, 0], [0, 2], [14, 12]]) {
    const r = Leak.oneCellInformation(VC, dx, dy, 0.5);
    assert.ok(r.count < 1e-12 && r.pattern < 1e-12, `whole-cell slip ${dx},${dy}: a cell alone says nothing`);
  }
  console.log(`  one cell, 50/50 message, one-subpixel slip: count ${sub.count.toFixed(4)} bits, own 2x2 pattern ${sub.pattern.toFixed(4)} bits; whole-cell slip: 0 and 0`);
});

test('leak.js: the forward-algorithm estimate equals brute-force I(message; overlay) on short rows', () => {
  // Every message and every key of a three-cell strip, every chain slip: the expected value of
  // log2 P(O | M) - log2 P(O) computed by leak.js must equal the mutual information computed by
  // enumerating the joint distribution of (message, overlay) directly.
  for (const [dx, dy, w, h] of [[1, 0, 3, 1], [-1, 0, 3, 1], [0, 1, 1, 3], [2, 0, 3, 1], [-2, 0, 3, 1], [0, 2, 1, 3]]) {
    const joint = new Map();
    const pm = new Map();
    const po = new Map();
    let expected = 0;
    const n = w * h;
    const weight = 1 / (2 ** n * 6 ** n);
    for (let mm = 0; mm < 2 ** n; mm++) {
      const bits = Uint8Array.from({ length: n }, (_, i) => (mm >> i) & 1);
      for (let kk = 0; kk < 6 ** n; kk++) {
        const key = Uint8Array.from({ length: n }, (_, i) => Math.floor(kk / 6 ** i) % 6);
        const [a, b] = VC.twoSheets(bits, key);
        const over = VC.overlay([VC.rasterize(a, w, h), VC.rasterize(b, w, h)], [[0, 0], [dx, dy]], w, h);
        const obs = Leak.cellPatterns(over, w, h);
        const o = obs.join(',');
        joint.set(`${mm}|${o}`, (joint.get(`${mm}|${o}`) || 0) + weight);
        pm.set(mm, (pm.get(mm) || 0) + weight);
        po.set(o, (po.get(o) || 0) + weight);
        expected += weight * Leak.analyseObserved(VC, obs, w, h, dx, dy, { bits, p: 0.5 }).infoBits;
      }
    }
    let brute = 0;
    for (const [k, v] of joint) {
      const [m, o] = k.split('|');
      brute += v * Math.log2(v / (pm.get(Number(m)) * po.get(o)));
    }
    assert.ok(Math.abs(brute - expected) < 1e-9, `slip ${dx},${dy}: brute ${brute}, forward algorithm ${expected}`);
  }
});

// Measured once, used by the next tests: the information a slipped two-sheet stack still carries
// about a random 50/50 message (1 bit per cell), from the full subpixel pattern of the overlay.
const slipped = (() => {
  let memo = null;
  return () => {
    if (memo) return memo;
    memo = {};
    const runs = [
      ['sideways one subpixel', 1, 0, 2000, 20],
      ['up/down one subpixel', 0, 1, 20, 2000],
      ['one cell sideways', 2, 0, 2000, 20],
      ['one cell down', 0, 2, 20, 2000],
      ['scattered layout (7 cells right, 6 down) on the page\'s 100x40 sheet', 14, 12, 100, 40],
    ];
    for (const [label, dx, dy, w, h] of runs) {
      let info = 0;
      let right = 0;
      let cells = 0;
      const reps = w * h > 10000 ? 2 : 20;
      for (let r = 0; r < reps; r++) {
        const bits = new Uint8Array(w * h);
        const rnd = VC.mulberry32(500 + r);
        for (let i = 0; i < bits.length; i++) bits[i] = rnd() < 0.5 ? 1 : 0;
        const [a, b] = VC.twoSheets(bits, VC.seededKey(w * h, 900 + r));
        const res = Leak.analyse(VC, a, b, w, h, dx, dy, { bits, p: 0.5 });
        assert.equal(res.impossible, 0);
        info += res.infoBits;
        right += res.accuracy * res.cells;
        cells += res.cells;
      }
      memo[`${dx},${dy}`] = { label, info: info / cells, acc: right / cells };
    }
    return memo;
  };
})();

test('misregistration: the full overlay of a slipped pair still carries about half of a random message', () => {
  const r = slipped();
  for (const v of Object.values(r)) console.log(`  ${v.label.padEnd(64)} ${v.info.toFixed(3)} bits per cell of 1; best guess right ${(v.acc * 100).toFixed(1)}%`);
  for (const k of ['1,0', '0,1']) {
    assert.ok(r[k].info > 0.48 && r[k].info < 0.54, `one subpixel ${k}: ${r[k].info}`);
    assert.ok(r[k].acc > 0.77 && r[k].acc < 0.82, `one subpixel ${k}: accuracy ${r[k].acc}`);
  }
  for (const k of ['2,0', '0,2']) {
    assert.ok(r[k].info > 0.52 && r[k].info < 0.58, `one cell ${k}: ${r[k].info}`);
    assert.ok(r[k].acc > 0.71 && r[k].acc < 0.77, `one cell ${k}: accuracy ${r[k].acc}`);
  }
  // The scattered layout: whole cells, short chains, and only sheet A's frame counted (B's
  // overhang, which a photo of the table would also show, is left out), so this is a floor.
  assert.ok(r['14,12'].info > 0.47, `scattered: ${r['14,12'].info}`);
  assert.ok(r['14,12'].acc > 0.68, `scattered: accuracy ${r['14,12'].acc}`);
  // A sparse message, like lettering (13% black cells), loses a similar or larger share of its entropy.
  for (const [dx, lo, hi] of [[1, 0.48, 0.57], [2, 0.54, 0.64]]) {
    const w = 2000;
    const h = 20;
    const rnd = VC.mulberry32(77);
    const bits = Uint8Array.from({ length: w * h }, () => (rnd() < 0.134 ? 1 : 0));
    const [a, b] = VC.twoSheets(bits, VC.seededKey(w * h, 99));
    const res = Leak.analyse(VC, a, b, w, h, dx, 0, { bits, p: 0.134 });
    const share = res.infoPerCell / res.entropyPerCell;
    console.log(`  sparse message (13% black), slip ${dx},0: ${res.infoPerCell.toFixed(3)} of ${res.entropyPerCell.toFixed(3)} bits per cell (${(share * 100).toFixed(1)}%)`);
    assert.ok(share > lo && share < hi, `sparse share at ${dx},0: ${share}`);
  }
});

test('misregistration: a diagonal one-subpixel slip still carries at least 0.43 bits per cell', () => {
  // (1,1) couples four cells, so it is not a chain. First pin the geometry: each overlay cell is its
  // own A plus one subpixel from each of four B cells.
  const w = 30;
  const h = 20;
  const rnd = VC.mulberry32(4);
  const bits = Uint8Array.from({ length: w * h }, () => (rnd() < 0.5 ? 1 : 0));
  const [A, B] = VC.twoSheets(bits, VC.seededKey(w * h, 6));
  const obs = Leak.cellPatterns(VC.overlay([VC.rasterize(A, w, h), VC.rasterize(B, w, h)], [[0, 0], [1, 1]], w, h), w, h);
  const Bat = (x, y) => (x < 0 || y < 0 ? 0 : B[y * w + x]);
  const rule = (a, bUL, bU, bL, bHere) => a | ((bUL >> 3) & 1) | (((bU >> 2) & 1) << 1) | (((bL >> 1) & 1) << 2) | ((bHere & 1) << 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    assert.equal(obs[y * w + x], rule(A[y * w + x], Bat(x - 1, y - 1), Bat(x, y - 1), Bat(x - 1, y), Bat(x, y)), `cell ${x},${y}`);
  }
  // Then enumerate exactly: the four overlay cells c, right, down, down-right hold all of A(c) and
  // B(c). Their states (key and message bit, 12 each) are enumerated; the five B cells around them
  // whose A is not in the window are uniform two-of-four patterns whatever their message (single-
  // sheet secrecy); three of them show one subpixel each (a fair bit), two show two subpixels.
  const joint = [new Float64Array(65536), new Float64Array(65536)];
  const pairOf = TWO; // B(0,-1) and B(-1,0): uniform over the six patterns
  for (let c = 0; c < 12; c++) for (let rr = 0; rr < 12; rr++) for (let d = 0; d < 12; d++) for (let rd = 0; rd < 12; rd++) {
    const [Ac, Bc] = VC.cellTwo(c & 1, c >> 1);
    const [Ar, Br] = VC.cellTwo(rr & 1, rr >> 1);
    const [Ad, Bd] = VC.cellTwo(d & 1, d >> 1);
    const [Ard, Brd] = VC.cellTwo(rd & 1, rd >> 1);
    const wInner = 0.5 ** 4 / 6 ** 4;
    for (const P1 of pairOf) for (const P2 of pairOf) for (let u = 0; u < 8; u++) {
      const u1 = (u & 1) << 3; // B(-1,-1): its BR subpixel
      const u2 = ((u >> 1) & 1) << 2; // B(1,-1): its BL subpixel
      const u3 = ((u >> 2) & 1) << 1; // B(-1,1): its TR subpixel
      const oc = rule(Ac, u1, P1, P2, Bc);
      const or = rule(Ar, P1 & 8 ? 8 : 0, u2, Bc, Br);
      const od = rule(Ad, P2 & 8 ? 8 : 0, Bc, u3, Bd);
      const ord = rule(Ard, Bc, Br, Bd, Brd);
      joint[c & 1][oc | (or << 4) | (od << 8) | (ord << 12)] += wInner / 36 / 8;
    }
  }
  let mi = 0;
  for (let o = 0; o < 65536; o++) {
    const po = joint[0][o] + joint[1][o];
    for (const m of [0, 1]) if (joint[m][o] > 0) mi += joint[m][o] * Math.log2(joint[m][o] / (0.5 * po));
  }
  console.log(`  diagonal one-subpixel slip: four-cell window carries ${mi.toFixed(4)} bits per cell (a lower bound)`);
  assert.ok(Math.abs(mi - 0.4316) < 5e-4, `diagonal window: ${mi}`);
  slipped().diag = { info: mi };
});

test('the README and the page quote the measured misregistration figures, and not the old ones', () => {
  const r = slipped();
  // (the Revision note at the end quotes the old claims on purpose, so it is left out)
  const readme = fs.readFileSync(path.join(HERE, 'README.md'), 'utf8').split('## Revision note')[0];
  const page = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8');
  const sub = ((r['1,0'].info + r['0,1'].info) / 2).toFixed(2);
  const cell = ((r['2,0'].info + r['0,2'].info) / 2).toFixed(2);
  const subAcc = `${Math.round(((r['1,0'].acc + r['0,1'].acc) / 2) * 100)}%`;
  const cellAcc = `${Math.round(((r['2,0'].acc + r['0,2'].acc) / 2) * 100)}%`;
  const scattered = (Math.floor(r['14,12'].info * 100) / 100).toFixed(2);
  const diag = (Math.floor((r.diag ? r.diag.info : 0.4316) * 100) / 100).toFixed(2);
  for (const [name, text] of [['README.md', readme], ['index.html', page]]) {
    for (const want of [`${sub} bits`, `${cell} bits`, `at least ${diag}`, `at least ${scattered}`, subAcc, cellAcc]) {
      assert.ok(text.includes(want), `${name} should say "${want}"`);
    }
    for (const gone of ['no measurable information', 'Nothing to read', 'about 3% of the mutual information survives', 'gone again']) {
      assert.ok(!text.includes(gone), `${name} still says "${gone}"`);
    }
  }
});

test('plug-in bias: the stated noise floor matches simulation in two-sheet and two-pictures modes', () => {
  // The page prints the bias of its plug-in estimates next to them. Draw many fresh keys for one
  // message and check that the mean estimate (whose true value is zero) is that bias.
  const w = 100;
  const h = 40;
  const n = w * h;
  const secret = new Uint8Array(n);
  const cA = new Uint8Array(n);
  const cB = new Uint8Array(n);
  const rnd = VC.mulberry32(5);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    secret[i] = (x - 50) ** 2 + (y - 20) ** 2 < 14 ** 2 ? 1 : 0;
    cA[i] = (x >> 3) % 3 === 0 && y > 6 && y < 34 ? 1 : 0;
    cB[i] = rnd() < 0.3 ? 1 : 0;
  }
  const reps = 160;
  const cover = [0, 0];
  let two = 0;
  for (let r = 0; r < reps; r++) {
    const key = VC.seededKey(n, 3000 + r);
    const sheets = VC.coverSheets(secret, cA, cB, key);
    [cA, cB].forEach((cov, i) => {
      const joint = new Uint16Array(n);
      for (let t = 0; t < n; t++) joint[t] = sheets[i][t] + 16 * cov[t];
      cover[i] += (VC.mutualInformation(secret, joint).bits - VC.mutualInformation(secret, cov).bits) / reps;
    });
    two += VC.mutualInformation(secret, VC.twoSheets(secret, key)[0]).bits / reps;
  }
  const sheetsNow = VC.coverSheets(secret, cA, cB, VC.seededKey(n, 1));
  const biasCover = [0, 1].map((i) => VC.plugInBias(secret, sheetsNow[i], [cA, cB][i]));
  const biasTwo = VC.plugInBias(secret, VC.twoSheets(secret, VC.seededKey(n, 1))[0]);
  console.log(`  two pictures: simulated ${cover.map((v) => v.toFixed(5)).join(', ')}, stated ${biasCover.map((v) => v.toFixed(5)).join(', ')} (the old formula said ${(18 / (2 * n * Math.LN2)).toFixed(5)})`);
  console.log(`  two sheets:   simulated ${two.toFixed(5)}, stated ${biasTwo.toFixed(5)}`);
  for (const i of [0, 1]) {
    assert.ok(Math.abs(biasCover[i] - 8 / (2 * n * Math.LN2)) < 1e-12, '(2-1)(6-1) + (2-1)(4-1) = 8 degrees of freedom');
    assert.ok(Math.abs(cover[i] - biasCover[i]) < 0.0003, `cover sheet ${i}: simulated ${cover[i]} vs stated ${biasCover[i]}`);
  }
  assert.ok(Math.abs(two - biasTwo) < 0.0003, `two sheets: simulated ${two} vs stated ${biasTwo}`);
});

test('key reuse: why the page draws a fresh key when the scheme changes and after printing', () => {
  // Exact, per cell, over all 144 keys and a 50/50 message bit: two non-key sheets made from ONE
  // key for the SAME message, in two schemes or under two cover pictures, give the message away.
  function mi(obsOf) {
    const joint = new Map();
    const po = new Map();
    for (const m of [0, 1]) for (let k = 0; k < KEY_RANGE; k++) {
      const o = obsOf(m, k);
      joint.set(`${m}|${o}`, (joint.get(`${m}|${o}`) || 0) + 0.5 / KEY_RANGE);
      po.set(o, (po.get(o) || 0) + 0.5 / KEY_RANGE);
    }
    let s = 0;
    for (const [key, v] of joint) s += v * Math.log2(v / (0.5 * po.get(key.split('|')[1])));
    return s;
  }
  const twoThenThree = mi((m, k) => `${VC.cellTwo(m, k)[1]},${VC.cellThree(m, k)[1]}`);
  const coverBEdited = mi((m, k) => `${VC.cellCover(m, 1, 0, k)[1]},${VC.cellCover(m, 1, 1, k)[1]}`);
  const coverAEdited = mi((m, k) => `${VC.cellCover(m, 0, 1, k)[1]},${VC.cellCover(m, 1, 1, k)[1]}`);
  console.log(`  same message, same key: B(two sheets)+B(three sheets) ${twoThenThree.toFixed(3)} bits; B before/after editing cover B (cover A black) ${coverBEdited.toFixed(3)}; B before/after editing cover A ${coverAEdited.toFixed(3)}`);
  assert.ok(twoThenThree > 0.5);
  assert.ok(Math.abs(coverBEdited - 1) < 1e-12);
  assert.ok(coverAEdited > 0.05);
  // ...while one B sheet alone, in any scheme, says nothing (checked exhaustively above).
});

test('three sheets: any two read back the picture exactly; one sheet carries nothing measurable', () => {
  const key = VC.seededKey(W * H, 5);
  const bits = picture('disc');
  const sheets = VC.threeSheets(bits, key);
  const rasters = sheets.map((s) => VC.rasterize(s, W, H));
  for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) {
    const counts = VC.cellCounts(VC.overlay([rasters[i], rasters[j]], [[0, 0], [0, 0]], W, H), W, H);
    assert.ok(sameBits(VC.decode(counts, 2), bits), `pair ${i},${j}`);
  }
  const all = VC.cellCounts(VC.overlay(rasters, [[0, 0], [0, 0], [0, 0]], W, H), W, H);
  assert.ok(sameBits(VC.decode(all, 2), bits), 'all three together also read');
  for (const s of sheets) assert.ok(VC.mutualInformation(bits, s).bits < 0.005);
  // Sheet A is a function of the key alone.
  const other = VC.threeSheets(picture('bars'), key);
  assert.ok(sameBits(sheets[0], other[0]));
});

test('cover sheets: the overlay reads the secret; sheet A ignores the secret and cover B', () => {
  const key = VC.seededKey(W * H, 9);
  const secret = picture('disc');
  const coverA = picture('bars');
  const coverB = randomPicture(77, 0.3);
  const [a, b] = VC.coverSheets(secret, coverA, coverB, key);
  // Each sheet "is" its cover: 3 black subpixels where the cover is black, 2 where white.
  for (let i = 0; i < a.length; i++) {
    assert.equal(popcount(a[i]), coverA[i] ? 3 : 2);
    assert.equal(popcount(b[i]), coverB[i] ? 3 : 2);
  }
  const counts = VC.cellCounts(VC.overlay([VC.rasterize(a, W, H), VC.rasterize(b, W, H)], [[0, 0], [0, 0]], W, H), W, H);
  assert.ok(sameBits(VC.decode(counts, 4), secret));
  const [a2] = VC.coverSheets(picture('full'), coverA, picture('blank'), key);
  assert.ok(sameBits(a, a2), 'sheet A is the same for a different secret and a different cover B');
  // A sheet is supposed to show its cover, and a cover may be correlated with the secret (here
  // the bars cross the disc), so the honest measure is conditional: how much does the sheet say
  // about the secret beyond what its own cover already says? MI(secret; sheet, cover) must not
  // exceed MI(secret; cover) by more than estimation noise.
  for (const [sheet, cover, name] of [[a, coverA, 'A'], [b, coverB, 'B']]) {
    const withCover = new Uint8Array(sheet.length);
    for (let i = 0; i < sheet.length; i++) withCover[i] = sheet[i] + 16 * cover[i];
    const mi = VC.mutualInformation(secret, withCover).bits;
    const miCoverOnly = VC.mutualInformation(secret, cover).bits;
    assert.ok(mi - miCoverOnly < 0.01, `sheet ${name}: MI(secret; sheet, cover) - MI(secret; cover) = ${mi - miCoverOnly}`);
    console.log(`  sheet ${name}: MI beyond its cover ${(mi - miCoverOnly).toFixed(5)} bits`);
  }
});

test('fingerprint and sameMasks behave', () => {
  const a = new Uint8Array([1, 2, 3, 4]);
  const b = new Uint8Array([1, 2, 3, 4]);
  const c = new Uint8Array([1, 2, 3, 5]);
  assert.equal(VC.fingerprint(a), VC.fingerprint(b));
  assert.notEqual(VC.fingerprint(a), VC.fingerprint(c));
  assert.match(VC.fingerprint(a), /^[0-9a-f]{16}$/);
  assert.ok(VC.sameMasks(a, b));
  assert.ok(!VC.sameMasks(a, c));
  assert.ok(!VC.sameMasks(a, new Uint8Array(3)));
});

test('sheet functions refuse a key shorter than the picture', () => {
  assert.throws(() => VC.twoSheets(new Uint8Array(10), new Uint8Array(9)));
  assert.throws(() => VC.threeSheets(new Uint8Array(10), new Uint8Array(9)));
  assert.throws(() => VC.coverSheets(new Uint8Array(10), new Uint8Array(10), new Uint8Array(10), new Uint8Array(9)));
});
