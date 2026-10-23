// Tests for the mechanisms in switches.js. Each block pins down a sentence from a
// plaque or from README.md. Run: node --test ideas/50-open-circuit/switches.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const S = require('./switches.js');

const DT = 1 / 60;
function run(model, seconds) {
  const ev = [];
  for (let t = 0; t < seconds; t += DT) ev.push(...model.step(DT));
  return ev;
}
const count = (ev, name) => ev.filter((e) => e === name).length;

/* ------------------------------------------------------------------ Toggle */
test('toggle: contacts change exactly when the lever crosses the centre, not before', () => {
  const t = new S.Toggle();
  assert.equal(t.on, false);
  t.grab();
  for (const p of [-0.9, -0.6, -0.3, -0.05, -0.0001]) assert.deepEqual(t.drag(p), [], `no snap at ${p}`);
  assert.equal(t.on, false);
  assert.deepEqual(t.drag(0.0001), ['snap']);
  assert.equal(t.on, true);
  assert.deepEqual(t.drag(0.5), []);
  // Dragging back across the centre snaps it off again, even without letting go.
  assert.deepEqual(t.drag(-0.1), ['snap']);
  assert.equal(t.on, false);
});

test('toggle: released short of the centre it returns to the side it is on', () => {
  const t = new S.Toggle();
  t.grab();
  t.drag(-0.1);
  t.release();
  run(t, 1);
  assert.equal(t.pos, -1);
  assert.equal(t.on, false);
  t.grab();
  t.drag(0.1); // snaps on
  t.release();
  run(t, 1);
  assert.equal(t.pos, 1);
  assert.equal(t.on, true);
  assert.ok(t.idle());
});

test('toggle: a tap flips it, and reduced motion jumps straight to the end', () => {
  const t = new S.Toggle();
  assert.deepEqual(t.tap(), ['snap']);
  assert.equal(t.on, true);
  assert.equal(t.pos, -1, 'lever has not moved yet');
  t.step(Infinity);
  assert.equal(t.pos, 1);
  assert.ok(t.idle());
});

/* ---------------------------------------------------------------- Detented */
test('rotary: 8 positions 30 degrees apart, one detent per position passed, never resting between', () => {
  const r = new S.Detented({ positions: 8, spacing: 30 });
  assert.equal(r.sweep, 210);
  r.grab();
  assert.deepEqual(r.drag(10), []);
  assert.deepEqual(r.drag(16), ['detent']);
  assert.equal(r.index, 1);
  // A fast drag across several positions clicks once per position.
  assert.deepEqual(r.drag(140), ['detent', 'detent', 'detent', 'detent']);
  assert.equal(r.index, 5);
  // Past the end stop it just stays at the end.
  assert.deepEqual(r.drag(900), ['detent', 'detent']);
  assert.equal(r.index, 7);
  assert.equal(r.pos, 210);
  r.release();
  run(r, 1);
  assert.equal(r.pos, 210);
  // Let go between two detents: it settles onto the nearest one.
  r.grab();
  r.drag(44);
  r.release();
  run(r, 1);
  assert.equal(r.index, 1);
  assert.equal(r.pos, 30);
  assert.ok(r.idle());
});

test('rotary and slide: tapping steps one position and stops at the ends', () => {
  const r = new S.Detented({ positions: 3, spacing: 1, index: 2 });
  assert.deepEqual(r.tap(1), ['stop']);
  assert.deepEqual(r.tap(-1), ['detent']);
  assert.deepEqual(r.tap(-1), ['detent']);
  assert.deepEqual(r.tap(-1), ['stop']);
  assert.equal(r.index, 0);
});

/* --------------------------------------------------------------- Momentary */
test('doorbell push: closes at 70% travel, opens again at 30% (hysteresis)', () => {
  const m = new S.Momentary();
  assert.deepEqual(m.setDepth(0.69), []);
  assert.deepEqual(m.setDepth(0.7), ['down']);
  assert.deepEqual(m.setDepth(0.5), [], 'still closed at 50% on the way up');
  assert.deepEqual(m.setDepth(0.31), []);
  assert.deepEqual(m.setDepth(0.3), ['up']);
  assert.deepEqual(m.setDepth(0.5), [], 'still open at 50% on the way down');
});

