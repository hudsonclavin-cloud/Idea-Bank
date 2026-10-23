# A Little of Every Year
> An invented solera, drawn from and topped up every year since 1826. Arithmetic says exactly how much of every year is in this year's glass, and when the last of 1826 will leave it. Whether it is still the same wine is not arithmetic.

**Kind:** explorable
**Run:** open `ideas/60-solera/index.html` in a browser (plain classic scripts, so `file://` works; no build, no network). Tap *Run the scales* to move one year, *Keep running* to let the years go by. Optional URL parameters: `?now=2040` pretends the present is another year, `?year=1914` opens on that year's glass, `?your=1990` fills in *Your year*. Tests: `node --test ideas/60-solera/solera.test.mjs` from the repo root (Node built-ins only).
**Made by:** Venencia

## What it is

A cellar of casks in four rows, invented, founded in 1826. Once a year a quarter of the bottom row is drawn off and bottled. The bottom row is topped up from the row above, that row from the one above it, and the top row with young wine. Nobody has emptied a cask since. This is a *solera*, the way sherry and some other wines, vinegars and spirits are aged, and it is the closest thing I know to a ship of Theseus you can drink: every year a little of it is replaced, and it keeps its name.

The page shows the casks (each one coloured by the average age of what is inside, with the bottom row chalked *1826*), a glass of this year's wine, and five things to do with them:

1. **Run the scales.** One tap is one year: the glass is drawn from the bottom row, each row is topped up from the one above, and young wine goes in at the top. *Keep running* lets the years go by and stops at each milestone. A slider goes anywhere from 1827 to 2326.
2. **Who is in the glass.** A chart of every year whose wine is in the glass, on a log scale, with a dashed line at *one molecule per 100 ml glass*. Above the line a glass holds at least one molecule of that year, on average; below it, less than one. Touch any bar to read its share and its molecule count.
3. **Your year.** Type a year (the year you were born, or someone was) and an optional word for it. The page says when that year's wine first reached the glass, when it was at its most, how much of it is in the glass you are looking at, and when the last of it leaves.
4. **The cellar book.** A timeline of what the arithmetic says will happen, past and future.
5. **Why the numbers are exact**, a short proof on the page, and **Change the solera**, two sliders (rows, and the share drawn each year) that rewrite everything above.

What the page says about the glass of 2026, with the default solera:

| | |
|---|---|
| Average age | 16 years; half of the glass went in at the top in 2011 or later |
| Youngest wine in it | 2022: young wine takes four years to come down four rows |
| Years present | every year from 1826 to 2022, with an expected 6,500 molecules or more of each (1827 is the scarcest) |
| The founding wine of 1826 | 7 parts in 10<sup>21</sup>: about 21,000 molecules in a 100 ml glass |
| A year that went in in 1990 | 0.26% of the glass, about 7.7 × 10<sup>21</sup> molecules |

And the cellar book, from 2026 onward:

| Year | |
|---|---|
| 2030 | 2026's young wine first reaches the glass: 0.39% of it |
| 2038 and 2039 | 2026 is at its most, 6.45% of the glass, exactly as much in both years |
| 2063 | a glass holds less than one molecule of 1826, on average (0.82 expected; a 56% chance of at least one), and fewer every year after |
| 2222 | the last of 1990 leaves the glass |
| 2258 | the last of 2026 leaves the glass |

The solera, its bodega and its founding year are invented. The present is your device's calendar year, so the page will say different things in 2027, and the founding wine's last glass gets closer each year.

## Why I made it

I had one free slot and no brief, so I listed what the bank didn't have yet. Nothing about food, smell or taste. Nothing measured in centuries. Nothing about strangers who cooperate without meeting. I wrote down ten candidates and crossed most of them off: a time-locked letter that takes your phone a night of sequential squaring to open (too close to *Two Sheets of Nothing*, and phones kill background tabs at night); the radiocarbon age of deep ocean water, "the last time this water saw the sky" (needs a data set I couldn't fetch and verify); John Cage's 639-year organ piece in Halberstadt (I couldn't verify its future schedule); synchronising fireflies (already done well elsewhere, and *Out of Step* is about synchrony); the physics of a boiled egg (too close to *Backtime*); the zipper merge (its strongest claims are contested); the stone tablets on the Japanese coast that tell descendants not to build below them (too heavy to turn into a toy); and a few more.

The solera won because it is the one food I know that is also a mathematical object, and because the two halves of the batch's theme fall out of it on their own. The part that can be proven is the composition of the glass. It is exact, and the argument fits in a paragraph: follow a molecule backwards and count coin tosses. The part that can only be felt is the question an old solera invites: is this still the 1826? Arithmetic can tell you the founding wine is 7 parts in 10<sup>21</sup> of your glass in 2026 and that in 2063 it falls below one molecule. It cannot tell you whether that matters. The cellar master who wrote *1826* on the bottom row in chalk had already decided it doesn't.

It is also the cooperation-between-strangers piece I wanted. Nobody who filled those casks in 1826 drank the glass of 2026, and nobody who drinks a glass in 2026 will be alive for the one in 2258 that holds the last of this year. Every year someone draws a quarter and tops it up for people they will never meet. The *Your year* box exists for that: it says, with exact arithmetic, when a year you care about leaves the glass.

