// The long sweep: 6,480 boxes over a grid of every setting the page offers (12 latitudes, 4 sizes,
// 3 slit widths, 5 pairs of horizons, 9 days of your own), each written as a binary STL and read back
// the way a slicer reads it (float32 corners merged only when identical). Checks every edge is shared
// by exactly two triangles running opposite ways, no triangle collapses, and the solid has no handles.
// firstlight.test.mjs runs a 300-box subset of this; this takes about a minute.
// Usage, from the repository root: node ideas/71-first-light/sweep.mjs
import { createRequire } from 'node:module';
const F = createRequire(import.meta.url)('./firstlight.js');

function check(buf) {
  const dv = new DataView(buf), n = dv.getUint32(80, true), ids = new Map(), faces = [];
  let o = 84, V = 0;
  for (let i = 0; i < n; i++) {
    o += 12;
    const f = [];
    for (let k = 0; k < 3; k++) {
      const key = dv.getFloat32(o, true) + ',' + dv.getFloat32(o + 4, true) + ',' + dv.getFloat32(o + 8, true);
      o += 12;
      if (!ids.has(key)) ids.set(key, V++);
      f.push(ids.get(key));
    }
    o += 2;
    faces.push(f);
  }
  const E = new Map();
  let degenerate = 0, unpaired = 0;
  for (const f of faces) {
    if (f[0] === f[1] || f[1] === f[2] || f[0] === f[2]) degenerate++;
    for (let k = 0; k < 3; k++) { const key = f[k] + ',' + f[(k + 1) % 3]; E.set(key, (E.get(key) || 0) + 1); }
  }
  for (const [key, c] of E) { const [a, b] = key.split(','); if (c !== 1 || E.get(b + ',' + a) !== 1) unpaired++; }
  return { unpaired, degenerate, euler: V - E.size / 2 + n };
}

let total = 0, failed = 0;
const t0 = Date.now();
for (const lat of [-58, -45, -23.4, -10, 0, 0.1, 10, 23.5, 35, 45, 51.5, 58]) for (const size of [70, 85, 100, 102]) for (const slit of [0.8, 1.2, 1.6])
  for (const [horizonE, horizonW] of [[0, 0], [-1, 5], [5, -1], [5, 5], [-1, -1]]) for (const day of ['', '02-29', '03-20', '06-21', '12-21', '05-14', '10-31', '09-23', '01-01']) {
    const input = { lat, lon: lat * 3, size, slit, horizonE, horizonW, day };
    total++;
    try {
      const r = check(F.stl(F.boxMesh(input), 'sweep'));
      if (r.unpaired || r.degenerate || r.euler !== 2) { failed++; console.log('FAIL', JSON.stringify(input), r); }
    } catch (e) { failed++; console.log('ERROR', JSON.stringify(input), e.message); }
  }
console.log(`${total} boxes, ${failed} failed, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
process.exit(failed ? 1 : 0);
