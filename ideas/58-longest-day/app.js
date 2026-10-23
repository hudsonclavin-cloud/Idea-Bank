/* The Longest Day of Your Life: drawing and interaction. All numbers come from LODCore.analyse(). */
(function () {
  'use strict';
  var C = window.LODCore;
  var A = C.analyse(window.LOD_DATA, window.ONI_DATA, window.LEAP_DATA);
  var L = A.L;
  var LAST = L.mjd0 + L.n - 1;
  var SVGNS = 'http://www.w3.org/2000/svg';
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var state = { you: null, carpet: 'raw', fcStart: null, playhead: null };

  // ---------------------------------------------------------------------------------------------
  // Formatting
  var MINUS = '−';
  function num(v, dp) {
    var s = Math.abs(v).toFixed(dp);
    var parts = s.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (v < 0 && Number(s) !== 0 ? MINUS : '') + parts.join('.');
  }
  function signed(v, dp) { return (v > 0 && Number(v.toFixed(dp)) !== 0 ? '+' : '') + num(v, dp); }
  function longDate(iso) { var p = iso.split('-'); return +p[2] + ' ' + MONTHS[+p[1] - 1] + ' ' + p[0]; }
  function shortDate(iso) { var p = iso.split('-'); return +p[2] + ' ' + MON3[+p[1] - 1] + ' ' + p[0]; }
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  // ---------------------------------------------------------------------------------------------
  // Tiny SVG kit
  function s(tag, attrs, parent) {
    var e = document.createElementNS(SVGNS, tag);
    if (attrs) for (var k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function text(parent, x, y, str, cls, anchor) {
    var t = s('text', { x: x, y: y, 'class': cls || null, 'text-anchor': anchor || null }, parent);
    t.textContent = str;
    return t;
  }
  function lin(d0, d1, r0, r1) {
    var f = function (v) { return r0 + (v - d0) * (r1 - r0) / (d1 - d0); };
    f.inv = function (p) { return d0 + (p - r0) * (d1 - d0) / (r1 - r0); };
    return f;
  }
  function ticks(lo, hi, want) {
    var span = hi - lo, step = Math.pow(10, Math.floor(Math.log10(span / want)));
    var err = span / want / step;
    if (err >= 7.5) step *= 10; else if (err >= 3.5) step *= 5; else if (err >= 1.5) step *= 2;
    var out = [];
    for (var v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
    return out;
  }
  function frame(host, w, h) {
    host.textContent = '';
    var svg = s('svg', { viewBox: '0 0 ' + w + ' ' + h, width: w, height: h, focusable: 'false' }, host);
    return svg;
  }
  function yGrid(svg, y, vals, x0, x1, fmt) {
    var g = s('g', { 'class': 'grid' }, svg);
    vals.forEach(function (v) {
      s('line', { x1: x0, x2: x1, y1: y(v), y2: y(v) }, g);
      text(svg, x0 - 6, y(v) + 3.5, fmt(v), null, 'end');
    });
  }
  function mjdOfYear(y) { return C.mjdFromISO(y + '-01-01'); }
  function yearTicks(svg, x, y0, from, to, every) {
    for (var yr = Math.ceil(from / every) * every; yr <= to; yr += every) {
      var px = x(mjdOfYear(yr));
      s('line', { x1: px, x2: px, y1: y0, y2: y0 + 4, 'class': 'axisline' }, svg);
      text(svg, px, y0 + 16, String(yr), null, 'middle');
    }
  }
  function pathFrom(points) {
    var d = '', pen = false;
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      if (!p || !isFinite(p[1])) { pen = false; continue; }
      d += (pen ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1);
      pen = true;
    }
    return d;
  }

  // Tooltip: textContent only
  var tip = document.getElementById('tip');
  function showTip(clientX, clientY, title, lines) {
    tip.textContent = '';
    var st = document.createElement('strong');
    st.textContent = title;
    tip.appendChild(st);
    (lines || []).forEach(function (ln) {
      var d = document.createElement('div');
      if (ln.k) { var k = document.createElement('span'); k.className = 'k'; k.textContent = ln.k + ' '; d.appendChild(k); }
      d.appendChild(document.createTextNode(ln.v));
      tip.appendChild(d);
    });
    tip.hidden = false;
    var r = tip.getBoundingClientRect(), vw = document.documentElement.clientWidth;
    var x = clientX + 14, yv = clientY - r.height - 12;
    if (x + r.width > vw - 8) x = clientX - r.width - 14;
    if (x < 8) x = 8;
    if (yv < 8) yv = clientY + 18;
    tip.style.left = x + 'px';
    tip.style.top = yv + 'px';
  }
  var crosses = [];
  function hideTip() { tip.hidden = true; }
  function clearHover() {
    hideTip();
    crosses = crosses.filter(function (c) { return c.isConnected; });
    crosses.forEach(function (c) { c.setAttribute('visibility', 'hidden'); });
  }

  /** Attach crosshair-style hover to an SVG chart. onMove(svgX) returns {x, title, lines} or null. */
  function hover(svg, x0, x1, y0, y1, onMove) {
    var cross = s('line', { 'class': 'cross', y1: y0, y2: y1, x1: x0, x2: x0, visibility: 'hidden' }, svg);
    var hit = s('rect', { 'class': 'hit', x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) }, svg);
    function at(ev) {
      var pt = svg.getBoundingClientRect();
      var vb = svg.viewBox.baseVal;
      var sx = (ev.clientX - pt.left) * vb.width / pt.width;
      var r = onMove(Math.max(x0, Math.min(x1, sx)));
      if (!r) { cross.setAttribute('visibility', 'hidden'); hideTip(); return; }
      cross.setAttribute('x1', r.x); cross.setAttribute('x2', r.x); cross.setAttribute('visibility', 'visible');
      showTip(ev.clientX, ev.clientY, r.title, r.lines);
    }
    function leave(ev) {
      if (ev && ev.pointerType === 'touch') return;
      cross.setAttribute('visibility', 'hidden'); hideTip();
      Array.prototype.forEach.call(svg.querySelectorAll('.bar.on'), function (e) { e.classList.remove('on'); });
    }
    crosses.push(cross);
    hit.addEventListener('pointermove', at);
    hit.addEventListener('pointerdown', at);
    hit.addEventListener('pointerleave', leave);
    return cross;
  }

  function widthOf(host) { return Math.max(280, Math.floor(host.getBoundingClientRect().width)); }
  function isNarrow(w) { return w < 520; }

  // ---------------------------------------------------------------------------------------------
  // Fig 1: the record
  function drawRecord() {
    var host = document.querySelector('[data-chart="record"]');
    var W = widthOf(host), H = Math.round(Math.max(230, Math.min(340, W * 0.4)));
    var m = { l: 34, r: 10, t: 16, b: 26 };
    var svg = frame(host, W, H);
    var x = lin(L.mjd0, LAST, m.l, W - m.r), y = lin(-2, 4.5, H - m.b, m.t);
    yGrid(svg, y, [-1, 0, 1, 2, 3, 4], m.l, W - m.r, function (v) { return (v > 0 ? '+' : '') + num(v, 0); });
    s('line', { x1: m.l, x2: W - m.r, y1: y(0), y2: y(0), 'class': 'zero' }, svg);
    text(svg, m.l + 6, y(0) + 14, 'exactly 86,400 s', 'lab', 'start');
    text(svg, m.l - 6, m.t - 5, 'ms', null, 'end');
    yearTicks(svg, x, H - m.b, 1975, 2026, isNarrow(W) ? 10 : 5);
    if (state.you !== null) {
      var yx = x(Math.max(L.mjd0, state.you));
      s('rect', { x: yx, y: m.t, width: Math.max(0, W - m.r - yx), height: H - m.t - m.b, 'class': 'you' }, svg);
      s('line', { x1: yx, x2: yx, y1: m.t, y2: H - m.b, 'class': 'you-line' }, svg);
    }
    // min/max per pixel column, in time order
    var pts = [], cols = Math.round(W - m.l - m.r), per = L.n / cols;
    for (var c = 0; c < cols; c++) {
      var a = Math.floor(c * per), b = Math.min(L.n, Math.floor((c + 1) * per)), lo = a, hi = a;
      for (var i = a; i < b; i++) { if (L.lod[i] < L.lod[lo]) lo = i; if (L.lod[i] > L.lod[hi]) hi = i; }
      var first = Math.min(lo, hi), second = Math.max(lo, hi);
      pts.push([x(L.mjd0 + first), y(L.lod[first])], [x(L.mjd0 + second), y(L.lod[second])]);
    }
    s('path', { d: pathFrom(pts), 'class': 'series thin' }, svg);
    var R = A.record, narrow = isNarrow(W);
    function mark(iso, v, label, anchor, dy) {
      var px = x(C.mjdFromISO(iso)), py = y(v);
      s('circle', { cx: px, cy: py, r: 4, 'class': 'mark ink' }, svg);
      var t = text(svg, px + (anchor === 'end' ? -8 : 8), py + dy, label, 'lab-strong', anchor);
      t.setAttribute('paint-order', 'stroke');
      t.setAttribute('stroke', cssVar('--surface'));
      t.setAttribute('stroke-width', '3');
    }
    mark(R.maxISO, R.max, narrow ? 'longest' : 'longest: ' + shortDate(R.maxISO), 'start', 4);
    mark(R.minISO, R.min, narrow ? 'shortest' : 'shortest: ' + shortDate(R.minISO), 'end', 4);
    if (!narrow) mark(R.zeroISO[0], 0, 'exactly a day: ' + shortDate(R.zeroISO[0]), 'end', -9);
    if (state.playhead !== null) {
      var phx = x(state.playhead);
      s('line', { x1: phx, x2: phx, y1: m.t, y2: H - m.b, 'class': 'you-line', id: 'playhead' }, svg);
    }
    hover(svg, m.l, W - m.r, m.t, H - m.b, function (sx) {
      var i = Math.round(x.inv(sx) - L.mjd0);
      i = Math.max(0, Math.min(L.n - 1, i));
      var iso = C.isoFromMJD(L.mjd0 + i);
      return { x: x(L.mjd0 + i), title: longDate(iso), lines: [
        { v: signed(L.lod[i], 4) + ' ms  ± ' + num(L.err[i], 4) },
        { k: 'lasted', v: num(86400 + L.lod[i] / 1000, 7) + ' s' }
      ] };
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Colour: OKLab interpolation for the diverging carpet scale
  function hexToRgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
  }
  function toLin(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function fromLin(c) { return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; }
  function rgbToOklab(rgb) {
    var r = toLin(rgb[0]), g = toLin(rgb[1]), b = toLin(rgb[2]);
    var l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    var m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    var q = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * q, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * q, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * q];
  }
  function oklabToRgb(o) {
    var l = Math.pow(o[0] + 0.3963377774 * o[1] + 0.2158037573 * o[2], 3);
    var m = Math.pow(o[0] - 0.1055613458 * o[1] - 0.0638541728 * o[2], 3);
    var q = Math.pow(o[0] - 0.0894841775 * o[1] - 1.2914855480 * o[2], 3);
    var r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * q;
    var g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * q;
    var b = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * q;
    return [r, g, b].map(function (c) { return Math.round(255 * Math.max(0, Math.min(1, fromLin(c)))); });
  }
  function divergingLUT() {
    var neg = rgbToOklab(hexToRgb(cssVar('--div-neg'))), mid = rgbToOklab(hexToRgb(cssVar('--div-mid'))), pos = rgbToOklab(hexToRgb(cssVar('--div-pos')));
    var lut = [];
    for (var k = 0; k < 256; k++) {
      var t = k / 255 * 2 - 1, from = t < 0 ? neg : pos, u = Math.abs(t);
      lut.push(oklabToRgb([mid[0] + (from[0] - mid[0]) * u, mid[1] + (from[1] - mid[1]) * u, mid[2] + (from[2] - mid[2]) * u]));
    }
    return lut;
  }

  // ---------------------------------------------------------------------------------------------
  // Fig 2: carpet
  function drawCarpet() {
    var host = document.querySelector('[data-chart="carpet"]');
    var W = widthOf(host), narrow = isNarrow(W);
    var gut = 34, top = 16, rowH = narrow ? 4 : 6;
    var y0 = C.ymdFromMJD(L.mjd0).y, y1 = C.ymdFromMJD(LAST).y, rows = y1 - y0 + 1;
    var H = top + rows * rowH + 4;
    host.textContent = '';
    var cv = document.createElement('canvas');
    var dpr = Math.min(3, window.devicePixelRatio || 1);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cv.style.height = H + 'px';
    host.appendChild(cv);
    var ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);
    var cellW = (W - gut) / 366;
    var lut = divergingLUT(), lim = state.carpet === 'raw' ? 3 : 1.2;
    var series = state.carpet === 'raw' ? L.lod : A.hp;
    var img = ctx.createImageData(Math.round((W - gut) * dpr), Math.round(rows * rowH * dpr));
    var iw = img.width, ih = img.height, bg = hexToRgb(cssVar('--surface')).map(function (c) { return Math.round(c * 255); });
    for (var p = 0; p < iw * ih; p++) { img.data[p * 4] = bg[0]; img.data[p * 4 + 1] = bg[1]; img.data[p * 4 + 2] = bg[2]; img.data[p * 4 + 3] = 255; }
    for (var i = 0; i < L.n; i++) {
      var v = series[i];
      if (!isFinite(v)) continue;
      var mj = L.mjd0 + i, ymd = C.ymdFromMJD(mj), doy = C.dayOfYear(mj) - 1, row = ymd.y - y0;
      var k = Math.round((Math.max(-lim, Math.min(lim, v)) / lim + 1) / 2 * 255), col = lut[k];
      var px0 = Math.floor(doy * cellW * dpr), px1 = Math.max(px0 + 1, Math.floor((doy + 1) * cellW * dpr));
      var py0 = Math.floor(row * rowH * dpr), py1 = Math.floor((row + 1) * rowH * dpr) - (rowH >= 6 ? Math.round(dpr) : 0);
      for (var yy = py0; yy < py1; yy++) for (var xx = px0; xx < px1 && xx < iw; xx++) {
        var o = (yy * iw + xx) * 4;
        img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2];
      }
    }
    ctx.putImageData(img, Math.round(gut * dpr), Math.round(top * dpr));
    ctx.fillStyle = cssVar('--axis-text');
    ctx.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (var yr = y0; yr <= y1; yr++) {
      if (yr % 10 === 0 || yr === y0) ctx.fillText(String(yr), gut - 5, top + (yr - y0 + 0.5) * rowH);
    }
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    var monthStarts = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    var initials = 'JFMAMJJASOND';
    monthStarts.forEach(function (d0, q) { ctx.fillText(narrow ? initials[q] : MON3[q], gut + d0 * cellW + 1, top - 5); });
    if (state.you !== null && state.you >= L.mjd0) {
      var ym = C.ymdFromMJD(state.you), dy = C.dayOfYear(state.you) - 1;
      var cx = gut + (dy + 0.5) * cellW, cy = top + (ym.y - y0 + 0.5) * rowH;
      ctx.strokeStyle = cssVar('--ink'); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(cx, cy, Math.max(5, rowH), 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(gut - 3, cy); ctx.lineTo(gut - 1, cy); ctx.stroke();
    }
    cv.addEventListener('pointermove', carpetTip);
    cv.addEventListener('pointerdown', carpetTip);
    cv.addEventListener('pointerleave', function (ev) { if (ev.pointerType !== 'touch') hideTip(); });
    function carpetTip(ev) {
      var r = cv.getBoundingClientRect();
      var px = ev.clientX - r.left, py = ev.clientY - r.top;
      var row = Math.floor((py - top) / rowH), d = Math.floor((px - gut) / cellW);
      if (row < 0 || row >= rows || d < 0 || d > 365) { hideTip(); return; }
      var mj = C.mjdFromISO((y0 + row) + '-01-01') + d;
      if (C.ymdFromMJD(mj).y !== y0 + row || mj < L.mjd0 || mj > LAST) { hideTip(); return; }
      var idx = mj - L.mjd0, v = series[idx];
      var lines = [{ k: 'measured', v: signed(L.lod[idx], 3) + ' ms' }];
      if (isFinite(A.hp[idx])) lines.push({ k: 'vs its 365-day average', v: signed(A.hp[idx], 3) + ' ms' });
      if (!isFinite(v)) lines.push({ v: '(no 365-day average this close to the ends)' });
      showTip(ev.clientX, ev.clientY, longDate(C.isoFromMJD(mj)), lines);
    }
    var sc = document.getElementById('carpet-scale');
    sc.textContent = '';
    var lo = document.createElement('span'); lo.textContent = (state.carpet === 'raw' ? '≤ ' : '≤ ') + MINUS + lim + ' ms';
    var bar = document.createElement('span'); bar.className = 'bar-grad';
    bar.style.background = 'linear-gradient(90deg,' + [0, 64, 128, 191, 255].map(function (k2) { return 'rgb(' + lut[k2].join(',') + ')'; }).join(',') + ')';
    var hi = document.createElement('span'); hi.textContent = '≥ +' + lim + ' ms';
    sc.appendChild(lo); sc.appendChild(bar); sc.appendChild(hi);
  }

  // ---------------------------------------------------------------------------------------------
  // Fig 3: spectrum
  function drawSpectrum() {
    var host = document.querySelector('[data-chart="spectrum"]');
    var W = widthOf(host), H = Math.round(Math.max(240, Math.min(330, W * 0.38))), narrow = isNarrow(W);
    var m = { l: 34, r: 10, t: 24, b: 30 };
    var svg = frame(host, W, H);
    var pLo = 5, pHi = 400;
    var x = function (P) { return m.l + (Math.log(P) - Math.log(pLo)) / (Math.log(pHi) - Math.log(pLo)) * (W - m.l - m.r); };
    x.inv = function (px) { return Math.exp(Math.log(pLo) + (px - m.l) / (W - m.l - m.r) * (Math.log(pHi) - Math.log(pLo))); };
    var sp = A.spec, bg = A.lineTests.Mf.background;
    var pmax = 0;
    for (var jj = Math.floor(sp.N / pHi); jj <= Math.ceil(sp.N / pLo); jj++) pmax = Math.max(pmax, sp.power[jj]);
    var y = lin(-1.5, Math.log10(pmax / bg) + 0.35, H - m.b, m.t); // log10(power / background near Mf)
    yGrid(svg, y, [0, 2, 4], m.l, W - m.r, function (v) { return v === 0 ? '1×' : v === 2 ? '100×' : '10⁴×'; });
    [5, 7, 10, 14, 20, 30, 50, 100, 200, 365].forEach(function (P) {
      if (narrow && (P === 7 || P === 14 || P === 50)) return;
      s('line', { x1: x(P), x2: x(P), y1: H - m.b, y2: H - m.b + 4, 'class': 'axisline' }, svg);
      text(svg, x(P), H - m.b + 16, String(P), null, 'middle');
    });
    text(svg, W - m.r, H - 2, 'period, days (log scale)', null, 'end');
    var cols = Math.round(W - m.l - m.r), pts = [];
    for (var c = 0; c <= cols; c++) {
      var pA = x.inv(m.l + c - 0.5), pB = x.inv(m.l + c + 0.5);
      var j0 = Math.ceil(1 / pB * sp.N), j1 = Math.floor(1 / pA * sp.N), best = 0;
      if (j1 < j0) j1 = j0;
      for (var j = j0; j <= j1 && j < sp.power.length; j++) if (sp.power[j] > best) best = sp.power[j];
      pts.push([m.l + c, y(Math.log10(Math.max(best, 1e-12) / bg))]);
    }
    s('path', { d: pathFrom(pts) + 'L' + (W - m.r) + ',' + (H - m.b) + 'L' + m.l + ',' + (H - m.b) + 'Z', 'class': 'wash' }, svg);
    s('path', { d: pathFrom(pts), 'class': 'series thin' }, svg);
    var labs = narrow
      ? [['Mtm', '9.13'], ['Mf', '13.66'], ['MSf', '14.77'], ['Mm', '27.55'], ['MSm', '31.81'], ['Ssa', '½ yr'], ['Sa', '1 yr']]
      : [['Mtm', '9.13 d'], ['Mf', '13.66 d'], ['MSf', '14.77 d'], ['Mm', '27.55 d'], ['MSm', '31.81 d'], ['Ssa', 'half year'], ['Sa', 'year']];
    labs.forEach(function (lb) {
      var ln = C.line(lb[0]), P = 1 / ln.f, j = Math.round(ln.f * sp.N);
      var pk = 0;
      for (var q = j - 3; q <= j + 3; q++) if (sp.power[q] > pk) pk = sp.power[q];
      var py = Math.max(m.t + 2, y(Math.log10(pk / bg)) - 6);
      var anchor = lb[0] === 'MSf' || lb[0] === 'MSm' ? 'start' : lb[0] === 'Mf' ? 'end' : 'middle';
      var dx = anchor === 'start' ? 3 : anchor === 'end' ? -3 : 0;
      var t = text(svg, x(P) + dx, py, lb[1], 'lab-strong', anchor);
      t.setAttribute('paint-order', 'stroke'); t.setAttribute('stroke', cssVar('--surface')); t.setAttribute('stroke-width', '3');
    });
    // the Moon's phases: nothing
    var Psyn = A.months.synodic, jS = Math.round(sp.N / Psyn);
    var gy = y(Math.log10(Math.max(sp.power[jS], 1e-12) / bg));
    s('circle', { cx: x(Psyn), cy: gy, r: 4.5, 'class': 'mark hollow' }, svg);
    var gl = text(svg, x(Psyn) + 7, Math.min(H - m.b - 6, gy + 16), narrow ? 'phases: nothing' : '29.53 d, the phases: nothing', 'lab', 'start');
    gl.setAttribute('paint-order', 'stroke'); gl.setAttribute('stroke', cssVar('--surface')); gl.setAttribute('stroke-width', '3');
    hover(svg, m.l, W - m.r, m.t, H - m.b, function (sx) {
      var P = x.inv(sx), j = Math.round(sp.N / P);
      var near = null;
      A.months && C.LINES.forEach(function (ln) { if (Math.abs(Math.log(P * ln.f)) < 0.02) near = ln; });
      var lines = [{ k: 'power', v: num(sp.power[j] / bg, sp.power[j] / bg < 10 ? 2 : 0) + '× the background near 13.7 d' }];
      if (near) lines.push({ k: near.id, v: near.label + ' (' + num(1 / near.f, 3) + ' d)' });
      return { x: sx, title: num(P, P < 20 ? 2 : 1) + ' days', lines: lines };
    });
    var tb = document.querySelector('#tbl-lines tbody');
    if (!tb.childElementCount) {
      C.LINES.forEach(function (ln) {
        var lt = A.lineTests[ln.id], tr = document.createElement('tr');
        var la = A.lineTestsAll[ln.id];
        [ln.id + ' · ' + ln.label, num(1 / ln.f, 4), num(lt.peakPeriod, 4), ln.lunar ? num(lt.ratio, lt.ratio < 100 ? 1 : 0) + '×' : '(see note)', ln.lunar ? num(la.ratio, la.ratio < 100 ? 1 : 0) + '×' : '—', num(A.ampsM[ln.id], 3)].forEach(function (v) {
          var td = document.createElement('td'); td.textContent = v; tr.appendChild(td);
        });
        tb.appendChild(tr);
      });
      [['synodic month (phases)', A.months.synodic, A.controls.synodic, A.controlsAll.synodic], ['tropical month', A.months.tropical, A.controls.tropical, A.controlsAll.tropical], ['draconic month', A.months.draconic, A.controls.draconic, A.controlsAll.draconic]].forEach(function (r) {
        var tr = document.createElement('tr');
        [r[0], num(r[1], 4), '—', num(r[2].ratio, 2) + '×', num(r[3].ratio, 2) + '×', '—'].forEach(function (v) { var td = document.createElement('td'); td.textContent = v; tr.appendChild(td); });
        tb.appendChild(tr);
      });
      var tr2 = document.createElement('tr'), td2 = document.createElement('td');
      td2.colSpan = 6; td2.className = 'muted';
      td2.textContent = 'Measured peaks, ratios and sizes use ' + A.measuredYear + '–' + A.record.lastISO.slice(0, 4) + ', the stretch where the smoothing is light. The whole-record column is longer (' + num(A.specAll.n, 0) + ' days against ' + num(A.spec.n, 0) + '), which by itself raises the ratio of each lunar line in proportion to the length: a steady line\u2019s power grows with the square of the number of days, the background beside it only in proportion. The three control rows have no line, so the length does not raise them; they only move by chance. The column also adds 1973–' + (A.measuredYear - 1) + ', where the short-period detail is largely the producers\u2019 tide model. Seasonal lines: the 365-day filter leaves too few clean neighbouring frequencies for a fair background, so no ratio is quoted. Sizes are amplitudes of the fitted sine waves.';
      tr2.appendChild(td2); tb.appendChild(tr2);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Fig 4: forecast
  var FC_DAYS = 120;
  function drawForecast() {
    var host = document.querySelector('[data-chart="forecast"]');
    var W = widthOf(host), H = Math.round(Math.max(200, Math.min(280, W * 0.32)));
    var m = { l: 34, r: 10, t: 12, b: 26 };
    var svg = frame(host, W, H);
    var o = A.oos, maxStart = o.mjd.length - FC_DAYS;
    if (state.fcStart === null) state.fcStart = maxStart;
    var a = Math.max(0, Math.min(maxStart, state.fcStart)), b = a + FC_DAYS - 1;
    var x = lin(o.mjd[a], o.mjd[b], m.l, W - m.r), y = lin(-1.3, 1.3, H - m.b, m.t);
    yGrid(svg, y, [-1, 0, 1], m.l, W - m.r, function (v) { return (v > 0 ? '+' : '') + num(v, 0); });
    text(svg, m.l - 6, m.t - 2, 'ms', null, 'end');
    for (var i = a; i <= b; i++) {
      var iso = C.isoFromMJD(o.mjd[i]);
      if (iso.slice(8) === '01') {
        var px = x(o.mjd[i]);
        s('line', { x1: px, x2: px, y1: H - m.b, y2: H - m.b + 4, 'class': 'axisline' }, svg);
        text(svg, px, H - m.b + 16, MON3[+iso.slice(5, 7) - 1] + (iso.slice(5, 7) === '01' ? ' ' + iso.slice(0, 4) : ''), null, 'middle');
      }
    }
    var dPts = [], mPts = [];
    for (i = a; i <= b; i++) { dPts.push([x(o.mjd[i]), y(o.target[i])]); mPts.push([x(o.mjd[i]), y(o.pred[i])]); }
    s('path', { d: pathFrom(dPts), 'class': 'series' }, svg);
    s('path', { d: pathFrom(mPts), 'class': 'series model' }, svg);
    hover(svg, m.l, W - m.r, m.t, H - m.b, function (sx) {
      var k = Math.round(x.inv(sx) - o.mjd[a]) + a;
      k = Math.max(a, Math.min(b, k));
      return { x: x(o.mjd[k]), title: longDate(C.isoFromMJD(o.mjd[k])), lines: [
        { k: 'measured', v: signed(o.target[k], 3) + ' ms' }, { k: 'Moon forecast', v: signed(o.pred[k], 3) + ' ms' }
      ] };
    });
    var sl = document.getElementById('fc-slider');
    sl.max = String(maxStart);
    sl.value = String(a);
    document.getElementById('fc-out').textContent = shortDate(C.isoFromMJD(o.mjd[a])) + ' – ' + shortDate(C.isoFromMJD(o.mjd[b]));
  }

  // ---------------------------------------------------------------------------------------------
  // Fig 5: the ripple's size by year
  function roundedTop(x0, y0, w, h, r) {
    r = Math.min(r, w / 2, h);
    return 'M' + x0 + ',' + (y0 + h) + 'V' + (y0 + r) + 'Q' + x0 + ',' + y0 + ' ' + (x0 + r) + ',' + y0 + 'H' + (x0 + w - r) + 'Q' + (x0 + w) + ',' + y0 + ' ' + (x0 + w) + ',' + (y0 + r) + 'V' + (y0 + h) + 'Z';
  }
  function drawStandstill() {
    var host = document.querySelector('[data-chart="standstill"]');
    var W = widthOf(host), H = Math.round(Math.max(210, Math.min(280, W * 0.3))), narrow = isNarrow(W);
    var m = { l: 34, r: 10, t: 26, b: 26 };
    var svg = frame(host, W, H);
    var Y = A.yearly, y0 = Y[0].year, y1 = Y[Y.length - 1].year + 1;
    var x = lin(y0, y1, m.l, W - m.r), y = lin(0, 0.6, H - m.b, m.t);
    yGrid(svg, y, [0, 0.2, 0.4, 0.6], m.l, W - m.r, function (v) { return num(v, 1); });
    text(svg, m.l - 6, m.t - 8, 'ms', null, 'end');
    var slot = (W - m.l - m.r) / (y1 - y0), bw = Math.min(24, Math.max(1, slot - 2));
    var bars = [];
    Y.forEach(function (r) {
      var bx = x(r.year) + (slot - bw) / 2;
      bars.push(s('path', { d: roundedTop(bx, y(r.amp), bw, y(0) - y(r.amp), 4), 'class': r.measured ? 'bar' : 'bar early' }, svg));
    });
    var firstM = A.measuredYear;
    if (Y[0].year < firstM) {
      var ex = x(firstM);
      s('line', { x1: ex, x2: ex, y1: y(0.6), y2: H - m.b, 'class': 'rule era' }, svg);
      text(svg, x(Y[0].year) + 2, y(0.56), narrow ? 'largely model' : 'before ' + firstM + ': largely the tide model', 'lab', 'start');
    }
    C.majorStandstills(y0, y1).forEach(function (yr) {
      s('line', { x1: x(yr), x2: x(yr), y1: m.t - 6, y2: H - m.b, 'class': 'rule' }, svg);
      text(svg, x(yr), m.t - 10, narrow ? 'major' : 'major ' + yr.toFixed(1), 'lab', 'middle');
    });
    C.minorStandstills(y0, y1).forEach(function (yr) {
      s('line', { x1: x(yr), x2: x(yr), y1: m.t - 6, y2: H - m.b, 'class': 'rule minor' }, svg);
      text(svg, x(yr), m.t - 10, narrow ? 'minor' : 'minor ' + yr.toFixed(1), null, 'middle');
    });
    for (var yr = 1980; yr <= 2020; yr += narrow ? 20 : 10) text(svg, x(yr + 0.5), H - m.b + 16, String(yr), null, 'middle');
    hover(svg, m.l, W - m.r, m.t, H - m.b, function (sx) {
      var yy = Math.floor(x.inv(sx)), k = yy - y0;
      if (k < 0 || k >= Y.length) return null;
      bars.forEach(function (bb, q) { bb.setAttribute('class', (q === k ? 'bar on' : 'bar') + (Y[q].measured ? '' : ' early')); });
      var tl = [{ k: 'fortnightly ripple', v: num(Y[k].amp, 3) + ' ms' }];
      if (!Y[k].measured) tl.push({ v: 'largely the producers\u2019 tide model, not a clean measurement' });
      return { x: x(yy) + slot / 2, title: String(Y[k].year), lines: tl };
    });
    var tb = document.querySelector('#tbl-yearly tbody');
    if (!tb.childElementCount) {
      var half = Math.ceil(Y.length / 2);
      for (var q = 0; q < half; q++) {
        var tr = document.createElement('tr');
        [Y[q], Y[q + half]].forEach(function (r) {
          var a1 = document.createElement('td'), a2 = document.createElement('td');
          a1.textContent = r ? String(r.year) + (r.measured ? '' : '*') : ''; a2.textContent = r ? num(r.amp, 3) : '';
          tr.appendChild(a1); tr.appendChild(a2);
        });
        tb.appendChild(tr);
      }
      var nt = document.createElement('tr'), nd = document.createElement('td');
      nd.colSpan = 4; nd.className = 'muted';
      nd.textContent = '* Before ' + firstM + ': largely the producers\u2019 tide model (most of all before 1981), not a clean measurement.';
      nt.appendChild(nd); tb.appendChild(nt);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Fig 6: the average year
  var doyMeans = (function () {
    var sum = new Float64Array(365), cnt = new Float64Array(365);
    var cum = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    for (var i = 0; i < L.n; i++) {
      if (!isFinite(A.hp[i])) continue;
      var p = C.ymdFromMJD(L.mjd0 + i), d = cum[p.m - 1] + Math.min(p.d, p.m === 2 ? 28 : 31) - 1;
      sum[d] += A.hp[i]; cnt[d]++;
    }
    var out = [];
    for (var k = 0; k < 365; k++) out.push(sum[k] / cnt[k]);
    return out;
  })();
  function drawSeason() {
    var host = document.querySelector('[data-chart="season"]');
    var W = widthOf(host), H = Math.round(Math.max(210, Math.min(290, W * 0.32))), narrow = isNarrow(W);
    var m = { l: 34, r: 10, t: 16, b: 26 };
    var svg = frame(host, W, H);
    var x = lin(0, 365, m.l, W - m.r), y = lin(-1.2, 0.9, H - m.b, m.t);
    yGrid(svg, y, [-1, -0.5, 0, 0.5], m.l, W - m.r, function (v) { return (v > 0 ? '+' : '') + num(v, 1); });
    text(svg, m.l - 6, m.t - 5, 'ms', null, 'end');
    var cum = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    cum.forEach(function (d0, q) { text(svg, x(d0 + 15), H - m.b + 16, narrow ? 'JFMAMJJASOND'[q] : MON3[q], null, 'middle'); });
    // longest daylight in the north (June solstice, about 21 June)
    var sol = x(cum[5] + 20);
    s('line', { x1: sol, x2: sol, y1: m.t, y2: H - m.b, 'class': 'rule minor' }, svg);
    text(svg, sol - 4, m.t + 10, narrow ? 'solstice' : 'June solstice', null, 'end');
    var g = s('g', null, svg);
    doyMeans.forEach(function (v, d) { s('circle', { cx: x(d + 0.5), cy: y(v), r: 1.6, 'class': 'dot' }, g); });
    var pts = A.seasonal.curve.map(function (v, d) { return [x(d + 0.5), y(v)]; });
    s('path', { d: pathFrom(pts), 'class': 'series' }, svg);
    var S = A.seasonal;
    function mk(day, v, label, dy, anchor) {
      s('circle', { cx: x(day + 0.5), cy: y(v), r: 4, 'class': 'mark' }, svg);
      var t = text(svg, x(day + 0.5) + (anchor === 'end' ? -8 : 8), y(v) + dy, label, 'lab-strong', anchor);
      t.setAttribute('paint-order', 'stroke'); t.setAttribute('stroke', cssVar('--surface')); t.setAttribute('stroke-width', '3');
    }
    mk(S.maxDay, S.max, 'longest ≈ ' + shortDate(S.maxISO).replace(/ \d{4}$/, ''), -8, 'start');
    mk(S.minDay, S.min, 'shortest ≈ ' + shortDate(S.minISO).replace(/ \d{4}$/, ''), 4, 'start');
    hover(svg, m.l, W - m.r, m.t, H - m.b, function (sx) {
      var d = Math.max(0, Math.min(364, Math.floor(x.inv(sx))));
      var iso = C.isoFromMJD(C.mjdFromISO('2001-01-01') + d);
      return { x: x(d + 0.5), title: shortDate(iso).replace(/ \d{4}$/, ''), lines: [
        { k: 'average of that calendar day', v: signed(doyMeans[d], 3) + ' ms' }, { k: 'fitted curve', v: signed(S.curve[d], 3) + ' ms' }
      ] };
    });
    var tb = document.querySelector('#tbl-months tbody');
    if (!tb.childElementCount) {
      for (var q = 0; q < 6; q++) {
        var tr = document.createElement('tr');
        [S.months[q], S.months[q + 6]].forEach(function (r) {
          var a1 = document.createElement('td'), a2 = document.createElement('td');
          a1.textContent = MONTHS[r.m - 1]; a2.textContent = signed(r.v, 3);
          tr.appendChild(a1); tr.appendChild(a2);
        });
        tb.appendChild(tr);
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Fig 7: the Pacific
  function drawPacific() {
    var host = document.querySelector('[data-chart="pacific"]');
    var W = widthOf(host), narrow = isNarrow(W);
    var ph = Math.round(Math.max(120, Math.min(170, W * 0.18))), gap = 26;
    var m = { l: 34, r: 10, t: 18, b: 26 };
    var H = m.t + ph + gap + ph + m.b;
    var svg = frame(host, W, H);
    var R = A.pacific.rows, k0 = R[0].key, k1 = R[R.length - 1].key;
    var x = lin(k0, k1, m.l, W - m.r);
    var top0 = m.t, top1 = m.t + ph + gap;
    var mA = 0, mB = 0;
    R.forEach(function (r) { mA = Math.max(mA, Math.abs(r.dLod)); mB = Math.max(mB, Math.abs(r.dOni)); });
    mA = Math.ceil(mA * 10) / 10 + 0.05; mB = Math.ceil(mB * 2) / 2 + 0.8;
    var yA = lin(-mA, mA, top0 + ph, top0), yB = lin(-mB, mB, top1 + ph, top1);
    yGrid(svg, yA, [-1, 0, 1], m.l, W - m.r, function (v) { return (v > 0 ? '+' : '') + num(v, 0); });
    yGrid(svg, yB, [-3, 0, 3], m.l, W - m.r, function (v) { return (v > 0 ? '+' : '') + num(v, 0); });
    text(svg, m.l, top0 - 6, 'day length, 12-month change (ms)', 'lab', 'start');
    text(svg, m.l, top1 - 6, 'Oceanic Niño Index, 12-month change (°C)', 'lab', 'start');
    var pA = R.map(function (r) { return [x(r.key), yA(r.dLod)]; });
    var pB = R.map(function (r) { return [x(r.key), yB(r.dOni)]; });
    s('path', { d: pathFrom(pA), 'class': 'series' }, svg);
    s('path', { d: pathFrom(pB), 'class': 'series s2' }, svg);
    [[1983, 1, '1982–83', '’83'], [1997, 12, '1997–98', '’97'], [2015, 12, '2015–16', '’15'], [2023, 11, '2023–24', null], [2026, 8, '2026', '’26']].forEach(function (ev) {
      var k = ev[0] * 12 + ev[1] - 1;
      if (narrow && !ev[3]) return;
      text(svg, Math.min(W - m.r - 2, x(k)), top1 + 10, narrow ? ev[3] : ev[2], 'lab', ev[0] === 2026 ? 'end' : 'middle');
    });
    for (var yr = 1980; yr <= 2020; yr += narrow ? 20 : 10) {
      var px = x(yr * 12);
      s('line', { x1: px, x2: px, y1: H - m.b, y2: H - m.b + 4, 'class': 'axisline' }, svg);
      text(svg, px, H - m.b + 16, String(yr), null, 'middle');
    }
    var cross = hover(svg, m.l, W - m.r, top0, top1 + ph, function (sx) {
      var k = Math.round(x.inv(sx)), r = null;
      for (var q = 0; q < R.length; q++) if (R[q].key === k) { r = R[q]; break; }
      if (!r) return null;
      return { x: x(k), title: MONTHS[r.m - 1] + ' ' + r.y, lines: [
        { k: 'day length vs a year before', v: signed(r.dLod, 2) + ' ms' }, { k: 'Niño index vs a year before', v: signed(r.dOni, 2) + ' °C' }
      ] };
    });
    cross.setAttribute('y1', top0); cross.setAttribute('y2', top1 + ph);
  }

  // ---------------------------------------------------------------------------------------------
  // Fig 8: the missing seconds
  var cumLost = (function () {
    var out = new Float64Array(L.n), acc = 0;
    for (var i = 0; i < L.n; i++) { acc += L.lod[i] / 1000; out[i] = acc; }
    return out;
  })();
  function leapsBy(mjd) {
    var c = 0;
    window.LEAP_DATA.steps.forEach(function (st) { if (st[0] > L.mjd0 && st[0] <= mjd) c++; });
    return c;
  }
  function drawSeconds() {
    var host = document.querySelector('[data-chart="seconds"]');
    var W = widthOf(host), H = Math.round(Math.max(220, Math.min(300, W * 0.34))), narrow = isNarrow(W);
    var m = { l: 34, r: narrow ? 10 : 70, t: 14, b: 26 };
    var svg = frame(host, W, H);
    var x = lin(L.mjd0, LAST, m.l, W - m.r), y = lin(0, 28, H - m.b, m.t);
    yGrid(svg, y, [0, 5, 10, 15, 20, 25], m.l, W - m.r, function (v) { return String(v); });
    text(svg, m.l - 6, m.t - 3, 's', null, 'end');
    yearTicks(svg, x, H - m.b, 1980, 2026, narrow ? 20 : 10);
    var step = [[x(L.mjd0), y(0)]], cnt = 0;
    window.LEAP_DATA.steps.forEach(function (st) {
      if (st[0] <= L.mjd0 || st[0] > LAST) return;
      step.push([x(st[0]), y(cnt)]); cnt++; step.push([x(st[0]), y(cnt)]);
    });
    step.push([x(LAST), y(cnt)]);
    s('path', { d: pathFrom(step), 'class': 'series step' }, svg);
    var pts = [], stride = Math.max(1, Math.floor(L.n / (W * 1.5)));
    for (var i = 0; i < L.n; i += stride) pts.push([x(L.mjd0 + i), y(cumLost[i])]);
    pts.push([x(LAST), y(cumLost[L.n - 1])]);
    s('path', { d: pathFrom(pts), 'class': 'series' }, svg);
    if (state.you !== null && state.you >= L.mjd0) s('line', { x1: x(state.you), x2: x(state.you), y1: m.t, y2: H - m.b, 'class': 'you-line' }, svg);
    if (!narrow) {
      text(svg, W - m.r + 6, y(cumLost[L.n - 1]) - 4, num(cumLost[L.n - 1], 2) + ' s', 'lab-strong', 'start');
      text(svg, W - m.r + 6, y(cnt) + 12, cnt + ' leaps', 'lab', 'start');
    }
    var lastLeap = C.isoFromMJD(window.LEAP_DATA.steps[window.LEAP_DATA.steps.length - 1][0] - 1);
    text(svg, x(LAST) - 2, y(27.2), narrow ? 'no leap second since 2016' : 'no leap second since ' + shortDate(lastLeap), 'lab', 'end');
    hover(svg, m.l, W - m.r, m.t, H - m.b, function (sx) {
      var k = Math.max(0, Math.min(L.n - 1, Math.round(x.inv(sx) - L.mjd0)));
      return { x: x(L.mjd0 + k), title: longDate(C.isoFromMJD(L.mjd0 + k)), lines: [
        { k: 'Earth behind atomic time by', v: num(cumLost[k], 2) + ' s' }, { k: 'leap seconds added', v: String(leapsBy(L.mjd0 + k)) }
      ] };
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Your day
  function errStr(e) { return num(e, e < 0.01 ? 3 : 2); }
  function para(parent, str, cls) { var p = document.createElement('p'); if (cls) p.className = cls; p.textContent = str; parent.appendChild(p); return p; }
  function li(parent, str) { var e = document.createElement('li'); e.textContent = str; parent.appendChild(e); return e; }
  function showDay(iso) {
    var out = document.getElementById('day-out');
    out.textContent = '';
    var mjd = C.mjdFromISO(iso);
    var r = C.personal(L, window.LEAP_DATA, mjd);
    if (r.status === 'invalid') { para(out, 'That is not a date I can read. Try the picker.', 'muted'); return; }
    if (r.status === 'future') { para(out, 'The record ends on ' + longDate(r.lastISO) + '. That day has not been measured yet.', 'muted'); return; }
    state.you = mjd;
    if (r.status === 'before') {
      para(out, longDate(iso) + ' is before the record, which begins on ' + longDate(r.iso) + '. Here is everything since then.', 'muted');
    }
    var lead = r.status === 'before' ? 'The first day in the record lasted' : 'On ' + longDate(r.iso) + ' the day lasted';
    para(out, lead);
    var big = document.createElement('p'); big.className = 'big';
    big.appendChild(document.createTextNode(num(86400 + r.lod / 1000, 5) + ' s '));
    var sm = document.createElement('small');
    sm.textContent = (r.lod === 0 ? 'exactly 86,400 s to the file\u2019s last decimal' : r.lod > 0 ? num(r.lod, 2) + ' ms longer than 86,400 s' : num(-r.lod, 2) + ' ms shorter than 86,400 s') + ', ±' + errStr(r.err) + ' ms';
    big.appendChild(sm);
    out.appendChild(big);
    var nShorter = 0, nLonger = 0, ii0 = Math.max(0, mjd - L.mjd0);
    for (var q = 0; q < L.n; q++) { if (L.lod[q] < L.lod[ii0]) nShorter++; else if (L.lod[q] > L.lod[ii0]) nLonger++; }
    var rank;
    if (nLonger === 0) rank = 'It was the longest day on record.';
    else if (nShorter === 0) rank = 'It was the shortest day on record.';
    else if (nShorter >= nLonger) rank = 'It was longer than ' + Math.floor(100 * nShorter / L.n) + '% of the ' + num(L.n, 0) + ' days on record.';
    else rank = 'It was shorter than ' + Math.floor(100 * nLonger / L.n) + '% of the ' + num(L.n, 0) + ' days on record.';
    para(out, rank);
    var i0 = Math.max(0, mjd - L.mjd0);
    if (isFinite(A.hp[i0])) {
      var drift = L.lod[i0] - A.hp[i0] + A.fit.c;
      var seasonIdx = [], lunarIdx = [];
      C.LINES.forEach(function (ln, q) { (ln.lunar ? lunarIdx : seasonIdx).push(q); });
      var seas = C.evalTerms(A.fit, L.mjd0 + i0, seasonIdx), moon = C.evalTerms(A.fit, L.mjd0 + i0, lunarIdx);
      var rest = L.lod[i0] - drift - seas - moon;
      para(out, 'Taken apart: ' + signed(drift, 2) + ' ms of slow drift (its 365-day average), ' + signed(seas, 2) + ' ms of season, ' + signed(moon, 2) + ' ms of Moon, and ' + signed(rest, 2) + ' ms of everything else: weather and measurement error.');
    }
    var ul = document.createElement('ul');
    li(ul, 'The longest day since: ' + longDate(r.longestISO) + ', ' + signed(r.longest, 2) + ' ms (±' + errStr(r.longestErr) + ').');
    li(ul, 'The shortest day since: ' + longDate(r.shortestISO) + ', ' + signed(r.shortest, 2) + ' ms (±' + errStr(r.shortestErr) + ').');
    if (r.driftSeconds >= 0) {
      li(ul, 'Over those ' + num(r.days, 0) + ' days the Earth fell ' + num(r.driftSeconds, 2) + ' s behind the atomic clocks; ' + (r.leaps ? r.leaps + ' leap second' + (r.leaps > 1 ? 's were' : ' was') + ' added to civil time to wait for it.' : 'no leap second was needed.'));
    } else {
      li(ul, 'Over those ' + num(r.days, 0) + ' days the Earth gained ' + num(-r.driftSeconds, 2) + ' s on the atomic clocks: it has been spinning fast.');
    }
    if (r.longestErr > 0.1) li(ul, 'Days before about 1985 carry errors of a tenth of a millisecond or more, and their day-to-day detail is a heavily smoothed curve with the Moon\u2019s tide added back from a model, so "longest" among them is a close race partly decided by that model.');
    out.appendChild(ul);
    redrawYou();
  }
  function redrawYou() { drawRecord(); drawCarpet(); drawSeconds(); }

  // ---------------------------------------------------------------------------------------------
  // Sound: the days, sped up 4,000 times
  var DAYS_PER_SECOND = 4000;
  var audio = { ctx: null, src: null, which: null, raf: 0 };
  function audioSeries(withMoon) {
    var a = 0, b = L.n - 1;
    while (!isFinite(A.noSeason[a])) a++;
    while (!isFinite(A.noSeason[b])) b--;
    var x = A.noSeason.slice(a, b + 1), mdl = A.lunarModel.slice(a, b + 1);
    if (!withMoon) for (var i = 0; i < x.length; i++) x[i] -= mdl[i];
    var rm = C.runningMean(x, 61);
    for (i = 0; i < x.length; i++) x[i] = isFinite(rm[i]) ? x[i] - rm[i] : 0;
    return { x: x, first: L.mjd0 + a };
  }
  var audioScale = null;
  function stopAudio() {
    if (audio.src) { try { audio.src.stop(); } catch (e) { /* already stopped */ } }
    audio.src = null; audio.which = null;
    cancelAnimationFrame(audio.raf);
    state.playhead = null;
    ['play-days', 'play-nomoon'].forEach(function (id) {
      var bt = document.getElementById(id);
      bt.setAttribute('aria-pressed', 'false');
      bt.textContent = id === 'play-days' ? '▶ Play the days' : '▶ Same, with the Moon taken out';
    });
    var ph = document.getElementById('playhead');
    if (ph) ph.remove();
    document.getElementById('audio-note').textContent = 'Sound starts only when you press a button. Use moderate volume.';
  }
  function play(withMoon, btn) {
    var which = withMoon ? 'days' : 'nomoon';
    if (audio.which === which) { stopAudio(); return; }
    stopAudio();
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { document.getElementById('audio-note').textContent = 'This browser has no Web Audio, so the sound cannot play here.'; return; }
    if (!audio.ctx) audio.ctx = new AC();
    var ctx = audio.ctx;
    if (ctx.resume) ctx.resume();
    var ser = audioSeries(withMoon);
    if (audioScale === null) {
      var full = audioSeries(true).x, mx = 0;
      for (var q = 0; q < full.length; q++) mx = Math.max(mx, Math.abs(full[q]));
      audioScale = 0.6 / mx;
    }
    var sr = ctx.sampleRate, len = Math.ceil(ser.x.length / DAYS_PER_SECOND * sr);
    var buf = ctx.createBuffer(1, len, sr), ch = buf.getChannelData(0), fade = Math.round(0.04 * sr);
    for (var i = 0; i < len; i++) {
      var t = i / sr * DAYS_PER_SECOND, k = Math.floor(t), f = t - k;
      var v = k + 1 < ser.x.length ? ser.x[k] * (1 - f) + ser.x[k + 1] * f : ser.x[ser.x.length - 1];
      var env = Math.min(1, i / fade, (len - 1 - i) / fade);
      ch[i] = v * audioScale * env;
    }
    var src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.onended = function () { if (audio.src === src) stopAudio(); };
    src.start();
    audio.src = src; audio.which = which;
    btn.setAttribute('aria-pressed', 'true');
    btn.textContent = '■ Stop';
    var t0 = ctx.currentTime, note = document.getElementById('audio-note');
    (function tick() {
      if (audio.src !== src) return;
      var mj = ser.first + Math.min(ser.x.length - 1, (ctx.currentTime - t0) * DAYS_PER_SECOND);
      note.textContent = 'Now playing ' + C.ymdFromMJD(Math.floor(mj)).y + (withMoon ? '' : ', Moon removed') + '.';
      if (!reduceMotion) {
        state.playhead = mj;
        var ph = document.getElementById('playhead');
        var host = document.querySelector('[data-chart="record"] svg');
        if (host) {
          var vb = host.viewBox.baseVal, xx = 34 + (mj - L.mjd0) / (LAST - L.mjd0) * (vb.width - 44);
          if (!ph) ph = s('line', { id: 'playhead', 'class': 'you-line', y1: 16, y2: vb.height - 26 }, host);
          ph.setAttribute('x1', xx); ph.setAttribute('x2', xx);
        }
      }
      audio.raf = requestAnimationFrame(tick);
    })();
  }

  // ---------------------------------------------------------------------------------------------
  // CSV
  function downloadCSV() {
    var rows = ['date,lod_excess_ms,lod_error_ms'];
    for (var i = 0; i < L.n; i++) rows.push(C.isoFromMJD(L.mjd0 + i) + ',' + L.lod[i].toFixed(4) + ',' + L.err[i].toFixed(4));
    var blob = new Blob([rows.join('\n') + '\n'], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'length-of-day-1973-2026.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // ---------------------------------------------------------------------------------------------
  function drawAll() {
    drawRecord(); drawCarpet(); drawSpectrum(); drawForecast(); drawStandstill(); drawSeason(); drawPacific(); drawSeconds();
  }
  function init() {
    drawAll();
    document.getElementById('day-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var v = document.getElementById('day-input').value;
      if (v) showDay(v);
    });
    document.querySelectorAll('.chip').forEach(function (b) {
      b.addEventListener('click', function () {
        var d = b.getAttribute('data-date');
        if (d === 'random') d = C.isoFromMJD(L.mjd0 + Math.floor(Math.random() * L.n));
        document.getElementById('day-input').value = d;
        showDay(d);
      });
    });
    document.querySelectorAll('[data-carpet]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.carpet = b.getAttribute('data-carpet');
        document.querySelectorAll('[data-carpet]').forEach(function (o) { o.setAttribute('aria-pressed', String(o === b)); });
        drawCarpet();
      });
    });
    var sl = document.getElementById('fc-slider');
    sl.addEventListener('input', function () { state.fcStart = +sl.value; drawForecast(); });
    document.getElementById('play-days').addEventListener('click', function (ev) { play(true, ev.currentTarget); });
    document.getElementById('play-nomoon').addEventListener('click', function (ev) { play(false, ev.currentTarget); });
    document.getElementById('dl-csv').addEventListener('click', downloadCSV);
    var lastW = window.innerWidth, timer = 0;
    window.addEventListener('resize', function () {
      if (Math.abs(window.innerWidth - lastW) < 2) return;
      lastW = window.innerWidth;
      clearTimeout(timer);
      timer = setTimeout(drawAll, 120);
    });
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var redraw = function () { drawAll(); };
      if (mq.addEventListener) mq.addEventListener('change', redraw); else if (mq.addListener) mq.addListener(redraw);
    }
    document.addEventListener('scroll', clearHover, { passive: true });
    // on touch the tooltip stays after the finger lifts; a tap anywhere outside a chart clears it
    document.addEventListener('pointerdown', function (ev) { if (!ev.target.closest || !ev.target.closest('.chart')) clearHover(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
