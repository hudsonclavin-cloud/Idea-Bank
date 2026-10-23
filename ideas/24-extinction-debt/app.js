/* app.js — the forest, the ledger, the chart. All model logic lives in model.js. */
(function () {
  'use strict';
  const M = globalThis.ExtinctionDebt;
  const $ = (id) => document.getElementById(id);

  // ------------------------------------------------------------ colours
  // Rank palette: lightness rises with rank (dark = dominant), hue alternates green/blue with
  // parity so neighbouring ranks stay distinguishable. Validated for adjacent-pair separation.
  // The ramp is generated in OKLCH for any number of species. At S = 10 it reproduces the hexes
  // that passed the adjacent-pair separation checks: light #0c5805 … #7dbaff, dark #2f751d … #78c7fd.
  function oklchToHex(L, C, hdeg) {
    const h = (hdeg * Math.PI) / 180;
    const a = C * Math.cos(h);
    const b = C * Math.sin(h);
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.291485548 * b;
    const l = l_ * l_ * l_;
    const mm = m_ * m_ * m_;
    const s = s_ * s_ * s_;
    const lin = [
      4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
    ];
    return '#' + lin.map((x) => {
      x = Math.max(0, Math.min(1, x));
      const g = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
      return Math.round(g * 255).toString(16).padStart(2, '0');
    }).join('');
  }
  const palCache = new Map();
  function palette(S, dark) {
    const key = `${S}${dark ? 'd' : 'l'}`;
    if (palCache.has(key)) return palCache.get(key);
    const out = [];
    for (let i = 0; i < S; i++) {
      const t = S > 1 ? i / (S - 1) : 0;
      const even = i % 2 === 0;
      out.push(dark
        ? oklchToHex(0.5 + t * 0.3, even ? 0.14 : 0.11, even ? 140 : 240)
        : oklchToHex(0.4 + t * 0.38, 0.13, even ? 142 : 255));
    }
    palCache.set(key, out);
    return out;
  }
  const darkMQ = matchMedia('(prefers-color-scheme: dark)');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  function hexToRgb(h) {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function speciesColor(i) {
    return palette(st.S, darkMQ.matches)[i];
  }

  // ------------------------------------------------------------ state
  const W = 100;
  const H = 100;
  const st = {
    S: 10,
    q: 0.2,
    lifetime: 50, // years per unit of model time
    c: null,
    lat: null,
    playing: !reducedMotion,
    speed: 10, // years per second
    tool: 'cut',
    brush: 3,
    targetT: 0,
    histT: [], // model time (lifetimes)
    hist: [], // per species arrays of shares
    nextSample: 0,
    sampleEvery: 0.04, // lifetimes
    fc: null, // forecast
    fcAt: -1, // model time of the last forecast
    fcDirty: true,
    fates: [],
    ranges: null, // per species: [[lo, hi], ...] ranges of cleared fraction it survives, given who is left
    rangesKey: '',
    lastKey: '', // presence mask and cleared fraction at the previous forecast, to name why a doom began
    lastD: 0,
    doomedSince: [],
    doomedWhy: [],
    announced: [],
    events: [],
    selected: -1,
    lastDPainted: 0,
    hover: null, // chart hover x (css px)
    mapHover: null, // {cx, cy}
  };
  const m = 1; // model time in units of mean lifetime

  function newForest() {
    st.c = M.geometricRates(st.S, st.q, m);
    st.lat = new M.Lattice(W, H, st.c, m, (Math.random() * 2 ** 31) >>> 0);
    st.lat.seed(M.equilibrium(st.c, m, 0));
    st.targetT = 0;
    st.histT = [];
    st.hist = Array.from({ length: st.S }, () => []);
    st.nextSample = 0;
    st.fc = null;
    st.fcAt = -1;
    st.fcDirty = true;
    st.doomedSince = new Array(st.S).fill(-1);
    st.doomedWhy = new Array(st.S).fill('');
    st.ranges = null;
    st.rangesKey = '';
    st.lastKey = '';
    st.lastD = 0;
    st.announced = new Array(st.S).fill(false);
    st.events = [];
    st.selected = -1;
    st.lastDPainted = 0;
    sampleHistory(true);
    $('dslider').value = 0;
    buildLedger();
    buildLegend();
    refreshForecast(); // also builds the gauge ticks
    render(true);
  }

  // ------------------------------------------------------------ time & history
  const years = (t) => t * st.lifetime;
  const fmtYear = (y) => Math.round(y).toLocaleString('en-US');
  const pct = (v, d = 0) => `${(100 * v).toFixed(d)} %`;

  function sampleHistory(force) {
    const lat = st.lat;
    if (!force && lat.time < st.nextSample) return;
    const p = lat.fractions();
    st.histT.push(lat.time);
    for (let i = 0; i < st.S; i++) st.hist[i].push(p[i]);
    st.nextSample = lat.time + st.sampleEvery;
  }

  function advance(wallMs) {
    const lat = st.lat;
    st.targetT += (wallMs / 1000) * (st.speed / st.lifetime);
    const budgetEnd = performance.now() + 12;
    let steps = 0;
    while (lat.time < st.targetT) {
      lat.step();
      steps++;
      sampleHistory(false);
      if ((steps & 7) === 0 && performance.now() > budgetEnd) {
        st.targetT = lat.time; // the device can't keep up: slow down rather than pile up
        break;
      }
    }
    checkExtinctions();
  }

  // ------------------------------------------------------------ forecast & fates
  // Species i is absent and better than j: the losses that can change j's fate.
  const goneAbove = (j) => st.fates.map((f, i) => (i < j && f.kind === 'gone' ? i : -1)).filter((i) => i >= 0);
  const nameList = (arr) => arr.map((i) => `#${i + 1}`).join(', ');
  // "with #1 gone, " (or nothing): the loss that lets more land hurt species j
  const withGone = (j) => (goneAbove(j).length ? `with ${nameList(goneAbove(j))} gone, ` : '');
  // The survival range nearest to D, for a species that is doomed at D.
  function nearestRange(i, D) {
    let best = null;
    let bestDist = Infinity;
    for (const [lo, hi] of st.ranges[i]) {
      const d = D >= hi ? D - hi : D <= lo ? lo - D : 0;
      if (d < bestDist) { bestDist = d; best = [lo, hi]; }
    }
    return best;
  }
  // The nearest cleared fraction, above (dir +1) or below (dir −1) D, at which a species now
  // standing and not doomed would become doomed. Returns { i, t } or null.
  function nextFlip(dir) {
    const D = st.lat.D;
    let best = null;
    st.fates.forEach((f, i) => {
      if (f.kind === 'gone' || f.kind === 'doomed') return;
      for (const [lo, hi] of st.ranges[i]) {
        if (!(D >= lo - 1e-9 && D <= hi + 1e-9)) continue;
        if (dir > 0 && hi < 0.999 && (!best || hi < best.t)) best = { i, t: hi };
        if (dir < 0 && lo > 1e-9 && (!best || lo > best.t)) best = { i, t: lo };
      }
    });
    return best;
  }

  function refreshForecast() {
    const lat = st.lat;
    const p0 = lat.fractions();
    const D = lat.D;
    // The equilibrium is taken over the species still standing: nothing comes back from outside,
    // and who is missing changes who can persist (lose #1 and #3 needs D > q).
    const present = Array.from({ length: st.S }, (_, i) => lat.counts[i + 1] > 0);
    // horizon in lifetimes: 400 lifetimes (= 20,000 years at the default lifetime)
    st.fc = M.forecast(p0, st.c, m, D, 1 / lat.N, 400, 0.25, { dt: 0.004, minHorizon: 12, present });
    st.fcAt = lat.time;
    st.fcDirty = false;
    const key = present.map(Number).join('');
    if (key !== st.rangesKey) {
      st.ranges = M.survivalRanges(st.c, m, present, 1000);
      st.rangesKey = key;
      buildTicks();
    }
    // why would a doom that starts now have started? a loss, or the land moving
    const lost = st.lastKey ? present.map((v, i) => (!v && st.lastKey[i] === '1' ? i : -1)).filter((i) => i >= 0) : [];
    const why = lost.length
      ? `when ${lost.map((i) => `#${i + 1}`).join(', ')} died out`
      : D > st.lastD ? 'when land was cleared' : D < st.lastD ? 'when land was given back' : '';
    const eqLo = M.equilibrium(st.c, m, Math.max(0, D - 0.01), present);
    const eqHi = M.equilibrium(st.c, m, Math.min(1, D + 0.01), present);
    const fates = [];
    for (let i = 0; i < st.S; i++) {
      const eqN = st.fc.eq[i] * lat.N;
      let kind;
      if (!present[i]) kind = 'gone';
      else if (st.fc.doomed[i]) kind = 'doomed';
      else if (st.fc.edge[i]) kind = 'edge';
      else if (eqN < 10) kind = 'risk';
      else kind = 'safe';
      if (kind === 'doomed' && st.doomedSince[i] < 0) {
        st.doomedSince[i] = lat.time;
        st.doomedWhy[i] = why;
      }
      if (kind !== 'doomed' && kind !== 'gone') st.doomedSince[i] = -1;
      const edgeN = kind === 'edge' ? Math.min(eqLo[i], eqHi[i]) * lat.N : 0;
      fates.push({ kind, eta: st.fc.eta[i], eq: st.fc.eq[i], eqN, edgeN });
    }
    st.fates = fates;
    st.lastKey = key;
    st.lastD = D;
  }

  function checkExtinctions() {
    const lat = st.lat;
    for (let i = 0; i < st.S; i++) {
      if (lat.counts[i + 1] === 0 && !st.announced[i]) {
        st.announced[i] = true;
        const since = st.doomedSince[i];
        const f = st.fates[i];
        const eqShare = f ? f.eq : 0;
        const y = fmtYear(years(lat.extinctAt[i]));
        let text;
        if (since >= 0) {
          const why = st.doomedWhy[i];
          text = `Year ${y}: the last #${i + 1} died. It had been doomed since year ${fmtYear(years(since))}${why ? `, ${why}` : ''}.`;
        } else if (f && f.kind === 'edge') {
          text = `Year ${y}: the last #${i + 1} died. It was on a knife-edge: at exactly this much clearing the model gives it a long-run share of zero, approached slowly, and chance finished it first.`;
        } else {
          text = `Year ${y}: the last #${i + 1} died. The model did not doom it (it would settle at ${pct(eqShare, 1)}); in a finite forest, chance can finish a species while it is rare.`;
        }
        st.events.push({ cls: 'loss', text });
        flashRow(i);
        toast(`Year ${fmtYear(years(lat.extinctAt[i]))} · the last #${i + 1} died${since >= 0 ? `, doomed since year ${fmtYear(years(since))}` : ', by chance'}`);
        st.fcDirty = true;
      }
    }
  }

  let toastTimer = 0;
  function toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.hidden = false;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove('show');
      el.hidden = true;
    }, 4500);
  }

  // ------------------------------------------------------------ map
  const map = $('map');
  const mctx = map.getContext('2d');
  const off = document.createElement('canvas');
  off.width = W;
  off.height = H;
  const octx = off.getContext('2d');
  const img = octx.createImageData(W, H);
  let scale = 4;
  let cssSize = 400;

  function sizeMap() {
    const wrap = map.parentElement;
    const avail = Math.max(120, Math.min(wrap.clientWidth, 720));
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    scale = Math.max(1, Math.floor((avail * dpr) / W));
    map.width = W * scale;
    map.height = H * scale;
    cssSize = (W * scale) / dpr;
    map.style.width = cssSize + 'px';
    map.style.height = cssSize + 'px';
  }

  function drawMap() {
    const lat = st.lat;
    const pal = palette(st.S, darkMQ.matches).map(hexToRgb);
    const ground = hexToRgb(cssVar('--ground'));
    const cleared = hexToRgb(cssVar('--cleared'));
    const d = img.data;
    const state = lat.state;
    for (let k = 0, o = 0; k < lat.N; k++, o += 4) {
      const s = state[k];
      const rgb = s === M.DESTROYED ? cleared : s === M.EMPTY ? ground : pal[s - 1];
      d[o] = rgb[0];
      d[o + 1] = rgb[1];
      d[o + 2] = rgb[2];
      d[o + 3] = 255;
    }
    octx.putImageData(img, 0, 0);
    mctx.imageSmoothingEnabled = false;
    mctx.drawImage(off, 0, 0, map.width, map.height);
    if (st.mapHover) {
      const { cx, cy } = st.mapHover;
      mctx.beginPath();
      mctx.arc((cx + 0.5) * scale, (cy + 0.5) * scale, (st.brush + 0.5) * scale, 0, Math.PI * 2);
      mctx.lineWidth = Math.max(1, scale * 0.4);
      mctx.strokeStyle = st.tool === 'cut' ? 'rgba(255,255,255,0.9)' : 'rgba(255,230,120,0.95)';
      mctx.stroke();
      mctx.lineWidth = Math.max(1, scale * 0.4);
      mctx.strokeStyle = 'rgba(0,0,0,0.5)';
      mctx.setLineDash([scale, scale]);
      mctx.stroke();
      mctx.setLineDash([]);
    }
  }

  function cellFromEvent(e) {
    const r = map.getBoundingClientRect();
    const cx = Math.floor(((e.clientX - r.left) / r.width) * W);
    const cy = Math.floor(((e.clientY - r.top) / r.height) * H);
    return { cx, cy };
  }

  function paint(cx, cy) {
    const lat = st.lat;
    const r = st.brush;
    let changed = false;
    for (let dy = -r; dy <= r; dy++) {
      const y = cy + dy;
      if (y < 0 || y >= H) continue;
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx;
        if (x < 0 || x >= W || dx * dx + dy * dy > r * r + r * 0.5) continue;
        const k = y * W + x;
        changed = (st.tool === 'cut' ? lat.destroySite(k) : lat.restoreSite(k)) || changed;
      }
    }
    return changed;
  }

  let painting = false;
  let lastCell = null;
  let paintChanged = false;
  function strokeTo(cell) {
    if (!lastCell) {
      paintChanged = paint(cell.cx, cell.cy) || paintChanged;
    } else {
      const n = Math.max(Math.abs(cell.cx - lastCell.cx), Math.abs(cell.cy - lastCell.cy), 1);
      for (let s = 1; s <= n; s++) {
        const x = Math.round(lastCell.cx + ((cell.cx - lastCell.cx) * s) / n);
        const y = Math.round(lastCell.cy + ((cell.cy - lastCell.cy) * s) / n);
        paintChanged = paint(x, y) || paintChanged;
      }
    }
    lastCell = cell;
  }
  map.addEventListener('pointerdown', (e) => {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    map.setPointerCapture(e.pointerId);
    painting = true;
    lastCell = null;
    paintChanged = false;
    st.lastDPainted = st.lat.D;
    strokeTo(cellFromEvent(e));
    st.fcDirty = true;
    render(true);
  });
  map.addEventListener('pointermove', (e) => {
    const cell = cellFromEvent(e);
    if (e.pointerType !== 'touch') st.mapHover = cell;
    if (!painting) {
      if (!st.playing) drawMap();
      return;
    }
    e.preventDefault();
    strokeTo(cell);
    st.fcDirty = true;
    if (!st.playing) render(true);
  });
  function endPaint() {
    if (!painting) return;
    painting = false;
    lastCell = null;
    if (paintChanged) {
      const D = st.lat.D;
      logLandChange(st.lastDPainted, D, st.tool === 'cut' ? 'cleared' : 'restored');
    }
    st.fcDirty = true;
    render(true);
  }
  map.addEventListener('pointerup', endPaint);
  map.addEventListener('pointercancel', endPaint);
  map.addEventListener('pointerleave', () => {
    st.mapHover = null;
    if (!st.playing) drawMap();
  });

  function logLandChange(from, to, verb) {
    if (Math.abs(to - from) < 0.0005) return;
    refreshForecast();
    const doomed = st.fates.map((f, i) => (f.kind === 'doomed' ? i : -1)).filter((i) => i >= 0);
    const anyGone = st.fates.some((f) => f.kind === 'gone');
    const y = fmtYear(years(st.lat.time));
    let text = `Year ${y}: ${verb} land from ${pct(from)} to ${pct(to)}.`;
    // doomed species that more land cannot save: their only hope is more clearing
    const byLand = doomed.filter((i) => {
      const r = nearestRange(i, to);
      return r && to <= r[0] + 1e-9;
    });
    if (doomed.length > 0) {
      text += ` Doomed now: ${doomed.map((i) => `#${i + 1}`).join(', ')}.${anyGone ? '' : ' Nothing has died yet.'}`;
      if (verb === 'restored' && byLand.length) {
        const j = byLand[0];
        text += ` Giving land back doomed #${j + 1}: ${withGone(j)}more land now helps its rivals more than it helps #${j + 1}.`;
      }
    } else if (to < from) {
      text += ' Nothing is owed any more.';
    } else {
      text += ' Nothing is owed yet.';
    }
    const cls = doomed.length > 0 && (verb === 'cleared' || byLand.length) ? 'loss' : verb === 'restored' ? 'save' : '';
    st.events.push({ cls, text });
    $('dslider').value = Math.round(100 * to);
  }

  // ------------------------------------------------------------ gauge, ledger, headline
  // Gauge ticks: where each species still standing changes fate. "#k" is a ceiling (clear past it
  // and #k is doomed); "‹#k" is a floor, which appears only after a loss (give back land below it
  // and #k is doomed). With every species present the ceilings are 1 − (1−q)^(2k−1).
  function buildTicks() {
    const el = $('ticks');
    el.innerHTML = '';
    const ticks = [];
    (st.ranges || []).forEach((rs, i) => rs.forEach(([lo, hi]) => {
      if (hi <= 0.95) ticks.push({ t: hi, i, dir: 'up' });
      if (lo > 1e-9 && lo <= 0.95) ticks.push({ t: lo, i, dir: 'down' });
    }));
    ticks.sort((a, b) => a.t - b.t);
    let lastLabel = -1;
    for (const tk of ticks) {
      const sp = document.createElement('span');
      // label a tick only when there is room; the rest stay as bare marks
      if (tk.t - lastLabel > 0.07) {
        sp.textContent = tk.dir === 'down' ? `‹#${tk.i + 1}` : `#${tk.i + 1}`;
        lastLabel = tk.t;
      }
      sp.title = tk.dir === 'down'
        ? `#${tk.i + 1} is doomed if less than ${pct(tk.t, 1)} is cleared`
        : `#${tk.i + 1} is doomed if ${pct(tk.t, 1)} or more is cleared`;
      if (tk.dir === 'down') sp.classList.add('floor');
      sp.style.left = `${(100 * tk.t) / 0.95}%`;
      sp.dataset.t = tk.t;
      sp.dataset.i = tk.i;
      sp.dataset.dir = tk.dir;
      el.appendChild(sp);
    }
  }

  function buildLegend() {
    const el = $('legendInline');
    el.innerHTML = '';
    const add = (color, label) => {
      const s = document.createElement('span');
      const i = document.createElement('i');
      i.style.background = color;
      s.appendChild(i);
      s.appendChild(document.createTextNode(label));
      el.appendChild(s);
    };
    add(speciesColor(0), '#1 best competitor');
    add(speciesColor(1), '#2');
    add(speciesColor(st.S - 1), `#${st.S} best coloniser`);
    add(cssVar('--ground'), 'bare ground');
    add(cssVar('--cleared'), 'cleared');
  }

  const rowEls = [];
  function buildLedger() {
    const rows = $('rows');
    rows.innerHTML = '';
    rowEls.length = 0;
    for (let i = 0; i < st.S; i++) {
      const row = document.createElement('div');
      row.className = 'lrow';
      row.innerHTML =
        `<span class="rank"><span class="sw"></span>#${i + 1}</span>` +
        `<span class="bar"><i></i><b></b></span>` +
        `<span class="n"></span>` +
        `<span class="fate"></span>`;
      row.addEventListener('click', () => {
        st.selected = st.selected === i ? -1 : i;
        render(true);
      });
      rows.appendChild(row);
      rowEls.push({
        row,
        sw: row.querySelector('.sw'),
        bar: row.querySelector('.bar'),
        fill: row.querySelector('.bar i'),
        tick: row.querySelector('.bar b'),
        n: row.querySelector('.n'),
        fate: row.querySelector('.fate'),
      });
    }
  }

  function flashRow(i) {
    const r = rowEls[i];
    if (!r) return;
    r.row.classList.remove('flash');
    void r.row.offsetWidth;
    r.row.classList.add('flash');
  }

  function fateText(i) {
    const f = st.fates[i];
    const lat = st.lat;
    if (!f) return ['', ''];
    const now = lat.time;
    if (f.kind === 'gone') return ['gone', `<span class="sub">year ${fmtYear(years(lat.extinctAt[i]))}</span>`];
    if (f.kind === 'doomed') {
      const when = f.eta === Infinity ? `after year ${fmtYear(years(now + 400))}` : `≈ year ${fmtYear(years(now + f.eta))}`;
      const r = nearestRange(i, lat.D);
      let save = 'nothing can save it now';
      if (r) {
        const [lo, hi] = r;
        if (lo <= 1e-9) save = `save it: clear &lt; ${pct(hi, 1)}`;
        else save = `save it: clear ${pct(lo, 1)}–${pct(hi, 1)}`;
      }
      return ['doomed', `<span class="sub">gone by ${when}</span><span class="sub">${save}</span>`];
    }
    if (f.kind === 'edge') return ['knife-edge', `<span class="sub">long-run share 0 only at exactly ${pct(lat.D, 2)}; ±1 %: ~${Math.max(1, Math.round(f.edgeN))} sites</span>`];
    if (f.kind === 'risk') return ['precarious', `<span class="sub">settles at ~${Math.max(1, Math.round(f.eqN))} of ${lat.N.toLocaleString('en-US')} · chance may finish it</span>`];
    return ['safe', `<span class="sub">settles at ${pct(f.eq, 1)}</span>`];
  }

  const BAR_MAX = 0.4;
  function updateLedger() {
    const lat = st.lat;
    const p = lat.fractions();
    for (let i = 0; i < st.S; i++) {
      const r = rowEls[i];
      const f = st.fates[i];
      r.sw.style.background = speciesColor(i);
      r.fill.style.background = speciesColor(i);
      r.fill.style.width = `${Math.min(100, (100 * p[i]) / BAR_MAX)}%`;
      r.bar.classList.toggle('rare', lat.counts[i + 1] > 0 && p[i] < 0.004);
      const eq = f ? f.eq : 0;
      r.tick.style.left = `${Math.min(100, (100 * eq) / BAR_MAX)}%`;
      r.tick.style.display = eq > 0 ? '' : 'none';
      r.n.textContent = lat.counts[i + 1].toLocaleString('en-US');
      const [kind, sub] = fateText(i);
      r.fate.className = `fate ${f ? f.kind : ''}`;
      r.fate.innerHTML = `<span class="k">${kind}</span>${sub}`;
      r.row.classList.toggle('sel', st.selected === i);
    }
  }

  function updateHeadline() {
    const lat = st.lat;
    const D = lat.D;
    const doomed = st.fates.map((f, i) => (f.kind === 'doomed' ? i : -1)).filter((i) => i >= 0);
    const gone = st.fates.map((f, i) => (f.kind === 'gone' ? i : -1)).filter((i) => i >= 0);
    const risky = st.fates.map((f, i) => (f.kind === 'risk' ? i : -1)).filter((i) => i >= 0);
    const edgy = st.fates.map((f, i) => (f.kind === 'edge' ? i : -1)).filter((i) => i >= 0);
    const debtN = $('debtN');
    debtN.textContent = doomed.length;
    debtN.classList.toggle('owed', doomed.length > 0);
    $('debtUnit').textContent = doomed.length === 1 ? 'species' : 'species';
    const names = (arr) => arr.map((i) => `#${i + 1}`).join(', ');
    let v;
    if (D === 0 && gone.length === 0) {
      v = `The forest is at its equilibrium: ${st.S} species sharing one patch of land, the best competitor the commonest. Nothing is owed. Clear some land and see what changes, and what doesn't.`;
    } else if (doomed.length === 0) {
      const up = nextFlip(+1);
      const down = nextFlip(-1);
      v = `${pct(D)} of the land is cleared and nothing is owed: every species still standing can hold on.`;
      if (gone.length) v += ` Already paid: ${names(gone)}.`;
      if (up) v += ` Clear past ${pct(up.t, 1)} and #${up.i + 1} is doomed.`;
      if (down) v += ` Give back land below ${pct(down.t, 1)} and #${down.i + 1} is doomed: ${withGone(down.i)}more land would help its rivals more than it helps #${down.i + 1}.`;
    } else {
      const firstDue = doomed.reduce((a, i) => (st.fates[i].eta < st.fates[a].eta ? i : a), doomed[0]);
      const eta = st.fates[firstDue].eta;
      v = `${doomed.length === 1 ? `#${firstDue + 1} is` : `${names(doomed)} are`} doomed and still standing.`;
      if (gone.length === 0) v += ' Nothing has gone extinct yet.';
      else v += ` ${names(gone)} already paid.`;
      v += eta === Infinity ? ` The first payment is more than ${fmtYear(years(400))} years away.` : ` First payment due by about year ${fmtYear(years(lat.time + eta))}, within ${fmtYear(years(eta))} years or so.`;
      const needClearing = doomed.filter((i) => {
        const r = nearestRange(i, D);
        return r && D <= r[0] + 1e-9;
      });
      if (needClearing.length === 0) v += ' Restore enough land before then and the debt is cancelled.';
      else v += ` Giving land back would not save ${names(needClearing)}: ${withGone(needClearing[0])}more land helps its rivals more. Each row says what would.`;
    }
    if (edgy.length) v += ` ${names(edgy)} ${edgy.length === 1 ? 'sits' : 'sit'} on a knife-edge: at exactly ${pct(D, 2)} cleared ${edgy.length === 1 ? 'its' : 'their'} long-run share in the model is zero, but one site more or less and ${edgy.length === 1 ? 'it settles' : 'they settle'} at a small positive share.`;
    if (risky.length) v += ` ${names(risky)} ${risky.length === 1 ? 'is' : 'are'} precarious: the model leaves ${risky.length === 1 ? 'it' : 'them'} only a handful of sites.`;
    $('verdict').textContent = v;

    // gauge
    $('dOut').textContent = pct(D);
    for (const sp of $('ticks').children) {
      const t = Number(sp.dataset.t);
      const f = st.fates[Number(sp.dataset.i)];
      const beyond = sp.dataset.dir === 'down' ? D <= t + 1e-9 : D >= t - 1e-9;
      sp.classList.toggle('passed', beyond && !!f && f.kind === 'doomed');
    }
    const upNext = nextFlip(+1);
    const hasFloor = [...$('ticks').children].some((sp) => sp.dataset.dir === 'down');
    let note = upNext
      ? `Ticks are the thresholds of the species still standing. Next: #${upNext.i + 1} is doomed past ${pct(upNext.t, 1)}.`
      : 'No species still standing has a threshold above this.';
    if (hasFloor) note += ' A tick marked ‹ is a floor: after a loss, giving land back below it dooms that species.';
    note += ' Only the amount matters here, not the shape.';
    $('gaugeNote').textContent = note;

    // hud
    $('hudYear').textContent = fmtYear(years(lat.time));
    const alive = st.fates.filter((f) => f.kind !== 'gone').length;
    $('hudState').textContent = `${alive} of ${st.S} species · ${pct(D)} cleared${doomed.length ? ` · ${doomed.length} doomed` : ''}`;
    $('hudHint').textContent = st.playing ? (st.tool === 'cut' ? 'drag to clear land' : 'drag to restore land') : 'paused · press play';

    // proof numbers
    $('pq').textContent = st.q.toFixed(2);
    $('pN').textContent = lat.N.toLocaleString('en-US');
    $('thrList').textContent = Array.from({ length: st.S }, (_, k) => `#${k + 1}: ${pct(M.geometricThreshold(k + 1, st.q), 1)}`).join('   ');
    const r1 = M.topSpeciesRate(st.c[0], m, D) / st.lifetime;
    $('rNow').textContent = D > 0
      ? `Right now D = ${pct(D, 1)}, so r = ${r1 >= 0 ? '+' : '−'}${Math.abs(r1).toPrecision(2)} per year` + (r1 < 0 ? `, a time constant of ${fmtYear(1 / Math.abs(r1))} years.` : ': #1 still grows back toward its new level.')
      : 'Nothing is cleared, so r = m q/(1−q) > 0 and #1 holds its full share.';

    // events
    const ev = $('events');
    ev.innerHTML = '';
    for (const e of st.events.slice(-8).reverse()) {
      const li = document.createElement('li');
      li.className = e.cls;
      li.textContent = e.text;
      ev.appendChild(li);
    }
  }

  // ------------------------------------------------------------ chart
  const chart = $('chart');
  const cctx = chart.getContext('2d');
  const tip = $('tip');
  let chartGeom = null;

  function sizeChart() {
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const r = chart.getBoundingClientRect();
    chart.width = Math.round(r.width * dpr);
    chart.height = Math.round(r.height * dpr);
    cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function emphasised() {
    const set = new Set();
    if (st.selected >= 0) {
      set.add(st.selected);
      return set;
    }
    set.add(0);
    if (st.S > 1) set.add(1);
    st.fates.forEach((f, i) => {
      if (f.kind !== 'safe') set.add(i);
    });
    return set;
  }

  function niceStep(span, target) {
    const raw = span / target;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const k of [1, 2, 2.5, 5, 10]) if (k * p >= raw) return k * p;
    return 10 * p;
  }

  function drawChart() {
    const lat = st.lat;
    const r = chart.getBoundingClientRect();
    const Wc = r.width;
    const Hc = r.height;
    if (Wc < 10) return;
    const ink = cssVar('--ink');
    const muted = cssVar('--muted');
    const line = cssVar('--line-2');
    const pad = { l: 38, r: 30, t: 10, b: 22 };
    const nowY = years(lat.time);
    const fc = st.fc;
    const fcSpan = fc ? years(fc.trajectory.t[fc.trajectory.t.length - 1]) : 0;
    const xmax = Math.max(nowY * 1.08, nowY + fcSpan, years(6));
    let ymax = 0.05;
    const stride = Math.max(1, Math.floor(st.histT.length / 700));
    for (let i = 0; i < st.S; i++) {
      const h = st.hist[i];
      for (let k = 0; k < h.length; k += stride) if (h[k] > ymax) ymax = h[k];
      if (fc) for (const row of fc.trajectory.p) if (row[i] > ymax) ymax = row[i];
    }
    ymax = Math.min(1, ymax * 1.12);
    const X = (y) => pad.l + ((Wc - pad.l - pad.r) * y) / xmax;
    const Y = (v) => Hc - pad.b - ((Hc - pad.t - pad.b) * v) / ymax;
    chartGeom = { X, Y, xmax, ymax, pad, Wc, Hc };

    cctx.clearRect(0, 0, Wc, Hc);
    cctx.font = '11px system-ui, sans-serif';
    cctx.textBaseline = 'middle';
    // grid
    const ystep = niceStep(ymax, 4);
    cctx.strokeStyle = line;
    cctx.lineWidth = 1;
    cctx.fillStyle = muted;
    cctx.textAlign = 'right';
    for (let v = 0; v <= ymax + 1e-9; v += ystep) {
      cctx.beginPath();
      cctx.moveTo(pad.l, Y(v));
      cctx.lineTo(Wc - pad.r, Y(v));
      cctx.globalAlpha = v === 0 ? 1 : 0.6;
      cctx.stroke();
      cctx.globalAlpha = 1;
      cctx.fillText(`${Math.round(100 * v)}%`, pad.l - 6, Y(v));
    }
    const xstep = niceStep(xmax, 5);
    cctx.textAlign = 'center';
    cctx.textBaseline = 'top';
    for (let y = 0; y <= xmax + 1e-9; y += xstep) {
      cctx.fillText(fmtYear(y), X(y), Hc - pad.b + 5);
    }
    cctx.textBaseline = 'middle';

    // forecast region tint
    cctx.fillStyle = ink;
    cctx.globalAlpha = 0.04;
    cctx.fillRect(X(nowY), pad.t, Wc - pad.r - X(nowY), Hc - pad.t - pad.b);
    cctx.globalAlpha = 1;

    const emph = emphasised();
    const order = [];
    for (let i = 0; i < st.S; i++) if (!emph.has(i)) order.push(i);
    for (let i = 0; i < st.S; i++) if (emph.has(i)) order.push(i);
    for (const i of order) {
      const on = emph.has(i);
      cctx.strokeStyle = on ? speciesColor(i) : muted;
      cctx.globalAlpha = on ? 1 : 0.35;
      cctx.lineWidth = on ? 2 : 1;
      cctx.setLineDash([]);
      cctx.beginPath();
      const h = st.hist[i];
      for (let k = 0; k < h.length; k += stride) {
        const x = X(years(st.histT[k]));
        const y = Y(h[k]);
        if (k === 0) cctx.moveTo(x, y);
        else cctx.lineTo(x, y);
      }
      // always end at the live value
      cctx.lineTo(X(nowY), Y(lat.counts[i + 1] / lat.N));
      cctx.stroke();
      if (fc && lat.counts[i + 1] > 0) {
        cctx.setLineDash([5, 4]);
        if (!on) cctx.globalAlpha = 0.22;
        cctx.beginPath();
        const tr = fc.trajectory;
        const t0 = years(st.fcAt);
        for (let k = 0; k < tr.t.length; k++) {
          const x = X(t0 + years(tr.t[k]));
          const y = Y(tr.p[k][i]);
          if (k === 0) cctx.moveTo(x, y);
          else cctx.lineTo(x, y);
        }
        cctx.stroke();
        cctx.setLineDash([]);
      }
      cctx.globalAlpha = 1;
    }
    // direct labels for emphasised lines at the right end
    cctx.textAlign = 'left';
    const used = [];
    for (const i of order) {
      if (!emph.has(i)) continue;
      let v = lat.counts[i + 1] / lat.N;
      let x = X(nowY);
      if (fc && lat.counts[i + 1] > 0) {
        const tr = fc.trajectory;
        v = tr.p[tr.p.length - 1][i];
        x = X(years(st.fcAt) + years(tr.t[tr.t.length - 1]));
      }
      let y = Math.max(pad.t + 6, Math.min(Hc - pad.b - 6, Y(v)));
      for (const u of used) if (Math.abs(u - y) < 11) y = u - 11;
      used.push(y);
      cctx.fillStyle = ink;
      cctx.fillText(`#${i + 1}`, Math.min(x + 4, Wc - pad.r + 4), y);
    }
    // now line
    cctx.strokeStyle = ink;
    cctx.globalAlpha = 0.5;
    cctx.setLineDash([2, 3]);
    cctx.beginPath();
    cctx.moveTo(X(nowY), pad.t);
    cctx.lineTo(X(nowY), Hc - pad.b);
    cctx.stroke();
    cctx.setLineDash([]);
    cctx.globalAlpha = 1;
    // hover crosshair
    if (st.hover != null) drawHover();
  }

  function drawHover() {
    const g = chartGeom;
    if (!g) return;
    const x = st.hover;
    if (x < g.pad.l || x > g.Wc - g.pad.r) {
      tip.hidden = true;
      return;
    }
    const yr = ((x - g.pad.l) / (g.Wc - g.pad.l - g.pad.r)) * g.xmax;
    cctx.strokeStyle = cssVar('--muted');
    cctx.globalAlpha = 0.7;
    cctx.beginPath();
    cctx.moveTo(x, g.pad.t);
    cctx.lineTo(x, g.Hc - g.pad.b);
    cctx.stroke();
    cctx.globalAlpha = 1;
    const nowY = years(st.lat.time);
    const emph = emphasised();
    const lines = [`<b>Year ${fmtYear(yr)}</b>${yr > nowY ? ' · forecast' : ''}`];
    const vals = [];
    if (yr <= nowY) {
      const tl = yr / st.lifetime;
      let k = 0;
      const T = st.histT;
      let lo = 0;
      let hi = T.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (T[mid] < tl) lo = mid + 1;
        else hi = mid;
      }
      k = lo;
      for (let i = 0; i < st.S; i++) vals.push(st.hist[i][k]);
    } else if (st.fc) {
      const tr = st.fc.trajectory;
      const tl = (yr - years(st.fcAt)) / st.lifetime;
      let k = 0;
      while (k < tr.t.length - 1 && tr.t[k] < tl) k++;
      for (let i = 0; i < st.S; i++) vals.push(tr.p[k][i]);
    }
    const show = [...emph].sort((a, b) => a - b).slice(0, 6);
    for (const i of show) if (vals[i] != null) lines.push(`<i style="background:${speciesColor(i)}"></i>#${i + 1} ${pct(vals[i], 1)}`);
    tip.innerHTML = lines.join('<br>');
    tip.hidden = false;
    const tw = tip.offsetWidth;
    tip.style.left = `${x + 12 + tw > g.Wc ? x - 12 - tw : x + 12}px`;
    tip.style.top = `${g.pad.t}px`;
  }

  chart.addEventListener('pointermove', (e) => {
    const r = chart.getBoundingClientRect();
    st.hover = e.clientX - r.left;
    if (!st.playing) drawChart();
  });
  chart.addEventListener('pointerleave', () => {
    st.hover = null;
    tip.hidden = true;
    if (!st.playing) drawChart();
  });

  // ------------------------------------------------------------ controls
  function setPressed(groupId, value) {
    for (const b of $(groupId).querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === String(value)));
  }
  function setPlaying(v) {
    st.playing = v;
    $('play').textContent = v ? 'Pause' : 'Play';
    $('play').setAttribute('aria-label', v ? 'Pause' : 'Play');
    last = performance.now();
    render(true);
  }
  $('play').addEventListener('click', () => setPlaying(!st.playing));
  $('speed').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    st.speed = Number(b.dataset.v);
    setPressed('speed', st.speed);
  });
  $('tool').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    st.tool = b.dataset.v;
    setPressed('tool', st.tool);
    updateHeadline();
  });
  $('brush').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    st.brush = Number(b.dataset.v);
    setPressed('brush', st.brush);
  });
  $('newForest').addEventListener('click', () => newForest());

  let sliderFrom = null;
  const dslider = $('dslider');
  function applySlider() {
    const target = Number(dslider.value) / 100;
    const lat = st.lat;
    if (sliderFrom == null) sliderFrom = lat.D;
    if (target > lat.D + 1e-9) lat.destroyRandom(target);
    else if (target < lat.D - 1e-9) lat.restoreRandom(target);
    st.fcDirty = true;
    render(true);
  }
  dslider.addEventListener('pointerdown', () => { sliderFrom = st.lat.D; });
  dslider.addEventListener('keydown', () => { if (sliderFrom == null) sliderFrom = st.lat.D; });
  dslider.addEventListener('input', applySlider);
  dslider.addEventListener('change', () => {
    const from = sliderFrom == null ? st.lat.D : sliderFrom;
    sliderFrom = null;
    const to = st.lat.D;
    logLandChange(from, to, to >= from ? 'cleared' : 'restored');
    render(true);
  });

  $('life').addEventListener('input', (e) => {
    st.lifetime = Number(e.target.value);
    $('lifeOut').textContent = `${st.lifetime} yr`;
    render(true);
  });
  $('q').addEventListener('change', (e) => {
    st.q = Number(e.target.value);
    $('qOut').textContent = st.q.toFixed(2);
    newForest();
  });
  $('q').addEventListener('input', (e) => { $('qOut').textContent = Number(e.target.value).toFixed(2); });
  $('s').addEventListener('change', (e) => {
    st.S = Number(e.target.value);
    $('sOut').textContent = st.S;
    newForest();
  });
  $('s').addEventListener('input', (e) => { $('sOut').textContent = e.target.value; });

  document.addEventListener('keydown', (e) => {
    if (e.target && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.target.tagName)) return;
    const k = e.key;
    if (k === ' ') { e.preventDefault(); setPlaying(!st.playing); }
    else if (k === 'c' || k === 'C') { st.tool = 'cut'; setPressed('tool', 'cut'); updateHeadline(); }
    else if (k === 'r' || k === 'R') { st.tool = 'restore'; setPressed('tool', 'restore'); updateHeadline(); }
    else if (k === 'n' || k === 'N') newForest();
    else if (k === 'ArrowUp' || k === 'ArrowDown') {
      const speeds = [10, 50, 200];
      let i = speeds.indexOf(st.speed);
      i = Math.max(0, Math.min(2, i + (k === 'ArrowUp' ? 1 : -1)));
      st.speed = speeds[i];
      setPressed('speed', st.speed);
    } else if (k === 'ArrowRight' || k === 'ArrowLeft') {
      const from = st.lat.D;
      dslider.value = Math.max(0, Math.min(95, Number(dslider.value) + (k === 'ArrowRight' ? 1 : -1)));
      applySlider();
      logLandChange(from, st.lat.D, st.lat.D >= from ? 'cleared' : 'restored');
      render(true);
    }
  });

  // ------------------------------------------------------------ render loop
  let last = performance.now();
  let lastSlow = 0;
  function render(force) {
    const now = performance.now();
    if (st.fcDirty || now - lastSlow > 1000 || force) {
      if (st.fcDirty || st.lat.time - st.fcAt > 0.02 || force) refreshForecast();
      updateLedger();
      updateHeadline();
      lastSlow = now;
    }
    drawMap();
    drawChart();
  }
  function frame(now) {
    const dt = Math.min(100, now - last);
    last = now;
    if (st.playing) {
      advance(dt);
      render(false);
    }
    requestAnimationFrame(frame);
  }

  function resize() {
    sizeMap();
    sizeChart();
    render(true);
  }
  window.addEventListener('resize', resize);
  darkMQ.addEventListener('change', () => { buildLegend(); render(true); });

  // ------------------------------------------------------------ go
  setPressed('speed', st.speed);
  setPressed('tool', st.tool);
  setPressed('brush', st.brush);
  $('play').textContent = st.playing ? 'Pause' : 'Play';
  sizeMap();
  sizeChart();
  newForest();
  if (reducedMotion) st.events.push({ cls: '', text: 'Reduced motion is on, so the forest starts paused. Press play (or space) when you are ready.' });
  render(true);
  requestAnimationFrame(frame);
})();
