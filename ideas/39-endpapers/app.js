// Endpapers — the page. Everything that touches the DOM lives here; the story
// (story.js) and the rules (engine.js) know nothing about it.
(function () {
  'use strict';
  var E = EndpapersEngine;
  var story = STORY;
  var game = E.createGame(story);
  var readings = 0;           // how many times "Begin" has been pressed this visit
  var lastHeadId = null;      // which chapter head is showing

  var $ = function (id) { return document.getElementById(id); };
  var screens = { title: $('screen-title'), page: $('screen-page'), prov: $('screen-provenance') };
  var els = {
    where: $('where'), head: $('head'), chapter: $('head-chapter'), who: $('head-who'), date: $('head-date'),
    text: $('text'), choices: $('choices'), page: $('page'), prov: $('prov'), provList: $('prov-list'),
    provCount: $('prov-count'), register: $('register'), registerList: $('register-list'),
    registerBtn: $('btn-register'), colophon: $('colophon'),
  };

  // --- tiny inline markup: *emphasis* only; everything else is escaped ---
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function inline(s) {
    return esc(s).replace(/\*([^*]+)\*/g, '<em>$1</em>');
  }

  function show(name) {
    Object.keys(screens).forEach(function (k) { screens[k].hidden = k !== name; });
    window.scrollTo(0, 0);
  }

  // A register line is "Bird — Place — Date"; the date must not wrap on a phone.
  function registerItem(e) {
    var li = document.createElement('li');
    li.className = 'by-' + e.by;
    var parts = e.text.split(' — ');
    if (parts.length === 3) {
      li.innerHTML = '<span class="reg-bird">' + inline(parts[0]) + '</span> <span class="reg-place">' + inline(parts[1]) +
        '</span> <span class="reg-date">' + inline(parts[2]) + '</span>';
    } else {
      li.innerHTML = inline(e.text);
    }
    return li;
  }

  function renderRegister(list) {
    list.innerHTML = '';
    E.listEntries(story, game.state).forEach(function (e) { list.appendChild(registerItem(e)); });
  }

  function choiceButton(n, text, hand, onPick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'choice' + (hand ? ' hand-choice' : '');
    b.innerHTML = '<span class="num" aria-hidden="true">' + n + '</span><span class="label">' + inline(text) + '</span>';
    b.setAttribute('aria-keyshortcuts', String(n));
    b.addEventListener('click', onPick);
    return b;
  }

  function renderPassage() {
    var p = game.passage();
    var blocks = game.blocks();

    // Chapter head: show when the passage has one; keep the running line in the top bar.
    if (p.head) {
      lastHeadId = game.at;
      els.chapter.textContent = p.head.chapter;
      els.who.textContent = p.head.who;
      els.date.textContent = p.head.date;
      els.head.hidden = false;
      els.where.textContent = p.head.chapter + ' · ' + p.head.who;
    } else {
      els.head.hidden = true;
    }

    els.text.innerHTML = '';
    blocks.forEach(function (b) {
      var node;
      if (b.type === 'p') { node = document.createElement('p'); node.innerHTML = inline(b.text); }
      else if (b.type === 'quote') { node = document.createElement('blockquote'); node.className = 'quote'; node.innerHTML = inline(b.text); }
      else if (b.type === 'hand') { node = document.createElement('div'); node.className = 'hand'; node.innerHTML = inline(b.text); }
      else if (b.type === 'list') {
        node = document.createElement('ol'); node.className = 'register';
        b.entries.forEach(function (e) { node.appendChild(registerItem(e)); });
      }
      if (node) els.text.appendChild(node);
    });

    els.choices.innerHTML = '';
    if (game.isEnding()) {
      var t = document.createElement('p');
      t.className = 'ending-title';
      t.textContent = 'An ending · ' + p.ending;
      els.text.appendChild(t);
      els.choices.appendChild(choiceButton(1, 'Provenance.', false, showProvenance));
    } else {
      game.choices().forEach(function (c, i) {
        els.choices.appendChild(choiceButton(i + 1, c.text, c.hand, function () { pick(i); }));
      });
    }

    // Re-trigger the settle animation (CSS turns it off under reduced motion).
    els.page.classList.remove('fresh');
    void els.page.offsetWidth;
    els.page.classList.add('fresh');
    show('page');
    els.page.focus({ preventScroll: true });
  }

  function pick(i) {
    try { game.choose(i); } catch (e) { console.warn(e); return; }
    renderPassage();
  }

  var pathTotal = null;
  function showProvenance() {
    els.provList.innerHTML = '';
    game.provenance().forEach(function (line) {
      var li = document.createElement('li');
      li.innerHTML = inline(line);
      els.provList.appendChild(li);
    });
    if (pathTotal === null) pathTotal = E.traverse(story).paths;
    var taken = game.taken.length;
    els.provCount.innerHTML =
      'This reading went through <b>' + taken + '</b> choices; it is one of <b>' + pathTotal.toLocaleString('en-GB') +
      '</b> distinct ways through the book, counted by walking every branch of the story file with the same rules this page uses. ' +
      'The book is the same every time. The hands are not.';
    els.where.textContent = 'Provenance';
    show('prov');
    els.prov.focus({ preventScroll: true });
  }

  function begin() {
    readings++;
    game.start();
    renderPassage();
  }

  function toTitle() {
    game.start();
    els.where.textContent = '';
    els.colophon.textContent = readings ? (readings === 1 ? 'Read once.' : 'Read ' + readings + ' times.') : '';
    show('title');
  }

  function toggleRegister(force) {
    var open = typeof force === 'boolean' ? force : els.register.hidden;
    if (open) {
      renderRegister(els.registerList);
      $('register-sub').textContent = screens.title.hidden
        ? 'The list in the back of the book, as it stands at this point in the reading.'
        : 'The list in the back of the book, as it stands before anyone has opened it.';
      els.register.hidden = false;
      els.registerBtn.setAttribute('aria-pressed', 'true');
      $('btn-register-close').focus();
    } else {
      els.register.hidden = true;
      els.registerBtn.setAttribute('aria-pressed', 'false');
      els.registerBtn.focus();
    }
  }

  // --- wiring ---
  $('btn-begin').addEventListener('click', begin);
  $('btn-again').addEventListener('click', begin);
  $('btn-restart').addEventListener('click', function () { toTitle(); });
  $('brand').addEventListener('click', function (ev) { ev.preventDefault(); toTitle(); });
  els.registerBtn.addEventListener('click', function () { toggleRegister(); });
  $('btn-register-close').addEventListener('click', function () { toggleRegister(false); });
  els.register.addEventListener('click', function (ev) { if (ev.target === els.register) toggleRegister(false); });

  document.addEventListener('keydown', function (ev) {
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
    var tag = (ev.target && ev.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (ev.key === 'Escape' && !els.register.hidden) { toggleRegister(false); return; }
    if (ev.key === 'Escape') return;
    if (ev.key.toLowerCase() === 'l' && !ev.repeat) { toggleRegister(); return; }
    var n = parseInt(ev.key, 10);
    if (!(n >= 1 && n <= 9)) return;
    if (!els.register.hidden) return;
    var visible = Object.keys(screens).filter(function (k) { return !screens[k].hidden; })[0];
    var nav = visible === 'page' ? els.choices : screens[visible].querySelector('.choices');
    var btn = nav && nav.querySelectorAll('.choice')[n - 1];
    if (btn) { ev.preventDefault(); btn.click(); }
  });

  toTitle();
})();
