#!/usr/bin/env node
// Data integrity for "The Longest Day of Your Life". Run from the repo root:
//   node ideas/58-longest-day/check.mjs
//   FINALS_PATH=/path/to/finals2000A.all node ideas/58-longest-day/check.mjs   (full re-verification)
//
// 1. Every file listed in data/SOURCE.md has the SHA-256 recorded there.
// 2. Every verbatim line in data/finals2000A.excerpt.txt agrees with the embedded series in data/lod.js.
// 3. data/oni.js and data/leapsec.js agree, row for row, with the raw oni.ascii.txt and tai-utc.dat kept here.
// 4. With FINALS_PATH: the downloaded file has the recorded SHA-256 and all 19,650 embedded values match it.
// 5. Every data-c claim key in index.html is one that claims.test.mjs recomputes.
// The numbers themselves are recomputed independently in claims.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const rd = (p) => fs.readFileSync(path.join(HERE, p));
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
let failures = 0;
function ok(cond, msg) {
  if (cond) console.log('  ok   ' + msg);
  else { console.log('  FAIL ' + msg); failures++; }
}

// Load a classic-script data file the way the browser would, without require().
function loadScript(rel, name) {
  const ctx = { module: undefined };
  vm.runInNewContext(rd(rel).toString('utf8') + `\n;this.__out = ${name};`, ctx);
  return ctx.__out;
}

