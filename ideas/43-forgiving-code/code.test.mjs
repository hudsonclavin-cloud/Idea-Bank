// Checks for "The Forgiving Code". From the repo root:
//   node --test ideas/43-forgiving-code/code.test.mjs
// Prints the measured numbers as it goes. Everything here is recomputed from the
// raw tables (the 64-codon string, the 20 property values, the two weight tables),
// mostly by a slower route than the one the page uses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const C = createRequire(import.meta.url)('./code.js');
const log = (...a) => console.log('   ', ...a);
const near = (x, y, tol, msg) => assert.ok(Math.abs(x - y) <= tol, `${msg}: ${x} vs ${y} (tol ${tol})`);

// ------------------------------------------------------------ the raw tables
test('the standard code: 64 codons, 61 sense, 3 stops, 20 amino acids with the textbook degeneracies', () => {
  assert.equal(C.CODONS.length, 64);
  assert.equal(C.SENSE.length, 61);
  assert.deepEqual(C.STOPS, ['UAA', 'UAG', 'UGA']);
  assert.equal(C.STANDARD.AUG, 'M');
  assert.equal(C.STANDARD.UGG, 'W');
  assert.equal(C.STANDARD.UUU, 'F');
  assert.equal(C.STANDARD.GGG, 'G');
  const sizes = {};
  for (const c of C.SENSE) sizes[C.STANDARD[c]] = (sizes[C.STANDARD[c]] || 0) + 1;
  assert.deepEqual(sizes, { F: 2, L: 6, S: 6, Y: 2, C: 2, W: 1, P: 4, H: 2, Q: 2, R: 6, I: 3, M: 1, T: 4, N: 2, K: 2, V: 4, A: 4, D: 2, E: 2, G: 4 });
  assert.equal(C.BLOCKS.length, 20);
  assert.equal(C.BLOCKS.reduce((n, b) => n + b.length, 0), 61);
});

test('polar requirement and hydropathy tables match the published values', () => {
  // Woese et al. 1966 as reprinted in Geyer & Madany Mamlouk 2018 (PeerJ 6:e4825), Table 1.
  const pr = { A: 7.0, R: 9.1, N: 10.0, D: 13.0, C: 4.8, Q: 8.6, E: 12.5, G: 7.9, H: 8.4, I: 4.9, L: 4.9, K: 10.1, M: 5.3, F: 5.0, P: 6.6, S: 7.5, T: 6.6, W: 5.2, Y: 5.4, V: 5.6 };
  // Kyte & Doolittle 1982, J Mol Biol 157:105.
  const kd = { A: 1.8, R: -4.5, N: -3.5, D: -3.5, C: 2.5, Q: -3.5, E: -3.5, G: -0.4, H: -3.2, I: 4.5, L: 3.8, K: -3.9, M: 1.9, F: 2.8, P: -1.6, S: -0.8, T: -0.7, W: -0.9, Y: -1.3, V: 4.2 };
  for (const a of C.AMINO) {
    assert.equal(a.pr, pr[a.one], a.name + ' PR');
    assert.equal(a.kd, kd[a.one], a.name + ' KD');
  }
  assert.equal(C.PROPERTIES.pr.min, 4.8);
  assert.equal(C.PROPERTIES.pr.max, 13.0);
  assert.equal(C.PROPERTIES.kd.min, -4.5);
  assert.equal(C.PROPERTIES.kd.max, 4.5);
});

