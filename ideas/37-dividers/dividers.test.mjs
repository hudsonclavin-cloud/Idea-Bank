// Checks for Dividers: the rules, the solver, every level, and the numbers in the README.
// Run from the repo root: node --test ideas/37-dividers/dividers.test.mjs
//
// The solver (solver.js) is a breadth-first search over (leg A, leg B, pricked marks).
// To avoid trusting it with its own report card, this file also carries an
// independent, deliberately plain implementation of the rules and a second search,
// and compares the two on every level.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const R = require('./rules.js');
const S = require('./solver.js');
const LEVELS = require('./levels.js');
const here = (p) => new URL(p, import.meta.url);
const README = fs.readFileSync(here('./README.md'), 'utf8');

const parsed = LEVELS.map((def) => R.parse(def));
const analyses = parsed.map((L) => S.solve(L));
const LESSONS = 9; // levels 1..9 teach; 10 onward are the puzzles proper

/* ------------------------------------------------------------------ */
/* An independent reading of the rules, written without rules.js.      */
/* ------------------------------------------------------------------ */
function indep(def) {
  const rows = def.rows;
  const h = rows.length;
  const w = rows[0].length;
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? '#' : rows[y][x]);
  const marks = [];
  let A = null;
  let B = null;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rows[y][x] === '*') marks.push(x + ',' + y);
      if (rows[y][x] === 'A') A = [x, y];
      if (rows[y][x] === 'B') B = [x, y];
    }
  }
  // A state is "ax,ay|bx,by|sorted pricked marks". Moves: for each leg, with the
  // other as pivot, the two perpendicular landing cells; the landing cell must be
  // floor or a mark, and the cell diagonal to the pivot between old and new
  // position must not be a pin (off-sheet counts as pin).
  const successors = (ax, ay, bx, by, pricked) => {
    const out = [];
    for (const [legIsA, [px, py], [fx, fy]] of [
      [true, [bx, by], [ax, ay]],
      [false, [ax, ay], [bx, by]],
    ]) {
      const dx = fx - px;
      const dy = fy - py;
      for (const [ex, ey] of [
        [-dy, dx],
        [dy, -dx],
      ]) {
        const tx = px + ex;
        const ty = py + ey;
        const land = at(tx, ty);
        if (land !== '.' && land !== '*' && land !== 'A' && land !== 'B') continue;
        if (at(px + dx + ex, py + dy + ey) === '#') continue;
        const np = land === '*' && !pricked.includes(tx + ',' + ty) ? [...pricked, tx + ',' + ty].sort() : pricked;
        out.push(legIsA ? [tx, ty, bx, by, np] : [ax, ay, tx, ty, np]);
      }
    }
    return out;
  };
  const keyOf = (s) => `${s[0]},${s[1]}|${s[2]},${s[3]}|${s[4].join(';')}`;
  const start = [A[0], A[1], B[0], B[1], []];
  const dist = new Map([[keyOf(start), 0]]);
  const ways = new Map([[keyOf(start), 1]]);
  let frontier = [start];
  let d = 0;
  let best = -1;
  let solutions = 0;
  let within = 0;
  while (frontier.length) {
    within += frontier.length;
    const next = [];
    for (const s of frontier) {
      if (s[4].length === marks.length) {
        if (best < 0) best = d;
        if (d === best) solutions += ways.get(keyOf(s));
      }
      if (best >= 0) continue;
      for (const t of successors(...s)) {
        const k = keyOf(t);
        if (!dist.has(k)) {
          dist.set(k, d + 1);
          ways.set(k, ways.get(keyOf(s)));
          next.push(t);
        } else if (dist.get(k) === d + 1) ways.set(k, ways.get(k) + ways.get(keyOf(s)));
      }
    }
    if (best >= 0) break;
    frontier = next;
    d++;
  }
  // count every reachable state separately (the loop above stops at the goal depth)
  const seen = new Set([keyOf(start)]);
  const stack = [start];
  while (stack.length) {
    const s = stack.pop();
    for (const t of successors(...s)) {
      const k = keyOf(t);
      if (!seen.has(k)) {
        seen.add(k);
        stack.push(t);
      }
    }
  }
  return { moves: best, solutions, within, reachable: seen.size, marks: marks.length, w, h };
}

