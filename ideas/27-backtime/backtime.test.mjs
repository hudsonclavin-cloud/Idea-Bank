// Tests for the Backtime core. Run from the repo root: node --test ideas/27-backtime/backtime.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const B = require('./backtime.js');

const H = 60;
const plan = (dishes, extra = {}) => Object.assign(B.emptyPlan(19 * H), { dishes }, extra);
const dish = (id, name, steps, readyBefore = 0) => ({
  id,
  name,
  readyBefore,
  steps: steps.map((s, i) => ({ id: `s${i + 1}`, label: s[0], minutes: s[1], kind: s[2], temp: s[3] ?? null })),
});
const at = (sched, key) => {
  for (const g of sched.events) for (const it of g.items) if (it.key === key) return g.at;
  return undefined;
};
const times = (sched, serveAt) => sched.events.map((g) => `${B.formatAt(serveAt, g.at, false)} ${g.items.map((i) => i.key).join('+')}`);

// ---------- arithmetic ----------

test('a single dish walks back from the serve time', () => {
  const s = B.schedule(plan([dish('a', 'Pasta', [['Boil', 10, 'hob']])]));
  assert.equal(at(s, 'a/s1'), -10);
  assert.equal(at(s, 'serve'), 0);
  assert.equal(s.startAt, -10);
  assert.equal(s.span, 10);
});

test('steps run back to back and end at serve minus readyBefore', () => {
  const s = B.schedule(plan([dish('a', 'Chicken', [['In', 80, 'oven', 200], ['Rest', 25, 'rest'], ['Carve', 5, 'hands']])]));
  assert.equal(at(s, 'a/s1'), -110);
  assert.equal(at(s, 'a/s2'), -30);
  assert.equal(at(s, 'a/s3'), -5);
  const r = B.schedule(plan([dish('a', 'Crumble', [['Bake', 40, 'oven', 180]], 60)]));
  assert.equal(at(r, 'a/s1'), -100);
  assert.equal(at(r, 'a/ready'), -60, 'a dish done early gets a "ready" marker');
});

test('negative readyBefore means after serving (dessert), and the serve event stays at 0', () => {
  const s = B.schedule(plan([dish('a', 'Crumble', [['Bake', 40, 'oven', 180]], -45)]));
  assert.equal(at(s, 'a/s1'), 5);
  assert.equal(at(s, 'serve'), 0);
  assert.equal(at(s, 'a/ready'), undefined, 'no "ready" marker after serving');
  assert.equal(s.endAt, 5);
  assert.deepEqual(s.conflicts, []);
});

test('events are sorted by time and grouped by minute', () => {
  const s = B.schedule(plan([dish('a', 'Greens', [['Boil', 5, 'hob']]), dish('b', 'Carve', [['Carve', 5, 'hands']]), dish('c', 'Gravy', [['Stir', 10, 'hob']])]));
  assert.deepEqual(
    s.events.map((g) => [g.at, g.items.map((i) => i.key)]),
    [
      [-10, ['c/s1']],
      [-5, ['a/s1', 'b/s1']],
      [0, ['serve']],
    ],
  );
  for (let i = 1; i < s.events.length; i++) assert.ok(s.events[i].at > s.events[i - 1].at);
});

test('an empty plan still has a serve event and nothing else', () => {
  const s = B.schedule(plan([]));
  assert.deepEqual(s.events, [{ at: 0, items: [{ type: 'serve', key: 'serve' }] }]);
  assert.equal(s.span, 0);
  assert.deepEqual(s.conflicts, []);
  assert.equal(B.nextItem(s, {}).item.key, 'serve');
  assert.equal(B.nextItem(s, { serve: true }), null);
});

test('zero-minute steps and dishes with no steps do not break anything', () => {
  const s = B.schedule(plan([dish('a', 'Nothing', []), dish('b', 'Instant', [['Blink', 0, 'hands'], ['Oven', 0, 'oven', 200]])]));
  assert.equal(at(s, 'b/s1'), 0);
  assert.equal(s.stretches.length, 0, 'a zero-minute oven step does not switch the oven on');
  assert.deepEqual(s.conflicts, []);
});

// ---------- the oven ----------

