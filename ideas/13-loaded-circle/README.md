# Loaded Circle
> Three honest dice take turns being the best die.

**Kind:** probability toy
**Run:** Open `index.html` directly in a browser. No installation, server or network needed.
**Made by:** Codex / Stillwater

## What it is

Three editable dice, an exact graph of their pairwise advantages, and a table of every possible encounter. The default dice form a circle: A is more likely to beat B, B is more likely to beat C, and C is more likely to beat A. There is no single best choice independent of the opponent.

Open the page, change the comma-separated faces, and choose **Reconsider the hierarchy**. Inspect A against B, B against C, or C against A; **Swap sides** reverses the selected matchup. The outcome table shows repeated face labels separately because each physical face is equally likely. Three presets compare a nontransitive circle, an ordinary ladder and three identical dice. Invalid entries produce an inline explanation while preserving the previous valid calculation.

All interactions work with native buttons and text inputs on a keyboard or 390 px phone. No information is saved or transmitted. The original Python command-line version remains available for scripting:

```sh
python3 ideas/13-loaded-circle/loaded_circle.py
```

[Open the original generated text example](example.txt).

## Why I made it

Winning pairwise is not a ranking. A little exact arithmetic makes that failure of intuition unusually tangible. I wanted the misleading intuition to be visible in a closed loop, and the evidence to be close enough that one can count every square personally.

The browser version lets the reader change the dice rather than trusting a picture of a result. It is an instrument for breaking the circle as much as finding it.

## How it works

The default dice are A=(2,2,4,4,9,9), B=(1,1,6,6,8,8), C=(3,3,5,5,7,7). All 36 ordered outcomes are enumerated for each pairing. Twenty wins and sixteen losses reduce to a win probability of 5/9. Wins, ties and losses are integer counts; the displayed fraction is reduced with the Euclidean algorithm. No sampled rolls or floating-point probabilities determine the graph.

An arrow points from the die with more winning outcomes to the one with more losing outcomes. A tied advantage is a dashed edge without an arrow. The graph compares wins with losses, so ties are treated symmetrically. The selected pairing also exposes the complete Cartesian product as a coloured table.

`model.js` implements the bounded parser, exact counts and graph edges. The same pure module runs in the browser and Node tests. Browser dice accept 1–12 faces each, with integer labels between −9999 and 9999. This keeps the complete outcome table legible and arithmetic exact. The original Python tool supports larger dice and more than three opponents.

## Honest assessment

- **[Certain]** The browser version works directly from disk and uses no dependencies, build step, external assets, API keys or network calls. The Python tool uses only the standard library.
- **[Certain]** JS tests verify the default exact 5/9 cycle, outcome partitioning, symmetry under reversal, tied advantages, fraction reduction and invalid inputs. Existing Python tests remain intact and pass.
- **[Certain]** These are abstract equally likely faces with repeated labels. No claim is made about manufacturing physically balanced dice. An advantage over one die does not imply an advantage over a different opponent.
- **[Certain]** Browser inputs are limited to three dice of at most twelve faces; this is a deliberate interface limit, not a theorem about nontransitive dice.
- **[Likely]** The default example and complete table make the paradox easier to inspect than a list of percentages. Their educational usefulness has not been measured.
- **[Speculative]** Searching for cycles constrained to distinct labels or a fixed sum could reveal other appealing designs. Search is not implemented.

## Where it could go next

Search for cycles constrained to distinct labels or a fixed total sum. Add a mode where a reader chooses first and the page explains an opponent's best reply, including cases where no die has an advantage.

## Verification

From the repository root:

```sh
node --test ideas/13-loaded-circle/model.test.mjs
python3 -m unittest discover -s ideas/13-loaded-circle -v
node tools/check.mjs ideas/13-loaded-circle
```

Desktop and 390 px phone smoke checks cover the working browser page. The original CLI and generated text example are preserved.
