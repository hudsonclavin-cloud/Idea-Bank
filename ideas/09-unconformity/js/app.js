/* Unconformity — page controller: seed in the URL, rolling, stepping, tints, export. */
(function () {
  'use strict';
  const UNC = window.UNC;
  const $ = (id) => document.getElementById(id);
  const art = $('art'), plate = $('plate'), stage = $('stage');
  const bar = $('progress').firstElementChild;
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const app = { seed: null, tint: null, H: null, colours: null, job: null, raf: 0, cssW: 0, pxW: 0, exporting: false };
  window.UNC_APP = app;

  // ---------- URL ----------
  function readHash() {
    const h = new URLSearchParams(location.hash.replace(/^#/, ''));
    let seed = (h.get('seed') || '').trim().slice(0, 40);
    const tint = h.get('tint');
    if (!seed) seed = null;
    return { seed, tint: tint && UNC.PALETTES[tint] ? tint : null };
  }
  function hashFor(seed, tint) {
    const p = new URLSearchParams();
    p.set('seed', seed);
    if (tint) p.set('tint', tint);
    return '#' + p.toString();
  }
  function writeHash(seed, tint) {
    history.replaceState(null, '', hashFor(seed, tint));
  }
  function randomSeed() {
    // seeds are rolled with the platform RNG; the artwork itself only ever uses the seeded PRNG
    let n;
    if (window.crypto && crypto.getRandomValues) {
      const a = new Uint32Array(1);
      crypto.getRandomValues(a);
      n = a[0];
    } else n = Math.floor(Math.random() * 4294967296);
    return String(1 + (n % 999999));
  }
  function stepSeed(seed, d) {
    if (/^\d+$/.test(seed)) return String(Math.max(0, parseInt(seed, 10) + d));
    const m = seed.match(/^(.*?)(\d+)$/);
    if (m) return m[1] + Math.max(0, parseInt(m[2], 10) + d);
    return seed + (d > 0 ? '1' : '');
  }

  // ---------- sizing ----------
  function measure() {
    const narrow = window.matchMedia('(max-width: 900px)').matches;
    const stageW = stage.clientWidth;
    // the whole plate should fit on screen: limited by the column width and the window height
    const maxH = window.innerHeight - (narrow ? 32 : 48);
    let w = Math.min(stageW, maxH * (UNC.GEOM.pw / UNC.GEOM.ph), 1000);
    w = Math.max(200, Math.floor(w));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    return { css: w, px: Math.round(w * dpr) };
  }
  function applySize(m) {
    plate.style.width = m.css + 'px';
    plate.style.height = Math.round((m.css * UNC.GEOM.ph) / UNC.GEOM.pw) + 'px';
  }

  // ---------- panel ----------
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function fillPanel() {
    const H = app.H;
    $('title').textContent = 'Fig. ' + H.seed + '. ' + H.title + '.';
    $('seed').value = H.seed;
    const pal = app.colours.pal;
    $('tintName').textContent = pal.name;
    art.setAttribute('aria-label', 'Generated geological cross-section, figure ' + H.seed + ': ' + H.title + '.');
    const ol = $('record');
    ol.textContent = '';
    for (const r of H.record) {
      const li = el('li');
      li.appendChild(el('span', 'age', r.age));
      li.appendChild(el('strong', null, r.title + '. '));
      li.appendChild(el('span', 'txt', r.text));
      ol.appendChild(li);
    }
    const n = H.silent.length;
    $('silent').textContent = n ? 'The history behind this seed holds ' + n + ' more event' + (n > 1 ? 's' : '') + ' that left no trace inside this frame.' : '';
    $('artCaption').textContent = H.record.map((r) => r.age + ': ' + r.title + '. ' + r.text).join(' ');
  }

  // ---------- rendering ----------
  function cancel() {
    if (app.raf) cancelAnimationFrame(app.raf);
    app.raf = 0;
    if (app.job) app.job.cancelled = true;
    app.job = null;
  }

  function render(opts) {
    opts = opts || {};
    cancel();
    const m = measure();
    applySize(m);
    app.cssW = m.css;
    app.pxW = m.px;
    if (!opts.keepHistory || !app.H || app.H.seed !== app.seed) {
      app.H = UNC.generate(app.seed);
    }
    const palName = app.tint || UNC.choosePalette(app.seed);
    app.colours = UNC.colourise(app.H, palName);
    fillPanel();
    document.title = 'Unconformity — Fig. ' + app.seed;
    document.body.dataset.state = 'rendering';
    art.dataset.seed = app.seed;

    let job;
    if (reduceMotion) {
      // draw off-screen and show the finished plate in one go
      job = UNC.makeJob(app.H, app.colours, m.px, {});
    } else {
      job = UNC.makeJob(app.H, app.colours, m.px, { canvas: art, progressive: true });
    }
    app.job = job;
    const tick = () => {
      if (job.cancelled) return;
      job.step(11);
      bar.style.width = (job.progress * 100).toFixed(1) + '%';
      if (job.done) {
        if (job.canvas !== art) {
          art.width = job.canvas.width;
          art.height = job.canvas.height;
          art.getContext('2d').drawImage(job.canvas, 0, 0);
        }
        app.raf = 0;
        document.body.dataset.state = 'done';
        return;
      }
      app.raf = requestAnimationFrame(tick);
    };
    app.raf = requestAnimationFrame(tick);
  }

  // render a seed without adding a history entry (first load)
  function go(seed, tint) {
    app.seed = seed;
    app.tint = tint;
    writeHash(seed, tint);
    render();
  }

  function navigate(seed, tint) {
    // pushes a history entry; the hashchange handler renders
    if (seed === app.seed && tint === app.tint) return;
    const url = hashFor(seed, tint);
    if (location.hash === url) go(seed, tint);
    else location.hash = url;
  }

  window.addEventListener('hashchange', () => {
    const h = readHash();
    if (!h.seed) return;
    if (h.seed === app.seed && h.tint === app.tint) return;
    const sameSeed = h.seed === app.seed;
    app.seed = h.seed;
    app.tint = h.tint;
    render({ keepHistory: sameSeed });
  });

  // ---------- export ----------
  function exportPng() {
    if (app.exporting || !app.H) return;
    app.exporting = true;
    const btn = $('save');
    btn.disabled = true;
    const label = btn.textContent;
    const H = app.H, colours = app.colours, seed = app.seed;
    const job = UNC.makeJob(H, colours, 2400, {});
    const tick = () => {
      job.step(12);
      btn.textContent = 'Engraving ' + Math.round(job.progress * 100) + '%';
      if (!job.done) {
        requestAnimationFrame(tick);
        return;
      }
      const finish = () => {
        btn.textContent = label;
        btn.disabled = false;
        app.exporting = false;
      };
      const name = 'unconformity-' + String(seed).replace(/[^a-z0-9_-]+/gi, '_') + '-' + colours.name + '.png';
      if (job.canvas.toBlob) {
        job.canvas.toBlob((blob) => {
          if (blob) {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = name;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 4000);
          }
          finish();
        }, 'image/png');
      } else {
        finish();
      }
    };
    requestAnimationFrame(tick);
  }

  // ---------- controls ----------
  $('roll').addEventListener('click', () => navigate(randomSeed(), null));
  $('next').addEventListener('click', () => navigate(stepSeed(app.seed, 1), app.tint));
  $('prev').addEventListener('click', () => navigate(stepSeed(app.seed, -1), app.tint));
  $('tint').addEventListener('click', () => {
    const own = UNC.choosePalette(app.seed);
    const cur = app.tint || own;
    const order = UNC.PAL_ORDER;
    const nxt = order[(order.indexOf(cur) + 1) % order.length];
    navigate(app.seed, nxt === own ? null : nxt);
  });
  $('save').addEventListener('click', exportPng);
  $('seedForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const v = $('seed').value.trim().slice(0, 40);
    if (v) navigate(v, null);
    $('seed').blur();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.target && (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA')) return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    switch (ev.key) {
      case 'ArrowRight': navigate(stepSeed(app.seed, 1), app.tint); break;
      case 'ArrowLeft': navigate(stepSeed(app.seed, -1), app.tint); break;
      case 'r': case 'R': navigate(randomSeed(), null); break;
      case 't': case 'T': $('tint').click(); break;
      case 's': case 'S': exportPng(); break;
      default: return;
    }
    ev.preventDefault();
  });

  let resizeT = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => {
      const m = measure();
      if (Math.abs(m.css - app.cssW) < 2 && Math.abs(m.px - app.pxW) / app.pxW < 0.08) {
        applySize(m);
        app.cssW = m.css;
        return;
      }
      render({ keepHistory: true });
    }, 220);
  });

  // ---------- start ----------
  const h = readHash();
  go(h.seed || randomSeed(), h.tint);
})();
