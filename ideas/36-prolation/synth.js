// synth.js — the synthesis graph for Prolation. Raw Web Audio, no samples, no dependencies.
//
// Works against any BaseAudioContext: the page drives it with a live AudioContext and a lookahead
// scheduler; verify.html drives it with an OfflineAudioContext and measures the result. Every
// note is scheduled at an explicit time, every node has a stop time, and every node disconnects
// itself when it ends.
(function (R) {
  'use strict';

  // Per-voice level before the master bus, and a little stereo placement.
  const TIMBRE = {
    organ: { level: 0.2, pan: 0.0 },
    flute: { level: 0.17, pan: -0.28 },
    bell: { level: 0.14, pan: 0.3 },
    pluck: { level: 0.2, pan: 0.14 },
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

  /** A stone room: stereo noise decaying over ~2.6 s, the highs dying faster than the lows. */
  function makeImpulse(ctx, seconds) {
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const buf = ctx.createBuffer(2, len, sr);
    const pre = Math.floor(sr * 0.012);
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
        lp += (n - lp) * 0.14;
        const fadeIn = Math.min(1, (i - pre) / (sr * 0.01));
        d[i] = fadeIn * (0.3 * n * Math.exp(-t / 0.25) + 1.0 * lp * Math.exp(-t / 0.7));
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

  /** Soft ceiling: linear below 0.6, easing into a hard ceiling of 0.95. */
  function safetyCurve() {
    const n = 4096;
    const c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      const a = Math.abs(x);
      const y = a <= 0.6 ? a : 0.6 + 0.35 * Math.tanh((a - 0.6) / 0.35);
      c[i] = Math.sign(x) * y;
    }
    return c;
  }

  function createEngine(ctx, opts) {
    const o = opts || {};
    const input = ctx.createGain();
    const dry = ctx.createGain();
    dry.gain.value = 0.85;
    const verb = ctx.createConvolver();
    verb.buffer = makeImpulse(ctx, o.room === undefined ? 2.6 : o.room);
    const wet = ctx.createGain();
    wet.gain.value = o.wet === undefined ? 0.3 : o.wet;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 12;
    comp.ratio.value = 3;
    comp.attack.value = 0.012;
    comp.release.value = 0.3;
    const trim = ctx.createGain();
    trim.gain.value = 0.7;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -4;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.1;
    const shaper = ctx.createWaveShaper();
    shaper.curve = safetyCurve();
    shaper.oversample = '2x';
    const master = ctx.createGain();
    master.gain.value = o.master === undefined ? 0.95 : o.master;

    input.connect(dry).connect(comp);
    input.connect(verb).connect(wet).connect(comp);
    comp.connect(trim).connect(limiter).connect(shaper).connect(master).connect(ctx.destination);

    const noise = makeNoise(ctx, 1.5);

    // Tracks every live node so a performance can be torn down cleanly.
    function Performance(piece) {
      const bus = ctx.createGain();
      bus.connect(input);
      const voiceBuses = piece.voices.map((v) => {
        const spec = TIMBRE[v.timbre] || TIMBRE.organ;
        const g = ctx.createGain();
        g.gain.value = spec.level;
        let out = g;
        if (ctx.createStereoPanner) {
          const pan = ctx.createStereoPanner();
          pan.pan.value = spec.pan;
          g.connect(pan);
          out = pan;
        }
        out.connect(bus);
        return g;
      });
      let live = 0;
      const self = {
        bus,
        get live() {
          return live;
        },
        play(ev, when) {
          const voice = piece.voices[ev.voice];
          const dest = voiceBuses[ev.voice];
          const nodes = VOICES[voice.timbre](ctx, dest, noise, ev, when);
          live++;
          nodes.main.addEventListener('ended', () => {
            live--;
            for (const n of nodes.all) {
              try {
                n.disconnect();
              } catch (e) {
                /* already gone */
              }
            }
          });
        },
        /**
         * Fade the whole performance out over `seconds` and detach it from the master bus. Notes
         * already scheduled still run to their own stop times and disconnect themselves; they just
         * can no longer be heard. The detach waits for the fade on the audio clock, not the wall
         * clock, so a context that is slow to resume cannot cut a note off mid-ramp.
         */
        release(at, seconds) {
          const t = Math.max(at, ctx.currentTime);
          bus.gain.cancelScheduledValues(t);
          bus.gain.setValueAtTime(bus.gain.value, t);
          bus.gain.linearRampToValueAtTime(0, t + seconds);
          const detach = () => {
            if (ctx.currentTime < t + seconds + 0.05 && ctx.state !== 'closed') {
              setTimeout(detach, 250);
              return;
            }
            try {
              bus.disconnect();
            } catch (e) {
              /* already detached */
            }
          };
          setTimeout(detach, (seconds + 0.2) * 1000);
        },
      };
      return self;
    }

    return { ctx, input, master, createPerformance: (piece) => new Performance(piece), TIMBRE };
  }

  // ---------------------------------------------------------------- timbres
  // Each returns { main: the node whose 'ended' event marks the note's death, all: every node }.
  // Envelopes never jump: attacks are linear ramps from zero (4-90 ms, never more than half the
  // note), releases are exponential approaches to zero, and every source stops only eight time
  // constants after its release begins.

  function release(param, tEnd, tau, floor) {
    param.setTargetAtTime(floor || 0, tEnd, tau);
  }

  /** A soft principal: sine fundamental, octave and twelfth, with a slow swell. The slowest voice. */
  function organ(ctx, dest, noise, ev, t) {
    const f = ev.freq;
    const dur = ev.dur;
    const amp = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.min(3200, f * 6);
    lp.Q.value = 0.5;
    amp.connect(lp).connect(dest);
    const partials = [
      [1, 1.0, 'sine', -2],
      [1, 0.55, 'triangle', 3],
      [2, 0.32, 'sine', 0],
      [3, 0.14, 'sine', 1],
    ];
    const oscs = partials.map(([m, g, type, cents]) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f * m;
      o.detune.value = cents;
      const og = ctx.createGain();
      og.gain.value = g * 0.5;
      o.connect(og).connect(amp);
      return [o, og];
    });
    const tail = ev.last ? 1.6 : 0.12;
    const stopAt = t + dur + tail * 8; // e^-8: the release is 70 dB down when the source stops
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(1, t + Math.min(0.09, dur * 0.5));
    release(amp.gain, t + dur, tail);
    for (const [o] of oscs) {
      o.start(t);
      o.stop(stopAt);
    }
    return { main: oscs[0][0], all: [amp, lp, ...oscs.flat()] };
  }

  /** A recorder-like voice: fundamental with light vibrato, a little octave, a breath of noise. */
  function flute(ctx, dest, noise, ev, t) {
    const f = ev.freq;
    const dur = ev.dur;
    const amp = ctx.createGain();
    amp.connect(dest);
    const o1 = ctx.createOscillator();
    o1.type = 'sine';
    o1.frequency.value = f;
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = f * 2;
    const g2 = ctx.createGain();
    g2.gain.value = 0.18;
    const o3 = ctx.createOscillator();
    o3.type = 'triangle';
    o3.frequency.value = f;
    const g3 = ctx.createGain();
    g3.gain.value = 0.12;
    o1.connect(amp);
    o2.connect(g2).connect(amp);
    o3.connect(g3).connect(amp);
    // vibrato that blooms after the attack
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 5.1;
    const lfoGain = ctx.createGain();
    lfoGain.gain.setValueAtTime(0, t);
    lfoGain.gain.linearRampToValueAtTime(7, t + Math.max(0.01, Math.min(0.5, dur * 0.6)));
    lfo.connect(lfoGain);
    lfoGain.connect(o1.detune);
    lfoGain.connect(o2.detune);
    lfoGain.connect(o3.detune);
    // breath
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = Math.min(6000, f * 2.5);
    bp.Q.value = 5;
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0, t);
    bg.gain.linearRampToValueAtTime(0.06, t + Math.min(0.03, dur * 0.3));
    bg.gain.setTargetAtTime(0.015, t + Math.min(0.05, dur * 0.5), 0.12);
    src.connect(bp).connect(bg).connect(amp);
    const tail = ev.last ? 1.4 : 0.1;
    const stopAt = t + dur + tail * 8; // e^-8: the release is 70 dB down when the source stops
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(1, t + Math.min(0.05, dur * 0.5));
    release(amp.gain, t + dur, tail);
    release(bg.gain, t + dur, tail);
    for (const o of [o1, o2, o3, lfo, src]) {
      o.start(t);
      o.stop(stopAt);
    }
    return { main: o1, all: [amp, o1, o2, g2, o3, g3, lfo, lfoGain, src, bp, bg] };
  }

  /** A soft metal bar: fundamental plus a quickly fading fourth harmonic, struck then sustained. */
  function bell(ctx, dest, noise, ev, t) {
    const f = ev.freq;
    const dur = ev.dur;
    const amp = ctx.createGain();
    amp.connect(dest);
    const o1 = ctx.createOscillator();
    o1.type = 'sine';
    o1.frequency.value = f;
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = f * 4;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.22, t);
    g2.gain.setTargetAtTime(0.02, t + 0.01, 0.25);
    const o3 = ctx.createOscillator();
    o3.type = 'sine';
    o3.frequency.value = f * 2;
    const g3 = ctx.createGain();
    g3.gain.setValueAtTime(0.25, t);
    g3.gain.setTargetAtTime(0.06, t + 0.01, 0.5);
    o1.connect(amp);
    o2.connect(g2).connect(amp);
    o3.connect(g3).connect(amp);
    const tail = ev.last ? 1.4 : 0.14;
    const stopAt = t + dur + tail * 8; // e^-8: the release is 70 dB down when the source stops
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(1, t + 0.005);
    amp.gain.setTargetAtTime(0.4, t + 0.02, 0.7); // rings down to a held tone
    release(amp.gain, t + dur, tail);
    for (const o of [o1, o2, o3]) {
      o.start(t);
      o.stop(stopAt);
    }
    return { main: o1, all: [amp, o1, o2, g2, o3, g3] };
  }

  /** A plucked string: a sawtooth through a closing low-pass, with a sine for body. The fastest voice. */
  function pluck(ctx, dest, noise, ev, t) {
    const f = ev.freq;
    const dur = ev.dur;
    const amp = ctx.createGain();
    amp.connect(dest);
    const saw = ctx.createOscillator();
    saw.type = 'sawtooth';
    saw.frequency.value = f;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 1.2;
    lp.frequency.setValueAtTime(Math.min(7000, f * 7), t);
    lp.frequency.setTargetAtTime(Math.max(400, f * 1.6), t + 0.005, 0.11);
    const sg = ctx.createGain();
    sg.gain.value = 0.3;
    saw.connect(lp).connect(sg).connect(amp);
    const body = ctx.createOscillator();
    body.type = 'sine';
    body.frequency.value = f;
    const bg = ctx.createGain();
    bg.gain.value = 0.55;
    body.connect(bg).connect(amp);
    const hold = Math.min(dur, 1.2);
    const tail = ev.last ? 1.2 : 0.06;
    const stopAt = t + dur + tail * 8; // e^-8: the release is 70 dB down when the source stops
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(1, t + 0.004);
    amp.gain.setTargetAtTime(0.0, t + 0.012, 0.38); // the string's own decay
    release(amp.gain, t + hold, tail); // and the written note end, whichever comes first
    if (ev.last) {
      amp.gain.cancelScheduledValues(t + 0.012);
      amp.gain.setTargetAtTime(0.12, t + 0.012, 0.5);
      release(amp.gain, t + dur, tail);
    }
    for (const o of [saw, body]) {
      o.start(t);
      o.stop(stopAt);
    }
    return { main: saw, all: [amp, saw, lp, sg, body, bg] };
  }

  const VOICES = { organ, flute, bell, pluck };

  /**
   * Renders a whole piece through the engine into an OfflineAudioContext and returns the buffer
   * plus measurements (peak, RMS, DC, NaNs, the loudest 100 ms, the last second).
   */
  async function renderPiece(piece, options) {
    const o = options || {};
    const sr = o.sampleRate || 48000;
    const lead = 0.1;
    const tailSeconds = o.tail === undefined ? 5 : o.tail;
    const seconds = piece.duration + lead + tailSeconds;
    const ctx = new OfflineAudioContext(2, Math.ceil(sr * seconds), sr);
    const engine = createEngine(ctx, o.engine);
    const perf = engine.createPerformance(piece);
    for (const ev of piece.events) perf.play(ev, lead + ev.t);
    const buf = await ctx.startRendering();
    return { buffer: buf, stats: analyse(buf, piece.duration + lead) };
  }

  function analyse(buf, musicEnds) {
    const sr = buf.sampleRate;
    const chans = [];
    for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c));
    let peak = 0, sumSq = 0, sum = 0, nan = 0, maxJump = 0, loudest = 0, peakAt = 0;
    const chanSums = [];
    const win = Math.floor(sr * 0.1);
    for (const d of chans) {
      let wSq = 0, chanSum = 0;
      for (let i = 0; i < d.length; i++) {
        const x = d[i];
        if (!Number.isFinite(x)) {
          nan++;
          continue;
        }
        const a = Math.abs(x);
        if (a > peak) {
          peak = a;
          peakAt = i / sr;
        }
        sumSq += x * x;
        sum += x;
        chanSum += x;
        if (i) {
          const j = Math.abs(x - d[i - 1]);
          if (j > maxJump) maxJump = j;
        }
        wSq += x * x;
        if (i >= win) wSq -= d[i - win] * d[i - win];
        if (i >= win && wSq / win > loudest) loudest = wSq / win;
      }
      chanSums.push(chanSum);
    }
    const n = chans[0].length * chans.length;
    const rmsBetween = (from, to) => {
      let s = 0, c = 0;
      const a = Math.max(0, Math.floor(from * sr)), b = Math.min(chans[0].length, Math.floor(to * sr));
      for (const d of chans) for (let i = a; i < b; i++) { s += d[i] * d[i]; c++; }
      return c ? Math.sqrt(s / c) : 0;
    };
    const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
    const total = chans[0].length / sr;
    const r = {
      seconds: total,
      peak,
      peakDb: db(peak),
      peakAt,
      rms: Math.sqrt(sumSq / n),
      rmsDb: db(Math.sqrt(sumSq / n)),
      musicRmsDb: db(rmsBetween(0, musicEnds)),
      loudest100msDb: db(Math.sqrt(loudest)),
      dcOffset: sum / n,
      // the channel whose mean is furthest from zero (signed): the stereo mean can hide one channel
      dcWorstChannel: chanSums.map((x) => x / chans[0].length).reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0),
      nanCount: nan,
      maxSampleJump: maxJump,
      lastSecondDb: db(rmsBetween(total - 1, total)),
      tailAfterMusicDb: db(rmsBetween(musicEnds + 2.5, musicEnds + 3.5)),
    };
    // Five significant figures, not five decimal places: rounding to 1e-5 used to report a DC offset
    // of -1.48e-5 as -1e-5, under a bound it actually exceeded.
    for (const k of Object.keys(r)) if (typeof r[k] === 'number' && Number.isFinite(r[k]) && r[k] !== 0) r[k] = Number(r[k].toPrecision(5));
    return r;
  }

  Object.assign(R, { createEngine, renderPiece, analyse, makeImpulse, TIMBRE });
})((window.Prolation = window.Prolation || {}));
