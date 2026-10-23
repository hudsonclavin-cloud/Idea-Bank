/*
 * code.js: the pure model behind "The Forgiving Code".
 *
 * The standard genetic code, two amino-acid property scales, every single-base
 * substitution between sense codons, the Haig & Hurst (1991) mean-squared-change
 * score and its Freeland & Hurst (1998) mistranslation-weighted version, random
 * codes drawn the way those papers drew them, a local search for better codes,
 * translation of real coding sequences, and a point-mutation generator.
 *
 * No DOM access here. Loads as a classic browser script (exposes window.Code) and
 * under Node (module.exports), so the page and the tests share one source.
 *
 * Sources for every constant are listed next to it and in README.md.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.Code = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ---------------------------------------------------------------- the code
  const BASES = ['U', 'C', 'A', 'G'];
  const PURINE = { A: true, G: true, U: false, C: false };

  // Standard code (NCBI translation table 1), codons listed with the first base
  // slowest and the third fastest, bases in U C A G order. '*' is a stop codon.
  const STANDARD_STRING = 'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG';

  const CODONS = [];
  for (const a of BASES) for (const b of BASES) for (const c of BASES) CODONS.push(a + b + c);

  const STANDARD = {};
  CODONS.forEach((codon, i) => { STANDARD[codon] = STANDARD_STRING[i]; });

  // One-letter code, three-letter code, name, polar requirement, hydropathy.
  // Polar requirement: Woese, Dugre, Dugre, Kondo & Saxinger (1966), Cold Spring
  //   Harbor Symp. Quant. Biol. 31:723-736, the values as used by Haig & Hurst
  //   (1991) and Freeland & Hurst (1998) and reprinted in Table 1 of Geyer &
  //   Mamlouk (2018), PeerJ 6:e4825.
  // Hydropathy: Kyte & Doolittle (1982), J. Mol. Biol. 157:105-132.
  const AMINO = [
    ['A', 'Ala', 'Alanine', 7.0, 1.8],
    ['R', 'Arg', 'Arginine', 9.1, -4.5],
    ['N', 'Asn', 'Asparagine', 10.0, -3.5],
    ['D', 'Asp', 'Aspartic acid', 13.0, -3.5],
    ['C', 'Cys', 'Cysteine', 4.8, 2.5],
    ['Q', 'Gln', 'Glutamine', 8.6, -3.5],
    ['E', 'Glu', 'Glutamic acid', 12.5, -3.5],
    ['G', 'Gly', 'Glycine', 7.9, -0.4],
    ['H', 'His', 'Histidine', 8.4, -3.2],
    ['I', 'Ile', 'Isoleucine', 4.9, 4.5],
    ['L', 'Leu', 'Leucine', 4.9, 3.8],
    ['K', 'Lys', 'Lysine', 10.1, -3.9],
    ['M', 'Met', 'Methionine', 5.3, 1.9],
    ['F', 'Phe', 'Phenylalanine', 5.0, 2.8],
    ['P', 'Pro', 'Proline', 6.6, -1.6],
    ['S', 'Ser', 'Serine', 7.5, -0.8],
    ['T', 'Thr', 'Threonine', 6.6, -0.7],
    ['W', 'Trp', 'Tryptophan', 5.2, -0.9],
    ['Y', 'Tyr', 'Tyrosine', 5.4, -1.3],
    ['V', 'Val', 'Valine', 5.6, 4.2],
  ].map(([one, three, name, pr, kd]) => ({ one, three, name, pr, kd }));

  const AMINO_BY_LETTER = {};
  AMINO.forEach((a) => { AMINO_BY_LETTER[a.one] = a; });
  const LETTERS = AMINO.map((a) => a.one);

  const PROPERTIES = {
    pr: {
      key: 'pr',
      name: 'polar requirement',
      short: 'PR',
      source: 'Woese et al. 1966',
      min: 4.8,
      max: 13.0,
      hydrophobicIsLow: true,
      value: (letter) => AMINO_BY_LETTER[letter].pr,
    },
    kd: {
      key: 'kd',
      name: 'hydropathy',
      short: 'KD',
      source: 'Kyte & Doolittle 1982',
      min: -4.5,
      max: 4.5,
      hydrophobicIsLow: false,
      value: (letter) => AMINO_BY_LETTER[letter].kd,
    },
  };

  function propertyArray(prop) {
    const p = typeof prop === 'string' ? PROPERTIES[prop] : prop;
    return LETTERS.map((l) => p.value(l));
  }

  // The 20 "blocks" of synonymous codons of the standard code, one per amino
  // acid, in LETTERS order. Serine, leucine and arginine each own six codons.
  const BLOCKS = LETTERS.map((l) => CODONS.filter((c) => STANDARD[c] === l));
  const BLOCK_OF = {}; // codon -> block index (sense codons only)
  BLOCKS.forEach((codons, i) => codons.forEach((c) => { BLOCK_OF[c] = i; }));
  const SENSE = CODONS.filter((c) => STANDARD[c] !== '*');
  const STOPS = CODONS.filter((c) => STANDARD[c] === '*');

  /** A code is a codon -> letter map. A permutation lists, for each block, the amino acid it gets. */
  function codeFromPerm(perm) {
    const code = {};
    for (const c of CODONS) code[c] = STANDARD[c] === '*' ? '*' : perm[BLOCK_OF[c]];
    return code;
  }
  const IDENTITY = LETTERS.slice();

  // ----------------------------------------------------------- substitutions
  // Every ordered single-base substitution from a sense codon to a sense codon.
  // Stop codons are fixed in every code considered here, so this list is the
  // same for all of them. There are 526 (263 unordered pairs; Haig & Hurst 1991).
  const SUBSTITUTIONS = [];
  for (const from of SENSE) {
    for (let pos = 0; pos < 3; pos++) {
      for (const b of BASES) {
        if (b === from[pos]) continue;
        const to = from.slice(0, pos) + b + from.slice(pos + 1);
        if (STANDARD[to] === '*') continue;
        const transition = PURINE[b] === PURINE[from[pos]];
        SUBSTITUTIONS.push({ from, to, pos, transition, synonymous: BLOCK_OF[from] === BLOCK_OF[to] });
      }
    }
  }

  // Weighting schemes. 'uniform' is Haig & Hurst (1991): every substitution counts
  // once. 'fh' is Freeland & Hurst (1998): relative mistranslation weights by codon
  // position for transitions and transversions, as tabulated in Geyer & Mamlouk
  // (2018), Table 2 (combined weightings psi_S and psi_V).
  const SCHEMES = {
    uniform: { key: 'uniform', name: 'all errors equal', ts: [1, 1, 1], tv: [1, 1, 1] },
    fh: { key: 'fh', name: 'mistranslation-weighted', ts: [1, 0.5, 1], tv: [0.5, 0.1, 1] },
  };
  function weightOf(scheme, sub) {
    const s = typeof scheme === 'string' ? SCHEMES[scheme] : scheme;
    return (sub.transition ? s.ts : s.tv)[sub.pos];
  }

  /**
   * Mean squared change of a property across single-base substitutions, weighted
   * by the scheme: sum(w * d^2) / sum(w). With the uniform scheme and polar
   * requirement this is MS0 of Haig & Hurst (1991). `positions` restricts the sum
   * to those codon positions (0-based) to get MS1, MS2, MS3.
   */
  function scoreCode(code, prop, scheme, positions) {
    const p = typeof prop === 'string' ? PROPERTIES[prop] : prop;
    let num = 0, den = 0;
    for (const sub of SUBSTITUTIONS) {
      if (positions && !positions.includes(sub.pos)) continue;
      const w = weightOf(scheme || 'uniform', sub);
      const d = p.value(code[sub.from]) - p.value(code[sub.to]);
      num += w * d * d;
      den += w;
    }
    return num / den;
  }

  // Fast path: because stop codons are fixed, every code is a permutation of amino
  // acids over the 20 blocks, and the score depends only on the total weight
  // connecting each pair of blocks. Precompute that once per scheme.
  const pairCache = {};
  function blockPairs(scheme, positions) {
    const key = (typeof scheme === 'string' ? scheme : scheme.key) + '|' + (positions ? positions.join('') : '');
    if (pairCache[key]) return pairCache[key];
    const acc = new Map();
    let total = 0;
    for (const sub of SUBSTITUTIONS) {
      if (positions && !positions.includes(sub.pos)) continue;
      const w = weightOf(scheme, sub);
      total += w;
      if (sub.synonymous) continue; // contributes 0 under every permutation
      const i = BLOCK_OF[sub.from], j = BLOCK_OF[sub.to];
      const k = i < j ? i * 20 + j : j * 20 + i;
      acc.set(k, (acc.get(k) || 0) + w);
    }
    const n = acc.size;
    const I = new Int32Array(n), J = new Int32Array(n), W = new Float64Array(n);
    let t = 0;
    for (const [k, w] of acc) { I[t] = Math.floor(k / 20); J[t] = k % 20; W[t] = w; t++; }
    const out = { I, J, W, total, n };
    pairCache[key] = out;
    return out;
  }

  /** Score an index permutation (block b gets amino acid LETTERS[idx[b]]) against precomputed pairs. */
  function scoreIdx(idx, propValues, pairs) {
    const { I, J, W, total, n } = pairs;
    let s = 0;
    for (let t = 0; t < n; t++) { const d = propValues[idx[I[t]]] - propValues[idx[J[t]]]; s += W[t] * d * d; }
    return s / total;
  }

  /** Same score as scoreCode(codeFromPerm(perm), ...) but much faster. */
  function scorePerm(perm, propValues, scheme, positions) {
    const idx = new Int32Array(20);
    for (let b = 0; b < 20; b++) idx[b] = LETTERS.indexOf(perm[b]);
    return scoreIdx(idx, propValues, blockPairs(scheme || 'uniform', positions));
  }

  // ------------------------------------------------------------- randomness
  /** Mulberry32: a small seeded PRNG (Tommy Ettinger), returns floats in [0, 1). */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** A uniformly random permutation of the 20 amino acids over the 20 blocks (Fisher-Yates). */
  function randomPerm(rng) {
    const p = LETTERS.slice();
    for (let i = p.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    return p;
  }

  /**
   * Score `n` random codes. Returns the scores (Float64Array), the standard code's
   * score, how many random codes scored strictly lower, and the mean and SD.
   */
  function sampleCodes(n, prop, scheme, rng, onProgress) {
    const pv = propertyArray(prop);
    const pairs = blockPairs(scheme || 'uniform');
    const standard = scorePerm(IDENTITY, pv, scheme);
    const scores = new Float64Array(n);
    const idx = new Int32Array(20);
    let better = 0, sum = 0, sum2 = 0;
    for (let i = 0; i < n; i++) {
      for (let b = 0; b < 20; b++) idx[b] = b;
      for (let b = 19; b > 0; b--) { const j = Math.floor(rng() * (b + 1)); const t = idx[b]; idx[b] = idx[j]; idx[j] = t; }
      const s = scoreIdx(idx, pv, pairs);
      scores[i] = s;
      if (s < standard) better++;
      sum += s; sum2 += s * s;
      if (onProgress && (i & 0x3fff) === 0) onProgress(i, n);
    }
    const mean = sum / n;
    const sd = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
    return { scores, standard, better, n, mean, sd };
  }

  /**
   * Simulated annealing over amino-acid swaps, to show how much better than the
   * standard code a code can be. Returns the best permutation and score found.
   */
  function searchBetter(prop, scheme, rng, opts) {
    const o = Object.assign({ steps: 20000, t0: 1.0, t1: 0.002, start: null, onStep: null }, opts || {});
    const pv = propertyArray(prop);
    let perm = o.start ? o.start.slice() : randomPerm(rng);
    let cur = scorePerm(perm, pv, scheme);
    let best = perm.slice(), bestScore = cur;
    for (let k = 0; k < o.steps; k++) {
      const T = o.t0 * Math.pow(o.t1 / o.t0, k / o.steps);
      const i = Math.floor(rng() * 20);
      let j = Math.floor(rng() * 19); if (j >= i) j++;
      const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
      const s = scorePerm(perm, pv, scheme);
      if (s <= cur || rng() < Math.exp((cur - s) / T)) {
        cur = s;
        if (s < bestScore) { bestScore = s; best = perm.slice(); }
      } else {
        perm[j] = perm[i]; perm[i] = t;
      }
      if (o.onStep) o.onStep(k, perm, cur);
    }
    return { perm: best, score: bestScore };
  }

  // ------------------------------------------------------------ translation
  function toRNA(seq) {
    return String(seq).toUpperCase().replace(/[^ACGTU]/g, '').replace(/T/g, 'U');
  }
  function codonsOf(seq) {
    const rna = toRNA(seq);
    const out = [];
    for (let i = 0; i + 3 <= rna.length; i += 3) out.push(rna.slice(i, i + 3));
    return out;
  }
  /** Translate codons with a code until the first stop; returns the one-letter string. */
  function translate(codons, code) {
    const c = typeof codons === 'string' ? codonsOf(codons) : codons;
    let out = '';
    for (const codon of c) {
      const aa = (code || STANDARD)[codon];
      if (aa === '*') break;
      out += aa;
    }
    return out;
  }

  // Real human coding sequences, from NCBI RefSeq (fetched 2026-10-22 with efetch,
  // rettype=fasta_cds_na). Protein translations come from NP_000198.1 / NP_000509.1
  // and are checked against our own translation in the tests.
  const GENES = [
    {
      key: 'ins',
      gene: 'INS',
      name: 'human insulin (preproinsulin)',
      accession: 'NM_000207.3',
      proteinAccession: 'NP_000198.1',
      cds: 'ATGGCCCTGTGGATGCGCCTCCTGCCCCTGCTGGCGCTGCTGGCCCTCTGGGGACCTGACCCAGCCGCAGCCTTTGTGAACCAACACCTGTGCGGCTCACACCTGGTGGAAGCTCTCTACCTAGTGTGCGGGGAACGAGGCTTCTTCTACACACCCAAGACCCGCCGGGAGGCAGAGGACCTGCAGGTGGGGCAGGTGGAGCTGGGCGGGGGCCCTGGTGCAGGCAGCCTGCAGCCCTTGGCCCTGGAGGGGTCCCTGCAGAAGCGTGGCATTGTGGAACAATGCTGTACCAGCATCTGCTCCCTCTACCAGCTGGAGAACTACTGCAACTAG',
      protein: 'MALWMRLLPLLALLALWGPDPAAAFVNQHLCGSHLVEALYLVCGERGFFYTPKTRREAEDLQVGQVELGGGPGAGSLQPLALEGSLQKRGIVEQCCTSICSLYQLENYCN',
    },
    {
      key: 'hbb',
      gene: 'HBB',
      name: 'human β-globin',
      accession: 'NM_000518.5',
      proteinAccession: 'NP_000509.1',
      cds: 'ATGGTGCATCTGACTCCTGAGGAGAAGTCTGCCGTTACTGCCCTGTGGGGCAAGGTGAACGTGGATGAAGTTGGTGGTGAGGCCCTGGGCAGGCTGCTGGTGGTCTACCCTTGGACCCAGAGGTTCTTTGAGTCCTTTGGGGATCTGTCCACTCCTGATGCTGTTATGGGCAACCCTAAGGTGAAGGCTCATGGCAAGAAAGTGCTCGGTGCCTTTAGTGATGGCCTGGCTCACCTGGACAACCTCAAGGGCACCTTTGCCACACTGAGTGAGCTGCACTGTGACAAGCTGCACGTGGATCCTGAGAACTTCAGGCTCCTGGGCAACGTGCTGGTCTGTGTGCTGGCCCATCACTTTGGCAAAGAATTCACCCCACCAGTGCAGGCTGCCTATCAGAAAGTGGTGGCTGGTGTGGCTAATGCCCTGGCCCACAAGTATCACTAA',
      protein: 'MVHLTPEEKSAVTALWGKVNVDEVGGEALGRLLVVYPWTQRFFESFGDLSTPDAVMGNPKVKAHGKKVLGAFSDGLAHLDNLKGTFATLSELHCDKLHVDPENFRLLGNVLVCVLAHHFGKEFTPPVQAAYQKVVAGVANALAHKYH',
      // The sickle-cell mutation HBB c.20A>T: codon 7 of the CDS (beta-6 in mature-protein
      // numbering, which drops the initiator methionine) GAG -> GUG, Glu -> Val.
      landmark: { codonIndex: 6, pos: 1, base: 'U', label: 'sickle-cell mutation (HbS), Glu→Val' },
    },
  ];

  // --------------------------------------------------------------- mutation
  /**
   * Draw one random single-base substitution in a list of codons. Only sense
   * codons (under the standard code, i.e. under every code here) are hit, since
   * the point is what the code does with an error in a coding codon. Neighbours
   * are drawn in proportion to the scheme's weights (uniform: each of the 9
   * neighbours equally). With allowStop === false (the page's storm), neighbours
   * that are stop codons are skipped, matching the score, which leaves them out.
   */
  function drawMutation(codons, scheme, rng, allowStop) {
    const live = [];
    codons.forEach((c, i) => { if (STANDARD[c] !== '*') live.push(i); });
    if (!live.length) return null;
    const index = live[Math.floor(rng() * live.length)];
    const from = codons[index];
    const options = [];
    let total = 0;
    for (let pos = 0; pos < 3; pos++) {
      for (const b of BASES) {
        if (b === from[pos]) continue;
        if (allowStop === false && STANDARD[from.slice(0, pos) + b + from.slice(pos + 1)] === '*') continue;
        const w = weightOf(scheme, { pos, transition: PURINE[b] === PURINE[from[pos]] });
        options.push({ pos, base: b, w });
        total += w;
      }
    }
    let r = rng() * total;
    for (const o of options) {
      r -= o.w;
      if (r <= 0) return { index, pos: o.pos, base: o.base, from, to: from.slice(0, o.pos) + o.base + from.slice(o.pos + 1) };
    }
    const o = options[options.length - 1];
    return { index, pos: o.pos, base: o.base, from, to: from.slice(0, o.pos) + o.base + from.slice(o.pos + 1) };
  }

  /** Classify what a substitution does under a code. */
  function effect(code, from, to, prop) {
    const a = code[from], b = code[to];
    if (a === '*') return { kind: 'readthrough', a, b, delta: 0 };
    if (b === '*') return { kind: 'nonsense', a, b, delta: 0 };
    if (a === b) return { kind: 'silent', a, b, delta: 0 };
    const p = typeof prop === 'string' ? PROPERTIES[prop] : prop;
    return { kind: 'missense', a, b, delta: p.value(b) - p.value(a) };
  }

  // ------------------------------------------------------------- statistics
  /** Counts over the 526 substitutions of the standard code, by position and kind. */
  function substitutionStats() {
    const byPos = [0, 1, 2].map(() => ({ total: 0, synonymous: 0, transitions: 0 }));
    let synonymous = 0;
    for (const s of SUBSTITUTIONS) {
      byPos[s.pos].total++;
      if (s.synonymous) { synonymous++; byPos[s.pos].synonymous++; }
      if (s.transition) byPos[s.pos].transitions++;
    }
    // Sense -> stop substitutions, for the README; not part of SUBSTITUTIONS.
    let toStop = 0;
    for (const from of SENSE) for (let pos = 0; pos < 3; pos++) for (const b of BASES) {
      if (b === from[pos]) continue;
      if (STANDARD[from.slice(0, pos) + b + from.slice(pos + 1)] === '*') toStop++;
    }
    return { total: SUBSTITUTIONS.length, synonymous, toStop, byPos };
  }

  /**
   * Expected squared property change per typo for a particular list of codons,
   * the way the storm draws typos: a sense codon uniformly, then one of its
   * non-stop neighbours with the scheme's weights. Differs from scoreCode because
   * real genes use codons unequally (codon usage).
   */
  function geneScore(codons, code, prop, scheme) {
    const p = typeof prop === 'string' ? PROPERTIES[prop] : prop;
    let sum = 0, n = 0;
    for (const from of codons) {
      if (STANDARD[from] === '*') continue;
      let num = 0, den = 0;
      for (let pos = 0; pos < 3; pos++) for (const b of BASES) {
        if (b === from[pos]) continue;
        const to = from.slice(0, pos) + b + from.slice(pos + 1);
        if (STANDARD[to] === '*') continue;
        const w = weightOf(scheme || 'uniform', { pos, transition: PURINE[b] === PURINE[from[pos]] });
        const d = p.value(code[from]) - p.value(code[to]);
        num += w * d * d;
        den += w;
      }
      sum += num / den;
      n++;
    }
    return n ? sum / n : 0;
  }

  /** The largest single-step property jump a code allows, and where. */
  function worstStep(code, prop) {
    const p = typeof prop === 'string' ? PROPERTIES[prop] : prop;
    let worst = null;
    for (const s of SUBSTITUTIONS) {
      const d = Math.abs(p.value(code[s.from]) - p.value(code[s.to]));
      if (!worst || d > worst.d) worst = { d, from: s.from, to: s.to, a: code[s.from], b: code[s.to], pos: s.pos };
    }
    return worst;
  }

  return {
    BASES, CODONS, STANDARD, STANDARD_STRING, AMINO, AMINO_BY_LETTER, LETTERS, PROPERTIES, BLOCKS, BLOCK_OF,
    SENSE, STOPS, SUBSTITUTIONS, SCHEMES, IDENTITY, GENES,
    propertyArray, codeFromPerm, weightOf, scoreCode, blockPairs, scorePerm, scoreIdx,
    mulberry32, randomPerm, sampleCodes, searchBetter,
    toRNA, codonsOf, translate, drawMutation, effect, substitutionStats, worstStep, geneScore,
  };
});
