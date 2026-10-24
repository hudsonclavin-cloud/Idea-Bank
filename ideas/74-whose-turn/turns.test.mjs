// Tests for turns.js. Run from the repo root: node --test ideas/74-whose-turn/turns.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const W = require('./turns.js');
const { Q, ZERO, add, sub, mul, cmp, eq, toNumber, qstr, parseQ } = W;

// ------------------------------------------------------------------ helpers
const ids = (n) => Array.from({ length: n }, (_, i) => `p${String(i).padStart(3, '0')}`);
function circleOf(kind, n, events = []) {
  return {
    id: 'circle0001',
    name: 'Test',
    nameT: 0,
    kind,
    created: 0,
    members: ids(n).map((id, i) => ({ id, name: `Person ${i}`, nameT: 0, gone: false, goneT: 0, pos: i })),
    events,
    removed: [],
  };
}
function subsetsOf(n, min = 2) {
  const out = [];
  for (let m = 1; m < 1 << n; m++) {
    const s = [];
    for (let i = 0; i < n; i++) if ((m >> i) & 1) s.push(i);
    if (s.length >= min) out.push(s);
  }
  return out;
}
const g = (j, n) => j * (n - j);
const abs = (q) => (cmp(q, ZERO) < 0 ? W.neg(q) : q);

/** Brute force: the largest u(J) - a|J|(n-|J|) over every group J (including the empty one). */
function bruteExcess(kind, bals) {
  const n = bals.length;
  const a = W.alphaOf(kind);
  let best = ZERO;
  for (let m = 0; m < 1 << n; m++) {
    let s = ZERO;
    let j = 0;
    for (let i = 0; i < n; i++) if ((m >> i) & 1) (s = add(s, bals[i])), j++;
    const v = sub(s, mul(a, Q(g(j, n))));
    if (cmp(v, best) > 0) best = v;
  }
  return best;
}

/** One step of the rule on a plain array of rationals, the doer chosen by `choose` among the tied. */
function step(kind, u, S, choose = (tied) => tied[0]) {
  let best = null;
  for (const i of S) if (best === null || cmp(u[i], best) > 0) best = u[i];
  const tied = S.filter((i) => eq(u[i], best));
  const c = choose(tied);
  const v = u.slice();
  for (const [p, d] of W.eventDelta(kind, S, c)) v[p] = add(v[p], d);
  return { v, c };
}

// ------------------------------------------------------------------ arithmetic
test('rationals: normalised, exact, and agree with an independent integer computation', () => {
  assert.deepEqual(Q(6, -4), { n: -3n, d: 2n });
  assert.equal(qstr(add(Q(1, 3), Q(1, 6))), '1/2');
  assert.equal(qstr(sub(Q(1, 3), Q(1, 2))), '-1/6');
  assert.equal(qstr(parseQ('-14/12')), '-7/6');
  // 1/2 + 1/3 + ... + 1/30 summed exactly vs. a common-denominator integer sum
  let s = ZERO;
  let L = 1n;
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  for (let k = 2n; k <= 30n; k++) L = (L / gcd(L, k)) * k;
  let num = 0n;
  for (let k = 2n; k <= 30n; k++) (s = add(s, Q(1n, k))), (num += L / k);
  assert.ok(eq(s, Q(num, L)));
});

test('fmt: mixed fractions for halves to eighths, "about" otherwise', () => {
  const f = (s) => W.fmt(parseQ(s)).text;
  assert.equal(f('0'), '0');
  assert.equal(f('3'), '3');
  assert.equal(f('-7/6'), '1⅙');
  assert.equal(f('4/3'), '1⅓');
  assert.equal(f('1/2'), '½');
  assert.equal(f('8/5'), '1⅗');
  assert.equal(f('7/12'), 'about 0.6');
  assert.equal(W.fmt(parseQ('7/12')).exact, false);
  assert.equal(f('59/60'), 'about 1');
});

