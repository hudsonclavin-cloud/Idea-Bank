// Tests for every mathematical claim on the page and in the README.
// Run from the repo root:  node --test ideas/61-isomorphs/isomorphs.test.mjs
//
// The rule here: each claim is checked by a computation written separately from isomorphs.js
// (its own move rules, its own search), and then the module is checked against that.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Fifteen, Knights, Pocket } = require('./isomorphs.js');

/* ================================================================== */
/* Fifteen                                                             */
/* ================================================================== */

// Independent pieces: a hand is a sorted array of numbers.
const holds15 = (hand) => {
  for (let i = 0; i < hand.length; i++)
    for (let j = i + 1; j < hand.length; j++)
      for (let k = j + 1; k < hand.length; k++) if (hand[i] + hand[j] + hand[k] === 15) return true;
  return false;
};
const GRID_LINES = (() => {
  const L = [];
  for (let r = 0; r < 3; r++) L.push([3 * r, 3 * r + 1, 3 * r + 2]);
  for (let c = 0; c < 3; c++) L.push([c, c + 3, c + 6]);
  L.push([0, 4, 8], [2, 4, 6]);
  return L;
})();
const LO_SHU = [2, 7, 6, 9, 5, 1, 4, 3, 8];
function* permutations(a, k = 0) {
  if (k === a.length) { yield a.slice(); return; }
  for (let i = k; i < a.length; i++) {
    [a[k], a[i]] = [a[i], a[k]];
    yield* permutations(a, k + 1);
    [a[k], a[i]] = [a[i], a[k]];
  }
}
// The 8 symmetries of the square, as maps of cell indices.
function symmetries(cells) {
  const rot = (g) => [g[6], g[3], g[0], g[7], g[4], g[1], g[8], g[5], g[2]];
  const flip = (g) => [g[2], g[1], g[0], g[5], g[4], g[3], g[8], g[7], g[6]];
  const out = [];
  let g = cells;
  for (let i = 0; i < 4; i++) { out.push(g, flip(g)); g = rot(g); }
  return out;
}

test('exactly 8 of the 84 triples from 1-9 add up to 15', () => {
  let all = 0;
  const found = [];
  for (let a = 1; a <= 9; a++) for (let b = a + 1; b <= 9; b++) for (let c = b + 1; c <= 9; c++) {
    all++;
    if (a + b + c === 15) found.push(`${a}${b}${c}`);
  }
  assert.equal(all, 84);
  assert.equal(found.length, 8);
  assert.deepEqual(Fifteen.TRIPLES.map((t) => t.join('')).sort(), found.sort());
});

