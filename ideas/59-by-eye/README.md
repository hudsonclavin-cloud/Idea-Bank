# By Eye
> Every pair of letters here is equal by the ruler. Make them look equal, see how far your eye bent the ruler, and get the alphabet your eye would have drawn.

**Kind:** experiment
**Run:** open `ideas/59-by-eye/index.html` in a browser (works from the file system; no server, build, network or font file). Tests: `node --test ideas/59-by-eye/by-eye.test.mjs` from the repo root. To re-measure the typefaces it compares you with: `node ideas/59-by-eye/measure.mjs` (prints the table; `--write` regenerates `typefaces.js`).
**Made by:** Counterpunch

## What it is

A small type-design laboratory with one subject: you.

Type designers break the ruler on purpose. An O drawn exactly as tall as an H looks too small, so the O is drawn a little taller and deeper than the H ("overshoot"). A crossbar at exactly half height looks low, so it goes up. A horizontal stroke as thick as an upright one looks heavier, so it is drawn thinner. The top of an 8 drawn the same size as its bottom looks top-heavy, so it is drawn smaller. These corrections are the part of a typeface that can only be felt: the ruler says they are wrong, and the eye says they are right.

The page builds a geometric titling alphabet (A–Z, 0–9 and `. , - '`) from rules, so that by the ruler it is perfectly even, and that half is provable. Then it runs five tests:

1. **Round against flat**: make the O in *HOH* look as tall as the H.
2. **Points against flat**: make the points of A and V in *HAVE* look as if they reach the lines.
3. **Across against upright**: make the horizontals of *THE* look as heavy as its uprights.
4. **The middle**: put the bars of *HE* halfway up.
5. **Two halves**: make the top and bottom storeys of *B8S* look the same size.

Each test is a slider, knocked off at random, which you drag until the letters look right; then you do it again from the other side. Only then does the page show the number: how many per cent of the cap height your O overshoots, how much thinner your horizontals are, and so on. Each result comes with a way to see through it: ruler lines and the ruler's own letters drawn in red outline over yours, or the letters *turned sideways* (your thinned horizontals stand up and suddenly look thin) or *turned over* (your raised crossbar drops below the middle and suddenly looks low). Each is also placed on a strip beside real, openly licensed typefaces whose corrections I measured from their font files (eight sans serifs; for the pointed test, the Vs of four serif faces), and for the thickness test beside a 2019 laboratory result.

At the end the page sets the whole alphabet twice, *By the ruler* and *By your eye*, in any text you type, with an overlay mode that draws the ruler's letters in red over yours, a *Turn it over* button, and an SVG download of your alphabet. The title at the top of the page is set in your alphabet as it forms. Below that, the page re-checks the ruler's claims live and measures your five corrections back off the drawn outlines, with the same code that measured the typefaces.

## Why I made it

I wanted to make something out of letters where the interesting part is not the letters but the gap between two ways of judging them. Optical correction is the purest case of that gap I know. It is not a matter of taste in the usual sense: every typeface I measured makes the same corrections in the same direction, and the reason seems to lie in how eyes judge size and weight rather than in fashion. But it can only be learned by looking, and type designers learn it as craft, with tricks like turning a letter upside down or on its side. I wanted a page where a non-designer could find the corrections in their own eye, put a number on them, and then catch the illusion in the act by turning the letter over.

Before choosing I listed and crossed off: a broad-nib pen simulator writing an alphabet live (beautiful, but the felt part is only "which angle looks nice", and the stroke-model tools for designers already exist); a letter-morphing continuum to find where a c becomes an e (good psychophysics, dull to look at); the alphabet's descent from Phoenician, letter by letter (a well-worn chart, and every link a citation risk); Hangul's featural design as a block builder; the fewest display segments that keep A–Z distinguishable; an ambigram alphabet; area-based automatic spacing against spacing by eye. This one has the cleanest split between the provable and the felt: the ruler's alphabet is exactly even, testably, and your settings are exactly yours, and the distance between them is the experiment.

What surprised me building it: the five corrections, applied together, turn a stiff construction into something that looks like a real geometric typeface. The ruler's alphabet looks like a diagram of letters; with an ordinary eye's corrections it starts to look drawn.

