#!/usr/bin/env node
// Checks for "The Shadow of a Feeling". Exits non-zero on any failure.
//
//  1. Every citation in index.html (a.cite[data-src]) has an entry in sources.json, and vice versa;
//     every source entry has author, year, title, venue, claim and found_via.
//  2. The embedded data (data.js) passes sanity checks: 254 unique words, every rating in [1, 9],
//     SDs in [0, 5], at least 14 raters, bins cover exactly 13,915 words, Russell's anchors at 45° steps.
//  3. Every number in the prose tagged data-claim="…" matches the value recomputed from data.js.
//  4. If the original Warriner et al. (2013) CSV is available (env WARRINER_CSV, or next to this file as
//     Ratings_Warriner_et_al.csv), every embedded row and every summary statistic is recomputed from it
//     and the file's SHA-256 is compared with the one recorded in data.js. Otherwise this step is skipped
//     and says so.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const errors = [];
const notes = [];
const fail = (m) => errors.push(m);

// ---- load data.js ----
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(DIR, 'data.js'), 'utf8'), sandbox);
const DATA = sandbox.window.SHADOW_DATA;
if (!DATA) fail('data.js did not define window.SHADOW_DATA');
const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
const sources = JSON.parse(fs.readFileSync(path.join(DIR, 'sources.json'), 'utf8'));

// ---- 1. citations ----
const cited = new Set([...html.matchAll(/data-src="([a-z0-9]+)"/g)].map((m) => m[1]));
const anchors = new Set([...html.matchAll(/id="src-([a-z0-9]+)"/g)].map((m) => m[1]));
const ids = new Set(sources.map((s) => s.id));
for (const c of cited) {
  if (!ids.has(c)) fail(`citation "${c}" in index.html has no entry in sources.json`);
  if (!anchors.has(c)) fail(`citation "${c}" has no matching <li id="src-${c}"> in the Sources section`);
}
for (const s of sources) {
  if (!cited.has(s.id)) fail(`sources.json entry "${s.id}" is never cited in index.html`);
  for (const f of ['author', 'year', 'title', 'venue', 'claim', 'found_via', 'verified']) {
    if (!s[f]) fail(`sources.json entry "${s.id}" is missing "${f}"`);
  }
  if (typeof s.year !== 'number' || s.year < 1850 || s.year > 2026) fail(`sources.json entry "${s.id}" has an odd year`);
}
for (const a of anchors) if (!ids.has(a)) fail(`Sources list item "src-${a}" has no sources.json entry`);
notes.push(`${cited.size} citations ↔ ${sources.length} sources`);

// ---- 2. data sanity ----
const LEX = Object.entries(DATA.lexicon).map(([w, r]) => ({ w, v: r[0], a: r[1], d: r[2], sv: r[3], sa: r[4], sd: r[5], nv: r[6], na: r[7], nd: r[8] }));
if (LEX.length !== 254) fail(`expected 254 lexicon words, found ${LEX.length}`);
const seen = new Set();
for (const p of LEX) {
  if (seen.has(p.w)) fail(`duplicate word ${p.w}`);
  seen.add(p.w);
  for (const k of ['v', 'a', 'd']) if (!(p[k] >= 1 && p[k] <= 9)) fail(`${p.w}.${k} = ${p[k]} out of [1, 9]`);
  for (const k of ['sv', 'sa', 'sd']) if (!(p[k] >= 0 && p[k] <= 5)) fail(`${p.w}.${k} = ${p[k]} out of [0, 5]`);
  for (const k of ['nv', 'na', 'nd']) if (!(Number.isInteger(p[k]) && p[k] >= 14)) fail(`${p.w}.${k} = ${p[k]} too few raters`);
  if (!/^[a-z]+$/.test(p.w)) fail(`word "${p.w}" is not a single lowercase word`);
}
const binSum = DATA.bins.reduce((n, b) => n + b.n, 0);
if (binSum !== DATA.stats.n_words) fail(`bins cover ${binSum} words, stats say ${DATA.stats.n_words}`);
if (DATA.stats.n_words !== 13915) fail(`n_words is ${DATA.stats.n_words}, expected 13915`);
DATA.bins.forEach((b, i) => {
  if (Math.abs(b.lo - (1 + i * 0.5)) > 1e-9 || Math.abs(b.hi - b.lo - 0.5) > 1e-9) fail(`bin ${i} has bad bounds`);
  if (b.n > 0 && !(b.meanA >= 1 && b.meanA <= 9)) fail(`bin ${i} meanA out of range`);
});
if (DATA.russell_anchors.length !== 8) fail('expected 8 Russell anchors');
DATA.russell_anchors.forEach(([name, deg], i) => { if (deg !== i * 45) fail(`anchor ${name} at ${deg}°, expected ${i * 45}°`); });
if (DATA.russell_words.length !== 28) fail(`expected 28 Russell words, found ${DATA.russell_words.length}`);
const russellPresent = DATA.russell_words.filter((w) => DATA.lexicon[w]).length;
if (russellPresent !== 26) fail(`expected 26 of Russell's words in the lexicon, found ${russellPresent}`);
for (const w of ['panic', 'anger', 'terror', 'frightened', 'surprised', 'curious', 'astonished', 'inspired', 'romance', 'triumph', 'shame', 'embarrassment', 'weak', 'overwhelmed']) {
  if (!DATA.lexicon[w]) fail(`featured word "${w}" missing from lexicon`);
}
notes.push(`${LEX.length} words, ${DATA.bins.length} bins`);

