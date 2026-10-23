// The Aloft playground: lessons, a live editor, the checker's verdict, output,
// and a replay of the run as a juggle and as a timeline of throws.
(function () {
  'use strict';
  const A = window.Aloft;
  const LESSONS = window.AloftExamples;
  const $ = (id) => document.getElementById(id);
  const el = {
    select: $('lessonSelect'), prev: $('prev'), next: $('next'), text: $('lessonText'),
    code: $('code'), gutter: $('gutterInner'), bands: $('bands'), reset: $('resetLesson'), limit: $('limit'),
    verdict: $('verdict'), start: $('startList'), output: $('output'), runStatus: $('runStatus'),
    stage: $('stage'), timeline: $('timeline'), play: $('play'), step: $('step'), restart: $('restart'),
    speed: $('speed'), sound: $('sound'), desc: $('beatDesc'),
  };
  const reduceMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const TRACE_BEATS = 400;
  const MAX_OUTPUT = 2000;
  const MAX_MILLIS = 600; // wall-clock guard so a heavy program never freezes the page while you type
  const DWELL = 0.4; // beats a ball spends in the hand at the end of its flight (drawing only)
  const PALETTE = ['#d9531e', '#2b7bb9', '#c98a12', '#5f8f1f', '#a23b72', '#1f9e75', '#7b5ea7', '#c2304a', '#00798c', '#8a6d1d'];
  const STORE_KEY = 'aloft.v1';

  // ------------------------------------------------------------ storage
  function loadStore() {
    try {
      const raw = window.localStorage.getItem(STORE_KEY);
      const v = raw ? JSON.parse(raw) : null;
      const out = { lesson: 0, edits: {} };
      if (v && typeof v === 'object') {
        if (Number.isInteger(v.lesson) && v.lesson >= 0 && v.lesson < LESSONS.length) out.lesson = v.lesson;
        if (v.edits && typeof v.edits === 'object') {
          for (const ex of LESSONS) if (typeof v.edits[ex.id] === 'string' && v.edits[ex.id].length < 100000) out.edits[ex.id] = v.edits[ex.id];
        }
      }
      return out;
    } catch (e) {
      return { lesson: 0, edits: {} };
    }
  }
  function saveStore() {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch (e) { /* storage unavailable: nothing to do */ }
  }
  const store = loadStore();

  // -------------------------------------------------------------- state
  const S = {
    lesson: store.lesson, result: null, model: null, tau: 0, shownBeat: -1,
    playing: false, last: 0, timer: null, sound: false, audio: null, colors: null,
  };

  // ------------------------------------------------------------- lessons
  LESSONS.forEach((ex, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = `${i + 1}. ${ex.title}`;
    el.select.appendChild(o);
  });
  function renderLessonText(ex) {
    el.text.textContent = '';
    for (const para of ex.text) {
      const p = document.createElement('p');
      para.split('`').forEach((seg, i) => {
        if (i % 2) {
          const c = document.createElement('code');
          c.textContent = seg;
          p.appendChild(c);
        } else p.appendChild(document.createTextNode(seg));
      });
      el.text.appendChild(p);
    }
  }
  function openLesson(i, autoplay) {
    S.lesson = (i + LESSONS.length) % LESSONS.length;
    store.lesson = S.lesson;
    saveStore();
    const ex = LESSONS[S.lesson];
    el.select.value = String(S.lesson);
    renderLessonText(ex);
    el.code.value = store.edits[ex.id] != null ? store.edits[ex.id] : ex.src;
    el.reset.disabled = store.edits[ex.id] == null;
    update(autoplay);
  }

  // -------------------------------------------------------------- editor
  function lineHeight() {
    return parseFloat(getComputedStyle(el.code).lineHeight) || 21;
  }
  function padTop() {
    return parseFloat(getComputedStyle(el.code).paddingTop) || 10;
  }
  function layoutEditor() {
    const lines = el.code.value.split('\n');
    const lh = lineHeight();
    const pad = padTop();
    let h = lines.length * lh + 2 * pad;
    el.code.style.height = `${h}px`;
    if (el.code.scrollWidth > el.code.clientWidth + 1) {
      h += el.code.offsetHeight - el.code.clientHeight;
      el.code.style.height = `${h}px`;
    }
    if (el.gutter.childElementCount !== lines.length) {
      el.gutter.textContent = '';
      el.gutter.parentElement.style.paddingTop = `${pad}px`;
      for (let i = 1; i <= lines.length; i++) {
        const d = document.createElement('div');
        d.textContent = String(i);
        el.gutter.appendChild(d);
      }
    }
    updateMarks();
  }
  // Line ranges of each beat: from its catch line to the last non-blank, non-comment line before the next.
  function beatRanges() {
    const r = S.result;
    if (!r || !r.info) return [];
    const lines = el.code.value.split('\n');
    const starts = r.info.beats.map((b) => b.line);
    return starts.map((s, i) => {
      let end = i + 1 < starts.length ? starts[i + 1] - 1 : lines.length;
      while (end > s && /^\s*(#.*)?$/.test(lines[end - 1] || '')) end--;
      return [s, end];
    });
  }
  function updateMarks() {
    const r = S.result;
    const errLine = r && r.error ? r.error.line : 0;
    let cur = null;
    if (S.model && S.shownBeat >= 0) {
      const ranges = beatRanges();
      cur = ranges[S.shownBeat % ranges.length] || null;
    }
    const kids = el.gutter.children;
    for (let i = 0; i < kids.length; i++) {
      kids[i].className = i + 1 === errLine ? 'err' : (cur && i + 1 === cur[0] ? 'cur' : '');
    }
    const lh = lineHeight();
    const pad = padTop();
    el.bands.textContent = '';
    const band = (cls, a, b) => {
      const d = document.createElement('div');
      d.className = `band ${cls}`;
      d.style.top = `${pad + (a - 1) * lh}px`;
      d.style.height = `${(b - a + 1) * lh}px`;
      el.bands.appendChild(d);
    };
    if (cur) band('beat', cur[0], cur[1]);
    if (errLine) band('error', errLine, errLine);
  }
  function goTo(line, col) {
    const lines = el.code.value.split('\n');
    let pos = 0;
    for (let i = 0; i < line - 1 && i < lines.length; i++) pos += lines[i].length + 1;
    pos += Math.max(0, col - 1);
    el.code.focus();
    el.code.setSelectionRange(pos, Math.min(el.code.value.length, pos + 1));
  }

  // -------------------------------------------------------------- update
  let pending = null;
  function scheduleUpdate() {
    clearTimeout(pending);
    pending = setTimeout(() => update(S.playing), 180);
  }
  function limitValue() {
    const v = Math.floor(Number(el.limit.value));
    return Number.isFinite(v) ? Math.min(100000, Math.max(1, v)) : 10000;
  }
  function update(autoplay) {
    const r = A.run(el.code.value, { maxBeats: limitValue(), maxOutput: MAX_OUTPUT, maxMillis: MAX_MILLIS, traceBeats: TRACE_BEATS });
    S.result = r;
    S.model = r.info && r.trace ? buildModel(r) : null;
    S.tau = 0;
    S.shownBeat = -1;
    renderVerdict(r);
    renderStart(r);
    renderOutput(r);
    renderRunStatus(r);
    layoutEditor();
    pause();
    showBeat(0);
    drawAll();
    for (const b of [el.play, el.step, el.restart]) b.disabled = !S.model;
    if (autoplay && S.model && !reduceMotion.matches) play();
  }

  function el$(tag, cls, text) {
    const d = document.createElement(tag);
    if (cls) d.className = cls;
    if (text != null) d.textContent = text;
    return d;
  }
  function renderVerdict(r) {
    const v = el.verdict;
    v.textContent = '';
    if (r.error && r.error.kind !== 'runtime') {
      v.className = 'verdict bad';
      v.appendChild(el$('div', 'head', r.error.kind === 'syntax' ? "Can't read this yet" : "Can't juggle this yet"));
      v.appendChild(el$('div', '', `Line ${r.error.line}, column ${r.error.col}: ${r.error.message}`));
      const b = el$('button', '', `Go to line ${r.error.line}`);
      b.type = 'button';
      b.addEventListener('click', () => goTo(r.error.line, r.error.col));
      v.appendChild(b);
      return;
    }
    const info = r.info;
    v.className = 'verdict ok';
    v.appendChild(el$('div', 'head', 'Jugglable'));
    const hs = info.heights.flat();
    const sum = hs.length ? hs.join(' + ') : '0';
    const f = el$('div', 'formula', `siteswap ${info.siteswap} · ${info.ballCount} ball${info.ballCount === 1 ? '' : 's'} in the air = (${sum}) / ${info.period} beat${info.period === 1 ? '' : 's'}`);
    v.appendChild(f);
  }
  function renderStart(r) {
    el.start.textContent = '';
    if (!r.info || !r.info.schedule.length) return;
    const groups = [];
    for (const s of r.info.schedule) {
      const last = groups[groups.length - 1];
      const item = `${s.catchName} = ${s.value}`;
      if (last && last.time === s.time) last.items.push(item);
      else groups.push({ time: s.time, items: [item] });
    }
    const shown = groups.slice(0, 8).map((g) => `t=${g.time}: ${g.items.join(', ')}`);
    if (groups.length > 8) shown.push(`… ${groups.length - 8} more beats`);
    el.start.textContent = `In the air at the start: ${shown.join(' · ')}`;
  }
  function renderOutput(r) {
    el.output.textContent = '';
    if (!r.output.length) {
      el.output.appendChild(el$('div', 'empty', r.info ? '(nothing said)' : '(nothing to run)'));
      return;
    }
    const frag = document.createDocumentFragment();
    r.output.forEach((line, i) => {
      const d = el$('div', '', line);
      d.dataset.t = String(r.outputBeats[i]);
      frag.appendChild(d);
    });
    el.output.appendChild(frag);
    el.output.scrollTop = 0;
  }
  function renderRunStatus(r) {
    const s = el.runStatus;
    s.style.color = '';
    if (!r.info) {
      s.textContent = '';
      return;
    }
    const beats = `${r.beats} beat${r.beats === 1 ? '' : 's'}`;
    if (r.status === 'stopped') s.textContent = `stopped after ${beats}`;
    else if (r.status === 'limit') s.textContent = `no stop within the beat limit (${beats}): still juggling`;
    else if (r.status === 'output-limit') s.textContent = `output limit (${MAX_OUTPUT} lines) reached after ${beats}`;
    else if (r.status === 'work-limit') s.textContent = `halted after ${beats}: the work budget (${A.DEFAULTS.maxWork.toLocaleString('en-US')} steps) ran out`;
    else if (r.status === 'time-limit') s.textContent = `halted after ${beats}: the run took longer than ${MAX_MILLIS / 1000} s`;
    else if (r.status === 'error') {
      s.textContent = `error at t=${r.error.time}, line ${r.error.line}, column ${r.error.col}: ${r.error.message}`;
      s.style.color = 'var(--err)';
    }
  }

  // ------------------------------------------------------------- model
  function buildModel(r) {
    const info = r.info;
    const flights = Array.from({ length: info.ballCount }, () => []);
    // Ball ids: the balls already in the air at the start are 0, 1, 2, … in landing order.
    info.schedule.forEach((s, id) => {
      flights[id].push({ s: s.throwTime, h: s.height, land: s.time, v: s.value, k: s.k, K: info.beats[s.beat].throws.length });
    });
    const said = new Map();
    for (const rec of r.trace.beats) {
      const K = info.beats[rec.beat].throws.length;
      rec.thrown.forEach((th, k) => flights[th.id].push({ s: rec.t, h: th.height, land: rec.t + th.height, v: th.value, k, K }));
      if (rec.said.length) said.set(rec.t, rec.said);
    }
    const recs = r.trace.beats;
    const lastRec = recs.length ? recs[recs.length - 1].t : 0;
    const ended = r.status !== 'limit' && r.beats - 1 <= lastRec;
    let maxH = 1;
    for (const b of info.beats) for (const h of b.throws) maxH = Math.max(maxH, h);
    return { flights, recs, end: Math.max(0, lastRec), ended, truncated: !ended, said, maxH, info, status: r.status };
  }

  // ---------------------------------------------------------- geometry
  const handOf = (t) => ((t % 2) + 2) % 2;
  function colors() {
    if (!S.colors) {
      const cs = getComputedStyle(document.documentElement);
      const g = (n) => cs.getPropertyValue(n).trim();
      S.colors = { ink: g('--ink'), muted: g('--muted'), line: g('--line'), hand: g('--hand'), accent: g('--accent'), grid: g('--grid'), err: g('--err'), panel: g('--panel') };
    }
    return S.colors;
  }
  function fitCanvas(c) {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(c.clientWidth * dpr));
    const h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, W: c.clientWidth, H: c.clientHeight };
  }
  function shortNum(v) {
    const s = String(v);
    const neg = s[0] === '-';
    const d = neg ? s.slice(1) : s;
    if (d.length <= 4) return s;
    return `${neg ? '-' : ''}${d[0]}.${d[1]}e${d.length - 1}`;
  }
  function ballColor(id) {
    return PALETTE[id % PALETTE.length];
  }

  // Where ball `fl` (its list of flights) is at time tau, in stage coordinates.
  function ballPos(fl, tau, g) {
    let i = fl.length - 1;
    while (i > 0 && fl[i].s > tau) i--;
    const f = fl[i];
    const nx = fl[i + 1];
    const off = (k, K) => (k - (K - 1) / 2) * g.r * 2.3;
    const throwX = (t, k, K) => {
      const hnd = handOf(t);
      return g.hx[hnd] + (hnd === 0 ? 1 : -1) * g.inner + off(k, K);
    };
    const catchX = (t, k, K) => {
      const hnd = handOf(t);
      return g.hx[hnd] - (hnd === 0 ? 1 : -1) * g.outer + off(k, K);
    };
    const flightT = Math.max(0.2, f.h - DWELL);
    if (tau <= f.s + flightT) {
      const u = Math.max(0, (tau - f.s) / flightT);
      const x0 = throwX(f.s, f.k, f.K);
      const x1 = catchX(f.land, f.k, f.K);
      const apex = g.apex(f.h);
      return { x: x0 + (x1 - x0) * u, y: g.handY - 4 * apex * u * (1 - u), v: f.v };
    }
    const w = Math.min(1, (tau - (f.s + flightT)) / DWELL);
    const x0 = catchX(f.land, f.k, f.K);
    const x1 = nx ? throwX(f.land, nx.k, nx.K) : throwX(f.land, f.k, f.K);
    return { x: x0 + (x1 - x0) * w, y: g.handY + g.dip * Math.sin(Math.PI * w), v: f.v };
  }

  function stageGeometry(W, H, maxH) {
    const r = W < 480 ? 12 : 14;
    const spread = Math.min(W * 0.27, 190);
    const cx = W / 2;
    const handY = H - 42;
    const top = 26;
    const maxA = handY - top - r;
    const ref = Math.max(maxH, 3);
    return {
      r, handY, dip: 10,
      hx: [cx - spread, cx + spread],
      inner: spread * 0.32,
      outer: spread * 0.12,
      apex: (h) => maxA * Math.pow(Math.max(0, h - DWELL) / (ref - DWELL), 1.5),
    };
  }

  function drawStage() {
    const { ctx, W, H } = fitCanvas(el.stage);
    const c = colors();
    ctx.clearRect(0, 0, W, H);
    const m = S.model;
    const g = stageGeometry(W, H, m ? m.maxH : 3);
    // hands
    const tb = Math.floor(S.tau + 1e-9);
    for (let hnd = 0; hnd < 2; hnd++) {
      ctx.fillStyle = c.hand;
      ctx.globalAlpha = m && handOf(tb) === hnd && S.tau - tb < 0.25 ? 1 : 0.7;
      ctx.beginPath();
      ctx.ellipse(g.hx[hnd], g.handY + g.r + 6, g.r * 2.6, g.r * 0.85, 0, 0, Math.PI);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = c.muted;
    ctx.font = '12px system-ui, sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'center';
    ctx.fillText('even beats', g.hx[0], H - 6);
    ctx.fillText('odd beats', g.hx[1], H - 6);
    if (!m) {
      const e = S.result && S.result.error;
      if (e) {
        ctx.fillStyle = c.err;
        ctx.font = '600 14px system-ui, sans-serif';
        ctx.fillText(`Line ${e.line}, column ${e.col}`, W / 2, 40);
        ctx.fillStyle = c.ink;
        ctx.font = '14px system-ui, sans-serif';
        wrapText(ctx, e.message, W / 2, 64, Math.min(W - 40, 460), 20, 7);
        ctx.fillStyle = c.muted;
        ctx.font = '13px system-ui, sans-serif';
        ctx.fillText('Nothing goes up until the program checks out.', W / 2, H - 52);
      }
      return;
    }
    // balls
    const tau = Math.min(S.tau, m.end);
    const fontPx = g.r <= 12 ? 10 : 11;
    ctx.font = `600 ${fontPx}px ui-monospace, Menlo, Consolas, monospace`;
    ctx.textBaseline = 'middle';
    m.flights.forEach((fl, id) => {
      if (!fl.length) return;
      const p = ballPos(fl, tau, g);
      ctx.fillStyle = ballColor(id);
      ctx.beginPath();
      ctx.arc(p.x, p.y, g.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      const label = shortNum(p.v);
      const tw = ctx.measureText(label).width;
      if (tw > g.r * 1.8) {
        // label too wide for the ball: put it on a tag beside it
        ctx.fillStyle = c.panel;
        ctx.globalAlpha = 0.9;
        ctx.fillRect(p.x + g.r + 2, p.y - 8, tw + 6, 16);
        ctx.globalAlpha = 1;
        ctx.fillStyle = c.ink;
        ctx.textAlign = 'left';
        ctx.fillText(label, p.x + g.r + 5, p.y + 0.5);
        ctx.textAlign = 'center';
      } else ctx.fillText(label, p.x, p.y + 0.5);
    });
    // overlay
    ctx.textBaseline = 'alphabetic';
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = c.ink;
    ctx.fillText(`t = ${tb}`, 12, 20);
    ctx.textAlign = 'right';
    ctx.fillStyle = c.muted;
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText(`siteswap ${m.info.siteswap} · ${m.info.ballCount} ball${m.info.ballCount === 1 ? '' : 's'}`, W - 12, 20);
    if (S.tau >= m.end) {
      ctx.textAlign = 'center';
      ctx.fillStyle = m.status === 'error' ? c.err : c.accent;
      ctx.font = '600 13px system-ui, sans-serif';
      const why = m.truncated ? `replay ends at t = ${m.end}` : m.status === 'error' ? 'error' : m.status === 'stopped' ? 'stop' : 'end';
      ctx.fillText(why, W / 2, 20);
    }
  }

  function drawTimeline() {
    const { ctx, W, H } = fitCanvas(el.timeline);
    const c = colors();
    ctx.clearRect(0, 0, W, H);
    const m = S.model;
    const base = H - 30;
    const px = Math.max(24, Math.min(46, W / 16));
    const tau = m ? Math.min(S.tau, m.end) : 0;
    const x0 = Math.min(W * 0.25, 4 * px);
    const X = (t) => x0 + (t - tau) * px;
    const tA = Math.floor(tau - x0 / px) - 1;
    const tB = Math.ceil(tau + (W - x0) / px) + 1;
    // before-the-start shading
    if (X(0) > 0) {
      ctx.fillStyle = c.grid;
      ctx.fillRect(0, 0, Math.min(W, X(0) - px / 2), H);
    }
    ctx.strokeStyle = c.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, base);
    ctx.lineTo(W, base);
    ctx.stroke();
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    for (let t = Math.max(tA, 0); t <= tB; t++) {
      const x = X(t);
      ctx.strokeStyle = c.line;
      ctx.beginPath();
      ctx.moveTo(x, base);
      ctx.lineTo(x, base + 5);
      ctx.stroke();
      if (px >= 30 || t % 2 === 0) {
        ctx.fillStyle = c.muted;
        ctx.fillText(String(t), x, base + 17);
      }
      if (m && m.said.has(t) && t <= m.end) {
        ctx.fillStyle = c.accent;
        ctx.beginPath();
        ctx.arc(x, base + 24, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (!m) return;
    const maxArc = base - 14;
    ctx.font = '600 10px ui-monospace, Menlo, Consolas, monospace';
    ctx.textBaseline = 'middle';
    m.flights.forEach((fl, id) => {
      for (const f of fl) {
        if (f.land < tA || f.s > tB) continue;
        if (f.s > m.end) continue;
        const xa = X(f.s);
        const xb = X(f.land);
        const rx = (xb - xa) / 2;
        const ry = 6 + (maxArc - 6) * Math.min(1, f.h / Math.max(4, m.maxH));
        const live = f.s <= tau && tau < f.land;
        ctx.strokeStyle = ballColor(id);
        ctx.globalAlpha = live ? 1 : 0.35;
        ctx.lineWidth = live ? 2.5 : 1.5;
        ctx.beginPath();
        ctx.ellipse(xa + rx, base, Math.max(0.5, rx), ry, 0, Math.PI, 2 * Math.PI);
        ctx.stroke();
        const label = shortNum(f.v);
        const tw = ctx.measureText(label).width;
        if (live && rx * 2 > tw + 8) {
          ctx.globalAlpha = 1;
          ctx.fillStyle = c.panel;
          ctx.fillRect(xa + rx - tw / 2 - 3, base - ry - 7, tw + 6, 14);
          ctx.fillStyle = ballColor(id);
          ctx.textAlign = 'center';
          ctx.fillText(label, xa + rx, base - ry);
        }
        ctx.globalAlpha = 1;
      }
    });
    // playhead
    ctx.strokeStyle = c.ink;
    ctx.globalAlpha = 0.55;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(X(tau), 6);
    ctx.lineTo(X(tau), base);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  function wrapText(ctx, text, x, y, maxW, lh, maxLines) {
    const words = text.split(/\s+/);
    let line = '';
    let n = 0;
    for (let i = 0; i < words.length; i++) {
      const test = line ? `${line} ${words[i]}` : words[i];
      if (ctx.measureText(test).width > maxW && line) {
        if (n === maxLines - 1) {
          ctx.fillText(`${line} …`, x, y + n * lh);
          return;
        }
        ctx.fillText(line, x, y + n * lh);
        n++;
        line = words[i];
      } else line = test;
    }
    if (line) ctx.fillText(line, x, y + n * lh);
  }

  function drawAll() {
    drawStage();
    drawTimeline();
  }

  // ------------------------------------------------------- beat details
  function showBeat(t) {
    const m = S.model;
    if (!m) {
      S.shownBeat = -1;
      el.desc.textContent = S.result && S.result.error && S.result.error.kind !== 'runtime' ? 'Fix the program above and the juggle starts.' : '';
      updateMarks();
      return;
    }
    t = Math.max(0, Math.min(t, m.end));
    if (t === S.shownBeat) return;
    S.shownBeat = t;
    const rec = m.recs[t];
    el.desc.textContent = '';
    if (!rec) return;
    const names = m.info.beats[rec.beat].catches;
    const parts = [];
    const b = document.createElement('b');
    b.textContent = `t = ${t}`;
    el.desc.appendChild(b);
    parts.push(`beat on line ${m.info.beats[rec.beat].line}`);
    parts.push(rec.caught.length ? `caught ${rec.caught.map((x, i) => `${names[i]} = ${x.value}`).join(', ')}` : 'caught nothing (an empty beat)');
    if (rec.thrown.length) parts.push(`threw ${rec.thrown.map((x) => `${x.value} up ${x.height}`).join(', ')}`);
    if (rec.said.length) parts.push(`said ${rec.said.map((s) => `“${s}”`).join(', ')}`);
    if (rec.stopped) parts.push('stop');
    if (rec.error) parts.push(`error: ${S.result.error.message}`);
    el.desc.appendChild(document.createTextNode(` · ${parts.join(' · ')}`));
    // output highlight, scrolling the panel only (never the page)
    let first = null;
    for (const d of el.output.children) {
      const on = d.dataset.t === String(t);
      d.classList.toggle('now', on);
      if (on && !first) first = d;
    }
    if (first) {
      const top = first.offsetTop - el.output.offsetTop;
      if (top < el.output.scrollTop || top > el.output.scrollTop + el.output.clientHeight - 24) {
        el.output.scrollTop = Math.max(0, top - el.output.clientHeight / 3);
      }
    }
    updateMarks();
    if (S.playing) chime(rec);
  }

  // ------------------------------------------------------------- sound
  const SCALE = [0, 2, 4, 7, 9];
  function chime(rec) {
    if (!S.sound || !S.audio || !rec || !rec.caught.length) return;
    const ac = S.audio;
    const now = ac.currentTime;
    rec.caught.slice(0, 4).forEach((b, i) => {
      const v = Number(BigInt.asIntN(32, BigInt(b.value)));
      const idx = ((v % 15) + 15) % 15;
      const semis = 12 * Math.floor(idx / 5) + SCALE[idx % 5];
      const f = 261.63 * Math.pow(2, semis / 12);
      const o = ac.createOscillator();
      const gn = ac.createGain();
      o.type = 'triangle';
      o.frequency.value = f;
      const t0 = now + i * 0.03;
      gn.gain.setValueAtTime(0.0001, t0);
      gn.gain.exponentialRampToValueAtTime(0.07, t0 + 0.008);
      gn.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
      o.connect(gn).connect(ac.destination);
      o.start(t0);
      o.stop(t0 + 0.32);
    });
  }
  el.sound.addEventListener('click', () => {
    S.sound = !S.sound;
    if (S.sound && !S.audio) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) S.audio = new AC();
    }
    if (S.audio && S.audio.state === 'suspended') S.audio.resume();
    el.sound.setAttribute('aria-pressed', String(S.sound));
    el.sound.textContent = S.sound ? 'Sound on' : 'Sound off';
  });

  // ------------------------------------------------------------ playback
  function frame(now) {
    if (!S.playing || !S.model) return;
    const dt = Math.min(0.1, (now - S.last) / 1000);
    S.last = now;
    S.tau = Math.min(S.model.end, S.tau + dt * Number(el.speed.value));
    showBeat(Math.floor(S.tau + 1e-9));
    drawAll();
    if (S.tau >= S.model.end) pause();
    else requestAnimationFrame(frame);
  }
  function play() {
    if (!S.model) return;
    if (S.tau >= S.model.end) {
      S.tau = 0;
      S.shownBeat = -1;
    }
    S.playing = true;
    el.play.textContent = 'Pause';
    if (reduceMotion.matches) {
      // No tweening: jump a whole beat at a time.
      const tick = () => {
        if (!S.playing) return;
        stepBy(1, true);
        if (S.tau >= S.model.end) pause();
        else S.timer = setTimeout(tick, 1000 / Number(el.speed.value));
      };
      S.timer = setTimeout(tick, 1000 / Number(el.speed.value));
    } else {
      S.last = performance.now();
      requestAnimationFrame(frame);
    }
  }
  function pause() {
    S.playing = false;
    clearTimeout(S.timer);
    el.play.textContent = S.model && S.tau >= S.model.end && S.tau > 0 ? 'Replay' : 'Play';
  }
  function stepBy(d, keepPlaying) {
    if (!S.model) return;
    if (!keepPlaying) pause();
    const base = d > 0 ? Math.floor(S.tau + 1e-9) : Math.ceil(S.tau - 1e-9);
    S.tau = Math.max(0, Math.min(S.model.end, base + d));
    const wasPlaying = S.playing;
    S.playing = keepPlaying ? wasPlaying : false;
    showBeat(Math.floor(S.tau + 1e-9));
    if (keepPlaying && S.sound) chime(S.model.recs[Math.floor(S.tau)]);
    drawAll();
    if (!keepPlaying) el.play.textContent = S.tau >= S.model.end && S.tau > 0 ? 'Replay' : 'Play';
  }
  el.play.addEventListener('click', () => (S.playing ? pause() : play()));
  el.step.addEventListener('click', () => stepBy(1, false));
  el.restart.addEventListener('click', () => {
    const was = S.playing;
    pause();
    S.tau = 0;
    S.shownBeat = -1;
    showBeat(0);
    drawAll();
    if (was) play();
  });

  // -------------------------------------------------------------- wiring
  el.select.addEventListener('change', () => openLesson(Number(el.select.value), !reduceMotion.matches));
  el.prev.addEventListener('click', () => openLesson(S.lesson - 1, !reduceMotion.matches));
  el.next.addEventListener('click', () => openLesson(S.lesson + 1, !reduceMotion.matches));
  el.reset.addEventListener('click', () => {
    const ex = LESSONS[S.lesson];
    delete store.edits[ex.id];
    saveStore();
    openLesson(S.lesson, !reduceMotion.matches);
  });
  el.code.addEventListener('input', () => {
    const ex = LESSONS[S.lesson];
    if (el.code.value === ex.src) delete store.edits[ex.id];
    else store.edits[ex.id] = el.code.value;
    el.reset.disabled = store.edits[ex.id] == null;
    saveStore();
    layoutEditor();
    scheduleUpdate();
  });
  el.code.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      // Two spaces, so indenting works; Escape then Tab leaves the editor.
      if (el.code.dataset.escaped === '1') return;
      e.preventDefault();
      const a = el.code.selectionStart;
      const b = el.code.selectionEnd;
      el.code.setRangeText('  ', a, b, 'end');
      el.code.dispatchEvent(new Event('input'));
    } else if (e.key === 'Escape') el.code.dataset.escaped = '1';
    else el.code.dataset.escaped = '';
  });
  el.limit.addEventListener('change', () => update(S.playing));
  document.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    if (/^(TEXTAREA|INPUT|SELECT|BUTTON)$/.test(tag) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === ' ') {
      e.preventDefault();
      if (S.playing) pause();
      else play();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      stepBy(1, false);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      stepBy(-1, false);
    }
  });
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      layoutEditor();
      drawAll();
    }, 60);
  });
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onScheme = () => {
      S.colors = null;
      drawAll();
    };
    if (mq.addEventListener) mq.addEventListener('change', onScheme);
    const onMotion = () => {
      if (S.playing) {
        pause();
        play();
      }
    };
    if (reduceMotion.addEventListener) reduceMotion.addEventListener('change', onMotion);
  }

  openLesson(S.lesson, !reduceMotion.matches);
})();
