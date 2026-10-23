// solve-rates.mjs — how often the shipped search finds a legal melody for ONE rhythm, per voice
// arrangement (transposition set) and proportion set. This is the experiment behind the numbers in
// README.md › Why I made it (re-measured during the independent review).
//
// Each trial composes seed "solve-<i>" with that arrangement forced and a single attempt, so a trial
// succeeds only if the first rhythm drawn has a legal melody. Deterministic: the same n gives the
// same counts. The full table (64 trials per cell, 42 cells) takes about ten minutes on one core.
//
//   node ideas/36-prolation/solve-rates.mjs [trials]
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const P = require('./compose.js');

/** Number of trials in 0..n-1 whose first rhythm has a legal melody under these shifts and ratios. */
export function solveRate(shifts, ratios, n = 64) {
  let ok = 0;
  for (let i = 0; i < n; i++) {
    try {
      P.compose('solve-' + i, { voices: shifts.length, ratios, shifts, attempts: 1 });
      ok++;
    } catch (e) {
      if (!/no melody/.test(e.message)) throw e;
    }
  }
  return ok;
}

// The sets in use, plus the ones that are not ([-7, 4, 7] and the three four-voice sets were tried
// and dropped; [-7, 7, 9] was never offered) for comparison.
export const CANDIDATES = {
  3: [[-7, 2, 7], [-7, 2, 4], [-7, 2, 9], [-7, 4, 9], [-7, 4, 7], [-7, 7, 9]],
  4: [[-7, 2, 7, 9], [-7, 2, 4, 7], [-7, 2, 4, 9], [-7, 4, 7, 9]],
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const n = Number(process.argv[2] || 64);
  for (const V of [4, 3]) {
    for (const shifts of CANDIDATES[V]) {
      const used = P.SHIFT_SETS[V].some((s) => s.join() === shifts.join()) ? 'in use  ' : 'not used';
      const cells = P.RATIO_SETS[V].map((ratios) => {
        const ok = solveRate(shifts, ratios, n);
        return `${ratios.join(':')} ${ok}/${n} (${((8 * ok) / n).toFixed(1)} in 8)`;
      });
      console.log(`[${shifts.join(', ')}] ${used}  ${cells.join('  ')}`);
    }
  }
}
