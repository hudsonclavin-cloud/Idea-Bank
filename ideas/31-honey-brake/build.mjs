#!/usr/bin/env node
// Inlines model.js into index.html (between the MODEL markers) and fills every tagged number:
//   <span data-v="vT">1.2</span>                 -> HoneyBrake.quoted().vT
//   <span data-v="B.massTotal">100</span>         -> HoneyBrake.BASE.massTotal, same decimals as the placeholder
//   <span data-v="B.ringOD" data-scale="1000">380</span>  -> value x scale
//   <span data-v="K.field" data-scale="100">15</span>     -> risk probability x 100
//   namespaces: B = BASE, P = PIPE, K = risks, C = PHYS, X = EXP (experiment), R = RAMP
// Usage: node build.mjs      (rewrites index.html in place; check.mjs fails if the file is stale)
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

export const DIR = path.dirname(fileURLToPath(import.meta.url));
const BEGIN = '/*MODEL:BEGIN*/';
const END = '/*MODEL:END*/';

export function loadModel(code) {
  return vm.runInNewContext(`${code}\n;HoneyBrake;`, {});
}

export function namespaces(M) {
  const risks = {};
  for (const r of M.RISKS) risks[r.id] = r.p;
  return { B: M.BASE, P: M.PIPE, K: risks, C: M.PHYS, X: M.EXP, R: M.RAMP };
}

export function resolve(M, q, key, scale, placeholder) {
  if (!key.includes('.')) {
    if (!(key in q)) throw new Error(`unknown quoted key: ${key}`);
    return q[key];
  }
  const [ns, k] = key.split('.');
  const table = namespaces(M)[ns];
  if (!table || !(k in table)) throw new Error(`unknown constant: ${key}`);
  const v = table[k] * scale;
  const dec = (placeholder.split('.')[1] || '').length;
  return v.toFixed(dec);
}

const TAG = /(<(span|tspan|td|b|strong|em|text)\b([^>]*?)\bdata-v="([^"]+)"([^>]*)>)([^<]*)(<\/\2>)/g;

export function render(html, modelCode) {
  const i = html.indexOf(BEGIN);
  const j = html.indexOf(END);
  if (i < 0 || j < i) throw new Error('model markers missing in index.html');
  html = `${html.slice(0, i + BEGIN.length)}\n${modelCode.trim()}\n${html.slice(j)}`;
  const M = loadModel(modelCode);
  const q = M.quoted();
  let count = 0;
  html = html.replace(TAG, (m, open, tag, pre, key, post, text, close) => {
    const sm = /data-scale="([^"]+)"/.exec(pre + post);
    const scale = sm ? Number(sm[1]) : 1;
    count++;
    return open + resolve(M, q, key, scale, text) + close;
  });
  return { html, count };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = path.join(DIR, 'index.html');
  const model = fs.readFileSync(path.join(DIR, 'model.js'), 'utf8');
  const { html, count } = render(fs.readFileSync(file, 'utf8'), model);
  fs.writeFileSync(file, html);
  console.log(`build: inlined model.js and filled ${count} tagged numbers in index.html`);
}
