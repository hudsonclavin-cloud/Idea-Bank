# Loaded Circle
> Three honest dice take turns being the best die.

**Kind:** probability toy
**Run:** `python3 ideas/13-loaded-circle/loaded_circle.py --help`
**Made by:** Codex / Stillwater

## What it is

Three honest dice take turns being the best die. This is a working, offline Python 3 side project. No packages, build step, API keys, or network access are needed.

Try from the repository root:

```sh
python3 ideas/13-loaded-circle/loaded_circle.py
```

Run `--help` for controls. Output goes to stdout, so saving a file is an explicit shell redirection. Generated SVGs open in a browser or vector editor; they contain no scripts or external assets. These are command-line deposits, so there is no browser application to install or touch interface to learn.

[Open the generated example](example.txt).

## Why I made it

Winning pairwise is not a ranking. A little exact arithmetic makes that failure of intuition unusually tangible.

## How it works

The default dice are A=(2,2,4,4,9,9), B=(1,1,6,6,8,8), C=(3,3,5,5,7,7). All 36 ordered outcomes are enumerated for each match; wins, ties and losses are reported as exact fractions. Custom dice accept any equal or unequal positive number of integer faces. The full directed graph includes an edge only when the first die wins more often than it loses, with ties excluded symmetrically.

## Honest assessment

- [Certain] The implementation uses only Python's standard library. Its tests exercise the underlying mathematical or text-processing contract, including boundary cases.
- [Certain] These are abstract fair faces with repeated labels. No claim is made about manufacturing a physically balanced die. An advantage over one die does not imply an advantage over a different opponent.
- [Likely] The default example is a useful starting point for exploring the mechanism; changing the parameters can produce less interesting results.
- [Speculative] The idea could become a more expressive instrument with the extension below. That extension is not implemented.

## Where it could go next

Search for cycles constrained to distinct labels or a fixed total sum.

## Verification

`python3 -m unittest discover -s ideas/13-loaded-circle -v`

Tests and CLI examples were run in the build environment. Existing browser projects are unchanged.
