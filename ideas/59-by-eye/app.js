/* By Eye: the page. Draws the tests, takes the reader's settings, and sets the two alphabets. */
(function () {
  'use strict';
  const L = window.ByEyeLetters;
  const FACES = window.ByEyeTypefaces;
  const M = window.ByEyeMethod;
  const CAP = L.CAP;
  const NS = 'http://www.w3.org/2000/svg';
  // v2: four tries per test, each with its start. Results taken by the first method (two tries,
  // starts centred on the typefaces' answers) are not carried over.
  const STORE = 'by-eye-v2';
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
  const validTry = (q) => q && Number.isFinite(q.start) && Number.isFinite(q.stop) && (q.side === 1 || q.side === -1);
  function load() {
    try {
      const raw = window.localStorage.getItem(STORE);
      const d = raw ? JSON.parse(raw) : null;
      if (!d || d.v !== 2 || !d.tests) return { v: 2, tests: {} };
      for (const k of Object.keys(d.tests)) {
        const r = d.tests[k];
        if (!r || !Array.isArray(r.tries) || !r.tries.every(validTry) || !Array.isArray(r.sides) || r.sides.length !== M.TRIES) delete d.tests[k];
      }
      return d;
    } catch (e) {
      return { v: 2, tests: {} };
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

  // A test's result: method.js's estimate from the four tries, or null while tries remain.
  function resultOf(key) {
    const r = state.tests[key];
    if (!r || r.tries.length < M.TRIES) return null;
    return M.estimate(key, r.tries);
  }
  // The reader's alphabet: each test with a reliable result takes its value; the ruler's for the rest.
  function eyeParams() {
    const p = Object.assign({}, L.RULER);
    for (const t of TESTS) {
      const res = resultOf(t.key);
      if (res && res.ok) p[t.key] = res.value;
    }
    return p;
  }
  const finished = () => TESTS.filter((t) => resultOf(t.key));
  const reliable = () => TESTS.filter((t) => (resultOf(t.key) || {}).ok);

  // ---------- what the typefaces did, in each test's display units ----------
  const sans = FACES.sans;
  const faceLabel = (f) => `${f.name} ${f.style}`;
  const pctRange = (v, d = 1) => `${fmt(Math.min(...v), d)}% to ${fmt(Math.max(...v), d)}%`;

  const TESTS = [
    {
      key: 'round',
      title: 'Round against flat',
      word: 'HOH',
      ask: 'Make the O look exactly as tall as the H.',
      less: 'Shorter O',
      more: 'Taller O',
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
          return `Your O rises <b>${fmt(p, 1)}%</b> of the cap height above the H and sinks as far below it: it is <b>${fmt(2 * p, 1)}%</b> taller than the H. By the ruler that is too tall. Going by your four tries, it is where the O looks as tall as the H to you, this time.`;
        return `You made the O <b>${fmt(-2 * p, 1)}%</b> shorter than the H. That is the unusual direction: every typeface measured here makes its O taller.`;
      },
      facesLine() {
        const v = this.faces.map((f) => f.v);
        const sides = sans.flatMap((f) => [f.roundTop * 100, f.roundBottom * 100]);
        return `The eight sans serifs measured here (four designs, each in two weights) let their O overshoot by ${pctRange(v)} of the cap height, averaged over top and bottom (median ${fmt(median(v))}%; single sides ${pctRange(sides, 2)}).`;
      },
      why: 'A flat letter sits on the line along its whole width. A round one touches it at a single point, has little ink near it, and seems to stop short. Only the O’s height changes here; its width stays put.',
    },
    {
      key: 'point',
      title: 'Points against flat',
      word: 'HAVE',
      ask: 'Make the point of the A reach the top line and the point of the V reach the baseline, to your eye.',
      less: 'Shorter points',
      more: 'Longer points',
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
        const r = resultOf('round');
        if (r && r.ok && p > 0.15) {
          const ro = r.value * 100;
          if (ro > 0.15) s += ` That is ${fmt(p / ro, 1)} times your overshoot for the O.`;
        }
        return s;
      },
      facesLine() {
        const v = this.faces.map((f) => f.v);
        return `None of the eight sans serifs has a pointed A or V; they cut their points flat, which needs no overshoot. Four serif faces (Liberation Serif and FreeSerif, regular and bold) end their V in a narrow vertex, and sink it ${pctRange(v)} below the baseline.`;
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
      turn: 'sideways',
      show: (v) => (1 / v - 1) * 100,
      axis: [-10, 50, 10],
      unit: '%: how much thicker the uprights are than the horizontals',
      faces: sans.map((f) => ({ label: faceLabel(f), v: (1 / f.bar - 1) * 100 })),
      lab: [
        { label: 'Lab: de Waard et al. 2019, experiment 1, average of 28 people', v: 5.4 },
        { label: 'Lab: experiment 2, average', v: 2.6 },
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
        return `In a lab, with single lines rather than letters and a same-or-different task rather than a slider, an upright had to be 5.4% thicker on average to look as thick as a horizontal (2.6% in a second experiment), and people differed. The eight sans serifs make their H’s uprights ${pctRange(v, 0)} thicker than its bar: type thins its horizontals by more than the bare illusion asks, as the lab’s authors noted of Futura and Avenir. Your four tries are one person at one size, so beside either of these only their direction means much.`;
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
        return `All eight sans serifs raise the centre of the H’s bar, by ${pctRange(v)} of the cap height.`;
      },
      why: 'Turn it over: the bar you raised is now below the middle, and it looks low. Asked to mark the middle of an upright line, people on average mark it a little too high, by an amount that varies from person to person.',
    },
    {
      key: 'halves',
      title: 'Two halves',
      word: 'B8S',
      ask: 'Make the top and bottom storeys of B, 8 and S look exactly the same size.',
      less: 'Smaller top',
      more: 'Bigger top',
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
        return `All eight sans serifs make the top of the 8 smaller, by ${pctRange(v)}.`;
      },
      why: 'Turn it over: the bigger storey is now on top and the letters look ready to topple. The top of a shape tends to look bigger than an equal bottom; that is the usual reason given for the smaller top of every 8 measured here.',
    },
  ];

  // What the fit says about how the reader adjusted, and why there may be no result.
  function fitNote(res) {
    if (!res) return '';
    const closed = (1 - res.left) * 100;
    if (res.ok) {
      if (Math.abs(res.left) < 0.05) return 'From four tries. Each one went very nearly all the way to your setting.';
      if (res.left > 0) return `From four tries. On average each try closed ${fmt(closed, 0)}% of the distance from where it started to your setting, and stopped short of the rest; the result allows for that.`;
      return `From four tries. On average each try went ${fmt(-res.left * 100, 0)}% past your setting; the result allows for that.`;
    }
    if (res.why === 'anchored')
      return `<b>No setting can be read off these four tries.</b> Where you stopped followed where you started: on average each try closed only ${fmt(closed, 0)}% of the distance (the page needs at least half), so the stops say more about the starting points than about the letters. Do it again, and keep adjusting until the letters look equal.`;
    if (res.why === 'overshot')
      return '<b>No setting can be read off these four tries.</b> Starting higher made you stop much lower, by more than half as much, so the stops depend on the starts in a way the page cannot correct. Do it again.';
    if (res.why === 'outside') return '<b>No setting can be read off these four tries:</b> they do not settle inside the range this test can reach. Do it again.';
    return '<b>No setting can be read off these four tries.</b> Do it again.';
  }

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
    const r = state.tests[t.key];
    const res = resultOf(t.key);
    if (!res) return;
    for (const q of r.tries) sv('circle', { class: 'try', cx: X(t.show(q.stop)), cy: axisY + 14, r: 4.5 }, svg);
    const xs = r.tries.map((q) => X(t.show(q.stop)));
    if (res.ok) {
      const xm = X(t.show(res.value));
      const dot = sv('circle', { class: 'you', cx: xm, cy: axisY + 14, r: 6 }, svg);
      sv('title', { text: `You: ${fmt(t.show(res.value))}%` }, dot);
      xs.push(xm);
    }
    // Label beside the outermost mark, on whichever side has room; none if neither side has
    // (the note above the strip says the same thing in words).
    const label = res.ok ? 'you' : 'no setting';
    const room = res.ok ? 32 : 72;
    const xMax = Math.max(...xs);
    const xMin = Math.min(...xs);
    if (xMax + 9 + room <= w) sv('text', { class: 'lbl', x: xMax + 9, y: axisY + 18, 'text-anchor': 'start', text: label }, svg);
    else if (xMin - 9 - room >= 0) sv('text', { class: 'lbl', x: xMin - 9, y: axisY + 18, 'text-anchor': 'end', text: label }, svg);
  }

  // ---------- one test card ----------
  function buildTest(t, i, list) {
    const plan = M.PLAN[t.key];
    const perPx = M.perPx(t.key);
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
    // A strip with no ends and no middle: dragging it changes the setting by how far you drag,
    // and nothing on it shows where any value lies.
    // It is announced as a spin button with no minimum or maximum: a slider's aria-valuemin and
    // aria-valuemax would tell a screen reader where the test's range, and so the ruler at its
    // centre, lies.
    const jog = el('div', { class: 'jog', role: 'spinbutton', tabindex: '0', 'aria-label': `${t.ask} Drag left for ${t.less.toLowerCase()}, right for ${t.more.toLowerCase()}.` }, controls);
    const word = (s) => s.split(' ')[0].toLowerCase();
    el('span', { class: 'jog-end', 'aria-hidden': 'true', text: `◂ ${word(t.less)}` }, jog);
    el('span', { class: 'jog-end', 'aria-hidden': 'true', text: `${word(t.more)} ▸` }, jog);
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
    const fit = el('p', { class: 'fit small' }, reveal);
    const legend = el('div', { class: 'legend' }, reveal);
    const keyYou = el('span', { class: 'k-you', html: '<i></i>you' }, legend);
    el('span', { class: 'k-try', html: '<i></i>your four stops' }, legend);
    el('span', { class: 'k-ruler', html: '<i></i>ruler' }, legend);
    el('span', { class: 'k-face', html: `<i></i>${t.key === 'point' ? 'serif Vs' : 'sans serifs'}, measured` }, legend);
    if (t.lab.length) el('span', { class: 'k-lab', html: '<i></i>lab averages' }, legend);
    const strip = sv('svg', { class: 'strip', role: 'img', 'aria-label': `Your setting against the ruler and the typefaces, in ${t.unit}` }, el('div', null, reveal));
    const facesLine = el('p', { class: 'why small' }, reveal);
    el('p', { class: 'why', text: t.why }, reveal);
    const redoRow = el('div', { class: 'redo-row' }, reveal);
    const redo = el('button', { type: 'button', class: 'quiet', text: 'Do it again' }, redoRow);

    t.view = { lines: true, ghost: false, turn: false };
    const record = () => state.tests[t.key] || (state.tests[t.key] = { tries: [], sides: [...M.pairOrder(Math.random), ...M.pairOrder(Math.random)] });
    const clampV = (v) => Math.min(plan.window[1], Math.max(plan.window[0], v));
    const NOTES = ['Try 1 of 4', 'Try 2 of 4, from the other side', 'Try 3 of 4, starting nearer', 'Try 4 of 4, from the other side'];
    function syncControl() {
      const steps = Math.round((t.value - t.start) / plan.nudge);
      jog.setAttribute('aria-valuenow', String(steps));
      jog.setAttribute('aria-valuetext', steps === 0 ? 'where this try started' : `${Math.abs(steps)} steps ${steps > 0 ? 'up' : 'down'} from where this try started`);
      // The ridges move with the drag; their phase says nothing about the value.
      jog.style.backgroundPosition = `${((((t.value - t.start) / perPx) % 14) + 14) % 14}px 0`;
      commit.disabled = !t.moved;
      const n = (state.tests[t.key] || { tries: [] }).tries.length;
      trialNote.textContent = t.moved ? NOTES[n] : `${NOTES[n]}. It starts deliberately off: move it first.`;
    }
    function setValue(v) {
      const nv = clampV(v);
      if (nv !== t.value) t.moved = true;
      t.value = nv;
      syncControl();
      drawStage(t);
    }
    function setupTrial() {
      const r = record();
      const n = r.tries.length;
      const s = M.startFor(t.key, n, r.tries, r.sides, Math.random);
      t.start = s.start;
      t.side = s.side;
      t.value = s.start;
      t.moved = false;
      t.view = { lines: false, ghost: false, turn: false };
      syncControl();
      drawStage(t);
    }
    function showResult() {
      const res = resultOf(t.key);
      adjust.hidden = true;
      reveal.hidden = false;
      t.value = res.ok ? res.value : plan.ruler;
      t.view = { lines: true, ghost: false, turn: false };
      bLines.setAttribute('aria-pressed', 'true');
      bGhost.setAttribute('aria-pressed', 'false');
      if (bTurn) {
        bTurn.setAttribute('aria-pressed', 'false');
        bTurn.hidden = !res.ok;
      }
      bGhost.hidden = !res.ok;
      keyYou.hidden = !res.ok;
      verdict.innerHTML = res.ok ? t.verdict(res.value) : 'The letters above are drawn by the ruler.';
      fit.innerHTML = fitNote(res);
      facesLine.textContent = t.facesLine();
      drawStage(t);
      drawStrip(t, strip);
    }
    function startOver() {
      delete state.tests[t.key];
      record();
      save();
      adjust.hidden = false;
      reveal.hidden = true;
      setupTrial();
      refreshAlphabet();
    }

    let drag = null;
    jog.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      drag = { id: e.pointerId, x: e.clientX };
      try {
        jog.setPointerCapture(e.pointerId);
      } catch (err) {
        /* capture is a nicety */
      }
      jog.classList.add('active');
      if (e.pointerType === 'mouse') e.preventDefault();
    });
    jog.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x;
      drag.x = e.clientX;
      if (dx) setValue(t.value + dx * perPx);
    });
    const endDrag = (e) => {
      if (drag && e.pointerId === drag.id) {
        drag = null;
        jog.classList.remove('active');
      }
    };
    jog.addEventListener('pointerup', endDrag);
    jog.addEventListener('pointercancel', endDrag);
    jog.addEventListener('keydown', (e) => {
      const steps = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 10, PageDown: -10 }[e.key];
      if (!steps) return;
      e.preventDefault();
      setValue(t.value + steps * (e.shiftKey ? 10 : 1) * plan.nudge);
    });
    minus.addEventListener('click', () => setValue(t.value - plan.nudge));
    plus.addEventListener('click', () => setValue(t.value + plan.nudge));
    commit.addEventListener('click', () => {
      if (!t.moved) return;
      const r = record();
      if (r.tries.length >= M.TRIES) return;
      r.tries.push({ start: +t.start.toFixed(5), stop: +t.value.toFixed(5), side: t.side, moved: true });
      save();
      if (r.tries.length < M.TRIES) setupTrial();
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

    if (resultOf(t.key)) showResult();
    else setupTrial();
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
    const n = reliable().length;
    const failed = finished().length - n;
    const status = document.getElementById('alphabet-status');
    status.textContent =
      (n === 5
        ? 'All five corrections are yours. The same letters, drawn twice: once by the ruler, once by your eye.'
        : n === 0
          ? 'No corrections measured yet, so for now both rows are the ruler’s. Each test you finish changes the lower row (and the title).'
          : `${n} of 5 corrections measured; the others are still the ruler’s. The same letters, drawn twice: once by the ruler, once by your eye.`) +
      (failed ? ` ${failed === 1 ? 'One test' : `${failed} tests`} gave no setting that could be read, so the ruler stands in there too.` : '');
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
      const res = resultOf(t.key);
      el('td', { class: 'num', text: !res ? 'not yet' : res.ok ? `${fmt(t.show(res.value))}%` : 'no setting; do it again' }, tr);
      const v = t.faces.map((f) => f.v);
      el('td', { class: 'num', text: t.key === 'point' ? `none pointed; serif Vs ${fmt(Math.min(...v))} to ${fmt(Math.max(...v))}%` : `${fmt(Math.min(...v))} to ${fmt(Math.max(...v))}%` }, tr);
    }
    el('p', { class: 'small', text: 'Units: overshoots in % of the cap height per side (for the typefaces, the mean of top and bottom); weights as how much thicker the uprights are; the middle as % of the cap height above it; the halves as how much smaller the top storey is. The ruler is 0 in every row. Your column is one person, at one size, four tries a test; the typefaces are design decisions, partly correction and partly style. Only the directions are worth comparing.' }, box);
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
    for (const h of ['Face', 'O overshoot (top / bottom)', 'Uprights thicker', 'Bar above middle', '8: top smaller']) el('th', { text: h }, hr);
    const tb = el('tbody', null, table);
    for (const f of FACES.sans) {
      const tr = el('tr', null, tb);
      el('td', { text: faceLabel(f) }, tr);
      el('td', { class: 'num', text: `${fmt(f.round * 100)}% (${fmt(f.roundTop * 100)} / ${fmt(f.roundBottom * 100)})` }, tr);
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
