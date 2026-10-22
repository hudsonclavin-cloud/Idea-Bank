// Desire Lines — rendering and interaction. The simulation itself lives in sim.js
// (loaded first, as the global DesireSim). Classic scripts, so file:// works.
(function () {
  'use strict';
  const { TrailSim, SCENARIOS, loadScenario, DEFAULTS, MAX_DOORS, HEDGE, WATER } = window.DesireSim;

  const N = 200; // grid cells per side (the lawn is "100 m" across, so a cell is 0.5 m)
  const sim = new TrailSim({ N, seed: (Math.random() * 2 ** 31) >>> 0 });
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const $ = (id) => document.getElementById(id);
  const canvas = $('view');
  const ctx = canvas.getContext('2d');
  const stage = $('stage');

  const PALETTE = ['#ffd166', '#ff6b8b', '#5fd3f3', '#ff9f5a', '#c99bff', '#f4f4ee', '#8ef0d9', '#ffb3c1', '#e9f57a', '#9ec5ff'];
  const LETTERS = 'ABCDEFGHIJ';
  const TOOLS = ['door', 'pave', 'hedge', 'erase'];
  const BRUSH = { pave: 1.4, hedge: 1.7, erase: 4 };
  const HINTS = {
    door: 'Tap the grass to add a door. Drag a door to move it; tap a door to remove it.',
    pave: 'Drag to lay pavement. Walkers like it underfoot, but they will not go far out of their way for it.',
    hedge: 'Drag to plant a hedge. Walkers have to go around it.',
    erase: 'Drag to dig up pavement, hedges and trodden ground, and lay fresh turf.',
  };

  let running = !reduceMotion;
  let stepsPerFrame = reduceMotion ? 4 : 12;
  let tool = 'door';
  let showLines = false;
  let showWalkers = true;
  let dirty = true;
  let frameNo = 0;
  let history = [];
  const HISTORY = 180; // chart points (one every 30 running frames)
  let hintTimer = 0;

  // ------------------------------------------------------------------ doors' colours

  const colorOf = new Map(); // door id -> palette index
  function colorIndex(d) {
    let k = colorOf.get(d.id);
    if (k === undefined) {
      const used = new Set();
      for (const o of sim.doors) if (colorOf.has(o.id)) used.add(colorOf.get(o.id));
      k = 0;
      while (used.has(k)) k++;
      colorOf.set(d.id, k);
    }
    return k;
  }

  // ------------------------------------------------------------------ canvas sizing

  let cssSize = 0;
  let dpr = 1;
  let grassTex = null;
  let vignette = null;
  const ground = document.createElement('canvas');
  ground.width = ground.height = N;
  const gctx = ground.getContext('2d');
  const groundImg = gctx.createImageData(N, N);
  const tint = new Float32Array(N * N);
  for (let c = 0; c < tint.length; c++) tint[c] = Math.random() * 2 - 1;

  function resize() {
    const size = Math.round(stage.getBoundingClientRect().width);
    const ndpr = Math.min(2, window.devicePixelRatio || 1);
    if (!size || (size === cssSize && ndpr === dpr)) return;
    cssSize = size;
    dpr = ndpr;
    const W = Math.round(cssSize * dpr);
    canvas.width = W;
    canvas.height = W;
    grassTex = makeGrass(W);
    vignette = ctx.createRadialGradient(W / 2, W / 2, W * 0.35, W / 2, W / 2, W * 0.78);
    vignette.addColorStop(0, 'rgba(10, 25, 5, 0)');
    vignette.addColorStop(1, 'rgba(10, 25, 5, 0.32)');
    dirty = true;
  }

  // A grass texture: mottled greens plus a tiled scatter of tiny blades.
  function makeGrass(W) {
    const c = document.createElement('canvas');
    c.width = c.height = W;
    const g = c.getContext('2d');
    g.fillStyle = '#5a8a3a';
    g.fillRect(0, 0, W, W);
    const m = document.createElement('canvas');
    m.width = m.height = 16;
    const mg = m.getContext('2d');
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        mg.fillStyle = `hsl(${88 + Math.random() * 16}, ${36 + Math.random() * 14}%, ${29 + Math.random() * 10}%)`;
        mg.fillRect(x, y, 1, 1);
      }
    g.globalAlpha = 0.6;
    g.imageSmoothingEnabled = true;
    g.drawImage(m, 0, 0, W, W);
    g.globalAlpha = 1;
    const T = Math.round(96 * dpr);
    const t = document.createElement('canvas');
    t.width = t.height = T;
    const tg = t.getContext('2d');
    tg.lineCap = 'round';
    tg.lineWidth = Math.max(1, dpr * 0.9);
    for (let i = 0; i < 420; i++) {
      const x = Math.random() * T;
      const y = Math.random() * T;
      const len = (2 + Math.random() * 4) * dpr;
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.1;
      tg.strokeStyle = Math.random() < 0.5 ? 'rgba(30, 70, 20, 0.35)' : 'rgba(160, 200, 100, 0.25)';
      tg.beginPath();
      tg.moveTo(x, y);
      tg.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      tg.stroke();
    }
    g.fillStyle = g.createPattern(t, 'repeat');
    g.fillRect(0, 0, W, W);
    return c;
  }

  // ------------------------------------------------------------------ rendering

  const smooth = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };

  function paintGround() {
    const d = groundImg.data;
    const { G, paved, wall } = sim;
    for (let c = 0, o = 0; c < G.length; c++, o += 4) {
      const nz = tint[c];
      if (wall[c] === HEDGE) {
        d[o] = 40 + nz * 9;
        d[o + 1] = 76 + nz * 16;
        d[o + 2] = 34 + nz * 7;
        d[o + 3] = 255;
      } else if (wall[c] === WATER) {
        d[o] = 72 + nz * 5;
        d[o + 1] = 126 + nz * 7;
        d[o + 2] = 166 + nz * 8;
        d[o + 3] = 255;
      } else if (paved[c]) {
        const v = 203 + nz * 4;
        d[o] = v;
        d[o + 1] = v - 5;
        d[o + 2] = v - 16;
        d[o + 3] = 255;
      } else {
        const g = G[c];
        if (g < 0.012) {
          d[o + 3] = 0;
          continue;
        }
        const t = smooth(0.1, 0.6, g); // trampled grass -> bare dirt
        d[o] = 168 - 30 * t + nz * 8;
        d[o + 1] = 158 - 55 * t + nz * 7;
        d[o + 2] = 90 - 24 * t + nz * 5;
        d[o + 3] = 245 * smooth(0.012, 0.32, g);
      }
    }
    gctx.putImageData(groundImg, 0, 0);
  }

  function render() {
    if (!grassTex) return;
    const W = canvas.width;
    const s = W / N; // device pixels per cell
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.drawImage(grassTex, 0, 0);
    paintGround();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(ground, 0, 0, W, W);
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, W);

    const doors = sim.doors;
    if (showLines && doors.length > 1) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 245, 0.6)';
      ctx.lineWidth = 1.5 * dpr;
      ctx.setLineDash([6 * dpr, 6 * dpr]);
      ctx.beginPath();
      for (let i = 0; i < doors.length; i++)
        for (let j = i + 1; j < doors.length; j++) {
          ctx.moveTo(doors[i].x * s, doors[i].y * s);
          ctx.lineTo(doors[j].x * s, doors[j].y * s);
        }
      ctx.stroke();
      ctx.restore();
    }

    if (showWalkers && sim.nw) drawWalkers(s);
    drawDoors(s);

    if (hover && tool !== 'door' && !pointer.down) {
      ctx.strokeStyle = 'rgba(255, 255, 240, 0.85)';
      ctx.lineWidth = 1.5 * dpr;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(hover.x * s, hover.y * s, BRUSH[tool] * s, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawWalkers(s) {
    const { wx, wy, wvx, wvy, wdest, nw } = sim;
    // At high speed, draw each walker as a short streak along its motion.
    const tail = Math.min(stepsPerFrame, 4) * s * (running ? 1 : 0);
    const w = Math.max(1.7 * dpr, s * 0.62);
    ctx.lineCap = 'round';
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(20, 28, 14, 0.45)';
    ctx.lineWidth = w + 1.4 * dpr;
    ctx.beginPath();
    for (let k = 0; k < nw; k++) {
      const x = wx[k] * s;
      const y = wy[k] * s;
      ctx.moveTo(x - wvx[k] * tail, y - wvy[k] * tail);
      ctx.lineTo(x + 0.01, y);
    }
    ctx.stroke();
    ctx.lineWidth = w;
    for (const d of sim.doors) {
      ctx.strokeStyle = PALETTE[colorIndex(d)];
      ctx.beginPath();
      const id = d.id;
      for (let k = 0; k < nw; k++) {
        if (wdest[k] !== id) continue;
        const x = wx[k] * s;
        const y = wy[k] * s;
        ctx.moveTo(x - wvx[k] * tail, y - wvy[k] * tail);
        ctx.lineTo(x + 0.01, y);
      }
      ctx.stroke();
    }
  }

  function drawDoors(s) {
    const r = Math.max(10 * dpr, s * 2.4);
    ctx.setLineDash([]);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.round(r * 1.05)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    for (const d of sim.doors) {
      const k = colorIndex(d);
      const x = d.x * s;
      const y = d.y * s;
      ctx.beginPath();
      ctx.arc(x, y + 1.5 * dpr, r + 1.5 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(10, 20, 5, 0.35)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = PALETTE[k];
      ctx.fill();
      ctx.lineWidth = 2 * dpr;
      ctx.strokeStyle = '#1b2416';
      ctx.stroke();
      if (pointer.door === d) {
        ctx.beginPath();
        ctx.arc(x, y, r + 5 * dpr, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 255, 240, 0.9)';
        ctx.stroke();
      }
      ctx.fillStyle = '#1b2416';
      ctx.fillText(LETTERS[k], x, y + r * 0.05);
    }
  }

  // ------------------------------------------------------------------ stats + chart

  const chart = $('chart');
  const cctx = chart.getContext('2d');
  const css = getComputedStyle(document.documentElement);

  function fmtPct(x, digits = 0) {
    return `${(x * 100).toFixed(digits)}%`;
  }

  function updateStats(push) {
    const m = sim.metrics();
    $('sTrips').textContent = m.arrived.toLocaleString('en-US');
    $('sDetour').textContent = m.arrived ? fmtPct(m.detour, 1) : '–';
    const metres = (cells) => `${Math.round(cells / 2)} m`; // a cell is half a metre
    const ratio = m.web > 0 ? m.trail / m.web : 0;
    $('sTrail').textContent = m.web > 0 ? metres(m.trail) : '–';
    $('sTrailSub').textContent = m.web > 0 ? `${fmtPct(ratio)} of the ${metres(m.web)} straight-line web` : '';
    $('sPave').textContent = m.hasPavement ? fmtPct(m.paveShare) : '–';
    if (push) {
      history.push({ d: m.arrived ? m.detour : 0, w: ratio });
      if (history.length > HISTORY) history.shift();
      drawChart();
    }
  }

  // Two stacked sparklines: trail network (as a share of the straight-line web) on
  // top, average detour below. Each band has its own fixed-from-zero scale.
  function drawChart() {
    const w = Math.round(chart.clientWidth * dpr);
    const h = Math.round(chart.clientHeight * dpr);
    if (!w || !h) return;
    if (chart.width !== w || chart.height !== h) {
      chart.width = w;
      chart.height = h;
    }
    cctx.clearRect(0, 0, w, h);
    const lineCol = css.getPropertyValue('--line').trim() || '#ccc';
    const muted = css.getPropertyValue('--muted').trim() || '#666';
    const gap = 8 * dpr;
    const bandH = (h - gap) / 2;
    const bands = [
      { key: 'w', top: 0, color: css.getPropertyValue('--worn').trim() || '#a4572a', label: 'trail network', max: (mx) => Math.max(1, mx) },
      { key: 'd', top: bandH + gap, color: css.getPropertyValue('--detour').trim() || '#2f7fb5', label: 'detour', max: (mx) => Math.max(0.1, Math.ceil(mx * 1.1 * 20) / 20) },
    ];
    cctx.font = `${Math.round(10.5 * dpr)}px system-ui, sans-serif`;
    cctx.textBaseline = 'top';
    for (const band of bands) {
      const base = band.top + bandH - 0.5;
      cctx.strokeStyle = lineCol;
      cctx.lineWidth = 1;
      cctx.beginPath();
      cctx.moveTo(0, base);
      cctx.lineTo(w, base);
      cctx.stroke();
      let mx = 0;
      for (const p of history) mx = Math.max(mx, p[band.key]);
      const top = band.max(mx);
      cctx.fillStyle = muted;
      cctx.textAlign = 'right';
      cctx.fillText(`${band.label} · 0–${Math.round(top * 100)}%`, w, band.top);
      if (history.length < 2) continue;
      cctx.strokeStyle = band.color;
      cctx.lineWidth = 2 * dpr;
      cctx.lineJoin = 'round';
      cctx.beginPath();
      history.forEach((p, i) => {
        const x = (i / (HISTORY - 1)) * w;
        const y = base - 1.5 * dpr - (p[band.key] / top) * (bandH - 4 * dpr);
        if (i) cctx.lineTo(x, y);
        else cctx.moveTo(x, y);
      });
      cctx.stroke();
    }
  }

  // ------------------------------------------------------------------ main loop

  function frame() {
    requestAnimationFrame(frame);
    resize();
    if (running) {
      sim.advance(stepsPerFrame);
      frameNo++;
      dirty = true;
      if (frameNo % 15 === 0) updateStats(frameNo % 30 === 0);
    }
    if (dirty) {
      render();
      dirty = false;
    }
  }

  // ------------------------------------------------------------------ pointer input

  const pointer = { down: false, id: -1, door: null, created: false, moved: false, sx: 0, sy: 0, last: null };
  let hover = null;

  function toGrid(e) {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * N, y: ((e.clientY - r.top) / r.height) * N, px: e.clientX, py: e.clientY };
  }
  function doorHitRadius() {
    const w = canvas.getBoundingClientRect().width || 1;
    return Math.max(3.5, (18 / w) * N);
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (pointer.down) return;
    e.preventDefault();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events may not be capturable */
    }
    const p = toGrid(e);
    Object.assign(pointer, { down: true, id: e.pointerId, door: null, created: false, moved: false, sx: p.px, sy: p.py, last: p });
    if (tool === 'door') {
      const hit = sim.doorAt(p.x, p.y, doorHitRadius());
      if (hit) pointer.door = hit;
      else if (sim.doors.length >= MAX_DOORS) flash(`That's ten doors, the most this lawn allows. Tap one to remove it.`);
      else {
        const d = sim.addDoor(p.x, p.y);
        if (d) {
          pointer.door = d;
          pointer.created = true;
          updateEmptyNote();
        } else flash('No room for a door there; keep it clear of hedges and water.');
      }
      canvas.classList.toggle('dragging', !!pointer.door);
    } else {
      sim.paint(p.x, p.y, BRUSH[tool], tool);
    }
    dirty = true;
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = toGrid(e);
    hover = p;
    if (!pointer.down) {
      if (tool === 'door') canvas.classList.toggle('over-door', !!sim.doorAt(p.x, p.y, doorHitRadius()));
      if (tool !== 'door') dirty = true;
      return;
    }
    if (e.pointerId !== pointer.id) return;
    if (tool === 'door') {
      if (pointer.door) {
        if (Math.hypot(p.px - pointer.sx, p.py - pointer.sy) > 5) pointer.moved = true;
        if (pointer.moved) sim.moveDoor(pointer.door.id, p.x, p.y);
      }
    } else {
      const a = pointer.last;
      sim.paintLine(a.x, a.y, p.x, p.y, BRUSH[tool], tool);
    }
    pointer.last = p;
    dirty = true;
  });

  function endPointer(e) {
    if (!pointer.down || e.pointerId !== pointer.id) return;
    if (tool === 'door' && pointer.door && !pointer.moved && !pointer.created) {
      sim.removeDoor(pointer.door.id);
      colorOf.delete(pointer.door.id);
      updateEmptyNote();
    }
    pointer.down = false;
    pointer.door = null;
    canvas.classList.remove('dragging');
    dirty = true;
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', () => {
    hover = null;
    dirty = true;
  });

  // ------------------------------------------------------------------ controls

  function setTool(t) {
    tool = t;
    for (const b of document.querySelectorAll('.tool')) b.setAttribute('aria-pressed', String(b.dataset.tool === t));
    canvas.classList.remove('over-door');
    showHint();
    dirty = true;
  }
  function showHint() {
    $('hint').textContent = HINTS[tool];
  }
  function flash(msg) {
    $('hint').textContent = msg;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(showHint, 4500);
  }
  for (const b of document.querySelectorAll('.tool')) b.addEventListener('click', () => setTool(b.dataset.tool));

  function setRunning(r) {
    running = r;
    const b = $('play');
    b.textContent = r ? 'Pause' : 'Play';
    b.setAttribute('aria-label', r ? 'Pause' : 'Play');
    $('badge').hidden = r;
    dirty = true;
  }
  $('play').addEventListener('click', () => setRunning(!running));

  for (const b of document.querySelectorAll('.speed')) {
    b.addEventListener('click', () => {
      stepsPerFrame = Number(b.dataset.steps);
      for (const o of document.querySelectorAll('.speed')) o.setAttribute('aria-pressed', String(o === b));
    });
  }
  for (const o of document.querySelectorAll('.speed')) o.setAttribute('aria-pressed', String(Number(o.dataset.steps) === stepsPerFrame));

  // Scenarios
  const scenBox = $('scenarios');
  for (const [key, sc] of Object.entries(SCENARIOS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = sc.name;
    b.dataset.key = key;
    b.addEventListener('click', () => loadPark(key));
    scenBox.appendChild(b);
  }
  function loadPark(key) {
    colorOf.clear();
    const sc = loadScenario(sim, key);
    history = [];
    $('blurb').textContent = sc.blurb;
    for (const b of scenBox.children) b.setAttribute('aria-pressed', String(b.dataset.key === key));
    updateEmptyNote();
    updateStats(false);
    drawChart();
    dirty = true;
  }
  function updateEmptyNote() {
    const n = sim.doors.length;
    const note = $('emptyNote');
    note.hidden = n >= 2;
    note.innerHTML = n === 1 ? 'One more door,<br>and people start walking.' : 'Tap the grass to add a door.<br>Two or more and people start walking.';
  }

  // Sliders. Grass memory is logarithmic: 200 .. 20,000 steps.
  const memToSlider = (T) => Math.log(T / 200) / Math.log(100);
  const sliderToMem = (v) => 200 * Math.pow(100, v);
  const sliders = {
    traffic: {
      get: () => sim.params.traffic,
      set: (v) => (sim.params.traffic = v),
      toInput: (v) => v,
      fromInput: (v) => v,
      fmt: (v) => `${Math.round(v * 100)} per 100 ticks`,
    },
    recovery: {
      get: () => sim.params.recovery,
      set: (v) => (sim.params.recovery = v),
      toInput: memToSlider,
      fromInput: sliderToMem,
      fmt: (v) => `${v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : Math.round(v)} ticks`,
    },
    pull: {
      get: () => sim.params.pull,
      set: (v) => (sim.params.pull = v),
      toInput: (v) => v,
      fromInput: (v) => v,
      fmt: (v) => (v === 0 ? 'off' : v.toFixed(1)),
    },
    sight: {
      get: () => sim.params.sight,
      set: (v) => (sim.params.sight = v),
      toInput: (v) => v,
      fromInput: (v) => v,
      fmt: (v) => `${(v / 2).toFixed(v % 2 ? 1 : 0)} m`,
    },
  };
  const outIds = { traffic: 'oTraffic', recovery: 'oRecovery', pull: 'oPull', sight: 'oSight' };
  function syncSliders() {
    for (const [key, sl] of Object.entries(sliders)) {
      $(key).value = String(sl.toInput(sl.get()));
      $(outIds[key]).textContent = sl.fmt(sl.get());
    }
  }
  for (const [key, sl] of Object.entries(sliders)) {
    $(key).addEventListener('input', (e) => {
      sl.set(sl.fromInput(Number(e.target.value)));
      $(outIds[key]).textContent = sl.fmt(sl.get());
    });
  }
  $('defaults').addEventListener('click', () => {
    for (const key of Object.keys(sliders)) sim.params[key] = DEFAULTS[key];
    syncSliders();
  });

  $('rake').addEventListener('click', () => {
    sim.resetTurf();
    sim.resetStats();
    history = [];
    updateStats(false);
    drawChart();
    flash('Fresh turf everywhere. Doors, pavement and hedges stay where they are.');
    dirty = true;
  });
  $('paveWorn').addEventListener('click', () => {
    const n = sim.paveWorn(0.3);
    flash(
      n
        ? `Paved ${n} worn patches (${Math.round(n / 4)} m²). The rest of the lawn will grow back.`
        : 'Nothing is worn enough to pave yet. Let people walk for a while first.',
    );
    updateStats(false);
    dirty = true;
  });
  $('showLines').addEventListener('change', (e) => {
    showLines = e.target.checked;
    dirty = true;
  });
  $('showWalkers').addEventListener('change', (e) => {
    showWalkers = e.target.checked;
    dirty = true;
  });

  window.addEventListener('keydown', (e) => {
    const t = e.target instanceof Element ? e.target : null;
    if (t && t.closest('input, textarea, select')) return;
    if (e.code === 'Space') {
      if (t && t.closest('button, summary')) return; // let the focused control handle it
      e.preventDefault();
      setRunning(!running);
    } else if (/^Digit[1-4]$/.test(e.code) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      setTool(TOOLS[Number(e.code.slice(5)) - 1]);
    }
  });
  window.addEventListener('resize', () => drawChart());

  // ------------------------------------------------------------------ start

  syncSliders();
  setTool('door');
  loadPark('three');
  setRunning(running);
  resize();
  requestAnimationFrame(frame);
})();
