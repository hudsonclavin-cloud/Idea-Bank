#!/usr/bin/env node
// Simulated readers for By Eye's tests. Each observer has a true setting T and adjusts toward it
// imperfectly; the question is whether a method gets T back. Run from the repo root:
//
//   node ideas/59-by-eye/simulate.mjs      print the comparison, and the table quoted in the README
//
// The observer is written here, not in method.js, so the method is checked by code that is not
// the method. An observer starting at s stops at
//
//   stop = s + f * (T + side * zone - s) + noise
//
// where side is +1 if it approaches from above and -1 from below. f = 1 goes all the way; f < 1
// stops a fixed fraction short (anchoring on the start); zone > 0 stops at the near edge of a band
// in which it cannot tell the difference. f = 0 never moves at all.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const M = require('./method.js');
const FACES = require('./typefaces.js');

// The method before the independent review: start bands centred on the typefaces' corrections,
// not on the ruler, and the mean of two stops as the result (app.js as first deposited).
export const OLD = {
  round: { high: [0.035, 0.055], low: [-0.025, -0.012] },
  point: { high: [0.06, 0.09], low: [-0.035, -0.015] },
  bar: { high: [1.1, 1.18], low: [0.66, 0.74] },
  middle: { high: [0.56, 0.585], low: [0.425, 0.445] },
  halves: { high: [0.53, 0.55], low: [0.415, 0.435] },
};

// Each test's display units, as the page reports them.
export const SHOW = {
  round: (v) => v * 100,
  point: (v) => v * 100,
  bar: (v) => (1 / v - 1) * 100,
  middle: (v) => (v - 0.5) * 100,
  halves: (v) => (1 - v / (1 - v)) * 100,
};
// Noise (one standard deviation) and the half-width of a can't-tell band, in parameter units.
export const NOISE = { round: 0.003, point: 0.004, bar: 0.02, middle: 0.003, halves: 0.004 };

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
// The typefaces' median correction, in parameter units, for each test.
export const TYPICAL = {
  round: median(FACES.sans.map((f) => f.round)),
  point: median(FACES.pointed.map((f) => f.pointBottom)),
  bar: median(FACES.sans.map((f) => f.bar)),
  middle: median(FACES.sans.map((f) => f.middle)),
  halves: median(FACES.sans.map((f) => f.halves8)),
};

export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(rand) {
  let u = 0;
  while (!u) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

// One observer: { T, f, zone, noise }. Stops are kept inside the control's window.
export function observe(key, o, s, rand) {
  const [w0, w1] = M.PLAN[key].window;
  const side = s >= o.T ? 1 : -1;
  const stop = s + o.f * (o.T + side * o.zone - s) + (o.noise ? o.noise * gauss(rand) : 0);
  return Math.min(w1, Math.max(w0, stop));
}

// The page's method (method.js): four tries, fixed point of the fitted line.
export function runNew(key, o, rand) {
  const sides = [...M.pairOrder(rand), ...M.pairOrder(rand)];
  const tries = [];
  for (let n = 0; n < M.TRIES; n++) {
    const { start, side } = M.startFor(key, n, tries, sides, rand);
    const stop = observe(key, o, start, rand);
    tries.push({ start, stop, side, moved: stop !== start || o.f > 0 });
  }
  return M.estimate(key, tries);
}

// The old method: one try from each old band, in random order, and the mean of the two stops.
export function runOld(key, o, rand) {
  const b = OLD[key];
  const draw = (r) => r[0] + rand() * (r[1] - r[0]);
  const stops = (rand() < 0.5 ? [b.high, b.low] : [b.low, b.high]).map((r) => observe(key, o, draw(r), rand));
  return { ok: true, value: (stops[0] + stops[1]) / 2 };
}

// The value below which a share q of the sorted list lies.
const quantile = (a, q) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.round(q * (s.length - 1))];
};
// Many runs of one observer: the median error in display units, the range holding the middle 90%
// of single results' errors, and the share of runs with no result.
export function summarise(key, o, method, runs = 2000, seed = 1) {
  const rand = rng(seed);
  const errs = [];
  let none = 0;
  for (let i = 0; i < runs; i++) {
    const r = method(key, o, rand);
    if (!r.ok) none++;
    else errs.push(SHOW[key](r.value) - SHOW[key](o.T));
  }
  const ok = errs.length > 0;
  return { median: ok ? median(errs) : NaN, p5: ok ? quantile(errs, 0.05) : NaN, p95: ok ? quantile(errs, 0.95) : NaN, none: none / runs, n: errs.length };
}

