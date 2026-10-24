// The mathematics: Kepler's equation, the pitch curves, the older elliptical answer, the dials,
// the teeth, and the gears' law against DE441. Node built-ins only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const K = require('./kepler.js');
const SKY = require('./sky.js');
const { TAU, DEG } = K;
const ES = [0, 0.01671123, 0.0933941, 0.20563593, 0.24896, 0.3];

test('the model\'s own sin, cos and atan2 (the same in every engine) agree with Math\'s', () => {
  const { sin, cos, atan2, asin } = K.trig;
  let worst = 0;
  for (let i = -20000; i <= 20000; i++) {
    const x = i * 0.0031415;
    worst = Math.max(worst, Math.abs(sin(x) - Math.sin(x)), Math.abs(cos(x) - Math.cos(x)));
    const y = Math.sin(i * 0.37) * (1 + (i % 7));
    const z = Math.cos(i * 0.23) * (1 + (i % 5));
    worst = Math.max(worst, Math.abs(atan2(y, z) - Math.atan2(y, z)));
    if (Math.abs(i) <= 10000) worst = Math.max(worst, Math.abs(asin(i / 10000) - Math.asin(i / 10000)));
  }
  assert.ok(worst < 1e-14, `largest difference ${worst}`);
  assert.equal(atan2(0, -1), Math.PI);
  assert.equal(atan2(0, 0), 0);
});

test('Kepler solver: M = E - e sin E, and the two routes to the true anomaly agree', () => {
  for (const e of ES)
    for (let i = -400; i <= 400; i++) {
      const M = (i / 100) * Math.PI;
      const E = K.eccentricAnomaly(M, e);
      assert.ok(Math.abs(E - e * Math.sin(E) - M) < 1e-12, `residual at e=${e} M=${M}`);
      const th = K.trueFromMean(M, e);
      // textbook form, tan(theta/2) = sqrt((1+e)/(1-e)) tan(E/2)
      const book = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
      assert.ok(Math.abs(K.wrapPi(th - book)) < 1e-12);
      assert.ok(Math.abs(K.meanFromTrue(th, e) - M) < 1e-10, 'meanFromTrue inverts trueFromMean');
    }
});

test('rate() is the derivative of the true anomaly with respect to time', () => {
  for (const e of ES)
    for (let i = 0; i < 200; i++) {
      const M = (TAU * i) / 200;
      const h = 1e-5;
      const num = (K.trueFromMean(M + h, e) - K.trueFromMean(M - h, e)) / (2 * h);
      assert.ok(Math.abs(num / K.rate(K.trueFromMean(M, e), e) - 1) < 1e-8);
    }
  // the numbers the README quotes for Mercury: 1.55x at perihelion, 0.67x at aphelion
  assert.equal(K.rate(0, K.BODIES.mercury.e).toFixed(2), '1.55');
  assert.equal(K.rate(Math.PI, K.BODIES.mercury.e).toFixed(2), '0.67');
});

