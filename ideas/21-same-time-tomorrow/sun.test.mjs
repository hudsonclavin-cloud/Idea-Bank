// Verification for Same Time Tomorrow. From the repo root:
//   node --test ideas/21-same-time-tomorrow/sun.test.mjs
// Every check compares sun.js against something it does not share code with: closed forms,
// an independent NOAA/Meeus implementation written below, Allison & McEwen's Mars series,
// or published values (USNO, EarthSky, the epoch-2000 equation-of-time table).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const S = createRequire(import.meta.url)('./sun.js');
const log = (...a) => console.log('   ', ...a);
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const wrap360 = (x) => ((x % 360) + 360) % 360;
const sin = (deg) => Math.sin(deg * RAD);
const cos = (deg) => Math.cos(deg * RAD);
const tan = (deg) => Math.tan(deg * RAD);
const dateStr = (o) => `${o.year}-${String(o.month).padStart(2, '0')}-${String(Math.floor(o.day)).padStart(2, '0')}`;
const dayIndex = (year, month, day) => S.daysSinceJ2000(year, month, day, 0) - S.daysSinceJ2000(year, 1, 1, 0);

// ---------- an independent reference: the NOAA solar calculator (Meeus-based series) ----------
// Formulation: polynomial mean elements, a 3-term series for the equation of centre, nutation
// via the lunar node Ω, true obliquity, and the classical 5-term series for the equation of time.
// sun.js instead solves Kepler's equation with fixed J2000 elements plus linear drift, so the
// two share no formulas beyond the J2000 constants.
function noaa(jd, lat, lonEast, zone) {
  const T = (jd - 2451545) / 36525;
  const L0 = wrap360(280.46646 + T * (36000.76983 + 0.0003032 * T));
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = sin(M) * (1.914602 - T * (0.004817 + 0.000014 * T)) + sin(2 * M) * (0.019993 - 0.000101 * T) + sin(3 * M) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const appLong = trueLong - 0.00569 - 0.00478 * sin(omega);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * cos(omega);
  const decl = Math.asin(sin(eps) * sin(appLong)) * DEG;
  const y = tan(eps / 2) ** 2;
  const eotMin = 4 * DEG * (y * sin(2 * L0) - 2 * e * sin(M) + 4 * e * y * sin(M) * cos(2 * L0) - 0.5 * y * y * sin(4 * L0) - 1.25 * e * e * sin(2 * M));
  const x = cos(90.833) / (cos(lat) * cos(decl)) - tan(lat) * tan(decl);
  const ha = Math.abs(x) <= 1 ? Math.acos(x) * DEG : NaN;
  const noon = 720 - 4 * lonEast - eotMin + 60 * zone; // minutes after local midnight
  return { eotMin, decl, appLong, noon, rise: noon - 4 * ha, set: noon + 4 * ha };
}

/** NOAA rise/set with a second pass at the event itself (the spreadsheet evaluates at noon only). */
function noaaRiseSet(year, month, day, lat, lonEast, zone) {
  const jd0 = S.daysSinceJ2000(year, month, day, 0) + 2451545 - zone / 24; // local midnight
  const first = noaa(jd0 + 0.5, lat, lonEast, zone);
  const rise = noaa(jd0 + first.rise / 1440, lat, lonEast, zone).rise;
  const set = noaa(jd0 + first.set / 1440, lat, lonEast, zone).set;
  return { rise: rise / 60, set: set / 60, noon: noaa(jd0 + first.noon / 1440, lat, lonEast, zone).noon / 60 };
}

// ---------- calendar ----------

test('Julian day conversion matches Meeus examples and round-trips', () => {
  assert.equal(S.daysSinceJ2000(2000, 1, 1, 12), 0);
  assert.ok(Math.abs(S.daysSinceJ2000(1957, 10, 4, 0.81 * 24) + 2451545 - 2436116.31) < 1e-6); // Meeus 7.a (Sputnik 1)
  assert.equal(S.daysSinceJ2000(2026, 10, 22, 0) + 2451545, 2461335.5);
  for (const [y, m, d] of [[2026, 1, 1], [2026, 2, 28], [2024, 2, 29], [1999, 12, 31], [2100, 3, 1]]) {
    const back = S.dateFromDays(S.daysSinceJ2000(y, m, d, 6));
    assert.deepEqual([back.year, back.month, Math.floor(back.day)], [y, m, d]);
    assert.ok(Math.abs(back.day - d - 0.25) < 1e-9);
  }
  assert.equal(S.daysInYear(2024), 366);
  assert.equal(S.daysInYear(2100), 365);
  assert.equal(S.daysInYear(2000), 366);
});

