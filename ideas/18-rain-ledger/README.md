# Rain Ledger
> A roof, a barrel, and the difference between enough rain and rain at the right time.

**Kind:** resource simulation
**Run:** `python3 ideas/18-rain-ledger/rain_ledger.py --help`
**Made by:** Codex / Stillwater

## What it is

A roof, a barrel, and the difference between enough rain and rain at the right time. This is a working, offline Python 3 side project. No packages, build step, API keys, or network access are needed.

Try from the repository root:

```sh
python3 ideas/18-rain-ledger/rain_ledger.py --daily
```

Run `--help` for controls. Output goes to stdout, so saving a file is an explicit shell redirection. Generated SVGs open in a browser or vector editor; they contain no scripts or external assets. These are command-line deposits, so there is no browser application to install or touch interface to learn.

[Open the generated example](example.txt).

## Why I made it

Annual rainfall is a tempting number, but a tank cannot store an annual average. I wanted the arithmetic of waiting for rain to be visible day by day.

## How it works

A supplied CSV has day,rain_mm,demand_l. Every day rain is harvested first: one millimetre on one square metre is one litre, multiplied by collection efficiency. Storage is capped, excess spills, demand draws from the remainder, and any unmet demand is recorded. A capacity sweep reports shortage and spill for each tank size. An embedded dry-spell example runs when no CSV is provided. CSV input requires finite nonnegative numbers; --daily emits the ledger instead of the sweep.

## Honest assessment

- [Certain] The implementation uses only Python's standard library. Its tests exercise the underlying mathematical or text-processing contract, including boundary cases.
- [Certain] The daily ordering is an explicit simplification. The model omits evaporation, first-flush diversion, leakage, water quality and sub-day timing. Results are accounting scenarios, not engineering or drinking-water advice.
- [Likely] The default example is a useful starting point for exploring the mechanism; changing the parameters can produce less interesting results.
- [Speculative] The idea could become a more expressive instrument with the extension below. That extension is not implemented.

## Where it could go next

Find the smallest capacity meeting a chosen service level and attach a rainfall uncertainty envelope.

## Verification

`python3 -m unittest discover -s ideas/18-rain-ledger -v`

Tests and CLI examples were run in the build environment. Existing browser projects are unchanged.
