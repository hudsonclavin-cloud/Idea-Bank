/* Gait: pure game logic. No DOM, no timing source, no randomness except a seeded RNG.
 *
 * The player is a closed loop of string with a fixed perimeter. It rolls to the right over
 * ground with holes in it, and the player chooses how many corners the loop has (3 to 6).
 * Rolling a regular polygon means tipping over one corner until the next corner touches
 * down, so each corner is a footstep and the stride is one side length: perimeter / corners.
 *
 * Everything lives on an integer lattice: perimeter 60 gives strides of 20, 15, 12 and 10
 * units, so every touchdown lands on a whole unit and the rules are exact (10 units = 1 m).
 *
 * Loaded two ways: as a classic <script> (exposes window.GaitLogic) and as a CommonJS
 * module for the headless tests in test/.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GaitLogic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PERIMETER = 60;
  const SHAPES = [3, 4, 5, 6];
  const stride = (n) => PERIMETER / n;
  const STRIDES = SHAPES.map(stride); // [20, 15, 12, 10]
  const MAX_STRIDE = 20;
  const UNITS_PER_METRE = 10;
  const START_X = 0;
  // A landing that is doomed (no way to survive forever) must kill you within this many
  // further safe touchdowns. That keeps every trap close enough to see on screen.
  const TRAP_DEPTH = 1;
  const DP_WINDOW = 720;

  const lerp = (a, b, t) => a + (b - a) * t;

  function makeRng(seed) {
    let s = seed >>> 0 || 0x9e3779b9;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const randInt = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

  /** 0 at the start, creeping toward 1 over a long run. */
  function difficulty(x) {
    return 1 - Math.exp(-Math.max(0, x - 60) / 3600);
  }
  /** Rolling speed in units per second. The loop always covers its perimeter per full turn,
   *  whatever its shape, so speed is a property of the run, not of the shape. */
  function speedAt(dist) {
    return 30 + 38 * (1 - Math.exp(-Math.max(0, dist) / 3200));
  }

  // ---------------------------------------------------------------------------------------
  // Course: the ground. cell[x] = 1 means integer position x is strictly inside a hole.
  // Holes are open intervals (a, b) with integer ends, so a and b themselves are solid lips.
  // ---------------------------------------------------------------------------------------
  class Course {
    constructor(seed) {
      this.seed = seed >>> 0;
      this.rng = makeRng(this.seed);
      this.cap = 4096;
      this.cell = new Uint8Array(this.cap);
      this.viab = new Uint8Array(this.cap); // 1 = you can survive forever from here
      this.surv = new Uint8Array(this.cap); // for doomed spots: max further safe touchdowns
      this.pits = []; // {a, b}, sorted by a
      this.chimes = []; // sorted integer positions
      this.end = START_X + 40; // [0, end) is decided; beyond is not generated yet
      this.lastChime = -1e9;
      this.analyse();
      this.ensure(500);
    }

    grow(n) {
      if (n < this.cap) return;
      let cap = this.cap;
      while (cap <= n) cap *= 2;
      for (const k of ['cell', 'viab', 'surv']) {
        const next = new Uint8Array(cap);
        next.set(this[k]);
        this[k] = next;
      }
      this.cap = cap;
    }

    ensure(x) {
      while (this.end < x) this.chunk();
    }

    isPit(x) {
      return x >= 0 && x < this.end && this.cell[x] === 1;
    }
    isEdge(x) {
      return !this.isPit(x) && (this.isPit(x - 1) || this.isPit(x + 1));
    }
    isPin(x) {
      return !this.isPit(x) && this.isPit(x - 1) && this.isPit(x + 1);
    }
    /** Can a corner land here and still have some way to keep going forever? */
    viable(x) {
      if (x >= this.end) return true;
      if (x < 0) return false;
      return this.viab[x] === 1;
    }
    /** Index of the first pit whose right end is beyond x. */
    firstPitAfter(x) {
      const p = this.pits;
      let lo = 0;
      let hi = p.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (p[mid].b <= x) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    }
    pitAt(x) {
      const i = this.firstPitAfter(x);
      const p = this.pits[i];
      return p && p.a < x && x < p.b ? p : null;
    }
    firstChimeAtOrAfter(x) {
      const c = this.chimes;
      let lo = 0;
      let hi = c.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (c[mid] < x) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    }
    isChime(x) {
      const i = this.firstChimeAtOrAfter(x);
      return this.chimes[i] === x;
    }

    /** Backward dynamic programme over the recent window. Returns false if some solid spot
     *  is an unfair trap (doomed, but the doom lies more than TRAP_DEPTH touchdowns away). */
    analyse() {
      const hi = this.end + 1; // positions >= hi are undecided and assumed survivable
      this.grow(hi + MAX_STRIDE + 1);
      const lo = Math.max(0, hi - DP_WINDOW);
      const { cell, viab, surv } = this;
      let fair = true;
      for (let x = hi - 1; x >= lo; x--) {
        if (cell[x]) {
          viab[x] = 0;
          surv[x] = 0;
          continue;
        }
        let ok = 0;
        let depth = 0;
        for (let i = 0; i < STRIDES.length; i++) {
          const y = x + STRIDES[i];
          if (y >= hi || viab[y]) {
            ok = 1;
            break;
          }
          if (!cell[y]) depth = Math.max(depth, surv[y] + 1);
        }
        viab[x] = ok;
        surv[x] = ok ? 255 : Math.min(depth, 254);
        if (!ok && depth > TRAP_DEPTH) fair = false;
      }
      return fair;
    }

    tryPit(a, b) {
      if (b - a < 2) return false; // a hole needs at least one integer inside it
      this.grow(b + MAX_STRIDE + 2);
      for (let x = a + 1; x < b; x++) this.cell[x] = 1;
      const prevEnd = this.end;
      this.end = Math.max(this.end, b);
      if (this.analyse()) {
        this.pits.push({ a, b });
        return true;
      }
      for (let x = a + 1; x < b; x++) this.cell[x] = 0;
      this.end = prevEnd;
      this.analyse();
      return false;
    }

    /** Append one stretch of solid ground followed by a cluster of holes. */
    chunk() {
      const R = this.rng;
      const x0 = this.end;
      const D = difficulty(x0);
      const first = this.pits.length === 0;
      let pos = x0 + (first ? 30 : randInt(R, Math.round(lerp(46, 20, D)), Math.round(lerp(84, 44, D))));
      let count = 1;
      if (!first) {
        if (R() < 0.12 + 0.55 * D) count++;
        if (R() < 0.35 * D) count++;
        if (R() < 0.2 * D) count++;
      }
      const clusterStart = pos;
      for (let i = 0; i < count; i++) {
        const minW = Math.max(2, Math.round(lerp(3, 7, D)));
        const maxW = Math.max(minW, Math.round(lerp(first ? 6 : 9, 19, D)));
        let w = randInt(R, minW, maxW);
        let placed = 0;
        while (w >= 2) {
          if (this.tryPit(pos, pos + w)) {
            placed = w;
            break;
          }
          w -= 3;
        }
        pos += placed;
        // The gap to the next hole: 0 leaves a single-point "pin" between two holes.
        if (i < count - 1) pos += R() < 0.12 + 0.3 * D ? 0 : randInt(R, 1, Math.round(lerp(13, 5, D)));
      }
      this.end = Math.max(this.end, pos);
      this.analyse();
      this.placeChimes(x0, this.end, clusterStart, D);
    }

    placeChimes(x0, x1, clusterStart, D) {
      const R = this.rng;
      let want = (R() < 0.8 ? 1 : 0) + (R() < 0.2 + 0.35 * D ? 1 : 0);
      if (x0 < 60) want = 0; // let the first hole be just a hole
      const picks = [];
      while (want-- > 0) {
        const cands = [];
        let total = 0;
        for (let x = Math.max(x0, 1); x < x1; x++) {
          if (this.cell[x] || !this.viab[x]) continue;
          if (x - this.lastChime < 24) continue;
          if (picks.some((p) => Math.abs(p - x) < 24)) continue;
          const w = this.isPin(x) ? 6 : this.isEdge(x) ? 3 : x >= clusterStart ? 2 : 1;
          cands.push(x, w);
          total += w;
        }
        if (!total) break;
        let r = R() * total;
        for (let i = 0; i < cands.length; i += 2) {
          r -= cands[i + 1];
          if (r <= 0) {
            picks.push(cands[i]);
            break;
          }
        }
      }
      picks.sort((p, q) => p - q);
      for (const p of picks) this.chimes.push(p);
      if (picks.length) this.lastChime = picks[picks.length - 1];
    }
  }

  // ---------------------------------------------------------------------------------------
  // Runner: the rolling loop. Time-driven but deterministic for a given sequence of dt.
  // ---------------------------------------------------------------------------------------
  class Runner {
    constructor(course, firstShape) {
      this.course = course;
      this.x = START_X; // the corner we are tipping over (last touchdown)
      this.n = SHAPES.includes(firstShape) ? firstShape : 4; // shape of the current step
      this.prevN = this.n; // shape of the step before (what we are morphing from)
      this.gear = this.n; // shape selected for the next step
      this.target = this.x + stride(this.n); // where the current step's corner will land
      this.phase = 0; // 0..1 through the current step
      this.stepAge = 0; // seconds since the current step began
      this.stepId = 0;
      this.speed = speedAt(0);
      this.state = 'ready'; // ready | rolling | fallen
      this.bonus = 0;
      this.score = 0;
      this.streak = 0;
      this.bestStreak = 0;
      this.chimeCount = 0;
      this.edgeCount = 0;
      this.steps = 0;
      this.nextChime = 0;
      this.taken = new Set();
      this.missed = new Set();
      this.history = [];
      this.fall = null;
    }

    get dist() {
      return this.x - START_X;
    }
    stepDuration(n = this.n) {
      return stride(n) / this.speed;
    }
    /** A shift made this soon after a touchdown still counts for the step just begun. */
    grace() {
      return Math.min(0.085, 0.3 * this.stepDuration());
    }

    start() {
      if (this.state !== 'ready') return;
      this.state = 'rolling';
      this.n = this.gear;
      this.target = this.x + stride(this.n);
      this.phase = 0;
      this.stepAge = 0;
    }

    /** Select the shape for the next step. Returns true if the selection changed. */
    setGear(n) {
      if (!SHAPES.includes(n)) return false;
      const changed = n !== this.gear;
      this.gear = n;
      if (this.state === 'ready') {
        if (n !== this.n) {
          this.prevN = this.n;
          this.n = n;
          this.target = this.x + stride(n);
        }
      } else if (this.state === 'rolling' && n !== this.n && this.stepAge <= this.grace()) {
        // Late shift: re-commit the step that has only just begun.
        this.n = n;
        this.target = this.x + stride(n);
        this.phase = Math.min(0.95, this.stepAge / this.stepDuration());
        this.lateShift = true;
      }
      return changed;
    }

    shiftGear(delta) {
      const i = SHAPES.indexOf(this.gear);
      const j = Math.max(0, Math.min(SHAPES.length - 1, i + delta));
      return this.setGear(SHAPES[j]);
    }

    /** Advance by dt seconds. Returns the events that happened, in order. */
    update(dt) {
      const events = [];
      let left = dt;
      while (left > 0 && this.state === 'rolling') {
        const T = this.stepDuration();
        const need = (1 - this.phase) * T;
        if (left < need) {
          this.phase += left / T;
          this.stepAge += left;
          left = 0;
        } else {
          left -= need;
          this.phase = 1;
          events.push(this.touchdown());
        }
      }
      return events;
    }

    touchdown() {
      const c = this.course;
      const x = this.target;
      const landed = this.n;
      this.history.push({ x, n: landed });
      if (this.history.length > 200) this.history.shift();
      if (c.isPit(x)) {
        this.state = 'fallen';
        this.fall = { x, n: landed, from: this.x, pit: c.pitAt(x) };
        return { type: 'fall', x, n: landed, from: this.x, pit: this.fall.pit };
      }
      const ev = { type: 'land', x, n: landed, from: this.x, edge: false, pin: false, chime: false, missed: 0, points: 0, streak: 0 };
      // Any chime we stepped over without touching breaks the chain.
      const ch = c.chimes;
      while (this.nextChime < ch.length && ch[this.nextChime] < x) {
        this.missed.add(ch[this.nextChime]);
        this.nextChime++;
        ev.missed++;
      }
      if (ev.missed && this.streak) ev.brokeStreak = this.streak;
      if (ev.missed) this.streak = 0;
      if (this.nextChime < ch.length && ch[this.nextChime] === x) {
        this.nextChime++;
        this.taken.add(x);
        this.streak++;
        this.chimeCount++;
        this.bestStreak = Math.max(this.bestStreak, this.streak);
        const pts = 10 * Math.min(this.streak, 5);
        ev.chime = true;
        ev.streak = this.streak;
        ev.points += pts;
      }
      if (c.isPin(x)) {
        ev.pin = true;
        ev.points += 10;
        this.edgeCount++;
      } else if (c.isEdge(x)) {
        ev.edge = true;
        ev.points += 5;
        this.edgeCount++;
      }
      this.bonus += ev.points;
      this.steps++;
      this.x = x;
      this.score = Math.floor(this.dist / UNITS_PER_METRE) + this.bonus;
      this.speed = speedAt(this.dist);
      c.ensure(x + 420);
      // Commit the next step with whatever shape is selected right now.
      this.prevN = landed;
      this.n = this.gear;
      this.target = x + stride(this.n);
      this.phase = 0;
      this.stepAge = 0;
      this.stepId++;
      this.lateShift = false;
      ev.nextN = this.n;
      return ev;
    }
  }

  // ---------------------------------------------------------------------------------------
  // A small planner: used for the attract-mode demo and by the tests as a "perfect" player.
  // Searches shape sequences a few steps deep from a committed landing.
  // ---------------------------------------------------------------------------------------
  function planGear(course, from, current, depth = 3) {
    let bestScore = -Infinity;
    let bestGear = null;
    for (const n of SHAPES) {
      const x = from + stride(n);
      if (!course.viable(x)) continue;
      const s = scoreLine(course, x, depth - 1) + (course.isChime(x) ? 3 : 0) + (n === current ? 0.4 : 0);
      if (s > bestScore) {
        bestScore = s;
        bestGear = n;
      }
    }
    return bestGear;
  }
  function scoreLine(course, x, depth) {
    if (depth <= 0) return 0;
    let best = -Infinity;
    for (const n of SHAPES) {
      const y = x + stride(n);
      if (!course.viable(y)) continue;
      best = Math.max(best, scoreLine(course, y, depth - 1) + (course.isChime(y) ? 2 : 0));
    }
    return best === -Infinity ? -100 : best;
  }

  return {
    PERIMETER,
    SHAPES,
    STRIDES,
    MAX_STRIDE,
    UNITS_PER_METRE,
    START_X,
    TRAP_DEPTH,
    stride,
    difficulty,
    speedAt,
    makeRng,
    Course,
    Runner,
    planGear,
  };
});
