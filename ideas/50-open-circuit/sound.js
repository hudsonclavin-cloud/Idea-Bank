/* sound.js — every click in the museum, synthesized with Web Audio.
 *
 * Nothing is loaded. Each sound is a short burst of filtered noise (the
 * contact) and a damped low tone (the body it is mounted in). The audio
 * context is created on the first gesture, as browsers require.
 */
window.Sound = (function () {
  'use strict';
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let level = 1;
  let failed = false;

  function init() {
    if (ctx || failed) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) throw new Error('no AudioContext');
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.55 * level;
      master.connect(ctx.destination);
      const n = Math.floor(ctx.sampleRate * 0.5);
      noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) {
      failed = true;
      ctx = null;
    }
  }

  function unlock() {
    init();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  // A burst of noise through a band-pass filter: the sound of a contact.
  function burst(t, freq, q, gain, dur, type = 'bandpass') {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    src.loopStart = 0;
    src.loopEnd = 0.5;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t, Math.random() * 0.4);
    src.stop(t + dur + 0.02);
  }

  // A damped tone: the body of the switch, or a ringing part.
  function tone(t, freq, to, gain, dur, type = 'sine') {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to && to !== freq) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  // A small motor: a low saw through a low-pass, with a slight wobble.
  function whirr(t, dur, gain) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(95, t);
    o.frequency.linearRampToValueAtTime(118, t + dur * 0.3);
    o.frequency.linearRampToValueAtTime(102, t + dur);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 520;
    f.Q.value = 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0005, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.03);
    g.gain.setValueAtTime(gain, t + dur - 0.05);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(f).connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  const recipes = {
    // toggles
    snap: (t) => {
      burst(t, 2800, 1.0, 0.5, 0.008);
      burst(t, 6000, 0.7, 0.25, 0.004);
      tone(t, 180, 90, 0.35, 0.07);
    },
    rocker: (t) => {
      burst(t, 1800, 1.2, 0.4, 0.012);
      tone(t, 150, 80, 0.3, 0.08);
    },
    // knobs and sliders
    detent: (t) => {
      burst(t, 2200, 1.5, 0.35, 0.006);
      tone(t, 330, 240, 0.2, 0.035);
    },
    slide: (t) => {
      burst(t, 3500, 2, 0.3, 0.005);
      tone(t, 260, 200, 0.15, 0.03);
    },
    stop: (t) => {
      burst(t, 900, 1, 0.2, 0.01);
      tone(t, 120, 100, 0.22, 0.04);
    },
    // push buttons
    down: (t) => {
      burst(t, 3000, 1, 0.4, 0.006);
      tone(t, 150, 100, 0.25, 0.05);
    },
    up: (t) => {
      burst(t, 3600, 1, 0.22, 0.005);
      tone(t, 200, 150, 0.12, 0.03);
    },
    keydown: (t) => {
      burst(t, 5200, 1.5, 0.45, 0.004);
      tone(t, 3400, 3000, 0.12, 0.012);
    },
    keyup: (t) => {
      burst(t, 4500, 1.5, 0.22, 0.004);
    },
    bottom: (t) => {
      tone(t, 220, 160, 0.2, 0.04);
      burst(t, 1200, 1, 0.2, 0.008);
    },
    click: (t) => {
      burst(t, 2600, 1, 0.4, 0.006);
      tone(t, 170, 110, 0.3, 0.05);
    },
    latch: (t) => {
      tone(t, 120, 90, 0.3, 0.07);
      burst(t, 1500, 1, 0.25, 0.01);
    },
    unlatch: (t) => {
      tone(t, 160, 120, 0.2, 0.05);
      burst(t, 2000, 1, 0.2, 0.008);
    },
    tick: (t) => {
      burst(t, 6500, 2, 0.22, 0.003);
      tone(t, 4200, 4000, 0.06, 0.008);
    },
    // heavy things
    clack: (t) => {
      burst(t, 1600, 0.8, 0.6, 0.02);
      tone(t, 95, 60, 0.5, 0.14);
      tone(t, 2100, 2050, 0.08, 0.09);
      tone(t, 3150, 3100, 0.05, 0.06);
    },
    open: (t) => {
      burst(t, 800, 0.5, 0.1, 0.07);
    },
    clunk: (t) => {
      burst(t, 1200, 0.8, 0.4, 0.01);
      tone(t, 110, 70, 0.4, 0.09);
    },
    trip: (t) => {
      burst(t, 2200, 0.8, 0.7, 0.012);
      tone(t, 70, 45, 0.6, 0.18);
      burst(t, 400, 0.6, 0.3, 0.06);
    },
    reset: (t) => {
      burst(t, 1600, 1, 0.4, 0.01);
      tone(t, 140, 90, 0.35, 0.07);
    },
    refuse: (t) => {
      burst(t, 900, 1, 0.2, 0.014);
      tone(t, 130, 110, 0.15, 0.05);
    },
    thunk: (t) => {
      tone(t, 85, 55, 0.55, 0.13);
      burst(t, 700, 0.8, 0.35, 0.014);
    },
    pop: (t) => {
      tone(t, 600, 1400, 0.2, 0.03, 'triangle');
      burst(t, 2500, 1, 0.3, 0.006);
      tone(t + 0.02, 180, 120, 0.2, 0.05);
    },
    dead: (t) => {
      burst(t, 500, 1, 0.1, 0.012);
    },
    lift: (t) => {
      burst(t, 1400, 1, 0.25, 0.014);
      tone(t, 200, 160, 0.15, 0.04);
    },
    drop: (t) => {
      tone(t, 140, 90, 0.3, 0.07);
      burst(t, 1000, 1, 0.3, 0.014);
    },
    blocked: (t) => {
      burst(t, 600, 1, 0.15, 0.016);
    },
    creak: (t) => {
      tone(t, 170, 230, 0.035, 0.18, 'triangle');
    },
    motor: (t) => {
      whirr(t, 0.26, 0.05);
    },
    tally: (t) => {
      burst(t, 3200, 1, 0.45, 0.006);
      tone(t, 240, 180, 0.25, 0.04);
      burst(t + 0.03, 5000, 1.5, 0.2, 0.003);
    },
  };

  function play(name, delay = 0) {
    if (!ctx || level === 0 || ctx.state !== 'running') return;
    const r = recipes[name];
    if (!r) return;
    try {
      r(ctx.currentTime + 0.004 + delay);
    } catch (e) {
      /* a sound that fails to schedule is not worth a console error */
    }
  }

  function setLevel(x) {
    level = x;
    if (master) master.gain.setTargetAtTime(0.55 * level, ctx.currentTime, 0.02);
  }

  return { unlock, play, setLevel, has: (n) => !!recipes[n] };
})();
