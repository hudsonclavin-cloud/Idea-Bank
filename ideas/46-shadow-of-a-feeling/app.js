/* The Shadow of a Feeling — plain browser JS, no dependencies.
   Data: window.SHADOW_DATA (data.js), verbatim rows from Warriner, Kuperman & Brysbaert (2013). */
(function () {
  'use strict';
  const DATA = window.SHADOW_DATA;
  const LEX = Object.keys(DATA.lexicon).map((w) => {
    const r = DATA.lexicon[w];
    return { w, v: r[0], a: r[1], d: r[2], sv: r[3], sa: r[4], sd: r[5], nv: r[6], na: r[7], nd: r[8] };
  });
  const BY_WORD = Object.fromEntries(LEX.map((p) => [p.w, p]));
  const RUSSELL = DATA.russell_words.filter((w) => BY_WORD[w]).map((w) => BY_WORD[w]);
  const FEATURED_PAIRS = [
    ['panic', 'anger'],
    ['terror', 'anger'],
    ['frightened', 'anger'],
    ['surprised', 'curious'],
    ['astonished', 'inspired'],
    ['romance', 'triumph'],
  ];
  const NOISE_PAIRS = [
    ['shame', 'embarrassment'],
    ['weak', 'overwhelmed'],
  ];
  const PAIR_VA_MAX = 0.6; // max distance in the valence–arousal plane
  const PAIR_D_MIN = 2.0; // min difference on dominance
  // The V figure's arousal axis spans the whole 1–9 rating scale, so the V is drawn at its true size
  // next to the within-band spread (a truncated axis made a shallow V look steep).
  const V_FIG_A_RANGE = [1, 9];

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const darkQuery = matchMedia('(prefers-color-scheme: dark)');
  const shared = { you: null, youD: null }; // you = {v, a}; youD = number | null

  // ---------- helpers ----------
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const fmt = (x, n) => Number(x).toFixed(n == null ? 2 : n);
  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  function colors() {
    return {
      ink: css('--ink'),
      muted: css('--muted'),
      faint: css('--faint'),
      line: css('--line'),
      paper: css('--paper'),
      accent: css('--accent'),
      accent2: css('--accent2'),
      you: css('--you'),
      dot: css('--dot'),
    };
  }
  function dist2(p, q) {
    return Math.hypot(p.v - q.v, p.a - q.a);
  }
  function dist3(p, q) {
    return Math.hypot(p.v - q.v, p.a - q.a, p.d - q.d);
  }
  function nearest(pt, k, threeD) {
    const f = threeD ? dist3 : dist2;
    return LEX.map((p) => ({ p, d: f(p, pt) })).sort((x, y) => x.d - y.d).slice(0, k);
  }
  function overlapPairs() {
    const out = [];
    for (let i = 0; i < LEX.length; i++) {
      for (let j = i + 1; j < LEX.length; j++) {
        const a = LEX[i], b = LEX[j];
        const dva = dist2(a, b), dd = Math.abs(a.d - b.d);
        if (dva <= PAIR_VA_MAX && dd >= PAIR_D_MIN) out.push({ a, b, dva, dd });
      }
    }
    return out.sort((x, y) => y.dd - x.dd);
  }

  // A canvas that follows its container's width and the device pixel ratio.
  function makeCanvas(el, aspect) {
    const canvas = el.tagName === 'CANVAS' ? el : el.appendChild(document.createElement('canvas'));
    const ctx = canvas.getContext('2d');
    const state = { w: 0, h: 0, dpr: 1 };
    function resize() {
      const rect = canvas.parentElement.getBoundingClientRect();
      const w = Math.max(200, Math.floor(rect.width));
      const h = Math.floor(w * (Number(canvas.parentElement.dataset.aspect) || aspect));
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      state.w = w; state.h = h; state.dpr = dpr;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
    }
    resize();
    return { canvas, ctx, state, resize };
  }

  // Greedy label placement: returns a list of {x, y, text, align} that don't overlap.
  function placeLabels(ctx, items, w, h) {
    const boxes = [];
    const placed = [];
    const fits = (b) => b.x >= 0 && b.x + b.w <= w && b.y >= 0 && b.y + b.h <= h && !boxes.some((o) => !(b.x + b.w < o.x || o.x + o.w < b.x || b.y + b.h < o.y || o.y + o.h < b.y));
    for (const it of items) {
      const tw = ctx.measureText(it.text).width;
      const th = 12;
      const g = it.gap || 7; // clearance from the dot
      const cands = [
        { x: it.x + g, y: it.y - th / 2, align: 'left' },
        { x: it.x - g - tw, y: it.y - th / 2, align: 'right' },
        { x: it.x - tw / 2, y: it.y - th - g + 1, align: 'center' },
        { x: it.x - tw / 2, y: it.y + g - 1, align: 'center' },
      ];
      for (const c of cands) {
        const b = { x: c.x - 2, y: c.y, w: tw + 4, h: th };
        if (fits(b)) {
          boxes.push(b);
          placed.push({ x: c.x, y: c.y + th - 2, text: it.text, align: 'left' });
          break;
        }
      }
    }
    return placed;
  }

  // ---------- Figure 1 & 3: the plane ----------
  function PlaneFigure(root, opts) {
    const { canvas, ctx, state, resize } = makeCanvas($('.canvas-wrap', root), 1);
    const tip = $('.tip', root);
    const o = Object.assign({ showAll: false, rotation: 0, interactive: true, showRussell: true, showYou: true }, opts);
    let hover = null;

    function toXY(v, a) {
      const pad = 34;
      const s = (state.w - 2 * pad) / 8;
      return { x: pad + (v - 1) * s, y: state.h - pad - (a - 1) * s, s, pad };
    }
    function fromXY(x, y) {
      const pad = 34;
      const s = (state.w - 2 * pad) / 8;
      return { v: clamp(1 + (x - pad) / s, 1, 9), a: clamp(1 + (state.h - pad - y) / s, 1, 9) };
    }

    function draw() {
      const c = colors();
      const { w, h, dpr } = state;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const ctr = toXY(5, 5);
      const unit = ctr.s;
      ctx.font = '11px system-ui, sans-serif';
      ctx.lineWidth = 1;

      // frame
      ctx.strokeStyle = c.line;
      ctx.strokeRect(toXY(1, 9).x, toXY(1, 9).y, 8 * unit, 8 * unit);

      // Russell's circle and eight landmarks (conceptual)
      if (o.showRussell) {
        const narrow = w < 520;
        ctx.strokeStyle = c.faint;
        ctx.beginPath();
        ctx.arc(ctr.x, ctr.y, 3.6 * unit, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = c.muted;
        for (const [name, deg] of DATA.russell_anchors) {
          const t = (deg * Math.PI) / 180;
          const r = 3.6 * unit;
          ctx.strokeStyle = c.faint;
          ctx.beginPath();
          ctx.moveTo(ctr.x, ctr.y);
          ctx.lineTo(ctr.x + Math.cos(t) * r, ctr.y - Math.sin(t) * r);
          ctx.stroke();
          const horizontal = deg === 0 || deg === 180;
          const text = narrow && horizontal ? deg + '°' : name + ' ' + deg + '°';
          const tw = ctx.measureText(text).width;
          let lx = ctr.x + Math.cos(t) * (r + (horizontal ? 6 : 14));
          let ly = ctr.y - Math.sin(t) * (r + 14) + 4;
          if (horizontal) ly = ctr.y - 12; // sit just above the axis line
          if (Math.abs(Math.cos(t)) < 0.3) lx -= tw / 2;
          else if (Math.cos(t) < 0) lx -= tw;
          lx = clamp(lx, 2, w - tw - 2);
          ctx.textAlign = 'left';
          ctx.fillText(text, lx, ly);
        }
      }

      // axes (rotated in figure 3)
      const rot = (o.rotation * Math.PI) / 180;
      const axisLen = 3.95 * unit;
      ctx.strokeStyle = c.muted;
      ctx.lineWidth = 1.2;
      for (const base of [0, Math.PI / 2]) {
        const t = base + rot;
        ctx.beginPath();
        ctx.moveTo(ctr.x - Math.cos(t) * axisLen, ctr.y + Math.sin(t) * axisLen);
        ctx.lineTo(ctr.x + Math.cos(t) * axisLen, ctr.y - Math.sin(t) * axisLen);
        ctx.stroke();
      }
      ctx.lineWidth = 1;
      // axis labels: Russell's fade out, Watson & Tellegen's fade in
      const k = clamp(o.rotation / 45, 0, 1);
      ctx.font = '12px system-ui, sans-serif';
      const labelAt = (deg, text, alpha) => {
        if (alpha <= 0.02) return;
        const t = (deg * Math.PI) / 180;
        const r = axisLen + 12;
        const tw = ctx.measureText(text).width;
        let x = ctr.x + Math.cos(t) * r, y = ctr.y - Math.sin(t) * r + 4;
        if (Math.abs(Math.cos(t)) < 0.3) x -= tw / 2;
        else if (Math.cos(t) < 0) x -= tw;
        x = clamp(x, 2, w - tw - 2);
        y = clamp(y, 12, h - 4);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = c.ink;
        ctx.textAlign = 'left';
        ctx.fillText(text, x, y);
        ctx.restore();
      };
      if (o.rotation === 0) {
        ctx.fillStyle = c.ink;
        ctx.textAlign = 'right';
        ctx.fillText('pleasant →', toXY(9, 1).x, toXY(9, 1).y + 22);
        ctx.textAlign = 'left';
        ctx.fillText('← unpleasant', toXY(1, 1).x, toXY(1, 1).y + 22);
        ctx.fillText('activated ↑', toXY(1, 9).x + 6, toXY(1, 9).y + 16);
        ctx.fillText('calm ↓', toXY(1, 1).x + 6, toXY(1, 1).y - 8);
      } else {
        labelAt(0 + o.rotation, 'pleasant', 1 - k);
        labelAt(180 + o.rotation, 'unpleasant', 1 - k);
        labelAt(90 + o.rotation, 'activated', 1 - k);
        labelAt(270 + o.rotation, 'calm', 1 - k);
        labelAt(0 + o.rotation, 'high positive affect', k);
        labelAt(180 + o.rotation, 'low positive affect', k);
        labelAt(90 + o.rotation, 'high negative affect', k);
        labelAt(270 + o.rotation, 'low negative affect', k);
      }

      // all words (faint)
      ctx.font = '11px system-ui, sans-serif';
      if (o.showAll) {
        ctx.fillStyle = c.dot;
        for (const p of LEX) {
          const q = toXY(p.v, p.a);
          ctx.beginPath();
          ctx.arc(q.x, q.y, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // Russell's words, labelled
      const items = [];
      ctx.fillStyle = c.accent;
      for (const p of RUSSELL) {
        const q = toXY(p.v, p.a);
        ctx.beginPath();
        ctx.arc(q.x, q.y, 3.2, 0, Math.PI * 2);
        ctx.fill();
        items.push({ x: q.x, y: q.y, text: p.w });
      }
      ctx.fillStyle = c.ink;
      ctx.textAlign = 'left';
      for (const l of placeLabels(ctx, items, w, h)) ctx.fillText(l.text, l.x, l.y);

      // hover
      if (hover) {
        const q = toXY(hover.v, hover.a);
        ctx.strokeStyle = c.ink;
        ctx.beginPath();
        ctx.arc(q.x, q.y, 6, 0, Math.PI * 2);
        ctx.stroke();
      }
      // you
      if (o.showYou && shared.you) {
        const q = toXY(shared.you.v, shared.you.a);
        ctx.strokeStyle = c.you;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(q.x, q.y, 7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(q.x - 11, q.y); ctx.lineTo(q.x + 11, q.y);
        ctx.moveTo(q.x, q.y - 11); ctx.lineTo(q.x, q.y + 11);
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.fillStyle = c.you;
        ctx.font = 'bold 12px system-ui, sans-serif';
        ctx.fillText('you', q.x + 10, q.y - 8);
      }
    }

    function pointAt(x, y) {
      const pool = o.showAll ? LEX : RUSSELL;
      let best = null, bd = 12;
      for (const p of pool) {
        const q = toXY(p.v, p.a);
        const d = Math.hypot(q.x - x, q.y - y);
        if (d < bd) { bd = d; best = p; }
      }
      return best;
    }
    function showTip(p, x, y) {
      if (!tip) return;
      if (!p) { tip.hidden = true; return; }
      tip.hidden = false;
      tip.innerHTML = `<b>${p.w}</b> · valence ${fmt(p.v)} ± ${fmt(p.sv)} · arousal ${fmt(p.a)} ± ${fmt(p.sa)} · dominance ${fmt(p.d)} ± ${fmt(p.sd)} <span class="n">(n = ${p.nv}/${p.na}/${p.nd})</span>`;
      const r = canvas.getBoundingClientRect();
      tip.style.left = clamp(x, 0, r.width - 40) + 'px';
      tip.style.top = (y + 16) + 'px';
    }

    if (o.interactive) {
      let dragging = false;
      const setYou = (ev) => {
        const r = canvas.getBoundingClientRect();
        const pt = fromXY(ev.clientX - r.left, ev.clientY - r.top);
        shared.you = { v: Math.round(pt.v * 100) / 100, a: Math.round(pt.a * 100) / 100 };
        document.dispatchEvent(new CustomEvent('you-changed'));
      };
      canvas.addEventListener('pointerdown', (ev) => {
        dragging = true;
        canvas.setPointerCapture(ev.pointerId);
        setYou(ev);
        ev.preventDefault();
      });
      canvas.addEventListener('pointermove', (ev) => {
        const r = canvas.getBoundingClientRect();
        const x = ev.clientX - r.left, y = ev.clientY - r.top;
        if (dragging) { setYou(ev); return; }
        const p = pointAt(x, y);
        if (p !== hover) { hover = p; draw(); }
        showTip(p, x, y);
      });
      canvas.addEventListener('pointerup', () => { dragging = false; });
      canvas.addEventListener('pointercancel', () => { dragging = false; });
      canvas.addEventListener('pointerleave', () => { hover = null; showTip(null); draw(); });
      canvas.tabIndex = 0;
      canvas.addEventListener('keydown', (ev) => {
        const step = ev.shiftKey ? 1 : 0.25;
        const you = shared.you || { v: 5, a: 5 };
        const m = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[ev.key];
        if (!m) return;
        shared.you = { v: clamp(you.v + m[0], 1, 9), a: clamp(you.a + m[1], 1, 9) };
        document.dispatchEvent(new CustomEvent('you-changed'));
        ev.preventDefault();
      });
    }

    document.addEventListener('you-changed', draw);
    return {
      draw,
      resize() { resize(); draw(); },
      set(key, val) { o[key] = val; draw(); },
      get: (key) => o[key],
    };
  }

  // ---------- Figure 2: the V ----------
  function VFigure(root) {
    const { ctx, state, resize } = makeCanvas($('.canvas-wrap', root), 0.55);
    function draw() {
      const c = colors();
      const { w, h, dpr } = state;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const padL = 38, padR = 14, padT = 14, padB = 34;
      const bins = DATA.bins.filter((b) => b.n >= 5);
      const x = (v) => padL + ((v - 1) / 8) * (w - padL - padR);
      const [aLo, aHi] = V_FIG_A_RANGE;
      const yA = (a) => padT + ((aHi - clamp(a, aLo, aHi)) / (aHi - aLo)) * (h - padT - padB);
      ctx.font = '11px system-ui, sans-serif';
      ctx.strokeStyle = c.line;
      ctx.fillStyle = c.muted;
      // gridlines
      for (let a = aLo; a <= aHi; a += 2) {
        ctx.beginPath(); ctx.moveTo(padL, yA(a)); ctx.lineTo(w - padR, yA(a)); ctx.stroke();
        ctx.textAlign = 'right'; ctx.fillText(String(a), padL - 6, yA(a) + 4);
      }
      ctx.textAlign = 'center';
      for (const v of [1, 3, 5, 7, 9]) ctx.fillText(String(v), x(v), h - padB + 16);
      ctx.fillText('valence rating (1 unhappy → 9 happy)', (padL + w - padR) / 2, h - 4);
      ctx.save();
      ctx.translate(10, (padT + h - padB) / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText('mean arousal', 0, 0);
      ctx.restore();
      // bars (count) as faint background
      const maxN = Math.max(...bins.map((b) => b.n));
      ctx.fillStyle = c.faint;
      for (const b of bins) {
        const bw = x(b.hi) - x(b.lo) - 2;
        const bh = (b.n / maxN) * (h - padT - padB) * 0.25;
        ctx.fillRect(x(b.lo) + 1, h - padB - bh, bw, bh);
      }
      // ± one standard deviation of arousal within each band (the spread the means hide)
      const mid = (b) => x((b.lo + b.hi) / 2);
      ctx.save();
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = c.accent;
      ctx.beginPath();
      bins.forEach((b, i) => (i ? ctx.lineTo(mid(b), yA(b.meanA + b.sdA)) : ctx.moveTo(mid(b), yA(b.meanA + b.sdA))));
      bins.slice().reverse().forEach((b) => ctx.lineTo(mid(b), yA(b.meanA - b.sdA)));
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      // line of mean arousal
      ctx.strokeStyle = c.accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      bins.forEach((b, i) => {
        const px = x((b.lo + b.hi) / 2), py = yA(b.meanA);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.fillStyle = c.accent;
      for (const b of bins) {
        ctx.beginPath(); ctx.arc(x((b.lo + b.hi) / 2), yA(b.meanA), 3, 0, Math.PI * 2); ctx.fill();
      }
      ctx.lineWidth = 1;
      ctx.fillStyle = c.muted;
      ctx.textAlign = 'left';
      // legend in the empty top of the plot, below the 9 gridline; shorter on narrow screens
      const legend = w < 520 ? 'grey bars: words per valence band' : 'grey bars: how many of the 13,915 words fall in each valence band';
      ctx.fillText(legend, padL + 4, padT + 17);
    }
    return { draw, resize() { resize(); draw(); } };
  }

  // ---------- Figure 5: tilt (3-D) ----------
  function TiltFigure(root) {
    const { canvas, ctx, state, resize } = makeCanvas($('.canvas-wrap', root), 1);
    const tip = $('.tip', root);
    const view = { yaw: 0, pitch: 0 }; // radians
    const pairs = FEATURED_PAIRS.map(([a, b]) => [BY_WORD[a], BY_WORD[b]]);
    const featured = new Set(pairs.flat().map((p) => p.w));
    let hover = null;

    function project(v, a, d) {
      // centre at 5,5,5; yaw about the vertical (arousal) axis, then pitch about the horizontal axis
      let x = v - 5, y = a - 5, z = d - 5;
      const cy = Math.cos(view.yaw), sy = Math.sin(view.yaw);
      let x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
      const cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
      let y1 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
      const unit = (Math.min(state.w, state.h) - 56) / 8;
      return { x: state.w / 2 + x1 * unit, y: state.h / 2 - y1 * unit, z: z2 };
    }
    function draw() {
      const c = colors();
      const { w, h, dpr } = state;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.font = '11px system-ui, sans-serif';
      // the valence–arousal plane (the "floor" the shadow falls on) at dominance = 5
      const corners = [[1, 1], [9, 1], [9, 9], [1, 9]].map(([v, a]) => project(v, a, 5));
      ctx.fillStyle = c.faint;
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      corners.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = c.line;
      ctx.stroke();
      // axes
      const axes = [
        { from: project(1, 5, 5), to: project(9, 5, 5), label: 'valence →' },
        { from: project(5, 1, 5), to: project(5, 9, 5), label: 'arousal →' },
        { from: project(5, 5, 1), to: project(5, 5, 9), label: 'dominance →' },
      ];
      ctx.strokeStyle = c.muted;
      ctx.fillStyle = c.muted;
      for (const ax of axes) {
        ctx.beginPath(); ctx.moveTo(ax.from.x, ax.from.y); ctx.lineTo(ax.to.x, ax.to.y); ctx.stroke();
        const len = Math.hypot(ax.to.x - ax.from.x, ax.to.y - ax.from.y);
        if (len > 24) {
          const tw = ctx.measureText(ax.label).width;
          ctx.textAlign = 'left';
          ctx.fillText(ax.label, clamp(ax.to.x + 4, 2, w - tw - 2), clamp(ax.to.y + 4, 12, h - 4));
        }
      }
      // all points, back to front
      const pts = LEX.map((p) => ({ p, q: project(p.v, p.a, p.d) })).sort((a, b) => a.q.z - b.q.z);
      for (const { p, q } of pts) {
        if (featured.has(p.w)) continue;
        const depth = clamp((q.z + 4) / 8, 0, 1); // 0 far, 1 near
        ctx.globalAlpha = 0.35 + 0.5 * depth;
        ctx.fillStyle = c.dot;
        ctx.beginPath(); ctx.arc(q.x, q.y, 1.8 + 1.6 * depth, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      // featured pairs: stems to the floor, connecting line, labels (a word shared by several pairs is labelled once)
      const items = [];
      const labelled = new Set();
      pairs.forEach(([a, b], i) => {
        const col = i % 2 ? c.accent2 : c.accent;
        const qa = project(a.v, a.a, a.d), qb = project(b.v, b.a, b.d);
        const fa = project(a.v, a.a, 5), fb = project(b.v, b.a, 5);
        ctx.strokeStyle = col;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(qa.x, qa.y); ctx.lineTo(fa.x, fa.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(qb.x, qb.y); ctx.lineTo(fb.x, fb.y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(qa.x, qa.y); ctx.lineTo(qb.x, qb.y); ctx.stroke();
        ctx.lineWidth = 1;
        ctx.fillStyle = col;
        for (const [p, q] of [[a, qa], [b, qb]]) {
          ctx.beginPath(); ctx.arc(q.x, q.y, 4, 0, Math.PI * 2); ctx.fill();
          if (!labelled.has(p.w)) { labelled.add(p.w); items.push({ x: q.x, y: q.y, text: p.w }); }
        }
        // shadow feet
        ctx.fillStyle = c.muted;
        for (const f of [fa, fb]) { ctx.beginPath(); ctx.arc(f.x, f.y, 2, 0, Math.PI * 2); ctx.fill(); }
      });
      // you
      if (shared.you && shared.youD != null) {
        const q = project(shared.you.v, shared.you.a, shared.youD);
        const f = project(shared.you.v, shared.you.a, 5);
        ctx.strokeStyle = c.you;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(f.x, f.y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(q.x, q.y, 7, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(q.x - 11, q.y); ctx.lineTo(q.x + 11, q.y);
        ctx.moveTo(q.x, q.y - 11); ctx.lineTo(q.x, q.y + 11);
        ctx.stroke();
        ctx.lineWidth = 1;
        items.unshift({ x: q.x, y: q.y, text: 'you', gap: 14 });
      }
      ctx.fillStyle = c.ink;
      ctx.textAlign = 'left';
      for (const l of placeLabels(ctx, items, w, h)) ctx.fillText(l.text, l.x, l.y);
      if (hover) {
        const q = project(hover.v, hover.a, hover.d);
        ctx.strokeStyle = c.ink;
        ctx.beginPath(); ctx.arc(q.x, q.y, 6, 0, Math.PI * 2); ctx.stroke();
      }
      // readout
      const deg = Math.round((Math.abs(view.yaw) * 180) / Math.PI);
      const out = $('.tilt-readout', root);
      if (out) {
        const [pa, pb] = pairs[0];
        const qa = project(pa.v, pa.a, pa.d), qb = project(pb.v, pb.a, pb.d);
        const px = Math.hypot(qa.x - qb.x, qa.y - qb.y);
        out.textContent = `yaw ${deg}°, pitch ${Math.round((view.pitch * 180) / Math.PI)}° — on screen, ${pa.w} and ${pb.w} are ${Math.round(px)} px apart (they are ${fmt(dist2(pa, pb))} apart in valence–arousal and ${fmt(Math.abs(pa.d - pb.d))} apart in dominance).`;
      }
    }
    function pointAt(x, y) {
      let best = null, bd = 12;
      for (const p of LEX) {
        const q = project(p.v, p.a, p.d);
        const d = Math.hypot(q.x - x, q.y - y);
        if (d < bd) { bd = d; best = p; }
      }
      return best;
    }
    function showTip(p, x, y) {
      if (!tip) return;
      if (!p) { tip.hidden = true; return; }
      tip.hidden = false;
      tip.innerHTML = `<b>${p.w}</b> · V ${fmt(p.v)} · A ${fmt(p.a)} · D ${fmt(p.d)}`;
      const r = canvas.getBoundingClientRect();
      tip.style.left = clamp(x, 0, r.width - 40) + 'px';
      tip.style.top = (y + 16) + 'px';
    }
    // drag to rotate
    let drag = null;
    canvas.addEventListener('pointerdown', (ev) => {
      drag = { x: ev.clientX, y: ev.clientY, yaw: view.yaw, pitch: view.pitch };
      canvas.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    });
    canvas.addEventListener('pointermove', (ev) => {
      const r = canvas.getBoundingClientRect();
      const x = ev.clientX - r.left, y = ev.clientY - r.top;
      if (drag) {
        view.yaw = clamp(drag.yaw + ((ev.clientX - drag.x) / state.w) * Math.PI, -Math.PI / 2, Math.PI / 2);
        view.pitch = clamp(drag.pitch + ((ev.clientY - drag.y) / state.h) * Math.PI, -Math.PI / 2, Math.PI / 2);
        syncSlider();
        draw();
        return;
      }
      const p = pointAt(x, y);
      if (p !== hover) { hover = p; draw(); }
      showTip(p, x, y);
    });
    const end = () => { drag = null; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('pointerleave', () => { hover = null; showTip(null); draw(); });
    const slider = $('.tilt-slider', root);
    function syncSlider() {
      if (slider) slider.value = String(Math.round((view.yaw * 180) / Math.PI));
    }
    if (slider) {
      slider.addEventListener('input', () => {
        view.yaw = (Number(slider.value) * Math.PI) / 180;
        draw();
      });
    }
    function animateTo(yaw, pitch) {
      if (reduceMotion.matches) { view.yaw = yaw; view.pitch = pitch; syncSlider(); draw(); return; }
      const y0 = view.yaw, p0 = view.pitch, t0 = performance.now();
      const step = (t) => {
        const k = clamp((t - t0) / 600, 0, 1);
        const e = 1 - Math.pow(1 - k, 3);
        view.yaw = y0 + (yaw - y0) * e;
        view.pitch = p0 + (pitch - p0) * e;
        syncSlider();
        draw();
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
    $$('[data-view]', root).forEach((btn) => {
      btn.addEventListener('click', () => {
        const [yaw, pitch] = btn.dataset.view.split(',').map(Number);
        animateTo((yaw * Math.PI) / 180, (pitch * Math.PI) / 180);
      });
    });
    canvas.tabIndex = 0;
    canvas.addEventListener('keydown', (ev) => {
      const s = (5 * Math.PI) / 180;
      const m = { ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, s], ArrowDown: [0, -s] }[ev.key];
      if (!m) return;
      view.yaw = clamp(view.yaw + m[0], -Math.PI / 2, Math.PI / 2);
      view.pitch = clamp(view.pitch + m[1], -Math.PI / 2, Math.PI / 2);
      syncSlider();
      draw();
      ev.preventDefault();
    });
    document.addEventListener('you-changed', draw);
    return { draw, resize() { resize(); draw(); } };
  }

  // ---------- nearest-word lists ----------
  function renderNearest() {
    const el2 = $('#nearest-2d');
    const el3 = $('#nearest-3d');
    const youStatus = $('#you-status');
    if (!shared.you) {
      if (el2) el2.innerHTML = '<li class="muted">Tap or drag on the map to place yourself.</li>';
      if (el3) el3.innerHTML = '<li class="muted">Place yourself on the first map, then set the third number here.</li>';
      if (youStatus) youStatus.textContent = '';
      return;
    }
    const n2 = nearest(shared.you, 5, false);
    if (youStatus) youStatus.textContent = `You are at valence ${fmt(shared.you.v, 1)}, arousal ${fmt(shared.you.a, 1)}.`;
    if (el2) {
      el2.innerHTML = n2.map(({ p, d }) => `<li><b>${p.w}</b> <span class="n">${fmt(d, 2)} away</span></li>`).join('');
    }
    if (el3) {
      if (shared.youD == null) {
        el3.innerHTML = '<li class="muted">Set the dominance slider to see the nearest words in three dimensions.</li>';
      } else {
        const you3 = { v: shared.you.v, a: shared.you.a, d: shared.youD };
        const n3 = nearest(you3, 5, true);
        const in2 = new Set(n2.map((x) => x.p.w));
        el3.innerHTML = n3.map(({ p, d }) => `<li${in2.has(p.w) ? '' : ' class="new"'}><b>${p.w}</b> <span class="n">${fmt(d, 2)} away${in2.has(p.w) ? '' : ' · not in the flat list'}</span></li>`).join('');
      }
    }
    const el2b = $('#nearest-2d-again');
    if (el2b) el2b.innerHTML = n2.map(({ p }) => `<li><b>${p.w}</b></li>`).join('');
  }

  // ---------- pairs list ----------
  function renderPairs() {
    const all = overlapPairs();
    const count = $('#pair-count');
    if (count) count.textContent = String(all.length);
    const row = (a, b) => {
      const p = BY_WORD[a], q = BY_WORD[b];
      const two = (x, y) => `${fmt(x)}<br>${fmt(y)}`;
      return `<tr><th scope="row">${p.w}<br><span class="vs">vs</span> ${q.w}</th><td>${two(p.v, q.v)}</td><td>${two(p.a, q.a)}</td><td class="hi">${two(p.d, q.d)}</td><td>${fmt(dist2(p, q))}</td><td class="hi">${fmt(Math.abs(p.d - q.d))}</td></tr>`;
    };
    const tb = $('#pairs-body');
    if (tb) tb.innerHTML = FEATURED_PAIRS.map(([a, b]) => row(a, b)).join('');
    const nb = $('#noise-body');
    if (nb) nb.innerHTML = NOISE_PAIRS.map(([a, b]) => row(a, b)).join('');
    const allBody = $('#all-pairs-body');
    if (allBody) allBody.innerHTML = all.map(({ a, b }) => row(a.w, b.w)).join('');
  }

  // ---------- mixed feelings ----------
  function setupMixed() {
    const hs = $('#mix-happy'), ss = $('#mix-sad');
    if (!hs || !ss) return;
    const mark = $('#mix-marker'), out = $('#mix-readout');
    const update = () => {
      const hval = Number(hs.value), sval = Number(ss.value);
      const net = hval - sval; // −8 … 8
      const pct = ((net + 8) / 16) * 100;
      mark.style.left = pct + '%';
      $('#mix-h').textContent = hval;
      $('#mix-s').textContent = sval;
      let word = 'neither pleasant nor unpleasant';
      if (net > 2) word = 'pleasant';
      if (net < -2) word = 'unpleasant';
      out.textContent = `happy ${hval}, sad ${sval} → one point on a bipolar axis reads “${word}” (${net > 0 ? '+' : ''}${net}). The pair (0, 0) and the pair (8, 8) land on the same point.`;
    };
    hs.addEventListener('input', update);
    ss.addEventListener('input', update);
    update();
  }

  // ---------- init ----------
  function init() {
    const f1 = PlaneFigure($('#fig-plane'), { interactive: true, showRussell: true });
    const f3 = PlaneFigure($('#fig-rotate'), { interactive: false, showRussell: false, showAll: true, showYou: false, rotation: 0 });
    const f2 = VFigure($('#fig-v'));
    const f5 = TiltFigure($('#fig-tilt'));
    const figs = [f1, f2, f3, f5];

    const showAll = $('#show-all');
    if (showAll) showAll.addEventListener('change', () => f1.set('showAll', showAll.checked));
    const rot = $('#rotate-slider');
    const rotOut = $('#rotate-readout');
    if (rot) {
      rot.addEventListener('input', () => {
        f3.set('rotation', Number(rot.value));
        if (rotOut) rotOut.textContent = rot.value + '°';
      });
    }
    const dSlider = $('#you-d');
    const dOut = $('#you-d-readout');
    if (dSlider) {
      dSlider.addEventListener('input', () => {
        shared.youD = Number(dSlider.value);
        if (dOut) dOut.textContent = fmt(shared.youD, 1);
        document.dispatchEvent(new CustomEvent('you-changed'));
      });
    }
    const clear = $('#clear-you');
    if (clear) clear.addEventListener('click', () => {
      shared.you = null; shared.youD = null;
      if (dSlider) dSlider.value = '5';
      if (dOut) dOut.textContent = '—';
      document.dispatchEvent(new CustomEvent('you-changed'));
    });
    document.addEventListener('you-changed', renderNearest);
    renderNearest();
    renderPairs();
    setupMixed();

    const stat = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    stat('stat-words', String(LEX.length));
    stat('stat-russell', String(RUSSELL.length));

    let raf = 0;
    const relayout = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => figs.forEach((f) => f.resize())); };
    window.addEventListener('resize', relayout);
    if ('ResizeObserver' in window) new ResizeObserver(relayout).observe($('#fig-plane'));
    darkQuery.addEventListener('change', () => figs.forEach((f) => f.draw()));
    figs.forEach((f) => f.draw());
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