test('exactly 8 of the 362,880 grids are magic, all one square turned and flipped, and the module agrees on every grid', () => {
  const magic = [];
  let n = 0;
  for (const g of permutations([1, 2, 3, 4, 5, 6, 7, 8, 9])) {
    n++;
    const ok = GRID_LINES.every((ln) => g[ln[0]] + g[ln[1]] + g[ln[2]] === 15);
    if (ok) magic.push(g.join(''));
    assert.equal(Fifteen.isMagic(g), ok);
  }
  assert.equal(n, 362880);
  assert.equal(magic.length, 8);
  const images = new Set(symmetries(LO_SHU).map((g) => g.join('')));
  assert.equal(images.size, 8);
  assert.deepEqual([...images].sort(), magic.sort());
  assert.deepEqual(Fifteen.LO_SHU, LO_SHU);
  // and the page's Lo Shu is magic, while a near miss (two numbers swapped) is not
  assert.ok(Fifteen.isMagic(LO_SHU));
  const swapped = LO_SHU.slice(); [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
  assert.ok(!Fifteen.isMagic(swapped));
  assert.ok(!Fifteen.isMagic([...LO_SHU.slice(0, 8), null]));
});

test('on every magic square, the 8 lines are exactly the 8 triples that make 15', () => {
  const triples = new Set(Fifteen.TRIPLES.map((t) => t.slice().sort((a, b) => a - b).join(',')));
  for (const g of symmetries(LO_SHU)) {
    const lines = new Set(GRID_LINES.map((ln) => ln.map((i) => g[i]).sort((a, b) => a - b).join(',')));
    assert.equal(lines.size, 8);
    assert.deepEqual([...lines].sort(), [...triples].sort());
  }
  // so a hand holds 15 exactly when its cells contain a line, for every possible hand
  for (const g of symmetries(LO_SHU)) {
    for (let mask = 0; mask < 512; mask++) {
      const hand = [];
      const cells = new Set();
      for (let i = 0; i < 9; i++) if (mask & (1 << i)) { hand.push(g[i]); cells.add(i); }
      hand.sort((a, b) => a - b);
      const hasLine = GRID_LINES.some((ln) => ln.every((i) => cells.has(i)));
      assert.equal(holds15(hand), hasLine);
      assert.equal(Fifteen.holdsFifteen(Fifteen.maskOf(hand)), hasLine);
    }
  }
});

test('5 is in four triples, each even number in three, each odd in two; grid centre, corners, edges likewise', () => {
  const counts = Fifteen.tripleCounts();
  assert.deepEqual(counts, { 1: 2, 2: 3, 3: 2, 4: 3, 5: 4, 6: 3, 7: 2, 8: 3, 9: 2 });
  const onLines = (i) => GRID_LINES.filter((ln) => ln.includes(i)).length;
  assert.equal(onLines(4), 4);
  for (const c of [0, 2, 6, 8]) assert.equal(onLines(c), 3);
  for (const e of [1, 3, 5, 7]) assert.equal(onLines(e), 2);
});

function countGames(nItems, wins) {
  const r = { games: 0, first: 0, second: 0, draw: 0 };
  const go = (a, b, turn, used) => {
    for (let x = 0; x < nItems; x++) {
      if (used.includes(x)) continue;
      const na = turn ? a : [...a, x];
      const nb = turn ? [...b, x] : b;
      const nu = [...used, x];
      if (wins(turn ? nb : na)) { r.games++; if (turn) r.second++; else r.first++; }
      else if (nu.length === nItems) { r.games++; r.draw++; }
      else go(na, nb, !turn, nu);
    }
  };
  go([], [], false, []);
  return r;
}

test('Fifteen has 255,168 games (131,184 / 77,904 / 46,080), the same counts as noughts and crosses on a grid', () => {
  const numbers = countGames(9, (hand) => holds15(hand.map((x) => x + 1).sort((p, q) => p - q)));
  const grid = countGames(9, (cells) => GRID_LINES.some((ln) => ln.every((i) => cells.includes(i))));
  const published = { games: 255168, first: 131184, second: 77904, draw: 46080 };
  assert.deepEqual(numbers, published);
  assert.deepEqual(grid, published);
});

// Plain minimax on the numbers, with no memo and nothing shared with the module.
function minimax(me, op) {
  const used = new Set([...me, ...op]);
  let best = -2;
  let any = false;
  for (let k = 1; k <= 9; k++) {
    if (used.has(k)) continue;
    any = true;
    const nm = [...me, k].sort((a, b) => a - b);
    const v = holds15(nm) ? 1 : nm.length + op.length === 9 ? 0 : 0 - minimax(op, nm); // 0 - x, never -0
    if (v > best) best = v;
    if (best === 1) break;
  }
  return any ? best : 0;
}
// The same with a memo, for checking every position.
const memo = new Map();
function solved(me, op) {
  const key = me.join('') + '|' + op.join('');
  if (memo.has(key)) return memo.get(key);
  const v = minimax(me, op);
  memo.set(key, v);
  return v;
}

test('with best play Fifteen is a draw (independent minimax), and the module values every reachable position the same way', () => {
  assert.equal(minimax([], []) + 0, 0);
  // all positions reachable without anyone having already won
  const seen = new Set();
  let checked = 0;
  const walk = (x, o, xToMove) => {
    const key = x.join('') + '|' + o.join('');
    if (seen.has(key)) return;
    seen.add(key);
    const [me, op] = xToMove ? [x, o] : [o, x];
    const want = minimax(me, op);
    assert.equal(Fifteen.value(Fifteen.maskOf(me), Fifteen.maskOf(op)), want, `position ${key}`);
    checked++;
    for (let k = 1; k <= 9; k++) {
      if (x.includes(k) || o.includes(k)) continue;
      const nx = xToMove ? [...x, k].sort((a, b) => a - b) : x;
      const no = xToMove ? o : [...o, k].sort((a, b) => a - b);
      if (holds15(xToMove ? nx : no) || nx.length + no.length === 9) continue;
      walk(nx, no, !xToMove);
    }
  };
  walk([], [], true);
  // tic-tac-toe has 4,520 non-terminal positions reachable in play (5,478 legal positions minus 958 terminal)
  assert.equal(checked, 4520);
});

test('after an even opening, 5 is the only reply that does not lose', () => {
  for (const e of [2, 4, 6, 8]) {
    for (let r = 1; r <= 9; r++) {
      if (r === e) continue;
      // value for the replier, who now waits for the opener to move
      const v = 0 - minimax([e], [r]);
      if (r === 5) assert.equal(v + 0, 0, `${e} then 5 should draw`);
      else assert.equal(v, -1, `${e} then ${r} should lose`);
    }
  }
  // and after opening 5, every even reply draws while every odd reply loses
  for (let r = 1; r <= 9; r++) if (r !== 5) assert.equal(0 - minimax([5], [r]), r % 2 === 0 ? 0 : -1);
});

test('the machine only ever plays an optimal move, and never loses whatever you do', () => {
  // 18 evenly spaced random draws hit every member of any tie pool of up to 9 moves (spacing 1/18 < 1/9),
  // so the branches below cover every move the machine could ever make.
  const rngs = Array.from({ length: 18 }, (_, i) => () => (i + 0.5) / 18);
  let positions = 0;
  let machineWins = 0;
  let draws = 0;
  // the machine may start, or you may; you may answer anything; the machine may take any of its tie-break picks
  const play = (you, machine, machineToMove) => {
    if (machineToMove) {
      const ym = Fifteen.maskOf(you);
      const mm = Fifteen.maskOf(machine);
      const picks = new Set(rngs.map((r) => Fifteen.machineMove(mm, ym, r)));
      const best = Math.max(...[1, 2, 3, 4, 5, 6, 7, 8, 9].filter((k) => !you.includes(k) && !machine.includes(k))
        .map((k) => { const nm = [...machine, k].sort((a, b) => a - b); return holds15(nm) ? 1 : nm.length + you.length === 9 ? 0 : 0 - solved(you, nm); }));
      positions++;
      for (const k of picks) {
        const nm = [...machine, k].sort((a, b) => a - b);
        const v = holds15(nm) ? 1 : nm.length + you.length === 9 ? 0 : 0 - solved(you, nm);
        assert.equal(v, best, `machine pick ${k} at you=${you} machine=${machine}`);
        if (holds15(nm)) { machineWins++; continue; }
        if (nm.length + you.length === 9) { draws++; continue; }
        play(you, nm, false);
      }
    } else {
      for (let k = 1; k <= 9; k++) {
        if (you.includes(k) || machine.includes(k)) continue;
        const ny = [...you, k].sort((a, b) => a - b);
        assert.ok(!holds15(ny), `you won with ${ny} against ${machine}`);
        if (ny.length + machine.length === 9) { draws++; continue; }
        play(ny, machine, true);
      }
    }
  };
  play([], [], true);
  play([], [], false);
  assert.ok(positions > 100);
  assert.ok(machineWins > 0 && draws > 0);
});

test('the machine opens with an even number, and its traps win most games against a careful random player', () => {
  for (const r of [0, 0.3, 0.6, 0.9999]) assert.ok([2, 4, 6, 8].includes(Fifteen.machineMove(0, 0, () => r)));
  // careful random: takes a win, else blocks, else picks at random (the model the tie-break is tuned on)
  const careful = (you, machine, rand) => {
    const free = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((k) => !you.includes(k) && !machine.includes(k));
    const win = free.filter((k) => holds15([...you, k].sort((a, b) => a - b)));
    if (win.length) return win[Math.floor(rand() * win.length)];
    const block = free.filter((k) => holds15([...machine, k].sort((a, b) => a - b)));
    if (block.length) return block[Math.floor(rand() * block.length)];
    return free[Math.floor(rand() * free.length)];
  };
  let seed = 12345;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  let wins = 0;
  const N = 2000;
  for (let g = 0; g < N; g++) {
    const you = [];
    const machine = [];
    let turn = 'machine';
    for (;;) {
      if (turn === 'machine') {
        machine.push(Fifteen.machineMove(Fifteen.maskOf(machine), Fifteen.maskOf(you), rand));
        machine.sort((a, b) => a - b);
        if (holds15(machine)) { wins++; break; }
      } else {
        you.push(careful(you, machine, rand));
        you.sort((a, b) => a - b);
        assert.ok(!holds15(you));
      }
      if (you.length + machine.length === 9) break;
      turn = turn === 'machine' ? 'you' : 'machine';
    }
  }
  // the exact expectation is 0.927 (computed by the module's own trap score); allow sampling noise
  assert.ok(wins / N > 0.88 && wins / N < 0.97, `machine-first win rate ${wins / N}`);
});

test('against that careful opponent the machine wins exactly 89/96 of the games it starts', () => {
  // exact, by recursion: the machine picks uniformly among its tie-break pool, the opponent uniformly
  // among its careful replies (take a win, else block, else anything)
  const rngs = Array.from({ length: 18 }, (_, i) => () => (i + 0.5) / 18);
  const memoP = new Map();
  const pWin = (machine, you) => {
    const key = machine.join('') + '|' + you.join('');
    if (memoP.has(key)) return memoP.get(key);
    const picks = [...new Set(rngs.map((r) => Fifteen.machineMove(Fifteen.maskOf(machine), Fifteen.maskOf(you), r)))];
    let total = 0;
    for (const k of picks) {
      const nm = [...machine, k].sort((a, b) => a - b);
      if (holds15(nm)) { total += 1; continue; }
      if (nm.length + you.length === 9) continue;
      const free = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((x) => !nm.includes(x) && !you.includes(x));
      const win = free.filter((x) => holds15([...you, x].sort((a, b) => a - b)));
      const block = free.filter((x) => holds15([...nm, x].sort((a, b) => a - b)));
      const replies = win.length ? win : block.length ? block : free;
      let sub = 0;
      for (const y of replies) {
        const ny = [...you, y].sort((a, b) => a - b);
        if (holds15(ny) || nm.length + ny.length === 9) continue;
        sub += pWin(nm, ny);
      }
      total += sub / replies.length;
    }
    const v = total / picks.length;
    memoP.set(key, v);
    return v;
  };
  assert.ok(Math.abs(pWin([], []) - 89 / 96) < 1e-12, String(pWin([], [])));
});

test('status reports wins, draws and games in progress', () => {
  const m = Fifteen.maskOf;
  assert.deepEqual(Fifteen.status(m([2, 7, 6]), m([1, 3])), { over: true, winner: 'you', triple: [2, 6, 7] });
  assert.equal(Fifteen.status(m([1, 3]), m([4, 5, 6])).winner, 'machine');
  // a full board with no line: X O X / X O O / O X X on the Lo Shu
  const x = [2, 3, 6, 8, 9];
  const o = [1, 4, 5, 7];
  assert.ok(!holds15(x) && !holds15(o));
  assert.deepEqual(Fifteen.status(m(x), m(o)), { over: true, winner: null, triple: null });
  assert.equal(Fifteen.status(m([5]), m([2])).over, false);
});

/* ================================================================== */
/* Knights                                                             */
/* ================================================================== */

// Independent board: squares are 'a1'..'c3', knight moves computed from letters and digits.
const SQ = [];
for (const f of 'abc') for (const r of '123') SQ.push(f + r);
const jumps = (sq) => {
  const f = sq.charCodeAt(0) - 97;
  const r = Number(sq[1]) - 1;
  const out = [];
  for (const [df, dr] of [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]) {
    const f2 = f + df;
    const r2 = r + dr;
    if (f2 >= 0 && f2 < 3 && r2 >= 0 && r2 < 3) out.push(String.fromCharCode(97 + f2) + (r2 + 1));
  }
  return out;
};

test('no knight move touches b2, and the other eight squares form one ring of eight', () => {
  assert.deepEqual(jumps('b2'), []);
  for (const s of SQ) if (s !== 'b2') assert.equal(jumps(s).length, 2, s);
  // walk the ring
  const ring = ['a1'];
  let prev = null;
  let cur = 'a1';
  for (;;) {
    const next = jumps(cur).find((x) => x !== prev);
    if (next === 'a1') break;
    ring.push(next);
    prev = cur;
    cur = next;
  }
  assert.equal(ring.length, 8);
  assert.equal(new Set(ring).size, 8);
  // the module's ring is the same cycle (same squares in the same cyclic order, either direction)
  const mod = Knights.ringOrder().map((i) => Knights.SQUARES[i].name);
  const rot = (a, k) => a.slice(k).concat(a.slice(0, k));
  const same = [...Array(8).keys()].some((k) => rot(mod, k).join() === ring.join() || rot(mod.slice().reverse(), k).join() === ring.join());
  assert.ok(same, `${mod} vs ${ring}`);
  // and the module's move lists match
  Knights.SQUARES.forEach((s, i) => {
    assert.deepEqual(Knights.NEIGHBOURS[i].map((j) => Knights.SQUARES[j].name).sort(), jumps(s.name).sort());
  });
  assert.equal(Knights.EDGES.length, 8);
});

// Independent BFS over positions written as {square: colour}.
function bfs(start) {
  const key = (p) => SQ.map((s) => p[s] || '.').join('');
  const dist = new Map([[key(start), 0]]);
  let frontier = [start];
  let d = 0;
  while (frontier.length) {
    d++;
    const next = [];
    for (const p of frontier) {
      for (const s of Object.keys(p)) {
        for (const t of jumps(s)) {
          if (p[t]) continue;
          const q = { ...p };
          q[t] = q[s];
          delete q[s];
          const k = key(q);
          if (!dist.has(k)) { dist.set(k, d); next.push(q); }
        }
      }
    }
    frontier = next;
  }
  return { dist, key };
}

test('from the start, 280 of 420 placements are reachable; the swap takes 16 moves; the diagonals are unreachable', () => {
  const start = { a1: 'W', c1: 'W', a3: 'B', c3: 'B' };
  const { dist, key } = bfs(start);
  assert.equal(dist.size, 280);
  // all placements of two W and two B on the eight outer squares
  const choose = (n, k) => (k === 0 ? 1 : (n * choose(n - 1, k - 1)) / k);
  assert.equal(choose(8, 2) * choose(6, 2), 420);
  assert.equal(dist.get(key({ a3: 'W', c3: 'W', a1: 'B', c1: 'B' })), 16);
  assert.equal(dist.has(key({ a1: 'W', c3: 'W', c1: 'B', a3: 'B' })), false);
  // the other diagonal pairing too
  assert.equal(dist.has(key({ c1: 'W', a3: 'W', a1: 'B', c3: 'B' })), false);
  // the module agrees, position for position
  const modDist = Knights.distances(Knights.START);
  assert.equal(modDist.size, 280);
  assert.equal(modDist.get(Knights.TARGETS.swap), 16);
  assert.equal(modDist.has(Knights.TARGETS.diagonals), false);
  // the module writes positions square-index first (a1 b1 c1 a2 ...); translate and compare every distance
  for (const [k, d] of dist) {
    const p = {};
    SQ.forEach((s, i) => { if (k[i] !== '.') p[s] = k[i]; });
    const modKey = Knights.posFrom({ W: Object.keys(p).filter((s) => p[s] === 'W'), B: Object.keys(p).filter((s) => p[s] === 'B') });
    assert.equal(modDist.get(modKey), d);
  }
});

test('reachable exactly when the colours keep their order round the ring (two together, two together)', () => {
  const start = { a1: 'W', c1: 'W', a3: 'B', c3: 'B' };
  const { dist } = bfs(start);
  // independent ring and cyclic-order test
  const ring = ['a1', 'b3', 'c1', 'a2', 'c3', 'b1', 'a3', 'c2'];
  for (let i = 0; i < 8; i++) assert.ok(jumps(ring[i]).includes(ring[(i + 1) % 8]));
  const order = (p) => ring.map((s) => p[s]).filter(Boolean).join('');
  const together = (seq) => /^(WWBB|WBBW|BBWW|BWWB)$/.test(seq);
  // enumerate all 420 placements
  const outer = ring;
  let both = 0;
  let togetherCount = 0;
  for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) {
    const rest = outer.filter((_, i) => i !== a && i !== b);
    for (let c = 0; c < 6; c++) for (let d = c + 1; d < 6; d++) {
      const p = { [outer[a]]: 'W', [outer[b]]: 'W', [rest[c]]: 'B', [rest[d]]: 'B' };
      const k = SQ.map((s) => p[s] || '.').join('');
      const t = together(order(p));
      if (t) togetherCount++;
      assert.equal(dist.has(k), t);
      if (t && dist.has(k)) both++;
    }
  }
  assert.equal(togetherCount, 280);
  assert.equal(both, 280);
  // and the module's ring reading
  assert.equal(Knights.ringColours(Knights.START), 'BBWW');
  assert.equal(Knights.ringColours(Knights.TARGETS.swap), 'BBWW');
  assert.equal(Knights.ringColours(Knights.TARGETS.diagonals), 'BWBW');
  for (const pos of Knights.distances(Knights.START).keys()) assert.equal(Knights.ringColours(pos), 'BBWW');
});

