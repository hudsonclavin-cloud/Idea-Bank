/* app.js — the page around autogram.js: the forge loop, the tally, the audit, the shelf. */
(function () {
  'use strict';

  var AG = window.Autogram;
  var ALPHA = AG.ALPHABET;
  var $ = function (id) { return document.getElementById(id); };
  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  var TIME_LIMIT_MS = 45000;      // give up (and show the nearest miss) after this long
  var FRAME_BUDGET_MS = 12;       // search time per animation frame
  var SWEEPS_PER_TURN = 120;      // sweeps each variant gets per round-robin turn

  // Openings that the forge has been seen to solve quickly with the default liberties.
  var SURPRISES = [
    { prefix: 'This sentence contains' },
    { prefix: 'This pangram lists', list: 'all' },
    { prefix: 'Look closely and you will see that I hold' },
    { prefix: 'Caveat lector: this line is built from' },
    { prefix: 'You are reading a sentence with' },
    { prefix: 'Somewhere in the Idea Bank, a sentence was forged from' },
    { prefix: 'Hello, world! I am made of' },
    { prefix: 'My grandmother always said that honest sentences are made of' },
    { prefix: 'A machine wrote me, and I am made of' },
    { prefix: 'No dictionary was harmed in the making of this sentence, which has' },
    { prefix: 'I am the only sentence on this page that knows it contains' },
    { prefix: 'Count them if you like: I have' },
    { prefix: 'This sentence contains', total: true },
    { prefix: 'Vowels, by my own count:', list: 'custom', custom: 'aeiou' },
    { prefix: 'Narcissus would love this line, which contains' },
    { prefix: 'Like a snake swallowing its tail, I contain' },
    { prefix: 'Every true sentence about itself is a small miracle; this one has' },
    { prefix: 'Here, in plain English, is everything I am made of:' }
  ];

  // Classic sentences for the audit panel. All three were checked by this page's own counter.
  var EXAMPLES = [
    {
      label: 'Lee Sallows’ pangram',
      text: 'This pangram contains four as, one b, two cs, one d, thirty es, six fs, five gs, seven hs, eleven is, one j, one k, two ls, two ms, eighteen ns, fifteen os, two ps, one q, five rs, twenty-seven ss, eighteen ts, two us, seven vs, eight ws, two xs, three ys, & one z.'
    },
    {
      label: '“This sentence employs…”',
      text: "This sentence employs two a's, two c's, two d's, twenty-eight e's, five f's, three g's, eight h's, eleven i's, three l's, two m's, thirteen n's, nine o's, two p's, five r's, twenty-five s's, twenty-three t's, six v's, ten w's, two x's, five y's, and one z."
    },
    {
      label: 'with a letter total',
      text: "This sentence contains one hundred and ninety-seven letters: four a's, one b, three c's, five d's, thirty-four e's, seven f's, one g, six h's, twelve i's, three l's, twenty-six n's, ten o's, ten r's, twenty-nine s's, nineteen t's, six u's, seven v's, four w's, four x's, five y's, and one z."
    },
    {
      label: 'a near miss',
      text: "Café déjà vu: this naïve sentence contains six a's, four c's, three d's, thirty-two e's, seven f's, three g's, nine h's, fourteen i's, two j's, one l, nineteen n's, eight o's, nine r's, twenty-six s's, eighteen t's, five u's, five v's, four w's, three x's, and three y's."
    }
  ];

  // ------------------------------------------------------------------ small helpers
  function storeGet(key, fallback) {
    try {
      var raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function storeSet(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode etc. */ }
  }
  function fmtInt(n) { return Math.round(n).toLocaleString('en-US'); }
  function fmtSecs(ms) { return (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + ' s'; }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function plural(n, one, many) { return n === 1 ? one : many; }
  function joinWords(list) {
    if (list.length < 2) return list.join('');
    return list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
  }
  function letterName(c) { return c === 'total' ? 'the total' : c; }

  function setStatus(text, kind) {
    var s = $('status');
    s.textContent = text;
    s.className = 'status' + (kind ? ' ' + kind : '');
  }

  // ------------------------------------------------------------------ the form
  function readForm() {
    var prefix = $('prefix').value.replace(/\s+/g, ' ').trim();
    var suffix = $('suffix').value.replace(/[\r\n]+/g, ' ');
    if (/^[A-Za-z0-9À-ɏ]/.test(suffix)) suffix = ' ' + suffix;
    var listInput = document.querySelector('input[name="list"]:checked');
    return {
      base: {
        prefix: prefix,
        suffix: suffix,
        list: listInput ? listInput.value : 'auto',
        custom: $('custom').value,
        total: $('total').checked,
        conj: 'and'
      },
      lib: { conj: $('libConj').checked, lone: $('libLone').checked }
    };
  }

  /** The exact wording first, then the variations the liberties allow. */
  function buildVariants(base, lib) {
    var conjs = lib.conj ? ['and', '&', ''] : ['and'];
    var lones = base.list === 'auto' && lib.lone ? [false, true] : [false];
    var out = [];
    lones.forEach(function (bonus) {
      conjs.forEach(function (conj) {
        var v = {};
        for (var k in base) v[k] = base[k];
        v.conj = conj;
        v.bonus = bonus;
        out.push(v);
      });
    });
    return out;
  }

  function syncCustomVisibility() {
    var mode = document.querySelector('input[name="list"]:checked');
    $('customWrap').hidden = !(mode && mode.value === 'custom');
  }

  function applyPreset(p) {
    $('prefix').value = p.prefix;
    var mode = p.list || 'auto';
    var radio = document.querySelector('input[name="list"][value="' + mode + '"]');
    if (radio) radio.checked = true;
    if (p.custom) $('custom').value = p.custom;
    $('total').checked = !!p.total;
    $('suffix').value = '.';
    syncCustomVisibility();
  }

  // ------------------------------------------------------------------ sentence rendering
  /**
   * Build the sentence as DOM: one span per segment, one span per letter inside, so claims
   * can be marked true/false and every occurrence of a letter can be lit up and numbered.
   * statusOf(seg) returns 'ok' | 'bad' | '' for claim segments.
   */
  function buildSentence(target, segs, statusOf) {
    var frag = document.createDocumentFragment();
    segs.forEach(function (seg) {
      var span = el('span', 'part part-' + seg.kind);
      if (seg.kind === 'item') span.dataset.claim = seg.letter;
      if (seg.kind === 'total') span.dataset.claim = 'total';
      if (seg.kind !== 'text') {
        var st = statusOf ? statusOf(seg) : '';
        if (st) span.classList.add(st);
      }
      appendLetters(span, seg.text);
      frag.appendChild(span);
    });
    target.textContent = '';
    target.appendChild(frag);
  }

  function appendLetters(parent, text) {
    var buf = '';
    // Iterate by code point so astral characters (emoji) stay whole.
    Array.from(text).forEach(function (ch) {
      var f = AG.foldLetters(ch);
      if (!f) { buf += ch; return; }
      if (buf) { parent.appendChild(document.createTextNode(buf)); buf = ''; }
      var s = el('span', 'ch', ch);
      s.dataset.l = f.split('').join(' ');
      parent.appendChild(s);
    });
    if (buf) parent.appendChild(document.createTextNode(buf));
  }

  /** Light up every occurrence of `letter` ('total' lights all letters) and number them. */
  function highlight(container, letter) {
    var chars = container.querySelectorAll('.ch');
    var k = 0, every = letter === 'total' ? 10 : 1, last = null;
    for (var i = 0; i < chars.length; i++) {
      var c = chars[i];
      var ls = c.dataset.l.split(' ');
      var hits = 0;
      for (var j = 0; j < ls.length; j++) if (letter === 'total' || ls[j] === letter) hits++;
      c.classList.remove('below');
      delete c.dataset.k;
      if (hits) {
        // Number every occurrence (every tenth when counting all letters); neighbours
        // alternate above and below the line so adjacent numbers do not collide.
        var before = k;
        k += hits;
        c.classList.add('hit');
        if (Math.floor(k / every) > Math.floor(before / every)) {
          c.dataset.k = String(every === 1 ? k : Math.floor(k / every) * every);
          if (last === i - 1 && !chars[i - 1].classList.contains('below')) c.classList.add('below');
          last = i;
        }
      } else {
        c.classList.remove('hit');
      }
    }
    if (letter === 'total' && k && chars.length) {
      // Always label the final letter so the total can be read off directly.
      for (i = chars.length - 1; i >= 0; i--) if (chars[i].classList.contains('hit')) { chars[i].dataset.k = String(k); break; }
    }
    var segs = container.querySelectorAll('[data-claim]');
    for (i = 0; i < segs.length; i++) segs[i].classList.toggle('sel', segs[i].dataset.claim === letter);
    return k;
  }

  // ------------------------------------------------------------------ app state
  var state = {
    mode: 'idle',          // 'idle' | 'searching' | 'solved' | 'missed'
    view: null,            // { spec, counts, total, actual, letterTotal } of what is on screen
    sel: null,             // selected letter or 'total'
    nudge: 0
  };

  var engine = {
    solvers: [],
    running: false,
    raf: 0,
    t0: 0,
    lastPaint: 0,
    key: '',
    seen: {},             // sentences already shown for this form, so "Find another" finds another
    repeats: 0
  };

  function randomSeed() {
    try {
      var a = new Uint32Array(1);
      window.crypto.getRandomValues(a);
      return a[0];
    } catch (e) {
      return (Math.random() * 4294967296) >>> 0;
    }
  }

  // ------------------------------------------------------------------ the forge loop
  function startForge() {
    stopLoop();
    var form = readForm();
    if (form.base.list === 'custom' && !AG.foldLetters(form.base.custom)) {
      setStatus('Name at least one letter to list, e.g. aeiou.', 'warn');
      return;
    }
    var specs = buildVariants(form.base, form.lib);
    var key = JSON.stringify(form.base);
    if (key !== engine.key) { engine.key = key; engine.seen = {}; }
    try {
      engine.solvers = specs.map(function (s) { return new AG.Solver(s, randomSeed()); });
    } catch (e) {
      setStatus('Could not start: ' + e.message, 'warn');
      return;
    }
    engine.lib = form.lib;
    engine.pending = null;
    engine.running = true;
    engine.repeats = 0;
    engine.t0 = performance.now();
    engine.lastTick = 0;
    engine.lastPaint = 0;
    state.mode = 'searching';
    state.sel = null;
    state.nudge = 0;
    $('go').textContent = 'Stop';
    $('go').classList.add('running');
    $('copy').disabled = true;
    $('another').disabled = true;
    $('seal').hidden = true;
    $('inspect').hidden = true;
    $('note').textContent = '';
    $('result').classList.remove('solved', 'missed');
    $('result').classList.add('searching');
    setStatus('Searching…');
    engine.raf = requestAnimationFrame(tick);
  }

  function stopLoop() {
    engine.running = false;
    if (engine.raf) cancelAnimationFrame(engine.raf);
    engine.raf = 0;
    $('go').textContent = 'Forge';
    $('go').classList.remove('running');
    $('result').classList.remove('searching');
  }

  function tried() {
    var n = 0;
    engine.solvers.forEach(function (s) { n += s.iterations; });
    return n;
  }

  function leader() {
    var best = engine.solvers[0];
    engine.solvers.forEach(function (s) { if (s.bestScore < best.bestScore) best = s; });
    return best;
  }

  /**
   * How many liberties a solution took: 1 for touching the final "and", 2 for lone letters.
   * minRank is the best a variant could still do (a lone-letter variant may find a sentence
   * that happens to need none).
   */
  function rankOf(s) {
    var r = s.spec.conj === 'and' ? 0 : 1;
    if (s.spec.bonus) {
      var c = s.claims('best');
      var own = AG.foldLetters(s.spec.prefix + s.spec.suffix);
      if (AG.loneLetters(s.spec, c.counts, c.total).some(function (l) { return own.indexOf(l) < 0; })) r += 2;
    }
    return r;
  }
  function minRank(s) { return s.spec.conj === 'and' ? 0 : 1; }

  function tick(now) {
    if (!engine.running) return;
    // Browsers pause animation frames in background tabs; do not count that time.
    if (engine.lastTick && now - engine.lastTick > 1000) {
      var gap = now - engine.lastTick;
      engine.t0 += gap;
      if (engine.pending) { engine.pending.at += gap; engine.pending.until += gap; }
    }
    engine.lastTick = now;
    var deadline = performance.now() + FRAME_BUDGET_MS;
    var pend = engine.pending;
    search:
    while (performance.now() < deadline) {
      var ran = 0;
      for (var i = 0; i < engine.solvers.length; i++) {
        var s = engine.solvers[i];
        if (s.parked || (pend && minRank(s) >= pend.rank)) continue;
        ran++;
        if (s.run(SWEEPS_PER_TURN)) {
          var c = s.claims('best');
          var text = AG.render(s.spec, c.counts, c.total);
          if (engine.seen[text]) { engine.repeats++; s.reject(); continue; }
          s.parked = true;
          var r = rankOf(s);
          if (!pend || r < pend.rank) {
            pend = engine.pending = { solver: s, rank: r, at: performance.now(), tried: tried() };
            // Give stricter variants a short grace period to find a sentence with fewer liberties.
            pend.until = pend.at + Math.min(4000, Math.max(1200, 0.75 * (pend.at - engine.t0)));
          }
          if (pend.rank === 0) break search;
        }
      }
      if (!ran) break;
    }
    var elapsed = performance.now() - engine.t0;
    if (pend) {
      var stillHoping = engine.solvers.some(function (x) { return !x.parked && minRank(x) < pend.rank; });
      if (pend.rank === 0 || !stillHoping || performance.now() > pend.until) { finish(pend.solver); return; }
    }
    if (elapsed > TIME_LIMIT_MS) { giveUp('timeout'); return; }
    if (now - engine.lastPaint > (reduceMotion ? 500 : 110)) {
      engine.lastPaint = now;
      paintSearch(elapsed);
    }
    engine.raf = requestAnimationFrame(tick);
  }

  function paintSearch(elapsed) {
    var s = leader();
    // Show the leading walker's live state: claims flicker as the search moves.
    var cur = s.claims('current');
    var counts = cur.counts;
    var actual = Array.prototype.slice.call(s.a);
    var view = { spec: s.spec, counts: counts, total: cur.total, actual: actual, letterTotal: s.sumA };
    paintView(view, function (i) { return s.isWrong(i); });
    var closest = Infinity;
    engine.solvers.forEach(function (x) { closest = Math.min(closest, x.bestErrors); });
    var msg = 'Searching… ' + fmtInt(tried()) + ' candidate sentences in ' + fmtSecs(elapsed) +
      ' · closest so far: ' + closest + ' false ' + plural(closest, 'claim', 'claims');
    if (engine.repeats) msg += ' · skipped ' + engine.repeats + ' already found';
    if (engine.pending) msg = 'Found a true sentence. Looking a moment longer for one that takes fewer liberties… (' + fmtInt(tried()) + ' tried)';
    setStatus(msg);
  }

  /** Paint sentence + tally. wrongFn(i) says whether claim i (26 = total) is false. */
  function paintView(view, wrongFn) {
    state.view = view;
    var segs = AG.renderSegments(view.spec, view.counts, view.total);
    buildSentence($('sentence'), segs, function (seg) {
      var i = seg.kind === 'total' ? 26 : ALPHA.indexOf(seg.letter);
      return wrongFn(i) ? 'bad' : 'ok';
    });
    paintTally(view, wrongFn);
  }

  function paintTally(view, wrongFn) {
    var box = $('tally');
    var listed = {};
    AG.listedLetters(view.spec, view.counts).forEach(function (i) { listed[i] = true; });
    if (box.children.length !== 26 + (view.spec.total ? 1 : 0)) {
      box.textContent = '';
      for (var i = 0; i < 26; i++) box.appendChild(makeCell(ALPHA[i]));
      if (view.spec.total) box.appendChild(makeCell('total'));
    }
    for (i = 0; i < box.children.length; i++) {
      var cell = box.children[i];
      var key = cell.dataset.claim;
      var idx = key === 'total' ? 26 : i;
      var claimed = idx === 26 ? view.total : view.counts[idx];
      var actual = idx === 26 ? view.letterTotal : view.actual[idx];
      var on = idx === 26 || !!listed[idx];
      // An unlisted letter that occurs is a fault only when the list should cover every letter.
      var bad = on ? wrongFn(idx) : (view.spec.list === 'auto' && actual > 0);
      cell.classList.toggle('off', !on && !bad);
      cell.classList.toggle('bad', !!bad);
      cell.classList.toggle('good', on && !bad);
      cell.classList.toggle('sel', state.sel === key);
      cell.querySelector('.n').textContent = on ? String(claimed) : '–';
      cell.querySelector('.r').textContent = bad ? 'is ' + actual : '';
      cell.setAttribute('aria-label', (key === 'total' ? 'total letters' : 'letter ' + key) + ': ' +
        (on ? 'claims ' + claimed + ', ' : 'not listed, ') + 'counted ' + actual);
    }
  }

  function makeCell(key) {
    var b = el('button', 'cell' + (key === 'total' ? ' total' : ''));
    b.type = 'button';
    b.dataset.claim = key;
    b.appendChild(el('span', 'l', key === 'total' ? 'all' : key));
    b.appendChild(el('span', 'n', ''));
    b.appendChild(el('span', 'r', ''));
    return b;
  }

  function finish(win) {
    stopLoop();
    var c = win.claims('best');
    var check = AG.verify(win.spec, c.counts, c.total); // independent re-count of the rendered text
    var view = { spec: win.spec, counts: c.counts, total: c.total, actual: Array.from(check.actual), letterTotal: check.letterTotal };
    state.mode = check.ok ? 'solved' : 'missed';
    var wrong = {};
    check.wrong.forEach(function (w) { wrong[w === 'total' ? 26 : ALPHA.indexOf(w)] = true; });
    paintView(view, function (i) { return !!wrong[i]; });
    var res = $('result');
    res.classList.add(check.ok ? 'solved' : 'missed');
    if (!check.ok) {
      // Should never happen; if it does, say so rather than pretend.
      setStatus('The search reported a solution but the re-count disagrees (' + check.wrong.join(', ') + '). Please try again.', 'warn');
      return;
    }
    engine.seen[check.sentence] = true;
    var p = engine.pending && engine.pending.solver === win ? engine.pending : { at: performance.now(), tried: tried() };
    setStatus('Found after ' + fmtSecs(p.at - engine.t0) + ' and ' + fmtInt(p.tried) + ' candidate sentences. Every claim checks out.', 'good');
    var seal = $('seal');
    seal.hidden = false;
    seal.classList.remove('stamp');
    if (!reduceMotion) { void seal.offsetWidth; seal.classList.add('stamp'); }
    $('note').innerHTML = '';
    $('note').appendChild(document.createTextNode('Tap any claim or letter tile to count it yourself.'));
    var libs = libertyNotes(win.spec, c);
    if (libs) {
      $('note').appendChild(document.createTextNode(' '));
      var b = el('b', '', libs);
      $('note').appendChild(b);
    }
    $('copy').disabled = false;
    $('another').disabled = false;
    addToShelf(check.sentence);
  }

  function libertyNotes(spec, c) {
    var notes = [];
    if (spec.conj === '&') notes.push('Liberty taken: “&” instead of “and”.');
    if (spec.conj === '') notes.push('Liberty taken: no “and” before the last item.');
    if (spec.list === 'auto') {
      var lone = AG.loneLetters(spec, c.counts, c.total).filter(function (l) {
        // A letter that also occurs in the user's own words is not lone in spirit.
        return AG.foldLetters(spec.prefix + spec.suffix).indexOf(l) < 0;
      });
      if (lone.length) {
        notes.push('Lone ' + plural(lone.length, 'letter', 'letters') + ' added: ' + joinWords(lone) +
          ' (each “one ' + lone[0] + '” is true because it is its own only ' + lone[0] + ').');
      }
    }
    return notes.join(' ');
  }

  function giveUp(why) {
    if (engine.pending) { finish(engine.pending.solver); return; }
    stopLoop();
    var s = leader();
    var c = s.claims('best');
    var check = AG.verify(s.spec, c.counts, c.total);
    // A strict search can be stopped holding a sentence whose only fault is a lone letter
    // ("one q"). That sentence is still true, so show it as found, with the lone letter noted.
    if (check.ok) { finish(s); return; }
    var view = { spec: s.spec, counts: c.counts, total: c.total, actual: Array.from(check.actual), letterTotal: check.letterTotal };
    var wrong = {};
    check.wrong.forEach(function (w) { wrong[w === 'total' ? 26 : ALPHA.indexOf(w)] = true; });
    state.mode = 'missed';
    paintView(view, function (i) { return !!wrong[i]; });
    $('result').classList.add('missed');
    var head = why === 'timeout' ? 'No true sentence turned up in ' + fmtSecs(TIME_LIMIT_MS) + '.' : 'Stopped.';
    if (engine.repeats && why === 'timeout') head = 'No new sentence turned up in ' + fmtSecs(TIME_LIMIT_MS) + '; this opening may have only the ones you have seen.';
    var n = check.wrong.length;
    var near = n ? ' Closest miss shown: ' + n + ' false ' + plural(n, 'claim', 'claims') + ' (' + check.wrong.map(letterName).join(', ') + ').' : '';
    setStatus(head + near, 'warn');
    $('note').textContent = n ? 'Change a word or two of the opening and forge again: one different word reshuffles every count. Tap a red claim to see how far off it is.' : '';
    $('copy').disabled = true; // a near miss is not worth spreading
    $('another').disabled = true;
  }

  // ------------------------------------------------------------------ inspecting a claim
  function select(key) {
    if (!state.view || state.mode === 'searching') return;
    state.sel = state.sel === key ? null : key;
    state.nudge = 0;
    renderInspect();
  }

  function renderInspect() {
    var box = $('inspect');
    var view = state.view;
    var sentenceBox = $('sentence');
    var tally = $('tally');
    for (var i = 0; i < tally.children.length; i++) tally.children[i].classList.toggle('sel', tally.children[i].dataset.claim === state.sel);
    if (!state.sel || !view) {
      highlight(sentenceBox, null);
      box.hidden = true;
      return;
    }
    var key = state.sel;
    var found = highlight(sentenceBox, key);
    var idx = key === 'total' ? 26 : ALPHA.indexOf(key);
    var listed = idx === 26 || AG.listedLetters(view.spec, view.counts).indexOf(idx) >= 0;
    var claimed = idx === 26 ? view.total : view.counts[idx];
    var ok = listed && claimed === found;
    box.hidden = false;
    box.className = 'inspect' + (listed && !ok ? ' bad' : '');
    box.textContent = '';

    var p1 = el('p');
    p1.appendChild(el('span', 'big', key === 'total' ? 'all letters' : key));
    if (!listed) {
      var why = view.spec.list === 'auto'
        ? (found ? ' is not listed, yet appears ' + found + ' ' + plural(found, 'time', 'times') + '.' : ' is not listed and does not appear.')
        : ' is not part of this inventory.';
      p1.appendChild(document.createTextNode(why));
      box.appendChild(p1);
      return;
    }
    p1.appendChild(document.createTextNode(' The sentence claims '));
    p1.appendChild(el('b', '', AG.numberWord(claimed, view.spec.hundredAnd)));
    p1.appendChild(document.createTextNode(key === 'total' ? '. Counting every letter (every tenth is numbered above): ' : '. Counting every one (numbered above): '));
    p1.appendChild(el('b', '', String(found)));
    p1.appendChild(document.createTextNode(ok ? '. ✓ True.' : '. ✗ Off by ' + Math.abs(found - claimed) + '.'));
    box.appendChild(p1);

    if (state.mode === 'solved') {
      box.appendChild(el('p', '', 'What if this one claim said one more, or one fewer?'));
      var p2 = el('p', 'nudges');
      var minus = el('button', 'btn small', '\u2212 one');
      minus.type = 'button';
      minus.disabled = claimed <= 1;
      minus.addEventListener('click', function () { state.nudge = -1; renderRipple(); });
      var plus = el('button', 'btn small', '+ one');
      plus.type = 'button';
      plus.addEventListener('click', function () { state.nudge = 1; renderRipple(); });
      p2.appendChild(minus);
      p2.appendChild(plus);
      box.appendChild(p2);
      var rip = el('div', 'ripple');
      rip.id = 'ripple';
      box.appendChild(rip);
      if (state.nudge) renderRipple();
    }
  }

  /** Change the selected claim by +-1 in a solved sentence and show what breaks. */
  function renderRipple() {
    var rip = $('ripple');
    var view = state.view;
    if (!rip || !view || !state.sel) return;
    var key = state.sel;
    var idx = key === 'total' ? 26 : ALPHA.indexOf(key);
    var counts = view.counts.slice();
    var total = view.total;
    var from = idx === 26 ? total : counts[idx];
    var to = Math.max(1, from + state.nudge);
    if (idx === 26) total = to; else counts[idx] = to;
    var check = AG.verify(view.spec, counts, total);
    var wrong = {};
    check.wrong.forEach(function (w) { wrong[w] = true; });
    rip.textContent = '';
    var lead = el('p');
    var newActual = idx === 26 ? check.letterTotal : check.actual[idx];
    var noun = key === 'total' ? 'letters' : (to === 1 ? key : key + '’s');
    var others = check.wrong.filter(function (w) { return w !== key; });
    var said = AG.numberWord(to, view.spec.hundredAnd) + ' ' + noun;
    lead.appendChild(document.createTextNode('Saying \u201c' + said + '\u201d would leave the sentence with '));
    lead.appendChild(el('b', '', String(newActual)));
    var tail = newActual === to ? ', so that claim would still be true' : ', so that claim would be false';
    if (others.length) {
      tail += (newActual === to ? ', but ' : ', and ') + others.length + ' other ' +
        plural(others.length, 'claim breaks', 'claims break') + ': ' + joinWords(others.map(letterName)) + '.';
    } else {
      tail += '. No other claim changes.';
    }
    lead.appendChild(document.createTextNode(tail));
    rip.appendChild(lead);
    var p = el('p', 'sentence');
    buildSentence(p, AG.renderSegments(view.spec, counts, total), function (seg) {
      var k = seg.kind === 'total' ? 'total' : seg.letter;
      return wrong[k] ? 'bad' : '';
    });
    rip.appendChild(p);
  }

  // ------------------------------------------------------------------ copy + shelf
  function copyText(text, button) {
    var done = function (ok) {
      var old = button.dataset.label || button.textContent;
      button.dataset.label = old;
      button.textContent = ok ? 'Copied' : 'Select & copy';
      setTimeout(function () { button.textContent = old; }, 1400);
    };
    try {
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(fallbackCopy(text)); });
        return;
      }
    } catch (e) { /* fall through */ }
    done(fallbackCopy(text));
  }

  function fallbackCopy(text) {
    var ta = el('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  var SHELF_KEY = 'autogram-forge:shelf';
  function addToShelf(sentence) {
    var list = storeGet(SHELF_KEY, []);
    if (!Array.isArray(list)) list = [];
    list = list.filter(function (s) { return s !== sentence; });
    list.unshift(sentence);
    storeSet(SHELF_KEY, list.slice(0, 12));
    paintShelf(list.slice(0, 12));
  }

  function paintShelf(list) {
    if (!list) list = storeGet(SHELF_KEY, []);
    if (!Array.isArray(list)) list = [];
    var ol = $('shelfList');
    ol.textContent = '';
    list.forEach(function (s, i) {
      if (typeof s !== 'string') return;
      var li = el('li');
      li.appendChild(el('span', 'txt', s));
      var audit = el('button', 'btn small ghost', 'Audit');
      audit.type = 'button';
      audit.addEventListener('click', function () { loadAudit(s, true); });
      var copy = el('button', 'btn small ghost', 'Copy');
      copy.type = 'button';
      copy.addEventListener('click', function () { copyText(s, copy); });
      li.appendChild(audit);
      li.appendChild(copy);
      ol.appendChild(li);
    });
    $('shelfEmpty').hidden = list.length > 0;
    $('clearShelf').hidden = list.length === 0;
  }

  // ------------------------------------------------------------------ audit
  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function runAudit() {
    var text = $('auditIn').value;
    var out = $('auditOut');
    var sum = $('auditSummary');
    if (!text.trim()) {
      out.textContent = '';
      sum.textContent = '';
      sum.className = 'audit-summary';
      return;
    }
    var r = AG.check(text);
    var marks = r.claims.map(function (c) { return { index: c.index, len: c.text.length, ok: c.n === c.actual, why: c.n === c.actual ? '✓' : 'is ' + c.actual }; })
      .concat(r.totals.map(function (c) { return { index: c.index, len: c.text.length, ok: c.n === c.actual, why: c.n === c.actual ? '✓' : 'is ' + c.actual }; }))
      .sort(function (a, b) { return a.index - b.index; });
    var html = '';
    var pos = 0;
    marks.forEach(function (m) {
      if (m.index < pos) return;
      html += escapeHtml(text.slice(pos, m.index));
      html += '<mark class="' + (m.ok ? 'ok' : 'bad') + '">' + escapeHtml(text.substr(m.index, m.len)) +
        '<span class="why">' + escapeHtml(m.why) + '</span></mark>';
      pos = m.index + m.len;
    });
    html += escapeHtml(text.slice(pos));
    out.innerHTML = html;

    var nClaims = r.claims.length + r.totals.length;
    var nWrong = r.wrong.length + r.wrongTotals.length;
    var msg;
    if (!nClaims) {
      msg = 'No letter-count claims found. Claims look like “three a’s” or “one z”.';
      sum.className = 'audit-summary';
    } else if (nWrong) {
      msg = nWrong + ' of ' + nClaims + ' ' + plural(nClaims, 'claim is', 'claims are') + ' false: ' +
        r.wrong.map(function (w) { return w.letter + ' (says ' + w.n + ', has ' + w.actual + ')'; })
          .concat(r.wrongTotals.map(function (w) { return 'total (says ' + w.n + ', has ' + w.actual + ')'; })).join('; ') + '.';
      sum.className = 'audit-summary warn';
    } else if (r.duplicates.length) {
      msg = 'Every claim is true, but ' + joinWords(r.duplicates) + ' ' + plural(r.duplicates.length, 'is', 'are') + ' claimed more than once.';
      sum.className = 'audit-summary warn';
    } else if (r.unlisted.length) {
      msg = 'All ' + nClaims + ' claims are true, but it never mentions ' + joinWords(r.unlisted) + ', so it is not a complete autogram.';
      sum.className = 'audit-summary';
    } else {
      msg = 'All ' + nClaims + ' claims are true and every letter present is accounted for: a complete autogram.';
      sum.className = 'audit-summary good';
    }
    sum.textContent = msg;
  }

  function loadAudit(text, scroll) {
    $('auditIn').value = text;
    runAudit();
    if (scroll) {
      try { $('auditIn').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' }); } catch (e) { /* old browsers */ }
    }
  }

  // ------------------------------------------------------------------ number-word stepper
  var step = { n: 27 };
  function paintStepper() {
    var a = AG.numberWord(step.n, true), b = AG.numberWord(step.n + 1, true);
    $('wordA').textContent = a;
    $('wordB').textContent = b;
    var ca = AG.countLetters(a), cb = AG.countLetters(b);
    var diff = $('diff');
    diff.textContent = '';
    var any = false;
    for (var i = 0; i < 26; i++) {
      var d = cb[i] - ca[i];
      if (!d) continue;
      any = true;
      diff.appendChild(el('span', 'chip ' + (d > 0 ? 'plus' : 'minus'), (d > 0 ? '+' : '−') + Math.abs(d) + ' ' + ALPHA[i]));
    }
    if (!any) diff.appendChild(el('span', 'chip', 'same letters'));
    $('stepDown').disabled = step.n <= 1;
    $('stepUp').disabled = step.n >= 998;
  }

  // ------------------------------------------------------------------ wiring
  function init() {
    if (!AG) { setStatus('autogram.js failed to load.', 'warn'); return; }

    $('go').addEventListener('click', function () {
      if (engine.running) giveUp('stopped'); else startForge();
    });
    $('surprise').addEventListener('click', function () {
      var cur = $('prefix').value;
      var pool = SURPRISES.filter(function (p) { return p.prefix !== cur; });
      applyPreset(pool[(Math.random() * pool.length) | 0]);
      startForge();
    });
    ['prefix', 'suffix', 'custom'].forEach(function (id) {
      $(id).addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
          e.preventDefault();
          if (!engine.running) startForge();
        }
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('input[name="list"]'), function (r) {
      r.addEventListener('change', syncCustomVisibility);
    });
    syncCustomVisibility();

    $('sentence').addEventListener('click', function (e) {
      var seg = e.target.closest && e.target.closest('[data-claim]');
      if (seg) select(seg.dataset.claim);
    });
    $('tally').addEventListener('click', function (e) {
      var cell = e.target.closest && e.target.closest('.cell');
      if (cell && !cell.classList.contains('off')) select(cell.dataset.claim);
    });
    $('copy').addEventListener('click', function () {
      if (state.view) copyText(AG.render(state.view.spec, state.view.counts, state.view.total), $('copy'));
    });
    $('another').addEventListener('click', startForge);

    var ex = $('examples');
    EXAMPLES.forEach(function (x) {
      var b = el('button', 'btn small', x.label);
      b.type = 'button';
      b.addEventListener('click', function () { loadAudit(x.text, false); });
      ex.appendChild(b);
    });
    var timer = 0;
    $('auditIn').addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(runAudit, 120);
    });
    loadAudit(EXAMPLES[0].text, false);

    $('stepDown').addEventListener('click', function () { step.n = Math.max(1, step.n - 1); paintStepper(); });
    $('stepUp').addEventListener('click', function () { step.n = Math.min(998, step.n + 1); paintStepper(); });
    paintStepper();

    $('clearShelf').addEventListener('click', function () {
      storeSet(SHELF_KEY, []);
      paintShelf([]);
    });
    paintShelf();

    // An empty tally so the layout does not jump when the first search starts.
    paintTally({ spec: AG.makeSpec({}), counts: new Array(26).fill(0), total: 0, actual: new Array(26).fill(0), letterTotal: 0 }, function () { return false; });
  }

  init();
})();