// ------------------------------------------------------------ substitutions
test('526 single-base substitutions between sense codons (263 pairs), 23 into stops, 134 synonymous', () => {
  // Recount from scratch, independently of code.js's loop.
  let ordered = 0, toStop = 0, syn = 0;
  const byPos = [0, 0, 0], synPos = [0, 0, 0];
  for (const from of C.CODONS) {
    if (C.STANDARD[from] === '*') continue;
    for (let pos = 0; pos < 3; pos++) for (const b of 'UCAG') {
      if (b === from[pos]) continue;
      const to = from.slice(0, pos) + b + from.slice(pos + 1);
      if (C.STANDARD[to] === '*') { toStop++; continue; }
      ordered++; byPos[pos]++;
      if (C.STANDARD[to] === C.STANDARD[from]) { syn++; synPos[pos]++; }
    }
  }
  log(`ordered ${ordered}, into stops ${toStop}, synonymous ${syn}; by position ${byPos} (synonymous ${synPos})`);
  assert.equal(ordered, 526);
  assert.equal(ordered / 2, 263); // Haig & Hurst's "263 single-step codon connections"
  assert.equal(toStop, 23);
  assert.equal(syn, 134);
  assert.deepEqual(byPos, [174, 176, 176]);
  assert.deepEqual(synPos, [8, 0, 126]);
  assert.equal(C.SUBSTITUTIONS.length, 526);
  const st = C.substitutionStats();
  assert.equal(st.synonymous, 134);
  assert.equal(st.toStop, 23);
  // Every substitution is symmetric: (from,to) present iff (to,from) present, with the same position and type.
  const key = (s) => s.from + '>' + s.to;
  const set = new Map(C.SUBSTITUTIONS.map((s) => [key(s), s]));
  for (const s of C.SUBSTITUTIONS) {
    const r = set.get(s.to + '>' + s.from);
    assert.ok(r && r.pos === s.pos && r.transition === s.transition);
  }
  // Transition vs transversion: each codon has one transition and two transversions per position.
  assert.equal(C.SUBSTITUTIONS.filter((s) => s.transition).length * 2 >= C.SUBSTITUTIONS.filter((s) => !s.transition).length - 30, true);
  assert.ok(C.SUBSTITUTIONS.find((s) => s.from === 'GAG' && s.to === 'GUG' && s.pos === 1 && !s.transition));
  assert.ok(C.SUBSTITUTIONS.find((s) => s.from === 'GAG' && s.to === 'GAA' && s.pos === 2 && s.transition));
});

// ---------------------------------------------------------------- the score
function slowScore(code, propKey, ts, tv, positions) {
  // Straight from the definition, no shortcuts.
  const p = C.PROPERTIES[propKey];
  let num = 0, den = 0;
  for (const from of C.CODONS) {
    if (code[from] === '*') continue;
    for (let pos = 0; pos < 3; pos++) {
      if (positions && !positions.includes(pos)) continue;
      for (const b of 'UCAG') {
        if (b === from[pos]) continue;
        const to = from.slice(0, pos) + b + from.slice(pos + 1);
        if (code[to] === '*') continue;
        const pur = (x) => x === 'A' || x === 'G';
        const w = (pur(b) === pur(from[pos]) ? ts : tv)[pos];
        const d = p.value(code[from]) - p.value(code[to]);
        num += w * d * d;
        den += w;
      }
    }
  }
  return num / den;
}

test('MS0 of the real code with polar requirement is 5.19 (Haig & Hurst 1991), by position 4.88 / 10.56 / 0.14', () => {
  const ms0 = slowScore(C.STANDARD, 'pr', [1, 1, 1], [1, 1, 1]);
  log('MS0 =', ms0.toFixed(4));
  near(ms0, 5.19, 0.005, 'MS0 vs Haig & Hurst');
  near(C.scoreCode(C.STANDARD, 'pr', 'uniform'), ms0, 1e-12, 'scoreCode');
  near(C.scorePerm(C.IDENTITY, C.propertyArray('pr'), 'uniform'), ms0, 1e-12, 'scorePerm');
  const byPos = [0, 1, 2].map((i) => slowScore(C.STANDARD, 'pr', [1, 1, 1], [1, 1, 1], [i]));
  log('MS1..3 =', byPos.map((v) => v.toFixed(3)).join(' / '));
  near(byPos[0], 4.881, 0.001, 'MS1');
  near(byPos[1], 10.557, 0.001, 'MS2');
  near(byPos[2], 0.140, 0.001, 'MS3');
  for (let i = 0; i < 3; i++) near(C.scorePerm(C.IDENTITY, C.propertyArray('pr'), 'uniform', [i]), byPos[i], 1e-12, 'scorePerm by position');
  assert.ok(byPos[1] > byPos[0] && byPos[0] > byPos[2], 'second position is the worst, third the gentlest');
});

