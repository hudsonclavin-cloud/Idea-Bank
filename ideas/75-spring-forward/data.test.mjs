// Tests of the data: the two USGS services agree on UTC instants across a clock change, and the
// bundled copy decodes into what the method needs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { parseCsv, parseRdb, SITES, YEARS, OLD_YEARS } from './data/fetch.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const RT = require('./rivertime.js');

export function loadData() {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(HERE, 'data/rivers.js'), 'utf8'), ctx);
  return JSON.parse(JSON.stringify(ctx.window.RIVER_DATA)); // out of the vm realm
}

test('the legacy service (local time + zone code) and the OGC API (UTC) give the same readings at the same instants across both 2015 clock changes', () => {
  for (const season of ['spring', 'fall']) {
    const rdb = fs.readFileSync(path.join(HERE, `data/fixtures/buford-${season}-legacy.rdb`), 'utf8');
    const csv = fs.readFileSync(path.join(HERE, `data/fixtures/buford-${season}-ogcapi.csv`), 'utf8');
    const a = parseRdb(rdb, '00060');
    const b = new Map(parseCsv(csv));
    assert.ok(a.length >= 90, `${season}: ${a.length} legacy readings`);
    let same = 0;
    let shifted = 0;
    for (const [t, v] of a) {
      if (b.get(t) === v) same++;
      if (b.get(t + 3600000) === v) shifted++;
    }
    assert.equal(same, a.length, `${season}: ${same} of ${a.length} agree`);
    // and the comparison can tell an hour apart: shifted by one hour, many disagree
    assert.ok(shifted < 0.8 * a.length, `${season}: ${shifted} agree an hour off`);
  }
  // the fall day has the repeated hour: 25 local hours, 100 readings, all distinct instants
  const fall = parseRdb(fs.readFileSync(path.join(HERE, 'data/fixtures/buford-fall-legacy.rdb'), 'utf8'), '00060');
  assert.equal(new Set(fall.map(([t]) => t)).size, fall.length);
  assert.equal((fall[fall.length - 1][0] - fall[0][0]) / 3600000, 24.75);
});

test('an Arizona site too: the legacy service (always MST) and the OGC API (UTC) agree at the same instants on 1 November 2015', () => {
  // Added 24 Oct. Lees Ferry's readings for the day of the 2015 fall change, from both services.
  const a = parseRdb(fs.readFileSync(path.join(HERE, 'data/fixtures/lees-fall-legacy.rdb'), 'utf8'), '00060');
  const b = new Map(parseCsv(fs.readFileSync(path.join(HERE, 'data/fixtures/lees-fall-ogcapi.csv'), 'utf8')));
  assert.equal(a.length, 96);
  assert.equal(a[0][0], Date.UTC(2015, 10, 1, 7, 0)); // 00:00 MST is 07:00 UTC, no daylight time
  let same = 0;
  for (const [t, v] of a) if (b.get(t) === v) same++;
  assert.equal(same, a.length);
  // the hours of the day in UTC run straight through the change: 96 readings 15 minutes apart
  for (let i = 1; i < a.length; i++) assert.equal(a[i][0] - a[i - 1][0], 15 * 60000);
});

test('the bundled copy has every site, window and centre the analyses ask for', () => {
  const data = loadData();
  assert.deepEqual(
    data.sites.map((s) => s.id),
    SITES.map((s) => s.id),
  );
  assert.equal(data.retrieved, '2026-10-23');
  for (const site of data.sites) {
    const spec = SITES.find((s) => s.id === site.id);
    assert.equal(site.preregistered, !spec.stage2Only);
    assert.equal(site.law, !!spec.law);
    // first method: every day of every real window, 2008-2025, lies in a stored run (the
    // placebo windows are only in a --full rebuild)
    if (site.preregistered) {
      for (const y of YEARS) {
        for (const T of Object.values(RT.transitions(y, 'new'))) {
          for (const off of [0]) {
            for (let d = T + off - 14; d <= T + off + 14; d++) {
              const inRun = site.runs.some((r) => d >= r.first && d < r.first + r.days.length / RT.DAY_CHARS);
              assert.ok(inRun, `${site.id} ${RT.isoDate(d)} not in any run`);
            }
          }
        }
      }
    } else assert.equal(site.runs.length, 0);
    // second method: one fixed-width record per centre, and a usable pair at every real change
    const centres = RT.centresForSite(site.law);
    assert.equal(site.centres.length, centres.length * RT.RECORD_CHARS);
    assert.equal(site.fullSteps.length, centres.length * 2);
    for (const y of YEARS) {
      for (const T of Object.values(RT.transitions(y, 'new'))) {
        const h = RT.centreAt(site, T);
        assert.ok(h.nBefore <= 14 && h.nAfter <= 14);
      }
    }
  }
});

