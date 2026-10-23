// Tests for the Antikythera Crank model. Run: node --test ideas/55-antikythera-crank/
// Every check compares the model with something it does not share code with: exact
// integer relations, closed forms, published dates and values, or worked examples.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const AK = require('./mechanism.js');
const JSONDATA = JSON.parse(fs.readFileSync(path.join(here, 'gears.json'), 'utf8'));
const README = fs.readFileSync(path.join(here, 'README.md'), 'utf8');

// exact fractions, written independently of the model's
const gcd = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a; };
const Q = (n, d = 1n) => { n = BigInt(n); d = BigInt(d); if (d < 0n) { n = -n; d = -d; } const g = gcd(n, d); return [n / g, d / g]; };
const qmul = (a, b) => Q(a[0] * b[0], a[1] * b[1]);
const qadd = (a, b) => Q(a[0] * b[1] + b[0] * a[1], a[1] * b[1]);
const qsub = (a, b) => Q(a[0] * b[1] - b[0] * a[1], a[1] * b[1]);
const qdiv = (a, b) => Q(a[0] * b[1], a[1] * b[0]);
const qeq = (a, b) => a[0] === b[0] && a[1] === b[1];
const qs = (a) => `${a[0]}/${a[1]}`;
const T = Object.fromEntries(JSONDATA.gears.map((g) => [g.id, g.teeth]));
const product = (meshes) => meshes.reduce((acc, [dr, dn]) => qmul(acc, Q(T[dr], T[dn])), Q(1));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b} (tol ${tol})`);
const D2R = Math.PI / 180;

test('gears.js (for the page) is an exact copy of gears.json', () => {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(here, 'gears.js'), 'utf8'), ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.window.AK_GEARS)), JSONDATA);
  assert.deepEqual(AK.DATA, JSONDATA);
});

test('gear table is complete and consistent', () => {
  const ids = new Set(JSONDATA.gears.map((g) => g.id));
  assert.equal(ids.size, JSONDATA.gears.length, 'duplicate gear ids');
  for (const g of JSONDATA.gears) {
    assert.ok(['ct', 'inferred', 'hypothetical'].includes(g.evidence), `${g.id} evidence`);
    assert.ok(g.teeth === null || (Number.isInteger(g.teeth) && g.teeth > 0), `${g.id} teeth`);
    assert.ok(g.sources.length > 0 && g.sources.every((s) => s in JSONDATA.sources), `${g.id} sources`);
    assert.ok(g.count_note && g.role, `${g.id} notes`);
  }
  for (const [a, b] of JSONDATA.meshes) {
    assert.ok(ids.has(a) && ids.has(b), `mesh ${a}-${b}`);
    assert.notEqual(AK.ARBOR_OF[a], AK.ARBOR_OF[b], `mesh ${a}-${b} on one arbor`);
  }
  for (const t of JSONDATA.trains) for (const [a, b] of t.meshes) {
    assert.ok(JSONDATA.meshes.some(([x, y]) => x === a && y === b), `train ${t.id} uses unknown mesh ${a}-${b}`);
  }
  // 30 gears survive: 27 in Fragment A and one each in B, C and D (Freeth et al. 2006, 2021)
  const surviving = JSONDATA.gears.filter((g) => g.evidence !== 'hypothetical');
  assert.equal(surviving.length, 30);
  assert.equal(surviving.filter((g) => g.fragment === 'A').length, 27);
  for (const f of ['B', 'C', 'D']) assert.equal(surviving.filter((g) => g.fragment === f).length, 1, `fragment ${f}`);
  // the hypothetical gears are exactly the ones the reconstructions add
  assert.deepEqual(JSONDATA.gears.filter((g) => g.evidence === 'hypothetical').map((g) => g.id).sort(),
    ['F51', 'F56', 'm3', 'n1', 'n2', 'n3', 'p1', 'p2', 'q1']);
});

test('every train ratio equals the astronomical relation it encodes, exactly', () => {
  const synodicPerYear = Q(235, 19); // Metonic: 235 synodic months in 19 years
  const expected = {
    moon: qadd(synodicPerYear, Q(1)), // sidereal = synodic + the Sun's one lap: 254/19
    platform: qsub(qadd(synodicPerYear, Q(1)), qmul(Q(239, 223), synodicPerYear)), // Moon minus anomaly
    metonic: qdiv(synodicPerYear, Q(47)), // 47 cells a turn, 235 cells in 5 turns
    callippic: Q(1, 76),
    games: Q(1, 4),
    saros: qmul(Q(4, 223), synodicPerYear), // 4 turns per 223 months
    exeligmos: qdiv(synodicPerYear, Q(3 * 223)), // one turn per 3 Saros
    moon_out: Q(1)
  };
  for (const t of JSONDATA.trains) {
    const mine = product(t.meshes);
    const model = AK.trainRatio(t.meshes).ratio;
    assert.ok(qeq(mine, expected[t.id]), `${t.id}: gears give ${qs(mine)}, astronomy gives ${qs(expected[t.id])}`);
    assert.ok(qeq(mine, Q(t.expect[0], t.expect[1])), `${t.id}: gears.json "expect" field`);
    assert.equal(`${model.n}/${model.d}`, qs(mine), `${t.id}: model's own fraction`);
  }
  assert.ok(qeq(product(JSONDATA.trains[0].meshes), Q(254, 19)));
  // the anomalistic rate the pin sees: 239 anomalistic months per 223 synodic, exactly
  const anomaly = qsub(Q(254, 19), Q(477, 4237));
  assert.ok(qeq(anomaly, qmul(Q(239, 223), synodicPerYear)), qs(anomaly));
  assert.equal(qs(anomaly), '56165/4237');
});

