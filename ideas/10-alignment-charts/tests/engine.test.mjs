// Run from the repo root: node --test ideas/10-alignment-charts/tests/engine.test.mjs
// Verifies that every chart actually computes its formula by pure geometry
// (straightedge through two pinned values, crossing read off the third scale),
// flat and under random projective warps, plus ticks, labels and parsers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Engine from '../js/engine.js';
import Charts from '../js/charts.js';
const { homography, applyH, matMul, isConvexQuad, fitTransform, chartBBox, sRange, screenAtV, lineCrossings, projectToScale, sampleScale, genTicks, decimalLadder, timeLadder, layoutChart } = Engine;
const { buildCatalog, powerChart, POWER_PRESETS, validatePower, parseClock, parseNum, hms, clockTick, pct, fmtNum } = Charts;

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

const RECT = { x: 60, y: 50, w: 480, h: 700 };
const rectCorners = (r) => [
  [r.x, r.y],
  [r.x + r.w, r.y],
  [r.x + r.w, r.y + r.h],
  [r.x, r.y + r.h],
];

function transformFor(chart, rand, warp) {
  const fit = fitTransform(chartBBox(chart), RECT, chart.maxDistort ?? Infinity);
  if (!warp) return fit;
  for (;;) {
    const base = rectCorners(RECT);
    const dst = base.map(([x, y]) => [x + (rand() - 0.5) * 0.5 * RECT.w, y + (rand() - 0.5) * 0.5 * RECT.h]);
    if (!isConvexQuad(dst)) continue;
    return matMul(homography(base, dst), fit);
  }
}

/** Random value on a scale, uniform in its natural coordinate, away from the ends. */
function randomValue(sc, rand) {
  const [s0, s1] = sRange(sc);
  const s = s0 + (s1 - s0) * (0.03 + 0.94 * rand());
  return sc.inv(s);
}

function inRange(sc, v, margin = 0.01) {
  const [s0, s1] = sRange(sc);
  const s = sc.fwd(v);
  return Number.isFinite(s) && s > s0 + (s1 - s0) * margin && s < s1 - (s1 - s0) * margin;
}

function relClose(a, b, tol = 1e-6) {
  return Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
}

function checkChart(chart, seed, trials = 300) {
  const rand = rng(seed);
  let checked = 0;
  let offScale = 0;
  for (let t = 0; t < trials; t++) {
    const H = transformFor(chart, rand, t % 2 === 1);
    const readIdx = t % 3;
    const pinIdx = [0, 1, 2].filter((i) => i !== readIdx);
    const pins = pinIdx.map((i) => chart.scales[i]);
    const vals = pins.map((sc) => randomValue(sc, rand));
    const A = screenAtV(pins[0], H, vals[0]);
    const B = screenAtV(pins[1], H, vals[1]);
    if (Math.hypot(A[0] - B[0], A[1] - B[1]) < 1) continue; // pins on the same spot: no line
    const read = chart.scales[readIdx];
    const got = lineCrossings(read, H, A, B);
    const known = { [pins[0].key]: vals[0], [pins[1].key]: vals[1] };
    let want = chart.solve[read.key](known);
    want = (Array.isArray(want) ? want : [want]).filter((w) => Number.isFinite(w));
    const wantIn = want.filter((w) => inRange(read, w));
    const wantNearEdge = want.filter((w) => !inRange(read, w) && inRange(read, w, -0.01));
    if (wantNearEdge.length) continue; // too close to a scale end to judge either way
    if (!wantIn.length) {
      assert.equal(got.length, 0, `${chart.id}: expected no crossing on ${read.key} for ${JSON.stringify(known)}, got ${got}`);
      offScale++;
      continue;
    }
    assert.equal(got.length, wantIn.length, `${chart.id}: crossing count on ${read.key} for ${JSON.stringify(known)}: got ${got}, want ${wantIn}`);
    wantIn.forEach((w, i) => {
      assert.ok(relClose(got[i], w), `${chart.id}: ${read.key} read ${got[i]} but formula says ${w} (pins ${JSON.stringify(known)})`);
    });
    checked++;
  }
  return { checked, offScale };
}

