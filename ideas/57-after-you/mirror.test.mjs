// Tests for After You. Run from the repo root: node --test ideas/57-after-you/mirror.test.mjs
//
// Three groups: the trace measurement (driven with synthetic leaders and followers whose true
// lag is known), the scoring and dealing (enumerated exhaustively where the space is finite), and
// the state machine (every reachable state found by breadth-first search, checked for dead ends
// and for hidden information leaking into what the screen may show).
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
            assert.equal(sc.points[p], (held ? 1 : 0) + (kept ? 1 : 0) + (read ? 1 : 0));
          }
          if (orders[0] === orders[1]) assert.ok(!(sc.kept[0] && sc.kept[1]), 'same orders: both cannot keep them');
          else assert.equal(sc.kept[0] && sc.kept[1], leader !== null && orders[li] === 'lead');
          if (leader === null) assert.deepEqual(sc.kept, [false, false]);
          // Swapping the players swaps the points.
          const sw = Y.score([orders[1], orders[0]], [guesses[1], guesses[0]], fakeAnalysis(leader && SWAP[leader], held));
          assert.deepEqual(sw.points, [sc.points[1], sc.points[0]]);
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
function key(s) {
  return JSON.stringify([s.phase, s.round, s.practice, s.orders, s.peek, s.options, s.guesses]);
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