test('directions: Moon pointer with the Sun; Metonic, Saros, Callippic, Exeligmos together; Games the other way', () => {
  const dir = (id) => AK.trainRatio(AK.train(id).meshes).sign;
  assert.equal(dir('moon') * dir('moon_out'), 1, 'Moon pointer turns with b1');
  for (const id of ['saros', 'callippic', 'exeligmos']) assert.equal(dir(id), dir('metonic'), id);
  assert.equal(dir('games'), -dir('metonic'), 'Games dial turns against the others');
});

test('the hypothetical counts are forced by the surviving ones', () => {
  // m3: the Saros pointer must make 4 turns in 223 synodic months
  const rest = product([['b2', 'l1'], ['l2', 'm1'], ['e4', 'f1'], ['f2', 'g1']]);
  const m3 = qdiv(qmul(Q(4, 223), Q(235, 19)), qmul(rest, Q(1, 223)));
  assert.deepEqual(m3, Q(27), `m3 = ${qs(m3)}`);
  // n1: the Metonic pointer must make 5 turns in 19 years, given m2 = 15
  const n1 = qdiv(qmul(product([['b2', 'l1'], ['l2', 'm1']]), Q(15)), Q(5, 19));
  assert.deepEqual(n1, Q(53), `n1 = ${qs(n1)}`);
  // n3: the Games dial must turn once in 4 years, given o1 = 60
  const n3 = qmul(qdiv(Q(1, 4), Q(5, 19)), Q(60));
  assert.deepEqual(n3, Q(57), `n3 = ${qs(n3)}`);
  // l2's prime 53 is forced by the turntable: 254*223 - 239*235 = 477 = 9*53, the numerator of 477/4237
  assert.equal(254 * 223 - 239 * 235, 477); assert.equal(477, 9 * 53); assert.equal(4237, 19 * 223);
  // and the calendar and eclipse trains cancel it: l2 against n1 (Metonic) and against f1 (Saros)
  assert.equal(T.l2, T.n1); assert.equal(T.l2, T.f1);
});

