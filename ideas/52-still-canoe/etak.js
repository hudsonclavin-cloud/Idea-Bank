/*
 * etak.js — the geometry under "The Still Canoe". Pure and DOM-free.
 * Loads as a classic browser script (globalThis.Etak, so index.html opens from file://)
 * and as a CommonJS module for the node:test suite (etak.test.mjs).
 *
 * WHAT IS MODELLED
 *   1. The star compass. Each point is the place on the horizon where a named star rises or
 *      sets, seen from a given latitude. For a star of declination δ at latitude φ the rising
 *      azimuth A (degrees east of true north) on a geometric horizon is
 *          cos A = sin δ / cos φ
 *      and it sets at 360° − A. No refraction, no dip of the horizon, J2000 star positions.
 *      Polaris is taken as due north; the upright Southern Cross as due south; the two
 *      "leaning" Southern Cross points are where Acrux stands when the cross's long axis
 *      (Gacrux to Acrux) leans 45° from the vertical, found numerically.
 *   2. The Earth as a sphere (mean radius 6371.0088 km), bearings as initial great-circle
 *      bearings, distances in nautical miles (1852 m).
 *   3. A voyage as a great-circle track from one island to another at a given speed history.
 *      The reference island's bearing from the canoe, followed along the track, is cut into
 *      etak segments wherever it reaches the next compass point.
 *   4. The canoe's own frame: every position re-expressed relative to the canoe and rotated
 *      so the bow points up. Same numbers, other origin.
 *   5. Relative motion of a second canoe (closest approach, bearing drift), for the
 *      constant-bearing section.
 *
 * WHAT IS NOT MODELLED: current, leeway, tacking, refraction, precession since J2000,
 *   the curvature of rhumb lines versus great circles (under 0.1° over these distances).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Etak = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var RAD = Math.PI / 180;
  var DEG = 180 / Math.PI;
  var EARTH_RADIUS_KM = 6371.0088;
  var NM_KM = 1.852;
  var EARTH_RADIUS_NM = EARTH_RADIUS_KM / NM_KM;
  var STATUTE_MILE_KM = 1.609344;

  function wrap360(a) { return ((a % 360) + 360) % 360; }
  function wrap180(a) { var x = wrap360(a); return x > 180 ? x - 360 : x; }
  function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

  // ---------------------------------------------------------------- stars (J2000) --------
  // Right ascension in hours, declination in degrees, J2000, as catalogued in SIMBAD
  // (Hipparcos astrometry). `name` is the Western name; `local` is the name used on the
  // Weriyeng-school compass from Polowat (Puluwat) as transcribed in McDonald's
  // polowat-star-compass under the supervision of Mario Benito of Polowat. Spellings
  // differ between islands and schools.
  var STARS = {
    polaris:   { name: 'Polaris',   local: 'Wenewenen fuhemwakut', ra: 2.530303,  dec: 89.264109 },
    kochab:    { name: 'Kochab',    local: 'Mailapanefang',        ra: 14.845091, dec: 74.155505 },
    dubhe:     { name: 'Dubhe',     local: 'Wheleo',               ra: 11.062130, dec: 61.751034 },
    schedar:   { name: 'Schedar',   local: 'Iukunik',              ra: 0.675122,  dec: 56.537331 },
    vega:      { name: 'Vega',      local: 'Meol',                 ra: 18.615649, dec: 38.783692 },
    pleiades:  { name: 'Pleiades',  local: 'Mwarigar',             ra: 3.791414,  dec: 24.105136 }, // Alcyone
    aldebaran: { name: 'Aldebaran', local: 'Wuun',                 ra: 4.598677,  dec: 16.509301 },
    tarazed:   { name: 'Tarazed',   local: 'Paiyefang',            ra: 19.770994, dec: 10.613261 },
    altair:    { name: 'Altair',    local: 'Mailap',               ra: 19.846388, dec: 8.868322 },
    alshain:   { name: 'Alshain',   local: 'Paiyeor',              ra: 19.921889, dec: 6.406763 },
    belt:      { name: "Orion's Belt", local: 'Elieol',            ra: 5.603559,  dec: -1.201919 }, // Alnilam
    gienah:    { name: 'Gienah',    local: 'Haerpwol',             ra: 12.263437, dec: -17.541929 }, // γ Corvi
    antares:   { name: 'Antares',   local: 'Tumwur',               ra: 16.490128, dec: -26.432002 },
    shaula:    { name: 'Shaula',    local: 'Mahariuw',             ra: 17.560145, dec: -37.103821 },
    acrux:     { name: 'Southern Cross', local: 'Ubw',             ra: 12.443311, dec: -63.099092 },
    gacrux:    { name: 'Gacrux',    local: '',                     ra: 12.519433, dec: -57.113213 },
  };

  // The 32 points clockwise from north. `src` says how sure the page is that the point
  // belongs on the Carolinian compass:
  //   'two'  = named by two independent sources (Halpern 1986's table and the Weriyeng list,
  //            or the Penn Museum account of the Puluwat–Truk voyage);
  //   'one'  = only on the Weriyeng list as transcribed by McDonald.
  var POINTS = [
    { star: 'polaris', event: 'pole', src: 'two' },
    { star: 'kochab', event: 'rise', src: 'two' },
    { star: 'dubhe', event: 'rise', src: 'two' },
    { star: 'schedar', event: 'rise', src: 'two' },
    { star: 'vega', event: 'rise', src: 'two' },
    { star: 'pleiades', event: 'rise', src: 'one' },
    { star: 'aldebaran', event: 'rise', src: 'one' },
    { star: 'tarazed', event: 'rise', src: 'one' },
    { star: 'altair', event: 'rise', src: 'two' },
    { star: 'alshain', event: 'rise', src: 'one' },
    { star: 'belt', event: 'rise', src: 'one' },
    { star: 'gienah', event: 'rise', src: 'two' },
    { star: 'antares', event: 'rise', src: 'two' },
    { star: 'shaula', event: 'rise', src: 'two' },
    { star: 'acrux', event: 'rise', src: 'two' },
    { star: 'acrux', event: 'lean', side: 'rise', src: 'one' },
    { star: 'acrux', event: 'upright', src: 'two' },
    { star: 'acrux', event: 'lean', side: 'set', src: 'one' },
    { star: 'acrux', event: 'set', src: 'two' },
    { star: 'shaula', event: 'set', src: 'two' },
    { star: 'antares', event: 'set', src: 'two' },
    { star: 'gienah', event: 'set', src: 'two' },
    { star: 'belt', event: 'set', src: 'one' },
    { star: 'alshain', event: 'set', src: 'one' },
    { star: 'altair', event: 'set', src: 'two' },
    { star: 'tarazed', event: 'set', src: 'one' },
    { star: 'aldebaran', event: 'set', src: 'one' },
    { star: 'pleiades', event: 'set', src: 'one' },
    { star: 'vega', event: 'set', src: 'two' },
    { star: 'schedar', event: 'set', src: 'two' },
    { star: 'dubhe', event: 'set', src: 'two' },
    { star: 'kochab', event: 'set', src: 'two' },
  ];

  /** Azimuth (deg east of true north) where a star of declination dec rises at latitude lat,
   *  on a geometric horizon. Returns null if it never rises or never sets there. */
  function risingAzimuth(dec, lat) {
    var c = Math.sin(dec * RAD) / Math.cos(lat * RAD);
    if (c > 1 || c < -1) return null;
    return Math.acos(c) * DEG;
  }

  /** Altitude and azimuth of a star (RA hours, dec deg) at hour angle H (deg, + west). */
  function altAz(dec, H, lat) {
    var sd = Math.sin(dec * RAD), cd = Math.cos(dec * RAD);
    var sl = Math.sin(lat * RAD), cl = Math.cos(lat * RAD);
    var sh = Math.sin(H * RAD), ch = Math.cos(H * RAD);
    var alt = Math.asin(sl * sd + cl * cd * ch);
    // azimuth from north, clockwise (east = 90)
    var az = Math.atan2(-cd * sh, cl * sd - sl * cd * ch);
    return { alt: alt * DEG, az: wrap360(az * DEG) };
  }

  // Unit vector toward a point of the sky given altitude/azimuth: x east, y north, z up.
  function skyVec(alt, az) {
    var ca = Math.cos(alt * RAD);
    return [ca * Math.sin(az * RAD), ca * Math.cos(az * RAD), Math.sin(alt * RAD)];
  }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function scale(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
  function norm(a) { var n = Math.sqrt(dot(a, a)); return [a[0] / n, a[1] / n, a[2] / n]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }

  /** How far (deg) the Southern Cross's long axis leans from the vertical, seen at the foot
   *  star Acrux, when Acrux is at hour angle H. 0 = upright (Gacrux straight above Acrux). */
  function crossLean(H, lat) {
    var A = STARS.acrux, G = STARS.gacrux;
    var HG = H - (G.ra - A.ra) * 15; // same sidereal moment: H = LST − RA
    var pa = altAz(A.dec, H, lat), pg = altAz(G.dec, HG, lat);
    var a = skyVec(pa.alt, pa.az), g = skyVec(pg.alt, pg.az), z = [0, 0, 1];
    var up = norm(sub(z, scale(a, dot(z, a))));
    var toG = norm(sub(g, scale(a, dot(g, a))));
    return Math.acos(clamp(dot(up, toG), -1, 1)) * DEG;
  }

  /** Azimuth of Acrux when the cross leans 45° on the rising (side='rise') or setting side. */
  function crossLeanAzimuth(lat, side) {
    var H0 = Math.acos(-Math.tan(lat * RAD) * Math.tan(STARS.acrux.dec * RAD)) * DEG; // set hour angle
    // On the rising side H runs from −H0 (rising) to 0 (upright); lean falls from its rising
    // value to ~0. Bisection on lean(H) − 45.
    var lo = side === 'set' ? 0 : -H0, hi = side === 'set' ? H0 : 0;
    var fLo = crossLean(lo, lat) - 45, i, mid, fMid;
    for (i = 0; i < 80; i++) {
      mid = (lo + hi) / 2;
      fMid = crossLean(mid, lat) - 45;
      if ((fMid < 0) === (fLo < 0)) { lo = mid; fLo = fMid; } else hi = mid;
    }
    return altAz(STARS.acrux.dec, (lo + hi) / 2, lat).az;
  }

  /** The 32 compass points at a latitude, each with its azimuth. */
  function compass(lat) {
    return POINTS.map(function (p, k) {
      var s = STARS[p.star], az;
      if (p.event === 'pole') az = 0;
      else if (p.event === 'upright') az = 180;
      else if (p.event === 'lean') az = crossLeanAzimuth(lat, p.side);
      else {
        var r = risingAzimuth(s.dec, lat);
        az = p.event === 'rise' ? r : 360 - r;
      }
      var label = p.event === 'pole' ? 'Polaris'
        : p.event === 'upright' ? 'Southern Cross, upright'
        : p.event === 'lean' ? 'Southern Cross, leaning (' + (p.side === 'rise' ? 'rising' : 'setting') + ')'
        : (p.event === 'rise' ? 'rising ' : 'setting ') + s.name;
      var short = p.event === 'pole' ? 'Polaris'
        : p.event === 'upright' ? 'Cross ⊥'
        : p.event === 'lean' ? 'Cross ∠'
        : s.name === "Orion's Belt" ? 'Belt' : s.name === 'Southern Cross' ? 'Cross' : s.name;
      return { k: k, star: p.star, event: p.event, side: p.side || null, az: az, label: label,
        short: short, local: s.local, src: p.src };
    });
  }

  // ---------------------------------------------------------------- the sphere ----------
  function toVec(p) {
    var la = p.lat * RAD, lo = p.lon * RAD;
    return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  }
  function fromVec(v) {
    var n = norm(v);
    return { lat: Math.asin(clamp(n[2], -1, 1)) * DEG, lon: Math.atan2(n[1], n[0]) * DEG };
  }

  /** Initial great-circle bearing from p to q, degrees east of north. */
  function bearing(p, q) {
    var f1 = p.lat * RAD, f2 = q.lat * RAD, dl = (q.lon - p.lon) * RAD;
    var y = Math.sin(dl) * Math.cos(f2);
    var x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
    return wrap360(Math.atan2(y, x) * DEG);
  }

  /** Great-circle distance, nautical miles (haversine). */
  function distanceNm(p, q) {
    var f1 = p.lat * RAD, f2 = q.lat * RAD, df = f2 - f1, dl = (q.lon - p.lon) * RAD;
    var h = Math.sin(df / 2) * Math.sin(df / 2) + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * Math.asin(Math.min(1, Math.sqrt(h))) * EARTH_RADIUS_NM;
  }

  /** Point a fraction f of the way along the great circle from p to q. */
  function along(p, q, f) {
    var a = toVec(p), b = toVec(q);
    var om = Math.acos(clamp(dot(a, b), -1, 1));
    if (om < 1e-12) return { lat: p.lat, lon: p.lon };
    var s = Math.sin(om);
    var ka = Math.sin((1 - f) * om) / s, kb = Math.sin(f * om) / s;
    return fromVec([a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb]);
  }

  /** Local flat chart around an origin: x east, y north, in nautical miles. */
  function project(p, origin) {
    return {
      x: (p.lon - origin.lon) * 60 * Math.cos(origin.lat * RAD),
      y: (p.lat - origin.lat) * 60,
    };
  }
  function unproject(xy, origin) {
    return { lat: origin.lat + xy.y / 60, lon: origin.lon + xy.x / (60 * Math.cos(origin.lat * RAD)) };
  }

  // ---------------------------------------------------------------- places --------------
  // Positions as published (degrees, minutes, seconds converted). See sources.json.
  var PLACES = {
    puluwat: { name: 'Puluwat', lat: 7 + 21 / 60 + 26 / 3600, lon: 149 + 12 / 60 + 1 / 3600 },
    pisaras: { name: 'Pisaras', lat: 8 + 34 / 60 + 11 / 3600, lon: 150 + 25 / 60 + 9 / 3600 },
    truk: { name: 'Chuuk Lagoon', lat: 7 + 24 / 60 + 54 / 3600, lon: 151 + 44 / 60 + 6 / 3600 },
  };

  // ---------------------------------------------------------------- the voyage ----------
  /**
   * A voyage from `from` to `to` with reference island `ref`. Everything is a function of
   * f, the fraction of the distance sailed (0 at departure, 1 at arrival).
   */
  function makeVoyage(from, to, ref, lat) {
    var total = distanceNm(from, to);
    var midLat = lat == null ? (from.lat + to.lat) / 2 : lat;
    var points = compass(midLat);
    var v = {
      from: from, to: to, ref: ref, total: total, points: points,
      at: function (f) { return along(from, to, clamp(f, 0, 1)); },
      course: function (f) { var c = along(from, to, clamp(f, 0, 1)); return f >= 1 ? wrap360(bearing(to, from) + 180) : bearing(c, to); },
      refBearing: function (f) { return bearing(along(from, to, clamp(f, 0, 1)), ref); },
      refDistance: function (f) { return distanceNm(along(from, to, clamp(f, 0, 1)), ref); },
    };
    v.segments = etakSegments(v);
    return v;
  }

  /** Index of the compass point nearest an azimuth. */
  function nearestPoint(points, az) {
    var best = 0, bd = 1e9;
    for (var i = 0; i < points.length; i++) {
      var d = Math.abs(wrap180(points[i].az - az));
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  /**
   * Cut the voyage into etak. The reference island's bearing is followed from departure to
   * arrival (unwrapped, so it may run below 0° or past 360°). A segment ends each time the
   * bearing reaches the azimuth of a compass point it is moving toward. The first segment is
   * named by the point nearest the island at departure. Returns
   *   { crossings: [{f, point}], segments: [{fromF, toF, lengthNm, startPoint, endPoint}],
   *     startPoint, endPoint, sweep (deg, signed) }
   */
  function etakSegments(v) {
    var N = 2000, i, b, prev = v.refBearing(0), unwrapped = [prev], fs = [0];
    for (i = 1; i <= N; i++) {
      b = v.refBearing(i / N);
      prev = prev + wrap180(b - wrap360(prev));
      unwrapped.push(prev); fs.push(i / N);
    }
    var b0 = unwrapped[0], b1 = unwrapped[N], dir = b1 < b0 ? -1 : 1;
    var crossings = [];
    // every compass azimuth, in every turn the unwrapped bearing might visit
    for (var p = 0; p < v.points.length; p++) {
      for (var turn = -2; turn <= 2; turn++) {
        var a = v.points[p].az + 360 * turn;
        // strictly between start and end, in the direction of travel
        if (!((a - b0) * dir > 1e-9 && (b1 - a) * dir >= -1e-9)) continue;
        // locate on the sampled curve, then refine by bisection on the true function
        for (i = 0; i < N; i++) {
          if ((unwrapped[i] - a) * (unwrapped[i + 1] - a) <= 0) {
            var lo = fs[i], hi = fs[i + 1], ulo = unwrapped[i];
            for (var k = 0; k < 60; k++) {
              var mid = (lo + hi) / 2;
              var um = ulo + wrap180(v.refBearing(mid) - wrap360(ulo));
              if ((um - a) * (ulo - a) > 0) { lo = mid; ulo = um; } else hi = mid;
            }
            crossings.push({ f: (lo + hi) / 2, point: p, az: v.points[p].az });
            break;
          }
        }
      }
    }
    crossings.sort(function (x, y) { return x.f - y.f; });
    var startPoint = nearestPoint(v.points, wrap360(b0));
    var endPoint = nearestPoint(v.points, wrap360(b1));
    var segs = [], f0 = 0, sp = startPoint;
    crossings.forEach(function (c) {
      segs.push({ fromF: f0, toF: c.f, lengthNm: (c.f - f0) * v.total, startPoint: sp, endPoint: c.point });
      f0 = c.f; sp = c.point;
    });
    // the last stretch: from the last crossing to arrival, heading for the next point
    var nextAfter = null;
    for (var j = 0; j < v.points.length; j++) {
      var az = v.points[j].az;
      for (var t = -2; t <= 2; t++) {
        var a2 = az + 360 * t;
        if ((a2 - b1) * dir > 1e-9 && (nextAfter == null || Math.abs(a2 - b1) < Math.abs(nextAfter.a - b1))) nextAfter = { a: a2, p: j };
      }
    }
    segs.push({ fromF: f0, toF: 1, lengthNm: (1 - f0) * v.total, startPoint: sp,
      endPoint: nextAfter ? nextAfter.p : endPoint, partial: true });
    return { crossings: crossings, segments: segs, startPoint: startPoint, endPoint: endPoint,
      startBearing: wrap360(b0), endBearing: wrap360(b1), sweep: b1 - b0 };
  }

  /** Which segment (0-based) the canoe is in at fraction f. */
  function segmentAt(v, f) {
    var s = v.segments.segments;
    for (var i = 0; i < s.length; i++) if (f < s[i].toF || i === s.length - 1) return i;
    return s.length - 1;
  }

  /** Inverse etak: the fraction of the voyage at which the reference island would lie at
   *  bearing `az`. Searches the monotone unwrapped bearing; clamps to [0,1]. */
  function fractionForBearing(v, az) {
    var b0 = v.refBearing(0), seg = v.segments, sweep = seg.sweep;
    // place az on the unwrapped scale nearest the voyage's sweep
    var target = b0 + wrap180(az - b0);
    var candidates = [target, target - 360, target + 360];
    var lo0 = Math.min(b0, b0 + sweep), hi0 = Math.max(b0, b0 + sweep);
    var best = candidates[0], bd = 1e9;
    candidates.forEach(function (c) {
      var d = c < lo0 ? lo0 - c : c > hi0 ? c - hi0 : 0;
      if (d < bd) { bd = d; best = c; }
    });
    if (bd > 0) return best <= lo0 ? (sweep < 0 ? 1 : 0) : (sweep < 0 ? 0 : 1);
    var lo = 0, hi = 1, ulo = b0;
    for (var k = 0; k < 70; k++) {
      var mid = (lo + hi) / 2;
      var um = unwrapAt(v, mid, b0, sweep);
      if ((um - best) * (ulo - best) > 0) { lo = mid; ulo = um; } else hi = mid;
    }
    return (lo + hi) / 2;
  }
  function unwrapAt(v, f, b0, sweep) {
    // the unwrapped bearing is monotone, so pick the branch nearest the linear guess
    var guess = b0 + sweep * f;
    return guess + wrap180(v.refBearing(f) - wrap360(guess));
  }

  // ---------------------------------------------------------------- frames --------------
  /**
   * Where a place appears from the canoe: bearing relative to the bow (deg, + to starboard),
   * distance (nm), and x/y in a bow-up frame (x to starboard, y ahead). The stars do not
   * appear here: they have no distance, only an azimuth, and their relative bearing is
   * simply azimuth − course.
   */
  function canoeFrame(canoe, course, place) {
    var b = bearing(canoe, place), d = distanceNm(canoe, place), rel = wrap180(b - course);
    return { bearing: b, rel: rel, dist: d, x: d * Math.sin(rel * RAD), y: d * Math.cos(rel * RAD) };
  }
  /** Back from the canoe's frame to the chart: undo the rotation and the translation. */
  function chartFromCanoe(canoe, course, xy) {
    var d = Math.sqrt(xy.x * xy.x + xy.y * xy.y);
    var b = wrap360(course + Math.atan2(xy.x, xy.y) * DEG);
    // travel d nm from the canoe on initial bearing b (great circle)
    var dr = d / EARTH_RADIUS_NM, f1 = canoe.lat * RAD, l1 = canoe.lon * RAD, th = b * RAD;
    var f2 = Math.asin(Math.sin(f1) * Math.cos(dr) + Math.cos(f1) * Math.sin(dr) * Math.cos(th));
    var l2 = l1 + Math.atan2(Math.sin(th) * Math.sin(dr) * Math.cos(f1), Math.cos(dr) - Math.sin(f1) * Math.sin(f2));
    return { lat: f2 * DEG, lon: l2 * DEG };
  }

  // ---------------------------------------------------------------- sighting ------------
  /** Distance (nm) at which an object of height hObj (m) shows above the sea horizon for an
   *  eye at hEye (m), with standard refraction: D = 1.17 (√h_eye,ft + √h_obj,ft) nmi
   *  (Bowditch, The American Practical Navigator). */
  function sightingRangeNm(hEyeM, hObjM) {
    var ft = 1 / 0.3048;
    return 1.17 * (Math.sqrt(hEyeM * ft) + Math.sqrt(hObjM * ft));
  }

  /** Closest distance from the reference island to the track, sampled finely. */
  function closestApproach(v) {
    var best = { f: 0, d: Infinity };
    for (var i = 0; i <= 4000; i++) {
      var d = v.refDistance(i / 4000);
      if (d < best.d) best = { f: i / 4000, d: d };
    }
    return best;
  }

  // ---------------------------------------------------------------- dead reckoning ------
  /** Turn a speed history [{hours, knots}] into elapsed-hours checkpoints and fractions. */
  function legsToTimeline(legs, total) {
    var t = 0, s = 0, out = [{ t: 0, s: 0, f: 0 }];
    legs.forEach(function (l) {
      t += l.hours; s += l.hours * l.knots;
      out.push({ t: t, s: Math.min(s, total), f: Math.min(1, s / total), knots: l.knots, hours: l.hours });
    });
    return out;
  }

  /**
   * An invented speed history for the "in the dark" exercise: n stretches at 3.2–6.8 knots,
   * lengths chosen so the voyage comes out at `total`, rounded to half hours, then every
   * speed nudged by the same few per cent so the distance closes exactly. `rand` returns [0,1).
   */
  function makeLegs(rand, total, n) {
    var legs = [], wsum = 0, raw = 0, i;
    for (i = 0; i < n; i++) legs.push({ knots: 3.2 + rand() * 3.6, w: 0.8 + rand() * 0.4 });
    legs.forEach(function (l) { wsum += l.w * l.knots; });
    legs.forEach(function (l) {
      l.hours = Math.max(1, Math.round(2 * l.w * total / wsum) / 2);
      raw += l.hours * l.knots;
      delete l.w;
    });
    var k = total / raw;
    legs.forEach(function (l) { l.knots *= k; });
    return legs;
  }

  // ---------------------------------------------------------------- relative motion -----
  /**
   * Another vessel at relative position P (x right, y ahead, nm) with relative velocity
   * V (nm/h). Returns time (h) and distance (nm) of closest approach, and the bearing rate
   * now (deg/h, + = drawing right).
   */
  function cpa(P, V) {
    var vv = V.x * V.x + V.y * V.y;
    var t = vv > 0 ? -(P.x * V.x + P.y * V.y) / vv : 0;
    if (t < 0) t = 0;
    var cx = P.x + V.x * t, cy = P.y + V.y * t;
    var rr = P.x * P.x + P.y * P.y;
    // d/dt atan2(x, y) = (y·vx − x·vy) / r²
    var rate = rr > 0 ? (P.y * V.x - P.x * V.y) / rr * DEG : 0;
    return { t: t, d: Math.sqrt(cx * cx + cy * cy), bearingRate: rate };
  }

  /** Bearing (deg, relative to own bow) of the other vessel at time t. */
  function relBearingAt(P, V, t) {
    return Math.atan2(P.x + V.x * t, P.y + V.y * t) * DEG;
  }

  return {
    RAD: RAD, DEG: DEG, EARTH_RADIUS_NM: EARTH_RADIUS_NM, NM_KM: NM_KM, STATUTE_MILE_KM: STATUTE_MILE_KM,
    STARS: STARS, POINTS: POINTS, PLACES: PLACES,
    wrap360: wrap360, wrap180: wrap180, clamp: clamp,
    risingAzimuth: risingAzimuth, altAz: altAz, crossLean: crossLean, crossLeanAzimuth: crossLeanAzimuth,
    compass: compass, nearestPoint: nearestPoint,
    toVec: toVec, fromVec: fromVec, bearing: bearing, distanceNm: distanceNm, along: along,
    project: project, unproject: unproject,
    makeVoyage: makeVoyage, etakSegments: etakSegments, segmentAt: segmentAt,
    fractionForBearing: fractionForBearing,
    canoeFrame: canoeFrame, chartFromCanoe: chartFromCanoe,
    sightingRangeNm: sightingRangeNm, closestApproach: closestApproach,
    legsToTimeline: legsToTimeline, makeLegs: makeLegs, cpa: cpa, relBearingAt: relBearingAt,
  };
});