// ------------------------------------------------------------------ the ledger
test('ledger: balances add up to exactly zero and match a hand-made example', () => {
  const [a, b, c] = ids(3);
  const circle = circleOf('turns', 3, [
    { id: 'e0000001', t: 1, by: a, who: [a, b, c] }, // a: 1/3-1, b: +1/3, c: +1/3
    { id: 'e0000002', t: 2, by: b, who: [a, b] }, //    a: +1/2,  b: 1/2-1
    { id: 'e0000003', t: 3, by: c, who: [c, a] }, //    c: 1/2-1, a: +1/2
  ]);
  const bal = W.balances(circle);
  assert.equal(qstr(bal.get(a)), '1/3'); // -2/3 + 1/2 + 1/2
  assert.equal(qstr(bal.get(b)), '-1/6'); // 1/3 - 1/2
  assert.equal(qstr(bal.get(c)), '-1/6'); // 1/3 - 1/2
  const rows = W.ledger(circle);
  assert.equal(qstr(rows.get(a).share), '4/3');
  assert.equal(rows.get(a).done, 1);
});

test('ledger: rounds count portions (one each for everyone present; the buyer buys k)', () => {
  const [a, b, c] = ids(3);
  const circle = circleOf('rounds', 3, [
    { id: 'e0000001', t: 1, by: a, who: [a, b, c] },
    { id: 'e0000002', t: 2, by: b, who: [a, b] },
    { id: 'e0000003', t: 3, by: c, who: [c, a] },
  ]);
  const bal = W.balances(circle);
  // a had 3, bought 3 -> 0; b had 2, bought 2 -> 0; c had 2, bought 2 -> 0. Then check a skewed one.
  assert.equal(qstr(bal.get(a)), '0');
  assert.equal(qstr(bal.get(b)), '0');
  assert.equal(qstr(bal.get(c)), '0');
  circle.events.push({ id: 'e0000004', t: 4, by: a, who: [a, b, c] });
  const bal2 = W.balances(circle);
  assert.equal(qstr(bal2.get(a)), '-2');
  assert.equal(qstr(bal2.get(b)), '1');
  assert.equal(qstr(bal2.get(c)), '1');
});

test('ledger: random ledgers sum to zero exactly, and the doer is always counted as present', () => {
  const r = W.rng(7);
  for (let trial = 0; trial < 200; trial++) {
    const n = 2 + Math.floor(r() * 9);
    const kind = r() < 0.5 ? 'turns' : 'rounds';
    const P = ids(n);
    const events = [];
    for (let i = 0; i < 40; i++) {
      const who = P.filter(() => r() < 0.6);
      if (!who.length) who.push(P[0]);
      const by = P[Math.floor(r() * n)]; // sometimes not in `who`: counted as present anyway
      events.push({ id: `e${String(i).padStart(6, '0')}`, t: i, by, who });
    }
    const circle = circleOf(kind, n, events);
    let s = ZERO;
    for (const v of W.balances(circle).values()) s = add(s, v);
    assert.ok(eq(s, ZERO));
    // independent recomputation with integers over lcm(1..n)
    let L = 1;
    const gcd = (a, b) => (b ? gcd(b, a % b) : a);
    for (let k = 1; k <= n; k++) L = (L / gcd(L, k)) * k;
    const u = new Map(P.map((p) => [p, 0]));
    for (const e of events) {
      const present = [...new Set([...e.who, e.by])];
      const k = present.length;
      for (const p of present) u.set(p, u.get(p) + (kind === 'rounds' ? L : L / k));
      u.set(e.by, u.get(e.by) - (kind === 'rounds' ? k * L : L));
    }
    for (const p of P) assert.ok(eq(W.balances(circle).get(p), Q(u.get(p), L)), `${kind} ${p}`);
  }
});

test('removed events do not count; order of logging does not change balances', () => {
  const r = W.rng(11);
  const P = ids(5);
  const events = [];
  for (let i = 0; i < 30; i++) {
    const who = P.filter(() => r() < 0.7);
    if (who.length < 2) continue;
    events.push({ id: `e${String(i).padStart(6, '0')}`, t: 1000 + i, by: who[Math.floor(r() * who.length)], who });
  }
  const c1 = circleOf('turns', 5, events);
  const c2 = circleOf('turns', 5, events.slice().reverse());
  for (const p of P) assert.ok(eq(W.balances(c1).get(p), W.balances(c2).get(p)));
  const c3 = { ...c1, events: [...events, { id: 'ezzzzzz1', t: 5000, by: P[0], who: P }], removed: ['ezzzzzz1'] };
  for (const p of P) assert.ok(eq(W.balances(c1).get(p), W.balances(c3).get(p)));
});