// ---------- Kepler and the equation of centre ----------

test("Kepler's equation is solved to 1e-12 for e from 0 to 0.9", () => {
  let worst = 0;
  for (const e of [0, 0.0167, 0.0934, 0.3, 0.5, 0.9]) {
    for (let M = 0; M < 360; M += 7) {
      const E = S.solveKepler(M * RAD, e);
      worst = Math.max(worst, Math.abs(E - e * Math.sin(E) - M * RAD));
    }
  }
  log('max Kepler residual', worst.toExponential(2), 'rad');
  assert.ok(worst < 1e-12);
});

test('equation of centre matches the third-order series (Earth) and is exactly zero for a circle', () => {
  const e = 0.016708634;
  let worst = 0;
  for (let M = 0; M < 360; M += 1) {
    const got = S.sunAt({ e, obl: 0, peri: 0 }, M).C;
    const series = DEG * ((2 * e - e ** 3 / 4) * sin(M) + (5 / 4) * e * e * sin(2 * M) + (13 / 12) * e ** 3 * sin(3 * M));
    worst = Math.max(worst, Math.abs(got - series));
    assert.ok(Math.abs(S.sunAt({ e: 0, obl: 0, peri: 0 }, M).C) < 1e-9);
  }
  log('max |C − series|', worst.toExponential(2), 'deg (fourth-order term is ~5e-6°)');
  assert.ok(worst < 1e-5);
});

// ---------- the two causes, each with the other switched off ----------

test('tilt-only equation of time has the closed-form amplitude 4·(90° − 2·atan√cos ε) = 9.867 min', () => {
  const obl = 23.4392911;
  const el = { e: 0, obl, peri: 282.9 };
  let amp = 0;
  for (let L = 0; L < 360; L += 0.05) amp = Math.max(amp, Math.abs(S.sunAt(el, L).eotMin));
  const closed = 4 * (90 - 2 * Math.atan(Math.sqrt(cos(obl))) * DEG);
  log('tilt-only amplitude', amp.toFixed(4), 'min; closed form', closed.toFixed(4));
  assert.ok(Math.abs(amp - closed) < 2e-3);
  assert.ok(Math.abs(closed - 9.867) < 0.002);
  // Zero at the equinoxes and solstices; ±amplitude near L = 46° and 136°.
  for (const L of [0, 90, 180, 270]) assert.ok(Math.abs(S.sunAt(el, L).eot) < 1e-9);
  // The extremum sits where sin²L = 1/(1 + cos ε), i.e. L = 46.23° (sundial fast, early May) and by the
  // 180° symmetry at 133.77° (sundial slow, early August).
  assert.ok(Math.abs(S.sunAt(el, 46.23).eotMin - closed) < 0.01);
  assert.ok(Math.abs(S.sunAt(el, 133.77).eotMin + closed) < 0.01);
});

test('orbit-only equation of time is minus the equation of centre, amplitude 2e rad = 7.66 min', () => {
  const e = 0.016708634;
  const el = { e, obl: 0, peri: 282.9 };
  let amp = 0;
  for (let L = 0; L < 360; L += 0.05) {
    const s = S.sunAt(el, L);
    assert.ok(Math.abs(s.eot + s.C) < 1e-12);
    amp = Math.max(amp, Math.abs(s.eotMin));
  }
  const leading = 4 * DEG * 2 * e;
  log('orbit-only amplitude', amp.toFixed(4), 'min; 2e in minutes', leading.toFixed(4));
  assert.ok(Math.abs(amp - leading) < 0.01);
  assert.ok(Math.abs(S.sunAt(el, el.peri).eot) < 1e-12, 'zero at perihelion');
  assert.ok(Math.abs(S.sunAt(el, el.peri + 180).eot) < 1e-12, 'zero at aphelion');
});

