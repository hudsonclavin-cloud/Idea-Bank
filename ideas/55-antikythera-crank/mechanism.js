/* The Antikythera Crank: pure model of the gearing, dials and reference astronomy.
 * No DOM. Loaded by the page as a classic script (exposes window.AK) and by the
 * Node tests through require() (reads gears.json directly).
 *
 * Conventions
 *  - Y is "mechanism years": turns of the main drive wheel b1 since the epoch.
 *  - Gear angles are in turns, positive in the sense b1 turns (the Sun's direction).
 *  - Dates are Julian Day numbers in UT; the reference astronomy adds Delta-T itself.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./gears.json'));
  else root.AK = factory(root.AK_GEARS);
})(typeof self !== 'undefined' ? self : this, function (DATA) {
  'use strict';

  var TAU = Math.PI * 2;
  var D2R = Math.PI / 180;
  var R2D = 180 / Math.PI;

  /* ------------------------------------------------------------------ */
  /* Exact fractions (BigInt)                                            */
  /* ------------------------------------------------------------------ */
  function bgcd(a, b) {
    if (a < 0n) a = -a;
    if (b < 0n) b = -b;
    while (b) { var t = a % b; a = b; b = t; }
    return a;
  }
  function frac(n, d) {
    n = BigInt(n);
    d = d === undefined ? 1n : BigInt(d);
    if (d === 0n) throw new Error('zero denominator');
    if (d < 0n) { n = -n; d = -d; }
    var g = bgcd(n, d) || 1n;
    return { n: n / g, d: d / g };
  }
  var Fr = {
    of: frac,
    mul: function (a, b) { return frac(a.n * b.n, a.d * b.d); },
    div: function (a, b) { return frac(a.n * b.d, a.d * b.n); },
    add: function (a, b) { return frac(a.n * b.d + b.n * a.d, a.d * b.d); },
    sub: function (a, b) { return frac(a.n * b.d - b.n * a.d, a.d * b.d); },
    eq: function (a, b) { return a.n === b.n && a.d === b.d; },
    num: function (a) { return Number(a.n) / Number(a.d); },
    str: function (a) { return a.d === 1n ? String(a.n) : a.n + '/' + a.d; }
  };

  /* ------------------------------------------------------------------ */
  /* Gear data                                                           */
  /* ------------------------------------------------------------------ */
  var GEAR = {};
  DATA.gears.forEach(function (g) { GEAR[g.id] = g; });
  var ARBOR_OF = {};
  Object.keys(DATA.arbors).forEach(function (a) {
    DATA.arbors[a].forEach(function (id) { ARBOR_OF[id] = a; });
  });
  function teeth(id) {
    var g = GEAR[id];
    if (!g || !g.teeth) throw new Error('no tooth count for ' + id);
    return g.teeth;
  }

  /** Exact ratio of a train: product of driver/driven, with the sign of the
   *  mesh count (each external mesh reverses the direction). */
  function trainRatio(meshes) {
    var r = frac(1);
    meshes.forEach(function (m) { r = Fr.mul(r, frac(teeth(m[0]), teeth(m[1]))); });
    return { ratio: r, sign: meshes.length % 2 ? -1 : 1, meshes: meshes.length };
  }
  function train(id) {
    for (var i = 0; i < DATA.trains.length; i++) if (DATA.trains[i].id === id) return DATA.trains[i];
    throw new Error('no train ' + id);
  }

  /* ------------------------------------------------------------------ */
  /* Pin and slot                                                        */
  /* ------------------------------------------------------------------ */
  var PIN = DATA.pin_and_slot;
  var ECC = PIN.offset_mm / PIN.pin_radius_mm; // 0.11458...

  function wrapPi(x) {
    x = (x + Math.PI) % TAU;
    if (x < 0) x += TAU;
    return x - Math.PI;
  }
  /** Geometry of the pin and slot. phi1 = angle of the pin about k1's axis
   *  (radians, platform frame). k2's axis sits a distance eps*r from k1's along
   *  the zero direction. Returns the slot's angle about k2's axis minus phi1. */
  function pinSlotDeviation(phi1, eps) {
    if (eps === undefined) eps = ECC;
    var x = Math.cos(phi1) - eps, y = Math.sin(phi1);
    return wrapPi(Math.atan2(y, x) - phi1);
  }

  /* ------------------------------------------------------------------ */
  /* Kinematics: every gear's angle from the turn of b1                  */
  /* ------------------------------------------------------------------ */
  var MESHES = DATA.meshes;
  var RIDERS = { k1: true, k2: true };

  /**
   * Angles (turns) of every arbor for b1 at Y turns. phi0 is the pin's angle at Y = 0
   * (radians), which sets where the Moon's perigee is at the epoch.
   * Propagation: through every fixed-axis mesh, theta_driven = -(z_driver/z_driven) theta_driver;
   * k1 and k2 ride on the turntable e3 and mesh with e5/e6 relative to it;
   * the pin on k1 drives the slot on k2.
   */
  function kinematics(Y, phi0) {
    var th = { b: Y };
    var rel = {};
    var changed = true;
    function step() {
      changed = false;
      MESHES.forEach(function (m) {
        var a = ARBOR_OF[m[0]], b = ARBOR_OF[m[1]];
        if (RIDERS[m[0]] || RIDERS[m[1]]) return;
        var r = teeth(m[0]) / teeth(m[1]);
        if (a in th && !(b in th)) { th[b] = -r * th[a]; changed = true; }
        else if (b in th && !(a in th)) { th[a] = -th[b] / r; changed = true; }
      });
    }
    while (changed) step();
    // epicyclic part: relative to the turntable e3
    var carrier = th.e_platform;
    rel.e_moon = th.e_moon - carrier;
    rel.k1 = -(teeth('e5') / teeth('k1')) * rel.e_moon;
    var phi1 = TAU * rel.k1 + (phi0 || 0);
    var dev = pinSlotDeviation(phi1, ECC);
    rel.k2 = rel.k1 + dev / TAU;
    rel.e_out = -(teeth('k2') / teeth('e6')) * rel.k2;
    th.e_out = carrier + rel.e_out;
    th.k1 = carrier + rel.k1;
    th.k2 = carrier + rel.k2;
    changed = true;
    while (changed) step();
    return { theta: th, rel: rel, pinAngle: phi1, deviation: dev };
  }

  /* ------------------------------------------------------------------ */
  /* Calendar: Julian Day, dates, Egyptian calendar, Delta-T             */
  /* ------------------------------------------------------------------ */
  var GREGORIAN_START = 2299160.5; // 15 October 1582

  function jdFromDate(y, m, d, calendar) {
    // Meeus, Astronomical Algorithms, ch. 7. y is the astronomical year (205 BC = -204).
    var greg = calendar === 'gregorian' || (calendar === undefined && (y > 1582 || (y === 1582 && (m > 10 || (m === 10 && d >= 15)))));
    if (m <= 2) { y -= 1; m += 12; }
    var B = 0;
    if (greg) { var A = Math.floor(y / 100); B = 2 - A + Math.floor(A / 4); }
    return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5;
  }
  function dateFromJd(jd) {
    var Z = Math.floor(jd + 0.5), Fp = jd + 0.5 - Z, A = Z;
    if (Z >= 2299161) { var al = Math.floor((Z - 1867216.25) / 36524.25); A = Z + 1 + al - Math.floor(al / 4); }
    var B = A + 1524, C = Math.floor((B - 122.1) / 365.25), D = Math.floor(365.25 * C), E = Math.floor((B - D) / 30.6001);
    var day = B - D - Math.floor(30.6001 * E) + Fp;
    var month = E < 14 ? E - 1 : E - 13;
    var year = month > 2 ? C - 4716 : C - 4715;
    return { year: year, month: month, day: day, calendar: jd < GREGORIAN_START ? 'julian' : 'gregorian' };
  }
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function yearLabel(y) {
    if (y <= 0) return (1 - y) + ' BC';
    if (y < 1000) return 'AD ' + y;
    return String(y);
  }
  function formatDate(jd, short) {
    var d = dateFromJd(jd);
    var mn = MONTHS[d.month - 1];
    return Math.floor(d.day) + ' ' + (short ? mn.slice(0, 3) : mn) + ' ' + yearLabel(d.year);
  }

  // Egyptian civil calendar: 12 months of 30 days and 5 epagomenal days.
  // Era of Nabonassar: 1 Thoth of year 1 = 26 February 747 BC (Julian) = JD 1448638.
  var NABONASSAR_JD = 1448638;
  var EGYPT_MONTHS = ['Thoth', 'Phaophi', 'Athyr', 'Choiak', 'Tybi', 'Mechir', 'Phamenoth', 'Pharmouthi', 'Pachon', 'Payni', 'Epiphi', 'Mesore', 'Epagomenai'];
  function egyptianDate(jd) {
    var n = Math.floor(jd + 0.5) - NABONASSAR_JD;
    var year = Math.floor(n / 365) + 1;
    var doy = n - (year - 1) * 365; // 0..364
    var mi = Math.min(12, Math.floor(doy / 30));
    return { year: year, dayOfYear: doy, month: EGYPT_MONTHS[mi], monthIndex: mi, day: doy - mi * 30 + 1 };
  }

  /** Delta-T = TT - UT in seconds: Espenak & Meeus polynomials (NASA Five Millennium Canon). */
  function deltaT(yearFrac) {
    var y = yearFrac, t, u;
    if (y < -500) { u = (y - 1820) / 100; return -20 + 32 * u * u; }
    if (y < 500) { u = y / 100; return 10583.6 - 1014.41 * u + 33.78311 * u * u - 5.952053 * u * u * u - 0.1798452 * Math.pow(u, 4) + 0.022174192 * Math.pow(u, 5) + 0.0090316521 * Math.pow(u, 6); }
    if (y < 1600) { u = (y - 1000) / 100; return 1574.2 - 556.01 * u + 71.23472 * u * u + 0.319781 * u * u * u - 0.8503463 * Math.pow(u, 4) - 0.005050998 * Math.pow(u, 5) + 0.0083572073 * Math.pow(u, 6); }
    if (y < 1700) { t = y - 1600; return 120 - 0.9808 * t - 0.01532 * t * t + t * t * t / 7129; }
    if (y < 1800) { t = y - 1700; return 8.83 + 0.1603 * t - 0.0059285 * t * t + 0.00013336 * t * t * t - Math.pow(t, 4) / 1174000; }
    if (y < 1860) { t = y - 1800; return 13.72 - 0.332447 * t + 0.0068612 * t * t + 0.0041116 * t * t * t - 0.00037436 * Math.pow(t, 4) + 0.0000121272 * Math.pow(t, 5) - 0.0000001699 * Math.pow(t, 6) + 0.000000000875 * Math.pow(t, 7); }
    if (y < 1900) { t = y - 1860; return 7.62 + 0.5737 * t - 0.251754 * t * t + 0.01680668 * t * t * t - 0.0004473624 * Math.pow(t, 4) + Math.pow(t, 5) / 233174; }
    if (y < 1920) { t = y - 1900; return -2.79 + 1.494119 * t - 0.0598939 * t * t + 0.0061966 * t * t * t - 0.000197 * Math.pow(t, 4); }
    if (y < 1941) { t = y - 1920; return 21.20 + 0.84493 * t - 0.076100 * t * t + 0.0020936 * t * t * t; }
    if (y < 1961) { t = y - 1950; return 29.07 + 0.407 * t - t * t / 233 + t * t * t / 2547; }
    if (y < 1986) { t = y - 1975; return 45.45 + 1.067 * t - t * t / 260 - t * t * t / 718; }
    if (y < 2005) { t = y - 2000; return 63.86 + 0.3345 * t - 0.060374 * t * t + 0.0017275 * t * t * t + 0.000651814 * Math.pow(t, 4) + 0.00002373599 * Math.pow(t, 5); }
    if (y < 2050) { t = y - 2000; return 62.92 + 0.32217 * t + 0.005589 * t * t; }
    u = (y - 1820) / 100;
    if (y < 2150) return -20 + 32 * u * u - 0.5628 * (2150 - y);
    return -20 + 32 * u * u;
  }
  function jdToYear(jd) { return 2000 + (jd - 2451544.5) / 365.2425; }
  function ttFromUt(jd) { return jd + deltaT(jdToYear(jd)) / 86400; }

  /* ------------------------------------------------------------------ */
  /* Reference astronomy (modern), used only for comparison              */
  /* ------------------------------------------------------------------ */
  function norm360(x) { x %= 360; return x < 0 ? x + 360 : x; }
  function sgn180(x) { x = norm360(x); return x > 180 ? x - 360 : x; }
  function sind(x) { return Math.sin(x * D2R); }
  function cosd(x) { return Math.cos(x * D2R); }

  /** Sun, Meeus ch. 25 (low accuracy, ~0.01 deg): mean and true geometric longitude. */
  function sunModern(jdTT) {
    var T = (jdTT - 2451545) / 36525;
    var L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
    var M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
    var C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * sind(M) + (0.019993 - 0.000101 * T) * sind(2 * M) + 0.000289 * sind(3 * M);
    return { mean: norm360(L0), anomaly: norm360(M), lon: norm360(L0 + C), center: C };
  }

  /** Moon's mean elements (Meeus ch. 47, after Chapront-Touze & Chapront). Degrees. */
  function moonElements(jdTT) {
    var T = (jdTT - 2451545) / 36525, T2 = T * T, T3 = T2 * T, T4 = T3 * T;
    return {
      T: T,
      L: 218.3164477 + 481267.88123421 * T - 0.0015786 * T2 + T3 / 538841 - T4 / 65194000,
      D: 297.8501921 + 445267.1114034 * T - 0.0018819 * T2 + T3 / 545868 - T4 / 113065000,
      M: 357.5291092 + 35999.0502909 * T - 0.0001536 * T2 + T3 / 24490000,
      Mp: 134.9633964 + 477198.8675055 * T + 0.0087414 * T2 + T3 / 69699 - T4 / 14712000,
      F: 93.2720950 + 483202.0175233 * T - 0.0036539 * T2 - T3 / 3526000 + T4 / 863310000
    };
  }
  // Leading terms of Meeus Table 47.A (longitude), units 1e-6 degree: [D, M, M', F, coefficient].
  var MOON_TERMS = [
    [0, 0, 1, 0, 6288774], [2, 0, -1, 0, 1274027], [2, 0, 0, 0, 658314], [0, 0, 2, 0, 213618],
    [0, 1, 0, 0, -185116], [0, 0, 0, 2, -114332], [2, 0, -2, 0, 58793], [2, -1, -1, 0, 57066],
    [2, 0, 1, 0, 53322], [2, -1, 0, 0, 45758], [0, 1, -1, 0, -40923], [1, 0, 0, 0, -34720],
    [0, 1, 1, 0, -30383], [2, 0, 0, -2, 15327], [0, 0, 1, 2, -12528], [0, 0, 1, -2, 10980],
    [4, 0, -1, 0, 10675], [0, 0, 3, 0, 10034], [4, 0, -2, 0, 8548], [2, 1, -1, 0, -7888],
    [2, 1, 0, 0, -6766], [1, 0, -1, 0, -5163], [1, 1, 0, 0, 4987], [2, -1, 1, 0, 4036],
    [2, 0, 2, 0, 3994], [4, 0, 0, 0, 3861], [2, 0, -3, 0, 3665], [0, 1, -2, 0, -2689],
    [2, 0, -1, 2, -2602], [2, -1, -2, 0, 2390], [1, 0, 1, 0, -2348], [2, -2, 0, 0, 2236],
    [0, 1, 2, 0, -2120], [0, 2, 0, 0, -2069], [2, -2, -1, 0, 2048], [2, 0, 1, -2, -1773],
    [2, 0, 0, 2, -1595], [4, -1, -1, 0, 1215], [0, 0, 2, 2, -1110], [3, 0, -1, 0, -892],
    [2, 1, 1, 0, -810], [4, -1, -2, 0, 759], [0, 2, -1, 0, -713], [2, 2, -1, 0, -700],
    [2, 1, -2, 0, 691], [2, -1, 0, -2, 596], [4, 0, 1, 0, 549], [0, 0, 4, 0, 537],
    [4, -1, 0, 0, 520], [1, 0, -2, 0, -487]
  ];
  /** Moon's geometric ecliptic longitude (of date, no nutation), ~0.01 deg. */
  function moonModern(jdTT) {
    var e = moonElements(jdTT), T = e.T;
    var E = 1 - 0.002516 * T - 0.0000074 * T * T;
    var A1 = 119.75 + 131.849 * T;
    var sum = 0;
    for (var i = 0; i < MOON_TERMS.length; i++) {
      var t = MOON_TERMS[i];
      var arg = t[0] * e.D + t[1] * e.M + t[2] * e.Mp + t[3] * e.F;
      var c = t[4];
      if (Math.abs(t[1]) === 1) c *= E; else if (Math.abs(t[1]) === 2) c *= E * E;
      sum += c * sind(arg);
    }
    sum += 3958 * sind(A1) + 1962 * sind(e.L - e.F);
    return { lon: norm360(e.L + sum / 1e6), mean: norm360(e.L), anomaly: norm360(e.Mp), perigee: norm360(e.L - e.Mp), elements: e };
  }

  // Planets: mean longitudes, mean equinox of date, and mean distances (Meeus Table 31.A).
  var PLANET_MEAN = {
    Mercury: [252.250906, 149474.0722491, 0.387098310],
    Venus: [181.979801, 58519.2130302, 0.723329820],
    Earth: [100.466457, 36000.7698278, 1.000001018],
    Mars: [355.433000, 19141.6964471, 1.523679342],
    Jupiter: [34.351519, 3036.3027748, 5.202603209],
    Saturn: [50.077444, 1223.5110686, 9.554909192]
  };
  function planetMeanLon(name, jdTT) {
    var p = PLANET_MEAN[name], T = (jdTT - 2451545) / 36525;
    return norm360(p[0] + p[1] * T);
  }
  /** Geocentric longitude for circular, coplanar heliocentric orbits (the simple epicycle model). */
  function geocentricCircular(lonPlanet, aPlanet, lonEarth) {
    var x = aPlanet * cosd(lonPlanet) - cosd(lonEarth), y = aPlanet * sind(lonPlanet) - sind(lonEarth);
    return norm360(Math.atan2(y, x) * R2D);
  }
  function planetSynodicDays(name) {
    var p = PLANET_MEAN[name], e = PLANET_MEAN.Earth;
    return 36525 * 360 / Math.abs(p[1] - e[1]);
  }

  /* ------------------------------------------------------------------ */
  /* Eclipses: Meeus ch. 54                                              */
  /* ------------------------------------------------------------------ */
  var SYNODIC_MEEUS = 29.530588861;
  function meanPhaseJde(k) {
    var T = k / 1236.85;
    return 2451550.09766 + SYNODIC_MEEUS * k + 0.00015437 * T * T - 0.000000150 * T * T * T + 0.00000000073 * T * T * T * T;
  }
  /** k integer: new moon (solar eclipse test); k + 0.5: full moon (lunar). */
  function eclipseAt(k) {
    var T = k / 1236.85, T2 = T * T, T3 = T2 * T, T4 = T3 * T;
    var full = Math.abs(k - Math.floor(k) - 0.5) < 1e-9;
    var jde = meanPhaseJde(k);
    var M = 2.5534 + 29.10535670 * k - 0.0000014 * T2 - 0.00000011 * T3;
    var Mp = 201.5643 + 385.81693528 * k + 0.0107582 * T2 + 0.00001238 * T3 - 0.000000058 * T4;
    var Fm = 160.7108 + 390.67050284 * k - 0.0016118 * T2 - 0.00000227 * T3 + 0.000000011 * T4;
    var Om = 124.7746 - 1.56375588 * k + 0.0020672 * T2 + 0.00000215 * T3;
    var E = 1 - 0.002516 * T - 0.0000074 * T2;
    var F1 = Fm - 0.02665 * sind(Om), A1 = 299.77 + 0.107408 * k - 0.009173 * T2;
    jde += (full ? -0.4065 * sind(Mp) + 0.1727 * E * sind(M) : -0.4075 * sind(Mp) + 0.1721 * E * sind(M)) +
      0.0161 * sind(2 * Mp) - 0.0097 * sind(2 * F1) + 0.0073 * E * sind(Mp - M) - 0.0050 * E * sind(Mp + M) -
      0.0023 * sind(Mp - 2 * F1) + 0.0021 * E * sind(2 * M) + 0.0012 * sind(Mp + 2 * F1) + 0.0006 * E * sind(2 * Mp + M) -
      0.0004 * sind(3 * Mp) - 0.0003 * E * sind(M + 2 * F1) + 0.0003 * sind(A1) - 0.0002 * E * sind(M - 2 * F1) -
      0.0002 * E * sind(2 * Mp - M) - 0.0002 * sind(Om);
    var P = 0.2070 * E * sind(M) + 0.0024 * E * sind(2 * M) - 0.0392 * sind(Mp) + 0.0116 * sind(2 * Mp) -
      0.0073 * E * sind(Mp + M) + 0.0067 * E * sind(Mp - M) + 0.0118 * sind(2 * F1);
    var Q = 5.2207 - 0.0048 * E * cosd(M) + 0.0020 * E * cosd(2 * M) - 0.3299 * cosd(Mp) - 0.0060 * E * cosd(Mp + M) + 0.0041 * E * cosd(Mp - M);
    var W = Math.abs(cosd(F1));
    var gamma = (P * cosd(F1) + Q * sind(F1)) * (1 - 0.0048 * W);
    var u = 0.0059 + 0.0046 * E * cosd(M) - 0.0182 * cosd(Mp) + 0.0004 * cosd(2 * Mp) - 0.0005 * cosd(M + Mp);
    var g = Math.abs(gamma);
    var out = { k: k, lunar: full, jde: jde, gamma: gamma, u: u, type: 'none' };
    if (full) {
      out.penumbral = (1.5573 + u - g) / 0.5450;
      out.umbral = (1.0128 - u - g) / 0.5450;
      out.type = out.umbral >= 1 ? 'total' : out.umbral > 0 ? 'partial' : out.penumbral > 0 ? 'penumbral' : 'none';
    } else if (g <= 1.5433 + u) {
      if (g < 0.9972) {
        if (u < 0) out.type = 'total';
        else if (u > 0.0047) out.type = 'annular';
        else out.type = u < 0.00464 * Math.sqrt(1 - gamma * gamma) ? 'hybrid' : 'annular';
      } else if (g < 0.9972 + Math.abs(u)) {
        out.type = 'non-central';
      } else {
        out.type = 'partial';
        out.magnitude = (1.5433 + u - g) / (0.5461 + 2 * u);
      }
    }
    return out;
  }
  function mod(a, n) { return ((a % n) + n) % n; }
  /** Saros series number (van den Bergh numbering), from one reference eclipse per kind:
   *  solar: 21 Aug 2017 (k = 218) is Saros 145; lunar: 27 Jul 2018 (k = 229.5) is Saros 129.
   *  Consecutive series are one inex (358 lunations) apart; members are 223 lunations apart. */
  function sarosSeries(k, lunar) {
    var kRef = lunar ? 229.5 : 218, sRef = lunar ? 129 : 145;
    var dk = Math.round(k - kRef);
    for (var j = -300; j <= 300; j++) {
      if (mod(dk - 358 * j, 223) === 0) {
        var s = sRef + j;
        if (s > -60 && s < 200) return s;
      }
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* The epoch and the calibration                                       */
  /* ------------------------------------------------------------------ */
  // Saros dial cell 1 = the lunar month that began with the conjunction of 28 April 205 BC
  // (Carman & Evans 2014; Freeth 2014; Jones 2020). The dial's month boundaries are mean
  // conjunctions, so the epoch is the mean conjunction of that lunation.
  var EPOCH_K = Math.round((jdFromDate(-204, 4, 28.5, 'julian') - 2451550.09766) / SYNODIC_MEEUS);
  var EPOCH_JDE = meanPhaseJde(EPOCH_K);
  var EPOCH_JD = EPOCH_JDE - deltaT(jdToYear(EPOCH_JDE)) / 86400;
  var YEAR_DAYS = 365.242189; // mean tropical year (J2000); b1 makes one turn per tropical year
  var METONIC_OFFSET_MONTHS = 4; // Metonic/Games epoch four lunations after the Saros epoch (Iversen 2017)

  var CAL = (function () {
    var sun = sunModern(EPOCH_JDE), moon = moonModern(EPOCH_JDE);
    var planets = {};
    var LE = planetMeanLon('Earth', EPOCH_JDE);
    ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn'].forEach(function (n) {
      var Lp = planetMeanLon(n, EPOCH_JDE);
      planets[n] = DATA.planets.filter(function (p) { return p.name === n; })[0].inner ? norm360(Lp - LE) : norm360(LE - Lp);
    });
    return {
      sunLon: sun.mean,           // mean Sun at the epoch
      moonLon: moon.mean,         // Moon's mean longitude at the epoch
      moonAnomaly: moon.anomaly,  // Moon's mean anomaly at the epoch
      synodicPhase: planets       // planets' mean synodic phase at the epoch (degrees)
    };
  })();

  var R = {
    moon: Fr.num(trainRatio(train('moon').meshes).ratio),
    platform: Fr.num(trainRatio(train('platform').meshes).ratio),
    metonic: Fr.num(trainRatio(train('metonic').meshes).ratio),
    callippic: Fr.num(trainRatio(train('callippic').meshes).ratio),
    games: Fr.num(trainRatio(train('games').meshes).ratio),
    saros: Fr.num(trainRatio(train('saros').meshes).ratio),
    exeligmos: Fr.num(trainRatio(train('exeligmos').meshes).ratio)
  };
  var MONTHS_PER_YEAR = 235 / 19; // what the mechanism's Moon-minus-Sun rate amounts to

  function yearsFromJd(jd) { return (jd - EPOCH_JD) / YEAR_DAYS; }
  function jdFromYears(Y) { return EPOCH_JD + Y * YEAR_DAYS; }

  /* ------------------------------------------------------------------ */
  /* Dials                                                               */
  /* ------------------------------------------------------------------ */
  var METONIC_MONTHS = ['Phoinikaios', 'Kraneios', 'Lanotropios', 'Machaneus', 'Dodekateus', 'Eukleios', 'Artemisios', 'Psydreus', 'Gameilios', 'Agrianios', 'Panamos', 'Apellaios'];
  // Seven 13-month years in 19. ASSUMPTION (see README): intercalary years 1, 3, 6, 9, 11, 14, 17,
  // with the extra month a second Machaneus. This puts year 11's extra Machaneus in cell 129.
  var INTERCALARY_YEARS = [1, 3, 6, 9, 11, 14, 17];
  var METONIC_CELLS = (function () {
    var cells = [];
    for (var yr = 1; yr <= 19; yr++) {
      var extra = INTERCALARY_YEARS.indexOf(yr) >= 0;
      for (var mi = 0; mi < 12; mi++) {
        cells.push({ year: yr, month: METONIC_MONTHS[mi], index: mi + 1, intercalary: false });
        if (extra && mi === 3) cells.push({ year: yr, month: METONIC_MONTHS[mi], index: mi + 1, intercalary: true });
      }
    }
    return cells;
  })();
  var GAMES = [['Isthmia', 'Olympia'], ['Nemea', 'Naa'], ['Isthmia', 'Pythia'], ['Nemea', 'Halieia']];
  var EXELIGMOS_HOURS = [0, 8, 16];

  /** Engraved Saros dial for the epoch cycle: lunar eclipse at the full Moon of each month,
   *  solar eclipse at the conjunction that ends it (Carman & Evans's month-13 solar eclipse). */
  function sarosCycle(c) {
    var cells = [];
    for (var n = 1; n <= 223; n++) {
      var kL = EPOCH_K + 223 * c + n - 0.5, kS = EPOCH_K + 223 * c + n;
      var L = eclipseAt(kL), S = eclipseAt(kS);
      cells.push({
        cell: n,
        lunar: L.type === 'none' ? null : { type: L.type, jde: L.jde, saros: sarosSeries(kL, true), umbral: L.umbral },
        solar: S.type === 'none' ? null : { type: S.type, jde: S.jde, saros: sarosSeries(kS, false), gamma: S.gamma }
      });
    }
    return cells;
  }
  var ENGRAVED = sarosCycle(0);

  /** Read every dial for b1 at Y turns. */
  function read(Y) {
    var kin = kinematics(Y, CAL.moonAnomaly * D2R);
    var th = kin.theta;
    var sunLon = norm360(CAL.sunLon + 360 * th.b);
    var moonLon = norm360(CAL.moonLon + 360 * th.b_moon);
    var meanMoon = norm360(CAL.moonLon + 360 * -th.e_moon);
    var anomaly = norm360(kin.pinAngle * R2D);
    var elong = norm360(moonLon - sunLon);
    var months = MONTHS_PER_YEAR * Y; // mechanism lunations since the epoch
    // pointer turns, counted forward from each dial's start, taken from the gear angles
    var metonicTurns = -th.n - METONIC_OFFSET_MONTHS / 47;
    var sarosTurns = -th.g;
    var exeligmosTurns = -th.i;
    var yM = METONIC_OFFSET_MONTHS / MONTHS_PER_YEAR;
    var callippicTurns = -th.q - yM / 76;
    var gamesTurns = th.o - yM / 4;
    var metCell = Math.floor(mod(metonicTurns * 47, 235));
    var sarCell = Math.floor(mod(sarosTurns * 223 / 4, 223));
    var planets = {};
    DATA.planets.forEach(function (p) {
      var phase = norm360(CAL.synodicPhase[p.name] + 360 * (p.synodic_cycles / p.years) * Y);
      var LE = sunLon + 180;
      var Lp = p.inner ? LE + phase : LE - phase;
      planets[p.name] = { synodicPhase: phase, lon: geocentricCircular(Lp, PLANET_MEAN[p.name][2], LE) };
    });
    return {
      Y: Y,
      kin: kin,
      crankTurns: -th.a,
      sun: sunLon,
      moon: moonLon,
      moonMean: meanMoon,
      moonAnomaly: anomaly,
      moonEquation: kin.deviation * R2D,
      elongation: elong,
      illuminated: (1 - cosd(elong)) / 2,
      months: months,
      metonic: { turns: metonicTurns, cell: metCell + 1, info: METONIC_CELLS[metCell] },
      saros: { turns: sarosTurns, cell: sarCell + 1, engraved: ENGRAVED[sarCell], cycle: Math.floor(sarosTurns / 4) },
      exeligmos: { turns: exeligmosTurns, sector: Math.floor(mod(exeligmosTurns * 3, 3)) + 1, hours: EXELIGMOS_HOURS[Math.floor(mod(exeligmosTurns * 3, 3))] },
      callippic: { turns: callippicTurns, sector: Math.floor(mod(callippicTurns * 4, 4)) + 1 },
      games: { turns: gamesTurns, year: Math.floor(mod(gamesTurns * 4, 4)) + 1, games: GAMES[Math.floor(mod(gamesTurns * 4, 4))] },
      planets: planets
    };
  }

  /** The sky as modern theory has it at a UT Julian Day, for comparison. */
  function sky(jd) {
    var tt = ttFromUt(jd);
    var sun = sunModern(tt), moon = moonModern(tt);
    var LE = planetMeanLon('Earth', tt);
    var planets = {};
    DATA.planets.forEach(function (p) {
      planets[p.name] = { lon: geocentricCircular(planetMeanLon(p.name, tt), PLANET_MEAN[p.name][2], LE) };
    });
    var elong = norm360(moon.lon - sun.lon);
    return { tt: tt, sun: sun.lon, sunMean: sun.mean, moon: moon.lon, moonMean: moon.mean, moonAnomaly: moon.anomaly, elongation: elong, illuminated: (1 - cosd(elong)) / 2, planets: planets };
  }

  /** The real eclipses in the mechanism's lunar month number j (0 = the epoch month): the lunar
   *  eclipse at the full Moon nearest the month's middle, and the solar eclipse at the conjunction
   *  that ends it (the same convention as the engraved dial). Uses real lunations, so it stays
   *  right even after the mechanism's months have drifted from the sky. */
  function realEclipsesForMonth(j) {
    var mid = jdFromYears((j + 0.5) / MONTHS_PER_YEAR);
    var kFull = Math.round((ttFromUt(mid) - 2451550.09766) / SYNODIC_MEEUS - 0.5) + 0.5;
    var out = [];
    [kFull, kFull + 0.5].forEach(function (kk) {
      var e = eclipseAt(kk);
      if (e.type !== 'none') out.push({ k: kk, lunar: e.lunar, type: e.type, jde: e.jde, jd: e.jde - deltaT(jdToYear(e.jde)) / 86400, saros: sarosSeries(kk, e.lunar) });
    });
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Drift: the mechanism's mean rates against modern ones               */
  /* ------------------------------------------------------------------ */
  // Modern mean values (days), J2000: Meeus ch. 49 and ch. 47 (Chapront-Touze & Chapront).
  var MODERN = {
    tropicalYear: 365.242189,
    synodicMonth: 29.530588853,
    siderealMonth: 27.321661547,
    tropicalMonth: 27.321582241,
    anomalisticMonth: 27.554549878,
    draconicMonth: 27.212220817
  };
  function driftTable() {
    var Yd = MODERN.tropicalYear;
    var rows = [];
    function row(id, label, mechPerYear, modernPerYear, unit, note) {
      var d = (mechPerYear - modernPerYear) * 360; // degrees per year
      rows.push({ id: id, label: label, mech: mechPerYear, modern: modernPerYear, degPerYear: d, perDecade: d * 10, perCentury: d * 100, unit: unit, note: note });
    }
    row('moon', 'Moon’s mean longitude', R.moon, 1 + Yd / MODERN.synodicMonth, 'turns/yr', 'b1 is set to the Sun, so this is also the error in the Moon’s place');
    row('phase', 'Lunar phase (Moon − Sun)', R.moon - 1, Yd / MODERN.synodicMonth, 'turns/yr', 'the same error, seen as the phase');
    row('anomaly', 'Lunar anomaly (pin on k1)', R.moon - R.platform, Yd / MODERN.anomalisticMonth, 'turns/yr', '239 anomalistic months in 223 synodic');
    row('apsides', 'Line of apsides (turntable e3)', R.platform, Yd / MODERN.siderealMonth - Yd / MODERN.anomalisticMonth, 'turns/yr', 'period 8.88 yr; modern 8.85 yr');
    DATA.planets.forEach(function (p) {
      row(p.name, p.name + ' synodic phase', p.synodic_cycles / p.years, Yd / planetSynodicDays(p.name), 'turns/yr', p.synodic_cycles + ' synodic cycles in ' + p.years + ' years');
    });
    return rows;
  }
  function cycleFacts() {
    var Yd = MODERN.tropicalYear, S = MODERN.synodicMonth;
    var mechMonth = 19 * Yd / 235;
    return {
      mechanismMonthDays: mechMonth,
      modernMonthDays: S,
      metonicDays: { months235: 235 * S, years19: 19 * Yd },
      metonicDayPerYears: 19 / Math.abs(235 * S - 19 * Yd), // years for one day of drift
      saros: { synodic223: 223 * S, anomalistic239: 239 * MODERN.anomalisticMonth, draconic242: 242 * MODERN.draconicMonth, mechanism: 223 * mechMonth },
      sarosHours: (223 * S - Math.floor(223 * S)) * 24,
      sarosNodeShiftDeg: (242 * MODERN.draconicMonth - 223 * S) * 360 / MODERN.draconicMonth,
      callippic: { days27759: 27759, years76: 76 * Yd, months940: 940 * S },
      apsidesYears: { mechanism: 1 / R.platform, modern: 1 / (Yd / MODERN.siderealMonth - Yd / MODERN.anomalisticMonth) }
    };
  }

  /** For each later Saros cycle, how many engraved eclipse months still have an eclipse of that kind. */
  function glyphSurvival(cycles) {
    var engraved = ENGRAVED, out = [];
    for (var c = 0; c <= cycles; c++) {
      var cyc = c === 0 ? engraved : sarosCycle(c);
      var lunKeep = 0, lunTot = 0, solKeep = 0, solTot = 0, newOnes = 0;
      for (var i = 0; i < 223; i++) {
        var e = engraved[i], x = cyc[i];
        if (e.lunar && e.lunar.type !== 'penumbral') { lunTot++; if (x.lunar && x.lunar.type !== 'penumbral') lunKeep++; }
        if (e.solar) { solTot++; if (x.solar) solKeep++; }
        if ((x.solar && !e.solar) || (x.lunar && x.lunar.type !== 'penumbral' && !(e.lunar && e.lunar.type !== 'penumbral'))) newOnes++;
      }
      out.push({ cycle: c, years: c * 223 * MODERN.synodicMonth / MODERN.tropicalYear, lunar: [lunKeep, lunTot], solar: [solKeep, solTot], unmarked: newOnes });
    }
    return out;
  }

  return {
    DATA: DATA, GEAR: GEAR, ARBOR_OF: ARBOR_OF, Fr: Fr, frac: frac,
    trainRatio: trainRatio, train: train, teeth: teeth,
    ECC: ECC, pinSlotDeviation: pinSlotDeviation, wrapPi: wrapPi,
    kinematics: kinematics, read: read, sky: sky, R: R,
    jdFromDate: jdFromDate, dateFromJd: dateFromJd, formatDate: formatDate, yearLabel: yearLabel,
    egyptianDate: egyptianDate, EGYPT_MONTHS: EGYPT_MONTHS, NABONASSAR_JD: NABONASSAR_JD,
    deltaT: deltaT, ttFromUt: ttFromUt, jdToYear: jdToYear,
    sunModern: sunModern, moonModern: moonModern, moonElements: moonElements,
    planetMeanLon: planetMeanLon, planetSynodicDays: planetSynodicDays, geocentricCircular: geocentricCircular,
    eclipseAt: eclipseAt, sarosSeries: sarosSeries, meanPhaseJde: meanPhaseJde, sarosCycle: sarosCycle, ENGRAVED: ENGRAVED,
    realEclipsesForMonth: realEclipsesForMonth,
    EPOCH_K: EPOCH_K, EPOCH_JD: EPOCH_JD, EPOCH_JDE: EPOCH_JDE, YEAR_DAYS: YEAR_DAYS, CAL: CAL,
    METONIC_OFFSET_MONTHS: METONIC_OFFSET_MONTHS, MONTHS_PER_YEAR: MONTHS_PER_YEAR,
    yearsFromJd: yearsFromJd, jdFromYears: jdFromYears,
    METONIC_CELLS: METONIC_CELLS, METONIC_MONTHS: METONIC_MONTHS, INTERCALARY_YEARS: INTERCALARY_YEARS, GAMES: GAMES, EXELIGMOS_HOURS: EXELIGMOS_HOURS,
    MODERN: MODERN, driftTable: driftTable, cycleFacts: cycleFacts, glyphSurvival: glyphSurvival,
    norm360: norm360, sgn180: sgn180
  };
});
