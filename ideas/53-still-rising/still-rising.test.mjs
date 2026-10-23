// Tests for Still Rising. Run from the repo root:
//   node --test ideas/53-still-rising/still-rising.test.mjs
//
// The exercise bank states its own answers. This file recomputes every one of
// them without trusting tub.js: the level is integrated here by a separate,
// deliberately plain method (each flow's area by its own trapezoids, and a
// fine midpoint sum as a second opinion), extremes and turning points are
// found by brute-force scanning, and every number in the word problems is
// recomputed from first principles below, with the arithmetic written out.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Tub = require('./tub.js');
const Bank = require('./bank.js');
const Words = require('./words.js');
const Trainer = require('./trainer.js');
const README = fs.readFileSync(new URL('./README.md', import.meta.url), 'utf8');

const GRAPH = Bank.ITEMS.filter((i) => i.kind !== 'choice');
const CHOICE = Bank.ITEMS.filter((i) => i.kind === 'choice');

/* ------------------------------------------------------------------ */
/* An independent reading of the arithmetic (no tub.js)                 */
/* ------------------------------------------------------------------ */
function lin(pts, t) {
  // linear interpolation, flat beyond the ends
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i][0]) {
      const [a, va] = pts[i - 1];
      const [b, vb] = pts[i];
      return va + ((vb - va) * (t - a)) / (b - a);
    }
  }
  return pts[pts.length - 1][1];
}
// area under one piecewise-linear flow from `from` to `to`, using that flow's own knots
function area(pts, from, to) {
  const ts = [from, ...pts.map((p) => p[0]).filter((t) => t > from && t < to), to];
  let a = 0;
  for (let i = 1; i < ts.length; i++) a += ((lin(pts, ts[i - 1]) + lin(pts, ts[i])) / 2) * (ts[i] - ts[i - 1]);
  return a;
}
function level(item, t) {
  return item.s0 + area(item.inflow, item.time.from, t) - area(item.outflow, item.time.from, t);
}
function levelMidpoint(item, t, n = 20000) {
  const a = item.time.from;
  const h = (t - a) / n;
  let s = item.s0;
  for (let i = 0; i < n; i++) {
    const u = a + (i + 0.5) * h;
    s += (lin(item.inflow, u) - lin(item.outflow, u)) * h;
  }
  return s;
}
function scan(item, n = 6000) {
  const { from, to } = item.time;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = from + ((to - from) * i) / n;
    pts.push([t, level(item, t)]);
  }
  let max = pts[0];
  let min = pts[0];
  for (const p of pts) {
    if (p[1] > max[1]) max = p;
    if (p[1] < min[1]) min = p;
  }
  return { pts, max, min };
}
// times where in - out changes sign, found by scanning and bisection
function turns(item, n = 6000) {
  const { from, to } = item.time;
  const net = (t) => lin(item.inflow, t) - lin(item.outflow, t);
  const out = [];
  let prevT = from;
  let prev = Math.sign(net(from));
  for (let i = 1; i <= n; i++) {
    const t = from + ((to - from) * i) / n;
    const s = Math.sign(net(t));
    if (s !== 0 && prev !== 0 && s !== prev) {
      let lo = prevT;
      let hi = t;
      for (let k = 0; k < 60; k++) {
        const m = (lo + hi) / 2;
        if (Math.sign(net(m)) === prev) lo = m;
        else hi = m;
      }
      out.push((lo + hi) / 2);
    }
    if (s !== 0) {
      prev = s;
      prevT = t;
    }
  }
  return out;
}
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);

/* ------------------------------------------------------------------ */
/* The engine against the independent arithmetic                        */
/* ------------------------------------------------------------------ */
test('the engine integrates every exercise exactly (two independent methods agree)', () => {
  for (const it of GRAPH) {
    const { from, to } = it.time;
    for (let i = 0; i <= 40; i++) {
      const t = from + ((to - from) * i) / 40;
      const e = Tub.stockAt(it, t);
      const scale = Math.max(1, Math.abs(level(it, to)), Math.abs(it.s0));
      close(e, level(it, t), 1e-9 * scale, `${it.id} trapezoid at ${t}`);
      close(e, levelMidpoint(it, t), 1e-4 * scale, `${it.id} midpoint at ${t}`);
    }
  }
});

test('extremes and turning points match a brute-force scan', () => {
  for (const it of GRAPH) {
    const s = scan(it);
    const ex = Tub.extremes(it);
    const range = s.max[1] - s.min[1];
    close(ex.max.s, s.max[1], 1e-6 * range + 1e-9, `${it.id} max level`);
    close(ex.min.s, s.min[1], 1e-6 * range + 1e-9, `${it.id} min level`);
    const tr = turns(it);
    const cr = Tub.crossings(it).map((c) => c.t);
    assert.equal(cr.length, tr.length, `${it.id} number of turning points`);
    cr.forEach((t, i) => close(t, tr[i], 1e-6, `${it.id} turning point ${i}`));
  }
});