// ------------------------------------------------------------------ the rule
test('pick: highest balance among those present; ties to least recent, then list order', () => {
  const [a, b, c, d] = ids(4);
  const circle = circleOf('turns', 4, [
    { id: 'e0000001', t: 1, by: a, who: [a, b, c, d] }, // a -3/4, others +1/4
    { id: 'e0000002', t: 2, by: b, who: [b, c] }, //       b +1/4-1/2 = -1/4, c +3/4
  ]);
  let p = W.pick(circle, [a, b, c, d]);
  assert.equal(p.top.id, c);
  assert.equal(p.ranked.map((x) => x.id).join(','), [c, d, b, a].join(','));
  // a and d: d at 1/4 vs a at -3/4. Present b and d only: d
  assert.equal(W.pick(circle, [b, d]).top.id, d);
  // a tie: fresh circle, everyone 0: list order
  const fresh = circleOf('turns', 3);
  p = W.pick(fresh, ids(3));
  assert.equal(p.top.id, ids(3)[0]);
  assert.equal(p.tieBy, 'list');
  // tie broken by recency: after a full round of three, everyone is at 0 again
  const [x, y, z] = ids(3);
  const round = circleOf('turns', 3, [
    { id: 'e0000001', t: 1, by: x, who: [x, y] },
    { id: 'e0000002', t: 2, by: y, who: [x, y] },
    { id: 'e0000003', t: 3, by: z, who: [z, x] },
    { id: 'e0000004', t: 4, by: x, who: [z, x] },
  ]);
  for (const v of W.balances(round).values()) assert.equal(qstr(v), '0');
  p = W.pick(round, [x, y, z]);
  assert.equal(p.top.id, y); // y's last turn (event 2) is older than z's (3) and x's (4)
  assert.equal(p.tieBy, 'recency');
  assert.equal(W.pick(round, [x]).ok, false);
});

test('the engine itself: its pick, logged for 300 entries of random attendance, keeps every bound', () => {
  const r = W.rng(43);
  for (const kind of ['turns', 'rounds']) {
    for (let trial = 0; trial < 8; trial++) {
      const n = 2 + Math.floor(r() * 9);
      const circle = circleOf(kind, n);
      const P = circle.members.map((m) => m.id);
      const bound = mul(W.alphaOf(kind), Q(n - 1));
      for (let t = 0; t < 300; t++) {
        const who = P.filter(() => r() < 0.55);
        if (who.length < 2) continue;
        const rows = W.ledger(circle);
        const pk = W.pick(circle, who, rows);
        // the pick has the largest balance among those present
        for (const id of who) assert.ok(cmp(rows.get(id).bal, pk.top.bal) <= 0);
        circle.events.push({ id: `e${String(t).padStart(6, '0')}`, t: 1000 * t, by: pk.top.id, who });
        const after = W.ledger(circle);
        assert.ok(eq(W.excess(kind, n, [...after.values()].map((x) => x.bal)), ZERO));
        assert.ok(eq(W.promise(circle, after).bound, bound));
        for (const x of after.values()) assert.ok(cmp(abs(x.bal), bound) <= 0);
      }
      const rp = W.replay(circle);
      assert.equal(rp.followed, rp.total);
      // the simulator's 'fair' rule makes the same choices as pick()
      const idx = new Map(P.map((p, i) => [p, i]));
      const days = W.liveEvents(circle).map((e) => e.who.map((w) => idx.get(w)).sort((a, b) => a - b));
      const sim = W.simulate('fair', kind, n, days);
      assert.deepEqual(sim.doers, W.liveEvents(circle).map((e) => idx.get(e.by)));
    }
  }
});

test('replay: notices turns that did not go to the pick', () => {
  const [a, b] = ids(2);
  const c = circleOf('turns', 2, [
    { id: 'e0000001', t: 1, by: a, who: [a, b] },
    { id: 'e0000002', t: 2, by: a, who: [a, b] }, // b was owed... no: b owed 1/2, so b should have gone
  ]);
  const r = W.replay(c);
  assert.equal(r.total, 2);
  assert.equal(r.followed, 1);
  assert.deepEqual(r.deviations, [1]);
});

