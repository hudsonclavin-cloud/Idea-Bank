// Tests for After You. Run from the repo root: node --test ideas/67-after-you/mirror.test.mjs
//
// Four groups: the trace measurement (driven with synthetic leaders and followers whose true
// lag is known, including followers who sit off to one side), the scoring and dealing
// (enumerated exhaustively where the space is finite), the incentives (why a standoff is a game
// of chicken under the glass rule, and was not under the old shared point), and the state
// machine (every reachable state found by breadth-first search, checked for dead ends and for
// hidden information leaking into what the screen may show).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Y = require('./mirror.js');
const { C } = Y;
const HERE = path.dirname(fileURLToPath(import.meta.url));

// ------------------------------------------------------------------ synthetic motion

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(r) {
  return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
}

// A smooth wandering path around the middle of a 390 x 420 half, slowed to `speed` px/s on average.
function wander(r, n, speed = 80) {
  const comps = [];
  for (let ax = 0; ax < 2; ax++) for (let i = 0; i < 3; i++) comps.push({ ax, P: 2 + 5 * r(), ph: 2 * Math.PI * r(), amp: 30 + 40 * r() });
  const raw = { xs: [], ys: [] };
  for (let i = 0; i < 4 * n; i++) {
    const t = (i * C.DT) / 1000;
    let x = 195;
    let y = 210;
    for (const c of comps) {
      const v = c.amp * Math.sin((2 * Math.PI * t) / c.P + c.ph);
      if (c.ax === 0) x += v;
      else y += v;
    }
    raw.xs.push(x);
    raw.ys.push(y);
  }
  let L = 0;
  for (let i = 1; i < n; i++) L += Math.hypot(raw.xs[i] - raw.xs[i - 1], raw.ys[i] - raw.ys[i - 1]);
  const k = speed / (L / ((n * C.DT) / 1000));
  assert.ok(k * n < 4 * n, 'the source path is long enough not to run out');
  return resample(raw, n, (i) => i * k);
}
function resample(p, n, at) {
  const xs = [];
  const ys = [];
  const m = p.xs.length;
  for (let i = 0; i < n; i++) {
    const j = Math.min(m - 1, Math.max(0, at(i)));
    const j0 = Math.floor(j);
    const f = j - j0;
    const j1 = Math.min(m - 1, j0 + 1);
    xs.push(p.xs[j0] * (1 - f) + p.xs[j1] * f);
    ys.push(p.ys[j0] * (1 - f) + p.ys[j1] * f);
  }
  return { xs, ys };
}
// An exact copy, `ms` late, with independent hand tremor of `noise` px.
function delayed(p, ms, r, noise = 1) {
  const q = resample(p, p.xs.length, (i) => i - ms / C.DT);
  for (let i = 0; i < q.xs.length; i++) {
    q.xs[i] += noise * gauss(r);
    q.ys[i] += noise * gauss(r);
  }
  return q;
}
// A follower who sees the leader `seeMs` late and steers toward that with a critically damped
// spring of time constant tauMs, plus slowly wandering motor noise. Effective lag ~ seeMs + 2 tau.
function steering(p, seeMs, tauMs, r, noise = 1.5) {
  const xs = [];
  const ys = [];
  const d = Math.round(seeMs / C.DT);
  const w = 1000 / tauMs;
  const dt = C.DT / 1000;
  let x = p.xs[0];
  let y = p.ys[0];
  let vx = 0;
  let vy = 0;
  let nx = 0;
  let ny = 0;
  for (let i = 0; i < p.xs.length; i++) {
    const j = Math.max(0, i - d);
    vx += (w * w * (p.xs[j] - x) - 2 * w * vx) * dt;
    vy += (w * w * (p.ys[j] - y) - 2 * w * vy) * dt;
    x += vx * dt;
    y += vy * dt;
    nx = 0.95 * nx + noise * gauss(r);
    ny = 0.95 * ny + noise * gauss(r);
    xs.push(x + nx);
    ys.push(y + ny);
  }
  return { xs, ys };
}
function still(r, n, x = 195, y = 210, jitter = 1) {
  const xs = [];
  const ys = [];
  for (let i = 0; i < n; i++) {
    xs.push(x + jitter * gauss(r));
    ys.push(y + jitter * gauss(r));
  }
  return { xs, ys };
}
// A steady circle of radius R px and period P s; dir is the sense of rotation (+1 or -1).
function circlePath(n, R, P, dir = 1, ph = 0, cx = 195, cy = 210) {
  const xs = [];
  const ys = [];
  for (let i = 0; i < n; i++) {
    const th = dir * ((2 * Math.PI * i * C.DT) / 1000 / P) + ph;
    xs.push(cx + R * Math.cos(th));
    ys.push(cy + R * Math.sin(th));
  }
  return { xs, ys };
}
// Straight legs at a constant `speed` px/s, a new random heading every 0.8 to 2.5 s, bouncing off
// the edges of a 390 x 420 half: locally straight motion, the worst case for telling an offset from a lag.
function zigzag(r, n, speed) {
  const xs = [];
  const ys = [];
  let x = 195;
  let y = 210;
  let th = 0;
  let left = 0;
  const step = (speed * C.DT) / 1000;
  for (let i = 0; i < n; i++) {
    if (left-- <= 0) {
      th = 2 * Math.PI * r();
      left = 40 + Math.floor(85 * r());
    }
    x += step * Math.cos(th);
    y += step * Math.sin(th);
    if (x < 40 || x > 350) (th = Math.PI - th), (x = Math.min(350, Math.max(40, x)));
    if (y < 40 || y > 380) (th = -th), (y = Math.min(380, Math.max(40, y)));
    xs.push(x);
    ys.push(y);
  }
  return { xs, ys };
}
// A random walk whose velocity wanders with a 1 s memory (Ornstein-Uhlenbeck), about `speed` px/s:
// meandering motion with no regular pattern.
function ouWalk(r, n, speed) {
  const xs = [];
  const ys = [];
  let x = 195;
  let y = 210;
  let vx = 0;
  let vy = 0;
  const dt = C.DT / 1000;
  for (let i = 0; i < n; i++) {
    vx += -vx * dt + speed * Math.sqrt(dt) * gauss(r);
    vy += -vy * dt + speed * Math.sqrt(dt) * gauss(r);
    x += vx * dt;
    y += vy * dt;
    if (x < 40 || x > 350) (vx = -vx), (x = Math.min(350, Math.max(40, x)));
    if (y < 40 || y > 380) (vy = -vy), (y = Math.min(380, Math.max(40, y)));
    xs.push(x);
    ys.push(y);
  }
  return { xs, ys };
}
const shifted = (p, dx, dy) => ({ xs: p.xs.map((v) => v + dx), ys: p.ys.map((v) => v + dy) });
// Both hands rest on their marks until `atS` seconds, then `p` plays from its start.
const startingAt = (p, atS) => resample(p, p.xs.length, (i) => i - (atS * 1000) / C.DT);
// Long straight legs at a constant `speed` px/s, each to a new random point in a 390 x 420 half.
function legsTo(r, n, speed) {
  const xs = [];
  const ys = [];
  let x = 60 + 270 * r();
  let y = 60 + 300 * r();
  let tx = x;
  let ty = y;
  const step = (speed * C.DT) / 1000;
  for (let i = 0; i < n; i++) {
    let d = Math.hypot(tx - x, ty - y);
    while (d < step) {
      tx = 40 + 310 * r();
      ty = 40 + 340 * r();
      d = Math.hypot(tx - x, ty - y);
    }
    x += (step * (tx - x)) / d;
    y += (step * (ty - y)) / d;
    xs.push(x);
    ys.push(y);
  }
  return { xs, ys };
}
// A leader who gives way: goes their own way (`own`) until `atS` seconds, then blends over 1 s
// into `follow`, a path that copies the partner.
function givesWay(own, follow, atS) {
  const xs = [];
  const ys = [];
  for (let i = 0; i < own.xs.length; i++) {
    const w = Math.min(1, Math.max(0, (i * C.DT) / 1000 - atS));
    xs.push(own.xs[i] * (1 - w) + follow.xs[i] * w);
    ys.push(own.ys[i] * (1 - w) + follow.ys[i] * w);
  }
  return { xs, ys };
}

function trace(a, b, scale = 390) {
  const tr = Y.emptyTrace(scale);
  for (let i = 0; i < a.xs.length; i++) Y.pushSample(tr, { x: a.xs[i], y: a.ys[i] }, { x: b.xs[i], y: b.ys[i] });
  return tr;
}
const N = C.PLAY_MS / C.DT;
const SWAP = { A: 'B', B: 'A', together: 'together', apart: 'apart', unclear: 'unclear', still: 'still' };

// ------------------------------------------------------------------ measurement

test('a delayed copy is measured as following, with the lag recovered, from 60 ms to 750 ms', () => {
  for (const d of [60, 100, 150, 200, 300, 450, 600, 750]) {
    for (let seed = 0; seed < 5; seed++) {
      const r = rng(1000 * d + seed);
      const a = wander(r, N, 60 + 60 * r());
      const b = delayed(a, d, r);
      const an = Y.analyse(trace(a, b));
      assert.equal(an.leader, 'A', `delay ${d} seed ${seed}`);
      assert.ok(an.time.A >= 0.9 * an.ms, `delay ${d}: A ahead only ${an.time.A} ms`);
      assert.ok(Math.abs(an.typicalLag.A - d) <= 15, `delay ${d}: measured ${an.typicalLag.A}`);
      const bn = Y.analyse(trace(b, a));
      assert.equal(bn.leader, 'B');
      assert.ok(Math.abs(bn.typicalLag.B - d) <= 15);
    }
  }
});