test('the oven goes on one preheat before the first oven step', () => {
  const p = plan([dish('a', 'Chicken', [['In', 80, 'oven', 200]])], { preheat: 15 });
  const s = B.schedule(p);
  assert.equal(at(s, 'preheat:0'), -95);
  assert.equal(s.startAt, -95);
  assert.equal(s.events[0].items[0].temp, 200);
  const z = B.schedule(plan([dish('a', 'Chicken', [['In', 80, 'oven', 200]])], { preheat: 0 }));
  assert.equal(at(z, 'preheat:0'), -80);
  assert.equal(z.events[0].items[0].type, 'preheat', 'preheat is listed before the step it serves');
  assert.equal(z.events[0].items[1].type, 'step');
});

test('overlapping oven steps share one stretch; a short gap keeps the oven on; a long gap switches it off', () => {
  const s = B.schedule(plan([dish('a', 'A', [['In', 60, 'oven', 200]], 60), dish('b', 'B', [['In', 30, 'oven', 200]])]));
  // A: -120..-60, B: -30..0, gap 30 = KEEP_OVEN_ON_GAP -> one stretch
  assert.equal(s.stretches.length, 1);
  assert.equal(at(s, 'ovenoff:0'), undefined);
  const t = B.schedule(plan([dish('a', 'A', [['In', 60, 'oven', 200]], 61), dish('b', 'B', [['In', 30, 'oven', 200]])]));
  assert.equal(t.stretches.length, 2);
  assert.equal(at(t, 'preheat:0'), -136);
  assert.equal(at(t, 'ovenoff:0'), -61, 'the oven is free when the first stretch ends');
  assert.equal(at(t, 'preheat:1'), -45);
  assert.ok(at(t, 'ovenoff:0') < at(t, 'preheat:1'), 'off always comes before the next preheat');
});

test('a slow oven (long preheat) widens the keep-on gap so off never follows preheat', () => {
  const t = B.schedule(plan([dish('a', 'A', [['In', 60, 'oven', 200]], 50), dish('b', 'B', [['In', 30, 'oven', 200]])], { preheat: 45 }));
  assert.equal(t.stretches.length, 1, 'gap 20 < preheat 45: keep it on');
  const u = B.schedule(plan([dish('a', 'A', [['In', 60, 'oven', 200]], 80), dish('b', 'B', [['In', 30, 'oven', 200]])], { preheat: 45 }));
  assert.equal(u.stretches.length, 2, 'gap 50 > preheat 45: switch off and preheat again');
  assert.ok(at(u, 'ovenoff:0') <= at(u, 'preheat:1'));
});

test('the dial follows whatever went in last; a change is noted on that step', () => {
  const s = B.schedule(plan([dish('a', 'Chicken', [['In', 80, 'oven', 190]]), dish('b', 'Yorkshires', [['In', 20, 'oven', 220]])], { ovenTolerance: 40 }));
  const yorks = s.events.find((g) => g.at === -20).items.find((i) => i.key === 'b/s1');
  assert.equal(yorks.ovenTo, 220);
  const chicken = s.events.find((g) => g.at === -80).items.find((i) => i.key === 'a/s1');
  assert.equal(chicken.ovenTo, null, 'the first step is covered by the preheat');
  const same = B.schedule(plan([dish('a', 'A', [['In', 80, 'oven', 200]]), dish('b', 'B', [['In', 20, 'oven', 200]])]));
  assert.equal(same.events.find((g) => g.at === -20).items[0].ovenTo, null, 'same temperature, no note');
});

test('oven steps without a temperature are fine and never clash', () => {
  const s = B.schedule(plan([dish('a', 'A', [['Warm', 10, 'oven', null]]), dish('b', 'B', [['Bake', 30, 'oven', 230]])]));
  assert.deepEqual(s.conflicts, []);
  assert.equal(s.events[0].items[0].temp, 230, 'the preheat shows the temperature of whatever goes in first');
});

