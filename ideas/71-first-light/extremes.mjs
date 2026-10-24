// Runs the repository's print check (tools/printcheck.py: closed solid, on the bed, fits 180 mm,
// overhangs, wall thickness, and a PrusaSlicer slice with and without supports) on boxes made at the
// ends of every setting the page offers, one at a time and in corner combinations.
// Usage, from the repository root: node ideas/71-first-light/extremes.mjs [outdir]
// It writes the STL files to outdir (default: a fresh temporary folder), never into the idea's folder.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const F = createRequire(import.meta.url)('./firstlight.js');
const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'first-light-'));
fs.mkdirSync(out, { recursive: true });

const cases = {
  'lat-min': { lat: -58 }, 'lat-max': { lat: 58 }, 'lat-zero': { lat: 0 },
  'lon-min': { lon: -180, day: '01-01' }, 'lon-max': { lon: 180, day: '01-01' },
  'horizonE-min': { horizonE: -1 }, 'horizonE-max': { horizonE: 5 },
  'horizonW-min': { horizonW: -1 }, 'horizonW-max': { horizonW: 5 },
  'size-min': { size: 70 }, 'size-max': { size: 102 },
  'slit-min': { slit: 0.8 }, 'slit-max': { slit: 1.6 },
  'day-leap': { day: '02-29' }, 'day-solstice': { day: '06-21' },
  'corner-big': { lat: 58, size: 102, slit: 1.6, horizonE: 5, horizonW: 5, day: '06-21' },
  'corner-small': { lat: -58, size: 70, slit: 0.8, horizonE: -1, horizonW: -1, day: '12-21' },
  'corner-tropic': { lat: 0, size: 70, slit: 1.6, horizonE: 5, horizonW: -1, day: '02-29' },
};
for (const [name, input] of Object.entries(cases)) {
  const m = F.boxMesh(input);
  fs.writeFileSync(path.join(out, `${name}.stl`), Buffer.from(F.stl(m, F.stlLabel(m.design))));
}
console.log(`wrote ${Object.keys(cases).length} STL files to ${out}`);
const r = spawnSync('python3', [path.join(HERE, '..', '..', 'tools', 'printcheck.py'), out], { stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);
