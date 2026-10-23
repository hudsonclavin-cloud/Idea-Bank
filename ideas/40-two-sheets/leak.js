// leak.js — what a MISALIGNED pair of two-sheet (Naor–Shamir 2,2) sheets still says about the message.
//
// Loads as a classic <script> (defines window.Leak) and as a CommonJS module. It needs vc.js.
//
// The eye reads a stack by averaging how many black subpixels each cell has, and once the sheets
// slip that count says little (one subpixel) or nothing (a whole cell). A camera and a computer
// see every subpixel. This module measures what they get. Model: message cells are independent
// coin flips, black with probability p; key cells are uniform. For a slip where every overlay cell
// depends only on the sheets' cells c and c − s for one fixed step s, the cells fall into
// independent chains, and the forward algorithm gives the exact probability of the whole observed
// overlay, with and without knowing the message. Averaged over messages and keys,
// log2 P(O | M) − log2 P(O) is the mutual information I(M; O), so on random messages its mean per
// cell is an unbiased estimate of it. Forward–backward gives each cell's posterior
// P(black | the whole overlay), and so the best possible guess for each cell.
//
// Chain slips: one subpixel sideways or up/down, (±1, 0) and (0, ±1), and every whole-cell slip
// (2a, 2b), which includes the page's scattered layout. A diagonal one-subpixel slip couples four
// cells, so it is not a chain; vc.test.mjs bounds it from below by exact enumeration instead.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  root.Leak = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const NS = 12; // hidden states of one cell: s = 2 * i + m, sheet A = TWO[i], message bit m

  function h2(p) {
    return p <= 0 || p >= 1 ? 0 : -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
  }

  // The 2×2 pattern (4-bit mask, same bit order as vc.js) of every cell of a subpixel raster.
  function cellPatterns(raster, W, H) {
    const sw = 2 * W;
    const out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const o = 2 * y * sw + 2 * x;
        out[y * W + x] = raster[o] | (raster[o + 1] << 1) | (raster[o + sw] << 2) | (raster[o + sw + 1] << 3);
      }
    }
    return out;
  }

  // The chain step s for a slip of sheet B by (dx, dy) subpixels, or null if the slip is not a chain.
  function chainStep(dx, dy) {
    if (dy === 0 && Math.abs(dx) === 1) return [dx, 0];
    if (dx === 0 && Math.abs(dy) === 1) return [0, dy];
    if (dx % 2 === 0 && dy % 2 === 0 && (dx !== 0 || dy !== 0)) return [dx / 2, dy / 2];
    return null;
  }

  // E[(sp + 1) * NS + sc] = the overlay pattern of a cell in state sc whose chain predecessor is in
  // state sp (sp = -1: no predecessor, it is off the sheet). Built with vc.js's own cellTwo,
  // rasterize and overlay on a two-cell patch, so the model is the module's geometry, not a copy.
  const cache = new Map();
  function emissions(VC, dx, dy) {
    const hit = cache.get(`${dx},${dy}`);
    if (hit && hit.VC === VC) return hit;
    const step = chainStep(dx, dy);
    if (!step) throw new Error(`a slip of (${dx}, ${dy}) subpixels is not a chain slip`);
    const [sx, sy] = step;
    const Wp = Math.abs(sx) + 1;
    const Hp = Math.abs(sy) + 1;
    const cx = sx > 0 ? sx : 0;
    const cy = sy > 0 ? sy : 0;
    const prev = (cy - sy) * Wp + (cx - sx);
    const cur = cy * Wp + cx;
    const E = new Int8Array((NS + 1) * NS);
    for (let sp = -1; sp < NS; sp++) {
      for (let sc = 0; sc < NS; sc++) {
        const A = new Uint8Array(Wp * Hp);
        const B = new Uint8Array(Wp * Hp);
        if (sp >= 0) [A[prev], B[prev]] = VC.cellTwo(sp & 1, sp >> 1);
        [A[cur], B[cur]] = VC.cellTwo(sc & 1, sc >> 1);
        const over = VC.overlay([VC.rasterize(A, Wp, Hp), VC.rasterize(B, Wp, Hp)], [[0, 0], [dx, dy]], Wp, Hp);
        E[(sp + 1) * NS + sc] = cellPatterns(over, Wp, Hp)[cur];
      }
    }
    const out = { E, step, VC };
    cache.set(`${dx},${dy}`, out);
    return out;
  }

  // Analyse an observed overlay: obs[i] is the 2×2 pattern of cell i, with sheet B slipped by
  // (dx, dy) relative to sheet A and cropped to A's frame, as VC.overlay does.
  // Options: p (prior P(black), default 0.5) and bits (the true message, to score against).
  function analyseObserved(VC, obs, W, H, dx, dy, opts = {}) {
    const p = opts.p === undefined ? 0.5 : opts.p;
    const bits = opts.bits || null;
    const { E, step } = emissions(VC, dx, dy);
    const [sx, sy] = step;
    const prior = new Float64Array(NS);
    for (let s = 0; s < NS; s++) prior[s] = (s & 1 ? p : 1 - p) / 6;
    const posterior = new Float64Array(W * H).fill(0.5);
    let logP = 0;
    let logPgivenM = 0;
    let impossible = 0;

    // forward pass along one chain; restrictTo = message bits (conditional) or null (marginal)
    function forward(chain, restrictTo, keep) {
      let alpha = null;
      let logp = 0;
      const alphas = keep ? [] : null;
      for (let t = 0; t < chain.length; t++) {
        const o = obs[chain[t]];
        const next = new Float64Array(NS);
        let z = 0;
        for (let s = 0; s < NS; s++) {
          let pr;
          if (restrictTo) pr = (s & 1) === restrictTo[chain[t]] ? 1 / 6 : 0;
          else pr = prior[s];
          if (!pr) continue;
          let sum = 0;
          if (t === 0) sum = E[s] === o ? 1 : 0;
          else for (let q = 0; q < NS; q++) if (alpha[q] && E[(q + 1) * NS + s] === o) sum += alpha[q];
          next[s] = pr * sum;
          z += next[s];
        }
        if (z === 0) return { logp: -Infinity, alphas: null };
        for (let s = 0; s < NS; s++) next[s] /= z;
        logp += Math.log2(z);
        alpha = next;
        if (keep) alphas.push(next);
      }
      return { logp, alphas };
    }

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const px = x - sx;
        const py = y - sy;
        if (px >= 0 && px < W && py >= 0 && py < H) continue; // not the start of a chain
        const chain = [];
        for (let cx = x, cy = y; cx >= 0 && cx < W && cy >= 0 && cy < H; cx += sx, cy += sy) chain.push(cy * W + cx);
        const f = forward(chain, null, true);
        if (!Number.isFinite(f.logp)) { impossible += chain.length; continue; }
        logP += f.logp;
        if (bits) logPgivenM += forward(chain, bits, false).logp;
        // backward pass, then each cell's posterior
        let beta = new Float64Array(NS).fill(1);
        for (let t = chain.length - 1; t >= 0; t--) {
          const a = f.alphas[t];
          let num = 0;
          let den = 0;
          for (let s = 0; s < NS; s++) {
            const v = a[s] * beta[s];
            den += v;
            if (s & 1) num += v;
          }
          posterior[chain[t]] = den > 0 ? num / den : 0.5;
          if (t === 0) break;
          const o = obs[chain[t]];
          const prevBeta = new Float64Array(NS);
          let z = 0;
          for (let q = 0; q < NS; q++) {
            let sum = 0;
            for (let s = 0; s < NS; s++) if (E[(q + 1) * NS + s] === o) sum += prior[s] * beta[s];
            prevBeta[q] = sum;
            z += sum;
          }
          for (let q = 0; q < NS; q++) prevBeta[q] /= z || 1;
          beta = prevBeta;
        }
      }
    }

    const n = W * H;
    const decoded = new Uint8Array(n);
    for (let i = 0; i < n; i++) decoded[i] = posterior[i] > 0.5 ? 1 : 0;
    const out = { cells: n, impossible, posterior, decoded, logP, entropyPerCell: h2(p) };
    if (bits) {
      let right = 0;
      for (let i = 0; i < n; i++) if (decoded[i] === bits[i]) right++;
      out.accuracy = right / n;
      out.infoBits = logPgivenM - logP; // log2 P(O | M) − log2 P(O): this message's information density
      out.infoPerCell = out.infoBits / n;
    }
    return out;
  }

  // Lay sheet B over sheet A slipped by (dx, dy) and analyse the result.
  function analyse(VC, sheetA, sheetB, W, H, dx, dy, opts = {}) {
    const over = VC.overlay([VC.rasterize(sheetA, W, H), VC.rasterize(sheetB, W, H)], [[0, 0], [dx, dy]], W, H);
    return analyseObserved(VC, cellPatterns(over, W, H), W, H, dx, dy, opts);
  }

  // Exact I(m(c); X) for one overlay cell c in the middle of a chain, where X is either the cell's
  // full 2×2 pattern or only its black-subpixel count (what the eye averages). Enumerates the
  // states of c and its predecessor under the same prior.
  function oneCellInformation(VC, dx, dy, p = 0.5) {
    const { E } = emissions(VC, dx, dy);
    const prior = (s) => (s & 1 ? p : 1 - p) / 6;
    const pattern = new Map();
    const count = new Map();
    const add = (map, key, v) => map.set(key, (map.get(key) || 0) + v);
    const meanCount = [0, 0];
    for (let sp = 0; sp < NS; sp++) {
      for (let sc = 0; sc < NS; sc++) {
        const pr = prior(sp) * prior(sc);
        const o = E[(sp + 1) * NS + sc];
        const m = sc & 1;
        add(pattern, `${m}|${o}`, pr);
        add(count, `${m}|${VC.popcount(o)}`, pr);
        meanCount[m] += (pr * VC.popcount(o)) / (m ? p : 1 - p);
      }
    }
    const mi = (joint) => {
      const pm = new Map();
      const px = new Map();
      for (const [k, v] of joint) {
        const [m, x] = k.split('|');
        add(pm, m, v);
        add(px, x, v);
      }
      let s = 0;
      for (const [k, v] of joint) {
        const [m, x] = k.split('|');
        if (v > 0) s += v * Math.log2(v / (pm.get(m) * px.get(x)));
      }
      return Math.max(0, s);
    };
    return { pattern: mi(pattern), count: mi(count), meanCountWhite: meanCount[0], meanCountBlack: meanCount[1], entropy: h2(p) };
  }

  return { NS, h2, cellPatterns, chainStep, emissions, analyseObserved, analyse, oneCellInformation };
});
