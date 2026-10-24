#!/usr/bin/env node
// Prints the extremes. Builds the solid at the ends of every control on the page (and the presets),
// writes each STL to a temporary folder and runs the repository's printcheck (trimesh + PrusaSlicer)
// on all of them. Slow (a few minutes): it is not part of the test suite, which instead checks the
// same shapes, and many more, for closure in Node.  Usage: node sweep.mjs [--keep]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Belt = require('./belt.js');
const here = path.dirname(fileURLToPath(import.meta.url));
const printcheck = path.join(here, '..', '..', 'tools', 'printcheck.py');

export const EXTREMES = [
  { name: 'default' },
  { name: 'short-flat-narrow', length: 50, relief: 4, depth: 8 },
  { name: 'long-tall-deep', length: 170, relief: 40, depth: 30 },
  { name: 'long-tall-thin', length: 170, relief: 40, depth: 8 },
  { name: 'whole-belt-log', a0: 1.5, a1: 5.5, scale: 'log', length: 170, relief: 40 },
  { name: 'whole-belt-short', a0: 1.5, a1: 5.5, length: 50, bin: 0.1 },
  { name: 'zoom-3to1-fine', a0: 2.45, a1: 2.55, bin: 0.0025, length: 170, relief: 40 },
  { name: 'zoom-edge-low', a0: 1.5, a1: 1.6, bin: 0.0025 },
  { name: 'zoom-edge-high', a0: 5.4, a1: 5.5, bin: 0.0025, relief: 40 },
  { name: 'by1866-linear-tall-thin', pop: 'by1866', length: 170, relief: 40, depth: 8, bin: 0.0025 },
  { name: 'by1866-whole', pop: 'by1866', a0: 1.5, a1: 5.5, relief: 40 },
  { name: 'first1000-sqrt', pop: 'first1000', scale: 'sqrt', relief: 40, depth: 8 },
  { name: 'big-outer-sqrt', pop: 'big', a0: 3.3, a1: 5.4, scale: 'sqrt', relief: 40 },
  { name: 'good-no-ledge', pop: 'good', ledge: false, depth: 8, relief: 40 },
  { name: 'no-ledge-short-flat', ledge: false, length: 50, relief: 4, depth: 8 },
  { name: 'coarse-bins', bin: 0.1, relief: 40 },
  { name: 'sparse-outer-fins', a0: 4.4, a1: 4.9, bin: 0.0025, relief: 40, depth: 8 },
];

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kirkwood-sweep-'));
  for (const e of EXTREMES) {
    const m = Belt.model(e);
    const f = Belt.meshFacts(m.mesh);
    if (!f.closedAndOriented) throw new Error(`${e.name}: not closed`);
    fs.writeFileSync(path.join(dir, `${e.name}.stl`), Belt.stl(m.mesh));
    console.log(`${e.name}: ${m.layout.size.map((v) => v.toFixed(1)).join(' x ')} mm, ${f.triangles} triangles, bins ${m.layout.binMm.toFixed(2)} mm`);
  }
  const r = spawnSync('python3', [printcheck, dir], { encoding: 'utf8', stdio: 'inherit' });
  if (!process.argv.includes('--keep')) fs.rmSync(dir, { recursive: true, force: true });
  else console.log(`kept ${dir}`);
  process.exit(r.status);
}