test('oven clash: overlapping steps whose temperatures differ by more than the tolerance', () => {
  const p = plan([dish('a', 'Chicken', [['In', 80, 'oven', 190]]), dish('b', 'Yorkshires', [['In', 20, 'oven', 220]])], { ovenTolerance: 25 });
  const s = B.schedule(p);
  assert.equal(s.conflicts.length, 1);
  assert.deepEqual(s.conflicts[0], { type: 'oven', from: -20, to: 0, low: 190, high: 220, dishes: ['Chicken', 'Yorkshires'] });
  p.ovenTolerance = 30;
  assert.deepEqual(B.schedule(p).conflicts, [], 'inside the tolerance is not a clash');
  p.ovenTolerance = 0;
  const q = plan([dish('a', 'A', [['In', 30, 'oven', 200]]), dish('b', 'B', [['In', 30, 'oven', 201]])], { ovenTolerance: 0 });
  assert.equal(B.schedule(q).conflicts.length, 1, 'tolerance 0 flags any difference');
});

test('consecutive clashing segments merge into one flag with the widest temperatures', () => {
  // A 180 for -60..0, B 230 for -60..-30, C 240 for -30..0: two segments, one flag
  const s = B.schedule(plan([dish('a', 'A', [['In', 60, 'oven', 180]]), dish('b', 'B', [['In', 30, 'oven', 230]], 30), dish('c', 'C', [['In', 30, 'oven', 240]])]));
  const oven = s.conflicts.filter((c) => c.type === 'oven');
  assert.equal(oven.length, 1);
  assert.equal(oven[0].from, -60);
  assert.equal(oven[0].to, 0);
  assert.equal(oven[0].low, 180);
  assert.equal(oven[0].high, 240);
  assert.deepEqual(oven[0].dishes, ['A', 'B', 'C']);
});

test('touching but not overlapping oven steps never clash', () => {
  const s = B.schedule(plan([dish('a', 'A', [['In', 30, 'oven', 160]], 30), dish('b', 'B', [['In', 30, 'oven', 240]])]));
  assert.deepEqual(s.conflicts, []);
});

// ---------- hob and hands ----------

test('hob: more pans than rings is flagged; rings = 0 means do not check', () => {
  const pans = ['A', 'B', 'C', 'D', 'E'].map((n) => dish(n.toLowerCase(), n, [['Simmer', 10, 'hob']]));
  const p = plan(pans, { hobRings: 4 });
  const s = B.schedule(p);
  assert.equal(s.conflicts.length, 1);
  assert.deepEqual(s.conflicts[0], { type: 'hob', from: -10, to: 0, count: 5, rings: 4, dishes: ['A', 'B', 'C', 'D', 'E'] });
  p.hobRings = 5;
  assert.deepEqual(B.schedule(p).conflicts, []);
  p.hobRings = 0;
  assert.deepEqual(B.schedule(p).conflicts, []);
});

test('hands: two hands-on jobs at once is a gentle flag; sequential ones are not', () => {
  const s = B.schedule(plan([dish('a', 'Chicken', [['Carve', 5, 'hands']]), dish('b', 'Mash', [['Mash', 5, 'hands']])]));
  assert.equal(s.conflicts.length, 1);
  assert.equal(s.conflicts[0].type, 'hands');
  assert.deepEqual(s.conflicts[0].dishes, ['Chicken', 'Mash']);
  const t = B.schedule(plan([dish('a', 'Chicken', [['Carve', 5, 'hands']], 5), dish('b', 'Mash', [['Mash', 5, 'hands']])]));
  assert.deepEqual(t.conflicts, []);
});

// ---------- the example ----------

test('the worked example has no clashes and reads as intended', () => {
  const p = B.examplePlan();
  const v = B.validatePlan(p);
  assert.ok(v.ok);
  assert.deepEqual(v.problems, []);
  assert.deepEqual(v.plan, p, 'the example survives validation unchanged');
  const s = B.schedule(p);
  assert.deepEqual(s.conflicts, []);
  assert.deepEqual(times(s, p.serveAt), [
    '16:55 preheat:0',
    '17:10 chicken/s1',
    '17:50 potatoes/s1',
    '18:02 potatoes/s2',
    '18:05 potatoes/s3',
    '18:30 chicken/s2',
    '18:33 yorkshires/s1',
    '18:35 yorkshires/s2',
    '18:45 carrots/s1',
    '18:50 gravy/s1',
    '18:55 chicken/s3+greens/s1',
    '18:57 yorkshires/ready',
    '19:00 serve',
  ]);
  const yorks = s.events.find((g) => g.at === -25).items[0];
  assert.equal(yorks.ovenTo, 220, 'the oven goes up for the Yorkshires once the chicken is out');
  assert.equal(s.span, 125);
});

