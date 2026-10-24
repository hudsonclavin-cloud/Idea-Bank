// Tests of the method itself, on synthetic rivers whose answer is known.
// History (from the session log): the tests up to "the day and profile encodings round-trip"
// were written and passing before any river data around a clock change was fetched (22:48-22:57
// UTC, 23 Oct 2026; the encoding test was later cut from 6 to 4 characters a day). The
// second-method tests were written at 23:18, after the first method had been run on the real
// rivers but before the second method was run on Lees Ferry or Flaming Gorge (23:21). The tests
// at the end, marked "added 24 Oct", were written by the second session, after every result
// had been seen; they check plumbing (encodings, a flat-profile guard, the crest), not results.
// The tests marked "added after review" were written later on 24 Oct, after an independent
// review: where an hourly mean sits in time, and what the law-change comparison can score.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const RT = require('./rivertime.js');

// Small deterministic PRNG (mulberry32) and a normal deviate.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(r) {
  const u = Math.max(1e-12, r());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

test('clock-change Sundays match the published US dates', () => {
  const iso = RT.isoDate;
  const n = (y) => RT.transitions(y, 'new');
  const o = (y) => RT.transitions(y, 'old');
  assert.equal(iso(n(2008).spring), '2008-03-09');
  assert.equal(iso(n(2008).fall), '2008-11-02');
  assert.equal(iso(n(2015).spring), '2015-03-08');
  assert.equal(iso(n(2015).fall), '2015-11-01');
  assert.equal(iso(n(2025).spring), '2025-03-09');
  assert.equal(iso(n(2025).fall), '2025-11-02');
  assert.equal(iso(n(2007).spring), '2007-03-11');
  assert.equal(iso(n(2007).fall), '2007-11-04');
  assert.equal(iso(o(2006).spring), '2006-04-02');
  assert.equal(iso(o(2006).fall), '2006-10-29');
  assert.equal(iso(o(1990).spring), '1990-04-01');
  assert.equal(iso(o(1990).fall), '1990-10-28');
  for (let y = 1987; y <= 2030; y++) {
    for (const rule of ['old', 'new']) {
      const t = RT.transitions(y, rule);
      assert.equal(RT.dow(t.spring), 0);
      assert.equal(RT.dow(t.fall), 0);
    }
    const t = RT.transitions(y, 'new');
    const [, ms, ds] = RT.dateOf(t.spring);
    const [, mf, df] = RT.dateOf(t.fall);
    assert.ok(ms === 3 && ds >= 8 && ds <= 14);
    assert.ok(mf === 11 && df >= 1 && df <= 7);
    const u = RT.transitions(y, 'old');
    assert.ok(RT.dateOf(u.spring)[1] === 4 && RT.dateOf(u.spring)[2] <= 7);
    assert.ok(RT.dateOf(u.fall)[1] === 10 && RT.dateOf(u.fall)[2] >= 25);
  }
  assert.equal(RT.ruleInForce(2006), 'old');
  assert.equal(RT.ruleInForce(2007), 'new');
});

test('the 2x24 moving average passes a daily cycle untouched and removes a straight line', () => {
  const x = [];
  for (let h = 0; h < 24 * 6; h++) x.push(5 + 0.3 * h + 2 * Math.cos(RT.OMEGA * (h + 0.5 - 7)) + Math.sin(2 * RT.OMEGA * h));
  const r = RT.detrend(x);
  for (let h = 12; h < x.length - 12; h++) {
    const expect = 2 * Math.cos(RT.OMEGA * (h + 0.5 - 7)) + Math.sin(2 * RT.OMEGA * h);
    assert.ok(Math.abs(r[h] - expect) < 1e-9, `hour ${h}`);
  }
});

test('the daily component returns the exact amplitude and crest time of a sampled cosine', () => {
  for (const tau of [0, 0.25, 3.7, 11.99, 12, 17.5, 23.9]) {
    for (const A of [0.01, 1, 4000]) {
      const r = Array.from({ length: 24 }, (_, h) => A * Math.cos(RT.OMEGA * (h + 0.5 - tau)));
      const c = RT.dailyComponent(r);
      assert.ok(Math.abs(c.A - A) < 1e-9 * Math.max(1, A));
      const d = ((c.tau - tau + 36) % 24) - 12;
      assert.ok(Math.abs(d) < 1e-9, `tau ${tau} got ${c.tau}`);
    }
  }
});

