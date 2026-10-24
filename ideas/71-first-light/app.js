/* First Light, Last Light: the page. Everything it says comes from firstlight.js. */
(function () {
  'use strict';
  const F = window.FirstLight;
  const $ = (id) => document.getElementById(id);
  const RAD = Math.PI / 180;
  const reduced = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const PRESETS = [
    ['45° N, 0° (an example)', 45, 0], ['London', 51.5, -0.13], ['Edinburgh', 55.95, -3.19], ['New York', 40.71, -74.01],
    ['Mexico City', 19.43, -99.13], ['Quito', -0.18, -78.47], ['São Paulo', -23.55, -46.63], ['Cape Town', -33.92, 18.42],
    ['Nairobi', -1.29, 36.82], ['Cairo', 30.04, 31.24], ['Mumbai', 19.08, 72.88], ['Singapore', 1.35, 103.82],
    ['Tokyo', 35.68, 139.69], ['Sydney', -33.87, 151.21], ['Auckland', -36.85, 174.76], ['Ushuaia', -54.8, -68.3],
  ];

  const today = new Date();
  const state = {
    input: Object.assign({}, F.DEFAULTS),
    year: Math.min(2100, Math.max(2000, today.getFullYear())),
    n: 1,
    design: null, map: null, track: null, keyRows: null, mesh: null, meshFor: '', coupon: null,
    yaw: -0.65, pitch: 0.95,
    playing: false, timer: 0, raf: 0,
  };
  const dayOfYear = (y, m, d) => { let n = d; for (let i = 1; i < m; i++) n += F.daysInMonth(y, i); return n; };
  state.n = dayOfYear(state.year, today.getMonth() + 1, Math.min(today.getDate(), F.daysInMonth(state.year, today.getMonth() + 1)));

  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
  const fmt = (x, k) => (Math.round(x * 10 ** k) / 10 ** k).toFixed(k);
  const dateText = (t) => `${t.day} ${MONTH_NAMES[t.month - 1]}`;
  const shortDate = (t) => F.fmtDate(t);

  /* ---------------------------------------------------------------- inputs */

  function fillSelects() {
    const p = $('preset');
    PRESETS.forEach(([name], i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = name; p.appendChild(o); });
    const custom = document.createElement('option'); custom.value = 'custom'; custom.textContent = 'Your own coordinates'; p.appendChild(custom);
    const m = $('yourMonth');
    const none = document.createElement('option'); none.value = ''; none.textContent = 'none'; m.appendChild(none);
    MONTH_NAMES.forEach((name, i) => { const o = document.createElement('option'); o.value = String(i + 1); o.textContent = name; m.appendChild(o); });
    fillDays();
  }
  function fillDays() {
    const m = +$('yourMonth').value, sel = $('yourDate'), keep = +sel.value || 1;
    sel.innerHTML = '';
    const n = m ? F.daysInMonth(2028, m) : 31;
    for (let d = 1; d <= n; d++) { const o = document.createElement('option'); o.value = String(d); o.textContent = String(d); sel.appendChild(o); }
    sel.value = String(Math.min(keep, n));
    sel.disabled = !m;
  }
  const clampField = (id) => {
    const el = $(id), [lo, hi] = F.LIMITS[id];
    let v = parseFloat(el.value);
    if (!Number.isFinite(v)) v = F.DEFAULTS[id];
    const c = Math.min(hi, Math.max(lo, v));
    return { v: c, clamped: c !== v };
  };
  function readInputs() {
    const out = {}, notes = [];
    for (const id of ['lat', 'lon', 'horizonE', 'horizonW', 'size', 'slit']) {
      const r = clampField(id);
      out[id] = r.v;
      if (r.clamped) notes.push(`${$(id).previousElementSibling ? $(id).previousElementSibling.textContent.split(' ')[0] : id} is kept within ${F.LIMITS[id][0]} to ${F.LIMITS[id][1]}`);
    }
    const m = +$('yourMonth').value, d = +$('yourDate').value;
    out.day = m ? `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : '';
    return { input: out, notes };
  }

  let rebuildTimer = 0;
  function scheduleRebuild() { clearTimeout(rebuildTimer); rebuildTimer = setTimeout(rebuild, 120); }
  function rebuild() {
    const { input, notes } = readInputs();
    state.input = input;
    state.design = F.design(input);
    state.map = F.lensMap(state.design);
    state.track = F.yearTrack(state.design, state.year);
    state.keyRows = F.key(state.design, state.year, state.track);
    state.mesh = null;
    const len = state.track.length;
    $('day').max = String(len);
    if (state.n > len) state.n = len;
    $('yourBtn').hidden = !input.day;
    document.querySelectorAll('.js-year').forEach((el) => { el.textContent = String(state.year); });
    $('yearLabel').textContent = String(state.year);
    const note = $('placeNote');
    note.dataset.base = note.dataset.base || note.textContent;
    note.textContent = notes.length ? notes.join('; ') + '.' : note.dataset.base;
    renderKey();
    renderFacts();
    renderBudget();
    renderDropped();
    renderSlit();
    drawAll();
    renderStats();
  }

  /* ---------------------------------------------------------------- canvases */

  function fitCanvas(c, aspect, maxH) {
    const w = Math.max(200, c.clientWidth || c.parentNode.clientWidth || 320);
    let h = Math.round(w * aspect);
    if (maxH) h = Math.min(h, maxH);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    c.style.height = h + 'px';
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  // The light for the chosen day: where it lands, whether the slit lets any in at that slant, whether it
  // goes straight out, and the second stripe your slot in the near wall lets in, if there is one.
  function lightFor(kind) {
    const t = state.track[state.n - 1];
    const amp = kind === 'rise' ? t.ampRise : t.ampSet;
    const land = F.landing(state.design, kind, amp);
    const open = land.width > 0;
    const through = open && land.onFar && ((land.hit && land.hit.kind === 'slot') || F.throughFarSlit(state.design, amp));
    const lk = F.slotLeak(state.design, kind, amp);
    const leak = lk && lk.onFar && lk.width >= F.SLIVER ? lk : null;
    // all of it goes out again through the far slit (or a slot); otherwise some lands in the box, on the
    // wall or on the sides of the far slit, and some of that may go out as well
    const leakOut = !!(leak && leak.inBox < F.SLIVER), leakPartOut = !!(leak && !leakOut && leak.out >= F.SLIVER);
    return { amp, land, through, open, leak, leakOut, leakPartOut };
  }
  // How bright the stripe is at its brightest, as a share of full sunlight: a beam narrower than the
  // spread the Sun's disc gives it is smeared out and fainter.
  const discSpread = (dist) => dist * 2 * F.SEMIDIAMETER * RAD;
  const peak = (beam, dist) => Math.min(1, beam / discSpread(dist));

  function drawPlan() {
    const c = $('plan');
    const d = state.design, map = state.map, P = map.points;
    const { ctx, w, h } = fitCanvas(c, 1.06);
    const span = d.D * 1.9;
    const s = Math.min(w / span, h / (d.D * 1.732 + 24));
    const cx = w / 2, cy = h / 2 + 6;
    const X = (x) => cx + x * s, Y = (y) => cy - y * s;
    ctx.clearRect(0, 0, w, h);
    const col = { wall: css('--wall'), floor: css('--floor'), groove: css('--groove'), letter: css('--letter'), slit: css('--floor'), slot: css('--floor') };
    const order = ['floor', 'slit', 'slot', 'wall', 'groove', 'letter'];
    for (const name of order) {
      for (const r of map.regions) {
        if (r.name !== name) continue;
        ctx.beginPath();
        for (const loop of r.loops) { loop.forEach((id, i) => { const p = P[id]; if (i) ctx.lineTo(X(p[0]), Y(p[1])); else ctx.moveTo(X(p[0]), Y(p[1])); }); ctx.closePath(); }
        ctx.fillStyle = col[name] || col.floor;
        ctx.fill('evenodd');
      }
    }
    // beams
    for (const kind of ['rise', 'set']) {
      const L = lightFor(kind);
      const src = kind === 'rise' ? [d.D / 2, 0] : [-d.D / 2, 0];
      const az = kind === 'rise' ? 90 - L.amp : 270 + L.amp; // where the Sun is
      const toSun = [Math.sin(az * RAD), Math.cos(az * RAD)];
      const dir = [-toSun[0], -toSun[1]];
      // where the beam meets the inside of the box: the far wall, or the near wall past a tip
      const end = L.land.point || [src[0] + dir[0] * d.R, src[1] + dir[1] * d.R];
      const colr = css(kind === 'rise' ? '--rise' : '--set');
      const sunAt = [src[0] + toSun[0] * d.D * 0.36, src[1] + toSun[1] * d.D * 0.36];
      // outside, faint
      ctx.strokeStyle = colr; ctx.globalAlpha = 0.45; ctx.lineWidth = 1.5; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(X(sunAt[0]), Y(sunAt[1])); ctx.lineTo(X(src[0]), Y(src[1])); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      // inside, unless the slit is shut to light this steep
      if (L.open) {
        ctx.lineWidth = 2.6; ctx.globalAlpha = Math.max(0.35, peak(L.land.width, d.R) / peak(d.params.slit, d.R));
        ctx.beginPath(); ctx.moveTo(X(src[0]), Y(src[1]));
        const out = L.through ? [src[0] + dir[0] * (d.D + d.D * 0.22), src[1] + dir[1] * (d.D + d.D * 0.22)] : end;
        ctx.lineTo(X(out[0]), Y(out[1])); ctx.stroke();
        ctx.fillStyle = colr;
        if (!L.through) { ctx.beginPath(); ctx.arc(X(end[0]), Y(end[1]), 3.5, 0, 2 * Math.PI); ctx.fill(); }
        ctx.globalAlpha = 1;
      }
      // the second beam, let in by your slot in the near wall
      if (L.leak) {
        const k = L.leak, from = [k.mouth[0] + toSun[0] * 10, k.mouth[1] + toSun[1] * 10];
        const to = L.leakOut || L.leakPartOut ? [k.point[0] + dir[0] * d.D * 0.22, k.point[1] + dir[1] * d.D * 0.22] : k.point;
        ctx.strokeStyle = colr; ctx.lineWidth = 1.8; ctx.setLineDash([5, 3]);
        ctx.beginPath(); ctx.moveTo(X(from[0]), Y(from[1])); ctx.lineTo(X(to[0]), Y(to[1])); ctx.stroke();
        ctx.setLineDash([]);
        if (!L.leakOut) { ctx.fillStyle = colr; ctx.beginPath(); ctx.arc(X(k.point[0]), Y(k.point[1]), 2.6, 0, 2 * Math.PI); ctx.fill(); }
      }
      // the sun
      ctx.beginPath(); ctx.arc(X(sunAt[0]), Y(sunAt[1]), 7, 0, 2 * Math.PI); ctx.fillStyle = css('--sun'); ctx.fill();
      ctx.lineWidth = 1.2; ctx.strokeStyle = colr; ctx.stroke();
    }
    ctx.fillStyle = css('--muted');
    ctx.font = '600 12px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('N', X(0), Y(d.D * 0.866) - 8);
    ctx.fillText('E', X(d.D / 2) + 16, Y(0) + 18);
    ctx.fillText('W', X(-d.D / 2) - 16, Y(0) + 18);
  }

  function drawWalls() {
    const c = $('walls');
    const d = state.design;
    const { ctx, w, h } = fitCanvas(c, 0.56, 250);
    ctx.clearRect(0, 0, w, h);
    const reach = Math.min(d.thetaIn, Math.max(...d.grooves.map((g) => Math.max(Math.abs(g.ampRise), Math.abs(g.ampSet)))) + 6);
    const mmMax = reach * RAD * d.R;
    const padX = 22, stripH = Math.max(46, (h - 70) / 2), gapY = 30;
    const strips = [{ kind: 'rise', side: 'W', y: 18, title: 'Morning: inside the west wall' }, { kind: 'set', side: 'E', y: 18 + stripH + gapY, title: 'Evening: inside the east wall' }];
    const sx = (w - 2 * padX) / (2 * mmMax);
    for (const st of strips) {
      // seen from inside: looking west, north is on the right; looking east, north is on the left
      const flip = st.side === 'W' ? 1 : -1;
      const XX = (mm) => w / 2 + flip * mm * sx;
      const z0 = st.y + stripH;
      const ZZ = (z) => z0 - ((z - d.T) / (d.Z - d.T)) * stripH;
      ctx.fillStyle = css('--wall-face');
      ctx.fillRect(padX, st.y, w - 2 * padX, stripH);
      // Under a raised skyline the Sun is up when the box is read, and the top of the wall is in direct
      // sun over the near wall; under a sunken one the slit's floor shades the foot of the wall.
      const hz = st.side === 'W' ? d.params.horizonE : d.params.horizonW;
      const lit = d.readTop[st.side], foot = d.T + Math.max(0, -Math.tan(hz * RAD) * d.R);
      if (lit < d.Z - 0.05) {
        ctx.fillStyle = css('--sun'); ctx.globalAlpha = 0.5;
        ctx.fillRect(padX, ZZ(d.Z), w - 2 * padX, ZZ(lit) - ZZ(d.Z)); ctx.globalAlpha = 1;
      }
      const colr = css(st.kind === 'rise' ? '--rise' : '--set');
      // a stripe: the beam plus the spread the Sun's disc gives it, softened at the edges, as bright as its peak
      const stripe = (mm, beam, dist, alpha, dashed) => {
        const x = XX(mm), half = Math.max(2.2, ((beam + discSpread(dist)) * sx) / 2);
        const g = ctx.createLinearGradient(x - half * 1.6, 0, x + half * 1.6, 0);
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.3, colr); g.addColorStop(0.7, colr); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.globalAlpha = alpha;
        ctx.fillRect(x - half * 1.6, ZZ(lit), half * 3.2, ZZ(foot) - ZZ(lit));
        ctx.globalAlpha = 1;
        if (dashed) {
          ctx.strokeStyle = css('--ink'); ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
          ctx.strokeRect(x - half - 1, ZZ(lit), 2 * half + 2, ZZ(foot) - ZZ(lit)); ctx.setLineDash([]);
        }
      };
      const L = lightFor(st.kind);
      if (L.open && L.land.onFar) {
        const dim = Math.max(0.2, peak(L.land.width, d.R) / peak(d.params.slit, d.R));
        stripe(L.land.mm, L.land.width, d.R, (L.through ? 0.5 : 0.95) * dim, false);
      }
      // the second stripe; one on the sides of the far slit is drawn after the slit, so the slit does not hide it
      const leakOnCut = !!(L.leak && L.leak.hit && L.leak.hit.kind !== 'groove');
      const leakStripe = () => stripe(L.leak.mm, L.leak.alongWall, L.leak.distance, 0.95 * Math.max(0.2, peak(L.leak.inBox, L.leak.distance)), true);
      if (L.leak && !L.leakOut && !leakOnCut) leakStripe();
      const wall = d.walls[st.side];
      for (const f of wall.features) {
        const mm = f.theta * RAD * d.R;
        if (f.kind === 'groove') {
          const top = ZZ(d.Z), bot = ZZ(F.grooveBottom(d, f.level, st.side));
          ctx.fillStyle = css('--groove');
          ctx.fillRect(XX(mm) - Math.max(1.2, sx * F.FIXED.grooveWidth) / 2, top, Math.max(1.2, sx * F.FIXED.grooveWidth), bot - top);
        } else {
          const half = f.kind === 'slit' ? d.params.slit / 2 : F.FIXED.slotWidth / 2;
          const gw = Math.max(2, sx * half * 2);
          ctx.fillStyle = css('--bg');
          ctx.fillRect(XX(mm) - gw / 2, st.y - 1, gw, stripH + 2);
          ctx.strokeStyle = css('--muted'); ctx.lineWidth = 1;
          ctx.strokeRect(XX(mm) - gw / 2 - 0.5, st.y - 1, gw + 1, stripH + 2);
          if (f.kind === 'slit') {
            // the flared opening around the slit, seen from inside
            ctx.fillStyle = css('--groove'); ctx.globalAlpha = 0.25;
            const fw = sx * wall.slitHalfMM * 2;
            ctx.fillRect(XX(mm) - fw / 2, st.y, fw, stripH); ctx.globalAlpha = 1;
          }
        }
      }
      if (L.leak && !L.leakOut && leakOnCut) leakStripe();
      // labels
      ctx.fillStyle = css('--ink'); ctx.font = '600 13px system-ui, sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(st.title, padX, st.y - 5);
      ctx.fillStyle = css('--muted'); ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'left'; ctx.fillText(flip === 1 ? 'S' : 'N', padX - 14, st.y + stripH / 2 + 4);
      ctx.textAlign = 'right'; ctx.fillText(flip === 1 ? 'N' : 'S', w - padX + 14, st.y + stripH / 2 + 4);
    }
    ctx.textAlign = 'left';
  }

  /* ---------------------------------------------------------------- 3D view */

  function currentMesh() {
    const k = JSON.stringify(state.input);
    if (!state.mesh || state.meshFor !== k) { state.mesh = F.boxMesh(state.input); state.meshFor = k; state.mesh.box = F.bounds(state.mesh); }
    return state.mesh;
  }
  function drawModel() {
    const c = $('model');
    const { ctx, w, h } = fitCanvas(c, 0.72, 520);
    ctx.clearRect(0, 0, w, h);
    const m = currentMesh(), b = m.box;
    const ctr = [(b.lo[0] + b.hi[0]) / 2, (b.lo[1] + b.hi[1]) / 2, (b.lo[2] + b.hi[2]) / 2];
    const cy = Math.cos(state.yaw), sy = Math.sin(state.yaw), cp = Math.cos(state.pitch), sp = Math.sin(state.pitch);
    const rot = (v) => {
      const x = v[0] - ctr[0], y = v[1] - ctr[1], z = v[2] - ctr[2];
      const x1 = cy * x - sy * y, y1 = sy * x + cy * y;
      return [x1, cp * y1 - sp * z, sp * y1 + cp * z]; // [screen x, depth, screen up]
    };
    const V = m.vertices.map(rot);
    const radius = Math.hypot(b.size[0], b.size[1], b.size[2]) / 2;
    const s = (Math.min(w, h) * 0.48) / radius;
    const light = [-0.35, -0.55, 0.76];
    const base = css('--model');
    const rgb = parseColor(base);
    const faces = [];
    for (const f of m.faces) {
      const a = V[f[0]], bb = V[f[1]], cc = V[f[2]];
      const u = [bb[0] - a[0], bb[1] - a[1], bb[2] - a[2]], v = [cc[0] - a[0], cc[1] - a[1], cc[2] - a[2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const ln = Math.hypot(n[0], n[1], n[2]) || 1;
      if (n[1] / ln > 0.02) continue; // facing away from the viewer (the viewer looks along +depth)
      const lit = 0.56 + 0.44 * Math.max(0, (n[0] * light[0] + n[1] * light[1] + n[2] * light[2]) / ln);
      faces.push({ z: a[1] + bb[1] + cc[1], a, b: bb, c: cc, lit });
    }
    faces.sort((p, q) => q.z - p.z);
    for (const f of faces) {
      ctx.beginPath();
      ctx.moveTo(w / 2 + f.a[0] * s, h / 2 - f.a[2] * s);
      ctx.lineTo(w / 2 + f.b[0] * s, h / 2 - f.b[2] * s);
      ctx.lineTo(w / 2 + f.c[0] * s, h / 2 - f.c[2] * s);
      ctx.closePath();
      const k = f.lit;
      ctx.fillStyle = `rgb(${Math.round(rgb[0] * k)},${Math.round(rgb[1] * k)},${Math.round(rgb[2] * k)})`;
      ctx.fill();
      ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 0.6; ctx.stroke();
    }
  }
  function parseColor(c) {
    const m = /^#([0-9a-f]{6})$/i.exec(c);
    if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
    const r = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
    return r ? [+r[1], +r[2], +r[3]] : [220, 214, 200];
  }
  let modelQueued = false;
  function queueModel() { if (modelQueued) return; modelQueued = true; requestAnimationFrame(() => { modelQueued = false; drawModel(); }); }
  function bindModel() {
    const c = $('model');
    let drag = null;
    c.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, yaw: state.yaw, pitch: state.pitch, touch: e.pointerType === 'touch' }; c.setPointerCapture(e.pointerId); });
    c.addEventListener('pointermove', (e) => {
      if (!drag) return;
      state.yaw = drag.yaw + (e.clientX - drag.x) * 0.012;
      if (!drag.touch) state.pitch = Math.max(0.05, Math.min(1.5, drag.pitch + (e.clientY - drag.y) * 0.01));
      queueModel();
    });
    const end = () => { drag = null; };
    c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
    c.addEventListener('keydown', (e) => {
      const k = { ArrowLeft: [-0.15, 0], ArrowRight: [0.15, 0], ArrowUp: [0, -0.1], ArrowDown: [0, 0.1] }[e.key];
      if (!k) return;
      e.preventDefault();
      state.yaw += k[0]; state.pitch = Math.max(0.05, Math.min(1.5, state.pitch + k[1]));
      queueModel();
    });
    $('resetView').addEventListener('click', () => { state.yaw = -0.65; state.pitch = 0.95; queueModel(); });
  }

  /* ---------------------------------------------------------------- words */

  // Where light of amplitude amp lands on its far wall: millimetres along the wall from the axis.
  const wallMM = (amp) => F.wallTheta(state.design.R, amp) * RAD * state.design.R;
  // The days whose light lands within tol millimetres of where light of amplitude amp lands.
  const nearestRun = (kind, amp, tol) => F.nearDays(state.design, state.track, kind, amp, tol);
  function runText(days) {
    if (!days.length) return '';
    return F.runsOf(days).map((r) => (r.length === 1 ? shortDate(r[0]) : `${shortDate(r[0])} – ${shortDate(r[r.length - 1])}`)).join(' and ');
  }
  function featureName(f) {
    if (!f) return null;
    if (f.kind === 'slot') return 'your slot';
    if (f.kind === 'slit') return 'the far slit';
    const g = state.design.grooves[f.groove];
    return `the ${g.level === 3 ? 'long' : g.level === 2 ? 'middle' : 'short'} groove (${g.names.join(' / ')})`;
  }
  // Clock times: this device's own time zone, and UT.
  function clock(jd) {
    const t = new Date(Math.round((jd - 2440587.5) * 86400000));
    const local = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
    const ut = `${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`;
    return { local, ut };
  }
  function sentenceFor(kind) {
    const L = lightFor(kind), d = state.design, slit = d.params.slit;
    const who = kind === 'rise' ? 'Morning light' : 'Evening light';
    const wallName = kind === 'rise' ? 'west' : 'east', nearName = kind === 'rise' ? 'east' : 'west';
    const sun = `The Sun ${kind === 'rise' ? 'rises' : 'sets'} ${fmt(Math.abs(L.amp), 1)}° ${L.amp >= 0 ? 'north' : 'south'} of due ${kind === 'rise' ? 'east' : 'west'}.`;
    const ns = (mm) => (mm >= 0 ? 'north' : 'south');
    // the second stripe, from your slot in the near wall: on the wall, or on the sides of the far slit (or
    // of a slot in the far wall), where only the part that passes its land goes out again
    const lh = L.leak && L.leak.hit;
    const cutName = lh && lh.kind === 'slit' ? `the flared sides of the ${wallName} slit` : lh && lh.kind === 'slot' ? `the sides of your slot in the ${wallName} wall` : null;
    const partOut = L.leakPartOut ? '; some of it goes out through it' : '';
    const leak = !L.leak || L.leakOut ? ''
      : cutName ? ` A second patch of light, let in by your slot in the ${nearName} wall, falls on ${cutName}${partOut}.`
        : ` A second stripe, let in by your slot in the ${nearName} wall, falls ${fmt(Math.abs(L.leak.mm), 1)} mm ${ns(L.leak.mm)} of the slit${lh ? ', on ' + featureName(lh) : ''}.`;
    if (!L.open) return `<strong>${who}</strong> does not get in: it meets the slit ${fmt(Math.abs(L.amp), 1)}° off its line, too steep for a ${fmt(slit, 1)} mm slit to let any through.${leak} ${sun}`;
    const sliver = L.land.width < 0.4 * slit ? ` At this slant only ${fmt(L.land.width, 2)} mm of the ${fmt(slit, 1)} mm slit lets it through, so the stripe is faint.` : '';
    if (!L.land.onFar) return `<strong>${who}</strong> passes the end of the ${wallName} wall and falls on the inside of the ${nearName} wall, near the ${L.land.point && L.land.point[1] >= 0 ? 'north' : 'south'} tip. Do not read a stripe there as a date: at some settings it lands on a groove cut for the other time of day.${sliver}${leak} ${sun}`;
    if (L.through) return `<strong>${who}</strong> goes straight out through ${L.land.hit && L.land.hit.kind === 'slot' ? 'your slot' : 'the far slit'}.${sliver}${leak} ${sun}`;
    const hit = featureName(L.land.hit);
    const where = `${fmt(Math.abs(L.land.mm), 1)} mm ${ns(L.land.mm)} of the slit in the ${wallName} wall`;
    return `<strong>${who}</strong> lands ${hit ? 'on ' + hit + ', ' : ''}${where}.${sliver}${leak} ${sun}`;
  }
  function timesFor() {
    const t = state.track[state.n - 1], p = state.design.params;
    const r = F.eventTimes(state.year, t.month, t.day, p.lat, p.lon, 'rise', p.horizonE);
    const s = F.eventTimes(state.year, t.month, t.day, p.lat, p.lon, 'set', p.horizonW);
    if (!r || !s) return '';
    const c = (jd) => clock(jd).local;
    const speed = r.azPerMinute * RAD * state.design.R;
    const slide = speed < 0.05 ? 'Here the Sun climbs almost straight up, so the stripe hardly moves sideways; it slides down the wall instead.' : `Around then the stripe slides about ${fmt(speed, 1)} mm a minute.`;
    return `<strong>When to look</strong>, by this device&rsquo;s clock: the morning stripe appears about ${c(r.first)}; the box is cut for ${c(r.mid)}, when half the Sun is up (${clock(r.mid).ut} UT). In the evening, read it at ${c(s.mid)}; it is gone by ${c(s.last)}. ${slide}`;
  }
  function renderReadout() {
    const t = state.track[state.n - 1];
    $('dayLabel').textContent = dateText(t);
    $('day').value = String(state.n);
    $('day').setAttribute('aria-valuetext', dateText(t));
    $('readout').innerHTML = sentenceFor('rise') + ' ' + sentenceFor('set');
    $('times').innerHTML = timesFor();
    const noon = F.solarNoon(state.year, t.month, t.day, state.input.lon);
    $('noon').textContent = `${clock(noon).local} by this device’s clock (${clock(noon).ut} UT) on ${dateText(t)}`;
  }

  function renderKey() {
    const d = state.design, tb = $('key').querySelector('tbody');
    tb.innerHTML = '';
    const st = F.straightThrough(d, state.year, state.track);
    for (const row of state.keyRows) {
      const g = d.grooves[row.groove];
      const tr = document.createElement('tr');
      const len = g.level === 3 ? 20 : g.level === 2 ? 13 : 7;
      // light from north of east lands south of the axis; the equinox groove's light is on the axis itself
      const half = g.k === 0 ? 'on the axis' : g.ampRise >= 0 ? 'south half' : 'north half';
      const cell = (list, kind) => {
        if (list === null) {
          const drop = d.dropped.find((x) => x.groove === row.groove && x.side === (kind === 'rise' ? 'W' : 'E'));
          if (drop && drop.reason === 'inside the far slit') return `<span class="gone">no groove: the light leaves through the far slit (${st[kind].map(shortDate).join(', ')})</span>`;
          return `<span class="gone">not cut: ${drop ? drop.reason : 'no room'}</span>`;
        }
        if (g.level === 3 && Math.abs(g.k) === 6) {
          const run = nearestRun(kind, kind === 'rise' ? g.ampRise : g.ampSet, 0.5);
          return run.length ? `${runText(run)} <span class="muted">(within half a millimetre)</span>` : '—';
        }
        return list.length ? list.join(', ') : '—';
      };
      tr.innerHTML = `<td data-label="Groove"><span><span class="glyph" style="height:${len}px"></span>${g.level === 3 ? 'long' : g.level === 2 ? 'middle' : 'short'}, ${half}</span></td><td data-label="Morning"><span>${cell(row.rise, 'rise')}</span></td><td data-label="Evening"><span>${cell(row.set, 'set')}</span></td><td data-label="Solar terms"><span>${g.names.join(' / ')}</span></td>`;
      tb.appendChild(tr);
    }
    if (d.your) {
      const tr = document.createElement('tr');
      tr.className = 'mine';
      const cut = (kind) => slotText(kind) || `<span class="gone">not cut: ${slotLost(kind === 'rise' ? 'W' : 'E').short}</span>`;
      tr.innerHTML = `<td data-label="Groove"><span>your slot</span></td><td data-label="Morning"><span>${cut('rise')}</span></td><td data-label="Evening"><span>${cut('set')}</span></td><td data-label="Day"><span>${d.your.day} ${MONTH_NAMES[d.your.month - 1]}, and its twin</span></td>`;
      tb.appendChild(tr);
    }
  }
  // Why your slot was not cut in a wall (W for the morning, E for the evening), from the reason the design
  // gives: it would sit within 4 mm of a tip of the wall (or past it), or crowd the far slit.
  function slotLost(side) {
    const x = state.design.dropped.find((y) => y.kind === 'slot' && y.side === side);
    const tip = !!(x && x.reason === 'too close to the tip');
    return { reason: x ? x.reason : null, tip, short: tip ? 'too near the end of the wall, or past it' : x && x.reason === 'inside the far slit' ? 'too near the far slit' : 'no room' };
  }
  // Your slot: the mornings (or evenings) whose stripe is centred inside it; if none is, because the
  // stripe steps more than a slot's width a day, the nearest day either side of the solstice instead.
  function slotInfo(kind) {
    const d = state.design;
    const f = d.walls[kind === 'rise' ? 'W' : 'E'].features.find((x) => x.kind === 'slot');
    if (!f) return null;
    const key = kind === 'rise' ? 'ampRise' : 'ampSet', centre = f.theta * RAD * d.R, half = F.FIXED.slotWidth / 2;
    const offs = state.track.map((t) => ({ t, off: wallMM(t[key]) - centre }));
    const inside = offs.filter((o) => Math.abs(o.off) < half).map((o) => o.t);
    const near = offs.filter((o, i) => {
      const a = offs[i - 1], b = offs[i + 1];
      return Math.abs(o.off) < 2 && (!a || Math.abs(o.off) <= Math.abs(a.off)) && (!b || Math.abs(o.off) < Math.abs(b.off));
    });
    return { inside, near };
  }
  // One entry per pass of the light across the slot (usually two a year, either side of the solstice):
  // the run of days centred inside it, or, if the stripe stepped over it, the nearest day.
  function slotText(kind) {
    const s = slotInfo(kind);
    if (!s) return '';
    const runs = [];
    for (const t of s.inside) {
      const last = runs[runs.length - 1];
      if (last && t.n === last[last.length - 1].n + 1) last.push(t); else runs.push([t]);
    }
    const parts = [], used = new Set();
    for (const o of s.near) {
      const run = runs.find((r) => r.some((t) => t.n === o.t.n));
      if (run) { if (!used.has(run)) { used.add(run); parts.push(runText(run)); } }
      else parts.push(`${shortDate(o.t)} <span class="muted">(${fmt(Math.abs(o.off), 1)} mm off its centre: part of the stripe gets through)</span>`);
    }
    for (const run of runs) if (!used.has(run)) parts.push(runText(run));
    return parts.join(' and ');
  }

  function renderFacts() {
    const d = state.design, tr = state.track, out = [];
    const st = F.straightThrough(d, state.year, tr);
    const eq = equinoxes();
    const how = (x, slit) => (x.through ? shortDate(x) : `${shortDate(x)} (nearest: its centre passes ${fmt(Math.abs(x.offset), 1)} mm from the middle of the ${fmt(d.params.slit, 1)} mm slit, so only its edge gets out)`);
    const lean = Math.abs(d.params.lat) < 1 ? '' : `, and at your latitude that puts the equinox sunrise slightly ${d.params.lat >= 0 ? 'north' : 'south'} of due east`;
    out.push(`<p><strong>Straight through.</strong> The morning light crosses the box and leaves by the west slit on ${st.rise.map(how).join(' and ')}; the evening light leaves by the east slit on ${st.set.map(how).join(' and ')}. If the box is turned true, this is the moment to check it. The equinoxes this year fall on ${eq.map(shortDate).join(' and ')}${d.params.horizonE === 0 && d.params.horizonW === 0 ? `. The days differ because the air bends the light: you see the Sun on the horizon while it is still a little below it${lean}.` : '. Your horizons move these days too.'}</p>`);
    // the solstice dwell
    const sol = d.grooves.find((g) => g.k === (d.params.lat >= 0 ? 6 : -6));
    const run = nearestRun('rise', sol.ampRise, 0.5);
    let maxmm = 0;
    for (let i = 1; i < tr.length; i++) maxmm = Math.max(maxmm, Math.abs(wallMM(tr[i].ampRise) - wallMM(tr[i - 1].ampRise)));
    out.push(`<p><strong>The Sun stands still.</strong> Near the equinoxes the morning stripe moves up to ${fmt(maxmm, 2)} mm a day along the wall. Around the ${d.params.lat >= 0 ? 'June' : 'December'} solstice it stays within half a millimetre of the long groove for ${run.length} days (${runText(run)}). That is why the grooves crowd together at the ends.</p>`);
    if (d.your) {
      const tw = F.twin(d, state.year, d.your.month, Math.min(d.your.day, F.daysInMonth(state.year, d.your.month)), tr);
      const r = slotText('rise'), s = slotText('set');
      // with no slot in a wall, the reason the design gives: too near a tip of the wall, or the far slit
      const noSlot = (side, when, wall) => (slotLost(side).tip
        ? `no slot is cut for the ${when} light, which falls too near the end of the ${wall} wall, or past it (a cut must stay 4 mm clear of a tip)`
        : `your day is too close to the far slit for a slot of its own; its ${when} light leaves by the far slit, or nearly`);
      const evening = s ? '; the evening light through the slot in the east wall on ' + s : slotLost('E').tip ? '; ' + noSlot('E', 'evening', 'east') : '';
      out.push(`<p><strong>Your day.</strong> ${d.your.day} ${MONTH_NAMES[d.your.month - 1]}: ${r ? 'the morning light goes out through your slot in the west wall on ' + r : noSlot('W', 'morning', 'west')}${evening}.${tw ? ` Its twin, the day on the other side of the solstice when the Sun rises in nearly the same place, is ${tw.day} ${MONTH_NAMES[tw.month - 1]}.` : ''}</p>`);
      // a slot is an opening both ways: it lets in sunlight from the other end of the day
      const lk = F.leaks(d, tr);
      if (lk.rise.length || lk.set.length) {
        const onGroove = (list) => list.filter((x) => x.near && x.near.mm <= 0.5);
        const gm = onGroove(lk.rise), ge = onGroove(lk.set);
        const dates = (list) => list.map((x) => shortDate(x)).join(', ');
        const onCut = (kind) => lk.rise.filter((x) => x.onCut === kind).length + lk.set.filter((x) => x.onCut === kind).length;
        const cuts = [onCut('slit') ? `on ${onCut('slit')} of those mornings and evenings, a patch of light on the flared sides of the far slit` : '', onCut('slot') ? `on ${onCut('slot')}, a patch on the sides of your slot in the far wall` : ''].filter(Boolean).join(', or ');
        const where = gm.length + ge.length
          ? ` On ${gm.length + ge.length} of them it falls within half a millimetre of a groove, where it could be read as the wrong date: ${[gm.length ? `the mornings of ${dates(gm)}` : '', ge.length ? `the evenings of ${dates(ge)}` : ''].filter(Boolean).join('; ')}.`
          : '';
        const has = (side) => d.walls[side].features.some((f) => f.kind === 'slot');
        const ways = [has('E') ? 'the one in the east wall, cut for your evening, lets the morning sun in onto the west wall' : '', has('W') ? 'the one in the west wall, cut for your morning, lets the evening sun in onto the east wall' : ''].filter(Boolean).join(', and ');
        out.push(`<p><strong>A second stripe.</strong> A slot is an opening both ways: ${ways}. This year that lets a second beam into the box on ${lk.rise.length} mornings and ${lk.set.length} evenings (drawn above with a dashed edge). It makes a second stripe on the wall, often as bright as the first${cuts ? `, or, ${cuts}` : ''}.${where} A strip of opaque tape over the outside of each slot stops it; take it off around your day and its twin.</p>`);
      }
    }
    $('facts').innerHTML = out.join('');
  }
  // Local dates of the two equinoxes: the Sun's longitude passing 0 and 180 degrees.
  function equinoxes() {
    const out = [], lon = state.input.lon;
    for (const target of [0, 180]) {
      let a = F.julianDay(state.year, target === 0 ? 3 : 9, 10), b = a + 25;
      const f = (jd) => ((F.sun(jd).lambda - target + 540) % 360) - 180;
      for (let k = 0; k < 50; k++) { const m = (a + b) / 2; if (f(m) < 0) a = m; else b = m; }
      const c = F.calendarDate(a + lon / 360);
      out.push({ month: c.month, day: c.day });
    }
    return out;
  }

  function renderBudget() {
    const d = state.design, p = d.params;
    const b = F.budget(d, state.track, state.year);
    const label = {
      model: 'The Sun model against JPL Horizons (largest difference found at 148 sunrises and sunsets in ten cities)',
      stripe: `Half the width of the stripe: the beam a ${fmt(p.slit, 1)} mm slit lets through, and the Sun's disc (the beam is narrower in ${p.lat >= 0 ? 'May' : 'November'}, when it crosses the slit at a slant)`,
      refraction: 'Refraction at the horizon on a given morning: ±0.3° in height',
      horizon: 'Your horizon height misjudged by 0.5°',
      minute: 'Reading it a minute early or late (near an equinox)',
      turn: 'The box turned 1° off true east–west',
    };
    const month = p.lat >= 0 ? 'May' : 'November';
    $('budget').innerHTML = `<div class="table-wrap"><table class="budget"><thead><tr><th scope="col">Source of error, at your place</th><th scope="col" class="n">degrees, near an equinox</th><th scope="col" class="n">days, near an equinox</th><th scope="col" class="n">days, early ${month}</th></tr></thead><tbody>${b.rows.map((r) => `<tr><td>${label[r.key]}</td><td class="n">${fmt(r.eq, r.eq < 0.1 ? 3 : 2)}</td><td class="n">${fmt(r.daysEq, 1)}</td><td class="n">${fmt(r.daysXq, 1)}</td></tr>`).join('')}</tbody></table></div>
      <p class="small muted">Near an equinox the sunrise point moves ${fmt(b.rEq, 2)}° a day here; in early ${month}, ${fmt(b.rXq, 2)}° a day; near a solstice almost not at all, so no box can date a day there. The ±0.3&deg; is the uncertainty JPL&rsquo;s own Horizons manual gives for refraction near the horizon; Schaefer and Liller measured sunsets whose refraction differed from the standard value by more than that. Errors that change from morning to morning combine roughly as the square root of the sum of their squares: here the stripe&rsquo;s width, the refraction and a minute&rsquo;s timing come to about <span id="rss">${fmt(b.rssEq, 1)}</span> days near an equinox. A misjudged horizon or a turning error is the same every morning and shifts every reading the same way on top of that, which is why the straight-through days are worth watching.</p>`;
    $('turnDays').textContent = fmt(b.rows.find((r) => r.key === 'turn').daysEq, 1);
  }

  function renderDropped() {
    const d = state.design;
    // each groove left out, with the reason the design gives; a groove can go from one wall or both
    const groups = new Map();
    for (const x of d.dropped) {
      if (x.kind !== 'groove' || x.reason === 'inside the far slit') continue;
      if (!groups.has(x.reason)) groups.set(x.reason, new Set());
      groups.get(x.reason).add(x.groove);
    }
    const n = (k) => `${k} groove${k > 1 ? 's' : ''}`;
    const why = {
      'too close to the tip': (k) => `${n(k)} that would sit within 4 mm of a tip of the wall`,
      'crowded by its neighbour': (k) => `${n(k)} crowded by ${k > 1 ? 'their neighbours' : 'its neighbour'}, because near a solstice the Sun hardly moves between one groove and the next`,
      'covered by your slot': (k) => `${n(k)} covered by your slot`,
    };
    const parts = [];
    if (groups.size) parts.push(`Left out here: ${[...groups].map(([reason, set]) => (why[reason] || ((k) => `${n(k)} (${reason})`))(set.size)).join('; ')}.`);
    // your slot, where the design could not cut it, with the reason it gives for each wall
    if (d.your) {
      const lost = ['W', 'E'].filter((side) => !d.walls[side].features.some((f) => f.kind === 'slot'));
      const tips = lost.filter((side) => slotLost(side).tip), near = lost.filter((side) => !slotLost(side).tip);
      const when = (sides) => sides.map((side) => (side === 'W' ? 'morning' : 'evening')).join(' and ');
      if (tips.length) parts.push(`No slot is cut for your day's ${when(tips)} light: it falls too near ${tips.length > 1 ? 'the ends of the west and east walls, or past them' : `the end of the ${tips[0] === 'W' ? 'west' : 'east'} wall, or past it`}, and a cut must stay 4 mm clear of a tip.`);
      if (near.length) parts.push(`Your day falls too close to due ${near.map((side) => (side === 'W' ? 'east' : 'west')).join(' and due ')} for a slot of its own: its ${when(near)} light passes through the far slit, or within a few days of it.`);
    }
    // a slot near the slit leaves a column standing on the floor alone
    const thin = F.slotPillars(d).filter((pl) => pl.mm < 6);
    if (thin.length) {
      const which = thin.map((pl) => `${fmt(pl.mm, 1)} mm in the ${pl.side === 'W' ? 'west' : 'east'} wall`).join(' and ');
      parts.push(`Your slot${thin.length > 1 ? 's leave' : ' leaves'} only about ${which} (a little less on the printed box) between ${thin.length > 1 ? 'each slot' : 'it'} and the slit, on the inside: a column 28 mm tall, joined to the box only through the floor. It prints, but a knock can snap it, so handle the box by its tips.`);
    }
    $('dropNote').textContent = parts.join(' ');
  }

  // How much of the slit the steepest light the box is cut for gets through: the slit's straight land
  // narrows a slanting beam to w cos a - l sin a, which at high latitudes can be a sliver or nothing.
  function renderSlit() {
    const d = state.design, p = d.params, s = d.R * 2 * F.SEMIDIAMETER * RAD;
    let steep = null;
    for (const [kind, side] of [['rise', 'W'], ['set', 'E']]) for (const f of d.walls[side].features) {
      if (f.kind === 'groove' && (!steep || Math.abs(f.amp) > Math.abs(steep.amp))) steep = { kind, amp: f.amp };
    }
    const parts = [];
    if (steep) {
      const w = F.aperture(d, steep.kind, steep.amp), frac = w / p.slit;
      parts.push(`The steepest light that lands on a groove here meets the slit ${fmt(Math.abs(steep.amp), 1)}° off its line, and ${fmt(w, 2)} mm of the ${fmt(p.slit, 1)} mm slit lets it through (${Math.round(100 * frac)}%): it crosses the slit&rsquo;s 0.5&nbsp;mm straight part at a slant.`);
      if (frac < 0.4) {
        const dimmer = Math.min(1, p.slit / s) / Math.max(1e-9, Math.min(1, w / s));
        const wide = F.aperture(F.design(Object.assign({}, state.input, { slit: 1.6 })), steep.kind, steep.amp);
        parts.push(`That stripe is roughly ${fmt(dimmer, 0)} times fainter than at the equinox. At your latitude, choose a wider slit than the narrowest clean one on the coupon${p.slit < 1.6 ? `: a 1.6&nbsp;mm slit would let ${fmt(wide, 2)} mm through here` : ''}.`);
      }
    }
    const shut = (key, kind) => state.track.filter((t) => F.aperture(d, kind, t[key]) === 0).length;
    const sr = shut('ampRise', 'rise'), ss = shut('ampSet', 'set');
    if (sr || ss) parts.push(`On ${[sr ? `${sr} mornings` : '', ss ? `${ss} evenings` : ''].filter(Boolean).join(' and ')} around the ${p.lat >= 0 ? 'December' : 'June'} solstice no light gets in at all: the slit is shut to light more than ${fmt(Math.atan(p.slit / F.FIXED.land) / RAD, 1)}° off its line.`);
    $('slitNote').innerHTML = parts.join(' ');
    // the band of each far wall in direct sun under a raised skyline
    const flood = [['W', 'west', 'eastern', p.horizonE], ['E', 'east', 'western', p.horizonW]].filter(([side]) => d.readTop[side] < d.Z - 0.05);
    $('floodNote').textContent = flood.length
      ? ' ' + flood.map(([side, wall, sky, h]) => `With your ${sky} skyline ${fmt(h, 1)}° up, the ${wall} wall above ${fmt(d.readTop[side], 1)} mm is in direct sun when it is read (the pale band), so its grooves are cut longer to reach below it.`).join(' ')
      : '';
  }

  function renderStats() {
    const m = currentMesh(), b = m.box;
    $('stats').innerHTML = `<dt>Size</dt><dd>${fmt(b.size[0], 1)} × ${fmt(b.size[1], 1)} × ${fmt(b.size[2], 1)} mm</dd><dt>Solid volume</dt><dd>${fmt(F.volume(m) / 1000, 1)} cm³ (the slicer's infill uses less)</dd><dt>Triangles</dt><dd>${m.faces.length}</dd><dt>Cut for</dt><dd>${F.latitudeText(state.input.lat)}, ${fmt(Math.abs(state.input.lon), 1)}° ${state.input.lon >= 0 ? 'E' : 'W'}</dd>`;
    drawModel();
  }

  function drawAll() { drawPlan(); drawWalls(); renderReadout(); }

  /* ---------------------------------------------------------------- the year */

  function setDay(n) { state.n = ((n - 1 + state.track.length) % state.track.length) + 1; drawPlan(); drawWalls(); renderReadout(); }
  // the days the morning light meets a groove, your slot or the far slit, for stepping without animation
  const stops = () => F.readingStops(state.design, state.track, state.year);
  function play(on) {
    state.playing = on;
    $('play').setAttribute('aria-pressed', on ? 'true' : 'false');
    $('play').textContent = on ? 'Pause' : 'Play the year';
    clearTimeout(state.timer); cancelAnimationFrame(state.raf);
    if (!on) return;
    if (reduced.matches) {
      const tick = () => {
        const list = stops(), next = list.find((x) => x > state.n) || list[0];
        setDay(next);
        state.timer = setTimeout(tick, 1600);
      };
      tick();
    } else {
      let last = 0;
      const frame = (ts) => {
        if (ts - last > 45) { last = ts; setDay(state.n + 1); }
        state.raf = requestAnimationFrame(frame);
      };
      state.raf = requestAnimationFrame(frame);
    }
  }

  /* ---------------------------------------------------------------- downloads */

  function download(bytes, name) {
    const blob = new Blob([bytes], { type: 'model/stl' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  /* ---------------------------------------------------------------- wiring */

  function init() {
    fillSelects();
    $('preset').addEventListener('change', () => {
      const v = $('preset').value;
      if (v === 'custom') return;
      const [, lat, lon] = PRESETS[+v];
      $('lat').value = String(lat); $('lon').value = String(lon);
      scheduleRebuild();
    });
    for (const id of ['lat', 'lon']) $(id).addEventListener('input', () => { $('preset').value = 'custom'; scheduleRebuild(); });
    for (const id of ['horizonE', 'horizonW', 'size', 'slit']) $(id).addEventListener('input', scheduleRebuild);
    $('yourMonth').addEventListener('change', () => { fillDays(); scheduleRebuild(); });
    $('yourDate').addEventListener('change', scheduleRebuild);
    $('day').addEventListener('input', () => { if (state.playing) play(false); setDay(+$('day').value); });
    $('today').addEventListener('click', () => { play(false); setDay(dayOfYear(state.year, today.getMonth() + 1, Math.min(today.getDate(), F.daysInMonth(state.year, today.getMonth() + 1)))); });
    $('yourBtn').addEventListener('click', () => { const y = state.design.your; if (!y) return; play(false); setDay(dayOfYear(state.year, y.month, Math.min(y.day, F.daysInMonth(state.year, y.month)))); });
    $('play').addEventListener('click', () => play(!state.playing));
    $('dlBox').addEventListener('click', () => {
      const m = currentMesh();
      download(F.stl(m, F.stlLabel(m.design)), `first-light-${F.latitudeText(state.input.lat).replace('°', '')}${state.input.day ? '-' + state.input.day : ''}.stl`);
    });
    $('dlCoupon').addEventListener('click', () => { state.coupon = state.coupon || F.couponMesh(); download(F.stl(state.coupon, F.COUPON_LABEL), 'first-light-coupon.stl'); });
    bindModel();
    let resizeTimer = 0;
    window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { drawAll(); drawModel(); }, 100); });
    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const redraw = () => { drawAll(); drawModel(); };
      if (mq.addEventListener) mq.addEventListener('change', redraw);
      if (reduced.addEventListener) reduced.addEventListener('change', () => { if (state.playing) play(true); });
    }
    rebuild();
  }
  init();
})();
