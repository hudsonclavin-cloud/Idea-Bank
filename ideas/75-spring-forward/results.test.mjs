// Pins every figure the README quotes, and the page's wiring, to RiverTime.report() run on the
// bundled data. If the data, the method or the prose drift apart, this fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const RT = require('./rivertime.js');
const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(HERE, 'data/rivers.js'), 'utf8'), ctx);
const DATA = JSON.parse(JSON.stringify(ctx.window.RIVER_DATA));
const R = RT.report(DATA);
const README = fs.readFileSync(path.join(HERE, 'README.md'), 'utf8');
const HTML = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8');
const APP = fs.readFileSync(path.join(HERE, 'app.js'), 'utf8');
const f = RT.fmtMin;
const w = (x) => `${f(x.diff)} (${f(x.lo)} to ${f(x.hi)})`;
const has = (s, why) => assert.ok(README.includes(s), `README should contain "${s}" (${why})`);

test('the results table: every river, both statistics, both verdicts', () => {
  const rows = README.split('\n').filter((l) => l.startsWith('| ') && /95% interval/.test(l) && l.split('|').length === 8);
  assert.equal(rows.length, 7);
  const names = { lees: 'Lees Ferry', greendale: 'Flaming Gorge', santacruz: 'Santa Cruz', delaware: 'Delaware', salt: 'Salt below', buford: 'Buford', trinity: 'Trinity' };
  for (const [key, name] of Object.entries(names)) {
    const s = R.sites[key];
    const row = rows.find((l) => l.includes(name));
    assert.ok(row, name);
    const cells = row.split('|').map((c) => c.trim());
    assert.equal(cells[3], RT.fmtCI(s.Kc), `${name} Kc`);
    assert.equal(cells[4], s.verdictCorrected, `${name} Kc verdict`);
    assert.equal(cells[5], RT.fmtCI(s.K), `${name} K`);
    assert.equal(cells[6], s.verdict, `${name} K verdict`);
  }
  // the headline
  assert.equal(R.sites.lees.verdictCorrected, 'keeps standard time');
  assert.equal(R.sites.lees.Kc.n, 18);
});

test('added after review: the headline says what the label means, and how far the interval reaches', () => {
  const L = R.sites.lees;
  const tagline = README.split('\n').find((l) => l.startsWith('> '));
  // the first version's tagline said "says no: it keeps standard time"
  assert.ok(!tagline.includes('says no'), 'tagline');
  assert.ok(tagline.includes(`its interval stops at ${f(L.Kc.hi)} minutes`), 'tagline gives the upper end');
  has(`this one still allows ${f(L.Kc.hi)} minutes, over half the hour`, 'what the label means');
  assert.ok(L.Kc.hi > 30, '"over half an hour" needs an upper end above 30');
  assert.ok(HTML.includes('the label means only that the interval comes within ten minutes of zero'), 'page answer box');
  assert.ok(HTML.includes('it still allows over half an hour'), 'page answer box');
  // "about 20 to 30 minutes": the centres of every cut made afterwards
  const E = L.exploratory;
  for (const c of [E.after2012, E.quietNovembers, E.quiet]) {
    for (const st of [c.K, c.Kc]) assert.ok(st.mean > 18.5 && st.mean < 31, `${c.years.join(',')}: ${st.mean}`);
  }
  // the Salt is not clean evidence of zero: its intervals reach past 40
  assert.ok(R.sites.salt.Kc.hi > 40 && R.sites.salt.K.hi > 40);
  has(`its intervals reach ${f(R.sites.salt.Kc.hi)} (*K*<sub>c</sub>) and ${f(R.sites.salt.K.hi)} (*K*)`, 'the Salt');
  assert.ok(!HTML.includes('and the Salt below an Arizona dam all come out as keeping standard time'));
  // customers: at least five other western states, not "five neighbouring states"
  assert.ok(!HTML.includes('five neighbouring states'));
  assert.ok(HTML.includes('at least five other western states, all of which change their clocks'));
  has('at least five other western states, all of which change their clocks', 'customers');
});

