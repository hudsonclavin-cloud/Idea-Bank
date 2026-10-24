// The printed parts: the committed STLs are what the code makes, every part at every extreme of
// the page's settings is a closed solid that sits on the bed, the walls and gaps are printable,
// and every clearance comes from the fit table. Node built-ins only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { FILES, defaultSTLs } from './build.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const K = createRequire(import.meta.url)('./kepler.js');
const { Mesh } = K;

function segDist(a, b, c, d) {
  const pt = (p, q, r) => {
    const dx = r[0] - q[0];
    const dy = r[1] - q[1];
    const L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, ((p[0] - q[0]) * dx + (p[1] - q[1]) * dy) / L)) : 0;
    return Math.hypot(p[0] - q[0] - t * dx, p[1] - q[1] - t * dy);
  };
  if (Mesh.segmentsCross(a, b, c, d)) return 0;
  return Math.min(pt(a, c, d), pt(b, c, d), pt(c, a, b), pt(d, a, b));
}
function loopDist(A, B) {
  let m = Infinity;
  for (let i = 0; i < A.length; i++)
    for (let j = 0; j < B.length; j++) m = Math.min(m, segDist(A[i], A[(i + 1) % A.length], B[j], B[(j + 1) % B.length]));
  return m;
}
function inside(p, L) {
  let c = false;
  for (let i = 0, j = L.length - 1; i < L.length; j = i++) {
    const a = L[i];
    const b = L[j];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
function bounds(mb) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const v of mb.V)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], v[k]);
      hi[k] = Math.max(hi[k], v[k]);
    }
  return { lo, hi };
}
// The default, and each body at the smallest and largest size with the tightest and loosest bore.
function sweep() {
  const out = [{}];
  for (const body of K.OPTIONS.bodies) {
    const cs = K.cRange(body);
    for (const C of [cs[0], cs[cs.length - 1]]) for (const bore of [0.5, 0.7]) out.push({ body, C, bore });
  }
  return out;
}
function checkSolid(mb, label) {
  const e = Mesh.edgeCheck(mb);
  assert.equal(e.bad, 0, `${label}: ${e.bad} edges not shared by exactly two faces in opposite directions`);
  assert.equal(e.degenerate, 0, `${label}: degenerate faces`);
  assert.ok(Mesh.volume(mb) > 0, `${label}: inside out`);
  const b = bounds(mb);
  assert.equal(b.lo[2], 0, `${label}: lowest point is on the bed`);
  for (let k = 0; k < 3; k++) assert.ok(b.hi[k] - b.lo[k] <= 180, `${label}: fits a 180 mm cube`);
  let onBed = 0;
  for (const cap of mb.caps) {
    // each horizontal face: loops simple and not crossing, holes inside the outline and apart,
    // and its triangles cover exactly its area
    assert.ok(Mesh.loopsSimple(cap.loops), `${label}: crossing loops in a face at z=${cap.z}`);
    const [outer, ...holes] = cap.loops;
    holes.forEach((h, i) => {
      assert.ok(inside(h[0], outer), `${label}: hole outside its face at z=${cap.z}`);
      holes.forEach((g, j) => assert.ok(i === j || !inside(h[0], g), `${label}: nested holes at z=${cap.z}`));
    });
    // (the faces are triangulated at float32 precision, as the STL stores them)
    const f32 = (L) => L.map((q) => [Math.fround(q[0]), Math.fround(q[1])]);
    const area = Math.abs(Mesh.loopArea(f32(outer))) - holes.reduce((s, h) => s + Math.abs(Mesh.loopArea(f32(h))), 0);
    assert.ok(Math.abs(cap.triArea - area) < 1e-9 * area, `${label}: triangulation area at z=${cap.z}`);
    if (cap.z === 0 && !cap.up) onBed += area;
  }
  assert.ok(onBed > 100, `${label}: a flat face on the bed`);
}

test('the committed STLs are exactly what the code makes', () => {
  const made = defaultSTLs();
  for (const file of Object.keys(FILES)) {
    const disk = fs.readFileSync(path.join(here, file));
    assert.ok(Buffer.compare(disk, Buffer.from(made[file])) === 0, `${file} differs from what build.mjs makes`);
  }
});