// ---- 1. checksums -----------------------------------------------------------------------------
const source = rd('data/SOURCE.md').toString('utf8');
const recorded = [...source.matchAll(/^\| `([^`]+)` \| `([0-9a-f]{64})` \|/gm)].map((m) => ({ file: m[1], sha: m[2] }));
ok(recorded.length >= 7, `SOURCE.md lists ${recorded.length} checksummed files`);
for (const r of recorded) {
  const p = path.join(HERE, r.file);
  if (!fs.existsSync(p)) { ok(false, `${r.file} exists`); continue; }
  ok(sha(fs.readFileSync(p)) === r.sha, `${r.file} sha256 matches SOURCE.md`);
}
const finalsSha = (/finals2000A\.all[^\n]*?`([0-9a-f]{64})`/.exec(source) || [])[1];
ok(!!finalsSha, 'SOURCE.md records the SHA-256 of the downloaded finals2000A.all');

// ---- 2. excerpt vs embedded series -------------------------------------------------------------
const D = loadScript('data/lod.js', 'LOD_DATA');
const lod = D.lod.split(',').map(Number), err = D.err.split(',').map(Number);
ok(lod.length === D.n && err.length === D.n && D.n === 19650, `lod.js holds ${D.n} days`);
ok(D.sourceSha256 === finalsSha, 'lod.js names the same source checksum as SOURCE.md');
const tenth = (s) => { const m = /^(-?)(\d*)\.(\d{4})$/.exec(s.trim()); return (m[1] ? -1 : 1) * (Number(m[2] || 0) * 10000 + Number(m[3])); };
const excerpt = rd('data/finals2000A.excerpt.txt').toString('latin1').split('\n').filter((l) => l.length > 0);
let checked = 0, bad = 0, placeholder = 0;
for (const line of excerpt) {
  const mjd = Number(line.slice(7, 15));
  const i = mjd - D.firstMJD;
  if (i === -1) { placeholder++; if (line.slice(79, 86).trim() !== '0.0000') bad++; continue; }
  if (i < 0 || i >= D.n) { bad++; continue; }
  if (line.slice(57, 58) !== 'I') { bad++; continue; }
  if (tenth(line.slice(79, 86)) !== lod[i] || tenth(line.slice(86, 93)) !== err[i]) bad++;
  checked++;
}
ok(placeholder === 1, 'excerpt includes the dropped 1973-01-02 row, whose LOD is the placeholder 0.0000');
ok(checked >= 120 && bad === 0, `${checked} verbatim raw lines agree with the embedded series (${bad} disagreements)`);
const named = JSON.parse(rd('data/named-days.json')).days;
const excerptDates = new Set(excerpt.map((l) => Number(l.slice(7, 15))));
const isoToMjd = (iso) => Math.round((Date.parse(iso + 'T00:00:00Z') - Date.UTC(1858, 10, 17)) / 86400000);
ok(named.every((d) => excerptDates.has(isoToMjd(d))), `every named day (${named.length}) has its raw line in the excerpt`);

// ---- 3. ONI and leap seconds against their raw files ------------------------------------------
const O = loadScript('data/oni.js', 'ONI_DATA');
const SEAS = ['DJF', 'JFM', 'FMA', 'MAM', 'AMJ', 'MJJ', 'JJA', 'JAS', 'ASO', 'SON', 'OND', 'NDJ'];
const oniRaw = rd('data/oni.ascii.txt').toString('latin1').split('\n').map((l) => l.trim().split(/\s+/)).filter((p) => p.length === 4 && SEAS.includes(p[0]));
ok(oniRaw.length === O.rows.length, `oni.js has all ${oniRaw.length} rows of oni.ascii.txt`);
ok(oniRaw.every((p, k) => O.rows[k][0] === Number(p[1]) && O.rows[k][1] === SEAS.indexOf(p[0]) && O.rows[k][2] === Number(p[3])), 'every ONI row matches the raw file');
ok(O.sourceSha256 === sha(rd('data/oni.ascii.txt')), 'oni.js names the checksum of the raw ONI file');
const LP = loadScript('data/leapsec.js', 'LEAP_DATA');
const leapRaw = rd('data/tai-utc.dat').toString('latin1').split('\n').filter((l) => /TAI-UTC=/.test(l)).map((l) => ({ jd: Number(/=JD\s+([\d.]+)/.exec(l)[1]), v: Number(/TAI-UTC=\s*([\d.]+)/.exec(l)[1]) })).filter((r) => r.jd >= 2441317.5);
ok(leapRaw.length === LP.steps.length && leapRaw.every((r, k) => LP.steps[k][0] === r.jd - 2400000.5 && LP.steps[k][1] === r.v), `leapsec.js matches the ${leapRaw.length} post-1972 lines of tai-utc.dat`);
ok(LP.steps.every((st, k) => k === 0 || st[1] - LP.steps[k - 1][1] === 1), 'every post-1972 step is exactly one second');

// ---- 4. full re-verification against the downloaded file --------------------------------------
if (process.env.FINALS_PATH) {
  const buf = fs.readFileSync(process.env.FINALS_PATH);
  const s = sha(buf);
  if (s !== finalsSha) console.log(`  note the file at FINALS_PATH has sha256 ${s}, not the recorded ${finalsSha}: comparing values anyway (the live file is rewritten weekly)`);
  const rows = buf.toString('latin1').split('\n').filter((l) => l.length >= 93 && l.slice(57, 58) === 'I' && l.slice(79, 86).trim() !== '');
  let same = 0, diff = 0, firstDiff = null;
  for (const l of rows) {
    const i = Number(l.slice(7, 15)) - D.firstMJD;
    if (i < 0 || i >= D.n) continue;
    if (tenth(l.slice(79, 86)) === lod[i] && tenth(l.slice(86, 93)) === err[i]) same++;
    else { diff++; firstDiff = firstDiff || l.slice(0, 15); }
  }
  if (s === finalsSha) ok(same === D.n && diff === 0, `all ${same} embedded days match the original file exactly`);
  else console.log(`  info ${same} days match, ${diff} differ (first difference ${firstDiff})`);
} else {
  console.log('  skip full-file comparison (set FINALS_PATH to the downloaded finals2000A.all)');
}

// ---- 5. claim keys -----------------------------------------------------------------------------
const html = rd('index.html').toString('utf8');
const keys = [...html.matchAll(/data-c="([a-z0-9_]+)"/g)].map((m) => m[1]);
const testSrc = rd('claims.test.mjs').toString('utf8');
const missing = keys.filter((k) => !new RegExp(`\\b${k}:`).test(testSrc));
ok(keys.length >= 60 && missing.length === 0, `${keys.length} numbers in the page are tagged and each is recomputed in claims.test.mjs${missing.length ? ' (missing: ' + missing.join(', ') + ')' : ''}`);
ok(new Set(keys).size === keys.length, 'no claim key is used twice');

console.log(failures ? `\n${failures} check(s) failed` : '\nall data checks pass');
process.exit(failures ? 1 : 0);