test('the law-change figures', () => {
  const L = R.sites.lees.law;
  const B = R.sites.buford.law;
  has(`Buford ${w(B.atNew)}, above even the simulation, Lees Ferry ${w(L.atNew)}`, 'new dates');
  has(`Lees Ferry ${f(L.atOld.diff)}, ${f(L.atOld.lo)} to ${f(L.atOld.hi)}; Buford ${f(B.atOld.diff)}, ${f(B.atOld.lo)} to ${f(B.atOld.hi)}`, 'old dates');
  has(`moved from −8.1 to ${f(B.atOld.diff)}`, 'the flat-day fix');
  has(`same-dates difference is ${w(L.bySeason.spring.atNew)}`, 'March, same dates');
});

test('added after review: the law test against a simulated clock-keeper, and the pieces the overlap misses', () => {
  const L = R.sites.lees.law;
  const B = R.sites.buford.law;
  const C = L.clockKeeper;
  // a river that keeps clock time exactly does not score 60 in either column
  assert.ok(C.atNew.mean < 50 && C.atOld.mean < 50, `${C.atNew.mean}, ${C.atOld.mean}`);
  has(`It scores ${f(C.atNew.mean)} at the new dates and ${f(C.atOld.mean)} at the old`, 'benchmark, How it works');
  has(`a simulated clock-keeper scores ${f(C.atNew.mean)} at the March and November dates and ${f(C.atOld.mean)} at the April and October dates`, 'benchmark, assessment');
  assert.equal(C.coherence.toFixed(2), L.realCoherence.toFixed(2), 'noise matched to Lees Ferry');
  has(`coherence ${L.realCoherence.toFixed(2)} in both`, 'calibration');
  assert.ok(!HTML.includes('would give about 60 in both columns'), 'the page no longer says 60');
  assert.ok(!README.includes('Calendar effects cancel, and a clock-keeper gives about 60 in both.'), 'nor the README');
  // the variants the README reports: noise 0.05 to 0.5 and a plain cosine
  const lees = DATA.sites.find((s) => s.key === 'lees');
  const shapes = { spring: RT.averageHalves(lees, RT.YEARS, 'spring').before, fall: RT.averageHalves(lees, RT.YEARS, 'fall').after };
  const cos = Array.from({ length: 24 }, (_, h) => Math.cos(RT.OMEGA * (h + 0.5 - 20)));
  const runs = [0.05, 0.1, 0.2, 0.3, 0.5].map((noise) => RT.simulateClockKeeper(shapes, { noise, reps: 4 }));
  runs.push(RT.simulateClockKeeper({ spring: cos, fall: cos }, { reps: 4 }));
  for (const r of runs) {
    assert.ok(r.atNew.mean >= 44 && r.atNew.mean <= 46, `new dates ${r.atNew.mean}`);
    assert.ok(r.atOld.mean >= 33 && r.atOld.mean <= 44, `old dates ${r.atOld.mean}`);
  }
  assert.ok(Math.min(...runs.map((r) => r.coherence)) > 0.9 && Math.max(...runs.map((r) => r.coherence)) > 0.998);
  has('the first column stayed between 44 and 46 and the second ran from 33 to 44', 'variants');
  // Buford's late-October fortnight in 2008-2025 holds the real change a week later
  has(`steps ${RT.fmtCI(B.eraSeasons.newAtOld.fall)} though no clock changed that day, where the simulated clock-keeper steps about ${f(C.fallNewAtOld.mean)}`, 'Buford late October');
  // each era at its own dates, and the spring steps alone
  has(`*K* at each era's own change dates is ${RT.fmtCI(L.eras.oldAtOld)} for 1990–2006, which the rule would call *${RT.verdict(L.eras.oldAtOld)}*, and ${RT.fmtCI(L.eras.newAtNew)} for 2008–2025`, 'Lees Ferry by era');
  assert.equal(RT.verdict(L.eras.oldAtOld), 'keeps part of the hour');
  const sp = L.bySeason.spring;
  has(`it moved ${f(-sp.atOld.diff)} minutes earlier (95% interval ${f(-sp.atOld.hi)} to ${f(-sp.atOld.lo)}) at the April dates`, 'spring, April dates');
  has(`and ${f(-sp.atNew.diff)} earlier (95% interval ${f(-sp.atNew.hi)} to ${f(-sp.atNew.lo)}) at the March dates`, 'spring, March dates');
  has(`its day moved ${f(L.eraSeasons.newAtOld.spring.mean)} minutes later (95% interval ${f(L.eraSeasons.newAtOld.spring.lo)} to ${f(L.eraSeasons.newAtOld.spring.hi)})`, 'April dates, no clock');
  has(`Buford, for comparison: ${RT.fmtCI(B.eras.oldAtOld)} and ${RT.fmtCI(B.eras.newAtNew)}`, 'Buford by era');
  // the page has the reference row and the era table
  assert.ok(APP.includes("'A simulated clock-keeper'") && HTML.includes('id="eraBody"'));
});