test('the two causes add up to the total to within the ~0.7 min cross term', () => {
  const el = S.PRESETS.earth;
  let worst = 0;
  for (let L = 0; L < 360; L += 0.5) {
    const p = S.eotParts(el, L);
    worst = Math.max(worst, Math.abs(p.tilt + p.orbit - p.total) * 4);
  }
  log('max |tilt + orbit − total|', worst.toFixed(3), 'min');
  assert.ok(worst < 0.7);
  assert.ok(worst > 0.3, 'the cross term is real, not zero');
});

// ---------- Earth against the independent NOAA formulation ----------

test('equation of time and declination agree with NOAA/Meeus to 6 s and 0.01° on every day of 2000–2050', () => {
  let worstEot = 0;
  let worstDec = 0;
  let worstDay = null;
  for (let d = S.daysSinceJ2000(2000, 1, 1, 12); d <= S.daysSinceJ2000(2050, 12, 31, 12); d += 1) {
    const mine = S.sunOnDay('earth', d);
    const ref = noaa(d + 2451545, 0, 0, 0);
    const de = Math.abs(mine.eotMin - ref.eotMin) * 60;
    const dd = Math.abs(mine.delta - ref.decl);
    if (de > worstEot) {
      worstEot = de;
      worstDay = dateStr(S.dateFromDays(d));
    }
    worstDec = Math.max(worstDec, dd);
  }
  log('max |ΔEoT|', worstEot.toFixed(2), 's (on', worstDay + '); max |Δδ|', worstDec.toFixed(4), '°');
  assert.ok(worstEot < 6);
  assert.ok(worstDec < 0.01);
});

test('sunrise, noon and sunset agree with NOAA (event-time pass) to 15 s across latitudes and the year', () => {
  let worst = 0;
  let where = '';
  for (const lat of [-60, -40, -20, 0, 20, 40, 52, 60, 65]) {
    for (let i = 0; i < 365; i += 5) {
      const { month, day } = S.dateFromDays(S.daysSinceJ2000(2026, 1, 1, 0) + i);
      const a = S.riseSet('earth', 2026, month, Math.floor(day), lat, -3.7, 1);
      const b = noaaRiseSet(2026, month, Math.floor(day), lat, -3.7, 1);
      if (a.polar || Number.isNaN(b.rise)) continue;
      for (const k of ['rise', 'set', 'noon']) {
        const diff = Math.abs(a[k] - b[k]) * 3600;
        if (diff > worst) {
          worst = diff;
          where = `${k} lat ${lat} on 2026-${month}-${Math.floor(day)}`;
        }
      }
    }
  }
  log('max |Δ|', worst.toFixed(1), 's at', where);
  assert.ok(worst < 15);
});

test('at the computed sunrise and sunset the Sun really is at −0.8333° altitude', () => {
  let worst = 0;
  for (const lat of [-50, 0, 35, 60]) {
    for (let i = 3; i < 365; i += 23) {
      const { month, day } = S.dateFromDays(S.daysSinceJ2000(2026, 1, 1, 0) + i);
      const r = S.riseSet('earth', 2026, month, Math.floor(day), lat, 10, 2);
      if (r.polar) continue;
      for (const t of [r.rise, r.set]) {
        const p = S.sunInSky('earth', 2026, month, Math.floor(day), t, lat, 10, 2);
        worst = Math.max(worst, Math.abs(p.alt - S.RISE_SET_ALT));
      }
      const n = S.sunInSky('earth', 2026, month, Math.floor(day), r.noon, lat, 10, 2);
      assert.ok(Math.abs(n.H) < 1e-4, 'hour angle is zero at solar noon (1e-4° = 0.024 s)');
    }
  }
  log('max |alt + 0.8333°| at rise/set', worst.toExponential(2), '°');
  assert.ok(worst < 1e-3);
});

// ---------- published values ----------

