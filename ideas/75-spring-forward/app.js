/* app.js — draws "Does the River Spring Forward?". Every number on the page comes from
 * RiverTime.report() run on the bundled data (data/rivers.js); nothing here computes a result
 * of its own except the first method, which is run on request through RiverTime as well. */
(function () {
  'use strict';
  const RT = window.RiverTime;
  const DATA = window.RIVER_DATA;
  const SVGNS = 'http://www.w3.org/2000/svg';
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const lees = DATA.sites.find((s) => s.key === 'lees');
  const R = RT.report(DATA);
  const L = R.sites.lees;
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  // ------------------------------------------------------------ helpers
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  function el(tag, attrs = {}, parent) {
    const e = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (parent) parent.appendChild(e);
    return e;
  }
  function text(parent, x, y, str, attrs = {}) {
    const t = el('text', { x, y, ...attrs }, parent);
    t.textContent = str;
    return t;
  }
  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }
  const fm = RT.fmtMin;
  function ampm(minutes) {
    const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
    const h = Math.floor(m / 60);
    const mm = String(m % 60).padStart(2, '0');
    const h12 = ((h + 11) % 12) + 1;
    return `${h12}:${mm} ${h < 12 ? 'am' : 'pm'}`;
  }
  function dateLabel(dn) {
    const [y, m, d] = RT.dateOf(dn);
    return `${d} ${MONTHS[m - 1]} ${y}`;
  }
  /** Call fn at most once per `gap` ms, always with the latest arguments (no fast repaints). */
  function throttle(fn, gap) {
    let last = -Infinity;
    let timer = null;
    let pending = null;
    return (...args) => {
      pending = args;
      const now = performance.now();
      const run = () => {
        timer = null;
        last = performance.now();
        const a = pending;
        pending = null;
        fn(...a);
      };
      if (timer) return;
      if (now - last >= gap) run();
      else timer = setTimeout(run, gap - (now - last));
    };
  }
  function widthOf(node, fallback = 600) {
    const w = node.getBoundingClientRect().width;
    return w > 0 ? Math.floor(w) : fallback;
  }

  // ------------------------------------------------------------ numbers in the prose
  const avgSpring = L.exploratory.averageDay.spring;
  const F = avgSpring.features; // the sharp features of the average March day, and their moves
  const upBefore = F.before.morningRise;
  const upAfter = F.after.morningRise;
  const E = L.exploratory;
  const CK = L.law.clockKeeper; // a simulated river that keeps clock time exactly
  const earlierW = (w) => `${fm(-w.diff)} minutes (95% interval ${fm(-w.hi)} to ${fm(-w.lo)})`;
  const values = {
    'lees.Kc.mean': fm(L.Kc.mean),
    'lees.Kc.lo': fm(L.Kc.lo),
    'lees.Kc.hi': fm(L.Kc.hi),
    'lees.verdictCorrected': L.verdictCorrected,
    'lees.springAbs': fm(-L.spring.mean),
    'lees.springRange': `${fm(-L.spring.hi)} to ${fm(-L.spring.lo)}`,
    'lees.springEarlier': String(L.exploratory.springEarlier),
    'lees.upEarlier': String(-F.moves.morningRise),
    'lees.upLaterUT': String(60 + F.moves.morningRise),
    'lees.avgShiftAbs': String(-avgSpring.shift),
    'lees.lowEarlier': String(-F.moves.low),
    'lees.fallEarlier': String(-F.moves.afternoonFall),
    'lees.eveEarlier': String(-F.moves.eveningRise),
    'lees.crestMoved': String(Math.abs(F.moves.crest)),
    'santacruz.Kc': RT.fmtCI(R.sites.santacruz.Kc),
    'delaware.Kc': RT.fmtCI(R.sites.delaware.Kc),
    'salt.Kc.hi': fm(R.sites.salt.Kc.hi),
    'salt.K.hi': fm(R.sites.salt.K.hi),
    'clock.atNew': fm(CK.atNew.mean),
    'clock.atOld': fm(CK.atOld.mean),
    'clock.coh': CK.coherence.toFixed(2),
    'lees.coh': L.law.realCoherence.toFixed(2),
    'clock.lateOct': fm(CK.fallNewAtOld.mean),
    'buford.lateOct': RT.fmtCI(R.sites.buford.law.eraSeasons.newAtOld.fall),
    'lees.oldEraK': RT.fmtCI(L.law.eras.oldAtOld),
    'lees.oldEraVerdict': RT.verdict(L.law.eras.oldAtOld),
    'lees.springOld': earlierW(L.law.bySeason.spring.atOld),
    'lees.springNew': earlierW(L.law.bySeason.spring.atNew),
    'lees.hfFall': RT.fmtCI(E.highFlowFall.fall),
    'lees.quietNovK': RT.fmtCI(E.quietNovembers.K),
    'lees.quietNovKc': RT.fmtCI(E.quietNovembers.Kc),
    'lees.quietK': RT.fmtCI(E.quiet.K),
    'lees.quietKc': RT.fmtCI(E.quiet.Kc),
    'lees.after2012Kc.verdict': E.after2012.verdictCorrected,
    'lees.quietNovKc.verdict': E.quietNovembers.verdictCorrected,
    'lees.quietKc.verdict': E.quiet.verdictCorrected,
    'lees.plSpringA': fm(L.placebo[0].spring.mean),
    'lees.plSpringB': fm(L.placebo[1].spring.mean),
    'lees.oldMarch': fm(L.law.eraSeasons.oldAtNew.spring.mean),
    'lees.after2012K': RT.fmtCI(L.exploratory.after2012.K),
    'lees.after2012Kc': RT.fmtCI(L.exploratory.after2012.Kc),
    'lees.lawNew': fm(L.law.atNew.diff),
    'buford.lawNew': fm(R.sites.buford.law.atNew.diff),
    'buford.Kc.mean': fm(R.sites.buford.Kc.mean),
    'trinity.Kc.mean': fm(R.sites.trinity.Kc.mean),
    retrieved: (() => {
      const [y, m, d] = DATA.retrieved.split('-').map(Number);
      return `${d} ${MONTHS[m - 1]} ${y}`;
    })(),
  };
  for (const node of $$('[data-k]')) {
    const v = values[node.dataset.k];
    if (v !== undefined) node.textContent = v;
  }

  // ------------------------------------------------------------ the two clocks
  const clockState = { phase: 'before', shownAZ: upBefore, shownUT: upBefore, anim: null };
  function drawClockFace(svg, colorVar) {
    clear(svg);
    el('circle', { cx: 60, cy: 60, r: 54, fill: 'var(--surface)', stroke: 'var(--axis)', 'stroke-width': 2 }, svg);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * 2 * Math.PI;
      const r1 = i % 3 === 0 ? 43 : 47;
      el('line', { x1: 60 + r1 * Math.sin(a), y1: 60 - r1 * Math.cos(a), x2: 60 + 51 * Math.sin(a), y2: 60 - 51 * Math.cos(a), stroke: 'var(--ink-2)', 'stroke-width': i % 3 === 0 ? 2.5 : 1.2, 'stroke-linecap': 'round' }, svg);
    }
    el('line', { class: 'hour-hand', x1: 60, y1: 60, x2: 60, y2: 30, stroke: 'var(--ink)', 'stroke-width': 4, 'stroke-linecap': 'round' }, svg);
    el('line', { class: 'minute-hand', x1: 60, y1: 60, x2: 60, y2: 16, stroke: colorVar, 'stroke-width': 2.5, 'stroke-linecap': 'round' }, svg);
    el('circle', { cx: 60, cy: 60, r: 3.5, fill: 'var(--ink)' }, svg);
  }
  function setHands(svg, minutes) {
    const h = ((minutes / 60) % 12) / 12 * 360;
    const m = (minutes % 60) / 60 * 360;
    svg.querySelector('.hour-hand').setAttribute('transform', `rotate(${h} 60 60)`);
    svg.querySelector('.minute-hand').setAttribute('transform', `rotate(${m} 60 60)`);
  }
  const clockAZ = $('#clockAZ');
  const clockUT = $('#clockUT');
  drawClockFace(clockAZ, 'var(--river)');
  drawClockFace(clockUT, 'var(--utah)');

  function clockTargets(phase) {
    return phase === 'before' ? { az: upBefore, ut: upBefore } : { az: upAfter, ut: upAfter + 60 };
  }
  function renderClockText() {
    const t = clockTargets(clockState.phase);
    $('#timeAZ').textContent = ampm(t.az);
    $('#timeUT').textContent = ampm(t.ut);
    clockAZ.setAttribute('aria-label', `Arizona clock showing ${ampm(t.az)}`);
    clockUT.setAttribute('aria-label', `Utah clock showing ${ampm(t.ut)}`);
    $('#clockCaption').textContent =
      clockState.phase === 'before'
        ? `Two weeks before the March change, the river climbs past its daily average at ${ampm(upBefore)} by both clocks: Utah is on standard time too until the second Sunday of March.`
        : `Two weeks after, it climbs past its average at ${ampm(upAfter)} by Arizona's clock and ${ampm(upAfter + 60)} by Utah's, which has jumped an hour ahead.`;
  }
  function animateClocks() {
    const t = clockTargets(clockState.phase);
    if (clockState.anim) cancelAnimationFrame(clockState.anim);
    const fromAZ = clockState.shownAZ;
    const fromUT = clockState.shownUT;
    if (reduceMotion) {
      clockState.shownAZ = t.az;
      clockState.shownUT = t.ut;
      setHands(clockAZ, t.az);
      setHands(clockUT, t.ut);
      return;
    }
    const t0 = performance.now();
    const dur = 700;
    const step = (now) => {
      const u = Math.min(1, (now - t0) / dur);
      const e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
      clockState.shownAZ = fromAZ + (t.az - fromAZ) * e;
      clockState.shownUT = fromUT + (t.ut - fromUT) * e;
      setHands(clockAZ, clockState.shownAZ);
      setHands(clockUT, clockState.shownUT);
      if (u < 1) clockState.anim = requestAnimationFrame(step);
      else clockState.anim = null;
    };
    clockState.anim = requestAnimationFrame(step);
  }
  setHands(clockAZ, upBefore);
  setHands(clockUT, upBefore);

  /** A 24-hour day plot: curves from 24-hour profiles, x in hours of Arizona (standard) time. */
  function drawDayPlot(svg, curves, opts = {}) {
    clear(svg);
    const W = widthOf(svg.parentNode, 640);
    const H = opts.height || (W < 480 ? 170 : 200);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('height', H);
    const m = { l: 8, r: 8, t: opts.top || 28, b: 30 };
    const pw = W - m.l - m.r;
    const ph = H - m.t - m.b;
    const x = (hours) => m.l + (hours / 24) * pw;
    let max = 0;
    const samples = curves.map((c) => {
      const s = RT.smoothCurve(c.profile, 10);
      const mm = Math.max(...s.map(Math.abs));
      const norm = s.map((v) => v / (mm || 1));
      return norm;
    });
    for (const s of samples) for (const v of s) max = Math.max(max, Math.abs(v));
    const y = (v) => m.t + ph / 2 - (v / (max || 1)) * (ph / 2) * 0.92;
    for (const hr of [0, 6, 12, 18, 24]) {
      el('line', { x1: x(hr), x2: x(hr), y1: m.t, y2: m.t + ph, class: 'grid-line' }, svg);
      const label = hr === 0 || hr === 24 ? 'midnight' : hr === 12 ? 'noon' : hr === 6 ? '6 am' : '6 pm';
      text(svg, x(hr), H - 10, label, { 'text-anchor': hr === 0 ? 'start' : hr === 24 ? 'end' : 'middle', 'font-size': 12 });
    }
    el('line', { x1: m.l, x2: m.l + pw, y1: y(0), y2: y(0), class: 'axis-line' }, svg);
    curves.forEach((c, i) => {
      const pts = samples[i].map((v, k) => `${(k ? 'L' : 'M') + x((k * 10) / 60).toFixed(1)},${y(v).toFixed(1)}`).join('');
      el('path', { d: pts, fill: 'none', stroke: c.color, 'stroke-width': c.width || 2, 'stroke-dasharray': c.dash || 'none', opacity: c.opacity ?? 1, 'stroke-linejoin': 'round' }, svg);
    });
    if (opts.marker !== undefined) {
      const mx = x(opts.marker / 60);
      el('line', { x1: mx, x2: mx, y1: m.t - 4, y2: m.t + ph, stroke: opts.markerColor || 'var(--ink)', 'stroke-width': 1.5, 'stroke-dasharray': '3 3' }, svg);
      text(svg, mx, m.t - 8, opts.markerLabel || '', { 'text-anchor': opts.marker > 1000 ? 'end' : 'start', 'font-size': 12, fill: 'var(--ink)' });
    }
    if (opts.legend) {
      let lx = m.l + pw;
      for (const item of [...opts.legend].reverse()) {
        const tw = item.label.length * 6.6 + 30;
        lx -= tw;
        el('line', { x1: lx, x2: lx + 20, y1: 12, y2: 12, stroke: item.color, 'stroke-width': 2.5, 'stroke-dasharray': item.dash || 'none' }, svg);
        text(svg, lx + 25, 16, item.label, { 'font-size': 12 });
      }
    }
  }

  function renderDayPlot() {
    const before = clockState.phase === 'before';
    const avg = RT.averageHalves(lees, RT.YEARS, 'spring');
    drawDayPlot($('#dayplot'), [
      { profile: avg.before, color: 'var(--before)', dash: '5 4', width: before ? 2.5 : 1.5, opacity: before ? 1 : 0.7 },
      { profile: avg.after, color: 'var(--river)', width: before ? 1.5 : 2.5, opacity: before ? 0.55 : 1 },
    ], {
      marker: before ? upBefore : upAfter,
      markerColor: before ? 'var(--before)' : 'var(--river)',
      markerLabel: `rises past average ${RT.fmtClock(before ? upBefore : upAfter)} Arizona`,
      legend: [{ label: 'two weeks before', color: 'var(--before)', dash: '5 4' }, { label: 'two weeks after', color: 'var(--river)' }],
      top: 40,
    });
  }
  const setPhase = throttle((phase) => {
    clockState.phase = phase;
    for (const b of $$('[data-phase]')) b.setAttribute('aria-pressed', String(b.dataset.phase === phase));
    renderClockText();
    renderDayPlot();
    animateClocks();
  }, 350);
  for (const b of $$('[data-phase]')) b.addEventListener('click', () => setPhase(b.dataset.phase));
  renderClockText();
  renderDayPlot();

  // ------------------------------------------------------------ the raster
  const rasterState = { season: 'spring', clock: 'az', year: 'all' };
  const yearSel = $('#yearSel');
  for (const y of RT.YEARS) {
    const o = document.createElement('option');
    o.value = String(y);
    o.textContent = String(y);
    yearSel.appendChild(o);
  }
  function hexToRgb(h) {
    const s = h.replace('#', '');
    const n = parseInt(s.length === 3 ? s.replace(/./g, (c) => c + c) : s, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rasterRows() {
    const { season, year } = rasterState;
    if (year === 'all') return { rows: RT.meanRaster(lees, RT.YEARS, season), means: null, T: null };
    const T = RT.transitions(Number(year), 'new')[season];
    const rows = [];
    const means = [];
    for (let k = -14; k <= 14; k++) {
      rows.push(RT.profileOf(lees, T + k));
      means.push(RT.dayMeanFlow(lees, T + k));
    }
    return { rows, means, T };
  }
  function renderRaster() {
    const canvas = $('#rasterCanvas');
    const W = widthOf(canvas.parentNode, 640);
    const narrow = W < 480;
    const rowH = narrow ? 9 : 11;
    const m = { l: narrow ? 56 : 62, r: narrow ? 44 : 64, t: 22, b: 8 };
    const H = m.t + 29 * rowH + m.b;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.height = `${H}px`;
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = css('--surface');
    g.fillRect(0, 0, W, H);
    const lo = hexToRgb(css('--water-lo') || '#f3f1ea');
    const hi = hexToRgb(css('--water-hi') || '#104281');
    const ink = css('--ink-2');
    const pw = W - m.l - m.r;
    const { rows, means, T } = rasterRows();
    const { season, clock } = rasterState;
    const COLS = 144; // ten-minute cells
    const cw = pw / COLS;
    rows.forEach((row, i) => {
      const k = i - 14;
      const yy = m.t + i * rowH;
      if (k === 0) {
        g.fillStyle = css('--grid');
        g.fillRect(m.l, yy + 1, pw, rowH - 2);
        return;
      }
      if (!row) return;
      const curve = RT.smoothCurve(row, 10);
      const mx = Math.max(...curve.map(Math.abs)) || 1;
      // On Utah's clock, the days on daylight time read an hour later.
      const shifted = clock === 'ut' && ((season === 'spring' && k > 0) || (season === 'fall' && k < 0));
      const off = shifted ? 6 : 0; // six ten-minute cells
      for (let c = 0; c < COLS; c++) {
        const src = (((c - off) % COLS) + COLS) % COLS;
        const v = (curve[src] + curve[src + 1]) / 2 / mx;
        const u = Math.max(0, Math.min(1, (v + 1) / 2)) ** 1.25;
        g.fillStyle = `rgb(${lo.map((a, j) => Math.round(a + (hi[j] - a) * u)).join(',')})`;
        g.fillRect(m.l + c * cw, yy, cw + 0.6, rowH - 1);
      }
    });
    // hour labels
    g.fillStyle = ink;
    g.font = `12px system-ui, -apple-system, "Segoe UI", sans-serif`;
    g.textBaseline = 'alphabetic';
    for (const hr of [0, 6, 12, 18, 24]) {
      g.textAlign = hr === 0 ? 'left' : hr === 24 ? 'right' : 'center';
      const lab = hr === 0 || hr === 24 ? (narrow ? '0' : 'midnight') : hr === 12 ? 'noon' : hr === 6 ? '6 am' : '6 pm';
      g.fillText(lab, m.l + (hr / 24) * pw, m.t - 7);
    }
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    for (const k of [-14, -7, 0, 7, 14]) {
      const yy = m.t + (k + 14) * rowH + rowH / 2;
      g.fillText(k === 0 ? 'change' : `${k > 0 ? '+' : '−'}${Math.abs(k)} d`, m.l - 6, yy);
    }
    // daily mean flow, single years only
    if (means) {
      g.textAlign = 'left';
      g.fillText(narrow ? 'kcfs' : 'mean flow', m.l + pw + 6, m.t - 10);
      const scale = (m.r - 14) / 45000;
      means.forEach((q, i) => {
        if (q === null || i === 14) return;
        const yy = m.t + i * rowH;
        g.fillStyle = q > RT.HIGH_FLOW_CFS ? css('--utah') : css('--axis');
        g.fillRect(m.l + pw + 6, yy + 1, Math.max(1, Math.min(45000, q) * scale), rowH - 3);
      });
    }
    canvas.setAttribute('aria-label', rasterCaption(T));
    $('#rasterCaption').textContent = rasterCaption(T);
  }
  function rasterCaption(T) {
    const { season, clock, year } = rasterState;
    const which = season === 'spring' ? 'March' : 'November';
    const clk = clock === 'az' ? "Arizona's clock (standard time all year)" : "Utah's clock (an hour ahead while on daylight time)";
    let s = year === 'all'
      ? `${which}, the average of all eighteen years, on ${clk}. `
      : `${which} ${year}: the clocks changed on Sunday ${dateLabel(T)}. On ${clk}. The bars on the right are each day's mean flow, orange above 30,000 cubic feet per second (a high-flow release). `;
    s += 'The grey row is the change-over Sunday, left out of every estimate.';
    const d = year === 'all' ? null : disturbance(Number(year), season);
    if (d && d.why === 'the fall steady flows') {
      s += ' This November followed the fall steady-flow experiment: the days before the change have almost no daily rise and fall.';
    } else if (d) s += ` These four weeks hold ${d.why}.`;
    return s;
  }
  const scheduleRaster = throttle(renderRaster, 340);
  for (const b of $$('[data-season]')) b.addEventListener('click', () => {
    rasterState.season = b.dataset.season;
    for (const x of $$('[data-season]')) x.setAttribute('aria-pressed', String(x === b));
    scheduleRaster();
  });
  for (const b of $$('[data-clock]')) b.addEventListener('click', () => {
    rasterState.clock = b.dataset.clock;
    for (const x of $$('[data-clock]')) x.setAttribute('aria-pressed', String(x === b));
    scheduleRaster();
  });
  yearSel.addEventListener('change', () => {
    rasterState.year = yearSel.value;
    scheduleRaster();
  });

  // ------------------------------------------------------------ the registered answer
  const ORDER = [
    ['lees', 'Colorado at Lees Ferry', 'the question; Arizona, no clock change'],
    ['greendale', 'Green below Flaming Gorge', 'sister dam in Utah; added in part 2'],
    ['santacruz', 'Santa Cruz at Cortaro', "Tucson's wastewater; should be 0"],
    ['delaware', 'Delaware at Trenton', 'water temperature, the Sun; should be 0'],
    ['salt', 'Salt below Stewart Mountain', 'an Arizona dam; should be 0'],
    ['buford', 'Chattahoochee at Buford Dam', 'Georgia peaking dam; should be 60'],
    ['trinity', 'Trinity below Dallas', "Dallas's wastewater; should be 60"],
  ];
  let stat = 'Kc';
  function renderForest() {
    const host = $('#forest');
    clear(host);
    const W = widthOf(host, 640);
    const wide = W >= 560;
    const rowH = wide ? 54 : 66;
    const m = { l: 4, r: 4, t: 30, b: 28 };
    const H = m.t + ORDER.length * rowH + m.b;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img', 'aria-label': `Mean ${stat === 'Kc' ? 'placebo-corrected K' : 'K'} with 95% intervals for seven rivers` }, host);
    const X0 = -60;
    const X1 = 120;
    const pw = W - m.l - m.r;
    const x = (v) => m.l + ((Math.max(X0, Math.min(X1, v)) - X0) / (X1 - X0)) * pw;
    for (const [a, b, lab] of [[-10, 10, 'standard time'], [50, 70, 'clock time']]) {
      el('rect', { x: x(a), y: m.t - 8, width: x(b) - x(a), height: ORDER.length * rowH + 8, class: 'band' }, svg);
      text(svg, (x(a) + x(b)) / 2, m.t - 14, lab, { 'text-anchor': 'middle', 'font-size': 12 });
    }
    for (const v of [-60, -30, 0, 30, 60, 90, 120]) {
      el('line', { x1: x(v), x2: x(v), y1: m.t + ORDER.length * rowH, y2: m.t + ORDER.length * rowH + 4, class: 'axis-line' }, svg);
      text(svg, x(v), H - 8, `${v < 0 ? '−' : ''}${Math.abs(v)}`, { 'text-anchor': v === -60 ? 'start' : v === 120 ? 'end' : 'middle', 'font-size': 12 });
    }
    ORDER.forEach(([key, name, role], i) => {
      const r = R.sites[key];
      const s = r[stat];
      const verdict = stat === 'Kc' ? r.verdictCorrected : r.verdict;
      const y0 = m.t + i * rowH;
      const g = el('g', {}, svg);
      const title = el('title', {}, g);
      title.textContent = `${name}: ${RT.fmtCI(s)} minutes, ${s.n} years. ${verdict}.`;
      text(g, m.l, y0 + 14, name, { 'font-size': 13.5, 'font-weight': 600, fill: 'var(--ink)' });
      const valueText = `${fm(s.mean)} (${fm(s.lo)} to ${fm(s.hi)}) · ${verdict}`;
      if (wide) {
        text(g, m.l + pw, y0 + 14, valueText, { 'text-anchor': 'end', 'font-size': 12, fill: 'var(--ink-2)' });
        text(g, m.l, y0 + 30, role, { 'font-size': 12, fill: 'var(--muted)' });
      } else {
        text(g, m.l, y0 + 30, valueText, { 'font-size': 12, fill: 'var(--ink-2)' });
      }
      const yy = y0 + (wide ? 44 : 50);
      const color = key === 'lees' ? 'var(--river)' : 'var(--ink-2)';
      el('line', { x1: x(s.lo), x2: x(s.hi), y1: yy, y2: yy, stroke: color, 'stroke-width': 2.5, 'stroke-linecap': 'round' }, g);
      if (s.lo < X0) el('path', { d: `M${x(X0) + 6},${yy - 5}L${x(X0)},${yy}L${x(X0) + 6},${yy + 5}`, fill: 'none', stroke: color, 'stroke-width': 2 }, g);
      if (s.hi > X1) el('path', { d: `M${x(X1) - 6},${yy - 5}L${x(X1)},${yy}L${x(X1) - 6},${yy + 5}`, fill: 'none', stroke: color, 'stroke-width': 2 }, g);
      el('circle', { cx: x(s.mean), cy: yy, r: 6, fill: color, stroke: 'var(--surface)', 'stroke-width': 2 }, g);
    });
    el('line', { x1: x(0), x2: x(0), y1: m.t - 8, y2: m.t + ORDER.length * rowH, stroke: 'var(--axis)', 'stroke-width': 1 }, svg);
  }
  const scheduleForest = throttle(renderForest, 340);
  for (const b of $$('[data-stat]')) b.addEventListener('click', () => {
    stat = b.dataset.stat;
    for (const x2 of $$('[data-stat]')) x2.setAttribute('aria-pressed', String(x2 === b));
    scheduleForest();
  });

  // ------------------------------------------------------------ the law change
  (function renderLaw() {
    const body = $('#lawBody');
    const ci = (w) => `${fm(w.diff)} (${fm(w.lo)} to ${fm(w.hi)})`;
    for (const [key, name] of [['lees', 'Colorado at Lees Ferry'], ['buford', 'Chattahoochee at Buford Dam'], ['greendale', 'Green below Flaming Gorge']]) {
      const r = R.sites[key].law;
      const tr = document.createElement('tr');
      for (const v of [name, ci(r.atNew), ci(r.atOld)]) {
        const td = document.createElement(v === name ? 'th' : 'td');
        if (v === name) td.setAttribute('scope', 'row');
        td.textContent = v;
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
    // the reference row: a simulated river that keeps clock time exactly
    const tr = document.createElement('tr');
    tr.className = 'ref-row';
    const th = document.createElement('th');
    th.setAttribute('scope', 'row');
    th.textContent = 'A simulated clock-keeper';
    tr.appendChild(th);
    for (const v of [CK.atNew.mean, CK.atOld.mean]) {
      const td = document.createElement('td');
      td.textContent = `about ${fm(v)}`;
      tr.appendChild(td);
    }
    body.appendChild(tr);
    // each era at its own change dates, which the week's overlap does not touch
    const eras = $('#eraBody');
    for (const [key, name] of [['lees', 'Colorado at Lees Ferry'], ['buford', 'Chattahoochee at Buford Dam'], ['greendale', 'Green below Flaming Gorge']]) {
      const e = R.sites[key].law.eras;
      const row = document.createElement('tr');
      const h = document.createElement('th');
      h.setAttribute('scope', 'row');
      h.textContent = name;
      row.appendChild(h);
      for (const s of [e.oldAtOld, e.newAtNew]) {
        const td = document.createElement('td');
        td.textContent = `${fm(s.mean)} (${fm(s.lo)} to ${fm(s.hi)})`;
        row.appendChild(td);
      }
      eras.appendChild(row);
    }
  })();

  // ------------------------------------------------------------ March and November apart
  /** The experiment or disturbance a window around a real change holds, if any is known. */
  function disturbance(year, season) {
    return E.disturbed.find((w) => w.year === year && w.season === season) || null;
  }
  (function stripCaption() {
    const list = (why, season) => E.disturbed.filter((w) => w.why === why && (!season || w.season === season)).map((w) => w.year);
    const and = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
    const hfM = list('a high-flow release', 'spring');
    const hfN = list('a high-flow release', 'fall');
    $('#stripCaption').textContent =
      `Hollow dots: windows that hold an experiment or a disturbance. Blue rings, the fall steady flows (Novembers ${and(list('the fall steady flows'))}). ` +
      `Orange rings, a high-flow release (March ${and(hfM)}; November ${and(hfN)}), steady releases (March ${and(list('steady releases'))}) ` +
      `or a damped daily rise and fall (November ${and(list('a damped daily cycle'))}).`;
  })();
  let picked = { year: 2016, season: 'spring' };
  function renderStrip() {
    const host = $('#strip');
    clear(host);
    const W = widthOf(host, 640);
    const m = { l: 82, r: 14, t: 26, b: 30 };
    const laneH = 64;
    const H = m.t + 2 * laneH + m.b;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'group', 'aria-label': 'Steps at Lees Ferry, year by year' }, host);
    const pw = W - m.l - m.r;
    const x = (v) => m.l + ((Math.max(-180, Math.min(180, v)) + 180) / 360) * pw;
    for (const v of [-180, -120, -60, 0, 60, 120, 180]) {
      el('line', { x1: x(v), x2: x(v), y1: m.t - 6, y2: m.t + 2 * laneH, class: v === 0 ? 'axis-line' : 'grid-line' }, svg);
      if (W < 480 && Math.abs(v) === 120) continue;
      text(svg, x(v), H - 10, `${v < 0 ? '−' : v > 0 ? '+' : ''}${Math.abs(v)}`, { 'text-anchor': v === -180 ? 'start' : v === 180 ? 'end' : 'middle', 'font-size': 12 });
    }
    text(svg, x(0), m.t - 10, 'no move', { 'text-anchor': 'middle', 'font-size': 11 });
    [['spring', 'March', -60], ['fall', 'November', 60]].forEach(([season, label, target], li) => {
      const y0 = m.t + li * laneH;
      text(svg, 4, y0 + laneH / 2 + 4, label, { 'font-size': 13, 'font-weight': 600, fill: 'var(--ink)' });
      el('line', { x1: x(target), x2: x(target), y1: y0 + 6, y2: y0 + laneH - 6, stroke: 'var(--utah)', 'stroke-width': 2, 'stroke-dasharray': '4 3' }, svg);
      text(svg, x(target) + (target < 0 ? -4 : 4), y0 + 12, 'clock time', { 'text-anchor': target < 0 ? 'end' : 'start', 'font-size': 11, fill: 'var(--utah)' });
      L.rows.forEach((row, i) => {
        const v = row[season];
        if (v === null) return;
        const yy = y0 + laneH / 2 + ((i % 3) - 1) * 12;
        const d = disturbance(row.year, season);
        const steady = d && d.why === 'the fall steady flows';
        const ring = !d ? 'var(--river)' : steady ? 'var(--river)' : 'var(--utah)';
        const isPicked = picked.year === row.year && picked.season === season;
        const g = el('g', { class: 'dot-hit', tabindex: 0, role: 'button', 'aria-label': `${label} ${row.year}: ${v === 0 ? 'no move' : `${Math.abs(v)} minutes ${v < 0 ? 'earlier' : 'later'}`}${d ? `; the window holds ${d.why}` : ''}`, 'aria-pressed': String(isPicked) }, svg);
        el('circle', { cx: x(v), cy: yy, r: 14, fill: 'transparent' }, g);
        el('circle', { cx: x(v), cy: yy, r: isPicked ? 7 : 5, fill: d ? 'var(--surface)' : 'var(--river)', stroke: isPicked ? 'var(--ink)' : ring, 'stroke-width': isPicked ? 2.5 : d ? 2 : 1.5 }, g);
        const t = el('title', {}, g);
        t.textContent = `${row.year}: ${v} min`;
        const choose = () => pick({ year: row.year, season });
        g.addEventListener('click', choose);
        g.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            choose();
          }
        });
      });
    });
  }
  const pick = throttle((p) => {
    picked = p;
    renderStrip();
    renderPair();
    const again = $$('#strip .dot-hit').find((n) => n.getAttribute('aria-pressed') === 'true');
    if (again) again.focus();
  }, 340);
  function renderPair() {
    const T = RT.transitions(picked.year, 'new')[picked.season];
    const h = RT.centreAt(lees, T);
    const svg = $('#pairplot');
    const s = RT.shiftAt(lees, T);
    if (!h || !h.before || !h.after || !s) {
      clear(svg);
      $('#pairCaption').textContent = `${picked.year}: no estimate.`;
      return;
    }
    // the after-day moved back by the step, sampled at the hour centres
    const afterCurve = RT.smoothCurve(h.after, 1);
    const shiftedBack = h.after.map((_, i) => {
      const t = Math.round((i + RT.HOUR_CENTRE) * 60 + s.step);
      return afterCurve[((t % 1440) + 1440) % 1440];
    });
    drawDayPlot(svg, [
      { profile: h.before, color: 'var(--before)', dash: '5 4', width: 2.5 },
      { profile: h.after, color: 'var(--river)', width: 2.5 },
      { profile: shiftedBack, color: 'var(--river)', width: 1.2, dash: '1 3', opacity: 0.9 },
    ], {
      height: 170,
      legend: [{ label: 'before', color: 'var(--before)', dash: '5 4' }, { label: 'after', color: 'var(--river)' }, { label: 'after, moved back', color: 'var(--river)', dash: '1 3' }],
    });
    const which = picked.season === 'spring' ? 'March' : 'November';
    const dir = s.step === 0 ? 'did not move' : `moved ${Math.abs(s.step)} minutes ${s.step < 0 ? 'earlier' : 'later'}`;
    let cap = `${which} ${picked.year} (the change was on ${dateLabel(T)}): the median day of the ${s.nBefore} usable days before and of the ${s.nAfter} after. The shapes line up best if the day ${dir}.`;
    const coh = Math.min(s.coherenceBefore, s.coherenceAfter);
    if (coh < 0.5) cap += ` One side has almost no consistent daily shape (coherence ${coh.toFixed(2)}, against about 1 for a steady daily pattern), so this step means little.`;
    if (Math.abs(s.step) === 180) cap += ' The step hit the ±3-hour limit of the search.';
    const d = disturbance(picked.year, picked.season);
    if (d) cap += ` The four weeks hold ${d.why}.`;
    $('#pairCaption').textContent = cap;
  }

  // ------------------------------------------------------------ the first method, on request
  const runBtn = $('#runFirst');
  runBtn.addEventListener('click', () => {
    if (runBtn.disabled) return;
    runBtn.disabled = true;
    const sites = DATA.sites.filter((s) => s.preregistered);
    const tbody = $('#firstTable tbody');
    clear(tbody);
    let i = 0;
    const next = () => {
      if (i >= sites.length) {
        $('#firstStatus').textContent = 'Done: the first method as registered, 2008–2025. Only the two regular rivers get a verdict.';
        runBtn.disabled = false;
        return;
      }
      const site = sites[i++];
      $('#firstStatus').textContent = `Running ${i} of ${sites.length}: ${site.short}…`;
      setTimeout(() => {
        const a = RT.analyseSite(site, RT.YEARS, { placebo: false });
        const tr = document.createElement('tr');
        const name = document.createElement('th');
        name.setAttribute('scope', 'row');
        name.textContent = site.short;
        const k = document.createElement('td');
        k.textContent = `${fm(a.K.mean)} (${fm(a.K.lo)} to ${fm(a.K.hi)}), ${a.K.n} years`;
        const v = document.createElement('td');
        v.textContent = a.verdict;
        tr.append(name, k, v);
        tbody.appendChild(tr);
        $('#firstTable').hidden = false;
        setTimeout(next, 30);
      }, 30);
    };
    next();
  });

  // ------------------------------------------------------------ layout
  function renderAll() {
    renderDayPlot();
    renderRaster();
    renderForest();
    renderStrip();
    renderPair();
  }
  renderAll();
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderAll, 150);
  });
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', () => setTimeout(renderAll, 50));
  }
})();
