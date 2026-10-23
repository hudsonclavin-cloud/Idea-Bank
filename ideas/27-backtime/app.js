/* Backtime — the page. Everything here is DOM; the arithmetic lives in backtime.js. */
(function () {
  'use strict';
  const B = window.Backtime;
  const STORAGE_KEY = 'backtime.plan.v1';
  const THEME_KEY = 'backtime.theme';
  const LIVE_WINDOW = 1080; // minutes: jobs further ahead than this show a clock time, not a countdown
  const DISH_COLOURS = 8;

  // Starting points for common dishes. Timings are editable defaults, not food-safety advice.
  const PRESETS = [
    ['Roast chicken (1.5 kg)', 0, [['In the oven', 80, 'oven', 200], ['Out to rest, loosely covered', 25, 'rest'], ['Carve', 5, 'hands']]],
    ['Roast beef (1.5 kg, medium)', 0, [['Sear all over', 6, 'hands'], ['In the oven', 55, 'oven', 190], ['Out to rest', 25, 'rest'], ['Carve', 5, 'hands']]],
    ['Roast turkey (4 kg)', 0, [['In the oven', 180, 'oven', 180], ['Out to rest, tented', 35, 'rest'], ['Carve', 10, 'hands']]],
    ['Roast potatoes', 0, [['Parboil', 12, 'hob'], ['Drain, shake, into hot fat', 3, 'hands'], ['In the oven', 55, 'oven', 200]]],
    ['Yorkshire puddings', 3, [['Batter into the smoking-hot tin', 2, 'hands'], ['In the oven, no peeking', 22, 'oven', 220]]],
    ['Gravy', 0, [['In the roasting tin', 10, 'hob']]],
    ['Mashed potatoes', 0, [['Boil', 20, 'hob'], ['Mash with butter', 5, 'hands']]],
    ['Carrots', 0, [['Simmer', 15, 'hob']]],
    ['Greens', 0, [['Boil', 5, 'hob']]],
    ['Rice (absorption)', 0, [['Simmer, lid on', 12, 'hob'], ['Off the heat, lid on', 5, 'rest']]],
    ['Pasta', 0, [['Boil', 10, 'hob']]],
    ['Stuffing (tray)', 0, [['In the oven', 35, 'oven', 180]]],
    ['Pigs in blankets', 0, [['In the oven', 30, 'oven', 200]]],
    ['Salmon fillets', 0, [['In the oven', 15, 'oven', 200]]],
    ['Lasagne (assembled)', 0, [['In the oven', 45, 'oven', 180], ['Stand before cutting', 10, 'rest']]],
    ['Garlic bread', 0, [['In the oven', 10, 'oven', 200]]],
    ['Bread rolls, warmed', 0, [['In the oven', 8, 'oven', 180]]],
    ['Apple crumble (for after)', -45, [['Assemble', 10, 'hands'], ['In the oven', 40, 'oven', 180]]],
  ];

  const $ = (sel, root) => (root || document).querySelector(sel);

  // Tiny element builder. Strings become text nodes, so user text is never parsed as HTML.
  const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'open', 'hidden', 'type', 'placeholder', 'id', 'title', 'tabIndex', 'htmlFor', 'inputMode', 'name', 'step', 'min', 'max', 'readOnly', 'autocomplete', 'textContent']);
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') n.className = v;
        else if (k === 'style') n.style.cssText = v;
        else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
        else if (PROPS.has(k)) n[k] = v;
        else n.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return n;
  }

  // ---------- state ----------

  let plan;
  let sched;
  let openDish = null;
  let lastNowOff = null;
  let audio = null;
  let toastTimer = null;
  let loadNote = '';
  const autoHour12 = (() => {
    try {
      const o = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions();
      return o.hourCycle ? o.hourCycle === 'h12' || o.hourCycle === 'h11' : !!o.hour12;
    } catch (e) {
      return false;
    }
  })();
  const hour12 = () => (plan.hour12 == null ? autoHour12 : plan.hour12);
  const unit = () => plan.tempUnit;

  function nowMinute() {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
  }
  function nowOff() {
    return B.nowOffset(plan.serveAt, nowMinute());
  }

  function storageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }
  function storageSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      /* private mode, blocked storage: the page still works for this visit */
    }
  }

  function load() {
    const hash = location.hash.replace(/^#/, '');
    if (hash.startsWith('plan=')) {
      const p = B.decodePlan(hash.slice(5));
      if (p) {
        dropHash();
        loadNote = 'Loaded the dinner from the link.';
        return p;
      }
      loadNote = 'That link did not hold a readable dinner, so here is the example.';
    }
    const raw = storageGet(STORAGE_KEY);
    if (raw) {
      try {
        const v = B.validatePlan(JSON.parse(raw));
        if (v.ok) return v.plan;
      } catch (e) {
        /* fall through to the example */
      }
    }
    // First visit: the example, set to serve two and a half hours from now so the live view is live.
    const p = B.examplePlan();
    p.serveAt = (Math.ceil((nowMinute() + 150) / 5) * 5) % B.DAY;
    return p;
  }

  function save() {
    storageSet(STORAGE_KEY, JSON.stringify(plan));
  }

  // Once a linked plan is loaded, the hash would undo later edits on every reload, so it goes.
  function dropHash() {
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch (e) {
      location.hash = '';
    }
  }

  const reducedMotion = () => {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) {
      return false;
    }
  };

  const ids = (list) => new Set(list.map((x) => x.id));
  function uid(prefix, list) {
    const taken = ids(list);
    let id;
    do {
      id = prefix + Math.random().toString(36).slice(2, 7);
    } while (taken.has(id));
    return id;
  }

  // ---------- formatting ----------

  const fmtAt = (at) => B.formatAt(plan.serveAt, at, hour12());
  const fmtClock = (minute) => B.formatClock(minute, hour12());
  const fmtTemp = (t) => B.formatTemp(t, unit());

  function relative(deltaMin) {
    const m = Math.round(Math.abs(deltaMin));
    if (m < 1) return 'under a minute';
    return B.formatDuration(m);
  }

  function itemText(item) {
    switch (item.type) {
      case 'preheat':
        return { main: [el('span', { class: 'up' }, item.temp != null ? `Oven on, ${fmtTemp(item.temp)}` : 'Oven on')], meta: item.minutes ? `${B.formatDuration(item.minutes)} to come up to heat` : '' };
      case 'ovenOff':
        return { main: ['Oven is free'], meta: 'switch it off, or warm the plates' };
      case 'ready':
        return { main: [el('span', { class: 'dn' }, item.dishName), ' ready'], meta: 'keep warm' };
      case 'serve':
        return { main: ['Serve'], meta: '' };
      default: {
        const meta = [];
        if (item.kind === 'oven' && item.temp != null) meta.push(fmtTemp(item.temp));
        meta.push(B.formatDuration(item.minutes));
        if (item.kind === 'hob') meta.push('hob');
        const main = [el('span', { class: 'dn' }, item.dishName), ': ', item.title];
        if (item.ovenTo != null) main.push(' ', el('span', { class: 'up' }, `· oven to ${fmtTemp(item.ovenTo)}`));
        return { main, meta: meta.join(' · ') };
      }
    }
  }

  function plainItemText(item) {
    const t = itemText(item);
    return t.main.map((x) => (x.nodeType ? x.textContent : x)).join('');
  }

  // ---------- render: serve bar ----------

  function renderServe() {
    const input = $('#serveAt');
    const v = fmtClock24(plan.serveAt);
    if (input.value !== v) input.value = v;
    renderStartNow();
  }
  function fmtClock24(minute) {
    return B.formatClock(minute, false);
  }
  function renderStartNow() {
    const e = B.earliestServe(plan, nowMinute());
    const btn = $('#startNow');
    const label = fmtClock(e.serveAt);
    if (btn.dataset.serve === String(e.serveAt) && btn.dataset.label === label) return;
    btn.dataset.label = label;
    btn.replaceChildren('Start now → serve at ', el('b', { class: 'num' }, label));
    btn.title = `If the first job started this minute, everything would be ready at ${fmtClock(e.serveAt)}`;
    btn.dataset.serve = String(e.serveAt);
  }

  // ---------- render: timeline ----------

  function renderTimeline() {
    sched = B.schedule(plan);
    const col = $('#timelineCol');
    col.style.setProperty('--timew', hour12() ? '74px' : '48px');

    const summary = $('#summary');
    if (!plan.dishes.length) summary.replaceChildren();
    else {
      const jobs = sched.jobCount;
      summary.replaceChildren(
        el('span', null, 'First job ', el('b', { class: 'num' }, fmtAt(sched.startAt))),
        el('span', null, el('b', null, B.formatDuration(sched.span)), ' from first job to serving'),
        el('span', null, el('b', null, String(plan.dishes.length)), ` dish${plan.dishes.length === 1 ? '' : 'es'}, `, el('b', null, String(jobs)), ` job${jobs === 1 ? '' : 's'}`),
      );
    }

    const flags = $('#flags');
    flags.replaceChildren(
      ...sched.conflicts.map((c) => {
        const when = el('span', { class: 'when num' }, `${fmtAt(c.from)}–${fmtAt(c.to)}`);
        if (c.type === 'oven') {
          return el('li', { class: 'flag oven' }, el('b', null, 'Oven clash. '), `${c.dishes.join(' and ')} want ${fmtTemp(c.low)} and ${fmtTemp(c.high)} at the same time. `, when, el('span', { class: 'fix' }, 'Shift one dish so they don’t overlap (change its “ready before serve”), or settle on one temperature.'));
        }
        if (c.type === 'hob') {
          return el('li', { class: 'flag hob' }, el('b', null, `${c.count} pans, ${c.rings} rings. `), `${c.dishes.join(', ')}. `, when, el('span', { class: 'fix' }, 'Stagger one of them, or change the number of rings in Settings.'));
        }
        return el('li', { class: 'flag hands' }, el('b', null, 'Two hands-on jobs at once. '), `${c.dishes.join(' and ')}. `, when, el('span', { class: 'fix' }, 'Fine if someone can help; otherwise give one dish a couple of minutes more rest.'));
      }),
    );

    const list = $('#timeline');
    if (!plan.dishes.length) {
      list.replaceChildren(el('li', { class: 'empty' }, 'No dishes yet. Add one below, pick a preset, or bring back the roast dinner from Tools.'));
      $('#printHead').replaceChildren();
      renderNext();
      return;
    }
    list.replaceChildren(
      ...sched.events.map((g) => {
        const c = B.clockOf(plan.serveAt, g.at);
        const dayText = B.formatDay(c.day);
        return el(
          'li',
          { class: 'ev', 'data-at': String(g.at) },
          el('div', { class: 'when' }, fmtClock(c.minute), dayText ? el('small', null, dayText) : null),
          el('div', { class: 'tick', 'aria-hidden': 'true' }),
          el(
            'ul',
            { class: 'items' },
            ...g.items.map((item) => {
              const t = itemText(item);
              const done = !!plan.done[item.key];
              const colour = item.dishIndex != null ? `--dc: var(--d${item.dishIndex % DISH_COLOURS})` : null;
              const cls = ['item', item.type, done ? 'done' : '', item.ovenTo != null ? 'oven-note' : ''].join(' ').trim();
              const box = el('input', {
                type: 'checkbox',
                checked: done,
                'aria-label': `Done: ${plainItemText(item)}`,
                onchange: () => setDone(item.key, box.checked),
              });
              return el('li', { class: cls, 'data-key': item.key, style: colour }, el('label', null, box, el('span', { class: 'text' }, el('div', { class: 'main' }, ...t.main), t.meta ? el('div', { class: 'meta' }, t.meta) : null)));
            }),
          ),
        );
      }),
    );
    $('#printHead').replaceChildren(el('h1', null, `Serve at ${fmtClock(plan.serveAt)}`), el('div', { class: 'muted' }, `${plan.dishes.map((d) => d.name || 'Dish').join(', ')}. First job ${fmtAt(sched.startAt)}. Made with Backtime.`));
    tick(true);
  }

  // ---------- render: next up ----------

  function renderNext() {
    const box = $('#next');
    box.className = 'next';
    if (!plan.dishes.length) {
      box.replaceChildren(el('div', { class: 'lead' }, 'Next up'), el('div', { class: 'big' }, 'Nothing yet'), el('div', { class: 'what' }, 'Add a dish and the timeline appears here.'));
      return;
    }
    const nx = B.nextItem(sched, plan.done);
    if (!nx) {
      box.classList.add('done');
      box.replaceChildren(el('div', { class: 'lead' }, 'Next up'), el('div', { class: 'big' }, 'All done'), el('div', { class: 'what' }, 'Everything is ticked. Enjoy it.'), el('div', { class: 'hint' }, el('button', { class: 'small ghost', onclick: startOver }, 'Start over')));
      return;
    }
    const now = nowOff();
    const delta = nx.at - now;
    const t = itemText(nx.item);
    if (now > 15 && !Object.keys(plan.done).length && nx.at < now) {
      // The serve time went by and nothing was ticked: this is a plan for another day, not a late dinner.
      box.classList.add('stale');
      box.replaceChildren(
        el('div', { class: 'lead' }, 'For another day'),
        el('div', { class: 'big num' }, `${fmtClock(plan.serveAt)} has passed`),
        el('div', { class: 'what' }, el('div', { class: 'main' }, 'The timeline is still right for the next time you serve at ', el('b', { class: 'num' }, fmtClock(plan.serveAt)), '.'), el('div', { class: 'meta' }, 'Change the time above, or press Start now to cook it from this minute.')),
      );
      document.title = 'Backtime';
      return;
    }
    let big;
    let lead = 'Next up';
    if (nx.at < -LIVE_WINDOW || nx.at > 360) {
      big = fmtAt(nx.at);
    } else if (delta > 0.5) {
      big = `In ${relative(delta)}`;
    } else if (delta > -1.5) {
      big = 'Now';
      lead = 'Right now';
      box.classList.add('due');
    } else {
      big = `${relative(delta)} behind`;
      lead = 'Waiting on you';
      box.classList.add('due', 'behind');
    }
    const hint = [];
    if (nx.item.type === 'serve') {
      hint.push('Everything else is ticked. Plates out.');
    } else {
      hint.push(el('span', { class: 'num' }, `at ${fmtAt(nx.at)}`));
    }
    if (delta < -4 && nx.item.type !== 'serve') {
      hint.push(el('button', { class: 'small', onclick: () => nudgeServe(5) }, 'Serve 5 min later'));
    }
    box.replaceChildren(
      el('div', { class: 'lead' }, lead),
      el('div', { class: 'big num' }, big),
      el('div', { class: 'what' }, el('div', { class: 'main' }, ...t.main), t.meta ? el('div', { class: 'meta' }, t.meta) : null),
      el('div', { class: 'act' }, el('button', { class: 'primary', onclick: () => setDone(nx.item.key, true) }, nx.item.type === 'serve' ? 'Served' : 'Done')),
      el('div', { class: 'hint' }, ...hint),
    );
    document.title = nx.item.type === 'serve' ? 'Serve — Backtime' : `${big} · ${plainItemText(nx.item)} — Backtime`;
  }

  // Runs every second: moves the "now" line, dims the past, chimes when a job comes due.
  function tick(force) {
    if (!plan.dishes.length) {
      document.title = 'Backtime';
      return;
    }
    const now = nowOff();
    const list = $('#timeline');
    const rows = Array.from(list.querySelectorAll('.ev'));
    let marker = list.querySelector('.now');
    if (!marker) {
      marker = el('li', { class: 'now', 'aria-hidden': 'true' }, el('span', { class: 'now-time' }), el('span', { class: 'now-line' }));
    }
    let placed = false;
    const nx = B.nextItem(sched, plan.done);
    for (const row of rows) {
      const at = Number(row.dataset.at);
      row.classList.toggle('past', at <= now);
      const items = Array.from(row.querySelectorAll('.item'));
      row.classList.toggle('all-done', items.every((i) => i.classList.contains('done')));
      const isNext = nx && at === nx.at && items.some((i) => i.dataset.key === nx.item.key);
      row.classList.toggle('next-up', !!isNext);
      if (!placed && at > now) {
        if (marker.nextSibling !== row) list.insertBefore(marker, row);
        placed = true;
      }
    }
    if (!placed && list.lastElementChild !== marker) list.append(marker);
    marker.querySelector('.now-time').textContent = fmtClock(Math.floor(nowMinute()));

    // The countdown in the card changes once a minute; rebuild it only then, or when asked.
    if (force || (nx && Math.floor(lastNowOff) !== Math.floor(now))) renderNext();
    renderStartNow();

    if (lastNowOff != null && now > lastNowOff && now - lastNowOff < 5 && plan.sound) {
      for (const g of sched.events) {
        if (g.at > lastNowOff && g.at <= now && g.items.some((i) => !plan.done[i.key])) chime();
      }
    }
    lastNowOff = now;
  }

  // ---------- render: dishes ----------

  function renderDishes() {
    const wrap = $('#dishes');
    wrap.replaceChildren(...plan.dishes.map((d, i) => renderDish(d, i)));
  }

  function dishStart(d) {
    const own = sched.intervals.filter((iv) => iv.dishId === d.id);
    if (!own.length) return '';
    return fmtAt(Math.min(...own.map((iv) => iv.start)));
  }

  function renderDish(d, index) {
    const colour = `--dc: var(--d${index % DISH_COLOURS})`;
    const isOpen = openDish === d.id;
    const card = el('article', { class: 'dish' + (isOpen ? ' open' : ''), style: colour, 'data-id': d.id });
    const head = el(
      'div',
      {
        class: 'dish-head',
        role: 'button',
        tabIndex: 0,
        'aria-expanded': String(isOpen),
        'aria-label': `${d.name || 'Dish'}: ${isOpen ? 'close' : 'edit'}`,
        onclick: () => toggleDish(d.id),
        onkeydown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleDish(d.id);
          }
        },
      },
      el('span', { class: 'dot' }),
      el('span', { class: 'name' }, d.name || `Dish ${index + 1}`),
      el('span', { class: 'starts' }, dishStart(d) ? `starts ${dishStart(d)}` : 'no steps'),
      el('span', { class: 'chev', 'aria-hidden': 'true' }, '›'),
      el('span', { class: 'sum' }, B.summarizeDish(d, unit())),
    );
    card.append(head);
    if (isOpen) card.append(renderEditor(d, card));
    return card;
  }

  function refreshHead(card, d) {
    $('.name', card).textContent = d.name || `Dish ${plan.dishes.indexOf(d) + 1}`;
    $('.starts', card).textContent = dishStart(d) ? `starts ${dishStart(d)}` : 'no steps';
    $('.sum', card).textContent = B.summarizeDish(d, unit());
    $('.dish-head', card).setAttribute('aria-label', `${d.name || 'Dish'}: close`);
  }

  function renderEditor(d, card) {
    const body = el('div', { class: 'dish-body' });
    const name = el('input', {
      type: 'text',
      class: 'wide',
      value: d.name,
      placeholder: 'Dish name',
      maxlength: String(B.LIMITS.name),
      'aria-label': 'Dish name',
      oninput: () => {
        d.name = name.value.trim();
        commit({ dishes: false });
        refreshHead(card, d);
      },
    });
    body.append(el('div', { class: 'field' }, el('label', { class: 'sr-only', htmlFor: 'n' }, 'Name'), name));

    const steps = el('ul', { class: 'steps' });
    d.steps.forEach((s, i) => steps.append(renderStep(d, s, i, card)));
    body.append(steps);

    const addStep = el(
      'button',
      {
        class: 'small',
        onclick: () => {
          const last = d.steps[d.steps.length - 1];
          d.steps.push({ id: uid('s', d.steps), label: '', minutes: 10, kind: last ? last.kind : 'oven', temp: last && last.kind === 'oven' ? last.temp : 180 });
          commit({ dishes: false });
          const row = renderStep(d, d.steps[d.steps.length - 1], d.steps.length - 1, card);
          steps.append(row);
          refreshHead(card, d);
          $('.label', row).focus();
        },
      },
      '+ Add step',
    );

    const rb = el('input', {
      type: 'number',
      min: '0',
      max: String(B.LIMITS.readyBefore),
      step: '1',
      class: 'num ready',
      value: String(Math.abs(d.readyBefore)),
      'aria-label': 'Minutes',
      oninput: () => {
        const v = Number(rb.value);
        if (!Number.isFinite(v)) return;
        d.readyBefore = Math.max(0, Math.min(B.LIMITS.readyBefore, Math.round(v))) * (side.value === 'after' ? -1 : 1);
        commit({ dishes: false });
        refreshHead(card, d);
      },
    });
    const side = el(
      'select',
      {
        'aria-label': 'Before or after serving',
        onchange: () => {
          d.readyBefore = Math.abs(d.readyBefore) * (side.value === 'after' ? -1 : 1);
          commit({ dishes: false });
          refreshHead(card, d);
        },
      },
      el('option', { value: 'before', selected: d.readyBefore >= 0 }, 'before serving'),
      el('option', { value: 'after', selected: d.readyBefore < 0 }, 'after serving'),
    );
    body.append(el('div', { class: 'field' }, 'Finish ', rb, ' min ', side));

    body.append(
      el(
        'div',
        { class: 'dish-tools' },
        addStep,
        el(
          'button',
          {
            class: 'small ghost danger',
            onclick: () => {
              if (!confirm(`Remove “${d.name || 'this dish'}” and its steps?`)) return;
              plan.dishes = plan.dishes.filter((x) => x.id !== d.id);
              for (const k of Object.keys(plan.done)) if (k.startsWith(d.id + '/')) delete plan.done[k];
              openDish = null;
              commit();
              toast(`Removed ${d.name || 'the dish'}.`);
            },
          },
          'Remove dish',
        ),
      ),
    );
    return body;
  }

  function renderStep(d, s, i, card) {
    const row = el('li', { class: 'steprow', 'data-id': s.id });
    const kind = el(
      'select',
      {
        class: 'kind',
        'aria-label': 'Kind of step',
        onchange: () => {
          s.kind = kind.value;
          if (s.kind === 'oven' && s.temp == null) s.temp = 180;
          commit({ dishes: false });
          tempWrap.hidden = s.kind !== 'oven';
          refreshHead(card, d);
        },
      },
      el('option', { value: 'oven', selected: s.kind === 'oven' }, 'Oven'),
      el('option', { value: 'hob', selected: s.kind === 'hob' }, 'Hob'),
      el('option', { value: 'hands', selected: s.kind === 'hands' }, 'Hands-on'),
      el('option', { value: 'rest', selected: s.kind === 'rest' }, 'Rest'),
    );
    const label = el('input', {
      type: 'text',
      class: 'label',
      value: s.label,
      placeholder: B.stepTitle({ kind: s.kind, label: '' }),
      maxlength: String(B.LIMITS.name),
      'aria-label': 'What happens',
      oninput: () => {
        s.label = label.value.trim();
        commit({ dishes: false });
        refreshHead(card, d);
      },
    });
    const dur = el('span', { class: 'dur num' }, B.formatDuration(s.minutes));
    const minutes = el('input', {
      type: 'text',
      inputMode: 'numeric',
      class: 'minutes num',
      value: String(s.minutes),
      placeholder: 'min',
      'aria-label': 'Minutes (you can type 1h20)',
      title: 'Minutes. You can also type 1h20 or 1:20.',
      oninput: () => {
        const v = B.parseMinutes(minutes.value);
        minutes.classList.toggle('invalid', v == null);
        if (v == null) return;
        s.minutes = Math.min(B.LIMITS.minutes, v);
        dur.textContent = B.formatDuration(s.minutes);
        commit({ dishes: false });
        refreshHead(card, d);
      },
      onchange: () => {
        minutes.value = String(s.minutes);
        minutes.classList.remove('invalid');
      },
    });
    const bump = (n) =>
      el(
        'button',
        {
          class: 'small',
          'aria-label': `${n > 0 ? 'Add' : 'Take off'} ${Math.abs(n)} minutes`,
          onclick: () => {
            s.minutes = Math.max(0, Math.min(B.LIMITS.minutes, s.minutes + n));
            minutes.value = String(s.minutes);
            minutes.classList.remove('invalid');
            dur.textContent = B.formatDuration(s.minutes);
            commit({ dishes: false });
            refreshHead(card, d);
          },
        },
        n > 0 ? `+${n}` : String(n),
      );
    const temp = el('input', {
      type: 'number',
      class: 'temp num',
      min: String(B.LIMITS.temp[0]),
      max: String(B.LIMITS.temp[1]),
      step: '5',
      value: s.temp == null ? '' : String(s.temp),
      placeholder: '°',
      'aria-label': 'Oven temperature',
      oninput: () => {
        const v = temp.value.trim() === '' ? null : Number(temp.value);
        s.temp = v == null || !Number.isFinite(v) ? null : Math.max(B.LIMITS.temp[0], Math.min(B.LIMITS.temp[1], Math.round(v)));
        commit({ dishes: false });
        refreshHead(card, d);
      },
    });
    const tempWrap = el('span', { class: 'tempwrap', hidden: s.kind !== 'oven' }, temp, el('span', { class: 'unit' }, `°${unit()}`));
    const move = (dir) =>
      el(
        'button',
        {
          class: 'small ghost',
          'aria-label': dir < 0 ? 'Move step up' : 'Move step down',
          onclick: () => {
            const idx = d.steps.indexOf(s);
            const j = idx + dir;
            if (j < 0 || j >= d.steps.length) return;
            d.steps.splice(idx, 1);
            d.steps.splice(j, 0, s);
            commit({ dishes: false });
            const list = row.parentNode;
            if (dir < 0) list.insertBefore(row, row.previousElementSibling);
            else if (row.nextElementSibling) list.insertBefore(row.nextElementSibling, row);
            refreshHead(card, d);
          },
        },
        dir < 0 ? '▲' : '▼',
      );
    const remove = el(
      'button',
      {
        class: 'small ghost remove',
        'aria-label': 'Remove step',
        onclick: () => {
          const idx = d.steps.indexOf(s);
          if (idx < 0) return;
          d.steps.splice(idx, 1);
          delete plan.done[`${d.id}/${s.id}`];
          commit({ dishes: false });
          const list = row.parentNode;
          row.remove();
          refreshHead(card, d);
          toast(`Removed “${B.stepTitle(s)}”.`, 'Undo', () => {
            d.steps.splice(Math.min(idx, d.steps.length), 0, s);
            commit({ dishes: false });
            const back = renderStep(d, s, idx, card);
            const after = list.children[idx];
            if (after) list.insertBefore(back, after);
            else list.append(back);
            refreshHead(card, d);
          });
        },
      },
      '×',
    );
    row.append(kind, label, remove, el('div', { class: 'time' }, minutes, bump(-5), bump(5), dur, tempWrap, el('span', { class: 'spacer' }), el('span', { class: 'order' }, move(-1), move(1))));
    return row;
  }

  function toggleDish(id) {
    openDish = openDish === id ? null : id;
    renderDishes();
    if (openDish) {
      const card = $(`.dish[data-id="${openDish}"]`);
      if (card) card.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
    }
  }

  // ---------- actions ----------

  function commit(opts) {
    const o = Object.assign({ dishes: true, timeline: true }, opts);
    save();
    if (o.timeline) renderTimeline();
    if (o.dishes) renderDishes();
    renderServe();
  }

  function setDone(key, value) {
    if (value) plan.done[key] = true;
    else delete plan.done[key];
    save();
    const item = $(`#timeline .item[data-key="${CSS.escape(key)}"]`);
    if (item) {
      item.classList.toggle('done', !!value);
      const box = item.querySelector('input');
      if (box && box.checked !== !!value) box.checked = !!value;
    }
    tick(true);
  }

  function startOver() {
    plan.done = {};
    commit({ dishes: false });
    toast('Ticks cleared. Same plan, fresh start.');
  }

  function nudgeServe(n) {
    plan.serveAt = (((plan.serveAt + n) % B.DAY) + B.DAY) % B.DAY;
    commit();
  }

  function addDish(preset) {
    const d = { id: uid('d', plan.dishes), name: '', readyBefore: 0, steps: [] };
    if (preset) {
      d.name = preset[0];
      d.readyBefore = preset[1];
      d.steps = preset[2].map((s, i) => ({ id: `s${i + 1}`, label: s[0], minutes: s[1], kind: s[2], temp: s[3] == null ? null : s[3] }));
    } else {
      d.steps = [{ id: 's1', label: '', minutes: 20, kind: 'oven', temp: 180 }];
    }
    plan.dishes.push(d);
    openDish = d.id;
    commit();
    const card = $(`.dish[data-id="${d.id}"]`);
    if (card) {
      card.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
      const nameInput = $('input[type="text"]', card);
      if (!preset && nameInput) nameInput.focus();
    }
  }

  function exportFile() {
    const name = (plan.dishes[0] && plan.dishes[0].name ? plan.dishes[0].name : 'dinner').toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'dinner';
    const blob = new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: `backtime-${name}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('Saved as a .json file.');
  }

  function importFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let parsed;
      try {
        parsed = JSON.parse(String(reader.result));
      } catch (e) {
        toast('That file is not JSON, so nothing changed.');
        return;
      }
      const v = B.validatePlan(parsed);
      if (!v.ok) {
        toast('That file is not a Backtime dinner, so nothing changed.');
        return;
      }
      plan = v.plan;
      openDish = null;
      commit();
      toast(v.problems.length ? `Loaded, with ${v.problems.length} thing${v.problems.length === 1 ? '' : 's'} tidied up.` : `Loaded ${plan.dishes.length} dish${plan.dishes.length === 1 ? '' : 'es'}.`);
    };
    reader.onerror = () => toast('Could not read that file.');
    reader.readAsText(file);
  }

  function copyLink() {
    const url = location.href.split('#')[0] + '#plan=' + B.encodePlan(plan);
    const box = $('#linkbox');
    box.value = url;
    box.hidden = false;
    const done = () => toast('Link copied. Anyone who opens it gets this dinner.');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, () => {
        box.select();
        toast('Copy the link from the box below.');
      });
    } else {
      box.select();
      toast('Copy the link from the box below.');
    }
  }

  function resetExample() {
    if (plan.dishes.length && !confirm('Replace your dishes with the example roast dinner?')) return;
    plan = B.examplePlan();
    openDish = null;
    commit();
    toast('Back to the roast dinner.');
  }

  // ---------- toast ----------

  function toast(text, actionLabel, action) {
    const t = $('#toast');
    clearTimeout(toastTimer);
    t.replaceChildren(el('span', null, text));
    if (actionLabel) {
      t.append(
        el(
          'button',
          {
            onclick: () => {
              action();
              t.classList.remove('show');
            },
          },
          actionLabel,
        ),
      );
    }
    t.classList.add('show');
    toastTimer = setTimeout(() => t.classList.remove('show'), actionLabel ? 7000 : 3500);
  }

  // ---------- sound ----------

  function ensureAudio() {
    if (audio) return audio;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      audio = Ctx ? new Ctx() : null;
    } catch (e) {
      audio = null;
    }
    return audio;
  }
  function chime() {
    const ctx = ensureAudio();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const t0 = ctx.currentTime;
    [[660, 0], [880, 0.18]].forEach(([freq, dt]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0 + dt);
      g.gain.exponentialRampToValueAtTime(0.25, t0 + dt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.5);
      o.connect(g).connect(ctx.destination);
      o.start(t0 + dt);
      o.stop(t0 + dt + 0.55);
    });
  }

  // ---------- settings ----------

  function renderSettings() {
    $('#preheat').value = String(plan.preheat);
    $('#hobRings').value = String(plan.hobRings);
    $('#tolerance').value = String(plan.ovenTolerance);
    $('#tempUnit').value = plan.tempUnit;
    $('#clock').value = plan.hour12 == null ? 'auto' : plan.hour12 ? '12' : '24';
    $('#sound').checked = plan.sound;
    $('#theme').value = storageGet(THEME_KEY) || 'auto';
  }

  function applyTheme(v) {
    if (v === 'light' || v === 'dark') document.documentElement.dataset.theme = v;
    else delete document.documentElement.dataset.theme;
  }

  function wire() {
    $('#serveAt').addEventListener('change', (e) => {
      const v = B.parseTime(e.target.value);
      if (v == null) return;
      plan.serveAt = v;
      commit();
    });
    document.querySelectorAll('.nudge button').forEach((b) => b.addEventListener('click', () => nudgeServe(Number(b.dataset.nudge))));
    $('#startNow').addEventListener('click', () => {
      const v = Number($('#startNow').dataset.serve);
      if (!Number.isFinite(v)) return;
      plan.serveAt = v;
      commit();
      const wait = sched.startAt - nowOff();
      toast(`Serving at ${fmtClock(v)}. First job ${wait < 0.5 ? 'right now' : `in ${relative(wait)}`}.`);
    });
    $('#addDish').addEventListener('click', () => addDish(null));
    const presetSel = $('#preset');
    PRESETS.forEach((p, i) => presetSel.append(el('option', { value: String(i) }, p[0])));
    presetSel.addEventListener('change', () => {
      const p = PRESETS[Number(presetSel.value)];
      presetSel.value = '';
      if (p) addDish(p);
    });

    const num = (id, key, lo, hi) =>
      $(id).addEventListener('change', (e) => {
        const v = Number(e.target.value);
        if (!Number.isFinite(v)) return;
        plan[key] = Math.max(lo, Math.min(hi, Math.round(v)));
        e.target.value = String(plan[key]);
        commit();
      });
    num('#preheat', 'preheat', B.LIMITS.preheat[0], B.LIMITS.preheat[1]);
    num('#hobRings', 'hobRings', B.LIMITS.hobRings[0], B.LIMITS.hobRings[1]);
    num('#tolerance', 'ovenTolerance', B.LIMITS.tolerance[0], B.LIMITS.tolerance[1]);
    $('#tempUnit').addEventListener('change', (e) => {
      plan.tempUnit = e.target.value === 'F' ? 'F' : 'C';
      commit();
    });
    $('#clock').addEventListener('change', (e) => {
      plan.hour12 = e.target.value === 'auto' ? null : e.target.value === '12';
      commit();
    });
    $('#sound').addEventListener('change', (e) => {
      plan.sound = e.target.checked;
      save();
      if (plan.sound) {
        ensureAudio();
        chime();
      }
    });
    $('#theme').addEventListener('change', (e) => {
      storageSet(THEME_KEY, e.target.value);
      applyTheme(e.target.value);
    });
    $('#export').addEventListener('click', exportFile);
    $('#import').addEventListener('click', () => $('#file').click());
    $('#file').addEventListener('change', (e) => {
      importFile(e.target.files && e.target.files[0]);
      e.target.value = '';
    });
    $('#copyLink').addEventListener('click', copyLink);
    $('#print').addEventListener('click', () => window.print());
    $('#startOver').addEventListener('click', startOver);
    $('#reset').addEventListener('click', resetExample);
    window.addEventListener('hashchange', () => {
      const hash = location.hash.replace(/^#/, '');
      if (!hash.startsWith('plan=')) return;
      const p = B.decodePlan(hash.slice(5));
      dropHash();
      if (!p) return toast('That link did not hold a readable dinner.');
      plan = p;
      openDish = null;
      commit();
      toast('Loaded the dinner from the link.');
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) tick(true);
    });
  }

  // ---------- go ----------

  applyTheme(storageGet(THEME_KEY) || 'auto');
  plan = load();
  wire();
  renderSettings();
  commit();
  if (loadNote) toast(loadNote);
  setInterval(() => tick(false), 1000);

  // For poking around in the console and for the UI tests.
  window.backtime = {
    get plan() {
      return plan;
    },
    set plan(p) {
      plan = B.validatePlan(p).plan;
      openDish = null;
      commit();
    },
    get schedule() {
      return sched;
    },
    core: B,
    presets: PRESETS,
  };
})();
