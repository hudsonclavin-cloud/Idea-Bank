// After You — the page: the glass, the fingers, the sound, and the screens around each round.
//
// The rules and the measurement are in mirror.js. This file keeps the game state private and
// draws only from AfterYou.view(game), which hides each order until its owner holds their card
// and every answer until the reveal (mirror.test.mjs checks that this file reads nothing else).
(function () {
  'use strict';
  const Y = window.AfterYou;
  const C = Y.C;
  const NAMES = Y.NAMES;
  const FIELD = new Set(['deal', 'countdown', 'play', 'guess']);

  const $ = (id) => document.getElementById(id);
  const screenEl = $('screen');
  const wrap = $('field-wrap');
  const canvas = $('field');
  const ctx = canvas.getContext('2d');
  const halves = [$('half0'), $('half1')];
  const beginBtn = $('begin');
  const quitBtn = $('quit');
  const announceEl = $('announce');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const dark = matchMedia('(prefers-color-scheme: dark)');

  // ------------------------------------------------------------ settings (this viewer only)
  const settings = { seat: 'auto', sound: true };
  try {
    const s = JSON.parse(localStorage.getItem('after-you') || '{}');
    if (['auto', 'facing', 'side'].includes(s.seat)) settings.seat = s.seat;
    if (typeof s.sound === 'boolean') settings.sound = s.sound;
  } catch (e) {
    /* storage unavailable: defaults */
  }
  function saveSettings() {
    try {
      localStorage.setItem('after-you', JSON.stringify(settings));
    } catch (e) {
      /* ignore */
    }
  }

  // ------------------------------------------------------------ the game (private)
  let game = Y.newGame();
  let view = Y.view(game);

  function rand4() {
    const a = new Uint32Array(4);
    crypto.getRandomValues(a);
    return Array.from(a);
  }
  function dispatch(action) {
    const next = Y.act(game, action);
    if (next === game) return false;
    const before = view;
    game = next;
    view = Y.view(game);
    changed(before, view);
    return true;
  }

  // ------------------------------------------------------------ geometry
  // The mirror frame: x along the mirror line, y away from it, in CSS px, the same for both players.
  let geom = null;
  const R = 22; // keep dots this far inside their half
  // The seating is chosen when the glass comes up and kept until it goes down, so turning a phone
  // mid-round resizes the halves but never swaps which way the mirror runs.
  let lockedMode = null;
  function seatMode() {
    if (lockedMode) return lockedMode;
    if (settings.seat !== 'auto') return settings.seat;
    return innerHeight >= innerWidth ? 'facing' : 'side';
  }
  function measure() {
    const W = Math.max(1, wrap.clientWidth || innerWidth);
    const H = Math.max(1, wrap.clientHeight || innerHeight);
    const mode = seatMode();
    const Lu = mode === 'facing' ? W : H;
    const Lv = mode === 'facing' ? H / 2 : W / 2;
    geom = { mode, W, H, Lu, Lv, scale: Math.min(Lu, Lv) };
    document.body.classList.toggle('facing', mode === 'facing');
    document.body.classList.toggle('side', mode === 'side');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    for (const p of [0, 1]) if (pos[p]) pos[p] = clampPt(pos[p]);
  }
  function toScreen(p, pt) {
    const g = geom;
    if (g.mode === 'facing') return { x: pt.x, y: p === 0 ? g.H / 2 + pt.y : g.H / 2 - pt.y };
    return { x: p === 0 ? g.W / 2 - pt.y : g.W / 2 + pt.y, y: pt.x };
  }
  function fromScreen(p, x, y) {
    const g = geom;
    if (g.mode === 'facing') return { x, y: p === 0 ? y - g.H / 2 : g.H / 2 - y };
    return { x: y, y: p === 0 ? g.W / 2 - x : x - g.W / 2 };
  }
  function playerAt(x, y) {
    return geom.mode === 'facing' ? (y >= geom.H / 2 ? 0 : 1) : x < geom.W / 2 ? 0 : 1;
  }
  function clampPt(pt) {
    return {
      x: Math.min(geom.Lu - R, Math.max(R, pt.x)),
      y: Math.min(geom.Lv - R, Math.max(R, pt.y)),
    };
  }
  function startPt() {
    return { x: geom.Lu / 2, y: geom.Lv * 0.3 };
  }

  // ------------------------------------------------------------ hands
  const pos = [null, null];
  const fingers = [null, null]; // { id, ox, oy }: dot = finger + offset, so a dot never jumps to a finger
  const keys = new Set();
  const keyVel = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ];
  const trails = [[], []];
  let rec = null; // the round being recorded: { tr, next }
  let heldNow = false;
  let glow = 0;
  let fog = 0;
  let lastHeldAt = 0;

  function resetDots() {
    const s = startPt();
    pos[0] = { ...s };
    pos[1] = { ...s };
    trails[0].length = 0;
    trails[1].length = 0;
  }
  function canMove() {
    return game.phase === 'deal' || game.phase === 'play';
  }
  function fingerOf(id) {
    return fingers[0] && fingers[0].id === id ? 0 : fingers[1] && fingers[1].id === id ? 1 : -1;
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (!FIELD.has(game.phase) || !geom) return;
    const p = playerAt(e.clientX, e.clientY);
    if (fingers[p]) return; // one finger per player; a second one in the same half is ignored
    e.preventDefault();
    const m = fromScreen(p, e.clientX, e.clientY);
    fingers[p] = { id: e.pointerId, ox: pos[p].x - m.x, oy: pos[p].y - m.y, fx: m.x, fy: m.y };
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (err) {
      /* synthetic pointers cannot always be captured */
    }
    wakeAudio();
    maybeAutoBegin();
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = fingerOf(e.pointerId);
    if (p < 0) return;
    const m = fromScreen(p, e.clientX, e.clientY);
    const f = fingers[p];
    f.fx = m.x;
    f.fy = m.y;
    if (canMove()) {
      const want = { x: m.x + f.ox, y: m.y + f.oy };
      pos[p] = clampPt(want);
    } else {
      // During the countdown the dots wait on their marks; the finger may settle without dragging them.
      f.ox = pos[p].x - m.x;
      f.oy = pos[p].y - m.y;
    }
  });
  function lift(e) {
    const p = fingerOf(e.pointerId);
    if (p >= 0) fingers[p] = null;
  }
  canvas.addEventListener('pointerup', lift);
  canvas.addEventListener('pointercancel', lift);
  canvas.addEventListener('lostpointercapture', lift);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // Orange: W A S D. Blue: the arrow keys. Directions are as seen on the screen.
  const KEYS = {
    KeyW: [0, 0, -1],
    KeyS: [0, 0, 1],
    KeyA: [0, -1, 0],
    KeyD: [0, 1, 0],
    ArrowUp: [1, 0, -1],
    ArrowDown: [1, 0, 1],
    ArrowLeft: [1, -1, 0],
    ArrowRight: [1, 1, 0],
  };
  addEventListener('keydown', (e) => {
    if (!FIELD.has(game.phase)) return;
    if (KEYS[e.code]) {
      keys.add(e.code);
      e.preventDefault();
      wakeAudio();
      return;
    }
    if ((e.code === 'Enter' || e.code === 'Space') && game.phase === 'deal' && e.target === document.body) {
      e.preventDefault();
      dispatch({ type: 'begin', now: performance.now() });
    }
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());

  function applyKeys(dt) {
    for (const p of [0, 1]) {
      let dx = 0;
      let dy = 0;
      for (const k of keys) {
        const m = KEYS[k];
        if (m[0] === p) {
          dx += m[1];
          dy += m[2];
        }
      }
      const vel = keyVel[p];
      if (!canMove()) {
        vel.x = vel.y = 0;
        continue;
      }
      const len = Math.hypot(dx, dy) || 1;
      const speed = 0.3 * geom.scale; // px per second
      const ease = Math.min(1, dt / 120); // ease in and out so key steering is not jerky
      vel.x += ((dx / len) * speed - vel.x) * ease;
      vel.y += ((dy / len) * speed - vel.y) * ease;
      if (!dx && !dy && Math.hypot(vel.x, vel.y) < 2) vel.x = vel.y = 0;
      if (!vel.x && !vel.y) continue;
      const s = toScreen(p, pos[p]);
      pos[p] = clampPt(fromScreen(p, s.x + (vel.x * dt) / 1000, s.y + (vel.y * dt) / 1000));
    }
  }

  function maybeAutoBegin() {
    if (game.phase === 'deal' && view.canBegin && fingers[0] && fingers[1]) dispatch({ type: 'begin', now: performance.now() });
  }

  // ------------------------------------------------------------ sound: one tone per dot
  // Each dot sings a pitch set by where it is along the mirror line (an octave from 220 Hz).
  // Mirror images sing in unison; a little apart, the two tones beat against each other.
  let audio = null;
  function wakeAudio() {
    if (!settings.sound) return;
    if (!audio) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        const actx = new AC();
        const master = actx.createGain();
        master.gain.value = 0.9;
        master.connect(actx.destination);
        audio = { actx, master, voices: null };
      } catch (e) {
        audio = null;
        return;
      }
    }
    if (audio.actx.state === 'suspended') audio.actx.resume().catch(() => {});
  }
  function blip(freq, dur, gain) {
    if (!audio || !settings.sound) return;
    const t = audio.actx.currentTime;
    const o = audio.actx.createOscillator();
    const g = audio.actx.createGain();
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(audio.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  function startTones() {
    if (!audio || !settings.sound || audio.voices) return;
    const t = audio.actx.currentTime;
    audio.voices = [0, 1].map((p) => {
      const o = audio.actx.createOscillator();
      const g = audio.actx.createGain();
      o.type = 'sine';
      o.frequency.value = toneFor(p);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.045, t + 0.5);
      let out = g;
      if (audio.actx.createStereoPanner) {
        const pan = audio.actx.createStereoPanner();
        pan.pan.value = geom.mode === 'side' ? (p ? 0.35 : -0.35) : 0;
        g.connect(pan);
        out = pan;
      }
      o.connect(g);
      out.connect(audio.master);
      o.start(t);
      return { o, g };
    });
  }
  function toneFor(p) {
    return 220 * Math.pow(2, pos[p].x / geom.Lu);
  }
  function updateTones() {
    if (!audio || !audio.voices) return;
    const t = audio.actx.currentTime;
    for (const p of [0, 1]) audio.voices[p].o.frequency.setTargetAtTime(toneFor(p), t, 0.03);
  }
  function stopTones() {
    if (!audio || !audio.voices) return;
    const t = audio.actx.currentTime;
    for (const v of audio.voices) {
      v.g.gain.cancelScheduledValues(t);
      v.g.gain.setTargetAtTime(0, t, 0.08);
      v.o.stop(t + 0.6);
    }
    audio.voices = null;
  }

  // ------------------------------------------------------------ colours
  let col = {};
  function readColours() {
    const cs = getComputedStyle(document.documentElement);
    for (const k of ['bg', 'ink', 'muted', 'orange', 'blue', 'half0', 'half1', 'line', 'glow', 'fog', 'together', 'apart', 'unclear', 'panel', 'rule']) {
      col[k] = cs.getPropertyValue('--' + k).trim();
    }
  }
  readColours();
  const onScheme = () => {
    readColours();
    if (game.phase === 'reveal') renderScreen();
  };
  if (dark.addEventListener) dark.addEventListener('change', onScheme);

  // Frosted speckle for the fog, made once.
  const frost = document.createElement('canvas');
  (function makeFrost() {
    frost.width = frost.height = 128;
    const f = frost.getContext('2d');
    let s = 12345;
    const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
    for (let i = 0; i < 900; i++) {
      f.fillStyle = `rgba(255,255,255,${0.15 + 0.5 * rnd()})`;
      const r = 0.5 + 2.2 * rnd();
      f.beginPath();
      f.arc(rnd() * 128, rnd() * 128, r, 0, Math.PI * 2);
      f.fill();
    }
  })();
  let frostPattern = null;

  // ------------------------------------------------------------ the loop
  let raf = 0;
  let lastFrame = 0;
  function startLoop() {
    if (!raf) raf = requestAnimationFrame(frame);
  }
  function frame(now) {
    raf = 0;
    if (!FIELD.has(game.phase)) return;
    const dt = lastFrame ? Math.min(100, Math.max(0, now - lastFrame)) : 16;
    lastFrame = now;
    applyKeys(dt);
    if (game.phase === 'countdown') {
      if (now >= view.goAt) dispatch({ type: 'tick', now });
      else tickCount(now);
    }
    if (game.phase === 'play') record(now);
    pushTrails(now);
    draw(now, dt);
    if (game.phase === 'play') updateTones();
    if (FIELD.has(game.phase)) raf = requestAnimationFrame(frame);
  }

  function record(now) {
    const total = view.playMs / C.DT;
    while (rec.tr.n < total && rec.next <= now) {
      Y.pushSample(rec.tr, pos[0], pos[1]);
      rec.next += C.DT;
    }
    if (rec.tr.n > 0) {
      heldNow = Y.heldAt(rec.tr, rec.tr.n - 1);
      if (heldNow) lastHeldAt = now;
    }
    if (now >= view.endsAt) {
      while (rec.tr.n < total) Y.pushSample(rec.tr, pos[0], pos[1]);
      dispatch({ type: 'finish', now, trace: rec.tr });
    }
  }

  function pushTrails(now) {
    for (const p of [0, 1]) {
      const t = trails[p];
      const last = t[t.length - 1];
      if (!last || last.x !== pos[p].x || last.y !== pos[p].y) t.push({ x: pos[p].x, y: pos[p].y, t: now });
      while (t.length && now - t[0].t > 700) t.shift();
    }
  }

  let lastCount = 0;
  function tickCount(now) {
    const n = Math.max(1, Math.ceil((view.goAt - now) / 1000));
    if (n !== lastCount) {
      lastCount = n;
      for (const h of halves) h.querySelector('.count').textContent = String(n);
      blip(440, 0.12, 0.08);
    }
  }

  // ------------------------------------------------------------ drawing the glass
  function draw(now, dt) {
    const g = geom;
    const dpr = canvas.width / g.W;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // halves
    ctx.fillStyle = col.half0;
    if (g.mode === 'facing') ctx.fillRect(0, g.H / 2, g.W, g.H / 2);
    else ctx.fillRect(0, 0, g.W / 2, g.H);
    ctx.fillStyle = col.half1;
    if (g.mode === 'facing') ctx.fillRect(0, 0, g.W, g.H / 2);
    else ctx.fillRect(g.W / 2, 0, g.W / 2, g.H);

    // fog: settles when the mirror has not held for a while during play, clears when it holds
    const playing = game.phase === 'play';
    if (playing) {
      if (heldNow) fog = Math.max(0, fog - dt / 500);
      else if (now - Math.max(lastHeldAt, view.startedAt) > 1200) fog = Math.min(1, fog + dt / 2500);
      glow += ((heldNow ? 1 : 0) - glow) * Math.min(1, dt / 120);
    } else {
      fog = Math.max(0, fog - dt / 400);
      glow = 0;
    }
    if (fog > 0.01) {
      ctx.save();
      ctx.globalAlpha = 0.5 * fog;
      ctx.fillStyle = col.fog;
      ctx.fillRect(0, 0, g.W, g.H);
      if (!frostPattern) frostPattern = ctx.createPattern(frost, 'repeat');
      ctx.globalAlpha = 0.6 * fog;
      ctx.fillStyle = frostPattern;
      ctx.fillRect(0, 0, g.W, g.H);
      ctx.restore();
    }

    // the mirror line; while playing, its lit part is the time left
    let frac = 1;
    if (playing) frac = Math.max(0, Math.min(1, (view.endsAt - now) / view.playMs));
    const len = g.mode === 'facing' ? g.W : g.H;
    const line = (a, b, w, colour, alpha) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = colour;
      ctx.lineWidth = w;
      ctx.lineCap = 'round';
      ctx.beginPath();
      if (g.mode === 'facing') {
        ctx.moveTo(a, g.H / 2);
        ctx.lineTo(b, g.H / 2);
      } else {
        ctx.moveTo(g.W / 2, a);
        ctx.lineTo(g.W / 2, b);
      }
      ctx.stroke();
      ctx.restore();
    };
    line(0, len, 1, col.line, 0.5);
    const lit0 = (len / 2) * (1 - frac);
    const lit1 = len - lit0;
    if (frac > 0) {
      line(lit0, lit1, 3, col.line, 0.9);
      if (glow > 0.02) {
        line(lit0, lit1, 10, col.glow, 0.35 * glow);
        line(lit0, lit1, 3, col.glow, glow);
      }
    }

    // each half: your trail, your partner's mirror image (a ring), your dot
    for (const p of [0, 1]) {
      const mine = p === 0 ? col.orange : col.blue;
      const theirs = p === 0 ? col.blue : col.orange;
      const t = trails[p];
      if (t.length > 1) {
        ctx.save();
        ctx.strokeStyle = mine;
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        for (let i = 1; i < t.length; i++) {
          const a = toScreen(p, t[i - 1]);
          const b = toScreen(p, t[i]);
          ctx.globalAlpha = 0.35 * (1 - (now - t[i].t) / 700);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
        ctx.restore();
      }
      const ghost = toScreen(p, pos[1 - p]);
      ctx.save();
      ctx.strokeStyle = theirs;
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.arc(ghost.x, ghost.y, 27, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      const d = toScreen(p, pos[p]);
      ctx.save();
      ctx.fillStyle = mine;
      ctx.globalAlpha = 0.18;
      ctx.beginPath();
      ctx.arc(d.x, d.y, 34, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(d.x, d.y, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      if (game.phase === 'deal' || game.phase === 'countdown') {
        // a mark for the finger to find
        const pulse = reduced.matches ? 0.5 : 0.5 + 0.5 * Math.sin(now / 260);
        ctx.save();
        ctx.strokeStyle = mine;
        ctx.globalAlpha = 0.25 + 0.35 * pulse;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(d.x, d.y, 44 + (reduced.matches ? 0 : 6 * pulse), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    if (game.phase === 'guess') {
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = col.bg;
      ctx.fillRect(0, 0, g.W, g.H);
      ctx.restore();
    }
  }

  // ------------------------------------------------------------ the two halves' words and buttons
  const sig = ['', ''];
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function renderHalves() {
    const v = view;
    for (const p of [0, 1]) {
      const h = halves[p];
      const prompt = h.querySelector('.prompt');
      const slot = h.querySelector('.slot');
      const count = h.querySelector('.count');
      const partner = NAMES[1 - p];
      if (v.phase !== 'countdown') count.textContent = '';
      let text = '';
      let key = v.phase;
      if (v.phase === 'deal' && v.cards) {
        const card = v.cards[p];
        text = !card.seen
          ? 'Your order is on this card. Cup your other hand around it, then hold it to read. Don’t look at ' + partner + '’s.'
          : v.canBegin
            ? 'Now both of you put a finger on your dot.'
            : 'Now wait for ' + partner + ' to read theirs.';
        key = 'card';
        if (sig[p] !== key) {
          slot.replaceChildren(makeCard(p));
          sig[p] = key;
        }
        fillCard(slot.firstChild, card);
      } else if (v.phase === 'deal') {
        text = 'Practice: no orders. Put a finger on your dot. Move so it is always the mirror image of ' + partner + '’s dot (the ring shows where).';
        key = 'practice';
        if (sig[p] !== key) slot.replaceChildren();
      } else if (v.phase === 'countdown') {
        text = 'No talking while the glass is up.';
        if (sig[p] !== key) slot.replaceChildren();
      } else if (v.phase === 'guess') {
        const gq = v.guess[p];
        text = gq.answered
          ? v.guess[1 - p].answered
            ? ''
            : 'Locked in. Waiting for ' + partner + '.'
          : v.practice
            ? 'Who was leading?'
            : 'Was ' + partner + ' told to lead, or to follow?';
        key = gq.answered ? 'locked' : 'ask:' + gq.options.join(',');
        if (sig[p] !== key) {
          slot.replaceChildren(gq.answered ? el('div', 'locked', 'Answer hidden until the reveal.') : makeChoices(p, gq.options));
        }
      } else {
        if (sig[p] !== key) slot.replaceChildren();
      }
      sig[p] = key;
      if (prompt.textContent !== text) prompt.textContent = text;
    }
    beginBtn.hidden = !(v.phase === 'deal' && v.canBegin);
  }

  function makeCard(p) {
    const b = el('button', 'card');
    b.type = 'button';
    b.setAttribute('aria-label', 'Your order card. Press and hold to read it.');
    let down = false;
    const press = (e) => {
      if (down) return;
      down = true;
      if (e && e.pointerId !== undefined) {
        try {
          b.setPointerCapture(e.pointerId);
        } catch (err) {
          /* ignore */
        }
      }
      wakeAudio();
      dispatch({ type: 'peek', player: p, down: true });
    };
    const release = () => {
      if (!down) return;
      down = false;
      dispatch({ type: 'peek', player: p, down: false });
    };
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      press(e);
    });
    b.addEventListener('pointerup', release);
    b.addEventListener('pointercancel', release);
    b.addEventListener('lostpointercapture', release);
    b.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        if (!e.repeat) press();
      }
    });
    b.addEventListener('keyup', (e) => {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        release();
      }
    });
    b.addEventListener('blur', release);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    return b;
  }
  function fillCard(b, card) {
    // The card's contents depend on its owner's order only while the owner is holding it.
    const want = card.held && card.order ? 'held:' + card.order : card.seen ? 'seen' : 'new';
    if (b.dataset.k === want) return;
    b.dataset.k = want;
    b.classList.toggle('held', !!card.held);
    if (card.held && card.order) {
      const t = Y.ORDER_TEXT[card.order];
      b.replaceChildren(el('div', 'word', t.word), el('div', 'line', t.line));
    } else {
      b.replaceChildren(el('div', 'face', card.seen ? 'Read ✓  Hold to read again' : 'Hold to read your order'));
    }
  }
  function choiceLabel(p, opt) {
    if (opt === 'lead') return 'LEAD';
    if (opt === 'follow') return 'FOLLOW';
    if (opt === 'me') return 'Me';
    if (opt === 'them') return NAMES[1 - p];
    return 'Nobody';
  }
  function makeChoices(p, opts) {
    const box = el('div', 'choices');
    for (const opt of opts) {
      const b = el('button', 'choice', choiceLabel(p, opt));
      b.type = 'button';
      b.addEventListener('click', () => dispatch({ type: 'guess', player: p, value: opt, now: performance.now() }));
      box.appendChild(b);
    }
    return box;
  }

  function announce(text) {
    announceEl.textContent = text;
  }

  // ------------------------------------------------------------ phase changes
  function changed(before, v) {
    const entering = before.phase !== v.phase || before.round !== v.round;
    if (FIELD.has(v.phase)) {
      if (wrap.hidden) {
        wrap.hidden = false;
        screenEl.hidden = true;
        document.body.classList.add('in-field');
        lockedMode = null;
        measure();
        lockedMode = geom.mode;
      }
      if (entering && v.phase === 'deal') {
        resetDots();
        fingers[0] = fingers[1] = null;
        keys.clear();
        fog = 0;
        announce(v.practice ? 'Practice round. Put your fingers on your dots.' : 'Round ' + v.round + ' of ' + v.rounds + '. Read your order cards.');
      }
      if (entering && v.phase === 'countdown') {
        lastCount = 0;
        resetDots();
        // The dots wait on their marks; a finger already down keeps its place relative to its dot.
        for (const p of [0, 1]) {
          const f = fingers[p];
          if (f) {
            f.ox = pos[p].x - f.fx;
            f.oy = pos[p].y - f.fy;
          }
        }
        announce('Three seconds. No talking while the glass is up.');
      }
      if (entering && v.phase === 'play') {
        rec = { tr: Y.emptyTrace(geom.scale), next: v.startedAt };
        rec.tr.lu = geom.Lu;
        rec.tr.lv = geom.Lv;
        heldNow = false;
        lastHeldAt = v.startedAt;
        for (const h of halves) h.querySelector('.count').textContent = '';
        blip(880, 0.25, 0.1);
        startTones();
        announce('Go.');
      }
      if (entering && v.phase === 'guess') {
        stopTones();
        blip(330, 0.4, 0.08);
        announce(v.practice ? 'Time. Each of you: who was leading?' : 'Time. Each of you: guess your partner’s order.');
      }
      renderHalves();
      lastFrame = 0;
      startLoop();
    } else {
      stopTones();
      if (!wrap.hidden) {
        wrap.hidden = true;
        screenEl.hidden = false;
        document.body.classList.remove('in-field');
        lockedMode = null;
      }
      fingers[0] = fingers[1] = null;
      sig[0] = sig[1] = '';
      if (entering) {
        renderScreen();
        scrollTo(0, 0);
      }
    }
  }

  beginBtn.addEventListener('click', () => {
    wakeAudio();
    dispatch({ type: 'begin', now: performance.now() });
  });
  quitBtn.addEventListener('click', () => dispatch({ type: 'quit' }));

  document.addEventListener('visibilitychange', () => {
    if (!audio) return;
    if (document.hidden) audio.actx.suspend().catch(() => {});
    else if (settings.sound) audio.actx.resume().catch(() => {});
  });

  addEventListener('resize', () => {
    if (!wrap.hidden) measure();
    else if (game.phase === 'reveal') drawRevealPaths();
  });

  // ------------------------------------------------------------ full screens
  const fmtS = (ms) => (Math.round(ms / 100) / 10).toFixed(1).replace(/\.0$/, '') + ' s';
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const nameHtml = (p) => `<span class="${p ? 'b' : 'o'}">${NAMES[p]}</span>`;
  const whoHtml = (w) => (w === 'A' ? nameHtml(0) : w === 'B' ? nameHtml(1) : 'nobody');

  function renderScreen() {
    if (game.phase === 'title') renderTitle();
    else if (game.phase === 'reveal') renderReveal();
    else if (game.phase === 'summary') renderSummary();
  }

  const SEATS_SVG = `
<svg viewBox="0 0 120 90" aria-hidden="true">
  <circle cx="60" cy="10" r="8" style="fill:var(--blue)"/>
  <rect x="38" y="24" width="44" height="42" rx="6" style="fill:var(--panel);stroke:var(--rule);stroke-width:2"/>
  <line x1="40" y1="45" x2="80" y2="45" style="stroke:var(--line);stroke-width:2"/>
  <circle cx="60" cy="35" r="3.5" style="fill:none;stroke:var(--blue);stroke-width:1.5"/>
  <circle cx="60" cy="55" r="3.5" style="fill:var(--orange)"/>
  <circle cx="60" cy="80" r="8" style="fill:var(--orange)"/>
</svg>
<svg viewBox="0 0 120 90" aria-hidden="true">
  <rect x="22" y="14" width="76" height="46" rx="5" style="fill:var(--panel);stroke:var(--rule);stroke-width:2"/>
  <line x1="60" y1="17" x2="60" y2="57" style="stroke:var(--line);stroke-width:2"/>
  <circle cx="48" cy="37" r="3.5" style="fill:var(--orange)"/>
  <circle cx="72" cy="37" r="3.5" style="fill:var(--blue)"/>
  <circle cx="42" cy="78" r="8" style="fill:var(--orange)"/>
  <circle cx="78" cy="78" r="8" style="fill:var(--blue)"/>
</svg>`;

  function renderTitle() {
    const seg = (name, value, label) =>
      `<button type="button" data-set="${name}" data-val="${value}" aria-pressed="${settings[name] === value}">${label}</button>`;
    screenEl.innerHTML = `
<h1>After You</h1>
<p class="lede">A mirror game for two people and one screen. Each of you is secretly told to lead or to follow. Afterwards, the trace shows who really went first.</p>
<div class="seats">${SEATS_SVG}</div>
<p class="small">Phone or tablet flat on the table between you, or side by side at a laptop. Each of you owns one half of the glass.</p>
<h2>How to play</h2>
<ol>
  <li>Put a finger on your dot and move it so it is always the mirror image of your partner’s dot. A ring in your half shows where that is. Slow is easier.</li>
  <li>Before each round you each secretly read an order: <b>LEAD</b> or <b>FOLLOW</b>. Each order is its own coin toss, so you may both get the same one.</li>
  <li>No talking while the glass is up: 30 seconds.</li>
  <li>Then each of you secretly guesses the other’s order, and the trace shows who was ahead, moment by moment.</li>
</ol>
<h2>Points, each round</h2>
<table class="points">
  <tr><td class="n">+1 each</td><td>The mirror held for at least 10 of the 30 seconds: dots within a fingertip of mirror images, both travelling. The line glows while it holds; the glass fogs when it doesn’t.</td></tr>
  <tr><td class="n">+1</td><td>You did as you were told. LEAD: the trace has you ahead for longer than your partner, and for at least 4 seconds. FOLLOW: it has your partner ahead.</td></tr>
  <tr><td class="n">+1</td><td>You guessed your partner’s order.</td></tr>
</table>
<p class="small">Four rounds. If you were both told the same thing, at most one of you can keep their order.</p>
<div class="settings">
  <div class="setting"><span>Seating</span><div class="seg" role="group" aria-label="Seating">${seg('seat', 'auto', 'Auto')}${seg('seat', 'facing', 'Facing')}${seg('seat', 'side', 'Side by side')}</div></div>
  <div class="setting"><span>Sound</span><div class="seg" role="group" aria-label="Sound">${seg('sound', true, 'On')}${seg('sound', false, 'Off')}</div></div>
</div>
<div class="actions">
  <button type="button" class="btn" id="go-practice">Practice round first</button>
  <button type="button" class="btn ghost" id="go-play">Start the game</button>
</div>
<p class="small">No touchscreen? <span class="o">Orange</span> steers with W A S D, <span class="b">Blue</span> with the arrow keys, and a mouse works for one of you. Nothing is saved or sent anywhere.</p>`;
    for (const b of screenEl.querySelectorAll('[data-set]')) {
      b.addEventListener('click', () => {
        const name = b.dataset.set;
        settings[name] = name === 'sound' ? b.dataset.val === 'true' : b.dataset.val;
        saveSettings();
        for (const o of screenEl.querySelectorAll(`[data-set="${name}"]`)) o.setAttribute('aria-pressed', String(o === b));
        if (name === 'sound' && !settings.sound) stopTones();
      });
    }
    $('go-practice').addEventListener('click', () => {
      wakeAudio();
      dispatch({ type: 'practice', rand: rand4(), now: performance.now() });
    });
    $('go-play').addEventListener('click', () => {
      wakeAudio();
      dispatch({ type: 'play', rand: rand4(), now: performance.now() });
    });
  }

  // ----- reveal
  let reveal = null; // { tr, segs, cursor }

  function punchLine(res) {
    const an = res.analysis;
    const L = an.leader === 'A' ? 0 : an.leader === 'B' ? 1 : -1;
    const o = res.orders;
    let s;
    if (o[0] !== o[1]) {
      const lp = o[0] === 'lead' ? 0 : 1;
      const fp = 1 - lp;
      if (L === lp) s = `${nameHtml(lp)} led and ${nameHtml(fp)} followed, as ordered.`;
      else if (L === fp) s = `${nameHtml(fp)} was told to follow, but the trace has ${nameHtml(fp)} ahead.`;
      else s = `${nameHtml(lp)} was told to lead, but nobody was ahead for long enough to count.`;
    } else if (o[0] === 'follow') {
      s = L >= 0 ? `You were both told to follow. Somebody had to go first, and it was ${nameHtml(L)}.` : 'You were both told to follow, and nobody went first for long enough to count.';
    } else {
      s = L >= 0 ? `You were both told to lead. ${nameHtml(1 - L)} gave way.` : 'You were both told to lead, and neither of you gave way.';
    }
    const g = res.guesses;
    if (o[0] === 'follow' && o[1] === 'follow' && g[0] === 'lead' && g[1] === 'lead') s += ' And each of you thought the other was leading.';
    else if (o[0] === 'lead' && o[1] === 'lead' && g[0] === 'follow' && g[1] === 'follow') s += ' And each of you thought the other was following.';
    else if (!res.read[0] && !res.read[1]) s += ' You both misread each other.';
    else if (res.read[0] && res.read[1]) s += ' You both read each other right.';
    return s;
  }

  function practiceLine(res) {
    const an = res.analysis;
    const felt = res.felt;
    let s = an.leader ? `The trace says ${whoHtml(an.leader)} led: ahead for ${fmtS(an.time[an.leader])}, against ${fmtS(an.time[an.leader === 'A' ? 'B' : 'A'])}.` : 'The trace says nobody was ahead for long enough to count as leading.';
    if (res.feltRight[0] && res.feltRight[1]) s += ' You both felt it right.';
    else if (felt[0] === felt[1]) s += ' You agreed with each other, but not with the trace.';
    else s += ' You didn’t agree with each other.';
    return s;
  }

  function statsHtml(an) {
    const lag = (w) => (an.typicalLag[w] ? `by about ${(an.typicalLag[w] / 1000).toFixed(2)} s` : '');
    const fm = an.firstMove.who ? (an.firstMove.who === 'both' ? 'both at once' : whoHtml(an.firstMove.who)) : 'nobody';
    return `
<div class="stats">
  <div class="stat"><b>${fmtS(an.time.A)}</b><span>${nameHtml(0)} ahead ${lag('A')}</span></div>
  <div class="stat"><b>${fmtS(an.time.B)}</b><span>${nameHtml(1)} ahead ${lag('B')}</span></div>
  <div class="stat"><b>${fmtS(an.time.together)}</b><span>together, nobody ahead (longest run ${fmtS(an.longestTogetherMs)})</span></div>
  <div class="stat"><b>${fmtS(an.time.apart + an.time.unclear)}</b><span>apart, or too close to call</span></div>
  <div class="stat"><b>${fmtS(an.time.still)}</b><span>still</span></div>
  <div class="stat"><b>${fmtS(an.heldFraction * an.ms)}</b><span>the mirror held (${Math.round(an.heldFraction * 100)}% of the round)</span></div>
  <div class="stat"><b>${an.firstMove.who ? fmtS(an.firstMove.ms) : '–'}</b><span>first move: ${fm}</span></div>
</div>`;
  }

  const CLS_COLOUR = { A: 'var(--orange)', B: 'var(--blue)', together: 'var(--together)', apart: 'var(--apart)', unclear: 'var(--unclear)', still: 'transparent' };

  function timelineSvg(an) {
    const n = an.segments.length;
    const w = 600 / n;
    let r = '';
    an.segments.forEach((sg, i) => {
      if (sg.cls !== 'still') r += `<rect x="${(i * w).toFixed(2)}" y="6" width="${(w + 0.4).toFixed(2)}" height="30" style="fill:${CLS_COLOUR[sg.cls]}"/>`;
      if (sg.held > 0) r += `<rect x="${(i * w).toFixed(2)}" y="41" width="${(w + 0.4).toFixed(2)}" height="5" style="fill:var(--glow);opacity:${sg.held.toFixed(2)}"/>`;
    });
    let ticks = '';
    for (let s = 0; s <= an.ms / 1000; s += 5) {
      const x = (s / (an.ms / 1000)) * 600;
      ticks += `<line x1="${x}" y1="36" x2="${x}" y2="40" style="stroke:var(--muted)"/><text x="${Math.min(590, Math.max(6, x))}" y="60" text-anchor="middle" style="fill:var(--muted);font-size:11px">${s}s</text>`;
    }
    return `<svg viewBox="0 0 600 66" preserveAspectRatio="none" role="slider" tabindex="0" aria-label="Who was ahead, moment by moment. Drag or use the arrow keys to replay." aria-valuemin="0" aria-valuemax="${an.ms / 1000}" aria-valuenow="0">
<rect x="0" y="6" width="600" height="30" style="fill:none;stroke:var(--rule)"/>${r}${ticks}
<line id="cursor" x1="0" y1="2" x2="0" y2="48" style="stroke:var(--ink);stroke-width:2"/></svg>`;
  }

  function legendHtml() {
    const item = (c, t) => `<span><i style="background:${c}"></i>${t}</span>`;
    return `<div class="legend">${item('var(--orange)', 'Orange ahead')}${item('var(--blue)', 'Blue ahead')}${item('var(--together)', 'together')}${item('var(--apart)', 'apart')}${item('var(--unclear)', 'too close to call')}${item('transparent;box-shadow:inset 0 0 0 1px var(--rule)', 'still')}${item('var(--glow)', 'mirror held (thin bar)')}</div>`;
  }

  function renderReveal() {
    const v = view;
    const res = v.result;
    const an = res.analysis;
    let head;
    let pointsHtml = '';
    if (res.practice) {
      const feltText = (p) => {
        const g = res.guesses[p];
        return g === 'me' ? 'I was leading' : g === 'them' ? `${NAMES[1 - p]} was leading` : 'nobody was leading';
      };
      head = `
<p class="kicker">Practice round</p>
<div class="pair">${[0, 1]
        .map((p) => `<div class="pane"><p>${nameHtml(p)} felt</p><p class="order" style="font-size:17px">“${feltText(p)}”</p><p>${res.feltRight[p] ? '<span class="yes">matches the trace</span>' : '<span class="no">not what the trace says</span>'}</p></div>`)
        .join('')}</div>
<p class="punch">${practiceLine(res)}</p>`;
    } else {
      head = `
<p class="kicker">Round ${res.round} of ${v.rounds}</p>
<div class="pair">${[0, 1]
        .map(
          (p) => `<div class="pane"><p>${nameHtml(p)} was told</p><div class="order ${p ? 'b' : 'o'}">${res.orders[p].toUpperCase()}</div><p>and guessed ${NAMES[1 - p]} would <b>${res.guesses[p].toUpperCase()}</b> ${res.read[p] ? '<span class="yes">✓</span>' : '<span class="no">✗</span>'}</p></div>`,
        )
        .join('')}</div>
<p class="punch">${punchLine(res)}</p>`;
      const row = (label, a, b) => `<tr><td>${label}</td><td class="n">${a}</td><td class="n">${b}</td></tr>`;
      const pt = (x) => (x ? '+1' : '0');
      pointsHtml = `
<h2>Points</h2>
<table class="points">
  <tr><th></th><th class="n">${nameHtml(0)}</th><th class="n">${nameHtml(1)}</th></tr>
  ${row(`Mirror held for ${fmtS(an.heldFraction * an.ms)} (${fmtS(C.HELD_POINT * an.ms)} needed)`, pt(res.held), pt(res.held))}
  ${row('Did as told', pt(res.kept[0]), pt(res.kept[1]))}
  ${row('Read your partner', pt(res.read[0]), pt(res.read[1]))}
  ${row('<b>This round</b>', `<b>${res.points[0]}</b>`, `<b>${res.points[1]}</b>`)}
  ${row('Running total', v.totals[0], v.totals[1])}
</table>`;
    }
    const nextLabel = res.practice ? 'Start the real rounds' : v.last ? 'See how it went' : 'Next round';
    screenEl.innerHTML = `${head}
<div class="timeline">${timelineSvg(an)}</div>
${legendHtml()}
<div class="paths"><canvas id="paths" aria-label="Both dots' paths in the mirror, overlaid. Where the lines coincide, you were mirror images."></canvas></div>
<p class="small">The box is one half of the glass with the mirror line along the top, and both paths laid on top of each other: where they coincide, you were mirror images. Drag along the strip above to put the dots back where they were at any moment.</p>
${statsHtml(an)}
${pointsHtml}
<div class="actions"><button type="button" class="btn" id="next">${nextLabel}</button><button type="button" class="btn ghost" id="stop">Stop</button></div>`;
    reveal = { tr: v.trace, an, cursor: v.trace.n - 1 };
    $('next').addEventListener('click', () => dispatch({ type: 'next', rand: rand4(), now: performance.now() }));
    $('stop').addEventListener('click', () => dispatch({ type: 'quit' }));
    const svg = screenEl.querySelector('.timeline svg');
    const scrub = (e) => {
      const r = svg.getBoundingClientRect();
      const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      setCursor(Math.round(f * (reveal.tr.n - 1)));
    };
    let dragging = false;
    svg.addEventListener('pointerdown', (e) => {
      dragging = true;
      try {
        svg.setPointerCapture(e.pointerId);
      } catch (err) {
        /* ignore */
      }
      scrub(e);
    });
    svg.addEventListener('pointermove', (e) => dragging && scrub(e));
    svg.addEventListener('pointerup', () => (dragging = false));
    svg.addEventListener('pointercancel', () => (dragging = false));
    svg.addEventListener('keydown', (e) => {
      const step = e.code === 'ArrowRight' ? 25 : e.code === 'ArrowLeft' ? -25 : 0;
      if (!step) return;
      e.preventDefault();
      setCursor(Math.max(0, Math.min(reveal.tr.n - 1, reveal.cursor + step)));
    });
    setCursor(reveal.cursor);
  }

  function setCursor(i) {
    reveal.cursor = i;
    const svg = screenEl.querySelector('.timeline svg');
    if (svg) {
      const x = (i / (reveal.tr.n - 1)) * 600;
      const c = svg.querySelector('#cursor');
      c.setAttribute('x1', x);
      c.setAttribute('x2', x);
      svg.setAttribute('aria-valuenow', ((i * C.DT) / 1000).toFixed(1));
    }
    drawRevealPaths();
  }

  function drawRevealPaths() {
    const cv = $('paths');
    if (!cv || !reveal) return;
    const tr = reveal.tr;
    const w = Math.max(10, cv.clientWidth);
    const lu = tr.lu || tr.scale;
    const lv = tr.lv || tr.scale;
    const h = Math.round(Math.min(420, Math.max(160, (w * lv) / lu)));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    cv.style.height = h + 'px';
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    const pad = 10;
    const k = Math.min((w - 2 * pad) / lu, (h - 2 * pad) / lv);
    const ox = (w - k * lu) / 2;
    const oy = pad;
    const X = (x) => ox + k * x;
    const Yy = (y) => oy + k * y;
    // the mirror line along the top
    c.strokeStyle = col.line;
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(ox, oy);
    c.lineTo(ox + k * lu, oy);
    c.stroke();
    c.fillStyle = col.muted;
    c.font = '11px system-ui, sans-serif';
    c.fillText('mirror line', ox + 4, oy + 13);
    const path = (xs, ys, colour, width, alpha, from, to) => {
      c.save();
      c.strokeStyle = colour;
      c.lineWidth = width;
      c.globalAlpha = alpha;
      c.lineJoin = 'round';
      c.lineCap = 'round';
      c.beginPath();
      for (let i = from; i <= to; i++) (i === from ? c.moveTo : c.lineTo).call(c, X(xs[i]), Yy(ys[i]));
      c.stroke();
      c.restore();
    };
    const n = tr.n;
    path(tr.ax, tr.ay, col.orange, 5, 0.3, 0, n - 1);
    path(tr.bx, tr.by, col.blue, 1.5, 0.55, 0, n - 1);
    const i = reveal.cursor;
    const from = Math.max(0, i - 50);
    path(tr.ax, tr.ay, col.orange, 7, 0.75, from, i);
    path(tr.bx, tr.by, col.blue, 2.5, 1, from, i);
    c.fillStyle = col.orange;
    c.beginPath();
    c.arc(X(tr.ax[i]), Yy(tr.ay[i]), 8, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = col.blue;
    c.lineWidth = 3;
    c.beginPath();
    c.arc(X(tr.bx[i]), Yy(tr.by[i]), 12, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = col.muted;
    c.fillText(fmtS(i * C.DT), ox + k * lu - 40, oy + k * lv - 6);
  }

  // ----- summary
  function renderSummary() {
    const summary = view.summary;
    const t = summary.totals;
    const verdict = t[0] === t[1] ? 'Level.' : `${nameHtml(t[0] > t[1] ? 0 : 1)} wins by ${Math.abs(t[0] - t[1])}.`;
    const rows = summary.lines
      .map((line) => `<tr><td>${line.round}</td><td>${nameHtml(0)} ${line.orders[0]}, ${nameHtml(1)} ${line.orders[1]}</td><td>${whoHtml(line.leader)}</td><td class="n">${line.points[0]}</td><td class="n">${line.points[1]}</td></tr>`)
      .join('');
    const tt = summary.time;
    const total = tt.A + tt.B + tt.together + tt.apart + tt.unclear + tt.still || 1;
    const pct = (x) => ((100 * x) / total).toFixed(2) + '%';
    const longest = summary.longestTogether;
    screenEl.innerHTML = `
<p class="kicker">After ${summary.rounds} rounds</p>
<h1 style="font-size:clamp(36px,10vw,52px)">${nameHtml(0)} ${t[0]} · ${nameHtml(1)} ${t[1]}</h1>
<p class="punch">${verdict}</p>
<table class="points">
  <tr><th>Round</th><th>Orders</th><th>Led</th><th class="n">${nameHtml(0)}</th><th class="n">${nameHtml(1)}</th></tr>
  ${rows}
</table>
<div class="stats">
  <div class="stat"><b>${summary.read[0]} of ${summary.rounds}</b><span>times ${nameHtml(0)} read ${nameHtml(1)} right</span></div>
  <div class="stat"><b>${summary.read[1]} of ${summary.rounds}</b><span>times ${nameHtml(1)} read ${nameHtml(0)} right</span></div>
  <div class="stat"><b>${summary.kept[0]} · ${summary.kept[1]}</b><span>orders kept, ${nameHtml(0)} · ${nameHtml(1)}</span></div>
  <div class="stat"><b>${summary.held} of ${summary.rounds}</b><span>rounds the mirror held</span></div>
</div>
<h2>One more question</h2>
<p>Out loud this time, both of you: <b>which of you usually leads?</b></p>
<p>Say it first. Then look.</p>
<div class="actions"><button type="button" class="btn ghost" id="show">Show the whole game’s trace</button></div>
<div id="answer" hidden>
  <div class="bar" role="img" aria-label="Time ahead over the whole game">
    <div style="width:${pct(tt.A)};background:var(--orange)"></div>
    <div style="width:${pct(tt.together)};background:var(--together)"></div>
    <div style="width:${pct(tt.apart + tt.unclear)};background:var(--apart)"></div>
    <div style="width:${pct(tt.still)};background:transparent"></div>
    <div style="width:${pct(tt.B)};background:var(--blue)"></div>
  </div>
  <p>${nameHtml(0)} ahead ${fmtS(tt.A)} · together ${fmtS(tt.together)} · apart or unclear ${fmtS(tt.apart + tt.unclear)} · still ${fmtS(tt.still)} · ${nameHtml(1)} ahead ${fmtS(tt.B)}</p>
  <p class="small">${longest.ms ? `Your longest stretch moving together with nobody ahead: ${fmtS(longest.ms)}, in round ${longest.round}.` : 'You never moved together with nobody ahead for a whole half second.'} The trace can say who moved first. It cannot say who meant to.</p>
</div>
<div class="actions"><button type="button" class="btn" id="again">Play again</button></div>`;
    $('show').addEventListener('click', () => {
      $('answer').hidden = false;
      $('show').hidden = true;
    });
    $('again').addEventListener('click', () => dispatch({ type: 'again' }));
  }

  // ------------------------------------------------------------ go
  renderTitle();
})();
