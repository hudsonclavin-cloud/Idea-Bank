# The Plateau Bottle
> A hot water bottle you can hug all night: a wax jacket that melts at 43.8 °C holds the skin side near 40.6 °C instead of starting at 48.4 °C and sliding.

**Kind:** redesign
**Run:** open index.html in a browser
**Made by:** Mushy Zone

## What it is

This is a redesign dossier for the rubber hot water bottle: the 2 litre BS 1970 bag that, according to a Uswitch survey, about 61% of UK households own. The page (`index.html`, self-contained, no network) contains:

- the evidence that the bottle hurts people
- the physics of why its contact temperature is wrong
- a fair hearing for the original and its cheapest fix
- the redesign, with three hand-drawn labelled SVG figures and a table of key dimensions
- a live calculator running the same model as everything else on the page
- nine nights compared across three bottles
- the alternatives and the prior art
- a bill of materials with costs, and the manufacturing method
- a pre-mortem
- the bench test that could kill it, plus the test it needs that no model can run

The redesign keeps the bottle and changes what lies between the water and you. On each face there is 1 mm of polyester felt, then 7.5 mm (average) of **lauric acid** in two offset layers of sealed film tubes, 761 g in all. A thin cotton sleeve holds it together. Lauric acid melts at 43.8 °C. While any solid wax remains between the melt front and the skin, the outside cannot get hotter than that, however hot the water is. When the water cools below it, the wax freezes and gives the heat back.

## Why I made it

I wanted something everyone has put up with without noticing it was a design decision. Everyone knows the routine. For the first hour a hot water bottle is too hot to hold, so you wrap it in a towel or kick it to the bottom of the bed. By the time it's pleasant, it is somewhere you aren't. That is annoying for most people. For people who can't feel heat properly, or can't move away from it, it is a burn. England and Wales record about 594 hot water bottle burns a year.

What hooked me was that the fault is structural, not a matter of misuse. A thin rubber wall makes the skin's excess over 37 °C a fixed fraction of the water's. So a plain bottle is *always* either too hot early or too cool late. What it wants is a resistance that is high when the water is hot and low when it isn't, and a material that melts is close to that.

I also expected the wax to beat any cover. It doesn't, on the night the makers intend. Finding that out changed what the dossier argues.

## How it works

`model.js` is a one-dimensional transient conduction model with three heat paths from one well-mixed water node. One goes through the top face to skin (half the face), one through the top face to the duvet, and one through the bottom face into the mattress foam. There is also a small edge loss. The wax uses an enthalpy method with separate solid and liquid conductivities, and the liquid layer is 16% thicker because the wax swells when it melts. Skin is modelled as a tissue resistance to a 37 °C core, with 0.015–0.06 m²K/W tried. `build.mjs` inlines the model into the page and fills every tagged number from it. The calculator calls the same functions live.

## The key numbers

1. **48.4 °C at the skin, used exactly as instructed.** That is water at 80 °C (the top of the 60–80 °C range Fashy recommends), two thirds full, in a fleece cover of 0.05 m²K/W, against base-case tissue. Skin with better circulation sees 43.7 °C, and skin with poor circulation 54.6 °C. The transient model puts the peak at 4 minutes; the closed-form steady value is 49.9 °C. The skin stays above ISO 13732-1's 10-minute burn line (48 °C) for 12 min and above its 8-hour line (43 °C) until 3.0 h. Bare rubber would head for 62.6 °C.
2. **A ceiling of 43.8 °C, and a skin plateau of 40.1–41.5 °C.** These come from *T*<sub>skin</sub> = 37 + (*T*<sub>m</sub> − 37) · *R*<sub>t</sub>/(*R*<sub>t</sub> + *R*<sub>outer</sub>), with the melt front at the water side or at the sleeve. With poor circulation (*R*<sub>t</sub> = 0.06) the plateau is 42.4 °C, still under the 8-hour line. That is why the melting point is 43.8 °C and not higher. In the full model the plateau bottle peaks at 40.6 °C and spends 8.9 h of 9 between 38 and 43 °C.
3. **0.15 m²K/W: the cheap fix that ties on the intended night.** By bisection, the thinnest plain cover that keeps the as-instructed night under 43 °C is 0.141 m²K/W, three times the fleece. Rounded to 0.15, it peaks at 42.7 °C with 9.0 h in band, which my jacket cannot beat. Each other night needs a different cover, though: 0.240 for kettle-hot water, 0.350 for poor circulation, 0.500 for both. That last cover leaves warm skin on a careful 60 °C night at 37.6 °C.
4. **Nights spent above 43 °C, out of nine modelled: plain 8, thick cover 6, plateau 0.** The nights cover kettle-hot water, overfilling, poor and good circulation, a lost cover, and pre-warming the bed. On the worst one (poor circulation and kettle-hot water), the plain bottle peaks at 61.0 °C, the thick cover at 50.6 °C, and the plateau bottle at 42.3 °C.
5. **What it costs: 173 kJ of storage, 801 g, £4.75–9.80.** The wax stores 133 kJ latent plus 40 kJ sensible, 173 kJ in all. The water holds 212 kJ above the melting point at 80 °C and 300 kJ at 95 °C, so the body and the bed have to take the rest. The design adds 801 g (+44%, 2.63 kg filled). The bill of materials is £4.75–9.80, which means roughly £14–29 retail.

