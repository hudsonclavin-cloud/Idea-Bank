# Equal Shares
> A fair division can change when the pie gets bigger.

**Kind:** allocation experiment
**Run:** Open `index.html` in a browser. No installation, server or network required.
**Made by:** Codex / Stillwater

## What it is

An interactive civic arithmetic bench. Enter positive group weights, choose a number of seats, and compare that division with a pie one seat larger. The before/after bars mark any group that loses a seat. The table leaves every exact quota, floor, fractional remainder and leftover-seat award visible, so the surprise can be audited rather than merely announced.

The default Alabama witness compares 25 with 26 seats: groups D and E each lose one seat, even as the total increases. Move the seat slider, change the weights, reset the witness, or scan all increases between totals 1 and 100. Native controls work with keyboard and touch, and the page fits a 390 px phone. State exists only in the current tab; nothing is saved or sent.

The original Python terminal interface remains optional:

```sh
python3 ideas/20-equal-shares/equal_shares.py
python3 ideas/20-equal-shares/equal_shares.py --scan 100
```

[Open the original terminal example](example.txt).

## Why I made it

The Alabama paradox is an unusually sharp example of a good-sounding rule breaking a good-sounding expectation. I wanted the smallest possible auditable witness. The browser version puts that witness beside the actual arithmetic: fairness is a set of choices, and different choices can conflict even when every calculation is right.

## How it works

Hamilton's method assigns each group the floor of its exact quota, then awards the remaining seats in descending order of fractional remainder. The browser computes every numerator, denominator and remainder with JavaScript `BigInt`; no floating-point comparison decides a tie. Exact ties go to earlier groups in the input list. Fractions in the table reduce with the Euclidean algorithm. The original Python version uses `Fraction`, and a test compares both implementations on shared cases.

The browser accepts 1–12 groups, each a positive whole-number weight within JavaScript's safe integer input range. Weight sums and products become `BigInt` before arithmetic. The interactive seat total is 1–100, and the pure model supports totals through 10,000. The visualization scales bar lengths for display only; integer arithmetic determines every allocation. Scans report each comparison from 1→2 through 99→100.

`model.js` is shared by the classic-script browser page and Node tests. `app.js` handles the controls, chart and error messages. Invalid weights leave the previous valid drawing intact and display an explanation; submitted strings never become HTML. The page uses no external libraries, fonts, images or network calls.

## Honest assessment

- **[Certain]** Five JavaScript tests check the exact Alabama witness, quota and total invariants across hundreds of allocations, exact ties at very large weights, invalid inputs, fraction reduction and agreement with the retained Python implementation. The original Python tests remain unchanged.
- **[Certain]** Hamilton's rule satisfies lower and upper quota, but is not house-monotone: a larger pie can make a group lose a seat. The example is an arithmetic property, not a rounding accident.
- **[Certain]** Earlier input positions win exact remainder ties. Changing the order of equal groups can therefore change who receives a leftover seat.
- **[Certain]** The bars compare two allocations; they do not encode uncertainty, political legitimacy or a recommendation for an election or budget. The code does not compare other allocation methods.
- **[Likely]** Seeing the arithmetic and the losing bars together makes the paradox easier to inspect than a text report. Its educational usefulness has not been measured.
- **[Speculative]** A companion divisor-method view could make the trade-offs between quota and monotonicity visible. That comparison is not implemented.

## Where it could go next

Compare Hamilton with a divisor method and show which properties each protects. Add a printable one-page witness with exact arithmetic and an explicit tie-order legend.

## Verification

From the repository root:

```sh
node --test ideas/20-equal-shares/model.test.mjs
python3 -m unittest discover -s ideas/20-equal-shares -v
node tools/check.mjs ideas/20-equal-shares
```
