// Pins each fix made after the independent review (see the README's "Revision note").
// Each test recomputes the quantity in its own code, independent of check.mjs, and asserts that the
// page or README states it and no longer states what the review showed to be wrong.
// Run: node --test ideas/26-shadow-of-a-feeling/review.test.mjs  (tools/check.mjs runs it too)
// With WARRINER_CSV=/path/to/Ratings_Warriner_et_al.csv the whole-corpus statistics are also recomputed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
const html = read('index.html');
const readme = read('README.md');
const app = read('app.js');
const sources = JSON.parse(read('sources.json'));
const sb = { window: {} };
vm.runInNewContext(read('data.js'), sb);
const DATA = sb.window.SHADOW_DATA;
const LEX = Object.entries(DATA.lexicon).map(([w, r]) => ({ w, v: r[0], a: r[1], d: r[2], sv: r[3], sa: r[4], sd: r[5], nv: r[6], na: r[7], nd: r[8] }));
const BY = Object.fromEntries(LEX.map((p) => [p.w, p]));
const text = html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
const section = (id) => {
  const m = html.match(new RegExp(`<section id="${id}">([\\s\\S]*?)</section>`));
  assert.ok(m, `section #${id} missing`);
  return m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
};
const claim = (key) => {
  const m = html.match(new RegExp(`data-claim="${key}"[^>]*>([^<]*)<`));
  assert.ok(m, `data-claim "${key}" missing from index.html`);
  return Number(m[1].replace(/[−–]/g, '-').replace(/,/g, ''));
};
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const sampleVar = (xs) => { const m = mean(xs); return xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1); };
const pearson = (xs, ys) => {
  const mx = mean(xs), my = mean(ys);
  let a = 0, b = 0, c = 0;
  xs.forEach((x, i) => { a += (x - mx) * (ys[i] - my); b += (x - mx) ** 2; c += (ys[i] - my) ** 2; });
  return a / Math.sqrt(b * c);
};
const csvPath = process.env.WARRINER_CSV || path.join(DIR, 'Ratings_Warriner_et_al.csv');
const CSV = fs.existsSync(csvPath) ? (() => {
  const lines = fs.readFileSync(csvPath, 'utf8').split(/\r?\n/).filter(Boolean);
  const h = lines[0].split(',');
  const col = (n) => h.indexOf(n);
  return lines.slice(1).map((l) => {
    const f = l.split(',');
    const o = {};
    for (const k of ['V', 'A', 'D']) { o[k] = +f[col(`${k}.Mean.Sum`)]; o['s' + k] = +f[col(`${k}.SD.Sum`)]; o['n' + k] = +f[col(`${k}.Rat.Sum`)]; }
    return o;
  });
})() : null;
const noCsv = CSV ? false : 'original CSV not present (set WARRINER_CSV)';

test('finding 1: arousal, not dominance, is the least reliable scale, and the page says so', () => {
  const rel = DATA.stats.reliability;
  assert.ok(rel.a < rel.d && rel.d < rel.v, `stored reliabilities out of order: ${JSON.stringify(rel)}`);
  assert.equal(claim('rel_a'), 0.69);
  assert.equal(claim('rel_d'), 0.76);
  assert.equal(claim('rel_v'), 0.91);
  assert.match(section('pairs'), /least agreed-on scale is arousal/);
  assert.doesNotMatch(section('debate'), /dominance is the least agreed-on/);
});

test('finding 1 (CSV): reliabilities recomputed from the original file', { skip: noCsv }, () => {
  for (const k of ['V', 'A', 'D']) {
    const r = 1 - mean(CSV.map((w) => w['s' + k] ** 2 / w['n' + k])) / sampleVar(CSV.map((w) => w[k]));
    assert.ok(Math.abs(r - DATA.stats.reliability[k.toLowerCase()]) < 0.001, `${k}: ${r}`);
  }
});