/* ------------------------------------------------------------------ */
/* Every graph exercise is well formed and fair                         */
/* ------------------------------------------------------------------ */
test('graph exercises: knots increase, flows and levels are never negative, the level moves visibly', () => {
  for (const it of GRAPH) {
    for (const f of [it.inflow, it.outflow]) {
      for (let i = 1; i < f.length; i++) assert.ok(f[i][0] > f[i - 1][0], `${it.id}: knot times must increase`);
      assert.ok(f[0][0] <= it.time.from && f[f.length - 1][0] >= it.time.to, `${it.id}: flows cover the span`);
      for (const p of f) assert.ok(p[1] >= 0, `${it.id}: negative flow`);
    }
    const s = scan(it);
    assert.ok(s.min[1] >= (it.floor || 0) - 1e-9, `${it.id}: level dips below ${it.floor || 0}`);
    if (it.s0 === 0) assert.ok(lin(it.inflow, it.time.from) >= lin(it.outflow, it.time.from), `${it.id}: drains an empty tub`);
    assert.equal(Tub.fairness(it), null, `${it.id}: ${Tub.fairness(it)}`);
  }
});

test('Which way? answers: the sign of in minus out at the asked moment', () => {
  const dirs = GRAPH.filter((i) => i.kind === 'dir');
  assert.ok(dirs.length >= 6);
  for (const it of dirs) {
    const net = lin(it.inflow, it.at) - lin(it.outflow, it.at);
    const truth = net > 0 ? 'rising' : net < 0 ? 'falling' : 'steady';
    assert.equal(it.answer, truth, it.id);
    assert.equal(Tub.direction(it, it.at), truth, it.id);
    const maxF = Math.max(...it.inflow.concat(it.outflow).map((p) => p[1]));
    if (truth !== 'steady') assert.ok(Math.abs(net) >= 0.12 * maxF, `${it.id}: flows too close to call by eye`);
  }
  // most of them are asked where the inflow's own trend points the wrong way
  const contrary = dirs.filter((it) => {
    const d = 0.01 * (it.time.to - it.time.from);
    const trend = lin(it.inflow, it.at + d) - lin(it.inflow, it.at - d);
    const outTrend = lin(it.outflow, it.at + d) - lin(it.outflow, it.at - d);
    const net = lin(it.inflow, it.at) - lin(it.outflow, it.at);
    return (trend !== 0 && Math.sign(trend) !== Math.sign(net)) || (outTrend !== 0 && Math.sign(outTrend) === Math.sign(net));
  });
  assert.ok(contrary.length >= dirs.length - 1, `only ${contrary.length} of ${dirs.length} contradict the trend`);
});

test('Fullest and emptiest answers: the stated time is the true extreme, and the trend-reading answer is wrong', () => {
  for (const it of GRAPH.filter((i) => i.kind === 'peak' || i.kind === 'trough')) {
    const which = it.kind === 'peak' ? 'max' : 'min';
    const s = scan(it);
    const best = which === 'max' ? s.max : s.min;
    const span = it.time.to - it.time.from;
    close(best[0], it.answer, 0.01 * span, `${it.id} stated answer`);
    // the snapped true answer is accepted
    assert.equal(Tub.diagnoseExtreme(it, which, Tub.snapTime(it, best[0])), 'ok', `${it.id}: snapped answer rejected`);
    // one accepted stretch, between 2% and 25% of the span
    const iv = Tub.acceptIntervals(it, which);
    assert.equal(iv.length, 1, `${it.id}: one accepted stretch`);
    const width = (iv[0][1] - iv[0][0]) / span;
    assert.ok(width >= 0.02 && width <= 0.25, `${it.id}: accepted width ${width}`);
    // independently: inside the stretch the level is within 3% of the range of the extreme
    const range = s.max[1] - s.min[1];
    for (const t of [iv[0][0] + 1e-6, (iv[0][0] + iv[0][1]) / 2, iv[0][1] - 1e-6]) {
      const gap = which === 'max' ? best[1] - level(it, t) : level(it, t) - best[1];
      assert.ok(gap <= 0.03 * range + 1e-6, `${it.id}: accepted time ${t} is not near the extreme`);
    }
    // reading the extreme off the busier flow is graded wrong
    const flow = which === 'max' ? it.inflow : it.outflow;
    let naive = flow[0];
    for (const p of flow) if (p[1] > naive[1]) naive = p;
    const t = Math.max(it.time.from, Math.min(it.time.to, naive[0]));
    assert.notEqual(Tub.diagnoseExtreme(it, which, t), 'ok', `${it.id}: the trend-reading answer ${t} would pass`);
  }
});

