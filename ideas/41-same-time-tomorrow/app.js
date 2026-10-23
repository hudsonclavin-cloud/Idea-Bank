/* app.js — the page. All astronomy lives in sun.js; this file only draws and wires controls. */
(function () {
  'use strict';
  const S = globalThis.SunModel;
  const $ = (id) => document.getElementById(id);
  const RAD = Math.PI / 180;
  const DEG = 180 / Math.PI;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const darkMq = matchMedia('(prefers-color-scheme: dark)');

  // ---------- today, this year ----------
  const now = new Date();
  const YEAR = now.getFullYear();
  const TODAY = { y: YEAR, m: now.getMonth() + 1, d: now.getDate() };
  const D0 = S.daysSinceJ2000(YEAR, 1, 1, 0);
  const NDAYS = S.daysInYear(YEAR);
  const TODAY_INDEX = Math.round(S.daysSinceJ2000(TODAY.y, TODAY.m, TODAY.d, 0) - D0);
  const EARTH_NOW = S.earthElements((D0 + NDAYS / 2) / 36525);
  const zoneGuess = Math.round(-now.getTimezoneOffset() / 15) / 4;

  const state = {
    lat: 40,
    clock: 9,
    lon: Math.round(zoneGuess * 15 * 100) / 100,
    zone: zoneGuess,
    el: { ...EARTH_NOW },
    preset: 'earth',
    day: TODAY_INDEX,
    playing: false,
    noonDate: { ...TODAY },
  };
  const cache = { figure: null, proj: null, rise: null, seasons: null, shape: null, eot: null };

  // ---------- helpers ----------
  const css = () => getComputedStyle(document.documentElement);
  const col = (name) => css().getPropertyValue(name).trim();
  const pad2 = (n) => String(n).padStart(2, '0');
  const dateOf = (i) => {
    const o = S.dateFromDays(D0 + i);
    return { m: o.month, d: Math.floor(o.day) };
  };
  const dateLabel = (i) => {
    const { m, d } = dateOf(i);
    return `${d} ${MONTHS[m - 1]}`;
  };
  const indexOf = (m, d) => Math.round(S.daysSinceJ2000(YEAR, m, d, 0) - D0);
  const fmtLat = (lat) => (lat === 0 ? '0°' : `${Math.abs(lat).toFixed(1).replace(/\.0$/, '')}°${lat > 0 ? 'N' : 'S'}`);
  const fmtClock = (h) => S.hoursToHM(h);
  const fmtLen = (h) => {
    const m = Math.round(h * 60);
    return `${Math.floor(m / 60)} h ${pad2(m % 60)} min`;
  };
  const signed = (x, dp = 1) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(dp)}`;
  const compass = (az) => COMPASS[Math.round(S.wrap360(az) / 22.5) % 16];
  const fmtZone = (z) => {
    const sign = z >= 0 ? '+' : '−';
    const a = Math.abs(z);
    const h = Math.floor(a);
    const m = Math.round((a - h) * 60);
    return `UTC${sign}${h}${m ? ':' + pad2(m) : ''}`;
  };
  const zoneMeridian = () => 15 * state.zone;

  function setupCanvas(canvas, cssH) {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = Math.max(200, canvas.clientWidth || canvas.parentElement.clientWidth);
    const h = Math.round(cssH);
    canvas.style.height = `${h}px`;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.font = '12px system-ui, sans-serif';
    return { ctx, w, h };
  }

  function label(ctx, text, x, y, opts = {}) {
    const { align = 'left', color = col('--ink'), bg = col('--chart-bg'), size = 11, weight = '600', padX = 3, avoid = null } = opts;
    ctx.save();
    ctx.font = `${weight} ${size}px system-ui, sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    const wText = ctx.measureText(text).width;
    const x0 = align === 'left' ? x - padX : align === 'right' ? x - wText - padX : x - wText / 2 - padX;
    if (avoid) {
      // Nudge vertically until this label's box clears every box already placed.
      const box = { x: x0, y: y - size * 0.72, w: wText + 2 * padX, h: size * 1.44 };
      const hits = (b) => avoid.some((a) => !(b.x + b.w < a.x || a.x + a.w < b.x || b.y + b.h < a.y || a.y + a.h < b.y));
      for (const dy of [0, 15, -15, 30, -30, 45, -45]) {
        if (!hits({ ...box, y: box.y + dy })) {
          y += dy;
          box.y += dy;
          break;
        }
      }
      avoid.push(box);
    }
    if (bg) {
      ctx.globalAlpha = 0.82;
      ctx.fillStyle = bg;
      ctx.fillRect(x0, y - size * 0.72, wText + 2 * padX, size * 1.44);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  // ---------- computation ----------
  function recompute() {
    cache.figure = S.skyFigure(state.el, YEAR, state.clock, state.lat, state.lon, state.zone);
    cache.rise = S.yearRiseSet(state.el, YEAR, state.lat, state.lon, state.zone);
    cache.seasons = S.seasonPoints(state.el, YEAR);
    cache.shape = S.shape(state.el, 366);
    cache.eot = [];
    for (let i = 0; i < NDAYS; i++) {
      const L = S.meanLongitude(D0 + i + 0.5);
      const p = S.eotParts(state.el, L);
      cache.eot.push({ tilt: p.tilt * 4, orbit: p.orbit * 4, total: p.total * 4, delta: S.sunAt(state.el, L).delta });
    }
  }

  function seasonIndex(key) {
    const s = cache.seasons[key];
    if (!s) return null;
    return Math.max(0, Math.min(NDAYS - 1, Math.round(s.d - D0 - 0.5)));
  }

  // ---------- 1. the sky ----------
  function drawSky() {
    const canvas = $('sky');
    const W = canvas.clientWidth || 600;
    const { ctx, w, h } = setupCanvas(canvas, Math.min(560, Math.max(330, W * 0.78)));
    const pts = cache.figure;

    // --- a level camera with a rectilinear lens, aimed at the figure's mean direction (gnomonic projection) ---
    const enu = (az, alt) => {
      const a = az * RAD;
      const e = alt * RAD;
      return [Math.cos(e) * Math.sin(a), Math.cos(e) * Math.cos(a), Math.sin(e)];
    };
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    let mx = 0;
    let my = 0;
    let mz = 0;
    for (const p of pts) {
      const v = enu(p.az, p.alt);
      mx += v[0];
      my += v[1];
      mz += v[2];
    }
    const mlen = Math.hypot(mx, my, mz);
    let f = mlen > 1e-6 ? [mx / mlen, my / mlen, mz / mlen] : [0, 0, 1];
    const makeFrame = (fwd) => {
      const horiz = Math.hypot(fwd[0], fwd[1]);
      // right = forward × up, normalised; a camera pointing straight up gets north at the top and east on the left
      const r = horiz > 1e-6 ? [fwd[1] / horiz, -fwd[0] / horiz, 0] : [-1, 0, 0];
      const u = [r[1] * fwd[2] - r[2] * fwd[1], r[2] * fwd[0] - r[0] * fwd[2], r[0] * fwd[1] - r[1] * fwd[0]];
      return { f: fwd, right: r, camUp: u };
    };
    let cam = makeFrame(f);
    const toImg = (c, az, alt) => {
      const v = enu(az, alt);
      const d = dot(v, c.f);
      if (d < 0.03) return null; // behind, or more than ~88° off axis
      return { xi: dot(v, c.right) / d, yi: dot(v, c.camUp) / d, d };
    };
    let img = pts.map((p) => toImg(cam, p.az, p.alt));
    if (img.filter((q) => q && q.d >= 0.25).length < pts.length / 2) {
      // degenerate (the pole: the figure rings the whole horizon): look straight up instead
      cam = makeFrame([0, 0, 1]);
      f = cam.f;
      img = pts.map((p) => toImg(cam, p.az, p.alt));
    }
    const { right, camUp } = cam;
    const alt0 = Math.asin(Math.max(-1, Math.min(1, f[2]))) * DEG;
    const az0 = Math.atan2(f[0], f[1]) * DEG;
    const dirAt = (xi, yi) => [f[0] + xi * right[0] + yi * camUp[0], f[1] + xi * right[1] + yi * camUp[1], f[2] + xi * right[2] + yi * camUp[2]];
    const framed = img.filter((q) => q && q.d >= 0.25);
    if (!framed.length) {
      ctx.fillStyle = col('--sky-top');
      ctx.fillRect(0, 0, w, h);
      label(ctx, 'Nothing to frame at this latitude and clock time.', w / 2, h / 2, { align: 'center', color: '#fff', bg: null, weight: '500' });
      cache.proj = pts.map(() => ({ x: NaN, y: NaN, up: false }));
      return;
    }
    let x0 = Math.min(...framed.map((q) => q.xi));
    let x1 = Math.max(...framed.map((q) => q.xi));
    let y0 = Math.min(...framed.map((q) => q.yi));
    let y1 = Math.max(...framed.map((q) => q.yi));
    const padX = Math.max(0.12, 0.3 * (x1 - x0));
    x0 -= padX;
    x1 += padX;
    y0 -= 0.09;
    y1 += 0.09;
    const yHorImg = -Math.tan(alt0 * RAD); // a level camera keeps the horizon a level straight line
    if (yHorImg < y0 && yHorImg > y0 - 0.3) y0 = yHorImg - 0.12; // the horizon is just below the figure: include it with a strip of ground
    const mL = 8;
    const mR = 8;
    const top = 8;
    const bottom = 24;
    const scale = Math.min((w - mL - mR) / (x1 - x0), (h - top - bottom) / (y1 - y0)); // px per focal length
    const xmid = (x0 + x1) / 2;
    const ymid = (y0 + y1) / 2;
    const cx = mL + (w - mL - mR) / 2;
    const cy = top + (h - top - bottom) / 2;
    const X = (xi) => cx + (xi - xmid) * scale;
    const Y = (yi) => cy - (yi - ymid) * scale;
    const imgX = (px) => (px - cx) / scale + xmid;
    const imgY = (py) => ymid - (py - cy) / scale;
    const yHor = Y(yHorImg);
    const inFrame = (px, py) => px >= mL && px <= w - mR && py >= top && py <= h - bottom;

    // sky
    const zenithY = f[2] > 0.03 ? Y(camUp[2] / f[2]) : -h;
    const g = ctx.createLinearGradient(0, Math.min(zenithY, yHor - 1), 0, yHor);
    g.addColorStop(0, col('--sky-top'));
    g.addColorStop(1, col('--sky-hor'));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // ground and a skyline along the horizon
    if (yHor < h) {
      ctx.fillStyle = col('--ground');
      ctx.fillRect(0, Math.max(0, yHor), w, h - Math.max(0, yHor));
      if (yHor > -40) {
        ctx.fillStyle = col('--ground-2');
        const heights = [1.2, 2.6, 1.6, 3.4, 2.1, 1.4, 2.9, 1.1, 2.3, 3.1, 1.7, 2.4, 1.3, 2.8, 1.9, 2.2];
        const bw = Math.max(14, w / 16);
        for (let i = 0; i * bw < w; i++) {
          const hh = Math.tan(heights[i % heights.length] * RAD) * scale;
          ctx.fillRect(i * bw, yHor - hh, bw - 3, hh);
        }
      }
    }
    const placed = []; // boxes of labels already drawn; later labels dodge them
    // lines of equal altitude (small circles: curves in a rectilinear picture), labelled at their leftmost visible point
    ctx.strokeStyle = 'rgba(255,255,255,0.32)';
    ctx.lineWidth = 0.7;
    for (let a = 10; a <= 80; a += 10) {
      let leftmost = null;
      let pen = false;
      ctx.beginPath();
      for (let daz = -150; daz <= 150; daz += 2) {
        const q = toImg(cam, az0 + daz, a);
        if (!q) {
          pen = false;
          continue;
        }
        const px = X(q.xi);
        const py = Y(q.yi);
        if (px < -60 || px > w + 60 || py < -60 || py > h + 60) {
          pen = false;
          continue;
        }
        if (!pen) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
        pen = true;
        if (inFrame(px, py) && (!leftmost || px < leftmost.px)) leftmost = { px, py };
      }
      ctx.stroke();
      if (leftmost) label(ctx, `${a}°`, Math.max(leftmost.px + 3, mL + 4), leftmost.py, { color: 'rgba(255,255,255,0.9)', bg: null, weight: '500', avoid: placed });
    }
    if (yHor > top && yHor < h - bottom) label(ctx, '0°', mL + 4, yHor - 8, { color: 'rgba(255,255,255,0.9)', bg: null, weight: '500', avoid: placed });
    // compass directions along the bottom edge of the picture
    {
      const yEdge = imgY(h - bottom);
      const azOf = (px) => {
        const v = dirAt(imgX(px), yEdge);
        return S.wrap360(Math.atan2(v[0], v[1]) * DEG);
      };
      const span = Math.abs(S.wrap180(azOf(w - mR) - azOf(mL)));
      const step = span > 100 ? 30 : span > 40 ? 15 : span > 12 ? 5 : 1;
      let prevAz = azOf(mL);
      let prevPx = mL;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      for (let px = mL + 2; px <= w - mR; px += 2) {
        const az = azOf(px);
        const dAz = S.wrap180(az - prevAz);
        if (Math.abs(dAz) > 1e-9 && Math.abs(dAz) < 90) {
          const lo = Math.min(prevAz, prevAz + dAz);
          const hi = Math.max(prevAz, prevAz + dAz);
          for (let m = Math.ceil(lo / step) * step; m <= hi; m += step) {
            const xm = prevPx + ((m - prevAz) / dAz) * (px - prevPx);
            if (xm < mL + 10 || xm > w - mR - 10) continue;
            const azn = S.wrap360(m);
            const isCompass = azn % 45 === 0;
            ctx.strokeStyle = 'rgba(255,255,255,0.35)';
            ctx.beginPath();
            ctx.moveTo(xm, h - bottom);
            ctx.lineTo(xm, h - bottom + 4);
            ctx.stroke();
            ctx.fillStyle = isCompass ? '#fff' : 'rgba(255,255,255,0.85)';
            ctx.font = `${isCompass ? '700' : '500'} 11px system-ui, sans-serif`;
            ctx.fillText(isCompass ? compass(azn) : `${azn}°`, xm, h - 8);
          }
        }
        prevAz = az;
        prevPx = px;
      }
    }
    if (yHor > h) {
      const v = dirAt(xmid, imgY(h - bottom));
      const altEdge = Math.asin(v[2] / Math.hypot(v[0], v[1], v[2])) * DEG;
      label(ctx, `horizon ${altEdge.toFixed(0)}° below the bottom edge`, mL + 6, h - bottom - 10, { color: '#fff', bg: null, weight: '500' });
    } else if (yHor < top) {
      label(ctx, 'horizon above the top edge: at this clock time the Sun is below the horizon all year', mL + 6, top + 12, { color: '#fff', bg: 'rgba(0,0,0,0.35)', weight: '500' });
    }

    // the Sun, one disc per day, at its true angular size (0.53°)
    const r = Math.max(2.2, Math.tan(0.266 * RAD) * scale);
    const proj = pts.map((p, i) => (img[i] ? { x: X(img[i].xi), y: Y(img[i].yi), up: p.alt > -0.27 } : { x: NaN, y: NaN, up: false }));
    cache.proj = proj;
    const exposing = state.playing;
    const sun = col('--sun');
    const edge = col('--sun-edge');
    const drawDisc = (p, strong) => {
      if (Number.isNaN(p.x)) return;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      if (p.up) {
        ctx.fillStyle = sun;
        ctx.globalAlpha = strong ? 0.92 : 0.22;
        ctx.fill();
        ctx.globalAlpha = 1;
      } else {
        ctx.strokeStyle = strong ? sun : 'rgba(255,220,120,0.45)';
        ctx.lineWidth = strong ? 1.2 : 0.8;
        ctx.stroke();
      }
    };
    for (let i = 0; i < proj.length; i++) drawDisc(proj[i], !exposing || i <= state.day);
    // the current day's label goes before the season labels, which dodge it
    const cur = proj[state.day];
    const curOk = cur && !Number.isNaN(cur.x);
    if (curOk) {
      const txt = `${dateLabel(state.day)}${state.day === TODAY_INDEX ? ' (today)' : ''}`;
      const side = cur.x > cx ? 'left' : 'right';
      label(ctx, txt, side === 'right' ? cur.x + r + 9 : cur.x - r - 9, cur.y - r - 10, { align: side === 'right' ? 'left' : 'right', color: '#111', bg: '#fff', size: 12, avoid: placed });
    }
    // season labels: the two equinoxes sit near the crossing, so they take opposite sides
    const seasons = [
      ['juneSolstice', 'solstice', null],
      ['decemberSolstice', 'solstice', null],
      ['marchEquinox', 'equinox', 'left'],
      ['septemberEquinox', 'equinox', 'right'],
    ];
    for (const [key, word, forced] of seasons) {
      const i = seasonIndex(key);
      if (i === null || (exposing && i > state.day)) continue;
      const p = proj[i];
      if (Number.isNaN(p.x) || !inFrame(p.x, p.y)) continue;
      const side = forced || (p.x > cx ? 'left' : 'right');
      const x = side === 'right' ? p.x + r + 6 : p.x - r - 6;
      label(ctx, `${dateLabel(i)} ${word}`, x, p.y, { align: side === 'right' ? 'left' : 'right', color: '#fff', bg: 'rgba(0,0,0,0.35)', weight: '500', avoid: placed });
    }
    if (curOk) {
      ctx.beginPath();
      ctx.arc(cur.x, cur.y, r + 4, 0, Math.PI * 2);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cur.x, cur.y, r, 0, Math.PI * 2);
      ctx.fillStyle = sun;
      ctx.fill();
      ctx.strokeStyle = edge;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  function updateSkyReadout() {
    const p = cache.figure[state.day];
    const sundial = state.clock + p.eotMin / 60 + (state.lon - zoneMeridian()) / 15;
    const where = p.alt >= 0
      ? `<strong>${p.alt.toFixed(1)}°</strong> above the horizon, azimuth ${p.az.toFixed(0)}° (${compass(p.az)})`
      : `<strong>${(-p.alt).toFixed(1)}°</strong> below the horizon: not yet risen (or already set)`;
    $('skyReadout').innerHTML = `${dateLabel(state.day)} at ${fmtClock(state.clock)}: the Sun is ${where}. A sundial reads ${fmtClock(sundial)}; the equation of time is ${signed(p.eotMin)} min.`;
    $('dayOut').value = dateLabel(state.day);
  }

  // ---------- 2. two reasons ----------
  function monthTicks(ctx, X, y0, y1, labelY) {
    ctx.save();
    ctx.strokeStyle = col('--grid');
    ctx.lineWidth = 1;
    ctx.fillStyle = col('--muted');
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    for (let m = 1; m <= 12; m++) {
      const i = indexOf(m, 1);
      const x = X(i);
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y1);
      ctx.stroke();
      const next = m < 12 ? indexOf(m + 1, 1) : NDAYS;
      ctx.fillText(MONTHS[m - 1], X((i + next) / 2), labelY);
    }
    ctx.restore();
  }

  function drawSeries(ctx, X, Y, values, color, dashed, width) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dashed ? [5, 4] : []);
    ctx.beginPath();
    values.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
    ctx.stroke();
    ctx.restore();
  }

  function drawEot() {
    const canvas = $('eotChart');
    const { ctx, w, h } = setupCanvas(canvas, 210);
    const left = 36;
    const right = 8;
    const top = 8;
    const bottom = 22;
    let amp = 0;
    for (const e of cache.eot) amp = Math.max(amp, Math.abs(e.total), Math.abs(e.tilt), Math.abs(e.orbit));
    const yMax = Math.max(10, Math.ceil(amp / 5) * 5);
    const X = (i) => left + ((w - left - right) * i) / NDAYS;
    const Y = (v) => top + ((h - top - bottom) * (yMax - v)) / (2 * yMax);
    ctx.fillStyle = col('--chart-bg');
    ctx.fillRect(0, 0, w, h);
    monthTicks(ctx, X, top, h - bottom, h - 7);
    ctx.strokeStyle = col('--grid');
    ctx.fillStyle = col('--muted');
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const stepY = yMax > 30 ? 20 : yMax > 15 ? 10 : 5;
    for (let v = -yMax; v <= yMax; v += stepY) {
      ctx.beginPath();
      ctx.moveTo(left, Y(v));
      ctx.lineTo(w - right, Y(v));
      ctx.lineWidth = v === 0 ? 1.4 : 1;
      ctx.strokeStyle = v === 0 ? col('--line-2') : col('--grid');
      ctx.stroke();
      ctx.fillText(`${v > 0 ? '+' : ''}${v}`, left - 5, Y(v));
    }
    ctx.save();
    ctx.translate(10, (top + h - bottom) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('minutes', 0, 0);
    ctx.restore();
    drawSeries(ctx, X, Y, cache.eot.map((e) => e.tilt), col('--c-tilt'), true, 1.5);
    drawSeries(ctx, X, Y, cache.eot.map((e) => e.orbit), col('--c-orbit'), true, 1.5);
    drawSeries(ctx, X, Y, cache.eot.map((e) => e.total), col('--c-total'), false, 2.2);
    // current day
    ctx.strokeStyle = col('--accent');
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(X(state.day + 0.5), top);
    ctx.lineTo(X(state.day + 0.5), h - bottom);
    ctx.stroke();
    label(ctx, 'sundial fast', w - right - 4, top + 9, { align: 'right', color: col('--muted'), weight: '500', bg: null });
    label(ctx, 'sundial slow', w - right - 4, h - bottom - 9, { align: 'right', color: col('--muted'), weight: '500', bg: null });
  }

  function drawDec() {
    const canvas = $('decChart');
    const { ctx, w, h } = setupCanvas(canvas, 150);
    const left = 36;
    const right = 8;
    const top = 8;
    const bottom = 22;
    const yMax = Math.max(10, Math.ceil((state.el.obl + 2) / 10) * 10);
    const X = (i) => left + ((w - left - right) * i) / NDAYS;
    const Y = (v) => top + ((h - top - bottom) * (yMax - v)) / (2 * yMax);
    ctx.fillStyle = col('--chart-bg');
    ctx.fillRect(0, 0, w, h);
    monthTicks(ctx, X, top, h - bottom, h - 7);
    ctx.fillStyle = col('--muted');
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let v = -yMax; v <= yMax; v += yMax) {
      ctx.beginPath();
      ctx.moveTo(left, Y(v));
      ctx.lineTo(w - right, Y(v));
      ctx.lineWidth = v === 0 ? 1.4 : 1;
      ctx.strokeStyle = v === 0 ? col('--line-2') : col('--grid');
      ctx.stroke();
      ctx.fillText(`${v > 0 ? '+' : ''}${v}°`, left - 5, Y(v));
    }
    drawSeries(ctx, X, Y, cache.eot.map((e) => e.delta), col('--c-tilt'), false, 2);
    ctx.strokeStyle = col('--accent');
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(X(state.day + 0.5), top);
    ctx.lineTo(X(state.day + 0.5), h - bottom);
    ctx.stroke();
    const ne = seasonIndex('juneSolstice');
    const se = seasonIndex('decemberSolstice');
    if (ne !== null) label(ctx, `+${state.el.obl.toFixed(1)}°`, X(ne) + 4, Y(state.el.obl) + 8, { color: col('--muted'), weight: '500' });
    if (se !== null) label(ctx, `−${state.el.obl.toFixed(1)}°`, X(se) - 4, Y(-state.el.obl) - 8, { align: 'right', color: col('--muted'), weight: '500' });
  }

  function drawShape() {
    const canvas = $('shapeChart');
    const W = canvas.clientWidth || 400;
    const { ctx, w, h } = setupCanvas(canvas, Math.min(420, Math.max(280, W * 0.92)));
    const pts = cache.shape; // x: minutes, y: degrees
    const xs = pts.map((p) => p.x / 4); // degrees of hour angle, so 1° = 1° on this chart
    const ys = pts.map((p) => p.y);
    const xr = Math.max(Math.abs(Math.min(...xs)), Math.abs(Math.max(...xs)), 1.5) + 1;
    const yr = Math.max(Math.abs(Math.min(...ys)), Math.abs(Math.max(...ys)), 5) + 4;
    const left = 36;
    const right = 10;
    const top = 10;
    const bottom = 26;
    const scale = Math.min((w - left - right) / (2 * xr), (h - top - bottom) / (2 * yr));
    const cx = left + (w - left - right) / 2;
    const cy = top + (h - top - bottom) / 2;
    const X = (deg) => cx + deg * scale;
    const Y = (deg) => cy - deg * scale;
    ctx.fillStyle = col('--chart-bg');
    ctx.fillRect(0, 0, w, h);
    // grid: x in minutes (4 min = 1°), y in degrees
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = col('--muted');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const xStepMin = [5, 10, 20, 30, 60].find((s) => (s / 4) * scale >= 34) || 60; // keep tick labels ≥ 34 px apart
    for (let m = -Math.ceil((xr * 4) / xStepMin) * xStepMin; m <= xr * 4; m += xStepMin) {
      const x = X(m / 4);
      if (x < left || x > w - right) continue;
      ctx.strokeStyle = m === 0 ? col('--line-2') : col('--grid');
      ctx.lineWidth = m === 0 ? 1.4 : 1;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, h - bottom);
      ctx.stroke();
      ctx.fillText(`${m > 0 ? '+' : ''}${m}`, x, h - 10);
    }
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const yStep = yr > 40 ? 20 : 10;
    for (let d = -Math.ceil(yr / yStep) * yStep; d <= yr; d += yStep) {
      const y = Y(d);
      if (y < top || y > h - bottom) continue;
      ctx.strokeStyle = d === 0 ? col('--line-2') : col('--grid');
      ctx.lineWidth = d === 0 ? 1.4 : 1;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(w - right, y);
      ctx.stroke();
      ctx.fillText(`${d > 0 ? '+' : ''}${d}°`, left - 5, y);
    }
    label(ctx, 'sundial slow ← minutes → sundial fast', cx, h - bottom + 2, { align: 'center', color: col('--muted'), weight: '500', bg: null, size: 10 });
    // the loop
    ctx.strokeStyle = col('--c-total');
    ctx.lineWidth = 2;
    ctx.beginPath();
    xs.forEach((x, i) => (i ? ctx.lineTo(X(x), Y(ys[i])) : ctx.moveTo(X(x), Y(ys[i]))));
    ctx.closePath();
    ctx.stroke();
    // month marks: the 1st of each month on Earth's calendar
    ctx.fillStyle = col('--accent');
    for (let m = 1; m <= 12; m++) {
      const i = indexOf(m, 1);
      const s = cache.eot[i];
      const x = X(s.total / 4);
      const y = Y(s.delta);
      ctx.beginPath();
      ctx.arc(x, y, 2.6, 0, Math.PI * 2);
      ctx.fill();
      if (m % 2 === 1) {
        const side = x > cx ? 'left' : 'right';
        label(ctx, MONTHS[m - 1], side === 'right' ? x + 6 : x - 6, y, { align: side === 'right' ? 'left' : 'right', color: col('--muted'), weight: '500', size: 10 });
      }
    }
    // current day
    const c = cache.eot[state.day];
    ctx.beginPath();
    ctx.arc(X(c.total / 4), Y(c.delta), 5, 0, Math.PI * 2);
    ctx.strokeStyle = col('--accent');
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function updateShapeReadout() {
    const ex = S.eotExtremes(state.el, YEAR);
    const amps = { tilt: 0, orbit: 0 };
    for (const e of cache.eot) {
      amps.tilt = Math.max(amps.tilt, Math.abs(e.tilt));
      amps.orbit = Math.max(amps.orbit, Math.abs(e.orbit));
    }
    const crossings = S.selfCrossings(cache.shape);
    const kind = state.el.obl < 0.05 ? 'a flat line: no tilt, no seasons' : crossings === 1 ? 'a figure-8 (one crossing)' : crossings === 0 ? 'a single loop with no crossing: the orbit term outweighs the tilt term' : `${crossings} crossings`;
    const unit = state.preset === 'earth' || state.preset === 'circular' || state.preset === 'untilted' || state.preset === 'custom' ? 'min' : 'min of its own day';
    $('shapeReadout').innerHTML = `Sundial runs up to <strong>${signed(ex.max.minutes)} ${unit}</strong> fast (${Math.floor(ex.max.day)} ${MONTHS[ex.max.month - 1]}) and <strong>${signed(ex.min.minutes)} ${unit}</strong> slow (${Math.floor(ex.min.day)} ${MONTHS[ex.min.month - 1]}). Orbit alone: ±${amps.orbit.toFixed(1)} min; tilt alone: ±${amps.tilt.toFixed(1)} min. The figure is ${kind}.`;
    $('orbitAmp').textContent = amps.orbit.toFixed(1);
    $('tiltAmp').textContent = amps.tilt.toFixed(1);
  }

  // ---------- 3. sunrise and sunset ----------
  function drawRise() {
    const canvas = $('riseChart');
    const W = canvas.clientWidth || 600;
    const { ctx, w, h } = setupCanvas(canvas, Math.min(380, Math.max(260, W * 0.5)));
    const t = cache.rise;
    const ok = t.filter((r) => !r.polar);
    const left = 42;
    const right = 8;
    const top = 10;
    const bottom = 22;
    ctx.fillStyle = col('--chart-bg');
    ctx.fillRect(0, 0, w, h);
    if (ok.length < 2) {
      label(ctx, 'No sunrise or sunset at this latitude for the whole year: polar day and polar night only.', w / 2, h / 2, { align: 'center', color: col('--muted'), weight: '500' });
      return;
    }
    const lo = Math.floor(Math.min(...ok.map((r) => r.rise)) - 0.5);
    const hi = Math.ceil(Math.max(...ok.map((r) => r.set)) + 0.5);
    const X = (i) => left + ((w - left - right) * i) / NDAYS;
    const Y = (hr) => top + ((h - top - bottom) * (hi - hr)) / (hi - lo);
    monthTicks(ctx, X, top, h - bottom, h - 7);
    ctx.fillStyle = col('--muted');
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const stepH = hi - lo > 14 ? 3 : hi - lo > 8 ? 2 : 1;
    for (let hr = Math.ceil(lo); hr <= hi; hr += stepH) {
      ctx.strokeStyle = col('--grid');
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(left, Y(hr));
      ctx.lineTo(w - right, Y(hr));
      ctx.stroke();
      ctx.fillText(fmtClock(hr), left - 5, Y(hr));
    }
    // daylight band
    ctx.fillStyle = col('--sun');
    ctx.globalAlpha = 0.16;
    let open = false;
    for (let i = 0; i <= t.length; i++) {
      const r = t[i];
      if (r && !r.polar) {
        if (!open) {
          ctx.beginPath();
          ctx.moveTo(X(r.i + 0.5), Y(r.rise));
          open = true;
        } else ctx.lineTo(X(r.i + 0.5), Y(r.rise));
      } else if (open) {
        for (let j = i - 1; j >= 0 && t[j] && !t[j].polar; j--) ctx.lineTo(X(t[j].i + 0.5), Y(t[j].set));
        ctx.closePath();
        ctx.fill();
        open = false;
      }
    }
    ctx.globalAlpha = 1;
    // polar stretches
    for (const r of t) {
      if (!r.polar) continue;
      ctx.fillStyle = r.polar === 'day' ? col('--sun') : col('--ground');
      ctx.globalAlpha = r.polar === 'day' ? 0.25 : 0.2;
      ctx.fillRect(X(r.i), top, Math.max(1, (w - left - right) / NDAYS), h - top - bottom);
      ctx.globalAlpha = 1;
    }
    const line = (key, color, dashed) => {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = dashed ? 1.2 : 2;
      ctx.setLineDash(dashed ? [4, 4] : []);
      ctx.beginPath();
      let pen = false;
      for (const r of t) {
        if (r.polar) {
          pen = false;
          continue;
        }
        if (!pen) ctx.moveTo(X(r.i + 0.5), Y(r[key]));
        else ctx.lineTo(X(r.i + 0.5), Y(r[key]));
        pen = true;
      }
      ctx.stroke();
      ctx.restore();
    };
    line('noon', col('--c-noon'), true);
    line('rise', col('--c-rise'), false);
    line('set', col('--c-set'), false);
    // markers
    const ex = S.riseSetExtremes(t);
    const mark = (r, key, text, above, color) => {
      if (!r) return;
      const x = X(r.i + 0.5);
      const y = Y(r[key]);
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = col('--chart-bg');
      ctx.lineWidth = 1.5;
      ctx.stroke();
      const align = x < left + 110 ? 'left' : x > w - right - 110 ? 'right' : 'center';
      const lx = align === 'left' ? Math.max(x - 4, left + 2) : align === 'right' ? Math.min(x + 4, w - right - 2) : x;
      label(ctx, text, lx, y + (above ? -14 : 14), { align, color, size: 11, avoid: placedTop });
    };
    const placedTop = [];
    const vline = (r, text) => {
      if (!r) return;
      const x = X(r.i + 0.5);
      ctx.save();
      ctx.strokeStyle = col('--muted');
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, h - bottom);
      ctx.stroke();
      ctx.restore();
      const align = x < left + 90 ? 'left' : x > w - right - 90 ? 'right' : 'center';
      label(ctx, text, align === 'left' ? x + 4 : align === 'right' ? x - 4 : x, top + 9, { align, color: col('--muted'), size: 10, weight: '500', avoid: placedTop });
    };
    const d = (r) => `${r.day} ${MONTHS[r.month - 1]}`;
    const polar = t.some((r) => r.polar);
    if (!polar) {
      vline(ex.shortestDay, `shortest day ${d(ex.shortestDay)}`);
      vline(ex.longestDay, `longest day ${d(ex.longestDay)}`);
    }
    // sunset labels sit below their point and sunrise labels above it: inside the daylight band, clear of the day lines
    mark(ex.earliestSunset, 'set', `earliest sunset ${d(ex.earliestSunset)}`, false, col('--c-set'));
    mark(ex.latestSunrise, 'rise', `latest sunrise ${d(ex.latestSunrise)}`, true, col('--c-rise'));
    mark(ex.latestSunset, 'set', `latest sunset ${d(ex.latestSunset)}`, false, col('--c-set'));
    mark(ex.earliestSunrise, 'rise', `earliest sunrise ${d(ex.earliestSunrise)}`, true, col('--c-rise'));
  }

  function updateVerdict() {
    const t = cache.rise;
    const ex = S.riseSetExtremes(t);
    const lat = state.lat;
    const d = (r) => `${r.day} ${MONTHS[r.month - 1]}`;
    const hm = (r, k) => fmtClock(r[k]);
    const up = S.polarRun(t, 'day');
    const down = S.polarRun(t, 'night');
    const parts = [];
    $('riseLat').textContent = fmtLat(lat);
    if (!ex.earliestSunset) {
      parts.push(`<p>At ${fmtLat(lat)} the Sun never rises or sets in the ordinary sense: it is up for ${up ? up.days : 0} days and down for ${down ? down.days : 0}.</p>`);
      $('verdict').innerHTML = parts.join('');
      return;
    }
    // Signed day offset of a relative to b, wrapped to ±half a year; negative means earlier.
    const diff = (a, b) => {
      let n = a.i - b.i;
      if (n > NDAYS / 2) n -= NDAYS;
      if (n < -NDAYS / 2) n += NDAYS;
      return n;
    };
    const rel = (n) => (n === 0 ? 'the same day' : `${Math.abs(n)} day${Math.abs(n) === 1 ? '' : 's'} ${n < 0 ? 'earlier' : 'later'}`);
    if (up || down) {
      const stretch = (run) => (run ? `<strong>${run.days}</strong> days (${d(run.start)} to ${d(run.end)})` : 'no days');
      const solstice = up && down ? 'neither solstice has a sunrise or a sunset' : up ? 'the summer solstice has no sunset' : 'the winter solstice has no sunrise';
      // Say where the two extremes sit relative to the stretch: they need not straddle it.
      const sides = (a, b, run, what) => {
        const sa = S.sideOfRun(a, run, t.length);
        const sb = S.sideOfRun(b, run, t.length);
        return sa === sb ? `, both ${sa} the ${what}` : `, on either side of the ${what}`;
      };
      parts.push(`<p>At ${fmtLat(lat)} the Sun stays up for ${stretch(up)} and stays down for ${stretch(down)}, so ${solstice}. On the other days, by the clock: the earliest sunset is <strong>${d(ex.earliestSunset)}</strong> at ${hm(ex.earliestSunset, 'set')} and the latest sunrise <strong>${d(ex.latestSunrise)}</strong> at ${hm(ex.latestSunrise, 'rise')}${down ? sides(ex.earliestSunset, ex.latestSunrise, down, 'polar night') : ''}; the earliest sunrise is ${d(ex.earliestSunrise)} at ${hm(ex.earliestSunrise, 'rise')} and the latest sunset ${d(ex.latestSunset)} at ${hm(ex.latestSunset, 'set')}${up ? sides(ex.earliestSunrise, ex.latestSunset, up, 'midnight sun') : ''}.</p>`);
      $('verdict').innerHTML = parts.join('');
      return;
    }
    const lens = t.map((r) => r.length);
    const spread = (Math.max(...lens) - Math.min(...lens)) * 60;
    if (spread < 15) {
      parts.push(`<p>At ${fmtLat(lat)} the day length hardly changes all year (${fmtLen(Math.min(...lens))} to ${fmtLen(Math.max(...lens))}), so sunrise and sunset just follow the equation of time. Earliest sunset <strong>${d(ex.earliestSunset)}</strong> (${hm(ex.earliestSunset, 'set')}), latest sunrise <strong>${d(ex.latestSunrise)}</strong> (${hm(ex.latestSunrise, 'rise')}); earliest sunrise ${d(ex.earliestSunrise)}, latest sunset ${d(ex.latestSunset)}. The shortest day is ${d(ex.shortestDay)} by a hair.</p>`);
    } else {
      const sd = ex.shortestDay;
      const ld = ex.longestDay;
      const before = diff(ex.earliestSunset, sd);
      const after = diff(ex.latestSunrise, sd);
      let tail = '';
      if (before < 0 && after > 0) tail = ` Between ${d(ex.earliestSunset)} and ${d(sd)} the evenings are already drawing out while the days are still getting shorter.`;
      else if (before > 0 && after < 0) tail = ' Here the sundial runs the other way through the solstice, so the order is reversed: mornings draw out first.';
      parts.push(`<p>At ${fmtLat(lat)} the shortest day is <strong>${d(sd)}</strong> (${fmtLen(sd.length)}), but the earliest sunset is <strong>${d(ex.earliestSunset)}</strong> at ${hm(ex.earliestSunset, 'set')}, ${rel(before)}, and the latest sunrise is <strong>${d(ex.latestSunrise)}</strong> at ${hm(ex.latestSunrise, 'rise')}, ${rel(after)}.${tail}</p>`);
      parts.push(`<p>The longest day is <strong>${d(ld)}</strong> (${fmtLen(ld.length)}); the earliest sunrise is ${d(ex.earliestSunrise)} at ${hm(ex.earliestSunrise, 'rise')}, ${rel(diff(ex.earliestSunrise, ld))}, and the latest sunset ${d(ex.latestSunset)} at ${hm(ex.latestSunset, 'set')}, ${rel(diff(ex.latestSunset, ld))}.</p>`);
    }
    $('verdict').innerHTML = parts.join('');
  }

  // ---------- 4. your noon ----------
  function updateNoon() {
    const { y, m, d } = state.noonDate;
    const r = S.riseSet(state.el, y, m, d, state.lat, state.lon, state.zone);
    const s = S.sunOnDay(state.el, S.localInstant(y, m, d, r.noon, state.zone));
    const lonOffsetMin = ((state.lon - zoneMeridian()) * 4);
    const sundialAtNoon = 12 + s.eotMin / 60 + lonOffsetMin / 60;
    const altNoon = 90 - Math.abs(state.lat - s.delta);
    const stat = (k, v, sub) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${sub}</div></div>`;
    const east = state.lon - zoneMeridian();
    const cards = [
      stat('Solar noon', fmtClock(r.noon), `The Sun is highest, ${altNoon.toFixed(1)}° up, ${altNoon > 0 && state.lat > s.delta ? 'due south' : altNoon > 0 ? 'due north' : 'below the horizon'}.`),
      stat('Sundial at 12:00', fmtClock(sundialAtNoon), 'What a sundial reads when your clock says noon.'),
      stat('Equation of time', `${signed(s.eotMin)} min`, s.eotMin >= 0 ? 'The real Sun is ahead of the mean Sun.' : 'The real Sun is behind the mean Sun.'),
      stat('Longitude', `${signed(lonOffsetMin)} min`, `You are ${Math.abs(east).toFixed(1)}° ${east >= 0 ? 'east' : 'west'} of your zone's meridian (${Math.abs(zoneMeridian()).toFixed(0)}°${zoneMeridian() >= 0 ? 'E' : 'W'}).`),
      r.polar
        ? stat('Daylight', r.polar === 'day' ? 'all day' : 'none', r.polar === 'day' ? 'The Sun does not set today.' : 'The Sun does not rise today.')
        : stat('Sunrise · sunset', `${fmtClock(r.rise)} · ${fmtClock(r.set)}`, `${fmtLen(r.length)} of daylight.`),
    ];
    $('noonGrid').innerHTML = cards.join('');
  }

  // ---------- drawing everything ----------
  function drawAll() {
    drawSky();
    updateSkyReadout();
    drawEot();
    drawDec();
    drawShape();
    updateShapeReadout();
    drawRise();
    updateVerdict();
    updateNoon();
  }
  function refresh() {
    recompute();
    drawAll();
  }
  function drawDayDependent() {
    drawSky();
    updateSkyReadout();
    drawEot();
    drawDec();
    drawShape();
  }

  // ---------- controls ----------
  function syncOutputs() {
    $('latOut').value = fmtLat(state.lat);
    $('clockOut').value = fmtClock(state.clock);
    $('eccOut').value = state.el.e.toFixed(4);
    $('oblOut').value = `${state.el.obl.toFixed(2)}°`;
    $('periOut').value = dateLabel(periIndex());
    $('placeSummary').textContent = `${Math.abs(state.lon).toFixed(2)}°${state.lon >= 0 ? 'E' : 'W'}, ${fmtZone(state.zone)}`;
    for (const b of document.querySelectorAll('[data-preset]')) b.setAttribute('aria-pressed', String(b.dataset.preset === state.preset));
  }
  function periIndex() {
    let best = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < NDAYS; i++) {
      const diff = Math.abs(S.wrap180(S.meanLongitude(D0 + i + 0.5) - state.el.peri));
      if (diff < bestDiff) {
        bestDiff = diff;
        best = i;
      }
    }
    return best;
  }
  function setSliders() {
    $('lat').value = state.lat;
    $('clock').value = state.clock;
    $('day').max = NDAYS - 1;
    $('day').value = state.day;
    $('ecc').value = state.el.e;
    $('obl').value = state.el.obl;
    $('peri').value = periIndex();
    $('lon').value = state.lon;
    $('zone').value = state.zone;
    const nd = state.noonDate;
    $('noonDate').value = `${nd.y}-${pad2(nd.m)}-${pad2(nd.d)}`;
  }

  $('lat').addEventListener('input', (e) => {
    state.lat = Number(e.target.value);
    syncOutputs();
    refresh();
  });
  $('clock').addEventListener('input', (e) => {
    state.clock = Number(e.target.value);
    syncOutputs();
    cache.figure = S.skyFigure(state.el, YEAR, state.clock, state.lat, state.lon, state.zone);
    drawSky();
    updateSkyReadout();
  });
  $('day').addEventListener('input', (e) => {
    stopPlaying();
    state.day = Number(e.target.value);
    drawDayDependent();
  });
  $('today').addEventListener('click', () => {
    stopPlaying();
    state.day = TODAY_INDEX;
    $('day').value = state.day;
    drawDayDependent();
  });
  const applyPlace = () => {
    const lon = Number($('lon').value);
    const zone = Number($('zone').value);
    if (Number.isFinite(lon)) state.lon = Math.max(-180, Math.min(180, lon));
    if (Number.isFinite(zone)) state.zone = Math.max(-12, Math.min(14, zone));
    syncOutputs();
    refresh();
  };
  $('lon').addEventListener('change', applyPlace);
  $('zone').addEventListener('change', applyPlace);
  $('placeReset').addEventListener('click', () => {
    state.lon = Math.round(zoneMeridian() * 100) / 100;
    $('lon').value = state.lon;
    syncOutputs();
    refresh();
  });

  const customFromSliders = () => {
    state.el = { e: Number($('ecc').value), obl: Number($('obl').value), peri: S.meanLongitude(D0 + Number($('peri').value) + 0.5), aberr: -0.00569 };
    state.preset = 'custom';
    syncOutputs();
    refresh();
  };
  $('ecc').addEventListener('input', customFromSliders);
  $('obl').addEventListener('input', customFromSliders);
  $('peri').addEventListener('input', customFromSliders);
  for (const b of document.querySelectorAll('[data-preset]')) {
    b.addEventListener('click', () => {
      const key = b.dataset.preset;
      state.preset = key;
      state.el = key === 'earth' ? { ...EARTH_NOW } : { ...S.PRESETS[key], e: S.PRESETS[key].e, obl: S.PRESETS[key].obl, peri: S.PRESETS[key].peri };
      if (key === 'circular') state.el = { ...EARTH_NOW, e: 0 };
      if (key === 'untilted') state.el = { ...EARTH_NOW, obl: 0 };
      setSliders();
      syncOutputs();
      refresh();
    });
  }
  $('noonDate').addEventListener('change', (e) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(e.target.value);
    if (!m) return;
    state.noonDate = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
    updateNoon();
  });

  // ---------- exposing the year ----------
  let raf = null;
  let lastT = 0;
  let dayFloat = 0;
  function stopPlaying() {
    if (!state.playing) return;
    state.playing = false;
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    $('play').textContent = 'Expose the year';
  }
  function tick(t) {
    // A frame's timestamp can precede the performance.now() taken when play began, so clamp dt at 0.
    const dt = Math.max(0, Math.min(0.1, (t - lastT) / 1000));
    lastT = t;
    dayFloat += dt * 28;
    state.day = Math.max(0, Math.min(NDAYS - 1, Math.floor(dayFloat)));
    $('day').value = state.day;
    drawDayDependent();
    if (state.day >= NDAYS - 1) {
      stopPlaying();
      return;
    }
    raf = requestAnimationFrame(tick);
  }
  $('play').addEventListener('click', () => {
    if (state.playing) {
      stopPlaying();
      return;
    }
    if (reduceMotion.matches) {
      // No animation: step through the year a month at a time instead.
      state.day = (state.day + 30) % NDAYS;
      $('day').value = state.day;
      drawDayDependent();
      return;
    }
    state.playing = true;
    dayFloat = 0;
    state.day = 0;
    lastT = performance.now();
    $('play').textContent = 'Stop';
    raf = requestAnimationFrame(tick);
  });
  if (reduceMotion.matches) $('play').textContent = 'Step a month';

  // ---------- pointer on the sky: drag to a date ----------
  const sky = $('sky');
  let dragging = false;
  function pickDay(ev) {
    if (!cache.proj) return;
    const rect = sky.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    let best = 0;
    let bestD = Infinity;
    cache.proj.forEach((p, i) => {
      const dd = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (dd < bestD) {
        bestD = dd;
        best = i;
      }
    });
    if (bestD > 60 * 60 && !dragging) return;
    stopPlaying();
    state.day = best;
    $('day').value = best;
    drawDayDependent();
  }
  sky.addEventListener('pointerdown', (ev) => {
    dragging = true;
    try {
      sky.setPointerCapture(ev.pointerId);
    } catch (_) {
      /* ignore */
    }
    pickDay(ev);
  });
  sky.addEventListener('pointermove', (ev) => {
    if (dragging || ev.pointerType === 'mouse') pickDay(ev);
  });
  const endDrag = () => {
    dragging = false;
  };
  sky.addEventListener('pointerup', endDrag);
  sky.addEventListener('pointercancel', endDrag);
  sky.addEventListener('pointerleave', endDrag);

  // keyboard on the day slider works natively; also arrow keys on the sky canvas
  sky.tabIndex = 0;
  sky.addEventListener('keydown', (ev) => {
    const step = ev.key === 'ArrowRight' || ev.key === 'ArrowUp' ? 1 : ev.key === 'ArrowLeft' || ev.key === 'ArrowDown' ? -1 : 0;
    if (!step) return;
    ev.preventDefault();
    stopPlaying();
    state.day = (state.day + step + NDAYS) % NDAYS;
    $('day').value = state.day;
    drawDayDependent();
  });

  // ---------- resize / theme ----------
  let resizeRaf = null;
  window.addEventListener('resize', () => {
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = null;
      drawAll();
    });
  });
  darkMq.addEventListener('change', drawAll);

  // ---------- go ----------
  for (const el of document.querySelectorAll('.js-year')) el.textContent = String(YEAR);
  setSliders();
  syncOutputs();
  refresh();
})();