test('on the ring, the swap is every knight walking four steps the same way round', () => {
  // ring positions of the start and the swap
  const ring = Knights.ringOrder();
  const at = (pos) => ring.map((i) => pos[i]);
  const s = at(Knights.START);
  const t = at(Knights.TARGETS.swap);
  const rot = (a, k) => a.slice(-k).concat(a.slice(0, -k));
  assert.deepEqual(rot(s, 4), t);
  // 4 knights x 4 steps = 16, which the search says is optimal
  assert.equal(4 * 4, Knights.distances(Knights.START).get(Knights.TARGETS.swap));
});

// Expected moves for a random player to stumble on the swap, solved exactly in whole numbers (BigInt
// fraction-free Gauss-Jordan on the 279 non-target positions). pick(moves) gives each move's probability
// as [numerator, denominator] pairs; independent move rules (letters and digits).
function hittingTime(pick) {
  const start = { a1: 'W', c1: 'W', a3: 'B', c3: 'B' };
  const { dist, key } = bfs(start);
  const target = key({ a3: 'W', c3: 'W', a1: 'B', c1: 'B' });
  const states = [...dist.keys()].filter((k) => k !== target);
  const index = new Map(states.map((k, i) => [k, i]));
  const N = states.length;
  const gcdB = (x, y) => { x = x < 0n ? -x : x; y = y < 0n ? -y : y; while (y) [x, y] = [y, x % y]; return x; };
  const rows = states.map((k, i) => {
    const p = {};
    SQ.forEach((sq, j) => { if (k[j] !== '.') p[sq] = k[j]; });
    const moves = [];
    for (const sq of Object.keys(p)) for (const t of jumps(sq)) {
      if (p[t]) continue;
      const q = { ...p };
      q[t] = q[sq];
      delete q[sq];
      moves.push({ knight: sq, to: key(q) });
    }
    const probs = pick(moves);
    const den = probs.reduce((l, [, d]) => (l * d) / gcdB(l, d), 1n);
    // den * h_i - sum over moves of den * prob * h_q = den   (h_target = 0)
    const r = new Map([[i, den]]);
    moves.forEach((mv, k2) => {
      if (mv.to === target) return;
      const j = index.get(mv.to);
      const [pn, pd] = probs[k2];
      r.set(j, (r.get(j) || 0n) - (den / pd) * pn);
    });
    return { r, rhs: den };
  });
  for (let c = 0; c < N; c++) {
    let piv = c;
    while (!rows[piv].r.get(c)) piv++;
    [rows[c], rows[piv]] = [rows[piv], rows[c]];
    const P = rows[c];
    const pc = P.r.get(c);
    for (let r = 0; r < N; r++) {
      if (r === c) continue;
      const R = rows[r];
      const rc = R.r.get(c);
      if (!rc) continue;
      const nr = new Map();
      for (const [j, v] of R.r) nr.set(j, v * pc);
      for (const [j, v] of P.r) { const w = (nr.get(j) || 0n) - rc * v; if (w === 0n) nr.delete(j); else nr.set(j, w); }
      let rhs = R.rhs * pc - rc * P.rhs;
      let g = rhs;
      for (const v of nr.values()) g = gcdB(g, v);
      if (g > 1n) { for (const [j, v] of nr) nr.set(j, v / g); rhs /= g; }
      R.r = nr;
      R.rhs = rhs;
    }
  }
  const s = index.get(key(start));
  const R = rows.find((x) => x.r.size === 1 && x.r.has(s));
  let num = R.rhs;
  let den = R.r.get(s);
  const g = gcdB(num, den);
  num /= g; den /= g;
  if (den < 0n) { num = -num; den = -den; }
  return `${num}/${den}`;
}