test('doorbell push: a tap gives one down and one up, in that order, and springs back', () => {
  const m = new S.Momentary();
  m.tap();
  const ev = run(m, 1);
  assert.deepEqual(ev, ['down', 'up']);
  assert.equal(m.depth, 0);
  assert.ok(m.idle());
  // Holding it down keeps it closed until released.
  const h = new S.Momentary();
  h.press();
  assert.deepEqual(run(h, 0.5), ['down']);
  assert.equal(h.closed, true);
  h.release();
  assert.deepEqual(run(h, 0.5), ['up']);
});

test('keyboard key: clicks at 55% of travel, resets at 40%, and bottoms out once', () => {
  const k = new S.Momentary({ closeAt: 0.55, openAt: 0.4, bottom: true });
  k.tap();
  const ev = run(k, 1);
  assert.deepEqual(ev, ['down', 'bottom', 'up']);
  assert.deepEqual(k.setDepth(0.54), []);
  assert.deepEqual(k.setDepth(0.55), ['down']);
  assert.deepEqual(k.setDepth(0.41), []);
  assert.deepEqual(k.setDepth(0.4), ['up']);
});

/* ---------------------------------------------------------------- Latching */
test('push-on push-off: a full press arms the cam, letting go latches; the next press releases', () => {
  const l = new S.Latching();
  l.press();
  assert.deepEqual(run(l, 0.5), ['click']);
  assert.equal(l.latched, false, 'nothing latches until the button is let go');
  assert.deepEqual(l.release(), ['latch']);
  const seat = run(l, 1);
  assert.deepEqual(seat, ['seat']);
  assert.equal(l.depth, 0.45, 'rests part way down while latched');
  l.press();
  run(l, 0.5);
  assert.deepEqual(l.release(), ['unlatch']);
  run(l, 1);
  assert.equal(l.depth, 0);
  assert.ok(l.idle());
});

test('push-on push-off: a press that does not go all the way down latches nothing', () => {
  const l = new S.Latching();
  l.setDepth(0.8);
  assert.equal(l.armed, false);
  assert.deepEqual(l.release(), []);
  assert.equal(l.latched, false);
  // Taps alternate.
  const m = new S.Latching();
  m.tap();
  run(m, 1);
  assert.equal(m.latched, true);
  m.tap();
  run(m, 1);
  assert.equal(m.latched, false);
});

/* --------------------------------------------------------------------- Dip */
test('dip switch: eight ways, each flip is a tick, read as a binary word', () => {
  const d = new S.Dip({ ways: 8, bits: [0, 1, 0, 1, 1, 0, 1, 0] });
  assert.equal(d.toString(), '01011010');
  assert.deepEqual(d.flip(0), ['tick']);
  assert.equal(d.toString(), '11011010');
  assert.deepEqual(d.flip(8), [], 'no ninth way');
});

test('dip switch: the keyboard chooses a way, then flips it or puts it ON or OFF', () => {
  const d = new S.Dip({ ways: 8, bits: [0, 1, 0, 1, 1, 0, 1, 0] });
  assert.equal(d.selected, 0);
  assert.deepEqual(d.select(-1), [], 'choosing makes no sound');
  assert.equal(d.selected, 0, 'stops at way 1');
  d.select(1);
  d.select(1);
  assert.equal(d.selected, 2, 'way 3');
  assert.equal(d.toString(), '01011010', 'choosing a way flips nothing');
  assert.deepEqual(d.flip(), ['tick']);
  assert.equal(d.toString(), '01111010', 'only way 3 flipped');
  assert.deepEqual(d.set(2, true), [], 'already ON: nothing moves');
  assert.deepEqual(d.set(2, false), ['tick']);
  assert.equal(d.toString(), '01011010');
  for (let i = 0; i < 12; i++) d.select(1);
  assert.equal(d.selected, 7, 'stops at way 8');
});

/* ------------------------------------------------------------------- Knife */
test('knife switch: bistable; dropped on the lower half it falls home with one clack', () => {
  const k = new S.Knife({ open: true });
  k.grab();
  assert.deepEqual(k.drag(0.4), []);
  k.release();
  const ev = run(k, 2);
  assert.deepEqual(ev, ['clack']);
  assert.equal(k.pos, 0);
  assert.equal(k.closed, true);
  assert.ok(k.idle());
  // Dropped on the upper half it swings open silently and stays there.
  k.grab();
  k.drag(0.6);
  k.release();
  assert.deepEqual(run(k, 2), []);
  assert.equal(k.pos, 1);
});

