/*
 * sun.js — where the Sun is, from the ground, as a function of date and clock time.
 * Pure and DOM-free. Works as a classic browser script (globalThis.SunModel, so index.html
 * opens straight from disk) and as a CommonJS module for the node:test suite.
 *
 * MODEL
 *   A planet on a fixed Kepler ellipse (eccentricity e), spin axis tilted by the obliquity ε,
 *   with the Sun's apparent ecliptic longitude at perihelion = peri. For a mean longitude L
 *   (degrees; 0 at the March equinox, advancing uniformly) we compute
 *     M       = L − peri                         mean anomaly
 *     E       : E − e·sin E = M                  Kepler's equation (Newton's method)
 *     ν       = 2·atan2(√(1+e)·sin E/2, √(1−e)·cos E/2)   true anomaly
 *     C       = ν − M                            equation of centre
 *     λ       = L + C (+ aberration)             the Sun's apparent ecliptic longitude
 *     α       = atan2(cos ε·sin λ, cos λ)        right ascension
 *     δ       = asin(sin ε·sin λ)                declination
 *     EoT     = (L + aberration) − α             equation of time, degrees; ×4 gives minutes
 *   Sign convention: EoT = apparent solar time − mean solar time, so EoT > 0 means a sundial
 *   reads *ahead* of the clock (early November: about +16 min).
 *
 * EARTH
 *   Elements at J2000.0 with their secular rates, from Meeus, Astronomical Algorithms, ch. 22 & 25
 *   (T = Julian centuries from J2000.0 = days/36525):
 *     mean longitude  L  = 280.46646 + 36000.76983·T + 0.0003032·T²
 *     mean anomaly    M  = 357.52911 + 35999.05029·T − 0.0001537·T²
 *     eccentricity    e  = 0.016708634 − 0.000042037·T
 *     mean obliquity  ε  = 23.4392911° − 0.0130042°·T   (23°26′21.448″ − 46.815″·T)
 *     so peri = L − M    = 282.93735° + 1.71954°·T
 *   The constant aberration −0.00569° (−20.5″) is applied to λ, as Meeus does for the
 *   "apparent" Sun. Nutation (±17″ in longitude, up to ±1 s of time) is NOT modelled.
 *   Mean solar time = UT (UT1 − UTC < 0.9 s is ignored), so the mean Sun's Greenwich hour
 *   angle is 15°·(UT − 12 h), by definition.
 *
 * SIMPLIFICATIONS: no nutation, no planetary perturbations (< 0.02° in λ, i.e. ≤ 5 s of
 *   time), no lunar wobble of the Earth around the Earth–Moon barycentre (≈ 6″), standard
 *   atmospheric refraction of 34′ at the horizon and no refraction elsewhere, the Sun's
 *   semi-diameter taken as 16′ (so rise/set is when the centre is at −50′ = −0.8333°).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SunModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const RAD = Math.PI / 180;
  const DEG = 180 / Math.PI;
  const wrap360 = (x) => ((x % 360) + 360) % 360;
  const wrap180 = (x) => {
    const y = wrap360(x);
    return y > 180 ? y - 360 : y;
  };
  const RISE_SET_ALT = -0.8333; // degrees: 34′ refraction + 16′ semi-diameter

  // ---------- orbital elements ----------

  /** Earth's elements at T Julian centuries from J2000.0 (Meeus ch. 25 / 22). */
  function earthElements(T = 0) {
    return {
      name: 'Earth',
      e: 0.016708634 - 0.000042037 * T,
      obl: 23.4392911 - 0.0130042 * T,
      peri: wrap360(282.93735 + 1.71954 * T),
      aberr: -0.00569,
    };
  }

  /** Other worlds (shape only: the page keeps Earth's day and year for dates and clock times). */
  const PRESETS = {
    earth: { label: 'Earth', e: 0.016708634, obl: 23.4392911, peri: 282.93735, aberr: -0.00569 },
    circular: { label: 'Earth, circular orbit', e: 0, obl: 23.4392911, peri: 282.93735, aberr: -0.00569 },
    untilted: { label: 'Earth, no tilt', e: 0.016708634, obl: 0, peri: 282.93735, aberr: -0.00569 },
    // Mars: Allison & McEwen (2000), Planet. Space Sci. 48, 215: e = 0.09340, ε = 25.1919°,
    // areocentric longitude of the Sun at perihelion 251.000° (epoch 2000).
    mars: { label: 'Mars', e: 0.0934, obl: 25.1919, peri: 251.0, aberr: 0 },
    // Saturn and Jupiter: e and obliquity from the NASA planetary fact sheets; perihelion
    // longitudes measured from each planet's own equinox are not fact-sheet numbers, so
    // these use a nominal 280°. The figure's shape barely depends on it at these e.
    saturn: { label: 'Saturn', e: 0.0565, obl: 26.73, peri: 280, aberr: 0 },
    jupiter: { label: 'Jupiter', e: 0.0489, obl: 3.13, peri: 280, aberr: 0 },
  };

  // ---------- time ----------

  /** Days since J2000.0 (JD 2451545.0 = 2000 Jan 1, 12:00 UT) for a Gregorian calendar date at a UT hour. Meeus 7.1. */
  function daysSinceJ2000(year, month, day, utHours = 0) {
    let y = year;
    let m = month;
    if (m <= 2) {
      y -= 1;
      m += 12;
    }
    const A = Math.floor(y / 100);
    const B = 2 - A + Math.floor(A / 4);
    const JD = Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + B - 1524.5;
    return JD + utHours / 24 - 2451545.0;
  }

  /** Inverse of daysSinceJ2000 (Meeus 7): {year, month, day (fractional)} for a UT instant. */
  function dateFromDays(d) {
    const JD = d + 2451545.0 + 0.5;
    const Z = Math.floor(JD);
    const F = JD - Z;
    let A = Z;
    if (Z >= 2299161) {
      const alpha = Math.floor((Z - 1867216.25) / 36524.25);
      A = Z + 1 + alpha - Math.floor(alpha / 4);
    }
    const B = A + 1524;
    const C = Math.floor((B - 122.1) / 365.25);
    const D = Math.floor(365.25 * C);
    const E = Math.floor((B - D) / 30.6001);
    const day = B - D - Math.floor(30.6001 * E) + F;
    const month = E < 14 ? E - 1 : E - 13;
    const year = month > 2 ? C - 4716 : C - 4715;
    return { year, month, day };
  }

  const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const daysInYear = (y) => (isLeap(y) ? 366 : 365);

  /** Earth's mean solar longitude (degrees) at d days since J2000.0. */
  function meanLongitude(d) {
    const T = d / 36525;
    return wrap360(280.46646 + 36000.76983 * T + 0.0003032 * T * T);
  }

  // ---------- the Sun on the celestial sphere ----------

  function solveKepler(Mrad, e) {
    let E = e < 0.8 ? Mrad : Math.PI;
    for (let i = 0; i < 40; i++) {
      const dE = (E - e * Math.sin(E) - Mrad) / (1 - e * Math.cos(E));
      E -= dE;
      if (Math.abs(dE) < 1e-14) break;
    }
    return E;
  }

  /**
   * The Sun for elements el at mean longitude L (degrees).
   * Returns angles in degrees: M, C (equation of centre), lambda (apparent ecliptic longitude),
   * alpha (RA), delta (declination), eot (degrees) and eotMin (minutes of time).
   */
  function sunAt(el, L) {
    const e = el.e;
    const aberr = el.aberr || 0;
    const M = wrap360(L - el.peri);
    const E = solveKepler(M * RAD, e);
    const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
    const C = wrap180(nu * DEG - M);
    const lambda = wrap360(L + C + aberr);
    const lr = lambda * RAD;
    const ob = el.obl * RAD;
    const alpha = wrap360(Math.atan2(Math.cos(ob) * Math.sin(lr), Math.cos(lr)) * DEG);
    const delta = Math.asin(Math.sin(ob) * Math.sin(lr)) * DEG;
    const eot = wrap180(L + aberr - alpha);
    return { L: wrap360(L), M, C, lambda, alpha, delta, eot, eotMin: eot * 4 };
  }

  /** The two causes of the equation of time, each with the other switched off (degrees). */
  function eotParts(el, L) {
    return {
      tilt: sunAt({ ...el, e: 0 }, L).eot,
      orbit: sunAt({ ...el, obl: 0 }, L).eot,
      total: sunAt(el, L).eot,
    };
  }

  /** Elements provider: a fixed object, or Earth's drifting elements. */
  function elementsFor(spec) {
    if (typeof spec === 'function') return spec;
    if (spec === 'earth' || spec === undefined) return (d) => earthElements(d / 36525);
    return () => spec;
  }

  /** The Sun (as sunAt) at d days since J2000.0, on Earth's calendar, for the given elements. */
  function sunOnDay(spec, d) {
    const el = elementsFor(spec)(d);
    return sunAt(el, meanLongitude(d));
  }

  // ---------- the Sun in the local sky ----------

  /**
   * Local hour angle of the true Sun (degrees, west positive) for a clock time.
   * clockHours: local clock (standard) time; zone: hours east of UTC; lonEast: degrees east.
   */
  function hourAngle(clockHours, zone, lonEast, eotDeg) {
    return 15 * (clockHours - 12 - zone) + lonEast + eotDeg;
  }

  /** Altitude and azimuth (degrees; azimuth from north through east) from hour angle, declination, latitude. */
  function altAz(H, delta, lat) {
    const h = H * RAD;
    const dl = delta * RAD;
    const ph = lat * RAD;
    const sinAlt = Math.sin(ph) * Math.sin(dl) + Math.cos(ph) * Math.cos(dl) * Math.cos(h);
    const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt))) * DEG;
    const azS = Math.atan2(Math.sin(h), Math.cos(h) * Math.sin(ph) - Math.tan(dl) * Math.cos(ph)) * DEG;
    return { alt, az: wrap360(azS + 180) };
  }

  /** Days since J2000.0 at local clock time `clock` (hours) on a civil date in zone `zone`. */
  function localInstant(year, month, day, clock, zone) {
    return daysSinceJ2000(year, month, day, 0) + (clock - zone) / 24;
  }

  /**
   * Where the Sun is at a clock time on a date.
   * Returns {d, alt, az, delta, eot (deg), eotMin, H, lambda}.
   */
  function sunInSky(spec, year, month, day, clock, lat, lonEast, zone) {
    const d = localInstant(year, month, day, clock, zone);
    const s = sunOnDay(spec, d);
    const H = hourAngle(clock, zone, lonEast, s.eot);
    const { alt, az } = altAz(H, s.delta, lat);
    return { d, alt, az, delta: s.delta, eot: s.eot, eotMin: s.eotMin, H, lambda: s.lambda };
  }

  /** One point per day for a year at a fixed clock time: the analemma in the sky. */
  function skyFigure(spec, year, clock, lat, lonEast, zone) {
    const out = [];
    const n = daysInYear(year);
    const d0 = daysSinceJ2000(year, 1, 1, 0);
    for (let i = 0; i < n; i++) {
      const { year: y, month, day } = dateFromDays(d0 + i);
      const p = sunInSky(spec, y, month, Math.floor(day), clock, lat, lonEast, zone);
      out.push({ i, year: y, month, day: Math.floor(day), ...p });
    }
    return out;
  }

  // ---------- sunrise, sunset, noon ----------

  /**
   * Sunrise, solar noon and sunset (local clock hours) on a civil date.
   * Returns {rise, set, noon, length, polar: null | 'day' | 'night', delta, eotMin}.
   * Two refinement passes evaluate the Sun at the event itself (δ and EoT change by the hour).
   */
  function riseSet(spec, year, month, day, lat, lonEast, zone) {
    const sunAtClock = (clock) => sunOnDay(spec, localInstant(year, month, day, clock, zone));
    const noonFrom = (s) => 12 + zone - (lonEast + s.eot) / 15;
    const h0 = Math.sin(RISE_SET_ALT * RAD);
    const ph = lat * RAD;
    const haFor = (s) => {
      const dl = s.delta * RAD;
      const x = (h0 - Math.sin(ph) * Math.sin(dl)) / (Math.cos(ph) * Math.cos(dl));
      if (x > 1) return { polar: 'night' };
      if (x < -1) return { polar: 'day' };
      return { polar: null, H0: Math.acos(x) * DEG };
    };
    let s = sunAtClock(12);
    let noon = noonFrom(s);
    for (let pass = 0; pass < 3; pass++) {
      s = sunAtClock(noon);
      noon = noonFrom(s);
    }
    let rise = noon;
    let set = noon;
    let polar = null;
    for (let pass = 0; pass < 2; pass++) {
      const sr = sunAtClock(rise);
      const a = haFor(sr);
      const ss = sunAtClock(set);
      const b = haFor(ss);
      if (a.polar || b.polar) {
        polar = a.polar || b.polar;
        break;
      }
      rise = noonFrom(sr) - a.H0 / 15;
      set = noonFrom(ss) + b.H0 / 15;
    }
    if (polar) return { rise: NaN, set: NaN, noon, length: polar === 'day' ? 24 : 0, polar, delta: s.delta, eotMin: s.eotMin };
    return { rise, set, noon, length: set - rise, polar: null, delta: s.delta, eotMin: s.eotMin };
  }

  /** riseSet for every day of a year. */
  function yearRiseSet(spec, year, lat, lonEast, zone) {
    const out = [];
    const n = daysInYear(year);
    const d0 = daysSinceJ2000(year, 1, 1, 0);
    for (let i = 0; i < n; i++) {
      const { month, day } = dateFromDays(d0 + i);
      out.push({ i, year, month, day: Math.floor(day), ...riseSet(spec, year, month, Math.floor(day), lat, lonEast, zone) });
    }
    return out;
  }

  /** Extremes of a yearRiseSet table: earliest/latest sunrise and sunset, shortest/longest day. */
  function riseSetExtremes(table) {
    const ok = table.filter((r) => !r.polar);
    const pick = (key, min) => {
      if (!ok.length) return null;
      let best = ok[0];
      for (const r of ok) if (min ? r[key] < best[key] : r[key] > best[key]) best = r;
      return best;
    };
    const lengths = table;
    let shortest = lengths[0];
    let longest = lengths[0];
    for (const r of lengths) {
      if (r.length < shortest.length) shortest = r;
      if (r.length > longest.length) longest = r;
    }
    return {
      earliestSunset: pick('set', true),
      latestSunset: pick('set', false),
      earliestSunrise: pick('rise', true),
      latestSunrise: pick('rise', false),
      shortestDay: shortest,
      longestDay: longest,
    };
  }

  // ---------- events through the year ----------

  /** Refine a function's extremum near day d0 by golden-section search over ±span days. */
  function refineExtremum(f, d0, span, wantMax) {
    let a = d0 - span;
    let b = d0 + span;
    const g = (x) => (wantMax ? -f(x) : f(x));
    const r = (Math.sqrt(5) - 1) / 2;
    let c = b - r * (b - a);
    let d = a + r * (b - a);
    let fc = g(c);
    let fd = g(d);
    for (let i = 0; i < 60; i++) {
      if (fc < fd) {
        b = d;
        d = c;
        fd = fc;
        c = b - r * (b - a);
        fc = g(c);
      } else {
        a = c;
        c = d;
        fc = fd;
        d = a + r * (b - a);
        fd = g(d);
      }
    }
    const x = (a + b) / 2;
    return { d: x, value: f(x) };
  }

  /** Min and max of the equation of time (minutes) in a calendar year, with their UT dates. */
  function eotExtremes(spec, year) {
    const d0 = daysSinceJ2000(year, 1, 1, 0);
    const n = daysInYear(year);
    const f = (d) => sunOnDay(spec, d).eotMin;
    let iMin = 0;
    let iMax = 0;
    let vMin = Infinity;
    let vMax = -Infinity;
    for (let i = 0; i < n; i++) {
      const v = f(d0 + i + 0.5);
      if (v < vMin) {
        vMin = v;
        iMin = i;
      }
      if (v > vMax) {
        vMax = v;
        iMax = i;
      }
    }
    const lo = refineExtremum(f, d0 + iMin + 0.5, 1.5, false);
    const hi = refineExtremum(f, d0 + iMax + 0.5, 1.5, true);
    return {
      min: { minutes: lo.value, d: lo.d, ...dateFromDays(lo.d) },
      max: { minutes: hi.value, d: hi.d, ...dateFromDays(hi.d) },
    };
  }

  /** Instants (UT, as days since J2000 and calendar dates) when λ = 0°, 90°, 180°, 270° in a calendar year. */
  function seasonPoints(spec, year) {
    const d0 = daysSinceJ2000(year, 1, 1, 0);
    const n = daysInYear(year);
    const out = {};
    const names = { 0: 'marchEquinox', 90: 'juneSolstice', 180: 'septemberEquinox', 270: 'decemberSolstice' };
    for (const target of [0, 90, 180, 270]) {
      const g = (d) => wrap180(sunOnDay(spec, d).lambda - target);
      let found = null;
      for (let i = 0; i < n; i++) {
        let a = d0 + i;
        let b = a + 1;
        const ga = g(a);
        const gb = g(b);
        if (ga <= 0 && gb > 0 && gb - ga < 180) {
          for (let k = 0; k < 60; k++) {
            const m = (a + b) / 2;
            if (g(m) <= 0) a = m;
            else b = m;
          }
          found = (a + b) / 2;
          break;
        }
      }
      out[names[target]] = found === null ? null : { d: found, ...dateFromDays(found) };
    }
    return out;
  }

  /** Does the closed curve (x_i, y_i) cross itself? Counts proper segment crossings. */
  function selfCrossings(points) {
    const n = points.length;
    const cross = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    let count = 0;
    for (let i = 0; i < n; i++) {
      const a = points[i];
      const b = points[(i + 1) % n];
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        const c = points[j];
        const d = points[(j + 1) % n];
        const d1 = cross(a.x, a.y, b.x, b.y, c.x, c.y);
        const d2 = cross(a.x, a.y, b.x, b.y, d.x, d.y);
        const d3 = cross(c.x, c.y, d.x, d.y, a.x, a.y);
        const d4 = cross(c.x, c.y, d.x, d.y, b.x, b.y);
        if (d1 * d2 < 0 && d3 * d4 < 0) count++;
      }
    }
    return count;
  }

  /** The analemma's own shape: (EoT in minutes, declination) sampled at n mean longitudes. */
  function shape(el, n = 366) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const s = sunAt(el, (360 * i) / n);
      pts.push({ x: s.eotMin, y: s.delta, L: s.L });
    }
    return pts;
  }

  /** Helpers for formatting. */
  function hoursToHM(h) {
    const total = Math.round(h * 60);
    const hh = Math.floor(((total / 60) % 24 + 24) % 24);
    const mm = ((total % 60) + 60) % 60;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }

  return {
    RAD, DEG, wrap360, wrap180, RISE_SET_ALT,
    earthElements, PRESETS,
    daysSinceJ2000, dateFromDays, isLeap, daysInYear, meanLongitude,
    solveKepler, sunAt, eotParts, elementsFor, sunOnDay,
    hourAngle, altAz, localInstant, sunInSky, skyFigure,
    riseSet, yearRiseSet, riseSetExtremes,
    eotExtremes, seasonPoints, selfCrossings, shape, hoursToHM,
  };
});
