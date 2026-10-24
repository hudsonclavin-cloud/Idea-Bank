// Tests for First Light, Last Light. Node built-ins only: node --test ideas/71-first-light/firstlight.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { defaultBytes, couponBytes } from './build-stl.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const F = createRequire(import.meta.url)('./firstlight.js');
const H = JSON.parse(fs.readFileSync(path.join(HERE, 'horizons.json'), 'utf8'));
const README = fs.readFileSync(path.join(HERE, 'README.md'), 'utf8');
// the README's claims, without the revision notes that quote what earlier versions wrongly said
const CLAIMS = README.split('\n## Revision note')[0];
const PAGE = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8');
const APPSRC = fs.readFileSync(path.join(HERE, 'app.js'), 'utf8');
const RAD = Math.PI / 180;

/* ------------------------------------------------------------------ helpers */

const MON = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
function jdOf(s) {
  const m = /(\d{4})-(\w{3})-(\d{2}) (\d{2}):(\d{2})/.exec(s);
  return F.julianDay(+m[1], MON[m[2]], +m[3], +m[4] + m[5] / 60);
}
const ymd = (s) => s.split('-').map(Number);
const wrap = (a) => ((a % 360) + 540) % 360 - 180;

// Read a binary STL exactly as a slicer would: float32 corners, corners merged only when bit-identical.
function readStl(buf) {
  const dv = new DataView(buf.buffer || buf, buf.byteOffset || 0, buf.byteLength);
  const n = dv.getUint32(80, true);
  assert.equal(dv.byteLength, 84 + 50 * n, 'file length matches the triangle count');
  const ids = new Map(), V = [], faces = [];
  let o = 84;
  for (let i = 0; i < n; i++) {
    o += 12;
    const f = [];
    for (let k = 0; k < 3; k++) {
      const p = [dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true)];
      o += 12;
      const key = p.join(',');
      let id = ids.get(key);
      if (id === undefined) { id = V.length; V.push(p); ids.set(key, id); }
      f.push(id);
    }
    o += 2;
    faces.push(f);
  }
  return { V, faces };
}
// Every directed edge used exactly once and its reverse exactly once: closed and consistently wound.
function solidReport({ V, faces }) {
  const E = new Map();
  let degenerate = 0;
  for (const f of faces) {
    if (f[0] === f[1] || f[1] === f[2] || f[0] === f[2]) degenerate++;
    for (let k = 0; k < 3; k++) { const key = f[k] + ',' + f[(k + 1) % 3]; E.set(key, (E.get(key) || 0) + 1); }
  }
  let unpaired = 0;
  for (const [key, c] of E) { const [a, b] = key.split(','); if (c !== 1 || E.get(b + ',' + a) !== 1) unpaired++; }
  let vol = 0;
  for (const f of faces) {
    const [a, b, c] = f.map((i) => V[i]);
    vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return { unpaired, degenerate, euler: V.length - E.size / 2 + faces.length, volume: vol };
}
// Sort every face by its normal. Returns the area facing down more than 45 degrees off the bed.
function faceClasses({ V, faces }, chamfer) {
  let up = 0, bed = 0, vertical = 0, chamferArea = 0, overhang = 0, other = 0;
  for (const f of faces) {
    const [a, b, c] = f.map((i) => V[i]);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(...n), area = len / 2, nz = n[2] / len;
    const zmax = Math.max(a[2], b[2], c[2]);
    if (nz > 1 - 1e-9) up += area;
    else if (nz < -1 + 1e-9 && zmax === 0) bed += area;
    else if (Math.abs(nz) < 1e-6) vertical += area;
    else if (Math.abs(nz + Math.SQRT1_2) < 2e-3 && zmax <= chamfer + 1e-5) chamferArea += area;
    else if (nz < -Math.SQRT1_2 - 2e-3) overhang += area;
    else other += area;
  }
  return { up, bed, vertical, chamferArea, overhang, other };
}
function bounds({ V }) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of V) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
  return { lo, hi, size: hi.map((h, k) => h - lo[k]) };
}

// Möller–Trumbore against every triangle; returns the hits along the ray, nearest first.
function rayHits(tris, o, d) {
  const out = [];
  for (let i = 0; i < tris.length; i += 9) {
    const e1x = tris[i + 3] - tris[i], e1y = tris[i + 4] - tris[i + 1], e1z = tris[i + 5] - tris[i + 2];
    const e2x = tris[i + 6] - tris[i], e2y = tris[i + 7] - tris[i + 1], e2z = tris[i + 8] - tris[i + 2];
    const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-12) continue;
    const inv = 1 / det, sx = o[0] - tris[i], sy = o[1] - tris[i + 1], sz = o[2] - tris[i + 2];
    const u = (sx * px + sy * py + sz * pz) * inv;
    if (u < 0 || u > 1) continue;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
    if (v < 0 || u + v > 1) continue;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (t > 1e-9) out.push(t);
  }
  return out.sort((a, b) => a - b);
}
const triArray = (mesh) => Float64Array.from(mesh.faces.flatMap((f) => f.flatMap((i) => mesh.vertices[i])));

// Shine parallel, level light at amplitude amp (degrees north of due east for 'rise', of due west for
// 'set') across a 5 mm band centred on the near slit, at height z. Rays that the near wall stops are
// dropped; for the rest, where they first meet the solid again, or that they leave the box.
function shine(tris, d, kind, amp, z, step = 0.01) {
  const az = kind === 'rise' ? 90 - amp : 270 + amp;
  const toSun = [Math.sin(az * RAD), Math.cos(az * RAD), 0], dir = toSun.map((x) => -x);
  const perp = [-dir[1], dir[0], 0];
  const near = kind === 'rise' ? [d.D / 2, 0] : [-d.D / 2, 0];
  const landed = [];
  let out = 0;
  for (let s = -2.5; s <= 2.5 + 1e-9; s += step) {
    const o = [near[0] + perp[0] * s + toSun[0] * 40, near[1] + perp[1] * s + toSun[1] * 40, z];
    const h = rayHits(tris, o, dir);
    if (!h.length) { out++; continue; }
    const p = [o[0] + dir[0] * h[0], o[1] + dir[1] * h[0]];
    const r = Math.hypot(p[0] - near[0], p[1] - near[1]);
    if (r < 10) continue; // stopped by the near wall (its outer face or the slit's jaws)
    if (r > d.D + 1) { out++; continue; } // met nothing before the far wall's outer face: it left the box
    landed.push({ p, r, s });
  }
  return { landed, out, near };
}
// The angle of a landing point about the near slit, in the far wall's own convention (see firstlight.js).
function farAngle(kind, near, p) {
  const v = [p[0] - near[0], p[1] - near[1]];
  return kind === 'rise' ? Math.atan2(v[1], -v[0]) / RAD : Math.atan2(v[1], v[0]) / RAD;
}