/* ------------------------------------------------------------------ */
/* README table                                                         */
/* ------------------------------------------------------------------ */
function readmeTable() {
  const rows = [];
  for (const line of README.split('\n')) {
    const m = line.match(/^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*(\d+)×(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*([\d.]+)\s*\|/);
    if (m) {
      rows.push({
        no: +m[1],
        name: m[2],
        w: +m[3],
        h: +m[4],
        marks: +m[5],
        par: +m[6],
        solutions: +m[7],
        explored: +m[8],
        reachable: +m[9],
        difficulty: +m[10],
      });
    }
  }
  return rows;
}

/* ------------------------------------------------------------------ */
test('level definitions are well formed and distinct', () => {
  assert.equal(LEVELS.length, 15);
  const names = new Set();
  for (const [i, def] of LEVELS.entries()) {
    assert.ok(def.name && def.hint, `level ${i + 1} has a name and a hint`);
    assert.ok(!names.has(def.name), `duplicate name ${def.name}`);
    names.add(def.name);
    const L = parsed[i];
    assert.ok(L.w <= 9 && L.h <= 8, `level ${i + 1} fits a phone (${L.w}×${L.h})`);
    assert.ok(L.marks.length >= 1 && L.marks.length <= 5);
    const [ax, ay] = R.xy(L, L.start.a);
    const [bx, by] = R.xy(L, L.start.b);
    assert.equal(Math.abs(ax - bx) + Math.abs(ay - by), 1, 'legs start adjacent');
    assert.equal(R.initialState(L).mask, 0, 'no mark is pricked for free at the start');
  }
});

test('the rules: a quarter turn keeps each leg on its own checkerboard colour (algebra)', () => {
  // Landing = pivot + d'; old = pivot + d. For every direction d and both turns,
  // d' - d has two odd components, so x+y changes by an even number.
  for (const [dx, dy] of [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ]) {
    for (const turn of ['cw', 'ccw']) {
      const [ex, ey] = R.rotate(dx, dy, turn);
      assert.equal(Math.abs(ex) + Math.abs(ey), 1, 'still a unit step');
      assert.equal((ex - dx) % 2 !== 0 && (ey - dy) % 2 !== 0, true, 'both components of the change are odd');
      assert.equal(Math.abs(ex + ey - (dx + dy)) % 2, 0, 'parity of x+y preserved');
    }
  }
});

test('every reachable state of every level keeps the parity invariant (brute force)', () => {
  for (const [i, L] of parsed.entries()) {
    const pa = R.parity(L, L.start.a);
    const pb = R.parity(L, L.start.b);
    assert.notEqual(pa, pb);
    const states = S.reachableStates(L);
    assert.equal(states.length, analyses[i].reachable);
    for (const s of states) {
      assert.equal(R.parity(L, s.a), pa, `level ${i + 1}: coral leg left its colour`);
      assert.equal(R.parity(L, s.b), pb, `level ${i + 1}: blue leg left its colour`);
      assert.notEqual(s.a, s.b);
    }
  }
});

test('every move can be swung back, so the player can never get stuck', () => {
  for (const [i, L] of parsed.entries()) {
    for (const s of S.reachableStates(L)) {
      for (const m of R.moves(L, s)) {
        const t = R.apply(L, s, m);
        const back = R.inverse(m);
        const legal = R.findMove(L, t, back.leg, back.turn);
        assert.ok(legal && legal.to === back.to, `level ${i + 1}: move not reversible`);
        const u = R.apply(L, t, legal);
        assert.equal(u.a, s.a);
        assert.equal(u.b, s.b);
      }
      // and therefore the goal is reachable from everywhere the player can wander
      assert.ok(S.distanceToGoal(L, s) >= 0, `level ${i + 1}: a reachable state cannot reach the goal`);
    }
  }
});

test('every level is solvable in more than zero moves, and the engine agrees with the solver', () => {
  for (const [i, L] of parsed.entries()) {
    const a = analyses[i];
    assert.ok(a.solvable, `level ${i + 1} unsolvable`);
    assert.ok(a.moves >= 2, `level ${i + 1} is trivial`);
    assert.equal(a.path.length, a.moves);
    // replay the solver's solution through the rules engine, move by move
    let s = R.initialState(L);
    for (const [k, m] of a.path.entries()) {
      assert.ok(!R.isSolved(L, s), `level ${i + 1}: solved before the last move`);
      const legal = R.findMove(L, s, m.leg, m.turn);
      assert.ok(legal, `level ${i + 1}: move ${k} is illegal in the engine`);
      assert.equal(legal.to, m.to);
      assert.equal(legal.sweep, m.sweep);
      s = R.apply(L, s, legal);
    }
    assert.ok(R.isSolved(L, s), `level ${i + 1}: solver path does not win`);
    assert.equal(S.walk(L, a.path).mask, R.fullMask(L));
  }
});

test('an independent search agrees with the solver on par, solution count and state counts', () => {
  for (const [i, def] of LEVELS.entries()) {
    const a = analyses[i];
    const b = indep(def);
    assert.equal(b.moves, a.moves, `level ${i + 1} par`);
    assert.equal(b.solutions, a.solutions, `level ${i + 1} par solutions`);
    assert.equal(b.within, a.explored, `level ${i + 1} states within par`);
    assert.equal(b.reachable, a.reachable, `level ${i + 1} reachable states`);
    assert.equal(b.marks, parsed[i].marks.length);
  }
});

test('the README table matches the solver exactly', () => {
  const rows = readmeTable();
  assert.equal(rows.length, LEVELS.length, 'README table has one row per level');
  for (const [i, row] of rows.entries()) {
    const a = analyses[i];
    const L = parsed[i];
    assert.equal(row.no, i + 1);
    assert.equal(row.name, LEVELS[i].name);
    assert.equal(row.w, L.w);
    assert.equal(row.h, L.h);
    assert.equal(row.marks, L.marks.length);
    assert.equal(row.par, a.moves, `level ${i + 1} par`);
    assert.equal(row.solutions, a.solutions, `level ${i + 1} solutions`);
    assert.equal(row.explored, a.explored, `level ${i + 1} states within par`);
    assert.equal(row.reachable, a.reachable, `level ${i + 1} reachable`);
    assert.equal(row.difficulty, +S.difficulty(a).toFixed(1), `level ${i + 1} difficulty`);
  }
});

test('difficulty rises through the puzzles; the lessons are deliberate breathers', () => {
  const diff = analyses.map((a) => S.difficulty(a));
  const par = analyses.map((a) => a.moves);
  // Lessons: short, and strictly easier than every puzzle.
  for (let i = 0; i < LESSONS; i++) {
    assert.ok(par[i] <= 13, `lesson ${i + 1} par ${par[i]}`);
    assert.ok(diff[i] <= 14, `lesson ${i + 1} difficulty ${diff[i]}`);
  }
  const lessonMax = Math.max(...diff.slice(0, LESSONS));
  const puzzleMin = Math.min(...diff.slice(LESSONS));
  assert.ok(lessonMax < puzzleMin, `lessons (max ${lessonMax}) below puzzles (min ${puzzleMin})`);
  // Puzzles: par and difficulty strictly increase, and at most two par solutions.
  for (let i = LESSONS; i + 1 < LEVELS.length; i++) {
    assert.ok(par[i] < par[i + 1], `par rises from level ${i + 1} to ${i + 2}`);
    assert.ok(diff[i] < diff[i + 1], `difficulty rises from level ${i + 1} to ${i + 2}`);
  }
  for (let i = LESSONS; i < LEVELS.length; i++) assert.ok(analyses[i].solutions <= 2, `level ${i + 1} has ${analyses[i].solutions} par solutions`);
  // The deliberate breathers among the lessons, by name.
  const breathers = ['Hop', 'Corner', 'Nook'];
  for (const name of breathers) {
    const i = LEVELS.findIndex((l) => l.name === name);
    assert.ok(par[i] <= 3, `${name} is a breather`);
  }
});

test('in the puzzles every pin and hole is load-bearing', () => {
  // Removing any one obstacle (or softening a pin to a hole) changes par or
  // adds par solutions.
  for (let i = LESSONS; i < LEVELS.length; i++) {
    const base = analyses[i];
    const rows = LEVELS[i].rows.map((r) => r.split(''));
    for (let y = 0; y < rows.length; y++) {
      for (let x = 0; x < rows[0].length; x++) {
        const c = rows[y][x];
        if (c !== '#' && c !== 'o') continue;
        for (const repl of c === '#' ? ['.', 'o'] : ['.']) {
          const g = rows.map((r) => r.slice());
          g[y][x] = repl;
          const a = S.solve(R.parse({ rows: g.map((r) => r.join('')) }));
          const same = a.solvable && a.moves === base.moves && a.solutions <= base.solutions;
          assert.ok(!same, `level ${i + 1}: the ${c === '#' ? 'pin' : 'hole'} at ${x},${y} could be ${repl === '.' ? 'removed' : 'softened'} without changing the puzzle`);
        }
      }
    }
  }
});

test('swinging only one leg solves nothing but Hop and Corner', () => {
  // The stick spins in place and reaches four cells at most. The exceptions are
  // Hop and Corner, whose lessons are one leg swinging round the other.
  const oneLeg = [];
  for (const [i, L] of parsed.entries()) {
    for (const leg of ['a', 'b']) {
      const seen = new Set();
      let frontier = [R.initialState(L)];
      let solved = false;
      while (frontier.length && !solved) {
        const next = [];
        for (const s of frontier) {
          for (const m of R.moves(L, s).filter((m) => m.leg === leg)) {
            const t = R.apply(L, s, m);
            const k = R.key(L, t);
            if (seen.has(k)) continue;
            seen.add(k);
            if (R.isSolved(L, t)) solved = true;
            next.push(t);
          }
        }
        frontier = next;
      }
      if (solved && !oneLeg.includes(LEVELS[i].name)) oneLeg.push(LEVELS[i].name);
    }
  }
  assert.deepEqual(oneLeg, ['Hop', 'Corner']);
});

/* ------------------------------------------------------------------ */
/* Greedy players. Choose the swing whose landing cell is nearest to the */
/* nearest unpricked mark; ties go to the first move in `order`; give up */
/* after 4×par. With `guard`, only swings into positions not yet visited */
/* are considered, whenever there is at least one.                       */
/* ------------------------------------------------------------------ */
const METRICS = {
  euclidean: (dx, dy) => Math.hypot(dx, dy),
  manhattan: (dx, dy) => Math.abs(dx) + Math.abs(dy),
  chebyshev: (dx, dy) => Math.max(Math.abs(dx), Math.abs(dy)),
};
const ENGINE_ORDER = ['a-ccw', 'a-cw', 'b-ccw', 'b-cw']; // the order rules.moves lists them in
function permutations(xs) {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
}
function greedy(i, { metric = 'euclidean', order = ENGINE_ORDER, guard = false } = {}) {
  const L = parsed[i];
  const par = analyses[i].moves;
  let s = R.initialState(L);
  const seen = new Set([R.key(L, s)]);
  let n = 0;
  let firstRevisit = -1;
  while (!R.isSolved(L, s) && n < 4 * par) {
    const todo = L.marks.filter((c, bit) => !((s.mask >> bit) & 1));
    const ms = R.moves(L, s).sort((x, y) => order.indexOf(`${x.leg}-${x.turn}`) - order.indexOf(`${y.leg}-${y.turn}`));
    const fresh = ms.filter((m) => !seen.has(R.key(L, R.apply(L, s, m))));
    const pool = guard && fresh.length ? fresh : ms;
    let best = null;
    let bestD = Infinity;
    for (const m of pool) {
      const [tx, ty] = R.xy(L, m.to);
      for (const c of todo) {
        const [mx, my] = R.xy(L, c);
        const d = METRICS[metric](tx - mx, ty - my);
        if (d < bestD) {
          bestD = d;
          best = m;
        }
      }
    }
    s = R.apply(L, s, best);
    n++;
    const k = R.key(L, s);
    if (firstRevisit < 0 && seen.has(k)) firstRevisit = n;
    seen.add(k);
  }
  return { solved: R.isSolved(L, s), n, par, firstRevisit };
}
const PUZZLES = LEVELS.map((l, i) => i).filter((i) => i >= LESSONS);

test('a memoryless greedy player fails the puzzles by going round in circles, not because they are hard', () => {
  const runs = LEVELS.map((l, i) => greedy(i));
  const atPar = runs.map((r, i) => (r.solved && r.n <= r.par ? i + 1 : 0)).filter(Boolean);
  assert.deepEqual(atPar, [1, 2, 3, 4, 7, 8], 'memoryless greedy reaches par on these levels');
  assert.match(README, new RegExp(`reaches par on ${atPar.length} of the 15 levels, all of them lessons`));
  const revisits = [];
  for (const i of PUZZLES) {
    assert.ok(!runs[i].solved, `memoryless greedy finishes ${LEVELS[i].name}`);
    // Its choice depends only on the position, so the first repeated position
    // starts a cycle it never leaves. On every puzzle that happens before par.
    assert.ok(runs[i].firstRevisit > 0 && runs[i].firstRevisit < runs[i].par, `${LEVELS[i].name}: first revisit ${runs[i].firstRevisit}`);
    revisits.push(runs[i].firstRevisit);
  }
  assert.match(README, new RegExp(`within the first ${Math.min(...revisits)} to ${Math.max(...revisits)} moves, after which it cycles for good`));
});

test('a greedy player that avoids revisiting positions finishes most puzzles, sometimes in par', () => {
  // Engine move order, straight-line distance, plus the no-revisit rule.
  const guarded = PUZZLES.map((i) => ({ i, ...greedy(i, { guard: true }) }));
  const finished = guarded.filter((r) => r.solved);
  const missed = guarded.filter((r) => !r.solved).map((r) => LEVELS[r.i].name);
  const worst = Math.max(...finished.map((r) => r.n / r.par));
  assert.equal(finished.length, 5);
  assert.deepEqual(missed, ['Meadow']);
  assert.ok(worst <= 1.6, `worst finish ${worst.toFixed(2)}×par`);
  assert.match(README, new RegExp(`finishes ${finished.length} of the 6 puzzles within 1\\.6 times par \\(all but ${missed[0]}\\)`));
  // 72 variants: three distance measures × 24 tie-break orders, all with the rule.
  const orders = permutations(ENGINE_ORDER);
  assert.equal(orders.length * Object.keys(METRICS).length, 72);
  const parHits = {};
  for (const i of PUZZLES) {
    parHits[LEVELS[i].name] = 0;
    for (const metric of Object.keys(METRICS)) {
      for (const order of orders) {
        const r = greedy(i, { metric, order, guard: true });
        if (r.solved && r.n === r.par) parHits[LEVELS[i].name]++;
      }
    }
  }
  assert.deepEqual(parHits, { Garden: 24, Islands: 4, Meadow: 0, 'Lily pads': 0, Pond: 0, 'Star chart': 3 });
  assert.match(README, /hit par exactly on Garden \(24 of 72\), Islands \(4\) and Star chart \(3\); none hits par on Meadow, Lily pads or Pond/);
  // So the README must not offer greedy failure as evidence that the puzzles are hard.
  assert.doesNotMatch(README, /greedy play never finishes them/);
});

// Every shortest solution of a level, as arrays of moves (small levels only).
function allParSolutions(L, a) {
  const out = [];
  const walkFrom = (s, path) => {
    if (path.length === a.moves) {
      if (R.isSolved(L, s)) out.push(path.slice());
      return;
    }
    for (const m of R.moves(L, s)) {
      const t = R.apply(L, s, m);
      const d = S.distanceToGoal(L, t);
      if (d < 0 || path.length + 1 + d > a.moves) continue;
      path.push(m);
      walkFrom(t, path);
      path.pop();
    }
  };
  walkFrom(R.initialState(L), []);
  return out;
}

test('each lesson level teaches what its hint says', () => {
  const byName = (n) => {
    const i = LEVELS.findIndex((l) => l.name === n);
    return [parsed[i], analyses[i], LEVELS[i]];
  };
  const solveRows = (rows) => S.solve(R.parse({ rows }));
  // Swing: both legs swing once.
  {
    const [, a] = byName('Swing');
    assert.deepEqual(a.path.map((m) => m.leg).sort(), ['a', 'b']);
  }
  // Hop: the mark is next to the blue leg, blue can never land there, coral does it in two swings round blue.
  {
    const [L, a] = byName('Hop');
    const mark = L.marks[0];
    const [mx, my] = R.xy(L, mark);
    const [bx, by] = R.xy(L, L.start.b);
    assert.equal(Math.abs(mx - bx) + Math.abs(my - by), 1, 'mark is beside blue');
    assert.equal(R.parity(L, mark), R.parity(L, L.start.a), 'mark is on coral’s colour');
    assert.ok(a.path.every((m) => m.leg === 'a' && m.pivot === L.start.b));
  }
  // Corner: with the pin gone, par drops from 3 to 1.
  {
    const [, a, def] = byName('Corner');
    assert.equal(a.moves, 3);
    assert.equal(solveRows(def.rows.map((r) => r.replace('#', '.'))).moves, 1);
  }
  // Hollow: the par solution swings over the hole; a pin there instead costs more moves.
  {
    const [L, a, def] = byName('Hollow');
    const hole = [...L.cells].findIndex((c) => c === R.HOLE);
    assert.ok(a.path.some((m) => m.sweep === hole), 'a swing passes over the hole');
    assert.ok(solveRows(def.rows.map((r) => r.replace('o', '#'))).moves > a.moves);
  }
  // Gap: the wall has a one-wide gap in it, and the gap is as good as a wall. No leg
  // can ever stand in it (the corners either side are pins), so pinning it shut
  // changes nothing. The way round is the two-wide passage below the wall:
  // narrowing that to one wide makes the level unsolvable, and removing the pin
  // under the gap opens a wide way through and shortens the route.
  {
    const [L, a, def] = byName('Gap');
    const at = (x, y) => R.cellAt(L, x, y);
    const gaps = [];
    for (let y = 0; y < L.h; y++) {
      for (let x = 0; x < L.w; x++) {
        if (at(x, y) !== R.FLOOR) continue;
        const pinnedV = at(x, y - 1) === R.PIN && at(x, y + 1) === R.PIN && at(x - 1, y) === R.FLOOR && at(x + 1, y) === R.FLOOR;
        const pinnedH = at(x - 1, y) === R.PIN && at(x + 1, y) === R.PIN && at(x, y - 1) === R.FLOOR && at(x, y + 1) === R.FLOOR;
        if (pinnedV || pinnedH) gaps.push([x, y]);
      }
    }
    assert.ok(gaps.length >= 1, 'the board shows a one-wide gap');
    const states = S.reachableStates(L);
    for (const [x, y] of gaps) {
      const i = y * L.w + x;
      assert.ok(states.every((s) => s.a !== i && s.b !== i), `a leg can stand in the gap at ${x},${y}`);
      const shut = def.rows.map((r, j) => (j === y ? r.slice(0, x) + '#' + r.slice(x + 1) : r));
      const b = solveRows(shut);
      assert.deepEqual([b.moves, b.solutions, b.reachable], [a.moves, a.solutions, a.reachable], 'pinning the gap shut changes nothing');
    }
    const [wx] = gaps[0];
    const setCell = (rows, x, y, ch) => rows.map((r, j) => (j === y ? r.slice(0, x) + ch + r.slice(x + 1) : r));
    // the passage round the wall: the floor cells in the gap's column below the last pin
    const lastPin = Math.max(...def.rows.map((r, y) => (r[wx] === '#' ? y : -1)));
    const passage = [];
    for (let y = lastPin + 1; y < L.h; y++) passage.push(y);
    assert.equal(passage.length, 2, 'the way round is two wide');
    assert.equal(solveRows(setCell(def.rows, wx, passage[0], '#')).solvable, false, 'a one-wide way round is no way round');
    assert.ok(solveRows(setCell(def.rows, wx, lastPin, '.')).moves < a.moves, 'removing the pin under the gap shortens the route');
  }
  // Nook: pins beside the mark instead of holes make it unreachable.
  {
    const [, , def] = byName('Nook');
    assert.equal(solveRows(def.rows.map((r) => r.replace(/o/g, '#'))).solvable, false);
  }
  // Rosette: the hub (the square beside all four marks) is on coral's colour, so
  // only coral can stand there. Every par solution plants coral on the hub and
  // swings blue round it for at least two of the marks; the README says how many
  // finish with three swings round it.
  {
    const [L, a] = byName('Rosette');
    const near = (i, j) => {
      const [x1, y1] = R.xy(L, i);
      const [x2, y2] = R.xy(L, j);
      return Math.abs(x1 - x2) + Math.abs(y1 - y2) === 1;
    };
    const hubs = [...L.cells.keys()].filter((i) => L.cells[i] === R.FLOOR && L.marks.every((c) => near(c, i)));
    assert.equal(hubs.length, 1);
    const hub = hubs[0];
    assert.equal(R.parity(L, hub), R.parity(L, L.start.a), 'only coral can stand on the hub');
    const all = allParSolutions(L, a);
    assert.equal(all.length, a.solutions, 'enumeration finds every par solution');
    let lastThree = 0;
    for (const path of all) {
      assert.ok(path.some((m) => m.leg === 'a' && m.to === hub), 'coral stands on the hub');
      let s = R.initialState(L);
      let round = 0;
      for (const m of path) {
        const t = R.apply(L, s, m);
        if (t.mask !== s.mask && m.pivot === hub) round++;
        s = t;
      }
      assert.ok(round >= 2, 'at least two marks pricked round the hub');
      if (path.slice(-3).every((m) => m.pivot === hub)) lastThree++;
    }
    assert.match(README, new RegExp(`${lastThree} of its ${all.length} par solutions`));
    assert.ok(lastThree < all.length, 'not every par solution ends with three swings round the hub');
  }
  // Stair: most of the par solution swings over holes.
  {
    const [L, a] = byName('Stair');
    const over = a.path.filter((m) => L.cells[m.sweep] === R.HOLE).length;
    assert.ok(over >= 4, `${over} swings pass over holes`);
  }
});

test('the page wires the modules in order and declares a viewport', () => {
  const html = fs.readFileSync(here('./index.html'), 'utf8');
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1/);
  const order = ['rules.js', 'levels.js', 'solver.js', 'progress.js', 'game.js'].map((f) => html.indexOf(`src="${f}"`));
  assert.ok(order.every((p, i) => p >= 0 && (i === 0 || p > order[i - 1])), 'scripts load in dependency order');
  const game = fs.readFileSync(here('./game.js'), 'utf8');
  for (const fn of ['parse', 'initialState', 'moves', 'apply', 'isSolved', 'findMove', 'parity', 'xy', 'rotate', 'cellAt']) {
    assert.ok(game.includes(`R.${fn}(`), `game.js uses rules.${fn}`);
    assert.equal(typeof R[fn], 'function');
  }
  assert.ok(game.includes('SOLVER.solve('), 'the page computes par with the solver');
  assert.ok(/try\s*\{[^}]*localStorage/.test(game), 'localStorage access is wrapped in try/catch');
});

