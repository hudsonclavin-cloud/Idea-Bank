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

test('turning the dial UP gets its own job, a lead time before the hotter step goes in', () => {
  const s = B.schedule(plan([dish('a', 'Chicken', [['In', 80, 'oven', 190]]), dish('b', 'Yorkshires', [['In', 20, 'oven', 220]])], { ovenTolerance: 40 }));
  // 15 min preheat to reach 220 from 20 °C; a 30° rise is 15 × 30/200 = 2.25 min, rounded up to 5.
  assert.equal(at(s, 'ovenup:b/s1'), -25, 'the oven goes up 5 min before the Yorkshires, not as they go in');
  const up = s.events.find((g) => g.at === -25).items.find((i) => i.key === 'ovenup:b/s1');
  assert.deepEqual([up.type, up.temp, up.minutes, up.dishName], ['ovenUp', 220, 5, 'Yorkshires']);
  const yorks = s.events.find((g) => g.at === -20).items.find((i) => i.key === 'b/s1');
  assert.equal(yorks.ovenTo, null, 'the step itself carries no late "oven to" note any more');
  const chicken = s.events.find((g) => g.at === -80).items.find((i) => i.key === 'a/s1');
  assert.equal(chicken.ovenTo, null, 'the first step is covered by the preheat');
  const same = B.schedule(plan([dish('a', 'A', [['In', 80, 'oven', 200]]), dish('b', 'B', [['In', 20, 'oven', 200]])]));
  assert.equal(same.events.find((g) => g.at === -20).items[0].ovenTo, null, 'same temperature, no note');
  assert.equal(at(same, 'ovenup:b/s1'), undefined);
});

test('turning the dial DOWN is noted on the step; a rise during the preheat just preheats hotter', () => {
  const down = B.schedule(plan([dish('a', 'Bread', [['Bake', 40, 'oven', 220]]), dish('b', 'Crumble', [['Bake', 20, 'oven', 180]])], { ovenTolerance: 50 }));
  assert.equal(down.events.find((g) => g.at === -20).items.find((i) => i.key === 'b/s1').ovenTo, 180);
  assert.equal(down.events.flatMap((g) => g.items).filter((i) => i.type === 'ovenUp').length, 0);
  // B wants 220 two minutes after A (200) goes in: its lead would start before anything is in.
  const fold = B.schedule(plan([dish('a', 'A', [['In', 60, 'oven', 200]]), dish('b', 'B', [['In', 58, 'oven', 220]])]));
  assert.equal(fold.events[0].items[0].type, 'preheat');
  assert.equal(fold.events[0].items[0].temp, 220, 'preheat straight to the hotter setting');
  assert.equal(fold.events.flatMap((g) => g.items).filter((i) => i.type === 'ovenUp').length, 0);
  // With no preheat time there is no lead: the "up" job lands on the step's own minute, listed first.
  const zero = B.schedule(plan([dish('a', 'A', [['In', 80, 'oven', 190]]), dish('b', 'B', [['In', 20, 'oven', 220]])], { preheat: 0, ovenTolerance: 40 }));
  assert.deepEqual(zero.events.find((g) => g.at === -20).items.map((i) => i.type), ['ovenUp', 'step']);
});

