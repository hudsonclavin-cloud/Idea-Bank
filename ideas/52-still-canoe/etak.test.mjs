// Verification for The Still Canoe. From the repo root:
//   node --test ideas/52-still-canoe/etak.test.mjs
// Each check compares etak.js with code written here that does not call it: a sky that is
// rotated about the pole until a star touches the horizon, 3-D vector bearings, Vincenty's
// ellipsoidal inverse, brute-force sampling and step-by-step simulation.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const E = createRequire(import.meta.url)('./etak.js');
const P = E.PLACES;
const RAD = Math.PI / 180, DEG = 180 / Math.PI;
const wrap360 = (a) => ((a % 360) + 360) % 360;
const wrap180 = (a) => { const x = wrap360(a); return x > 180 ? x - 360 : x; };
const log = (...a) => console.log('   ', ...a);

// ------------------------------------------------------------ independent tools ------
// Star at hour angle H (deg) and declination dec, latitude lat: horizon vector (east, north, up)
// by rotating the equatorial vector about the east axis by (90° − lat).
function horizonVec(dec, H, lat) {
  const d = dec * RAD, h = H * RAD, c = (90 - lat) * RAD;
  // equatorial frame: x toward meridian (south on the equator), y west, z pole
  const ex = Math.cos(d) * Math.cos(h), ey = Math.cos(d) * Math.sin(h), ez = Math.sin(d);
  // rotate about y by colatitude: horizon frame with x' south, y' west, z' zenith
  const sx = ex * Math.cos(c) - ez * Math.sin(c);
  const zx = ex * Math.sin(c) + ez * Math.cos(c);
  return { east: -ey, north: -sx, up: zx };
}
function azAlt(v) {
  return { az: wrap360(Math.atan2(v.east, v.north) * DEG), alt: Math.asin(Math.max(-1, Math.min(1, v.up))) * DEG };
}
// Rising azimuth found by bisection on altitude over hour angle (rising side: H in (-180, 0)).
function risingBySky(dec, lat) {
  let lo = -180, hi = 0;
  const alt = (H) => azAlt(horizonVec(dec, H, lat)).alt;
  if (alt(lo) > 0 || alt(hi) < 0) return null;
  for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (alt(m) < 0) lo = m; else hi = m; }
  return azAlt(horizonVec(dec, (lo + hi) / 2, lat)).az;
}
const R_NM = 6371.0088 / 1.852;
function vec(p) {
  const a = p.lat * RAD, b = p.lon * RAD;
  return [Math.cos(a) * Math.cos(b), Math.cos(a) * Math.sin(b), Math.sin(a)];
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.sqrt(dot(a, a));
function bearingVec(p, q) {
  const n = vec(p), m = vec(q), z = [0, 0, 1];
  const east = crs(z, n), el = len(east), e = east.map((x) => x / el);
  const north = crs(n, e);
  const t = m.map((x, i) => x - dot(m, n) * n[i]);
  return wrap360(Math.atan2(dot(t, e), dot(t, north)) * DEG);
}
function distVec(p, q) { const a = vec(p), b = vec(q); return Math.atan2(len(crs(a, b)), dot(a, b)) * R_NM; }
// Vincenty inverse on WGS84: distance (nm) and initial bearing.
function vincenty(p1, p2) {
  const a = 6378137, f = 1 / 298.257223563, b = (1 - f) * a;
  const L = (p2.lon - p1.lon) * RAD;
  const U1 = Math.atan((1 - f) * Math.tan(p1.lat * RAD)), U2 = Math.atan((1 - f) * Math.tan(p2.lat * RAD));
  const sU1 = Math.sin(U1), cU1 = Math.cos(U1), sU2 = Math.sin(U2), cU2 = Math.cos(U2);
  let lam = L, lamP, sS, cS, sig, sA, c2A, c2SM, C;
  for (let i = 0; i < 200; i++) {
    const sl = Math.sin(lam), cl = Math.cos(lam);
    sS = Math.sqrt((cU2 * sl) ** 2 + (cU1 * sU2 - sU1 * cU2 * cl) ** 2);
    cS = sU1 * sU2 + cU1 * cU2 * cl;
    sig = Math.atan2(sS, cS);
    sA = cU1 * cU2 * sl / sS;
    c2A = 1 - sA * sA;
    c2SM = cS - 2 * sU1 * sU2 / c2A;
    C = f / 16 * c2A * (4 + f * (4 - 3 * c2A));
    lamP = lam;
    lam = L + (1 - C) * f * sA * (sig + C * sS * (c2SM + C * cS * (-1 + 2 * c2SM * c2SM)));
    if (Math.abs(lam - lamP) < 1e-13) break;
  }
  const u2 = c2A * (a * a - b * b) / (b * b);
  const A = 1 + u2 / 16384 * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)));
  const B = u2 / 1024 * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
  const dS = B * sS * (c2SM + B / 4 * (cS * (-1 + 2 * c2SM * c2SM) - B / 6 * c2SM * (-3 + 4 * sS * sS) * (-3 + 4 * c2SM * c2SM)));
  const s = b * A * (sig - dS);
  const az = Math.atan2(cU2 * Math.sin(lam), cU1 * sU2 - sU1 * cU2 * Math.cos(lam));
  return { nm: s / 1852, brg: wrap360(az * DEG) };
}
function interp(p, q, f) {
  const a = vec(p), b = vec(q), om = Math.acos(dot(a, b)), s = Math.sin(om);
  const v = a.map((x, i) => x * Math.sin((1 - f) * om) / s + b[i] * Math.sin(f * om) / s);
  const l = len(v);
  return { lat: Math.asin(v[2] / l) * DEG, lon: Math.atan2(v[1], v[0]) * DEG };
}

