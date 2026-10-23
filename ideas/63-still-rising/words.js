/*
 * words.js: the feedback sentences, built from the exact numbers. No DOM.
 *
 * Every sentence the page says after an answer comes from here, so the tests
 * can check that the numbers and times it quotes are the computed ones.
 *
 * Loads as a classic browser script (window.TubWords) and under Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module && module.exports) module.exports = factory(require('./tub.js'));
  else root.TubWords = factory(root.Tub);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Tub) {
  'use strict';

  const fmtNum = Tub.fmtNum;

  // Count stocks ("people in the shop") are spoken of as "the number of ...".
  function counted(item) {
    return /^(people|cars|patients|pallets|emails|bugs|open|occupied|parcels|tickets)\b/.test(item.stock);
  }

  function subject(item) {
    return counted(item) ? `the number of ${item.stock}` : `the ${item.stock}`;
  }

  // Round for a sentence: whole numbers for counts and from 100 up, else one decimal.
  function nice(v, whole) {
    const a = Math.abs(v);
    if (whole || a >= 100) return fmtNum(Math.round(v));
    const r = Math.round(v * 10) / 10;
    return fmtNum(r, Math.abs(r - Math.round(r)) < 1e-9 ? 0 : 1);
  }

  // A number with its unit; money units put the $ in front ("$1,400", "$55k a month").
  function withUnit(text, unit) {
    if (unit.startsWith('$k')) return `$${text}k${unit.slice(2)}`;
    if (unit.startsWith('$')) return `$${text}${unit.slice(1)}`;
    return `${text} ${unit}`;
  }

  function level(item, v) {
    return withUnit(nice(v, counted(item)), item.stockUnit);
  }

  function rate(item, v) {
    return withUnit(nice(v), item.flowUnit);
  }

  // A moment, rounded for reading: clock times to 5 minutes, years to whole
  // years, other counters to whole units, or to 0.1 where the exercise lets
  // you pick finer than whole units (so a crossing at 5.67 reads 5.7).
  function when(item, t) {
    const tm = item.time;
    let r = t;
    if (tm.unit === 'clock') r = Math.round(t * 12) / 12;
    else if (tm.unit === 'year') r = Math.round(t);
    else if (tm.unit !== 'calendar') r = (tm.snap || 1) < 1 ? Math.round(t * 10) / 10 : Math.round(t);
    return Tub.fmtTime(tm, r);
  }

  // The same, with the right preposition: "at 21:25", "on day 22", "in early October".
  function whenP(item, t) {
    const tm = item.time;
    const w = when(item, t);
    if (tm.unit === 'clock') return `at ${w}`;
    if (tm.unit === 'calendar' || tm.unit === 'year') return `in ${w}`;
    if (tm.word === 'day') return `on ${w}`;
    if (tm.word === 'minute') return `at ${w}`;
    return `in ${w}`;
  }

  function cap(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // "“coming in” 15 and “going out” 9 (people a minute)"
  function pair(item, t) {
    const a = nice(Tub.inAt(item, t));
    const b = nice(Tub.outAt(item, t));
    return `“${item.inName}” ${a}, “${item.outName}” ${b} (${item.flowUnit})`;
  }

  /* ----- Which way? ----- */
  function dirFeedback(item, answer) {
    const t = item.at;
    const truth = Tub.direction(item, t);
    const ok = answer === truth;
    const d = (item.time.to - item.time.from) / 100;
    const lo = Math.max(item.time.from, t - d);
    const hi = Math.min(item.time.to, t + d);
    const inTrend = Tub.inAt(item, hi) - Tub.inAt(item, lo);
    const outTrend = Tub.outAt(item, hi) - Tub.outAt(item, lo);
    const lines = [];
    lines.push(`${cap(when(item, t))}: ${pair(item, t)}.`);
    const S = subject(item);
    if (truth === 'rising') {
      let s = `More in than out, so ${S} is rising`;
      if (inTrend < 0) s += `, even though the “${item.inName}” line is falling`;
      else if (outTrend > 0) s += `, even though the “${item.outName}” line is climbing`;
      lines.push(s + '.');
    } else if (truth === 'falling') {
      let s = `More out than in, so ${S} is falling`;
      if (inTrend > 0) s += `, even though the “${item.inName}” line is climbing`;
      else if (outTrend < 0) s += `, even though the “${item.outName}” line is falling`;
      lines.push(s + '.');
    } else {
      lines.push(`In equals out, so ${S} is holding steady, whatever either line did before.`);
    }
    if (!ok) lines.push('Which way a stock moves depends only on which line is on top, not on which way either line is heading.');
    return { ok, truth, lines };
  }

  /* ----- Fullest and emptiest ----- */
  function extremeFeedback(item, which, tTap) {
    const ex = Tub.extremes(item);
    const best = which === 'max' ? ex.max : ex.min;
    const t0 = item.time.from;
    const t1 = item.time.to;
    const diag = Tub.diagnoseExtreme(item, which, tTap);
    const ok = diag === 'ok';
    const hi = which === 'max' ? 'highest' : 'lowest';
    const S = subject(item);
    const lines = [];
    const at = when(item, tTap);
    if (!ok) {
      if (diag === 'localTurn') {
        lines.push(`${cap(at)} is a turning point, but not the ${hi} one: ${S} turned again later and went ${which === 'max' ? 'higher' : 'lower'}. When the lines cross more than once, compare the areas between them.`);
      } else if (diag === 'inflowPeak') {
        lines.push(`${cap(at)} is about when the “${item.inName}” line is highest. But ${S} keeps rising for as long as more comes in than goes out.`);
      } else if (diag === 'outflowPeak') {
        lines.push(`${cap(at)} is about when the “${item.outName}” line is highest. But ${S} keeps falling for as long as more goes out than comes in.`);
      } else if (diag === 'fastest') {
        lines.push(`${cap(whenP(item, tTap))} ${S} is ${which === 'max' ? 'rising' : 'falling'} fastest (the widest gap between the lines), not yet at its ${hi}.`);
      } else if (diag === 'outflowLow' || diag === 'inflowLow') {
        const name = diag === 'outflowLow' ? item.outName : item.inName;
        lines.push(`${cap(at)} is when the “${name}” line is lowest. What matters is not either line on its own but which one is on top.`);
      } else if (diag === 'otherTurn') {
        lines.push(`${cap(at)}: the lines meet there, but that is not the ${hi} point.`);
      } else {
        lines.push(`${cap(at)}: ${pair(item, tTap)}, so ${S} was ${diag === 'risingThen' ? 'rising' : 'falling'} then.`);
      }
    }
    if (best.t === t0) {
      lines.push(
        which === 'max'
          ? `More was going out than coming in from the very start, so ${S} only fell: ${hi} at the start.`
          : `More was coming in than going out from the very start, so ${S} only rose: ${hi} at the start.`
      );
    } else if (best.t === t1) {
      lines.push(
        which === 'max'
          ? `More was coming in than going out the whole way through, so ${S} never stopped rising: ${hi} at the very end, ${when(item, t1)}.`
          : `More was going out than coming in the whole way through, so ${S} never stopped falling: ${hi} at the very end, ${when(item, t1)}.`
      );
    } else {
      lines.push(
        which === 'max'
          ? `${cap(S)} was ${hi} ${whenP(item, best.t)}, where the lines cross: until then more was coming in than going out, after it less.`
          : `${cap(S)} was ${hi} ${whenP(item, best.t)}, where the lines cross: until then more was going out than coming in, after it less.`
      );
    }
    if (!ok) lines.push(`At the time you chose: ${level(item, Tub.stockAt(item, tTap))}. At the ${hi} point: ${level(item, best.s)}.`);
    return { ok, diag, lines, best };
  }

  /* ----- How much? ----- */
  function amountFeedback(item, chosenValue) {
    const a = Tub.amountOptions(item, item.at);
    const pick = a.cands.find((c) => Math.abs(c.v - chosenValue) < 1e-9);
    const ok = Math.abs(chosenValue - a.correct) < 1e-9;
    const lines = [];
    const n = (v) => nice(v, counted(item));
    if (!ok && pick) {
      const text = {
        forgotOut: `That adds what came in (${n(a.inArea)}) but forgets what went out (${n(a.outArea)}).`,
        forgotStart: `That is only the change (${n(a.net)}). Add the ${n(item.s0)} there at the start.`,
        reversed: `That takes the change away instead of adding it: more ${a.net >= 0 ? 'came in than went out' : 'went out than came in'}, so the level ended ${a.net >= 0 ? 'higher' : 'lower'} than it started.`,
        addedBoth: `That adds what went out (${n(a.outArea)}) instead of subtracting it.`,
        forgotIn: `That takes away what went out (${n(a.outArea)}) but forgets what came in (${n(a.inArea)}).`,
        doubleStart: `That counts the ${n(item.s0)} at the start twice.`,
        rateNow: `That takes the gap between the lines ${whenP(item, item.at)} (${rate(item, Tub.netAt(item, item.at))}) as if it had held all along. The lines moved; what counts is the area under each.`,
      }[pick.why];
      if (text) lines.push(text);
    }
    lines.push(
      `Start ${n(item.s0)} + ${n(a.inArea)} in − ${n(a.outArea)} out = ${level(item, a.correct)} ${whenP(item, item.at)}. The area under each line, up to that moment, is how much has flowed.`
    );
    return { ok, lines, correct: a.correct };
  }

  // The text on an amount option button.
  function amountLabel(item, v) {
    return level(item, v);
  }

  /* ----- Draw it ----- */
  // Says why a sketch passed or failed, in the grader's own terms: where the
  // level turns (the crossings), whether the line turned there, and which way
  // it went in between.
  function sketchFeedback(item, grade) {
    const lines = [];
    if (grade.reason === 'empty' || grade.reason === 'short') {
      lines.push(`Draw across at least ${Math.round(Tub.SKETCH.cover * 100)}% of the time span, left to right.`);
      return { ok: false, lines, pct: 0 };
    }
    const S = subject(item);
    const pct = Math.round((grade.agree || 0) * 100);
    const turnsTo = (kind) => (kind === 'top' ? 'stops rising and starts to fall' : 'stops falling and starts to rise');
    const verb = (kind) => (kind === 'top' ? 'peaks' : 'bottoms out');
    if (grade.reason === 'flat') {
      lines.push(`Your line is nearly flat, but ${S} does go up and down.`);
    } else if (grade.ok) {
      lines.push(`Your line turns where ${S} turns, and goes the right way in between.`);
      // smaller turns that are not marked are still named, so “turns where” is not oversold
      const minor = [];
      for (const d of grade.minor || []) if (!minor.includes(when(item, d.t))) minor.push(when(item, d.t));
      if (minor.length) {
        lines.push(
          `Not marked: your line also turns a little near ${listJoin(minor)}, where ${S} does not turn. ${minor.length > 1 ? 'Those turns are' : 'That turn is'} too small to mark once the line is lightly smoothed, so ${minor.length > 1 ? 'they are' : 'it is'} taken as a wobble of the hand.`
        );
      }
    } else {
      const said = [];
      for (const m of grade.missing || []) {
        if (m.drawn) {
          said.push(m.drawn);
          lines.push(`Your line ${verb(m.kind)} ${whenP(item, m.drawn.t)}, but ${S} ${verb(m.kind)} ${whenP(item, m.t)}, ${m.drawn.t < m.t ? 'later' : 'earlier'}, where the lines cross.`);
        } else if (m.beyond === 'before') {
          lines.push(`Your line starts after ${when(item, m.t)}, where ${S} ${turnsTo(m.kind)}.`);
        } else if (m.beyond) {
          lines.push(`Your line stops before ${when(item, m.t)}, where ${S} ${turnsTo(m.kind)}.`);
        } else {
          lines.push(`Your line does not turn ${whenP(item, m.t)}, where the lines cross: ${S} ${turnsTo(m.kind)} there.`);
        }
      }
      const w = item.time.to - item.time.from;
      for (const x of grade.extra || []) {
        if (said.some((d) => d.kind === x.kind && Math.abs(d.t - x.t) <= 0.03 * w)) continue;
        const n = Tub.netAt(item, x.t);
        lines.push(`Your line turns ${whenP(item, x.t)}, but ${S} does not turn there: it is ${n > 0 ? 'rising' : 'falling'}, because the “${item.inName}” line is ${n > 0 ? 'on top' : 'underneath'}.`);
      }
      if (grade.agree < Tub.SKETCH.pass && grade.marks) {
        const bad = grade.marks.filter((k) => !k.good);
        const flat = bad.filter((k) => k.dir === 0).length;
        lines.push(
          flat * 2 >= bad.length
            ? `Under the red marks your line is too flat: ${S} is clearly moving there. (Your line went the right way ${pct}% of the time; ${Math.round(Tub.SKETCH.pass * 100)}% passes.)`
            : `Under the red marks your line goes the wrong way. (It went the right way ${pct}% of the time; ${Math.round(Tub.SKETCH.pass * 100)}% passes.)`
        );
      }
    }
    const turns = Tub.crossings(item).map((c) => when(item, c.t));
    const tail = `rising while the “${item.inName}” line is on top, falling while it is underneath.`;
    if (turns.length === 1) lines.push(`The level turns once, ${whenP(item, Tub.crossings(item)[0].t)}, where the lines cross: ${tail}`);
    else if (turns.length > 1) lines.push(`The level turns at ${listJoin(turns)}, each time the lines cross: ${tail}`);
    lines.push('Marked: that your line turns inside each shaded band, and which way it goes in between. Not how high it goes.');
    return { ok: grade.ok, lines, pct };
  }

  function listJoin(xs) {
    if (xs.length <= 1) return xs.join('');
    return xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1];
  }

  /* ----- Word problems ----- */
  function choiceFeedback(item, idx) {
    const ok = idx === item.answer;
    const lines = [];
    if (!ok && item.options[idx] && item.options[idx].why) lines.push(item.options[idx].why);
    lines.push(item.explain);
    return { ok, lines };
  }

  return {
    counted,
    subject,
    nice,
    withUnit,
    level,
    rate,
    when,
    whenP,
    dirFeedback,
    extremeFeedback,
    amountFeedback,
    amountLabel,
    sketchFeedback,
    choiceFeedback,
    listJoin,
  };
});
