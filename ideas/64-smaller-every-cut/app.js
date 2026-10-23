/*
 * app.js: the page for Smaller Every Cut. All the mathematics is in hydra.js.
 *
 * Safety (WCAG 2.3.1): the hydra picture is replaced at most PICTURE_HZ times a second,
 * whatever asks for it: a tap, a click, a key (held or not), a button, or Hercules playing.
 * Every replacement goes through the gate below (request / pump / markChange). A cut is a
 * TWEEN_MS cross-fade (see draw), or an instant swap under prefers-reduced-motion; either way
 * the next one cannot start until 1000 / PICTURE_HZ ms after the last. Held Enter or Space
 * cuts once (key repeats are ignored, on the hydra and on every button but Undo). When
 * Hercules plays faster than MAX_TWEENED_RATE cuts a second, the picture and the numbers are
 * replaced together through the same gate. The selection ring (where it is, and whether it
 * shows) is drawn outside the gate and has a limit of its own, RING_HZ (ringUpdate).
 */
(function () {
  'use strict';
  const H = window.Hydra;
  const SAFE = Object.freeze({ TWEEN_MS: 420, MAX_TWEENED_RATE: 2, PICTURE_HZ: 2, RING_HZ: 4 });
  window.__hydraSafety = SAFE;

  /*
   * The gate. Anything that would replace the picture is a request; a request runs at once
   * if the picture last changed at least 1000 / PICTURE_HZ ms ago, and otherwise waits its
   * turn. Requests run in order, and at most one of each kind waits: a newer one takes the
   * place of the one waiting, at the back. So however fast anything is tapped, clicked or
   * pressed, nothing piles up behind the gate: the page catches up within a few half-seconds
   * of the input stopping (one for each kind still waiting, at most). Kinds:
   *   'move'    a cut or a sprout, aimed at the hydra on screen (see move);
   *   'undo'    steps back. An Undo clicked while one is waiting adds a step to it, so quick
   *             clicks undo as many steps, in one change of the picture; an Undo clicked while
   *             a cut or sprout is waiting cancels that instead (see undoClick);
   *   'load'    a new hydra from the hydra buttons. It drops everything waiting except a change
   *             of the labels, since all of it would act on the hydra it replaces;
   *   'restart' Start over. It drops waiting cuts, undos and starts of Hercules, and adds
   *             nothing while a 'load' or 'restart' is waiting (that one starts afresh anyway);
   *   'clear', 'fight', 'labels'  the other controls that change the picture;
   *   'now'     changes no picture itself (starting Hercules); runs once everything before it has.
   * Hercules's own cuts and snapshots wait for the gate too, and give way to waiting requests.
   */
  const GAP_MS = 1000 / SAFE.PICTURE_HZ;
  const gate = { last: -Infinity, queue: [], timer: 0, log: [] };
  const DROPS = { load: ['move', 'undo', 'now', 'restart', 'clear', 'fight'], restart: ['move', 'undo', 'now'] };

  function gateWait() {
    return gate.last + GAP_MS - performance.now();
  }

  function gateFree() {
    return !gate.queue.length && gateWait() <= 0;
  }

  function markChange() {
    gate.last = performance.now();
    gate.log.push(Math.round(gate.last * 10) / 10);
    if (gate.log.length > 400) gate.log.shift();
  }

  function waiting(kind) {
    return gate.queue.some((r) => r.kind === kind);
  }

  function cancel(kind) {
    gate.queue = gate.queue.filter((r) => r.kind !== kind);
  }

  function request(kind, fn) {
    if (kind === 'restart' && (waiting('load') || waiting('restart'))) return;
    const old = gate.queue.find((r) => r.kind === kind);
    const drop = DROPS[kind] || [];
    gate.queue = gate.queue.filter((r) => r.kind !== kind && !drop.includes(r.kind));
    gate.queue.push({ kind, fn, steps: kind === 'undo' && old ? old.steps + 1 : 1 });
    pump();
  }

  function pump() {
    clearTimeout(gate.timer);
    gate.timer = 0;
    while (gate.queue.length) {
      const head = gate.queue[0];
      if (head.kind !== 'now') {
        const w = gateWait();
        if (w > 0) {
          gate.timer = setTimeout(pump, Math.ceil(w) + 1);
          return;
        }
      }
      gate.queue.shift();
      head.fn(head.steps);
    }
  }

  /*
   * The selection ring: the outline on the head (in Grow your own, also the joint or body)
   * that the mouse is over or the arrow keys have picked, hidden while Hercules plays. It is
   * the one thing on the canvas that moves outside the gate, so it has a limit of its own: the
   * ring as drawn (`ring`) catches up with the one asked for (state.hover, state.sel, and
   * whether Hercules is playing, state.auto) at most once every RING_MS ms after it last moved,
   * and a new hydra picture moves it too. Asked sooner, it follows when the time is up, to
   * wherever it should be by then. draw() reads only `ring`, and a ring is drawn at its full
   * size even round a head that is still growing, so it changes only when it moves. In any one
   * second the ring moves on its own at most RING_HZ = 4 times and the picture changes at most
   * twice, so a pixel of a ring changes at most 6 times (3 flashes), however fast the mouse
   * sweeps across the heads or Hercules is switched on and off. (Without this, sweeping the
   * mouse to and fro across a row of heads made every ring it crossed blink, about 4,300 px²
   * at desktop size, and clicking Fast way on and off during a cross-fade blinked the ring at
   * the click rate.)
   */
  const RING_MS = 1000 / SAFE.RING_HZ;
  const ring = { hover: null, sel: -1, hidden: false, last: -Infinity, timer: 0 };

  function ringSync() {
    ring.hover = state.hover;
    ring.sel = state.sel;
    ring.hidden = !!state.auto;
    ring.last = performance.now();
  }

  function ringUpdate() {
    if (ring.hover === state.hover && ring.sel === state.sel && ring.hidden === !!state.auto) return;
    const wait = ring.last + RING_MS - performance.now();
    if (wait > 0) {
      if (!ring.timer) {
        ring.timer = setTimeout(() => {
          ring.timer = 0;
          ringUpdate();
        }, Math.ceil(wait) + 1);
      }
      return;
    }
    ringSync();
    if (!anim) draw();
  }

  const $ = (id) => document.getElementById(id);
  const canvas = $('hydra');
  const ctx = canvas.getContext('2d');
  const stage = $('stage');
  const reduceMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const darkMode = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  const state = {
    mode: 'play', // or 'grow'
    preset: 'stick',
    body: null,
    n: 1, // number of the next cut
    cuts: 0,
    stamp: 0,
    history: [],
    trail: [],
    trailSampled: false,
    last: null,
    quietFresh: false, // the last cut was Hercules's: don't colour its regrowth
    labels: false,
    sel: -1,
    hover: null,
    auto: null,
    factsFor: null,
    grownFrom: null, // the custom hydra being fought, for "Grow another"
  };

  /* ------------------------------------------------------------------ */
  /* Formatting                                                          */
  /* ------------------------------------------------------------------ */

  function fmtCount(v) {
    const s = String(v);
    if (s.length <= 15) return H.fmtBig(v, { exactDigits: 15 });
    return 'a ' + H.fmtBig(BigInt(s.length), { exactDigits: 12 }) + '-digit number (' + H.fmtBig(BigInt(s.slice(0, 9)), { exactDigits: 12 }) + '…)';
  }

  function plural(n, one, many) {
    return String(n) === '1' ? one : many;
  }

  function powHtml(e, coef) {
    // omega^e * coef, for coef a BigInt >= 1
    if (!e.length) return H.fmtBig(coef);
    return H.html([[e, coef]]);
  }

  function floorText(f) {
    if (f.kind !== 'floor') return null;
    const h = H.fmtBig(f.height, { exactDigits: 12 });
    if (f.arrows === 3) return 'more than 2↑↑↑' + h;
    if (f.arrows === 2) return 'more than a tower of ' + h + ' twos (2↑↑' + h + ')';
    return 'more than 2<sup>' + h + '</sup>';
  }

  /* ------------------------------------------------------------------ */
  /* State changes                                                       */
  /* ------------------------------------------------------------------ */

  function snapshot() {
    return { body: state.body, n: state.n, cuts: state.cuts, trail: state.trail.slice(), trailSampled: state.trailSampled, last: state.last, stamp: state.stamp, quietFresh: state.quietFresh };
  }

  function pushHistory() {
    state.history.push(snapshot());
    if (state.history.length > 300) state.history.shift();
  }

  function restore(s) {
    state.body = s.body;
    state.n = s.n;
    state.cuts = s.cuts;
    state.trail = s.trail;
    state.trailSampled = s.trailSampled;
    state.last = s.last;
    state.stamp = s.stamp;
    state.quietFresh = s.quietFresh;
  }

  function loadPreset(id) {
    stopAuto();
    state.preset = id;
    if (id === 'grow') {
      state.mode = 'grow';
      state.body = H.fromSpec([[]]);
    } else {
      state.mode = 'play';
      const p = H.PRESETS.find((x) => x.id === id) || H.PRESETS[2];
      state.body = H.fromSpec(p.spec);
    }
    resetGame();
    for (const b of document.querySelectorAll('#presets button')) b.setAttribute('aria-checked', b.dataset.preset === id ? 'true' : 'false');
    $('playControls').classList.toggle('hidden', state.mode !== 'play');
    $('growControls').classList.toggle('hidden', state.mode !== 'grow');
    if (state.mode === 'grow') toast('Tap the body, a joint or a head to grow a new head from it.');
    else if (id === 'sprout') toast('Tap the head. Watch what grows back.');
    else if (id === 'twosticks') toast('One stick dies in 20 to 37 cuts. Two sticks?');
    else if (id === 'tall') toast('Go ahead. Then let Hercules play.');
    else toast('Tap a head. Any head.');
    relayout(false);
    updateAll(true);
  }

  function resetGame() {
    state.n = 1;
    state.cuts = 0;
    state.stamp = 0;
    state.history = [];
    state.trail = [H.ordinalOf(state.body)];
    state.trailSampled = false;
    state.last = null;
    state.quietFresh = false;
    state.sel = -1;
    state.hover = null;
  }

  // Only ever called when the gate is free: from a 'move' request, or by Hercules after
  // checking gateFree().
  function cutAt(path, copies, byHercules) {
    if (state.mode !== 'play' || !state.body.g.length) return;
    const before = H.ordinalOf(state.body);
    pushHistory();
    state.stamp++;
    const r = H.cut(state.body, path, copies, state.n, state.stamp);
    state.body = r.body;
    state.quietFresh = !!byHercules;
    const after = H.ordinalOf(state.body);
    state.last = { n: state.n, grew: r.grew, before, after, beta: r.parentAfter, depth: r.depth };
    state.n++;
    state.cuts++;
    state.trail.push(after);
    if (state.trail.length > 400) state.trail.splice(1, state.trail.length - 400);
    relayout(true);
    if (!state.body.g.length) {
      stopAuto();
      toast(deathMessage());
    } else if (r.grew > 0n) {
      toast('Cut ' + state.last.n + ': the neck it hung from grew back ' + r.grew + ' more ' + plural(r.grew, 'time', 'times') + '.');
    } else {
      toast('Cut ' + state.last.n + ': straight off the body, so nothing grows back.');
    }
    updateAll(false);
  }

  function deathMessage() {
    const f = currentFacts();
    let s = 'The hydra is dead, after ' + fmtCount(BigInt(state.cuts)) + ' ' + plural(state.cuts, 'cut', 'cuts') + '.';
    if (f && f.min !== null && f.max !== null) s += f.min === f.max ? ' Every order of cuts takes ' + fmtCount(f.min) + '.' : ' Fastest possible: ' + fmtCount(f.min) + '. Slowest possible: ' + fmtCount(f.max) + '.';
    else if (f && f.min !== null) s += ' Fastest possible: ' + fmtCount(f.min) + '.';
    return s;
  }

  function sproutAt(item) {
    if (state.mode !== 'grow') return;
    const lim = H.GROW_LIMITS;
    if (H.countNodes(state.body) >= BigInt(lim.nodes)) {
      toast('That is as big as this page grows them: ' + lim.nodes + ' joints and heads.');
      return;
    }
    if (item.depth + 1 > lim.depth) {
      toast('Necks stop at ' + lim.depth + ' deep here. Try lower down.');
      return;
    }
    pushHistory();
    state.stamp++;
    state.body = H.sprout(state.body, item.path, item.copies, state.stamp);
    state.trail = [H.ordinalOf(state.body)];
    relayout(true);
    toast('');
    updateAll(true);
  }

  // Takes back `steps` steps (quick Undo clicks add up; see request) in one change of the picture.
  function undo(steps = 1) {
    stopAuto();
    let s = null;
    for (let i = 0; i < steps && state.history.length; i++) s = state.history.pop();
    if (!s) return;
    restore(s);
    relayout(false);
    toast(state.mode === 'grow' ? '' : 'Undone.');
    updateAll(state.mode === 'grow');
  }

  /* ------------------------------------------------------------------ */
  /* Hercules plays                                                      */
  /* ------------------------------------------------------------------ */

  function startAuto(which) {
    if (state.auto && state.auto.which === which) {
      stopAuto();
      return;
    }
    stopAuto();
    if (state.mode !== 'play' || !state.body.g.length) return;
    const speed = Number($('speed').value);
    const a = { which, speed, stopped: false };
    state.auto = a;
    if (speed > 0 && speed <= SAFE.MAX_TWEENED_RATE) {
      // One animated cut every 1000 / speed ms, and never sooner than the gate allows.
      const step = () => {
        if (a.stopped) return;
        if (!gateFree()) {
          a.timer = setTimeout(step, Math.max(20, Math.ceil(gateWait()) + 1));
          return;
        }
        const p = H.pick(state.body, which);
        cutAt(p.path, p.copies, true);
        if (!a.stopped) a.timer = setTimeout(step, 1000 / speed);
      };
      step();
    } else {
      pushHistory();
      a.alpha = H.ordinalOf(state.body);
      a.n = BigInt(state.n);
      a.cuts = BigInt(state.cuts);
      a.t0 = performance.now();
      a.done = 0;
      a.snaps = 0;
      state.trailSampled = true;
      const frame = (now) => {
        if (a.stopped) return;
        const target = speed > 0 ? Math.floor(((now - a.t0) / 1000) * speed) - a.done : Infinity;
        const tEnd = performance.now() + 9;
        let k = 0;
        const pickPath = which === 'slow' ? H.smallestPath : H.largestPath;
        while (a.alpha.length && k < target) {
          a.alpha = H.cnfCut(a.alpha, pickPath(a.alpha), a.n);
          a.n++;
          k++;
          if ((k & 31) === 0 && performance.now() > tEnd) break;
        }
        a.done += k;
        a.cuts += BigInt(k);
        const dead = !a.alpha.length;
        // A snapshot replaces the picture and the numbers together, through the gate.
        if (gateFree() && (a.done > a.shownDone || dead)) {
          a.shownDone = a.done;
          a.snaps++;
          state.n = Number(a.n);
          state.cuts = Number(a.cuts);
          state.last = null;
          updateMeters(a.alpha);
          state.body = H.fromOrdinal(a.alpha);
          state.trail.push(a.alpha);
          if (state.trail.length > 400) state.trail.splice(1, state.trail.length - 400);
          relayout(false);
          updateClock();
          updateTrail();
          if (dead) {
            stopAuto();
            toast(deathMessage());
            updateAll(false);
            return;
          }
        }
        a.raf = requestAnimationFrame(frame);
      };
      a.shownDone = 0;
      a.raf = requestAnimationFrame(frame);
      toast(which === 'slow' ? 'Hercules takes the slow way: always the smallest part.' : 'Hercules takes the fast way: always the biggest part.');
    }
    updateAutoButtons();
    $('undo').disabled = !state.history.length;
    ringUpdate(); // the ring hides while Hercules plays, within its own limit
  }

  // Stopping never changes the picture: the hydra stays as last shown, and so do the counts.
  // (Cuts Hercules made after the last snapshot are dropped with it.)
  function stopAuto() {
    const a = state.auto;
    if (!a) return;
    a.stopped = true;
    clearTimeout(a.timer);
    if (a.raf) cancelAnimationFrame(a.raf);
    if (a.alpha && !a.snaps) state.history.pop(); // nothing was shown, so nothing to undo
    state.auto = null;
    ringUpdate();
    updateAutoButtons();
    updateAll(false);
  }

  function updateAutoButtons() {
    for (const id of ['autoFast', 'autoSlow']) {
      const b = $(id);
      const on = !!(state.auto && state.auto.which === b.dataset.which);
      // the class picks the face (see style.css): the label never changes the button's size
      b.classList.toggle('on', on);
      b.disabled = state.mode !== 'play' || !state.body.g.length;
    }
  }


  /* ------------------------------------------------------------------ */
  /* Facts about the current hydra                                       */
  /* ------------------------------------------------------------------ */

  const factsCache = new Map();

  function computeFacts(a) {
    const key = H.str(a);
    if (factsCache.has(key)) return factsCache.get(key);
    const preset = H.PRESETS.find((p) => H.str(H.ordinalOf(H.fromSpec(p.spec))) === key);
    const f = { key, min: null, max: null, minChecked: false, maxChecked: false, fast: null, slow: null, preset: preset ? preset.id : null };
    try {
      f.fast = H.fastWay(a, 1, 20000, 60);
    } catch (e) {
      f.fast = { kind: 'atLeast', value: 0n };
    }
    try {
      f.slow = H.slowWay(a, { ms: 40 });
    } catch (e) {
      f.slow = { kind: 'unknown' };
    }
    if (preset && preset.claims.fastest !== undefined) {
      f.min = preset.claims.fastest;
      f.minChecked = true;
    } else {
      const m = H.fewestCuts(a, 1, 20000, 80);
      if (m !== null) {
        f.min = m;
        f.minChecked = true;
      }
    }
    if (preset && preset.claims.slowest !== undefined) {
      f.max = preset.claims.slowest;
      f.maxChecked = true;
    } else if (f.slow.kind === 'exact' && f.slow.value <= 3000n) {
      const m = H.mostCuts(a, 1, 20000, 80);
      if (m !== null) {
        f.max = m;
        f.maxChecked = true;
      }
    }
    factsCache.set(key, f);
    return f;
  }

  function currentFacts() {
    const start = state.trail.length ? state.trail[0] : H.ordinalOf(state.body);
    if (!start.length) return null;
    return computeFacts(start);
  }

  let factsTimer = 0;
  function updateFacts(soon) {
    const box = $('facts');
    const start = state.trail.length ? state.trail[0] : H.ordinalOf(state.body);
    if (!start.length) {
      box.innerHTML = '<h2>This hydra</h2><p class="you">No heads, nothing to fight. Grow one.</p>';
      return;
    }
    const key = H.str(start);
    if (!factsCache.has(key)) {
      box.innerHTML = '<h2>This hydra, starting from <span class="math">' + H.html(start, { maxTerms: 3 }) + '</span></h2><p class="you">Counting…</p>';
      clearTimeout(factsTimer);
      factsTimer = setTimeout(() => {
        computeFacts(start);
        updateFacts(false);
      }, soon ? 30 : 120);
      return;
    }
    const f = factsCache.get(key);
    let h = '<h2>This hydra, starting from <span class="math">' + H.html(start, { maxTerms: 3 }) + '</span></h2><dl>';
    if (f.min !== null) {
      h += '<dt>Fastest possible</dt><dd>' + fmtCount(f.min) + ' ' + plural(f.min, 'cut', 'cuts') + '<small>every order of cuts checked' + (f.fast.kind === 'exact' && f.fast.value === f.min ? '; the fast way gets it' : '') + '</small></dd>';
    } else if (f.fast.kind === 'exact') {
      h += '<dt>Fast way</dt><dd>' + fmtCount(f.fast.value) + ' ' + plural(f.fast.value, 'cut', 'cuts') + '<small>always cutting in the biggest part</small></dd>';
    } else {
      h += '<dt>Fast way</dt><dd>more than ' + fmtCount(f.fast.value) + ' cuts<small>the page stopped counting</small></dd>';
    }
    if (f.max !== null) {
      h += '<dt>Slowest possible</dt><dd>' + fmtCount(f.max) + ' ' + plural(f.max, 'cut', 'cuts') + '<small>every order of cuts checked' + (f.slow.kind === 'exact' && f.slow.value === f.max ? '; the slow way gets it' : '') + '</small></dd>';
    } else if (f.slow.kind === 'exact') {
      h += '<dt>Slow way</dt><dd>' + fmtCount(f.slow.value) + ' ' + plural(f.slow.value, 'cut', 'cuts') + '<small>always cutting in the smallest part</small></dd>';
    } else if (f.slow.kind === 'floor') {
      h += '<dt>Slow way</dt><dd>' + floorText(f.slow) + ' cuts<small>a floor: the true count is bigger' + (f.slow.arrows === 3 && f.slow.height >= 4n ? '; 2↑↑↑4 is already a tower of 65,536 twos' : '') + '</small></dd>';
    } else {
      h += '<dt>Slow way</dt><dd>finite<small>too long for this page to put a number or a floor on</small></dd>';
    }
    h += '</dl>';
    if (state.mode === 'play') {
      if (!state.body.g.length) h += '<p class="you">You: dead in <b>' + fmtCount(BigInt(state.cuts)) + '</b> ' + plural(state.cuts, 'cut', 'cuts') + '.</p>';
      else h += '<p class="you">Every order of cuts ends. The clock is the proof.</p>';
    } else {
      h += '<p class="you">Whatever you grow, it dies. ' + H.fmtBig(H.countNodes(state.body)) + ' of ' + H.GROW_LIMITS.nodes + ' joints and heads used.</p>';
    }
    box.innerHTML = h;
  }

  /* ------------------------------------------------------------------ */
  /* Text panels                                                         */
  /* ------------------------------------------------------------------ */

  function updateMeters(alpha) {
    const heads = alpha ? H.cnfHeads(alpha) : H.heads(state.body);
    $('mCuts').textContent = fmtShort(BigInt(state.cuts));
    $('mHeads').textContent = fmtShort(heads);
    const dead = alpha ? !alpha.length : !state.body.g.length;
    $('mNext').textContent = state.mode === 'grow' ? '—' : dead ? '—' : '×' + fmtShort(BigInt(state.n));
    if (alpha) {
      $('clock').innerHTML = H.html(alpha, { maxTerms: 4 });
      $('hudClock').innerHTML = H.html(alpha, { maxTerms: 3 });
    }
    $('hudHeads').textContent = fmtShort(heads) + ' ' + plural(heads, 'head', 'heads');
  }

  function hudShown() {
    return getComputedStyle($('hud')).display !== 'none';
  }

  function fmtShort(v) {
    return H.fmtBig(v, { exactDigits: 7 });
  }

  function updateClock() {
    const now = H.ordinalOf(state.body);
    $('clock').innerHTML = H.html(now, { maxTerms: 4 });
    $('hudClock').innerHTML = H.html(now, { maxTerms: 3 });
    const was = $('was');
    const why = $('whyLine');
    const L = state.last;
    if (state.mode === 'grow') {
      was.textContent = 'Growing a head adds to the clock. Cutting one always takes away.';
      why.textContent = '';
    } else if (state.auto && state.auto.alpha) {
      was.innerHTML = 'Still going down, at every cut, while the heads come and go.';
      why.textContent = '';
    } else if (L) {
      was.innerHTML = 'Before cut ' + L.n + ': <span class="math">' + H.html(L.before, { maxTerms: 3 }) + '</span> <span class="down">&gt;</span> now.';
      if (L.grew > 0n) {
        const b = L.beta;
        const b1 = H.fromTerms(b.concat([[H.ZERO, 1n]]));
        why.innerHTML =
          'Where it regrew, the term <span class="math">' + powHtml(b1, 1n) + '</span> became <span class="math">' + powHtml(b, L.grew + 1n) + '</span>' +
          (b.length ? ', and <span class="math">' + powHtml(b, 1n) + '·ω</span> beats <span class="math">' + powHtml(b, 1n) + '</span> times any number.' : ': ω beats every number.');
      } else {
        why.innerHTML = 'A head straight off the body: the clock just loses 1.';
      }
    } else {
      was.textContent = 'It goes down at every cut. Nothing else in the game does.';
      why.textContent = '';
    }
  }

  function updateTrail() {
    const t = state.trail;
    const show = t.slice(-9);
    let h = '';
    if (t.length > show.length) h += '<span class="ell">…</span><span class="gt">&gt;</span>';
    h += show.map((a, i) => '<span' + (i === show.length - 1 ? ' class="now"' : '') + '>' + H.html(a, { maxTerms: 3 }) + '</span>').join('<span class="gt">&gt;</span>');
    if (state.trailSampled) h += ' <span class="lbl">(while Hercules plays fast, sampled twice a second)</span>';
    $('trail').innerHTML = h;
  }

  function updateAll(soon) {
    updateMeters(null);
    updateClock();
    updateTrail();
    updateFacts(soon);
    updateAutoButtons();
    $('undo').disabled = !state.history.length;
    $('growUndo').disabled = !state.history.length;
    canvas.setAttribute('aria-label', 'A hydra with ' + H.heads(state.body) + ' heads. Its clock reads ' + H.plain(H.ordinalOf(state.body)) + '. Use the arrow keys to pick a head and Enter to ' + (state.mode === 'grow' ? 'grow a new head there.' : 'cut it.'));
  }

  let toastTimer = 0;
  function toast(msg) {
    clearTimeout(toastTimer);
    $('toast').textContent = msg || '';
  }

  /* ------------------------------------------------------------------ */
  /* Layout, animation, drawing                                          */
  /* ------------------------------------------------------------------ */

  let currentLayout = null;
  let anim = null;
  const snap = document.createElement('canvas');
  const snapCtx = snap.getContext('2d');
  let W = 360;
  let HT = 360;
  let dpr = 1;

  function sizeCanvas() {
    const r = stage.getBoundingClientRect();
    W = Math.max(200, Math.round(r.width));
    HT = Math.max(200, Math.round(r.height));
    dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(HT * dpr);
  }

  // Replaces the picture. Every caller is a gate request or Hercules after gateFree(), except
  // a resize of the stage, which redraws the same hydra at its new size (resize = true).
  function relayout(animate, resize) {
    if (!resize) markChange();
    const prev = currentLayout;
    currentLayout = H.layout(state.body, { width: W, height: HT, padX: W < 500 ? 14 : 24, padTop: W < 500 ? 88 : 68, padBottom: hudShown() ? 60 : 46, minSlot: W < 500 ? 17 : 22, maxLevel: 165 });
    currentLayout.byKey = new Map(currentLayout.items.map((it) => [it.key, it]));
    if (state.sel >= headsList().length) state.sel = -1;
    if (!resize) ringSync(); // the ring moves with the picture, and that counts as its move
    if (animate && prev && !reduceMotion.matches) {
      // keep exactly what is on screen now, to fade from
      snap.width = canvas.width;
      snap.height = canvas.height;
      snapCtx.drawImage(canvas, 0, 0);
      anim = { t0: performance.now(), from: prev.byKey };
      requestAnimationFrame(tick);
    } else {
      anim = null;
      draw();
    }
  }

  function tick(now) {
    if (!anim) return;
    draw(now);
    if (anim && now - anim.t0 < SAFE.TWEEN_MS) requestAnimationFrame(tick);
    else {
      anim = null;
      draw();
    }
  }

  function ease(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function colors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    return { neck: v('--neck'), head: v('--head'), eye: v('--eye'), body: v('--body'), fresh: v('--fresh'), ring: v('--ring'), badge: v('--badge'), badgeInk: v('--badge-ink'), label: v('--label'), ground: v('--ground'), stage: v('--stage') };
  }

  /*
   * How a cut is shown. The new picture is drawn in full, with the regrown necks growing
   * out of the joint below them along their own curves, and the picture from just before
   * the cut is laid over it, fading out over TWEEN_MS. Nothing sweeps across the picture,
   * but it is not a pure pixel-by-pixel fade: the growing necks are redrawn every frame and
   * the growing heads' eyes move outward, so a few edge pixels change direction several times
   * within one cut. ui.test.mjs measures them (a few hundred px² at most, a few per cent of
   * WCAG's area limit). The gate keeps cuts 1000 / PICTURE_HZ ms apart, longer than one fade.
   */
  function frameItems(now) {
    const L = currentLayout;
    const e = anim ? ease(Math.min(1, ((now || performance.now()) - anim.t0) / SAFE.TWEEN_MS)) : 1;
    const out = L.items.map((it) => ({ it, x: it.x, y: it.y, grow: anim && !anim.from.has(it.key) ? e : 1 }));
    return { out, e };
  }

  function draw(now) {
    const L = currentLayout;
    if (!L) return;
    const C = colors();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = C.stage;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { out, e } = frameItems(now);
    const slot = L.slot;
    const headR = Math.max(4, Math.min(15, slot * 0.34));
    const neckW = (d) => Math.max(1.5, Math.min(10, slot * 0.5) - 1.4 * (d - 1));
    const body = L.items[0];
    const bodyW = Math.min(150, Math.max(90, W * 0.28));
    const bodyH = 34;
    const isFresh = (it) => it.fresh && it.fresh === state.stamp && !state.quietFresh;
    const anchor = (px, py, cx) => (px === body.x && py === body.y ? [body.x + Math.max(-bodyW * 0.36, Math.min(bodyW * 0.36, (cx - body.x) * 0.5)), body.y - bodyH * 0.25] : [px, py]);

    // ground
    ctx.fillStyle = C.ground;
    ctx.fillRect(0, body.y + bodyH * 0.35, W, HT);

    // necks
    ctx.lineCap = 'round';
    for (const d of out) {
      const it = d.it;
      if (!it.parentKey) continue;
      const p = L.byKey.get(it.parentKey);
      const col = isFresh(it) ? C.fresh : C.neck;
      const w = neckW(it.depth);
      const [ax, ay] = anchor(p.x, p.y, d.x);
      if (it.badge) {
        ctx.globalAlpha = 0.35;
        for (const off of [-4, 4]) neckPath(ax, ay, d.x + off, d.y + 3, w * 0.8, col, d.grow);
        ctx.globalAlpha = 1;
      }
      neckPath(ax, ay, d.x, d.y, w, col, d.grow);
    }

    // body
    ctx.fillStyle = C.body;
    ctx.beginPath();
    ctx.ellipse(body.x, body.y, bodyW / 2, bodyH / 2, 0, Math.PI, 2 * Math.PI);
    ctx.lineTo(body.x + bodyW / 2, body.y + bodyH * 0.35);
    ctx.lineTo(body.x - bodyW / 2, body.y + bodyH * 0.35);
    ctx.closePath();
    ctx.fill();

    // joints
    for (const d of out) {
      if (d.it.kind !== 'joint' || d.grow < 1) continue;
      ctx.fillStyle = isFresh(d.it) ? C.fresh : C.neck;
      ctx.beginPath();
      ctx.arc(d.x, d.y, neckW(d.it.depth) * 0.5 + 1.5, 0, 2 * Math.PI);
      ctx.fill();
    }

    // heads
    // (In Grow your own the selection counts joints and the body too; that ring is drawn below.)
    const heads = headsList();
    const play = state.mode === 'play';
    const selKey = play && ring.sel >= 0 && heads[ring.sel] ? heads[ring.sel].key : null;
    for (const d of out) {
      const it = d.it;
      if (it.kind !== 'head') continue;
      const r = headR * d.grow;
      if (r >= 0.5) {
        ctx.fillStyle = isFresh(it) ? C.fresh : C.head;
        ctx.beginPath();
        ctx.arc(d.x, d.y, r, 0, 2 * Math.PI);
        ctx.fill();
      }
      if (r >= 6) {
        ctx.fillStyle = C.eye;
        for (const sx of [-1, 1]) {
          ctx.beginPath();
          ctx.arc(d.x + sx * r * 0.36, d.y - r * 0.12, Math.max(1.2, r * 0.16), 0, 2 * Math.PI);
          ctx.fill();
        }
      }
      if (((play && ring.hover === it.key) || selKey === it.key) && !ring.hidden) {
        // full size from the first frame even round a growing head, so the ring doesn't move
        ctx.strokeStyle = C.ring;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(d.x, d.y, headR + 4, 0, 2 * Math.PI);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // grow mode: ring the joint or the body that a tap would grow from
    if (state.mode === 'grow') {
      const all = growTargets();
      const k = ring.hover || (ring.sel >= 0 && all[ring.sel] ? all[ring.sel].key : null);
      const it = k && L.byKey.get(k);
      if (it) {
        ctx.strokeStyle = C.ring;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        if (it.kind === 'body') ctx.ellipse(it.x, it.y - 4, bodyW / 2 + 5, bodyH / 2 + 5, 0, Math.PI, 2 * Math.PI);
        else if (it.kind === 'joint') ctx.arc(it.x, it.y, neckW(it.depth) * 0.5 + 6, 0, 2 * Math.PI);
        else ctx.arc(it.x, it.y, headR + 4, 0, 2 * Math.PI);
        ctx.stroke();
      }
    }

    // badges for bundles of identical necks
    {
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const placed = [];
      for (const it of L.items) {
        if (!it.badge) continue;
        const p = L.byKey.get(it.parentKey);
        const txt = '×' + H.fmtBig(it.badge, { exactDigits: 6 });
        const tw = ctx.measureText(txt).width + 8;
        const x = Math.max(tw / 2 + 2, Math.min(W - tw / 2 - 2, (it.x + p.x) / 2));
        const y = (it.y + p.y) / 2;
        // skip a badge that would overlap one already drawn
        if (placed.some((b) => Math.abs(b.x - x) < (b.w + tw) / 2 + 2 && Math.abs(b.y - y) < 18)) continue;
        placed.push({ x, y, w: tw });
        ctx.fillStyle = C.badge;
        roundRect(x - tw / 2, y - 8, tw, 16, 8);
        ctx.fill();
        ctx.fillStyle = C.badgeInk;
        ctx.fillText(txt, x, y + 0.5);
      }
    }

    // every joint's clock
    if (state.labels) {
      ctx.font = '13px ' + getComputedStyle(document.documentElement).getPropertyValue('--math');
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';
      for (const it of L.items) {
        if (it.kind === 'head') continue;
        if (it.kind === 'joint' && slot < 26 && it.depth > 1) continue;
        const node = nodeAt(it.path);
        const txt = H.plain(H.ordinalOf(node), { maxTerms: 2 });
        const x = it.kind === 'body' ? it.x + bodyW / 2 + 6 : it.x + 8;
        const y = it.kind === 'body' ? it.y + 2 : it.y - 6;
        const tw = ctx.measureText(txt).width;
        const tx = Math.min(x, W - tw - 4);
        ctx.fillStyle = C.stage;
        ctx.globalAlpha = 0.8;
        ctx.fillRect(tx - 2, y - 13, tw + 4, 17);
        ctx.globalAlpha = 1;
        ctx.fillStyle = C.label;
        ctx.fillText(txt, tx, y);
      }
    }

    // the picture from before the cut, fading out on top
    if (anim) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1 - e;
      ctx.drawImage(snap, 0, 0);
      ctx.globalAlpha = 1;
    }
  }

  // A neck: a cubic from the joint below to the joint above. With f < 1, only the first
  // fraction f of it (split by de Casteljau), so a growing neck traces the same curve further
  // each frame (its anti-aliased edges are redrawn each time, so they can shimmer slightly).
  function neckPath(px, py, cx, cy, w, col, f) {
    const dy = py - cy;
    let p1x = px;
    let p1y = py - dy * 0.55;
    let p2x = cx;
    let p2y = cy + dy * 0.45;
    let ex = cx;
    let ey = cy;
    const t = f === undefined ? 1 : Math.max(0, Math.min(1, f));
    if (t <= 0) return;
    if (t < 1) {
      const lerp = (a, b) => a + (b - a) * t;
      const ax = lerp(px, p1x), ay = lerp(py, p1y);
      const bx = lerp(p1x, p2x), by = lerp(p1y, p2y);
      const cx2 = lerp(p2x, cx), cy2 = lerp(p2y, cy);
      const dx = lerp(ax, bx), dy2 = lerp(ay, by);
      const ex2 = lerp(bx, cx2), ey2 = lerp(by, cy2);
      ex = lerp(dx, ex2);
      ey = lerp(dy2, ey2);
      p1x = ax;
      p1y = ay;
      p2x = dx;
      p2y = dy2;
    }
    ctx.strokeStyle = col;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.bezierCurveTo(p1x, p1y, p2x, p2y, ex, ey);
    ctx.stroke();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function nodeAt(path) {
    let t = state.body;
    for (const i of path) t = t.g[i].t;
    return t;
  }

  function headsList() {
    return currentLayout ? currentLayout.items.filter((it) => it.kind === 'head') : [];
  }

  function growTargets() {
    return currentLayout ? currentLayout.items.slice() : [];
  }

  /* ------------------------------------------------------------------ */
  /* Input                                                               */
  /* ------------------------------------------------------------------ */

  function pointAt(ev) {
    const r = canvas.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }

  function nearest(p, kinds, maxD) {
    let best = null;
    let bd = maxD * maxD;
    for (const it of currentLayout.items) {
      if (!kinds.includes(it.kind)) continue;
      let dx = it.x - p.x;
      let dy = it.y - p.y;
      if (it.kind === 'body') dy = Math.max(0, Math.abs(dy) - 14);
      if (it.kind === 'body') dx = Math.max(0, Math.abs(dx) - 50);
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = it;
      }
    }
    return best;
  }

  function hitRadius() {
    return Math.max(24, Math.min(40, (currentLayout ? currentLayout.slot : 30) * 0.9));
  }

  let down = null;
  canvas.addEventListener('pointerdown', (ev) => {
    down = { p: pointAt(ev), t: performance.now() };
  });
  canvas.addEventListener('pointerup', (ev) => {
    if (!down) return;
    const p = pointAt(ev);
    const moved = Math.hypot(p.x - down.p.x, p.y - down.p.y);
    down = null;
    if (moved > 12) return;
    act(p);
  });
  canvas.addEventListener('pointercancel', () => {
    down = null;
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (ev.pointerType !== 'mouse' || !currentLayout) return;
    const p = pointAt(ev);
    const it = state.mode === 'grow' ? nearest(p, ['body', 'joint', 'head'], 60) : nearest(p, ['head'], hitRadius());
    const k = it ? it.key : null;
    if (k !== state.hover) {
      state.hover = k;
      ringUpdate();
    }
  });
  canvas.addEventListener('pointerleave', () => {
    if (state.hover) {
      state.hover = null;
      ringUpdate();
    }
  });

  // A cut or a sprout aimed at the hydra on screen now. It goes through the gate, so it may
  // wait up to 1000 / PICTURE_HZ ms; it is dropped if the hydra has changed by then (an Undo
  // or a new hydra asked for just before it went first).
  function move(fn) {
    const body = state.body;
    const mode = state.mode;
    request('move', () => {
      if (state.body === body && state.mode === mode && !state.auto) fn();
    });
  }

  function act(p) {
    if (!currentLayout) return;
    if (state.mode === 'grow') {
      const it = nearest(p, ['body', 'joint', 'head'], 60) || currentLayout.items[0];
      move(() => sproutAt(it));
      return;
    }
    // A tap takes over from Hercules, and from a start of Hercules still waiting at the gate.
    stopAuto();
    cancel('now');
    if (!state.body.g.length) {
      toast(deathMessage() + ' Start over, or pick another.');
      return;
    }
    const it = nearest(p, ['head'], hitRadius());
    if (!it) {
      toast('Tap a head (the round ends of the necks).');
      return;
    }
    move(() => cutAt(it.path, it.copies));
  }

  let lastArrow = -Infinity;
  canvas.addEventListener('keydown', (ev) => {
    if (!currentLayout) return;
    const list = state.mode === 'grow' ? growTargets() : headsList();
    if (!list.length) return;
    if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(ev.key)) {
      ev.preventDefault();
      // A held arrow moves the selection at most 4 times a second, so the selection doesn't
      // run ahead of the ring (which moves at most that often anyway; see ringUpdate).
      const t = performance.now();
      if (ev.repeat && t - lastArrow < 250) return;
      lastArrow = t;
      const d = ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : -1;
      state.sel = state.sel < 0 ? (d > 0 ? 0 : list.length - 1) : (state.sel + d + list.length) % list.length;
      state.hover = null;
      ringUpdate();
    } else if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      if (ev.repeat) return; // holding the key down cuts once
      if (state.auto || waiting('now')) {
        stopAuto(); // this key press only pauses
        cancel('now');
        return;
      }
      if (state.sel < 0) state.sel = 0;
      const it = list[state.sel];
      if (!it) return;
      if (state.mode === 'grow') move(() => sproutAt(it));
      else move(() => cutAt(it.path, it.copies));
    }
  });

  // Every button that changes the picture asks the gate. Stopping Hercules never changes it,
  // so that happens at once.
  for (const b of document.querySelectorAll('#presets button')) {
    b.addEventListener('click', () => {
      stopAuto();
      request('load', () => loadPreset(b.dataset.preset));
    });
  }
  // Undo takes back the newest thing asked for. A cut or sprout still waiting at the gate is
  // cancelled, which changes nothing on screen; otherwise a step is undone when the gate
  // allows, and quick clicks add up: three quick clicks undo three steps, the first at once
  // and the other two together half a second later.
  function undoClick() {
    stopAuto();
    if (waiting('move')) {
      cancel('move');
      toast(state.mode === 'grow' ? '' : 'Undone.');
      pump();
      return;
    }
    request('undo', undo);
  }
  for (const b of [$('undo'), $('growUndo')]) b.addEventListener('click', undoClick);
  // A held Enter repeats a button's click at the keyboard's repeat rate, often 30 times a
  // second. No button but Undo acts on a repeat, so a held Enter can't switch Hercules on and
  // off, or load a hydra or clear one over and over; it acts once. Undo goes on while Enter is
  // held, one step at the gate's pace (a repeat adds none while an undo is waiting), and stops
  // when the key is let go.
  document.addEventListener(
    'keydown',
    (ev) => {
      if (!ev.repeat || ev.key !== 'Enter' || !(ev.target instanceof Element) || !ev.target.closest('button')) return;
      ev.preventDefault();
      if (ev.target.closest('#undo, #growUndo') && !waiting('undo')) undoClick();
    },
    true
  );
  $('restart').addEventListener('click', () => {
    stopAuto();
    request('restart', () => {
      if (state.preset === 'grow' && state.grownFrom) {
        stopAuto();
        state.body = state.grownFrom;
        resetGame();
        relayout(false);
        toast('Same hydra, from the start.');
        updateAll(true);
      } else loadPreset(state.preset);
    });
  });
  $('growClear').addEventListener('click', () => {
    request('clear', () => {
      if (state.mode !== 'grow' || !state.body.g.length) return; // nothing to clear
      pushHistory();
      state.body = H.fromSpec([[]]);
      state.trail = [H.ordinalOf(state.body)];
      relayout(false);
      updateAll(true);
    });
  });
  $('growFight').addEventListener('click', () => {
    request('fight', () => {
      if (state.mode !== 'grow') return;
      state.mode = 'play';
      state.grownFrom = state.body;
      resetGame();
      $('playControls').classList.remove('hidden');
      $('growControls').classList.add('hidden');
      toast('Now cut it down. Start over brings this one back; Grow your own makes another.');
      relayout(false);
      updateAll(true);
    });
  });
  $('labels').addEventListener('change', () => {
    request('labels', () => {
      const on = $('labels').checked;
      if (on === state.labels) return;
      state.labels = on;
      markChange();
      if (!anim) draw();
    });
  });
  const autoClick = (which) => {
    if (state.auto && state.auto.which === which) stopAuto();
    else request('now', () => startAuto(which));
  };
  $('autoFast').addEventListener('click', () => autoClick('fast'));
  $('autoSlow').addEventListener('click', () => autoClick('slow'));
  $('speed').addEventListener('change', () => {
    if (state.auto) {
      const w = state.auto.which;
      stopAuto();
      request('now', () => startAuto(w));
    }
  });
  $('whyClock').addEventListener('click', () => {
    $('clockSection').scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'start' });
  });

  const ro = new ResizeObserver(() => {
    sizeCanvas();
    relayout(false, true);
  });
  ro.observe(stage);
  if (darkMode && darkMode.addEventListener) darkMode.addEventListener('change', () => draw());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopAuto();
  });

  // A small hook for the page's own tests: where things are drawn.
  window.__hydraDebug = {
    headPoint(i) {
      const hs = headsList();
      if (!hs.length) return null;
      const it = hs[Math.min(i, hs.length - 1)];
      const r = canvas.getBoundingClientRect();
      return { x: r.left + it.x, y: r.top + it.y };
    },
    anyPoint(i) {
      const all = currentLayout.items;
      const it = all[i % all.length];
      const r = canvas.getBoundingClientRect();
      return { x: r.left + it.x, y: r.top + it.y };
    },
    state: () => ({ n: state.n, cuts: state.cuts, heads: String(H.heads(state.body)), clock: H.str(H.ordinalOf(state.body)), trail: state.trail.map(H.str), mode: state.mode, auto: !!state.auto }),
    animating: () => !!anim,
    // when the picture was replaced (performance.now() ms); whether a new cut would show at once
    changes: () => gate.log.slice(),
    waiting: () => gate.queue.map((r) => r.kind),
    // the ring as drawn, and the one the mouse or keys have asked for
    ring: () => ({ shown: ring.hover, wanted: state.hover, sel: ring.sel, wantedSel: state.sel, hidden: ring.hidden }),
    ready: () => gateFree() && !anim,
  };

  sizeCanvas();
  loadPreset('stick');
})();
