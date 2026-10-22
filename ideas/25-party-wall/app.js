// Party Wall — the page. Draws the wall, plays the knocks, forwards your taps to wall.js.
// Nothing here decides *when* anything happens; that is all in the state machine.
(() => {
  'use strict';
  const PW = globalThis.PartyWall;
  const canvas = document.getElementById('wall');
  const ctx = canvas.getContext('2d', { alpha: false });
  const hint = document.getElementById('hint');
  const endBox = document.getElementById('end');
  const againBtn = document.getElementById('again');
  const mqReduce = matchMedia('(prefers-reduced-motion: reduce)');
  const mqDark = matchMedia('(prefers-color-scheme: dark)');

  const PALETTES = {
    light: {
      wall: [233, 227, 216],
      grainDark: [92, 76, 58],
      grainLight: [255, 253, 246],
      vignette: [72, 52, 32],
      vignetteA: 0.2,
      skirt: [216, 208, 195],
      skirtShadow: [110, 90, 70],
      you: [92, 60, 30], // a warm pressure-shadow where your hand lands
      them: [58, 84, 122], // a cool bloom from behind the plaster
      warm: [255, 206, 120],
      endWall: [246, 238, 222],
      endA: 0.55,
    },
    dark: {
      wall: [28, 26, 24],
      grainDark: [0, 0, 0],
      grainLight: [255, 238, 214],
      vignette: [0, 0, 0],
      vignetteA: 0.45,
      skirt: [21, 19, 17],
      skirtShadow: [0, 0, 0],
      you: [255, 176, 92],
      them: [128, 164, 224],
      warm: [255, 230, 190],
      endWall: [54, 48, 42],
      endA: 0.6,
    },
  };

  let W = 0;
  let H = 0;
  let dpr = 1;
  let base = null;
  let pal = PALETTES.light;
  let reduce = mqReduce.matches;

  let wall = null;
  let seed = null;
  let pulses = [];
  let glow = { x: 0.5, y: 0.5, level: 0, target: 0 };
  let endMix = 0;
  let endedAt = null;
  let lastPos = { x: 0.5, y: 0.5 };
  let knocked = false;
  let againTimer = null;

  // ---------- the wall ----------
  function rgba(c, a) {
    return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  }

  function makeBase() {
    pal = mqDark.matches ? PALETTES.dark : PALETTES.light;
    base = document.createElement('canvas');
    base.width = Math.max(1, Math.round(W * dpr));
    base.height = Math.max(1, Math.round(H * dpr));
    const b = base.getContext('2d');
    b.scale(dpr, dpr);
    b.fillStyle = rgba(pal.wall, 1);
    b.fillRect(0, 0, W, H);

    // The same wall every time; only the neighbour changes with the seed.
    const r = PW.rng(7);
    const big = Math.max(W, H);
    for (let i = 0; i < 70; i++) {
      const x = r() * W;
      const y = r() * H;
      const rad = big * (0.05 + r() * 0.3);
      const c = r() < 0.5 ? pal.grainDark : pal.grainLight;
      const a = 0.015 + r() * 0.035;
      const g = b.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, rgba(c, a));
      g.addColorStop(1, rgba(c, 0));
      b.fillStyle = g;
      b.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    // Speckle, as a small tiled pattern laid down in device pixels so it stays fine on 2× screens
    // (tiles of speckle do not read as tiles).
    const tile = document.createElement('canvas');
    tile.width = 160;
    tile.height = 160;
    const tc = tile.getContext('2d');
    const img = tc.createImageData(160, 160);
    const sr = PW.rng(11);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = sr();
      let a = 0;
      let c = pal.grainDark;
      if (v < 0.05) {
        a = 10 + sr() * 26;
      } else if (v < 0.1) {
        a = 8 + sr() * 24;
        c = pal.grainLight;
      }
      img.data[i] = c[0];
      img.data[i + 1] = c[1];
      img.data[i + 2] = c[2];
      img.data[i + 3] = mqDark.matches ? a * 0.5 : a;
    }
    tc.putImageData(img, 0, 0);
    b.save();
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.fillStyle = b.createPattern(tile, 'repeat');
    b.fillRect(0, 0, base.width, base.height);
    b.restore();

    // Light from somewhere off to the upper left.
    const lg = b.createLinearGradient(0, 0, W, H);
    lg.addColorStop(0, rgba(pal.grainLight, mqDark.matches ? 0.07 : 0.18));
    lg.addColorStop(0.6, rgba(pal.grainLight, 0));
    b.fillStyle = lg;
    b.fillRect(0, 0, W, H);

    // Vignette.
    const vg = b.createRadialGradient(W * 0.5, H * 0.45, Math.min(W, H) * 0.25, W * 0.5, H * 0.5, big * 0.75);
    vg.addColorStop(0, rgba(pal.vignette, 0));
    vg.addColorStop(1, rgba(pal.vignette, pal.vignetteA));
    b.fillStyle = vg;
    b.fillRect(0, 0, W, H);

    // Skirting board along the bottom, so it is a wall and not a page.
    const sy = Math.round(H * 0.9);
    b.fillStyle = rgba(pal.skirt, 1);
    b.fillRect(0, sy, W, H - sy);
    const sh = b.createLinearGradient(0, sy - 6, 0, sy);
    sh.addColorStop(0, rgba(pal.skirtShadow, 0));
    sh.addColorStop(1, rgba(pal.skirtShadow, 0.22));
    b.fillStyle = sh;
    b.fillRect(0, sy - 6, W, 6);
    b.fillStyle = rgba(pal.grainLight, mqDark.matches ? 0.08 : 0.5);
    b.fillRect(0, sy + 1, W, 1);
    b.fillStyle = rgba(pal.skirtShadow, 0.18);
    b.fillRect(0, sy + 5, W, 1);
  }

  function resize() {
    W = Math.max(1, window.innerWidth);
    H = Math.max(1, window.innerHeight);
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    makeBase();
  }

  // ---------- drawing ----------
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function mixColor(a, b, t) {
    return [Math.round(lerp(a[0], b[0], t)), Math.round(lerp(a[1], b[1], t)), Math.round(lerp(a[2], b[2], t))];
  }
  function easeOut(t) {
    return 1 - (1 - t) * (1 - t);
  }

  function softDisc(x, y, r, color, a) {
    if (a <= 0.002) return;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(color, a));
    g.addColorStop(0.3, rgba(color, a * 0.55));
    g.addColorStop(0.65, rgba(color, a * 0.16));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  function draw(now) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.drawImage(base, 0, 0, W, H);

    // The wall after the end: a touch lighter, and it stays that way.
    if (endMix > 0) {
      ctx.fillStyle = rgba(pal.endWall, endMix * pal.endA);
      ctx.fillRect(0, 0, W, H);
    }

    // Warmth that gathers where the two of you are knocking together.
    if (glow.level > 0.002) {
      const r = Math.min(W, H) * (0.22 + 0.22 * glow.level);
      softDisc(glow.x * W, glow.y * H, r, pal.warm, glow.level * (mqDark.matches ? 0.5 : 0.6));
    }

    const unit = Math.min(W, H);
    const keep = [];
    for (const p of pulses) {
      const age = now - p.t0;
      const x = p.x * W;
      const y = p.y * H;
      if (p.who === 'you') {
        const dur = reduce ? 360 : 520;
        if (age > dur) continue;
        const k = age / dur;
        const r = reduce ? unit * 0.075 : unit * (0.045 + 0.06 * easeOut(k));
        softDisc(x, y, r, pal.you, (1 - k) * (mqDark.matches ? 0.5 : 0.42));
        if (!reduce && age < 140) {
          ctx.strokeStyle = rgba(pal.you, (1 - age / 140) * 0.45);
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(x, y, unit * (0.05 + 0.06 * (age / 140)), 0, Math.PI * 2);
          ctx.stroke();
        }
      } else {
        const dur = reduce ? 1000 : 1200;
        if (age > dur) continue;
        const rise = 90;
        const k = age < rise ? age / rise : 1 - (age - rise) / (dur - rise);
        const c = p.clarity;
        const r = unit * lerp(0.2, 0.1, c) * (reduce ? 1 : 1 + 0.08 * (age / dur));
        const color = mixColor(pal.them, pal.warm, c);
        const a = easeOut(k) * (0.28 + 0.5 * c) * (0.55 + 0.45 * p.gain) * (mqDark.matches ? 1 : 0.7);
        softDisc(x, y, r, color, a);
      }
      keep.push(p);
    }
    pulses = keep;
  }

  // ---------- sound ----------
  let ac = null;
  let master = null;
  let room = null;
  let noiseBuf = null;

  function makeIR(seconds, decay) {
    const n = Math.floor(ac.sampleRate * seconds);
    const buf = ac.createBuffer(2, n, ac.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
    }
    return buf;
  }

  function ensureAudio() {
    if (ac) {
      if (ac.state === 'suspended') ac.resume().catch(() => {});
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      ac = new AC({ latencyHint: 'interactive' });
    } catch {
      ac = null;
      return;
    }
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
    } catch {
      /* optional */
    }
    master = ac.createGain();
    master.gain.value = 0.9;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.002;
    comp.release.value = 0.12;
    master.connect(comp);
    comp.connect(ac.destination);
    room = ac.createConvolver();
    room.buffer = makeIR(0.45, 3.2);
    const roomGain = ac.createGain();
    roomGain.gain.value = 0.2;
    room.connect(roomGain);
    roomGain.connect(master);
    const n = Math.floor(ac.sampleRate * 0.08);
    noiseBuf = ac.createBuffer(1, n, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    if (ac.state === 'suspended') ac.resume().catch(() => {});
  }

  // A knock: a short thump (sine sweeping down) and a knuckle click (band-passed noise).
  // Theirs goes through a low-pass filter — the wall — that opens as the two of you fall in step.
  function playKnock(ev, retried) {
    if (!ac) return;
    if (ac.state !== 'running') {
      // The very first knock arrives while the context is still waking up (iOS especially).
      if (!retried && ac.state === 'suspended') ac.resume().then(() => playKnock(ev, true)).catch(() => {});
      return;
    }
    const them = ev.who === 'them';
    const c = them ? ev.clarity : 1;
    const when = Math.max(ac.currentTime, ac.currentTime + (ev.t - performance.now()) / 1000);
    const out = ac.createGain();
    out.gain.value = ev.gain * (them ? 0.95 : 0.75);
    let node = out;
    if (them) {
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 280 * Math.pow(2, c * 3.8); // 280 Hz through the wall, ~3.9 kHz clear
      lp.Q.value = 0.7;
      out.connect(lp);
      node = lp;
    }
    if (ac.createStereoPanner) {
      const pan = ac.createStereoPanner();
      pan.pan.value = them ? 0.4 * (1 - c) : 0;
      node.connect(pan);
      node = pan;
    }
    node.connect(master);
    const wet = ac.createGain();
    wet.gain.value = them ? 0.9 - 0.4 * c : 0.45;
    node.connect(wet);
    wet.connect(room);

    const f0 = them ? lerp(80, 115, c) : 118;
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f0 * 1.7, when);
    osc.frequency.exponentialRampToValueAtTime(f0 * 0.55, when + 0.1);
    const oe = ac.createGain();
    oe.gain.setValueAtTime(0.0001, when);
    oe.gain.linearRampToValueAtTime(1, when + 0.004);
    oe.gain.exponentialRampToValueAtTime(0.0005, when + (them ? 0.2 : 0.16));
    osc.connect(oe);
    oe.connect(out);
    osc.start(when);
    osc.stop(when + 0.24);

    const body = ac.createOscillator();
    body.type = 'triangle';
    body.frequency.value = them ? 190 : 260;
    const be = ac.createGain();
    be.gain.setValueAtTime(0.0001, when);
    be.gain.linearRampToValueAtTime(0.35, when + 0.003);
    be.gain.exponentialRampToValueAtTime(0.0005, when + 0.07);
    body.connect(be);
    be.connect(out);
    body.start(when);
    body.stop(when + 0.1);

    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = them ? 900 : 1500;
    bp.Q.value = 0.8;
    const ne = ac.createGain();
    ne.gain.setValueAtTime(0.7, when);
    ne.gain.exponentialRampToValueAtTime(0.0005, when + 0.03);
    src.connect(bp);
    bp.connect(ne);
    ne.connect(out);
    src.start(when);
    src.stop(when + 0.06);

    osc.onended = () => {
      try {
        out.disconnect();
        node.disconnect();
        wet.disconnect();
      } catch {
        /* already gone */
      }
    };
  }

  // ---------- events from the machine ----------
  function handle(events, silent) {
    const now = performance.now();
    for (const ev of events) {
      if (ev.type === 'knock') {
        if (ev.who === 'you') {
          lastPos = { x: ev.x, y: ev.y };
          if (!knocked) {
            knocked = true;
            hint.classList.remove('show');
          }
        }
        if (!silent) {
          pulses.push({ who: ev.who, x: ev.x, y: ev.y, t0: Math.max(now - 1, Math.min(now, ev.t)), clarity: ev.clarity, gain: ev.gain });
          playKnock(ev);
          if (ev.who === 'them' && navigator.vibrate) {
            try {
              navigator.vibrate(ev.clarity >= 1 ? 22 : 12);
            } catch {
              /* optional */
            }
          }
        }
      } else if (ev.type === 'match') {
        glow.x = lastPos.x;
        glow.y = lastPos.y;
        glow.target = Math.min(1, ev.streak / PW.T.MATCHES_TO_END);
      } else if (ev.type === 'beat') {
        if (!ev.matched) glow.target = 0;
      } else if (ev.type === 'end') {
        endedAt = now;
        glow.target = 1;
        clearTimeout(againTimer);
        againTimer = setTimeout(showAgain, 5000);
      }
    }
  }

  function showAgain() {
    endBox.hidden = false;
    // next frame, so the transition runs
    requestAnimationFrame(() => endBox.classList.add('show'));
  }

  function knockAt(x, y) {
    ensureAudio();
    handle(wall.knock(performance.now(), x, y), false);
  }

  function reset() {
    const u = new URL(location.href);
    seed = u.searchParams.has('seed') ? PW.hashSeed(u.searchParams.get('seed')) : (Math.random() * 4294967296) >>> 0;
    wall = PW.createWall({ seed });
    pulses = [];
    glow = { x: 0.5, y: 0.5, level: 0, target: 0 };
    endMix = 0;
    endedAt = null;
    clearTimeout(againTimer);
    endBox.classList.remove('show');
    endBox.hidden = true;
    knocked = false;
    hint.classList.add('show');
  }

  // ---------- loop ----------
  let lastFrame = performance.now();
  function frame() {
    const now = performance.now();
    const dt = Math.min(100, now - lastFrame);
    lastFrame = now;
    handle(wall.step(now), false);
    // Ease the slow things.
    const rate = 1 - Math.pow(0.001, dt / (reduce ? 1200 : 900));
    glow.level += (glow.target - glow.level) * rate;
    if (endedAt != null) endMix = Math.min(1, (now - endedAt) / 2600);
    draw(now);
    requestAnimationFrame(frame);
  }

  // ---------- input ----------
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    knockAt(e.clientX / W, e.clientY / H);
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.target === againBtn) return;
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      knockAt(lastPos.x, lastPos.y);
    }
  });
  againBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (!endBox.hidden) reset();
  });
  window.addEventListener('resize', resize);
  mqDark.addEventListener('change', makeBase);
  mqReduce.addEventListener('change', () => {
    reduce = mqReduce.matches;
  });
  document.addEventListener('visibilitychange', () => {
    // After a stretch in the background, catch the machine up without replaying a pile of knocks.
    if (!document.hidden) handle(wall.step(performance.now()), true);
  });

  reset();
  resize();
  requestAnimationFrame(frame);

  // For the headless play-through, not for play.
  globalThis.PartyWallApp = {
    get wall() {
      return wall;
    },
    get seed() {
      return seed;
    },
    knockAt,
    reset,
    get audio() {
      return ac ? ac.state : 'none';
    },
  };
})();