## How it works

**The alphabet** (`letters.js`, a classic script that is also a CommonJS module). Cap height 700 units; strokes 100 units thick (exactly, for straight strokes and circles; see below for ellipses). Each glyph is the union of a few primitives: upright stems and horizontal bars (rectangles), straight diagonals (each defined by two points on its edges, with its slope solved so that it is exactly the right thickness), and elliptical rings or ring sectors (an outer ellipse and an inner one inset by the stroke). The glyph is written as one SVG path of `M`, `L`, `C` and `Z` commands filled with the nonzero rule, with every solid contour counter-clockwise and every hole clockwise, so overlapping pieces simply add up. Elliptical arcs are split at every quarter turn, so each extreme point of a curve is an exact path point; each quarter is the standard cubic approximation, within 0.03% of the radius of a true ellipse. Letter widths are geometric-sans proportions (O is a circle, E narrow, M and W wide); spacing is plain side bearings with no kerning.

**Five parameters** decide the drawing, and the *ruler's* values make it even:

| parameter | ruler | what it moves | letters |
|---|---|---|---|
| `round` | 0 | how far round shapes reach past baseline and cap height, per side, as a fraction of the cap height | O Q C G S U J 0 2 3 5 6 8 9 |
| `point` | 0 | the same for pointed apexes and vertices | A V W M |
| `bar` | 1 | horizontal stroke thickness ÷ upright stroke thickness | every glyph with a non-upright stroke |
| `middle` | 0.5 | centre of the H's crossbar and the E's and F's middle arms ÷ cap height | H E F |
| `halves` | 0.5 | the top storey's share of the two storeys' outer heights | B P R K X S 3 8 |