test('the two pitch curves roll on each other: same arc length, touching and tangent on the line of centres', () => {
  for (const key of K.OPTIONS.bodies) {
    const { e } = K.BODIES[key];
    const C = 70;
    const n = 4096;
    const pc = K.pitchCurves(e, C, n);
    assert.ok(Math.abs(pc.K.L / pc.T.L - 1) < 2e-6, `${key}: perimeters ${pc.K.L} ${pc.T.L}`);
    // both outlines are convex: every corner turns the same way
    for (const tab of [pc.K, pc.T]) {
      const P = tab.P;
      const turns = P.map((b, i) => {
        const a = P[(i - 1 + n) % n];
        const c = P[(i + 1) % n];
        return Math.sign((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]));
      });
      assert.ok(turns.every((t) => t === turns[0]), `${key}: outline not convex`);
    }
    for (let i = 0; i < n; i += 16) {
      const th = (TAU * i) / n;
      const M = K.meanFromTrue(th, e);
      // arc lengths from perihelion agree (rolling without slipping)
      assert.ok(Math.abs(pc.K.s[i] - pc.T.s[i]) < 2e-3, `${key} arc at ${th}`);
      // both contact points land on the same point of the line of centres
      const k = pc.K.P[i];
      const kw = [Math.cos(th) * k[0] - Math.sin(th) * k[1], Math.sin(th) * k[0] + Math.cos(th) * k[1]];
      const t = pc.T.P[i];
      const tw = [-C + Math.cos(-M) * t[0] - Math.sin(-M) * t[1], Math.sin(-M) * t[0] + Math.cos(-M) * t[1]];
      assert.ok(Math.hypot(kw[0] - tw[0], kw[1] - tw[1]) < 1e-9 && Math.abs(kw[1]) < 1e-9);
      // and the curves are tangent there: world-frame directions of motion along each curve, from
      // the exact radius functions (not the polylines)
      const h = 1e-6;
      const kp = (t) => {
        const r = K.keplerPitchR(t, e, C);
        return [r * Math.cos(Math.PI - t + th), r * Math.sin(Math.PI - t + th)];
      };
      const tp = (t) => {
        const r = K.timePitchR(t, e, C);
        const m = K.meanFromTrue(t, e);
        return [-C + r * Math.cos(m - M), r * Math.sin(m - M)];
      };
      const [k0, k1, t0, t1] = [kp(th - h), kp(th + h), tp(th - h), tp(th + h)];
      const dk = Math.atan2(k1[1] - k0[1], k1[0] - k0[0]);
      const dt = Math.atan2(t1[1] - t0[1], t1[0] - t0[0]);
      assert.ok(Math.abs(K.wrapPi(dk - dt)) < 1e-6, `${key}: tangent mismatch at ${th}`);
    }
  }
});

test('turning the time wheel at a steady rate, the rolling curves reproduce Kepler, found by integrating their radii', () => {
  for (const key of K.OPTIONS.bodies) {
    const { e } = K.BODIES[key];
    const C = 64;
    // d(theta)/dM = r1 / r2, using only the two pitch radii; classical RK4
    const f = (th) => K.timePitchR(th, e, C) / K.keplerPitchR(th, e, C);
    let th = 0;
    const steps = 20000;
    const h = TAU / steps;
    let worst = 0;
    for (let i = 0; i < steps; i++) {
      const k1 = f(th);
      const k2 = f(th + (h * k1) / 2);
      const k3 = f(th + (h * k2) / 2);
      const k4 = f(th + h * k3);
      th += (h * (k1 + 2 * k2 + 2 * k3 + k4)) / 6;
      worst = Math.max(worst, Math.abs(K.wrapPi(th - K.trueFromMean((i + 1) * h, e))));
    }
    assert.ok(worst < 1e-9, `${key}: ${worst}`);
  }
});

test('the elliptical answer: two identical ellipses rolling on their foci turn uniformly about the empty focus', () => {
  for (const e of [0.0933941, 0.20563593, 0.24896]) {
    const a = 35;
    const rho = (ang, sign) => (a * (1 - e * e)) / (1 + sign * e * Math.cos(ang));
    // driver turns by M, touching at its far vertex first; driven turns by th; rho1 + rho2 = 2a
    const f = (M) => rho(M, -1) / (2 * a - rho(M, -1));
    let th = 0;
    const steps = 20000;
    const h = TAU / steps;
    for (let i = 0; i < steps; i++) {
      const M = i * h;
      const k1 = f(M);
      const k2 = f(M + h / 2);
      const k4 = f(M + h);
      th += (h * (k1 + 4 * k2 + k4)) / 6; // the rate depends on M only
      const Mn = M + h;
      assert.ok(Math.abs(K.wrapPi(th - K.ellipsePairTrue(Mn, e))) < 1e-9);
      // the driven wheel's radius at the contact is its own ellipse, near vertex first: same shape
      assert.ok(Math.abs(2 * a - rho(Mn, -1) - rho(th, 1)) < 1e-6);
    }
    // and on the orbit: seen from the empty focus, the planet's angle is M
    for (let i = 1; i < 360; i++) {
      const M = (TAU * i) / 360;
      const t = K.ellipsePairTrue(M, e);
      const r = K.radius(t, e, 1);
      const x = r * Math.cos(t) + 2 * e;
      const y = r * Math.sin(t);
      assert.ok(Math.abs(K.wrapPi(Math.atan2(y, x) - M)) < 1e-12);
    }
  }
});