// The observers in the README's table, for one test.
export function observers(key) {
  const n = NOISE[key];
  const R = M.PLAN[key].ruler;
  return [
    { label: 'goes all the way', o: { T: TYPICAL[key], f: 1, zone: 0, noise: n } },
    { label: 'stops a quarter short, eye = typefaces', o: { T: TYPICAL[key], f: 0.75, zone: 0, noise: n } },
    { label: 'stops a quarter short, eye = ruler', o: { T: R, f: 0.75, zone: 0, noise: n } },
    { label: 'stops at the edge of a can’t-tell band', o: { T: TYPICAL[key], f: 1, zone: n, noise: n } },
    { label: 'both', o: { T: TYPICAL[key], f: 0.75, zone: n, noise: n } },
    { label: 'never moves', o: { T: R, f: 0, zone: 0, noise: 0 } },
  ];
}

// The README's table: for each test, the median error (display units) of the old and the new
// method for three readers, each run 2000 times with a fixed seed so the table is reproducible.
const UNITS = {
  round: 'O overshoot, % of cap height',
  point: 'A and V overshoot, % of cap height',
  bar: 'uprights thicker, %',
  middle: 'bar above middle, % of cap height',
  halves: '8: top smaller, %',
};
const TITLES = { round: 'Round', point: 'Points', bar: 'Across', middle: 'Middle', halves: 'Halves' };
const sgn = (v) => (Number.isNaN(v) ? 'none' : (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2));
export function readmeRows() {
  const rows = [];
  for (const key of Object.keys(M.PLAN)) {
    const n = NOISE[key];
    const R = M.PLAN[key].ruler;
    const cells = [
      { T: R, f: 0.75, zone: 0, noise: n },
      { T: TYPICAL[key], f: 0.75, zone: 0, noise: n },
      { T: R, f: 0, zone: 0, noise: 0 },
    ].map((o) => {
      const a = summarise(key, o, runOld);
      const b = summarise(key, o, runNew);
      const pct = Math.round(b.none * 100);
      const nw = b.none === 1 ? 'no result' : sgn(b.median) + (pct > 0 ? ` (no result ${pct}%)` : '');
      return `${sgn(a.median)} → ${nw}`;
    });
    rows.push(`| ${TITLES[key]} (${UNITS[key]}) | ${SHOW[key](TYPICAL[key]).toFixed(2)} | ${cells.join(' | ')} |`);
  }
  return rows;
}

// The README's second table: a harder reader, who closes only 55% of the distance on each try and
// is twice as unsteady, with an eye at the ruler and at the typefaces' median; and, for the reader
// of the first table whose eye is at the typefaces' median, how widely single results scatter.
export const HARD = { f: 0.55, noise: 2 };
const range90 = (r) => `${sgn(r.p5)} to ${sgn(r.p95)}`;
export function hardRows() {
  const rows = [];
  for (const key of Object.keys(M.PLAN)) {
    const n = NOISE[key];
    const R = M.PLAN[key].ruler;
    const cells = [R, TYPICAL[key]].map((T) => {
      const o = { T, f: HARD.f, zone: 0, noise: HARD.noise * n };
      const a = summarise(key, o, runOld);
      const b = summarise(key, o, runNew);
      return `${sgn(a.median)} → ${sgn(b.median)} (no result ${Math.round(b.none * 100)}%)`;
    });
    const o = { T: TYPICAL[key], f: 0.75, zone: 0, noise: n };
    const a = summarise(key, o, runOld);
    const b = summarise(key, o, runNew);
    cells.push(`${range90(a)} / ${range90(b)}`);
    rows.push(`| ${TITLES[key]} | ${cells.join(' | ')} |`);
  }
  return rows;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1]);
if (isMain) {
  const fmt = (v) => (Number.isNaN(v) ? '—' : (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2));
  for (const key of Object.keys(M.PLAN)) {
    console.log(`\n${key}: typefaces' median ${SHOW[key](TYPICAL[key]).toFixed(2)}, start centre before the review ${SHOW[key]((OLD[key].high[0] + OLD[key].high[1] + OLD[key].low[0] + OLD[key].low[1]) / 4).toFixed(2)} (display units)`);
    for (const { label, o } of observers(key)) {
      const a = summarise(key, o, runOld);
      const b = summarise(key, o, runNew);
      console.log(`  ${label.padEnd(40)} old ${fmt(a.median).padStart(6)}   new ${fmt(b.median).padStart(6)}   new gives no result ${(b.none * 100).toFixed(0)}%`);
    }
  }
  console.log('\nREADME rows (median error of the result, old → new):');
  for (const r of readmeRows()) console.log(r);
  console.log('\nREADME rows, harder reader and scatter:');
  for (const r of hardRows()) console.log(r);
}
