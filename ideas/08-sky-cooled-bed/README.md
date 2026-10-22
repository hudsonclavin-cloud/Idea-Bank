# The Sky-Cooled Bed
> A mattress pad plumbed to the night sky: no compressor, no pump, no plug, and it switches itself off at sunrise.

**Kind:** dossier
**Run:** open index.html in a browser
**Made by:** Nightjar

## What it is

This is a design dossier for an invention I don't believe exists yet. A thin water pad lies under the bottom sheet, and two insulated pipes connect it to a radiator panel on the roof. A clear night sky over a hot city radiates like a much colder surface, so the panel chills the water a few degrees below the air. The cold water sinks down to the bed, picks up heat from the sleeper's back, and rises back to the roof. That is a thermosyphon: it needs no pump. By day the sunlit panel is hotter than the bed, its hot water sits stably on top of the loop, and the flow stops on its own. The loop is a thermal diode with no moving parts.

It is aimed at a specific person: an older adult in a top-floor flat under an uninsulated roof, on heat-wave nights when the outdoor air stays around 30 °C in a not-too-humid climate, with no air conditioning or no power to run it.

The page (`index.html`, self-contained, no network) contains:

- the problem
- a labelled section diagram and a day/night thermal-diode diagram
- first-principles feasibility math with every substitution shown
- a live calculator that runs the same model code
- prior art
- a pre-mortem with probabilities
- the cheapest decisive experiment
- the candidates I rejected and why
- an assumptions register with a confidence level for each input

## Why I made it

I wanted an invention where physics hands you something for free and almost nobody uses it. The clear night sky is a heat sink. On a 31 °C night with a 16 °C dew point it radiates like a surface at about 16 °C, and it is right above the people who are suffering. Roof ponds use it for whole buildings, but a whole room needs about a kilowatt and a night sky gives tens of watts per square metre. The reframe that made it click for me: don't cool the room, cool the 0.3 m² of the body that a mattress normally insulates completely.

What kept me going were the alignments:

- Sky cooling works at night, which is exactly when people sleep.
- Heat domes tend to bring clear skies.
- The people at highest risk sleep directly under the roof, which is the only geometry where a pumpless loop works.

Building the model then surprised me. I expected humidity and the sky to be the weak link. They aren't: the system is throttled by how much heat a sleeping back will give up to a cool surface, a physiological number nobody seems to have measured for this case. That changed which experiment comes first.

## The key numbers

All are computed by `model.js` for the base case: clear night, outdoor air 31 °C, dew point 16 °C, bedroom 33 °C, 2 m² bare panel 3 m above the pad.

1. **36 W drawn from the sleeper, which is 48% of a sleeping body's 73 W.** It comes from solving the coupled steady state: panel rejection equals body heat plus parasitic gains, by bisection on the panel temperature. It cuts the water the sleeper must evaporate from 84 to 31 g/h. Without the pad, 17 W leaves as dry heat from exposed skin and the rest must be sweated off.
2. **The sky behaves like a 16 °C surface. The panel nets 32 W/m², or 64 W from 2 m².** The Berdahl & Martin clear-sky emissivity at a 16 °C dew point is 0.819. At the solved panel temperature of 27.8 °C, the panel radiates a net 64 W/m², and the 31 °C air hands 32 W/m² straight back. Of the 64 W, 29 W (45%) is lost to the mattress, the room and the pipes.
3. **Body-to-water conductance is 4.00 W/K, and this is the bottleneck.** It is tissue conductance (20 W/m²K, the least certain number) in series with sheet, film and water (40 W/m²K), over 0.30 m² of contact. If tissue conductance is 8 the sleeper gets only 19 W; if it is 40, 51 W. Doubling the panel to 4 m² buys just 4 W, because past about 2 m² you are fighting the body, not the sky.
4. **The loop runs at 2.5 K, 6.0 g/s, 19 Pa and Re 431, with no pump.** Buoyancy (ρβΔT·gH) is set equal to laminar Hagen–Poiseuille friction for a 20 mm pipe, 14 m equivalent length and 3 m height. An independent bisection on flow rate in `check.mjs` reproduces it.
5. **Cooling the whole room instead takes about 1126 W, 32× more.** The estimate is dominated by the still-hot ceiling: 12 m² × 8 W/m²K × 9 K. An air conditioner with COP 3 would draw about 375 W for that.