test('random play: exactly 4,591,360/11,551 (about 397.49) moves to the swap when every legal move is equally likely', () => {
  const uniform = (moves) => moves.map(() => [1n, BigInt(moves.length)]);
  assert.equal(hittingTime(uniform), '4591360/11551');
  assert.ok(Math.abs(4591360 / 11551 - 397.4859) < 1e-4);
});

test('the figure depends on the random model: a random knight, then a random jump, gives 29,313,715,992/91,739,833 (about 319.5)', () => {
  const byKnight = (moves) => {
    const knights = [...new Set(moves.map((m) => m.knight))];
    return moves.map((m) => [1n, BigInt(knights.length * moves.filter((x) => x.knight === m.knight).length)]);
  };
  assert.equal(hittingTime(byKnight), '29313715992/91739833');
});

test('the README gives the random-play figure exactly and names its model', async () => {
  const fs = await import('node:fs');
  const readme = fs.readFileSync(new URL('./README.md', import.meta.url), 'utf8');
  assert.ok(readme.includes('4,591,360/11,551'), 'exact fraction missing');
  assert.ok(readme.includes('every legal move is equally likely'), 'random model not named');
  assert.ok(readme.includes('29,313,715,992/91,739,833'), 'other model missing');
  assert.ok(!/needs 397\.5 moves/.test(readme), 'bare 397.5 still presented as exact');
});