test('the Freeland & Hurst weighting gives 2.63 for the real code; hydropathy gives 9.39 unweighted', () => {
  const ts = [1, 0.5, 1], tv = [0.5, 0.1, 1];
  assert.deepEqual(C.SCHEMES.fh.ts, ts);
  assert.deepEqual(C.SCHEMES.fh.tv, tv);
  const fh = slowScore(C.STANDARD, 'pr', ts, tv);
  log('FH-weighted PR =', fh.toFixed(4));
  near(fh, 2.628, 0.001, 'FH-weighted score');
  near(C.scoreCode(C.STANDARD, 'pr', 'fh'), fh, 1e-12, 'scoreCode fh');
  near(C.scorePerm(C.IDENTITY, C.propertyArray('pr'), 'fh'), fh, 1e-12, 'scorePerm fh');
  const kd = slowScore(C.STANDARD, 'kd', [1, 1, 1], [1, 1, 1]);
  log('KD unweighted =', kd.toFixed(4));
  near(kd, 9.394, 0.001, 'KD score');
  near(C.scoreCode(C.STANDARD, 'kd', 'uniform'), kd, 1e-12, 'scoreCode kd');
});

test('the fast block-pair score agrees with the definition on 300 random codes, both schemes, both properties', () => {
  const rng = C.mulberry32(12345);
  for (let k = 0; k < 300; k++) {
    const perm = C.randomPerm(rng);
    const code = C.codeFromPerm(perm);
    for (const prop of ['pr', 'kd']) {
      for (const scheme of ['uniform', 'fh']) {
        const s = C.SCHEMES[scheme];
        const slow = slowScore(code, prop, s.ts, s.tv);
        near(C.scorePerm(perm, C.propertyArray(prop), scheme), slow, 1e-10, `scorePerm ${prop} ${scheme}`);
        near(C.scoreCode(code, prop, scheme), slow, 1e-10, `scoreCode ${prop} ${scheme}`);
      }
    }
    // a permutation is a permutation
    assert.deepEqual(perm.slice().sort(), C.LETTERS.slice().sort());
    // stops are fixed
    assert.deepEqual(C.STOPS.map((c) => code[c]), ['*', '*', '*']);
  }
});

test('random permutations are uniform enough: each amino acid lands in each block about 1/20 of the time', () => {
  const rng = C.mulberry32(99);
  const N = 40000;
  const counts = C.LETTERS.map(() => new Array(20).fill(0));
  for (let i = 0; i < N; i++) {
    const p = C.randomPerm(rng);
    for (let b = 0; b < 20; b++) counts[b][C.LETTERS.indexOf(p[b])]++;
  }
  let worst = 0;
  for (const row of counts) for (const c of row) worst = Math.max(worst, Math.abs(c / N - 0.05));
  log('worst deviation from 1/20:', worst.toFixed(4));
  assert.ok(worst < 0.006, 'cells within 0.6 percentage points of 5% (SD of a cell is ~0.11 pp)');
});

// ----------------------------------------------------- the one-in-N results
test('a million random codes: ~1 in 10,000 beat the real code unweighted (Haig & Hurst: 0.02%; Geyer & Madany Mamlouk: 124 of 10^6), mean 9.42 ± 1.51', () => {
  const r = C.sampleCodes(1000000, 'pr', 'uniform', C.mulberry32(2024));
  log(`better ${r.better} of ${r.n}; mean ${r.mean.toFixed(3)} sd ${r.sd.toFixed(3)}; standard ${r.standard.toFixed(4)}`);
  assert.ok(r.better >= 50 && r.better <= 250, `expected roughly 100-ish of a million, got ${r.better}`);
  near(r.mean, 9.42, 0.05, 'random mean (Geyer & Madany Mamlouk 2018 Table 4: 9.42)');
  near(r.sd, 1.51, 0.05, 'random SD (Geyer & Madany Mamlouk 2018: 1.51)');
  for (let i = 0; i < r.n; i += 9973) assert.ok(Number.isFinite(r.scores[i]) && r.scores[i] > 0);
});

test('a million random codes under the Freeland & Hurst weighting: of order one in a million beat the real code', () => {
  const r = C.sampleCodes(1000000, 'pr', 'fh', C.mulberry32(1998));
  log(`better ${r.better} of ${r.n}; mean ${r.mean.toFixed(3)} sd ${r.sd.toFixed(3)}; standard ${r.standard.toFixed(4)}`);
  assert.ok(r.better <= 15, `expected a handful at most, got ${r.better}`);
  assert.ok(r.mean > 7 && r.mean < 8.3, 'random mean around 7.6');
});