/* ------------------------------------------------------------------ the Sun against JPL Horizons */

function horizonsEvents() {
  return H.events.map((e) => {
    const [[t1, a1, h1], [t2, a2, h2]] = e.rows;
    const f = h1 / (h1 - h2);
    const [y, m, d] = ymd(e.date);
    const ev = F.sunEvent(y, m, d, e.lat, e.lon, e.kind, 0);
    return { e, dAz: ev.az - (a1 + f * (a2 - a1)), dT: (ev.jd - (jdOf(t1) + f * (jdOf(t2) - jdOf(t1)))) * 86400 };
  });
}

test('sunrise and sunset directions agree with JPL Horizons (DE441) at 148 events in ten cities', () => {
  const rows = horizonsEvents();
  assert.equal(rows.length, 148);
  assert.equal(new Set(rows.map((r) => r.e.site)).size, 10);
  const worstAz = Math.max(...rows.map((r) => Math.abs(r.dAz)));
  const worstT = Math.max(...rows.map((r) => Math.abs(r.dT)));
  assert.ok(worstAz < 0.0115, `largest azimuth difference ${worstAz}`);
  assert.equal(worstAz.toFixed(3), '0.011');
  assert.ok(worstT < 6, `largest time difference ${worstT} s`);
  // The figures the page and the README quote.
  for (const doc of [PAGE, README]) {
    assert.match(doc, /0\.011&deg;|0\.011°/);
    assert.match(doc, /148 sunrises and sunsets/);
  }
});

test('without refraction, the Sun model agrees with Horizons airless positions', () => {
  assert.equal(H.airless.length, 32);
  let worstAz = 0, worstEl = 0;
  for (const a of H.airless) {
    const h = F.horizontal(jdOf(a.time), a.lat, a.lon);
    worstAz = Math.max(worstAz, Math.abs(wrap(h.az - a.az)) * Math.cos(a.el * RAD));
    worstEl = Math.max(worstEl, Math.abs(h.alt - a.el));
  }
  // The model is geocentric; Horizons is topocentric, so the Sun's 8.8" parallax is inside these.
  assert.ok(worstAz < 0.008, `azimuth (times cos elevation) ${worstAz}`);
  assert.ok(worstEl < 0.005, `elevation ${worstEl}`);
});

test('raised horizons of 3 and 5 degrees agree with Horizons', () => {
  assert.equal(H.raised.length, 44);
  let worst = 0;
  for (const e of H.raised) {
    const [[, a1, h1], [, a2, h2]] = e.rows;
    const f = (h1 - e.horizon) / (h1 - h2);
    const [y, m, d] = ymd(e.date);
    worst = Math.max(worst, Math.abs(F.sunEvent(y, m, d, e.lat, e.lon, e.kind, e.horizon).az - (a1 + f * (a2 - a1))));
  }
  assert.ok(worst < 0.012, `largest difference ${worst}`);
});

test('local apparent noon agrees with Horizons transits to within 3 seconds', () => {
  assert.equal(H.transits.length, 32);
  let worst = 0;
  for (const e of H.transits) {
    const [[t1, a1], [t2, a2]] = e.rows;
    const key = (az) => (e.sunSouth ? az - 180 : wrap(az));
    const f = key(a1) / (key(a1) - key(a2));
    const [y, m, d] = ymd(e.date);
    worst = Math.max(worst, Math.abs(F.solarNoon(y, m, d, e.lon) - (jdOf(t1) + f * (jdOf(t2) - jdOf(t1)))) * 86400);
  }
  assert.ok(worst < 3, `largest difference ${worst} s`);
});

test('the rising-azimuth formula agrees with a sky turned about the pole', () => {
  // Independent route: put a point of declination delta on the meridian, turn it about the polar axis
  // until it rises through altitude h (bisection on the hour angle), and read its azimuth off the vector.
  let worst = 0;
  for (const lat of [-58, -33.9, -10, 0, 12.5, 45, 58]) for (const delta of [-23.44, -15, -3, 0, 7, 20.2, 23.44]) for (const h of [-1.2, -0.58, 0.5, 4.4]) {
    const alt = (H0) => { // hour angle H0 degrees east of the meridian (negative = rising side)
      const x = Math.cos(delta * RAD) * Math.cos(H0 * RAD), y = -Math.cos(delta * RAD) * Math.sin(H0 * RAD), z = Math.sin(delta * RAD);
      // equatorial (x to the meridian, z to the pole) to horizon frame
      const up = x * Math.cos(lat * RAD) + z * Math.sin(lat * RAD);
      const north = -x * Math.sin(lat * RAD) + z * Math.cos(lat * RAD);
      const east = y;
      return { alt: Math.asin(up) / RAD, az: (Math.atan2(east, north) / RAD + 360) % 360 };
    };
    let lo = -180, hi = 0; // altitude rises from lower culmination to the meridian
    if (alt(lo).alt > h || alt(hi).alt < h) continue;
    for (let k = 0; k < 80; k++) { const mid = (lo + hi) / 2; if (alt(mid).alt < h) lo = mid; else hi = mid; }
    worst = Math.max(worst, Math.abs(alt(lo).az - F.riseAzimuth(delta, lat, h)));
  }
  assert.ok(worst < 1e-8, `worst ${worst}`);
});

test('Bennett refraction: 34.5 arcminutes at the horizon, and its inverse round-trips', () => {
  assert.ok(Math.abs(F.refraction(0) * 60 - 34.48) < 0.01);
  for (const h of [-1, 0, 1, 3, 5]) {
    const geo = F.centreAltitude(h);
    assert.ok(Math.abs(geo + F.refraction(h) - h) < 1e-12);
  }
});

/* ------------------------------------------------------------------ the printed solid */

test('committed STL files are byte-identical to what the code makes now', () => {
  assert.ok(Buffer.compare(fs.readFileSync(path.join(HERE, 'default.stl')), defaultBytes()) === 0, 'default.stl');
  assert.ok(Buffer.compare(fs.readFileSync(path.join(HERE, 'coupon.stl')), couponBytes()) === 0, 'coupon.stl');
  const head = fs.readFileSync(path.join(HERE, 'default.stl')).subarray(0, 80).toString('latin1');
  assert.ok(!head.startsWith('solid'), 'a binary STL header must not begin with "solid"');
  assert.match(head, /45\.0 deg N/);
});