test('a copy within 40 ms either way is "together": nobody leads', () => {
  for (const d of [0, 10, 20, 30]) {
    const r = rng(77 + d);
    const a = wander(r, N, 80);
    const b = delayed(a, d, r);
    const an = Y.analyse(trace(a, b));
    assert.equal(an.leader, null);
    assert.ok(an.time.together >= 0.9 * an.ms, `delay ${d}: together ${an.time.together}`);
    assert.equal(an.longestTogetherMs >= 0.9 * an.ms, true);
  }
});

test('a lag beyond the 0.8 s search range is not credited to anyone', () => {
  for (let seed = 0; seed < 10; seed++) {
    const r = rng(5150 + seed);
    const a = wander(r, N, 80);
    const an = Y.analyse(trace(a, delayed(a, 1100, r)));
    assert.equal(an.leader, null, `seed ${seed}: ${JSON.stringify(an.time)}`);
  }
});

test('steering followers (good and sloppy) are measured as followers in every one of 200 rounds', () => {
  for (let seed = 0; seed < 100; seed++) {
    const r = rng(9000 + seed);
    const a = wander(r, N, 40 + 80 * r());
    const good = steering(a, 100 + 150 * r(), 40 + 60 * r(), r, 1.5);
    assert.equal(Y.analyse(trace(a, good)).leader, 'A', `good ${seed}`);
    const sloppy = steering(a, 150 + 200 * r(), 80 + 70 * r(), r, 3);
    assert.equal(Y.analyse(trace(sloppy, a)).leader, 'B', `sloppy ${seed}`);
  }
});

test('two people ignoring each other in the same space rarely produce a leader (under 5% of 400 rounds)', () => {
  let leaders = 0;
  let coupled = 0;
  const rounds = 400;
  for (let seed = 0; seed < rounds; seed++) {
    const r = rng(50000 + seed);
    const sp = 40 + 80 * r();
    const an = Y.analyse(trace(wander(r, N, sp), wander(r, N, sp)));
    if (an.leader) leaders++;
    coupled += an.time.A + an.time.B + an.time.together;
  }
  assert.ok(leaders / rounds < 0.05, `false leaders ${leaders}/${rounds}`);
  if (process.env.AFTER_YOU_VERBOSE) console.log(`independent motion: ${leaders}/${rounds} rounds with a leader, mean coupled ${coupled / rounds} ms`);
  assert.ok(coupled / rounds < 2000, `mean coupled time ${coupled / rounds} ms`);
});

test('two people each drawing their own circle find a leader far more often: a phase difference looks like a lag', () => {
  // Not a worst case the measurement can fix: two steady circles at the same tempo, a fraction of
  // a turn apart, are exactly a time-shifted copy of each other for as long as the tempos agree.
  let any = 0;
  let same = 0;
  const rounds = 150;
  for (let seed = 0; seed < rounds; seed++) {
    const r = rng(61000 + seed);
    const c = () => circlePath(N, 40 + 100 * r(), 2.5 + 4 * r(), r() < 0.5 ? 1 : -1, 2 * Math.PI * r(), 175 + 40 * r(), 190 + 40 * r());
    if (Y.analyse(trace(c(), c())).leader) any++;
    const dir = r() < 0.5 ? 1 : -1;
    const d = () => circlePath(N, 40 + 100 * r(), 3 + 2 * r(), dir, 2 * Math.PI * r(), 175 + 40 * r(), 190 + 40 * r());
    if (Y.analyse(trace(d(), d())).leader) same++;
  }
  if (process.env.AFTER_YOU_VERBOSE) console.log(`independent circles: ${any}/${rounds} with a leader; same sense, 3-5 s periods: ${same}/${rounds}`);
  assert.ok(any / rounds > 0.04 && any / rounds < 0.15, `any circles: ${any}/${rounds}`);
  assert.ok(same / rounds > 0.12 && same / rounds < 0.35, `same-sense circles: ${same}/${rounds}`);
});

test('the trace measures timing, not intent: running ahead of a predictable partner counts as leading', () => {
  // Orange draws a steady circle; Blue, meaning to follow, has learnt it and arrives 150 ms early.
  const r = rng(6);
  const a = { xs: [], ys: [] };
  for (let i = 0; i < N; i++) {
    const t = (i * C.DT) / 1000;
    a.xs.push(195 + 80 * Math.cos((2 * Math.PI * t) / 4));
    a.ys.push(160 + 80 * Math.sin((2 * Math.PI * t) / 4));
  }
  const an = Y.analyse(trace(a, delayed(a, -150, r)));
  assert.equal(an.leader, 'B');
  assert.ok(an.time.B >= 25000, `B ahead ${an.time.B} ms`);
  assert.ok(Math.abs(an.typicalLag.B - 150) <= 15);
});

test('hands resting still are "still"; one hand moving alone is "apart"; neither gives a leader', () => {
  const r = rng(3);
  const s1 = still(r, N);
  const s2 = still(r, N);
  const an = Y.analyse(trace(s1, s2));
  assert.equal(an.time.still, an.ms);
  assert.equal(an.leader, null);
  assert.equal(an.heldFraction, 0);
  const m = wander(r, N, 80);
  for (const tr of [trace(m, s2), trace(s1, m)]) {
    const bn = Y.analyse(tr);
    assert.equal(bn.leader, null);
    assert.equal(bn.time.A + bn.time.B + bn.time.together, 0);
    assert.equal(bn.heldFraction, 0);
  }
});

test('taking turns shows up as turns: A, then B, then A', () => {
  const r = rng(77);
  const L = wander(r, N, 80);
  const late = delayed(L, 300, r);
  const a = { xs: [], ys: [] };
  const b = { xs: [], ys: [] };
  for (let i = 0; i < N; i++) {
    const bTurn = i >= 500 && i < 1000;
    a.xs.push(bTurn ? late.xs[i] : L.xs[i]);
    a.ys.push(bTurn ? late.ys[i] : L.ys[i]);
    b.xs.push(bTurn ? L.xs[i] : late.xs[i]);
    b.ys.push(bTurn ? L.ys[i] : late.ys[i]);
  }
  const an = Y.analyse(trace(a, b));
  const cls = an.segments.map((s) => s.cls);
  // Each segment is judged on 3 s of motion, so a change of leader is blurred by up to 1.5 s.
  for (let j = 0; j < 60; j++) {
    const t = j * 0.5 + 0.25;
    if (t < 8.5 || t > 21.5) assert.equal(cls[j], 'A', `segment ${j}`);
    else if (t > 11.5 && t < 18.5) assert.equal(cls[j], 'B', `segment ${j}`);
  }
  assert.equal(an.leader, 'A');
});

test('a moment of leading is credited for about as long as it lasted, not for the 3 s it was judged on', () => {
  // B copies A exactly, except for one smooth bump in which B falls up to 300 ms behind and catches up.
  const above = Math.acos((2 * 0.04) / 0.3 - 1) / Math.PI; // fraction of the bump with lag over 40 ms
  for (const L of [1, 2, 4, 8]) {
    for (let seed = 0; seed < 8; seed++) {
      const r = rng(600 + seed);
      const a = wander(r, N, 70);
      const b = resample(a, N, (i) => {
        const u = (i * C.DT / 1000 - 15) / L;
        return i - (Math.abs(u) < 0.5 ? (0.3 * 0.5 * (1 + Math.cos(2 * Math.PI * u))) / (C.DT / 1000) : 0);
      });
      const an = Y.analyse(trace(a, b));
      const truth = L * above;
      assert.ok(Math.abs(an.time.A / 1000 - truth) <= 1, `bump ${L} s, seed ${seed}: credited ${an.time.A / 1000} s for ${truth.toFixed(2)} s`);
      assert.equal(an.time.B, 0);
    }
  }
});

test('swapping the players swaps every judgement exactly (the measurement takes no side)', () => {
  for (let seed = 0; seed < 30; seed++) {
    const r = rng(700 + seed);
    const a = wander(r, N, 40 + 80 * r());
    const b = seed % 3 === 0 ? wander(r, N, 80) : seed % 3 === 1 ? steering(a, 150, 60, r) : delayed(a, 20 * seed, r, 2);
    const x = Y.analyse(trace(a, b));
    const y = Y.analyse(trace(b, a));
    assert.deepEqual(
      y.segments.map((s) => s.cls),
      x.segments.map((s) => SWAP[s.cls]),
    );
    x.segments.forEach((s, i) => {
      if (s.lagMs !== null) assert.equal(y.segments[i].lagMs, -s.lagMs);
      assert.equal(y.segments[i].held, s.held);
    });
    assert.equal(y.time.A, x.time.B);
    assert.equal(y.time.B, x.time.A);
    assert.equal(y.leader, x.leader === null ? null : SWAP[x.leader]);
    assert.equal(y.heldFraction, x.heldFraction);
    assert.equal(y.firstMove.who, x.firstMove.who === 'both' || x.firstMove.who === null ? x.firstMove.who : SWAP[x.firstMove.who]);
  }
});