test('hydropathy makes the real code rarer than 1 in 50 but much less than 1 in 10,000', () => {
  const r = C.sampleCodes(300000, 'kd', 'uniform', C.mulberry32(1982));
  const frac = r.better / r.n;
  log(`better ${r.better} of ${r.n} (1 in ${Math.round(1 / frac)})`);
  assert.ok(frac > 0.002 && frac < 0.02, `expected ~0.8%, got ${(100 * frac).toFixed(2)}%`);
});

test('hydropathy under the Freeland & Hurst weighting: about 1 in 10,000, far rarer than unweighted, far commoner than polar requirement', () => {
  // The page's note gives "about 1 in 130" for hydropathy; that holds only with every typo equal.
  const r = C.sampleCodes(1000000, 'kd', 'fh', C.mulberry32(1983));
  const frac = r.better / r.n;
  log(`KD, FH weighting: better ${r.better} of ${r.n} (1 in ${Math.round(1 / frac)}); real code ${r.standard.toFixed(3)}`);
  near(r.standard, 4.601, 0.001, 'KD FH score of the real code');
  assert.ok(frac > 1 / 30000 && frac < 1 / 4000, `expected about 1 in 10,000, got 1 in ${Math.round(1 / frac)}`);
});

test('molecular volume shows only a weak signal and isoelectric point none (the page no longer says Haig & Hurst found volume robust)', () => {
  // Scales typed from the standard tables, not part of the page:
  //   Zamyatnin AA (1972) Prog Biophys Mol Biol 24:107 (residue volume in solution, cubic angstroms)
  //   Grantham R (1974) Science 185:862 (the volume column of his difference formula)
  //   isoelectric points, common textbook values
  const scales = {
    'volume (Zamyatnin)': { A: 88.6, R: 173.4, N: 114.1, D: 111.1, C: 108.5, Q: 143.8, E: 138.4, G: 60.1, H: 153.2, I: 166.7, L: 166.7, K: 168.6, M: 162.9, F: 189.9, P: 112.7, S: 89.0, T: 116.1, W: 227.8, Y: 193.6, V: 140.0 },
    'volume (Grantham)': { A: 31, R: 124, N: 56, D: 54, C: 55, Q: 85, E: 83, G: 3, H: 96, I: 111, L: 111, K: 119, M: 105, F: 132, P: 32.5, S: 32, T: 61, W: 170, Y: 136, V: 84 },
    'isoelectric point': { A: 6.0, R: 10.76, N: 5.41, D: 2.77, C: 5.07, Q: 5.65, E: 3.22, G: 5.97, H: 7.59, I: 6.02, L: 5.98, K: 9.74, M: 5.74, F: 5.48, P: 6.3, S: 5.68, T: 5.6, W: 5.89, Y: 5.66, V: 5.96 },
  };
  const frac = {};
  for (const [name, table] of Object.entries(scales)) {
    const r = C.sampleCodes(300000, { value: (l) => table[l] }, 'uniform', C.mulberry32(1991));
    frac[name] = r.better / r.n;
    log(`${name}: ${r.better} of ${r.n} random codes beat the real code (${(100 * frac[name]).toFixed(1)}%)`);
  }
  // "roughly 1 random code in 10 does better, on either of two common volume scales"
  for (const v of ['volume (Zamyatnin)', 'volume (Grantham)']) assert.ok(frac[v] > 0.04 && frac[v] < 0.15, `${v}: ${frac[v]}`);
  // "absent for isoelectric point (more than half do better)"
  assert.ok(frac['isoelectric point'] > 0.5, `pI: ${frac['isoelectric point']}`);
});

