// verify.js — renders scripted performances through the real synthesis code with an
// OfflineAudioContext and measures the result (peak, RMS, DC, NaNs, clicks, ring-out).
(function (R) {
  'use strict';
  const { createEngine, Instrument, Rub, PRESETS } = R;

  const SR = 48000;
  const FPS = 60;

  /** A scripted finger circling a glass at `rps` revolutions per second, on the rim (r = 1). */
  class Finger {
    constructor(glass, rps) {
      this.glass = glass;
      this.rps = rps;
      this.phase = Math.PI / 2;
      this.rub = new Rub(Math.cos(this.phase), Math.sin(this.phase));
    }
    frame(dt) {
      this.phase += this.rps * 2 * Math.PI * dt;
      this.rub.move(Math.cos(this.phase), Math.sin(this.phase));
      return this.rub.frame(dt);
    }
  }

  const SCENARIOS = {
    // Something like a person actually playing: swells, a chord, taps, a pour glissando, a squeak, a hush.
    performance: {
      duration: 16,
      script: [
        [0.0, 'rub', 2, 1.2],
        [1.5, 'rub', 5, 1.6],
        [3.0, 'strike', 0, 0.8, 0.5],
        [3.4, 'strike', 4, 0.8, 0.7],
        [3.8, 'strike', 7, 0.9, 0.9],
        [4.0, 'lift', 2],
        [4.5, 'pour', 5, 0.86],
        [5.6, 'settle', 5],
        [6.0, 'lift', 5],
        [6.0, 'rub', 7, 4.8],
        [7.0, 'still', 7],
        [7.4, 'lift', 7],
        [8.0, 'rub', 0, 1.0],
        [8.0, 'rub', 2, 1.1],
        [8.0, 'rub', 4, 1.3],
        [10.0, 'lift', 0],
        [10.0, 'lift', 2],
        [10.0, 'lift', 4],
        [10.5, 'strike', 3, 1.0, 1.0],
        [10.6, 'strike', 3, 1.0, 1.0],
        [10.7, 'strike', 3, 1.0, 1.0],
      ],
    },
    // Deliberately abusive: every glass rubbed flat-out, then every glass struck twice at full velocity,
    // then everything over-driven into squeaks.
    stress: {
      duration: 7,
      script: [
        ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => [0, 'rub', i, 2.2]),
        ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => [2.5, 'strike', i, 1, 1]),
        ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => [3.0, 'strike', i, 1, 1]),
        ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => [3.5, 'speed', i, 4.6]),
        ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => [5.0, 'lift', i]),
      ],
    },
    // Stuck-note check: rub, lift, and make sure it actually dies away.
    ringout: {
      duration: 24,
      script: [
        ...[1, 3, 5, 7].map((i) => [0, 'rub', i, 1.5]),
        [1.0, 'strike', 0, 1, 1],
        ...[1, 3, 5, 7].map((i) => [2.0, 'lift', i]),
      ],
    },
  };

  async function renderScenario(name, { safety = true } = {}) {
    const sc = SCENARIOS[name];
    const ctx = new OfflineAudioContext(2, Math.ceil(SR * sc.duration), SR);
    const engine = createEngine(ctx, { safety });
    const inst = new Instrument(PRESETS[0]);
    inst.attach(engine, 0);
    const fingers = new Map(); // glass -> Finger
    const pinned = new Map(); // glass -> resting Rub (finger down, not moving)
    const events = [...sc.script].sort((a, b) => a[0] - b[0]);
    let ei = 0;
    const dt = 1 / FPS;
    const frames = Math.floor(sc.duration * FPS);
    for (let k = 0; k < frames; k++) {
      const t = k * dt;
      while (ei < events.length && events[ei][0] <= t + 1e-9) {
        const [, kind, i, a, b] = events[ei++];
        if (kind === 'rub') fingers.set(i, new Finger(i, a));
        else if (kind === 'speed') fingers.get(i).rps = a;
        else if (kind === 'lift') {
          fingers.delete(i);
          pinned.delete(i);
        } else if (kind === 'still') {
          fingers.delete(i);
          pinned.set(i, new Rub(0, 1));
        } else if (kind === 'strike') inst.strike(i, a, b, t);
        else if (kind === 'pour') inst.pourTo(i, a);
        else if (kind === 'settle') inst.settle(i);
      }
      const contacts = [];
      for (const [i, f] of fingers) (contacts[i] ||= []).push(f.frame(dt));
      for (const [i, r] of pinned) (contacts[i] ||= []).push(r.frame(dt));
      inst.tick(dt, t, contacts);
    }
    const buf = await ctx.startRendering();
    return analyse(buf, name, safety);
  }

  function analyse(buf, name, safety) {
    const sr = buf.sampleRate;
    const chans = [buf.getChannelData(0), buf.getChannelData(1)];
    let peak = 0;
    let sumSq = 0;
    let sum = 0;
    let nan = 0;
    let maxJump = 0;
    let loudest = 0;
    const win = Math.floor(sr * 0.1);
    for (const d of chans) {
      let wSq = 0;
      for (let i = 0; i < d.length; i++) {
        const x = d[i];
        if (!Number.isFinite(x)) {
          nan++;
          continue;
        }
        const a = Math.abs(x);
        if (a > peak) peak = a;
        sumSq += x * x;
        sum += x;
        if (i) {
          const j = Math.abs(x - d[i - 1]);
          if (j > maxJump) maxJump = j;
        }
        wSq += x * x;
        if (i >= win) wSq -= d[i - win] * d[i - win];
        if (i >= win && wSq / win > loudest) loudest = wSq / win;
      }
    }
    const n = chans[0].length * 2;
    const tail = (sec) => {
      let s = 0;
      const from = chans[0].length - Math.floor(sr * sec);
      for (const d of chans) for (let i = from; i < d.length; i++) s += d[i] * d[i];
      return Math.sqrt(s / (2 * (chans[0].length - from)));
    };
    const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
    const r = {
      scenario: name,
      safetyShaper: safety,
      seconds: buf.duration,
      peak,
      peakDb: db(peak),
      rms: Math.sqrt(sumSq / n),
      rmsDb: db(Math.sqrt(sumSq / n)),
      loudest100msRmsDb: db(Math.sqrt(loudest)),
      dcOffset: sum / n,
      nanCount: nan,
      maxSampleJump: maxJump,
      lastSecondRmsDb: db(tail(1)),
    };
    for (const k of Object.keys(r)) if (typeof r[k] === 'number') r[k] = Math.round(r[k] * 1e5) / 1e5;
    return { stats: r, buffer: buf };
  }

  const SCENARIO_NAMES = Object.keys(SCENARIOS);

  Object.assign(R, { renderScenario, SCENARIO_NAMES });
})((window.Rimsong = window.Rimsong || {}));
