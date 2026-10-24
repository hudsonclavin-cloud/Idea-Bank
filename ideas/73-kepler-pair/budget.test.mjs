// The reading-error budget the page shows (budget.js, made by build.mjs --budget): complete, never
// binding, and the default entry recomputed from scratch. Node built-ins only; under a minute.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { budgetFor, combos } from './build.mjs';

const require = createRequire(import.meta.url);
const K = require('./kepler.js');
const BUDGET = require('./budget.js');

test('budget.js covers every setting the page offers, and the teeth never bound in any of them', () => {
  const keys = combos().map((c) => c.join('|'));
  assert.equal(keys.length, 96);
  assert.deepEqual(Object.keys(BUDGET).sort(), keys.slice().sort());
  for (const k of keys) {
    const b = BUDGET[k];
    assert.equal(b.n, 0, k);
    assert.ok(b.t <= b.b && b.b <= b.l && b.ml <= b.m, k);
    assert.equal(b.d.length, K.design({ body: k.split('|')[0] }).dots);
    assert.ok(Math.max(...b.d) <= Math.round(b.b * 10) + 1, `${k}: no dot worse than the whole`);
  }
});

test('at every setting both wheels stay on their bosses: centre of mass 1 mm inside, even pushed as far as the bore allows', () => {
  // s and sT: how far the Kepler and time wheels' centres of mass lie inside their bosses' flats
  // (mm, rounded to 0.01), from the solids the page would make; h the counterweight that took
  for (const k of combos().map((c) => c.join('|'))) {
    const [body, C, bore] = k.split('|');
    const d = K.design({ body, C: +C, bore: +bore });
    const b = BUDGET[k];
    const need = K.FIXED.steady + d.play;
    assert.ok(b.s >= need - 0.005, `${k}: Kepler wheel only ${b.s} mm inside its boss, needs ${need.toFixed(2)}`);
    assert.ok(b.sT >= need - 0.005, `${k}: time wheel only ${b.sT} mm inside its boss`);
    assert.ok(b.h >= 0 && b.h <= K.FIXED.weightMax, `${k}: counterweight ${b.h} mm`);
  }
});

test('the default entry is what kepler.js computes now', () => {
  assert.deepEqual(budgetFor('mercury', 70, 0.5), BUDGET['mercury|70|0.5']);
});

test('the figures the README quotes are the ones in budget.js', () => {
  // teeth, bores, loose in degrees at 70 mm and a 0.5 mm bore, and whether every dot reads nearest
  // its own dot with the wheels anywhere in their bores (m > 0)
  const quoted = {
    mercury: [1.34, 8.04, 10.99, true],
    mars: [1.16, 6.13, 8.01, true],
    earth: [1.15, 5.49, 7.03, true],
    pluto: [1.52, 9.14, 12.86, false],
  };
  for (const [body, q] of Object.entries(quoted)) {
    const b = BUDGET[`${body}|70|0.5`];
    assert.deepEqual([b.t, b.b, b.l, b.m > 0], q, body);
  }
  // looser bores, Mercury at 70 mm: the README's bore sentence
  assert.deepEqual([0.6, 0.7].map((bore) => BUDGET[`mercury|70|${bore}`].b), [9.52, 11.11]);
  // the default's dot margins: every reading at least 0.17 deg short of the midpoint; read loosely, up to 1.81 past it
  assert.deepEqual([BUDGET['mercury|70|0.5'].m, BUDGET['mercury|70|0.5'].ml], [0.17, -1.81]);
  // 33 of the 96 settings read every dot nearer its own than a neighbour, even at the worst found:
  // Mercury 70-74 mm with a 0.5 mm bore; Mars and Earth from 60 mm (0.5), 68 mm (0.6) and 76 mm (0.7)
  const ok = Object.entries(BUDGET).filter(([, v]) => v.m > 0).map(([k]) => k);
  assert.equal(ok.length, 33);
  const want = ['mercury|70|0.5', 'mercury|72|0.5', 'mercury|74|0.5'];
  for (const body of ['mars', 'earth'])
    for (let C = 56; C <= 76; C += 2) {
      if (C >= 60) want.push(`${body}|${C}|0.5`);
      if (C >= 68) want.push(`${body}|${C}|0.6`);
      if (C === 76) want.push(`${body}|${C}|0.7`);
    }
  assert.deepEqual(ok.slice().sort(), want.sort());
  // the balance the README quotes: the default's counterweight and centre of mass, Mercury's and
  // Pluto's tallest counterweights, none for Mars and Earth, and the time wheel's least margin
  const h = (body) => Object.entries(BUDGET).filter(([k]) => k.startsWith(body)).map(([, v]) => v.h);
  assert.deepEqual([BUDGET['mercury|70|0.5'].h, BUDGET['mercury|70|0.5'].s], [1.4, 1.61]);
  assert.deepEqual([Math.max(...h('mercury')), Math.min(...h('pluto')), Math.max(...h('pluto')), Math.max(...h('mars'), ...h('earth'))], [2.4, 5.4, 6.4, 0]);
  assert.equal(Math.min(...Object.values(BUDGET).map((v) => v.sT)) >= 3.9, true);
});
