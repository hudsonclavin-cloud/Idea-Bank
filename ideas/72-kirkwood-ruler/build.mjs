#!/usr/bin/env node
// Writes default.stl from belt.js with the page's default settings. The test suite regenerates it
// and checks that the committed file is byte-identical.  Usage: node build.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const Belt = require('./belt.js');

export function defaultStl() {
  return Belt.stl(Belt.model(Belt.DEFAULTS).mesh);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const bytes = defaultStl();
  fs.writeFileSync(path.join(here, 'default.stl'), bytes);
  const L = Belt.layout(Belt.DEFAULTS);
  console.log(`default.stl: ${bytes.length} bytes, ${(bytes.length - 84) / 50} triangles, ${L.size.map((v) => v.toFixed(2)).join(' x ')} mm`);
}