test('knife switch: pushed home by hand it clacks once, and taps alternate', () => {
  const k = new S.Knife({ open: true });
  k.grab();
  assert.deepEqual(k.drag(0.01), ['clack']);
  assert.deepEqual(k.drag(0.0), [], 'no second clack while held home');
  k.release();
  run(k, 1);
  assert.deepEqual(k.tap(), ['open']);
  run(k, 2);
  assert.equal(k.pos, 1);
  assert.deepEqual(k.tap(), []);
  assert.deepEqual(run(k, 2), ['clack']);
});

/* --------------------------------------------------------------- PullChain */
test('pull chain: beads tick over the collar on the way down; one full pull advances the ratchet once', () => {
  const c = new S.PullChain();
  c.grab();
  assert.deepEqual(c.drag(0.1), []);
  assert.deepEqual(c.drag(0.25), ['bead', 'bead']);
  assert.equal(c.on, false, 'a short pull changes nothing');
  const ev = c.drag(1);
  assert.equal(count(ev, 'clunk'), 1);
  assert.equal(c.on, true);
  assert.deepEqual(c.drag(0.97), [], 'hanging on does not advance it again');
  assert.deepEqual(c.drag(1), []);
  c.release();
  run(c, 1);
  assert.equal(c.pos, 0);
  assert.ok(c.idle());
  assert.deepEqual(c.tap(), ['clunk']);
  assert.equal(c.on, false);
});

test('pull chain: caught on the way back up, it will not advance again until it has returned most of the way', () => {
  const c = new S.PullChain();
  c.grab();
  assert.equal(count(c.drag(1), 'clunk'), 1);
  c.release();
  // Let it spring back to about half way, then grab it and pull it all the way again.
  while (c.pos > 0.5) c.step(1 / 240);
  c.grab();
  assert.equal(count(c.drag(1), 'clunk'), 0, 'the ratchet has not re-engaged yet');
  assert.equal(c.on, true);
  c.release();
  run(c, 1);
  // Back at the top, the next full pull advances it.
  c.grab();
  assert.equal(count(c.drag(1), 'clunk'), 1);
  assert.equal(c.on, false);
});

test('pull chain: let back up without letting go, the ratchet re-engages and the next full pull advances it', () => {
  const c = new S.PullChain();
  c.grab();
  const first = c.drag(1);
  assert.equal(count(first, 'clunk'), 1);
  assert.equal(c.on, true);
  // Back up only half way while held: not re-engaged yet.
  c.drag(0.5);
  assert.equal(count(c.drag(1), 'clunk'), 0, 'half way back is not far enough');
  // All the way back up, still held: re-engaged; the beads tick again on the way down.
  assert.deepEqual(c.drag(0), []);
  const second = c.drag(1);
  assert.equal(count(second, 'clunk'), 1, 'second full stroke in one hold advances it');
  assert.equal(count(second, 'bead'), count(first, 'bead'), 'and ticks as many beads as the first');
  assert.equal(c.on, false);
  assert.deepEqual(c.drag(0.97), [], 'hanging on still does nothing more');
  c.release();
  run(c, 1);
  assert.ok(c.idle());
});

/* ----------------------------------------------------------------- Breaker */
test('breaker: TEST trips it only when ON; tripped, it cannot be switched ON until pushed OFF', () => {
  const b = new S.Breaker({ state: 'on' });
  assert.deepEqual(b.test(), ['click', 'trip']);
  assert.equal(b.state, 'tripped');
  assert.deepEqual(b.test(), ['click'], 'TEST on a tripped breaker just clicks');
  run(b, 1);
  assert.equal(b.pos, 0.5, 'lever rests in the middle');
  // Push it up toward ON: it refuses and flops back to the middle.
  b.grab();
  assert.deepEqual(b.drag(1), []);
  assert.equal(b.state, 'tripped');
  assert.deepEqual(b.release(), ['refuse']);
  run(b, 1);
  assert.equal(b.pos, 0.5);
  assert.deepEqual(b.tap(), ['refuse']);
  run(b, 1);
  assert.equal(b.pos, 0.5);
  // Push it fully OFF: reset. Now it will go ON.
  b.grab();
  assert.deepEqual(b.drag(0.1), ['reset']);
  assert.equal(b.state, 'off');
  assert.deepEqual(b.drag(0.8), ['snap']);
  assert.equal(b.state, 'on');
  b.release();
  run(b, 1);
  assert.equal(b.pos, 1);
  assert.ok(b.idle());
});