test('storing the median days at 12 bits changes no step by more than 3 minutes', () => {
  // fetch.mjs also stored each step as computed from the unrounded profiles (fullSteps).
  const data = loadData();
  let changed = 0;
  let total = 0;
  for (const site of data.sites) {
    RT.centresForSite(site.law).forEach((c, k) => {
      const code = site.fullSteps.slice(2 * k, 2 * k + 2);
      const full = code === '~~' ? null : RT.ALPHABET.indexOf(code[0]) * 64 + RT.ALPHABET.indexOf(code[1]) - 2048;
      const got = RT.shiftAt(site, c);
      assert.equal(got === null, full === null, `${site.key} ${RT.isoDate(c)}`);
      if (full === null) return;
      total++;
      if (got.step !== full) changed++;
      assert.ok(Math.abs(got.step - full) <= 3, `${site.key} ${RT.isoDate(c)}: ${got.step} vs ${full}`);
    });
  }
  assert.ok(total > 1000, `${total} centres with a step`);
  assert.ok(changed <= 40, `${changed} of ${total} steps moved by rounding`);
});

test('the pre-registration is the file written on 23 October, unchanged', () => {
  const sha = crypto.createHash('sha256').update(fs.readFileSync(path.join(HERE, 'PREREGISTRATION.md'))).digest('hex');
  assert.equal(sha, '4d31c92b07981e7e56d94735d58e52fb3e1173e38ca3ca967067d9bd981990f2');
});

test('the manifest lists every request, and every site has the records it should', () => {
  const lines = fs.readFileSync(path.join(HERE, 'data/manifest.txt'), 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));
  assert.equal(lines.length, 360);
  const per = {};
  for (const l of lines) {
    const [id, a, b, n, sha] = l.split(' ');
    per[id] = (per[id] || 0) + 1;
    assert.match(a, /^\d{4}-\d\d-\d\d$/);
    assert.match(b, /^\d{4}-\d\d-\d\d$/);
    assert.ok(Number(n) >= 0);
    assert.match(sha, /^[0-9a-f]{16}$/);
  }
  for (const s of SITES) assert.equal(per[s.id], s.law ? 72 : 36);
});

// ---------------------------------------------------------------- added after review (24 Oct)

test('added after review: Lees Ferry is read every quarter hour, so an hourly mean sits 22.5 minutes past the hour', () => {
  // The raw downloads were checked in full (every one of the 2,784 readings in each March window
  // of 2008-2025 is stamped :00, :15, :30 or :45); the bundled fixture day is checked here.
  const pts = parseCsv(fs.readFileSync(path.join(HERE, 'data/fixtures/lees-fall-ogcapi.csv'), 'utf8'));
  assert.ok(pts.length >= 96);
  for (const [t] of pts) assert.equal(new Date(t).getUTCMinutes() % 15, 0);
  // so the mean of the four readings in an hour is the value at h + 0.375 for any daily wave
  const at = (t) => Math.cos(RT.OMEGA * (t - 9.7)) + 0.5 * Math.sin(3 * RT.OMEGA * t);
  const mean = (h) => [0, 0.25, 0.5, 0.75].reduce((s, q) => s + at(h + q), 0) / 4;
  const p = Array.from({ length: 24 }, (_, h) => mean(h));
  const H = RT.harmonics(p, RT.HOUR_CENTRE);
  const T = RT.harmonics(Array.from({ length: 24 }, (_, h) => at(h + RT.HOUR_CENTRE)), RT.HOUR_CENTRE);
  for (const k of [0, 2]) assert.ok(Math.abs(Math.atan2(H[k][1], H[k][0]) - Math.atan2(T[k][1], T[k][0])) < 1e-9, `harmonic ${k + 1} phase`);
});

test('added after review: the bundled daily means find the same high-flow windows as the raw readings', () => {
  // From the raw downloads (any reading above 30,000 cfs within two weeks of a real 2008-2025
  // change): before the March 2008 change; after the November 2013, 2014, 2016 and 2018 changes.
  const lees = loadData().sites.find((s) => s.key === 'lees');
  const found = [];
  for (const y of YEARS) {
    for (const season of ['spring', 'fall']) {
      const days = RT.highFlowDays(lees, RT.transitions(y, 'new')[season]);
      if (days.length) found.push(`${season} ${y} ${days[0] < 0 ? 'before' : 'after'}`);
    }
  }
  assert.deepEqual(found, ['spring 2008 before', 'fall 2013 after', 'fall 2014 after', 'fall 2016 after', 'fall 2018 after']);
  // March 2021: steady releases after the change, about 4,200 cfs and then about 20,000
  const T = RT.transitions(2021, 'new').spring;
  for (const k of [2, 3, 4, 5]) assert.ok(RT.dayMeanFlow(lees, T + k) < 5000, `+${k}`);
  for (const k of [9, 10, 11]) assert.ok(RT.dayMeanFlow(lees, T + k) > 18000, `+${k}`);
  assert.deepEqual(RT.OTHER_DISTURBED.map((w) => `${w.season} ${w.year}`), ['spring 2021', 'fall 2024']);
});
