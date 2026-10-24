/* app.js: the page for Whose Turn. All arithmetic is in turns.js (window.WhoseTurn). */
(function () {
  'use strict';
  const W = window.WhoseTurn;
  const KEY = 'whose-turn.v1';
  const COLORS = ['#d1495b', '#e09f3e', '#2a9d8f', '#3d6fb6', '#8e5ea2', '#6a994e', '#c8553d', '#4f8fa3', '#b5838d', '#99a83a', '#7a6c5d', '#e76f51'];
  const $ = (id) => document.getElementById(id);
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ------------------------------------------------------------------ storage
  let store = { v: 1, circles: [], current: null, present: {}, exampleGone: false, lastCopy: 0, snooze: 0 };
  const DAY = 86400000;
  let storageOK = true;

  function load() {
    let raw = null;
    try {
      raw = window.localStorage.getItem(KEY);
    } catch (e) {
      storageOK = false;
    }
    if (!raw) return;
    try {
      const s = JSON.parse(raw);
      const circles = [];
      for (const c of Array.isArray(s.circles) ? s.circles : []) {
        try {
          W.validate(c);
          circles.push(c);
        } catch (e) {
          /* skip a damaged circle rather than lose the rest */
        }
      }
      store = {
        v: 1,
        circles,
        current: typeof s.current === 'string' ? s.current : null,
        present: s.present && typeof s.present === 'object' ? s.present : {},
        exampleGone: !!s.exampleGone,
        lastCopy: Number.isFinite(s.lastCopy) ? s.lastCopy : 0,
        snooze: Number.isFinite(s.snooze) ? s.snooze : 0,
      };
    } catch (e) {
      /* unreadable: start fresh, but do not overwrite until something changes */
    }
  }
  function save() {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(store));
      storageOK = true;
    } catch (e) {
      storageOK = false;
    }
  }

  // ------------------------------------------------------------------ ids and helpers
  function newId(len) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = new Uint8Array(len);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (let i = 0; i < len; i++) bytes[i] = Math.floor(Math.random() * 256);
    let s = '';
    for (const b of bytes) s += chars[b % 36];
    return s;
  }
  const current = () => store.circles.find((c) => c.id === store.current) || null;
  const memberById = (c, id) => c.members.find((m) => m.id === id);
  const nameOf = (c, id) => (memberById(c, id) || { name: '?' }).name;
  function colorOf(c, id) {
    const i = c.members.findIndex((m) => m.id === id);
    return COLORS[(i < 0 ? 0 : i) % COLORS.length];
  }
  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k === 'style') e.setAttribute('style', v);
        else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const k of kids) if (k !== null && k !== undefined) e.append(k.nodeType ? k : document.createTextNode(String(k)));
    return e;
  }
  function dot(c, id, cls) {
    return el('span', { class: cls || 'dot-s', style: `--dot:${colorOf(c, id)}`, 'aria-hidden': 'true' });
  }
  function parseNames(text) {
    const seen = new Set();
    const out = [];
    for (const raw of String(text).split(/[\n,;]+/)) {
      const n = raw.trim().replace(/\s+/g, ' ').slice(0, 40);
      if (n && !seen.has(n.toLowerCase())) {
        seen.add(n.toLowerCase());
        out.push(n);
      }
    }
    return out;
  }

  // Words. Turns circles count turns; rounds circles count portions ("one each").
  function amount(c, q) {
    const f = W.fmt(q);
    if (c.kind === 'rounds') return f.text;
    const mag = W.cmp(q, W.ZERO) < 0 ? W.neg(q) : q;
    if (W.cmp(mag, W.Q(1)) < 0) return `${f.text} of a turn`;
    if (W.eq(mag, W.Q(1))) return '1 turn';
    return `${f.text} turns`;
  }
  function fenceText(c, F) {
    if (c.kind === 'rounds') {
      const f = W.fmt(F).text;
      return `±${f} ${f === '1' ? 'portion' : 'portions'}`;
    }
    return `±${amount(c, F)}`;
  }
  function standing(c, q) {
    const s = W.cmp(q, W.ZERO);
    if (s === 0) return 'even';
    const f = W.fmt(q).text;
    if (c.kind === 'rounds') return s > 0 ? `has had ${f} more than bought` : `has bought ${f} more than had`;
    return s > 0 ? `owes ${f}` : `is owed ${f}`;
  }

  // ------------------------------------------------------------------ the example circle
  function makeExample(now) {
    const names = ['Ana', 'Ben', 'Cleo', 'Dev'];
    const members = names.map((name, i) => ({ id: newId(8), name, nameT: 0, gone: false, goneT: 0, pos: i }));
    const c = {
      id: newId(10), name: 'School run (example)', nameT: 0, kind: 'turns', created: now,
      members, events: [], removed: [], example: true,
    };
    const r = W.rng(4);
    const day = 86400000;
    const start = new Date(now - 36 * day);
    start.setHours(8, 10, 0, 0);
    for (let d = 0; d < 36; d++) {
      const t = start.getTime() + d * day;
      const wd = new Date(t).getDay();
      if (wd === 0 || wd === 6 || t > now) continue;
      const p = [];
      if (r() < 0.95) p.push(0);
      if (r() < 0.85) p.push(1);
      if (r() < (wd === 2 || wd === 4 || wd === 5 ? 0.85 : 0.1)) p.push(2);
      if (r() < 0.75) p.push(3);
      if (p.length < 2) continue;
      const who = p.map((i) => members[i].id);
      const pk = W.pick(c, who);
      c.events.push({ id: newId(10), t, by: pk.top.id, who });
    }
    return c;
  }

  // ------------------------------------------------------------------ notices (example, storage, incoming links)
  let incoming = null; // a circle decoded from the page's #hash, waiting for the user's say-so
  function renderNotices() {
    const box = $('notices');
    box.replaceChildren();
    const c = current();
    if (!storageOK) {
      box.append(el('div', { class: 'notice' },
        el('p', { text: "This browser isn't letting the page keep anything (private mode, or storage is blocked). It still works, but what you enter will be gone when you close it. Copy the ledger code under \"Share or back up\" to keep it." })));
    }
    if (incoming) {
      const known = store.circles.find((x) => x.id === incoming.id);
      const live = W.liveEvents(incoming).length;
      box.append(el('div', { class: 'notice calm' },
        el('p', { text: `This link carries a ledger: "${incoming.name}", ${live} ${live === 1 ? 'entry' : 'entries'}, ${incoming.members.length} people. ${known ? 'You already have this circle; merging adds anything new.' : 'It will be added as a new circle.'}` }),
        el('div', { class: 'row-buttons' },
          el('button', { type: 'button', class: 'primary small', onclick: () => acceptIncoming() }, known ? 'Merge it in' : 'Add it'),
          el('button', { type: 'button', class: 'ghost small', onclick: () => { incoming = null; clearHash(); renderNotices(); } }, 'Ignore'))));
    }
    if (c && !c.example && storageOK && W.liveEvents(c).length >= 10) {
      const now = Date.now();
      const since = Math.max(store.lastCopy || 0, c.created || 0);
      if (now - since > 21 * DAY && now > (store.snooze || 0)) {
        box.append(el('div', { class: 'notice' },
          el('p', { text: "Browsers can clear what a page keeps, especially one that hasn't been opened for a while. Keep a copy of this ledger somewhere: pasting the code into your group chat is enough." }),
          el('div', { class: 'row-buttons' },
            el('button', { type: 'button', class: 'primary small', onclick: () => { copyText(W.encode(c), 'Copied. Paste it somewhere safe.'); toast('Ledger code copied.'); renderNotices(); } }, 'Copy the ledger code'),
            el('button', { type: 'button', class: 'ghost small', onclick: () => { store.snooze = Date.now() + 14 * DAY; save(); renderNotices(); } }, 'Not now'))));
      }
    }
    if (!store.circles.length && $('create').hidden) {
      box.append(el('div', { class: 'notice calm' },
        el('p', { text: 'No circles yet.' }),
        el('div', { class: 'row-buttons' },
          el('button', { type: 'button', class: 'primary small', onclick: () => openCreate() }, 'Start a circle'),
          el('button', { type: 'button', class: 'ghost small', onclick: () => {
            const ex = makeExample(Date.now());
            store.circles.push(ex);
            store.current = ex.id;
            save();
            render();
          } }, 'Show the example again'))));
    }
    if (c && c.example) {
      box.append(el('div', { class: 'notice calm' },
        el('p', { text: 'A made-up school run, a few weeks in. Tap people in and out to see the pick change.' }),
        el('div', { class: 'row-buttons' },
          el('button', { type: 'button', class: 'primary small', onclick: () => openCreate() }, 'Start your own'),
          el('button', { type: 'button', class: 'ghost small', onclick: () => removeExample() }, 'Remove the example'))));
    }
  }
  function removeExample() {
    const c = current();
    if (!c || !c.example) return;
    store.circles = store.circles.filter((x) => x !== c);
    store.exampleGone = true;
    store.current = store.circles.length ? store.circles[0].id : null;
    save();
    if (!store.circles.length) openCreate();
    render();
  }
  function clearHash() {
    try {
      if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    } catch (e) {
      /* file:// in some browsers: leave the hash */
    }
  }
  function acceptIncoming() {
    if (!incoming) return;
    const msg = mergeIn(incoming);
    incoming = null;
    clearHash();
    toast(msg);
    render();
  }
  function mergeIn(c) {
    const i = store.circles.findIndex((x) => x.id === c.id);
    if (i < 0) {
      store.circles.push(c);
      store.current = c.id;
      store.exampleGone = true;
      save();
      return `Added "${c.name}".`;
    }
    const before = store.circles[i];
    const merged = W.merge(before, c);
    const newEntries = merged.events.length - before.events.length;
    const newRemovals = merged.removed.length - (before.removed || []).length;
    if (before.example) merged.example = true;
    store.circles[i] = merged;
    store.current = merged.id;
    save();
    const parts = [];
    parts.push(`${newEntries} new ${newEntries === 1 ? 'entry' : 'entries'}`);
    if (newRemovals) parts.push(`${newRemovals} removed`);
    return `Merged "${merged.name}": ${parts.join(', ')}.`;
  }

  // ------------------------------------------------------------------ rendering
  function render() {
    const c = current();
    renderTabs();
    renderNotices();
    $('main').hidden = !c;
    if (!c) return;
    const rows = W.ledger(c);
    renderToday(c, rows);
    renderStand(c, rows);
    renderHistory(c);
    renderEdit(c);
    renderShare(c);
  }

  function renderTabs() {
    const box = $('circle-tabs');
    box.replaceChildren();
    for (const c of store.circles) {
      box.append(el('button', {
        type: 'button', class: 'tab', role: 'listitem', 'aria-current': c.id === store.current ? 'true' : 'false',
        onclick: () => { store.current = c.id; closeCreate(); save(); render(); },
      }, c.name));
    }
  }

  function presentFor(c) {
    const active = c.members.filter((m) => !m.gone).map((m) => m.id);
    const saved = store.present[c.id];
    if (!Array.isArray(saved)) return active;
    return saved.filter((id) => active.includes(id));
  }

  let lastName = null;
  let lastArrive = 0;
  function renderToday(c, rows) {
    $('circle-name').textContent = c.name;
    $('circle-kind').textContent = c.kind === 'rounds' ? 'rounds: one each for everyone' : 'turns: one person does it';
    const present = presentFor(c);
    const people = $('people');
    people.replaceChildren();
    for (const m of c.members) {
      if (m.gone) continue;
      const on = present.includes(m.id);
      people.append(el('button', {
        type: 'button', class: 'person', 'aria-pressed': on ? 'true' : 'false', style: `--dot:${colorOf(c, m.id)}`,
        onclick: () => togglePresent(c, m.id),
      }, el('span', { class: 'dot', 'aria-hidden': 'true' }), el('span', { class: 'nm', text: m.name })));
    }
    if (!c.members.some((m) => !m.gone)) people.append(el('p', { class: 'hint', text: 'Nobody in this circle yet. Add people under "Edit this circle".' }));

    const v = $('verdict');
    v.replaceChildren();
    const pk = W.pick(c, present, rows);
    const logBtn = $('log-pick');
    const otherBtn = $('log-other');
    if (!pk.ok) {
      v.append(el('p', { class: 'whose quiet', text: pk.reason === 'alone' ? 'Just one person: nothing to share this time.' : 'Tap who is in this time.' }));
      logBtn.textContent = 'Pick someone first';
      logBtn.disabled = true;
      otherBtn.disabled = true;
      closeOther();
      lastName = null;
      return;
    }
    logBtn.disabled = cooling;
    otherBtn.disabled = cooling;
    const top = pk.top;
    const nm = nameOf(c, top.id);
    const whose = el('p', { class: 'whose' }, el('span', { class: 'dot', style: `--dot:${colorOf(c, top.id)}`, 'aria-hidden': 'true' }),
      el('span', { class: 'nm', text: nm }), c.kind === 'rounds' ? '’s round' : '’s turn');
    v.append(whose, el('p', { class: 'why', text: reasonText(c, pk) }));
    const rest = pk.ranked.slice(1, 4).map((r) => nameOf(c, r.id));
    if (rest.length) {
      const more = pk.ranked.length > 4 ? ', …' : '';
      v.append(el('p', { class: 'then', text: `If ${nm} can't: ${rest.join(', then ')}${more}.` }));
    }
    const now = performance.now();
    if (nm !== lastName && lastName !== null && !reduceMotion && now - lastArrive > 400) {
      v.classList.remove('fresh');
      void v.offsetWidth;
      v.classList.add('fresh');
      lastArrive = now;
    }
    lastName = nm;
    logBtn.textContent = c.kind === 'rounds' ? `${nm} got this round` : `${nm} did it`;
    if (!$('other').hidden) renderOther(c, present, rows, pk);
  }

  function reasonText(c, pk) {
    const top = pk.top;
    const nm = nameOf(c, top.id);
    const n = pk.ranked.length;
    const here = n === 2 ? 'the two of you' : `the ${n} of you here`;
    const amt = amount(c, top.bal);
    let base;
    if (pk.sign > 0) {
      base = c.kind === 'rounds'
        ? `${nm} has had ${W.fmt(top.bal).text} more than they've bought`
        : `${nm} owes ${amt}`;
    } else if (pk.sign === 0) {
      base = `${nm} is even`;
    } else {
      base = c.kind === 'rounds'
        ? `Everyone here has bought more than they've had; ${nm} the least extra (${W.fmt(top.bal).text})`
        : `Everyone here is owed; ${nm} is owed the least (${amt})`;
    }
    if (pk.tied.length > 1) {
      const others = pk.tied.slice(1).map((r) => nameOf(c, r.id));
      const lvl = others.length === 1 ? `${others[0]} is level` : `${others.join(' and ')} are level`;
      const tb = pk.tieBy === 'recency'
        ? (top.lastIdx < 0 ? `${nm} hasn't had a turn yet` : `${nm}'s last turn was longer ago`)
        : `${nm} comes first in the list`;
      return `${base}. ${lvl}, and ${tb}.`;
    }
    if (pk.sign > 0) return `${base}, more than anyone else among ${here}.`;
    if (pk.sign === 0) return `${base}, and nobody among ${here} owes anything.`;
    return `${base}.`;
  }

  function togglePresent(c, id) {
    const p = new Set(presentFor(c));
    if (p.has(id)) p.delete(id);
    else p.add(id);
    store.present[c.id] = c.members.filter((m) => p.has(m.id)).map((m) => m.id);
    save();
    const rows = W.ledger(c);
    renderToday(c, rows);
  }

  // Logging. A short cool-down after each entry means a held key or a double tap logs once.
  let cooling = false;
  function logTurn(by) {
    const c = current();
    if (!c || cooling) return;
    const present = presentFor(c);
    if (present.length < 2 && !(present.length === 1 && by !== present[0])) return;
    const who = [...new Set([...present, by])];
    const e = { id: newId(10), t: Math.floor(Date.now() / 1000) * 1000, by, who };
    c.events.push(e);
    save();
    cooling = true;
    closeOther();
    render();
    toast(`${nameOf(c, by)} ${c.kind === 'rounds' ? 'got the round' : 'did it'}. Logged.`, () => {
      c.removed = [...new Set([...(c.removed || []), e.id])];
      save();
      render();
    });
    setTimeout(() => {
      cooling = false;
      const cc = current();
      if (cc) renderToday(cc, W.ledger(cc));
    }, 1100);
  }

  function openOther() {
    const c = current();
    if (!c) return;
    $('other').hidden = false;
    $('log-other').setAttribute('aria-expanded', 'true');
    const present = presentFor(c);
    const rows = W.ledger(c);
    renderOther(c, present, rows, W.pick(c, present, rows));
    try {
      $('other').scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
    } catch (e) {
      /* old browsers */
    }
  }
  function closeOther() {
    $('other').hidden = true;
    $('log-other').setAttribute('aria-expanded', 'false');
  }
  function renderOther(c, present, rows, pk) {
    const list = $('other-list');
    list.replaceChildren();
    if (!pk.ok) return;
    const now = W.promise(c, rows).bound;
    $('other-hint').textContent = `Who did it instead? Beside each name: what the fence (now ${fenceText(c, now)}) would become.`;
    for (const r of pk.ranked) {
      if (r.id === pk.top.id) continue;
      const after = W.promiseIf(c, present, r.id, rows).bound;
      const widen = W.cmp(after, now) > 0;
      const eff = widen ? `fence widens to ±${W.fmt(after).text}` : W.cmp(after, now) < 0 ? `fence narrows to ±${W.fmt(after).text}` : 'fence stays the same';
      list.append(el('button', { type: 'button', class: 'other-item', onclick: () => logTurn(r.id) },
        el('span', { class: 'nm' }, dot(c, r.id), el('span', { text: nameOf(c, r.id) })),
        el('span', { class: `eff${widen ? ' widen' : ''}`, text: eff })));
    }
  }

  // ------------------------------------------------------------------ where everyone stands
  function renderStand(c, rows) {
    const pr = W.promise(c, rows);
    const F = pr.bound;
    const rp = W.replay(c);
    const promise = $('promise');
    promise.replaceChildren();
    const exact = c.kind === 'turns' && rp.followed === rp.total && W.EXACT_TURNS[pr.n] && pr.n >= 2 && W.cmp(W.parseQ(W.EXACT_TURNS[pr.n]), F) < 0
      ? W.parseQ(W.EXACT_TURNS[pr.n]) : null;
    if (W.cmp(pr.D, W.ZERO) === 0) {
      promise.append('Follow the pick and nobody can ever get further from even than the dashed fence: ',
        el('b', { text: fenceText(c, F) }),
        `, whoever comes and however often (${pr.n} ${pr.n === 1 ? 'person' : 'people'} in this circle).`);
      if (exact) promise.append(` For ${pr.n} people the worst the rule ever actually reaches is ${W.fmt(exact).text}.`);
    } else {
      promise.append('Some turns went to someone other than the pick, so balances are wider than the rule alone would allow. Following the pick from here, nobody can get further than ',
        el('b', { text: fenceText(c, F) }), '; while you do, this fence can only stay put or shrink.');
    }
    $('lab-left').textContent = c.kind === 'rounds' ? '← bought more' : '← is owed';
    $('lab-right').textContent = c.kind === 'rounds' ? 'had more →' : 'owes →';

    const list = $('rows');
    list.replaceChildren();
    let span = W.toNumber(F);
    for (const r of rows.values()) span = Math.max(span, Math.abs(W.toNumber(r.bal)));
    span = span > 0 ? span * 1.12 : 1;
    const pos = (x) => 50 + (50 * x) / span;
    for (const m of c.members) {
      const r = rows.get(m.id);
      if (!r) continue;
      if (m.gone && W.cmp(r.bal, W.ZERO) === 0) continue;
      const x = W.toNumber(r.bal);
      const out = W.cmp(r.bal, F) > 0 || W.cmp(r.bal, W.neg(F)) < 0;
      const track = el('div', { class: 'track', 'aria-hidden': 'true' },
        el('div', { class: 'rail' }),
        el('div', { class: 'band', style: `left:${pos(-W.toNumber(F))}%;right:${100 - pos(W.toNumber(F))}%` }),
        el('div', { class: 'zero', style: 'left:50%' }),
        el('div', { class: `mark${out ? ' out' : ''}`, style: `left:${pos(x)}%;--dot:${colorOf(c, m.id)}` }));
      list.append(el('li', { class: `row${m.gone ? ' gone' : ''}` },
        el('span', { class: 'who' }, dot(c, m.id), el('span', { text: m.name + (m.gone ? ' (left)' : '') })),
        track,
        el('span', { class: 'val', text: standing(c, r.bal) + (out ? ', outside the fence' : '') })));
    }
    $('replay').textContent = rp.total === 0
      ? 'Nothing logged yet.'
      : rp.followed === rp.total
        ? `All ${rp.total} ${rp.total === 1 ? 'entry' : 'entries'} so far went to the pick (or to someone tied with it).`
        : `${rp.followed} of ${rp.total} entries went to the pick; ${rp.total - rp.followed} went to someone else.`;
    renderChart(c, F);
    renderArith(c, rows);
  }

  function renderChart(c, F) {
    const box = $('chart');
    box.replaceChildren();
    const evs = W.liveEvents(c);
    if (evs.length < 2) {
      box.append(el('p', { class: 'empty', text: 'A chart appears after a couple of entries.' }));
      return;
    }
    const N = Math.min(evs.length, 80);
    const startIdx = evs.length - N;
    const series = new Map(c.members.map((m) => [m.id, []]));
    let bal = new Map(c.members.map((m) => [m.id, W.ZERO]));
    let maxAbs = W.toNumber(F);
    evs.forEach((e, i) => {
      for (const [p, d] of W.eventDelta(c.kind, W.presentOf(e), e.by)) bal.set(p, W.add(bal.get(p) || W.ZERO, d));
      if (i >= startIdx - 1) {
        for (const m of c.members) {
          const x = W.toNumber(bal.get(m.id) || W.ZERO);
          series.get(m.id).push(x);
          maxAbs = Math.max(maxAbs, Math.abs(x));
        }
      }
    });
    const w = 600;
    const h = 180;
    const pad = 8;
    const steps = series.get(c.members[0].id).length - 1 || 1;
    const X = (i) => pad + ((w - 2 * pad) * i) / steps;
    const Y = (v) => h / 2 - ((h / 2 - pad) * v) / (maxAbs * 1.3 || 1);
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Balances over the last ${N} entries, all inside a fence of plus or minus ${W.fmt(F).text}.`);
    const add = (tag, attrs) => {
      const e = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      svg.append(e);
      return e;
    };
    add('rect', { x: 0, y: Y(W.toNumber(F)), width: w, height: Y(-W.toNumber(F)) - Y(W.toNumber(F)), fill: 'var(--fence)' });
    add('line', { x1: 0, x2: w, y1: Y(W.toNumber(F)), y2: Y(W.toNumber(F)), stroke: 'var(--fence-edge)', 'stroke-dasharray': '5 4' });
    add('line', { x1: 0, x2: w, y1: Y(-W.toNumber(F)), y2: Y(-W.toNumber(F)), stroke: 'var(--fence-edge)', 'stroke-dasharray': '5 4' });
    add('line', { x1: 0, x2: w, y1: h / 2, y2: h / 2, stroke: 'var(--muted)', 'stroke-opacity': 0.5 });
    for (const m of c.members) {
      const s = series.get(m.id);
      if (s.every((v) => v === 0)) continue;
      add('polyline', {
        points: s.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' '),
        fill: 'none', stroke: colorOf(c, m.id), 'stroke-width': 2.2, 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke',
      });
    }
    box.append(svg);
  }

  function renderArith(c, rows) {
    const t = $('arith');
    t.replaceChildren();
    const shareHead = c.kind === 'rounds' ? 'Had' : 'Fair share';
    const doneHead = c.kind === 'rounds' ? 'Bought' : 'Did';
    t.append(el('thead', null, el('tr', null,
      el('th', { scope: 'col', text: 'Who' }), el('th', { scope: 'col', class: 'num', text: 'There' }),
      el('th', { scope: 'col', class: 'num', text: shareHead }), el('th', { scope: 'col', class: 'num', text: doneHead }),
      el('th', { scope: 'col', class: 'num', text: 'Balance' }))));
    const body = el('tbody');
    for (const m of c.members) {
      const r = rows.get(m.id);
      if (!r) continue;
      let bought = 0;
      if (c.kind === 'rounds') for (const e of W.liveEvents(c)) if (e.by === m.id) bought += W.presentOf(e).length;
      body.append(el('tr', null,
        el('td', { text: m.name }), el('td', { class: 'num', text: String(r.present) }),
        el('td', { class: 'num', text: W.qstr(r.share) }),
        el('td', { class: 'num', text: String(c.kind === 'rounds' ? bought : r.done) }),
        el('td', { class: 'num', text: W.qstr(r.bal).replace('-', '−') })));
    }
    t.append(body);
    $('arith-note').textContent = c.kind === 'rounds'
      ? 'Balance = portions had − portions bought. The balances add up to exactly 0.'
      : 'Fair share = the sum of 1/k for every turn you were there for, with k people there. Balance = fair share − turns done. Exact fractions; the balances add up to exactly 0.';
  }

  // ------------------------------------------------------------------ history
  let showAllHistory = false;
  function renderHistory(c) {
    const list = $('history');
    list.replaceChildren();
    const evs = W.liveEvents(c);
    const rp = W.replay(c);
    const off = new Set(rp.deviations);
    if (!evs.length) {
      list.append(el('li', null, el('span', { class: 'empty', text: 'Nothing yet. When someone does it, tap their button above.' })));
      $('history-more').hidden = true;
      return;
    }
    const idx = evs.map((e, i) => i).reverse();
    const shown = showAllHistory ? idx : idx.slice(0, 12);
    const fmtDate = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    for (const i of shown) {
      const e = evs[i];
      const others = W.presentOf(e).filter((p) => p !== e.by).map((p) => nameOf(c, p));
      list.append(el('li', null,
        el('span', { class: 'what' },
          el('span', { class: 'when', text: fmtDate.format(new Date(e.t)) }),
          dot(c, e.by), ' ', el('b', { text: nameOf(c, e.by) }), others.length ? ` for ${others.join(', ')}` : '',
          off.has(i) ? el('span', { class: 'off', text: ' (not the pick)' }) : null),
        el('button', { type: 'button', class: 'x', 'aria-label': `Remove this entry: ${nameOf(c, e.by)}, ${fmtDate.format(new Date(e.t))}`, onclick: () => removeEvent(e.id) }, 'Remove')));
    }
    const more = $('history-more');
    more.hidden = idx.length <= 12;
    more.textContent = showAllHistory ? 'Show fewer' : `Show all ${idx.length}`;
  }
  function removeEvent(id) {
    const c = current();
    if (!c) return;
    c.removed = [...new Set([...(c.removed || []), id])];
    save();
    render();
    toast('Entry removed.', () => {
      c.removed = c.removed.filter((x) => x !== id);
      save();
      render();
    });
  }

  // ------------------------------------------------------------------ edit
  function renderEdit(c) {
    const nameIn = $('edit-name');
    if (document.activeElement !== nameIn) nameIn.value = c.name;
    const list = $('edit-people');
    list.replaceChildren();
    for (const m of c.members) {
      const input = el('input', { value: m.name, maxlength: '40', 'aria-label': `Name for ${m.name}` });
      input.addEventListener('change', () => {
        const v = input.value.trim().replace(/\s+/g, ' ').slice(0, 40);
        if (!v) {
          input.value = m.name;
          return;
        }
        m.name = v;
        m.nameT = Date.now();
        save();
        render();
      });
      const btn = el('button', {
        type: 'button', class: 'ghost gone-toggle', 'aria-pressed': m.gone ? 'true' : 'false',
        onclick: () => {
          m.gone = !m.gone;
          m.goneT = Date.now();
          save();
          render();
        },
      }, m.gone ? 'Back in' : 'Has left');
      list.append(el('li', null, dot(c, m.id), input, btn));
    }
    $('edit-note').textContent = `People who have left keep their place in the ledger and still count towards the fence. This circle counts ${c.kind === 'rounds' ? 'rounds (one each for everyone)' : 'turns (one person does it for everyone)'}; that can't be changed once it has a history, so start a new circle if it should count the other way.`;
  }

  // ------------------------------------------------------------------ share and back up
  function renderShare(c) {
    $('code-out').value = W.encode(c);
    $('copy-link').hidden = !/^https?:$/.test(location.protocol);
  }
  async function copyText(text, okMsg) {
    store.lastCopy = Date.now();
    save();
    try {
      await navigator.clipboard.writeText(text);
      $('share-msg').textContent = okMsg;
      return;
    } catch (e) {
      /* fall through */
    }
    const ta = $('code-out');
    ta.focus();
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (e) {
      ok = false;
    }
    $('share-msg').textContent = ok ? okMsg : 'Copying was blocked here; the code is selected, so copy it by hand.';
  }

  // ------------------------------------------------------------------ create
  function openCreate() {
    $('create').hidden = false;
    renderNotices();
    $('create-error').textContent = '';
    $('create-name').focus();
  }
  function closeCreate() {
    $('create').hidden = true;
    renderNotices();
  }
  function submitCreate(ev) {
    ev.preventDefault();
    const name = $('create-name').value.trim().replace(/\s+/g, ' ').slice(0, 60);
    const kind = (document.querySelector('input[name="kind"]:checked') || { value: 'turns' }).value;
    const names = parseNames($('create-people').value);
    if (!name) {
      $('create-error').textContent = 'Give it a name, such as "School run".';
      return;
    }
    if (names.length < 2) {
      $('create-error').textContent = 'Add at least two people.';
      return;
    }
    if (names.length > 60) {
      $('create-error').textContent = 'That is more people than this page handles (60).';
      return;
    }
    const now = Date.now();
    const c = {
      id: newId(10), name, nameT: now, kind, created: now,
      members: names.map((n, i) => ({ id: newId(8), name: n, nameT: now, gone: false, goneT: 0, pos: i })),
      events: [], removed: [],
    };
    store.circles.push(c);
    store.current = c.id;
    store.exampleGone = true;
    save();
    $('create-form').reset();
    closeCreate();
    render();
    $('today').focus();
  }

  // ------------------------------------------------------------------ toast
  let toastTimer = null;
  function toast(msg, undo) {
    const t = $('toast');
    t.replaceChildren(el('span', { text: msg }));
    if (undo) {
      t.append(el('button', {
        type: 'button',
        onclick: () => {
          t.hidden = true;
          undo();
        },
      }, 'Undo'));
    }
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), undo ? 7000 : 4000);
  }

  // ------------------------------------------------------------------ wiring
  function wire() {
    $('new-circle').addEventListener('click', () => ($('create').hidden ? openCreate() : closeCreate()));
    $('create-cancel').addEventListener('click', () => {
      closeCreate();
      if (!store.circles.length) render();
    });
    $('create-form').addEventListener('submit', submitCreate);
    $('log-pick').addEventListener('click', () => {
      const c = current();
      if (!c) return;
      const pk = W.pick(c, presentFor(c));
      if (pk.ok) logTurn(pk.top.id);
    });
    $('log-other').addEventListener('click', () => ($('other').hidden ? openOther() : closeOther()));
    $('history-more').addEventListener('click', () => {
      showAllHistory = !showAllHistory;
      const c = current();
      if (c) renderHistory(c);
    });
    $('edit-name').addEventListener('change', () => {
      const c = current();
      const v = $('edit-name').value.trim().replace(/\s+/g, ' ').slice(0, 60);
      if (!c || !v) return;
      c.name = v;
      c.nameT = Date.now();
      if (c.example && !/example/i.test(v)) delete c.example;
      save();
      render();
    });
    $('add-person').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const c = current();
      const names = parseNames($('add-name').value);
      if (!c || !names.length) return;
      const pos = c.members.reduce((m, x) => Math.max(m, x.pos ?? 0), -1) + 1;
      names.slice(0, Math.max(0, 60 - c.members.length)).forEach((n, i) => {
        c.members.push({ id: newId(8), name: n, nameT: Date.now(), gone: false, goneT: 0, pos: pos + i });
      });
      $('add-name').value = '';
      if (Array.isArray(store.present[c.id])) store.present[c.id] = presentFor(c).concat(c.members.slice(-names.length).map((m) => m.id));
      save();
      render();
    });
    $('delete-circle').addEventListener('click', () => {
      const c = current();
      if (!c) return;
      let ok = false;
      try {
        ok = window.confirm(`Delete "${c.name}" and its whole history from this device? Copies on other phones are not affected.`);
      } catch (e) {
        ok = false;
      }
      if (!ok) return;
      store.exampleGone = true;
      store.circles = store.circles.filter((x) => x !== c);
      delete store.present[c.id];
      store.current = store.circles.length ? store.circles[0].id : null;
      save();
      if (!store.circles.length) openCreate();
      render();
    });
    $('copy-code').addEventListener('click', () => {
      const c = current();
      if (c) copyText(W.encode(c), 'Copied. Paste it on the other phone, under "Paste a code".');
    });
    $('copy-link').addEventListener('click', () => {
      const c = current();
      if (c) copyText(`${location.origin}${location.pathname}#${W.encode(c)}`, 'Link copied. Opening it offers to merge this ledger.');
    });
    $('merge-code').addEventListener('click', () => {
      const text = $('code-in').value;
      try {
        const c = W.decode(text);
        const msg = mergeIn(c);
        $('share-msg').textContent = msg;
        $('code-in').value = '';
        render();
      } catch (e) {
        $('share-msg').textContent = e.message;
      }
    });
    $('download').addEventListener('click', () => {
      const data = JSON.stringify({ app: 'whose-turn', v: 1, saved: new Date().toISOString(), codes: store.circles.map((c) => W.encode(c)) }, null, 1);
      const blob = new Blob([data], { type: 'application/json' });
      const a = el('a', { href: URL.createObjectURL(blob), download: `whose-turn-backup-${new Date().toISOString().slice(0, 10)}.json` });
      document.body.append(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 1000);
      store.lastCopy = Date.now();
      save();
      $('share-msg').textContent = 'Backup downloaded. Restoring it merges, so it never loses anything newer.';
    });
    $('restore').addEventListener('change', async (ev) => {
      const f = ev.target.files && ev.target.files[0];
      if (!f) return;
      try {
        if (f.size > 20_000_000) throw new Error('That file is too big to be a backup.');
        const text = await f.text();
        const data = JSON.parse(text);
        if (!data || data.app !== 'whose-turn' || !Array.isArray(data.codes)) throw new Error("That file isn't a Whose Turn backup.");
        const msgs = data.codes.map((code) => mergeIn(W.decode(code)));
        $('share-msg').textContent = msgs.join(' ');
        render();
      } catch (e) {
        $('share-msg').textContent = e.message || 'Could not read that file.';
      }
      ev.target.value = '';
    });
    // A held Enter or Space would repeat a button press many times a second: ignore repeats.
    document.addEventListener('keydown', (e) => {
      if (e.repeat && (e.key === 'Enter' || e.key === ' ') && e.target && e.target.closest && e.target.closest('button')) e.preventDefault();
    }, true);
    window.addEventListener('storage', (e) => {
      if (e.key !== KEY) return;
      load();
      render();
    });
    window.addEventListener('hashchange', readHash);
  }

  function readHash() {
    const h = decodeURIComponent(location.hash || '');
    if (!/WHOSETURN1:/.test(h)) return;
    try {
      incoming = W.decode(h);
    } catch (e) {
      incoming = null;
      toast(`The link's ledger could not be read: ${e.message}`);
    }
    renderNotices();
  }

  // ------------------------------------------------------------------ start
  load();
  if (!store.circles.length && !store.exampleGone) {
    const ex = makeExample(Date.now());
    store.circles.push(ex);
    store.current = ex.id;
    save();
  }
  if (!current() && store.circles.length) store.current = store.circles[0].id;
  wire();
  render();
  readHash();
  if (!store.circles.length) openCreate();
})();
