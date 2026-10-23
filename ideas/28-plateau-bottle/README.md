# The Plateau Bottle
> A wax jacket that melts at 43.8 °C holds a hot water bottle's skin side near 40.6 °C instead of starting at 48.4 °C and sliding, as long as some of the wax stays solid.

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
- 13 nights compared across three bottles, and a map of where the jacket fails
- the alternatives and the prior art
- a bill of materials with costs, and the manufacturing method
- a pre-mortem
- the bench test that could kill it, plus the test it needs that no model can run

The redesign keeps the bottle and changes what lies between the water and you. On each face there is 1 mm of polyester felt, then 7.5 mm (average) of **lauric acid** in two offset layers of sealed film tubes, 761 g in all. A thin cotton sleeve holds it together. Lauric acid melts at 43.8 °C. While any solid wax remains between the melt front and the skin, the outside cannot get hotter than that, however hot the water is. When the water cools below it, the wax freezes and gives the heat back. If the wax melts through, that limit is gone.

## Why I made it

I wanted something everyone has put up with without noticing it was a design decision. Everyone knows the routine. For the first hour a hot water bottle is too hot to hold, so you wrap it in a towel or kick it to the bottom of the bed. By the time it's pleasant, it is somewhere you aren't. That is annoying for most people. For people who can't feel heat properly, or can't move away from it, it is a burn. England and Wales record about 594 hot water bottle burns a year.

What hooked me was that the fault is structural, not a matter of misuse. A thin rubber wall makes the skin's excess over 37 °C a fixed fraction of the water's. So a plain bottle is *always* either too hot early or too cool late. What it wants is a resistance that is high when the water is hot and low when it isn't, and a material that melts is close to that.

I also expected the wax to beat any cover. It doesn't, on the night the makers intend. Finding that out changed what the dossier argues.

## How it works

`model.js` is a one-dimensional transient conduction model with three heat paths from one well-mixed water node. One goes through the top face to skin (half the face), one through the top face to the duvet, and one through the bottom face into the mattress foam. There is also a small edge loss. The wax uses an enthalpy method with separate solid and liquid conductivities, and the liquid layer is 16% thicker because the wax swells when it melts. Skin is modelled as a tissue resistance to a 37 °C core: 0.015–0.06 m²K/W in the nights, and up to 5 in the melt-through map. For skin pressed under body weight there is also a slab of tissue with heat capacity and no blood flow (Pennes bioheat). The model also tracks the thermal dose (CEM43) and the hottest skin-side wax. `build.mjs` inlines the model into the page and fills every tagged number from it. The calculator calls the same functions live.

## The key numbers

1. **48.4 °C at the skin, used exactly as instructed.** That is water at 80 °C (the top of the 60–80 °C range Fashy recommends), two thirds full, in a fleece cover of 0.05 m²K/W, against base-case tissue. Skin with better circulation sees 43.7 °C, and skin with poor circulation 54.6 °C. The transient model puts the peak at 4 minutes; the closed-form steady value is 49.9 °C. The skin stays above ISO 13732-1's 10-minute burn line (48 °C) for 12 min and above its 8-hour line (43 °C) until 3.0 h. Bare rubber would head for 62.6 °C.
2. **A skin plateau of 40.1–41.5 °C, while some wax stays solid.** These come from *T*<sub>skin</sub> = 37 + (*T*<sub>m</sub> − 37) · *R*<sub>t</sub>/(*R*<sub>t</sub> + *R*<sub>outer</sub>), with the melt front at the water side or at the sleeve. With poor circulation (*R*<sub>t</sub> = 0.06) the plateau is 42.4 °C, still under the 8-hour line. That is why the melting point is 43.8 °C and not higher. In the full model the plateau bottle peaks at 40.6 °C and spends 8.9 h of 9 between 38 and 43 °C. The melting point is **not** a safe ceiling in general: see 5.
3. **0.15 m²K/W: the cheap fix that ties on the intended night.** By bisection, the thinnest plain cover that keeps the as-instructed night under 43 °C is 0.141 m²K/W, three times the fleece. Rounded to 0.15, it peaks at 42.7 °C with 9.0 h in band, which my jacket cannot beat. Each other night needs a different cover, though: 0.240 for kettle-hot water, 0.350 for poor circulation, 0.500 for both. That last cover leaves warm skin on a careful 60 °C night at 37.6 °C.
4. **Nights spent above 43 °C, out of 13 modelled: plain 12, thick cover 10, plateau 2.** The nights cover kettle-hot water, overfilling, poor and good circulation, a lost cover, pre-warming the bed, two misuses at once, and lying on the bottle. The jacket's two are double misuses on poor circulation. On the worst (poor circulation, kettle-hot water, filled to the top), the plain bottle peaks at 61.7 °C, the thick cover at 51.0 °C, and the plateau bottle at 46.3 °C, with 4.7 h above 43 °C after the wax melts through. The count reflects which nights I chose, so the page also maps the failures.
5. **Where the ceiling fails.** The wax stores 173 kJ; a kettle fill holds 300 kJ above the melting point, and the body and bed must take the rest. As drawn, the jacket never melts through when filled as instructed (80 °C, two thirds full), even with no heat taken away. But skin that sheds very little heat sits just under the melting point: over 43 °C above a tissue resistance of about 0.15, and 43.8 °C for 8.8 h with none taken away, a dose of about 901 CEM43 minutes against 480 for the ISO 8-hour line. Kettle-hot, it melts through above *R*<sub>t</sub> 0.068, after one to two hours, and the skin heads for the water temperature: 44.9 °C at 0.1, 55.1 °C with no heat taken away. On 40 mm of pressed tissue with no blood flow, a kettle fill ends 99% melted at 42.9 °C. A 10 mm jacket (1015 g) moves the kettle threshold to 0.530 and spends no time above 43 °C on any of the 13 nights, for 2.89 kg filled and less warmth on a careful night (4.4 h in band instead of 5.3).
6. **What it costs: 173 kJ of storage, 801 g, £4.75–9.80.** The wax stores 133 kJ latent plus 40 kJ sensible, 173 kJ in all. The water holds 212 kJ above the melting point at 80 °C and 300 kJ at 95 °C. The design adds 801 g (+44%, 2.63 kg filled). The bill of materials is £4.75–9.80, which means roughly £14–29 retail.

