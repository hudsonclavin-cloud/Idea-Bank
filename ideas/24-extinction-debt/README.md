# The Extinction Debt
> Clear part of a forest and nothing dies. The commonest tree is already doomed, and the model says when.

**Kind:** simulation
**Run:** open `ideas/24-extinction-debt/index.html` in a browser (plain classic scripts, so it works straight from disk or any static server; no build, no network). Tests, from the repo root: `node --test ideas/24-extinction-debt/model.test.mjs` (Node 22, about 10 s).
**Made by:** Ledgerwood

## What it is

A square of 10,000 forest sites and ten tree species that share it. Every species is ranked: a better competitor always takes a site from a worse one, and in exchange the worse competitor spreads faster. That one trade-off lets all ten coexist at a stable mix, with the best competitor (#1) the commonest tree.

You have a bulldozer. Drag on the map to clear land (or set a percentage and let it fall at random), and watch. The first thing you will notice is that nothing happens. The forest looks the same. Nobody dies who wasn't going to die anyway. But the **ledger** on the right already says *doomed* next to #1, with a year, because the mathematics has already decided: once more than 20 % of the land is gone, the commonest species cannot hold on, and its share slides toward zero along an exact logistic curve with a time constant of centuries. The number at the top, the **extinction debt**, counts species that are doomed and still standing.

Then you can wait (10, 50 or 200 years per second), or give the land back. Restore enough land while the species still stands and *doomed* flips to *safe* and the share climbs again. Restore it a year after the last tree and nothing comes back, because in this model there is no outside.

Around the map: a chart of every species' share over time with the model's forecast drawn dashed beyond the present; a gauge of cleared land with each species' threshold marked on it; an event log that records what you did and when each species died, and how long it had been doomed; and a short, live derivation of the thresholds and the decline rate. Settings let you change the mean lifetime (which only rescales years), the dominance parameter *q* and the number of species.

## Why I made it

I wanted something that could be proved and something that could only be felt, and extinction debt is both at once. The provable part is a short calculation with a sharp answer: for this model, species *k* survives if and only if less than 1 − (1−*q*)^(2*k*−1) of the land is cleared. The felt part is the silence after the bulldozer. I know the theorem, and I still find it eerie to clear a third of the forest, see ten species where there were ten, and read *doomed, gone by about year 2,560*.

Three things in the model are the opposite of what I would have guessed. The species that goes first is the commonest one, not the rarest. It goes because of what it is good at: being the best competitor means barely out-spreading your own death rate, so you need almost all the land to break even. And the better the clearing is for the trees you kept, the longer the dead species takes to vanish: cut just past the threshold and the decline is so slow that the forest can look intact for a thousand years.

Before choosing I listed candidates: why there are no giant insects (the mechanism is genuinely contested, and I didn't want to pretend otherwise), Kleiber's law and heartbeats (everyone's first idea), Rosenzweig–MacArthur and the paradox of enrichment (canonical textbook material), Fisher's sex ratio with Hamilton's local mate competition, the marginal value theorem as a foraging game, the selection shadow behind ageing, and this one. I picked extinction debt because the sharp result, the counterintuitive ordering, the real conservation stakes and the "nothing happens" moment all come from the same four lines of algebra.

## How it works

**Lineage.** One species on an infinite set of identical sites is Levins's metapopulation model (Levins 1969, *Bull. Entomol. Soc. Am.* 15:237–240): d*p*/d*t* = *cp*(1−*p*) − *mp*. Nee & May (1992, *J. Anim. Ecol.* 61:37–40) added a second, dominant species and habitat destruction. Tilman (1994, *Ecology* 75:2–16) extended it to a ranked community of any size, and Tilman, May, Lehman & Nowak (1994, *Nature* 371:65–66) added destruction to that, found the ordered, delayed extinctions and named the debt. This page is their model with a stochastic forest in front of it.

**The equations.** A site is cleared (fraction *D*), empty, or held by one individual of species *i* ∈ 1..*S*, ranked 1 = best competitor. Species *i* sends propagules to every site at rate *c_i p_i*; a propagule takes any site held by a worse competitor and dies on a better one; every individual dies at rate *m*. With *p_i* the share of **all** sites (cleared ones included),

d*p_i*/d*t* = *c_i p_i* (1 − *D* − Σ_{*j*≤*i*} *p_j*) − *m p_i* − *p_i* Σ_{*j*<*i*} *c_j p_j*.

Because species *i* is affected only by better competitors, the equilibrium solves top-down:

*p_i** = 1 − *D* − *m*/*c_i* − Σ_{*j*<*i*, present} *p_j** (1 + *c_j*/*c_i*), and species *i* is absent when this is ≤ 0.

The right-hand side with *p_i* → 0 is exactly species *i*'s invasion growth rate divided by *c_i*, so the sign of the formula decides presence (checked numerically in the tests).

**Parameters.** The trade-off is the geometric one: *c_i* = *m*/(1−*q*)^(2*i*−1), with *q* the share of the best competitor. I derived (and the tests confirm to 1e-12) that this gives undisturbed shares *q*, *q*(1−*q*), *q*(1−*q*)², …, so the best competitor is the commonest species and abundance falls geometrically down the ranks; bare ground is (1−*q*)^*S*. I believe this is the parameterisation of Tilman (1994) and Tilman et al. (1994, 1997); I could not reach the papers from this sandbox, so take the attribution as [Likely] and the formulas as proven here. Defaults: *S* = 10, *q* = 0.2, so the shares are 20.0, 16.0, 12.8, 10.2, 8.2, 6.6, 5.2, 4.2, 3.4, 2.7 % with 10.7 % bare ground, and the colonisation rates run from 1.25 *m* (#1) to 69.4 *m* (#10).

Time inside the model is measured in mean lifetimes (1/*m*). The page converts to years with a lifetime you can set; the default of 50 years corresponds to the roughly 2 % per year stem mortality that Condit, Hubbell & Foster (1995, *Ecol. Monogr.* 65(4)) measured forest-wide in the Barro Colorado Island 50-ha plot outside the 1983 drought interval. Changing the lifetime rescales every rate together, so it changes how many calendar years a story takes and nothing else.

**What the algebra says (all tested).**
- *Thresholds.* Species *k* persists iff *D* < 1 − (1−*q*)^(2*k*−1). For *q* = 0.2: 20.0, 48.8, 67.2, 79.0, 86.6, 91.4, 94.5, 96.5, 97.7, 98.6 %. Extinctions come in rank order, best competitor first, and the gaps between thresholds shrink down the list, which is Tilman et al.'s "the more fragmented a habitat already is, the greater the number of extinctions caused by added destruction". Only the amount cleared matters, never its shape, because propagules reach every site equally.
- *The best competitor's decline is exactly logistic.* Nothing displaces #1, so d*p*/d*t* = *p*(*r* − *c*₁*p*) with *r* = *c*₁(1−*D*) − *m* = *m*(*q*−*D*)/(1−*q*). At a 50-year lifetime the time constant 1/|*r*| is 800 years when 25 % is cleared, 400 at 30 %, 200 at 40 %, 133 at 50 %.
- *Release.* Below the first threshold the runner-up gains land as #1 loses it: *p*₂* rises with slope (1−*q*)². At 10 % cleared, #2's share goes from 16.0 % to 22.4 %.
- *A parity knife-edge I did not expect.* For *D* ≤ *q*, every odd rank falls in step with the leader, *p*_{2*k*+1}* = (1−*q*)^(2*k*) (*q* − *D*), while every even rank gains, *p*_{2*k*+2}* = *q*(1−*q*)^(2*k*+1) + *D*(1−*q*)^(2*k*+2). So at exactly *D* = *q* all the odd ranks are at zero at once, and the same alternation repeats at every later threshold. A hair past it they recover. In a finite forest that means the odd ranks are briefly very thin whenever the land is near a threshold.

**The forest.** The map is a 100 × 100 lattice stepped synchronously. Each step, every site draws one random number: an empty site is colonised by species *i* with probability *c_i p_i* d*t*; an occupied site dies with probability *m* d*t* or is taken by a better competitor *j* with probability *c_j p_j* d*t*; cleared sites do nothing. d*t* is chosen each step so the largest per-site probability is 5 %. Using the shares at the start of the step, this is an explicit Euler step of the ODE in expectation, so the lattice and the equations agree up to demographic noise of order √(*p*/*N*). Clearing kills whatever stands on the cleared sites, so every species drops by the fraction *D* at the moment of the cut, and the slow part begins from there.

**The forecast.** Whenever the land changes (and once a second while running), the page integrates the ODE with RK4 from the lattice's current shares. A species is *doomed* if its equilibrium at the current *D* is zero; its "gone by" year is when the forecast falls below one individual in 10,000. *Precarious* means the model leaves it fewer than ten sites. The dashed lines on the chart are that forecast.

**Verification (`model.test.mjs`, 11 tests, all passing; numbers below are from the run).**

| Check | Result |
|---|---|
| Equilibrium equals *q*(1−*q*)^(*i*−1), 12 (*S*, *q*) pairs | max error 6.6e-16 |
| Bisection threshold vs closed form, every rank, same grid | max error < 1e-8 |
| Extinct set is a prefix of the ranking and grows with *D* (fine grid, thresholds themselves excluded) | holds for all 12 pairs |
| Parity formulas for odd and even ranks, *D* ≤ *q* | error < 1e-12 |
| ODE from a perturbed start converges to the equilibrium (6,000 yr), *D* = 0, 0.3, 0.55 | max error 2.4e-7; no NaN, no negatives, never over-fills 1 − *D* |
| RK4 vs the logistic closed form for #1, 2,000 yr, four *D* values | max error 1.3e-14 |
| Invasion-rate sign agrees with the equilibrium formula, 200 *D* values × 12 species | holds |
| Forecast: debt count and the "gone by" year | 1 species doomed at 25–40 %, 2 at 50 %; #1 below 1/10,000 after 4,743 / 2,548 / 1,324 / 883 yr (25 / 30 / 40 / 50 % cleared, 50-yr lifetime); #2 after 9,571 yr at 50 % |
| Lattice, one species, 100 × 100, 2,800-yr average | 0.2021 vs *q* = 0.2 |
| Lattice, ten species, 200 × 200, 1,600-yr average | worst gap to *p** 0.005 |
| Lattice vs ODE after clearing 40 %, mean of 8 forests | worst gap 0.005 at +200 yr, 0.004 at +400, 0.030 at +800 and +1,200 |
| Last tree of #1, those 8 forests | 776–1,561 yr after the cut (mean 1,200) vs forecast 1,324 |
| Restore from 40 % to 10 % while #1 is at 1.5 % | #1 back to 8.4 % after 1,500 yr (equilibrium 10 %) |

Separately, 20 forests per clearing level, run 2,000 years each: at 30 % cleared, 13 of 20 lost #1 within the window, at 1,217–1,970 years (forecast 2,548); at 40 %, all 20, at 805–1,785 years (forecast 1,324). Species the model does *not* doom were lost by chance in 3, 5, 5 and 7 of 20 forests at 19, 25, 30 and 40 % cleared, almost always #10 or #8, the rarest ranks, during the reshuffle after the cut. `node tools/smoke.mjs ideas/24-extinction-debt` passes at desktop and phone width, and a scripted run (cut 40 % at 200 yr/s, both colour schemes, both sizes) produced the expected ledger, forecast and event log with no console errors.

## Honest assessment

What works:
- [Certain] Every formula on the page is derived in this README and checked numerically: equilibria, thresholds, ordered extinction, the logistic decline of #1, the release of #2, the parity structure, and the agreement between the stochastic forest and the equations.
- [Certain] The two headline claims of Tilman et al. (1994) that the page dramatises, extinction in order from best to worst competitor and a time-delayed but deterministic loss of the dominant competitor after moderate destruction, are what their abstract says and what this model does.
- [Likely] The "nothing happens" moment lands. The debt counter, the *doomed* badge with a year, and the event log's "it had been doomed since year 11" are the felt part, and the chart's dashed future makes the delay visible rather than asserted.
- [Certain] Restoration works as the model says: a doomed species still standing recovers when *D* drops below its threshold, and a species that is gone stays gone.

What's rough:
- [Certain] "Gone by" overstates the wait near a threshold. It is the year the deterministic forecast drops below one tree in 10,000; a real population lingering at a dozen trees for centuries dies sooner by chance. At 30 % cleared, the 13 of 20 forests that lost #1 within 2,000 years did so 23–52 % earlier than the forecast; at 40 % cleared the forecast was close (8 forests: mean 1,200 vs 1,324; 20 forests: 805–1,785). The page says "about" and explains this in the proof box, but the badge still shows a single year.
- [Certain] Finite-size chance kills species the model does not doom, usually #10 or #8 (about 150–230 sites at equilibrium) during the transient after a cut, in 15–35 % of forests (3, 5, 5 and 7 of 20 at 19, 25, 30 and 40 % cleared). The event log says so when it happens ("the model did not doom it"), but a reader who cleared 40 % and lost two species will reasonably feel the ledger under-promised. A bigger lattice would reduce this; 100 × 100 keeps phones smooth.
- [Certain] The time scale for trees is long. With a 50-year lifetime the first payment comes 900–4,700 years after the cut, which is the model's honest answer, not a tuned one; the lifetime slider is there for grasslands and insects, where the same curves play out in decades. Tilman et al. themselves wrote in generations. Empirical debts in plants are typically measured over decades to a century (Kuussaari et al. 2009, *Trends Ecol. Evol.* 24:564–571); I take Helm, Hanski & Pärtel (2006, *Ecol. Lett.* 9:72–77), who found that today's plant richness in Estonian alvar grasslands tracks the grassland area of the 1930s rather than today's, as the classic field example, from memory [Likely].
- [Certain] The map's colours are generated per rank (lightness by rank, hue alternating by parity) and were validated for adjacent-pair separation at ten species; with more species neighbouring ranks get closer in colour, and the ledger's numbers are the reliable identity.
- [Certain] Global dispersal means the shape of a clearing does not matter here, and the map looks like confetti rather than a forest. Both are honest consequences of the model, and the page says so, but a reader who draws a careful corridor and sees it make no difference is being told something about the model, not about forests. Local dispersal would change the numbers and is the first thing I would add.
- [Certain] What's simplified: identical sites, one individual per site, strict competitive hierarchy, equal mortality for all species, no seed bank, no immigration, no age structure, destruction as an instant and permanent removal of sites. Tilman, Lehman & Yin (1997, *Am. Nat.*, "Habitat destruction, dispersal, and deterministic extinction in competitive communities") showed the ordered-extinction result survives relaxing several of these; I have not reproduced that paper.
- [Likely] The attribution of the geometric parameterisation *c_i* = *m*/(1−*q*)^(2*i*−1) to the original papers is from memory; the formulas and their consequences are independent of who wrote them first.
- [Speculative] The parity knife-edge may be an artefact of the geometric parameterisation rather than a biological prediction. I have not seen it discussed and would not lean on it.

## Where it could go next

- **Local dispersal.** Propagules landing only on neighbouring sites would make clearings' shapes matter, slow everything down, and let a corridor do real work. The ODE forecast would then be only an approximation, which is itself worth showing.
- **Unequal mortality** and a looser hierarchy (a better competitor wins only with some probability), to reproduce Tilman, Lehman & Yin's robustness results in the browser.
- **Immigration from outside**, a trickle of propagules of every species, which turns permanent extinction into a long absence and makes restoration a race against a different clock.
- **A "fragments" mode**: several small forests instead of one, each with its own lattice, to show how one of Diamond's relaxation estimates (1972, *PNAS* 69:3199–3203: thousands of years for land-bridge islands) arises from the same mathematics.
- **Sound.** A tone per species whose volume follows its share. The debt would then be a chord that very slowly loses its root.
