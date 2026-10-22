/* Unconformity — the plate. Rasterises a history onto paper in three stages, each chunked so the
   page never freezes:
     1. geology  — every pixel walks the history backwards (geology.js) -> unit id + ink + bake
     2. wash     — watercolour rims: a blurred map of where tints meet
     3. tint     — paper texture, misregistered washes glazed over it, then ink on top
   then inks the frame, the skyline's trees and the caption with ordinary canvas strokes. */
(function (G) {
  'use strict';
  const UNC = G.UNC;
  const { GEOM, hash2, vnoise2, landZ, evaluate, OUT } = UNC;
  const MARGIN = 0xffff;

  function makeJob(H, colours, W, opts) {
    opts = opts || {};
    const Hp = Math.round(W * (GEOM.ph / GEOM.pw));
    const canvas = opts.canvas || document.createElement('canvas');
    canvas.width = W;
    canvas.height = Hp;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(W, Hp);
    const px = img.data;

    const ix0 = Math.round(GEOM.ml * W), ix1 = Math.round((GEOM.pw - GEOM.mr) * W);
    const iy0 = Math.round(GEOM.mt * W), iy1 = Math.round((GEOM.ph - GEOM.mb) * W);
    const iw = ix1 - ix0;
    const ps = 1 / iw;
    const hw = (world, min) => Math.max(min, (world * iw) / 2);
    const R = {
      ps,
      hwLand: hw(0.0018, 0.68), hwUnc: hw(0.0016, 0.62), hwFault: hw(0.0015, 0.6), hwIgn: hw(0.0012, 0.52),
      hwBed: hw(0.00072, 0.36), hwPat: hw(0.00066, 0.34), minDot: Math.max(0.55, 0.0005 * iw),
      patA: 0.6, bedA: 0.5,
    };

    const N = W * Hp;
    const label = new Uint16Array(N);
    const inkB = new Uint8Array(N);
    const modB = new Uint8Array(N);
    const Scol = new Float64Array(iw);
    const Spcol = new Float64Array(iw);
    for (let i = 0; i < iw; i++) {
      const X = (i + 0.5) * ps;
      Scol[i] = landZ(H, X);
      const h = 0.0015;
      Spcol[i] = (landZ(H, X + h) - landZ(H, X - h)) / (2 * h);
    }

    const pal = colours.pal;
    const T = colours.T, A = colours.A;
    const paper = pal.paper, inkC = pal.ink;
    const skyRgb = pal.sky ? UNC.hexToRgb(pal.sky) : null;

    // ---- stage 1: geology, rows from the bottom up (the rock accumulates like sediment) ----
    let row = Hp - 1;
    function evalRow(y) {
      const o = y * W;
      if (y < iy0 || y >= iy1) {
        for (let x = 0; x < W; x++) label[o + x] = MARGIN;
        return;
      }
      const Z = GEOM.zTop - (y - iy0 + 0.5) * ps;
      for (let x = 0; x < W; x++) {
        if (x < ix0 || x >= ix1) {
          label[o + x] = MARGIN;
          continue;
        }
        const c = x - ix0;
        const u = evaluate(H, R, (c + 0.5) * ps, Z, Scol[c], Spcol[c], null);
        label[o + x] = u;
        inkB[o + x] = (OUT.ink * 255 + 0.5) | 0;
        modB[o + x] = OUT.mod;
      }
    }

    // ---- stage 2: watercolour rims ----
    const rimR = Math.max(1, Math.round(0.0026 * iw));
    // rim buffers are stored as bytes (0..255) to keep a print-size export near 70 MB
    const tmp = new Uint8Array(N);
    const rim = new Uint8Array(N);
    function edgeRowBlur(y) {
      // edge mask of this row, horizontally box-blurred into tmp
      const o = y * W;
      const win = 2 * rimR + 1;
      let sum = 0;
      const edge = (x) => {
        if (x < 0 || x >= W) return 0;
        const i = o + x;
        const l = label[i];
        if (l === MARGIN) return 0;
        if (x + 1 < W && label[i + 1] !== l && label[i + 1] !== MARGIN) return 1;
        if (y + 1 < Hp && label[i + W] !== l && label[i + W] !== MARGIN) return 1;
        return 0;
      };
      const e = new Uint8Array(W + 2 * rimR + 2);
      for (let x = -rimR - 1; x <= W + rimR; x++) e[x + rimR + 1] = x >= 0 && x < W ? edge(x) : 0;
      // also mark the left/up neighbours so rims are symmetric
      for (let x = W - 1; x >= 0; x--) if (e[x + rimR + 1] && x + 1 < W) e[x + rimR + 2] = 1;
      // e[x + rimR + 1] holds pixel x; the window for pixel x is [x - rimR, x + rimR]
      for (let k = 1; k <= win; k++) sum += e[k];
      for (let x = 0; x < W; x++) {
        tmp[o + x] = ((sum / win) * 255 + 0.5) | 0;
        sum += e[x + win + 1] - e[x + 1];
      }
    }
    const colSum = new Float32Array(W);
    function vblurInit() {
      colSum.fill(0);
      for (let y = 0; y <= rimR && y < Hp; y++) for (let x = 0; x < W; x++) colSum[x] += tmp[y * W + x];
    }
    function vblurRow(y) {
      const o = y * W;
      for (let x = 0; x < W; x++) {
        const v = (colSum[x] / 255) * 0.55;
        rim[o + x] = v >= 1 ? 255 : (v * 255 + 0.5) | 0;
      }
      const add = y + rimR + 1, sub = y - rimR;
      if (add < Hp) for (let x = 0; x < W; x++) colSum[x] += tmp[add * W + x];
      if (sub >= 0) for (let x = 0; x < W; x++) colSum[x] -= tmp[sub * W + x];
    }

    // ---- stage 3: tint ----
    const misAmp = 0.0017 * iw; // misregistration of the wash, in pixels
    const sx = 1 / W; // plate units per pixel
    // smooth noise fields live on a coarse grid and are interpolated per pixel
    const GS = 4;
    const gw = Math.ceil(W / GS) + 2, gh = Math.ceil(Hp / GS) + 2;
    const fPaper = new Float32Array(gw * gh), fMx = new Float32Array(gw * gh), fMy = new Float32Array(gw * gh), fWash = new Float32Array(gw * gh);
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        const X = gx * GS * sx, Y = gy * GS * sx;
        const k = gy * gw + gx;
        fPaper[k] = 0.034 * (vnoise2(X * 4.3, Y * 4.3, 3) - 0.5) + 0.024 * (vnoise2(X * 23, Y * 23, 4) - 0.5);
        fMx[k] = misAmp * 2 * (vnoise2(X * 5, Y * 5, 31) - 0.5);
        fMy[k] = misAmp * 2 * (vnoise2(X * 5, Y * 5, 32) - 0.5);
        fWash[k] = 0.88 + 0.22 * (vnoise2(X * 7, Y * 7, 21) - 0.5) + 0.14 * (vnoise2(X * 48, Y * 48, 22) - 0.5);
      }
    }
    const rP = new Float32Array(gw), rX = new Float32Array(gw), rY = new Float32Array(gw), rW = new Float32Array(gw);
    function prepRow(y) {
      const gy = y / GS;
      const g0 = Math.floor(gy), t = gy - g0;
      const a = g0 * gw, b = (g0 + 1) * gw;
      for (let gx = 0; gx < gw; gx++) {
        rP[gx] = fPaper[a + gx] + (fPaper[b + gx] - fPaper[a + gx]) * t;
        rX[gx] = fMx[a + gx] + (fMx[b + gx] - fMx[a + gx]) * t;
        rY[gx] = fMy[a + gx] + (fMy[b + gx] - fMy[a + gx]) * t;
        rW[gx] = fWash[a + gx] + (fWash[b + gx] - fWash[a + gx]) * t;
      }
    }

    // a cheap flat preview used while the geology is still being computed
    function quickRow(y) {
      const o = y * W;
      for (let x = 0; x < W; x++) {
        const i = o + x;
        let r = paper[0], g = paper[1], b = paper[2];
        const l = label[i];
        if (l !== MARGIN) {
          const a = A[l];
          if (a > 0) {
            r *= 1 - a + a * T[l * 3]; g *= 1 - a + a * T[l * 3 + 1]; b *= 1 - a + a * T[l * 3 + 2];
          }
          const k = inkB[i] / 255;
          if (k > 0) {
            r += (inkC[0] - r) * k; g += (inkC[1] - g) * k; b += (inkC[2] - b) * k;
          }
        }
        const p = i * 4;
        px[p] = r; px[p + 1] = g; px[p + 2] = b; px[p + 3] = 255;
      }
    }

    function tintRow(y) {
      const o = y * W;
      const Y = y * sx;
      const Z = GEOM.zTop - (y - iy0 + 0.5) * ps;
      prepRow(y);
      for (let x = 0; x < W; x++) {
        const X = x * sx;
        const i = o + x;
        const gxf = x / GS;
        const g0 = gxf | 0, gt = gxf - g0;
        // paper: mottling + fibres + grain, toned toward the plate edge
        const pn = 1 + rP[g0] + (rP[g0 + 1] - rP[g0]) * gt + 0.018 * (vnoise2(X * 70, Y * 260, 5) - 0.5) + 0.028 * (hash2(x, y, 9) - 0.5);
        const ex = Math.min(X, 1 - X, Y, GEOM.ph - Y);
        const tone = ex < 0.05 ? 1 - 0.035 * (1 - ex / 0.05) * (1 - ex / 0.05) : 1;
        let r = paper[0] * pn * tone, g = paper[1] * pn * tone, b = paper[2] * pn * tone;

        const l0 = label[i];
        if (l0 !== MARGIN) {
          // wash colour, sampled from a slightly shifted position (hand-tinting never registers perfectly)
          let tr = 0, tg = 0, tb = 0, ta = 0, rm = 0, md = 0;
          let fx = x + rX[g0] + (rX[g0 + 1] - rX[g0]) * gt;
          let fy = y + rY[g0] + (rY[g0 + 1] - rY[g0]) * gt;
          if (fx < ix0) fx = ix0;
          if (fx > ix1 - 1.001) fx = ix1 - 1.001;
          if (fy < iy0) fy = iy0;
          if (fy > iy1 - 1.001) fy = iy1 - 1.001;
          const x0 = fx | 0, y0 = fy | 0;
          const ax = fx - x0, ay = fy - y0;
          for (let q = 0; q < 4; q++) {
            const xx = x0 + (q & 1), yy = y0 + (q >> 1);
            const w = (q & 1 ? ax : 1 - ax) * (q >> 1 ? ay : 1 - ay);
            const j = yy * W + xx;
            let u = label[j];
            if (u === MARGIN) u = 0;
            const a = A[u] * w;
            tr += T[u * 3] * a; tg += T[u * 3 + 1] * a; tb += T[u * 3 + 2] * a;
            ta += a;
            md += w * modB[j];
            rm += w * rim[j] * (1 / 255);
          }
          if (ta > 0.001) {
            let cr = tr / ta, cg = tg / ta, cb = tb / ta;
            if (md > 0) {
              const k = (md / 255) * 0.5;
              cr *= 1 - k * 0.24; cg *= 1 - k * 0.33; cb *= 1 - k * 0.34;
            }
            let w = ta * (rW[g0] + (rW[g0 + 1] - rW[g0]) * gt) * (1 + 0.42 * rm);
            if (w > 1) w = 1;
            r *= 1 - w + w * cr; g *= 1 - w + w * cg; b *= 1 - w + w * cb;
          } else if (skyRgb && l0 === 0 && x >= ix0 && x < ix1) {
            // pale sky wash, strongest at the top of the frame
            const S = Scol[x - ix0];
            const t = (Z - S) / (GEOM.zTop - S);
            if (t > 0) {
              const w = pal.skyA * t * t * (0.85 + 0.6 * (rW[g0] - 0.88));
              r *= 1 - w + (w * skyRgb[0]) / paper[0]; g *= 1 - w + (w * skyRgb[1]) / paper[1]; b *= 1 - w + (w * skyRgb[2]) / paper[2];
            }
          }
          const ik = inkB[i];
          if (ik > 0) {
            const k = (ik / 255) * (0.84 + 0.16 * hash2(x, y, 13));
            r += (inkC[0] - r) * k; g += (inkC[1] - g) * k; b += (inkC[2] - b) * k;
          }
        }
        const p = i * 4;
        px[p] = r; px[p + 1] = g; px[p + 2] = b; px[p + 3] = 255;
      }
    }

    // ---- overlays: frame, skyline vegetation, caption ----
    function overlays() {
      ctx.putImageData(img, 0, 0);
      const ink = 'rgb(' + inkC.join(',') + ')';
      ctx.save();
      ctx.strokeStyle = ink;
      ctx.fillStyle = ink;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      // frame: a heavy inner rule and a fine outer rule
      const lw1 = Math.max(1, 0.0021 * W), lw2 = Math.max(0.7, 0.0009 * W);
      ctx.lineWidth = lw1;
      ctx.strokeRect(ix0 - lw1 / 2, iy0 - lw1 / 2, iw + lw1, iy1 - iy0 + lw1);
      const g2 = 0.0075 * W;
      ctx.lineWidth = lw2;
      ctx.strokeRect(ix0 - g2, iy0 - g2, iw + 2 * g2, iy1 - iy0 + 2 * g2);

      // trees and tufts along the skyline
      ctx.beginPath();
      ctx.rect(ix0, iy0, iw, iy1 - iy0);
      ctx.clip();
      const wpx = (X) => ix0 + X * iw;
      const zpx = (Z) => iy0 + (GEOM.zTop - Z) * iw;
      const tl = Math.max(0.8, 0.0012 * iw);
      for (const t of H.trees) {
        const S = landZ(H, t.x);
        if (H.sea && S < H.seaLevel + 0.004) continue;
        const slope = Math.abs((landZ(H, t.x + 0.003) - landZ(H, t.x - 0.003)) / 0.006);
        if (slope > 0.9) continue;
        const bx = wpx(t.x), by = zpx(S) + tl * 0.6;
        const h = 0.017 * t.s * iw;
        ctx.lineWidth = tl;
        if (t.k === 'tuft') {
          ctx.beginPath();
          const n = 3 + Math.floor(t.r * 3);
          for (let q = 0; q < n; q++) {
            const a = -Math.PI / 2 + (q / (n - 1) - 0.5) * 1.3 + (hash2(q, 1, t.r * 1e6) - 0.5) * 0.3;
            const L = h * (0.22 + 0.16 * hash2(q, 2, t.r * 1e6));
            ctx.moveTo(bx, by);
            ctx.lineTo(bx + Math.cos(a) * L, by + Math.sin(a) * L);
          }
          ctx.stroke();
        } else if (t.k === 'conifer') {
          const hh = h * 1.1, wd = h * 0.24;
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(bx, by - hh * 0.22);
          ctx.stroke();
          ctx.beginPath();
          const tiers = 4;
          ctx.moveTo(bx, by - hh);
          for (let q = 1; q <= tiers; q++) {
            const yy = by - hh + (hh * 0.8 * q) / tiers;
            const ww = (wd * q) / tiers;
            ctx.lineTo(bx + ww, yy);
            if (q < tiers) ctx.lineTo(bx + ww * 0.45, yy);
          }
          for (let q = tiers; q >= 1; q--) {
            const yy = by - hh + (hh * 0.8 * q) / tiers;
            const ww = (wd * q) / tiers;
            if (q < tiers) ctx.lineTo(bx - ww * 0.45, yy);
            ctx.lineTo(bx - ww, yy);
          }
          ctx.closePath();
          ctx.globalAlpha = 0.86;
          ctx.fill();
          ctx.globalAlpha = 1;
        } else {
          const hh = h * 0.95;
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(bx, by - hh * 0.45);
          ctx.stroke();
          ctx.beginPath();
          const cx = bx, cy = by - hh * 0.68, rr = hh * 0.3;
          for (let q = 0; q < 5; q++) {
            const a = (q / 5) * Math.PI * 2 + t.r * 6;
            ctx.moveTo(cx + Math.cos(a) * rr * 0.55 + rr * 0.62, cy + Math.sin(a) * rr * 0.55);
            ctx.arc(cx + Math.cos(a) * rr * 0.55, cy + Math.sin(a) * rr * 0.55, rr * 0.62, 0, Math.PI * 2);
          }
          ctx.globalAlpha = 0.84;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
      ctx.restore();

      // compass letters and caption, set like an engraved plate
      ctx.save();
      ctx.fillStyle = ink;
      const serif = '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, "Times New Roman", serif';
      const fs = Math.max(7, 0.017 * W);
      ctx.font = 'italic ' + fs.toFixed(1) + 'px ' + serif;
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';
      ctx.fillText('W.', ix0, iy0 - g2 - fs * 0.45);
      ctx.textAlign = 'right';
      ctx.fillText('E.', ix1, iy0 - g2 - fs * 0.45);
      const cs = Math.max(7, 0.0175 * W);
      ctx.font = 'italic ' + cs.toFixed(1) + 'px ' + serif;
      ctx.textAlign = 'center';
      const cap = 'Fig. ' + String(H.seed).slice(0, 24) + '.  ' + H.title + '.';
      let size = cs;
      while (ctx.measureText(cap).width > iw * 0.98 && size > 6) {
        size *= 0.94;
        ctx.font = 'italic ' + size.toFixed(1) + 'px ' + serif;
      }
      const capY = iy1 + g2 + (GEOM.mb * W - g2) * 0.46;
      ctx.fillText(cap, W / 2, capY);
      // scale bar: one kilometre (or 500 m) in alternating blocks
      const kmPx = iw / H.km;
      let unit = 1, lab = '1 km';
      if (kmPx > iw * 0.4) { unit = 0.5; lab = '500 m'; }
      if (kmPx * unit < iw * 0.06) { unit = 2; lab = '2 km'; }
      const barW = kmPx * unit;
      const bh = Math.max(1.5, 0.0035 * W);
      const by = capY + cs * 0.95;
      const bx = W / 2 - barW / 2;
      ctx.lineWidth = Math.max(0.6, 0.0007 * W);
      ctx.strokeStyle = ink;
      ctx.strokeRect(bx, by, barW, bh);
      for (let q = 0; q < 4; q += 2) ctx.fillRect(bx + (barW * q) / 4, by, barW / 4, bh);
      const ss = Math.max(6, 0.012 * W);
      ctx.font = 'italic ' + ss.toFixed(1) + 'px ' + serif;
      ctx.textAlign = 'left';
      ctx.fillText(lab, bx + barW + ss * 0.6, by + bh);
      ctx.textAlign = 'right';
      ctx.fillText('0', bx - ss * 0.6, by + bh);
      ctx.restore();
    }

    // ---- the job: a small state machine stepped within a time budget ----
    const job = {
      canvas, W, Hp, done: false, stage: 'geology', progress: 0, cancelled: false,
    };
    let y2 = 0, y3 = 0, y4 = 0;
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    job.step = function (budget) {
      const t0 = now();
      while (now() - t0 < budget && !job.done) {
        if (job.stage === 'geology') {
          const hi = row;
          const lo = Math.max(0, row - 7);
          for (let y = hi; y >= lo; y--) evalRow(y);
          if (opts.progressive) {
            for (let y = hi; y >= lo; y--) quickRow(y);
            ctx.putImageData(img, 0, 0, 0, lo, W, hi - lo + 1);
          }
          row = lo - 1;
          if (row < 0) job.stage = 'edges';
        } else if (job.stage === 'edges') {
          const lim = Math.min(Hp, y2 + 24);
          for (; y2 < lim; y2++) edgeRowBlur(y2);
          if (y2 >= Hp) {
            vblurInit();
            job.stage = 'rims';
          }
        } else if (job.stage === 'rims') {
          const lim = Math.min(Hp, y3 + 24);
          for (; y3 < lim; y3++) vblurRow(y3);
          if (y3 >= Hp) job.stage = 'tint';
        } else if (job.stage === 'tint') {
          const lim = Math.min(Hp, y4 + 8);
          for (; y4 < lim; y4++) tintRow(y4);
          if (y4 >= Hp) {
            overlays();
            job.stage = 'done';
            job.done = true;
          }
        }
      }
      const rowsDone = Hp - 1 - row;
      job.progress = job.done ? 1 : (rowsDone * 2.4 + y2 * 0.3 + y3 * 0.3 + y4 * 1) / (Hp * 4);
      return job.done;
    };
    job.runSync = function () {
      while (!job.done) job.step(1e9);
      return canvas;
    };
    return job;
  }

  UNC.makeJob = makeJob;
})(typeof window !== 'undefined' ? window : globalThis);
