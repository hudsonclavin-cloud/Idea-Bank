/*
 * solver.js: proves a Dividers level is solvable and measures how hard it is.
 *
 * Breadth-first search over (leg A cell, leg B cell, set of pricked marks).
 * Reports the shortest solution, how many distinct shortest solutions exist,
 * how many states the player can reach at all, and a difficulty score.
 *
 * Loads as a classic browser script after rules.js (exposes window.DividersSolver)
 * and under Node (module.exports).
 */
(function (root, factory) {
  if (typeof module === 'object' && module && module.exports) module.exports = factory(require('./rules.js'));
  else root.DividersSolver = factory(root.Dividers);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R) {
  'use strict';

  // Full breadth-first search from the start. Returns the shortest path to any
  // solved state and counts over the whole reachable state space.
  function solve(level) {
    const start = R.initialState(level);
    const startKey = R.key(level, start);
    const depth = new Map(); // key -> depth
    const ways = new Map(); // key -> number of shortest paths from start
    const parent = new Map(); // key -> {key, move} of one predecessor
    const stateOf = new Map(); // key -> state
    depth.set(startKey, 0);
    ways.set(startKey, 1);
    stateOf.set(startKey, start);
    let frontier = [startKey];
    let d = 0;
    let goalDepth = -1;
    let goalKeys = [];
    let branchSum = 0;
    const layers = [1];
    while (frontier.length) {
      const next = [];
      for (const k of frontier) {
        const s = stateOf.get(k);
        const ms = R.moves(level, s);
        branchSum += ms.length;
        for (const m of ms) {
          const t = R.apply(level, s, m);
          const tk = R.key(level, t);
          if (!depth.has(tk)) {
            depth.set(tk, d + 1);
            ways.set(tk, ways.get(k));
            parent.set(tk, { key: k, move: m });
            stateOf.set(tk, t);
            next.push(tk);
            if (goalDepth < 0 && R.isSolved(level, t)) goalKeys.push(tk);
          } else if (depth.get(tk) === d + 1) {
            ways.set(tk, ways.get(tk) + ways.get(k));
          }
        }
      }
      d++;
      if (goalDepth < 0 && goalKeys.length) goalDepth = d;
      frontier = next;
      if (frontier.length) layers.push(frontier.length);
    }
    if (R.isSolved(level, start)) {
      goalDepth = 0;
      goalKeys = [startKey];
    }
    const reachable = depth.size;
    if (goalDepth < 0) {
      return { solvable: false, moves: -1, path: [], solutions: 0, reachable, explored: reachable, branching: branchSum / reachable, layers };
    }
    // One shortest path, reconstructed from any goal state.
    const path = [];
    let k = goalKeys[0];
    while (k !== startKey) {
      const p = parent.get(k);
      path.push(p.move);
      k = p.key;
    }
    path.reverse();
    let solutions = 0;
    for (const gk of goalKeys) solutions += ways.get(gk);
    let explored = 0;
    for (let i = 0; i <= goalDepth && i < layers.length; i++) explored += layers[i];
    return {
      solvable: true,
      moves: goalDepth,
      path,
      solutions,
      reachable,
      explored,
      branching: branchSum / reachable,
      layers,
      maxDepth: layers.length - 1,
    };
  }

  // Difficulty score = moves + log2(explored / solutions).
  // `moves` is the length of the shortest solution. `explored` is the number of
  // distinct positions the player can be in without yet exceeding that many
  // moves (the haystack); `solutions` is the number of distinct shortest
  // solutions (the needles). Open sheets with one narrow route score high;
  // small sheets where any route works score low.
  function difficulty(a) {
    if (!a.solvable) return Infinity;
    return a.moves + Math.log2(a.explored / a.solutions);
  }

  // Apply a path of moves through the rules engine, checking each is legal.
  // Returns the final state, or throws on an illegal move.
  function walk(level, path) {
    let s = R.initialState(level);
    for (let i = 0; i < path.length; i++) {
      const m = path[i];
      const legal = R.findMove(level, s, m.leg, m.turn);
      if (!legal || legal.to !== m.to) throw new Error('illegal move ' + i + ': ' + JSON.stringify(m));
      s = R.apply(level, s, legal);
    }
    return s;
  }

  // Every state the player can reach, as an array of states.
  function reachableStates(level) {
    const start = R.initialState(level);
    const seen = new Map([[R.key(level, start), start]]);
    const stack = [start];
    while (stack.length) {
      const s = stack.pop();
      for (const m of R.moves(level, s)) {
        const t = R.apply(level, s, m);
        const k = R.key(level, t);
        if (!seen.has(k)) {
          seen.set(k, t);
          stack.push(t);
        }
      }
    }
    return [...seen.values()];
  }

  // Shortest number of moves from a state to a solved state, or -1.
  function distanceToGoal(level, state) {
    const seen = new Set([R.key(level, state)]);
    let frontier = [state];
    let d = 0;
    while (frontier.length) {
      const next = [];
      for (const s of frontier) {
        if (R.isSolved(level, s)) return d;
        for (const m of R.moves(level, s)) {
          const t = R.apply(level, s, m);
          const k = R.key(level, t);
          if (!seen.has(k)) {
            seen.add(k);
            next.push(t);
          }
        }
      }
      frontier = next;
      d++;
    }
    return -1;
  }

  return { solve, difficulty, walk, reachableStates, distanceToGoal };
});