test('kinematics: every pointer follows its train, through the actual epicyclic gearing', () => {
  for (const Y of [0, 0.37, 1, 4.2, 18.03, 19, 76.5, 140.2, -3.3]) {
    const k = AK.kinematics(Y, 0).theta;
    near(k.b, Y, 1e-12);
    near(k.e_moon, -254 / 19 * Y, 1e-9, 'e2');
    near(k.e_platform, -477 / 4237 * Y, 1e-12, 'e3');
    near(-k.n, 5 / 19 * Y, 1e-12, 'Metonic');
    near(-k.q, Y / 76, 1e-12, 'Callippic');
    near(k.o, Y / 4, 1e-12, 'Games');
    near(-k.g, 940 / 4237 * Y, 1e-12, 'Saros');
    near(-k.i, 235 / 12711 * Y, 1e-12, 'Exeligmos');
    near(-k.a, 223 / 48 * Y, 1e-9, 'crank (a1) turns');
  }
});

test('pin and slot: output equals the eccentric/epicycle law, from an independent series', () => {
  const eps = 1.1 / 9.6;
  near(AK.ECC, eps, 1e-15);
  // Independent closed form: for a pin at radius r driving a slot about an axis offset by e*r,
  // the slot lags/leads by sum_{n>=1} e^n/n sin(n M) (expansion of arg(1 - e exp(-iM))).
  const series = (M) => { let s = 0; for (let n = 1; n < 40; n++) s += Math.pow(eps, n) / n * Math.sin(n * M); return s; };
  let maxErr = 0;
  for (let Y = 0; Y < 2; Y += 0.0007) {
    const kin = AK.kinematics(Y, 0.3);
    const M = 2 * Math.PI * 56165 / 4237 * Y + 0.3; // anomaly from the exact ratio
    const moonPointer = kin.theta.b_moon * 2 * Math.PI; // radians
    const meanMoon = 2 * Math.PI * 254 / 19 * Y;
    maxErr = Math.max(maxErr, Math.abs(AK.wrapPi(moonPointer - meanMoon - series(M))));
  }
  assert.ok(maxErr < 1e-12, `max error ${maxErr}`);
  // amplitude: law of sines gives asin(e); a quarter-turn from the line of centres it is atan(e)
  let mx = 0, argmax = 0;
  for (let M = 0; M < Math.PI; M += 1e-5) { const d = AK.pinSlotDeviation(M); if (d > mx) { mx = d; argmax = M; } }
  near(mx / D2R, Math.asin(eps) / D2R, 1e-6);
  near(Math.asin(eps) / D2R, 6.580, 0.0005, 'max deviation 6.58 deg');
  near(Math.atan(eps) / D2R, 6.537, 0.0005, 'deviation at a right angle 6.54 deg');
  // the maximum comes when the slot points at right angles to the line of centres: cos M = e
  near(argmax, Math.acos(eps), 1e-4, 'the maximum sits a little before the quadrature');
  // period: one anomalistic month of the mechanism, 4237/56165 years = 27.5543 days
  const P = 4237 / 56165;
  for (const Y of [0.1, 3.7]) near(AK.kinematics(Y, 0).deviation, AK.kinematics(Y + P, 0).deviation, 1e-9);
  near(P * AK.MODERN.tropicalYear, 27.5533, 0.0001, 'mechanism anomalistic month (days); modern 27.5545');
  // Hipparchus (Almagest IV.11): eccentre 327 2/3 : 3144 and epicycle 247 1/2 : 3122 1/2
  near(Math.asin((327 + 2 / 3) / 3144) / D2R, 5.98, 0.005);
  near(Math.asin(247.5 / 3122.5) / D2R, 4.55, 0.005);
});

test('pin and slot is a mechanical realisation of the eccentric model, not an approximation of it', () => {
  const e = AK.ECC;
  for (let M = -3; M <= 3; M += 0.01) {
    // Eccentre: body uniform on a unit circle whose centre sits e from the observer, on the apsidal line.
    const eccentric = Math.atan2(Math.sin(M), Math.cos(M) - e) - M;
    // Epicycle (Apollonius): epicycle centre carried round a unit deferent at angle M; the body on an
    // epicycle of radius e that turns backwards relative to the deferent arm by M (so its radius vector
    // keeps the fixed direction of the apogee, angle pi).
    const C = [Math.cos(M), Math.sin(M)];
    const beta = Math.PI - M; // epicycle angle measured from the deferent arm
    const body = [C[0] + e * Math.cos(M + beta), C[1] + e * Math.sin(M + beta)];
    const epicycle = Math.atan2(body[1], body[0]) - M;
    near(AK.wrapPi(AK.pinSlotDeviation(M) - eccentric), 0, 1e-12);
    near(AK.wrapPi(eccentric - epicycle), 0, 1e-12);
  }
});