test('how far the circle and the ellipses are from Kepler (figures quoted in the README and on the page)', () => {
  const quoted = {
    mercury: ['23.68', '0.68'],
    mars: ['10.71', '0.13'],
    earth: ['1.92', '0.00'],
    pluto: ['28.74', '1.02'],
  };
  for (const key of K.OPTIONS.bodies) {
    const { e } = K.BODIES[key];
    let circle = 0;
    let ell = 0;
    for (let i = 0; i < 36000; i++) {
      const M = (TAU * i) / 36000;
      const th = K.trueFromMean(M, e);
      circle = Math.max(circle, Math.abs(K.wrapPi(th - M)));
      ell = Math.max(ell, Math.abs(K.wrapPi(th - K.ellipsePairTrue(M, e))));
    }
    assert.deepEqual([(circle * DEG).toFixed(2), (ell * DEG).toFixed(2)], quoted[key], key);
  }
});

test('the drawn orbit: neighbouring dots and the Sun enclose equal areas (Kepler\'s second law)', () => {
  for (const key of K.OPTIONS.bodies) {
    const d = K.design({ body: key });
    const b = d.aD * Math.sqrt(1 - d.e * d.e);
    const want = (Math.PI * d.aD * b) / d.dots;
    const dots = K.dialDots(d).K.filter((p, i, arr) => arr.findIndex((q) => q.k === p.k) === i);
    for (let k = 0; k < d.dots; k++) {
      const t0 = dots[k].ang - d.F.sigma;
      let t1 = dots[(k + 1) % d.dots].ang - d.F.sigma;
      if (t1 <= t0) t1 += TAU;
      // the sector by midpoint rule in theta, 1/2 r^2 dtheta, with no use of Kepler's equation
      const n = 4000;
      let A = 0;
      for (let i = 0; i < n; i++) {
        const t = t0 + ((i + 0.5) * (t1 - t0)) / n;
        const r = K.radius(t, d.e, d.aD);
        A += 0.5 * r * r * ((t1 - t0) / n);
      }
      assert.ok(Math.abs(A / want - 1) < 1e-6, `${key} sector ${k}: ${A} vs ${want}`);
    }
  }
});

test('the dials: equal steps of time, perihelion up, twins on the zero dots', () => {
  const d = K.design({});
  const { K: kd, T: td } = K.dialDots(d);
  assert.equal(kd.length, d.dots + 1);
  assert.equal(td.length, d.dots + 1);
  assert.ok(Math.abs(kd[0].x) < 1e-9 && kd[0].y > 0, 'perihelion dot straight up from the Sun');
  assert.ok(Math.abs(td[0].x + d.C) < 1e-9 && td[0].y > 0, 'zero time dot straight up from the knob');
  for (let k = 1; k < d.dots; k++) {
    const t = td.find((p) => p.k === k);
    const step = K.wrapPi(Math.atan2(t.y, t.x + d.C) - Math.PI / 2);
    assert.ok(Math.abs(K.wrapPi(step + (TAU * k) / d.dots)) < 1e-12, 'time dots are equal steps, clockwise');
  }
});