## Honest assessment

- [Certain] While solid wax lies between the melt front and the skin, the outer surface cannot exceed the melting point. That is thermodynamics. It is a ceiling only while wax lasts, and 43.8 °C is 0.8 K above the 8-hour line, so it is not a safe ceiling for skin that sheds almost no heat.
- [Certain] The plain bottle's contact temperature is set by a fixed resistance, so it tracks the water: too hot early, cooler late.
- [Likely] In the model, on the as-instructed night, a plain cover three times thicker than fleece does as well as the jacket (42.7 °C peak, 9.0 h in band). The case for the jacket rests on the other nights.
- [Likely] The jacket melts through on skin that sheds little heat when the fill is hotter or fuller than instructed. In the model that happens kettle-hot above a tissue resistance of 0.068, and with poor circulation plus a fill to the top (46.3 °C) or boiling water (44.0 °C). On pressed tissue with no blood flow it is at the edge. A 10 mm jacket would cover these cases; the design as drawn does not.
- [Likely] The original's contact temperatures are modelled, not measured. I found no published measurement against skin. Onishi and colleagues (2010) measured a bottle's surface in a bed at up to 44.5 °C, and 110 min above 43 °C, for a 60 °C fill. That probe had no skin drawing heat from it, but it hints the plain bottle may be worse than my 42.9 °C at 60 °C, which is only 0.07 K under the line. The bench test's control runs measure it, and if the plain bottle peaks below 45 °C on night A, it is less bad than I say.
- [Likely] The burn evidence, with caveats. The figure of 594 a year is England and Wales, from the International Burn Injury Database (*Burns* 2024). The cause split varies: one unit's 85 patients (2004–13) were bursts 48.2%, spills 33.0%, contact 18.8%; another's 80 (2017–18) were contact 51.3% and scalds 47.5%. So contact is a fifth to a half of these burns, roughly 112 to 305 a year, and it includes the deepest ones, in people with sensory deficits.
- [Likely] The plateau lands at 40–42 °C for most skin. The tissue resistance is the decisive unknown. For warm, well-perfused skin the plateau bottle peaks at only 39.4 °C, with 3.7 h in band, worse than the thick cover's 7.0 h.
- [Likely] Seal lines don't run hot. The tubes are offset in two layers so no seal goes straight through. A 1-D bound that ignores sideways spreading gives 41.3 °C as instructed but 44.2 °C kettle-hot. The test has a probe on a seal line.
- [Likely] The worst case I designed around (poor circulation and kettle-hot) is at its limit: 94% melted. Doubling the liquid wax's conductivity for convection, leaving the sleeve off, or crushing the felt to half its resistance pushes it to between 43.1 and 43.6 °C, which is over 43 but well under 48.
- [Likely] It adds risks of its own. Empty, it weighs 1.23 kg against 0.43 kg, so it is harder to hold steady while pouring. Spills while filling are a third of burns in one series. A failed seam would leak lauric acid, which can seriously damage eyes (H318) and which some suppliers class as a skin irritant (H315).
- [Speculative] Kettle-hot water left two hours in an empty bed melts all the skin-side wax while the water is still 55 °C. The first touch then reaches 46.3 °C, for 4 min above 43 °C.
- [Speculative] All prices except the lauric acid benchmark (Argus, about $2,150/t FOB) and the bottle's retail listings.
- [Speculative] Whether anyone wants a hot water bottle that never feels hot. That can only be felt, not computed.

