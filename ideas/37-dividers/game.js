/*
 * game.js: rendering, input, sound and flow for Dividers.
 * The rules live in rules.js, the levels in levels.js, the solver in solver.js,
 * and stored progress is read back through progress.js.
 */
(function () {
  'use strict';

  const R = window.Dividers;
  const LEVELS = window.DividersLevels;
  const SOLVER = window.DividersSolver;
  const PROGRESS = window.DividersProgress;
  const U = 10; // SVG units per cell
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const $ = (id) => document.getElementById(id);
  const reduced = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const swingMs = () => (reduced.matches ? 0 : 230);

  /* ------------------------------------------------------------ storage */
  const KEY = 'dividers.v1';
  const progress = PROGRESS.defaults();
  function loadProgress() {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (!raw) return;
      // Only well-formed entries survive (see progress.js).
      Object.assign(progress, PROGRESS.clean(raw, LEVELS.length));
    } catch (e) {
      /* no storage: play without memory */
    }
  }
  function saveProgress() {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(progress));
    } catch (e) {
      /* ignore */
    }
  }

  /* -------------------------------------------------------------- sound */
  const audio = { ctx: null, master: null };
  function ensureAudio() {
    if (!progress.sound) return null;
    try {
      if (!audio.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        audio.ctx = new AC();
        audio.master = audio.ctx.createGain();
        audio.master.gain.value = 0.5;
        audio.master.connect(audio.ctx.destination);
      }
      if (audio.ctx.state === 'suspended') audio.ctx.resume();
      return audio.ctx;
    } catch (e) {
      return null;
    }
  }
  function tone(opts) {
    const c = ensureAudio();
    if (!c) return;
    const t0 = c.currentTime + (opts.delay || 0);
    const dur = opts.dur || 0.08;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = opts.type || 'sine';
    const jitter = 1 + (Math.random() - 0.5) * (opts.jitter || 0.1);
    o.frequency.setValueAtTime(opts.f * jitter, t0);
    if (opts.slide) o.frequency.exponentialRampToValueAtTime(opts.slide * jitter, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(opts.g || 0.2, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(audio.master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }
  const SCALE = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.7, 1318.5];
  const sfx = {
    swing() {
      tone({ f: 420, slide: 620, dur: 0.07, type: 'triangle', g: 0.06 });
    },
    land() {
      tone({ f: 1500, slide: 900, dur: 0.035, type: 'square', g: 0.05 });
      tone({ f: 180, dur: 0.05, type: 'sine', g: 0.12 });
    },
    prick(n) {
      const f = SCALE[Math.min(n, SCALE.length - 1)];
      tone({ f, dur: 0.35, type: 'sine', g: 0.18, jitter: 0 });
      tone({ f: f * 2, dur: 0.18, type: 'triangle', g: 0.05, jitter: 0 });
    },
    blocked() {
      tone({ f: 140, slide: 90, dur: 0.1, type: 'triangle', g: 0.16 });
    },
    undo() {
      tone({ f: 600, slide: 380, dur: 0.07, type: 'triangle', g: 0.06 });
    },
    solved(par) {
      const notes = par ? [523.25, 659.25, 783.99, 1046.5, 1318.5] : [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((f, i) => {
        tone({ f, dur: 0.5, type: 'sine', g: 0.16, delay: i * 0.09, jitter: 0 });
        tone({ f: f * 2, dur: 0.3, type: 'triangle', g: 0.04, delay: i * 0.09, jitter: 0 });
      });
    },
  };

  /* --------------------------------------------------------- game state */
  const G = {
    index: 0,
    level: null,
    state: null,
    history: [], // [{ state, move }]
    par: 0,
    active: 'b',
    solved: false,
    anim: null,
    drag: null,
    nodes: {},
  };

  /* --------------------------------------------------------- svg helpers */
  const svg = $('board');
  function el(name, attrs, parent) {
    const n = document.createElementNS(SVG_NS, name);
    for (const k in attrs) if (attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function center(i) {
    const [x, y] = R.xy(G.level, i);
    return [x * U + U / 2, y * U + U / 2];
  }

  function buildBoard() {
    const L = G.level;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute('viewBox', `-1 -1 ${L.w * U + 2} ${L.h * U + 2}`);
    const nodes = (G.nodes = {});
    const warm = R.parity(L, L.start.a);
    const cells = el('g', { class: 'cells' }, svg);
    el('rect', { class: 'sheet', x: 0, y: 0, width: L.w * U, height: L.h * U, rx: 1.2 }, cells);
    for (let i = 0; i < L.w * L.h; i++) {
      const [x, y] = R.xy(L, i);
      el('rect', { class: R.parity(L, i) === warm ? 'c0' : 'c1', x: x * U, y: y * U, width: U, height: U }, cells);
    }
    let d = '';
    for (let x = 1; x < L.w; x++) d += `M${x * U} 0V${L.h * U}`;
    for (let y = 1; y < L.h; y++) d += `M0 ${y * U}H${L.w * U}`;
    el('path', { class: 'grid', d }, cells);
    el('rect', { class: 'frame', x: 0, y: 0, width: L.w * U, height: L.h * U, rx: 1.2 }, cells);

    nodes.trail = el('g', { class: 'trail' }, svg);

    const things = el('g', { class: 'things' }, svg);
    nodes.cells = [];
    nodes.marks = [];
    for (let i = 0; i < L.w * L.h; i++) {
      const [cx, cy] = center(i);
      const t = L.cells[i];
      if (t === R.PIN) {
        const g = el('g', { class: 'pin' }, things);
        el('circle', { class: 'shade', cx: cx + 0.6, cy: cy + 0.8, r: 2.9 }, g);
        el('circle', { class: 'head', cx, cy, r: 2.9 }, g);
        el('circle', { class: 'shine', cx: cx - 0.9, cy: cy - 1, r: 0.8 }, g);
        nodes.cells[i] = g;
      } else if (t === R.HOLE) {
        const g = el('g', { class: 'hole' }, things);
        el('circle', { class: 'rim', cx, cy, r: 3.3 }, g);
        el('circle', { class: 'depth', cx: cx + 0.3, cy: cy + 0.45, r: 2.6 }, g);
        nodes.cells[i] = g;
      }
      const bit = L.markBit[i];
      if (bit >= 0) {
        const g = el('g', { class: 'mark' }, things);
        el('circle', { class: 'ring', cx, cy, r: 1.8 }, g);
        el('circle', { class: 'core', cx, cy, r: 0.55 }, g);
        nodes.marks[bit] = g;
      }
    }

    nodes.fx = el('g', { class: 'fx' }, svg);
    nodes.dots = el('g', { class: 'dots' }, svg);

    const dv = el('g', { class: 'dividers' }, svg);
    nodes.dividers = dv;
    nodes.barShadow = el('line', { class: 'barshadow' }, dv);
    nodes.shadowA = el('circle', { class: 'tipshadow', r: 2.2 }, dv);
    nodes.shadowB = el('circle', { class: 'tipshadow', r: 2.2 }, dv);
    nodes.bar = el('line', { class: 'bar' }, dv);
    nodes.knob = el('circle', { class: 'knob', r: 1.1 }, dv);
    nodes.tipA = el('circle', { class: 'tip a', r: 2.2 }, dv);
    nodes.tipB = el('circle', { class: 'tip b', r: 2.2 }, dv);
    nodes.ring = el('circle', { class: 'activering', r: 3.4 }, dv);
    size();
  }

  function size() {
    const wrap = $('boardWrap');
    const L = G.level;
    if (!L) return;
    const rect = wrap.getBoundingClientRect();
    const availW = Math.max(120, rect.width);
    const availH = Math.max(120, rect.height);
    const unitsW = L.w * U + 2;
    const unitsH = L.h * U + 2;
    const scale = Math.min(availW / unitsW, availH / unitsH, 8);
    svg.setAttribute('width', Math.floor(unitsW * scale));
    svg.setAttribute('height', Math.floor(unitsH * scale));
  }

  /* -------------------------------------------------------- rendering */
  // Draw the dividers with leg tips at the given SVG points. `lift` (0..1)
  // raises the named moving leg off the paper.
  function drawDividers(pa, pb, moving, lift) {
    const n = G.nodes;
    const la = moving === 'a' ? lift : 0;
    const lb = moving === 'b' ? lift : 0;
    const sh = (l) => 0.5 + l * 1.4;
    n.tipA.setAttribute('cx', pa[0]);
    n.tipA.setAttribute('cy', pa[1]);
    n.tipA.setAttribute('r', 2.2 * (1 + 0.35 * la));
    n.tipB.setAttribute('cx', pb[0]);
    n.tipB.setAttribute('cy', pb[1]);
    n.tipB.setAttribute('r', 2.2 * (1 + 0.35 * lb));
    n.shadowA.setAttribute('cx', pa[0] + sh(la));
    n.shadowA.setAttribute('cy', pa[1] + sh(la));
    n.shadowA.setAttribute('r', 2.2 * (1 + 0.15 * la));
    n.shadowB.setAttribute('cx', pb[0] + sh(lb));
    n.shadowB.setAttribute('cy', pb[1] + sh(lb));
    n.shadowB.setAttribute('r', 2.2 * (1 + 0.15 * lb));
    for (const line of [n.bar, n.barShadow]) {
      const off = line === n.barShadow ? 0.6 + lift * 0.8 : 0;
      line.setAttribute('x1', pa[0] + off);
      line.setAttribute('y1', pa[1] + off);
      line.setAttribute('x2', pb[0] + off);
      line.setAttribute('y2', pb[1] + off);
    }
    n.knob.setAttribute('cx', (pa[0] + pb[0]) / 2);
    n.knob.setAttribute('cy', (pa[1] + pb[1]) / 2);
    const ap = G.active === 'a' ? pa : pb;
    n.ring.setAttribute('cx', ap[0]);
    n.ring.setAttribute('cy', ap[1]);
  }

  function drawStill() {
    drawDividers(center(G.state.a), center(G.state.b), null, 0);
  }

  function updateMarks() {
    const L = G.level;
    for (let bit = 0; bit < L.marks.length; bit++) {
      const g = G.nodes.marks[bit];
      const pricked = (G.state.mask >> bit) & 1;
      g.classList.toggle('pricked', !!pricked);
      if (pricked) {
        const i = L.marks[bit];
        const leg = R.parity(L, i) === R.parity(L, L.start.a) ? 'a' : 'b';
        g.classList.add(leg);
      } else {
        g.classList.remove('a', 'b');
      }
    }
  }

  function updateDots() {
    const n = G.nodes;
    while (n.dots.firstChild) n.dots.removeChild(n.dots.firstChild);
    if (G.solved) return;
    for (const m of R.moves(G.level, G.state)) {
      const [cx, cy] = center(m.to);
      const on = m.leg === G.active;
      const g = el('g', { class: 'dotg' }, n.dots);
      el('circle', { class: 'dot ' + m.leg + (on ? ' on' : ''), cx, cy, r: on ? 1.7 : 1.3 }, g);
      if (on) el('text', { class: 'glyph', x: cx, y: cy + 0.85 }, g).textContent = m.turn === 'cw' ? '↻' : '↺';
      const hit = el('circle', { class: 'hit', cx, cy, r: 4.9 }, g);
      hit.dataset.leg = m.leg;
      hit.dataset.turn = m.turn;
    }
  }

  function updateHud() {
    $('moveCount').textContent = G.history.length;
    $('par').textContent = G.par;
    $('undoBtn').disabled = G.history.length === 0;
    $('levelNo').textContent = G.index + 1;
    $('levelName').textContent = G.level.name;
    $('hint').textContent = G.level.hint;
  }

  let toastTimer = 0;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 1300);
  }

  function ripple(i, leg) {
    if (reduced.matches) return;
    const [cx, cy] = center(i);
    const c = el('circle', { class: 'ripple animated ' + leg, cx, cy, r: 3.2 }, G.nodes.fx);
    setTimeout(() => c.remove(), 500);
  }

  function flash(node, cls) {
    if (!node) return;
    node.classList.remove(cls);
    void node.getBoundingClientRect();
    node.classList.add(cls);
    setTimeout(() => node.classList.remove(cls), 400);
  }

  /* ---------------------------------------------------------- the arc */
  function arcPath(pivot, from, a0, a1) {
    const [px, py] = center(pivot);
    const [fx, fy] = center(from);
    const tx = px + U * Math.cos(a1);
    const ty = py + U * Math.sin(a1);
    if (Math.abs(a1 - a0) < 0.01) return `M${fx} ${fy}`;
    const sweep = a1 > a0 ? 1 : 0;
    return `M${fx} ${fy}A${U} ${U} 0 0 ${sweep} ${tx} ${ty}`;
  }
  function angles(move) {
    const [px, py] = center(move.pivot);
    const [fx, fy] = center(move.from);
    const a0 = Math.atan2(fy - py, fx - px);
    // Clockwise on screen (y down) is the positive angle direction.
    const a1 = a0 + (move.turn === 'cw' ? Math.PI / 2 : -Math.PI / 2);
    return [a0, a1];
  }

  /* ----------------------------------------------------------- moves */
  function finishAnim() {
    const an = G.anim;
    if (!an) return;
    G.anim = null;
    if (an.raf) cancelAnimationFrame(an.raf);
    an.done();
  }
  // Drop an animation without its landing effects (used when the board is replaced).
  function cancelAnim() {
    const an = G.anim;
    if (!an) return;
    G.anim = null;
    if (an.raf) cancelAnimationFrame(an.raf);
  }

  // Animate one swing. `reverse` plays it backwards (undo). The logical state
  // has already changed; this only moves the picture.
  function animateSwing(move, reverse, done) {
    finishAnim();
    const dur = swingMs();
    const [a0, a1] = angles(move);
    const other = move.leg === 'a' ? 'b' : 'a';
    const pivotPt = center(move.pivot);
    let path;
    if (!reverse) {
      path = el('path', { d: `M0 0` }, G.nodes.trail);
    } else {
      path = move.path || null;
    }
    const an = { raf: 0, done: null };
    const t0 = performance.now();
    const place = (t) => {
      const e = 1 - Math.pow(1 - t, 3);
      const a = reverse ? a1 + (a0 - a1) * e : a0 + (a1 - a0) * e;
      const tip = [pivotPt[0] + U * Math.cos(a), pivotPt[1] + U * Math.sin(a)];
      const lift = Math.sin(Math.PI * t);
      if (move.leg === 'a') drawDividers(tip, pivotPt, 'a', lift);
      else drawDividers(pivotPt, tip, 'b', lift);
      if (path) path.setAttribute('d', arcPath(move.pivot, move.from, a0, a));
    };
    an.done = () => {
      if (reverse) {
        if (path) path.remove();
      } else {
        path.setAttribute('d', arcPath(move.pivot, move.from, a0, a1));
        move.path = path;
      }
      drawStill();
      done();
    };
    G.anim = an;
    if (dur === 0) {
      finishAnim();
      return;
    }
    const step = (now) => {
      const t = Math.min(1, (now - t0) / dur);
      place(t);
      if (t < 1) an.raf = requestAnimationFrame(step);
      else finishAnim();
    };
    place(0);
    an.raf = requestAnimationFrame(step);
    void other;
  }

  function doMove(move) {
    if (G.solved) return;
    const before = G.state;
    const next = R.apply(G.level, before, move);
    const newBit = next.mask & ~before.mask;
    G.history.push({ state: before, move });
    G.state = next;
    G.active = move.leg;
    if (R.isSolved(G.level, next)) G.solved = true;
    sfx.swing();
    updateHud();
    updateDots();
    animateSwing(move, false, () => {
      sfx.land();
      ripple(move.to, move.leg);
      if (newBit) {
        updateMarks();
        const bit = Math.log2(newBit);
        flash(G.nodes.marks[bit], 'pop');
        let count = 0;
        for (let b = 0; b < G.level.marks.length; b++) if ((next.mask >> b) & 1) count++;
        sfx.prick(count - 1);
      }
      if (G.solved) onSolved();
    });
  }

  function undo() {
    if (!G.history.length) return;
    const wasSolved = G.solved;
    const { state, move } = G.history.pop();
    G.state = state;
    G.solved = false;
    G.active = move.leg;
    if (wasSolved) {
      hide('win');
      G.nodes.trail.classList.remove('glow');
    }
    sfx.undo();
    updateHud();
    updateMarks();
    updateDots();
    animateSwing(move, true, () => {});
  }

  function restart() {
    if (!G.history.length && !G.solved) return;
    cancelAnim();
    G.history = [];
    G.state = R.initialState(G.level);
    G.solved = false;
    G.active = 'b';
    hide('win');
    while (G.nodes.trail.firstChild) G.nodes.trail.removeChild(G.nodes.trail.firstChild);
    G.nodes.trail.classList.remove('glow');
    updateHud();
    updateMarks();
    updateDots();
    drawStill();
  }

  function loadLevel(i) {
    cancelAnim();
    G.index = Math.max(0, Math.min(LEVELS.length - 1, i));
    G.level = R.parse(LEVELS[G.index]);
    G.state = R.initialState(G.level);
    G.history = [];
    G.solved = false;
    G.active = 'b';
    const a = SOLVER.solve(G.level);
    G.par = a.solvable ? a.moves : 0;
    progress.level = G.index;
    saveProgress();
    hide('win');
    buildBoard();
    updateHud();
    updateMarks();
    updateDots();
    drawStill();
    size();
    requestAnimationFrame(size);
  }

  function onSolved() {
    const n = G.history.length;
    const par = n <= G.par;
    const prev = progress.best[G.index];
    if (prev === undefined || n < prev) progress.best[G.index] = n;
    saveProgress();
    G.nodes.trail.classList.add('glow');
    const marks = G.nodes.marks;
    marks.forEach((node, bit) => {
      setTimeout(() => flash(node, 'done'), reduced.matches ? 0 : 60 * bit);
    });
    sfx.solved(par);
    $('winResult').textContent = `${n} ${n === 1 ? 'move' : 'moves'}`;
    $('winResult').classList.toggle('par', par);
    $('winSub').textContent = par
      ? `That is par. ${G.index + 1 < LEVELS.length ? 'On to the next sheet.' : 'That was the last sheet.'}`
      : `Par is ${G.par}. ${n - G.par === 1 ? 'One swing' : n - G.par + ' swings'} over. Undo to try a tighter line, or move on.`;
    $('nextBtn').textContent = '';
    $('nextBtn').append(G.index + 1 < LEVELS.length ? 'Next ' : 'Levels ', Object.assign(document.createElement('kbd'), { textContent: 'Enter' }));
    clearTimeout(G.winTimer);
    G.winTimer = setTimeout(() => show('win'), reduced.matches ? 0 : 650);
  }

  function nextLevel() {
    if (G.index + 1 < LEVELS.length) loadLevel(G.index + 1);
    else {
      hide('win');
      openLevels();
    }
  }

  /* -------------------------------------------------------- overlays */
  function show(id) {
    $(id).classList.remove('hidden');
  }
  function hide(id) {
    if (id === 'win') clearTimeout(G.winTimer);
    $(id).classList.add('hidden');
  }
  function anyOverlay() {
    return ['win', 'levels', 'help'].find((id) => !$(id).classList.contains('hidden')) || null;
  }
  function openLevels() {
    const grid = $('levelGrid');
    grid.textContent = '';
    LEVELS.forEach((lv, i) => {
      const b = document.createElement('button');
      b.className = 'lvl';
      const best = progress.best[i];
      if (best !== undefined) {
        b.classList.add('solved');
        const par = SOLVER.solve(R.parse(lv)).moves;
        if (best <= par) b.classList.add('par');
      }
      if (i === G.index) b.classList.add('current');
      // Built as nodes with textContent: nothing read from storage is ever parsed as HTML.
      for (const [cls, text] of [
        ['st', ''],
        ['n', String(i + 1)],
        ['nm', lv.name],
        ...(best !== undefined ? [['best', String(best)]] : []),
      ]) {
        const span = document.createElement('span');
        span.className = cls;
        span.textContent = text;
        b.appendChild(span);
      }
      b.setAttribute('aria-label', `Level ${i + 1}, ${lv.name}${best !== undefined ? `, best ${best} moves` : ''}`);
      b.addEventListener('click', () => {
        hide('levels');
        loadLevel(i);
      });
      grid.appendChild(b);
    });
    show('levels');
  }

  /* ----------------------------------------------------------- input */
  function cellFromEvent(e) {
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const m = svg.getScreenCTM();
    if (!m) return -1;
    const p = pt.matrixTransform(m.inverse());
    const x = Math.floor(p.x / U);
    const y = Math.floor(p.y / U);
    if (x < 0 || y < 0 || x >= G.level.w || y >= G.level.h) return -1;
    return y * G.level.w + x;
  }

  // Why a tap on `cell` is not a legal landing, if it is where a leg would land.
  function explainBlocked(cell) {
    const L = G.level;
    for (const leg of ['a', 'b']) {
      const other = leg === 'a' ? 'b' : 'a';
      const pivot = G.state[other];
      const from = G.state[leg];
      const [px, py] = R.xy(L, pivot);
      const [fx, fy] = R.xy(L, from);
      for (const turn of ['cw', 'ccw']) {
        const [ex, ey] = R.rotate(fx - px, fy - py, turn);
        const tx = px + ex;
        const ty = py + ey;
        if (tx < 0 || ty < 0 || tx >= L.w || ty >= L.h) continue;
        if (ty * L.w + tx !== cell) continue;
        const sx = px + (fx - px) + ex;
        const sy = py + (fy - py) + ey;
        const land = L.cells[cell];
        if (land === R.PIN) return { node: G.nodes.cells[cell], msg: 'A pin is in the way' };
        if (land === R.HOLE) return { node: G.nodes.cells[cell], msg: 'A leg can’t stand in a hole' };
        if (R.cellAt(L, sx, sy) === R.PIN) {
          const inside = sx >= 0 && sy >= 0 && sx < L.w && sy < L.h;
          return { node: inside ? G.nodes.cells[sy * L.w + sx] : null, msg: inside ? 'The pin in the corner blocks the swing' : 'No room to swing past the edge' };
        }
      }
    }
    return null;
  }

  function tryLanding(cell, leg) {
    const ms = R.moves(G.level, G.state).filter((m) => m.to === cell && (!leg || m.leg === leg));
    if (!ms.length) return false;
    doMove(ms[0]);
    return true;
  }

  svg.addEventListener('pointerdown', (e) => {
    if (anyOverlay()) return;
    ensureAudio();
    e.preventDefault();
    const cell = cellFromEvent(e);
    if (cell < 0 || G.solved) return;
    if (tryLanding(cell, null)) return;
    if (cell === G.state.a || cell === G.state.b) {
      G.active = cell === G.state.a ? 'a' : 'b';
      G.drag = { leg: G.active, id: e.pointerId };
      try {
        svg.setPointerCapture(e.pointerId);
      } catch (err) {
        /* ignore */
      }
      updateDots();
      drawStill();
      return;
    }
    const why = explainBlocked(cell);
    if (why) {
      flash(why.node, 'block');
      flash(G.nodes.dividers, 'wiggle');
      toast(why.msg);
      sfx.blocked();
    }
  });
  svg.addEventListener('pointerup', (e) => {
    if (!G.drag || G.drag.id !== e.pointerId) return;
    const leg = G.drag.leg;
    G.drag = null;
    const cell = cellFromEvent(e);
    if (cell >= 0 && cell !== G.state[leg]) tryLanding(cell, leg);
  });
  svg.addEventListener('pointercancel', () => {
    G.drag = null;
  });

  function swingActive(turn) {
    const m = R.findMove(G.level, G.state, G.active, turn);
    if (m) doMove(m);
    else {
      flash(G.nodes.dividers, 'wiggle');
      sfx.blocked();
      toast('That leg can’t swing that way');
    }
  }
  function toggleActive() {
    G.active = G.active === 'a' ? 'b' : 'a';
    updateDots();
    drawStill();
  }

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const over = anyOverlay();
    if (over) {
      if (e.key === 'Escape') {
        hide(over);
        e.preventDefault();
      } else if (over === 'win' && (e.key === 'Enter' || e.key.toLowerCase() === 'n')) {
        nextLevel();
        e.preventDefault();
      } else if (over === 'win' && e.key.toLowerCase() === 'r') {
        restart();
        e.preventDefault();
      } else if (over === 'win' && (e.key.toLowerCase() === 'z' || e.key === 'Backspace')) {
        undo();
        e.preventDefault();
      }
      return;
    }
    const k = e.key;
    const lk = k.toLowerCase();
    // Leave Tab alone while a button has focus, so keyboard users can still reach the toolbar.
    if (k === 'Tab' && document.activeElement && document.activeElement.tagName === 'BUTTON') return;
    if (k === 'ArrowLeft' || lk === 'a') swingActive('ccw');
    else if (k === 'ArrowRight' || lk === 'd') swingActive('cw');
    else if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'Tab' || k === ' ' || lk === 'w' || lk === 's') toggleActive();
    else if (lk === 'z' || k === 'Backspace') undo();
    else if (lk === 'r') restart();
    else if (lk === 'l') openLevels();
    else if (lk === 'm') toggleSound();
    else if (k === '?' || lk === 'h') show('help');
    else if (lk === 'n' && G.solved) nextLevel();
    else if (k === '[') loadLevel(G.index - 1);
    else if (k === ']') loadLevel(G.index + 1);
    else return;
    ensureAudio();
    e.preventDefault();
  });

  function toggleSound() {
    progress.sound = !progress.sound;
    saveProgress();
    const b = $('soundBtn');
    b.setAttribute('aria-pressed', String(progress.sound));
    b.setAttribute('aria-label', progress.sound ? 'Sound on' : 'Sound off');
    if (progress.sound) {
      ensureAudio();
      sfx.land();
    }
  }

  $('undoBtn').addEventListener('click', () => {
    ensureAudio();
    undo();
  });
  $('restartBtn').addEventListener('click', () => {
    ensureAudio();
    restart();
  });
  $('soundBtn').addEventListener('click', toggleSound);
  $('helpBtn').addEventListener('click', () => show('help'));
  $('closeHelp').addEventListener('click', () => hide('help'));
  $('levelsBtn').addEventListener('click', openLevels);
  $('closeLevels').addEventListener('click', () => hide('levels'));
  $('nextBtn').addEventListener('click', nextLevel);
  $('replayBtn').addEventListener('click', restart);
  for (const id of ['win', 'levels', 'help']) {
    $(id).addEventListener('click', (e) => {
      if (e.target === $(id) && id !== 'win') hide(id);
    });
  }
  window.addEventListener('resize', size);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', size);
  if (window.ResizeObserver) new ResizeObserver(() => size()).observe($('boardWrap'));

  /* ----------------------------------------------------------- start */
  loadProgress();
  $('soundBtn').setAttribute('aria-pressed', String(progress.sound));
  $('soundBtn').setAttribute('aria-label', progress.sound ? 'Sound on' : 'Sound off');
  loadLevel(progress.level);

  // A small handle for automated play-testing (not used by the page itself).
  window.DividersGame = {
    get state() {
      return G.state;
    },
    get index() {
      return G.index;
    },
    get solved() {
      return G.solved;
    },
    get moves() {
      return G.history.length;
    },
    get par() {
      return G.par;
    },
    get active() {
      return G.active;
    },
    get level() {
      return G.level;
    },
    loadLevel,
  };
})();