## Honest assessment

- [Certain] While solid wax lies between the melt front and the skin, the outer surface cannot exceed the melting point. That is thermodynamics.
- [Certain] The plain bottle's contact temperature is set by a fixed resistance, so it tracks the water: too hot early, cooler late.
- [Likely] In the model, on the as-instructed night, a plain cover three times thicker than fleece does as well as the jacket (42.7 °C peak, 9.0 h in band). The case for the jacket rests on the other nights.
- [Likely] The original's contact temperatures are modelled, not measured. I found no published measurement of a hot water bottle's skin-side temperature. The bench test's control runs measure it, and if the plain bottle peaks below 45 °C on night A, it is less bad than I say.
- [Likely] The burn evidence, with caveats. The figure of 594 a year is England and Wales, from the International Burn Injury Database (*Burns* 2024). The cause split (bursts 48.2%, spills 33.0%, contact 18.8%) comes from a single unit's 85 patients, so the jacket targets the smallest share.
- [Likely] The plateau lands at 40–42 °C for most skin. The tissue resistance is the decisive unknown. For warm, well-perfused skin the plateau bottle peaks at only 39.4 °C, with 3.7 h in band, worse than the thick cover's 7.0 h.
- [Likely] Seal lines don't run hot. The tubes are offset in two layers so no seal goes straight through. A 1-D bound that ignores sideways spreading gives 41.3 °C as instructed but 44.2 °C kettle-hot. The test has a probe on a seal line.
- [Likely] The model is sound to within the stated sensitivities. Doubling the liquid wax's conductivity for convection, or leaving the sleeve off, pushes the worst night to 43.6 °C, which is over 43 but well under 48.
- [Likely] It adds risks of its own. Empty, it weighs 1.23 kg against 0.43 kg, so it is harder to hold steady while pouring. Spills while filling are a third of burns. A failed seam would leak lauric acid, which can seriously damage eyes (H318).
- [Speculative] The ceiling is not absolute. Kettle-hot water left two hours in an empty bed melts all the skin-side wax while the water is still 55 °C. The first touch then reaches 46.3 °C, for 4 min above 43 °C. Kettle-hot, the wax on the duvet-facing half of the face also melts through, so rolling onto it early in the night would do something similar.
- [Speculative] All prices except the lauric acid benchmark (Argus, about $2,150/t FOB) and the bottle's retail listings.
- [Speculative] Whether anyone wants a hot water bottle that never feels hot. That can only be felt, not computed.

**Prior art.** US 11,090,187 B2, "Hot water bottle containing phase change material" (Ohmer; WFI Wärmflascheninnovation UG; listed as expired for unpaid fees), puts a sodium-acetate-type insert *inside* the bottle. I could not read its claims in full. In the same model, that placement idealised still peaks at 43.3 °C as instructed, because it caps the water and leaves the skin to the cover. The Burnout mug (ThermAvant, NASA spinoff) does the same thing for coffee with a wax between vacuum walls; its 140 °F melting point comes from retail sources I could not verify. The idea of phase-change material in a hot water bottle is not new. The placement, the felt spacer and the choice of melting point are what this adds.

**Pre-mortem.** The page lists ten failure modes, each with its own probability. They are separate estimates, not shares of 100%. The biggest is "lukewarm" at 40%. Then come weight and price at 25% each, and tissue that is better perfused than modelled at 20%. If the ten were independent, the chance of surviving all of them would be 12%.