test('every count a hint states is true of its level', () => {
  const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const TENS = { twenty: 20, thirty: 30, forty: 40 };
  const value = (w) => {
    w = w.toLowerCase();
    if (ONES.includes(w)) return ONES.indexOf(w);
    const [t, o] = w.split('-');
    return t in TENS ? TENS[t] + (o ? ONES.indexOf(o) : 0) : NaN;
  };
  let checked = 0;
  for (const [i, def] of LEVELS.entries()) {
    const count = (ch) => def.rows.join('').split(ch).length - 1;
    const truth = { mark: count('*'), hole: count('o'), pin: count('#'), swing: analyses[i].moves, 'par line': analyses[i].solutions };
    for (const m of def.hint.matchAll(/\b([a-z]+(?:-[a-z]+)?) (marks?|holes?|pins?|swings?|par lines?)\b/gi)) {
      const n = value(m[1]);
      if (Number.isNaN(n)) continue;
      const what = m[2].toLowerCase().replace(/s$/, '');
      assert.equal(n, truth[what], `${def.name}: the hint says "${m[0]}"`);
      checked++;
    }
    // A hint that talks about pins or holes is on a level that has them.
    if (/\bpins?\b/i.test(def.hint)) assert.ok(truth.pin > 0, `${def.name}: the hint mentions a pin but there is none`);
    if (/\bholes?\b/i.test(def.hint)) assert.ok(truth.hole > 0, `${def.name}: the hint mentions a hole but there is none`);
  }
  assert.ok(checked >= 5, `${checked} counted claims checked`);
});