test('moving both dots together, or zooming the whole picture, does not change any judgement', () => {
  for (let seed = 0; seed < 10; seed++) {
    const r = rng(40 + seed);
    const a = wander(r, N, 80);
    const b = seed % 2 ? steering(a, 150, 60, r) : wander(r, N, 80);
    const base = Y.analyse(trace(a, b));
    const zoom = (p, k, dx) => ({ xs: p.xs.map((v) => v * k + dx), ys: p.ys.map((v) => v * k - dx) });
    const z = Y.analyse(trace(zoom(a, 2, 0), zoom(b, 2, 0), 780)); // a power of two: exact in floating point
    assert.deepEqual(
      z.segments.map((s) => s.cls),
      base.segments.map((s) => s.cls),
    );
    assert.equal(z.leader, base.leader);
    assert.equal(z.heldFraction, base.heldFraction);
    const t = Y.analyse(trace(zoom(a, 1, 37.25), zoom(b, 1, 37.25)));
    assert.deepEqual(
      t.segments.map((s) => s.cls),
      base.segments.map((s) => s.cls),
    );
    assert.equal(t.leader, base.leader);
  }
});

test('a steady offset is not mistaken for leading: a follower who sits to one side of the ring is still behind, moment by moment', () => {
  // Over straight motion, a dot that sits d px along the path from the ring looks exactly like a
  // dot d / v seconds early. Before the steady offset was taken off, a zigzag copied 150 ms late
  // with the copy 25 px to the side showed the copier "ahead" for several seconds of the strip.
  const families = {
    zigzag: (r) => zigzag(r, N, 70),
    walk: (r) => ouWalk(r, N, 60),
    wander: (r) => wander(r, N, 70),
    circle: (r) => circlePath(N, 80, 4, r() < 0.5 ? 1 : -1, 2 * Math.PI * r()),
  };
  for (const [name, make] of Object.entries(families)) {
    for (const off of [15, 25, 35]) {
      for (let seed = 0; seed < 4; seed++) {
        const r = rng(8800 + 100 * off + seed + name.length * 7);
        const a = make(r);
        const th = 2 * Math.PI * r();
        const b = shifted(delayed(a, 150, r), off * Math.cos(th), off * Math.sin(th));
        const an = Y.analyse(trace(a, b));
        assert.equal(an.leader, 'A', `${name} ${off} px seed ${seed}`);
        assert.equal(an.time.B, 0, `${name} ${off} px seed ${seed}: the copier is shown ahead for ${an.time.B} ms`);
        assert.ok(Math.hypot(an.offset.x + off * Math.cos(th), an.offset.y + off * Math.sin(th)) < 3, `${name}: offset found ${JSON.stringify(an.offset)}`);
      }
    }
  }
});

test('the steady offset is found from the moving part of the round, so a long standoff does not hide it', () => {
  for (const atS of [0, 8, 17]) {
    for (let seed = 0; seed < 4; seed++) {
      const r = rng(9100 + 10 * atS + seed);
      const a = startingAt(zigzag(r, N, 70), atS);
      const b = shifted(delayed(a, 200, r), 0, 25);
      const an = Y.analyse(trace(a, b));
      assert.equal(an.time.B, 0, `standoff ${atS} s seed ${seed}: copier ahead ${an.time.B} ms`);
      assert.equal(an.leader, 'A');
    }
  }
});

test('a tug resolved late: 13 to 17 s of two leaders going their own ways do not skew the offset, and the one who gave way is never named leader', () => {
  // The first version of the steady offset was a median over every moving sample of the round. When
  // two leaders went their own ways for 13 to 17 s before one gave way, most of those samples were
  // unrelated motion, the offset came out tens of px wrong, and taking it off made a correct copy
  // look early: in this test it was out by 10 px or more in 66 of the 154 glass-whole rounds (77 px
  // at worst), the one who gave way was shown ahead for 0.8 s on average, two rounds had no leader,
  // and in the case pinned below the one who gave way was named leader. Now the offset comes only
  // from the stretches where somebody is copying somebody.
  const families = {
    legs: (r) => legsTo(r, N, 60 + 20 * r()),
    zigzag: (r) => zigzag(r, N, 70),
    wander: (r) => wander(r, N, 70),
  };
  // Each follower: the path it copies with, and the steady offset it sits at (the last sits 20 px off the ring).
  const followers = [
    (a, r) => [delayed(a, 150, r), 0, 0],
    (a, r) => [delayed(a, 250, r), 0, 0],
    (a, r) => [steering(a, 150, 60, r), 0, 0],
    (a, r) => [shifted(delayed(a, 200, r), 12, -16), -12, 16],
  ];
  let whole = 0;
  let giverAhead = 0;
  for (const [name, make] of Object.entries(families))
    for (const atS of [13, 15, 17])
      for (const [fi, follow] of followers.entries())
        for (let seed = 0; seed < 6; seed++) {
          const r = rng(12000 + 1000 * name.length + 100 * atS + 10 * fi + seed);
          const a = make(r);
          const own = make(r);
          const [path, ox, oy] = follow(a, r);
          const an = Y.analyse(trace(a, givesWay(own, path, atS)));
          if (an.heldFraction < C.HELD_POINT) continue; // the glass broke: no order point is at stake
          whole++;
          const at = `${name}, gives way at ${atS} s, follower ${fi}, seed ${seed}`;
          assert.equal(an.leader, 'A', `${at}: leader ${an.leader}`);
          assert.ok(Math.hypot(an.offset.x - ox, an.offset.y - oy) < 10, `${at}: offset ${JSON.stringify(an.offset)}, true (${ox}, ${oy})`);
          giverAhead += an.time.B;
        }
  assert.ok(whole >= 150, `glass-whole rounds ${whole}`);
  assert.ok(giverAhead / whole < 400, `the one who gave way is shown ahead for ${giverAhead / whole} ms on average`);
  if (process.env.AFTER_YOU_VERBOSE) console.log(`late tugs: ${whole} glass-whole rounds, giver ahead ${(giverAhead / whole / 1000).toFixed(2)} s on average`);
  // One concrete case: straight legs, Blue gives way at 17 s and copies 150 ms late, exactly.
  const r = rng(12000 + 4000 + 1700 + 11);
  const a = legsTo(r, N, 60 + 20 * r());
  const an = Y.analyse(trace(a, givesWay(legsTo(r, N, 60 + 20 * r()), delayed(a, 150, r), 17)));
  assert.ok(an.heldFraction >= C.HELD_POINT);
  assert.equal(an.leader, 'A', `leader ${an.leader}: A ahead ${an.time.A} ms, B ahead ${an.time.B} ms`);
  assert.deepEqual(Y.score(['lead', 'lead'], ['lead', 'lead'], an).kept, [true, false], 'Orange kept LEAD; Blue gave way');
});

test('for a follower on or near the ring, adding a constant offset changes no verdict and no leader; past the closeness limit it is apart', () => {
  // Not bit for bit: the offset is estimated from the stretches judged coupled on the real positions,
  // and one near the closeness limit can drop out, moving the estimate by a fraction of a pixel and a
  // lag by a few ms. For a follower on the ring or 10 px off it, no half-second's verdict and no leader
  // changes. That is all it can promise: closeness (step 1) is judged on the real positions, offset
  // and all, so an offset that carries the dots past COUPLE_TOL turns those stretches to apart. The
  // second revision of the README said "a constant offset of up to 20 px changes no verdict" without
  // that limit; the last part of this test is a case where it changes every verdict.
  const lagMoves = [];
  let rounds = 0;
  for (let seed = 0; seed < 16; seed++) {
    const r = rng(9300 + seed);
    const a = seed < 8 ? wander(r, N, 50 + 50 * r()) : zigzag(r, N, 70);
    const b0 = seed % 2 ? steering(a, 150, 60, r) : delayed(a, 100 + 40 * (seed % 8), r, 2);
    for (const sits of [0, 10]) {
      // A follower who already sits `sits` px off the ring in direction (ux, uy), pushed 20 px further.
      const th = 2 * Math.PI * r();
      const ux = Math.cos(th);
      const uy = Math.sin(th);
      const b = shifted(b0, sits * ux, sits * uy);
      const base = Y.analyse(trace(a, b));
      const pushes = sits === 0 ? [[20, 0], [0, -20], [-12.5, 12.5]] : [[20 * ux, 20 * uy], [-20 * uy, 20 * ux], [-20 * ux, -20 * uy]];
      for (const [dx, dy] of pushes) {
        const moved = Y.analyse(trace(a, shifted(b, dx, dy)));
        rounds++;
        assert.deepEqual(
          moved.segments.map((sg) => sg.cls),
          base.segments.map((sg) => sg.cls),
          `seed ${seed}, ${sits} px off, pushed ${dx.toFixed(1)},${dy.toFixed(1)}`,
        );
        moved.segments.forEach((sg, i) => {
          if (sg.lagMs !== null) lagMoves.push(Math.abs(sg.lagMs - base.segments[i].lagMs));
        });
        assert.equal(moved.leader, base.leader);
        assert.ok(Math.hypot(moved.offset.x + dx - base.offset.x, moved.offset.y + dy - base.offset.y) < 1, `seed ${seed}`);
      }
    }
  }
  lagMoves.sort((p, q) => p - q);
  const at = (f) => lagMoves[Math.floor(f * (lagMoves.length - 1))];
  if (process.env.AFTER_YOU_VERBOSE) console.log(`constant offset: ${rounds} pushes, lags moved by median ${at(0.5).toFixed(3)} ms, 99th percentile ${at(0.99).toFixed(2)} ms, at most ${at(1).toFixed(1)} ms`);
  assert.ok(at(0.5) < 0.5 && at(0.99) < 10 && at(1) < 60, `${at(0.5)} ${at(0.99)} ${at(1)}`);

  // Past the limit (39 px here): an exact copy 150 ms late on straight legs at 70 px/s is credited to
  // its leader for the whole round at 20 px off the ring, and is apart for the whole round at 40 px
  // off, with nobody named leader, while the mirror (HELD_TOL, 47 px) still keeps the glass whole.
  const heldAt40 = [];
  for (let seed = 0; seed < 6; seed++) {
    const r = rng(9400 + seed);
    const a = legsTo(r, N, 70);
    const b = delayed(a, 150, r);
    const th = 2 * Math.PI * r();
    const near = Y.analyse(trace(a, shifted(b, 20 * Math.cos(th), 20 * Math.sin(th))));
    const far = Y.analyse(trace(a, shifted(b, 40 * Math.cos(th), 40 * Math.sin(th))));
    assert.equal(near.leader, 'A', `seed ${seed}`);
    assert.equal(near.time.A, near.ms, `seed ${seed}: at 20 px off, A ahead ${near.time.A} ms`);
    assert.ok(far.segments.every((sg) => sg.cls === 'apart'), `seed ${seed}: at 40 px off, ${JSON.stringify(far.time)}`);
    assert.equal(far.leader, null);
    assert.ok(far.heldFraction >= C.HELD_POINT, `seed ${seed}: at 40 px off the mirror held only ${far.heldFraction}`);
    heldAt40.push(far.heldFraction);
  }
  if (process.env.AFTER_YOU_VERBOSE) console.log(`40 px off: apart throughout, no leader, mirror held ${heldAt40.map((h) => Math.round(100 * h) + '%').join(' ')}`);
});