function checkSolid(buf, label, maxZ) {
  const mesh = readStl(buf);
  const r = solidReport(mesh);
  assert.equal(r.unpaired, 0, `${label}: every edge shared by exactly two faces, in opposite directions`);
  assert.equal(r.degenerate, 0, `${label}: no triangle collapses in float32`);
  assert.equal(r.euler, 2, `${label}: one solid with no handles`);
  assert.ok(r.volume > 0, `${label}: outward normals`);
  const b = bounds(mesh);
  assert.equal(b.lo[2], 0, `${label}: lowest point on the bed`);
  assert.ok(b.size[0] <= 180 && b.size[1] <= 180 && b.size[2] <= maxZ, `${label}: fits the bed ${b.size}`);
  const c = faceClasses(mesh, F.FIXED.chamfer);
  assert.ok(c.bed > 1000, `${label}: a flat face on the bed (${c.bed} mm²)`);
  assert.equal(c.overhang, 0, `${label}: nothing faces down more steeply than the 45 degree chamfer`);
  assert.equal(c.other, 0, `${label}: every face is flat, vertical, on the bed or the chamfer`);
  return { mesh, r, b, c };
}

test('the default box and the coupon are closed solids that sit flat and need no support', () => {
  const box = checkSolid(defaultBytes(), 'default', 30);
  assert.ok(Math.abs(box.b.size[1] - 100 * Math.sqrt(3)) < 1e-3, 'the lens is 100 x 173.2 mm');
  assert.equal(box.b.size[2], 30);
  const coupon = checkSolid(couponBytes(), 'coupon', 14);
  assert.deepEqual(coupon.b.size.map((x) => +x.toFixed(3)), [76, 20, 14]);
});

const SWEEP = [];
for (const lat of [-58, -23.44, 0, 23.44, 58]) for (const size of [70, 102]) for (const slit of [0.8, 1.6])
  for (const [horizonE, horizonW] of [[-1, -1], [5, 5], [-1, 5]]) for (const day of ['', '06-21', '02-29', '09-22', '10-31'])
    SWEEP.push({ lat, lon: [-180, 180, 0][SWEEP.length % 3], size, slit, horizonE, horizonW, day });

test(`every combination of extreme settings (${SWEEP.length}) makes a closed, printable solid`, () => {
  for (const input of SWEEP) {
    const m = F.boxMesh(input);
    checkSolid(Buffer.from(F.stl(m, F.stlLabel(m.design))), JSON.stringify(input), 30);
  }
});

test('features on each inner wall keep at least 0.8 mm of wall between them, 2.4 mm between two through-cuts', () => {
  let narrowest = Infinity, narrowestPillar = Infinity;
  const days = ['', '03-17', '03-23', '06-21', '09-20', '09-26', '12-21', '05-01'];
  for (const lat of [-58, -40, -20, 0, 20, 40, 58]) for (const size of [70, 100, 102]) for (const day of days) {
    const d = F.design({ lat, size, day });
    for (const side of ['W', 'E']) {
      const f = d.walls[side].features.slice().sort((a, b) => a.theta - b.theta);
      for (let i = 0; i + 1 < f.length; i++) {
        const gapMM = (f[i + 1].theta - f[i + 1].half - (f[i].theta + f[i].half)) * RAD * d.R;
        const pillar = f[i].kind !== 'groove' && f[i + 1].kind !== 'groove';
        if (pillar) narrowestPillar = Math.min(narrowestPillar, gapMM); else narrowest = Math.min(narrowest, gapMM);
      }
      for (const x of f) assert.ok(Math.abs(x.theta) + x.half <= d.thetaIn - Math.asin(4 / d.R) / RAD + 1e-9, 'kept clear of the tips');
    }
  }
  // the gap is set along the arc; a straight chord across it is shorter by a negligible amount
  assert.ok(narrowest >= 0.8 - 1e-3, `narrowest ${narrowest}`);
  assert.ok(narrowestPillar >= 2.4 - 1e-3, `narrowest pillar ${narrowestPillar}`);
  assert.ok(F.FIXED.wall - F.FIXED.grooveDepth >= 1.6, 'wall behind a groove');
  assert.ok(F.FIXED.floor - F.FIXED.engrave >= 1.2, 'floor under the lettering');
});

test('engraved strokes are at least 0.8 mm wide and 0.6 mm deep', () => {
  // minimum width of a convex polygon: over its edges, the largest distance of any corner from that edge
  const width = (poly) => Math.min(...poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return Math.max(...poly.map((p) => Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / L));
  }));
  let thinnest = Infinity;
  for (const lat of [-58, -45.5, -0.1, 0, 7.3, 23.4, 51.5, 58]) for (const size of [6, 7]) for (const poly of F.textPolys(F.latitudeText(lat), 0, 0, size)) thinnest = Math.min(thinnest, width(poly));
  for (const t of ['8', '10', '12', '14', '16']) for (const poly of F.textPolys(t, 0, 0, 6)) thinnest = Math.min(thinnest, width(poly));
  assert.ok(thinnest >= 0.8 - 1e-9, `thinnest stroke ${thinnest}`);
  assert.equal(F.FIXED.engrave, 0.6);
});

test('the coupon has five slits of the stated widths, a groove and a slot', () => {
  const map = F.couponMap();
  const slits = map.regions.filter((r) => r.name === 'slit');
  assert.equal(slits.length, 5);
  slits.forEach((r, i) => {
    const P = r.loops[0].map((id) => map.points[id]);
    const y0 = Math.min(...P.map((p) => p[1]));
    const front = P.filter((p) => p[1] === y0).map((p) => p[0]);
    assert.ok(Math.abs(Math.max(...front) - Math.min(...front) - F.COUPON.widths[i]) < 1e-9, `slit ${i}`);
  });
  assert.equal(map.regions.filter((r) => r.name === 'slot').length, 1);
  assert.equal(map.regions.filter((r) => r.name === 'groove').length, 1);
});

test('out-of-range settings are refused', () => {
  for (const bad of [{ lat: 58.1 }, { lat: -60 }, { size: 69 }, { size: 103 }, { slit: 0.7 }, { horizonE: 5.5 }, { horizonW: -2 }, { lon: 181 }, { lat: 'x' }, { day: '02-30' }, { day: '13-01' }, { day: 'June 1' }])
    assert.throws(() => F.design(bad), RangeError, JSON.stringify(bad));
});

/* ------------------------------------------------------------------ sunlight traced through the triangles */