test('finding 2: the non-valence half of dominance is about half rating error, and the page says "not all noise"', () => {
  const share = DATA.stats.d_resid_error_share;
  assert.ok(share > 0.45 && share < 0.55, `share ${share}`);
  assert.ok(Math.abs(claim('d_resid_err_pct') - 100 * share) <= 0.5);
  const deb = section('debate');
  assert.doesNotMatch(deb, /does not predict is not noise/);
  assert.match(deb, /does not predict is not all noise/);
  // The emotion-word numbers the column now gives.
  const lexR = pearson(LEX.map((p) => p.v), LEX.map((p) => p.d));
  assert.ok(lexR ** 2 > 0.75, 'column 1 says more than three-quarters among emotion words');
  assert.equal(claim('lex_r_vd'), Math.round(lexR * 100) / 100);
  const neg = LEX.filter((p) => p.v < 4);
  assert.equal(claim('neg_n'), neg.length);
  assert.equal(claim('neg_r_vd'), Math.round(pearson(neg.map((p) => p.v), neg.map((p) => p.d)) * 100) / 100);
});

test('finding 2 (CSV): residual error share recomputed from the original file', { skip: noCsv }, () => {
  const r = pearson(CSV.map((w) => w.V), CSV.map((w) => w.D));
  const share = mean(CSV.map((w) => w.sD ** 2 / w.nD)) / (sampleVar(CSV.map((w) => w.D)) * (1 - r * r));
  assert.ok(Math.abs(share - DATA.stats.d_resid_error_share) < 0.0005, `share ${share}`);
});

test('finding 2: a noise-only null gives far fewer qualifying pairs than the 64 found (own RNG)', () => {
  // OLS of D on V and A over the lexicon, by solving the 3x3 normal equations directly.
  const X = LEX.map((p) => [1, p.v, p.a]);
  const A = [0, 1, 2].map((i) => [0, 1, 2].map((j) => X.reduce((s, x) => s + x[i] * x[j], 0)));
  const y = [0, 1, 2].map((i) => X.reduce((s, x, k) => s + x[i] * LEX[k].d, 0));
  const M = A.map((row, i) => [...row, y[i]]);
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k]; }
  const b = M.map((row, i) => row[3] / row[i]);
  let s = 88172645463325252n; // xorshift64
  const rnd = () => { s ^= (s << 13n) & 0xffffffffffffffffn; s ^= s >> 7n; s ^= (s << 17n) & 0xffffffffffffffffn; return Number(s >> 11n) / 2 ** 53; };
  const gauss = () => { let u = 0; while (u === 0) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
  const near = [];
  for (let i = 0; i < LEX.length; i++) for (let j = i + 1; j < LEX.length; j++) if (Math.hypot(LEX[i].v - LEX[j].v, LEX[i].a - LEX[j].a) <= 0.6) near.push([i, j]);
  const observed = near.filter(([i, j]) => Math.abs(LEX[i].d - LEX[j].d) >= 2).length;
  assert.equal(observed, 64);
  const runs = 1000;
  let total = 0;
  for (let r = 0; r < runs; r++) {
    const d = LEX.map((p) => b[0] + b[1] * p.v + b[2] * p.a + gauss() * p.sd / Math.sqrt(p.nd));
    for (const [i, j] of near) if (Math.abs(d[i] - d[j]) >= 2) total++;
  }
  const nullMean = total / runs;
  assert.ok(nullMean > 6 && nullMean < 11, `null mean ${nullMean}`);
  assert.ok(Math.abs(claim('null_pairs') - nullMean) < 1, `page says ${claim('null_pairs')}, this run ${nullMean}`);
});