test('How much? answers: start + area in - area out, and every option is one named mistake', () => {
  for (const it of GRAPH.filter((i) => i.kind === 'amount')) {
    const inA = area(it.inflow, it.time.from, it.at);
    const outA = area(it.outflow, it.time.from, it.at);
    const truth = it.s0 + inA - outA;
    assert.equal(truth, it.answer, `${it.id}: ${it.s0} + ${inA} - ${outA}`);
    assert.ok(Number.isInteger(truth), `${it.id}: answer should be a whole number`);
    const ch = Tub.pickAmountChoices(it, it.at);
    assert.equal(ch.length, 4, `${it.id}: four options`);
    assert.equal(ch.filter((c) => Math.abs(c.v - truth) < 1e-9).length, 1, `${it.id}: exactly one right option`);
    const expect = { ok: truth, forgotOut: it.s0 + inA, forgotStart: inA - outA, reversed: it.s0 - (inA - outA), addedBoth: it.s0 + inA + outA };
    for (const c of ch) {
      close(c.v, expect[c.why], 1e-9, `${it.id} option ${c.why}`);
      for (const d of ch) if (d !== c) assert.ok(Math.abs(d.v - c.v) >= Math.max(2, 0.08 * Math.abs(truth)) - 1e-9, `${it.id}: options too close`);
    }
  }
});

test('Draw it: stated turning points are right; the true curve passes; trend-shaped and straight sketches fail', () => {
  for (const it of GRAPH.filter((i) => i.kind === 'sketch')) {
    const tr = turns(it);
    assert.equal(tr.length, it.answer.length, `${it.id}: number of turns`);
    tr.forEach((t, i) => close(t, it.answer[i], 0.006 * (it.time.to - it.time.from), `${it.id} turn ${i}`));
    const [lo, hi] = Tub.stockAxis(it);
    const range = hi - lo;
    const { from, to } = it.time;
    const N = 120;
    const truth = [];
    const shaped = [];
    const straight = [];
    const noisy = [];
    const rnd = Tub.mulberry32(7);
    const fmax = Math.max(...it.inflow.map((p) => p[1]));
    for (let i = 0; i <= N; i++) {
      const t = from + ((to - from) * i) / N;
      truth.push([t, level(it, t)]);
      noisy.push([t, level(it, t) + (rnd() - 0.5) * 0.02 * range]);
      shaped.push([t, lo + (0.9 * range * lin(it.inflow, t)) / fmax]);
      straight.push([t, lo + range * (0.1 + (0.8 * i) / N)]);
    }
    assert.ok(Tub.gradeSketch(it, truth, range).agree >= 0.95, `${it.id}: true curve`);
    assert.ok(Tub.gradeSketch(it, noisy, range).ok, `${it.id}: true curve with a shaky hand`);
    assert.ok(!Tub.gradeSketch(it, shaped, range).ok, `${it.id}: a sketch shaped like the inflow passes`);
    assert.ok(!Tub.gradeSketch(it, straight, range).ok, `${it.id}: a straight rising line passes`);
    assert.ok(!Tub.gradeSketch(it, [[from, it.s0], [to, it.s0]], range).ok, `${it.id}: a flat line passes`);
    assert.equal(Tub.gradeSketch(it, truth.slice(0, 60), range).reason, 'short', `${it.id}: half a sketch is not graded`);
  }
});

test('the numbers stated in the stories match the curves', () => {
  const B = Bank.byId;
  const at = (it, f, t) => lin(it[f], t);
  // [id, check]
  const checks = [
    ['shop', (it) => it.s0 === 10 && /Ten people/.test(it.story)],
    ['bath-down', (it) => at(it, 'inflow', 0) === 14 && at(it, 'inflow', 10) === 2 && at(it, 'outflow', 3) === 6 && it.time.to === 10],
    ['melt', (it) => at(it, 'inflow', 0) === 2 && at(it, 'inflow', 30) === 10 && at(it, 'outflow', 9) === 8 && it.time.to === 30],
    ['ward-ebb', (it) => at(it, 'inflow', 0) === 20 && at(it, 'inflow', 14) === 8 && at(it, 'outflow', 0) === 14 && at(it, 'outflow', 14) === 6],
    ['runway', (it) => at(it, 'outflow', 0) === 150 && at(it, 'outflow', 12) === 90 && at(it, 'inflow', 0) === 40 && at(it, 'inflow', 12) === 70],
    ['backlog', (it) => at(it, 'outflow', 0) === 20 && at(it, 'outflow', 12) === 56 && at(it, 'inflow', 5) === 60],
    ['carbon', (it) => at(it, 'inflow', 0) === 10.8 && Math.abs(at(it, 'inflow', 20) - (10.8 * 2) / 3) < 1e-12 && at(it, 'outflow', 7) === 6 && it.time.to === 20],
    ['gallery', (it) => it.s0 === 20],
    ['bath-fill', (it) => at(it, 'inflow', 0) === 16 && at(it, 'inflow', 12) === 4 && at(it, 'outflow', 5) === 2 && it.s0 === 0],
    ['festival', (it) => it.s0 === 500 && it.time.from === 16],
    ['births', (it) => {
      let pk = it.inflow[0];
      for (const p of it.inflow) if (p[1] > pk[1]) pk = p;
      return pk[0] + it.time.base === 2010 && it.outflow.every((p, i) => i === 0 || p[1] > it.outflow[i - 1][1]);
    }],
    ['bath-sketch', (it) => at(it, 'inflow', 0) === 12 && at(it, 'inflow', 5) === 12 && at(it, 'inflow', 6) === 0 && at(it, 'outflow', 8) === 4 && it.s0 === 10],
    ['theme-park', (it) => it.s0 === 0 && it.time.from === 9],
    ['bath-amount', (it) => at(it, 'inflow', 3) === 10 && at(it, 'outflow', 3) === 4 && it.s0 === 40],
    ['shop-amount', (it) => it.s0 === 12],
    ['ward-amount', (it) => it.s0 === 120],
    ['reservoir-amount', (it) => at(it, 'outflow', 4) === 6 && it.s0 === 100],
    ['stall-amount', (it) => at(it, 'outflow', 13) === 50 && it.s0 === 300],
    ['flu-ward', (it) => it.s0 === 30],
  ];
  for (const [id, f] of checks) assert.ok(f(B[id]), `${id}: story and data disagree`);
});