// ------------------------------------------------------------------ the promise
test('excess(): the sorted prefix sums give the same answer as checking every group', () => {
  const r = W.rng(3);
  for (let trial = 0; trial < 300; trial++) {
    const n = 1 + Math.floor(r() * 10);
    const kind = r() < 0.5 ? 'turns' : 'rounds';
    const bals = Array.from({ length: n }, () => Q(Math.floor(r() * 41) - 20, 1 + Math.floor(r() * 12)));
    // make them sum to zero
    let s = ZERO;
    for (const b of bals) s = add(s, b);
    bals[0] = sub(bals[0], s);
    assert.ok(eq(W.excess(kind, n, bals), bruteExcess(kind, bals)));
  }
});

test('the identity behind the promise holds exactly for random balances and groups', () => {
  // (a'+1) f(J) = a' f(J+c) + f(J-B) + sum_{b in B}(u_c - u_b) + alpha a'(a'+1),
  // f(X) = alpha |X|(n-|X|) - u(X), for J not containing c, B a non-empty subset of J.
  const r = W.rng(5);
  for (let trial = 0; trial < 2000; trial++) {
    const n = 2 + Math.floor(r() * 9);
    const alpha = r() < 0.5 ? Q(1, 2) : Q(1 + Math.floor(r() * 3), 1 + Math.floor(r() * 3));
    const u = Array.from({ length: n }, () => Q(Math.floor(r() * 61) - 30, 1 + Math.floor(r() * 7)));
    const c = Math.floor(r() * n);
    const J = [];
    for (let i = 0; i < n; i++) if (i !== c && r() < 0.6) J.push(i);
    if (!J.length) J.push((c + 1) % n);
    const B = J.filter(() => r() < 0.6);
    if (!B.length) B.push(J[0]);
    const f = (X) => {
      let s = ZERO;
      for (const i of X) s = add(s, u[i]);
      return sub(mul(alpha, Q(g(X.length, n))), s);
    };
    const ap = B.length;
    const lhs = mul(Q(ap + 1), f(J));
    let rhs = add(mul(Q(ap), f([...J, c])), f(J.filter((i) => !B.includes(i))));
    for (const b of B) rhs = add(rhs, sub(u[c], u[b]));
    rhs = add(rhs, mul(alpha, Q(ap * (ap + 1))));
    assert.ok(eq(lhs, rhs), `n=${n}`);
  }
});

test('following the rule keeps every group within its bound, for random attendance up to 14 people', () => {
  const r = W.rng(17);
  for (const kind of ['turns', 'rounds']) {
    const a = W.alphaOf(kind);
    for (let trial = 0; trial < 60; trial++) {
      const n = 2 + Math.floor(r() * 13);
      const pr = Array.from({ length: n }, () => 0.15 + 0.8 * r());
      let u = Array.from({ length: n }, () => ZERO);
      for (let t = 0; t < 400; t++) {
        const S = [];
        for (let i = 0; i < n; i++) if (r() < pr[i]) S.push(i);
        if (S.length < 2) continue;
        ({ v: u } = step(kind, u, S, (tied) => tied[Math.floor(r() * tied.length)]));
        assert.ok(eq(W.excess(kind, n, u), ZERO), `${kind} n=${n} t=${t}`);
        const bound = mul(a, Q(n - 1));
        for (const x of u) assert.ok(cmp(abs(x), bound) <= 0);
      }
    }
  }
});

test('from any state, following the rule never makes the excess D (or the promise) grow', () => {
  const r = W.rng(23);
  for (const kind of ['turns', 'rounds']) {
    for (let trial = 0; trial < 150; trial++) {
      const n = 2 + Math.floor(r() * 8);
      // an arbitrary starting point, e.g. after people ignored the rule
      let u = Array.from({ length: n }, () => Q(Math.floor(r() * 41) - 20, 1 + Math.floor(r() * 6)));
      let s = ZERO;
      for (const x of u) s = add(s, x);
      u[0] = sub(u[0], s);
      let D = W.excess(kind, n, u);
      const bound0 = add(mul(W.alphaOf(kind), Q(n - 1)), D);
      for (let t = 0; t < 150; t++) {
        const S = [];
        for (let i = 0; i < n; i++) if (r() < 0.55) S.push(i);
        if (S.length < 2) continue;
        ({ v: u } = step(kind, u, S, (tied) => tied[tied.length - 1]));
        const D2 = W.excess(kind, n, u);
        assert.ok(cmp(D2, D) <= 0, `D grew: ${qstr(D)} -> ${qstr(D2)}`);
        D = D2;
        for (const x of u) assert.ok(cmp(abs(x), bound0) <= 0);
      }
    }
  }
});