test('reference astronomy reproduces worked examples and published eclipses', () => {
  // Meeus example 25.a: 1992 Oct 13.0 TD, Sun's true longitude 199.90988 deg
  near(AK.sunModern(2448908.5).lon, 199.90988, 0.0002, 'Sun');
  // Meeus example 47.a: 1992 Apr 12.0 TD, Moon's longitude 133.162655 deg (before nutation)
  near(AK.moonModern(2448724.5).lon, 133.162655, 0.003, 'Moon');
  const k = (y, m, d, full) => { const jd = AK.jdFromDate(y, m, d); const kk = Math.round((jd - 2451550.09766) / 29.530588861 - (full ? 0.5 : 0)); return full ? kk + 0.5 : kk; };
  // NASA (Espenak): gamma 0.4367 (2017 Aug 21, Saros 145) and 0.3431 (2024 Apr 8, Saros 139)
  let e = AK.eclipseAt(k(2017, 8, 21)); near(e.gamma, 0.4367, 0.002); assert.equal(e.type, 'total'); assert.equal(AK.sarosSeries(e.k, false), 145);
  e = AK.eclipseAt(k(2024, 4, 8)); near(e.gamma, 0.3431, 0.002); assert.equal(e.type, 'total'); assert.equal(AK.sarosSeries(e.k, false), 139);
  // NASA: umbral magnitude 1.609 (2018 Jul 27, Saros 129) and 1.359 (2022 Nov 8, Saros 136)
  e = AK.eclipseAt(k(2018, 7, 27, true)); near(e.umbral, 1.609, 0.01); assert.equal(AK.sarosSeries(e.k, true), 129);
  e = AK.eclipseAt(k(2022, 11, 8, true)); near(e.umbral, 1.359, 0.01); assert.equal(AK.sarosSeries(e.k, true), 136);
  // Meeus examples 54.a and 54.b
  e = AK.eclipseAt(k(1993, 5, 21)); near(e.gamma, 1.1348, 0.0005); near(e.magnitude, 0.740, 0.001); assert.equal(e.type, 'partial');
  e = AK.eclipseAt(k(1973, 6, 15, true)); assert.equal(e.type, 'penumbral'); near(e.penumbral, 0.4625, 0.001);
});

test('calendars: Julian Day, Egyptian calendar', () => {
  near(AK.jdFromDate(1957, 10, 4.81), 2436116.31, 1e-9, 'Meeus example 7.a');
  near(AK.jdFromDate(-1000, 7, 12.5), 1356001.0, 1e-9, 'Meeus: -1000 July 12.5');
  assert.equal(AK.formatDate(AK.jdFromDate(-204, 4, 28, 'julian')), '28 April 205 BC');
  // Egyptian: 1 Thoth of Nabonassar year 1 = JD 1448638 (26 Feb 747 BC); era of Philip,
  // 1 Thoth of Nabonassar 425 = 12 Nov 324 BC (Ptolemy's two eras, 424 Egyptian years apart)
  assert.equal(AK.formatDate(1448638), '26 February 747 BC');
  const ph = AK.egyptianDate(AK.jdFromDate(-323, 11, 12, 'julian'));
  assert.deepEqual([ph.year, ph.month, ph.day], [425, 'Thoth', 1]);
});

const jdOfCellStart = (dialMonths) => AK.jdFromYears(dialMonths / AK.MONTHS_PER_YEAR);