const LAT = (P.puluwat.lat + P.truk.lat) / 2;
const V = E.makeVoyage(P.puluwat, P.truk, P.pisaras);
const PTS = V.points;
const idx = (event, star) => PTS.findIndex((p) => p.event === event && p.star === star);

// ------------------------------------------------------------ 1. the compass ---------
// The positions in etak.js are the HYG v4.1 (Hipparcos-derived) values from McDonald's
// repository. These declinations are catalogued Hipparcos J2000 values typed in by hand to
// 0.1″, so agreement within 0.1″ is all the typing allows.
test('star positions agree with hand-typed Hipparcos J2000 declinations to within 0.1″', () => {
  const dms = (s, d, m, x) => s * (d + m / 60 + x / 3600);
  const simbad = {
    polaris: dms(1, 89, 15, 50.8), kochab: dms(1, 74, 9, 19.8), dubhe: dms(1, 61, 45, 3.7),
    schedar: dms(1, 56, 32, 14.4), vega: dms(1, 38, 47, 1.3), pleiades: dms(1, 24, 6, 18.5),
    aldebaran: dms(1, 16, 30, 33.5), tarazed: dms(1, 10, 36, 47.7), altair: dms(1, 8, 52, 6.0),
    alshain: dms(1, 6, 24, 24.4), belt: dms(-1, 1, 12, 6.9), gienah: dms(-1, 17, 32, 30.9),
    antares: dms(-1, 26, 25, 55.2), shaula: dms(-1, 37, 6, 13.8), acrux: dms(-1, 63, 5, 56.7),
    gacrux: dms(-1, 57, 6, 47.6),
  };
  for (const [k, dec] of Object.entries(simbad)) {
    assert.ok(Math.abs(E.STARS[k].dec - dec) < 0.1 / 3600, `${k}: ${E.STARS[k].dec} vs ${dec}`);
  }
});

test('rising azimuth formula agrees with turning the sky until each star touches the horizon', () => {
  for (const lat of [0, 7.4, 21.3, -14, 40]) {
    for (const [k, s] of Object.entries(E.STARS)) {
      const a = E.risingAzimuth(s.dec, lat), b = risingBySky(s.dec, lat);
      if (a === null || b === null) { assert.equal(a, b, `${k} at ${lat}`); continue; }
      assert.ok(Math.abs(a - b) < 1e-6, `${k} at ${lat}: ${a} vs ${b}`);
    }
  }
});

test('the compass is its own mirror: every star sets as far west of north as it rose east', () => {
  assert.equal(PTS.length, 32);
  for (const p of PTS) {
    if (p.event !== 'rise') continue;
    const s = PTS[idx('set', p.star)];
    assert.ok(Math.abs(p.az + s.az - 360) < 1e-9, p.star);
  }
  // points run clockwise from north without going back
  for (let i = 1; i < 32; i++) assert.ok(PTS[i].az > PTS[i - 1].az, `${PTS[i].label} after ${PTS[i - 1].label}`);
});

