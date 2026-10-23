#!/usr/bin/env node
// Rebuilds the embedded data files from the raw downloads. Nothing here is typed in by hand:
// every number in lod.js, oni.js and leapsec.js is read out of the three raw files.
//
//   node ideas/68-longest-day/data/extract.mjs /path/to/finals2000A.all [--excerpt]
//
// Reads finals2000A.all from the path given (it is 3.8 MB, too big to keep in the folder) and
// oni.ascii.txt and tai-utc.dat from this folder. Writes lod.js, oni.js and leapsec.js here,
// and, with --excerpt, rewrites finals2000A.excerpt.txt (verbatim lines of the raw file).
// See SOURCE.md for what each step does and why.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// ---- finals2000A.all -------------------------------------------------------------------------
// Fixed-width columns, 1-based, from readme.finals2000A:
//   8-15  MJD   | 58 UT1 flag (I = IERS observed, P = prediction) | 59-68 UT1-UTC (s)
//   80-86 LOD (ms) "NOT ALWAYS FILLED" | 87-93 error in LOD (ms)
export function parseFinals(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    if (line.length < 93) continue;
    const flag = line.slice(57, 58);
    const lod = line.slice(79, 86).trim();
    if (flag !== 'I' || lod === '') continue;
    rows.push({
      line,
      mjd: Number(line.slice(7, 15)),
      ut1: line.slice(58, 68).trim(),
      lod,
      err: line.slice(86, 93).trim(),
    });
  }
  return rows;
}

// "1.2248" -> 12248 (units of 0.0001 ms), exactly, without floating-point rounding.
export function toTenthMicro(s) {
  const m = /^(-?)(\d*)\.(\d{4})$/.exec(s);
  if (!m) throw new Error(`unexpected LOD field: "${s}"`);
  const v = Number(m[2] || '0') * 10000 + Number(m[3]);
  return m[1] ? -v : v;
}

function mjdToISO(mjd) {
  return new Date(Date.UTC(1858, 10, 17) + mjd * 86400000).toISOString().slice(0, 10);
}

function buildLod(finalsPath) {
  const buf = fs.readFileSync(finalsPath);
  const rows = parseFinals(buf.toString('latin1'));
  // Step 1: the first observed row (1973-01-02) carries LOD = 0.0000, a placeholder: the UT1-UTC
  // values on either side of it imply about 2.8 ms, and the next row reads 3.5563. Drop it.
  if (rows[0].mjd !== 41684 || rows[0].lod !== '0.0000') throw new Error('first row is not the expected placeholder');
  const kept = rows.slice(1);
  // Step 2: the series must be one row per day with no gaps.
  for (let i = 1; i < kept.length; i++) {
    if (kept[i].mjd !== kept[i - 1].mjd + 1) throw new Error(`gap at MJD ${kept[i - 1].mjd}`);
  }
  return {
    sha: sha256(buf),
    bytes: buf.length,
    firstMJD: kept[0].mjd,
    lastMJD: kept[kept.length - 1].mjd,
    ut1First: rows[0].ut1, // UT1-UTC on 1973-01-02, kept only for the drift cross-check
    lod: kept.map((r) => toTenthMicro(r.lod)),
    err: kept.map((r) => toTenthMicro(r.err)),
    rows,
  };
}

// ---- oni.ascii.txt ---------------------------------------------------------------------------
// "SEAS  YR   TOTAL   ANOM": 3-month seasons DJF..NDJ, Nino-3.4 SST (deg C) and its anomaly.
const SEASONS = ['DJF', 'JFM', 'FMA', 'MAM', 'AMJ', 'MJJ', 'JJA', 'JAS', 'ASO', 'SON', 'OND', 'NDJ'];
export function parseOni(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const p = line.trim().split(/\s+/);
    if (p.length !== 4 || !SEASONS.includes(p[0])) continue;
    out.push({ season: p[0], year: Number(p[1]), total: p[2], anom: p[3] });
  }
  return out;
}

// ---- tai-utc.dat -----------------------------------------------------------------------------
// From 1972 on, every line is a whole-second step: " 1974 JAN  1 =JD 2442048.5  TAI-UTC=  13.0 ..."
export function parseLeaps(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const m = /^\s*(\d{4})\s+([A-Z]{3})\s+(\d+)\s+=JD\s+([\d.]+)\s+TAI-UTC=\s*([\d.]+)\s*S\s*\+\s*\(MJD\s*-\s*([\d.]+)\)\s*X\s*([\d.]+)/.exec(line);
    if (!m) continue;
    const mjd = Number(m[4]) - 2400000.5;
    if (mjd < 41317) continue; // before 1972 UTC used rate offsets, not leap seconds
    out.push({ mjd, taiMinusUtc: Number(m[5]) });
  }
  return out;
}