test('a tug has a back door: the one who gives way can keep the glass whole without being seen copying, and then nobody keeps LEAD', () => {
  // Found in the third review. The mirror's tolerance (HELD_TOL, 12% of the side) is wider than the
  // distance at which the trace stops calling it copying (COUPLE_TOL, 10%), and copying is judged on
  // 3 s at a time while the glass needs only 10 s of the 30 in all. So a leader who gives way can save
  // the glass and still deny the other leader the point: by copying from 42 px off the ring, or by
  // copying on the ring for 1 s at a time with 1 s excursions 100 px off it. The incentive tests
  // below assume a player who gives way is seen copying; this test pins that a player need not be
  // (README, "A second hole"). It is a statement about the rules, not a fix.
  const families = {
    legs: (r) => legsTo(r, N, 60 + 20 * r()),
    zigzag: (r) => zigzag(r, N, 70),
    wander: (r) => wander(r, N, 70),
  };
  // `inS` s on the ring, then `outS` s out at `away` px in direction (ux, uy), with 0.3 s ramps.
  function excursions(p, inS, outS, away, ux, uy) {
    const xs = [];
    const ys = [];
    for (let i = 0; i < p.xs.length; i++) {
      const ph = ((i * C.DT) / 1000) % (inS + outS);
      const o = ph <= inS ? 0 : away * Math.min(1, (ph - inS) / 0.3, (inS + outS - ph) / 0.3);
      xs.push(p.xs[i] + o * ux);
      ys.push(p.ys[i] + o * uy);
    }
    return { xs, ys };
  }
  const ways = {
    'on the ring': (p) => p,
    '42 px off the ring': (p, ux, uy) => shifted(p, 42 * ux, 42 * uy),
    '1 s on, 1 s 100 px off': (p, ux, uy) => excursions(p, 1, 1, 100, ux, uy),
  };
  const whole = {};
  for (const [way, copyHow] of Object.entries(ways)) {
    whole[way] = 0;
    for (const [name, make] of Object.entries(families))
      for (let seed = 0; seed < 8; seed++) {
        const r = rng(13000 + 1000 * name.length + seed);
        const a = make(r);
        const own = make(r);
        const th = 2 * Math.PI * r();
        const copy = seed % 2 ? steering(a, 150, 60, r) : delayed(a, 150, r);
        // Both told to LEAD; Blue goes their own way for 3 s, then gives way.
        const an = Y.analyse(trace(a, givesWay(own, copyHow(copy, Math.cos(th), Math.sin(th)), 3)));
        if (an.heldFraction < C.HELD_POINT) continue;
        whole[way]++;
        const kept = Y.score(['lead', 'lead'], ['lead', 'lead'], an).kept;
        const at = `${way}, ${name}, seed ${seed}`;
        if (way === 'on the ring') {
          assert.equal(an.leader, 'A', at);
          assert.deepEqual(kept, [true, false], at);
        } else {
          assert.equal(an.leader, null, `${at}: ${JSON.stringify(an.time)}`);
          assert.deepEqual(kept, [false, false], `${at}: nobody keeps LEAD`);
        }
      }
  }
  if (process.env.AFTER_YOU_VERBOSE) console.log(`tug back door: glass whole of 24 ${JSON.stringify(whole)}`);
  assert.equal(whole['on the ring'], 24);
  assert.ok(whole['42 px off the ring'] >= 12 && whole['1 s on, 1 s 100 px off'] >= 15, JSON.stringify(whole));
});

test('the mirror holds for a good follower at a walking pace, and not for still or wiggling hands', () => {
  // A follower who sees 120 ms late and steers with a 50 ms spring (about 0.2 s behind in all),
  // behind a leader at 50-90 px/s on a 390 px phone: the mirror holds for most of the round.
  const fr = [];
  for (let seed = 0; seed < 50; seed++) {
    const r = rng(300 + seed);
    const a = wander(r, N, 50 + 40 * r());
    const an = Y.analyse(trace(a, steering(a, 120, 50, r)));
    assert.ok(an.heldFraction >= C.HELD_POINT, `seed ${seed}: held ${an.heldFraction}`);
    fr.push(an.heldFraction);
  }
  fr.sort((p, q) => p - q);
  assert.ok(fr[25] >= 0.6, `median held ${fr[25]}`);
  // Two hands wiggling in place near the centre, independently: close together and moving, but going nowhere.
  for (let seed = 0; seed < 20; seed++) {
    const r = rng(800 + seed);
    const w1 = wander(r, N, 150);
    const w2 = wander(r, N, 150);
    for (const p of [w1, w2]) for (let i = 0; i < N; i++) {
      p.xs[i] = 195 + (p.xs[i] - 195) * 0.3;
      p.ys[i] = 210 + (p.ys[i] - 210) * 0.3;
    }
    assert.ok(Y.analyse(trace(w1, w2)).heldFraction < 0.1, `wiggle ${seed}`);
  }
});

test('one dot circling a still partner never holds the mirror, however close it stays', () => {
  const a = { xs: [], ys: [] };
  const b = { xs: [], ys: [] };
  for (let i = 0; i < N; i++) {
    const th = (2 * Math.PI * i * C.DT) / 2000;
    a.xs.push(195 + 40 * Math.cos(th));
    a.ys.push(210 + 40 * Math.sin(th));
    b.xs.push(195);
    b.ys.push(210);
  }
  assert.equal(Y.analyse(trace(a, b)).heldFraction, 0);
});

test('the travel rule sets a speed floor: a perfect copy slower than about 40 px/s, or a small or fast circle, never keeps the glass whole', () => {
  // The mirror only counts while each dot has got 15% of the side (58.5 px on a 390 px phone) from
  // where it was 1.5 s ago: about 39 px/s in a straight line, more on a curve.
  for (let seed = 0; seed < 6; seed++) {
    const r = rng(9500 + seed);
    const slow = zigzag(r, N, 30);
    assert.ok(Y.analyse(trace(slow, delayed(slow, 150, r))).heldFraction < 0.05, `30 px/s seed ${seed}`);
    const brisk = zigzag(r, N, 60);
    assert.ok(Y.analyse(trace(brisk, delayed(brisk, 150, r))).heldFraction >= C.HELD_POINT, `60 px/s seed ${seed}`);
  }
  for (const P of [1.5, 3, 6, 12]) {
    const small = circlePath(N, 25, P);
    assert.equal(Y.analyse(trace(small, delayed(small, 150, rng(1)))).heldFraction, 0, `radius 25 px, period ${P} s`);
  }
  for (const R of [40, 60, 100]) {
    const fast = circlePath(N, R, 1.5);
    assert.ok(Y.analyse(trace(fast, delayed(fast, 150, rng(2)))).heldFraction < 0.05, `radius ${R} px, period 1.5 s`);
  }
  // ... while a circle of a good size at a moderate tempo holds nearly all the time.
  const good = circlePath(N, 60, 5);
  assert.ok(Y.analyse(trace(good, delayed(good, 150, rng(3)))).heldFraction > 0.9);
});

test('a standoff has a deadline: give way by 8 s and the mirror can still hold for 10 s; wait 20 s and it cannot', () => {
  // Both still until T, then Orange moves off and Blue follows well.
  const heldFrom = (T, seed) => {
    const r = rng(3000 + seed);
    const L = wander(r, N, 50 + 40 * r());
    const a = resample(L, N, (i) => i - T * 50);
    return Y.analyse(trace(a, steering(a, 100 + 150 * r(), 40 + 60 * r(), r, 1.5)));
  };
  let early = 0;
  for (let seed = 0; seed < 40; seed++) {
    const an = heldFrom(8, seed);
    if (an.heldFraction >= C.HELD_POINT) early++;
    assert.equal(an.leader, 'A', 'whoever gives way is measured as leading');
  }
  assert.ok(early >= 34, `gave way at 8 s and still held: ${early}/40`);
  for (let seed = 0; seed < 40; seed++) assert.ok(heldFrom(20, seed).heldFraction < C.HELD_POINT, `seed ${seed}`);
});