test('the leaning Southern Cross points, by an independent position-angle calculation', () => {
  const A = E.STARS.acrux, G = E.STARS.gacrux;
  const lean = (H) => {
    const a = azAlt(horizonVec(A.dec, H, LAT)), g = azAlt(horizonVec(G.dec, H - (G.ra - A.ra) * 15, LAT));
    // position angle of Gacrux seen from Acrux, measured from the zenith direction
    const dA = (g.az - a.az) * RAD, f1 = a.alt * RAD, f2 = g.alt * RAD;
    const pa = Math.atan2(Math.sin(dA) * Math.cos(f2), Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dA));
    return Math.abs(pa) * DEG;
  };
  for (const side of ['rise', 'set']) {
    const H0 = Math.acos(-Math.tan(LAT * RAD) * Math.tan(A.dec * RAD)) * DEG;
    let lo = side === 'set' ? 0 : -H0, hi = side === 'set' ? H0 : 0;
    const flo = lean(lo) - 45;
    for (let i = 0; i < 100; i++) { const m = (lo + hi) / 2; if ((lean(m) - 45 < 0) === (flo < 0)) lo = m; else hi = m; }
    const az = azAlt(horizonVec(A.dec, (lo + hi) / 2, LAT)).az;
    const mine = PTS.find((p) => p.event === 'lean' && p.side === side).az;
    assert.ok(Math.abs(az - mine) < 0.01, `${side}: ${az} vs ${mine}`);
    log(`Southern Cross leaning 45° (${side}): Acrux at ${az.toFixed(2)}°`);
  }
});

test('the two leaning-Cross points are not mirror images, and the ring readout says so', () => {
  const lr = idx('lean', 'acrux'), ls = PTS.findIndex((p) => p.event === 'lean' && p.side === 'set');
  const miss = PTS[lr].az - (360 - PTS[ls].az);
  assert.ok(miss > 3.5 && miss < 4.5, `asymmetry ${miss}`);
  // the cause: Gacrux is not due north of Acrux on the sky. Give it Acrux's right ascension
  // and the pair becomes an exact mirror.
  const ra = E.STARS.gacrux.ra;
  try {
    E.STARS.gacrux.ra = E.STARS.acrux.ra;
    const r = E.crossLeanAzimuth(LAT, 'rise'), st = E.crossLeanAzimuth(LAT, 'set');
    assert.ok(Math.abs(r + st - 360) < 1e-6, `${r} + ${st}`);
  } finally { E.STARS.gacrux.ra = ra; }
  // the readout: no "same angle" for the lean pair; it does say so for every star's rise/set pair
  for (const i of [lr, ls]) {
    const n = E.pointNote(PTS, i);
    assert.equal(n.partner, i === lr ? ls : lr);
    assert.doesNotMatch(n.text, /same angle/);
    assert.match(n.text, /not mirror images \(that would be [0-9.]+°, 4\.0° away\)/);
    assert.match(n.evidence, /definition/);
  }
  for (let i = 0; i < PTS.length; i++) {
    if (PTS[i].event !== 'rise' && PTS[i].event !== 'set') continue;
    const n = E.pointNote(PTS, i);
    assert.match(n.text, /same angle from north on the other side/, PTS[i].label);
    assert.match(n.evidence, /Goodenough 1953/);
  }
  log(`leaning pair: ${PTS[lr].az.toFixed(2)}° and ${PTS[ls].az.toFixed(2)}°, ${miss.toFixed(2)}° from mirror images`);
});

test('point names and evidence follow the Weriyeng list and the published compass', () => {
  // the three Southern Cross positions have their own names on the Weriyeng list
  assert.equal(PTS.find((p) => p.event === 'lean' && p.side === 'rise').local, 'Maechmeh');
  assert.equal(PTS.find((p) => p.event === 'upright').local, 'Wenewenenubw');
  assert.equal(PTS.find((p) => p.event === 'lean' && p.side === 'set').local, 'Maechemelotou');
  // every rising and setting point carries its star's name
  for (const p of PTS) if (p.event === 'rise' || p.event === 'set') assert.equal(p.local, E.STARS[p.star].local, p.label);
  // hollow (placed by a definition) is exactly the two leaning points; nothing is "one source"
  assert.deepEqual(PTS.filter((p) => p.byDefinition).map((p) => p.label),
    ['Southern Cross, leaning (rising)', 'Southern Cross, leaning (setting)']);
  assert.ok(PTS.every((p) => !('src' in p)), 'no point carries a source-count label');
});

// ------------------------------------------------------------ 2. the sphere ----------
test('bearings and distances agree with 3-D vectors, and the sphere with the WGS84 ellipsoid', () => {
  const pairs = [[P.puluwat, P.pisaras], [P.truk, P.pisaras], [P.puluwat, P.truk], [P.pisaras, P.puluwat]];
  for (const [p, q] of pairs) {
    assert.ok(Math.abs(wrap180(E.bearing(p, q) - bearingVec(p, q))) < 1e-9);
    assert.ok(Math.abs(E.distanceNm(p, q) - distVec(p, q)) < 1e-9);
    const v = vincenty(p, q);
    assert.ok(Math.abs(wrap180(E.bearing(p, q) - v.brg)) < 0.25, `bearing vs ellipsoid ${E.bearing(p, q)} ${v.brg}`);
    assert.ok(Math.abs(E.distanceNm(p, q) / v.nm - 1) < 0.006, `distance vs ellipsoid ${E.distanceNm(p, q)} ${v.nm}`);
  }
  const v1 = vincenty(P.puluwat, P.pisaras), v2 = vincenty(P.truk, P.pisaras), v3 = vincenty(P.puluwat, P.truk);
  log(`WGS84: Puluwat→Pisaras ${v1.nm.toFixed(1)} nm @ ${v1.brg.toFixed(2)}°, Chuuk→Pisaras ${v2.nm.toFixed(1)} nm @ ${v2.brg.toFixed(2)}°, Puluwat→Chuuk ${v3.nm.toFixed(1)} nm @ ${v3.brg.toFixed(2)}°`);
});

