// Desire Lines — simulation core. No DOM; runs in the browser and in Node.
//
// An "active walker" model of human trail formation, after
// D. Helbing, J. Keltsch & P. Molnar, "Modelling the evolution of human trail
// systems", Nature 388, 47-50 (1997). Four local rules:
//   1. Each walker heads for its destination door.
//   2. It is also drawn sideways toward worn ground it can see nearby
//      (the gradient of a blurred "comfort" map), but never more than ~64 deg
//      off its bearing.
//   3. Every step it takes wears the grass under its feet a little.
//   4. Grass regrows: wear decays exponentially toward zero.
// Nobody plans a network, yet one appears.
//
// A classic script (not an ES module) so index.html works straight from disk:
// everything is exposed as the global DesireSim. check.mjs loads it with node:vm.
(function (root) {
  'use strict';

  const HEDGE = 1;
  const WATER = 2;
  const MAX_DOORS = 10;

  const DEFAULTS = Object.freeze({
    traffic: 0.3, // new walkers per step
    recovery: 1500, // grass regrowth time constant, in steps
    pull: 2.0, // how strongly walkers are drawn toward worn ground (0 = beeline)
    sight: 15, // how far walkers notice trails: sigma of the wide comfort blur, in cells
    far: 4.0, // weight of the wide (far-sighted) blur relative to the narrow one
    intensity: 0.05, // wear deposited per cell walked
    speed: 0.5, // cells per step
    tau: 3, // velocity relaxation time, in steps
    noise: 0.12, // heading noise, radians (s.d.) per step
  });

  const ARRIVE = 2.2; // a walker within this many cells of its door has arrived
  const SPAWN_JITTER = 1.2;
  const PULL_MAX = 0.9; // the trail term saturates below this, so progress is guaranteed
  const PULL_GAIN = 2.0;
  const NEAR_SIGMA = 2.5; // the narrow blur keeps walkers on the crown of a trail
  const PAVE_COMFORT = 1.0; // pavement is as comfortable as the best-worn trail...
  const PAVE_FAR = 0.25; // ...but a strip of grey seen across a lawn is not a beaten track
  const LOS_EVERY = 6; // steps between line-of-sight re-checks (only when walls exist)
  const WORN = 0.25; // wear above which a cell counts as "worn" in the stats
  const TRAIL = 0.08; // lightly-blurred wear above which ground counts as part of a trail

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  class TrailSim {
    constructor({ N = 200, seed = 1, maxWalkers = 1500, params = {} } = {}) {
      this.N = N;
      const NN = N * N;
      this.G = new Float32Array(NN); // wear, 0..1 (grass cells only)
      this.C = new Float32Array(NN); // comfort: wear, or PAVE_COMFORT on pavement
      this.V = new Float32Array(NN); // trail potential = near blur + far blur of comfort
      this.Cf = new Float32Array(NN); // comfort as seen from afar (pavement counts less)
      if (N % 2) throw new Error('grid size must be even');
      const H = (this.H = N / 2); // the far view is blurred at half resolution
      this.Ch = new Float32Array(H * H);
      this.Vh = new Float32Array(H * H);
      this.tmpH = new Float32Array(H * H);
      this.M = new Float32Array(NN); // scratch for metrics
      this.upI = new Int32Array(N); // bilinear upsampling: source index and weight
      this.upA = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const f = (i + 0.5) / 2 - 0.5;
        const i0 = Math.min(H - 2, Math.max(0, Math.floor(f)));
        this.upI[i] = i0;
        this.upA[i] = Math.min(1, Math.max(0, f - i0));
      }
      this.tmp = new Float32Array(NN);
      this.gx = new Float32Array(NN); // gradient of V
      this.gy = new Float32Array(NN);
      this.paved = new Uint8Array(NN);
      this.wall = new Uint8Array(NN); // 0 open, HEDGE, WATER
      this.wallCount = 0;
      this.params = { ...DEFAULTS, ...params };
      this.rng = mulberry32(seed);

      this.doors = [];
      this.doorById = new Map();
      this.nextDoorId = 1;
      this.fieldBudget = 0;

      const M = (this.MAXW = maxWalkers);
      this.wx = new Float32Array(M);
      this.wy = new Float32Array(M);
      this.wvx = new Float32Array(M);
      this.wvy = new Float32Array(M);
      this.wwalk = new Float32Array(M); // distance walked so far
      this.wbase = new Float32Array(M); // shortest possible distance at spawn
      this.wdest = new Int32Array(M); // destination door id
      this.wlos = new Uint8Array(M); // 1 if destination currently in plain sight
      this.wlosT = new Int16Array(M); // steps until next line-of-sight check
      this.wcount = new Uint8Array(M); // 0 if the trip no longer counts toward detour stats
      this.nw = 0;

      this.clock = 0; // steps since creation; never reset (paces distance-field rebuilds)
      this._tx = 0;
      this._ty = 0;
      this._fx = 0;
      this._fy = 0;
      this.resetStats();
    }

    resetStats() {
      this.steps = 0;
      this.spawnAcc = 0;
      this.arrived = 0;
      this.gaveUp = 0;
      this.spawned = this.nw || 0; // walkers already under way count as spawned
      this.culled = 0; // walkers removed because their door vanished or a wall landed on them
      this.detour = 0; // running mean (EMA after warm-up) of walked/shortest - 1
      this.counted = 0;
      this.paveSteps = 0; // EMA-weighted share of steps taken on pavement
      this.allSteps = 0;
    }

    // ------------------------------------------------------------------ doors

    addDoor(x, y) {
      if (this.doors.length >= MAX_DOORS) return null;
      const N = this.N;
      x = Math.min(N - 1.5, Math.max(1.5, x));
      y = Math.min(N - 1.5, Math.max(1.5, y));
      if (this.nearWall(x, y, 1.5)) return null;
      const d = { id: this.nextDoorId++, x, y, field: null, parent: null, stale: true, fieldStep: -1e9 };
      this.doors.push(d);
      this.doorById.set(d.id, d);
      return d;
    }

    removeDoor(id) {
      const i = this.doors.findIndex((d) => d.id === id);
      if (i < 0) return false;
      this.doors.splice(i, 1);
      this.doorById.delete(id);
      for (let k = this.nw - 1; k >= 0; k--)
        if (this.wdest[k] === id) {
          this.removeWalker(k);
          this.culled++;
        }
      return true;
    }

    moveDoor(id, x, y) {
      const d = this.doorById.get(id);
      if (!d) return false;
      const N = this.N;
      x = Math.min(N - 1.5, Math.max(1.5, x));
      y = Math.min(N - 1.5, Math.max(1.5, y));
      if (this.nearWall(x, y, 1.5)) return false;
      d.x = x;
      d.y = y;
      d.stale = true;
      // Trips already under way to a moved door no longer have a meaningful detour.
      for (let k = 0; k < this.nw; k++) {
        if (this.wdest[k] !== id) continue;
        this.wcount[k] = 0;
        this.wbase[k] = Math.max(1, this.wwalk[k] + Math.hypot(x - this.wx[k], y - this.wy[k]) - ARRIVE);
      }
      return true;
    }

    doorAt(x, y, r) {
      let best = null;
      let bd = r * r;
      for (const d of this.doors) {
        const dd = (d.x - x) ** 2 + (d.y - y) ** 2;
        if (dd <= bd) {
          bd = dd;
          best = d;
        }
      }
      return best;
    }

    // ------------------------------------------------------------ terrain edits

    isWall(x, y) {
      const N = this.N;
      if (x < 0 || y < 0 || x >= N || y >= N) return true;
      return this.wall[(y | 0) * N + (x | 0)] !== 0;
    }

    nearWall(x, y, r) {
      if (!this.wallCount) return false;
      const N = this.N;
      for (let j = Math.floor(y - r); j <= Math.floor(y + r); j++) {
        for (let i = Math.floor(x - r); i <= Math.floor(x + r); i++) {
          if (i < 0 || j < 0 || i >= N || j >= N) continue;
          if (this.wall[j * N + i] && (i + 0.5 - x) ** 2 + (j + 0.5 - y) ** 2 <= r * r) return true;
        }
      }
      return false;
    }

    // kind: 'pave' | 'hedge' | 'water' | 'erase'. Coordinates in cells.
    paint(cx, cy, r, kind) {
      const N = this.N;
      const { G, paved, wall } = this;
      let wallsChanged = false;
      const j0 = Math.max(0, Math.floor(cy - r));
      const j1 = Math.min(N - 1, Math.floor(cy + r));
      const i0 = Math.max(0, Math.floor(cx - r));
      const i1 = Math.min(N - 1, Math.floor(cx + r));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          if ((i + 0.5 - cx) ** 2 + (j + 0.5 - cy) ** 2 > r * r) continue;
          const c = j * N + i;
          if (kind === 'pave') {
            if (!wall[c]) {
              paved[c] = 1;
              G[c] = 0;
            }
          } else if (kind === 'hedge' || kind === 'water') {
            // keep a clear apron around every door so doors stay usable
            let nearDoor = false;
            for (const d of this.doors) {
              if ((i + 0.5 - d.x) ** 2 + (j + 0.5 - d.y) ** 2 < 2.6 * 2.6) nearDoor = true;
            }
            if (nearDoor) continue;
            const t = kind === 'hedge' ? HEDGE : WATER;
            if (wall[c] !== t) {
              if (!wall[c]) this.wallCount++;
              wall[c] = t;
              wallsChanged = true;
            }
            paved[c] = 0;
            G[c] = 0;
          } else if (kind === 'erase') {
            if (wall[c]) {
              wall[c] = 0;
              this.wallCount--;
              wallsChanged = true;
            }
            paved[c] = 0;
            G[c] = 0;
          }
        }
      }
      if (wallsChanged) for (const d of this.doors) d.stale = true;
      return wallsChanged;
    }

    paintLine(x0, y0, x1, y1, r, kind) {
      const len = Math.hypot(x1 - x0, y1 - y0);
      const n = Math.max(1, Math.ceil(len / 0.5));
      let changed = false;
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        changed = this.paint(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r, kind) || changed;
      }
      return changed;
    }

    resetTurf() {
      this.G.fill(0);
    }

    clearAll() {
      this.G.fill(0);
      this.paved.fill(0);
      this.wall.fill(0);
      this.wallCount = 0;
      this.doors = [];
      this.doorById.clear();
      this.nw = 0;
      this.resetStats();
      this.updateField(0);
    }

    // Turn every well-worn patch of grass into pavement (what smart campuses do).
    // The wear map is smoothed a little first so the new sidewalks have clean edges.
    paveWorn(threshold = 0.35) {
      const { G, M, paved, wall } = this;
      blurGrid(G, M, this.tmp, this.N, 1);
      let n = 0;
      for (let c = 0; c < G.length; c++) {
        if (!wall[c] && !paved[c] && M[c] > threshold) {
          paved[c] = 1;
          G[c] = 0;
          n++;
        }
      }
      return n;
    }

    // ---------------------------------------------------------------- walkers

    removeWalker(k) {
      const last = --this.nw;
      if (k !== last) {
        this.wx[k] = this.wx[last];
        this.wy[k] = this.wy[last];
        this.wvx[k] = this.wvx[last];
        this.wvy[k] = this.wvy[last];
        this.wwalk[k] = this.wwalk[last];
        this.wbase[k] = this.wbase[last];
        this.wdest[k] = this.wdest[last];
        this.wlos[k] = this.wlos[last];
        this.wlosT[k] = this.wlosT[last];
        this.wcount[k] = this.wcount[last];
      }
    }

    spawn() {
      const doors = this.doors;
      const n = doors.length;
      if (n < 2 || this.nw >= this.MAXW) return false;
      const rng = this.rng;
      const oi = Math.floor(rng() * n);
      let di = Math.floor(rng() * (n - 1));
      if (di >= oi) di++;
      const o = doors[oi];
      const dest = doors[di];
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * SPAWN_JITTER;
      const x = o.x + Math.cos(a) * r;
      const y = o.y + Math.sin(a) * r;
      if (this.isWall(x, y)) return false;
      let base = Math.hypot(dest.x - x, dest.y - y);
      let los = 1;
      if (this.wallCount) {
        los = this.lineOfSight(x, y, dest.x, dest.y) ? 1 : 0;
        if (!los) {
          const f = this.fieldFor(dest);
          if (f) {
            const D = f[(y | 0) * this.N + (x | 0)];
            if (D === Infinity) return false; // unreachable: nobody sets off
            base = Math.max(base, this.tautLength(dest, x, y));
          }
        }
      }
      const k = this.nw++;
      this.wx[k] = x;
      this.wy[k] = y;
      const dd = Math.hypot(dest.x - x, dest.y - y) || 1;
      this.wvx[k] = (this.params.speed * (dest.x - x)) / dd;
      this.wvy[k] = (this.params.speed * (dest.y - y)) / dd;
      this.wwalk[k] = 0;
      this.wbase[k] = Math.max(1, base - ARRIVE);
      this.wdest[k] = dest.id;
      this.wlos[k] = los;
      this.wlosT[k] = LOS_EVERY;
      this.wcount[k] = base - ARRIVE >= 6 ? 1 : 0; // trips of a few steps say nothing about detours
      this.spawned++;
      return true;
    }

    lineOfSight(x0, y0, x1, y1) {
      const N = this.N;
      const wall = this.wall;
      const len = Math.hypot(x1 - x0, y1 - y0);
      const n = Math.ceil(len * 2);
      for (let k = 1; k < n; k++) {
        const t = k / n;
        const x = x0 + (x1 - x0) * t;
        const y = y0 + (y1 - y0) * t;
        if (wall[(y | 0) * N + (x | 0)]) return false;
      }
      return true;
    }

    // Bilinear sample of the trail-potential gradient into this._tx/_ty.
    sampleGrad(x, y) {
      const N = this.N;
      let fx = x - 0.5;
      let fy = y - 0.5;
      let i0 = Math.floor(fx);
      let j0 = Math.floor(fy);
      if (i0 < 0) i0 = 0;
      else if (i0 > N - 2) i0 = N - 2;
      if (j0 < 0) j0 = 0;
      else if (j0 > N - 2) j0 = N - 2;
      let ax = fx - i0;
      let ay = fy - j0;
      ax = ax < 0 ? 0 : ax > 1 ? 1 : ax;
      ay = ay < 0 ? 0 : ay > 1 ? 1 : ay;
      const c = j0 * N + i0;
      const w00 = (1 - ax) * (1 - ay);
      const w10 = ax * (1 - ay);
      const w01 = (1 - ax) * ay;
      const w11 = ax * ay;
      const gx = this.gx;
      const gy = this.gy;
      this._tx = gx[c] * w00 + gx[c + 1] * w10 + gx[c + N] * w01 + gx[c + N + 1] * w11;
      this._ty = gy[c] * w00 + gy[c + 1] * w10 + gy[c + N] * w01 + gy[c + N + 1] * w11;
    }

    // Wear the grass around (x, y), splatting bilinearly over four cells.
    deposit(x, y, amt) {
      const N = this.N;
      const { G, paved, wall } = this;
      const fx = x - 0.5;
      const fy = y - 0.5;
      const i0 = Math.floor(fx);
      const j0 = Math.floor(fy);
      const ax = fx - i0;
      const ay = fy - j0;
      for (let dj = 0; dj <= 1; dj++) {
        const j = j0 + dj;
        if (j < 0 || j >= N) continue;
        const wy = dj ? ay : 1 - ay;
        for (let di = 0; di <= 1; di++) {
          const i = i0 + di;
          if (i < 0 || i >= N) continue;
          const c = j * N + i;
          if (paved[c] || wall[c]) continue;
          const w = (di ? ax : 1 - ax) * wy;
          G[c] += amt * w * (1 - G[c]);
        }
      }
    }

    // Direction of steepest descent of a door's distance field, into this._fx/_fy.
    fieldDir(D, x, y) {
      const N = this.N;
      const i = Math.min(N - 1, Math.max(0, x | 0));
      const j = Math.min(N - 1, Math.max(0, y | 0));
      const c = j * N + i;
      const d0 = D[c];
      if (d0 === Infinity) return false;
      const dl = i > 0 ? D[c - 1] : Infinity;
      const dr = i < N - 1 ? D[c + 1] : Infinity;
      const du = j > 0 ? D[c - N] : Infinity;
      const dd = j < N - 1 ? D[c + N] : Infinity;
      let gx = 0;
      let gy = 0;
      if (dl !== Infinity && dr !== Infinity) gx = (dr - dl) * 0.5;
      else if (dr !== Infinity) gx = dr - d0;
      else if (dl !== Infinity) gx = d0 - dl;
      if (du !== Infinity && dd !== Infinity) gy = (dd - du) * 0.5;
      else if (dd !== Infinity) gy = dd - d0;
      else if (du !== Infinity) gy = d0 - du;
      let m = Math.hypot(gx, gy);
      if (m > 1e-6) {
        const fx = -gx / m;
        const fy = -gy / m;
        if (!this.isWall(x + fx * 0.9, y + fy * 0.9)) {
          this._fx = fx;
          this._fy = fy;
          return true;
        }
      }
      // Fallback: step toward the lowest neighbouring cell (always a free cell).
      let best = d0;
      let bx = 0;
      let by = 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = i + di;
          const nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
          const v = D[nj * N + ni];
          if (v < best) {
            best = v;
            bx = di;
            by = dj;
          }
        }
      }
      if (best < d0) {
        m = Math.hypot(bx, by);
        this._fx = bx / m;
        this._fy = by / m;
        return true;
      }
      return false;
    }

    stepWalkers() {
      const p = this.params;
      const N = this.N;
      const v0 = p.speed;
      const invTau = 1 / p.tau;
      const noise = p.noise;
      const kpull = p.pull * PULL_GAIN;
      const amt = p.intensity;
      const hasWalls = this.wallCount > 0;
      const rng = this.rng;
      const { wx, wy, wvx, wvy, wwalk, wbase, wdest, wlos, wlosT, paved } = this;
      let onPave = 0;
      let moved = 0;
      let k = 0;
      while (k < this.nw) {
        const door = this.doorById.get(wdest[k]);
        const x = wx[k];
        const y = wy[k];
        if (!door || (hasWalls && this.isWall(x, y))) {
          this.removeWalker(k);
          this.culled++;
          continue;
        }
        const dx = door.x - x;
        const dy = door.y - y;
        const dist = Math.hypot(dx, dy);
        if (dist < ARRIVE) {
          this.arrived++;
          if (this.wcount[k]) this.recordDetour(wwalk[k] / wbase[k] - 1);
          this.removeWalker(k);
          continue;
        }
        if (wwalk[k] > 6 * wbase[k] + 4 * N) {
          this.gaveUp++;
          this.removeWalker(k);
          continue;
        }
        // Rule 1: head for the door (around obstacles if it is out of sight).
        let ex = dx / dist;
        let ey = dy / dist;
        if (hasWalls) {
          if (--wlosT[k] <= 0) {
            wlos[k] = this.lineOfSight(x, y, door.x, door.y) ? 1 : 0;
            wlosT[k] = LOS_EVERY;
          }
          if (!wlos[k]) {
            const f = this.fieldFor(door);
            if (f && this.fieldDir(f, x, y)) {
              ex = this._fx;
              ey = this._fy;
            }
          }
        }
        // Rule 2: drift toward visible worn ground, saturating below PULL_MAX.
        if (kpull > 0) {
          this.sampleGrad(x, y);
          const tx = this._tx * kpull;
          const ty = this._ty * kpull;
          const s = 1 / (1 + Math.hypot(tx, ty) / PULL_MAX);
          ex += tx * s;
          ey += ty * s;
        }
        // A little indecision.
        if (noise > 0) {
          const a = noise * (rng() + rng() + rng() - 1.5) * 2;
          const ca = Math.cos(a);
          const sa = Math.sin(a);
          const rx = ex * ca - ey * sa;
          ey = ex * sa + ey * ca;
          ex = rx;
        }
        const em = Math.hypot(ex, ey) || 1;
        let vx = wvx[k] + ((v0 * ex) / em - wvx[k]) * invTau;
        let vy = wvy[k] + ((v0 * ey) / em - wvy[k]) * invTau;
        let nx = x + vx;
        let ny = y + vy;
        if (nx < 0.05) nx = 0.05;
        else if (nx > N - 0.05) nx = N - 0.05;
        if (ny < 0.05) ny = 0.05;
        else if (ny > N - 0.05) ny = N - 0.05;
        if (hasWalls && this.isWall(nx, ny)) {
          if (!this.isWall(nx, y)) {
            ny = y;
            vy = 0;
          } else if (!this.isWall(x, ny)) {
            nx = x;
            vx = 0;
          } else {
            nx = x;
            ny = y;
            vx *= -0.3;
            vy *= -0.3;
          }
        }
        const len = Math.hypot(nx - x, ny - y);
        wwalk[k] += len;
        // Rule 3: trample.
        this.deposit(nx, ny, amt * len);
        if (paved[(ny | 0) * N + (nx | 0)]) onPave += len;
        moved += len;
        wx[k] = nx;
        wy[k] = ny;
        wvx[k] = vx;
        wvy[k] = vy;
        k++;
      }
      // Exponentially-weighted share of walking done on pavement (~1500-step window).
      const a = 1 / 1500;
      this.paveSteps += (onPave - this.paveSteps) * a;
      this.allSteps += (moved - this.allSteps) * a;
    }

    // Running mean of detours, turning into an EMA over ~300 trips.
    recordDetour(d) {
      this.counted++;
      const a = Math.max(1 / 300, 1 / this.counted);
      this.detour += (d - this.detour) * a;
    }

    // Advance k walker steps; the trail potential is refreshed once at the end.
    advance(k = 1) {
      this.fieldBudget = 1;
      const traffic = this.params.traffic;
      for (let s = 0; s < k; s++) {
        this.spawnAcc += traffic;
        while (this.spawnAcc >= 1) {
          this.spawnAcc -= 1;
          this.spawn();
        }
        this.stepWalkers();
        this.steps++;
        this.clock++;
      }
      this.updateField(k);
    }

    // Rule 4 (regrowth), then rebuild the potential walkers can "see".
    updateField(k) {
      const { G, C, Cf, paved, wall } = this;
      const decay = Math.exp(-k / this.params.recovery);
      for (let c = 0; c < G.length; c++) {
        if (wall[c]) C[c] = Cf[c] = 0;
        else if (paved[c]) {
          C[c] = PAVE_COMFORT;
          Cf[c] = PAVE_FAR;
        } else C[c] = Cf[c] = G[c] *= decay;
      }
      const N = this.N;
      const H = this.H;
      const { V, Ch, Vh, gx, gy, upI, upA } = this;
      // Two-scale potential: a sharp near view (stay on the path you are on) plus a
      // wide far view (notice paths, and clusters of paths, some way off). Each is
      // scaled by sigma^2 so a trail at distance ~sigma pulls equally hard in both.
      // The far view is smooth, so it is computed on a half-resolution grid.
      const sf = Math.max(NEAR_SIGMA, this.params.sight);
      blurGrid(C, V, this.tmp, N, NEAR_SIGMA);
      for (let j = 0; j < H; j++) {
        for (let i = 0; i < H; i++) {
          const c = 2 * j * N + 2 * i;
          Ch[j * H + i] = 0.25 * (Cf[c] + Cf[c + 1] + Cf[c + N] + Cf[c + N + 1]);
        }
      }
      blurGrid(Ch, Vh, this.tmpH, H, sf / 2);
      const wn = NEAR_SIGMA * NEAR_SIGMA;
      const wf = sf * sf * this.params.far;
      for (let j = 0; j < N; j++) {
        const j0 = upI[j];
        const ay = upA[j];
        const r0 = j0 * H;
        const r1 = r0 + H;
        const row = j * N;
        for (let i = 0; i < N; i++) {
          const i0 = upI[i];
          const ax = upA[i];
          const top = Vh[r0 + i0] + (Vh[r0 + i0 + 1] - Vh[r0 + i0]) * ax;
          const bot = Vh[r1 + i0] + (Vh[r1 + i0 + 1] - Vh[r1 + i0]) * ax;
          V[row + i] = V[row + i] * wn + (top + (bot - top) * ay) * wf;
        }
      }
      for (let j = 0; j < N; j++) {
        const row = j * N;
        for (let i = 0; i < N; i++) {
          const c = row + i;
          const l = i > 0 ? V[c - 1] : V[c];
          const r = i < N - 1 ? V[c + 1] : V[c];
          const u = j > 0 ? V[c - N] : V[c];
          const d = j < N - 1 ? V[c + N] : V[c];
          gx[c] = (r - l) * 0.5;
          gy[c] = (d - u) * 0.5;
        }
      }
    }

    // ------------------------------------------------------- distance fields

    // A door's distance field, rebuilt lazily: always when missing; when merely stale
    // (door dragged, hedge planted) at most once per advance() and once per 30 steps
    // per door, so dragging a door around hedges stays smooth.
    fieldFor(door) {
      if (!door.field || (door.stale && this.fieldBudget > 0 && this.clock - door.fieldStep >= 30)) {
        this.fieldBudget--;
        door.field = this.computeField(door);
        door.fieldStep = this.clock;
        door.stale = false;
      }
      return door.field;
    }

    // Length of the shortest route from (x, y) to a door around obstacles: follow the
    // Dijkstra tree, then pull the path taut by skipping every corner that can be
    // seen past. (The raw grid distance overestimates by up to ~4%.)
    tautLength(door, x, y) {
      const N = this.N;
      const P = door.parent;
      if (!P) return Math.hypot(door.x - x, door.y - y);
      const px = [x];
      const py = [y];
      let c = (y | 0) * N + (x | 0);
      for (let guard = 0; guard < N * N && P[c] >= 0; guard++) {
        c = P[c];
        px.push((c % N) + 0.5);
        py.push(Math.floor(c / N) + 0.5);
      }
      px.push(door.x);
      py.push(door.y);
      let L = 0;
      let ax = x;
      let ay = y;
      let i = 1;
      const n = px.length;
      while (i < n) {
        // Find a far path point still visible from the anchor: gallop, then bisect.
        let j = i;
        let step = 1;
        while (j + step < n && this.lineOfSight(ax, ay, px[j + step], py[j + step])) {
          j += step;
          step *= 2;
        }
        let hi = Math.min(n - 1, j + step);
        while (hi - j > 1) {
          const mid = (j + hi) >> 1;
          if (this.lineOfSight(ax, ay, px[mid], py[mid])) j = mid;
          else hi = mid;
        }
        L += Math.hypot(px[j] - ax, py[j] - ay);
        ax = px[j];
        ay = py[j];
        i = j + 1;
      }
      return L;
    }

    // Dijkstra over a 16-neighbourhood: geodesic distance to the door around walls.
    // Also leaves the shortest-path tree in door.parent (for tautLength).
    computeField(door) {
      const N = this.N;
      const NN = N * N;
      const wall = this.wall;
      // Float64 so heap keys and stored distances compare exactly (a Float32 store
      // rounds, which makes Dijkstra skip or re-expand nodes).
      const D = new Float64Array(NN).fill(Infinity);
      const P = new Int32Array(NN).fill(-1);
      const heap = new MinHeap(NN);
      const ci = Math.floor(door.x);
      const cj = Math.floor(door.y);
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const i = ci + di;
          const j = cj + dj;
          if (i < 0 || j < 0 || i >= N || j >= N) continue;
          const c = j * N + i;
          if (wall[c]) continue;
          const d = Math.hypot(i + 0.5 - door.x, j + 0.5 - door.y);
          if (d < D[c]) {
            D[c] = d;
            heap.push(d, c);
          }
        }
      }
      while (heap.n) {
        const k = heap.topKey();
        const c = heap.pop();
        if (k > D[c]) continue;
        const i = c % N;
        const j = (c - i) / N;
        for (let m = 0; m < MOVES.length; m++) {
          const mv = MOVES[m];
          const ni = i + mv[0];
          const nj = j + mv[1];
          if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
          const nc = nj * N + ni;
          if (wall[nc]) continue;
          // Don't squeeze between diagonal wall cells.
          if (mv[3] !== undefined) {
            const ai = i + mv[3];
            const aj = j + mv[4];
            const bi = i + mv[5];
            const bj = j + mv[6];
            if (wall[aj * N + ai] || wall[bj * N + bi]) continue;
          }
          const nd = k + mv[2];
          if (nd < D[nc]) {
            D[nc] = nd;
            P[nc] = c;
            heap.push(nd, nc);
          }
        }
      }
      door.parent = P;
      return D;
    }

    // -------------------------------------------------------------- metrics

    // Length (in cells) of the worn-trail network. The wear map is blurred lightly so
    // parallel lanes of one path count once, thresholded, and then measured with a
    // Cauchy-Crofton estimate: count how often the trail mask is crossed by lines in
    // four directions (rows, columns, both diagonals). Accurate to about +-5% for
    // straight paths at any angle.
    trailLength() {
      const N = this.N;
      const M = this.M;
      blurGrid(this.G, M, this.tmp, N, NEAR_SIGMA);
      let rows = 0;
      let cols = 0;
      let diag = 0;
      for (let j = 0; j < N; j++) {
        let pr = false;
        let pc = false;
        for (let i = 0; i < N; i++) {
          const r = M[j * N + i] > TRAIL;
          if (r && !pr) rows++;
          pr = r;
          const c = M[i * N + j] > TRAIL;
          if (c && !pc) cols++;
          pc = c;
        }
      }
      // diagonals (i - j = k) and anti-diagonals (i + j = k)
      for (let k = -(N - 1); k <= N - 1; k++) {
        let p1 = false;
        let p2 = false;
        for (let j = Math.max(0, -k); j < N && j + k < N; j++) {
          const a = M[j * N + j + k] > TRAIL;
          if (a && !p1) diag++;
          p1 = a;
        }
        const kk = k + N - 1; // i + j = kk, 0..2N-2
        for (let j = Math.max(0, kk - (N - 1)); j <= Math.min(N - 1, kk); j++) {
          const a = M[j * N + (kk - j)] > TRAIL;
          if (a && !p2) diag++;
          p2 = a;
        }
      }
      return (Math.PI / 8) * (rows + cols + diag / Math.SQRT2);
    }

    // Total length of the straight lines joining every pair of doors (in cells):
    // the path network you'd get if everyone beelined.
    straightWeb() {
      const d = this.doors;
      let L = 0;
      for (let i = 0; i < d.length; i++) for (let j = i + 1; j < d.length; j++) L += Math.hypot(d[i].x - d[j].x, d[i].y - d[j].y);
      return L;
    }

    metrics() {
      const { G, paved, wall } = this;
      let grass = 0;
      let worn = 0;
      let wear = 0;
      for (let c = 0; c < G.length; c++) {
        if (wall[c] || paved[c]) continue;
        grass++;
        wear += G[c];
        if (G[c] > WORN) worn++;
      }
      return {
        steps: this.steps,
        walking: this.nw,
        arrived: this.arrived,
        gaveUp: this.gaveUp,
        detour: this.detour,
        worn: grass ? worn / grass : 0,
        trail: this.trailLength(),
        web: this.straightWeb(),
        meanWear: grass ? wear / grass : 0,
        paveShare: this.allSteps > 1e-9 ? this.paveSteps / this.allSteps : 0,
        hasPavement: this.paved.indexOf(1) !== -1,
      };
    }
  }

  // [dx, dy, length, (ax, ay, bx, by): cells that must be open for the move]
  const MOVES = (() => {
    const out = [];
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ])
      out.push([dx, dy, 1]);
    for (const sx of [-1, 1])
      for (const sy of [-1, 1]) {
        out.push([sx, sy, Math.SQRT2, sx, 0, 0, sy]);
        out.push([2 * sx, sy, Math.sqrt(5), sx, 0, sx, sy]);
        out.push([sx, 2 * sy, Math.sqrt(5), 0, sy, sx, sy]);
      }
    return out;
  })();

  class MinHeap {
    constructor(cap) {
      this.k = new Float64Array(cap);
      this.v = new Int32Array(cap);
      this.n = 0;
    }
    push(key, val) {
      if (this.n === this.k.length) {
        const k2 = new Float64Array(this.n * 2);
        const v2 = new Int32Array(this.n * 2);
        k2.set(this.k);
        v2.set(this.v);
        this.k = k2;
        this.v = v2;
      }
      const k = this.k;
      const v = this.v;
      let i = this.n++;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (k[p] <= key) break;
        k[i] = k[p];
        v[i] = v[p];
        i = p;
      }
      k[i] = key;
      v[i] = val;
    }
    topKey() {
      return this.k[0];
    }
    pop() {
      const k = this.k;
      const v = this.v;
      const top = v[0];
      const n = --this.n;
      if (n > 0) {
        const key = k[n];
        const val = v[n];
        let i = 0;
        for (;;) {
          let c = 2 * i + 1;
          if (c >= n) break;
          if (c + 1 < n && k[c + 1] < k[c]) c++;
          if (k[c] >= key) break;
          k[i] = k[c];
          v[i] = v[c];
          i = c;
        }
        k[i] = key;
        v[i] = val;
      }
      return top;
    }
  }

  // Approximate Gaussian blur on an n*n grid: three box passes per axis.
  function blurGrid(src, dst, tmp, n, sigma) {
    const w = Math.sqrt((12 * sigma * sigma) / 3 + 1);
    const r = Math.max(1, Math.round((w - 1) / 2));
    boxH(src, tmp, n, r);
    boxH(tmp, dst, n, r);
    boxH(dst, tmp, n, r);
    boxV(tmp, dst, n, r);
    boxV(dst, tmp, n, r);
    boxV(tmp, dst, n, r);
  }

  // Box blurs with zero padding: beyond the lawn's edge there are no trails, so the
  // edge never looks like a path (a normalised blur would pull walkers outward).
  function boxH(src, dst, N, r) {
    const inv = 1 / (2 * r + 1);
    for (let j = 0; j < N; j++) {
      const row = j * N;
      let sum = 0;
      for (let k = 0; k <= r && k < N; k++) sum += src[row + k];
      for (let x = 0; x < N; x++) {
        dst[row + x] = sum * inv;
        const add = x + r + 1;
        const rem = x - r;
        if (add < N) sum += src[row + add];
        if (rem >= 0) sum -= src[row + rem];
      }
    }
  }

  // Vertical pass, row by row with a running column-sum vector (cache friendly).
  const colSums = new Map();
  function boxV(src, dst, N, r) {
    const inv = 1 / (2 * r + 1);
    let sum = colSums.get(N);
    if (!sum) colSums.set(N, (sum = new Float64Array(N)));
    sum.fill(0);
    for (let k = 0; k <= r && k < N; k++) {
      const row = k * N;
      for (let i = 0; i < N; i++) sum[i] += src[row + i];
    }
    for (let y = 0; y < N; y++) {
      const row = y * N;
      for (let i = 0; i < N; i++) dst[row + i] = sum[i] * inv;
      const add = y + r + 1;
      const rem = y - r;
      if (add < N) {
        const ar = add * N;
        for (let i = 0; i < N; i++) sum[i] += src[ar + i];
      }
      if (rem >= 0) {
        const rr = rem * N;
        for (let i = 0; i < N; i++) sum[i] -= src[rr + i];
      }
    }
  }

  // ------------------------------------------------------------- scenarios
  // Coordinates are fractions of the lawn's side.

  const SCENARIOS = {
    three: {
      name: 'Three gates',
      blurb: 'Three gates, no paths. Early walkers trample a triangle; then the triangle collapses inward.',
      doors: [
        [0.5, 0.07],
        [0.08, 0.84],
        [0.92, 0.84],
      ],
    },
    four: {
      name: 'Four corners',
      blurb: 'Four corners of a square. Twelve possible trips, far fewer paths.',
      doors: [
        [0.07, 0.07],
        [0.93, 0.07],
        [0.93, 0.93],
        [0.07, 0.93],
      ],
    },
    quad: {
      name: 'Campus quad',
      blurb: 'A planner laid a tidy grid of sidewalks. Students have places to be.',
      doors: [
        [0.06, 0.06],
        [0.94, 0.06],
        [0.94, 0.94],
        [0.06, 0.94],
        [0.5, 0.06],
        [0.94, 0.62],
      ],
      build(sim, S) {
        const r = 1.4;
        const a = 0.06 * S;
        const b = 0.94 * S;
        const m = 0.5 * S;
        sim.paintLine(a, a, b, a, r, 'pave');
        sim.paintLine(b, a, b, b, r, 'pave');
        sim.paintLine(b, b, a, b, r, 'pave');
        sim.paintLine(a, b, a, a, r, 'pave');
        sim.paintLine(m, a, m, b, r, 'pave');
        sim.paintLine(a, m, b, m, r, 'pave');
      },
    },
    pond: {
      name: 'Pond',
      blurb: 'Five gates around a pond. Routes bend around the water and braid together.',
      doors: [
        [0.5, 0.05],
        [0.95, 0.4],
        [0.78, 0.94],
        [0.2, 0.94],
        [0.05, 0.4],
      ],
      build(sim, S) {
        const cx = 0.5 * S;
        const cy = 0.52 * S;
        for (let a = 0; a < Math.PI * 2; a += 0.05) {
          // a slightly lumpy pond
          const rr = S * (0.15 + 0.025 * Math.sin(3 * a + 1) + 0.015 * Math.sin(5 * a));
          sim.paintLine(cx, cy, cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.85, 1.5, 'water');
        }
      },
    },
    corner: {
      name: 'The shortcut',
      blurb: 'An L-shaped sidewalk joins two doors the long way round. You know what happens next.',
      doors: [
        [0.08, 0.2],
        [0.8, 0.92],
        [0.92, 0.08],
      ],
      build(sim, S) {
        const r = 1.4;
        sim.paintLine(0.08 * S, 0.2 * S, 0.8 * S, 0.2 * S, r, 'pave');
        sim.paintLine(0.8 * S, 0.2 * S, 0.8 * S, 0.92 * S, r, 'pave');
        sim.paintLine(0.8 * S, 0.2 * S, 0.92 * S, 0.08 * S, r, 'pave');
      },
    },
    empty: {
      name: 'Empty lawn',
      blurb: 'Just grass. Tap to add doors (up to ten) and see what network they agree on.',
      doors: [],
    },
  };

  function loadScenario(sim, key) {
    const sc = SCENARIOS[key];
    if (!sc) throw new Error(`unknown scenario ${key}`);
    sim.clearAll();
    const S = sim.N;
    for (const [x, y] of sc.doors) sim.addDoor(x * S, y * S);
    if (sc.build) sc.build(sim, S);
    sim.updateField(0);
    return sc;
  }

  root.DesireSim = { HEDGE, WATER, MAX_DOORS, DEFAULTS, mulberry32, TrailSim, SCENARIOS, loadScenario };
})(typeof globalThis !== 'undefined' ? globalThis : this);
