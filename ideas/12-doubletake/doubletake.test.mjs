// Run from the repo root: node --test ideas/12-doubletake/doubletake.test.mjs
//
// Generates the pot at the defaults, at both ends of every slider, at the corners of the
// parameter box, for every ordered pair of the ten shapes (at the defaults and at four
// hard corners) and for a seeded random sample; writes each one as binary STL, parses it
// back with the reader below, and checks it using only the parsed triangles wherever it
// can (the generator's own bookkeeping is used only to locate the rim stations):
//
//   closed 2-manifold: every edge in exactly two triangles, once in each direction
//     (consistent winding), one connected shell, V − E + F = 2
//   no degenerate triangles (area ≥ 1e-4 mm², every edge ≥ 20 µm), no duplicate vertices
//   positive signed volume; stored normals agree with the winding
//   bounding box as claimed; fits a 180 mm cube; height ≤ 4 × narrowest footprint side
//   overhang: every downward-facing triangle off the bed lies in the 0.5 mm chamfer band
//     and leans at most 42° from vertical
//   flat base: every downward horizontal triangle is at z = 0
//   height field: along sampled vertical lines the surface is crossed exactly twice
//     inside the footprint (bed or chamfer, then floor or rim) and never outside — no
//     overhang, no enclosed void, no folded band
//   walls: the outer outline (vertices at z = 0.5) and the inner outline (vertices at
//     z = floor) are read from the wall triangles; their exact minimum distance (vertex
//     to segment, both ways) is ≥ the wall setting; floor slab = floor setting; a random
//     ray-cast sample of local thickness agrees
//   self-intersection: no two triangles that share no vertex intersect or touch
//     (separating-axis test on every pair whose bounding boxes overlap); triangles that
//     share one vertex meet only there (opposite-edge test)
//   the illusion: every rim station projects onto the eye shape and the mirror shape
// and reports volume and PLA mass (1.24 g/cm³).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const D = require('./doubletake.js');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const { SHAPES, PARAMS, CHAMFER, LIMITS } = D;
const DEG = 180 / Math.PI;
const f32 = Math.fround;

// ------------------------------------------------------------ independent STL reader
function readSTL(buf) {
  if (buf.byteLength < 84) throw new Error('STL too short');
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const n = dv.getUint32(80, true);
  if (buf.byteLength !== 84 + 50 * n) throw new Error('binary STL length does not match its triangle count');
  const head = Buffer.from(buf.buffer, buf.byteOffset, 5).toString('ascii');
  assert.notEqual(head, 'solid', 'binary STL header must not start with "solid"');
  const tris = [];
  for (let t = 0; t < n; t++) {
    const o = 84 + 50 * t;
    const nrm = [0, 1, 2].map((k) => dv.getFloat32(o + 4 * k, true));
    const v = [];
    for (let k = 0; k < 3; k++) v.push([0, 1, 2].map((c) => dv.getFloat32(o + 12 + 12 * k + 4 * c, true)));
    tris.push({ nrm, v });
  }
  return tris;
}

/** Weld identical float32 vertices back into an indexed mesh. */
function weld(tris) {
  const map = new Map();
  const verts = [];
  const idx = [];
  for (const t of tris) {
    for (const p of t.v) {
      const key = p.join(',');
      let i = map.get(key);
      if (i === undefined) { i = verts.length; verts.push(p); map.set(key, i); }
      idx.push(i);
    }
  }
  return { verts, idx };
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);