// ---------- midnight and long leads ----------

test('clock times cross midnight and days correctly', () => {
  assert.deepEqual(B.clockOf(30, -120), { day: -1, minute: 1350 });
  assert.equal(B.formatAt(30, -120, false), '22:30 the day before');
  assert.equal(B.formatAt(30, -120, true), '10:30 pm the day before');
  assert.equal(B.formatAt(19 * H, -48 * H, false), '19:00 2 days before');
  assert.equal(B.formatAt(19 * H, -48 * H - 1, false), '18:59 2 days before');
  assert.equal(B.formatAt(23 * H + 30, 45, false), '00:15 the day after');
  assert.equal(B.formatAt(0, 0, false), '00:00');
  assert.equal(B.formatAt(0, 0, true), '12:00 am');
  assert.equal(B.formatAt(12 * H, 0, true), '12:00 pm');
  assert.equal(B.formatAt(23 * H + 59, 0, true), '11:59 pm');
  const s = B.schedule(plan([dish('a', 'Brisket', [['Brine', 48 * H, 'rest'], ['Smoke', 10 * H, 'oven', 110]])], { serveAt: 30 }));
  assert.equal(at(s, 'a/s1'), -58 * H);
  assert.equal(B.formatAt(30, at(s, 'a/s1'), false), '14:30 3 days before');
});

test('durations read naturally', () => {
  assert.equal(B.formatDuration(0), '0 min');
  assert.equal(B.formatDuration(1), '1 min');
  assert.equal(B.formatDuration(59), '59 min');
  assert.equal(B.formatDuration(60), '1 h');
  assert.equal(B.formatDuration(80), '1 h 20 min');
  assert.equal(B.formatDuration(1440), '1 day');
  assert.equal(B.formatDuration(1505), '1 day 1 h');
  assert.equal(B.formatDuration(2880), '2 days');
  assert.equal(B.formatDuration(-5), '0 min');
  assert.equal(B.formatDuration(2.6), '3 min');
});

test('"now" is placed on the assumption you are cooking today', () => {
  assert.equal(B.nowOffset(19 * H, 17 * H), -120);
  assert.equal(B.nowOffset(19 * H, 21 * H), 120);
  assert.equal(B.nowOffset(19 * H, 30), 330, 'up to 6 h after serve counts as after (00:30 is 5.5 h after 19:00)');
  assert.equal(B.nowOffset(19 * H, 1 * H + 1), -1079, 'beyond that it is the small hours before tomorrow\'s dinner');
  assert.equal(B.nowOffset(19 * H, 2 * H), -1020, '02:00 is 7 h after, so it reads as 17 h before');
  assert.equal(B.nowOffset(30, 23 * H), -90, 'serving at 00:30, 23:00 is 90 min before');
  assert.equal(B.nowOffset(0, 1439.5), -0.5, 'fractions (seconds) survive');
});

test('earliest serve time if you start right now, rounded up to 5 minutes and wrapped past midnight', () => {
  const p = B.examplePlan(); // span 125
  assert.deepEqual(B.earliestServe(p, 17 * H + 30), { serveAt: 19 * H + 35, inMinutes: 125, span: 125 });
  assert.deepEqual(B.earliestServe(p, 17 * H + 31), { serveAt: 19 * H + 40, inMinutes: 129, span: 125 });
  assert.equal(B.earliestServe(p, 23 * H).serveAt, 1 * H + 5, 'wraps past midnight');
  const e = B.earliestServe(plan([]), 100.4);
  assert.equal(e.serveAt, 105);
  assert.ok(Math.abs(e.inMinutes - 4.6) < 1e-9);
  assert.equal(e.span, 0);
});