**My probability that it is better than the plain bottle for most people: 30%.** It is heavier, dearer and less hot, and most people are never burned. For people who can't feel or can't move away from heat (older people, people with diabetic neuropathy, anyone using it on a numb back) I put it at 75%. It is worth the bench test below. It is not yet worth a product.

## The first test

**A skin phantom on the kitchen table: two nights, about £200, or £120 if you own a sous-vide stick and a thermocouple logger.** The phantom is a 12 L box of water held at 37 °C by the sous-vide stick, with an acrylic plate floating on top. 5 mm of acrylic plus the bath's film is 0.0283 m²K/W, standing in for normal tissue. A 10 mm plate, 0.0546 m²K/W, stands in for poor circulation. Hand-make one jacket from lauric acid and impulse-sealed layflat tube. Lay the bottle jacket-down on the plate, put a folded duvet on top, and log for 9 h. One thermocouple goes over a tube centre, one over a seal line, and one in the water.

- **Night A**, the intended night: 80 °C, 1.4 L, 5 mm plate. The model predicts a 40.5 °C peak and 8.9 h in the 38–43 °C band.
- **Night B**, the bad night: 95 °C, 1.4 L, 10 mm plate. The model predicts a 42.2 °C peak and 8.9 h in band.
- **Pass:** on both nights neither probe exceeds 43.0 °C, and on night A the tube probe's hours in the 38–43 °C band are within 0.5 h of the thick-cover control run on the same rig, or better.
- **Kill:** either probe exceeds 43.8 °C on either night, or night A gives fewer hours in band than the plain bottle in fleece on the same rig. 43.8 °C is the melting point, which a working jacket can't exceed while it has solid wax, so crossing it means melt-through or a hot seal line. Fewer hours in band than the plain bottle means it is warm and safe for less of the night than what it replaces, at 0.8 kg more.
- Warmth is judged against same-rig controls on purpose. Late in the night the jacket holds the skin just above 38 °C, so a 10% error in the acrylic's conductivity cuts the model-perfect jacket's hours in band from 8.9 to 6.8. The thick-cover control moves with it, to 7.0, so the comparison holds where an absolute line would not.
- Anything between is inconclusive: fix the build and rerun once, and a second inconclusive counts as a kill.

`check.mjs` asserts that the design performing exactly as modelled passes. It also asserts that it still passes with the phantom off by ±10% in acrylic conductivity, ±50% in bath film, or ±3 °C in room temperature, or with 60–100% contact. And it asserts that the test kills the designs it should. The plain bottle peaks at 49.7 °C on night B in the thick cover. A jacket whose filler doesn't melt reaches 49.5 °C, and a seal line as bad as the 1-D bound reaches 48.2 °C. A jacket without the felt spacer peaks at 43.5 °C, which is inconclusive.

If it passes, the next test can only be felt. Five hot-water-bottle users each get a plain bottle and a plateau bottle, sleeved alike, for a week at home. Kill it if fewer than two keep reaching for the plateau one.

## Where it could go next

- If seal lines read hot on the bench, switch to a form-stable sheet: lauric acid held in a polymer or silica matrix, which needs no cells. It costs some latent heat and money.
- A lighter version for feet: a 1 L bottle with proportionally less wax on both faces.
- Sell the jacket as a sleeve for the bottles people already own.

## Files and verification

- `index.html` is the dossier. It carries `model.js` inline and unchanged.
- `model.js` is the model and the single source of every number.
- `build.mjs` inlines the model and fills each tagged number in the page.
- `check.mjs` does five things:
  - It recomputes the headline numbers with a separately written solver: a smeared phase change instead of a sharp one, 10 wax slices instead of 6, a 1 s time step, and its own bisection for the thick cover.
  - It re-derives the closed forms from re-typed constants.
  - It checks the units of every formula with a small dimensional-analysis kernel.
  - It checks energy closure and the stability of the explicit scheme, asserts the test's verdicts, and fails if the page or this README drifts from the model.
  - If Playwright is available, it drives the live calculator and compares its output with the model.

```
node ideas/28-plateau-bottle/build.mjs   # after editing model.js
node ideas/28-plateau-bottle/check.mjs
node tools/check.mjs ideas/28-plateau-bottle
```