## Honest assessment

- [Certain] The radiative physics: a high-emissivity surface under a clear night sky radiates tens of W/m² net near air temperature.
- [Certain] The thermosyphon and its thermal-diode behaviour. Both are standard: solar water heaters run the same loop the other way.
- [Certain] The components exist off the shelf: pool-heater mats, PEX pipe, welded TPU pads.
- [Likely] The panel numbers. Berdahl–Martin is fitted to US sites, and urban haze will cut the flux somewhat. A crude cloud model says even full overcast still yields about 20 W, because the night air is cooler than the pad water.
- [Likely] The thermosyphon flows unaided with 1 m or more of height. Lower than that needs a 1–3 W pump.
- [Likely] Plumbing at this pressure is delicate. The 19 Pa drive is only 2.0 mm of water head, so one trapped bubble can stall the loop. A sleeper presses on the pad at about 2.3 kPa, which would pinch shut a pad of two welded sheets. The pad needs non-collapsible channels (a capillary-tube mat or spacer fabric) and the loop needs bubble-free filling.
- [Speculative] Tissue conductance under a cool pad, which could be anywhere from 8 to 40 W/m²K. Local cold-induced vasoconstriction could throttle the flow. **This is the decisive unknown.**
- [Speculative] Contact area: about 0.30 m² for a back-sleeper, perhaps half that on the side.
- [Speculative] Costs, about $275 in materials (guesses, not quotes), and whether anyone at risk can get it installed.
- [Speculative] Physiology: whether a 36 W reduction in evaporative load meaningfully reduces heat strain, as opposed to just improving comfort.

**Overall:** I give it 44% that a well-built prototype performs as the page claims (the five technical risks treated as independent), and 21% that it becomes something people actually use. The adoption barrier, getting a roof panel and two pipes into an at-risk renter's bedroom, is the most likely killer, and it has nothing to do with physics. It is worth the cheap experiment below. It is not yet worth a product.

## The first experiment

**The bucket bed: about $120 and three nights plus one control night.** Test the body side first, with no roof involved. You need:

- a 50 L cooler box of water, chilled to about 24 °C with ice at bedtime and then left alone
- a small aquarium pump pushing about 5 g/s through a pad with non-collapsible channels, on 10 mm foam
- two cross-calibrated temperature sensors on the pad's inlet and outlet
- a logger

Sleep on it in a bedroom at 31 °C or warmer. The bucket gains about 74 W in total, so it warms by about 1.3 K per hour and sweeps the 26–30 °C operating range in one night. Heat into the pad is ṁ·c_p·ΔT. Plotted against water temperature, its slope is the body-to-water conductance. One empty-bed night under the same conditions gives the parasitic and pump heat, which gets subtracted.

- **Prediction:** 36 W from the sleeper at 28 °C water, a 1.7 K rise across the pad, resolvable to about ±1 W.
- **Kill:** a body heat flow under 20 W at 28 °C water, which means tissue conductance ≤ 9 W/m²K. Even a 6 m² panel would then reach only 23 W.
- **Pass (30 W or more):** run the sky bucket. That is a 2 m² pool-heater mat on a roof in a target city, about $150 and ten clear nights. The model predicts 51 W/m² with the panel 2 K below the air. Kill it if the measured flux is under 25 W/m².

## Files and verification

- `index.html` is the dossier. It carries `model.js` inline and unchanged.
- `model.js` is the feasibility model and the single source of every number.
- `build.mjs` inlines the model and fills each tagged number in the page.
- `check.mjs` does four things:
  - It recomputes the headline numbers with independent code: a secant solve on water temperature, and bisection on the thermosyphon flow.
  - It checks the units of every formula with a small dimensional-analysis kernel.
  - It runs physics sanity tests: energy closure, monotonicity, thermal-diode behaviour.
  - It fails if the page or this README drifts from the model.

```
node ideas/08-sky-cooled-bed/build.mjs   # after editing model.js
node ideas/08-sky-cooled-bed/check.mjs
node tools/smoke.mjs ideas/08-sky-cooled-bed
```
