/* Doubletake — the page: controls, time-sliced mesh generation, a small software
 * renderer (orthographic, flat-shaded, painter's sort), the proof plots, STL download. */
(function () {
  'use strict';
  const D = window.Doubletake;
  const $ = (id) => document.getElementById(id);
  const DEG = Math.PI / 180;
  const reduceMotion = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const darkScheme = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;

  // ------------------------------------------------------------------ state
  const state = {
    params: D.defaults(),
    mesh: null,       // the last finished mesh
    scene: null,      // render data derived from it
    building: false,
    buildToken: 0,
    turn: 0,          // turntable angle of the pot, radians
    elev: 45 * DEG,   // height of your eye above the table, as an elevation angle
    mirror: true,
    spin: !reduceMotion.matches,
    dwell: 1.5,       // seconds left to pause at the front or back while spinning
    tween: null,
    dirty: true,
  };

  // ------------------------------------------------------------- controls
  function shapeGlyph(shape) {
    const pts = D.shapeOutline(shape, 1, 40);
    const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(3)},${(-y).toFixed(3)}`).join('') + 'Z';
    return `<svg viewBox="-1.15 -1.15 2.3 2.3" aria-hidden="true"><path d="${d}" vector-effect="non-scaling-stroke"/></svg>`;
  }

  function buildPicker(el, key) {
    for (const s of D.SHAPES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'shape';
      b.setAttribute('role', 'radio');
      b.dataset.id = s.id;
      b.title = s.name;
      b.innerHTML = `${shapeGlyph(s)}<span>${s.name}</span>`;
      b.addEventListener('click', () => { setParam(key, s.id); });
      b.addEventListener('keydown', (e) => {
        const i = D.SHAPES.findIndex((t) => t.id === s.id);
        let j = -1;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % D.SHAPES.length;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + D.SHAPES.length) % D.SHAPES.length;
        if (j < 0) return;
        e.preventDefault();
        e.stopPropagation();
        setParam(key, D.SHAPES[j].id);
        el.children[j].focus();
      });
      el.appendChild(b);
    }
  }
  function syncPicker(el, value) {
    for (const b of el.children) {
      const on = b.dataset.id === value;
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    }
  }

  const sliders = {};
  const fmtParam = (key, v) => {
    const spec = D.PARAMS[key];
    const digits = spec.step < 1 ? 1 : 0;
    return `${Number(v).toFixed(digits)}${spec.unit === '°' ? '°' : spec.unit ? ` ${spec.unit}` : ''}`;
  };
  function buildSliders() {
    const host = $('sliders');
    for (const key of ['angle', 'width', 'height', 'wall', 'floor', 'detail']) {
      const spec = D.PARAMS[key];
      const wrap = document.createElement('div');
      wrap.className = 'slider';
      const id = `p-${key}`;
      wrap.innerHTML = `<label for="${id}"><span>${spec.label}</span><output id="${id}-out" for="${id}"></output></label>` +
        `<input type="range" id="${id}" min="${spec.min}" max="${spec.max}" step="${spec.step}" value="${state.params[key]}">`;
      host.appendChild(wrap);
      const input = wrap.querySelector('input'), out = wrap.querySelector('output');
      sliders[key] = { input, out };
      out.textContent = fmtParam(key, state.params[key]);
      input.addEventListener('input', () => setParam(key, Number(input.value)));
    }
  }

  function setParam(key, value) {
    if (state.params[key] === value) return;
    state.params[key] = value;
    if (sliders[key]) {
      sliders[key].out.textContent = fmtParam(key, value);
      if (Number(sliders[key].input.value) !== value) sliders[key].input.value = value;
    }
    if (key === 'eye') syncPicker($('pickEye'), value);
    if (key === 'mirror') syncPicker($('pickMirror'), value);
    if (key === 'angle') { state.elev = value * DEG; $('howAngle').textContent = `${value}°`; }
    $('btnDownload').disabled = true; // the shown mesh no longer matches the controls
    scheduleBuild();
  }

  // ------------------------------------------------- time-sliced generation
  let buildQueued = false;
  function scheduleBuild() {
    if (buildQueued) return;
    buildQueued = true;
    requestAnimationFrame(() => { buildQueued = false; startBuild(); });
  }
  function startBuild() {
    const params = { ...state.params };
    const token = ++state.buildToken;
    const it = D.buildSteps(params);
    state.building = true;
    $('btnDownload').disabled = true;
    const slow = setTimeout(() => { if (token === state.buildToken && state.building) $('status').textContent = 'building…'; }, 120);
    const step = () => {
      if (token !== state.buildToken) return; // superseded by a newer request
      const t0 = performance.now();
      try {
        for (;;) {
          const s = it.next();
          if (s.done) {
            clearTimeout(slow);
            state.building = false;
            $('status').textContent = '';
            useMesh(s.value);
            return;
          }
          if (performance.now() - t0 > 8) break; // hand the frame back to the browser
        }
      } catch (err) {
        clearTimeout(slow);
        state.building = false;
        $('status').textContent = `could not build: ${err.message}`;
        $('btnDownload').disabled = !state.mesh;
        return;
      }
      setTimeout(step, 0);
    };
    step();
  }

  function useMesh(mesh) {
    state.mesh = mesh;
    state.scene = prepareScene(mesh);
    $('btnDownload').disabled = false;
    updateReadouts(mesh);
    drawProofs(mesh);
    state.dirty = true;
    kick();
  }

  // --------------------------------------------------------------- readouts
  function updateReadouts(m) {
    const p = m.params;
    const rows = [
      ['Footprint', `${m.footprint.width.toFixed(1)} × ${m.footprint.depth.toFixed(1)} mm`],
      ['Rim height', `${m.rimLow.toFixed(1)} to ${m.rimHigh.toFixed(1)} mm`],
      ['Volume', `${(m.stats.volume / 1000).toFixed(1)} cm³ · ${m.massPLA.toFixed(0)} g of PLA if solid`],
      ['Thinnest wall', `${m.minWall.toFixed(3)} mm (set ${p.wall.toFixed(1)}), floor ${p.floor.toFixed(1)} mm`],
      ['Steepest overhang', `${m.worstOverhang.toFixed(1)}° from vertical, base chamfer only`],
      ['Tall ÷ narrowest', `${m.rimHigh.toFixed(1)} ÷ ${m.footprint.narrowest.toFixed(1)} mm = ${m.slenderness.toFixed(2)} (limit ${D.LIMITS.slender})`],
      ['Triangles', `${m.stats.triangles.toLocaleString('en-US')} · STL ${((84 + 50 * m.stats.triangles) / 1024).toFixed(0)} KB`],
    ];
    $('stats').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    const note = $('capNote');
    if (m.capped) {
      note.hidden = false;
      note.textContent = `Height capped at ${m.rimLow.toFixed(1)} mm (you asked for ${m.requestedHeight} mm): ` +
        `this footprint is only ${m.footprint.narrowest.toFixed(1)} mm across at its narrowest, and the pot is kept ` +
        `within ${D.LIMITS.slender}× that in height and inside a ${D.LIMITS.zMax} mm cube.`;
    } else note.hidden = true;
    $('fileInfo').textContent = `${D.fileName(p)} · ${((84 + 50 * m.stats.triangles) / 1024).toFixed(0)} KB`;
    $('capEye').textContent = `Your eye: ${m.A.name.toLowerCase()}`;
    $('capMirror').textContent = `The mirror: ${m.B.name.toLowerCase()}`;
    const err = D.illusionError(m), chord = D.chordError(m).worst;
    $('verdict').innerHTML = `All <b>${m.ring.length}</b> rim vertices land on both shapes, to within <b>${err < 1e-12 ? '10⁻¹² mm' : `${err.toExponential(1)} mm`}</b> (floating-point rounding). ` +
      `Between vertices the rim is a straight edge, which strays from the shapes by at most <b>${chord < 0.01 ? chord.toFixed(4) : chord.toFixed(3)} mm</b>, ` +
      `${chord < 0.1 ? 'far below' : 'below'} the 0.4 mm width of a printed line. Printing in 0.2 mm layers steps the rim's top to the layer grid, ` +
      `which moves the outline by up to about ${(0.1 * Math.cos(p.angle * DEG)).toFixed(2)} mm.`;
    $('view').setAttribute('aria-label', `A pot that looks like a ${m.A.name.toLowerCase()} from the front at ${p.angle}° and like a ${m.B.name.toLowerCase()} in the mirror behind it. Drag sideways to turn the pot, up and down to move your eye.`);
  }

  // ------------------------------------------------------------ the proof
  function cssColor(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  function fitCanvas(cv, cap) {
    const dpr = Math.min(cap || 2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(cv.clientWidth * dpr)), h = Math.max(1, Math.round(cv.clientHeight * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    return dpr;
  }

  function drawProofs(m) {
    const p = m.params, R = m.R, s = Math.sin(p.angle * DEG), c = Math.cos(p.angle * DEG);
    const half = R * 1.12;
    const target = cssColor('--target'), trace = cssColor('--trace'), accent = cssColor('--accent');
    for (const [id, shape, which] of [['proofEye', m.A, 'eye'], ['proofMirror', m.B, 'mirror']]) {
      const cv = $(id);
      const dpr = fitCanvas(cv);
      const ctx = cv.getContext('2d');
      const W = cv.width, H = cv.height, k = Math.min(W, H) / (2 * half);
      const X = (x) => W / 2 + x * k, Y = (y) => H / 2 - y * k;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = target;
      ctx.beginPath();
      D.shapeOutline(shape, R, 160).forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = trace;
      ctx.lineWidth = 1.2 * dpr;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      m.ring.forEach((q, i) => {
        const zz = q.z - m.zShift;
        const h = which === 'eye' ? zz * c - q.y * s : zz * c + q.y * s;
        if (i) ctx.lineTo(X(q.x), Y(h)); else ctx.moveTo(X(q.x), Y(h));
      });
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = accent;
      for (const q of m.ring) {
        if (!q.corner) continue;
        const zz = q.z - m.zShift;
        const h = which === 'eye' ? zz * c - q.y * s : zz * c + q.y * s;
        ctx.beginPath(); ctx.arc(X(q.x), Y(h), 2.2 * dpr, 0, 2 * Math.PI); ctx.fill();
      }
    }
  }

  // ------------------------------------------------------------ the scene
  function prepareScene(m) {
    const P = m.positions, T = m.triangles;
    const nT0 = T.length / 3;
    const yc = (m.bbox.y[0] + m.bbox.y[1]) / 2;
    const zTop = m.rimHigh;
    // Render polygons. The walls are re-cut into horizontal strips (for drawing only; the
    // STL is untouched): a wall triangle runs the full height of the pot, so its centroid
    // is a poor sort key, and the painter's algorithm would let far walls poke through near
    // ones. Every other triangle is drawn as it is.
    const K = Math.max(2, Math.min(8, Math.ceil(zTop / 14)));
    const verts = [];
    for (let i = 0; i < P.length; i += 3) verts.push(P[i], P[i + 1] - yc, P[i + 2]);
    const addV = (x, y, z) => { verts.push(x, y, z); return verts.length / 3 - 1; };
    const column = (lo, hi) => lo.map((b, k) => {
      const t = hi[k], col = [b];
      for (let j = 1; j < K; j++) {
        const f = j / K;
        col.push(addV(P[3 * b] + f * (P[3 * t] - P[3 * b]), P[3 * b + 1] - yc + f * (P[3 * t + 1] - P[3 * b + 1]), P[3 * b + 2] + f * (P[3 * t + 2] - P[3 * b + 2])));
      }
      col.push(t);
      return col;
    });
    const polys = [], groups = [];
    const outerCols = column(m.index.chamfer, m.index.rim), innerCols = column(m.index.floor, m.index.rimInner);
    for (const [cols, flip] of [[outerCols, false], [innerCols, true]]) {
      const n = cols.length;
      for (let k = 0; k < n; k++) {
        const a = cols[k], b = cols[(k + 1) % n];
        for (let j = 0; j < K; j++) {
          polys.push(flip ? [a[j], a[j + 1], b[j + 1], b[j]] : [a[j], b[j], b[j + 1], a[j + 1]]);
          groups.push(0);
        }
      }
    }
    const nV0 = P.length / 3, tag = new Uint8Array(nV0);
    for (const i of m.index.chamfer) tag[i] = 1;
    for (const i of m.index.rim) tag[i] = 2;
    for (const i of m.index.floor) tag[i] = 4;
    for (const i of m.index.rimInner) tag[i] = 8;
    for (let t = 0; t < nT0; t++) {
      const tri = [T[3 * t], T[3 * t + 1], T[3 * t + 2]];
      let mask = 0;
      for (const i of tri) mask |= tag[i];
      if (mask === 3 || mask === 12) continue; // a wall triangle: replaced by the strips above
      polys.push(tri);
      groups.push(mask === 10 ? 1 : 0); // rim band (outer rim + inner rim vertices only)
    }
    const V = Float32Array.from(verts);
    const nV = V.length / 3, nP = polys.length;
    let rmax = 0;
    for (let i = 0; i < nV; i++) rmax = Math.max(rmax, Math.hypot(V[3 * i], V[3 * i + 1]));
    const I = new Int32Array(nP * 4).fill(-1);
    const N = new Float32Array(nP * 3), C = new Float32Array(nP * 3), G = Uint8Array.from(groups);
    for (let q = 0; q < nP; q++) {
      const pl = polys[q];
      for (let k = 0; k < pl.length; k++) I[4 * q + k] = pl[k];
      const a = 3 * pl[0], b = 3 * pl[1], c = 3 * pl[2];
      const ux = V[b] - V[a], uy = V[b + 1] - V[a + 1], uz = V[b + 2] - V[a + 2];
      const vx = V[c] - V[a], vy = V[c + 1] - V[a + 1], vz = V[c + 2] - V[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      N[3 * q] = nx / l; N[3 * q + 1] = ny / l; N[3 * q + 2] = nz / l;
      let cx = 0, cy = 0, cz = 0;
      for (const v of pl) { cx += V[3 * v]; cy += V[3 * v + 1]; cz += V[3 * v + 2]; }
      C[3 * q] = cx / pl.length; C[3 * q + 1] = cy / pl.length; C[3 * q + 2] = cz / pl.length;
    }
    // Mirror plane behind the pot: clear of it at any turn, and far enough back that, from
    // the design view, the reflection sits just above the pot instead of overlapping it.
    const e = m.params.angle * DEG, se = Math.sin(e), ce = Math.cos(e);
    let realTop = -Infinity, reflLow = Infinity;
    for (let i = 0; i < nV0; i++) {
      realTop = Math.max(realTop, -V[3 * i + 1] * se + V[3 * i + 2] * ce);
      reflLow = Math.min(reflLow, V[3 * i + 1] * se + V[3 * i + 2] * ce);
    }
    const ym = Math.min(-rmax - 0.12 * rmax - 4, (reflLow - realTop - 0.06 * rmax) / (2 * se));
    const zMirror = zTop + (rmax - ym) * Math.tan(e) + 6;
    return {
      V, I, N, C, G, nV, nP, rmax, ym, zTop, zMirror, halfW: rmax * 1.2 + 8,
      SX: new Float32Array(nV), SY: new Float32Array(nV), RY: new Float32Array(nV),
      order: new Uint32Array(nP), depth: new Float64Array(nP), shade: new Uint8Array(nP),
    };
  }

  let palette = null;
  function readPalette() {
    const rgb = (hex) => {
      const h = hex.replace('#', '');
      const f = h.length === 3 ? h.split('').map((ch) => ch + ch).join('') : h.slice(0, 6);
      return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16));
    };
    palette = {
      sky: cssColor('--sky'), table: cssColor('--table'), glass: cssColor('--glass'), frame: cssColor('--frame'),
      pot: rgb(cssColor('--pot')), rim: rgb(cssColor('--rim')), tableRGB: rgb(cssColor('--table')), glassRGB: rgb(cssColor('--glass')),
      cache: new Map(),
    };
  }
  function fillFor(group, level, reflected) {
    const key = group * 1000 + level * 2 + (reflected ? 1 : 0);
    let s = palette.cache.get(key);
    if (!s) {
      const base = group ? palette.rim : palette.pot;
      const k = 0.3 + 0.7 * (level / 63);
      let rgb = base.map((v) => v * k);
      if (reflected) rgb = rgb.map((v, i) => 0.8 * v + 0.2 * palette.glassRGB[i]);
      s = `rgb(${rgb.map((v) => Math.round(Math.min(255, v))).join(',')})`;
      palette.cache.set(key, s);
    }
    return s;
  }

  const view = $('view');
  const ctx = view.getContext('2d');
  const LIGHT = (() => { const l = [0.45, 0.55, 0.7]; const n = Math.hypot(...l); return l.map((v) => v / n); })();

  // Render resolution adapts to how long frames take (software canvases on phones can be
  // slow at 3× pixel density): between 1 and 2 canvas pixels per CSS pixel.
  // Each polygon is also stroked in its own colour to hide anti-aliasing seams; that
  // doubles the cost, so while the view is moving on a slow device the strokes are left
  // out, and the frame drawn when it comes to rest always has them.
  let renderScale = 2, slowFrames = 0, fastFrames = 0, lastMs = 0, moving = false, lastStroked = true;
  function draw() {
    const t0 = performance.now();
    lastStroked = !moving || lastMs < 14;
    drawScene(lastStroked);
    const ms = performance.now() - t0;
    lastMs = ms;
    if (ms > 28) { fastFrames = 0; if (++slowFrames >= 2 && renderScale > 1) { renderScale = Math.max(1, renderScale - 0.25); slowFrames = 0; state.dirty = true; } }
    else if (ms < 8) { slowFrames = 0; if (++fastFrames >= 30 && renderScale < 2) { renderScale = Math.min(2, renderScale + 0.25); fastFrames = 0; } }
    else { slowFrames = 0; fastFrames = 0; }
  }
  function drawScene(seams) {
    const sc = state.scene;
    const dpr = fitCanvas(view, renderScale);
    const W = view.width, H = view.height;
    if (!palette) readPalette();
    ctx.fillStyle = palette.sky;
    ctx.fillRect(0, 0, W, H);
    if (!sc) return;
    const ce = Math.cos(state.elev), se = Math.sin(state.elev);
    const ct = Math.cos(state.turn), st = Math.sin(state.turn);
    // Orthographic camera on the +y side looking toward −y from elevation e.
    // screen right = −x, screen up = (0, −sin e, cos e), depth along (0, −cos e, −sin e).
    const sxOf = (x) => -x, syOf = (y, z) => -y * se + z * ce, dOf = (y, z) => -y * ce - z * se;

    // Frame the pot (any turn) and, with the mirror, its reflection.
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const grow = (x, y, z) => { const a = sxOf(x), b = syOf(y, z); x0 = Math.min(x0, a); x1 = Math.max(x1, a); y0 = Math.min(y0, b); y1 = Math.max(y1, b); };
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * 2 * Math.PI, x = sc.rmax * Math.cos(a), y = sc.rmax * Math.sin(a);
      for (const z of [0, sc.zTop]) {
        grow(x, y, z);
        if (state.mirror) grow(x, 2 * sc.ym - y, Math.min(z, sc.zMirror));
      }
    }
    const top = 34 * dpr, bottom = 54 * dpr, side = 14 * dpr;
    const scale = Math.min((W - 2 * side) / (x1 - x0), (H - top - bottom) / (y1 - y0));
    const ox = side + ((W - 2 * side) - (x1 - x0) * scale) / 2 - x0 * scale;
    const oy = top + ((H - top - bottom) - (y1 - y0) * scale) / 2 + y1 * scale;
    const X = (x) => ox + sxOf(x) * scale, Y = (y, z) => oy - syOf(y, z) * scale;

    const { V, I, N, C, G, nV, nP, SX, SY, RY, order, depth, shade } = sc;
    for (let i = 0; i < nV; i++) {
      const x = V[3 * i], y = V[3 * i + 1], z = V[3 * i + 2];
      const xr = x * ct - y * st, yr = x * st + y * ct;
      SX[i] = X(xr); SY[i] = Y(yr, z);
      RY[i] = Y(2 * sc.ym - yr, z);
    }
    for (let t = 0; t < nP; t++) {
      const nx = N[3 * t], ny = N[3 * t + 1], nz = N[3 * t + 2];
      const nxr = nx * ct - ny * st, nyr = nx * st + ny * ct;
      const lam = Math.max(0, nxr * LIGHT[0] + nyr * LIGHT[1] + nz * LIGHT[2]);
      shade[t] = Math.round(63 * Math.min(1, 0.15 + 0.85 * lam));
    }

    const hw = sc.halfW, front = sc.rmax + 6;
    const poly = (pts) => { ctx.beginPath(); pts.forEach(([a, b], i) => (i ? ctx.lineTo(a, b) : ctx.moveTo(a, b))); ctx.closePath(); };
    // the table
    ctx.fillStyle = palette.table;
    poly([[X(-hw), Y(sc.ym, 0)], [X(hw), Y(sc.ym, 0)], [X(hw), Y(front + 400, 0)], [X(-hw), Y(front + 400, 0)]]);
    ctx.fill();

    const drawTris = (reflected) => {
      let n = 0;
      for (let t = 0; t < nP; t++) {
        const nx = N[3 * t], ny = N[3 * t + 1], nz = N[3 * t + 2];
        let nyr = nx * st + ny * ct;
        if (reflected) nyr = -nyr;
        if (nyr * ce + nz * se <= 0) continue; // facing away (closed mesh: back-face cull)
        const cx = C[3 * t], cy = C[3 * t + 1], cz = C[3 * t + 2];
        let yr = cx * st + cy * ct;
        if (reflected) yr = 2 * sc.ym - yr;
        depth[t] = dOf(yr, cz);
        order[n++] = t;
      }
      const ord = Array.from(order.subarray(0, n)).sort((a, b) => depth[b] - depth[a]);
      const YS = reflected ? RY : SY;
      ctx.lineJoin = 'bevel';
      ctx.lineWidth = 1;
      for (const t of ord) {
        const a = I[4 * t], b = I[4 * t + 1], c = I[4 * t + 2], d = I[4 * t + 3];
        const col = fillFor(G[t], shade[t], reflected);
        ctx.fillStyle = col; ctx.strokeStyle = col;
        ctx.beginPath();
        ctx.moveTo(SX[a], YS[a]); ctx.lineTo(SX[b], YS[b]); ctx.lineTo(SX[c], YS[c]);
        if (d >= 0) ctx.lineTo(SX[d], YS[d]);
        ctx.closePath();
        ctx.fill();
        if (seams) ctx.stroke();
      }
    };

    if (state.mirror) {
      const quad = [[X(-hw), Y(sc.ym, 0)], [X(hw), Y(sc.ym, 0)], [X(hw), Y(sc.ym, sc.zMirror)], [X(-hw), Y(sc.ym, sc.zMirror)]];
      ctx.save();
      poly(quad);
      ctx.fillStyle = palette.glass;
      ctx.fill();
      ctx.clip();
      // the table, seen in the mirror
      ctx.fillStyle = `rgb(${palette.tableRGB.map((v, i) => Math.round(0.8 * v + 0.2 * palette.glassRGB[i])).join(',')})`;
      poly([[X(-hw), Y(sc.ym, 0)], [X(hw), Y(sc.ym, 0)], [X(hw), Y(2 * sc.ym - front - 400, 0)], [X(-hw), Y(2 * sc.ym - front - 400, 0)]]);
      ctx.fill();
      drawTris(true);
      ctx.restore();
      poly(quad);
      ctx.strokeStyle = palette.frame;
      ctx.lineWidth = 2 * dpr;
      ctx.stroke();
    }
    drawTris(false);
  }

  // ---------------------------------------------------- animation and input
  let rafId = 0, lastT = 0;
  function kick() { if (!rafId) { lastT = performance.now(); rafId = requestAnimationFrame(frame); } }
  function frame(now) {
    rafId = 0;
    const dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    let active = false;
    if (state.tween) {
      const tw = state.tween;
      const u = Math.min(1, (now - tw.t0) / tw.dur);
      const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
      state.turn = tw.turn0 + (tw.turn1 - tw.turn0) * e;
      state.elev = tw.elev0 + (tw.elev1 - tw.elev0) * e;
      if (u >= 1) state.tween = null;
      state.dirty = true;
      active = true;
    } else if (state.spin) {
      if (state.dwell > 0) state.dwell -= dt;
      else {
        const before = Math.floor(state.turn / Math.PI);
        state.turn += 0.55 * dt;
        if (Math.floor(state.turn / Math.PI) !== before) { state.turn = Math.floor(state.turn / Math.PI) * Math.PI; state.dwell = 2.4; }
        state.dirty = true;
      }
      active = true;
    }
    moving = !!state.tween || (state.spin && state.dwell <= 0) || !!drag; // a dwell is a rest
    if (state.dirty) {
      state.dirty = false;
      draw();
      updateHud();
    }
    if (!moving && !lastStroked) { state.dirty = true; active = true; } // come to rest with seams hidden
    if (active) kick();
  }
  function updateHud() {
    let t = ((state.turn / DEG) % 360 + 360) % 360;
    if (t > 180) t -= 360;
    $('hudAngle').textContent = `eye ${(state.elev / DEG).toFixed(0)}° · pot ${t.toFixed(0)}°`;
  }
  function redraw() { state.dirty = true; kick(); }

  function setSpin(on) {
    state.spin = on;
    $('btnSpin').setAttribute('aria-pressed', on ? 'true' : 'false');
    if (on) state.dwell = 0.6;
    redraw();
  }
  function goTo(turn, elev) {
    if (reduceMotion.matches) { state.turn = turn; state.elev = elev; state.tween = null; redraw(); return; }
    state.tween = { t0: performance.now(), dur: 750, turn0: state.turn, turn1: turn, elev0: state.elev, elev1: elev };
    kick();
  }
  function designView() {
    setSpin(false);
    const k = Math.round(state.turn / (2 * Math.PI)) * 2 * Math.PI;
    goTo(k, state.params.angle * DEG);
  }
  function turnAround() {
    setSpin(false);
    const k = Math.round(state.turn / Math.PI) * Math.PI;
    goTo(k + Math.PI, state.elev);
  }

  let drag = null;
  view.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
    try { view.setPointerCapture(e.pointerId); } catch (_) { /* not capturable */ }
    if (state.spin) setSpin(false);
    state.tween = null;
  });
  view.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    state.turn -= dx * 0.011;
    state.elev = Math.min(88 * DEG, Math.max(2 * DEG, state.elev - dy * 0.006));
    redraw();
  });
  const endDrag = (e) => { if (drag && e.pointerId === drag.id) drag = null; };
  view.addEventListener('pointerup', endDrag);
  view.addEventListener('pointercancel', endDrag);

  view.addEventListener('keydown', (e) => {
    let used = true;
    if (e.key === 'ArrowLeft') state.turn += 10 * DEG;
    else if (e.key === 'ArrowRight') state.turn -= 10 * DEG;
    else if (e.key === 'ArrowUp') state.elev = Math.min(88 * DEG, state.elev + 2 * DEG);
    else if (e.key === 'ArrowDown') state.elev = Math.max(2 * DEG, state.elev - 2 * DEG);
    else used = false;
    if (used) { e.preventDefault(); if (state.spin) setSpin(false); state.tween = null; redraw(); }
  });
  document.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    if (/INPUT|TEXTAREA|SELECT/.test(tag) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '0' || e.key === 'Home') designView();
    else if (e.key === 't' || e.key === 'T') turnAround();
    else if (e.key === 's' || e.key === 'S') setSpin(!state.spin);
    else if (e.key === 'm' || e.key === 'M') toggleMirror();
  });

  function toggleMirror() {
    state.mirror = !state.mirror;
    $('btnMirror').setAttribute('aria-pressed', state.mirror ? 'true' : 'false');
    redraw();
  }
  $('btnDesign').addEventListener('click', designView);
  $('btnTurn').addEventListener('click', turnAround);
  $('btnSpin').addEventListener('click', () => setSpin(!state.spin));
  $('btnMirror').addEventListener('click', toggleMirror);

  // ------------------------------------------------------------- download
  $('btnDownload').addEventListener('click', () => {
    const m = state.mesh;
    if (!m || state.building) return;
    const p = m.params;
    const label = `Doubletake: ${p.eye} to the eye, ${p.mirror} in the mirror, ${p.angle} deg`;
    const blob = new Blob([D.toSTL(m, label)], { type: 'model/stl' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = D.fileName(p);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  });

  // ---------------------------------------------------------------- boot
  buildPicker($('pickEye'), 'eye');
  buildPicker($('pickMirror'), 'mirror');
  syncPicker($('pickEye'), state.params.eye);
  syncPicker($('pickMirror'), state.params.mirror);
  buildSliders();
  $('btnSpin').setAttribute('aria-pressed', state.spin ? 'true' : 'false');
  const onTheme = () => { readPalette(); if (state.mesh) drawProofs(state.mesh); redraw(); };
  if (darkScheme && darkScheme.addEventListener) darkScheme.addEventListener('change', onTheme);
  if (reduceMotion.addEventListener) reduceMotion.addEventListener('change', () => { if (reduceMotion.matches) setSpin(false); });
  if (window.ResizeObserver) new ResizeObserver(() => { redraw(); if (state.mesh) drawProofs(state.mesh); }).observe($('stage'));
  window.addEventListener('resize', () => { redraw(); if (state.mesh) drawProofs(state.mesh); });
  startBuild();
})();
