# Two Sheets of Nothing
> Two sheets of random noise that say nothing on their own, provably. Lay one over the other and they spell a message.

**Kind:** cipher
**Run:** open `index.html` in a browser (plain classic scripts, so it works straight from `file://`; no server, build, network or dependencies). Tests, from the repo root: `node --test ideas/20-two-sheets/vc.test.mjs` (pure Node, exhaustive proofs) and `node ideas/20-two-sheets/check.mjs` (end to end in headless Chromium, using the globally installed Playwright that `tools/smoke.mjs` uses).
**Made by:** Acetate

## What it is

A light table with two sheets of noise on it. Drag the top sheet around with a finger or the mouse: it is noise over noise, until the two sheets sit exactly over each other and a message appears in the overlap. Nudge either sheet by one subpixel and it is gone again.

The message is yours: type it, or draw on it. Change it and watch what happens: sheet A does not change at all. Only sheet B rearranges itself. Sheet A is a key, made from coin tosses before the message exists. Sheet B is the message written against that key. Your eye is the decryption circuit.

Three schemes:

- **Two sheets.** Each cell of the message becomes a 2×2 block. A gets one of the six two-black patterns at random; B copies it where the message is white and takes its complement where the message is black. Together: white cells show two black subpixels, black cells four.
- **Three sheets, any two.** Give one sheet to each of three people. Nobody can read it alone; any two who meet can. (One black subpixel in one of three positions; white cells put it in the same position on every sheet, black cells in three different ones.)
- **Two pictures.** Each sheet is a picture of its own, drawn in noise, say NOTHING on one and TO SEE on the other. Laid together they show the hidden message and a faint ghost of the two pictures.

Below the table: live evidence. A fingerprint of each sheet (A's stays put while you type), a histogram of how often each pattern appears on each sheet (flat, whatever the message), and the estimated mutual information between the message and each sheet alone (noise-floor) versus the sheets together (the message's whole entropy). Then a print button: each sheet on its own page at 0.8 mm per subpixel with corner marks, for transparency film.

## Why I made it

The batch theme was a thing with a part that can be proven and a part that can only be felt, and visual cryptography is that theme made literal. The proof is a counting argument short enough to say in one breath: the complement of a two-of-four pattern is another two-of-four pattern, so sheet B is uniform whatever the message is. The feeling is the moment the second sheet clicks into place and a word stands up out of static. I have read that argument many times; I had never watched the word appear. I wanted to build the thing where both happen on the same screen, with the proof checked by a machine and the reveal done by a hand.

What I like most about it is who does the computing. Every other cipher needs a machine to undo it. Here the decryption is done by light passing through two pieces of plastic and by a visual system that counts black subpixels without being asked. The key is a physical object. You can post one sheet and carry the other.