test('the README names every button that makes the pocket\'s choice for the reader', async () => {
  const fs = await import('node:fs');
  const readme = fs.readFileSync(new URL('./README.md', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  // the buttons in app.js wired to the two handlers that unfold a cushion without the reader choosing it
  const labels = new Set();
  for (const m of app.matchAll(/click: (hintCushion|unfoldAll) \} \}, ([^\n]*?)\)\)?;?\n/g)) {
    for (const q of m[2].matchAll(/'([^']+)'/g)) labels.add(q[1]);
  }
  assert.deepEqual([...labels].sort(), ['Hint', 'Unfold it for me', 'Unfold the rest']);
  const whatItIs = readme.split('## What it is')[1].split('\n\n')[1];
  const choice = readme.split('\n').find((l) => l.startsWith("- [Likely] The pocket's choice"));
  assert.ok(choice, 'honest-assessment line about the pocket\'s choice is missing');
  for (const text of [whatItIs, choice]) {
    assert.match(text, /[Hh]int/);
    assert.ok(text.includes('Unfold the rest'), `README leaves out "Unfold the rest": ${text.slice(0, 80)}`);
  }
});

test('string crossings: 16 on the board, none once the squares are laid round a circle in ring order', () => {
  const R = 24;
  const board = Knights.SQUARES.map((s) => ({ x: s.c * 100 + 50, y: (2 - s.r) * 100 + 50 }));
  const cr = Knights.crossings(board);
  assert.equal(cr.length, 16);
  // each of the eight strings crosses exactly four others
  assert.deepEqual(Knights.EDGES.map((_, i) => cr.filter((c) => c.e === i || c.f === i).length), Array(8).fill(4));
  // and independently of the module's geometry: proper crossings by the orientation test
  const o = (a, b, c) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  let own = 0;
  for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
    const [a, b2] = Knights.EDGES[i];
    const [c, d] = Knights.EDGES[j];
    if (new Set([a, b2, c, d]).size < 4) continue;
    if (o(board[a], board[b2], board[c]) * o(board[a], board[b2], board[d]) < 0 && o(board[c], board[d], board[a]) * o(board[c], board[d], board[b2]) < 0) own++;
  }
  assert.equal(own, 16);
  assert.equal(Knights.isUntangled(board, R), false);
  const ring = Knights.ringOrder();
  const circle = board.map((p) => ({ ...p }));
  ring.forEach((i, k) => {
    const a = -Math.PI / 2 + (2 * Math.PI * k) / 8;
    circle[i] = { x: 150 + 115 * Math.cos(a), y: 150 + 115 * Math.sin(a) };
  });
  circle[4] = { x: 150, y: 150 };
  assert.equal(Knights.crossings(circle).length, 0);
  assert.equal(Knights.isUntangled(circle, R), true);
  // every point of that layout is inside the area a drag can reach on the page (x in [R, 300-R], y in [R+4, 300-R])
  for (const p of circle) assert.ok(p.x >= R && p.x <= 300 - R && p.y >= R + 4 && p.y <= 300 - R);
  // the circle in board order (not ring order) is tangled
  const wrong = board.map((p) => ({ ...p }));
  [0, 1, 2, 5, 8, 7, 6, 3].forEach((i, k) => {
    const a = -Math.PI / 2 + (2 * Math.PI * k) / 8;
    wrong[i] = { x: 150 + 115 * Math.cos(a), y: 150 + 115 * Math.sin(a) };
  });
  assert.ok(Knights.crossings(wrong).length > 0);
  // a string running underneath a foreign square, or two squares on top of each other, is not untangled
  const under = circle.map((p) => ({ ...p }));
  const [a, b] = Knights.EDGES[0];
  under[4] = { x: (circle[a].x + circle[b].x) / 2, y: (circle[a].y + circle[b].y) / 2 };
  assert.equal(Knights.crossings(under).length, 0);
  assert.equal(Knights.isUntangled(under, R), false);
});

