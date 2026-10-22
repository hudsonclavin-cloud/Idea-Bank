# The Pattern That Trips Over Itself
> Two heads in a row take 6 coin flips on average; heads-then-tails takes 4. Drag a pattern across itself to see why.

**Kind:** explorable
**Run:** open `index.html` in a browser (plain classic scripts, so it works straight from `file://`; no server, build, or network). To run the math tests: `node --test ideas/06-self-overlap/test/overlap.test.mjs` from the repo root (Node 18+).
**Made by:** Wren Tally

## What it is

An interactive essay in six short sections about one counterintuitive fact: with a fair coin, you wait 6 flips on average to see **HH** but only 4 to see **HT**, even though any two consecutive flips are HH or HT with the same probability, ¼. The essay builds from that puzzle to a general rule you can apply to any pattern by eye, explains *why* the rule is true, and ends with Penney's game, a coin-flipping game where whoever picks second always has the edge.

Five interactive figures carry the argument:

1. **The race.** Flip games one at a time (animated) or in batches of 100 or 10,000. Each game hunts for HH and HT in the *same* flips, so the reader watches HH average about 6, HT about 4, and HT come first in only about 50% of games. Histograms compare the reader's games with the exact distributions.
2. **The strip.** 160 flips with every HH arced above and every HT arced below. HH arcs chain into clumps; HT arcs never touch. A table shows equal counts, equal average gaps (about 4), and the difference: about half of HH's gaps are a single flip.
3. **Slide the pattern across itself** (the core drag). Edit any pattern of 1 to 8 flips, then drag a copy of it sideways across itself, by mouse, touch or arrow keys. Every shift where the overlapping coins agree lights up green and adds 2^k. A ledger sums them into the expected wait, and a button checks the result by simulation.
4. **The casino.** Shuo-Yen Robert Li's martingale proof as a picture. One row per gambler, one cell per bet, with a slider to scrub through a real game. When the pattern lands, the surviving gamblers are exactly the self-overlaps from section 3, and their payout is the same every game.
5. **Penney's game.** Pick a pattern (2 to 5 flips); the page answers with its best counter and shows the exact win probability, Conway's arithmetic behind it, and a 1,000-race simulation. A tappable diagram shows the loop HTT → HHT → THH → TTH → HTT.

## Why I made it

I wanted a fact that sounds like a trick question but isn't one, where the honest "same probability, same wait" intuition is wrong for a reason you can *see*. What hooked me is that the reason lives entirely in how a pattern relates to itself. HH can share a coin with the next HH, so its occurrences clump. A clumpy pattern hits the same long-run frequency as a spread-out one but pays for it with longer droughts, and a fresh start is a drought. Most "probability paradoxes" fade once you do the algebra. This one gets clearer: Conway's slide-it-over-itself rule turns it into something you can do with your eyes, and Li's casino argument makes the rule feel inevitable rather than magic.

Before building I listed candidates: Monty Hall, the birthday paradox, Simpson's paradox (all crossed off as the obvious first picks), Berkson's paradox, volatility drag / ergodicity, Braess's paradox, queueing blow-up near full utilization, Stein's paradox, and this one. I picked self-overlap because its central interaction is a literal drag (sliding a pattern across itself), every number in it is exactly computable, and it shows up far less often than the classics.

## How it works

**The idea.** For a pattern A of n flips, let A·A be the sum of 2^k over every k from 1 to n where the last k letters of A equal its first k letters. The expected number of fair-coin flips until A first appears is exactly A·A. HT: only k = 2 matches, so 4. HH: k = 1 and k = 2, so 2 + 4 = 6. HTH: 2 + 8 = 10. The fastest patterns of length n (no proper self-overlap) take exactly 2^n flips; HH…H takes 2^(n+1) − 2.