test('homography maps four points exactly and composes with fits', () => {
  const src = rectCorners(RECT);
  const dst = [
    [10, 20],
    [600, 70],
    [520, 760],
    [40, 690],
  ];
  const H = homography(src, dst);
  src.forEach((p, i) => {
    const q = applyH(H, p);
    assert.ok(Math.hypot(q[0] - dst[i][0], q[1] - dst[i][1]) < 1e-6);
  });
  assert.ok(isConvexQuad(dst));
  assert.ok(!isConvexQuad([dst[0], dst[2], dst[1], dst[3]]));
});

for (const [i, chart] of buildCatalog().entries()) {
  test(`chart "${chart.id}" computes its formula by straightedge, flat and warped`, () => {
    const { checked, offScale } = checkChart(chart, 1000 + i);
    assert.ok(checked > 150, `only ${checked} in-range checks for ${chart.id}`);
    assert.ok(checked + offScale > 200);
  });

  test(`chart "${chart.id}" default pins give a reading that matches the formula`, () => {
    const H = transformFor(chart, rng(7), false);
    const pins = chart.pins.map(([k, v]) => [chart.scales.find((s) => s.key === k), v]);
    const read = chart.scales.find((s) => !chart.pins.some(([k]) => k === s.key));
    const got = lineCrossings(read, H, screenAtV(pins[0][0], H, pins[0][1]), screenAtV(pins[1][0], H, pins[1][1]));
    let want = chart.solve[read.key](Object.fromEntries(chart.pins));
    want = Array.isArray(want) ? want : [want];
    assert.equal(got.length, want.length);
    got.forEach((g, k) => assert.ok(relClose(g, want[k]), `${g} vs ${want[k]}`));
  });

  test(`chart "${chart.id}" examples are all readable`, () => {
    const H = transformFor(chart, rng(9), false);
    for (const ex of chart.examples) {
      const keys = ex.pins.map(([k]) => k);
      const read = chart.scales.find((s) => !keys.includes(s.key));
      const [p0, p1] = ex.pins.map(([k, v]) => screenAtV(chart.scales.find((s) => s.key === k), H, v));
      const got = lineCrossings(read, H, p0, p1);
      let want = chart.solve[read.key](Object.fromEntries(ex.pins));
      want = (Array.isArray(want) ? want : [want]).filter((w) => w >= read.min && w <= read.max);
      assert.equal(got.length, want.length, `${ex.label}: got ${got} want ${want}`);
      got.forEach((g, k) => assert.ok(relClose(g, want[k], 1e-5), `${ex.label}: ${g} vs ${want[k]}`));
    }
  });

  test(`chart "${chart.id}" lays out with no overlapping labels`, () => {
    for (const [w, h] of [
      [390, 600],
      [900, 760],
    ]) {
      const rect = { x: 50, y: 48, w: w - 100, h: h - 72 };
      const H = fitTransform(chartBBox(chart), rect, chart.maxDistort ?? Infinity);
      const L = layoutChart(chart, H, { width: w, height: h, font: 11 });
      assert.ok(L.labels.length >= 12, `${chart.id} at ${w}px: only ${L.labels.length} labels`);
      const boxes = L.labels.map((l) => [l.x - l.w / 2, l.y - l.h / 2, l.w, l.h]);
      for (let a = 0; a < boxes.length; a++) {
        const r = boxes[a];
        assert.ok(r[0] >= 0 && r[1] >= 0 && r[0] + r[2] <= w && r[1] + r[3] <= h, `label "${L.labels[a].text}" off canvas`);
        for (let b = a + 1; b < boxes.length; b++) {
          const o = boxes[b];
          const overlap = r[0] < o[0] + o[2] && o[0] < r[0] + r[2] && r[1] < o[1] + o[3] && o[1] < r[1] + r[3];
          assert.ok(!overlap, `labels "${L.labels[a].text}" and "${L.labels[b].text}" overlap`);
        }
      }
      for (const s of L.scales) assert.ok(s.ticks.length >= 8, `${chart.id}/${s.key}: ${s.ticks.length} ticks`);
    }
  });
}

test('every power-law preset computes correctly', () => {
  POWER_PRESETS.forEach((p, i) => {
    const { checked } = checkChart(powerChart(p), 50 + i, 150);
    assert.ok(checked > 60, `${p.id}: ${checked}`);
  });
});

