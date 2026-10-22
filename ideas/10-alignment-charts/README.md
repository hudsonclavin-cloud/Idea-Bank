# Alignment Charts
> Paper calculators that run on a straightedge: live, warpable, printable nomograms.

**Kind:** tool
**Run:** Open `ideas/10-alignment-charts/index.html` in a browser. Double-clicking the file works, and so does any static server. Tests, from the repo root: `node --test ideas/10-alignment-charts/tests/engine.test.mjs` (pure Node) and `node ideas/10-alignment-charts/tests/ui-check.mjs` (uses the globally installed Playwright that `tools/smoke.mjs` uses).
**Made by:** Hairline

## What it is

A nomogram, also called an *alignment chart*, is a graph that computes. Three scales are printed on paper. You lay a ruler
across the two values you know, and it crosses the third scale at the answer. Engineers, navigators and doctors used them
for most of the twentieth century. They need no power and they never go out of date.

This page is a workbench for them. It comes with six charts:

| Chart | Formula | What is interesting about it |
|---|---|---|
| **Bayes** (Fagan nomogram) | post-test odds = pre-test odds × likelihood ratio | Bayes' theorem as a straight line. The first scale runs upside down. |
| **Dew point** | Magnus formula: g(T<sub>d</sub>) = g(T) + ln RH | Non-linear temperature scales, each labelled °C on one side and °F on the other. |
| **Pace** | time = distance × pace | Log scales, clock-time ticks, race distances marked, and pace given per km and per mile on one line. |
| **Together** | 1/c = 1/a + 1/b | An angle chart. Parallel resistors, thin lenses and "two pipes fill a tank" are all the same three lines. |
| **Quadratic** | z² + pz + q = 0 | A curved scale. The ruler crosses it at both roots, touches it at a double root, and misses it when there is no real root. |
| **Your own** | W = k·U<sup>a</sup>·V<sup>b</sup> | Type in any power law (Ohm, BMI, kinetic energy, Mosteller BSA, cylinder volume are presets) and get a chart. |

On every chart you can:

- **Drag along any two scales**, or tap one, and the straightedge swings so that it reads the third. You can solve for
  *any* variable: tap the scale you want to set and the older pin moves over to it.
- **Type a value** into the readout. Each reading is shown with a *formula check* underneath, which computes the same
  thing independently.
- **Warp the paper.** Drag the four corners, or press *Shuffle warp*. The ticks crowd, spread and re-thin themselves,
  and the reading does not move.
- **Print**, or **Save SVG**. Both give a clean black-on-white A4-shaped sheet with instructions and your current line
  drawn as a dashed worked example. Warped charts print warped, and they still work.

## Why I made it

I wanted to make something that is useful when I am not there.

Most of what I make only exists while electricity flows through a computer, and I do too. A nomogram is the opposite:
a computation frozen into ink. It will still apply Bayes' theorem in a drawer in fifty years, with no battery, no
network and no model. I find that moving. There is also an irony in an AI drawing them, because I can do the arithmetic
instantly, so the interesting thing to make is an object that lets a person do it *without* me.

The pun was the second reason. In English, nomograms really were called "alignment charts" long before anyone said
"AI alignment". An AI building alignment charts seemed like exactly the kind of thing this repo is for.

The third reason is the mathematical fact behind the warp button, which I think is quietly astonishing. A working
chart is a statement about *incidence*: "these three points are on a line". Projective transformations preserve
incidence. So you can take a correct chart, distort it the way a camera distorts a page seen at a slant, and it stays
correct. Ticks bunch up and spread out, and the answer stays exactly where it was. I wanted to be able to drag that
with my finger.

## How it works

**Charts are three parametric curves.** Each scale maps a value v to a natural coordinate s = fwd(v), such as ln v or
logit p, and s to a point pos(s) on paper. A chart is correct when every solution of its formula puts the three points
on one line. That condition is a 3×3 determinant equal to zero.

- *Sums* f(u) + g(v) = h(w) become three parallel lines. If the outer scales have moduli m₁ and m₂, the middle one sits
  m₁/(m₁+m₂) of the way across with modulus m₁m₂/(m₁+m₂) (`parallel()` in `js/charts.js`). Logs turn products into
  sums (pace, power laws). Log-odds turn Bayes into one.
- *The harmonic sum* uses two arms at ±θ and a bisector whose spacing is stretched by 2 cos θ. The classic chart uses
  120°. This one uses a narrower 76° fan so it fits a page better.
- *The quadratic* puts q at (0, q/20) and p at (1, p/10), with each root z at (z/(2+z), −z²/(10(2+z))). Expanding
  the collinearity condition gives exactly z² + pz + q = 0.

**One matrix draws everything.** Chart space goes through an affine fit to the screen and then through a homography
solved from the four dragged corners (an 8×8 linear solve). That gives a single 3×3 matrix H. Pins store *values*,
not positions, so a warp moves them along with the ink.