test('equation of time extremes: −14.25 min on Feb 11/12 and +16.42 min on Nov 3 (epoch-2000 table; EarthSky 2020)', () => {
  const y2000 = S.eotExtremes('earth', 2000);
  log('2000:', y2000.min.minutes.toFixed(2), 'min on', dateStr(y2000.min), '|', y2000.max.minutes.toFixed(2), 'min on', dateStr(y2000.max));
  assert.ok(Math.abs(y2000.min.minutes - -14.25) < 0.1); // table: −14 min 15 s on 11 February
  assert.ok(Math.abs(y2000.max.minutes - 16.42) < 0.1); // table: +16 min 25 s on 3 November
  assert.equal(y2000.min.month, 2);
  assert.ok(Math.floor(y2000.min.day) >= 10 && Math.floor(y2000.min.day) <= 12);
  assert.equal(y2000.max.month, 11);
  assert.ok(Math.floor(y2000.max.day) >= 2 && Math.floor(y2000.max.day) <= 4);
  const y2020 = S.eotExtremes('earth', 2020);
  log('2020:', y2020.min.minutes.toFixed(2), 'min on', dateStr(y2020.min), '|', y2020.max.minutes.toFixed(2), 'min on', dateStr(y2020.max));
  assert.ok(Math.abs(y2020.min.minutes - -14.24) < 0.1); // EarthSky: −14.24 min on Feb 11, 2020
  assert.ok(Math.abs(y2020.max.minutes - 16.49) < 0.1); // EarthSky: +16.49 min on Nov 2, 2020
  assert.equal(y2020.min.month, 2);
  assert.ok(Math.floor(y2020.min.day) >= 10 && Math.floor(y2020.min.day) <= 12);
  assert.equal(y2020.max.month, 11);
  assert.ok(Math.floor(y2020.max.day) >= 1 && Math.floor(y2020.max.day) <= 3);
});

test('2026 equinoxes and solstices land within 15 min of the USNO times (no nutation in the model)', () => {
  const sp = S.seasonPoints('earth', 2026);
  const usno = {
    marchEquinox: [2026, 3, 20, 14 + 46 / 60],
    juneSolstice: [2026, 6, 21, 8 + 24 / 60],
    septemberEquinox: [2026, 9, 23, 0 + 5 / 60],
    decemberSolstice: [2026, 12, 21, 20 + 50 / 60],
  };
  for (const [k, [y, m, d, h]] of Object.entries(usno)) {
    const ref = S.daysSinceJ2000(y, m, d, h);
    const diffMin = (sp[k].d - ref) * 1440;
    log(k, dateStr(sp[k]), S.hoursToHM((sp[k].day % 1) * 24), 'UT; USNO', `${m}/${d}`, S.hoursToHM(h), '→ Δ', diffMin.toFixed(1), 'min');
    assert.ok(Math.abs(diffMin) < 15);
  }
});

test('solstice declinations are ±ε and the equinox declination is zero', () => {
  const sp = S.seasonPoints('earth', 2026);
  const epsAt = (d) => S.earthElements(d / 36525).obl;
  assert.ok(Math.abs(S.sunOnDay('earth', sp.juneSolstice.d).delta - epsAt(sp.juneSolstice.d)) < 1e-6);
  assert.ok(Math.abs(S.sunOnDay('earth', sp.decemberSolstice.d).delta + epsAt(sp.decemberSolstice.d)) < 1e-6);
  assert.ok(Math.abs(S.sunOnDay('earth', sp.marchEquinox.d).delta) < 1e-6);
  assert.ok(Math.abs(epsAt(sp.juneSolstice.d) - 23.436) < 0.001, 'mean obliquity in 2026 is 23.436°');
});