test('the best unweighted code found here (3.4886) is a local minimum and scores 2.19 under the FH weighting, as Geyer & Madany Mamlouk tabulate for Goldman\'s optimal code', () => {
  // Found by annealing (120 restarts end here, none lower). Goldman (1993) found the optimum of this measure and
  // Buhrman et al. (2011) proved it global; Geyer & Madany Mamlouk (2018, Table 8) list Goldman's code at
  // tMS0 (the FH weighting) 2.19 and WMS0 with transitions weighted 2 at 3.50. Block (real amino acid) -> new amino acid:
  const OPT = { A: 'V', C: 'K', D: 'I', E: 'C', F: 'N', G: 'A', H: 'F', I: 'R', K: 'M', L: 'Q', M: 'E', N: 'W', P: 'T', Q: 'L', R: 'G', S: 'S', T: 'P', V: 'H', W: 'D', Y: 'Y' };
  const perm = C.LETTERS.map((l) => OPT[l]);
  assert.deepEqual(perm.slice().sort(), C.LETTERS.slice().sort());
  const pv = C.propertyArray('pr');
  const ms0 = C.scorePerm(perm, pv, 'uniform');
  const fh = C.scorePerm(perm, pv, 'fh');
  const w2 = C.scorePerm(perm, pv, { key: 'ts2', ts: [2, 2, 2], tv: [1, 1, 1] });
  log(`optimum: MS0 ${ms0.toFixed(4)}, FH ${fh.toFixed(4)} (Goldman's code in G&MM: 2.19), transitions x2 ${w2.toFixed(4)} (G&MM: 3.50)`);
  near(ms0, 3.4886, 5e-5, 'MS0 of the optimum');
  assert.equal(fh.toFixed(2), '2.19');
  near(w2, 3.50, 0.01, 'transition-weighted score vs G&MM Table 8');
  near(slowScore(C.codeFromPerm(perm), 'pr', [1, 1, 1], [1, 1, 1]), ms0, 1e-10, 'slow score');
  // no single swap of two amino acids improves it
  for (let i = 0; i < 20; i++) for (let j = i + 1; j < 20; j++) {
    const p = perm.slice(); const t = p[i]; p[i] = p[j]; p[j] = t;
    assert.ok(C.scorePerm(p, pv, 'uniform') >= ms0 - 1e-12, `swap ${i},${j} improves the optimum`);
  }
});

test('better codes exist: annealing finds about 3.5 unweighted and about 1.5 weighted', () => {
  // 120 restarts of 200,000 steps (t0 3, t1 0.0005) ended at 3.4886 (67 times) and 1.4874 (35 times),
  // never lower. Six shorter runs here must get close to those and must not beat them.
  let best = Infinity, bestFh = Infinity;
  for (let k = 0; k < 6; k++) {
    best = Math.min(best, C.searchBetter('pr', 'uniform', C.mulberry32(500 + k), { steps: 40000, t0: 2, t1: 0.001 }).score);
    bestFh = Math.min(bestFh, C.searchBetter('pr', 'fh', C.mulberry32(600 + k), { steps: 40000, t0: 2, t1: 0.001 }).score);
  }
  log(`best found: ${best.toFixed(4)} unweighted, ${bestFh.toFixed(4)} weighted`);
  assert.ok(best < 3.75, `unweighted: expected a code below 3.75, got ${best}`);
  assert.ok(best >= 3.4886 - 5e-4, `unweighted: found ${best}, below the 120-run minimum 3.4886; README needs updating`);
  assert.ok(bestFh < 1.75, `weighted: expected a code below 1.75, got ${bestFh}`);
  assert.ok(bestFh >= 1.4874 - 5e-4, `weighted: found ${bestFh}, below the 120-run minimum 1.4874; README needs updating`);
  // The result is a valid code
  const r = C.searchBetter('pr', 'uniform', C.mulberry32(7), { steps: 5000 });
  assert.deepEqual(r.perm.slice().sort(), C.LETTERS.slice().sort());
  near(C.scorePerm(r.perm, C.propertyArray('pr'), 'uniform'), r.score, 1e-12, 'reported score matches the permutation');
});