test('promise(): (n-1)/2 turns or n-1 portions on a fresh circle, wider after a deviation', () => {
  const t = circleOf('turns', 5);
  assert.equal(qstr(W.promise(t).bound), '2');
  const rd = circleOf('rounds', 5);
  assert.equal(qstr(W.promise(rd).bound), '4');
  const [a, b] = ids(2);
  const c = circleOf('turns', 2, [
    { id: 'e0000001', t: 1, by: a, who: [a, b] },
    { id: 'e0000002', t: 2, by: a, who: [a, b] },
  ]); // a is now owed 1, b owes 1: beyond 1/2
  const p = W.promise(c);
  assert.equal(qstr(p.D), '1/2');
  assert.equal(qstr(p.bound), '1');
  // promiseIf: if b now does it, back to even and the promise returns to 1/2
  assert.equal(qstr(W.promiseIf(c, [a, b], b).bound), '1/2');
});

// ------------------------------------------------------------------ exhaustive: the true worst case
/** Every state the rule can reach from even, for n people, over every attendance and tie choice. */
function reachable(kind, n) {
  let L = 1;
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  if (kind === 'turns') for (let k = 1; k <= n; k++) L = (L / gcd(L, k)) * k;
  const subs = subsetsOf(n);
  const start = new Array(n).fill(0);
  const seen = new Set([start.join(',')]);
  const stack = [start];
  let worst = 0;
  while (stack.length) {
    const u = stack.pop();
    for (const S of subs) {
      // u is sorted, so equal balances are interchangeable: one tied choice stands for all
      let c = S[0];
      for (const i of S) if (u[i] > u[c]) c = i;
      const v = u.slice();
      const k = S.length;
      for (const i of S) v[i] += kind === 'turns' ? L / k : L;
      v[c] -= kind === 'turns' ? L : k * L;
      v.sort((x, y) => x - y);
      const key = v.join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      stack.push(v);
      worst = Math.max(worst, v[n - 1], -v[0]);
    }
  }
  return { states: seen.size, worst: Q(worst, L), L };
}
const STATES = { turns: [0, 0, 2, 8, 195, 51823], rounds: [0, 0, 2, 5, 16, 59, 247, 1111, 5302] };

test('exhaustive: the worst case the rule reaches, turns circles of 2 to 5 people', () => {
  for (let n = 2; n <= 5; n++) {
    const r = reachable('turns', n);
    assert.equal(qstr(r.worst), W.EXACT_TURNS[n], `n=${n}`);
    assert.equal(r.states, STATES.turns[n]);
    assert.ok(cmp(r.worst, Q(n - 1, 2)) <= 0); // within the proven bound
  }
});

test('exhaustive: rounds circles of 2 to 8 people reach exactly n-1 portions, never more', () => {
  for (let n = 2; n <= 8; n++) {
    const r = reachable('rounds', n);
    assert.equal(qstr(r.worst), String(n - 1), `n=${n}`);
    assert.equal(r.states, STATES.rounds[n]);
  }
});

test('exhaustive: the sorting shortcut is sound (unsorted search agrees for n <= 4)', () => {
  for (const kind of ['turns', 'rounds']) {
    for (let n = 2; n <= 4; n++) {
      let L = kind === 'turns' ? [1, 1, 2, 6, 12][n] : 1;
      const subs = subsetsOf(n);
      const seen = new Set(['0,'.repeat(n)]);
      const stack = [new Array(n).fill(0)];
      let worst = 0;
      while (stack.length) {
        const u = stack.pop();
        for (const S of subs) {
          const best = Math.max(...S.map((i) => u[i]));
          for (const c of S.filter((i) => u[i] === best)) {
            const v = u.slice();
            for (const i of S) v[i] += kind === 'turns' ? L / S.length : L;
            v[c] -= kind === 'turns' ? L : S.length * L;
            const key = v.join(',') + ',';
            if (seen.has(key)) continue;
            seen.add(key);
            stack.push(v);
            worst = Math.max(worst, ...v.map(Math.abs));
          }
        }
      }
      assert.equal(qstr(Q(worst, L)), qstr(reachable(kind, n).worst));
    }
  }
});

