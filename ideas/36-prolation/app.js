// app.js — the page: composes a piece for the seed, plays it with a lookahead scheduler, and draws
// the melody strip and the piano roll in sync with the audio clock.
(function () {
  'use strict';
  const P = window.Prolation;
  const $ = (id) => document.getElementById(id);
  const els = {
    meta: $('meta'), strip: $('strip'), roll: $('roll'), words: $('words'), time: $('time'),
    playBtn: $('playBtn'), againBtn: $('againBtn'), newBtn: $('newBtn'), midiBtn: $('midiBtn'),
    helpBtn: $('helpBtn'), help: $('help'), helpClose: $('helpClose'),
    intro: $('intro'), start: $('start'), introFine: $('introFine'),
  };
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const darkScheme = window.matchMedia('(prefers-color-scheme: dark)');

  const LOOKAHEAD = 0.6; // seconds of audio scheduled ahead of the clock
  const TICK = 50; // ms between scheduler ticks
  const SEEK_STEP = 10;

  let piece = null;
  let ctx = null;
  let engine = null;
  let perf = null;
  let state = 'idle'; // idle | playing | paused | ended
  let t0 = 0; // audio-clock time at which the piece's time 0 falls
  let pausedAt = 0; // piece position while paused
  let seekWhilePaused = false;
  let nextEvent = 0;
  let timer = null;
  let raf = null;
  let slowTimer = null;
  let autoResume = false;
  let idleTimer = null;
  let composing = false;
  let colors = {};

  // ---------------------------------------------------------------- seeds
  function seedFromHash() {
    const m = location.hash.match(/seed=([^&]+)/);
    if (!m) return null;
    try {
      return decodeURIComponent(m[1]);
    } catch (e) {
      return m[1]; // a malformed escape is still a usable seed, just not a pretty one
    }
  }
  // Math.random is used only to pick a seed; the music itself is a pure function of the seed.
  const randomSeed = () => String(Math.floor(Math.random() * 1e6));
  function setHash(seed) {
    try {
      history.replaceState(null, '', '#seed=' + encodeURIComponent(seed));
    } catch (e) {
      location.hash = 'seed=' + encodeURIComponent(seed);
    }
  }

  function composeSeed(seed) {
    let p;
    try {
      p = P.compose(seed);
    } catch (e) {
      // compose() falls back to easier settings itself and never failed in testing; if it ever does,
      // say so instead of leaving a dead page.
      els.meta.textContent = 'seed ' + seed + ': no legal melody found. Try New seed.';
      return null;
    }
    piece = p;
    setHash(seed);
    els.meta.textContent = describe(p);
    els.playBtn.disabled = false;
    els.midiBtn.disabled = false;
    els.introFine.textContent = 'Sound on. Headphones help. ' + fmtTime(p.duration) + ' long.';
    draw();
    return p;
  }

  function describe(p) {
    const v = p.voices.length;
    return `seed ${p.seed} · ${p.mode.finalName} ${p.mode.name} · ${v} voices at ${P.describeProportions(p.ratios)} · ${p.stats.notes} notes · ${fmtTime(p.duration)}`;
  }

  function fmtTime(s) {
    s = Math.max(0, Math.round(s));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  // ---------------------------------------------------------------- audio
  function ensureAudio() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC({ latencyHint: 'playback' });
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
    } catch (e) {
      /* optional */
    }
    engine = P.createEngine(ctx);
  }

  function startPerformance(fromPos) {
    if (!piece) return;
    ensureAudio();
    clearTimeout(idleTimer);
    if (ctx.state !== 'running') ctx.resume();
    if (perf) perf.release(ctx.currentTime, 0.08);
    perf = engine.createPerformance(piece);
    const pos = Math.max(0, Math.min(piece.duration, fromPos || 0));
    t0 = ctx.currentTime + 0.15 - pos;
    nextEvent = 0;
    // notes already in progress at the seek point are replayed for their remaining time
    while (nextEvent < piece.events.length && piece.events[nextEvent].t < pos) {
      const ev = piece.events[nextEvent++];
      const remaining = ev.t + ev.dur - pos;
      if (remaining > 0.08) perf.play(Object.assign({}, ev, { dur: remaining }), t0 + pos);
    }
    state = 'playing';
    seekWhilePaused = false;
    startTimer();
    updateButtons();
  }

  function tick() {
    if (!ctx || state !== 'playing') return;
    const now = ctx.currentTime;
    while (nextEvent < piece.events.length && t0 + piece.events[nextEvent].t < now + LOOKAHEAD) {
      const ev = piece.events[nextEvent++];
      perf.play(ev, t0 + ev.t);
    }
    if (now - t0 >= piece.duration + 0.2) onEnded();
  }

  function startTimer() {
    stopTimer();
    timer = setInterval(tick, TICK);
    tick();
    startDrawing();
  }
  function stopTimer() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  /**
   * The audio-clock time that is reaching the speakers now. ctx.currentTime runs ahead of what is
   * heard by the output latency; getOutputTimestamp says which context time the device is playing,
   * so the playhead and the highlighted notes match the sound, not the scheduler.
   */
  function heardTime() {
    const now = ctx.currentTime;
    if (ctx.getOutputTimestamp && ctx.state === 'running') {
      const ts = ctx.getOutputTimestamp();
      if (ts && ts.contextTime > 0 && ts.performanceTime > 0) {
        const t = ts.contextTime + Math.max(0, (performance.now() - ts.performanceTime) / 1000);
        return Math.min(now, t);
      }
    }
    return now - (ctx.outputLatency || ctx.baseLatency || 0);
  }

  function position() {
    if (!piece) return 0;
    if (state === 'paused') return pausedAt;
    if (state === 'ended') return piece.duration;
    if (state !== 'playing' || !ctx) return 0;
    return Math.max(0, Math.min(piece.duration, heardTime() - t0));
  }

  // Pausing suspends the whole audio clock, so every note already scheduled stays exactly where it
  // was relative to t0 and nothing is left sounding. Resuming does not touch t0.
  function pause() {
    if (state !== 'playing') return;
    pausedAt = position();
    state = 'paused';
    stopTimer();
    ctx.suspend();
    updateButtons();
    draw();
  }

  function resume() {
    if (state !== 'paused') return;
    if (seekWhilePaused) {
      startPerformance(pausedAt);
      return;
    }
    ctx.resume();
    state = 'playing';
    startTimer();
    updateButtons();
  }

  function onEnded() {
    state = 'ended';
    stopTimer();
    updateButtons();
    draw();
    // let the last chord and the room ring out, then stop the audio clock to save power
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (state === 'ended' && ctx && ctx.state === 'running') ctx.suspend();
    }, 15000);
  }

  function seekTo(pos) {
    if (!piece) return;
    pos = Math.max(0, Math.min(piece.duration, pos));
    if (state === 'playing') startPerformance(pos);
    else if (state === 'paused') {
      pausedAt = pos;
      seekWhilePaused = true;
      draw();
    } else if (state === 'ended' || (state === 'idle' && ctx)) startPerformance(pos);
  }

  function begin() {
    if (!piece) return;
    els.intro.hidden = true;
    startPerformance(0);
  }

  function updateButtons() {
    const b = els.playBtn;
    b.textContent = state === 'playing' ? 'Pause' : state === 'paused' ? 'Resume' : 'Play';
  }

  // ---------------------------------------------------------------- controls
  els.intro.addEventListener('click', () => begin());
  els.start.addEventListener('click', (e) => {
    e.stopPropagation();
    begin();
  });
  els.playBtn.addEventListener('click', () => {
    if (state === 'playing') pause();
    else if (state === 'paused') resume();
    else {
      els.intro.hidden = true;
      startPerformance(0);
    }
  });
  els.againBtn.addEventListener('click', () => {
    if (!piece) return;
    els.intro.hidden = true;
    startPerformance(0);
  });
  els.newBtn.addEventListener('click', () => newSeed());
  els.midiBtn.addEventListener('click', () => downloadMidi());
  els.helpBtn.addEventListener('click', () => toggleHelp());
  els.helpClose.addEventListener('click', () => toggleHelp(false));

  function toggleHelp(force) {
    const open = force === undefined ? els.help.hidden : force;
    els.help.hidden = !open;
    els.helpBtn.setAttribute('aria-expanded', String(open));
  }

  function newSeed() {
    if (composing) return;
    composing = true;
    const wasRunning = state === 'playing' || state === 'paused' || state === 'ended';
    if (ctx && ctx.state !== 'running' && wasRunning) ctx.resume();
    if (perf) perf.release(ctx ? ctx.currentTime : 0, 0.1);
    perf = null;
    stopTimer();
    state = 'idle';
    els.meta.textContent = 'composing…';
    els.words.textContent = '';
    // let the "composing…" paint before the search runs
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        composing = false;
        if (composeSeed(randomSeed()) && wasRunning) startPerformance(0);
        else draw();
        updateButtons();
      })
    );
  }

  function downloadMidi() {
    if (!piece) return;
    const bytes = P.midiFile(piece);
    const blob = new Blob([bytes], { type: 'audio/midi' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `prolation-${piece.seed}.mid`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  document.addEventListener('keydown', (e) => {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (!els.intro.hidden) begin();
      else if (state === 'playing') pause();
      else if (state === 'paused') resume();
      else if (state === 'ended') startPerformance(0);
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      seekTo(position() + SEEK_STEP);
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      seekTo(position() - SEEK_STEP);
    } else if (e.code === 'KeyR') {
      if (piece && ctx) {
        els.intro.hidden = true;
        startPerformance(0);
      }
    } else if (e.code === 'KeyN') newSeed();
    else if (e.code === 'KeyM') downloadMidi();
    else if (e.key === '?') toggleHelp();
    else if (e.code === 'Escape') toggleHelp(false);
  });

  els.roll.addEventListener('pointerdown', (e) => {
    if (!piece) return;
    const r = els.roll.getBoundingClientRect();
    const win = rollWindow();
    const t = win.from + ((e.clientX - r.left) / r.width) * (win.to - win.from);
    if (!els.intro.hidden) {
      els.intro.hidden = true;
      startPerformance(t);
    } else seekTo(t);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (state === 'playing') {
        autoResume = true;
        pause();
      }
    } else if (autoResume) {
      autoResume = false;
      resume();
    }
  });

  window.addEventListener('hashchange', () => {
    const s = seedFromHash();
    if (s && piece && s !== piece.seed) {
      const wasRunning = state === 'playing';
      if (perf) perf.release(ctx.currentTime, 0.1);
      perf = null;
      stopTimer();
      state = 'idle';
      if (composeSeed(s) && wasRunning) startPerformance(0);
      updateButtons();
      draw();
    }
  });

  // ---------------------------------------------------------------- drawing
  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    const g = (n) => cs.getPropertyValue(n).trim();
    colors = { bg: g('--bg2'), fg: g('--fg'), muted: g('--muted'), line: g('--line'), card: g('--card'), voices: [g('--v0'), g('--v1'), g('--v2'), g('--v3')] };
  }
  readColors();
  darkScheme.addEventListener('change', () => {
    readColors();
    draw();
  });

  function fit(canvas) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return null;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { g, w, h };
  }

  function startDrawing() {
    if (reducedMotion.matches) {
      if (!slowTimer) slowTimer = setInterval(draw, 250);
    } else if (!raf) raf = requestAnimationFrame(frame);
  }
  function frame() {
    raf = null;
    draw();
    if (state === 'playing') raf = requestAnimationFrame(frame);
  }
  reducedMotion.addEventListener('change', () => {
    if (slowTimer) clearInterval(slowTimer);
    slowTimer = null;
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    if (state === 'playing') startDrawing();
  });
  window.addEventListener('resize', draw);

  function rollWindow() {
    if (reducedMotion.matches) return { from: 0, to: piece.duration };
    const w = els.roll.clientWidth || 390;
    const span = Math.max(18, Math.min(45, w / 14));
    const pos = position();
    return { from: pos - span * 0.3, to: pos + span * 0.7 };
  }

  function draw() {
    if (!piece) return;
    const pos = position();
    drawStrip(pos);
    drawRoll(pos);
    els.time.textContent = `${fmtTime(pos)} / ${fmtTime(piece.duration)}`;
    els.words.textContent = narrative(pos);
  }

  function narrative(pos) {
    const vs = piece.voices;
    if (state === 'ended') return 'Ended: every voice on the final, together.';
    if (state === 'idle') return 'The slowest voice begins alone.';
    const entered = vs.filter((v) => v.start <= pos + 1e-6).length;
    if (piece.duration - pos < 12) return 'They arrive together.';
    const r0 = vs[0].ratio;
    const ord = ['', 'second', 'third', 'fourth'];
    if (entered <= 1) return 'The bass sings the melody alone, slowly.';
    const v = vs[entered - 1];
    const gcd = (a, b) => (b ? gcd(b, a % b) : a);
    const g = gcd(r0, v.ratio);
    const num = r0 / g, den = v.ratio / g;
    const speed = den === 1 ? (num === 2 ? 'twice as fast as' : `${num} times as fast as`) : `${num}/${den} the speed of`;
    return `The ${ord[entered - 1]} voice is in: the same melody, ${speed} the bass.`;
  }

  function drawStrip(pos) {
    const f = fit(els.strip);
    if (!f) return;
    const { g, w, h } = f;
    g.clearRect(0, 0, w, h);
    const padL = 10, padR = 10, top = 20, bottom = 10;
    const lo = P.MELODY_LO, hi = P.MELODY_HI;
    const X = (pulse) => padL + (pulse / piece.pulses) * (w - padL - padR);
    const Y = (deg) => top + (1 - (deg - lo) / (hi - lo)) * (h - top - bottom);
    const bassPulse = Math.max(0, (pos - piece.voices[0].start) / piece.voices[0].pulse);
    g.font = '11px system-ui, sans-serif';
    g.fillStyle = colors.muted;
    g.textBaseline = 'top';
    g.fillText('one melody · ' + piece.stats.notes + ' notes · each voice reads it at its own speed', padL, 4);
    // the melody
    let cum = 0;
    for (let k = 0; k < piece.values.length; k++) {
      const d = Math.abs(piece.values[k]);
      const deg = piece.melody[k];
      if (deg !== null) {
        const x1 = X(cum), x2 = X(cum + d);
        // the bass is always furthest along the melody, so what it has sung is what has been heard
        g.fillStyle = cum < bassPulse ? colors.fg : colors.muted;
        g.globalAlpha = cum < bassPulse ? 0.85 : 0.4;
        g.fillRect(x1, Y(deg) - 1.5, Math.max(1.5, x2 - x1 - 1), 3);
      }
      cum += d;
    }
    g.globalAlpha = 1;
    // cursors
    piece.voices.forEach((v, i) => {
      const p = Math.max(0, Math.min(piece.pulses, (pos - v.start) / v.pulse));
      const waiting = pos < v.start;
      const x = X(p);
      g.strokeStyle = colors.voices[i];
      g.globalAlpha = waiting ? 0.3 : 0.9;
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(x, top - 4);
      g.lineTo(x, h - bottom + 4);
      g.stroke();
      // the note under this cursor
      const k = slotAtPulse(p);
      if (!waiting && k >= 0 && piece.melody[k] !== null) {
        g.fillStyle = colors.voices[i];
        g.beginPath();
        g.arc(x, Y(piece.melody[k]), 3.5, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
    });
  }

  function slotAtPulse(p) {
    let cum = 0;
    for (let k = 0; k < piece.values.length; k++) {
      const d = Math.abs(piece.values[k]);
      if (p < cum + d) return k;
      cum += d;
    }
    return piece.values.length - 1;
  }

  function drawRoll(pos) {
    const f = fit(els.roll);
    if (!f) return;
    const { g, w, h } = f;
    g.clearRect(0, 0, w, h);
    const win = rollWindow();
    const X = (t) => ((t - win.from) / (win.to - win.from)) * w;
    const lowMidi = Math.min(...piece.voices.map((v) => v.lowMidi)) - 1;
    const highMidi = Math.max(...piece.voices.map((v) => v.highMidi)) + 1;

    // Labels for the entries and the end, laid out first: any label that would overlap the one
    // before it drops to the next line, and the notes start below the lowest line used.
    g.font = '11px system-ui, sans-serif';
    g.textBaseline = 'top';
    const narrow = w < 560;
    const ord = ['first', 'second', 'third', 'fourth'];
    const marks = piece.voices.map((v, i) => ({
      x: X(v.start),
      color: colors.voices[i],
      dash: true,
      text: i === 0 ? (narrow ? 'bass' : 'the bass begins') : narrow ? `${ord[i]} in` : `${ord[i]} voice enters`,
    }));
    marks.push({ x: X(piece.duration), color: colors.fg, dash: false, text: 'together' });
    const shown = marks.filter((m) => m.x > -80 && m.x < w + 10);
    const rowsRight = [];
    for (const m of shown) {
      const tw = g.measureText(m.text).width;
      m.lx = Math.max(2, Math.min(w - tw - 4, m.x + 4));
      let row = 0;
      while (rowsRight[row] !== undefined && m.lx < rowsRight[row] + 8) row++;
      rowsRight[row] = m.lx + tw;
      m.row = row;
    }
    const top = 22 + 13 * Math.max(0, rowsRight.length - 1), bottom = 8;
    const rowH = (h - top - bottom) / (highMidi - lowMidi + 1);
    const Y = (m) => top + (highMidi - m) * rowH;
    // guide lines on every octave of the final
    g.strokeStyle = colors.line;
    g.lineWidth = 1;
    for (let m = lowMidi; m <= highMidi; m++) {
      if ((m - piece.mode.final) % 12 === 0) {
        g.beginPath();
        g.moveTo(0, Y(m) + rowH / 2);
        g.lineTo(w, Y(m) + rowH / 2);
        g.stroke();
      }
    }
    for (const m of shown) {
      g.strokeStyle = m.color;
      g.lineWidth = 1;
      g.setLineDash(m.dash ? [3, 4] : []);
      g.beginPath();
      g.moveTo(m.x, 4 + 13 * m.row + 12);
      g.lineTo(m.x, h - bottom);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = m.color;
      g.fillText(m.text, m.lx, 4 + 13 * m.row);
    }
    // notes
    const noteH = Math.max(3, rowH - 1);
    for (const ev of piece.events) {
      const x1 = X(ev.t), x2 = X(ev.t + ev.dur);
      if (x2 < 0 || x1 > w) continue;
      const sounding = ev.t <= pos && pos < ev.t + ev.dur;
      const past = ev.t + ev.dur <= pos;
      g.fillStyle = colors.voices[ev.voice];
      g.globalAlpha = sounding ? 1 : past ? 0.32 : 0.72;
      const y = Y(ev.midi) + (rowH - noteH) / 2;
      roundRect(g, x1, y, Math.max(2, x2 - x1 - 1), noteH, 2);
      g.fill();
      if (sounding) {
        g.globalAlpha = 0.9;
        g.strokeStyle = colors.fg;
        g.lineWidth = 1;
        g.stroke();
      }
    }
    g.globalAlpha = 1;
    // playhead
    const xp = X(pos);
    g.strokeStyle = colors.fg;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(xp, top - 8);
    g.lineTo(xp, h - bottom + 2);
    g.stroke();
  }

  function roundRect(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + r, y);
    g.lineTo(x + w - r, y);
    g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r);
    g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    g.lineTo(x + r, y + h);
    g.quadraticCurveTo(x, y + h, x, y + h - r);
    g.lineTo(x, y + r);
    g.quadraticCurveTo(x, y, x + r, y);
    g.closePath();
  }

  // ---------------------------------------------------------------- boot
  updateButtons();
  // let the page paint "composing…" before the search runs (usually well under a second)
  requestAnimationFrame(() =>
    setTimeout(() => {
      composeSeed(seedFromHash() || randomSeed());
      updateButtons();
    }, 0)
  );

  // for tests and the curious
  window.ProlationApp = {
    get piece() {
      return piece;
    },
    get state() {
      return state;
    },
    get audio() {
      return ctx ? ctx.state : 'none';
    },
    position,
    seekTo,
    pause,
    resume,
    begin,
  };
})();