// ---------------------------------------------------------------- the genes
test('the real coding sequences translate to their RefSeq proteins, and the sickle landmark is Glu→Val', () => {
  for (const g of C.GENES) {
    assert.equal(g.cds.length % 3, 0);
    const codons = C.codonsOf(g.cds);
    assert.equal(codons[0], 'AUG');
    assert.equal(C.STANDARD[codons[codons.length - 1]], '*', 'ends with a stop');
    for (let i = 0; i < codons.length - 1; i++) assert.notEqual(C.STANDARD[codons[i]], '*', 'no internal stop');
    const t = C.translate(g.cds);
    assert.equal(t, g.protein, g.gene + ' translation');
    log(`${g.gene}: ${codons.length - 1} codons + stop, protein ${t.length} aa, matches ${g.proteinAccession}`);
  }
  assert.equal(C.GENES[0].protein.length, 110); // preproinsulin
  assert.equal(C.GENES[1].protein.length, 147); // beta-globin
  const hbb = C.GENES[1];
  const codons = C.codonsOf(hbb.cds);
  const lm = hbb.landmark;
  assert.equal(codons[lm.codonIndex], 'GAG');
  const mutated = codons[lm.codonIndex].slice(0, lm.pos) + lm.base + codons[lm.codonIndex].slice(lm.pos + 1);
  assert.equal(mutated, 'GUG');
  const e = C.effect(C.STANDARD, 'GAG', 'GUG', 'pr');
  assert.equal(e.kind, 'missense');
  assert.equal(e.a, 'E');
  assert.equal(e.b, 'V');
  near(e.delta, 5.6 - 12.5, 1e-12, 'Glu→Val polar requirement change');
  log('sickle: GAG→GUG, Glu→Val, ΔPR =', e.delta.toFixed(1), 'Δ² =', (e.delta * e.delta).toFixed(2));
  // c.20A>T: nucleotide 20 of the CDS is the middle base of codon 7
  assert.equal(hbb.cds[19], 'A');
  assert.equal(C.translate(hbb.cds).slice(0, 8), 'MVHLTPEE');
});

test('mutation generator: only sense codons are hit, neighbours are drawn with the scheme weights, and the storm is reproducible', () => {
  const codons = C.codonsOf(C.GENES[0].cds);
  const rng = C.mulberry32(5);
  const posCount = [0, 0, 0];
  let ts = 0, n = 20000;
  for (let i = 0; i < n; i++) {
    const m = C.drawMutation(codons, 'uniform', rng);
    assert.notEqual(C.STANDARD[m.from], '*');
    assert.equal(m.to.length, 3);
    assert.equal(m.from.slice(0, m.pos) + m.base + m.from.slice(m.pos + 1), m.to);
    assert.notEqual(m.from[m.pos], m.base);
    posCount[m.pos]++;
    const pur = (x) => x === 'A' || x === 'G';
    if (pur(m.base) === pur(m.from[m.pos])) ts++;
  }
  log('uniform: positions', posCount, 'transitions', (ts / n).toFixed(3));
  for (const c of posCount) near(c / n, 1 / 3, 0.015, 'uniform over positions');
  near(ts / n, 1 / 3, 0.015, 'one transition in three');
  // FH weights: position weights sum (ts + 2 tv) = 2 : 0.7 : 3
  const rng2 = C.mulberry32(6);
  const pc = [0, 0, 0];
  for (let i = 0; i < n; i++) pc[C.drawMutation(codons, 'fh', rng2).pos]++;
  log('fh: positions', pc.map((c) => (c / n).toFixed(3)).join(' '));
  near(pc[0] / n, 2 / 5.7, 0.015, 'first position share');
  near(pc[1] / n, 0.7 / 5.7, 0.01, 'second position share');
  near(pc[2] / n, 3 / 5.7, 0.015, 'third position share');
  // With stops disallowed (the page's storm), no draw ever lands on a stop codon, and the
  // nonsense fraction with stops allowed is 23/549 of all draws from the full table.
  const rng3 = C.mulberry32(9);
  let stops = 0;
  for (let i = 0; i < n; i++) { const m = C.drawMutation(codons, 'uniform', rng3, false); assert.notEqual(C.STANDARD[m.to], '*'); }
  const all = C.CODONS.filter((c) => C.STANDARD[c] !== '*');
  for (let i = 0; i < n; i++) if (C.STANDARD[C.drawMutation(all, 'uniform', rng3, true).to] === '*') stops++;
  log('nonsense fraction with stops allowed, all 61 codons:', (stops / n).toFixed(4), 'expected', (23 / 549).toFixed(4));
  near(stops / n, 23 / 549, 0.006, 'nonsense fraction');
  // Same seed, same storm
  const a = [], b = [];
  const ra = C.mulberry32(77), rb = C.mulberry32(77);
  for (let i = 0; i < 50; i++) { a.push(JSON.stringify(C.drawMutation(codons, 'uniform', ra, false))); b.push(JSON.stringify(C.drawMutation(codons, 'uniform', rb, false))); }
  assert.deepEqual(a, b);
});

