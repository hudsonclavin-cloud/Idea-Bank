/*
 * app.js: the page. Draws the charts, takes answers, shows what really
 * happened, and asks trainer.js what comes next. All the arithmetic is in
 * tub.js, all the sentences in words.js, all the exercises in bank.js.
 */
(function () {
  'use strict';

  const T = window.Tub;
  const B = window.TubBank;
  const W = window.TubWords;
  const R = window.TubTrainer;
  const KEY = 'still-rising-v1';
  const SVGNS = 'http://www.w3.org/2000/svg';
  const $ = (id) => document.getElementById(id);

  const reducedMotion = () => {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) {
      return false;
    }
  };

  /* ---------------- storage ---------------- */
  function load() {
    try {
      return R.clean(window.localStorage.getItem(KEY), B);
    } catch (e) {
      return R.fresh();
    }
  }
  function save() {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      /* private mode or storage blocked: the page still works, it just forgets */
    }
  }

  let state = load();
  let cur = null; // the question on screen
  let chartSeq = 0;

  /* ---------------- small helpers ---------------- */
  function el(name, attrs, parent) {
    const e = document.createElementNS(SVGNS, name);
    if (attrs) for (const k of Object.keys(attrs)) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function h(tag, attrs, text) {
    const e = document.createElement(tag);
    if (attrs) for (const k of Object.keys(attrs)) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function niceTicks(lo, hi, n) {
    const raw = (hi - lo) / Math.max(1, n);
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    let step = p;
    for (const m of [1, 2, 2.5, 5, 10]) {
      if (m * p >= raw - 1e-9) {
        step = m * p;
        break;
      }
    }
    const out = [];
    for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
    return out;
  }
  function tickText(v) {
    if (Math.abs(v) >= 100000) return T.fmtNum(v / 1000) + 'k';
    return T.fmtNum(v, Math.abs(v - Math.round(v)) < 1e-9 ? 0 : 1);
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  /* ---------------- the chart ---------------- */
  // Builds the two-panel chart for an item: flows on top, the level beneath,
  // and a little tub at the right of the level panel. `mode` is one of
  // 'tap' | 'dir' | 'amount' | 'sketch' | 'static'. Returns an object of
  // drawing functions; the question state lives in `cur`, not in here.
  function buildChart(host, item, mode, opts) {
    opts = opts || {};
    host.textContent = '';
    const small = !!opts.small;
    const Wd = Math.max(240, Math.round(host.clientWidth || 340));
    const t0 = item.time.from;
    const t1 = item.time.to;
    const fMax = T.niceCeil(T.maxFlow(item) * 1.08);
    const axis = T.stockAxis(item);
    const sFloor = axis[0];
    const sTop = axis[1];
    const fTicks = niceTicks(0, fMax, small ? 2 : 4);
    const sTicks = niceTicks(sFloor, sTop, small ? 2 : 4);
    const chars = Math.max(...fTicks.concat(sTicks).map((v) => tickText(v).length));
    const padL = Math.max(26, Math.round(chars * 6.4 + 10));
    const padR = small ? 8 : 34;
    const top = small ? 8 : 22;
    const H1 = small ? Math.round(Wd * 0.3) : Math.round(clamp(Wd * 0.38, 140, 205));
    const gap = small ? 12 : 26;
    const H2 = small ? Math.round(Wd * 0.24) : Math.round(clamp(Wd * 0.3, 105, 160));
    const bottom = 22;
    const Ht = top + H1 + gap + H2 + bottom;
    const plotW = Wd - padL - padR;
    const X = (t) => padL + ((t - t0) / (t1 - t0)) * plotW;
    const TX = (x) => t0 + ((x - padL) / plotW) * (t1 - t0);
    const YF = (v) => top + H1 - (v / fMax) * H1;
    const sY0 = top + H1 + gap;
    const YS = (s) => sY0 + H2 - ((s - sFloor) / (sTop - sFloor)) * H2;
    const SY = (y) => sFloor + ((sY0 + H2 - y) / H2) * (sTop - sFloor);
    const id = ++chartSeq;

    const svg = el('svg', {
      viewBox: `0 0 ${Wd} ${Ht}`,
      width: Wd,
      height: Ht,
      role: 'img',
      'aria-label': `Chart of ${item.inName} and ${item.outName} (${item.flowUnit}) from ${W.when(item, t0)} to ${W.when(item, t1)}, with the ${item.stock} underneath.`,
    });
    host.appendChild(svg);
    const defs = el('defs', null, svg);
    const clip = el('clipPath', { id: `sweep${id}` }, defs);
    const clipRect = el('rect', { x: 0, y: 0, width: 0, height: Ht }, clip);

    const gBg = el('g', null, svg);
    const gGap = el('g', { 'clip-path': `url(#sweep${id})` }, svg);
    const gFlows = el('g', null, svg);
    const gAsk = el('g', null, svg);
    const gStock = el('g', { 'clip-path': `url(#sweep${id})` }, svg);
    const gMarks = el('g', null, svg);
    const gUser = el('g', null, svg);
    const gVessel = el('g', null, svg);
    const gSweep = el('g', null, svg);

    // backgrounds, grids, ticks
    el('rect', { class: 'plotbg', x: padL, y: top, width: plotW, height: H1 }, gBg);
    el('rect', { class: 'plotbg', x: padL, y: sY0, width: plotW, height: H2 }, gBg);
    for (const v of fTicks) {
      el('line', { class: 'gridline', x1: padL, x2: padL + plotW, y1: YF(v), y2: YF(v) }, gBg);
      const tx = el('text', { class: 'ticklabel', x: padL - 5, y: YF(v) + 3.5, 'text-anchor': 'end' }, gBg);
      tx.textContent = tickText(v);
    }
    for (const v of sTicks) {
      el('line', { class: 'gridline', x1: padL, x2: padL + plotW, y1: YS(v), y2: YS(v) }, gBg);
      const tx = el('text', { class: 'ticklabel', x: padL - 5, y: YS(v) + 3.5, 'text-anchor': 'end' }, gBg);
      tx.textContent = tickText(v);
    }
    const step = item.time.ticks || (t1 - t0) / 5;
    const px = (step / (t1 - t0)) * plotW;
    const every = Math.max(1, Math.ceil((small ? 40 : 34) / px));
    let k = 0;
    for (let t = t0; t <= t1 + 1e-9; t += step, k++) {
      const x = X(t);
      el('line', { class: 'gridline', x1: x, x2: x, y1: top, y2: top + H1 }, gBg);
      el('line', { class: 'gridline', x1: x, x2: x, y1: sY0, y2: sY0 + H2 }, gBg);
      if (k % every === 0) {
        const label = T.fmtTick(item.time, t);
        if (label) {
          // month names sit in the middle of their month; numbers sit on their tick
          const mid = item.time.unit === 'calendar';
          const anchor = mid ? 'middle' : t === t0 ? 'start' : t >= t1 - 1e-9 ? 'end' : 'middle';
          const lx = mid ? X(Math.min(t1, t + step / 2)) : x;
          const tx = el('text', { class: 'ticklabel', x: lx, y: sY0 + H2 + 15, 'text-anchor': anchor }, gBg);
          tx.textContent = label;
        }
      }
    }
    el('line', { class: 'axisline', x1: padL, x2: padL + plotW, y1: top + H1, y2: top + H1 }, gBg);
    el('line', { class: 'axisline', x1: padL, x2: padL + plotW, y1: sY0 + H2, y2: sY0 + H2 }, gBg);
    if (!small) {
      const b = el('text', { class: 'panellabel', x: padL + 4, y: sY0 - 7 }, gBg);
      b.textContent = item.stock.includes(item.stockUnit) ? item.stock : `${item.stock} (${item.stockUnit})`;
    }

    // gap shading between the lines: filling where in > out, draining where out > in
    const events = [...new Set(T.knots(item).concat(T.crossings(item).map((c) => c.t)))].sort((a, b) => a - b);
    for (let i = 1; i < events.length; i++) {
      const a = events[i - 1];
      const b = events[i];
      const mid = T.netAt(item, (a + b) / 2);
      if (Math.abs(mid) < 1e-12) continue;
      const d = `M${X(a)},${YF(T.inAt(item, a))} L${X(b)},${YF(T.inAt(item, b))} L${X(b)},${YF(T.outAt(item, b))} L${X(a)},${YF(T.outAt(item, a))} Z`;
      el('path', { class: mid > 0 ? 'g-fill' : 'g-drain', d }, gGap);
    }

    // the two flows
    const line = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${X(clamp(p[0], t0, t1)).toFixed(1)},${YF(p[1]).toFixed(1)}`).join(' ');
    const clipPts = (pts) => {
      const ks = T.knots(item);
      return ks.map((t) => [t, T.val(pts, t)]);
    };
    el('path', { class: 'l-in', d: line(clipPts(item.inflow)) }, gFlows);
    el('path', { class: 'l-out', d: line(clipPts(item.outflow)) }, gFlows);

    // the level
    const curve = T.stockCurve(item, small ? 80 : 160);
    const sPath = curve.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${YS(p[1]).toFixed(1)}`).join(' ');
    el('path', { class: 'a-stock', d: `${sPath} L${X(t1)},${YS(sFloor)} L${X(t0)},${YS(sFloor)} Z` }, gStock);
    el('path', { class: 'l-stock', d: sPath }, gStock);

    let note = null;
    if (mode === 'sketch') {
      el('circle', { class: 'startdot', cx: X(t0), cy: YS(item.s0), r: 5 }, gUser);
      note = el('text', { class: 'hidden-note', x: padL + plotW / 2, y: sY0 + H2 / 2 + 4, 'text-anchor': 'middle' }, gMarks);
      note.textContent = 'draw here, left to right';
    } else if (mode !== 'static') {
      note = el('text', { class: 'hidden-note', x: padL + plotW / 2, y: sY0 + H2 / 2 + 4, 'text-anchor': 'middle' }, gMarks);
      note.textContent = 'hidden until you answer';
    }

    // the ask marker (dir and amount)
    if ((mode === 'dir' || mode === 'amount') && item.at != null) {
      const x = X(item.at);
      el('line', { class: 'askline', x1: x, x2: x, y1: top - 2, y2: sY0 + H2 }, gAsk);
      el('circle', { class: 'askdot-in', cx: x, cy: YF(T.inAt(item, item.at)), r: 4.5 }, gAsk);
      el('circle', { class: 'askdot-out', cx: x, cy: YF(T.outAt(item, item.at)), r: 4.5 }, gAsk);
      const lab = el('text', { class: 'asklabel', x, y: top - 8, 'text-anchor': x > padL + plotW - 50 ? 'end' : x < padL + 50 ? 'start' : 'middle' }, gAsk);
      lab.textContent = W.when(item, item.at);
    }

    // the tub
    let vessel = null;
    if (!small) {
      const vx = padL + plotW + 9;
      const vw = padR - 15;
      const yT = YS(sTop);
      const yB = YS(sFloor);
      const water = el('rect', { class: 'vessel-water', x: vx + 1.5, width: vw - 3, y: yB, height: 0 }, gVessel);
      const mark = el('line', { class: 'vessel-mark', x1: vx - 3, x2: vx + vw + 3, y1: yB, y2: yB, opacity: 0 }, gVessel);
      el('path', { class: 'vessel', d: `M${vx},${yT} V${yB - 4} Q${vx},${yB} ${vx + 4},${yB} H${vx + vw - 4} Q${vx + vw},${yB} ${vx + vw},${yB - 4} V${yT}` }, gVessel);
      vessel = {
        set(level, high) {
          const y = YS(clamp(level, sFloor, sTop));
          water.setAttribute('y', y);
          water.setAttribute('height', Math.max(0, yB - y));
          if (high != null) {
            const ym = YS(clamp(high, sFloor, sTop));
            mark.setAttribute('y1', ym);
            mark.setAttribute('y2', ym);
            mark.setAttribute('opacity', 1);
          }
        },
      };
      vessel.set(item.s0, null);
    }

    function showAll() {
      clipRect.setAttribute('x', 0);
      clipRect.setAttribute('width', Wd);
      if (note) note.remove();
      note = null;
      if (vessel) vessel.set(T.stockAt(item, t1), T.extremes(item).max.s);
    }
    if (mode === 'static') showAll();

    // Sweep the reveal from left to right while the tub fills and empties.
    function reveal(done) {
      if (note) {
        note.remove();
        note = null;
      }
      const ex = T.extremes(item);
      if (reducedMotion() || small) {
        showAll();
        if (done) done();
        return;
      }
      const D = 1700;
      const start = performance.now();
      const sweep = el('line', { class: 'sweep', y1: top, y2: sY0 + H2 }, gSweep);
      let high = item.s0;
      const frame = (now) => {
        const f = clamp((now - start) / D, 0, 1);
        const t = t0 + f * (t1 - t0);
        const x = X(t);
        clipRect.setAttribute('x', 0);
        clipRect.setAttribute('width', x + 1);
        sweep.setAttribute('x1', x);
        sweep.setAttribute('x2', x);
        const s = T.stockAt(item, t);
        high = Math.max(high, s);
        if (vessel) vessel.set(s, high);
        if (f < 1) requestAnimationFrame(frame);
        else {
          sweep.remove();
          showAll();
          if (vessel) vessel.set(T.stockAt(item, t1), ex.max.s);
          if (done) done();
        }
      };
      requestAnimationFrame(frame);
    }

    // a vertical time cursor across both panels, with its label on top
    let cursorG = null;
    function setCursor(t, cls) {
      if (cursorG) cursorG.remove();
      cursorG = el('g', null, gUser);
      const x = X(t);
      el('line', { class: `cursor ${cls || ''}`, x1: x, x2: x, y1: top - 2, y2: sY0 + H2 }, cursorG);
      el('circle', { class: `cursordot ${cls || ''}`, cx: x, cy: top - 2, r: 3.2 }, cursorG);
      if (small) return;
      const anchor = x > padL + plotW - 44 ? 'end' : x < padL + 44 ? 'start' : 'middle';
      const lab = el('text', { class: `cursorlabel ${cls || ''}`, x, y: top - 8, 'text-anchor': anchor }, cursorG);
      lab.textContent = W.when(item, t);
    }

    function markTruth(t, label) {
      const x = X(t);
      el('line', { class: 'truthline', x1: x, x2: x, y1: top, y2: sY0 + H2 }, gMarks);
      const s = T.stockAt(item, t);
      el('circle', { class: 'truthdot', cx: x, cy: YS(s), r: 5.5 }, gMarks);
      if (label) {
        const y = YS(s) < sY0 + 16 ? YS(s) + 18 : YS(s) - 9;
        const anchor = x > padL + plotW - 60 ? 'end' : x < padL + 60 ? 'start' : 'middle';
        const lab = el('text', { class: 'truthlabel', x, y, 'text-anchor': anchor }, gMarks);
        lab.textContent = label;
      }
    }

    function markBand(intervals) {
      for (const [a, b] of intervals) {
        el('rect', { class: 'acceptband', x: X(a), y: sY0, width: Math.max(2, X(b) - X(a)), height: H2 }, gMarks);
      }
    }

    function markAgree(marks) {
      const w = Math.max(2, plotW / T.SKETCH.grid - 1);
      for (const m of marks) {
        el('rect', { class: m.good ? 'agree-ok' : 'agree-bad', x: X(m.t) - w / 2, y: sY0 + H2 - 5, width: w, height: 5 }, gMarks);
      }
    }

    let sketchLine = null;
    function drawSketch(path) {
      if (!sketchLine) sketchLine = el('path', { class: 'l-sketch' }, gUser);
      if (!path.length) {
        sketchLine.setAttribute('d', '');
        return;
      }
      sketchLine.setAttribute('d', path.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${YS(p[1]).toFixed(1)}`).join(' '));
    }

    // pointer position -> svg coordinates
    function svgPoint(ev) {
      const r = svg.getBoundingClientRect();
      const sc = r.width / Wd || 1;
      return { x: (ev.clientX - r.left) / sc, y: (ev.clientY - r.top) / sc };
    }

    // Drawing happens on an HTML overlay above the level panel: touch-action is
    // honoured reliably on HTML elements, so the finger draws instead of scrolling,
    // while the rest of the chart still scrolls the page.
    let drawZone = null;
    if (mode === 'sketch') {
      drawZone = h('div', { class: 'drawpad', 'aria-hidden': 'true' });
      drawZone.style.left = `${((padL - 6) / Wd) * 100}%`;
      drawZone.style.width = `${((plotW + 12) / Wd) * 100}%`;
      drawZone.style.top = `${((sY0 - 6) / Ht) * 100}%`;
      drawZone.style.height = `${((H2 + 12) / Ht) * 100}%`;
      host.appendChild(drawZone);
    }

    return {
      svg,
      drawZone,
      reveal,
      showAll,
      setCursor,
      markTruth,
      markBand,
      markAgree,
      drawSketch,
      svgPoint,
      toTime: (x) => clamp(TX(x), t0, t1),
      toLevel: (y) => clamp(SY(y), sFloor, sTop),
      panelRange: sTop - sFloor,
      inStockPanel: (y) => y >= sY0 - 10 && y <= sY0 + H2 + 10,
    };
  }

  /* ---------------- sketch strokes ---------------- */
  // Later strokes overwrite earlier ones over the time span they cover.
  function combinedPath(strokes) {
    const spans = strokes.map((s) => (s.length ? [Math.min(...s.map((p) => p[0])), Math.max(...s.map((p) => p[0]))] : null));
    const out = [];
    strokes.forEach((s, i) => {
      for (const p of s) {
        let covered = false;
        for (let j = i + 1; j < strokes.length; j++) if (spans[j] && p[0] >= spans[j][0] && p[0] <= spans[j][1]) covered = true;
        if (!covered) out.push(p);
      }
    });
    out.sort((a, b) => a[0] - b[0]);
    const dedup = [];
    for (const p of out) {
      if (dedup.length && Math.abs(dedup[dedup.length - 1][0] - p[0]) < 1e-9) dedup[dedup.length - 1] = p;
      else dedup.push(p);
    }
    return dedup;
  }

  /* ---------------- ladder ---------------- */
  function renderLadder(flash) {
    const ol = $('ladder');
    ol.textContent = '';
    const curR = R.currentRung(state);
    for (const r of R.LADDER) {
      const info = B.RUNGS[r];
      const done = !!state.cleared[r];
      const li = h('li', { class: `chip ${done ? 'done' : r === curR ? 'current' : ''} ${flash === r ? 'flash' : ''}` });
      li.setAttribute('aria-label', `Rung ${r}, ${info.name}, ${done ? 'cleared' : r === curR ? `current, ${state.streak[r] || 0} of ${R.STREAK} in a row` : 'not yet'}`);
      li.title = `${r}. ${info.name}`;
      li.appendChild(h('span', null, String(r)));
      const pips = h('span', { class: 'pips', 'aria-hidden': 'true' });
      const n = done ? R.STREAK : state.streak[r] || 0;
      for (let i = 0; i < R.STREAK; i++) pips.appendChild(h('span', { class: `pip ${i < n ? 'on' : ''}` }));
      li.appendChild(pips);
      ol.appendChild(li);
    }
  }

  /* ---------------- showing a question ---------------- */
  function modeLabel(pick, item) {
    const name = B.RUNGS[pick.rung] ? B.RUNGS[pick.rung].name : '';
    if (pick.mode === 'cold') return 'First look';
    if (pick.mode === 'twin') return 'Last look';
    if (pick.mode === 'review') return `Review · ${name}`;
    if (pick.mode === 'open') return `Open water · ${name}`;
    return `Rung ${pick.rung} · ${name}${item.generated ? ' · fresh' : ''}`;
  }

  function showPanel(which) {
    $('intro').hidden = which !== 'intro';
    $('q').hidden = which !== 'q';
    $('summary').hidden = which !== 'summary';
    $('carry').hidden = !state.cold || which === 'intro';
  }

  function nextQuestion() {
    const pick = R.next(state, B, T);
    save();
    showQuestion(pick);
  }

  function showQuestion(pick) {
    const item = R.itemFor(pick.id, B, T);
    if (!item) {
      // stored pick no longer exists: ask afresh
      state.current = null;
      nextQuestion();
      return;
    }
    const kind = item.kind;
    const chartMode = kind === 'peak' || kind === 'trough' ? 'tap' : kind === 'choice' ? null : kind;
    cur = { pick, item, kind, chartMode, answered: false, cursorT: null, strokes: [], result: null };
    showPanel('q');
    renderLadder();
    const tag = $('qMode');
    tag.textContent = modeLabel(pick, item);
    tag.className = `tag ${pick.mode === 'review' ? 'review' : ''}`;
    $('qCount').textContent = `Question ${state.q + 1}`;
    $('qTitle').textContent = item.title || (item.generated ? 'Fresh practice' : '');
    $('qStory').textContent = item.story;
    $('qAsk').textContent = askText(item);
    $('feedback').hidden = true;
    $('feedback').textContent = '';
    $('chartBox').hidden = !chartMode;
    if (chartMode) {
      renderLegend(item);
      renderChart();
    } else {
      $('chart').textContent = '';
      $('chartHint').textContent = '';
    }
    $('controls').hidden = false;
    renderControls();
    const main = $('q');
    if (main.scrollIntoView && window.scrollY > main.offsetTop) {
      try {
        main.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
      } catch (e) {
        main.scrollIntoView();
      }
    }
  }

  // Generated exercises get their question from their kind.
  function askText(item) {
    if (item.ask) return item.ask;
    const S = W.subject(item);
    if (item.kind === 'dir') return `${W.when(item, item.at)}: is ${S} rising, falling, or holding steady?`.replace(/^./, (c) => c.toUpperCase());
    if (item.kind === 'peak') return `When was ${S} highest?`;
    if (item.kind === 'trough') return `When was ${S} lowest?`;
    if (item.kind === 'amount') return `It started at ${W.level(item, item.s0)}. How ${W.counted(item) ? 'many are' : 'much is'} there ${W.whenP(item, item.at)}?`;
    if (item.kind === 'sketch') return `It starts at ${W.level(item, item.s0)}. Draw ${S} from start to finish.`;
    return '';
  }

  function renderLegend(item) {
    const lg = $('legend');
    lg.textContent = '';
    const key = (cls, name) => {
      const s = h('span', { class: 'key' });
      s.innerHTML = `<svg viewBox="0 0 26 10" aria-hidden="true"><line x1="1" y1="5" x2="25" y2="5" class="${cls}"/></svg>`;
      s.appendChild(document.createTextNode(name));
      return s;
    };
    lg.appendChild(key('leg-in', item.inName));
    lg.appendChild(key('leg-out', item.outName));
    lg.appendChild(h('span', { class: 'unit' }, item.flowUnit));
  }

  function renderChart() {
    const item = cur.item;
    const host = $('chart');
    host.classList.toggle('tapmode', cur.chartMode === 'tap');
    cur.chart = buildChart(host, item, cur.chartMode);
    const c = cur.chart;
    if (cur.answered) {
      c.showAll();
      drawAnswerMarks();
    } else {
      if (cur.cursorT != null) c.setCursor(cur.cursorT);
      if (cur.strokes.length) c.drawSketch(combinedPath(cur.strokes));
    }
    wireChart();
    setHint();
  }

  function setHint() {
    const hint = $('chartHint');
    if (!cur || cur.answered || !cur.chartMode) {
      hint.textContent = '';
      return;
    }
    if (cur.chartMode === 'tap') {
      hint.textContent = cur.cursorT == null ? 'Tap the chart at the moment you choose (drag to adjust, or use the arrow keys).' : `Chosen: ${W.when(cur.item, cur.cursorT)}. Drag to adjust, then check.`;
    } else if (cur.chartMode === 'sketch') {
      const path = combinedPath(cur.strokes);
      const span = cur.item.time.to - cur.item.time.from;
      const cov = path.length > 1 ? (path[path.length - 1][0] - path[0][0]) / span : 0;
      hint.textContent = cov >= T.SKETCH.cover ? 'Ready to check. Redraw any part to change it.' : `Draw in the lower panel, from the purple dot to the right-hand edge${cov > 0 ? ` (${Math.round(cov * 100)}% of the way so far)` : ''}.`;
    } else {
      // no method hints on 'Which way?' or 'How much?': the feedback teaches, the question tests
      hint.textContent = cur.chartMode === 'amount' ? 'The grid lines are there to count with.' : '';
    }
  }

  function wireChart() {
    const c = cur.chart;
    const host = $('chart');
    host.onkeydown = null;
    if (cur.chartMode === 'tap') {
      let down = false;
      const move = (ev) => {
        if (cur.answered) return;
        const p = c.svgPoint(ev);
        cur.cursorT = T.snapTime(cur.item, c.toTime(p.x));
        c.setCursor(cur.cursorT);
        updateCheck();
        setHint();
      };
      c.svg.addEventListener('pointerdown', (ev) => {
        if (cur.answered) return;
        down = true;
        try {
          c.svg.setPointerCapture(ev.pointerId);
        } catch (e) {
          /* capture is a nicety */
        }
        move(ev);
      });
      c.svg.addEventListener('pointermove', (ev) => {
        if (down) move(ev);
      });
      const up = () => {
        down = false;
      };
      c.svg.addEventListener('pointerup', up);
      c.svg.addEventListener('pointercancel', up);
      host.onkeydown = (ev) => {
        if (cur.answered) return;
        const it = cur.item;
        const st = Math.max(it.time.snap || 0, (it.time.to - it.time.from) / 100);
        let t = cur.cursorT == null ? (it.time.from + it.time.to) / 2 : cur.cursorT;
        if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') t += st;
        else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') t -= st;
        else if (ev.key === 'Home') t = it.time.from;
        else if (ev.key === 'End') t = it.time.to;
        else return;
        ev.preventDefault();
        cur.cursorT = T.snapTime(it, t);
        c.setCursor(cur.cursorT);
        updateCheck();
        setHint();
      };
    } else if (cur.chartMode === 'sketch' && c.drawZone) {
      let stroke = null;
      const add = (ev) => {
        const p = c.svgPoint(ev);
        stroke.push([c.toTime(p.x), c.toLevel(p.y)]);
        c.drawSketch(combinedPath(cur.strokes));
      };
      c.drawZone.addEventListener('pointerdown', (ev) => {
        if (cur.answered) return;
        ev.preventDefault();
        stroke = [];
        cur.strokes.push(stroke);
        try {
          c.drawZone.setPointerCapture(ev.pointerId);
        } catch (e) {
          /* fine without */
        }
        add(ev);
      });
      c.drawZone.addEventListener('pointermove', (ev) => {
        if (!stroke || cur.answered) return;
        add(ev);
      });
      const end = () => {
        if (!stroke) return;
        stroke = null;
        updateCheck();
        setHint();
      };
      c.drawZone.addEventListener('pointerup', end);
      c.drawZone.addEventListener('pointercancel', end);
    }
  }

  /* ---------------- controls ---------------- */
  function renderControls() {
    const box = $('controls');
    box.textContent = '';
    box.className = 'controls';
    const item = cur.item;
    if (cur.kind === 'dir') {
      const opts = [
        ['rising', '↗', 'Rising'],
        ['steady', '→', 'Steady'],
        ['falling', '↘', 'Falling'],
      ];
      opts.forEach(([v, arrow, label], i) => {
        const b = h('button', { class: 'btn dir', type: 'button', 'data-v': v, 'aria-keyshortcuts': String(i + 1) });
        b.appendChild(h('span', { class: 'arrow', 'aria-hidden': 'true' }, arrow));
        b.appendChild(document.createTextNode(label));
        b.addEventListener('click', () => answerDir(v));
        box.appendChild(b);
      });
    } else if (cur.kind === 'peak' || cur.kind === 'trough') {
      const b = h('button', { class: 'btn primary grow', type: 'button', id: 'checkBtn' }, 'Check');
      b.disabled = cur.cursorT == null;
      b.addEventListener('click', answerTap);
      box.appendChild(b);
    } else if (cur.kind === 'sketch') {
      const c = h('button', { class: 'btn', type: 'button', id: 'clearBtn' }, 'Clear');
      c.addEventListener('click', () => {
        if (cur.answered) return;
        cur.strokes = [];
        cur.chart.drawSketch([]);
        updateCheck();
        setHint();
      });
      const b = h('button', { class: 'btn primary grow', type: 'button', id: 'checkBtn' }, 'Check');
      b.disabled = true;
      b.addEventListener('click', answerSketch);
      box.appendChild(c);
      box.appendChild(b);
      updateCheck();
    } else if (cur.kind === 'amount') {
      box.classList.add('options');
      const choices = shuffled(T.pickAmountChoices(item, item.at), item.id);
      cur.choices = choices;
      choices.forEach((ch, i) => {
        const b = optButton(i, W.amountLabel(item, ch.v));
        b.addEventListener('click', () => answerAmount(i));
        box.appendChild(b);
      });
    } else if (cur.kind === 'choice') {
      box.classList.add('options');
      item.options.forEach((o, i) => {
        const b = optButton(i, o.text);
        b.addEventListener('click', () => answerChoice(i));
        box.appendChild(b);
      });
    }
  }

  function optButton(i, text) {
    const b = h('button', { class: 'btn opt', type: 'button', 'data-i': String(i), 'aria-keyshortcuts': String(i + 1) });
    b.appendChild(h('span', { class: 'k', 'aria-hidden': 'true' }, 'ABCD'[i]));
    b.appendChild(h('span', null, text));
    return b;
  }

  // A fixed shuffle per exercise, so the right answer is not always first.
  function shuffled(arr, key) {
    let s = 0;
    for (const ch of key) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
    const rnd = T.mulberry32(s);
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function updateCheck() {
    const b = $('checkBtn');
    if (!b || cur.answered) return;
    if (cur.kind === 'sketch') {
      const path = combinedPath(cur.strokes);
      const span = cur.item.time.to - cur.item.time.from;
      b.disabled = !(path.length > 1 && (path[path.length - 1][0] - path[0][0]) / span >= T.SKETCH.cover);
    } else {
      b.disabled = cur.cursorT == null;
    }
  }

  function lockControls() {
    for (const b of $('controls').querySelectorAll('button')) b.disabled = true;
    // Check and Clear have done their job; option buttons stay to show right and wrong.
    if (cur.kind === 'peak' || cur.kind === 'trough' || cur.kind === 'sketch') $('controls').hidden = true;
  }

  /* ---------------- answering ---------------- */
  function answerDir(v) {
    if (cur.answered) return;
    const fb = W.dirFeedback(cur.item, v);
    for (const b of $('controls').querySelectorAll('button')) {
      if (b.dataset.v === fb.truth) b.classList.add('right');
      else if (b.dataset.v === v) b.classList.add('wrong');
    }
    finish(fb.ok, fb.lines, {});
  }

  function answerTap() {
    if (cur.answered || cur.cursorT == null) return;
    const which = cur.kind === 'peak' ? 'max' : 'min';
    const fb = W.extremeFeedback(cur.item, which, cur.cursorT);
    finish(fb.ok, fb.lines, { t: cur.cursorT, diag: fb.diag });
  }

  function answerSketch() {
    if (cur.answered) return;
    const path = combinedPath(cur.strokes);
    const grade = T.gradeSketch(cur.item, path, cur.chart.panelRange);
    if (grade.reason !== 'graded') {
      toast('Draw across more of the chart first.');
      return;
    }
    cur.grade = grade;
    const fb = W.sketchFeedback(cur.item, grade);
    finish(fb.ok, fb.lines, {});
  }

  function answerAmount(i) {
    if (cur.answered) return;
    const ch = cur.choices[i];
    const fb = W.amountFeedback(cur.item, ch.v);
    $('controls')
      .querySelectorAll('button')
      .forEach((b, j) => {
        if (cur.choices[j].why === 'ok') b.classList.add('right');
        else if (j === i) b.classList.add('wrong');
      });
    finish(fb.ok, fb.lines, {});
  }

  function answerChoice(i) {
    if (cur.answered) return;
    const fb = W.choiceFeedback(cur.item, i);
    $('controls')
      .querySelectorAll('button')
      .forEach((b, j) => {
        if (j === cur.item.answer) b.classList.add('right');
        else if (j === i) b.classList.add('wrong');
      });
    finish(fb.ok, fb.lines, {});
  }

  function finish(ok, lines, extra) {
    cur.answered = true;
    cur.result = { ok, lines, extra };
    lockControls();
    const res = R.record(state, cur.pick, ok, extra);
    save();
    renderLadder(res.cleared);
    showFeedback(ok, lines, res);
    if (cur.chart) {
      // The reveal takes a moment; if Next is pressed before it ends, the marks
      // must not land on the next question's chart.
      const mine = cur;
      const chart = cur.chart;
      chart.reveal(() => {
        if (cur === mine && cur.chart === chart) drawAnswerMarks();
      });
      if (cur.chartMode === 'tap') drawCursorVerdict();
    }
    setHint();
    if (res.cleared) toast(`Rung ${res.cleared} cleared: ${B.RUNGS[res.cleared].name}`);
  }

  function drawCursorVerdict() {
    if (cur.cursorT != null) cur.chart.setCursor(cur.cursorT, cur.result.ok ? 'ok' : 'bad');
  }

  // What gets drawn on the chart once the answer is in.
  function drawAnswerMarks() {
    const c = cur.chart;
    const item = cur.item;
    if (cur.chartMode === 'tap') {
      const which = cur.kind === 'peak' ? 'max' : 'min';
      const ex = T.extremes(item);
      const best = which === 'max' ? ex.max : ex.min;
      c.markBand(T.acceptIntervals(item, which));
      c.markTruth(best.t, `${which === 'max' ? 'highest' : 'lowest'}: ${W.when(item, best.t)}`);
      drawCursorVerdict();
    } else if (cur.chartMode === 'dir' || cur.chartMode === 'amount') {
      const s = T.stockAt(item, item.at);
      c.markTruth(item.at, cur.chartMode === 'amount' ? W.level(item, s) : '');
    } else if (cur.chartMode === 'sketch') {
      c.drawSketch(combinedPath(cur.strokes));
      if (cur.grade && cur.grade.marks) c.markAgree(cur.grade.marks);
    }
  }

  const ICON_OK = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ICON_BAD = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';

  function showFeedback(ok, lines, res) {
    const fb = $('feedback');
    fb.textContent = '';
    fb.className = `feedback ${ok ? 'ok' : 'bad'}`;
    const v = h('p', { class: 'verdict' });
    v.innerHTML = ok ? ICON_OK : ICON_BAD;
    v.appendChild(document.createTextNode(ok ? 'Right.' : 'Not this time.'));
    fb.appendChild(v);
    for (const l of lines) if (l) fb.appendChild(h('p', null, l));
    if (cur.item.note) fb.appendChild(h('p', { class: 'note' }, cur.item.note));
    if (cur.pick.mode === 'cold') {
      fb.appendChild(
        h(
          'p',
          { class: 'note' },
          'That was the baseline, asked before any teaching. The last question of the ladder is its twin, somewhere else, so you can compare.'
        )
      );
    }
    if (res.cleared) {
      fb.appendChild(h('p', { class: 'cleared' }, `Rung ${res.cleared} cleared: ${B.RUNGS[res.cleared].name}.${res.ladderDone ? ' That was the last rung.' : ''}`));
    } else if (cur.pick.mode === 'ladder') {
      fb.appendChild(h('p', { class: 'small' }, `${state.streak[cur.pick.rung] || 0} of ${R.STREAK} in a row on this rung.`));
    }
    const row = h('div', { class: 'row' });
    const next = h('button', { class: 'btn primary grow', type: 'button', id: 'nextBtn' }, cur.pick.mode === 'twin' ? 'See how you did' : 'Next');
    next.addEventListener('click', onNext);
    row.appendChild(next);
    fb.appendChild(row);
    fb.hidden = false;
    $('carry').hidden = false;
    try {
      next.focus({ preventScroll: true });
    } catch (e) {
      /* ignore */
    }
    if (fb.scrollIntoView) {
      try {
        fb.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
      } catch (e) {
        fb.scrollIntoView(false);
      }
    }
  }

  function onNext() {
    if (cur && cur.pick.mode === 'twin') {
      showSummary();
      return;
    }
    nextQuestion();
  }

  /* ---------------- summary ---------------- */
  const DIAG_TEXT = {
    ok: 'Right.',
    inflowPeak: 'You picked about when the most were coming in.',
    fastest: 'You picked when it was filling fastest.',
    localTurn: 'You picked a turning point, but not the highest one.',
    risingThen: 'It was still rising then.',
    fallingThen: 'It was already falling then.',
  };

  function showSummary() {
    cur = null;
    showPanel('summary');
    renderLadder();
    const box = $('summary');
    box.textContent = '';
    box.appendChild(h('h2', null, 'You climbed the ladder'));
    box.appendChild(h('p', null, 'Here is the first question you answered, before any teaching, next to its twin at the end.'));
    const pair = h('div', { class: 'pair' });
    for (const [label, end] of [
      ['First look', state.cold],
      ['Last look', state.twin],
    ]) {
      if (!end) continue;
      const item = B.byId[end.id];
      const mini = h('div', { class: 'mini' });
      mini.appendChild(h('h3', null, label));
      const host = h('div', { class: 'chart' });
      mini.appendChild(host);
      const ex = T.extremes(item);
      const p = h('p', null, `${item.title}: you chose ${end.t != null ? W.when(item, end.t) : '—'}; highest ${W.whenP(item, ex.max.t)}. ${DIAG_TEXT[end.diag] || (end.ok ? 'Right.' : '')}`);
      mini.appendChild(p);
      pair.appendChild(mini);
      requestAnimationFrame(() => {
        const c = buildChart(host, item, 'static', { small: true });
        c.markTruth(ex.max.t, '');
        if (end.t != null) c.setCursor(end.t, end.ok ? 'ok' : 'bad');
      });
    }
    box.appendChild(pair);

    box.appendChild(h('h3', null, 'Each rung, every answer'));
    const tbl = h('table', { class: 'stats' });
    for (const r of R.LADDER) {
      const s = state.stats[r] || { n: 0, ok: 0 };
      const tr = h('tr');
      tr.appendChild(h('td', null, `${r}. ${B.RUNGS[r].name}`));
      tr.appendChild(h('td', { class: 'n' }, `${s.ok} right of ${s.n}`));
      tbl.appendChild(tr);
    }
    box.appendChild(tbl);

    box.appendChild(h('h3', null, 'Where the bathtub lies'));
    const ul = h('ul', { class: 'limits' });
    [
      'It tells you which way a stock moves and where it turns, given the flows. It does not tell you how the flows will respond to the stock or to what you do about it.',
      'Level ÷ flow is the average time in the tub only when the tub has settled. And a snapshot of what is in the tub over-represents whatever stays longest.',
      'It is an identity, so when the numbers do not add up, it is not wrong: there is a flow you have not counted.',
      'You still have to pick the right tub. A record flow can sit beside a shrinking stock.',
    ].forEach((t) => ul.appendChild(h('li', null, t)));
    box.appendChild(ul);
    box.appendChild(h('p', null, 'From here on it is open water: everything mixed, with anything you missed coming back first. The real test is outside this page: the next headline that says something is falling.'));
    const row = h('div', { class: 'row' });
    const b = h('button', { class: 'btn primary grow', type: 'button' }, 'Keep practising');
    b.addEventListener('click', nextQuestion);
    row.appendChild(b);
    box.appendChild(row);
    $('carry').hidden = false;
    window.scrollTo(0, 0);
  }

  /* ---------------- intro, reset, keys ---------------- */
  function showIntro() {
    cur = null;
    showPanel('intro');
    renderLadder();
    const start = $('startBtn');
    const note = $('introNote');
    const old = document.getElementById('summaryBtn');
    if (old) old.remove();
    if (state.q > 0) {
      const r = R.currentRung(state);
      start.textContent = 'Carry on';
      note.textContent = r ? `You are on rung ${r}, ${B.RUNGS[r].name}, after ${state.q} questions.` : `You have climbed the ladder (${state.q} questions so far). Open water from here.`;
      if (state.twin) {
        const sb = h('button', { class: 'btn', type: 'button', id: 'summaryBtn' }, 'Your summary');
        sb.addEventListener('click', showSummary);
        start.parentNode.appendChild(sb);
      }
    } else {
      start.textContent = 'Start with a shop';
    }
  }

  $('startBtn').addEventListener('click', () => {
    if (state.current) showQuestion(state.current);
    else nextQuestion();
  });

  let armTimer = null;
  $('resetBtn').addEventListener('click', () => {
    const b = $('resetBtn');
    if (!b.classList.contains('armed')) {
      b.classList.add('armed');
      b.textContent = 'Tap again to erase your progress';
      clearTimeout(armTimer);
      armTimer = setTimeout(() => {
        b.classList.remove('armed');
        b.textContent = 'Start over';
      }, 4000);
      return;
    }
    clearTimeout(armTimer);
    b.classList.remove('armed');
    b.textContent = 'Start over';
    state = R.fresh();
    save();
    showIntro();
    toast('Progress erased.');
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
    if (!cur || $('q').hidden) return;
    const tag = (ev.target && ev.target.tagName) || '';
    if (ev.key === 'Enter') {
      if (tag === 'BUTTON') return; // let the focused button act
      if (cur.answered) {
        ev.preventDefault();
        onNext();
      } else {
        const b = $('checkBtn');
        if (b && !b.disabled) {
          ev.preventDefault();
          b.click();
        }
      }
      return;
    }
    if (cur.answered) return;
    const n = '1234'.indexOf(ev.key);
    if (n >= 0) {
      const bs = $('controls').querySelectorAll('button.opt, button.dir');
      if (bs[n]) {
        ev.preventDefault();
        bs[n].click();
      }
    }
  });

  let lastW = 0;
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const w = $('chart').clientWidth;
      if (cur && cur.chartMode && !$('q').hidden && Math.abs(w - lastW) > 2) {
        lastW = w;
        renderChart();
      }
    }, 150);
  });

  /* ---------------- start ---------------- */
  showIntro();
  lastW = $('chart').clientWidth;
})();
