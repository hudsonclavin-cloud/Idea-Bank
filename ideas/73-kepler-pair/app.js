/* The Kepler Pair: the page. Every number it shows comes from kepler.js, sky.js or budget.js. */
(function () {
  'use strict';
  const K = window.KeplerPair;
  const SKY = window.KPSky;
  const BUDGET = window.KPBudget || {};
  const TAU = K.TAU;
  const DEG = K.DEG;
  const NS = 'http://www.w3.org/2000/svg';
  const $ = (id) => document.getElementById(id);
  const reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const st = { body: 'mercury', C: 70, bore: 0.5, M: 0, d: null, o: null, parts: null, run: false, tween: null, drag: null, gen: 0, raf: 0 };

  // ---------------------------------------------------------------- helpers
  const el = (tag, attrs, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  };
  const loopPath = (L) => 'M' + L.map((p) => p[0].toFixed(3) + ' ' + p[1].toFixed(3)).join('L') + 'Z';
  const fmt = (x, n) => x.toFixed(n === undefined ? 1 : n);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const jdDate = (jd) => {
    const t = new Date((jd - 2440587.5) * 86400000);
    return t.getUTCFullYear() + ' ' + MONTHS[t.getUTCMonth()] + ' ' + t.getUTCDate();
  };
  const isPluto = () => st.d && st.d.body === 'pluto';
  const unitDays = () => (isPluto() ? 365.25 : 1);
  const unitName = () => (isPluto() ? 'year' : 'day');
  const stepM = () => TAU / st.d.dots;
  const mod = (x, m) => ((x % m) + m) % m;

  // ---------------------------------------------------------------- settings
  (function readURL() {
    const q = new URLSearchParams(location.search);
    if (K.BODIES[q.get('body')]) st.body = q.get('body');
    if (q.get('C')) st.C = +q.get('C');
    if (q.get('bore')) st.bore = +q.get('bore');
  })();
  function syncForm() {
    const d = K.design({ body: st.body, C: st.C, bore: st.bore });
    st.body = d.body;
    st.C = d.C;
    st.bore = d.bore;
    for (const r of document.querySelectorAll('input[name=body]')) r.checked = r.value === st.body;
    for (const r of document.querySelectorAll('input[name=bore]')) r.checked = +r.value === st.bore;
    const cs = K.cRange(st.body);
    const size = $('size');
    size.min = cs[0];
    size.max = cs[cs.length - 1];
    size.value = st.C;
    $('size-out').textContent = st.C + ' mm';
  }

  // ---------------------------------------------------------------- the machine
  const svg = $('machine');
  let G = null; // the drawn parts, rebuilt for each design

  function drawMachine() {
    const d = st.d;
    const P = d.plate;
    svg.setAttribute('viewBox', [P.x0 - 2, -P.y1 - 2, P.x1 - P.x0 + 4, P.y1 - P.y0 + 4].map((v) => fmt(v, 2)).join(' '));
    svg.textContent = '';
    const world = el('g', { transform: 'scale(1,-1)' }, svg);
    el('path', { d: loopPath(K.roundedRect(P.x0, P.y0, P.x1, P.y1, d.F.cornerR, 6)), class: 'plate' }, world);
    // the orbit, faintly (the print has only the dots)
    const orb = [];
    for (let i = 0; i < 180; i++) {
      const t = (TAU * i) / 180;
      const r = K.radius(t, d.e, d.aD);
      orb.push([r * Math.cos(t + d.F.sigma), r * Math.sin(t + d.F.sigma)]);
    }
    el('path', { d: loopPath(orb), class: 'orbit' }, world);
    const sweep = el('path', { class: 'sweep' }, world);
    const dots = K.dialDots(d);
    const dotEls = { K: [], T: [] };
    for (const which of ['K', 'T'])
      for (const dot of dots[which]) {
        const n = el('path', { d: loopPath(K.dotLoop(dot)), class: 'dot' }, world);
        if (dot.k === 0) n.classList.add('zero');
        (dotEls[which][dot.k] = dotEls[which][dot.k] || []).push(n);
      }
    el('circle', { cx: -d.C, cy: 0, r: d.F.pegR, class: 'peg' }, world);
    const wt = wheel2D('time');
    const wk = wheel2D('kepler');
    const gT = el('g', {}, world);
    el('path', { d: [wt.outer, wt.cavity, wt.slot, wt.bore].map(loopPath).join(''), class: 'wheel time' }, gT);
    const pitchT = el('path', { d: loopPath(d.pc.T.P.filter((_, i) => i % 32 === 0)), class: 'pitch' }, gT);
    el('path', { d: loopPath(wt.top) + loopPath(wt.bore), class: 'knob' }, gT);
    const gK = el('g', {}, world);
    el('path', { d: [wk.outer, wk.cavity, wk.slot, wk.bore].map(loopPath).join(''), class: 'wheel kepler' }, gK);
    const pitchK = el('path', { d: loopPath(d.pc.K.P.filter((_, i) => i % 32 === 0)), class: 'pitch' }, gK);
    el('path', { d: loopPath(wk.top) + loopPath(wk.bore), class: 'collar' }, gK);
    if (wk.weight) el('path', { d: loopPath(wk.weight), class: 'collar' }, gK);
    el('circle', { cx: 0, cy: 0, r: d.F.pegR, class: 'sun' }, world);
    const L = d.QD + 4;
    const gU = el('line', { x1: 0, y1: 0, class: 'ghost uniform' }, world);
    const gE = el('line', { x1: 0, y1: 0, class: 'ghost ellipse' }, world);
    const contact = el('circle', { r: 1.1, cy: 0, class: 'contact' }, world);
    G = { world, sweep, dotEls, gT, gK, pitchT, pitchK, gU, gE, L, contact, lit: [] };
    showGhosts();
  }
  function wheel2D(which) {
    return K.wheel2D(st.d, which, st.o[which]);
  }
  function showGhosts() {
    if (!G) return;
    G.gU.style.display = $('g-uniform').checked ? '' : 'none';
    G.gE.style.display = $('g-ellipse').checked ? '' : 'none';
    G.sweep.style.display = $('g-sweep').checked ? '' : 'none';
    const p = $('g-pitch').checked ? '' : 'none';
    G.pitchT.style.display = p;
    G.pitchK.style.display = p;
  }

  function render() {
    const d = st.d;
    if (!d || !G) return;
    const M = st.M;
    const th = K.trueFromMean(M, d.e);
    const S = d.F.sigma;
    G.gT.setAttribute('transform', `translate(${-d.C} 0) rotate(${fmt((-M * DEG) % 360, 3)})`);
    G.gK.setAttribute('transform', `rotate(${fmt((th * DEG) % 360, 3)})`);
    const r2 = K.keplerPitchR(th, d.e, d.C);
    G.contact.setAttribute('cx', fmt(-r2, 3));
    const ray = (line, a) => {
      line.setAttribute('x2', fmt(G.L * Math.cos(S + a), 3));
      line.setAttribute('y2', fmt(G.L * Math.sin(S + a), 3));
    };
    ray(G.gU, M);
    ray(G.gE, K.ellipsePairTrue(M, d.e));
    // the area swept in the last dot of time: always the same
    const t0 = K.trueFromMean(M - stepM(), d.e);
    const pts = [[0, 0]];
    for (let i = 0; i <= 24; i++) {
      const t = t0 + ((th - t0) * i) / 24;
      const r = K.radius(t, d.e, d.aD);
      pts.push([r * Math.cos(S + t), r * Math.sin(S + t)]);
    }
    G.sweep.setAttribute('d', loopPath(pts));
    // light the dots the windows are over
    const k = Math.round(M / stepM());
    const near = Math.abs(M / stepM() - k) < 0.12;
    for (const n of G.lit) n.classList.remove('lit');
    G.lit = [];
    if (near) {
      const kk = mod(k, d.dots);
      for (const n of G.dotEls.K[kk].concat(G.dotEls.T[kk])) {
        n.classList.add('lit');
        G.lit.push(n);
      }
    }
    readout(M, th);
    chartMarker(M);
  }

  function readout(M, th) {
    const d = st.d;
    const Mo = mod(M, TAU);
    const t = (Mo / TAU) * d.P;
    const u = unitDays();
    const whole = d.P / u;
    const dotNow = (Mo / TAU) * d.dots;
    $('r-time').textContent = `${unitName() === 'day' ? 'Day' : 'Year'} ${fmt(t / u)} of ${fmt(whole)} · dot ${fmt(dotNow)} of ${d.dots}`;
    const thd = mod(th, TAU) * DEG;
    const uni = Mo * DEG;
    const ell = mod(K.ellipsePairTrue(M, d.e), TAU) * DEG;
    const diff = (a) => {
      const x = K.wrapPi((a - thd) / DEG) * DEG;
      return Math.abs(x) < 0.05 ? 'on it' : `${fmt(Math.abs(x))}° ${x < 0 ? 'behind' : 'ahead'}`;
    };
    $('r-angle').textContent = `${fmt(thd)}° — an even circle says ${fmt(uni)}° (${diff(uni)}); elliptical gears ${fmt(ell)}° (${diff(ell)})`;
    $('r-speed').textContent = `${fmt(K.rate(th, d.e), 2)} × its average angular speed, ${fmt(K.radius(th, d.e, d.a), d.a > 10 ? 1 : 3)} au from the Sun`;
    const r2 = K.keplerPitchR(th, d.e, d.C);
    $('r-contact').textContent = `time wheel ${fmt(d.C - r2)} mm : planet wheel ${fmt(r2)} mm from their pegs`;
    svg.setAttribute('aria-valuemax', fmt(whole));
    svg.setAttribute('aria-valuenow', fmt(t / u));
    svg.setAttribute('aria-valuetext', `${unitName()} ${fmt(t / u)} of ${fmt(whole)} since perihelion; ${d.name} ${Math.round(thd)} degrees round from perihelion`);
  }

  // ---------------------------------------------------------------- turning
  function setM(M) {
    st.M = M;
    render();
  }
  function stopRun() {
    if (!st.run) return;
    st.run = false;
    $('run').setAttribute('aria-pressed', 'false');
    $('run').textContent = 'Turn steadily';
  }
  function tweenTo(target) {
    if (reduced) {
      st.tween = null;
      setM(target);
      return;
    }
    st.tween = { from: st.M, to: target, t0: performance.now(), dur: 380 };
    kick();
  }
  let last = 0;
  function kick() {
    if (!st.raf) st.raf = requestAnimationFrame(frame);
  }
  function frame(now) {
    st.raf = 0;
    let again = false;
    if (st.tween) {
      const tw = st.tween;
      const f = Math.min(1, (now - tw.t0) / tw.dur);
      const s = f < 0.5 ? 2 * f * f : 1 - 2 * (1 - f) * (1 - f);
      st.M = tw.from + (tw.to - tw.from) * s;
      if (f >= 1) st.tween = null;
      else again = true;
    } else if (st.run && !reduced) {
      const dt = Math.min(0.1, (now - (last || now)) / 1000);
      st.M += (TAU / 24) * dt; // one orbit in 24 seconds
      again = true;
    }
    last = now;
    render();
    if (again) kick();
    else last = 0;
  }
  let stepTimer = null;
  function step(n) {
    if (!st.d) return;
    stopRun();
    const base = st.tween ? st.tween.to : st.M;
    const k = Math.round(base / stepM());
    const target = (Math.abs(base / stepM() - k) < 1e-6 ? k + n : n > 0 ? Math.floor(base / stepM()) + 1 : Math.ceil(base / stepM()) - 1) * stepM();
    tweenTo(target);
  }
  function toggleRun() {
    if (!st.d) return;
    st.run = !st.run;
    $('run').setAttribute('aria-pressed', String(st.run));
    $('run').textContent = st.run ? 'Pause' : 'Turn steadily';
    if (st.run) {
      st.tween = null;
      if (reduced) {
        // no continuous motion: one dot at a time, once a second and a half
        clearInterval(stepTimer);
        stepTimer = setInterval(() => {
          if (!st.run) return clearInterval(stepTimer);
          setM((Math.round(st.M / stepM()) + 1) * stepM());
        }, 1500);
      } else kick();
    } else clearInterval(stepTimer);
  }

  // dragging either wheel
  function toModel(ev) {
    const m = G.world.getScreenCTM();
    if (!m) return null;
    const p = svg.createSVGPoint();
    p.x = ev.clientX;
    p.y = ev.clientY;
    const q = p.matrixTransform(m.inverse());
    return [q.x, q.y];
  }
  svg.addEventListener('pointerdown', (ev) => {
    if (!G) return;
    const p = toModel(ev);
    if (!p) return;
    const d = st.d;
    const dB = Math.hypot(p[0], p[1]);
    const dA = Math.hypot(p[0] + d.C, p[1]);
    let which = null;
    if (dB < d.outK + 3 && dB / d.outK <= dA / d.outT) which = 'kepler';
    else if (dA < d.outT + 3) which = 'time';
    if (!which) return;
    stopRun();
    st.tween = null;
    st.drag = { which, id: ev.pointerId, phi: which === 'kepler' ? Math.atan2(p[1], p[0]) : Math.atan2(p[1], p[0] + d.C), th: K.trueFromMean(st.M, d.e) };
    try {
      svg.setPointerCapture(ev.pointerId);
    } catch (e) {
      /* the pointer may already be gone */
    }
    svg.classList.add('dragging');
    ev.preventDefault();
  });
  svg.addEventListener('pointermove', (ev) => {
    const g = st.drag;
    if (!g || ev.pointerId !== g.id) return;
    const p = toModel(ev);
    if (!p) return;
    const d = st.d;
    if (g.which === 'time') {
      const phi = Math.atan2(p[1], p[0] + d.C);
      setM(st.M - K.wrapPi(phi - g.phi)); // clockwise is forward
      g.phi = phi;
    } else {
      const phi = Math.atan2(p[1], p[0]);
      g.th += K.wrapPi(phi - g.phi);
      g.phi = phi;
      setM(K.meanFromTrue(g.th, d.e));
    }
  });
  const endDrag = (ev) => {
    if (st.drag && ev.pointerId === st.drag.id) {
      st.drag = null;
      svg.classList.remove('dragging');
    }
  };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);
  svg.addEventListener('keydown', (ev) => {
    if (!st.d) return;
    const s = stepM();
    const keys = { ArrowRight: s / 10, ArrowUp: s / 10, ArrowLeft: -s / 10, ArrowDown: -s / 10 };
    if (ev.key in keys) {
      stopRun();
      st.tween = null;
      setM(st.M + keys[ev.key]);
    } else if (ev.key === 'PageUp') step(1);
    else if (ev.key === 'PageDown') step(-1);
    else if (ev.key === 'Home') {
      stopRun();
      tweenTo(Math.round(st.M / TAU) * TAU);
    } else if (ev.key === 'End') {
      stopRun();
      tweenTo(Math.floor(st.M / TAU) * TAU + Math.PI);
    } else return;
    ev.preventDefault();
  });
  $('fwd').addEventListener('click', () => step(1));
  $('back').addEventListener('click', () => step(-1));
  $('run').addEventListener('click', toggleRun);
  $('today').addEventListener('click', setToday);
  for (const id of ['g-uniform', 'g-ellipse', 'g-pitch', 'g-sweep']) $(id).addEventListener('change', showGhosts);

  // ---------------------------------------------------------------- today
  function setToday() {
    if (!st.d) return;
    stopRun();
    const now = Date.now() / 86400000 + 2440587.5;
    const b = SKY.bodies[st.d.body];
    const peri = b.peri.map((x) => x + 2451545);
    let i = -1;
    for (let k = 0; k < peri.length; k++) if (peri[k] <= now) i = k;
    let T0;
    let T1;
    let note = '';
    if (i < 0) {
      T0 = peri[0] - Math.ceil((peri[0] - now) / st.d.P) * st.d.P;
      T1 = T0 + st.d.P;
      note = ' (before the DE441 table here: counted back from its first perihelion with the mean period)';
    } else if (i === peri.length - 1) {
      const n = Math.floor((now - peri[i]) / st.d.P);
      T0 = peri[i] + n * st.d.P;
      T1 = T0 + st.d.P;
      if (n > 0) note = ' (beyond the DE441 table here: counted on from its last perihelion with the mean period)';
    } else {
      T0 = peri[i];
      T1 = peri[i + 1];
    }
    const f = (now - T0) / (T1 - T0);
    const u = unitDays();
    const target = Math.floor(st.M / TAU) * TAU + f * TAU;
    $('today-note').textContent = `Today, ${jdDate(now)}: ${st.d.name} passed perihelion on ${jdDate(T0)}${note}, ${fmt((now - T0) / u)} ${unitName()}s ago. That is dot ${fmt(f * st.d.dots)} of ${st.d.dots}.`;
    tweenTo(target);
  }

  // ---------------------------------------------------------------- chart
  const chart = $('chart');
  let CH = null;
  function drawChart() {
    const d = st.d;
    const b = BUDGET[[d.body, d.C, d.bore].join('|')];
    chart.textContent = '';
    // as wide in the drawing as on the screen, so the labels stay readable on a phone
    const W = Math.max(340, Math.min(640, Math.round(chart.getBoundingClientRect().width) || 640));
    const H = W < 500 ? 260 : 300;
    chart.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const x0 = 46;
    const x1 = W - 12;
    const yTop = 18;
    const yBot = H - 40;
    let ymax = 0;
    const n = 720;
    const uni = [];
    const ell = [];
    for (let i = 0; i <= n; i++) {
      const M = (TAU * i) / n;
      const th = K.trueFromMean(M, d.e);
      uni.push(K.wrapPi(M - th) * DEG);
      ell.push(K.wrapPi(K.ellipsePairTrue(M, d.e) - th) * DEG);
    }
    ymax = Math.max(...uni.map(Math.abs));
    if (b) ymax = Math.max(ymax, ...b.d.map((v) => v / 10));
    const nice = [2, 5, 10, 15, 20, 30, 40];
    const top = nice.find((v) => v >= ymax * 1.08) || 40;
    const X = (M) => x0 + ((x1 - x0) * M) / TAU;
    const Y = (v) => (yTop + yBot) / 2 - ((yBot - yTop) / 2) * (v / top);
    const tick = top <= 5 ? 1 : top <= 20 ? 5 : 10;
    for (let v = -top; v <= top + 1e-9; v += tick) {
      el('line', { x1: x0, x2: x1, y1: Y(v), y2: Y(v), class: v === 0 ? 'axis' : 'grid' }, chart);
      el('text', { x: x0 - 6, y: Y(v) + 4, class: 'tick', 'text-anchor': 'end' }, chart).textContent = `${v > 0 ? '+' : ''}${v}°`;
    }
    [
      [0, 'perihelion'],
      [Math.PI, 'aphelion'],
      [TAU, 'perihelion'],
    ].forEach(([M, s], i) => {
      el('text', { x: X(M), y: H - 19, class: 'tick', 'text-anchor': i === 0 ? 'start' : i === 2 ? 'end' : 'middle' }, chart).textContent = s;
    });
    el('text', { x: (x0 + x1) / 2, y: H - 2, class: 'tick', 'text-anchor': 'middle' }, chart).textContent = `one orbit of ${d.name}, ${d.dots} dots`;
    if (b) {
      for (const [arr, cls] of [[b.d, 'band']]) {
        const up = [];
        const dn = [];
        for (let k = 0; k <= d.dots; k++) {
          const v = arr[k % d.dots] / 10;
          up.push([X((TAU * k) / d.dots), Y(v)]);
          dn.push([X((TAU * k) / d.dots), Y(-v)]);
        }
        el('path', { d: 'M' + up.concat(dn.reverse()).map((p) => fmt(p[0], 1) + ' ' + fmt(p[1], 1)).join('L') + 'Z', class: cls }, chart);
      }
    }
    const line = (arr, cls) => el('path', { d: 'M' + arr.map((v, i) => fmt(X((TAU * i) / n), 1) + ' ' + fmt(Y(v), 2)).join('L'), class: cls }, chart);
    line(uni, 'curve uniform');
    line(ell, 'curve ellipse');
    el('line', { x1: x0, x2: x1, y1: Y(0), y2: Y(0), class: 'curve kepler' }, chart);
    const iu = uni.indexOf(Math.min(...uni));
    el('text', { x: X((TAU * iu) / n) + 6, y: Y(uni[iu]) + 14, class: 'lab uniform' }, chart).textContent = 'even circle';
    el('text', { x: x0 + 6, y: Y(0) - 6, class: 'lab kepler' }, chart).textContent = 'Kepler (and the elliptical gears, nearly)';
    if (b) el('text', { x: X(Math.PI * 1.02), y: Y(b.d[Math.round(d.dots / 2)] / 10) - 6, class: 'lab band', 'text-anchor': 'start' }, chart).textContent = 'printed pair';
    const marker = el('line', { y1: yTop, y2: yBot, class: 'now' }, chart);
    CH = { marker, X };
    const ue = Math.max(...uni.map(Math.abs));
    const ee = Math.max(...ell.map(Math.abs));
    let note = `For ${d.name}, a planet moving evenly round a circle is up to ${fmt(ue)}° out; two elliptical gears are up to ${ee * 60 < 60 ? fmt(ee * 60) + '′' : fmt(ee, 2) + '°'} out.`;
    if (b) {
      note += ` The printed pair at these settings: up to ${fmt(b.t, 2)}° with both wheels centred on their pegs, ${fmt(b.b, 2)}° with each wheel anywhere its bore allows, ${fmt(b.l, 2)}° read loosely (largest errors found, not proven bounds).`;
      note +=
        b.m > 0
          ? ` Even then, every reading sampled lands nearer its own orbit dot than either neighbour, at least ${fmt(b.m, 2)}° short of the midpoint between them.`
          : ` In the worst arrangements found, a reading can land nearer a neighbouring orbit dot than its own, up to ${fmt(-b.m, 2)}° past the midpoint between them.`;
      if (b.b > ue) note += ` That is more than the whole effect: the printed ${d.name} pair cannot show Kepler's law against an even circle.`;
      else if (b.b > ee) note += ' So the printed pair can tell Kepler from an even circle, but not from the elliptical gears.';
    } else note += ' (The printed pair\'s error budget is not computed for these settings.)';
    $('chart-note').textContent = note;
  }
  function chartMarker(M) {
    if (!CH) return;
    const x = CH.X(mod(M, TAU));
    CH.marker.setAttribute('x1', fmt(x, 1));
    CH.marker.setAttribute('x2', fmt(x, 1));
  }

  // ---------------------------------------------------------------- the sky table
  function skyTable() {
    const tb = document.querySelector('#sky-table tbody');
    tb.textContent = '';
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const unit = (a) => {
      const l = Math.hypot(a[0], a[1], a[2]);
      return a.map((x) => x / l);
    };
    for (const key of K.OPTIONS.bodies) {
      const s = SKY.bodies[key];
      const B = K.BODIES[key];
      const P = [];
      for (let i = 0; i < s.xyz.length; i += 3) P.push([s.xyz[i] * SKY.unit, s.xyz[i + 1] * SKY.unit, s.xyz[i + 2] * SKY.unit]);
      const u = unit(P[0]);
      const w = cross(unit(cross(P[0], P[1])), u);
      let worst = 0;
      P.forEach((p, i) => {
        const ang = Math.atan2(dot3(p, w), dot3(p, u));
        worst = Math.max(worst, Math.abs(K.wrapPi(K.trueFromMean((TAU * i) / B.dots, B.e) - ang)));
      });
      const orbits = Math.round((P.length - 1) / B.dots);
      const tr = document.createElement('tr');
      const amin = worst * DEG * 60;
      [B.name, `${orbits} orbit${orbits > 1 ? 's' : ''} from the perihelion of ${jdDate(s.T0 + 2451545)}, ${P.length} dots`, amin < 60 ? `${fmt(amin)}′` : `${fmt(amin)}′ (${fmt(worst * DEG, 2)}°)`].forEach((t) => {
        const td = document.createElement('td');
        td.textContent = t;
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    }
  }

  // ---------------------------------------------------------------- make
  function stats() {
    const d = st.d;
    const b = BUDGET[[d.body, d.C, d.bore].join('|')];
    const rows = [
      ['Teeth', `${d.N} on each wheel, module ${fmt(d.m, 2)} mm, 25° pressure angle`],
      ['Time wheel', `pitch radius ${fmt(d.r1min)}–${fmt(d.r1max)} mm`],
      ['Kepler wheel', `pitch radius ${fmt(d.r2min)}–${fmt(d.r2max)} mm: speed ratio ${fmt(d.r1min / d.r2max, 2)}–${fmt(d.r1max / d.r2min, 2)}`],
      ['Base plate', `${fmt(d.plate.x1 - d.plate.x0)} × ${fmt(d.plate.y1 - d.plate.y0)} mm, ${fmt(d.z.pegA)} mm tall at the knob's peg`],
      ['Drawn orbit', `perihelion ${fmt(d.qD)} mm, aphelion ${fmt(d.QD)} mm from the Sun's peg; time dial radius ${fmt(d.rT)} mm`],
      ['Clearances', `bore ${d.bore} mm, tooth flanks ${d.flank} mm, tooth tips ${d.tip} mm (per side), wheels 1 mm above the dials`],
    ];
    const wk = wheel2D('kepler');
    const bal = wk.balance;
    rows.push([
      'Balance',
      `the Kepler wheel's centre of mass is ${fmt(bal.off, 2)} mm off its axis, ${fmt(bal.inside, 2)} mm inside the boss it rests on (it needs ${fmt(bal.need, 2)}: 1 mm, and ${fmt(d.play, 2)} mm of play in the bore)` +
        (wk.weightH ? `, with a counterweight ${fmt(wk.weightH, 1)} mm tall on its light side` : ''),
    ]);
    if (b) rows.push(['Reading error', `${fmt(b.t, 2)}° centred, ${fmt(b.b, 2)}° anywhere in the bores, ${fmt(b.l, 2)}° read loosely (largest found)`]);
    const dl = $('stats');
    dl.textContent = '';
    for (const [k, v] of rows) {
      const div = document.createElement('div');
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      div.append(dt, dd);
      dl.appendChild(div);
    }
  }
  const PARTNAME = { base: 'base plate', time: 'time wheel', kepler: 'kepler wheel', coupon: 'calibration coupon' };
  function download(part) {
    if (!st.d) return;
    if (!st.parts) st.parts = K.buildParts(st.d, st.o);
    const bytes = K.Mesh.stl(st.parts[part], 'kepler-pair ' + PARTNAME[part]);
    const name = part === 'coupon' ? 'kepler-pair-coupon.stl' : `kepler-pair-${st.d.body}-${st.d.C}mm-bore${st.d.bore}-${part}.stl`;
    const url = URL.createObjectURL(new Blob([bytes], { type: 'model/stl' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    $('dl-note').textContent = `${name}: ${st.parts[part].F.length.toLocaleString('en')} triangles, ${(bytes.length / 1024).toFixed(0)} KB. Binary STL in millimetres, made in this page; nothing is sent anywhere.`;
  }
  for (const btn of document.querySelectorAll('.downloads button')) btn.addEventListener('click', () => download(btn.dataset.part));

  // cutting the teeth takes about a second, so it waits for the page to paint first
  function rebuild() {
    const gen = ++st.gen;
    syncForm();
    $('cut-status').textContent = 'Cutting teeth…';
    for (const btn of document.querySelectorAll('.downloads button')) btn.disabled = true;
    setTimeout(() => {
      if (gen !== st.gen) return;
      const d = K.design({ body: st.body, C: st.C, bore: st.bore });
      const sameOrbit = st.d && st.d.body === d.body;
      st.d = d;
      st.o = K.wheelOutlines(d);
      st.parts = null;
      if (!sameOrbit) {
        st.M = 0;
        $('today-note').textContent = '';
      }
      drawMachine();
      drawChart();
      stats();
      render();
      $('cut-status').textContent = `${d.name}: ${d.N} teeth a wheel, pegs ${d.C} mm apart`;
      for (const btn of document.querySelectorAll('.downloads button')) btn.disabled = false;
    }, 30);
  }
  let deb = null;
  $('settings').addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.name === 'body') {
      st.body = t.value;
      const cs = K.cRange(st.body);
      if (!cs.includes(st.C)) st.C = cs.includes(70) ? 70 : cs[cs.length - 1];
    } else if (t.name === 'bore') st.bore = +t.value;
    else if (t.id === 'size') {
      st.C = +t.value;
      $('size-out').textContent = st.C + ' mm';
    }
    stopRun();
    clearTimeout(deb);
    deb = setTimeout(rebuild, t.id === 'size' ? 250 : 0);
  });
  $('settings').addEventListener('submit', (ev) => ev.preventDefault());
  let lastW = 0;
  window.addEventListener('resize', () => {
    const w = Math.round(chart.getBoundingClientRect().width);
    if (!st.d || Math.abs(w - lastW) < 40) return;
    lastW = w;
    drawChart();
    render();
  });

  skyTable();
  rebuild();
})();