test('nextItem is the first unticked job in timeline order', () => {
  const p = B.examplePlan();
  const s = B.schedule(p);
  assert.equal(B.nextItem(s, {}).item.key, 'preheat:0');
  assert.equal(B.nextItem(s, { 'preheat:0': true }).item.key, 'chicken/s1');
  const done = {};
  for (const g of s.events) for (const i of g.items) done[i.key] = true;
  assert.equal(B.nextItem(s, done), null);
  delete done['greens/s1'];
  assert.equal(B.nextItem(s, done).item.key, 'greens/s1', 'an unticked job stays next even when later ones are ticked');
});

// ---------- parsing ----------

test('parseMinutes accepts the ways people write durations', () => {
  const cases = { 90: 90, '90': 90, ' 45 ': 45, '1h20': 80, '1h 20m': 80, '1h20min': 80, '1:20': 80, '0:05': 5, '1h': 60, '2 hrs': 120, '1.5h': 90, '20m': 20, '20 min': 20, '2 days': 2880, '1day': 1440, '0': 0 };
  for (const [k, v] of Object.entries(cases)) assert.equal(B.parseMinutes(k), v, k);
  assert.equal(B.parseMinutes(90), 90);
  assert.equal(B.parseMinutes(-3), 0);
  for (const bad of ['', '  ', 'abc', '1h20x', '1::20', ':20', 'h', null, undefined, {}, [], NaN, Infinity]) assert.equal(B.parseMinutes(bad), null, String(bad));
});

test('parseTime accepts 24-hour and 12-hour clocks and rejects nonsense', () => {
  assert.equal(B.parseTime('19:00'), 1140);
  assert.equal(B.parseTime('07:05'), 425);
  assert.equal(B.parseTime('7pm'), 1140);
  assert.equal(B.parseTime('7:30 PM'), 1170);
  assert.equal(B.parseTime('12am'), 0);
  assert.equal(B.parseTime('12pm'), 720);
  assert.equal(B.parseTime('00:00'), 0);
  assert.equal(B.parseTime('23:59'), 1439);
  assert.equal(B.parseTime('19'), 1140, 'a bare hour is accepted');
  for (const bad of ['24:00', '19:60', '13pm', '0am', '', 'noon', null, 19]) assert.equal(B.parseTime(bad), null, String(bad));
});

// ---------- validation and import ----------

test('validatePlan survives garbage', () => {
  for (const junk of [null, undefined, 0, 1, '', 'x', [], [1], true, () => {}, NaN]) {
    const v = B.validatePlan(junk);
    assert.equal(v.ok, false, String(junk));
    assert.deepEqual(v.plan.dishes, []);
    assert.doesNotThrow(() => B.schedule(v.plan));
  }
  const v = B.validatePlan({});
  assert.equal(v.ok, false);
  assert.ok(v.problems.includes('no list of dishes'));
});

test('validatePlan coerces, clamps and tidies', () => {
  const v = B.validatePlan({
    serveAt: '1140',
    preheat: -5,
    hobRings: 99,
    ovenTolerance: 'lots',
    tempUnit: 'K',
    hour12: 'yes',
    sound: 1,
    dishes: [
      { id: 'x', name: 42, readyBefore: '15', steps: [{ label: 'a', minutes: '90', kind: 'oven', temp: '200' }, { minutes: 'soon', kind: 'microwave' }, { minutes: 1e9, kind: 'rest', temp: 500 }, null, 'string', [1]] },
      'not a dish',
      { id: 'x', name: 'dup id', steps: [] },
      { name: 'no steps' },
      { name: 'steps not a list', steps: 'nope' },
    ],
    done: { 'x/s1': 1, 'x/s2': 0, [`${'k'.repeat(100)}`]: true },
    extra: 'ignored',
  });
  assert.equal(v.ok, true);
  const p = v.plan;
  assert.equal(p.serveAt, 1140);
  assert.equal(p.preheat, 0);
  assert.equal(p.hobRings, 12);
  assert.equal(p.ovenTolerance, 25);
  assert.equal(p.tempUnit, 'C');
  assert.equal(p.hour12, null);
  assert.equal(p.sound, false);
  assert.equal(p.extra, undefined);
  assert.equal(p.dishes.length, 4);
  const [d0, d1, d2, d3] = p.dishes;
  assert.equal(d0.id, 'x');
  assert.equal(d0.name, '42');
  assert.equal(d0.readyBefore, 15);
  assert.equal(d0.steps.length, 3);
  assert.deepEqual(d0.steps[0], { id: 's1', label: 'a', minutes: 90, kind: 'oven', temp: 200 });
  assert.deepEqual(d0.steps[1], { id: 's2', label: '', minutes: 0, kind: 'hands', temp: null });
  assert.deepEqual(d0.steps[2], { id: 's3', label: '', minutes: B.LIMITS.minutes, kind: 'rest', temp: null });
  assert.notEqual(d1.id, 'x', 'duplicate ids are regenerated');
  assert.equal(d2.name, 'no steps');
  assert.deepEqual(d2.steps, []);
  assert.equal(d3.name, 'steps not a list');
  assert.deepEqual(p.done, { 'x/s1': true });
  assert.ok(v.problems.length >= 5, v.problems.join('; '));
  assert.doesNotThrow(() => B.schedule(p));
});

