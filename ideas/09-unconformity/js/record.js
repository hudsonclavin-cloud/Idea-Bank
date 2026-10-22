/* Unconformity — the written record. Turns a history into dated, plain-language entries, and
   lists only what the rocks in this particular section actually show: an event that left no
   visible trace is counted, not described. */
(function (G) {
  'use strict';
  const UNC = G.UNC;
  const { LI, LNAME, PERIODS, T_SEQ } = UNC;

  const SHORT = {
    shelf: 'limestone and shale', delta: 'coal measures', redbeds: 'river sandstones', deep: 'greywacke turbidites',
    chalk: 'chalk', evap: 'gypsum and marl', volc: 'lavas and ash', alluv: 'river gravels',
  };
  const BASE_NAME = { 20: 'granite', 21: 'gneiss', 22: 'schist' };

  function fmtMa(a) {
    if (a < 0.02) return 'c. 10,000 years ago';
    if (a < 2) return 'c. ' + (Math.round(a * 10) / 10).toLocaleString('en-US') + ' million years ago';
    return 'c. ' + Math.round(a).toLocaleString('en-US') + ' Ma';
  }
  function side(dx) {
    return dx > 0 ? 'east' : 'west';
  }
  function list(arr) {
    if (arr.length <= 1) return arr.join('');
    return arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1];
  }
  function metres(w, km) {
    const m = w * km * 1000;
    if (m >= 1000) return (Math.round(m / 100) / 10).toLocaleString('en-US') + ' km';
    if (m >= 100) return Math.round(m / 10) * 10 + ' m';
    return Math.max(5, Math.round(m / 5) * 5) + ' m';
  }

  function describe(H) {
    const rng = UNC.makeRng('record|' + H.seed);
    const km = { siccar: [1.2, 3], canyon: [3, 8], foldbelt: [5, 12], rift: [6, 14], igneous: [3, 8], basin: [1, 4] }[H.arch];
    H.km = Math.round(rng.range(km[0], km[1]) * 10) / 10;

    // ---- ages ----
    const steps = H.steps;
    const seqSteps = steps.filter((s) => s.k === 'seq');
    for (const s of seqSteps) {
      const p = PERIODS[s.seq.period];
      const len = p[1] - p[2];
      s.a = p[1] - len * rng.range(0.02, 0.3);
      s.b = p[2] + len * rng.range(0.08, 0.4);
      if (s.seq.alluvium) {
        s.a = rng.range(0.8, 2.2);
        s.b = 0.01;
      }
    }
    // events between sequences get evenly spaced ages in the gap
    let i = 0;
    while (i < steps.length) {
      if (steps[i].k === 'basement') {
        steps[i].age = Math.round(rng.range(950, 2700) / 10) * 10;
        i++;
        continue;
      }
      if (steps[i].k === 'seq') {
        i++;
        continue;
      }
      let j = i;
      while (j < steps.length && steps[j].k !== 'seq') j++;
      let prev = null;
      for (let q = i - 1; q >= 0; q--) if (steps[q].k === 'seq') { prev = steps[q]; break; }
      const next = j < steps.length ? steps[j] : null;
      const hi = prev ? prev.b : (H.basement ? steps[0].age * 0.9 : 1000);
      const lo = next ? next.a : Math.min(hi * 0.5, rng.range(5, 40));
      const n = j - i;
      for (let q = 0; q < n; q++) steps[i + q].age = hi - ((q + 1) / (n + 1)) * (hi - lo);
      i = j;
    }

    // ---- entries ----
    const rec = [];
    const silent = [];
    const visible = (e) => !!H.hits[e.idx];
    let anyOlderVisible = !!(H.basement && H.hits[H.events.length]);
    let lastAge = 4000; // keeps the dates monotonic

    for (const s of steps) {
      lastAge = Math.min(lastAge, s.k === 'seq' ? lastAge : s.age);
      if (s.k === 'basement') {
        if (!H.hits[H.events.length]) {
          silent.push('basement');
          continue;
        }
        const nm = BASE_NAME[s.lith];
        rec.push({
          age: fmtMa(s.age), kind: 'basement',
          title: nm[0].toUpperCase() + nm.slice(1) + ' basement',
          text: s.lith === LI.GRANITE
            ? 'Granite that crystallised deep underground — the oldest rock in the section, shown by its crosses.'
            : 'Older rock squeezed and recrystallised deep inside a vanished mountain range; its wavy bands are the scars.',
        });
        continue;
      }
      if (s.k === 'seq') {
        const sq = s.seq;
        const e = sq.ev;
        const fr = H.seqFrac[sq.ev.seqIndex];
        if (fr < 0.002) {
          silent.push('sequence');
          continue;
        }
        if (sq.unconf || sq.onBasement) {
          let t, title;
          if (sq.onBasement) {
            title = 'Erosion of the basement';
            t = 'The basement was worn down to a surface and new sediment spread across it. Where layered rock rests on crystalline rock the gap is called a nonconformity.';
          } else if (sq.unconf === 'disconformity') {
            title = 'A pause in the record';
            t = 'Deposition stopped; the surface was lifted and gently eroded, then sediment returned. The gap — a disconformity — is almost parallel to the beds.';
          } else {
            title = 'Uplift and erosion';
            t = 'Everything below was lifted, worn away and planed off. New layers then settled across the cut edges: an angular unconformity, the gap in time this piece is named after.';
          }
          rec.push({ age: fmtMa(s.a + Math.max(0.5, (lastAge - s.a) * 0.4)), kind: 'unconf', title, text: t });
        }
        // which lithologies dominate the visible part
        const area = {};
        let beds = 0;
        for (let k = 0; k < e.nb; k++) {
          const f = H.unitFrac[e.bunit[k]];
          if (f > 0.0004) beds++;
          let l = e.lith[k];
          if (l === LI.SSTX) l = LI.SST;
          area[l] = (area[l] || 0) + f;
        }
        const top = Object.keys(area).map(Number).filter((l) => area[l] > 0.002).sort((a, b) => area[b] - area[a]).slice(0, 3).map((l) => LNAME[l]);
        const lensSeen = e.lens.filter((L) => H.unitFrac[L.unit] > 0.0004).length;
        if (sq.alluvium) {
          rec.push({ age: fmtMa(s.a), kind: 'seq', title: 'River gravels', text: 'A river cut down into the rocks and then partly filled its own valley with gravel and sand.' });
        } else {
          const per = PERIODS[sq.period][0];
          rec.push({
            age: 'c. ' + Math.round(s.a).toLocaleString('en-US') + '–' + Math.round(s.b).toLocaleString('en-US') + ' Ma',
            kind: 'seq',
            title: per + ' ' + (SHORT[sq.env.name] || 'strata'),
            text: (beds > 1 ? beds + ' layers show, mostly ' : 'Mostly ') + list(top) + ', ' + sq.env.desc + '.' + (lensSeen ? ' ' + (lensSeen === 1 ? 'A buried river channel cuts' : lensSeen + ' buried river channels cut') + ' into the muds.' : ''),
          });
        }
        anyOlderVisible = true;
        lastAge = s.b;
        continue;
      }
      const e = s.ev;
      if (s.k === 'fold') {
        if (!anyOlderVisible) { silent.push('fold'); continue; }
        const d = s.dip / (Math.PI / 180);
        const tight = d < 18 ? 'gentle' : d < 40 ? 'open' : d < 65 ? 'tight' : 'very tight';
        const td = Math.abs(s.tilt) / (Math.PI / 180);
        const att = td < 8 ? 'upright' : td < 25 ? 'inclined' : 'overturned';
        const shape = s.chev > 0.5 ? 'sharp-hinged chevron' : 'rounded';
        rec.push({
          age: fmtMa(s.age), kind: 'fold',
          title: s.local ? 'A train of small folds' : 'Folding',
          text: s.local
            ? 'A local crumple of small ' + tight + ' folds, riding on the larger structure.'
            : 'Sideways squeezing buckled the layers into ' + tight + ', ' + att + ', ' + shape + ' folds, about ' + metres(s.lam, H.km) + ' from crest to crest.',
        });
        continue;
      }
      if (s.k === 'tilt') {
        if (!anyOlderVisible) { silent.push('tilt'); continue; }
        const a = s.angle / (Math.PI / 180);
        rec.push({ age: fmtMa(s.age), kind: 'tilt', title: 'Tilting', text: 'The whole pile was tipped about ' + Math.max(1, Math.round(Math.abs(a))) + '° down to the ' + (a > 0 ? 'west' : 'east') + '.' });
        continue;
      }
      if (s.k === 'fault') {
        if (!visible(e)) { silent.push('fault'); continue; }
        const d = Math.round(s.dip / (Math.PI / 180));
        const throwW = s.slip * Math.sin(s.dip);
        const sd = side(s.dipDir);
        let title, text;
        if (s.sense === 'normal') {
          title = 'Normal fault';
          text = 'The crust stretched and broke along a plane dipping ' + d + '° to the ' + sd + '; the ' + sd + ' side slid down about ' + metres(throwW, H.km) + '.';
        } else if (s.thrust) {
          title = 'Thrust fault';
          text = 'Compression drove a slab of rock up and over its neighbour along a ' + d + '° ramp, about ' + metres(s.slip, H.km) + ' of movement.';
        } else {
          title = 'Reverse fault';
          text = 'Squeezing pushed the ' + sd + ' side up about ' + metres(throwW, H.km) + ' along a plane dipping ' + d + '°.';
        }
        rec.push({ age: fmtMa(s.age), kind: 'fault', title, text });
        continue;
      }
      if (s.k === 'dyke') {
        if (!visible(e)) { silent.push('dyke'); continue; }
        rec.push({ age: fmtMa(s.age), kind: 'ign', title: 'Dolerite dyke', text: 'Molten rock forced its way up a crack, cutting ' + (s.late ? 'every older layer' : 'the rocks then in place') + ' and cooling into columns that lie across the wall.' });
        continue;
      }
      if (s.k === 'sill') {
        if (!visible(e)) { silent.push('sill'); continue; }
        rec.push({ age: fmtMa(s.age), kind: 'ign', title: 'Dolerite sill', text: 'Magma squeezed sideways between the layers and froze there as a sheet.' });
        continue;
      }
      if (s.k === 'pluton') {
        if (!visible(e)) { silent.push('pluton'); continue; }
        rec.push({ age: fmtMa(s.age), kind: 'ign', title: 'Granite pluton', text: 'A body of granite magma rose from below and cooled slowly. Its heat baked the rocks around it into spotted hornfels — the darkened halo along its roof.' });
        continue;
      }
    }
    const L = H.land;
    rec.push({
      age: 'Today', kind: 'land', title: 'The present surface',
      text: 'Rain, rivers and frost have carved the skyline' + (H.sea ? ', and the sea now covers the ' + (L.coast > 0 ? 'east' : 'west') + ' end of the section' : '') + '. Section about ' + H.km.toLocaleString('en-US') + ' km across; vertical scale equals horizontal.',
    });
    H.record = rec;
    H.silent = silent;

    // ---- titles ----
    const mainSeqs = H.seqs.filter((s) => !s.alluvium);
    const nm = (s) => (s ? SHORT[s.env.name] : '');
    const vis = (s) => s && H.seqFrac[s.ev.seqIndex] > 0.01;
    const hasPluton = H.events.some((e) => e.type === UNC.T_PLUTON && H.hits[e.idx]);
    const dykes = H.events.filter((e) => e.type === UNC.T_DYKE && H.hits[e.idx]).length;
    const faults = H.events.filter((e) => e.type === UNC.T_FAULT && H.hits[e.idx]).length;
    let title;
    switch (H.arch) {
      case 'siccar':
        title = vis(mainSeqs[1]) ? 'Folded ' + nm(mainSeqs[0]) + ' beneath ' + nm(mainSeqs[1]) : 'Folded ' + nm(mainSeqs[0]);
        break;
      case 'canyon':
        title = (BASE_NAME[H.basement.lith] || 'Basement') + ', tilted ' + nm(mainSeqs[0]) + ' and level ' + nm(mainSeqs[1]);
        title = title[0].toUpperCase() + title.slice(1);
        break;
      case 'foldbelt':
        title = 'Thrusts and folds in ' + nm(mainSeqs[0]);
        break;
      case 'rift':
        title = 'Tilted fault blocks under ' + nm(mainSeqs[1]);
        break;
      case 'igneous':
        title = hasPluton ? 'A granite pluton' + (dykes ? ' and its dykes' : '') + ' under ' + nm(mainSeqs[1]) : 'Dykes beneath ' + nm(mainSeqs[1]);
        break;
      default:
        title = (faults > 1 ? 'Faulted ' : 'Gently faulted ') + nm(mainSeqs[mainSeqs.length - 1] || mainSeqs[0]);
    }
    H.title = title;
  }

  UNC.describe = describe;
})(typeof window !== 'undefined' ? window : globalThis);
