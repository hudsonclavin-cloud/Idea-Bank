// vc.js — visual cryptography, pure logic, no DOM.
//
// Loads as a classic <script> (defines window.VC) and as a CommonJS module (module.exports),
// so the page and the Node tests share exactly the same code.
//
// Geometry. A "cell" is one pixel of the secret picture. Each cell is printed as a 2×2 block of
// subpixels, encoded as a 4-bit mask: bit 0 = top-left, bit 1 = top-right, bit 2 = bottom-left,
// bit 3 = bottom-right. A set bit is black ink; a clear bit is clear film.
//
// Key. Every scheme here consumes one key value per cell, a uniform integer in [0, 144).
// 144 = 12 × 12, so k % 12 and floor(k / 12) are two independent uniform values in 0..11, and
// each of those is in turn uniform mod 2, 3, 4 and 6. That is all the randomness any cell needs.
//
// The security statement for each scheme (checked exhaustively in vc.test.mjs): the pattern printed
// on any single sheet has the same distribution whatever the secret bit is, so that sheet alone
// carries no information about the secret.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  root.VC = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const KEY_RANGE = 144;
  const TWO = [0b0011, 0b0101, 0b0110, 0b1001, 0b1010, 0b1100]; // every 2-of-4 pattern
  const THREE = [0b0111, 0b1011, 0b1101, 0b1110]; // every 3-of-4 pattern
  const ONE = [0b0001, 0b0010, 0b0100]; // 1-of-3 (bottom-right subpixel always clear)

  function popcount(m) {
    m &= 15;
    return (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);
  }
  function bitsOf(m) {
    const out = [];
    for (let i = 0; i < 4; i++) if (m & (1 << i)) out.push(i);
    return out;
  }

  // ---- randomness -------------------------------------------------------------------------

  // Mulberry32: a small seeded PRNG for tests and demos. Not for real keys.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Draw n key values uniform in [0, 144) by rejection sampling bytes from `fill`, a function
  // that fills a Uint8Array with uniformly random bytes (crypto.getRandomValues in a browser).
  // A byte ≥ 144 is thrown away rather than reduced, so there is no modulo bias.
  function randomKey(n, fill) {
    const key = new Uint8Array(n);
    const buf = new Uint8Array(Math.max(64, n * 2));
    let i = 0;
    while (i < n) {
      fill(buf);
      for (let j = 0; j < buf.length && i < n; j++) if (buf[j] < KEY_RANGE) key[i++] = buf[j];
    }
    return key;
  }

  function seededKey(n, seed) {
    const rnd = mulberry32(seed);
    return randomKey(n, (buf) => {
      for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(rnd() * 256);
    });
  }

  // ---- per-cell constructions -------------------------------------------------------------
  // Each takes the secret bit(s) for one cell and that cell's key value, and returns the mask
  // for every sheet. Exhaustively testable: 144 keys × a handful of inputs.

  // Naor–Shamir (2,2) with 2×2 subpixels. Sheet A is a random 2-of-4 pattern. Sheet B equals A
  // where the secret is white and is A's complement where the secret is black. Laid together:
  // white cells show 2 black subpixels, black cells show 4.
  function cellTwo(bit, k) {
    const a = TWO[k % 6];
    return [a, bit ? ~a & 15 : a];
  }

  // Naor–Shamir (2,3): three sheets, any two reveal, each sheet has one black subpixel in three
  // positions. White: all three sheets black the same position. Black: all three different.
  // Any pair laid together: white cells show 1 black subpixel, black cells show 2.
  function cellThree(bit, k) {
    const p = k % 3;
    const swap = ((k / 12) | 0) & 1;
    const A = ONE[p];
    if (!bit) return [A, A, A];
    const q = (p + 1 + swap) % 3;
    const r = (p + 2 - swap) % 3;
    return [A, ONE[q], ONE[r]];
  }

  // Extended (2,2): each sheet shows its own cover picture (a cover-white cell has 2 black
  // subpixels, a cover-black cell has 3), and the pair laid together shows the secret (secret-black
  // cells show 4 black subpixels; secret-white cells show 2 or 3, the covers' ghost).
  // Sheet A depends only on coverA and the key; sheet B's distribution depends only on coverB.
  function cellCover(bit, ca, cb, k) {
    const l = k % 12;
    const h = (k / 12) | 0;
    const A = ca ? THREE[l % 4] : TWO[l % 6];
    const t1 = ca ? 3 : 2;
    const t2 = cb ? 3 : 2;
    const inA = bitsOf(A);
    const outA = bitsOf(~A & 15);
    let B;
    if (!bit) {
      // white: keep the union as small as possible
      if (t1 === t2) B = A;
      else if (t2 === 3) B = A | (1 << outA[h % 2]); // A has 2; add one of the other two
      else B = A & ~(1 << inA[h % 3]); // A has 3; drop one of its three
    } else {
      // black: the union must be all four subpixels, so B covers A's complement
      const comp = ~A & 15;
      if (t1 === 2 && t2 === 2) B = comp;
      else if (t1 === 2 && t2 === 3) B = comp | (1 << inA[h % 2]);
      else if (t1 === 3 && t2 === 2) B = comp | (1 << inA[h % 3]);
      else B = 15 & ~(1 << inA[h % 3]); // t1 = t2 = 3: all four minus one of A's three
    }
    return [A, B];
  }

  // ---- whole sheets -----------------------------------------------------------------------

  function assertKey(bits, key) {
    if (!key || key.length < bits.length) throw new Error('key is shorter than the picture');
  }

  function twoSheets(bits, key) {
    assertKey(bits, key);
    const n = bits.length;
    const A = new Uint8Array(n);
    const B = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const [a, b] = cellTwo(bits[i] ? 1 : 0, key[i]);
      A[i] = a;
      B[i] = b;
    }
    return [A, B];
  }

  function threeSheets(bits, key) {
    assertKey(bits, key);
    const n = bits.length;
    const A = new Uint8Array(n);
    const B = new Uint8Array(n);
    const C = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const [a, b, c] = cellThree(bits[i] ? 1 : 0, key[i]);
      A[i] = a;
      B[i] = b;
      C[i] = c;
    }
    return [A, B, C];
  }

  function coverSheets(bits, coverA, coverB, key) {
    assertKey(bits, key);
    const n = bits.length;
    const A = new Uint8Array(n);
    const B = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const [a, b] = cellCover(bits[i] ? 1 : 0, coverA[i] ? 1 : 0, coverB[i] ? 1 : 0, key[i]);
      A[i] = a;
      B[i] = b;
    }
    return [A, B];
  }

  // ---- geometry: masks → subpixel rasters, laying sheets over each other, reading them -----

  // Subpixel raster of a sheet: width 2W, height 2H, 1 = black.
  function rasterize(masks, W, H) {
    const sw = 2 * W;
    const out = new Uint8Array(4 * W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const m = masks[y * W + x];
        const o = 2 * y * sw + 2 * x;
        out[o] = m & 1;
        out[o + 1] = (m >> 1) & 1;
        out[o + sw] = (m >> 2) & 1;
        out[o + sw + 1] = (m >> 3) & 1;
      }
    }
    return out;
  }

  // Lay rasters over each other; rasters[i] is shifted by offsets[i] = [dx, dy] subpixels.
  // Ink is ink: a subpixel is black if any sheet is black there. Off-sheet is clear.
  function overlay(rasters, offsets, W, H) {
    const sw = 2 * W;
    const sh = 2 * H;
    const out = new Uint8Array(sw * sh);
    rasters.forEach((r, i) => {
      const [dx, dy] = offsets[i] || [0, 0];
      for (let y = 0; y < sh; y++) {
        const sy = y - dy;
        if (sy < 0 || sy >= sh) continue;
        for (let x = 0; x < sw; x++) {
          const sx = x - dx;
          if (sx < 0 || sx >= sw) continue;
          if (r[sy * sw + sx]) out[y * sw + x] = 1;
        }
      }
    });
    return out;
  }

  // Black subpixels per cell of a raster.
  function cellCounts(raster, W, H) {
    const sw = 2 * W;
    const out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const o = 2 * y * sw + 2 * x;
        out[y * W + x] = raster[o] + raster[o + 1] + raster[o + sw] + raster[o + sw + 1];
      }
    }
    return out;
  }

  // Read a laid-together picture: a cell is black if it has at least `threshold` black subpixels.
  function decode(counts, threshold) {
    const out = new Uint8Array(counts.length);
    for (let i = 0; i < counts.length; i++) out[i] = counts[i] >= threshold ? 1 : 0;
    return out;
  }

  // Overlay masks directly (all sheets aligned): bitwise OR per cell.
  function orMasks(sheets) {
    const n = sheets[0].length;
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      let m = 0;
      for (const s of sheets) m |= s[i];
      out[i] = m;
    }
    return out;
  }

  // ---- evidence ---------------------------------------------------------------------------

  // How many cells carry each of the 16 possible patterns.
  function histogram(masks) {
    const h = new Array(16).fill(0);
    for (let i = 0; i < masks.length; i++) h[masks[i] & 15]++;
    return h;
  }

  // Plug-in estimate of the mutual information, in bits, between two integer sequences.
  function mutualInformation(xs, ys) {
    const n = xs.length;
    const joint = new Map();
    const px = new Map();
    const py = new Map();
    for (let i = 0; i < n; i++) {
      const k = xs[i] * 65536 + ys[i];
      joint.set(k, (joint.get(k) || 0) + 1);
      px.set(xs[i], (px.get(xs[i]) || 0) + 1);
      py.set(ys[i], (py.get(ys[i]) || 0) + 1);
    }
    let mi = 0;
    for (const [k, c] of joint) {
      const x = Math.floor(k / 65536);
      const y = k % 65536;
      const p = c / n;
      mi += p * Math.log2(p / ((px.get(x) / n) * (py.get(y) / n)));
    }
    return { bits: mi, xStates: px.size, yStates: py.size, n };
  }

  // 64-bit FNV-1a style fingerprint of a sheet, as 16 hex digits. For "did this sheet change?",
  // not for security.
  function fingerprint(masks) {
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193 ^ 0x5bd1e995;
    for (let i = 0; i < masks.length; i++) {
      h1 = Math.imul(h1 ^ masks[i], 0x01000193) >>> 0;
      h2 = Math.imul(h2 ^ (masks[i] + i), 0x01000193) >>> 0;
    }
    return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
  }

  function sameMasks(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  return {
    KEY_RANGE,
    TWO,
    THREE,
    ONE,
    popcount,
    bitsOf,
    mulberry32,
    randomKey,
    seededKey,
    cellTwo,
    cellThree,
    cellCover,
    twoSheets,
    threeSheets,
    coverSheets,
    rasterize,
    overlay,
    cellCounts,
    decode,
    orMasks,
    histogram,
    mutualInformation,
    fingerprint,
    sameMasks,
  };
});
