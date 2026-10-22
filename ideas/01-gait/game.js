/* Gait: rendering, input, sound and game flow. The rules live in logic.js. */
(() => {
  'use strict';
  const G = window.GaitLogic;
  const { SHAPES, stride, PERIMETER, Course, Runner, planGear } = G;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (t) => t * t * (3 - 2 * t);
  const rollEase = (p) => 0.6 * p + 0.4 * p * p; // tip slowly, fall onto the next side
  const NAME = { 3: 'triangle', 4: 'square', 5: 'pentagon', 6: 'hexagon' };

  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem('gait.' + k);
        return v === null ? d : JSON.parse(v);
      } catch (e) {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem('gait.' + k, JSON.stringify(v));
      } catch (e) {
        /* storage unavailable: progress just isn't remembered */
      }
    },
  };

  const mq = (q) => (window.matchMedia ? window.matchMedia(q) : { matches: false });
  const motionMQ = mq('(prefers-reduced-motion: reduce)');
  const darkMQ = mq('(prefers-color-scheme: dark)');
  let reduced = motionMQ.matches;
  if (motionMQ.addEventListener) motionMQ.addEventListener('change', (e) => (reduced = e.matches));

  // ---------------------------------------------------------------------------- palette
  let P;
  const rgbCache = {};
  function rgb(hex) {
    if (rgbCache[hex]) return rgbCache[hex];
    const h = hex.replace('#', '');
    const v = h.length === 3 ? h.split('').map((c) => parseInt(c + c, 16)) : [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    return (rgbCache[hex] = v);
  }
  function mix(a, b, t) {
    const A = rgb(a);
    const B = rgb(b);
    return `rgb(${Math.round(A[0] + (B[0] - A[0]) * t)},${Math.round(A[1] + (B[1] - A[1]) * t)},${Math.round(A[2] + (B[2] - A[2]) * t)})`;
  }
  function readPalette() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n, d) => cs.getPropertyValue(n).trim() || d;
    const dark = darkMQ.matches;
    P = {
      dark,
      paper: v('--paper', '#f6f1e7'),
      paper2: v('--paper-2', '#ece3d2'),
      ink: v('--ink', '#1e2033'),
      gold: v('--gold', '#f5b700'),
      danger: v('--danger', '#e0362b'),
      shape: { 3: v('--c3', '#ec5a3c'), 4: v('--c4', '#3e9f55'), 5: v('--c5', '#1f8fc4'), 6: v('--c6', '#7155d6') },
      ground: dark ? '#2b2d45' : '#dccaa6',
      ground2: dark ? '#202236' : '#cbb58c',
      line: dark ? '#ece6d8' : '#1e2033',
      hole0: dark ? '#06070d' : '#2a2c3e',
      hole1: dark ? '#000000' : '#0c0d16',
      tick: dark ? 'rgba(236,230,216,0.38)' : 'rgba(30,32,51,0.42)',
      faint: dark ? 'rgba(236,230,216,0.07)' : 'rgba(30,32,51,0.07)',
      trail: dark ? 'rgba(236,230,216,0.34)' : 'rgba(30,32,51,0.3)',
      outline: '#1e2033',
    };
  }
  readPalette();

  // ---------------------------------------------------------------------------- outlines
  // Each shape is sampled at one point per unit of string (60 points), starting at the
  // corner we pivot on, going counter-clockwise; the last side lies on the ground behind it.
  // Equal perimeters mean sample k of one shape and sample k of another are "the same bit
  // of string", so blending samples is a morph that looks like a loop being re-tensioned.
  const NS = PERIMETER;
  const CANON = {};
  for (const n of SHAPES) {
    const s = stride(n);
    const verts = [[0, 0]];
    for (let j = 0; j < n; j++) {
      const a = ((j + 1) * 2 * Math.PI) / n;
      verts.push([verts[j][0] + s * Math.cos(a), verts[j][1] + s * Math.sin(a)]);
    }
    const out = new Float32Array(NS * 2);
    for (let k = 0; k < NS; k++) {
      const j = Math.floor(k / s);
      const t = k - j * s;
      const a = ((j + 1) * 2 * Math.PI) / n;
      out[2 * k] = verts[j][0] + t * Math.cos(a);
      out[2 * k + 1] = verts[j][1] + t * Math.sin(a);
    }
    CANON[n] = out;
  }

  /** SVG points for a flat-bottomed regular n-gon with the game's perimeter, centred. */
  function iconPoints(n, size) {
    const s = stride(n);
    const R = s / (2 * Math.sin(Math.PI / n));
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + Math.PI / n + (i * 2 * Math.PI) / n;
      pts.push([R * Math.cos(a), -R * Math.sin(a)]);
    }
    const ys = pts.map((p) => p[1]);
    const mid = (Math.min(...ys) + Math.max(...ys)) / 2;
    const k = size / 24;
    return pts.map(([x, y]) => `${(x * k).toFixed(2)},${((y - mid) * k).toFixed(2)}`).join(' ');
  }

  // ---------------------------------------------------------------------------- DOM
  const $ = (id) => document.getElementById(id);
  const canvas = $('stage');
  const ctx = canvas.getContext('2d');
  const el = {
    dist: $('dist'),
    best: $('best'),
    score: $('score'),
    chain: $('chain'),
    chainText: $('chainText'),
    coach: $('coach'),
    gears: $('gears'),
    intro: $('intro'),
    over: $('over'),
    paused: $('paused'),
    startBtn: $('startBtn'),
    againBtn: $('againBtn'),
    resumeBtn: $('resumeBtn'),
    helpBtn: $('helpBtn'),
    muteBtn: $('muteBtn'),
    oDist: $('oDist'),
    oCause: $('oCause'),
    oScore: $('oScore'),
    oChimes: $('oChimes'),
    oChain: $('oChain'),
    oBest: $('oBest'),
    oStrip: $('oStrip'),
    oTip: $('oTip'),
  };
  const gearButtons = Array.from(document.querySelectorAll('.gear'));
  for (const b of gearButtons) {
    const n = Number(b.dataset.n);
    b.innerHTML = `<span class="k">${n}</span><svg viewBox="-13 -13 26 26" aria-hidden="true"><polygon points="${iconPoints(n, 22)}"/></svg><span class="m">${(stride(n) / 10).toFixed(1)} m</span>`;
  }

  // ---------------------------------------------------------------------------- sound
  const Sound = (() => {
    let ac = null;
    let out = null;
    let noise = null;
    let muted = !!store.get('muted', false);
    const VOL = 0.55;
    function unlock() {
      if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        try {
          ac = new AC();
        } catch (e) {
          return;
        }
        out = ac.createGain();
        out.gain.value = muted ? 0 : VOL;
        const comp = ac.createDynamicsCompressor();
        out.connect(comp);
        comp.connect(ac.destination);
        noise = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.5), ac.sampleRate);
        const d = noise.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      if (ac.state === 'suspended' && ac.resume) ac.resume().catch(() => {});
    }
    const ready = () => ac && ac.state === 'running' && !muted;
    function env(g, t, a, peak, d) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    }
    function tone(type, f0, f1, t, a, d, peak) {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + a + d);
      env(g, t, a, peak, d);
      o.connect(g);
      g.connect(out);
      o.start(t);
      o.stop(t + a + d + 0.05);
    }
    function hiss(t, dur, freq, q, peak) {
      const s = ac.createBufferSource();
      s.buffer = noise;
      const f = ac.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ac.createGain();
      env(g, t, 0.002, peak, dur);
      s.connect(f);
      f.connect(g);
      g.connect(out);
      s.start(t, Math.random() * 0.3);
      s.stop(t + dur + 0.05);
    }
    // The four shapes are the notes of a G major chord, so a run plays its own rhythm.
    const PITCH = { 3: 196.0, 4: 246.94, 5: 293.66, 6: 392.0 };
    const jitter = () => 1 + (Math.random() - 0.5) * 0.05;
    return {
      unlock,
      get muted() {
        return muted;
      },
      setMuted(m) {
        muted = m;
        store.set('muted', m);
        if (out) out.gain.setTargetAtTime(m ? 0 : VOL, ac.currentTime, 0.02);
      },
      tock(n) {
        if (!ready()) return;
        const t = ac.currentTime;
        const f = PITCH[n] * jitter();
        tone('triangle', f * 2, f, t, 0.003, 0.12, 0.34);
        hiss(t, 0.035, 2400 * jitter(), 1.4, 0.2);
      },
      chime(streak) {
        if (!ready()) return;
        const t = ac.currentTime;
        const steps = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
        const f = 587.33 * Math.pow(2, steps[Math.min(streak - 1, steps.length - 1)] / 12);
        tone('sine', f, 0, t, 0.004, 1.0, 0.22);
        tone('sine', f * 2.76, 0, t, 0.002, 0.4, 0.06);
        tone('sine', f * 5.4, 0, t, 0.002, 0.18, 0.03);
      },
      edge() {
        if (!ready()) return;
        const t = ac.currentTime;
        tone('square', 1500 * jitter(), 1100, t + 0.01, 0.001, 0.05, 0.05);
      },
      shift(n) {
        if (!ready()) return;
        tone('sine', PITCH[n] * 4, 0, ac.currentTime, 0.002, 0.045, 0.05);
      },
      lost() {
        if (!ready()) return;
        const t = ac.currentTime;
        tone('sine', 520, 300, t, 0.004, 0.22, 0.08);
      },
      milestone() {
        if (!ready()) return;
        const t = ac.currentTime;
        tone('triangle', 784, 0, t, 0.004, 0.25, 0.14);
        tone('triangle', 1174.66, 0, t + 0.1, 0.004, 0.4, 0.14);
      },
      fall() {
        if (!ready()) return;
        const t = ac.currentTime;
        tone('sine', 320, 40, t, 0.005, 0.75, 0.42);
        hiss(t, 0.3, 200, 0.7, 0.5);
      },
    };
  })();

  // ---------------------------------------------------------------------------- layout
  let W = 0;
  let H = 0;
  let DPR = 1;
  let scale = 4;
  let viewW = 200;
  let leftFrac = 0.25;
  let groundY = 400;
  let skyGrad;
  let earthGrad;
  let holeGrad;

  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, window.innerWidth);
    H = Math.max(1, window.innerHeight);
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    const gearsTop = el.gears.getBoundingClientRect().top || H - 100;
    const portrait = H > W * 1.2;
    groundY = Math.round(Math.min(gearsTop - Math.max(70, H * 0.12), H * (portrait ? 0.57 : 0.6)));
    groundY = Math.max(groundY, 140);
    // Phones see about 9 m ahead of the loop: enough to spot any trap in time (see README).
    viewW = clamp(W / 3.4, 110, 300);
    scale = W / viewW;
    const maxScale = (groundY - 70) / 30; // keep the loop and its arcs clear of the HUD
    if (scale > maxScale) {
      scale = Math.max(1.6, maxScale);
      viewW = W / scale;
    }
    leftFrac = W < 600 ? 0.2 : 0.26;
    const hudBottom = document.querySelector('.hud').getBoundingClientRect().bottom || 120;
    el.coach.style.top = `${Math.round(Math.max(hudBottom + 10, groundY - 36 * scale - 60))}px`;
    buildGradients();
  }
  function buildGradients() {
    skyGrad = ctx.createLinearGradient(0, 0, 0, groundY);
    skyGrad.addColorStop(0, P.paper);
    skyGrad.addColorStop(1, P.paper2);
    earthGrad = ctx.createLinearGradient(0, groundY, 0, H);
    earthGrad.addColorStop(0, P.ground);
    earthGrad.addColorStop(1, P.ground2);
    // Holes are darkest at the mouth, where the game is decided, and sink into the earth below.
    holeGrad = ctx.createLinearGradient(0, groundY, 0, H);
    holeGrad.addColorStop(0, P.hole0);
    holeGrad.addColorStop(Math.min(0.5, 110 / Math.max(1, H - groundY)), P.hole1);
    holeGrad.addColorStop(1, P.dark ? 'rgba(0,0,0,0.35)' : 'rgba(12,13,22,0.28)');
  }
  if (darkMQ.addEventListener) {
    darkMQ.addEventListener('change', () => {
      readPalette();
      buildGradients();
    });
  }

  const sx = (x) => (x - camX) * scale;

  // ---------------------------------------------------------------------------- state
  const seedParam = (() => {
    const m = /[?&]seed=(\d+)/.exec(location.search);
    return m ? Number(m[1]) >>> 0 : null;
  })();
  let best = store.get('best', null);
  if (!best || typeof best.dist !== 'number' || typeof best.score !== 'number') best = { dist: 0, score: 0 };
  let runs = Number(store.get('runs', 0)) || 0;

  let mode = 'intro'; // intro | play | falling | over | paused
  let pausedFrom = null;
  let course = null;
  let runner = null;
  let camX = 0;
  let time = 0;
  let fallT = 0;
  let overAt = -10;
  let trauma = 0;
  let squash = 0;
  let flash = 0;
  let happyT = 0;
  let blinkT = 2;
  let milestone = 0;
  let passedBest = false;
  let demoDecided = -1;
  let banner = null;
  let particles = [];
  let texts = [];
  let trail = [];
  const view = { runner: null, stepId: -1, from: null, fromN: 4, to: 4, m: 1, dur: 0.15, cur: new Float32Array(NS * 2), world: new Float32Array(NS * 2) };

  function newRun(gear, isDemo) {
    const seed = !isDemo && seedParam !== null ? seedParam : (Math.random() * 4294967296) >>> 0;
    course = new Course(seed);
    runner = new Runner(course, gear || 4);
    runner.start();
    particles = [];
    texts = [];
    trail = [];
    milestone = 0;
    passedBest = false;
    demoDecided = -1;
    banner = null;
    trauma = 0;
    flash = 0;
    camX = runner.x - leftFrac * viewW;
  }

  // ---------------------------------------------------------------------------- coach
  const coach = { until: 0, shown: new Set() };
  function say(id, text, dur) {
    if (coach.shown.has(id)) return;
    coach.shown.add(id);
    el.coach.textContent = text;
    el.coach.classList.add('show');
    coach.until = time + (dur || 2.8);
  }
  function hush() {
    el.coach.classList.remove('show');
    coach.until = 0;
  }
  function coachTick() {
    if (coach.until && time > coach.until) hush();
    if (runs > 3 || best.dist > 1500) return;
    const r = runner;
    if (r.steps === 0 && r.phase > 0.2) say('start', 'Every corner is a footstep. The dotted arcs show where the next ones land.', 3.4);
    if (r.steps < 1 || coach.until) return;
    let a = r.target;
    for (let k = 0; k < 2; k++) {
      a += stride(r.gear);
      if (course.isPit(a)) {
        say('red', 'An arc ends in a hole! Pick a shape whose arcs land on ground.', 3);
        return;
      }
    }
    const ci = course.firstChimeAtOrAfter(r.x + 1);
    const c = course.chimes[ci];
    if (coach.shown.has('red') && c !== undefined && c - r.x < 70) say('chime', 'Gold chime ahead. Land a corner exactly on it.', 3);
  }

  // ---------------------------------------------------------------------------- effects
  function spawn(x, y, vx, vy, life, color, size, kind) {
    if (particles.length > 240) particles.shift();
    particles.push({ x, y, vx, vy, life, max: life, color, size, kind: kind || 0 });
  }
  function popText(x, y, text, color, size) {
    texts.push({ x, y, text, color, size: size || 15, life: 1.0, max: 1.0 });
    if (texts.length > 12) texts.shift();
  }
  function dust(x, n) {
    const count = reduced ? 2 : 5;
    for (let i = 0; i < count; i++) {
      spawn(x + (Math.random() - 0.5) * 2, 0.4, (Math.random() - 0.5) * 30, 6 + Math.random() * 16, 0.32 + Math.random() * 0.2, P.line, 0.9 + Math.random() * 0.7);
    }
    if (!reduced) spawn(x, 0.3, 0, 0, 0.28, P.shape[n], 1, 1); // ring
  }
  function chimeBurst(x) {
    const count = reduced ? 5 : 16;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const sp = 18 + Math.random() * 22;
      spawn(x, 5, Math.cos(a) * sp, Math.sin(a) * sp + 10, 0.55 + Math.random() * 0.3, P.gold, 1.2 + Math.random(), 2);
    }
  }

  // ---------------------------------------------------------------------------- events
  function onEvent(ev) {
    const quiet = mode === 'intro';
    if (ev.type === 'land') {
      squash = 1;
      dust(ev.x, ev.n);
      if (quiet) return;
      Sound.tock(ev.n);
      if (ev.chime) {
        chimeBurst(ev.x);
        happyT = 0.55;
        popText(ev.x, 27, `+${ev.points - (ev.pin ? 10 : ev.edge ? 5 : 0)}`, P.gold, 18);
        if (ev.streak >= 2) popText(ev.x, 33, `chain ×${ev.streak}`, P.ink, 13);
        Sound.chime(ev.streak);
        el.chain.classList.remove('pop');
        void el.chain.offsetWidth;
        el.chain.classList.add('pop');
        setTimeout(() => el.chain.classList.remove('pop'), 140);
      }
      if (ev.pin) {
        popText(ev.x, ev.chime ? 39 : 27, 'PIN +10', P.shape[ev.n], 14);
        Sound.edge();
        trauma = Math.min(1, trauma + 0.14);
      } else if (ev.edge) {
        popText(ev.x, ev.chime ? 39 : 27, 'EDGE +5', P.shape[ev.n], 13);
        Sound.edge();
        trauma = Math.min(1, trauma + 0.08);
      }
      if (ev.brokeStreak >= 2) {
        Sound.lost();
        el.chain.classList.remove('lost');
        void el.chain.offsetWidth;
        el.chain.classList.add('lost');
        setTimeout(() => el.chain.classList.remove('lost'), 340);
      }
      const m = Math.floor(runner.dist / 1000);
      if (m > milestone) {
        milestone = m;
        banner = { text: `${m * 100} m`, t: 0, gold: false };
        Sound.milestone();
      }
      if (!passedBest && best.dist >= 200 && runner.dist > best.dist) {
        passedBest = true;
        banner = { text: 'New best!', t: 0, gold: true };
        Sound.milestone();
      }
    } else if (ev.type === 'fall') {
      if (quiet) {
        newRun(4, true);
        return;
      }
      mode = 'falling';
      fallT = -0.09; // a beat of hit-stop before the tumble
      trauma = Math.min(1, trauma + 0.7);
      flash = 1;
      hush();
      Sound.fall();
      for (let i = 0; i < (reduced ? 4 : 14); i++) {
        spawn(ev.x + (Math.random() - 0.5) * 4, 0.5, (Math.random() - 0.5) * 40, 10 + Math.random() * 24, 0.5 + Math.random() * 0.3, Math.random() < 0.5 ? P.danger : P.line, 1 + Math.random(), 0);
      }
    }
  }

  // ---------------------------------------------------------------------------- flow
  function setOverlay(which) {
    el.intro.classList.toggle('hidden', which !== 'intro');
    el.over.classList.toggle('hidden', which !== 'over');
    el.paused.classList.toggle('hidden', which !== 'paused');
    el.helpBtn.style.visibility = which === 'intro' ? 'hidden' : 'visible';
  }

  function startGame(gear) {
    Sound.unlock();
    newRun(gear || 4, false);
    mode = 'play';
    pausedFrom = null;
    runs++;
    store.set('runs', runs);
    coach.shown.clear();
    hush();
    setOverlay(null);
    el.startBtn.innerHTML = 'Roll <kbd>Space</kbd>';
    syncGearButtons();
    syncHud(true);
    canvas.focus({ preventScroll: true });
  }

  function pause(showHelp) {
    if (mode !== 'play') return;
    pausedFrom = 'play';
    mode = 'paused';
    hush();
    if (showHelp) {
      el.startBtn.innerHTML = 'Resume <kbd>Space</kbd>';
      setOverlay('intro');
      el.helpBtn.style.visibility = 'hidden';
    } else setOverlay('paused');
  }
  function resume() {
    if (mode !== 'paused') return;
    mode = pausedFrom || 'play';
    pausedFrom = null;
    el.startBtn.innerHTML = 'Roll <kbd>Space</kbd>';
    setOverlay(null);
  }

  function primary() {
    Sound.unlock();
    if (mode === 'intro') startGame(4);
    else if (mode === 'paused') resume();
    else if (mode === 'over' && time - overAt > 0.45) startGame(4);
  }

  function showOver() {
    mode = 'over';
    overAt = time;
    const r = runner;
    const dist = r.dist;
    const metres = dist % 10 === 0 ? String(dist / 10) : (dist / 10).toFixed(1);
    el.oDist.textContent = metres;
    el.oScore.textContent = r.score;
    el.oChimes.textContent = r.chimeCount;
    el.oChain.textContent = r.bestStreak;
    const isBest = r.score > best.score || dist > best.dist;
    el.oBest.classList.toggle('hidden', !(isBest && runs > 1));
    el.oBest.textContent = dist > best.dist && r.score > best.score ? 'New best distance and score' : dist > best.dist ? 'New best distance' : 'New best score';
    best = { dist: Math.max(best.dist, dist), score: Math.max(best.score, r.score) };
    store.set('best', best);

    const f = r.fall;
    let cause = '';
    if (f && f.pit) {
      const into = Math.min(f.x - f.pit.a, f.pit.b - f.x) / 10;
      cause = `Your ${NAME[f.n]} put a corner ${into.toFixed(1)} m past the lip of a ${((f.pit.b - f.pit.a) / 10).toFixed(1)} m hole. `;
      const safe = SHAPES.filter((n) => n !== f.n && course.viable(f.from + stride(n)));
      const solid = SHAPES.filter((n) => n !== f.n && !course.isPit(f.from + stride(n)));
      if (safe.length) cause += `A ${NAME[safe[0]]} would have kept you going.`;
      else if (solid.length) cause += 'Every other shape led into a trap too: the mistake came a step earlier.';
      else cause += 'No shape could land safely from there: the mistake came a step earlier.';
    }
    el.oCause.textContent = cause;

    const hist = r.history.slice(-24);
    el.oStrip.innerHTML = hist
      .map((h, i) => {
        const last = i === hist.length - 1 && r.state === 'fallen';
        return `<svg viewBox="-13 -13 26 26" class="${last ? 'last' : ''}" aria-hidden="true"><polygon points="${iconPoints(h.n, 20)}" fill="${P.shape[h.n]}"/></svg>`;
      })
      .join('');
    el.oTip.textContent = TIPS[(runs - 1) % TIPS.length];
    setOverlay('over');
    syncHud(true);
  }

  const TIPS = [
    'Watch the second arc, not the first. By the time the first one ends in a hole, that step is already decided.',
    'A 6 m loop covers 6 m every full turn, whatever its shape. Your speed never changes, only your rhythm.',
    'Triangles clear any hole (2 m is the longest stride there is), but long strides are the hardest to place.',
    'Hexagons take short, quick steps, which is handy for threading narrow islands.',
    'Landing on the very lip of a hole is safe and worth +5. A lone post between two holes is worth +10.',
    'Shift right as a corner touches down and the new shape still counts for that step.',
    'Strides of 2.0, 1.5, 1.2 and 1.0 m can add up to any distance beyond 5.3 m, if no hole is in the way.',
    'Some patches of ground are traps: you can land there, but every way out ends in a hole. They are always within two steps of the hole that springs them.',
  ];

  // ---------------------------------------------------------------------------- HUD
  const hudCache = {};
  function setText(node, key, value) {
    if (hudCache[key] === value) return;
    hudCache[key] = value;
    node.textContent = value;
  }
  function syncHud(force) {
    if (force) for (const k in hudCache) delete hudCache[k];
    const live = mode !== 'intro' && runner;
    setText(el.dist, 'dist', live ? String(Math.floor(runner.dist / 10)) : '0');
    setText(el.score, 'score', live ? String(runner.score) : '0');
    setText(el.best, 'best', String(Math.floor(best.dist / 10)));
    const streak = live ? runner.streak : 0;
    setText(el.chainText, 'chain', streak ? `chain ×${streak}` : 'chain 0');
    el.chain.classList.toggle('hot', streak >= 2);
  }
  let shownGear = null;
  function syncGearButtons() {
    const g = mode === 'intro' || !runner ? -1 : runner.gear;
    if (g === shownGear) return;
    shownGear = g;
    for (const b of gearButtons) {
      const on = Number(b.dataset.n) === g;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  // ---------------------------------------------------------------------------- input
  function pressGear(n) {
    Sound.unlock();
    if (mode === 'intro') return startGame(n);
    if (mode === 'over') {
      if (time - overAt > 0.45) startGame(n);
      return;
    }
    if (mode === 'paused') resume();
    if (mode !== 'play') return;
    if (runner.setGear(n)) Sound.shift(n);
    syncGearButtons();
  }
  function shiftGear(delta) {
    if (mode === 'paused') resume();
    if (mode !== 'play') return;
    const i = SHAPES.indexOf(runner.gear);
    const n = SHAPES[clamp(i + delta, 0, SHAPES.length - 1)];
    pressGear(n);
  }

  for (const b of gearButtons) {
    const n = Number(b.dataset.n);
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      b.classList.add('press');
      pressGear(n);
    });
    const up = () => b.classList.remove('press');
    b.addEventListener('pointerup', up);
    b.addEventListener('pointerleave', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('click', (e) => {
      if (e.detail === 0) pressGear(n); // keyboard activation; pointer presses were handled on pointerdown
    });
  }
  el.startBtn.addEventListener('click', () => {
    if (mode === 'paused') resume();
    else primary();
  });
  el.againBtn.addEventListener('click', () => primary());
  el.resumeBtn.addEventListener('click', () => resume());
  el.helpBtn.addEventListener('click', () => {
    if (mode === 'play') pause(true);
    else if (mode === 'paused') {
      el.startBtn.innerHTML = 'Resume <kbd>Space</kbd>';
      setOverlay('intro');
    } else if (mode === 'over') {
      setOverlay('intro');
      mode = 'intro';
      newRun(4, true);
      syncHud(true);
      syncGearButtons();
    }
  });
  function syncMute() {
    el.muteBtn.setAttribute('aria-pressed', Sound.muted ? 'true' : 'false');
    el.muteBtn.setAttribute('aria-label', Sound.muted ? 'Unmute sound' : 'Mute sound');
  }
  el.muteBtn.addEventListener('click', () => {
    Sound.unlock();
    Sound.setMuted(!Sound.muted);
    syncMute();
  });
  syncMute();

  canvas.tabIndex = -1;
  canvas.addEventListener('pointerdown', () => {
    if (mode === 'intro' || mode === 'over' || mode === 'paused') primary();
  });
  let wheelAt = 0;
  canvas.addEventListener(
    'wheel',
    (e) => {
      if (mode !== 'play') return;
      e.preventDefault();
      if (time - wheelAt < 0.09 || Math.abs(e.deltaY) < 2) return;
      wheelAt = time;
      shiftGear(e.deltaY < 0 ? 1 : -1);
    },
    { passive: false },
  );

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (k.length === 1 && k >= '3' && k <= '6') {
      e.preventDefault();
      if (!e.repeat) pressGear(Number(k));
      return;
    }
    if (k === 'ArrowUp' || k === 'w' || k === 'W') {
      e.preventDefault();
      if (!e.repeat) shiftGear(1);
      return;
    }
    if (k === 'ArrowDown' || k === 's' || k === 'S') {
      e.preventDefault();
      if (!e.repeat) shiftGear(-1);
      return;
    }
    if (k === ' ' || k === 'Enter') {
      if (e.target && e.target.closest && e.target.closest('.icon-btn')) return; // let focused buttons act
      e.preventDefault();
      if (!e.repeat) primary();
      return;
    }
    if (k === 'p' || k === 'P' || k === 'Escape') {
      if (mode === 'play') pause(false);
      else if (mode === 'paused') resume();
      return;
    }
    if (k === 'm' || k === 'M') {
      Sound.unlock();
      Sound.setMuted(!Sound.muted);
      syncMute();
    }
  });
  // Audio may only start from a user gesture; different browsers count different ones.
  for (const type of ['pointerdown', 'pointerup', 'touchend', 'keydown']) {
    window.addEventListener(type, () => Sound.unlock(), { capture: true, passive: true });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause(false);
  });
  window.addEventListener('blur', () => pause(false));
  window.addEventListener('resize', resize);

  // ---------------------------------------------------------------------------- update
  function updateMorph(dt) {
    const r = runner;
    if (view.runner !== r || view.stepId !== r.stepId) {
      const fresh = view.runner !== r;
      view.runner = r;
      view.stepId = r.stepId;
      if (!fresh && r.prevN !== r.n) {
        view.from = CANON[r.prevN];
        view.fromN = r.prevN;
        view.m = 0;
        view.dur = clamp(0.45 * r.stepDuration(), 0.05, 0.16);
      } else {
        view.m = 1;
        view.fromN = r.n;
      }
      view.to = r.n;
    } else if (r.n !== view.to) {
      view.from = view.cur.slice();
      view.fromN = view.to;
      view.to = r.n;
      view.m = 0;
      view.dur = clamp(0.4 * r.stepDuration(), 0.05, 0.14);
    }
    if (view.m < 1) view.m = Math.min(1, view.m + dt / view.dur);
    const b = CANON[view.to];
    if (view.m >= 1) view.cur.set(b);
    else {
      const a = view.from;
      const m = smooth(view.m);
      for (let i = 0; i < b.length; i++) view.cur[i] = a[i] + (b[i] - a[i]) * m;
    }
  }

  function demoPilot() {
    const r = runner;
    if (demoDecided !== r.stepId && r.stepAge > r.grace()) {
      demoDecided = r.stepId;
      const g = planGear(course, r.target, r.gear);
      if (g) r.setGear(g);
    }
    if (r.dist > 1600) newRun(4, true);
  }

  function update(dt) {
    time += dt;
    if (mode === 'paused') return;
    if (mode === 'play' || mode === 'intro') {
      if (mode === 'intro') demoPilot();
      const evs = runner.update(dt);
      for (const ev of evs) onEvent(ev);
      if (mode === 'play') {
        coachTick();
        syncGearButtons();
      }
    } else if (mode === 'falling') {
      fallT += dt;
      if (fallT > 1.05) showOver();
    }
    if (mode === 'play' || mode === 'intro') {
      const follow = runner.x + (runner.target - runner.x) * runner.phase;
      camX = follow - leftFrac * viewW;
    }
    course.ensure(camX + viewW + 260);
    updateMorph(dt);

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      if (p.kind !== 1) {
        p.vy -= (p.kind === 2 ? 40 : 90) * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
    }
    for (let i = texts.length - 1; i >= 0; i--) {
      const t = texts[i];
      t.life -= dt;
      t.y += 9 * dt;
      if (t.life <= 0) texts.splice(i, 1);
    }
    trauma = Math.max(0, trauma - 1.7 * dt);
    squash = Math.max(0, squash - dt / 0.13);
    flash = Math.max(0, flash - dt * 2.4);
    happyT -= dt;
    blinkT -= dt;
    if (blinkT < -0.12) blinkT = 2 + Math.random() * 3.5;
    if (banner) {
      banner.t += dt;
      if (banner.t > 1.8) banner = null;
    }
    if (mode !== 'intro') syncHud(false);
  }

  // ---------------------------------------------------------------------------- draw
  function noise(t, k) {
    return Math.sin(t * 1.0 + k * 1.7) * 0.5 + Math.sin(t * 2.3 + k * 4.1) * 0.3 + Math.sin(t * 4.7 + k * 2.9) * 0.2;
  }
  function hash(i) {
    let h = Math.imul(i ^ 0x5bd1e995, 0x27d4eb2d);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }

  function drawSky() {
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, W, groundY + 2);
    // Drifting outlines of the four shapes, far away (parallax 0.18).
    const par = 0.18;
    const slot = 150;
    const base = camX * scale * par;
    const first = Math.floor(base / slot) - 1;
    const count = Math.ceil(W / slot) + 2;
    ctx.strokeStyle = P.faint;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    for (let i = first; i < first + count; i++) {
      const h1 = hash(i);
      if (h1 < 0.35) continue;
      const n = SHAPES[Math.floor(hash(i + 999) * 4)];
      const x = i * slot - base + hash(i + 7) * 60;
      const y = 40 + hash(i + 3) * (groundY * 0.55);
      const R = 14 + hash(i + 11) * 30;
      const rot = (reduced ? 0 : time * 0.12 * (hash(i + 5) - 0.5)) + hash(i + 13) * 6;
      ctx.beginPath();
      for (let j = 0; j <= n; j++) {
        const a = rot + (j * 2 * Math.PI) / n;
        const px = x + R * Math.cos(a);
        const py = y + R * Math.sin(a);
        if (j) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      }
      ctx.stroke();
    }
  }

  function drawGround(xL, xR) {
    const gy = groundY;
    const deep = H + 300;
    ctx.fillStyle = earthGrad;
    ctx.fillRect(-W * 0.3, gy, W * 1.6, deep);
    // strata that slide with the world
    ctx.strokeStyle = P.faint;
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const y = gy + 30 + i * 30 + i * i * 6;
      const dash = 20 + i * 9;
      ctx.setLineDash([dash, dash * 1.4]);
      ctx.lineDashOffset = camX * scale;
      ctx.beginPath();
      ctx.moveTo(-W * 0.3, y);
      ctx.lineTo(W * 1.3, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    const pits = course.pits;
    const i0 = course.firstPitAfter(xL);
    const fallPit = (mode === 'falling' || mode === 'over') && runner.fall ? runner.fall.pit : null;
    for (let i = i0; i < pits.length && pits[i].a < xR; i++) {
      const p = pits[i];
      const l = sx(p.a);
      const r = sx(p.b);
      ctx.fillStyle = holeGrad;
      ctx.fillRect(l, gy - 0.5, r - l, deep);
      if (p === fallPit) {
        ctx.fillStyle = P.danger;
        ctx.globalAlpha = 0.25 + 0.35 * flash;
        ctx.fillRect(l, gy, r - l, deep);
        ctx.globalAlpha = 1;
      }
    }
    // single posts between two touching holes
    const pinW = Math.max(3, 0.8 * scale);
    for (let i = Math.max(0, i0 - 1); i < pits.length - 1 && pits[i].a < xR; i++) {
      if (pits[i].b !== pits[i + 1].a) continue;
      const x = sx(pits[i].b);
      ctx.fillStyle = P.ground;
      ctx.fillRect(x - pinW / 2, gy, pinW, deep);
    }
    // surface line and lips
    ctx.strokeStyle = P.line;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    let cur = xL;
    for (let i = i0; i < pits.length && pits[i].a < xR; i++) {
      const p = pits[i];
      if (p.a > cur) {
        ctx.moveTo(sx(cur), gy);
        ctx.lineTo(sx(p.a), gy);
      }
      cur = Math.max(cur, p.b);
      if (i + 1 < pits.length && pits[i + 1].a === p.b) {
        ctx.moveTo(sx(p.b) - pinW / 2 - 1, gy);
        ctx.lineTo(sx(p.b) + pinW / 2 + 1, gy);
      }
    }
    if (cur < xR) {
      ctx.moveTo(sx(cur), gy);
      ctx.lineTo(sx(xR), gy);
    }
    ctx.stroke();
    // lips: a short wall line down each side of each hole
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    for (let i = i0; i < pits.length && pits[i].a < xR; i++) {
      for (const x of [pits[i].a, pits[i].b]) {
        ctx.moveTo(sx(x), gy);
        ctx.lineTo(sx(x), gy + 14);
      }
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // ruler ticks: every half metre, labelled every 10 m
    ctx.strokeStyle = P.tick;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let x = Math.ceil(xL / 5) * 5; x <= xR; x += 5) {
      if (course.isPit(x)) continue;
      const len = x % 50 === 0 ? 10 : x % 10 === 0 ? 6 : 3;
      ctx.moveTo(sx(x), gy + 2);
      ctx.lineTo(sx(x), gy + 2 + len);
    }
    ctx.stroke();
    ctx.fillStyle = P.tick;
    ctx.font = '600 10px ui-rounded, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let x = Math.ceil(xL / 100) * 100; x <= xR; x += 100) {
      if (course.isPit(x)) continue;
      ctx.fillText(`${x / 10} m`, sx(x), gy + 15);
    }
  }

  function drawFlags(xL, xR) {
    const gy = groundY;
    const poleH = Math.max(44, 13 * scale);
    const flags = [];
    if (mode !== 'intro') {
      for (let x = Math.ceil(Math.max(1, xL) / 1000) * 1000; x <= xR; x += 1000) flags.push({ x, label: `${x / 10} m`, gold: false });
      if (best.dist >= 200 && best.dist >= xL && best.dist <= xR) flags.push({ x: best.dist, label: 'best', gold: true });
    }
    for (const f of flags) {
      const X = sx(f.x);
      ctx.strokeStyle = P.line;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(X, gy);
      ctx.lineTo(X, gy - poleH);
      ctx.stroke();
      ctx.fillStyle = f.gold ? P.gold : P.paper;
      ctx.beginPath();
      ctx.moveTo(X, gy - poleH);
      ctx.lineTo(X + 34, gy - poleH + 8);
      ctx.lineTo(X, gy - poleH + 16);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = P.line;
      ctx.font = '700 10px ui-rounded, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(f.label, X + 4, gy - poleH - 3);
    }
  }

  function drawFootprints(xL, xR) {
    const gy = groundY;
    const h = runner.history;
    for (let i = 0; i < h.length; i++) {
      const s = h[i];
      if (s.x < xL || s.x > xR || course.isPit(s.x)) continue;
      const X = sx(s.x);
      ctx.fillStyle = P.shape[s.n];
      ctx.beginPath();
      ctx.moveTo(X, gy + 1.5);
      ctx.lineTo(X - 3.5, gy + 8);
      ctx.lineTo(X + 3.5, gy + 8);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawChimes(xL, xR) {
    const gy = groundY;
    const ch = course.chimes;
    const rad = clamp(1.55 * scale, 5, 9);
    const stem = Math.max(14, 4.6 * scale);
    for (let j = course.firstChimeAtOrAfter(Math.floor(xL)); j < ch.length && ch[j] <= xR; j++) {
      const x = ch[j];
      if (runner.taken.has(x)) continue;
      const missed = runner.missed.has(x);
      const X = sx(x);
      const bob = reduced ? 0 : Math.sin(time * 3.2 + x * 0.7) * 1.6;
      ctx.globalAlpha = missed ? 0.35 : 1;
      ctx.strokeStyle = P.line;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(X, gy);
      ctx.lineTo(X, gy - stem + bob + rad);
      ctx.stroke();
      // the exact spot, a small diamond on the surface
      ctx.fillStyle = missed ? P.tick : P.gold;
      ctx.beginPath();
      ctx.moveTo(X, gy - 3.5);
      ctx.lineTo(X + 3.5, gy);
      ctx.lineTo(X, gy + 3.5);
      ctx.lineTo(X - 3.5, gy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(X, gy - stem + bob, rad, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = P.outline;
      ctx.stroke();
      if (!missed) {
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath();
        ctx.arc(X - rad * 0.35, gy - stem + bob - rad * 0.35, rad * 0.28, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  function strideArc(a, b, color, dashed, alpha) {
    const gy = groundY;
    const A = sx(a);
    const B = sx(b);
    const h = 0.34 * (b - a) * scale;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = dashed ? 2 : 2.4;
    ctx.setLineDash(dashed ? [4, 5] : []);
    ctx.beginPath();
    ctx.moveTo(A, gy - 1);
    ctx.quadraticCurveTo((A + B) / 2, gy - 2 * h, B, gy - 1);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  function landMark(x, kind, color, alpha) {
    const X = sx(x);
    const gy = groundY - 1;
    ctx.globalAlpha = alpha;
    if (kind === 'pit') {
      const s = 5.5;
      ctx.strokeStyle = P.danger;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(X - s, gy - s);
      ctx.lineTo(X + s, gy + s);
      ctx.moveTo(X + s, gy - s);
      ctx.lineTo(X - s, gy + s);
      ctx.stroke();
      ctx.lineCap = 'butt';
    } else {
      ctx.fillStyle = kind === 'solid' ? color : P.paper;
      ctx.strokeStyle = kind === 'chime' ? P.gold : color;
      ctx.lineWidth = kind === 'chime' ? 3 : 2;
      ctx.beginPath();
      ctx.arc(X, gy, kind === 'chime' ? 6.5 : 4.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawGuides() {
    if (mode !== 'play' && mode !== 'intro') return;
    const r = runner;
    const nowC = P.shape[r.n];
    const gearC = P.shape[r.gear];
    strideArc(r.x, r.target, nowC, false, 0.55);
    let a = r.target;
    const g = stride(r.gear);
    const marks = [];
    for (let k = 1; k <= 3; k++) {
      const b = a + g;
      const pit = course.isPit(b);
      const alpha = [0.95, 0.6, 0.32][k - 1];
      strideArc(a, b, pit ? P.danger : gearC, true, alpha);
      marks.push([b, pit ? 'pit' : course.isChime(b) && !r.taken.has(b) ? 'chime' : 'ring', gearC, alpha]);
      if (pit) break;
      a = b;
    }
    const doomed = course.isPit(r.target);
    landMark(r.target, doomed ? 'pit' : course.isChime(r.target) ? 'chime' : 'solid', nowC, 1);
    for (const m of marks) landMark(m[0], m[1], m[2], m[3]);
  }

  function drawTrail() {
    if (trail.length < 2) return;
    ctx.strokeStyle = P.trail;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.setLineDash([0.1, 6]);
    ctx.beginPath();
    for (let i = 0; i < trail.length; i += 2) {
      const X = sx(trail[i]);
      const Y = groundY - trail[i + 1] * scale;
      if (i) ctx.lineTo(X, Y);
      else ctx.moveTo(X, Y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineCap = 'butt';
  }

  function drawRunner() {
    const r = runner;
    const falling = mode === 'falling' || mode === 'over';
    const ft = Math.max(0, fallT);
    if (falling && ft > 1.0) return;
    const pivot = r.x;
    let theta = ((2 * Math.PI) / r.n) * rollEase(r.phase);
    let drop = 0;
    if (falling) {
      theta = (2 * Math.PI) / r.n + Math.min(1.3, ft * 5);
      drop = ft > 0.08 ? 300 * (ft - 0.08) * (ft - 0.08) : 0;
    }
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const cur = view.cur;
    const w = view.world;
    let cx = 0;
    let cy = 0;
    for (let k = 0; k < NS; k++) {
      const lx = cur[2 * k];
      const ly = cur[2 * k + 1];
      let wx = pivot + lx * cos + ly * sin;
      let wy = -lx * sin + ly * cos;
      if (falling) wy -= drop;
      else if (wy < 0) wy = 0;
      w[2 * k] = wx;
      w[2 * k + 1] = wy;
      cx += wx;
      cy += wy;
    }
    cx /= NS;
    cy /= NS;
    if (squash > 0 && !falling) {
      const k = squash * squash;
      for (let i = 0; i < NS; i++) {
        w[2 * i] = cx + (w[2 * i] - cx) * (1 + 0.06 * k);
        w[2 * i + 1] *= 1 - 0.09 * k;
      }
      cy *= 1 - 0.09 * k;
    }
    if (!falling && (mode === 'play' || mode === 'intro')) {
      const last = trail.length - 2;
      if (last < 0 || cx - trail[last] > 0.7) trail.push(cx, cy);
      while (trail.length > 2 && trail[0] < camX - 20) trail.splice(0, 2);
    }
    drawTrail();

    ctx.save();
    if (falling && r.fall && r.fall.pit) {
      ctx.beginPath();
      ctx.rect(-W, -H, W * 3, groundY + H);
      ctx.rect(sx(r.fall.pit.a), groundY - 1, sx(r.fall.pit.b) - sx(r.fall.pit.a), H * 2);
      ctx.clip();
    }
    const gy = groundY;
    const m = view.m < 1 ? smooth(view.m) : 1;
    const fill = m < 1 ? mix(P.shape[view.fromN], P.shape[view.to], m) : P.shape[view.to];
    ctx.beginPath();
    for (let k = 0; k < NS; k++) {
      const X = sx(w[2 * k]);
      const Y = gy - w[2 * k + 1] * scale;
      if (k) ctx.lineTo(X, Y);
      else ctx.moveTo(X, Y);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineJoin = 'round';
    ctx.lineWidth = clamp(0.55 * scale, 2, 3.5);
    ctx.strokeStyle = P.outline;
    ctx.stroke();

    // corners: new ones fade in as the loop re-forms; the next foot to land gets a ring
    const dotR = clamp(0.6 * scale, 2.2, 4);
    const corners = (n, alpha, ringNext) => {
      if (alpha <= 0.02) return;
      const s = stride(n);
      ctx.globalAlpha = alpha;
      for (let j = 0; j < n; j++) {
        const k = Math.round(j * s) % NS;
        const X = sx(w[2 * k]);
        const Y = gy - w[2 * k + 1] * scale;
        ctx.beginPath();
        ctx.arc(X, Y, dotR, 0, Math.PI * 2);
        ctx.fillStyle = '#fffdf7';
        ctx.fill();
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = P.outline;
        ctx.stroke();
        if (ringNext && j === 1 && !falling) {
          ctx.beginPath();
          ctx.arc(X, Y, dotR + 3, 0, Math.PI * 2);
          ctx.lineWidth = 2;
          ctx.strokeStyle = course.isPit(r.target) ? P.danger : P.outline;
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    };
    if (m < 1) corners(view.fromN, 1 - m, false);
    corners(view.to, m, true);

    drawEyes(cx, cy, falling);
    ctx.restore();
  }

  function drawEyes(cx, cy, dead) {
    const r = runner;
    const X = sx(cx);
    const Y = groundY - cy * scale - 1.1 * scale;
    const dx = clamp(2.3 * scale, 6, 13);
    const rw = clamp(1.5 * scale, 4, 8);
    const worried = !dead && course.isPit(r.target);
    const happy = !dead && happyT > 0;
    const blink = !dead && !happy && blinkT < 0 ? 0.15 : 1;
    const look = clamp((sx(r.target) - X) / 140, -1, 1) * rw * 0.38;
    ctx.lineCap = 'round';
    for (const side of [-1, 1]) {
      const ex = X + side * dx;
      const ey = Y;
      if (dead) {
        const s = rw * 0.75;
        ctx.strokeStyle = P.outline;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(ex - s, ey - s);
        ctx.lineTo(ex + s, ey + s);
        ctx.moveTo(ex + s, ey - s);
        ctx.lineTo(ex - s, ey + s);
        ctx.stroke();
        continue;
      }
      if (happy) {
        ctx.strokeStyle = P.outline;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(ex, ey + rw * 0.35, rw * 0.8, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
        continue;
      }
      ctx.fillStyle = '#fffdf7';
      ctx.strokeStyle = P.outline;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(ex, ey, rw, rw * blink * (worried ? 1.15 : 1), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (blink === 1) {
        ctx.fillStyle = P.outline;
        ctx.beginPath();
        ctx.arc(ex + look, ey + rw * 0.25, rw * (worried ? 0.36 : 0.52), 0, Math.PI * 2);
        ctx.fill();
      }
      if (worried) {
        ctx.strokeStyle = P.outline;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(ex - side * rw * 0.9, ey - rw * 1.25);
        ctx.lineTo(ex + side * rw * 0.7, ey - rw * 1.75);
        ctx.stroke();
      }
    }
    ctx.lineCap = 'butt';
  }

  function drawParticles() {
    const gy = groundY;
    for (const p of particles) {
      const a = p.life / p.max;
      ctx.globalAlpha = a;
      const X = sx(p.x);
      const Y = gy - p.y * scale;
      if (p.kind === 1) {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(X, gy, (1 - a) * 5 * scale + 3, (1 - a) * 1.6 * scale + 1, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        const s = p.size * clamp(scale * 0.55, 1.6, 3.2);
        ctx.fillStyle = p.color;
        if (p.kind === 2) {
          ctx.beginPath();
          ctx.moveTo(X, Y - s * 1.4);
          ctx.lineTo(X + s * 0.5, Y);
          ctx.lineTo(X, Y + s * 1.4);
          ctx.lineTo(X - s * 0.5, Y);
          ctx.closePath();
          ctx.fill();
        } else ctx.fillRect(X - s / 2, Y - s / 2, s, s);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawTexts() {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const t of texts) {
      const age = t.max - t.life;
      const pop = age < 0.12 ? 0.6 + (age / 0.12) * 0.4 : 1;
      ctx.globalAlpha = Math.min(1, t.life / 0.35);
      ctx.font = `800 ${Math.round(t.size * pop)}px ui-rounded, system-ui, sans-serif`;
      const X = sx(t.x);
      const Y = groundY - t.y * scale;
      ctx.lineWidth = 4;
      ctx.strokeStyle = P.paper;
      ctx.strokeText(t.text, X, Y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, X, Y);
    }
    ctx.globalAlpha = 1;
  }

  function drawBanner() {
    if (!banner) return;
    const t = banner.t;
    const a = t < 0.2 ? t / 0.2 : t > 1.3 ? Math.max(0, 1 - (t - 1.3) / 0.5) : 1;
    const s = reduced ? 1 : t < 0.2 ? 0.85 + 0.15 * (t / 0.2) : 1;
    ctx.globalAlpha = a;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${Math.round(38 * s)}px ui-rounded, system-ui, sans-serif`;
    const y = Math.max(150, groundY * 0.42);
    ctx.lineWidth = 6;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = P.paper;
    ctx.strokeText(banner.text, W / 2, y);
    ctx.fillStyle = banner.gold ? P.gold : P.ink;
    ctx.fillText(banner.text, W / 2, y);
    if (banner.gold) {
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = P.outline;
      ctx.strokeText(banner.text, W / 2, y);
    }
    ctx.globalAlpha = 1;
  }

  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawSky();
    let ox = 0;
    let oy = 0;
    let rot = 0;
    if (!reduced && trauma > 0) {
      const s = trauma * trauma;
      const tt = time * 22;
      ox = 12 * s * noise(tt, 1);
      oy = 9 * s * noise(tt, 2);
      rot = 0.03 * s * noise(tt, 3);
    }
    ctx.save();
    ctx.translate(W / 2 + ox, groundY + oy);
    ctx.rotate(rot);
    ctx.translate(-W / 2, -groundY);
    const xL = camX - 6;
    const xR = camX + W / scale + 6;
    drawGround(xL, xR);
    drawFlags(xL, xR);
    drawFootprints(xL, xR);
    drawChimes(xL, xR);
    drawGuides();
    drawRunner();
    drawParticles();
    drawTexts();
    ctx.restore();
    if (flash > 0 && !reduced) {
      ctx.fillStyle = P.danger;
      ctx.globalAlpha = 0.16 * flash;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    drawBanner();
  }

  // ---------------------------------------------------------------------------- loop
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  resize();
  newRun(4, true);
  setOverlay('intro');
  syncHud(true);
  syncGearButtons();
  requestAnimationFrame(frame);

  // A small handle for the curious (and for automated checks): read-only views of the run.
  window.gait = {
    get mode() {
      return mode;
    },
    get runner() {
      return runner;
    },
    get course() {
      return course;
    },
    start: (n) => startGame(n),
    gear: (n) => pressGear(n),
  };
})();