test('shifting any repeating daily pattern by whole hours moves the crest time by exactly that much', () => {
  const r = rng(7);
  for (let trial = 0; trial < 200; trial++) {
    const shape = Array.from({ length: 24 }, () => r() * 10);
    // make sure it has a daily component at all
    shape[Math.floor(r() * 24)] += 20;
    const base = RT.dailyComponent(shape.map((v) => v - shape.reduce((a, b) => a + b) / 24));
    const k = 1 + Math.floor(r() * 23);
    const shifted = shape.map((_, h) => shape[(h + k) % 24]); // events k hours earlier
    const c = RT.dailyComponent(shifted.map((v) => v - shape.reduce((a, b) => a + b) / 24));
    const d = ((((base.tau - k - c.tau) % 24) + 36) % 24) - 12;
    assert.ok(Math.abs(d) < 1e-9, `trial ${trial}: shift ${k} -> ${base.tau - c.tau}`);
    assert.ok(Math.abs(c.A - base.A) < 1e-9 * base.A);
  }
});

test('hourly means convert UTC to a fixed standard time and fill only short gaps', () => {
  // Readings every 15 min, value = standard-time hour of day; offset -7 (MST).
  const start = Date.UTC(2015, 2, 1, 7, 0); // 00:00 MST on 1 March 2015
  const pts = [];
  for (let i = 0; i < 96 * 2; i++) {
    const t = start + i * 15 * 60000;
    const stdHour = Math.floor(i / 4) % 24;
    pts.push([t, stdHour]);
  }
  // remove hours 5,6 (2 h gap: filled) and 15..18 (4 h gap: not filled) on day 1
  const cut = pts.filter(([t]) => {
    const h = Math.floor((t - start) / 3600000);
    return !(h === 5 || h === 6 || (h >= 15 && h <= 18));
  });
  const s = RT.hourlyMeans(cut, -7);
  assert.equal(s.start, RT.dayNumber(2015, 3, 1) * 24);
  assert.equal(s.values[4], 4);
  assert.equal(s.values[5], 5);
  assert.equal(s.values[6], 6);
  assert.ok(Number.isNaN(s.values[15]) && Number.isNaN(s.values[18]));
  assert.equal(s.values[24 + 13], 13);
});

// A synthetic river: a two-peaked daily release pattern, smaller and later at weekends, a slow
// seasonal drift in timing, day-to-day noise, slow changes in volume, occasional odd days, and
// (optionally) a clock change at 02:00 local on Sunday T. Returns 15-minute UTC readings.
function circ(t, c) {
  return ((((t - c) % 24) + 36) % 24) - 12;
}
function syntheticRiver({
  T, offset, keepsClock, season, seed,
  drift = 1.5, noise = 0.08, oddDays = 2, weekendShift = 1.4, weekendAmp = 0.35, jitter = 0.25,
}) {
  const r = rng(seed);
  const pts = [];
  const firstDay = T - 20;
  const lastDay = T + 20;
  const dayJitter = new Map();
  const odd = new Set();
  for (let d = firstDay; d <= lastDay; d++) dayJitter.set(d, gauss(r) * jitter);
  for (let k = 0; k < oddDays; k++) odd.add(T + (r() < 0.5 ? -1 : 1) * (1 + Math.floor(r() * 13)));
  // the clock change happens at 02:00 local time on Sunday T (02:00 daylight = 01:00 standard in fall)
  const changeStd = (T * 24 + (season === 'fall' ? 1 : 2)) * 3600000;
  for (let d = firstDay; d <= lastDay; d++) {
    const dw = RT.dow(d);
    const weekend = dw === 0 || dw === 6;
    for (let q = 0; q < 96; q++) {
      const stdHour = q / 4;
      const stdMs = (d * 24 + stdHour) * 3600000;
      const afterChange = stdMs >= changeStd;
      const summer = season === 'spring' ? afterChange : !afterChange;
      const clockHour = keepsClock && summer ? stdHour + 1 : stdHour;
      // the schedule's own clock: drifts slowly with the season, jitters day to day, and runs
      // later at weekends
      const t = clockHour - (drift / 60) * (d - T) + dayJitter.get(d) - (weekend ? weekendShift : 0);
      const amp = weekend ? weekendAmp : 1;
      let v = 10 + 0.02 * (d - T) + amp * (2.2 * Math.exp(-(circ(t, 9) ** 2) / 4) + 3 * Math.exp(-(circ(t, 19) ** 2) / 6));
      if (odd.has(d)) v = 25 + 3 * Math.sin(stdHour / 5); // an odd day, like a steady high release
      v *= 1 + noise * gauss(r) * 0.2;
      pts.push([stdMs - offset * 3600000, v]);
    }
  }
  return pts;
}