test('the voyage interpolates along the great circle', () => {
  for (let f = 0; f <= 1.0001; f += 0.1) {
    const a = V.at(f), b = interp(P.puluwat, P.truk, Math.min(f, 1));
    assert.ok(distVec(a, b) < 1e-9);
    assert.ok(Math.abs(distVec(P.puluwat, a) - f * V.total) < 1e-6);
  }
});

// ------------------------------------------------------------ 3. the etak ------------
// What the record lets the geometry test is the two ends: Pisaras under rising Vega from
// Puluwat and under setting Vega from Chuuk. The order of the points between them is forced
// by the compass (next test), so it is checked here but not counted as a confirmation.
test('the two ends: Pisaras lies nearest rising Vega from Puluwat and setting Vega from Chuuk', () => {
  const b0 = bearingVec(P.puluwat, P.pisaras), b1 = bearingVec(P.truk, P.pisaras);
  const near = (az) => PTS.reduce((best, p, i) => (Math.abs(wrap180(p.az - az)) < Math.abs(wrap180(PTS[best].az - az)) ? i : best), 0);
  assert.equal(PTS[near(b0)].label, 'rising Vega');
  assert.equal(PTS[near(b1)].label, 'setting Vega');
  assert.equal(PTS[V.segments.startPoint].label, 'rising Vega');
  assert.equal(PTS[V.segments.endPoint].label, 'setting Vega');
  // the margin at the start: how far the bearing is from where rising Schedar would be nearer
  const half = (PTS[idx('rise', 'schedar')].az + PTS[idx('rise', 'vega')].az) / 2;
  assert.ok(b0 - half > 2.5 && b0 - half < 3.5, `start margin ${b0 - half}`);
  const seq = V.segments.segments.map((s) => PTS[s.endPoint].label);
  const expected = ['rising Schedar', 'rising Dubhe', 'rising Kochab', 'Polaris', 'setting Kochab', 'setting Dubhe', 'setting Schedar', 'setting Vega'];
  assert.deepEqual(seq, expected);
  assert.equal(V.segments.segments.length, 8);
  log(`start ${b0.toFixed(2)}° (rising Vega ${PTS[idx('rise', 'vega')].az.toFixed(2)}°, margin ${(b0 - half).toFixed(2)}°), end ${b1.toFixed(2)}° (setting Vega ${PTS[idx('set', 'vega')].az.toFixed(2)}°)`);
  log('segments (nm):', V.segments.segments.map((s) => s.lengthNm.toFixed(1)).join(', '));
});

test('the order in between is forced: every island with the same two ends passes the same seven points', () => {
  // Reference islands scattered at random north of the track. Keep those that, like Pisaras,
  // lie nearest rising Vega from Puluwat and nearest setting Vega from Chuuk. Follow each one's
  // bearing along the track by brute force (no etak.js) and list the points it passes.
  let s = 20240917;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const near = (az) => PTS.reduce((best, p, i) => (Math.abs(wrap180(p.az - az)) < Math.abs(wrap180(PTS[best].az - az)) ? i : best), 0);
  const inner = ['rising Schedar', 'rising Dubhe', 'rising Kochab', 'Polaris', 'setting Kochab', 'setting Dubhe', 'setting Schedar'];
  const counts = new Set();
  let kept = 0;
  for (let k = 0; k < 3000; k++) {
    const ref = { lat: 7.6 + 4 * rnd(), lon: 148.5 + 4 * rnd() };
    if (PTS[near(bearingVec(P.puluwat, ref))].label !== 'rising Vega') continue;
    if (PTS[near(bearingVec(P.truk, ref))].label !== 'setting Vega') continue;
    kept++;
    const M = 400, passed = [];
    let u = bearingVec(P.puluwat, ref);
    for (let i = 1; i <= M; i++) {
      const nu = u + wrap180(bearingVec(interp(P.puluwat, P.truk, i / M), ref) - wrap360(u));
      assert.ok(nu < u, 'the bearing turns one way only');
      const hits = [];
      for (const p of PTS) for (const t of [-360, 0, 360]) if ((u - (p.az + t)) * (nu - (p.az + t)) < 0) hits.push({ x: (u - (p.az + t)) / (u - nu), label: p.label });
      hits.sort((a, b) => a.x - b.x).forEach((h) => passed.push(h.label));
      u = nu;
    }
    assert.deepEqual(passed.filter((l) => l !== 'rising Vega' && l !== 'setting Vega'), inner);
    counts.add(E.makeVoyage(P.puluwat, P.truk, ref).segments.segments.length);
  }
  assert.ok(kept >= 30, `only ${kept} islands kept`);
  // the etak count is not fixed by the record: it depends on which side of the Vega points the ends fall
  assert.ok(counts.has(8) && counts.size > 1, `counts ${[...counts]}`);
  log(`${kept} random islands with Pisaras's two ends: all pass the same seven points; etak counts ${[...counts].sort((a, b) => a - b).join(', ')}`);
});

