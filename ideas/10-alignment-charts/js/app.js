/* Alignment Charts — the page: pins, straightedge, warp, readout, print. */
(function () {
  'use strict';
  const { IDENTITY, matMul, applyH, homography, isConvexQuad, fitTransform, chartBBox, screenAtV, projectToScale, distanceToSamples, lineCrossings, layoutChart, clamp, approxMeasure } = window.ACEngine;
  const { buildCatalog, powerChart, POWER_PRESETS, parseNum } = window.ACCharts;
  const { scalesSVG, edgeSVG, warpSVG, sheetSVG, esc } = window.ACRender;

  const $ = (id) => document.getElementById(id);
  const els = {
    picker: $('picker'),
    stage: $('stage'),
    svg: $('chart'),
    scales: $('layer-scales'),
    edge: $('layer-edge'),
    warp: $('layer-warp'),
    title: $('chart-title'),
    kicker: $('chart-kicker'),
    formula: $('chart-formula'),
    hint: $('hint'),
    readout: $('readout'),
    check: $('check'),
    examples: $('examples'),
    about: $('about'),
    builder: $('builder'),
    bError: $('b-error'),
    bPreset: $('b-preset'),
    btnWarp: $('btn-warp'),
    btnShuffle: $('btn-shuffle'),
    btnFlatten: $('btn-flatten'),
    btnPrint: $('btn-print'),
    btnSvg: $('btn-svg'),
    printSheet: $('print-sheet'),
  };

  const motionOK = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FLAT = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  const flat = () => FLAT.map((c) => [...c]);

  const state = {
    charts: buildCatalog(),
    chart: null,
    pins: [],
    clock: 0,
    warpOn: false,
    corners: flat(),
    W: 0,
    H: 0,
    g: null,
    reading: null,
    drag: null,
    anim: 0,
  };

  // ---------------------------------------------------------------- text measurement

  const rootStyle = getComputedStyle(document.documentElement);
  const SANS = rootStyle.getPropertyValue('--sans').trim() || 'system-ui, sans-serif';
  const SERIF = rootStyle.getPropertyValue('--serif').trim() || 'Georgia, serif';
  const mctx = document.createElement('canvas').getContext('2d');
  const mcache = new Map();

  function measure(text, size, kind = '') {
    if (!mctx) return approxMeasure(text, size);
    const k = `${kind}|${size}|${text}`;
    let w = mcache.get(k);
    if (w === undefined) {
      if (kind === 'title') mctx.font = `600 ${size}px ${SERIF}`;
      else if (kind === 'mark' || kind === 'unit') mctx.font = `italic ${size}px ${SANS}`;
      else if (kind === 'badge') mctx.font = `650 ${size}px ${SANS}`;
      else mctx.font = `${size}px ${SANS}`;
      w = mctx.measureText(String(text)).width + 1.5;
      if (mcache.size > 6000) mcache.clear();
      mcache.set(k, w);
    }
    return w;
  }

  // ---------------------------------------------------------------- geometry

  const scaleOf = (key, chart = state.chart) => chart.scales.find((s) => s.key === key);

  function fontsFor(W) {
    return W < 520 ? { font: 11, titleFont: 12.5 } : { font: 12, titleFont: 13.5 };
  }

  function marginsFor(chart, W) {
    const phone = W < 520;
    const base = { l: phone ? 42 : 68, r: phone ? 42 : 68, t: phone ? 50 : 60, b: phone ? 20 : 28 };
    return { ...base, ...((phone ? chart.margins?.phone : chart.margins?.desk) || {}) };
  }

  const marginCache = new WeakMap();

  /**
   * Margins that leave room for the outermost labels. Start from defaults, lay the
   * flat chart out, and widen any side whose anchor labels would be clipped.
   * Cached per chart and size, so warping never moves the base rectangle.
   */
  function fittedMargins(chart, W, H, fonts) {
    const key = `${W}x${H}|${fonts.font}`;
    let byChart = marginCache.get(chart);
    if (!byChart) marginCache.set(chart, (byChart = new Map()));
    if (byChart.has(key)) return byChart.get(key);
    const m = marginsFor(chart, W);
    const bb = chartBBox(chart);
    for (let i = 0; i < 4; i++) {
      const rect = { x: m.l, y: m.t, w: Math.max(40, W - m.l - m.r), h: Math.max(40, H - m.t - m.b) };
      const L = layoutChart(chart, fitTransform(bb, rect, chart.maxDistort ?? Infinity), { width: W, height: H, ...fonts, measure });
      const e = L.extent;
      const need = { l: 2 - e.x0, r: e.x1 - (W - 2), t: 2 - e.y0, b: e.y1 - (H - 2) };
      let changed = false;
      for (const side of ['l', 'r', 't', 'b']) {
        const cap = (side === 'l' || side === 'r' ? W : H) * 0.3;
        if (need[side] > 0.5 && m[side] < cap) {
          m[side] = Math.min(cap, m[side] + need[side] + 1);
          changed = true;
        }
      }
      if (!changed) break;
    }
    byChart.set(key, m);
    return m;
  }

  /** Chart space -> fitted rectangle -> warped quad, and the full layout on top. */
  function computeGeometry(chart, W, H, corners, fonts) {
    const m = fittedMargins(chart, W, H, fonts);
    const rect = { x: m.l, y: m.t, w: Math.max(40, W - m.l - m.r), h: Math.max(40, H - m.t - m.b) };
    const bb = chartBBox(chart);
    const fit = fitTransform(bb, rect, chart.maxDistort ?? Infinity);
    const a = applyH(fit, [bb.x0, bb.y1]);
    const b = applyH(fit, [bb.x1, bb.y0]);
    const bw = b[0] - a[0];
    const bh = b[1] - a[1];
    const base = [
      [a[0], a[1]],
      [b[0], a[1]],
      [b[0], b[1]],
      [a[0], b[1]],
    ];
    const quad = corners.map(([u, v]) => [a[0] + u * bw, a[1] + v * bh]);
    const Hw = (isConvexQuad(quad) && homography(base, quad)) || IDENTITY;
    const Ht = matMul(Hw, fit);
    const layout = layoutChart(chart, Ht, { width: W, height: H, ...fonts, measure });
    const samples = Object.fromEntries(layout.scales.map((s) => [s.key, s.samples]));
    return { Ht, quad, origin: a, bw, bh, layout, samples, fonts };
  }

  function readingFor(chart, pins, Ht) {
    const [p0, p1] = pins;
    const A = screenAtV(scaleOf(p0.key, chart), Ht, p0.v);
    const B = screenAtV(scaleOf(p1.key, chart), Ht, p1.v);
    const read = chart.scales.find((s) => s.key !== p0.key && s.key !== p1.key);
    const tooClose = Math.hypot(A[0] - B[0], A[1] - B[1]) < 0.5;
    const vals = tooClose ? [] : lineCrossings(read, Ht, A, B);
    return { A, B, read, vals, tooClose };
  }

  // ---------------------------------------------------------------- rendering

  let rafAll = 0;
  let rafEdge = 0;

  function scheduleAll() {
    if (rafAll) return;
    if (rafEdge) {
      cancelAnimationFrame(rafEdge);
      rafEdge = 0;
    }
    rafAll = requestAnimationFrame(() => {
      rafAll = 0;
      renderAll();
    });
  }

  function scheduleEdge() {
    if (rafAll || rafEdge) return;
    rafEdge = requestAnimationFrame(() => {
      rafEdge = 0;
      renderEdge();
    });
  }

  function renderAll() {
    if (!state.W || !state.H || !state.chart) return;
    const fonts = fontsFor(state.W);
    state.g = computeGeometry(state.chart, state.W, state.H, state.corners, fonts);
    els.scales.innerHTML = scalesSVG(state.g.layout, fonts);
    els.warp.innerHTML = state.warpOn ? warpSVG(state.g.quad) : '';
    renderEdge();
  }

  const f2 = (n) => (Math.round(n * 100) / 100).toString();

  function renderEdge() {
    if (!state.g) return;
    const r = readingFor(state.chart, state.pins, state.g.Ht);
    state.reading = r;
    if (r.tooClose) {
      els.edge.innerHTML = `<g class="ac-edge">${[r.A, r.B]
        .map((P) => `<circle class="ac-pin" cx="${f2(P[0])}" cy="${f2(P[1])}" r="6.5"/>`)
        .join('')}</g>`;
    } else {
      els.edge.innerHTML = edgeSVG({
        A: r.A,
        B: r.B,
        W: state.W,
        H: state.H,
        reads: r.vals.map((v) => ({ p: screenAtV(r.read, state.g.Ht, v), text: r.read.read(v) })),
        measure,
        font: state.g.fonts.font,
      });
    }
    updateReadout(r);
  }

  // ---------------------------------------------------------------- readout

  const display = (sc, v) => (sc.input ? sc.input(v) : sc.read(v));

  /** " km", "%", "" (no unit after clock times, which carry their own format). */
  function withUnit(unit) {
    if (!unit || unit === 'h:mm:ss') return '';
    return /^[%×°]/.test(unit) ? unit : ` ${unit}`;
  }

  function buildReadout() {
    const chart = state.chart;
    const order = chart.readOrder || chart.scales.map((s) => s.key);
    els.readout.innerHTML = order
      .map((key) => {
        const sc = scaleOf(key);
        const mode = sc.parse === parseNum ? 'decimal' : 'text';
        const range = `${display(sc, sc.min)} to ${display(sc, sc.max)}`;
        return `<div class="row" data-key="${esc(key)}">
          <label for="in-${esc(key)}">${esc(sc.label)}</label>
          <span class="tag"></span>
          <div class="val"><input id="in-${esc(key)}" data-key="${esc(key)}" type="text" inputmode="${mode}"
            autocomplete="off" spellcheck="false" title="Type a value (${esc(range)}) to pin it">
            <span class="suffix">${esc(sc.suffix || '')}</span><span class="extra"></span></div>
        </div>`;
      })
      .join('');
    for (const input of els.readout.querySelectorAll('input')) {
      const key = input.dataset.key;
      input.addEventListener('focus', () => input.select());
      input.addEventListener('input', () => {
        const sc = scaleOf(key);
        if (!sc) return;
        const v = sc.parse(input.value);
        const ok = v !== null && v >= sc.min && v <= sc.max;
        input.setAttribute('aria-invalid', ok || !input.value.trim() ? 'false' : 'true');
        if (ok) setPin(key, v);
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
      });
      input.addEventListener('blur', () => {
        input.removeAttribute('aria-invalid');
        if (state.reading) updateReadout(state.reading);
      });
    }
  }

  function updateReadout(r) {
    for (const row of els.readout.children) {
      const key = row.dataset.key;
      const sc = scaleOf(key);
      if (!sc) continue;
      const pin = state.pins.find((p) => p.key === key);
      row.classList.toggle('is-pin', !!pin);
      row.classList.toggle('is-read', !pin);
      row.querySelector('.tag').textContent = pin ? 'set' : 'read';
      const input = row.querySelector('input');
      const v = pin ? pin.v : r.vals[0];
      if (document.activeElement !== input) {
        input.value = pin ? display(sc, pin.v) : r.vals.map((x) => display(sc, x)).join(' or ');
        input.placeholder = pin ? '' : r.tooClose ? 'no line' : 'off the scale';
      }
      row.querySelector('.extra').textContent = sc.extra && Number.isFinite(v) && (pin || r.vals.length === 1) ? sc.extra(v) : '';
    }
    els.check.innerHTML = checkText(r);
  }

  function checkText(r) {
    if (r.tooClose) return 'Both pins sit on the same point, so they do not fix a line. Move one of them.';
    const known = Object.fromEntries(state.pins.map((p) => [p.key, p.v]));
    const raw = state.chart.solve[r.read.key](known);
    const all = (Array.isArray(raw) ? raw : [raw]).filter(Number.isFinite);
    const unit = r.read.keySuffix ?? r.read.suffix ?? '';
    const say = (xs) => xs.map((x) => `${r.read.read(x)}${withUnit(unit)}`).join(' and ');
    const inside = all.filter((x) => x >= r.read.min && x <= r.read.max);
    if (r.vals.length) {
      const agree =
        inside.length === r.vals.length &&
        inside.every((x, i) => Math.abs(x - r.vals[i]) <= 1e-6 * Math.max(1, Math.abs(x)));
      return `<b>Formula check:</b> ${esc(say(inside.length ? inside : all))}${agree ? ' — the edge and the algebra agree.' : '.'}`;
    }
    if (!all.length) return '<b>No answer:</b> the formula has no solution here, and the edge misses the scale.';
    return `<b>Off the scale:</b> the formula gives ${esc(say(all))}, outside this chart’s range of ${esc(display(r.read, r.read.min))} to ${esc(display(r.read, r.read.max))}.`;
  }

  // ---------------------------------------------------------------- pins

  function lruPin() {
    return state.pins[0].at <= state.pins[1].at ? state.pins[0] : state.pins[1];
  }

  function setPin(key, v) {
    const sc = scaleOf(key);
    let pin = state.pins.find((p) => p.key === key);
    if (!pin) {
      pin = lruPin();
      pin.key = key;
    }
    pin.v = clamp(v, sc.min, sc.max);
    pin.at = ++state.clock;
    scheduleEdge();
  }

  function setPins(pairs) {
    state.pins = pairs.map(([key, v]) => {
      const sc = scaleOf(key);
      return { key, v: clamp(v, sc.min, sc.max), at: ++state.clock };
    });
    scheduleEdge();
  }

  // ---------------------------------------------------------------- pointer

  function svgPoint(e) {
    const r = els.svg.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  function hitTest(P, tol) {
    const { Ht, samples } = state.g;
    let best = null;
    for (const pin of state.pins) {
      const q = screenAtV(scaleOf(pin.key), Ht, pin.v);
      const d = Math.hypot(q[0] - P[0], q[1] - P[1]);
      if (d <= tol * 0.75 && (!best || d < best.d)) best = { key: pin.key, d };
    }
    if (best) return best;
    for (const sc of state.chart.scales) {
      const d = distanceToSamples(samples[sc.key], P);
      if (d <= tol && (!best || d < best.d)) best = { key: sc.key, d };
    }
    return best;
  }

  function nearestCorner(P) {
    let best = -1;
    let bd = Infinity;
    state.g.quad.forEach((c, i) => {
      const d = Math.hypot(c[0] - P[0], c[1] - P[1]);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return { i: best, d: bd };
  }

  function dragPinTo(pin, P) {
    const sc = scaleOf(pin.key);
    const r = projectToScale(sc, state.g.Ht, state.g.samples[sc.key], P);
    pin.v = r.v;
    pin.at = ++state.clock;
    scheduleEdge();
  }

  function moveCorner(i, P) {
    const g = state.g;
    const x = clamp(P[0], 6, state.W - 6);
    const y = clamp(P[1], 6, state.H - 6);
    const next = state.corners.map((c) => [...c]);
    next[i] = [(x - g.origin[0]) / g.bw, (y - g.origin[1]) / g.bh];
    const quad = next.map(([u, v]) => [g.origin[0] + u * g.bw, g.origin[1] + v * g.bh]);
    if (!isConvexQuad(quad)) return;
    state.corners = next;
    scheduleAll();
  }

  els.svg.addEventListener('pointerdown', (e) => {
    if (!state.g || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault(); // no text selection or image drag starting on the chart, hit or miss
    // A half-typed value must not hide what the drag is doing.
    if (document.activeElement && els.readout.contains(document.activeElement)) document.activeElement.blur();
    const P = svgPoint(e);
    const tol = e.pointerType === 'mouse' ? 16 : 30;
    if (state.warpOn) {
      const c = nearestCorner(P);
      if (c.d > tol + 10) return;
      stopAnim();
      const q = state.g.quad[c.i];
      state.drag = { kind: 'corner', i: c.i, id: e.pointerId, off: [q[0] - P[0], q[1] - P[1]] };
    } else {
      const hit = hitTest(P, tol);
      if (!hit) return;
      let pin = state.pins.find((p) => p.key === hit.key);
      if (!pin) {
        pin = lruPin();
        pin.key = hit.key;
      }
      state.drag = { kind: 'pin', pin, id: e.pointerId };
      dragPinTo(pin, P);
    }
    els.stage.classList.add('is-dragging');
    try {
      els.svg.setPointerCapture(e.pointerId);
    } catch {
      /* capture is a nicety */
    }
  });

  els.svg.addEventListener('pointermove', (e) => {
    if (!state.g) return;
    const P = svgPoint(e);
    const d = state.drag;
    if (d && d.id === e.pointerId) {
      if (d.kind === 'pin') dragPinTo(d.pin, P);
      else moveCorner(d.i, [P[0] + d.off[0], P[1] + d.off[1]]);
      return;
    }
    if (e.pointerType === 'mouse') {
      const hot = state.warpOn ? nearestCorner(P).d < 26 : !!hitTest(P, 16);
      els.stage.classList.toggle('is-hot', hot);
    }
  });

  function endDrag(e) {
    if (state.drag && state.drag.id === e.pointerId) {
      state.drag = null;
      els.stage.classList.remove('is-dragging');
    }
  }
  els.svg.addEventListener('pointerup', endDrag);
  els.svg.addEventListener('pointercancel', endDrag);

  // ---------------------------------------------------------------- warp

  function stopAnim() {
    if (state.anim) cancelAnimationFrame(state.anim);
    state.anim = 0;
  }

  function animateCorners(target) {
    stopAnim();
    if (!motionOK) {
      state.corners = target;
      scheduleAll();
      return;
    }
    const from = state.corners.map((c) => [...c]);
    const t0 = performance.now();
    const dur = 700;
    const step = (now) => {
      const t = Math.min(1, (now - t0) / dur);
      const k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      state.corners = from.map((c, i) => [c[0] + (target[i][0] - c[0]) * k, c[1] + (target[i][1] - c[1]) * k]);
      renderAll();
      state.anim = t < 1 ? requestAnimationFrame(step) : 0;
    };
    state.anim = requestAnimationFrame(step);
  }

  function randomCorners() {
    const g = state.g;
    const inward = [
      [1, 1],
      [-1, 1],
      [-1, -1],
      [1, -1],
    ];
    for (let k = 0; k < 80; k++) {
      const c = FLAT.map(([u, v], i) => [
        u + inward[i][0] * (Math.random() * 0.34 - 0.06),
        v + inward[i][1] * (Math.random() * 0.28 - 0.05),
      ]);
      const quad = c.map(([u, v]) => [g.origin[0] + u * g.bw, g.origin[1] + v * g.bh]);
      const inside = quad.every(([x, y]) => x > 8 && x < state.W - 8 && y > 8 && y < state.H - 8);
      const area = Math.abs(
        quad.reduce((s, p, i) => {
          const q = quad[(i + 1) % 4];
          return s + p[0] * q[1] - q[0] * p[1];
        }, 0) / 2,
      );
      if (isConvexQuad(quad) && inside && area > 0.45 * g.bw * g.bh) return c;
    }
    return flat();
  }

  function setWarpMode(on) {
    state.warpOn = on;
    els.btnWarp.setAttribute('aria-pressed', String(on));
    els.btnWarp.textContent = on ? 'Done warping' : 'Warp the paper';
    updateHint();
    scheduleAll();
  }

  els.btnWarp.addEventListener('click', () => setWarpMode(!state.warpOn));
  els.btnShuffle.addEventListener('click', () => {
    if (state.g) animateCorners(randomCorners());
  });
  els.btnFlatten.addEventListener('click', () => animateCorners(flat()));

  function updateHint() {
    els.hint.textContent = state.warpOn
      ? 'Drag the four corners to warp the paper. The pins hold their values, so the reading never moves.'
      : 'Drag along any two scales, or tap a scale to swing the edge onto it. The third value is read where the edge crosses.';
  }

  // ---------------------------------------------------------------- print & save

  const SHEET_W = 800;
  const SHEET_H = 1120;
  const SHEET_TOP = 128;
  const SHEET_CHART_H = 820;

  function keyLine(chart, pins, r) {
    const say = (sc, v) => {
      const unit = sc.keySuffix ?? sc.suffix ?? '';
      return `${sc.label} = ${display(sc, v)}${withUnit(unit)}`;
    };
    const given = pins.map((p) => say(scaleOf(p.key, chart), p.v)).join(' and ');
    if (r.tooClose) return '';
    const got = r.vals.length ? r.vals.map((v) => say(r.read, v)).join(' or ') : `no reading on the ${r.read.label} scale`;
    return `Worked example (dashed line): ${given} give ${got}.`;
  }

  function buildSheet() {
    const chart = state.chart;
    const fonts = { font: 12, titleFont: 14 };
    const g = computeGeometry(chart, SHEET_W, SHEET_CHART_H, state.corners, fonts);
    const r = readingFor(chart, state.pins, g.Ht);
    const edge = r.tooClose
      ? ''
      : edgeSVG({
          A: r.A,
          B: r.B,
          W: SHEET_W,
          H: SHEET_CHART_H,
          reads: r.vals.map((v) => ({ p: screenAtV(r.read, g.Ht, v), text: '' })),
          printStyle: true,
          inset: 30,
        });
    return sheetSVG({
      W: SHEET_W,
      Hh: SHEET_H,
      top: SHEET_TOP,
      chartLayout: g.layout,
      edge,
      title: chart.title,
      kicker: chart.kicker,
      formula: chart.formula,
      keyLine: keyLine(chart, state.pins, r),
      credit: 'Alignment Charts · Idea Bank No. 10 · drawn by Hairline, an AI. Print at 100% and keep a ruler nearby.',
      measure: (t, fs) => measure(t, fs),
    });
  }

  els.btnPrint.addEventListener('click', () => {
    els.printSheet.innerHTML = buildSheet();
    window.print();
  });
  window.addEventListener('beforeprint', () => {
    if (state.chart) els.printSheet.innerHTML = buildSheet();
  });
  window.addEventListener('afterprint', () => {
    els.printSheet.innerHTML = '';
  });

  els.btnSvg.addEventListener('click', () => {
    const blob = new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n', buildSheet()], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `alignment-chart-${state.chart.id}.svg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  });

  // ---------------------------------------------------------------- builder (custom power law)

  const B = (id) => $(id);
  const bFields = {
    k: B('b-k'),
    u: { name: B('b-u-name'), unit: B('b-u-unit'), min: B('b-u-min'), max: B('b-u-max'), exp: B('b-u-exp') },
    v: { name: B('b-v-name'), unit: B('b-v-unit'), min: B('b-v-min'), max: B('b-v-max'), exp: B('b-v-exp') },
    w: { name: B('b-w-name'), unit: B('b-w-unit') },
  };
  const numText = (n) => String(+n.toPrecision(6));

  function fillBuilder(p) {
    bFields.k.value = numText(p.k);
    for (const side of ['u', 'v']) {
      const s = p[side];
      const F = bFields[side];
      F.name.value = s.name;
      F.unit.value = s.unit;
      F.min.value = numText(s.min);
      F.max.value = numText(s.max);
      F.exp.value = numText(s.exp);
    }
    bFields.w.name.value = p.w.name;
    bFields.w.unit.value = p.w.unit;
  }

  function readBuilder() {
    const side = (F) => ({
      name: F.name.value.trim(),
      unit: F.unit.value.trim(),
      min: parseNum(F.min.value),
      max: parseNum(F.max.value),
      exp: parseNum(F.exp.value),
    });
    return {
      k: parseNum(bFields.k.value),
      u: side(bFields.u),
      v: side(bFields.v),
      w: { name: bFields.w.name.value.trim(), unit: bFields.w.unit.value.trim() },
    };
  }

  els.bPreset.innerHTML = POWER_PRESETS.map((p) => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join('');
  fillBuilder(POWER_PRESETS[0]);

  let builderTimer = 0;
  function rebuildCustom({ resetPins = false } = {}) {
    let chart;
    try {
      chart = powerChart(readBuilder());
    } catch (err) {
      els.bError.textContent = err.message;
      return;
    }
    els.bError.textContent = '';
    const i = state.charts.findIndex((c) => c.id === 'custom');
    state.charts[i] = chart;
    if (state.chart && state.chart.id === 'custom') {
      const keep = state.pins.every((p) => {
        const sc = scaleOf(p.key, chart);
        return sc && p.v >= sc.min && p.v <= sc.max;
      });
      state.chart = chart;
      if (resetPins || !keep) setPins(chart.pins);
      showChartText();
      buildReadout();
      scheduleAll();
    }
  }
  els.builder.addEventListener('input', (e) => {
    if (e.target === els.bPreset) return;
    clearTimeout(builderTimer);
    builderTimer = setTimeout(rebuildCustom, 140);
  });
  els.bPreset.addEventListener('change', () => {
    const p = POWER_PRESETS.find((x) => x.id === els.bPreset.value) || POWER_PRESETS[0];
    clearTimeout(builderTimer);
    fillBuilder(p);
    rebuildCustom({ resetPins: true });
  });
  els.builder.addEventListener('submit', (e) => e.preventDefault());

  // ---------------------------------------------------------------- chart selection

  function buildPicker() {
    els.picker.innerHTML = state.charts
      .map(
        (c) =>
          `<button type="button" data-id="${esc(c.id)}" aria-pressed="false"><b>${esc(c.tab)}</b><small>${esc(c.tabNote)}</small></button>`,
      )
      .join('');
    els.picker.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-id]');
      if (b) selectChart(b.dataset.id);
    });
  }

  function showChartText() {
    const c = state.chart;
    els.title.textContent = c.title;
    els.kicker.textContent = c.kicker;
    els.formula.innerHTML = c.formula.replace(/<(?!\/?su[bp]>)[^>]*>/g, '');
    els.about.innerHTML = `<h3>About this chart</h3>${c.about}`;
    els.examples.innerHTML = c.examples.length
      ? `<h3>Try</h3><ul>${c.examples
          .map((ex, i) => `<li><button type="button" data-ex="${i}">${esc(ex.label)}</button></li>`)
          .join('')}</ul>`
      : '';
    els.svg.setAttribute('aria-label', `${c.title}. ${c.formula.replace(/<[^>]*>/g, '')}`);
  }

  els.examples.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-ex]');
    if (!b) return;
    const ex = state.chart.examples[+b.dataset.ex];
    if (ex) setPins(ex.pins);
  });

  function selectChart(id, { fromHash = false } = {}) {
    const chart = state.charts.find((c) => c.id === id) || state.charts[0];
    state.chart = chart;
    state.clock = 0;
    state.pins = chart.pins.map(([key, v]) => ({ key, v, at: ++state.clock }));
    stopAnim();
    state.corners = flat();
    for (const b of els.picker.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.id === chart.id));
    els.builder.hidden = chart.id !== 'custom';
    showChartText();
    buildReadout();
    updateHint();
    if (!fromHash && location.hash !== `#${chart.id}`) {
      try {
        history.replaceState(null, '', `#${chart.id}`);
      } catch {
        /* file:// or sandboxed: the hash is only a convenience */
      }
    }
    scheduleAll();
  }

  window.addEventListener('hashchange', () => {
    const id = location.hash.slice(1);
    if (id && id !== state.chart?.id && state.charts.some((c) => c.id === id)) selectChart(id, { fromHash: true });
  });

  // ---------------------------------------------------------------- boot

  function measureStage() {
    const r = els.svg.getBoundingClientRect();
    const W = Math.round(r.width);
    const H = Math.round(r.height);
    if (W > 0 && H > 0 && (W !== state.W || H !== state.H)) {
      state.W = W;
      state.H = H;
      els.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      scheduleAll();
    }
  }

  // A small console hook for tinkering, also used by tests/ui-check.mjs.
  window.alignmentCharts = {
    state,
    /** Viewport (client) coordinates of value v on scale `key`, as currently drawn. */
    clientPoint(key, v) {
      const p = screenAtV(scaleOf(key), state.g.Ht, v);
      const r = els.svg.getBoundingClientRect();
      return [p[0] + r.left, p[1] + r.top];
    },
    cornerPoint(i) {
      const r = els.svg.getBoundingClientRect();
      return [state.g.quad[i][0] + r.left, state.g.quad[i][1] + r.top];
    },
  };

  buildPicker();
  selectChart(location.hash.slice(1) || 'bayes', { fromHash: true });
  if ('ResizeObserver' in window) new ResizeObserver(measureStage).observe(els.stage);
  window.addEventListener('resize', measureStage);
  measureStage();
})();