// ------------------------------------------------------------------------------------- teeth
test('the meshing check looks far enough round the wheels (window of 0.5 rad finds what the whole wheel finds)', () => {
  for (const key of ['mercury', 'pluto']) {
    const d = K.design({ body: key, bore: 0.7 });
    const o = K.wheelOutlines(d);
    const narrow = K.makeMesher(o.time.top, o.kepler.top, d.C);
    const whole = K.makeMesher(o.time.top, o.kepler.top, d.C, Math.PI);
    for (let i = 0; i < 60; i++) {
      const M = (TAU * i) / 60;
      const th = K.trueFromMean(M, d.e);
      for (const [ax, ay] of [[0, 0], [1.4, 0], [-1.4, 0], [0, 1.4], [1, -1]])
        for (const dpsi of [-0.06, -0.02, 0, 0.02, 0.06]) assert.equal(narrow.overlaps(M, th + dpsi, ax, ay, 1e-3), whole.overlaps(M, th + dpsi, ax, ay, 1e-3));
    }
  }
});

test('at the nominal centres the teeth let the Kepler wheel sit at Kepler\'s angle, within a small backlash', () => {
  const quoted = { mercury: 1.39, mars: 1.19, earth: 1.17, pluto: 1.51 }; // README: 1.38 and 1.50
  for (const key of K.OPTIONS.bodies)
    for (const bore of [0.5, 0.7]) {
      const d = K.design({ body: key, bore });
      const o = K.wheelOutlines(d);
      const ms = K.makeMesher(o.time.top, o.kepler.top, d.C);
      let half = 0;
      for (let i = 0; i < 360; i++) {
        const M = (TAU * i) / 360;
        const r = ms.freeRange(M, K.trueFromMean(M, d.e), 0, 0);
        assert.ok(r && r.lo <= 0 && r.hi >= 0, `${key} ${bore}: Kepler's angle blocked at M=${M}`);
        half = Math.max(half, -r.lo, r.hi);
      }
      if (bore === 0.5) assert.ok(half * DEG < quoted[key], `${key}: backlash ${half * DEG}`);
    }
});

test('the play: a 24-sided bore on a 24-sided peg lets the wheel\'s centre move between bore and d.play', () => {
  // The bore's flats are on boreR (normals between its corners), the peg's corners on pegR. For
  // each turn of the peg in the bore and each direction, how far can the peg's centre move?
  for (const bore of K.OPTIONS.bore.values) {
    const d = K.design({ bore });
    const normals = [];
    for (let i = 0; i < 24; i++) normals.push([Math.cos(((i + 0.5) * TAU) / 24), Math.sin(((i + 0.5) * TAU) / 24)]);
    let most = 0;
    let least = Infinity;
    for (let r = 0; r <= 60; r++) {
      const phi = ((r / 60) * TAU) / 24; // the pattern repeats every 15 degrees
      const peg = [];
      for (let j = 0; j < 24; j++) peg.push([d.F.pegR * Math.cos(phi + (TAU * j) / 24), d.F.pegR * Math.sin(phi + (TAU * j) / 24)]);
      for (let k = 0; k < 720; k++) {
        const u = [Math.cos((TAU * k) / 720), Math.sin((TAU * k) / 720)];
        let t = Infinity;
        for (const n of normals) {
          const nu = n[0] * u[0] + n[1] * u[1];
          if (nu <= 0) continue;
          for (const v of peg) t = Math.min(t, (d.boreR - (n[0] * v[0] + n[1] * v[1])) / nu);
        }
        most = Math.max(most, t);
        least = Math.min(least, t);
      }
    }
    assert.ok(Math.abs(most - d.play) < 1e-4, `bore ${bore}: the centre moves up to ${most}, model says ${d.play}`);
    assert.ok(least >= bore - 1e-9 && least < bore + 0.01, `bore ${bore}: at least ${least}`);
  }
  assert.equal(K.design({}).play.toFixed(3), '0.539');
});