test('riseLead scales a preheat by the share of the climb, rounds up to 5 min, never exceeds the preheat', () => {
  assert.equal(B.riseLead(15, 200, 220), 5);
  assert.equal(B.riseLead(15, 120, 220), 10); // 15 × 100/200 = 7.5
  assert.equal(B.riseLead(15, 20, 220), 15); // a full preheat
  assert.equal(B.riseLead(3, 200, 220), 3, 'capped at the preheat');
  assert.equal(B.riseLead(0, 200, 250), 0);
  assert.equal(B.riseLead(15, 220, 200), 0, 'going down needs no lead');
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
  // From -25, not -20: the oven is climbing to 220 for the 5 min before the Yorkshires go in.
  assert.deepEqual(s.conflicts[0], { type: 'oven', from: -25, to: 0, low: 190, high: 220, dishes: ['Chicken', 'Yorkshires'] });
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

test('touching oven steps clash only while the oven climbs for the hotter one', () => {
  // Hot then cool: the dial goes down as B goes in. No clash.
  const down = B.schedule(plan([dish('a', 'A', [['In', 30, 'oven', 240]], 30), dish('b', 'B', [['In', 30, 'oven', 160]])]));
  assert.deepEqual(down.conflicts, []);
  // Cool then hot: the oven has to climb 80° (10 min) while A is still in, so those 10 min clash...
  const up = B.schedule(plan([dish('a', 'A', [['In', 30, 'oven', 160]], 30), dish('b', 'B', [['In', 30, 'oven', 240]])]));
  assert.deepEqual(up.conflicts, [{ type: 'oven', from: -40, to: -30, low: 160, high: 240, dishes: ['A', 'B'] }]);
  // ...and leaving 10 min between them, as the flag suggests, clears it.
  const gap = B.schedule(plan([dish('a', 'A', [['In', 30, 'oven', 160]], 40), dish('b', 'B', [['In', 30, 'oven', 240]])]));
  assert.deepEqual(gap.conflicts, []);
  // A small rise inside the tolerance never clashes.
  const small = B.schedule(plan([dish('a', 'A', [['In', 30, 'oven', 200]], 30), dish('b', 'B', [['In', 30, 'oven', 220]])]));
  assert.deepEqual(small.conflicts, []);
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
  assert.deepEqual(t.conflicts, [], 'end-to-start touching is not flagged');
  const o = B.schedule(plan([dish('a', 'Chicken', [['Carve', 5, 'hands']], 4), dish('b', 'Mash', [['Mash', 5, 'hands']])]));
  assert.deepEqual(o.conflicts.map((c) => [c.type, c.from, c.to]), [['hands', -5, -4]], 'a one-minute overlap is');
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
  const rows = [
    '16:55 preheat:0',
    '17:10 chicken/s1',
    '17:50 potatoes/s1',
    '18:02 potatoes/s2',
    '18:05 potatoes/s3',
    '18:18 ovenup:yorkshires/s1',
    '18:23 yorkshires/s1',
    '18:30 chicken/s2',
    '18:33 yorkshires/s2',
    '18:35 yorkshires/s3',
    '18:45 carrots/s1',
    '18:50 gravy/s1',
    '18:55 chicken/s3+greens/s1',
    '18:57 yorkshires/ready',
    '19:00 serve',
  ];
  assert.deepEqual(times(s, p.serveAt), rows);
  // The oven goes up to 220 five minutes BEFORE the tin goes in to heat, and the batter goes into a tin
  // that has had 10 min in a 220° oven: no Yorkshire is poured into a tin that was never heated.
  const up = s.events.find((g) => g.at === -42).items[0];
  assert.deepEqual([up.type, up.temp, up.minutes], ['ovenUp', 220, 5]);
  const tin = s.events.find((g) => g.at === -37).items[0];
  assert.equal(tin.title, 'Tin with fat into the oven, until smoking');
  assert.equal(tin.kind, 'oven');
  assert.equal(s.events.find((g) => g.at === -25).items[0].ovenTo, null, 'already at 220 when the batter goes in');
  assert.equal(s.span, 125);
  assert.equal(s.jobCount, 15);
  // The same dinner in °F: cookbook temperatures, the same times, still no clash.
  const f = B.examplePlan('F');
  const sf = B.schedule(f);
  assert.deepEqual(sf.conflicts, []);
  assert.deepEqual(times(sf, f.serveAt), rows);
  assert.equal(B.formatTemp(sf.events[0].items[0].temp, 'F'), '400°F');
  assert.equal(B.formatTemp(sf.events.find((g) => g.at === -42).items[0].temp, 'F'), '425°F');
  assert.deepEqual(B.validatePlan(f).plan, f, 'the °F example survives validation unchanged');
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
  assert.equal(p.tempUnit, null, 'an unknown unit means "follow the locale"');
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

test('validatePlan cuts names by grapheme, so no emoji is split, and strips control characters', () => {
  const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const count = (t) => Array.from(seg.segment(t)).length;
  const name = '🍗 Poulet rôti — 鸡 ' + '👩‍🍳'.repeat(80);
  const v = B.validatePlan({ dishes: [{ name, steps: [{ label: 'x\u0000y\u001Fz', minutes: 5, kind: 'hands' }] }] });
  const kept = v.plan.dishes[0].name;
  assert.equal(count(kept), B.LIMITS.name);
  assert.ok(kept.startsWith('🍗 Poulet rôti — 鸡 '));
  assert.ok(kept.endsWith('👩‍🍳'), 'the last cook emoji is whole, ZWJ and all');
  assert.equal(v.plan.dishes[0].steps[0].label, 'xyz');
  const cut = (t) => B.validatePlan({ dishes: [{ name: t, steps: [] }] }).plan.dishes[0].name;
  // The reviewer's three cases, which the code-point cut used to break:
  const family = '👨‍👩‍👧‍👦';
  assert.equal(cut('a'.repeat(78) + family), 'a'.repeat(78) + family, 'a ZWJ family is one character');
  assert.equal(cut('a'.repeat(79) + '🇬🇧'), 'a'.repeat(79) + '🇬🇧', 'a flag is one character');
  assert.equal(cut('a'.repeat(80) + '🇬🇧'), 'a'.repeat(80), 'and is dropped whole, not left as a lone 🇬');
  assert.equal(cut('a'.repeat(79) + '👍🏽b'), 'a'.repeat(79) + '👍🏽', 'the skin tone stays on the thumb');
  // One "character" made of 1000 combining marks cannot smuggle in a huge name.
  assert.ok(Array.from(cut('Stew' + 'e\u0301'.repeat(10) + '\u0301'.repeat(1000))).length <= B.LIMITS.name * 4);
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
  // 200 °C is shown as 392 °F. (Before this revision it said "200°F": the label changed, the number did not.)
  assert.equal(B.summarizeDish(dish('a', 'A', [['', 80, 'oven', 200], ['', 25, 'rest'], ['Carve', 5, 'hands']]), 'F'), 'into the oven 392°F 1 h 20 min → rest 25 min → Carve 5 min');
  assert.equal(B.summarizeDish(dish('a', 'A', [['', 80, 'oven', 200]]), 'C'), 'into the oven 200°C 1 h 20 min');
  assert.equal(B.stepTitle({ kind: 'hob', label: '' }), 'onto the hob');
  assert.equal(B.stepTitle({ kind: 'hands', label: 'Mash' }), 'Mash');
});

// ---------- temperatures: stored in °C, shown and typed in either unit ----------

test('°C ↔ °F: every whole degree a cook can type comes back as typed, in both units', () => {
  for (let f = 100; f <= 550; f++) {
    const c = B.tempFromDisplay(f, 'F');
    assert.equal(B.displayTemp(c, 'F'), f, `${f}°F`);
    assert.equal(B.tempFromDisplay(String(B.displayTemp(c, 'F')), 'F'), c, `${f}°F typed twice stores the same °C`);
  }
  for (let c = 0; c <= 300; c++) {
    assert.equal(B.tempFromDisplay(c, 'C'), c, 'whole °C are stored exactly');
    assert.equal(B.displayTemp(c, 'C'), c);
    // Switching to °F and back changes nothing stored, so °C survives any number of switches.
    assert.equal(B.displayTemp(B.tempFromDisplay(B.displayTemp(c, 'C'), 'C'), 'C'), c);
  }
  assert.deepEqual([0, 100, 180, 200, 220].map((c) => B.formatTemp(c, 'F')), ['32°F', '212°F', '356°F', '392°F', '428°F']);
  assert.equal(B.formatTemp(200, 'C'), '200°C');
  assert.equal(B.tempFromDisplay(350, 'F'), 176.67);
  assert.equal(B.tempFromDisplay('', 'F'), null);
  assert.equal(B.tempFromDisplay('hot', 'C'), null);
  assert.equal(B.tempFromDisplay(5000, 'F'), B.LIMITS.temp[1], 'clamped to the limits in °C');
});

test('the clash tolerance is a temperature difference: 25 °C is 45 °F, and it converts both ways', () => {
  assert.equal(B.displayDelta(25, 'F'), 45);
  assert.equal(B.displayDelta(25, 'C'), 25);
  assert.equal(B.deltaFromDisplay(45, 'F'), 25);
  assert.equal(B.deltaFromDisplay('40', 'F'), 22.22);
  assert.equal(B.displayDelta(B.deltaFromDisplay(40, 'F'), 'F'), 40);
  assert.equal(B.deltaFromDisplay('x', 'F'), null);
});

test('presets in °F are the cookbook equivalents, stored as °C', () => {
  assert.deepEqual([180, 190, 200, 220].map((c) => B.displayTemp(B.niceTemp(c, 'F'), 'F')), [350, 375, 400, 425]);
  assert.equal(B.niceTemp(200, 'C'), 200);
  assert.equal(B.niceTemp(null, 'F'), null);
  // A roast turkey preset added while the page shows °F: 350 °F, which is 176.67 °C, not "180°F".
  const turkey = dish('t', 'Roast turkey', [['In the oven', 180, 'oven', B.niceTemp(180, 'F')]]);
  assert.equal(turkey.steps[0].temp, 176.67);
  const s = B.schedule(plan([turkey]));
  assert.equal(B.formatTemp(s.events[0].items[0].temp, 'F'), '350°F');
  assert.equal(B.formatTemp(s.events[0].items[0].temp, 'C'), '177°C');
  assert.equal(B.summarizeDish(turkey, 'F'), 'In the oven 350°F 3 h');
});

test('an oven clash at the edge of the tolerance, in both units', () => {
  const two = (t1, t2, tol) => B.schedule(plan([dish('a', 'A', [['In', 30, 'oven', t1]]), dish('b', 'B', [['In', 30, 'oven', t2]])], { ovenTolerance: tol })).conflicts.length;
  // °C: 25° apart is fine, 26° is a clash.
  assert.equal(two(200, 225, 25), 0);
  assert.equal(two(200, 226, 25), 1);
  // °F, typed as °F: 45 °F apart at the default tolerance (25 °C = 45 °F) is fine, 46 is a clash.
  const F = (f) => B.tempFromDisplay(f, 'F');
  assert.equal(two(F(400), F(445), 25), 0);
  assert.equal(two(F(400), F(446), 25), 1);
  // A tolerance typed as 40 °F: 40 apart is fine, 41 is a clash, despite 0.01° storage rounding.
  const tol = B.deltaFromDisplay(40, 'F');
  assert.equal(two(F(400), F(440), tol), 0);
  assert.equal(two(F(400), F(441), tol), 1);
  assert.equal(two(F(350), F(390), tol), 0);
  // Before the fix a °F cook's numbers were compared raw against "25", so 400 and 440 °F clashed.
  assert.equal(two(F(400), F(440), 25), 0, '40 °F apart is inside the default 45 °F');
});

test('the default unit follows the locale: °F for en-US, °C for en-GB', () => {
  assert.equal(B.unitForLocale('en-US'), 'F');
  assert.equal(B.unitForLocale('en'), 'F', 'plain "en" is taken to mean the US, as browsers do');
  assert.equal(B.unitForLocale('es-US'), 'F');
  assert.equal(B.unitForLocale('en-LR'), 'F');
  assert.equal(B.unitForLocale('en_US.UTF-8'), 'F', 'POSIX-style tags are read too');
  assert.equal(B.unitForLocale('en-US@posix'), 'F');
  assert.equal(B.unitForLocale('en_GB'), 'C');
  for (const tag of ['en-GB', 'en-AU', 'en-CA', 'en-IE', 'fr-FR', 'de', 'ja-JP', 'es-MX']) assert.equal(B.unitForLocale(tag), 'C', tag);
  for (const bad of [undefined, null, '', 'not a locale!!', 42]) assert.equal(B.unitForLocale(bad), 'C', String(bad));
  assert.equal(B.emptyPlan().tempUnit, null, 'a new plan follows the locale until the cook picks a unit');
});

test('version-1 plans migrate safely: °C plans are untouched, °F plans keep what can only be °F', () => {
  // A v1 plan in °C (the default): numbers are °C, and the unit is left to the locale.
  const c = B.validatePlan({ version: 1, tempUnit: 'C', dishes: [{ name: 'Chicken', steps: [{ kind: 'oven', minutes: 80, temp: 200 }] }] });
  assert.equal(c.plan.dishes[0].steps[0].temp, 200);
  assert.equal(c.plan.tempUnit, null);
  assert.equal(c.migrated, null);
  assert.equal(c.plan.version, 2);
  // A v1 plan saved in °F mode: a preset added there kept its °C number (200), while a cook who saw the
  // °F label typed real °F numbers (400). No home oven reaches 400 °C, so 400 must be °F.
  const f = B.validatePlan({ version: 1, tempUnit: 'F', ovenTolerance: 25, dishes: [
    { name: 'Chicken', steps: [{ kind: 'oven', minutes: 80, temp: 200 }] },
    { name: 'Potatoes', steps: [{ kind: 'oven', minutes: 55, temp: 400 }] },
    { name: 'Pizza', steps: [{ kind: 'oven', minutes: 10, temp: 261 }] },
  ] });
  assert.deepEqual(f.plan.dishes.map((d) => d.steps[0].temp), [200, 204.44, 127.22]);
  assert.deepEqual(f.migrated, { from: 1, asF: 2, asC: 1 });
  assert.equal(f.plan.tempUnit, 'F', 'the cook chose °F, so it stays');
  assert.equal(f.plan.ovenTolerance, 25);
  assert.ok(f.problems.some((p) => /labelled °F/.test(p)));
  assert.deepEqual(f.plan.dishes.map((d) => B.formatTemp(d.steps[0].temp, 'F')), ['392°F', '400°F', '261°F']);
  // Once migrated it is version 2: validating again changes nothing.
  const again = B.validatePlan(JSON.parse(JSON.stringify(f.plan)));
  assert.deepEqual(again.plan, f.plan);
  assert.equal(again.migrated, null);
  // A version-2 plan in °F is never converted again.
  const v2 = B.validatePlan({ version: 2, tempUnit: 'F', dishes: [{ name: 'Potatoes', steps: [{ kind: 'oven', minutes: 55, temp: 204.44 }] }] });
  assert.equal(v2.plan.dishes[0].steps[0].temp, 204.44);
  assert.equal(v2.migrated, null);
  // An old link (version 1, °F) reports the same migration.
  const link = Buffer.from(JSON.stringify({ version: 1, tempUnit: 'F', dishes: [{ name: 'P', steps: [{ kind: 'oven', minutes: 5, temp: 425 }] }] })).toString('base64url');
  const r = B.readLink(link);
  assert.deepEqual(r.migrated, { from: 1, asF: 1, asC: 0 });
  assert.equal(B.decodePlan(link).dishes[0].steps[0].temp, 218.33);
});

// ---------- ticks belong to one cook ----------

test('ticks remember which dinner they were for, and go stale once it is over', () => {
  const p = B.examplePlan();
  p.serveAt = 13 * H;
  const s = B.schedule(p);
  const sunday = new Date(2026, 10, 1, 10, 55).getTime(); // Sun 1 Nov, 10:55, oven on (13:00 − 125 min)
  p.done = { 'preheat:0': true, 'chicken/s1': true, 'potatoes/s1': true };
  p.doneFor = B.cookOccasion(p.serveAt, -125, sunday);
  assert.equal(p.doneFor, new Date(2026, 10, 1, 13, 0).getTime());
  assert.equal(B.ticksStale(p, s.endAt, new Date(2026, 10, 1, 12, 0).getTime()), false, 'mid-cook');
  assert.equal(B.ticksStale(p, s.endAt, new Date(2026, 10, 1, 18, 59).getTime()), false, 'up to 6 h after serving');
  assert.equal(B.ticksStale(p, s.endAt, new Date(2026, 10, 1, 19, 1).getTime()), true);
  assert.equal(B.ticksStale(p, s.endAt, new Date(2026, 10, 8, 10, 50).getTime()), true, 'the next Sunday starts clean');
  // A tick made late (or early) still lands on the right dinner: up to 12 h either way.
  assert.equal(B.cookOccasion(13 * H, -125, new Date(2026, 10, 1, 14, 30).getTime()), p.doneFor);
  // A brine ticked on Friday evening belongs to Sunday's dinner, and is not stale on Sunday morning.
  const brine = { done: { 'b/s1': true }, doneFor: B.cookOccasion(19 * H, -(48 * H + 60), new Date(2026, 10, 6, 18, 0).getTime()) };
  assert.equal(brine.doneFor, new Date(2026, 10, 8, 19, 0).getTime());
  assert.equal(B.ticksStale(brine, 0, new Date(2026, 10, 8, 10, 0).getTime()), false);
  // Dessert two hours after serving keeps the ticks an hour past its end if that is later than 6 h.
  assert.equal(B.ticksStale(brine, 7 * H, new Date(2026, 10, 9, 2, 30).getTime()), false);
  assert.equal(B.ticksStale(brine, 7 * H, new Date(2026, 10, 9, 3, 1).getTime()), true);
  // No ticks, or no date: nothing to clear.
  assert.equal(B.ticksStale({ done: {}, doneFor: 1 }, 0, Date.now()), false);
  assert.equal(B.ticksStale({ done: { a: true }, doneFor: null }, 0, Date.now()), false);
});

test('moving the serve time moves the dinner the ticks belong to', () => {
  const sun13 = new Date(2026, 10, 1, 13, 0).getTime();
  assert.equal(B.nearestClock(13 * H + 5, sun13), new Date(2026, 10, 1, 13, 5).getTime());
  assert.equal(B.nearestClock(12 * H, sun13), new Date(2026, 10, 1, 12, 0).getTime());
  assert.equal(B.nearestClock(30, new Date(2026, 10, 1, 23, 50).getTime()), new Date(2026, 10, 2, 0, 30).getTime(), 'across midnight');
});

test('doneFor survives validation only alongside ticks, and never travels in a link', () => {
  const when = new Date(2026, 10, 1, 13, 0).getTime();
  assert.equal(B.validatePlan({ dishes: [], done: { a: true }, doneFor: when }).plan.doneFor, when);
  assert.equal(B.validatePlan({ dishes: [], done: {}, doneFor: when }).plan.doneFor, null);
  for (const bad of ['soon', -5, NaN, Infinity, 1e20, {}]) assert.equal(B.validatePlan({ dishes: [], done: { a: true }, doneFor: bad }).plan.doneFor, null, String(bad));
  const p = B.examplePlan();
  p.done = { 'preheat:0': true };
  p.doneFor = when;
  const back = B.decodePlan(B.encodePlan(p));
  assert.equal(back.doneFor, null);
  assert.deepEqual(back.done, {});
});
