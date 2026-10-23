#!/usr/bin/env node
/* Lies Flat from the command line.
   node cli.js <seed>              write the SVG to stdout
   node cli.js <seed> out.svg      write it to a file (and a one-line summary to stderr)
   node cli.js <seed> --stats      print the statistics as JSON */
'use strict';
const fs = require('fs');
const path = require('path');
const LF = require(path.join(__dirname, 'fold.js'));

const [seed, out] = process.argv.slice(2);
if (!seed || seed === '-h' || seed === '--help') {
  console.error('usage: node cli.js <seed> [out.svg | --stats]');
  process.exit(seed ? 0 : 2);
}
const res = LF.generate(seed);
if (out === '--stats') {
  process.stdout.write(JSON.stringify(res.stats, null, 2) + '\n');
} else if (out) {
  fs.writeFileSync(out, res.svg);
  const s = res.stats;
  console.error(`seed ${seed}: ${s.vertices} vertices, ${(s.length / 1000).toFixed(1)} m of line, ${s.lifts} pen lifts, about ${Math.round(s.seconds / 60)} min -> ${out} (${(res.svg.length / 1024).toFixed(1)} KB)`);
} else {
  process.stdout.write(res.svg);
}