test('validatePlan keeps unicode names whole and strips control characters', () => {
  const name = '🍗 Poulet rôti — 鸡 ' + '👩‍🍳'.repeat(40);
  const v = B.validatePlan({ dishes: [{ name, steps: [{ label: 'x\u0000y\u001Fz', minutes: 5, kind: 'hands' }] }] });
  const kept = v.plan.dishes[0].name;
  assert.equal(Array.from(kept).length, B.LIMITS.name);
  assert.ok(kept.startsWith('🍗 Poulet rôti — 鸡 '));
  assert.ok(!/[\uD800-\uDBFF]$/.test(kept), 'never ends in half a surrogate pair');
  assert.equal(v.plan.dishes[0].steps[0].label, 'xyz');
  assert.equal(v.plan.dishes[0].name, kept);
});

test('validatePlan caps the size of a plan', () => {
  const big = { dishes: Array.from({ length: 500 }, (_, i) => ({ name: `d${i}`, steps: Array.from({ length: 200 }, (_, j) => ({ label: `s${j}`, minutes: 1, kind: 'oven', temp: 180 })) })) };
  const v = B.validatePlan(big);
  assert.equal(v.plan.dishes.length, B.LIMITS.dishes);
  assert.equal(v.plan.dishes[0].steps.length, B.LIMITS.steps);
  const t0 = Date.now();
  const s = B.schedule(v.plan);
  assert.ok(Date.now() - t0 < 2000, 'the biggest allowed plan schedules in well under 2 s');
  assert.equal(s.intervals.length, B.LIMITS.dishes * B.LIMITS.steps);
});

test('encodePlan / decodePlan round-trip, drop ticks, and reject junk', () => {
  const p = B.examplePlan();
  p.dishes[0].name = 'Poulet rôti 🍗';
  p.done = { 'preheat:0': true };
  const s = B.encodePlan(p);
  assert.match(s, /^[A-Za-z0-9_-]+$/, 'URL-safe, no padding');
  const back = B.decodePlan(s);
  assert.equal(back.dishes[0].name, 'Poulet rôti 🍗');
  assert.deepEqual(back.done, {}, 'a link is a recipe, not a session');
  assert.deepEqual(Object.assign({}, back, { done: p.done }), p);
  for (const bad of ['', 'not base64!!', 'eyJ4IjoxfQ', btoa('[]'), btoa('{"dishes":"x"}'), null, 42]) assert.equal(B.decodePlan(bad), null, String(bad));
});

test('summarizeDish and stepTitle fill in sensible defaults', () => {
  assert.equal(B.summarizeDish({ steps: [] }), 'no steps yet');
  assert.equal(B.summarizeDish(dish('a', 'A', [['', 80, 'oven', 200], ['', 25, 'rest'], ['Carve', 5, 'hands']]), 'F'), 'into the oven 200°F 1 h 20 min → rest 25 min → Carve 5 min');
  assert.equal(B.stepTitle({ kind: 'hob', label: '' }), 'onto the hob');
  assert.equal(B.stepTitle({ kind: 'hands', label: 'Mash' }), 'Mash');
});
