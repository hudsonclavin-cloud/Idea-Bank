# The Sky-Cooled Bed
> A mattress pad plumbed to the night sky: no compressor, no pump, no plug, and it shuts itself off by day.

**Kind:** dossier
**Run:** open index.html in a browser
**Made by:** Nightjar

## What it is

This is a design dossier for an invention I don't believe exists yet. A thin water pad lies under the bottom sheet, and two insulated pipes connect it to a radiator panel on the roof. A clear night sky over a hot city radiates like a much colder surface, so the panel chills the water a few degrees below the air. The cold water sinks to the bed, picks up heat from the sleeper's back, and rises back to the roof. That is a thermosyphon: it needs no pump. By day the sunlit panel is warmer than the bed, its hot water sits stably on top of the loop, and the flow stops on its own. The loop is a thermal diode with no moving parts.

It is aimed at a specific person: an older adult in a top-floor flat under an uninsulated roof, on heat-wave nights when the outdoor air stays around 30 °C in a not-too-humid climate, with no air conditioning or no power to run it.

The page (`index.html`, self-contained, no network) contains:

- the problem
- a labelled section diagram and a day/night thermal-diode diagram
- first-principles feasibility math with every substitution shown
- a live calculator running the same model code, including a pad-type switch
- prior art
- a pre-mortem with probabilities
- the cheapest decisive experiment
- the candidates I rejected and why
- an assumptions register with a confidence level for each input
- a revision note listing what an independent review changed

## Why I made it

I wanted an invention where physics hands you something for free and almost nobody uses it. The clear night sky is a heat sink. On a 31 °C night with a 16 °C dew point it radiates like a surface at about 16 °C, and it is right above the people who are suffering. Roof ponds use it for whole buildings, but a whole room needs about a kilowatt and a night sky gives tens of watts per square metre. The reframe that made it click for me: don't cool the room, cool the 0.3 m² of the body that a mattress normally insulates completely.

What kept me going were the alignments:

- Sky cooling works at night, which is exactly when people sleep.
- Heat domes tend to bring clear skies.
- The people at highest risk sleep directly under the roof, which is the only geometry where a pumpless loop works.

Building the model then surprised me. I expected humidity and the sky to dominate the answer. They don't. The panel runs only a few degrees below air whatever the sky does, and how many watts each degree buys depends on how readily a sleeping back gives up heat to a cool surface. That is a physiological number nobody seems to have measured for this case, so it decides which experiment comes first.

## The key numbers

All are computed by `model.js` for the base case: clear night, outdoor air 31 °C, dew point 16 °C, bedroom air 33 °C under a ceiling still at 35 °C, a 2 m² bare panel 3 m above the pad, and a spacer-fabric pad.

1. **35 W is drawn from the sleeper: 48% of a sleeping body's 73 W.** It comes from solving the coupled steady state: panel rejection equals body heat plus parasitic gains, by bisection on panel temperature. Exposed skin sheds only 11 W of dry heat, by convection to 33 °C air and radiation to a 33.8 °C mean radiant temperature that includes the warm ceiling. The pad cuts the water the sleeper must evaporate from 92 to 39 g/h, a 57% reduction.
2. **The sky behaves like a 16 °C surface, and the panel nets 33 W/m², or 66 W from 2 m².** The Berdahl & Martin clear-sky emissivity at a 16 °C dew point is 0.819. At the solved panel temperature of 27.8 °C the panel radiates a net 64 W/m², and the 31 °C air hands 32 W/m² straight back. Of the 66 W, 30 W (46%) is lost to the mattress, the room and the pipes. In a breeze the panel can't get colder than about 25.8 °C, which caps the sleeper at about 45 W even with an infinite panel. That, plus parasitic losses, is why doubling the panel to 4 m² buys just 4 W.
3. **Body-to-water conductance is 4.00 W/K, and this is the biggest unknown.** It is tissue conductance (20 W/m²K) in series with sheet, film and water (40 W/m²K), over 0.30 m² of contact. If tissue conductance is 8 the sleeper gets only 19 W; if it is 40, 50 W. No other input swings the result as much.
4. **The loop runs at 3.6 K, 4.3 g/s, 27 Pa and Re 310, with no pump.** The friction budget counts every element, all laminar: 20 m of 20 mm pipe plus 4 m for fittings (23.7 Pa), the spacer-fabric pad (2.6 Pa) and the panel's channels (1.0 Pa). The loop stays within an 8 K temperature difference down to 0.6 m of height. A capillary-tube mat would push the difference to 4.7–7.4 K at 3 m and need 1.1–2.6 m of height. An independent bisection on flow rate in `check.mjs` reproduces all of this.
5. **Cooling the whole room instead takes about 1126 W, 32× more.** The estimate is dominated by the still-hot ceiling: 12 m² × 8 W/m²K × 9 K. An air conditioner with COP 3 would draw about 375 W for that.

## Honest assessment

