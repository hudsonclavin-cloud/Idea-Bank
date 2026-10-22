// main.js — the table, the glasses, and your fingers.
(function (R) {
  'use strict';
  const { PRESETS, Rub, describePitch, MAX_FILL, clamp, Instrument, createEngine } = R;

  const RUB_KEYS = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK'];
  const TAP_KEYS = ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma'];
  const GHOST_RPS = 1.15; // how fast a held key's "ghost finger" circles
  const TAU = Math.PI * 2;

  // Glass proportions, in units of its rim radius.
  const P = { ry: 0.42, bowl: 1.45, stem: 0.95, foot: 0.64 };
  const GLASS_H = P.ry + P.bowl + P.stem + P.foot * P.ry;
  const LABEL_H = 34;

  const $ = (id) => document.getElementById(id);
  const canvas = $('stage');
  const g = canvas.getContext('2d');
  const intro = $('intro');
  const hint = $('hint');
  const tuningSel = $('tuning');

  const inst = new Instrument(PRESETS[0]);
  let actx = null;
  let started = false;
  let mode = 'play';
  let W = 0;
  let H = 0;
  let DPR = 1;
  let L = []; // per-glass layout
  let cellW = 0;
  const pointers = new Map(); // pointerId -> { kind: 'rub' | 'pour', glass, rub? }
  const ghosts = new Map(); // key code -> { glass, phase, rub }
  const drops = [];
  let everRubbed = false;

  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = motionQuery.matches;
  motionQuery.addEventListener?.('change', (e) => (reduced = e.matches));

  const audioTime = () => (actx ? actx.currentTime : 0);

  /* ---------- starting audio (only ever from a user gesture) ---------- */

  function start() {
    if (started) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      $('introFine').textContent = 'This browser has no Web Audio, so the glasses stay silent. You can still look.';
      return;
    }
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback'; // iOS: play even with the mute switch on
    } catch {
      /* not supported */
    }
    try {
      actx = new AC({ latencyHint: 'interactive' });
      inst.attach(createEngine(actx), actx.currentTime);
      if (actx.state !== 'running') actx.resume().catch(() => {});
    } catch (err) {
      actx = null;
      $('introFine').textContent = 'Could not start audio here (' + (err && err.message ? err.message : 'unknown error') + ').';
      return;
    }
    started = true;
    intro.classList.add('gone');
    setTimeout(() => (intro.hidden = true), 450);
  }
  intro.addEventListener('click', start);

  function wake() {
    if (actx && actx.state !== 'running') actx.resume().catch(() => {});
  }

  /* ---------- layout ---------- */

  function bowlHalf(t) {
    // Half-width of the bowl at height t (0 = bottom of bowl, 1 = rim), as a fraction of the rim radius:
    // round at the base, a slight belly, tucking in toward the rim like a tulip.
    const base = Math.sqrt(1 - Math.pow(1 - t, 2.2));
    return (0.07 + 0.93 * base) * (1 + 0.1 * Math.sin(Math.PI * t));
  }

  function layout() {
    W = window.innerWidth;
    H = window.innerHeight;
    DPR = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    const top = $('top').getBoundingClientRect().bottom + 10;
    const bottom = H - $('bar').getBoundingClientRect().top + 6;
    const availH = Math.max(180, H - top - bottom);
    const side = 10;
    const n = inst.glasses.length;
    const maxSize = Math.max(...inst.glasses.map((m) => m.size));
    // Try a single row first (the classic glass-harp line-up), else whichever grid gives the biggest rims.
    let best = null;
    for (const c of [8, 4, 3, 2]) {
      const rows = Math.ceil(n / c);
      const cw = (W - 2 * side) / c;
      const ch = availH / rows;
      const r = Math.min(((c === 8 ? 0.39 : 0.43) * cw) / maxSize, (ch - LABEL_H - 8) / (GLASS_H * maxSize), 64);
      if (c === 8 && r >= 40) {
        best = { c, r };
        break;
      }
      if (c !== 8 && (!best || r > best.r + 0.5)) best = { c, r };
    }
    const cols = best.c;
    const rx = Math.max(14, best.r);
    const rows = Math.ceil(n / cols);
    cellW = (W - 2 * side) / cols;
    const glassH = rx * maxSize * GLASS_H;
    const cellH = Math.min(availH / rows, glassH + LABEL_H + rx * 1.1);
    const y0 = top + (availH - cellH * rows) / 2;
    const reflLen = rows > 1 ? Math.min(cellH * 0.3, rx * 2) : rx * 2.2;
    L = inst.glasses.map((m, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const inRow = Math.min(cols, n - row * cols);
      const cellTop = y0 + cellH * row;
      const footY = cellTop + (cellH - glassH - LABEL_H) / 2 + glassH - P.foot * P.ry * rx * maxSize;
      const r = rx * m.size;
      const ry = r * P.ry;
      const bowlBottom = footY - P.stem * r;
      const bowlH = P.bowl * r;
      return {
        cx: side + cellW * (col + 0.5 + (cols - inRow) / 2),
        r,
        ry,
        footY,
        bowlBottom,
        bowlH,
        rimY: bowlBottom - bowlH,
        reflLen,
        row,
      };
    });
  }

  /* ---------- hit testing ---------- */

  function hitGlass(x, y) {
    let best = null;
    L.forEach((l, i) => {
      const u = (x - l.cx) / l.r;
      const v = (y - l.rimY) / l.ry;
      const rn = Math.hypot(u, v);
      const below = y - l.rimY;
      if (rn < 1.9 && below < l.bowlH * 0.42) {
        if (!best || rn < best.score) best = { i, zone: 'rim', score: rn };
      } else if (Math.abs(x - l.cx) < l.r * 1.12 && below >= l.bowlH * 0.42 && y <= l.footY + 12) {
        const score = 2 + Math.abs(x - l.cx) / l.r;
        if (!best || score < best.score) {
          best = { i, zone: 'bowl', score, bright: clamp(1.25 - (1.25 * below) / l.bowlH, 0.1, 1) };
        }
      }
    });
    return best;
  }

  function hitColumn(x, y) {
    let best = -1;
    let bd = Infinity;
    L.forEach((l, i) => {
      const dx = Math.abs(x - l.cx);
      if (dx < cellW / 2 && y > l.rimY - l.ry * 3 && y < l.footY + 26 && dx < bd) {
        bd = dx;
        best = i;
      }
    });
    return best;
  }

  const fillFromY = (i, y) => clamp((L[i].bowlBottom - y) / L[i].bowlH, 0, MAX_FILL);

  /* ---------- pointers ---------- */

  canvas.addEventListener('pointerdown', (e) => {
    if (!started) return;
    wake();
    closeHelp();
    const x = e.clientX;
    const y = e.clientY;
    if (mode === 'pour') {
      const i = hitColumn(x, y);
      if (i < 0) return;
      pointers.set(e.pointerId, { kind: 'pour', glass: i });
      inst.pourTo(i, fillFromY(i, y));
      markCustom();
    } else {
      const h = hitGlass(x, y);
      if (!h) return;
      if (h.zone === 'bowl') {
        const pressured = e.pointerType !== 'mouse' && e.pressure > 0 && e.pressure !== 0.5;
        inst.strike(h.i, pressured ? 0.45 + 0.55 * e.pressure : 0.82, h.bright, audioTime());
        return;
      }
      const l = L[h.i];
      pointers.set(e.pointerId, { kind: 'rub', glass: h.i, rub: new Rub((x - l.cx) / l.r, (y - l.rimY) / l.ry) });
    }
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointers can't always be captured */
    }
    e.preventDefault();
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const l = L[p.glass];
    if (p.kind === 'pour') {
      inst.pourTo(p.glass, fillFromY(p.glass, e.clientY));
      return;
    }
    const list = (e.getCoalescedEvents && e.getCoalescedEvents()) || [];
    for (const ev of list.length ? list : [e]) p.rub.move((ev.clientX - l.cx) / l.r, (ev.clientY - l.rimY) / l.ry);
  });

  function endPointer(e) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    pointers.delete(e.pointerId);
    if (p.kind === 'pour') inst.settle(p.glass);
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('lostpointercapture', endPointer);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  function releaseAll() {
    for (const p of pointers.values()) if (p.kind === 'pour') inst.settle(p.glass);
    pointers.clear();
    ghosts.clear();
  }
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      releaseAll();
      if (actx) {
        inst.silence(actx.currentTime);
        actx.suspend().catch(() => {});
      }
    } else if (started) {
      wake();
    }
  });

  /* ---------- keyboard ---------- */

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (!started) {
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        start();
      }
      return;
    }
    if (e.code === 'Escape') return closeHelp();
    if (e.target instanceof HTMLSelectElement) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) inst.hush(audioTime());
      return;
    }
    const ri = RUB_KEYS.indexOf(e.code);
    if (ri >= 0) {
      e.preventDefault();
      wake();
      if (!ghosts.has(e.code)) ghosts.set(e.code, { glass: ri, phase: Math.PI / 2, rub: new Rub(0, 1) });
      return;
    }
    const ti = TAP_KEYS.indexOf(e.code);
    if (ti >= 0) {
      e.preventDefault();
      wake();
      if (!e.repeat) inst.strike(ti, 0.8, 0.6, audioTime());
    }
  });
  window.addEventListener('keyup', (e) => ghosts.delete(e.code));

  /* ---------- controls ---------- */

  for (const p of PRESETS) tuningSel.add(new Option(p.name, p.id));
  tuningSel.add(new Option('Custom', 'custom'));
  tuningSel.options[tuningSel.options.length - 1].disabled = true;
  tuningSel.addEventListener('change', () => {
    const p = PRESETS.find((q) => q.id === tuningSel.value);
    if (p) inst.applyPreset(p);
    tuningSel.blur(); // otherwise the rub keys (A, S, …) would type-ahead through the tuning list
  });
  function markCustom() {
    tuningSel.value = 'custom';
  }

  function setMode(m) {
    mode = m;
    releaseAll();
    $('modePlay').setAttribute('aria-pressed', String(m === 'play'));
    $('modePour').setAttribute('aria-pressed', String(m === 'pour'));
    hint.innerHTML =
      m === 'play'
        ? 'Trace a rim in circles <span class="dot">·</span> tap a bowl <span class="dot">·</span> rest a finger to hush'
        : 'Drag the water <span class="dot">·</span> more water, lower note <span class="dot">·</span> let go to settle';
  }
  $('modePlay').addEventListener('click', () => setMode('play'));
  $('modePour').addEventListener('click', () => setMode('pour'));
  $('hush').addEventListener('click', () => inst.hush(audioTime()));

  const help = $('help');
  const helpBtn = $('helpBtn');
  function closeHelp() {
    if (help.hidden) return;
    help.hidden = true;
    helpBtn.setAttribute('aria-expanded', 'false');
  }
  helpBtn.addEventListener('click', () => {
    help.hidden = !help.hidden;
    helpBtn.setAttribute('aria-expanded', String(!help.hidden));
  });
  $('helpClose').addEventListener('click', closeHelp);

  /* ---------- drawing ---------- */

  function drawBackground() {
    g.fillStyle = '#0a0c11';
    g.fillRect(0, 0, W, H);
    const glow = g.createRadialGradient(W / 2, H * 0.08, 0, W / 2, H * 0.08, Math.max(W, H) * 0.75);
    glow.addColorStop(0, 'rgba(233, 178, 105, 0.13)');
    glow.addColorStop(0.5, 'rgba(120, 90, 60, 0.04)');
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, W, H);
    // A faint table edge under each row of glasses.
    const seen = new Set();
    for (const l of L) {
      if (seen.has(l.row)) continue;
      seen.add(l.row);
      const y = l.footY;
      const band = g.createLinearGradient(0, y - 6, 0, y + 46);
      band.addColorStop(0, 'rgba(255, 236, 205, 0)');
      band.addColorStop(0.14, 'rgba(255, 236, 205, 0.045)');
      band.addColorStop(1, 'rgba(255, 236, 205, 0)');
      g.fillStyle = band;
      g.fillRect(0, y - 6, W, 52);
    }
  }

  function bowlPath(l, fromT = 1) {
    // Left side from height fromT down to the base, then up the right side.
    const N = 22;
    g.beginPath();
    for (let k = 0; k <= N; k++) {
      const t = fromT * (1 - k / N);
      const x = l.cx - l.r * bowlHalf(t);
      const y = l.bowlBottom - t * l.bowlH;
      if (k === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    for (let k = 0; k <= N; k++) {
      const t = fromT * (k / N);
      g.lineTo(l.cx + l.r * bowlHalf(t), l.bowlBottom - t * l.bowlH);
    }
  }

  function rimPath(l, m, now) {
    const eps = reduced ? 0 : 0.05 * m.amp * Math.sin((now / 1000) * TAU * 5.5);
    const N = 56;
    g.beginPath();
    for (let k = 0; k <= N; k++) {
      const phi = (k / N) * TAU;
      const rr = 1 + eps * Math.cos(2 * (phi - m.angle));
      const x = l.cx + l.r * rr * Math.cos(phi);
      const y = l.rimY + l.ry * rr * Math.sin(phi);
      if (k === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
  }

  /** A faint mirror image on the polished table, fading with distance. */
  function drawReflection(i) {
    const l = L[i];
    const m = inst.glasses[i];
    const lit = Math.min(1, m.amp + m.flash * 0.8);
    g.save();
    g.translate(0, 2 * l.footY);
    g.scale(1, -1);
    const fade = (r, gg, b, a) => {
      const gr = g.createLinearGradient(0, l.footY, 0, l.footY - l.reflLen);
      gr.addColorStop(0, `rgba(${r}, ${gg}, ${b}, ${a})`);
      gr.addColorStop(0.5, `rgba(${r}, ${gg}, ${b}, ${a * 0.35})`);
      gr.addColorStop(1, `rgba(${r}, ${gg}, ${b}, 0)`);
      return gr;
    };
    const sw = Math.max(2, l.r * 0.075);
    g.fillStyle = fade(215, 226, 248, 0.14);
    g.fillRect(l.cx - sw / 2, l.bowlBottom, sw, l.footY - l.bowlBottom);
    if (m.fill > 0.01) {
      bowlPath(l, m.fill);
      g.closePath();
      g.fillStyle = fade(90, 140, 175, 0.2);
      g.fill();
    }
    bowlPath(l);
    g.strokeStyle = lit > 0.01 ? fade(255, 214, 160, 0.1 + 0.25 * lit) : fade(222, 232, 250, 0.16);
    g.lineWidth = 1.2;
    g.stroke();
    g.restore();
  }

  function drawGlass(i, now) {
    const l = L[i];
    const m = inst.glasses[i];
    const amp = m.amp;
    const t = now / 1000;
    const lit = Math.min(1, amp + m.flash * 0.8);

    // Shadow on the table.
    g.fillStyle = 'rgba(0, 0, 0, 0.35)';
    g.beginPath();
    g.ellipse(l.cx + l.r * 0.12, l.footY + 3, l.r * P.foot * 1.25, l.r * P.foot * P.ry * 0.9, 0, 0, TAU);
    g.fill();

    // Warm glow while it sings.
    if (lit > 0.004) {
      g.globalCompositeOperation = 'lighter';
      const cy = l.rimY + l.bowlH * 0.3;
      const rad = l.r * 2.3;
      const gl = g.createRadialGradient(l.cx, cy, 0, l.cx, cy, rad);
      gl.addColorStop(0, `rgba(255, 208, 140, ${0.2 * lit})`);
      gl.addColorStop(0.45, `rgba(255, 180, 110, ${0.07 * lit})`);
      gl.addColorStop(1, 'rgba(255, 170, 100, 0)');
      g.fillStyle = gl;
      g.fillRect(l.cx - rad, cy - rad, rad * 2, rad * 2);
      g.globalCompositeOperation = 'source-over';
    }

    // Glass body.
    const body = g.createLinearGradient(l.cx - l.r, 0, l.cx + l.r, 0);
    body.addColorStop(0, 'rgba(210, 222, 245, 0.10)');
    body.addColorStop(0.35, 'rgba(210, 222, 245, 0.03)');
    body.addColorStop(1, 'rgba(210, 222, 245, 0.07)');
    bowlPath(l);
    g.ellipse(l.cx, l.rimY, l.r, l.ry, 0, 0, Math.PI, true); // over the far side of the rim
    g.closePath();
    g.fillStyle = body;
    g.fill();

    // Water.
    const wy = l.bowlBottom - m.fill * l.bowlH;
    const wr = l.r * bowlHalf(m.fill);
    const wry = wr * P.ry;
    if (m.fill > 0.01) {
      const wg = g.createLinearGradient(0, wy, 0, l.bowlBottom);
      wg.addColorStop(0, 'rgba(120, 175, 205, 0.30)');
      wg.addColorStop(1, 'rgba(70, 120, 160, 0.40)');
      bowlPath(l, m.fill);
      g.ellipse(l.cx, wy, wr, wry, 0, 0, Math.PI); // back along the near edge of the surface
      g.closePath();
      g.fillStyle = wg;
      g.fill();
      g.beginPath();
      g.ellipse(l.cx, wy, wr, wry, 0, 0, TAU);
      g.fillStyle = 'rgba(165, 210, 232, 0.22)';
      g.fill();
      g.strokeStyle = 'rgba(190, 228, 245, 0.35)';
      g.lineWidth = 1;
      g.stroke();
      if (amp > 0.02) drawRipples(l, m, wy, wr, wry, t);
    }

    // Bowl outline and a highlight streak.
    bowlPath(l);
    g.strokeStyle = `rgba(222, 232, 250, ${0.36 + 0.25 * lit})`;
    g.lineWidth = 1.3;
    g.stroke();
    g.beginPath();
    g.moveTo(l.cx - l.r * 0.74, l.rimY + l.bowlH * 0.16);
    g.quadraticCurveTo(l.cx - l.r * 0.86, l.rimY + l.bowlH * 0.5, l.cx - l.r * 0.5, l.rimY + l.bowlH * 0.82);
    g.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    g.lineWidth = Math.max(1.5, l.r * 0.05);
    g.lineCap = 'round';
    g.stroke();

    // Stem and foot.
    const sw = Math.max(2, l.r * 0.075);
    g.fillStyle = 'rgba(215, 226, 248, 0.22)';
    g.fillRect(l.cx - sw / 2, l.bowlBottom - 1, sw, l.footY - l.bowlBottom + 1);
    g.beginPath();
    g.ellipse(l.cx, l.footY, l.r * P.foot, l.r * P.foot * P.ry, 0, 0, TAU);
    g.fillStyle = 'rgba(205, 218, 245, 0.08)';
    g.fill();
    g.strokeStyle = 'rgba(222, 232, 250, 0.34)';
    g.lineWidth = 1.2;
    g.stroke();

    // Rim: a deformed ellipse when it sings (the (2,0) mode, exaggerated), following the finger.
    rimPath(l, m, now);
    g.strokeStyle = `rgba(236, 241, 252, ${0.55 + 0.3 * lit})`;
    g.lineWidth = 1.4;
    g.stroke();
    if (lit > 0.01) {
      g.strokeStyle = `rgba(255, 214, 150, ${0.5 * lit})`;
      g.lineWidth = 2 + 4 * lit;
      g.stroke();
      g.strokeStyle = `rgba(255, 236, 200, ${0.75 * lit})`;
      g.lineWidth = 1.6;
      g.stroke();
    }

    // Nodes of the singing mode: four still points, 45° from the finger.
    if (amp > 0.05) {
      g.fillStyle = `rgba(255, 255, 255, ${Math.min(0.9, amp * 1.2)})`;
      for (let k = 0; k < 4; k++) {
        const phi = m.angle + Math.PI / 4 + (k * Math.PI) / 2;
        g.beginPath();
        g.arc(l.cx + l.r * Math.cos(phi), l.rimY + l.ry * Math.sin(phi), 1.8, 0, TAU);
        g.fill();
      }
    }

    // Pour handle.
    if (mode === 'pour') {
      const hx = l.cx + Math.max(wr, l.r * 0.25) + 9;
      g.fillStyle = 'rgba(233, 201, 143, 0.85)';
      g.beginPath();
      g.moveTo(hx, wy);
      g.lineTo(hx + 8, wy - 5);
      g.lineTo(hx + 8, wy + 5);
      g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(233, 201, 143, 0.25)';
      g.setLineDash([2, 4]);
      g.beginPath();
      g.moveTo(hx + 4, l.bowlBottom);
      g.lineTo(hx + 4, l.bowlBottom - MAX_FILL * l.bowlH);
      g.stroke();
      g.setLineDash([]);
    }

    // Label.
    const d = describePitch(m.freq);
    g.textAlign = 'center';
    g.textBaseline = 'top';
    g.font = '500 13px system-ui, -apple-system, sans-serif';
    g.fillStyle = amp > 0.05 || m.flash > 0.1 ? '#f3d9a6' : 'rgba(214, 220, 232, 0.62)';
    const ly = l.footY + l.r * P.foot * P.ry + 8;
    g.fillText(d.name, l.cx, ly);
    if (mode === 'pour' || Math.abs(d.cents) >= 3) {
      g.font = '11px system-ui, -apple-system, sans-serif';
      g.fillStyle = 'rgba(160, 170, 188, 0.75)';
      const c = d.cents === 0 ? '' : (d.cents > 0 ? ' +' : ' −') + Math.abs(d.cents) + '¢';
      g.fillText(mode === 'pour' ? Math.round(m.freq) + ' Hz' + c : c.trim(), l.cx, ly + 16);
    }
  }

  function drawRipples(l, m, wy, wr, wry, t) {
    // Standing ripples on the water bunch up at the four antinodes of the singing mode,
    // which is what you actually see in a loudly-ringing glass.
    g.save();
    g.beginPath();
    g.ellipse(l.cx, wy, wr, wry, 0, 0, TAU);
    g.clip();
    const a = Math.min(1, m.amp);
    g.lineWidth = 1;
    for (let k = 0; k < 4; k++) {
      const phi = m.angle + (k * Math.PI) / 2;
      const px = l.cx + wr * 0.96 * Math.cos(phi);
      const py = wy + wry * 0.96 * Math.sin(phi);
      for (let j = 0; j < 3; j++) {
        const ph = reduced ? j / 3 : (j / 3 + t * 1.6) % 1;
        const rad = wr * (0.08 + 0.32 * ph);
        g.strokeStyle = `rgba(225, 242, 255, ${0.55 * a * (1 - ph)})`;
        g.beginPath();
        g.ellipse(px, py, rad, rad * P.ry, 0, 0, TAU);
        g.stroke();
      }
    }
    g.restore();
    // Droplets thrown up when it is driven hard.
    if (!reduced && m.amp > 0.72 && drops.length < 140 && Math.random() < (m.amp - 0.72) * 2.2) {
      const phi = m.angle + (Math.floor(Math.random() * 4) * Math.PI) / 2;
      const s = l.r / 50;
      drops.push({
        x: l.cx + wr * 0.9 * Math.cos(phi),
        y: wy + wry * 0.9 * Math.sin(phi),
        y0: wy + wry * 0.9 * Math.sin(phi),
        vx: (Math.random() - 0.5) * 20 * s,
        vy: -(50 + Math.random() * 70) * s,
        gy: 420 * s,
      });
    }
  }

  function drawDrops(dt) {
    g.fillStyle = 'rgba(215, 238, 255, 0.8)';
    for (let k = drops.length - 1; k >= 0; k--) {
      const d = drops[k];
      d.vy += d.gy * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (d.y > d.y0 + 0.5 || reduced) {
        drops.splice(k, 1);
        continue;
      }
      g.beginPath();
      g.arc(d.x, d.y, 1.2, 0, TAU);
      g.fill();
    }
  }

  function drawFinger(l, rub, ghost) {
    const pt = (phi) => [l.cx + l.r * Math.cos(phi), l.rimY + l.ry * Math.sin(phi)];
    const tr = rub.trail;
    if (tr.length > 1) {
      g.lineCap = 'round';
      for (let k = 1; k < tr.length; k++) {
        let a0 = tr[k - 1];
        let a1 = tr[k];
        let d = a1 - a0;
        if (d > Math.PI) d -= TAU;
        else if (d < -Math.PI) d += TAU;
        if (Math.abs(d) < 1e-3) continue;
        g.strokeStyle = `rgba(255, 224, 170, ${(0.5 * k) / tr.length})`;
        g.lineWidth = 2 + (2 * k) / tr.length;
        g.beginPath();
        g.ellipse(l.cx, l.rimY, l.r, l.ry, 0, a0, a0 + d, d < 0);
        g.stroke();
      }
    }
    const [x, y] = pt(rub.theta);
    g.fillStyle = ghost ? 'rgba(255, 226, 175, 0.55)' : 'rgba(255, 232, 190, 0.9)';
    g.beginPath();
    g.arc(x, y, ghost ? 4 : 5, 0, TAU);
    g.fill();
  }

  let demoPhase = Math.PI / 2;
  function drawOnboarding(dt) {
    if (everRubbed || mode !== 'play' || !L.length) return;
    const l = L[Math.min(2, L.length - 1)];
    if (!reduced) demoPhase += dt * TAU * 0.55;
    const span = reduced ? Math.PI * 1.2 : Math.PI * 0.9;
    const a1 = demoPhase;
    const a0 = a1 - span;
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(255, 224, 170, 0.45)';
    g.lineWidth = 2.5;
    g.setLineDash([1, 7]);
    g.beginPath();
    g.ellipse(l.cx, l.rimY, l.r * 1.0, l.ry * 1.0, 0, a0, a1);
    g.stroke();
    g.setLineDash([]);
    const x = l.cx + l.r * Math.cos(a1);
    const y = l.rimY + l.ry * Math.sin(a1);
    g.fillStyle = 'rgba(255, 230, 185, 0.85)';
    g.beginPath();
    g.arc(x, y, 6, 0, TAU);
    g.fill();
    g.strokeStyle = 'rgba(255, 230, 185, 0.35)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(x, y, 11, 0, TAU);
    g.stroke();
  }

  function draw(now, dt) {
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawBackground();
    for (let i = 0; i < L.length; i++) drawReflection(i);
    for (let i = 0; i < L.length; i++) drawGlass(i, now);
    drawDrops(dt);
    for (const p of pointers.values()) if (p.kind === 'rub') drawFinger(L[p.glass], p.rub, false);
    for (const gh of ghosts.values()) drawFinger(L[gh.glass], gh.rub, true);
    drawOnboarding(dt);
  }

  /* ---------- main loop ---------- */

  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, Math.max(0.001, (now - lastT) / 1000));
    lastT = now;
    const contacts = [];
    for (const p of pointers.values()) {
      if (p.kind !== 'rub') continue;
      const c = p.rub.frame(dt);
      (contacts[p.glass] ||= []).push(c);
      if (c.drive > 0.35) everRubbed = true;
    }
    for (const gh of ghosts.values()) {
      gh.phase += GHOST_RPS * TAU * dt;
      gh.rub.move(Math.cos(gh.phase), Math.sin(gh.phase));
      const c = gh.rub.frame(dt);
      (contacts[gh.glass] ||= []).push(c);
      if (c.drive > 0.35) everRubbed = true;
    }
    inst.tick(dt, audioTime(), contacts);
    draw(now, dt);
    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', layout);
  layout();
  requestAnimationFrame(frame);

  // Read-only hook for automated checks (layout + model state).
  window.__rimsong = {
    inst,
    get audio() {
      return actx ? actx.state : 'none';
    },
    layout: () => L,
  };
})((window.Rimsong = window.Rimsong || {}));
