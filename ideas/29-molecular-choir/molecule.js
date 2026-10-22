(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MolecularChoir = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const U = 1.66053906892e-27; // kg per unified atomic mass unit; CODATA 2022
  const C = 299792458; // m/s, defined exactly
  const AUDIO_DIVISOR = 2 ** 37;
  function positive(value, name) {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError(name + ' must be finite and positive');
    return value;
  }
  function mode(massA, massB, stiffness) {
    positive(massA, 'mass A'); positive(massB, 'mass B'); positive(stiffness, 'stiffness');
    const reducedU = massA * massB / (massA + massB);
    const reducedKg = reducedU * U;
    const omega = Math.sqrt(stiffness / reducedKg);
    const hz = omega / (2 * Math.PI);
    if (!Number.isFinite(hz) || hz <= 0) throw new RangeError('parameters exceed numeric range');
    return { massA, massB, stiffness, reducedU, reducedKg, omega, hz,
      thz: hz / 1e12, wavenumber: hz / (C * 100), audible: hz / AUDIO_DIVISOR };
  }
  function displacement(massA, massB, phase, amplitude = 1) {
    positive(massA, 'mass A'); positive(massB, 'mass B');
    if (!Number.isFinite(phase) || !Number.isFinite(amplitude)) throw new RangeError('phase and amplitude must be finite');
    const relative = Math.sin(phase) * amplitude;
    return { a: -massB / (massA + massB) * relative, b: massA / (massA + massB) * relative };
  }
  return { U, C, AUDIO_DIVISOR, mode, displacement };
});
