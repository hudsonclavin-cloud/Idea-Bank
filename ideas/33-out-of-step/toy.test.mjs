// Tests the toy on the page by running the page's own code, not a re-implementation.
//
// The physics lives in <script id="toy-model"> in index.html; the test extracts that block
// and runs it in Node. The status line is produced by the page's UI script, which the test
// runs against a stub DOM. Both are checked against the sway growth measured from the
// simulation itself, with the ambient drive, noise and amplitude cap switched off.
//
// The first version of the toy got this wrong: with the "in step" switch on, its walkers'
// balance pulses all arrive at exactly twice the deck frequency and pump it parametrically,
// so onset fell from 165 to about 127 walkers while the label still said "sway decays".
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8');
const modelSrc = (html.match(/<script id="toy-model">([\s\S]*?)<\/script>/) || [])[1];
const uiSrc = (html.match(/<script>([\s\S]*?)<\/script>/) || [])[1];
assert.ok(modelSrc, 'index.html has no <script id="toy-model"> block');
assert.ok(uiSrc, 'index.html has no UI <script> block');
const makeToy = new Function(`${modelSrc}\nreturn makeOutOfStepToy;`)();

// Growth rate (1/s) of the sway envelope, fitted to log amplitude after a 30 s settle.
function measuredRate(N, inStep) {
  const toy = makeToy({ linear: true });
  toy.setN(N); toy.setInStep(inStep); toy.reset(1e-6);
  const amp = () => { const s = toy.state(); return Math.hypot(s.x, s.v / toy.W0); };
  for (let k = 0; k < 120 * 30; k++) toy.step();
  let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
  for (let k = 0; k < 120 * 90; k++) {
    toy.step();
    if (k % 60 === 0) { const t = toy.state().t, y = Math.log(amp()); sx += t; sy += y; sxx += t * t; sxy += t * y; n++; }
  }
  return (n * sxy - sx * sy) / (n * sxx - sx * sx);
}

// Run the page's UI script against a stub DOM and return a function that sets the
// controls the way a reader would and reads back the status line.
function pageLabels() {
  const els = {};
  const el = (id) => (els[id] ||= {
    id, textContent: '', innerHTML: '', value: '60', checked: false, clientWidth: 0, clientHeight: 0,
    handlers: {}, addEventListener(type, fn) { this.handlers[type] = fn; },
    setAttribute() {}, getAttribute() { return null; }, getContext() { return {}; },
  });
  const sandbox = {
    document: { getElementById: el, documentElement: el('html') },
    window: { matchMedia: () => ({ matches: false }), addEventListener() {}, devicePixelRatio: 1 },
    localStorage: { getItem: () => null, setItem() {} },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    requestAnimationFrame() {},
    Math, Float64Array,
  };
  vm.createContext(sandbox);
  vm.runInContext(modelSrc, sandbox);
  vm.runInContext(uiSrc, sandbox);
  return (N, inStep) => {
    el('n').value = String(N); el('n').handlers.input();
    el('sync').checked = inStep; el('sync').handlers.change();
    return el('labC').innerHTML.replace(/<[^>]+>/g, '');
  };
}

test('with random phases, onset is at 165 walkers in the model and in the simulation', () => {
  const toy = makeToy();
  assert.equal(toy.onsetWalkers(false), 165);
  assert.ok(measuredRate(158, false) < 0, '158 random walkers: sway should die away');
  assert.ok(measuredRate(172, false) > 0, '172 random walkers: sway should grow');
});

test('walkers in step lower onset to about 127 by parametric pumping, and the model says so', () => {
  const toy = makeToy();
  assert.equal(toy.onsetWalkers(true), 127);
  assert.ok(measuredRate(122, true) < 0, '122 walkers in step: sway should die away');
  assert.ok(measuredRate(132, true) > 0, '132 walkers in step: sway should grow');
  // The first-order averaging formula matches the simulated rate, not just its sign.
  for (const N of [140, 160]) {
    const m = measuredRate(N, true), r = toy.growthRate(N, true);
    assert.ok(Math.abs(m - r) < 0.002, `N=${N} in step: measured ${m.toFixed(4)}/s vs model ${r.toFixed(4)}/s`);
  }
});

test("the page's status line agrees with the simulated sway in both modes", () => {
  const read = pageLabels();
  const toy = makeToy();
  const Ns = [1, 40, 90, 115, 122, 132, 140, 150, 160, 172, 200, 250, 300];
  for (const inStep of [false, true]) {
    for (const N of Ns) {
      if (Math.abs(N - toy.onsetN(inStep)) < 3) continue; // too close to call from a finite run
      const rate = measuredRate(N, inStep);
      const text = read(N, inStep);
      const says = /sway grows/.test(text) ? 'grows' : /dies away/.test(text) ? 'decays' : 'other';
      assert.equal(says, rate > 0 ? 'grows' : 'decays',
        `N=${N} ${inStep ? 'in step' : 'random'}: simulated rate ${rate.toFixed(4)}/s but the page says "${text}"`);
      assert.match(text, new RegExp(`onset at ${toy.onsetWalkers(inStep)} walkers`), `N=${N}: wrong onset in "${text}"`);
    }
  }
});

test('the 140-walker case from the review: in step grows, out of step dies away, and the page says so', () => {
  const read = pageLabels();
  assert.ok(measuredRate(140, true) > 0.01);
  assert.ok(measuredRate(140, false) < -0.01);
  assert.match(read(140, true), /sway grows/);
  assert.match(read(140, false), /sway dies away/);
});

test('the deck is driven by the balance row only, never by the step-rhythm row', () => {
  // The caption says the step-rhythm row is not applied; check the code agrees.
  const stepBody = modelSrc.slice(modelSrc.indexOf('function step()'), modelSrc.indexOf('return { fa: fa'));
  const accLine = stepBody.split('\n').find((l) => /var acc =/.test(l));
  assert.ok(accLine && /fb \+/.test(accLine) && !/\bfa\b/.test(accLine), `deck equation: ${accLine}`);
});

test('the numbers in the caption and README match the model', () => {
  const toy = makeToy();
  const r = toy.onsetWalkers(false), s = toy.onsetWalkers(true);
  assert.ok(html.includes(`moves onset from ${r} to ${s} walkers`), 'toy caption should state both onsets');
  const readme = fs.readFileSync(path.join(HERE, 'README.md'), 'utf8');
  assert.ok(readme.includes(`from ${r} to ${s} walkers`), 'README should state both onsets');
});
