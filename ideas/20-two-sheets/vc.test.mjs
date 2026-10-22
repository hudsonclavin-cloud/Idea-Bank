// Tests for vc.js. Run from the repo root: node --test ideas/20-two-sheets/vc.test.mjs
//
// The secrecy claims are checked EXHAUSTIVELY at the cell level: every scheme consumes one key
// value in [0, 144) per cell, so for each possible secret input we enumerate all 144 keys and
// compare the resulting distribution of patterns on each sheet. "Secure" means: the histogram of
// patterns on a sheet is the same for every value of the secret (and, for the cover scheme, the
// same for every value of the other sheet's cover). The whole-picture tests then check that the
// sheet functions are the cell functions applied cell by cell, that laying the sheets together
// reads back the exact picture, and that a misregistered overlay does not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const VC = require('./vc.js');
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

test('two sheets: misregistration by one subpixel (or one cell) does not read', () => {
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
      else if (dx >= 2 || dy >= 2) assert.ok(mi < 0.01, `one whole cell off: MI ${mi}`);
    }
  }
  // The pictures are mostly white, so "accuracy" is dominated by the white background; mutual
  // information is the honest measure. A one-subpixel shift leaves a little, a one-cell shift none.
  for (const [k, v] of Object.entries(results)) console.log(`  ${k.padEnd(10)} accuracy ${(v.acc * 100).toFixed(1)}%  MI ${v.mi.toFixed(4)} bits`);
  assert.ok(results['disc 1,0'].mi < 0.25 * results['disc 0,0'].mi);
  assert.ok(results['bars 1,0'].mi < 0.25 * results['bars 0,0'].mi);
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
