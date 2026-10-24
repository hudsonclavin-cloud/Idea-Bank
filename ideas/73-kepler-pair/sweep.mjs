#!/usr/bin/env node
// Runs tools/printcheck.py (closed solid, on the bed, fits, overhangs, walls, slices in PrusaSlicer)
// on every part at the default and at the extremes of every setting the page offers.
//   node sweep.mjs [--all] [--keep]   (--all: all 96 settings, not just the extremes; --keep: keep the STLs)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const K = createRequire(import.meta.url)('./kepler.js');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'kepler-pair-'));
const sets = [{}];
for (const body of K.OPTIONS.bodies) {
  const cs = K.cRange(body);
  for (const C of process.argv.includes('--all') ? cs : [cs[0], cs[cs.length - 1]])
    for (const bore of process.argv.includes('--all') ? K.OPTIONS.bore.values : [0.5, 0.7]) sets.push({ body, C, bore });
}
fs.writeFileSync(path.join(out, 'coupon.stl'), K.Mesh.stl(K.couponMesh(), 'coupon'));
for (const s of sets) {
  const d = K.design(s);
  const p = K.buildParts(d);
  for (const part of ['base', 'time', 'kepler']) fs.writeFileSync(path.join(out, `${d.body}-C${d.C}-b${d.bore}-${part}.stl`), K.Mesh.stl(p[part], part));
}
console.log(`${fs.readdirSync(out).length} STLs in ${out}`);
const r = spawnSync('python3', [path.join(here, '..', '..', 'tools', 'printcheck.py'), out], { encoding: 'utf8' });
process.stdout.write(r.stdout + r.stderr);
if (!process.argv.includes('--keep')) fs.rmSync(out, { recursive: true, force: true });
const warn = (r.stdout.match(/warn:/g) || []).length;
const fail = (r.stdout.match(/^FAIL/gm) || []).length;
console.log(`\n${fail} failed, ${warn} warnings`);
process.exit(r.status);
