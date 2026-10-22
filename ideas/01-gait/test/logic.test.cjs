// Headless rule checks for Gait. Run: node ideas/01-gait/test/logic.test.cjs
// Node built-ins only. Exits non-zero on the first failed assertion.
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const G = require(path.join(__dirname, '..', 'logic.js'));
const { Course, Runner, SHAPES, STRIDES, stride, planGear, TRAP_DEPTH } = G;

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('ok   ' + name);
  } catch (e) {
    console.log('FAIL ' + name);
    console.log(e && e.stack ? e.stack : e);
    process.exit(1);
  }
}

const SEEDS = [1, 2, 3, 42, 1234, 99991, 31337, 2026];
const DT = 1 / 60;

/** Independent re-derivation of the fairness property over the whole course. */
function independentAudit(course) {
  const end = course.end;
  const pit = (x) => x > 0 && course.pits.some((p) => p.a < x && x < p.b);
  // Build a pit mask straight from the pit list, not from the course's own cell array.
  const mask = new Uint8Array(end + 64);
  for (const p of course.pits) for (let x = p.a + 1; x < p.b; x++) mask[x] = 1;
  const viable = new Uint8Array(end + 64);
  const surv = new Int32Array(end + 64);
  let doomed = 0;
  let unfair = 0;
  for (let x = end; x >= 0; x--) {
    if (mask[x]) continue;
    let ok = false;
    let depth = 0;
    for (const s of STRIDES) {
      const y = x + s;
      if (y > end || viable[y]) ok = true;
      else if (!mask[y]) depth = Math.max(depth, surv[y] + 1);
    }
    viable[x] = ok ? 1 : 0;
    surv[x] = ok ? 1e9 : depth;
    if (!ok) {
      doomed++;
      if (depth > TRAP_DEPTH) unfair++;
    }
  }
  return { mask, viable, doomed, unfair, pit };
}

function simulate(seed, untilDist, choose) {
  const course = new Course(seed);
  const r = new Runner(course, 4);
  r.start();
  let decidedFor = -1;
  let t = 0;
  const lands = [];
  while (r.state === 'rolling' && r.dist < untilDist && t < 3600) {
    // Decide the next step once per step, after the late-shift grace window has passed,
    // which is how a human who plans ahead would play.
    if (choose && decidedFor !== r.stepId && r.stepAge > r.grace()) {
      decidedFor = r.stepId;
      const g = choose(course, r);
      if (g) r.setGear(g);
    }
    for (const ev of r.update(DT)) if (ev.type === 'land') lands.push(ev);
    t += DT;
  }
  return { course, r, lands, t };
}

test('strides are whole units and share no common factor', () => {
  assert.deepEqual(STRIDES, [20, 15, 12, 10]);
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  assert.equal(STRIDES.reduce(gcd), 1);
});

test('a fixed-perimeter loop covers the same ground per turn whatever its shape', () => {
  const r = new Runner(new Course(7), 3);
  const turn = SHAPES.map((n) => r.stepDuration(n) * n);
  for (const t of turn) assert.ok(Math.abs(t - turn[0]) < 1e-9);
});

for (const seed of SEEDS) {
  test(`course ${seed}: holes are well formed, start is clear, chimes sit on survivable ground`, () => {
    const c = new Course(seed);
    c.ensure(30000);
    let prevB = -1;
    for (const p of c.pits) {
      assert.ok(p.b - p.a >= 2, 'hole too narrow to matter');
      assert.ok(p.b - p.a < 20, 'hole wider than the longest stride');
      assert.ok(p.a >= prevB, 'holes overlap');
      assert.ok(p.a >= 60, 'hole too close to the start');
      prevB = p.b;
      assert.ok(c.isEdge(p.a) && c.isEdge(p.b), 'hole lips should count as edges');
      assert.ok(c.isPit(p.a + 1) && c.isPit(p.b - 1));
    }
    const audit = independentAudit(c);
    let prev = -1e9;
    for (const x of c.chimes) {
      assert.ok(x - prev >= 24, 'chimes too close together');
      assert.ok(!audit.mask[x], 'chime in a hole');
      assert.ok(audit.viable[x], 'chime on a doomed spot');
      prev = x;
    }
  });

  test(`course ${seed}: every trap is shallow enough to see coming (independent audit)`, () => {
    const c = new Course(seed);
    c.ensure(30000);
    const a = independentAudit(c);
    assert.equal(a.unfair, 0, `${a.unfair} unfair traps`);
    assert.ok(a.viable[0], 'start must be survivable');
    // Course's own cached verdicts agree with the audit everywhere well behind the frontier.
    for (let x = 0; x < c.end - 100; x++) {
      if (a.mask[x]) continue;
      assert.equal(c.viable(x), !!a.viable[x], `viability mismatch at ${x}`);
    }
  });

  test(`seed ${seed}: a planning player survives 3 km and every landing obeys the rules`, () => {
    const { r, lands } = simulate(seed, 30000, (course, run) => planGear(course, run.target, run.gear));
    assert.equal(r.state, 'rolling', `planner fell at ${r.dist}`);
    let x = 0;
    let bonus = 0;
    for (const ev of lands) {
      assert.ok(STRIDES.includes(ev.x - x), `bad stride ${ev.x - x}`);
      assert.ok(!r.course.isPit(ev.x));
      bonus += ev.points;
      x = ev.x;
    }
    assert.equal(r.score, Math.floor(r.dist / 10) + bonus);
    assert.ok(r.chimeCount > 0, 'planner should collect some chimes');
  });

  test(`seed ${seed}: never changing shape falls in a hole quickly`, () => {
    const { r } = simulate(seed, 30000, null);
    assert.equal(r.state, 'fallen');
    assert.ok(r.dist < 3000, `lazy runner got to ${r.dist}`);
    assert.ok(r.course.isPit(r.fall.x));
    assert.ok(r.fall.pit && r.fall.pit.a < r.fall.x && r.fall.x < r.fall.pit.b);
  });
}

