// Page tests for Party Wall. Run from the repo root: node --test ideas/45-party-wall/app.test.mjs
//
// wall.test.mjs checks the neighbour (wall.js). This file checks the page around it (app.js): it
// runs wall.js and app.js in a Node vm with a fake clock, a stub canvas, stub DOM elements and a
// stub Web Audio graph that records every knock it is asked to play. Node built-ins only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOUR = 3600 * 1000;

// ---------- a minimal page ----------
function loadPage({ dir = HERE, seed = 'page', audio = {} } = {}) {
  let clock = 50; // performance.now(), ms
  let raf = [];
  const timers = [];
  const errors = [];
  const vibrations = [];
  const listeners = { window: {}, document: {}, canvas: {}, again: {} };
  const on = (map) => (type, fn) => {
    (map[type] ||= []).push(fn);
  };
  const fire = (map, type, ev) => {
    for (const fn of map[type] || []) {
      try {
        fn(ev);
      } catch (e) {
        errors.push(e);
      }
    }
  };
  const classList = () => {
    const s = new Set();
    return { add: (c) => s.add(c), remove: (c) => s.delete(c), contains: (c) => s.has(c) };
  };
  const ctx2d = () =>
    new Proxy(
      {},
      {
        get(t, p) {
          if (p in t) return t[p];
          if (p === 'createImageData') return (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
          if (typeof p === 'string' && p.startsWith('create')) return () => ({ addColorStop() {} });
          return () => {};
        },
        set(t, p, v) {
          t[p] = v;
          return true;
        },
      },
    );
  const canvasEl = () => ({ width: 0, height: 0, style: {}, getContext: ctx2d, addEventListener: on(listeners.canvas) });
  const wallCanvas = canvasEl();
  const els = {
    wall: wallCanvas,
    hint: { classList: classList() },
    end: { classList: classList(), hidden: true },
    again: { addEventListener: on(listeners.again) },
  };
  const document = {
    hidden: false,
    getElementById: (id) => els[id],
    createElement: () => canvasEl(),
    addEventListener: on(listeners.document),
  };

  // Web Audio, just enough to record the graph app.js builds for each knock.
  const contexts = [];
  class Param {
    constructor(v = 0) {
      this.value = v;
    }
    setValueAtTime(v) {
      this.start = v;
    }
    linearRampToValueAtTime() {}
    exponentialRampToValueAtTime() {}
  }
  class FakeAC {
    constructor() {
      this.state = 'running';
      this.sampleRate = 8000;
      this.nodes = [];
      this.destination = this.node('destination');
      Object.assign(this, audio);
      contexts.push(this);
    }
    get currentTime() {
      return clock / 1000;
    }
    resume() {
      return Promise.resolve();
    }
    node(kind, extra) {
      const n = Object.assign(
        {
          kind,
          out: [],
          connect(m) {
            this.out.push(m);
            return m;
          },
          disconnect() {},
        },
        extra,
      );
      this.nodes.push(n);
      return n;
    }
    createGain() {
      return this.node('gain', { gain: new Param(1) });
    }
    createDynamicsCompressor() {
      const p = () => new Param();
      return this.node('compressor', { threshold: p(), knee: p(), ratio: p(), attack: p(), release: p() });
    }
    createConvolver() {
      return this.node('convolver', { buffer: null });
    }
    createBuffer(channels, n) {
      const data = Array.from({ length: channels }, () => new Float32Array(n));
      return { getChannelData: (i) => data[i] };
    }
    createBiquadFilter() {
      return this.node('biquad', { type: 'lowpass', frequency: new Param(350), Q: new Param(1) });
    }
    createStereoPanner() {
      return this.node('panner', { pan: new Param(0) });
    }
    createOscillator() {
      return this.node('osc', {
        type: 'sine',
        frequency: new Param(440),
        start(t) {
          this.startAt = t;
        },
        stop() {},
      });
    }
    createBufferSource() {
      return this.node('source', {
        buffer: null,
        start(t) {
          this.startAt = t;
        },
        stop() {},
      });
    }
  }

  const win = {
    innerWidth: 390,
    innerHeight: 844,
    devicePixelRatio: 2,
    document,
    location: { href: `file:///party-wall/index.html?seed=${encodeURIComponent(seed)}` },
    navigator: { vibrate: (ms) => vibrations.push(ms) },
    performance: { now: () => clock },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    requestAnimationFrame: (fn) => raf.push(fn),
    setTimeout: (fn, ms) => timers.push({ fn, at: clock + ms }),
    clearTimeout: () => {},
    addEventListener: on(listeners.window),
    AudioContext: FakeAC,
    URL,
    console,
  };
  win.window = win;
  vm.createContext(win);
  for (const f of ['wall.js', 'app.js']) vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), win, { filename: f });

  const app = win.PartyWallApp;
  const page = {
    app,
    errors,
    vibrations,
    get now() {
      return clock;
    },
    get wall() {
      return app.wall;
    },
    get loopAlive() {
      return raf.length > 0;
    },
    // Run animation frames every `dt` ms for `ms` ms of page time.
    frames(ms, dt = 16) {
      const end = clock + ms;
      while (clock < end) {
        clock = Math.min(end, clock + dt);
        const due = raf;
        raf = [];
        for (const fn of due) {
          try {
            fn(clock);
          } catch (e) {
            errors.push(e);
          }
        }
        for (const tm of timers.filter((x) => x.at <= clock)) {
          timers.splice(timers.indexOf(tm), 1);
          tm.fn();
        }
      }
    },
    // Frames until `cond()` holds (or give up after `max` ms).
    until(cond, max = 60000) {
      const end = clock + max;
      while (!cond()) {
        if (clock >= end) throw new Error('page never reached the expected state');
        page.frames(16);
      }
    },
    // Time passes with no frames at all (a tab in the background, a sleeping laptop).
    jump(ms) {
      clock += ms;
    },
    tap(x = 0.5, y = 0.5, stamp = clock) {
      fire(listeners.canvas, 'pointerdown', { clientX: x * win.innerWidth, clientY: y * win.innerHeight, timeStamp: stamp, preventDefault() {} });
    },
    hide() {
      document.hidden = true;
      fire(listeners.document, 'visibilitychange', {});
    },
    show() {
      document.hidden = false;
      fire(listeners.document, 'visibilitychange', {});
    },
    // Every knock the page has asked Web Audio to play, oldest first.
    played() {
      const ac = contexts[0];
      if (!ac) return [];
      return ac.nodes
        .filter((n) => n.kind === 'source')
        .map((src) => {
          const click = src.out[0];
          const out = click.out[0].out[0];
          const chain = [];
          for (let n = out.out[0]; n && n.kind !== 'gain'; n = n.out[0]) chain.push(n);
          const oscOf = (type) => ac.nodes.find((n) => n.kind === 'osc' && n.type === type && n.out[0] && n.out[0].out[0] === out);
          return {
            when: src.startAt,
            gain: out.gain.value,
            lowpass: chain.find((n) => n.kind === 'biquad') || null,
            pan: (chain.find((n) => n.kind === 'panner') || { pan: { value: 0 } }).pan.value,
            click: click.frequency.value,
            body: oscOf('triangle').frequency.value,
            thumpFrom: oscOf('sine').frequency.start,
            wet: out.out.map((n) => n.out[0]).filter(Boolean).length,
          };
        });
    },
  };
  page.frames(100);
  return page;
}

