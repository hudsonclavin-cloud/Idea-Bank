/* Minimus — renders the cycle from the embedded copy of poems.txt, checks that the
   line-endings ring Plain Bob Minimus, draws the blue line, and can ring the rows. */
(function () {
  'use strict';

  var WORDS = ['round', 'hand', 'still', 'home']; // treble, 2nd, 3rd, tenor
  var PLACE_NOTATION = ['x', '14', 'x', '14', 'x', '14', 'x', '12']; // one lead of Plain Bob Minimus
  var LEADS = 3;

  /* ---------- the method ---------- */
  function applyChange(row, change) {
    var out = row.slice();
    var i;
    if (change === 'x') {
      for (i = 0; i + 1 < row.length; i += 2) { out[i] = row[i + 1]; out[i + 1] = row[i]; }
      return out;
    }
    var stay = {};
    change.split('').forEach(function (d) { stay[Number(d)] = true; });
    i = 0;
    while (i < row.length) {
      if (stay[i + 1]) { i += 1; continue; }
      out[i] = row[i + 1]; out[i + 1] = row[i];
      i += 2;
    }
    return out;
  }
  function extent() {
    var rows = [[1, 2, 3, 4]];
    for (var l = 0; l < LEADS; l++) {
      for (var c = 0; c < PLACE_NOTATION.length; c++) rows.push(applyChange(rows[rows.length - 1], PLACE_NOTATION[c]));
    }
    return rows;
  }
  function isAdjacentSwapChange(a, b) {
    var j = 0;
    while (j < a.length) {
      if (a[j] === b[j]) { j += 1; continue; }
      if (j + 1 < a.length && a[j] === b[j + 1] && a[j + 1] === b[j]) { j += 2; continue; }
      return false;
    }
    return true;
  }

  /* ---------- the text ---------- */
  function parse(text) {
    var poems = [], cur = null, stanza = [], title = '';
    text.split('\n').forEach(function (raw) {
      var line = raw.replace(/\s+$/, '');
      if (line.indexOf('# ') === 0) { title = line.slice(2); return; }
      if (line.indexOf('## ') === 0) {
        if (stanza.length && cur) cur.stanzas.push(stanza);
        stanza = [];
        cur = { title: line.slice(3), stanzas: [] };
        poems.push(cur);
        return;
      }
      if (!line.trim()) { if (stanza.length && cur) { cur.stanzas.push(stanza); stanza = []; } return; }
      stanza.push(line);
    });
    if (stanza.length && cur) cur.stanzas.push(stanza);
    return { title: title, poems: poems };
  }
  // Last alphabetic token of the line, minus a possessive, lower-cased.
  function splitEnd(line) {
    var m = line.match(/^(.*?)([A-Za-z']+)([^A-Za-z']*)$/);
    if (!m) return { pre: line, word: '', post: '' };
    return { pre: m[1], word: m[2], post: m[3] };
  }
  function bellOf(word) {
    return WORDS.indexOf(word.toLowerCase().replace(/'s$/, '')) + 1; // 0 if not a bell
  }

  /* ---------- render ---------- */
  var src = document.getElementById('poems').textContent.replace(/^\n+|\n+$/g, '');
  var data = parse(src);
  var rows = extent();
  var stanzas = []; // { el, row, bells }
  var cycle = document.getElementById('cycle');
  var k = 0;
  data.poems.forEach(function (poem) {
    var sec = document.createElement('section');
    sec.className = 'poem';
    var h = document.createElement('h2');
    h.textContent = poem.title;
    sec.appendChild(h);
    poem.stanzas.forEach(function (lines) {
      var st = document.createElement('div');
      st.className = 'stanza';
      st.setAttribute('data-row', String(k + 1));
      var tag = document.createElement('span');
      tag.className = 'rowtag';
      var rowText = rows[k] ? rows[k].join('') : '?';
      tag.textContent = rowText;
      if (k > 0 && k % PLACE_NOTATION.length === 0) {
        var le = document.createElement('span');
        le.className = 'lead';
        le.textContent = k === LEADS * PLACE_NOTATION.length ? 'rounds' : 'lead end';
        tag.appendChild(le);
      }
      st.appendChild(tag);
      var bells = [];
      lines.forEach(function (line) {
        var p = document.createElement('p');
        p.className = 'line';
        var parts = splitEnd(line);
        var b = bellOf(parts.word);
        bells.push(b);
        p.appendChild(document.createTextNode(parts.pre));
        var span = document.createElement('span');
        span.className = 'bell' + (b ? ' bell-' + b : '');
        span.textContent = parts.word;
        p.appendChild(span);
        p.appendChild(document.createTextNode(parts.post));
        st.appendChild(p);
      });
      sec.appendChild(st);
      stanzas.push({ el: st, row: rows[k] || null, bells: bells, index: k });
      k += 1;
    });
    cycle.appendChild(sec);
  });

  /* ---------- fit the longest line to the measure ----------
     The lines are short enough for a 390 px phone in the fonts I could test; if the
     reader's serif is unusually wide, shrink the verse a little (never below 86%)
     before letting the hanging indent take over. */
  var allLines = stanzas.reduce(function (acc, s) {
    s.el.querySelectorAll('.line').forEach(function (p) { acc.push(p.textContent); });
    return acc;
  }, []);
  function fitMeasure() {
    var root = document.documentElement;
    root.style.removeProperty('--verse-scale');
    var probe = document.createElement('span');
    probe.className = 'line';
    probe.style.cssText = 'position:absolute;left:-99999px;top:0;visibility:hidden;white-space:nowrap;padding:0;text-indent:0;display:inline-block';
    document.body.appendChild(probe);
    var max = 0;
    allLines.forEach(function (t) {
      probe.textContent = t;
      var w = probe.getBoundingClientRect().width;
      if (w > max) max = w;
    });
    probe.parentNode.removeChild(probe);
    var avail = cycle.clientWidth;
    if (max > avail && avail > 0) root.style.setProperty('--verse-scale', String(Math.max(0.86, (avail / max) * 0.995)));
  }
  fitMeasure();
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(fitMeasure, 150);
  });

  /* ---------- check ---------- */
  function check() {
    var problems = [];
    var n = rows.length; // 25
    if (stanzas.length !== n) problems.push('expected ' + n + ' stanzas, found ' + stanzas.length);
    var seen = {};
    stanzas.forEach(function (s, i) {
      if (s.bells.length !== 4) problems.push('stanza ' + (i + 1) + ' has ' + s.bells.length + ' lines');
      if (!s.row) return;
      if (s.bells.join('') !== s.row.join('')) problems.push('stanza ' + (i + 1) + ' ends ' + s.bells.join('') + ', the method wants ' + s.row.join(''));
      if (i < n - 1) {
        if (seen[s.bells.join('')]) problems.push('row ' + s.bells.join('') + ' repeats at stanza ' + (i + 1));
        seen[s.bells.join('')] = true;
      }
      if (i > 0 && !isAdjacentSwapChange(stanzas[i - 1].bells, s.bells)) problems.push('stanza ' + (i + 1) + ' is not an adjacent swap of stanza ' + i);
    });
    var first = stanzas[0] && stanzas[0].bells.join('');
    var last = stanzas[n - 1] && stanzas[n - 1].bells.join('');
    if (first !== '1234') problems.push('does not start in rounds');
    if (last !== '1234') problems.push('does not come round');
    var box = document.getElementById('check');
    var distinct = Object.keys(seen).length;
    if (problems.length) {
      box.className = 'bad';
      box.innerHTML = '<span class="mark">✗</span>' + problems.map(function (p) { return escapeHtml(p); }).join('<br>');
    } else {
      box.className = 'good';
      box.innerHTML = '<span class="mark">✓</span>Checked in this browser just now: ' + stanzas.length + ' stanzas of four lines; the ' + (stanzas.length * 4) +
        ' line-endings are the ' + n + ' rows of Plain Bob Minimus (place notation ' + PLACE_NOTATION.join('.') + ', three leads); every change swaps only neighbouring bells; the ' + distinct + ' rows before the last are all different; the last is rounds.';
    }
    return problems.length === 0;
  }
  function escapeHtml(s) { return s.replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }

  /* ---------- blue line ---------- */
  function drawBlueLine() {
    var svg = document.getElementById('blueline');
    if (!svg) return;
    var NS = 'http://www.w3.org/2000/svg';
    var colX = [62, 140, 218, 296], rowH = 19, top = 14, left = 8, W = 384;
    var H = top + rowH * (stanzas.length - 1) + 14;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    function el(name, attrs, text) {
      var e = document.createElementNS(NS, name);
      Object.keys(attrs).forEach(function (a) { e.setAttribute(a, attrs[a]); });
      if (text != null) e.textContent = text;
      return e;
    }
    // lead-end rules
    for (var i = PLACE_NOTATION.length; i < stanzas.length - 1; i += PLACE_NOTATION.length) {
      var y = top + rowH * (i - 0.5);
      svg.appendChild(el('line', { 'class': 'leadrule', x1: left + 26, y1: y, x2: colX[3] + 26, y2: y }));
      svg.appendChild(el('text', { 'class': 'lead', x: W - 2, y: y + 3, 'text-anchor': 'end' }, 'lead end'));
    }
    var cursor = el('rect', { 'class': 'cursor', x: left + 22, y: -100, width: colX[3] + 30 - (left + 22), height: rowH - 2, rx: 3, opacity: 0 });
    svg.appendChild(cursor);
    // paths, one per bell
    for (var b = 1; b <= 4; b++) {
      var pts = stanzas.map(function (s, r) {
        var pos = s.bells.indexOf(b);
        return pos < 0 ? null : (colX[pos] + ',' + (top + rowH * r));
      }).filter(Boolean);
      svg.appendChild(el('polyline', { 'class': 'path path-' + b, points: pts.join(' ') }));
    }
    // words and row numbers
    stanzas.forEach(function (s, r) {
      var y = top + rowH * r;
      svg.appendChild(el('text', { 'class': 'rown', x: left + 14, y: y + 3.5, 'text-anchor': 'end' }, String(r + 1)));
      s.bells.forEach(function (b, pos) {
        svg.appendChild(el('text', { 'class': 'w-' + b, x: colX[pos], y: y + 3.5, 'text-anchor': 'middle' }, b ? WORDS[b - 1] : '?'));
      });
    });
    return function setCursor(r) {
      if (r == null) { cursor.setAttribute('opacity', '0'); return; }
      cursor.setAttribute('opacity', '1');
      cursor.setAttribute('y', top + rowH * r - rowH / 2 + 1);
    };
  }

  /* ---------- bells (sound) ---------- */
  var audio = null, master = null;
  var FREQ = [349.23, 329.63, 293.66, 261.63]; // F4 E4 D4 C4: treble to tenor
  var STROKE = 0.3; // seconds between bells
  function ensureAudio() {
    if (audio) return audio;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      audio = new AC();
      master = audio.createGain();
      master.gain.value = 0.35;
      master.connect(audio.destination);
    } catch (e) { audio = null; }
    return audio;
  }
  function strike(bell, t, muffled) {
    var f = FREQ[bell - 1];
    // ratio, amplitude, decay seconds: hum, prime, tierce, quint, nominal, upper partials
    var partials = [[0.5, 0.55, 4.5], [1, 1, 3], [1.19, 0.4, 1.7], [1.5, 0.28, 1.3], [2, 0.42, 1.0], [2.52, 0.14, 0.6], [3.01, 0.08, 0.4]];
    var gain = muffled ? 0.35 : 1;
    partials.forEach(function (p) {
      var o = audio.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * p[0];
      var g = audio.createGain();
      var d = muffled ? p[2] * 0.35 : p[2];
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(p[1] * gain * 0.5, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0003, t + d);
      o.connect(g);
      g.connect(master);
      o.start(t);
      o.stop(t + d + 0.05);
    });
  }

  var timers = [];
  var ringing = false;
  var userScrolled = false;
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var setCursor = drawBlueLine() || function () {};
  var ringBtn = document.getElementById('ring');

  function clearTimers() { timers.forEach(clearTimeout); timers = []; }
  function unlight() {
    stanzas.forEach(function (s) { s.el.classList.remove('ringing'); });
    document.querySelectorAll('.bell.struck').forEach(function (e) { e.classList.remove('struck'); });
    setCursor(null);
  }
  function stand() {
    clearTimers();
    ringing = false;
    unlight();
    if (ringBtn) { ringBtn.textContent = 'Ring the year'; ringBtn.setAttribute('aria-pressed', 'false'); }
  }
  // Schedule one row: four strikes, STROKE apart, starting at audio time t0 and wall-clock offset ms0.
  function scheduleRow(s, t0, ms0, follow) {
    var spans = s.el.querySelectorAll('.bell');
    timers.push(setTimeout(function () {
      unlight();
      s.el.classList.add('ringing');
      setCursor(s.index);
      if (follow && !userScrolled) {
        try { s.el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' }); } catch (e) { s.el.scrollIntoView(); }
      }
    }, ms0));
    s.bells.forEach(function (b, i) {
      if (!b) return;
      if (audio) strike(b, t0 + i * STROKE, false);
      timers.push(setTimeout(function () {
        s.el.classList.remove('ringing');
        spans.forEach(function (sp) { sp.classList.remove('struck'); });
        spans[i].classList.add('struck');
      }, ms0 + i * STROKE * 1000));
    });
  }
  function ringRow(s) {
    stand();
    ensureAudio();
    if (audio && audio.state === 'suspended') audio.resume();
    var t0 = audio ? audio.currentTime + 0.05 : 0;
    scheduleRow(s, t0, 50, false);
    timers.push(setTimeout(unlight, 50 + 4 * STROKE * 1000 + 600));
  }
  function ringYear() {
    if (ringing) { stand(); return; }
    ensureAudio();
    if (audio && audio.state === 'suspended') audio.resume();
    ringing = true;
    userScrolled = false;
    document.body.classList.add('bells');
    var toggle = document.getElementById('bells-toggle');
    if (toggle) toggle.setAttribute('aria-pressed', 'true');
    if (ringBtn) { ringBtn.textContent = 'Stand'; ringBtn.setAttribute('aria-pressed', 'true'); }
    var t = audio ? audio.currentTime + 0.1 : 0, ms = 100;
    stanzas.forEach(function (s, r) {
      scheduleRow(s, t, ms, true);
      var gap = 4 * STROKE + (r % 2 === 1 ? STROKE : 0); // an open handstroke gap after every whole pull
      t += gap; ms += gap * 1000;
    });
    timers.push(setTimeout(stand, ms + 1500));
  }
  window.addEventListener('wheel', function () { userScrolled = true; }, { passive: true });
  window.addEventListener('touchmove', function () { userScrolled = true; }, { passive: true });
  window.addEventListener('keydown', function (e) {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].indexOf(e.key) >= 0) userScrolled = true;
  });

  /* ---------- controls ---------- */
  var toggle = document.getElementById('bells-toggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      var on = document.body.classList.toggle('bells');
      toggle.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (!on) stand();
    });
  }
  if (ringBtn) ringBtn.addEventListener('click', ringYear);
  stanzas.forEach(function (s) {
    s.el.setAttribute('tabindex', '0');
    s.el.setAttribute('aria-label', 'Row ' + (s.index + 1) + (s.row ? ', ' + s.row.join('') : ''));
    s.el.addEventListener('click', function () { if (document.body.classList.contains('bells')) ringRow(s); });
    s.el.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter') && document.body.classList.contains('bells')) { e.preventDefault(); ringRow(s); }
    });
  });
  var theme = document.getElementById('theme');
  if (theme) {
    theme.addEventListener('click', function () {
      var root = document.documentElement;
      var dark = root.getAttribute('data-theme') === 'dark' ||
        (!root.getAttribute('data-theme') && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
      root.setAttribute('data-theme', dark ? 'light' : 'dark');
    });
  }

  check();
})();