test('the deadline depends on how you move: a steady circle can be saved from 18 s, a slow meander often not from 8 s', () => {
  let circle18 = 0;
  let walk8 = 0;
  for (let seed = 0; seed < 20; seed++) {
    const r = rng(9700 + seed);
    const c = startingAt(circlePath(N, 80, 5, 1, 2 * Math.PI * r()), 18);
    if (Y.analyse(trace(c, delayed(c, 200, r))).heldFraction >= C.HELD_POINT) circle18++;
    const w = startingAt(ouWalk(r, N, 60), 8);
    if (Y.analyse(trace(w, delayed(w, 200, r))).heldFraction >= C.HELD_POINT) walk8++;
    const late = startingAt(circlePath(N, 80, 5), 20);
    assert.ok(Y.analyse(trace(late, delayed(late, 200, r))).heldFraction < C.HELD_POINT, 'from 20 s nothing can be saved');
  }
  if (process.env.AFTER_YOU_VERBOSE) console.log(`deadline: circle from 18 s saved ${circle18}/20; slow walk from 8 s saved ${walk8}/20`);
  assert.ok(circle18 >= 18, `circle from 18 s: ${circle18}/20`);
  assert.ok(walk8 <= 10, `slow walk from 8 s: ${walk8}/20`);
});

test('no held time before the first move: held time never exceeds the time after both have left their marks', () => {
  for (let seed = 0; seed < 30; seed++) {
    const r = rng(4000 + seed);
    const T = Math.floor(r() * 1200);
    const L = wander(r, N, 60 + 60 * r());
    const a = resample(L, N, (i) => i - T);
    const b = seed % 2 ? delayed(a, 0, r, 0) : steering(a, 150, 60, r, 0);
    const tr = trace(a, b);
    for (let i = 0; i <= T; i++) assert.equal(Y.heldAt(tr, i), false, `seed ${seed} sample ${i}`);
    assert.ok(Y.analyse(tr).heldFraction <= (N - T - 1) / N);
  }
});

test('the held rule only looks backwards, so the live glow is the scored rule', () => {
  const r = rng(11);
  const a = wander(r, N, 80);
  const b = steering(a, 120, 50, r);
  const tr = trace(a, b);
  const before = [];
  for (let i = 0; i < N; i++) before.push(Y.heldAt(tr, i));
  for (const cut of [100, 700, 1400]) {
    const t2 = JSON.parse(JSON.stringify(tr));
    for (let i = cut + 1; i < N; i++) {
      t2.ax[i] = 0;
      t2.bx[i] = 999;
    }
    for (let i = 0; i <= cut; i++) assert.equal(Y.heldAt(t2, i), before[i]);
  }
});

test('first move: whoever leaves their start first, and when', () => {
  const r = rng(12);
  const L = wander(r, N, 80);
  const startA = resample(L, N, (i) => i - 200);
  const startB = resample(L, N, (i) => i - 230);
  const an = Y.analyse(trace(startA, startB));
  assert.equal(an.firstMove.who, 'A');
  assert.ok(an.firstMove.ms > 4000 && an.firstMove.ms < 6000, `${an.firstMove.ms}`);
  assert.equal(Y.analyse(trace(startB, startA)).firstMove.who, 'B');
});

// ------------------------------------------------------------------ scoring and dealing

const COMBOS = [
  ['lead', 'lead'],
  ['lead', 'follow'],
  ['follow', 'lead'],
  ['follow', 'follow'],
];
const fakeAnalysis = (leader, held) => ({ leader, heldFraction: held ? 0.8 : 0.2 });

test('scoring: every combination of orders, guesses, leader and held scores as the rules say', () => {
  for (const orders of COMBOS)
    for (const guesses of COMBOS)
      for (const leader of ['A', 'B', null])
        for (const held of [true, false]) {
          const sc = Y.score(orders, guesses, fakeAnalysis(leader, held));
          const li = leader === 'A' ? 0 : leader === 'B' ? 1 : -1;
          for (const p of [0, 1]) {
            const kept = orders[p] === 'lead' ? li === p : li === 1 - p;
            const read = guesses[p] === orders[1 - p];
            assert.equal(sc.kept[p], kept);
            assert.equal(sc.read[p], read);
            // The mirror is not a point: it is the shared stake. Points are only won off each other.
            assert.equal(sc.points[p], (kept ? 1 : 0) + (read ? 1 : 0));
          }
          assert.equal(sc.held, held);
          assert.equal(sc.broke, !held, 'a round in which the mirror did not hold breaks the glass');
          if (orders[0] === orders[1]) assert.ok(!(sc.kept[0] && sc.kept[1]), 'same orders: both cannot keep them');
          else assert.equal(sc.kept[0] && sc.kept[1], leader !== null && orders[li] === 'lead');
          if (leader === null) assert.deepEqual(sc.kept, [false, false]);
          // Swapping the players swaps the points.
          const sw = Y.score([orders[1], orders[0]], [guesses[1], guesses[0]], fakeAnalysis(leader && SWAP[leader], held));
          assert.deepEqual(sw.points, [sc.points[1], sc.points[0]]);
        }
});

test('the glass: a scored round in which the mirror fails ends the game, and nobody wins whatever the score', () => {
  let s = Y.act(Y.newGame(), { type: 'practice', rand: [5, 6, 7, 8], now: 0 });
  s = Y.act(s, { type: 'begin', now: 10 });
  s = Y.act(s, { type: 'tick', now: 10 + C.COUNTDOWN_MS });
  s = Y.act(s, { type: 'finish', now: s.phaseAt + C.PRACTICE_MS, trace: STILL[C.PRACTICE_MS / C.DT] });
  s = Y.act(Y.act(s, { type: 'guess', player: 0, value: 'nobody' }), { type: 'guess', player: 1, value: 'nobody' });
  assert.equal(s.broken, null, 'practice is not scored: a still practice round breaks nothing');
  // Round 1 holds and Orange scores; round 2 is a stalemate: the glass breaks and the game ends there.
  const play = (st, round, tr, guesses) => {
    st = Y.act(st, { type: 'next', rand: [round & 1, 0, 3, 4], now: st.phaseAt + 10 });
    for (const p of [0, 1]) st = Y.act(Y.act(st, { type: 'peek', player: p, down: true }), { type: 'peek', player: p, down: false });
    st = Y.act(st, { type: 'begin', now: st.phaseAt + 10 });
    st = Y.act(st, { type: 'tick', now: st.phaseAt + C.COUNTDOWN_MS });
    st = Y.act(st, { type: 'finish', now: st.phaseAt + C.PLAY_MS, trace: tr });
    return Y.act(Y.act(st, { type: 'guess', player: 0, value: guesses[0] }), { type: 'guess', player: 1, value: guesses[1] });
  };
  s = play(s, 1, TRACE[1500], ['follow', 'follow']); // Orange LEAD, Blue FOLLOW: Orange reads Blue, Blue misreads
  assert.equal(s.broken, null);
  assert.ok(s.totals[0] > s.totals[1], `Orange ahead after round 1: ${s.totals}`);
  assert.equal(Y.view(s).last, false);
  s = play(s, 2, STILL[1500], ['follow', 'follow']);
  assert.equal(s.history[2].broke, true);
  assert.equal(s.broken, 2);
  assert.equal(Y.view(s).last, true, 'the reveal knows it is the last');
  s = Y.act(s, { type: 'next', rand: [0, 0, 0, 0], now: s.phaseAt + 10 });
  assert.equal(s.phase, 'summary');
  const sum = Y.view(s).summary;
  assert.equal(sum.rounds, 2);
  assert.equal(sum.broken, 2);
  assert.equal(sum.winner, null, 'Orange was ahead, but a broken glass means nobody wins');
  assert.deepEqual(Y.outcome([5, 3], null), { winner: 'A', broken: null });
  assert.deepEqual(Y.outcome([3, 3], null), { winner: 'level', broken: null });
  assert.deepEqual(Y.outcome([2, 6], null), { winner: 'B', broken: null });
});