Two things surprised me while building it. First, the founding wine is not gone yet. With four rows and a quarter a year it is still about 21,000 molecules per glass in 2026, and it leaves within the lifetime of many people reading this. I had expected it to have vanished generations ago, and with a third drawn each year instead of a quarter it would have (in 1995). Second, the rows are not mainly a memory device. For the same draw, four rows keep the founding wine only about forty years longer than one big cask would. What the rows buy is consistency. At the same 16-year average age, four rows give an age spread (one standard deviation) of 6.9 years where a single cask would give 15.5. Keeping one bottling like the next is the usual reason given for working a solera in rows, and the comparison is on the page under *Change the solera*.

## How it works

**The model.** *n* rows of equal volume, a fraction *f* moved down each row once a year, each cask perfectly mixed, nothing lost or changed. Year *Y*'s glass is the bottom row as it stands before that year's draw. The young wine put in at the top in year *Y* is labelled *Y*. Defaults: *n* = 4, *f* = ¼, founded 1826.

**The argument.** Take a molecule in the bottom row and follow it backwards one year at a time. In each year a fraction *f* of that row had just arrived from above, so with mixing the molecule had just arrived with probability *f*, independently of every other year. A molecule in row *d* (counting the top row as 1) went in at the top on its *d*-th arrival, counting backwards. So its age *K* is the number of Bernoulli(*f*) trials needed for *d* successes, a negative binomial, and the founding wine is the event that fewer than *d* successes happen in all the years since the founding. For the glass of year *Y* (*t* = *Y* − 1826 years after the founding):

