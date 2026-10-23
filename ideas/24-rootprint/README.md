# Rootprint
> A passive planter cartridge that makes an underground water budget visible, with a speculative colour strip for one small piece of chemistry.

**Kind:** product concept / engineering explorable
**Run:** Open `index.html` directly in a browser. No server, build, packages, or network needed.
**Made by:** Wick & Witness / Codex

## What it is

Rootprint is a proposed physical product explored through a working browser prototype: a reservoir cartridge, capillary wick, translucent reserve window, and a replaceable indicator tab that would be isolated from the roots. The web page is a design bench rather than an actual sensor. Change capacity, wick flow and root demand, then move through twenty-one simulated days. The cutaway and water ledger stay linked.

The pH slider illustrates how an ideal single acid/base indicator changes its molecular population. It is independent of the water simulation. Neither the slider nor its colour is a measurement of a real plant.

## Why I made it

Much plant-care technology hides the organism behind a notification. I wanted to imagine the opposite: a quiet object that makes a few physical facts legible. A window for what is left; a wick for how quickly it can move; a replaceable patch that asks a chemical question. It should invite observation, without pretending a plant can be summarized by one glowing number.

## How it works

- The initial root zone contains 140 mL of water and can hold 180 mL. Reserve capacity, maximum wick delivery and constant root demand are adjustable.
- Each hourly time step transfers `min(reserve, wickRate × (1 − soilWater / soilCapacity) × dt, remainingSoilCapacity)`. This is a phenomenological delivery law chosen for the prototype: a dry medium draws more than a wet one. It is not derived from a measured wick.
- Surface evaporation removes up to 8 mL/day, then roots draw up to their assumed demand. Any requested root uptake that cannot be delivered is recorded as unmet supply. The displayed first gap is the start of the first hourly interval with unmet demand, not a predicted wilting time.
- Every step conserves initial water: **reservoir + root-zone storage + cumulative root uptake + evaporation**. The test suite checks this across all recorded time steps, including a severed wick, no water and no demand.
- For the chemical sketch, `baseFraction = 1 / (1 + 10^(pKa − pH))`, with an illustrative pKa of 6.8. The acid and base colours are an invented amber/blue blend. This is the ideal Henderson–Hasselbalch population relationship; the displayed RGB interpolation is not calibrated absorbance spectroscopy.
- Capacity and rate units are mL and mL/day. No data is saved or sent anywhere. Sliders work by keyboard and touch, and the diagram has a text description. Reduced-motion preference stops the wick animation.

## Honest assessment

- **[Certain]** The prototype runs offline and its accounting model conserves water to floating-point tolerance. It separates a finite reservoir from flow-limited delivery: a full reserve can coexist with a supply gap when the wick is too narrow.
- **[Certain]** pH alone cannot establish nutrient sufficiency, disease status or overall plant health. No plant-health diagnosis is made. There is no real sensor or reading here.
- **[Certain]** No physical Rootprint cartridge has been fabricated, calibrated, tested for durability, or tested on plants. The name and design do not carry a novelty or patentability claim.
- **[Likely]** Constant water demand and fixed evaporation are too simple for a real windowsill. Light, temperature, substrate, root growth, salts, wick height, biofilms and humidity would matter.
- **[Speculative]** A physically isolated, replaceable indicator tab could remain readable without affecting the roots. Its chemistry, optical stability, fouling, leaching risk and useful interpretation would require experiments. No specific indicator material is proposed or prescribed.
- **[Speculative]** This combination of quiet readouts could help people observe their plants more closely. That is a product hypothesis, not a user-study result.

## Where it could go next

Build a transparent inert test cartridge and weigh the reservoir and root-zone medium over time to fit the wick-delivery curve. Test with an unplanted substrate first, then compare planted and unplanted controls. A useful next prototype would show uncertainty bounds and a manual observation log, before adding any electronics or claims about plant health.

## Verification

`node --test ideas/24-rootprint/model.test.mjs`

`node tools/smoke.mjs ideas/24-rootprint`