// ------------------------------------------------------------------ incentives
//
// A same-order round (both FOLLOW, or both LEAD) can turn into a standoff. Each player either waits
// (W) or gives way in time (G): moves off first in a both-follow round, starts copying in a
// both-lead round. What each pair of choices does to the trace:
//   (G, W): the one who gave way is measured following (both LEAD) or leading (both FOLLOW); the
//           mirror holds.
//   (W, W): nobody goes anywhere (both FOLLOW), or two leaders go their own ways (both LEAD): the
//           mirror does not hold. ("Hands resting still" and "one hand moving alone" pin both.)
//   (G, G): both give way at once. Either you fall in together, nobody ahead and the mirror holding,
//           or neither copies the other and it does not hold. Both are checked.
// A both-lead round also has a back door (S): give way, but copy out of the trace's sight, so the
// mirror holds and nobody is named leader ("a tug has a back door" pins that it can be done). Only
// the last incentive test below uses it; the others assume that a player who gives way is seen.
// A player trying to win values a game at P(win) + P(level) / 2, and a broken glass at 0. Each
// guess is a fair coin (the game's own result: no rule that ignores the round does better). Each
// later round is modelled with fair-coin orders and the glass holding: when the orders differ, both
// or neither keep, so only the read points move the margin; when they match, one of you, either
// equally likely, keeps. So a later round moves the margin by -2 to +2, which is exactly what the
// rules allow (pinned below). That is a model of the future, not a fact about it, but the
// conclusions below need only that a broken glass is worth nothing, that an extra point is never
// worth less, and which margins a later round can reach.
const READS = [[true, true], [true, false], [false, true], [false, false]];
const gameMemo = new Map();
function gameValue(margin, roundsLeft) {
  // margin: Orange minus Blue, after this round; Orange's value under the model above.
  if (roundsLeft === 0) return margin > 0 ? 1 : margin === 0 ? 0.5 : 0;
  const key = `${margin} ${roundsLeft}`;
  if (gameMemo.has(key)) return gameMemo.get(key);
  let v = 0;
  for (const [r0, r1] of READS) {
    const m = margin + (r0 ? 1 : 0) - (r1 ? 1 : 0);
    v += gameValue(m, roundsLeft - 1) / 8; // different orders: kept points cancel
    v += gameValue(m + 1, roundsLeft - 1) / 16; // same orders, Orange keeps
    v += gameValue(m - 1, roundsLeft - 1) / 16; // same orders, Blue keeps
  }
  gameMemo.set(key, v);
  return v;
}
function standoff(ord, choice0, choice1, together) {
  // The analysis the trace would give for these choices, from Orange's (player 0's) side.
  if ((choice0 === 'S' && choice1 === 'W') || (choice0 === 'W' && choice1 === 'S')) return { leader: null, heldFraction: 0.8 };
  if (choice0 === 'S' || choice1 === 'S') return standoff(ord, choice0 === 'S' ? 'G' : choice0, choice1 === 'S' ? 'G' : choice1, together);
  const giver = choice0 === 'G' && choice1 === 'W' ? 0 : choice0 === 'W' && choice1 === 'G' ? 1 : -1;
  if (giver >= 0) {
    const leader = ord === 'follow' ? giver : 1 - giver;
    return { leader: leader === 0 ? 'A' : 'B', heldFraction: 0.8 };
  }
  if (choice0 === 'G' && together) return { leader: null, heldFraction: 0.8 };
  return { leader: null, heldFraction: 0 };
}
function valueFor0(ord, c0, c1, together, margin, roundsLeft, scoreFn = Y.score) {
  let v = 0;
  for (const [r0, r1] of READS) {
    const orders = [ord, ord];
    const other = ord === 'lead' ? 'follow' : 'lead';
    const guesses = [r0 ? ord : other, r1 ? ord : other];
    const sc = scoreFn(orders, guesses, standoff(ord, c0, c1, together));
    if (sc.broke) continue; // a broken glass: nobody wins, worth 0
    v += gameValue(margin + sc.points[0] - sc.points[1], roundsLeft) / 4;
  }
  return v;
}

test('incentives, the old rules: a shared mirror point never changes who is ahead, so waiting was weakly dominant', () => {
  // The rules before the review: +1 each when the mirror held, and no shared loss.
  const oldScore = (orders, guesses, an) => {
    const sc = Y.score(orders, guesses, an);
    return { ...sc, broke: false, points: sc.points.map((x) => x + (an.heldFraction >= C.HELD_POINT ? 1 : 0)) };
  };
  for (const ord of ['follow', 'lead'])
    for (let margin = -4; margin <= 4; margin++)
      for (let left = 0; left <= 3; left++)
        for (const c1 of ['W', 'G'])
          for (const together of [true, false]) {
            const w = valueFor0(ord, 'W', c1, together, margin, left, oldScore);
            const g = valueFor0(ord, 'G', c1, together, margin, left, oldScore);
            assert.ok(w >= g - 1e-12, `${ord} m${margin} left${left} vs ${c1}: wait ${w} < give way ${g}`);
          }
});

test('incentives, the glass rule: when giving way is seen, a standoff is a game of chicken for a player trying to win, and neither choice is dominant', () => {
  let strictG = 0;
  let strictW = 0;
  for (const ord of ['follow', 'lead'])
    for (let margin = -6; margin <= 6; margin++)
      for (let left = 0; left <= 3; left++)
        for (const together of [true, false]) {
          const v = (c0, c1) => valueFor0(ord, c0, c1, together, margin, left);
          // A stalemate breaks the glass: worth nothing to either of you.
          assert.equal(v('W', 'W'), 0);
          // Against a partner who waits, giving way is never worse, and strictly better whenever giving
          // way still leaves you any chance to win or draw. Giving way costs you the order point and at
          // best you win the read point back, so the margin is unchanged at best, and each later round
          // can win back at most 2: a chance remains while margin + 2 x rounds left >= 0.
          assert.ok(v('G', 'W') >= 0);
          if (margin + 2 * left >= 0) {
            assert.ok(v('G', 'W') > 0, `${ord} m${margin} left${left}: giving way leaves a chance`);
            strictG++;
          } else assert.equal(v('G', 'W'), 0, 'already lost: nothing to gain by giving way');
          // Against a partner who gives way, waiting is never worse than giving way too.
          assert.ok(v('W', 'G') >= v('G', 'G'), `${ord} m${margin} left${left}`);
          if (v('W', 'G') > v('G', 'G')) strictW++;
        }
  // So each choice is the strict best reply to the other somewhere: neither is dominant. That is chicken.
  assert.ok(strictG > 50 && strictW > 50, `${strictG} ${strictW}`);
  // The hole (README): giving way can no longer win or draw in the last round when behind by one or
  // more, and in round 3 (one round left) when behind by three or more, but still can when behind by two.
  for (const ord of ['follow', 'lead']) {
    assert.equal(valueFor0(ord, 'G', 'W', true, -1, 0), 0);
    assert.equal(valueFor0(ord, 'G', 'W', true, -3, 1), 0);
    assert.ok(valueFor0(ord, 'G', 'W', true, -2, 1) > 0);
    assert.ok(valueFor0(ord, 'G', 'W', true, -4, 2) > 0);
  }
});

test('incentives, the back door: in a both-lead tug, giving way out of sight costs nothing, so holding out gains nothing', () => {
  // Found in the third review: the one who gives way in a tug can save the glass without being named
  // follower (see "a tug has a back door"). Then nobody keeps LEAD. Compared with giving way in plain
  // sight it is never worse and often better, and it scores exactly the same whichever of you does it,
  // so against a partner who knows it, waiting for the other to give way gains nothing. In plain
  // sight it does: the one who holds out gets the point. That difference is what made it chicken.
  let better = 0;
  let plainGain = 0;
  for (let margin = -6; margin <= 6; margin++)
    for (let left = 0; left <= 3; left++)
      for (const together of [true, false]) {
        const v = (c0, c1) => valueFor0('lead', c0, c1, together, margin, left);
        assert.ok(v('S', 'W') >= v('G', 'W'), `m${margin} left${left}`);
        if (v('S', 'W') > v('G', 'W')) better++;
        assert.equal(v('W', 'S'), v('S', 'W'), `m${margin} left${left}: it scores the same whoever uses it`);
        assert.ok(v('S', 'W') > v('W', 'W') || margin + 1 + 2 * left < 0, `m${margin} left${left}: better than breaking the glass`);
        if (v('W', 'G') > v('G', 'W')) plainGain++;
      }
  assert.ok(better > 30, `the back door beats giving way in plain sight in ${better} standings`);
  assert.ok(plainGain > 30, `in plain sight, holding out gains in ${plainGain} standings`);
  // A concrete standing: level, last round. In plain sight, the one who gives way can at best draw
  // (worth 1/8) and the one who held out usually wins (7/8); through the back door, the round is left
  // to the read points alone, as if nobody had led (1/2 each, whoever gave way).
  assert.equal(valueFor0('lead', 'G', 'W', true, 0, 0), 0.125);
  assert.equal(valueFor0('lead', 'W', 'G', true, 0, 0), 0.875);
  assert.equal(valueFor0('lead', 'S', 'W', true, 0, 0), 0.5);
  assert.equal(valueFor0('lead', 'W', 'S', true, 0, 0), 0.5);
});