/* ------------------------------------------------------------------ */
/* Word problems: every number recomputed                               */
/* ------------------------------------------------------------------ */
test('word problems are well formed', () => {
  for (const it of CHOICE) {
    assert.ok(it.options.length >= 2 && it.options.length <= 4, it.id);
    assert.ok(Number.isInteger(it.answer) && it.answer >= 0 && it.answer < it.options.length, it.id);
    it.options.forEach((o, i) => {
      assert.ok(o.text && o.text.length > 0, `${it.id} option ${i}`);
      if (i !== it.answer) assert.ok(o.why && o.why.length > 10, `${it.id}: wrong option ${i} needs its own feedback`);
    });
    assert.ok(it.explain && it.explain.length > 20, it.id);
    assert.equal(new Set(it.options.map((o) => o.text)).size, it.options.length, `${it.id}: duplicate options`);
  }
});

const fmt = (n) => Math.round(n).toLocaleString('en-US');
const right = (id) => Bank.byId[id].options[Bank.byId[id].answer].text;
const only = (id, s) => {
  const it = Bank.byId[id];
  const hits = it.options.map((o, i) => (o.text.includes(s) ? i : -1)).filter((i) => i >= 0);
  assert.deepEqual(hits, [it.answer], `${id}: "${s}" should appear in the right option only`);
};