test('breaker: pushed in a direction (the keyboard), it resets from tripped toward OFF and refuses toward ON', () => {
  const b = new S.Breaker({ state: 'on' });
  b.test();
  assert.equal(b.state, 'tripped');
  assert.deepEqual(b.push(1), ['refuse'], 'pushed toward ON it refuses');
  assert.equal(b.state, 'tripped');
  run(b, 1);
  assert.equal(b.pos, 0.5, 'and flops back to the middle');
  assert.deepEqual(b.push(-1), ['reset'], 'pushed toward OFF it resets');
  assert.equal(b.state, 'off');
  assert.deepEqual(b.push(-1), [], 'already OFF: pushing it further does nothing');
  assert.equal(b.state, 'off');
  assert.deepEqual(b.push(1), ['snap']);
  assert.equal(b.state, 'on');
  assert.deepEqual(b.push(1), [], 'already ON: pushing it further does nothing');
  assert.deepEqual(b.push(-1), ['snap']);
  assert.equal(b.state, 'off');
  run(b, 1);
  assert.equal(b.pos, 0);
  assert.ok(b.idle());
});

test('breaker: taps toggle between OFF and ON when not tripped', () => {
  const b = new S.Breaker({ state: 'off' });
  assert.deepEqual(b.test(), ['click']);
  assert.deepEqual(b.tap(), ['snap']);
  assert.equal(b.state, 'on');
  assert.deepEqual(b.tap(), ['snap']);
  assert.equal(b.state, 'off');
});

/* ----------------------------------------------------------------- Guarded */
test('guarded toggle: cannot be worked under the cover; closing the cover forces it OFF', () => {
  const g = new S.Guarded();
  assert.deepEqual(g.tap(), ['blocked']);
  assert.deepEqual(g.grab(), ['blocked']);
  assert.equal(g.toggle.on, false);
  assert.deepEqual(g.coverTap(), ['lift']);
  assert.deepEqual(g.tap(), ['blocked'], 'the cover is still swinging open');
  run(g, 1);
  assert.equal(g.cover, 1);
  // With the cover up the lever drags like any toggle, and reports its position.
  assert.equal(g.pos, -1);
  g.grab();
  assert.deepEqual(g.drag(0.2), ['snap']);
  assert.equal(g.pos, 0.2);
  assert.deepEqual(g.drag(-0.2), ['snap']);
  g.release();
  run(g, 1);
  assert.equal(g.toggle.on, false);
  assert.deepEqual(g.tap(), ['snap']);
  assert.equal(g.toggle.on, true);
  assert.deepEqual(g.coverTap(), ['drop', 'snap']);
  assert.equal(g.toggle.on, false);
  run(g, 1);
  assert.equal(g.cover, 0);
  assert.ok(g.idle());
});

test('guarded toggle: a cover dragged shut forces the switch OFF while still held', () => {
  const g = new S.Guarded();
  g.coverTap();
  run(g, 1);
  g.tap();
  assert.equal(g.toggle.on, true, 'armed');
  g.coverGrab();
  assert.deepEqual(g.coverDrag(0.4), [], 'not shut yet');
  assert.equal(g.toggle.on, true);
  assert.equal(g.toggleUsable, false, 'but it cannot be worked under a cover that is coming down');
  assert.deepEqual(g.tap(), ['blocked']);
  assert.deepEqual(g.coverDrag(0.2), ['drop', 'snap'], 'shut: the switch is forced OFF at once');
  assert.equal(g.toggle.on, false);
  assert.equal(g.coverOpen, false);
  assert.deepEqual(g.coverDrag(0), []);
  assert.deepEqual(g.coverRelease(), [], 'letting go of a shut cover changes nothing');
  run(g, 1);
  assert.equal(g.cover, 0);
  assert.ok(g.idle());
  // Dragged shut, then back up past half before letting go: it opens, still OFF.
  g.coverTap();
  run(g, 1);
  g.tap();
  g.coverGrab();
  assert.deepEqual(g.coverDrag(0.1), ['drop', 'snap']);
  assert.deepEqual(g.coverDrag(0.8), []);
  assert.deepEqual(g.coverRelease(), ['lift']);
  assert.equal(g.toggle.on, false);
});