test('dials at known dates match the published layouts and epochs', () => {
  // Saros cell 1 is the lunar month that began with the conjunction of 28 April 205 BC (Jones 2020),
  // with its full Moon on 12 May 205 BC (Carman & Evans 2014).
  const may12 = AK.jdFromDate(-204, 5, 12.5, 'julian');
  assert.equal(AK.read(AK.yearsFromJd(may12)).saros.cell, 1);
  near(AK.EPOCH_JD, AK.jdFromDate(-204, 4, 28, 'julian'), 1.0, 'epoch = conjunction of 28 April 205 BC');
  // the 223-month cycle ends at the conjunction of 9 May 187 BC (Jones 2020)
  near(jdOfCellStart(223), AK.jdFromDate(-186, 5, 9.5, 'julian'), 1.0, 'end of the epoch Saros');
  // month 13's solar eclipse belongs to solar Saros series 44 (Carman & Evans 2014)
  const c13 = AK.ENGRAVED[12];
  assert.ok(c13.solar, 'an eclipse in cell 13'); assert.equal(c13.solar.saros, 44);
  assert.equal(AK.formatDate(c13.solar.jde - AK.deltaT(-203) / 86400), '17 May 204 BC');
  // Metonic dial: starts four lunations later, near the new Moon of 23 August 205 BC (Iversen 2017)
  near(jdOfCellStart(AK.METONIC_OFFSET_MONTHS), AK.jdFromDate(-204, 8, 23.5, 'julian'), 1.5, 'Metonic epoch');
  const met1 = AK.read((AK.METONIC_OFFSET_MONTHS + 0.5) / AK.MONTHS_PER_YEAR);
  assert.equal(met1.metonic.cell, 1); assert.equal(met1.metonic.info.month, 'Phoinikaios'); assert.equal(met1.metonic.info.year, 1);
  // the one intercalation I could check: year 11's extra Machaneus is cell 129
  assert.deepEqual(AK.METONIC_CELLS[128], { year: 11, month: 'Machaneus', index: 4, intercalary: true });
  assert.equal(AK.METONIC_CELLS.length, 235);
  assert.equal(AK.METONIC_CELLS.filter((c) => c.intercalary).length, 7);
  // Games dial: year 1 (Isthmia, Olympia) holds the spring and summer of 204 BC, when the
  // 144th Olympiad began (Olympiad n began in the summer of 776 - 4(n-1) BC)
  for (const [m, d] of [[4, 15], [7, 20]]) {
    const r = AK.read(AK.yearsFromJd(AK.jdFromDate(-203, m, d, 'julian')));
    assert.equal(r.games.year, 1); assert.deepEqual(r.games.games, ['Isthmia', 'Olympia']);
  }
  assert.equal(776 - 4 * (144 - 1), 204);
  // one Metonic cycle on: back to cell 1, Callippic sector 2, Games dial back to the same year
  const after = AK.read((AK.METONIC_OFFSET_MONTHS + 235 + 0.5) / AK.MONTHS_PER_YEAR);
  assert.equal(after.metonic.cell, 1); assert.equal(after.callippic.sector, 2);
  // one Saros on: cell 1 again, Exeligmos sector 2 (+8 hours); three on: sector 1 again
  for (const [n, sector, hours] of [[1, 2, 8], [2, 3, 16], [3, 1, 0]]) {
    const r = AK.read((223 * n + 0.5) / AK.MONTHS_PER_YEAR);
    assert.equal(r.saros.cell, 1); assert.equal(r.exeligmos.sector, sector); assert.equal(r.exeligmos.hours, hours);
  }
});

test('the engraved Saros dial: 38 eclipse seasons, as many as there are nodal returns in 223 months', () => {
  const lunarMonths = AK.ENGRAVED.filter((c) => c.lunar).map((c) => c.cell);
  const seasons = lunarMonths.filter((m, i) => i === 0 || m - lunarMonths[i - 1] > 1);
  assert.equal(seasons.length, 38);
  // seasons are 5 or 6 months apart
  for (let i = 1; i < seasons.length; i++) assert.ok([5, 6].includes(seasons[i] - seasons[i - 1]), `gap ${seasons[i] - seasons[i - 1]}`);
  const umbral = AK.ENGRAVED.filter((c) => c.lunar && c.lunar.type !== 'penumbral').length;
  const solar = AK.ENGRAVED.filter((c) => c.solar).length;
  assert.equal(umbral, 27); assert.equal(solar, 41);
  assert.equal(AK.ENGRAVED[0].lunar, null); assert.equal(AK.ENGRAVED[0].solar, null);
});