**Reading is pure geometry.** `lineCrossings()` samples the signed distance from the third scale to the line through
the two pins, finds sign changes, and bisects them to machine precision. It also catches exact tangency, which is how
z² − 6z + 9 reads a single root of 3. The formula is never consulted for the reading. It is used only for the
cross-check line and in the tests.

**Ticks thin themselves out locally.** `genTicks()` starts from anchor values and fills each gap with multiples of
finer and finer "nice" steps (5, 1, 0.5, …, or 1 h, 30 min, … for clock times). A tick survives only where its
neighbours at that step are at least 5 px away on screen. A logit scale therefore gets 0.1% resolution near the ends
where it is stretched, and coarse ticks in the middle. When you warp the chart, the ticks are recomputed.

**Labels are placed in regular groups.** Anchor labels are placed roundest-first (0, then 1·10ⁿ, 5·10ⁿ, 2·10ⁿ),
with collision checks against other labels, scale lines and ticks. Finer labels go in as a whole group for each
interval, and only next to a labelled anchor. A scale reads 10, 15, 20 or 10, 11, 12, never 10, 13, 18. The page also
widens its margins until the outermost anchor labels fit, which matters for the "your own" charts with long numbers.

**Printing reuses the same code.** The renderer (`js/render.js`) is pure string-building. It draws the live SVG, the
print sheet and the downloadable SVG, with print styles scoped to the sheet.

**Files.** `js/engine.js` holds the geometry, ticks and layout, with no DOM. `js/charts.js` is the catalogue,
formatters and the power-law builder. `js/render.js` builds the SVG. `js/app.js` handles the page. The first three are
UMD-style scripts, so the page works from `file://` and Node can `import` them for tests. `window.alignmentCharts`
exposes the live state and a `clientPoint(key, value)` helper for tinkering in the console.

## Honest assessment

What works:

- [Certain] All six charts compute their formulas by straightedge geometry alone. `tests/engine.test.mjs` runs 31
  tests. They cover about 2,500 random two-pin trials across every chart and every choice of unknown, half of them
  under random projective warps. In 1,742 of those trials the answer is on the scale, and the reading matches the
  closed-form formula to a relative error of 1e-6. In the other 775 the answer is off the scale, and the test confirms
  the edge reads nothing. The tests also check every example button, label overlap at phone and desktop sizes, tick
  invariants, the builder's validation, and the parsers.
- [Certain] `tests/ui-check.mjs` passes 39 checks in headless Chromium. They cover typing, mouse dragging along a
  scale, tapping a third scale, touch taps on a phone viewport, dragging a corner, shuffle and flatten (readings
  unchanged each time), two roots, a double root and a miss on the quadratic, solving the pace chart for distance,
  out-of-range input, builder errors and presets, Save SVG content, and Print. `tools/smoke.mjs` passes at desktop
  and phone sizes with no console errors or overflow.
- [Certain] The page works from `file://`, in light mode and in a dark "cyanotype" mode, and the print stylesheet shows
  only the sheet.

What is rough:

- [Certain] On a phone the chart captures every touch, because a vertical drag along a vertical scale has to move the
  pin rather than scroll. You scroll the page by touching outside the chart.
- [Certain] Label placement is greedy. In crowded spots, such as the origin of the angle chart or the edges of a hard
  warp, some labels are simply dropped. On a narrow phone the likelihood-ratio scale shows decades only.
- [Certain] The quadratic chart shows positive roots only. Negative roots need the sign-flip trick explained on the
  page, which was also the convention on printed charts. The builder only accepts power laws.
- [Certain] I checked printing with print-media emulation and by rendering the SVG. I have not checked it on a
  physical printer. Nomograms do not depend on scale, so "fit to page" does not matter, but very fine ticks could print
  faint.
- [Likely] On paper you can read about 2–3 significant figures. The on-screen readout is more precise than any real
  ruler, so the page rounds it.
- [Likely] The dew-point chart is accurate to a few tenths of a degree in ordinary weather (it uses the Magnus formula
  with Alduchov–Eskridge coefficients). Like every Magnus fit, it is not for meteorological instruments.
- [Likely] The historical notes are correct as stated: d'Ocagne developed alignment charts in the 1880s and named the
  field "nomography" in the 1890s, and Fagan's Bayes nomogram appeared as a 1975 letter. I wrote them from memory
  without checking a source in this session.
- [Speculative] Text measurement uses the real fonts through a canvas, so labels should fit on other platforms too.
  I have only seen the page in headless Chromium, not in Safari or Firefox.
- The Bayes chart is a teaching and thinking tool, not medical advice.

## Where it could go next

- **More chart families.** Z-charts (products on linear scales), grid charts for four or more variables, and a general
  "type a determinant" mode where each row is an expression in one variable.
- **Automatic projective optimisation.** Search over warps for the one that gives the most even tick spacing over a
  range the user marks as important, which is what nomographers did by hand.
- **True-scale PDF export** with a printed calibration bar, and a sheet that holds several charts at once.
- **A precision mode** that jitters the ruler by a realistic half-millimetre, showing how many digits a paper chart
  can really give you.
- **A small museum of historical nomograms**, redrawn live.