test('the exploratory March and November figures', () => {
  const L = R.sites.lees;
  const E = L.exploratory;
  has(`earlier in ${E.springEarlier} of ${E.springCount} years, by ${f(-L.spring.mean)} minutes on average (95% interval ${f(L.spring.lo)} to ${f(L.spring.hi)}`, 'spring steps');
  has(`average ${RT.fmtCI(L.placebo[0].spring)} and ${RT.fmtCI(L.placebo[1].spring)}`, 'spring placebos');
  has(`average ${RT.fmtCI(L.law.eraSeasons.oldAtNew.spring)}`, 'March dates 1990-2006');
  has(`*K* is ${RT.fmtCI(E.after2012.K)} and *K*<sub>c</sub> ${RT.fmtCI(E.after2012.Kc)}, *${E.after2012.verdictCorrected}*`, 'without 2008-2012');
  const springs = L.rows.map((r) => r.spring);
  assert.equal(Math.max(...springs.map(Math.abs)), 39);
  has('none of the eighteen Marches moved more than 39 minutes', 'tagline bound');
  const steady = L.rows.filter((r) => [2008, 2009, 2011, 2012].includes(r.year)).map((r) => f(r.fall, 0));
  has(`their steps are ${steady.slice(0, 3).join(', ')} and ${steady[3]}`, 'steady-flow Novembers');
  // coherence of the November before-windows
  const coh = RT.YEARS.map((y) => [y, RT.centreAt(DATA.sites[0], RT.transitions(y, 'new').fall).coherenceBefore]);
  const bad = coh.filter(([y]) => [2008, 2009, 2011, 2012].includes(y)).map(([, c]) => c);
  const good = coh.filter(([y]) => ![2008, 2009, 2011, 2012].includes(y)).map(([, c]) => c);
  has(`is ${Math.min(...bad).toFixed(2)} to ${Math.max(...bad).toFixed(2)}, against ${Math.min(...good).toFixed(2)} or more`, 'coherence');
});