test('the README prose agrees with the levels', () => {
  // The lesson list names one lesson per lesson level, in play order.
  const list = README.match(/The first nine each teach one thing \(([^)]*)\)/);
  assert.ok(list, 'README lists the lessons');
  const items = list[1].split(';').map((t) => t.trim());
  assert.equal(items.length, LESSONS, 'one lesson per lesson level');
  const cue = { Swing: /either leg/, Hop: /hop/, Walk: /alternat/, Corner: /pin in the corner/, Hollow: /hole stops landing/, Gap: /one-wide gap/, Nook: /nook/, Rosette: /four marks round one square/, Stair: /staircase/ };
  for (let i = 0; i < LESSONS; i++) assert.match(items[i], cue[LEVELS[i].name], `lesson ${i + 1} (${LEVELS[i].name}) is item ${i + 1}`);
  // Which puzzles make you share the marks out between the legs: the ones with marks on both colours.
  const split = [];
  for (let i = LESSONS; i < LEVELS.length; i++) {
    const L = parsed[i];
    const coral = L.marks.filter((c) => R.parity(L, c) === R.parity(L, L.start.a)).length;
    if (coral > 0 && coral < L.marks.length) split.push(LEVELS[i].name);
  }
  assert.deepEqual(split, ['Islands', 'Star chart']);
  assert.match(README, new RegExp(`only ${split.join(' and ')} split the marks between the legs`));
  // "States within par" is every state at most par moves from the start, as solver.js counts it.
  assert.match(README, /every position a player can be in after at most par moves, whether or not par is still reachable from it/);
  // The test count the README gives is this file's.
  const own = fs.readFileSync(new URL(import.meta.url), 'utf8').match(/^test\(/gm).length;
  assert.match(README, new RegExp(`\\(\`dividers\\.test\\.mjs\`, ${own} tests\\)`));
});

