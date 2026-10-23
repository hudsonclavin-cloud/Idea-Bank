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
 *   temp      always degrees Celsius in a plan (to 0.01°). °F is only a way of showing and typing them:
 *             formatTemp / displayTemp / tempFromDisplay convert at the edges.
 *   offset    minutes relative to the serve time. Negative is before. Everything is computed in offsets
 *             and turned into clock times only for display, so midnight is just arithmetic.
 *   schedule  the derived timeline: intervals, grouped events, oven stretches, conflicts.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Backtime = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Version 2 stores every temperature in °C. Version 1 stored whatever number was typed and only
  // relabelled it when the page was set to °F; validatePlan migrates those plans.
  const VERSION = 2;
  const DAY = 1440;
  // "now" up to this many minutes after serve still counts as after it (nowOffset); after that the
  // ticks of that cook are treated as finished (ticksStale).
  const AFTER_WINDOW = 360;
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
  // Room temperature, for working out how long an oven takes to climb from one setting to a hotter one.
  const ROOM_C = 20;
  // Temperatures are stored to 0.01 °C, so two that a cook would call equal can differ by a hair.
  // A clash needs the spread to beat the tolerance by more than this.
  const TEMP_EPS = 0.1;
  // In a version-1 plan saved while the page said °F, a number above this cannot be a home-oven °C
  // setting, so it must have been typed as °F. Anything at or below it is kept as °C (the presets and
  // the example, which is what most such plans hold). A guess; the page asks the cook to check.
  const LEGACY_F_ABOVE = 260;
  // Places that set ovens in Fahrenheit (CLDR temperature preference "fahrenheit").
  const FAHRENHEIT_REGIONS = new Set(['US', 'BS', 'BZ', 'KY', 'LR', 'PR', 'PW', 'FM', 'MH', 'GU', 'VI', 'AS', 'MP', 'UM']);
  const DEFAULT_TITLE = { oven: 'into the oven', hob: 'onto the hob', hands: 'hands on', rest: 'rest' };
  const TYPE_ORDER = { preheat: 0, ovenUp: 1, step: 2, ready: 3, ovenOff: 4, serve: 5 };

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

  function toNum(v, def, lo, hi) {
    if (typeof v === 'string') v = v.trim() === '' ? NaN : Number(v);
    if (typeof v !== 'number' || !Number.isFinite(v)) v = def;
    if (lo != null && v < lo) v = lo;
    if (hi != null && v > hi) v = hi;
    return Number.isNaN(v) ? v : Math.round(v * 100) / 100;
  }

  let graphemes = null;
  try {
    graphemes = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  } catch (e) {
    graphemes = null;
  }
  /* Cleans a name and cuts it to `max` user-perceived characters (grapheme clusters), so a flag, a
   * skin-tone emoji or a ZWJ family is kept whole or dropped whole. A single cluster can be built from
   * any number of combining marks, so the total is also held to 4 × max code points. Without
   * Intl.Segmenter it falls back to code points, which at least never splits a surrogate pair. */
  function toText(v, max) {
    let s = typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
    s = s.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim();
    const parts = graphemes ? Array.from(graphemes.segment(s), (x) => x.segment) : Array.from(s);
    let out = '';
    let points = 0;
    for (let i = 0; i < parts.length; i++) {
      const n = Array.from(parts[i]).length;
      if (i >= max || points + n > max * 4) return out.trim();
      out += parts[i];
      points += n;
    }
    return s;
  }

  // ---------- temperatures ----------

  const roundTemp = (c) => Math.round(c * 100) / 100;
  const cToF = (c) => (c * 9) / 5 + 32;
  const fToC = (f) => ((f - 32) * 5) / 9;
  const sameTemp = (a, b) => Math.abs(a - b) < 0.5;

  /* A stored °C temperature as the whole number a cook sees in `unit`. */
  function displayTemp(c, unit) {
    return Math.round(unit === 'F' ? cToF(c) : c);
  }
  /* A number typed in `unit` as the °C value to store (clamped to the limits). null if it isn't a number. */
  function tempFromDisplay(v, unit) {
    if (typeof v === 'string') v = v.trim() === '' ? NaN : Number(v);
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    const c = unit === 'F' ? fToC(v) : v;
    return roundTemp(Math.max(LIMITS.temp[0], Math.min(LIMITS.temp[1], c)));
  }
  /* A temperature difference (the clash tolerance): no +32, just the scale. */
  function displayDelta(dc, unit) {
    return Math.round(unit === 'F' ? (dc * 9) / 5 : dc);
  }
  function deltaFromDisplay(v, unit) {
    if (typeof v === 'string') v = v.trim() === '' ? NaN : Number(v);
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    const c = unit === 'F' ? (v * 5) / 9 : v;
    return roundTemp(Math.max(LIMITS.tolerance[0], Math.min(LIMITS.tolerance[1], c)));
  }
  /* A preset's °C setting as the cook would set it in `unit`: in °F, the nearest 25° (the cookbook
   * table: 180 °C = 350 °F, 190 = 375, 200 = 400, 220 = 425), stored back as °C. */
  function niceTemp(c, unit) {
    if (c == null) return null;
    return unit === 'F' ? roundTemp(fToC(Math.round(cToF(c) / 25) * 25)) : c;
  }
  /* 'F' for locales whose region sets ovens in Fahrenheit (en-US, or plain "en", which means US),
   * otherwise 'C'. */
  function unitForLocale(tag) {
    if (typeof tag !== 'string' || !tag) return 'C'; // "und" would maximize to en-US
    try {
      const loc = new Intl.Locale(tag.replace(/[@.].*$/, '').replace(/_/g, '-')); // also "en_US.UTF-8", "en-US@posix"
      const region = loc.region || (loc.maximize && loc.maximize().region);
      return FAHRENHEIT_REGIONS.has(region) ? 'F' : 'C';
    } catch (e) {
      return 'C';
    }
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
      ovenTolerance: 25, // °C, like every temperature in a plan (45 °F)
      tempUnit: null, // how to show temperatures: 'C', 'F', or null for the browser's locale
      hour12: null,
      sound: false,
      dishes: [],
      done: {},
      doneFor: null, // epoch ms of the serve time the ticks in `done` belong to (see cookOccasion)
    };
  }

  /* Takes anything (parsed JSON from a file, a URL, localStorage, or garbage) and returns a plan that
   * every other function here can trust. Never throws. `ok` is false when the input was not a plan
   * at all; `problems` lists what had to be fixed. `migrated` is set when a version-1 plan saved in °F
   * mode had its temperatures sorted into °F and °C (see LEGACY_F_ABOVE). */
  function validatePlan(input) {
    const problems = [];
    const plan = emptyPlan();
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return { ok: false, plan, problems: ['not a plan object'], migrated: null };
    }
    const ok = Array.isArray(input.dishes);
    if (!ok) problems.push('no list of dishes');

    // Anything without a version (hand-written, or older) is read as version 1.
    const legacy = toInt(input.version, 1, 0, 1e6) < 2;
    const unitIn = input.tempUnit === 'F' ? 'F' : input.tempUnit === 'C' ? 'C' : null;
    const legacyF = legacy && unitIn === 'F';
    const migrated = legacyF ? { from: 1, asF: 0, asC: 0 } : null;

    plan.serveAt = toInt(input.serveAt, plan.serveAt, 0, DAY - 1);
    plan.preheat = toInt(input.preheat, plan.preheat, LIMITS.preheat[0], LIMITS.preheat[1]);
    plan.hobRings = toInt(input.hobRings, plan.hobRings, LIMITS.hobRings[0], LIMITS.hobRings[1]);
    // A version-1 tolerance was compared with the raw numbers, which were mostly °C presets: kept as °C.
    plan.ovenTolerance = toNum(input.ovenTolerance, plan.ovenTolerance, LIMITS.tolerance[0], LIMITS.tolerance[1]);
    // Version 1 always wrote 'C' unless the cook chose °F, so its 'C' means "never chosen": follow the locale.
    plan.tempUnit = legacy ? (unitIn === 'F' ? 'F' : null) : unitIn;
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
          let t = toNum(s.temp, NaN);
          if (Number.isNaN(t)) problems.push(`dish ${di + 1} step ${si + 1}: temperature was not a number`);
          else {
            if (legacyF) {
              if (t > LEGACY_F_ABOVE) {
                t = fToC(t);
                migrated.asF++;
              } else migrated.asC++;
            }
            temp = roundTemp(Math.max(LIMITS.temp[0], Math.min(LIMITS.temp[1], t)));
          }
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
    const df = input.doneFor;
    const ticked = Object.keys(plan.done).length > 0;
    plan.doneFor = ticked && typeof df === 'number' && Number.isFinite(df) && df > 0 && df < 8.64e15 ? Math.round(df) : null;
    if (migrated && migrated.asF + migrated.asC) {
      problems.push(`an older version showed °C numbers labelled °F: read ${migrated.asF} temperature${migrated.asF === 1 ? '' : 's'} as °F and ${migrated.asC} as °C`);
    }
    return { ok, plan, problems, migrated: migrated && migrated.asF + migrated.asC ? migrated : null };
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

  /* A stored °C temperature for display: "200°C", or "392°F" in Fahrenheit. */
  function formatTemp(temp, unit) {
    return temp == null ? '' : `${displayTemp(temp, unit)}°${unit === 'F' ? 'F' : 'C'}`;
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

  /* Minutes an oven needs to climb from `from` to a hotter `to`, taking a full preheat as the time from
   * room temperature: preheat × rise / (to − room), rounded up to 5 min and never more than a preheat.
   * 15 min to reach 200 °C makes 200 → 220 °C a 5-minute lead. */
  function riseLead(preheat, from, to) {
    if (!(preheat > 0) || !(to > from)) return 0;
    const share = (to - from) / Math.max(to - ROOM_C, to - from);
    return Math.min(preheat, Math.ceil((preheat * share) / 5 - 1e-9) * 5);
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
    // The dial is whatever went in last. Turning it UP takes time, the same way a cold start takes a
    // preheat, so a rise gets its own "oven up" job a lead time before the hotter step (riseLead), and
    // that lead counts as oven time at the hotter setting in the clash check. Turning it down is noted
    // on the step itself: the oven is already hot enough to start.
    const leads = [];
    stretches.forEach((st, si) => {
      const pre = { type: 'preheat', key: `preheat:${si}`, temp: st.items[0].temp, minutes: plan.preheat };
      let dial = pre.temp;
      for (const iv of st.items) {
        if (iv.temp == null || (dial != null && sameTemp(iv.temp, dial))) continue;
        if (dial != null && iv.temp > dial) {
          const lead = riseLead(plan.preheat, dial, iv.temp);
          const at = iv.start - lead;
          if (at <= st.start) {
            pre.temp = iv.temp; // the rise would start before anything is in: just preheat hotter
          } else {
            events.push({
              at,
              item: { type: 'ovenUp', key: `ovenup:${iv.dishId}/${iv.stepId}`, temp: iv.temp, minutes: lead, dishId: iv.dishId, dishIndex: iv.dishIndex, stepIndex: iv.stepIndex, dishName: dishName(iv) },
            });
          }
          const from = Math.max(at, st.start);
          if (iv.start > from) leads.push({ dishIndex: iv.dishIndex, dishName: iv.dishName, kind: 'oven', minutes: iv.start - from, start: from, end: iv.start, temp: iv.temp });
        } else iv.ovenTo = iv.temp;
        dial = iv.temp;
      }
      st.temp = pre.temp;
      events.push({ at: st.start - plan.preheat, item: pre });
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
    const ovens = intervals.filter((i) => i.kind === 'oven' && i.minutes > 0 && i.temp != null).concat(leads);
    const ovenSegs = sweep(ovens)
      .map((s) => {
        const temps = s.active.map((i) => i.temp);
        const names = [];
        for (const i of s.active) if (!names.includes(dishName(i))) names.push(dishName(i));
        return { from: s.from, to: s.to, low: Math.min(...temps), high: Math.max(...temps), dishes: names };
      })
      .filter((s) => s.high - s.low > plan.ovenTolerance + TEMP_EPS);
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
    if (d > AFTER_WINDOW) d -= DAY;
    else if (d <= AFTER_WINDOW - DAY) d += DAY;
    return d;
  }

  /* The moment (epoch ms, local time) nearest to `ms` whose clock reads `minuteOfDay`. */
  function nearestClock(minuteOfDay, ms) {
    const d = new Date(ms);
    let best = null;
    for (const k of [-1, 0, 1]) {
      const t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + k, Math.floor(minuteOfDay / 60), minuteOfDay % 60).getTime();
      if (best == null || Math.abs(t - ms) < Math.abs(best - ms)) best = t;
    }
    return best;
  }

  /* Ticks carry no date of their own, so a plan remembers which serve they were for: the serve time
   * nearest to "the moment this job was due, if it is being done now" (now − its offset). That puts a
   * brine ticked two days early on the right dinner, and survives being up to 12 hours early or late. */
  function cookOccasion(serveAt, at, nowMs) {
    return nearestClock(serveAt, nowMs - at * 60000);
  }

  /* True when the ticks belong to a cook that has finished: more than AFTER_WINDOW minutes (or an hour
   * past the last job, if that is later) after the serve they were for. Last Sunday's ticks are then
   * not applied to this Sunday. */
  function ticksStale(plan, endAt, nowMs) {
    if (!plan.doneFor || !Object.keys(plan.done || {}).length) return false;
    return nowMs - plan.doneFor > Math.max(AFTER_WINDOW, (endAt || 0) + 60) * 60000;
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
    const copy = Object.assign({}, plan, { done: undefined, doneFor: undefined });
    return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(copy)));
  }

  /* A link's plan with validatePlan's full report (problems, migrated), or null if it holds no plan. */
  function readLink(str) {
    try {
      if (typeof str !== 'string' || !str) return null;
      const json = new TextDecoder().decode(base64UrlToBytes(str));
      const v = validatePlan(JSON.parse(json));
      return v.ok ? v : null;
    } catch (e) {
      return null;
    }
  }

  function decodePlan(str) {
    const v = readLink(str);
    return v ? v.plan : null;
  }

  // ---------- the worked example ----------

  /* The roast dinner the page opens with. Temperatures are written in °C; in °F they become the
   * cookbook equivalents (niceTemp), so a US cook sees 400 °F rather than 392 °F. */
  function examplePlan(unit) {
    const plan = emptyPlan(19 * 60);
    const dish = (id, name, readyBefore, steps) => ({
      id,
      name,
      readyBefore,
      steps: steps.map((s, i) => ({ id: `s${i + 1}`, label: s[0], minutes: s[1], kind: s[2], temp: s[3] == null ? null : niceTemp(s[3], unit) })),
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
        ['Tin with fat into the oven, until smoking', 10, 'oven', 220],
        ['Batter into the hot tin', 2, 'hands'],
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
    AFTER_WINDOW,
    LEGACY_F_ABOVE,
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
    displayTemp,
    tempFromDisplay,
    displayDelta,
    deltaFromDisplay,
    niceTemp,
    unitForLocale,
    riseLead,
    stepTitle,
    schedule,
    nextItem,
    nowOffset,
    nearestClock,
    cookOccasion,
    ticksStale,
    earliestServe,
    summarizeDish,
    encodePlan,
    decodePlan,
    readLink,
    examplePlan,
    newId,
  };
});
