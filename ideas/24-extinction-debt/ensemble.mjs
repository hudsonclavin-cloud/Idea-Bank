// Stochastic-forest statistics quoted in the README (not part of the test suite: it takes
// about 2 minutes per clearing level). From the repo root:
//   node ideas/24-extinction-debt/ensemble.mjs            # all four levels, 200 forests each
//   node ideas/24-extinction-debt/ensemble.mjs 0.4 50     # one level, fewer forests
// Each forest: 100 × 100 sites at the default settings (S = 10, q = 0.2, 50-yr lifetime), seeded
// at equilibrium, run 300 years, cleared at random to D, then run 2,000 more years. Every loss is
// classified with the model's equilibrium over the species standing just before it: "doomed" if
// that equilibrium is zero, "chance" otherwise.
import { createRequire } from 'node:module';

const M = createRequire(import.meta.url)('./model.js');
const args = process.argv.slice(2).map(Number);
const SEEDS = { 0.19: 20000, 0.25: 30000, 0.3: 40000, 0.4: 50000 };
const levels = args.length && args[0] < 1 ? [args[0]] : Object.keys(SEEDS).map(Number);
const count = args.length > 1 ? args[1] : 200;
const m = 0.02;
const c = M.geometricRates(10, 0.2, m);
const eq0 = M.equilibrium(c, m, 0);

for (const D of levels) {
  const seed0 = SEEDS[D] ?? 60000;
  const firstTimes = [];
  let chanceForests = 0;
  let knockOnForests = 0;
  const chanceRanks = {};
  for (let r = 0; r < count; r++) {
    const L = new M.Lattice(100, 100, c, m, seed0 + r);
    L.seed(eq0);
    L.advance(300);
    L.destroyRandom(D);
    const start = L.time;
    const alive = Array.from({ length: 10 }, (_, i) => L.counts[i + 1] > 0);
    let chance = false;
    let knockOn = false;
    while (L.time - start < 2000) {
      L.step();
      for (let i = 0; i < 10; i++) {
        if (!alive[i] || L.counts[i + 1] > 0) continue;
        const doomedNow = M.equilibrium(c, m, D, alive)[i] === 0;
        const doomedFullPool = M.equilibrium(c, m, D)[i] === 0;
        if (i === 0) firstTimes.push(L.extinctAt[0] - start);
        if (!doomedNow) {
          chance = true;
          chanceRanks[i + 1] = (chanceRanks[i + 1] || 0) + 1;
        } else if (!doomedFullPool) knockOn = true;
        alive[i] = false;
      }
    }
    if (chance) chanceForests++;
    if (knockOn) knockOnForests++;
  }
  firstTimes.sort((a, b) => a - b);
  const span = firstTimes.length
    ? ` at ${firstTimes[0].toFixed(0)}–${firstTimes[firstTimes.length - 1].toFixed(0)} yr (median ${firstTimes[Math.floor(firstTimes.length / 2)].toFixed(0)})`
    : '';
  console.log(
    `D = ${100 * D} %: #1 lost within 2,000 yr in ${firstTimes.length}/${count}${span}; ` +
      `forests losing a species the model did not doom: ${chanceForests}/${count}, by rank ${JSON.stringify(chanceRanks)}; ` +
      `forests with a knock-on loss (doomed only after a better competitor died out): ${knockOnForests}/${count}`,
  );
}