test('drift: the figures quoted in the README', () => {
  const rows = Object.fromEntries(AK.driftTable().map((r) => [r.id, r]));
  near(rows.moon.perDecade, 0.557, 0.001); near(rows.moon.perCentury, 5.57, 0.01);
  near(rows.anomaly.perCentury, 21.6, 0.05);
  // the apsides row is in the same frame as the others (against the equinox): perigee = Moon - anomaly,
  // so its drift must equal the Moon's minus the anomaly's (the old sidereal comparison gave -14.7)
  near(rows.apsides.perCentury, -16.06, 0.01);
  near(rows.apsides.perCentury, rows.moon.perCentury - rows.anomaly.perCentury, 0.001, 'apsides = moon - anomaly');
  // and independently, from Meeus's tropical rates per Julian century: perigee L - M' against e3's 477/4237
  near(477 / 4237 * 360 * 36525 / 365.242189 - (481267.88123421 - 477198.8675055), -16.06, 0.01);
  near(rows.Mercury.perCentury, 4.12, 0.01); near(rows.Venus.perCentury, 1.52, 0.01); near(rows.Mars.perCentury, 0.44, 0.01);
  near(rows.Jupiter.perCentury, 1.35, 0.01); near(rows.Saturn.perCentury, 1.77, 0.01);
  const f = AK.cycleFacts();
  near(f.mechanismMonthDays, 29.53022, 0.000005); near(f.modernMonthDays - f.mechanismMonthDays, 0.00037, 0.000005);
  near(f.metonicDayPerYears, 219, 0.5);
  near(f.saros.synodic223, 6585.32, 0.005); near(f.saros.mechanism, 6585.24, 0.005);
  near(f.sarosHours, 7.71, 0.005); near(f.sarosNodeShiftDeg, 0.478, 0.001);
  near(f.apsidesYears.mechanism, 8.883, 0.0005); near(f.apsidesYears.modern, 8.848, 0.0005); near(f.apsidesYears.modernSidereal, 8.851, 0.0005);
  near(f.callippic.years76, 27758.41, 0.01); near(f.callippic.months940, 27758.75, 0.01);
  // the modern synodic periods implied by Meeus's mean motions match NASA's fact sheets
  for (const [p, d] of [['Mercury', 115.88], ['Venus', 583.92], ['Mars', 779.94], ['Jupiter', 398.88], ['Saturn', 378.09]]) near(AK.planetSynodicDays(p), d, 0.01, p);
  // the 2021 period relations: Venus 289 in 462 years, Saturn 427 in 442 (Front Cover Inscription)
  const P = Object.fromEntries(JSONDATA.planets.map((p) => [p.name, p]));
  assert.deepEqual([P.Venus.synodic_cycles, P.Venus.years, P.Saturn.synodic_cycles, P.Saturn.years], [289, 462, 427, 442]);
  // factor structure Freeth et al. describe: 17 shared by Mercury and Venus, 7 by Mars, Jupiter, Saturn
  assert.equal(1513 % 17, 0); assert.equal(289 % 17, 0);
  for (const n of [133, 315, 427]) assert.equal(n % 7, 0);
});