test('the teeth never bind, even with both wheels pushed 2 x play towards, away from or across each other', () => {
  for (const key of K.OPTIONS.bodies)
    for (const bore of [0.5, 0.7]) {
      const d = K.design({ body: key, bore, C: K.BODIES[key].C[0] });
      assert.ok(d.play > bore && d.play < bore + 0.05, `${key} ${bore}: play ${d.play}`);
      const o = K.wheelOutlines(d);
      const ms = K.makeMesher(o.time.top, o.kepler.top, d.C);
      for (let k = 0; k < 8; k++) {
        const ax = 2 * d.play * Math.cos((TAU * k) / 8);
        const ay = 2 * d.play * Math.sin((TAU * k) / 8);
        for (let i = 0; i < 90; i++) {
          const M = (TAU * i) / 90;
          assert.ok(ms.freeRange(M, K.trueFromMean(M, d.e), ax, ay), `${key} ${bore} binds at M=${M}, shift ${ax},${ay}`);
        }
      }
    }
});

test('the backlash figures are the largest found, and more positions find a little more', () => {
  // README: 1.38 deg at 360 positions, 1.43 deg at 3600 (Mercury, 70 mm, 0.5 mm bore)
  const d = K.design({});
  const o = K.wheelOutlines(d);
  const ms = K.makeMesher(o.time.top, o.kepler.top, d.C);
  const largest = (n) => {
    let half = 0;
    for (let i = 0; i < n; i++) {
      const M = (TAU * i) / n;
      const r = ms.freeRange(M, K.trueFromMean(M, d.e), 0, 0);
      half = Math.max(half, -r.lo, r.hi);
    }
    return half * DEG;
  };
  assert.equal(largest(360).toFixed(2), '1.38');
  assert.equal(largest(3600).toFixed(2), '1.43');
});

test('one tooth out, the pair does not run a fixed step out: it jams or jumps a tooth within a turn', () => {
  const d = K.design({});
  const o = K.wheelOutlines(d);
  const ms = K.makeMesher(o.time.top, o.kepler.top, d.C);
  const tooth = d.pitch / d.r1max; // one tooth of the time wheel where it touches at perihelion
  // Kepler wheel's spoke on its doubled dot, time wheel one tooth on or back; turn the time wheel
  // forward and let the teeth push the Kepler wheel to the nearest angle they allow
  // errs: against a pair already a tooth out; reads: what the windows show, the planet window's
  // angle against the true anomaly for the time the time window shows (M + sgn * tooth)
  const run = (sgn) => {
    let psi = 0;
    let errs = [];
    let reads = [];
    let steps = [];
    for (let step = 0; step <= 720; step++) {
      const M = (TAU * step) / 720;
      const r = ms.freeRange(M + sgn * tooth, psi, 0, 0, { maxDev: 0.4 });
      if (!r) return { jam: M * DEG, errs, reads, steps };
      if (r.lo > 0) psi += r.lo;
      else if (r.hi < 0) psi += r.hi;
      errs.push(K.wrapPi(psi - K.trueFromMean(M, d.e)) * DEG);
      reads.push(K.wrapPi(psi - K.trueFromMean(M + sgn * tooth, d.e)) * DEG);
      steps.push({ M, T: M + sgn * tooth, psi });
    }
    return { jam: null, errs, reads, steps };
  };
  const back = run(-1);
  assert.ok(back.jam !== null && back.jam < 45, `one tooth back: jams at ${back.jam}`);
  const on = run(1);
  // one tooth on: the error is not a steady 360/16 degrees; it wanders, then jumps by more than a
  // tooth's worth as the wheel skips
  const jumps = on.errs.slice(1).map((e, i) => Math.abs(e - on.errs[i]));
  assert.ok(on.jam !== null || Math.max(...jumps) > 10, `one tooth on: largest jump ${Math.max(...jumps)}`);
  assert.ok(Math.max(...on.errs.slice(0, 300)) - Math.min(...on.errs.slice(0, 300)) > 5, 'the error wanders by degrees');
  // README: the planet window reads roughly 20-30 deg behind the time window until, at about 211
  // deg, the pair jumps a tooth, after which it reads as a pair seated right does
  assert.equal(on.jam, null);
  const steps = on.reads.slice(1).map((x, i) => Math.abs(x - on.reads[i]));
  const j = steps.indexOf(Math.max(...steps)) + 1; // first position after the jump
  const jumpAt = on.steps[j].M * DEG;
  assert.ok(steps[j - 1] > 10 && jumpAt > 205 && jumpAt < 218, `jumps ${steps[j - 1]} deg at ${jumpAt}`);
  const before = on.reads.slice(0, j);
  assert.ok(Math.min(...before) > -32 && Math.max(...before) < -18, `before the jump: ${Math.min(...before)} to ${Math.max(...before)}`);
  for (const s of on.steps.slice(j)) {
    const nu = K.trueFromMean(s.T, d.e);
    const rc = ms.freeRange(s.T, nu, 0, 0); // a pair seated right, at the same time-wheel angle
    const dev = K.wrapPi(s.psi - nu);
    assert.ok(dev >= rc.lo - 1e-5 && dev <= rc.hi + 1e-5, `after the jump at ${s.M * DEG}: ${dev * DEG} outside ${rc.lo * DEG}..${rc.hi * DEG}`);
  }
});

