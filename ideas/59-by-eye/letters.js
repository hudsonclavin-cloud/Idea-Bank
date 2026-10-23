/* By Eye: a small geometric titling alphabet (A-Z, 0-9 and a little punctuation) drawn from rules.
 *
 * Every glyph is built from a few primitives: upright stems, horizontal bars, straight diagonal
 * strokes and elliptical rings or ring sectors. Coordinates are font units, y up, baseline 0,
 * cap height 700. A glyph's outline is the union of its primitives, written as one SVG path
 * (M, L, C and Z only) to be filled with the nonzero rule: every solid contour runs
 * counter-clockwise and every hole clockwise, so overlapping pieces simply add up.
 *
 * Five parameters decide the drawing. With the RULER values the alphabet is exactly what a ruler
 * says is even: every letter and figure stands between the baseline and the cap height, every
 * straight stroke and every circular ring is 100 units thick measured across the stroke
 * (elliptical rings: exactly 100 at their extremes, 98-100 between), crossbars sit at exactly half
 * height and two-storey shapes have two equal storeys. The page asks a reader's eye for the rest.
 *
 *   round   how far round shapes (O C G Q S U J and the round figures) reach beyond the baseline
 *           and cap height, per side, as a fraction of the cap height
 *   point   the same for pointed apexes and vertices (A V W M)
 *   bar     thickness of a horizontal stroke divided by that of an upright one. Diagonals and
 *           curves follow from it: every stroke is drawn as if by an elliptical pen 100 units
 *           wide and 100 x bar units tall
 *   middle  height of the centre of the crossbar of H, and of the middle arms of E and F, as a
 *           fraction of the cap height
 *   halves  the top storey's share of the two storeys' heights in B P R K X S 3 8
 *
 * Classic script: in a browser it defines window.ByEyeLetters; under Node it is a CommonJS module.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ByEyeLetters = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CAP = 700;
  const STEM = 100;
  const RULER = Object.freeze({ round: 0, point: 0, bar: 1, middle: 0.5, halves: 0.5 });
  const LIMITS = Object.freeze({
    round: [-0.06, 0.1],
    point: [-0.06, 0.14],
    bar: [0.5, 1.4],
    middle: [0.38, 0.62],
    halves: [0.38, 0.6],
  });
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const FIGURES = '0123456789';
  const PUNCT = ".,-'";
  const CHARSET = LETTERS + FIGURES + PUNCT + ' ';

  // ---------- small geometry kit ----------

  const D2R = Math.PI / 180;
  const KAPPA = (deg) => (4 / 3) * Math.tan((deg * D2R) / 4);

  // A contour is a list of commands: ['M', x, y], ['L', x, y], ['C', x1, y1, x2, y2, x, y]. Closed.
  function poly(points) {
    return points.map((p, i) => [i ? 'L' : 'M', p[0], p[1]]);
  }
  function rect(x0, y0, x1, y1) {
    return poly([
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ]);
  }
  function ellipsePt(cx, cy, rx, ry, deg) {
    return [cx + rx * Math.cos(deg * D2R), cy + ry * Math.sin(deg * D2R)];
  }
  // Cubic pieces of an elliptical arc from angle a0 to a1 (degrees, either direction), split at
  // every multiple of 90 degrees so that each extreme point of the ellipse is an exact endpoint.
  function arcCmds(cx, cy, rx, ry, a0, a1) {
    const cuts = [a0];
    const dir = a1 > a0 ? 1 : -1;
    let k = dir > 0 ? Math.floor(a0 / 90) + 1 : Math.ceil(a0 / 90) - 1;
    while (dir > 0 ? k * 90 < a1 - 1e-9 : k * 90 > a1 + 1e-9) {
      if (Math.abs(k * 90 - a0) > 1e-9) cuts.push(k * 90);
      k += dir;
    }
    cuts.push(a1);
    const out = [];
    for (let i = 0; i < cuts.length - 1; i++) {
      const t0 = cuts[i] * D2R;
      const t1 = cuts[i + 1] * D2R;
      const h = KAPPA(cuts[i + 1] - cuts[i]);
      const p0 = [cx + rx * Math.cos(t0), cy + ry * Math.sin(t0)];
      const p1 = [cx + rx * Math.cos(t1), cy + ry * Math.sin(t1)];
      out.push([
        'C',
        p0[0] - h * rx * Math.sin(t0),
        p0[1] + h * ry * Math.cos(t0),
        p1[0] + h * rx * Math.sin(t1),
        p1[1] - h * ry * Math.cos(t1),
        p1[0],
        p1[1],
      ]);
    }
    return out;
  }
  function ellipse(cx, cy, rx, ry) {
    const s = ellipsePt(cx, cy, rx, ry, 0);
    return [['M', s[0], s[1]], ...arcCmds(cx, cy, rx, ry, 0, 360)];
  }
  // A ring (outer ellipse minus inner ellipse) between angles a0 and a1, ends cut straight across
  // from the outer to the inner ellipse at the same parametric angle.
  function sector(cx, cy, rxo, ryo, rxi, ryi, a0, a1) {
    const o0 = ellipsePt(cx, cy, rxo, ryo, a0);
    const i1 = ellipsePt(cx, cy, rxi, ryi, a1);
    return [['M', o0[0], o0[1]], ...arcCmds(cx, cy, rxo, ryo, a0, a1), ['L', i1[0], i1[1]], ...arcCmds(cx, cy, rxi, ryi, a1, a0)];
  }

  // Points of a contour, with each cubic flattened (for areas and for tests).
  function flattenContour(c, steps = 16) {
    const pts = [];
    let cur = null;
    for (const cmd of c) {
      if (cmd[0] === 'M' || cmd[0] === 'L') {
        cur = [cmd[1], cmd[2]];
        pts.push(cur);
      } else {
        const [, x1, y1, x2, y2, x, y] = cmd;
        const [x0, y0] = cur;
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const u = 1 - t;
          pts.push([
            u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x,
            u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y,
          ]);
        }
        cur = [x, y];
      }
    }
    return pts;
  }
  function signedArea(c) {
    const p = flattenContour(c);
    let a = 0;
    for (let i = 0; i < p.length; i++) {
      const [x0, y0] = p[i];
      const [x1, y1] = p[(i + 1) % p.length];
      a += x0 * y1 - x1 * y0;
    }
    return a / 2;
  }
  function reverseContour(c) {
    // Collect segments as (from, cmd) and rebuild them backwards.
    const segs = [];
    let start = [c[0][1], c[0][2]];
    let cur = start;
    for (let i = 1; i < c.length; i++) {
      const cmd = c[i];
      const end = cmd[0] === 'L' ? [cmd[1], cmd[2]] : [cmd[5], cmd[6]];
      segs.push({ from: cur, to: end, cmd });
      cur = end;
    }
    if (Math.hypot(cur[0] - start[0], cur[1] - start[1]) > 1e-9) segs.push({ from: cur, to: start, cmd: ['L', start[0], start[1]] });
    const out = [['M', start[0], start[1]]];
    for (let i = segs.length - 1; i >= 0; i--) {
      const { from, cmd } = segs[i];
      if (cmd[0] === 'L') out.push(['L', from[0], from[1]]);
      else out.push(['C', cmd[3], cmd[4], cmd[1], cmd[2], from[0], from[1]]);
    }
    // Drop a closing L that just returns to the start point.
    const last = out[out.length - 1];
    if (last[0] === 'L' && Math.hypot(last[1] - start[0], last[2] - start[1]) < 1e-9) out.pop();
    return out;
  }
  // sign +1: solid (counter-clockwise, y up); -1: hole (clockwise).
  function orient(c, sign) {
    return Math.sign(signedArea(c)) === sign ? c : reverseContour(c);
  }

  // Lines that are not horizontal, written x = a + m*y.
  const lineThrough = (p, q) => {
    const m = (q[0] - p[0]) / (q[1] - p[1]);
    return { a: p[0] - m * p[1], m };
  };
  const lineAt = (p, m) => ({ a: p[0] - m * p[1], m });
  const shift = (l, dx) => ({ a: l.a + dx, m: l.m });
  const xAt = (l, y) => l.a + l.m * y;
  const atY = (l, y) => [xAt(l, y), y];
  function meet(l1, l2) {
    const y = (l2.a - l1.a) / (l1.m - l2.m);
    return [xAt(l1, y), y];
  }

  // ---------- the drawing, for one set of parameters ----------

  function clampParams(p) {
    const out = {};
    for (const k of Object.keys(RULER)) {
      const v = p && Number.isFinite(p[k]) ? p[k] : RULER[k];
      out[k] = Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], v));
    }
    return out;
  }

  function makeKit(params) {
    const P = clampParams(params);
    const s = STEM;
    const t = STEM * P.bar;
    const o = P.round * CAP;
    const pt = P.point * CAP;
    // Horizontal width of a straight stroke with slope m = dx/dy, drawn by the elliptical pen.
    const wh = (m) => Math.sqrt(s * s + t * t * m * m);
    // The stroke whose left edge passes through A and whose right edge passes through B
    // (left/right meaning smaller/larger x at the same height). Returns both edge lines.
    function strokeAB(A, B) {
      let m = (B[0] - A[0]) / (B[1] - A[1]);
      for (let i = 0; i < 100; i++) {
        const next = (B[0] - A[0] - wh(m)) / (B[1] - A[1]);
        if (Math.abs(next - m) < 1e-13) {
          m = next;
          break;
        }
        m = next;
      }
      const L = lineAt(A, m);
      return { L, R: shift(L, wh(m)), m };
    }
    // The stroke whose left edge is the line through p and q.
    function strokeLeft(p, q) {
      const L = lineThrough(p, q);
      return { L, R: shift(L, wh(L.m)), m: L.m };
    }
    function strokeRight(p, q) {
      const R = lineThrough(p, q);
      return { L: shift(R, -wh(R.m)), R, m: R.m };
    }
    // A diagonal stroke cut by two horizontal lines.
    function band(st, y0, y1) {
      return poly([atY(st.L, y0), atY(st.R, y0), atY(st.R, y1), atY(st.L, y1)]);
    }
    // Waist of the two-storey letters: the centre of the shared middle stroke.
    // Outer heights of the storeys are halves*(CAP+t) on top and (1-halves)*(CAP+t) below.
    const hBottom = (1 - P.halves) * (CAP + t);
    const waist = hBottom - t / 2;
    return { P, s, t, o, pt, wh, strokeAB, strokeLeft, strokeRight, band, hBottom, waist };
  }

  // Each builder returns { w: ink width, lsb, rsb, solids: [contour], holes: [contour] }.
  const B = {};

  // --- straight letters ---
  B.H = (k) => {
    const W = 540;
    const yc = k.P.middle * CAP;
    return {
      w: W, lsb: 70, rsb: 70,
      solids: [rect(0, 0, k.s, CAP), rect(W - k.s, 0, W, CAP), rect(k.s / 2, yc - k.t / 2, W - k.s / 2, yc + k.t / 2)],
    };
  };
  B.I = (k) => ({ w: k.s, lsb: 70, rsb: 70, solids: [rect(0, 0, k.s, CAP)] });
  B.E = (k) => {
    const yc = k.P.middle * CAP;
    return {
      w: 380, lsb: 70, rsb: 40,
      solids: [rect(0, 0, k.s, CAP), rect(0, CAP - k.t, 380, CAP), rect(0, yc - k.t / 2, 345, yc + k.t / 2), rect(0, 0, 380, k.t)],
    };
  };
  B.F = (k) => {
    const yc = k.P.middle * CAP;
    return {
      w: 370, lsb: 70, rsb: 30,
      solids: [rect(0, 0, k.s, CAP), rect(0, CAP - k.t, 370, CAP), rect(0, yc - k.t / 2, 335, yc + k.t / 2)],
    };
  };
  B.L = (k) => ({ w: 360, lsb: 70, rsb: 25, solids: [rect(0, 0, k.s, CAP), rect(0, 0, 360, k.t)] });
  B.T = (k) => {
    const W = 540;
    return { w: W, lsb: 20, rsb: 20, solids: [rect(0, CAP - k.t, W, CAP), rect(W / 2 - k.s / 2, 0, W / 2 + k.s / 2, CAP)] };
  };

  // --- pointed letters ---
  // A chevron: two strokes meeting in a point at `tip`, with flat terminals on the line yFlat.
  // (tip above yFlat: an A; below: a V.) feetL and feetR are the outer corners on yFlat.
  function chevron(k, feetL, tip, feetR) {
    // Left stroke: its outer edge runs from feetL to the tip. Right stroke: from feetR to the tip.
    // Either way up, each stroke's outer edge is the line from its foot to the tip.
    const left = k.strokeLeft(feetL, tip);
    const right = k.strokeRight(feetR, tip);
    const yF = feetL[1];
    const inner = meet(left.R, right.L);
    return {
      contour: poly([feetL, atY(left.R, yF), inner, atY(right.L, yF), feetR, tip]),
      left,
      right,
      inner,
    };
  }
  B.A = (k) => {
    const W = 640;
    const ch = chevron(k, [0, 0], [W / 2, CAP + k.pt], [W, 0]);
    const yb = 0.27 * CAP;
    const x0 = (xAt(ch.left.L, yb) + xAt(ch.left.R, yb)) / 2;
    const x1 = (xAt(ch.right.L, yb) + xAt(ch.right.R, yb)) / 2;
    return { w: W, lsb: 16, rsb: 16, solids: [ch.contour, rect(x0, yb - k.t / 2, x1, yb + k.t / 2)] };
  };
  B.V = (k) => {
    const W = 640;
    const ch = chevron(k, [0, CAP], [W / 2, -k.pt], [W, CAP]);
    return { w: W, lsb: 16, rsb: 16, solids: [ch.contour] };
  };
  B.W = (k) => {
    const W = 940;
    const xb = 0.255 * W;
    const B1 = [xb, -k.pt];
    const B2 = [W - xb, -k.pt];
    const M = [W / 2, CAP + k.pt];
    const s1 = k.strokeLeft([0, CAP], B1);
    const s4 = k.strokeRight([W, CAP], B2);
    const s2 = k.strokeAB(M, B1); // left edge through the apex, right edge through the vertex
    const s3 = k.strokeAB(B2, M); // left edge through the second vertex, right edge through the apex
    const C1 = meet(s2.R, s3.L);
    const I1 = meet(s1.R, s2.L);
    const I2 = meet(s3.R, s4.L);
    return {
      w: W, lsb: 14, rsb: 14,
      solids: [poly([[0, CAP], B1, C1, B2, [W, CAP], atY(s4.L, CAP), I2, M, I1, atY(s1.R, CAP)])],
    };
  };
  B.M = (k) => {
    const W = 760;
    const ch = chevron(k, [0, CAP], [W / 2, -k.pt], [W, CAP]);
    return { w: W, lsb: 70, rsb: 70, solids: [rect(0, 0, k.s, CAP), rect(W - k.s, 0, W, CAP), ch.contour] };
  };
  B.N = (k) => {
    const W = 580;
    const d = k.strokeAB([0, CAP], [W, 0]);
    return { w: W, lsb: 70, rsb: 70, solids: [rect(0, 0, k.s, CAP), rect(W - k.s, 0, W, CAP), k.band(d, 0, CAP)] };
  };
  B.Z = (k) => {
    const W = 480;
    const d = k.strokeAB([0, 0], [W, CAP]);
    return { w: W, lsb: 35, rsb: 35, solids: [rect(0, CAP - k.t, W, CAP), rect(0, 0, W, k.t), k.band(d, 0, CAP)] };
  };
  B.X = (k) => {
    const W = 580;
    const target = k.waist;
    // Inset the top terminals by `inset` so that the two strokes' centre lines cross at the waist.
    const build = (inset) => {
      const a = k.strokeAB([inset, CAP], [W, 0]);
      const b = k.strokeAB([0, 0], [W - inset, CAP]);
      return { a, b };
    };
    const crossY = (inset) => {
      const { a } = build(inset);
      const cl = shift(a.L, k.wh(a.m) / 2);
      return (W / 2 - cl.a) / cl.m;
    };
    let lo = -250;
    let hi = 250;
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      // A larger inset moves the crossing up.
      if (crossY(mid) < target) lo = mid;
      else hi = mid;
    }
    const inset = (lo + hi) / 2;
    const { a, b } = build(inset);
    return { w: W, lsb: 18, rsb: 18, solids: [k.band(a, 0, CAP), k.band(b, 0, CAP)], inset };
  };
  B.Y = (k) => {
    const W = 620;
    const ch = chevron(k, [0, CAP], [W / 2, 0.3 * CAP], [W, CAP]);
    return { w: W, lsb: 16, rsb: 16, solids: [ch.contour, rect(W / 2 - k.s / 2, 0, W / 2 + k.s / 2, 0.42 * CAP)] };
  };
  B.K = (k) => {
    const W = 540;
    const v = [0.35 * k.s, k.waist];
    const arm = k.strokeAB(v, [W, CAP]);
    const leg = k.strokeAB(v, [W, 0]);
    const crotch = meet(arm.R, leg.R);
    return {
      w: W, lsb: 70, rsb: 14,
      solids: [rect(0, 0, k.s, CAP), poly([v, atY(arm.L, CAP), [W, CAP], crotch, [W, 0], atY(leg.L, 0)])],
    };
  };

  // --- round letters ---
  const RO = 350; // outer radius of the ruler O
  function ringO(k) {
    const ry = CAP / 2 + k.o;
    const rx = RO * (ry / (CAP / 2));
    return { cx: rx, cy: CAP / 2, rx, ry, ix: rx - k.s, iy: ry - k.t };
  }
  B.O = (k) => {
    const r = ringO(k);
    return { w: 2 * r.rx, lsb: 45, rsb: 45, solids: [ellipse(r.cx, r.cy, r.rx, r.ry)], holes: [ellipse(r.cx, r.cy, r.ix, r.iy)] };
  };
  B.Q = (k) => {
    const r = ringO(k);
    const p1 = [r.cx + 0.1 * r.rx, r.cy - 0.32 * r.ry];
    const p2 = [r.cx + 0.82 * r.rx, -0.075 * CAP - k.o];
    const m = (p2[0] - p1[0]) / (p2[1] - p1[1]);
    const L = shift(lineAt(p1, m), -k.wh(m) / 2);
    const tail = { L, R: shift(L, k.wh(m)), m };
    return {
      w: 2 * r.rx, lsb: 45, rsb: 45,
      solids: [ellipse(r.cx, r.cy, r.rx, r.ry), k.band(tail, p2[1], p1[1])],
      holes: [ellipse(r.cx, r.cy, r.ix, r.iy)],
    };
  };
  B.C = (k) => {
    const r = ringO(k);
    const a = 48;
    const right = r.cx + r.rx * Math.cos(a * D2R);
    return { w: right, lsb: 45, rsb: 30, solids: [sector(r.cx, r.cy, r.rx, r.ry, r.ix, r.iy, a, 360 - a)] };
  };
  B.G = (k) => {
    const r = ringO(k);
    const a = 44;
    // The bar's right end stops inside the ring's right side, so the ring alone draws the edge.
    const bar = rect(r.cx + 0.08 * r.rx, r.cy - k.t, r.cx + r.rx - k.s / 2, r.cy);
    return { w: 2 * r.rx, lsb: 45, rsb: 55, solids: [sector(r.cx, r.cy, r.rx, r.ry, r.ix, r.iy, a, 360), bar] };
  };
  B.D = (k) => {
    const x0 = 270;
    const rx = 330;
    const ry = CAP / 2;
    return {
      w: x0 + rx, lsb: 70, rsb: 45,
      solids: [
        rect(0, 0, k.s, CAP),
        rect(0, CAP - k.t, x0, CAP),
        rect(0, 0, x0, k.t),
        sector(x0, CAP / 2, rx, ry, rx - k.s, ry - k.t, -90, 90),
      ],
    };
  };
  B.U = (k) => {
    const W = 560;
    const rx = W / 2;
    const cy = rx;
    const ry = cy + k.o;
    return {
      w: W, lsb: 66, rsb: 66,
      solids: [rect(0, cy, k.s, CAP), rect(W - k.s, cy, W, CAP), sector(rx, cy, rx, ry, rx - k.s, ry - k.t, 180, 360)],
    };
  };
  B.J = (k) => {
    const rx = 215;
    const W = 2 * rx;
    const cy = rx;
    const ry = cy + k.o;
    return {
      w: W, lsb: 28, rsb: 70,
      solids: [rect(W - k.s, cy, W, CAP), sector(rx, cy, rx, ry, rx - k.s, ry - k.t, 198, 360)],
    };
  };

  // --- two-storey letters ---
  const KB = 1.12; // bowl width / bowl half-height for B P R
  function bowls(k) {
    const hb = k.hBottom;
    const ht = CAP + k.t - hb;
    return {
      top: { cy: CAP - ht / 2, ry: ht / 2, rx: (KB * ht) / 2 },
      bot: { cy: hb / 2, ry: hb / 2, rx: (KB * hb) / 2 },
      hb,
    };
  }
  function bowl(k, x0, b) {
    return sector(x0, b.cy, b.rx, b.ry, b.rx - k.s, b.ry - k.t, -90, 90);
  }
  const XB = 250;
  B.B = (k) => {
    const bw = bowls(k);
    return {
      w: XB + Math.max(bw.top.rx, bw.bot.rx), lsb: 70, rsb: 45,
      solids: [
        rect(0, 0, k.s, CAP),
        rect(0, CAP - k.t, XB, CAP),
        rect(0, bw.hb - k.t, XB, bw.hb),
        rect(0, 0, XB, k.t),
        bowl(k, XB, bw.top),
        bowl(k, XB, bw.bot),
      ],
    };
  };
  B.P = (k) => {
    const bw = bowls(k);
    return {
      w: XB + bw.top.rx, lsb: 70, rsb: 35,
      solids: [rect(0, 0, k.s, CAP), rect(0, CAP - k.t, XB, CAP), rect(0, bw.hb - k.t, XB, bw.hb), bowl(k, XB, bw.top)],
    };
  };
  B.R = (k) => {
    const bw = bowls(k);
    const W = 520;
    const leg = k.strokeAB([XB - 40, bw.hb - k.t], [W, 0]);
    return {
      w: W, lsb: 70, rsb: 18,
      solids: [
        rect(0, 0, k.s, CAP),
        rect(0, CAP - k.t, XB, CAP),
        rect(0, bw.hb - k.t, XB, bw.hb),
        bowl(k, XB, bw.top),
        k.band(leg, 0, bw.hb - k.t / 2),
      ],
    };
  };
  // Two stacked rings sharing the waist stroke, as in S, 8 and 3.
  function storeys(k, kappa) {
    const sum = (CAP + 2 * k.o + k.t) / 2; // ryTop + ryBottom
    const ryU = k.P.halves * sum;
    const ryL = sum - ryU;
    return {
      U: { cy: CAP + k.o - ryU, ry: ryU, rx: kappa * ryU },
      L: { cy: -k.o + ryL, ry: ryL, rx: kappa * ryL },
    };
  }
  const ringArgs = (k, cx, r) => [cx, r.cy, r.rx, r.ry, r.rx - k.s, r.ry - k.t];
  B.S = (k) => {
    const st = storeys(k, 1.1);
    const cx = Math.max(st.U.rx, st.L.rx);
    return {
      w: 2 * cx, lsb: 42, rsb: 42,
      solids: [sector(...ringArgs(k, cx, st.U), 28, 270), sector(...ringArgs(k, cx, st.L), 90, -152)],
    };
  };
  B['8'] = (k) => {
    const st = storeys(k, 1.06);
    const cx = Math.max(st.U.rx, st.L.rx);
    const [ux, uy, urx, ury, uix, uiy] = ringArgs(k, cx, st.U);
    const [lx, ly, lrx, lry, lix, liy] = ringArgs(k, cx, st.L);
    return {
      w: 2 * cx, lsb: 45, rsb: 45,
      solids: [ellipse(ux, uy, urx, ury), ellipse(lx, ly, lrx, lry)],
      holes: [ellipse(ux, uy, uix, uiy), ellipse(lx, ly, lix, liy)],
    };
  };
  B['3'] = (k) => {
    const st = storeys(k, 1.06);
    const cx = Math.max(st.U.rx, st.L.rx);
    const left = cx + Math.min(st.U.rx * Math.cos(152 * D2R), st.L.rx * Math.cos(208 * D2R));
    const shiftX = -left;
    return {
      w: 2 * cx + shiftX, lsb: 40, rsb: 45,
      solids: [sector(...ringArgs(k, cx + shiftX, st.U), 152, -90), sector(...ringArgs(k, cx + shiftX, st.L), 90, -152)],
    };
  };

  // --- figures ---
  B['0'] = (k) => {
    const ry = CAP / 2 + k.o;
    const rx = 255 * (ry / (CAP / 2));
    return { w: 2 * rx, lsb: 45, rsb: 45, solids: [ellipse(rx, CAP / 2, rx, ry)], holes: [ellipse(rx, CAP / 2, rx - k.s, ry - k.t)] };
  };
  B['1'] = (k) => {
    const x = 150;
    const flag = k.strokeLeft([x, CAP], [x - 150, CAP - 180]);
    const xEnd = 10;
    return {
      w: x + k.s, lsb: 30, rsb: 70,
      solids: [rect(x, 0, x + k.s, CAP), poly([[x, CAP], [x, xAtInv(flag.R, x)], [xEnd, xAtInv(flag.R, xEnd)], [xEnd, xAtInv(flag.L, xEnd)]])],
    };
  };
  // y on line l where x = given value.
  function xAtInv(l, x) {
    return (x - l.a) / l.m;
  }
  B['7'] = (k) => {
    const W = 470;
    const d = k.strokeAB([95, 0], [W, CAP]);
    return { w: W, lsb: 30, rsb: 30, solids: [rect(0, CAP - k.t, W, CAP), k.band(d, 0, CAP)] };
  };
  B['4'] = (k) => {
    const W = 540;
    const xs = 340;
    const yb = 0.25 * CAP;
    // The diagonal's upper edge runs from the bar's top-left corner to the stem's top-left corner;
    // it is cut by the top of the bar and by the stem's left side.
    const yTop = yb + k.t / 2;
    const d = k.strokeLeft([0, yTop], [xs, CAP]);
    return {
      w: W, lsb: 25, rsb: 30,
      solids: [
        rect(xs, 0, xs + k.s, CAP),
        rect(0, yb - k.t / 2, W, yTop),
        poly([[0, yTop], atY(d.R, yTop), [xs, xAtInv(d.R, xs)], [xs, CAP]]),
      ],
    };
  };
  // A ring sector continued by a straight stroke along its tangent from the end at angle `ae`
  // (the arc runs clockwise into ae), cut by the horizontal line yCut.
  function tangentTail(r, ae, yCut) {
    const po = ellipsePt(r.cx, r.cy, r.rx, r.ry, ae);
    const pi = ellipsePt(r.cx, r.cy, r.ix, r.iy, ae);
    const th = ae * D2R;
    // Direction of travel when the angle decreases (clockwise), along the mid-line ellipse.
    const mx = (r.rx + r.ix) / 2;
    const my = (r.ry + r.iy) / 2;
    const dir = [mx * Math.sin(th), -my * Math.cos(th)];
    const lo = (yCut - po[1]) / dir[1];
    const li = (yCut - pi[1]) / dir[1];
    return poly([po, [po[0] + lo * dir[0], yCut], [pi[0] + li * dir[0], yCut], pi]);
  }
  B['2'] = (k) => {
    const W = 470;
    const ry = 205 + k.o / 2;
    const r = { cx: 232, cy: CAP + k.o - ry, rx: 232, ry };
    r.ix = r.rx - k.s;
    r.iy = r.ry - k.t;
    // Find the end angle whose tangent stroke's upper-left edge lands on the bar's top-left corner.
    const yTop = k.t;
    const edgeX = (ae) => {
      const pi = ellipsePt(r.cx, r.cy, r.ix, r.iy, ae);
      const th = ae * D2R;
      const dir = [((r.rx + r.ix) / 2) * Math.sin(th), -((r.ry + r.iy) / 2) * Math.cos(th)];
      return pi[0] + ((yTop - pi[1]) / dir[1]) * dir[0];
    };
    let lo = -85;
    let hi = 5;
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      // edgeX grows with the angle.
      if (edgeX(mid) > 0) hi = mid;
      else lo = mid;
    }
    const ae = (lo + hi) / 2;
    return {
      w: W, lsb: 35, rsb: 35,
      solids: [sector(r.cx, r.cy, r.rx, r.ry, r.ix, r.iy, 165, ae), tangentTail(r, ae, k.t), rect(0, 0, W, k.t)],
    };
  };
  function bowl56(k) {
    const ry = 238 + k.o / 2;
    const rx = 245;
    return { cx: rx, cy: ry - k.o, rx, ry, ix: rx - k.s, iy: ry - k.t };
  }
  B['5'] = (k) => {
    const r = bowl56(k);
    const W = 2 * r.rx;
    const a0 = 128;
    // The upright's left side meets the bowl's outer edge where the bowl starts; its foot is cut
    // from there to the bowl's inner edge, so it neither pokes out below nor into the counter.
    const po = ellipsePt(r.cx, r.cy, r.rx, r.ry, a0);
    const xl = po[0];
    const xr = xl + k.s;
    const yIn = r.cy + r.iy * Math.sqrt(Math.max(0, 1 - ((xr - r.cx) / r.ix) ** 2));
    // The bowl itself starts where the upright's right side meets its inner edge.
    const aIn = Math.acos((xr - r.cx) / r.ix) / D2R;
    return {
      w: W, lsb: 40, rsb: 40,
      solids: [
        rect(xl, CAP - k.t, W - 20, CAP),
        poly([[xl, po[1]], [xr, yIn], [xr, CAP], [xl, CAP]]),
        sector(r.cx, r.cy, r.rx, r.ry, r.ix, r.iy, aIn, -148),
      ],
    };
  };
  function six(k) {
    const r = bowl56(k);
    const W = 2 * r.rx;
    // A straight stroke tangent to the bowl's outer edge on the left, rising to the right.
    // The ellipse's tangent has slope dx/dy = -(rx/ry) tan(theta); solve for the upper-left point.
    const m = 0.42;
    const th = Math.PI + Math.atan((-m * r.ry) / r.rx);
    const tp = [r.cx + r.rx * Math.cos(th), r.cy + r.ry * Math.sin(th)];
    const st = { L: lineAt(tp, m), m };
    st.R = shift(st.L, k.wh(m));
    // The stroke ends on a chord of the bowl's outer edge: from the tangent point to where the
    // stroke's right edge enters the bowl. The chord is shallower than the ring is thick, so
    // nothing reaches into the counter.
    const foot = upperHit(st.R, r.cx, r.cy, r.rx, r.ry);
    return {
      W,
      solids: [
        ellipse(r.cx, r.cy, r.rx, r.ry),
        poly([tp, atY(st.L, CAP), atY(st.R, CAP), foot]),
      ],
      holes: [ellipse(r.cx, r.cy, r.ix, r.iy)],
    };
  }
  // The upper intersection of the line x = a + m*y with an ellipse.
  function upperHit(l, cx, cy, rx, ry) {
    // ((a + m y - cx)/rx)^2 + ((y - cy)/ry)^2 = 1, a quadratic in y.
    const u = l.a - cx;
    const A = (l.m * l.m) / (rx * rx) + 1 / (ry * ry);
    const Bq = (2 * u * l.m) / (rx * rx) - (2 * cy) / (ry * ry);
    const C = (u * u) / (rx * rx) + (cy * cy) / (ry * ry) - 1;
    const y = (-Bq + Math.sqrt(Bq * Bq - 4 * A * C)) / (2 * A);
    return [xAt(l, y), y];
  }
  B['6'] = (k) => {
    const g = six(k);
    return { w: g.W, lsb: 45, rsb: 40, solids: g.solids, holes: g.holes };
  };
  B['9'] = (k) => {
    const g = six(k);
    const rot = (c) => c.map((cmd) => {
      const out = [cmd[0]];
      for (let i = 1; i < cmd.length; i += 2) out.push(g.W - cmd[i], CAP - cmd[i + 1]);
      return out;
    });
    return { w: g.W, lsb: 40, rsb: 45, solids: g.solids.map(rot), holes: g.holes.map(rot) };
  };

  // --- punctuation ---
  B['.'] = (k) => ({ w: k.s, lsb: 60, rsb: 60, solids: [rect(0, 0, k.s, k.s)] });
  B[','] = (k) => ({
    w: k.s, lsb: 60, rsb: 60,
    solids: [poly([[0, k.s], [0, 0], [-0.45 * k.s, -0.17 * CAP], [0.55 * k.s, -0.17 * CAP], [k.s, 0], [k.s, k.s]])],
  });
  B['-'] = (k) => ({ w: 300, lsb: 45, rsb: 45, solids: [rect(0, 0.45 * CAP - k.t / 2, 300, 0.45 * CAP + k.t / 2)] });
  B["'"] = (k) => ({ w: k.s, lsb: 60, rsb: 60, solids: [rect(0, CAP - 230, k.s, CAP)] });
  B[' '] = () => ({ w: 260, lsb: 0, rsb: 0, solids: [] });

  // ---------- public API ----------

  const fmt = (v) => {
    const r = Math.round(v * 100) / 100;
    return Object.is(r, -0) ? '0' : String(r);
  };
  function contourToD(c, dx = 0) {
    let d = '';
    for (const cmd of c) {
      if (cmd[0] === 'C') d += `C${fmt(cmd[1] + dx)} ${fmt(cmd[2])} ${fmt(cmd[3] + dx)} ${fmt(cmd[4])} ${fmt(cmd[5] + dx)} ${fmt(cmd[6])}`;
      else d += `${cmd[0]}${fmt(cmd[1] + dx)} ${fmt(cmd[2])}`;
    }
    return d + 'Z';
  }

  const cache = new Map();
  function glyph(ch, params) {
    const P = clampParams(params);
    const key = ch + '|' + Object.keys(RULER).map((n) => P[n]).join(',');
    if (cache.has(key)) return cache.get(key);
    const build = B[ch];
    if (!build) return null;
    const k = makeKit(P);
    const g = build(k);
    const contours = [
      ...g.solids.map((c) => orient(c, 1)),
      ...(g.holes || []).map((c) => orient(c, -1)),
    ];
    // Shift so the ink starts at x = lsb.
    const moved = contours.map((c) => c.map((cmd) => {
      const out = [cmd[0]];
      for (let i = 1; i < cmd.length; i += 2) out.push(cmd[i] + g.lsb, cmd[i + 1]);
      return out;
    }));
    const res = {
      ch,
      advance: g.lsb + g.w + g.rsb,
      contours: moved,
      d: moved.map((c) => contourToD(c)).join(''),
    };
    if (cache.size > 4000) cache.clear();
    cache.set(key, res);
    return res;
  }

  // Lay a line of text out from x = 0. Characters outside the set are skipped.
  function layout(text, params, tracking = 0) {
    let x = 0;
    const parts = [];
    for (const raw of String(text)) {
      const ch = raw.toUpperCase();
      const g = glyph(ch, params);
      if (!g) continue;
      parts.push({ ch, x, d: g.contours.map((c) => contourToD(c, x)).join('') });
      x += g.advance + tracking;
    }
    if (parts.length) x -= tracking;
    return { width: Math.max(0, x), parts, d: parts.map((p) => p.d).join('') };
  }

  // Which parameters touch which characters (documented on the page and checked by the tests).
  const AFFECTS = Object.freeze({
    round: 'OQCGSUJ023568 9'.replace(/ /g, ''),
    point: 'AVWM',
    bar: 'every horizontal, diagonal and curved stroke',
    middle: 'HEF',
    halves: 'BPRKXS38',
  });

  // ---------- measuring outlines (the page, the tests and measure.mjs all use these) ----------

  // Closed polylines from contours, cubics flattened finely.
  function polysOf(contours, steps = 48) {
    return contours.map((c) => flattenContour(c, steps));
  }
  function bboxOf(polys) {
    let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
    for (const p of polys) {
      for (const [x, y] of p) {
        if (x < xMin) xMin = x;
        if (x > xMax) xMax = x;
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
      }
    }
    return { xMin, yMin, xMax, yMax };
  }
  // Where a horizontal line y = v (axis 'h') or a vertical line x = v (axis 'v') enters or leaves
  // the filled region, under the nonzero rule. Overlapping pieces of a glyph therefore count once,
  // and the result is the same for any outline that fills the same region.
  function scanLine(polys, axis, v) {
    const hits = [];
    for (const p of polys) {
      for (let i = 0; i < p.length; i++) {
        const a = p[i];
        const b = p[(i + 1) % p.length];
        const u0 = axis === 'h' ? a[1] : a[0];
        const u1 = axis === 'h' ? b[1] : b[0];
        if (u0 <= v === u1 <= v) continue;
        const w0 = axis === 'h' ? a[0] : a[1];
        const w1 = axis === 'h' ? b[0] : b[1];
        hits.push([w0 + ((v - u0) * (w1 - w0)) / (u1 - u0), u1 > u0 ? 1 : -1]);
      }
    }
    hits.sort((p, q) => p[0] - q[0]);
    const out = [];
    let wind = 0;
    for (let i = 0; i < hits.length; ) {
      let j = i;
      let dw = 0;
      while (j < hits.length && hits[j][0] - hits[i][0] < 1e-7) dw += hits[j++][1];
      const before = wind !== 0;
      wind += dw;
      if (before !== (wind !== 0)) out.push(hits[i][0]);
      i = j;
    }
    return out;
  }
  function expectCount(arr, n, what) {
    if (arr.length !== n) throw new Error(`${what}: expected ${n} boundary crossings, found ${arr.length}`);
    return arr;
  }
  // The numbers the page asks the eye for, measured off the outlines of H O A V 8 B.
  // getPolys(ch) returns closed polylines (any orientation, y up, baseline at 0).
  function measureSet(getPolys) {
    const get = (ch) => {
      const polys = getPolys(ch);
      return { polys, box: bboxOf(polys) };
    };
    const H = get('H'), O = get('O'), A = get('A'), V = get('V'), E8 = get('8'), Bb = get('B');
    const cap = H.box.yMax;
    const sx = expectCount(scanLine(H.polys, 'h', 0.25 * cap), 4, 'H stems');
    const stem = (sx[1] - sx[0] + (sx[3] - sx[2])) / 2;
    const by = expectCount(scanLine(H.polys, 'v', (H.box.xMin + H.box.xMax) / 2), 2, 'H bar');
    const halves = (G, xFrac) => {
      const ys = expectCount(scanLine(G.polys, 'v', G.box.xMin + xFrac * (G.box.xMax - G.box.xMin)), 6, 'storeys');
      const top = ys[5] - ys[2];
      const bottom = ys[3] - ys[0];
      return top / (top + bottom);
    };
    const roundTop = (O.box.yMax - cap) / cap;
    const roundBottom = (H.box.yMin - O.box.yMin) / cap;
    const pointTop = (A.box.yMax - cap) / cap;
    const pointBottom = (H.box.yMin - V.box.yMin) / cap;
    return {
      cap,
      stem,
      round: (roundTop + roundBottom) / 2,
      roundTop,
      roundBottom,
      point: (pointTop + pointBottom) / 2,
      pointTop,
      pointBottom,
      bar: (by[1] - by[0]) / stem,
      middle: (by[0] + by[1]) / 2 / cap,
      halves8: halves(E8, 0.5),
      // A B with a very small top storey has no counter under the 62% line; report NaN then.
      halvesB: (() => {
        try {
          return halves(Bb, 0.62);
        } catch (e) {
          return NaN;
        }
      })(),
    };
  }
  function measureParams(params) {
    return measureSet((ch) => polysOf(glyph(ch, params).contours));
  }

  // ---------- checks the page runs live (the tests run these and more) ----------

  function mapPolys(polys, f) {
    return polys.map((p) => p.map(f));
  }
  // Largest distance from any sampled boundary point of one outline to the other's boundary.
  function hausdorff(pa, pb) {
    const segs = (polys) => {
      const out = [];
      for (const p of polys) for (let i = 0; i < p.length; i++) out.push([p[i], p[(i + 1) % p.length]]);
      return out;
    };
    const dist = (pt, sg) => {
      let best = Infinity;
      for (const [a, b] of sg) {
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const L2 = dx * dx + dy * dy;
        let u = L2 ? ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / L2 : 0;
        u = Math.max(0, Math.min(1, u));
        const d = Math.hypot(pt[0] - a[0] - u * dx, pt[1] - a[1] - u * dy);
        if (d < best) best = d;
      }
      return best;
    };
    const one = (p, sg) => {
      let worst = 0;
      for (const poly of p) for (const pt of poly) worst = Math.max(worst, dist(pt, sg));
      return worst;
    };
    return Math.max(one(pa, segs(pb)), one(pb, segs(pa)));
  }
  const SYMMETRY = Object.freeze({
    mirror: 'AHIMOTUVWXY08', // left to right
    flip: 'BCDEHIKOX038', // top to bottom
    turn: 'HINOSXZ08', // half a turn
  });
  function symmetryError(ch, kind, params = RULER) {
    const polys = polysOf(glyph(ch, params).contours, 24);
    const b = bboxOf(polys);
    const cx = (b.xMin + b.xMax) / 2;
    const f =
      kind === 'mirror'
        ? ([x, y]) => [2 * cx - x, y]
        : kind === 'flip'
          ? ([x, y]) => [x, CAP - y]
          : ([x, y]) => [2 * cx - x, CAP - y];
    return hausdorff(polys, mapPolys(polys, f));
  }
  function verifyRuler() {
    const results = [];
    const off = [];
    for (const ch of LETTERS + FIGURES) {
      const b = bboxOf(polysOf(glyph(ch, RULER).contours, 8));
      const lowOk = ch === 'Q' ? b.yMin < 0 : Math.abs(b.yMin) < 1e-6;
      if (!lowOk || Math.abs(b.yMax - CAP) > 1e-6) off.push(ch);
    }
    results.push({
      name: 'Every letter and figure touches the baseline and the cap height, and goes no further (the tail of Q hangs below)',
      pass: off.length === 0,
      detail: off.length ? `off the lines: ${off.join(' ')}` : `${LETTERS.length + FIGURES.length} of ${LETTERS.length + FIGURES.length}`,
    });
    const words = { mirror: 'left to right', flip: 'top to bottom', turn: 'under a half turn' };
    for (const kind of Object.keys(SYMMETRY)) {
      const bad = [];
      let worst = 0;
      for (const ch of SYMMETRY[kind]) {
        const e = symmetryError(ch, kind);
        worst = Math.max(worst, e);
        if (e > 0.01) bad.push(ch);
      }
      results.push({
        name: `${SYMMETRY[kind].split('').join(' ')} are symmetric ${words[kind]}`,
        pass: bad.length === 0,
        detail: bad.length ? `not symmetric: ${bad.join(' ')}` : `largest mismatch ${worst.toFixed(4)} units of 700`,
      });
    }
    const m = measureParams(RULER);
    const strokes = [
      ['H stems', m.stem],
      ['H crossbar', m.bar * m.stem],
    ];
    results.push({
      name: 'Upright and horizontal strokes are equally thick (H measured, 100 units each)',
      pass: strokes.every(([, v]) => Math.abs(v - STEM) < 0.01),
      detail: strokes.map(([n, v]) => `${n} ${v.toFixed(2)}`).join(', '),
    });
    results.push({
      name: 'The H crossbar is centred at exactly half the cap height; the 8 has two equal storeys',
      pass: Math.abs(m.middle - 0.5) < 1e-6 && Math.abs(m.halves8 - 0.5) < 1e-6,
      detail: `bar centre ${(m.middle * CAP).toFixed(2)} of 700; top storey's share ${m.halves8.toFixed(4)}`,
    });
    return results;
  }

  return {
    CAP,
    STEM,
    RULER,
    LIMITS,
    LETTERS,
    FIGURES,
    PUNCT,
    CHARSET,
    AFFECTS,
    clampParams,
    glyph,
    layout,
    flattenContour,
    signedArea,
    polysOf,
    bboxOf,
    scanLine,
    measureSet,
    measureParams,
    hausdorff,
    SYMMETRY,
    symmetryError,
    verifyRuler,
  };
});