// Where a groove is in the mesh, found without any sunlight: from a point inside the near slit, sweep
// rays across the far wall in fine angular steps and keep those that reach the groove's floor (0.6 mm
// deeper than the wall face). Returns the groove's middle as an angle about the near slit's outer face.
function probeGroove(tris, d, kind, theta, z) {
  const near = kind === 'rise' ? [d.D / 2, 0] : [-d.D / 2, 0];
  const inward = kind === 'rise' ? -1 : 1; // the near slit's axis points into the box along -x or +x
  const o = [near[0] + inward * 0.25, 0, z];
  // runs of consecutive rays that reach a groove floor; neighbouring grooves give separate runs
  const runs = [];
  let run = null;
  for (let a = theta - 1.5; a <= theta + 1.5; a += 0.002) {
    // the far wall's own angle convention: 'rise' angles are measured from -x, 'set' from +x
    const dir = kind === 'rise' ? [-Math.cos(a * RAD), Math.sin(a * RAD), 0] : [Math.cos(a * RAD), Math.sin(a * RAD), 0];
    const h = rayHits(tris, o, dir);
    const p = h.length ? [o[0] + dir[0] * h[0], o[1] + dir[1] * h[0]] : null;
    const deep = p && Math.abs(Math.hypot(p[0] - near[0], p[1] - near[1]) - (d.R + F.FIXED.grooveDepth)) < 0.05;
    if (deep) { if (!run) runs.push(run = []); run.push(farAngle(kind, near, p)); } else run = null;
  }
  // the design's angle only chooses which run to measure; the run itself comes from the mesh
  const measured = runs.map((r) => ({ mid: (r[0] + r[r.length - 1]) / 2, widthMM: Math.abs(r[r.length - 1] - r[0]) * RAD * d.R }));
  measured.sort((x, y) => Math.abs(x.mid - theta) - Math.abs(y.mid - theta));
  return measured[0] || null;
}

test('traced sunlight lands in each groove it is cut for, on the morning and the evening walls', () => {
  // The light is traced through the mesh's own triangles. The groove is found separately, by a probe
  // that uses no sunlight (so a beam narrower than the groove cannot pass by measuring itself).
  let worstMM = 0, grooves = 0;
  for (const input of [{ lat: 45 }, { lat: -33.9, size: 70, slit: 0.8, horizonE: 2.5 }, { lat: 58, size: 102, slit: 1.6, horizonW: -1 }, { lat: 0 }]) {
    const m = F.boxMesh(input), d = m.design, tris = triArray(m);
    for (const kind of ['rise', 'set']) {
      const side = kind === 'rise' ? 'W' : 'E';
      for (const f of d.walls[side].features) {
        if (f.kind !== 'groove') continue;
        const z = (F.grooveBottom(d, f.level, side) + d.Z) / 2; // halfway down the groove
        const { landed, out, near } = shine(tris, d, kind, f.amp, z, 0.01);
        assert.equal(out, 0, 'no light leaves the box');
        assert.ok(landed.length > 40, 'light gets through the near slit');
        const centre = landed.reduce((s, x) => s + farAngle(kind, near, x.p), 0) / landed.length;
        const g = probeGroove(tris, d, kind, f.theta, z);
        assert.ok(g, `the probe finds the groove (${JSON.stringify(input)}, ${kind}, groove ${f.groove})`);
        assert.ok(Math.abs(g.widthMM - F.FIXED.grooveWidth) < 0.02, `groove width ${g.widthMM}`);
        // and most of the light is in it
        const inside = landed.filter((x) => Math.abs(farAngle(kind, near, x.p) - g.mid) * RAD * d.R < F.FIXED.grooveWidth / 2).length;
        assert.ok(inside / landed.length > 0.6, `share of the beam in the groove ${inside / landed.length}`);
        worstMM = Math.max(worstMM, Math.abs(centre - g.mid) * RAD * d.R);
        grooves++;
      }
    }
  }
  assert.ok(grooves > 60, `grooves traced: ${grooves}`);
  // A groove is 1 mm wide. Measured with 0.01 mm ray spacing and a 0.002 degree probe.
  assert.ok(worstMM < 0.02, `largest miss of a groove's middle ${worstMM} mm`);
});

test('traced light leaves through the far slit near the equinox and through your slot on your day', () => {
  const m = F.boxMesh({ lat: 45, day: '05-14' }), d = m.design, tris = triArray(m);
  for (const kind of ['rise', 'set']) {
    // on the axis: the centre of the beam leaves the box
    const a = shine(tris, d, kind, 0, 15, 0.02);
    assert.ok(a.out > 20, `${kind}: straight through`);
    // 1 mm off the far slit's middle: none of the light leaves
    const off = Math.atan(1.0 / (d.D - F.FIXED.land)) / RAD;
    assert.equal(shine(tris, d, kind, off + 0.2, 15, 0.02).out, 0);
    assert.equal(F.throughFarSlit(d, 0), true);
    assert.equal(F.throughFarSlit(d, off), false);
    // your slot
    const slot = d.walls[kind === 'rise' ? 'W' : 'E'].features.find((f) => f.kind === 'slot');
    assert.ok(slot, 'the slot is cut');
    const s = shine(tris, d, kind, slot.amp, 15, 0.02);
    assert.ok(s.out > 20, `${kind}: through your slot`);
  }
});

test('the flared slit passes the steepest light it is cut for, at the width its land allows', () => {
  for (const lat of [58, -58, 0]) {
    const m = F.boxMesh({ lat }), d = m.design, tris = triArray(m);
    for (const kind of ['rise', 'set']) {
      const steep = Math.max(...d.walls[kind === 'rise' ? 'W' : 'E'].features.filter((f) => f.kind === 'groove').map((f) => Math.abs(f.amp)));
      for (const sgn of [1, -1]) {
        const { landed } = shine(tris, d, kind, sgn * steep, 15, 0.005);
        // a slit of width w and land l passes a beam w cos(a) - l sin(a) wide at angle a
        const expected = d.params.slit * Math.cos(steep * RAD) - F.FIXED.land * Math.sin(steep * RAD);
        assert.ok(Math.abs(landed.length * 0.005 - expected) < 0.02, `${lat} ${kind} ${sgn}: ${landed.length * 0.005} vs ${expected}`);
      }
    }
  }
});

/* ------------------------------------------------------------------ the calendar */

test('the dates in the key move by at most a day from 2027 to 2060', () => {
  const parse = (s) => { const [dd, mm] = s.split(' '); return F.julianDay(2026, F.MONTHS.indexOf(mm) + 1, +dd); };
  let worst = 0;
  for (const lat of [-58, -35, 0, 20, 45, 58]) {
    const d = F.design({ lat, lon: lat * 2 });
    const base = F.key(d, 2026);
    for (let y = 2027; y <= 2060; y++) {
      F.key(d, y).forEach((row, i) => {
        for (const kind of ['rise', 'set']) {
          const a = base[i][kind], b = row[kind];
          if (!a || !b) continue;
          assert.equal(a.length, b.length);
          a.forEach((s, j) => { worst = Math.max(worst, Math.abs(parse(s) - parse(b[j]))); });
        }
      });
    }
  }
  assert.equal(worst, 1);
});