test('segment geometry: crossing, touching, collinear overlap, parallel and disjoint cases', () => {
  const P = (x, y) => ({ x, y });
  assert.ok(Knights.segmentsMeet(P(0, 0), P(10, 10), P(0, 10), P(10, 0)));
  assert.ok(Knights.segmentsMeet(P(0, 0), P(10, 0), P(5, 0), P(5, 5)));
  assert.ok(Knights.segmentsMeet(P(0, 0), P(10, 0), P(5, 0), P(15, 0)));
  assert.ok(!Knights.segmentsMeet(P(0, 0), P(10, 0), P(0, 1), P(10, 1)));
  assert.ok(!Knights.segmentsMeet(P(0, 0), P(10, 0), P(11, 0), P(20, 0)));
  assert.ok(!Knights.segmentsMeet(P(0, 0), P(4, 4), P(6, 6), P(10, 0)));
});

test('on a 3 x 4 board the knight strings make two rings of six joined by two strings (for "where next")', () => {
  const sq = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) sq.push([r, c]);
  const id = (r, c) => sq.findIndex(([a, b]) => a === r && b === c);
  const edges = new Set();
  for (const [r, c] of sq) for (const [dr, dc] of [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]) {
    const j = id(r + dr, c + dc);
    if (j >= 0) { const i = id(r, c); edges.add(Math.min(i, j) + '-' + Math.max(i, j)); }
  }
  assert.equal(edges.size, 14);
  // find edges whose removal leaves exactly two components that are both 6-cycles
  const list = [...edges].map((e) => e.split('-').map(Number));
  let found = 0;
  for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
    const rest = list.filter((_, k) => k !== a && k !== b);
    const adj = sq.map(() => []);
    for (const [i, j] of rest) { adj[i].push(j); adj[j].push(i); }
    const seen = new Set();
    const comps = [];
    for (let v = 0; v < 12; v++) {
      if (seen.has(v)) continue;
      const comp = [];
      const stack = [v];
      seen.add(v);
      while (stack.length) { const u = stack.pop(); comp.push(u); for (const w of adj[u]) if (!seen.has(w)) { seen.add(w); stack.push(w); } }
      comps.push(comp);
    }
    if (comps.length === 2 && comps.every((cp) => cp.length === 6 && cp.every((u) => adj[u].length === 2))) found++;
  }
  assert.equal(found, 1);
});

