/*
 * progress.js: what Dividers remembers between visits, read back defensively.
 *
 * Progress lives in localStorage, which anything on the same origin can write,
 * so nothing stored is trusted. `clean` keeps only well-formed entries: a best
 * score must be a whole number of moves (at least 1) for a real level index,
 * the sound setting must be a boolean, the current level a real level index.
 * Everything else falls back to the defaults.
 *
 * Loads as a classic browser script (window.DividersProgress) and under Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.DividersProgress = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_MOVES = 100000;

  function defaults() {
    return { best: {}, sound: true, level: 0 };
  }

  // `raw` is the stored string (or an already parsed value); `levelCount` is how
  // many levels the game has. Returns a fresh { best, sound, level }.
  function clean(raw, levelCount) {
    const out = defaults();
    let p = raw;
    if (typeof raw === 'string') {
      try {
        p = JSON.parse(raw);
      } catch (e) {
        return out;
      }
    }
    if (!p || typeof p !== 'object') return out;
    if (p.best && typeof p.best === 'object') {
      for (const k of Object.keys(p.best)) {
        const i = Number(k);
        const v = p.best[k];
        if (!Number.isInteger(i) || String(i) !== k || i < 0 || i >= levelCount) continue;
        if (!Number.isInteger(v) || v < 1 || v > MAX_MOVES) continue;
        out.best[i] = v;
      }
    }
    if (typeof p.sound === 'boolean') out.sound = p.sound;
    if (Number.isInteger(p.level) && p.level >= 0 && p.level < levelCount) out.level = p.level;
    return out;
  }

  return { clean, defaults };
});
