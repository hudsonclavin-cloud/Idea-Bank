# Rain Ledger
> A roof, a barrel, and the difference between enough rain and rain at the right time.

**Kind:** resource simulation
**Run:** Open `index.html` in a browser. No installation, server or network connection needed.
**Made by:** Codex / Stillwater

## What it is

A working catchment bench for a small roof and a finite barrel. Set roof area, collection efficiency and tank capacity, then read a day of the water account. A schematic barrel shows the remaining reserve; the chart shows incoming harvest, stored water and days with unmet demand. The six capacity comparisons reveal how a larger barrel changes shortage under exactly the same weather.

Paste your own `day,rain_mm,demand_l` CSV, or compare a dry spell with daily drizzle. **Apply the record** validates it before replacing the active scenario. **Save ledger** downloads the actual computed daily account as CSV. Expand **Open the daily arithmetic** to inspect every harvest, delivery, spill and remainder. No input is saved automatically or transmitted. Every scenario begins with an empty barrel.

Native range controls, buttons and a text area work with keyboard and touch. The interface fits a 390 px phone and opens directly from disk. The original Python tool remains available as an optional terminal interface:

```sh
python3 ideas/18-rain-ledger/rain_ledger.py --daily
```

[Open the original generated example](example.txt).

## Why I made it

Annual rainfall is a tempting number, but a tank cannot store an annual average. I wanted the arithmetic of waiting for rain to be visible day by day. A full barrel on Monday does not promise a drink on Friday. The little roof drawing is there to make the numbers feel like a place, rather than a spreadsheet floating in the abstract.

## How it works

The browser and retained Python model use the same daily order. Rain is harvested first: one millimetre on one square metre gives one litre, multiplied by collection efficiency. Storage is capped and excess spills. Demand then draws from what remains, leaving either stored water or an unmet quantity. The model records all six numbers for every day.

`model.js` contains a pure water-accounting model, a strict CSV reader supporting quoted fields and doubled quotes, and a CSV exporter. `app.js` links those computations to native controls, the SVG schematic, chart, capacity comparisons and an explicit download. CSV input requires the three named headers, finite nonnegative quantities and a nonempty day label. The browser limits input to 100,000 characters and 3,650 rows; individual daily quantities may not exceed one billion. These are interface bounds, not physical predictions. Large numbers on the screen use compact notation; the downloaded CSV preserves their numeric values.

The day scrubber selects a row of the existing calculation; it does not change the weather. The chart's dashed horizontal line is the chosen capacity. The roof and barrel are explanatory drawings, not dimensioned construction plans.

## Honest assessment

- **[Certain]** Six JavaScript tests check cell-by-cell agreement with the retained Python default, daily water and demand conservation, unit conversion, zero capacity, capacity monotonicity, quoted CSV round-tripping and invalid-input rejection. Four original Python tests remain intact.
- **[Certain]** The daily ordering is an explicit simplification. The model omits evaporation, first-flush diversion, leakage, water quality and sub-day timing. Results are accounting scenarios, not engineering or drinking-water advice.
- **[Certain]** Both interfaces run locally without packages or network calls. Browser inputs live only in tab memory, and saving is an explicit CSV download.
- **[Certain]** In the browser the roof and barrel ranges are deliberately small: 1–100 m² and 0–500 L. The model function supports other nonnegative capacities. The Python CLI remains useful for larger batch scenarios.
- **[Likely]** Comparing intermittent rain with daily drizzle makes the role of timing easier to see. The illustration is an educational aid whose usefulness has not been evaluated.
- **[Speculative]** The next extension could find the smallest barrel meeting a chosen service level under several weather records. No reliability guarantee or climate uncertainty calculation is implemented.

## Where it could go next

Find the smallest capacity meeting a chosen service level and attach a rainfall uncertainty envelope. A comparison between the current harvest-first rule and a demand-first day could expose how much a coarse daily timestep changes the conclusion.

## Verification

From the repository root:

```sh
node --test ideas/18-rain-ledger/model.test.mjs
python3 -m unittest discover -s ideas/18-rain-ledger -v
node tools/check.mjs ideas/18-rain-ledger
```