/* ================================================================== */
/* Pocket                                                              */
/* ================================================================== */

// Independent ball: unit time steps along the diagonal, reversing at the cushions.
function roll(m, n) {
  let x = 0, y = 0, vx = 1, vy = 1, t = 0, bounces = 0;
  const trail = [{ t, x, y }];
  for (;;) {
    x += vx; y += vy; t++;
    trail.push({ t, x, y });
    const cx = x === 0 || x === m;
    const cy = y === 0 || y === n;
    if (cx && cy) return { pocket: x === 0 ? (y === 0 ? 'A' : 'D') : y === 0 ? 'B' : 'C', bounces, t, trail };
    if (cx) { vx = -vx; bounces++; }
    if (cy) { vy = -vy; bounces++; }
  }
}
const gcd = (a, b) => (b ? gcd(b, a % b) : a);

test('for every table up to 60 x 60 the unfolded answer matches the ball, and the ball never returns to A', () => {
  for (let m = 1; m <= 60; m++) for (let n = 1; n <= 60; n++) {
    const ball = roll(m, n);
    const pr = Pocket.predict(m, n);
    const sim = Pocket.simulate(m, n);
    assert.equal(pr.pocket, ball.pocket, `${m}x${n}`);
    assert.equal(sim.pocket, ball.pocket, `${m}x${n}`);
    assert.equal(pr.bounces, ball.bounces, `${m}x${n}`);
    assert.equal(sim.bounces, ball.bounces, `${m}x${n}`);
    assert.notEqual(ball.pocket, 'A');
    // the path is L along each axis: length L * sqrt 2, with L the least common multiple
    const L = (m * n) / gcd(m, n);
    assert.equal(ball.t, L);
    assert.equal(pr.L, L);
    assert.ok(Math.abs(sim.length - L * Math.SQRT2) < 1e-9);
    // tables crossed: L/m across and L/n up, i.e. n/g and m/g, which share no factor
    const g = gcd(m, n);
    assert.equal(pr.across, n / g);
    assert.equal(pr.up, m / g);
    assert.equal(gcd(pr.across, pr.up), 1);
    assert.equal(pr.bounces, m / g + n / g - 2);
  }
});

test('the unfolded straight line, folded back onto the table, is the bouncing ball at every moment', () => {
  for (const [m, n] of [[4, 3], [5, 4], [7, 5], [6, 4], [9, 2], [1, 1], [12, 11]]) {
    const ball = roll(m, n);
    for (const { t, x, y } of ball.trail) {
      const f = Pocket.fold(m, n, t, t);
      assert.deepEqual([f.x, f.y], [x, y], `${m}x${n} at t=${t}`);
    }
    // half-step points too (between lattice points)
    for (let t2 = 1; t2 < 2 * ball.t; t2 += 2) {
      const a = ball.trail[(t2 - 1) / 2];
      const b = ball.trail[(t2 + 1) / 2];
      const f = Pocket.fold(m, n, t2 / 2, t2 / 2);
      assert.ok(Math.abs(f.x - (a.x + b.x) / 2) < 1e-12 && Math.abs(f.y - (a.y + b.y) / 2) < 1e-12);
    }
  }
});