function manifoldReport(mesh) {
  const edges = new Map();
  const F = mesh.idx.length / 3;
  for (let t = 0; t < F; t++) {
    for (let k = 0; k < 3; k++) {
      const a = mesh.idx[3 * t + k], b = mesh.idx[3 * t + ((k + 1) % 3)];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      const e = edges.get(key) || { fwd: 0, rev: 0, tris: [] };
      if (a < b) e.fwd++; else e.rev++;
      e.tris.push(t);
      edges.set(key, e);
    }
  }
  let bad = 0;
  // union-find over triangles through shared edges: the number of shells
  const parent = Int32Array.from({ length: F }, (_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (const e of edges.values()) {
    if (e.fwd !== 1 || e.rev !== 1) bad++;
    for (let k = 1; k < e.tris.length; k++) parent[find(e.tris[k])] = find(e.tris[0]);
  }
  let shells = 0;
  for (let i = 0; i < F; i++) if (find(i) === i) shells++;
  return { badEdges: bad, euler: mesh.verts.length - edges.size + F, shells };
}

function geometryReport(tris) {
  let volume = 0, minArea = Infinity, minEdge = Infinity, worstOverhang = 0, highestOverhang = -Infinity, normalMismatch = 0, bedArea = 0;
  const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const { nrm, v } of tris) {
    for (const p of v) for (let k = 0; k < 3; k++) { bb[k] = Math.min(bb[k], p[k]); bb[3 + k] = Math.max(bb[3 + k], p[k]); }
    const n = cross(sub(v[1], v[0]), sub(v[2], v[0]));
    const l = len(n);
    minArea = Math.min(minArea, l / 2);
    minEdge = Math.min(minEdge, len(sub(v[1], v[0])), len(sub(v[2], v[1])), len(sub(v[0], v[2])));
    volume += dot(v[0], cross(v[1], v[2])) / 6;
    if (l > 0) {
      const u = n.map((c) => c / l);
      if (dot(u, nrm) < 0.999) normalMismatch++;
      if (u[2] < -1e-9) {
        const onBed = v.every((p) => p[2] === 0);
        if (onBed) bedArea += l / 2;
        else {
          worstOverhang = Math.max(worstOverhang, Math.asin(Math.min(1, -u[2])) * DEG);
          highestOverhang = Math.max(highestOverhang, ...v.map((p) => p[2]));
        }
      }
    }
  }
  return { volume, minArea, minEdge, worstOverhang, highestOverhang, normalMismatch, bbox: bb, bedArea };
}

/** Möller–Trumbore ray/triangle hit distance, or Infinity. */
function hit(orig, dir, v) {
  const e1 = sub(v[1], v[0]), e2 = sub(v[2], v[0]);
  const p = cross(dir, e1);
  const det = dot(e2, p);
  if (Math.abs(det) < 1e-12) return Infinity;
  const inv = 1 / det;
  const s = sub(orig, v[0]);
  const u = dot(s, p) * inv;
  if (u < -1e-9 || u > 1 + 1e-9) return Infinity;
  const q = cross(s, e2);
  const w = dot(dir, q) * inv;
  if (w < -1e-9 || u + w > 1 + 1e-9) return Infinity;
  const t = dot(e1, q) * inv;
  return t > 1e-6 ? t : Infinity;
}

function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/**
 * Shoot rays into the material from random points on the inner wall (horizontal rays:
 * the wall width a slicer sees) and on the horizontal faces (vertical rays: the floor
 * slab); the nearest exit is the local thickness. Inner-wall triangles are the vertical
 * ones with no vertex at the chamfer height (every outer-wall triangle has one). Left
 * out on purpose: the sloped rim band and the chamfer (a ray along their normal runs
 * slantwise through the wall and measures that slant), and the outer wall, because a
 * ray from it near a sharp outside corner crosses the corner's solid wedge, which is
 * legitimately thinner than the wall close to its tip.
 */
function rayThickness(tris, samples, seed) {
  const rnd = lcg(seed);
  const rise = f32(CHAMFER.rise);
  const areas = tris.map(({ v }) => {
    const n = cross(sub(v[1], v[0]), sub(v[2], v[0]));
    const nz = Math.abs(n[2]) / len(n);
    if (nz > 1 - 1e-6) return len(n) / 2;
    if (nz < 1e-6 && !v.some((p) => p[2] === rise)) return len(n) / 2;
    return 0;
  });
  const total = areas.reduce((a, b) => a + b, 0);
  let minT = Infinity;
  for (let i = 0; i < samples; i++) {
    let pick = rnd() * total, k = 0;
    while (k < tris.length - 1 && pick > areas[k]) { pick -= areas[k]; k++; }
    const { v } = tris[k];
    let a = rnd(), b = rnd();
    if (a + b > 1) { a = 1 - a; b = 1 - b; }
    const o = [0, 1, 2].map((c) => v[0][c] + a * (v[1][c] - v[0][c]) + b * (v[2][c] - v[0][c]));
    const n = cross(sub(v[1], v[0]), sub(v[2], v[0]));
    const l = len(n);
    const dir = n.map((c) => -c / l);
    let best = Infinity;
    for (let j = 0; j < tris.length; j++) {
      if (j === k) continue;
      const t = hit(o, dir, tris[j].v);
      if (t < best) best = t;
    }
    minT = Math.min(minT, best);
  }
  return minT;
}

/**
 * Vertical lines through random points of the bounding box (plus a margin). For each,
 * collect the z of every non-vertical triangle the line passes through, split by facing.
 * A solid that is one interval per vertical line is crossed by exactly one downward-
 * facing triangle (entering from below) and one upward-facing triangle above it.
 */
function verticalLines(tris, samples, seed) {
  const rnd = lcg(seed);
  const flat = [];
  for (const { v } of tris) {
    const a2 = (v[1][0] - v[0][0]) * (v[2][1] - v[0][1]) - (v[1][1] - v[0][1]) * (v[2][0] - v[0][0]);
    if (Math.abs(a2) < 1e-12) continue; // vertical in plan: a line meets it only on its edge
    flat.push({ v, a2, minx: Math.min(v[0][0], v[1][0], v[2][0]), maxx: Math.max(v[0][0], v[1][0], v[2][0]),
      miny: Math.min(v[0][1], v[1][1], v[2][1]), maxy: Math.max(v[0][1], v[1][1], v[2][1]) });
  }
  let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
  for (const t of flat) { bx0 = Math.min(bx0, t.minx); bx1 = Math.max(bx1, t.maxx); by0 = Math.min(by0, t.miny); by1 = Math.max(by1, t.maxy); }
  const report = { inside: 0, outside: 0, bad: [] };
  for (let i = 0; i < samples; i++) {
    const x = bx0 - 2 + (bx1 - bx0 + 4) * rnd(), y = by0 - 2 + (by1 - by0 + 4) * rnd();
    const up = [], down = [];
    for (const t of flat) {
      if (x < t.minx || x > t.maxx || y < t.miny || y > t.maxy) continue;
      const [p, q, r] = t.v;
      const w0 = (q[0] - x) * (r[1] - y) - (q[1] - y) * (r[0] - x);
      const w1 = (r[0] - x) * (p[1] - y) - (r[1] - y) * (p[0] - x);
      const w2 = (p[0] - x) * (q[1] - y) - (p[1] - y) * (q[0] - x);
      const s = Math.sign(t.a2);
      if (w0 * s < 0 || w1 * s < 0 || w2 * s < 0) continue;
      const z = (w0 * p[2] + w1 * q[2] + w2 * r[2]) / t.a2;
      (t.a2 > 0 ? up : down).push(z);
    }
    if (!up.length && !down.length) { report.outside++; continue; }
    if (up.length === 1 && down.length === 1 && up[0] > down[0]) { report.inside++; continue; }
    report.bad.push({ x, y, up, down });
  }
  return report;
}

// ----------------------------------------------------- outlines read from the STL
/**
 * The wall outlines straight from the parsed triangles: the edges of vertical triangles
 * whose two ends are both at height z, chained into a closed loop.
 */
function outlineAt(welded, z) {
  const { verts, idx } = welded;
  const nbr = new Map();
  const link = (a, b) => { (nbr.get(a) || nbr.set(a, new Set()).get(a)).add(b); };
  for (let t = 0; t < idx.length; t += 3) {
    const tri = [idx[t], idx[t + 1], idx[t + 2]];
    const P = tri.map((i) => verts[i]);
    const n = cross(sub(P[1], P[0]), sub(P[2], P[0]));
    if (Math.abs(n[2]) > 1e-9 * len(n)) continue; // vertical triangles only
    for (let k = 0; k < 3; k++) {
      const a = tri[k], b = tri[(k + 1) % 3];
      if (verts[a][2] === z && verts[b][2] === z) { link(a, b); link(b, a); }
    }
  }
  for (const s of nbr.values()) assert.equal(s.size, 2, `outline at z=${z} is a simple loop`);
  const start = nbr.keys().next().value;
  const loop = [start];
  let prev = -1, cur = start;
  for (;;) {
    const next = [...nbr.get(cur)].find((v) => v !== prev);
    if (next === start) break;
    loop.push(next); prev = cur; cur = next;
    assert.ok(loop.length <= nbr.size, 'outline closes');
  }
  assert.equal(loop.length, nbr.size, `one loop at z=${z}`);
  const pts = loop.map((i) => ({ x: verts[i][0], y: verts[i][1] }));
  return loopArea(pts) < 0 ? pts.reverse() : pts; // adjacency has no direction; make it CCW

}

function segDist(px, py, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - a.x) * dx + (py - a.y) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(a.x + t * dx - px, a.y + t * dy - py);
}
/** Exact minimum distance between two closed polylines that do not cross. */
function loopGap(A, B) {
  let best = Infinity;
  for (const [P, Q] of [[A, B], [B, A]]) {
    for (const p of P) for (let i = 0; i < Q.length; i++) best = Math.min(best, segDist(p.x, p.y, Q[i], Q[(i + 1) % Q.length]));
  }
  return best;
}
function pointInPoly(px, py, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > py) !== (b.y > py) && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function loopArea(r) {
  let a = 0;
  for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p.x * q.y - q.x * p.y; }
  return a / 2;
}

