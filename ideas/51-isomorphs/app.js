/* Isomorphs: the page. All puzzle logic is in isomorphs.js; this file draws it and handles input. */
(function () {
  'use strict';
  const { Fifteen: F15, Knights: KN, Pocket: PK } = window.Isomorphs;
  const SVGNS = 'http://www.w3.org/2000/svg';
  const $ = (id) => document.getElementById(id);

  /* ---------------- small helpers ---------------- */
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'on') for (const ev in v) e.addEventListener(ev, v[ev]);
      else if (k === 'html') e.innerHTML = v;
      else if (k === 'text') e.textContent = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return e;
  }
  function s(tag, attrs, parent) {
    const e = document.createElementNS(SVGNS, tag);
    if (attrs) for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const reduced = () => mq.matches;
  // Runs step(p) for p from 0 to 1, then done(). Always finishes asynchronously, so the usual
  // pattern  x.anim = tween(..., () => { x.anim = null; })  works even with reduced motion.
  function tween(ms, step, done) {
    if (reduced() || ms <= 0) {
      let over = false;
      const fin = () => { if (over) return; over = true; step(1); if (done) done(); };
      const id = setTimeout(fin, 0);
      return { cancel() { over = true; clearTimeout(id); }, finish() { clearTimeout(id); fin(); } };
    }
    let start = null;
    let raf = 0;
    let over = false;
    const f = (t) => {
      if (over) return;
      if (start === null) start = t;
      const p = Math.min(1, (t - start) / ms);
      step(p);
      if (p < 1) raf = requestAnimationFrame(f);
      else { over = true; if (done) done(); }
    };
    raf = requestAnimationFrame(f);
    return {
      cancel() { over = true; cancelAnimationFrame(raf); },
      finish() { if (over) return; over = true; cancelAnimationFrame(raf); step(1); if (done) done(); },
    };
  }
  const ease = (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
  const lerp = (a, b, t) => a + (b - a) * t;
  const listAnd = (xs) => (xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);
  function svgPoint(svg, e) {
    const m = svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  }
  function setStatus(id, html) { $(id).innerHTML = html; }
  // A tap that doesn't depend on the browser's click: pointer taps are handled on pointerup (a browser
  // may swallow the click that follows a drag), and keyboard activation still arrives as a click.
  function onTap(el, fn) {
    let down = null;
    el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, id: e.pointerId }; });
    el.addEventListener('pointerup', (e) => {
      const d = down;
      down = null;
      if (d && e.pointerId === d.id && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 10) fn(e);
    });
    el.addEventListener('pointercancel', () => { down = null; });
    el.addEventListener('click', (e) => { if (e.detail === 0) fn(e); });
  }

  /* ---------------- steps (Play / Redraw / Again) ---------------- */
  const rooms = {};
  function renderSteps(key) {
    const R = rooms[key];
    document.querySelectorAll(`.step[data-room="${key}"]`).forEach((b) => {
      const ph = b.dataset.phase;
      b.disabled = !R.unlocked.has(ph);
      if (R.phase === ph) b.setAttribute('aria-current', 'step');
      else b.removeAttribute('aria-current');
      b.classList.toggle('done', R.done.has(ph));
    });
  }
  document.querySelectorAll('.step').forEach((b) => {
    b.addEventListener('click', () => {
      const R = rooms[b.dataset.room];
      if (R && R.unlocked.has(b.dataset.phase) && R.phase !== b.dataset.phase) R.go(b.dataset.phase);
    });
  });
  function reveal(id) {
    const el = $(id);
    if (!el.hidden) return;
    el.hidden = false;
    el.classList.add('reveal');
  }

  /* ---------------- the ledger (before / after) ---------------- */
  const record = {
    f: { before: { w: 0, d: 0, l: 0 }, after: { w: 0, d: 0, l: 0 } },
    k: { before: null, beforeTries: 0, after: null, afterTries: 0 },
    p: { before: { right: 0, total: 0 }, after: { right: 0, total: 0 } },
  };
  function wdl(t) {
    const n = t.w + t.d + t.l;
    if (!n) return null;
    return `${n} game${n > 1 ? 's' : ''}: won ${t.w}, drew ${t.d}, lost ${t.l}`;
  }
  function knightCell(solved, tries) {
    if (solved != null) return `swapped in ${solved} moves`;
    if (tries) return `not swapped yet (${tries} moves tried)`;
    return null;
  }
  function pocketCell(t) {
    if (!t.total) return null;
    return `called ${t.right} of ${t.total} pockets`;
  }
  function renderLedger() {
    const rows = [
      ['Fifteen', wdl(record.f.before), wdl(record.f.after)],
      ['Four knights', knightCell(record.k.before, record.k.beforeTries), knightCell(record.k.after, record.k.afterTries)],
      ['The pocket', pocketCell(record.p.before), pocketCell(record.p.after)],
    ];
    const tb = $('ledger').tBodies[0];
    tb.textContent = '';
    for (const [name, a, b] of rows) {
      tb.append(h('tr', null,
        h('th', { scope: 'row' }, name),
        h('td', { class: a ? null : 'none' }, a || 'not played yet'),
        h('td', { class: b ? null : 'none' }, b || 'not played yet')));
    }
  }

  /* ================================================================== */
  /* I. Fifteen                                                          */
  /* ================================================================== */
  const bit = F15.bit;
  const F = {
    phase: 'play',
    unlocked: new Set(['play']),
    done: new Set(),
    games: { play: null, again: null },
    played: { play: 0, again: 0 },
    cells: Array(9).fill(null),
    board: null, // the last finished square: Play again is played on this, even if the grid is cleared later
    selected: null,
    hint: 0,
    magic: false,
    timer: 0,
  };
  rooms.f = F;

  F.go = function (phase) {
    clearTimeout(F.timer);
    F.phase = phase;
    if ((phase === 'play' || phase === 'again') && !F.games[phase]) newFifteen();
    else {
      renderFifteen();
      const g = F.games[phase];
      if (g && !g.result && g.turn === 'machine') scheduleMachine();
    }
  };

  function newFifteen() {
    clearTimeout(F.timer);
    const ph = F.phase;
    const n = F.played[ph];
    // First game of "play": you start. First game of "again": the machine starts, with its best trap.
    const starter = ph === 'play' ? (n % 2 === 0 ? 'you' : 'machine') : (n % 2 === 0 ? 'machine' : 'you');
    F.games[ph] = { you: 0, machine: 0, turn: starter, starter, result: null, last: null };
    renderFifteen();
    if (starter === 'machine') scheduleMachine();
  }
  function scheduleMachine() {
    clearTimeout(F.timer);
    F.timer = setTimeout(machineFifteen, reduced() ? 250 : 700);
  }
  function machineFifteen() {
    const g = F.games[F.phase];
    if (!g || g.result || g.turn !== 'machine') return;
    const k = F15.machineMove(g.machine, g.you);
    if (k == null) return;
    g.machine |= bit(k);
    g.last = { who: 'machine', n: k };
    afterFifteenMove(g);
  }
  function pickFifteen(n) {
    const g = F.games[F.phase];
    if (!g || g.result || g.turn !== 'you') return;
    if ((g.you | g.machine) & bit(n)) return;
    g.you |= bit(n);
    g.last = { who: 'you', n };
    afterFifteenMove(g);
  }
  function afterFifteenMove(g) {
    const st = F15.status(g.you, g.machine);
    if (st.over) {
      g.result = st;
      const ph = F.phase;
      F.played[ph]++;
      const t = ph === 'play' ? record.f.before : record.f.after;
      if (st.winner === 'you') t.w++;
      else if (st.winner === 'machine') t.l++;
      else t.d++;
      if (ph === 'play') F.unlocked.add('redraw');
      if (ph === 'play') F.done.add('play');
      if (ph === 'again') F.done.add('again');
      renderLedger();
      renderFifteen();
      return;
    }
    g.turn = g.turn === 'you' ? 'machine' : 'you';
    renderFifteen();
    if (g.turn === 'machine') scheduleMachine();
  }

  function handView(who, mask, triple) {
    const nums = F15.numbersOf(mask);
    return h('div', { class: `hand ${who}` },
      h('span', { class: 'who' }, who === 'you' ? 'You' : 'Machine'),
      h('span', { class: 'held' }, nums.length
        ? nums.map((k) => h('span', { class: 'chip' + (triple && triple.includes(k) ? ' win' : '') }, k))
        : h('span', { class: 'empty' }, 'nothing yet')));
  }

  function poolView(g, small) {
    const triple = g.result && g.result.triple;
    const pool = h('div', { class: 'pool' + (small ? ' small' : '') + (g.turn !== 'you' && !g.result ? ' waiting' : ''), role: 'group', 'aria-label': 'Numbers 1 to 9' });
    for (let k = 1; k <= 9; k++) {
      const mine = g.you & bit(k);
      const theirs = g.machine & bit(k);
      const cls = ['num', mine ? 'you' : '', theirs ? 'machine' : '', triple && triple.includes(k) && (mine || theirs) ? 'win' : ''].filter(Boolean).join(' ');
      const label = mine ? `${k}, yours` : theirs ? `${k}, the machine's` : `Take ${k}`;
      pool.append(h('button', {
        class: cls, 'data-n': k, 'aria-label': label,
        disabled: mine || theirs || g.result || g.turn !== 'you',
        on: { click: () => pickFifteen(k) },
      }, k));
    }
    return pool;
  }

  function lineCoords(line) {
    // centres of the first and last cells of a line, in a 300 x 300 box
    const c = (i) => ({ x: (i % 3) * 100 + 50, y: Math.floor(i / 3) * 100 + 50 });
    const a = c(line[0]);
    const b = c(line[2]);
    // stretch a little past the cell centres
    const dx = (b.x - a.x) * 0.16;
    const dy = (b.y - a.y) * 0.16;
    return { x1: a.x - dx, y1: a.y - dy, x2: b.x + dx, y2: b.y + dy };
  }

  function boardView(g) {
    // the reader's own magic square, now a noughts-and-crosses board
    const triple = g.result && g.result.triple;
    const wrap = h('div', { class: 'grid3 board3 tictac', role: 'group', 'aria-label': 'Your square as a noughts-and-crosses board' });
    for (let i = 0; i < 9; i++) {
      const k = F.board[i];
      const mine = g.you & bit(k);
      const theirs = g.machine & bit(k);
      const cell = h('button', {
        class: 'cell', 'data-cell': i, 'data-n': k,
        'aria-label': mine ? `${k}: your cross` : theirs ? `${k}: the machine's nought` : `Take ${k}`,
        disabled: mine || theirs || g.result || g.turn !== 'you',
        on: { click: () => pickFifteen(k) },
      }, h('span', { class: 'tag' }, k));
      const fresh = g.last && g.last.n === k;
      if (mine) {
        const m = s('svg', { class: 'mark x' + (fresh ? ' pop' : ''), viewBox: '0 0 100 100', 'aria-hidden': 'true' });
        s('path', { d: 'M22 22 L78 78 M78 22 L22 78' }, m);
        cell.append(m);
      } else if (theirs) {
        const m = s('svg', { class: 'mark o' + (fresh ? ' pop' : ''), viewBox: '0 0 100 100', 'aria-hidden': 'true' });
        s('circle', { cx: 50, cy: 50, r: 30 }, m);
        cell.append(m);
      }
      wrap.append(cell);
    }
    const hash = s('svg', { class: 'hash', viewBox: '0 0 300 300', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    for (const v of [100, 200]) {
      s('line', { x1: v, y1: 8, x2: v, y2: 292 }, hash);
      s('line', { x1: 8, y1: v, x2: 292, y2: v }, hash);
    }
    wrap.append(hash);
    if (triple) {
      const lines = s('svg', { class: 'lines', viewBox: '0 0 300 300', 'aria-hidden': 'true' });
      const cellsOf = triple.map((k) => F.board.indexOf(k)).sort((a, b) => a - b);
      const line = F15.LINES.find((ln) => ln.every((i) => cellsOf.includes(i)));
      if (line) s('line', lineCoords(line), lines);
      wrap.append(lines);
    }
    return wrap;
  }

  // The finished square, redrawn as a noughts-and-crosses board (the numbers move to the corners).
  function emptyBoard(animate) {
    const wrap = h('div', { class: 'grid3 board3 tictac' + (animate ? ' becoming' : ''), role: 'img', 'aria-label': 'Your square, as a noughts-and-crosses board' });
    for (let i = 0; i < 9; i++) wrap.append(h('div', { class: 'cell' }, h('span', { class: 'tag' }, F.cells[i])));
    const hash = s('svg', { class: 'hash', viewBox: '0 0 300 300', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    for (const v of [100, 200]) {
      s('line', { x1: v, y1: 8, x2: v, y2: 292, pathLength: 1 }, hash);
      s('line', { x1: 8, y1: v, x2: 292, y2: v, pathLength: 1 }, hash);
    }
    wrap.append(hash);
    return wrap;
  }

  function fifteenStatus(g) {
    if (g.result) {
      const t = g.result.triple;
      if (g.result.winner === 'you') return `You hold ${listAnd(t)}: ${t.join(' + ')} = 15. <span class="good">You win.</span>`;
      if (g.result.winner === 'machine') return `The machine holds ${listAnd(t)}: ${t.join(' + ')} = 15. <span class="them">The machine wins.</span>`;
      return 'All nine numbers are taken and nobody holds three that make 15. <b>A draw.</b>';
    }
    if (g.turn === 'machine') return g.last ? `You took ${g.last.n}. The machine is choosing&hellip;` : 'The machine goes first. It is choosing&hellip;';
    if (!g.last) return '<span class="you">You go first.</span> Choose a number.';
    return `The machine took <span class="them">${g.last.n}</span>. Your turn.`;
  }

  function renderFifteen() {
    renderSteps('f');
    const stage = $('f-stage');
    const gg = F.games[F.phase];
    Object.assign(stage.dataset, {
      phase: F.phase, magic: F.magic ? '1' : '0',
      you: gg ? String(gg.you) : '0', machine: gg ? String(gg.machine) : '0', turn: gg ? gg.turn : '',
      result: gg && gg.result ? gg.result.winner || 'draw' : '',
    });
    const controls = $('f-controls');
    stage.textContent = '';
    controls.textContent = '';
    if (F.phase === 'redraw') { renderLayout(stage, controls); return; }
    const g = F.games[F.phase];
    const triple = g.result && g.result.triple;
    const hands = h('div', { class: 'hands' },
      handView('machine', g.machine, g.result && g.result.winner === 'machine' ? triple : null),
      handView('you', g.you, g.result && g.result.winner === 'you' ? triple : null));
    if (F.phase === 'play') {
      stage.append(hands, poolView(g, false));
    } else {
      stage.append(h('div', { class: 'f-again' }, hands, boardView(g), poolView(g, true)));
    }
    setStatus('f-status', fifteenStatus(g));
    controls.append(h('button', { class: 'btn', disabled: !g.result, on: { click: newFifteen } }, 'New game'));
    const t = F.phase === 'play' ? record.f.before : record.f.after;
    const tally = wdl(t);
    if (tally) controls.append(h('span', { class: 'note' }, tally.replace(/^\d+ games?: /, 'So far: ')));
    controls.append(h('span', { class: 'spacer' }));
    if (F.phase === 'play') {
      controls.append(h('button', {
        class: 'btn' + (F.unlocked.has('redraw') ? ' primary' : ''), disabled: !F.unlocked.has('redraw'),
        title: F.unlocked.has('redraw') ? null : 'Finish one game first',
        on: { click: () => F.go('redraw') },
      }, F.unlocked.has('redraw') ? 'Redraw it →' : 'Redraw it (finish a game first)'));
    }
  }

  /* --- redraw: lay the numbers out on a grid --- */
  function placeTile(n, i) {
    const from = F.cells.indexOf(n);
    if (from === i) return;
    const occupant = F.cells[i];
    F.cells[i] = n;
    if (from >= 0) F.cells[from] = occupant;
    F.selected = null;
    afterLayoutChange();
  }
  function unplaceTile(n) {
    const from = F.cells.indexOf(n);
    if (from >= 0) F.cells[from] = null;
    F.selected = null;
    afterLayoutChange();
  }
  function afterLayoutChange() {
    const wasMagic = F.magic;
    F.magic = F15.isMagic(F.cells);
    if (F.magic) F.board = F.cells.slice();
    if (F.magic && !wasMagic) {
      F.justMagic = true;
      F.done.add('redraw');
      F.unlocked.add('again');
      reveal('f-after');
    }
    renderFifteen();
  }
  function tapTile(n) {
    if (F.selected === n) { F.selected = null; renderFifteen(); return; }
    const at = F.cells.indexOf(n);
    if (F.selected != null && at >= 0) { placeTile(F.selected, at); return; }
    F.selected = n;
    renderFifteen();
  }
  function tapCell(i) {
    if (F.selected != null) { placeTile(F.selected, i); return; }
  }

  function tileEl(n) {
    const counts = F.hint >= 2 ? F15.tripleCounts() : null;
    const t = h('button', {
      class: 'tile' + (F.selected === n ? ' selected' : ''), 'data-tile': n,
      'aria-label': `Number ${n}` + (F.cells.indexOf(n) >= 0 ? `, in square ${F.cells.indexOf(n) + 1}` : ', not placed') + (F.selected === n ? ', picked up' : ''),
      'aria-pressed': F.selected === n ? 'true' : 'false',
    }, String(n), counts ? h('span', { class: 'count', 'aria-hidden': 'true' }, counts[n]) : null);
    t.addEventListener('click', (e) => e.stopPropagation());
    t.addEventListener('pointerdown', (e) => startTileDrag(e, t, n));
    onTap(t, () => { if (!t.classList.contains('lifted')) tapTile(n); });
    return t;
  }

  function dropTargetAt(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    return el.closest('#f-stage .cell') || el.closest('#f-stage .tray');
  }
  function startTileDrag(e, el, n) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const start = { x: e.clientX, y: e.clientY };
    let ghost = null;
    let over = null;
    try { el.setPointerCapture(e.pointerId); } catch (_) { /* not capturable */ }
    const move = (ev) => {
      if (!ghost && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 7) {
        ghost = h('div', { class: 'ghost', 'aria-hidden': 'true' }, String(n));
        document.body.append(ghost);
        el.classList.add('lifted');
      }
      if (!ghost) return;
      ev.preventDefault();
      ghost.style.left = ev.clientX + 'px';
      ghost.style.top = ev.clientY + 'px';
      const tgt = dropTargetAt(ev.clientX, ev.clientY);
      if (tgt !== over) {
        if (over) over.classList.remove('over');
        over = tgt;
        if (over && over.classList.contains('cell')) over.classList.add('over');
      }
    };
    const finish = (ev, commit) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
      if (!ghost) return;
      ghost.remove();
      el.classList.remove('lifted');
      if (over) over.classList.remove('over');
      if (!commit) { renderFifteen(); return; }
      const tgt = dropTargetAt(ev.clientX, ev.clientY);
      if (tgt && tgt.classList.contains('cell')) placeTile(n, Number(tgt.dataset.cell));
      else if (tgt) unplaceTile(n);
      else renderFifteen();
    };
    const up = (ev) => finish(ev, true);
    const cancel = (ev) => finish(ev, false);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
  }

  const HINTS = [
    null,
    'Some numbers belong to more 15s than others. Which belongs to the most? And where on a 3&times;3 grid do the most lines meet?',
    'The gold badges count the 15s each number belongs to: 5 is in four, the even numbers in three each, the odd ones in two. On a 3&times;3 grid the centre is on four lines, each corner on three, each edge on two.',
    'So: 5 in the centre, the even numbers in the corners, the odd numbers on the edges. Then make each line through the centre add up: 2 opposite 8, 4 opposite 6.',
  ];

  function renderLayout(stage, controls) {
    const sums = F15.lineSums(F.cells);
    const good = sums.filter((x) => x === 15).length;
    const layout = h('div', { class: 'f-layout' });
    const grid = h('div', { class: 'grid3', role: 'group', 'aria-label': 'A 3 by 3 grid to lay the numbers on' });
    for (let i = 0; i < 9; i++) {
      const n = F.cells[i];
      const cell = h('div', {
        class: 'cell' + (F.selected != null && n == null ? ' armed' : ''), 'data-cell': i,
      });
      if (n != null) cell.append(tileEl(n));
      else {
        const b = h('button', {
          class: 'cellbtn', 'aria-label': `Empty square ${i + 1}` + (F.selected != null ? `: put ${F.selected} here` : ''),
        });
        onTap(b, () => tapCell(i));
        cell.append(b);
      }
      grid.append(cell);
    }
    // glowing lines for every full line that makes 15
    const lines = s('svg', { class: 'lines', viewBox: '0 0 300 300', 'aria-hidden': 'true' });
    F15.LINES.forEach((ln, i) => { if (sums[i] === 15) s('line', lineCoords(ln), lines); });
    grid.append(lines);
    // line sums round the edge of the grid
    const pos = [
      ['calc(100% + 18px)', '16.7%'], ['calc(100% + 18px)', '50%'], ['calc(100% + 18px)', '83.3%'],
      ['16.7%', 'calc(100% + 14px)'], ['50%', 'calc(100% + 14px)'], ['83.3%', 'calc(100% + 14px)'],
      ['calc(100% + 18px)', 'calc(100% + 14px)'], ['calc(100% + 18px)', '-12px'],
    ];
    sums.forEach((v, i) => {
      if (v == null) return;
      const lbl = i < 3 ? `row ${i + 1}` : i < 6 ? `column ${i - 2}` : i === 6 ? 'the diagonal from top left' : 'the diagonal from top right';
      grid.append(h('span', {
        class: 'sum' + (v === 15 ? ' fifteen' : ''), style: `left:${pos[i][0]};top:${pos[i][1]}`,
        title: `${lbl} adds to ${v}`,
      }, (i === 6 ? '↘ ' : i === 7 ? '↗ ' : '') + v));
    });
    const tray = h('div', { class: 'tray', role: 'group', 'aria-label': 'Numbers not yet placed' });
    tray.addEventListener('click', () => { if (F.selected != null && F.cells.includes(F.selected)) unplaceTile(F.selected); });
    for (let k = 1; k <= 9; k++) {
      const slot = h('div', { class: 'slot' });
      if (!F.cells.includes(k)) slot.append(tileEl(k));
      tray.append(slot);
    }
    if (F.magic) {
      layout.append(h('div', { class: 'gridwrap' }, emptyBoard(F.justMagic)));
      F.justMagic = false;
    } else layout.append(h('div', { class: 'gridwrap' }, grid), tray);
    stage.append(layout);

    let msg;
    if (F.magic) msg = '<span class="good">Every row, column and diagonal adds up to 15.</span> So take the numbers off the squares, and look at what is left.';
    else if (F.cells.every((x) => x == null)) msg = 'Put the nine numbers on the grid, by dragging or by tapping a number and then a square, so that <b>every row, column and diagonal adds up to 15</b>.';
    else msg = `Lines adding up to 15: <b>${good}</b> of 8.`;
    if (F.hint && !F.magic) msg += `<br><span class="note">${HINTS[F.hint]}</span>`;
    setStatus('f-status', msg);

    if (!F.magic) controls.append(h('button', { class: 'btn', disabled: F.hint >= 3, on: { click: () => { F.hint = Math.min(3, F.hint + 1); renderFifteen(); } } }, F.hint ? 'Another hint' : 'Hint'));
    controls.append(
      h('button', { class: 'btn', disabled: F.cells.every((x) => x == null), on: { click: () => { F.cells = Array(9).fill(null); F.selected = null; afterLayoutChange(); } } }, 'Clear'),
      h('span', { class: 'spacer' }),
      h('button', {
        class: 'btn' + (F.magic ? ' primary' : ''), disabled: !F.magic,
        on: { click: () => F.go('again') },
      }, F.magic ? 'Play the machine again →' : 'Play again (finish the square first)'));
  }

  /* ================================================================== */
  /* II. Four knights                                                    */
  /* ================================================================== */
  const R = 24; // button radius once the squares lift off the board
  const boardCentre = (i) => ({ x: KN.SQUARES[i].c * 100 + 50, y: (2 - KN.SQUARES[i].r) * 100 + 50 });
  const K = {
    phase: 'play',
    unlocked: new Set(['play']),
    done: new Set(),
    pos: KN.START,
    moves: 0,
    tries: { play: 0, again: 0 },
    target: 'swap',
    selected: null,
    pts: KN.SQUARES.map((_, i) => boardCentre(i)),
    morph: 0, // 0 = squares on a board, 1 = round buttons on strings
    anim: null,
    hot: null,
    solvedAt: null,
    focus: null,
  };
  rooms.k = K;
  const KNIGHT_BODY = 'M30 80 C31 72 36 66 42 58 C38 60 33 61 28 60 C23 59 19 56 20 52 C21 47 27 40 33 32 C37 26 42 20 50 17 L54 9 L59 17 C70 22 76 34 75 50 C74 62 72 72 73 80 Z';
  const KNIGHT_BASE = 'M24 80 H78 Q80 80 80 82 V88 Q80 90 78 90 H24 Q22 90 22 88 V82 Q22 80 24 80 Z';

  // On the board the squares sit where the board puts them; once lifted, wherever the reader drags them.
  function nodePositions() {
    return K.phase === 'play' ? KN.SQUARES.map((_, i) => boardCentre(i)) : K.pts;
  }

  K.go = function (phase) {
    if (K.anim) K.anim.finish();
    K.phase = phase;
    K.selected = null;
    K.hot = null;
    if (phase === 'play') K.morph = 0;
    if (phase === 'again') K.morph = 1;
    // the knights stay put while you untangle; a new phase of play starts from the beginning
    if (phase !== 'redraw') { K.moves = 0; K.pos = KN.START; K.solvedAt = null; }
    if (phase === 'redraw' && K.morph < 1) {
      // lift the squares off the board: they become round buttons and the strings appear
      K.anim = tween(800, (p) => { K.morph = ease(p); drawKnights(); setStatus('k-status', knightStatus({ crossing: [], clut: { under: [], overlaps: [] } })); }, () => { K.anim = null; K.morph = 1; renderKnights(); });
    }
    renderKnights();
  };

  function knightStage() {
    let svg = $('k-svg');
    if (!svg) {
      const stage = $('k-stage');
      stage.textContent = '';
      svg = s('svg', { id: 'k-svg', class: 'k-svg', viewBox: '-6 -6 312 324', role: 'img', 'aria-label': 'Four knights on a 3 by 3 board' });
      stage.append(h('div', { class: 'k-wrap' }, svg));
      attachKnightInput(svg);
    }
    return svg;
  }

  function drawKnights(moving) {
    const svg = knightStage();
    const hadFocus = svg.contains(document.activeElement);
    svg.textContent = '';
    const graph = K.morph > 0;
    svg.classList.toggle('graph', K.phase !== 'play');
    const m = K.morph;
    const strings = s('g', { class: 'strings' }, svg);
    const squares = s('g', { class: 'squares' }, svg);
    const marks = s('g', { class: 'marks' }, svg);
    const ghosts = s('g', { class: 'ghosts' }, svg);
    const pieces = s('g', { class: 'pieces' }, svg);
    const pts = nodePositions();
    const crossing = graph ? KN.crossings(pts) : [];
    const clut = graph ? KN.clutter(pts, R) : { under: [], overlaps: [] };
    const untangled = graph && !crossing.length && !clut.under.length && !clut.overlaps.length;
    // strings
    if (graph) {
      KN.EDGES.forEach(([a, b], i) => {
        const hot = K.hot != null && (a === K.hot || b === K.hot);
        s('line', {
          class: 'string' + (hot ? ' hot' : untangled ? ' calm' : ''),
          x1: pts[a].x, y1: pts[a].y, x2: pts[b].x, y2: pts[b].y, opacity: m.toFixed(3),
          'data-edge': i,
        }, strings);
      });
      if (m >= 1) for (const c of crossing) s('circle', { class: 'xmark', cx: c.at.x, cy: c.at.y, r: 7 }, marks);
    }
    // squares (morphing into buttons)
    KN.SQUARES.forEach((sq, i) => {
      const p = pts[i];
      const half = lerp(50, R, m);
      const light = (sq.c + sq.r) % 2 === 1;
      const who = K.pos[i] === 'W' ? 'white knight' : K.pos[i] === 'B' ? 'black knight' : 'empty';
      const g = s('g', {
        class: 'node', 'data-node': i, tabindex: 0, role: 'button',
        'aria-label': `${sq.name}, ${who}` + (K.phase === 'redraw' || K.phase === 'again' ? '. Arrow keys move this square' : ''),
      }, squares);
      s('rect', {
        class: 'sq ' + (light ? 'light' : 'dark') + (i === 4 && m > 0 ? ' dead' : ''),
        x: p.x - half, y: p.y - half, width: 2 * half, height: 2 * half, rx: lerp(0, R, m),
      }, g);
      if (m >= 1 || m === 0) {
        const lx = m ? p.x : sq.c * 100 + 6;
        const ly = m ? p.y + R + 19 : (2 - sq.r) * 100 + 94;
        s('text', { class: 'sqname', x: lx, y: ly, 'text-anchor': m ? 'middle' : 'start' }, g).textContent = sq.name;
      }
    });
    // targets (dashed rings where the knights should end up)
    const tgt = KN.TARGETS[K.target];
    for (let i = 0; i < 9; i++) {
      if (tgt[i] === '.') continue;
      const p = pts[i];
      const rr = lerp(40, R + 6, m);
      const cls = tgt[i] === 'W' ? 'w' : 'b';
      s('circle', { class: 'ghostring ' + cls, cx: p.x, cy: p.y, r: rr }, ghosts);
      // a pip on the ring says which colour belongs here
      s('circle', { class: 'pip ' + cls, cx: p.x + rr * 0.7071, cy: p.y - rr * 0.7071, r: lerp(7, 5.5, m) }, ghosts);
    }
    // destinations of the selected knight
    if (K.selected != null && K.phase !== 'redraw') {
      const p = pts[K.selected];
      s('circle', { class: 'sel', cx: p.x, cy: p.y, r: lerp(44, R + 4, m) }, marks);
      for (const to of KN.movesFrom(K.pos, K.selected)) {
        const q = pts[to];
        s('circle', { class: 'dest', cx: q.x, cy: q.y, r: 9, 'data-dest': to }, marks);
        s('circle', { class: 'dest-hit', cx: q.x, cy: q.y, r: lerp(48, R + 4, m), 'data-dest': to }, marks);
      }
    }
    // knights
    for (let i = 0; i < 9; i++) {
      const c = K.pos[i];
      if (c === '.') continue;
      let p = pts[i];
      if (moving && moving.from === i) p = moving.at;
      const scale = lerp(0.74, 0.44, m);
      const g = s('g', { class: 'knight ' + (c === 'W' ? 'w' : 'b'), 'data-node': i, 'data-knight': i, transform: `translate(${p.x - 50 * scale} ${p.y - 52 * scale}) scale(${scale})` }, pieces);
      s('path', { class: 'body ' + (c === 'W' ? 'w' : 'b'), d: KNIGHT_BODY }, g);
      s('path', { class: 'body ' + (c === 'W' ? 'w' : 'b'), d: KNIGHT_BASE }, g);
      s('circle', { class: 'eye', cx: 46, cy: 30, r: 3 }, g);
    }
    if (hadFocus && K.focus != null) {
      const f = svg.querySelector(`.node[data-node="${K.focus}"]`);
      if (f) f.focus({ preventScroll: true });
    }
    return { crossing, clut, untangled };
  }

  function knightStatus(info) {
    const tgtName = K.target === 'swap' ? 'swap' : 'diagonals';
    const reached = K.pos === KN.TARGETS[K.target];
    if (K.phase === 'redraw') {
      if (K.morph < 1) return 'The squares are lifting off the board&hellip;';
      if (info.untangled) return '<span class="good">No crossings.</span> Look at the shape you made, and where the knights are on it.';
      const n = info.crossing.length;
      if (!n && info.clut.overlaps.length) return 'No crossings, but two squares are on top of each other. Pull them apart.';
      if (!n && info.clut.under.length) return 'No crossings, but a string runs underneath a square it doesn&rsquo;t belong to. Pull the square clear.';
      return `Each string joins two squares a knight can jump between. <b>Drag the squares until no strings cross.</b> Crossings left: <b>${n}</b>.`;
    }
    if (reached) {
      if (K.target === 'swap') return `<span class="good">Swapped in ${K.moves} moves.</span>` + (K.phase === 'again' ? (K.moves === 16 ? ' Sixteen is the fewest possible.' : ' The fewest possible is sixteen.') : '');
      return '<span class="good">Diagonals reached.</span>';
    }
    if (K.selected != null) return 'Now tap where it should jump.';
    if (K.phase === 'again') {
      if (K.target === 'diagonals') return 'Read the colours of the knights round your ring. Now read the colours of the pips round the ring.' + (K.moves ? ` Moves: <b>${K.moves}</b>.` : '');
      return K.moves ? `Moves: <b>${K.moves}</b>.` : 'Same knights, same moves, on your drawing. Tap a knight, then a square along one of its strings. <b>How many moves will the swap take?</b>';
    }
    if (!K.moves) return `Tap a knight, then a square it can jump to. Target: <b>${tgtName}</b> (the dashed rings).`;
    if (K.target === 'diagonals' && K.moves >= 24) return `Moves: <b>${K.moves}</b>. Maybe it can&rsquo;t be done. How would you know?`;
    return `Moves: <b>${K.moves}</b>.`;
  }

  function miniBoard() {
    const svg = s('svg', { class: 'k-mini', viewBox: '0 0 30 30', role: 'img', 'aria-label': 'The same position on the real board' });
    KN.SQUARES.forEach((sq, i) => {
      const light = (sq.c + sq.r) % 2 === 1;
      s('rect', { class: 'sq ' + (light ? 'light' : 'dark'), x: sq.c * 10, y: (2 - sq.r) * 10, width: 10, height: 10 }, svg);
      if (K.pos[i] !== '.') s('circle', { class: 'pc ' + (K.pos[i] === 'W' ? 'w' : 'b'), cx: sq.c * 10 + 5, cy: (2 - sq.r) * 10 + 5, r: 3.4 }, svg);
    });
    return svg;
  }

  function renderKnights() {
    renderSteps('k');
    const info = drawKnights();
    Object.assign($('k-stage').dataset, {
      phase: K.phase, pos: K.pos, moves: String(K.moves), crossings: String(info.crossing.length), untangled: info.untangled ? '1' : '0',
    });
    setStatus('k-status', knightStatus(info));
    if (K.phase === 'redraw' && info.untangled && K.morph >= 1 && !K.done.has('redraw')) {
      K.done.add('redraw');
      K.unlocked.add('again');
      renderSteps('k');
    }
    const controls = $('k-controls');
    controls.textContent = '';
    if (K.phase !== 'redraw') {
      const pick = h('div', { class: 'target-pick', role: 'group', 'aria-label': 'Target' },
        h('button', { 'aria-pressed': K.target === 'swap' ? 'true' : 'false', on: { click: () => { K.target = 'swap'; K.selected = null; renderKnights(); } } }, 'Swap'),
        h('button', { 'aria-pressed': K.target === 'diagonals' ? 'true' : 'false', on: { click: () => { K.target = 'diagonals'; K.selected = null; renderKnights(); } } }, 'Diagonals'));
      controls.append(pick,
        h('button', { class: 'btn', disabled: !K.moves && K.pos === KN.START, on: { click: resetKnights } }, 'Reset'));
      if (K.phase === 'again') controls.append(miniBoard());
      controls.append(h('span', { class: 'spacer' }));
      if (K.phase === 'play') {
        const ok = K.unlocked.has('redraw');
        controls.append(h('button', {
          class: 'btn' + (ok ? ' primary' : ''), disabled: !ok,
          on: { click: () => K.go('redraw') },
        }, ok ? 'Lift the squares off the board →' : 'Redraw it (try a few moves first)'));
      }
    } else {
      controls.append(
        h('span', { class: 'note' }, 'Tap a square to light up its strings.'),
        h('span', { class: 'spacer' }),
        h('button', {
          class: 'btn' + (K.unlocked.has('again') ? ' primary' : ''), disabled: !K.unlocked.has('again'),
          on: { click: () => K.go('again') },
        }, K.unlocked.has('again') ? 'Play on your drawing →' : 'Play again (untangle it first)'));
    }
  }

  function resetKnights() {
    if (K.anim) K.anim.finish();
    K.pos = KN.START;
    K.moves = 0;
    K.selected = null;
    K.solvedAt = null;
    renderKnights();
  }

  function tryKnightMove(from, to) {
    const next = KN.move(K.pos, from, to);
    if (!next) return;
    if (K.anim) K.anim.finish();
    const a = nodePositions()[from];
    const b = nodePositions()[to];
    K.selected = null;
    const board = K.morph === 0;
    K.anim = tween(board ? 320 : 380, (p) => {
      const t = ease(p);
      // on the board, hop in an arc; on the ring, slide along the string
      const lift = board ? Math.sin(Math.PI * t) * 26 : 0;
      drawKnights({ from, at: { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) - lift } });
    }, () => {
      K.anim = null;
      K.pos = next;
      K.moves++;
      K.tries[K.phase === 'again' ? 'again' : 'play']++;
      if (K.phase === 'play') {
        record.k.beforeTries++;
        if (K.moves >= 6) K.unlocked.add('redraw');
      } else {
        record.k.afterTries++;
        if (K.moves >= 10 || (K.target === 'diagonals' && K.moves >= 4)) reveal('k-after');
      }
      if (K.pos === KN.TARGETS.swap && K.solvedAt == null) {
        K.solvedAt = K.moves;
        if (K.phase === 'play') {
          if (record.k.before == null) record.k.before = K.moves;
          K.unlocked.add('redraw');
          K.done.add('play');
        } else {
          if (record.k.after == null || K.moves < record.k.after) record.k.after = K.moves;
          K.done.add('again');
          reveal('k-after');
        }
      }
      renderLedger();
      renderKnights();
    });
  }

  function attachKnightInput(svg) {
    let drag = null;
    svg.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const el = e.target.closest('[data-dest],[data-node]');
      if (!el) { if (K.selected != null) { K.selected = null; renderKnights(); } return; }
      if (el.hasAttribute('data-dest') && K.selected != null) {
        e.preventDefault();
        tryKnightMove(K.selected, Number(el.getAttribute('data-dest')));
        return;
      }
      const i = Number(el.getAttribute('data-node'));
      const p = svgPoint(svg, e);
      const np = nodePositions()[i];
      K.focus = null;
      drag = { i, id: e.pointerId, start: p, off: { x: np.x - p.x, y: np.y - p.y }, moved: false };
      if (K.phase !== 'play') {
        e.preventDefault();
        try { svg.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      }
    });
    svg.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (K.phase === 'play' || K.morph < 1) return;
      const p = svgPoint(svg, e);
      if (!drag.moved && Math.hypot(p.x - drag.start.x, p.y - drag.start.y) < 6) return;
      if (K.anim) K.anim.finish();
      drag.moved = true;
      svg.classList.add('dragging');
      K.selected = null;
      K.hot = drag.i;
      K.pts[drag.i] = {
        x: Math.max(R, Math.min(300 - R, p.x + drag.off.x)),
        y: Math.max(R + 4, Math.min(300 - R, p.y + drag.off.y)),
      };
      const info = drawKnights();
      setStatus('k-status', knightStatus(info));
    });
    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag;
      drag = null;
      svg.classList.remove('dragging');
      if (d.moved) { K.hot = null; renderKnights(); return; }
      tapKnightNode(d.i);
    };
    svg.addEventListener('pointerup', end);
    // keyboard: Tab to a square, Enter or Space to tap it, arrow keys to move it once it has lifted
    svg.addEventListener('focusin', (e) => {
      const el = e.target.closest && e.target.closest('.node');
      if (el) K.focus = Number(el.getAttribute('data-node'));
    });
    svg.addEventListener('keydown', (e) => {
      const el = e.target.closest && e.target.closest('.node');
      if (!el) return;
      const i = Number(el.getAttribute('data-node'));
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        K.focus = i;
        tapKnightNode(i);
        return;
      }
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!d || K.phase === 'play' || K.morph < 1) return;
      e.preventDefault();
      const step = e.shiftKey ? 30 : 10;
      K.focus = i;
      K.pts[i] = {
        x: Math.max(R, Math.min(300 - R, K.pts[i].x + d[0] * step)),
        y: Math.max(R + 4, Math.min(300 - R, K.pts[i].y + d[1] * step)),
      };
      renderKnights();
    });
    svg.addEventListener('pointercancel', (e) => { if (drag && e.pointerId === drag.id) { drag = null; svg.classList.remove('dragging'); renderKnights(); } });
  }

  function tapKnightNode(i) {
    if (K.phase === 'redraw') {
      K.hot = K.hot === i ? null : i;
      renderKnights();
      return;
    }
    if (K.pos === KN.TARGETS[K.target] && K.target === 'swap') {
      // solved: tapping again starts over
    }
    if (K.selected != null && K.selected !== i && KN.movesFrom(K.pos, K.selected).includes(i)) {
      tryKnightMove(K.selected, i);
      return;
    }
    if (K.pos[i] !== '.') {
      K.selected = K.selected === i ? null : i;
      if (K.selected != null && !KN.movesFrom(K.pos, i).length) {
        setStatus('k-status', i === 4 ? 'Nothing can move here.' : 'That knight has nowhere to jump right now.');
        K.selected = null;
        drawKnights();
        return;
      }
      renderKnights();
      return;
    }
    K.selected = null;
    renderKnights();
    if (i === 4 && K.phase === 'play') setStatus('k-status', 'No knight can ever jump to the centre square from this board.');
  }

  /* ================================================================== */
  /* III. The pocket                                                     */
  /* ================================================================== */
  const TABLES = [[4, 3], [5, 4], [7, 5]];
  const P = {
    phase: 'play',
    unlocked: new Set(['play']),
    done: new Set(),
    idx: 0,
    guess: null,
    shot: null, // { m, n, sim, progress }
    results: [], // one per table: { guess, actual, bounces }
    // the unfolding: table t, k cushions unfolded; flip/miss are copies turning over; own/wrong count the reader's picks
    uf: { t: 0, k: 0, anim: null, view: null, viewAnim: null, flip: null, ext: null, miss: null, missAnim: null, missTimer: 0, hint: false, note: null, own: 0, wrong: 0, kbd: null, px: 0 },
    free: { m: 6, n: 4 },
    quiz: [
      { m: 1000, n: 600, answer: null },
      { m: 1001, n: 1000, answer: null },
      { m: 64, n: 48, answer: null },
    ],
    anim: null,
  };
  rooms.p = P;

  P.go = function (phase) {
    if (P.anim) P.anim.finish();
    if (P.uf.anim) P.uf.anim.finish();
    if (stopMiss()) P.uf.view = null;
    P.phase = phase;
    if (phase === 'redraw') P.uf.view = null;
    renderPocket();
  };

  function pocketSvg() {
    let svg = $('p-svg');
    if (!svg) {
      const stage = $('p-stage');
      stage.textContent = '';
      svg = s('svg', { id: 'p-svg', class: 'p-svg', role: 'img', 'aria-label': 'A billiard table' });
      stage.append(svg);
      svg.addEventListener('click', onPocketSvgClick);
      svg.addEventListener('keydown', (e) => {
        const wall = e.target.closest && e.target.closest('[data-wall]');
        if (!wall || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        pickCushion(wall.getAttribute('data-wall'), true);
      });
    }
    return svg;
  }
  // Table units per screen pixel (the SVG letterboxes its viewBox: preserveAspectRatio meet).
  function unitsPerPx(svg, vb) {
    const r = svg.getBoundingClientRect();
    const w = r.width || 600;
    const hh = r.height || 400;
    return Math.max(vb.w / w, vb.h / hh);
  }
  function setView(svg, vb) {
    svg.setAttribute('viewBox', `${vb.x} ${-(vb.y + vb.h)} ${vb.w} ${vb.h}`);
  }
  // y is up in table units; SVG y is down. All drawing goes through Y().
  const Y = (y) => -y;

  function drawCopy(g, m, n, i, j, opts) {
    const x0 = i * m;
    const y0 = j * n;
    s('rect', { class: 'cloth' + (opts.copy ? ' copy' : '') + (opts.miss ? ' miss' : ''), x: x0, y: Y(y0 + n), width: m, height: n }, g);
    if (opts.grid) {
      const d = [];
      for (let u = 1; u < m; u++) d.push(`M${x0 + u} ${Y(y0)}V${Y(y0 + n)}`);
      for (let v = 1; v < n; v++) d.push(`M${x0} ${Y(y0 + v)}H${x0 + m}`);
      if (d.length) s('path', { class: 'gridline', d: d.join(''), 'stroke-width': opts.px * 1, fill: 'none' }, g);
    }
    s('rect', { class: opts.copy ? 'edge' : 'cushion', x: x0, y: Y(y0 + n), width: m, height: n, 'stroke-width': opts.copy ? opts.px * 1.2 : Math.max(0.12, opts.px * 5) }, g);
  }
  function drawPockets(g, m, n, corners, px, opts) {
    const r = Math.max(opts.small ? 0 : 0.3, px * (opts.small ? 8 : 11));
    for (const [X, Y_] of corners) {
      const lab = PK.cornerLabel(X, Y_);
      const cx = X * m;
      const cy = Y(Y_ * n);
      const ring = opts.guess === lab && X <= 1 && Y_ <= 1 && !opts.small;
      s('circle', { class: `pocket ${lab}` + (ring ? ' guess' : ''), cx, cy, r, 'stroke-width': px * (ring ? 3.5 : 1.5) }, g);
      s('text', { class: 'plabel', x: cx, y: cy, 'font-size': r * (opts.small ? 1.25 : 1.15) }, g).textContent = lab;
      if (opts.clickable) s('circle', { class: 'pocket-hit', cx, cy, r: Math.max(r * 2, px * 26), 'data-pocket': lab }, g);
    }
  }
  // The corner where the straight line ends: a big copy of its pocket, ringed in gold.
  function drawEnd(svg, m, n, L, px) {
    const pr = PK.predict(m, n);
    const cx = L;
    const cy = Y(L);
    s('circle', { class: 'endring', cx, cy, r: px * 21, 'stroke-width': px * 3 }, svg);
    s('circle', { class: `pocket ${pr.pocket}`, cx, cy, r: px * 15, 'stroke-width': px * 2 }, svg);
    s('text', { class: 'plabel', x: cx, y: cy, 'font-size': px * 17 }, svg).textContent = pr.pocket;
  }

  function onPocketSvgClick(e) {
    const hit = e.target.closest('[data-pocket]');
    if (hit && P.phase === 'play') { guessPocket(hit.getAttribute('data-pocket')); return; }
    const wall = e.target.closest('[data-wall]');
    if (wall && P.phase === 'redraw') pickCushion(wall.getAttribute('data-wall'), false);
  }

  /* --- play: guess, then watch the ball --- */
  function guessPocket(lab) {
    if (P.phase !== 'play' || P.shot) return;
    if (P.results[P.idx]) return;
    P.guess = lab;
    const [m, n] = TABLES[P.idx];
    const sim = PK.simulate(m, n);
    P.shot = { m, n, sim, progress: 0 };
    const total = sim.length;
    const ms = Math.min(5600, Math.max(1900, total * 125));
    renderPocket();
    P.anim = tween(ms, (p) => { P.shot.progress = p; drawShot(); }, () => {
      P.anim = null;
      const res = { guess: lab, actual: sim.pocket, bounces: sim.bounces, m, n };
      P.results[P.idx] = res;
      record.p.before.total++;
      if (lab === sim.pocket) record.p.before.right++;
      P.shot = null;
      const shots = P.results.filter(Boolean).length;
      if (shots >= 2) P.unlocked.add('redraw');
      if (shots >= TABLES.length) P.done.add('play');
      renderLedger();
      renderPocket();
    });
  }

  function pathUpTo(points, frac) {
    // points of the bounce path up to a fraction of its length, plus the bounce count so far
    let total = 0;
    for (let i = 1; i < points.length; i++) total += Math.abs(points[i].x - points[i - 1].x);
    let left = frac * total;
    const out = [points[0]];
    let bounces = 0;
    for (let i = 1; i < points.length; i++) {
      const seg = Math.abs(points[i].x - points[i - 1].x);
      if (left >= seg) {
        out.push(points[i]);
        left -= seg;
        if (i < points.length - 1) bounces++;
      } else {
        const t = seg ? left / seg : 0;
        out.push({ x: lerp(points[i - 1].x, points[i].x, t), y: lerp(points[i - 1].y, points[i].y, t) });
        break;
      }
    }
    return { pts: out, bounces };
  }

  function drawTableScene(m, n, opts) {
    const svg = pocketSvg();
    const pad = 0.75;
    const vb = { x: -pad, y: -pad, w: m + 2 * pad, h: n + 2 * pad };
    setView(svg, vb);
    svg.textContent = '';
    const px = unitsPerPx(svg, vb);
    const g = s('g', null, svg);
    drawCopy(g, m, n, 0, 0, { grid: true, px });
    // width and height labels
    s('text', { class: 'dimlabel', x: m / 2, y: Y(-pad * 0.62), 'font-size': px * 13 }, svg).textContent = `${m} wide`;
    const t = s('text', { class: 'dimlabel', x: 0, y: 0, 'font-size': px * 13, transform: `translate(${m + pad * 0.62} ${Y(n / 2)}) rotate(90)` }, svg);
    t.textContent = `${n} high`;
    drawPockets(svg, m, n, [[0, 0], [1, 0], [1, 1], [0, 1]], px, { clickable: opts.clickable, guess: opts.guess });
    return { svg, px };
  }

  function drawShot() {
    const sh = P.shot;
    const { svg, px } = drawTableScene(sh.m, sh.n, { clickable: false, guess: P.guess });
    const { pts, bounces } = pathUpTo(sh.sim.points, sh.progress);
    s('polyline', { class: 'trace', points: pts.map((p) => `${p.x},${Y(p.y)}`).join(' '), 'stroke-width': px * 2.4 }, svg);
    const last = pts[pts.length - 1];
    const sink = sh.progress >= 1 ? 0.55 : 1;
    s('circle', { class: 'ball', cx: last.x, cy: Y(last.y), r: px * 8 * sink, 'stroke-width': px * 1.2 }, svg);
    setStatus('p-status', `Bounces: <b>${bounces}</b>&hellip;`);
  }

  function renderPocketPlay() {
    const [m, n] = TABLES[P.idx];
    const res = P.results[P.idx];
    if (P.shot) { drawShot(); }
    else {
      const { svg, px } = drawTableScene(m, n, { clickable: !res, guess: res ? res.guess : null });
      if (res) {
        const sim = PK.simulate(m, n);
        s('polyline', { class: 'trace', points: sim.points.map((p) => `${p.x},${Y(p.y)}`).join(' '), 'stroke-width': px * 2.4 }, svg);
      } else {
        s('circle', { class: 'ball', cx: 0.32, cy: Y(0.32), r: px * 8, 'stroke-width': px * 1.2 }, svg);
      }
    }
    const controls = $('p-controls');
    controls.textContent = '';
    if (!P.shot) {
      if (res) {
        const right = res.guess === res.actual;
        setStatus('p-status', (right ? '<span class="good">Right.</span> ' : `You said ${res.guess}. `) +
          `It dropped into <b>${res.actual}</b> after ${res.bounces} bounces.` +
          (P.idx < TABLES.length - 1 ? '' : ' Could you have known before it rolled?'));
      } else {
        setStatus('p-status', `Table ${P.idx + 1} of ${TABLES.length}: ${m} wide, ${n} high. <b>Tap the pocket you think the ball will drop into.</b>`);
      }
    }
    const keys = h('div', { class: 'pocket-keys', role: 'group', 'aria-label': 'Guess a pocket' });
    for (const lab of ['A', 'B', 'C', 'D']) {
      keys.append(h('button', {
        class: 'pkey ' + lab, 'aria-label': `Pocket ${lab}`, 'aria-pressed': (res ? res.guess : P.guess) === lab && (res || P.shot) ? 'true' : 'false',
        disabled: !!res || !!P.shot, on: { click: () => guessPocket(lab) },
      }, lab));
    }
    controls.append(keys);
    controls.append(h('button', {
      class: 'btn', disabled: !res || P.idx >= TABLES.length - 1,
      on: { click: () => { P.idx++; P.guess = null; renderPocket(); } },
    }, 'Next table'));
    controls.append(h('span', { class: 'spacer' }));
    const ok = P.unlocked.has('redraw');
    controls.append(h('button', {
      class: 'btn' + (ok ? ' primary' : ''), disabled: !ok,
      on: { click: () => P.go('redraw') },
    }, ok ? 'Unfold the table →' : 'Redraw it (try two tables first)'));
  }

  /* --- redraw: unfold the table, one cushion at a time. The reader chooses each cushion. --- */
  function ufTable() { return TABLES[P.uf.t]; }
  function ufCopies(k) {
    const [m, n] = ufTable();
    const steps = PK.unfoldSteps(m, n);
    const copies = [[0, 0]];
    for (let s2 = 0; s2 < k && s2 < steps.length; s2++) copies.push(steps[s2].to);
    return { copies, steps };
  }
  function ufFit(m, n, copies) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [i, j] of copies) {
      x0 = Math.min(x0, i * m); y0 = Math.min(y0, j * n);
      x1 = Math.max(x1, (i + 1) * m); y1 = Math.max(y1, (j + 1) * n);
    }
    const pad = Math.max(0.8, (x1 - x0 + y1 - y0) * 0.035);
    let w = x1 - x0 + 2 * pad;
    let hh = y1 - y0 + 2 * pad;
    // keep the stage from getting too tall on a phone: never taller than 1.15 x wide
    if (hh > w * 1.15) { const extra = hh / 1.15 - w; w += extra; x0 -= extra / 2; }
    return { x: x0 - pad, y: y0 - pad, w, h: hh };
  }
  // Where the ball waits after k unfoldings: on the cushion it last crossed (at the start, just out of pocket A).
  function restT(k, px) {
    const [m, n] = ufTable();
    const steps = PK.unfoldSteps(m, n);
    if (k >= steps.length) return PK.predict(m, n).L;
    if (k > 0) return steps[k - 1].at;
    return Math.min(0.4 * Math.min(m, n), Math.max(0.3, (px || 0) * 14));
  }
  // One cushion of copy (i, j), as a segment in table units.
  function sideLine(m, n, i, j, side) {
    const x0 = i * m, x1 = (i + 1) * m, y0 = j * n, y1 = (j + 1) * n;
    return side === 'left' ? [x0, y0, x0, y1] : side === 'right' ? [x1, y0, x1, y1] : side === 'bottom' ? [x0, y0, x1, y0] : [x0, y1, x1, y1];
  }
  // The area that picks a cushion: the quarter of the copy next to it, plus a strip just outside it.
  function sidePoly(m, n, i, j, side, out) {
    const [ax, ay, bx, by] = sideLine(m, n, i, j, side);
    const nx = side === 'left' ? -1 : side === 'right' ? 1 : 0;
    const ny = side === 'bottom' ? -1 : side === 'top' ? 1 : 0;
    const pts = [[ax, ay], [ax + nx * out, ay + ny * out], [bx + nx * out, by + ny * out], [bx, by], [(i + 0.5) * m, (j + 0.5) * n]];
    return pts.map(([x, y]) => `${x},${Y(y)}`).join(' ');
  }

  function drawUnfold() {
    const svg = pocketSvg();
    const [m, n] = ufTable();
    const uf = P.uf;
    const { copies, steps } = ufCopies(uf.k);
    const extra = uf.flip ? [uf.flip.to] : uf.miss ? [uf.miss.to] : [];
    if (!uf.view) uf.view = ufFit(m, n, copies.concat(extra));
    const vb = uf.view;
    setView(svg, vb);
    const act = document.activeElement;
    const hadFocus = act && svg.contains(act) && act.getAttribute ? act.getAttribute('data-wall') : null;
    svg.textContent = '';
    const px = unitsPerPx(svg, vb);
    uf.px = px;
    const g = s('g', null, svg);
    copies.forEach(([i, j], idx) => drawCopy(g, m, n, i, j, { grid: m / px > 40, px, copy: idx > 0 }));
    // a copy turning over across a cushion like a page: the next copy, or a wrong one that will turn back
    const turning = uf.flip || uf.miss;
    if (turning) {
      const f = turning;
      const sc = -Math.cos(Math.PI * f.p);
      const scs = Math.abs(sc) < 0.02 ? 0.02 * Math.sign(sc || 1) : sc;
      const gg = s('g', null, svg);
      if (f.wall === 'v') gg.setAttribute('transform', `translate(${f.at} 0) scale(${scs} 1) translate(${-f.at} 0)`);
      else gg.setAttribute('transform', `translate(0 ${Y(f.at)}) scale(1 ${scs}) translate(0 ${-Y(f.at)})`);
      drawCopy(gg, m, n, f.to[0], f.to[1], { grid: m / px > 40, px, copy: true, miss: f === uf.miss });
      if (sc < 0) s('rect', { class: 'flipback', x: f.to[0] * m, y: Y((f.to[1] + 1) * n), width: m, height: n, opacity: 0.25 * -sc }, gg);
      if (f === uf.miss && f.p >= 0.999) {
        // a cross on the copy the straight line never enters
        const cx = (f.to[0] + 0.5) * m, cy = (f.to[1] + 0.5) * n, d = Math.min(m, n) * 0.16;
        s('path', { class: 'missx', d: `M${cx - d} ${Y(cy - d)}L${cx + d} ${Y(cy + d)}M${cx - d} ${Y(cy + d)}L${cx + d} ${Y(cy - d)}`, 'stroke-width': px * 4 }, gg);
      }
    }
    const complete = uf.k >= steps.length && !uf.flip && !uf.ext;
    const resting = !complete && !uf.flip && !uf.ext;
    const tNow = uf.ext ? uf.ext.t : restT(uf.k, px);
    // the zigzag on the real table, as far as the ball has got
    const zig = [];
    const N = Math.max(2, Math.ceil(tNow * 4));
    for (let q = 0; q <= N; q++) { const t = (tNow * q) / N; const f = PK.fold(m, n, t, t); zig.push(`${f.x},${Y(f.y)}`); }
    s('polyline', { class: 'zig', points: zig.join(' '), 'stroke-width': px * 1.6 }, svg);
    // after a wrong cushion: where the straight line really leaves the copy it is in
    if (uf.miss && uf.miss.p >= 0.999 && uf.k < steps.length) {
      const tEnd = steps[uf.k].at + 0.35 * Math.min(m, n);
      s('line', { class: 'ghostray', x1: tNow, y1: Y(tNow), x2: tEnd, y2: Y(tEnd), 'stroke-width': px * 2.6, 'stroke-dasharray': `${px * 8} ${px * 6}` }, svg);
    }
    // the straight line
    s('line', { class: 'straight', x1: 0, y1: 0, x2: tNow, y2: Y(tNow), 'stroke-width': px * 3.2 }, svg);
    // pockets at every lattice corner of the copies shown
    const corners = new Map();
    for (const [i, j] of copies) for (const [a, b] of [[0, 0], [1, 0], [1, 1], [0, 1]]) corners.set(`${i + a},${j + b}`, [i + a, j + b]);
    drawPockets(svg, m, n, [...corners.values()], px, { small: copies.length > 1 });
    if (!complete) s('circle', { class: 'ball', cx: tNow, cy: Y(tNow), r: px * 7, 'stroke-width': px * 1.2 }, svg);
    if (resting) {
      // which way the ball is heading (kept well short of the next cushion, so it gives nothing away)
      const room = (steps[uf.k].at - tNow) * 0.45;
      const a = Math.min(room * 0.4, (px * 11) / Math.SQRT2);
      const b = Math.min(room, (px * 30) / Math.SQRT2);
      const hd = Math.min(b - a, (px * 8) / Math.SQRT2);
      if (b > a) s('path', { class: 'heading', d: `M${tNow + a} ${Y(tNow + a)}L${tNow + b} ${Y(tNow + b)}M${tNow + b - hd * 1.4} ${Y(tNow + b)}L${tNow + b} ${Y(tNow + b)}L${tNow + b} ${Y(tNow + b - hd * 1.4)}`, 'stroke-width': px * 2.2 }, svg);
      // every cushion of the copy the ball is in can be chosen
      const [i, j] = steps[uf.k].from;
      const next = steps[uf.k].wall === 'v' ? 'right' : 'top';
      const picks = s('g', { class: 'picks' }, svg);
      for (const side of PK.SIDES) {
        const gp = s('g', {
          class: 'pick' + (uf.hint && side === next ? ' hinted' : ''), 'data-wall': side, tabindex: 0, role: 'button',
          'aria-label': `The ${side} cushion of ${uf.k ? 'the newest copy' : 'the table'}`,
        }, picks);
        s('polygon', { class: 'hit', points: sidePoly(m, n, i, j, side, px * 24) }, gp);
        // the visible cushion stops short of the pockets at its ends
        const [ax0, ay0, bx0, by0] = sideLine(m, n, i, j, side);
        const len = Math.hypot(bx0 - ax0, by0 - ay0);
        const ins = Math.min(px * (copies.length > 1 ? 13 : 16), len * 0.3) / len;
        const ax = ax0 + (bx0 - ax0) * ins, ay = ay0 + (by0 - ay0) * ins;
        const bx = bx0 - (bx0 - ax0) * ins, by = by0 - (by0 - ay0) * ins;
        if (uf.hint && side === next) s('line', { class: 'wallhint', x1: ax, y1: Y(ay), x2: bx, y2: Y(by), 'stroke-width': px * 6, 'stroke-dasharray': `${px * 10} ${px * 7}` }, gp);
        else s('line', { class: 'cue', x1: ax, y1: Y(ay), x2: bx, y2: Y(by), 'stroke-width': px * 3.4 }, gp);
      }
      const want = hadFocus || uf.kbd;
      if (want) {
        const f = picks.querySelector(`[data-wall="${want}"]`);
        if (f) f.focus({ preventScroll: true });
      }
    }
    if (complete) drawEnd(svg, m, n, PK.predict(m, n).L, px);
    svg.setAttribute('role', resting ? 'group' : 'img');
    svg.setAttribute('aria-label', resting ? 'The unfolding table: choose a cushion' : 'A billiard table, unfolded');
    const st = $('p-stage').dataset;
    st.k = String(uf.k);
    st.complete = complete ? '1' : '0';
    st.miss = uf.miss ? '1' : '0';
    st.wrong = String(uf.wrong);
    return { complete, steps };
  }

  function animateView(to, ms) {
    const uf = P.uf;
    const from = uf.view || to;
    if (uf.viewAnim) uf.viewAnim.cancel();
    uf.viewAnim = tween(ms, (p) => {
      const t = ease(p);
      uf.view = { x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t), w: lerp(from.w, to.w, t), h: lerp(from.h, to.h, t) };
      if (!uf.anim && !uf.missAnim && P.phase === 'redraw') drawUnfold();
    }, () => { uf.viewAnim = null; });
  }

  // A wrong cushion's copy, folded out and waiting to fold back. Returns true if there was one.
  function stopMiss() {
    const uf = P.uf;
    clearTimeout(uf.missTimer);
    if (uf.missAnim) uf.missAnim.cancel();
    uf.missAnim = null;
    if (!uf.miss) return false;
    uf.miss = null;
    return true;
  }

  // The reader taps a cushion of the copy the ball is in.
  function pickCushion(side, viaKey) {
    const uf = P.uf;
    if (P.phase !== 'redraw') return;
    uf.kbd = viaKey ? side : null;
    if (uf.anim) { uf.anim.finish(); return; }
    const [m, n] = ufTable();
    if (stopMiss()) animateView(ufFit(m, n, ufCopies(uf.k).copies), 260);
    const ch = PK.cushionChoice(m, n, uf.k, side);
    if (!ch) return;
    if (ch.kind === 'next') { unfoldAcross(ch, uf.hint); return; }
    if (ch.kind === 'entry') { uf.note = 'entry'; renderPocket(); return; }
    // a wrong cushion: fold the copy out across it, show that the straight line misses it, fold it back
    uf.wrong++;
    uf.note = 'miss';
    const { copies } = ufCopies(uf.k);
    animateView(ufFit(m, n, copies.concat([ch.to])), 380);
    uf.miss = { wall: ch.wall, at: ch.at, to: ch.to, p: 0 };
    renderPocket();
    const miss = uf.miss;
    uf.missAnim = tween(480, (p) => { miss.p = ease(p); drawUnfold(); }, () => {
      uf.missAnim = null;
      uf.missTimer = setTimeout(() => {
        if (uf.miss !== miss) return;
        animateView(ufFit(m, n, copies), 380);
        uf.missAnim = tween(480, (p) => { miss.p = 1 - ease(p); drawUnfold(); }, () => {
          uf.missAnim = null;
          uf.miss = null;
          if (P.phase === 'redraw') renderPocket();
        });
      }, 1300);
    });
  }

  // The right cushion: the ball runs to it, then a mirror copy turns over across it like a page.
  function unfoldAcross(ch, helped) {
    const uf = P.uf;
    const [m, n] = ufTable();
    const { copies, steps } = ufCopies(uf.k);
    const k = uf.k;
    const t0 = restT(k, uf.px);
    const t1 = steps[k].at;
    const last = k + 1 >= steps.length;
    const L = PK.predict(m, n).L;
    const dRun = Math.min(700, 120 + (t1 - t0) * 40);
    const dFlip = 560;
    const dEnd = last ? Math.min(700, 120 + (L - t1) * 40) : 0;
    const total = dRun + dFlip + dEnd;
    uf.hint = false;
    uf.note = null;
    if (!helped) uf.own++;
    animateView(ufFit(m, n, copies.concat([ch.to])), 420);
    uf.ext = { t: t0 };
    uf.anim = tween(total, (p) => {
      const ms = p * total;
      if (ms < dRun) uf.ext.t = lerp(t0, t1, ms / dRun);
      else if (ms < dRun + dFlip) { uf.ext.t = t1; uf.flip = { wall: ch.wall, at: ch.at, to: ch.to, p: ease((ms - dRun) / dFlip) }; }
      else { uf.flip = null; uf.k = k + 1; uf.ext.t = last ? lerp(t1, L, (ms - dRun - dFlip) / dEnd) : t1; }
      drawUnfold();
    }, () => {
      uf.anim = null;
      uf.flip = null;
      uf.ext = null;
      uf.k = k + 1;
      if (P.phase === 'redraw') renderPocket();
    });
  }
  // The hint: first press lights the right cushion; a second press unfolds it for the reader.
  function hintCushion() {
    const uf = P.uf;
    if (uf.anim) { uf.anim.finish(); return; }
    const [m, n] = ufTable();
    const steps = PK.unfoldSteps(m, n);
    if (uf.k >= steps.length) return;
    if (stopMiss()) animateView(ufFit(m, n, ufCopies(uf.k).copies), 260);
    if (!uf.hint) { uf.hint = true; uf.note = null; renderPocket(); return; }
    unfoldAcross(PK.cushionChoice(m, n, uf.k, steps[uf.k].wall === 'v' ? 'right' : 'top'), true);
  }
  function unfoldAll() {
    const uf = P.uf;
    if (uf.anim) uf.anim.finish();
    stopMiss();
    const [m, n] = ufTable();
    const steps = PK.unfoldSteps(m, n);
    uf.k = steps.length;
    uf.flip = null;
    uf.ext = null;
    uf.hint = false;
    uf.note = null;
    animateView(ufFit(m, n, ufCopies(uf.k).copies), 500);
    renderPocket();
  }
  function foldUp(t) {
    const uf = P.uf;
    if (uf.anim) uf.anim.cancel();
    if (uf.viewAnim) uf.viewAnim.cancel();
    stopMiss();
    uf.anim = null;
    uf.viewAnim = null;
    uf.flip = null;
    uf.ext = null;
    uf.k = 0;
    uf.hint = false;
    uf.note = null;
    uf.own = 0;
    uf.wrong = 0;
    if (t != null) uf.t = t;
    uf.view = null;
    renderPocket();
  }

  function renderPocketRedraw() {
    const uf = P.uf;
    const [m, n] = ufTable();
    const { complete, steps } = drawUnfold();
    const pr = PK.predict(m, n);
    if (complete) {
      if (!P.done.has('redraw')) { P.done.add('redraw'); P.unlocked.add('again'); renderSteps('p'); }
      const own = uf.own === steps.length ? ' You chose every cushion yourself.' : ` You chose ${uf.own} of the ${steps.length} cushions yourself.`;
      setStatus('p-status', `<span class="good">A straight line, into a copy of pocket ${pr.pocket}.</span> On the real table that is ${pr.bounces} bounces, and you never had to follow one. It crossed ${pr.across} tables across and ${pr.up} up.` + (steps.length ? own : ''));
    } else {
      let msg = '';
      if (uf.miss) msg = '<span class="them">Not that cushion.</span> The copy that folded out across it is one the straight line never enters: the dashed line shows where the line really leaves. ';
      else if (uf.note === 'miss') msg = '<span class="them">Not that cushion:</span> the straight line never enters the copy across it. ';
      else if (uf.note === 'entry') msg = 'The ball came in through that cushion, and the copy behind it is already unfolded. ';
      if (uf.k === 0) {
        msg += msg ? '<b>Which cushion will the ball hit first?</b>'
          : `The ${m}&nbsp;&times;&nbsp;${n} table. The ball leaves A heading up and to the right at 45&deg;. Don&rsquo;t bounce it: <b>tap the cushion it will hit first</b>, and a mirror copy of the table folds out across it.`;
      } else {
        msg += msg ? '<b>Which cushion of the newest copy will the line reach next?</b>'
          : `${uf.k} cushion${uf.k > 1 ? 's' : ''} unfolded. The faint zigzag is the real ball; the gold line is the same path, unbent. <b>Which cushion of the newest copy will the line reach next? Tap it.</b>`;
      }
      if (uf.hint) msg += '<br><span class="note">Hint: it&rsquo;s the glowing cushion. Tap it, or press the button again and the page unfolds it for you.</span>';
      setStatus('p-status', msg);
    }
    const controls = $('p-controls');
    controls.textContent = '';
    const tabs = h('div', { class: 'ptabs', role: 'group', 'aria-label': 'Table' });
    TABLES.forEach(([a, b], t) => tabs.append(h('button', { 'aria-pressed': t === uf.t ? 'true' : 'false', on: { click: () => foldUp(t) } }, `${a}×${b}`)));
    controls.append(tabs,
      h('button', { class: 'btn', disabled: complete, on: { click: hintCushion } }, uf.hint ? 'Unfold it for me' : 'Hint'));
    if (uf.k >= 3 && !complete) controls.append(h('button', { class: 'btn', on: { click: unfoldAll } }, 'Unfold the rest'));
    controls.append(
      h('button', { class: 'btn', disabled: uf.k === 0, on: { click: () => foldUp() } }, 'Fold up'),
      h('span', { class: 'spacer' }),
      h('button', {
        class: 'btn' + (P.unlocked.has('again') ? ' primary' : ''), disabled: !P.unlocked.has('again'),
        on: { click: () => P.go('again') },
      }, P.unlocked.has('again') ? 'Any table →' : 'Play again (unfold one first)'));
  }

  /* --- again: any table, and three you could never trace --- */
  function drawLattice() {
    const svg = pocketSvg();
    const { m, n } = P.free;
    const pr = PK.predict(m, n);
    const L = pr.L;
    const pad = Math.max(0.8, L * 0.04);
    const vb = { x: -pad, y: -pad, w: L + 2 * pad, h: L + 2 * pad };
    setView(svg, vb);
    svg.textContent = '';
    const px = unitsPerPx(svg, vb);
    const g = s('g', null, svg);
    for (let i = 0; i < pr.across; i++) for (let j = 0; j < pr.up; j++) {
      drawCopy(g, m, n, i, j, { grid: m / px > 40, px, copy: i + j > 0 });
    }
    const corners = [];
    for (let X = 0; X <= pr.across; X++) for (let Y_ = 0; Y_ <= pr.up; Y_++) corners.push([X, Y_]);
    drawPockets(svg, m, n, corners, px, { small: true });
    const zig = PK.simulate(m, n).points.map((p) => `${p.x},${Y(p.y)}`).join(' ');
    s('polyline', { class: 'zig', points: zig, 'stroke-width': px * 1.6 }, svg);
    s('line', { class: 'straight', x1: 0, y1: 0, x2: L, y2: Y(L), 'stroke-width': px * 3 }, svg);
    drawEnd(svg, m, n, L, px);
  }

  function stepper(label, key) {
    const out = h('output', null, P.free[key]);
    const set = (d) => { P.free[key] = Math.max(1, Math.min(12, P.free[key] + d)); renderPocket(); };
    return h('span', { class: 'stepper', role: 'group', 'aria-label': label },
      h('span', { class: 'lbl' }, label),
      h('button', { 'aria-label': `${label}: less`, on: { click: () => set(-1) } }, '−'),
      out,
      h('button', { 'aria-label': `${label}: more`, on: { click: () => set(1) } }, '+'));
  }

  function quizVerdict(q) {
    const pr = PK.predict(q.m, q.n);
    const g = PK.gcd(q.m, q.n);
    const right = q.answer === pr.pocket;
    const lr = pr.across % 2 ? 'right' : 'left';
    const tb = pr.up % 2 ? 'top' : 'bottom';
    const shape = g > 1 ? `It is a ${q.m / g} × ${q.n / g} table scaled up ${g} times, so the unfolded picture is the same. ` : '';
    return (right ? '<span class="good">Yes, ' + pr.pocket + '.</span> ' : `Not ${q.answer}: it&rsquo;s <b>${pr.pocket}</b>. `) +
      shape + `The line crosses ${pr.across.toLocaleString('en')} tables across (${pr.across % 2 ? 'odd' : 'even'}, so ${lr}) and ${pr.up.toLocaleString('en')} up (${pr.up % 2 ? 'odd' : 'even'}, so ${tb}), after ${pr.bounces.toLocaleString('en')} bounces.`;
  }

  // The odd-and-even rule is held back until the reader has called the three big tables, so that the
  // ledger's "after" column is the reader's own reading of the unfolded picture, not a rule the page told them.
  const quizDone = () => P.quiz.every((x) => x.answer != null);
  function renderPocketAgain() {
    drawLattice();
    const { m, n } = P.free;
    const pr = PK.predict(m, n);
    const lr = pr.across % 2 ? 'right' : 'left';
    const tb = pr.up % 2 ? 'top' : 'bottom';
    const done = quizDone();
    const acrossTxt = `<b>${pr.across}</b> table${pr.across > 1 ? 's' : ''} across` + (done ? ` (${pr.across % 2 ? 'odd' : 'even'}: ${lr})` : '');
    const upTxt = `<b>${pr.up}</b> up` + (done ? ` (${pr.up % 2 ? 'odd' : 'even'}: ${tb})` : '');
    setStatus('p-status', `A ${m}&nbsp;&times;&nbsp;${n} table, unfolded. The line meets its first corner after ${acrossTxt} and ${upTxt}. Pocket <b>${pr.pocket}</b>, ${pr.bounces} bounce${pr.bounces === 1 ? '' : 's'}.`);
    const controls = $('p-controls');
    controls.textContent = '';
    controls.append(stepper('Wide', 'm'), stepper('High', 'n'));
    const quiz = h('div', { class: 'quiz' }, h('h3', null, 'Three tables you could never trace by eye'),
      done ? null : h('p', { class: 'note' }, 'Call all three. The answers, and the rule behind them, come after the third.'));
    P.quiz.forEach((q, qi) => {
      const keys = h('div', { class: 'pocket-keys', role: 'group', 'aria-label': `Pocket for the ${q.m} by ${q.n} table` });
      for (const lab of ['A', 'B', 'C', 'D']) {
        keys.append(h('button', {
          class: 'pkey ' + lab, 'aria-pressed': q.answer === lab ? 'true' : 'false', disabled: q.answer != null,
          'aria-label': `Pocket ${lab}`,
          on: { click: () => {
            if (q.answer != null) return;
            q.answer = lab;
            record.p.after.total++;
            if (lab === PK.predict(q.m, q.n).pocket) record.p.after.right++;
            if (quizDone()) { P.done.add('again'); reveal('p-after'); }
            renderLedger();
            renderPocket();
          } },
        }, lab));
      }
      quiz.append(h('div', { class: 'qrow', 'data-q': qi },
        h('span', { class: 'q' }, `${q.m.toLocaleString('en')} wide, ${q.n.toLocaleString('en')} high`),
        keys,
        h('div', { class: 'verdict', html: q.answer != null && done ? quizVerdict(q) : '' })));
    });
    controls.append(quiz);
  }

  function renderPocket() {
    renderSteps('p');
    $('p-stage').dataset.phase = P.phase;
    pocketSvg();
    if (P.phase === 'play') renderPocketPlay();
    else if (P.phase === 'redraw') renderPocketRedraw();
    else renderPocketAgain();
  }

  /* ================================================================== */
  /* Proof buttons: run the exhaustive checks in the reader's browser    */
  /* ================================================================== */
  function runProof(outId, fn) {
    const out = $(outId);
    out.hidden = false;
    out.textContent = 'Checking…';
    setTimeout(() => {
      const t0 = performance.now();
      const lines = fn();
      lines.push(`(${Math.round(performance.now() - t0)} ms, in this browser)`);
      out.textContent = lines.join('\n');
    }, 30);
  }
  $('f-run').addEventListener('click', () => runProof('f-proof-out', () => {
    let triples = 0, fifteen = 0;
    for (let a = 1; a <= 9; a++) for (let b = a + 1; b <= 9; b++) for (let c = b + 1; c <= 9; c++) { triples++; if (a + b + c === 15) fifteen++; }
    // every arrangement of 1..9 on the grid
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    let perms = 0, magic = 0;
    const permute = (k) => {
      if (k === 9) { perms++; if (F15.isMagic(arr)) magic++; return; }
      for (let i = k; i < 9; i++) { [arr[k], arr[i]] = [arr[i], arr[k]]; permute(k + 1); [arr[k], arr[i]] = [arr[i], arr[k]]; }
    };
    permute(0);
    // every game, on the numbers and on the grid
    const count = (winFn) => {
      const r = { games: 0, first: 0, second: 0, draw: 0 };
      const go = (a, b, turn, used) => {
        for (let x = 0; x < 9; x++) {
          if (used & (1 << x)) continue;
          const na = turn ? a : a | (1 << x);
          const nb = turn ? b | (1 << x) : b;
          const nu = used | (1 << x);
          if (winFn(turn ? nb : na)) { r.games++; turn ? r.second++ : r.first++; }
          else if (nu === 511) { r.games++; r.draw++; }
          else go(na, nb, !turn, nu);
        }
      };
      go(0, 0, false, 0);
      return r;
    };
    const numWin = (mask) => {
      const nums = []; for (let x = 0; x < 9; x++) if (mask & (1 << x)) nums.push(x + 1);
      for (let i = 0; i < nums.length; i++) for (let j = i + 1; j < nums.length; j++) for (let k = j + 1; k < nums.length; k++) if (nums[i] + nums[j] + nums[k] === 15) return true;
      return false;
    };
    const gridWin = (mask) => F15.LINES.some((ln) => ln.every((c) => mask & (1 << c)));
    const a = count(numWin);
    const b = count(gridWin);
    // the machine against every sequence of choices you could make, taking every tie-break it could take
    // (18 evenly spaced tie-break draws reach every member of a tie of up to 9 moves)
    const rngs = Array.from({ length: 18 }, (_, i) => () => (i + 0.5) / 18);
    const nums = (mask) => [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((k) => mask & F15.bit(k));
    const holds = (mask) => numWin(nums(mask).reduce((m, k) => m | (1 << (k - 1)), 0));
    const vs = { games: 0, won: 0, drawn: 0, lost: 0 };
    const play = (you, mach, machineToMove) => {
      const free = nums(F15.ALL & ~(you | mach));
      if (machineToMove) {
        for (const k of new Set(rngs.map((r) => F15.machineMove(mach, you, r)))) {
          const nm = mach | F15.bit(k);
          if (holds(nm)) { vs.games++; vs.won++; } else if (free.length === 1) { vs.games++; vs.drawn++; } else play(you, nm, false);
        }
      } else {
        for (const k of free) {
          const ny = you | F15.bit(k);
          if (holds(ny)) { vs.games++; vs.lost++; } else if (free.length === 1) { vs.games++; vs.drawn++; } else play(ny, mach, true);
        }
      }
    };
    play(0, 0, true);
    play(0, 0, false);
    // after each even opening, which of your replies avoid a loss under best play
    const safe = [2, 4, 6, 8].map((e) => [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((r) => r !== e && F15.moveValue(0, F15.bit(e), r) >= 0));
    return [
      `triples of 1-9: ${triples}; adding to 15: ${fifteen}`,
      `grids checked: ${perms.toLocaleString('en')}; every line 15: ${magic}`,
      `games of Fifteen: ${a.games.toLocaleString('en')} (first wins ${a.first.toLocaleString('en')}, second ${a.second.toLocaleString('en')}, draws ${a.draw.toLocaleString('en')})`,
      `games of noughts and crosses: ${b.games.toLocaleString('en')} (first wins ${b.first.toLocaleString('en')}, second ${b.second.toLocaleString('en')}, draws ${b.draw.toLocaleString('en')})`,
      `value of Fifteen with best play: ${['first player loses', 'draw', 'first player wins'][F15.value(0, 0) + 1]}`,
      `the machine against every choice you could make, both ways round: ${vs.games.toLocaleString('en')} games; it won ${vs.won.toLocaleString('en')}, drew ${vs.drawn.toLocaleString('en')}, lost ${vs.lost}`,
      `your replies that don't lose after it opens 2, 4, 6, 8: ${safe.map((x) => x.join(' ')).join('; ')}`,
    ];
  }));
  $('k-run').addEventListener('click', () => runProof('k-proof-out', () => {
    const dist = KN.distances(KN.START);
    const ring = KN.ringOrder().map((i) => KN.SQUARES[i].name);
    // every way to put two white and two black knights on the eight outer squares
    const outer = KN.SQUARES.map((_, i) => i).filter((i) => i !== 4);
    let placements = 0, reached = 0;
    for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) for (let c = 0; c < 8; c++) for (let d = c + 1; d < 8; d++) {
      if (c === a || c === b || d === a || d === b) continue;
      const cells = Array(9).fill('.');
      cells[outer[a]] = cells[outer[b]] = 'W';
      cells[outer[c]] = cells[outer[d]] = 'B';
      placements++;
      if (dist.has(cells.join(''))) reached++;
    }
    return [
      `centre square b2 has ${KN.NEIGHBOURS[4].length} knight moves`,
      `the other eight, following the strings: ${ring.join(' - ')} - ${ring[0]}`,
      `placements of two white and two black knights on the outer squares: ${placements}; reachable from the start: ${reached} (the search found ${dist.size} positions in all)`,
      `moves to the swap: ${dist.get(KN.TARGETS.swap)}`,
      `diagonals reachable: ${dist.has(KN.TARGETS.diagonals) ? 'yes' : 'no'}`,
      `colours round the ring at the start: ${KN.ringColours(KN.START)}; for the diagonals: ${KN.ringColours(KN.TARGETS.diagonals)}`,
    ];
  }));
  $('p-run').addEventListener('click', () => runProof('p-proof-out', () => {
    let checked = 0, agree = 0, home = 0, maxB = 0;
    for (let m = 1; m <= 60; m++) for (let n = 1; n <= 60; n++) {
      const sim = PK.simulate(m, n);
      const pr = PK.predict(m, n);
      checked++;
      if (sim.pocket === pr.pocket && sim.bounces === pr.bounces) agree++;
      if (sim.pocket === 'A') home++;
      maxB = Math.max(maxB, sim.bounces);
    }
    return [
      `tables checked: ${checked.toLocaleString('en')} (every whole-number size up to 60 x 60)`,
      `bounce-by-bounce simulation agrees with the straight line: ${agree.toLocaleString('en')}`,
      `times the ball came back to A: ${home}`,
      `most bounces seen: ${maxB}`,
    ];
  }));

  /* ---------------- start ---------------- */
  renderLedger();
  newFifteen();
  renderKnights();
  renderPocket();
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (!P.anim && !P.uf.anim && !P.uf.missAnim) renderPocket(); }, 120);
  });
})();
