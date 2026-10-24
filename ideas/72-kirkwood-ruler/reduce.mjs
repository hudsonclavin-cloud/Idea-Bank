#!/usr/bin/env node
// Turns raw JPL Small-Body Database query pages into belt-data.js, the only data the page uses.
//
// The raw pages are not bundled (about 150 MB). To rebuild them, fetch, for s = 0, 300000, ... 1500000:
//   https://ssd-api.jpl.nasa.gov/sbdb_query.api?fields=pdes,a,e,i,H,condition_code,epoch
//     &sb-kind=a&limit=300000&limit-from=<s>&full-prec=1
// save each as page_<s>.json in one folder, then run:  node reduce.mjs <folder>
// The database changes daily, so a rebuild will differ slightly from the bundled file.
//
// What the reduction keeps, for each of five populations:
//  counts: how many asteroids have an osculating semi-major axis a in each 0.0025 au bin from 1.5 to
//          5.5 au (bin k holds 1.5 + k/400 <= a < 1.5 + (k+1)/400), plus how many fall below and above;
//  rTenths: how many asteroids, on average over their orbits, are at each distance r from the Sun, in
//          the same bins, in tenths of an asteroid. An orbit (a, e) spends the fraction
//          (E - e sin E)/pi of its year within r = a(1 - e cos E) of the Sun (Kepler's equation), so each
//          asteroid is spread over the bins between its perihelion and aphelion.
// Nothing else about any asteroid is kept.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const A_MIN = 1.5;
export const A_MAX = 5.5;
export const PER_AU = 400; // fine bins per au (0.0025 au each)
export const NFINE = (A_MAX - A_MIN) * PER_AU; // 1600

// Each population is a test on one raw row: [pdes, a, e, i, H, condition_code, epoch], all strings or null.
export const POPULATIONS = [
  { id: 'all', test: () => true },
  { id: 'good', test: (r) => r[5] === '0' },
  { id: 'big', test: (r) => r[4] !== null && r[4] !== '' && Number(r[4]) < 15 },
  { id: 'first1000', test: (r) => /^\d+$/.test(r[0]) && Number(r[0]) <= 1000 },
  { id: 'by1866', test: (r) => /^\d+$/.test(r[0]) && Number(r[0]) <= 91 },
];

export function fineBin(a) {
  if (!(a >= A_MIN) || !(a < A_MAX)) return -1;
  const k = Math.floor((a - A_MIN) * PER_AU);
  return Math.min(NFINE - 1, Math.max(0, k));
}

// Fraction of its year an orbit (a, e < 1) spends within distance R of the Sun.
export function timeWithin(R, a, e) {
  if (e <= 0) return R >= a ? 1 : 0;
  if (R <= a * (1 - e)) return 0;
  if (R >= a * (1 + e)) return 1;
  const E = Math.acos(Math.max(-1, Math.min(1, (1 - R / a) / e)));
  return (E - e * Math.sin(E)) / Math.PI;
}

// Spread one orbit over the fine bins by the time it spends in each. Returns [below, above] shares.
export function addOrbit(r, a, e) {
  const lo = A_MIN, hi = A_MAX;
  const q = a * (1 - e), Q = a * (1 + e);
  const below = timeWithin(lo, a, e), above = 1 - timeWithin(hi, a, e);
  if (Q >= lo && q < hi) {
    const i0 = Math.max(0, Math.floor((q - lo) * PER_AU)), i1 = Math.min(NFINE - 1, Math.floor((Q - lo) * PER_AU));
    let prev = timeWithin(lo + i0 / PER_AU, a, e);
    for (let i = i0; i <= i1; i++) {
      const next = timeWithin(lo + (i + 1) / PER_AU, a, e);
      r[i] += next - prev;
      prev = next;
    }
  }
  return [below, above];
}

export function reduceRows(rows) {
  const out = {};
  for (const p of POPULATIONS) out[p.id] = { counts: new Array(NFINE).fill(0), total: 0, below: 0, above: 0, r: new Array(NFINE).fill(0), rBelow: 0, rAbove: 0, unbound: 0 };
  for (const r of rows) {
    const a = Number(r[1]);
    const e = Number(r[2]);
    if (r[1] === null || !Number.isFinite(a)) throw new Error(`row without a semi-major axis: ${r[0]}`);
    const k = fineBin(a);
    for (const p of POPULATIONS) {
      if (!p.test(r)) continue;
      const o = out[p.id];
      o.total++;
      if (k >= 0) o.counts[k]++;
      else if (a < A_MIN) o.below++;
      else o.above++;
      if (!(a > 0) || !(e >= 0) || !(e < 1)) { o.unbound++; continue; }
      const [b, ab] = addOrbit(o.r, a, e);
      o.rBelow += b;
      o.rAbove += ab;
    }
  }
  for (const p of POPULATIONS) {
    const o = out[p.id];
    o.rTenths = o.r.map((x) => Math.round(10 * x));
  }
  return out;
}

