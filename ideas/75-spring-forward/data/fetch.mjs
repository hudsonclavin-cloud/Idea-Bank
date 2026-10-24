#!/usr/bin/env node
// Rebuilds data/rivers.js from the USGS Water Data OGC API (api.waterdata.usgs.gov), the
// current home of the National Water Information System's instantaneous values.
//
//   node ideas/75-spring-forward/data/fetch.mjs [--cache DIR] [--screen] [--full]
//
// Downloads instantaneous values (every reading as published, in UTC) around every clock
// change and reduces them with the same functions the page uses (rivertime.js): for the first
// method each day's 24-hour wave (amplitude and crest time); for the second, the median day of
// the two weeks either side of every centre; and, for the pictures, every day around each Lees
// Ferry change. It writes the compact copy the page reads (data/rivers.js). Raw
// responses are cached in DIR (default: a folder in the OS temp directory) and listed, with
// the first 16 hex digits of their SHA-256, in data/manifest.txt. --screen prints only the
// screening numbers (amplitude and coverage) and writes nothing. --full also keeps the first
// method's placebo windows (about 60 KB more).
//
// Needs network access and Node 18+. Nothing here runs when the page is opened.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const RT = require('../rivertime.js');

export const SITES = [
  {
    key: 'lees',
    id: '09380000',
    param: '00060',
    name: 'Colorado River at Lees Ferry, Arizona',
    short: 'Colorado at Lees Ferry',
    offset: -7,
    zone: 'MST',
    dst: false,
    role: 'The question. 15 miles below Glen Canyon Dam, in a state that does not change its clocks.',
    law: true,
  },
  {
    key: 'greendale',
    id: '09234500',
    param: '00060',
    name: 'Green River near Greendale, Utah',
    short: 'Green below Flaming Gorge',
    offset: -7,
    zone: 'MST',
    dst: true,
    role: "Just below Flaming Gorge Dam: Glen Canyon's sister dam in the same federal power system, but in Utah, which changes its clocks.",
    law: true,
    stage2Only: true,
  },
  {
    key: 'salt',
    id: '09502000',
    param: '00060',
    name: 'Salt River below Stewart Mountain Dam, Arizona',
    short: 'Salt below Stewart Mountain',
    offset: -7,
    zone: 'MST',
    dst: false,
    role: 'An Arizona dam whose water and power stay in Arizona.',
  },
  {
    key: 'buford',
    id: '02334430',
    param: '00060',
    name: 'Chattahoochee River at Buford Dam, Georgia',
    short: 'Chattahoochee at Buford Dam',
    offset: -5,
    zone: 'EST',
    dst: true,
    role: 'A hydropower dam in a state that changes its clocks.',
    law: true,
  },
  {
    key: 'trinity',
    id: '08057410',
    param: '00060',
    name: 'Trinity River below Dallas, Texas',
    short: 'Trinity below Dallas',
    offset: -6,
    zone: 'CST',
    dst: true,
    role: "Mostly Dallas's treated wastewater in dry weather, in a state that changes its clocks.",
  },
  {
    key: 'santacruz',
    id: '09486500',
    param: '00060',
    name: 'Santa Cruz River at Cortaro, Arizona',
    short: 'Santa Cruz at Cortaro',
    offset: -7,
    zone: 'MST',
    dst: false,
    role: "Mostly Tucson's treated wastewater, in a state that does not change its clocks.",
  },
  {
    key: 'delaware',
    id: '01463500',
    param: '00010',
    name: 'Delaware River at Trenton, New Jersey (water temperature)',
    short: 'Delaware at Trenton (temperature)',
    offset: -5,
    zone: 'EST',
    dst: true,
    role: 'Warmed by the Sun every afternoon, in a state that changes its clocks.',
  },
];

export const YEARS = Array.from({ length: 18 }, (_, i) => 2008 + i); // 2008..2025
export const OLD_YEARS = Array.from({ length: 17 }, (_, i) => 1990 + i); // 1990..2006
const HALF = 14;
const REACH = 35 + HALF; // placebo offset plus half-window
const MARGIN = 2; // extra days fetched each side, for the moving average
const CONCURRENCY = 2;

