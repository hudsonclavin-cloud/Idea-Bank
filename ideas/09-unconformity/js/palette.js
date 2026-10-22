/* Unconformity — colouring. Like a hand-tinted survey plate: colour mostly says *when* a rock
   formed (one hue family per sequence), the ink pattern says *what* it is. Each tint is stored as
   a multiplier on the paper so it glazes over it like a watercolour wash. */
(function (G) {
  'use strict';
  const UNC = G.UNC;
  const { LI, hexToRgb, shade, hash1 } = UNC;

  const PALETTES = {
    survey: {
      name: 'Survey', paper: [237, 228, 207], ink: [43, 33, 25], alpha: 0.8,
      families: ['#cfa058', '#b86a46', '#7d93a3', '#97a46c', '#c07e80', '#957659', '#6a87a0', '#d6b452', '#8f8c58', '#b08a6a'],
      basement: ['#a69eaa', '#b3a08f', '#9ea3a2'], granite: '#d49c93', dolerite: '#5f7466', basalt: '#74636f',
      water: '#a4bcc6', soil: '#7a6450', alluv: '#d2be98', sky: '#b7c8d0', skyA: 0.22,
    },
    painted: {
      name: 'Painted Hills', paper: [240, 231, 212], ink: [38, 30, 26], alpha: 0.9, perMember: true,
      families: ['#a8482f', '#d0a23e', '#5a544e', '#e2cfa6', '#cf8a6c', '#a59b62', '#7e5462', '#bb6d3b', '#8e9a8a'],
      basement: ['#6f6866', '#8a7f78'], granite: '#e3a78d', dolerite: '#3f4a46', basalt: '#6b5b60',
      water: '#9db6bd', soil: '#6e5845', alluv: '#d9c5a0', sky: '#e6c9a8', skyA: 0.3,
    },
    irongall: {
      name: 'Iron Gall', paper: [239, 231, 214], ink: [46, 31, 20], alpha: 0.66, mono: true,
      families: ['#93724f', '#86684c', '#9b7a55', '#7f6650'],
      basement: ['#6f5945'], granite: '#ab8d70', dolerite: '#4c3b2e', basalt: '#5a4636',
      water: '#bdb19b', soil: '#6e5844', alluv: '#c9b28e', sky: null, skyA: 0,
    },
    vermilion: {
      name: 'Vermilion', paper: [242, 238, 230], ink: [30, 28, 27], alpha: 0.72, mono: true,
      families: ['#8e8b86', '#858a8e', '#968d84', '#8a897f'],
      basement: ['#5f5c5a'], granite: '#da5a3c', dolerite: '#cc452b', basalt: '#77706b', marker: '#d14e30',
      water: '#b9c0c3', soil: '#5d5853', alluv: '#c4c0b6', sky: null, skyA: 0,
    },
    chart: {
      name: 'Chart', paper: [238, 230, 211], ink: [40, 32, 26], alpha: 0.78, byPeriod: true,
      // the international chronostratigraphic chart's period colours, softened for watercolour
      periods: ['#c98394', '#93ac72', '#4f9d86', '#a5ccab', '#cf9d62', '#7aab9f', '#dc7863', '#9c6aa5', '#62b0c4', '#97c272', '#eba676', '#e5cd5e', '#e8e09d'],
      families: ['#cfa058'],
      basement: ['#c98394'], granite: '#e2a0a6', dolerite: '#55705f', basalt: '#6a5a68',
      water: '#a4bcc6', soil: '#7a6450', alluv: '#e8e09d', sky: '#bccbd2', skyA: 0.18,
    },
  };
  const ORDER = ['survey', 'painted', 'irongall', 'vermilion', 'chart'];

  // lightness / saturation offsets by lithology
  const LOFF = {
    [LI.SST]: [0.06, -0.05], [LI.SSTX]: [0.07, -0.05], [LI.SH]: [-0.1, -0.12], [LI.SLT]: [-0.03, -0.06], [LI.LS]: [0.09, -0.28],
    [LI.DOL]: [0.04, -0.15], [LI.MRL]: [0.03, -0.22], [LI.CGL]: [-0.01, 0.06], [LI.CHK]: [0.24, -0.55], [LI.EVP]: [0.2, -0.4],
    [LI.TUFF]: [-0.05, -0.25], [LI.ALLUV]: [0.04, -0.1],
  };

  function choosePalette(seed) {
    const rng = UNC.makeRng('tint|' + seed);
    return rng.weighted([['survey', 34], ['painted', 20], ['irongall', 14], ['vermilion', 14], ['chart', 18]]);
  }

  // returns { pal, T: Float32Array(units*3) multipliers, A: Float32Array(units) wash strength }
  function colourise(H, palName) {
    const pal = PALETTES[palName] || PALETTES.survey;
    const rng = UNC.makeRng('colour|' + H.seed + '|' + palName);
    const n = H.units.length;
    const T = new Float32Array(n * 3);
    const A = new Float32Array(n);
    const paper = pal.paper;

    // a distinct family per sequence
    const fam = pal.families.slice();
    for (let i = fam.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      const t = fam[i]; fam[i] = fam[j]; fam[j] = t;
    }
    const seqFam = H.seqs.map((s, i) => {
      if (pal.byPeriod) return pal.periods[s.period] || fam[0];
      return fam[i % fam.length];
    });
    const baseCol = pal.basement[Math.floor(rng.next() * pal.basement.length)];
    const memberFam = {};
    const salt = rng.int(1, 999999);

    const set = (u, rgb, a) => {
      T[u * 3] = Math.min(1, rgb[0] / paper[0]);
      T[u * 3 + 1] = Math.min(1, rgb[1] / paper[1]);
      T[u * 3 + 2] = Math.min(1, rgb[2] / paper[2]);
      A[u] = a;
    };

    for (let u = 0; u < n; u++) {
      const U = H.units[u];
      const j = U.j == null ? 0.5 : U.j;
      let rgb;
      let a = pal.alpha;
      switch (U.kind) {
        case 'sky':
          a = 0;
          rgb = paper;
          break;
        case 'water':
          rgb = hexToRgb(pal.water);
          a = 0.55;
          break;
        case 'soil':
          rgb = hexToRgb(pal.soil);
          a = 0.75;
          break;
        case 'basement':
          rgb = shade(hexToRgb(baseCol), 0, 0, (j - 0.5) * 0.04);
          break;
        case 'pluton':
          rgb = hexToRgb(pal.granite);
          break;
        case 'dyke':
        case 'sill':
          rgb = shade(hexToRgb(pal.dolerite), 0, 0, (j - 0.5) * 0.06);
          a = Math.min(0.95, pal.alpha + 0.08);
          break;
        case 'alluv': {
          const off = LOFF[U.lith] || [0, 0];
          rgb = shade(hexToRgb(pal.alluv), (j - 0.5) * 0.02, off[1] * 0.5, off[0] * 0.4 + (j - 0.5) * 0.05);
          break;
        }
        default: {
          // beds and lenses
          if (U.lith === LI.COAL) {
            rgb = [58, 53, 49];
            a = 0.92;
            break;
          }
          if (U.lith === LI.LAVA) {
            rgb = shade(hexToRgb(pal.basalt), 0, 0, (j - 0.5) * 0.07);
            break;
          }
          let famHex = seqFam[U.seq];
          const mem = Math.floor(U.member);
          if (pal.perMember) {
            const key = U.seq + ':' + mem;
            if (!memberFam[key]) memberFam[key] = fam[Math.floor(hash1(mem * 7 + U.seq * 131, salt) * fam.length)];
            famHex = memberFam[key];
          }
          const off = LOFF[U.lith] || [0, 0];
          const mh = hash1(mem, U.seq * 17 + 5) - 0.5;
          const ml = hash1(mem, U.seq * 17 + 9) - 0.5;
          const mono = pal.mono ? 1.6 : 1;
          rgb = shade(hexToRgb(famHex), mh * 0.06 + (j - 0.5) * 0.016, off[1] + ml * 0.25, off[0] * mono + ml * 0.11 + (j - 0.5) * 0.045);
          if (pal.mono) a = pal.alpha * (0.85 + 0.3 * j);
        }
      }
      set(u, rgb, a);
    }
    // Vermilion keeps red for igneous rock. If none is exposed, pick out one thin marker bed in red,
    // the way a geologist inks a key horizon to make a fold or fault legible.
    if (pal.marker && H.unitFrac) {
      const ign = H.events.some((e) => (e.type === UNC.T_DYKE || e.type === UNC.T_SILL || e.type === UNC.T_PLUTON) && H.hits[e.idx]);
      if (!ign) {
        let best = -1, bestScore = 1e9;
        for (const sq of H.seqs) {
          if (sq.alluvium) continue;
          const e = sq.ev;
          for (let k = 1; k < e.nb; k++) {
            const f = H.unitFrac[e.bunit[k]];
            if (f < 0.004 || f > 0.04 || e.lith[k] === LI.COAL) continue;
            const sc = Math.abs(f - 0.014) + rng.next() * 0.006;
            if (sc < bestScore) { bestScore = sc; best = e.bunit[k]; }
          }
          if (best >= 0) break; // oldest visible sequence wins
        }
        if (best >= 0) set(best, hexToRgb(pal.marker), 0.85);
      }
    }
    return { pal, T, A, name: palName };
  }

  Object.assign(UNC, { PALETTES, PAL_ORDER: ORDER, choosePalette, colourise });
})(typeof window !== 'undefined' ? window : globalThis);