test('word problems: the arithmetic', () => {
  // deficits add to the debt: 1,000 + 120 + 90 + 60
  {
    const d = Bank.byId.deficit.data;
    const debt = d.debt0 + d.deficits.reduce((a, b) => a + b, 0);
    assert.equal(debt, 1270);
    only('deficit', fmt(debt));
    assert.ok(Bank.byId.deficit.explain.includes('1,270'));
  }
  // births minus deaths
  {
    const d = Bank.byId['births-text'].data;
    assert.equal(d.births - d.deaths, 50000);
    only('births-text', fmt(d.births - d.deaths));
  }
  // outbreak: infections fall linearly 900 -> 600 over 7 days, recoveries 700; crossing fraction
  {
    const d = Bank.byId.outbreak.data;
    const f = (d.from - d.recover) / (d.from - d.to);
    close(f, 2 / 3, 1e-12, 'outbreak crossing fraction');
    close(f * d.days, 4.6667, 1e-3, 'outbreak crossing day');
    assert.ok(right('outbreak').includes('two-thirds'));
    assert.ok(Bank.byId.outbreak.explain.includes('200 of the 300'));
  }
  // waiting list: 120 in, 100 out (and last year 80 out)
  {
    const d = Bank.byId.waitlist.data;
    assert.equal(d.referred - d.seen, 20);
    only('waitlist', 'about 20 a week');
    assert.ok(Bank.byId.waitlist.options[2].why.includes('120 − 80'));
  }
  // homes: 150,000 built - 20,000 demolished
  {
    const d = Bank.byId.homes.data;
    assert.equal(d.built - d.demolished, 130000);
    only('homes', fmt(130000));
  }
  // queue: 12 people x 40 s = 480 s = 8 min
  {
    const d = Bank.byId.queue.data;
    const sec = d.ahead * d.perServe;
    assert.equal(sec, 480);
    assert.equal(sec / 60, 8);
    only('queue', 'about 8 minutes');
  }
  // cafe: 90 an hour x 20 min = 30; distractors 90/20 = 4.5 and 90 x 20 = 1,800
  {
    const d = Bank.byId.cafe.data;
    assert.equal((d.perHour * d.stayMin) / 60, 30);
    only('cafe', 'about 30');
    assert.equal(d.perHour / d.stayMin, 4.5);
    assert.equal(d.perHour * d.stayMin, 1800);
  }
  // bug wait: 120 / 40 a week = 3 weeks
  {
    const d = Bank.byId['bugs-wait'].data;
    assert.equal(d.open / d.rate, 3);
    only('bugs-wait', 'about 3 weeks');
  }
  // university: 20,000 / 5,000 a year = 4 years; wrong way round = 1/4 year = 3 months
  {
    const d = Bank.byId.university.data;
    assert.equal(d.level / d.perYear, 4);
    assert.equal((d.perYear / d.level) * 12, 3);
    only('university', 'about 4 years');
  }
  // wine: 2 a week x 52 x 5 = 520; one year = 104; counted twice = 2,600
  {
    const d = Bank.byId.wine.data;
    const cellar = d.perWeek * d.weeksPerYear * d.years;
    assert.equal(cellar, 520);
    assert.equal(cellar * 5, 2600);
    assert.equal(d.perWeek * d.weeksPerYear, 104);
    only('wine', 'about 520');
  }
  // blood: 25e12 cells / (120 days x 86,400 s) = 2.41 million a second
  {
    const d = Bank.byId.blood.data;
    const perSec = d.level / (d.days * 86400);
    close(perSec, 2.41e6, 0.01e6, 'red cells per second');
    only('blood', 'about 2.4 million');
    const perDay = d.level / d.days;
    close(perDay, 2.08e11, 0.01e11, 'red cells per day');
    assert.ok(Bank.byId.blood.options.some((o) => o.text === 'about 200 billion'));
    const perSecForgettingDays = d.level / 86400;
    close(perSecForgettingDays, 2.89e8, 0.01e8, 'one-day slip');
    assert.ok(Bank.byId.blood.options.some((o) => o.text === 'about 290 million'));
    assert.ok(Bank.byId.blood.options.some((o) => o.text === 'about 2,400'));
  }
  // ward: 10 a day x 5 days = 50 beds
  {
    const d = Bank.byId['ward-little'].data;
    assert.equal(d.perDay * d.stay, 50);
    only('ward-little', 'about 50');
  }
  // snapshot: 5/day stay 1 day, 5/day stay 9 days; beds 5 and 45; mean stay among beds 8.2
  {
    const d = Bank.byId.snapshot.data;
    const shortBeds = (d.perDay / 2) * d.short;
    const longBeds = (d.perDay / 2) * d.long;
    assert.equal(shortBeds, 5);
    assert.equal(longBeds, 45);
    assert.equal((d.short + d.long) / 2, 5);
    const snap = (shortBeds * d.short + longBeds * d.long) / (shortBeds + longBeds);
    close(snap, 8.2, 1e-12, 'snapshot mean');
    only('snapshot', '8.2');
    // and it is the same ward as the Little's-law exercise
    assert.equal(shortBeds + longBeds, Bank.byId['ward-little'].data.perDay * Bank.byId['ward-little'].data.stay);
  }
  // audit: 1,000 + 3,000 - 2,600 = 1,400 expected; 1,150 found; 250 missing
  {
    const d = Bank.byId.audit.data;
    const expected = d.start + d.inflow - d.outflow;
    assert.equal(expected, 1400);
    assert.equal(expected - d.end, 250);
    only('audit', '$250');
  }
  // library: books out = loans a week x weeks out
  {
    const d = Bank.byId.loans.data;
    const before = (d.loansBefore / 52) * d.weeksBefore;
    const now = (d.loansNow / 52) * d.weeksNow;
    close(before, 2307.7, 0.1, 'books out before');
    assert.equal(now, 2000);
    assert.ok(now < before);
    only('loans', 'about 2,000 out against about 2,300');
    assert.equal(d.loansNow * d.weeksNow, 104000);
    assert.equal(d.loansBefore * d.weeksBefore, 120000);
  }
  // carbon (word version and graph version): 10.8 cut by a third is 7.2, still above 6
  {
    const g = Bank.byId.carbon;
    assert.ok(lin(g.inflow, g.time.to) > lin(g.outflow, g.time.to), 'carbon: still more in than out at the end');
    close(level(g, g.time.to), ((10.8 - 6 + (7.2 - 6)) / 2) * 20, 1e-9, 'carbon added over 20 years');
  }
});

test('word problems: the conceptual answers are the ones the text defends', () => {
  const expect = {
    inflation: 'higher, by about 3%',
    losses: 'went down by about $10M',
    'carbon-text': 'Not until emissions fall below what oceans and land absorb',
    'stock-or-flow': 'Your wealth',
    'flow-spot': 'Hiring at a company',
    driving: 'still growing, more slowly',
    'growing-app': 'The tub is still filling, so level ÷ flow is only a floor: users stay at least 12 months on average, maybe far longer',
    lanes: 'It will shrink if the inflow stays as it was; whether it does depends on drivers, which the tub cannot tell you',
    'quick-pass': 'The sandwich shop',
    feedback: 'Rises ever more slowly and settles where outflow equals inflow',
  };
  for (const [id, text] of Object.entries(expect)) assert.equal(right(id), text, id);
});

