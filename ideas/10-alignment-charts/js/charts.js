/* Alignment Charts — the catalogue.
 *
 * Each chart is three scales. A scale says where every value of one variable
 * lives on the paper: fwd(v) -> s (a natural coordinate) and pos(s) -> [x, y].
 * The geometry engine never sees the formulas below; `solve` exists only so the
 * page (and the tests) can cross-check what the straightedge reads.
 */
(function (root, factory) {
  const cjs = typeof module === 'object' && module.exports;
  const load = (file, name) => (cjs ? require(file) : root[name]);
  const api = factory({ engine: load('./engine.js', 'ACEngine') });
  if (cjs) module.exports = api;
  else root.ACCharts = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';
  const { decimalLadder, timeLadder, clockRoundness, sRange, clean } = deps.engine;

  // ---------------------------------------------------------------- formatting & parsing

  const MINUS = '−';
  const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
  const sup = (s) => [...String(s)].map((c) => SUP[c] ?? c).join('');

  /** Plain number with a real minus sign; very large or small values as a×10ⁿ. */
  function fmtNum(v) {
    if (!Number.isFinite(v)) return '—';
    if (v === 0) return '0';
    const a = Math.abs(v);
    if (a >= 1e5 || a < 1e-3) {
      const [m, e] = clean(v).toExponential().split('e');
      const mant = +(+m).toPrecision(3);
      const pow = `10${sup(+e)}`;
      return (mant === 1 ? pow : mant === -1 ? MINUS + pow : `${String(mant).replace('-', MINUS)}×${pow}`);
    }
    return String(clean(v)).replace('-', MINUS);
  }

  const sig = (v, n = 3) => (Number.isFinite(v) ? fmtNum(+v.toPrecision(n)) : '—');

  /** Fixed decimals, trimmed: 16.70 -> "16.7". */
  const dec = (v, d = 1) => (Number.isFinite(v) ? fmtNum(+v.toFixed(d)) : '—');

  /** Percent with sensible precision near 0 and 100. */
  function pct(v) {
    if (!Number.isFinite(v)) return '—';
    if (v > 99) return fmtNum(clean(100 - +(100 - v).toPrecision(2)));
    if (v < 1) return fmtNum(+v.toPrecision(2));
    return fmtNum(+v.toPrecision(3));
  }

  /** Seconds as h:mm:ss or m:ss. */
  function hms(sec) {
    if (!Number.isFinite(sec)) return '—';
    const t = Math.round(sec);
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = t % 60;
    const p = (n) => String(n).padStart(2, '0');
    return h ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
  }

  /** Tick labels for clock time: "25:00" under an hour, "1h", "2h30" above. */
  function clockTick(sec) {
    if (sec < 3600 || sec % 60) return hms(sec);
    const h = Math.floor(sec / 3600);
    const m = Math.round((sec % 3600) / 60);
    return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
  }

  function parseNum(str) {
    const t = String(str).trim().replace(/[−–]/g, '-').replace(/,/g, '.').replace(/[%\s]/g, '');
    if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return null;
    const v = parseFloat(t);
    return Number.isFinite(v) ? v : null;
  }

  /** "3:59:48", "25:00", "3h30", "3h30m15s", or plain minutes ("5.5"). Returns seconds. */
  function parseClock(str) {
    const t = String(str).trim().toLowerCase().replace(/\s+/g, '');
    if (!t) return null;
    let m = t.match(/^(\d+(?:\.\d+)?)h(?:(\d+(?:\.\d+)?)m?)?(?:(\d+(?:\.\d+)?)s)?$/);
    if (m) return +m[1] * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
    m = t.match(/^(\d+(?:\.\d+)?)m(?:(\d+(?:\.\d+)?)s?)?$/);
    if (m) return +m[1] * 60 + (+m[2] || 0);
    if (t.includes(':')) {
      const parts = t.split(':');
      if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
      const n = parts.map(Number);
      return n.length === 3 ? n[0] * 3600 + n[1] * 60 + n[2] : n[0] * 60 + n[1];
    }
    const v = parseNum(t);
    return v === null ? null : v * 60;
  }

  // ---------------------------------------------------------------- helpers

  const logit = (p) => Math.log(p / (1 - p));
  const expit = (s) => 1 / (1 + Math.exp(-s));
  const ident = (v) => v;

  /** 1-2-5 (or any mantissas) times powers of ten inside [min, max]. */
  function logAnchors(min, max, mantissas = [1]) {
    const out = [];
    for (let e = Math.floor(Math.log10(min)) - 1; e <= Math.ceil(Math.log10(max)) + 1; e++) {
      for (const m of mantissas) {
        const v = clean(m * Math.pow(10, e));
        if (v >= min * (1 - 1e-12) && v <= max * (1 + 1e-12)) out.push(v);
      }
    }
    return out;
  }

  function scale(o) {
    return {
      labelDir: [1, 0],
      parse: parseNum,
      read: (v) => sig(v, 3),
      fmt: fmtNum,
      ...o,
      ticks: { ladder: decimalLadder, anchors: [], ...(o.ticks || {}) },
    };
  }

  /**
   * Three parallel straight scales for s_middle = s_left + s_right.
   * The outer scales sit at x = 0 and x = width with moduli m1, m2 (paper units
   * per unit of s); the middle sits at width * m1/(m1+m2) with modulus
   * m1*m2/(m1+m2). A line from (0, m1 s1) to (width, m2 s2) then passes through
   * the middle scale exactly at m3 (s1 + s2).
   */
  function parallel(left, middle, right, { heights = [1, 1], width = 0.8 } = {}) {
    const [l0, l1] = sRange(left);
    const [r0, r1] = sRange(right);
    const m1 = heights[0] / (l1 - l0);
    const m2 = heights[1] / (r1 - r0);
    const m3 = (m1 * m2) / (m1 + m2);
    const c1 = (l0 + l1) / 2;
    const c2 = (r0 + r1) / 2;
    const xm = m1 / (m1 + m2);
    left.pos = (s) => [0, m1 * (s - c1)];
    right.pos = (s) => [width, m2 * (s - c2)];
    middle.pos = (s) => [width * xm, m3 * (s - c1 - c2)];
    return [left, middle, right];
  }

  // ---------------------------------------------------------------- 1. Bayes (Fagan)

  const PROB_ANCHORS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 98, 99, 99.5, 99.8, 99.9];

  function bayes() {
    const pre = scale({
      key: 'pre',
      name: 'Pre-test',
      unit: 'probability %',
      label: 'Pre-test probability',
      suffix: '%',
      min: 0.1,
      max: 99.9,
      fwd: (v) => -logit(v / 100), // upside down, so that the sum works out
      inv: (s) => 100 * expit(-s),
      ticks: { anchors: PROB_ANCHORS },
      labelDir: [-1, 0],
      read: pct,
    });
    const lr = scale({
      key: 'lr',
      name: 'Likelihood',
      unit: 'ratio',
      label: 'Likelihood ratio',
      suffix: '×',
      min: 0.001,
      max: 1000,
      fwd: Math.log,
      inv: Math.exp,
      ticks: { anchors: logAnchors(0.001, 1000, [1, 2, 5]) },
      labelDir: [1, 0],
      read: (v) => sig(v, 3),
    });
    const post = scale({
      key: 'post',
      name: 'Post-test',
      unit: 'probability %',
      label: 'Post-test probability',
      suffix: '%',
      min: 0.1,
      max: 99.9,
      fwd: (v) => logit(v / 100),
      inv: (s) => 100 * expit(s),
      ticks: { anchors: PROB_ANCHORS },
      labelDir: [1, 0],
      read: pct,
    });
    const odds = (p) => p / (100 - p);
    const prob = (o) => (100 * o) / (1 + o);
    return {
      id: 'bayes',
      tab: 'Bayes',
      tabNote: 'test results',
      title: 'What does a test result mean?',
      kicker: 'Fagan nomogram · Bayes’ theorem in log-odds',
      formula: 'post-test odds = pre-test odds × likelihood ratio',
      scales: parallel(pre, lr, post),
      pins: [
        ['pre', 30],
        ['lr', 4],
      ],
      solve: {
        post: ({ pre: p, lr: l }) => prob(odds(p) * l),
        pre: ({ post: p, lr: l }) => prob(odds(p) / l),
        lr: ({ pre: a, post: b }) => odds(b) / odds(a),
      },
      examples: [
        { label: 'Rare condition, good test', pins: [['pre', 1], ['lr', 10]] },
        { label: 'Even odds, strong positive', pins: [['pre', 50], ['lr', 20]] },
        { label: 'A negative result', pins: [['pre', 30], ['lr', 0.1]] },
        { label: 'How strong a test to reach 50%?', pins: [['pre', 5], ['post', 50]] },
      ],
      about: `
        <p>A test result does not tell you the probability that something is true. It tells you how far to <em>move</em>.
        The likelihood ratio says how much more often this result turns up when the condition is present than when it is absent.
        Lay the edge from where you started, through the ratio, and read where you land.</p>
        <p>Try the first example: a test ten times likelier to be positive in the sick still leaves a 1-in-100 starting belief
        under 10%. That gap between intuition and arithmetic is why this chart exists.</p>
        <p>It works because Bayes’ theorem is a plain sum in log-odds: logit(post) = logit(pre) + ln(LR).
        The pre-test scale runs upside down so the sum lands on a straight line. Terry Fagan published the chart in 1975
        as a short letter; it is still a staple of evidence-based-medicine teaching.</p>`,
    };
  }

  // ---------------------------------------------------------------- 2. Dew point (Magnus)

  const MA = 17.625;
  const MB = 243.04; // Alduchov & Eskridge (1996) Magnus coefficients, over water
  const gT = (t) => (MA * t) / (MB + t);
  const gInv = (g) => (MB * g) / (MA - g);
  const cToF = (c) => (c * 9) / 5 + 32;
  const fToC = (f) => ((f - 32) * 5) / 9;

  function dewPoint() {
    const fahrenheit = (min, max, anchors) => ({
      min: cToF(min),
      max: cToF(max),
      toPrimary: fToC,
      caption: '°F',
      anchors,
      ladder: decimalLadder,
      fmt: fmtNum,
    });
    const t = scale({
      key: 't',
      name: 'Air temperature',
      unit: '',
      caption: '°C',
      label: 'Air temperature',
      suffix: '°C',
      min: -20,
      max: 50,
      fwd: gT,
      inv: gInv,
      ticks: { anchors: [-20, -10, 0, 10, 20, 30, 40, 50] },
      labelDir: [-1, 0],
      alt: fahrenheit(-20, 50, [0, 20, 40, 60, 80, 100, 120]),
      read: (v) => dec(v, 1),
      extra: (v) => `${dec(cToF(v), 0)} °F`,
    });
    const rh = scale({
      key: 'rh',
      name: 'Humidity',
      unit: 'relative %',
      label: 'Relative humidity',
      suffix: '%',
      min: 5,
      max: 100,
      fwd: (v) => Math.log(v / 100),
      inv: (s) => 100 * Math.exp(s),
      ticks: { anchors: [5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100] },
      labelDir: [1, 0],
      read: (v) => sig(v, 3),
    });
    const td = scale({
      key: 'td',
      name: 'Dew point',
      unit: '',
      caption: '°C',
      label: 'Dew point',
      suffix: '°C',
      min: -50,
      max: 50,
      fwd: gT,
      inv: gInv,
      ticks: { anchors: [-50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50] },
      labelDir: [1, 0],
      alt: fahrenheit(-50, 50, [-40, -20, 0, 20, 40, 60, 80, 100, 120]),
      read: (v) => dec(v, 1),
      extra: (v) => `${dec(cToF(v), 0)} °F`,
    });
    const [L, M, R] = parallel(t, td, rh);
    return {
      id: 'dew',
      tab: 'Dew point',
      tabNote: 'fog & mugginess',
      title: 'When will the air give up its water?',
      kicker: 'Dew point from temperature and humidity (Magnus formula)',
      formula: 'g(T<sub>d</sub>) = g(T) + ln(RH),   g(T) = 17.625·T / (243.04 + T)',
      scales: [L, R, M],
      pins: [
        ['t', 25],
        ['rh', 60],
      ],
      solve: {
        td: ({ t: a, rh: h }) => gInv(gT(a) + Math.log(h / 100)),
        t: ({ td: d, rh: h }) => gInv(gT(d) - Math.log(h / 100)),
        rh: ({ t: a, td: d }) => 100 * Math.exp(gT(d) - gT(a)),
      },
      examples: [
        { label: 'Sticky afternoon: 32 °C, 65%', pins: [['t', 32], ['rh', 65]] },
        { label: 'Will the window fog? 21 °C, 45%', pins: [['t', 21], ['rh', 45]] },
        { label: 'Damp evening: 10 °C, 95%', pins: [['t', 10], ['rh', 95]] },
        { label: 'Humidity for a 10 °C dew point at 25 °C?', pins: [['t', 25], ['td', 10]] },
      ],
      about: `
        <p>The dew point is the temperature at which the air’s water vapour would begin to condense. A cold drink below it
        beads with water; a window pane below it fogs; when the night air cools to it, dew and fog form. Unlike relative humidity,
        it does not swing with the time of day, which makes it a steadier measure of how muggy it feels.</p>
        <p>The chart uses the Magnus approximation with Alduchov and Eskridge’s coefficients, accurate to a few tenths
        of a degree in ordinary weather. In that form ln(RH) + g(T) = g(T<sub>d</sub>): a sum, so three parallel scales do it. The two
        temperature scales are gently non-linear, and each carries °C on one side and °F on the other.</p>
        <p>Pin air temperature and dew point instead, and the chart tells you the relative humidity. A dew point above the air
        temperature runs off the end of the humidity scale, which is the chart saying “that cannot happen”.</p>`,
    };
  }

  // ---------------------------------------------------------------- 3. Running pace

  const MILE = 1.609344;

  function pace() {
    const dist = scale({
      key: 'dist',
      name: 'Distance',
      unit: 'km',
      label: 'Distance',
      suffix: 'km',
      min: 1,
      max: 100,
      fwd: Math.log,
      inv: Math.exp,
      ticks: { anchors: [1, 2, 5, 10, 20, 50, 100] },
      labelDir: [-1, 0],
      marks: [
        { v: MILE, label: 'mile' },
        { v: 5, label: '5K' },
        { v: 10, label: '10K' },
        { v: 21.0975, label: 'half' },
        { v: 42.195, label: 'marathon' },
        { v: 50, label: '50K' },
        { v: 100, label: '100K' },
      ],
      read: (v) => sig(v, 4),
    });
    const time = scale({
      key: 'time',
      name: 'Finish time',
      unit: '',
      label: 'Finish time',
      suffix: 'h:mm:ss',
      min: 150,
      max: 60000,
      fwd: Math.log,
      inv: Math.exp,
      ticks: {
        anchors: [300, 600, 900, 1200, 1800, 2700, 3600, 5400, 7200, 10800, 14400, 18000, 21600, 28800, 36000, 43200, 54000],
        ladder: timeLadder,
        roundness: clockRoundness,
      },
      fmt: clockTick,
      labelDir: [1, 0],
      parse: parseClock,
      read: hms,
      input: hms,
    });
    const pc = scale({
      key: 'pace',
      name: 'Pace',
      unit: 'min:sec',
      caption: 'per km',
      label: 'Pace per km',
      suffix: 'min/km',
      min: 150,
      max: 600,
      fwd: Math.log,
      inv: Math.exp,
      ticks: { anchors: [180, 240, 300, 360, 420, 480, 540, 600], ladder: timeLadder, roundness: clockRoundness },
      fmt: hms,
      labelDir: [1, 0],
      alt: {
        min: 150 * MILE,
        max: 600 * MILE,
        toPrimary: (x) => x / MILE,
        caption: 'per mile',
        anchors: [300, 360, 420, 480, 540, 600, 660, 720, 780, 840, 900, 960],
        ladder: timeLadder,
        roundness: clockRoundness,
        fmt: hms,
      },
      parse: parseClock,
      read: hms,
      input: hms,
      extra: (v) => `${hms(v * MILE)} /mile`,
    });
    return {
      id: 'pace',
      tab: 'Pace',
      tabNote: 'running splits',
      title: 'How fast do I need to run?',
      kicker: 'Distance × pace = time, on logarithmic scales',
      formula: 'finish time = distance × pace',
      scales: parallel(dist, time, pc, { heights: [1, 0.62] }),
      margins: { phone: { r: 52 }, desk: { r: 76 } },
      pins: [
        ['dist', 42.195],
        ['time', 4 * 3600],
      ],
      solve: {
        time: ({ dist: d, pace: p }) => d * p,
        pace: ({ dist: d, time: t }) => t / d,
        dist: ({ time: t, pace: p }) => t / p,
      },
      examples: [
        { label: 'Sub-4 marathon', pins: [['dist', 42.195], ['time', 14400]] },
        { label: 'Sub-20 5K', pins: [['dist', 5], ['time', 1200]] },
        { label: 'Half at 5:00 per km', pins: [['dist', 21.0975], ['pace', 300]] },
        { label: 'How far in an hour at 6:00?', pins: [['time', 3600], ['pace', 360]] },
      ],
      about: `
        <p>The arithmetic every runner does in their head, done by a ruler instead. Logarithms turn the product
        distance × pace into a sum, so the three scales are parallel and logarithmic, and equal ratios are equal lengths.</p>
        <p>The pace scale is labelled twice: per kilometre on the outside, per mile on the inside. One line,
        two units, because a mile pace is just a kilometre pace slid along a logarithmic scale by ln 1.609. The common race
        distances are marked on the inside of the distance scale.</p>
        <p>Times below an hour read as minutes:seconds; above, as hours (2h30 is two and a half hours).</p>`,
    };
  }

  // ---------------------------------------------------------------- 4. Harmonic sum (angle chart)

  // Classic angle charts put the arms 120 degrees apart with one shared spacing. Any
  // angle works if the middle scale's spacing is multiplied by 2 cos(theta); a
  // narrower fan suits a page better, so this one uses theta = 38 degrees.
  const THETA = (38 * Math.PI) / 180;
  const ST = Math.sin(THETA);
  const CT = Math.cos(THETA);

  function harmonic() {
    const lin = { fwd: ident, inv: ident, ticks: { anchors: [0, 5, 10, 15, 20] } };
    const a = scale({
      key: 'a',
      name: 'a',
      unit: '',
      label: 'a',
      suffix: '',
      min: 0,
      max: 20,
      ...lin,
      pos: (s) => [-ST * s, CT * s],
      labelDir: [-CT, -ST],
    });
    const b = scale({
      key: 'b',
      name: 'b',
      unit: '',
      label: 'b',
      suffix: '',
      min: 0,
      max: 20,
      ...lin,
      pos: (s) => [ST * s, CT * s],
      labelDir: [CT, -ST],
    });
    const c = scale({
      key: 'c',
      name: 'together',
      unit: '',
      label: 'Together (c)',
      suffix: '',
      min: 0,
      max: 12,
      ...lin,
      ticks: { anchors: [0, 5, 10] },
      pos: (s) => [0, 2 * CT * s],
      labelDir: [1, 0],
    });
    return {
      id: 'harmonic',
      tab: 'Together',
      tabNote: 'resistors, lenses, pipes',
      title: 'Two at once',
      kicker: 'Angle nomogram for the harmonic sum',
      formula: '1/c = 1/a + 1/b',
      scales: [a, b, c],
      maxDistort: 2,
      pins: [
        ['a', 3],
        ['b', 6],
      ],
      solve: {
        c: ({ a: x, b: y }) => (x * y) / (x + y),
        a: ({ b: y, c: z }) => (y * z) / (y - z),
        b: ({ a: x, c: z }) => (x * z) / (x - z),
      },
      examples: [
        { label: 'Pipes: 3 h and 6 h, together?', pins: [['a', 3], ['b', 6]] },
        { label: 'Resistors: 4 Ω ∥ 12 Ω', pins: [['a', 4], ['b', 12]] },
        { label: 'Lens f = 4 cm, object at 6 cm', pins: [['a', 6], ['c', 4]] },
        { label: 'Two equals halve', pins: [['a', 10], ['b', 10]] },
      ],
      about: `
        <p>One formula hides in a surprising number of places. Two resistors in parallel. Two capacitors in series.
        A thin lens (1/f = 1/object + 1/image). Two pipes filling one tank, or two people painting one fence: if one takes
        3 hours and the other 6, together they take 2.</p>
        <p>Three straight scales leave one point. In the classic version the outer two are 120° apart, the middle one
        bisects them, and all three share one linear spacing; a little trigonometry shows that a line from a on one arm to
        b on the other crosses the middle at ab/(a + b). No logarithms, no curves: just the angle. This one is drawn
        narrower to fit a page, which works as long as the middle spacing is stretched by 2&thinsp;cos of the half-angle.</p>
        <p>Pin c and one of the others to solve backwards, for example to find where a lens forms its image. If c is
        larger than the value you pinned, the line runs off the chart, because there is no positive answer.</p>`,
    };
  }

  // ---------------------------------------------------------------- 5. Quadratic roots (curved scale)

  // q at (0, MQ q) and p at (1, MP p). With MP = 2 MQ the root curve spreads across
  // the gap instead of hugging the p line; p's range is halved to keep the lines level.
  const MQ = 0.05;
  const MP = 0.1;

  function quadratic() {
    const lin = { fwd: ident, inv: ident };
    const q = scale({
      key: 'q',
      name: 'q',
      unit: '',
      label: 'q (constant)',
      suffix: '',
      min: -20,
      max: 20,
      ...lin,
      ticks: { anchors: [-20, -10, 0, 10, 20] },
      pos: (s) => [0, MQ * s],
      labelDir: [-1, 0],
    });
    const p = scale({
      key: 'p',
      name: 'p',
      unit: '',
      label: 'p (coefficient of z)',
      suffix: '',
      min: -10,
      max: 10,
      ...lin,
      ticks: { anchors: [-10, -5, 0, 5, 10] },
      pos: (s) => [1, MP * s],
      labelDir: [1, 0],
    });
    // Collinear with (0, MQ q) and (1, MP p) exactly when z^2 + p z + q = 0.
    const z = scale({
      key: 'z',
      name: 'z',
      unit: 'positive root',
      label: 'z (positive roots)',
      suffix: '',
      min: 0,
      max: 11,
      ...lin,
      ticks: { anchors: [0, 1, 2, 5, 10] },
      pos: (s) => [(MQ * s) / (MP + MQ * s), (-MQ * MP * s * s) / (MP + MQ * s)],
      labelDir: [-1, -1],
      titleEnd: 'max',
    });
    return {
      id: 'quadratic',
      tab: 'Quadratic',
      tabNote: 'roots by ruler',
      title: 'Solve z² + pz + q = 0 with a ruler',
      kicker: 'A curved scale, and a line that can cross it twice',
      formula: 'z² + p·z + q = 0',
      scales: [q, p, z],
      readOrder: ['p', 'q', 'z'],
      maxDistort: 2.4,
      pins: [
        ['q', 10],
        ['p', -7],
      ],
      solve: {
        z: ({ p: P, q: Q }) => {
          const d = P * P - 4 * Q;
          if (d < 0) return [];
          const r = Math.sqrt(d);
          return [...new Set([(-P - r) / 2, (-P + r) / 2])].filter((x) => x >= 0).sort((x, y) => x - y);
        },
        q: ({ z: Z, p: P }) => -Z * Z - P * Z,
        p: ({ z: Z, q: Q }) => (Z === 0 ? NaN : -(Z * Z + Q) / Z),
      },
      examples: [
        { label: 'z² − 7z + 10: two roots', pins: [['q', 10], ['p', -7]] },
        { label: 'z² − 6z + 9: the line just touches', pins: [['q', 9], ['p', -6]] },
        { label: 'z² − 4z + 5: the line misses', pins: [['q', 5], ['p', -4]] },
        { label: 'z² + 3z − 10: one positive root', pins: [['q', -10], ['p', 3]] },
      ],
      about: `
        <p>Here the third scale is a curve. With q drawn at height q/20 on the left line and p at height p/10 on the right,
        each root z sits at (z/(2+z), −z²/(10(2+z))), and the three points are in line exactly when z² + pz + q = 0.
        So a line through q and p meets the curve at the positive roots: twice, once (just touching), or not at all.
        It is the discriminant, drawn as a picture.</p>
        <p>For negative roots, flip the sign of p: the roots of z² − pz + q are the negatives of the roots of
        z² + pz + q. You can also pin a root and p to find which q gives that root.</p>
        <p>Nomograms were a standard engineering tool for much of the twentieth century. The trick is the same as
        every other chart here: write the equation as “these three points are collinear”, then draw the points.</p>`,
    };
  }

  // ---------------------------------------------------------------- 6. Build your own: W = k U^a V^b

  const POWER_PRESETS = [
    {
      id: 'ohm',
      label: 'Ohm’s law: V = I · R',
      k: 1,
      u: { name: 'Current', unit: 'A', min: 0.01, max: 10, exp: 1 },
      v: { name: 'Resistance', unit: 'Ω', min: 1, max: 1000, exp: 1 },
      w: { name: 'Voltage', unit: 'V' },
    },
    {
      id: 'bmi',
      label: 'Body-mass index: m / h²',
      k: 1,
      u: { name: 'Mass', unit: 'kg', min: 30, max: 200, exp: 1 },
      v: { name: 'Height', unit: 'm', min: 1.2, max: 2.2, exp: -2 },
      w: { name: 'BMI', unit: 'kg/m²' },
    },
    {
      id: 'ke',
      label: 'Kinetic energy: ½ m v²',
      k: 0.5,
      u: { name: 'Mass', unit: 'kg', min: 0.1, max: 2000, exp: 1 },
      v: { name: 'Speed', unit: 'm/s', min: 1, max: 100, exp: 2 },
      w: { name: 'Energy', unit: 'J' },
    },
    {
      id: 'bsa',
      label: 'Body surface area (Mosteller)',
      k: 1 / 60,
      u: { name: 'Height', unit: 'cm', min: 100, max: 220, exp: 0.5 },
      v: { name: 'Weight', unit: 'kg', min: 10, max: 200, exp: 0.5 },
      w: { name: 'Surface', unit: 'm²' },
    },
    {
      id: 'cyl',
      label: 'Cylinder volume: π r² h',
      k: Math.PI,
      u: { name: 'Radius', unit: 'cm', min: 1, max: 100, exp: 2 },
      v: { name: 'Height', unit: 'cm', min: 1, max: 100, exp: 1 },
      w: { name: 'Volume', unit: 'cm³' },
    },
  ];

  /** Throws an Error with a human-readable message if the parameters cannot make a chart. */
  function validatePower(p) {
    const bad = (m) => {
      throw new Error(m);
    };
    if (!(p.k > 0) || !Number.isFinite(p.k)) bad('The constant k must be a positive number.');
    for (const [tag, s] of [
      ['U', p.u],
      ['V', p.v],
    ]) {
      const nm = s.name || tag;
      if (!(s.min > 0) || !(s.max > 0)) bad(`${nm}: the range must be positive (logarithmic scales cannot reach zero).`);
      if (!(s.max > s.min)) bad(`${nm}: “to” must be larger than “from”.`);
      if (s.max / s.min > 1e12) bad(`${nm}: keep the range within twelve powers of ten.`);
      if (!Number.isFinite(s.exp) || s.exp === 0) bad(`${nm}: the power must be a non-zero number.`);
      if (Math.abs(s.exp) > 10) bad(`${nm}: keep the power between −10 and 10.`);
    }
  }

  function powerChart(p) {
    validatePower(p);
    const logScale = (key, s, a, labelDir) =>
      scale({
        key,
        name: s.name || key.toUpperCase(),
        unit: s.unit || '',
        label: s.name || key.toUpperCase(),
        suffix: s.unit || '',
        min: s.min,
        max: s.max,
        fwd: (x) => a * Math.log(x),
        inv: (t) => Math.exp(t / a),
        ticks: { anchors: logAnchors(s.min, s.max) },
        labelDir,
        read: (x) => sig(x, 3),
      });
    const a = p.u.exp;
    const b = p.v.exp;
    const lk = Math.log(p.k);
    const corners = [p.u.min, p.u.max].flatMap((u) => [p.v.min, p.v.max].map((v) => p.k * u ** a * v ** b));
    const wmin = Math.min(...corners);
    const wmax = Math.max(...corners);
    const U = logScale('u', p.u, a, [-1, 0]);
    const V = logScale('v', p.v, b, [1, 0]);
    const W = scale({
      key: 'w',
      name: p.w.name || 'W',
      unit: p.w.unit || '',
      label: p.w.name || 'W',
      suffix: p.w.unit || '',
      min: wmin,
      max: wmax,
      fwd: (x) => Math.log(x) - lk,
      inv: (t) => Math.exp(t + lk),
      ticks: { anchors: logAnchors(wmin, wmax) },
      labelDir: [1, 0],
      read: (x) => sig(x, 3),
    });
    const gm = (s) => Math.sqrt(s.min * s.max);
    const expTxt = (e) => (e === 1 ? '' : `<sup>${fmtNum(+e.toPrecision(4))}</sup>`);
    const kTxt = p.k === 1 ? '' : `${fmtNum(+p.k.toPrecision(4))} · `;
    const h = (t) => String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`); // user text into HTML
    return {
      id: 'custom',
      tab: 'Your own',
      tabNote: 'any power law',
      title: 'Build your own',
      kicker: 'Any formula of the form W = k · Uᵃ · Vᵇ',
      formula: `${h(W.label)} = ${kTxt}${h(U.label)}${expTxt(a)} · ${h(V.label)}${expTxt(b)}`,
      scales: parallel(U, W, V),
      readOrder: ['u', 'v', 'w'],
      pins: [
        ['u', gm(p.u)],
        ['v', gm(p.v)],
      ],
      solve: {
        w: ({ u, v }) => p.k * u ** a * v ** b,
        u: ({ w, v }) => (w / (p.k * v ** b)) ** (1 / a),
        v: ({ w, u }) => (w / (p.k * u ** a)) ** (1 / b),
      },
      examples: [],
      about: `
        <p>Products and powers become sums under a logarithm: ln W − ln k = a·ln U + b·ln V. So any formula of
        this shape becomes three parallel logarithmic scales, and a negative power simply turns its scale upside down.</p>
        <p>Pick a preset or type your own names, units, ranges and powers. Then print it: what comes out of your printer is a
        calculator for that one formula that needs no battery and will not go out of date.</p>`,
    };
  }

  // ---------------------------------------------------------------- catalogue

  function buildCatalog() {
    return [bayes(), dewPoint(), pace(), harmonic(), quadratic(), powerChart(POWER_PRESETS[0])];
  }

  return { fmtNum, sig, dec, pct, hms, clockTick, parseNum, parseClock, logAnchors, POWER_PRESETS, validatePower, powerChart, buildCatalog };
});
