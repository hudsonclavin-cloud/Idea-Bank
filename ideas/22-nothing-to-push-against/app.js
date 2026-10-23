/* app.js — the cockpit: star field, gauges, ledger, input. All physics lives in attitude.js. */
(function () {
  'use strict';
  const A = window.Attitude;
  const DEG = Math.PI / 180;
  const $ = (id) => document.getElementById(id);
  // ---------- world (inertial directions; all invented) ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const norm = (v) => { const n = Math.hypot(v[0], v[1], v[2]); return [v[0] / n, v[1] / n, v[2] / n]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  const STAR_COLORS = ['#dfe8ff', '#ffffff', '#fff1d6', '#ffd9b0'];
  function makeStars() {
    const rnd = mulberry32(220921);
    const out = [];
    const bandPole = norm([0.35, 0.78, 0.52]);
    const bandA = norm(cross(bandPole, [1, 0, 0]));
    const bandB = cross(bandPole, bandA);
    const push = (d, mag, col) => out.push({ d, size: 0.6 + 1.6 * mag, alpha: 0.35 + 0.65 * mag, col });
    for (let i = 0; i < 4200; i++) {
      const z = 2 * rnd() - 1, ph = 2 * Math.PI * rnd(), r = Math.sqrt(1 - z * z);
      const m = Math.pow(rnd(), 2.2);
      push([r * Math.cos(ph), r * Math.sin(ph), z], m, STAR_COLORS[Math.floor(rnd() * 4)]);
    }
    // a soft band of faint stars along one great circle (the galaxy, loosely)
    for (let i = 0; i < 3000; i++) {
      const ph = 2 * Math.PI * rnd();
      const lat = (rnd() + rnd() + rnd() - 1.5) * 0.16; // ~gaussian, σ ≈ 7°
      const c = Math.cos(lat), sn = Math.sin(lat);
      const d = [
        c * (Math.cos(ph) * bandA[0] + Math.sin(ph) * bandB[0]) + sn * bandPole[0],
        c * (Math.cos(ph) * bandA[1] + Math.sin(ph) * bandB[1]) + sn * bandPole[1],
        c * (Math.cos(ph) * bandA[2] + Math.sin(ph) * bandB[2]) + sn * bandPole[2],
      ];
      push(d, 0.08 + Math.pow(rnd(), 3) * 0.45, STAR_COLORS[Math.floor(rnd() * 4)]);
    }
    // bucket by brightness so drawing needs few style changes
    out.sort((a, b) => a.alpha - b.alpha);
    return out;
  }
  const STARS = makeStars();
  const GUIDES = [
    { name: 'Lantern', d: norm([0.21, 0.10, 1]), col: '#8eeaff' },
    { name: 'Kestrel', d: norm([-0.42, 0.22, 1]), col: '#ffd58a' },
    { name: 'Anvil', d: norm([0.75, -0.45, 0.65]), col: '#ff9f8a' },
    { name: 'Tern', d: norm([-0.95, -0.2, 0.35]), col: '#b8ffb0' },
    { name: 'Beacon', d: norm([0.1, 0.9, -0.45]), col: '#e2c4ff' },
    { name: 'Sable', d: norm([-0.3, -0.8, -0.55]), col: '#ffe6a8' },
  ];
  const SUN = norm([0, 0.6, 0.8]); // 37° above the starting line of sight
  // sunlight pushes along SUN; an off-centre push twists about an axis ⊥ SUN. Taken along inertial x,
  // which is the pitch wheel's axis at the start, so the quoted fill time is exact until you turn.
  const TORQUE_DIR = [1, 0, 0];
  const BOX = [0.25, 0.35, 0.5]; // half-sizes (m) of the drawn body: 0.5 × 0.7 × 1.0 m box

  // ---------- simulation ----------
  const P = A.makeParams();
  let S = A.makeState(P);
  const clock = A.makeClock();
  let rate = 10, paused = false, lastT = 0;
  let distMicro = 10;
  function setDisturbance(micro) {
    distMicro = micro;
    const t = micro * 1e-6;
    P.tauDist[0] = TORQUE_DIR[0] * t; P.tauDist[1] = TORQUE_DIR[1] * t; P.tauDist[2] = TORQUE_DIR[2] * t;
  }
  setDisturbance(distMicro);

  // ---------- DOM ----------
  const canvas = $('sky');
  const ctx = canvas.getContext('2d');
  const hudMode = $('hudMode'), hudTime = $('hudTime'), hudTarget = $('hudTarget'), hudRate = $('hudRate'), hudHint = $('hudHint');
  const badgeFull = $('badgeFull'), badgeThr = $('badgeThr'), toastEl = $('toast');
  const wheels = [0, 1, 2].map((i) => {
    const el = $('wheel' + i);
    return { el, fill: el.querySelector('.fill'), val: el.querySelector('.wv') };
  });
  let W = 0, Hh = 0, dpr = 1;
  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, Math.round(r.width)); Hh = Math.max(1, Math.round(r.height));
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(Hh * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();
  const focal = () => W / (2 * Math.tan(35 * DEG)); // 70° horizontal field of view

  // ---------- tries ----------
  const TRIES = [
    ['Borrow a spin', 'drag the sky; a wheel takes the opposite momentum and keeps it'],
    ['Fill a wheel', 'let the sunlight torque fill a wheel (600× helps) and watch the hold fail'],
    ['Pay to empty it', 'fire the thrusters and watch the ledger balance to round-off'],
    ['Move the load', 'with momentum stored in one wheel, turn 90° and watch it move to another wheel'],
    ['See the flip', 'tumble about the middle axis and wait: the sky turns over by itself'],
    ['Catch a tumble', 'bring a tumble to rest; the wheels alone can\'t'],
    ['Visit all six guide stars', 'hold each within 1° for two seconds'],
  ];
  const LS_KEY = 'ntpa.tries.v1';
  let done = TRIES.map(() => false);
  try { const v = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); if (Array.isArray(v) && v.length === TRIES.length) done = v.map(Boolean); } catch (_) { /* storage may be unavailable */ }
  const missionList = $('missionList');
  function renderTries() {
    missionList.innerHTML = '';
    TRIES.forEach(([t, d], i) => {
      const li = document.createElement('li');
      li.className = done[i] ? 'done' : '';
      li.innerHTML = `<b>${t}</b> — ${d}`;
      missionList.appendChild(li);
    });
    $('mScore').textContent = `${done.filter(Boolean).length}/${TRIES.length}`;
  }
  function complete(i, msg) {
    if (done[i]) return;
    done[i] = true;
    try { localStorage.setItem(LS_KEY, JSON.stringify(done)); } catch (_) { /* ignore */ }
    renderTries();
    toast('✓ ' + TRIES[i][0] + (msg ? ' — ' + msg : ''));
  }
  $('resetMissions').addEventListener('click', () => {
    done = TRIES.map(() => false);
    try { localStorage.removeItem(LS_KEY); } catch (_) { /* ignore */ }
    renderTries();
  });
  renderTries();
  let toastTimer = 0;
  function toast(msg, ms) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, ms || 3200);
  }

  // per-try bookkeeping
  const tr = { dragging: false, loadDir: null, loadQ: null, tumbleAxis: -1, prevWy: 0, desatWas: false, propAtDesat: 0, held: GUIDES.map(() => 0), visited: GUIDES.map(() => false) };
  const M = new Float64Array(9), V1 = [0, 0, 0], V2 = [0, 0, 0];
  function checkTries(simDt) {
    const w = A.omega(S, P, V1);
    const wmag = Math.hypot(w[0], w[1], w[2]);
    const hmax = Math.max(Math.abs(S.h[0]), Math.abs(S.h[1]), Math.abs(S.h[2]));
    const hmag = Math.hypot(S.h[0], S.h[1], S.h[2]);
    if (tr.dragging && hmax >= 0.15 * P.hMax && wmag > 0.005) complete(0, 'the sky is heavy because a wheel is carrying your turn');
    if (S.ctrl.mode === 'hold' && !S.ctrl.desat && (S.sat[0] || S.sat[1] || S.sat[2])) complete(1, 'the autopilot has nothing left to give');
    if (tr.desatWas && !S.ctrl.desat) {
      if (S.propUsed > tr.propAtDesat && hmax < 0.05 * P.hMax) complete(2, `${((S.propUsed - tr.propAtDesat) * 1e3).toFixed(2)} g of gas, and the books still balance`);
    }
    tr.desatWas = S.ctrl.desat;
    if (S.ctrl.desat && !tr.desatWasPrev) tr.propAtDesat = S.propUsed;
    tr.desatWasPrev = S.ctrl.desat;
    if (hmag >= 0.25 * P.hMax) {
      const u = [S.h[0] / hmag, S.h[1] / hmag, S.h[2] / hmag];
      if (!tr.loadDir) { tr.loadDir = u; tr.loadQ = S.q.slice(); }
      else {
        const ang = Math.acos(Math.max(-1, Math.min(1, dot(u, tr.loadDir))));
        const e = A.errorVector(tr.loadQ, S.q, V2);
        if (ang > 60 * DEG && Math.hypot(e[0], e[1], e[2]) > 45 * DEG) complete(3, 'the momentum stayed put in the sky; the spacecraft turned underneath it');
      }
    } else tr.loadDir = null;
    if (tr.tumbleAxis === 1 && S.ctrl.mode === 'raw') {
      if (tr.prevWy !== 0 && Math.sign(w[1]) !== 0 && Math.sign(w[1]) !== Math.sign(tr.prevWy)) complete(4, 'no torque did that: a spin about the middle axis cannot stay put');
      tr.prevWy = w[1];
    }
    if (tr.tumbleAxis >= 0 && S.ctrl.mode === 'hold' && wmag < 0.1 * DEG && !S.ctrl.desat) { complete(5, 'the wheels took what they could; the thrusters took the rest'); tr.tumbleAxis = -1; }
    // guide-star tour
    A.qToMat(S.q, M);
    const b = [M[2], M[5], M[8]]; // boresight (body z) in inertial axes
    for (let i = 0; i < GUIDES.length; i++) {
      const ang = Math.acos(Math.max(-1, Math.min(1, dot(b, GUIDES[i].d))));
      if (ang < 1 * DEG) { tr.held[i] += simDt; if (tr.held[i] >= 2 && !tr.visited[i]) { tr.visited[i] = true; if (tr.visited.every(Boolean)) complete(6); else toast(`${GUIDES[i].name} held · ${tr.visited.filter(Boolean).length}/6`); } }
      else tr.held[i] = 0;
    }
  }

  // ---------- drawing ----------
  const insetSize = () => (W < 600 ? 112 : 150);
  const CAM_E = norm([1.2, 0.9, -1.6]); // where the outside camera sits (unit vector toward it)
  const CAM_R = norm(cross([0, 1, 0], CAM_E));
  const CAM_U = cross(CAM_E, CAM_R);
  const BOX_VERTS = [];
  for (let i = 0; i < 8; i++) BOX_VERTS.push([(i & 1 ? 1 : -1) * BOX[0], (i & 2 ? 1 : -1) * BOX[1], (i & 4 ? 1 : -1) * BOX[2]]);
  const BOX_EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  let joystick = null; // raw-mode drag origin/current for the overlay
  const proj = [0, 0, 0];

  function drawSky() {
    ctx.fillStyle = '#060913';
    ctx.fillRect(0, 0, W, Hh);
    const f = focal(), cx = W / 2, cy = Hh / 2;
    A.qToMat(S.q, M);
    // stars: inertial d → body d_b = Rᵀ d; pinhole along body z
    let lastStyle = '';
    for (let i = 0; i < STARS.length; i++) {
      const st = STARS[i], d = st.d;
      const z = M[2] * d[0] + M[5] * d[1] + M[8] * d[2];
      if (z < 0.2) continue;
      const x = M[0] * d[0] + M[3] * d[1] + M[6] * d[2];
      const y = M[1] * d[0] + M[4] * d[1] + M[7] * d[2];
      const sx = cx + (f * x) / z, sy = cy - (f * y) / z;
      if (sx < -2 || sx > W + 2 || sy < -2 || sy > Hh + 2) continue;
      const style = st.col + Math.round(st.alpha * 255).toString(16).padStart(2, '0');
      if (style !== lastStyle) { ctx.fillStyle = style; lastStyle = style; }
      if (st.size < 1.2) ctx.fillRect(sx - 0.6, sy - 0.6, 1.2, 1.2);
      else { ctx.beginPath(); ctx.arc(sx, sy, st.size * 0.8, 0, 6.2832); ctx.fill(); }
    }
    // the sun
    if (projectDir(SUN, f, cx, cy, proj)) {
      const g = ctx.createRadialGradient(proj[0], proj[1], 2, proj[0], proj[1], 70);
      g.addColorStop(0, 'rgba(255,245,210,0.95)'); g.addColorStop(0.15, 'rgba(255,225,150,0.45)'); g.addColorStop(1, 'rgba(255,200,100,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(proj[0], proj[1], 70, 0, 6.2832); ctx.fill();
      ctx.fillStyle = '#fff8e0'; ctx.beginPath(); ctx.arc(proj[0], proj[1], 9, 0, 6.2832); ctx.fill();
    }
    // guide stars
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (let i = 0; i < GUIDES.length; i++) {
      const gs = GUIDES[i];
      if (!projectDir(gs.d, f, cx, cy, proj)) continue;
      ctx.fillStyle = gs.col; ctx.beginPath(); ctx.arc(proj[0], proj[1], 2.6, 0, 6.2832); ctx.fill();
      ctx.strokeStyle = gs.col; ctx.globalAlpha = tr.visited[i] ? 0.9 : 0.5; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(proj[0], proj[1], 9, 0, 6.2832); ctx.stroke();
      ctx.globalAlpha = 0.85;
      ctx.fillText((tr.visited[i] ? '✓ ' : '') + gs.name, proj[0] + 13, proj[1]);
      ctx.globalAlpha = 1;
    }
    // reticle
    const err = nearestGuide();
    ctx.strokeStyle = err && err.ang < 1 * DEG ? '#8be3a8' : 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 18, cy); ctx.lineTo(cx - 6, cy); ctx.moveTo(cx + 6, cy); ctx.lineTo(cx + 18, cy);
    ctx.moveTo(cx, cy - 18); ctx.lineTo(cx, cy - 6); ctx.moveTo(cx, cy + 6); ctx.lineTo(cx, cy + 18);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, f * Math.tan(1 * DEG), 0, 6.2832); ctx.stroke(); // the 1° circle
    // raw-mode joystick
    if (joystick) {
      ctx.strokeStyle = 'rgba(142,234,255,0.8)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(joystick.x0, joystick.y0); ctx.lineTo(joystick.x, joystick.y); ctx.stroke();
      ctx.beginPath(); ctx.arc(joystick.x0, joystick.y0, 80, 0, 6.2832); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(142,234,255,0.3)'; ctx.stroke();
    }
    drawInset();
  }
  function projectDir(d, f, cx, cy, out) {
    const z = M[2] * d[0] + M[5] * d[1] + M[8] * d[2];
    if (z < 0.15) return false;
    const x = M[0] * d[0] + M[3] * d[1] + M[6] * d[2];
    const y = M[1] * d[0] + M[4] * d[1] + M[7] * d[2];
    out[0] = cx + (f * x) / z; out[1] = cy - (f * y) / z;
    return out[0] > -40 && out[0] < W + 40 && out[1] > -40 && out[1] < Hh + 40;
  }
  function nearestGuide() {
    const b = [M[2], M[5], M[8]];
    let best = null;
    for (const g of GUIDES) {
      const ang = Math.acos(Math.max(-1, Math.min(1, dot(b, g.d))));
      if (!best || ang < best.ang) best = { g, ang };
    }
    return best;
  }

  const HIN = [0, 0, 0];
  function drawInset() {
    const sz = insetSize(), pad = 12, ox = pad + sz / 2, oy = Hh - 44 - sz / 2, sc = sz * 0.36;
    ctx.save();
    ctx.fillStyle = 'rgba(6,9,19,0.78)';
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.beginPath(); ctx.arc(ox, oy, sz / 2, 0, 6.2832); ctx.fill(); ctx.stroke();
    const P2 = (v) => [ox + sc * dot(v, CAM_R), oy - sc * dot(v, CAM_U), dot(v, CAM_E)];
    const bodyToIn = (v) => [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]];
    const verts = BOX_VERTS.map((v) => P2(bodyToIn(v)));
    ctx.lineWidth = 1.2;
    for (const [a, b] of BOX_EDGES) {
      const depth = (verts[a][2] + verts[b][2]) / 2; // toward the camera is positive
      ctx.strokeStyle = `rgba(220,228,245,${(0.35 + 0.5 * (depth + 0.7) / 1.4).toFixed(2)})`;
      ctx.beginPath(); ctx.moveTo(verts[a][0], verts[a][1]); ctx.lineTo(verts[b][0], verts[b][1]); ctx.stroke();
    }
    // body axes (x red, y green, z blue = where the camera looks)
    const axes = [[[0.55, 0, 0], '#ff8f6b'], [[0, 0.55, 0], '#8be3a8'], [[0, 0, 0.95], '#8eeaff']];
    for (const [v, col] of axes) {
      const p = P2(bodyToIn(v));
      ctx.strokeStyle = col; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(p[0], p[1]); ctx.stroke();
    }
    // total angular momentum, inertial: the arrow that never moves unless something outside pushes
    A.inertialMomentum(S, HIN);
    const hm = Math.hypot(HIN[0], HIN[1], HIN[2]);
    if (hm > 1e-4) {
      const L = Math.min(1.15, 0.35 + 0.5 * hm);
      const p = P2([HIN[0] / hm * L, HIN[1] / hm * L, HIN[2] / hm * L]);
      ctx.strokeStyle = '#ffd58a'; ctx.fillStyle = '#ffd58a'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(p[0], p[1]); ctx.stroke();
      ctx.beginPath(); ctx.arc(p[0], p[1], 3.5, 0, 6.2832); ctx.fill();
    }
    // the sun, as a dot on the rim
    const sp = P2([SUN[0] * 1.3, SUN[1] * 1.3, SUN[2] * 1.3]);
    ctx.fillStyle = '#fff1c0'; ctx.beginPath(); ctx.arc(sp[0], sp[1], 3, 0, 6.2832); ctx.fill();
    // thruster puffs
    if (S.thrusting) {
      ctx.fillStyle = 'rgba(255,230,180,0.8)';
      for (let i = 0; i < 3; i++) {
        if (!S.tauThr[i]) continue;
        const sgn = Math.sign(S.tauThr[i]);
        const j = (i + 1) % 3, k = (i + 2) % 3;
        // a couple about axis i: puffs at ±BOX[j] along j, pointing ∓/± along k
        for (const side of [1, -1]) {
          const base = [0, 0, 0]; base[j] = side * BOX[j] * 1.05;
          const tip = base.slice(); tip[k] += side * sgn * 0.3;
          const b0 = P2(bodyToIn(base)), t0 = P2(bodyToIn(tip));
          ctx.beginPath(); ctx.moveTo(b0[0], b0[1]); ctx.lineTo(t0[0], t0[1]); ctx.strokeStyle = 'rgba(255,230,180,0.85)'; ctx.lineWidth = 2; ctx.stroke();
        }
      }
    }
    ctx.fillStyle = 'rgba(200,210,235,0.75)';
    ctx.font = '9px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.textBaseline = 'top'; ctx.fillText('from outside', ox, oy - sz / 2 + 5);
    ctx.textBaseline = 'bottom'; ctx.fillStyle = '#ffd58a'; ctx.fillText('gold: total momentum', ox, oy + sz / 2 - 5);
    ctx.restore();
  }

  // ---------- HUD & panel ----------
  const fmtClock = (t) => {
    const d = Math.floor(t / 86400), h = Math.floor((t % 86400) / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60);
    return `${d}d ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };
  const fmtDur = (sec) => {
    if (!isFinite(sec)) return 'forever';
    if (sec < 90) return `${sec.toFixed(0)} s`;
    if (sec < 5400) return `${(sec / 60).toFixed(1)} min`;
    if (sec < 172800) return `${(sec / 3600).toFixed(1)} h`;
    if (sec < 2 * 3.15576e7) return `${(sec / 86400).toFixed(0)} days`;
    return `${(sec / 3.15576e7).toFixed(1)} years`;
  };
  function updateHud() {
    const w = A.omega(S, P, V1);
    const wmag = Math.hypot(w[0], w[1], w[2]);
    const c = S.ctrl;
    let mode;
    if (c.mode === 'raw') mode = 'Autopilot off · nothing damps';
    else if (c.phase === 'detumble') mode = 'Autopilot · detumbling';
    else {
      const e = A.errorVector(S.q, c.qT, V2);
      mode = Math.hypot(e[0], e[1], e[2]) > 1 * DEG ? 'Autopilot · slewing' : 'Autopilot · holding';
    }
    hudMode.textContent = mode;
    hudTime.textContent = `${fmtClock(S.t)} · ${rate}× time${paused ? ' · paused' : ''}`;
    hudRate.textContent = `turning ${(wmag / DEG).toFixed(2)}°/s`;
    const n = nearestGuide();
    if (n) {
      hudTarget.textContent = n.ang < 1 * DEG ? `${n.g.name} · on target` : `${n.g.name} · ${(n.ang / DEG).toFixed(1)}° off`;
      hudTarget.style.color = n.ang < 1 * DEG ? '#8be3a8' : n.g.col;
    }
    if (S.sat[0] || S.sat[1] || S.sat[2]) lastSatAt = performance.now();
    const anySat = performance.now() - lastSatAt < 600; // latched briefly: at 600× one frame is 500 steps
    badgeFull.hidden = !anySat;
    badgeThr.hidden = !S.thrusting;
    let hint;
    if (S.prop <= 0) hint = 'Out of gas: the wheels can never be emptied again';
    else if (S.thrusting) hint = 'Thrusters firing · the wheels wind down against them';
    else if (anySat) hint = 'A wheel is full · empty the wheels, or the sky drifts';
    else if (c.mode === 'raw') hint = tr.tumbleAxis >= 0 ? 'Free tumble · autopilot on to catch it' : 'Hold a drag to push · let go and it keeps turning';
    else hint = tr.dragging ? 'The sky follows your finger · a wheel takes the spin' : 'Drag the sky to point somewhere else';
    hudHint.textContent = hint;
  }
  let panelAcc = 0, lastSatAt = -1e9;
  function updatePanel() {
    const w = A.omega(S, P, V1);
    for (let i = 0; i < 3; i++) {
      const h = S.h[i], frac = Math.min(1, Math.abs(h) / P.hMax);
      const wh = wheels[i];
      wh.fill.style.left = h >= 0 ? '50%' : `${50 - 50 * frac}%`;
      wh.fill.style.width = `${50 * frac}%`;
      wh.el.classList.toggle('full', frac >= 0.999);
      wh.el.classList.toggle('warn', frac >= 0.85 && frac < 0.999);
      const rpm = (h / P.Iw) * 60 / (2 * Math.PI);
      wh.val.textContent = `${h >= 0 ? '+' : '−'}${Math.abs(h).toFixed(3)} · ${Math.abs(rpm).toFixed(0)} rpm`;
    }
    $('rBody').textContent = `${(Math.hypot(w[0], w[1], w[2]) / DEG).toFixed(2)}°/s`;
    $('rProp').textContent = `${S.prop.toFixed(3)} kg · ${(S.propUsed * 1e3).toFixed(1)} g used`;
    const tau = Math.hypot(P.tauDist[0], P.tauDist[1], P.tauDist[2]);
    const fill = tau > 0 ? A.fillTime(P, tau) : Infinity;
    const life = tau > 0 ? A.lifetime(P, S.prop, tau) : Infinity;
    $('rLife').textContent = tau > 0 ? `a wheel lined up with it fills in ${fmtDur(fill)} · the tank lasts ${fmtDur(life)}` : 'no disturbance: the wheels only hold what you lend them';
    $('distNote').textContent = tau > 0 ? `Fills a wheel lined up with it in ${fmtDur(fill)}. A full tank buys ${fmtDur(A.lifetime(P, P.propMass, tau))} of emptying.` : 'No disturbance. The wheels never fill on their own.';
    // ledger, in inertial axes so the columns add up exactly
    const L = S.ledger;
    const Hn = A.inertialMomentum(S, HIN);
    const exp = [L.H0[0] + L.dep[0] + L.thr[0], L.H0[1] + L.dep[1] + L.thr[1], L.H0[2] + L.dep[2] + L.thr[2]];
    const bodyH = [P.J[0] * w[0], P.J[1] * w[1], P.J[2] * w[2]];
    const mag = (v) => Math.hypot(v[0], v[1], v[2]);
    setRow('lOpen', L.H0); setRow('lDep', L.dep); setRow('lThr', L.thr); setRow('lExp', exp); setRow('lNow', Hn);
    $('lSplit').textContent = `On board, in body axes: wheels hold ${mag(S.h).toFixed(4)}, the body itself ${mag(bodyH).toFixed(4)} (lengths).`;
    const res = A.ledgerResidual(S);
    $('lErr').textContent = res === 0 ? '0' : res.toExponential(1);
    $('lErr').parentElement.classList.toggle('bad', res > 1e-6); // round-off grows ~1.5e-9 per simulated day
  }
  const fmtSigned = (v) => (v < 0 ? '−' : '+') + Math.abs(v).toFixed(4);
  function setRow(id, v) {
    for (let i = 0; i < 3; i++) $(id + i).textContent = fmtSigned(v[i]);
  }

  // ---------- main loop ----------
  function frame(now) {
    const wallDt = lastT ? (now - lastT) / 1000 : 0;
    lastT = now;
    let n = 0;
    if (!paused) {
      n = A.clockSteps(clock, wallDt, rate, 3000);
      for (let i = 0; i < n; i++) A.step(S, P);
    }
    checkTries(n * A.DT);
    drawSky();
    updateHud();
    panelAcc += wallDt;
    if (panelAcc > 0.08) { panelAcc = 0; updatePanel(); }
    requestAnimationFrame(frame);
  }

  // ---------- input ----------
  let drag = null;
  function pointerPos(e) {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    const [x, y] = pointerPos(e);
    drag = { id: e.pointerId, x, y };
    tr.dragging = true;
    canvas.classList.add('dragging');
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    if (S.ctrl.mode === 'raw') joystick = { x0: x, y0: y, x, y };
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const [x, y] = pointerPos(e);
    if (S.ctrl.mode === 'hold') {
      const f = focal();
      A.nudgeTarget(S, -(y - drag.y) / f, -(x - drag.x) / f, 0);
    } else {
      joystick.x = x; joystick.y = y;
      const ox = (x - joystick.x0) / 80, oy = (y - joystick.y0) / 80;
      S.ctrl.raw[0] = Math.max(-1, Math.min(1, oy));
      S.ctrl.raw[1] = Math.max(-1, Math.min(1, ox));
    }
    drag.x = x; drag.y = y;
  });
  function endDrag(e) {
    if (!drag || (e && e.pointerId !== undefined && e.pointerId !== drag.id)) return;
    drag = null; joystick = null; tr.dragging = false;
    canvas.classList.remove('dragging');
    S.ctrl.raw[0] = 0; S.ctrl.raw[1] = 0;
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('lostpointercapture', endDrag);

  // roll buttons: hold → 10° nudge per press; raw → torque while held
  function rollButton(el, sign) {
    let holding = false;
    const start = (e) => {
      e.preventDefault();
      holding = true;
      if (S.ctrl.mode === 'hold') A.nudgeTarget(S, 0, 0, sign * 10 * DEG);
      else S.ctrl.raw[2] = -sign;
    };
    const stop = () => { if (!holding) return; holding = false; S.ctrl.raw[2] = 0; };
    el.addEventListener('pointerdown', start);
    el.addEventListener('pointerup', stop);
    el.addEventListener('pointercancel', stop);
    el.addEventListener('pointerleave', stop);
    el.addEventListener('click', (e) => e.preventDefault());
  }
  rollButton($('rollL'), -1);
  rollButton($('rollR'), +1);

  // keyboard
  const keysDown = new Set();
  function applyKeyTorque() {
    if (S.ctrl.mode !== 'raw') return;
    const k = keysDown;
    S.ctrl.raw[0] = (k.has('ArrowUp') ? 1 : 0) + (k.has('ArrowDown') ? -1 : 0);
    S.ctrl.raw[1] = (k.has('ArrowLeft') ? 1 : 0) + (k.has('ArrowRight') ? -1 : 0);
    S.ctrl.raw[2] = (k.has('KeyQ') ? 1 : 0) + (k.has('KeyE') ? -1 : 0);
  }
  window.addEventListener('keydown', (e) => {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const c = e.code;
    const NUDGE = { ArrowUp: [-2, 0, 0], ArrowDown: [2, 0, 0], ArrowLeft: [0, -2, 0], ArrowRight: [0, 2, 0], KeyQ: [0, 0, -10], KeyE: [0, 0, 10] };
    if (NUDGE[c]) {
      e.preventDefault();
      if (S.ctrl.mode === 'hold') { const n = NUDGE[c]; A.nudgeTarget(S, n[0] * DEG, n[1] * DEG, n[2] * DEG); }
      else { keysDown.add(c); applyKeyTorque(); }
    } else if (c === 'Space') { e.preventDefault(); togglePause(); }
    else if (c === 'KeyA') setMode(S.ctrl.mode === 'hold' ? 'raw' : 'hold');
    else if (c === 'KeyD') desat();
    else if (c === 'KeyT') setRate(rate === 1 ? 10 : rate === 10 ? 600 : 1);
  });
  window.addEventListener('keyup', (e) => { if (keysDown.delete(e.code)) applyKeyTorque(); });
  window.addEventListener('blur', () => { keysDown.clear(); if (S.ctrl.mode === 'raw') S.ctrl.raw[0] = S.ctrl.raw[1] = S.ctrl.raw[2] = 0; endDrag(); });

  // ---------- controls ----------
  function seg(id, onPick) {
    const el = $(id);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      onPick(b.dataset.v);
    });
    return (v) => { for (const b of el.querySelectorAll('button')) b.classList.toggle('on', b.dataset.v === String(v)); };
  }
  const markMode = seg('mode', (v) => setMode(v));
  const markRate = seg('rate', (v) => setRate(Number(v)));
  seg('tumble', (v) => startTumble(Number(v)));
  function setMode(m) {
    A.setMode(S, m);
    if (m === 'hold') { keysDown.clear(); }
    markMode(m);
    if (m === 'raw') toast('Autopilot off. Your drag is now a raw motor torque, and nothing will stop the turn but you.');
  }
  function setRate(r) { rate = r; markRate(r); }
  function togglePause() { paused = !paused; $('pause').textContent = paused ? 'Resume' : 'Pause'; }
  function desat() {
    if (S.prop <= 0) { toast('No propellant left. The wheels keep what they hold.'); return; }
    if (S.ctrl.desat) return;
    S.ctrl.desat = true;
    if (S.ctrl.mode === 'raw') markMode('hold');
    toast('Thrusters: the wheels wind down against them, and the gas is gone for good.');
  }
  function startTumble(axis) {
    A.setTumble(S, P, axis, 0.3, 0.003);
    tr.tumbleAxis = axis; tr.prevWy = 0; tr.loadDir = null;
    markMode('raw');
    const names = ['long axis (x): steady', 'middle axis (y): watch it turn over', 'short axis (z, your line of sight): steady'];
    toast(`Free tumble at 17°/s about the ${names[axis]}. Autopilot off.`);
  }
  $('desat').addEventListener('click', desat);
  $('pause').addEventListener('click', togglePause);
  $('reset').addEventListener('click', () => {
    S = A.makeState(P);
    tr.tumbleAxis = -1; tr.loadDir = null; tr.held.fill(0); tr.visited.fill(false);
    joystick = null; keysDown.clear();
    markMode('hold');
    toast('Back at the start: wheels empty, tank full, pointing at Lantern-ish.');
  });
  const distEl = $('dist');
  function onDist() {
    setDisturbance(Number(distEl.value));
    $('distOut').textContent = `${distMicro} µN·m`;
    updatePanel();
  }
  distEl.addEventListener('input', onDist);
  onDist();
  markMode('hold'); markRate(rate);
  updatePanel();
  requestAnimationFrame(frame);
})();