/* ------------------------------------------------------------------ */
/* Feedback sentences                                                   */
/* ------------------------------------------------------------------ */
test('every feedback sentence is complete and quotes the computed answer', () => {
  const bad = /undefined|NaN|null|\[object/;
  for (const it of GRAPH) {
    if (it.kind === 'dir') {
      for (const a of ['rising', 'steady', 'falling']) {
        const fb = Words.dirFeedback(it, a);
        assert.equal(fb.ok, a === it.answer);
        for (const l of fb.lines) assert.ok(!bad.test(l), `${it.id}: ${l}`);
      }
    }
    if (it.kind === 'peak' || it.kind === 'trough') {
      const which = it.kind === 'peak' ? 'max' : 'min';
      const best = which === 'max' ? scan(it).max : scan(it).min;
      const span = it.time.to - it.time.from;
      for (let k = 0; k <= 24; k++) {
        const t = Tub.snapTime(it, it.time.from + (span * k) / 24);
        const fb = Words.extremeFeedback(it, which, t);
        for (const l of fb.lines) assert.ok(!bad.test(l), `${it.id}: ${l}`);
        const all = fb.lines.join(' ');
        if (best[0] > it.time.from && best[0] < it.time.to) assert.ok(all.includes(Words.when(it, best[0])), `${it.id}: feedback should name ${Words.when(it, best[0])}`);
      }
    }
    if (it.kind === 'amount') {
      for (const c of Tub.pickAmountChoices(it, it.at)) {
        const fb = Words.amountFeedback(it, c.v);
        assert.equal(fb.ok, c.why === 'ok');
        const all = fb.lines.join(' ');
        assert.ok(!bad.test(all), all);
        assert.ok(all.includes(`= ${Words.level(it, it.answer)}`), `${it.id}: ${all}`);
      }
    }
    if (it.kind === 'sketch') {
      const [lo, hi] = Tub.stockAxis(it);
      const g = Tub.gradeSketch(it, Tub.stockCurve(it, 60), hi - lo);
      const fb = Words.sketchFeedback(it, g);
      assert.ok(fb.ok);
      for (const l of fb.lines) assert.ok(!bad.test(l), `${it.id}: ${l}`);
    }
  }
  for (const it of CHOICE) {
    it.options.forEach((o, i) => {
      const fb = Words.choiceFeedback(it, i);
      assert.equal(fb.ok, i === it.answer);
    });
  }
});

test('feedback spot checks, worked by hand', () => {
  // The shop: in 8,20,14,8,5,3 at 0,5,10,15,20,30; out 2,5,10,13,11,6. Net 4 at minute 10 and -5 at 15,
  // so the lines cross at 10 + 5 x 4/9 = 12.22: the shop is fullest at minute 12, with
  // 10 + 5(6+15)/2 + 5(15+4)/2 + (20/9)(4/2) = 114.44 people.
  const shop = Bank.byId.shop;
  const ex = Tub.extremes(shop);
  close(ex.max.t, 10 + (5 * 4) / 9, 1e-12, 'shop peak time');
  close(ex.max.s, 10 + 52.5 + 47.5 + (20 / 9) * 2, 1e-9, 'shop peak level');
  const fb = Words.extremeFeedback(shop, 'max', 5);
  assert.equal(fb.diag, 'inflowPeak');
  assert.ok(fb.lines.join(' ').includes('minute 12'));
  assert.ok(fb.lines.join(' ').includes('63 people')); // 10 + 52.5 = 62.5 at minute 5, rounded
  // The bath with the tap turned down: 14 - 1.2 x 4 = 9.2 in, 6 out at minute 4.
  const d = Words.dirFeedback(Bank.byId['bath-down'], 'falling');
  assert.ok(d.lines[0].includes('9.2') && d.lines[0].includes(' 6 '));
  assert.ok(/even though the .from the tap. line is falling/.test(d.lines[1]));
  // The bath sketch turns at 5 + 2/3 minutes, which reads "minute 5.7".
  const sk = Words.sketchFeedback(Bank.byId['bath-sketch'], { reason: 'graded', agree: 1, ok: true });
  assert.ok(sk.lines[1].includes('minute 5.7'));
});

/* ------------------------------------------------------------------ */
/* The generator                                                        */
/* ------------------------------------------------------------------ */
test('generated exercises: always fair, answers recomputed independently, the trend-reading answer fails', () => {
  const kinds = ['dir', 'peak', 'trough', 'amount', 'sketch'];
  let n = 0;
  for (const kind of kinds) {
    for (const tpl of Bank.TEMPLATES) {
      for (let seed = 1; seed <= 40; seed++) {
        const it = Tub.generate(kind, tpl, seed);
        assert.ok(it, `${kind}/${tpl.key}/${seed} failed to generate`);
        n++;
        assert.equal(Tub.fairness(it), null);
        const s = scan(it, 600);
        assert.ok(s.min[1] >= -1e-9, 'negative level');
        assert.equal(JSON.stringify(Tub.generate(kind, tpl, seed)), JSON.stringify(it), 'deterministic');
        if (kind === 'dir') {
          const net = lin(it.inflow, it.at) - lin(it.outflow, it.at);
          assert.equal(it.answer, net > 0 ? 'rising' : 'falling');
        }
        if (kind === 'peak' || kind === 'trough') {
          const which = kind === 'peak' ? 'max' : 'min';
          const best = which === 'max' ? s.max : s.min;
          assert.equal(Tub.diagnoseExtreme(it, which, Tub.snapTime(it, best[0])), 'ok');
          const flow = which === 'max' ? it.inflow : it.outflow;
          let pk = flow[0];
          for (const p of flow) if (p[1] > pk[1]) pk = p;
          assert.notEqual(Tub.diagnoseExtreme(it, which, pk[0]), 'ok');
        }
        if (kind === 'amount') {
          const truth = it.s0 + area(it.inflow, it.time.from, it.at) - area(it.outflow, it.time.from, it.at);
          assert.ok(Number.isInteger(Math.round(truth * 1e9) / 1e9));
          close(Tub.stockAt(it, it.at), truth, 1e-9, 'generated amount');
          assert.equal(Tub.pickAmountChoices(it, it.at).length, 4);
        }
        if (kind === 'sketch') {
          const [lo, hi] = Tub.stockAxis(it);
          assert.ok(turns(it).length >= 1);
          assert.ok(Tub.gradeSketch(it, s.pts.filter((_, i) => i % 5 === 0), hi - lo).ok);
        }
      }
    }
  }
  assert.equal(n, 5 * Bank.TEMPLATES.length * 40);
  // and a wider sweep, checking only that every seed yields a fair exercise
  let m = 0;
  for (const kind of kinds) {
    for (const tpl of Bank.TEMPLATES) {
      for (let seed = 41; seed <= 200; seed++) {
        const it = Tub.generate(kind, tpl, seed);
        assert.ok(it && Tub.fairness(it) === null, `${kind}/${tpl.key}/${seed}`);
        m++;
      }
    }
  }
  assert.equal(m, 4000);
});

/* ------------------------------------------------------------------ */
/* The trainer                                                          */
/* ------------------------------------------------------------------ */
function simulate(pRight, steps, seed) {
  const st = Trainer.fresh();
  const rnd = Tub.mulberry32(seed);
  const shown = [];
  for (let i = 0; i < steps; i++) {
    const pick = Trainer.next(st, Bank, Tub);
    const item = Trainer.itemFor(pick.id, Bank, Tub);
    assert.ok(item, `pick ${pick.id} resolves`);
    shown.push(pick);
    Trainer.record(st, pick, rnd() < pRight);
  }
  return { st, shown };
}

test('the first question is the cold baseline, the ladder ends with its twin', () => {
  const { st, shown } = simulate(1, 60, 1);
  assert.equal(shown[0].id, Bank.COLD);
  assert.equal(shown[0].mode, 'cold');
  const twinAt = shown.findIndex((p) => p.mode === 'twin');
  assert.ok(twinAt > 0);
  assert.equal(shown[twinAt].id, Bank.TWIN);
  assert.ok(Trainer.ladderDone(st));
  // a perfect learner needs 3 per rung plus reviews: 1 + 21 + reviews + 1
  assert.ok(twinAt >= 22 && twinAt <= 32, `twin at ${twinAt}`);
  assert.equal(shown.filter((p) => p.mode === 'twin').length, 1);
  assert.equal(shown.filter((p) => p.mode === 'cold').length, 1);
});

test('every exercise in the bank is reachable', () => {
  for (const [p, steps, seed] of [
    [1, 120, 1],
    [0.7, 300, 2],
    [0.5, 600, 3],
  ]) {
    const { shown } = simulate(p, steps, seed);
    const ids = new Set(shown.map((s) => s.id));
    const missing = Bank.ITEMS.filter((i) => !ids.has(i.id)).map((i) => i.id);
    assert.deepEqual(missing, [], `p=${p}: never shown ${missing.join(', ')}`);
  }
});

test('three right in a row clears a rung; a miss resets the run; reviews do not count', () => {
  const st = Trainer.fresh();
  Trainer.record(st, Trainer.next(st, Bank, Tub), false); // the cold question
  const seq = [true, true, false, true, true];
  for (const ok of seq) {
    const p = Trainer.next(st, Bank, Tub);
    assert.equal(p.rung, 1);
    assert.equal(p.mode, 'ladder');
    Trainer.record(st, p, ok);
  }
  assert.ok(!st.cleared[1]);
  assert.equal(st.streak[1], 2);
  const p = Trainer.next(st, Bank, Tub);
  const res = Trainer.record(st, p, true);
  assert.equal(res.cleared, 1);
  assert.ok(st.cleared[1]);
  // now on rung 2, with a review from rung 1 every fourth question
  const modes = [];
  for (let i = 0; i < 8; i++) {
    const q = Trainer.next(st, Bank, Tub);
    modes.push(q.mode);
    const before = st.streak[2] || 0;
    Trainer.record(st, q, q.mode === 'review' ? false : i % 2 === 0);
    if (q.mode === 'review') assert.equal(st.streak[2] || 0, before, 'a review changed the rung streak');
  }
  assert.ok(modes.includes('review'));
  for (let i = 3; i < modes.length; i++) assert.ok(!(modes[i] === 'review' && modes[i - 1] === 'review'));
});

test('a missed exercise comes back, after a gap, before anything new', () => {
  const st = Trainer.fresh();
  Trainer.record(st, Trainer.next(st, Bank, Tub), true);
  // clear rung 1 but miss its first item
  const first = Trainer.next(st, Bank, Tub);
  Trainer.record(st, first, false);
  while (!st.cleared[1]) Trainer.record(st, Trainer.next(st, Bank, Tub), true);
  // the first review on rung 2 should be the missed item
  let review = null;
  for (let i = 0; i < 6 && !review; i++) {
    const q = Trainer.next(st, Bank, Tub);
    if (q.mode === 'review') review = q;
    Trainer.record(st, q, true);
  }
  assert.ok(review);
  assert.equal(review.id, first.id);
});

test('how much evidence three in a row is (and the README says so)', () => {
  // Three right in a row by pure guessing: (1/3)^3 = 1/27 on a three-way question, (1/4)^3 = 1/64 on four.
  close(Math.pow(1 / 3, 3), 1 / 27, 1e-15, 'three-way');
  close(Math.pow(1 / 4, 3), 1 / 64, 1e-15, 'four-way');
  // Over a whole rung it is weaker. Chance of a run of 3 somewhere in the rung's questions, in order,
  // exactly, by a small state machine over the current run length; ps[i] is the chance of
  // getting question i right.
  const runOf3 = (ps) => {
    let d = [1, 0, 0, 0];
    for (const p of ps) {
      const m = [0, 0, 0, d[3]];
      for (let r = 0; r < 3; r++) {
        m[0] += d[r] * (1 - p);
        m[r + 1] += d[r] * p;
      }
      d = m;
    }
    return d[3];
  };
  const rung1 = Bank.ITEMS.filter((i) => i.rung === 1);
  const threeButtons = runOf3(rung1.map(() => 1 / 3));
  const twoButtons = runOf3(rung1.map((i) => (i.answer === 'steady' ? 0 : 1 / 2)));
  close(threeButtons, 0.158, 0.001, 'random three-way guesser on rung 1');
  // the steady question is fifth: a run needs questions 1-4 (3/16 for at least three in a row)
  // or 6-8 (1/8), so 1 - (13/16)(7/8) = 37/128
  assert.equal(rung1[4].answer, 'steady');
  close(twoButtons, 37 / 128, 1e-12, 'rising-or-falling guesser on rung 1');
  assert.ok(README.includes(`${Math.round(threeButtons * 100)}% of the time`), 'README should state the three-button chance');
  assert.ok(README.includes(`${Math.round(twoButtons * 100)}% of the time`), 'README should state the two-button chance');
  // Against the mistake the ladder is about, though, rung 1 cannot be cleared: at every rung-1
  // question, answering from the direction a line is heading (the inflow's, or the opposite of the
  // outflow's when the inflow is flat; 'falling' for a flat inflow that has been falling) is wrong.
  for (const it of Bank.ITEMS.filter((i) => i.rung === 1)) {
    const d = 0.01 * (it.time.to - it.time.from);
    const inT = lin(it.inflow, it.at + d) - lin(it.inflow, it.at - d);
    const outT = lin(it.outflow, it.at + d) - lin(it.outflow, it.at - d);
    const prior = lin(it.inflow, it.at) - lin(it.inflow, it.time.from);
    const trendSays = inT !== 0 ? (inT > 0 ? 'rising' : 'falling') : outT !== 0 ? (outT > 0 ? 'falling' : 'rising') : prior < 0 ? 'falling' : 'rising';
    assert.notEqual(trendSays, it.answer, `${it.id}: reading the trend gets it right`);
  }
});

test('stored progress is cleaned, and junk is refused', () => {
  const { st } = simulate(0.8, 40, 5);
  const round = Trainer.clean(JSON.stringify(st), Bank);
  assert.deepEqual(round.cleared, st.cleared);
  assert.equal(round.q, st.q);
  assert.deepEqual(round.box, st.box);
  for (const junk of ['', 'not json', '[]', '{"v":2}', JSON.stringify({ v: 1, q: -4, box: { shop: 9, nope: 1 }, cleared: { 1: 'yes' }, cold: { id: 'x', ok: true } })]) {
    const c = Trainer.clean(junk, Bank);
    assert.equal(c.q, 0);
    assert.deepEqual(c.cleared, {});
    assert.equal(c.cold, null);
    assert.deepEqual(c.box, {});
  }
  // a stored generated pick survives and rebuilds the same exercise
  const g = Tub.generate('peak', Bank.TEMPLATES[1], 77);
  const c = Trainer.clean(JSON.stringify({ v: 1, current: { id: g.id, mode: 'ladder', rung: 2 } }), Bank);
  assert.equal(c.current.id, g.id);
  assert.equal(JSON.stringify(Trainer.itemFor(g.id, Bank, Tub).inflow), JSON.stringify(g.inflow));
});

/* ------------------------------------------------------------------ */
/* The README's counts                                                  */
/* ------------------------------------------------------------------ */
test('the README states the bank as it is', () => {
  const total = Bank.ITEMS.length;
  assert.ok(README.includes(`${total} hand-made exercises`), `README should say ${total} hand-made exercises`);
  for (const r of [1, 2, 3, 4, 5, 6, 7]) {
    const n = Bank.ITEMS.filter((i) => i.rung === r).length;
    const name = Bank.RUNGS[r].name;
    assert.ok(README.includes(`${name}** (${n})`), `README should list ${name} with ${n}`);
  }
});
