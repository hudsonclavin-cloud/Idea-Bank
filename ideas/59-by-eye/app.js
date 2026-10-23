/* By Eye: the page. Draws the tests, takes the reader's settings, and sets the two alphabets. */
(function () {
  'use strict';
  const L = window.ByEyeLetters;
  const FACES = window.ByEyeTypefaces;
  const CAP = L.CAP;
  const NS = 'http://www.w3.org/2000/svg';
  const STORE = 'by-eye-v1';
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- small helpers ----------
  function el(tag, attrs, parent, svg) {
    const n = svg ? document.createElementNS(NS, tag) : document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        if (k === 'text') n.textContent = attrs[k];
        else if (k === 'html') n.innerHTML = attrs[k];
        else n.setAttribute(k, attrs[k]);
      }
    }
    if (parent) parent.appendChild(n);
    return n;
  }
  const sv = (tag, attrs, parent) => el(tag, attrs, parent, true);
  const clear = (n) => {
    while (n.firstChild) n.removeChild(n.firstChild);
  };
  // Run apply(k) for k from 0 to 1 over a short ease; at once if motion is reduced.
  function tween(apply, dur = 750) {
    if (reduceMotion) {
      apply(1);
      return;
    }
    const t0 = performance.now();
    const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
    const frame = (now) => {
      const x = Math.min(1, (now - t0) / dur);
      apply(ease(x));
      if (x < 1) requestAnimationFrame(frame);
    };
    apply(0);
    requestAnimationFrame(frame);
  }
  // The ruler's letter as a thin outline that follows only the outside of the filled shape: the
  // stroke is masked by the shape's own fill, so the internal edges where a letter's pieces overlap
  // (the H's bar inside its stems, say) never show.
  let maskSeq = 0;
  function drawGhost(parent, d, transform) {
    const svg = parent.ownerSVGElement || parent;
    let defs = svg.querySelector('defs');
    if (!defs) defs = svg.insertBefore(document.createElementNS(NS, 'defs'), svg.firstChild);
    const id = `ruler-mask-${++maskSeq}`;
    const mask = sv('mask', { id, maskUnits: 'userSpaceOnUse', x: -1e5, y: -1e5, width: 2e5, height: 2e5 }, defs);
    sv('rect', { x: -1e5, y: -1e5, width: 2e5, height: 2e5, fill: 'white' }, mask);
    sv('path', { d, fill: 'black' }, mask);
    const g = sv('g', { transform }, parent);
    sv('path', { class: 'ghost', d, mask: `url(#${id})` }, g);
  }
  const fmt = (v, d = 1) => {
    const s = Math.abs(v).toFixed(d);
    return (v < 0 && +s !== 0 ? '−' : '') + s;
  };
  const median = (a) => {
    const s = [...a].sort((x, y) => x - y);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  function load() {
    try {
      const raw = window.localStorage.getItem(STORE);
      const d = raw ? JSON.parse(raw) : null;
      return d && d.v === 1 && d.tests ? d : { v: 1, tests: {} };
    } catch (e) {
      return { v: 1, tests: {} };
    }
  }
  function save() {
    try {
      window.localStorage.setItem(STORE, JSON.stringify(state));
    } catch (e) {
      /* storage unavailable: the page still works for this visit */
    }
  }
  const state = load();

  // The reader's alphabet: each finished test's value, the ruler's for the rest.
  function eyeParams() {
    const p = Object.assign({}, L.RULER);
    for (const t of TESTS) {
      const r = state.tests[t.key];
      if (r && r.tries && r.tries.length === 2) p[t.key] = (r.tries[0] + r.tries[1]) / 2;
    }
    return p;
  }
  const doneCount = () => TESTS.filter((t) => state.tests[t.key] && state.tests[t.key].tries.length === 2).length;

  // ---------- what the typefaces did, in each test's display units ----------
  const sans = FACES.sans;
  const faceLabel = (f) => `${f.name} ${f.style}`;

  const TESTS = [
    {
      key: 'round',
      title: 'Round against flat',
      word: 'HOH',
      ask: 'Make the O look exactly as tall as the H.',
      less: 'Smaller O',
      more: 'Bigger O',
      span: [-0.03, 0.065],
      high: [0.035, 0.055],
      low: [-0.025, -0.012],
      nudge: 0.0007,
      turn: null,
      show: (v) => v * 100,
      axis: [-2, 5, 1],
      unit: '% of the cap height, above the top line and below the baseline',
      faces: sans.map((f) => ({ label: faceLabel(f), v: f.round * 100 })),
      lab: [],
      verdict(v) {
        const p = v * 100;
        if (Math.abs(p) < 0.15) return 'You kept the O as the ruler drew it, within 0.15% of the H’s height.';
        if (p > 0)
          return `Your O rises <b>${fmt(p, 1)}%</b> of the cap height above the H and sinks as far below it: it is <b>${fmt(2 * p, 1)}%</b> taller than the H. By the ruler that is too tall. To your eye it is equal.`;
        return `You made the O <b>${fmt(-2 * p, 1)}%</b> shorter than the H. That is the unusual direction: most eyes, and every typeface measured here, ask for more.`;
      },
      facesLine() {
        const v = this.faces.map((f) => f.v);
        return `The eight sans serifs measured here let their O overshoot by ${fmt(Math.min(...v))}% to ${fmt(Math.max(...v))}% a side (median ${fmt(median(v))}%).`;
      },
      why: 'A flat letter sits on the line along its whole width. A round one touches it at a single point, has little ink near it, and seems to stop short.',
    },
    {
      key: 'point',
      title: 'Points against flat',
      word: 'HAVE',
      ask: 'Make the point of the A reach the top line and the point of the V reach the baseline, to your eye.',
      less: 'Shorter points',
      more: 'Longer points',
      span: [-0.04, 0.11],
      high: [0.06, 0.09],
      low: [-0.035, -0.015],
      nudge: 0.0007,
      turn: null,
      show: (v) => v * 100,
      axis: [-2, 8, 2],
      unit: '% of the cap height, beyond the line',
      faces: FACES.pointed.map((f) => ({ label: `${f.name} ${f.style} (V)`, v: f.pointBottom * 100 })),
      lab: [],
      verdict(v) {
        const p = v * 100;
        let s;
        if (Math.abs(p) < 0.15) s = 'You left the points on the lines, as the ruler drew them (within 0.15%).';
        else if (p > 0)
          s = `Your A’s point rises <b>${fmt(p, 1)}%</b> of the cap height above the top line, and your V’s sinks as far below the baseline.`;
        else s = `You pulled the points <b>${fmt(-p, 1)}%</b> inside the lines. That is the unusual direction.`;
        const r = state.tests.round;
        if (r && r.tries.length === 2 && p > 0.15) {
          const ro = ((r.tries[0] + r.tries[1]) / 2) * 100;
          if (ro > 0.15) s += ` That is ${fmt(p / ro, 1)} times your overshoot for the O.`;
        }
        return s;
      },
      facesLine() {
        const v = this.faces.map((f) => f.v);
        return `None of the eight sans serifs has a pointed A or V; they cut their points flat, which needs no overshoot. The serif faces Liberation Serif and FreeSerif end their V nearly in a point, and sink it ${fmt(Math.min(...v))}% to ${fmt(Math.max(...v))}% below the baseline.`;
      },
      why: 'A point touches the line at a single point and has almost no ink near it, so it can seem to stop shorter still than a curve. Type designers’ own accounts give points more overshoot than rounds.',
    },
    {
      key: 'bar',
      title: 'Across against upright',
      word: 'THE',
      ask: 'Make the horizontal strokes look exactly as heavy as the upright ones.',
      less: 'Thinner horizontals',
      more: 'Thicker horizontals',
      span: [0.62, 1.22],
      high: [1.1, 1.18],
      low: [0.66, 0.74],
      nudge: 0.005,
      turn: 'sideways',
      show: (v) => (1 / v - 1) * 100,
      axis: [-10, 50, 10],
      unit: '%: how much thicker the uprights are than the horizontals',
      faces: sans.map((f) => ({ label: faceLabel(f), v: (1 / f.bar - 1) * 100 })),
      lab: [
        { label: 'Lab: de Waard et al. 2019, experiment 1', v: 5.4 },
        { label: 'Lab: experiment 2', v: 2.6 },
      ],
      verdict(v) {
        const thinner = (1 - v) * 100;
        if (Math.abs(thinner) < 0.5) return 'You kept the horizontals as thick as the uprights, as the ruler drew them (within 0.5%).';
        if (thinner > 0)
          return `Your horizontals are <b>${fmt(thinner, 1)}%</b> thinner than your uprights; put the other way, the uprights are <b>${fmt((1 / v - 1) * 100, 1)}%</b> thicker.`;
        return `You made the horizontals <b>${fmt(-thinner, 1)}%</b> thicker than the uprights. That is the unusual direction.`;
      },
      facesLine() {
        const v = this.faces.map((f) => f.v);
        return `With plain lines in a lab, people needed the upright 5.4% thicker (2.6% in a second experiment). The eight sans serifs make their H’s uprights ${fmt(Math.min(...v), 0)}% to ${fmt(Math.max(...v), 0)}% thicker than its bar: type thins its horizontals by more than the bare illusion asks, as the lab’s authors noted of Futura and Avenir.`;
      },
      why: 'Turn the letters on their side. Your thinned horizontals become uprights, and now they look thin: nothing changed but the direction.',
    },
    {
      key: 'middle',
      title: 'The middle',
      word: 'HE',
      ask: 'Put the crossbar of the H, and the middle arm of the E, exactly halfway up.',
      less: 'Lower',
      more: 'Higher',
      span: [0.42, 0.6],
      high: [0.56, 0.585],
      low: [0.425, 0.445],
      nudge: 0.001,
      turn: 'over',
      show: (v) => (v - 0.5) * 100,
      axis: [-4, 8, 2],
      unit: '% of the cap height, above the true middle',
      faces: sans.map((f) => ({ label: faceLabel(f), v: (f.middle - 0.5) * 100 })),
      lab: [],
      verdict(v) {
        const p = (v - 0.5) * 100;
        if (Math.abs(p) < 0.15) return 'You put the bar at the true middle, within 0.15% of the cap height.';
        if (p > 0)
          return `Your crossbar’s centre is <b>${fmt(p, 1)}%</b> of the cap height above the true middle (${fmt(p * 7, 0)} units of 700).`;
        return `Your crossbar’s centre is <b>${fmt(-p, 1)}%</b> below the true middle. That is the unusual direction.`;
      },
      facesLine() {
        const v = this.faces.map((f) => f.v);
        return `All eight sans serifs raise the centre of the H’s bar, by ${fmt(Math.min(...v))}% to ${fmt(Math.max(...v))}% of the cap height.`;
      },
      why: 'Turn it over: the bar you raised is now below the middle, and it looks low. Asked to mark the middle of an upright line, most people mark it a little too high.',
    },
    {
      key: 'halves',
      title: 'Two halves',
      word: 'B8S',
      ask: 'Make the top and bottom storeys of B, 8 and S look exactly the same size.',
      less: 'Smaller top',
      more: 'Bigger top',
      span: [0.4, 0.56],
      high: [0.53, 0.55],
      low: [0.415, 0.435],
      nudge: 0.001,
      turn: 'over',
      show: (v) => (1 - v / (1 - v)) * 100,
      axis: [-10, 25, 5],
      unit: '%: how much smaller the top storey is than the bottom one',
      faces: sans.map((f) => ({ label: `${faceLabel(f)} (8)`, v: (1 - f.halves8 / (1 - f.halves8)) * 100 })),
      lab: [],
      verdict(v) {
        const p = (1 - v / (1 - v)) * 100;
        if (Math.abs(p) < 0.4) return 'You kept the two storeys equal, as the ruler drew them (within 0.4%).';
        if (p > 0) return `Your top storeys are <b>${fmt(p, 1)}%</b> smaller than your bottom ones, in height and in width.`;
        return `Your top storeys are <b>${fmt(-p, 1)}%</b> bigger than the bottom ones. That is the unusual direction.`;
      },
      facesLine() {
        const v = this.faces.map((f) => f.v);
        return `All eight sans serifs make the top of the 8 smaller, by ${fmt(Math.min(...v))}% to ${fmt(Math.max(...v))}%.`;
      },
      why: 'Turn it over: the bigger storey is now on top and the letters look ready to topple. The top of a shape tends to look bigger than an equal bottom, which is why every 8 measured here has the smaller top.',
    },
  ];

  // ---------- drawing a word on a stage ----------
  const TRACK = 40;
  function wordLayout(word, params) {
    let x = 0;
    const parts = [];
    for (const ch of word) {
      const g = L.glyph(ch, params);
      parts.push({ ch, x, g, cx: x + g.advance / 2 });
      x += g.advance + TRACK;
    }
    return { parts, width: x - TRACK };
  }

  function drawStage(t) {
    const svg = t.svg;
    const params = Object.assign({}, L.RULER, { [t.key]: t.value });
    const lay = wordLayout(t.word, params);
    const sideways = t.view.turn && t.turn === 'sideways';
    const slot = CAP + 160;
    const W = sideways ? lay.parts.length * slot - 160 : lay.width;
    const pad = 90;
    const top = CAP + 110;
    const bottom = 110;
    svg.setAttribute('viewBox', `${-pad} ${-top} ${W + 2 * pad} ${top + bottom}`);
    clear(svg);
    if (t.view.lines && !sideways) {
      for (const y of [0, -CAP]) sv('line', { class: 'guide', x1: -pad, x2: W + pad, y1: y, y2: y }, svg);
      if (t.key === 'middle' || t.key === 'halves') sv('line', { class: 'guide mid', x1: -pad, x2: W + pad, y1: -CAP / 2, y2: -CAP / 2 }, svg);
    }
    const wrap = sv('g', null, svg);
    const ghost = t.view.ghost ? wordLayout(t.word, L.RULER) : null;
    const turned = [];
    lay.parts.forEach((p, i) => {
      const g = sv('g', null, wrap);
      sv('path', { class: 'ink', d: p.g.d, transform: `translate(${p.x} 0) scale(1 -1)` }, g);
      if (ghost) {
        const q = ghost.parts[i];
        drawGhost(g, q.g.d, `translate(${p.cx - q.g.advance / 2} 0) scale(1 -1)`);
      }
      if (sideways) turned.push({ g, cx: p.cx, dx: i * slot + CAP / 2 - p.cx });
    });
    const final = () => {
      if (sideways) {
        for (const q of turned) q.g.setAttribute('transform', `translate(${q.dx} 0) rotate(90 ${q.cx} ${-CAP / 2})`);
      } else if (t.view.turn) wrap.setAttribute('transform', `rotate(180 ${lay.width / 2} ${-CAP / 2})`);
    };
    if (t.view.turn && t.animateTurn) {
      // Turn while the reader watches (at once if motion is reduced).
      tween((k) => {
        if (sideways) {
          for (const q of turned) q.g.setAttribute('transform', `translate(${k * q.dx} 0) rotate(${90 * k} ${q.cx} ${-CAP / 2})`);
        } else wrap.setAttribute('transform', `rotate(${180 * k} ${lay.width / 2} ${-CAP / 2})`);
      });
    } else final();
    t.animateTurn = false;
  }

  // ---------- the strip: you, the ruler, the typefaces and the lab on one line ----------
  function drawStrip(t, svg) {
    const w = Math.max(260, Math.round(svg.parentNode.clientWidth || 600));
    const h = 92;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    clear(svg);
    const [a0, a1, step] = t.axis;
    const x0 = 14;
    const x1 = w - 14;
    const X = (v) => x0 + ((Math.min(a1, Math.max(a0, v)) - a0) / (a1 - a0)) * (x1 - x0);
    const axisY = 52;
    sv('line', { class: 'axis', x1: x0, x2: x1, y1: axisY, y2: axisY }, svg);
    for (let v = a0; v <= a1 + 1e-9; v += step) {
      sv('line', { class: 'axis', x1: X(v), x2: X(v), y1: axisY - 3, y2: axisY + 3 }, svg);
      sv('text', { class: 'tick', x: X(v), y: h - 4, 'text-anchor': 'middle', text: `${fmt(v, 0)}${v === a1 ? '%' : ''}` }, svg);
    }
    sv('line', { class: 'ruler', x1: X(0), x2: X(0), y1: 8, y2: axisY + 18 }, svg);
    // Typefaces and lab results stacked in rows above the axis where they would overlap.
    const marks = [
      ...t.faces.map((f) => ({ ...f, kind: 'face' })),
      ...t.lab.map((f) => ({ ...f, kind: 'lab' })),
    ].sort((p, q) => p.v - q.v);
    const rows = [];
    for (const m of marks) {
      const x = X(m.v);
      let r = 0;
      while (rows[r] !== undefined && x - rows[r] < 10) r++;
      rows[r] = x;
      const y = axisY - 10 - r * 10;
      const node =
        m.kind === 'face'
          ? sv('circle', { class: 'face', cx: x, cy: y, r: 4.2 }, svg)
          : sv('rect', { class: 'lab', x: x - 3.6, y: y - 3.6, width: 7.2, height: 7.2, transform: `rotate(45 ${x} ${y})` }, svg);
      sv('title', { text: `${m.label}: ${fmt(m.v)}%` }, node);
    }
    const res = state.tests[t.key];
    if (res && res.tries.length === 2) {
      for (const v of res.tries) sv('circle', { class: 'try', cx: X(t.show(v)), cy: axisY + 14, r: 4.5 }, svg);
      const mean = (res.tries[0] + res.tries[1]) / 2;
      const xm = X(t.show(mean));
      const dot = sv('circle', { class: 'you', cx: xm, cy: axisY + 14, r: 6 }, svg);
      sv('title', { text: `You: ${fmt(t.show(mean))}%` }, dot);
      // Label beside the outermost of the three marks, on whichever side has room.
      const xs = res.tries.map((v) => X(t.show(v))).concat(xm);
      const right = Math.max(...xs) < w - 50;
      const lx = right ? Math.max(...xs) + 9 : Math.min(...xs) - 9;
      sv('text', { class: 'lbl', x: lx, y: axisY + 18, 'text-anchor': right ? 'start' : 'end', text: 'you' }, svg);
    }
  }

  // ---------- one test card ----------
  function buildTest(t, i, list) {
    const li = el('li', { class: 'test', id: `test-${t.key}` }, list);
    const head = el('div', { class: 'test-head' }, li);
    el('span', { class: 'test-num', text: String(i + 1) }, head);
    const hw = el('div', null, head);
    el('h2', { text: t.title }, hw);
    el('p', { class: 'test-ask', text: t.ask }, hw);
    const stage = el('div', { class: 'stage' }, li);
    t.svg = sv('svg', { role: 'img', 'aria-label': `The letters ${t.word.split('').join(' ')}` }, stage);

    const adjust = el('div', { class: 'adjust' }, li);
    const controls = el('div', { class: 'controls' }, adjust);
    const minus = el('button', { type: 'button', class: 'nudge', 'aria-label': t.less, text: '−' }, controls);
    const range = el('input', { type: 'range', min: '0', max: '1000', step: '1', 'aria-label': t.ask }, controls);
    const plus = el('button', { type: 'button', class: 'nudge', 'aria-label': t.more, text: '+' }, controls);
    const commitRow = el('div', { class: 'commit-row' }, adjust);
    const trialNote = el('span', { class: 'trial' }, commitRow);
    const commit = el('button', { type: 'button', class: 'primary', text: 'Looks equal' }, commitRow);

    const reveal = el('div', { class: 'reveal', hidden: '' }, li);
    const toggles = el('div', { class: 'toggles' }, reveal);
    const bLines = el('button', { type: 'button', 'aria-pressed': 'true', text: 'Ruler lines' }, toggles);
    const bGhost = el('button', { type: 'button', 'aria-pressed': 'false', text: 'The ruler’s letters' }, toggles);
    const bTurn = t.turn ? el('button', { type: 'button', 'aria-pressed': 'false', text: t.turn === 'over' ? 'Turn it over' : 'Turn it sideways' }, toggles) : null;
    const verdict = el('p', { class: 'verdict' }, reveal);
    const legend = el('div', { class: 'legend' }, reveal);
    el('span', { class: 'k-you', html: '<i></i>you' }, legend);
    el('span', { class: 'k-try', html: '<i></i>your two tries' }, legend);
    el('span', { class: 'k-ruler', html: '<i></i>ruler' }, legend);
    el('span', { class: 'k-face', html: `<i></i>${t.key === 'point' ? 'serif Vs' : 'sans serifs'}, measured` }, legend);
    if (t.lab.length) el('span', { class: 'k-lab', html: '<i></i>lab study' }, legend);
    const strip = sv('svg', { class: 'strip', role: 'img', 'aria-label': `Your setting against the ruler and the typefaces, in ${t.unit}` }, el('div', null, reveal));
    const facesLine = el('p', { class: 'why small' }, reveal);
    el('p', { class: 'why', text: t.why }, reveal);
    const redoRow = el('div', { class: 'redo-row' }, reveal);
    const redo = el('button', { type: 'button', class: 'quiet', text: 'Do it again' }, redoRow);

    t.view = { lines: true, ghost: false, turn: false };
    let lo = 0;
    let hi = 1;
    let order = Math.random() < 0.5 ? ['high', 'low'] : ['low', 'high'];

    const lim = L.LIMITS[t.key];
    const clampV = (v) => Math.min(hi, lim[1], Math.max(lo, lim[0], v));
    const fromSlider = () => clampV(lo + (hi - lo) * (range.valueAsNumber / 1000));
    function setValue(v) {
      t.value = clampV(v);
      range.value = String(Math.round(((t.value - lo) / (hi - lo)) * 1000));
      drawStage(t);
    }
    function setupTrial() {
      const res = state.tests[t.key] || { tries: [] };
      const n = res.tries.length;
      const side = order[n];
      const [s0, s1] = t.span;
      const span = s1 - s0;
      const [a, b] = t[side];
      const start = a + Math.random() * (b - a);
      // Shift the slider's range at random so that its middle carries no information.
      let shift = (Math.random() * 2 - 1) * 0.12 * span;
      lo = s0 + shift;
      hi = s1 + shift;
      if (lo < lim[0]) { hi += lim[0] - lo; lo = lim[0]; }
      if (hi > lim[1]) { lo -= hi - lim[1]; hi = lim[1]; }
      const margin = 0.04 * span;
      if (start < lo + margin) { lo = start - margin; hi = lo + span; }
      if (start > hi - margin) { hi = start + margin; lo = hi - span; }
      t.view = { lines: false, ghost: false, turn: false };
      trialNote.textContent = n === 0 ? 'Try 1 of 2' : 'Try 2 of 2, starting from the other side';
      setValue(start);
    }
    function showResult() {
      const res = state.tests[t.key];
      adjust.hidden = true;
      reveal.hidden = false;
      t.value = (res.tries[0] + res.tries[1]) / 2;
      t.view = { lines: true, ghost: false, turn: false };
      bLines.setAttribute('aria-pressed', 'true');
      bGhost.setAttribute('aria-pressed', 'false');
      if (bTurn) bTurn.setAttribute('aria-pressed', 'false');
      verdict.innerHTML = t.verdict(t.value);
      facesLine.textContent = t.facesLine();
      drawStage(t);
      drawStrip(t, strip);
    }
    function startOver() {
      state.tests[t.key] = { tries: [] };
      save();
      order = Math.random() < 0.5 ? ['high', 'low'] : ['low', 'high'];
      adjust.hidden = false;
      reveal.hidden = true;
      setupTrial();
      refreshAlphabet();
    }

    range.addEventListener('input', () => {
      t.value = fromSlider();
      drawStage(t);
    });
    minus.addEventListener('click', () => setValue(t.value - t.nudge));
    plus.addEventListener('click', () => setValue(t.value + t.nudge));
    commit.addEventListener('click', () => {
      const res = state.tests[t.key] && state.tests[t.key].tries.length < 2 ? state.tests[t.key] : { tries: [] };
      res.tries.push(+t.value.toFixed(5));
      res.order = order;
      state.tests[t.key] = res;
      save();
      if (res.tries.length < 2) setupTrial();
      else {
        showResult();
        refreshAlphabet();
      }
    });
    bLines.addEventListener('click', () => {
      t.view.lines = !t.view.lines;
      bLines.setAttribute('aria-pressed', String(t.view.lines));
      drawStage(t);
    });
    bGhost.addEventListener('click', () => {
      t.view.ghost = !t.view.ghost;
      bGhost.setAttribute('aria-pressed', String(t.view.ghost));
      drawStage(t);
    });
    if (bTurn) {
      bTurn.addEventListener('click', () => {
        t.view.turn = !t.view.turn;
        bTurn.setAttribute('aria-pressed', String(t.view.turn));
        t.animateTurn = t.view.turn;
        drawStage(t);
      });
    }
    redo.addEventListener('click', startOver);
    t.redrawStrip = () => {
      if (!reveal.hidden) drawStrip(t, strip);
    };
    t.reset = startOver;

    const res = state.tests[t.key];
    if (res && res.tries && res.tries.length === 2) showResult();
    else {
      if (res && res.tries && res.tries.length === 1 && Array.isArray(res.order)) order = res.order;
      setupTrial();
    }
  }

  // ---------- title and alphabet ----------
  function drawTitle() {
    const svg = document.getElementById('title');
    const lay = L.layout('BY EYE', eyeParams(), 30);
    const top = CAP * 1.06;
    const bottom = CAP * 0.06;
    svg.setAttribute('viewBox', `0 ${-top} ${lay.width} ${top + bottom}`);
    clear(svg);
    sv('path', { d: lay.d, transform: 'scale(1 -1)' }, svg);
  }

  const specText = document.getElementById('spec-text');
  const view = { overlay: false, turn: false, all: false };
  const ALL = 'ABCDEFGHIJKLM NOPQRSTUVWXYZ 0123456789';

  // Break text into lines no wider than maxW font units, using the wider of the two alphabets.
  function lines(text, pa, pb, maxW) {
    const words = text.toUpperCase().split(/\s+/).filter(Boolean);
    const width = (w, p) => L.layout(w, p, 0).width;
    const space = L.glyph(' ', L.RULER).advance;
    const out = [];
    let cur = [];
    let curW = 0;
    for (const w of words) {
      const ww = Math.max(width(w, pa), width(w, pb));
      if (cur.length && curW + space + ww > maxW) {
        out.push(cur.join(' '));
        cur = [w];
        curW = ww;
      } else {
        curW += (cur.length ? space : 0) + ww;
        cur.push(w);
      }
    }
    if (cur.length) out.push(cur.join(' '));
    return out.length ? out : [''];
  }
  function setLines(svg, ls, params, ghostParams, animate) {
    const lead = CAP * 1.6;
    const pad = 60;
    let maxW = 0;
    const lays = ls.map((s) => {
      const lay = L.layout(s, params, 0);
      maxW = Math.max(maxW, lay.width);
      return { s, lay };
    });
    const H = lead * (ls.length - 1) + CAP;
    svg.setAttribute('viewBox', `${-pad} ${-CAP - pad} ${Math.max(maxW, 10) + 2 * pad} ${H + 2 * pad}`);
    clear(svg);
    const wrap = sv('g', null, svg);
    lays.forEach(({ s, lay }, i) => {
      const y = i * lead;
      sv('path', { class: 'ink', d: lay.d, transform: `translate(0 ${y}) scale(1 -1)` }, wrap);
      if (ghostParams) {
        // Each of the ruler's letters is centred where the reader's letter is centred.
        L.layout(s, ghostParams, 0).parts.forEach((q, j) => {
          const p = lay.parts[j];
          const gq = L.glyph(q.ch, ghostParams);
          const gp = L.glyph(p.ch, params);
          const dx = p.x + gp.advance / 2 - gq.advance / 2;
          drawGhost(wrap, gq.d, `translate(${dx} ${y}) scale(1 -1)`);
        });
      }
    });
    const cx = maxW / 2;
    const cy = (lead * (ls.length - 1) - CAP) / 2;
    if (view.turn && animate) tween((k) => wrap.setAttribute('transform', `rotate(${180 * k} ${cx} ${cy})`));
    else if (view.turn) wrap.setAttribute('transform', `rotate(180 ${cx} ${cy})`);
  }

  function refreshAlphabet(animate) {
    const eye = eyeParams();
    const n = doneCount();
    const status = document.getElementById('alphabet-status');
    status.textContent =
      n === 5
        ? 'All five corrections are yours. The same letters, drawn twice: once by the ruler, once by your eye.'
        : n === 0
          ? 'No corrections measured yet, so for now both rows are the ruler’s. Each test you finish changes the lower row (and the title).'
          : `${n} of 5 corrections measured; the others are still the ruler’s. The same letters, drawn twice: once by the ruler, once by your eye.`;
    const text = view.all ? ALL : specText.value || ' ';
    const wpx = document.getElementById('alphabet').clientWidth || 700;
    const capPx = wpx < 520 ? 26 : 36;
    const maxW = Math.max(1500, ((wpx - 30) / capPx) * CAP - 120);
    const ls = lines(text, L.RULER, eye, maxW);
    document.getElementById('spec-pair').hidden = view.overlay;
    document.getElementById('spec-over').hidden = !view.overlay;
    if (view.overlay) setLines(document.getElementById('spec-overlay-svg'), ls, eye, L.RULER, animate);
    else {
      setLines(document.getElementById('spec-ruler'), ls, L.RULER, null, animate);
      setLines(document.getElementById('spec-eye'), ls, eye, null, animate);
    }
    drawTitle();
    drawSummary();
    drawMeasuredBack(eye);
  }

  function drawSummary() {
    const box = document.getElementById('summary');
    clear(box);
    const wrap = el('div', { class: 'table-wrap' }, box);
    const table = el('table', null, wrap);
    const hr = el('tr', null, el('thead', null, table));
    for (const h of ['Correction', 'Your eye', 'Typefaces measured']) el('th', { text: h }, hr);
    const tb = el('tbody', null, table);
    for (const t of TESTS) {
      const tr = el('tr', null, tb);
      el('td', { text: t.title }, tr);
      const r = state.tests[t.key];
      const done = r && r.tries.length === 2;
      el('td', { class: 'num', text: done ? `${fmt(t.show((r.tries[0] + r.tries[1]) / 2))}%` : 'not yet' }, tr);
      const v = t.faces.map((f) => f.v);
      el('td', { class: 'num', text: t.key === 'point' ? `none pointed; serif Vs ${fmt(Math.min(...v))} to ${fmt(Math.max(...v))}%` : `${fmt(Math.min(...v))} to ${fmt(Math.max(...v))}%` }, tr);
    }
    el('p', { class: 'small', text: 'Units: overshoots in % of the cap height per side; weights as how much thicker the uprights are; the middle as % of the cap height above it; the halves as how much smaller the top storey is. The ruler is 0 in every row.' }, box);
  }

  function drawMeasuredBack(eye) {
    const table = document.getElementById('measured-back');
    clear(table);
    let m;
    try {
      m = L.measureParams(eye);
    } catch (e) {
      el('tr', null, table).appendChild(el('td', { text: `Could not measure: ${e.message}` }));
      return;
    }
    const hr = el('tr', null, el('thead', null, table));
    for (const h of ['', 'You set', 'Measured off the outlines']) el('th', { text: h }, hr);
    const tb = el('tbody', null, table);
    const rows = [
      ['O beyond the lines, per side', eye.round * 100, m.round * 100, '%', 2],
      ['A and V beyond the lines, per side', eye.point * 100, m.point * 100, '%', 2],
      ['H bar thickness ÷ stem', eye.bar, m.bar, '', 4],
      ['H bar centre ÷ cap height', eye.middle, m.middle, '', 4],
      ['8: top storey’s share of the height', eye.halves, m.halves8, '', 4],
    ];
    for (const [name, a, b, u, d] of rows) {
      const tr = el('tr', null, tb);
      el('td', { text: name }, tr);
      el('td', { class: 'num', text: `${fmt(a, d)}${u}` }, tr);
      el('td', { class: 'num', text: `${fmt(b, d)}${u}` }, tr);
    }
  }

  function drawFacesTable() {
    const table = document.getElementById('faces');
    const hr = el('tr', null, el('thead', null, table));
    for (const h of ['Face', 'O overshoot', 'Uprights thicker', 'Bar above middle', '8: top smaller']) el('th', { text: h }, hr);
    const tb = el('tbody', null, table);
    for (const f of FACES.sans) {
      const tr = el('tr', null, tb);
      el('td', { text: faceLabel(f) }, tr);
      el('td', { class: 'num', text: `${fmt(f.round * 100)}%` }, tr);
      el('td', { class: 'num', text: `${fmt((1 / f.bar - 1) * 100)}%` }, tr);
      el('td', { class: 'num', text: `${fmt((f.middle - 0.5) * 100)}%` }, tr);
      el('td', { class: 'num', text: `${fmt((1 - f.halves8 / (1 - f.halves8)) * 100)}%` }, tr);
    }
    for (const f of FACES.pointed) {
      const tr = el('tr', null, tb);
      el('td', { text: `${f.name} ${f.style}: V’s point ${fmt(f.pointBottom * 100)}% below the baseline` }, tr);
      tr.firstChild.setAttribute('colspan', '5');
    }
  }

  function runChecks() {
    const ul = document.getElementById('checks');
    clear(ul);
    let results;
    try {
      results = L.verifyRuler();
    } catch (e) {
      results = [{ name: 'The checks could not run', pass: false, detail: e.message }];
    }
    for (const r of results) {
      const li = el('li', { class: r.pass ? 'pass' : 'fail' }, ul);
      li.appendChild(document.createTextNode(r.name));
      el('span', { class: 'detail', text: r.detail }, li);
    }
  }

  function download() {
    const eye = eyeParams();
    const rowsTxt = ['ABCDEFGHIJKLM', 'NOPQRSTUVWXYZ', '0123456789', ...lines(specText.value || '', eye, eye, 9000)];
    const lead = CAP * 1.6;
    let maxW = 0;
    let body = '';
    rowsTxt.forEach((s, i) => {
      const lay = L.layout(s, eye, 0);
      maxW = Math.max(maxW, lay.width);
      body += `<path transform="translate(0 ${i * lead}) scale(1 -1)" d="${lay.d}"/>\n`;
    });
    const H = lead * (rowsTxt.length - 1) + CAP;
    const desc = `By Eye alphabet. Corrections: round ${eye.round.toFixed(4)}, point ${eye.point.toFixed(4)}, bar ${eye.bar.toFixed(4)}, middle ${eye.middle.toFixed(4)}, halves ${eye.halves.toFixed(4)}. Cap height 700 units.`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-60 ${-CAP - 60} ${maxW + 120} ${H + 120}">\n<desc>${desc}</desc>\n<g fill="#000">\n${body}</g>\n</svg>\n`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    a.download = 'by-eye-alphabet.svg';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  }

  // ---------- wire up ----------
  const list = document.getElementById('tests');
  TESTS.forEach((t, i) => buildTest(t, i, list));

  specText.addEventListener('input', () => {
    view.all = false;
    document.getElementById('spec-all').setAttribute('aria-pressed', 'false');
    refreshAlphabet();
  });
  const toggle = (id, key) => {
    const b = document.getElementById(id);
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => {
      view[key] = !view[key];
      b.setAttribute('aria-pressed', String(view[key]));
      refreshAlphabet(key === 'turn' && view.turn);
    });
  };
  toggle('spec-overlay', 'overlay');
  toggle('spec-turn', 'turn');
  toggle('spec-all', 'all');
  document.getElementById('spec-dl').addEventListener('click', download);
  document.getElementById('reset').addEventListener('click', () => {
    for (const t of TESTS) t.reset();
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  });

  drawFacesTable();
  refreshAlphabet();
  setTimeout(runChecks, 60);

  let rt = 0;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      refreshAlphabet();
      for (const t of TESTS) t.redrawStrip();
    }, 150);
  });
})();