test('optimality: for turns circles of 2 to 4, no rule at all has a smaller worst case', () => {
  // A safety game: the attendance is chosen by an adversary, the doer by the rule. For a bound B
  // on the 1/L grid, delete every state (balances within B, summing to 0) from which some
  // attendance forces every choice of doer out of the remaining states. If the even state
  // survives, some rule can keep everyone within B forever; if not, no rule can.
  for (let n = 2; n <= 4; n++) {
    let L = 1;
    const gcd = (a, b) => (b ? gcd(b, a % b) : a);
    for (let k = 1; k <= n; k++) L = (L / gcd(L, k)) * k;
    const subs = subsetsOf(n);
    const solve = (Bn) => {
      const states = [];
      const index = new Map();
      const rec = (pre, min, sum) => {
        if (pre.length === n - 1) {
          const last = -sum;
          if (last >= (pre.length ? pre[pre.length - 1] : -Bn) && last <= Bn && last >= -Bn) {
            const v = [...pre, last];
            index.set(v.join(','), states.length);
            states.push(v);
          }
          return;
        }
        for (let x = min; x <= Bn; x++) rec([...pre, x], x, sum + x);
      };
      rec([], -Bn, 0);
      const alive = new Uint8Array(states.length).fill(1);
      for (let changed = true; changed; ) {
        changed = false;
        for (let s = 0; s < states.length; s++) {
          if (!alive[s]) continue;
          const u = states[s];
          for (const S of subs) {
            const ok = S.some((c) => {
              const v = u.slice();
              for (const i of S) v[i] += L / S.length;
              v[c] -= L;
              v.sort((x, y) => x - y);
              const j = index.get(v.join(','));
              return j !== undefined && alive[j];
            });
            if (!ok) {
              alive[s] = 0;
              changed = true;
              break;
            }
          }
        }
      }
      return !!alive[index.get(new Array(n).fill(0).join(','))];
    };
    const exact = parseQ(W.EXACT_TURNS[n]);
    const Bn = Number((exact.n * BigInt(L)) / exact.d);
    assert.equal(solve(Bn), true, `n=${n}: the rule itself achieves ${W.EXACT_TURNS[n]}`);
    assert.equal(solve(Bn - 1), false, `n=${n}: nothing does better`);
  }
});

test('the lower bound for any rule: the first time everyone comes, the doer goes (n-1)/n or n-1 ahead', () => {
  for (let n = 2; n <= 10; n++) {
    const all = Array.from({ length: n }, (_, i) => i);
    for (const kind of ['turns', 'rounds']) {
      const d = W.eventDelta(kind, all, 0).get(0);
      assert.equal(qstr(d), kind === 'turns' ? qstr(Q(1 - n, n)) : String(1 - n));
    }
  }
});

test('adversarial search finds nothing beyond the proven bound for 6 to 9 people', () => {
  // Hill-climb over attendance sequences, trying to push someone as far from even as possible.
  const r = W.rng(29);
  for (let n = 6; n <= 9; n++) {
    const subs = subsetsOf(n);
    let bestFound = ZERO;
    for (let restart = 0; restart < 12; restart++) {
      let u = Array.from({ length: n }, () => ZERO);
      for (let t = 0; t < 250; t++) {
        // greedy adversary: try a sample of attendances, keep the one that maximises the spread
        let bestS = null;
        let bestScore = null;
        for (let s = 0; s < 40; s++) {
          const S = subs[Math.floor(r() * subs.length)];
          const { v } = step('turns', u, S);
          const sorted = v.slice().sort(cmp);
          const score = add(abs(sorted[0]), mul(Q(1, 3), sub(sorted[n - 1], sorted[0])));
          if (bestScore === null || cmp(score, bestScore) > 0) (bestScore = score), (bestS = S);
        }
        u = step('turns', u, bestS).v;
        for (const x of u) bestFound = W.qmax(bestFound, abs(x));
      }
    }
    assert.ok(cmp(bestFound, Q(n - 1, 2)) <= 0, `n=${n}: found ${qstr(bestFound)}`);
  }
});

