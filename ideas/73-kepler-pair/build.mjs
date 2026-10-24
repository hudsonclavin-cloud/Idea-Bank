#!/usr/bin/env node
// Writes the committed STLs (the default settings) with the same code the page uses.
//   node build.mjs            the four STLs
//   node build.mjs --budget   also budget.js: the reading-error budget for every setting the
//                             page offers, and each wheel's balance (about 30 minutes on 3 cores)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

const here = path.dirname(fileURLToPath(import.meta.url));
const K = createRequire(import.meta.url)('./kepler.js');

// committed file -> part, and the 80-byte STL header name
export const FILES = {
  'default.stl': ['base', 'kepler-pair base plate'],
  'default-time-wheel.stl': ['time', 'kepler-pair time wheel'],
  'default-kepler-wheel.stl': ['kepler', 'kepler-pair kepler wheel'],
  'coupon.stl': ['coupon', 'kepler-pair calibration coupon'],
};
export function defaultSTLs() {
  const parts = K.buildParts(K.design({}));
  const out = {};
  for (const [file, [part, name]] of Object.entries(FILES)) out[file] = K.Mesh.stl(parts[part], name);
  return out;
}
const r2 = (x) => Math.round(x * K.DEG * 100) / 100;
const tenths = (x) => Math.round(x * K.DEG * 10); // per-dot errors in tenths of a degree, to keep budget.js small
const mm = (x) => Math.round(x * 100) / 100;
export function budgetFor(body, C, bore) {
  const d = K.design({ body, C, bore });
  const o = K.wheelOutlines(d);
  const b = K.errorBudget(d, o);
  const wk = K.wheel2D(d, 'kepler', o.kepler);
  const wt = K.wheel2D(d, 'time', o.time);
  // short keys keep budget.js small: t teeth, b bores, l loose, m and ml the dot margins (bores, loose),
  // n binds, d the largest bores error at each dot in tenths of a degree; and the balance: h the
  // Kepler wheel's counterweight height, s and sT how far each wheel's centre of mass lies inside
  // the flats of its boss (mm)
  return {
    t: r2(b.teeth),
    b: r2(b.bores),
    l: r2(b.loose),
    m: r2(b.marginBores),
    ml: r2(b.marginLoose),
    n: b.binds,
    d: b.dotBores.map(tenths),
    h: wk.weightH,
    s: mm(wk.balance.inside),
    sT: mm(wt.balance.inside),
  };
}
export function combos() {
  const out = [];
  for (const body of K.OPTIONS.bodies) for (const C of K.cRange(body)) for (const bore of K.OPTIONS.bore.values) out.push([body, C, bore]);
  return out;
}

if (!isMainThread) {
  for (const c of workerData) parentPort.postMessage([c.join('|'), budgetFor(...c)]);
} else if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const [file, bytes] of Object.entries(defaultSTLs())) {
    fs.writeFileSync(path.join(here, file), bytes);
    console.log(file, bytes.length, 'bytes');
  }
  if (process.argv.includes('--budget')) {
    const all = combos();
    const nw = Math.max(1, Math.min(3, os.availableParallelism() - 1));
    const result = {};
    const t0 = Date.now();
    await Promise.all(
      Array.from({ length: nw }, (_, w) =>
        new Promise((resolve, reject) => {
          const wk = new Worker(fileURLToPath(import.meta.url), { workerData: all.filter((_, i) => i % nw === w) });
          wk.on('message', ([key, v]) => {
            result[key] = v;
            console.log(key, 'bores', v.b, 'loose', v.l, 'margin', v.m, `${Object.keys(result).length}/${all.length}`, `${((Date.now() - t0) / 1000) | 0}s`);
          });
          wk.on('error', reject);
          wk.on('exit', resolve);
        }),
      ),
    );
    const ordered = {};
    for (const c of all) ordered[c.join('|')] = result[c.join('|')];
    const text = `/* Reading-error budget for every setting the page offers, from kepler.js errorBudget(), made by
   build.mjs --budget. In degrees: t teeth, b bores, l loose (the largest errors found), m and ml the
   smallest margin by which a reading is nearer its own dot than a neighbour (bores, loose); n the
   number of sampled positions where the teeth bound; d the largest bores error at each dot, in
   tenths of a degree. In mm: h the Kepler wheel's counterweight height, s and sT how far the Kepler
   and time wheels' centres of mass lie inside the flats of their bosses. Do not edit;
   budget.test.mjs recomputes the default entry. */
(function (root, data) {
  if (typeof module === 'object' && module.exports) module.exports = data;
  else root.KPBudget = data;
})(typeof self !== 'undefined' ? self : this, ${JSON.stringify(ordered)});
`;
    fs.writeFileSync(path.join(here, 'budget.js'), text);
    console.log('budget.js', text.length, 'bytes');
  }
}