function stepFor(opts, estOpts) {
  const pts = syntheticRiver(opts);
  const s = RT.hourlyMeans(pts, opts.offset);
  const stats = RT.dailyStats(s);
  const days = [...stats].map(([dn, v]) => ({ dn, A: v.A, tau: v.tau }));
  return RT.estimateStep(days, opts.T, estOpts);
}

function mean(a) {
  return a.reduce((x, y) => x + y, 0) / a.length;
}

test('on synthetic rivers the estimator is nearly unbiased: -60 min in spring and +60 in fall for a clock-keeper, 0 for a sun-keeper', () => {
  for (const season of ['spring', 'fall']) {
    for (const keepsClock of [true, false]) {
      const errs = [];
      for (let seed = 1; seed <= 300; seed++) {
        const T = RT.transitions(2008 + (seed % 18), 'new')[season];
        const est = stepFor({ T, offset: -7, keepsClock, season, seed });
        assert.ok(est, 'estimate exists');
        errs.push(est.step - (keepsClock ? (season === 'spring' ? -60 : 60) : 0));
      }
      const m = mean(errs);
      const sd = Math.sqrt(mean(errs.map((e) => (e - m) ** 2)));
      // day-to-day timing jitter is 15 min (sd), weekends are weak and two days in each
      // window are wild, so one transition is good to about 20 min; the average is within 6.
      assert.ok(Math.abs(m) < 6, `${season} ${keepsClock}: mean error ${m.toFixed(2)}`);
      assert.ok(sd < 30, `${season} ${keepsClock}: sd ${sd.toFixed(2)}`);
    }
  }
});

test('with no noise the estimator recovers the hour to within a minute', () => {
  for (const season of ['spring', 'fall']) {
    for (const keepsClock of [true, false]) {
      for (let y = 2008; y <= 2025; y++) {
        const T = RT.transitions(y, 'new')[season];
        const est = stepFor({ T, offset: -6, keepsClock, season, seed: y, jitter: 0, noise: 0, oddDays: 0 });
        const truth = keepsClock ? (season === 'spring' ? -60 : 60) : 0;
        assert.ok(Math.abs(est.step - truth) < 1, `${y} ${season} ${keepsClock}: ${est.step}`);
      }
    }
  }
});

test('eighteen synthetic years give the right verdict', () => {
  for (const keepsClock of [true, false]) {
    let right = 0;
    for (let rep = 0; rep < 30; rep++) {
      const Ks = [];
      for (let y = 2008; y <= 2025; y++) {
        const t = RT.transitions(y, 'new');
        const seed = 1000 * rep + y;
        const sp = stepFor({ T: t.spring, offset: -7, keepsClock, season: 'spring', seed });
        const fa = stepFor({ T: t.fall, offset: -7, keepsClock, season: 'fall', seed: seed + 500 });
        Ks.push((fa.step - sp.step) / 2);
      }
      const v = RT.verdict(RT.summarize(Ks));
      if (v === (keepsClock ? 'keeps clock time' : 'keeps standard time')) right++;
    }
    assert.ok(right >= 28, `${keepsClock ? 'clock' : 'sun'}-keeper: right ${right} of 30`);
  }
});

test('weekday terms matter: without them a weaker weekend wave biases the step', () => {
  // Weekend days have a smaller wave. The 24-hour moving average then leaks a little of each
  // neighbour into the days either side of a weekend, by weekday, which the weekday terms absorb.
  const o = { offset: -5, keepsClock: false, season: 'spring', noise: 0, oddDays: 0, drift: 0, weekendShift: 0, jitter: 0 };
  const withTerms = [];
  const without = [];
  for (let y = 2008; y <= 2025; y++) {
    const T = RT.transitions(y, 'new').spring;
    withTerms.push(stepFor({ ...o, T, seed: y }, {}).step);
    without.push(stepFor({ ...o, T, seed: y }, { weekday: false }).step);
  }
  assert.ok(Math.max(...withTerms.map(Math.abs)) < 0.5, `with: ${Math.max(...withTerms.map(Math.abs))}`);
  assert.ok(Math.abs(mean(without)) > 5, `without: ${mean(without)}`);
});

