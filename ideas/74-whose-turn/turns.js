/* turns.js: the arithmetic behind "Whose turn?", with no DOM and no clock.
 *
 * A circle is a group of people who share something that one person does for the others
 * each time: drive the school run, host, cook, take the bins out (a TURNS circle), or buy
 * one of something for everyone present: coffee, a round of drinks (a ROUNDS circle).
 * Not everyone is there every time. Each time, someone does it.
 *
 * The ledger. Every person has a balance u, "what they owe the group":
 *   turns:  each of the k people present has a fair share of 1/k of that turn; the person
 *           who did it did 1 turn. u = (sum of fair shares) - (turns done).
 *   rounds: each of the k people present had 1 portion; the buyer bought k.
 *           u = (portions had) - (portions bought).
 * Balances always add up to exactly zero. They are kept as exact fractions (BigInt), so no
 * rounding ever accumulates.
 *
 * The rule (Fagin and Williams's carpool rule, 1983): among the people present, the one who
 * owes the most does it. Exact ties go to whoever did it least recently, then to the earlier
 * name in the circle's list. The guarantee below holds whichever tied person does it.
 *
 * The promise. Let n be the number of people who have ever been in the circle, a = 1/2 for
 * turns and a = 1 for rounds, and for any group J of people let g(J) = |J| (n - |J|). If every
 * group satisfies  u(J) <= a g(J)  (true at the start, when everyone is 0), then after a turn
 * given by the rule it still does. Proof, for a group J that does not contain the person c who
 * did it but does contain the a' >= 1 present people B = J n S (S = everyone present, k = |S|):
 * with f(J) = a g(J) - u(J), Y = J + c and Z = J - B,
 *     (a'+1) f(J) = a' f(Y) + f(Z) + sum_{b in B} (u_c - u_b) + a a'(a'+1),
 * an identity in u (g is the cut function of the complete graph). Every term on the right is
 * >= 0 (u_c is the largest balance present), so f(J) >= a a'. The turn raises u(J) by a'/k
 * (turns) or a' (rounds), which is at most a a' since k >= 2. Groups containing c do not go up.
 * Taking J = one person gives u <= a (n - 1); taking J = everyone else gives u >= -a (n - 1).
 * So: following the rule, nobody ever owes or is owed more than (n-1)/2 turns, or n-1 portions.
 *
 * If people have not followed the rule, the same identity shows that the excess
 * D = max(0, max_J (u(J) - a g(J))) never grows while the rule is followed from here on, so
 * the promise from now on is a (n-1) + D. The largest u(J) over groups of size j is the sum of
 * the j largest balances, so D takes a sort to compute.
 *
 * Loads as a classic browser script (window.WhoseTurn) and with require()/createRequire.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.WhoseTurn = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- exact rationals
  // A rational is { n: BigInt, d: BigInt } with d > 0 and gcd(|n|, d) = 1.
  function bgcd(a, b) {
    if (a < 0n) a = -a;
    if (b < 0n) b = -b;
    while (b) [a, b] = [b, a % b];
    return a;
  }
  function Q(n, d) {
    n = BigInt(n);
    d = d === undefined ? 1n : BigInt(d);
    if (d === 0n) throw new RangeError('zero denominator');
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    const g = bgcd(n, d) || 1n;
    return { n: n / g, d: d / g };
  }
  const ZERO = Q(0);
  const add = (a, b) => Q(a.n * b.d + b.n * a.d, a.d * b.d);
  const sub = (a, b) => Q(a.n * b.d - b.n * a.d, a.d * b.d);
  const mul = (a, b) => Q(a.n * b.n, a.d * b.d);
  const neg = (a) => Q(-a.n, a.d);
  const cmp = (a, b) => {
    const x = a.n * b.d - b.n * a.d;
    return x > 0n ? 1 : x < 0n ? -1 : 0;
  };
  const eq = (a, b) => a.n === b.n && a.d === b.d;
  const toNumber = (a) => Number(a.n) / Number(a.d);
  const qmax = (a, b) => (cmp(a, b) >= 0 ? a : b);
  const qstr = (a) => (a.d === 1n ? `${a.n}` : `${a.n}/${a.d}`);
  function parseQ(s) {
    const m = /^(-?\d+)(?:\/(\d+))?$/.exec(String(s));
    if (!m) throw new Error(`not a fraction: ${s}`);
    return Q(m[1], m[2] || 1);
  }

  // ---------------------------------------------------------------- circles and events
  const KINDS = ['turns', 'rounds'];

  /** Events that count: not removed, ordered by time then id (a total order every device agrees on). */
  function liveEvents(circle) {
    const removed = new Set(circle.removed || []);
    return (circle.events || [])
      .filter((e) => !removed.has(e.id))
      .slice()
      .sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /** People present at an event: everyone listed, plus the doer (doing it means taking part). */
  function presentOf(e) {
    const s = new Set(e.who);
    s.add(e.by);
    return [...s];
  }

  /** How one event changes each balance. Sums to zero. */
  function eventDelta(kind, present, by) {
    const k = present.length;
    const out = new Map();
    if (kind === 'rounds') {
      for (const p of present) out.set(p, Q(1));
      out.set(by, Q(1 - k));
    } else {
      for (const p of present) out.set(p, Q(1, k));
      out.set(by, sub(Q(1, k), Q(1)));
    }
    return out;
  }

  /** Per-person totals for the whole ledger (or for the first `upto` live events). */
  function ledger(circle, upto) {
    const evs = liveEvents(circle);
    const n = upto === undefined ? evs.length : Math.min(upto, evs.length);
    const rows = new Map();
    for (const m of circle.members) {
      rows.set(m.id, { id: m.id, bal: ZERO, share: ZERO, done: 0, present: 0, last: -Infinity, lastIdx: -1 });
    }
    const row = (id) => {
      if (!rows.has(id)) rows.set(id, { id, bal: ZERO, share: ZERO, done: 0, present: 0, last: -Infinity, lastIdx: -1 });
      return rows.get(id);
    };
    for (let i = 0; i < n; i++) {
      const e = evs[i];
      const present = presentOf(e);
      const k = present.length;
      for (const p of present) {
        const r = row(p);
        r.present++;
        r.share = add(r.share, circle.kind === 'rounds' ? Q(1) : Q(1, k));
      }
      const d = eventDelta(circle.kind, present, e.by);
      for (const [p, v] of d) row(p).bal = add(row(p).bal, v);
      const b = row(e.by);
      b.done++;
      b.last = e.t;
      b.lastIdx = i;
    }
    return rows;
  }

  /** Balances only: Map id -> rational. */
  function balances(circle, upto) {
    const out = new Map();
    for (const [id, r] of ledger(circle, upto)) out.set(id, r.bal);
    return out;
  }

  /**
   * Order the people present by the rule: highest balance first; exact ties to whoever did it
   * least recently (never counts as longest ago), then to the earlier name in the list.
   */
  function rank(circle, presentIds, rows) {
    rows = rows || ledger(circle);
    const order = new Map(circle.members.map((m, i) => [m.id, i]));
    const ids = [...new Set(presentIds)].filter((id) => rows.has(id));
    return ids
      .map((id) => rows.get(id))
      .sort((a, b) => {
        const c = cmp(b.bal, a.bal);
        if (c) return c;
        if (a.lastIdx !== b.lastIdx) return a.lastIdx - b.lastIdx;
        return (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9);
      });
  }

  /** The pick for today, with the facts needed to explain it. */
  function pick(circle, presentIds, rows) {
    rows = rows || ledger(circle);
    const ranked = rank(circle, presentIds, rows);
    if (ranked.length < 2) return { ok: false, ranked, reason: ranked.length ? 'alone' : 'nobody' };
    const top = ranked[0];
    const tied = ranked.filter((r) => eq(r.bal, top.bal));
    let tieBy = null;
    if (tied.length > 1) {
      tieBy = top.lastIdx !== tied[1].lastIdx ? 'recency' : 'list';
    }
    return { ok: true, ranked, top, tied, tieBy, sign: cmp(top.bal, ZERO) };
  }

  // ---------------------------------------------------------------- the promise
  /** a = 1/2 for turns, 1 for rounds. */
  const alphaOf = (kind) => (kind === 'rounds' ? Q(1) : Q(1, 2));

  /**
   * D = max(0, max over groups J of u(J) - a |J| (n - |J|)). For each size j the largest u(J)
   * is the sum of the j largest balances, so this is one sort and a prefix sum.
   */
  function excess(kind, n, bals) {
    const a = alphaOf(kind);
    const v = [...bals].sort((x, y) => cmp(y, x));
    while (v.length < n) v.push(ZERO); // people with no history are at 0 (they sort into place)
    v.sort((x, y) => cmp(y, x));
    let s = ZERO;
    let D = ZERO;
    for (let j = 1; j <= v.length; j++) {
      s = add(s, v[j - 1]);
      D = qmax(D, sub(s, mul(a, Q(j * (n - j)))));
    }
    return D;
  }

  /**
   * What can be promised from now on, if the rule is followed: nobody's balance will go
   * beyond +-(a (n-1) + D). When the ledger is fresh (or was always within bounds) D = 0.
   */
  function promise(circle, rows) {
    rows = rows || ledger(circle);
    const n = Math.max(circle.members.length, rows.size);
    const bals = [...rows.values()].map((r) => r.bal);
    const D = excess(circle.kind, n, bals);
    const base = mul(alphaOf(circle.kind), Q(Math.max(n - 1, 0)));
    return { n, base, D, bound: add(base, D) };
  }

  /**
   * The worst case the rule actually reaches from an even start, for turns circles of n
   * people, over every possible pattern of attendance and every tie choice. Computed by
   * exhaustive search (tests recompute every entry). Rounds circles reach n - 1 on the first
   * round of everyone, which is also the proven bound, so they need no table.
   */
  const EXACT_TURNS = Object.freeze({ 1: '0', 2: '1/2', 3: '5/6', 4: '7/6', 5: '8/5' });

  /** Did every logged turn go to someone the rule allowed (top balance among those present)? */
  function replay(circle) {
    const evs = liveEvents(circle);
    const bal = new Map(circle.members.map((m) => [m.id, ZERO]));
    let followed = 0;
    const deviations = [];
    evs.forEach((e, i) => {
      const present = presentOf(e);
      let best = null;
      for (const p of present) {
        const b = bal.get(p) || ZERO;
        if (best === null || cmp(b, best) > 0) best = b;
      }
      if (present.length < 2 || cmp(bal.get(e.by) || ZERO, best) === 0) followed++;
      else deviations.push(i);
      for (const [p, v] of eventDelta(circle.kind, present, e.by)) bal.set(p, add(bal.get(p) || ZERO, v));
    });
    return { total: evs.length, followed, deviations };
  }

  /** The promise that would hold if `by` did the turn for `presentIds` now. */
  function promiseIf(circle, presentIds, by, rows) {
    rows = rows || ledger(circle);
    const present = [...new Set([...presentIds, by])];
    const next = new Map();
    for (const [id, r] of rows) next.set(id, { ...r });
    for (const [p, v] of eventDelta(circle.kind, present, by)) {
      const r = next.get(p) || { id: p, bal: ZERO };
      next.set(p, { ...r, bal: add(r.bal, v) });
    }
    return promise(circle, next);
  }

  // ---------------------------------------------------------------- other rules (for comparison)
  /**
   * Simulate a rule over an attendance sequence (arrays of indices 0..n-1, each with >= 2
   * people). Returns the balances after each step. Rules:
   *   'fair'   : this page's rule (highest balance; ties to least recent, then lowest index)
   *   'rota'   : a fixed rota 0,1,2,...; whoever's turn it is goes if present, otherwise the
   *              next person in the rota who is; the rota then continues after whoever went
   *   'fewest' : whoever present has done it the fewest times (ties as for 'fair')
   */
  function simulate(rule, kind, n, days) {
    const bal = Array.from({ length: n }, () => ZERO);
    const done = new Array(n).fill(0);
    const last = new Array(n).fill(-1);
    let ptr = 0;
    const history = [];
    const doers = [];
    days.forEach((present, t) => {
      let by;
      if (rule === 'rota') {
        const set = new Set(present);
        let i = ptr;
        while (!set.has(i % n)) i++;
        by = i % n;
        ptr = (by + 1) % n;
      } else {
        const key = rule === 'fewest' ? (i) => -done[i] : null;
        const sorted = present.slice().sort((a, b) => {
          if (key) {
            if (key(a) !== key(b)) return key(b) - key(a);
          } else {
            const c = cmp(bal[b], bal[a]);
            if (c) return c;
          }
          if (last[a] !== last[b]) return last[a] - last[b];
          return a - b;
        });
        by = sorted[0];
      }
      const d = eventDelta(kind, present.includes(by) ? present : present.concat([by]), by);
      for (const [p, v] of d) bal[p] = add(bal[p], v);
      done[by]++;
      last[by] = t;
      doers.push(by);
      history.push(bal.slice());
    });
    return { history, doers, final: bal };
  }

  /** Largest |balance| over a simulated history. */
  function worst(history) {
    let w = ZERO;
    for (const row of history) for (const b of row) w = qmax(w, cmp(b, ZERO) < 0 ? neg(b) : b);
    return w;
  }

  /** A small seeded generator (mulberry32), for examples that must come out the same every time. */
  function rng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------------------------------------------------------------- formatting
  const VULGAR = {
    '1/2': '½', '1/3': '⅓', '2/3': '⅔', '1/4': '¼', '3/4': '¾', '1/5': '⅕', '2/5': '⅖', '3/5': '⅗',
    '4/5': '⅘', '1/6': '⅙', '5/6': '⅚', '1/8': '⅛', '3/8': '⅜', '5/8': '⅝', '7/8': '⅞',
  };
  /**
   * A friendly magnitude: whole numbers as digits, halves to eighths (and fifths, sixths) as
   * mixed fractions, anything else to one decimal place with "about". Returns
   * { text, exact } where exact says whether the text is the exact value.
   */
  function fmt(q) {
    const a = cmp(q, ZERO) < 0 ? neg(q) : q;
    const whole = a.n / a.d;
    const rem = Q(a.n - whole * a.d, a.d);
    if (rem.n === 0n) return { text: `${whole}`, exact: true };
    const key = `${rem.n}/${rem.d}`;
    if (VULGAR[key]) return { text: `${whole ? whole : ''}${VULGAR[key]}`, exact: true };
    const x = toNumber(a);
    const r = Math.round(x * 10) / 10;
    return { text: `about ${r === Math.round(r) ? r.toFixed(0) : r.toFixed(1)}`, exact: false };
  }

  // ---------------------------------------------------------------- merging and sharing
  const ID_RE = /^[a-z0-9]{4,24}$/;

  /** Check a circle read from storage or a pasted code; throws with a plain message if bad. */
  function validate(c) {
    const fail = (m) => {
      throw new Error(m);
    };
    if (!c || typeof c !== 'object') fail('not a circle');
    if (!ID_RE.test(c.id || '')) fail('bad circle id');
    if (typeof c.name !== 'string' || c.name.length > 80) fail('bad circle name');
    if (!KINDS.includes(c.kind)) fail('bad kind');
    if (!Array.isArray(c.members) || c.members.length > 60) fail('bad member list');
    const ids = new Set();
    for (const m of c.members) {
      if (!m || !ID_RE.test(m.id || '') || ids.has(m.id)) fail('bad member id');
      if (typeof m.name !== 'string' || !m.name.trim() || m.name.length > 40) fail('bad member name');
      if (!Number.isFinite(m.nameT || 0) || !Number.isFinite(m.goneT || 0)) fail('bad member time');
      ids.add(m.id);
    }
    if (!Array.isArray(c.events) || c.events.length > 20000) fail('bad event list');
    const eids = new Set();
    for (const e of c.events) {
      if (!e || !ID_RE.test(e.id || '') || eids.has(e.id)) fail('bad event id');
      if (!Number.isFinite(e.t)) fail('bad event time');
      if (!ids.has(e.by)) fail('event names someone not in the circle');
      if (!Array.isArray(e.who) || !e.who.length || e.who.some((w) => !ids.has(w))) fail('event names someone not in the circle');
      eids.add(e.id);
    }
    if (!Array.isArray(c.removed || []) || (c.removed || []).some((r) => !ID_RE.test(r))) fail('bad removed list');
    return true;
  }

  /** A canonical copy: sorted members-by-list-order kept, events sorted, sets deduplicated. */
  function normalize(c) {
    return {
      id: c.id,
      name: c.name,
      nameT: c.nameT || 0,
      kind: c.kind,
      created: c.created || 0,
      members: c.members.map((m) => ({ id: m.id, name: m.name, nameT: m.nameT || 0, gone: !!m.gone, goneT: m.goneT || 0, pos: m.pos ?? 0 })),
      events: liveEventsAll(c).map((e) => ({ id: e.id, t: e.t, by: e.by, who: [...new Set(e.who)].sort() })),
      removed: [...new Set(c.removed || [])].sort(),
    };
  }
  function liveEventsAll(c) {
    return (c.events || []).slice().sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  // Last-writer-wins on a (time, value) pair; ties go to the larger value so the result does
  // not depend on which side is "a".
  function lww(ta, va, tb, vb) {
    if (ta !== tb) return ta > tb ? [ta, va] : [tb, vb];
    return String(va) >= String(vb) ? [ta, va] : [tb, vb];
  }

  /**
   * Merge two copies of the same circle. Events and removals are unions (an event deleted on
   * either copy stays deleted); names and departures are last-writer-wins. The result does not
   * depend on the order of the arguments, and merging a copy into itself changes nothing.
   */
  function merge(a, b) {
    if (a.id !== b.id) throw new Error('different circles');
    if (a.kind !== b.kind) throw new Error('one copy counts turns and the other rounds');
    const [nameT, name] = lww(a.nameT || 0, a.name, b.nameT || 0, b.name);
    const mem = new Map();
    const put = (m) => {
      const old = mem.get(m.id);
      if (!old) {
        mem.set(m.id, { id: m.id, name: m.name, nameT: m.nameT || 0, gone: !!m.gone, goneT: m.goneT || 0, pos: m.pos ?? 0 });
        return;
      }
      const [nt, nm] = lww(old.nameT, old.name, m.nameT || 0, m.name);
      const [gt, gv] = lww(old.goneT, old.gone ? 1 : 0, m.goneT || 0, m.gone ? 1 : 0);
      mem.set(m.id, { id: m.id, name: nm, nameT: nt, gone: !!+gv, goneT: gt, pos: Math.min(old.pos, m.pos ?? 0) });
    };
    a.members.forEach(put);
    b.members.forEach(put);
    const members = [...mem.values()].sort((x, y) => x.pos - y.pos || (x.id < y.id ? -1 : 1));
    const ev = new Map();
    for (const e of [...a.events, ...b.events]) {
      const norm = { id: e.id, t: e.t, by: e.by, who: [...new Set(e.who)].sort() };
      const old = ev.get(e.id);
      if (!old || JSON.stringify(norm) > JSON.stringify(old)) ev.set(e.id, norm);
    }
    const events = [...ev.values()].sort((x, y) => x.t - y.t || (x.id < y.id ? -1 : 1));
    const removed = [...new Set([...(a.removed || []), ...(b.removed || [])])].sort();
    return { id: a.id, name, nameT, kind: a.kind, created: Math.min(a.created || 0, b.created || 0), members, events, removed };
  }

  // Compact wire form, prefixed so a stray paste is obvious. Members are a list; each event is
  // packed as "id~time~doer~present": time in whole seconds (base 36), the doer as a position in
  // the member list (base 36), and who was present as a bitmask over the member list (base 36).
  // Event times are whole seconds everywhere (the page logs them that way), so nothing is lost.
  const PREFIX = 'WHOSETURN1:';
  function toWire(c) {
    const n = normalize(c);
    const at = new Map(n.members.map((m, i) => [m.id, i]));
    const packed = n.events.map((e) => {
      let mask = 0n;
      for (const w of e.who) mask |= 1n << BigInt(at.get(w));
      return [e.id, Math.floor(e.t / 1000).toString(36), at.get(e.by).toString(36), mask.toString(36)].join('~');
    });
    return {
      i: n.id,
      n: n.name,
      nt: n.nameT,
      k: n.kind === 'rounds' ? 'r' : 't',
      c: n.created,
      m: n.members.map((m) => [m.id, m.name, m.nameT, m.gone ? 1 : 0, m.goneT, m.pos]),
      e: packed.join(','),
      x: n.removed,
    };
  }
  function parse36(s) {
    if (!/^[0-9a-z]{1,40}$/.test(s)) throw new Error('bad number');
    let v = 0n;
    for (const ch of s) v = v * 36n + BigInt(parseInt(ch, 36));
    return v;
  }
  function fromWire(w) {
    if (!w || typeof w !== 'object' || !Array.isArray(w.m) || typeof w.e !== 'string') throw new Error('not a ledger');
    const members = w.m.map((m) => {
      if (!Array.isArray(m)) throw new Error('not a ledger');
      return { id: m[0], name: m[1], nameT: +m[2] || 0, gone: !!m[3], goneT: +m[4] || 0, pos: +m[5] || 0 };
    });
    const events = (w.e ? w.e.split(',') : []).map((s) => {
      const p = s.split('~');
      if (p.length !== 4) throw new Error('not a ledger');
      const by = members[Number(parse36(p[2]))];
      const mask = parse36(p[3]);
      const who = members.filter((m, i) => (mask >> BigInt(i)) & 1n).map((m) => m.id);
      if (mask >> BigInt(members.length)) throw new Error('event names someone not in the circle');
      if (!by) throw new Error('event names someone not in the circle');
      return { id: p[0], t: Number(parse36(p[1])) * 1000, by: by.id, who };
    });
    const c = {
      id: w.i,
      name: w.n,
      nameT: +w.nt || 0,
      kind: w.k === 'r' ? 'rounds' : w.k === 't' ? 'turns' : '?',
      created: +w.c || 0,
      members,
      events,
      removed: Array.isArray(w.x) ? w.x : [],
    };
    validate(c);
    return c;
  }
  function b64urlEncode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlDecode(s) {
    const b = s.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b + '='.repeat((4 - (b.length % 4)) % 4));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }
  function encode(c) {
    return PREFIX + b64urlEncode(JSON.stringify(toWire(c)));
  }
  /** Find and decode a ledger code anywhere in a pasted text (a chat message, a link). */
  function decode(text) {
    const m = /WHOSETURN1:([A-Za-z0-9_-]+)/.exec(String(text || ''));
    if (!m) throw new Error('No ledger code found. It starts with WHOSETURN1:');
    if (m[1].length > 2_000_000) throw new Error('That code is too long.');
    let w;
    try {
      w = JSON.parse(b64urlDecode(m[1]));
    } catch {
      throw new Error('The code is damaged (perhaps cut short when it was copied).');
    }
    return fromWire(w);
  }

  return {
    Q, ZERO, add, sub, mul, neg, cmp, eq, toNumber, qstr, parseQ, qmax,
    KINDS, liveEvents, presentOf, eventDelta, ledger, balances, rank, pick,
    alphaOf, excess, promise, promiseIf, EXACT_TURNS, replay,
    simulate, worst, rng, fmt,
    validate, normalize, merge, encode, decode, toWire, fromWire,
  };
});
