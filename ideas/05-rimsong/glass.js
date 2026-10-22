// glass.js — the "physics" of a singing wine glass, with no audio or drawing in it.
// Everything here is plain math so the same model drives the live page and the offline test render.
(function (R) {
  'use strict';
  /** Partials of a thin glass, as ratios of the lowest (2,0) "wineglass" mode.
   *  From the thin-ring approximation f_n ∝ n(n²−1)/√(n²+1), n = 2..5, normalised to n = 2. */
  const MODE_RATIOS = [1, 2.828, 5.423, 8.771];

  /** How strongly water drags the pitch down. French (1983) gives f_h = f_0 / √(1 + K·(h/H)⁴) with
   *  K ≈ α·ρ_water·R / (5·ρ_glass·a) (R = rim radius, a = wall thickness). 1.9 is a plausible thin glass. */
  const FILL_K = 1.9;
  const MAX_FILL = 0.92;

  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const smoothstep = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const midiToHz = (m) => 440 * 2 ** ((m - 69) / 12);
  const hzToMidi = (f) => 69 + 12 * Math.log2(f / 440);

  function pitchForFill(f0, fill) {
    return f0 / Math.sqrt(1 + FILL_K * fill ** 4);
  }
  function fillForPitch(f0, f) {
    const r = (f0 / f) ** 2 - 1;
    if (r <= 0) return 0;
    return Math.min(MAX_FILL, (r / FILL_K) ** 0.25);
  }

  const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  /** "A4", plus a cents offset when the glass sits between semitones. */
  function describePitch(f) {
    const m = hzToMidi(f);
    const n = Math.round(m);
    const cents = Math.round((m - n) * 100);
    const name = NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
    return { name, cents, midi: m };
  }

  const overtone = (n) => 69 + 12 * Math.log2((n * 98) / 440); // harmonics 4..11 of G2 (98 Hz)
  const PRESETS = [
    { id: 'pent', name: 'Pentatonic', notes: [67, 69, 72, 74, 76, 79, 81, 84] },
    { id: 'minor', name: 'A minor', notes: [69, 71, 72, 74, 76, 77, 79, 81] },
    { id: 'whole', name: 'Whole-tone', notes: [66, 68, 70, 72, 74, 76, 78, 80] },
    { id: 'over', name: 'Overtones (just)', notes: [4, 5, 6, 7, 8, 9, 10, 11].map(overtone) },
  ];

  /** Eight glasses. Each one's empty pitch sits a little above the highest note any preset asks of it,
   *  so every preset is reachable by pouring. Bigger glasses ring lower. */
  const GLASS_SET = PRESETS[0].notes.map((_, i) => {
    const top = Math.max(...PRESETS.map((p) => p.notes[i]));
    const f0 = midiToHz(top + 1.6);
    return { f0 };
  });
  {
    const ref = GLASS_SET[0].f0;
    for (const g of GLASS_SET) g.size = (ref / g.f0) ** 0.32;
  }

  /** How close a finger is to the rim, 0..1. Measured on a rounder ellipse than the drawn rim
   *  (v is squashed by 0.6), because fingers draw circles, not flat ellipses. */
  function rimContact(u, v) {
    const r = Math.hypot(u, v * 0.6);
    return smoothstep(0.12, 0.38, r) * (1 - smoothstep(1.9, 2.7, r));
  }

  /** Tracks one fingertip (or a keyboard "ghost finger") going round one glass.
   *  Coordinates are normalised so the rim is the unit circle: u = (x − cx)/rx, v = (y − cy)/ry. */
  class Rub {
    constructor(u, v) {
      this.theta = Math.atan2(v, u);
      this.contact = rimContact(u, v);
      this.acc = 0; // radians of rim travelled since the last frame
      this.speed = 0; // smoothed revolutions per second
      this.dir = 0;
      this.trail = [];
    }
    move(u, v) {
      const th = Math.atan2(v, u);
      let d = th - this.theta;
      if (d > Math.PI) d -= 2 * Math.PI;
      else if (d < -Math.PI) d += 2 * Math.PI;
      this.acc += Math.abs(d);
      if (d) this.dir = this.dir * 0.85 + Math.sign(d) * 0.15;
      this.theta = th;
      this.contact = rimContact(u, v);
    }
    /** Call once per animation frame. Returns this finger's contribution to the glass. */
    frame(dt) {
      const inst = this.acc / (2 * Math.PI) / Math.max(dt, 1e-3);
      this.acc = 0;
      this.speed += (inst - this.speed) * (1 - Math.exp(-dt / 0.09));
      const v = this.speed;
      const contact = this.contact;
      this.trail.push(this.theta);
      if (this.trail.length > 14) this.trail.shift();
      return {
        contact,
        speed: v,
        // Rim speed → how much energy the finger pumps in. Saturates around 1–2 rev/s.
        drive: contact * (1 - Math.exp(-v / 0.6)),
        // Too fast and stick-slip breaks down: the glass chatters and jumps toward its next mode.
        squeak: contact * smoothstep(2.4, 4.4, v),
        still: v < 0.08,
        angle: this.theta,
      };
    }
  }

  /** One glass: its tuning (empty pitch + water) and the slow energy dynamics that make it "speak". */
  class GlassModel {
    constructor({ index, f0, fill, size }) {
      this.index = index;
      this.f0 = f0;
      this.fill = fill;
      this.fillTarget = null;
      this.size = size;
      this.amp = 0; // 0..1 ringing energy of the rubbed (2,0) mode
      this.friction = 0; // how hard the finger is working right now
      this.squeak = 0;
      this.angle = Math.PI / 2; // where the finger is — the vibration pattern follows it round
      this.trem = 1;
      this.touching = false;
      this.still = false;
      this.wasStill = false;
      this.justStilled = false;
      this.hush = 0; // seconds of forced damping left (the Hush control)
      this.flash = 0; // visual: recent strike
    }
    get freq() {
      return pitchForFill(this.f0, this.fill);
    }
    /** Ring-out time constant once the finger lifts. Lower glasses ring a little longer. */
    get ringTau() {
      return 2.6 * (600 / this.freq) ** 0.35;
    }
    /** Fill that lands this glass exactly on the nearest equal-tempered semitone (within its range). */
    snappedFill(fill = this.fill) {
      const f = pitchForFill(this.f0, fill);
      const lo = pitchForFill(this.f0, MAX_FILL);
      let m = Math.round(hzToMidi(f));
      if (midiToHz(m) > this.f0) m -= 1;
      if (midiToHz(m) < lo) m += 1;
      return fillForPitch(this.f0, midiToHz(m));
    }
    step(dt, contacts) {
      let drive = 0;
      let squeak = 0;
      let best = -1;
      let angle = this.angle;
      let touching = false;
      let still = true;
      for (const c of contacts) {
        if (c.contact < 0.05) continue;
        touching = true;
        drive += c.drive;
        squeak = Math.max(squeak, c.squeak);
        if (!c.still) still = false;
        if (c.drive > best) {
          best = c.drive;
          angle = c.angle;
        }
      }
      if (!touching) still = false;
      drive = Math.min(1, drive);
      if (this.hush > 0) {
        this.hush -= dt;
        drive = 0;
        squeak = 0;
      }
      // Over-driving chokes the tone a little: there is a sweet spot of rim speed.
      const target = drive * (1 - 0.45 * squeak);
      let tau;
      if (this.hush > 0) tau = 0.1;
      else if (target > this.amp) tau = 0.3 + 0.45 * this.amp; // a glass takes a moment to speak
      else if (!touching) tau = this.ringTau; // free ring
      else if (still) tau = 0.14; // a resting fingertip damps it
      else tau = 0.8; // still rubbing, just slower
      this.amp += (target - this.amp) * (1 - Math.exp(-dt / tau));
      if (this.amp < 1e-5) this.amp = 0;
      this.squeak += (squeak - this.squeak) * (1 - Math.exp(-dt / 0.04));
      if (this.squeak < 1e-5) this.squeak = 0;
      this.friction += (drive - this.friction) * (1 - Math.exp(-dt / 0.05));
      if (this.friction < 1e-5) this.friction = 0;
      this.angle = angle;
      // A fixed listener in front of the glass (angle π/2) hears the rotating (2,0) pattern sweep past:
      // four nodes per revolution of the finger, so the tone pulses at 4× your circling rate.
      const depth = 0.2 * Math.min(1, drive * 1.5);
      const s = Math.sin(2 * (angle - Math.PI / 2));
      this.trem = 1 - depth * s * s;
      this.justStilled = touching && still && !this.wasStill;
      this.wasStill = touching && still;
      this.touching = touching;
      this.still = still;
      this.flash *= Math.exp(-dt / 0.35);
    }
  }

  function makeGlasses(preset = PRESETS[0]) {
    return GLASS_SET.map(
      (spec, i) =>
        new GlassModel({ index: i, f0: spec.f0, size: spec.size, fill: fillForPitch(spec.f0, midiToHz(preset.notes[i])) }),
    );
  }

  Object.assign(R, { MODE_RATIOS, FILL_K, MAX_FILL, clamp, smoothstep, midiToHz, hzToMidi, pitchForFill, fillForPitch, describePitch, PRESETS, GLASS_SET, rimContact, Rub, GlassModel, makeGlasses });
})((window.Rimsong = window.Rimsong || {}));
