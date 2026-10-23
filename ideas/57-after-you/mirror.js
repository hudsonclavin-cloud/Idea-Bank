// After You — the rules, the trace measurement and the round state machine.
//
// Pure: no DOM, no clock, no randomness of its own. The page hands it the time, the random
// words it needs (from crypto.getRandomValues) and the finished trace of a round; it hands back
// the next state and a `view` of what the screen may show. Everything the README claims about
// scoring, fairness, hidden information and the measurement lives here, and mirror.test.mjs
// checks it.
//
// Coordinates are in the "mirror frame": x runs along the mirror line, y is the distance from
// it, both in CSS pixels. A perfect mirror is A === B in this frame.
//
// Loads as a plain <script> (window.AfterYou) and as CommonJS (require('./mirror.js')).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AfterYou = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const C = Object.freeze({
    DT: 20, // ms per sample (50 Hz)
    SEG: 25, // samples per timeline segment (0.5 s)
    HALF_WIN: 75, // samples either side of a segment's centre: whether anyone is copying is judged on 3 s
    SHORT_WIN: 25, // ... and who is ahead, on the 1 s around the segment
    SHORT_QUIET: 1 / 3, // both dots this still (x MIN_EXTENT) in that 1 s: a pause, credited to nobody
    MAX_LAG: 40, // samples searched either way (0.8 s)
    MIN_PAIRS: 40, // fewer overlapping samples than this and a lag is not considered
    TOGETHER_MS: 40, // |lag| at or under this is "together": nobody ahead
    MIN_CORR: 0.5, // velocity correlation at the best lag below this: "apart"
    VEL_SPAN: 5, // samples either side for the velocity estimate (±100 ms)
    COUPLE_TOL: 0.10, // x scale, RMS distance at the best lag above this: "apart" (nobody is copying anybody)
    AMBIGUOUS: 1.25, // another local best within this factor that disagrees: "unclear"
    MIN_EXTENT: 0.03, // x scale, RMS spread of a player's position in a window to count as moving
    HELD_TOL: 0.12, // x scale, the dots must be this close to mirror images
    HELD_TRAVEL: 0.15, // x scale, and each must have travelled this far (net) ...
    HELD_LOOKBACK: 75, // ... over this many samples (1.5 s)
    HELD_POINT: 1 / 3, // fraction of the round the mirror must hold for the "held" point (10 of 30 s)
    LEADER_MIN_MS: 4000, // the measured leader must have been ahead for at least this long
    FIRST_MOVE: 0.06, // x scale, net displacement from the start that counts as a first move
    COUNTDOWN_MS: 3000,
    PLAY_MS: 30000,
    PRACTICE_MS: 20000,
    ROUNDS: 4,
  });

  const PLAYERS = ['A', 'B']; // A is Orange, B is Blue
  const NAMES = ['Orange', 'Blue'];
  const ORDER_TEXT = Object.freeze({
    lead: Object.freeze({ word: 'LEAD', line: 'Get there first. Make them copy you.' }),
    follow: Object.freeze({ word: 'FOLLOW', line: 'Copy them. Never get there first.' }),
  });
  const PRACTICE_OPTIONS = ['me', 'them', 'nobody'];
  const PERMS3 = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ];

  // ---------------------------------------------------------------- measurement

  function emptyTrace(scale) {
    return { n: 0, scale, ax: [], ay: [], bx: [], by: [] };
  }

  function pushSample(tr, a, b) {
    tr.ax.push(a.x);
    tr.ay.push(a.y);
    tr.bx.push(b.x);
    tr.by.push(b.y);
    tr.n = tr.ax.length;
    return tr;
  }

  // Smoothed velocity per sample: central difference over ±VEL_SPAN samples (±100 ms), one-sided
  // at the ends. The wide span keeps hand tremor from swamping the slow motion of the game.
  function velocity(xs, ys, n) {
    const vx = new Float64Array(n);
    const vy = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const lo = Math.max(0, i - C.VEL_SPAN);
      const hi = Math.min(n - 1, i + C.VEL_SPAN);
      const d = hi - lo || 1;
      vx[i] = (xs[hi] - xs[lo]) / d;
      vy[i] = (ys[hi] - ys[lo]) / d;
    }
    return { vx, vy };
  }

  // The mirror holds at sample i when the two dots are within HELD_TOL of mirror images and
  // each has travelled at least HELD_TRAVEL (net) over the last 1.5 s. It only looks backwards,
  // so the page can show it live with exactly the rule that is scored.
  function heldAt(tr, i) {
    const s = tr.scale;
    const d = Math.hypot(tr.ax[i] - tr.bx[i], tr.ay[i] - tr.by[i]);
    if (!(d <= C.HELD_TOL * s)) return false;
    const j = Math.max(0, i - C.HELD_LOOKBACK);
    const ta = Math.hypot(tr.ax[i] - tr.ax[j], tr.ay[i] - tr.ay[j]);
    const tb = Math.hypot(tr.bx[i] - tr.bx[j], tr.by[i] - tr.by[j]);
    return ta >= C.HELD_TRAVEL * s && tb >= C.HELD_TRAVEL * s;
  }

  function rmsExtent(xs, ys, lo, hi) {
    let mx = 0;
    let my = 0;
    const m = hi - lo + 1;
    for (let t = lo; t <= hi; t++) {
      mx += xs[t];
      my += ys[t];
    }
    mx /= m;
    my /= m;
    let q = 0;
    for (let t = lo; t <= hi; t++) q += (xs[t] - mx) ** 2 + (ys[t] - my) ** 2;
    return Math.sqrt(q / m);
  }

  function lagClass(lagMs) {
    if (Math.abs(lagMs) <= C.TOGETHER_MS) return 'together';
    return lagMs > 0 ? 'A' : 'B';
  }

  // Mean squared distance between A at t and B at t+k, for every lag k in [-K, K], over the pairs
  // whose midpoint t + k/2 lies in the window: 2t + k in [c2 - 2H, c2 + 2H) in doubled sample units.
  // Pairing by midpoint makes everything downstream exactly antisymmetric: swap A and B and every
  // lag changes sign, bit for bit. Lag k > 0 means B is where A was k samples earlier: A is ahead.
  function lagErrors(tr, c2, H) {
    const n = tr.n;
    const K = C.MAX_LAG;
    const e = new Float64Array(2 * K + 1);
    const lo = new Int32Array(2 * K + 1);
    const hi = new Int32Array(2 * K + 1);
    for (let k = -K; k <= K; k++) {
      const tLo = Math.max(0, -k, Math.ceil((c2 - 2 * H - k) / 2));
      const tHi = Math.min(n - 1, n - 1 - k, Math.ceil((c2 + 2 * H - k) / 2) - 1);
      const idx = k + K;
      lo[idx] = tLo;
      hi[idx] = tHi;
      if (tHi - tLo + 1 < Math.min(C.MIN_PAIRS, H)) {
        e[idx] = Infinity;
        continue;
      }
      let q = 0;
      for (let t = tLo; t <= tHi; t++) {
        const dx = tr.ax[t] - tr.bx[t + k];
        const dy = tr.ay[t] - tr.by[t + k];
        q += dx * dx + dy * dy;
      }
      e[idx] = q / (tHi - tLo + 1);
    }
    return { e, lo, hi };
  }

  // The best lag from lagErrors, refined between samples. null when there is no single answer:
  // no finite error, an exact tie between a lead for A and a lead for B, or the best at the edge.
  function bestLag(e) {
    const K = C.MAX_LAG;
    let best = Infinity;
    for (let i = 0; i < e.length; i++) if (e[i] < best) best = e[i];
    if (!Number.isFinite(best)) return null;
    const ties = [];
    for (let i = 0; i < e.length; i++) if (e[i] === best) ties.push(i - K);
    if (ties.some((k) => k > 0) && ties.some((k) => k < 0)) return { tie: true, best };
    let k = ties[0];
    for (const t of ties) if (Math.abs(t) < Math.abs(k)) k = t;
    if (Math.abs(k) >= K) return { edge: true, best, k };
    let frac = 0;
    const em = e[k + K - 1];
    const ep = e[k + K + 1];
    if (Number.isFinite(em) && Number.isFinite(ep)) {
      const den = em - 2 * best + ep;
      if (den > 0) frac = (0.5 * (em - ep)) / den;
    }
    return { k, best, lagMs: (k + frac) * C.DT };
  }

  function windowSpan(n, c2, H) {
    return [Math.max(0, Math.ceil((c2 - 2 * H) / 2)), Math.min(n - 1, Math.ceil((c2 + 2 * H) / 2) - 1)];
  }

  // Judge the half-second segment centred at doubled index c2, in two steps.
  //  1. Is anybody copying anybody? Judged on 3 s of motion (HALF_WIN), because over shorter
  //     stretches two people ignoring each other line up by chance too often: both must be moving,
  //     the best time shift must bring the dots close (COUPLE_TOL), with the same velocities
  //     (MIN_CORR), and no rival shift may tell a different story (AMBIGUOUS).
  //  2. If so, who is ahead in this half-second? Judged on the 1 s around it (SHORT_WIN), so that a
  //     moment of leading is credited for about as long as it lasted, not for the whole 3 s.
  function judgeWindow(tr, vel, c2) {
    const s = tr.scale;
    const K = C.MAX_LAG;
    const [wLo, wHi] = windowSpan(tr.n, c2, C.HALF_WIN);
    if (wHi - wLo + 1 < 2) return { cls: 'still' };
    const moveA = rmsExtent(tr.ax, tr.ay, wLo, wHi) >= C.MIN_EXTENT * s;
    const moveB = rmsExtent(tr.bx, tr.by, wLo, wHi) >= C.MIN_EXTENT * s;
    if (!moveA && !moveB) return { cls: 'still' };
    if (!moveA || !moveB) return { cls: 'apart', why: 'alone' };

    const { e, lo, hi } = lagErrors(tr, c2, C.HALF_WIN);
    const b = bestLag(e);
    if (!b) return { cls: 'apart', why: 'short' };
    if (b.tie) return { cls: 'unclear', why: 'tie' };
    if (b.edge) return { cls: 'apart', why: 'beyond' };
    if (!(Math.sqrt(b.best) <= C.COUPLE_TOL * s)) return { cls: 'apart', why: 'far' };
    const ib = b.k + K;
    let sab = 0;
    let saa = 0;
    let sbb = 0;
    for (let t = lo[ib]; t <= hi[ib]; t++) {
      const ux = vel.a.vx[t];
      const uy = vel.a.vy[t];
      const wx = vel.b.vx[t + b.k];
      const wy = vel.b.vy[t + b.k];
      sab += ux * wx + uy * wy;
      saa += ux * ux + uy * uy;
      sbb += wx * wx + wy * wy;
    }
    const r = saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0;
    if (!(r >= C.MIN_CORR)) return { cls: 'apart', why: 'uncoupled', r };
    const longCls = lagClass(b.lagMs);
    const eps = 1e-6 * s * s;
    for (let k = -K + 1; k <= K - 1; k++) {
      if (k === b.k) continue;
      const i = k + K;
      if (!Number.isFinite(e[i]) || !Number.isFinite(e[i - 1]) || !Number.isFinite(e[i + 1])) continue;
      if (!(e[i] <= e[i - 1] && e[i] <= e[i + 1])) continue;
      if (lagClass(k * C.DT) === longCls) continue;
      if (e[i] <= C.AMBIGUOUS * b.best + eps) return { cls: 'unclear', why: 'rival', r, lagMs: b.lagMs };
    }

    // Step 2: coupled. Who is ahead right here?
    const [sLo, sHi] = windowSpan(tr.n, c2, C.SHORT_WIN);
    const quiet = C.MIN_EXTENT * s * C.SHORT_QUIET;
    if (rmsExtent(tr.ax, tr.ay, sLo, sHi) < quiet && rmsExtent(tr.bx, tr.by, sLo, sHi) < quiet) return { cls: 'still', why: 'pause' };
    const sb = bestLag(lagErrors(tr, c2, C.SHORT_WIN).e);
    if (!sb || sb.tie || sb.edge) return { cls: longCls, lagMs: b.lagMs, r, why: 'long' };
    return { cls: lagClass(sb.lagMs), lagMs: sb.lagMs, r };
  }

  function median(xs) {
    if (!xs.length) return null;
    const a = xs.slice().sort((p, q) => p - q);
    const m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  // Everything the reveal shows about one round, computed from the trace alone.
  function analyse(tr) {
    const n = tr.n;
    const vel = { a: velocity(tr.ax, tr.ay, n), b: velocity(tr.bx, tr.by, n) };
    const nSeg = Math.floor(n / C.SEG);
    const segMs = C.SEG * C.DT;
    const segments = [];
    const time = { A: 0, B: 0, together: 0, apart: 0, unclear: 0, still: 0 };
    const lags = { A: [], B: [] };
    for (let j = 0; j < nSeg; j++) {
      const c2 = 2 * j * C.SEG + C.SEG; // doubled index of the segment's centre
      const w = judgeWindow(tr, vel, c2);
      let held = 0;
      for (let i = j * C.SEG; i < (j + 1) * C.SEG; i++) if (heldAt(tr, i)) held++;
      segments.push({ cls: w.cls, lagMs: w.lagMs === undefined ? null : w.lagMs, held: held / C.SEG });
      time[w.cls] += segMs;
      if (w.cls === 'A') lags.A.push(w.lagMs);
      if (w.cls === 'B') lags.B.push(-w.lagMs);
    }
    let heldCount = 0;
    for (let i = 0; i < n; i++) if (heldAt(tr, i)) heldCount++;

    let leader = null;
    if (time.A > time.B && time.A >= C.LEADER_MIN_MS) leader = 'A';
    else if (time.B > time.A && time.B >= C.LEADER_MIN_MS) leader = 'B';

    let firstMove = { who: null, ms: null };
    const thr = C.FIRST_MOVE * tr.scale;
    for (let i = 0; i < n; i++) {
      const ma = Math.hypot(tr.ax[i] - tr.ax[0], tr.ay[i] - tr.ay[0]) >= thr;
      const mb = Math.hypot(tr.bx[i] - tr.bx[0], tr.by[i] - tr.by[0]) >= thr;
      if (ma || mb) {
        firstMove = { who: ma && mb ? 'both' : ma ? 'A' : 'B', ms: i * C.DT };
        break;
      }
    }

    let run = 0;
    let longest = 0;
    for (const sg of segments) {
      run = sg.cls === 'together' ? run + 1 : 0;
      if (run > longest) longest = run;
    }

    return {
      ms: n * C.DT,
      segMs,
      segments,
      time,
      leader,
      heldFraction: n ? heldCount / n : 0,
      firstMove,
      typicalLag: { A: median(lags.A), B: median(lags.B) },
      longestTogetherMs: longest * segMs,
    };
  }

  // ---------------------------------------------------------------- scoring

  function other(p) {
    return 1 - p;
  }

  // Points for one scored round. orders: ['lead'|'follow', ...]; guesses: each player's guess of
  // the OTHER player's order; analysis from analyse().
  function score(orders, guesses, analysis) {
    const held = analysis.heldFraction >= C.HELD_POINT;
    const leaderIdx = analysis.leader === 'A' ? 0 : analysis.leader === 'B' ? 1 : -1;
    const kept = [0, 1].map((p) => (orders[p] === 'lead' ? leaderIdx === p : leaderIdx === other(p)));
    const read = [0, 1].map((p) => guesses[p] === orders[other(p)]);
    const points = [0, 1].map((p) => (held ? 1 : 0) + (kept[p] ? 1 : 0) + (read[p] ? 1 : 0));
    return { held, kept, read, points };
  }

  // Practice answers are "who led?" from each player's own point of view. Convert to A/B/none.
  function feltLeader(p, answer) {
    if (answer === 'me') return PLAYERS[p];
    if (answer === 'them') return PLAYERS[other(p)];
    return 'none';
  }

  // ---------------------------------------------------------------- state machine

  function u32(x) {
    return Number(x) >>> 0;
  }

  // The orders come from the low bit of two independent random words, one per player, so each
  // player's order is a fair coin independent of the other's and of everything before.
  function dealOrders(rand) {
    return [u32(rand[0]) & 1 ? 'lead' : 'follow', u32(rand[1]) & 1 ? 'lead' : 'follow'];
  }

  // The on-screen order of each player's answer buttons, from two further random words.
  function dealOptions(rand, practice) {
    return [0, 1].map((p) => {
      const r = u32(rand[2 + p]);
      if (practice) return PERMS3[r % 6].map((i) => PRACTICE_OPTIONS[i]);
      return r & 1 ? ['lead', 'follow'] : ['follow', 'lead'];
    });
  }

  function newGame() {
    return {
      phase: 'title',
      round: 0,
      rounds: C.ROUNDS,
      practice: false,
      orders: null,
      peek: [
        { held: false, seen: false },
        { held: false, seen: false },
      ],
      options: [null, null],
      guesses: [null, null],
      phaseAt: 0,
      playMs: 0,
      trace: null,
      analysis: null,
      history: [],
      totals: [0, 0],
    };
  }

  function dealRound(s, round, practice, rand, now) {
    return {
      ...s,
      phase: 'deal',
      round,
      practice,
      orders: practice ? null : dealOrders(rand),
      peek: [
        { held: false, seen: false },
        { held: false, seen: false },
      ],
      options: dealOptions(rand, practice),
      guesses: [null, null],
      phaseAt: now,
      playMs: practice ? C.PRACTICE_MS : C.PLAY_MS,
      trace: null,
      analysis: null,
    };
  }

  function validRand(rand) {
    return Array.isArray(rand) && rand.length >= 4 && rand.every((x) => Number.isFinite(Number(x)));
  }

  function traceOk(tr, samples) {
    return (
      tr &&
      tr.n === samples &&
      tr.scale > 0 &&
      ['ax', 'ay', 'bx', 'by'].every((k) => tr[k] && tr[k].length === samples && Array.prototype.every.call(tr[k], Number.isFinite))
    );
  }

  function canBegin(s) {
    return s.phase === 'deal' && (s.practice || (s.peek[0].seen && s.peek[1].seen));
  }

  // Apply one action. Returns a new state object (the input is never modified); an action that
  // does not apply in the current phase returns the same state unchanged.
  function act(s, a) {
    if (!a || typeof a.type !== 'string') return s;
    if (a.type === 'quit') return newGame();
    switch (s.phase) {
      case 'title':
        if ((a.type === 'practice' || a.type === 'play') && validRand(a.rand)) {
          return dealRound({ ...newGame() }, a.type === 'practice' ? 0 : 1, a.type === 'practice', a.rand, a.now || 0);
        }
        return s;
      case 'deal':
        if (a.type === 'peek' && !s.practice && (a.player === 0 || a.player === 1)) {
          const cur = s.peek[a.player];
          const down = !!a.down;
          if (cur.held === down) return s;
          const peek = s.peek.slice();
          peek[a.player] = { held: down, seen: cur.seen || down };
          return { ...s, peek };
        }
        if (a.type === 'begin' && canBegin(s)) {
          return {
            ...s,
            phase: 'countdown',
            phaseAt: a.now || 0,
            peek: s.peek.map((p) => ({ held: false, seen: p.seen })),
          };
        }
        return s;
      case 'countdown':
        if (a.type === 'tick' && a.now >= s.phaseAt + C.COUNTDOWN_MS) {
          return { ...s, phase: 'play', phaseAt: s.phaseAt + C.COUNTDOWN_MS };
        }
        return s;
      case 'play':
        if (a.type === 'finish' && a.now >= s.phaseAt + s.playMs && traceOk(a.trace, s.playMs / C.DT)) {
          return { ...s, phase: 'guess', phaseAt: a.now, trace: a.trace, analysis: analyse(a.trace) };
        }
        return s;
      case 'guess': {
        if (a.type !== 'guess' || (a.player !== 0 && a.player !== 1)) return s;
        if (s.guesses[a.player] !== null) return s;
        if (!s.options[a.player].includes(a.value)) return s;
        const guesses = s.guesses.slice();
        guesses[a.player] = a.value;
        if (guesses[0] === null || guesses[1] === null) return { ...s, guesses };
        return reveal({ ...s, guesses }, a.now || s.phaseAt);
      }
      case 'reveal':
        if (a.type === 'next' && validRand(a.rand)) {
          if (s.round >= s.rounds) return { ...s, phase: 'summary', trace: null };
          return dealRound(s, s.round + 1, false, a.rand, a.now || 0);
        }
        return s;
      case 'summary':
        if (a.type === 'again') return newGame();
        return s;
      default:
        return s;
    }
  }

  function reveal(s, now) {
    const an = s.analysis;
    let entry;
    if (s.practice) {
      const felt = [0, 1].map((p) => feltLeader(p, s.guesses[p]));
      entry = {
        round: s.round,
        practice: true,
        orders: null,
        guesses: s.guesses.slice(),
        felt,
        feltRight: felt.map((f) => f === (an.leader || 'none')),
        analysis: an,
        held: an.heldFraction >= C.HELD_POINT,
        points: [0, 0],
      };
    } else {
      const sc = score(s.orders, s.guesses, an);
      entry = {
        round: s.round,
        practice: false,
        orders: s.orders.slice(),
        guesses: s.guesses.slice(),
        analysis: an,
        ...sc,
      };
    }
    const totals = [s.totals[0] + entry.points[0], s.totals[1] + entry.points[1]];
    return { ...s, phase: 'reveal', phaseAt: now, history: s.history.concat([entry]), totals };
  }

  function summarise(history, totals) {
    const scored = history.filter((h) => !h.practice);
    const time = { A: 0, B: 0, together: 0, apart: 0, unclear: 0, still: 0 };
    let longest = { ms: 0, round: null };
    for (const h of scored) {
      for (const k of Object.keys(time)) time[k] += h.analysis.time[k];
      if (h.analysis.longestTogetherMs > longest.ms) longest = { ms: h.analysis.longestTogetherMs, round: h.round };
    }
    return {
      rounds: scored.length,
      totals: totals.slice(),
      held: scored.filter((h) => h.held).length,
      kept: [0, 1].map((p) => scored.filter((h) => h.kept[p]).length),
      read: [0, 1].map((p) => scored.filter((h) => h.read[p]).length),
      time,
      longestTogether: longest,
      lines: scored.map((h) => ({ round: h.round, orders: h.orders, points: h.points, leader: h.analysis.leader })),
    };
  }

  // What the screen may show. Hidden information (the orders, and each guess before the reveal)
  // appears here only where the rules allow: a player's own order while that player is holding
  // their card, and everything at the reveal. The page renders from this and nothing else.
  function view(s) {
    const v = {
      phase: s.phase,
      round: s.round,
      rounds: s.rounds,
      practice: s.practice,
      totals: s.totals.slice(),
      playMs: s.playMs,
    };
    if (s.phase === 'deal') {
      v.canBegin = canBegin(s);
      v.cards = s.practice
        ? null
        : [0, 1].map((p) => ({
            held: s.peek[p].held,
            seen: s.peek[p].seen,
            order: s.peek[p].held ? s.orders[p] : null,
          }));
    }
    if (s.phase === 'countdown') v.goAt = s.phaseAt + C.COUNTDOWN_MS;
    if (s.phase === 'play') {
      v.startedAt = s.phaseAt;
      v.endsAt = s.phaseAt + s.playMs;
    }
    if (s.phase === 'guess') {
      v.guess = [0, 1].map((p) => ({ options: s.options[p].slice(), answered: s.guesses[p] !== null }));
    }
    if (s.phase === 'reveal') {
      v.result = JSON.parse(JSON.stringify(s.history[s.history.length - 1]));
      v.trace = s.trace;
      v.last = s.round >= s.rounds;
    }
    if (s.phase === 'summary') v.summary = summarise(s.history, s.totals);
    return v;
  }

  return {
    C,
    PLAYERS,
    NAMES,
    ORDER_TEXT,
    PRACTICE_OPTIONS,
    emptyTrace,
    pushSample,
    heldAt,
    judgeWindow,
    velocity,
    analyse,
    score,
    feltLeader,
    dealOrders,
    dealOptions,
    newGame,
    act,
    view,
    summarise,
    canBegin,
  };
});