// ------------------------------------------------------------------ other rules drift
test('a plain rota, or counting turns, drifts without limit; the rule does not', () => {
  // Two people come every time; a third comes every third time.
  const days = [];
  for (let i = 0; i < 60; i++) days.push([0, 1], [0, 1], [0, 1, 2]);
  const fair = W.simulate('fair', 'turns', 3, days);
  const rota = W.simulate('rota', 'turns', 3, days);
  const fewest = W.simulate('fewest', 'turns', 3, days);
  assert.equal(qstr(W.worst(fair.history)), '5/6');
  // the third person does every third turn but has a third of it as a share: 2/3 more per cycle
  assert.equal(qstr(rota.final[2]), '-40');
  assert.equal(qstr(fewest.final[2]), '-40');
  // and it keeps growing: twice as many cycles, twice as far
  const days2 = days.concat(days);
  assert.equal(qstr(W.simulate('rota', 'turns', 3, days2).final[2]), '-80');
});

test('the example year on the page', () => {
  const ex = exampleYear();
  assert.equal(ex.days.length, 190);
  const fair = W.worst(W.simulate('fair', 'turns', 4, ex.days).history);
  const rota = W.worst(W.simulate('rota', 'turns', 4, ex.days).history);
  const fewest = W.worst(W.simulate('fewest', 'turns', 4, ex.days).history);
  assert.equal(W.fmt(fair).text, '⅚');
  assert.equal(W.fmt(rota).text, 'about 5.1');
  assert.equal(W.fmt(fewest).text, 'about 18.4');
  // the parent who came least: 102 of 190 runs, a fair share of about 29.6, 48 drives under "fewest"
  assert.equal(ex.days.filter((d) => d.includes(2)).length, 102);
  assert.equal(Math.min(...[0, 1, 2, 3].map((i) => ex.days.filter((d) => d.includes(i)).length)), 102);
  let share = ZERO;
  for (const d of ex.days) if (d.includes(2)) share = add(share, Q(1, d.length));
  assert.equal(toNumber(share).toFixed(1), '29.6');
  const fw = W.simulate('fewest', 'turns', 4, ex.days);
  assert.equal(fw.doers.filter((d) => d === 2).length, 48);
  // under both other rules the parent who came least ends the year over their share
  assert.ok(cmp(W.simulate('rota', 'turns', 4, ex.days).final[2], ZERO) < 0);
  assert.ok(cmp(fw.final[2], ZERO) < 0);
  // the page says these numbers
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  const para = /<p id="why-rota">([\s\S]*?)<\/p>/.exec(html)[1];
  for (const s of ['190 runs', 'only 102', '5.1 turns', '48 times', 'about 29.6', '⅚ of a turn']) assert.ok(para.includes(s), s);
});
function exampleYear() {
  const r = W.rng(1);
  const probs = [0.95, 0.9, 0.45, 0.7];
  const days = [];
  while (days.length < 190) {
    const p = [];
    for (let i = 0; i < 4; i++) if (r() < probs[i]) p.push(i);
    if (p.length >= 2) days.push(p);
  }
  return { days };
}

// ------------------------------------------------------------------ merging and sharing
function randomCircle(r, base) {
  const c = JSON.parse(JSON.stringify(base));
  const P = c.members.map((m) => m.id);
  for (let i = 0; i < 1 + Math.floor(r() * 20); i++) {
    const who = P.filter(() => r() < 0.6);
    if (who.length < 2) continue;
    c.events.push({ id: `e${Math.floor(r() * 1e9).toString(36).padStart(6, '0')}`, t: 1000 * Math.floor(r() * 1e6), by: who[0], who });
  }
  for (const e of c.events) if (r() < 0.1) c.removed.push(e.id);
  if (r() < 0.3) (c.members[0].name = `Renamed ${Math.floor(r() * 9)}`), (c.members[0].nameT = Math.floor(r() * 10));
  if (r() < 0.2) (c.members[1].gone = true), (c.members[1].goneT = Math.floor(r() * 10));
  return c;
}
const canon = (c) => JSON.stringify(W.normalize(c));

