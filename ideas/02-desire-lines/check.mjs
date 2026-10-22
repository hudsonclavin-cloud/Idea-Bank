#!/usr/bin/env node
// Headless verification of the simulation in sim.js (no browser needed):
//   node check.mjs          (takes a minute or two)
// Checks invariants (no NaNs, wear in range, walker bookkeeping, nobody inside a
// hedge, nobody stuck), the measuring tools (distance fields, trail-length
// estimator), and that the emergent behaviour described in the README appears.
import fs from 'node:fs';
import vm from 'node:vm';

// sim.js is a classic browser script that defines the global DesireSim.
vm.runInThisContext(fs.readFileSync(new URL('./sim.js', import.meta.url), 'utf8'), { filename: 'sim.js' });
const { TrailSim, loadScenario } = globalThis.DesireSim;

let failures = 0;
function check(ok, msg) {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${msg}`);
  if (!ok) failures++;
}
const pct = (x) => `${(x * 100).toFixed(1)}%`;

function invariants(sim, label) {
  const { G, V, gx, gy, paved, wall, N } = sim;
  let bad = 0;
  let outOfRange = 0;
  let wornHard = 0;
  for (let c = 0; c < G.length; c++) {
    if (!Number.isFinite(G[c]) || !Number.isFinite(V[c]) || !Number.isFinite(gx[c]) || !Number.isFinite(gy[c])) bad++;
    if (G[c] < 0 || G[c] > 1) outOfRange++;
    if ((paved[c] || wall[c]) && G[c] !== 0) wornHard++;
  }
  let walkerBad = 0;
  let inWall = 0;
  for (let k = 0; k < sim.nw; k++) {
    const x = sim.wx[k];
    const y = sim.wy[k];
    if (![x, y, sim.wvx[k], sim.wvy[k], sim.wwalk[k], sim.wbase[k]].every(Number.isFinite)) walkerBad++;
    if (x < 0 || y < 0 || x >= N || y >= N) walkerBad++;
    else if (wall[(y | 0) * N + (x | 0)]) inWall++;
  }
  check(bad === 0 && walkerBad === 0, `${label}: no NaN/Infinity in fields or walkers`);
  check(outOfRange === 0, `${label}: wear stays within [0, 1]`);
  check(wornHard === 0, `${label}: pavement and hedges never accumulate wear`);
  check(inWall === 0, `${label}: no walker is inside a hedge or pond`);
  const books = sim.arrived + sim.gaveUp + sim.culled + sim.nw;
  check(books === sim.spawned, `${label}: every walker accounted for (spawned ${sim.spawned} = arrived + gave up + culled + walking ${books})`);
}

function run(scenario, params, steps, seed = 11) {
  const sim = new TrailSim({ N: 200, seed, params });
  loadScenario(sim, scenario);
  const series = [];
  while (sim.steps < steps) {
    sim.advance(8);
    if (sim.steps % 2000 === 0) {
      const m = sim.metrics();
      series.push({ steps: sim.steps, ratio: m.trail / m.web, detour: m.detour });
    }
  }
  return { sim, series, m: sim.metrics() };
}
const wearNear = (sim, x, y, r) => {
  let best = 0;
  for (let j = Math.floor(y - r); j <= y + r; j++) for (let i = Math.floor(x - r); i <= x + r; i++) best = Math.max(best, sim.G[j * sim.N + i]);
  return best;
};

console.log('Measuring tools');
{
  // Distance field vs straight-line distance on an empty lawn.
  const sim = new TrailSim({ N: 200, seed: 1 });
  const d = sim.addDoor(100, 10);
  const D = sim.computeField(d);
  let worst = 0;
  for (let j = 0; j < 200; j++)
    for (let i = 0; i < 200; i++) {
      const e = Math.hypot(i + 0.5 - 100, j + 0.5 - 10);
      if (e > 5) worst = Math.max(worst, Math.abs(D[j * 200 + i] / e - 1));
    }
  check(worst < 0.05, `distance field within 5% of straight-line distance on open grass (worst ${pct(worst)})`);
  sim.paintLine(60, 60, 140, 60, 2, 'hedge');
  const D2 = sim.computeField(d);
  const behind = D2[100 * 200 + 100];
  check(behind > Math.hypot(0.5, 90.5) + 3 && Number.isFinite(behind), `distance field routes around a hedge (${behind.toFixed(1)} > straight ${Math.hypot(0.5, 90.5).toFixed(1)})`);

  // Trail-length estimator on synthetic straight trails at many angles.
  let worstLen = 0;
  for (let ang = 0; ang < 180; ang += 7.5) {
    sim.G.fill(0);
    const a = (ang * Math.PI) / 180;
    const L = 120;
    for (let t = 0; t <= L; t += 0.25)
      for (let w = -1; w <= 1; w += 0.5) {
        const x = 100 + Math.cos(a) * (t - L / 2) - Math.sin(a) * w;
        const y = 100 + Math.sin(a) * (t - L / 2) + Math.cos(a) * w;
        sim.G[(y | 0) * 200 + (x | 0)] = 0.6;
      }
    worstLen = Math.max(worstLen, Math.abs(sim.trailLength() / L - 1));
  }
  check(worstLen < 0.12, `trail-length estimator within 12% for straight trails at any angle (worst ${pct(worstLen)})`);
}

console.log('Determinism');
{
  const a = run('three', {}, 2000, 5).sim;
  const b = run('three', {}, 2000, 5).sim;
  check(a.G.every((v, i) => v === b.G[i]) && a.arrived === b.arrived, 'same seed, same lawn');
}

console.log('Three gates: four regimes, 30,000 steps each');
// Shortest possible network joining the three gates (the Steiner tree), as a
// fraction of the straight-line triangle. For a triangle with all angles < 120 deg:
// L = sqrt((a^2+b^2+c^2)/2 + 2*sqrt(3)*area).
const gates = [
  [100, 14],
  [16, 168],
  [184, 168],
];
const side = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
const [ab, bc, ca] = [side(gates[0], gates[1]), side(gates[1], gates[2]), side(gates[2], gates[0])];
const area = Math.abs((gates[1][0] - gates[0][0]) * (gates[2][1] - gates[0][1]) - (gates[2][0] - gates[0][0]) * (gates[1][1] - gates[0][1])) / 2;
const steiner = Math.sqrt((ab * ab + bc * bc + ca * ca) / 2 + 2 * Math.sqrt(3) * area) / (ab + bc + ca);
console.log(`  (Steiner minimum for these gates: ${pct(steiner)} of the straight-line triangle)`);

const results = {};
for (const [name, params] of [
  ['beeline (pull 0)', { pull: 0 }],
  ['default', {}],
  ['short memory (300)', { recovery: 300 }],
  ['long memory (12000)', { recovery: 12000 }],
]) {
  const t0 = Date.now();
  const r = run('three', params, 30000);
  results[name] = r;
  const early = r.series.find((p) => p.steps === 4000);
  console.log(
    `  ${name}: network ${pct(early.ratio)} -> ${pct(r.m.trail / r.m.web)} of straight lines, detour ${pct(r.m.detour)}, ` +
      `centre wear ${wearNear(r.sim, 100, 117, 6).toFixed(2)}  [${((Date.now() - t0) / 1000).toFixed(1)}s]`,
  );
  invariants(r.sim, name);
  check(r.sim.gaveUp === 0, `${name}: nobody got stuck (gave up: ${r.sim.gaveUp})`);
}
const ratio = (n) => results[n].m.trail / results[n].m.web;
const bee = results['beeline (pull 0)'];
const def = results['default'];
const short = results['short memory (300)'];
const long = results['long memory (12000)'];
check(ratio('beeline (pull 0)') > 0.9 && bee.m.detour < 0.01, `beeliners wear the full straight-line triangle (${pct(ratio('beeline (pull 0)'))}) with ~no detour (${pct(bee.m.detour)})`);
check(wearNear(bee.sim, 100, 117, 6) < 0.05, 'beeliners leave the middle of the triangle untouched');
const defEarly = def.series.find((p) => p.steps === 4000).ratio;
check(ratio('default') < defEarly - 0.04 && ratio('default') < 0.88, `default: the network shrinks over time (${pct(defEarly)} -> ${pct(ratio('default'))})`);
check(def.m.detour > bee.m.detour + 0.03, `default: walkers pay for the shared network with a detour (${pct(def.m.detour)})`);
check(ratio('short memory (300)') < steiner + 0.1, `short memory: network approaches the Steiner minimum (${pct(ratio('short memory (300)'))} vs ${pct(steiner)})`);
check(wearNear(short.sim, 100, 117, 8) > 0.15, 'short memory: a junction forms in the middle of the triangle');
check(ratio('long memory (12000)') > ratio('default') + 0.02, `long memory: early paths stay locked in (${pct(ratio('long memory (12000)'))} vs default ${pct(ratio('default'))})`);

console.log('Hedges, pond, pavement');
{
  const r = run('pond', {}, 12000);
  invariants(r.sim, 'pond');
  check(r.sim.gaveUp === 0 && r.sim.arrived > 3000, `pond: walkers route around the water (${r.sim.arrived} trips, ${r.sim.gaveUp} stuck)`);

  // Taut route length around an obstacle vs. the exact answer for a wall segment.
  {
    const t = new TrailSim({ N: 200, seed: 1 });
    const door = t.addDoor(100, 20);
    t.paintLine(60, 100, 140, 100, 1.2, 'hedge'); // fills cells x 59..140, y 99..100
    t.computeField(door);
    // From (100.5, 180.5) the shortest route runs to the hedge's corner (59, 101),
    // up its 2-cell end to (59, 99), then on to the door.
    const exact = Math.hypot(100.5 - 59, 180.5 - 101) + 2 + Math.hypot(59 - 100, 99 - 20);
    const taut = t.tautLength(door, 100.5, 180.5);
    check(Math.abs(taut / exact - 1) < 0.03, `taut route length round a hedge within 3% of exact (${taut.toFixed(1)} vs ${exact.toFixed(1)})`);
  }

  const sim = new TrailSim({ N: 200, seed: 3, params: { pull: 0 } });
  loadScenario(sim, 'three');
  for (let i = 0; i < 500; i++) sim.advance(8);
  const before = sim.detour;
  // A hedge right across the A-B path, mid-run, with walkers on it.
  sim.paintLine(30, 95, 90, 95, 1.7, 'hedge');
  sim.resetStats();
  for (let i = 0; i < 1500; i++) sim.advance(8);
  invariants(sim, 'hedge across a busy path');
  check(sim.gaveUp === 0, `hedge: walkers find a way round (stuck: ${sim.gaveUp})`);
  check(sim.detour > -0.005 && sim.detour < 0.03, `hedge: detour measured against the new shortest route stays small for beeliners (${pct(before)} before, ${pct(sim.detour)} after)`);
  check(wearNear(sim, 26, 95, 3) > 0.1, `hedge: a new path wears in round the near end of the hedge (wear ${wearNear(sim, 26, 95, 3).toFixed(2)})`);

  // Dragging a door mid-trip must not corrupt the detour stats.
  sim.moveDoor(sim.doors[0].id, 60, 40);
  for (let i = 0; i < 300; i++) sim.advance(8);
  check(Number.isFinite(sim.detour) && sim.detour > -0.01 && sim.detour < 1, `moving a door keeps the detour statistic sane (${pct(sim.detour)})`);
  invariants(sim, 'after moving a door');

  const q = run('quad', {}, 12000);
  invariants(q.sim, 'campus quad');
  check(q.m.paveShare < 0.5, `campus quad: most walking happens off the sidewalks (${pct(q.m.paveShare)} on pavement)`);
  const paved = q.sim.paveWorn(0.3);
  check(paved > 100, `pave-the-worn-paths converts ${paved} cells`);
  for (let i = 0; i < 1500; i++) q.sim.advance(8);
  const after = q.sim.metrics();
  check(after.paveShare > q.m.paveShare + 0.3, `after paving the desire lines, walkers use the pavement (${pct(q.m.paveShare)} -> ${pct(after.paveShare)})`);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