test('incentives: the hole is in the last round when behind at all, and in round 3 when behind by 3 or 4, and nowhere else', () => {
  // Exact, from the scoring itself, with no model of how anybody plays: every pair of points one round
  // can give (any orders, guesses and leader, the glass whole), the margins reachable before each
  // round, and where giving way in a standoff leaves the one behind no way to win or draw.
  const pairs = new Set();
  for (const orders of [['lead', 'lead'], ['lead', 'follow'], ['follow', 'lead'], ['follow', 'follow']])
    for (const g0 of ['lead', 'follow'])
      for (const g1 of ['lead', 'follow'])
        for (const leader of ['A', 'B', null]) {
          const sc = Y.score(orders, [g0, g1], { leader, heldFraction: 1 });
          pairs.add(sc.points[0] - sc.points[1]);
        }
  const swings = [...pairs].sort((p, q) => p - q);
  assert.deepEqual(swings, [-2, -1, 0, 1, 2], 'one round moves the margin by at most 2 either way');
  // Giving way in a standoff: the other keeps their order; at best you read and they misread.
  let best = -Infinity;
  for (const ord of ['follow', 'lead'])
    for (const [r0, r1] of READS) {
      const other = ord === 'lead' ? 'follow' : 'lead';
      const sc = Y.score([ord, ord], [r0 ? ord : other, r1 ? ord : other], standoff(ord, 'G', 'W', true));
      best = Math.max(best, sc.points[0] - sc.points[1]);
    }
  assert.equal(best, 0, 'giving way leaves your margin unchanged at best');
  let reach = new Set([0]);
  const holes = {};
  for (let round = 1; round <= C.ROUNDS; round++) {
    const left = C.ROUNDS - round;
    holes[round] = [...reach].filter((m) => m < 0 && m + best + 2 * left < 0).map((m) => -m).sort((p, q) => p - q);
    reach = new Set([...reach].flatMap((m) => swings.map((d) => m + d)));
  }
  assert.deepEqual(holes, { 1: [], 2: [], 3: [3, 4], 4: [1, 2, 3, 4, 5, 6] });
  // A way into the round-3 hole. Round 1, both FOLLOW: Blue gives way, Orange reads, Blue misreads: 2-0.
  // Round 2, Orange LEAD and Blue FOLLOW, both keep, Orange reads, Blue misreads: 4-1. In round 3
  // Blue gives way and at best it is 5-2; round 4 can bring Blue 2 more at most: 5-4.
  const r1 = Y.score(['follow', 'follow'], ['follow', 'lead'], { leader: 'B', heldFraction: 1 }).points;
  const r2 = Y.score(['lead', 'follow'], ['follow', 'follow'], { leader: 'A', heldFraction: 1 }).points;
  assert.deepEqual([r1[0] + r2[0], r1[1] + r2[1]], [4, 1]);
});

test('incentives: always holding still breaks the glass, and mirroring instantly never beats copying from behind when you were told to follow', () => {
  // Never moving: the mirror needs both dots travelling, so it cannot hold whatever the partner does.
  const r = rng(4242);
  const st = still(r, N);
  for (const mover of [wander(r, N, 80), circlePath(N, 80, 4), steering(st, 100, 50, r)]) {
    assert.equal(Y.analyse(trace(mover, st)).heldFraction, 0);
    assert.equal(Y.analyse(trace(st, mover)).heldFraction, 0);
  }
  // Mirroring instantly ("together": the mirror holds, nobody ahead) against copying from behind.
  const held = 0.8;
  for (const guesses of COMBOS) {
    const margin = (orders, leader) => {
      const sc = Y.score(orders, guesses, { leader, heldFraction: held });
      return sc.points[1] - sc.points[0]; // Blue's margin
    };
    // Lead/follow, Blue told to follow: falling in together changes nobody's margin (both or neither keep).
    assert.equal(margin(['lead', 'follow'], null), margin(['lead', 'follow'], 'A'));
    // Both told to follow, Orange moved first: copying from behind keeps Blue's order; together does not.
    assert.equal(margin(['follow', 'follow'], 'A'), margin(['follow', 'follow'], null) + 1);
    // Both told to lead: together beats giving way by a point, but only against a partner predictable
    // enough to anticipate. Against unpredictable motion even a quick copier is behind (the steering
    // test), and a partner who wants the point can move unpredictably.
    assert.equal(margin(['lead', 'lead'], null), margin(['lead', 'lead'], 'A') + 1);
  }
});

test('dealing: each player gets an independent fair coin; your own order says nothing about theirs', () => {
  const count = new Map();
  for (let b0 = 0; b0 < 2; b0++)
    for (let b1 = 0; b1 < 2; b1++)
      for (let b2 = 0; b2 < 2; b2++)
        for (let b3 = 0; b3 < 2; b3++)
          for (const high of [0, 0xfffffffe, 0x12345678 & ~1]) {
            const rand = [high | b0, high | b1, high | b2, high | b3];
            const o = Y.dealOrders(rand);
            const opt = Y.dealOptions(rand, false);
            const key = JSON.stringify([o, opt]);
            count.set(key, (count.get(key) || 0) + 1);
          }
  // 16 distinct (orders, button-order) outcomes, each from exactly one low-bit pattern.
  assert.equal(count.size, 16);
  for (const v of count.values()) assert.equal(v, 3);
  // P(their order | my order) = 1/2 for both players.
  for (const p of [0, 1])
    for (const mine of ['lead', 'follow']) {
      const deals = COMBOS.filter((o) => o[p] === mine);
      assert.equal(deals.length, 2);
      assert.equal(deals.filter((o) => o[1 - p] === 'lead').length, 1);
    }
});

test('no guessing rule that ignores the round itself beats a coin: exactly 1/2, even using earlier reveals', () => {
  // Every deterministic rule from (my order this round, both orders last round) to a guess:
  // 2 x 4 = 8 inputs, 2^8 = 256 rules. Averaged over the 4 x 4 equally likely deals of two
  // rounds, each rule guesses the second round right exactly half the time.
  const inputs = [];
  for (const mine of ['lead', 'follow']) for (const prev of COMBOS) inputs.push(mine + '|' + prev.join(','));
  for (let rule = 0; rule < 256; rule++) {
    const guessFor = (key) => ((rule >> inputs.indexOf(key)) & 1 ? 'lead' : 'follow');
    for (const p of [0, 1]) {
      let right = 0;
      let total = 0;
      for (const prev of COMBOS)
        for (const now of COMBOS) {
          total++;
          if (guessFor(now[p] + '|' + prev.join(',')) === now[1 - p]) right++;
        }
      assert.equal(right * 2, total, `rule ${rule} player ${p}`);
    }
  }
});

test('practice answers: all six button orders are possible, and "who led" maps to the right player', () => {
  const seen = new Set();
  for (let r = 0; r < 12; r++) seen.add(Y.dealOptions([0, 0, r, r], true)[0].join(','));
  assert.equal(seen.size, 6);
  assert.equal(Y.feltLeader(0, 'me'), 'A');
  assert.equal(Y.feltLeader(0, 'them'), 'B');
  assert.equal(Y.feltLeader(1, 'me'), 'B');
  assert.equal(Y.feltLeader(1, 'them'), 'A');
  assert.equal(Y.feltLeader(1, 'nobody'), 'none');
});

// ------------------------------------------------------------------ state machine

function cannedTrace(samples, seed) {
  const r = rng(seed);
  const a = wander(r, samples, 70);
  return trace(a, steering(a, 120, 50, r));
}
const TRACE = { [C.PLAY_MS / C.DT]: cannedTrace(C.PLAY_MS / C.DT, 1), [C.PRACTICE_MS / C.DT]: cannedTrace(C.PRACTICE_MS / C.DT, 2) };
// The same lengths with both hands resting still: the mirror never holds, so a scored round breaks the glass.
const STILL = Object.fromEntries([C.PLAY_MS / C.DT, C.PRACTICE_MS / C.DT].map((n, i) => [n, trace(still(rng(70 + i), n), still(rng(80 + i), n))]));
const RANDS = [];
for (let o = 0; o < 4; o++) for (let q = 0; q < 4; q++) RANDS.push([o & 1, (o >> 1) & 1, q & 1, ((q >> 1) & 1) + 2]);

// Every action that could be tried in state s (including ones that should be refused).
function actionsFor(s) {
  const out = [{ type: 'quit' }];
  const t = s.phaseAt;
  if (s.phase === 'title') {
    out.push({ type: 'practice', rand: RANDS[0], now: 1000 });
    for (const rand of RANDS) out.push({ type: 'play', rand, now: 1000 });
    out.push({ type: 'play' }); // no randomness: refused
  }
  if (s.phase === 'deal') {
    for (const player of [0, 1]) for (const down of [true, false]) out.push({ type: 'peek', player, down });
    out.push({ type: 'begin', now: t + 500 });
  }
  if (s.phase === 'countdown') {
    out.push({ type: 'tick', now: t + C.COUNTDOWN_MS - 1 });
    out.push({ type: 'tick', now: t + C.COUNTDOWN_MS });
  }
  if (s.phase === 'play') {
    const tr = TRACE[s.playMs / C.DT];
    out.push({ type: 'finish', now: t + s.playMs - 1, trace: tr }); // too early
    out.push({ type: 'finish', now: t + s.playMs, trace: TRACE[C.PLAY_MS / C.DT] === tr ? TRACE[C.PRACTICE_MS / C.DT] : TRACE[C.PLAY_MS / C.DT] }); // wrong length
    out.push({ type: 'finish', now: t + s.playMs, trace: tr });
    out.push({ type: 'finish', now: t + s.playMs, trace: STILL[s.playMs / C.DT] }); // the mirror never held
  }
  if (s.phase === 'guess') {
    for (const player of [0, 1]) for (const value of ['lead', 'follow', 'me', 'them', 'nobody', 'bogus']) out.push({ type: 'guess', player, value, now: t + 100 });
  }
  if (s.phase === 'reveal') {
    out.push({ type: 'next', rand: RANDS[s.round % RANDS.length], now: t + 100 });
    if (s.round === 1) for (const rand of RANDS) out.push({ type: 'next', rand, now: t + 100 });
  }
  if (s.phase === 'summary') out.push({ type: 'again' });
  return out;
}
// Identity of a state for the search. History and totals are left out: no transition depends on them.
// Whether the glass has broken does matter (a broken glass ends the game), and so does which trace
// the round was played on, since it decides whether the glass breaks at the reveal.
function key(s) {
  return JSON.stringify([s.phase, s.round, s.practice, s.orders, s.peek, s.options, s.guesses, s.broken, s.trace === null ? null : s.trace === STILL[s.trace.n] ? 'still' : 'moving']);
}
function explore() {
  const start = Y.newGame();
  const states = new Map([[key(start), start]]);
  const edges = new Map();
  const queue = [start];
  while (queue.length) {
    const s = queue.shift();
    const k = key(s);
    const out = new Set();
    for (const a of actionsFor(s)) {
      const n = Y.act(s, a);
      const nk = key(n);
      out.add(nk);
      if (!states.has(nk)) {
        states.set(nk, n);
        queue.push(n);
      }
    }
    edges.set(k, out);
  }
  return { states, edges };
}
const GRAPH = explore();

