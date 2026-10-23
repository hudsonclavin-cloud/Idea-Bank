/* app.js: the page for "The Forgiving Code". All model code is in code.js (window.Code). */
(function () {
  'use strict';
  const C = window.Code;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ------------------------------------------------------------------ state
  const state = {
    prop: 'pr',
    scheme: 'uniform',
    view: 'real',
    altPerm: null,
    altCode: null,
    samples: {}, // key prop|scheme -> {scores, better, n, standard, mean, sd, altScore}
    sampling: null,
    improving: null,
    focusCodon: null,
  };
  let seedCounter = (Date.now() >>> 0) || 1;
  const nextRng = () => C.mulberry32((seedCounter = (seedCounter * 1664525 + 1013904223) >>> 0));

  function shuffleAlt() {
    state.altPerm = C.randomPerm(nextRng());
    state.altCode = C.codeFromPerm(state.altPerm);
  }
  shuffleAlt();

  // ----------------------------------------------------------------- colour
  // OKLCH -> sRGB (Björn Ottosson's OKLab), so every tile has the same lightness and
  // only the hue carries the property. Out-of-gamut channels are clamped.
  function oklchToRgb(L, Cc, h) {
    const a = Cc * Math.cos((h * Math.PI) / 180), b = Cc * Math.sin((h * Math.PI) / 180);
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.291485548 * b;
    const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
    const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    const bb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
    const gam = (x) => { x = Math.max(0, Math.min(1, x)); return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055; };
    return [gam(r), gam(g), gam(bb)].map((v) => Math.round(v * 255));
  }
  const colourCache = {};
  function colourFor(t) {
    // t in [0,1]: 0 = most hydrophobic (amber), 1 = most polar (blue)
    const k = Math.round(t * 200);
    if (k in colourCache) return colourCache[k];
    const h = 72 + (k / 200) * (262 - 72);
    const [r, g, b] = oklchToRgb(0.78, 0.115, h);
    return (colourCache[k] = `rgb(${r},${g},${b})`);
  }
  function propT(letter) {
    const p = C.PROPERTIES[state.prop];
    let t = (p.value(letter) - p.min) / (p.max - p.min);
    if (!p.hydrophobicIsLow) t = 1 - t;
    return Math.max(0, Math.min(1, t));
  }
  const colourOf = (letter) => colourFor(propT(letter));

  // --------------------------------------------------------------- the table
  const tableEl = $('#code-table');
  const cellEls = {};
  function buildTable() {
    tableEl.innerHTML = '';
    tableEl.appendChild(Object.assign(document.createElement('div'), { className: 'hdr', textContent: '' }));
    for (const b of C.BASES) {
      const h = document.createElement('div');
      h.className = 'hdr';
      h.textContent = b;
      tableEl.appendChild(h);
    }
    for (const first of C.BASES) {
      const rh = document.createElement('div');
      rh.className = 'rowhdr';
      rh.textContent = first;
      tableEl.appendChild(rh);
      for (const second of C.BASES) {
        const box = document.createElement('div');
        box.className = 'box';
        for (const third of C.BASES) {
          const codon = first + second + third;
          const cell = document.createElement('div');
          cell.className = 'cell';
          cell.dataset.codon = codon;
          cell.innerHTML = `<span class="codon">${codon}</span><span class="aa"></span>`;
          cell.addEventListener('mouseenter', () => setFocus(codon));
          cell.addEventListener('mouseleave', () => setFocus(null));
          cell.addEventListener('click', (e) => { e.preventDefault(); setFocus(state.focusCodon === codon && cell.classList.contains('is-focus') ? null : codon, true); });
          cellEls[codon] = cell;
          box.appendChild(cell);
        }
        tableEl.appendChild(box);
      }
    }
  }
  function currentCode() { return state.view === 'real' ? C.STANDARD : state.altCode; }
  function paintTable() {
    const code = currentCode();
    for (const codon of C.CODONS) {
      const cell = cellEls[codon];
      const aa = code[codon];
      const aaEl = cell.querySelector('.aa');
      if (aa === '*') {
        cell.classList.add('stop');
        cell.style.background = '';
        aaEl.textContent = 'Stop';
      } else {
        cell.classList.remove('stop');
        cell.style.background = colourOf(aa);
        aaEl.textContent = C.AMINO_BY_LETTER[aa].three;
      }
    }
    paintFocus();
  }
  let sticky = false;
  function setFocus(codon, click) {
    if (click) { sticky = !!codon; state.focusCodon = codon; }
    else if (!sticky) state.focusCodon = codon;
    else return;
    paintFocus();
  }
  function paintFocus() {
    const code = currentCode();
    const p = C.PROPERTIES[state.prop];
    for (const codon of C.CODONS) {
      const cell = cellEls[codon];
      cell.classList.remove('is-focus', 'is-near');
      cell.removeAttribute('data-delta');
    }
    const insp = $('#inspector');
    const f = state.focusCodon;
    if (!f) { insp.innerHTML = 'Hover or tap a codon to see its nine one-letter typos. Dashed outlines are the neighbours; the number is the change in ' + p.name + '.'; return; }
    cellEls[f].classList.add('is-focus');
    const from = code[f];
    let silent = 0, nonsense = 0, miss = 0, sq = 0, readthrough = 0;
    for (let pos = 0; pos < 3; pos++) for (const b of C.BASES) {
      if (b === f[pos]) continue;
      const n = f.slice(0, pos) + b + f.slice(pos + 1);
      const cell = cellEls[n];
      cell.classList.add('is-near');
      const e = C.effect(code, f, n, p);
      if (e.kind === 'silent') { silent++; cell.dataset.delta = '='; }
      else if (e.kind === 'nonsense') { nonsense++; cell.dataset.delta = ''; }
      else if (e.kind === 'readthrough') { readthrough++; cell.dataset.delta = 'read on'; }
      else { miss++; sq += e.delta * e.delta; cell.dataset.delta = (e.delta > 0 ? '+' : '') + e.delta.toFixed(1); }
    }
    if (from === '*') {
      insp.innerHTML = `<b>${f}</b> is a stop codon. ${readthrough} of its nine one-letter neighbours would read on into an amino acid; ${9 - readthrough} stay stop. Stops are fixed in every code here.`;
      return;
    }
    const a = C.AMINO_BY_LETTER[from];
    insp.innerHTML = `<b>${f}</b> = ${a.name} (${p.short} ${p.value(from)}). Nine one-letter typos: <b>${silent}</b> silent, <b>${miss}</b> change the amino acid (mean squared jump ${miss ? (sq / miss).toFixed(2) : '0'}), <b>${nonsense}</b> become stop.`;
  }

  // -------------------------------------------------------------- score card
  function fmt(x, d) { return Number.isFinite(x) ? x.toFixed(d == null ? 2 : d) : '—'; }
  function paintScores() {
    const pv = C.propertyArray(state.prop);
    const real = C.scorePerm(C.IDENTITY, pv, state.scheme);
    const alt = C.scorePerm(state.altPerm, pv, state.scheme);
    $('#score-real .score-value').textContent = fmt(real);
    $('#score-alt .score-value').textContent = fmt(alt);
    const bars = $('#pos-bars');
    bars.innerHTML = '';
    const byPos = [0, 1, 2].map((i) => [C.scorePerm(C.IDENTITY, pv, state.scheme, [i]), C.scorePerm(state.altPerm, pv, state.scheme, [i])]);
    const max = Math.max(...byPos.flat(), 1e-9);
    byPos.forEach(([r, a], i) => {
      const lab = document.createElement('div');
      lab.className = 'pb-label';
      lab.textContent = `${['1st', '2nd', '3rd'][i]} letter  ${fmt(r)} · ${fmt(a)}`;
      const track = document.createElement('div');
      track.className = 'pb-track';
      track.innerHTML = `<div class="pb-bar" style="width:${(100 * r) / max}%"></div><div class="pb-bar alt" style="width:${(100 * a) / max}%"></div>`;
      bars.appendChild(lab);
      bars.appendChild(track);
    });
    const s = state.samples[sampleKey()];
    const p = C.PROPERTIES[state.prop];
    $('#score-note').textContent = s && s.n
      ? `Lower is gentler. Random shuffles average ${fmt(s.mean, 1)} ± ${fmt(s.sd, 1)} (${p.short} units²) on this measure; ${state.scheme === 'uniform' && state.prop === 'pr' ? 'Haig & Hurst (1991) reported 5.19 for the real code.' : 'score units are squared ' + p.name + '.'}`
      : 'Lower is gentler.';
    // legend
    const steps = 24;
    const stops = [];
    for (let i = 0; i <= steps; i++) stops.push(colourFor(i / steps));
    $('#legend-bar').style.background = `linear-gradient(90deg, ${stops.join(',')})`;
    $('#legend-mid').textContent = p.name + ' ' + p.min + ' → ' + p.max;
    $('#prop-name-1').textContent = p.name;
  }

  // -------------------------------------------------------------- histogram
  const hist = $('#hist');
  const sampleKey = () => state.prop + '|' + state.scheme;
  const CHUNK = 10000;
  const FIRST = 200000;
  const MAX = 1000000;
  function ensureSample(target) {
    const key = sampleKey();
    let s = state.samples[key];
    if (!s) {
      s = state.samples[key] = { scores: new Float64Array(MAX), n: 0, better: 0, sum: 0, sum2: 0, standard: C.scorePerm(C.IDENTITY, C.propertyArray(state.prop), state.scheme), mean: NaN, sd: NaN, rng: nextRng() };
    }
    const goal = Math.min(MAX, Math.max(target, s.n));
    if (state.sampling) state.sampling.goal = Math.max(state.sampling.goal, goal);
    else state.sampling = { key, goal };
    scheduleChunk();
  }
  function scheduleChunk() {
    if (!state.sampling) return;
    const job = state.sampling;
    const s = state.samples[job.key];
    if (s.n >= job.goal) { state.sampling = null; paintHist(); paintScores(); return; }
    const n = Math.min(CHUNK, job.goal - s.n);
    const pv = C.propertyArray(job.key.split('|')[0]);
    const pairs = C.blockPairs(job.key.split('|')[1]);
    const idx = new Int32Array(20);
    for (let i = 0; i < n; i++) {
      for (let b = 0; b < 20; b++) idx[b] = b;
      for (let b = 19; b > 0; b--) { const j = Math.floor(s.rng() * (b + 1)); const t = idx[b]; idx[b] = idx[j]; idx[j] = t; }
      const v = C.scoreIdx(idx, pv, pairs);
      s.scores[s.n++] = v;
      if (v < s.standard) s.better++;
      s.sum += v; s.sum2 += v * v;
    }
    s.mean = s.sum / s.n;
    s.sd = Math.sqrt(Math.max(0, s.sum2 / s.n - s.mean * s.mean));
    if (job.key === sampleKey()) paintHist();
    (reduced ? setTimeout : requestAnimationFrame)(scheduleChunk, 0);
  }
  function paintHist() {
    const s = state.samples[sampleKey()];
    const dpr = window.devicePixelRatio || 1;
    const W = hist.clientWidth || 600, H = 220;
    if (hist.width !== Math.round(W * dpr) || hist.height !== Math.round(H * dpr)) { hist.width = Math.round(W * dpr); hist.height = Math.round(H * dpr); }
    const ctx = hist.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const css = getComputedStyle(document.documentElement);
    const fg = css.getPropertyValue('--fg').trim(), muted = css.getPropertyValue('--muted').trim();
    const accent = css.getPropertyValue('--accent').trim(), accent2 = css.getPropertyValue('--accent-2').trim(), line = css.getPropertyValue('--line').trim();
    const pv = C.propertyArray(state.prop);
    const alt = C.scorePerm(state.altPerm, pv, state.scheme);
    const real = C.scorePerm(C.IDENTITY, pv, state.scheme);
    const pad = { l: 14, r: 14, t: 40, b: 30 };
    if (!s || !s.n) { ctx.fillStyle = muted; ctx.font = '13px system-ui, sans-serif'; ctx.fillText('Sampling…', pad.l, 40); return; }
    // range: include both markers and the bulk of the data
    let lo = Math.min(real, alt), hi = Math.max(real, alt);
    for (let i = 0; i < s.n; i++) { const v = s.scores[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    lo = Math.floor(lo - 0.3); hi = Math.ceil(hi + 0.3);
    const bins = 72;
    const counts = new Float64Array(bins);
    for (let i = 0; i < s.n; i++) { let k = Math.floor(((s.scores[i] - lo) / (hi - lo)) * bins); if (k >= bins) k = bins - 1; if (k < 0) k = 0; counts[k]++; }
    let cmax = 0; for (let k = 0; k < bins; k++) cmax = Math.max(cmax, counts[k]);
    const x = (v) => pad.l + ((v - lo) / (hi - lo)) * (W - pad.l - pad.r);
    const bw = (W - pad.l - pad.r) / bins;
    const base = H - pad.b;
    const plotH = base - pad.t;
    // bars, log-ish height so the thin tail near the real code is visible
    const hOf = (c) => (c ? (Math.log1p(c) / Math.log1p(cmax)) * plotH : 0);
    ctx.fillStyle = muted;
    for (let k = 0; k < bins; k++) {
      const hh = hOf(counts[k]);
      if (hh) ctx.fillRect(pad.l + k * bw + 0.5, base - hh, Math.max(1, bw - 1), hh);
    }
    // axis
    ctx.strokeStyle = line; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.l, base + 0.5); ctx.lineTo(W - pad.r, base + 0.5); ctx.stroke();
    ctx.fillStyle = muted; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center';
    const step = hi - lo > 16 ? 4 : hi - lo > 8 ? 2 : 1;
    for (let v = Math.ceil(lo); v <= hi; v += step) { ctx.fillText(String(v), x(v), base + 14); }
    ctx.textAlign = 'left';
    ctx.fillText(W < 480 ? 'mean squared jump per typo · ▲ mean · log bars' : 'mean squared jump per typo · ▲ random mean · bar heights log-scaled', pad.l, H - 4);
    // markers: each label sits to the right of its line unless the line is in the right half; the two labels use two rows
    function marker(v, colour, label, row) {
      const xx = x(v);
      ctx.strokeStyle = colour; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(xx, pad.t - 6); ctx.lineTo(xx, base); ctx.stroke();
      ctx.fillStyle = colour; ctx.font = '600 12px system-ui, sans-serif';
      const left = xx < W * 0.55;
      ctx.textAlign = left ? 'left' : 'right';
      ctx.fillText(label, xx + (left ? 6 : -6), pad.t - 22 + row * 14);
    }
    marker(real, accent, `real code ${real.toFixed(2)}`, 0);
    marker(alt, accent2, `alternative ${alt.toFixed(2)}`, 1);
    // mean: a small triangle under the axis
    ctx.fillStyle = fg;
    const mx = x(s.mean);
    ctx.beginPath(); ctx.moveTo(mx, base + 1); ctx.lineTo(mx - 5, base + 8); ctx.lineTo(mx + 5, base + 8); ctx.closePath(); ctx.fill();
    // stats line
    const frac = s.better / s.n;
    const one = s.better ? Math.round(s.n / s.better) : null;
    $('#hist-stats').textContent = `${s.better.toLocaleString()} of ${s.n.toLocaleString()} random codes score lower than the real code` +
      (s.better ? ` (about 1 in ${one.toLocaleString()}; ${(100 * frac).toPrecision(2)}%).` : ' (fewer than 1 in ' + s.n.toLocaleString() + ').') +
      ` Random mean ${s.mean.toFixed(2)}, SD ${s.sd.toFixed(2)}.` + (state.sampling ? ' Sampling…' : '');
    $('#btn-more').disabled = !!state.sampling || s.n >= MAX;
    $('#btn-more').textContent = s.n >= MAX ? 'Sampled 1,000,000' : 'Sample 200,000 more';
  }

  // ----------------------------------------------------------------- improve
  function improve() {
    if (state.improving) return;
    const steps = 6000, perFrame = reduced ? steps : 150;
    const rng = nextRng();
    const pv = C.propertyArray(state.prop);
    const pairs = C.blockPairs(state.scheme);
    let perm = state.altPerm.slice();
    let cur = C.scorePerm(perm, pv, state.scheme);
    let best = perm.slice(), bestScore = cur;
    let k = 0;
    const t0 = 1.0, t1 = 0.002;
    const idx = new Int32Array(20);
    const scoreOf = (p) => { for (let b = 0; b < 20; b++) idx[b] = C.LETTERS.indexOf(p[b]); return C.scoreIdx(idx, pv, pairs); };
    $('#btn-improve').disabled = true;
    state.improving = true;
    setView('alt');
    function frame() {
      for (let n = 0; n < perFrame && k < steps; n++, k++) {
        const T = t0 * Math.pow(t1 / t0, k / steps);
        const i = Math.floor(rng() * 20);
        let j = Math.floor(rng() * 19); if (j >= i) j++;
        const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
        const s = scoreOf(perm);
        if (s <= cur || rng() < Math.exp((cur - s) / T)) { cur = s; if (s < bestScore) { bestScore = s; best = perm.slice(); } }
        else { perm[j] = perm[i]; perm[i] = t; }
      }
      state.altPerm = (k < steps ? perm : best).slice();
      state.altCode = C.codeFromPerm(state.altPerm);
      paintTable(); paintScores(); paintHist(); storm.recode();
      if (k < steps) requestAnimationFrame(frame);
      else { state.improving = null; $('#btn-improve').disabled = false; }
    }
    frame();
  }

  // ------------------------------------------------------------------- storm
  const storm = {
    gene: C.GENES[0],
    codons: [],
    original: { real: '', alt: '' },
    hits: 0,
    roundLength: 60,
    running: false,
    rng: null,
    acc: 0,
    last: 0,
    stats: null,
    strips: null,
    tally: { real: { sum: 0, n: 0 }, alt: { sum: 0, n: 0 } },
    init(gene) {
      if (gene && gene !== this.gene) this.tally = { real: { sum: 0, n: 0 }, alt: { sum: 0, n: 0 } };
      this.gene = gene || this.gene;
      this.codons = C.codonsOf(this.gene.cds);
      this.hits = 0;
      this.rng = nextRng();
      this.acc = 0;
      this.stats = { real: { silent: 0, missense: 0, nonsense: 0, biggest: 0 }, alt: { silent: 0, missense: 0, nonsense: 0, biggest: 0 } };
      this.original.real = C.translate(this.codons, C.STANDARD);
      this.original.alt = C.translate(this.codons, state.altCode);
      this.build();
      $('#last-hit').textContent = `${this.gene.name}: ${this.codons.length - 1} codons plus a stop, ${this.gene.accession}. Press Start. Each round is ${this.roundLength} typos.`;
      $('#btn-landmark').hidden = !this.gene.landmark;
      if (this.gene.landmark) $('#btn-landmark').textContent = 'Apply the ' + this.gene.landmark.label;
    },
    recode() {
      // The alternative code changed (shuffle/improve): the alt strip's baseline is re-translated from the ORIGINAL message.
      const orig = C.codonsOf(this.gene.cds);
      this.original.alt = C.translate(orig, state.altCode);
      this.stats.alt = { silent: 0, missense: 0, nonsense: 0, biggest: 0 };
      this.tally.alt = { sum: 0, n: 0 };
      this.paint('alt');
    },
    build() {
      this.strips = {};
      for (const which of ['real', 'alt']) {
        const el = $('#strip-' + which + ' .tiles');
        el.innerHTML = '';
        const n = this.codons.length - 1; // exclude the terminal stop
        const tiles = [];
        for (let i = 0; i < n; i++) {
          const t = document.createElement('div');
          t.className = 'tile';
          t.title = `codon ${i + 1}`;
          el.appendChild(t);
          tiles.push(t);
        }
        this.strips[which] = tiles;
        this.paint(which);
      }
    },
    codeOf(which) { return which === 'real' ? C.STANDARD : state.altCode; },
    paint(which, hitIndex) {
      const code = this.codeOf(which);
      const p = C.PROPERTIES[state.prop];
      const tiles = this.strips[which];
      const orig = this.original[which];
      let dead = false, made = 0, drift = 0, same = 0, biggest = 0;
      for (let i = 0; i < tiles.length; i++) {
        const t = tiles[i];
        const aa = code[this.codons[i]];
        const o = orig[i];
        t.classList.toggle('dead', dead);
        if (aa === '*') {
          t.classList.add('stop'); t.classList.remove('changed');
          t.textContent = '·'; t.style.background = ''; t.style.setProperty('--orig', 'transparent');
          dead = true;
        } else {
          t.classList.remove('stop');
          t.textContent = aa;
          t.style.background = colourOf(aa);
          t.style.setProperty('--orig', colourOf(o));
          t.classList.toggle('changed', aa !== o);
          if (!dead) { made++; const d = p.value(aa) - p.value(o); drift += d * d; biggest = Math.max(biggest, Math.abs(d)); if (aa === o) same++; }
        }
        if (i === hitIndex && !reduced) { t.classList.remove('hit'); void t.offsetWidth; t.classList.add('hit'); }
      }
      const st = this.stats[which];
      st.biggest = biggest; // largest |current - original| over residues, in the current property's units
      const el = $('#strip-' + which + ' .strip-stats');
      // Bar is full at a mean squared drift of 8 (PR) or 10 (KD): a few times what a 60-typo round
      // typically leaves under the real code, so both bars stay readable and rarely saturate.
      const scale = state.prop === 'pr' ? 8 : 10;
      const tally = this.tally[which];
      const expected = C.geneScore(C.codonsOf(this.gene.cds), code, p, state.scheme);
      el.innerHTML = `<span>silent <b>${st.silent}</b></span><span>changed <b>${st.missense}</b></span><span>biggest shift <b>${biggest ? biggest.toFixed(1) : '—'}</b></span><span>identical <b>${made ? Math.round((100 * same) / made) : 0}%</b></span>` +
        `<div class="drift"><span>drift</span><div class="track"><div class="bar" style="width:${Math.min(100, (100 * (made ? drift / made : 0)) / scale)}%"></div></div><b>${made ? (drift / made).toFixed(2) : '0.00'}</b></div>` +
        `<div class="tally">mean squared jump per typo, all rounds: <b>${tally.n ? (tally.sum / tally.n).toFixed(2) : '—'}</b> after ${tally.n} typos · expected for this gene's codons <b>${expected.toFixed(2)}</b></div>`;
    },
    applyMutation(m) {
      const p = C.PROPERTIES[state.prop];
      const parts = [];
      for (const which of ['real', 'alt']) {
        const code = this.codeOf(which);
        const e = C.effect(code, m.from, m.to, p);
        const st = this.stats[which];
        if (e.kind === 'silent') st.silent++;
        else if (e.kind === 'nonsense') st.nonsense++;
        else if (e.kind === 'missense') st.missense++;
        if (e.kind !== 'readthrough') { this.tally[which].sum += e.delta * e.delta; this.tally[which].n++; }
        const name = (l) => (l === '*' ? 'Stop' : C.AMINO_BY_LETTER[l].three);
        parts.push(`${which === 'real' ? 'real' : 'alt'}: ${name(e.a)} → ${name(e.b)}${e.kind === 'missense' ? ` (Δ ${e.delta > 0 ? '+' : ''}${e.delta.toFixed(1)})` : e.kind === 'silent' ? ' (silent)' : ' (stop!)'}`);
      }
      this.codons[m.index] = m.to;
      this.hits++;
      const pur = (x) => x === 'A' || x === 'G';
      const kind = pur(m.base) === pur(m.from[m.pos]) ? 'transition' : 'transversion';
      $('#last-hit').textContent = `typo ${this.hits}/${this.roundLength} · codon ${m.index + 1}: ${m.from} → ${m.to} (letter ${m.pos + 1}, ${kind}) · ${parts.join(' · ')}`;
      for (const which of ['real', 'alt']) this.paint(which, m.index);
    },
    step() {
      if (this.hits >= this.roundLength) { this.stop(true); return; }
      const m = C.drawMutation(this.codons, state.scheme, this.rng, false);
      if (!m) { this.stop(true); return; }
      this.applyMutation(m);
    },
    landmark() {
      const lm = this.gene.landmark;
      if (!lm) return;
      const from = this.codons[lm.codonIndex];
      if (from[lm.pos] === lm.base) return;
      const to = from.slice(0, lm.pos) + lm.base + from.slice(lm.pos + 1);
      this.applyMutation({ index: lm.codonIndex, pos: lm.pos, base: lm.base, from, to });
      $('#last-hit').textContent = `${lm.label}: codon ${lm.codonIndex + 1} ${from} → ${to} · ` + $('#last-hit').textContent.split(' · ').slice(2).join(' · ');
    },
    start() {
      if (this.hits >= this.roundLength) this.init();
      this.running = true; this.last = performance.now(); this.acc = 0;
      $('#btn-play').textContent = 'Pause';
      requestAnimationFrame((t) => this.tick(t));
    },
    stop(roundOver) {
      this.running = false;
      $('#btn-play').textContent = roundOver ? 'New round' : 'Resume';
      if (roundOver) {
        const r = this.stats.real, a = this.stats.alt;
        const p = C.PROPERTIES[state.prop];
        const tr = this.tally.real, ta = this.tally.alt;
        $('#last-hit').textContent = `Round over after ${this.hits} typos. Both dictionaries saw the same ${r.silent} silent typos; the other ${r.missense} changed an amino acid. Biggest shift of one residue's ${p.name}: ${r.biggest.toFixed(1)} under the real code, ${a.biggest.toFixed(1)} under the alternative. ` +
          `Over all rounds so far (${tr.n} typos): ${(tr.sum / tr.n).toFixed(2)} per typo under the real code, ${(ta.sum / Math.max(1, ta.n)).toFixed(2)} under the alternative. Single rounds are noisy; the tallies settle toward the expected values.`;
      }
    },
    tick(now) {
      if (!this.running) return;
      const rate = Number($('#rng-speed').value);
      this.acc += ((now - this.last) / 1000) * rate;
      this.last = now;
      let n = 0;
      while (this.acc >= 1 && n < 4 && this.running) { this.acc -= 1; this.step(); n++; }
      if (this.running) requestAnimationFrame((t) => this.tick(t));
    },
  };

  // --------------------------------------------------------------- wiring
  function setView(v) {
    state.view = v;
    document.querySelectorAll('.seg-btn').forEach((b) => { const on = b.dataset.view === v; b.classList.toggle('is-on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
    paintTable();
  }
  document.querySelectorAll('.seg-btn').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  $('#btn-shuffle').addEventListener('click', () => {
    if (state.improving) return;
    shuffleAlt();
    setView('alt');
    paintScores(); paintHist(); storm.recode();
  });
  $('#btn-improve').addEventListener('click', improve);
  // The storm's drift and tally are in the property's units and its draws follow the weighting,
  // so changing either starts the storm afresh.
  function restartStorm() { storm.stop(false); storm.tally = { real: { sum: 0, n: 0 }, alt: { sum: 0, n: 0 } }; storm.init(); $('#btn-play').textContent = 'Start'; }
  $('#sel-prop').addEventListener('change', (e) => { state.prop = e.target.value; paintTable(); paintScores(); ensureSample(FIRST); paintHist(); restartStorm(); });
  $('#sel-scheme').addEventListener('change', (e) => { state.scheme = e.target.value; paintScores(); ensureSample(FIRST); paintHist(); restartStorm(); });
  $('#btn-more').addEventListener('click', () => ensureSample((state.samples[sampleKey()] || { n: 0 }).n + 200000));

  const selGene = $('#sel-gene');
  C.GENES.forEach((g) => selGene.appendChild(Object.assign(document.createElement('option'), { value: g.key, textContent: `${g.gene}: ${g.name}` })));
  selGene.addEventListener('change', () => { storm.stop(false); storm.init(C.GENES.find((g) => g.key === selGene.value)); $('#btn-play').textContent = 'Start'; });
  $('#btn-play').addEventListener('click', () => { if (storm.running) storm.stop(false); else storm.start(); });
  $('#btn-reset').addEventListener('click', () => { storm.stop(false); storm.init(); $('#btn-play').textContent = 'Start'; });
  $('#btn-landmark').addEventListener('click', () => storm.landmark());
  $('#rng-speed').addEventListener('input', (e) => { $('#speed-label').textContent = e.target.value + ' / s'; });
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'BUTTON' || t.tagName === 'TEXTAREA')) return;
    if (e.code === 'Space') { e.preventDefault(); if (storm.running) storm.stop(false); else storm.start(); }
  });
  let resizeTimer = null;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(paintHist, 100); });
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { paintHist(); });

  buildTable();
  paintTable();
  paintScores();
  storm.init(C.GENES[0]);
  ensureSample(FIRST);
  paintHist();
})();
