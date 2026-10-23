/*
 * trainer.js: what to ask next, and when a rung is learned. No DOM.
 *
 * The design, and why:
 *
 *  - The first question is asked cold, before any teaching (a baseline), and
 *    the last question of the ladder is its twin in a different setting, so
 *    you can compare yourself before and after.
 *  - Seven rungs, each one aspect of the same tool. Within a rung the
 *    hand-made exercises come in order, easier first, each in a different
 *    setting (varied practice). A rung is cleared by three right answers in a
 *    row, first attempt, on that rung. Chance alone rarely does that: about
 *    1 in 27 on a three-way question, 1 in 64 on a four-way one.
 *  - If a rung's hand-made exercises run out before it is cleared, graph rungs
 *    get freshly generated exercises (tub.js) and word rungs bring back the
 *    ones you missed, oldest first.
 *  - Every fourth question, once a rung is cleared, is a review from the
 *    cleared rungs (interleaving and spacing): anything missed comes back
 *    first, then exercises not yet seen, then fresh generated ones. Reviews do
 *    not count towards the current rung.
 *  - After the ladder, "open water": everything mixed, with unseen and missed
 *    exercises first, so every exercise in the bank is reachable.
 *
 * Each exercise has a box 0..3 (a Leitner box): right moves it up, wrong puts
 * it back to 0. Generated exercises are not tracked individually.
 *
 * Loads as a classic browser script (window.TubTrainer) and under Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.TubTrainer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STREAK = 3;
  const REVIEW_EVERY = 4; // one question in four, once something is cleared
  const LADDER = [1, 2, 3, 4, 5, 6, 7];
  const GRAPH_RUNGS = { 1: ['dir'], 2: ['peak', 'trough'], 3: ['sketch'], 4: ['amount'] };
  const GAP = 3; // a missed exercise waits at least this many questions before it returns

  function fresh() {
    return {
      v: 1,
      q: 0, // questions answered
      seen: {}, // id -> times shown and answered
      box: {}, // id -> 0..3
      last: {}, // id -> q at which it was last answered
      streak: {}, // rung -> current run of right answers
      cleared: {}, // rung -> true
      stats: {}, // rung -> { n, ok }
      sinceReview: 0,
      gen: 1, // next seed for generated exercises
      lastRungAt: {}, // rung -> q last practised (for interleaving)
      cold: null, // { id, ok, t, diag }
      twin: null,
      log: [], // [{ id, ok, mode, rung }], most recent last (capped)
      current: null, // the pick on screen, so a reload resumes it
    };
  }

  // Keep only well-formed fields of a stored state (localStorage is not trusted).
  function clean(raw, bank) {
    const out = fresh();
    let p = raw;
    if (typeof raw === 'string') {
      try {
        p = JSON.parse(raw);
      } catch (e) {
        return out;
      }
    }
    if (!p || typeof p !== 'object' || p.v !== 1) return out;
    const isCount = (x) => Number.isInteger(x) && x >= 0 && x < 1e7;
    const ids = new Set(bank.ITEMS.map((i) => i.id));
    if (isCount(p.q)) out.q = p.q;
    if (isCount(p.sinceReview)) out.sinceReview = p.sinceReview;
    if (isCount(p.gen) && p.gen > 0) out.gen = p.gen;
    for (const key of ['seen', 'last']) {
      if (p[key] && typeof p[key] === 'object') {
        for (const [k, v] of Object.entries(p[key])) if (ids.has(k) && isCount(v)) out[key][k] = v;
      }
    }
    if (p.box && typeof p.box === 'object') {
      for (const [k, v] of Object.entries(p.box)) if (ids.has(k) && Number.isInteger(v) && v >= 0 && v <= 3) out.box[k] = v;
    }
    for (const r of LADDER) {
      if (p.streak && isCount(p.streak[r])) out.streak[r] = Math.min(p.streak[r], STREAK);
      if (p.cleared && p.cleared[r] === true) out.cleared[r] = true;
      if (p.lastRungAt && isCount(p.lastRungAt[r])) out.lastRungAt[r] = p.lastRungAt[r];
    }
    for (const r of [0, ...LADDER, 8]) {
      const s = p.stats && p.stats[r];
      if (s && isCount(s.n) && isCount(s.ok) && s.ok <= s.n) out.stats[r] = { n: s.n, ok: s.ok };
    }
    const cleanEnd = (e) => {
      if (!e || typeof e !== 'object' || !ids.has(e.id) || typeof e.ok !== 'boolean') return null;
      const o = { id: e.id, ok: e.ok };
      if (typeof e.t === 'number' && Number.isFinite(e.t)) o.t = e.t;
      if (typeof e.diag === 'string' && /^[a-zA-Z]{1,20}$/.test(e.diag)) o.diag = e.diag;
      return o;
    };
    out.cold = cleanEnd(p.cold);
    out.twin = cleanEnd(p.twin);
    if (Array.isArray(p.log)) {
      for (const e of p.log.slice(-200)) {
        if (e && typeof e.id === 'string' && (ids.has(e.id) || isGenId(e.id)) && typeof e.ok === 'boolean') {
          out.log.push({ id: e.id, ok: e.ok, mode: String(e.mode || '').slice(0, 10), rung: Number.isInteger(e.rung) ? e.rung : -1 });
        }
      }
    }
    const c = p.current;
    if (c && typeof c.id === 'string' && (ids.has(c.id) || isGenId(c.id)) && ['cold', 'ladder', 'review', 'twin', 'open'].includes(c.mode) && Number.isInteger(c.rung)) {
      out.current = { id: c.id, mode: c.mode, rung: c.rung };
    }
    // a twin without a cold, or a cleared ladder without its parts, is incoherent: keep what is consistent
    if (!out.cold) {
      out.twin = null;
    }
    return out;
  }

  function isGenId(id) {
    return /^gen:(dir|peak|trough|amount|sketch):[a-z]+:\d{1,9}$/.test(id);
  }

  // Rebuild a generated exercise from its id.
  function genItem(id, bank, Tub) {
    const m = /^gen:(dir|peak|trough|amount|sketch):([a-z]+):(\d+)$/.exec(id);
    if (!m) return null;
    const tpl = bank.TEMPLATES.find((t) => t.key === m[2]);
    if (!tpl) return null;
    const it = Tub.generate(m[1], tpl, Number(m[3]));
    if (!it) return null;
    it.rung = { dir: 1, peak: 2, trough: 2, sketch: 3, amount: 4 }[m[1]];
    return it;
  }

  function itemFor(id, bank, Tub) {
    return bank.byId[id] || genItem(id, bank, Tub);
  }

  function currentRung(state) {
    for (const r of LADDER) if (!state.cleared[r]) return r;
    return null;
  }

  function ladderDone(state) {
    return currentRung(state) === null;
  }

  function rungItems(bank, r) {
    return bank.ITEMS.filter((i) => i.rung === r);
  }

  // The ids answered in the last k questions (never repeat one that recently).
  function recent(state, k) {
    return new Set(state.log.slice(-k).map((e) => e.id));
  }

  function newGenerated(state, bank, Tub, rung) {
    const kinds = GRAPH_RUNGS[rung];
    if (!kinds) return null;
    for (let tries = 0; tries < 20; tries++) {
      const seed = state.gen++;
      const kind = kinds[seed % kinds.length];
      const tpl = bank.TEMPLATES[seed % bank.TEMPLATES.length];
      const it = Tub.generate(kind, tpl, seed);
      if (it) return it.id;
    }
    return null;
  }

  // Missed exercises (box 0, seen) from these rungs, due again, oldest first.
  function dueMissed(state, bank, rungs) {
    const near = recent(state, GAP);
    return bank.ITEMS.filter((i) => rungs.includes(i.rung) && state.seen[i.id] && (state.box[i.id] || 0) === 0 && !near.has(i.id)).sort(
      (a, b) => (state.last[a.id] || 0) - (state.last[b.id] || 0)
    );
  }

  // First unseen exercise from these rungs, taking the rung practised least recently.
  function unseenInterleaved(state, bank, rungs) {
    const order = rungs.slice().sort((a, b) => (state.lastRungAt[a] || 0) - (state.lastRungAt[b] || 0) || a - b);
    for (const r of order) {
      const it = rungItems(bank, r).find((i) => !state.seen[i.id]);
      if (it) return it;
    }
    return null;
  }

  // Least recently answered exercise, lowest box first, from these rungs.
  function stalest(state, bank, rungs) {
    const near = recent(state, GAP);
    const pool = bank.ITEMS.filter((i) => rungs.includes(i.rung) && !near.has(i.id));
    pool.sort((a, b) => (state.box[a.id] || 0) - (state.box[b.id] || 0) || (state.last[a.id] || 0) - (state.last[b.id] || 0));
    return pool[0] || null;
  }

  function reviewPick(state, bank, Tub, rungs) {
    const missed = dueMissed(state, bank, rungs);
    if (missed.length) return { id: missed[0].id, rung: missed[0].rung };
    const un = unseenInterleaved(state, bank, rungs);
    if (un) return { id: un.id, rung: un.rung };
    const graph = rungs.filter((r) => GRAPH_RUNGS[r]);
    if (graph.length) {
      const r = graph.slice().sort((a, b) => (state.lastRungAt[a] || 0) - (state.lastRungAt[b] || 0))[0];
      const id = newGenerated(state, bank, Tub, r);
      if (id) return { id, rung: r };
    }
    const st = stalest(state, bank, rungs);
    return st ? { id: st.id, rung: st.rung } : null;
  }

  // What to ask next. Returns { id, mode, rung } and stores it as state.current.
  // `Tub` is needed only to generate exercises.
  function next(state, bank, Tub) {
    let pick = null;
    if (!state.cold) {
      pick = { id: bank.COLD, mode: 'cold', rung: 0 };
    } else if (ladderDone(state) && !state.twin) {
      pick = { id: bank.TWIN, mode: 'twin', rung: 8 };
    } else if (!ladderDone(state)) {
      const r = currentRung(state);
      const cleared = LADDER.filter((x) => state.cleared[x]);
      if (cleared.length && state.sinceReview >= REVIEW_EVERY - 1) {
        const rv = reviewPick(state, bank, Tub, cleared);
        if (rv) pick = { id: rv.id, mode: 'review', rung: rv.rung };
      }
      if (!pick) {
        const items = rungItems(bank, r);
        const un = items.find((i) => !state.seen[i.id]);
        if (un) pick = { id: un.id, mode: 'ladder', rung: r };
        else if (GRAPH_RUNGS[r]) {
          const id = newGenerated(state, bank, Tub, r);
          if (id) pick = { id, mode: 'ladder', rung: r };
        }
        if (!pick) {
          const missed = dueMissed(state, bank, [r]);
          const st = missed[0] || stalest(state, bank, [r]) || items[0];
          pick = { id: st.id, mode: 'ladder', rung: r };
        }
      }
    } else {
      // open water: everything, mixed
      const all = LADDER.slice();
      const missed = dueMissed(state, bank, all);
      if (missed.length) pick = { id: missed[0].id, mode: 'open', rung: missed[0].rung };
      if (!pick) {
        const un = unseenInterleaved(state, bank, all);
        if (un) pick = { id: un.id, mode: 'open', rung: un.rung };
      }
      if (!pick && state.q % 2 === 0) {
        const graph = Object.keys(GRAPH_RUNGS).map(Number);
        const r = graph.slice().sort((a, b) => (state.lastRungAt[a] || 0) - (state.lastRungAt[b] || 0))[0];
        const id = newGenerated(state, bank, Tub, r);
        if (id) pick = { id, mode: 'open', rung: r };
      }
      if (!pick) {
        const st = stalest(state, bank, all);
        pick = { id: st.id, mode: 'open', rung: st.rung };
      }
    }
    state.current = pick;
    return pick;
  }

  // Record an answer to the current pick. Returns what changed:
  // { cleared: rung | null, ladderDone: bool, streak }.
  function record(state, pick, ok, extra) {
    const res = { cleared: null, ladderDone: false, streak: 0 };
    state.q += 1;
    const id = pick.id;
    const tracked = !isGenId(id);
    if (tracked) {
      state.seen[id] = (state.seen[id] || 0) + 1;
      state.last[id] = state.q;
      state.box[id] = ok ? Math.min(3, (state.box[id] || 0) + 1) : 0;
    }
    const r = pick.rung;
    if (r >= 1 && r <= 7) state.lastRungAt[r] = state.q;
    const st = state.stats[r] || { n: 0, ok: 0 };
    st.n += 1;
    if (ok) st.ok += 1;
    state.stats[r] = st;
    state.log.push({ id, ok, mode: pick.mode, rung: r });
    if (state.log.length > 200) state.log.splice(0, state.log.length - 200);

    if (pick.mode === 'cold') state.cold = Object.assign({ id, ok }, extra || {});
    if (pick.mode === 'twin') state.twin = Object.assign({ id, ok }, extra || {});
    if (pick.mode === 'review') state.sinceReview = 0;
    if (pick.mode === 'ladder') {
      state.sinceReview += 1;
      state.streak[r] = ok ? (state.streak[r] || 0) + 1 : 0;
      res.streak = state.streak[r];
      if (state.streak[r] >= STREAK) {
        state.cleared[r] = true;
        state.streak[r] = STREAK;
        res.cleared = r;
        res.ladderDone = ladderDone(state);
        state.sinceReview = Math.min(state.sinceReview, REVIEW_EVERY - 2); // start the next rung before a review
      }
    }
    state.current = null;
    return res;
  }

  return {
    STREAK,
    REVIEW_EVERY,
    LADDER,
    GRAPH_RUNGS,
    fresh,
    clean,
    isGenId,
    genItem,
    itemFor,
    currentRung,
    ladderDone,
    next,
    record,
  };
});
