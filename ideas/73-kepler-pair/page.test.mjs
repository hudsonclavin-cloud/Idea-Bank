// The words: the figures the README and the page quote are the ones the code computes, and the
// corrections made after the independent review stay made. Node built-ins only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const K = require('./kepler.js');
const BUDGET = require('./budget.js');
const readme = fs.readFileSync(path.join(here, 'README.md'), 'utf8');
const page = fs.readFileSync(path.join(here, 'index.html'), 'utf8');
// prose without line breaks or markup, so a phrase can be found wherever it wraps
const flat = (t) => t.replace(/<[^>]+>/g, '').replace(/\*/g, '').replace(/\s+/g, ' ');
const README = flat(readme);
const PAGE = flat(page);
const NAMES = { mercury: 'Mercury', mars: 'Mars', earth: 'Earth', pluto: 'Pluto' };

test('the orbit table\'s last column is budget.js at 70 mm with a 0.5 mm bore', () => {
  for (const [body, name] of Object.entries(NAMES)) {
    const row = readme.split('\n').find((l) => l.startsWith(`| ${name}`));
    assert.ok(row, name);
    const last = row.split('|').map((c) => c.trim()).filter(Boolean).pop();
    assert.equal(last, `${BUDGET[`${body}|70|0.5`].b.toFixed(2)}°`, name);
  }
  // and the column says what was computed: the bore's true play, not its least gap
  assert.match(README, /each wheel's centre anywhere within 0\.54 mm of its peg's centre/);
});

test('printing: no skirt on a 180 mm bed, and the Kepler wheel solid', () => {
  // with a skirt 6 mm out (PrusaSlicer's default), a plate wider than 167 mm prints off a 180 mm bed
  let wide = 0;
  let n = 0;
  for (const body of K.OPTIONS.bodies)
    for (const C of K.cRange(body)) {
      const d = K.design({ body, C });
      if (d.plate.x1 - d.plate.x0 > 167) wide++;
      n++;
    }
  assert.equal(n, 32);
  assert.match(README, new RegExp(`${wide} of the 32 orbit-and-size combinations`));
  assert.ok(K.design({}).plate.x1 - K.design({}).plate.x0 > 167, 'the default plate is one of them');
  assert.match(README, /no brim and no skirt/);
  assert.match(PAGE, /no brim, and no skirt/);
  // the counterweight only works if the plastic is where the solid is
  assert.match(README, /Kepler wheel at 100% infill/);
  assert.match(PAGE, /Kepler wheel at 100% infill/);
});

test('one tooth out jams or jumps, rather than staying a sixteenth of an orbit out', () => {
  for (const t of [README, PAGE]) assert.doesNotMatch(t, /a tooth out is a sixteenth of an orbit out/);
  assert.match(README, /one tooth out, the pair jams or jumps a tooth within a turn/);
  assert.match(PAGE, /one tooth out, the pair jams or jumps a tooth within a turn/);
  // one tooth on, what the windows show (kepler.test.mjs), not the drift against a pair a tooth out
  assert.doesNotMatch(README, /runs 6–9° wrong/);
  assert.doesNotMatch(README, /does not run a sixteenth of an orbit out/);
  assert.match(README, /One tooth on, the planet window reads about a sixteenth of an orbit \(roughly 20–30°\) behind the time window, until its play closes up at about 211° and it can only go on by jumping a tooth, after which it reads as a pair seated right does\./);
  assert.match(README, /it does not stay a sixteenth of an orbit out\. One tooth on, the planet window reads roughly 20–30° behind the time window until the pair jumps a tooth\./);
});

test('the page hedges what nobody has felt, and says it will be seen more than felt', () => {
  assert.doesNotMatch(PAGE, /hand it to your fingers/);
  assert.match(PAGE, /I expect what you notice/);
  assert.match(PAGE, /no one has turned a printed pair yet/);
  assert.match(README, /seen more than felt/);
});

test('the Earth sentence and the backlash figures say what was found', () => {
  assert.doesNotMatch(README, /shows why the Earth's orbit passed for a circle/);
  assert.match(README, /unequal seasons/);
  // backlash: 360 positions found 1.38 deg, 3600 found 1.43 (kepler.test.mjs recomputes both)
  assert.match(README, /1\.43° for Mercury/);
  assert.doesNotMatch(README, /reaches at most 1\.38°/);
  assert.match(readme, /^## Revision note/m);
});

test('the balance figures the README quotes are the ones in budget.js', () => {
  const all = Object.values(BUDGET);
  const least = Math.min(...all.map((b) => b.s - (K.FIXED.steady + 0)));
  const def = BUDGET['mercury|70|0.5'];
  assert.match(README, new RegExp(`counterweight ${def.h.toFixed(1)} mm tall`));
  const pl = Math.max(...Object.entries(BUDGET).filter(([k]) => k.startsWith('pluto')).map(([, b]) => b.h));
  assert.match(README, new RegExp(`up to ${pl.toFixed(1)} mm for Pluto`));
  assert.ok(least > 0);
});