**Prior art.** US 11,090,187 B2, "Hot water bottle containing phase change material" (Ohmer; WFI Wärmflascheninnovation UG; listed as expired for unpaid fees). I read the full text. Every independent claim needs sodium acetate trihydrate in a film housing inside the water, entirely in contact with it, not removable, at 2:1 to 7:1 by volume, so the claims do not cover a jacket. Its description is broader: the store may sit on the wall or outside the water space, with melting points from above 36 °C. US 7,041,123 B2 (Arizant, 2006) caps a chemical warming pack for vulnerable skin with a 42 °C paraffin and warns of "burn through". The Burnout mug (ThermAvant, NASA spinoff) does the same thing for coffee with a wax between vacuum walls; its 140 °F melting point comes from retail sources I could not verify. So phase-change material in a hot water bottle, a wax cap between a heat source and vulnerable skin, and the melt-through problem are all known. What may be new is narrower: a removable lauric acid jacket on both faces of an ordinary bottle, in offset cells, with a felt spacer, and its melt-through limits worked out. In the same model, the patent's inside placement, idealised, still peaks at 43.3 °C as instructed, because it caps the water and leaves the skin to the cover.

**Pre-mortem.** The page lists ten failure modes, each with its own probability. They are separate estimates, not shares of 100%. The biggest is "lukewarm" at 40%. Then come weight and price at 25% each, and tissue that is better perfused than modelled at 20%, as is melt-through in real use. If the ten were independent, the chance of surviving all of them would be 11%.

**My probabilities.** For most people: better than the plain bottle, 30%; better than a plain bottle in the thick cover, 20%. It is heavier, dearer and less hot, and most people are never burned. For people who can't feel or can't move away from heat (older people, people with diabetic neuropathy, anyone using it on a numb back): less harmful than a plain bottle, 70%; less harmful than the thick cover, 60%. Less harmful is not safe: as drawn it still melts through for them on kettle-hot or overfilled nights. It is worth the bench test below. It is not yet worth a product.

## The first test

**A skin phantom on the kitchen table: three nights, about £215, or £135 if you own a sous-vide stick and a thermocouple logger.** The phantom is a 12 L box of water held at 37 °C by the sous-vide stick, with an acrylic plate floating on top. 5 mm of acrylic plus the bath's film is 0.0283 m²K/W, standing in for normal tissue. A 10 mm plate, 0.0546 m²K/W, stands in for poor circulation, and a 20 mm plate, 0.1073 m²K/W, for skin that sheds little heat. Hand-make one jacket from lauric acid and impulse-sealed layflat tube. Lay the bottle jacket-down on the plate, put a folded duvet on top, and log for 9 h. One thermocouple goes over a tube centre, one over a seal line, and one in the water.

- **Night A**, the intended night: 80 °C, 1.4 L, 5 mm plate. The model predicts a 40.5 °C peak and 8.9 h in the 38–43 °C band.
- **Night B**, the bad night: 95 °C, 1.4 L, 10 mm plate. The model predicts a 42.2 °C peak and 8.9 h in band.
- **Night C**, the instructed fill on skin that sheds little heat: 80 °C, 1.4 L, 20 mm plate. The model predicts 64% melted and a 42.6 °C peak.
- **Pass:** on nights A and B neither probe exceeds 43.0 °C, and on night A the tube probe's hours in the 38–43 °C band are within 0.5 h of the thick-cover control run on the same rig, or better.
- **Kill:** either probe exceeds 43.8 °C on any night, or night A gives fewer hours in band than the plain bottle in fleece on the same rig. 43.8 °C is the melting point, which a working jacket can't exceed while it has solid wax, so crossing it means melt-through or a hot seal line. Fewer hours in band than the plain bottle means it is warm and safe for less of the night than what it replaces, at 0.8 kg more.
- Warmth is judged against same-rig controls on purpose. Late in the night the jacket holds the skin just above 38 °C, so a 10% error in the acrylic's conductivity cuts the model-perfect jacket's hours in band from 8.9 to 6.8. The thick-cover control moves with it, to 7.0, so the comparison holds where an absolute line would not.
- Anything between is inconclusive: fix the build and rerun once, and a second inconclusive counts as a kill.
- As a measurement, not a verdict, run night C once more from the kettle. The model says the wax melts through after 1.8 h and the skin side reaches 45.0 °C. A much earlier melt-through means the melt-through map is optimistic.
- A shelf test alongside: cycle sealed tubes 200 times between 20 and 60 °C, then check weight, seals, film and melting plateau.