test('guarded toggle: a cover dragged and dropped settles open or closed by halves', () => {
  const g = new S.Guarded();
  g.coverGrab();
  g.coverDrag(0.49);
  assert.deepEqual(g.coverRelease(), []);
  run(g, 1);
  assert.equal(g.cover, 0);
  g.coverGrab();
  g.coverDrag(0.5);
  assert.deepEqual(g.coverRelease(), ['lift']);
  run(g, 1);
  assert.equal(g.cover, 1);
});

/* ------------------------------------------------------------------- EStop */
test('e-stop: push latches; it releases only with a twist of 30 degrees or more', () => {
  const e = new S.EStop();
  assert.deepEqual(e.press(), ['thunk']);
  assert.deepEqual(e.press(), ['dead'], 'pushing a latched head does nothing');
  run(e, 1);
  assert.equal(e.depth, 1);
  e.twistGrab();
  assert.deepEqual(e.twistTo(29), []);
  assert.equal(e.latched, true);
  e.twistRelease();
  run(e, 1);
  assert.equal(e.twist, 0, 'a small twist springs back');
  assert.equal(e.depth, 1);
  e.twistGrab();
  assert.deepEqual(e.twistTo(30), ['pop']);
  assert.equal(e.latched, false);
  run(e, 1);
  assert.equal(e.depth, 0);
  assert.equal(e.twist, 0);
  assert.ok(e.idle());
  // Twisting an unlatched head releases nothing.
  e.twistGrab();
  assert.deepEqual(e.twistTo(45), []);
});

test('e-stop: a press latches it at once, however long it is held and however the finger wanders', () => {
  const e = new S.EStop();
  assert.deepEqual(e.grab(), ['thunk'], 'latched on the push, not on letting go');
  assert.equal(e.latched, true);
  run(e, 0.6); // held for 0.6 s
  assert.equal(e.depth, 1);
  assert.deepEqual(e.drag(3), [], 'a finger that drifts a little');
  assert.deepEqual(e.release(), []);
  assert.equal(e.latched, true);
  run(e, 1);
  assert.equal(e.twist, 0);
  // Pressing it again, held, does nothing but make a dead sound on letting go.
  assert.deepEqual(e.grab(), []);
  run(e, 0.6);
  assert.deepEqual(e.release(), ['dead']);
  assert.equal(e.latched, true);
  // A small twist springs back; a full one releases it.
  e.grab();
  assert.deepEqual(e.drag(20), []);
  assert.deepEqual(e.release(), [], 'a twist is not a press');
  run(e, 1);
  assert.equal(e.latched, true);
  e.grab();
  assert.deepEqual(e.drag(15), []);
  assert.deepEqual(e.drag(31), ['pop']);
  assert.deepEqual(e.drag(45), [], 'only one pop');
  assert.deepEqual(e.release(), []);
  run(e, 1);
  assert.equal(e.latched, false);
  assert.ok(e.idle());
});

/* -------------------------------------------------------------- UselessBox */
test('useless machine: for every seed, it switches itself off within 6 seconds and tidies up within 10', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const u = new S.UselessBox({ seed });
    assert.deepEqual(u.tap(), ['snap']);
    assert.equal(u.toggle.on, true);
    let offAt = null;
    for (let t = 0; t < 10; t += DT) {
      const ev = u.step(DT);
      if (offAt === null && ev.includes('snap')) offAt = t;
    }
    assert.ok(offAt !== null && offAt < 6, `seed ${seed} (${u.mood}): switched off at ${offAt}`);
    assert.equal(u.toggle.on, false, `seed ${seed}`);
    assert.equal(u.lid, 0, `seed ${seed}: lid closed again`);
    assert.equal(u.arm, 0, `seed ${seed}: arm back inside`);
    assert.equal(u.flips, 1, `seed ${seed}: flipped exactly once`);
    assert.ok(u.idle(), `seed ${seed}: idle afterwards`);
  }
});

