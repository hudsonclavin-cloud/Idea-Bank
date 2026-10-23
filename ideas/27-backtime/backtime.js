/* Backtime — core logic. Pure functions, no DOM, no dependencies.
 *
 * UMD-style so that index.html can load it with a plain <script> (including from file://)
 * and Node can require() it for the tests.
 *
 * Vocabulary
 *   plan      what the cook typed: a serve time, some dishes, a few settings, and which jobs are ticked.
 *   dish      a name, an ordered list of steps, and `readyBefore` (minutes before serve it must be done;
 *             negative means after serve, which is how dessert works).
 *   step      { label, minutes, kind, temp }. kind is 'oven' | 'hob' | 'hands' | 'rest'.
 *   offset    minutes relative to the serve time. Negative is before. Everything is computed in offsets
 *             and turned into clock times only for display, so midnight is just arithmetic.
 *   schedule  the derived timeline: intervals, grouped events, oven stretches, conflicts.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Backtime = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = 1;
  const DAY = 1440;
  const KINDS = ['oven', 'hob', 'hands', 'rest'];
  const LIMITS = Object.freeze({
    dishes: 40,
    steps: 30,
    minutes: 20160, // 14 days, for brines and doughs
    readyBefore: 20160,
    name: 80,
    temp: [0, 999],
    preheat: [0, 180],
    hobRings: [0, 12],
    tolerance: [0, 300],
    doneKeys: 4000,
  });
  // If the oven would be empty for this long or less, the plan leaves it on rather than
  // turning it off and preheating again.
  const KEEP_OVEN_ON_GAP = 30;
  const DEFAULT_TITLE = { oven: 'into the oven', hob: 'onto the hob', hands: 'hands on', rest: 'rest' };
  const TYPE_ORDER = { preheat: 0, step: 1, ready: 2, ovenOff: 3, serve: 4 };

  // ---------- small helpers ----------

  function pad(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function toInt(v, def, lo, hi) {
    if (typeof v === 'string') v = v.trim() === '' ? NaN : Number(v);
    if (typeof v !== 'number' || !Number.isFinite(v)) v = def;
    v = Math.round(v);
    if (lo != null && v < lo) v = lo;
    if (hi != null && v > hi) v = hi;
    return v;
  }

  function toText(v, max) {
    let s = typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
    s = s.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim();
    const chars = Array.from(s); // never cut an emoji in half
    return chars.length > max ? chars.slice(0, max).join('') : s;
  }

  function newId(prefix, taken) {
    let id;
    let n = taken.size + 1;
    do {
      id = prefix + n++;
    } while (taken.has(id));
    taken.add(id);
    return id;
  }

  function cloneId(v, prefix, taken) {
    if (typeof v === 'string' && /^[A-Za-z0-9_-]{1,24}$/.test(v) && !taken.has(v)) {
      taken.add(v);
      return v;
    }
    return newId(prefix, taken);
  }

  // ---------- plans ----------

  function emptyPlan(serveAt) {
    return {
      version: VERSION,
      serveAt: typeof serveAt === 'number' ? serveAt : 19 * 60,
      preheat: 15,
      hobRings: 4,
      ovenTolerance: 25,
      tempUnit: 'C',
      hour12: null,
      sound: false,
      dishes: [],
      done: {},
    };
  }

  /* Takes anything (parsed JSON from a file, a URL, localStorage, or garbage) and returns a plan that
   * every other function here can trust. Never throws. `ok` is false when the input was not a plan
   * at all; `problems` lists what had to be fixed. */
  function validatePlan(input) {
    const problems = [];
    const plan = emptyPlan();
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return { ok: false, plan, problems: ['not a plan object'] };
    }
    const ok = Array.isArray(input.dishes);
    if (!ok) problems.push('no list of dishes');

    plan.serveAt = toInt(input.serveAt, plan.serveAt, 0, DAY - 1);
    plan.preheat = toInt(input.preheat, plan.preheat, LIMITS.preheat[0], LIMITS.preheat[1]);
    plan.hobRings = toInt(input.hobRings, plan.hobRings, LIMITS.hobRings[0], LIMITS.hobRings[1]);
    plan.ovenTolerance = toInt(input.ovenTolerance, plan.ovenTolerance, LIMITS.tolerance[0], LIMITS.tolerance[1]);
    plan.tempUnit = input.tempUnit === 'F' ? 'F' : 'C';
    plan.hour12 = input.hour12 === true ? true : input.hour12 === false ? false : null;
    plan.sound = input.sound === true;

    const dishIds = new Set();
    const rawDishes = ok ? input.dishes : [];
    if (rawDishes.length > LIMITS.dishes) problems.push(`kept the first ${LIMITS.dishes} of ${rawDishes.length} dishes`);
    rawDishes.slice(0, LIMITS.dishes).forEach((d, di) => {
      if (!d || typeof d !== 'object' || Array.isArray(d)) {
        problems.push(`dish ${di + 1} was not a dish and was dropped`);
        return;
      }
      const dish = {
        id: cloneId(d.id, 'd', dishIds),
        name: toText(d.name, LIMITS.name),
        readyBefore: toInt(d.readyBefore, 0, -LIMITS.readyBefore, LIMITS.readyBefore),
        steps: [],
      };
      const stepIds = new Set();
      const rawSteps = Array.isArray(d.steps) ? d.steps : [];
      if (!Array.isArray(d.steps)) problems.push(`dish ${di + 1} had no steps`);
      if (rawSteps.length > LIMITS.steps) problems.push(`dish ${di + 1}: kept the first ${LIMITS.steps} of ${rawSteps.length} steps`);
      rawSteps.slice(0, LIMITS.steps).forEach((s, si) => {
        if (!s || typeof s !== 'object' || Array.isArray(s)) {
          problems.push(`dish ${di + 1} step ${si + 1} was not a step and was dropped`);
          return;
        }
        const kind = KINDS.includes(s.kind) ? s.kind : 'hands';
        if (kind !== s.kind) problems.push(`dish ${di + 1} step ${si + 1}: unknown kind "${String(s.kind).slice(0, 20)}", set to hands-on`);
        const minutes = toInt(s.minutes, NaN, 0, LIMITS.minutes);
        if (Number.isNaN(minutes)) problems.push(`dish ${di + 1} step ${si + 1}: minutes was not a number, set to 0`);
        let temp = null;
        if (kind === 'oven' && s.temp != null && s.temp !== '') {
          const t = toInt(s.temp, NaN, LIMITS.temp[0], LIMITS.temp[1]);
          if (Number.isNaN(t)) problems.push(`dish ${di + 1} step ${si + 1}: temperature was not a number`);
          else temp = t;
        }
        dish.steps.push({
          id: cloneId(s.id, 's', stepIds),
          label: toText(s.label, LIMITS.name),
          minutes: Number.isNaN(minutes) ? 0 : minutes,
          kind,
          temp,
        });
      });
      plan.dishes.push(dish);
    });

    if (input.done && typeof input.done === 'object' && !Array.isArray(input.done)) {
      let n = 0;
      for (const k of Object.keys(input.done)) {
        if (n >= LIMITS.doneKeys) break;
        if (input.done[k] && k.length <= 64) {
          plan.done[k] = true;
          n++;
        }
      }
    }
    return { ok, plan, problems };
  }

  // ---------- durations and clocks ----------

  /* "90", "1h20", "1:20", "1.5h", "20m", "2 days" -> minutes. null when it isn't a duration. */
  function parseMinutes(s) {
    if (typeof s === 'number') return Number.isFinite(s) ? Math.max(0, Math.round(s)) : null;
    if (typeof s !== 'string') return null;
    const t = s.trim().toLowerCase().replace(/\s+/g, '');
    if (!t) return null;
    let m;
    if (/^\d+$/.test(t)) return Number(t);
    if ((m = t.match(/^(\d+):(\d{1,2})$/))) return Number(m[1]) * 60 + Number(m[2]);
    if ((m = t.match(/^(\d+(?:\.\d+)?)(?:d|day|days)$/))) return Math.round(Number(m[1]) * DAY);
    m = t.match(/^(?:(\d+(?:\.\d+)?)(?:h|hr|hrs|hour|hours))?(?:(\d+)(?:m|min|mins|minute|minutes)?)?$/);
    if (m && (m[1] != null || m[2] != null)) return Math.round(Number(m[1] || 0) * 60 + Number(m[2] || 0));
    return null;
  }

  /* "19:00", "7:00 pm", "7pm" -> minutes since midnight. null when it isn't a time. */
  function parseTime(s) {
    if (typeof s !== 'string') return null;
    const m = s.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
    if (!m) return null;
    let h = Number(m[1]);
    const min = Number(m[2] || 0);
    if (min > 59) return null;
    if (m[3]) {
      if (h < 1 || h > 12) return null;
      h = (h % 12) + (m[3] === 'pm' ? 12 : 0);
    } else if (h > 23) return null;
    return h * 60 + min;
  }

  function formatDuration(min) {
    min = Math.max(0, Math.round(min));
    if (min === 0) return '0 min';
    const d = Math.floor(min / DAY);
    const h = Math.floor((min % DAY) / 60);
    const m = min % 60;
    const parts = [];
    if (d) parts.push(d === 1 ? '1 day' : `${d} days`);
    if (h) parts.push(`${h} h`);
    if (m) parts.push(`${m} min`);
    return parts.slice(0, 2).join(' ');
  }

  function formatClock(minute, hour12) {
    minute = ((Math.round(minute) % DAY) + DAY) % DAY;
    const h = Math.floor(minute / 60);
    const m = minute % 60;
    if (!hour12) return `${pad(h)}:${pad(m)}`;
    return `${h % 12 || 12}:${pad(m)} ${h < 12 ? 'am' : 'pm'}`;
  }

  function formatDay(day) {
    if (day === 0) return '';
    if (day === -1) return 'the day before';
    if (day < -1) return `${-day} days before`;
    if (day === 1) return 'the day after';
    return `${day} days after`;
  }

  /* serve time + offset -> { minute (0..1439), day (0 = serve day, -1 = the day before) } */
  function clockOf(serveAt, offset) {
    const abs = serveAt + offset;
    const day = Math.floor(abs / DAY);
    return { day, minute: abs - day * DAY };
  }

  function formatAt(serveAt, offset, hour12) {
    const c = clockOf(serveAt, offset);
    const d = formatDay(c.day);
    return formatClock(c.minute, hour12) + (d ? ' ' + d : '');
  }

  function formatTemp(temp, unit) {
    return temp == null ? '' : `${temp}°${unit === 'F' ? 'F' : 'C'}`;
  }

  // ---------- the schedule ----------

  function stepTitle(step) {
    return step.label || DEFAULT_TITLE[step.kind] || 'step';
  }

  /* Elementary segments between consecutive breakpoints, with the intervals covering each one. */
  function sweep(list) {
    const points = Array.from(new Set(list.flatMap((i) => [i.start, i.end]))).sort((a, b) => a - b);
    const segs = [];
    for (let k = 0; k < points.length - 1; k++) {
      const a = points[k];
      const b = points[k + 1];
      segs.push({ from: a, to: b, active: list.filter((i) => i.start <= a && i.end >= b) });
    }
    return segs;
  }

  function mergeSegs(segs, extra) {
    const out = [];
    for (const s of segs) {
      const last = out[out.length - 1];
      if (last && last.to === s.from) {
        last.to = s.to;
        for (const n of s.dishes) if (!last.dishes.includes(n)) last.dishes.push(n);
        if (extra) extra(last, s);
      } else out.push(s);
    }
    return out;
  }

  function schedule(plan) {
    const intervals = [];
    plan.dishes.forEach((d, di) => {
      let end = 0 - (d.readyBefore || 0); // 0 - x rather than -x so that 0 never becomes -0
      for (let i = d.steps.length - 1; i >= 0; i--) {
        const s = d.steps[i];
        const start = end - s.minutes;
        intervals.push({
          dishId: d.id,
          dishIndex: di,
          dishName: d.name,
          stepId: s.id,
          stepIndex: i,
          label: s.label,
          title: stepTitle(s),
          kind: s.kind,
          temp: s.kind === 'oven' ? s.temp : null,
          minutes: s.minutes,
          start,
          end,
          ovenTo: null,
        });
        end = start;
      }
    });
    intervals.sort((a, b) => a.start - b.start || a.dishIndex - b.dishIndex || a.stepIndex - b.stepIndex);

    const events = [];
    const dishName = (iv) => iv.dishName || `Dish ${iv.dishIndex + 1}`;

    // Oven stretches: runs of oven use separated by gaps too short to bother switching off.
    const gap = Math.max(KEEP_OVEN_ON_GAP, plan.preheat);
    const stretches = [];
    for (const iv of intervals) {
      if (iv.kind !== 'oven' || iv.minutes <= 0) continue;
      const cur = stretches[stretches.length - 1];
      if (cur && iv.start <= cur.end + gap) {
        cur.end = Math.max(cur.end, iv.end);
        cur.items.push(iv);
      } else stretches.push({ start: iv.start, end: iv.end, items: [iv] });
    }
    stretches.forEach((st, si) => {
      let dial = st.items[0].temp;
      st.temp = dial;
      events.push({
        at: st.start - plan.preheat,
        item: { type: 'preheat', key: `preheat:${si}`, temp: dial, minutes: plan.preheat },
      });
      for (const iv of st.items) {
        if (iv.temp != null && iv.temp !== dial) {
          iv.ovenTo = iv.temp;
          dial = iv.temp;
        }
      }
      if (st.end < 0) events.push({ at: st.end, item: { type: 'ovenOff', key: `ovenoff:${si}` } });
    });

    for (const iv of intervals) {
      events.push({
        at: iv.start,
        item: {
          type: 'step',
          key: `${iv.dishId}/${iv.stepId}`,
          dishId: iv.dishId,
          dishIndex: iv.dishIndex,
          dishName: dishName(iv),
          stepId: iv.stepId,
          stepIndex: iv.stepIndex,
          title: iv.title,
          kind: iv.kind,
          temp: iv.temp,
          ovenTo: iv.ovenTo,
          minutes: iv.minutes,
        },
      });
    }
    plan.dishes.forEach((d, di) => {
      if (d.readyBefore > 0 && d.steps.length) {
        events.push({
          at: 0 - d.readyBefore,
          item: { type: 'ready', key: `${d.id}/ready`, dishId: d.id, dishIndex: di, dishName: d.name || `Dish ${di + 1}`, minutes: d.readyBefore },
        });
      }
    });
    events.push({ at: 0, item: { type: 'serve', key: 'serve' } });

    events.sort(
      (a, b) =>
        a.at - b.at ||
        TYPE_ORDER[a.item.type] - TYPE_ORDER[b.item.type] ||
        (a.item.dishIndex || 0) - (b.item.dishIndex || 0) ||
        (a.item.stepIndex || 0) - (b.item.stepIndex || 0),
    );
    const groups = [];
    for (const e of events) {
      const g = groups[groups.length - 1];
      if (g && g.at === e.at) g.items.push(e.item);
      else groups.push({ at: e.at, items: [e.item] });
    }

    // Conflicts.
    const conflicts = [];
    const ovens = intervals.filter((i) => i.kind === 'oven' && i.minutes > 0 && i.temp != null);
    const ovenSegs = sweep(ovens)
      .map((s) => {
        const temps = s.active.map((i) => i.temp);
        return { from: s.from, to: s.to, low: Math.min(...temps), high: Math.max(...temps), dishes: s.active.map(dishName) };
      })
      .filter((s) => s.high - s.low > plan.ovenTolerance);
    for (const s of mergeSegs(ovenSegs, (a, b) => {
      a.low = Math.min(a.low, b.low);
      a.high = Math.max(a.high, b.high);
    })) conflicts.push({ type: 'oven', from: s.from, to: s.to, low: s.low, high: s.high, dishes: s.dishes });

    if (plan.hobRings > 0) {
      const hobs = intervals.filter((i) => i.kind === 'hob' && i.minutes > 0);
      const hobSegs = sweep(hobs)
        .filter((s) => s.active.length > plan.hobRings)
        .map((s) => ({ from: s.from, to: s.to, count: s.active.length, dishes: s.active.map(dishName) }));
      for (const s of mergeSegs(hobSegs, (a, b) => {
        a.count = Math.max(a.count, b.count);
      })) conflicts.push({ type: 'hob', from: s.from, to: s.to, count: s.count, rings: plan.hobRings, dishes: s.dishes });
    }

    const hands = intervals.filter((i) => i.kind === 'hands' && i.minutes > 0);
    const handSegs = sweep(hands)
      .filter((s) => s.active.length >= 2)
      .map((s) => ({ from: s.from, to: s.to, dishes: s.active.map(dishName) }));
    for (const s of mergeSegs(handSegs)) conflicts.push({ type: 'hands', from: s.from, to: s.to, dishes: s.dishes });

    const startAt = groups[0].at;
    const endAt = groups[groups.length - 1].at;
    return {
      serveAt: plan.serveAt,
      intervals,
      events: groups,
      stretches,
      conflicts,
      startAt,
      endAt,
      span: 0 - startAt,
      dishCount: plan.dishes.length,
      jobCount: events.length - 1,
    };
  }

  /* First event item that hasn't been ticked, in timeline order. */
  function nextItem(sched, done) {
    for (const g of sched.events) {
      for (const item of g.items) {
        if (!done || !done[item.key]) return { at: g.at, item };
      }
    }
    return null;
  }

  // ---------- live time ----------

  /* Where "now" (minutes since midnight, fractions allowed) sits relative to the serve time, on the
   * assumption that you are cooking today: a clock time up to 18 h before serve counts as before it,
   * up to 6 h after as after it. Without a date there is no other way to decide. */
  function nowOffset(serveAt, nowMinute) {
    let d = nowMinute - serveAt;
    if (d > 360) d -= DAY;
    else if (d <= -1080) d += DAY;
    return d;
  }

  /* If you started the first job right now, when is the earliest you could serve? Rounded up to 5 min. */
  function earliestServe(plan, nowMinute) {
    const sched = schedule(plan);
    const raw = nowMinute + sched.span;
    const rounded = Math.ceil(raw / 5) * 5;
    return { serveAt: ((rounded % DAY) + DAY) % DAY, inMinutes: rounded - nowMinute, span: sched.span };
  }

  // ---------- summaries, export ----------

  function summarizeDish(dish, unit) {
    if (!dish.steps.length) return 'no steps yet';
    return dish.steps
      .map((s) => {
        const bits = [stepTitle(s)];
        if (s.kind === 'oven' && s.temp != null) bits.push(formatTemp(s.temp, unit));
        bits.push(formatDuration(s.minutes));
        return bits.join(' ');
      })
      .join(' → ');
  }

  function bytesToBase64Url(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function base64UrlToBytes(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  /* A plan as a URL-safe string (for a shareable link). Ticks are left out: a link is a recipe, not a session. */
  function encodePlan(plan) {
    const copy = Object.assign({}, plan, { done: undefined });
    return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(copy)));
  }

  function decodePlan(str) {
    try {
      if (typeof str !== 'string' || !str) return null;
      const json = new TextDecoder().decode(base64UrlToBytes(str));
      const v = validatePlan(JSON.parse(json));
      return v.ok ? v.plan : null;
    } catch (e) {
      return null;
    }
  }

  // ---------- the worked example ----------

  function examplePlan() {
    const plan = emptyPlan(19 * 60);
    const dish = (id, name, readyBefore, steps) => ({
      id,
      name,
      readyBefore,
      steps: steps.map((s, i) => ({ id: `s${i + 1}`, label: s[0], minutes: s[1], kind: s[2], temp: s[3] == null ? null : s[3] })),
    });
    plan.dishes = [
      dish('chicken', 'Roast chicken', 0, [
        ['In the oven', 80, 'oven', 200],
        ['Out to rest, loosely covered', 25, 'rest'],
        ['Carve', 5, 'hands'],
      ]),
      dish('potatoes', 'Roast potatoes', 0, [
        ['Parboil', 12, 'hob'],
        ['Drain, shake, into hot fat', 3, 'hands'],
        ['In the oven', 55, 'oven', 200],
      ]),
      dish('yorkshires', 'Yorkshire puddings', 3, [
        ['Batter into the smoking-hot tin', 2, 'hands'],
        ['In the oven, no peeking', 22, 'oven', 220],
      ]),
      dish('carrots', 'Carrots', 0, [['Simmer', 15, 'hob']]),
      dish('gravy', 'Gravy', 0, [['In the roasting tin', 10, 'hob']]),
      dish('greens', 'Greens', 0, [['Boil', 5, 'hob']]),
    ];
    return plan;
  }

  return {
    VERSION,
    DAY,
    KINDS,
    LIMITS,
    KEEP_OVEN_ON_GAP,
    emptyPlan,
    validatePlan,
    parseMinutes,
    parseTime,
    formatDuration,
    formatClock,
    formatDay,
    clockOf,
    formatAt,
    formatTemp,
    stepTitle,
    schedule,
    nextItem,
    nowOffset,
    earliestServe,
    summarizeDish,
    encodePlan,
    decodePlan,
    examplePlan,
    newId,
  };
});