test('effect(): a stop codon\'s neighbours that are also stops are "stop-stop", not "read on" (UAA 7/2, UAG 8/1, UGA 8/1)', () => {
  const expected = { UAA: [7, 2], UAG: [8, 1], UGA: [8, 1] };
  for (const stop of C.STOPS) {
    let read = 0, still = 0;
    for (let pos = 0; pos < 3; pos++) for (const b of C.BASES) {
      if (b === stop[pos]) continue;
      const to = stop.slice(0, pos) + b + stop.slice(pos + 1);
      const e = C.effect(C.STANDARD, stop, to, 'pr');
      if (C.STANDARD[to] === '*') { assert.equal(e.kind, 'stop-stop', `${stop}>${to}`); still++; }
      else { assert.equal(e.kind, 'readthrough', `${stop}>${to}`); read++; }
    }
    log(`${stop}: ${read} neighbours read on, ${still} stay stop`);
    assert.deepEqual([read, still], expected[stop]);
  }
  assert.equal(C.effect(C.STANDARD, 'UAU', 'UAA', 'pr').kind, 'nonsense');
  assert.equal(C.effect(C.STANDARD, 'GAG', 'GAA', 'pr').kind, 'silent');
});

test('silent and nonsense outcomes are identical under every alternative code (the shuffle keeps the redundancy)', () => {
  const rng = C.mulberry32(8);
  const codons = C.codonsOf(C.GENES[1].cds);
  for (let k = 0; k < 20; k++) {
    const alt = C.codeFromPerm(C.randomPerm(rng));
    for (let i = 0; i < 200; i++) {
      const m = C.drawMutation(codons, 'uniform', rng);
      const e1 = C.effect(C.STANDARD, m.from, m.to, 'pr'), e2 = C.effect(alt, m.from, m.to, 'pr');
      assert.equal(e1.kind, e2.kind, `${m.from}>${m.to}`);
    }
  }
});

test('geneScore is the expectation of the storm: Monte Carlo agrees, and a gene using every codon once scores close to MS0', () => {
  const codons = C.codonsOf(C.GENES[0].cds);
  for (const scheme of ['uniform', 'fh']) {
    const expect = C.geneScore(codons, C.STANDARD, 'pr', scheme);
    const rng = C.mulberry32(31);
    let sum = 0;
    const N = 400000;
    for (let i = 0; i < N; i++) {
      const m = C.drawMutation(codons, scheme, rng, false);
      const e = C.effect(C.STANDARD, m.from, m.to, 'pr');
      sum += e.delta * e.delta;
    }
    log(`INS ${scheme}: expected ${expect.toFixed(3)}, Monte Carlo ${(sum / N).toFixed(3)}`);
    near(sum / N, expect, 0.08, 'Monte Carlo vs geneScore ' + scheme);
  }
  const all = C.geneScore(C.SENSE, C.STANDARD, 'pr', 'uniform');
  log('all 61 codons once:', all.toFixed(4), 'vs MS0 5.1936 (differs because MS0 averages over substitutions, not codons)');
  near(all, 5.1936, 0.15, 'close to MS0');
  for (const g of C.GENES) {
    const real = C.geneScore(C.codonsOf(g.cds), C.STANDARD, 'pr', 'uniform');
    log(`${g.gene} expected per typo under the real code: ${real.toFixed(2)}`);
    assert.ok(real > 3 && real < 8);
  }
});

