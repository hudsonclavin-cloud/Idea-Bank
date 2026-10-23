/* app.js — drawing and interaction for The Still Canoe. All geometry lives in etak.js. */
(function () {
  'use strict';
  var E = window.Etak;
  var P = E.PLACES;
  var RAD = Math.PI / 180;
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ------------------------------------------------------------------ shared ---------
  var C = {};
  function readColors() {
    var cs = getComputedStyle(document.documentElement);
    ['bg', 'paper', 'ink', 'muted', 'rule', 'sea', 'sea-deep', 'accent', 'accent-soft', 'star', 'star-dim',
      'canoe', 'land', 'guess', 'ok', 'warn'].forEach(function (k) { C[k] = cs.getPropertyValue('--' + k).trim(); });
  }
  readColors();

  function fit(canvas) {
    var r = canvas.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    var w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    var W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx: ctx, w: w, h: h };
  }
  function $(id) { return document.getElementById(id); }
  function fmt(x, d) { return x.toFixed(d == null ? 1 : d); }
  function deg(x) { return fmt(E.wrap360(x), 1) + '°'; }
  function font(px, weight) { return (weight || 400) + ' ' + px + 'px system-ui, -apple-system, "Segoe UI", sans-serif'; }
  function pointerXY(ev, canvas) {
    var r = canvas.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }
  // seeded generator (mulberry32) so a voyage can be replayed
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // The voyage and its compass (latitude: the middle of the track).
  var VOY = E.makeVoyage(P.puluwat, P.truk, P.pisaras);
  var PTS = VOY.points;
  var VOYAGE_PTS = {};
  (function () {
    VOY.segments.segments.forEach(function (s) { VOYAGE_PTS[s.startPoint] = 1; VOYAGE_PTS[s.endPoint] = 1; });
  })();
  var RING_NM = 165; // canoe view: ring radius in nautical miles

  // Screen angle (radians, clockwise from up) for an azimuth when `upAz` is at the top.
  function scr(az, upAz) { return (az - upAz) * RAD; }
  function polar(cx, cy, r, a) { return { x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) }; }

  /**
   * Draw the star compass ring. opts:
   *   upAz      azimuth at the top
   *   labels    'all' | 'voyage' | 'none'
   *   hi        {index: colour} points to emphasise
   *   fs        label font size
   *   trueN     draw true-north/east marks
   */
  function drawRing(ctx, cx, cy, R, opts) {
    opts = opts || {};
    var upAz = opts.upAz || 0, fs = opts.fs || 11, hi = opts.hi || {};
    ctx.save();
    // horizon
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.strokeStyle = C.rule; ctx.lineWidth = 1.2; ctx.stroke();
    var tick = Math.max(6, R * 0.06);
    // true cardinal marks
    if (opts.trueN) {
      ctx.font = font(fs - 1, 600); ctx.fillStyle = C.muted; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(function (c) {
        var a = scr(c[1], upAz), p1 = polar(cx, cy, R - tick * 0.2, a), p2 = polar(cx, cy, R - tick * 1.6, a);
        ctx.setLineDash([2, 3]); ctx.strokeStyle = C.muted; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke(); ctx.setLineDash([]);
        var pl = polar(cx, cy, R - tick * 2.4, a);
        ctx.fillText('true ' + c[0], pl.x, pl.y);
      });
    }
    // ticks
    PTS.forEach(function (p, i) {
      var a = scr(p.az, upAz);
      var inner = polar(cx, cy, R, a), outer = polar(cx, cy, R + tick, a);
      // hollow: the two leaning-Cross points, placed by a definition rather than a star
      ctx.strokeStyle = hi[i] || (!p.byDefinition ? C.star : C['star-dim']);
      ctx.lineWidth = hi[i] ? 2.6 : (!p.byDefinition ? 1.8 : 1.2);
      ctx.beginPath(); ctx.moveTo(inner.x, inner.y); ctx.lineTo(outer.x, outer.y); ctx.stroke();
      var dot = polar(cx, cy, R + tick + 3.2, a);
      ctx.beginPath(); ctx.arc(dot.x, dot.y, hi[i] ? 3.6 : 2.4, 0, Math.PI * 2);
      if (!p.byDefinition || hi[i]) { ctx.fillStyle = hi[i] || C.star; ctx.fill(); }
      else { ctx.strokeStyle = C['star-dim']; ctx.lineWidth = 1.1; ctx.stroke(); }
    });
    // labels, greedily by priority, skipping overlaps
    if (opts.labels !== 'none') {
      var cand = PTS.map(function (p, i) {
        var pri = hi[i] ? 9 : p.star === 'altair' ? 6 : VOYAGE_PTS[i] ? 5 : p.event === 'upright' ? 4 : !p.byDefinition ? 2 : 1;
        if (opts.labels === 'voyage' && !(hi[i] || VOYAGE_PTS[i] || p.star === 'altair')) pri = -1;
        return { i: i, p: p, pri: pri };
      }).filter(function (c) { return c.pri >= 0; });
      cand.sort(function (a, b) { return b.pri - a.pri; });
      var placed = [];
      var W = ctx.canvas.width / (ctx.getTransform ? ctx.getTransform().a : 1);
      var H = ctx.canvas.height / (ctx.getTransform ? ctx.getTransform().d : 1);
      cand.forEach(function (c) {
        var a = scr(c.p.az, upAz);
        var text = opts.long ? c.p.label : (c.p.event === 'rise' ? '↑' : c.p.event === 'set' ? '↓' : '') + c.p.short;
        ctx.font = font(fs, hi[c.i] ? 700 : (c.pri >= 5 ? 600 : 400));
        var tw = ctx.measureText(text).width, th = fs * 1.15;
        var pos = polar(cx, cy, R + tick + 9, a);
        var s = Math.sin(a), co = Math.cos(a);
        var x0 = s > 0.25 ? pos.x : s < -0.25 ? pos.x - tw : pos.x - tw / 2;
        var y0 = co > 0.25 ? pos.y - th : co < -0.25 ? pos.y : pos.y - th / 2;
        x0 = Math.max(2, Math.min(W - tw - 2, x0));
        y0 = Math.max(1, Math.min(H - th - 1, y0));
        for (var k = 0; k < placed.length; k++) {
          var q = placed[k];
          if (x0 < q.x + q.w + 2 && x0 + tw + 2 > q.x && y0 < q.y + q.h && y0 + th > q.y) return;
        }
        placed.push({ x: x0, y: y0, w: tw, h: th });
        ctx.fillStyle = hi[c.i] || (!c.p.byDefinition ? C.ink : C.muted);
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText(text, x0, y0 + 1);
      });
    }
    ctx.restore();
  }

  function drawCanoe(ctx, x, y, size, rot) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(rot || 0);
    var L = size, Wd = size * 0.13;
    ctx.fillStyle = C.canoe; ctx.strokeStyle = C.canoe; ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1, size * 0.05);
    // outrigger: two booms and a slim float, to port
    ctx.beginPath();
    ctx.moveTo(0, -L * 0.12); ctx.lineTo(-L * 0.44, -L * 0.12);
    ctx.moveTo(0, L * 0.12); ctx.lineTo(-L * 0.44, L * 0.12);
    ctx.stroke();
    ctx.beginPath(); ctx.ellipse(-L * 0.44, 0, Math.max(1, L * 0.035), L * 0.24, 0, 0, Math.PI * 2); ctx.fill();
    // hull: double-ended
    ctx.beginPath();
    ctx.moveTo(0, -L / 2);
    ctx.bezierCurveTo(Wd, -L * 0.25, Wd, L * 0.25, 0, L / 2);
    ctx.bezierCurveTo(-Wd, L * 0.25, -Wd, -L * 0.25, 0, -L / 2);
    ctx.fill();
    ctx.restore();
  }

  function drawIsland(ctx, x, y, r, label, colour, opts) {
    opts = opts || {};
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    if (opts.ghost) { ctx.setLineDash([3, 3]); ctx.strokeStyle = colour; ctx.lineWidth = 1.6; ctx.stroke(); ctx.setLineDash([]); }
    else { ctx.fillStyle = colour; ctx.fill(); ctx.beginPath(); ctx.arc(x, y, r * 0.45, 0, Math.PI * 2); ctx.fillStyle = C.sea; ctx.fill(); }
    if (label) {
      ctx.font = font(opts.fs || 12, 600); ctx.fillStyle = colour;
      ctx.textAlign = opts.align || 'center'; ctx.textBaseline = 'bottom';
      var dx = opts.align === 'left' ? r + 4 : opts.align === 'right' ? -r - 4 : 0;
      ctx.fillText(label, x + dx, opts.below ? y + r + (opts.fs || 12) + 4 : y - r - 3);
    }
    ctx.restore();
  }

  // ------------------------------------------------------------------ 1. ring --------
  var ring = { sel: null };
  function drawRingSection() {
    var cv = $('ringCanvas'), g = fit(cv), ctx = g.ctx, w = g.w, h = g.h;
    var cx = w / 2, cy = h / 2, R = Math.min(w, h) * (w < 420 ? 0.31 : 0.35);
    ctx.fillStyle = C.sea; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    var hi = {};
    if (ring.sel != null) {
      hi[ring.sel] = C.accent;
      var partner = partnerOf(ring.sel);
      if (partner != null) hi[partner] = C.accent;
      // chord between the two: the mirror line is perpendicular to N–S
      if (partner != null) {
        var a1 = polar(cx, cy, R, scr(PTS[ring.sel].az, 90)), a2 = polar(cx, cy, R, scr(PTS[partner].az, 90));
        ctx.strokeStyle = C.accent; ctx.lineWidth = 1.2; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(a1.x, a1.y); ctx.lineTo(a2.x, a2.y); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    // N–S axis, faint
    var n = polar(cx, cy, R, scr(0, 90)), s = polar(cx, cy, R, scr(180, 90));
    ctx.strokeStyle = C.rule; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(n.x, n.y); ctx.lineTo(s.x, s.y); ctx.stroke();
    drawRing(ctx, cx, cy, R, { upAz: 90, labels: 'all', hi: hi, fs: w < 420 ? 10 : 12, trueN: true });
    drawCanoe(ctx, cx, cy, Math.min(34, R * 0.28), 0);
  }
  function partnerOf(i) { return E.partnerOf(PTS, i); }
  function ringPick(ev) {
    var cv = $('ringCanvas'), xy = pointerXY(ev, cv), r = cv.getBoundingClientRect();
    var cx = r.width / 2, cy = r.height / 2;
    var dx = xy.x - cx, dy = xy.y - cy;
    if (Math.sqrt(dx * dx + dy * dy) < Math.min(r.width, r.height) * 0.12) return;
    var az = E.wrap360(Math.atan2(dx, -dy) / RAD + 90);
    ring.sel = E.nearestPoint(PTS, az);
    var n = E.pointNote(PTS, ring.sel);
    var txt = '<strong>' + cap(n.head) + '</strong>' + (n.local ? ' (' + n.local + ')' : '') + ': ' + deg(n.az) + '. ' + n.text;
    txt += ' <span class="small">' + n.evidence + '</span>';
    $('ringReadout').innerHTML = txt;
    drawRingSection();
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // ------------------------------------------------------------------ 2. voyage ------
  var voy = { f: 0, playing: false, showPis: true, raf: 0 };
  var MID = E.along(P.puluwat, P.truk, 0.5);
  var ORIGIN = { lat: (MID.lat + P.pisaras.lat) / 2 - 0.15, lon: MID.lon };
  function chartXY(place) { return E.project(place, ORIGIN); }

  function chartTransform(w, h, places, pad) {
    var xs = [], ys = [];
    places.forEach(function (p) { var q = chartXY(p); xs.push(q.x); ys.push(q.y); });
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    var k = Math.min((w - 2 * pad) / (maxX - minX), (h - 2 * pad) / (maxY - minY));
    var ox = w / 2 - k * (minX + maxX) / 2, oy = h / 2 + k * (minY + maxY) / 2;
    return {
      k: k,
      to: function (p) { var q = chartXY(p); return { x: ox + k * q.x, y: oy - k * q.y }; },
      from: function (x, y) { return E.unproject({ x: (x - ox) / k, y: (oy - y) / k }, ORIGIN); },
    };
  }

  function drawChart() {
    var cv = $('chartCanvas'), g = fit(cv), ctx = g.ctx, w = g.w, h = g.h;
    ctx.fillStyle = C.sea; ctx.fillRect(0, 0, w, h);
    var T = chartTransform(w, h, [P.puluwat, P.truk, P.pisaras], Math.max(34, w * 0.12));
    var a = T.to(P.puluwat), b = T.to(P.truk), pis = T.to(P.pisaras);
    var fs = w < 360 ? 11 : 12;
    // north arrow
    ctx.save(); ctx.font = font(fs, 700); ctx.fillStyle = C.muted; ctx.textAlign = 'center';
    ctx.fillText('N', 18, 22); ctx.beginPath(); ctx.moveTo(18, 28); ctx.lineTo(14, 40); ctx.lineTo(22, 40); ctx.closePath(); ctx.fill();
    ctx.restore();
    // etak rays from Pisaras through each crossing point on the track
    VOY.segments.crossings.forEach(function (c) {
      var q = T.to(VOY.at(c.f));
      ctx.strokeStyle = C['star-dim']; ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
      ctx.beginPath(); ctx.moveTo(pis.x, pis.y); ctx.lineTo(q.x, q.y); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = C.star; ctx.beginPath(); ctx.arc(q.x, q.y, 2.5, 0, Math.PI * 2); ctx.fill();
    });
    // track
    ctx.strokeStyle = C.muted; ctx.lineWidth = 1.4; ctx.setLineDash([6, 5]);
    ctx.beginPath();
    for (var i = 0; i <= 40; i++) { var q = T.to(VOY.at(i / 40)); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); }
    ctx.stroke(); ctx.setLineDash([]);
    // sailed part
    ctx.strokeStyle = C.ink; ctx.lineWidth = 2.2;
    ctx.beginPath();
    for (var j = 0; j <= 40; j++) { var u = T.to(VOY.at(voy.f * j / 40)); if (j) ctx.lineTo(u.x, u.y); else ctx.moveTo(u.x, u.y); }
    ctx.stroke();
    drawIsland(ctx, a.x, a.y, 6, 'Puluwat', C.land, { fs: fs, below: true });
    drawIsland(ctx, b.x, b.y, 7, 'Chuuk', C.land, { fs: fs, below: true });
    var here = VOY.at(voy.f), hp = T.to(here);
    if (voy.showPis) {
      ctx.strokeStyle = C.accent; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(hp.x, hp.y); ctx.lineTo(pis.x, pis.y); ctx.stroke();
      drawIsland(ctx, pis.x, pis.y, 6, 'Pisaras', C.accent, { fs: fs });
    } else {
      drawIsland(ctx, pis.x, pis.y, 6, '?', C.accent, { fs: fs, ghost: true });
    }
    // the compass travels with the canoe: a small ring with the voyage's points
    var r = Math.max(22, w * 0.085);
    ctx.strokeStyle = C.rule; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(hp.x, hp.y, r, 0, Math.PI * 2); ctx.stroke();
    PTS.forEach(function (p, i) {
      if (!VOYAGE_PTS[i] && p.star !== 'altair') return;
      var t1 = polar(hp.x, hp.y, r, p.az * RAD), t2 = polar(hp.x, hp.y, r + 5, p.az * RAD);
      ctx.strokeStyle = C.star; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(t1.x, t1.y); ctx.lineTo(t2.x, t2.y); ctx.stroke();
    });
    drawCanoe(ctx, hp.x, hp.y, Math.max(16, w * 0.05), VOY.course(voy.f) * RAD);
  }

  function drawCanoeView() {
    var cv = $('canoeCanvas'), g = fit(cv), ctx = g.ctx, w = g.w, h = g.h;
    var cx = w / 2, cy = h / 2, R = Math.min(w, h) * (w < 400 ? 0.31 : 0.34);
    var course = VOY.course(voy.f), here = VOY.at(voy.f);
    ctx.fillStyle = C.paper; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = C.sea; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    var k = R / RING_NM;
    // which point is Pisaras moving toward, and which did it last pass
    var si = E.segmentAt(VOY, voy.f), seg = VOY.segments.segments[si];
    var hi = {};
    hi[seg.endPoint] = C.accent;
    // islands in the canoe frame
    var fs = w < 360 ? 10 : 12;
    function placeIsland(place, label, colour, ghost) {
      var fr = E.canoeFrame(here, course, place);
      var d = Math.min(fr.dist, RING_NM * 0.97);
      var x = cx + fr.x / fr.dist * d * k, y = cy - fr.y / fr.dist * d * k;
      if (fr.dist < 0.5) { x = cx; y = cy; }
      drawIsland(ctx, x, y, 5.5, label + (fr.dist > RING_NM ? ' →' : ''), colour, { fs: fs, ghost: ghost });
      return { x: x, y: y, fr: fr };
    }
    placeIsland(P.puluwat, 'Puluwat', C.land);
    placeIsland(P.truk, 'Chuuk', C.land);
    var fr = E.canoeFrame(here, course, P.pisaras);
    var edge = polar(cx, cy, R, fr.rel * RAD);
    // the line to the reference island, out to the star ring
    ctx.strokeStyle = C.accent; ctx.lineWidth = 1.6; ctx.setLineDash(voy.showPis ? [] : [4, 4]);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(edge.x, edge.y); ctx.stroke(); ctx.setLineDash([]);
    if (voy.showPis) placeIsland(P.pisaras, 'Pisaras', C.accent);
    ctx.fillStyle = C.accent; ctx.beginPath(); ctx.arc(edge.x, edge.y, 4.5, 0, Math.PI * 2); ctx.fill();
    drawRing(ctx, cx, cy, R, { upAz: course, labels: 'voyage', hi: hi, fs: fs });
    drawCanoe(ctx, cx, cy, Math.max(18, R * 0.16), 0);
  }

  function drawStrip() {
    var cv = $('stripCanvas'), g = fit(cv), ctx = g.ctx, w = g.w, h = g.h;
    var segs = VOY.segments.segments, x0 = 6, x1 = w - 6, y = 8, bh = 22;
    var sx = function (f) { return x0 + (x1 - x0) * f; };
    var cur = E.segmentAt(VOY, voy.f);
    segs.forEach(function (s, i) {
      var a = sx(s.fromF), b = sx(s.toF);
      ctx.fillStyle = i === cur ? C['accent-soft'] : (i % 2 ? C.sea : C['sea-deep']);
      ctx.fillRect(a, y, b - a, bh);
      if (i === 0 || s.partial) {
        // hatch the partial ends
        ctx.save(); ctx.beginPath(); ctx.rect(a, y, b - a, bh); ctx.clip();
        ctx.strokeStyle = C.rule; ctx.lineWidth = 1;
        for (var xx = a - bh; xx < b; xx += 6) { ctx.beginPath(); ctx.moveTo(xx, y + bh); ctx.lineTo(xx + bh, y); ctx.stroke(); }
        ctx.restore();
      }
      ctx.strokeStyle = C.paper; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(b, y); ctx.lineTo(b, y + bh); ctx.stroke();
      ctx.font = font(11, i === cur ? 700 : 500); ctx.fillStyle = i === cur ? C.accent : C.ink;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (b - a > 12) ctx.fillText(String(i + 1), (a + b) / 2, y + bh / 2 + 0.5);
      if (b - a > 44) {
        ctx.font = font(10, 400); ctx.fillStyle = C.muted;
        ctx.fillText(fmt(s.lengthNm, 0) + ' nm', (a + b) / 2, y + bh + 11);
      }
    });
    var m = sx(voy.f);
    ctx.fillStyle = C.ink; ctx.beginPath(); ctx.moveTo(m, y - 2); ctx.lineTo(m - 5, y - 8); ctx.lineTo(m + 5, y - 8); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(m, y); ctx.lineTo(m, y + bh); ctx.stroke();
  }

  // the bearing curve: unwrapped bearing against miles sailed
  var CURVE = (function () {
    var n = 300, pts = [], b0 = VOY.refBearing(0), prev = b0;
    for (var i = 0; i <= n; i++) {
      var b = VOY.refBearing(i / n);
      prev = prev + E.wrap180(b - E.wrap360(prev));
      pts.push({ f: i / n, b: prev });
    }
    return pts;
  })();
  function unwrapNear(az, ref) { return ref + E.wrap180(az - E.wrap360(ref)); }
  function drawCurve() {
    var cv = $('curveCanvas'), g = fit(cv), ctx = g.ctx, w = g.w, h = g.h;
    var padL = 38, padR = w < 420 ? 74 : 118, padT = 10, padB = 26;
    var bMax = 58, bMin = -58;
    var X = function (f) { return padL + (w - padL - padR) * f; };
    var Y = function (b) { return padT + (h - padT - padB) * (bMax - b) / (bMax - bMin); };
    ctx.fillStyle = C.paper; ctx.fillRect(0, 0, w, h);
    // star lines (the points the voyage passes, unwrapped near 0)
    var lines = [];
    PTS.forEach(function (p, i) {
      var u = unwrapNear(p.az, 0);
      if (u <= bMax && u >= bMin) lines.push({ i: i, u: u, p: p });
    });
    lines.sort(function (a, b) { return b.u - a.u; });
    for (var k = 0; k < lines.length - 1; k++) {
      ctx.fillStyle = k % 2 ? C.sea : C['sea-deep'];
      ctx.fillRect(X(0), Y(lines[k].u), X(1) - X(0), Y(lines[k + 1].u) - Y(lines[k].u));
    }
    var lastLabelY = -99;
    lines.forEach(function (l) {
      var y = Y(l.u);
      ctx.strokeStyle = C.star; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X(0), y); ctx.lineTo(X(1), y); ctx.stroke();
      if (Math.abs(y - lastLabelY) >= 11) {
        ctx.font = font(10.5, VOYAGE_PTS[l.i] ? 600 : 400); ctx.fillStyle = VOYAGE_PTS[l.i] ? C.ink : C.muted;
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText((w < 420 ? (l.p.event === 'rise' ? '↑' : l.p.event === 'set' ? '↓' : '') + l.p.short : l.p.label), X(1) + 5, y);
        lastLabelY = y;
      }
    });
    // axes
    ctx.font = font(10.5); ctx.fillStyle = C.muted; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    [45, 0, -45].forEach(function (b) { ctx.fillText(fmt(E.wrap360(b), 0) + '°', padL - 5, Y(b)); });
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    [0, 50, 100, 150].forEach(function (nm) { if (nm <= VOY.total) ctx.fillText(nm + (nm === 150 ? ' nm' : ''), X(nm / VOY.total), h - padB + 6); });
    // curve
    ctx.strokeStyle = C.accent; ctx.lineWidth = 2.2; ctx.beginPath();
    CURVE.forEach(function (c, i) { var x = X(c.f), y = Y(c.b); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.stroke();
    var bNow = unwrapNear(VOY.refBearing(voy.f), CURVE[Math.round(voy.f * (CURVE.length - 1))].b);
    ctx.fillStyle = C.accent; ctx.beginPath(); ctx.arc(X(voy.f), Y(bNow), 5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = C.paper; ctx.lineWidth = 1.5; ctx.stroke();
  }

  function voyageReadout() {
    var b = VOY.refBearing(voy.f), si = E.segmentAt(VOY, voy.f), seg = VOY.segments.segments[si];
    var sailed = voy.f * VOY.total;
    var txt = 'Sailed <strong>' + fmt(sailed, 1) + '</strong> of ' + fmt(VOY.total, 0) + ' nm. ';
    if (voy.showPis) txt += 'Pisaras bears <span class="hl-acc">' + deg(b) + '</span>, ' + fmt(VOY.refDistance(voy.f), 0) + ' nm off, ';
    else txt += 'Pisaras (hidden) ';
    txt += 'moving from ' + PTS[seg.startPoint].label + ' toward <span class="hl-acc">' + PTS[seg.endPoint].label + '</span>. ';
    txt += 'Etak <strong>' + (si + 1) + '</strong> of ' + VOY.segments.segments.length + '.';
    if (voy.f >= 1) txt += ' You are in Chuuk Lagoon; Pisaras is ' + fmt(Math.abs(E.wrap180(b - PTS[VOY.segments.endPoint].az)), 1) + '° from setting Vega.';
    $('voyageReadout').innerHTML = txt;
    $('sailedOut').textContent = fmt(sailed, 0) + ' nm';
  }

  function drawVoyage() {
    drawChart(); drawCanoeView(); drawStrip(); drawCurve(); voyageReadout();
    $('sailed').value = String(Math.round(voy.f * 1000));
  }
  function setF(f) { voy.f = E.clamp(f, 0, 1); drawVoyage(); }
  function stopPlay() {
    voy.playing = false; cancelAnimationFrame(voy.raf);
    $('sailBtn').textContent = reduced ? 'Sail to next etak' : (voy.f >= 1 ? 'Sail again' : 'Sail');
  }
  function nextEtak() {
    stopPlay();
    var segs = VOY.segments.segments, si = E.segmentAt(VOY, voy.f);
    var target = voy.f >= segs[si].toF - 1e-6 && si + 1 < segs.length ? segs[si + 1].toF : segs[si].toF;
    setF(Math.min(1, target + 1e-4));
  }
  function play() {
    if (reduced) { nextEtak(); return; }
    if (voy.playing) { stopPlay(); return; }
    if (voy.f >= 1) voy.f = 0;
    voy.playing = true; $('sailBtn').textContent = 'Pause';
    var last = performance.now();
    var step = function (now) {
      if (!voy.playing) return;
      var dt = Math.min(0.1, (now - last) / 1000); last = now;
      voy.f = Math.min(1, voy.f + dt / 24);
      drawVoyage();
      if (voy.f >= 1) { stopPlay(); return; }
      voy.raf = requestAnimationFrame(step);
    };
    voy.raf = requestAnimationFrame(step);
  }
  function bindScrub(canvas) {
    var drag = null;
    canvas.addEventListener('pointerdown', function (ev) {
      drag = { x: ev.clientX, f: voy.f, id: ev.pointerId, moved: false };
    });
    canvas.addEventListener('pointermove', function (ev) {
      if (!drag || ev.pointerId !== drag.id) return;
      var dx = ev.clientX - drag.x;
      if (Math.abs(dx) > 3) drag.moved = true;
      if (drag.moved) { stopPlay(); setF(drag.f + dx / canvas.getBoundingClientRect().width); }
    });
    var end = function () { drag = null; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('pointerleave', end);
  }

  // ------------------------------------------------------------------ 3. in the dark -
  var dark = null;
  function newDark(seed) {
    var R = rng(seed);
    var legs = E.makeLegs(R, VOY.total, 8);
    var tl = E.legsToTimeline(legs, VOY.total);
    dark = { seed: seed, legs: legs, tl: tl, i: 1, guess: E.wrap360(PTS[VOY.segments.startPoint].az), revealed: false, log: [] };
    $('guess').value = String(Math.round(dark.guess) % 360);
    $('guessOut').textContent = guessLabel(dark.guess);
    $('markBtn').textContent = 'Mark it here';
    $('markBtn').disabled = false;
    updateDarkText();
    drawDark(); drawDarkTrack();
    $('darkReadout').innerHTML = 'Tap the ring, drag along it, or use the slider; then press <em>Mark it here</em>.';
  }
  function guessLabel(az) { return deg(az) + ' · ' + PTS[E.nearestPoint(PTS, az)].label; }
  function windWord(k) { return k < 3.75 ? 'light' : k < 5 ? 'moderate' : k < 6.25 ? 'fresh' : 'strong'; }
  function halfKnots(k) { var r = Math.round(k * 2) / 2; return (r % 1 ? Math.floor(r) + '½' : String(r)); }
  function updateDarkText() {
    if (!dark) return;
    var i = dark.i, n = dark.legs.length;
    if (i > n) { $('legText').innerHTML = '<strong>Landfall.</strong> The high islands of Chuuk are up ahead.'; return; }
    var leg = dark.legs[i - 1];
    var before = dark.legs.slice(0, i - 1).map(function (l) { return l.hours + ' h at ~' + halfKnots(l.knots); });
    var hoursSoFar = dark.tl[i].t;
    $('legText').innerHTML = '<strong>Stretch ' + i + ' of ' + n + ':</strong> ' + leg.hours + ' h, wind ' + windWord(leg.knots) +
      ', about ' + halfKnots(leg.knots) + ' knots. ' + hoursSoFar + ' h out of Puluwat.' +
      (before.length ? ' <span class="small">Before this: ' + before.join(', ') + '.</span>' : '');
  }
  function darkGeom(cv) {
    var r = cv.getBoundingClientRect(), w = r.width, h = r.height;
    return { cx: w / 2, cy: h / 2, R: Math.min(w, h) * (w < 400 ? 0.31 : 0.35), w: w, h: h };
  }
  function drawDark() {
    var cv = $('darkCanvas'), g = fit(cv), ctx = g.ctx, w = g.w, h = g.h;
    var gm = darkGeom(cv), cx = gm.cx, cy = gm.cy, R = gm.R;
    var course = dark ? VOY.course(dark.tl[Math.min(dark.i, dark.legs.length)].f) : VOY.course(0);
    ctx.fillStyle = C.paper; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = C.sea; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    drawRing(ctx, cx, cy, R, { upAz: course, labels: 'all', fs: w < 360 ? 10 : 11.5 });
    if (dark) {
      // earlier truths, faint
      dark.log.forEach(function (e) {
        var p = polar(cx, cy, R - 8, (e.truth - course) * RAD);
        ctx.fillStyle = C['accent-soft']; ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill();
      });
      // your guess
      var gp = polar(cx, cy, R, (dark.guess - course) * RAD);
      ctx.strokeStyle = C.guess; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(gp.x, gp.y); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = C.guess; ctx.beginPath(); ctx.arc(gp.x, gp.y, 6, 0, Math.PI * 2); ctx.fill();
      if (dark.revealed) {
        var last = dark.log[dark.log.length - 1];
        var tp = polar(cx, cy, R, (last.truth - course) * RAD);
        ctx.strokeStyle = C.accent; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tp.x, tp.y); ctx.stroke();
        ctx.fillStyle = C.accent; ctx.beginPath(); ctx.arc(tp.x, tp.y, 6, 0, Math.PI * 2); ctx.fill();
        // the arc between them
        ctx.strokeStyle = C.accent; ctx.lineWidth = 3; ctx.globalAlpha = 0.5;
        var a1 = (last.guess - course) * RAD - Math.PI / 2;
        var d = E.wrap180((last.truth - last.guess));
        ctx.beginPath(); ctx.arc(cx, cy, R - 14, a1, a1 + d * RAD, d < 0); ctx.stroke(); ctx.globalAlpha = 1;
      }
    }
    drawCanoe(ctx, cx, cy, Math.max(18, R * 0.16), 0);
  }
  function drawDarkTrack() {
    var cv = $('darkTrack'), g = fit(cv), ctx = g.ctx, w = g.w, h = g.h;
    var x0 = 54, x1 = w - 54, y = h * 0.42;
    var X = function (f) { return x0 + (x1 - x0) * f; };
    ctx.fillStyle = C.paper; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = C.muted; ctx.lineWidth = 1.2; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(X(0), y); ctx.lineTo(X(1), y); ctx.stroke(); ctx.setLineDash([]);
    ctx.font = font(11, 600); ctx.fillStyle = C.land; ctx.textBaseline = 'middle';
    ctx.textAlign = 'right'; ctx.fillText('Puluwat', X(0) - 6, y);
    ctx.textAlign = 'left'; ctx.fillText('Chuuk', X(1) + 6, y);
    if (!dark) return;
    dark.log.forEach(function (e, i) {
      var xt = X(e.f), xg = X(e.implied);
      ctx.strokeStyle = C.rule; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(xt, y); ctx.lineTo(xg, y + 16); ctx.stroke();
      ctx.fillStyle = C.accent; ctx.beginPath(); ctx.arc(xt, y, 4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = C.guess; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.arc(xg, y + 16, 4, 0, Math.PI * 2); ctx.stroke();
      ctx.font = font(9.5); ctx.fillStyle = C.muted; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(String(i + 1), xg, y + 23);
    });
    ctx.font = font(10.5); ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    ctx.fillStyle = C.accent; ctx.fillText('● where you were', X(0), h - 6);
    ctx.fillStyle = C.guess; ctx.fillText('○ where your Pisaras puts you', X(0) + 112, h - 6);
  }
  function setGuess(az) {
    if (!dark || dark.revealed) return;
    dark.guess = E.wrap360(az);
    $('guess').value = String(Math.round(dark.guess) % 360);
    $('guessOut').textContent = guessLabel(dark.guess);
    drawDark();
  }
  function darkPointer(ev) {
    if (!dark || dark.revealed) return;
    var cv = $('darkCanvas'), xy = pointerXY(ev, cv), gm = darkGeom(cv);
    var dx = xy.x - gm.cx, dy = xy.y - gm.cy;
    if (Math.sqrt(dx * dx + dy * dy) < gm.R * 0.2) return;
    var course = VOY.course(dark.tl[Math.min(dark.i, dark.legs.length)].f);
    setGuess(Math.atan2(dx, -dy) / RAD + course);
  }
  function markOrSail() {
    if (!dark) return;
    var n = dark.legs.length;
    if (dark.i > n) { newDark((dark.seed * 7919 + 13) >>> 0); return; }
    if (!dark.revealed) {
      var f = dark.tl[dark.i].f, truth = VOY.refBearing(f);
      var err = E.wrap180(dark.guess - truth);
      var implied = E.fractionForBearing(VOY, dark.guess);
      dark.log.push({ f: f, truth: truth, guess: dark.guess, err: err, implied: implied });
      dark.revealed = true;
      var miles = (implied - f) * VOY.total;
      // the island slides aft as the voyage goes on, so "too far aft" means "you think you are further on"
      var aft = Math.abs(E.wrap180(dark.guess - VOY.course(f))) > Math.abs(E.wrap180(truth - VOY.course(f)));
      var cls = Math.abs(err) <= 5 ? 'hl-ok' : Math.abs(err) <= 12 ? 'hl-warn' : 'hl-acc';
      var where;
      if (Math.abs(err) < 0.05) where = 'Read as a position, that is exactly where you are.';
      else if (implied >= 1 - 1e-9 && aft) where = 'Read as a position, your island says you have already reached Chuuk.';
      else if (implied <= 1e-9 && !aft) where = 'Read as a position, your island says you are still off Puluwat.';
      else where = 'Read as a position, your island puts you ' + fmt(Math.abs(miles), 1) + ' nm ' + (miles > 0 ? 'further on than' : 'short of') + ' where you are.';
      $('darkReadout').innerHTML = 'Pisaras is at <span class="hl-acc">' + deg(truth) + '</span>, ' +
        'moving toward ' + PTS[VOY.segments.segments[E.segmentAt(VOY, f)].endPoint].label + '. You said <span class="hl-guess">' + deg(dark.guess) + '</span>: ' +
        '<span class="' + cls + '">' + fmt(Math.abs(err), 1) + '° too far ' + (aft ? 'aft' : 'forward') + '</span>. ' + where;
      $('markBtn').textContent = dark.i === n ? 'Make landfall' : 'Sail on';
      drawDark(); drawDarkTrack();
      return;
    }
    dark.revealed = false;
    dark.i += 1;
    if (dark.i > n) {
      var mean = dark.log.reduce(function (s, e) { return s + Math.abs(e.err); }, 0) / dark.log.length;
      var meanNm = dark.log.reduce(function (s, e) { return s + Math.abs(e.implied - e.f); }, 0) / dark.log.length * VOY.total;
      $('darkReadout').innerHTML = '<strong>Landfall.</strong> Across ' + dark.log.length + ' marks you held Pisaras within ' +
        fmt(mean, 1) + '° on average, which is ' + fmt(meanNm, 1) + ' nm of position. Without ever seeing it.';
      $('markBtn').textContent = 'Another voyage';
      updateDarkText(); drawDark(); drawDarkTrack();
      return;
    }
    // carry the guess forward from the last truth, so the reader moves it, not resets it
    var lastTruth = dark.log[dark.log.length - 1].truth;
    dark.guess = lastTruth;
    $('guess').value = String(Math.round(E.wrap360(lastTruth)) % 360);
    $('guessOut').textContent = guessLabel(dark.guess);
    $('markBtn').textContent = 'Mark it here';
    $('darkReadout').innerHTML = 'Move your Pisaras to where it is now.';
    updateDarkText(); drawDark();
  }

  // ------------------------------------------------------------------ 4. ghost ------
  var ghost = { ref: { lat: P.pisaras.lat, lon: P.pisaras.lon }, v: VOY, drag: false, T: null };
  function ghostVoyage() { ghost.v = E.makeVoyage(P.puluwat, P.truk, ghost.ref); }
  function drawGhost() {
    var cv = $('ghostCanvas'), g = fit(cv), ctx = g.ctx, w = g.w, h = g.h;
    ctx.fillStyle = C.sea; ctx.fillRect(0, 0, w, h);
    // a fixed frame that leaves room on both sides of the track
    var south = { lat: P.puluwat.lat - 1.2, lon: (P.puluwat.lon + P.truk.lon) / 2 };
    var north = { lat: P.pisaras.lat + 0.45, lon: (P.puluwat.lon + P.truk.lon) / 2 };
    var T = chartTransform(w, h, [P.puluwat, P.truk, south, north], 28);
    ghost.T = T;
    var v = ghost.v, ref = T.to(ghost.ref), fs = w < 420 ? 11 : 12;
    // the two star bearings the lore gives: from Puluwat and from Chuuk
    [[P.puluwat, v.segments.startPoint], [P.truk, v.segments.endPoint]].forEach(function (e) {
      var o = T.to(e[0]), az = PTS[e[1]].az * RAD, L = Math.max(w, h) * 1.5;
      ctx.strokeStyle = C.star; ctx.globalAlpha = 0.55; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x + L * Math.sin(az), o.y - L * Math.cos(az)); ctx.stroke();
      ctx.globalAlpha = 1;
      var lab = polar(o.x, o.y, Math.max(36, 0.3 * Math.hypot(ref.x - o.x, ref.y - o.y)), az);
      // text runs outward, away from the middle, so the two labels never meet
      ctx.font = font(fs - 1, 600); ctx.fillStyle = C.star; ctx.textAlign = Math.sin(az) >= 0 ? 'right' : 'left'; ctx.textBaseline = 'bottom';
      var txt = PTS[e[1]].label, tw = ctx.measureText(txt).width;
      var lx = Math.sin(az) >= 0 ? Math.max(tw + 4, lab.x - 4) : Math.min(w - tw - 4, lab.x + 4);
      ctx.fillText(txt, lx, lab.y);
    });
    // sighting circle around the reference: how close before you would see it
    var sight = E.sightingRangeNm(3, 30) * T.k;
    ctx.fillStyle = C['accent-soft']; ctx.beginPath(); ctx.arc(ref.x, ref.y, sight, 0, Math.PI * 2); ctx.fill();
    // rays
    v.segments.crossings.forEach(function (c) {
      var q = T.to(v.at(c.f));
      ctx.strokeStyle = C['star-dim']; ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
      ctx.beginPath(); ctx.moveTo(ref.x, ref.y); ctx.lineTo(q.x, q.y); ctx.stroke(); ctx.setLineDash([]);
    });
    // track coloured by segment
    v.segments.segments.forEach(function (s, i) {
      ctx.strokeStyle = i % 2 ? C.ink : C.accent; ctx.lineWidth = 4;
      ctx.beginPath();
      for (var j = 0; j <= 12; j++) { var q = T.to(v.at(s.fromF + (s.toF - s.fromF) * j / 12)); if (j) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); }
      ctx.stroke();
    });
    var a = T.to(P.puluwat), b = T.to(P.truk), pis = T.to(P.pisaras);
    drawIsland(ctx, a.x, a.y, 6, 'Puluwat', C.land, { fs: fs, below: true });
    drawIsland(ctx, b.x, b.y, 7, 'Chuuk', C.land, { fs: fs, below: true });
    var atPis = Math.abs(ghost.ref.lat - P.pisaras.lat) < 1e-6 && Math.abs(ghost.ref.lon - P.pisaras.lon) < 1e-6;
    if (!atPis) drawIsland(ctx, pis.x, pis.y, 4, 'Pisaras', C.muted, { fs: fs - 1, ghost: true });
    drawIsland(ctx, ref.x, ref.y, 8, atPis ? 'Pisaras (drag me)' : 'your reference', C.accent, { fs: fs, ghost: !atPis });
  }
  function ghostReadout() {
    var v = ghost.v, s = v.segments, segs = s.segments;
    var full = segs.filter(function (x, i) { return i > 0 && !x.partial; });
    var ca = E.closestApproach(v), sight = E.sightingRangeNm(3, 30);
    var txt = 'From Puluwat it lies under <strong>' + PTS[s.startPoint].label + '</strong>; from Chuuk under <strong>' + PTS[s.endPoint].label + '</strong>. ';
    txt += 'It sweeps ' + fmt(Math.abs(s.sweep), 0) + '° and cuts the voyage into <strong>' + segs.length + ' etak</strong>';
    if (full.length) {
      var lens = full.map(function (x) { return x.lengthNm; });
      txt += ' (full ones ' + fmt(Math.min.apply(null, lens), 1) + ' to ' + fmt(Math.max.apply(null, lens), 1) + ' nm)';
    }
    txt += '. Nearest approach ' + fmt(ca.d, 0) + ' nm: ' + (ca.d > sight ? 'never in sight.' : '<span class="hl-warn">you would see it.</span>');
    $('ghostReadout').innerHTML = txt;
  }
  function ghostMove(ev) {
    if (!ghost.T) return;
    var cv = $('ghostCanvas'), xy = pointerXY(ev, cv);
    var r = cv.getBoundingClientRect();
    xy.x = E.clamp(xy.x, 6, r.width - 6); xy.y = E.clamp(xy.y, 6, r.height - 6);
    ghost.ref = ghost.T.from(xy.x, xy.y);
    ghostVoyage(); drawGhost(); ghostReadout();
  }
  function bindGhost() {
    var cv = $('ghostCanvas');
    cv.addEventListener('pointerdown', function (ev) {
      ghost.drag = true; try { cv.setPointerCapture(ev.pointerId); } catch (e) { /* not capturable */ }
      ghostMove(ev);
    });
    cv.addEventListener('pointermove', function (ev) { if (ghost.drag) ghostMove(ev); });
    var end = function () { ghost.drag = false; };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
    cv.addEventListener('keydown', function (ev) {
      var step = 0.05, d = { ArrowUp: [step, 0], ArrowDown: [-step, 0], ArrowLeft: [0, -step], ArrowRight: [0, step] }[ev.key];
      if (!d) return;
      ev.preventDefault();
      ghost.ref = { lat: ghost.ref.lat + d[0], lon: ghost.ref.lon + d[1] };
      ghostVoyage(); drawGhost(); ghostReadout();
    });
  }

  // ------------------------------------------------------------------ 5. constant bearing
  var cb = null;
  var CB_RING_NM = 7, CB_OWN_KN = 5;
  function newCbdr(seed) {
    var R = rng(seed);
    var kinds = ['meet', 'ahead', 'astern'];
    var kind = kinds[Math.floor(R() * 3)];
    var side = R() < 0.5 ? -1 : 1;                       // other comes from port (-1) or starboard (+1)
    var crossAngle = 45 + R() * 90;                      // its course relative to ours
    var spd = 4 + R() * 3;
    var hd = side * -crossAngle * RAD;                  // heading toward our track from that side
    var Vo = { x: spd * Math.sin(hd), y: spd * Math.cos(hd) };
    var Vr = { x: Vo.x, y: Vo.y - CB_OWN_KN };
    var T = 0.75 + R() * 0.25;                           // hours to closest approach
    var miss = kind === 'meet' ? 0 : 0.8 + R() * 0.8;
    // offset perpendicular to the relative track, on the side that makes it pass ahead or astern
    var vr = Math.sqrt(Vr.x * Vr.x + Vr.y * Vr.y);
    var nrm = { x: -Vr.y / vr, y: Vr.x / vr };
    var P0 = { x: -Vr.x * T, y: -Vr.y * T };
    if (miss) {
      var c1 = { x: P0.x + nrm.x * miss, y: P0.y + nrm.y * miss };
      var c2 = { x: P0.x - nrm.x * miss, y: P0.y - nrm.y * miss };
      P0 = classify(c1, Vr) === kind ? c1 : c2;
    }
    var real = classify(P0, Vr);
    cb = { seed: seed, P0: P0, Vr: Vr, Vo: Vo, kind: real, t: 0, tWatch: T * 0.45, tEnd: T * 1.6, called: null, raf: 0, T: T };
    ['callHit', 'callAhead', 'callAstern'].forEach(function (id) { $(id).disabled = false; $(id).classList.remove('chosen'); });
    $('cbdrReadout').innerHTML = 'Watching…';
    runCbdr(0, cb.tWatch, function () { $('cbdrReadout').innerHTML = 'Your call: will it meet you, cross ahead of your bow, or pass astern?'; });
  }
  /** meet / ahead / astern from relative position and velocity */
  function classify(P0, Vr) {
    var c = E.cpa(P0, Vr);
    if (c.d < 0.25) return 'meet';
    // where does its relative track cross our fore-and-aft line (x = 0)?
    if (Math.abs(Vr.x) > 1e-9) {
      var t = -P0.x / Vr.x;
      if (t > 0) return P0.y + Vr.y * t > 0 ? 'ahead' : 'astern';
    }
    var cy = P0.y + Vr.y * c.t;
    return cy > 0 ? 'ahead' : 'astern';
  }
  function runCbdr(from, to, done) {
    cancelAnimationFrame(cb && cb.raf);
    if (reduced) { cb.t = to; drawCbdr(true); if (done) done(); return; }
    var start = performance.now(), dur = (to - from) / (0.45 * 1) * 3200 / cb.T;
    var step = function (now) {
      var k = Math.min(1, (now - start) / dur);
      cb.t = from + (to - from) * k;
      drawCbdr(false);
      if (k < 1) cb.raf = requestAnimationFrame(step); else if (done) done();
    };
    cb.raf = requestAnimationFrame(step);
  }
  function drawCbdr(staticTrail) {
    var cv = $('cbdrCanvas'), g = fit(cv), ctx = g.ctx, w = g.w, h = g.h;
    var cx = w / 2, cy = h / 2, R = Math.min(w, h) * (w < 400 ? 0.31 : 0.35), k = R / CB_RING_NM;
    var course = VOY.course(0.3);
    ctx.fillStyle = C.paper; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = C.sea; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    drawRing(ctx, cx, cy, R, { upAz: course, labels: w < 360 ? 'voyage' : 'all', fs: w < 360 ? 10 : 11 });
    if (cb) {
      // bearing trail: a tick on the ring for every 3 minutes so far
      var stepH = 0.05;
      for (var t = 0; t <= cb.t + 1e-9; t += stepH) {
        var rb = E.relBearingAt(cb.P0, cb.Vr, t);
        var p1 = polar(cx, cy, R - 4, rb * RAD), p2 = polar(cx, cy, R - 13, rb * RAD);
        ctx.strokeStyle = C.guess; ctx.globalAlpha = 0.35 + 0.65 * (t / Math.max(cb.t, 1e-6));
        ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
        if (staticTrail) {
          var sx = cx + (cb.P0.x + cb.Vr.x * t) * k, sy = cy - (cb.P0.y + cb.Vr.y * t) * k;
          ctx.fillStyle = C.guess; ctx.beginPath(); ctx.arc(sx, sy, 2, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      var x = cx + (cb.P0.x + cb.Vr.x * cb.t) * k, y = cy - (cb.P0.y + cb.Vr.y * cb.t) * k;
      var dd = Math.hypot(x - cx, y - cy);
      if (dd < R * 1.02) {
        drawCanoe(ctx, x, y, Math.max(14, R * 0.12), Math.atan2(cb.Vo.x, cb.Vo.y));
        // sight line
        ctx.strokeStyle = C.guess; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke(); ctx.setLineDash([]);
      }
      if (cb.called) {
        // the relative track, once revealed
        ctx.strokeStyle = C.accent; ctx.lineWidth = 1.2; ctx.setLineDash([6, 4]);
        ctx.beginPath(); ctx.moveTo(cx + cb.P0.x * k, cy - cb.P0.y * k);
        ctx.lineTo(cx + (cb.P0.x + cb.Vr.x * cb.tEnd) * k, cy - (cb.P0.y + cb.Vr.y * cb.tEnd) * k); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    drawCanoe(ctx, cx, cy, Math.max(18, R * 0.16), 0);
  }
  function callCbdr(kind, btn) {
    if (!cb || cb.called) return;
    cb.called = kind;
    btn.classList.add('chosen');
    ['callHit', 'callAhead', 'callAstern'].forEach(function (id) { $(id).disabled = true; });
    var c = E.cpa(cb.P0, cb.Vr);
    var drift = Math.abs(E.wrap180(E.relBearingAt(cb.P0, cb.Vr, cb.tWatch) - E.relBearingAt(cb.P0, cb.Vr, 0)));
    var names = { meet: 'it meets you', ahead: 'it crosses ahead', astern: 'it passes astern' };
    var right = kind === cb.kind;
    $('cbdrReadout').innerHTML = (right ? '<span class="hl-ok">Right:</span> ' : '<span class="hl-acc">Not this time:</span> ') +
      names[cb.kind] + ', closest ' + (c.d < 0.05 ? 'zero' : fmt(c.d, 2) + ' nm') + ' after ' + fmt(c.t * 60, 0) + ' minutes. ' +
      'While you watched, its bearing moved ' + fmt(drift, 1) + '°.';
    runCbdr(cb.t, cb.tEnd, null);
  }

  // ------------------------------------------------------------------ wiring ---------
  function drawAll() {
    drawRingSection(); drawVoyage(); drawDark(); drawDarkTrack(); drawGhost(); ghostReadout(); drawCbdr(reduced);
  }

  function init() {
    $('ringScaleOut').textContent = String(RING_NM);
    $('ringCanvas').addEventListener('pointerdown', ringPick);

    $('sailed').addEventListener('input', function () { stopPlay(); setF(Number($('sailed').value) / 1000); });
    $('sailBtn').addEventListener('click', play);
    $('nextEtak').addEventListener('click', nextEtak);
    $('restartBtn').addEventListener('click', function () { stopPlay(); setF(0); });
    $('showPis').addEventListener('change', function () { voy.showPis = $('showPis').checked; drawVoyage(); });
    bindScrub($('chartCanvas')); bindScrub($('canoeCanvas')); bindScrub($('curveCanvas')); bindScrub($('stripCanvas'));
    if (reduced) $('sailBtn').textContent = 'Sail to next etak';

    var dc = $('darkCanvas'), dDown = false;
    dc.addEventListener('pointerdown', function (ev) { dDown = true; darkPointer(ev); });
    dc.addEventListener('pointermove', function (ev) { if (dDown) darkPointer(ev); });
    dc.addEventListener('pointerup', function () { dDown = false; });
    dc.addEventListener('pointercancel', function () { dDown = false; });
    dc.addEventListener('keydown', function (ev) {
      if (!dark) return;
      if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') { ev.preventDefault(); setGuess(dark.guess - (ev.shiftKey ? 5 : 1)); }
      else if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') { ev.preventDefault(); setGuess(dark.guess + (ev.shiftKey ? 5 : 1)); }
      else if (ev.key === 'Enter') { ev.preventDefault(); markOrSail(); }
    });
    $('guess').addEventListener('input', function () { setGuess(Number($('guess').value)); });
    $('markBtn').addEventListener('click', markOrSail);
    $('darkNew').addEventListener('click', function () { newDark((Math.random() * 4294967296) >>> 0); });

    $('ghostCanvas').setAttribute('tabindex', '0');
    bindGhost();
    $('ghostReset').addEventListener('click', function () { ghost.ref = { lat: P.pisaras.lat, lon: P.pisaras.lon }; ghostVoyage(); drawGhost(); ghostReadout(); });

    $('callHit').addEventListener('click', function () { callCbdr('meet', $('callHit')); });
    $('callAhead').addEventListener('click', function () { callCbdr('ahead', $('callAhead')); });
    $('callAstern').addEventListener('click', function () { callCbdr('astern', $('callAstern')); });
    $('cbdrNew').addEventListener('click', function () { newCbdr((Math.random() * 4294967296) >>> 0); });

    newDark(20240917);
    drawAll();
    newCbdr(1976);

    var resizeT = 0;
    window.addEventListener('resize', function () { clearTimeout(resizeT); resizeT = setTimeout(drawAll, 80); });
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var onScheme = function () { readColors(); drawAll(); };
      if (mq.addEventListener) mq.addEventListener('change', onScheme); else if (mq.addListener) mq.addListener(onScheme);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