test('40°N: earliest sunset Dec 6–9, latest sunrise Jan 3–6, shortest day Dec 21 (USNO FAQ: "around Dec 8" and "around Jan 5")', () => {
  const table = S.yearRiseSet('earth', 2026, 40, 0, 0);
  const ex = S.riseSetExtremes(table);
  const f = (r, k) => `${r.month}/${r.day} ${S.hoursToHM(r[k])}`;
  log('earliest sunset', f(ex.earliestSunset, 'set'), '| shortest day', `${ex.shortestDay.month}/${ex.shortestDay.day}`, ex.shortestDay.length.toFixed(3), 'h', '| latest sunrise', f(ex.latestSunrise, 'rise'));
  log('earliest sunrise', f(ex.earliestSunrise, 'rise'), '| longest day', `${ex.longestDay.month}/${ex.longestDay.day}`, '| latest sunset', f(ex.latestSunset, 'set'));
  assert.equal(ex.earliestSunset.month, 12);
  assert.ok(ex.earliestSunset.day >= 6 && ex.earliestSunset.day <= 9);
  assert.equal(ex.latestSunrise.month, 1);
  assert.ok(ex.latestSunrise.day >= 3 && ex.latestSunrise.day <= 6);
  assert.deepEqual([ex.shortestDay.month, ex.shortestDay.day], [12, 21]);
  assert.deepEqual([ex.longestDay.month, ex.longestDay.day], [6, 21]);
  assert.ok(Math.abs(ex.shortestDay.length - 9.33) < 0.05, 'shortest day about 9 h 20 min');
  assert.equal(ex.earliestSunrise.month, 6);
  assert.ok(ex.earliestSunrise.day >= 12 && ex.earliestSunrise.day <= 15);
  assert.equal(ex.latestSunset.month, 6);
  assert.ok(ex.latestSunset.day >= 25 && ex.latestSunset.day <= 29);
  // NOAA agrees on the dates.
  let best = null;
  for (let i = 0; i < 365; i++) {
    const { month, day } = S.dateFromDays(S.daysSinceJ2000(2026, 1, 1, 0) + i);
    const r = noaaRiseSet(2026, month, Math.floor(day), 40, 0, 0);
    if (!best || r.set < best.set) best = { month, day: Math.floor(day), set: r.set };
  }
  log('NOAA earliest sunset at 40°N:', `${best.month}/${best.day}`, S.hoursToHM(best.set));
  assert.equal(best.month, 12);
  assert.ok(Math.abs(best.day - ex.earliestSunset.day) <= 1);
});

test('on the equator the extremes follow the equation of time: earliest sunset ≈ Nov 3, latest sunrise ≈ Feb 11', () => {
  const ex = S.riseSetExtremes(S.yearRiseSet('earth', 2026, 0, 0, 0));
  const eot = S.eotExtremes('earth', 2026);
  const dEarliestSet = dayIndex(2026, ex.earliestSunset.month, ex.earliestSunset.day);
  const dLatestRise = dayIndex(2026, ex.latestSunrise.month, ex.latestSunrise.day);
  const dEotMax = dayIndex(2026, eot.max.month, Math.floor(eot.max.day));
  const dEotMin = dayIndex(2026, eot.min.month, Math.floor(eot.min.day));
  log('equator: earliest sunset', `${ex.earliestSunset.month}/${ex.earliestSunset.day}`, '(EoT max', `${eot.max.month}/${Math.floor(eot.max.day)})`, '| latest sunrise', `${ex.latestSunrise.month}/${ex.latestSunrise.day}`, '(EoT min', `${eot.min.month}/${Math.floor(eot.min.day)})`);
  assert.ok(Math.abs(dEarliestSet - dEotMax) <= 2);
  assert.ok(Math.abs(dLatestRise - dEotMin) <= 2);
  const lengths = S.yearRiseSet('earth', 2026, 0, 0, 0).map((r) => r.length);
  const spread = (Math.max(...lengths) - Math.min(...lengths)) * 60;
  log('equator day-length spread over the year', spread.toFixed(2), 'min');
  assert.ok(spread < 2.5 && spread > 0.5, 'day length is almost constant on the equator (refraction term only)');
});

test('the offset from the solstice shrinks toward the pole and swaps hemispheres', () => {
  const offsetDays = (lat) => {
    const ex = S.riseSetExtremes(S.yearRiseSet('earth', 2026, lat, 0, 0));
    const es = ex.earliestSunset;
    const sd = ex.shortestDay;
    return dayIndex(2026, sd.month, sd.day) - dayIndex(2026, es.month, es.day);
  };
  const o40 = offsetDays(40);
  const o52 = offsetDays(52);
  const o60 = offsetDays(60);
  log('shortest day minus earliest sunset: 40°N', o40, 'days; 52°N', o52, '; 60°N', o60);
  assert.ok(o40 > o52 && o52 > o60 && o60 >= 3);
  const south = S.riseSetExtremes(S.yearRiseSet('earth', 2026, -34, 0, 0));
  log('34°S: shortest day', `${south.shortestDay.month}/${south.shortestDay.day}`, 'earliest sunset', `${south.earliestSunset.month}/${south.earliestSunset.day}`, 'latest sunrise', `${south.latestSunrise.month}/${south.latestSunrise.day}`);
  assert.deepEqual([south.shortestDay.month, south.shortestDay.day], [6, 21]);
  assert.equal(south.earliestSunset.month, 6);
  assert.ok(south.earliestSunset.day < 21);
  assert.equal(south.latestSunrise.month, 6);
  assert.ok(south.latestSunrise.day > 21);
});