test('the robust fit shrugs off most days whose crest time is wild; plain least squares does not', () => {
  const r = rng(11);
  const robust = [];
  const plain = [];
  for (let trial = 0; trial < 200; trial++) {
    const T = RT.transitions(2010 + (trial % 15), 'new').spring;
    const days = [];
    for (let k = -14; k <= 14; k++) {
      if (!k) continue;
      days.push({ dn: T + k, A: 1, tau: 10 - (k > 0 ? 1 : 0) + 0.15 * gauss(r) });
    }
    // four days with an ordinary-sized wave at a random time (a fault, a test release...)
    for (let j = 0; j < 4; j++) days[Math.floor(r() * days.length)].tau = r() * 24;
    robust.push(Math.abs(RT.estimateStep(days, T).step + 60));
    plain.push(Math.abs(RT.estimateStep(days, T, { robust: false }).step + 60));
  }
  const q = (a, p) => [...a].sort((x, y) => x - y)[Math.floor(p * (a.length - 1))];
  // With 9-minute day-to-day scatter and nine coefficients from 28 days, a clean fit is good
  // to about 5 minutes; four wild days cost the robust fit a little and plain least squares a lot.
  assert.ok(q(robust, 0.5) < 10, `robust median ${q(robust, 0.5)}`);
  assert.ok(q(robust, 0.95) < 30, `robust 95th percentile ${q(robust, 0.95)}`);
  assert.ok(q(plain, 0.5) > 50, `plain median ${q(plain, 0.5)}`);
});

test('the estimator ignores the change-over Sunday and needs ten usable days a side', () => {
  const T = RT.transitions(2019, 'new').spring;
  const days = [];
  for (let k = -14; k <= 14; k++) days.push({ dn: T + k, A: 1, tau: k > 0 ? 9 : 10 });
  days.find((d) => d.dn === T).tau = 3; // garbage on the change-over day
  const est = RT.estimateStep(days, T);
  assert.ok(Math.abs(est.step + 60) < 1e-6);
  const thin = days.filter((d) => !(d.dn > T && d.dn <= T + 5));
  assert.equal(RT.estimateStep(thin, T), null);
});

test('crest times are unwrapped across midnight', () => {
  const T = RT.transitions(2020, 'new').fall;
  const days = [];
  for (let k = -14; k <= 14; k++) if (k) days.push({ dn: T + k, A: 1, tau: k > 0 ? 0.5 : 23.5 });
  assert.ok(Math.abs(RT.estimateStep(days, T).step - 60) < 1e-6);
});

test('Student t quantiles match tables', () => {
  assert.ok(Math.abs(RT.tQuantile(0.975, 1) - 12.7062) < 1e-3);
  assert.ok(Math.abs(RT.tQuantile(0.975, 10) - 2.228139) < 1e-5);
  assert.ok(Math.abs(RT.tQuantile(0.975, 17) - 2.109816) < 1e-5);
  assert.ok(Math.abs(RT.tQuantile(0.975, 30) - 2.042272) < 1e-5);
  assert.ok(Math.abs(RT.tQuantile(0.5, 7)) < 1e-6);
});

test('summaries and the decision rule', () => {
  const s = RT.summarize([58, 61, 60, 59, 62]);
  assert.equal(s.n, 5);
  assert.equal(s.mean, 60);
  assert.equal(RT.verdict(s), 'keeps clock time');
  assert.equal(RT.verdict(RT.summarize([55, 56, 55, 56, 55])), 'keeps clock time'); // within 10 min
  assert.equal(RT.verdict(RT.summarize([1, -2, 0, 2, -1])), 'keeps standard time');
  assert.equal(RT.verdict(RT.summarize([6, 7, 6, 7, 6])), 'keeps standard time');
  assert.equal(RT.verdict(RT.summarize([30, 31, 29, 30, 30])), 'keeps part of the hour');
  assert.equal(RT.verdict(RT.summarize([-40, 100, 20, 0, 60])), 'cannot tell');
  assert.equal(RT.verdict(RT.summarize([60])), 'cannot tell');
  assert.equal(RT.verdict(RT.summarize([-60, -61, -59])), 'moves the wrong way');
  assert.equal(RT.verdict(RT.summarize([90, 91, 89])), 'moves more than the hour');
});

