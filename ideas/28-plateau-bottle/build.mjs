#!/usr/bin/env node
// Copies model.js verbatim into index.html and fills every tagged number from it.
//   <span data-v="O_peak">48.4</span>   -> PlateauModel.quoted().O_peak
// Usage: node ideas/28-plateau-bottle/build.mjs   (rewrites index.html in place)
// check.mjs imports render() and fails if the file on disk differs from a fresh render.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

export const DIR = path.dirname(fileURLToPath(import.meta.url));
const BEGIN = '/*MODEL:BEGIN*/';
const END = '/*MODEL:END*/';

export function loadModel(code) {
  return vm.runInNewContext(`${code}\n;PlateauModel;`, {});
}

const TAG = /(<(span|tspan|td|b|strong|em|text)\b([^>]*?)\bdata-v="([^"]+)"([^>]*)>)([^<]*)(<\/\2>)/g;

export function render(html, modelCode, q) {
  const i = html.indexOf(BEGIN);
  const j = html.indexOf(END);
  if (i < 0 || j < i) throw new Error('model markers missing in index.html');
  html = `${html.slice(0, i + BEGIN.length)}\n${modelCode.trim()}\n${html.slice(j)}`;
  if (!q) q = loadModel(modelCode).quoted();
  let count = 0;
  const missing = [];
  html = html.replace(TAG, (m, open, tag, pre, key, post, text, close) => {
    count++;
    if (!(key in q)) {
      missing.push(key);
      return m;
    }
    return open + q[key] + close;
  });
  if (missing.length) throw new Error(`unknown quoted keys in index.html: ${[...new Set(missing)].join(', ')}`);
  return { html, count, q };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = path.join(DIR, 'index.html');
  const model = fs.readFileSync(path.join(DIR, 'model.js'), 'utf8');
  const { html, count } = render(fs.readFileSync(file, 'utf8'), model);
  fs.writeFileSync(file, html);
  console.log(`build: inlined model.js and filled ${count} tagged numbers in index.html`);
}
