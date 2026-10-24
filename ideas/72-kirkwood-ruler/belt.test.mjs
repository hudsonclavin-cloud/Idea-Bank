// Tests for Kirkwood's Ruler. Node built-ins only:  node --test ideas/72-kirkwood-ruler/belt.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { reduceRows, fineBin, timeWithin, addOrbit, POPULATIONS, NFINE } from './reduce.mjs';
import { defaultStl } from './build.mjs';
import { EXTREMES } from './sweep.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const Belt = require('./belt.js');
const D = Belt.DATA;
const readme = fs.readFileSync(path.join(here, 'README.md'), 'utf8');
const html = fs.readFileSync(path.join(here, 'index.html'), 'utf8');

// A small deterministic generator for sampling the parameter space.
function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

// ------------------------------------------------------------------ the data
test('bundled data: every population adds up and nests inside the full catalogue', () => {
  assert.equal(D.asteroids, 1576490);
  const P = D.populations;
  for (const [id, p] of Object.entries(P)) {
    assert.equal(p.counts.length, NFINE, id);
    const inRange = p.counts.reduce((s, c) => s + c, 0);
    assert.equal(inRange + p.below + p.above, p.total, `${id} adds up`);
    assert.ok(p.counts.every((c) => Number.isInteger(c) && c >= 0), `${id} counts are whole numbers`);
  }
  assert.equal(P.all.total, D.asteroids);
  assert.equal(P.good.total, 1141495);
  assert.equal(P.big.total, 84216);
  assert.equal(P.first1000.total, 1000);
  assert.equal(P.by1866.total, 91);
  for (let k = 0; k < NFINE; k++) {
    for (const sub of ['good', 'big', 'first1000']) assert.ok(P[sub].counts[k] <= P.all.counts[k], `${sub} within all at bin ${k}`);
    assert.ok(P.by1866.counts[k] <= P.first1000.counts[k], `by1866 within first1000 at bin ${k}`);
  }
  // 98.4% of the catalogue lies between 1.5 and 5.5 au.
  assert.equal(P.all.below, 17012);
  assert.equal(P.all.above, 8760);
});

test('reduction: bin edges and population membership on hand-made rows', () => {
  const rows = [
    ['1', '1.5', '0.1', '1', '3.3', '0', 'x'],          // a exactly at the bottom edge: fine bin 0
    ['91', '2.5', '0.1', '1', '14.99', '0', 'x'],        // in by1866, big, good
    ['92', '2.5025', '0.1', '1', '15', '1', 'x'],        // first1000 but not by1866; H = 15 is not big
    ['1001', '5.4999', '0.1', '1', null, '9', 'x'],      // numbered beyond 1000; no H: not big
    ['2020 AB1', '5.5', '0.1', '1', '18', null, 'x'],   // a at the top edge: above the range
    ['2020 AB2', '1.4999', '0.1', '1', '18', '2', 'x'],  // below the range
  ];
  const r = reduceRows(rows);
  assert.equal(fineBin(1.5), 0);
  assert.equal(fineBin(2.5), 400);
  assert.equal(fineBin(2.5025), 401);
  assert.equal(fineBin(5.4999), 1599);
  assert.equal(fineBin(5.5), -1);
  assert.equal(r.all.total, 6);
  assert.equal(r.all.below, 1);
  assert.equal(r.all.above, 1);
  assert.equal(r.all.counts[0], 1);
  assert.equal(r.all.counts[400], 1);
  assert.equal(r.by1866.total, 2);
  assert.equal(r.first1000.total, 3);
  assert.equal(r.big.total, 2);
  assert.equal(r.good.total, 2);
  assert.deepEqual(POPULATIONS.map((p) => p.id), Belt.POP_IDS);
  assert.throws(() => reduceRows([['x', null, null, null, null, null, null]]));
});

