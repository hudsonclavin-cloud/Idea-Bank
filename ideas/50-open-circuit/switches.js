/* switches.js — the mechanisms of Open Circuit, with no DOM in them.
 *
 * Every exhibit in the museum is one of these small machines. A machine keeps a
 * position (a lever angle, a button depth, a knob index), is driven by grab /
 * drag / release / tap calls from the page, and is stepped forward in time with
 * step(dt). Each call returns a list of event names ('snap', 'detent',
 * 'click', ...). The page turns events into sounds and tally counts; the tests
 * check that the events happen exactly when the plaques say they do.
 *
 * Loads as a classic browser script (window.Switches) and under Node
 * (module.exports), so the page and the tests share one source.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  root.Switches = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

  // A damped spring that pulls s[key] toward target. dt = Infinity jumps straight
  // there (used for prefers-reduced-motion). Returns true once settled.
  function settle(s, dt, target, { k = 600, zeta = 0.75, key = 'pos', vel = 'vel', tol = 0.002 } = {}) {
    if (s[key] === target && s[vel] === 0) return true;
    if (!(dt > 0)) return false;
    if (dt === Infinity) {
      s[key] = target;
      s[vel] = 0;
      return true;
    }
    let x = s[key];
    let v = s[vel];
    const c = 2 * zeta * Math.sqrt(k);
    let remaining = Math.min(dt, 0.1);
    const h = 1 / 240;
    while (remaining > 0) {
      const step = Math.min(h, remaining);
      v += (-k * (x - target) - c * v) * step;
      x += v * step;
      remaining -= step;
    }
    if (Math.abs(x - target) < tol && Math.abs(v) < tol * 20) {
      s[key] = target;
      s[vel] = 0;
      return true;
    }
    s[key] = x;
    s[vel] = v;
    return false;
  }

  // Deterministic PRNG (mulberry32) so the useless machine can be tested.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const easeInOut = (f) => (f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2);

  /* ---------------------------------------------------------------- Toggle
   * Over-centre toggle. pos runs from -1 (lever fully OFF) to +1 (fully ON).
   * The contacts change over at the instant the lever crosses the centre, and
   * only then. Let go short of the centre and the lever returns to the side it
   * is on. */
  class Toggle {
    constructor({ on = false } = {}) {
      this.on = on;
      this.pos = on ? 1 : -1;
      this.vel = 0;
      this.held = false;
    }
    get target() {
      return this.on ? 1 : -1;
    }
    grab() {
      this.held = true;
      return [];
    }
    drag(p) {
      if (!this.held) return [];
      p = clamp(p, -1, 1);
      const ev = [];
      if (p > 0 && !this.on) {
        this.on = true;
        ev.push('snap');
      } else if (p < 0 && this.on) {
        this.on = false;
        ev.push('snap');
      }
      this.pos = p;
      this.vel = 0;
      return ev;
    }
    release() {
      this.held = false;
      return [];
    }
    tap() {
      this.held = false;
      this.on = !this.on;
      return ['snap'];
    }
    set(on) {
      if (this.on === !!on) return [];
      this.on = !!on;
      return ['snap'];
    }
    step(dt) {
      if (!this.held) settle(this, dt, this.target, { k: 1400, zeta: 0.6 });
      return [];
    }
    idle() {
      return !this.held && this.pos === this.target && this.vel === 0;
    }
  }

  /* -------------------------------------------------------------- Detented
   * A knob or slider with n rest positions `spacing` apart. While dragged it
   * clicks through every detent it passes and never rests between two. Rotary
   * selectors and slide switches are both this. */
  class Detented {
    constructor({ positions = 8, spacing = 30, index = 0 } = {}) {
      this.n = positions;
      this.spacing = spacing;
      this.index = clamp(index, 0, positions - 1);
      this.pos = this.index * spacing;
      this.vel = 0;
      this.held = false;
    }
    get sweep() {
      return (this.n - 1) * this.spacing;
    }
    get target() {
      return this.index * this.spacing;
    }
    grab() {
      this.held = true;
      return [];
    }
    drag(p) {
      if (!this.held) return [];
      p = clamp(p, 0, this.sweep);
      const ev = [];
      const nearest = Math.round(p / this.spacing);
      while (this.index < nearest) {
        this.index++;
        ev.push('detent');
      }
      while (this.index > nearest) {
        this.index--;
        ev.push('detent');
      }
      this.pos = p;
      this.vel = 0;
      return ev;
    }
    release() {
      this.held = false;
      return [];
    }
    // Move one detent in direction dir (+1 / -1). At an end stop nothing moves.
    tap(dir = 1) {
      this.held = false;
      const next = clamp(this.index + (dir < 0 ? -1 : 1), 0, this.n - 1);
      if (next === this.index) return ['stop'];
      this.index = next;
      return ['detent'];
    }
    step(dt) {
      if (!this.held) settle(this, dt, this.target, { k: 900, zeta: 0.8, tol: this.spacing * 0.002 });
      return [];
    }
    idle() {
      return !this.held && this.pos === this.target && this.vel === 0;
    }
  }

  /* -------------------------------------------------------------- Momentary
   * A push button with a snap-dome. depth runs 0..1. The contact closes when
   * the depth passes closeAt on the way down and opens when it falls back past
   * openAt (hysteresis, like a real dome). With bottom: true it also reports
   * hitting the end of its travel. */
  class Momentary {
    constructor({ closeAt = 0.7, openAt = 0.3, bottom = false } = {}) {
      this.closeAt = closeAt;
      this.openAt = openAt;
      this.reportBottom = bottom;
      this.depth = 0;
      this.vel = 0;
      this.closed = false;
      this.bottomed = false;
      this.pushing = false;
      this.autoRelease = 0;
    }
    get target() {
      return this.pushing ? 1 : 0;
    }
    press() {
      this.pushing = true;
      this.autoRelease = 0;
      return [];
    }
    release() {
      this.pushing = false;
      this.autoRelease = 0;
      return [];
    }
    // A quick full press that lets go on its own after `hold` seconds.
    tap(hold = 0.11) {
      this.pushing = true;
      this.autoRelease = hold;
      return [];
    }
    setDepth(d) {
      d = clamp(d, 0, 1);
      const ev = [];
      if (!this.closed && d >= this.closeAt) {
        this.closed = true;
        ev.push('down');
      } else if (this.closed && d <= this.openAt) {
        this.closed = false;
        ev.push('up');
      }
      if (this.reportBottom) {
        if (!this.bottomed && d >= 0.98) {
          this.bottomed = true;
          ev.push('bottom');
        } else if (this.bottomed && d < 0.6) this.bottomed = false;
      }
      this.depth = d;
      return ev;
    }
    step(dt) {
      if (this.autoRelease > 0) {
        this.autoRelease -= dt;
        if (this.autoRelease <= 0 || dt === Infinity) {
          // Travel fully down before springing back, even in instant mode.
          const down = this.setDepth(1);
          this.pushing = false;
          this.autoRelease = 0;
          settle(this, dt, 0, { key: 'depth', k: 2500, zeta: 0.9 });
          return down.concat(this.setDepth(this.depth));
        }
      }
      settle(this, dt, this.target, { key: 'depth', k: 2500, zeta: 0.9 });
      return this.setDepth(this.depth);
    }
    idle() {
      return !this.pushing && this.autoRelease <= 0 && this.depth === 0 && this.vel === 0;
    }
  }

  /* --------------------------------------------------------------- Latching
   * Push-on / push-off. The cam inside is the one from a retractable ballpoint:
   * a full press arms it ('click'); when the button is let go the cam turns and
   * the button either stays down (latched, resting at restDepth) or comes all
   * the way up. */
  class Latching {
    constructor({ restDepth = 0.45 } = {}) {
      this.restDepth = restDepth;
      this.depth = 0;
      this.vel = 0;
      this.latched = false;
      this.armed = false;
      this.pushing = false;
      this.seated = true;
      this.autoRelease = 0;
    }
    get target() {
      if (this.pushing) return 1;
      return this.latched ? this.restDepth : 0;
    }
    press() {
      this.pushing = true;
      this.autoRelease = 0;
      return [];
    }
    release() {
      if (!this.pushing) return [];
      this.pushing = false;
      this.autoRelease = 0;
      if (!this.armed) return [];
      this.armed = false;
      this.latched = !this.latched;
      this.seated = false;
      return [this.latched ? 'latch' : 'unlatch'];
    }
    tap(hold = 0.12) {
      this.pushing = true;
      this.autoRelease = hold;
      return [];
    }
    setDepth(d) {
      d = clamp(d, 0, 1);
      const ev = [];
      if (!this.armed && d >= 0.92) {
        this.armed = true;
        ev.push('click');
      }
      this.depth = d;
      return ev;
    }
    step(dt) {
      let ev = [];
      if (this.autoRelease > 0) {
        this.autoRelease -= dt;
        if (this.autoRelease <= 0 || dt === Infinity) {
          ev = ev.concat(this.setDepth(1), this.release());
        }
      }
      const done = settle(this, dt, this.target, { key: 'depth', k: 2200, zeta: 0.85 });
      ev = ev.concat(this.setDepth(this.depth));
      if (done && !this.seated && !this.pushing) {
        this.seated = true;
        ev.push('seat');
      }
      return ev;
    }
    idle() {
      return !this.pushing && this.autoRelease <= 0 && this.seated && this.depth === this.target && this.vel === 0;
    }
  }

  /* -------------------------------------------------------------------- Dip
   * A bank of tiny rockers. Each flip is one tick. toString() reads the bank
   * as a binary word, way 1 first. `selected` is the way a keyboard user is
   * pointing at: select() moves it, set() and flip() work any way. */
  class Dip {
    constructor({ ways = 8, bits = null } = {}) {
      this.bits = Array.from({ length: ways }, (_, i) => (bits ? !!bits[i] : false));
      this.selected = 0;
    }
    flip(i = this.selected) {
      if (i < 0 || i >= this.bits.length) return [];
      this.bits[i] = !this.bits[i];
      return ['tick'];
    }
    // Put way i ON or OFF; a rocker already there does not move.
    set(i, on) {
      if (i < 0 || i >= this.bits.length || this.bits[i] === !!on) return [];
      return this.flip(i);
    }
    // Move the selection one way left (dir < 0) or right; it stops at the ends.
    select(dir) {
      this.selected = clamp(this.selected + (dir < 0 ? -1 : 1), 0, this.bits.length - 1);
      return [];
    }
    toString() {
      return this.bits.map((b) => (b ? '1' : '0')).join('');
    }
    step() {
      return [];
    }
    idle() {
      return true;
    }
  }

  /* ------------------------------------------------------------------ Knife
   * A hinged blade. pos is 0 with the blade home in its jaws and 1 fully open.
   * It is bistable: let go on the lower half and it drops home ('clack' when
   * it lands); let go on the upper half and it swings open. */
  class Knife {
    constructor({ open = true } = {}) {
      this.pos = open ? 1 : 0;
      this.vel = 0;
      this.held = false;
      this.closed = !open;
      this.target = this.pos;
    }
    grab() {
      this.held = true;
      return [];
    }
    drag(p) {
      if (!this.held) return [];
      p = clamp(p, 0, 1);
      const ev = [];
      if (!this.closed && p <= 0.02) {
        this.closed = true;
        ev.push('clack');
      } else if (this.closed && p > 0.06) {
        this.closed = false;
        ev.push('open');
      }
      this.pos = p;
      this.vel = 0;
      return ev;
    }
    release() {
      this.held = false;
      this.target = this.pos < 0.5 ? 0 : 1;
      return [];
    }
    tap() {
      this.held = false;
      const ev = [];
      if (this.target === 0) {
        this.target = 1;
        if (this.closed) {
          this.closed = false;
          ev.push('open');
        }
      } else {
        this.target = 0;
      }
      return ev;
    }
    step(dt) {
      if (this.held) return [];
      const ev = [];
      settle(this, dt, this.target, { k: 220, zeta: 0.55 });
      // The blade stops dead against the jaws and against the open stop.
      if (this.pos < 0) {
        this.pos = 0;
        this.vel = 0;
      } else if (this.pos > 1) {
        this.pos = 1;
        this.vel = 0;
      }
      if (!this.closed && this.target === 0 && this.pos <= 0.02) {
        this.closed = true;
        ev.push('clack');
      }
      return ev;
    }
    idle() {
      return !this.held && this.pos === this.target && this.vel === 0;
    }
  }

  /* -------------------------------------------------------------- PullChain
   * A chain on a ratchet. pull runs 0..1. Beads tick over the collar every
   * tickEvery of travel; at the end of the stroke the ratchet advances one
   * tooth ('clunk') and the holder changes state. A stroke advances it once,
   * however long you hang on; a short pull advances nothing. The ratchet
   * re-engages once the chain has returned most of the way (below 0.3),
   * whether it sprang back on its own or the visitor let it back up without
   * letting go. */
  class PullChain {
    constructor({ tickEvery = 0.12 } = {}) {
      this.tickEvery = tickEvery;
      this.pos = 0;
      this.vel = 0;
      this.held = false;
      this.on = false;
      this.advanced = false;
      this.lastTick = 0;
    }
    grab() {
      this.held = true;
      // The ratchet only re-engages once the chain has returned most of the way.
      if (this.pos < 0.3) {
        this.advanced = false;
        this.lastTick = 0;
      }
      return [];
    }
    drag(p) {
      if (!this.held) return [];
      p = clamp(p, 0, 1);
      const ev = [];
      if (p < 0.3) this.advanced = false;
      // Beads that have gone back up over the collar tick again on the way down.
      const back = Math.floor(p / this.tickEvery + 1e-9) * this.tickEvery;
      if (back < this.lastTick) this.lastTick = back;
      while (this.lastTick + this.tickEvery <= p && this.lastTick + this.tickEvery < 0.95) {
        this.lastTick += this.tickEvery;
        ev.push('bead');
      }
      if (p >= 0.95 && !this.advanced) {
        this.advanced = true;
        this.on = !this.on;
        ev.push('clunk');
      }
      this.pos = p;
      this.vel = 0;
      return ev;
    }
    release() {
      this.held = false;
      return [];
    }
    tap() {
      this.grab();
      this.lastTick = 1;
      const ev = this.drag(1);
      this.release();
      return ev;
    }
    step(dt) {
      if (!this.held) settle(this, dt, 0, { k: 500, zeta: 0.8 });
      return [];
    }
    idle() {
      return !this.held && this.pos === 0 && this.vel === 0;
    }
  }

  /* ---------------------------------------------------------------- Breaker
   * A miniature circuit breaker. The lever has three rest positions: 0 (OFF),
   * 1 (ON) and 0.5 (TRIPPED). TEST trips it only when it is ON. A tripped
   * breaker cannot be pushed ON: the lever flops back to the middle. It must be
   * pushed fully OFF first ('reset'), after which it can be switched ON. */
  class Breaker {
    constructor({ state = 'on' } = {}) {
      this.state = state;
      this.pos = this.target;
      this.vel = 0;
      this.held = false;
    }
    get target() {
      return this.state === 'on' ? 1 : this.state === 'off' ? 0 : 0.5;
    }
    grab() {
      this.held = true;
      return [];
    }
    drag(p) {
      if (!this.held) return [];
      p = clamp(p, 0, 1);
      const ev = [];
      if (this.state === 'on' && p <= 0.25) {
        this.state = 'off';
        ev.push('snap');
      } else if (this.state === 'off' && p >= 0.75) {
        this.state = 'on';
        ev.push('snap');
      } else if (this.state === 'tripped' && p <= 0.2) {
        this.state = 'off';
        ev.push('reset');
      }
      this.pos = p;
      this.vel = 0;
      return ev;
    }
    release() {
      this.held = false;
      if (this.state === 'tripped' && this.pos > 0.6) return ['refuse'];
      return [];
    }
    tap() {
      this.held = false;
      if (this.state === 'on') {
        this.state = 'off';
        return ['snap'];
      }
      if (this.state === 'off') {
        this.state = 'on';
        return ['snap'];
      }
      this.pos = 0.78; // the lever is pushed up and flops back
      return ['refuse'];
    }
    // A push on the lever in one direction: dir > 0 toward ON, dir < 0 toward
    // OFF. Pushed toward OFF, a tripped breaker resets; pushed toward ON it
    // refuses and flops back. A lever already at the end it is pushed toward
    // does not move.
    push(dir) {
      this.held = false;
      if (dir > 0) {
        if (this.state === 'off') {
          this.state = 'on';
          return ['snap'];
        }
        if (this.state === 'tripped') {
          this.pos = 0.78;
          return ['refuse'];
        }
        return [];
      }
      if (this.state === 'on') {
        this.state = 'off';
        return ['snap'];
      }
      if (this.state === 'tripped') {
        this.state = 'off';
        return ['reset'];
      }
      return [];
    }
    test() {
      if (this.state !== 'on') return ['click'];
      this.state = 'tripped';
      this.held = false;
      return ['click', 'trip'];
    }
    step(dt) {
      if (!this.held) settle(this, dt, this.target, { k: 900, zeta: 0.7 });
      return [];
    }
    idle() {
      return !this.held && this.pos === this.target && this.vel === 0;
    }
  }

  /* ---------------------------------------------------------------- Guarded
   * A toggle under a hinged safety cover. cover runs 0 (closed) to 1 (open).
   * The toggle can only be worked while the cover is open, and closing the
   * cover forces the toggle OFF: on release, or as soon as a cover being
   * dragged down comes within shutAt of closed, held or not. */
  class Guarded {
    constructor() {
      this.toggle = new Toggle();
      this.cover = 0;
      this.coverVel = 0;
      this.coverOpen = false;
      this.coverHeld = false;
    }
    get coverTarget() {
      return this.coverOpen ? 1 : 0;
    }
    // The lever's position, so the toggle can be dragged like any other.
    get pos() {
      return this.toggle.pos;
    }
    coverGrab() {
      this.coverHeld = true;
      return [];
    }
    coverDrag(c) {
      if (!this.coverHeld) return [];
      this.cover = clamp(c, 0, 1);
      this.coverVel = 0;
      if (this.coverOpen && this.cover <= Guarded.shutAt) return this.setCover(false);
      return [];
    }
    coverRelease() {
      this.coverHeld = false;
      return this.setCover(this.cover >= 0.5);
    }
    coverTap() {
      this.coverHeld = false;
      return this.setCover(!this.coverOpen);
    }
    setCover(open) {
      const ev = [];
      if (open === this.coverOpen) return ev;
      this.coverOpen = open;
      ev.push(open ? 'lift' : 'drop');
      if (!open) {
        this.toggle.held = false;
        if (this.toggle.on) {
          this.toggle.on = false;
          ev.push('snap');
        }
      }
      return ev;
    }
    get toggleUsable() {
      return this.coverOpen && this.cover >= 0.6;
    }
    grab() {
      if (!this.toggleUsable) return ['blocked'];
      return this.toggle.grab();
    }
    drag(p) {
      if (!this.toggleUsable) return [];
      return this.toggle.drag(p);
    }
    release() {
      return this.toggle.release();
    }
    tap() {
      if (!this.toggleUsable) return ['blocked'];
      return this.toggle.tap();
    }
    step(dt) {
      if (!this.coverHeld) settle(this, dt, this.coverTarget, { key: 'cover', vel: 'coverVel', k: 500, zeta: 0.7 });
      return this.toggle.step(dt);
    }
    idle() {
      return !this.coverHeld && this.cover === this.coverTarget && this.coverVel === 0 && this.toggle.idle();
    }
  }

  Guarded.shutAt = 0.3;

  /* ------------------------------------------------------------------ EStop
   * A mushroom-head emergency stop. Push to latch down ('thunk'). It only comes
   * back up when twisted at least releaseAt degrees ('pop'); a smaller twist
   * springs back and releases nothing. grab / drag / release are the page's
   * gesture on the head: pressing it latches it at once, however long it is
   * held and however much the finger wanders, and dragging across it twists
   * it. */
  class EStop {
    constructor({ releaseAt = 30 } = {}) {
      this.releaseAt = releaseAt;
      this.depth = 0;
      this.vel = 0;
      this.latched = false;
      this.twist = 0;
      this.twistVel = 0;
      this.twisting = false;
    }
    press() {
      if (this.latched) return ['dead'];
      this.latched = true;
      return ['thunk'];
    }
    twistGrab() {
      this.twisting = true;
      return [];
    }
    grab() {
      this.wasLatched = this.latched;
      this.twisted = false;
      return this.latched ? [] : this.press();
    }
    // deg: how far the finger has twisted the head since it was grabbed.
    drag(deg) {
      if (!this.twisting) this.twistGrab();
      if (Math.abs(deg) >= EStop.slop) this.twisted = true;
      return this.twistTo(deg);
    }
    release() {
      // Pressing a head that was already down, without twisting it, does nothing.
      const ev = this.wasLatched && this.latched && !this.twisted ? ['dead'] : [];
      this.wasLatched = false;
      this.twistRelease();
      return ev;
    }
    twistTo(deg) {
      if (!this.twisting) return [];
      this.twist = clamp(deg, 0, 60);
      this.twistVel = 0;
      if (this.latched && this.twist >= this.releaseAt) {
        this.latched = false;
        this.twisting = false;
        return ['pop'];
      }
      return [];
    }
    twistRelease() {
      this.twisting = false;
      return [];
    }
    step(dt) {
      settle(this, dt, this.latched ? 1 : 0, { key: 'depth', k: 1500, zeta: 0.8 });
      if (!this.twisting) settle(this, dt, 0, { key: 'twist', vel: 'twistVel', k: 400, zeta: 0.9, tol: 0.05 });
      return [];
    }
    idle() {
      return !this.twisting && this.depth === (this.latched ? 1 : 0) && this.vel === 0 && this.twist === 0 && this.twistVel === 0;
    }
  }

  EStop.slop = 5; // degrees of wander that still count as a plain press

  /* ------------------------------------------------------------- UselessBox
   * A toggle on a box. Switch it on and, after a pause of its choosing, the
   * lid opens, an arm comes out and switches it off again. lid and arm run
   * 0..1. The arm never flips a switch that is already off. With `instant`
   * set (reduced motion) the pauses still take their time but the lid and arm
   * jump between positions. */
  class UselessBox {
    constructor({ seed = 1 } = {}) {
      this.toggle = new Toggle();
      this.rng = mulberry32(seed);
      this.lid = 0;
      this.arm = 0;
      this.queue = [];
      this.phase = null;
      this.mood = null;
      this.instant = false;
      this.flips = 0;
    }
    get held() {
      return this.toggle.held;
    }
    get pos() {
      return this.toggle.pos;
    }
    plan() {
      const r = () => this.rng();
      const moods = ['prompt', 'prompt', 'slow', 'peek', 'fake', 'instant', 'prompt', 'sulk'];
      const mood = moods[Math.floor(r() * moods.length)];
      const q = [];
      const wait = (t) => q.push({ kind: 'wait', t });
      const lid = (to, t) => q.push({ kind: 'lid', to, t });
      const arm = (to, t) => q.push({ kind: 'arm', to, t });
      const flip = () => q.push({ kind: 'flip', t: 0 });
      switch (mood) {
        case 'slow':
          wait(1.2 + 0.8 * r());
          lid(1, 1.1);
          wait(0.4);
          arm(1, 1.2);
          flip();
          wait(0.5);
          arm(0, 0.9);
          lid(0, 0.8);
          break;
        case 'peek':
          wait(0.5);
          lid(0.35, 0.25);
          wait(0.7);
          lid(0, 0.2);
          wait(0.8 + 0.5 * r());
          lid(1, 0.2);
          arm(1, 0.22);
          flip();
          wait(0.05);
          arm(0, 0.25);
          lid(0, 0.25);
          break;
        case 'fake':
          wait(0.3);
          lid(1, 0.25);
          arm(0.72, 0.3);
          wait(0.6);
          arm(0.3, 0.35);
          wait(0.4 + 0.3 * r());
          arm(1, 0.15);
          flip();
          wait(0.1);
          arm(0, 0.25);
          lid(0, 0.3);
          break;
        case 'instant':
          wait(0.04);
          lid(1, 0.07);
          arm(1, 0.08);
          flip();
          arm(0, 0.1);
          lid(0, 0.12);
          break;
        case 'sulk':
          wait(2.2 + 1.2 * r());
          lid(1, 0.25);
          arm(1, 0.28);
          flip();
          wait(0.1);
          arm(0, 0.3);
          lid(0, 0.3);
          break;
        default:
          wait(0.3 + 0.4 * r());
          lid(1, 0.25);
          arm(1, 0.28);
          flip();
          wait(0.1);
          arm(0, 0.3);
          lid(0, 0.3);
      }
      this.mood = mood;
      this.queue = q;
      this.phase = null;
    }
    get active() {
      return !!(this.phase || this.queue.length);
    }
    // The user has just switched it on.
    provoked() {
      if (!this.toggle.on) return;
      if (!this.active) {
        this.plan();
        return;
      }
      // Already busy. If a flip is still to come and the arm is not out, the
      // plan in hand will deal with it.
      const pending = (this.phase && this.phase.kind === 'flip') || this.queue.some((p) => p.kind === 'flip');
      if (pending && this.arm <= 0.5) return;
      // Otherwise the arm is out, or it is on its way home with the job done:
      // it goes straight back and flips it again, without the ceremony.
      this.queue = [
        { kind: 'lid', to: 1, t: 0.2 * (1 - this.lid) },
        { kind: 'arm', to: 1, t: 0.05 + 0.15 * (1 - this.arm) },
        { kind: 'flip', t: 0 },
        { kind: 'wait', t: 0.1 },
        { kind: 'arm', to: 0, t: 0.25 },
        { kind: 'lid', to: 0, t: 0.3 },
      ];
      this.phase = null;
    }
    grab() {
      return this.toggle.grab();
    }
    drag(p) {
      const ev = this.toggle.drag(p);
      if (ev.length && this.toggle.on) this.provoked();
      return ev;
    }
    release() {
      return this.toggle.release();
    }
    tap() {
      const ev = this.toggle.tap();
      if (this.toggle.on) this.provoked();
      return ev;
    }
    step(dt) {
      // The page always passes real time here; `instant` makes the lever, lid and
      // arm jump while the pauses still take as long as they take.
      let ev = this.toggle.step(this.instant ? Infinity : dt);
      let remaining = Number.isFinite(dt) ? dt : 0.05;
      let guard = 0;
      while (remaining > 0 && (this.phase || this.queue.length) && guard++ < 50) {
        if (!this.phase) {
          const p = this.queue.shift();
          p.elapsed = 0;
          p.from = p.kind === 'lid' ? this.lid : p.kind === 'arm' ? this.arm : 0;
          if (p.kind === 'arm' && p.to !== p.from) ev.push('motor');
          if (p.kind === 'lid' && p.to > p.from && p.from < 0.01) ev.push('creak');
          this.phase = p;
        }
        const p = this.phase;
        if (p.kind === 'flip') {
          if (this.toggle.on) {
            this.toggle.held = false;
            this.toggle.on = false;
            this.flips++;
            ev.push('snap');
          }
          this.phase = null;
          continue;
        }
        const t = p.t || 0;
        const use = Math.min(remaining, Math.max(0, t - p.elapsed));
        p.elapsed += use;
        remaining -= use;
        const f = t > 0 ? Math.min(1, p.elapsed / t) : 1;
        const e = this.instant ? 1 : easeInOut(f);
        if (p.kind === 'lid') this.lid = p.from + (p.to - p.from) * e;
        if (p.kind === 'arm') this.arm = p.from + (p.to - p.from) * e;
        if (p.elapsed >= t - 1e-9) {
          if (p.kind === 'lid') this.lid = p.to;
          if (p.kind === 'arm') this.arm = p.to;
          this.phase = null;
        }
      }
      return ev;
    }
    idle() {
      return !this.active && this.toggle.idle();
    }
  }

  /* ------------------------------------------------------------------ Tally
   * A mechanical counter. Four digit drums, so it reads 0000 again after 9999.
   * `shown` is where the units drum has rolled to; drums() says where every
   * drum sits. */
  class Tally {
    constructor({ count = 0 } = {}) {
      this.count = count % 10000;
      this.shown = this.count; // what the drums currently display (animates)
      this.vel = 0;
    }
    // Another exhibit was operated: count it silently.
    bump() {
      this.count = (this.count + 1) % 10000;
      return [];
    }
    press() {
      this.bump();
      return ['click'];
    }
    digits() {
      return String(this.count).padStart(4, '0');
    }
    // The four drums, thousands first, for a reading v (fractional while the
    // drums roll): the digit square in the window and how far (0..1) the drum
    // has turned toward the next. The units drum turns with v. Each higher
    // drum is carried only while every drum below it shows 9 and the units
    // drum rolls from 9 to 0, as a counter's carry pinions do, so at rest
    // every drum sits square on its digit.
    drums(v = this.shown) {
      v = ((v % 10000) + 10000) % 10000;
      const out = [];
      for (let place = 1000; place >= 1; place /= 10) {
        const digit = Math.floor(v / place) % 10;
        const frac = place === 1 ? v - Math.floor(v) : Math.max(0, (v % place) - (place - 1));
        out.push({ digit, frac });
      }
      return out;
    }
    step(dt) {
      // The drums roll toward the count; across the 9999 -> 0000 wrap they roll forward.
      let target = this.count;
      if (this.shown > target) target += 10000;
      settle(this, dt, target, { key: 'shown', k: 700, zeta: 0.95, tol: 0.002 });
      if (this.shown >= 10000) this.shown -= 10000;
      return [];
    }
    idle() {
      return this.shown === this.count && this.vel === 0;
    }
  }

  return {
    settle,
    mulberry32,
    Toggle,
    Detented,
    Momentary,
    Latching,
    Dip,
    Knife,
    PullChain,
    Breaker,
    Guarded,
    EStop,
    UselessBox,
    Tally,
  };
});