test('traps exist: looking only one step ahead is not enough', () => {
  let doomedSpots = 0;
  let shortSightedFalls = 0;
  for (const seed of SEEDS) {
    const c = new Course(seed);
    c.ensure(30000);
    doomedSpots += independentAudit(c).doomed;
    // A player who only checks that the next corner lands on ground (not whether that spot
    // has a future) should sometimes get trapped.
    const { r } = simulate(seed, 30000, (course, run) => {
      const order = [run.gear, ...SHAPES.filter((n) => n !== run.gear)];
      return order.find((n) => !course.isPit(run.target + stride(n))) || run.gear;
    });
    if (r.state === 'fallen') shortSightedFalls++;
  }
  console.log(`     doomed spots across ${SEEDS.length} courses: ${doomedSpots}; one-step players trapped: ${shortSightedFalls}/${SEEDS.length}`);
  assert.ok(doomedSpots > 0);
  assert.ok(shortSightedFalls > 0);
});

test('a shift right after touchdown re-commits the step just begun; later it waits', () => {
  const r = new Runner(new Course(5), 4);
  r.start();
  // Roll to the first touchdown.
  let ev = [];
  while (!ev.length) ev = r.update(DT / 4);
  assert.equal(ev[0].type, 'land');
  assert.equal(r.x, 15);
  assert.equal(r.target, 30);
  r.update(0.02); // still inside grace
  r.setGear(3);
  assert.equal(r.n, 3);
  assert.equal(r.target, 35, 'late shift should retarget the current step');
  r.update(0.1); // well past grace
  r.setGear(6);
  assert.equal(r.n, 3, 'current step is committed');
  assert.equal(r.target, 35);
  assert.equal(r.gear, 6);
  ev = [];
  while (!ev.length) ev = r.update(DT / 4);
  assert.equal(ev[0].x, 35);
  assert.equal(r.n, 6);
  assert.equal(r.target, 45, 'next step uses the newly selected shape');
});

test('stepping over a chime breaks the chain; landing on one extends it', () => {
  // A flat fake course with chimes at 30 and 60 and 90.
  const flat = {
    chimes: [30, 60, 90],
    isPit: () => false,
    isEdge: () => false,
    isPin: () => false,
    pitAt: () => null,
    ensure() {},
    viable: () => true,
    isChime(x) {
      return this.chimes.includes(x);
    },
  };
  const r = new Runner(flat, 3); // 20-unit strides: 20, 40 (skips 30), 60, 80, 100 (skips 90)
  r.start();
  const evs = [];
  while (r.x < 100) evs.push(...r.update(DT));
  const at = (x) => evs.find((e) => e.x === x);
  assert.equal(at(40).missed, 1);
  assert.equal(at(60).chime, true);
  assert.equal(at(60).streak, 1);
  assert.equal(at(100).missed, 1);
  assert.equal(r.streak, 0);
  assert.equal(r.chimeCount, 1);
  assert.equal(r.score, 10 + 10);
});

test('difficulty and speed rise monotonically and stay bounded', () => {
  let pv = 0;
  let pd = -1;
  for (let x = 0; x < 100000; x += 500) {
    const v = G.speedAt(x);
    const d = G.difficulty(x);
    assert.ok(v >= pv && v < 68.001);
    assert.ok(d >= pd && d < 1);
    pv = v;
    pd = d;
  }
});

console.log(`\n${passed} checks passed`);