const TZ = { UTC: 0, GMT: 0, EST: -5, EDT: -4, CST: -6, CDT: -5, MST: -7, MDT: -6, PST: -8, PDT: -7 };

/** Parse a USGS RDB instantaneous-values response into [utcMillis, value][]. */
export function parseRdb(text, param) {
  const lines = text.split('\n');
  let header = null;
  const rows = [];
  for (const line of lines) {
    if (!line || line.startsWith('#')) continue;
    const f = line.split('\t');
    if (!header) {
      header = f;
      continue;
    }
    if (/^\d+s$/.test(f[0])) continue; // the column-format line
    rows.push(f);
  }
  if (!header) return [];
  // Value columns for this parameter (TS_ID_param), without the _cd qualifier columns.
  const cols = header
    .map((h, i) => [h, i])
    .filter(([h]) => h.endsWith(`_${param}`))
    .map(([, i]) => i);
  if (!cols.length) return [];
  // If a site publishes more than one series of the parameter, use the one with most values.
  const counts = cols.map((c) => rows.filter((r) => Number.isFinite(parseFloat(r[c]))).length);
  const col = cols[counts.indexOf(Math.max(...counts))];
  const iDate = header.indexOf('datetime');
  const iTz = header.indexOf('tz_cd');
  const out = [];
  for (const r of rows) {
    const v = Number(r[col]);
    if (r[col] === '' || !Number.isFinite(v)) continue;
    const off = TZ[r[iTz]];
    if (off === undefined) throw new Error(`unknown time zone ${r[iTz]}`);
    const m = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d)$/.exec(r[iDate]);
    if (!m) throw new Error(`bad datetime ${r[iDate]}`);
    const local = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    out.push([local - off * 3600000, v]);
  }
  return out;
}

/**
 * Parse a CSV page from the OGC API "continuous" collection into [utcMillis, value][].
 * Times are UTC ("2015-03-01 00:15:00+00:00"). If more than one time series of the parameter
 * is present, the one with the most values is used.
 */
export function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const head = lines[0].split(',');
  const iT = head.indexOf('time');
  const iV = head.indexOf('value');
  const iS = head.indexOf('time_series_id');
  if (iT < 0 || iV < 0) throw new Error('unexpected CSV header');
  const bySeries = new Map();
  for (const line of lines.slice(1)) {
    const f = line.split(',');
    const v = Number(f[iV]);
    if (f[iV] === '' || !Number.isFinite(v)) continue;
    const m = /^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d):(\d\d)(?:\+00:00|Z)$/.exec(f[iT]);
    if (!m) throw new Error(`bad time ${f[iT]}`);
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    const id = iS >= 0 ? f[iS] : '';
    if (!bySeries.has(id)) bySeries.set(id, []);
    bySeries.get(id).push([t, v]);
  }
  let best = [];
  for (const pts of bySeries.values()) if (pts.length > best.length) best = pts;
  return best.sort((a, b) => a[0] - b[0]);
}

function ranges(site) {
  // One fetch range per year and season, covering every window the analysis can ask for.
  const out = [];
  const years = site.law ? [...OLD_YEARS, 2007, ...YEARS] : YEARS;
  for (const y of years) {
    const n = RT.transitions(y, 'new');
    const o = RT.transitions(y, 'old');
    for (const season of ['spring', 'fall']) {
      const centers = site.law ? [n[season], o[season]] : [n[season]];
      const lo = Math.min(...centers) - REACH - MARGIN;
      const hi = Math.max(...centers) + REACH + MARGIN;
      out.push({ year: y, season, lo, hi });
    }
  }
  return out;
}

function cacheName(cache, site, r) {
  return path.join(cache, `${site.id}_${site.param}_${RT.isoDate(r.lo)}_${RT.isoDate(r.hi)}.csv`);
}