// Knock a two-knock phrase and wait until their answer is over and they are listening.
function exchange(page) {
  page.tap(0.5, 0.6);
  page.frames(300);
  page.tap(0.5, 0.6);
  page.until(() => {
    const s = page.wall.state();
    return s.phase === 'listening' && s.phraseLength === 0 && s.pending === 0;
  });
  page.frames(500);
}

function fiveExchanges(page) {
  for (let i = 0; i < 5; i++) exchange(page);
  assert.equal(page.wall.state().replies, 5);
}

test('the page loads in the harness and answers a knock, 4.4 s later', () => {
  const page = loadPage();
  page.tap(0.3, 0.4);
  const t0 = page.now;
  page.frames(4300);
  assert.equal(page.played().length, 1, 'only your own knock so far');
  page.frames(300);
  const p = page.played();
  assert.equal(p.length, 2, 'their first answer has sounded');
  assert.ok(Math.abs(p[1].when * 1000 - (t0 + 4400)) <= 17, 'within a frame of 4.4 s');
  assert.deepEqual(page.errors, []);
});

test('a tab left in the background for four hours: no error, the loop survives, no pile of knocks', () => {
  const page = loadPage({ seed: 'background' });
  fiveExchanges(page);
  page.frames(20000); // they have offered their beat at least once
  assert.ok(page.wall.state().offerings >= 1);
  const before = page.played().length;
  const buzzBefore = page.vibrations.length;
  page.hide();
  page.jump(4 * HOUR);
  page.show();
  assert.deepEqual(page.errors, [], 'catching up on return does not throw');
  page.frames(2000);
  assert.deepEqual(page.errors, [], 'nor do the frames after it');
  assert.ok(page.loopAlive, 'the animation loop is still running');
  assert.ok(Math.abs(page.wall.state().time - page.now) <= 16, 'the neighbour has caught up with the clock');
  // At most the beats of the last two seconds sound; the four hours of offerings do not.
  assert.ok(page.played().length - before <= 3, `knocks played after the return: ${page.played().length - before}`);
  assert.ok(page.vibrations.length - buzzBefore <= 3);
  // and a knock still works
  const n = page.played().length;
  page.tap(0.2, 0.2);
  assert.equal(page.played().length, n + 1);
  assert.deepEqual(page.errors, []);
});