// --------------------------------------------------------------------------------------- sky
function skyPositions(key) {
  const b = SKY.bodies[key];
  const P = [];
  for (let i = 0; i < b.xyz.length; i += 3) P.push([b.xyz[i] * SKY.unit, b.xyz[i + 1] * SKY.unit, b.xyz[i + 2] * SKY.unit]);
  return P;
}
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a) => a.map((x) => x / Math.hypot(...a));

test('DE441 agrees with the periods the gears are cut for', () => {
  for (const key of ['mercury', 'mars', 'earth']) {
    const pe = SKY.bodies[key].peri;
    const mean = (pe[pe.length - 1] - pe[0]) / (pe.length - 1);
    assert.ok(Math.abs(mean - K.BODIES[key].P) < 0.005, `${key}: DE441 ${mean} vs ${K.BODIES[key].P}`);
  }
  const pl = SKY.bodies.pluto.peri;
  assert.equal(pl.length, 3);
  assert.ok(Math.abs((pl[2] - pl[0]) / 2 - K.BODIES.pluto.P) < 0.1);
});

test('the gears\' law against the sky: at every dot, DE441 puts the planet within a few arcminutes of the gears', () => {
  // largest |gear angle - DE441 angle from the starting perihelion, in the orbit plane|, degrees
  const quoted = { mercury: ['5 orbits from 2026 Feb 19', 0.0056], mars: ['3 orbits from 2026 Mar 26', 0.04], earth: ['3 orbits from 2026 Jan 3', 0.0152], pluto: ['1 orbit from 1989 Sep 5', 0.1626] };
  for (const key of K.OPTIONS.bodies) {
    const B = K.BODIES[key];
    const P = skyPositions(key);
    const u = unit(P[0]);
    const w = cross(unit(cross(P[0], P[1])), u);
    let worst = 0;
    P.forEach((p, i) => {
      const ang = Math.atan2(dot3(p, w), dot3(p, u));
      worst = Math.max(worst, Math.abs(K.wrapPi(K.trueFromMean((TAU * i) / B.dots, B.e) - ang)));
    });
    assert.ok(Math.abs(worst * DEG - quoted[key][1]) < 0.0001, `${key}: ${worst * DEG}`);
    assert.equal(P.length, B.dots * Number(quoted[key][0][0]) + 1);
    // the first sample is a perihelion: nearer the Sun than the dots either side of it
    const r = P.map((p) => Math.hypot(...p));
    assert.ok(r[0] < r[1] && r[0] < r[B.dots - 1]);
  }
});