async function getText(url, cacheFile) {
  if (fs.existsSync(cacheFile)) return fs.readFileSync(cacheFile, 'utf8');
  // The service sheds load with HTTP 503 now and then; back off and try again.
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      // an empty body is the service's answer when there are no readings in the range
      if (text.trim() !== '' && !text.startsWith('x,y,time') && !text.includes('time,value')) throw new Error('not a CSV response');
      fs.writeFileSync(cacheFile, text);
      return text;
    } catch (e) {
      if (attempt === 10) throw new Error(`${url}: ${e.message}`);
      await new Promise((r) => setTimeout(r, Math.min(120000, 5000 * 2 ** (attempt - 1))));
    }
  }
  return '';
}

export function apiUrl(site, lo, hi) {
  // whole UTC days lo..hi inclusive
  return (
    'https://api.waterdata.usgs.gov/ogcapi/v0/collections/continuous/items?f=csv&skipGeometry=true' +
    `&monitoring_location_id=USGS-${site.id}&parameter_code=${site.param}` +
    `&datetime=${RT.isoDate(lo)}T00:00:00Z/${RT.isoDate(hi + 1)}T00:00:00Z` +
    '&properties=time,value,time_series_id&limit=50000'
  );
}

async function main() {
  const args = process.argv.slice(2);
  const ci = args.indexOf('--cache');
  const cache = ci >= 0 ? path.resolve(args[ci + 1]) : path.join(os.tmpdir(), 'spring-forward-usgs');
  const screenOnly = args.includes('--screen');
  const full = args.includes('--full');
  fs.mkdirSync(cache, { recursive: true });

  // Fetch everything first, a couple of requests at a time, into the cache.
  const jobs = [];
  for (const site of SITES) {
    for (const r of ranges(site)) jobs.push([apiUrl(site, r.lo, r.hi), cacheName(cache, site, r)]);
  }
  let next = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < jobs.length) {
        const [url, file] = jobs[next++];
        await getText(url, file);
        if (++done % 100 === 0) console.error(`fetched ${done}/${jobs.length}`);
      }
    }),
  );

  const manifest = [];
  // The day the newest cached response was downloaded (UTC), not the day this script ran.
  const newest = Math.max(...jobs.map(([, file]) => fs.statSync(file).mtimeMs));
  const out = { retrieved: new Date(newest).toISOString().slice(0, 10), sites: [] };
  for (const site of SITES) {
    // Every day of every fetched range: its 24-hour wave (first method) and residuals (second).
    const stats = new Map();
    for (const r of ranges(site)) {
      const text = await getText(apiUrl(site, r.lo, r.hi), cacheName(cache, site, r));
      const sha = crypto.createHash('sha256').update(text).digest('hex');
      const pts = parseCsv(text);
      manifest.push(`${site.id} ${RT.isoDate(r.lo)} ${RT.isoDate(r.hi)} ${pts.length} ${sha.slice(0, 16)}`);
      const st = RT.dailyStats(RT.hourlyMeans(pts, site.offset));
      for (let d = r.lo + MARGIN; d <= r.hi - MARGIN; d++) if (st.has(d)) stats.set(d, st.get(d));
    }

    // Screening (first method's rule): amplitude and coverage over the real 2008-2025 windows.
    const ampsRel = [];
    let validDays = 0;
    let totalDays = 0;
    for (const y of YEARS) {
      for (const T of Object.values(RT.transitions(y, 'new'))) {
        for (let d = T - HALF; d <= T + HALF; d++) {
          if (d === T) continue;
          totalDays++;
          const st = stats.get(d);
          if (!st) continue;
          validDays++;
          ampsRel.push(site.param === '00010' ? st.A : st.A / st.mean);
        }
      }
    }
    const medAmp = RT.median(ampsRel);
    if (screenOnly) {
      const a = site.param === '00010' ? `${medAmp.toFixed(3)} degC` : `${(100 * medAmp).toFixed(2)}% of mean flow`;
      console.log(`${site.id} ${site.short}: median daily-wave amplitude ${a}; usable days ${validDays}/${totalDays}`);
      continue;
    }

    // Centres: the real clock changes of 2008-2025 and the fake ones 35 days either side; for
    // the law-change sites also the old-rule dates of 2008-2025 and both sets in 1990-2006.
    const centres = RT.centresForSite(!!site.law);

    // First method: one 4-character record per day, in a 29-day run around each real change of
    // 2008-2025. With --full, also around the fake changes 35 days either side (the first
    // method's placebos); they are left out of the bundled copy to keep the folder small.
    const runs = [];
    if (!site.stage2Only) {
      for (const y of YEARS) {
        for (const T of Object.values(RT.transitions(y, 'new'))) {
          for (const off of full ? [0, ...RT.PLACEBO_OFFSETS] : [0]) {
            let str = '';
            for (let d = T + off - HALF; d <= T + off + HALF; d++) {
              const st = stats.get(d);
              str += RT.encodeDay(st && { A: st.A, tau: st.tau });
            }
            runs.push({ first: T + off - HALF, days: str });
          }
        }
      }
    }

    // Second method: the two half-window median days at every centre, at 12 bits, and the step
    // computed from the unrounded profiles (kept only so data.test.mjs can check the rounding).
    let centreStr = '';
    let fullSteps = '';
    for (const c of centres) {
      const h = RT.halfProfiles(stats, c, HALF);
      centreStr += RT.encodeCentre(h);
      const full = h.before && h.after ? RT.bestShift(h.before, h.after) : null;
      fullSteps += full === null ? '~~' : RT.ALPHABET[(full + 2048) >> 6] + RT.ALPHABET[(full + 2048) & 63];
    }

    // Pictures: every day's hourly residuals around the real changes, for Lees Ferry only (to
    // keep the folder small).
    const profiles = [];
    if (site.key === 'lees') {
      for (const y of YEARS) {
        for (const T of Object.values(RT.transitions(y, 'new'))) {
          let p = '';
          let means = '';
          for (let d = T - HALF; d <= T + HALF; d++) {
            const st = stats.get(d);
            p += RT.encodeProfile(st ? st.resid : null);
            // the day's mean flow, log-coded in two characters (for the picture only)
            const code = st && st.mean > 0 ? RT.encLog(st.mean) : null;
            means += code === null ? '~~' : RT.ALPHABET[code >> 6] + RT.ALPHABET[code & 63];
          }
          profiles.push({ first: T - HALF, days: p, means });
        }
      }
    }

    out.sites.push({
      key: site.key,
      id: site.id,
      param: site.param,
      name: site.name,
      short: site.short,
      offset: site.offset,
      zone: site.zone,
      dst: site.dst,
      role: site.role,
      law: !!site.law,
      preregistered: !site.stage2Only,
      medianAmplitude: Number(medAmp.toPrecision(3)),
      coverage: [validDays, totalDays],
      runs,
      centres: centreStr,
      fullSteps,
      profiles,
    });
    console.error(`${site.id}: ${runs.length} runs, ${centres.length} centres`);
  }
  if (screenOnly) return;
  const js =
    '// Generated by data/fetch.mjs from USGS instantaneous values (api.waterdata.usgs.gov). See data/SOURCE.md.\n' +
    '// Encoding: see rivertime.js ("data encoding").\n' +
    `window.RIVER_DATA = ${JSON.stringify(out)};\n`;
  fs.writeFileSync(path.join(HERE, 'rivers.js'), js);
  fs.writeFileSync(
    path.join(HERE, 'manifest.txt'),
    '# site first-day last-day readings sha256-of-response (first 16 hex digits; one line per request; days are UTC)\n' +
      manifest.join('\n') +
      '\n',
  );
  console.error(`wrote rivers.js (${(js.length / 1024).toFixed(0)} KB) and manifest.txt (${manifest.length} requests)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
