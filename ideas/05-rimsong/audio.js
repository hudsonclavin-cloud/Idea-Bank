// audio.js — the synthesis graph. Works against any BaseAudioContext (live AudioContext or an
// OfflineAudioContext for testing). Every method takes an explicit time so a whole performance can
// be scheduled ahead of time and rendered offline.
(function (R) {
  'use strict';
  const { MODE_RATIOS } = R;

  const LEVELS = {
    rub: 0.21, // a fully singing glass, before the master bus
    strike: 0.24, // a full-velocity tap
    friction: 2.2, // noise through a narrow band at the fundamental (the "breath" of a rubbed tone)
    squeak: 1.6, // noise around the next mode up, when you rub too fast
  };

  function makeNoise(ctx, seconds) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let seed = 0x2545f491;
    for (let i = 0; i < len; i++) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      d[i] = ((seed >>> 0) / 4294967296) * 2 - 1;
    }
    return buf;
  }

  /** A small, dark room: stereo exponentially-decaying noise, with the highs dying faster than the lows. */
  function makeImpulse(ctx, seconds = 2.8) {
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const buf = ctx.createBuffer(2, len, sr);
    const pre = Math.floor(sr * 0.018);
    let energy = 0;
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      let seed = ch ? 0x9e3779b9 : 0x7f4a7c15;
      for (let i = pre; i < len; i++) {
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        const n = ((seed >>> 0) / 4294967296) * 2 - 1;
        const t = (i - pre) / sr;
        lp += (n - lp) * 0.18; // darker component
        const fadeIn = Math.min(1, (i - pre) / (sr * 0.012));
        d[i] = fadeIn * (0.35 * n * Math.exp(-t / 0.22) + 1.1 * lp * Math.exp(-t / 0.5));
        energy += d[i] * d[i];
      }
    }
    const norm = 1 / Math.sqrt(energy / 2);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] *= norm;
    }
    return buf;
  }

  /** Soft ceiling: linear below 0.6, eases into a hard ceiling of ~0.9. Inputs past ±1 clamp to the ends. */
  function safetyCurve() {
    const n = 2049;
    const c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      const a = Math.abs(x);
      const y = a < 0.6 ? a : 0.6 + 0.3 * Math.tanh((a - 0.6) / 0.3);
      c[i] = Math.sign(x) * y;
    }
    return c;
  }

  function createMaster(ctx, { safety = true } = {}) {
    const input = ctx.createGain();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 70;
    hp.Q.value = 0.5;
    const dry = ctx.createGain();
    dry.gain.value = 0.85;
    const verb = ctx.createConvolver();
    verb.normalize = false;
    verb.buffer = makeImpulse(ctx);
    const wet = ctx.createGain();
    wet.gain.value = 0.3;
    const sum = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 12;
    comp.ratio.value = 3;
    comp.attack.value = 0.008;
    comp.release.value = 0.3;
    const trim = ctx.createGain();
    trim.gain.value = 0.7;
    const limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -4;
    limit.knee.value = 0;
    limit.ratio.value = 20;
    limit.attack.value = 0.001;
    limit.release.value = 0.08;
    const output = ctx.createGain();
    output.gain.value = 0.85;

    input.connect(hp);
    hp.connect(dry).connect(sum);
    hp.connect(verb).connect(wet).connect(sum);
    sum.connect(comp).connect(trim).connect(limit);
    if (safety) {
      const shaper = ctx.createWaveShaper();
      shaper.curve = safetyCurve();
      limit.connect(shaper).connect(output);
    } else {
      limit.connect(output);
    }
    return { input, output, comp, limit };
  }

  /** One glass's voice. Persistent oscillators for the rubbed tone (cheap, and nothing to leak);
   *  short-lived oscillators per tap, cleaned up when they end. */
  class GlassVoice {
    constructor(ctx, dest, noise, pan, index) {
      this.ctx = ctx;
      this.freq = 440;
      // The (2,0) mode is really two nearly-degenerate modes split by tiny asymmetries in the glass:
      // that split is the slow "wah" you hear in a ringing glass. Every glass gets its own.
      this.split = 0.45 + ((index * 0.6180339) % 1) * 1.2;
      this.last = {};
      this.strikes = new Set();

      this.panner = ctx.createStereoPanner();
      this.panner.pan.value = pan;
      this.panner.connect(dest);
      this.out = ctx.createGain();
      this.out.connect(this.panner);
      this.trem = ctx.createGain();
      this.trem.connect(this.out);
      this.rub = ctx.createGain();
      this.rub.gain.value = 0;
      this.rub.connect(this.trem);

      const tone = (ratio, level, detune = 0) => {
        const o = ctx.createOscillator();
        o.frequency.value = 440 * ratio + detune;
        const g = ctx.createGain();
        g.gain.value = level;
        o.connect(g).connect(this.rub);
        o.start();
        return { o, g, ratio, detune };
      };
      this.tones = [
        tone(1, 0.85),
        tone(1, 0.2, this.split), // the degenerate partner; its level is driven in setState
        tone(MODE_RATIOS[1], 0.045),
        tone(MODE_RATIOS[2], 0.012),
        tone(2, 0.03), // a faint true harmonic: stick-slip forcing is periodic, not sinusoidal (a design choice)
      ];

      // Friction "breath": the shared noise through a narrow band at the fundamental.
      this.fricBand = ctx.createBiquadFilter();
      this.fricBand.type = 'bandpass';
      this.fricBand.Q.value = 18;
      this.fric = ctx.createGain();
      this.fric.gain.value = 0;
      noise.connect(this.fricBand).connect(this.fric).connect(this.trem);

      // Squeak: rough noise near the (3,0) mode, which the glass jumps toward when over-driven.
      this.sqBand = ctx.createBiquadFilter();
      this.sqBand.type = 'bandpass';
      this.sqBand.Q.value = 9;
      this.sq = ctx.createGain();
      this.sq.gain.value = 0;
      // Stick-slip chatter: the squeak is gated on and off a few dozen times a second.
      this.chatter = ctx.createGain();
      this.chatter.gain.value = 0.5;
      this.chatterLfo = ctx.createOscillator();
      this.chatterLfo.type = 'triangle';
      this.chatterLfo.frequency.value = 27 + ((index * 0.381966) % 1) * 14;
      const depth = ctx.createGain();
      depth.gain.value = 0.5;
      this.chatterLfo.connect(depth).connect(this.chatter.gain);
      this.chatterLfo.start();
      noise.connect(this.sqBand).connect(this.sq).connect(this.chatter).connect(this.out);
    }

    _set(key, param, v, t, tau) {
      const prev = this.last[key];
      if (prev !== undefined && Math.abs(v - prev) <= Math.max(1e-5, Math.abs(prev) * 0.003) && !(v === 0 && prev !== 0)) {
        return;
      }
      this.last[key] = v;
      param.setTargetAtTime(v, t, tau);
    }

    setFreq(f, t, tau = 0.04) {
      if (Math.abs(f - this.freq) < 0.005 && this.last.freqSet) return;
      this.freq = f;
      this.last.freqSet = true;
      const nyq = this.ctx.sampleRate / 2;
      for (const tn of this.tones) {
        const fr = Math.min(f * tn.ratio + tn.detune, nyq * 0.9);
        tn.o.frequency.setTargetAtTime(fr, t, tau);
      }
      this.fricBand.frequency.setTargetAtTime(f, t, tau);
      this.sqBand.frequency.setTargetAtTime(Math.min(f * MODE_RATIOS[1], nyq * 0.8), t, tau);
    }

    /** Push the glass model's state into the graph. */
    setState(t, s) {
      const amp = s.amp;
      this._set('rub', this.rub.gain, LEVELS.rub * amp, t, 0.02);
      this._set('trem', this.trem.gain, s.trem, t, 0.012);
      this._set('fric', this.fric.gain, LEVELS.friction * LEVELS.rub * s.friction * (0.35 + 0.65 * amp), t, 0.03);
      this._set('sq', this.sq.gain, LEVELS.squeak * LEVELS.rub * s.squeak, t, 0.015);
      // Over-driving also pushes energy into the next mode up.
      this._set('p2', this.tones[2].g.gain, 0.045 + 0.32 * s.squeak, t, 0.02);
      // While a finger drives the glass it pins the vibration pattern to itself, so the split-mode
      // beating mostly shows up in the free ring-out after you lift.
      this._set('beat', this.tones[1].g.gain, 0.22 - 0.16 * Math.min(1, s.friction * 1.4), t, 0.15);
    }

    /** A tap on the bowl: every mode at once, the high ones dying fast. `bright` ∈ [0,1] (near the rim = brighter). */
    strike(t, vel = 0.8, bright = 0.5) {
      const ctx = this.ctx;
      const f = this.freq;
      const nyq = ctx.sampleRate / 2;
      // Keep at most a handful of rings per glass; fade the oldest.
      if (this.strikes.size >= 5) {
        const oldest = this.strikes.values().next().value;
        oldest.fade(t);
        this.strikes.delete(oldest);
      }
      const bus = ctx.createGain();
      bus.connect(this.out);
      const tauScale = (600 / f) ** 0.3;
      const modes = [
        [f, 0.78, 2.2],
        [f + this.split, 0.22, 2.4],
        [f * MODE_RATIOS[1], 0.32 * (0.35 + bright), 0.8],
        [f * MODE_RATIOS[2], 0.13 * (0.15 + bright), 0.32],
        [f * MODE_RATIOS[3], 0.06 * bright, 0.14],
      ];
      const nodes = [bus];
      const sources = [];
      let longest = null;
      let longestEnd = 0;
      const peak = LEVELS.strike * vel;
      for (const [fr, a, tau] of modes) {
        if (fr >= nyq * 0.9 || a <= 0) continue;
        const o = ctx.createOscillator();
        o.frequency.value = fr;
        const g = ctx.createGain();
        const T = tau * tauScale;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(a * peak, t + 0.003);
        g.gain.setTargetAtTime(0, t + 0.003, T);
        o.connect(g).connect(bus);
        o.start(t);
        const end = t + 0.003 + T * 7.5; // ≈ −65 dB, under the room tail
        o.stop(end);
        nodes.push(o, g);
        sources.push(o);
        if (end > longestEnd) {
          longestEnd = end;
          longest = o;
        }
      }
      // The tick of the fingernail.
      const click = ctx.createBufferSource();
      click.buffer = this.noiseBuffer;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 2500;
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0, t);
      cg.gain.linearRampToValueAtTime(0.05 * vel, t + 0.0007);
      cg.gain.setTargetAtTime(0, t + 0.0007, 0.004);
      click.connect(hp).connect(cg).connect(bus);
      click.start(t, Math.random() * 1.5);
      click.stop(t + 0.06);
      nodes.push(click, hp, cg);

      const rec = {
        // Fade fast and bring every stop forward, so damped or stolen rings free their nodes promptly.
        fade: (when) => {
          bus.gain.setTargetAtTime(0, when, 0.05);
          for (const o of sources) {
            try {
              o.stop(when + 0.4);
            } catch {
              /* already ended */
            }
          }
        },
      };
      this.strikes.add(rec);
      (longest || click).onended = () => {
        for (const n of nodes) n.disconnect();
        this.strikes.delete(rec);
      };
    }

    /** A fingertip resting on the glass: kill any ringing taps. (The rubbed tone is damped by the model.) */
    damp(t) {
      for (const s of this.strikes) s.fade(t);
      this.strikes.clear();
    }
  }

  function createEngine(ctx, { voices = 8, safety = true } = {}) {
    const master = createMaster(ctx, { safety });
    master.output.connect(ctx.destination);
    const noiseBuffer = makeNoise(ctx, 3);
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;
    noise.start();
    const list = [];
    for (let i = 0; i < voices; i++) {
      const v = new GlassVoice(ctx, master.input, noise, -0.55 + (1.1 * i) / Math.max(1, voices - 1), i);
      v.noiseBuffer = noiseBuffer;
      list.push(v);
    }
    return { ctx, master, voices: list };
  }

  Object.assign(R, { LEVELS, createEngine });
})((window.Rimsong = window.Rimsong || {}));