test('polar cases: midnight sun and polar night are flagged, not computed as nonsense', () => {
  const summer = S.riseSet('earth', 2026, 6, 21, 70, 0, 0);
  const winter = S.riseSet('earth', 2026, 12, 21, 70, 0, 0);
  assert.equal(summer.polar, 'day');
  assert.equal(winter.polar, 'night');
  assert.equal(summer.length, 24);
  assert.equal(winter.length, 0);
  const spring = S.riseSet('earth', 2026, 3, 20, 70, 0, 0);
  assert.equal(spring.polar, null);
  assert.ok(spring.length > 11.5 && spring.length < 13);
});

// ---------- the sky ----------

test('altitude at solar noon is 90° − |φ − δ| and the Sun is due south (north) of a northern (southern) observer', () => {
  for (const lat of [-40, 0, 25, 60]) {
    for (let i = 7; i < 365; i += 41) {
      const { month, day } = S.dateFromDays(S.daysSinceJ2000(2026, 1, 1, 0) + i);
      const r = S.riseSet('earth', 2026, month, Math.floor(day), lat, 0, 0);
      const p = S.sunInSky('earth', 2026, month, Math.floor(day), r.noon, lat, 0, 0);
      assert.ok(Math.abs(p.alt - (90 - Math.abs(lat - p.delta))) < 1e-6);
      const expectedAz = lat > p.delta ? 180 : 0;
      assert.ok(Math.abs(S.wrap180(p.az - expectedAz)) < 1e-6, `az ${p.az} lat ${lat}`);
    }
  }
  // Morning Sun is east of the meridian, afternoon Sun west.
  const am = S.sunInSky('earth', 2026, 10, 22, 9, 40, 0, 0);
  const pm = S.sunInSky('earth', 2026, 10, 22, 15, 40, 0, 0);
  assert.ok(am.az > 90 && am.az < 180 && pm.az > 180 && pm.az < 270);
});

test('a year at one clock time gives one point per day, and at noon the figure is 2ε tall and (EoT range)/4 wide', () => {
  const pts = S.skyFigure('earth', 2026, 12, 40, 0, 0);
  assert.equal(pts.length, 365);
  const alts = pts.map((p) => p.alt);
  const height = Math.max(...alts) - Math.min(...alts);
  const eots = pts.map((p) => p.eotMin);
  const width = (Math.max(...eots) - Math.min(...eots)) / 4;
  log('noon figure at 40°N: height', height.toFixed(2), '° (2ε = 46.87), EoT span', (width * 4).toFixed(1), 'min →', width.toFixed(2), '° of azimuth-ish');
  assert.ok(Math.abs(height - 2 * 23.436) < 0.05);
  assert.ok(Math.abs(width * 4 - 30.65) < 0.3);
  assert.ok(pts.every((p) => p.alt > 0), 'at 40°N the noon Sun is always up');
  const night = S.skyFigure('earth', 2026, 5, 40, 0, 0);
  assert.ok(night.some((p) => p.alt < 0) && night.some((p) => p.alt > 0), 'at 05:00 the Sun is up on some days and down on others');
});

test('the time zone is only a clock label: 10:00 UTC and 11:00 UTC+1 at the same place give the same sky', () => {
  const a = S.sunInSky('earth', 2026, 4, 1, 10, 48, 15, 0);
  const b = S.sunInSky('earth', 2026, 4, 1, 11, 48, 15, 1);
  assert.ok(Math.abs(a.alt - b.alt) < 1e-9 && Math.abs(a.az - b.az) < 1e-9);
  // Moving 15° east at the same UT instant moves the Sun 15° west in the sky (hour angle grows by 15°).
  const c = S.sunInSky('earth', 2026, 4, 1, 10, 48, 30, 0);
  assert.ok(Math.abs(c.H - a.H - 15) < 1e-9);
  const noonNY = S.riseSet('earth', 2026, 10, 22, 40.7128, -74.006, -4).noon;
  log('New York solar noon on 2026-10-22 (EDT):', S.hoursToHM(noonNY), '= 12:00 + 56.0 min (14.0° west of 60°W) − 15.6 min (EoT)');
  assert.ok(Math.abs(noonNY - (12 + 56.02 / 60 - 15.6 / 60)) < 0.5 / 60);
});