test('unfolding one cushion at a time: one fold per bounce, adjacent copies, and the last corner names the pocket', () => {
  for (let m = 1; m <= 20; m++) for (let n = 1; n <= 20; n++) {
    const steps = Pocket.unfoldSteps(m, n);
    const ball = roll(m, n);
    assert.equal(steps.length, ball.bounces);
    let cur = [0, 0];
    let lastAt = 0;
    for (const st of steps) {
      assert.deepEqual(st.from, cur);
      const [i, j] = cur;
      assert.deepEqual(st.to, st.wall === 'v' ? [i + 1, j] : [i, j + 1]);
      // the wall is where the line y = x leaves the current copy
      if (st.wall === 'v') assert.equal(st.at, (i + 1) * m);
      else assert.equal(st.at, (j + 1) * n);
      assert.ok(st.at > lastAt);
      // and the bit of line in between stays inside the current copy
      const mid = (lastAt + st.at) / 2;
      assert.ok(mid >= i * m && mid <= (i + 1) * m && mid >= j * n && mid <= (j + 1) * n);
      lastAt = st.at;
      cur = st.to;
    }
    const pr = Pocket.predict(m, n);
    assert.deepEqual(cur, [pr.across - 1, pr.up - 1]);
    assert.equal(Pocket.cornerLabel(pr.across, pr.up), ball.pocket);
    // the copy mapping sends the real pocket at each corner to the label the lattice gives it
    for (const [i, j] of [[0, 0], [1, 0], [0, 1], [3, 2]]) {
      const real = { A: [0, 0], B: [m, 0], C: [m, n], D: [0, n] };
      for (const [lab, [u, v]] of Object.entries(real)) {
        const p = Pocket.toCopy(m, n, i, j, u, v);
        assert.equal(Pocket.cornerLabel(Math.round(p.x / m), Math.round(p.y / n)), lab);
        const back = Pocket.fold(m, n, p.x, p.y);
        assert.deepEqual([back.x, back.y], [u, v]);
      }
    }
  }
});

test('choosing a cushion: exactly one is next; every wrong one folds a copy the line never enters', () => {
  // independent: the copies the ball's straight line passes through, walked in unit steps along y = x
  for (let m = 1; m <= 16; m++) for (let n = 1; n <= 16; n++) {
    const L = (m * n) / gcd(m, n);
    const visited = new Set();
    for (let t2 = 1; t2 < 2 * L; t2 += 2) visited.add(`${Math.floor(t2 / 2 / m)},${Math.floor(t2 / 2 / n)}`);
    for (let i = -1; i <= L / m; i++) for (let j = -1; j <= L / n; j++) {
      assert.equal(Pocket.lineEnters(m, n, i, j), visited.has(`${i},${j}`), `${m}x${n} copy ${i},${j}`);
    }
    const steps = Pocket.unfoldSteps(m, n);
    let cur = [0, 0];
    for (let k = 0; k < steps.length; k++) {
      const kinds = {};
      for (const side of ['left', 'right', 'bottom', 'top']) {
        const ch = Pocket.cushionChoice(m, n, k, side);
        assert.deepEqual(ch.from, cur);
        kinds[side] = ch.kind;
        const [i, j] = cur;
        assert.deepEqual(ch.to, { left: [i - 1, j], right: [i + 1, j], bottom: [i, j - 1], top: [i, j + 1] }[side]);
        // the copy across a wrong cushion is never entered; the next one is; the entry one already was
        assert.equal(visited.has(`${ch.to[0]},${ch.to[1]}`), ch.kind !== 'miss', `${m}x${n} k=${k} ${side}`);
        if (ch.kind === 'next') assert.deepEqual(ch.to, steps[k].to);
        if (ch.kind === 'entry') assert.deepEqual(ch.to, steps[k - 1].from);
        // the fold is across the cushion itself
        assert.equal(ch.wall, side === 'left' || side === 'right' ? 'v' : 'h');
        assert.equal(ch.at, { left: i * m, right: (i + 1) * m, bottom: j * n, top: (j + 1) * n }[side]);
      }
      const count = (kind) => Object.values(kinds).filter((x) => x === kind).length;
      assert.equal(count('next'), 1);
      assert.equal(count('entry'), k === 0 ? 0 : 1);
      assert.equal(count('miss'), k === 0 ? 3 : 2);
      // the line always leaves through the right or the top
      assert.ok(kinds.right === 'next' || kinds.top === 'next');
      cur = steps[k].to;
    }
    assert.equal(Pocket.cushionChoice(m, n, steps.length, 'top'), null);
  }
});

test('the page\'s tables and questions have the answers the page gives', () => {
  // Play it: three tables, three different pockets
  assert.deepEqual([[4, 3], [5, 4], [7, 5]].map(([m, n]) => [roll(m, n).pocket, roll(m, n).bounces]), [['B', 5], ['D', 7], ['C', 10]]);
  // Play again
  assert.deepEqual([Pocket.predict(1000, 600).pocket, Pocket.predict(1000, 600).bounces], ['C', 6]);
  assert.deepEqual([Pocket.predict(1001, 1000).pocket, Pocket.predict(1001, 1000).bounces], ['D', 1999]);
  assert.deepEqual([Pocket.predict(64, 48).pocket, Pocket.predict(64, 48).bounces], ['B', 5]);
  assert.equal(roll(1000, 600).pocket, 'C');
  assert.equal(roll(1001, 1000).pocket, 'D');
  assert.equal(roll(1001, 1000).bounces, 1999);
  assert.equal(roll(64, 48).pocket, 'B');
  // scaling a table changes nothing but the scale
  for (let m = 1; m <= 12; m++) for (let n = 1; n <= 12; n++) for (let k = 2; k <= 9; k++) {
    assert.equal(Pocket.predict(k * m, k * n).pocket, Pocket.predict(m, n).pocket);
    assert.equal(Pocket.predict(k * m, k * n).bounces, Pocket.predict(m, n).bounces);
  }
});