test('the STL writer: 80-byte header, a count, and every triangle read back exactly', () => {
  const parts = K.buildParts(K.design({}));
  const mb = parts.time;
  const bytes = Mesh.stl(mb, 'kepler-pair time wheel');
  const dv = new DataView(bytes.buffer);
  assert.notEqual(String.fromCharCode(...bytes.slice(0, 5)), 'solid');
  assert.equal(dv.getUint32(80, true), mb.F.length);
  assert.equal(bytes.length, 84 + 50 * mb.F.length);
  mb.F.forEach((f, i) => {
    const o = 84 + 50 * i;
    const v = [0, 1, 2].map((j) => [0, 1, 2].map((k) => dv.getFloat32(o + 12 + 12 * j + 4 * k, true)));
    for (let j = 0; j < 3; j++) assert.deepEqual(v[j], mb.V[f[j]]);
    const n = [0, 1, 2].map((k) => dv.getFloat32(o + 4 * k, true));
    const u = [0, 1, 2].map((k) => v[1][k] - v[0][k]);
    const w = [0, 1, 2].map((k) => v[2][k] - v[0][k]);
    const c = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const cl = Math.hypot(...c);
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(n[k] - c[k] / cl) < 1e-6);
  });
});

test('every part, at the default and at the extremes of every setting, is a closed solid on the bed', () => {
  checkSolid(K.couponMesh(), 'coupon');
  for (const s of sweep()) {
    const d = K.design(s);
    assert.deepEqual(d.problems, [], JSON.stringify(s));
    const p = K.buildParts(d);
    for (const part of ['base', 'time', 'kepler']) checkSolid(p[part], `${d.body} C${d.C} bore ${d.bore} ${part}`);
  }
});

test('walls and gaps are printable, and the dials are never hidden under a hub or a rim', () => {
  for (const s of sweep()) {
    const d = K.design(s);
    const p = K.buildParts(d);
    const label = `${d.body} C${d.C} bore ${d.bore}`;
    for (const w of [p.wk, p.wt]) {
      assert.ok(loopDist(w.outer, w.cavity) >= 2.0, `${label}: rim under the teeth ${loopDist(w.outer, w.cavity)}`);
      assert.ok(loopDist(w.slot, w.cavity) >= 1.9, `${label}: spoke beside the window`);
      assert.ok(loopDist(w.bore, w.cavity) >= 2.3, `${label}: hub wall (2.4 mm, less where the bore's corners meet the spoke)`);
      assert.ok(loopDist(w.bore, w.top) >= 1.6, `${label}: collar or knob wall`);
    }
    const dots = K.dialDots(d);
    const loops = dots.K.concat(dots.T).map(K.dotLoop);
    for (let i = 0; i < loops.length; i++) for (let j = i + 1; j < loops.length; j++) assert.ok(loopDist(loops[i], loops[j]) >= 0.4, `${label}: dots ${i} and ${j} too close`);
    const visible = (dot, cx, rmin, rmax) => K.dotLoop(dot).every(([x, y]) => Math.hypot(x - cx, y) > rmin + 0.5 && Math.hypot(x - cx, y) < rmax - 0.5);
    for (const dot of dots.K) assert.ok(visible(dot, 0, d.hubK, d.rinKmin), `${label}: orbit dot ${dot.k} can be covered`);
    for (const dot of dots.T) assert.ok(visible(dot, -d.C, d.hubT, d.rinTmin), `${label}: time dot ${dot.k} can be covered`);
    const lineWidth = d.F.dot;
    assert.ok(lineWidth >= 0.4 && d.F.engrave >= 0.6, 'engraved marks at least 0.4 mm wide and 0.6 mm deep');
  }
});

