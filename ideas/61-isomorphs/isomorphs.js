/* Isomorphs: the pure logic for all three rooms. No DOM in here.
 * Loaded by index.html as a classic script (window.Isomorphs) and by the Node tests via require().
 *
 *   Fifteen  - pick numbers 1-9 in turn; the first to hold three that add to 15 wins.
 *   Knights  - Guarini's four knights on a 3x3 board, and the strings between squares.
 *   Pocket   - a ball leaves a corner of an m x n table at 45 degrees; which pocket takes it?
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Isomorphs = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Fifteen                                                             */
  /* ------------------------------------------------------------------ */

  // Masks use bit k for the number k (bits 1..9), so a hand of numbers is one integer.
  const ALL = 0x3fe;
  const bit = (k) => 1 << k;
  const numbersOf = (mask) => {
    const out = [];
    for (let k = 1; k <= 9; k++) if (mask & bit(k)) out.push(k);
    return out;
  };
  const maskOf = (nums) => nums.reduce((m, k) => m | bit(k), 0);

  // Every set of three different numbers from 1..9 that adds to 15.
  const TRIPLES = [];
  for (let a = 1; a <= 9; a++)
    for (let b = a + 1; b <= 9; b++)
      for (let c = b + 1; c <= 9; c++) if (a + b + c === 15) TRIPLES.push([a, b, c]);
  const TRIPLE_MASKS = TRIPLES.map(maskOf);

  // The eight lines of a 3x3 grid, as cell indices (0 1 2 / 3 4 5 / 6 7 8).
  const LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
  ];

  // The first triple (in TRIPLES order) contained in a hand, or null.
  function winningTriple(mask) {
    for (let i = 0; i < TRIPLE_MASKS.length; i++) {
      if ((mask & TRIPLE_MASKS[i]) === TRIPLE_MASKS[i]) return TRIPLES[i].slice();
    }
    return null;
  }
  const holdsFifteen = (mask) => winningTriple(mask) !== null;

  // How many of the eight triples each number belongs to.
  function tripleCounts() {
    const c = {};
    for (let k = 1; k <= 9; k++) c[k] = TRIPLES.filter((t) => t.includes(k)).length;
    return c;
  }

  // Line sums of a grid arrangement (cells hold a number or null). A line with a gap sums to null.
  function lineSums(cells) {
    return LINES.map((ln) => (ln.every((i) => cells[i] != null) ? ln.reduce((s, i) => s + cells[i], 0) : null));
  }
  // A magic arrangement: each of 1..9 exactly once and every line adds to 15.
  function isMagic(cells) {
    if (!Array.isArray(cells) || cells.length !== 9) return false;
    const seen = new Set(cells);
    for (let k = 1; k <= 9; k++) if (!seen.has(k)) return false;
    return lineSums(cells).every((s) => s === 15);
  }

  // Exact game value for the side to move, given its hand and the other hand:
  // +1 it can force a win, 0 best play draws, -1 the other side can force a win.
  const valueMemo = new Map();
  function value(me, op) {
    const key = me * 1024 + op;
    const hit = valueMemo.get(key);
    if (hit !== undefined) return hit;
    let best = -2;
    let any = false;
    for (let k = 1; k <= 9; k++) {
      if ((me | op) & bit(k)) continue;
      any = true;
      const nm = me | bit(k);
      const v = holdsFifteen(nm) ? 1 : 0 - value(op, nm) || 0;
      if (v > best) best = v;
      if (best === 1) break;
    }
    if (!any) best = 0;
    valueMemo.set(key, best);
    return best;
  }

  // The outcome (for the mover) of taking k: +1 / 0 / -1 under best play afterwards.
  function moveValue(me, op, k) {
    const nm = me | bit(k);
    if (holdsFifteen(nm)) return 1;
    if (((nm | op) & ALL) === ALL) return 0;
    return 0 - value(op, nm) || 0;
  }

  function freeNumbers(a, b) {
    const out = [];
    for (let k = 1; k <= 9; k++) if (!((a | b) & bit(k))) out.push(k);
    return out;
  }

  function optimalMoves(me, op) {
    let best = -2;
    let moves = [];
    for (const k of freeNumbers(me, op)) {
      const v = moveValue(me, op, k);
      if (v > best) { best = v; moves = [k]; }
      else if (v === best) moves.push(k);
    }
    return { value: best, moves };
  }

  // The machine never gives up a point (it only ever plays optimal moves). Among optimal moves it
  // prefers the one that scores best against a "careful" opponent: one who takes a win when it has
  // one, blocks when the machine has one, and otherwise picks at random. That makes it set traps.
  function carefulReplies(machine, human) {
    const free = freeNumbers(machine, human);
    const wins = free.filter((k) => holdsFifteen(human | bit(k)));
    if (wins.length) return wins;
    const blocks = free.filter((k) => holdsFifteen(machine | bit(k)));
    if (blocks.length) return blocks;
    return free;
  }
  const trapMemoM = new Map();
  const trapMemoH = new Map();
  function trapScoreMachine(m, h) {
    const key = m * 1024 + h;
    const hit = trapMemoM.get(key);
    if (hit !== undefined) return hit;
    let best = -Infinity;
    for (const k of optimalMoves(m, h).moves) {
      const nm = m | bit(k);
      const s = holdsFifteen(nm) ? 1 : ((nm | h) & ALL) === ALL ? 0 : trapScoreHuman(nm, h);
      if (s > best) best = s;
    }
    if (best === -Infinity) best = 0;
    trapMemoM.set(key, best);
    return best;
  }
  function trapScoreHuman(m, h) {
    const key = m * 1024 + h;
    const hit = trapMemoH.get(key);
    if (hit !== undefined) return hit;
    const replies = carefulReplies(m, h);
    let s = 0;
    for (const k of replies) {
      const nh = h | bit(k);
      s += holdsFifteen(nh) ? -1 : ((m | nh) & ALL) === ALL ? 0 : trapScoreMachine(m, nh);
    }
    s /= replies.length;
    trapMemoH.set(key, s);
    return s;
  }

  // The machine's choice. rng() in [0,1) breaks exact ties; pass () => 0 for a fixed choice.
  function machineMove(machine, human, rng) {
    const r = rng || Math.random;
    const { moves } = optimalMoves(machine, human);
    if (!moves.length) return null;
    let best = -Infinity;
    let pool = [];
    for (const k of moves) {
      const nm = machine | bit(k);
      const s = holdsFifteen(nm) ? 2 : ((nm | human) & ALL) === ALL ? 0 : trapScoreHuman(nm, human);
      if (s > best + 1e-12) { best = s; pool = [k]; }
      else if (Math.abs(s - best) <= 1e-12) pool.push(k);
    }
    return pool[Math.min(pool.length - 1, Math.floor(r() * pool.length))];
  }

  // Where a game stands. first: 'you' | 'machine'.
  function fifteenStatus(you, machine) {
    const yt = winningTriple(you);
    if (yt) return { over: true, winner: 'you', triple: yt };
    const mt = winningTriple(machine);
    if (mt) return { over: true, winner: 'machine', triple: mt };
    if (((you | machine) & ALL) === ALL) return { over: true, winner: null, triple: null };
    return { over: false, winner: null, triple: null };
  }

  const LO_SHU = [2, 7, 6, 9, 5, 1, 4, 3, 8];

  const Fifteen = {
    ALL, bit, maskOf, numbersOf, TRIPLES, LINES, LO_SHU,
    winningTriple, holdsFifteen, tripleCounts, lineSums, isMagic,
    value, moveValue, optimalMoves, freeNumbers, machineMove, carefulReplies, status: fifteenStatus,
  };

  /* ------------------------------------------------------------------ */
  /* Knights                                                             */
  /* ------------------------------------------------------------------ */

  // Squares 0..8, index = rank * 3 + file, with rank 0 at the bottom (a1 is square 0, c3 is square 8).
  const FILES = 'abc';
  const SQUARES = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) SQUARES.push({ c, r, name: FILES[c] + (r + 1) });
  const KNIGHT_STEPS = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
  const NEIGHBOURS = SQUARES.map(({ c, r }) => {
    const out = [];
    for (const [dc, dr] of KNIGHT_STEPS) {
      const c2 = c + dc;
      const r2 = r + dr;
      if (c2 >= 0 && c2 < 3 && r2 >= 0 && r2 < 3) out.push(r2 * 3 + c2);
    }
    return out.sort((a, b) => a - b);
  });
  // Each knight move once, as a "string" between two squares.
  const EDGES = [];
  NEIGHBOURS.forEach((ns, i) => ns.forEach((j) => { if (i < j) EDGES.push([i, j]); }));

  // Walk the strings from a1 to list the ring in order.
  function ringOrder() {
    const start = 0;
    const order = [start];
    let prev = -1;
    let cur = start;
    for (;;) {
      const next = NEIGHBOURS[cur].find((n) => n !== prev);
      if (next === undefined || next === start) break;
      order.push(next);
      prev = cur;
      cur = next;
    }
    return order;
  }

  // A position is a 9-character string over '.', 'W', 'B'.
  const KNIGHT_START = posFrom({ W: ['a1', 'c1'], B: ['a3', 'c3'] });
  const TARGETS = {
    swap: posFrom({ W: ['a3', 'c3'], B: ['a1', 'c1'] }),
    diagonals: posFrom({ W: ['a1', 'c3'], B: ['c1', 'a3'] }),
  };
  function posFrom({ W, B }) {
    const cells = Array(9).fill('.');
    for (const n of W) cells[squareIndex(n)] = 'W';
    for (const n of B) cells[squareIndex(n)] = 'B';
    return cells.join('');
  }
  function squareIndex(name) {
    return SQUARES.findIndex((s) => s.name === name);
  }
  function knightMovesFrom(pos, from) {
    if (pos[from] === '.') return [];
    return NEIGHBOURS[from].filter((to) => pos[to] === '.');
  }
  function knightMove(pos, from, to) {
    if (!knightMovesFrom(pos, from).includes(to)) return null;
    const cells = pos.split('');
    cells[to] = cells[from];
    cells[from] = '.';
    return cells.join('');
  }
  // Breadth-first search over positions: distance to every reachable position.
  function knightDistances(start) {
    const dist = new Map([[start, 0]]);
    let frontier = [start];
    let d = 0;
    while (frontier.length) {
      d++;
      const next = [];
      for (const p of frontier) {
        for (let i = 0; i < 9; i++) {
          for (const j of knightMovesFrom(p, i)) {
            const q = knightMove(p, i, j);
            if (!dist.has(q)) { dist.set(q, d); next.push(q); }
          }
        }
      }
      frontier = next;
    }
    return dist;
  }
  // The colours of the knights read once round the ring, as the alphabetically first rotation
  // (so 'BBWW' means two of a colour together, 'BWBW' means they alternate).
  function ringColours(pos) {
    const seq = ringOrder().map((i) => pos[i]).filter((ch) => ch !== '.').join('');
    let best = seq;
    for (let k = 1; k < seq.length; k++) {
      const r = seq.slice(k) + seq.slice(0, k);
      if (r < best) best = r;
    }
    return best;
  }

  // Geometry of a drawing: which strings cross. pts[i] = {x, y} for square i.
  function orient(a, b, c) {
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  }
  function onSegment(a, b, p) {
    return Math.min(a.x, b.x) - 1e-9 <= p.x && p.x <= Math.max(a.x, b.x) + 1e-9 &&
      Math.min(a.y, b.y) - 1e-9 <= p.y && p.y <= Math.max(a.y, b.y) + 1e-9;
  }
  // True when segments ab and cd share a point (touching or collinear overlap counts).
  function segmentsMeet(a, b, c, d) {
    const eps = 1e-9;
    const o1 = orient(a, b, c);
    const o2 = orient(a, b, d);
    const o3 = orient(c, d, a);
    const o4 = orient(c, d, b);
    if (((o1 > eps && o2 < -eps) || (o1 < -eps && o2 > eps)) && ((o3 > eps && o4 < -eps) || (o3 < -eps && o4 > eps))) return true;
    if (Math.abs(o1) <= eps && onSegment(a, b, c)) return true;
    if (Math.abs(o2) <= eps && onSegment(a, b, d)) return true;
    if (Math.abs(o3) <= eps && onSegment(c, d, a)) return true;
    if (Math.abs(o4) <= eps && onSegment(c, d, b)) return true;
    return false;
  }
  function intersection(a, b, c, d) {
    const den = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x);
    if (Math.abs(den) < 1e-12) return { x: (a.x + b.x + c.x + d.x) / 4, y: (a.y + b.y + c.y + d.y) / 4 };
    const t = ((a.x - c.x) * (c.y - d.y) - (a.y - c.y) * (c.x - d.x)) / den;
    return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
  }
  // Pairs of strings (not sharing a square) that cross, with where they cross.
  function crossings(pts, edges) {
    const es = edges || EDGES;
    const out = [];
    for (let i = 0; i < es.length; i++) {
      for (let j = i + 1; j < es.length; j++) {
        const [a, b] = es[i];
        const [c, d] = es[j];
        if (a === c || a === d || b === c || b === d) continue;
        if (segmentsMeet(pts[a], pts[b], pts[c], pts[d])) {
          out.push({ e: i, f: j, at: intersection(pts[a], pts[b], pts[c], pts[d]) });
        }
      }
    }
    return out;
  }
  function distToSegment(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }
  // Strings that run underneath a button they don't belong to (radius r), and buttons that overlap.
  function clutter(pts, r, edges) {
    const es = edges || EDGES;
    const under = [];
    const overlaps = [];
    for (let k = 0; k < pts.length; k++) {
      es.forEach(([a, b], i) => {
        if (k === a || k === b) return;
        if (distToSegment(pts[k], pts[a], pts[b]) < r) under.push({ node: k, e: i });
      });
      for (let m = k + 1; m < pts.length; m++) {
        if (Math.hypot(pts[k].x - pts[m].x, pts[k].y - pts[m].y) < 2 * r) overlaps.push([k, m]);
      }
    }
    return { under, overlaps };
  }
  // Untangled: no string crosses another, no string runs under a foreign button, no buttons overlap.
  function isUntangled(pts, r, edges) {
    if (crossings(pts, edges).length) return false;
    const c = clutter(pts, r, edges);
    return !c.under.length && !c.overlaps.length;
  }

  const Knights = {
    SQUARES, NEIGHBOURS, EDGES, START: KNIGHT_START, TARGETS,
    ringOrder, squareIndex, posFrom, movesFrom: knightMovesFrom, move: knightMove,
    distances: knightDistances, ringColours,
    segmentsMeet, crossings, clutter, isUntangled, distToSegment,
  };

  /* ------------------------------------------------------------------ */
  /* Pocket                                                              */
  /* ------------------------------------------------------------------ */

  const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; };
  const lcm = (a, b) => (a / gcd(a, b)) * b;

  // Pockets: A bottom-left (where the ball starts), B bottom-right, C top-right, D top-left.
  // In the unfolded plane, the corner (X*m, Y*n) of the lattice of mirrored tables is a copy of
  // pocket A, B, C or D according to whether X and Y are even or odd.
  function cornerLabel(X, Y) {
    const xo = Math.abs(X) % 2 === 1;
    const yo = Math.abs(Y) % 2 === 1;
    return xo ? (yo ? 'C' : 'B') : (yo ? 'D' : 'A');
  }

  // The unfolded answer: the ball's path is the line y = x, which first meets a lattice corner at
  // (L, L) with L = lcm(m, n), after crossing L/m tables across and L/n tables up.
  function predict(m, n) {
    const L = lcm(m, n);
    const across = L / m;
    const up = L / n;
    return {
      L, across, up,
      pocket: cornerLabel(across, up),
      bounces: across + up - 2,
      length: L * Math.SQRT2,
    };
  }

  // The ball the hard way: bounce off the cushions one at a time (exact integer arithmetic).
  function simulate(m, n, maxBounces) {
    const cap = maxBounces == null ? 1e7 : maxBounces;
    let x = 0, y = 0, vx = 1, vy = 1;
    const points = [{ x, y }];
    const walls = [];
    let travelled = 0;
    for (let b = 0; b <= cap; b++) {
      const tx = vx > 0 ? m - x : x;
      const ty = vy > 0 ? n - y : y;
      const t = Math.min(tx, ty);
      x += vx * t;
      y += vy * t;
      travelled += t;
      points.push({ x, y });
      const atX = x === 0 || x === m;
      const atY = y === 0 || y === n;
      if (atX && atY) {
        const pocket = x === 0 ? (y === 0 ? 'A' : 'D') : (y === 0 ? 'B' : 'C');
        return { pocket, bounces: walls.length, points, walls, length: travelled * Math.SQRT2 };
      }
      if (atX) { vx = -vx; walls.push(x === 0 ? 'left' : 'right'); }
      if (atY) { vy = -vy; walls.push(y === 0 ? 'bottom' : 'top'); }
    }
    return null;
  }

  // The unfolding, one wall at a time: the copies of the table the straight line passes through,
  // in order, and the wall (shared edge) crossed to reach each new copy. steps[k].from is the copy
  // the line is in after k unfoldings; the line always leaves it through its right or top cushion.
  function unfoldSteps(m, n) {
    const { L } = predict(m, n);
    const steps = [];
    let i = 0, j = 0;
    // Crossings of vertical lines x = k*m and horizontal lines y = k*n along y = x, before L.
    let nextV = m, nextH = n;
    while (Math.min(nextV, nextH) < L) {
      if (nextV < nextH) { steps.push({ wall: 'v', at: nextV, from: [i, j], to: [i + 1, j] }); i++; nextV += m; }
      else { steps.push({ wall: 'h', at: nextH, from: [i, j], to: [i, j + 1] }); j++; nextH += n; }
    }
    return steps;
  }

  // Map a point (u, v) on the real table into copy (i, j) of the unfolded plane.
  function toCopy(m, n, i, j, u, v) {
    return {
      x: i * m + (i % 2 ? m - u : u),
      y: j * n + (j % 2 ? n - v : v),
    };
  }
  // ...and back: fold a point of the plane onto the real table.
  function fold(m, n, x, y) {
    const f = (t, s) => {
      const r = ((t % (2 * s)) + 2 * s) % (2 * s);
      return r <= s ? r : 2 * s - r;
    };
    return { x: f(x, m), y: f(y, n) };
  }

  // Does the straight line y = x (0 < t < L) pass through the inside of copy (i, j)?
  function lineEnters(m, n, i, j) {
    const { L } = predict(m, n);
    const lo = Math.max(i * m, j * n, 0);
    const hi = Math.min((i + 1) * m, (j + 1) * n, L);
    return hi > lo;
  }
  // The copy that folds out across one cushion of copy (i, j).
  const SIDES = ['left', 'right', 'bottom', 'top'];
  function neighbour(i, j, side) {
    return side === 'left' ? [i - 1, j] : side === 'right' ? [i + 1, j] : side === 'bottom' ? [i, j - 1] : [i, j + 1];
  }
  // The reader has unfolded k cushions and taps one cushion of the newest copy. Which kind of tap is it?
  //   next  - the cushion the straight line reaches next: unfold across it
  //   entry - the cushion the line came in through: the copy behind it is already there
  //   miss  - any other cushion: the copy across it is one the line never enters
  // Returns null once the line has reached its corner (nothing left to unfold).
  function cushionChoice(m, n, k, side) {
    const steps = unfoldSteps(m, n);
    if (k >= steps.length) return null;
    const cur = steps[k].from;
    const to = neighbour(cur[0], cur[1], side);
    const wall = side === 'left' || side === 'right' ? 'v' : 'h';
    const at = side === 'left' ? cur[0] * m : side === 'right' ? (cur[0] + 1) * m : side === 'bottom' ? cur[1] * n : (cur[1] + 1) * n;
    const next = steps[k].wall === 'v' ? 'right' : 'top';
    if (side === next) return { kind: 'next', from: cur, to, wall, at };
    const prev = k > 0 ? steps[k - 1].from : null;
    if (prev && prev[0] === to[0] && prev[1] === to[1]) return { kind: 'entry', from: cur, to, wall, at };
    return { kind: 'miss', from: cur, to, wall, at };
  }

  const Pocket = { gcd, lcm, cornerLabel, predict, simulate, unfoldSteps, toCopy, fold, lineEnters, SIDES, neighbour, cushionChoice };

  return { Fifteen, Knights, Pocket };
});