**Widget math.**
- *Race*: simulation with a seeded Mulberry32 PRNG, read 32 coin flips per draw. The exact histogram lines come from a KMP-automaton dynamic program (`waitPMF`), which gives P(T_HT = t) = (t − 1)/2^t and P(T_HH = t) = F_(t−1)/2^t (Fibonacci).
- *Strip*: counts overlapping occurrences directly. The essay's long-run numbers come from the renewal structure of occurrences. The mean gap is 2^n (`gapPMF`). For HH, P(gap = 1) = 1/2 and the other gaps average 7, so the wait from scratch is 7 − 1 = 6. The count's exact variance (`countMoments`) is (5m − 2)/16 for HH and (m + 2)/16 for HT with m = N − 1 windows, giving SDs of 7.04 and 3.17 at N = 160.
- *Slide*: `selfOverlaps(p)` lists every shift s, its overlap k = n − s, whether the last k letters equal the first k, and the value 2^k.
- *Casino*: `gamblers(p, flips, t)` tracks each gambler's state after t flips. At the stopping time T the survivors hold exactly Σ 2^k over the self-overlaps, a constant. The game is fair, so by optional stopping E[T] equals that constant (E[T] < ∞ and the increments are bounded).
- *Penney*: Conway's rule. With X·Y = Σ 2^k over k where the last k of X equal the first k of Y, the odds that B precedes A (distinct, same length) are (A·A − A·B) : (B·B − B·A). The best reply is found by brute force over all same-length patterns.

**Verification.** `js/overlap.js` is a pure module shared by the page and the tests. `test/overlap.test.mjs` (16 tests, about 3 s) recomputes everything independently:
- exact expected waits and race probabilities from **rational-arithmetic Markov chains** (BigInt Gauss–Jordan), for every pattern up to length 8 and every pair up to length 5;
- **brute-force enumeration** of all 2^16 flip sequences for the waiting-time distributions, and of all sequences up to length 14 for count variances;
- **Monte Carlo** with a different PRNG (xoshiro128**) for waits, races, gaps, and count SDs;
- the Penney facts: the unique best reply for each 3-flip pattern (7/8, 3/4, 2/3), Conway's recipe, the 4-cycle, nontransitivity for every length 3 to 8, and no beater at length 2;
- the casino invariant: survivors always hold exactly A·A;
- **every number in the prose.** Each probability, average and count in `index.html` is wrapped in `data-claim="…"`; the test parses the page and checks all 40 against the independent computations. A deliberately wrong edit ("9 in 13") makes it fail.

## Honest assessment

What works:
- [Certain] Every number stated in the essay is correct. Each is machine-checked against exact rational Markov-chain solutions or enumeration (see above).
- [Certain] The widgets compute their displayed probabilities and averages from the same tested module. The simulators agree with the exact values within sampling error.
- [Certain] Smoke test (`node tools/smoke.mjs ideas/06-self-overlap`) passes at desktop and phone width with no console errors or horizontal overflow. A separate Playwright run exercised a real touch drag on the slider, keyboard control, casino scrubbing and play, Penney edits, the cycle links, and reduced-motion mode, in light and dark color schemes.
- [Likely] The core drag (section 3) and the casino picture (section 4) make the rule *feel* true, not merely stated. The moment where the survivors' faint pending bets line up as the slid copy is, to me, the best thing on the page.

What's rough:
- [Certain] Pattern lengths are capped: 8 in the slider, 5 in Penney's game, 4 in the casino presets. That keeps layouts legible at 390 px.
- [Certain] The casino shows a window of at most 16 recent flips. Earlier gamblers are summarized as "all broke", which is provably true for the window sizes used (W ≥ 2n − 1).
- [Likely] The bibliographic details (Penney 1969 in *J. Recreational Mathematics*; Gardner's October 1974 *Scientific American* column presenting Conway's method; Li 1980 in *Annals of Probability*; Guibas & Odlyzko 1981 in *JCTA*; Knuth–Morris–Pratt 1977 in *SIAM J. Computing*; *Concrete Mathematics* §8.4) are from memory and were not checked against the sources from this offline environment.
- [Likely] The DNA remark (self-overlapping words have more variable counts, which matters for over-representation tests) is a correct summary of known word-statistics results, but the essay cites no specific paper for it. Only the coin-flip version of the variance claim is verified here.
- [Speculative] Readers without any probability background may find section 5's X·Y notation dense. The widget shows the arithmetic, but the prose leans on it.
- The coin-flip animation in the race is a simple reveal, not a physical flip. With `prefers-reduced-motion`, games resolve instantly and CSS transitions are off.

## Where it could go next

- A **biased-coin slider**: with P(H) = p the rule becomes Σ over self-overlaps of 1/P(prefix of length k). Dragging p would show HH and HT trading places.
- **Larger alphabets**: the ABRACADABRA monkey-at-a-typewriter version (26^11 + 26^4 + 26 keystrokes), with the same casino picture.
- A **Penney tournament heatmap**: all 8×8 (or 16×16) pairwise win probabilities, making the nontransitivity visible at a glance.
- A short section connecting the self-overlap table to the **KMP failure function**, with a live string search that skips ahead exactly by those overlaps.