// Centre of mass of a closed solid (uniform density), from its signed tetrahedra.
function centreOfMass(mb) {
  let V = 0;
  let x = 0;
  let y = 0;
  for (const f of mb.F) {
    const [a, b, c] = f.map((i) => mb.V[i]);
    const v = (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    V += v;
    x += (v * (a[0] + b[0] + c[0])) / 4;
    y += (v * (a[1] + b[1] + c[1])) / 4;
  }
  return { V, x: x / V, y: y / V };
}

test('each wheel stays on its boss: its centre of mass is 1 mm inside the boss even pushed as far as its bore allows', () => {
  for (const s of sweep()) {
    const d = K.design(s);
    const p = K.buildParts(d);
    const label = `${d.body} C${d.C} bore ${d.bore}`;
    for (const [part, w, bossR] of [['kepler', p.wk, d.bossK], ['time', p.wt, d.bossT]]) {
      // the solid itself (chamfers and all), against the boss's flats: a 24-gon with its corners on bossR
      const c = centreOfMass(p[part]);
      const inside = bossR * Math.cos(Math.PI / 24) - Math.hypot(c.x, c.y);
      assert.ok(inside >= d.F.steady + d.play, `${label} ${part}: centre of mass ${Math.hypot(c.x, c.y).toFixed(2)} mm off its axis, only ${inside.toFixed(2)} mm inside the boss`);
      // the page's and budget.js's figure, from the loops alone, agrees with the solid
      assert.ok(Math.hypot(w.balance.x - c.x, w.balance.y - c.y) < 0.05, `${label} ${part}: balance from the loops`);
      assert.ok(w.balance.steady, `${label} ${part}`);
    }
    // the counterweight: whole 0.2 mm layers, no more than 8 mm tall, and only as tall as needed
    const h = p.wk.weightH;
    assert.ok(h >= 0 && h <= 8 && Math.abs(h * 5 - Math.round(h * 5)) < 1e-9, `${label}: counterweight ${h} mm`);
    if (h) {
      const less = K.balance(p.wk, d.F.H, d.bossK, Math.round(h * 5 - 1) / 5);
      assert.ok(less.inside < d.F.steady + d.play + 0.05, `${label}: a layer less would do (0.05 mm is kept to spare)`);
    }
  }
});

test('the Kepler wheel\'s filled half and counterweight hide no dot and stay clear of the teeth and the window', () => {
  // the farthest point where a ray from the wheel's axis crosses a loop beyond radius r0 (for the
  // open middle, its outer edge; -Infinity if the ray runs inside the spoke all the way)
  const ray = (L, a, r0) => {
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    let best = -Infinity;
    for (let i = 0; i < L.length; i++) {
      const [px, py] = L[i];
      const [qx, qy] = L[(i + 1) % L.length];
      const ex = qx - px;
      const ey = qy - py;
      const den = ux * ey - uy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = (px * ey - py * ex) / den;
      const u = (px * uy - py * ux) / den;
      if (u >= 0 && u <= 1 && t > r0 && t > best) best = t;
    }
    return best;
  };
  for (const s of sweep()) {
    const d = K.design(s);
    const p = K.buildParts(d);
    const label = `${d.body} C${d.C} bore ${d.bore}`;
    const w = p.wk;
    // in every direction off the spoke, the open middle reaches at least rinKmin, the radius the
    // dial was sized for (its dots end 1 mm inside it), so the filled half never covers a dot
    let tried = 0;
    for (let i = 0; i < 720; i++) {
      const a = (K.TAU * i) / 720;
      const r = ray(w.cavity, a, d.hubK + 0.5);
      if (r === -Infinity) continue; // along the spoke, where the window is instead
      // (the filled half's edge is a polygon on that circle, a vertex every 4 degrees or less: its
      // chords come up to rinKmin (1 - cos 2 deg), under 0.02 mm, inside it, and the dots end 0.9 mm
      // or more inside it)
      assert.ok(r >= d.rinKmin * Math.cos(Math.PI / 90) - 1e-9, `${label}: the open middle is only ${r.toFixed(3)} mm at ${(a * K.DEG).toFixed(1)} deg (dial sized for ${d.rinKmin.toFixed(3)})`);
      tried++;
    }
    assert.ok(tried > 650);
    const dots = K.dialDots(d).K;
    for (const dot of dots) assert.ok(K.dotLoop(dot).every(([x, y]) => Math.hypot(x, y) < d.rinKmin - 0.9), `${label}: orbit dot ${dot.k} reaches the filled half`);
    if (w.weight) {
      // a 0.4 mm ledge, less where its 6-degree chords dip towards the axis (0.03 mm at most)
      assert.ok(loopDist(w.weight, w.cavity) >= 0.35, `${label}: counterweight to the open middle ${loopDist(w.weight, w.cavity)}`);
      assert.ok(loopDist(w.weight, w.outer) >= 0.3, `${label}: counterweight to the teeth ${loopDist(w.weight, w.outer)}`);
      assert.ok(loopDist(w.weight, w.slot) >= 2, `${label}: counterweight to the window`);
      assert.ok(Mesh.loopArea(w.weight) > 0, `${label}: counterweight outline anticlockwise`);
      // nowhere narrower than 1.2 mm: its inner arc and outer edge are at least that far apart
      const n = w.weight.length / 2;
      for (let k = 0; k < n; k++) {
        const o = w.weight[k];
        const q = w.weight[w.weight.length - 1 - k];
        assert.ok(Math.hypot(o[0] - q[0], o[1] - q[1]) >= 1.2 - 1e-9, `${label}: counterweight ${Math.hypot(o[0] - q[0], o[1] - q[1])} mm wide`);
      }
    }
    // the time wheel is not filled
    assert.ok(Math.abs(Mesh.loopArea(p.wt.cavity)) > 0 && !p.wt.weight);
  }
});

test('every clearance between printed parts comes from the fit table, at all 96 settings', () => {
  const { FIT, FIXED } = K;
  const all = [];
  for (const body of K.OPTIONS.bodies) for (const C of K.cRange(body)) for (const bore of K.OPTIONS.bore.values) all.push({ body, C, bore });
  assert.equal(all.length, 96);
  for (const s of all) {
    const d = K.design(s);
    const label = `${d.body} C${d.C} bore ${d.bore}`;
    // wheel on peg: a rotating fit. The peg is a 24-gon with corners on its radius, the bore a
    // 24-gon with flats on its radius, so the bore clearance is the least gap anywhere round it.
    assert.ok(d.bore >= FIT.rotating[0], `${label}: bore`);
    const peg = K.circleLoop(FIXED.pegR, 24);
    const bore = K.circleLoop(d.boreR, 24, 0, 0, true);
    const turned = K.circleLoop(d.boreR, 24, 0, 0, true, Math.PI / 24);
    assert.ok(loopDist(peg, bore) >= d.bore && Math.abs(loopDist(peg, turned) - d.bore) < 1e-9, `${label}: least gap round the peg`);
    // teeth: flanks a sliding fit or looser and tips a rotating fit or looser, at the nominal
    // centres; and both still apart when the wheels sit 2 x bore closer than nominal
    assert.ok(d.flank >= FIT.sliding[0] && d.flank - 2 * d.bore * Math.sin(d.alpha) >= 0.05, `${label}: flank`);
    assert.ok(d.tip >= FIT.rotating[0] && d.tip - 2 * d.bore >= 0.45 - 1e-9, `${label}: tip`);
    // wheels ride 1 mm above the dials (vertical rotating fit)
    assert.ok(FIXED.bossH >= FIT.rotating[0]);
    // nothing on one wheel reaches the other's peg, boss or knob
    assert.ok(d.C - d.outK - (d.hubT - 0.6) >= FIT.rotating[0], `${label}: Kepler wheel clears the knob's boss`);
    assert.ok(d.C - d.outT - (d.hubK - 0.4) >= FIT.rotating[0], `${label}: time wheel clears the Sun's boss`);
  }
  // the coupon: the same peg, and one ring per bore on offer
  assert.deepEqual(K.OPTIONS.bore.values, [0.5, 0.6, 0.7]);
  const coupon = K.couponMesh();
  const zs = coupon.caps.map((c) => c.z);
  assert.ok(zs.includes(FIXED.H), 'rings as thick as the wheels');
});

test('the page cannot ask for a setting that has a problem', () => {
  let n = 0;
  for (const body of K.OPTIONS.bodies)
    for (const C of K.cRange(body))
      for (const bore of K.OPTIONS.bore.values) {
        const d = K.design({ body, C, bore });
        assert.deepEqual([d.body, d.C, d.bore], [body, C, bore]);
        assert.deepEqual(d.problems, [], `${body} ${C} ${bore}`);
        assert.ok(d.plate.x1 - d.plate.x0 <= 180 && d.plate.y1 - d.plate.y0 <= 180);
        n++;
      }
  assert.equal(n, 96);
  // anything else falls back to a valid setting
  for (const bad of [{ body: 'vulcan' }, { C: 999 }, { C: 'x' }, { bore: 0.1 }, { body: 'pluto', C: 62 }]) {
    const d = K.design(bad);
    assert.ok(K.cRange(d.body).includes(d.C) && K.OPTIONS.bore.values.includes(d.bore));
    assert.deepEqual(d.problems, []);
  }
});