test('useless machine: every mood occurs, and the arm never flips a switch that is already off', () => {
  const moods = new Set();
  for (let seed = 1; seed <= 60; seed++) {
    const u = new S.UselessBox({ seed });
    u.tap();
    moods.add(u.mood);
    // The visitor switches it off themselves before the arm arrives.
    u.toggle.on = false;
    const ev = run(u, 10);
    assert.equal(count(ev, 'snap'), 0, `seed ${seed}: the arm found it off and left it alone`);
    assert.equal(u.flips, 0);
    assert.equal(u.lid, 0);
    assert.equal(u.arm, 0);
  }
  for (const m of ['prompt', 'slow', 'peek', 'fake', 'instant', 'sulk']) assert.ok(moods.has(m), `mood ${m} occurs`);
});

test('useless machine: dragging its lever past centre provokes it just like a tap', () => {
  const u = new S.UselessBox({ seed: 11 });
  assert.equal(u.pos, -1);
  u.grab();
  assert.deepEqual(u.drag(-0.4), []);
  assert.ok(!u.active, 'not provoked short of centre');
  assert.deepEqual(u.drag(0.3), ['snap']);
  assert.ok(u.active, 'provoked once the lever crosses centre');
  u.release();
  let off = null;
  for (let t = 0; t < 10; t += DT) if (u.step(DT).includes('snap') && off === null) off = t;
  assert.ok(off !== null && off < 6);
  assert.equal(u.toggle.on, false);
});

test('useless machine: switched on again while the arm is out, it flips it straight back', () => {
  const u = new S.UselessBox({ seed: 3 });
  u.tap();
  // Step until the arm is most of the way out, then provoke it again right after the flip.
  let flipped = false;
  for (let t = 0; t < 10 && !flipped; t += DT) flipped = u.step(DT).includes('snap');
  assert.ok(flipped);
  assert.ok(u.arm > 0.5, 'arm is still out just after the flip');
  u.tap(); // visitor flips it on again immediately
  assert.equal(u.toggle.on, true);
  let again = null;
  for (let t = 0; t < 2 && again === null; t += DT) if (u.step(DT).includes('snap')) again = t;
  assert.ok(again !== null && again < 0.5, `flipped back quickly (${again})`);
  run(u, 5);
  assert.ok(u.idle());
});

test('useless machine: switched on again at any moment, it still wins', () => {
  // Re-provoke it at every frame of the first 5 s, for 200 seeds (every mood),
  // including while the arm is on its way home after the flip.
  let tried = 0;
  for (let seed = 1; seed <= 200; seed++) {
    for (let k = 1; k < 300; k += 2) {
      const u = new S.UselessBox({ seed });
      u.tap();
      for (let i = 0; i < k; i++) u.step(DT);
      if (u.toggle.on) continue; // still on: nothing to switch on again
      tried++;
      assert.deepEqual(u.tap(), ['snap']);
      let off = null;
      for (let t = 0; t < 10; t += DT) if (u.step(DT).includes('snap') && off === null) off = t;
      assert.ok(off !== null && off < 6, `seed ${seed} (${u.mood}), on again at frame ${k}: off at ${off}`);
      assert.equal(u.toggle.on, false);
      assert.equal(u.flips, 2);
      assert.ok(u.idle() && u.lid === 0 && u.arm === 0, `seed ${seed}, frame ${k}: tidied away`);
    }
  }
  assert.ok(tried > 15000, `${tried} re-provocations tried`);
  // A visitor who will not leave it alone: random taps and drags at random times.
  const rnd = S.mulberry32(99);
  for (let seed = 1; seed <= 300; seed++) {
    const u = new S.UselessBox({ seed });
    for (let i = 0; i < 600; i++) {
      const r = rnd();
      if (r < 0.03) u.tap();
      else if (r < 0.05) {
        u.grab();
        u.drag(rnd() * 2 - 1);
        u.drag(rnd() * 2 - 1);
        u.release();
      }
      u.step(DT);
    }
    run(u, 10);
    assert.equal(u.toggle.on, false, `fuzz seed ${seed}: it switched itself off in the end`);
    assert.ok(u.idle() && u.lid === 0 && u.arm === 0, `fuzz seed ${seed}: tidied away`);
  }
});

