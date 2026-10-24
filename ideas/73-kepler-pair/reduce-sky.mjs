#!/usr/bin/env node
// Makes sky.js from JPL Horizons state vectors (DE441). Not run by the page or the tests: it
// records how sky.js was made. Fetched 2026-10-24 with, for each target T, start S, stop E, step H:
//   https://ssd.jpl.nasa.gov/api/horizons.api?format=text&COMMAND='T'&OBJ_DATA='NO'
//     &MAKE_EPHEM='YES'&EPHEM_TYPE='VECTORS'&CENTER='500@10'&REF_PLANE='ECLIPTIC'
//     &REF_SYSTEM='ICRF'&VEC_TABLE='2'&CSV_FORMAT='YES'&OUT_UNITS='AU-D'
//     &START_TIME='S'&STOP_TIME='E'&STEP_SIZE='H'
//   mer.txt  199 Mercury                2000-01-01  2051-01-01  6 h
//   mab.txt  4   Mars barycentre        2000-01-01  2051-01-01  2 d
//   emb.txt  3   Earth-Moon barycentre  2000-01-01  2051-01-01  1 d
//   plb.txt  9   Pluto barycentre       1700-01-01  2300-01-01  30 d
// All heliocentric, ecliptic and equinox of J2000, TDB.
// Usage: node reduce-sky.mjs <folder with the four files>   (writes sky.js next to this script)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const K = createRequire(import.meta.url)('./kepler.js');
const dir = process.argv[2];
if (!dir) {
  console.error('usage: node reduce-sky.mjs <folder with mer.txt mab.txt emb.txt plb.txt>');
  process.exit(2);
}
const J2000 = 2451545.0;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function load(f) {
  const t = fs.readFileSync(path.join(dir, f), 'utf8');
  const rows = t
    .slice(t.indexOf('$$SOE') + 5, t.indexOf('$$EOE'))
    .trim()
    .split('\n')
    .map((l) => {
      const c = l.split(',');
      return { jd: +c[0], p: [+c[2], +c[3], +c[4]], v: [+c[5], +c[6], +c[7]] };
    });
  const src = (t.match(/Target body name: ([^{]+)\{source: ([^}]+)\}/) || []).slice(1).map((s) => s.trim());
  return { rows, target: src[0], source: src[1] };
}
// Cubic Hermite position (and velocity) between rows i and i+1 at fraction s.
function hermite(a, b, s) {
  const h = b.jd - a.jd;
  const s2 = s * s;
  const s3 = s2 * s;
  const H = [2 * s3 - 3 * s2 + 1, s3 - 2 * s2 + s, -2 * s3 + 3 * s2, s3 - s2];
  const D = [6 * s2 - 6 * s, 3 * s2 - 4 * s + 1, -6 * s2 + 6 * s, 3 * s2 - 2 * s];
  const p = [0, 1, 2].map((k) => H[0] * a.p[k] + H[1] * h * a.v[k] + H[2] * b.p[k] + H[3] * h * b.v[k]);
  const v = [0, 1, 2].map((k) => (D[0] * a.p[k] + D[2] * b.p[k]) / h + D[1] * a.v[k] + D[3] * b.v[k]);
  return { p, v };
}
function at(rows, jd) {
  let lo = 0;
  let hi = rows.length - 1;
  if (jd < rows[0].jd || jd > rows[hi].jd) throw new Error('time outside the data');
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].jd <= jd) lo = mid;
    else hi = mid;
  }
  return hermite(rows[lo], rows[lo + 1], (jd - rows[lo].jd) / (rows[lo + 1].jd - rows[lo].jd)).p;
}
// Perihelia: where r.v changes from negative to positive, refined by bisection on the Hermite curve.
function perihelia(rows) {
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1];
    const b = rows[i];
    if (dot(a.p, a.v) < 0 && dot(b.p, b.v) >= 0) {
      let lo = 0;
      let hi = 1;
      for (let it = 0; it < 60; it++) {
        const m = (lo + hi) / 2;
        const q = hermite(a, b, m);
        if (dot(q.p, q.v) < 0) lo = m;
        else hi = m;
      }
      out.push(a.jd + ((lo + hi) / 2) * (b.jd - a.jd));
    }
  }
  return out;
}

const plan = [
  { key: 'mercury', file: 'mer.txt', from: 2461041.5, orbits: 5 }, // from the first perihelion of 2026
  { key: 'mars', file: 'mab.txt', from: 2461041.5, orbits: 3 },
  { key: 'earth', file: 'emb.txt', from: 2461041.5, orbits: 3 },
  { key: 'pluto', file: 'plb.txt', from: 2447000, orbits: 1 }, // the 1989 perihelion
];
const out = { fetched: '2026-10-24', frame: 'heliocentric, ecliptic and equinox of J2000, TDB', ephemeris: 'DE441 (JPL Horizons)', unit: 1e-7, bodies: {} };
for (const p of plan) {
  const { rows, target, source } = load(p.file);
  const B = K.BODIES[p.key];
  const peri = perihelia(rows);
  const T0 = peri.find((t) => t > p.from);
  const n = B.dots * p.orbits;
  const xyz = [];
  for (let k = 0; k <= n; k++) for (const c of at(rows, T0 + (k * B.P) / B.dots)) xyz.push(Math.round(c / out.unit));
  out.bodies[p.key] = {
    target: `${target} (${source})`,
    // perihelion passages in the data, as JD - 2451545 (days from J2000)
    peri: peri.map((t) => +(t - J2000).toFixed(3)),
    // positions at the machine's dots: T0 + k P / dots, k = 0 .. dots x orbits
    T0: +(T0 - J2000).toFixed(4),
    xyz,
  };
  console.log(p.key, target, source, 'perihelia', peri.length, 'T0', T0.toFixed(3), 'samples', n + 1);
}
const text = `/* DE441 positions for The Kepler Pair, made by reduce-sky.mjs from JPL Horizons. Do not edit. */
(function (root, data) {
  if (typeof module === 'object' && module.exports) module.exports = data;
  else root.KPSky = data;
})(typeof self !== 'undefined' ? self : this, ${JSON.stringify(out)});
`;
fs.writeFileSync(path.join(here, 'sky.js'), text);
console.log('sky.js', text.length, 'bytes');