test('the day and profile encodings round-trip to the stated precision', () => {
  const r = rng(3);
  for (let i = 0; i < 2000; i++) {
    const rec = { tau: r() * 24, A: 10 ** (r() * 8 - 3) };
    const back = RT.decodeDay(RT.encodeDay(rec), 0);
    const dt = ((((back.tau - rec.tau) % 24) + 36) % 24) - 12;
    assert.ok(Math.abs(dt) <= 24 / 4096 / 2 + 1e-12, `tau ${rec.tau} -> ${back.tau}`);
    assert.ok(Math.abs(Math.log10(back.A / rec.A)) <= 10 / 4096 / 2 + 1e-12);
  }
  assert.equal(RT.decodeDay(RT.encodeDay(null), 0), null);
  const prof = Array.from({ length: 24 }, (_, h) => Math.cos(RT.OMEGA * (h + 0.5 - 7)));
  const p = RT.decodeProfile(RT.encodeProfile(prof), 0);
  for (let h = 0; h < 24; h++) assert.ok(Math.abs(p[h] - prof[h]) <= 0.5 / 31 + 1e-12);
});

// ---------------------------------------------------------------- the second method

test('second method: rotating any daily profile by whole hours is recovered exactly', () => {
  const r = rng(21);
  for (let trial = 0; trial < 300; trial++) {
    const p = Array.from({ length: 24 }, () => r() - 0.5);
    p[Math.floor(r() * 24)] += 2;
    const d = Math.floor(r() * 7) - 3; // -3..3 hours
    const q = p.map((_, h) => p[(((h - d) % 24) + 24) % 24]); // q(t) = p(t - d): later by d
    assert.equal(RT.bestShift(p, q), 60 * d, `trial ${trial}`);
  }
});

// A peaking hydropower river: each weekday the dispatcher runs a morning block, an evening
// block, both, or neither, chosen at random; at weekends mostly nothing. Blocks start on the
// hour of the schedule's clock (plus a little jitter) and ramp over an hour.
function blockRiver({ T, offset, keepsClock, season, seed, mixShift = 0 }) {
  const r = rng(seed);
  const pts = [];
  const changeStd = (T * 24 + (season === 'fall' ? 1 : 2)) * 3600000;
  for (let d = T - 20; d <= T + 20; d++) {
    const dw = RT.dow(d);
    const weekend = dw === 0 || dw === 6;
    // later in the window the evening block becomes a little more likely (a seasonal change in
    // dispatch, which must not be read as a clock change)
    const pEve = Math.min(0.9, 0.5 + mixShift * (d - T) / 14);
    const morning = !weekend && r() < 0.6;
    const evening = !weekend && r() < pEve;
    const mStart = 6 + Math.floor(r() * 3) + 0.1 * gauss(r);
    const mLen = 3 + Math.floor(r() * 4);
    const eStart = 16 + Math.floor(r() * 3) + 0.1 * gauss(r);
    const eLen = 3 + Math.floor(r() * 4);
    for (let q = 0; q < 96; q++) {
      const stdHour = q / 4;
      const stdMs = (d * 24 + stdHour) * 3600000;
      const summer = season === 'spring' ? stdMs >= changeStd : stdMs < changeStd;
      const t = keepsClock && summer ? stdHour + 1 : stdHour;
      const ramp = (x) => Math.max(0, Math.min(1, x));
      let v = 600;
      if (morning) v += 4000 * ramp(t - mStart + 1) * ramp(mStart + mLen - t);
      if (evening) v += 4000 * ramp(t - eStart + 1) * ramp(eStart + eLen - t);
      v *= 1 + 0.01 * gauss(r);
      pts.push([stdMs - offset * 3600000, v]);
    }
  }
  return pts;
}

function profileStepFor(gen) {
  const s = RT.hourlyMeans(blockRiver(gen), gen.offset);
  const stats = RT.dailyStats(s);
  const h = RT.halfProfiles(stats, gen.T);
  return h.before && h.after ? RT.bestShift(h.before, h.after) : NaN;
}

