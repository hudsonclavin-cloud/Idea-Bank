/* The Hill That Holds — UI, rendering and mission tracking. Physics lives in physics.js. */
(function () {
  'use strict';
  const P = window.HillPhysics;
  const { TAU, DT, TICK_STEPS, TICKS_PER_ORBIT, ROUTH_MU } = P;
  const DEG = Math.PI / 180;

  // ---------- tunables ----------
  const ORBIT_SECONDS = 2.5; // wall seconds per planet-year at 1×
  const SPEEDS = [1, 4, 12];
  const MAX_TICKS_PER_FRAME = 48; // beyond this the sim slows down rather than changing its timestep
  const MAX_MARBLES = 100;
  const TRAIL_LEN = 640; // samples per marble
  const TRAIL_EVERY = 4; // ticks between trail samples (50 per planet-year), plus extra samples when moving fast
  const R_ESCAPE = 3;
  const MU_MIN = 1e-4, MU_MAX = 0.2;
  const FINE_GAIN = 1 / 3; // touch: the ghost marble moves a third as far as your finger
  const HEIGHT_SCALE = 0.08; // log-height knee as a fraction of mu(1-mu): small enough that L4/L5 read as summits
  const INERTIAL_TRAIL = 0.4 * TAU; // in the star's view, show only the last 0.4 planet-years of each trail
  const PRESETS = [
    { label: 'Sun–Jupiter', mu: 0.000954 },
    { label: 'Earth–Moon', mu: 0.01215 },
    { label: 'Routh limit', mu: ROUTH_MU },
    { label: 'Pluto–Charon', mu: 0.1086 },
  ];
  const MISSIONS = [
    {
      id: 'hold', title: 'The hill holds',
      text: 'Drop a marble at rest near L4 or L5 and keep it on the hill for 10 planet-years.',
      hint: 'Zoom to L4 and sweep slowly across the ridge: the preview turns into a tadpole in a thin band.',
      insight: 'As the marble starts to roll, Coriolis turns it sideways, so it circles the summit instead of leaving.',
    },
    {
      id: 'roll', title: 'Switch off Coriolis',
      text: 'With marbles on the hill, switch Coriolis off.',
      hint: 'The swarm at L4 is perfect for this. Same hill, same energy. What changes?',
      insight: 'Without the sideways steering, a hilltop behaves like a hilltop: everything rolls off.',
    },
    {
      id: 'outside', title: 'Step outside',
      text: "Watch a marble that's holding on the hill from the star's view (non-rotating).",
      hint: 'Use View → Star’s view while a hill marble is going.',
      insight: 'From outside, nothing circles a hill: the marble just orbits the star alongside the planet, 60° ahead or behind.',
    },
    {
      id: 'horseshoe', title: 'Horseshoe',
      text: 'Find an orbit that swings from one hill to the other, behind the star, and never passes the planet.',
      hint: 'Drop a marble at rest right on the ridge near L3 (zoom helps), then speed up.',
      insight: 'A horseshoe: the marble alternates between slightly faster and slightly slower orbits than the planet, and never catches it.',
    },
    {
      id: 'heavy', title: 'Too heavy to hold',
      text: 'Make the planet heavier than about 1/26 of the system and watch a hilltop swarm fall apart.',
      hint: 'Drop a swarm, then drag the mass slider past the dashed line (or tap Pluto–Charon).',
      insight: 'Past μ ≈ 0.0385 (Routh’s limit) the steering can’t keep up, and the summits stop holding.',
    },
  ];
  const STORE_KEY = 'hill-that-holds.v1';

  const reduceMotion = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const noHover = !!(window.matchMedia && matchMedia('(hover: none)').matches);

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const stage = $('stage');
  const canvas = $('sky');
  const ctx = canvas.getContext('2d');
  const ui = {
    play: $('play'), speed: $('speed'), tool: $('tool'), coriolis: $('coriolis'), view: $('view'), focus: $('focus'),
    swarm: $('swarm'), clear: $('clear'), mu: $('mu'), muOut: $('muOut'), presets: $('presets'), verdict: $('verdict'),
    routhMark: $('routhMark'), hudFrame: $('hudFrame'), hudTime: $('hudTime'), hudHint: $('hudHint'), badgeOff: $('badgeOff'),
    toast: $('toast'), rCount: $('rCount'), rLost: $('rLost'), rDrift: $('rDrift'), rSel: $('rSel'),
    missionList: $('missionList'), mScore: $('mScore'), resetMissions: $('resetMissions'),
  };

  // ---------- state ----------
  const S = {
    mu: 0.000954, coriolis: true, view: 'rot', focus: 'system', tool: 'drop',
    speedIdx: reduceMotion ? 0 : 1, running: !reduceMotion,
    ticks: 0, t: 0,
    marbles: [], nextId: 1, selected: null, lost: 0, heavyBreaks: 0,
    L: null, radii: null, lin: null, omegaL4: 0, omegaL3: 0,
    done: loadDone(), muFast: false, hasLaunched: false,
  };
  const clock = P.makeClock(ORBIT_SECONDS);
  const bursts = [];

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function setMu(mu) {
    S.mu = clamp(mu, MU_MIN, MU_MAX);
    S.L = P.lagrangePoints(S.mu);
    S.radii = P.bodyRadii(S.mu);
    S.lin = P.l4Linear(S.mu);
    S.omegaL4 = P.omega(S.L.L4[0], S.L.L4[1], S.mu);
    S.omegaL3 = P.omega(S.L.L3[0], S.L.L3[1], S.mu);
    // The Jacobi constant depends on mu, so re-baseline the drift meter.
    for (const m of S.marbles) if (m.alive) m.C0 = P.jacobi(m.s, S.mu);
    ui.muOut.textContent = fmtMu(S.mu);
    renderVerdict();
  }

  function fmtMu(mu) { return mu < 0.01 ? mu.toFixed(6) : mu.toFixed(4); }
  const sliderToMu = (v) => MU_MIN * Math.pow(MU_MAX / MU_MIN, v / 1000);
  const muToSlider = (mu) => (1000 * Math.log(mu / MU_MIN)) / Math.log(MU_MAX / MU_MIN);

  // ---------- camera ----------
  const view = { W: 300, H: 300, dpr: 1, cx: 150, cy: 150, scale: 100, fx: 0, fy: 0, half: 1.2, theta: 0, cos: 1, sin: 0, camX: 0, camY: 0 };

  function focusSpec() {
    switch (S.focus) {
      case 'L4': return { f: S.L.L4, half: 0.3 };
      case 'L3': return { f: S.L.L3, half: 0.3 };
      case 'planet': return { f: [1 - S.mu, 0], half: Math.max(0.16, 2.4 * S.radii.hill) };
      default: return { f: [0, 0], half: 1.2 };
    }
  }

  function updateCamera() {
    const fs = focusSpec();
    view.fx = fs.f[0]; view.fy = fs.f[1]; view.half = fs.half;
    view.scale = Math.min(view.W, view.H) / (2 * fs.half);
    view.cx = view.W / 2; view.cy = view.H / 2;
    view.theta = S.view === 'inertial' ? S.t : 0;
    view.cos = Math.cos(view.theta); view.sin = Math.sin(view.theta);
    view.camX = view.cos * view.fx - view.sin * view.fy;
    view.camY = view.sin * view.fx + view.cos * view.fy;
  }

  /** Rotating-frame point → CSS-pixel screen point, with the map rotated by angle (c, s). */
  function toScreenCS(x, y, c, s, out) {
    const X = c * x - s * y, Y = s * x + c * y;
    out[0] = view.cx + view.scale * (X - view.camX);
    out[1] = view.cy - view.scale * (Y - view.camY);
    return out;
  }
  const _sp = [0, 0];
  const toScreen = (x, y, out = _sp) => toScreenCS(x, y, view.cos, view.sin, out);

  function screenToRot(sx, sy) {
    const X = view.camX + (sx - view.cx) / view.scale;
    const Y = view.camY - (sy - view.cy) / view.scale;
    return [view.cos * X + view.sin * Y, -view.sin * X + view.cos * Y];
  }

  function setMapTransform(c) {
    const s = view.scale * view.dpr, d = view.dpr;
    c.setTransform(s * view.cos, -s * view.sin, -s * view.sin, -s * view.cos,
      d * (view.cx - view.scale * view.camX), d * (view.cy + view.scale * view.camY));
  }

  // ---------- landscape (effective potential energy map) ----------
  const land = { canvas: document.createElement('canvas'), grid: null, NX: 0, NY: 0, x0: 0, y0: 0, w: 1, h: 1, key: '' };
  land.ctx = land.canvas.getContext('2d');
  const RAMP = buildRamp([
    [0.0, '#03040a'], [0.3, '#0a1230'], [0.5, '#172a5a'], [0.64, '#234e7c'], [0.75, '#2d7890'],
    [0.84, '#58a394'], [0.9, '#c3ad72'], [0.955, '#f2d698'], [1.0, '#fff6dc'],
  ]);

  function buildRamp(stops) {
    const lut = new Uint8ClampedArray(256 * 3);
    const rgb = stops.map(([p, h]) => [p, parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      let k = 0;
      while (k < rgb.length - 2 && t > rgb[k + 1][0]) k++;
      const a = rgb[k], b = rgb[k + 1];
      const f = clamp((t - a[0]) / (b[0] - a[0]), 0, 1);
      for (let c = 0; c < 3; c++) lut[i * 3 + c] = a[c + 1] + (b[c + 1] - a[c + 1]) * f;
    }
    return lut;
  }

  function landKey(q) { return [S.mu, S.focus, S.view, view.W, view.H, view.dpr, q].join('|'); }

  // Scratch buffers reused between renders (a fresh 1M-cell allocation per render is slow).
  let bufH = null, bufV = null;

  /**
   * Render the map for the current focus. In the turning view only the visible rectangle is
   * needed; in the star's view the map rotates, so we render a square covering the diagonal.
   * Resolution is about one cell per CSS pixel (the field is smooth; drawImage interpolates).
   */
  function renderLandscape(quality) {
    const pad = 1.04;
    let halfX, halfY;
    if (S.view === 'inertial') {
      halfX = halfY = ((0.5 * Math.hypot(view.W, view.H)) / view.scale) * pad;
    } else {
      halfX = ((0.5 * view.W) / view.scale) * pad;
      halfY = ((0.5 * view.H) / view.scale) * pad;
    }
    const dens = view.scale * quality; // cells per world unit: about one per CSS pixel
    const NX = clamp(Math.ceil(2 * halfX * dens), 32, 1600);
    const NY = clamp(Math.ceil(2 * halfY * dens), 32, 1600);
    const x0 = view.fx - halfX, y0 = view.fy - halfY;
    const dx = (2 * halfX) / NX, dy = (2 * halfY) / NY;
    const mu = S.mu, m1 = 1 - mu, NN = NX * NY;
    if (!land.grid || land.grid.length !== NN) land.grid = new Float32Array(NN);
    if (!bufH || bufH.length < NN) { bufH = new Float32Array(NN); bufV = new Float32Array(NN); }
    const grid = land.grid, h = bufH, v = bufV;
    // Height: 1 at the L4/L5 summits, falling off on a log scale so the faint ridge structure (≈ mu) shows.
    const sc = Math.max(HEIGHT_SCALE * mu * (1 - mu), 4e-6);
    const vmax = Math.log(1 + 4 / sc), oL4 = S.omegaL4, invSc = 1 / sc, invVmax = 1 / vmax;
    for (let j = 0; j < NY; j++) {
      const y = y0 + (j + 0.5) * dy, yy = y * y;
      let k = j * NX;
      for (let i = 0; i < NX; i++, k++) {
        const x = x0 + (i + 0.5) * dx;
        const a = x + mu, b = x - m1;
        const om = 0.5 * (x * x + yy) + m1 / Math.sqrt(a * a + yy) + mu / Math.sqrt(b * b + yy);
        grid[k] = om;
        const dd = om - oL4;
        const vv = dd > 0 ? Math.log(1 + dd * invSc) : 0;
        v[k] = vv;
        h[k] = vv >= vmax ? 0 : 1 - vv * invVmax;
      }
    }
    if (land.canvas.width !== NX || land.canvas.height !== NY) { land.canvas.width = NX; land.canvas.height = NY; }
    const img = land.ctx.createImageData(NX, NY);
    const px = img.data;
    const rx = 0.035 / (2 * dx), ry = 0.035 / (2 * dy);
    const Lx = -0.45, Ly = 0.55, Lz = 0.7;
    const invBand = 1 / 0.55, oL3 = S.omegaL3;
    for (let j = 0; j < NY; j++) {
      const top = j < NY - 1, bot = j > 0;
      let k = j * NX;
      for (let i = 0; i < NX; i++, k++) {
        const kl = i > 0 ? k - 1 : k, kr = i < NX - 1 ? k + 1 : k;
        const kd = bot ? k - NX : k, ku = top ? k + NX : k;
        const nx = -(h[kr] - h[kl]) * rx, ny = -(h[ku] - h[kd]) * ry;
        const dot = (nx * Lx + ny * Ly + Lz) / Math.sqrt(nx * nx + ny * ny + 1);
        const shade = 0.6 + 0.57 * (dot > 0 ? dot : 0);
        const li = ((h[k] * 255 + 0.5) | 0) * 3;
        let r = RAMP[li] * shade, g = RAMP[li + 1] * shade, b = RAMP[li + 2] * shade;
        // contour lines of the height field
        const band = (v[k] * invBand) | 0;
        if (band !== ((v[kr] * invBand) | 0) || band !== ((v[ku] * invBand) | 0)) {
          r += (255 - r) * 0.13; g += (255 - g) * 0.13; b += (255 - b) * 0.13;
        }
        // the L3 level: the boundary between tadpole-shaped and horseshoe-shaped energy fences
        const s0 = grid[k] < oL3;
        if ((s0 !== (grid[kr] < oL3) || s0 !== (grid[ku] < oL3)) && ((i + j) & 3) < 2) {
          r += (255 - r) * 0.5; g += (214 - g) * 0.5; b += (140 - b) * 0.5;
        }
        const o = k * 4;
        px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 255;
      }
    }
    land.ctx.putImageData(img, 0, 0);
    land.NX = NX; land.NY = NY; land.x0 = x0; land.y0 = y0; land.w = 2 * halfX; land.h = 2 * halfY;
    land.key = landKey(quality);
    fence.key = '';
  }

  // ---------- energy fence (zero-velocity region for a given Jacobi constant) ----------
  const fence = { canvas: document.createElement('canvas'), key: '' };
  fence.ctx = fence.canvas.getContext('2d');

  function renderFence(C) {
    const key = C.toPrecision(13) + '|' + land.key;
    if (key === fence.key) return;
    fence.key = key;
    const NX = land.NX, NY = land.NY, grid = land.grid, lim = C / 2;
    if (fence.canvas.width !== NX || fence.canvas.height !== NY) { fence.canvas.width = NX; fence.canvas.height = NY; }
    const img = fence.ctx.createImageData(NX, NY);
    const px = img.data;
    for (let j = 0; j < NY; j++) {
      let k = j * NX;
      for (let i = 0; i < NX; i++, k++) {
        const f = grid[k] < lim;
        const fr = i < NX - 1 ? grid[k + 1] < lim : f;
        const fu = j < NY - 1 ? grid[k + NX] < lim : f;
        const o = k * 4;
        if (f !== fr || f !== fu) {
          px[o] = 255; px[o + 1] = 238; px[o + 2] = 200; px[o + 3] = 235;
        } else if (f) {
          if ((i + j) % 6 === 0) { px[o] = 255; px[o + 1] = 230; px[o + 2] = 190; px[o + 3] = 90; }
          else { px[o] = 4; px[o + 1] = 6; px[o + 2] = 16; px[o + 3] = 110; }
        }
      }
    }
    fence.ctx.putImageData(img, 0, 0);
  }

  // ---------- marbles ----------
  function zoneOf(r, phi) {
    if (r < 0.8 || r > 1.2) return 0;
    if (phi > 5 * DEG && phi < 178 * DEG) return 4;
    if (phi < -5 * DEG && phi > -178 * DEG) return 5;
    return 0;
  }
  function hillAt(x, y) {
    const r = Math.hypot(x, y), phi = Math.atan2(y, x);
    if (Math.abs(r - 1) > 0.1) return 0;
    if (Math.abs(phi - 60 * DEG) < 50 * DEG) return 4;
    if (Math.abs(phi + 60 * DEG) < 50 * DEG) return 5;
    return 0;
  }

  function addMarble(s, kind) {
    if (S.marbles.length >= MAX_MARBLES) {
      let idx = S.marbles.findIndex((m) => !m.alive);
      if (idx < 0) idx = S.marbles.findIndex((m) => m.kind === 'swarm' && m !== S.selected);
      if (idx < 0) idx = S.marbles.findIndex((m) => m !== S.selected);
      S.marbles.splice(Math.max(idx, 0), 1);
    }
    const r = Math.hypot(s.x, s.y), phi = Math.atan2(s.y, s.x), u = phi < 0 ? phi + TAU : phi;
    const m = {
      id: S.nextId++, s, kind, alive: true, fate: 0, deathAt: 0, C0: P.jacobi(s, S.mu),
      trail: new Float64Array(TRAIL_LEN * 3), head: 0, count: 0, lx: s.x, ly: s.y,
      bornTick: S.ticks, prevPhi: phi, uMin: u, uMax: u, rMin: r, rMax: r, crossed: false,
      hsLow: false, hsHigh: false,
      launchHill: hillAt(s.x, s.y), leftHill: false, holdTicks: 0,
      everOff: !S.coriolis, offInZone: false, heavyInZone: false, heavyBroke: false,
    };
    pushTrail(m);
    S.marbles.push(m);
    return m;
  }

  function pushTrail(m) {
    const o = m.head * 3;
    m.trail[o] = m.s.x; m.trail[o + 1] = m.s.y; m.trail[o + 2] = S.t;
    m.head = (m.head + 1) % TRAIL_LEN;
    if (m.count < TRAIL_LEN) m.count++;
    m.lx = m.s.x; m.ly = m.s.y;
  }

  function killMarble(m, fate) {
    m.alive = false;
    m.fate = fate;
    m.deathAt = performance.now();
    S.lost++;
    if (fate !== 3) bursts.push({ x: m.s.x, y: m.s.y, t: S.t, at: m.deathAt, hot: fate === 1 });
  }

  function physicsTick() {
    S.ticks++;
    S.t = S.ticks * TICK_STEPS * DT;
    const mu = S.mu, cor = S.coriolis, radii = S.radii;
    const sample = S.ticks % TRAIL_EVERY === 0;
    for (let i = 0; i < S.marbles.length; i++) {
      const m = S.marbles[i];
      if (!m.alive) continue;
      const fate = P.integrate(m.s, mu, cor, TICK_STEPS, radii, R_ESCAPE);
      if (sample || fate || Math.abs(m.s.x - m.lx) + Math.abs(m.s.y - m.ly) > 0.03) pushTrail(m);
      track(m, fate, mu, cor);
    }
  }

  function track(m, fate, mu, cor) {
    if (!cor) m.everOff = true;
    const heavy = cor && mu > ROUTH_MU;
    if (fate) {
      killMarble(m, fate);
      if (!cor && m.offInZone) complete('roll');
      if (heavy && m.heavyInZone) heavyBreak(m);
      return;
    }
    const x = m.s.x, y = m.s.y, r = Math.hypot(x, y), phi = Math.atan2(y, x);
    // Crossing the half-line from the barycentre through the planet = passing the planet.
    if (x > 0 && (phi < 0) !== (m.prevPhi < 0)) m.crossed = true;
    m.prevPhi = phi;
    const u = phi < 0 ? phi + TAU : phi;
    if (u < m.uMin) m.uMin = u;
    if (u > m.uMax) m.uMax = u;
    if (r < m.rMin) m.rMin = r;
    if (r > m.rMax) m.rMax = r;
    const zone = zoneOf(r, phi);

    if (m.launchHill) {
      if (zone !== m.launchHill) m.leftHill = true;
      else if (!m.leftHill && cor && mu < ROUTH_MU) m.holdTicks++;
      if (m.kind === 'user' && !m.leftHill && !m.everOff && m.holdTicks >= 10 * TICKS_PER_ORBIT) complete('hold');
    }
    if (!cor) {
      if (zone) m.offInZone = true;
      else if (m.offInZone) complete('roll');
    }
    if (heavy) {
      if (zone) m.heavyInZone = true;
      else if (m.heavyInZone) heavyBreak(m);
    }
    // Horseshoe: reached both ends (near the planet on each side), came back past L3, never passed the planet.
    if (!m.crossed && !m.everOff && m.rMin > 0.85 && m.rMax < 1.15) {
      if (u < 80 * DEG) m.hsLow = true;
      if (u > 280 * DEG) m.hsHigh = true;
      if (m.hsLow && m.hsHigh && u > 150 * DEG && u < 210 * DEG) { m.horseshoe = true; complete('horseshoe'); }
    }
  }

  function heavyBreak(m) {
    if (m.heavyBroke) return;
    m.heavyBroke = true;
    S.heavyBreaks++;
    if (S.heavyBreaks >= 6) complete('heavy');
  }

  function swarmSpreadDeg(mu) {
    if (mu <= 0.002) return 30;
    if (mu >= 0.035) return 4;
    return 30 - (26 * Math.log(mu / 0.002)) / Math.log(0.035 / 0.002);
  }

  function dropSwarm() {
    const spread = swarmSpreadDeg(S.mu) * DEG, N = 16;
    const r4 = Math.hypot(S.L.L4[0], S.L.L4[1]);
    for (let k = 0; k < N; k++) {
      const phi = Math.PI / 3 + spread * ((2 * k) / (N - 1) - 1);
      let r = P.crestRadius(phi, S.mu);
      if (!Number.isFinite(r)) r = r4;
      addMarble(P.makeState(r * Math.cos(phi), r * Math.sin(phi), 0, 0), 'swarm');
    }
  }

  function clearAll() {
    S.marbles.length = 0;
    bursts.length = 0;
    S.selected = null;
    S.lost = 0;
    S.heavyBreaks = 0;
  }

  // ---------- aiming & preview ----------
  const ptr = { active: false, id: -1, type: 'mouse', sx0: 0, sy0: 0, sx: 0, sy: 0 };
  let hover = null;
  const preview = { pts: new Float64Array(2 * 4000), n: 0, fate: 0, C: 0, key: '', stepT: 0, valid: false };

  function aimInfo() {
    let sx, sy, drag = null;
    if (ptr.active) {
      if (S.tool === 'flick') {
        sx = ptr.sx0; sy = ptr.sy0;
        drag = [ptr.sx - ptr.sx0, ptr.sy - ptr.sy0];
      } else {
        const g = ptr.type === 'mouse' ? 1 : FINE_GAIN;
        sx = ptr.sx0 + (ptr.sx - ptr.sx0) * g;
        sy = ptr.sy0 + (ptr.sy - ptr.sy0) * g;
      }
    } else if (hover) {
      sx = hover.sx; sy = hover.sy;
    } else return null;
    const [x, y] = screenToRot(sx, sy);
    let vx = 0, vy = 0, speed = 0;
    if (drag) {
      const len = Math.hypot(drag[0], drag[1]);
      if (len > 6) {
        const L = len / Math.min(view.W, view.H);
        speed = Math.min(1.2, 0.8 * L * L);
        const ex = drag[0] / len, ey = -drag[1] / len; // screen → view-world direction
        vx = speed * (view.cos * ex + view.sin * ey);
        vy = speed * (-view.sin * ex + view.cos * ey);
      }
    }
    return { sx, sy, x, y, vx, vy, speed, drag };
  }

  function previewYears() {
    return S.lin.stable ? clamp(1.2 / S.lin.sLong, 5, 26) : 8;
  }

  function placeProblem(x, y) {
    const r1 = Math.hypot(x + S.mu, y), r2 = Math.hypot(x - 1 + S.mu, y);
    if (r1 < S.radii.star * 1.02) return 'That spot is inside the star.';
    if (r2 < S.radii.planet * 1.02) return 'That spot is inside the planet.';
    if (Math.hypot(x, y) > R_ESCAPE * 0.97) return 'Too far out: that marble would just leave.';
    return '';
  }

  function updatePreview(aim) {
    const key = [aim.x, aim.y, aim.vx, aim.vy, S.mu, S.coriolis].join('|');
    if (key === preview.key) return;
    preview.key = key;
    if (placeProblem(aim.x, aim.y)) { preview.valid = false; return; }
    const s = P.makeState(aim.x, aim.y, aim.vx, aim.vy);
    preview.C = P.jacobi(s, S.mu);
    const ticks = Math.round(previewYears() * TICKS_PER_ORBIT), every = 2;
    const pts = preview.pts;
    let n = 0, fate = 0;
    pts[0] = s.x; pts[1] = s.y; n = 1;
    for (let k = 1; k <= ticks && n < 3999; k++) {
      fate = P.integrate(s, S.mu, S.coriolis, TICK_STEPS, S.radii, R_ESCAPE);
      if (k % every === 0 || fate) { pts[2 * n] = s.x; pts[2 * n + 1] = s.y; n++; }
      if (fate) break;
    }
    preview.n = n;
    preview.fate = fate;
    preview.stepT = every * TICK_STEPS * DT;
    preview.valid = true;
  }

  function launch(aim) {
    const problem = placeProblem(aim.x, aim.y);
    if (problem) { showToast(problem, 2200); return; }
    const m = addMarble(P.makeState(aim.x, aim.y, aim.vx, aim.vy), 'user');
    S.selected = m;
    if (!S.hasLaunched) { S.hasLaunched = true; updateHint(); }
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (ptr.active) return;
    const rect = canvas.getBoundingClientRect();
    ptr.active = true; ptr.id = e.pointerId; ptr.type = e.pointerType || 'mouse';
    ptr.sx0 = ptr.sx = e.clientX - rect.left;
    ptr.sy0 = ptr.sy = e.clientY - rect.top;
    hover = null;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* not critical */ }
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    if (ptr.active) {
      if (e.pointerId === ptr.id) { ptr.sx = sx; ptr.sy = sy; }
    } else if (e.pointerType === 'mouse') {
      hover = { sx, sy };
    }
  });
  function endPointer(e, commit) {
    if (!ptr.active || e.pointerId !== ptr.id) return;
    if (commit) {
      const aim = aimInfo();
      if (aim) launch(aim);
    }
    ptr.active = false;
    if (e.pointerType === 'mouse' && commit) {
      const rect = canvas.getBoundingClientRect();
      hover = { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
    }
  }
  canvas.addEventListener('pointerup', (e) => endPointer(e, true));
  canvas.addEventListener('pointercancel', (e) => endPointer(e, false));
  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !ptr.active) hover = null; });

  // ---------- drawing ----------
  function draw(now) {
    const c = ctx, dpr = view.dpr;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#05060d';
    c.fillRect(0, 0, view.W, view.H);

    setMapTransform(c);
    c.imageSmoothingEnabled = true;
    c.drawImage(land.canvas, land.x0, land.y0, land.w, land.h);

    const aim = aimInfo();
    if (aim) updatePreview(aim);
    let fenceC = null, fenceAlpha = 1;
    if (aim && preview.valid) fenceC = preview.C;
    else if (S.selected && S.selected.alive) { fenceC = S.selected.C0; fenceAlpha = 0.55; }
    if (fenceC !== null) {
      renderFence(fenceC);
      c.globalAlpha = fenceAlpha;
      c.drawImage(fence.canvas, land.x0, land.y0, land.w, land.h);
      c.globalAlpha = 1;
    }
    c.setTransform(dpr, 0, 0, dpr, 0, 0);

    drawGuides(c);
    drawTrails(c, now);
    if (aim && preview.valid) drawPreview(c);
    drawBodies(c);
    drawMarbles(c, now);
    if (aim) drawAim(c, aim);
    drawBursts(c, now);
  }

  function drawGuides(c) {
    const p = [0, 0];
    // planet orbit (and the star's tiny one) in the star's view
    if (S.view === 'inertial') {
      c.save();
      c.setLineDash([2, 5]);
      c.strokeStyle = 'rgba(160, 190, 255, 0.28)';
      c.lineWidth = 1;
      const o = toScreenCS(0, 0, 1, 0, p);
      c.beginPath();
      c.arc(o[0], o[1], (1 - S.mu) * view.scale, 0, TAU);
      c.stroke();
      c.restore();
    }
    // Hill sphere around the planet (distance to L1)
    const pl = toScreen(1 - S.mu, 0, p);
    const hr = S.radii.hill * view.scale;
    c.save();
    c.setLineDash([3, 4]);
    c.strokeStyle = 'rgba(143, 199, 255, 0.4)';
    c.lineWidth = 1;
    c.beginPath();
    c.arc(pl[0], pl[1], hr, 0, TAU);
    c.stroke();
    c.restore();

    // Lagrange points
    c.font = '600 11px system-ui, -apple-system, Segoe UI, sans-serif';
    c.textBaseline = 'middle';
    const crowded = hr < 22;
    for (const name of ['L1', 'L2', 'L3', 'L4', 'L5']) {
      if (crowded && (name === 'L1' || name === 'L2')) continue;
      const [x, y] = S.L[name];
      toScreen(x, y, p);
      if (p[0] < -20 || p[1] < -20 || p[0] > view.W + 20 || p[1] > view.H + 20) continue;
      const summit = name === 'L4' || name === 'L5';
      c.beginPath();
      if (summit) {
        c.moveTo(p[0], p[1] - 5); c.lineTo(p[0] + 4.5, p[1] + 3); c.lineTo(p[0] - 4.5, p[1] + 3); c.closePath();
      } else {
        c.moveTo(p[0] - 3.5, p[1] - 3.5); c.lineTo(p[0] + 3.5, p[1] + 3.5);
        c.moveTo(p[0] + 3.5, p[1] - 3.5); c.lineTo(p[0] - 3.5, p[1] + 3.5);
      }
      c.strokeStyle = 'rgba(3, 5, 14, 0.7)';
      c.lineWidth = 3.2;
      c.stroke();
      c.strokeStyle = summit ? '#fff1cf' : 'rgba(255, 236, 190, 0.75)';
      c.lineWidth = 1.3;
      c.stroke();
      c.lineWidth = 3;
      c.strokeStyle = 'rgba(3, 5, 14, 0.75)';
      c.strokeText(name, p[0] + 8, p[1] - 7);
      c.fillStyle = summit ? '#fff1cf' : 'rgba(255, 236, 190, 0.8)';
      c.fillText(name, p[0] + 8, p[1] - 7);
    }
  }

  const ALPHAS = [0.1, 0.2, 0.36, 0.62];
  /** Index (within the ring, 0 = oldest) of the first trail sample newer than tMin; samples are time-ordered. */
  function firstAfter(m, start, n, tMin) {
    let lo = 0, hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (m.trail[((start + mid) % TRAIL_LEN) * 3 + 2] < tMin) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  function drawTrails(c, now) {
    const inertial = S.view === 'inertial';
    // Work out each visible marble's trail window once per frame.
    const spans = [];
    let total = 0;
    for (const m of S.marbles) {
      if (m.count < 2 || (!m.alive && now - m.deathAt > 1500)) continue;
      let n = m.count, start = (m.head - n + TRAIL_LEN) % TRAIL_LEN;
      if (inertial) {
        // Keep only the recent stretch: whole orbits laid over each other just paint a solid ring.
        const k = Math.min(firstAfter(m, start, n, S.t - INERTIAL_TRAIL), n - 2);
        start = (start + k) % TRAIL_LEN;
        n -= k;
      }
      spans.push({ m, start, n, sel: m === S.selected });
      total += n;
    }
    const stride = total > 45000 ? 2 : 1;
    const groups = [{ sel: false, color: '142, 234, 255', w: 1.1 }, { sel: true, color: '255, 255, 255', w: 1.6 }];
    const p = [0, 0];
    for (const g of groups) {
      for (let b = 0; b < 4; b++) {
        c.beginPath();
        let any = false;
        for (const sp of spans) {
          if (sp.sel !== g.sel) continue;
          const { m, start, n } = sp;
          const i0 = Math.floor((b * (n - 1)) / 4), i1 = Math.floor(((b + 1) * (n - 1)) / 4);
          for (let i = i0; i <= i1; i += (i === i1 ? 1 : Math.min(stride, i1 - i))) {
            const o = ((start + i) % TRAIL_LEN) * 3;
            const x = m.trail[o], y = m.trail[o + 1];
            if (inertial) { const t = m.trail[o + 2]; toScreenCS(x, y, Math.cos(t), Math.sin(t), p); } else toScreenCS(x, y, 1, 0, p);
            if (i === i0) c.moveTo(p[0], p[1]); else c.lineTo(p[0], p[1]);
          }
          any = true;
        }
        if (!any) continue;
        if (b >= 2) {
          c.strokeStyle = `rgba(3, 5, 14, ${0.22 * b - 0.2})`;
          c.lineWidth = g.w + 2;
          c.stroke();
        }
        c.strokeStyle = `rgba(${g.color}, ${ALPHAS[b]})`;
        c.lineWidth = g.w;
        c.stroke();
      }
    }
  }

  function drawPreview(c) {
    const pts = preview.pts, n = preview.n, inertial = S.view === 'inertial';
    const p = [0, 0];
    c.save();
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const x = pts[2 * i], y = pts[2 * i + 1];
      if (inertial) { const t = S.t + i * preview.stepT; toScreenCS(x, y, Math.cos(t), Math.sin(t), p); } else toScreenCS(x, y, 1, 0, p);
      if (i === 0) c.moveTo(p[0], p[1]); else c.lineTo(p[0], p[1]);
    }
    c.lineJoin = 'round';
    c.lineWidth = 3.5;
    c.strokeStyle = 'rgba(3, 5, 14, 0.45)';
    c.stroke();
    c.setLineDash([5, 4]);
    c.lineWidth = 1.5;
    c.strokeStyle = S.coriolis ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255, 170, 140, 0.95)';
    c.stroke();
    c.restore();
    if (preview.fate) {
      const label = preview.fate === 1 ? 'into the star' : preview.fate === 2 ? 'hits the planet' : 'escapes';
      c.strokeStyle = '#ff8f6b';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(p[0] - 4, p[1] - 4); c.lineTo(p[0] + 4, p[1] + 4);
      c.moveTo(p[0] + 4, p[1] - 4); c.lineTo(p[0] - 4, p[1] + 4);
      c.stroke();
      if (p[0] > 0 && p[0] < view.W && p[1] > 0 && p[1] < view.H) {
        c.font = '600 11px system-ui, sans-serif';
        c.fillStyle = '#ffb59d';
        c.textBaseline = 'middle';
        const right = p[0] < view.W - 100;
        c.textAlign = right ? 'left' : 'right';
        c.fillText(label, p[0] + (right ? 8 : -8), p[1]);
        c.textAlign = 'left';
      }
    }
  }

  function glowDisc(c, x, y, r, core, glow, glowR) {
    const g = c.createRadialGradient(x, y, r * 0.3, x, y, glowR);
    g.addColorStop(0, glow);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.beginPath(); c.arc(x, y, glowR, 0, TAU); c.fill();
    c.fillStyle = core;
    c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
  }

  function drawBodies(c) {
    const p = [0, 0];
    toScreen(-S.mu, 0, p);
    const rs = Math.max(5, S.radii.star * view.scale);
    glowDisc(c, p[0], p[1], rs, '#fff3d0', 'rgba(255, 214, 130, 0.55)', rs * 3.2);
    toScreen(1 - S.mu, 0, p);
    const rp = Math.max(3, S.radii.planet * view.scale);
    glowDisc(c, p[0], p[1], rp, '#a9d4ff', 'rgba(120, 180, 255, 0.45)', rp * 2.6);
  }

  function drawMarbles(c, now) {
    const p = [0, 0];
    for (const m of S.marbles) {
      let a = 1;
      if (!m.alive) { a = 1 - (now - m.deathAt) / 1500; if (a <= 0) continue; }
      toScreen(m.s.x, m.s.y, p);
      if (p[0] < -10 || p[1] < -10 || p[0] > view.W + 10 || p[1] > view.H + 10) continue;
      const hot = !S.coriolis && m.alive;
      c.globalAlpha = a;
      c.fillStyle = hot ? 'rgba(255, 143, 107, 0.35)' : 'rgba(142, 234, 255, 0.3)';
      c.beginPath(); c.arc(p[0], p[1], 5.5, 0, TAU); c.fill();
      c.fillStyle = 'rgba(3, 5, 14, 0.7)';
      c.beginPath(); c.arc(p[0], p[1], 3.7, 0, TAU); c.fill();
      c.fillStyle = hot ? '#ffc3ad' : m.kind === 'user' ? '#ffffff' : '#bff3ff';
      c.beginPath(); c.arc(p[0], p[1], 2.6, 0, TAU); c.fill();
      if (m === S.selected) {
        c.strokeStyle = 'rgba(255,255,255,0.85)';
        c.lineWidth = 1.2;
        c.beginPath(); c.arc(p[0], p[1], 8, 0, TAU); c.stroke();
      }
    }
    c.globalAlpha = 1;
  }

  function drawAim(c, aim) {
    const bad = !!placeProblem(aim.x, aim.y);
    if (ptr.active && ptr.type !== 'mouse' && S.tool === 'drop') {
      c.strokeStyle = 'rgba(255,255,255,0.25)';
      c.setLineDash([2, 3]);
      c.beginPath(); c.moveTo(ptr.sx, ptr.sy); c.lineTo(aim.sx, aim.sy); c.stroke();
      c.setLineDash([]);
    }
    c.strokeStyle = bad ? '#ff8f6b' : '#ffffff';
    c.lineWidth = 1.5;
    c.beginPath(); c.arc(aim.sx, aim.sy, 6, 0, TAU); c.stroke();
    c.beginPath();
    c.moveTo(aim.sx - 10, aim.sy); c.lineTo(aim.sx - 7, aim.sy);
    c.moveTo(aim.sx + 7, aim.sy); c.lineTo(aim.sx + 10, aim.sy);
    c.moveTo(aim.sx, aim.sy - 10); c.lineTo(aim.sx, aim.sy - 7);
    c.moveTo(aim.sx, aim.sy + 7); c.lineTo(aim.sx, aim.sy + 10);
    c.stroke();
    if (aim.drag && aim.speed > 0) {
      const ex = aim.sx + aim.drag[0], ey = aim.sy + aim.drag[1];
      const ang = Math.atan2(aim.drag[1], aim.drag[0]);
      c.strokeStyle = '#ffd58a';
      c.lineWidth = 2;
      c.beginPath(); c.moveTo(aim.sx, aim.sy); c.lineTo(ex, ey);
      c.moveTo(ex, ey); c.lineTo(ex - 9 * Math.cos(ang - 0.4), ey - 9 * Math.sin(ang - 0.4));
      c.moveTo(ex, ey); c.lineTo(ex - 9 * Math.cos(ang + 0.4), ey - 9 * Math.sin(ang + 0.4));
      c.stroke();
      c.font = '600 11px system-ui, sans-serif';
      c.fillStyle = '#ffe2ad';
      c.textBaseline = 'middle';
      const txt = `${(aim.speed * 100).toFixed(aim.speed < 0.1 ? 1 : 0)}% of orbital speed`;
      const tx = clamp(ex + 10, 4, view.W - c.measureText(txt).width - 4);
      c.fillText(txt, tx, clamp(ey - 12, 10, view.H - 10));
    }
  }

  function drawBursts(c, now) {
    const p = [0, 0];
    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i], age = (now - b.at) / 700;
      if (age > 1) { bursts.splice(i, 1); continue; }
      const th = S.view === 'inertial' ? b.t : 0;
      toScreenCS(b.x, b.y, Math.cos(th), Math.sin(th), p);
      const r = reduceMotion ? 8 : 4 + 16 * age;
      c.strokeStyle = b.hot ? `rgba(255, 214, 130, ${1 - age})` : `rgba(255, 143, 107, ${1 - age})`;
      c.lineWidth = 1.5;
      c.beginPath(); c.arc(p[0], p[1], r, 0, TAU); c.stroke();
    }
  }

  // ---------- missions & toasts ----------
  function loadDone() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch (_) { return {}; }
  }
  function saveDone() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(S.done)); } catch (_) { /* private mode etc. */ }
  }
  function complete(id) {
    if (S.done[id]) return;
    S.done[id] = true;
    saveDone();
    renderMissions();
    const m = MISSIONS.find((x) => x.id === id);
    showToast(`<strong>✓ ${m.title}.</strong> ${m.insight}`, 6500, true);
  }
  function renderMissions() {
    ui.missionList.innerHTML = '';
    let n = 0;
    for (const m of MISSIONS) {
      const li = document.createElement('li');
      const done = !!S.done[m.id];
      if (done) { li.className = 'done'; n++; }
      li.innerHTML = `<span class="t"></span><span class="d"></span>${done ? '<span class="ins"></span>' : '<span class="h"></span>'}`;
      li.querySelector('.t').textContent = m.title;
      li.querySelector('.d').textContent = m.text;
      if (done) li.querySelector('.ins').textContent = m.insight;
      else li.querySelector('.h').textContent = 'Hint: ' + m.hint;
      ui.missionList.appendChild(li);
    }
    ui.mScore.textContent = `${n}/${MISSIONS.length}`;
  }

  const toastQueue = [];
  let toastTimer = 0;
  function showToast(html, ms, isHtml) {
    toastQueue.push({ html, ms, isHtml });
    if (!toastTimer) nextToast();
  }
  function nextToast() {
    const t = toastQueue.shift();
    if (!t) { ui.toast.hidden = true; toastTimer = 0; return; }
    if (t.isHtml) ui.toast.innerHTML = t.html; else ui.toast.textContent = t.html;
    ui.toast.hidden = false;
    toastTimer = setTimeout(nextToast, t.ms);
  }

  // ---------- panel ----------
  function setPressed(group, value) {
    for (const b of group.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === String(value)));
  }

  function renderVerdict() {
    const k = 27 * S.mu * (1 - S.mu);
    const lin = S.lin;
    if (lin.stable) {
      const yrs = 1 / lin.sLong;
      ui.verdict.innerHTML = `27μ(1−μ) = ${k.toFixed(3)} &lt; 1 · <span class="good">The summits hold.</span> A small tadpole takes about ${yrs.toFixed(1)} planet-years to circle L4.`;
    } else {
      const efold = 1 / (lin.growthRate * TAU);
      ui.verdict.innerHTML = `27μ(1−μ) = ${k.toFixed(3)} &gt; 1 · <span class="bad">Too heavy: the summits can't hold.</span> A nudge at L4 grows e-fold every ${efold.toFixed(2)} planet-years.`;
    }
  }

  function updateHint() {
    let t;
    if (S.tool === 'flick') t = 'Press a spot, drag to set speed and direction, release to launch';
    else if (noHover) t = S.hasLaunched ? 'Tap to drop at rest · hold and drag to fine-tune' : 'Tap the map to drop a marble · hold and drag to fine-tune';
    else t = 'Hover to preview a marble’s path · click to drop it at rest';
    ui.hudHint.textContent = t;
  }

  function statusOf(m) {
    if (!m.alive) return m.fate === 1 ? 'fell into the star' : m.fate === 2 ? 'hit the planet' : 'escaped the system';
    const x = m.s.x, y = m.s.y, zone = zoneOf(Math.hypot(x, y), Math.atan2(y, x));
    const years = (S.ticks - m.bornTick) / TICKS_PER_ORBIT;
    if (!S.coriolis) return zone ? 'on the hill… for now (no Coriolis)' : 'rolling away (no Coriolis)';
    if (m.horseshoe) return 'horseshoe orbit: swings between both hills';
    if (m.launchHill && !m.leftHill) return years < 1 ? 'on the hill…' : `holding on the hill: a tadpole orbit, ${years.toFixed(1)} planet-years so far`;
    if (m.crossed) return 'passes the planet: not sharing its orbit';
    if (zone) return 'drifting along the ridge';
    return 'wandering';
  }

  function updateReadouts() {
    let alive = 0, worst = -1;
    for (const m of S.marbles) {
      if (!m.alive) continue;
      alive++;
      if (S.ticks > m.bornTick) worst = Math.max(worst, Math.abs(P.jacobi(m.s, S.mu) - m.C0) / Math.abs(m.C0));
    }
    ui.rCount.textContent = String(alive);
    ui.rLost.textContent = String(S.lost);
    ui.rDrift.textContent = worst < 0 ? '–' : worst === 0 ? '0 (exact so far)' : `${worst.toExponential(1)} (relative)`;
    const m = S.selected;
    if (m) {
      const C = m.alive ? P.jacobi(m.s, S.mu) : NaN;
      const drift = m.alive ? Math.abs(C - m.C0) / Math.abs(m.C0) : NaN;
      ui.rSel.innerHTML = `<b>Your marble:</b> ${statusOf(m)}.` +
        (m.alive ? `<br><span class="mono">Jacobi C = ${C.toFixed(7)} · drift ${drift === 0 ? '0' : drift.toExponential(1)}</span>` : '');
    }
    ui.hudTime.textContent = `t = ${(S.t / TAU).toFixed(1)} planet-years${S.running ? '' : ' · paused'}`;
    // mission: step outside
    if (S.view === 'inertial' && !S.done.outside) {
      for (const mm of S.marbles) {
        if (mm.alive && mm.launchHill && !mm.leftHill && !mm.everOff && mm.holdTicks >= TICKS_PER_ORBIT) { complete('outside'); break; }
      }
    }
  }

  function setRunning(r) {
    S.running = r;
    ui.play.textContent = r ? 'Pause' : 'Play';
    ui.play.setAttribute('aria-label', r ? 'Pause' : 'Play');
  }
  function setCoriolis(on) {
    S.coriolis = on;
    setPressed(ui.coriolis, on ? 'on' : 'off');
    ui.badgeOff.hidden = on;
    preview.key = '';
  }
  function setView(v) {
    S.view = v;
    setPressed(ui.view, v);
    ui.hudFrame.textContent = v === 'rot' ? 'Turning with the planet' : 'Star’s view · not turning';
  }
  function setFocus(f) {
    S.focus = f;
    setPressed(ui.focus, f);
  }
  function setTool(t) {
    S.tool = t;
    setPressed(ui.tool, t);
    updateHint();
  }
  function setSpeed(i) {
    S.speedIdx = i;
    setPressed(ui.speed, i);
  }

  ui.play.addEventListener('click', () => setRunning(!S.running));
  ui.speed.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setSpeed(+b.dataset.v); });
  ui.tool.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setTool(b.dataset.v); });
  ui.coriolis.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setCoriolis(b.dataset.v === 'on'); });
  ui.view.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setView(b.dataset.v); });
  ui.focus.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setFocus(b.dataset.v); });
  ui.swarm.addEventListener('click', dropSwarm);
  ui.clear.addEventListener('click', clearAll);
  ui.resetMissions.addEventListener('click', () => { S.done = {}; saveDone(); renderMissions(); });

  let muIdle = 0;
  ui.mu.addEventListener('input', () => {
    setMu(sliderToMu(+ui.mu.value));
    S.muFast = true;
    clearTimeout(muIdle);
    muIdle = setTimeout(() => { S.muFast = false; }, 220);
  });
  ui.mu.addEventListener('change', () => { S.muFast = false; });

  for (const p of PRESETS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.innerHTML = `${p.label}<span class="n">${p.mu < 0.01 ? p.mu.toFixed(5) : p.mu.toFixed(4)}</span>`;
    b.addEventListener('click', () => { setMu(p.mu); ui.mu.value = String(Math.round(muToSlider(p.mu))); });
    ui.presets.appendChild(b);
  }
  const routhFrac = muToSlider(ROUTH_MU) / 1000;
  ui.mu.style.setProperty('--routh', `${(routhFrac * 100).toFixed(2)}%`);
  // The thumb's centre travels between thumb-radius insets, so place the mark accordingly.
  ui.routhMark.style.left = `calc(10px + (100% - 20px) * ${routhFrac.toFixed(4)})`;

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.code === 'Space') {
      if (tag === 'BUTTON') return; // let the focused button do its own thing
      e.preventDefault();
      setRunning(!S.running);
      return;
    }
    switch (e.key.toLowerCase()) {
      case 'c': setCoriolis(!S.coriolis); break;
      case 'v': setView(S.view === 'rot' ? 'inertial' : 'rot'); break;
      case 's': dropSwarm(); break;
      case 'd': setTool('drop'); break;
      case 'f': setTool('flick'); break;
      case 'z': { const order = ['system', 'L4', 'L3', 'planet']; setFocus(order[(order.indexOf(S.focus) + 1) % order.length]); break; }
      case '1': case '2': case '3': setSpeed(+e.key - 1); break;
      case 'backspace': case 'delete': clearAll(); break;
      default: break;
    }
  });

  // ---------- sizing & main loop ----------
  function resize() {
    const r = stage.getBoundingClientRect();
    view.W = Math.max(100, Math.round(r.width));
    view.H = Math.max(100, Math.round(r.height));
    view.dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(view.W * view.dpr);
    canvas.height = Math.round(view.H * view.dpr);
  }
  if (window.ResizeObserver) new ResizeObserver(resize).observe(stage);
  else window.addEventListener('resize', resize);

  let last = performance.now(), lastUi = 0;
  function frame(now) {
    const dt = (now - last) / 1000;
    last = now;
    if (S.running) {
      const n = P.clockTicks(clock, dt, SPEEDS[S.speedIdx], MAX_TICKS_PER_FRAME);
      for (let i = 0; i < n; i++) physicsTick();
    }
    // Drop faded-out marbles.
    for (let i = S.marbles.length - 1; i >= 0; i--) {
      const m = S.marbles[i];
      if (!m.alive && now - m.deathAt > 1500 && m !== S.selected) S.marbles.splice(i, 1);
    }
    updateCamera();
    const q = S.muFast ? 0.4 : 1;
    if (land.key !== landKey(q)) renderLandscape(q);
    draw(now);
    if (now - lastUi > 200) { lastUi = now; updateReadouts(); }
    requestAnimationFrame(frame);
  }

  // ---------- boot ----------
  setMu(S.mu);
  ui.mu.value = String(Math.round(muToSlider(S.mu)));
  setRunning(S.running);
  setSpeed(S.speedIdx);
  setTool(S.tool);
  setCoriolis(true);
  setView('rot');
  setFocus('system');
  renderMissions();
  resize();
  if (!reduceMotion) dropSwarm();
  // Small handle for scripted checks (screenshots, smoke tests). Not used by the page itself.
  window.HillApp = { S, view, setMu, setFocus, setView, setCoriolis, setTool, setSpeed, setRunning, dropSwarm, clearAll, addMarble, physicsTick, complete, renderLandscape, toScreen: (x, y) => toScreen(x, y, [0, 0]) };
  requestAnimationFrame((t) => { last = t; frame(t); });
})();
