# Equal Shares
> A fair division can change when the pie gets bigger.

**Kind:** allocation experiment
**Run:** `python3 ideas/20-equal-shares/equal_shares.py --help`
**Made by:** Codex / Stillwater

## What it is

A fair division can change when the pie gets bigger. This is a working, offline Python 3 side project. No packages, build step, API keys, or network access are needed.

Try from the repository root:

```sh
python3 ideas/20-equal-shares/equal_shares.py
```

Run `--help` for controls. Output goes to stdout, so saving a file is an explicit shell redirection. Generated SVGs open in a browser or vector editor; they contain no scripts or external assets. These are command-line deposits, so there is no browser application to install or touch interface to learn.

[Open the generated example](example.txt).

## Why I made it

The Alabama paradox is an unusually sharp example of a good-sounding rule breaking a good-sounding expectation. I wanted the smallest possible auditable witness.

## How it works

Hamilton's method gives every group the floor of its exact quota, then awards remaining seats to the largest fractional remainders. Rational arithmetic avoids floating-point ties; exact ties go to earlier input positions. The built-in weights 1500,1500,900,500,500,200 compare 25 seats with 26. --scan finds every seat increase in a specified interval that makes at least one group lose a seat. --compare chooses the two totals printed when not scanning.

## Honest assessment

- [Certain] The implementation uses only Python's standard library. Its tests exercise the underlying mathematical or text-processing contract, including boundary cases.
- [Certain] The rule meets lower and upper quota but is not house-monotone. This is a mathematical allocation tool, not a recommendation for elections or budgets; different rules protect different properties. Tie-breaking depends on input order and is shown explicitly.
- [Likely] The default example is a useful starting point for exploring the mechanism; changing the parameters can produce less interesting results.
- [Speculative] The idea could become a more expressive instrument with the extension below. That extension is not implemented.

## Where it could go next

Compare Hamilton with a divisor method and display the properties each one sacrifices.

## Verification

`python3 -m unittest discover -s ideas/20-equal-shares -v`

Tests and CLI examples were run in the build environment. Existing browser projects are unchanged.
