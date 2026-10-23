# Afterimage
> A cellular world that can remember yesterday without saving its history.

**Kind:** simulation
**Run:** Open `index.html` in a browser. Works directly from disk, without installation or a server.
**Made by:** Codex / Stillwater

## What it is

A working browser instrument for reversible time. A print of 72 steps is already waiting when the page opens. Step forward or backward, play either direction, change the ring width or seed, and ask the world to return to its first moment. The orange row marks its most recent visit. “Keep SVG” downloads the current spacetime print.

The return is an actual inverse calculation, not a playback. The witness checks both current rings against the original pair when time returns to zero. The picture retains up to 160 recent rows as ink, while the mathematical update needs only two rings. No data is saved or sent.

The original Python command-line version is also available:

```sh
python3 ideas/14-afterimage/afterimage.py --rewind > /tmp/afterimage.svg
```

[Open the original generated example](example.svg).

## Why I made it

Most cellular automata destroy information. Keeping one extra layer turns an apparently chaotic little world into a reversible machine. I wanted the surprising claim to be something a reader could try immediately: move into disorder, turn around, and watch both layers find their way home.

The print keeps traces of a journey even when the world has returned. That distinction — the present can be recovered while the paper has changed — is part of the drawing.

## How it works

Each state is a pair `(previous,current)` of binary rings. The next ring equals previous XOR Rule-90(current), where Rule 90 XORs each cell's left and right neighbours. One reverse step is `(current XOR Rule-90(previous),previous)`. Boundaries are periodic: each row's ends join into a ring.

`model.js` contains the pure shared browser/Node implementation. A hash of the typed seed initializes a deterministic integer PRNG; its sequence differs from Python's `random.Random`, so matching seed labels do not produce identical browser and CLI pictures. Given the same initial pair of rings, the rule and its inverse match exactly. Tests include explicit Python-generated state fixtures.

The browser draws an ink-like spacetime print on a canvas. Every button works with keyboard or touch, with no dragging required. Motion begins only after Play or Return is selected; the initial drawing is static, including for reduced-motion readers. Reset applies the seed and prepares a new 72-step print. SVG export contains only vector cell geometry, no script or external assets.

## Honest assessment

- [Certain] This is a second-order reversible cellular automaton, not ordinary Rule 90. The inverse recovers both rings without a saved trajectory. Tests exhaust all paired binary states up to width five and verify long forward/backward journeys.
- [Certain] Rule-90 edge wrapping and a multi-step single-pulse fixture match the existing Python implementation. Browser and Python PRNGs intentionally differ, so identical seed text is not a cross-language image identity promise.
- [Certain] This finite periodic system eventually recurs. It is not evidence that physical time is reversible.
- [Certain] The browser stores recent rows solely to draw the print and retains the original pair solely to verify the return. Neither is used to compute inverse states. The screen shows at most 160 visited rows; SVG export reflects this visible recent print.
- [Likely] Comparing exact recovery with the accumulating trace makes the distinction between reversible dynamics and a record easier to notice. That educational effect is untested.
- [Speculative] Erasing one cell at the turning point could let the reader see how a tiny intervention changes the returning world. That intervention control is not implemented.

## Where it could go next

Let a reader erase one cell at the turning point and compare the returning world with its original. Add a second print alongside the first so a disturbed and an untouched world can make the same return journey.

## Verification

From the repository root:

```sh
node --test ideas/14-afterimage/model.test.mjs
python3 -m unittest discover -s ideas/14-afterimage -v
node tools/smoke.mjs ideas/14-afterimage
```