function blockK({ keepsClock, mixSpring, mixFall, seeds }) {
  // K = (fall step - spring step)/2 per synthetic year, averaged over many years
  const Ks = [];
  for (const seed of seeds) {
    const y = 2008 + (seed % 18);
    const t = RT.transitions(y, 'new');
    const sp = profileStepFor({ T: t.spring, offset: -5, keepsClock, season: 'spring', seed, mixShift: mixSpring });
    const fa = profileStepFor({ T: t.fall, offset: -5, keepsClock, season: 'fall', seed: seed + 7777, mixShift: mixFall });
    Ks.push((fa - sp) / 2);
  }
  return mean(Ks);
}

test('second method on a block-dispatched hydropower river: K is about 60 for a clock-keeper and about 0 otherwise', () => {
  // One transition alone is rough (dispatch is random: about 45 min sd) but K over many years
  // is close, including when dispatch drifts the same way through both windows.
  const seeds = Array.from({ length: 150 }, (_, i) => i + 1);
  for (const mix of [0, 0.15]) {
    const kc = blockK({ keepsClock: true, mixSpring: mix, mixFall: mix, seeds });
    const ks = blockK({ keepsClock: false, mixSpring: mix, mixFall: mix, seeds });
    assert.ok(Math.abs(kc - 60) < 8, `mix ${mix}: clock-keeper K ${kc.toFixed(1)}`);
    assert.ok(Math.abs(ks) < 8, `mix ${mix}: sun-keeper K ${ks.toFixed(1)}`);
  }
});

test('a known weakness: dispatch that drifts one way in spring and the other in fall biases K', () => {
  // This is what the placebo windows are there to catch.
  const seeds = Array.from({ length: 150 }, (_, i) => i + 1);
  const ks = blockK({ keepsClock: false, mixSpring: 0.15, mixFall: -0.15, seeds });
  assert.ok(ks < -5 && ks > -30, `sun-keeper K ${ks.toFixed(1)}`);
});

test('the first method fails on the same block-dispatched river (why the second exists)', () => {
  let bad = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const T = RT.transitions(2008 + (seed % 18), 'new').spring;
    const s = RT.hourlyMeans(blockRiver({ T, offset: -5, keepsClock: true, season: 'spring', seed }), -5);
    const stats = RT.dailyStats(s);
    const days = [...stats].map(([dn, v]) => ({ dn, A: v.A, tau: v.tau }));
    const est = RT.estimateStep(days, T);
    if (!est || Math.abs(est.step + 60) > 60) bad++;
  }
  assert.ok(bad >= 15, `first method off by more than an hour in ${bad} of 60`);
});

// ---------------------------------------------------------------- added 24 Oct (plumbing)

test('added 24 Oct: a flat median day has no timing, so no step (it used to return -180)', () => {
  const flat = new Array(24).fill(0);
  const p = Array.from({ length: 24 }, (_, h) => Math.cos(RT.OMEGA * (h + 0.5 - 9)));
  assert.equal(RT.bestShift(flat, p), null);
  assert.equal(RT.bestShift(p, flat), null);
  assert.equal(RT.bestShift(p, p), 0);
  // and a stored record whose before side is flat gives no step at that centre
  const rec = RT.encodeCentre({ before: flat, after: p, nBefore: 9, nAfter: 12 });
  const T = RT.transitions(2015, 'new').spring;
  const centres = RT.centresForSite(false);
  const site = { law: false, centres: centres.map((c) => (c === T ? rec : RT.encodeCentre({ before: p, after: p, nBefore: 14, nAfter: 14 }))).join('') };
  assert.equal(RT.shiftAt(site, T), null);
  assert.equal(RT.shiftAt(site, T + 35).step, 0);
});