test('every etak boundary agrees with brute-force sampling of the bearing', () => {
  const N = 40000;
  let prev = bearingVec(P.puluwat, P.pisaras), u = prev;
  const crossings = [];
  const targets = V.segments.crossings.map((c) => c.az);
  for (let i = 1; i <= N; i++) {
    const f = i / N, here = interp(P.puluwat, P.truk, f);
    const b = bearingVec(here, P.pisaras);
    const nu = u + wrap180(b - wrap360(u));
    for (const t of targets) {
      for (const tt of [t, t - 360]) if ((u - tt) * (nu - tt) <= 0 && u !== nu) crossings.push(f);
    }
    u = nu; prev = b;
  }
  void prev;
  assert.equal(crossings.length, V.segments.crossings.length);
  crossings.sort((a, b) => a - b).forEach((f, i) => assert.ok(Math.abs(f - V.segments.crossings[i].f) < 2 / N));
  const total = V.segments.segments.reduce((s, x) => s + x.lengthNm, 0);
  assert.ok(Math.abs(total - V.total) < 1e-9);
});

test('a bearing on the unseen island is a position: the inverse returns the fraction sailed', () => {
  for (let f = 0; f <= 1.0001; f += 0.025) {
    const g = E.fractionForBearing(V, V.refBearing(Math.min(f, 1)));
    assert.ok(Math.abs(g - Math.min(f, 1)) < 1e-6, `${f} -> ${g}`);
  }
  // a bearing beyond either end clamps
  assert.equal(E.fractionForBearing(V, 80), 0);
  assert.equal(E.fractionForBearing(V, 280), 1);
});

test('miles per degree: about one mile per degree mid-voyage, nearer three at the ends', () => {
  const d = 1e-4;
  const rate = (f) => Math.abs(wrap180(V.refBearing(f + d) - V.refBearing(f))) / (d * V.total);
  const mid = 1 / rate(0.49), end = 1 / rate(0.01), start = 1 / rate(0.0);
  assert.ok(mid > 0.9 && mid < 1.6, `mid ${mid}`);
  assert.ok(start > 2.2 && start < 3.2, `start ${start}`);
  log(`nm per degree: start ${start.toFixed(2)}, mid ${mid.toFixed(2)}, near end ${(1 / rate(0.99)).toFixed(2)}`);
  void end;
});

test('a nearer reference island makes more etak, a farther one fewer; one dead ahead barely moves', () => {
  const mid = interp(P.puluwat, P.truk, 0.5);
  let prevN = Infinity;
  const counts = [];
  for (const off of [0.25, 0.5, 0.8, 1.17, 1.6, 2.5, 4]) {
    const v = E.makeVoyage(P.puluwat, P.truk, { lat: mid.lat + off, lon: mid.lon });
    const n = v.segments.segments.length;
    assert.ok(n <= prevN, `count rose from ${prevN} to ${n} at offset ${off}°`);
    prevN = n; counts.push(n);
  }
  assert.ok(counts[0] > counts[counts.length - 1] + 6);
  // nearer: the middle stretches are the short ones
  const near = E.makeVoyage(P.puluwat, P.truk, { lat: mid.lat + 0.25, lon: mid.lon }).segments.segments;
  const mids = near.filter((s) => s.fromF > 0.35 && s.toF < 0.65).map((s) => s.lengthNm);
  const outer = near.filter((s, i) => i > 0 && !s.partial && (s.toF < 0.3 || s.fromF > 0.7)).map((s) => s.lengthNm);
  assert.ok(Math.max(...mids) < Math.min(...outer), `${mids} vs ${outer}`);
  // a reference beyond Chuuk, on the line of the course: its bearing hardly changes
  const ahead = E.makeVoyage(P.puluwat, P.truk, E.chartFromCanoe(P.truk, E.bearing(P.puluwat, P.truk), { x: 0, y: 60 }));
  assert.ok(Math.abs(ahead.segments.sweep) < 1, `sweep ${ahead.segments.sweep}`);
  assert.ok(ahead.segments.segments.length <= 2);
  log('etak count by offset north of mid-track (0.25° … 4°):', counts.join(', '));
});