test('useless machine: reduced motion keeps the pauses but jumps the lid and arm', () => {
  const u = new S.UselessBox({ seed: 7 });
  u.instant = true;
  u.tap();
  const seen = new Set();
  for (let t = 0; t < 10; t += DT) {
    u.step(DT);
    seen.add(`${u.lid}|${u.arm}`);
  }
  for (const s of seen) for (const v of s.split('|')) assert.ok(v === '0' || v === '1' || Number(v) > 0, s);
  assert.ok([...seen].every((s) => s.split('|').every((v) => ['0', '1', '0.35', '0.72', '0.3'].includes(v))), 'only rest positions, no in-betweens');
  assert.equal(u.toggle.on, false);
});

/* ------------------------------------------------------------------- Tally */
test('tally counter: counts every press and reads 0000 again after 9999', () => {
  const t = new S.Tally({ count: 9998 });
  assert.equal(t.digits(), '9998');
  assert.deepEqual(t.press(), ['click']);
  assert.equal(t.digits(), '9999');
  t.press();
  assert.equal(t.digits(), '0000');
  run(t, 2);
  assert.equal(t.shown, 0);
  assert.ok(t.idle());
});

test('tally counter: at rest every drum sits square on its digit, for every count', () => {
  const t = new S.Tally();
  for (let n = 0; n < 10000; n++) {
    const d = t.drums(n);
    assert.equal(d.map((x) => x.digit).join(''), String(n).padStart(4, '0'), `count ${n}`);
    assert.ok(d.every((x) => x.frac === 0), `count ${n}: a drum sits between digits (${d.map((x) => x.frac)})`);
  }
});

test('tally counter: a drum is carried only while the units drum rolls from 9 to 0 with every drum below it at 9', () => {
  const t = new S.Tally();
  for (let n = 0; n < 10000; n++) {
    for (const f of [0.25, 0.5, 0.75]) {
      const d = t.drums(n + f);
      const want = String(n).padStart(4, '0');
      for (let i = 0; i < 4; i++) {
        const place = 10 ** (3 - i);
        const carried = place === 1 || n % place === place - 1;
        assert.equal(String(d[i].digit), want[i], `${n + f}: drum ${i} digit`);
        assert.ok(Math.abs(d[i].frac - (carried ? f : 0)) < 1e-9, `${n + f}: drum ${i} turned ${d[i].frac}`);
      }
    }
  }
  // Every drum turns smoothly forward and never jumps.
  const pos = (v) => t.drums(v).map((x) => x.digit + x.frac);
  let prev = pos(0);
  for (let v = 0.01; v < 10000; v += 0.01) {
    const p = pos(v);
    for (let i = 0; i < 4; i++) {
      const step = (((p[i] - prev[i]) % 10) + 10) % 10;
      assert.ok(step < 0.0101, `drum ${i} jumped ${step} at ${v}`);
    }
    prev = p;
  }
});

test('tally counter: after counting at any frame rate, the drums come to rest on the count', () => {
  const rnd = S.mulberry32(42);
  for (const dt of [1 / 240, 1 / 120, 1 / 60, 1 / 30, 0.05, Infinity]) {
    const t = new S.Tally({ count: 9990 });
    t.shown = 9990;
    for (let i = 0; i < 300; i++) {
      if (rnd() < 0.2) t.bump();
      t.step(dt);
    }
    for (let i = 0; i < 300 && !t.idle(); i++) t.step(dt);
    assert.ok(t.idle(), `dt ${dt}`);
    const d = t.drums();
    assert.equal(d.map((x) => x.digit).join(''), t.digits(), `dt ${dt}`);
    assert.ok(d.every((x) => x.frac === 0), `dt ${dt}`);
  }
});

/* ------------------------------------------------------------------ settle */
test('settle: reaches its target, jumps with dt = Infinity, and ignores dt <= 0', () => {
  const s = { pos: 0, vel: 0 };
  let done = false;
  for (let i = 0; i < 600 && !done; i++) done = S.settle(s, DT, 1);
  assert.ok(done);
  assert.equal(s.pos, 1);
  const j = { pos: 0, vel: 0 };
  assert.ok(S.settle(j, Infinity, 5));
  assert.equal(j.pos, 5);
  const z = { pos: 0, vel: 0 };
  assert.equal(S.settle(z, 0, 1), false);
  assert.equal(z.pos, 0);
});