test('added 24 Oct: centre records round-trip at 12 bits and keep the day counts and coherence', () => {
  const r = rng(5);
  for (let i = 0; i < 300; i++) {
    const before = Array.from({ length: 24 }, () => gauss(r));
    const after = Array.from({ length: 24 }, () => gauss(r));
    const rec = RT.encodeCentre({ before, after, nBefore: 7 + (i % 8), nAfter: 14 - (i % 8) });
    assert.equal(rec.length, RT.RECORD_CHARS);
    const d = RT.decodeCentre(rec, 0);
    assert.equal(d.nBefore, 7 + (i % 8));
    assert.equal(d.nAfter, 14 - (i % 8));
    const mb = Math.max(...before.map(Math.abs));
    for (let h = 0; h < 24; h++) assert.ok(Math.abs(d.before[h] - before[h] / mb) <= 0.5 / 2047 + 1e-12);
    assert.ok(Math.abs(d.coherenceBefore - Math.min(63, Math.round(50 * RT.rmsOf(before))) / 50) < 1e-12);
  }
  const none = RT.decodeCentre(RT.encodeCentre({ before: null, after: null, nBefore: 3, nAfter: 0 }), 0);
  assert.equal(none.before, null);
  assert.equal(none.after, null);
  assert.equal(none.nBefore, 3);
});

test('added 24 Oct: the centre list holds every real and fake change the analyses use', () => {
  const plain = RT.centresForSite(false);
  const law = RT.centresForSite(true);
  assert.equal(plain.length, 18 * 2 * 3); // 2008-2025, spring and fall, real and +/-35 days
  assert.equal(law.length, 212); // plus old-rule dates 2008-2025 and both rules 1990-2006
  for (let i = 1; i < law.length; i++) assert.ok(law[i] > law[i - 1]);
  for (const y of RT.YEARS) for (const T of Object.values(RT.transitions(y, 'new'))) {
    assert.ok(plain.includes(T) && plain.includes(T - 35) && plain.includes(T + 35));
  }
  for (const y of RT.OLD_YEARS) for (const T of Object.values(RT.transitions(y, 'old'))) assert.ok(law.includes(T));
});

test('added 24 Oct: the crest and the mean-crossings of a sampled cosine are where they should be', () => {
  // (amended after review: the hourly values are now read as sitting at h + HOUR_CENTRE)
  for (const c of [0.5, 6.25, 13.9, 22.55]) {
    const p = Array.from({ length: 24 }, (_, h) => Math.cos(RT.OMEGA * (h + RT.HOUR_CENTRE - c)));
    const got = RT.crest(p);
    const d = ((got - c + 36) % 24) - 12;
    assert.ok(Math.abs(d) <= 1 / 60 + 1e-9, `crest ${c} -> ${got}`);
    const ev = RT.dayEvents(p);
    // a cosine crosses its mean upward 6 h before the crest
    const upExpect = Math.round((((c - 6) % 24) + 24) % 24 * 60);
    if (upExpect > 0 && upExpect < 1439) assert.ok(ev.up.some((m) => Math.abs(m - upExpect) <= 1), `up ${ev.up} vs ${upExpect}`);
  }
  // the smooth curve passes within rounding of the hourly values at the hour centres for a
  // profile with no 12-hour-alternating part
  const p = Array.from({ length: 24 }, (_, h) => Math.cos(RT.OMEGA * (h + RT.HOUR_CENTRE - 3)) + 0.4 * Math.sin(2 * RT.OMEGA * (h + RT.HOUR_CENTRE)));
  const curve = RT.smoothCurve(p, 7.5); // samples every 7.5 minutes: hour h + 0.375 is sample 8h + 3
  for (let h = 0; h < 24; h++) assert.ok(Math.abs(curve[8 * h + 3] - p[h]) < 1e-9);
});

test('added 24 Oct: number formatting', () => {
  assert.equal(RT.fmtMin(-3.54), '\u22123.5');
  assert.equal(RT.fmtMin(-0.04), '0.0');
  assert.equal(RT.fmtMin(12), '12.0');
  assert.equal(RT.fmtCI({ n: 18, mean: 5.36, lo: -22.78, hi: 33.51 }), '5.4 (95% interval \u221222.8 to 33.5)');
  assert.equal(RT.fmtCI({ n: 1, mean: 3 }), 'no estimate');
  assert.equal(RT.fmtClock(586), '09:46');
  assert.equal(RT.fmtClock(1440 + 61), '01:01');
  assert.equal(RT.fmtClock(-60), '23:00');
});

// ---------------------------------------------------------------- added after review (24 Oct)