// ---- 3. prose claims ----
const BY = Object.fromEntries(LEX.map((p) => [p.w, p]));
const dist2 = (p, q) => Math.hypot(p.v - q.v, p.a - q.a);
const pairs = [];
for (let i = 0; i < LEX.length; i++) for (let j = i + 1; j < LEX.length; j++) {
  const a = LEX[i], b = LEX[j];
  if (dist2(a, b) <= 0.6 && Math.abs(a.d - b.d) >= 2.0) pairs.push([a, b]);
}
const featured = [['panic', 'anger'], ['terror', 'anger'], ['frightened', 'anger'], ['surprised', 'curious'], ['astonished', 'inspired'], ['romance', 'triumph'], ['shame', 'embarrassment'], ['weak', 'overwhelmed']];
for (const [x, y] of featured) {
  const ok = pairs.some(([a, b]) => (a.w === x && b.w === y) || (a.w === y && b.w === x));
  if (!ok) fail(`featured pair ${x}/${y} does not meet the thresholds (plane gap ≤ 0.6, dominance gap ≥ 2.0)`);
}
const bin = (lo) => DATA.bins.find((b) => Math.abs(b.lo - lo) < 1e-9);
// The word families named in section 8 of the page, verbatim.
const FEAR = ['afraid', 'scared', 'terrified', 'frightened', 'fearful', 'fear', 'terror', 'panic', 'petrified', 'dread', 'fright', 'horror'];
const ANGER = ['angry', 'furious', 'irate', 'enraged', 'hostile', 'outraged', 'indignant', 'livid', 'anger', 'rage', 'fury', 'wrath', 'hostility'];
for (const w of [...FEAR, ...ANGER]) if (!BY[w]) fail(`family word "${w}" missing from lexicon`);
const mean3 = (ws, k) => ws.reduce((s, w) => s + BY[w][k], 0) / ws.length;
const famText = html.match(/Twelve fear words in the lexicon \(([^)]*)\) and thirteen anger words \(([^)]*)\)/);
if (!famText) fail('could not find the fear/anger family lists in index.html');
else {
  const listed = (t) => t.split(',').map((x) => x.trim());
  if (listed(famText[1]).join() !== FEAR.join()) fail('fear family on the page differs from check.mjs');
  if (listed(famText[2]).join() !== ANGER.join()) fail('anger family on the page differs from check.mjs');
}
const expected = {
  n_words: DATA.stats.n_words,
  n_words_b: DATA.stats.n_words,
  median_n_v: DATA.stats.median_n.v,
  lex_count: LEX.length,
  lex_count_b: LEX.length,
  lex_count_c: LEX.length,
  russell_present: russellPresent,
  binA_mid: bin(5.0).meanA,
  binA_lo: bin(1.5).meanA,
  binA_hi: bin(8.0).meanA,
  panic_v: BY.panic.v, anger_v: BY.anger.v, panic_a: BY.panic.a, anger_a: BY.anger.a, panic_d: BY.panic.d, anger_d: BY.anger.d,
  panic_anger_dd: Math.abs(BY.panic.d - BY.anger.d),
  shame_d: BY.shame.d, emb_d: BY.embarrassment.d,
  shame_emb_dd: Math.abs(BY.shame.d - BY.embarrassment.d),
  median_sd_v: DATA.stats.median_sd.v, median_sd_a: DATA.stats.median_sd.a, median_sd_d: DATA.stats.median_sd.d,
  r_vd: DATA.stats.r_vd, r_va: DATA.stats.r_va,
  pair_count: pairs.length,
  fam_fear_v: mean3(FEAR, 'v'), fam_fear_a: mean3(FEAR, 'a'), fam_fear_d: mean3(FEAR, 'd'),
  fam_anger_v: mean3(ANGER, 'v'), fam_anger_a: mean3(ANGER, 'a'), fam_anger_d: mean3(ANGER, 'd'),
  fam_dd: mean3(ANGER, 'd') - mean3(FEAR, 'd'),
};
const claims = [...html.matchAll(/data-claim="([A-Za-z_]+)"[^>]*>([^<]*)</g)];
const claimAttrs = [...html.matchAll(/data-claim="[^"]*"/g)].length;
if (claimAttrs !== claims.length) fail(`${claimAttrs} data-claim attributes in index.html but only ${claims.length} parsed`);
if (!claims.length) fail('no data-claim spans found in index.html');
const seenClaims = new Set();
for (const [, key, raw] of claims) {
  seenClaims.add(key);
  if (!(key in expected)) { fail(`unknown data-claim "${key}"`); continue; }
  const text = raw.replace(/[−–]/g, '-').replace(/,/g, '').trim();
  const shown = Number(text);
  if (Number.isNaN(shown)) { fail(`data-claim "${key}" shows non-numeric text "${raw}"`); continue; }
  const decimals = (text.split('.')[1] || '').length;
  const tol = decimals ? 0.5 * Math.pow(10, -decimals) + 1e-9 : 0.5;
  const exp = expected[key];
  if (Math.abs(shown - exp) > tol) fail(`data-claim "${key}": page says ${raw}, data says ${exp}`);
}
for (const k of Object.keys(expected)) if (!seenClaims.has(k)) notes.push(`(claim key "${k}" unused)`);
const texts = new Map();
for (const [, key, raw] of claims) {
  const t = raw.trim();
  if (texts.has(key) && texts.get(key) !== t) fail(`data-claim "${key}" is used with two different texts: "${texts.get(key)}" and "${t}"`);
  texts.set(key, t);
}
notes.push(`${claims.length} prose numbers checked`);

// ---- 4. optional cross-check against the original CSV ----
const csvPath = process.env.WARRINER_CSV || path.join(DIR, 'Ratings_Warriner_et_al.csv');
if (fs.existsSync(csvPath)) {
  const raw = fs.readFileSync(csvPath);
  const sha = crypto.createHash('sha256').update(raw).digest('hex');
  if (sha !== DATA.source.sha256) fail(`CSV sha256 ${sha} differs from data.js record ${DATA.source.sha256}`);
  const lines = raw.toString('utf8').split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(',');
  const col = (name) => header.indexOf(name);
  const rows = new Map();
  for (const line of lines.slice(1)) {
    const f = line.split(',');
    rows.set(f[col('Word')], {
      v: +f[col('V.Mean.Sum')], a: +f[col('A.Mean.Sum')], d: +f[col('D.Mean.Sum')],
      sv: +f[col('V.SD.Sum')], sa: +f[col('A.SD.Sum')], sd: +f[col('D.SD.Sum')],
      nv: +f[col('V.Rat.Sum')], na: +f[col('A.Rat.Sum')], nd: +f[col('D.Rat.Sum')],
    });
  }
  if (rows.size !== 13915) fail(`CSV has ${rows.size} rows, expected 13915`);
  for (const p of LEX) {
    const r = rows.get(p.w);
    if (!r) { fail(`${p.w} not in CSV`); continue; }
    for (const k of ['v', 'a', 'd', 'sv', 'sa', 'sd', 'nv', 'na', 'nd']) if (Math.abs(r[k] - p[k]) > 1e-9) fail(`${p.w}.${k}: data.js ${p[k]} vs CSV ${r[k]}`);
  }
  const all = [...rows.values()];
  const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const corr = (xs, ys) => {
    const mx = mean(xs), my = mean(ys);
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
    return sxy / Math.sqrt(sxx * syy);
  };
  const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const near = (x, y, tol, what) => { if (Math.abs(x - y) > tol) fail(`${what}: data.js ${y} vs CSV ${x}`); };
  near(corr(all.map((r) => r.v), all.map((r) => r.d)), DATA.stats.r_vd, 0.0006, 'r_vd');
  near(corr(all.map((r) => r.v), all.map((r) => r.a)), DATA.stats.r_va, 0.0006, 'r_va');
  near(corr(all.map((r) => r.a), all.map((r) => r.d)), DATA.stats.r_ad, 0.0006, 'r_ad');
  near(median(all.map((r) => r.sv)), DATA.stats.median_sd.v, 1e-9, 'median_sd_v');
  near(median(all.map((r) => r.sa)), DATA.stats.median_sd.a, 1e-9, 'median_sd_a');
  near(median(all.map((r) => r.sd)), DATA.stats.median_sd.d, 1e-9, 'median_sd_d');
  near(median(all.map((r) => r.nv)), DATA.stats.median_n.v, 1e-9, 'median_n_v');
  for (const b of DATA.bins) {
    const inBin = all.filter((r) => (r.v >= b.lo && r.v < b.hi) || (b.hi === 9 && r.v === 9));
    if (inBin.length !== b.n) fail(`bin ${b.lo}: CSV has ${inBin.length} words, data.js says ${b.n}`);
    if (inBin.length) near(mean(inBin.map((r) => r.a)), b.meanA, 0.0006, `bin ${b.lo} meanA`);
  }
  notes.push(`cross-checked against CSV (${rows.size} rows, sha256 ok)`);
} else {
  notes.push('CSV not present; cross-check skipped (set WARRINER_CSV to run it)');
}

// ---- report ----
console.log(`${errors.length ? 'FAIL' : 'ok  '} 26-shadow-of-a-feeling check: ${notes.join('; ')}`);
for (const e of errors) console.log(`   error: ${e}`);
process.exit(errors.length ? 1 : 0);