test('the invented speed history closes the voyage exactly at roughly 3 to 7 knots', () => {
  let s = 7;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let k = 0; k < 2000; k++) {
    const legs = E.makeLegs(rnd, V.total, 8);
    const tl = E.legsToTimeline(legs, V.total);
    assert.ok(Math.abs(legs.reduce((a, l) => a + l.hours * l.knots, 0) - V.total) < 1e-9);
    assert.ok(Math.abs(tl[tl.length - 1].f - 1) < 1e-12);
    for (const l of legs) {
      assert.ok(l.knots > 2.9 && l.knots < 7.3, `speed ${l.knots}`);
      assert.ok(l.hours * 2 === Math.round(l.hours * 2));
    }
  }
});

// ------------------------------------------------------------ 4. frames --------------
test('canoe frame and chart are one set of numbers: every island round-trips within a metre', () => {
  let worst = 0;
  for (let f = 0; f <= 1.0001; f += 0.02) {
    const here = V.at(f), course = V.course(f);
    for (const place of [P.puluwat, P.pisaras, P.truk]) {
      if (distVec(here, place) < 0.01) continue; // standing on the island: no bearing
      const fr = E.canoeFrame(here, course, place);
      const back = E.chartFromCanoe(here, course, fr);
      worst = Math.max(worst, distVec(back, place) * 1852);
      // the canoe frame's bearing relative to the bow plus the course is the chart bearing
      assert.ok(Math.abs(wrap180(fr.rel + course - bearingVec(here, place))) < 1e-9);
    }
  }
  assert.ok(worst < 1, `worst ${worst} m`);
  log(`worst round-trip error ${worst.toExponential(2)} m`);
});

// ------------------------------------------------------------ 5. sighting ------------
test('Pisaras never comes within sight of the track', () => {
  // cross-track distance from the great circle, independently
  const n = crs(vec(P.puluwat), vec(P.truk)), nl = len(n);
  const xt = Math.abs(Math.asin(dot(vec(P.pisaras), n.map((x) => x / nl)))) * R_NM;
  const ca = E.closestApproach(V);
  assert.ok(Math.abs(ca.d - xt) < 0.05, `${ca.d} vs ${xt}`);
  const geometric = (Math.sqrt(2 * 6371008.8 * 3) + Math.sqrt(2 * 6371008.8 * 30)) / 1852; // no refraction
  const bowditch = E.sightingRangeNm(3, 30);
  assert.ok(bowditch > geometric && bowditch < geometric * 1.15);
  assert.ok(ca.d > 4 * bowditch);
  log(`closest ${ca.d.toFixed(1)} nm; sighting range ${geometric.toFixed(1)} nm (geometric) / ${bowditch.toFixed(1)} nm (with refraction)`);
});

// ------------------------------------------------------------ 6. relative motion -----
test('closest approach and bearing drift agree with step-by-step simulation', () => {
  let s = 12345;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  for (let k = 0; k < 300; k++) {
    const P0 = { x: (rnd() - 0.5) * 12, y: (rnd() - 0.5) * 12 }, Vr = { x: (rnd() - 0.5) * 16, y: (rnd() - 0.5) * 16 };
    const c = E.cpa(P0, Vr);
    let best = Infinity, bt = 0;
    for (let t = 0; t <= 30; t += 0.0005) {
      const d = Math.hypot(P0.x + Vr.x * t, P0.y + Vr.y * t);
      if (d < best) { best = d; bt = t; }
    }
    if (c.t < 30) assert.ok(Math.abs(c.d - best) < 1e-3, `${c.d} vs ${best}`);
    void bt;
    const h = 1e-6, num = wrap180(E.relBearingAt(P0, Vr, h) - E.relBearingAt(P0, Vr, 0)) / h;
    assert.ok(Math.abs(num - c.bearingRate) < 1e-3 * Math.max(1, Math.abs(num)), `${num} vs ${c.bearingRate}`);
  }
  // constant bearing, closing range: they meet
  const Vr = { x: -3, y: -4 }, P0 = { x: 6, y: 8 };
  const c = E.cpa(P0, Vr);
  assert.ok(c.d < 1e-12 && Math.abs(c.bearingRate) < 1e-12);
  for (let t = 0; t < 1.9; t += 0.1) assert.ok(Math.abs(E.relBearingAt(P0, Vr, t) - E.relBearingAt(P0, Vr, 0)) < 1e-9);
  // constant bearing without a meeting: same course and speed, and a vessel moving straight away
  const still = E.cpa({ x: 1, y: 0 }, { x: 0, y: 0 });
  assert.ok(still.bearingRate === 0 && Math.abs(still.d - 1) < 1e-12, 'no relative motion: fixed bearing, fixed range');
  const away = E.cpa({ x: 3, y: 4 }, { x: 0.6, y: 0.8 });
  assert.ok(Math.abs(away.bearingRate) < 1e-12 && Math.abs(away.d - 5) < 1e-12, 'receding: fixed bearing, range opening');
  for (let t = 0; t < 3; t += 0.5) assert.ok(Math.hypot(3 + 0.6 * t, 4 + 0.8 * t) >= 5);
});

