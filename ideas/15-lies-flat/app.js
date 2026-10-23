/* Lies Flat — page glue: seed in the URL, generation spread over frames, download. */
(function () {
  'use strict';
  const LF = window.LiesFlat;
  const $ = (id) => document.getElementById(id);
  const paper = $('paper'), art = $('art'), status = $('status');
  const seedInput = $('seed');
  let job = 0; // increments to cancel a generation in progress
  let current = null; // { seed, svg, stats }
  let url = null;

  const clean = (s) => String(s).trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  function randomSeed() {
    const a = new Uint32Array(1);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return String(1 + (a[0] % 999999));
  }
  function seedFromHash() {
    const m = /(?:^|[#&])seed=([^&]*)/.exec(location.hash);
    return m ? clean(decodeURIComponent(m[1])) : '';
  }
  function setHash(seed) {
    const h = '#seed=' + encodeURIComponent(seed);
    if (location.hash !== h) history.replaceState(null, '', h);
  }

  // Run LF.steps(seed) a few milliseconds at a time so the page never freezes.
  function draw(seed) {
    const my = ++job;
    seedInput.value = seed;
    setHash(seed);
    paper.classList.add('busy');
    status.textContent = 'Folding seed ' + seed + '…';
    const it = LF.steps(seed);
    const slice = () => {
      if (my !== job) return;
      const t0 = performance.now();
      try {
        for (;;) {
          const r = it.next();
          if (r.done) { show(seed, r.value); return; }
          if (performance.now() - t0 > 12) break;
        }
      } catch (e) {
        status.textContent = 'Could not fold seed ' + seed + ': ' + e.message;
        return;
      }
      setTimeout(slice, 0);
    };
    setTimeout(slice, 0);
  }

  function show(seed, res) {
    current = { seed, svg: res.svg, stats: res.stats };
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(new Blob([res.svg], { type: 'image/svg+xml' }));
    art.onload = () => paper.classList.remove('busy');
    art.src = url;
    art.alt = 'Lies Flat, seed ' + seed + ': on the left a crease pattern of zigzag rows and straight columns in black and red; on the right the same creases after folding, a ring of overlapping straight lines.';
    document.title = 'Lies Flat — ' + seed;
    facts(res.stats);
    const numeric = /^\d+$/.test(seed);
    $('prev').disabled = numeric && Number(seed) <= 1;
  }

  const fmt = (x, d) => Number(x).toLocaleString('en-GB', { maximumFractionDigits: d, minimumFractionDigits: d });
  const sci = (x) => (x === 0 ? '0' : x.toExponential(0).replace('e', ' × 10^').replace(/\^(-?\d+)/, (m, p) => sup(p)));
  const sup = (s) => s.replace(/-/g, '⁻').replace(/\d/g, (c) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[c]);
  function list(el, rows) {
    el.textContent = '';
    for (const [k, v] of rows) {
      const dt = document.createElement('dt'); dt.textContent = k;
      const dd = document.createElement('dd'); dd.textContent = v;
      el.append(dt, dd);
    }
  }
  function facts(st) {
    list($('proof'), [
      ['Interior vertices', String(st.vertices) + ', each of degree 4'],
      ["Kawasaki's theorem", 'alternate angles sum to 180°, worst error ' + sci(st.kawasakiMaxDeg) + '°'],
      ["Maekawa's theorem", st.maekawaFail === 0 ? 'mountains − valleys = ±2 at all ' + st.vertices : st.maekawaFail + ' failures'],
      ['Big–little–big', st.oddFail === 0 ? 'the odd crease borders a smallest angle at all ' + st.vertices : st.oddFail + ' failures'],
      ['Two-stage folding', st.twoStage ? 'preconditions hold (straight columns, mirrored rows, accordion order)' : 'FAILED'],
      ['Folded positions agree', 'whatever path is taken, to ' + sci(st.holonomy * st.sheetScale) + ' mm'],
      ['Thickest point', st.layers + ' layers (of 576 points sampled)'],
    ]);
    const m = (st.length / 1000);
    list($('plot'), [
      ['Paper', 'A3 landscape, 420 × 297 mm'],
      ['Pens', '0.3 mm black, then 0.3 mm red'],
      ['Line', fmt(m, 1) + ' m (black ' + fmt(st.pen.black.draw / 1000, 1) + ', red ' + fmt(st.pen.red.draw / 1000, 1) + ')'],
      ['Pen lifts', String(st.lifts)],
      ['Estimated time', '≈ ' + Math.round(st.seconds / 60) + ' min'],
      ['Sheet', st.columns + ' columns × ' + st.rows + ' rows; the folded drawing is shown ' + fmt(st.foldedScale, 1) + '× larger'],
    ]);
  }

  function step(dir) {
    const s = current ? current.seed : seedInput.value;
    let n = /^\d+$/.test(s) ? Number(s) : LF.cyrb128(s)[0] % 999999;
    n = Math.max(1, n + dir);
    draw(String(n));
  }
  function save() {
    if (!current) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([current.svg], { type: 'image/svg+xml' }));
    a.download = 'lies-flat-' + current.seed + '.svg';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  $('roll').addEventListener('click', () => draw(randomSeed()));
  $('save').addEventListener('click', save);
  $('prev').addEventListener('click', () => step(-1));
  $('next').addEventListener('click', () => step(1));
  $('seedForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const s = clean(seedInput.value);
    if (s) draw(s);
    seedInput.blur();
  });
  window.addEventListener('hashchange', () => {
    const s = seedFromHash();
    if (s && (!current || s !== current.seed)) draw(s);
  });
  document.addEventListener('keydown', (e) => {
    if (e.target === seedInput || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'r' || e.key === 'R') draw(randomSeed());
    else if (e.key === 's' || e.key === 'S') save();
  });

  draw(seedFromHash() || randomSeed());
})();
