/* First Light, Last Light: the pure model.
   Sun position, the design of the box for a place, the planar map of its plan, the solid
   built from that map, and a binary STL writer. No DOM, no clock, no randomness, so the
   same inputs always give the same bytes. Loads as a classic script (window.FirstLight)
   and with require(). Units: millimetres and degrees; azimuth is from north, eastward. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FirstLight = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const RAD = Math.PI / 180;
  const sind = (d) => Math.sin(d * RAD);
  const cosd = (d) => Math.cos(d * RAD);
  const tand = (d) => Math.tan(d * RAD);
  const asind = (x) => Math.asin(Math.max(-1, Math.min(1, x))) / RAD;
  const acosd = (x) => Math.acos(Math.max(-1, Math.min(1, x))) / RAD;
  const atan2d = (y, x) => Math.atan2(y, x) / RAD;
  const norm360 = (a) => ((a % 360) + 360) % 360;
  const wrap180 = (a) => norm360(a + 180) - 180;

  /* ------------------------------------------------------------------ calendar */

  function julianDay(year, month, day, hours) {
    let y = year, m = month;
    if (m <= 2) { y -= 1; m += 12; }
    const a = Math.floor(y / 100), b = 2 - a + Math.floor(a / 4);
    return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + b - 1524.5 + (hours || 0) / 24;
  }
  function calendarDate(jd) { // Meeus, Astronomical Algorithms, ch. 7
    const z = Math.floor(jd + 0.5), f = jd + 0.5 - z;
    const alpha = Math.floor((z - 1867216.25) / 36524.25);
    const a = z + 1 + alpha - Math.floor(alpha / 4);
    const b = a + 1524, c = Math.floor((b - 122.1) / 365.25), d = Math.floor(365.25 * c), e = Math.floor((b - d) / 30.6001);
    const day = b - d - Math.floor(30.6001 * e) + f;
    const month = e < 14 ? e - 1 : e - 13;
    const year = month > 2 ? c - 4716 : c - 4715;
    return { year, month, day: Math.floor(day), hours: (day - Math.floor(day)) * 24 };
  }
  const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const daysInMonth = (y, m) => (m === 2 && isLeap(y) ? 29 : MONTH_DAYS[m - 1]);
  function dateOfYear(year, n) { // n = 1 .. 365/366
    let m = 1, d = n;
    while (d > daysInMonth(year, m)) { d -= daysInMonth(year, m); m++; }
    return { year, month: m, day: d };
  }
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmtDate = (d) => `${d.day} ${MONTHS[d.month - 1]}`;

  /* ------------------------------------------------------------------ the Sun */

  const DELTA_T = 69; // seconds, TT - UT, about right for the 2020s and 2030s

  // Apparent geocentric position, Meeus ch. 25 ("low accuracy", about 0.01 degree).
  function sun(jdUT) {
    const T = (jdUT + DELTA_T / 86400 - 2451545) / 36525;
    const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
    const M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
    const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * sind(M) + (0.019993 - 0.000101 * T) * sind(2 * M) + 0.000289 * sind(3 * M);
    const omega = 125.04 - 1934.136 * T;
    const lambda = L0 + C - 0.00569 - 0.00478 * sind(omega);
    const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
    const eps = eps0 + 0.00256 * cosd(omega);
    return {
      lambda: norm360(lambda),
      delta: asind(sind(eps) * sind(lambda)),
      alpha: norm360(atan2d(cosd(eps) * sind(lambda), cosd(lambda))),
      eps,
    };
  }
  function gmst(jdUT) { // degrees, Meeus eq. 12.4
    const d = jdUT - 2451545, T = d / 36525;
    return norm360(280.46061837 + 360.98564736629 * d + 0.000387933 * T * T - (T * T * T) / 38710000);
  }
  // Geometric (unrefracted) altitude and azimuth of the Sun's centre. lon is east-positive.
  function horizontal(jdUT, lat, lon) {
    const s = sun(jdUT);
    const H = gmst(jdUT) + lon - s.alpha;
    const alt = asind(sind(lat) * sind(s.delta) + cosd(lat) * cosd(s.delta) * cosd(H));
    const az = norm360(atan2d(-cosd(s.delta) * sind(H), sind(s.delta) * cosd(lat) - cosd(s.delta) * sind(lat) * cosd(H)));
    return { alt, az, delta: s.delta };
  }
  // Bennett (1982): refraction in degrees for an object seen at apparent altitude h (degrees).
  const refraction = (h) => 1 / tand(h + 7.31 / (h + 4.4)) / 60;
  // Geometric altitude of the Sun's centre when its centre is seen on a horizon at apparent altitude h.
  const centreAltitude = (h) => h - refraction(h);

  // The moment on a local date when the Sun's centre is seen on the horizon (half the disc up),
  // rising or setting, and where it is. Dates are local solar dates at longitude lon.
  function sunEvent(year, month, day, lat, lon, kind, horizon) {
    return sunAtAltitude(year, month, day, lat, lon, kind, centreAltitude(horizon));
  }
  // The same, for any geometric (unrefracted) altitude of the Sun's centre.
  function sunAtAltitude(year, month, day, lat, lon, kind, target) {
    let t = julianDay(year, month, day, 12 - lon / 15);
    for (let i = 0; i < 8; i++) {
      const s = sun(t);
      const c = (sind(target) - sind(lat) * sind(s.delta)) / (cosd(lat) * cosd(s.delta));
      if (c <= -1 || c >= 1) return null;
      const H0 = acosd(c);
      const now = wrap180(gmst(t) + lon - s.alpha);
      t += wrap180((kind === 'rise' ? -H0 : H0) - now) / 360.98564736629;
    }
    const h = horizontal(t, lat, lon);
    return { jd: t, az: h.az, alt: h.alt, delta: h.delta };
  }
  // Azimuth (degrees from north) where a point of declination delta crosses geometric altitude h, rising.
  function riseAzimuth(delta, lat, h) {
    return acosd((sind(delta) - sind(lat) * sind(h)) / (cosd(lat) * cosd(h)));
  }
  // Local apparent noon: the moment the Sun's hour angle is zero, on a local date at longitude lon.
  function solarNoon(year, month, day, lon) {
    let t = julianDay(year, month, day, 12 - lon / 15);
    for (let i = 0; i < 6; i++) {
      const s = sun(t);
      t -= wrap180(gmst(t) + lon - s.alpha) / 360.98564736629;
    }
    return t;
  }
  const SEMIDIAMETER = 0.2667; // the Sun's apparent radius, degrees (it varies from 0.262 to 0.271)
  // Around a sunrise or sunset: when the stripe first appears (the Sun's upper edge on the horizon),
  // the moment the box is cut for (half the disc up), and when the whole disc is up; and how fast
  // the Sun's azimuth is moving then, in degrees per minute. Each limb is refracted by its own height.
  function eventTimes(year, month, day, lat, lon, kind, horizon) {
    const at = (geo) => sunAtAltitude(year, month, day, lat, lon, kind, geo);
    const mid = sunEvent(year, month, day, lat, lon, kind, horizon);
    if (!mid) return null;
    const upper = at(centreAltitude(horizon) - SEMIDIAMETER), lower = at(centreAltitude(horizon) + SEMIDIAMETER);
    const dt = 0.5 / 1440;
    const a0 = horizontal(mid.jd - dt, lat, lon).az, a1 = horizontal(mid.jd + dt, lat, lon).az;
    const first = kind === 'rise' ? upper : lower, last = kind === 'rise' ? lower : upper;
    return { first: first && first.jd, mid: mid.jd, last: last && last.jd, az: mid.az, azPerMinute: Math.abs(wrap180(a1 - a0)) };
  }

  /* ------------------------------------------------------------------ the design */

  const FIXED = Object.freeze({
    wall: 2.4,          // wall thickness
    floor: 2.0,         // floor thickness
    height: 30,         // wall top above the bed
    chamfer: 0.4,       // bottom-edge chamfer
    land: 0.5,          // straight part of each slit jaw, at the outer face
    grooveWidth: 1.0,
    grooveDepth: 0.6,
    slotWidth: 1.2,
    engrave: 0.6,       // depth of the lettering in the floor
    minSolid: 0.8,      // least wall left between two features on the inner face (two perimeters)
    minPillar: 2.4,     // least wall left between two cuts that go right through it (a slot and a slit)
    tess: 2,            // largest angular step along an arc, degrees
    epoch: 2026,        // obliquity and the years averaged for your day
  });
  const LIMITS = Object.freeze({
    lat: [-58, 58], lon: [-180, 180], horizonE: [-1, 5], horizonW: [-1, 5], size: [70, 102], slit: [0.8, 1.6],
  });
  const DEFAULTS = Object.freeze({ lat: 45, lon: 0, horizonE: 0, horizonW: 0, size: 100, slit: 1.2, day: '', label: true });

  // One groove per 15 degrees of the Sun's longitude from solstice to solstice: the 24 solar terms,
  // two to a groove because longitudes L and 180 - L share a declination.
  // English names as the Hong Kong Observatory gives them, by longitude 0, 15, ... 345 degrees.
  const TERM_NAMES = ['Vernal equinox', 'Bright and clear', 'Corn rain', 'Summer commences', 'Corn forms', 'Corn on ear',
    'Summer solstice', 'Moderate heat', 'Great heat', 'Autumn commences', 'End of heat', 'White dew',
    'Autumnal equinox', 'Cold dew', 'Frost', 'Winter commences', 'Light snow', 'Heavy snow',
    'Winter solstice', 'Moderate cold', 'Severe cold', 'Spring commences', 'Spring showers', 'Insects waken'];
  const GROOVES = [];
  for (let k = -6; k <= 6; k++) {
    const a = norm360(15 * k), b = norm360(180 - 15 * k);
    const level = Math.abs(k) === 6 || k === 0 ? 3 : Math.abs(k) === 3 ? 2 : 1; // long, middle, short
    GROOVES.push({ k, longitudes: a === b ? [a] : [a, b], names: (a === b ? [a] : [a, b]).map((l) => TERM_NAMES[l / 15]), level });
  }

  function parseDay(s) {
    if (!s) return null;
    const m = /^(\d{1,2})-(\d{1,2})$/.exec(String(s).trim());
    if (!m) throw new RangeError('day must look like MM-DD');
    const month = +m[1], day = +m[2];
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth(2028, month)) throw new RangeError('no such day');
    return { month, day };
  }

  function params(input) {
    const p = Object.assign({}, DEFAULTS, input || {});
    for (const k of Object.keys(LIMITS)) {
      p[k] = Number(p[k]);
      if (!Number.isFinite(p[k])) throw new RangeError(k + ' must be a number');
      if (p[k] < LIMITS[k][0] - 1e-9 || p[k] > LIMITS[k][1] + 1e-9) throw new RangeError(`${k} must be between ${LIMITS[k][0]} and ${LIMITS[k][1]}`);
    }
    p.dayParsed = parseDay(p.day);
    p.label = p.label !== false;
    return p;
  }

  // Years whose event azimuths are averaged for a chosen day: a whole leap cycle.
  function dayYears(d) {
    if (d.month === 2 && d.day === 29) return [FIXED.epoch + 2];
    return [0, 1, 2, 3].map((i) => FIXED.epoch + i);
  }
  // Mean amplitude (degrees north of due east, or of due west) of sunrise or sunset on a day.
  function dayAmplitude(p, d, kind) {
    const ys = dayYears(d);
    let sum = 0;
    for (const y of ys) {
      const e = sunEvent(y, d.month, d.day, p.lat, p.lon, kind, kind === 'rise' ? p.horizonE : p.horizonW);
      sum += kind === 'rise' ? 90 - e.az : e.az - 270;
    }
    return sum / ys.length;
  }

  // Where light from a Sun of amplitude amp (degrees north of due east at sunrise, or of due west at
  // sunset) lands on the far wall, as an angle about that wall's centre, which is the outer face of the
  // near slit. Light crosses the slit's straight land at its midpoint, half a land inside that face, so
  // it lands a little nearer the axis than -amp: by the sine rule, by asin((land / 2) sin(amp) / R).
  function wallTheta(R, amp) { return -(amp - asind(((FIXED.land / 2) * sind(amp)) / R)); }
  // Does the light from the near slit leave through the far slit? Its centre must pass the far slit's land.
  function throughFarSlit(d, amp) { return Math.abs((d.D - FIXED.land) * tand(amp)) < d.params.slit / 2; }

  // Everything about the box for one place, before any geometry is built.
  function design(input) {
    const p = params(input);
    const D = p.size, t = FIXED.wall, R = D - t;
    const eps = sun(julianDay(FIXED.epoch, 1, 1)).eps;
    const hE = centreAltitude(p.horizonE), hW = centreAltitude(p.horizonW);
    const ampRise = (delta) => 90 - riseAzimuth(delta, p.lat, hE);
    const ampSet = (delta) => 90 - riseAzimuth(delta, p.lat, hW);
    const halfAngle = (w) => asind(w / 2 / R);

    // Light from a sunrise amplitude a (north of east) crosses the box from the east slit and lands on
    // the west wall at angle -a (south of the axis when a > 0); sunset light lands on the east wall the same way.
    const marks = { W: [], E: [] };
    GROOVES.forEach((g, gi) => {
      const delta = asind(sind(eps) * sind(15 * g.k));
      marks.W.push({ kind: 'groove', groove: gi, level: g.level, delta, amp: ampRise(delta), theta: wallTheta(R, ampRise(delta)), half: halfAngle(FIXED.grooveWidth), priority: g.level });
      marks.E.push({ kind: 'groove', groove: gi, level: g.level, delta, amp: ampSet(delta), theta: wallTheta(R, ampSet(delta)), half: halfAngle(FIXED.grooveWidth), priority: g.level });
    });
    let your = null;
    if (p.dayParsed) {
      const aR = dayAmplitude(p, p.dayParsed, 'rise'), aS = dayAmplitude(p, p.dayParsed, 'set');
      your = { month: p.dayParsed.month, day: p.dayParsed.day, ampRise: aR, ampSet: aS };
      marks.W.push({ kind: 'slot', amp: aR, theta: wallTheta(R, aR), half: halfAngle(FIXED.slotWidth), priority: 10 });
      marks.E.push({ kind: 'slot', amp: aS, theta: wallTheta(R, aS), half: halfAngle(FIXED.slotWidth), priority: 10 });
    }

    // Each slit's jaws flare inwards just wider than the steepest light it must pass.
    const steepest = (list) => Math.max(...list.map((m) => Math.abs(m.amp) + m.half));
    const flare = { E: Math.min(64, steepest(marks.W) + 4), W: Math.min(64, steepest(marks.E) + 4) };
    const thetaIn = acosd(D / 2 / R);
    const walls = {};
    const dropped = [];
    for (const side of ['W', 'E']) {
      const ownFlare = flare[side];
      const slitHalfMM = p.slit / 2 + (t - FIXED.land) * tand(ownFlare);
      const feats = [{ kind: 'slit', theta: 0, half: asind(slitHalfMM / R), priority: 100 }].concat(marks[side]);
      // keep a margin from the cusps, then resolve collisions by priority
      const edgeLimit = thetaIn - asind(4 / R);
      let kept = feats.filter((f) => {
        if (Math.abs(f.theta) + f.half <= edgeLimit) return true;
        dropped.push({ side, kind: f.kind, groove: f.groove, reason: 'too close to the tip' });
        return false;
      });
      const through = (f) => f.kind === 'slit' || f.kind === 'slot';
      const gapFor = (a, b) => asind((through(a) && through(b) ? FIXED.minPillar : FIXED.minSolid) / R);
      for (;;) {
        kept.sort((a, b) => a.theta - b.theta);
        let clash = -1;
        for (let i = 0; i + 1 < kept.length && clash < 0; i++) {
          if (kept[i + 1].theta - kept[i + 1].half - (kept[i].theta + kept[i].half) < gapFor(kept[i], kept[i + 1])) clash = i;
        }
        if (clash < 0) break;
        const a = kept[clash], b = kept[clash + 1];
        // the lower priority goes; between equals, the one nearer the axis (the solstice end is kept)
        const loser = a.priority !== b.priority ? (a.priority < b.priority ? a : b) : (Math.abs(a.theta) < Math.abs(b.theta) ? a : b);
        const winner = loser === a ? b : a;
        dropped.push({ side, kind: loser.kind, groove: loser.groove, reason: winner.kind === 'slit' ? 'inside the far slit' : winner.kind === 'slot' ? 'covered by your slot' : 'crowded by its neighbour' });
        kept = kept.filter((x) => x !== loser);
      }
      walls[side] = { side, flare: ownFlare, slitHalfMM, features: kept };
    }
    // With a raised skyline the Sun is h degrees up at the moment the box is cut for, and light passing
    // over the near wall's top lights the far wall directly above about Z - R tan h. Only below that can
    // the stripe from the slit be told from the rest of the wall. W is read in the morning (eastern skyline).
    const readTop = (h) => (h > 0 ? FIXED.height - R * tand(h) : FIXED.height);
    return {
      params: p, D, R, t, T: FIXED.floor, Z: FIXED.height, eps, hE, hW, thetaIn, walls, dropped, your,
      readTop: { W: readTop(p.horizonE), E: readTop(p.horizonW) },
      grooves: GROOVES.map((g, gi) => ({ ...g, delta: marks.W[gi].delta, ampRise: marks.W[gi].amp, ampSet: marks.E[gi].amp })),
    };
  }

  // Where a groove stops, coming down from the wall top: long ones reach the floor; middle and short
  // ones reach two thirds and one third of the way down the part of the wall the stripe can be seen on
  // (all of it under a flat or sunken skyline, less under a raised one), so each meets the stripe.
  function grooveBottom(d, level, side) {
    if (level === 3) return d.T;
    const top = d.readTop[side];
    return top - (level === 2 ? 2 / 3 : 1 / 3) * (top - d.T);
  }

  /* ------------------------------------------------------------------ lettering */

  // A small stencil alphabet: every stroke is its own convex polygon with a gap round it, so the
  // floor between strokes is never thinner than the gap. Glyph box is w x h, origin bottom-left.
  function glyphPolys(ch, w, h, s, g) {
    const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    // full-height uprights split at the middle, short bars between them: a seven-segment stencil
    const segs = {
      a: rect(s + g, h - s, w - s - g, h), d: rect(s + g, 0, w - s - g, s), gg: rect(s + g, h / 2 - s / 2, w - s - g, h / 2 + s / 2),
      f: rect(0, h / 2 + g / 2, s, h), b: rect(w - s, h / 2 + g / 2, w, h),
      e: rect(0, 0, s, h / 2 - g / 2), c: rect(w - s, 0, w, h / 2 - g / 2),
    };
    const seven = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abfgcd', S: 'afgcd' };
    if (seven[ch]) return seven[ch].split('').map((k) => segs[k === 'g' ? 'gg' : k]);
    if (ch === 'N') { // the diagonal is cut with vertical ends; dy keeps its true width at s
      const x1 = s + g, x2 = w - s - g, dy = (s * Math.hypot(x2 - x1, h)) / (x2 - x1);
      return [rect(0, 0, s, h), rect(w - s, 0, w, h), [[x1, h], [x1, h - dy], [x2, 0], [x2, dy]]];
    }
    if (ch === '.') return [rect(w / 2 - s / 2, 0, w / 2 + s / 2, s)];
    if (ch === '°') return [rect(w / 2 - 0.8 * s, h - 1.6 * s, w / 2 + 0.8 * s, h)];
    if (ch === ' ') return [];
    throw new Error('no glyph for ' + ch);
  }
  // Polygons for a line of text centred at (cx, cy).
  function textPolys(text, cx, cy, size) {
    const h = size, w = size * 0.62, s = Math.max(0.8, size * 0.13), g = 0.45, adv = w + size * 0.28;
    const widthOf = (ch) => (ch === '.' || ch === '°' || ch === ' ' ? w * 0.5 : w);
    const total = [...text].reduce((n, ch) => n + widthOf(ch) + (adv - w), 0) - (adv - w);
    let x = cx - total / 2;
    const out = [];
    for (const ch of text) {
      const cw = widthOf(ch);
      for (const poly of glyphPolys(ch, cw === w ? w : w, h, s, g)) out.push(poly.map(([px, py]) => [x + px - (cw === w ? 0 : w / 4), cy - h / 2 + py]));
      x += cw + (adv - w);
    }
    return out;
  }
  function latitudeText(lat) {
    const a = Math.abs(lat);
    return (Math.round(a * 10) / 10).toFixed(1) + '°' + (lat >= 0 ? 'N' : 'S');
  }

  /* ------------------------------------------------------------------ the plan as a planar map */

  // Every region is a polygon (ids into one shared point list) with a top height. Regions that touch
  // share the exact same run of points along their common edge, so the extruded solid is closed.
  function lensMap(d) {
    const pts = [];
    const add = (xy) => { pts.push(xy); return pts.length - 1; };
    const { D, R, t } = d;
    const centre = { W: [D / 2, 0], E: [-D / 2, 0] };
    const unit = (side, th) => (side === 'W' ? [-cosd(th), sind(th)] : [cosd(th), sind(th)]);
    const onArc = (side, rho, th) => { const u = unit(side, th), c = centre[side]; return [c[0] + rho * u[0], c[1] + rho * u[1]]; };
    const angleOf = (side, xy) => { const c = centre[side]; const v = [xy[0] - c[0], xy[1] - c[1]]; return side === 'W' ? atan2d(v[1], -v[0]) : atan2d(v[1], v[0]); };
    // point on a line parallel to the ray at angle th, offset o (positive towards larger angles), at distance rho from the centre
    const offsetPoint = (side, th, o, rho) => {
      const u = unit(side, th), n = side === 'W' ? [-u[1], u[0]] : [-u[1], u[0]];
      // n must point towards increasing angle
      const test = onArc(side, rho, th + 1);
      const sgn = (test[0] - centre[side][0] - rho * u[0]) * n[0] + (test[1] - centre[side][1] - rho * u[1]) * n[1] > 0 ? 1 : -1;
      const along = Math.sqrt(rho * rho - o * o), c = centre[side];
      return [c[0] + sgn * o * n[0] + along * u[0], c[1] + sgn * o * n[1] + along * u[1]];
    };
    const thetaOut = 60, thetaIn = d.thetaIn;
    const cuspOut = { N: add([0, D * Math.sqrt(3) / 2]), S: add([0, -D * Math.sqrt(3) / 2]) };
    const cuspIn = { N: add([0, Math.sqrt(R * R - D * D / 4)]), S: add([0, -Math.sqrt(R * R - D * D / 4)]) };

    const arcs = {}; // side -> { outer: [{th, id}], inner: [{th, id}], features }
    const channels = [];
    const grooveCells = [];
    for (const side of ['W', 'E']) {
      const wall = d.walls[side];
      const outer = [], inner = [], blocked = { outer: [], inner: [] };
      for (const f of wall.features) {
        if (f.kind === 'groove') {
          const o = FIXED.grooveWidth / 2;
          const A1 = add(offsetPoint(side, f.theta, -o, R)), A2 = add(offsetPoint(side, f.theta, o, R));
          const B1 = add(offsetPoint(side, f.theta, -o, R + FIXED.grooveDepth)), B2 = add(offsetPoint(side, f.theta, o, R + FIXED.grooveDepth));
          inner.push({ th: angleOf(side, pts[A1]), id: A1 }, { th: angleOf(side, pts[A2]), id: A2 });
          blocked.inner.push([angleOf(side, pts[A1]), angleOf(side, pts[A2])]);
          grooveCells.push({ side, f, lo: { a: A1, b: B1 }, hi: { a: A2, b: B2 }, z: grooveBottom(d, f.level, side) });
        } else if (f.kind === 'slot') {
          const o = FIXED.slotWidth / 2;
          const I1 = add(offsetPoint(side, f.theta, -o, R)), I2 = add(offsetPoint(side, f.theta, o, R));
          const O1 = add(offsetPoint(side, f.theta, -o, D)), O2 = add(offsetPoint(side, f.theta, o, D));
          inner.push({ th: angleOf(side, pts[I1]), id: I1 }, { th: angleOf(side, pts[I2]), id: I2 });
          outer.push({ th: angleOf(side, pts[O1]), id: O1 }, { th: angleOf(side, pts[O2]), id: O2 });
          blocked.inner.push([angleOf(side, pts[I1]), angleOf(side, pts[I2])]);
          blocked.outer.push([angleOf(side, pts[O1]), angleOf(side, pts[O2])]);
          channels.push({ side, f, lo: [O1, I1], hi: [O2, I2], z: d.T });
        } else { // the slit on the axis: a straight land at the outer face, then jaws flaring inwards
          const s = d.params.slit / 2, L = FIXED.land, a = wall.flare;
          const c = centre[side], u = unit(side, 0);
          const sideLine = (sg) => {
            const O = offsetPoint(side, 0, sg * s, D);
            const J1 = [O[0] - L * u[0], O[1] - L * u[1]];
            // flare direction: inwards (-u) and away from the axis
            const away = [O[0] - c[0] - u[0] * ((O[0] - c[0]) * u[0] + (O[1] - c[1]) * u[1]), O[1] - c[1] - u[1] * ((O[0] - c[0]) * u[0] + (O[1] - c[1]) * u[1])];
            const an = Math.hypot(away[0], away[1]);
            const fdir = [-cosd(a) * u[0] + sind(a) * away[0] / an, -cosd(a) * u[1] + sind(a) * away[1] / an];
            // first intersection of J1 + tau * fdir with the inner circle |x - c| = R
            const px = J1[0] - c[0], py = J1[1] - c[1];
            const B = px * fdir[0] + py * fdir[1], Cc = px * px + py * py - R * R;
            const tau = -B - Math.sqrt(B * B - Cc);
            const J2 = [J1[0] + tau * fdir[0], J1[1] + tau * fdir[1]];
            return [add(O), add(J1), add(J2)];
          };
          const lo = sideLine(-1), hi = sideLine(1);
          // sideLine(-1) is at the smaller angle
          const order = angleOf(side, pts[lo[0]]) < angleOf(side, pts[hi[0]]) ? [lo, hi] : [hi, lo];
          inner.push({ th: angleOf(side, pts[order[0][2]]), id: order[0][2] }, { th: angleOf(side, pts[order[1][2]]), id: order[1][2] });
          outer.push({ th: angleOf(side, pts[order[0][0]]), id: order[0][0] }, { th: angleOf(side, pts[order[1][0]]), id: order[1][0] });
          blocked.inner.push([angleOf(side, pts[order[0][2]]), angleOf(side, pts[order[1][2]])]);
          blocked.outer.push([angleOf(side, pts[order[0][0]]), angleOf(side, pts[order[1][0]])]);
          channels.push({ side, f, lo: order[0], hi: order[1], z: d.T });
        }
      }
      // tessellate the arcs, leaving out anything inside or very near a feature
      const fill = (list, rho, max, block) => {
        const n = Math.ceil((2 * max) / FIXED.tess);
        const margin = asind(0.3 / rho);
        for (let i = 1; i < n; i++) {
          const th = -max + (2 * max * i) / n;
          if (block.some(([a, b]) => th > a - margin && th < b + margin)) continue;
          list.push({ th, id: add(onArc(side, rho, th)) });
        }
        list.sort((a, b) => a.th - b.th);
      };
      fill(outer, D, thetaOut, blocked.outer);
      fill(inner, R, thetaIn, blocked.inner);
      arcs[side] = { outer, inner };
    }

    // Ring order, counter-clockwise from the north tip: the west arc from north to south, then the east arc from south to north.
    const ring = (which, cusp) => [cusp.N].concat(arcs.W[which].slice().reverse().map((p) => p.id), [cusp.S], arcs.E[which].map((p) => p.id));
    const outerRing = ring('outer', cuspOut), innerRing = ring('inner', cuspIn);
    const posOuter = new Map(outerRing.map((id, i) => [id, i])), posInner = new Map(innerRing.map((id, i) => [id, i]));

    // Orient each channel along the ring: 'start' is the side met first going counter-clockwise.
    for (const ch of channels) {
      const a = posOuter.get(ch.lo[0]), b = posOuter.get(ch.hi[0]);
      [ch.start, ch.end] = a < b ? [ch.lo, ch.hi] : [ch.hi, ch.lo];
    }
    channels.sort((a, b) => posOuter.get(a.start[0]) - posOuter.get(b.start[0]));
    // grooves: on the inner ring, 'first' then 'second' going counter-clockwise
    const grooveAt = new Map();
    for (const g of grooveCells) {
      const [first, second] = posInner.get(g.lo.a) < posInner.get(g.hi.a) ? [g.lo, g.hi] : [g.hi, g.lo];
      g.first = first; g.second = second;
      grooveAt.set(second.a, g);
    }
    const walkOuter = (from, to) => { const out = []; let i = posOuter.get(from); for (;;) { out.push(outerRing[i]); if (outerRing[i] === to) return out; i = (i + 1) % outerRing.length; } };
    // inner ring walked clockwise (backwards), with a detour round each groove
    const walkInnerBack = (from, to) => {
      const out = []; let i = posInner.get(from);
      for (;;) {
        const id = innerRing[i]; out.push(id);
        const g = grooveAt.get(id);
        if (g && id !== to) out.push(g.second.b, g.first.b);
        if (id === to) return out;
        i = (i - 1 + innerRing.length) % innerRing.length;
      }
    };
    const regions = [];
    const Z = d.Z, T = d.T;
    for (let i = 0; i < channels.length; i++) {
      const prev = channels[i], next = channels[(i + 1) % channels.length];
      // wall piece from prev to next
      const loop = walkOuter(prev.end[0], next.start[0])
        .concat(next.start.slice(1))
        .concat(walkInnerBack(next.start[next.start.length - 1], prev.end[prev.end.length - 1]).slice(1))
        .concat(prev.end.slice(1, -1).reverse());
      regions.push({ name: 'wall', loops: [loop], z: Z });
      // the channel itself
      const ch = prev;
      const cl = walkOuter(ch.start[0], ch.end[0])
        .concat(ch.end.slice(1))
        .concat(walkInnerBack(ch.end[ch.end.length - 1], ch.start[ch.start.length - 1]).slice(1))
        .concat(ch.start.slice(1, -1).reverse());
      regions.push({ name: ch.f.kind, loops: [cl], z: ch.z, side: ch.side });
    }
    for (const g of grooveCells) regions.push({ name: 'groove', loops: [[g.second.a, g.first.a, g.first.b, g.second.b]], z: g.z, side: g.side });

    // the floor, with lettering cut into it
    const holes = [];
    if (d.params.label) {
      const ySign = 1;
      const textY = ySign * Math.min(0.42 * D, 42);
      for (const poly of textPolys(latitudeText(d.params.lat), 0, textY, 7)) holes.push(poly.map((xy) => add(xy)));
      const ay = textY + 10, aw = 3.2, ah = 7;
      holes.push([add([-aw, ay]), add([aw, ay]), add([0, ay + ah])]);
    }
    const floorRegion = { name: 'floor', loops: [innerRing.slice()].concat(holes), z: T };
    regions.push(floorRegion);
    for (const h of holes) regions.push({ name: 'letter', loops: [h.slice()], z: T - FIXED.engrave });
    return { points: pts, regions };
  }

  /* ------------------------------------------------------------------ triangulation */

  // Ear clipping with hole bridging, after the structure of Mapbox's earcut, changed in one way that
  // matters here: no vertex is ever dropped, even a collinear one, because a neighbouring wall uses it.
  function triangulate(loops, P) {
    const node = (i) => ({ i, x: P[i][0], y: P[i][1], prev: null, next: null });
    const linked = (ids, ccw) => {
      const a = signedArea(ids, P) > 0;
      const order = a === ccw ? ids : ids.slice().reverse();
      let first = null, last = null;
      for (const i of order) {
        const n = node(i);
        if (!first) first = n; else { last.next = n; n.prev = last; }
        last = n;
      }
      last.next = first; first.prev = last;
      return first;
    };
    let outer = linked(loops[0], true);
    if (loops.length > 1) {
      const holes = loops.slice(1).map((h) => { let p = linked(h, false), left = p, q = p; do { if (q.x < left.x || (q.x === left.x && q.y < left.y)) left = q; q = q.next; } while (q !== p); return left; });
      holes.sort((a, b) => a.x - b.x || a.y - b.y);
      for (const h of holes) {
        const bridge = findHoleBridge(h, outer);
        if (!bridge) throw new Error('could not bridge a hole');
        splitPolygon(bridge, h);
      }
    }
    const tris = [];
    let ear = outer, stop = ear;
    while (ear.prev !== ear.next) {
      const prev = ear.prev, next = ear.next;
      if (isEar(ear)) {
        tris.push([prev.i, ear.i, next.i]);
        next.prev = prev; prev.next = next;
        ear = next.next; stop = next.next;
        continue;
      }
      ear = next;
      if (ear === stop) throw new Error('triangulation stalled');
    }
    return tris;
  }
  function signedArea(ids, P) {
    let s = 0;
    for (let i = 0; i < ids.length; i++) { const a = P[ids[i]], b = P[ids[(i + 1) % ids.length]]; s += a[0] * b[1] - b[0] * a[1]; }
    return s / 2;
  }
  const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const same = (a, b) => a.x === b.x && a.y === b.y;
  const EPS = 1e-10;
  function inTriangle(a, b, c, p) { // inclusive of the edges
    return cross(a, b, p) >= -EPS && cross(b, c, p) >= -EPS && cross(c, a, p) >= -EPS;
  }
  function isEar(ear) {
    const a = ear.prev, b = ear, c = ear.next;
    if (cross(a, b, c) <= EPS) return false; // reflex or flat
    for (let p = c.next; p !== a; p = p.next) {
      if (same(p, a) || same(p, b) || same(p, c)) continue;
      if (inTriangle(a, b, c, p)) return false;
    }
    return true;
  }
  function findHoleBridge(hole, outerNode) {
    let p = outerNode, qx = -Infinity, m = null;
    const hx = hole.x, hy = hole.y;
    do {
      if (hy <= p.y && hy >= p.next.y && p.next.y !== p.y) {
        const x = p.x + ((hy - p.y) * (p.next.x - p.x)) / (p.next.y - p.y);
        if (x <= hx && x > qx) { qx = x; m = p.x < p.next.x ? p : p.next; if (x === hx) return m; }
      } else if (hy >= p.y && hy <= p.next.y && p.next.y !== p.y) {
        const x = p.x + ((hy - p.y) * (p.next.x - p.x)) / (p.next.y - p.y);
        if (x <= hx && x > qx) { qx = x; m = p.x < p.next.x ? p : p.next; if (x === hx) return m; }
      }
      p = p.next;
    } while (p !== outerNode);
    if (!m) return null;
    const stop = m, mx = m.x, my = m.y;
    let tanMin = Infinity;
    p = m;
    do {
      if (hx >= p.x && p.x >= mx && hx !== p.x && triContains(hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy, p.x, p.y)) {
        const tan = Math.abs(hy - p.y) / (hx - p.x);
        if (locallyInside(p, hole) && (tan < tanMin || (tan === tanMin && p.x > m.x))) { m = p; tanMin = tan; }
      }
      p = p.next;
    } while (p !== stop);
    return m;
  }
  function triContains(ax, ay, bx, by, cx, cy, px, py) {
    return (cx - px) * (ay - py) >= (ax - px) * (cy - py) && (ax - px) * (by - py) >= (bx - px) * (ay - py) && (bx - px) * (cy - py) >= (cx - px) * (by - py);
  }
  // Is the diagonal a-b inside the polygon near a? (cross() is positive for a left turn.)
  function locallyInside(a, b) {
    return cross(a.prev, a, a.next) > 0 ? cross(a, b, a.next) <= 0 && cross(a, a.prev, b) <= 0 : cross(a, b, a.prev) > 0 || cross(a, a.next, b) > 0;
  }
  function splitPolygon(a, b) { // join a to b with a two-way bridge
    const a2 = { i: a.i, x: a.x, y: a.y, prev: null, next: null }, b2 = { i: b.i, x: b.x, y: b.y, prev: null, next: null };
    const an = a.next, bp = b.prev;
    a.next = b; b.prev = a;
    a2.next = an; an.prev = a2;
    b2.next = a2; a2.prev = b2;
    bp.next = b2; b2.prev = bp;
    return b2;
  }

  /* ------------------------------------------------------------------ the solid */

  // Extrude a planar map: each region becomes a prism from the bed to its height, walls between
  // neighbours of different heights, a chamfer round the bottom edge, and one flat face on the bed.
  function extrude(map, chamfer) {
    const P = map.points, regions = map.regions;
    for (const r of regions) {
      r.loops = r.loops.map((loop, li) => {
        const ccw = signedArea(loop, P) > 0;
        return ccw === (li === 0) ? loop : loop.slice().reverse();
      });
    }
    const owner = new Map();
    const key = (a, b) => a + ',' + b;
    regions.forEach((r, ri) => r.loops.forEach((loop) => loop.forEach((a, i) => {
      const b = loop[(i + 1) % loop.length];
      if (a === b) throw new Error('repeated point in a region');
      if (owner.has(key(a, b))) throw new Error('two regions claim the same edge ' + key(a, b));
      owner.set(key(a, b), ri);
    })));
    const heights = P.map(() => new Set());
    regions.forEach((r) => r.loops.forEach((loop) => loop.forEach((a) => heights[a].add(r.z))));
    const outline = [];
    for (const [k, ri] of owner) {
      const [a, b] = k.split(',').map(Number);
      if (!owner.has(key(b, a))) { outline.push([a, b, ri]); heights[a].add(chamfer); heights[b].add(chamfer); }
    }
    const V = [], vid = new Map(), F = [];
    const v3 = (a, z) => { const k = a + '|' + z; let i = vid.get(k); if (i === undefined) { i = V.length; V.push([P[a][0], P[a][1], z]); vid.set(k, i); } return i; };
    for (const r of regions) for (const tri of triangulate(r.loops, P)) F.push([v3(tri[0], r.z), v3(tri[1], r.z), v3(tri[2], r.z)]);
    const wall = (a, b, lo, hi) => {
      const ha = [...heights[a]].filter((z) => z >= lo && z <= hi).sort((x, y) => x - y);
      const hb = [...heights[b]].filter((z) => z >= lo && z <= hi).sort((x, y) => x - y);
      let i = 0, j = 0;
      while (i < ha.length - 1 || j < hb.length - 1) {
        if (j < hb.length - 1 && (i >= ha.length - 1 || hb[j + 1] <= ha[i + 1])) { F.push([v3(a, ha[i]), v3(b, hb[j]), v3(b, hb[j + 1])]); j++; }
        else { F.push([v3(a, ha[i]), v3(b, hb[j]), v3(a, ha[i + 1])]); i++; }
      }
    };
    for (const [k, ri] of owner) {
      const [a, b] = k.split(',').map(Number);
      const other = owner.get(key(b, a));
      if (other !== undefined) { if (regions[ri].z > regions[other].z) wall(a, b, regions[other].z, regions[ri].z); }
      else wall(a, b, chamfer, regions[ri].z);
    }
    // outline loop, inset for the chamfer, and the bed face
    const next = new Map(outline.map(([a, b]) => [a, b]));
    const start = outline[0][0], loop = [start];
    for (let a = next.get(start); a !== start; a = next.get(a)) { loop.push(a); if (loop.length > outline.length) throw new Error('outline is not one loop'); }
    if (loop.length !== outline.length) throw new Error('outline is not one loop');
    const n = loop.length, inset = [];
    for (let i = 0; i < n; i++) {
      const p = P[loop[(i - 1 + n) % n]], a = P[loop[i]], q = P[loop[(i + 1) % n]];
      const n1 = norm([-(a[1] - p[1]), a[0] - p[0]]), n2 = norm([-(q[1] - a[1]), q[0] - a[0]]);
      const k2 = chamfer / (1 + n1[0] * n2[0] + n1[1] * n2[1]);
      inset.push([a[0] + k2 * (n1[0] + n2[0]), a[1] + k2 * (n1[1] + n2[1])]);
    }
    const bot = inset.map((xy) => { V.push([xy[0], xy[1], 0]); return V.length - 1; });
    for (let i = 0; i < n; i++) {
      const a = loop[i], b = loop[(i + 1) % n], ai = bot[i], bi = bot[(i + 1) % n];
      F.push([ai, bi, v3(b, chamfer)], [ai, v3(b, chamfer), v3(a, chamfer)]);
    }
    const insetIds = inset.map((_, i) => i);
    for (const tri of triangulate([insetIds], inset)) F.push([bot[tri[0]], bot[tri[2]], bot[tri[1]]]);
    return { vertices: V, faces: F };
  }
  function norm(v) { const l = Math.hypot(v[0], v[1]); return [v[0] / l, v[1] / l]; }

  function boxMesh(input) {
    const d = design(input);
    const m = extrude(lensMap(d), FIXED.chamfer);
    m.design = d;
    return m;
  }

  /* ------------------------------------------------------------------ the test coupon */

  // A straight piece of wall with five slits (0.8 to 1.6 mm, cut exactly like the box's), one groove
  // and one through-slot, each widths' figure cut into the floor in front of it.
  const COUPON = Object.freeze({ widths: [0.8, 1.0, 1.2, 1.4, 1.6], pitch: 12, length: 76, depth: 20, wallY: 10, height: 14, flare: 45 });
  function couponMap() {
    const pts = [], add = (xy) => { pts.push(xy); return pts.length - 1; };
    const t = FIXED.wall, y0 = COUPON.wallY, y1 = y0 + t, Lx = COUPON.length, T = FIXED.floor;
    const xs = COUPON.widths.map((_, i) => 7 + COUPON.pitch * i);
    const gx = xs[xs.length - 1] + 9, sx = gx + 7;
    const dx = (t - FIXED.land) * tand(COUPON.flare);
    // channels along the wall, left to right: five slits, then the through-slot
    const chans = COUPON.widths.map((w, i) => ({
      kind: 'slit',
      front: [add([xs[i] - w / 2, y0]), add([xs[i] + w / 2, y0])],
      land: [add([xs[i] - w / 2, y0 + FIXED.land]), add([xs[i] + w / 2, y0 + FIXED.land])],
      back: [add([xs[i] - w / 2 - dx, y1]), add([xs[i] + w / 2 + dx, y1])],
    }));
    const sw = FIXED.slotWidth / 2;
    chans.push({ kind: 'slot', front: [add([sx - sw, y0]), add([sx + sw, y0])], land: null, back: [add([sx - sw, y1]), add([sx + sw, y1])] });
    const gw = FIXED.grooveWidth / 2;
    const groove = { a: [add([gx - gw, y1]), add([gx + gw, y1])], b: [add([gx - gw, y1 - FIXED.grooveDepth]), add([gx + gw, y1 - FIXED.grooveDepth])] };
    const c00 = add([0, 0]), cL0 = add([Lx, 0]), cLy0 = add([Lx, y0]), c0y0 = add([0, y0]);
    const c0y1 = add([0, y1]), cLy1 = add([Lx, y1]), cLD = add([Lx, COUPON.depth]), c0D = add([0, COUPON.depth]);
    const regions = [];
    // front floor, with each slit's width (in tenths of a millimetre) cut in front of it
    const mouths = [];
    for (const ch of chans) mouths.push(ch.front[0], ch.front[1]);
    const holes = [];
    COUPON.widths.forEach((w, i) => { for (const poly of textPolys(String(Math.round(w * 10)), xs[i], y0 / 2, 6)) holes.push(poly.map((xy) => add(xy))); });
    regions.push({ name: 'floor', loops: [[c00, cL0, cLy0].concat(mouths.slice().reverse(), [c0y0])].concat(holes), z: T });
    for (const h of holes) regions.push({ name: 'letter', loops: [h.slice()], z: T - FIXED.engrave });
    // back floor: along the inner face, the groove sits between the last slit and the slot
    const backs = [];
    chans.forEach((ch) => { if (ch.kind === 'slot') backs.push(groove.a[0], groove.a[1]); backs.push(ch.back[0], ch.back[1]); });
    regions.push({ name: 'floor', loops: [[c0y1].concat(backs, [cLy1, cLD, c0D])], z: T });
    for (const ch of chans) {
      const left = ch.land ? [ch.back[0], ch.land[0], ch.front[0]] : [ch.back[0], ch.front[0]];
      const right = ch.land ? [ch.front[1], ch.land[1], ch.back[1]] : [ch.front[1], ch.back[1]];
      regions.push({ name: ch.kind, loops: [left.concat(right)], z: T });
    }
    for (let i = 0; i <= chans.length; i++) {
      const L = i === 0 ? null : chans[i - 1], Rr = i === chans.length ? null : chans[i];
      const loop = [];
      if (L) { loop.push(L.front[1]); if (L.land) loop.push(L.land[1]); loop.push(L.back[1]); } else loop.push(c0y0, c0y1);
      if (Rr && Rr.kind === 'slot') loop.push(groove.a[0], groove.b[0], groove.b[1], groove.a[1]);
      if (Rr) { loop.push(Rr.back[0]); if (Rr.land) loop.push(Rr.land[0]); loop.push(Rr.front[0]); } else loop.push(cLy1, cLy0);
      regions.push({ name: 'wall', loops: [loop], z: COUPON.height });
    }
    regions.push({ name: 'groove', loops: [[groove.a[0], groove.a[1], groove.b[1], groove.b[0]]], z: T });
    return { points: pts, regions };
  }
  function couponMesh() { return extrude(couponMap(), FIXED.chamfer); }
  const COUPON_LABEL = 'First Light Last Light / test coupon / mm / slits 0.8 1.0 1.2 1.4 1.6';

  /* ------------------------------------------------------------------ STL, volume, checks */

  function facetNormal(a, b, c) {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    return [n[0] / l, n[1] / l, n[2] / l];
  }
  function stl(mesh, label) {
    const buf = new ArrayBuffer(84 + mesh.faces.length * 50), v = new DataView(buf);
    const head = String(label || 'First Light, Last Light').slice(0, 80);
    for (let i = 0; i < head.length; i++) v.setUint8(i, head.charCodeAt(i) & 0x7f);
    v.setUint32(80, mesh.faces.length, true);
    let o = 84;
    for (const f of mesh.faces) {
      const a = mesh.vertices[f[0]], b = mesh.vertices[f[1]], c = mesh.vertices[f[2]];
      for (const x of facetNormal(a, b, c).concat(a, b, c)) { v.setFloat32(o, x, true); o += 4; }
      v.setUint16(o, 0, true); o += 2;
    }
    return buf;
  }
  function volume(mesh) {
    let s = 0;
    for (const f of mesh.faces) {
      const [a, b, c] = f.map((i) => mesh.vertices[i]);
      s += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    }
    return s;
  }
  function bounds(mesh) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const p of mesh.vertices) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
    return { lo, hi, size: hi.map((h, k) => h - lo[k]) };
  }
  // The 80-byte STL header is ASCII, so the degree sign is spelt out.
  function stlLabel(d) {
    const p = d.params;
    return `First Light Last Light / mm / ${latitudeText(p.lat).replace('°', ' deg ')} ${p.lon}E / horizons ${p.horizonE} ${p.horizonW} / D${p.size} slit${p.slit}${p.day ? ' / day ' + p.day : ''}`;
  }

  /* ------------------------------------------------------------------ reading the box */

  // The direction sunlight travels in plan, for a Sun of amplitude amp at sunrise or sunset.
  const lightDir = (kind, amp) => (kind === 'rise' ? [-cosd(amp), -sind(amp)] : [cosd(amp), -sind(amp)]);
  // Where a line x = p + s dir, s >= 0, leaves the inside of the box (the overlap of two discs of radius
  // R about the two slits), and which wall it meets there: 'W' (the arc about the east slit) or 'E'.
  function exitPoint(d, p, dir) {
    let best = null;
    for (const [wall, cx] of [['W', d.D / 2], ['E', -d.D / 2]]) {
      const px = p[0] - cx, py = p[1];
      const b = px * dir[0] + py * dir[1], c = px * px + py * py - d.R * d.R, disc = b * b - c;
      if (disc < 0) return null;
      const s = -b + Math.sqrt(disc); // the far crossing of this circle
      if (!best || s < best.s) best = { s, wall };
    }
    return { point: [p[0] + best.s * dir[0], p[1] + best.s * dir[1]], wall: best.wall };
  }
  // How wide a beam the near slit lets through for light at amp off its axis. The straight land, l deep,
  // cuts a slit w wide to w cos a - l sin a; past the jaws' flare angle the jaws cut it further. At high
  // latitudes this can be a small part of the slit, or nothing.
  function aperture(d, kind, amp) {
    const a = Math.abs(amp), w = d.params.slit, l = FIXED.land, flare = d.walls[kind === 'rise' ? 'E' : 'W'].flare;
    const jaw = Math.max(0, (d.t - l) * (sind(a) - tand(flare) * cosd(a)));
    return Math.max(0, w * cosd(a) - l * sind(a) - jaw);
  }
  // Where the light lands for a Sun of amplitude amp (degrees north of due east at sunrise, or of due
  // west at sunset): angle on the far wall, arc length from the axis, and what it meets there. When the
  // angle is past the far wall's end, the light falls on the near wall beside a tip instead (onFar false).
  function landing(d, kind, amp) {
    const side = kind === 'rise' ? 'W' : 'E', wall = d.walls[side];
    const theta = wallTheta(d.R, amp), mm = (theta * RAD) * d.R;
    const s = kind === 'rise' ? 1 : -1;
    const end = exitPoint(d, [s * (d.D / 2 - FIXED.land / 2), 0], lightDir(kind, amp));
    const onFar = Math.abs(theta) <= d.thetaIn;
    let hit = null;
    if (onFar) for (const f of wall.features) {
      if (Math.abs(theta - f.theta) <= f.half + 1e-9) { hit = f; break; }
    }
    return { side, theta, mm, hit, onFar, point: end ? end.point : null, width: aperture(d, kind, amp) };
  }
  // A beam narrower than this (mm) is not counted or drawn as light in the box.
  const SLIVER = 0.05;
  // The cross-sections a ray must pass to go right through a cut in a wall, in order from the inside:
  // for a slit, the mouth on the inner face, the inner end of its land and the outer face; for a slot,
  // its two ends. The same points lensMap builds the cut from. The cut between two of them is convex, so
  // a straight ray that passes every one of them passes the cut.
  function cutGates(d, side, f) {
    const c = side === 'W' ? [d.D / 2, 0] : [-d.D / 2, 0];
    const u = side === 'W' ? [-cosd(f.theta), sind(f.theta)] : [cosd(f.theta), sind(f.theta)], n = [-u[1], u[0]];
    const at = (o, rho) => { const a = Math.sqrt(rho * rho - o * o); return [c[0] + o * n[0] + a * u[0], c[1] + o * n[1] + a * u[1]]; };
    if (f.kind === 'slot') { const o = FIXED.slotWidth / 2; return [[at(-o, d.R), at(o, d.R)], [at(-o, d.D), at(o, d.D)]]; }
    const s = d.params.slit / 2, L = FIXED.land, a = d.walls[side].flare;
    const ends = [-1, 1].map((sg) => {
      const O = at(sg * s, d.D), J1 = [O[0] - L * u[0], O[1] - L * u[1]];
      const fdir = [-cosd(a) * u[0] + sg * sind(a) * n[0], -cosd(a) * u[1] + sg * sind(a) * n[1]];
      const px = J1[0] - c[0], py = J1[1] - c[1], B = px * fdir[0] + py * fdir[1], C = px * px + py * py - d.R * d.R;
      const tau = -B - Math.sqrt(B * B - C);
      return { O, J1, J2: [J1[0] + tau * fdir[0], J1[1] + tau * fdir[1]] };
    });
    return [[ends[0].J2, ends[1].J2], [ends[0].J1, ends[1].J1], [ends[0].O, ends[1].O]];
  }
  // Your slots are openings too. The slot cut in the wall nearer the Sun (in the east wall for the
  // morning) was cut for light leaving at the other end of the day, but sunlight can come in through it
  // from outside, within about 26 degrees of its own line, and cross the box as a second stripe. Returns
  // that stripe on the far wall, or null: its middle (angle and mm, as landing() gives them), the beam's
  // width, which feature it meets, and onFar false when it falls past the far wall's end. Where it meets
  // the far slit (or a slot in the far wall), only the part that passes right through that cut goes out:
  // out is the width of beam that leaves, inBox the width that stays in the box, on the cut's sides or
  // on the wall beside it.
  function slotLeak(d, kind, amp) {
    const nearSide = kind === 'rise' ? 'E' : 'W', farSide = kind === 'rise' ? 'W' : 'E';
    const f = d.walls[nearSide].features.find((x) => x.kind === 'slot');
    if (!f) return null;
    const c = nearSide === 'W' ? [d.D / 2, 0] : [-d.D / 2, 0];
    const u = nearSide === 'W' ? [-cosd(f.theta), sind(f.theta)] : [cosd(f.theta), sind(f.theta)], n = [-u[1], u[0]];
    const dir = lightDir(kind, amp);
    if (dir[0] * u[0] + dir[1] * u[1] >= 0) return null; // the light would be leaving, not coming in
    const corner = (o, rho) => { const a = Math.sqrt(rho * rho - o * o); return [c[0] + o * n[0] + a * u[0], c[1] + o * n[1] + a * u[1]]; };
    const q = [-dir[1], dir[0]], across = (pt) => pt[0] * q[0] + pt[1] * q[1];
    const o = FIXED.slotWidth / 2;
    const outer = [across(corner(-o, d.D)), across(corner(o, d.D))].sort((x, y) => x - y);
    const inner = [across(corner(-o, d.R)), across(corner(o, d.R))].sort((x, y) => x - y);
    const lo = Math.max(outer[0], inner[0]), hi = Math.min(outer[1], inner[1]);
    if (hi <= lo) return null;
    // follow the beam's two edges and its middle across the box to where they meet a wall
    const fc = farSide === 'W' ? [d.D / 2, 0] : [-d.D / 2, 0];
    const angleOn = (pt) => (farSide === 'W' ? atan2d(pt[1], -(pt[0] - fc[0])) : atan2d(pt[1], pt[0] - fc[0]));
    // a point on each line well outside the box, on the Sun's side, then where the line leaves the inside
    const land = (k) => exitPoint(d, [q[0] * k - dir[0] * 400, q[1] * k - dir[1] * 400], dir);
    const ends = [lo, (lo + hi) / 2, hi].map(land);
    if (ends.some((e) => !e)) return null;
    const onFar = ends[1].wall === farSide;
    const theta = angleOn(ends[1].point), spanTh = ends.map((e) => angleOn(e.point));
    let hit = null;
    if (onFar) for (const g of d.walls[farSide].features) {
      if (Math.abs(theta - g.theta) <= g.half + 1e-9) { hit = g; break; }
    }
    // the part of the beam that passes every cross-section of a cut right through the far wall leaves again
    let out = 0;
    for (const g of d.walls[farSide].features) {
      if (g.kind !== 'slit' && g.kind !== 'slot') continue;
      let a = lo, b = hi;
      for (const [p1, p2] of cutGates(d, farSide, g)) {
        const x = across(p1), y = across(p2);
        a = Math.max(a, Math.min(x, y)); b = Math.min(b, Math.max(x, y));
      }
      if (b > a) out += b - a;
    }
    const fromSlot = corner(0, d.R);
    return {
      side: farSide, slotSide: nearSide, onFar, theta, mm: theta * RAD * d.R, point: ends[1].point, from: fromSlot, mouth: corner(0, d.D), hit,
      width: hi - lo, band: [lo, hi], out, inBox: Math.max(0, hi - lo - out), alongWall: Math.abs(spanTh[2] - spanTh[0]) * RAD * d.R,
      distance: Math.hypot(ends[1].point[0] - fromSlot[0], ends[1].point[1] - fromSlot[1]),
    };
  }
  // Every day of a year: where sunrise light and sunset light land.
  function yearTrack(d, year) {
    const p = d.params, n = isLeap(year) ? 366 : 365, out = [];
    for (let i = 1; i <= n; i++) {
      const dt = dateOfYear(year, i);
      const r = sunEvent(year, dt.month, dt.day, p.lat, p.lon, 'rise', p.horizonE);
      const s = sunEvent(year, dt.month, dt.day, p.lat, p.lon, 'set', p.horizonW);
      out.push({ n: i, month: dt.month, day: dt.day, ampRise: 90 - r.az, ampSet: s.az - 270, riseJD: r.jd, setJD: s.jd });
    }
    return out;
  }
  // Days on which the light crosses a given amplitude: the nearer day of each crossing.
  function crossings(track, key, amp) {
    const out = [];
    for (let i = 0; i + 1 < track.length; i++) {
      const a = track[i][key] - amp, b = track[i + 1][key] - amp;
      if (a === 0 || a * b < 0) out.push(Math.abs(a) <= Math.abs(b) ? track[i] : track[i + 1]);
    }
    return out;
  }
  // The key: for each groove still on the box, the days (this year) its light lands on it.
  function key(d, year, track) {
    track = track || yearTrack(d, year);
    return d.grooves.map((g, gi) => {
      const onW = d.walls.W.features.some((f) => f.kind === 'groove' && f.groove === gi);
      const onE = d.walls.E.features.some((f) => f.kind === 'groove' && f.groove === gi);
      return {
        groove: gi, k: g.k, level: g.level, names: g.names, delta: g.delta, ampRise: g.ampRise, ampSet: g.ampSet,
        rise: onW ? crossings(track, 'ampRise', g.ampRise).map(fmtDate) : null,
        set: onE ? crossings(track, 'ampSet', g.ampSet).map(fmtDate) : null,
      };
    });
  }
  // Sunrise light near the axis passes through both slits. For each of the two crossings of the axis
  // in the year, the nearest day, how far the centre of the light passes from the middle of the far
  // slit (mm), and whether it is inside the slit. At high latitudes the light can step right over it.
  function straightThrough(d, year, track) {
    track = track || yearTrack(d, year);
    const days = (key) => crossings(track, key, 0).map((t) => ({ n: t.n, month: t.month, day: t.day, offset: (d.D - FIXED.land) * tand(t[key]), through: throughFarSlit(d, t[key]) }));
    return { rise: days('ampRise'), set: days('ampSet') };
  }
  // Another day of the same year whose sunrise lands nearest the same place: a day's twin.
  function twin(d, year, month, day, track) {
    track = track || yearTrack(d, year);
    const i = track.findIndex((t) => t.month === month && t.day === day);
    if (i < 0) return null;
    const a = track[i].ampRise;
    // the twin lies on the other side of the nearer turning point of the year
    let best = null;
    for (let j = 0; j < track.length; j++) {
      if (Math.abs(j - i) < 3) continue;
      const slopeI = track[Math.min(i + 1, track.length - 1)].ampRise - track[Math.max(i - 1, 0)].ampRise;
      const slopeJ = track[Math.min(j + 1, track.length - 1)].ampRise - track[Math.max(j - 1, 0)].ampRise;
      if (slopeI * slopeJ > 0) continue;
      const e = Math.abs(track[j].ampRise - a);
      if (!best || e < best.e) best = { e, t: track[j] };
    }
    return best ? { month: best.t.month, day: best.t.day, error: best.e } : null;
  }
  // The days whose light lands within tol millimetres of where light of amplitude amp lands.
  function nearDays(d, track, kind, amp, tol) {
    const key = kind === 'rise' ? 'ampRise' : 'ampSet', target = wallTheta(d.R, amp);
    return track.filter((t) => Math.abs(wallTheta(d.R, t[key]) - target) * RAD * d.R <= tol);
  }
  // Split a list of days into runs of consecutive days.
  function runsOf(days) {
    const runs = [];
    for (const t of days) {
      const last = runs[runs.length - 1];
      if (last && t.n === last[last.length - 1].n + 1) last.push(t); else runs.push([t]);
    }
    return runs;
  }
  // The days to step through when the page is asked not to animate: for each groove on the west wall and
  // your slot, every day the key gives (the nearer morning of each crossing, so both dates either side of
  // the solstice); for a solstice groove, which the light reaches without crossing, the middle of each
  // run of mornings within half a millimetre of it; and the mornings the light goes straight through.
  function readingStops(d, track, year) {
    const s = new Set();
    for (const f of d.walls.W.features) {
      if (f.kind === 'slit') continue;
      const days = crossings(track, 'ampRise', f.amp);
      if (days.length) for (const t of days) s.add(t.n);
      else for (const run of runsOf(nearDays(d, track, 'rise', f.amp, 0.5))) s.add(run[Math.floor(run.length / 2)].n);
    }
    for (const t of straightThrough(d, year, track).rise) s.add(t.n);
    return [...s].sort((a, b) => a - b);
  }
  // Every morning and evening of a year on which your slot lets light into the box that lands on the far
  // wall, or on the sides of the far slit or slot its middle meets (onCut: 'slit' or 'slot'), and the
  // groove whose middle it falls nearest. Light that all goes out again, or is a sliver, is left out.
  function leaks(d, track) {
    const out = { rise: [], set: [] };
    for (const t of track) for (const kind of ['rise', 'set']) {
      const L = slotLeak(d, kind, kind === 'rise' ? t.ampRise : t.ampSet);
      if (!L || !L.onFar || L.inBox < SLIVER) continue;
      let near = null;
      for (const f of d.walls[L.side].features) {
        if (f.kind !== 'groove') continue;
        const mm = Math.abs(f.theta - L.theta) * RAD * d.R;
        if (!near || mm < near.mm) near = { groove: f.groove, mm };
      }
      out[kind].push({ n: t.n, month: t.month, day: t.day, theta: L.theta, mm: L.mm, width: L.width, inBox: L.inBox, out: L.out, onCut: L.hit && L.hit.kind !== 'groove' ? L.hit.kind : null, near });
    }
    return out;
  }
  // The error budget for a place, in degrees of the Sun's direction and in days of its travel near an
  // equinox and near the cross-quarter day after it (early May in the north, early November in the south).
  function budget(d, track, year) {
    const tr = track, p = d.params;
    const rate = (n) => Math.abs(tr[Math.min(tr.length - 1, n)].ampRise - tr[Math.max(0, n - 2)].ampRise) / 2;
    const eqN = tr.reduce((best, t, i) => (Math.abs(t.ampRise) < Math.abs(tr[best].ampRise) ? i : best), 0) + 1;
    const xq = d.grooves.find((g) => g.k === 3);
    const xqDays = crossings(tr, 'ampRise', xq.ampRise);
    const xqN = xqDays.length ? xqDays[0].n : eqN;
    const rEq = rate(eqN), rXq = rate(xqN);
    const dAdh = Math.abs(riseAzimuth(0, p.lat, d.hE + 0.3) - riseAzimuth(0, p.lat, d.hE)) / 0.3;
    const eqDay = tr[eqN - 1];
    const perMinute = eventTimes(year, eqDay.month, eqDay.day, p.lat, p.lon, 'rise', p.horizonE).azPerMinute;
    // half the stripe: the beam the slit lets through at that slant, and the Sun's disc
    const stripe = (amp) => ((aperture(d, 'rise', amp) + d.R * 2 * SEMIDIAMETER * RAD) / 2 / d.R) / RAD;
    const rows = [
      { key: 'model', eq: 0.011 },
      { key: 'stripe', eq: stripe(eqDay.ampRise), xq: stripe(xq.ampRise) },
      { key: 'refraction', eq: 0.3 * dAdh },
      { key: 'horizon', eq: 0.5 * dAdh },
      { key: 'minute', eq: perMinute },
      { key: 'turn', eq: 1 },
    ].map((r) => ({ ...r, xq: r.xq === undefined ? r.eq : r.xq }));
    for (const r of rows) { r.daysEq = rEq > 0 ? r.eq / rEq : Infinity; r.daysXq = rXq > 0 ? r.xq / rXq : Infinity; }
    // the terms that change from one morning to the next, combined as the root of the sum of squares
    const varying = ['stripe', 'refraction', 'minute'].map((k) => rows.find((r) => r.key === k).daysEq);
    return { rEq, rXq, eqN, xqN, dAdh, perMinute, rows, rssEq: Math.sqrt(varying.reduce((s, x) => s + x * x, 0)) };
  }
  // A slot near the slit leaves the wall between them as a column joined to the box only through the
  // floor. For each wall with a slot: how long that piece is on the inner face, in mm.
  function slotPillars(d) {
    const out = [];
    for (const side of ['W', 'E']) {
      const f = d.walls[side].features, slot = f.find((x) => x.kind === 'slot');
      if (!slot) continue;
      const slit = f.find((x) => x.kind === 'slit');
      out.push({ side, mm: (Math.abs(slot.theta - slit.theta) - slot.half - slit.half) * RAD * d.R });
    }
    return out;
  }

  return {
    FIXED, LIMITS, DEFAULTS, GROOVES, TERM_NAMES, COUPON, COUPON_LABEL, MONTHS,
    julianDay, calendarDate, isLeap, daysInMonth, dateOfYear, fmtDate,
    sun, gmst, horizontal, refraction, centreAltitude, sunEvent, sunAtAltitude, riseAzimuth, solarNoon, eventTimes, SEMIDIAMETER,
    params, design, wallTheta, throughFarSlit, grooveBottom, lensMap, couponMap, textPolys, latitudeText,
    triangulate, signedArea, extrude, boxMesh, couponMesh,
    stl, stlLabel, volume, bounds, facetNormal,
    landing, aperture, exitPoint, cutGates, SLIVER, slotLeak, leaks, yearTrack, crossings, key, straightThrough, twin,
    nearDays, runsOf, readingStops, budget, slotPillars,
  };
});