test('each groove is two dates either side of a solstice, and the solstice grooves hold the light for days', () => {
  const d = F.design({ lat: 45 });
  const track = F.yearTrack(d, 2026);
  const rows = F.key(d, 2026, track);
  for (const row of rows) {
    if (!row.rise || Math.abs(row.k) === 6) continue;
    assert.equal(row.rise.length, 2, `groove ${row.k}`);
  }
  // within half a millimetre of the June solstice groove at 45 N: about two weeks of mornings
  const g = d.grooves.find((x) => x.k === 6);
  const theta = F.wallTheta(d.R, g.ampRise);
  const near = track.filter((t) => Math.abs(F.wallTheta(d.R, t.ampRise) - theta) * RAD * d.R <= 0.5);
  assert.ok(near.length >= 12 && near.length <= 18, `${near.length} days`);
});

test('the model never asks for a sunrise that does not happen inside the latitude range', () => {
  for (const lat of [-58, 58]) for (let n = 1; n <= 366; n += 5) {
    const dt = F.dateOfYear(2028, n);
    for (const h of [-1, 5]) for (const kind of ['rise', 'set'])
      assert.ok(F.sunEvent(2028, dt.month, dt.day, lat, 0, kind, h), `${lat} ${n} ${kind} ${h}`);
  }
});

test('reading too early or too late: the stripe moves about 0.3 mm a minute at 45 degrees', () => {
  const t = F.eventTimes(2026, 3, 20, 45, 0, 'rise', 0);
  assert.ok(t.first < t.mid && t.mid < t.last);
  const minutes = (t.mid - t.first) * 1440;
  assert.ok(minutes > 1 && minutes < 2.5, `${minutes} min from first light to half the disc`);
  const d = F.design({ lat: 45 });
  const mmPerMin = t.azPerMinute * RAD * d.R;
  assert.ok(mmPerMin > 0.25 && mmPerMin < 0.35, `${mmPerMin}`);
});

test('a small tilt moves the stripe far less than a small turn', () => {
  // The slit is vertical in the box's own frame, so the stripe goes where the Sun's azimuth in that
  // frame says. Turning the box by 1 degree moves that azimuth by 1 degree. Tilting it by up to 2
  // degrees, in any direction, moves it by the largest amount found below: with the Sun on a flat
  // horizon, and with the Sun as high as the page's highest horizon (5 degrees) or as low as its lowest.
  let worst = 0, worstFlat = 0;
  for (const h of [-1, 0, 5]) for (let amp = -55; amp <= 55; amp += 5) for (let dir = 0; dir < 360; dir += 15) {
    const tilt = 2 * RAD, k = [Math.cos(dir * RAD), Math.sin(dir * RAD), 0]; // tilt axis, horizontal
    const s = [Math.cos(h * RAD) * Math.cos(amp * RAD), Math.cos(h * RAD) * Math.sin(amp * RAD), Math.sin(h * RAD)]; // the Sun: x east, y north, z up
    // rotate the Sun into the tilted box's frame (Rodrigues, by -tilt about k)
    const c = Math.cos(-tilt), sn = Math.sin(-tilt), dot = k[0] * s[0] + k[1] * s[1];
    const cr = [k[1] * s[2] - k[2] * s[1], k[2] * s[0] - k[0] * s[2], k[0] * s[1] - k[1] * s[0]];
    const r = s.map((v, i) => v * c + cr[i] * sn + k[i] * dot * (1 - c));
    const shift = Math.abs(Math.atan2(r[1], r[0]) / RAD - amp);
    worst = Math.max(worst, shift);
    if (h === 0) worstFlat = Math.max(worstFlat, shift);
  }
  assert.ok(worstFlat < 0.02, `flat horizon: largest shift from a 2 degree tilt ${worstFlat} degrees`);
  assert.ok(worst < 0.25, `any horizon on the page: largest shift from a 2 degree tilt ${worst} degrees`);
});

/* ------------------------------------------------------------------ light that does not come through the slit as drawn */
// Added after the independent review. Its tests traced only sunlight through the near slit, near the
// slit, as level light; these trace the whole box, the whole height of the wall, and slanting light.

// Level light across the whole box at height z: every ray from the Sun's side, 0.05 mm apart. Returns the
// stripes it makes on the far wall's inner face (runs of neighbouring rays that land there), as angles.
function shineAcross(tris, d, kind, amp, z, step = 0.05) {
  const az = kind === 'rise' ? 90 - amp : 270 + amp;
  const toSun = [Math.sin(az * RAD), Math.cos(az * RAD), 0], dir = toSun.map((x) => -x), perp = [-dir[1], dir[0], 0];
  const near = kind === 'rise' ? [d.D / 2, 0] : [-d.D / 2, 0];
  const runs = [];
  let run = null;
  for (let s = -d.D; s <= d.D; s += step) {
    const o = [perp[0] * s + toSun[0] * 300, perp[1] * s + toSun[1] * 300, z];
    const h = rayHits(tris, o, dir);
    let onFar = false, th = 0;
    if (h.length) {
      const p = [o[0] + dir[0] * h[0], o[1] + dir[1] * h[0]];
      const r = Math.hypot(p[0] - near[0], p[1] - near[1]);
      // the far wall's inner face (and groove floors): about R from the near slit, on the far side
      onFar = (kind === 'rise' ? p[0] < 0 : p[0] > 0) && r > d.R - 0.05 && r < d.R + F.FIXED.grooveDepth + 0.05;
      th = farAngle(kind, near, p);
    }
    if (onFar) { if (!run) runs.push(run = []); run.push(th); } else run = null;
  }
  return runs.map((r) => ({ theta: r.reduce((a, b) => a + b, 0) / r.length, width: r.length * step }));
}

