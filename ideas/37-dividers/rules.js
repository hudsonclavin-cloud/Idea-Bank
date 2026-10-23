/*
 * rules.js: the rules of Dividers, with no DOM in it.
 *
 * A level is a sheet of graph paper. A pair of dividers stands on it with its two
 * legs in adjacent cells. One move: plant one leg, swing the other a quarter turn
 * around it. The leg lands on the cell beside the planted leg, and on its way it
 * passes through the corner cell diagonal to the planted leg, so that corner must
 * not hold a pin. Pins (#) block landing and swinging; holes (o) block landing
 * only; marks (*) are pricked when a leg lands on them. Prick every mark to win.
 *
 * Loads as a classic browser script (exposes window.Dividers) and under Node
 * (module.exports), so the page, the solver and the tests share one source.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.Dividers = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const FLOOR = 0;
  const PIN = 1;
  const HOLE = 2;

  const CHARS = {
    '.': FLOOR,
    '*': FLOOR,
    A: FLOOR,
    B: FLOOR,
    '#': PIN,
    o: HOLE,
  };

  // Screen coordinates: x to the right, y downward. A clockwise quarter turn on
  // screen sends (1,0) to (0,1), i.e. "right" to "down".
  function rotate(dx, dy, turn) {
    return turn === 'cw' ? [-dy, dx] : [dy, -dx];
  }

  function parse(def) {
    const rows = def.rows.map((r) => r.replace(/\s+$/, ''));
    const h = rows.length;
    const w = Math.max(...rows.map((r) => r.length));
    if (!h || !w) throw new Error('empty level');
    const cells = new Uint8Array(w * h);
    const marks = [];
    const markBit = new Int8Array(w * h).fill(-1);
    let a = -1;
    let b = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = rows[y][x] === undefined ? '#' : rows[y][x];
        if (!(c in CHARS)) throw new Error('bad cell "' + c + '" at ' + x + ',' + y + ' in ' + (def.name || 'level'));
        const i = y * w + x;
        cells[i] = CHARS[c];
        if (c === '*') {
          markBit[i] = marks.length;
          marks.push(i);
        }
        if (c === 'A') a = i;
        if (c === 'B') b = i;
      }
    }
    if (a < 0 || b < 0) throw new Error('level needs both legs A and B: ' + (def.name || ''));
    if (marks.length === 0) throw new Error('level needs at least one mark: ' + (def.name || ''));
    if (marks.length > 20) throw new Error('too many marks (max 20): ' + (def.name || ''));
    const ax = a % w;
    const ay = (a - ax) / w;
    const bx = b % w;
    const by = (b - bx) / w;
    if (Math.abs(ax - bx) + Math.abs(ay - by) !== 1) throw new Error('legs must start in adjacent cells: ' + (def.name || ''));
    return {
      name: def.name || '',
      hint: def.hint || '',
      rows,
      w,
      h,
      cells,
      marks,
      markBit,
      start: { a, b },
    };
  }

  function cellAt(level, x, y) {
    if (x < 0 || y < 0 || x >= level.w || y >= level.h) return PIN; // off the sheet counts as pinned
    return level.cells[y * level.w + x];
  }

  function xy(level, i) {
    const x = i % level.w;
    return [x, (i - x) / level.w];
  }

  // Checkerboard colour of a cell. Each leg keeps its colour for the whole game:
  // a quarter turn moves a leg from pivot+d to pivot+d', and d'-d has two odd
  // components, so x+y changes by an even number. This is the parity invariant
  // that the tests prove by brute force over every reachable state.
  function parity(level, i) {
    const [x, y] = xy(level, i);
    return (x + y) & 1;
  }

  function initialState(level) {
    let mask = 0;
    if (level.markBit[level.start.a] >= 0) mask |= 1 << level.markBit[level.start.a];
    if (level.markBit[level.start.b] >= 0) mask |= 1 << level.markBit[level.start.b];
    return { a: level.start.a, b: level.start.b, mask };
  }

  function fullMask(level) {
    return (1 << level.marks.length) - 1;
  }

  function isSolved(level, state) {
    return state.mask === fullMask(level);
  }

  // Integer key for a state, unique within a level.
  function key(level, state) {
    const n = level.w * level.h;
    return (state.a * n + state.b) * (1 << level.marks.length) + state.mask;
  }

  // The legal moves from a state. Each move names the leg that swings ('a' or
  // 'b'), the turn ('cw' or 'ccw'), and the cells involved.
  function moves(level, state) {
    const out = [];
    for (const leg of ['a', 'b']) {
      const other = leg === 'a' ? 'b' : 'a';
      const pivot = state[other];
      const from = state[leg];
      const [px, py] = xy(level, pivot);
      const [fx, fy] = xy(level, from);
      const dx = fx - px;
      const dy = fy - py;
      for (const turn of ['ccw', 'cw']) {
        const [ex, ey] = rotate(dx, dy, turn);
        const tx = px + ex;
        const ty = py + ey;
        const sx = px + dx + ex;
        const sy = py + dy + ey;
        if (cellAt(level, tx, ty) !== FLOOR) continue;
        if (cellAt(level, sx, sy) === PIN) continue;
        out.push({
          leg,
          turn,
          pivot,
          from,
          to: ty * level.w + tx,
          sweep: sy * level.w + sx,
        });
      }
    }
    return out;
  }

  function apply(level, state, move) {
    const next = { a: state.a, b: state.b, mask: state.mask };
    next[move.leg] = move.to;
    const bit = level.markBit[move.to];
    if (bit >= 0) next.mask |= 1 << bit;
    return next;
  }

  // Find the legal move matching a leg and turn, or a leg and landing cell.
  function findMove(level, state, leg, turnOrCell) {
    return (
      moves(level, state).find(
        (m) => m.leg === leg && (m.turn === turnOrCell || m.to === turnOrCell)
      ) || null
    );
  }

  // The move that undoes a move: the same leg swings back the other way.
  function inverse(move) {
    return {
      leg: move.leg,
      turn: move.turn === 'cw' ? 'ccw' : 'cw',
      pivot: move.pivot,
      from: move.to,
      to: move.from,
      sweep: move.sweep,
    };
  }

  // Text rendering of a state, for tests and debugging.
  function render(level, state) {
    const lines = [];
    for (let y = 0; y < level.h; y++) {
      let s = '';
      for (let x = 0; x < level.w; x++) {
        const i = y * level.w + x;
        let c = level.cells[i] === PIN ? '#' : level.cells[i] === HOLE ? 'o' : '.';
        const bit = level.markBit[i];
        if (bit >= 0) c = state.mask & (1 << bit) ? '+' : '*';
        if (i === state.a) c = 'A';
        if (i === state.b) c = 'B';
        s += c;
      }
      lines.push(s);
    }
    return lines.join('\n');
  }

  return {
    FLOOR,
    PIN,
    HOLE,
    parse,
    cellAt,
    xy,
    parity,
    rotate,
    initialState,
    fullMask,
    isSolved,
    key,
    moves,
    apply,
    findMove,
    inverse,
    render,
  };
});