function write(name, body) {
  const p = path.join(HERE, name);
  fs.writeFileSync(p, body);
  console.log(`wrote ${name}  ${fs.statSync(p).size} bytes  sha256 ${sha256(fs.readFileSync(p))}`);
}

function main() {
  const args = process.argv.slice(2);
  const finalsPath = args.find((a) => !a.startsWith('--'));
  if (!finalsPath) {
    console.error('usage: node extract.mjs /path/to/finals2000A.all [--excerpt]');
    process.exit(2);
  }
  const L = buildLod(finalsPath);
  console.log(`finals2000A.all: ${L.bytes} bytes, sha256 ${L.sha}`);
  console.log(`LOD days: ${L.lod.length}, MJD ${L.firstMJD}..${L.lastMJD} (${mjdToISO(L.firstMJD)}..${mjdToISO(L.lastMJD)})`);

  write(
    'lod.js',
    `// Generated by data/extract.mjs from finals2000A.all (IERS Rapid Service/Prediction Center, USNO).\n` +
      `// Source file sha256 ${L.sha}, ${L.bytes} bytes. Do not edit by hand; see SOURCE.md.\n` +
      `// lod[i] and err[i] are the Bulletin A LOD and its error for day firstMJD + i, in units of 0.0001 ms,\n` +
      `// i.e. the file's 4-decimal millisecond fields with the decimal point removed.\n` +
      `var LOD_DATA = {\n` +
      `  source: 'https://maia.usno.navy.mil/ser7/finals2000A.all',\n` +
      `  sourceSha256: '${L.sha}',\n` +
      `  firstMJD: ${L.firstMJD},\n` +
      `  firstDate: '${mjdToISO(L.firstMJD)}',\n` +
      `  lastDate: '${mjdToISO(L.lastMJD)}',\n` +
      `  n: ${L.lod.length},\n` +
      `  ut1MinusUtcBeforeFirst: ${L.ut1First},\n` +
      `  lod: '${L.lod.join(',')}',\n` +
      `  err: '${L.err.join(',')}'\n` +
      `};\n` +
      `if (typeof module !== 'undefined' && module.exports) module.exports = LOD_DATA;\n`,
  );

  const oniText = fs.readFileSync(path.join(HERE, 'oni.ascii.txt'), 'latin1');
  const oni = parseOni(oniText);
  write(
    'oni.js',
    `// Generated by data/extract.mjs from oni.ascii.txt (NOAA CPC Oceanic Nino Index). Do not edit by hand.\n` +
      `// Each entry: [year, season index 0..11 for DJF..NDJ, ANOM in deg C]. The season's centre month is index + 1.\n` +
      `var ONI_DATA = {\n` +
      `  source: 'https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt',\n` +
      `  sourceSha256: '${sha256(Buffer.from(oniText, 'latin1'))}',\n` +
      `  rows: [${oni.map((r) => `[${r.year},${SEASONS.indexOf(r.season)},${r.anom}]`).join(',')}]\n` +
      `};\n` +
      `if (typeof module !== 'undefined' && module.exports) module.exports = ONI_DATA;\n`,
  );

  const leapText = fs.readFileSync(path.join(HERE, 'tai-utc.dat'), 'latin1');
  const leaps = parseLeaps(leapText);
  write(
    'leapsec.js',
    `// Generated by data/extract.mjs from tai-utc.dat (USNO). Do not edit by hand.\n` +
      `// Each entry: [MJD at which the new TAI-UTC applies, TAI-UTC in seconds]. 1972 onward only.\n` +
      `var LEAP_DATA = {\n` +
      `  source: 'https://maia.usno.navy.mil/ser7/tai-utc.dat',\n` +
      `  sourceSha256: '${sha256(Buffer.from(leapText, 'latin1'))}',\n` +
      `  steps: [${leaps.map((r) => `[${r.mjd},${r.taiMinusUtc}]`).join(',')}]\n` +
      `};\n` +
      `if (typeof module !== 'undefined' && module.exports) module.exports = LEAP_DATA;\n`,
  );

  if (args.includes('--excerpt')) {
    // Verbatim lines: the first 12 rows, every 1 January and 1 July, all of July 2024, every day
    // the page or README names, and the last observed row.
    const named = JSON.parse(fs.readFileSync(path.join(HERE, 'named-days.json'), 'utf8')).days;
    const keep = new Set();
    L.rows.forEach((r, i) => {
      const iso = mjdToISO(r.mjd);
      if (i < 12 || /-(01|07)-01$/.test(iso) || iso.startsWith('2024-07') || named.includes(iso) || i === L.rows.length - 1) keep.add(i);
    });
    const lines = L.rows.filter((_, i) => keep.has(i)).map((r) => r.line);
    write('finals2000A.excerpt.txt', lines.join('\n') + '\n');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
