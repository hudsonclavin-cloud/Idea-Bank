// Checks for Dividers: the rules, the solver, every level, and the numbers in the README.
// Run from the repo root: node --test ideas/17-dividers/dividers.test.mjs
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

test('degenerate strategies do not work', () => {
  // 1. Swinging only one leg: the stick spins in place and reaches four cells at most.
  //    The exceptions are Hop and Corner, whose lessons are one leg swinging round the other.
  for (const [i, L] of parsed.entries()) {
    if (LEVELS[i].name === 'Hop' || LEVELS[i].name === 'Corner') continue;
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
      assert.ok(!solved, `level ${i + 1} solvable by swinging only leg ${leg}`);
    }
  }
  // 2. Greedy play: always take the move whose landing cell is nearest (as the crow
  //    flies) to the nearest unpricked mark, ties by move order; give up after 4×par.
  const greedyWins = [];
  const greedyFinishes = [];
  for (const [i, L] of parsed.entries()) {
    let s = R.initialState(L);
    let n = 0;
    const limit = 4 * analyses[i].moves;
    while (!R.isSolved(L, s) && n < limit) {
      const todo = L.marks.filter((c, bit) => !((s.mask >> bit) & 1));
      let best = null;
      let bestD = Infinity;
      for (const m of R.moves(L, s)) {
        const [tx, ty] = R.xy(L, m.to);
        for (const c of todo) {
          const [mx, my] = R.xy(L, c);
          const d = Math.hypot(tx - mx, ty - my);
          if (d < bestD) {
            bestD = d;
            best = m;
          }
        }
      }
      s = R.apply(L, s, best);
      n++;
    }
    if (R.isSolved(L, s)) greedyFinishes.push(i + 1);
    if (R.isSolved(L, s) && n <= analyses[i].moves) greedyWins.push(i + 1);
  }
  assert.ok(greedyWins.every((n) => n <= LESSONS), `greedy reaches par on puzzle levels ${greedyWins.filter((n) => n > LESSONS)}`);
  assert.ok(greedyFinishes.every((n) => n <= LESSONS), `greedy finishes puzzle levels ${greedyFinishes.filter((n) => n > LESSONS)}`);
  assert.match(README, new RegExp(`reaches par on ${greedyWins.length} of the 15 levels`), 'README states the greedy result');
});

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
  // Gap: widening the one-wide gap to two cells shortens the route.
  {
    const [, a, def] = byName('Gap');
    const rows = def.rows.slice();
    rows[2] = rows[2].replace('#', '.');
    assert.ok(solveRows(rows).moves < a.moves);
  }
  // Nook: pins beside the mark instead of holes make it unreachable.
  {
    const [, , def] = byName('Nook');
    assert.equal(solveRows(def.rows.map((r) => r.replace(/o/g, '#'))).solvable, false);
  }
  // Rosette: the last three swings share one pivot, the hub in the middle of the four marks.
  {
    const [L, a] = byName('Rosette');
    const last = a.path.slice(-3);
    assert.ok(last.every((m) => m.pivot === last[0].pivot));
    const [hx, hy] = R.xy(L, last[0].pivot);
    for (const c of L.marks) {
      const [mx, my] = R.xy(L, c);
      assert.equal(Math.abs(mx - hx) + Math.abs(my - hy), 1, 'every mark is beside the hub');
    }
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
  const order = ['rules.js', 'levels.js', 'solver.js', 'game.js'].map((f) => html.indexOf(`src="${f}"`));
  assert.ok(order.every((p, i) => p >= 0 && (i === 0 || p > order[i - 1])), 'scripts load in dependency order');
  const game = fs.readFileSync(here('./game.js'), 'utf8');
  for (const fn of ['parse', 'initialState', 'moves', 'apply', 'isSolved', 'findMove', 'parity', 'xy', 'rotate', 'cellAt']) {
    assert.ok(game.includes(`R.${fn}(`), `game.js uses rules.${fn}`);
    assert.equal(typeof R[fn], 'function');
  }
  assert.ok(game.includes('SOLVER.solve('), 'the page computes par with the solver');
  assert.ok(/try\s*\{[^}]*localStorage/.test(game), 'localStorage access is wrapped in try/catch');
});