- share of wine *k* years old = C(*k*−1, *n*−1) *f*<sup>*n*</sup> (1−*f*)<sup>*k*−*n*</sup> for *n* ≤ *k* ≤ *t* − 1;
- share of founding wine = P(Binomial(*t* − 1, *f*) ≤ *n* − 1);
- in the long run, mean age = *n*/*f* and standard deviation = √(*n*(1−*f*))/*f*.

Each year's wine has the same life in the glass. It first arrives at age *n*, peaks at the mode of the negative binomial, and with *f* = ¼ and *n* = 4 that mode is a tie between ages 12 and 13: C(11,3)·3<sup>8</sup>/4<sup>12</sup> = C(12,3)·3<sup>9</sup>/4<sup>13</sup> exactly. That is why the cellar book says "2038 and 2039".

**Molecules.** A share becomes a count by multiplying by the molecules in the glass. A 100 ml glass of dry 17% wine holds about 13.4 g of ethanol (0.29 mol) and 83–84 g of water (4.6–4.7 mol), so 2.9–3.0 × 10<sup>24</sup> molecules. The lower figure takes the water as the remaining 83 ml; the upper one uses a mixture density of 0.977 g/ml, which accounts for the contraction on mixing. The page uses 3.0 × 10<sup>24</sup> and ignores the sugars, glycerol and acids, which add little. A year is *in the glass* when its expected count is at least one. Treating the count as Poisson (a huge number of molecules, each with a tiny chance of being from that year), the page also gives the chance of at least one molecule when the expected count is below one.

**Exactness.** `solera.js` computes everything in natural-log space with a log-factorial table, so tiny shares never underflow; the tests check them against exact fractions as small as 10<sup>−81</sup>. It has no DOM, clock or randomness, and loads both as a classic script (`window.Solera`) and with `require`. `app.js` draws the casks, the glass and the chart on canvases and keeps the prose in step. Every share, count and year the page computes comes from `solera.js`; the few fixed figures in its prose (the molecule count, the 75 ml case) are the ones the tests pin.

**The page.** The casks are a front view of the rows, each with a window onto the wine coloured by its average age; the colours are a fiction (older is darker) and not the colours of real sherry. A step animates the draw, then each refill from the bottom row upward, then the young wine at the top. With `prefers-reduced-motion` the step is instant and *Keep running* advances one year every 0.6 s with nothing moving but the numbers. Light and dark schemes follow the system setting. The chart can be read by touch (drag sideways; vertical swipes still scroll). The only thing stored is your year and its note, in `localStorage`, wrapped so the page works without it. Nothing is sent anywhere.

**Tests** (`solera.test.mjs`, 14 tests, Node built-ins only):

- **Exact cascade.** The closed forms equal a step-by-step cascade done in exact rational arithmetic (BigInt numerators over *q*<sup>*t*</sup>), for every vintage in every glass and every row, for 40 years and six combinations of rows and draw. The float module matches those fractions to 1e-12.
- **Far tail.** The log-space shares match exact rationals 200 and 500 years out, to nine significant figures.
- **Forward simulation.** A forward simulation of 20,000 labelled molecules per row, drawing at random without replacement and with no formulas, agrees with the glass formula (chi-square). Scored against slightly wrong rules instead (3 or 5 rows, or a 22% or 28% draw), the same check fails by more than 80 times its pass mark; the test requires 10 times.
- **Quoted figures.** Every figure quoted in this README is pinned: 16 years, 2011, 2022, 1827 and its ~6,500 molecules, the ~21,000 founding molecules, 0.26% and 7.7 × 10<sup>21</sup>, 2063 with 0.82 expected and a 56% chance, 2030, 2038 and 2039, 6.45%, 0.39%, 2222, 2258, the comparisons (1995 with a third drawn, 2023 with one row, spreads of 6.9 and 15.5 years), and the molecule-count ranges below.
- **Sensitivity and sanity.** The tests also pin how those years move with the molecule count. They check that every glass and every cask sums to one, that when a year leaves the glass every later year that has had time to arrive is still in it, the long-run mean and spread, and that the module loads as a browser script.

## Honest assessment

- **[Certain] The arithmetic is right for the model.** The closed forms are proven above. The tests check them against an exact rational cascade, against exact rationals far into the tail, and against a forward simulation of molecules that uses no formula. Nothing on the page is simulated or estimated: every share, count and year is computed exactly from the model, then rounded for display.
- **[Certain] The quoted numbers are what the code computes** with 4 rows, a quarter drawn a year, a founding in 1826, and 3.0 × 10<sup>24</sup> molecules in a glass. The tests pin each one.
- **[Certain] How the "one molecule" years depend on the glass.** They are threshold crossings, so they move with the molecule count. 2063 holds for any count from 2.79 to 3.67 × 10<sup>24</sup>. A 75 ml glass makes it 2062. 2026's last glass is 2257 (so it is gone in 2258) only for counts of at least 2.94 × 10<sup>24</sup>. A 100 ml glass of 20% wine, counted without the mixing contraction, comes to 2.88 × 10<sup>24</sup> and moves that to 2256. The page says the 75 ml case, and the test file pins both.
- **[Certain] It runs.** `node tools/check.mjs ideas/60-solera` passes: README format, size, tests, and the headless smoke test at desktop and at 390 px phone width with no console errors and no horizontal scroll. I also drove it headless at phone size, light, dark and reduced motion. I typed a year and a note, stepped a year with the animation, and let *Keep running* go from 2026 to 2326. It stopped at 2030, 2038, 2063, 2222 and 2258 with the texts above, and the note survived a reload.
- **[Likely] The outline of the real method is right.** A real solera has rows of casks, with the solera on the floor and the *criaderas* above it. Bottling draws from the solera (the *saca*), and each row is refilled from the next younger one (the *rocío*), the whole operation being *correr las escalas*, running the scales. I checked these terms against several wine references found by search but could not open the Consejo Regulador's own documents. I deliberately state no regulatory limits (a 40% annual cap on sales is widely repeated, but I could not confirm it in the official specification) and no particular bodega's practice.
- **[Likely] Leaving out evaporation makes old years look more present than they are.** Wine evaporates through the wood, and casks are topped up with younger wine to make up the loss. With the same draws, that gives every molecule one more way out each year, so real traces of the oldest years would be smaller. Chemistry pushes the same way: ethanol oxidises, esters form, and water molecules swap hydrogen atoms constantly. That is why the page says "a molecule's worth".
- **[Speculative] Perfect mixing is a fair stand-in for a real solera.** A real cask is not mixed the way the model's are: wine is drawn from one place and added at another, and a row is many casks, so how evenly wine is spread between them matters too. The model is exact only for the idealisation. A real solera's oldest traces could be larger or smaller than these depending on how unevenly casks are worked; I have no data to say which.
- **[Speculative] The felt part works.** I wanted the moment in 2063 (the run stops; the chalk still says 1826) and the line about your own year leaving the glass to land the way the end of *Endpapers* is meant to. I can't know whether they do. The risk is that the page reads as a well-made explainer about sherry and the question it leaves you with goes unnoticed. I kept the question to one sentence at the end of the cellar book rather than pressing it.
- **Rough edges.** The casks show only colour, so the bodega looks the same in 2026 and 2063, which is the point but makes *Keep running* visually quiet at steady state. The chalk font falls back to a serif where no handwriting font is installed. With *Change the solera* at 8 rows and 5%, the founding wine's last glass is centuries past the slider's end (the knob text still gives the year). The 1826 founding is fixed. I did not let you choose the founding year, so that the felt claim stays about one particular, if invented, solera.

## Where it could go next

- **A real solera.** With a bodega's actual cask records (how much was drawn and when, row by row, including the irregular years), the same arithmetic would give the real composition of a real bottle. The method does not need equal draws; it needs the history.
- **Evaporation and uneven casks.** Add evaporation per row and let individual casks be worked unevenly, then show how far the idealised numbers move. That would turn the [Speculative] mixing caveat into a measured one.
- **Other perpetual things.** A perpetual stew, a sourdough starter and a Chinese master stock are, roughly, one-row soleras drawn far more often, so their founding matter thins out in months rather than decades. A sourdough adds a twist: its microbes can be *descendants* of the founders even when none of the founding flour is left, a different kind of continuity. That deserves its own piece.
- **A shared chalk.** Several visitors, a shared store, and each one's year written on the top row: a solera of strangers, where everyone can see whose year is still in the glass.
