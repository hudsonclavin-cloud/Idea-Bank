/* app.js: draws the bodega, the glass and the chart, and keeps the words in step.
 * All the arithmetic is in solera.js; this file only asks it questions. */
(function () {
  'use strict';
  const S = window.Solera;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const intParam = (k) => {
    const v = params.get(k);
    return v !== null && /^\d{1,4}$/.test(v) ? parseInt(v, 10) : null;
  };

  const MIN_YEAR = 1827;
  const MAX_YEAR = 2326;
  const clampYear = (y) => Math.max(MIN_YEAR, Math.min(MAX_YEAR, y));
  const NOW = clampYear(intParam('now') || new Date().getFullYear());
  const reduceQ = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const darkQ = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : { matches: false };
  const STORE = 'idea-bank.60-solera';

  // ?evap=0 (a percentage, in steps of 0.5 up to 6) opens the solera with that evaporation.
  const evapParam = (() => {
    const v = params.get('evap');
    if (v === null || !/^\d(\.\d)?$/.test(v)) return null;
    const x = Math.round(parseFloat(v) * 2) / 2;
    return x <= 6 ? x / 100 : null;
  })();

  const state = {
    p: { ...S.DEFAULTS, ...(evapParam === null ? {} : { evap: evapParam }) },
    year: clampYear(intParam('year') || NOW),
    your: null,
    note: '',
    playing: false,
    anim: null,
    hover: null,
    timer: 0,
  };

  // ---- words ------------------------------------------------------------------------
  const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  const ORD = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];
  const numWord = (k) => (k <= 10 ? WORDS[k] : String(k));
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const pct = () => Math.round(state.p.draw * 100);
  const drawWord = () => ({ 50: 'half', 25: 'a quarter', 20: 'a fifth', 10: 'a tenth', 5: 'a twentieth' })[pct()] || pct() + '%';
  const fracText = (x) => {
    const q = Math.round(x * 100);
    return ({ 50: '½', 25: '¼', 75: '¾', 20: '⅕', 80: '⅘', 10: '⅒' })[q] || String(q / 100);
  };
  const oddsText = () => {
    const q = pct();
    return 100 % q === 0 ? 'one time in ' + numWord(100 / q) : q + ' times in a hundred';
  };
  const yearsWord = (k) => (k === 1 ? 'one year' : numWord(k) + ' years');
  const pctText = (x) => +(x * 100).toFixed(1) + '%';
  const evap = () => state.p.evap || 0;
  const molecules = (c) => (c === '1' ? 'molecule' : 'molecules');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const lnN = () => Math.log(state.p.molecules);
  const share = (ln) => S.shareText(ln);
  const count = (ln) => S.countText(ln + lnN());
  /** The chance of at least one molecule, given ln of the expected count. */
  const chanceText = (lnC) => {
    const pa = S.probAtLeastOne(lnC);
    if (pa >= 0.01) return Math.round(pa * 100) + '%';
    if (pa >= 1e-4) return +(pa * 100).toPrecision(1) + '%';
    const odds = 1 / pa;
    return 'about 1 in ' + (odds < 1e6 ? S.withCommas(Math.round(odds / Math.pow(10, Math.floor(Math.log10(odds)) - 1)) * Math.pow(10, Math.floor(Math.log10(odds)) - 1)) : S.sci(Math.log(odds), 1));
  };
  const chancePhrase = (lnC) => {
    const t = chanceText(lnC);
    return t.startsWith('about ') ? 'about a ' + t.slice(6) + ' chance' : 'a ' + t + ' chance';
  };
  const rowName = (d, n) => (d === n ? 'solera' : n - d + 'ª criadera');
  const yourLabel = () => (state.note ? state.your + ' (' + state.note + ')' : String(state.your));

  // ---- colour -------------------------------------------------------------------------
  const WINE = [
    [0, [242, 228, 164]],
    [4, [232, 200, 104]],
    [10, [214, 155, 60]],
    [25, [178, 98, 33]],
    [60, [122, 52, 19]],
    [160, [72, 26, 9]],
  ];
  const WINE_ON_DARK = [
    [0, [244, 232, 180]],
    [4, [238, 204, 112]],
    [10, [226, 163, 78]],
    [25, [212, 124, 62]],
    [60, [186, 94, 58]],
    [160, [150, 74, 62]],
  ];
  function ramp(stops, age) {
    const a = Math.log1p(Math.max(0, age));
    for (let i = 1; i < stops.length; i++) {
      const a0 = Math.log1p(stops[i - 1][0]);
      const a1 = Math.log1p(stops[i][0]);
      if (a <= a1) {
        const u = (a - a0) / (a1 - a0);
        const c0 = stops[i - 1][1];
        const c1 = stops[i][1];
        return c0.map((v, j) => Math.round(v + (c1[j] - v) * u));
      }
    }
    return stops[stops.length - 1][1];
  }
  const rgb = (c, a) => (a === undefined ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`);
  let css = {};
  function readColours() {
    const cs = getComputedStyle(document.documentElement);
    for (const k of ['ink', 'muted', 'rule', 'accent', 'you', 'wall', 'floor', 'floor-edge', 'cask', 'cask-rim', 'hoop', 'chalk', 'label', 'panel']) {
      css[k] = cs.getPropertyValue('--' + k).trim() || '#888';
    }
  }
  const isDark = () => {
    const t = document.documentElement.getAttribute('data-theme');
    return t ? t === 'dark' : darkQ.matches;
  };

  // ---- the state of the solera in a given year -------------------------------------------
  function snapshot(year) {
    const n = state.p.rows;
    const rows = [];
    for (let d = 1; d <= n; d++) rows.push(S.meanAge(S.row(state.p, year, d)));
    const glassAge = year > state.p.founded ? S.meanAge(S.glass(state.p, year)) : 0;
    return { rows, glassAge };
  }

  // ---- canvases ---------------------------------------------------------------------------
  function fit(canvas, w, h) {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.style.height = h + 'px';
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  const bodega = $('bodega');
  const glassCv = $('glass');
  const chart = $('chart');

  function bodegaLayout() {
    const W = bodega.clientWidth || 358;
    const n = state.p.rows;
    const labelW = W < 480 ? 86 : 112;
    const cols = W < 430 ? 3 : W < 600 ? 4 : 5;
    const top = 28;
    const floorH = 14;
    const pitch = 2.16;
    let r = Math.min(46, (W - labelW - 14) / (cols * 2.2));
    const maxH = 470;
    if (n * pitch * r + top + floorH > maxH) r = (maxH - top - floorH) / (n * pitch);
    const H = Math.round(n * pitch * r + top + floorH + 6);
    const colW = (W - labelW - 14) / cols;
    const cy = (d) => top + (d - 0.5) * pitch * r;
    const cx = (c) => labelW + colW * (c + 0.5);
    return { W, H, n, r, cols, colW, labelW, top, floorH, cx, cy };
  }

  function drawCask(ctx, x, y, r, wine, level, chalk) {
    // rim and head
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = css['cask-rim'];
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, r * 0.92, 0, Math.PI * 2);
    ctx.fillStyle = css.cask;
    ctx.fill();
    // staves
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.lineWidth = 1;
    for (let sx = x - r; sx <= x + r; sx += r * 0.3) {
      ctx.beginPath();
      ctx.moveTo(sx, y - r);
      ctx.lineTo(sx, y + r);
      ctx.stroke();
    }
    ctx.restore();
    ctx.beginPath();
    ctx.arc(x, y, r * 0.92, 0, Math.PI * 2);
    ctx.strokeStyle = css.hoop;
    ctx.lineWidth = Math.max(1, r * 0.04);
    ctx.stroke();
    // the window onto the wine
    const pr = r * 0.58;
    const py = y + r * 0.1;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, py, pr, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(10,6,3,0.82)';
    ctx.fill();
    ctx.clip();
    const surface = py + pr - Math.max(0, Math.min(1, level)) * 2 * pr * 0.86;
    ctx.fillStyle = rgb(wine);
    ctx.fillRect(x - pr, surface, 2 * pr, py + pr - surface);
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillRect(x - pr, surface, 2 * pr, Math.max(1, pr * 0.06));
    ctx.restore();
    ctx.beginPath();
    ctx.arc(x, py, pr, 0, Math.PI * 2);
    ctx.strokeStyle = css.hoop;
    ctx.lineWidth = Math.max(1.5, r * 0.05);
    ctx.stroke();
    if (chalk) {
      ctx.fillStyle = css.chalk;
      ctx.globalAlpha = 0.92;
      ctx.font = `${Math.max(10, Math.round(r * 0.27))}px "Chalkboard SE", "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(chalk, x, y - r * 0.68);
      ctx.globalAlpha = 1;
    }
  }

  function drawBodega() {
    const L = bodegaLayout();
    const ctx = fit(bodega, L.W, L.H);
    ctx.clearRect(0, 0, L.W, L.H);
    ctx.fillStyle = css.wall;
    ctx.fillRect(0, 0, L.W, L.H);
    // floor
    const floorY = L.H - L.floorH;
    ctx.fillStyle = css.floor;
    ctx.fillRect(0, floorY, L.W, L.floorH);
    ctx.fillStyle = css['floor-edge'];
    ctx.fillRect(0, floorY, L.W, 1.5);

    // The rows are drawn as they stand just after this year's scales; the glass was drawn
    // before them, so it is a year older than the bottom row looks.
    ctx.fillStyle = css.muted;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `${L.W < 480 ? 12 : 13}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.fillText('Average ages just after this year\u2019s scales', 10, 12);

    const a = state.anim;
    const n = L.n;
    const g = S.rates(state.p);
    const ev = evap();
    const cur = a ? a.next : snapshot(state.year);
    const prev = a ? a.prev : cur;
    const phases = n + 1;
    const u = a ? a.u : 1;
    const phaseOf = (k) => Math.max(0, Math.min(1, u * phases - k));

    for (let d = 1; d <= n; d++) {
      // Row d gives to the row below in phase n - d and is refilled in phase n - d + 1.
      const give = phaseOf(n - d);
      const get = phaseOf(n - d + 1);
      const ease = (t) => t * t * (3 - 2 * t);
      // Each cask has lost `ev` to the wood since last year; row d passes down g[d] - ev
      // (the bottom row: the draw) and takes in g[d] from above.
      const level = a ? 1 - ev * ease(phaseOf(0)) - (g[d] - ev) * ease(give) + g[d] * ease(get) : 1;
      const age = a ? prev.rows[d - 1] + (cur.rows[d - 1] - prev.rows[d - 1]) * ease(get) : cur.rows[d - 1];
      const colour = ramp(WINE, age);
      for (let c = 0; c < L.cols; c++) drawCask(ctx, L.cx(c), L.cy(d), L.r, colour, level, d === n ? String(state.p.founded) : '');
      // row label, chalked on the wall
      ctx.fillStyle = css.label;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.font = `600 ${L.W < 480 ? 13 : 15}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      ctx.fillText(rowName(d, n), 10, L.cy(d) - 1);
      ctx.font = `${L.W < 480 ? 12 : 13}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      ctx.fillStyle = css.muted;
      ctx.fillText('avg ' + Math.round(age) + (Math.round(age) === 1 ? ' yr' : ' yrs'), 10, L.cy(d) + 15);
    }

    // streams: wine running down the scales, between the casks
    if (a && !reduceQ.matches) {
      for (let k = 1; k <= n; k++) {
        const t = phaseOf(k);
        if (t <= 0 || t >= 1) continue;
        const dst = n - k + 1; // row being refilled
        const src = dst - 1; // 0 = young wine from outside
        const alpha = Math.sin(Math.PI * t);
        const y0 = src === 0 ? 0 : L.cy(src);
        const y1 = L.cy(dst) + L.r * 0.3;
        const colour = src === 0 ? ramp(WINE, 0) : ramp(WINE, prev.rows[src - 1]);
        ctx.strokeStyle = rgb(colour, 0.9 * alpha);
        ctx.lineWidth = Math.max(2, L.r * 0.07);
        ctx.lineCap = 'round';
        for (let c = 0; c < L.cols; c++) {
          const x = L.cx(c) + L.colW / 2;
          const head = y0 + (y1 - y0) * Math.min(1, t * 2.2);
          ctx.beginPath();
          ctx.moveTo(x, y0);
          ctx.lineTo(x, head);
          ctx.stroke();
        }
      }
      // the saca itself: a stream off the floor row towards the glass
      const t0 = phaseOf(0);
      if (t0 > 0 && t0 < 1) {
        const colour = ramp(WINE, prev.rows[n - 1]);
        ctx.strokeStyle = rgb(colour, 0.9 * Math.sin(Math.PI * t0));
        ctx.lineWidth = Math.max(2, L.r * 0.07);
        const x = L.W - 6;
        ctx.beginPath();
        ctx.moveTo(L.cx(L.cols - 1) + L.r, L.cy(n));
        ctx.quadraticCurveTo(x, L.cy(n), x, floorY);
        ctx.stroke();
      }
    }
  }

  function drawGlass() {
    const W = glassCv.clientWidth || 64;
    const H = glassCv.clientHeight || 108;
    const ctx = fit(glassCv, W, H);
    ctx.clearRect(0, 0, W, H);
    const a = state.anim;
    const cx = W / 2;
    const rimY = H * 0.05;
    const bowlBottom = H * 0.6;
    const bowl = () => {
      ctx.beginPath();
      ctx.moveTo(cx - W * 0.2, rimY);
      ctx.bezierCurveTo(cx - W * 0.27, H * 0.22, cx - W * 0.44, H * 0.42, cx - W * 0.2, H * 0.56);
      ctx.quadraticCurveTo(cx, bowlBottom + H * 0.02, cx + W * 0.2, H * 0.56);
      ctx.bezierCurveTo(cx + W * 0.44, H * 0.42, cx + W * 0.27, H * 0.22, cx + W * 0.2, rimY);
    };
    let level = 1;
    let age = a ? a.next.glassAge : snapshot(state.year).glassAge;
    if (a && !reduceQ.matches) {
      const t = Math.max(0, Math.min(1, a.u * (state.p.rows + 1)));
      level = t;
    }
    // wine
    ctx.save();
    bowl();
    ctx.closePath();
    ctx.clip();
    const top = bowlBottom - (bowlBottom - H * 0.27) * level;
    ctx.fillStyle = rgb(ramp(WINE, age));
    ctx.fillRect(0, top, W, bowlBottom - top + 2);
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillRect(0, top, W, 1.2);
    ctx.restore();
    // glass
    ctx.strokeStyle = css.ink;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1.4;
    bowl();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, bowlBottom + H * 0.01);
    ctx.lineTo(cx, H * 0.9);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(cx, H * 0.92, W * 0.3, H * 0.025, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    ctx.moveTo(cx - W * 0.14, H * 0.12);
    ctx.quadraticCurveTo(cx - W * 0.25, H * 0.3, cx - W * 0.2, H * 0.45);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // ---- the chart ------------------------------------------------------------------------------
  const BOTTOM = -35; // log10 floor of the chart
  function chartLayout() {
    const W = chart.clientWidth || 358;
    const H = W < 480 ? 260 : 300;
    const m = { l: 46, r: 10, t: 16, b: 28 };
    const y1 = state.year;
    const x0 = Math.max(state.p.founded, y1 - 300);
    const span = y1 - x0;
    const pw = W - m.l - m.r;
    const ph = H - m.t - m.b;
    const px = pw / span;
    return {
      W, H, m, x0, x1: y1, px, pw, ph,
      x: (yr) => m.l + (yr - x0) * px,
      y: (l10) => m.t + (Math.min(0, Math.max(BOTTOM, l10)) / BOTTOM) * ph,
      yearAt: (X) => Math.round(x0 + (X - m.l) / px - 0.5),
    };
  }

  function drawChart() {
    const C = chartLayout();
    const ctx = fit(chart, C.W, C.H);
    ctx.clearRect(0, 0, C.W, C.H);
    const dark = isDark();
    const ui = '12px system-ui, -apple-system, "Segoe UI", sans-serif';
    // grid
    ctx.font = ui;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    for (let e = 0; e >= BOTTOM; e -= 5) {
      const y = C.y(e);
      ctx.strokeStyle = css.rule;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(C.m.l, Math.round(y) + 0.5);
      ctx.lineTo(C.W - C.m.r, Math.round(y) + 0.5);
      ctx.stroke();
      ctx.fillStyle = css.muted;
      ctx.fillText(e === 0 ? 'all' : '10' + S.sup(e), C.m.l - 6, y);
    }
    // x labels
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const span = C.x1 - C.x0;
    const step = span <= 60 ? 10 : span <= 130 ? 25 : 50;
    let lastX = -1e9;
    for (let yr = Math.ceil(C.x0 / step) * step; yr <= C.x1; yr += step) {
      const x = C.x(yr + 0.5);
      if (x - lastX < 44 || x > C.W - 18) continue;
      ctx.fillStyle = css.muted;
      ctx.fillText(String(yr), x, C.H - C.m.b + 7);
      lastX = x;
    }
    // bars: solid above the one-molecule line, ghostly below it
    const comp = S.glass(state.p, state.year);
    const bw = Math.max(1, C.px - (C.px > 4 ? 1 : 0));
    const N = lnN();
    const ym = C.y(-N / Math.LN10);
    const base = C.m.t + C.ph;
    for (const e of comp) {
      if (e.ln === -Infinity || e.year < C.x0) continue;
      const yTop = C.y(e.ln / Math.LN10);
      const colour = ramp(dark ? WINE_ON_DARK : WINE, e.age);
      const x = C.x(e.year);
      const w = e.founding ? Math.max(bw, 3) : bw;
      const ghostTop = Math.max(yTop, ym);
      ctx.fillStyle = rgb(colour, dark ? 0.26 : 0.22);
      ctx.fillRect(x, ghostTop, w, base - ghostTop);
      if (yTop < ym) {
        ctx.fillStyle = rgb(colour, 1);
        ctx.fillRect(x, yTop, w, ym - yTop);
      } else if (yTop < base - 1) {
        ctx.fillStyle = rgb(colour, 0.7);
        ctx.fillRect(x, yTop, w, 1.5);
      }
    }
    const halo = (text, x, y) => {
      ctx.lineWidth = 3.5;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = css.panel;
      ctx.strokeText(text, x, y);
      ctx.fillText(text, x, y);
    };
    // founding label
    ctx.font = ui;
    ctx.textAlign = 'left';
    if (comp[0].year >= C.x0) {
      const l10 = comp[0].ln / Math.LN10;
      if (l10 > BOTTOM + 1) {
        ctx.fillStyle = css.ink;
        ctx.textBaseline = 'bottom';
        halo(String(state.p.founded), C.x(state.p.founded) + 1, C.y(l10) - 3);
      }
    }
    // markers
    const marker = (yr, colour, label, dash) => {
      if (yr === null || yr < C.x0 || yr >= C.x1) return;
      const x = C.x(yr) + bw / 2;
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1.5;
      ctx.setLineDash(dash ? [3, 3] : []);
      ctx.beginPath();
      ctx.moveTo(x, C.m.t);
      ctx.lineTo(x, C.m.t + C.ph);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = colour;
      ctx.font = '600 ' + ui;
      ctx.textBaseline = 'top';
      const tw = ctx.measureText(label).width;
      const right = x + 4 + tw < C.W - C.m.r;
      ctx.textAlign = right ? 'left' : 'right';
      if (label) halo(label, right ? x + 4 : x - 4, C.m.t + 2);
    };
    if (NOW !== state.your) marker(NOW, css.muted, String(NOW), true);
    if (state.your) marker(state.your, css.you, String(state.your), false);
    if (state.hover !== null) marker(state.hover, css.ink, '', false);
    // the one-molecule line
    ctx.strokeStyle = css.ink;
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(C.m.l, ym);
    ctx.lineTo(C.W - C.m.r, ym);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = css.ink;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.font = '600 ' + ui;
    halo('one molecule per glass', C.W - C.m.r - 2, ym + 4);
  }

  // ---- milestones -------------------------------------------------------------------------------
  function milestones() {
    const p = state.p;
    const y0 = p.founded;
    const out = [];
    const add = (year, html, kind) => {
      if (year !== null && year >= y0 && year <= MAX_YEAR) out.push({ year, html, kind: kind || '' });
    };
    add(y0, 'The solera is founded. Every cask is filled with the same wine.', 'found');
    const first = S.vintageLife(p, y0 + 1);
    add(first.first, `The first young wine, put in at the top in ${y0 + 1}, reaches the glass.`);
    add(S.foundingGone(p), `From now on a glass holds less than one molecule of ${y0}, on average. The chalk on the bottom row still says ${y0}.`, 'gone');
    const life = S.vintageLife(p, NOW);
    add(NOW, `Now. This year&rsquo;s young wine goes in at the top.`, 'now');
    add(life.first, `${NOW}&rsquo;s young wine reaches the glass: ${share(life.firstLn)} of it.`);
    add(life.peaks[0], `${NOW} is at its most: ${share(life.peakLn)} of the glass` + (life.peaks.length > 1 ? `, and exactly as much again in ${life.peaks[1]}.` : '.'));
    add(life.gone, `From now on a glass holds less than one molecule of ${NOW}, on average. Every later year, up to ${yearsWord(p.rows)} ago, is still there.`);
    if (state.your && state.your !== NOW) {
      const L = S.vintageLife(p, state.your);
      const lab = esc(yourLabel());
      add(state.your, `The young wine of <span class="you">${lab}</span> goes in at the top.`, 'you');
      add(L.first, `<span class="you">${lab}</span> reaches the glass.`, 'you');
      add(L.peaks[0], `<span class="you">${lab}</span> is at its most: ${share(L.peakLn)} of the glass` + (L.peaks.length > 1 ? `, and as much again in ${L.peaks[1]}.` : '.'), 'you');
      add(L.gone, `From now on a glass holds less than one molecule of <span class="you">${lab}</span>, on average.`, 'you');
    }
    out.sort((a, b) => a.year - b.year);
    return out;
  }

  // ---- words on the page ------------------------------------------------------------------------
  function renderFacts() {
    const p = state.p;
    const Y = state.year;
    const g = S.glassStats(p, Y);
    const y0 = p.founded;
    const lines = [];
    if (g.youngest === y0) {
      lines.push(`<b>All of it is the wine the casks were filled with in ${y0}</b>, now ${yearsWord(Y - y0)} old. Young wine takes ${yearsWord(p.rows)} to come down the rows.`);
    } else {
      const half = g.medianYear === y0 ? `More than half of it is still the founding wine.` : `Half of it went in at the top in ${g.medianYear} or later.`;
      lines.push(`<b>Average age ${g.meanAge.toFixed(1).replace(/\.0$/, '')} years.</b> ${half} The youngest went in in ${g.youngest}: young wine takes ${yearsWord(p.rows)} to reach the glass.`);
      const fc = g.founding.lnCount;
      let found;
      if (Math.exp(g.founding.ln) >= 1e-4) {
        found = `The wine every cask was filled with in ${y0} is still <span class="num">${share(g.founding.ln)}</span> of the glass.`;
      } else if (fc >= 0) {
        const c = count(g.founding.ln);
        found = `Of ${y0}, the wine every cask was first filled with, there ${c === '1' ? 'is' : 'are'} about <span class="num">${c}</span> ${molecules(c)} in a glass: <span class="num">${share(g.founding.ln)}</span>.`;
      } else {
        const gone = S.foundingGone(p);
        const since = gone === Y ? 'from this year on' : `since ${gone}`;
        found = `Of ${y0}, the wine every cask was first filled with, a glass has held less than one molecule ${since}, on average. The chance that this glass holds even one: <span class="num">${chanceText(fc)}</span>. The bottom row is still chalked ${y0}.`;
      }
      // How much the evaporation changes this: the same solera with no losses.
      if (evap() > 0) {
        const p0 = { ...p, evap: 0 };
        const g0 = S.glassStats(p0, Y).founding;
        const gone0 = S.foundingGone(p0);
        const c0 = count(g0.ln);
        if (Math.exp(g0.ln) >= 1e-4) found += ` Without evaporation it would be <span class="num">${share(g0.ln)}</span>.`;
        else if (g0.lnCount >= 0) found += ` Without evaporation there would be about <span class="num">${c0}</span> ${molecules(c0)} of it in this glass` + (gone0 ? `, and less than one only from ${gone0}.` : '.');
        else if (gone0 !== null) found += ` Without evaporation that would not have happened until ${gone0}.`;
      }
      lines.push(found);
      if (g.runFrom !== null) {
        // The unbroken run back from the youngest year; the founding wine is reported above.
        const scarce = g.unbroken && g.founding.ln < g.scarcest.ln ? g.composition[0] : g.scarcest;
        const from = g.unbroken ? y0 : g.runFrom;
        const sc = count(scarce.ln);
        let tail = '';
        if (g.unbroken) tail = '';
        else if (g.runFrom > y0 + 1) {
          const lostTo = g.runFrom - 1;
          const lost = lostTo === y0 + 1 ? `${y0 + 1} has` : lostTo === y0 + 2 ? `${y0 + 1} and ${lostTo} have` : `The years ${y0 + 1} to ${lostTo} have`;
          tail = g.founding.counted ? ` ${lost}, on average, gone, though the founding wine has not: it is everything that has not yet come all the way down, not one year&rsquo;s wine.` : ` Anything older has, on average, gone.`;
        }
        lines.push(`Every year from ${from} to ${g.youngest} is in it, at least one molecule of each on average; the scarcest is ${scarce.year}, with about <span class="num">${sc}</span> ${molecules(sc)}.` + tail);
      }
    }
    $('facts').innerHTML = lines.map((l) => `<p>${l}</p>`).join('');
  }

  function renderMoment(list) {
    const here = list.filter((m) => m.year === state.year && m.kind !== 'found');
    $('moment').innerHTML = here.map((m) => `<b>${m.year}.</b> ${m.html}`).join(' ');
  }

  function renderBook(list) {
    $('book').innerHTML = list
      .map((m) => {
        const cls = [m.year < state.year ? 'past' : m.year === state.year ? 'reached' : '', m.kind === 'now' ? 'now' : '', m.kind === 'you' ? 'you' : ''].filter(Boolean).join(' ');
        return `<li class="${cls}"><time>${m.year}</time> ${m.html}</li>`;
      })
      .join('');
  }

  function renderYours() {
    const out = $('yourText');
    const y = state.your;
    const y0 = state.p.founded;
    if (!y) {
      out.innerHTML = '';
      return;
    }
    const p = state.p;
    const L = S.vintageLife(p, y);
    const lab = `<span class="you">${esc(yourLabel())}</span>`;
    const past = (yr) => yr <= NOW;
    const parts = [];
    const peakYears = L.peaks.join(' and ');
    const both = L.peaks.length > 1 ? ', both years' : '';
    const arrive = past(L.first) ? `${lab} first reached the glass in ${L.first}` : `${lab} will first reach the glass in ${L.first}`;
    const peak = (past(L.peaks[0]) ? 'was at its most in ' : 'will be at its most in ') + peakYears + ` (${share(L.peakLn)} of a glass${both})`;
    const gone = L.gone === null ? '' : past(L.gone) ? `and since ${L.gone} a glass has held less than one molecule of it, on average` : `and from ${L.gone} a glass will hold less than one molecule of it, on average`;
    parts.push(`${arrive}, ${peak}${gone ? ', ' + gone : ''}.`);
    // In the glass being shown
    const Y = state.year;
    if (Y < y) parts.push(`In ${Y} it is not in the casks yet.`);
    else if (Y === y) parts.push(`In ${Y} it goes in at the top, after that year&rsquo;s glass is drawn.`);
    else if (Y - y < p.rows) parts.push(`In ${Y} it is still on its way down the rows.`);
    else {
      const ln = S.lnAge(p, Y - y);
      if (ln + lnN() >= 0) parts.push(`In the glass of ${Y} it is ${share(ln)}: about ${count(ln)} ${molecules(count(ln))}.`);
      else parts.push(`In the glass of ${Y} there is less than one molecule of it, on average.`);
    }
    if (y <= y0) parts.length = 0;
    out.innerHTML = parts.join(' ');
  }

  function renderProse() {
    const p = state.p;
    const n = p.rows;
    const f = p.draw;
    const ev = evap();
    const g = S.rates(p);
    document.querySelectorAll('.js-draw').forEach((el) => (el.textContent = drawWord()));
    document.querySelectorAll('.js-now').forEach((el) => (el.textContent = String(NOW)));
    const F = fracText(f);
    const G = fracText(1 - f);
    const mean = S.steadyMeanAge(p);
    const heads = n === 1 ? 'one head' : numWord(n) + ' heads';
    if (ev === 0) {
      $('proof1').innerHTML = `Take one molecule in this year&rsquo;s glass and follow it backwards, a year at a time. Every year, ${drawWord()} of the bottom row had just come down from the row above. The casks here are perfectly mixed, so our molecule was one of those newcomers with chance ${F}, whatever happened in any other year. Once it is in the row above, the same is true there, and so on up. It went in at the top on its ${ORD[n]} arrival, counting backwards.`;
      $('proof2').innerHTML = `So its age is the number of tosses it takes a coin that lands heads ${oddsText()} to show ${heads}, and every share on this page is a count of coin tosses:`;
      $('fAge').innerHTML = `C(<i>k</i>&minus;1, ${n - 1}) &middot; (${F})<sup>${n}</sup> &middot; (${G})<sup><i>k</i>&minus;${n}</sup>, for <i>k</i> &ge; ${n}`;
      $('fFound').innerHTML = `the chance of fewer than ${heads} in (year &minus; ${p.founded + 1}) tosses`;
      $('fMean').innerHTML = `rows &divide; draw = ${n} &divide; ${F} = ${+mean.toFixed(1)} years`;
    } else {
      // Bottom row first: that is the order in which the molecule is followed back.
      const up = [];
      for (let d = n; d >= 1; d--) up.push(pctText(g[d]));
      const list = up.length === 1 ? up[0] : up.slice(0, -1).join(', ') + ' and ' + up[up.length - 1];
      const rowsUp = n === 1 ? '' : n === 2 ? ` The top row passes that much down and loses its own ${pctText(ev)}, so ${up[1]} of it is new each year.` : ` The row above passes that much down and loses its own ${pctText(ev)}, so ${up[1]} of it is new each year; and so on up, to ${up[n - 1]} at the top.`;
      $('proof1').innerHTML = `Take one molecule in this year&rsquo;s glass and follow it backwards, a year at a time. Every year the bottom row had just been topped up from the row above: ${drawWord()} to replace the draw and ${pctText(ev)} to replace what the wood breathed out, ${up[0]} in all. The casks here are perfectly mixed, and evaporation takes every molecule with the same chance, so our molecule was one of those newcomers with chance ${up[0]}, whatever happened in any other year.${rowsUp} It went in at the top on its ${ORD[n]} arrival, counting backwards.`;
      $('proof2').innerHTML = n === 1
        ? `So its age is the number of tosses it takes a coin that lands heads ${up[0]} of the time to show a head, and every share on this page is a count of coin tosses:`
        : `So its age is the number of tosses it takes to get a head from each of ${numWord(n)} coins in turn, landing heads ${list} of the time, and every share on this page is a count of coin tosses:`;
      $('fAge').innerHTML = `P<sub>${n}</sub>(<i>k</i>), where P<sub><i>d</i></sub>(<i>k</i>) = (1 &minus; <i>g<sub>d</sub></i>)&thinsp;P<sub><i>d</i></sub>(<i>k</i>&minus;1) + <i>g<sub>d</sub></i>&thinsp;P<sub><i>d</i>&minus;1</sub>(<i>k</i>&minus;1), starting from P<sub>0</sub>(0) = 1 and zero everywhere else, with <i>g</i> = ${up.slice().reverse().join(', ')} from the top row down`;
      $('fFound').innerHTML = `the chance that the coins have not all shown their heads in (year &minus; ${p.founded + 1}) tosses`;
      $('fMean').innerHTML = up.map((x) => `1 &divide; ${x}`).join(' + ') + ` = ${+mean.toFixed(1)} years`;
    }
    const lede = document.querySelector('.lede');
    const loss = ev > 0 ? ` Each cask loses ${pctText(ev)} a year through the wood, and that is made up from above too.` : '';
    if (n === 1) lede.textContent = `One row of casks. Once a year ${drawWord()} of it is drawn off and bottled, and the casks are topped up with young wine.${loss} Nobody has emptied a cask since ${p.founded}.`;
    else
      lede.textContent = `${cap(numWord(n))} rows of casks. Once a year ${drawWord()} of the bottom row is drawn off and bottled. The bottom row is topped up from ${n === 2 ? 'the top row' : 'the row above it, that row from the one above'}, and the top row with young wine.${loss} Nobody has emptied a cask since ${p.founded}.`;
    bodega.setAttribute('aria-label', `${cap(numWord(n))} row${n > 1 ? 's' : ''} of casks on a cellar floor, as they stand just after this year's scales. The bottom row, the solera, is chalked ${p.founded}. Each cask shows the colour of the wine inside, darker where it is older on average.`);
    // The 75 ml glass
    const g75 = S.foundingGone({ ...p, molecules: p.molecules * 0.75 });
    $('g75').textContent = g75 === null ? `after ${p.founded + 20000}` : `from ${g75}`;
    // knob summary
    const sd = S.steadyAgeSd(p);
    const gone = S.foundingGone(p);
    const one = S.singleCaskLike(p);
    let txt = `Once the founding wine has gone, a glass is on average ${+mean.toFixed(1)} years old, give or take ${sd.toFixed(1)} years (one standard deviation). `;
    if (n > 1 && one) {
      // The spread of ages in one glass is not a measure of how alike one year's glass is to
      // the next; the year-to-year change is (see yearToYearChange in solera.js).
      const ratio = S.yearToYearChange(one) / S.yearToYearChange(p);
      const lead = `Suppose each year&rsquo;s young wine differed from the others at random. Then the change from one year&rsquo;s glass to the next would be `;
      if (ratio >= 1.05) txt += lead + `${ratio.toFixed(1)} times smaller than with a single cask worked to the same average age: with rows, no wine younger than ${yearsWord(n)} reaches the glass, and each year&rsquo;s wine arrives a little at a time. `;
      else if (ratio <= 1 / 1.05) txt += lead + `${(1 / ratio).toFixed(1)} times larger than with a single cask worked to the same average age. `;
      else txt += lead + `about the same as with a single cask worked to the same average age. `;
    }
    const tense = (y) => (y <= NOW ? `Since ${y} a glass has held` : `From ${y} a glass holds`);
    txt += gone ? `${tense(gone)} less than one molecule of ${p.founded}, on average.` : `A glass holds at least one molecule of ${p.founded}, on average, past ${p.founded + 20000}.`;
    // How the founding wine's year moves with evaporation, for these rows and draw.
    const sweep = [0, 0.01, 0.02, 0.03, 0.04, 0.05].filter((e) => f + n * e < 1).map((e) => {
      const y = S.foundingGone({ ...p, evap: e });
      return `${y === null ? 'after ' + (p.founded + 20000) : y} ${e === 0 ? 'with none' : 'at ' + pctText(e)}`;
    });
    txt += ` With these rows and draw, that year depends on the evaporation: ${sweep.join(', ')}.`;
    $('knobText').innerHTML = txt;
    $('rowsOut').textContent = String(n);
    $('drawOut').textContent = pct() + '%';
    $('evapOut').textContent = pctText(ev);
  }

  function renderYear() {
    $('yearBig').textContent = String(state.year);
    $('yearOut').textContent = String(state.year);
    $('year').value = String(state.year);
    $('yearSub').textContent = state.year === NOW ? 'this year’s glass, drawn before the scales' : state.year < NOW ? 'the glass drawn that year, before the scales' : 'a glass still to come, drawn before the scales';
  }

  function renderReadout() {
    const Y = state.year;
    const h = state.hover;
    const out = $('readout');
    if (h === null) {
      out.textContent = 'Touch or drag across the chart to read any year.';
      return;
    }
    const p = state.p;
    if (h === p.founded) {
      const ln = S.glass(p, Y)[0].ln;
      const c = ln + lnN();
      out.innerHTML = `<b>${h}, the founding wine:</b> ${share(ln)} of the glass, ` + (c >= 0 ? `about ${count(ln)} ${molecules(count(ln))}.` : `less than one molecule on average (${chancePhrase(c)} of even one).`);
      return;
    }
    const age = Y - h;
    if (age < p.rows) {
      out.innerHTML = `<b>${h}</b> went in at the top ${age === 0 ? 'this year' : yearsWord(age) + ' ago'}; it reaches the glass in ${h + p.rows}.`;
      return;
    }
    const ln = S.lnAge(p, age);
    const c = ln + lnN();
    out.innerHTML = `<b>${h}</b>, ${age} years old: ${share(ln)} of the glass, ` + (c >= 0 ? `about ${count(ln)} ${molecules(count(ln))}.` : `less than one molecule on average (${chancePhrase(c)} of even one).`);
  }

  let cachedList = [];
  function renderText() {
    cachedList = milestones();
    renderYear();
    renderFacts();
    renderMoment(cachedList);
    renderBook(cachedList);
    renderYours();
    renderReadout();
  }

  function drawAll() {
    drawBodega();
    drawGlass();
    drawChart();
  }

  // ---- moving through time ------------------------------------------------------------------------
  let raf = 0;
  function kick() {
    if (!raf) raf = requestAnimationFrame(frame);
  }
  function frame(ts) {
    raf = 0;
    const a = state.anim;
    if (!a) return;
    if (!a.start) a.start = ts;
    a.u = Math.min(1, (ts - a.start) / a.dur);
    if (a.u >= 1) state.anim = null;
    drawBodega();
    drawGlass();
    if (state.anim) kick();
    else if (a.done) a.done();
  }

  function goTo(year, animate, done) {
    year = clampYear(year);
    const prevYear = state.year;
    if (state.anim) state.anim = null;
    state.year = year;
    renderText();
    drawChart();
    if (animate && year === prevYear + 1 && !reduceQ.matches) {
      state.anim = { prev: snapshot(prevYear), next: snapshot(year), u: 0, start: 0, dur: state.playing ? 560 : 1300, done };
      kick();
    } else {
      drawBodega();
      drawGlass();
      if (done) setTimeout(done, 0);
    }
  }

  function setPlaying(on) {
    state.playing = on;
    clearTimeout(state.timer);
    const b = $('play');
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.textContent = on ? 'Stop' : 'Keep running';
    if (on) tick();
  }

  function tick() {
    if (!state.playing) return;
    if (state.year >= MAX_YEAR) {
      setPlaying(false);
      return;
    }
    goTo(state.year + 1, true, () => {
      if (!state.playing) return;
      if (cachedList.some((m) => m.year === state.year && m.kind !== 'found')) {
        setPlaying(false);
        return;
      }
      state.timer = setTimeout(tick, reduceQ.matches ? 600 : 60);
    });
  }

  // ---- input ----------------------------------------------------------------------------------------
  function stepOnce() {
    if (state.playing) setPlaying(false);
    if (state.year < MAX_YEAR) goTo(state.year + 1, true);
  }
  $('step').addEventListener('click', stepOnce);
  bodega.addEventListener('click', stepOnce);
  $('play').addEventListener('click', () => {
    if (!state.playing && state.year >= MAX_YEAR) goTo(NOW, false);
    setPlaying(!state.playing);
  });
  $('now').addEventListener('click', () => {
    setPlaying(false);
    goTo(NOW, false);
  });
  $('year').addEventListener('input', (e) => {
    setPlaying(false);
    goTo(parseInt(e.target.value, 10), false);
  });

  function pointerYear(e) {
    const rect = chart.getBoundingClientRect();
    const C = chartLayout();
    const yr = C.yearAt(e.clientX - rect.left);
    const lo = C.x0;
    const hi = state.year - 1;
    return Math.max(lo, Math.min(hi, yr));
  }
  const onPointer = (e) => {
    state.hover = pointerYear(e);
    drawChart();
    renderReadout();
  };
  chart.addEventListener('pointerdown', onPointer);
  chart.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse' || e.buttons) onPointer(e);
  });

  function save() {
    try {
      if (state.your) localStorage.setItem(STORE, JSON.stringify({ your: state.your, note: state.note }));
      else localStorage.removeItem(STORE);
    } catch (err) {
      /* storage is a convenience only */
    }
  }
  function readYour() {
    const v = $('yourYear').value.trim();
    const y = /^\d{4}$/.test(v) ? parseInt(v, 10) : null;
    state.your = y !== null && y > state.p.founded && y <= MAX_YEAR ? y : null;
    state.note = $('yourNote').value.trim().slice(0, 28);
    const hint = y !== null && !state.your ? (y <= state.p.founded ? `The solera begins in ${state.p.founded}; its founding wine is the bar at the far left of the chart.` : `The page runs to ${MAX_YEAR}.`) : '';
    renderText();
    if (hint) $('yourText').textContent = hint;
    drawChart();
    save();
  }
  $('yourYear').addEventListener('input', readYour);
  $('yourNote').addEventListener('input', readYour);
  $('yourClear').addEventListener('click', () => {
    $('yourYear').value = '';
    $('yourNote').value = '';
    readYour();
  });

  function readKnobs() {
    state.p = { ...S.DEFAULTS, rows: parseInt($('rows').value, 10), draw: parseInt($('draw').value, 10) / 100, evap: parseInt($('evap').value, 10) / 1000 };
    state.anim = null;
    renderProse();
    renderText();
    drawAll();
  }
  $('rows').addEventListener('input', readKnobs);
  $('draw').addEventListener('input', readKnobs);
  $('evap').addEventListener('input', readKnobs);
  $('reset').addEventListener('click', () => {
    $('rows').value = String(S.DEFAULTS.rows);
    $('draw').value = String(Math.round(S.DEFAULTS.draw * 100));
    $('evap').value = String(Math.round(S.DEFAULTS.evap * 1000));
    readKnobs();
  });

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(drawAll, 60);
  });
  const recolour = () => {
    readColours();
    drawAll();
  };
  if (darkQ.addEventListener) darkQ.addEventListener('change', recolour);

  // ---- start ------------------------------------------------------------------------------------------
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (saved && Number.isInteger(saved.your)) {
      $('yourYear').value = String(saved.your);
      $('yourNote').value = typeof saved.note === 'string' ? saved.note.slice(0, 28) : '';
    }
  } catch (err) {
    /* no storage: start blank */
  }
  const urlYour = intParam('your');
  if (urlYour) $('yourYear').value = String(urlYour);
  $('year').min = String(MIN_YEAR);
  $('year').max = String(MAX_YEAR);
  $('evap').value = String(Math.round(state.p.evap * 1000));
  readColours();
  renderProse();
  state.your = null;
  {
    const v = $('yourYear').value.trim();
    const y = /^\d{4}$/.test(v) ? parseInt(v, 10) : null;
    state.your = y !== null && y > state.p.founded && y <= MAX_YEAR ? y : null;
    state.note = $('yourNote').value.trim().slice(0, 28);
  }
  renderText();
  drawAll();
})();
