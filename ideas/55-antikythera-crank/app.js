/* The Antikythera Crank: page. Drawing and interaction only; all astronomy and gearing is in mechanism.js. */
(function () {
  'use strict';
  var AK = window.AK;
  var TAU = Math.PI * 2, D2R = Math.PI / 180;
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  var reduceMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  var MONTH_YEARS = 1 / AK.MONTHS_PER_YEAR; // one mechanism month, in years
  var Y_MIN = -95, Y_MAX = 2240;            // about 300 BC to AD 2035

  /* ------------------------------------------------------------ state */
  var state = {
    Y: 1 / 365.25,
    crankMode: 'a1',
    playing: false,
    speed: 'year',
    train: 'moon',
    view: 'front',
    showSky: true,
    sound: false,
    pinScale: 3
  };
  var TURNS_PER_YEAR = {
    a1: AK.teeth('b1') / AK.teeth('a1'), // one turn of a1 moves b1 by 48/223 of a year
    month: AK.MONTHS_PER_YEAR,
    year: 1,
    saros: AK.MONTHS_PER_YEAR / 223
  };
  var SPEED = { month: MONTH_YEARS, year: 1, saros: 223 * MONTH_YEARS / 6 }; // years per second

  /* ------------------------------------------------------------ colours */
  var C = {};
  function readColours() {
    var cs = getComputedStyle(document.documentElement);
    ['bg', 'panel', 'face', 'face-2', 'ink', 'muted', 'line', 'line-2', 'bronze', 'bronze-hi', 'bronze-lo', 'verdigris', 'sun', 'moon', 'ghost', 'hyp', 'glyph-l', 'glyph-s', 'hl', 'pointer'].forEach(function (k) {
      C[k] = cs.getPropertyValue('--' + k).trim();
    });
    C.serif = cs.getPropertyValue('--serif').trim();
    C.sans = cs.getPropertyValue('--sans').trim();
    C.mono = cs.getPropertyValue('--mono').trim();
  }

  /* ------------------------------------------------------------ canvases */
  var canvases = {};
  function canvas(id, draw) {
    var el = document.getElementById(id);
    var c = { el: el, ctx: el.getContext('2d'), w: 0, h: 0, dpr: 1, draw: draw };
    canvases[id] = c;
    return c;
  }
  function fit(c) {
    var r = c.el.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    var w = Math.round(r.width), h = Math.round(r.height);
    if (w === c.w && h === c.h && dpr === c.dpr) return w > 0;
    c.w = w; c.h = h; c.dpr = dpr;
    if (!w || !h) return false;
    c.el.width = Math.round(w * dpr);
    c.el.height = Math.round(h * dpr);
    c.dirtyStatic = true;
    return true;
  }
  function begin(c) {
    var ctx = c.ctx;
    ctx.setTransform(c.dpr, 0, 0, c.dpr, 0, 0);
    ctx.clearRect(0, 0, c.w, c.h);
    return ctx;
  }

  /* ------------------------------------------------------------ helpers */
  function pol(cx, cy, r, aDeg) { var a = aDeg * D2R; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; }
  function fmt(x, d) { return (x < 0 ? '−' : '') + Math.abs(x).toFixed(d === undefined ? 1 : d); }
  function signed(x, d) { return (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(d === undefined ? 1 : d); }
  var SIGNS = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];
  function lonText(l) { l = AK.norm360(l); var s = Math.floor(l / 30); return (l - 30 * s).toFixed(1) + '° ' + SIGNS[s]; }
  function phaseName(el) {
    el = AK.norm360(el);
    if (el < 10 || el > 350) return 'new';
    if (el < 80) return 'waxing crescent';
    if (el < 100) return 'first quarter';
    if (el < 170) return 'waxing gibbous';
    if (el < 190) return 'full';
    if (el < 260) return 'waning gibbous';
    if (el < 280) return 'last quarter';
    return 'waning crescent';
  }
  function upright(aDeg) { // text along a ring, turned so it never reads upside down
    var a = ((aDeg % 360) + 360) % 360;
    return (a > 0 && a < 180 ? aDeg - 90 : aDeg + 90) * D2R;
  }
  function eclipseWord(type) { return type === 'penumbral' ? 'penumbral' : type; }

  /* ------------------------------------------------------------ the front dial */
  var frontC = canvas('front', drawFront);
  function drawPhaseBall(ctx, x, y, r, elong) {
    // the half-silvered ball: lit fraction as seen from Earth
    var k = Math.cos(elong * D2R); // +1 new, -1 full
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = '#1b1b22'; ctx.fill();
    var waxing = AK.norm360(elong) < 180;
    ctx.beginPath();
    // bright limb on the right when waxing (northern view), left when waning
    ctx.arc(x, y, r, -Math.PI / 2, Math.PI / 2, !waxing);
    ctx.ellipse(x, y, Math.abs(k) * r, r, 0, Math.PI / 2, -Math.PI / 2, (k > 0) === waxing ? true : false);
    ctx.closePath();
    ctx.fillStyle = '#f2efe6'; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.strokeStyle = C['bronze-lo']; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.restore();
  }
  function drawFront(c, r, sky) {
    var ctx = begin(c), S = Math.min(c.w, c.h), cx = c.w / 2, cy = c.h / 2;
    var R0 = 0.485 * S, R1 = 0.405 * S, R2 = 0.33 * S;
    var small = S < 360;
    // face
    ctx.beginPath(); ctx.arc(cx, cy, R0, 0, TAU); ctx.fillStyle = C.face; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = C['line-2']; ctx.stroke();
    // Egyptian calendar ring (rotated by hand to keep in step: here it is kept set for you)
    var eg = AK.egyptianDate(AK.jdFromYears(r.Y));
    var frac = (AK.jdFromYears(r.Y) + 0.5) % 1;
    var rot = r.sun - (eg.dayOfYear + frac) / 365 * 360 - 90;
    ctx.beginPath(); ctx.arc(cx, cy, R1, 0, TAU); ctx.strokeStyle = C['line-2']; ctx.stroke();
    ctx.strokeStyle = C.muted; ctx.lineWidth = 0.6;
    for (var d = 0; d < 365; d++) {
      var a = rot + d / 365 * 360, isMonth = d % 30 === 0 || d === 365 - 5;
      var p1 = pol(cx, cy, R0, a), p2 = pol(cx, cy, isMonth ? R1 : R0 - (small ? 4 : 6), a);
      if (!isMonth && small && d % 5) continue;
      ctx.lineWidth = isMonth ? 1.2 : 0.5;
      ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.stroke();
    }
    ctx.fillStyle = C.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = (small ? 8.5 : 11) + 'px ' + C.sans;
    for (var m = 0; m < 13; m++) {
      var mid = m < 12 ? m * 30 + 15 : 362.5;
      var am = rot + mid / 365 * 360;
      var name = AK.EGYPT_MONTHS[m];
      if (small) name = m < 12 ? name.slice(0, 4) : 'Ep.';
      var pt = pol(cx, cy, (R0 + R1) / 2 + (small ? 1 : 2), am);
      ctx.save(); ctx.translate(pt[0], pt[1]); ctx.rotate(upright(am)); ctx.fillText(name, 0, 0); ctx.restore();
    }
    // zodiac ring: 0 deg of Aries at the top, longitude increasing clockwise
    ctx.beginPath(); ctx.arc(cx, cy, R2, 0, TAU); ctx.fillStyle = C['face-2']; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, R1, 0, TAU); ctx.arc(cx, cy, R2, 0, TAU, true); ctx.fillStyle = C['face-2']; ctx.fill('evenodd');
    ctx.strokeStyle = C.muted;
    for (var deg = 0; deg < 360; deg += 1) {
      var big = deg % 30 === 0;
      if (!big && small && deg % 5) continue;
      var q1 = pol(cx, cy, R1, deg - 90), q2 = pol(cx, cy, big ? R2 : R1 - (deg % 10 ? 4 : 8), deg - 90);
      ctx.lineWidth = big ? 1.2 : 0.5;
      ctx.beginPath(); ctx.moveTo(q1[0], q1[1]); ctx.lineTo(q2[0], q2[1]); ctx.stroke();
    }
    ctx.font = (small ? 9 : 12) + 'px ' + C.serif; ctx.fillStyle = C.ink;
    for (var s = 0; s < 12; s++) {
      var as = s * 30 + 15 - 90, ps = pol(cx, cy, (R1 + R2) / 2 - (small ? 2 : 3), as);
      ctx.save(); ctx.translate(ps[0], ps[1]); ctx.rotate(upright(as)); ctx.fillText(SIGNS[s].toUpperCase(), 0, 0); ctx.restore();
    }
    // planets (Freeth et al. 2021 period relations) on concentric rings
    var names = ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn'];
    var cols = ['#8b8f97', '#d9c46a', '#c4553a', '#c99a5b', '#9a8f6a'];
    var plabels = [];
    for (var i = 0; i < 5; i++) {
      var rr = S * (0.115 + 0.039 * i);
      ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU); ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.stroke();
      if (state.showSky && sky) {
        var gp = pol(cx, cy, rr, sky.planets[names[i]].lon - 90);
        ctx.beginPath(); ctx.arc(gp[0], gp[1], small ? 3.5 : 4.5, 0, TAU); ctx.setLineDash([2, 2]); ctx.strokeStyle = C.ghost; ctx.stroke(); ctx.setLineDash([]);
      }
      var pp = pol(cx, cy, rr, r.planets[names[i]].lon - 90);
      ctx.beginPath(); ctx.arc(pp[0], pp[1], small ? 3.2 : 4, 0, TAU); ctx.fillStyle = cols[i]; ctx.fill(); ctx.strokeStyle = C['bronze-lo']; ctx.lineWidth = 0.8; ctx.stroke();
      ctx.font = (small ? 8 : 9.5) + 'px ' + C.sans; ctx.fillStyle = C.muted; ctx.textAlign = 'left';
      var lab = small ? names[i].slice(0, 2) : names[i], lw = ctx.measureText(lab).width;
      var lx = pp[0] + 6, ly = pp[1] - 1;
      var clash = plabels.some(function (q) { return lx < q[0] + q[2] && lx + lw > q[0] && Math.abs(ly - q[1]) < 10; });
      if (!clash) { ctx.fillText(lab, lx, ly); plabels.push([lx, ly, lw]); }
    }
    ctx.textAlign = 'center';
    // ghosts: where modern theory puts the Sun and Moon
    if (state.showSky && sky) {
      [[sky.sun, C.sun, 'Sun'], [sky.moon, C.moon, 'Moon']].forEach(function (g, j) {
        var gp2 = pol(cx, cy, R2 + (R1 - R2) * (j ? 0.25 : 0.78), g[0] - 90);
        ctx.beginPath(); ctx.arc(gp2[0], gp2[1], small ? 4.5 : 6, 0, TAU);
        ctx.setLineDash([3, 2]); ctx.strokeStyle = C.ghost; ctx.lineWidth = 1.6; ctx.stroke(); ctx.setLineDash([]);
      });
    }
    // Sun pointer
    var sp = pol(cx, cy, R1 - 2, r.sun - 90);
    ctx.lineCap = 'round';
    ctx.strokeStyle = C.sun; ctx.lineWidth = small ? 3 : 4;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(sp[0], sp[1]); ctx.stroke();
    var sd = pol(cx, cy, R2 - S * 0.03, r.sun - 90);
    ctx.beginPath(); ctx.arc(sd[0], sd[1], S * 0.022, 0, TAU); ctx.fillStyle = C.sun; ctx.fill();
    for (var ray = 0; ray < 8; ray++) {
      var ra = ray * 45, r1p = pol(sd[0], sd[1], S * 0.027, ra), r2p = pol(sd[0], sd[1], S * 0.037, ra);
      ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(r1p[0], r1p[1]); ctx.lineTo(r2p[0], r2p[1]); ctx.stroke();
    }
    // Moon pointer with phase ball
    var mp = pol(cx, cy, R1 - 4, r.moon - 90);
    ctx.strokeStyle = C.moon; ctx.lineWidth = small ? 2.4 : 3;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(mp[0], mp[1]); ctx.stroke();
    var mb = pol(cx, cy, R2 - S * 0.085, r.moon - 90);
    drawPhaseBall(ctx, mb[0], mb[1], S * 0.032, r.elongation);
    // hub
    ctx.beginPath(); ctx.arc(cx, cy, S * 0.025, 0, TAU); ctx.fillStyle = C.bronze; ctx.fill(); ctx.strokeStyle = C['bronze-lo']; ctx.lineWidth = 1; ctx.stroke();
  }

  /* ------------------------------------------------------------ the back dials */
  var backC = canvas('back', drawBack);
  function spiral(spec) {
    // Archimedean spiral of `turns` turns, starting at the top and running clockwise and outwards
    return {
      cx: spec.cx, cy: spec.cy, rIn: spec.rIn, pitch: spec.pitch, turns: spec.turns, cells: spec.cells,
      perTurn: spec.cells / spec.turns,
      r: function (theta) { return this.rIn + this.pitch * theta / TAU; },
      pt: function (theta, rr) { var a = theta - Math.PI / 2; return [this.cx + rr * Math.cos(a), this.cy + rr * Math.sin(a)]; }
    };
  }
  function backGeometry(c) {
    var w = c.w, h = c.h;
    var u = Math.min(w, h / 1.66), y0 = (h - 1.66 * u) / 2;
    // both spirals reach 0.40u: Metonic 0.15 + 6 x 0.25/6, Saros 0.15 + 5 x 0.05
    var top = spiral({ cx: w / 2, cy: y0 + 0.42 * u, rIn: 0.15 * u, pitch: 0.25 / 6 * u, turns: 5, cells: 235 });
    var bot = spiral({ cx: w / 2, cy: y0 + 1.24 * u, rIn: 0.15 * u, pitch: 0.05 * u, turns: 4, cells: 223 });
    return { u: u, top: top, bot: bot };
  }
  function drawSpiralStatic(ctx, sp, kind, u) {
    var turns = sp.turns, i, th;
    // band fill
    ctx.beginPath();
    for (th = 0; th <= TAU * (turns + 1) + 1e-9; th += 0.03) {
      var q = sp.pt(th, sp.r(th));
      if (th === 0) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]);
    }
    ctx.strokeStyle = C.muted; ctx.lineWidth = 1.1; ctx.stroke();
    // cell dividers
    for (i = 0; i <= sp.cells; i++) {
      th = i * TAU / sp.perTurn;
      var ri = sp.r(th), a = sp.pt(th, ri), b = sp.pt(th, ri + sp.pitch);
      var yearStart = kind === 'metonic' && i < 235 && AK.METONIC_CELLS[i].index === 1 && !AK.METONIC_CELLS[i].intercalary;
      ctx.lineWidth = yearStart || i === 0 || i === sp.cells ? 1.6 : 0.5;
      ctx.strokeStyle = yearStart ? C.ink : C.muted;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    var fs = Math.max(7, Math.min(13, sp.pitch * 0.48));
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (kind === 'metonic') {
      // year numbers in the first cell of each year
      ctx.font = Math.max(7, fs * 0.85) + 'px ' + C.sans; ctx.fillStyle = C.muted;
      for (i = 0; i < 235; i++) {
        var cell = AK.METONIC_CELLS[i];
        if (cell.index === 1 && !cell.intercalary) {
          th = (i + 0.5) * TAU / sp.perTurn;
          var pc = sp.pt(th, sp.r(th) + sp.pitch / 2);
          ctx.fillText(String(cell.year), pc[0], pc[1]);
        } else if (cell.intercalary) {
          th = (i + 0.5) * TAU / sp.perTurn;
          var pi2 = sp.pt(th, sp.r(th) + sp.pitch / 2);
          ctx.beginPath(); ctx.arc(pi2[0], pi2[1], Math.max(1.5, sp.pitch * 0.08), 0, TAU); ctx.fillStyle = C.verdigris; ctx.fill(); ctx.fillStyle = C.muted;
        }
      }
    } else {
      // eclipse glyphs, as reconstructed for the cycle of 205-187 BC
      for (i = 0; i < 223; i++) {
        var e = AK.ENGRAVED[i];
        if (!e.lunar && !e.solar) continue;
        th = (i + 0.5) * TAU / sp.perTurn;
        var both = e.lunar && e.solar;
        var base = sp.r(th) + sp.pitch / 2;
        ctx.font = '600 ' + (both ? fs * 0.95 : fs * 1.1) + 'px ' + C.serif;
        if (e.lunar) {
          var pl = sp.pt(th, both ? base - sp.pitch * 0.22 : base);
          ctx.fillStyle = C['glyph-l'];
          ctx.globalAlpha = e.lunar.type === 'penumbral' ? 0.75 : 1;
          ctx.fillText(e.lunar.type === 'penumbral' ? 'σ' : 'Σ', pl[0], pl[1]);
          ctx.globalAlpha = 1;
        }
        if (e.solar) {
          var ps = sp.pt(th, both ? base + sp.pitch * 0.22 : base);
          ctx.fillStyle = C['glyph-s'];
          ctx.fillText('Η', ps[0], ps[1]);
        }
      }
    }
  }
  function drawSubDial(ctx, x, y, rad, sectors, labels, title, turns, ccw) {
    ctx.beginPath(); ctx.arc(x, y, rad, 0, TAU); ctx.fillStyle = C['face-2']; ctx.fill(); ctx.strokeStyle = C.muted; ctx.lineWidth = 1; ctx.stroke();
    for (var i = 0; i < sectors; i++) {
      var a = (ccw ? -1 : 1) * i * 360 / sectors - 90;
      var p = pol(x, y, rad, a);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(p[0], p[1]); ctx.lineWidth = 0.8; ctx.stroke();
      var am = (ccw ? -1 : 1) * (i + 0.5) * 360 / sectors - 90, pm = pol(x, y, rad * 0.62, am);
      ctx.fillStyle = C.ink; ctx.font = Math.max(8, rad * 0.26) + 'px ' + C.sans; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(labels[i], pm[0], pm[1]);
    }
    ctx.fillStyle = C.muted; ctx.font = Math.max(7.5, rad * 0.22) + 'px ' + C.sans;
    ctx.fillText(title, x, y + rad + Math.max(7, rad * 0.24));
    // pointer
    var ang = (ccw ? -1 : 1) * turns * 360 - 90, tip = pol(x, y, rad * 0.92, ang);
    ctx.strokeStyle = C.pointer; ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(tip[0], tip[1]); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, 2.5, 0, TAU); ctx.fillStyle = C.pointer; ctx.fill();
  }
  function drawSpiralPointer(ctx, sp, turnsInCycle, cellIndex) {
    // highlight current cell
    var th0 = cellIndex * TAU / sp.perTurn, th1 = (cellIndex + 1) * TAU / sp.perTurn;
    ctx.beginPath();
    var t, q;
    for (t = th0; t <= th1 + 1e-9; t += (th1 - th0) / 8) { q = sp.pt(t, sp.r(t)); if (t === th0) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]); }
    for (t = th1; t >= th0 - 1e-9; t -= (th1 - th0) / 8) { q = sp.pt(t, sp.r(t) + sp.pitch); ctx.lineTo(q[0], q[1]); }
    ctx.closePath(); ctx.fillStyle = C.hl; ctx.fill(); ctx.strokeStyle = C.verdigris; ctx.lineWidth = 1.5; ctx.stroke();
    // the pointer follows the groove: its length grows as it spirals out
    var th = turnsInCycle * TAU;
    var tip = sp.pt(th, sp.r(th) + sp.pitch * 1.02), pin = sp.pt(th, sp.r(th) + sp.pitch / 2);
    ctx.strokeStyle = C.pointer; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(sp.cx, sp.cy); ctx.lineTo(tip[0], tip[1]); ctx.stroke();
    ctx.beginPath(); ctx.arc(pin[0], pin[1], Math.max(2.5, sp.pitch * 0.16), 0, TAU); ctx.fillStyle = C.verdigris; ctx.fill(); ctx.strokeStyle = C.pointer; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath(); ctx.arc(sp.cx, sp.cy, 3.2, 0, TAU); ctx.fillStyle = C.pointer; ctx.fill();
  }
  var backStatic = document.createElement('canvas');
  function drawBack(c, r) {
    var g = backGeometry(c);
    if (c.dirtyStatic || backStatic.width !== c.el.width || backStatic.height !== c.el.height) {
      backStatic.width = c.el.width; backStatic.height = c.el.height;
      var sx = backStatic.getContext('2d');
      sx.setTransform(c.dpr, 0, 0, c.dpr, 0, 0);
      sx.clearRect(0, 0, c.w, c.h);
      // plate
      sx.fillStyle = C.face;
      var pad = 4;
      roundRect(sx, pad, pad, c.w - 2 * pad, c.h - 2 * pad, 12); sx.fill();
      sx.strokeStyle = C['line-2']; sx.lineWidth = 1; sx.stroke();
      drawSpiralStatic(sx, g.top, 'metonic', g.u);
      drawSpiralStatic(sx, g.bot, 'saros', g.u);
      sx.fillStyle = C.muted; sx.textAlign = 'left'; sx.textBaseline = 'alphabetic';
      sx.font = Math.max(9, g.u * 0.032) + 'px ' + C.serif;
      var lh = Math.max(11, g.u * 0.038);
      sx.fillText('Metonic', pad + 8, g.top.cy - 0.37 * g.u);
      sx.fillText('235 months', pad + 8, g.top.cy - 0.37 * g.u + lh);
      sx.fillText('Saros', pad + 8, g.bot.cy - 0.37 * g.u);
      sx.fillText('223 months', pad + 8, g.bot.cy - 0.37 * g.u + lh);
      c.dirtyStatic = false;
    }
    var ctx = begin(c);
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(backStatic, 0, 0); ctx.restore();
    ctx.setTransform(c.dpr, 0, 0, c.dpr, 0, 0);
    var mt = ((r.metonic.turns % 5) + 5) % 5, st = ((r.saros.turns % 4) + 4) % 4;
    drawSpiralPointer(ctx, g.top, mt, r.metonic.cell - 1);
    drawSpiralPointer(ctx, g.bot, st, r.saros.cell - 1);
    var sub = g.top.rIn * 0.4;
    drawSubDial(ctx, g.top.cx - g.top.rIn * 0.47, g.top.cy - g.top.rIn * 0.14, sub, 4, ['1', '2', '3', '4'], 'Games', r.games.turns, true);
    drawSubDial(ctx, g.top.cx + g.top.rIn * 0.47, g.top.cy - g.top.rIn * 0.14, sub, 4, ['1', '2', '3', '4'], 'Callippic', r.callippic.turns, false);
    drawSubDial(ctx, g.bot.cx, g.bot.cy - g.bot.rIn * 0.12, g.bot.rIn * 0.6, 3, ['+0', '+8h', '+16h'], 'Exeligmos', r.exeligmos.turns, false);
  }
  function roundRect(ctx, x, y, w, h, rad) {
    ctx.beginPath(); ctx.moveTo(x + rad, y); ctx.arcTo(x + w, y, x + w, y + h, rad); ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad); ctx.arcTo(x, y, x + w, y, rad); ctx.closePath();
  }

  /* ------------------------------------------------------------ the gear trains */
  var gearC = canvas('gears', drawGears);
  var TRAINS = {
    moon: ['a1', 'b1', 'b2', 'c1', 'c2', 'd1', 'd2', 'e2', 'e5', 'k1', 'k2', 'e6', 'e1', 'b3'],
    saros: ['a1', 'b1', 'b2', 'l1', 'l2', 'm1', 'm3', 'e3', 'e4', 'f1', 'f2', 'g1', 'g2', 'h1', 'h2', 'i1'],
    metonic: ['a1', 'b1', 'b2', 'l1', 'l2', 'm1', 'm2', 'n1', 'n2', 'n3', 'o1', 'p1', 'p2', 'q1']
  };
  var LAYOUT = null;
  function circleX(p, r1, q, r2, side) {
    // intersection of two circles; side +1/-1 picks one
    var dx = q[0] - p[0], dy = q[1] - p[1], d = Math.hypot(dx, dy);
    var a = (r1 * r1 - r2 * r2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
    var mx = p[0] + a * dx / d, my = p[1] + a * dy / d;
    return [mx - side * h * dy / d, my + side * h * dx / d];
  }
  function buildLayout() {
    // Sizes: radius = module x teeth / 2, with one module per meshing group, so meshing gears touch.
    // Positions are schematic (the real arbors are on several layers); the meshes are the real ones.
    var mod = {};
    function setM(ids, m) { ids.forEach(function (id) { mod[id] = m; }); }
    setM(['a1', 'b1'], 1); setM(['b2', 'c1', 'l1'], 1); setM(['c2', 'd1'], 1.1); setM(['d2', 'e2'], 1);
    setM(['e5', 'k1', 'k2', 'e6'], 0.8); setM(['e1', 'b3'], 1.6); setM(['l2', 'm1'], 1); setM(['m3', 'e3'], 1);
    setM(['e4', 'f1'], 1); setM(['f2', 'g1'], 1.1); setM(['g2', 'h1'], 1.1); setM(['h2', 'i1'], 1.1);
    setM(['m2', 'n1'], 1.2); setM(['n2', 'p1'], 1.1); setM(['p2', 'q1'], 1.1); setM(['n3', 'o1'], 1);
    function R(id) { return mod[id] * AK.teeth(id) / 2; }
    function D(a, b) { return R(a) + R(b); }
    function at(p, d, deg) { return [p[0] + d * Math.cos(deg * D2R), p[1] + d * Math.sin(deg * D2R)]; }
    var P = {};
    P.b = [0, 0];
    P.e = at(P.b, D('e1', 'b3'), 100);                      // e-axis just below b (e1 meshes b3)
    P.m = circleX(P.e, D('m3', 'e3'), P.b, 110, -1);        // m-axis: m3 meshes e3; l closes the loop to b2
    P.l = circleX(P.b, D('b2', 'l1'), P.m, D('l2', 'm1'), 1);
    P.c = at(P.b, D('b2', 'c1'), -20);
    P.d = circleX(P.c, D('c2', 'd1'), P.e, D('d2', 'e2'), 1);
    P.f = at(P.e, D('e4', 'f1'), 52);                       // Saros train, lower right
    P.g = at(P.f, D('f2', 'g1'), 95);
    P.h = at(P.g, D('g2', 'h1'), 10);
    P.i = at(P.h, D('h2', 'i1'), -45);
    P.n = at(P.m, D('m2', 'n1'), 215);                      // calendar trains, upper left
    P.p = at(P.n, D('n2', 'p1'), 255);
    P.q = at(P.p, D('p2', 'q1'), 335);
    P.o = at(P.n, D('n3', 'o1'), 140);
    P.a = [R('b1') + 6, 0];
    var centre = { a: 'a', b: 'b', b_moon: 'b', c: 'c', d: 'd', e_moon: 'e', e_platform: 'e', e_out: 'e', f: 'f', g: 'g', h: 'h', i: 'i', l: 'l', m: 'm', n: 'n', o: 'o', p: 'p', q: 'q' };
    var gears = [];
    AK.DATA.gears.forEach(function (g) {
      if (!g.arbor || !g.teeth || !mod[g.id]) return;
      gears.push({ id: g.id, z: g.teeth, R: R(g.id), m: mod[g.id], arbor: g.arbor, centre: centre[g.arbor], hyp: g.evidence === 'hypothetical' });
    });
    // extents
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    gears.forEach(function (g) {
      if (g.id === 'k1' || g.id === 'k2') return;
      var p = g.id === 'a1' ? P.a : P[g.centre];
      minX = Math.min(minX, p[0] - g.R); maxX = Math.max(maxX, p[0] + g.R);
      minY = Math.min(minY, p[1] - g.R); maxY = Math.max(maxY, p[1] + g.R);
    });
    LAYOUT = { P: P, gears: gears, mod: mod, R: R, box: [minX - 6, minY - 6, maxX + 14, maxY + 6], kDist: D('e5', 'k1') };
    var ar = (maxX - minX + 20) / (maxY - minY + 12);
    gearC.el.style.aspectRatio = String(Math.max(0.85, Math.min(1.8, ar)));
    // tooth phases so that meshing teeth interlock (every gear angle is zero at Y = 0)
    var phase = { b1: 0 }, gearById = {};
    gears.forEach(function (g) { gearById[g.id] = g; });
    function pos(id) { var g = gearById[id]; return g.id === 'a1' ? P.a : P[g.centre]; }
    function mate(A, B, gamma) { // A's phase known; B meshes with it; gamma = direction from A's centre to B's
      var za = gearById[A].z, zb = gearById[B].z, pitch = TAU / za;
      var s = (((gamma - phase[A]) % pitch) + pitch) % pitch;
      phase[B] = gamma + Math.PI + s * za / zb + Math.PI / zb;
    }
    function arborFill() { // gears on one arbor are separate wheels: any relative phase will do
      Object.keys(AK.DATA.arbors).forEach(function (a) {
        var ids = AK.DATA.arbors[a].filter(function (id) { return gearById[id]; });
        if (ids.some(function (id) { return phase[id] !== undefined; })) ids.forEach(function (id) { if (phase[id] === undefined) phase[id] = 0; });
      });
    }
    var fixed = AK.DATA.meshes.filter(function (m) { return m[0] !== 'a1' && m[0] !== 'e5' && m[0] !== 'k2'; });
    function settle() {
      for (var pass = 0; pass < 40; pass++) {
        arborFill();
        var changed = false;
        fixed.forEach(function (m) {
          var A = m[0], B = m[1], ka = phase[A] !== undefined, kb = phase[B] !== undefined;
          if (ka === kb) return;
          if (!ka) { A = m[1]; B = m[0]; }
          var pa = pos(A), pb = pos(B);
          mate(A, B, Math.atan2(pb[1] - pa[1], pb[0] - pa[0]));
          changed = true;
        });
        if (!changed) return;
      }
    }
    settle();
    // the riders, in the turntable's frame: e5 at the centre and k1 at angle 0; k2 drives e6 back
    mate('e5', 'k1', 0);
    phase.k2 = phase.k1;
    mate('k2', 'e6', Math.PI);
    settle();
    Object.keys(phase).forEach(function (id) { if (gearById[id]) gearById[id].phase = phase[id]; });
    gears.forEach(function (g) { if (g.phase === undefined) g.phase = 0; g.path = gearPath(g); });
  }
  function gearPath(g) {
    // triangular teeth, as on the original
    var path = new Path2D(), n = g.z, root = g.R - 0.62 * g.m, tip = g.R + 0.62 * g.m;
    for (var i = 0; i < n; i++) {
      var a0 = (i - 0.5) * TAU / n, a1 = i * TAU / n;
      if (i === 0) path.moveTo(root * Math.cos(a0), root * Math.sin(a0)); else path.lineTo(root * Math.cos(a0), root * Math.sin(a0));
      path.lineTo(tip * Math.cos(a1), tip * Math.sin(a1));
    }
    path.closePath();
    var inner = g.z >= 90 ? root - 4 * g.m : 0;
    if (inner > 0) {
      path.moveTo(inner, 0); path.arc(0, 0, inner, 0, TAU, true);
    }
    g.inner = inner;
    return path;
  }
  var POINTER_OF = { a1: 'crank', b1: 'Sun', b3: 'Moon', g1: 'Saros', i1: 'Exeligmos', n1: 'Metonic', o1: 'Games', q1: 'Callippic', e3: 'turntable' };
  var LABEL_ANGLE = { b1: -50, b2: 200, b3: 130, c1: -40, c2: 20, d1: 0, d2: 10, e1: 70, e2: 0, e3: 200, e4: 160, e5: 60, e6: 100, f1: 120, f2: 230, g1: 200, g2: 100, h1: 160, h2: 300, i1: 200, l1: -120, l2: 200, m1: 160, m2: 120, m3: 250, n1: 190, n2: 300, n3: 100, o1: 150, p1: 200, p2: 330, q1: 0, k1: 210, k2: 330 };
  function drawGears(c, r) {
    if (!LAYOUT) buildLayout();
    var ctx = begin(c), L = LAYOUT, box = L.box;
    var bw = box[2] - box[0], bh = box[3] - box[1];
    var sc = Math.min(c.w / bw, c.h / bh) * 0.98;
    var ox = (c.w - bw * sc) / 2 - box[0] * sc, oy = (c.h - bh * sc) / 2 - box[1] * sc;
    var th = r.kin.theta;
    var hl = state.train === 'all' ? null : TRAINS[state.train];
    var small = c.w < 520;
    ctx.save();
    ctx.translate(ox, oy); ctx.scale(sc, sc);
    var gearById = {};
    L.gears.forEach(function (g) { gearById[g.id] = g; });
    var plat = th.e_platform * TAU; // turntable angle (screen: positive = clockwise)
    var kAng = plat + 0.0;          // k1 sits at angle 0 of the platform frame
    var kc = [L.P.e[0] + L.kDist * Math.cos(kAng), L.P.e[1] + L.kDist * Math.sin(kAng)];
    var offs = AK.ECC * 0.8 * L.R('k1');
    var k2c = [kc[0] + offs * Math.cos(kAng), kc[1] + offs * Math.sin(kAng)];
    function centreOf(g) {
      if (g.id === 'k1') return kc;
      if (g.id === 'k2') return k2c;
      return L.P[g.centre];
    }
    function angleOf(g) {
      if (g.id === 'k1' || g.id === 'k2') return (th[g.id] * TAU) + g.phase;
      return th[g.arbor] * TAU + g.phase;
    }
    // big wheels underneath, and the highlighted train above the rest
    var order = L.gears.slice().sort(function (A, B) {
      var a = !hl || hl.indexOf(A.id) >= 0, b = !hl || hl.indexOf(B.id) >= 0;
      if (a !== b) return a ? 1 : -1;
      return B.R - A.R;
    });
    order.forEach(function (g) {
      var id = g.id;
      if (id === 'a1') return;
      var p = centreOf(g), on = !hl || hl.indexOf(id) >= 0;
      ctx.save();
      ctx.translate(p[0], p[1]);
      ctx.rotate(angleOf(g));
      ctx.globalAlpha = on ? 1 : 0.16;
      if (g.hyp) {
        ctx.fillStyle = 'rgba(125,110,168,0.10)';
        ctx.fill(g.path, 'evenodd');
        ctx.setLineDash([3 / sc, 2.5 / sc]);
        ctx.strokeStyle = C.hyp; ctx.lineWidth = 1.1 / sc; ctx.stroke(g.path); ctx.setLineDash([]);
      } else {
        var grad = ctx.createRadialGradient(-g.R * 0.3, -g.R * 0.3, g.R * 0.1, 0, 0, g.R * 1.05);
        grad.addColorStop(0, C['bronze-hi']); grad.addColorStop(1, C.bronze);
        ctx.fillStyle = grad;
        ctx.fill(g.path, 'evenodd');
        ctx.strokeStyle = C['bronze-lo']; ctx.lineWidth = 0.7 / sc; ctx.stroke(g.path);
      }
      // spokes and hub for the big wheels; a mark on every gear so its turning shows
      if (g.inner > 0) {
        var nSp = g.id === 'b1' ? 4 : 6;
        ctx.fillStyle = g.hyp ? 'rgba(125,110,168,0.25)' : C.bronze;
        for (var k = 0; k < nSp; k++) {
          ctx.save(); ctx.rotate(k * TAU / nSp);
          ctx.fillRect(0, -1.1 * g.m, g.inner + 0.5, 2.2 * g.m);
          ctx.restore();
        }
        ctx.beginPath(); ctx.arc(0, 0, Math.max(4, g.R * 0.12), 0, TAU); ctx.fill();
      }
      ctx.beginPath(); ctx.arc(0, 0, Math.max(1.6, g.R * 0.07), 0, TAU); ctx.fillStyle = C['bronze-lo']; ctx.fill();
      if (!g.inner) {
        ctx.beginPath(); ctx.moveTo(g.R * 0.15, 0); ctx.lineTo(g.R * 0.72, 0);
        ctx.strokeStyle = g.hyp ? C.hyp : C['bronze-lo']; ctx.lineWidth = Math.max(1, g.R * 0.06); ctx.stroke();
      }
      ctx.restore();
      if (id === 'k2') {
        // the slot (on k2, pointing at the pin) and the pin (on k1), with the offset at true scale
        var pinAbs = plat + r.kin.pinAngle, slotAbs = pinAbs + r.kin.deviation, pinR = 0.8 * gearById.k1.R;
        var pin = [kc[0] + pinR * Math.cos(pinAbs), kc[1] + pinR * Math.sin(pinAbs)];
        ctx.save(); ctx.globalAlpha = on ? 1 : 0.16;
        ctx.translate(k2c[0], k2c[1]); ctx.rotate(slotAbs);
        ctx.strokeStyle = C.ink; ctx.lineWidth = Math.max(0.6 / sc, g.R * 0.04);
        ctx.strokeRect(0.55 * g.R, -0.08 * g.R, 0.42 * g.R, 0.16 * g.R);
        ctx.restore();
        ctx.save(); ctx.globalAlpha = on ? 1 : 0.16;
        ctx.beginPath(); ctx.arc(pin[0], pin[1], Math.max(1.2 / sc, g.R * 0.07), 0, TAU); ctx.fillStyle = C.verdigris; ctx.fill();
        ctx.restore();
      }
    });
    // a1, the crown gear at b1's rim, seen edge-on: its teeth slide past as the crank turns
    var a = L.P.a, aw = 9, ah = 40;
    ctx.save(); ctx.translate(a[0], a[1]);
    ctx.globalAlpha = !hl || hl.indexOf('a1') >= 0 ? 1 : 0.2;
    ctx.fillStyle = C.bronze; ctx.fillRect(0, -ah / 2, aw, ah);
    ctx.strokeStyle = C['bronze-lo']; ctx.lineWidth = 0.6 / sc; ctx.strokeRect(0, -ah / 2, aw, ah);
    var ph = ((-th.a * 48) % 1 + 1) % 1, pitch = ah / 9;
    ctx.fillStyle = C['bronze-lo'];
    for (var t = -1; t < 10; t++) {
      var yy = -ah / 2 + (t + ph) * pitch;
      if (yy < -ah / 2 || yy > ah / 2 - 1) continue;
      ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(-3, yy + pitch / 2); ctx.lineTo(0, yy + pitch); ctx.fill();
    }
    ctx.restore();
    ctx.restore();
    // labels, unrotated, nudged round their gear until they do not collide
    ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    var fs = small ? 9.5 : 11;
    ctx.font = fs + 'px ' + C.sans;
    var placed = [];
    function free(rc) {
      if (rc[0] < 2 || rc[1] < 2 || rc[0] + rc[2] > c.w - 2 || rc[1] + rc[3] > c.h - 2) return false;
      return placed.every(function (q) { return rc[0] > q[0] + q[2] || rc[0] + rc[2] < q[0] || rc[1] > q[1] + q[3] || rc[1] + rc[3] < q[1]; });
    }
    var labelled = order.filter(function (g) { return (!hl || hl.indexOf(g.id) >= 0) && !(small && !hl); }).reverse();
    labelled.forEach(function (g) {
      var p = g.id === 'a1' ? [L.P.a[0] + 4.5, L.P.a[1]] : centreOf(g);
      var txt = g.id + ' ' + g.z + (POINTER_OF[g.id] ? ' \u00b7 ' + POINTER_OF[g.id] : '');
      var tw = ctx.measureText(txt).width + 6, thh = fs + 4;
      var base = (LABEL_ANGLE[g.id] || 0), best = null;
      for (var k = 0; k < 24 && !best; k++) {
        var ang = (base + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 15) * D2R;
        var rr = g.id === 'a1' ? 26 : g.inner > 0 ? g.R * 0.62 : g.R + 4 / sc;
        var x = ox + (p[0] + rr * Math.cos(ang)) * sc, y = oy + (p[1] + rr * Math.sin(ang)) * sc;
        // push the label outwards so its box clears the rim
        x += Math.cos(ang) * tw / 2; y += Math.sin(ang) * thh / 2;
        var rc = [x - tw / 2, y - thh / 2, tw, thh];
        if (free(rc)) best = [x, y, rc];
      }
      if (!best) return;
      placed.push(best[2]);
      ctx.fillStyle = C.panel; ctx.globalAlpha = 0.86; ctx.fillRect(best[2][0], best[2][1], best[2][2], best[2][3]); ctx.globalAlpha = 1;
      ctx.fillStyle = g.hyp ? C.hyp : POINTER_OF[g.id] ? C.verdigris : C.ink;
      ctx.fillText(txt, best[0], best[1]);
    });
  }

  /* ------------------------------------------------------------ pin and slot close-up */
  var pinC = canvas('pin', drawPin);
  function drawPin(c, r) {
    var ctx = begin(c), S = Math.min(c.w, c.h), cx = c.w / 2, cy = c.h / 2;
    var Rk = S * 0.36, m = 2 * Rk / 50, pinR = 0.8 * Rk; // pin 9.6 mm on a ~12 mm pitch radius
    var off = AK.ECC * pinR * state.pinScale;
    var phi1 = r.kin.pinAngle;
    // the slot angle for the drawn (possibly exaggerated) offset
    var eps = AK.ECC * state.pinScale;
    var phi2 = phi1 + AK.pinSlotDeviation(phi1, eps);
    var k1 = [cx - off / 2, cy], k2 = [cx + off / 2, cy];
    function teethPath(R0) {
      var p = new Path2D(), root = R0 - 0.6 * m, tip = R0 + 0.6 * m;
      for (var i = 0; i < 50; i++) {
        var a0 = (i - 0.5) * TAU / 50, a1 = i * TAU / 50;
        if (!i) p.moveTo(root * Math.cos(a0), root * Math.sin(a0)); else p.lineTo(root * Math.cos(a0), root * Math.sin(a0));
        p.lineTo(tip * Math.cos(a1), tip * Math.sin(a1));
      }
      p.closePath(); return p;
    }
    var tp = teethPath(Rk);
    // k1 (behind)
    ctx.save(); ctx.translate(k1[0], k1[1]); ctx.rotate(phi1);
    ctx.fillStyle = C.bronze; ctx.fill(tp); ctx.strokeStyle = C['bronze-lo']; ctx.lineWidth = 1; ctx.stroke(tp);
    ctx.restore();
    // k2 (front), translucent, with its slot
    ctx.save(); ctx.translate(k2[0], k2[1]); ctx.rotate(phi2);
    ctx.globalAlpha = 0.55; ctx.fillStyle = C['bronze-hi']; ctx.fill(tp); ctx.globalAlpha = 1;
    ctx.strokeStyle = C['bronze-lo']; ctx.lineWidth = 1; ctx.stroke(tp);
    ctx.fillStyle = C.face; ctx.strokeStyle = C.ink; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.rect(pinR - Rk * 0.2, -Rk * 0.055, Rk * 0.42, Rk * 0.11); ctx.fill(); ctx.stroke();
    ctx.restore();
    // direction lines: k1's (pin) and k2's (slot)
    var pin = [k1[0] + pinR * Math.cos(phi1), k1[1] + pinR * Math.sin(phi1)];
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = C.verdigris; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(k1[0], k1[1]); ctx.lineTo(pin[0], pin[1]); ctx.stroke();
    ctx.strokeStyle = C.ghost;
    var sl = [k2[0] + Rk * 1.12 * Math.cos(phi2), k2[1] + Rk * 1.12 * Math.sin(phi2)];
    ctx.beginPath(); ctx.moveTo(k2[0], k2[1]); ctx.lineTo(sl[0], sl[1]); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(pin[0], pin[1], Math.max(3, Rk * 0.045), 0, TAU); ctx.fillStyle = C.verdigris; ctx.fill(); ctx.strokeStyle = C['bronze-lo']; ctx.stroke();
    [[k1, C.verdigris, 'k1'], [k2, C.ghost, 'k2']].forEach(function (q) {
      ctx.beginPath(); ctx.arc(q[0][0], q[0][1], 3, 0, TAU); ctx.fillStyle = q[1]; ctx.fill();
    });
    ctx.font = '12px ' + C.sans; ctx.fillStyle = C.ink; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('k1 (pin) and k2 (slot), 50 teeth each', 10, 10);
    ctx.fillStyle = C.muted;
    ctx.fillText('axes ' + (1.1 * state.pinScale).toFixed(1) + ' mm apart' + (state.pinScale > 1 ? ' (×' + state.pinScale + ')' : ' (true)'), 10, 27);
    $('#pinOut').textContent = 'k2 − k1 = ' + signed(AK.pinSlotDeviation(phi1) / D2R, 2) + '° at true scale';
  }

  /* ------------------------------------------------------------ anomaly chart */
  var anomC = canvas('anomChart', drawAnom);
  function chartFrame(ctx, c, xr, yr, pad) {
    var x0 = pad.l, x1 = c.w - pad.r, y0 = pad.t, y1 = c.h - pad.b;
    return {
      x: function (v) { return x0 + (v - xr[0]) / (xr[1] - xr[0]) * (x1 - x0); },
      y: function (v) { return y1 - (v - yr[0]) / (yr[1] - yr[0]) * (y1 - y0); },
      x0: x0, x1: x1, y0: y0, y1: y1
    };
  }
  function drawAnom(c, r) {
    var ctx = begin(c), small = c.w < 480;
    var f = chartFrame(ctx, c, [0, 360], [-7.5, 7.5], { l: small ? 30 : 38, r: 10, t: 12, b: small ? 26 : 30 });
    ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.font = (small ? 9.5 : 11) + 'px ' + C.sans; ctx.fillStyle = C.muted;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (var v = -6; v <= 6; v += 2) {
      ctx.beginPath(); ctx.moveTo(f.x0, f.y(v)); ctx.lineTo(f.x1, f.y(v)); ctx.stroke();
      ctx.fillText((v > 0 ? '+' : '') + v + '°', f.x0 - 4, f.y(v));
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (var a = 0; a <= 360; a += 90) {
      ctx.beginPath(); ctx.moveTo(f.x(a), f.y0); ctx.lineTo(f.x(a), f.y1); ctx.stroke();
      ctx.fillText(a + '°', f.x(a), f.y1 + 4);
    }
    ctx.fillText(small ? 'anomaly (0° = perigee)' : 'mean anomaly (0° = perigee, where the Moon is fastest)', (f.x0 + f.x1) / 2, f.y1 + (small ? 13 : 15));
    function curve(fn, col, dash, lw) {
      ctx.beginPath();
      for (var M = 0; M <= 360; M += 1) { var y = fn(M * D2R) / D2R; if (!M) ctx.moveTo(f.x(M), f.y(y)); else ctx.lineTo(f.x(M), f.y(y)); }
      ctx.setLineDash(dash || []); ctx.strokeStyle = col; ctx.lineWidth = lw || 1.6; ctx.stroke(); ctx.setLineDash([]);
    }
    var ecc = function (e) { return function (M) { return AK.pinSlotDeviation(M, e); }; };
    curve(function (M) { return (6.288774 * Math.sin(M) + 0.213618 * Math.sin(2 * M) + 0.010034 * Math.sin(3 * M)) * D2R; }, C.ghost, null, 1.4);
    curve(ecc((327 + 2 / 3) / 3144), C.verdigris, [6, 4]);
    curve(ecc(247.5 / 3122.5), C.hyp, [2, 3]);
    curve(ecc(AK.ECC), C.bronze, null, 2.6);
    var Mnow = AK.norm360(r.moonAnomaly), dnow = AK.pinSlotDeviation(Mnow * D2R) / D2R;
    ctx.beginPath(); ctx.arc(f.x(Mnow), f.y(dnow), 5, 0, TAU); ctx.fillStyle = C.bronze; ctx.fill(); ctx.strokeStyle = C.ink; ctx.lineWidth = 1.2; ctx.stroke();
  }

  /* ------------------------------------------------------------ drift chart */
  var driftC = canvas('driftChart', drawDrift);
  var driftData = null;
  function computeDrift() {
    var pts = [];
    for (var Y = 0; Y <= 150; Y += 7 / 365.25) {
      pts.push([Y, AK.sgn180(AK.read(Y).moon - AK.sky(AK.jdFromYears(Y)).moon)]);
    }
    driftData = pts;
  }
  function drawDrift(c, r) {
    var ctx = begin(c), small = c.w < 480;
    if (!driftData) { ctx.fillStyle = C.muted; ctx.font = '12px ' + C.sans; ctx.fillText('computing…', 12, 20); return; }
    var f = chartFrame(ctx, c, [0, 150], [-6, 16], { l: small ? 30 : 38, r: small ? 18 : 24, t: 10, b: small ? 26 : 30 });
    ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.font = (small ? 9.5 : 11) + 'px ' + C.sans; ctx.fillStyle = C.muted;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (var v = -5; v <= 15; v += 5) { ctx.beginPath(); ctx.moveTo(f.x0, f.y(v)); ctx.lineTo(f.x1, f.y(v)); ctx.stroke(); ctx.fillText((v > 0 ? '+' : '') + v + '°', f.x0 - 4, f.y(v)); }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (var y = 0; y <= 150; y += 25) {
      ctx.beginPath(); ctx.moveTo(f.x(y), f.y0); ctx.lineTo(f.x(y), f.y1); ctx.stroke();
      var jd = AK.jdFromYears(y);
      ctx.fillText(small && y % 50 ? '' : AK.yearLabel(AK.dateFromJd(jd).year), f.x(y), f.y1 + 4);
    }
    if (!c.dots || c.dotsKey !== c.w + 'x' + c.h) { // one path for all the points, rebuilt only on resize
      c.dots = new Path2D(); c.dotsKey = c.w + 'x' + c.h;
      driftData.forEach(function (p) { c.dots.rect(f.x(p[0]) - 0.6, f.y(p[1]) - 0.6, 1.2, 1.2); });
    }
    ctx.fillStyle = C.bronze; ctx.globalAlpha = 0.55; ctx.fill(c.dots); ctx.globalAlpha = 1;
    // the secular line: (254/19 - modern) per year
    var rate = AK.driftTable()[0].degPerYear;
    ctx.strokeStyle = C.ghost; ctx.lineWidth = 1.8; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(f.x(0), f.y(0)); ctx.lineTo(f.x(150), f.y(150 * rate)); ctx.stroke(); ctx.setLineDash([]);
    // wreck marker and now marker
    var wreckY = AK.yearsFromJd(AK.jdFromDate(-64, 7, 1));
    ctx.strokeStyle = C.muted; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(f.x(wreckY), f.y0); ctx.lineTo(f.x(wreckY), f.y1); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = C.muted; ctx.textAlign = 'right'; ctx.fillText('wreck', f.x(wreckY) - 3, f.y0 + 2);
    if (r.Y >= 0 && r.Y <= 150) {
      var d = AK.sgn180(r.moon - AK.sky(AK.jdFromYears(r.Y)).moon);
      ctx.beginPath(); ctx.arc(f.x(r.Y), f.y(Math.max(-6, Math.min(16, d))), 5, 0, TAU); ctx.fillStyle = C.verdigris; ctx.fill(); ctx.strokeStyle = C.ink; ctx.stroke();
    }
  }

  /* ------------------------------------------------------------ static tables */
  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (html !== undefined) e.innerHTML = html;
    return e;
  }
  function buildProof() {
    var t = $('#proofTable');
    var rel = {
      moon: ['254/19', '(235 + 19)/19: 254 sidereal months in 19 years'],
      platform: ['477/4237', '254/19 − (239/223)(235/19): the line of apsides, once in 8.88 years'],
      metonic: ['5/19', '235 months in 19 years, 47 cells a turn: 235/(47 × 19)'],
      callippic: ['1/76', 'one turn in 76 years (four Metonic cycles)'],
      games: ['1/4', 'one turn in 4 years'],
      saros: ['940/4237', '4 turns in 223 months: 4 × (235/19)/223'],
      exeligmos: ['235/12711', 'one turn in 3 × 223 months: (235/19)/669'],
      moon_out: ['1', 'b3 follows e2 on average; the pin adds only a wobble']
    };
    var head = el('tr');
    ['Train', 'Tooth counts, driver/driven', 'Product', 'Astronomy', '', 'Per year'].forEach(function (h, i) { head.appendChild(el('th', i === 5 ? { class: 'num' } : null, h)); });
    var thead = el('thead'); thead.appendChild(head); t.appendChild(thead);
    var tb = el('tbody');
    AK.DATA.trains.forEach(function (tr) {
      var res = AK.trainRatio(tr.meshes);
      var chain = tr.meshes.map(function (m) { return AK.teeth(m[0]) + '/' + AK.teeth(m[1]); }).join(' × ');
      var parts = rel[tr.id][0].split('/');
      var exp = AK.frac(parts[0], parts[1] || 1);
      var ok = AK.Fr.eq(res.ratio, exp);
      var row = el('tr');
      row.appendChild(el('td', null, '<b>' + tr.name + '</b><br><span class="muted">' + tr.meshes.map(function (m) { return m[0] + '→' + m[1]; }).join(', ') + '</span>'));
      row.appendChild(el('td', { class: 'eq' }, chain));
      row.appendChild(el('td', { class: 'eq' }, AK.Fr.str(res.ratio)));
      row.appendChild(el('td', null, rel[tr.id][1]));
      row.appendChild(el('td', { class: 'ok' + (ok ? '' : ' fail') }, ok ? '= ✓' : '≠'));
      row.appendChild(el('td', { class: 'num' }, AK.Fr.num(res.ratio).toFixed(6)));
      tb.appendChild(row);
    });
    t.appendChild(tb);
  }
  function buildDriftTable() {
    var t = $('#driftTable');
    var f = AK.cycleFacts();
    var head = el('tr');
    ['Pointer', 'Mechanism', 'Modern', 'Error per decade', 'Per century'].forEach(function (h, i) { head.appendChild(el('th', i ? { class: 'num' } : null, h)); });
    var thead = el('thead'); thead.appendChild(head); t.appendChild(thead);
    var tb = el('tbody');
    AK.driftTable().forEach(function (d) {
      var row = el('tr');
      row.appendChild(el('td', null, d.label + '<br><span class="muted">' + d.note + '</span>'));
      row.appendChild(el('td', { class: 'num' }, d.mech.toFixed(6) + ' /yr'));
      row.appendChild(el('td', { class: 'num' }, d.modern.toFixed(6) + ' /yr'));
      row.appendChild(el('td', { class: 'num' }, signed(d.perDecade, 2) + '°'));
      row.appendChild(el('td', { class: 'num' }, signed(d.perCentury, 1) + '°'));
      tb.appendChild(row);
    });
    t.appendChild(tb);
    var p = el('p', { class: 'note' });
    p.innerHTML = 'The root of the Moon’s error: the mechanism’s lunar month is 19 years / 235 = ' + f.mechanismMonthDays.toFixed(5) +
      ' days, against ' + f.modernMonthDays.toFixed(5) + ' (32 seconds short), so its phases run ahead by one day every ' + Math.round(f.metonicDayPerYears) +
      ' years. Its Saros is ' + f.saros.mechanism.toFixed(2) + ' days long against ' + f.saros.synodic223.toFixed(2) +
      '. The real Saros is itself only nearly a cycle: 239 anomalistic months are ' + f.saros.anomalistic239.toFixed(2) + ' days and 242 draconic months ' + f.saros.draconic242.toFixed(2) +
      ', so each return finds the Moon ' + f.sarosNodeShiftDeg.toFixed(2) + '° further from its node. And it is ' + f.sarosHours.toFixed(2) +
      ' hours over a whole number of days, which the Exeligmos dial rounds to 8. The turntable’s period is ' + f.apsidesYears.mechanism.toFixed(3) + ' years; the Moon’s line of apsides takes ' + f.apsidesYears.modern.toFixed(3) + '. The planets’ rows use the period relations of Freeth et al. 2021.';
    t.parentNode.parentNode.insertBefore(p, t.parentNode.nextSibling);
  }
  function buildGlyphTable() {
    var t = $('#glyphTable');
    var rows = AK.glyphSurvival(10);
    var head = el('tr');
    ['Saros cycles on', 'Years', 'Engraved lunar months still eclipsed', 'Engraved solar months still eclipsed', 'Eclipses in blank months'].forEach(function (h, i) { head.appendChild(el('th', i ? { class: 'num' } : null, h)); });
    var thead = el('thead'); thead.appendChild(head); t.appendChild(thead);
    var tb = el('tbody');
    rows.forEach(function (g) {
      if ([0, 1, 2, 3, 5, 7, 10].indexOf(g.cycle) < 0) return;
      var row = el('tr');
      row.appendChild(el('td', null, g.cycle ? String(g.cycle) : '0 (as engraved)'));
      row.appendChild(el('td', { class: 'num' }, g.years.toFixed(0)));
      row.appendChild(el('td', { class: 'num' }, g.lunar[0] + ' of ' + g.lunar[1]));
      row.appendChild(el('td', { class: 'num' }, g.solar[0] + ' of ' + g.solar[1]));
      row.appendChild(el('td', { class: 'num' }, String(g.unmarked)));
      tb.appendChild(row);
    });
    t.appendChild(tb);
    var p = el('p', { class: 'note' });
    p.innerHTML = 'Lunar here means umbral (visibly darkened) eclipses; solar means a solar eclipse anywhere on Earth. My engraving is the eclipses modern theory finds in each month of the cycle from 28 April 205 BC (Meeus’s method, ch. 54): 27 umbral and 15 penumbral lunar, and 41 solar. They fall in 38 eclipse seasons, 5 or 6 months apart. The real dial’s glyphs were a prediction scheme, not a record, and only about a third of the dial survives, so mine is a stand-in for the inscription, not a transcription of it.';
    t.parentNode.parentNode.insertBefore(p, t.parentNode.nextSibling);
  }
  function buildEvidence() {
    var t = $('#evidenceTable');
    var head = el('tr');
    ['Gear', 'Teeth', 'Evidence', 'Fragment', 'Role', 'About the count'].forEach(function (h, i) { head.appendChild(el('th', i === 1 ? { class: 'num' } : null, h)); });
    var thead = el('thead'); thead.appendChild(head); t.appendChild(thead);
    var tb = el('tbody');
    var label = { ct: 'survives', inferred: 'inferred', hypothetical: 'hypothetical' };
    AK.DATA.gears.forEach(function (g) {
      var row = el('tr');
      row.appendChild(el('td', null, '<b>' + g.id + '</b>'));
      row.appendChild(el('td', { class: 'num' }, g.teeth === null ? '—' : String(g.teeth)));
      row.appendChild(el('td', null, '<span class="ev ev-' + g.evidence + '">' + label[g.evidence] + '</span>'));
      row.appendChild(el('td', null, g.fragment || '—'));
      row.appendChild(el('td', null, g.role));
      row.appendChild(el('td', null, g.count_note + ' <span class="muted">[' + g.sources.join(', ') + ']</span>'));
      tb.appendChild(row);
    });
    t.appendChild(tb);
  }

  /* ------------------------------------------------------------ readouts */
  function dl(id, pairs) {
    var d = document.getElementById(id), html = '';
    pairs.forEach(function (p) { html += '<dt>' + p[0] + '</dt><dd>' + p[1] + '</dd>'; });
    if (d.innerHTML !== html) d.innerHTML = html;
  }
  function updateReadouts(r, sky) {
    var jd = AK.jdFromYears(r.Y);
    var eg = AK.egyptianDate(jd);
    $('#dateOut').textContent = AK.formatDate(jd);
    $('#egyptOut').textContent = eg.day + ' ' + eg.month + ', year ' + eg.year + ' of Nabonassar';
    $('#turnOut').textContent = 'crank (a1) ' + fmt(r.crankTurns, 1) + ' turns · b1 ' + fmt(r.Y, 3) + ' turns';
    var crank = $('#crank');
    crank.setAttribute('aria-valuenow', r.Y.toFixed(3));
    crank.setAttribute('aria-valuetext', AK.formatDate(jd));
    function vs(mech, real) {
      if (!state.showSky) return '';
      var d = AK.sgn180(mech - real);
      return ' <span class="' + (Math.abs(d) > 5 ? 'bad' : 'muted') + '">(sky ' + signed(d, 1) + '°)</span>';
    }
    dl('roFront', [
      ['Sun', lonText(r.sun) + vs(r.sun, sky.sun)],
      ['Moon', lonText(r.moon) + vs(r.moon, sky.moon)],
      ['Pin and slot', signed(r.moonEquation, 2) + '° on the mean Moon'],
      ['Phase', phaseName(r.elongation) + ', ' + Math.round(r.illuminated * 100) + '% lit' + (state.showSky ? ' <span class="muted">(sky: ' + Math.round(sky.illuminated * 100) + '%)</span>' : '')],
      ['Planets', ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn'].map(function (n) { return n.slice(0, 3) + ' ' + Math.round(r.planets[n].lon) + '°'; }).join(', ')]
    ]);
    var mi = r.metonic.info;
    dl('roMetonic', [
      ['Metonic', 'cell ' + r.metonic.cell + ' of 235: year ' + mi.year + ', ' + mi.month + (mi.intercalary ? ' (intercalary)' : '')],
      ['Games', 'year ' + r.games.year + ': ' + r.games.games.join(', ')],
      ['Callippic', 'sector ' + r.callippic.sector + ' of 4 (19 years each)']
    ]);
    var e = r.saros.engraved, glyph = [];
    if (e.lunar) glyph.push('<b class="g-l">' + (e.lunar.type === 'penumbral' ? 'σ' : 'Σ') + '</b> ' + eclipseWord(e.lunar.type) + ' lunar');
    if (e.solar) glyph.push('<b class="g-s">Η</b> ' + e.solar.type + ' solar');
    var real = AK.realEclipsesForMonth(Math.floor(r.months));
    var realTxt = real.length ? real.map(function (x) {
      return x.type + ' ' + (x.lunar ? 'lunar' : 'solar') + ', ' + AK.formatDate(x.jd, true) + ' (Saros ' + x.saros + ')';
    }).join('; ') : 'none this month';
    dl('roSaros', [
      ['Saros', 'cell ' + r.saros.cell + ' of 223' + (r.saros.cycle ? ', ' + r.saros.cycle + ' cycle' + (r.saros.cycle === 1 ? '' : 's') + ' after 205 BC' : '')],
      ['Engraved', glyph.length ? glyph.join(' + ') : 'no glyph'],
      ['In the sky', realTxt],
      ['Exeligmos', 'add ' + r.exeligmos.hours + ' hours to the glyph times']
    ]);
  }

  /* ------------------------------------------------------------ the crank */
  var crankEl = $('#crank'), armEl = $('#crankArm');
  (function crankTeeth() {
    var g = $('#crankTeeth'), html = '';
    for (var i = 0; i < 48; i++) {
      var a = i * 360 / 48;
      html += '<polygon class="crank-tooth" points="-2.6,-49 0,-55 2.6,-49" transform="rotate(' + a.toFixed(2) + ')"/>';
    }
    g.innerHTML = html;
  })();
  function crankAngleTurns() { return state.Y * TURNS_PER_YEAR[state.crankMode]; }
  var dragging = null;
  function pointerAngle(ev) {
    var b = crankEl.getBoundingClientRect();
    return Math.atan2(ev.clientY - (b.top + b.height / 2), ev.clientX - (b.left + b.width / 2));
  }
  crankEl.addEventListener('pointerdown', function (ev) {
    dragging = { a: pointerAngle(ev), id: ev.pointerId };
    crankEl.classList.add('dragging');
    try { crankEl.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
    stopPlay();
    ev.preventDefault();
  });
  crankEl.addEventListener('pointermove', function (ev) {
    if (!dragging || ev.pointerId !== dragging.id) return;
    var a = pointerAngle(ev), d = a - dragging.a;
    if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU;
    dragging.a = a;
    advanceTurns(d / TAU); // clockwise drag turns time forward
    $('#crankHint').textContent = 'clockwise: forward in time';
  });
  function endDrag(ev) {
    if (!dragging || (ev && ev.pointerId !== dragging.id)) return;
    dragging = null; crankEl.classList.remove('dragging');
  }
  crankEl.addEventListener('pointerup', endDrag);
  crankEl.addEventListener('pointercancel', endDrag);
  crankEl.addEventListener('lostpointercapture', endDrag);
  crankEl.addEventListener('keydown', function (ev) {
    var k = ev.key, step = null;
    if (k === 'ArrowRight' || k === 'ArrowUp') step = 1 / 24;
    else if (k === 'ArrowLeft' || k === 'ArrowDown') step = -1 / 24;
    else if (k === 'PageUp') step = 1;
    else if (k === 'PageDown') step = -1;
    else if (k === 'Home') { setY(1 / 365.25); ev.preventDefault(); return; }
    if (step === null) return;
    if (ev.shiftKey) step *= 6;
    stopPlay();
    advanceTurns(step);
    ev.preventDefault();
    ev.stopPropagation();
  });
  function advanceTurns(t) {
    setY(state.Y + t / TURNS_PER_YEAR[state.crankMode]);
  }

  /* ------------------------------------------------------------ sound */
  var audio = null, lastTooth = null, lastClick = 0;
  function click() {
    if (!state.sound || !audio) return;
    var now = audio.currentTime;
    if (now - lastClick < 0.018) return;
    lastClick = now;
    var len = Math.floor(audio.sampleRate * 0.012), buf = audio.createBuffer(1, len, audio.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 6);
    var src = audio.createBufferSource(), flt = audio.createBiquadFilter(), gn = audio.createGain();
    flt.type = 'bandpass'; flt.frequency.value = 3200; flt.Q.value = 3; gn.gain.value = 0.35;
    src.buffer = buf; src.connect(flt); flt.connect(gn); gn.connect(audio.destination); src.start();
  }
  function soundTick(r) {
    var tooth = Math.floor(r.crankTurns * 48);
    if (lastTooth !== null && tooth !== lastTooth && Math.abs(tooth - lastTooth) < 40) click();
    lastTooth = tooth;
  }

  /* ------------------------------------------------------------ main update */
  var pending = false, lastR = null, lastSky = null;
  function setY(Y) {
    state.Y = Math.max(Y_MIN, Math.min(Y_MAX, Y));
    request();
  }
  function request() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(frame);
  }
  function frame() {
    pending = false;
    var r = AK.read(state.Y), sky = AK.sky(AK.jdFromYears(state.Y));
    lastR = r; lastSky = sky;
    armEl.setAttribute('transform', 'rotate(' + (crankAngleTurns() * 360 % 360).toFixed(2) + ')');
    $('#era').value = String(state.Y);
    Object.keys(canvases).forEach(function (k) {
      var cv = canvases[k];
      if (cv.visible === false) { cv.stale = true; return; } // off screen: draw when it comes back
      cv.stale = false;
      if (fit(cv)) cv.draw(cv, r, sky);
    });
    updateReadouts(r, sky);
    soundTick(r);
  }
  function redrawAll() {
    Object.keys(canvases).forEach(function (k) { canvases[k].w = 0; });
    request();
  }

  /* ------------------------------------------------------------ play */
  var playT = null, stepTimer = null;
  function setPlaying(on) {
    state.playing = on;
    var b = $('#play');
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.textContent = on ? 'Pause' : 'Play';
    if (stepTimer) { clearInterval(stepTimer); stepTimer = null; }
    if (!on) return;
    if (reduceMotion.matches) {
      // no continuous motion: one discrete step a second
      stepTimer = setInterval(function () { setY(state.Y + SPEED[state.speed]); if (state.Y >= Y_MAX) setPlaying(false); }, 1000);
      return;
    }
    playT = null;
    requestAnimationFrame(tick);
  }
  function stopPlay() { if (state.playing) setPlaying(false); }
  function tick(t) {
    if (!state.playing || reduceMotion.matches) return;
    if (playT !== null) {
      var dt = Math.min(0.1, (t - playT) / 1000);
      setY(state.Y + dt * SPEED[state.speed]);
      if (state.Y >= Y_MAX) { setPlaying(false); return; }
    }
    playT = t;
    requestAnimationFrame(tick);
  }

  /* ------------------------------------------------------------ wiring */
  function stepBy(what) {
    var sign = what.charAt(0) === '-' ? -1 : 1, w = what.replace('-', '');
    var dy = { day: 1 / AK.YEAR_DAYS, month: MONTH_YEARS, year: 1, saros: 223 * MONTH_YEARS }[w];
    setY(state.Y + sign * dy);
  }
  $$('.steps button').forEach(function (b) { b.addEventListener('click', function () { stopPlay(); stepBy(b.getAttribute('data-step')); }); });
  $('#play').addEventListener('click', function () { setPlaying(!state.playing); });
  $('#speed').addEventListener('change', function (e) { state.speed = e.target.value; });
  $('#crankMode').addEventListener('change', function (e) { state.crankMode = e.target.value; request(); });
  $('#era').addEventListener('input', function (e) { stopPlay(); setY(parseFloat(e.target.value)); });
  $('#showSky').addEventListener('change', function (e) { state.showSky = e.target.checked; request(); });
  $('#sound').addEventListener('change', function (e) {
    state.sound = e.target.checked;
    if (state.sound && !audio) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audio = new AC();
    }
    if (audio && audio.state === 'suspended') audio.resume();
  });
  $('#pinScale').addEventListener('change', function (e) { state.pinScale = parseFloat(e.target.value); request(); });
  var JUMPS = {
    epoch: function () { return 1 / 365.25; },
    month13: function () { return 12.985 * MONTH_YEARS; }, // just before the mean conjunction that ends month 13
    wreck: function () { return AK.yearsFromJd(AK.jdFromDate(-64, 7, 1)); },
    today: function () { var d = new Date(); return AK.yearsFromJd(AK.jdFromDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate() + d.getUTCHours() / 24)); }
  };
  $$('.jumps button').forEach(function (b) {
    b.addEventListener('click', function () { stopPlay(); setY(JUMPS[b.getAttribute('data-jump')]()); });
  });
  $$('#trainSel button').forEach(function (b) {
    b.addEventListener('click', function () {
      state.train = b.getAttribute('data-train');
      $$('#trainSel button').forEach(function (o) { o.setAttribute('aria-pressed', o === b ? 'true' : 'false'); });
      request();
    });
  });
  $$('.tabs button').forEach(function (b) {
    b.addEventListener('click', function () {
      state.view = b.getAttribute('data-view');
      $('#faces').setAttribute('data-view', state.view);
      $$('.tabs button').forEach(function (o) { o.setAttribute('aria-selected', o === b ? 'true' : 'false'); });
      redrawAll();
    });
  });
  // keyboard anywhere (outside form fields): arrows turn the crank, space plays
  document.addEventListener('keydown', function (ev) {
    var tag = (ev.target && ev.target.tagName) || '';
    if (/INPUT|SELECT|TEXTAREA|BUTTON/.test(tag) || ev.target === crankEl) return;
    if (ev.key === 'ArrowRight') { advanceTurns(1 / 24); ev.preventDefault(); }
    else if (ev.key === 'ArrowLeft') { advanceTurns(-1 / 24); ev.preventDefault(); }
    else if (ev.key === ' ') { setPlaying(!state.playing); ev.preventDefault(); }
  });
  if (window.IntersectionObserver) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var cv = canvases[en.target.id];
        cv.visible = en.isIntersecting;
        if (cv.visible && cv.stale) request();
      });
    }, { rootMargin: '200px' });
    Object.keys(canvases).forEach(function (k) { io.observe(canvases[k].el); });
  }
  if (window.ResizeObserver) {
    var ro = new ResizeObserver(function () { request(); });
    Object.keys(canvases).forEach(function (k) { ro.observe(canvases[k].el); });
  } else {
    window.addEventListener('resize', request);
  }
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onScheme = function () { readColours(); LAYOUT = null; redrawAll(); };
    if (mq.addEventListener) mq.addEventListener('change', onScheme); else if (mq.addListener) mq.addListener(onScheme);
  }

  readColours();
  buildProof();
  buildDriftTable();
  buildGlyphTable();
  buildEvidence();
  $('#pinNote').innerHTML = 'Offset over pin radius: 1.1/9.6 = ' + AK.ECC.toFixed(4) + '. The largest lead or lag this gives is asin(' + AK.ECC.toFixed(4) + ') = ' + (Math.asin(AK.ECC) / D2R).toFixed(2) +
    '°, reached when the slot stands at right angles to the line between the two axes. Hipparchus’s two values, as Ptolemy reports them (<i>Almagest</i> IV.11), give 5.98° (eccentre, 327⅔ : 3144) and 4.55° (epicycle, 247½ : 3122½). Modern theory’s largest lunar term is 6.29° sin M. The pin turns once per anomalistic month: 4237/56165 of a year, 27.553 days against the true 27.555. The measurements of a corroded original are good to perhaps 5 per cent, which spans roughly 6.3° to 6.9°.';
  setTimeout(function () { computeDrift(); driftC.dots = null; driftC.stale = true; request(); }, 60);
  request();
})();