test('power-law builder rejects charts it cannot draw', () => {
  const base = structuredClone(POWER_PRESETS[0]);
  assert.doesNotThrow(() => validatePower(base));
  const bad = (mut) => {
    const p = structuredClone(base);
    mut(p);
    assert.throws(() => powerChart(p));
  };
  bad((p) => (p.k = 0));
  bad((p) => (p.u.min = 0));
  bad((p) => (p.u.max = p.u.min));
  bad((p) => (p.v.exp = 0));
  bad((p) => (p.v.min = -1));
  bad((p) => (p.u.max = 1e20));
});

test('projecting a point onto a scale recovers the value under it', () => {
  const rand = rng(3);
  for (const chart of buildCatalog()) {
    const H = transformFor(chart, rand, true);
    for (const sc of chart.scales) {
      const samples = sampleScale(sc, H);
      for (let k = 0; k < 20; k++) {
        const v = randomValue(sc, rand);
        const P = screenAtV(sc, H, v);
        const r = projectToScale(sc, H, samples, [P[0] + 0.0, P[1] + 0.0]);
        assert.ok(r.dist < 1e-3, `${chart.id}/${sc.key}: dist ${r.dist}`);
        assert.ok(relClose(r.v, v, 1e-5), `${chart.id}/${sc.key}: ${r.v} vs ${v}`);
      }
    }
  }
});

test('ticks are sorted, unique, inside the range, and include the anchors', () => {
  for (const chart of buildCatalog()) {
    const H = fitTransform(chartBBox(chart), RECT, chart.maxDistort ?? Infinity);
    for (const sc of chart.scales) {
      const set = { min: sc.min, max: sc.max, anchors: sc.ticks.anchors, ladder: sc.ticks.ladder };
      const ts = genTicks(set, (v) => screenAtV(sc, H, v), { minGap: 5 });
      for (let i = 1; i < ts.length; i++) assert.ok(ts[i].v > ts[i - 1].v, `${chart.id}/${sc.key} not strictly sorted`);
      for (const t of ts) assert.ok(t.v >= sc.min - 1e-9 && t.v <= sc.max + 1e-9);
      for (const a of sc.ticks.anchors) {
        if (a >= sc.min && a <= sc.max) assert.ok(ts.some((t) => t.v === a && t.level === 0), `${chart.id}/${sc.key} lost anchor ${a}`);
      }
    }
  }
});

test('ladders nest: every step divides the one before it', () => {
  for (const L of [decimalLadder(9), decimalLadder(0.4), decimalLadder(1000), timeLadder(20000)]) {
    for (let i = 1; i < L.length; i++) {
      const r = L[i - 1] / L[i];
      assert.ok(Math.abs(r - Math.round(r)) < 1e-9, `${L[i - 1]} / ${L[i]}`);
    }
  }
  assert.deepEqual(decimalLadder(9).slice(0, 3), [5, 1, 0.5]);
  assert.deepEqual(decimalLadder(0.4).slice(0, 2), [0.1, 0.05]);
});

test('parsers and formatters', () => {
  assert.equal(parseClock('3:59:48'), 3 * 3600 + 59 * 60 + 48);
  assert.equal(parseClock('25:00'), 1500);
  assert.equal(parseClock('3h30'), 12600);
  assert.equal(parseClock('3h30m15s'), 12615);
  assert.equal(parseClock('5.5'), 330);
  assert.equal(parseClock('4m'), 240);
  assert.equal(parseClock('nonsense'), null);
  assert.equal(parseClock(''), null);
  assert.equal(parseNum('−12,5'), -12.5);
  assert.equal(parseNum('30%'), 30);
  assert.equal(parseNum('1e3'), 1000);
  assert.equal(parseNum('abc'), null);
  assert.equal(hms(14388), '3:59:48');
  assert.equal(hms(1200), '20:00');
  assert.equal(clockTick(9000), '2h30');
  assert.equal(clockTick(7200), '2h');
  assert.equal(pct(63.157), '63.2');
  assert.equal(pct(99.874), '99.87');
  assert.equal(pct(0.1523), '0.15');
  assert.equal(fmtNum(-5), '−5');
  assert.equal(fmtNum(100000), '10⁵');
  assert.equal(fmtNum(0.0002), '2×10⁻⁴');
});