- [Certain] The radiative physics: a high-emissivity surface under a clear night sky radiates tens of W/m² net near air temperature.
- [Certain] The thermosyphon and its thermal-diode behaviour. It switches off once the panel is warmer than the pad return, some time after sunrise.
- [Certain] The components exist: pool-heater mats, PEX pipe, drop-stitch spacer fabric.
- [Likely] The panel numbers. Berdahl–Martin sits mid-range among clear-sky correlations, and urban haze will cut the flux somewhat. A crude cloud model says even full overcast still yields about 20 W, because the night air is cooler than the pad water.
- [Likely] Body weight can't pinch the pad shut. It sits at about 29 kPa under the open water column, roughly 13× the 2.3 kPa body contact pressure. The real pad problem is ballooning, which drop-stitch spacer fabric solves.
- [Likely] The loop flows unaided down to about 0.6 m of height with the spacer pad. Below that, or with a high-friction pad, use a 1–3 W pump.
- [Likely] Plumbing is delicate. The 27 Pa drive is only 2.8 mm of water head, so one trapped bubble can stall the loop.
- [Speculative] Tissue conductance under a cool pad, which could be anywhere from 8 to 40 W/m²K. Local cold-induced vasoconstriction could throttle the flow. **This is the decisive unknown.**
- [Speculative] Contact area: about 0.30 m² for a back-sleeper, perhaps half that on the side.
- [Speculative] The spacer fabric's flow penalty (×3), the panel's channel geometry, and how much ceiling the sleeper sees.
- [Speculative] Costs, about $275 in materials (guesses, not quotes), and whether anyone at risk can get it installed.
- [Speculative] Whether a 35 W cut in evaporative load meaningfully reduces heat strain, as opposed to just improving comfort.

**Overall:** I give it 44% that a well-built prototype performs as the page claims, and 21% that it becomes something people actually use. Each pre-mortem risk is my separate estimate of the chance that it alone sinks the idea. The 44% treats the five technical risks as independent; the 21% adds the two adoption risks. The adoption barrier, getting a roof panel and two pipes into an at-risk renter's bedroom, is the most likely killer, and it has nothing to do with physics. It is worth the cheap experiment below. It is not yet worth a product.

## The first experiment

**The bucket bed: about $120, an afternoon, one control night and three nights asleep.** Test the body side first, with no roof involved. You need:

- a 50 L cooler box of water and a small aquarium pump pushing about 5 g/s through a spacer-fabric pad on 10 mm foam
- two cross-calibrated temperature sensors on the pad's inlet and outlet, and a logger
- a 0.30 m² piece of 50 mm foam board

The steps:

0. **Bench check.** Hang a reservoir about 3 m above the pad and raise the outlet to 1 cm below its water level. The pad then sits at its real ~29 kPa with 1 cm of head across it. Lie on it and time one litre. The model's pad does it in about 6 s; a capillary mat would take 52–209 s. Slower than 58 s means the pad alone more than doubles the loop's friction: redesign it or plan on a pump.
1. **Control night.** Leave the bed empty, but lay the foam board where the torso would lie. Subtracting a plain empty bed would also subtract the room's gain on that patch, about 12 W. A sleeper behaving exactly as modelled would then read about 24 W and fail. The board leaks about 1 W, which gets added back.
2. **Three occupied nights.** Chill the bucket to about 24 °C at bedtime and let it drift. It gains about 76 W in total, so it warms about 1.3 K per hour and sweeps the 26–30 °C range. Body heat = ṁ·c_p·ΔT minus the control fit, plus the board's leak. Plotted against water temperature, its slope is the body's conductance.

- **Prediction:** 36 W from the sleeper at 28 °C water, a 1.7 K rise across the pad, and a slope of 4.00 W/K, resolvable to about ±1 W.
- **Kill:** under 20 W at 28 °C water, which means tissue conductance ≤ 9 W/m²K. Even a 6 m² panel would then reach only 23 W.
- **Pass:** 30 W or more, which means tissue conductance ≥ 15 W/m²K. Then run the sky bucket: a 2 m² pool-heater mat on a roof in a target city, about $150 and ten clear nights. The model predicts 51 W/m² with the panel 2 K below the air. Kill it if the measured flux is under 25 W/m².

## Revision note

An independent reviewer rebuilt the model in separate code. It reproduced every headline number and found real problems, all now fixed:

- **The control night was biased.** It now covers the body's patch with a foam board.
- **The friction budget was incomplete.** It omitted the pad's channels, and the capillary mat I had recommended carries a lot of friction. The budget now counts every element, and the recommended pad is now spacer fabric. The loop moved from 2.5 K / 6.0 g/s / 19 Pa to 3.6 K / 4.3 g/s / 27 Pa.
- **The pad-collapse argument was backwards.** The real issue is ballooning, not pinching.
- **The sleeper's dry heat loss ignored the hot ceiling.** Evaporation needed moved from 84 → 31 g/h to 92 → 39 g/h.
- **I misexplained diminishing returns.** The cause is the panel's floor temperature and the parasitic share, not the body.
- **Smaller fixes:** the pre-mortem's framing, and the README and page now agree on the pump threshold.

## Files and verification

- `index.html` is the dossier. It carries `model.js` inline and unchanged.
- `model.js` is the feasibility model and the single source of every number.
- `build.mjs` inlines the model and fills each tagged number in the page.
- `check.mjs` does four things:
  - It recomputes the headline numbers with independent code: a secant solve on water temperature with term-by-term parasitic gains, bisection on thermosyphon flow with a written-out friction budget, and its own panel no-load bisection.
  - It checks the units of every formula with a small dimensional-analysis kernel.
  - It runs physics sanity tests.
  - It fails if the page or this README drifts from the model.

```
node ideas/08-sky-cooled-bed/build.mjs   # after editing model.js
node ideas/08-sky-cooled-bed/check.mjs
node tools/smoke.mjs ideas/08-sky-cooled-bed
```