// ---------------------------------------------------------- self-intersection
/** Separating-axis test for two triangles; true if some axis separates them by > eps. */
function separated(A, B, eps) {
  const apart = (ax) => {
    const l = len(ax);
    if (l < 1e-12) return false;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const p of A) { const d = dot(p, ax) / l; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
    for (const p of B) { const d = dot(p, ax) / l; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
    return a1 < b0 - eps || b1 < a0 - eps;
  };
  const eA = [sub(A[1], A[0]), sub(A[2], A[1]), sub(A[0], A[2])];
  const eB = [sub(B[1], B[0]), sub(B[2], B[1]), sub(B[0], B[2])];
  const nA = cross(eA[0], eA[1]), nB = cross(eB[0], eB[1]);
  if (apart(nA) || apart(nB)) return true;
  for (const a of eA) for (const b of eB) if (apart(cross(a, b))) return true;
  for (const e of eA) if (apart(cross(nA, e))) return true;
  for (const e of eB) if (apart(cross(nB, e))) return true;
  return false;
}
/** Does the closed segment pq meet the closed triangle T (non-coplanar case)? */
function segHitsTri(p, q, T) {
  const d = sub(q, p);
  const e1 = sub(T[1], T[0]), e2 = sub(T[2], T[0]);
  const h = cross(d, e2);
  const det = dot(e1, h);
  if (Math.abs(det) < 1e-14) return false;
  const s = sub(p, T[0]);
  const u = dot(s, h) / det;
  if (u < -1e-9 || u > 1 + 1e-9) return false;
  const qq = cross(s, e1);
  const v = dot(d, qq) / det;
  if (v < -1e-9 || u + v > 1 + 1e-9) return false;
  const t = dot(e2, qq) / det;
  return t >= -1e-9 && t <= 1 + 1e-9;
}
function selfIntersections(welded) {
  const { verts, idx } = welded;
  const F = idx.length / 3;
  const T = [], box = [];
  for (let t = 0; t < F; t++) {
    const ids = [idx[3 * t], idx[3 * t + 1], idx[3 * t + 2]];
    const P = ids.map((i) => verts[i]);
    T.push({ ids, P });
    box.push([0, 1, 2].map((k) => Math.min(P[0][k], P[1][k], P[2][k])).concat([0, 1, 2].map((k) => Math.max(P[0][k], P[1][k], P[2][k]))));
  }
  const order = Array.from({ length: F }, (_, i) => i).sort((a, b) => box[a][0] - box[b][0]);
  let pairs = 0, bad = 0;
  const E = 1e-7;
  for (let ii = 0; ii < F; ii++) {
    const a = order[ii], A = box[a];
    for (let jj = ii + 1; jj < F; jj++) {
      const b = order[jj], B = box[b];
      if (B[0] > A[3] + E) break;
      if (B[1] > A[4] + E || A[1] > B[4] + E || B[2] > A[5] + E || A[2] > B[5] + E) continue;
      const shared = T[a].ids.filter((v) => T[b].ids.includes(v));
      pairs++;
      if (shared.length === 0) {
        if (!separated(T[a].P, T[b].P, 1e-7)) bad++;
      } else if (shared.length === 1) {
        // Two triangles that share only vertex V meet elsewhere iff the edge opposite V in
        // one of them meets the other (non-coplanar), or, coplanar, iff they overlap.
        const v = shared[0];
        const oa = T[a].ids.filter((x) => x !== v).map((i) => verts[i]);
        const ob = T[b].ids.filter((x) => x !== v).map((i) => verts[i]);
        const nA = cross(sub(T[a].P[1], T[a].P[0]), sub(T[a].P[2], T[a].P[0]));
        const nB = cross(sub(T[b].P[1], T[b].P[0]), sub(T[b].P[2], T[b].P[0]));
        const coplanar = len(cross(nA, nB)) < 1e-9 * len(nA) * len(nB) && Math.abs(dot(nA, sub(ob[0], verts[v]))) < 1e-9 * len(nA);
        if (coplanar) { if (dot(nA, nB) < 0 || !separated(T[a].P, T[b].P, -1e-9)) bad++; }
        else if (segHitsTri(oa[0], oa[1], T[b].P) || segHitsTri(ob[0], ob[1], T[a].P)) bad++;
      } else if (shared.length === 2) {
        // Sharing an edge: they overlap only if folded flat onto each other.
        const nA = cross(sub(T[a].P[1], T[a].P[0]), sub(T[a].P[2], T[a].P[0]));
        const nB = cross(sub(T[b].P[1], T[b].P[0]), sub(T[b].P[2], T[b].P[0]));
        if (len(cross(nA, nB)) < 1e-9 * len(nA) * len(nB) && dot(nA, nB) < 0) bad++;
      }
    }
  }
  return { pairs, bad };
}

// ---------------------------------------------------------------- the full check
const STATS = { maxIllusion: 0, maxChord: 0, cases: 0, minArea: Infinity, minEdge: Infinity, worstOverhang: 0, minWallExcess: Infinity, maxSlender: 0, maxZ: 0, maxDepth: 0, selfPairs: 0 };
function checkCase(params, { rays = 0, lines = 200, selfX = false, label = '' } = {}) {
  const mesh = D.buildMesh(params);
  const p = mesh.params;
  const buf = Buffer.from(D.toSTL(mesh, 'Doubletake test'));
  const tris = readSTL(buf);
  assert.equal(tris.length, mesh.triangles.length / 3, 'STL holds every triangle');

  const welded = weld(tris);
  const m = manifoldReport(welded);
  assert.equal(m.badEdges, 0, `${label} every edge is shared by exactly two triangles, once each way`);
  assert.equal(m.shells, 1, `${label} one connected shell`);
  assert.equal(m.euler, 2, `${label} V−E+F = 2 (a sphere: no handles)`);
  assert.equal(welded.verts.length, mesh.positions.length / 3, `${label} no two vertices collapse in float32`);

  const g = geometryReport(tris);
  assert.ok(g.minArea >= 1e-4, `${label} smallest triangle ${g.minArea.toExponential(2)} mm² is not degenerate`);
  STATS.minArea = Math.min(STATS.minArea, g.minArea); STATS.minEdge = Math.min(STATS.minEdge, g.minEdge);
  STATS.worstOverhang = Math.max(STATS.worstOverhang, g.worstOverhang); STATS.cases++;
  assert.ok(g.minEdge >= 0.0199, `${label} shortest edge ${g.minEdge.toExponential(2)} mm`);
  assert.ok(g.volume > 0, `${label} positive signed volume (outward winding)`);
  assert.ok(Math.abs(g.volume - mesh.stats.volume) < 1e-5 * mesh.stats.volume, `${label} STL volume matches the generator`);
  assert.equal(g.normalMismatch, 0, `${label} stored normals agree with vertex winding`);
  assert.ok(g.worstOverhang <= CHAMFER.maxDeg + 1e-6, `${label} steepest overhang ${g.worstOverhang.toFixed(2)}° ≤ ${CHAMFER.maxDeg}°`);
  assert.ok(g.highestOverhang <= CHAMFER.rise, `${label} every overhang is inside the ${CHAMFER.rise} mm base chamfer`);

  const bb = g.bbox;
  const close = (a, b, msg, tol = 1e-4) => assert.ok(Math.abs(a - b) < tol, `${msg}: ${a} vs ${b}`);
  close(bb[0], -p.width / 2, `${label} bbox x min`);
  close(bb[3], p.width / 2, `${label} bbox x max`);
  close(bb[1], mesh.bbox.y[0], `${label} bbox y min`);
  close(bb[4], mesh.bbox.y[1], `${label} bbox y max`);
  close(bb[2], 0, `${label} sits on z = 0`);
  close(bb[5], mesh.rimHigh, `${label} bbox z max`);
  assert.ok(bb[5] <= LIMITS.zMax && bb[4] - bb[1] <= LIMITS.zMax && bb[3] - bb[0] <= LIMITS.zMax, `${label} fits a ${LIMITS.zMax} mm cube`);
  assert.ok(bb[4] - bb[1] <= 2 * p.width + 1e-9, `${label} depth ≤ 2 × width`);
  const slender = bb[5] / Math.min(bb[3] - bb[0], bb[4] - bb[1]);
  assert.ok(slender <= LIMITS.slender + 1e-6, `${label} height / narrowest side = ${slender.toFixed(3)} ≤ ${LIMITS.slender}`);
  assert.ok(mesh.sizeOK, `${label} the size rules can be met`);
  // the lowest rim point is the (possibly capped) height setting
  let rimLow = Infinity;
  for (const q of mesh.ring) rimLow = Math.min(rimLow, q.z);
  close(rimLow, p.height, `${label} lowest rim point is the height setting`, 1e-9);

  // Flat base: every down-facing horizontal triangle is on the bed.
  for (const { v } of tris) {
    const n = cross(sub(v[1], v[0]), sub(v[2], v[0]));
    if (n[2] < -0.999999 * len(n)) assert.ok(v.every((q) => q[2] === 0), `${label} horizontal down-facing faces are on the bed`);
  }

  // Walls, from the STL alone: outer outline at z = rise, inner outline at z = floor.
  const outer = outlineAt(welded, f32(CHAMFER.rise));
  const inner = outlineAt(welded, f32(p.floor));
  assert.ok(D.isSimple(outer) && D.isSimple(inner), `${label} outlines are simple polygons`);
  for (const q of inner) assert.ok(pointInPoly(q.x, q.y, outer), `${label} inner outline lies inside the outer`);
  const minWall = loopGap(outer, inner);
  assert.ok(minWall >= p.wall, `${label} wall ${minWall.toFixed(5)} ≥ ${p.wall}`);
  STATS.minWallExcess = Math.min(STATS.minWallExcess, minWall - p.wall);
  STATS.maxSlender = Math.max(STATS.maxSlender, slender); STATS.maxZ = Math.max(STATS.maxZ, bb[5]); STATS.maxDepth = Math.max(STATS.maxDepth, bb[4] - bb[1]);
  // Floor: the up-facing horizontal faces below the rim are the floor top, at z = floor.
  for (const { v } of tris) {
    const n = cross(sub(v[1], v[0]), sub(v[2], v[0]));
    if (n[2] > 0.999999 * len(n) && v[0][2] < mesh.rimLow - 1) {
      for (const q of v) assert.equal(q[2], f32(p.floor), `${label} floor top at z = ${p.floor}`);
    }
  }
  // Bed contact: the bottom face is the outline shrunk by the chamfer inset.
  assert.ok(g.bedArea > 0.9 * loopArea(outer) - 0.5 * 2 * (bb[3] - bb[0] + bb[4] - bb[1]), `${label} bed contact is most of the footprint`);

  if (lines) {
    const vl = verticalLines(tris, lines, 7);
    assert.equal(vl.bad.length, 0, `${label} every vertical line crosses the surface 0 or 2 times: ${JSON.stringify(vl.bad[0])}`);
    assert.ok(vl.inside > 0 && vl.outside > 0, `${label} vertical lines sampled both inside and outside`);
  }
  if (rays) {
    const t = rayThickness(tris, rays, 12);
    assert.ok(t >= Math.min(p.wall, p.floor) * (1 - 1e-4), `${label} ray-cast thickness ${t.toFixed(4)} ≥ ${Math.min(p.wall, p.floor)}`);
  }
  let si = null;
  if (selfX) {
    si = selfIntersections(welded);
    assert.equal(si.bad, 0, `${label} no self-intersections (${si.pairs} close pairs tested)`);
    STATS.selfPairs += si.pairs;
  }

  // The illusion: every rim station is an STL vertex, and that vertex projects onto the
  // eye shape and the mirror shape.
  const { A, B, R } = mesh;
  const phi = p.angle / DEG, s = Math.sin(phi), c = Math.cos(phi);
  const vset = new Set(welded.verts.map((v) => v.join(',')));
  let worst = 0;
  for (const q of mesh.ring) {
    const key = [f32(q.x), f32(q.y), f32(q.z)].join(',');
    assert.ok(vset.has(key), `${label} rim station is an STL vertex`);
    const [x, y, z] = key.split(',').map(Number);
    // Project the exported (float32) vertex the way the eye and the mirror see it, and
    // measure the distance to the point of the shape it was meant to land on. (u is the
    // station's parameter; evaluating the shape at the rounded x instead would amplify
    // float32 noise through the vertical tangent at the pinch.)
    const u = q.u;
    const eye = [x, (z - mesh.zShift) * c - y * s], mirror = [x, (z - mesh.zShift) * c + y * s];
    const wantEye = [u * R, (q.branch === 'near' ? A.bottom(u) : A.top(u)) * R];
    const wantMirror = [u * R, (q.branch === 'near' ? B.top(u) : B.bottom(u)) * R];
    worst = Math.max(worst, Math.hypot(eye[0] - wantEye[0], eye[1] - wantEye[1]), Math.hypot(mirror[0] - wantMirror[0], mirror[1] - wantMirror[1]));
  }
  assert.ok(worst < 2e-4, `${label} rim projects onto both shapes within ${worst.toExponential(2)} mm (float32 rounding)`);
  STATS.maxIllusion = Math.max(STATS.maxIllusion, worst);
  const chord = D.chordError(mesh).worst;
  assert.ok(chord < 0.2, `${label} rim edges stray ≤ ${chord.toFixed(3)} mm from the shapes between stations`);
  STATS.maxChord = Math.max(STATS.maxChord, chord);
  if (p.eye !== p.mirror) {
    let diff = 0;
    for (const q of mesh.ring) diff = Math.max(diff, Math.abs(q.eye - q.mirror));
    assert.ok(diff > 0.05 * R, `${label} the two images differ`);
  }

  return { params: p, mesh, buf, tris, report: { ...g, ...m, minWall, slender, illusion: worst, selfX: si } };
}

const fmt = (mesh, r) => `${mesh.footprint.width.toFixed(1)} × ${mesh.footprint.depth.toFixed(2)} × ${mesh.rimHigh.toFixed(2)} mm, ` +
  `${mesh.stats.triangles} triangles, volume ${(r.volume / 1000).toFixed(2)} cm³, PLA ${(r.volume / 1000 * 1.24).toFixed(1)} g at 100% infill, ` +
  `overhang ≤ ${r.worstOverhang.toFixed(2)}°, wall ≥ ${r.minWall.toFixed(4)} mm`;

// --------------------------------------------------------------------- tests
test('defaults: square to the eye, circle in the mirror (every check, incl. self-intersection)', () => {
  const { mesh, report, params } = checkCase({}, { rays: 600, lines: 2000, selfX: true, label: 'default' });
  console.log(`# default: ${fmt(mesh, report)}, rim ${mesh.rimLow}–${mesh.rimHigh.toFixed(2)} mm, chord error ${D.chordError(mesh).worst.toFixed(4)} mm, ` +
    `bed contact ${report.bedArea.toFixed(0)} mm², slenderness ${report.slender.toFixed(2)}, illusion error ${report.illusion.toExponential(1)} mm, ` +
    `${report.selfX.pairs} close triangle pairs tested`);
  const cm3 = report.volume / 1000;
  assert.ok(cm3 > 20 && cm3 < 80, 'plausible volume for a pen pot');
  assert.ok(Math.abs(mesh.massPLA - mesh.stats.volume / 1000 * 1.24) < 1e-9);
  assert.ok(Math.abs(mesh.footprint.depth - params.width / Math.sin(params.angle / DEG)) < 1e-6,
    'a circle/square pair is stretched by 1/sin(angle) front to back');
  assert.ok(!mesh.capped, 'the default height is not capped');
});

test('the bundled example STL is exactly what the generator makes at the defaults', () => {
  const file = path.join(HERE, 'example-square-eye-circle-mirror.stl');
  assert.ok(fs.existsSync(file), 'example STL is present');
  const fresh = Buffer.from(D.toSTL(D.buildMesh({}), 'Doubletake example: square to the eye, circle in the mirror, 45 deg'));
  const disk = fs.readFileSync(file);
  assert.ok(fresh.equals(disk), 'byte-identical');
  assert.ok(disk.byteLength < 150 * 1024, `small enough to ship (${(disk.byteLength / 1024).toFixed(1)} KB)`);
  const tris = readSTL(disk);
  const m = manifoldReport(weld(tris));
  assert.equal(m.badEdges, 0);
  assert.equal(m.shells, 1);
});

test('every slider at both ends, one at a time', () => {
  for (const key of Object.keys(PARAMS)) {
    const spec = PARAMS[key];
    if (spec.kind === 'shape') continue;
    for (const v of [spec.min, spec.max]) {
      const { mesh, report } = checkCase({ [key]: v }, { rays: 150, lines: 300, selfX: true, label: `${key}=${v}` });
      console.log(`# ${key}=${v}: ${fmt(mesh, report)}`);
    }
  }
});

test('the corners of the parameter box', () => {
  for (const angle of [PARAMS.angle.min, PARAMS.angle.max]) {
    for (const width of [PARAMS.width.min, PARAMS.width.max]) {
      for (const wall of [PARAMS.wall.min, PARAMS.wall.max]) {
        for (const detail of [PARAMS.detail.min, PARAMS.detail.max]) {
          for (const height of [PARAMS.height.min, PARAMS.height.max]) {
            const floor = height === PARAMS.height.max ? PARAMS.floor.max : PARAMS.floor.min;
            checkCase({ angle, width, wall, detail, height, floor },
              { lines: 100, label: `angle=${angle} width=${width} wall=${wall} detail=${detail} height=${height}` });
          }
        }
      }
    }
  }
});

test('every ordered pair of shapes at the defaults (with the self-intersection test)', () => {
  let worst = { overhang: 0, slender: 0, z: 0, depth: 0 };
  for (const a of SHAPES) {
    for (const b of SHAPES) {
      const { mesh, report } = checkCase({ eye: a.id, mirror: b.id }, { rays: 40, lines: 150, selfX: true, label: `${a.id}/${b.id}` });
      worst = { overhang: Math.max(worst.overhang, report.worstOverhang), slender: Math.max(worst.slender, report.slender),
        z: Math.max(worst.z, mesh.rimHigh), depth: Math.max(worst.depth, mesh.footprint.depth) };
    }
  }
  console.log(`# 100 pairs at the defaults: steepest overhang ${worst.overhang.toFixed(2)}°, tallest ${worst.z.toFixed(1)} mm, deepest ${worst.depth.toFixed(1)} mm, slenderness ≤ ${worst.slender.toFixed(2)}`);
});

test('every pair at the hardest slider corners (thick wall, narrow pot; thin wall, wide pot; tall)', () => {
  const corners = [
    { angle: 30, width: 30, wall: 3.2, detail: 192, height: 100 },
    { angle: 60, width: 30, wall: 3.2, detail: 48, height: 100 },
    { angle: 30, width: 80, wall: 1.2, detail: 48, height: 100 },
    { angle: 60, width: 80, wall: 1.2, detail: 192, height: 100 },
  ];
  let capped = 0, worstOverhang = 0, tallest = 0;
  for (const a of SHAPES) {
    for (const b of SHAPES) {
      for (const c of corners) {
        const { mesh, report } = checkCase({ eye: a.id, mirror: b.id, ...c }, { lines: 40, label: `${a.id}/${b.id} ${JSON.stringify(c)}` });
        if (mesh.capped) capped++;
        worstOverhang = Math.max(worstOverhang, report.worstOverhang);
        tallest = Math.max(tallest, mesh.rimHigh);
      }
    }
  }
  console.log(`# 400 hard cases: ${capped} had their height capped by the size rules; steepest overhang ${worstOverhang.toFixed(2)}°, tallest ${tallest.toFixed(1)} mm`);
});

test('a seeded random sample of 150 parameter sets', () => {
  const rnd = lcg(2026);
  const pick = (spec) => { const k = Math.round((spec.max - spec.min) / spec.step); return +(spec.min + spec.step * Math.floor(rnd() * (k + 1))).toFixed(4); };
  for (let i = 0; i < 150; i++) {
    const p = { eye: SHAPES[Math.floor(rnd() * SHAPES.length)].id, mirror: SHAPES[Math.floor(rnd() * SHAPES.length)].id };
    for (const k of ['angle', 'width', 'height', 'wall', 'floor', 'detail']) p[k] = pick(PARAMS[k]);
    checkCase(p, { lines: 40, selfX: i < 20, label: JSON.stringify(p) });
  }
});

test('size rules: height is capped, never the footprint', () => {
  // Crescent on crescent at a steep angle is the thinnest pot the shapes can make.
  const m = D.buildMesh({ eye: 'moon', mirror: 'moon', angle: 60, width: 30, height: 100 });
  assert.ok(m.capped, 'a tall narrow crescent pot gets its height capped');
  assert.ok(m.slenderness <= LIMITS.slender + 1e-9);
  assert.ok(m.rimLow >= PARAMS.height.min);
  // the cap is the binding one of: 180 mm overall, 4 × narrowest side
  const cap = Math.min(PARAMS.height.max, LIMITS.zMax - m.variation, LIMITS.slender * Math.min(m.footprint.width, m.footprint.depth) - m.variation);
  assert.ok(Math.abs(m.rimLow - cap) < 1e-9, 'capped exactly at the size rule');
  console.log(`# crescent/crescent 60° 30 mm: asked for 100 mm, got ${m.rimLow.toFixed(1)} mm (total ${m.rimHigh.toFixed(1)} mm on a ${m.footprint.depth.toFixed(1)} mm deep footprint)`);
  // and an uncapped request is left alone
  assert.equal(D.buildMesh({ height: 55 }).rimLow, 55);
  // The rules can always be met: every pair at every whole-degree angle, at the narrowest
  // width (every term of the cap grows with the width, so that is the worst case).
  let least = Infinity;
  for (const a of SHAPES) for (const b of SHAPES) for (let angle = PARAMS.angle.min; angle <= PARAMS.angle.max; angle++) {
    least = Math.min(least, D.rim({ eye: a.id, mirror: b.id, angle, width: PARAMS.width.min, detail: PARAMS.detail.min }).heightCap);
  }
  assert.ok(least >= PARAMS.height.min, `smallest height cap ${least} mm`);
  console.log(`# smallest possible height cap: ${least.toFixed(1)} mm (the slider's minimum is ${PARAMS.height.min} mm)`);
});

test('generation runs in short slices', () => {
  // buildSteps yields between phases and every 16 rows of each triangulation table, so a
  // page can hand control back to the browser between slices.
  const it = D.buildSteps({ detail: PARAMS.detail.max, width: PARAMS.width.max, angle: PARAMS.angle.min });
  let slices = 0, longest = 0, last = performance.now();
  for (;;) {
    const s = it.next();
    const now = performance.now();
    longest = Math.max(longest, now - last); last = now; slices++;
    if (s.done) break;
  }
  console.log(`# largest pot: ${slices} slices, longest ${longest.toFixed(1)} ms on this machine`);
  assert.ok(slices > 20, 'the work is split into many slices');
});

test('shape table: x-monotone, centred, pinched at the ends', () => {
  for (const s of SHAPES) {
    assert.ok(Math.abs(s.top(1) - s.bottom(1)) < 1e-9 && Math.abs(s.top(-1) - s.bottom(-1)) < 1e-9, `${s.id} pinches`);
    let hi = -Infinity, lo = Infinity;
    for (let i = 0; i <= 2000; i++) {
      const x = -1 + 2 * i / 2000;
      assert.ok(s.top(x) >= s.bottom(x) - 1e-12, `${s.id} top ≥ bottom at x=${x}`);
      assert.ok(Math.abs(s.top(x) - s.top(-x)) < 1e-12 && Math.abs(s.bottom(x) - s.bottom(-x)) < 1e-12, `${s.id} is left-right symmetric`);
      hi = Math.max(hi, s.top(x)); lo = Math.min(lo, s.bottom(x));
    }
    assert.ok(Math.abs(hi + lo) < 1e-6, `${s.id} is vertically centred (${hi}, ${lo})`);
    assert.ok(Math.abs(hi - lo) > 0.3 && Math.abs(hi - lo) < 2.5, `${s.id} has a sane aspect`);
  }
});

test('normalize clamps and repairs parameters; the reader rejects a bad STL', () => {
  const q = D.normalize({ width: 1000, wall: -3, eye: 'nonsense', detail: '70.4' });
  assert.equal(q.width, PARAMS.width.max);
  assert.equal(q.wall, PARAMS.wall.min);
  assert.equal(q.eye, PARAMS.eye.def);
  assert.equal(q.detail, 70);
  const bogus = Buffer.alloc(84 + 50 * 2 + 7);
  bogus.writeUInt32LE(2, 80);
  assert.throws(() => readSTL(bogus), /STL/);
  // and the generator's own parser agrees with this one on a real file
  const mesh = D.buildMesh({ detail: 48 });
  const ab = D.toSTL(mesh);
  const mine = readSTL(Buffer.from(ab));
  const theirs = D.parseSTL(ab);
  assert.equal(theirs.count, mine.length);
  assert.deepEqual(Array.from(theirs.tris.slice(0, 9)), mine[0].v.flat());
});

test('summary over every generated case', () => {
  console.log(`# ${STATS.cases} meshes checked: smallest triangle ${STATS.minArea.toExponential(2)} mm², shortest edge ${(STATS.minEdge * 1000).toFixed(1)} µm, ` +
    `steepest overhang ${STATS.worstOverhang.toFixed(2)}°, wall exceeds its setting by ≥ ${(STATS.minWallExcess * 1000).toFixed(2)} µm, ` +
    `tallest ${STATS.maxZ.toFixed(1)} mm, deepest ${STATS.maxDepth.toFixed(1)} mm, slenderness ≤ ${STATS.maxSlender.toFixed(3)}, ` +
    `${STATS.selfPairs} close triangle pairs tested for intersection, rim stations land on the shapes within ${STATS.maxIllusion.toExponential(1)} mm (float32), ` +
    `rim edges stray ≤ ${STATS.maxChord.toFixed(3)} mm from the shapes between stations`);
  assert.ok(STATS.cases >= 690);
});