test('merge: order does not matter, merging twice changes nothing, and deletions stick', () => {
  const r = W.rng(31);
  for (let trial = 0; trial < 200; trial++) {
    const base = circleOf(r() < 0.5 ? 'turns' : 'rounds', 4);
    const a = randomCircle(r, base);
    const b = randomCircle(r, base);
    const c = randomCircle(r, base);
    assert.equal(canon(W.merge(a, b)), canon(W.merge(b, a)));
    assert.equal(canon(W.merge(W.merge(a, b), c)), canon(W.merge(a, W.merge(b, c))));
    assert.equal(canon(W.merge(a, a)), canon(a));
    const ab = W.merge(a, b);
    assert.equal(canon(W.merge(ab, a)), canon(ab));
    for (const id of [...a.removed, ...b.removed]) assert.ok(ab.removed.includes(id));
    // balances of the merge = balances of the union of live events
    const live = new Map();
    for (const e of [...a.events, ...b.events]) live.set(e.id, e);
    for (const id of ab.removed) live.delete(id);
    const direct = { ...base, events: [...live.values()], removed: [] };
    const m1 = W.balances(ab);
    const m2 = W.balances(direct);
    for (const [id, v] of m1) assert.ok(eq(v, m2.get(id)));
  }
});

test('merge refuses different circles or a turns/rounds mismatch', () => {
  const a = circleOf('turns', 3);
  assert.throws(() => W.merge(a, { ...a, id: 'other0001' }), /different circles/);
  assert.throws(() => W.merge(a, { ...a, kind: 'rounds' }), /turns and the other rounds/);
});

test('codes: a 60-person circle round-trips (presence is a 60-bit mask)', () => {
  const r = W.rng(41);
  const c = randomCircle(r, circleOf('rounds', 60));
  for (let i = 0; i < 30; i++) {
    const who = c.members.filter(() => r() < 0.5).map((m) => m.id);
    if (who.length >= 2) c.events.push({ id: `big${String(i).padStart(5, '0')}`, t: 1000 * (2e9 + i), by: who[who.length - 1], who });
  }
  const back = W.decode(W.encode(c));
  assert.equal(canon(back), canon(c));
  for (const [id, v] of W.balances(c)) assert.ok(eq(v, W.balances(back).get(id)));
});

test('codes: round trip, found inside surrounding text, and bad input is refused', () => {
  const r = W.rng(37);
  const base = circleOf('turns', 6);
  base.members[2].name = 'Zoë “Z” Ñúñez';
  const c = randomCircle(r, base);
  const code = W.encode(c);
  assert.match(code, /^WHOSETURN1:[A-Za-z0-9_-]+$/);
  assert.equal(canon(W.decode(code)), canon(c));
  assert.equal(canon(W.decode(`here you go ${code} cheers`)), canon(c));
  assert.equal(canon(W.decode(`https://example.org/whose-turn/#${code}`)), canon(c));
  assert.throws(() => W.decode('hello'), /No ledger code/);
  assert.throws(() => W.decode(code.slice(0, code.length - 9)), /damaged|not a/);
  const bad = W.toWire(c);
  bad.e += ',ebad00001~1~z~1'; // doer at position 35 of a 6-person list
  assert.throws(() => W.fromWire(bad), /not in the circle/);
  const bad2 = W.toWire(c);
  bad2.e += `,ebad00002~1~0~${(1n << 40n).toString(36)}`; // present: someone at position 40
  assert.throws(() => W.fromWire(bad2), /not in the circle/);
  const bad3 = W.toWire(c);
  bad3.e += ',ebad00003~1~0'; // a field missing
  assert.throws(() => W.fromWire(bad3), /not a ledger/);
  const evil = W.toWire(c);
  evil.m[0][1] = 'x'.repeat(500);
  assert.throws(() => W.fromWire(evil), /member name/);
});

test('the page: the table of worst cases and promises says what the code computes', () => {
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  const table = /<table class="bounds">([\s\S]*?)<\/table>/.exec(html)[1];
  const cells = (label) => {
    const row = new RegExp(`<th scope="row">${label}</th>([\\s\\S]*?)</tr>`).exec(table)[1];
    return [...row.matchAll(/<td>([^<]*)/g)].map((m) => m[1]);
  };
  const worst = cells('Worst reached \\(turns\\)').slice(0, 4);
  const promised = cells('Promised \\(turns\\)').slice(0, 4);
  for (let n = 2; n <= 5; n++) {
    assert.equal(worst[n - 2], W.fmt(parseQ(W.EXACT_TURNS[n])).text, `worst, n=${n}`);
    assert.equal(promised[n - 2], W.fmt(Q(n - 1, 2)).text, `promised, n=${n}`);
    assert.equal(qstr(W.promise(circleOf('turns', n)).bound), qstr(Q(n - 1, 2)));
  }
});