test('your slot lets in a second stripe from the other end of the day, where slotLeak says', () => {
  // A slot is a straight cut through the wall, so it passes light both ways: the one in the east wall,
  // cut for an evening, lets morning sun onto the west wall. Traced across the whole box through the
  // mesh: on each day there is the stripe from the near slit, and a second one exactly when slotLeak
  // predicts it, with its middle and width as predicted (on plain wall; in a groove the oblique light
  // lands 0.6 mm deeper and shifts).
  const m = F.boxMesh({ lat: 45, day: '05-14' }), d = m.design, tris = triArray(m), track = F.yearTrack(d, 2026);
  let worstTh = 0, worstW = 0, seen = 0, traced = 0;
  for (let n = 1; n <= 365; n += 23) {
    const t = track[n - 1];
    for (const kind of ['rise', 'set']) {
      const amp = kind === 'rise' ? t.ampRise : t.ampSet;
      const real = F.landing(d, kind, amp), leak = F.slotLeak(d, kind, amp);
      // traced stripes other than the one from the near slit, away from the far slit's flared mouth
      const others = shineAcross(tris, d, kind, amp, 15).filter((s) => Math.abs(s.theta - real.theta) > 0.5 && Math.abs(s.theta) > 3);
      traced += others.length ? 1 : 0;
      const where = `${t.day}/${t.month} ${kind}`;
      // no second stripe in the trace where slotLeak says there is none
      if (!leak || !leak.onFar) { assert.equal(others.length, 0, `${where}: a second stripe slotLeak does not predict ${JSON.stringify(others)}`); continue; }
      if (leak.hit || Math.abs(leak.theta) <= 3 || leak.width < 0.1) continue; // in a groove or the slit, or a sliver
      assert.equal(others.length, 1, `${where}: the second stripe slotLeak predicts at ${leak.theta}`);
      worstTh = Math.max(worstTh, Math.abs(others[0].theta - leak.theta));
      worstW = Math.max(worstW, Math.abs(others[0].width - leak.width));
      seen++;
    }
  }
  assert.ok(traced >= 10, `mornings and evenings with a second stripe in the trace: ${traced}`);
  assert.ok(seen >= 10, `second stripes compared: ${seen}`);
  assert.ok(worstTh < 0.05, `largest difference in the second stripe's middle ${worstTh} degrees`);
  assert.ok(worstW < 0.06, `largest difference in its width ${worstW} mm`);
  // the 9 February example: a second stripe on the west wall 0.88 mm wide, 0.3 mm from the groove for
  // 5 April / 7 September
  const feb9 = F.slotLeak(d, 'rise', track[39].ampRise);
  assert.ok(Math.abs(feb9.theta - -8.74) < 0.02 && Math.abs(feb9.width - 0.88) < 0.02, JSON.stringify(feb9));
  // and the page tells the reader how to stop it
  assert.match(PAGE, /opaque tape over the outside of both slots/);
  assert.doesNotMatch(CLAIMS, /it is stopped otherwise/);
});

// Level light at height z across the beam your slot lets in (its band, widened by 0.2 mm each side),
// rays step mm apart. Returns how much of it lands on the far half of the box, how much of that lands
// deeper than a groove floor (on the sides of a cut), and how much meets nothing: it went out again.
function shineBand(tris, d, kind, amp, band, z, step) {
  const az = kind === 'rise' ? 90 - amp : 270 + amp;
  const toSun = [Math.sin(az * RAD), Math.cos(az * RAD), 0], dir = toSun.map((x) => -x), perp = [-dir[1], dir[0], 0];
  const centre = kind === 'rise' ? [d.D / 2, 0] : [-d.D / 2, 0]; // the far wall's arc is centred on the near slit
  let inBox = 0, deep = 0, out = 0;
  for (let s = band[0] - 0.2; s <= band[1] + 0.2; s += step) {
    const o = [perp[0] * s + toSun[0] * 300, perp[1] * s + toSun[1] * 300, z];
    const h = rayHits(tris, o, dir);
    if (!h.length) { out += step; continue; }
    const p = [o[0] + dir[0] * h[0], o[1] + dir[1] * h[0]];
    if (kind === 'rise' ? p[0] >= 0 : p[0] <= 0) continue; // stopped by the near wall
    inBox += step;
    if (Math.hypot(p[0] - centre[0], p[1] - centre[1]) > d.R + F.FIXED.grooveDepth + 0.05) deep += step;
  }
  return { inBox, deep, out };
}

test('light your slot lets in goes out through the far slit only where it passes the land; the rest stays in the box', () => {
  // The first version counted a second beam whose middle fell in the far slit's flared mouth as leaving
  // the box, and drew it going out. Traced, much of that light lands on the slit's flared sides. Every
  // morning and evening of 2026, 0.005 mm apart: the light that stays in the box and the light that
  // goes out, against slotLeak, and the days counted against the days the trace finds light in the box.
  const m = F.boxMesh({ lat: 45, day: '05-14' }), d = m.design, tris = triArray(m), track = F.yearTrack(d, 2026);
  const lk = F.leaks(d, track), all = [...lk.rise, ...lk.set];
  const counted = new Set(all.map((x) => (lk.rise.includes(x) ? 'rise' : 'set') + x.n));
  let worst = 0, seen = 0, onSlit = 0, deepOnSlit = 0;
  for (const t of track) for (const kind of ['rise', 'set']) {
    const amp = kind === 'rise' ? t.ampRise : t.ampSet, L = F.slotLeak(d, kind, amp);
    if (!L) continue;
    const tr = shineBand(tris, d, kind, amp, L.band, 15.37, 0.005);
    worst = Math.max(worst, Math.abs(tr.inBox - L.inBox), Math.abs(tr.out - L.out));
    const lit = tr.inBox >= F.SLIVER;
    assert.equal(counted.has(kind + t.n), lit, `${t.day}/${t.month} ${kind}: traced ${tr.inBox} mm in the box, slotLeak ${L.inBox}`);
    seen += lit ? 1 : 0;
    if (L.hit && L.hit.kind === 'slit') { onSlit++; deepOnSlit = Math.max(deepOnSlit, tr.deep); }
  }
  assert.ok(worst < 0.02, `largest difference in the light that stays or goes out ${worst} mm`);
  assert.equal(seen, all.length);
  assert.ok(onSlit >= 20 && deepOnSlit > 0.5, `${onSlit} beams meet the far slit; up to ${deepOnSlit} mm of one lands on its sides`);
  // 17 January: both second beams meet the far slit, and none of either goes out
  for (const kind of ['rise', 'set']) {
    const L = F.slotLeak(d, kind, kind === 'rise' ? track[16].ampRise : track[16].ampSet);
    assert.equal(L.hit.kind, 'slit');
    assert.ok(L.out < F.SLIVER && L.inBox > 1, JSON.stringify({ out: L.out, inBox: L.inBox }));
  }
  // slivers are not counted: 17 March has a beam under 0.01 mm wide
  assert.ok(F.slotLeak(d, 'rise', track[75].ampRise).width < 0.01 && !lk.rise.some((x) => x.n === 76));
  // a slot in the far wall: where a beam meets one, the same holds (0 N, your day 1 March)
  const m2 = F.boxMesh({ lat: 0, day: '03-01' }), d2 = m2.design, tris2 = triArray(m2), track2 = F.yearTrack(d2, 2026);
  let slots = 0, worst2 = 0;
  for (const t of track2) for (const kind of ['rise', 'set']) {
    const amp = kind === 'rise' ? t.ampRise : t.ampSet, L = F.slotLeak(d2, kind, amp);
    if (!L || !L.hit || L.hit.kind === 'groove') continue;
    const tr = shineBand(tris2, d2, kind, amp, L.band, 15.37, 0.005);
    worst2 = Math.max(worst2, Math.abs(tr.inBox - L.inBox), Math.abs(tr.out - L.out));
    slots += L.hit.kind === 'slot' ? 1 : 0;
  }
  assert.ok(slots >= 3 && worst2 < 0.02, `${slots} beams meet the far slot; largest difference ${worst2} mm`);
  // the counts the README quotes for this box
  const onGroove = all.filter((x) => x.near && x.near.mm <= 0.5).length, slit = all.filter((x) => x.onCut === 'slit');
  assert.match(README, new RegExp(`on ${all.length} of the 730 mornings and evenings of 2026`));
  assert.match(README, new RegExp(`on ${slit.length} of them it lands on the flared sides of the far slit, and on ${slit.filter((x) => x.out < F.SLIVER).length} of those none of it goes out`));
  assert.match(README, new RegExp(`${onGroove} of the ${all.length} fall within half a millimetre of a groove`));
  assert.doesNotMatch(CLAIMS, /second stripe on \d+ of the 730/);
});