test('stored progress is cleaned before the page uses it', () => {
  const P = require('./progress.js');
  const n = LEVELS.length;
  assert.deepEqual(P.clean(null, n), P.defaults());
  assert.deepEqual(P.clean('not json', n), P.defaults());
  assert.deepEqual(P.clean('{"best":{"0":"x"}}', n).best, {}, 'a string is not a move count');
  assert.deepEqual(P.clean('{"best":{"0":"<img src=x onerror=alert(1)>"}}', n).best, {}, 'markup is dropped');
  const p = P.clean(JSON.stringify({ best: { 0: 3, 1: -2, 2: 2.5, 3: '3', 4: 7, 99: 4, foo: 1, '07': 5 }, sound: 'yes', level: 2 }), n);
  assert.deepEqual(p, { best: { 0: 3, 4: 7 }, sound: true, level: 2 });
  assert.deepEqual(P.clean({ best: { 14: 30 }, sound: false, level: 15 }, n), { best: { 14: 30 }, sound: false, level: 0 });
  // The page reads progress through progress.js and never writes stored values as HTML.
  const game = fs.readFileSync(here('./game.js'), 'utf8');
  assert.ok(game.includes('PROGRESS.clean('), 'game.js cleans stored progress');
  assert.doesNotMatch(game, /innerHTML\s*=\s*`[^`]*\$\{/, 'no interpolated innerHTML');
});