test('the count by distance: time spent at each distance, against brute-force Kepler\'s equation', () => {
  // Sample each orbit at equal steps of mean anomaly (equal steps of time), solve Kepler's equation
  // by Newton's method, and histogram r = a(1 - e cos E). Compare with the exact spread.
  for (const [a, e] of [[2.7, 0.15], [2.5, 0.02], [3.97, 0.2], [1.9, 0.45], [5.2, 0.08], [2.0, 0.6]]) {
    const exact = new Array(NFINE).fill(0);
    const [below, above] = addOrbit(exact, a, e);
    const K = 200000, brute = new Array(NFINE).fill(0);
    let bBelow = 0, bAbove = 0;
    for (let k = 0; k < K; k++) {
      const M = (k + 0.5) * 2 * Math.PI / K;
      let E = M;
      for (let it = 0; it < 30; it++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
      const r = a * (1 - e * Math.cos(E));
      const i = fineBin(r);
      if (i >= 0) brute[i] += 1 / K; else if (r < 1.5) bBelow += 1 / K; else bAbove += 1 / K;
    }
    let worst = Math.abs(below - bBelow) + Math.abs(above - bAbove);
    for (let i = 0; i < NFINE; i++) worst = Math.max(worst, Math.abs(exact[i] - brute[i]));
    assert.ok(worst < 2e-4, `a=${a} e=${e}: worst difference ${worst}`);
    const sum = exact.reduce((s, x) => s + x, 0) + below + above;
    assert.ok(Math.abs(sum - 1) < 1e-12, 'each orbit counts once');
  }
  assert.equal(timeWithin(2.7, 2.7, 0), 1);
  assert.equal(timeWithin(2.69, 2.7, 0), 0);
  // The bundled spreads add up to the catalogue: every bound orbit is counted once.
  for (const [id, p] of Object.entries(D.populations)) {
    const sum = p.rTenths.reduce((s, t) => s + t, 0) / 10 + p.rBelow + p.rAbove + p.unbound;
    assert.ok(Math.abs(sum - p.total) < 0.06 * NFINE / 10 + 1, `${id}: ${sum} vs ${p.total}`);
  }
  assert.equal(D.populations.all.unbound, 5);
  assert.deepEqual(D.mainBelt, { asteroids: 1462466, medianSwing: 0.392 });
});

// ------------------------------------------------------------------ Kepler
test('resonance positions: p laps of the Sun for every q of Jupiter\'s', () => {
  for (const r of Belt.RESONANCES) {
    const laps = Belt.JUPITER_YEARS / Belt.periodYears(r.a);
    assert.ok(Math.abs(laps - r.p / r.q) < 1e-9, r.label);
  }
  assert.ok(Math.abs(Belt.JUPITER_YEARS - 11.8626) < 1e-4);
  // Independent route: Jupiter's mean semi-major axis and the Sun/Jupiter mass ratio (1047.3486).
  const viaA = (p, q) => Belt.JUPITER_A * Math.pow(q / p, 2 / 3) * Math.pow(1 + 1 / 1047.3486, -1 / 3);
  for (const r of Belt.RESONANCES) assert.ok(Math.abs(viaA(r.p, r.q) - r.a) < 0.0005, `${r.label} agrees within 0.0005 au`);
  const get = (l) => Belt.MARKS.find((m) => m.label === l).a;
  assert.equal(get('3:1').toFixed(3), '2.501');
  assert.equal(get('5:2').toFixed(3), '2.824');
  assert.equal(get('7:3').toFixed(3), '2.957');
  assert.equal(get('2:1').toFixed(3), '3.277');
  assert.equal(get('3:2').toFixed(3), '3.969');
  assert.equal(get('1:1').toFixed(3), '5.201');
});

// ------------------------------------------------------------------ what the data says at the marks
test('the notch finder, told nothing about Jupiter, finds the four gaps on the default ruler', () => {
  const all = Belt.population('all').counts;
  const found = Belt.findNotches(all, 1.8, 3.4, 4);
  assert.deepEqual(found.map((f) => f.nearest.label), ['5:2', '3:1', '7:3', '2:1']);
  assert.deepEqual(found.map((f) => f.a.toFixed(4)), ['2.8225', '2.5025', '2.9575', '3.2825']);
  assert.deepEqual(found.map((f) => Math.round(f.sigma)), [67, 66, 44, 21]);
  assert.deepEqual(found.map((f) => Math.round(100 * f.depth)), [93, 95, 68, 83]);
  const worst = Math.max(...found.map((f) => Math.abs(f.offset)));
  assert.ok(worst < 0.006 && worst > 0.0058, `largest offset ${worst}`);
  // The same four from any stretch that holds them, and at twice the resolution.
  for (const [a0, a1] of [[1.5, 5.5], [2.0, 3.5], [2.1, 3.3]]) {
    assert.deepEqual(Belt.findNotches(all, a0, a1, 4).map((f) => f.nearest.label), ['5:2', '3:1', '7:3', '2:1'], `${a0}-${a1}`);
  }
  const fine = Belt.findNotches(all, 1.8, 3.4, 4, 1);
  assert.deepEqual(fine.map((f) => f.nearest.label), ['5:2', '3:1', '7:3', '2:1']);
  assert.ok(Math.max(...fine.map((f) => Math.abs(f.offset))) < 0.0055);
  // Control: slide the whole catalogue 0.05 au outward. The finder follows the data, not Jupiter,
  // so its notches move with it and stop sitting on the resonances.
  const shifted = new Array(all.length).fill(0);
  for (let k = 0; k + 20 < all.length; k++) shifted[k + 20] = all[k];
  const moved = Belt.findNotches(shifted, 1.8, 3.4, 4);
  assert.ok(moved.every((f) => Math.abs(f.offset) > 0.03), moved.map((f) => f.offset).join());
  // A belt with no structure has no notches.
  assert.equal(Belt.findNotches(all.map(() => 1000), 1.8, 3.4, 4).length, 0);
});

test('the notch finder in the other populations, and by distance (what the README reports)', () => {
  const run = (pop, kind) => Belt.findNotches(Belt.fineCounts(Belt.population(pop), kind || 'a'), 1.8, 3.4, 4);
  assert.deepEqual(run('good').map((f) => f.nearest.label), ['5:2', '3:1', '7:3', '2:1']);
  const big = run('big');
  assert.deepEqual(big.slice(0, 3).map((f) => f.nearest.label), ['5:2', '3:1', '7:3']);
  assert.equal(big[3].a.toFixed(4), '3.0275');
  assert.ok(big[3].sigma > 10 && Math.abs(big[3].offset) > 0.07, 'a real notch, near no listed resonance');
  assert.ok(Math.abs(big[3].a - Belt.resonanceA(9, 4)) < 0.005, 'beside the 9:4, which the list leaves out');
  for (const pop of ['first1000', 'by1866']) assert.ok(run(pop).every((f) => f.sigma < 3), `${pop}: nothing beyond chance`);
  // The first version ranked by fractional depth: the same four on the full catalogue, but in the
  // larger asteroids it filled up with empty slices in the sparse inner edge of the belt.
  const old = (pop) => Belt.findNotches(Belt.population(pop).counts, 1.8, 3.4, 4, 2, 'depth');
  assert.deepEqual(old('all').map((f) => f.nearest.label).sort(), ['2:1', '3:1', '5:2', '7:3']);
  assert.ok(old('big').filter((f) => f.a < 2.1).length >= 2, old('big').map((f) => f.a).join());
  // Counted by distance from the Sun, there is nothing to find.
  assert.equal(run('all', 'r').length, 0);
  assert.equal(run('good', 'r').length, 0);
  assert.ok(run('big', 'r').every((f) => f.sigma < 0.5));
});

test('emptiness at each mark, as quoted', () => {
  const e = (pop, l) => Belt.emptiness(Belt.population(pop).counts, Belt.MARKS.find((m) => m.label === l).a);
  const pct = (x) => (100 * x.ratio).toFixed(0);
  assert.deepEqual(['3:1', '5:2', '7:3', '2:1'].map((l) => pct(e('all', l))), ['6', '7', '32', '16']);
  assert.deepEqual(['3:1', '5:2', '7:3', '2:1'].map((l) => pct(e('big', l))), ['1', '0', '25', '6']);
  assert.equal(pct(e('all', '3:2')), '189');
  assert.equal(e('all', '3:1').count, 254);
  const r = Belt.population('all').rcounts;
  const ratios = ['3:1', '5:2', '7:3', '2:1'].map((l) => Belt.emptiness(r, Belt.MARKS.find((m) => m.label === l).a).ratio);
  assert.ok(ratios.every((x) => x > 0.997 && x < 1.006), ratios.join());
  // Inner belt (2.1-2.5 au) per outer belt (2.83-3.27 au) asteroid: the full catalogue against the larger ones.
  const ratio = (pop) => {
    const c = Belt.population(pop).counts;
    return Belt.sumFine(c, Belt.fineIndex(2.1), Belt.fineIndex(2.5)) / Belt.sumFine(c, Belt.fineIndex(2.83), Belt.fineIndex(3.27));
  };
  assert.equal(ratio('all').toFixed(2), '0.83');
  assert.equal(ratio('big').toFixed(2), '0.35');
});

// ------------------------------------------------------------------ the solid
function checkModel(input, label) {
  const m = Belt.model(input);
  const L = m.layout;
  const f = Belt.meshFacts(m.mesh);
  assert.ok(f.closedAndOriented, `${label}: every edge is shared by exactly two faces, in opposite directions (${f.badEdges} bad)`);
  assert.equal(f.euler, 2, `${label}: one solid with no holes`);
  assert.ok(f.minTriangleArea >= 4e-5, `${label}: no zero-area triangles (${f.minTriangleArea})`);
  const want = Belt.expectedVolume(L);
  assert.ok(Math.abs(f.volume - want) < 1e-6 * want, `${label}: volume ${f.volume} vs ${want}`);
  assert.equal(f.min[2], 0, `${label}: sits on z = 0`);
  assert.deepEqual(f.max.map((x) => +x.toFixed(6)), L.size, `${label}: size`);
  assert.ok(L.size.every((x) => x <= 180), `${label}: fits a 180 mm bed`);
  assert.ok(L.binMm >= Belt.MIN_BIN_MM - 1e-9, `${label}: bins at least 1 mm`);
  // Every flat run on every terrace is at least 0.5 mm long, so no slot or fin is thinner than that;
  // the bars themselves are at least 1 mm.
  for (const row of L.rows) for (const s of row.segs) assert.ok(s.x1 - s.x0 >= 0.5 - 1e-9, `${label}: segment ${s.x0}-${s.x1}`);
  return { m, L, f };
}

test('default solid: closed, on the bed, the size the README gives', () => {
  const { L, f } = checkModel(Belt.DEFAULTS, 'default');
  assert.deepEqual(L.size, [166, 22, 26.6]);
  assert.equal(f.triangles, 2852);
  assert.equal(L.params.nb, 160);
  assert.ok(Math.abs(L.mmPerAu - 100) < 1e-9);
  assert.deepEqual(L.marks.map((m) => m.label), ['3:1', '5:2', '7:3', '2:1']);
  assert.equal(L.ticks.length, 17);
  assert.equal((f.volume / 1000).toFixed(2), '33.96');
});

test('the bars are the data: heights follow the counts, and linear relief is proportional to them', () => {
  for (const scale of Belt.SCALES) {
    const L = Belt.layout({ ...Belt.DEFAULTS, scale });
    const fine = Belt.population('all').counts;
    const direct = Belt.sumFine(fine, Belt.fineIndex(1.8), Belt.fineIndex(3.4));
    assert.equal(L.csum, direct);
    L.bars.forEach((b) => {
      const want = Belt.H.bodyBase + L.params.relief * Belt.heightFraction(b.count, L.cmax, scale);
      assert.ok(Math.abs(b.h - want) <= 0.005 + 1e-9, `${scale} bar at ${b.a0}`);
      assert.equal(b.count, Belt.sumFine(fine, Belt.fineIndex(b.a0), Belt.fineIndex(b.a1)));
    });
  }
  const L = Belt.layout(Belt.DEFAULTS);
  const reliefVol = L.bars.reduce((s, b) => s + (b.h - Belt.H.bodyBase) * (b.x1 - b.x0) * L.params.depth, 0);
  const rel = Math.abs(reliefVol * L.perMm3 - L.csum) / L.csum;
  assert.ok(rel < 0.002, `relief volume times asteroids per mm^3 gives back the count (${rel})`);
  assert.equal(L.perMm3.toFixed(1), '76.8');
  assert.equal(L.csum, 1512033);
  assert.equal(L.cmax, 23653);
});

test('ticks and grooves sit where the scale puts them and never crowd', () => {
  const L = Belt.layout(Belt.DEFAULTS);
  for (const t of L.ticks) assert.ok(Math.abs((t.x0 + t.x1) / 2 - (Belt.MARGIN + (t.a - 1.8) * 100)) < 0.01);
  for (const m of L.marks) {
    const x = (m.x0 + m.x1) / 2;
    assert.ok(Math.abs(x - (Belt.MARGIN + (m.a - 1.8) * 100)) < 0.006, m.label);
    // the groove is centred on the resonance, so the bar above it covers that orbit size
    const bar = L.bars.find((b) => b.a0 <= m.a && m.a < b.a1);
    assert.ok(bar.x0 <= x && x <= bar.x1);
  }
  const rnd = lcg(7);
  for (let n = 0; n < 300; n++) {
    const a0 = 1.5 + rnd() * 3.9;
    const P = Belt.layout({ a0, a1: a0 + 0.1 + rnd() * (5.5 - a0), length: 50 + rnd() * 120 });
    for (let i = 1; i < P.ticks.length; i++) assert.ok(P.ticks[i].x0 - P.ticks[i - 1].x1 >= Belt.TICK_MIN_GAP - Belt.TICK_W - 0.02);
    for (let i = 1; i < P.marks.length; i++) assert.ok(P.marks[i].x0 - P.marks[i - 1].x1 >= Belt.GROOVE_MIN_SPACING - 0.02);
  }
});

test('every extreme the sweep prints, and every preset on the page, is a closed solid', () => {
  for (const e of EXTREMES) checkModel(e, e.name);
  const presets = JSON.parse(html.match(/data-presets='([^']+)'/)[1]);
  assert.ok(presets.length >= 5);
  for (const p of presets) checkModel(p.set, p.name);
});

test('sampled sweep: 400 random settings across every control are closed solids', () => {
  const rnd = lcg(72);
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  for (let n = 0; n < 400; n++) {
    const a0 = 1.5 + rnd() * 3.95;
    const input = {
      pop: pick(Belt.POP_IDS), scale: pick(Belt.SCALES), ledge: rnd() < 0.8,
      a0, a1: a0 + rnd() * (5.6 - a0), bin: rnd() * 0.12,
      length: 45 + rnd() * 130, relief: 3 + rnd() * 40, depth: 6 + rnd() * 26,
    };
    checkModel(input, JSON.stringify(input));
  }
});

test('corner sweep: every population and scale at the ends of length, relief, depth and range', () => {
  for (const pop of Belt.POP_IDS) for (const scale of Belt.SCALES) for (const ledge of [true, false])
    for (const length of [50, 170]) for (const relief of [4, 40]) for (const depth of [8, 30])
      for (const [a0, a1] of [[1.5, 1.6], [5.4, 5.5], [1.5, 5.5]]) for (const bin of [0, 1])
        checkModel({ pop, scale, ledge, length, relief, depth, a0, a1, bin }, `${pop} ${scale} ${ledge} ${length} ${relief} ${depth} ${a0}-${a1} ${bin}`);
});

test('inputs are cleaned: out-of-range numbers, junk and reversed ranges', () => {
  const P = Belt.normalize({ a0: 9, a1: -3, bin: 'x', length: 1e9, relief: -5, depth: NaN, pop: 'nope', scale: 'cubic' });
  assert.equal(P.pop, 'all');
  assert.equal(P.scale, 'linear');
  assert.equal(P.length, 170);
  assert.equal(P.relief, 4);
  assert.equal(P.depth, 14);
  assert.ok(P.a1 - P.a0 >= 0.1 - 1e-12 && P.a0 >= 1.5 && P.a1 <= 5.5);
  const tight = Belt.normalize({ a0: 1.5, a1: 5.5, bin: 0.0025, length: 50 });
  assert.ok(tight.notes.some((n) => /at least 1\.0 mm/.test(n)));
  assert.ok(tight.length / tight.nb >= 1);
  const odd = Belt.normalize({ a0: 2, a1: 3.01, bin: 0.02 });
  assert.equal(odd.a1, 3);
  assert.ok(odd.notes.some((n) => /whole number of bins/.test(n)));
  assert.ok(Belt.layout({ pop: 'by1866', a0: 4.5, a1: 5.5 }).cmax === 0, 'nobody found by 1866 orbits out there');
  checkModel({ pop: 'by1866', a0: 4.5, a1: 5.5 }, 'empty range');
});

// ------------------------------------------------------------------ the file
test('default.stl is byte-identical to what the code makes now', () => {
  const committed = fs.readFileSync(path.join(here, 'default.stl'));
  const made = defaultStl();
  assert.equal(committed.length, made.length);
  assert.ok(Buffer.from(made).equals(committed), 'byte-identical');
  assert.equal(committed.readUInt32LE(80), 2852);
  assert.equal(committed.subarray(0, 41).toString('latin1'), "Kirkwood's Ruler, binary STL, millimetres");
});

test('the STL as written (float32) is still closed: every edge pairs up by coordinates', () => {
  const tris = Belt.readStl(new Uint8Array(fs.readFileSync(path.join(here, 'default.stl'))));
  const key = (p) => p.join(',');
  const edges = new Map();
  for (const t of tris) for (let e = 0; e < 3; e++) {
    const k = key(t[e]) + '>' + key(t[(e + 1) % 3]);
    edges.set(k, (edges.get(k) || 0) + 1);
  }
  for (const [k, n] of edges) {
    const [a, b] = k.split('>');
    assert.equal(n, 1, k);
    assert.equal(edges.get(b + '>' + a), 1, `reverse of ${k}`);
  }
  let zmin = Infinity;
  for (const t of tris) for (const p of t) zmin = Math.min(zmin, p[2]);
  assert.equal(zmin, 0);
});

// ------------------------------------------------------------------ the words
test('the 1866 ruler, as the page describes it', () => {
  const L = Belt.layout(JSON.parse(html.match(/data-presets='([^']+)'/)[1]).find((p) => /1866/.test(p.name)).set);
  assert.equal(L.bars.length, 80);
  assert.equal(L.bars.filter((b) => b.count === 0).length, 43);
  for (const m of L.marks) assert.equal(L.bars.find((b) => b.a0 <= m.a && m.a < b.a1).count, 0, m.label);
  assert.match(html, /43 of its 80 bars are empty/);
  assert.equal(Belt.layout({ a0: 4.4, a1: 4.9, bin: 0.0025, relief: 40 }).fins, 19, 'the README\'s fin count');
  assert.equal(Belt.layout(Belt.DEFAULTS).fins, 0);
  // Kirkwood's "ten beyond three times the Earth's distance": the 91 of 1866, with today's orbits.
  assert.equal(Belt.sumFine(Belt.population('by1866').counts, Belt.fineIndex(3.0), 1600), 14);
  assert.match(readme, /14 of the 91 found by the year's end/);
  assert.equal(Belt.resonanceA(9, 4).toFixed(3), '3.029');
  assert.match(readme, /the 9:4 at 3\.029 au/);
  assert.equal(Belt.resonanceA(8, 3).toFixed(3), '2.705');
});

test('README and page quote the numbers the code computes', () => {
  assert.match(readme, /^# Kirkwood's Ruler\n> /);
  assert.match(readme, /1,576,490/);
  assert.match(readme, /166 × 22 × 26\.6 mm/);
  assert.match(readme, /2,852 triangles/);
  assert.match(readme, /\[Certain\][^\n]*not been (physically )?printed/);
  for (const s of ['2.501', '2.824', '2.957', '3.277']) assert.ok(readme.includes(s), s);
  for (const doc of [readme, html]) assert.match(doc, /0\.39 au either side of its orbit size/);
  assert.match(readme, /2\.8225 au \(67 standard deviations, 93% below its surroundings\), 2\.5025 \(66, 95%\), 2\.9575 \(44, 68%\) and 3\.2825 au \(21, 83%\)/);
  assert.match(readme, /3:1 holds 6%, 5:2 7%, 7:3 32%, 2:1 16%/);
  assert.match(readme, /21\.35 g of PLA and 1 h 44 min/);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
});