`check.mjs` asserts that the design performing exactly as modelled passes. It also asserts that it still passes with the phantom off by ±10% in acrylic conductivity, ±50% in bath film, or ±3 °C in room temperature, or with 60–100% contact. And it asserts that the test kills the designs it should. The plain bottle peaks at 49.7 °C on night B in the thick cover. A jacket whose filler doesn't melt reaches 49.5 °C, and a seal line as bad as the 1-D bound reaches 48.2 °C. A jacket without the felt spacer peaks at 43.5 °C, which is inconclusive.

If it passes, the next test can only be felt. Five hot-water-bottle users each get a plain bottle and a plateau bottle, sleeved alike, for a week at home. Kill it if fewer than two keep reaching for the plateau one.

## Where it could go next

- For people who can't feel or move away from heat, the 10 mm jacket, still filled at 80 °C. For the few whose skin sheds almost no heat, a wax melting near 42 °C, at about 1 K less warmth for everyone.
- If seal lines read hot on the bench, switch to a form-stable sheet: lauric acid held in a polymer or silica matrix, which needs no cells. It costs some latent heat and money.
- A lighter version for feet: a 1 L bottle with proportionally less wax on both faces.
- Sell the jacket as a sleeve for the bottles people already own.

## Files and verification

- `index.html` is the dossier. It carries `model.js` inline and unchanged.
- `model.js` is the model and the single source of every number.
- `build.mjs` inlines the model and fills each tagged number in the page.
- `check.mjs` does five things:
  - It recomputes the headline numbers with a separately written solver: a smeared phase change instead of a sharp one, 10 wax slices instead of 6, a 1 s time step, its own tissue slab (tested against the exact solution for heat soaking into tissue), its own thermal dose, and its own bisection for the thick cover.
  - It re-derives the closed forms from re-typed constants.
  - It checks the units of every formula with a small dimensional-analysis kernel.
  - It checks energy closure and the stability of the explicit scheme, asserts the test's verdicts and the melt-through claims, and fails if the page or this README drifts from the model.
  - If Playwright is available, it drives the live calculator and compares its output with the model.

```
node ideas/28-plateau-bottle/build.mjs   # after editing model.js
node ideas/28-plateau-bottle/check.mjs
node tools/check.mjs ideas/28-plateau-bottle
```

## Revision note

An independent reviewer rebuilt the model in separate code. It reproduced every headline number and found real problems. I re-checked each one with my own runs and sources, and all of them held, with one qualification: the reviewer's 0.18 m²K/W for tissue with no blood flow is its resistance after four hours. Modelled with its heat capacity, pressed tissue leaves a kettle-filled jacket at the edge of melting through (99%) rather than well past it.

- **The "hard ceiling" was wrong.** I had written that 43.8 °C was the ceiling even if the tissue carried no heat away. It holds only while solid wax is left. The page now maps melt-through by fill and tissue resistance, models pressed tissue with no blood flow, gives the thermal dose of sitting at the melting point, and sizes the wax (10 mm for people who can't feel heat). The bench test gained night C, and the tagline no longer says you can hug it all night.
- **The nights stopped just short of the failures.** Four nights were added, two of them the reviewer's double misuses. The tally above 43 °C moved from 8 / 6 / 0 of 9 to 12 / 10 / 2 of 13, and the jacket's worst night from 42.3 to 46.3 °C. The sensitivity table gained crushed felt and a warm room.
- **The burns evidence was one-sided.** "Contact is the smallest share" ignored the 51.3% contact share in a paper the page already cited. Both series are now shown, with a range of 112 to 305 contact burns a year. An unsourced line about which nights put people in burns units is gone.
- **The prior art was misdescribed.** I had not read the Ohmer patent's claims. They need sodium acetate trihydrate inside the water, so they do not cover a jacket. Its description and a 2006 warming-pack patent already disclose much of what I had called new.
- **The probabilities.** The 75% for vulnerable users is now 70% for "less harmful than a plain bottle", with 60% against the thick cover and 20% against the thick cover for most people. Melt-through in the pre-mortem rose from 10% to 20%, and "fixes the smallest share" fell from 10% to 5%.
- **Smaller fixes:** a leak's skin hazard (H315, and how hot the wax gets), a cycling test for the film, and a Japanese measurement suggesting the plain bottle at 60 °C may be worse than modelled.