// Is the point (x, y, z) in direct sunlight from a Sun h degrees up at azimuth az? Back-traced through the mesh.
function sunlit(tris, p, az, h) {
  const dir = [Math.sin(az * RAD) * Math.cos(h * RAD), Math.cos(az * RAD) * Math.cos(h * RAD), Math.sin(h * RAD)];
  return rayHits(tris, p, dir).length === 0;
}

test('under a raised skyline every groove reaches down into the part of the wall that shows the stripe', () => {
  // With the Sun h degrees up at the moment the box is cut for, light over the near wall's top lights the
  // top of the far wall directly, and the stripe cannot be told from it there. For each groove, at the
  // moment the light is centred on it, walk down the groove floor and the wall 2 mm either side: the
  // stripe shows where the groove floor is lit and the wall beside it is not.
  for (const input of [{ lat: 45, horizonE: 5, horizonW: 3 }, { lat: -33.9, size: 70, horizonE: 2, horizonW: 4.5 }]) {
    const m = F.boxMesh(input), d = m.design, tris = triArray(m);
    let shortest = Infinity;
    for (const [kind, side, h] of [['rise', 'W', d.params.horizonE], ['set', 'E', d.params.horizonW]]) {
      const c = side === 'W' ? [d.D / 2, 0] : [-d.D / 2, 0];
      const at = (th, r, z) => (side === 'W' ? [c[0] - r * Math.cos(th * RAD), r * Math.sin(th * RAD), z] : [c[0] + r * Math.cos(th * RAD), r * Math.sin(th * RAD), z]);
      let floodFrom = Infinity;
      for (const f of d.walls[side].features) {
        if (f.kind !== 'groove') continue;
        const az = kind === 'rise' ? 90 - f.amp : 270 + f.amp, beside = 2 / d.R / RAD;
        const bottom = F.grooveBottom(d, f.level, side);
        let shows = 0;
        for (let z = d.T + 0.125; z < d.Z; z += 0.25) {
          const g = sunlit(tris, at(f.theta, d.R + 0.55, z), az, h);
          const n1 = sunlit(tris, at(f.theta - beside, d.R - 0.02, z), az, h), n2 = sunlit(tris, at(f.theta + beside, d.R - 0.02, z), az, h);
          if (n1 || n2) floodFrom = Math.min(floodFrom, z);
          if (z > bottom && g && !n1 && !n2) shows += 0.25;
        }
        shortest = Math.min(shortest, shows);
      }
      // the design's line for the sunlit band sits at or a little below the traced one
      assert.ok(d.readTop[side] <= floodFrom + 0.15 && d.readTop[side] > floodFrom - 0.6, `${side}: readTop ${d.readTop[side]} vs traced ${floodFrom}`);
    }
    // a short groove used to meet the stripe over 0.8 mm at 5 degrees; it now meets it over a third of the band
    assert.ok(shortest >= 5, `${JSON.stringify(input)}: the least length of groove that shows the stripe is ${shortest} mm`);
  }
  // under a flat or sunken skyline nothing changes: the default box is the one committed
  assert.equal(F.design({ lat: 45 }).readTop.W, 30);
  assert.equal(F.design({ lat: 45, horizonE: -1 }).readTop.W, 30);
});

test('a slanting beam gets through the slit only as wide as its land allows, and at high latitudes that is a sliver or nothing', () => {
  // aperture() against light traced through the mesh, 0.002 mm apart, in the steepest cases the page offers
  const cases = [
    [{ lat: 58, slit: 0.8 }, 'rise', 6, 0.130],
    [{ lat: 55, slit: 0.8, horizonE: 5, horizonW: 5 }, 'rise', -6, 0.053],
    [{ lat: 58, slit: 0.8, horizonE: 5, horizonW: 5 }, 'rise', -6, 0],
    [{ lat: 58, slit: 1.6, horizonE: 5, horizonW: 5 }, 'set', -6, null],
    [{ lat: -58, slit: 1.2, size: 70 }, 'set', -6, null],
  ];
  for (const [input, kind, k, expect] of cases) {
    const m = F.boxMesh(input), d = m.design, tris = triArray(m);
    const g = d.grooves.find((x) => x.k === k), amp = kind === 'rise' ? g.ampRise : g.ampSet;
    const { landed, out } = shine(tris, d, kind, amp, 15, 0.002);
    const traced = (landed.length + out) * 0.002, model = F.aperture(d, kind, amp);
    assert.ok(Math.abs(traced - model) < 0.01, `${JSON.stringify(input)} ${kind}: traced ${traced}, aperture() ${model}`);
    if (expect !== null) assert.ok(Math.abs(model - expect) < 0.001, `${JSON.stringify(input)}: ${model}`);
    // in these cases the light is less steep than the jaws' flare, so only the land narrows it
    assert.ok(Math.abs(amp) < d.walls[kind === 'rise' ? 'E' : 'W'].flare, `${JSON.stringify(input)}: ${amp}`);
  }
  // The jaws cut a beam further only when it is steeper than their flare. No case above reaches that,
  // so it is checked with a made-up angle: 8 degrees past the flare of the box for the equator.
  {
    const m = F.boxMesh({ lat: 0 }), d = m.design, tris = triArray(m), amp = d.walls.E.flare + 8;
    const { landed, out } = shine(tris, d, 'rise', amp, 15, 0.002);
    const traced = (landed.length + out) * 0.002, model = F.aperture(d, 'rise', amp);
    const landOnly = d.params.slit * Math.cos(amp * RAD) - F.FIXED.land * Math.sin(amp * RAD);
    assert.ok(landOnly - model > 0.1, `the jaws take ${landOnly - model} mm`);
    assert.ok(Math.abs(traced - model) < 0.01, `made-up angle ${amp}: traced ${traced}, aperture() ${model}`);
  }
  assert.doesNotMatch(CLAIMS, /one where the jaws would cut in/);
  // the README's figures, and the page's advice
  assert.match(README, /0\.13 mm at the June solstice, 16% of the slit/);
  assert.match(README, /37 mornings around the December solstice/);
  const d = F.design({ lat: 58, slit: 0.8, horizonE: 5, horizonW: 5 }), track = F.yearTrack(d, 2026);
  assert.equal(track.filter((t) => F.aperture(d, 'rise', t.ampRise) === 0).length, 37);
  assert.doesNotMatch(CLAIMS, /full width the slit should allow/);
  assert.match(PAGE, /pick a wider one/);
});

