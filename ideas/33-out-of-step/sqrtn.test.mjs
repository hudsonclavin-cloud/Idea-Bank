// The toy on the page rests on two arithmetic claims. This test checks them with the
// same formulas the page uses, independently of the browser.
//
//  (1) N sinusoids at ~1 Hz with independent random phases sum to an amplitude that
//      grows like sqrt(N), not N.
//  (2) N corrections of the form K * v(t) * (1 + 0.6 sin(2π f_i t + φ_i)) sum to a
//      component in phase with v(t) that grows like N on average, regardless of the phases φ_i.
//
// Claim (2) is about the average only. It does not mean the switch leaves the bridge alone:
// with the walkers in step the pulses all arrive at twice the deck frequency and pump it
// parametrically, which this fixed-phase check cannot see (an independent review caught
// that). toy.test.mjs runs the page's own simulation and checks onset in both modes.
import test from 'node:test';
import assert from 'node:assert/strict';

function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function walkers(N, rnd) {
  const freq = [], phase = [];
  for (let i = 0; i < N; i++) { freq.push(1.0 + 0.12 * (rnd() - 0.5)); phase.push(rnd() * Math.PI * 2); }
  return { freq, phase };
}
function rms(samples) { return Math.sqrt(samples.reduce((a, b) => a + b * b, 0) / samples.length); }
// Same convention as the page: "in step" means the same phase and the same frequency.
const ph = (w, i, t, inStep) => (inStep ? 2 * Math.PI * 1.0 * t : 2 * Math.PI * w.freq[i] * t + w.phase[i]);

// RMS over a long window of the summed step-rhythm forces.
function stepRms(N, inStep, seed) {
  const w = walkers(N, lcg(seed));
  const out = [];
  for (let k = 0; k < 24000; k++) {
    const t = k / 120;
    let s = 0;
    for (let i = 0; i < N; i++) s += Math.sin(ph(w, i, t, inStep));
    out.push(s);
  }
  return rms(out);
}

// Least-squares coefficient of the summed balance corrections against v(t), for a
// 0.5 Hz deck velocity v(t) = cos(π t).
function balanceGain(N, inStep, seed) {
  const w = walkers(N, lcg(seed));
  const K = 1;
  let num = 0, den = 0;
  for (let k = 0; k < 24000; k++) {
    const t = k / 120;
    const v = Math.cos(Math.PI * t);
    let s = 0;
    for (let i = 0; i < N; i++) s += K * v * (1 + 0.6 * Math.sin(ph(w, i, t, inStep)));
    num += s * v; den += v * v;
  }
  return num / den; // in units of K
}

test('random-phase step forces add like sqrt(N)', () => {
  const one = stepRms(1, false, 7);
  const trials = [11, 23, 57, 91].map((seed) => stepRms(200, false, seed) / one);
  const ratio = trials.reduce((a, b) => a + b, 0) / trials.length;
  // sqrt(200) = 14.1; allow the statistical spread of a finite ensemble.
  assert.ok(ratio > 9 && ratio < 20, `expected ~14.1, got ${ratio.toFixed(2)}`);
  assert.ok(ratio < 200 / 4, 'random phases must not add like N');
});

test('in-step step forces add like N', () => {
  const one = stepRms(1, true, 7);
  const ratio = stepRms(200, true, 11) / one;
  assert.ok(Math.abs(ratio - 200) < 0.5, `expected 200, got ${ratio.toFixed(2)}`);
});

test('balance corrections add like N on average whether or not walkers are in step', () => {
  for (const inStep of [false, true]) {
    for (const N of [1, 60, 165, 300]) {
      const g = balanceGain(N, inStep, 5);
      assert.ok(Math.abs(g - N) < 0.15 * N + 0.5, `N=${N} inStep=${inStep}: gain ${g.toFixed(2)} should be ~N`);
    }
  }
});

test('with random phases, the toy threshold is where N*K equals the bridge damping', () => {
  const F0 = 0.5, W0 = 2 * Math.PI * F0, M = 1, ZETA = 0.05, NCRIT = 165;
  const CB = 2 * ZETA * W0 * M;
  const K = CB / NCRIT;
  assert.ok(CB - 164 * K > 0, '164 walkers: net damping still positive');
  assert.ok(CB - 166 * K < 0, '166 walkers: net damping negative');
});
