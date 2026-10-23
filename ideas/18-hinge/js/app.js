/* Hinge — the page. Editing, storage, and rendering. The math lives in hinge.js. */
(function () {
  'use strict';
  const H = window.Hinge;
  const EXAMPLES = window.HingeExamples;
  const $ = (sel, el) => (el || document).querySelector(sel);
  const STORE_KEY = 'hinge.v1';
  const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)'];
  const KIND_LABEL = { range: 'range', chance: 'chance', fixed: 'fixed', formula: 'formula' };

  const state = { cases: [], current: null, precise: false };
  let seed = 1;
  let selectedRow = null;
  let lastResult = null;
  let computeTimer = null;
  let saveTimer = null;

  const uid = (p) => p + Math.random().toString(36).slice(2, 9);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------------------------------------------------------------- storage

  function newCase(model) {
    return Object.assign(H.normalizeModel(model), { id: uid('c'), updatedAt: Date.now() });
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && Array.isArray(s.cases)) {
          for (const c of s.cases) {
            try {
              state.cases.push(Object.assign(H.normalizeModel(c), { id: typeof c.id === 'string' ? c.id : uid('c'), updatedAt: c.updatedAt || 0 }));
            } catch (e) {
              /* one damaged case is dropped; the others survive */
            }
          }
          state.current = s.current;
          state.precise = !!s.precise;
        }
      }
    } catch (e) {
      state.cases = [];
    }
    if (!state.cases.length) state.cases.push(newCase(EXAMPLES[0]));
    if (!state.cases.find((c) => c.id === state.current)) state.current = state.cases[0].id;
  }

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(state));
      } catch (e) {
        /* private mode or storage full: the page still works, it just forgets */
      }
    }, 150);
  }

  const current = () => state.cases.find((c) => c.id === state.current);

  function touch() {
    const c = current();
    c.updatedAt = Date.now();
    save();
    scheduleCompute();
  }

  // ---------------------------------------------------------------- number text

  function numText(v, pct) {
    if (!Number.isFinite(v)) return '';
    if (pct) return `${+(v * 100).toPrecision(10)}%`;
    const a = Math.abs(v);
    for (const [div, suf] of [[1e9, 'B'], [1e6, 'M'], [1e3, 'k']]) {
      if (a >= div) {
        const m = v / div;
        if (Math.abs(m - +m.toPrecision(4)) <= 1e-9 * Math.abs(m)) return `${+m.toPrecision(10)}${suf}`;
      }
    }
    return String(+v.toPrecision(10));
  }

  // ---------------------------------------------------------------- the editor

  function rowHTML(row) {
    const kindSel = `<select class="kind" aria-label="Kind of assumption">${Object.keys(KIND_LABEL).map((k) => `<option value="${k}"${row.kind === k ? ' selected' : ''}>${KIND_LABEL[k]}</option>`).join('')}</select>`;
    let vals = '';
    if (row.kind === 'range') {
      vals = `<input class="lo" value="${esc(numText(row.lo, row.pct))}" placeholder="low" aria-label="Low (5th percentile)" inputmode="decimal" autocomplete="off"> <span>to</span> <input class="hi" value="${esc(numText(row.hi, row.pct))}" placeholder="high" aria-label="High (95th percentile)" inputmode="decimal" autocomplete="off">
        <select class="shape" aria-label="Shape of the distribution"><option value="auto"${row.shape === 'auto' ? ' selected' : ''}>auto</option><option value="lognormal"${row.shape === 'lognormal' ? ' selected' : ''}>lognormal</option><option value="normal"${row.shape === 'normal' ? ' selected' : ''}>normal</option><option value="uniform"${row.shape === 'uniform' ? ' selected' : ''}>uniform</option></select>
        <span class="dist-note">${esc(distNote(row))}</span>`;
    } else if (row.kind === 'chance') {
      vals = `<input class="p" value="${esc(Number.isFinite(row.p) ? numText(row.p, true) : '')}" placeholder="e.g. 40%" aria-label="Probability" inputmode="decimal" autocomplete="off"> <span class="dist-note">1 when it happens, 0 when it does not</span>`;
    } else if (row.kind === 'fixed') {
      vals = `<input class="value" value="${esc(numText(row.value, row.pct))}" placeholder="value" aria-label="Value" inputmode="decimal" autocomplete="off"> <span class="dist-note">a fact, not a guess</span>`;
    } else {
      vals = `<textarea class="expr" rows="1" placeholder="formula using other rows" aria-label="Formula" autocomplete="off" spellcheck="false">${esc(row.expr || '')}</textarea>`;
    }
    return `<li class="row" data-id="${esc(row.id)}">
      <input class="name" value="${esc(row.name)}" placeholder="name" aria-label="Name" autocomplete="off" spellcheck="false" maxlength="40">
      ${kindSel}
      <button type="button" class="del" aria-label="Delete this assumption">×</button>
      <div class="vals">${vals}</div>
      <input class="note" value="${esc(row.note || '')}" placeholder="where does this number come from?" aria-label="Note" maxlength="300" autocomplete="off">
      <p class="err"></p>
    </li>`;
  }

  function distNote(row) {
    if (row.kind !== 'range' || !Number.isFinite(row.lo) || !Number.isFinite(row.hi) || row.lo >= row.hi) return '';
    const shape = H.rangeShape(row.lo, row.hi, row.shape);
    if (shape === 'uniform') return 'equally likely anywhere between, never outside';
    const d = H.makeDist(row);
    const f = (x) => H.fmt(x, '', { pct: row.pct });
    if (shape === 'lognormal') return `90% interval; lognormal, median ${f(d.median)}, 1-in-100 tail at ${f(d.quantile(0.99))}`;
    const below0 = row.lo >= 0 ? d.cdf(0) : 0;
    const spill = below0 >= 0.001 ? `; ${H.fmtPct(below0)} chance below 0 (choose uniform if it cannot be negative)` : '';
    return `90% interval; normal, mean ${f(d.median)}${spill}`;
  }

  function optHTML(opt, j) {
    return `<li class="opt" data-id="${esc(opt.id)}">
      <i class="swatch" style="background:${SERIES[j] || 'var(--ink-3)'}"></i>
      <input class="oname" value="${esc(opt.name)}" placeholder="option name" aria-label="Option name" maxlength="60" autocomplete="off">
      <button type="button" class="del" aria-label="Delete this option">×</button>
      <textarea class="expr" rows="1" placeholder="formula using the assumptions" aria-label="Formula" autocomplete="off" spellcheck="false">${esc(opt.expr)}</textarea>
      <p class="err"></p>
    </li>`;
  }

  function grow(el) {
    if (!el || el.tagName !== 'TEXTAREA') return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }

  function growAll(root) {
    (root || document).querySelectorAll('textarea.expr').forEach(grow);
  }

  function renderEditor() {
    const c = current();
    $('#title').value = c.title;
    $('#unit').value = c.unit;
    $('#goal').value = c.goal;
    $('#target').value = c.target == null ? '' : numText(c.target);
    $('#rows').innerHTML = c.rows.map(rowHTML).join('');
    $('#options').innerHTML = c.options.map(optHTML).join('');
    $('#target-field').classList.toggle('off', c.options.length !== 1);
    document.querySelectorAll('#rows .row .name').forEach((el) => { el.dataset.prev = el.value; });
    growAll();
    renderCaseSelect();
  }

  function renderCaseSelect() {
    const sel = $('#case-select');
    sel.innerHTML = state.cases.map((c) => `<option value="${esc(c.id)}"${c.id === state.current ? ' selected' : ''}>${esc(c.title || 'Untitled')}</option>`).join('');
  }

  function renameReferences(oldName, newName) {
    if (!oldName || oldName === newName) return;
    const re = new RegExp(`(^|[^A-Za-z0-9_])${oldName.replace(/[^A-Za-z0-9_]/g, '\\$&')}(?![A-Za-z0-9_])`, 'g');
    const fix = (s) => String(s || '').replace(re, (m, pre) => pre + newName);
    const c = current();
    c.rows.forEach((r) => { if (r.kind === 'formula') r.expr = fix(r.expr); });
    c.options.forEach((o) => { o.expr = fix(o.expr); });
    document.querySelectorAll('#rows .row').forEach((li) => {
      const r = c.rows.find((x) => x.id === li.dataset.id);
      if (r && r.kind === 'formula') { $('.expr', li).value = r.expr; grow($('.expr', li)); }
    });
    document.querySelectorAll('#options .opt').forEach((li) => {
      const o = c.options.find((x) => x.id === li.dataset.id);
      if (o) { $('.expr', li).value = o.expr; grow($('.expr', li)); }
    });
  }

  function uniqueName(base, exceptId) {
    const c = current();
    let name = base || 'x';
    let k = 2;
    while (c.rows.some((r) => r.id !== exceptId && r.name === name)) name = `${base}_${k++}`;
    return name;
  }

  function onRowInput(e) {
    const li = e.target.closest('.row');
    if (!li) return;
    const c = current();
    const row = c.rows.find((r) => r.id === li.dataset.id);
    if (!row) return;
    const t = e.target;
    const parseField = (el) => {
      const v = H.parseNumber(el.value);
      el.classList.toggle('bad', el.value.trim() !== '' && !Number.isFinite(v));
      return v;
    };
    if (t.classList.contains('name')) {
      return; // a name is committed when the field loses focus, so half-typed names never break formulas
    } else if (t.classList.contains('lo') || t.classList.contains('hi')) {
      row.lo = parseField($('.lo', li));
      row.hi = parseField($('.hi', li));
      row.pct = /%/.test($('.lo', li).value) || /%/.test($('.hi', li).value);
      $('.dist-note', li).textContent = distNote(row);
    } else if (t.classList.contains('shape')) {
      row.shape = t.value;
      $('.dist-note', li).textContent = distNote(row);
    } else if (t.classList.contains('p')) {
      row.p = parseField(t);
    } else if (t.classList.contains('value')) {
      row.value = parseField(t);
      row.pct = /%/.test(t.value);
    } else if (t.classList.contains('expr')) {
      row.expr = t.value;
      grow(t);
    } else if (t.classList.contains('note')) {
      row.note = t.value;
    } else return;
    touch();
  }

  function onRowBlur(e) {
    const t = e.target;
    if (!t.classList || !t.classList.contains('name')) return;
    const li = t.closest('.row');
    const c = current();
    const row = c.rows.find((r) => r.id === li.dataset.id);
    if (!row) return;
    const old = t.dataset.prev || '';
    const clean = uniqueName(H.toIdent(t.value) || old || 'x', row.id);
    if (clean !== t.value) t.value = clean;
    row.name = clean;
    if (old && old !== clean) renameReferences(old, clean);
    t.dataset.prev = clean;
    touch();
  }

  function onRowChange(e) {
    const li = e.target.closest('.row');
    if (!li || !e.target.classList.contains('kind')) return;
    const c = current();
    const row = c.rows.find((r) => r.id === li.dataset.id);
    const kind = e.target.value;
    const old = row.kind;
    row.kind = kind;
    if (kind === 'range' && !(Number.isFinite(row.lo) && Number.isFinite(row.hi))) {
      const v = old === 'fixed' && Number.isFinite(row.value) ? row.value : 1;
      row.lo = v > 0 ? v * 0.8 : v - 1;
      row.hi = v > 0 ? v * 1.25 : v + 1;
      row.shape = 'auto';
    }
    if (kind === 'chance' && !Number.isFinite(row.p)) row.p = 0.5;
    if (kind === 'fixed' && !Number.isFinite(row.value)) row.value = old === 'range' && Number.isFinite(row.lo) ? H.makeDist({ kind: 'range', lo: row.lo, hi: row.hi, shape: row.shape }).median : 1;
    if (kind === 'formula' && !row.expr) row.expr = '';
    li.outerHTML = rowHTML(row);
    const fresh = $(`#rows .row[data-id="${CSS.escape(row.id)}"]`);
    $('.name', fresh).dataset.prev = row.name;
    growAll(fresh);
    touch();
  }

  function onOptInput(e) {
    const li = e.target.closest('.opt');
    if (!li) return;
    const c = current();
    const opt = c.options.find((o) => o.id === li.dataset.id);
    if (!opt) return;
    if (e.target.classList.contains('oname')) opt.name = e.target.value;
    else if (e.target.classList.contains('expr')) { opt.expr = e.target.value; grow(e.target); }
    else return;
    touch();
  }

  // A delete button must be pressed twice within a few seconds: no accidental losses, no dialogs.
  function armedDelete(btn, onDelete) {
    if (btn.classList.contains('armed')) {
      onDelete();
      return;
    }
    btn.classList.add('armed');
    btn.textContent = 'delete?';
    setTimeout(() => {
      if (btn.isConnected) {
        btn.classList.remove('armed');
        btn.textContent = '×';
      }
    }, 3000);
  }

  function addRow(kind) {
    const c = current();
    const name = uniqueName(kind === 'formula' ? 'derived' : kind === 'chance' ? 'event' : 'x');
    const row = { id: uid('r'), name, kind, note: '' };
    if (kind === 'range') Object.assign(row, { lo: 1, hi: 10, shape: 'auto', pct: false });
    else if (kind === 'chance') row.p = 0.5;
    else if (kind === 'fixed') Object.assign(row, { value: 1, pct: false });
    else row.expr = c.rows.length ? c.rows[0].name : '1';
    c.rows.push(row);
    $('#rows').insertAdjacentHTML('beforeend', rowHTML(row));
    const li = $(`#rows .row[data-id="${CSS.escape(row.id)}"]`);
    $('.name', li).dataset.prev = row.name;
    growAll(li);
    $('.name', li).focus();
    $('.name', li).select();
    touch();
  }

  function addOption() {
    const c = current();
    if (c.options.length >= 4) {
      flash('At most four options.');
      return;
    }
    const opt = { id: uid('o'), name: `Option ${c.options.length + 1}`, expr: c.rows.length ? c.rows[0].name : '0' };
    c.options.push(opt);
    $('#options').insertAdjacentHTML('beforeend', optHTML(opt, c.options.length - 1));
    $('#target-field').classList.toggle('off', c.options.length !== 1);
    const li = $(`#options .opt[data-id="${CSS.escape(opt.id)}"]`);
    growAll(li);
    $('.expr', li).focus();
    touch();
  }

  function flash(msg) {
    const el = $('#case-msg');
    el.textContent = msg;
    $('.manage').open = true;
    setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 5000);
  }

  // ---------------------------------------------------------------- compute

  function scheduleCompute() {
    clearTimeout(computeTimer);
    computeTimer = setTimeout(compute, 260);
  }

  function showErrors(errors) {
    const c = current();
    document.querySelectorAll('#rows .row').forEach((li) => {
      const es = errors.filter((e) => e.where === 'row' && e.id === li.dataset.id);
      $('.err', li).textContent = es.map((e) => e.message).join(' ');
      li.classList.toggle('has-error', es.length > 0);
    });
    document.querySelectorAll('#options .opt').forEach((li) => {
      const es = errors.filter((e) => e.where === 'option' && e.id === li.dataset.id);
      $('.err', li).textContent = es.map((e) => e.message).join(' ');
      li.classList.toggle('has-error', es.length > 0);
    });
    const box = $('#errors');
    if (!errors.length) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    const items = errors.map((e) => {
      let who = '';
      if (e.where === 'row') { const r = c.rows.find((x) => x.id === e.id); who = r ? `${r.name || 'assumption ' + (e.index + 1)}: ` : ''; }
      if (e.where === 'option') { const o = c.options.find((x) => x.id === e.id); who = o ? `${o.name || 'option ' + (e.index + 1)}: ` : ''; }
      return `<li>${esc(who + e.message)}</li>`;
    });
    box.innerHTML = `<strong>Fix these and the results come back.</strong><ul>${items.join('')}</ul>`;
    box.hidden = false;
  }

  function compute() {
    const c = current();
    const { errors } = H.compileModel(c);
    showErrors(errors);
    const out = $('#out');
    if (errors.length) {
      out.classList.add('stale');
      return;
    }
    out.classList.remove('stale');
    out.classList.add('busy');
    setTimeout(() => {
      let result;
      try {
        result = H.analyze(c, { n: state.precise ? 20000 : 5000, seed });
      } catch (e) {
        showErrors([{ where: 'case', message: e.message }]);
        out.classList.remove('busy');
        out.classList.add('stale');
        return;
      }
      lastResult = result;
      try {
        renderResults(result, c);
      } finally {
        out.classList.remove('busy');
      }
    }, 10);
  }

  // ---------------------------------------------------------------- rendering results

  function boldify(s) {
    return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  }

  function renderResults(r, c) {
    $('#summary').innerHTML = H.narrate(r, c).map((s) => `<p>${boldify(s)}</p>`).join('');
    renderStrips(r, c);
    renderHinges(r, c);
    if (!r.rows.find((x) => x.id === selectedRow)) {
      const sorted = sortedRows(r);
      selectedRow = sorted.length ? sorted[0].id : null;
    }
    renderCurve(r, c);
    $('#meta').textContent = `${r.n.toLocaleString()} samples · seed ${r.seed} · ${r.slices} slices per assumption · ${r.ms} ms`;
    document.querySelectorAll('.n-samples').forEach((el) => { el.textContent = r.n.toLocaleString(); });
    document.querySelectorAll('.n-seed').forEach((el) => { el.textContent = String(r.seed); });
    document.querySelectorAll('.n-slices').forEach((el) => { el.textContent = String(r.slices); });
  }

  function sortedRows(r) {
    const key = r.mode === 'decision' ? (x) => x.evpi + x.flip.p * 1e-9 : (x) => x.share;
    return [...r.rows].sort((a, b) => key(b) - key(a));
  }

  function niceTicks(lo, hi, n) {
    const span = hi - lo;
    if (!(span > 0)) return [lo];
    const step0 = span / n;
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const err = step0 / mag;
    const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
    const ticks = [];
    for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) ticks.push(+v.toPrecision(12));
    return ticks;
  }

  function logTicks(lo, hi) {
    const out = [];
    const kLo = Math.floor(Math.log10(lo)), kHi = Math.ceil(Math.log10(hi));
    for (let k = kLo; k <= kHi; k++) for (const m of [1, 2, 5]) { const v = m * Math.pow(10, k); if (v >= lo && v <= hi) out.push(v); }
    if (out.length > 8) return out.filter((v) => /^1/.test(v.toExponential()));
    if (out.length < 3) {
      // narrow range: linear nice ticks, placed on the log axis
      return niceTicks(lo, hi, 5).filter((v) => v > 0);
    }
    return out;
  }

  function width(el) {
    return Math.max(280, el.clientWidth || el.getBoundingClientRect().width || 320);
  }

  // The outcome distributions: one strip per option on a shared axis, then the difference for two options.
  function renderStrips(r, c) {
    const host = $('#strips');
    const W = width(host);
    const unit = c.unit;
    const [lo, hi] = r.range;
    const x = (v) => ((v - lo) / (hi - lo)) * (W - 2) + 1;
    const peak = Math.max(...r.options.map((o) => Math.max(...o.hist)));
    const parts = r.options.map((o, j) => {
      const h = 44, base = 40;
      const bars = o.hist.map((cnt, i) => {
        if (!cnt) return '';
        const bw = (W - 2) / o.hist.length;
        const bh = (cnt / peak) * 30;
        return `<rect x="${(1 + i * bw).toFixed(1)}" y="${(base - bh).toFixed(1)}" width="${Math.max(0.5, bw - 1).toFixed(1)}" height="${bh.toFixed(1)}" style="fill:${SERIES[j]}" opacity="0.28"/>`;
      }).join('');
      const best = j === r.best;
      const pb = r.pBest ? ` · best in ${H.fmtPct(r.pBest[j])}` : '';
      return `<div class="strip">
        <div class="strip-head"><span class="who"><i style="background:${SERIES[j]}"></i>${esc(o.name)}${best && r.mode === 'decision' ? ' <small>(best on average)</small>' : ''}</span>
        <span class="nums">mean ${esc(H.fmt(o.mean, unit))} · 90% of runs ${esc(H.fmt(o.q05, unit))} to ${esc(H.fmt(o.q95, unit))}${pb}</span></div>
        <svg viewBox="0 0 ${W} ${h}" width="${W}" height="${h}" role="img" aria-label="Distribution of ${esc(o.name)}">
          ${bars}
          <line x1="${x(o.q05).toFixed(1)}" x2="${x(o.q95).toFixed(1)}" y1="${base}" y2="${base}" style="stroke:${SERIES[j]}" stroke-width="2" stroke-linecap="round"/>
          <rect x="${x(o.q25).toFixed(1)}" y="${base - 4}" width="${Math.max(1, x(o.q75) - x(o.q25)).toFixed(1)}" height="8" rx="2" style="fill:${SERIES[j]}"/>
          <line x1="${x(o.median).toFixed(1)}" x2="${x(o.median).toFixed(1)}" y1="${base - 7}" y2="${base + 7}" stroke="var(--sheet)" stroke-width="2"/>
          <circle cx="${x(o.mean).toFixed(1)}" cy="${base}" r="4.5" style="fill:${SERIES[j]}" stroke="var(--sheet)" stroke-width="2"/>
        </svg>
      </div>`;
    });
    const ticks = niceTicks(lo, hi, W < 420 ? 4 : 6);
    const axis = `<div class="axis"><svg viewBox="0 0 ${W} 22" width="${W}" height="22" aria-hidden="true">
      <line x1="1" x2="${W - 1}" y1="1" y2="1" stroke="var(--line-2)"/>
      ${ticks.map((t) => `<g><line x1="${x(t).toFixed(1)}" x2="${x(t).toFixed(1)}" y1="1" y2="5" stroke="var(--line-2)"/><text x="${x(t).toFixed(1)}" y="17" text-anchor="middle" style="font:11px var(--sans);fill:var(--ink-3)">${esc(H.fmt(t, unit))}</text></g>`).join('')}
    </svg></div>`;
    let diff = '';
    if (r.diff) {
      const d = r.diff;
      const [dlo, dhi] = d.range;
      const dx = (v) => ((v - dlo) / (dhi - dlo)) * (W - 2) + 1;
      const dpeak = Math.max(...d.hist);
      const bw = (W - 2) / d.hist.length;
      const bars = d.hist.map((cnt, i) => {
        if (!cnt) return '';
        const bh = (cnt / dpeak) * 30;
        const mid = dlo + (i + 0.5) * bw / (W - 2) * (dhi - dlo);
        return `<rect x="${(1 + i * bw).toFixed(1)}" y="${(40 - bh).toFixed(1)}" width="${Math.max(0.5, bw - 1).toFixed(1)}" height="${bh.toFixed(1)}" fill="var(--ink-2)" opacity="${mid >= 0 ? 0.3 : 0.12}"/>`;
      }).join('');
      const bestName = r.options[d.best].name, otherName = r.options[d.other].name;
      const dticks = niceTicks(dlo, dhi, W < 420 ? 4 : 6);
      diff = `<div class="strip diff">
        <div class="strip-head"><span class="who">How far ${esc(bestName)} comes out ahead of ${esc(otherName)}</span>
        <span class="nums">ahead ${esc(H.fmtPct(r.margin.pPositive))} of the time · median ${esc(H.fmt(d.median, unit))} · 90% of runs ${esc(H.fmt(d.q05, unit))} to ${esc(H.fmt(d.q95, unit))}</span></div>
        <svg viewBox="0 0 ${W} 44" width="${W}" height="44" role="img" aria-label="Distribution of the difference">
          ${bars}
          <line x1="${dx(d.q05).toFixed(1)}" x2="${dx(d.q95).toFixed(1)}" y1="40" y2="40" stroke="var(--ink-2)" stroke-width="2" stroke-linecap="round"/>
          <rect x="${dx(d.q25).toFixed(1)}" y="36" width="${Math.max(1, dx(d.q75) - dx(d.q25)).toFixed(1)}" height="8" rx="2" fill="var(--ink-2)"/>
          <line x1="${dx(d.median).toFixed(1)}" x2="${dx(d.median).toFixed(1)}" y1="33" y2="47" stroke="var(--sheet)" stroke-width="2"/>
          <line x1="${dx(0).toFixed(1)}" x2="${dx(0).toFixed(1)}" y1="2" y2="44" stroke="var(--accent)" stroke-width="1.5"/>
          <text x="${(dx(0) + 4).toFixed(1)}" y="12" style="font:11px var(--sans);fill:var(--accent)">0</text>
        </svg>
        <div class="axis"><svg viewBox="0 0 ${W} 22" width="${W}" height="22" aria-hidden="true">
          <line x1="1" x2="${W - 1}" y1="1" y2="1" stroke="var(--line-2)"/>
          ${dticks.map((t) => `<g><line x1="${dx(t).toFixed(1)}" x2="${dx(t).toFixed(1)}" y1="1" y2="5" stroke="var(--line-2)"/><text x="${dx(t).toFixed(1)}" y="17" text-anchor="middle" style="font:11px var(--sans);fill:var(--ink-3)">${esc(H.fmt(t, unit))}</text></g>`).join('')}
        </svg></div>
      </div>`;
    }
    let target = '';
    if (r.target) target = `<p class="blurb">Target ${esc(H.fmt(r.target.value, unit))}: at or below it in ${esc(H.fmtPct(r.target.pBelow))} of runs, above it in ${esc(H.fmtPct(r.target.pAbove))}.</p>`;
    host.innerHTML = parts.join('') + axis + diff + target;
  }

  // The table of assumptions: what each one is worth knowing, and where it flips the answer.
  function renderHinges(r, c) {
    const host = $('#hinges');
    const unit = c.unit;
    const rows = sortedRows(r);
    if (!rows.length) {
      host.innerHTML = '<p class="blurb">No uncertain assumptions yet: add a range or a chance.</p>';
      $('#hinge-blurb').textContent = '';
      return;
    }
    const rowDef = (x) => c.rows.find((q) => q.id === x.id) || {};
    const rangeText = (x) => {
      const d = rowDef(x);
      if (x.kind === 'chance') return `${H.fmtPct(x.p)} chance`;
      return `${H.fmt(d.lo, '', { pct: d.pct })} to ${H.fmt(d.hi, '', { pct: d.pct })}`;
    };
    if (r.mode === 'decision') {
      $('#hinge-title').textContent = 'Where it hinges';
      $('#hinge-blurb').textContent = 'If you could learn one assumption exactly before choosing: what that would be worth, and the values at which the best option switches. The small figure under each bar is its share of the variance of the best option\'s lead. Tap a row to see the curve.';
      const total = r.evpi;
      const floor = total * 0.005;
      const body = rows.map((x) => {
        const d = rowDef(x);
        const frac = total > 0 ? Math.min(1, x.evpi / total) : 0;
        const small = x.evpi <= floor;
        const chance = x.flip.p > 0 ? H.fmtPct(x.flip.p) : '—';
        const winners = H.flipWinners(x);
        let flipHTML;
        if (winners.length > 1) {
          // different options win on different stretches: name each one
          flipHTML = H.flipParts(x, unit, d.pct).map((s) => `<span class="part">${esc(s.text)}<span class="win"> → ${esc(r.options[s.winner].name)}</span> <span class="part-p">(${esc(H.fmtPct(s.p))})</span></span>`).join('');
        } else {
          const win = x.flip.p > 0 && winners.length ? `<span class="win"> → ${esc(r.options[winners[0]].name)}</span>` : '';
          flipHTML = `${esc(H.flipText(x, unit, d.pct))}${win}${x.flip.p > 0 ? ` <span class="chance">(${esc(chance)})</span>` : ''}`;
        }
        return `<tr class="hrow${x.id === selectedRow ? ' selected' : ''}" data-id="${esc(x.id)}" role="button" tabindex="0" aria-pressed="${x.id === selectedRow}">
          <td class="name">${esc(x.name)}<small>${esc(rangeText(x))}</small></td>
          <td class="bar"><div class="track"><div class="rail"><i class="${small ? 'zero' : ''}" style="width:${(frac * 100).toFixed(1)}%"></i></div><span>${small ? '≈0' : esc(H.fmt(x.evpi, unit))}</span></div><small class="share">${esc(H.fmtPct(Math.max(0, x.share)))} of variance</small></td>
          <td class="flip">${flipHTML}</td>
          <td class="num">${esc(chance)}</td>
        </tr>`;
      }).join('');
      host.innerHTML = `<table class="hinge-table">
        <thead><tr><th>Assumption</th><th>Worth knowing</th><th>The answer changes if…</th><th>Chance</th></tr></thead>
        <tbody>${body}
        <tr class="total"><td class="name">everything</td><td class="bar"><div class="track"><div class="rail"><i style="width:100%"></i></div><span>${esc(H.fmt(total, unit))}</span></div></td><td class="flip" colspan="2">learning all of it at once (perfect information)</td></tr>
        </tbody></table>`;
    } else {
      $('#hinge-title').textContent = 'Where the uncertainty comes from';
      $('#hinge-blurb').textContent = 'Share of the variance each assumption is responsible for, and how far the expected outcome moves between its 5th and 95th percentile. Tap a row to see the curve.';
      const body = rows.map((x) => `<tr class="hrow${x.id === selectedRow ? ' selected' : ''}" data-id="${esc(x.id)}" role="button" tabindex="0" aria-pressed="${x.id === selectedRow}">
          <td class="name">${esc(x.name)}<small>${esc(rangeText(x))}</small></td>
          <td class="bar"><div class="track"><div class="rail"><i class="${x.share < 0.005 ? 'zero' : ''}" style="width:${(Math.min(1, x.share) * 100).toFixed(1)}%"></i></div><span>${x.share < 0.005 ? '≈0' : esc(H.fmtPct(Math.min(1, x.share)))}</span></div></td>
          <td class="num swing">${esc((x.swing >= 0 ? '+' : '−') + H.fmt(Math.abs(x.swing), unit))}<small>${x.kind === 'chance' ? 'if it happens' : 'from its 5% to its 95%'}</small></td>
        </tr>`).join('');
      // What the first-order shares leave over: interactions (only when several move together) plus the
      // little that slicing an input averages away. With a single uncertain input there is nothing to interact.
      const rest = 1 - r.sumShare;
      const restRow = rows.length < 2 ? '' : `<tr class="total"><td class="name">the rest</td><td class="bar"><div class="track"><div class="rail"><i class="${rest < 0.005 ? 'zero' : ''}" style="width:${(Math.max(0, Math.min(1, rest)) * 100).toFixed(1)}%"></i></div><span>${rest < 0.005 ? '≈0' : esc(H.fmtPct(rest))}</span></div></td><td class="flip">interactions, when several move together, plus a little lost to slicing</td></tr>`;
      host.innerHTML = `<table class="hinge-table three">
        <thead><tr><th>Assumption</th><th>Share of uncertainty</th><th>Moves the expected outcome</th></tr></thead>
        <tbody>${body}${restRow}
        </tbody></table>`;
    }
  }

  // The hinge curve: expected outcome of each option as a function of one assumption.
  function renderCurve(r, c) {
    const host = $('#curve');
    const entry = r.rows.find((x) => x.id === selectedRow);
    const block = $('#curve-block');
    if (!entry) {
      block.hidden = true;
      return;
    }
    block.hidden = false;
    const d = c.rows.find((q) => q.id === entry.id) || {};
    const unit = c.unit;
    const fx = (v) => H.fmt(v, '', { pct: d.pct });
    const W = width(host);
    const Hh = W < 480 ? 240 : 270;
    const names = r.options.map((o) => o.name);
    const isDecision = r.mode === 'decision';

    $('#curve-title').textContent = isDecision ? `If ${entry.name} turned out to be…` : `How ${entry.name} moves the estimate`;
    $('#curve-blurb').textContent = isDecision
      ? 'Expected outcome of each option when this one assumption is known and the rest stay uncertain. Where the lines cross, the best choice changes.'
      : 'Expected outcome when this one assumption is known and the rest stay uncertain. The shaded band is where your own distribution puts it.';
    $('#curve-legend').innerHTML = isDecision ? names.map((nm, j) => `<span><i style="background:${SERIES[j]}"></i>${esc(nm)}</span>`).join('') + (entry.flip && entry.flip.p > 0 ? `<span><i style="background:var(--flip);height:10px;border:1px solid var(--line-2)"></i>best option switches</span>` : '') : '';

    // y scale over all conditional means (and the overall means)
    let yLo = Infinity, yHi = -Infinity;
    const pts = entry.curve;
    for (const p of pts) for (const v of p.mj) { const u = v * (r.goal === 'min' ? -1 : 1); if (u < yLo) yLo = u; if (u > yHi) yHi = u; }
    for (const o of r.options) { if (o.mean < yLo) yLo = o.mean; if (o.mean > yHi) yHi = o.mean; }
    if (!(yHi > yLo)) { yHi = yLo + 1; yLo -= 1; }
    const pad = (yHi - yLo) * 0.08;
    yLo -= pad; yHi += pad;
    const yTicks = niceTicks(yLo, yHi, 5);
    // left margin wide enough for the longest tick label plus the rotated axis title
    const widest = Math.max(...yTicks.map((t) => H.fmt(t, unit).length));
    const m = { l: Math.min(W * 0.35, 30 + widest * 6.6), r: 14, t: 14, b: 52 };
    const pw = W - m.l - m.r, ph = Hh - m.t - m.b;
    const y = (v) => m.t + (1 - (v - yLo) / (yHi - yLo)) * ph;
    const toUser = (v) => v * (r.goal === 'min' ? -1 : 1);

    let svg = '';
    svg += yTicks.map((t) => `<g><line x1="${m.l}" x2="${W - m.r}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" stroke="var(--line)"/><text x="${m.l - 6}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end">${esc(H.fmt(t, unit))}</text></g>`).join('');

    let xOf, xTicks, xLabel;
    const dist = entry.dist;
    if (entry.kind === 'chance') {
      const xs = [m.l + pw * 0.25, m.l + pw * 0.75];
      xOf = (v) => xs[v];
      xTicks = [0, 1];
      xLabel = (v) => (v ? `happens (${H.fmtPct(entry.p)})` : `does not (${H.fmtPct(1 - entry.p)})`);
      svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${m.t + ph}" y2="${m.t + ph}" stroke="var(--line-2)"/>`;
      xTicks.forEach((v) => { svg += `<text x="${xOf(v)}" y="${m.t + ph + 18}" text-anchor="middle" class="ink">${esc(xLabel(v))}</text>`; });
      if (entry.flip && entry.flip.p > 0 && entry.flip.kind !== 'always') {
        const s = entry.flip.kind === 'yes' ? 1 : 0;
        svg += `<rect x="${xOf(s) - pw * 0.18}" y="${m.t}" width="${pw * 0.36}" height="${ph}" fill="var(--flip)"/>`;
      }
      r.options.forEach((o, j) => {
        if (!isDecision && j > 0) return;
        const a = toUser(pts[0].mj[j]), b = toUser(pts[1].mj[j]);
        svg += `<line x1="${xOf(0)}" x2="${xOf(1)}" y1="${y(a).toFixed(1)}" y2="${y(b).toFixed(1)}" style="stroke:${SERIES[j]}" stroke-width="2" stroke-linecap="round" opacity="0.6"/>`;
        [a, b].forEach((v, s) => { svg += `<circle cx="${xOf(s)}" cy="${y(v).toFixed(1)}" r="5" style="fill:${SERIES[j]}" stroke="var(--sheet)" stroke-width="2"/>`; });
      });
    } else {
      const xLo = pts[0].x, xHi = pts[pts.length - 1].x;
      const logX = dist === 'lognormal' && xLo > 0;
      const tf = logX ? Math.log : (v) => v;
      xOf = (v) => m.l + ((tf(v) - tf(xLo)) / (tf(xHi) - tf(xLo))) * pw;
      xTicks = logX ? logTicks(xLo, xHi) : niceTicks(xLo, xHi, W < 480 ? 4 : 6);
      // flip bands
      if (entry.flip && entry.flip.intervals) {
        const dd = H.makeDist(d);
        for (const [ulo, uhi] of entry.flip.intervals) {
          const a = ulo === 0 ? xLo : dd.quantile(ulo), b = uhi === 1 ? xHi : dd.quantile(uhi);
          svg += `<rect x="${xOf(a).toFixed(1)}" y="${m.t}" width="${Math.max(0, xOf(b) - xOf(a)).toFixed(1)}" height="${ph}" fill="var(--flip)"/>`;
        }
      }
      // density strip under the axis: where you think this assumption is
      const dd = H.makeDist(d);
      const N = 80;
      let dens = '';
      let maxPdf = 0;
      const samples = [];
      for (let i = 0; i <= N; i++) {
        const v = logX ? Math.exp(tf(xLo) + (tf(xHi) - tf(xLo)) * i / N) : xLo + (xHi - xLo) * i / N;
        const p = dd.pdf(v) * (logX ? v : 1); // density per unit of the axis
        samples.push([v, p]);
        if (p > maxPdf) maxPdf = p;
      }
      const base = m.t + ph + 30, dh = 16;
      dens = `M${xOf(samples[0][0]).toFixed(1)},${base}` + samples.map(([v, p]) => `L${xOf(v).toFixed(1)},${(base - (p / maxPdf) * dh).toFixed(1)}`).join('') + `L${xOf(samples[N][0]).toFixed(1)},${base}Z`;
      svg += `<path d="${dens}" fill="var(--ink-3)" opacity="0.28"/>`;
      svg += `<text x="${m.l}" y="${base + 11}" text-anchor="start">where you put ${esc(entry.name)}</text>`;
      if (!isDecision) {
        svg += `<rect x="${xOf(entry.q05).toFixed(1)}" y="${m.t}" width="${(xOf(entry.q95) - xOf(entry.q05)).toFixed(1)}" height="${ph}" fill="var(--flip)"/>`;
        svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(r.options[0].mean).toFixed(1)}" y2="${y(r.options[0].mean).toFixed(1)}" stroke="var(--ink-3)" stroke-dasharray="3 3"/>`;
        svg += `<text x="${W - m.r}" y="${(y(r.options[0].mean) - 4).toFixed(1)}" text-anchor="end">overall mean</text>`;
      }
      svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${m.t + ph}" y2="${m.t + ph}" stroke="var(--line-2)"/>`;
      xTicks.forEach((t) => { svg += `<g><line x1="${xOf(t).toFixed(1)}" x2="${xOf(t).toFixed(1)}" y1="${m.t + ph}" y2="${m.t + ph + 4}" stroke="var(--line-2)"/><text x="${xOf(t).toFixed(1)}" y="${m.t + ph + 16}" text-anchor="middle">${esc(fx(t))}</text></g>`; });
      r.options.forEach((o, j) => {
        if (!isDecision && j > 0) return;
        const path = pts.map((p, i) => `${i ? 'L' : 'M'}${xOf(p.x).toFixed(1)},${y(toUser(p.mj[j])).toFixed(1)}`).join('');
        svg += `<path d="${path}" fill="none" style="stroke:${SERIES[j]}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      });
      // crossing markers
      if (entry.flip && entry.flip.at) {
        for (const [a, b] of entry.flip.at) for (const v of [a, b]) {
          if (v == null) continue;
          svg += `<line x1="${xOf(v).toFixed(1)}" x2="${xOf(v).toFixed(1)}" y1="${m.t}" y2="${m.t + ph}" stroke="var(--accent)" stroke-width="1.5"/>`;
          svg += `<text x="${(xOf(v) + 4).toFixed(1)}" y="${m.t + 12}" class="ink">${esc(fx(v))}</text>`;
        }
      }
    }
    svg += `<text transform="translate(12 ${(m.t + ph / 2).toFixed(0)}) rotate(-90)" text-anchor="middle">expected outcome${unit ? esc(` (${unit})`) : ''}</text>`;
    svg += `<rect class="hit" x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="transparent"/>`;
    host.innerHTML = `<svg viewBox="0 0 ${W} ${Hh}" width="${W}" height="${Hh}" role="img" aria-label="Expected outcome of each option as a function of ${esc(entry.name)}">${svg}</svg>`;

    // table twin
    const tbl = $('#curve-table');
    const head = `<tr><th>${esc(entry.name)}</th>${r.options.map((o, j) => (isDecision || j === 0 ? `<th>${esc(o.name)}</th>` : '')).join('')}</tr>`;
    const body = pts.map((p) => `<tr><td>${esc(entry.kind === 'chance' ? (p.x ? 'happens' : 'does not') : fx(p.x))}</td>${p.mj.map((v, j) => (isDecision || j === 0 ? `<td>${esc(H.fmt(toUser(v), unit))}</td>` : '')).join('')}</tr>`).join('');
    tbl.innerHTML = `<table>${head}${body}</table>`;

    // hover / touch readout
    const svgEl = $('svg', host);
    const tip = $('#tip');
    const hide = () => { tip.hidden = true; const g = $('.cross', host); if (g) g.remove(); };
    const move = (ev) => {
      const rect = svgEl.getBoundingClientRect();
      const px = ((ev.clientX - rect.left) / rect.width) * W;
      let bestP = null, bestD = Infinity;
      for (const p of pts) { const dd = Math.abs(xOf(p.x) - px); if (dd < bestD) { bestD = dd; bestP = p; } }
      if (!bestP || (entry.kind !== 'chance' && bestD > 40)) { hide(); return; }
      let g = $('.cross', host);
      if (!g) { g = document.createElementNS('http://www.w3.org/2000/svg', 'g'); g.setAttribute('class', 'cross'); svgEl.insertBefore(g, $('.hit', svgEl)); }
      const cx = xOf(bestP.x).toFixed(1);
      g.innerHTML = `<line x1="${cx}" x2="${cx}" y1="${m.t}" y2="${m.t + ph}" stroke="var(--ink-3)" stroke-dasharray="2 3"/>` + bestP.mj.map((v, j) => (isDecision || j === 0 ? `<circle cx="${cx}" cy="${y(toUser(v)).toFixed(1)}" r="4.5" style="fill:${SERIES[j]}" stroke="var(--sheet)" stroke-width="2"/>` : '')).join('');
      const label = entry.kind === 'chance' ? (bestP.x ? 'happens' : 'does not happen') : fx(bestP.x);
      tip.innerHTML = `<b>${esc(entry.name)} = ${esc(label)}</b>` + bestP.mj.map((v, j) => (isDecision || j === 0 ? `<span><i style="background:${SERIES[j]}"></i>${esc(r.options[j].name)}: ${esc(H.fmt(toUser(v), unit))}</span>` : '')).join('');
      tip.hidden = false;
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let left = ev.clientX + 14, top = ev.clientY - th - 10;
      if (left + tw > window.innerWidth - 8) left = ev.clientX - tw - 14;
      if (top < 8) top = ev.clientY + 16;
      tip.style.left = `${Math.max(8, left)}px`;
      tip.style.top = `${top}px`;
    };
    // A mouse readout follows the pointer and goes when it leaves. A touch readout stays
    // after the finger lifts (the browser fires pointerleave then) until the next touch elsewhere.
    let touchTimer = null;
    svgEl.addEventListener('pointermove', (ev) => { if (ev.pointerType !== 'touch') move(ev); });
    svgEl.addEventListener('pointerdown', (ev) => {
      move(ev);
      if (ev.pointerType === 'touch') { clearTimeout(touchTimer); touchTimer = setTimeout(hide, 6000); }
    });
    svgEl.addEventListener('pointerleave', (ev) => { if (ev.pointerType !== 'touch') hide(); });
    svgEl.addEventListener('pointercancel', hide);
  }

  // ---------------------------------------------------------------- cases

  function switchCase(id) {
    state.current = id;
    selectedRow = null;
    save();
    renderEditor();
    scheduleCompute();
  }

  function exportCase() {
    const c = current();
    const data = { version: 1, title: c.title, unit: c.unit, goal: c.goal, target: c.target, notes: c.notes, rows: c.rows, options: c.options };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hinge-${(c.title || 'case').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'case'}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    flash('Exported.');
  }

  function importText(text) {
    let raw;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      flash('That file is not JSON.');
      return false;
    }
    try {
      const c = newCase(raw);
      if (!c.rows.length && !c.options.length) throw new Error('empty');
      state.cases.push(c);
      switchCase(c.id);
      flash(`Imported “${c.title}”.`);
      return true;
    } catch (e) {
      flash('That file is not a Hinge case.');
      return false;
    }
  }

  // ---------------------------------------------------------------- wiring

  function wire() {
    $('#rows').addEventListener('input', onRowInput);
    $('#rows').addEventListener('focusout', onRowBlur);
    $('#rows').addEventListener('focusin', (e) => { if (e.target.classList.contains('name')) e.target.dataset.prev = e.target.value.trim(); });
    $('#rows').addEventListener('change', onRowChange);
    $('#rows').addEventListener('click', (e) => {
      const btn = e.target.closest('.del');
      if (!btn) return;
      const li = btn.closest('.row');
      armedDelete(btn, () => {
        const c = current();
        c.rows = c.rows.filter((r) => r.id !== li.dataset.id);
        li.remove();
        touch();
      });
    });
    $('#options').addEventListener('input', onOptInput);
    $('#options').addEventListener('click', (e) => {
      const btn = e.target.closest('.del');
      if (!btn) return;
      const li = btn.closest('.opt');
      armedDelete(btn, () => {
        const c = current();
        c.options = c.options.filter((o) => o.id !== li.dataset.id);
        li.remove();
        document.querySelectorAll('#options .opt .swatch').forEach((sw, j) => { sw.style.background = SERIES[j] || 'var(--ink-3)'; });
        $('#target-field').classList.toggle('off', c.options.length !== 1);
        touch();
      });
    });
    document.querySelectorAll('.adders .add').forEach((b) => b.addEventListener('click', () => addRow(b.dataset.kind)));
    $('#btn-add-option').addEventListener('click', addOption);

    $('#title').addEventListener('input', (e) => { current().title = e.target.value; renderCaseSelect(); touch(); });
    $('#unit').addEventListener('input', (e) => { current().unit = e.target.value.trim(); touch(); });
    $('#goal').addEventListener('change', (e) => { current().goal = e.target.value; touch(); });
    $('#target').addEventListener('input', (e) => {
      const v = e.target.value.trim();
      const n = H.parseNumber(v);
      e.target.classList.toggle('bad', v !== '' && !Number.isFinite(n));
      current().target = v === '' ? null : n;
      touch();
    });

    $('#hinges').addEventListener('click', (e) => {
      const tr = e.target.closest('tr.hrow');
      if (!tr) return;
      selectedRow = tr.dataset.id;
      if (lastResult) { renderHinges(lastResult, current()); renderCurve(lastResult, current()); }
    });
    $('#hinges').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const tr = e.target.closest('tr.hrow');
      if (!tr) return;
      e.preventDefault();
      selectedRow = tr.dataset.id;
      if (lastResult) { renderHinges(lastResult, current()); renderCurve(lastResult, current()); $(`tr[data-id="${CSS.escape(selectedRow)}"]`, $('#hinges'))?.focus(); }
    });

    $('#btn-reroll').addEventListener('click', () => { seed = (seed % 100000) + 1; compute(); });
    $('#precise').checked = state.precise;
    $('#precise').addEventListener('change', (e) => { state.precise = e.target.checked; save(); compute(); });

    $('#case-select').addEventListener('change', (e) => switchCase(e.target.value));
    const exSel = $('#example-select');
    EXAMPLES.forEach((ex) => exSel.insertAdjacentHTML('beforeend', `<option value="${esc(ex.key)}">${esc(ex.title)}</option>`));
    exSel.addEventListener('change', (e) => {
      const ex = EXAMPLES.find((x) => x.key === e.target.value);
      e.target.value = '';
      if (!ex) return;
      const c = newCase(ex);
      state.cases.push(c);
      switchCase(c.id);
    });
    $('#btn-new').addEventListener('click', () => {
      const c = newCase(EXAMPLES.find((x) => x.key === 'blank'));
      state.cases.push(c);
      switchCase(c.id);
    });
    $('#btn-dup').addEventListener('click', () => {
      const src = current();
      const c = newCase(JSON.parse(JSON.stringify(src)));
      c.title = `${src.title} (copy)`;
      state.cases.push(c);
      switchCase(c.id);
    });
    $('#btn-delete').addEventListener('click', () => {
      const c = current();
      if (!window.confirm(`Delete “${c.title}”? This cannot be undone.`)) return;
      state.cases = state.cases.filter((x) => x.id !== c.id);
      if (!state.cases.length) state.cases.push(newCase(EXAMPLES[0]));
      switchCase(state.cases[0].id);
    });
    $('#btn-export').addEventListener('click', exportCase);
    $('#btn-import').addEventListener('click', () => $('#file-import').click());
    $('#file-import').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => importText(String(reader.result));
      reader.readAsText(f);
    });

    // a touch anywhere outside the curve dismisses its readout
    document.addEventListener('pointerdown', (ev) => {
      if ($('#curve').contains(ev.target)) return;
      $('#tip').hidden = true;
      const g = $('#curve .cross');
      if (g) g.remove();
    }, { passive: true });

    let resizeTimer = null;
    let lastW = window.innerWidth;
    window.addEventListener('resize', () => {
      if (window.innerWidth === lastW) return; // phone keyboards only change the height
      lastW = window.innerWidth;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { if (lastResult) renderResults(lastResult, current()); }, 150);
    });
  }

  // A small console API for tinkering and for the UI tests.
  window.hinge = {
    get state() { return state; },
    get current() { return current(); },
    get result() { return lastResult; },
    compute,
    importText,
    loadExample(key) {
      const ex = EXAMPLES.find((x) => x.key === key);
      if (!ex) return;
      const c = newCase(ex);
      state.cases.push(c);
      switchCase(c.id);
    },
  };

  load();
  wire();
  renderEditor();
  compute();
})();