test('finding 3: rating spread does not separate the noise pairs from the featured ones, and the page says so', () => {
  const z = (x, y) => Math.abs(BY[x].d - BY[y].d) / Math.hypot(BY[x].sd / Math.sqrt(BY[x].nd), BY[y].sd / Math.sqrt(BY[y].nd));
  const noise = [z('shame', 'embarrassment'), z('weak', 'overwhelmed')];
  const featured = [['panic', 'anger'], ['terror', 'anger'], ['frightened', 'anger'], ['surprised', 'curious'], ['astonished', 'inspired'], ['romance', 'triumph']].map(([x, y]) => z(x, y));
  assert.ok(Math.max(...noise) > Math.min(...featured), 'a noise pair is firmer than the weakest featured pair');
  assert.ok(Math.abs(claim('z_shame_emb') - noise[0]) < 0.05);
  assert.ok(Math.abs(claim('z_weak_over') - noise[1]) < 0.05);
  assert.ok(Math.abs(claim('z_terror_anger') - z('terror', 'anger')) < 0.05);
  assert.ok(Math.abs(claim('z_fright_anger') - z('frightened', 'anger')) < 0.05);
  const pairs = section('pairs');
  assert.doesNotMatch(pairs, /near-synonyms/);
  assert.doesNotMatch(pairs, /says more about twenty strangers/);
  assert.match(pairs, /not because they are statistically firmer/);
  assert.doesNotMatch(pairs, /says whether you are the thing being acted on/);
  assert.doesNotMatch(readme, /with the rating-spread numbers that explain them/);
});

test('finding 4: Kuppens et al. described as lab-stimulus, momentary and remembered reports', () => {
  assert.doesNotMatch(text, /eight datasets of moment-to-moment self-reports/);
  assert.match(section('the-v'), /laboratory stimuli/);
  const k = sources.find((s) => s.id === 'kuppens2013');
  assert.match(k.claim, /laboratory stimuli/);
  assert.doesNotMatch(k.claim, /datasets of momentary self-report/);
  assert.doesNotMatch(readme, /what momentary self-reports show/);
});

test('finding 5: Osgood is not placed before every emotion circle (Schlosberg 1952/1954 came first)', () => {
  assert.doesNotMatch(text, /long before anyone drew an emotion circle/);
  assert.match(section('debate'), /decades before Russell drew his circle/);
});

test('finding 6: Cowen and Keltner argue for many dimensions, and their reply separates three questions', () => {
  const deb = section('debate');
  assert.doesNotMatch(deb, /points are the wrong idea/);
  assert.doesNotMatch(deb, /when it was not meant as either/);
  assert.match(deb, /two or three axes are too few/);
  const ck = sources.find((s) => s.id === 'cowenkeltner2018');
  assert.match(ck.claim, /dimensionality/);
  assert.equal(ck.doi, '10.1016/j.tics.2018.02.003');
});

test('finding 7: Watson and Tellegen get their 1999 answer; Russell & Carroll 1999 is not called a reply', () => {
  const rot = html.match(/<section id="rotate">([\s\S]*?)<\/section>/)[1];
  assert.match(rot, /data-src="watsontellegen1999"/);
  assert.match(rot, /data-src="watson1999"/);
  assert.doesNotMatch(rot, /Russell and Carroll replied/);
  assert.match(section('rotate'), /positive and negative activation/);
  for (const id of ['watsontellegen1999', 'watson1999']) assert.ok(sources.find((s) => s.id === id), `${id} missing from sources.json`);
});

test('finding 8: the V is drawn on the full 1-9 scale with within-band spread, and called shallow', () => {
  assert.match(app, /const V_FIG_A_RANGE = \[1, 9\];/);
  assert.doesNotMatch(app, /6\.2 - 3\.0/);
  for (const b of DATA.bins) if (b.n > 1) assert.ok(b.sdA > 0.4 && b.sdA < 1.2, `bin ${b.lo} sdA ${b.sdA}`);
  assert.equal(claim('r2_quad_pct'), Math.round(100 * DATA.stats.r2_quad_va));
  assert.match(section('the-v'), /shallow V/);
});

