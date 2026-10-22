/* Unconformity — core utilities: seeded PRNG, integer hashing, value noise, colour helpers.
   Nothing in the artwork may use Math.random; every random choice flows from makeRng(seed). */
(function (G) {
  'use strict';
  const UNC = (G.UNC = G.UNC || {});

  // cyrb128: string -> four 32-bit seeds
  function cyrb128(str) {
    let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
    for (let i = 0; i < str.length; i++) {
      const k = str.charCodeAt(i);
      h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
      h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
      h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
      h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
    }
    h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
    h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
    h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
    h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
    return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
  }

  // sfc32: small fast counter PRNG, period ~2^128
  function sfc32(a, b, c, d) {
    return function () {
      a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
      let t = (a + b) | 0;
      a = b ^ (b >>> 9);
      b = (c + (c << 3)) | 0;
      c = (c << 21) | (c >>> 11);
      d = (d + 1) | 0;
      t = (t + d) | 0;
      c = (c + t) | 0;
      return (t >>> 0) / 4294967296;
    };
  }

  function makeRng(seedStr) {
    const s = cyrb128(String(seedStr));
    const f = sfc32(s[0], s[1], s[2], s[3]);
    for (let i = 0; i < 20; i++) f();
    const r = {
      next: f,
      range: (lo, hi) => lo + (hi - lo) * f(),
      int: (lo, hi) => lo + Math.floor((hi - lo + 1) * f()),
      pick: (arr) => arr[Math.floor(f() * arr.length)],
      chance: (p) => f() < p,
      sign: () => (f() < 0.5 ? -1 : 1),
      // items: [[value, weight], ...]
      weighted: (items) => {
        let tot = 0;
        for (const it of items) tot += it[1];
        let x = f() * tot;
        for (const it of items) {
          x -= it[1];
          if (x < 0) return it[0];
        }
        return items[items.length - 1][0];
      },
      // roughly normal, clipped to +-2.5 sigma
      gauss: (mu, sigma) => {
        let s = 0;
        for (let i = 0; i < 4; i++) s += f();
        let z = (s - 2) * 1.7320508;
        if (z > 2.5) z = 2.5;
        if (z < -2.5) z = -2.5;
        return mu + sigma * z;
      },
      int32: () => (f() * 4294967296) | 0,
    };
    return r;
  }

  // ---- integer hashes -> [0,1) ----
  function hash1(i, s) {
    let h = (Math.imul(i | 0, 0x9e3779b1) + Math.imul(s | 0, 0x85ebca77)) | 0;
    h ^= h >>> 16;
    h = Math.imul(h, 0x7feb352d);
    h ^= h >>> 15;
    h = Math.imul(h, 0x846ca68b);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function hash2(i, j, s) {
    let h = (Math.imul(i | 0, 0x9e3779b1) + Math.imul(j | 0, 0x7feb352d) + Math.imul(s | 0, 0x85ebca77)) | 0;
    h ^= h >>> 16;
    h = Math.imul(h, 0x21f0aaad);
    h ^= h >>> 15;
    h = Math.imul(h, 0x735a2d97);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }

  // 1-D value noise in [-1, 1]
  function vnoise1(x, s) {
    const fi = Math.floor(x);
    const f = x - fi;
    const u = f * f * (3 - 2 * f);
    const a = hash1(fi, s);
    const b = hash1(fi + 1, s);
    return (a + (b - a) * u) * 2 - 1;
  }
  // 3-octave fbm, roughly [-1, 1]
  function fbm1(x, s) {
    return 0.6 * vnoise1(x, s) + 0.28 * vnoise1(x * 2.13 + 17.1, s + 101) + 0.12 * vnoise1(x * 4.37 + 3.7, s + 202);
  }
  // 2-D value noise in [0, 1]
  function vnoise2(x, y, s) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s);
    const c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
    const ab = a + (b - a) * ux, cd = c + (d - c) * ux;
    return ab + (cd - ab) * uy;
  }

  // ---- colour ----
  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (mx + mn) / 2;
    if (mx !== mn) {
      const d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return [h, s, l];
  }
  function hslToRgb(h, s, l) {
    h = ((h % 1) + 1) % 1;
    s = Math.max(0, Math.min(1, s));
    l = Math.max(0, Math.min(1, l));
    if (s === 0) return [l * 255, l * 255, l * 255];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const f = (t) => {
      t = ((t % 1) + 1) % 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
  }
  // shift a hex/rgb colour in HSL space
  function shade(rgb, dh, ds, dl) {
    const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
    return hslToRgb(h + dh, s * (1 + ds), l + dl);
  }
  function mixRgb(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }

  function toRoman(n) {
    const map = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
    let out = '';
    for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
    return out;
  }

  // Plate geometry, in plate units (plate is 1 wide, 1.25 tall). The section's own world
  // coordinates: x in [0,1] across the inner frame, z (elevation) from zTop downward.
  const GEOM = { pw: 1, ph: 1.25, ml: 0.06, mr: 0.06, mt: 0.06, mb: 0.11, zTop: 0.235 };
  GEOM.iw = GEOM.pw - GEOM.ml - GEOM.mr;
  GEOM.ih = GEOM.ph - GEOM.mt - GEOM.mb;
  GEOM.zBot = GEOM.zTop - GEOM.ih / GEOM.iw;

  Object.assign(UNC, { GEOM, cyrb128, makeRng, hash1, hash2, vnoise1, fbm1, vnoise2, hexToRgb, rgbToHsl, hslToRgb, shade, mixRgb, toRoman });
})(typeof window !== 'undefined' ? window : globalThis);