test('frames that simply stop for hours (no visibility event) do not kill the loop either', () => {
  const page = loadPage({ seed: 'asleep' });
  fiveExchanges(page);
  page.frames(10000);
  const before = page.played().length;
  page.jump(8 * HOUR);
  page.frames(1000);
  assert.deepEqual(page.errors, []);
  assert.ok(page.loopAlive);
  assert.ok(page.played().length - before <= 3, `knocks played after the stall: ${page.played().length - before}`);
  const n = page.played().length;
  page.tap();
  assert.equal(page.played().length, n + 1);
  assert.deepEqual(page.errors, []);
});

test('the beat window allows for the audio latency the browser reports', () => {
  const reported = loadPage({ audio: { outputLatency: 0.12, baseLatency: 0.01 } });
  reported.tap();
  assert.equal(reported.wall.state().lag, 120 + 10 + 17, 'output + base latency + one frame');
  const unreported = loadPage({ audio: { outputLatency: undefined, baseLatency: undefined } });
  unreported.tap();
  assert.equal(unreported.wall.state().lag, 17, 'one frame when the browser reports nothing');
  const bluetooth = loadPage({ audio: { outputLatency: 0.35, baseLatency: 0.01 } });
  bluetooth.tap();
  assert.equal(bluetooth.wall.state().lag, 200, 'capped');
});

test('a knock is timed by its event time stamp, not by when the handler ran', () => {
  const page = loadPage();
  page.jump(40); // no frame since the last one
  page.tap(0.5, 0.5, page.now - 30);
  assert.equal(page.wall.state().scheduledReplyAt, page.now - 30 + 1400 + 3000);
  // a nonsense stamp (old epoch-based browsers) falls back to the handler time
  const p2 = loadPage();
  p2.tap(0.5, 0.5, 1.7e12);
  assert.equal(p2.wall.state().scheduledReplyAt, p2.now + 1400 + 3000);
});

test('at the end the wall is gone from the sound: no filter, and their knock has your voice', () => {
  const page = loadPage({ seed: 'ending' });
  fiveExchanges(page);
  page.until(() => page.wall.state().phase === 'beat', 20000);
  for (let i = 0; i < 4; i++) {
    const s = page.wall.state();
    page.until(() => page.now + 16 >= page.wall.state().nextBeatAt);
    page.jump(page.wall.state().nextBeatAt - page.now);
    page.tap(0.4, 0.5);
    assert.equal(page.wall.state().streak, s.streak, 'the streak moves when the window closes');
    page.frames(400);
  }
  page.until(() => page.wall.state().phase === 'ended', 3000);
  page.frames(50);
  const knocks = page.played();
  const final = knocks[knocks.length - 1];
  const mine = knocks.find((k) => k.gain === 0.75);
  const first = knocks[2]; // your two knocks, then their first answer
  // Through the wall: filtered, darker, off to one side.
  assert.equal(first.lowpass.frequency.value, 280);
  assert.equal(first.body, 190);
  assert.equal(first.click, 900);
  assert.ok(first.pan > 0);
  // The final knock: no wall left at all, and the same voice as yours.
  assert.equal(final.lowpass, null, 'no low-pass on the final knock');
  assert.equal(final.pan, 0);
  assert.equal(final.body, mine.body);
  assert.equal(final.click, mine.click);
  assert.equal(final.thumpFrom, mine.thumpFrom);
  assert.ok(final.gain > mine.gain, 'and a little louder than yours');
  assert.equal(page.vibrations[page.vibrations.length - 1], 22);
  // after the end, the answer to a knock is clear too
  page.frames(2000);
  page.tap(0.1, 0.9);
  page.frames(100);
  const after = page.played().slice(-1)[0];
  assert.equal(after.lowpass, null);
  assert.equal(after.body, mine.body);
  assert.deepEqual(page.errors, []);
});
