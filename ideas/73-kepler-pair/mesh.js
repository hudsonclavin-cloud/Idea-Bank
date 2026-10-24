/* Solid-building kit for The Kepler Pair: triangulation, polygon offsetting, layered extrusion
   into one closed mesh, and a binary STL writer. Pure: no DOM, no clock, no randomness, and only
   + - * / and sqrt, so its output is the same to the bit in every JavaScript engine. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KPMesh = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // sqrt(x*x + y*y) is correctly rounded in every JavaScript engine; Math.hypot is not, and the
  // committed STLs must come out byte-identical wherever this runs.
  const hyp = (x, y) => Math.sqrt(x * x + y * y);

  /* ------------------------------------------------------------ triangulation */
  // Ear clipping, after joining each hole to the outline by a bridge to a vertex it can see
  // (D. Eberly, "Triangulation by Ear Clipping", Geometric Tools, 2002). data is [x0, y0, x1, ...];
  // holeIndices the vertex index where each hole starts. Returns vertex indices, three per triangle,
  // anticlockwise. Throws if it cannot finish (the tests would then fail, not the print).
  function triangulate(data, holeIndices) {
    const X = (i) => data[2 * i];
    const Y = (i) => data[2 * i + 1];
    const n = data.length / 2;
    const starts = [0].concat(holeIndices || []);
    const loops = starts.map((s, k) => {
      const e = k + 1 < starts.length ? starts[k + 1] : n;
      const L = [];
      for (let i = s; i < e; i++) L.push(i);
      let a = 0;
      for (let i = 0; i < L.length; i++) {
        const p = L[i];
        const q = L[(i + 1) % L.length];
        a += X(p) * Y(q) - X(q) * Y(p);
      }
      // the outline anticlockwise, holes clockwise
      if ((k === 0) !== a > 0) L.reverse();
      return L;
    });
    const cross = (a, b, c) => (X(b) - X(a)) * (Y(c) - Y(b)) - (Y(b) - Y(a)) * (X(c) - X(b));
    const same = (a, b) => X(a) === X(b) && Y(a) === Y(b);
    let poly = loops[0];
    const holes = loops.slice(1).map((L) => {
      let m = 0;
      for (let i = 1; i < L.length; i++) if (X(L[i]) > X(L[m]) || (X(L[i]) === X(L[m]) && Y(L[i]) > Y(L[m]))) m = i;
      return { L, m };
    });
    holes.sort((a, b) => X(b.L[b.m]) - X(a.L[a.m]));
    for (const { L, m } of holes) {
      const M = L[m];
      const mx = X(M);
      const my = Y(M);
      // the nearest edge crossed by the ray from M towards +x
      let best = Infinity;
      let edge = -1;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        if ((Y(a) <= my && Y(b) > my) || (Y(b) <= my && Y(a) > my)) {
          const x = X(a) + ((my - Y(a)) * (X(b) - X(a))) / (Y(b) - Y(a));
          if (x >= mx && x < best) {
            best = x;
            edge = i;
          }
        }
      }
      if (edge < 0) throw new Error('triangulate: a hole is outside the outline');
      const a = poly[edge];
      const b = poly[(edge + 1) % poly.length];
      let P = X(a) > X(b) ? a : b;
      // any vertex inside the triangle M, I, P may hide P: take the one nearest the ray's direction
      const ix = best;
      const inTri = (r) => {
        const d1 = (ix - mx) * (Y(r) - my) - 0 * (X(r) - mx);
        const d2 = (X(P) - ix) * (Y(r) - my) - (Y(P) - my) * (X(r) - ix);
        const d3 = (mx - X(P)) * (Y(r) - Y(P)) - (my - Y(P)) * (X(r) - X(P));
        const neg = d1 < 0 || d2 < 0 || d3 < 0;
        const pos = d1 > 0 || d2 > 0 || d3 > 0;
        return !(neg && pos);
      };
      let bestT = Infinity;
      let bestD = Infinity;
      const P0 = P;
      for (const r of poly) {
        if (r === P0 || same(r, P0) || X(r) <= mx) continue;
        if (!inTri(r)) continue;
        const t = Math.abs(Y(r) - my) / (X(r) - mx);
        const dd = (X(r) - mx) * (X(r) - mx) + (Y(r) - my) * (Y(r) - my);
        if (t < bestT || (t === bestT && dd < bestD)) {
          bestT = t;
          bestD = dd;
          P = r;
        }
      }
      // splice at the occurrence of P whose corner opens towards M
      let j = -1;
      for (let k = 0; k < poly.length; k++) {
        if (poly[k] !== P) continue;
        const u = poly[(k - 1 + poly.length) % poly.length];
        const w = poly[(k + 1) % poly.length];
        const convex = cross(u, P, w) > 0;
        const left1 = cross(u, P, M) > 0;
        const left2 = cross(P, w, M) > 0;
        if (convex ? left1 && left2 : left1 || left2) {
          j = k;
          break;
        }
      }
      if (j < 0) j = poly.indexOf(P);
      const ring = L.slice(m).concat(L.slice(0, m));
      poly = poly.slice(0, j + 1).concat(ring, [M, P], poly.slice(j + 1));
    }
    // ear clipping on the joined polygon
    const N = poly.length;
    const prev = new Int32Array(N);
    const next = new Int32Array(N);
    for (let i = 0; i < N; i++) {
      prev[i] = (i - 1 + N) % N;
      next[i] = (i + 1) % N;
    }
    const out = [];
    let left = N;
    let i = 0;
    let stall = 0;
    const isEar = (k) => {
      const a = poly[prev[k]];
      const b = poly[k];
      const c = poly[next[k]];
      if (cross(a, b, c) <= 0) return false;
      for (let q = next[next[k]]; q !== prev[k]; q = next[q]) {
        const r = poly[q];
        if (same(r, a) || same(r, b) || same(r, c)) continue;
        if (cross(a, b, r) >= 0 && cross(b, c, r) >= 0 && cross(c, a, r) >= 0) return false;
      }
      return true;
    };
    while (left > 3) {
      if (isEar(i)) {
        out.push(poly[prev[i]], poly[i], poly[next[i]]);
        next[prev[i]] = next[i];
        prev[next[i]] = prev[i];
        left--;
        i = prev[i];
        stall = 0;
      } else {
        i = next[i];
        if (++stall > left) throw new Error('triangulate: no ear found');
      }
    }
    if (cross(poly[prev[i]], poly[i], poly[next[i]]) > 0) out.push(poly[prev[i]], poly[i], poly[next[i]]);
    else throw new Error('triangulate: last triangle is degenerate');
    return out;
  }

  /* --------------------------------------------------------------- polygons */
  function loopArea(L) {
    let s = 0;
    for (let i = 0, n = L.length; i < n; i++) {
      const a = L[i];
      const b = L[(i + 1) % n];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return s / 2;
  }
  function orient(L, ccw) {
    return loopArea(L) > 0 === ccw ? L.slice() : L.slice().reverse();
  }
  // Move every edge of a region-oriented loop (outer CCW, holes CW: material on the left)
  // by d towards the material (d > 0 shrinks the region). Mitred corners, mitre capped at 3d.
  function offsetLoop(L, d) {
    const n = L.length;
    const out = [];
    for (let i = 0; i < n; i++) {
      const p = L[(i - 1 + n) % n];
      const q = L[i];
      const r = L[(i + 1) % n];
      let ax = q[0] - p[0];
      let ay = q[1] - p[1];
      let al = hyp(ax, ay);
      let bx = r[0] - q[0];
      let by = r[1] - q[1];
      let bl = hyp(bx, by);
      ax /= al;
      ay /= al;
      bx /= bl;
      by /= bl;
      const n1x = -ay;
      const n1y = ax;
      const n2x = -by;
      const n2y = bx;
      let mx = n1x + n2x;
      let my = n1y + n2y;
      const ml = hyp(mx, my);
      if (ml < 1e-9) {
        mx = n1x;
        my = n1y;
      } else {
        mx /= ml;
        my /= ml;
      }
      const cosh = mx * n1x + my * n1y;
      const k = Math.min(3, 1 / Math.max(cosh, 1e-9));
      out.push([q[0] + d * k * mx, q[1] + d * k * my]);
    }
    return out;
  }
  function segmentsCross(a, b, c, d) {
    const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    const d1 = o(a, b, c);
    const d2 = o(a, b, d);
    const d3 = o(c, d, a);
    const d4 = o(c, d, b);
    return d1 * d2 < 0 && d3 * d4 < 0;
  }
  // True if no two non-adjacent edges of the loops cross (loops may be several).
  function loopsSimple(loops) {
    const E = [];
    loops.forEach((L, li) => {
      for (let i = 0; i < L.length; i++) E.push([L[i], L[(i + 1) % L.length], li, i, L.length]);
    });
    // grid buckets to keep this fast
    let minx = Infinity;
    let miny = Infinity;
    let maxx = -Infinity;
    let maxy = -Infinity;
    for (const e of E)
      for (const p of [e[0], e[1]]) {
        minx = Math.min(minx, p[0]);
        miny = Math.min(miny, p[1]);
        maxx = Math.max(maxx, p[0]);
        maxy = Math.max(maxy, p[1]);
      }
    const cell = Math.max((maxx - minx) / 64, (maxy - miny) / 64, 1e-6);
    const grid = new Map();
    E.forEach((e, k) => {
      const x0 = Math.floor((Math.min(e[0][0], e[1][0]) - minx) / cell);
      const x1 = Math.floor((Math.max(e[0][0], e[1][0]) - minx) / cell);
      const y0 = Math.floor((Math.min(e[0][1], e[1][1]) - miny) / cell);
      const y1 = Math.floor((Math.max(e[0][1], e[1][1]) - miny) / cell);
      for (let x = x0; x <= x1; x++)
        for (let y = y0; y <= y1; y++) {
          const key = x * 100003 + y;
          if (!grid.has(key)) grid.set(key, []);
          grid.get(key).push(k);
        }
    });
    for (const list of grid.values())
      for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++) {
          const e = E[list[i]];
          const f = E[list[j]];
          if (e[2] === f[2]) {
            const n = e[4];
            const dd = Math.abs(e[3] - f[3]);
            if (dd <= 1 || dd === n - 1) continue;
          }
          if (segmentsCross(e[0], e[1], f[0], f[1])) return false;
        }
    return true;
  }

  /* ------------------------------------------------------------ mesh builder */
  function MeshBuilder() {
    this.V = [];
    this.F = [];
    this.caps = [];
    this.map = new Map();
  }
  // Vertices are kept at float32 precision, the precision of the STL, so that what the tests check
  // is exactly what is written.
  MeshBuilder.prototype.v = function (x, y, z) {
    x = Math.fround(x);
    y = Math.fround(y);
    z = Math.fround(z);
    const key = x + ',' + y + ',' + z;
    let i = this.map.get(key);
    if (i === undefined) {
      i = this.V.length;
      this.V.push([x, y, z]);
      this.map.set(key, i);
    }
    return i;
  };
  // Horizontal face at height z from region-oriented loops (first = outer, rest = holes).
  MeshBuilder.prototype.cap = function (loops, z, up) {
    const data = [];
    const holes = [];
    const idx = [];
    loops.forEach((L, k) => {
      if (k) holes.push(data.length / 2);
      for (const p of L) {
        // triangulate the float32 coordinates the STL will hold: last-bit differences between
        // JavaScript engines' sin and cos then cannot change which triangles are chosen
        data.push(Math.fround(p[0]), Math.fround(p[1]));
        idx.push(this.v(p[0], p[1], z));
      }
    });
    const t = triangulate(data, holes);
    const rec = { loops, z, up, triangles: t.length / 3, triArea: 0 };
    this.caps.push(rec);
    for (let k = 0; k < t.length; k += 3) {
      const a = t[k];
      const b = t[k + 1];
      const c = t[k + 2];
      const ar = (data[2 * b] - data[2 * a]) * (data[2 * c + 1] - data[2 * a + 1]) - (data[2 * c] - data[2 * a]) * (data[2 * b + 1] - data[2 * a + 1]);
      rec.triArea += Math.abs(ar) / 2;
      if (ar > 0 === up) this.F.push([idx[a], idx[b], idx[c]]);
      else this.F.push([idx[a], idx[c], idx[b]]);
    }
  };
  // Side band joining loop Lb at zb to loop Lt at zt (same vertex count, region-oriented).
  MeshBuilder.prototype.wall = function (Lb, zb, Lt, zt) {
    const n = Lb.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const b0 = this.v(Lb[i][0], Lb[i][1], zb);
      const b1 = this.v(Lb[j][0], Lb[j][1], zb);
      const t0 = this.v(Lt[i][0], Lt[i][1], zt);
      const t1 = this.v(Lt[j][0], Lt[j][1], zt);
      this.F.push([b0, b1, t1], [b0, t1, t0]);
    }
  };
  MeshBuilder.prototype.append = function (other, dx, dy) {
    for (const f of other.F) this.F.push(f.map((i) => this.v(other.V[i][0] + dx, other.V[i][1] + dy, other.V[i][2])));
  };
  MeshBuilder.prototype.bounds = function () {
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (const p of this.V)
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], p[k]);
        hi[k] = Math.max(hi[k], p[k]);
      }
    return { lo, hi };
  };

  // Every edge used by exactly two faces, once in each direction: a closed, consistently wound surface.
  function edgeCheck(mesh) {
    const count = new Map();
    for (const f of mesh.F) {
      for (let k = 0; k < 3; k++) {
        const a = f[k];
        const b = f[(k + 1) % 3];
        const key = a + ',' + b;
        count.set(key, (count.get(key) || 0) + 1);
      }
    }
    let bad = 0;
    for (const [key, c] of count) {
      const [a, b] = key.split(',');
      if (c !== 1 || count.get(b + ',' + a) !== 1) bad++;
    }
    let degenerate = 0;
    for (const f of mesh.F) if (f[0] === f[1] || f[1] === f[2] || f[0] === f[2]) degenerate++;
    return { edges: count.size / 2, bad, degenerate, faces: mesh.F.length, vertices: mesh.V.length };
  }
  function volume(mesh) {
    let v = 0;
    for (const f of mesh.F) {
      const a = mesh.V[f[0]];
      const b = mesh.V[f[1]];
      const c = mesh.V[f[2]];
      v += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
    }
    return v / 6;
  }

  // Binary STL, little-endian, float32. Deterministic for a given mesh.
  function stl(mesh, name) {
    const n = mesh.F.length;
    const buf = new ArrayBuffer(84 + 50 * n);
    const dv = new DataView(buf);
    const head = ('binary STL ' + (name || '')).slice(0, 80);
    for (let i = 0; i < head.length; i++) dv.setUint8(i, head.charCodeAt(i) & 0x7f);
    dv.setUint32(80, n, true);
    let o = 84;
    for (const f of mesh.F) {
      const a = mesh.V[f[0]];
      const b = mesh.V[f[1]];
      const c = mesh.V[f[2]];
      const ux = b[0] - a[0];
      const uy = b[1] - a[1];
      const uz = b[2] - a[2];
      const vx = c[0] - a[0];
      const vy = c[1] - a[1];
      const vz = c[2] - a[2];
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1; // sqrt is correctly rounded everywhere; hypot is not
      nx /= nl;
      ny /= nl;
      nz /= nl;
      dv.setFloat32(o, nx, true);
      dv.setFloat32(o + 4, ny, true);
      dv.setFloat32(o + 8, nz, true);
      o += 12;
      for (const p of [a, b, c]) {
        dv.setFloat32(o, p[0], true);
        dv.setFloat32(o + 4, p[1], true);
        dv.setFloat32(o + 8, p[2], true);
        o += 12;
      }
      dv.setUint16(o, 0, true);
      o += 2;
    }
    return new Uint8Array(buf);
  }

  return { triangulate, loopArea, orient, offsetLoop, loopsSimple, segmentsCross, MeshBuilder, edgeCheck, volume, stl };
});
