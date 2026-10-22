// instrument.js — binds the glass models to the audio voices. Shared by the live page and the
// offline verification render, so what gets tested is exactly what gets played.
(function (R) {
  'use strict';
  const { makeGlasses, PRESETS, MAX_FILL, clamp, fillForPitch, midiToHz } = R;

  const NONE = [];

  class Instrument {
    constructor(preset = PRESETS[0]) {
      this.glasses = makeGlasses(preset);
      this.engine = null;
    }

    attach(engine, t) {
      this.engine = engine;
      this.glasses.forEach((g, i) => engine.voices[i].setFreq(g.freq, t, 0.001));
    }

    /** Pour every glass to a preset tuning (animated, so ringing glasses glide). */
    applyPreset(preset) {
      this.glasses.forEach((g, i) => {
        g.fillTarget = fillForPitch(g.f0, midiToHz(preset.notes[i]));
      });
    }

    /** Direct pour while dragging: continuous, unsnapped. */
    pourTo(i, fill) {
      const g = this.glasses[i];
      g.fill = clamp(fill, 0, MAX_FILL);
      g.fillTarget = null;
    }

    /** Finger lifted after pouring: settle to the nearest semitone. */
    settle(i) {
      const g = this.glasses[i];
      g.fillTarget = g.snappedFill();
    }

    strike(i, vel, bright, t) {
      const g = this.glasses[i];
      g.flash = Math.min(1, g.flash + vel);
      if (this.engine) this.engine.voices[i].strike(t, vel, bright);
    }

    hush(t) {
      this.glasses.forEach((g, i) => {
        g.hush = 0.4;
        if (this.engine) this.engine.voices[i].damp(t);
      });
    }

    /** Stop everything immediately (tab hidden): zero the models and the voices together, so nothing
     *  blips back when the page returns. */
    silence(t) {
      this.glasses.forEach((g, i) => {
        g.amp = 0;
        g.friction = 0;
        g.squeak = 0;
        g.flash = 0;
        g.trem = 1;
        if (this.engine) {
          const v = this.engine.voices[i];
          v.damp(t);
          v.setState(t, g);
        }
      });
    }

    /** Advance one frame. `contacts[i]` is the list of finger contributions on glass i (from Rub.frame). */
    tick(dt, t, contacts) {
      const engine = this.engine;
      this.glasses.forEach((g, i) => {
        g.step(dt, contacts[i] || NONE);
        if (g.fillTarget !== null) {
          g.fill += (g.fillTarget - g.fill) * (1 - Math.exp(-dt / 0.09));
          if (Math.abs(g.fillTarget - g.fill) < 1e-4) {
            g.fill = g.fillTarget;
            g.fillTarget = null;
          }
        }
        if (!engine) return;
        const v = engine.voices[i];
        if (g.justStilled) v.damp(t);
        v.setFreq(g.freq, t, 0.035);
        v.setState(t, g);
      });
    }
  }

  Object.assign(R, { Instrument });
})((window.Rimsong = window.Rimsong || {}));
