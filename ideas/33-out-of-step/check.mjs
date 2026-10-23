#!/usr/bin/env node
// Citation integrity check for "Out of Step".
//
// Asserts that every numbered citation in index.html points at a reference entry that
// exists, that every reference entry has a matching record in sources.json (and vice
// versa), that numbering is 1..n with no gaps, that every source is actually cited in
// the body text, that every sources.json record carries author/year/venue/claim, and
// that the author surname and year printed in the reference list agree with the record.
// Exits non-zero on any failure. Paths resolve from this file, so it runs from any cwd.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8');
const sources = JSON.parse(fs.readFileSync(path.join(HERE, 'sources.json'), 'utf8')).sources;

const problems = [];
const fail = (m) => problems.push(m);

// --- citations in the text: <a class="cite" href="#ref-N">N</a>
const citeRe = /<a class="cite" href="#ref-(\d+)">(\d+)<\/a>/g;
const cited = new Map(); // id -> count
for (const m of html.matchAll(citeRe)) {
  const target = Number(m[1]);
  const shown = Number(m[2]);
  if (target !== shown) fail(`citation link to #ref-${target} displays the number ${shown}`);
  cited.set(target, (cited.get(target) || 0) + 1);
}
if (!cited.size) fail('no citations found in index.html');

// --- reference entries: <li id="ref-N">…</li>
const refRe = /<li id="ref-(\d+)">([\s\S]*?)<\/li>/g;
const refs = new Map(); // id -> inner html
for (const m of html.matchAll(refRe)) {
  const id = Number(m[1]);
  if (refs.has(id)) fail(`reference [${id}] appears twice in the list`);
  refs.set(id, m[2]);
}
if (!refs.size) fail('no reference list entries found in index.html');

// --- the reference list is ordered 1..n with no gaps, in document order
const refOrder = [...html.matchAll(/<li id="ref-(\d+)">/g)].map((m) => Number(m[1]));
refOrder.forEach((id, i) => {
  if (id !== i + 1) fail(`reference list out of order or gapped at position ${i + 1}: found [${id}]`);
});

// --- sources.json ids are 1..n with no gaps and no duplicates
const srcIds = sources.map((s) => s.id);
const sortedSrc = [...srcIds].sort((a, b) => a - b);
sortedSrc.forEach((id, i) => {
  if (id !== i + 1) fail(`sources.json ids are not contiguous from 1: found ${id} at sorted position ${i + 1}`);
});

// --- every citation points at a real reference, every reference has a source, every source is cited and listed
for (const id of cited.keys()) if (!refs.has(id)) fail(`text cites [${id}] but the reference list has no entry ref-${id}`);
for (const id of refs.keys()) if (!srcIds.includes(id)) fail(`reference [${id}] has no record in sources.json`);
for (const id of srcIds) {
  if (!refs.has(id)) fail(`sources.json record ${id} has no reference list entry`);
  if (!cited.has(id)) fail(`sources.json record ${id} is never cited in the text`);
}

// --- required fields on every record
const REQUIRED = ['author', 'year', 'venue', 'claim', 'title', 'seen_in'];
for (const s of sources) {
  for (const f of REQUIRED) {
    const v = s[f];
    const empty = v == null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length);
    if (empty) fail(`sources.json record ${s.id} is missing "${f}"`);
  }
  if (Array.isArray(s.seen_in)) {
    s.seen_in.forEach((e, i) => {
      if (!e.query || !e.where || !e.snippet) fail(`sources.json record ${s.id} seen_in[${i}] needs query, where and snippet`);
    });
  }
}

// --- printed reference agrees with the record: first author's surname and the year
const strip = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
for (const s of sources) {
  const printed = strip(refs.get(s.id) || '');
  if (!printed) continue;
  const surname = s.author.split(/,|\band\b|\(/)[0].trim().split(/\s+/).pop();
  const year = (String(s.year).match(/\d{4}/) || [])[0];
  if (surname && !printed.includes(surname)) fail(`reference [${s.id}] does not mention the first author "${surname}" from sources.json`);
  if (year && !printed.includes(year)) fail(`reference [${s.id}] does not show the year ${year} from sources.json`);
  if (!/<span class="found">[^<]{20,}<\/span>/.test(refs.get(s.id))) fail(`reference [${s.id}] has no "Found:" line saying what the source found`);
}

// --- the page keeps its promises to the house rules
if (!/<meta name="viewport" content="width=device-width, initial-scale=1">/.test(html)) fail('missing viewport meta');
if (/<script[^>]+src=|<link[^>]+href=|url\(\s*["']?https?:/i.test(html)) fail('index.html references an external resource');
if (!/prefers-color-scheme: dark/.test(html)) fail('no dark colour scheme');

const n = sources.length;
if (problems.length) {
  console.error(`check.mjs: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`check.mjs: ok — ${n} sources, ${refs.size} references, ${[...cited.values()].reduce((a, b) => a + b, 0)} in-text citations, numbering 1..${n} intact`);