test('added after review: the other experiments in the windows, and the cuts that leave them out', () => {
  const E = R.sites.lees.exploratory;
  const key = (w) => `${w.season} ${w.year}`;
  assert.deepEqual(E.highFlow.map(key), ['spring 2008', 'fall 2013', 'fall 2014', 'fall 2016', 'fall 2018']);
  assert.deepEqual(E.disturbed.filter((w) => !w.why.includes('steady flows')).map(key).sort(), ['fall 2013', 'fall 2014', 'fall 2016', 'fall 2018', 'fall 2024', 'spring 2008', 'spring 2021']);
  assert.deepEqual(E.quietNovembers.years, [2015, 2017, 2019, 2020, 2021, 2022, 2023, 2025]);
  assert.deepEqual(E.quiet.years, [2015, 2017, 2019, 2020, 2022, 2023, 2025]);
  has(`The four high-flow Novembers' steps average ${RT.fmtCI(E.highFlowFall.fall)}; the eight Novembers with none of these average ${RT.fmtCI(E.quietNovembers.fall)}`, 'November steps');
  has(`*K* is ${RT.fmtCI(E.quietNovembers.K)} and *K*<sub>c</sub> ${RT.fmtCI(E.quietNovembers.Kc)}, *${E.quietNovembers.verdictCorrected}*`, 'quiet Novembers');
  has(`*K* is ${RT.fmtCI(E.quiet.K)} and *K*<sub>c</sub> ${RT.fmtCI(E.quiet.Kc)}, which the rule would call *${E.quiet.verdictCorrected}*`, 'quiet years');
  // the labels really do swing across the three cuts
  assert.deepEqual([E.after2012.verdictCorrected, E.quietNovembers.verdictCorrected, E.quiet.verdictCorrected], ['cannot tell', 'keeps standard time', 'keeps clock time']);
  // November 2024: the lowest coherence of any November window outside 2008-2012
  const lees = DATA.sites.find((s) => s.key === 'lees');
  const coh = (y) => RT.centreAt(lees, RT.transitions(y, 'new').fall);
  const others = RT.YEARS.filter((y) => y > 2012 && y !== 2024).flatMap((y) => [coh(y).coherenceBefore, coh(y).coherenceAfter]);
  assert.ok(coh(2024).coherenceAfter < Math.min(...others));
  has(`the median day's coherence is ${coh(2024).coherenceAfter.toFixed(2)}, the lowest of any November outside 2008–2012`, 'November 2024');
});

