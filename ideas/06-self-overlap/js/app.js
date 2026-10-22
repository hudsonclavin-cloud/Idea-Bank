/*
 * app.js: the interactive figures for "The Pattern That Trips Over Itself".
 * Every probability, average and payout shown here comes from js/overlap.js.
 */
(function () {
  'use strict';

  const O = window.Overlap;
  const SVGNS = 'http://www.w3.org/2000/svg';
  const motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const reducedMotion = () => !!(motionQuery && motionQuery.matches);

  /* ---------------- helpers ---------------- */

  function svgEl(tag, attrs, parent) {
    const e = document.createElementNS(SVGNS, tag);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function svgText(parent, x, y, str, attrs) {
    const t = svgEl('text', Object.assign({ x: x, y: y }, attrs || {}), parent);
    t.textContent = str;
    return t;
  }

  function newSvg(box, width, height) {
    box.textContent = '';
    return svgEl('svg', { width: width, height: height, viewBox: '0 0 ' + width + ' ' + height }, box);
  }

  function coin(parent, cx, cy, r, letter, extra) {
    const g = svgEl('g', { class: 'coin coin-' + letter + (extra ? ' ' + extra : '') }, parent);
    svgEl('circle', { cx: cx, cy: cy, r: r }, g);
    svgText(g, cx, cy, letter, {
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      'font-size': Math.max(8, r * 1.02).toFixed(1),
    });
    return g;
  }

  const fmtInt = (x) => Math.round(x).toLocaleString('en-US');
  const fmt = (x, d) => x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const pow2 = (k) => '2<sup>' + k + '</sup>';
  const newSeed = () => (Math.random() * 4294967296) >>> 0;
  const flipLetter = (c) => (c === 'H' ? 'T' : 'H');
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  // Calls fn(width) now and whenever the element's content width changes.
  function watchWidth(el, fn) {
    let last = -1;
    const run = () => {
      const w = Math.floor(el.clientWidth);
      if (w > 0 && w !== last) {
        last = w;
        fn(w);
      }
    };
    if (window.ResizeObserver) new ResizeObserver(run).observe(el);
    else window.addEventListener('resize', run);
    run();
    return () => last;
  }

  function on(root, act, fn) {
    const b = root.querySelector('[data-act="' + act + '"]');
    if (b) b.addEventListener('click', fn);
    return b;
  }

  function coinButtons(container, pattern, label, onTap) {
    container.textContent = '';
    for (let i = 0; i < pattern.length; i++) {
      const c = pattern[i];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'coin-btn coin-' + c;
      b.textContent = c;
      b.setAttribute('aria-label', label + ' flip ' + (i + 1) + ' of ' + pattern.length + ': ' + (c === 'H' ? 'heads' : 'tails') + '. Tap to change.');
      b.addEventListener('click', () => onTap(i));
      container.appendChild(b);
    }
  }

  function chips(container, items, current, onPick, label) {
    container.textContent = '';
    if (label) {
      const s = document.createElement('span');
      s.className = 'chip-label';
      s.textContent = label;
      container.appendChild(s);
    }
    for (const it of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = it.label;
      b.setAttribute('aria-pressed', String(it.value === current));
      b.addEventListener('click', () => onPick(it.value));
      container.appendChild(b);
    }
  }

  // Lay n coins out in rows that fit `width`. Returns positions and geometry.
  function gridLayout(n, width, target, opts) {
    const cols = Math.max(4, Math.floor(width / target));
    const cell = width / cols;
    const rows = Math.max(1, Math.ceil(n / cols));
    const rowH = cell + 2 * opts.band + (opts.gap || 0);
    const pos = [];
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / cols);
      const c = i % cols;
      pos.push({ x: c * cell + cell / 2, y: r * rowH + opts.band + cell / 2, row: r, col: c });
    }
    return { cols: cols, cell: cell, rows: rows, rowH: rowH, pos: pos, height: rows * rowH };
  }

  /* ---------------- 1. guess ---------------- */
  (function guess() {
    const reply = document.querySelector('.guess-reply');
    const msgs = {
      hh: 'Right: HH waits longer. The interesting part is by how much, and why. Flip some games.',
      same: 'That’s the natural answer, since each pair is equally likely at every position. Flip a few games and watch the averages.',
      ht: 'It’s the other way around. Flip a few games and watch the averages.',
    };
    const btns = document.querySelectorAll('[data-guess]');
    btns.forEach((btn) =>
      btn.addEventListener('click', () => {
        btns.forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
        reply.textContent = msgs[btn.dataset.guess];
      })
    );
  })();

  /* ---------------- 1. the race ---------------- */
  (function race() {
    const root = document.getElementById('w-race');
    if (!root) return;
    const flipsBox = root.querySelector('.race-flips');
    const lastLine = root.querySelector('.race-last');
    const histBox = root.querySelector('.race-hist');
    const statEl = (k) => root.querySelector('[data-stat="' + k + '"]');
    const TOP = 15; // waits 2..14 get their own bar; 15+ share the last one
    const exact = {};
    for (const p of ['HH', 'HT']) {
      const pmf = O.waitPMF(p, 400);
      const bins = new Array(TOP + 1).fill(0);
      for (let t = 2; t < pmf.length; t++) bins[Math.min(t, TOP)] += pmf[t];
      exact[p] = bins;
    }
    let bit = O.bitSource(O.mulberry32(newSeed()));
    let st;
    let timer = null;
    let pending = null;
    let shown = 0;

    function reset() {
      stop();
      pending = null;
      st = { games: 0, sumHH: 0, sumHT: 0, htFirst: 0, hist: { HH: new Array(TOP + 1).fill(0), HT: new Array(TOP + 1).fill(0) }, last: null };
      shown = 0;
    }

    function playOne() {
      let flips = '';
      let tHH = 0;
      let tHT = 0;
      while (!tHH || !tHT) {
        flips += bit() ? 'H' : 'T';
        const t = flips.length;
        if (t >= 2) {
          const pair = flips.slice(-2);
          if (!tHH && pair === 'HH') tHH = t;
          if (!tHT && pair === 'HT') tHT = t;
        }
      }
      return { flips: flips, tHH: tHH, tHT: tHT };
    }

    function record(g) {
      st.games++;
      st.sumHH += g.tHH;
      st.sumHT += g.tHT;
      if (g.tHT < g.tHH) st.htFirst++;
      st.hist.HH[Math.min(g.tHH, TOP)]++;
      st.hist.HT[Math.min(g.tHT, TOP)]++;
      st.last = g;
    }

    function stop() {
      if (timer) clearInterval(timer);
      timer = null;
    }

    function finish() {
      stop();
      if (pending) {
        record(pending);
        pending = null;
      }
      if (st.last) shown = st.last.flips.length;
    }

    function oneGame() {
      if (pending) {
        finish();
        renderStats();
        renderHist();
      }
      const g = playOne();
      if (reducedMotion()) {
        record(g);
        shown = g.flips.length;
        renderAll();
        return;
      }
      pending = g;
      shown = 0;
      renderFlips();
      timer = setInterval(() => {
        shown++;
        if (shown >= g.flips.length) {
          finish();
          renderAll();
        } else renderFlips();
      }, 120);
    }

    function batch(n) {
      finish();
      for (let i = 0; i < n; i++) record(playOne());
      shown = st.last.flips.length;
      renderAll();
    }

    let width = 0;
    function renderFlips() {
      if (!width) return;
      const g = pending || st.last;
      if (!g) {
        const svg = newSvg(flipsBox, width, 52);
        svgText(svg, 0, 30, 'Press “Flip one game” to start.', { class: 'empty-hint' });
        lastLine.textContent = '';
        return;
      }
      const L = gridLayout(g.flips.length, width, width < 480 ? 26 : 30, { band: 10, gap: 4 });
      const svg = newSvg(flipsBox, width, L.height);
      const r = L.cell * 0.4;
      for (let i = 0; i < Math.min(shown, g.flips.length); i++) coin(svg, L.pos[i].x, L.pos[i].y, r, g.flips[i]);
      const bracket = (end, cls, above) => {
        if (shown < end) return;
        const a = L.pos[end - 2];
        const b = L.pos[end - 1];
        const off = above ? -(r + 4) : r + 4;
        const tick = above ? 5 : -5;
        const seg = (x1, x2, y, capL, capR) => {
          let d = 'M' + x1 + ' ' + (y + (capL ? tick : 0)) + ' L' + x1 + ' ' + y + ' L' + x2 + ' ' + y;
          if (capR) d += ' L' + x2 + ' ' + (y + tick);
          svgEl('path', { d: d, class: cls }, svg);
        };
        if (a.row === b.row) seg(a.x - r * 0.7, b.x + r * 0.7, a.y + off, true, true);
        else {
          seg(a.x - r * 0.7, a.x + L.cell / 2, a.y + off, true, false);
          seg(b.x - L.cell / 2, b.x + r * 0.7, b.y + off, false, true);
        }
      };
      bracket(g.tHH, 'mark-a', true);
      bracket(g.tHT, 'mark-b', false);
      if (pending) {
        if (lastLine.textContent !== 'Flipping…') lastLine.textContent = 'Flipping…';
      } else
        lastLine.innerHTML =
          'This game: <b class="c-a">HH</b> first appeared at flip ' + g.tHH + ', <b class="c-b">HT</b> at flip ' + g.tHT + '.';
    }

    function renderStats() {
      statEl('games').textContent = fmtInt(st.games);
      statEl('hh').textContent = st.games ? fmt(st.sumHH / st.games, 2) : '–';
      statEl('ht').textContent = st.games ? fmt(st.sumHT / st.games, 2) : '–';
      statEl('first').textContent = st.games ? fmt((100 * st.htFirst) / st.games, 1) + '%' : '–';
    }

    function renderHist() {
      if (!width) return;
      const padL = 4;
      const panelH = width < 480 ? 74 : 84;
      const gapH = 14;
      const topPad = 18;
      const H = 2 * (panelH + topPad) + gapH + 40;
      const svg = newSvg(histBox, width, H);
      const nb = TOP - 1; // bins 2..TOP
      const bw = (width - padL) / nb;
      const yMax = 0.3;
      const xOf = (t) => padL + (t - 2) * bw + bw / 2;
      let base = 0;
      ['HH', 'HT'].forEach((p, k) => {
        const top = k * (panelH + topPad + gapH) + topPad;
        base = top + panelH;
        const side = k === 0 ? 'a' : 'b';
        svgEl('line', { x1: padL, x2: width, y1: base, y2: base, class: 'axis' }, svg);
        svgText(svg, width - 2, top - 4, p, { class: 'hist-title-' + side, 'text-anchor': 'end' });
        if (!st.games) {
          if (k === 0) svgText(svg, padL, top + panelH / 2, 'No games yet.', { class: 'empty-hint' });
          return;
        }
        for (let t = 2; t <= TOP; t++) {
          const f = st.hist[p][t] / st.games;
          const h = Math.min(panelH, (f / yMax) * panelH);
          if (h > 0) svgEl('rect', { x: xOf(t) - bw * 0.36, y: base - h, width: bw * 0.72, height: h, rx: 2, class: 'hist-bar-' + side }, svg);
          const eh = (exact[p][t] / yMax) * panelH;
          svgEl('line', { x1: xOf(t) - bw * 0.42, x2: xOf(t) + bw * 0.42, y1: base - eh, y2: base - eh, class: 'hist-exact' }, svg);
        }
        const mean = (k === 0 ? st.sumHH : st.sumHT) / st.games;
        const mx = clamp(xOf(2) + (mean - 2) * bw, padL + 1, width - 1);
        svgEl('line', { x1: mx, x2: mx, y1: top - 12, y2: base, class: 'mean-line-' + side }, svg);
        svgText(svg, mx + 5, top - 4, 'average ' + fmt(mean, 2), { class: 'mean-label' });
      });
      const axisY = base + 16;
      for (let t = 2; t <= TOP; t++) {
        if (width < 480 && t % 2 && t !== TOP) continue;
        svgText(svg, xOf(t), axisY, t === TOP ? TOP + '+' : String(t), { class: 'axis-label', 'text-anchor': 'middle' });
      }
      svgText(svg, width / 2, axisY + 17, 'flips until the pair first appeared', { class: 'axis-label', 'text-anchor': 'middle' });
    }

    function renderAll() {
      renderFlips();
      renderStats();
      renderHist();
    }

    reset();
    on(root, 'one', oneGame);
    on(root, 'hundred', () => batch(100));
    on(root, 'many', () => batch(10000));
    on(root, 'reset', () => {
      reset();
      bit = O.bitSource(O.mulberry32(newSeed()));
      renderAll();
    });
    watchWidth(flipsBox, (w) => {
      width = w;
      renderAll();
    });
  })();

  /* ---------------- 2. the strip ---------------- */
  (function strip() {
    const root = document.getElementById('w-strip');
    if (!root) return;
    const box = root.querySelector('.strip-svg');
    const N = 160;
    let flips = '';
    let width = 0;

    function generate(seed) {
      const bit = O.bitSource(O.mulberry32(seed));
      let s = '';
      for (let i = 0; i < N; i++) s += bit() ? 'H' : 'T';
      flips = s;
    }

    function stats() {
      for (const p of ['HH', 'HT']) {
        const ends = O.occurrences(p, flips).map((i) => i + 2);
        const gaps = ends.slice(1).map((e, i) => e - ends[i]);
        const k = p.toLowerCase();
        root.querySelector('[data-s="' + k + '-n"]').textContent = ends.length;
        root.querySelector('[data-s="' + k + '-1"]').textContent = gaps.length ? gaps.filter((g) => g === 1).length + ' of ' + gaps.length : '–';
        root.querySelector('[data-s="' + k + '-avg"]').textContent = gaps.length ? fmt(gaps.reduce((a, b) => a + b, 0) / gaps.length, 2) : '–';
        root.querySelector('[data-s="' + k + '-max"]').textContent = gaps.length ? Math.max.apply(null, gaps) : '–';
      }
    }

    function render() {
      if (!width) return;
      const band = width < 480 ? 9 : 11;
      const L = gridLayout(N, width, width < 480 ? 22 : 24, { band: band, gap: 6 });
      const svg = newSvg(box, width, L.height);
      const r = L.cell * 0.37;
      for (let i = 0; i < N; i++) coin(svg, L.pos[i].x, L.pos[i].y, r, flips[i]);
      const arc = (i, above, cls) => {
        const a = L.pos[i];
        const b = L.pos[i + 1];
        const dir = above ? -1 : 1;
        const y0 = a.y + dir * (r + 1.5);
        const lift = dir * (band - 1);
        if (a.row === b.row) {
          const xm = (a.x + b.x) / 2;
          svgEl('path', { d: 'M' + a.x + ' ' + y0 + ' Q' + xm + ' ' + (y0 + lift * 1.5) + ' ' + b.x + ' ' + y0, class: cls }, svg);
        } else {
          const ya = a.y + dir * (r + 1.5);
          const yb = b.y + dir * (r + 1.5);
          svgEl('path', { d: 'M' + a.x + ' ' + ya + ' Q' + (a.x + L.cell * 0.3) + ' ' + (ya + lift * 1.1) + ' ' + (a.x + L.cell * 0.55) + ' ' + (ya + lift * 0.9), class: cls }, svg);
          svgEl('path', { d: 'M' + (b.x - L.cell * 0.55) + ' ' + (yb + lift * 0.9) + ' Q' + (b.x - L.cell * 0.3) + ' ' + (yb + lift * 1.1) + ' ' + b.x + ' ' + yb, class: cls }, svg);
        }
      };
      for (const i of O.occurrences('HH', flips)) arc(i, true, 'mark-a');
      for (const i of O.occurrences('HT', flips)) arc(i, false, 'mark-b');
    }

    generate(113);
    stats();
    on(root, 'new', () => {
      generate(newSeed());
      stats();
      render();
    });
    watchWidth(box, (w) => {
      width = w;
      render();
    });
  })();

  /* ---------------- 3. slide the pattern ---------------- */
  (function slide() {
    const root = document.getElementById('w-slide');
    if (!root) return;
    const coinsBox = root.querySelector('[data-role="coins"]');
    const lenEl = root.querySelector('[data-role="len"]');
    const presetsBox = root.querySelector('[data-role="presets"]');
    const svgBox = root.querySelector('.slide-svg');
    const readout = root.querySelector('.slide-readout');
    const tbody = root.querySelector('.ledger tbody');
    const totalEl = root.querySelector('[data-role="total"]');
    const simOut = root.querySelector('.sim-out');
    const shorter = root.querySelector('[data-act="shorter"]');
    const longer = root.querySelector('[data-act="longer"]');
    const MAXN = 8;
    const PRESETS = ['HH', 'HT', 'HHT', 'HTH', 'HHHH', 'HTHT', 'HHTT'];

    let pat = 'HTH';
    let shift = 1;
    let drag = null; // { startX, startShift, cur }
    let width = 0;
    let geo = null;
    let svg = null;

    function setPattern(p, keepShift) {
      pat = p;
      if (!keepShift) shift = p.length > 1 ? 1 : 0;
      shift = clamp(shift, 0, pat.length - 1);
      simOut.textContent = '';
      renderEditor();
      renderLedger();
      renderSvg();
    }

    function renderEditor() {
      coinButtons(coinsBox, pat, 'Pattern', (i) => {
        const arr = pat.split('');
        arr[i] = flipLetter(arr[i]);
        setPattern(arr.join(''), true);
        const btn = coinsBox.children[i];
        if (btn) btn.focus();
      });
      lenEl.textContent = pat.length + (pat.length === 1 ? ' flip' : ' flips');
      shorter.disabled = pat.length <= 1;
      longer.disabled = pat.length >= MAXN;
      chips(presetsBox, PRESETS.map((p) => ({ label: p, value: p })), pat, (p) => setPattern(p), 'Try');
    }

    function renderLedger() {
      const rows = O.selfOverlaps(pat);
      tbody.textContent = '';
      rows.forEach((o) => {
        const tr = document.createElement('tr');
        if (o.shift === shift) tr.className = 'current';
        tr.innerHTML =
          '<td>' + o.shift + '</td>' +
          '<td class="cmp">' + o.top + ' <span aria-hidden="true">/</span><span class="sr"> versus </span> ' + o.copy + ' ' +
          (o.match ? '<span class="yes" aria-label="match">✓</span>' : '<span class="no" aria-label="no match">✗</span>') +
          '</td>' +
          '<td class="adds">' + (o.match ? '+' + o.value : '<span class="no" aria-label="nothing">–</span>') + '</td>';
        tr.addEventListener('click', () => {
          shift = o.shift;
          renderLedger();
          renderSvg();
        });
        tbody.appendChild(tr);
      });
      const parts = rows.filter((o) => o.match).map((o) => o.value);
      totalEl.innerHTML = (parts.length > 1 ? '<span class="sum">' + parts.join(' + ') + ' =</span>' : '') + O.expectedWait(pat) + ' flips';
    }

    function describe(s) {
      const o = O.selfOverlaps(pat)[s];
      if (s === 0) {
        return '<b>Shift 0.</b> The copy covers the whole pattern, which always matches: adds ' + pow2(o.k) + ' = ' + o.value + '.';
      }
      const coinsWord = o.k === 1 ? '1 coin overlaps' : o.k + ' coins overlap';
      return (
        '<b>Shift ' + s + '.</b> ' + coinsWord + ': the pattern’s last ' + o.k + ' (' + o.top + ') against the copy’s first ' + o.k + ' (' + o.copy + '). ' +
        (o.match ? 'They match, so this overlap adds ' + pow2(o.k) + ' = ' + o.value + '.' : 'They differ, so this shift adds nothing.')
      );
    }

    function renderSvg() {
      if (!width) return;
      const n = pat.length;
      const cols = Math.max(2 * n - 1, 3);
      const cell = Math.min(54, Math.floor(width / cols));
      const x0 = Math.max(0, (width - cols * cell) / 2);
      const r = cell * 0.4;
      const pad = 8;
      const gap = Math.max(26, cell * 0.62);
      const yTop = pad + cell / 2;
      const yCopy = pad + cell + gap + cell / 2;
      const H = pad + cell + gap + cell + 26;
      geo = { cell: cell };
      svg = newSvg(svgBox, width, H);
      svg.setAttribute('tabindex', '0');
      svg.setAttribute('role', 'slider');
      svg.setAttribute('aria-label', 'Shift of the lower copy');
      svg.setAttribute('aria-valuemin', '0');
      svg.setAttribute('aria-valuemax', String(n - 1));
      if (drag) svg.classList.add('dragging');
      const sCur = drag ? drag.cur : shift;
      const sInt = Math.round(sCur);
      const o = O.selfOverlaps(pat)[sInt];
      svg.setAttribute('aria-valuenow', String(sInt));
      svg.setAttribute('aria-valuetext', 'shift ' + sInt + (o.match ? ', match, adds ' + o.value : ', no match'));

      // overlap band
      const bx = x0 + sInt * cell + 2;
      const bw = (n - sInt) * cell - 4;
      svgEl('rect', { x: bx, y: pad - 5, width: bw, height: cell + gap + cell + 10, rx: 10, class: o.match ? 'band-ok' : 'band-bad' }, svg);

      for (let i = 0; i < n; i++) coin(svg, x0 + i * cell + cell / 2, yTop, r, pat[i]);
      // comparison marks between the rows
      for (let c = sInt; c < n; c++) {
        const same = pat[c] === pat[c - sInt];
        const cx = x0 + c * cell + cell / 2;
        const cy = pad + cell + gap / 2;
        const m = Math.min(6, gap * 0.22);
        if (same) svgEl('path', { d: 'M' + (cx - m) + ' ' + cy + ' l' + m * 0.7 + ' ' + m * 0.7 + ' l' + m * 1.3 + ' ' + -m * 1.4, class: 'tick-ok' }, svg);
        else svgEl('path', { d: 'M' + (cx - m) + ' ' + (cy - m) + ' l' + 2 * m + ' ' + 2 * m + ' M' + (cx + m) + ' ' + (cy - m) + ' l' + -2 * m + ' ' + 2 * m, class: 'tick-bad' }, svg);
      }
      // the copy
      const g = svgEl('g', {}, svg);
      for (let j = 0; j < n; j++) {
        const col = sCur + j;
        let cls = 'ghost';
        if (Math.round(col) >= n) cls += ' dim';
        coin(g, x0 + col * cell + cell / 2, yCopy, r, pat[j], cls);
      }
      // grip and hint
      const gx = x0 + (sCur + n) * cell + 4;
      if (gx + 10 < width) {
        for (let k = 0; k < 3; k++) svgEl('rect', { x: gx + k * 4, y: yCopy - 7, width: 2, height: 14, rx: 1, class: 'grip' }, svg);
      }
      svgText(svg, width / 2, H - 6, drag ? '' : '‹ drag the lower row ›', { class: 'drag-hint', 'text-anchor': 'middle' });

      readout.innerHTML = describe(sInt);
      Array.prototype.forEach.call(tbody.children, (tr, i) => tr.classList.toggle('current', i === sInt));
    }

    function setShift(s) {
      s = clamp(s, 0, pat.length - 1);
      if (s !== shift) {
        shift = s;
        renderSvg();
      }
    }

    svgBox.addEventListener('pointerdown', (e) => {
      if (!geo || e.button > 0) return;
      drag = { id: e.pointerId, startX: e.clientX, startShift: shift, cur: shift, moved: false };
      try {
        svgBox.setPointerCapture(e.pointerId);
      } catch (err) {
        /* capture is optional */
      }
    });
    svgBox.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.startX;
      if (Math.abs(dx) > 2) drag.moved = true;
      drag.cur = clamp(drag.startShift + dx / geo.cell, 0, pat.length - 1);
      renderSvg();
    });
    const endDrag = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const s = Math.round(drag.cur);
      drag = null;
      shift = s;
      renderSvg();
    };
    svgBox.addEventListener('pointerup', endDrag);
    svgBox.addEventListener('pointercancel', endDrag);
    svgBox.addEventListener('keydown', (e) => {
      const n = pat.length;
      let s = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') s = shift + 1;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') s = shift - 1;
      else if (e.key === 'Home') s = 0;
      else if (e.key === 'End') s = n - 1;
      if (s === null) return;
      e.preventDefault();
      setShift(s);
      if (svg) svg.focus();
    });

    on(root, 'shorter', () => {
      if (pat.length > 1) setPattern(pat.slice(0, -1), true);
    });
    on(root, 'longer', () => {
      if (pat.length < MAXN) setPattern(pat + 'H', true);
    });
    on(root, 'sim', () => {
      const ew = O.expectedWait(pat);
      const games = clamp(Math.round(3e6 / ew), 2000, 20000);
      const bit = O.bitSource(O.mulberry32(newSeed()));
      let sum = 0;
      let sumSq = 0;
      for (let i = 0; i < games; i++) {
        const t = O.simulateWait(pat, bit);
        sum += t;
        sumSq += t * t;
      }
      const mean = sum / games;
      const se = Math.sqrt(Math.max(0, sumSq / games - mean * mean) / games);
      simOut.innerHTML = fmtInt(games) + ' simulated games: average <b>' + fmt(mean, 2) + '</b> flips (standard error ' + fmt(se, 2) + '). Predicted: ' + ew + '.';
    });

    renderEditor();
    renderLedger();
    watchWidth(svgBox, (w) => {
      width = w;
      renderSvg();
    });
  })();

  /* ---------------- 4. the casino ---------------- */
  (function casino() {
    const root = document.getElementById('w-casino');
    if (!root) return;
    const presetsBox = root.querySelector('[data-role="presets"]');
    const box = root.querySelector('.casino-svg');
    const range = root.querySelector('[data-role="range"]');
    const ledger = root.querySelector('.casino-ledger');
    const manyOut = root.querySelector('.casino-many');
    const playBtn = root.querySelector('[data-act="play"]');
    const PRESETS = ['HH', 'HT', 'HTH', 'HHT', 'HTHT'];

    let pat = 'HTH';
    let flips = O.playUntil(pat, O.bitSource(O.mulberry32(45)));
    let t = flips.length;
    let width = 0;
    let timer = null;

    function stopPlay() {
      if (timer) clearInterval(timer);
      timer = null;
      playBtn.textContent = 'Play';
    }

    function newGame(p) {
      stopPlay();
      if (p) pat = p;
      flips = O.playUntil(pat, O.bitSource(O.mulberry32(newSeed())));
      t = flips.length;
      manyOut.textContent = '';
      chips(presetsBox, PRESETS.map((x) => ({ label: x, value: x })), pat, (x) => newGame(x), 'Pattern');
      render();
    }

    function setT(x) {
      t = clamp(x, 0, flips.length);
      render();
    }

    function render() {
      const T = flips.length;
      const n = pat.length;
      range.max = String(T);
      range.value = String(t);
      range.setAttribute('aria-valuetext', 'after flip ' + t + ' of ' + T);
      const states = O.gamblers(pat, flips, t);
      const alive = states.filter((g) => g.alive);
      const holding = alive.reduce((a, g) => a + g.stake, 0);
      if (t === 0) ledger.innerHTML = 'No flips yet. Press <b>›</b> or drag the slider to start flipping.';
      else if (t < T)
        ledger.innerHTML =
          'After flip <b>' + t + '</b>: the gamblers have paid in <b>$' + t + '</b>. ' +
          (alive.length
            ? alive.length + (alive.length === 1 ? ' gambler is' : ' gamblers are') + ' still betting, holding <b>$' + holding + '</b> between them.'
            : 'Nobody is still betting.');
      else {
        const parts = alive.map((g) => '$' + g.stake).join(' + ');
        ledger.innerHTML =
          '<b>' + pat + '</b> appeared at flip <b>' + T + '</b>. Paid in: <b>$' + T + '</b>. Paid out: ' + (alive.length > 1 ? parts + ' = ' : '') +
          '<b>$' + holding + '</b>. Every game of ' + pat + ' ends with exactly this payout.';
      }
      if (!width) return;

      const cell = width < 480 ? 24 : 30;
      const right = 42; // room for stake labels
      // Window of W columns. It always reaches t + n - 1 (so live gamblers' pending bets
      // show) and, with W >= 2n - 1, every gambler left of it has already gone broke.
      // The window's size never depends on T, so scrubbing doesn't reveal when the game ends.
      const W = Math.max(2 * n - 1, Math.min(16, Math.floor((width - right) / cell)));
      const R = Math.max(W, t + n - 1);
      const Lc = R - W + 1; // leftmost column shown (1-based flip index)
      const used = W * cell + right;
      const x0 = Math.max(0, Math.floor((width - used) / 2));
      const head = 40;
      const rowH = Math.round(cell * 0.82);
      const firstG = Math.max(Lc, 1);
      const rows = Math.max(0, t - firstG + 1);
      const H = head + Math.max(rows, 1) * rowH + (Lc > 1 ? 26 : 10);
      const svg = newSvg(box, width, H);
      const cx = (col) => x0 + (col - Lc) * cell + cell / 2;
      const r = cell * 0.4;
      const sq = cell * 0.74;

      if (t >= 1 && t <= R) svgEl('rect', { x: cx(t) - cell / 2, y: 0, width: cell, height: H, class: 'cursor-band' }, svg);
      for (let c = Lc; c <= R; c++) {
        if (t === T && c > T) break; // game over: no more flips
        svgText(svg, cx(c), 9, String(c), { class: 'colnum', 'text-anchor': 'middle' });
        if (c <= t) coin(svg, cx(c), 12 + r + 2, r, flips[c - 1]);
        else coin(svg, cx(c), 12 + r + 2, r * 0.75, '', 'coin-unknown');
      }
      if (t === T && T >= n) {
        svgEl('rect', { x: cx(T - n + 1) - cell / 2 + 1, y: 12, width: n * cell - 2, height: 2 * r + 4, rx: r + 2, class: 'pattern-box' }, svg);
      }
      if (Lc > 1 && t >= Lc) {
        // gamblers who arrived before the window have all gone broke
        svgText(svg, x0, head + rows * rowH + 16, '+ ' + (Lc - 1) + ' earlier gambler' + (Lc - 1 === 1 ? '' : 's') + ', all broke', { class: 'earlier' });
      }
      for (let g = firstG; g <= t; g++) {
        const s = states[g - 1];
        const y = head + (g - firstG) * rowH + rowH / 2;
        let lastCol = g;
        for (let j = 0; j < n; j++) {
          const col = g + j;
          if (col > R) break;
          const x = cx(col);
          const resolved = col <= t;
          if (resolved && j < s.matched) {
            svgEl('rect', { x: x - sq / 2, y: y - sq / 2, width: sq, height: sq, rx: 4, class: 'cell-win' }, svg);
            svgText(svg, x, y, pat[j], { class: 'cell-win-t', 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': (sq * 0.55).toFixed(1) });
          } else if (resolved && !s.alive && col === s.bustAt) {
            svgEl('rect', { x: x - sq / 2, y: y - sq / 2, width: sq, height: sq, rx: 4, class: 'cell-bust' }, svg);
            svgText(svg, x, y, '✕', { class: 'cell-bust-t', 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': (sq * 0.5).toFixed(1) });
            lastCol = col;
            break;
          } else if (!resolved && s.alive) {
            svgEl('rect', { x: x - sq / 2, y: y - sq / 2, width: sq, height: sq, rx: 4, class: 'cell-pend' }, svg);
            svgText(svg, x, y, pat[j], { class: 'cell-pend-t', 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': (sq * 0.5).toFixed(1) });
          } else break;
          lastCol = col;
        }
        if (s.alive) {
          svgText(svg, cx(lastCol) + cell / 2 + 4, y, '$' + s.stake, {
            class: 'stake' + (t === T ? ' stake-win' : ''),
            'dominant-baseline': 'central',
          });
        }
      }
    }

    range.addEventListener('input', () => {
      stopPlay();
      setT(Number(range.value));
    });
    on(root, 'back', () => {
      stopPlay();
      setT(t - 1);
    });
    on(root, 'fwd', () => {
      stopPlay();
      setT(t + 1);
    });
    on(root, 'play', () => {
      if (timer) {
        stopPlay();
        return;
      }
      if (t >= flips.length) setT(0);
      playBtn.textContent = 'Pause';
      timer = setInterval(() => {
        if (t >= flips.length) stopPlay();
        else setT(t + 1);
      }, reducedMotion() ? 900 : 550);
    });
    on(root, 'new', () => newGame());
    on(root, 'many', () => {
      const bit = O.bitSource(O.mulberry32(newSeed()));
      const N = 10000;
      let sum = 0;
      for (let i = 0; i < N; i++) sum += O.simulateWait(pat, bit);
      const ew = O.expectedWait(pat);
      manyOut.innerHTML =
        'Across ' + fmtInt(N) + ' games of ' + pat + ', the gamblers paid in <b>$' + fmt(sum / N, 2) + '</b> on average, and were paid out exactly <b>$' + ew + '</b> every time.';
    });

    chips(presetsBox, PRESETS.map((x) => ({ label: x, value: x })), pat, (x) => newGame(x), 'Pattern');
    watchWidth(box, (w) => {
      width = w;
      render();
    });
  })();

  /* ---------------- 5. Penney's game ---------------- */
  const penney = (function () {
    const root = document.getElementById('w-penney');
    if (!root) return null;
    const lensBox = root.querySelector('[data-role="lens"]');
    const aBox = root.querySelector('[data-role="a"]');
    const bBox = root.querySelector('[data-role="b"]');
    const wa = root.querySelector('[data-role="wa"]');
    const wb = root.querySelector('[data-role="wb"]');
    const barA = root.querySelector('.pbar-a');
    const barB = root.querySelector('.pbar-b');
    const pText = root.querySelector('.pbar-text');
    const mathEl = root.querySelector('.penney-math');
    const tally = root.querySelector('.penney-tally');

    let A = 'HHT';
    let B = O.bestReply(A).pattern;
    let notice = '';

    function render() {
      chips(lensBox, [2, 3, 4, 5].map((n) => ({ label: String(n), value: n })), A.length, setLength, 'Flips');
      coinButtons(aBox, A, 'Your pattern,', (i) => {
        const arr = A.split('');
        arr[i] = flipLetter(arr[i]);
        A = arr.join('');
        B = O.bestReply(A).pattern;
        notice = '';
        tally.textContent = '';
        render();
        if (aBox.children[i]) aBox.children[i].focus();
      });
      coinButtons(bBox, B, 'My pattern,', (i) => {
        const arr = B.split('');
        arr[i] = flipLetter(arr[i]);
        const nb = arr.join('');
        if (nb === A) notice = 'That would be your pattern; I have to pick a different one.';
        else {
          B = nb;
          notice = '';
        }
        tally.textContent = '';
        render();
        if (bBox.children[i]) bBox.children[i].focus();
      });
      wa.textContent = 'Average wait: ' + O.expectedWait(A) + ' flips';
      wb.textContent = 'Average wait: ' + O.expectedWait(B) + ' flips';
      const r = O.race(A, B);
      barA.style.width = (100 * r.pA.value).toFixed(2) + '%';
      barB.style.width = (100 * r.pB.value).toFixed(2) + '%';
      pText.innerHTML =
        '<span class="c-a">You: ' + r.pA.num + '/' + r.pA.den + ' (' + fmt(100 * r.pA.value, 1) + '%)</span>' +
        '<span class="c-b">Me: ' + r.pB.num + '/' + r.pB.den + ' (' + fmt(100 * r.pB.value, 1) + '%)</span>';
      const best = O.bestReply(A);
      let extra = '';
      if (best.prob.value === 0.5) extra = ' No pattern of this length beats yours; the best I can do is tie.';
      else if (B !== best.pattern) extra = ' (My best reply would be ' + best.pattern + ', winning ' + best.prob.num + '/' + best.prob.den + '.)';
      const eq = (k, v) => '<span class="nw">' + k + ' = ' + v + '</span>';
      mathEl.innerHTML =
        (notice ? '<b>' + notice + '</b> ' : '') +
        eq('A', A) + ' (you), ' + eq('B', B) + ' (me). ' +
        eq('A·A', r.aa) + ', ' + eq('A·B', r.ab) + ', ' + eq('B·B', r.bb) + ', ' + eq('B·A', r.ba) + '. ' +
        'My odds: <span class="nw">(' + r.aa + ' − ' + r.ab + ')</span> to <span class="nw">(' + r.bb + ' − ' + r.ba + ')</span> = ' +
        '<span class="nw">' + r.forB + ' to ' + r.forA + '</span>' +
        (r.odds.b !== r.forB ? ' = <span class="nw">' + r.odds.b + ' to ' + r.odds.a + '</span>' : '') + '.' + extra;
    }

    function setLength(n) {
      if (n === A.length) return;
      A = n < A.length ? A.slice(0, n) : A + 'HTHTH'.slice(0, n - A.length);
      B = O.bestReply(A).pattern;
      notice = '';
      tally.textContent = '';
      render();
    }

    on(root, 'race', () => {
      const bit = O.bitSource(O.mulberry32(newSeed()));
      let mine = 0;
      const N = 1000;
      for (let i = 0; i < N; i++) if (O.simulateRace(A, B, bit) === 'b') mine++;
      tally.innerHTML = 'Last 1,000 races: you won <b class="c-a">' + fmtInt(N - mine) + '</b>, I won <b class="c-b">' + fmtInt(mine) + '</b>.';
    });
    on(root, 'best', () => {
      B = O.bestReply(A).pattern;
      notice = '';
      tally.textContent = '';
      render();
    });

    render();
    return {
      load(p) {
        A = p;
        B = O.bestReply(A).pattern;
        notice = '';
        tally.textContent = '';
        render();
      },
    };
  })();

  /* ---------------- 5b. the loop ---------------- */
  (function cycle() {
    const box = document.querySelector('#w-cycle .cycle-svg');
    if (!box) return;
    const loop = ['HTT', 'HHT', 'THH', 'TTH'];
    function render(width) {
      const nodeW = 76;
      const S = Math.max(160, Math.min(300, width - nodeW - 8));
      const nodeH = 34;
      const W = S + nodeW;
      const H = S * 0.62 + nodeH;
      const svg = newSvg(box, W, H + 4);
      const defs = svgEl('defs', {}, svg);
      const marker = svgEl('marker', { id: 'cyc-head', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, defs);
      svgEl('path', { d: 'M0 0 L10 5 L0 10 z', class: 'cycle-head' }, marker);
      const pts = [
        { x: nodeW / 2, y: nodeH / 2 + 2 },
        { x: W - nodeW / 2, y: nodeH / 2 + 2 },
        { x: W - nodeW / 2, y: H - nodeH / 2 },
        { x: nodeW / 2, y: H - nodeH / 2 },
      ];
      loop.forEach((a, i) => {
        const b = loop[(i + 1) % 4];
        const p = pts[i];
        const q = pts[(i + 1) % 4];
        const horiz = Math.abs(p.y - q.y) < 1;
        const dx = horiz ? Math.sign(q.x - p.x) * (nodeW / 2 + 4) : 0;
        const dy = horiz ? 0 : Math.sign(q.y - p.y) * (nodeH / 2 + 4);
        svgEl('line', { x1: p.x + dx, y1: p.y + dy, x2: q.x - dx, y2: q.y - dy, class: 'cycle-edge', 'marker-end': 'url(#cyc-head)' }, svg);
        const pr = O.race(a, b).pB;
        const label = pr.num + '/' + pr.den;
        const mx = (p.x + q.x) / 2;
        const my = (p.y + q.y) / 2;
        svgEl('rect', { x: mx - 17, y: my - 10, width: 34, height: 20, rx: 10, class: 'cycle-label-bg' }, svg);
        svgText(svg, mx, my, label, { class: 'cycle-label', 'text-anchor': 'middle', 'dominant-baseline': 'central' });
      });
      loop.forEach((p, i) => {
        const c = pts[i];
        const g = svgEl('g', { class: 'cycle-node', tabindex: '0', role: 'button', 'aria-label': 'Load ' + p + ' into the game above' }, svg);
        svgEl('rect', { x: c.x - nodeW / 2, y: c.y - nodeH / 2, width: nodeW, height: nodeH, rx: 9 }, g);
        for (let j = 0; j < 3; j++) coin(g, c.x - 22 + j * 22, c.y, 9.5, p[j]);
        const go = () => {
          if (penney) penney.load(p);
          const w = document.getElementById('w-penney');
          if (w && w.scrollIntoView) w.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' });
        };
        g.addEventListener('click', go);
        g.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            go();
          }
        });
      });
    }
    watchWidth(box, render);
  })();
})();