// ---------- other worlds ----------

test('Mars: equation of time matches Allison & McEwen (2000) to 0.01° and the figure is a teardrop', () => {
  const el = S.PRESETS.mars;
  let worst = 0;
  for (let L = 0; L < 360; L += 0.5) {
    const s = S.sunAt(el, L);
    const M = s.M;
    const vMinusM = 10.691 * sin(M) + 0.623 * sin(2 * M) + 0.05 * sin(3 * M) + 0.005 * sin(4 * M) + 0.0005 * sin(5 * M);
    const Ls = L + vMinusM;
    const eotAM = 2.861 * sin(2 * Ls) - 0.071 * sin(4 * Ls) + 0.002 * sin(6 * Ls) - vMinusM;
    worst = Math.max(worst, Math.abs(S.wrap180(s.eot - eotAM)));
  }
  log('max |EoT − Allison&McEwen|', worst.toFixed(4), '°');
  assert.ok(worst < 0.01);
  const pts = S.shape(el, 720);
  const xs = pts.map((p) => p.x);
  log('Mars EoT range', Math.min(...xs).toFixed(1), 'to', Math.max(...xs).toFixed(1), 'minutes of a sol; self-crossings', S.selfCrossings(pts));
  assert.equal(S.selfCrossings(pts), 0);
  assert.ok(Math.min(...xs) < -50 && Math.max(...xs) > 39);
});

test('Earth is a figure-8 (one crossing), a circular orbit still is, no tilt is a flat line, Saturn crosses, Jupiter (3° tilt) does not', () => {
  assert.equal(S.selfCrossings(S.shape(S.PRESETS.earth, 720)), 1);
  assert.equal(S.selfCrossings(S.shape(S.PRESETS.circular, 720)), 1);
  assert.equal(S.selfCrossings(S.shape(S.PRESETS.untilted, 720)), 0);
  assert.ok(S.shape(S.PRESETS.untilted, 100).every((p) => Math.abs(p.y) < 1e-12));
  assert.equal(S.selfCrossings(S.shape(S.PRESETS.saturn, 720)), 1);
  // With ε = 3.13° the tilt term is worth 0.17 min against 22 min from e = 0.049: an eccentricity-dominated loop.
  assert.equal(S.selfCrossings(S.shape(S.PRESETS.jupiter, 720)), 0);
  // The crossing disappears exactly when the tilt term can no longer beat the orbit term: sweep e at Earth's tilt.
  let firstLoop = null;
  for (let e = 0; e <= 0.2; e += 0.002) {
    const n = S.selfCrossings(S.shape({ e, obl: 23.4392911, peri: 282.9 }, 720));
    if (n === 0 && firstLoop === null) firstLoop = e;
    if (n > 1) assert.fail(`more than one crossing at e = ${e}`);
  }
  log('at Earth tilt and perihelion, the figure-8 becomes a single loop from e ≈', firstLoop.toFixed(3));
  assert.ok(firstLoop > 0.03 && firstLoop < 0.1);
});

test('the perihelion date of the Earth preset is early January', () => {
  const year = 2026;
  const el = S.earthElements(0.268);
  const d0 = S.daysSinceJ2000(year, 1, 1, 0);
  let best = null;
  for (let i = 0; i < 365; i++) {
    const diff = Math.abs(S.wrap180(S.meanLongitude(d0 + i + 0.5) - el.peri));
    if (!best || diff < best.diff) best = { diff, i };
  }
  const { month, day } = S.dateFromDays(d0 + best.i);
  log('perihelion (mean elements) on', `${month}/${Math.floor(day)}`, year);
  assert.equal(month, 1);
  assert.ok(day >= 2 && day < 6);
});
