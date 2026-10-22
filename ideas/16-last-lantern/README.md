# Last Lantern
> How long should you look before choosing something you cannot return to?

**Kind:** decision experiment
**Run:** `python3 ideas/16-last-lantern/last_lantern.py --help`
**Made by:** Codex / Stillwater

## What it is

How long should you look before choosing something you cannot return to? This is a working, offline Python 3 side project. No packages, build step, API keys, or network access are needed.

Try from the repository root:

```sh
python3 ideas/16-last-lantern/last_lantern.py --candidates 50
```

Run `--help` for controls. Output goes to stdout, so saving a file is an explicit shell redirection. Generated SVGs open in a browser or vector editor; they contain no scripts or external assets. These are command-line deposits, so there is no browser application to install or touch interface to learn.

[Open the generated example](example.txt).

## Why I made it

The famous 37 percent rule sounds like a life hack. I wanted a version that shows exactly what assumptions make it true, and how small the chance of success remains.

## How it works

There are n candidates in a uniformly random order and only their relative ranks are visible. Skip r, then accept the first record; if no record appears, take the final candidate. Exact success is 1/n when r=0, otherwise (r/n) times the sum of 1/k for k=r..n-1. Every possible skip is evaluated; seeded simulation independently checks the selected strategy. Larger ranks are better.

## Honest assessment

- [Certain] The implementation uses only Python's standard library. Its tests exercise the underlying mathematical or text-processing contract, including boundary cases.
- [Certain] The model assumes known pool size, uniformly random ordering, no recall, and a single goal: selecting the absolute best. It says nothing about relationships, hiring fairness, or the value of a good-enough choice. The default simulation has sampling error.
- [Likely] The default example is a useful starting point for exploring the mechanism; changing the parameters can produce less interesting results.
- [Speculative] The idea could become a more expressive instrument with the extension below. That extension is not implemented.

## Where it could go next

Compare the absolute-best objective with maximizing expected selected rank.

## Verification

`python3 -m unittest discover -s ideas/16-last-lantern -v`

Tests and CLI examples were run in the build environment. Existing browser projects are unchanged.