test('light past the end of the far wall is reported where it falls, on the near wall by a tip', () => {
  // At 58 N with a 5 degree skyline the December sunrise is 62.7 degrees off the axis, past the far
  // wall's end (59.2 degrees); its light, what little gets in, falls on the inside of the near wall.
  const m = F.boxMesh({ lat: 58, horizonE: 5, horizonW: 5, slit: 1.6 }), d = m.design, tris = triArray(m);
  const g = d.grooves.find((x) => x.k === -6);
  const L = F.landing(d, 'rise', g.ampRise);
  assert.equal(L.onFar, false);
  assert.equal(L.hit, null);
  // the point is on the east wall's inner face (radius R about the west slit) and inside the box
  assert.ok(Math.abs(Math.hypot(L.point[0] + d.D / 2, L.point[1]) - d.R) < 1e-6);
  assert.ok(Math.hypot(L.point[0] - d.D / 2, L.point[1]) < d.R);
  // and traced light lands there
  const { landed } = shine(tris, d, 'rise', g.ampRise, 15, 0.002);
  assert.ok(landed.length > 50);
  for (const x of landed) assert.ok(Math.hypot(x.p[0] - L.point[0], x.p[1] - L.point[1]) < 1, `traced ${x.p} vs ${L.point}`);
  // on the page's opening box nothing changes
  const d0 = F.design({ lat: 45 });
  assert.ok(F.yearTrack(d0, 2026).every((t) => F.landing(d0, 'rise', t.ampRise).onFar && F.landing(d0, 'set', t.ampSet).onFar));
});

test('stepping through the year without animation stops at both dates of every groove', () => {
  // The first version kept one day per groove, so half the dates in the key were never shown.
  for (const lat of [45, -33.9, 0, 58]) {
    const d = F.design({ lat }), track = F.yearTrack(d, 2026), stops = F.readingStops(d, track, 2026);
    const keyDays = F.key(d, 2026, track).flatMap((row) => (row.rise && Math.abs(row.k) !== 6 ? row.rise : []));
    const nOf = (s) => { const [dd, mm] = s.split(' '); return track.findIndex((t) => t.day === +dd && t.month === F.MONTHS.indexOf(mm) + 1) + 1; };
    for (const s of keyDays) assert.ok(stops.some((n) => Math.abs(n - nOf(s)) <= 1), `${lat}: no stop within a day of ${s}`);
  }
});

test('the error budget: days per degree of turning, and the morning-to-morning spread the README quotes', () => {
  // The page said a degree of turning is "one to two days" near the equinoxes; nearer the equator it is more.
  let lo = Infinity, hi = 0;
  for (let lat = -58; lat <= 58; lat += 0.5) {
    const d = F.design({ lat }), b = F.budget(d, F.yearTrack(d, 2026), 2026);
    const x = b.rows.find((r) => r.key === 'turn').daysEq;
    lo = Math.min(lo, x); hi = Math.max(hi, x);
  }
  assert.ok(hi > 2.5, `at the equator ${hi} days a degree`);
  assert.match(PAGE, new RegExp(`from about ${lo.toFixed(1)} days at 58&deg; to ${hi.toFixed(1)} at the equator`));
  assert.doesNotMatch(PAGE, /one to two days/);
  // "about a day at 45 N" was more than the page's own budget gives
  const d = F.design({ lat: 45 }), b = F.budget(d, F.yearTrack(d, 2026), 2026);
  assert.match(README, new RegExp(`come to ${b.rssEq.toFixed(1)} days`));
  assert.ok(b.rssEq > 1.2, `${b.rssEq}`);
  assert.doesNotMatch(CLAIMS, /within about a day at 45/);
});

test('a slot near the slit keeps 2.4 mm from it as designed, and the page warns of it', () => {
  // the reviewer's thinnest case: the piece of wall between slit and slot stands on the floor alone
  const d = F.design({ lat: 15, size: 70, slit: 0.8, day: '03-10' });
  const p = F.slotPillars(d);
  assert.ok(p.length === 2 && p.every((x) => x.mm >= 2.4 - 1e-3 && x.mm < 6), JSON.stringify(p));
  assert.doesNotMatch(CLAIMS, /no thin pillars/);
  assert.doesNotMatch(CLAIMS, /no pillar thinner than 2\.4 mm/);
  assert.match(CLAIMS, /about 2\.1 mm in the thinnest case found/);
  assert.doesNotMatch(APPSRC, /where nothing is cut/);
});

test('the words on a sunken horizon, the refraction below 0 and a 180 mm bed match the numbers', () => {
  // the dip of a sea horizon: about 1.76 arcminutes times the square root of the eye's height in metres
  const dip = (h) => (1.76 * Math.sqrt(h)) / 60;
  assert.match(PAGE, new RegExp(`so ${dip(20).toFixed(2)}&deg; from a 20&nbsp;m roof`));
  assert.match(PAGE, new RegExp(`a full degree only from about ${((60 / 1.76) ** 2 / 1000).toFixed(1)}&nbsp;km up`));
  // a sea horizon below the eye: the light grazes the sea, bent by the horizontal refraction plus about
  // 0.13 of the angle its path turns through on the way up to the eye (a rough estimate, not checked)
  const grazing = F.refraction(0) * 60 + 0.13 * (1 / Math.sqrt(1 - 0.13)) * 60;
  assert.match(README, new RegExp(`about ${grazing.toFixed(0)}′ at −1°, where Bennett's formula gives ${(F.refraction(-1) * 60).toFixed(1)}′`));
  // the largest box is 176.7 mm long, and the slicer's default skirt (6 mm off, one line) runs off a
  // 180 mm bed; turned 45 degrees it is about 132 mm across
  const m = F.boxMesh({ size: 102 }), c = Math.SQRT1_2;
  const across = (sx, sy) => { const v = m.vertices.map((p) => p[0] * sx + p[1] * sy); return Math.max(...v) - Math.min(...v); };
  assert.ok(across(c, c) + 2 * 6.45 < 180 && across(c, -c) + 2 * 6.45 < 180, `${across(c, c)}`);
  assert.match(README, new RegExp(`about ${Math.round(across(c, c))} mm across`));
  assert.match(PAGE, new RegExp(`a box over about ${Math.floor((180 - 2 * 6.45) / Math.sqrt(3))}&nbsp;mm puts the slicer&rsquo;s skirt off`));
});