// ------------------------------------------------------------ 7. the page's numbers --
const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const sources = JSON.parse(fs.readFileSync(new URL('./sources.json', import.meta.url), 'utf8'));

test('every number tagged data-claim in the page matches the model', () => {
  const sp = (a, b) => Math.abs(wrap180(PTS[idx('rise', b)].az - PTS[idx('rise', a)].az));
  const segs = V.segments.segments;
  const full = segs.filter((x, i) => i > 0 && !x.partial).map((x) => x.lengthNm);
  const d = 1e-4;
  const rate = (f) => Math.abs(wrap180(V.refBearing(f + d) - V.refBearing(f))) / (d * V.total);
  const ca = E.closestApproach(V);
  // section 6: how far north of the lagoon's centre a course held on rising Altair passes
  // (cross-track distance from the great circle leaving Puluwat on that azimuth, by vectors)
  const altairLine = (() => {
    const n0 = vec(P.puluwat), z = [0, 0, 1], east = crs(z, n0), el = len(east), e = east.map((x) => x / el), north = crs(n0, e);
    const a = PTS[idx('rise', 'altair')].az * RAD, dir = e.map((x, i) => x * Math.sin(a) + north[i] * Math.cos(a));
    const pole = crs(n0, dir), pl = len(pole);
    return -Math.asin(dot(vec(P.truk), pole.map((x) => x / pl))) * R_NM; // + when the lagoon lies south of that course
  })();
  // section 6: on an even 32-point ring set by north, rising Altair's point (k = 8) is due east
  assert.equal(Math.round(V.course(0) / 11.25), 8);
  // section 5: how far the destination's bearing moves against the stars over the voyage
  let destDrift = 0;
  for (let i = 0; i < 1000; i++) destDrift = Math.max(destDrift, Math.abs(wrap180(bearingVec(interp(P.puluwat, P.truk, i / 1000), P.truk) - V.course(0))));
  const expected = {
    altair_rise: [PTS[idx('rise', 'altair')].az, 1],
    altair_north_of_east: [90 - PTS[idx('rise', 'altair')].az, 1],
    gap_schedar_dubhe: [sp('schedar', 'dubhe'), 1],
    gap_vega_schedar: [sp('vega', 'schedar'), 1],
    gap_aquila: [PTS[idx('rise', 'alshain')].az - PTS[idx('rise', 'tarazed')].az, 1],
    total_nm: [V.total, 0],
    total_nm_b: [V.total, 0],
    pis_from_pul: [E.bearing(P.puluwat, P.pisaras), 1],
    pis_from_pul_nm: [E.distanceNm(P.puluwat, P.pisaras), 0],
    pis_from_pul_mi: [E.distanceNm(P.puluwat, P.pisaras) * 1.852 / 1.609344, 0],
    vega_rise: [PTS[idx('rise', 'vega')].az, 1],
    vega_set: [PTS[idx('set', 'vega')].az, 1],
    pis_from_truk: [E.bearing(P.truk, P.pisaras), 1],
    sweep: [Math.abs(V.segments.sweep), 0],
    n_etak: [segs.length, 0],
    closest_nm: [ca.d, 0],
    sight_nm: [E.sightingRangeNm(3, 30), 0],
    seg_min: [Math.min(...full), 1],
    seg_max_full: [Math.max(...full), 1],
    rate_start: [rate(0), 2],
    rate_abeam: [rate(ca.f), 2],
    course: [V.course(0), 1],
    nm_per_deg_mid: [1 / rate(ca.f), 1],
    start_off: [PTS[idx('rise', 'vega')].az - E.bearing(P.puluwat, P.pisaras), 1],
    end_off: [E.bearing(P.truk, P.pisaras) - PTS[idx('set', 'vega')].az, 1],
    start_margin: [E.bearing(P.puluwat, P.pisaras) - (PTS[idx('rise', 'schedar')].az + PTS[idx('rise', 'vega')].az) / 2, 1],
    lean_asym: [PTS[idx('lean', 'acrux')].az - (360 - PTS.find((p) => p.event === 'lean' && p.side === 'set').az), 1],
    chuuk_off_belt: [PTS[idx('rise', 'belt')].az - V.course(0), 1],
    chuuk_off_altair: [V.course(0) - PTS[idx('rise', 'altair')].az, 1],
    altair_line_nm: [altairLine, 0],
    even_off: [Math.abs(V.course(0) - 90), 1],
    dest_drift: [destDrift, 1],
    nm_per_deg_end: [1 / rate(0), 1],
  };
  const tagged = [...html.matchAll(/data-claim="([a-z_]+)">([^<]+)</g)];
  const attrs = (html.match(/data-claim="/g) || []).length;
  assert.equal(tagged.length, attrs, 'a data-claim attribute was not parsed');
  const seen = new Set();
  for (const [, key, text] of tagged) {
    assert.ok(key in expected, `no expected value for ${key}`);
    const [val, dp] = expected[key];
    assert.equal(text.trim(), val.toFixed(dp), `${key}: page says ${text}, model gives ${val.toFixed(dp + 2)}`);
    seen.add(key);
  }
  for (const k of Object.keys(expected)) assert.ok(seen.has(k), `${k} not on the page`);
  log(`${tagged.length} tagged numbers match`);
});

test('every citation has a sources.json entry and a list item, and every source is cited', () => {
  const cited = new Set([...html.matchAll(/data-src="([a-z0-9-]+)"/g)].map((m) => m[1]));
  const listed = new Set([...html.matchAll(/<li id="src-([a-z0-9-]+)"/g)].map((m) => m[1]));
  const ids = new Set(sources.map((s) => s.id));
  assert.equal(ids.size, sources.length, 'duplicate ids in sources.json');
  for (const c of cited) {
    assert.ok(ids.has(c), `cited ${c} missing from sources.json`);
    assert.ok(listed.has(c), `cited ${c} missing from the page's source list`);
    assert.ok(html.includes(`href="#src-${c}"`), `cite ${c} does not link to its entry`);
  }
  for (const id of ids) {
    assert.ok(cited.has(id), `sources.json entry ${id} is never cited on the page`);
    assert.ok(listed.has(id), `sources.json entry ${id} has no list item`);
  }
  for (const id of listed) assert.ok(ids.has(id), `list item ${id} not in sources.json`);
  for (const s of sources) {
    for (const f of ['id', 'author', 'year', 'title', 'venue', 'claim', 'verified', 'found_via']) {
      assert.ok(s[f] !== undefined && String(s[f]).length > 0, `${s.id} lacks ${f}`);
    }
  }
  log(`${cited.size} sources cited, all with entries`);
});

// ------------------------------------------------------------ 8. the review's corrections
// An independent review found claims that went further than the evidence. These checks keep
// the corrected wording from drifting back.
test('the corrections from the independent review stay in the page and the README', () => {
  const readme = fs.readFileSync(new URL('./README.md', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  const lib = fs.readFileSync(new URL('./etak.js', import.meta.url), 'utf8');
  // 1. the star sequence is forced by the compass once the ends are fixed; only the ends are tested
  assert.doesNotMatch(html, /Nothing in the model was tuned to get this/);
  assert.doesNotMatch(readme, /a check I could not predict/);
  assert.match(html, /That order is not a second check/);
  assert.match(readme, /they are not a second test/);
  // 2. no point is labelled as resting on one source; hollow means "placed by a definition"
  for (const text of [html, app, lib, readme]) {
    assert.doesNotMatch(text, /Weriyeng list only|Two sources\.|src: 'one'|points from one source hollow/);
  }
  assert.match(html, /Hollow ticks: the two leaning-Cross points/);
  // 3. Chuuk is two compass points from rising Altair on this ring; the destination does not "sit on a star"
  assert.doesNotMatch(html, /sits on the same star/);
  assert.match(html, /two-point disagreement/);
  // 5. the 45° lean is the Weriyeng compass's definition, not the author's own
  assert.doesNotMatch(html + readme, /placed by my definition|use my own definition/);
  // 6. star positions are HYG v4.1 (via McDonald), not SIMBAD
  assert.doesNotMatch(html, /data-src="simbad"/);
  assert.ok(!sources.some((x) => x.id === 'simbad'));
  assert.match(html, /data-src="hyg"/);
  // 7. a constant bearing means a meeting only for an approaching vessel
  assert.match(html, /For an approaching vessel on a steady course/);
  // the README records what changed
  assert.match(readme, /^## Revision note$/m);
});