test('the clock times and the average March day', () => {
  const a = R.sites.lees.exploratory.averageDay.spring;
  const F = a.features;
  const b = F.before.morningRise;
  const af = F.after.morningRise;
  // revised after review: hourly means of quarter-hour readings sit at h + 22.5 minutes, so the
  // first version's 09:46, 09:24 and 10:24 were 7.5 minutes late
  assert.equal(RT.fmtClock(b), '09:39');
  assert.equal(RT.fmtClock(af), '09:17');
  has('Before the change both read 9:39 am. After it Arizona\'s reads 9:17 and Utah\'s 10:17.', 'clock faces');
  has(`arriving ${af + 60 - b} minutes later than a fortnight before, the Arizona watch ${b - af} minutes earlier`, 'the two watches');
  assert.equal(-a.shift, 19);
  // every feature moved earlier; the evening did not stay put
  const m = F.moves;
  has(`the morning rise ${-m.morningRise} minutes, the overnight low ${-m.low}, the afternoon fall ${-m.afternoonFall}, the evening rise ${-m.eveningRise}; only the broad, flat evening crest moved less (${Math.abs(m.crest)})`, 'features');
  assert.ok(Math.abs(m.eveningRise - m.morningRise) <= 3, 'the evening rise moved about as far as the morning one');
  assert.ok(!HTML.includes("evening didn&rsquo;t move") && !HTML.includes('evening high water stayed within'));
  assert.ok(!README.includes("its evening doesn't move"));
  // how well each move is fixed: a seeded bootstrap over the years
  const lees = DATA.sites.find((s) => s.key === 'lees');
  const bs = RT.bootstrapMoves(lees, RT.YEARS, 'spring', { reps: 2000, seed: 7 });
  const e = (x) => -x;
  has(`puts the morning rise's move at ${e(bs.morningRise.hi)} to ${e(bs.morningRise.lo)} minutes earlier and the low's at ${e(bs.low.hi)} to ${e(bs.low.lo)}, but the crest's anywhere from ${e(bs.crest.lo)} minutes earlier to ${bs.crest.hi} later and the evening rise's from ${e(bs.eveningRise.lo)} earlier to ${bs.eveningRise.hi} later`, 'bootstrap');
  const gone = bs.eveningRise.missing / 2000;
  assert.ok(gone > 0.28 && gone < 0.38, `"a third of the resamples": ${gone}`);
  // the crest's interval holds both no move and the morning's move; the morning's holds neither 0
  assert.ok(bs.crest.lo < m.morningRise && bs.crest.hi > 0);
  assert.ok(bs.morningRise.hi < 0);
  // the evening rise is loosely fixed too: its interval holds no move, as the crest's does
  assert.ok(bs.eveningRise.lo < m.morningRise && bs.eveningRise.hi > 0);
  // last round: the clock-face finding was the size the review reported, not wider. On every
  // average day (March and November, before and after), every crossing, crest and low placed at
  // the half hour, as the first version did, comes out 7 or 8 minutes later than now.
  const eventsAt = (p, centre) => {
    const c = RT.smoothCurve(p, 1, centre);
    const ev = { up: [], down: [], high: 0, low: 0 };
    for (let k = 1; k < 1440; k++) {
      if (c[k - 1] < 0 && c[k] >= 0) ev.up.push(k);
      if (c[k - 1] >= 0 && c[k] < 0) ev.down.push(k);
      if (c[k] > c[ev.high]) ev.high = k;
      if (c[k] < c[ev.low]) ev.low = k;
    }
    return ev;
  };
  for (const season of ['spring', 'fall']) {
    const halves = RT.averageHalves(lees, RT.YEARS, season);
    for (const half of ['before', 'after']) {
      const now = RT.dayEvents(halves[half]);
      assert.deepEqual(eventsAt(halves[half], RT.HOUR_CENTRE), now, `${season} ${half}`);
      const old = eventsAt(halves[half], 0.5);
      const late = [...old.up.map((x, i) => x - now.up[i]), ...old.down.map((x, i) => x - now.down[i]), old.high - now.high, old.low - now.low];
      assert.equal(old.up.length, now.up.length);
      assert.equal(old.down.length, now.down.length);
      for (const d of late) assert.ok(d === 7 || d === 8, `${season} ${half}: ${d}`);
    }
  }
  // the revision note names the findings that went further, and the one new test that passes
  // on the first version (the calendar test: transitions() is unchanged)
  assert.ok(!README.includes('the third turned out wider'));
  has('two went further than reported: the evening\'s uncertainty', 'revision note');
  has('steady releases in March 2021 as well', 'revision note');
  assert.ok(!README.includes('Every new test fails on the first version'));
  has('Every new test but one fails on the first version (the calendar test', 'revision note');
});

test('the page takes every number from the report, and the first method matches the log', () => {
  // every data-k slot in the page has a value in app.js, and the page's prose carries no result
  const keys = [...HTML.matchAll(/data-k="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length >= 25);
  for (const k of new Set(keys)) assert.ok(APP.includes(`'${k}'`) || APP.includes(`${k}:`), `app.js fills ${k}`);
  for (const n of ['5.4', '33.5', '22.8', '19.2', '61.7', '44.5', '42.3', '9:46', '9:24', '10:24', '9:39', '9:17', '10:17', '28.6', '21.6', '45.1', '40.7', '29.1', '82.9', '27.1', '30.5', '50.3']) {
    assert.ok(!HTML.includes(n), `index.html should not hard-code ${n}`);
  }
  // method 1 on the real windows: the K values the first session logged at 23:03
  const expect = { lees: '13.5 (−51.7 to 78.7)', salt: '23.2 (−91.4 to 137.9)', buford: '−25.3 (−234.7 to 184.0)', trinity: '−37.5 (−174.2 to 99.2)', santacruz: '−3.7 (−18.3 to 10.9)', delaware: '−17.1 (−77.3 to 43.1)' };
  for (const [key, str] of Object.entries(expect)) {
    const a = RT.analyseSite(DATA.sites.find((s) => s.key === key), RT.YEARS, { placebo: false });
    assert.equal(`${f(a.K.mean)} (${f(a.K.lo)} to ${f(a.K.hi)})`, str, key);
    assert.ok(README.includes(str), `README has ${str}`);
  }
});