I listed candidates first: a tiny programming language with one new idea, an astrolabe, a gear-ratio finder built on the Stern–Brocot tree (a clockmaker's tool), a difference engine, a museum of rounding errors, a Kelvin tide predictor, a hand-tremor spectrometer that uses the mouse, a one-sheet zine. The instrument ideas could not be verified headless; the historical machines all leaned on facts I could not check well enough from here; the language was the obvious first pick. This one is small, every claim in it is checkable, and it is a cipher that is also a toy and a typographic object.

## How it works

**Geometry.** The message is a 100×40 picture of cells. Each cell is printed as a 2×2 block of subpixels, stored as a 4-bit mask (bit 0 top-left, bit 1 top-right, bit 2 bottom-left, bit 3 bottom-right). Sheets are 200×80 subpixels.

**Key.** Every scheme consumes exactly one key value per cell, a uniform integer in [0, 144). 144 = 12 × 12, so `k % 12` and `floor(k / 12)` are two independent uniform values in 0..11, each of which is uniform mod 2, 3, 4 and 6. That is all the randomness any cell needs, and it keeps the secrecy proof finite: 144 keys per cell. In the browser the key comes from `crypto.getRandomValues` with rejection sampling (bytes ≥ 144 are discarded, not reduced, so there is no modulo bias). The tests use a seeded Mulberry32.

**Cells** (`vc.js`, shared by page and tests):
- `cellTwo(bit, k)`: A = one of the six two-black patterns by `k % 6`; B = A if white, `~A & 15` if black.
- `cellThree(bit, k)`: position p = `k % 3`; white: all three sheets black position p; black: the other two positions, in an order chosen by one more key bit.
- `cellCover(bit, coverA, coverB, k)`: A is a random two-black pattern if its cover is white and a random three-black pattern if black. B gets the darkness of *its* cover, and is chosen so that A and B overlap as much as possible where the message is white, and cover all four subpixels where it is black. The remaining freedom (which extra subpixel) is spent with the second key value. I derived the case table myself; the test enumerates all 144 keys for all 8 combinations of message bit and the two cover bits and checks that A's distribution depends only on cover A and B's only on cover B.

**Security statement.** For each scheme, the histogram of patterns on any single sheet, over all 144 key values, is the same for every value of the secret (and, in cover mode, for every value of the other cover). That is the whole of it: a sheet alone is a sample from a distribution that does not depend on the message, so it carries no information about it. Sheet A, in all three schemes, is literally a function of the key alone, which is why it never changes when you type.

**Reading.** `rasterize` turns masks into a subpixel raster; `overlay` ORs rasters with integer offsets (off-sheet is clear); `cellCounts` counts black subpixels per cell; `decode` thresholds (4 for two sheets and two pictures, 2 for a pair of the three).

**The table.** One canvas, sized to the box in device pixels, with the largest whole number k of device pixels per subpixel that leaves a small fan (3 on a 390 px phone at 2×, 3 on a 1280 px desktop at 1×, 7 on a 2× desktop), so ink is always crisp and a subpixel is a real, draggable unit. Sheets are offscreen ink canvases drawn at integer subpixel offsets; dragging rounds to subpixels and snaps when two sheets are within 2 subpixels. Arrow keys nudge by one subpixel; A aligns; S scatters.

**Evidence panel.** FNV-style fingerprints (for "did it change?", not security), pattern histograms, and plug-in mutual-information estimates. The estimate is biased upward by about (|X|−1)(|Y|−1)/(2N ln 2) bits, which the page states next to the number; in two-pictures mode it shows MI(message; sheet, cover) − MI(message; cover), since a sheet is supposed to show its own cover and the cover may overlap the message.

**Print.** Each sheet is rendered at 10 device pixels per subpixel with a 10-subpixel white margin and a cross 5 subpixels outside each corner, and laid on its own page at 176 mm wide, so the ink area is 160 mm and a subpixel is 0.8 mm. The `@page` margin is 14 mm, which fits A4 and Letter.

**Verification.**
- `vc.test.mjs` (15 tests, under a second): pattern tables; rejection sampling is unbiased (a deterministic 0..255 byte stream yields every key value exactly once per sweep); the exhaustive per-cell histograms for all three schemes; reconstruction counts for every key; whole-picture round trips (sheet A byte-identical across messages, aligned overlay decodes exactly, raster path agrees with the direct mask OR); empirical mutual information (single sheet ≈ 0.0001–0.0005 bits per cell, overlay = the message's entropy to 1e-9); misregistration (a one-subpixel slip keeps about 3% of the aligned mutual information, 0.014–0.025 bits; a one-cell slip keeps ≤ 0.001, the noise floor); any pair of the three sheets reads; cover sheets have the right darkness and say nothing about the secret beyond their own cover.
- `check.mjs` (headless Chromium, about 6 s): types a message and checks that A's fingerprint is unchanged and B's changed, and that the page says so; aligns and **decodes the message back from the table canvas's actual pixels**, requiring zero wrong cells, in two-sheet, three-sheet (all three, and A+B with C moved aside), and two-pictures modes; one subpixel of nudge makes many cells read wrong; ArrowLeft restores exactness; a real touch drag (CDP touch events) on the 390 px dark-mode layout moves B onto A and snaps; touch drawing changes B but not A; the print area holds two 2200×1000 images; no overflow and no console errors.
- `node tools/smoke.mjs ideas/20-two-sheets` passes at desktop and phone sizes.

## Honest assessment

What works:
- [Certain] Each sheet, alone, has a pattern distribution independent of the message in all three schemes. This is checked exhaustively (every key value, every secret input), not statistically, in `vc.test.mjs`.
- [Certain] Sheet A is a function of the key alone: the test shows it byte-identical across different pictures, and the page shows its fingerprint not moving while you type.
- [Certain] With the sheets aligned, what is drawn on screen reads back as exactly the message: `check.mjs` decodes it from the real canvas pixels in all modes, in light and dark mode, at phone and desktop sizes, with zero wrong cells.
- [Certain] One subpixel of misregistration leaves the message unreadable in practice; a one-cell slip leaves no measurable information. The exact numbers are in the test output.
- [Certain] The key comes from `crypto.getRandomValues` with unbiased rejection sampling. (The fallback to `Math.random` only runs on a browser without `crypto`, which no current browser is; it exists so the page does not crash rather than as a security claim.)
- [Likely] The bibliography: Naor and Shamir, "Visual Cryptography", EUROCRYPT '94, LNCS 950, pp. 1–12; Ateniese, Blundo, De Santis and Stinson, "Extended capabilities for visual cryptography", *Theoretical Computer Science* 250 (2001) 143–161; and the random-grid precursor, Kafri and Keren, *Optics Letters* 12(6) 377–379 (1987). I confirmed the citations by web search while building this but did not read the full texts here. The two-sheet and three-sheet constructions are the (2,2) and (2,n) schemes of Naor–Shamir; the two-pictures construction is my own small one in the spirit of extended VCS, not their general hypergraph construction.

What's rough:
- [Certain] The "sheet A never changes" demonstration reuses one key across messages, which is exactly what a one-time pad forbids: two B sheets made against the same A reveal, cell by cell, where their messages differ. The page says so and offers *New key*; the demonstration is a demonstration, not a workflow.
- [Certain] "Nothing to read" at a one-subpixel offset is a statement about readability, not an information-theoretic zero: about 3% of the mutual information survives a one-subpixel slip, so a misaligned pair is not as secret as a single sheet. A single sheet is.
- [Certain] The live mutual-information figures are plug-in estimates with a known upward bias (stated on the page). The proof is the exhaustive test, not the live number.
- [Certain] Two-pictures mode has the contrast cost that extended visual cryptography always has: white message cells show two or three black subpixels depending on the covers, so the covers ghost through the overlay, and the covers themselves are only 50% versus 75% grey. It reads, but less cleanly than the two-sheet mode.
- [Certain] The message picture is 100×40 cells. Around 14 characters is the comfortable limit; longer text gets thin and hard to read through the noise. Text rasterization differs by platform's fonts.
- [Likely] Printing on transparency film should work: 0.8 mm subpixels are coarse by visual-cryptography standards and the corner marks are crosses 6.4 mm across, centred 4 mm outside each corner of the ink. [Speculative] I have no printer here, so whether a home inkjet's film holds registration well enough for the whole 160 mm message to resolve at once, rather than one region at a time as you flex the sheets, is untested.
- [Certain] Nothing on the page animates, so `prefers-reduced-motion` has nothing to do; the only transitions are two 160 ms colour fades, disabled under that preference.

## Where it could go next

- **Greyscale and photographs** by halftoning the secret before sharing it, and the dual: covers that are real photographs.
- **General access structures**: a sheet for each board member such that only the chair plus any two others can read it. The `(k, n)` constructions in the papers above fit the same cell-and-key framework.
- **Two screens**: hold a phone showing sheet B over a laptop showing sheet A, with the phone's camera doing the alignment. (Screens emit rather than transmit, so it would need the phone to composite, which stops being quite the same trick.)
- **SVG export** so the sheets can be cut or etched rather than printed, and the message appears when two pieces of glass are stacked.
- **A dead drop**: print sheet A today, seal it in an envelope, and make sheet B next year. The page already lets you: that is what a key sheet is.