test('drift against the full Moon theory over decades (numbers quoted in the README)', () => {
  const err = (Y) => AK.sgn180(AK.read(Y).moon - AK.sky(AK.jdFromYears(Y)).moon);
  // Sample every 6 hours (fine enough that a peak is missed by under 0.01 deg), then refine the
  // largest sample to the minute. The old 3-day sampling understated every maximum by 0.1-0.3 deg.
  const stats = (y0, y1) => {
    const h = 1 / 4 / 365.25;
    let mx = 0, at = y0, sum = 0, n = 0;
    for (let Y = y0; Y <= y1; Y += h) {
      const d = err(Y);
      if (Math.abs(d) > mx) { mx = Math.abs(d); at = Y; }
      sum += d; n++;
    }
    for (let Y = at - h; Y <= at + h; Y += h / 360) mx = Math.max(mx, Math.abs(err(Y)));
    return { max: mx, mean: sum / n };
  };
  let s = stats(0, 1); near(s.mean, 0, 0.1); near(s.max, 2.74, 0.03);
  s = stats(9, 10); near(s.mean, 0.56, 0.05); near(s.max, 3.49, 0.03);
  near(stats(0, 10).max, 3.49, 0.03, 'first decade: up to about 3.5 deg');
  s = stats(49, 50); near(s.mean, 2.8, 0.05); near(s.max, 6.62, 0.03);
  s = stats(99, 100); near(s.mean, 5.6, 0.1); near(s.max, 10.77, 0.03);
  // by the wreck (c. 65 BC, 140 years on): mean about 8 deg, worst about 14 deg
  s = stats(140, 141); near(s.mean, 8.0, 0.15); near(s.max, 13.77, 0.03);
  // glyph survival: how many engraved eclipse months still have that eclipse, Saros by Saros
  const g = AK.glyphSurvival(5);
  assert.deepEqual(g[5].lunar, [25, 27]); assert.deepEqual(g[5].solar, [39, 41]); assert.equal(g[5].unmarked, 8);
  near(g[5].years, 90.15, 0.01);
  // "about 125 degrees off on average" today: the page's own Moon against modern theory, averaged
  // over 2026. (The J2000 rate of 5.57 deg a century alone gives 124; Delta-T and the slow change in
  // the Moon's real mean motion since 205 BC add about 1 deg.)
  const Y2026 = AK.yearsFromJd(AK.jdFromDate(2026, 1, 1));
  near(Y2026, 2230, 1);
  near(AK.driftTable()[0].degPerYear * Y2026, 124.2, 0.1);
  let sum = 0, n = 0;
  for (let Y = Y2026; Y < Y2026 + 1; Y += 1 / 365.25) { sum += err(Y); n++; }
  near(sum / n, 125.2, 0.3, 'mean error over 2026');
});

test('the drift table matches what the page itself shows over the first century', () => {
  // The table uses J2000 mean motions. Run the page's own mechanism against its own modern sky from
  // 205 BC to 105 BC: the mean Moon, the anomaly and the perigee (mean Moon minus anomaly) must drift
  // at the table's rates to within the slow change in the Moon's real rates (under 0.6 deg a century).
  // Before the apsides row was put in the equinox frame it said -14.7 here, against -16.5 simulated.
  const rows = Object.fromEntries(AK.driftTable().map((r) => [r.id, r]));
  const r = AK.read(100), s = AK.sky(AK.jdFromYears(100));
  const r0 = AK.read(0), s0 = AK.sky(AK.jdFromYears(0));
  const d = (a, b, a0, b0) => AK.sgn180((a - b) - (a0 - b0));
  const mean = d(r.moonMean, s.moonMean, r0.moonMean, s0.moonMean);
  const anom = d(r.moonAnomaly, s.moonAnomaly, r0.moonAnomaly, s0.moonAnomaly);
  const peri = d(r.moonMean - r.moonAnomaly, s.moonMean - s.moonAnomaly, r0.moonMean - r0.moonAnomaly, s0.moonMean - s0.moonAnomaly);
  near(mean, 5.67, 0.02); near(anom, 22.16, 0.02); near(peri, -16.48, 0.02);
  near(mean, rows.moon.perCentury, 0.6, 'Moon');
  near(anom, rows.anomaly.perCentury, 0.6, 'anomaly');
  near(peri, rows.apsides.perCentury, 0.6, 'apsides');
});

test('README states the key numbers the model computes', () => {
  for (const s of ['254/19', '477/4237', '940/4237', '235/12711', '56165/4237', '6.58°', '0.1146', '8.88', '8.85', '5.6° per century', '219 years',
    'loses 16.1° per century', 'up to about 3.5°', 'about 125° off on average', 'max 2.7°', 'max 3.5°', 'max 6.6°', 'max 10.8°',
    'against the period relation it encodes']) {
    assert.ok(README.includes(s), `README should mention ${s}`);
  }
  // figures the independent review found wrong must not come back
  for (const s of ['14.7° per century', 'up to about 3°)', 'about 124° off', 'against the sky it copies']) {
    assert.ok(!README.includes(s), `README should no longer say ${s}`);
  }
});
