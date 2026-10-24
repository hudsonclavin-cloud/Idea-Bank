// Kirkwood's Ruler: the page. Everything it says comes from belt.js; this file only draws and listens.
(function () {
  'use strict';
  var B = window.Belt;
  var $ = function (id) { return document.getElementById(id); };
  var fmt = function (n, d) { return Number(n).toLocaleString('en-US', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); };
  var trimAu = function (a) { return a.toFixed(4).replace(/0+$/, '').replace(/\.$/, ''); };

  var state = Object.assign({}, B.DEFAULTS);
  var cur = null;          // { layout, mesh, facts }
  var VIEWS = {
    three: { yaw: -0.42, pitch: 0.5 },
    front: { yaw: 0, pitch: 0.03 },
    top: { yaw: 0, pitch: 1.5 },
    end: { yaw: -1.25, pitch: 0.35 },
  };
  var view = Object.assign({}, VIEWS.three);
  var cursor = -1;         // bar under the reader's finger in the profile

  // ------------------------------------------------------------ settings from the URL
  (function readQuery() {
    var q = new URLSearchParams(location.search);
    ['pop', 'count', 'scale'].forEach(function (k) { if (q.has(k)) state[k] = q.get(k); });
    ['a0', 'a1', 'bin', 'length', 'relief', 'depth'].forEach(function (k) { if (q.has(k)) state[k] = Number(q.get(k)); });
    if (q.has('ledge')) state.ledge = q.get('ledge') !== '0' && q.get('ledge') !== 'false';
  })();

  // ------------------------------------------------------------ colours from the stylesheet
  var colours = {};
  function readColours() {
    var cs = getComputedStyle(document.documentElement);
    ['--ink', '--muted', '--line', '--accent', '--mark', '--bar', '--bar-dim', '--ledge', '--model', '--panel', '--bg'].forEach(function (k) {
      colours[k.slice(2)] = cs.getPropertyValue(k).trim() || '#888';
    });
  }
  function rgb(hex) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // ------------------------------------------------------------ canvases
  function fitCanvas(c) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.max(1, Math.round(c.clientWidth * dpr)), h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    var ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: c.clientWidth, h: c.clientHeight };
  }

  // The 3D view: orthographic, flat shaded, back faces culled, painted far to near.
  function draw3d() {
    var c = $('view3d');
    var g = fitCanvas(c), ctx = g.ctx;
    ctx.clearRect(0, 0, g.w, g.h);
    if (!cur) return;
    var V = cur.mesh.vertices, T = cur.mesh.triangles, size = cur.layout.size;
    var cx = size[0] / 2, cy = size[1] / 2, cz = size[2] / 2;
    var cyaw = Math.cos(view.yaw), syaw = Math.sin(view.yaw), cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
    var P = new Float64Array(V.length * 3);
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (var i = 0; i < V.length; i++) {
      var x = V[i][0] - cx, y = V[i][1] - cy, z = V[i][2] - cz;
      var x1 = cyaw * x - syaw * y, y1 = syaw * x + cyaw * y;
      // camera looks along (0, cos p, -sin p): down onto the ruler from in front
      var depth = cp * y1 - sp * z, up = sp * y1 + cp * z;
      P[3 * i] = x1; P[3 * i + 1] = -up; P[3 * i + 2] = depth;
      if (x1 < minX) minX = x1; if (x1 > maxX) maxX = x1;
      if (-up < minY) minY = -up; if (-up > maxY) maxY = -up;
    }
    var pad = 14;
    var s = Math.min((g.w - 2 * pad) / (maxX - minX || 1), (g.h - 2 * pad) / (maxY - minY || 1));
    var ox = g.w / 2 - s * (minX + maxX) / 2, oy = g.h / 2 - s * (minY + maxY) / 2;
    var base = rgb(colours.model);
    // light from the upper left, a little in front
    var L = [-0.45, -0.55, 0.7], ll = Math.hypot(L[0], L[1], L[2]);
    L = [L[0] / ll, L[1] / ll, L[2] / ll];
    var faces = [];
    for (var t = 0; t < T.length; t++) {
      var a = T[t][0], b = T[t][1], d = T[t][2];
      var ax = P[3 * a], ay = P[3 * a + 1], bx = P[3 * b], by = P[3 * b + 1], dx = P[3 * d], dy = P[3 * d + 1];
      var cross = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
      if (cross >= -1e-9) continue; // facing away (screen y points down)
      // world normal for shading
      var A = V[a], Bv = V[b], C = V[d];
      var ux = Bv[0] - A[0], uy = Bv[1] - A[1], uz = Bv[2] - A[2], wx = C[0] - A[0], wy = C[1] - A[1], wz = C[2] - A[2];
      var nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, nl = Math.hypot(nx, ny, nz) || 1;
      var lam = Math.max(0, (nx * L[0] + ny * L[1] + nz * L[2]) / nl);
      var k = 0.42 + 0.58 * lam;
      faces.push({ t: t, z: (P[3 * a + 2] + P[3 * b + 2] + P[3 * d + 2]) / 3,
        col: 'rgb(' + Math.round(base[0] * k) + ',' + Math.round(base[1] * k) + ',' + Math.round(base[2] * k) + ')' });
    }
    faces.sort(function (p, q) { return q.z - p.z; });
    ctx.lineJoin = 'round';
    ctx.lineWidth = 0.6;
    for (var f = 0; f < faces.length; f++) {
      var tr = T[faces[f].t];
      ctx.beginPath();
      ctx.moveTo(ox + s * P[3 * tr[0]], oy + s * P[3 * tr[0] + 1]);
      ctx.lineTo(ox + s * P[3 * tr[1]], oy + s * P[3 * tr[1] + 1]);
      ctx.lineTo(ox + s * P[3 * tr[2]], oy + s * P[3 * tr[2] + 1]);
      ctx.closePath();
      ctx.fillStyle = faces[f].col;
      ctx.strokeStyle = faces[f].col;
      ctx.fill();
      ctx.stroke();
    }
  }

  // The profile: the front silhouette of the object, bar by bar, with the grooves marked.
  var prof = { x0: 0, w: 1, bars: [] };
  function drawProfile() {
    var c = $('profile');
    var g = fitCanvas(c), ctx = g.ctx;
    ctx.clearRect(0, 0, g.w, g.h);
    if (!cur) return;
    var L = cur.layout, P = L.params;
    var padL = 8, padR = 8, top = 22, bottom = 26;
    var W = g.w - padL - padR, Hh = g.h - top - bottom;
    var total = L.size[0], zmax = L.size[2];
    var sx = W / total, sz = Hh / zmax;
    var X = function (mm) { return padL + mm * sx; };
    var Z = function (mm) { return top + Hh - mm * sz; };
    prof = { X: X, sx: sx, bars: L.bars };
    // ledge silhouette (front terrace outline)
    if (P.ledge) {
      ctx.fillStyle = colours['bar-dim'];
      ctx.fillRect(X(0), Z(B.H.markBase), W, Z(0) - Z(B.H.markBase));
    }
    ctx.fillStyle = colours['bar-dim'];
    ctx.fillRect(X(0), Z(B.H.bodyBase), W, Z(0) - Z(B.H.bodyBase));
    // bars
    ctx.fillStyle = colours.bar;
    L.bars.forEach(function (b, i) {
      if (b.h <= B.H.bodyBase) return;
      ctx.fillRect(X(b.x0), Z(b.h), Math.max(0.5, X(b.x1) - X(b.x0) - (sx * (b.x1 - b.x0) > 3 ? 0.5 : 0)), Z(B.H.bodyBase) - Z(b.h));
    });
    if (cursor >= 0 && cursor < L.bars.length) {
      var cb = L.bars[cursor];
      ctx.fillStyle = colours.ink;
      ctx.globalAlpha = 0.18;
      ctx.fillRect(X(cb.x0), top - 4, Math.max(2, X(cb.x1) - X(cb.x0)), Z(0) - top + 4);
      ctx.globalAlpha = 1;
    }
    // grooves
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    L.marks.forEach(function (m) {
      var x = X((m.x0 + m.x1) / 2);
      ctx.strokeStyle = colours.mark;
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, top - 2); ctx.lineTo(x, Z(0)); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = colours.mark;
      ctx.fillText(m.label, Math.min(g.w - 14, Math.max(14, x)), top - 7);
    });
    // au axis
    ctx.strokeStyle = colours.muted;
    ctx.fillStyle = colours.muted;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(X(0), Z(0) + 0.5); ctx.lineTo(X(total), Z(0) + 0.5); ctx.stroke();
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    var span = P.a1 - P.a0;
    var labelStep = span > 2 ? 0.5 : (span > 0.6 ? 0.1 : (span > 0.25 ? 0.05 : 0.02));
    var pxPerLabel = (labelStep / span) * W;
    if (pxPerLabel < 34) labelStep *= Math.ceil(34 / pxPerLabel);
    var first = Math.ceil(P.a0 / labelStep - 1e-9) * labelStep;
    for (var a = first; a <= P.a1 + 1e-9; a += labelStep) {
      var xa = X(B.MARGIN + (a - P.a0) * L.mmPerAu);
      ctx.beginPath(); ctx.moveTo(xa, Z(0)); ctx.lineTo(xa, Z(0) + 4); ctx.stroke();
      var txt = (Math.round(a * 1000) / 1000).toString();
      ctx.fillText(txt, Math.min(g.w - 12, Math.max(12, xa)), Z(0) + 6);
    }
  }

  function readBar(i) {
    if (!cur) return;
    var L = cur.layout;
    if (i < 0 || i >= L.bars.length) { $('profile-read').textContent = 'Touch or hover a bar to read it.'; return; }
    var b = L.bars[i];
    var n = L.params.count === 'r' ? fmt(b.count, b.count < 100 ? 1 : 0) : fmt(b.count);
    var what = L.params.count === 'r' ? ' asteroids there, on average' : (b.count === 1 ? ' asteroid' : ' asteroids');
    var near = B.MARKS.filter(function (m) { return m.a >= b.a0 && m.a < b.a1; }).map(function (m) { return ' Holds the ' + m.label + ' resonance.'; }).join('');
    $('profile-read').textContent = trimAu(b.a0) + ' to ' + trimAu(b.a1) + ' au: ' + n + what + ', bar ' + (b.h - B.H.bodyBase).toFixed(1) + ' mm tall.' + near;
  }
  function setCursor(i, redraw) {
    cursor = i;
    readBar(i);
    if (redraw !== false) drawProfile();
  }
  function barAt(clientX) {
    var r = $('profile').getBoundingClientRect();
    var x = clientX - r.left;
    if (!prof.bars.length) return -1;
    for (var i = 0; i < prof.bars.length; i++) {
      if (x >= prof.X(prof.bars[i].x0) && x < prof.X(prof.bars[i].x1)) return i;
    }
    return -1;
  }

  // ------------------------------------------------------------ words and tables
  function updateText() {
    var L = cur.layout, P = L.params, f = cur.facts;
    var pop = L.population;
    $('pop-note').textContent = pop.note.charAt(0).toUpperCase() + pop.note.slice(1) + '.';
    $('a0-out').textContent = trimAu(P.a0) + ' au';
    $('a1-out').textContent = trimAu(P.a1) + ' au';
    $('bin-out').textContent = trimAu(P.bin) + ' au = ' + L.binMm.toFixed(2) + ' mm';
    $('length-out').textContent = P.length + ' mm';
    $('relief-out').textContent = P.relief.toFixed(1) + ' mm';
    $('depth-out').textContent = P.depth + ' mm';
    $('profile-scale').textContent = '1 mm = ' + (1 / L.mmPerAu).toPrecision(3) + ' au · ' + P.nb + ' bars';
    var counted = P.count === 'r' ? fmt(L.csum, 0) + ' asteroids, on average, between ' : fmt(L.csum) + ' asteroids with orbits between ';
    var bits = [
      L.size.map(function (v) { return v.toFixed(1).replace(/\.0$/, ''); }).join(' × ') + ' mm',
      fmt(f.triangles) + ' triangles',
      'solid volume ' + (f.volume / 1000).toFixed(2) + ' cm³',
    ];
    var line = bits.join(' · ') + '. ' + counted + trimAu(P.a0) + ' and ' + trimAu(P.a1) + ' au, in ' + P.nb + ' bars of ' + trimAu(P.bin) + ' au.';
    if (L.perMm3 && L.perMm3 >= 1) line += ' Every mm³ of relief stands for about ' + fmt(L.perMm3, L.perMm3 < 10 ? 1 : 0) + ' asteroids.';
    else if (L.perMm3) line += ' Each asteroid is about ' + fmt(1 / L.perMm3, 1 / L.perMm3 < 10 ? 1 : 0) + ' mm³ of relief.';
    $('readout').textContent = line;
    var notes = P.notes.slice();
    L.skipped.forEach(function (s) { notes.push('No groove for ' + s.label + ': it would crowd the ' + s.because + ' groove at this length.'); });
    if (L.fins) notes.push(L.fins + ' bar' + (L.fins === 1 ? ' stands' : 's stand') + ' 8 mm or more above both neighbours while under 2 mm wide. Such fins can wobble or snap; wider bins, the square-root scale or a lower relief make them sturdier.');
    if (L.cmax === 0) notes.push('None of ' + pop.short + ' ' + (P.count === 'r' ? 'is ever this far out' : 'has an orbit in this stretch') + ': the ruler comes out flat.');
    if (!f.closedAndOriented) notes.push('This shape did not close up: please report the settings. Download is off.');
    var ul = $('notes');
    ul.textContent = '';
    notes.forEach(function (n) { var li = document.createElement('li'); li.textContent = n; ul.appendChild(li); });
    $('download').disabled = !f.closedAndOriented;

    // the grooves table
    var fine = B.fineCounts(pop, P.count);
    var tb = document.querySelector('#marks-table tbody');
    tb.textContent = '';
    var inRange = B.MARKS.filter(function (m) { return m.a >= P.a0 && m.a <= P.a1; });
    var list = inRange.length ? inRange : B.MARKS;
    list.slice().sort(function (x, y) { return x.a - y.a; }).forEach(function (m) {
      var e = B.emptiness(fine, m.a);
      var tr = document.createElement('tr');
      var yr = B.periodYears(m.a);
      var cells = [
        m.label + (m.kind === 'group' ? ' <span class="tag">' + m.group + '</span>' : ''),
        m.a.toFixed(3) + ' au',
        yr.toFixed(2) + ' yr: ' + m.p + ' laps per ' + (m.q === 1 ? 'Jupiter year' : m.q + ' of Jupiter’s'),
        P.count === 'r' ? fmt(e.count, 0) + ' on average' : fmt(e.count),
        e.ratio === null ? 'none nearby either' : (Math.round(e.ratio * 100) + '% of the level around it'),
      ];
      var heads = ['Groove', 'Orbit size', 'Its year', 'In the 0.005 au there', 'Compared with its neighbours'];
      cells.forEach(function (h, k) {
        var td = document.createElement('td');
        td.setAttribute('data-label', heads[k]);
        if (k === 0) td.innerHTML = h; else td.textContent = h;
        if (k > 0 && k < 4) td.className = 'num';
        tr.appendChild(td);
      });
      if (!inRange.length) tr.style.opacity = '0.6';
      tb.appendChild(tr);
    });
    var intro = 'Counting ' + pop.short + (P.count === 'r' ? ' by where they are, averaged over their orbits' : ' by the size of their orbits') + '. ';
    intro += inRange.length ? 'The ledge of this ruler carries ' + L.marks.length + ' groove' + (L.marks.length === 1 ? '' : 's') + '.' : 'None of the marked resonances falls in this stretch; the table shows them all for reference.';
    $('finds-intro').textContent = intro;

    var ol = $('finder-list');
    ol.textContent = '';
    var found = B.findNotches(fine, P.a0, P.a1, 4);
    if (!found.length) {
      var li = document.createElement('li');
      li.textContent = 'It finds no notch here: no slice in this stretch falls below the belt around it.';
      ol.appendChild(li);
    }
    found.forEach(function (n) {
      var li = document.createElement('li');
      var off = Math.abs(n.offset);
      var sd = n.sigma >= 10 ? Math.round(n.sigma) : n.sigma.toFixed(1);
      li.textContent = trimAu(n.a) + ' au: ' + Math.round(n.depth * 100) + '% below its surroundings, ' + sd + ' standard deviations' +
        (n.sigma < 5 ? ' (could be chance)' : '') + '. Nearest resonance: ' + n.nearest.label + ' at ' + n.nearest.a.toFixed(4) + ' au, ' + off.toFixed(4) + ' au away.';
      ol.appendChild(li);
    });
  }

  function syncControls() {
    var P = cur.layout.params;
    $('pop').value = P.pop;
    ['a0', 'a1', 'bin', 'length', 'relief', 'depth'].forEach(function (k) {
      var el = $(k);
      if (document.activeElement !== el || dragging !== k) el.value = String(P[k]);
    });
    $('ledge').checked = P.ledge;
    document.querySelectorAll('input[name="scale"]').forEach(function (r) { r.checked = r.value === P.scale; });
    document.querySelectorAll('input[name="count"]').forEach(function (r) { r.checked = r.value === P.count; });
    document.querySelectorAll('.preset-buttons button').forEach(function (b) {
      var s = JSON.parse(b.dataset.set);
      var same = Object.keys(s).every(function (k) {
        return typeof s[k] === 'number' ? Math.abs(s[k] - P[k]) < 1e-9 : s[k] === P[k];
      });
      b.setAttribute('aria-pressed', same ? 'true' : 'false');
    });
  }

  // ------------------------------------------------------------ the loop
  var pending = false, dragging = null;
  function update() {
    pending = false;
    var m = B.model(state);
    cur = { layout: m.layout, mesh: m.mesh, facts: B.meshFacts(m.mesh) };
    if (cursor >= cur.layout.bars.length) cursor = -1;
    syncControls();
    updateText();
    draw3d();
    drawProfile();
    readBar(cursor);
  }
  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(update);
  }
  // Switches (radios, the population menu, presets, the ledge box, reset) can be flipped as fast as
  // a held key repeats, and each flip can swap the whole picture. Show at most one such change every
  // 350 ms, so the page never alternates faster than about three times a second; the last one wins.
  var lastSwitch = -1e9, switchTimer = null;
  function scheduleSwitch() {
    if (switchTimer) return;
    var wait = lastSwitch + 350 - performance.now();
    var go = function () { switchTimer = null; lastSwitch = performance.now(); schedule(); };
    if (wait <= 0) go();
    else switchTimer = setTimeout(go, wait);
  }

  // ------------------------------------------------------------ wiring
  function wire() {
    readColours();
    var presets = JSON.parse($('presets').dataset.presets);
    var box = document.querySelector('.preset-buttons');
    presets.forEach(function (p) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = p.name;
      b.dataset.set = JSON.stringify(p.set);
      b.addEventListener('click', function () { state = Object.assign({}, B.DEFAULTS, p.set); cursor = -1; scheduleSwitch(); });
      box.appendChild(b);
    });
    $('pop').addEventListener('change', function () { state.pop = this.value; scheduleSwitch(); });
    ['a0', 'a1', 'bin', 'length', 'relief', 'depth'].forEach(function (k) {
      var el = $(k);
      el.addEventListener('input', function () { dragging = k; state[k] = Number(el.value); schedule(); });
      el.addEventListener('change', function () { dragging = null; state[k] = Number(el.value); schedule(); });
    });
    // after a drag, adopt the cleaned-up values so the next change starts from them
    document.addEventListener('pointerup', function () { if (dragging) { dragging = null; adopt(); } });
    $('ledge').addEventListener('change', function () { state.ledge = this.checked; scheduleSwitch(); });
    document.querySelectorAll('input[name="scale"]').forEach(function (r) {
      r.addEventListener('change', function () { if (r.checked) { state.scale = r.value; scheduleSwitch(); } });
    });
    document.querySelectorAll('input[name="count"]').forEach(function (r) {
      r.addEventListener('change', function () { if (r.checked) { state.count = r.value; scheduleSwitch(); } });
    });
    $('reset').addEventListener('click', function () { state = Object.assign({}, B.DEFAULTS); view = Object.assign({}, VIEWS.three); cursor = -1; scheduleSwitch(); });
    $('download').addEventListener('click', function () {
      if (!cur || !cur.facts.closedAndOriented) return;
      var bytes = B.stl(cur.mesh);
      var blob = new Blob([bytes], { type: 'model/stl' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = B.fileName(cur.layout.params);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    });
    $('controls').addEventListener('submit', function (e) { e.preventDefault(); });

    // turning the 3D view
    var c3 = $('view3d');
    var drag = null;
    c3.addEventListener('pointerdown', function (e) {
      drag = { x: e.clientX, y: e.clientY, yaw: view.yaw, pitch: view.pitch, type: e.pointerType };
      try { c3.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
    });
    c3.addEventListener('pointermove', function (e) {
      if (!drag) return;
      view.yaw = drag.yaw + (e.clientX - drag.x) * 0.01;
      if (drag.type === 'mouse') view.pitch = clampPitch(drag.pitch + (e.clientY - drag.y) * 0.01);
      draw3d();
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (ev) { c3.addEventListener(ev, function () { drag = null; }); });
    c3.addEventListener('keydown', function (e) {
      var step = e.shiftKey ? 0.3 : 0.1;
      if (e.key === 'ArrowLeft') view.yaw -= step;
      else if (e.key === 'ArrowRight') view.yaw += step;
      else if (e.key === 'ArrowUp') view.pitch = clampPitch(view.pitch + step);
      else if (e.key === 'ArrowDown') view.pitch = clampPitch(view.pitch - step);
      else return;
      e.preventDefault();
      draw3d();
    });
    document.querySelectorAll('[data-view]').forEach(function (b) {
      b.addEventListener('click', function () { view = Object.assign({}, VIEWS[b.dataset.view]); scheduleSwitch(); });
    });

    // reading the profile
    var cp = $('profile');
    cp.addEventListener('pointermove', function (e) { var i = barAt(e.clientX); if (i !== cursor) setCursor(i); });
    cp.addEventListener('pointerdown', function (e) { setCursor(barAt(e.clientX)); });
    cp.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') setCursor(-1); });
    cp.addEventListener('keydown', function (e) {
      if (!cur) return;
      var n = cur.layout.bars.length, i = cursor;
      if (e.key === 'ArrowRight') i = i < 0 ? 0 : Math.min(n - 1, i + (e.shiftKey ? 10 : 1));
      else if (e.key === 'ArrowLeft') i = i < 0 ? n - 1 : Math.max(0, i - (e.shiftKey ? 10 : 1));
      else if (e.key === 'Home') i = 0;
      else if (e.key === 'End') i = n - 1;
      else if (e.key === 'Escape') i = -1;
      else return;
      e.preventDefault();
      setCursor(i);
    });
    cp.addEventListener('focus', function () { if (cursor < 0 && cur) setCursor(0); });

    var resizeTimer = null;
    window.addEventListener('resize', function () {
      if (resizeTimer) cancelAnimationFrame(resizeTimer);
      resizeTimer = requestAnimationFrame(function () { draw3d(); drawProfile(); });
    });
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var onScheme = function () { readColours(); draw3d(); drawProfile(); };
      if (mq.addEventListener) mq.addEventListener('change', onScheme);
    }
  }
  function clampPitch(p) { return Math.max(-0.2, Math.min(1.55, p)); }
  function adopt() {
    if (!cur) return;
    var P = cur.layout.params;
    ['a0', 'a1', 'bin', 'length', 'relief', 'depth'].forEach(function (k) { state[k] = P[k]; });
    schedule();
  }

  wire();
  update();
})();