test('state machine: every phase and round is reachable, and none is a dead end', () => {
  const { states, edges } = GRAPH;
  const phases = new Set([...states.values()].map((s) => s.phase));
  assert.deepEqual([...phases].sort(), ['countdown', 'deal', 'guess', 'play', 'reveal', 'summary', 'title']);
  const rounds = new Set([...states.values()].map((s) => s.round));
  assert.deepEqual([...rounds].sort(), [0, 1, 2, 3, 4]);
  // From every reachable state, the summary can still be reached, and so can the title.
  const back = new Map();
  for (const [k, outs] of edges) for (const o of outs) (back.get(o) || back.set(o, new Set()).get(o)).add(k);
  for (const goal of ['summary', 'title']) {
    const seen = new Set([...states.keys()].filter((k) => states.get(k).phase === goal));
    const q = [...seen];
    while (q.length) for (const p of back.get(q.shift()) || []) if (!seen.has(p)) (seen.add(p), q.push(p));
    for (const k of states.keys()) assert.ok(seen.has(k), `${goal} unreachable from ${k}`);
  }
  assert.ok(states.size > 600, `explored ${states.size} states`);
  if (process.env.AFTER_YOU_VERBOSE) console.log(`explored ${states.size} states`);
});

test('state machine: refused actions change nothing, and no action modifies the state it is given', () => {
  const deepFreeze = (o) => {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
      Object.freeze(o);
      for (const v of Object.values(o)) deepFreeze(v);
    }
    return o;
  };
  let checked = 0;
  for (const s of GRAPH.states.values()) {
    const frozen = deepFreeze(JSON.parse(JSON.stringify({ ...s, trace: null })));
    for (const a of actionsFor(s)) {
      const before = JSON.stringify(frozen);
      const n = Y.act(frozen, a);
      assert.equal(JSON.stringify(frozen), before);
      if (n !== frozen) checked++;
    }
  }
  assert.ok(checked > 1000);
  // Specific refusals.
  let s = Y.act(Y.newGame(), { type: 'play', rand: RANDS[3], now: 0 });
  assert.equal(Y.act(s, { type: 'begin', now: 1 }), s, 'cannot begin before both have peeked');
  s = Y.act(s, { type: 'peek', player: 0, down: true });
  assert.equal(Y.act(s, { type: 'begin', now: 1 }), s, 'cannot begin before both have peeked');
  s = Y.act(Y.act(Y.act(s, { type: 'peek', player: 0, down: false }), { type: 'peek', player: 1, down: true }), { type: 'peek', player: 1, down: false });
  s = Y.act(s, { type: 'begin', now: 100 });
  assert.equal(s.phase, 'countdown');
  s = Y.act(s, { type: 'tick', now: 100 + C.COUNTDOWN_MS });
  assert.equal(s.phase, 'play');
  const bad = JSON.parse(JSON.stringify(TRACE[1500]));
  bad.ax[7] = NaN;
  assert.equal(Y.act(s, { type: 'finish', now: s.phaseAt + C.PLAY_MS, trace: bad }), s, 'a trace with a hole is refused');
  s = Y.act(s, { type: 'finish', now: s.phaseAt + C.PLAY_MS, trace: TRACE[1500] });
  assert.equal(s.phase, 'guess');
  const g = Y.act(s, { type: 'guess', player: 0, value: 'lead' });
  assert.equal(Y.act(g, { type: 'guess', player: 0, value: 'follow' }), g, 'a guess cannot be changed');
  assert.equal(Y.act(g, { type: 'guess', player: 1, value: 'me' }), g, 'practice answers are refused in a scored round');
});

test('a whole game: practice plus four rounds, totals add up, and a game can always be restarted', () => {
  let s = Y.act(Y.newGame(), { type: 'practice', rand: [5, 6, 7, 8], now: 0 });
  s = Y.act(s, { type: 'begin', now: 10 });
  s = Y.act(s, { type: 'tick', now: 10 + C.COUNTDOWN_MS });
  s = Y.act(s, { type: 'finish', now: s.phaseAt + C.PRACTICE_MS, trace: TRACE[1000] });
  s = Y.act(Y.act(s, { type: 'guess', player: 0, value: 'me' }), { type: 'guess', player: 1, value: 'them' });
  assert.equal(s.phase, 'reveal');
  assert.deepEqual(s.totals, [0, 0], 'practice is not scored');
  assert.deepEqual(s.history[0].felt, ['A', 'A']);
  for (let round = 1; round <= 4; round++) {
    s = Y.act(s, { type: 'next', rand: [round, round >> 1, 3, 4], now: s.phaseAt + 10 });
    assert.equal(s.round, round);
    for (const p of [0, 1]) s = Y.act(Y.act(s, { type: 'peek', player: p, down: true }), { type: 'peek', player: p, down: false });
    s = Y.act(s, { type: 'begin', now: s.phaseAt + 10 });
    s = Y.act(s, { type: 'tick', now: s.phaseAt + C.COUNTDOWN_MS });
    s = Y.act(s, { type: 'finish', now: s.phaseAt + C.PLAY_MS, trace: TRACE[1500] });
    s = Y.act(Y.act(s, { type: 'guess', player: 0, value: 'lead' }), { type: 'guess', player: 1, value: 'follow' });
    assert.equal(s.phase, 'reveal');
  }
  const sum = s.history.reduce((t, h) => [t[0] + h.points[0], t[1] + h.points[1]], [0, 0]);
  assert.deepEqual(s.totals, sum);
  s = Y.act(s, { type: 'next', rand: [0, 0, 0, 0], now: 0 });
  assert.equal(s.phase, 'summary');
  const v = Y.view(s);
  assert.equal(v.summary.rounds, 4);
  assert.deepEqual(v.summary.totals, sum);
  assert.equal(Y.act(s, { type: 'again' }).phase, 'title');
});

// ------------------------------------------------------------------ hidden information

function stripOwnCards(v) {
  const c = JSON.parse(JSON.stringify(v));
  if (c.cards) for (const card of c.cards) if (card.held) delete card.order;
  return c;
}

test('hidden orders: in every reachable state before the reveal, the screen is the same whatever the orders are', () => {
  let compared = 0;
  for (const s of GRAPH.states.values()) {
    if (!s.orders || s.phase === 'reveal' || s.phase === 'summary' || s.phase === 'title') continue;
    const base = stripOwnCards(Y.view(s));
    for (const orders of COMBOS) {
      const v = Y.view({ ...s, orders });
      assert.deepEqual(stripOwnCards(v), base, `${key(s)} with ${orders}`);
      if (v.cards) for (const p of [0, 1]) assert.equal(v.cards[p].order, s.peek[p].held ? orders[p] : null);
      compared++;
    }
  }
  assert.ok(compared > 2000, `compared ${compared}`);
});

test('hidden guesses: before the reveal, the screen shows only that a player has answered, never what', () => {
  let compared = 0;
  for (const s of GRAPH.states.values()) {
    if (s.phase !== 'guess') continue;
    for (const p of [0, 1]) {
      if (s.guesses[p] === null) continue;
      for (const alt of s.options[p]) {
        const g = s.guesses.slice();
        g[p] = alt;
        assert.deepEqual(Y.view({ ...s, guesses: g }), Y.view(s));
        compared++;
      }
    }
    const v = Y.view(s);
    assert.equal(v.result, undefined);
    assert.equal(JSON.stringify(v).includes('"analysis"'), false, 'the measurement waits for the reveal');
  }
  assert.ok(compared > 100);
});

test('the page draws from the view, not from the hidden state', () => {
  const app = fs.readFileSync(path.join(HERE, 'app.js'), 'utf8');
  // Hidden fields may only be read off the reveal's result or the summary, which come from the view
  // and exist only after the reveal. Nothing reads them off the game state itself.
  const hits = [...app.matchAll(/(\w+)\??\.(orders|guesses|peek|analysis|history|options|trace)\b/g)];
  for (const m of hits) assert.ok(['res', 'v', 'gq', 'line', 'summary'].includes(m[1]), `app.js reads ${m[0]}`);
  for (const m of hits) if (m[1] === 'v') assert.equal(m[2], 'trace', `app.js reads ${m[0]} off a view`);
  for (const m of hits) if (m[1] === 'gq') assert.equal(m[2], 'options', `app.js reads ${m[0]}`);
  assert.doesNotMatch(app, /\bgame\.(?!phase\b)/, 'app.js reads only the phase off the game state');
  assert.match(app, /AfterYou\.view\(|Y\.view\(/);
});