test('a random code averages 9.31 on the INS codons: closed form and Monte Carlo over random codes agree', () => {
  // Under a uniformly random block permutation, any non-synonymous neighbour costs the mean of
  // (p_a - p_b)^2 over the 380 ordered pairs of distinct amino acids; synonymous neighbours cost 0.
  const pv = C.propertyArray('pr');
  let pairSum = 0;
  for (let a = 0; a < 20; a++) for (let b = 0; b < 20; b++) if (a !== b) pairSum += (pv[a] - pv[b]) ** 2;
  const pairMean = pairSum / 380;
  const codons = C.codonsOf(C.GENES[0].cds);
  let sum = 0, n = 0;
  for (const from of codons) {
    if (C.STANDARD[from] === '*') continue;
    let nonsyn = 0, all = 0;
    for (let pos = 0; pos < 3; pos++) for (const b of 'UCAG') {
      if (b === from[pos]) continue;
      const to = from.slice(0, pos) + b + from.slice(pos + 1);
      if (C.STANDARD[to] === '*') continue;
      all++;
      if (C.STANDARD[to] !== C.STANDARD[from]) nonsyn++;
    }
    sum += (nonsyn / all) * pairMean; n++;
  }
  const exact = sum / n;
  const rng = C.mulberry32(4242);
  let mc = 0;
  const K = 3000;
  for (let k = 0; k < K; k++) mc += C.geneScore(codons, C.codeFromPerm(C.randomPerm(rng)), 'pr', 'uniform');
  mc /= K;
  log(`INS under random codes: exact ${exact.toFixed(4)} (pair mean ${pairMean.toFixed(4)}), Monte Carlo over ${K} codes ${mc.toFixed(4)}`);
  assert.equal(exact.toFixed(2), '9.31');
  near(mc, exact, 0.08, 'Monte Carlo vs closed form');
});

test('the worst single step of the real code (polar requirement) is Tyr→Asp, UAU→GAU, 7.6 units', () => {
  const w = C.worstStep(C.STANDARD, 'pr');
  log('worst step:', JSON.stringify(w));
  near(w.d, 7.6, 1e-9, 'worst jump');
  assert.equal(w.a, 'Y');
  assert.equal(w.b, 'D');
  assert.equal(w.pos, 0);
});

// ------------------------------------------------------------- the README
test('the numbers quoted in README.md and index.html match the model', () => {
  const here = new URL('.', import.meta.url);
  const readme = fs.readFileSync(new URL('README.md', here), 'utf8');
  const html = fs.readFileSync(new URL('index.html', here), 'utf8');
  const pv = C.propertyArray('pr');
  const ms0 = C.scorePerm(C.IDENTITY, pv, 'uniform');
  const fh = C.scorePerm(C.IDENTITY, pv, 'fh');
  assert.equal(ms0.toFixed(2), '5.19');
  assert.equal(fh.toFixed(2), '2.63');
  for (const text of [readme, html]) {
    assert.ok(text.includes('5.19'), 'quotes 5.19');
    assert.ok(text.includes('2.63'), 'quotes 2.63');
    assert.ok(text.includes('526'), 'quotes 526 substitutions');
    assert.ok(text.includes('263'), 'quotes 263 pairs');
  }
  assert.ok(html.includes('126'), 'html quotes 126 silent third-position changes');
  assert.ok(readme.includes('134'), 'readme quotes 134 synonymous');
  assert.ok(readme.includes('4.88') && readme.includes('10.56') && readme.includes('0.14'), 'readme quotes the by-position scores');
  assert.ok(readme.includes('a random code averages 9.31 on the INS codons') && !/averages 9\.35/.test(readme), 'readme quotes the random-code INS expectation 9.31');
});

test('citation fixes from the independent review stay fixed', () => {
  const here = new URL('.', import.meta.url);
  const readme = fs.readFileSync(new URL('README.md', here), 'utf8');
  const html = fs.readFileSync(new URL('index.html', here), 'utf8');
  for (const text of [readme, html]) {
    assert.ok(!/Mamlouk AM|Geyer &(amp;)? Mamlouk/.test(text), 'second author is Madany Mamlouk');
    assert.ok(!/robust for hydropathy and molecular volume|robust for polar requirement, hydropathy and molecular volume/.test(text), 'no unsupported volume claim');
  }
  assert.ok(html.includes('Madany Mamlouk A (2018)'));
  assert.ok(html.includes('Crick FHC (1968)') && html.includes('Massey SE (2008)') && html.includes('Novozhilov AS'), 'origin positions are cited on the page');
  assert.ok(html.includes('Buhrman') && html.includes('Goldman N (1993)'), 'the proven optimum is cited');
  assert.ok(!readme.includes('114 of 10'), 'Geyer & Madany Mamlouk found 124, not 114');
  assert.ok(readme.includes('124'));
  assert.ok(readme.includes('Codon usage bias and mutation constraints reduce the level of error minimization of the genetic code'), 'Archetti 2004 title');
});