test('added after review: clock times from hourly means of quarter-hour readings are not 7.5 minutes late', () => {
  // A river read every 15 minutes whose day rises through its mean at 09:40 and crests at 15:40
  // (MST), with a second harmonic, run through the same hourly means and residuals as the data.
  const up = 9 + 40 / 60;
  const day = (t) => Math.cos(RT.OMEGA * (t - up - 6)) + 0.3 * Math.cos(2 * RT.OMEGA * (t - up - 6));
  const T0 = Date.UTC(2015, 2, 1, 7); // 00:00 MST
  const pts = [];
  for (let q = 0; q < 10 * 96; q++) {
    const t = q / 4; // hours since T0
    pts.push([T0 + t * 3600000, 10000 + 2000 * day(t % 24)]);
  }
  const stats = RT.dailyStats(RT.hourlyMeans(pts, -7));
  const resid = [...stats.values()][4].resid;
  // where the smooth curve through the hourly values says the day rises and crests
  const truthUp = [...Array(1440).keys()].find((m) => day((m - 1) / 60) < 0 && day(m / 60) >= 0);
  const truthCrest = [...Array(1440).keys()].reduce((b, m) => (day(m / 60) > day(b / 60) ? m : b), 0);
  const ev = RT.dayEvents(resid);
  const gotUp = ev.up.find((m) => m >= 360 && m < 720);
  assert.ok(Math.abs(gotUp - truthUp) <= 1, `up-crossing ${gotUp} vs ${truthUp}`);
  assert.ok(Math.abs(ev.high - truthCrest) <= 1, `crest ${ev.high} vs ${truthCrest}`);
  assert.ok(Math.abs(RT.crest(resid) * 60 - truthCrest) <= 1);
  // placed at the half hour, as the first version did, every time comes out 7 or 8 minutes late
  const old = RT.smoothCurve(resid, 1, 0.5);
  const oldUp = [...Array(1440).keys()].find((m) => m >= 360 && old[m - 1] < 0 && old[m] >= 0);
  assert.ok(oldUp - truthUp >= 7 && oldUp - truthUp <= 8, `old placement ${oldUp} vs ${truthUp}`);
  // and steps do not depend on the placement: two days a known shift apart give the same step
  const a = Array.from({ length: 24 }, (_, h) => day(h + 0.375));
  const b = Array.from({ length: 24 }, (_, h) => day(h + 0.375 - 0.7));
  assert.equal(RT.bestShift(a, b), 42);
});

test('added after review: the old and new fall dates are always exactly a week apart; the spring dates three or four weeks', () => {
  for (let y = 1987; y <= 2040; y++) {
    const o = RT.transitions(y, 'old');
    const n = RT.transitions(y, 'new');
    assert.equal(n.fall - o.fall, 7, `${y}`);
    assert.ok(o.spring - n.spring === 21 || o.spring - n.spring === 28, `${y}`);
  }
});

test('added after review: in the law-change comparison a river that keeps clock time scores well short of 60, one that keeps standard time 0', () => {
  // a two-peaked synthetic day, not river data
  const shape = Array.from({ length: 24 }, (_, h) => Math.cos(RT.OMEGA * (h + 0.5 - 20)) + 0.6 * Math.cos(2 * RT.OMEGA * (h + 0.5 - 9)));
  for (const noise of [0.05, 0.2, 0.5]) {
    const c = RT.simulateClockKeeper({ spring: shape, fall: shape }, { noise, reps: 3, seed: 11 });
    assert.ok(c.atNew.mean > 40 && c.atNew.mean < 50, `noise ${noise}: new dates ${c.atNew.mean}`);
    assert.ok(c.atOld.mean > 28 && c.atOld.mean < 50, `noise ${noise}: old dates ${c.atOld.mean}`);
    // the overlap: the fall step at the date that was not a change date is far from 0
    assert.ok(c.fallOldAtNew.mean > 15 && c.fallNewAtOld.mean > 15);
    const z = RT.simulateClockKeeper({ spring: shape, fall: shape }, { noise, reps: 3, seed: 11, keepsClock: false });
    assert.ok(Math.abs(z.atNew.mean) < 2 && Math.abs(z.atOld.mean) < 2, `standard time: ${z.atNew.mean}, ${z.atOld.mean}`);
  }
  // seeded: the same numbers every run
  const a = RT.simulateClockKeeper({ spring: shape, fall: shape }, { reps: 2, seed: 5 });
  const b = RT.simulateClockKeeper({ spring: shape, fall: shape }, { reps: 2, seed: 5 });
  assert.equal(a.atNew.mean, b.atNew.mean);
  assert.equal(a.atOld.mean, b.atOld.mean);
});