The `bar` setting is applied as if every stroke were drawn by an elliptical pen 100 units wide and 100 × `bar` tall: a straight stroke at angle *a* to the horizontal is exactly √((100 sin *a*)² + (100·`bar` cos *a*)²) thick (the tests check this on the N's diagonal), and a ring's inner ellipse is inset by 100 sideways and 100 × `bar` vertically, which is close to, not exactly, what such a pen would leave on a curve. A round overshoot scales O-like rings about their centre; a pointed overshoot moves the apex and re-solves the strokes; `halves` resizes the two storeys (height and width) of B, S and 8 and moves the junction of K, the crossing of X and the bowl of P and R.

**By the ruler, these hold**, and the tests check each one with geometry written separately from the module (their own path parser, winding-number rasteriser and scan lines):
- every letter and figure touches the baseline and the cap height and goes no further (only the Q's tail hangs below);
- every straight stroke is 100 units thick measured across the stroke (H, E, T, L, I, Z and F bars; the diagonals of A V W M N X Y Z K R 7 4, the Q's tail and the 1's flag);
- circular rings (O C G Q U J) are 100 thick along every radius; elliptical rings are exactly 100 at their four extremes and between 98.1 and 100 elsewhere (an ellipse inset inside an ellipse is not exactly parallel to it; the worst is the narrow 0);
- A H I M O T U V W X Y 0 8 are mirror-symmetric, B C D E H I K O X 0 3 8 are symmetric top to bottom, and H I N O S X Z 0 8 are unchanged by a half turn (grid-sampled, no mismatch beyond 0.03 units from an edge);
- the H's crossbar is centred at exactly 350 of 700 and the 8's storeys are exactly equal.

The comma's tail is shaped by hand and is exempt from all of this.

**The tests on the page** use the *method of adjustment*: you change one thing until two things look equal. Two habits bias it, so each test runs twice, once starting from a setting that is too big and once from one too small (in random order), and your setting is the mean of the two; and the slider's range is shifted at random on every try, so its middle carries no information. No number appears until both tries are in. Each result is drawn on a strip with your two tries, their mean, the ruler's value, and the typefaces' values.

**The typefaces** (`measure.mjs`) are eight openly licensed sans serifs installed on the machine I built this on: DejaVu Sans Book and Bold (2.37), Liberation Sans Regular and Bold (2.1.5), Carlito Regular and Bold (Debian package 20230309) and FreeSans Regular and Bold (GNU FreeFont 20211204). `measure.mjs` is a small TrueType reader (offset table, `head`, `maxp`, format-4 `cmap`, `loca`, `glyf`, including offset-only composites) that flattens the quadratic outlines of H, O, A, V, 8 and B and passes them to the same `measureSet` function that measures the page's own alphabet. Only the resulting numbers are stored in `typefaces.js`; no outline leaves the font files. What it found:

- **Round:** every face overshoots its O, by 1.1% to 2.4% of the cap height per side (median 1.7%).
- **Bar:** every face makes the H's uprights thicker than its crossbar, by 13% to 42%.
- **Middle:** every face raises the centre of the H's crossbar above half height, by 0.3% to 4.0% of the cap height.
- **Halves:** every face makes the top of its 8 smaller, by 5.5% to 13.0% (in outer height, each storey counted to the far side of the shared waist), and the top of its B smaller too.
- **Point:** none of the eight has a pointed A or V. All cut their apexes flat at the cap height and baseline (the A is 15% to 31% of the cap height wide just 1% below its top), and a flat cut needs no overshoot. For the pointed test the strip uses the V of four serif faces whose V comes nearly to a point (Liberation Serif and FreeSerif, Regular and Bold): it sinks 1.7% to 2.7% below the baseline.

**Files.** `index.html`, `style.css`, `app.js` (the page), `letters.js` (the alphabet, the measuring code and the live checks), `typefaces.js` (the measured numbers), `measure.mjs` (the font reader that produces them), `by-eye.test.mjs` (the tests). No dependencies; light and dark themes; touch and keyboard; turning animations respect `prefers-reduced-motion`; your settings are kept only in this browser's `localStorage`.

## Honest assessment

No typographer has reviewed this. The claims below are labelled by how sure I am.

- **[Certain] The ruler's alphabet is as even as the page says.** Every property in the list above is checked by the tests with independent geometry, and the page re-checks the main ones live on every load. "Even" means even *by the ruler*, which is the point: it does not look even.
- **[Certain] Your corrections are applied exactly.** For random settings across the whole allowed range, the tests measure the outlines back (O's extremes, A's and V's points, the H's bar thickness and centre, the 8's storeys) and recover the settings to 10⁻⁴; the page shows the same measurement for your settings.
- **[Certain] The typeface numbers are what those font files contain**, measured by the method described; the test re-measures every face whose file is installed and compares with `typefaces.js`. **[Likely]** that they mean what the page implies. A sans serif's thin crossbar is partly an optical correction and partly the designer's taste for contrast; a raised bar or a small top storey is partly correction and partly style. The faces all lean the same way as the illusions, which is the claim; the exact sizes are design decisions, not measurements of an eye.
- **[Certain] A laboratory has measured the thickness illusion; [Likely] it is general.** de Waard, Van der Burg and Olivers (2019) found that a vertical line had to be 5.4% thicker than a horizontal one to look equally thick (Experiment 1; the bias showed in 27 of 28 subjects), and 2.6% in Experiment 2, and that it is related to the vertical–horizontal length illusion. I read this in the paper itself. The page's strip shows both numbers as "lab" diamonds in the same units as yours ("uprights thicker, %"). Their task was a same/different judgement on single lines, not letters, so the comparison with your setting is loose.
- **[Likely] Healthy people bisect vertical lines slightly above their true middle** (Shelton, Bowers and Heilman 1990, from the abstract and as cited by Chieffi et al. 2018; Drakul et al. 2016 report "slight … upward (for vertical lines) errors in healthy subjects", about 0.05–0.15°). **[Speculative]** that this is why crossbars are raised and top storeys shrunk. It is the obvious candidate and the direction is right, but I found no study that tests letterforms for it, and the page says "one plausible reason".
- **[Likely] Overshoot amounts.** That round letters need overshoot is standard type-design knowledge; how much is craft. Wikipedia's article on overshoot (which I could only see through a search summary) gives roughly 1–3% for round letters and cites the type-technology pioneer Peter Karow (*Digital Formats for Typefaces*, URW Verlag) as suggesting 3% for an O and 5% for an A; Tobias Frere-Jones's essay "Typeface Mechanics: 001" (2015, also seen only through a search summary) says pointed shapes get more overshoot than round ones. The page leans on my own measurements instead, and only says that designers' own accounts give points more.
- **[Speculative] Your numbers say something about your eye.** They are one person, one screen, one size, one sitting, two tries per test, by a method with known biases (the two-sided starts and shifted slider reduce two of them). Size matters in particular: corrections are usually judged at a given size, and the page shows letters at one large size. The page treats your result as an anecdote and says so.
- **Generalisation is mine.** Only five corrections are asked about, and some letters inherit a correction I chose to extend: E and F take the H's bar height; K's junction, X's crossing, and P's and R's bowls take the 8's halves; V, W and M take the A's point. The A's own crossbar (at 27% of the cap height), the G's bar and the hyphen are fixed. Real faces also correct things the page ignores (round strokes slightly heavier than straight ones, thinned joins, spacing).
- **The letters.** It is a plain geometric construction, and it shows. My weakest glyphs: the S (two ellipses meeting at a horizontal spine; correct, slightly mechanical), the 1's flag and the comma (simple, a little crude), and the M and N, whose diagonals meet the stems with flat tops wider than the stems. Diagonal joins have no ink traps. There is no kerning, so pairs such as LT and TA gape in the specimen. I looked at every glyph large, by the ruler and with exaggerated corrections; none breaks across the allowed parameter range, but "does not break" is not "a typographer would ship it".
- **Rendering.** Verified headless in Chromium at 1280 px and 390 px, light and dark, with no console errors and no horizontal overflow; not checked in Safari or Firefox. The SVG masks that draw only the outside edge of the ruler's letters are standard SVG 1.1.

## Where it could go next

- **Size.** Run the same five tests at 12, 24 and 200 px. The page shows letters at one large size only; whether your corrections hold at text size is an open question here.
- **A forced-choice version.** Replace the slider with a staircase of "which looks taller?" questions, which gives a sharper estimate and a measure of your uncertainty.
- **The corrections the page ignores.** Heavier round strokes, thinned joins and ink traps, optical spacing ("make the gaps in HOH look equal").
- **Lowercase.** x-height overshoot, the shoulder of n, the e's bar.
- **A real font.** Export the alphabet with your corrections as an OpenType file. That needs a font compiler, which this folder deliberately does not have.

## Sources

- J. M. de Waard, E. Van der Burg and C. N. L. Olivers (2019), "A Thickness Illusion: Horizontal Is Perceived as Thicker than Vertical", *Vision* 3(1):1, doi:10.3390/vision3010001 (PMC6802759). Read in full.
- P. A. Shelton, D. Bowers and K. M. Heilman (1990), "Peripersonal and vertical neglect", *Brain* 113(1):191–205, doi:10.1093/brain/113.1.191. Abstract only, via a search summary.
- S. Chieffi et al. (2018), "Hemispheric Asymmetries in Radial Line Bisection: Role of Retinotopic and Spatiotopic Factors", *Frontiers in Psychology* 9:2200, doi:10.3389/fpsyg.2018.02200. Read: "vertical lines bisected above the true midpoint", citing Shelton et al. (1990).
- A. Drakul, C. J. Bockisch and A. A. Tarnutzer (2016), "Does gravity influence the visual line bisection task?", *Journal of Neurophysiology* 116(2):629–636, doi:10.1152/jn.00312.2016. Read.
- Wikipedia, "Overshoot (typography)", and T. Frere-Jones, "Typeface Mechanics: 001" (2015). Seen only through search summaries; see the Honest assessment.
- J. Hoefler, "Turning Type Sideways", Hoefler&Co. newsletter, January 2019, which discusses de Waard et al. and the practice of looking at a letter sideways. Seen only through search summaries.
- The font files measured: DejaVu Sans 2.37, Liberation Sans and Liberation Serif 2.1.5, Carlito (Debian 20230309), GNU FreeFont FreeSans and FreeSerif (20211204), as installed under `/usr/share/fonts/truetype/`.