test('finding 8 (CSV): quadratic R² of arousal on valence and band SDs from the original file', { skip: noCsv }, () => {
  // Solve the 3x3 normal equations for A ~ 1 + V + V².
  const rows = CSV.map((w) => [1, w.V, w.V * w.V]);
  const M = [0, 1, 2].map((i) => [...[0, 1, 2].map((j) => rows.reduce((s, x) => s + x[i] * x[j], 0)), rows.reduce((s, x, k) => s + x[i] * CSV[k].A, 0)]);
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k]; }
  const b = M.map((row, i) => row[3] / row[i]);
  const ma = mean(CSV.map((w) => w.A));
  let ssr = 0, sst = 0;
  for (const w of CSV) { ssr += (w.A - (b[0] + b[1] * w.V + b[2] * w.V * w.V)) ** 2; sst += (w.A - ma) ** 2; }
  assert.ok(Math.abs(1 - ssr / sst - DATA.stats.r2_quad_va) < 0.001);
  for (const bin of DATA.bins.filter((x) => x.n > 1)) {
    const a = CSV.filter((w) => (w.V >= bin.lo && w.V < bin.hi) || (bin.hi === 9 && w.V === 9)).map((w) => w.A);
    assert.ok(Math.abs(Math.sqrt(sampleVar(a)) - bin.sdA) < 0.001, `bin ${bin.lo}`);
  }
});

test('finding 9: the licence URI and the original source are linked', () => {
  const uri = 'https://creativecommons.org/licenses/by-nc-nd/3.0/';
  assert.match(html, new RegExp(`<footer>[\\s\\S]*href="${uri}"[\\s\\S]*</footer>`));
  assert.match(html, /<footer>[\s\S]*href="http:\/\/crr\.ugent\.be\/archives\/1003"[\s\S]*<\/footer>/);
  assert.ok(DATA.source.license.includes(uri));
  assert.equal(DATA.source.license_url, uri);
});

test('finding 10: in the flat view only the stems vanish, not the pair lines', () => {
  assert.doesNotMatch(text, /In the flat view the lines have no length/);
  assert.match(section('tilt'), /the stems have no length/);
});

test('finding 11: README calls Russell\'s order rough, with the inversion count recomputed', () => {
  // Russell's (1980) circular sequence of his 28 adjectives, as given by the independent reviewer.
  const seq = ['happy', 'delighted', 'excited', 'astonished', 'aroused', 'tense', 'alarmed', 'angry', 'afraid', 'annoyed', 'distressed', 'frustrated', 'miserable', 'sad', 'gloomy', 'depressed', 'bored', 'droopy', 'tired', 'sleepy', 'calm', 'relaxed', 'satisfied', 'at ease', 'content', 'serene', 'glad', 'pleased'].filter((w) => BY[w]);
  assert.equal(seq.length, 26);
  const ang = seq.map((w) => ((Math.atan2(BY[w].a - 5, BY[w].v - 5) * 180) / Math.PI + 360) % 360);
  let inv = 0, tot = 0;
  for (let i = 0; i < ang.length; i++) for (let j = i + 1; j < ang.length; j++) { tot++; if (ang[i] > ang[j]) inv++; }
  assert.equal(tot, 325);
  assert.match(readme, new RegExp(`${inv} of the ${tot} pairs`));
  assert.doesNotMatch(readme, /They go round the circle in his order/);
  assert.doesNotMatch(readme, /\[Certain\] The 26 of Russell's adjectives/);
});

test('finding 12: README counts the Cowen and Keltner labels present correctly', () => {
  const present = DATA.cowen_labels.filter((w) => BY[w]).length;
  assert.equal(present, 21);
  assert.equal(DATA.cowen_labels.length - present, DATA.cowen_missing.length);
  assert.match(readme, new RegExp(`27 category labels \\(${present} present`));
});

test('unchanged: the fear/anger family gap the README quotes (Welch t)', () => {
  const FEAR = ['afraid', 'scared', 'terrified', 'frightened', 'fearful', 'fear', 'terror', 'panic', 'petrified', 'dread', 'fright', 'horror'];
  const ANGER = ['angry', 'furious', 'irate', 'enraged', 'hostile', 'outraged', 'indignant', 'livid', 'anger', 'rage', 'fury', 'wrath', 'hostility'];
  const f = FEAR.map((w) => BY[w].d), a = ANGER.map((w) => BY[w].d);
  const t = (mean(a) - mean(f)) / Math.sqrt(sampleVar(f) / f.length + sampleVar(a) / a.length);
  assert.match(readme, new RegExp(`Welch t ≈ ${t.toFixed(1).replace('.', '\\.')}`));
});