function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: node reduce.mjs <folder with page_*.json>');
    process.exit(2);
  }
  const files = fs.readdirSync(dir).filter((f) => /^page_\d+\.json$/.test(f))
    .sort((x, y) => Number(x.match(/\d+/)[0]) - Number(y.match(/\d+/)[0]));
  const rows = [];
  const sums = {};
  let declared = null;
  for (const f of files) {
    const buf = fs.readFileSync(path.join(dir, f));
    sums[f] = crypto.createHash('sha256').update(buf).digest('hex');
    const j = JSON.parse(buf);
    if (j.fields.join(',') !== 'pdes,a,e,i,H,condition_code,epoch') throw new Error(`unexpected fields in ${f}`);
    if (declared !== null && declared !== j.count) throw new Error('pages disagree on the total count');
    declared = j.count;
    for (const r of j.data) rows.push(r);
  }
  if (rows.length !== declared) throw new Error(`got ${rows.length} rows, the API declared ${declared}`);
  if (new Set(rows.map((r) => r[0])).size !== rows.length) throw new Error('duplicate designations across pages');
  const epochs = {};
  for (const r of rows) epochs[r[6]] = (epochs[r[6]] || 0) + 1;
  const topEpoch = Object.entries(epochs).sort((x, y) => y[1] - x[1])[0];
  const pops = reduceRows(rows);
  // How far a typical main-belt asteroid's distance from the Sun swings either side of its orbit size.
  const swings = rows.map((r) => [Number(r[1]), Number(r[2])]).filter(([a]) => a > 2.1 && a < 3.3).map(([a, e]) => a * e).sort((x, y) => x - y);
  const medianSwing = swings[Math.floor(swings.length / 2)];
  const data = {
    source: 'NASA/JPL Small-Body Database Query API (ssd-api.jpl.nasa.gov/sbdb_query.api), sb-kind=a, full-prec=1',
    queried: '2026-10-23',
    asteroids: rows.length,
    fields: 'pdes,a,e,i,H,condition_code,epoch',
    epochNote: `${topEpoch[1]} of ${rows.length} orbits osculate at JD ${topEpoch[0]} (2026-06-09.0 TDB); the rest at ${Object.keys(epochs).length - 1} other epochs`,
    mainBelt: { asteroids: swings.length, medianSwing: Math.round(medianSwing * 1000) / 1000 },
    pageSha256: sums,
    aMin: A_MIN, aMax: A_MAX, perAu: PER_AU,
    populations: Object.fromEntries(Object.entries(pops).map(([k, v]) => [k, { total: v.total, below: v.below, above: v.above, counts: v.counts,
      unbound: v.unbound, rBelow: Math.round(10 * v.rBelow) / 10, rAbove: Math.round(10 * v.rAbove) / 10, rTenths: v.rTenths }])),
  };
  const lines = [
    '// Generated by reduce.mjs from the JPL Small-Body Database. Do not edit by hand.',
    '// counts[k] = asteroids with 1.5 + k/400 <= a < 1.5 + (k+1)/400 au (osculating semi-major axis).',
    '// rTenths[k] = tenths of an asteroid at heliocentric distance r in that bin, averaged over each orbit;',
    '// unbound = orbits with e >= 1, left out of rTenths; rBelow / rAbove = time-averaged asteroids outside 1.5-5.5 au.',
    '(function (root) {',
    '  var BELT_DATA = {',
    `    source: ${JSON.stringify(data.source)},`,
    `    queried: ${JSON.stringify(data.queried)},`,
    `    asteroids: ${data.asteroids},`,
    `    fields: ${JSON.stringify(data.fields)},`,
    `    epochNote: ${JSON.stringify(data.epochNote)},`,
    `    // main belt = 2.1 < a < 3.3 au, all asteroids; medianSwing = median of a*e in au`,
    `    mainBelt: ${JSON.stringify(data.mainBelt)},`,
    `    pageSha256: ${JSON.stringify(data.pageSha256)},`,
    `    aMin: ${A_MIN}, aMax: ${A_MAX}, perAu: ${PER_AU},`,
    '    populations: {',
    ...Object.entries(data.populations).map(([k, v]) => `      ${k}: { total: ${v.total}, below: ${v.below}, above: ${v.above}, unbound: ${v.unbound}, rBelow: ${v.rBelow}, rAbove: ${v.rAbove},\n        counts: [${v.counts.join(',')}],\n        rTenths: [${v.rTenths.join(',')}] },`),
    '    }',
    '  };',
    "  if (typeof module === 'object' && module.exports) module.exports = BELT_DATA;",
    '  else root.BELT_DATA = BELT_DATA;',
    "})(typeof globalThis !== 'undefined' ? globalThis : this);",
    '',
  ];
  const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'belt-data.js');
  fs.writeFileSync(out, lines.join('\n'));
  console.log(`wrote ${out}: ${rows.length} asteroids; ` + Object.entries(pops).map(([k, v]) => `${k} ${v.total}`).join(', '));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
