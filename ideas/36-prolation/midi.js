// midi.js — a Standard MIDI File (type 0) writer for a composed piece. Pure; shared by the page
// (Download MIDI) and the tests, which parse the output back with their own reader.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Prolation = Object.assign(root.Prolation || {}, factory());
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PPQ = 480;
  const TEMPO_US = 500000; // 120 bpm: one quarter = 0.5 s, one tick = 1/960 s
  const PROGRAMS = { organ: 19, flute: 73, bell: 11, pluck: 46 }; // church organ, flute, vibraphone, harp
  const VELOCITY = { organ: 78, flute: 76, bell: 70, pluck: 84 };

  function varlen(n) {
    const out = [n & 0x7f];
    n >>>= 7;
    while (n > 0) {
      out.unshift((n & 0x7f) | 0x80);
      n >>>= 7;
    }
    return out;
  }

  function str(s) {
    return Array.from(s, (c) => c.charCodeAt(0) & 0x7f);
  }

  function secondsToTicks(s) {
    return Math.round((s * 1e6 * PPQ) / TEMPO_US);
  }

  /** Builds the bytes of a type-0 SMF for the piece's events: one channel per voice. */
  function midiFile(piece) {
    const items = [];
    const push = (tick, order, bytes) => items.push({ tick, order, bytes });
    push(0, 0, [0xff, 0x51, 0x03, (TEMPO_US >> 16) & 0xff, (TEMPO_US >> 8) & 0xff, TEMPO_US & 0xff]);
    const name = `Prolation seed ${piece.seed}`;
    push(0, 0, [0xff, 0x03, ...varlen(name.length), ...str(name)]);
    piece.voices.forEach((v, ch) => {
      push(0, 0, [0xc0 | ch, PROGRAMS[v.timbre] === undefined ? 0 : PROGRAMS[v.timbre]]);
    });
    for (const ev of piece.events) {
      const ch = ev.voice;
      const vel = VELOCITY[piece.voices[ch].timbre] || 80;
      const on = secondsToTicks(ev.t);
      const off = secondsToTicks(ev.t + ev.dur);
      push(on, 2, [0x90 | ch, ev.midi, vel]);
      push(Math.max(on + 1, off), 1, [0x80 | ch, ev.midi, 0]);
    }
    items.sort((a, b) => a.tick - b.tick || a.order - b.order);
    const track = [];
    let last = 0;
    for (const it of items) {
      track.push(...varlen(it.tick - last), ...it.bytes);
      last = it.tick;
    }
    track.push(0x00, 0xff, 0x2f, 0x00);
    const u32 = (n) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
    const u16 = (n) => [(n >>> 8) & 0xff, n & 0xff];
    const bytes = [
      ...str('MThd'), ...u32(6), ...u16(0), ...u16(1), ...u16(PPQ),
      ...str('MTrk'), ...u32(track.length), ...track,
    ];
    return new Uint8Array(bytes);
  }

  return { midiFile, MIDI_PPQ: PPQ, MIDI_TEMPO_US: TEMPO_US, MIDI_PROGRAMS: PROGRAMS };
});
