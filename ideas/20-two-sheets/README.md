# Two Sheets of Nothing
> Two sheets of random noise that say nothing on their own, provably. Lay one over the other and they spell a message.

**Kind:** cipher
**Run:** open `index.html` in a browser (plain classic scripts, so it works straight from `file://`; no server, build, network or dependencies). Tests, from the repo root: `node --test ideas/20-two-sheets/vc.test.mjs` (pure Node: exhaustive proofs, and what a misaligned pair still leaks) and `node ideas/20-two-sheets/check.mjs` (end to end in headless Chromium, using the globally installed Playwright that `tools/smoke.mjs` uses).
**Made by:** Acetate

## What it is

A light table with two sheets of noise on it. Drag the top sheet around with a finger or the mouse: it is noise over noise, until the two sheets sit exactly over each other and a message appears in the overlap. Nudge either sheet by one subpixel and the clean reading is lost. The eye may still catch a faint texture ghost of the letters, and a computer can recover much more: a misaligned pair is not secret. Only a single sheet is.

The message is yours: type it, or draw on it. Change it and watch what happens: sheet A does not change at all. Only sheet B rearranges itself. Sheet A is a key, made from coin tosses before the message exists. Sheet B is the message written against that key. Your eye is the decryption circuit.

Three schemes:

- **Two sheets.** Each cell of the message becomes a 2×2 block. A gets one of the six two-black patterns at random; B copies it where the message is white and takes its complement where the message is black. Together: white cells show two black subpixels, black cells four.
- **Three sheets, any two.** Give one sheet to each of three people. Nobody can read it alone; any two who meet can. (One black subpixel in one of three positions; white cells put it in the same position on every sheet, black cells in three different ones.)
- **Two pictures.** Each sheet is a picture of its own, drawn in noise, say NOTHING on one and TO SEE on the other. Laid together they show the hidden message and a faint ghost of the two pictures.

Below the table: live evidence. A fingerprint of each sheet (A's stays put while you type), a histogram of how often each pattern appears on each sheet (flat, whatever the message), and the estimated mutual information between the message and each sheet alone (noise-floor) versus the sheets aligned (the message's whole entropy). Then a print button: each sheet on its own page at 0.8 mm per subpixel with corner marks, for transparency film.

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

**Security statement.** For each scheme, the histogram of patterns on any single sheet, over all 144 key values, is the same for every value of the secret (and, in cover mode, for every value of the other cover). That is the whole of it: a sheet alone is a sample from a distribution that does not depend on the message, so it carries no information about it. Sheet A is literally a function of the key alone (in two-pictures mode, of the key and its own picture), which is why it never changes when you type the message. The statement is about one sheet. It says nothing about two sheets lying anywhere near each other; see *Misalignment*.

**Reading.** `rasterize` turns masks into a subpixel raster; `overlay` ORs rasters with integer offsets (off-sheet is clear); `cellCounts` counts black subpixels per cell; `decode` thresholds (4 for two sheets and two pictures, 2 for a pair of the three).

**Misalignment.** The eye reads a stack by averaging how many black subpixels each cell has. Once the sheets slip, that count carries little (one subpixel) or nothing (a whole cell). A camera sees every subpixel, so `leak.js` measures what a computer gets from the full pattern of a slipped two-sheet overlay. It models message cells as independent coin flips and key cells as uniform. For a slip of one subpixel sideways or up/down, or of any whole number of cells, each overlay cell depends only on the sheets' cells c and c − s for one fixed step s. So the cells fall into independent chains, and the forward algorithm gives the exact probability of the whole observed overlay, with and without knowing the message. The mean of log₂ P(O | M) − log₂ P(O) over random messages and keys is the mutual information I(M; O). Forward–backward gives each cell's posterior, and so the best possible per-cell guess. The tests check the estimator against brute-force enumeration on short strips. A diagonal slip couples four cells, so for it the tests compute an exact lower bound over a four-cell window instead.

**The table.** One canvas, sized to the box in device pixels, with the largest whole number k of device pixels per subpixel that leaves a small fan (3 on a 390 px phone at 2×, 3 on a 1280 px desktop at 1×, 7 on a 2× desktop), so ink is always crisp and a subpixel is a real, draggable unit. Sheets are offscreen ink canvases drawn at integer subpixel offsets; dragging rounds to subpixels and snaps when two sheets are within 2 subpixels. Arrow keys nudge by one subpixel; A aligns; S scatters.

**Evidence panel.** FNV-style fingerprints (for "did it change?", not security), pattern histograms, and plug-in mutual-information estimates. The estimate is biased upward by about (|X|−1)(|Y|−1)/(2N ln 2) bits (`plugInBias` in `vc.js`), which the page states next to the number. In two-pictures mode it shows MI(message; sheet, cover) − MI(message; cover), since a sheet is supposed to show its own cover and the cover may overlap the message. The bias of that conditional estimate is the same term summed over the cover's two values: (1)(5) + (1)(3) = 8 over 2N ln 2, about 0.0014 bits for 4000 cells. The tests check both against the mean over many fresh keys.

**Keys and printing.** A key is for one printing. The page draws a fresh key whenever you switch scheme, and on the first change of any kind after you print, or after you save any sheet but A. Saving sheet A first and making B later in the same visit is fine, because A is only the key. If the browser has no `crypto.getRandomValues`, the page still runs as a demonstration on `Math.random`, but it switches printing and saving off and says why.

**Print.** Each sheet is rendered at 10 device pixels per subpixel with a 10-subpixel white margin and a cross 5 subpixels outside each corner, and laid on its own page at 176 mm wide, so the ink area is 160 mm and a subpixel is 0.8 mm. The `@page` margin is 14 mm, which fits A4 and Letter.

**Verification.**
- `vc.test.mjs` (22 tests, about 3 s):
  - Pattern tables, and unbiased rejection sampling (a deterministic 0..255 byte stream yields every key value exactly once per sweep).
  - The exhaustive per-cell histograms for all three schemes, and reconstruction counts for every key.
  - Whole-picture round trips: sheet A byte-identical across messages, the aligned overlay decodes exactly, and the raster path agrees with the direct mask OR.
  - Empirical mutual information: a single sheet ≈ 0.0001–0.0005 bits per cell; the aligned overlay = the message's entropy to 1e-9.
  - Misalignment. The per-cell count statistic: 0.037 bits at one subpixel and exactly 0 at a whole cell. `leak.js` agrees with brute force on every message and key of short strips. The full overlay of random messages (the figures under *Honest assessment*), with the diagonal bound by exact enumeration. A check that this README and the page quote these figures and not the old ones.
  - The page's stated estimator bias against simulation; the exact per-cell leaks from key reuse across schemes and cover edits; any pair of the three sheets reads; cover sheets have the right darkness and say nothing about the secret beyond their own cover; a ghost-free cover variant is just as secret.
- `check.mjs` (headless Chromium, about 7 s):
  - Typing a message leaves A's fingerprint unchanged, changes B's, and the page says so.
  - Aligned, it **decodes the message back from the table canvas's actual pixels** with zero wrong cells: two-sheet, three-sheet (all three, and A+B with C moved aside) and two-pictures modes.
  - One subpixel of nudge makes the count reading wrong for many cells, but `leak.js` run on the canvas's full subpixel pattern still decodes much of the message. The status line warns of a ghost instead of saying there is nothing to read. ArrowLeft restores exactness.
  - Key rules: editing keeps the key until a non-key sheet is saved, then the first edit draws a fresh one; a scheme switch draws a fresh one.
  - The bias shown in two-pictures mode is the conditional one. Without `crypto`, printing and saving are off.
  - A real touch drag (CDP touch events) on the 390 px dark-mode layout moves B onto A and snaps; touch drawing changes B but not A; the print area holds two 2200×1000 images; no overflow and no console errors.
- `node tools/smoke.mjs ideas/20-two-sheets` passes at desktop and phone sizes.

## Honest assessment

What works:
- [Certain] Each sheet, alone, has a pattern distribution independent of the message in all three schemes. This is checked exhaustively (every key value, every secret input), not statistically, in `vc.test.mjs`.
- [Certain] Sheet A is a function of the key alone (in two-pictures mode, of the key and its own picture): the test shows it byte-identical across different messages, and the page shows its fingerprint not moving while you type.
- [Certain] With the sheets aligned, what is drawn on screen reads back as exactly the message: `check.mjs` decodes it from the real canvas pixels in all modes, in light and dark mode, at phone and desktop sizes, with zero wrong cells.
- [Certain] The key comes from `crypto.getRandomValues` with unbiased rejection sampling. Without it, the page falls back to `Math.random` only to keep running as a demonstration. It then switches printing and saving off and says so; `check.mjs` tests this with `crypto` removed.
- [Likely] The bibliography:
  - Naor and Shamir, "Visual Cryptography", EUROCRYPT '94, LNCS 950, pp. 1–12.
  - Ateniese, Blundo, De Santis and Stinson, "Extended capabilities for visual cryptography", *Theoretical Computer Science* 250 (2001) 143–161.
  - The random-grid precursor: Kafri and Keren, *Optics Letters* 12(6) 377–379 (1987).

  I confirmed the citations by web search but did not read the full texts here. The two-sheet and three-sheet constructions are the (2,2) and (2,n) schemes of Naor–Shamir. Sheets that show pictures of their own also go back to Naor and Shamir, for two sheets, as Klein and Wessler's paper on extended schemes notes; Ateniese et al. generalised the idea. I derived the two-pictures construction here myself and have not compared it with Naor and Shamir's matrices, so it may well be a small variant of theirs.

What's rough:
- [Certain] **A misaligned pair is not secret; only a single sheet is.** A slip hides the message from the eye, not from a camera and a computer. The black-subpixel count per cell, which is what the eye averages, carries only 0.037 bits per cell of a random message at a one-subpixel slip, and exactly nothing at a whole-cell slip. The full overlay carries far more. For a random message (1 bit per cell), it keeps:
  - 0.51 bits per cell at a one-subpixel slip sideways or up/down;
  - at least 0.43 at a diagonal one (an exact bound over a four-cell window, so a floor);
  - 0.55 bits at a slip of one or more whole cells;
  - at least 0.50 over sheet A's area in the page's scattered layout. This leaves out the overhang of sheet B, which a photo would also show.

  A computer's best per-cell guess is right 80% of the time after a one-subpixel slip and 74% after a whole-cell slip, where a coin toss gets 50%. A sparse message like the page's lettering loses a similar or larger share of its entropy: about 52% and 59% when 13% of cells are black. The figures are averages of exact log-likelihoods over random messages and keys, tens of thousands of cells each, in `vc.test.mjs`. `check.mjs` decodes the page's own slipped canvas the same way.
- [Certain] At a one-subpixel slip the message also does not vanish for the eye. White cells average 3.17 black subpixels and black cells 2.83, a faint negative, and the two textures differ, so short words can show as a ghost. I can see "YES" in a screenshot of a sideways and of a diagonal slip. The status line now says this. At whole-cell slips I could not see anything.
- [Certain] I measured the misalignment leak for the two-sheet scheme only. The three-sheet and two-pictures schemes are not measured. Treat a misaligned pair in any scheme as readable. In every scheme the edges of a slipped stack, where one sheet lies alone, already give some cells away outright.
- [Certain] The "sheet A never changes" demonstration reuses one key across messages, which is exactly what a one-time pad forbids. Two B sheets made against the same A reveal, cell by cell, where their messages differ. The same message made under one key in two schemes, or under two cover pictures, can reveal the message itself. A two-sheet B plus a three-sheet B gives 0.54 bits per cell; two B sheets made either side of a cover-B edit give the whole message where cover A is black. So the page draws a fresh key on every scheme switch, and on the first change after printing or after saving any sheet but A. The demonstration only lasts until then.
- [Certain] The live mutual-information figures are plug-in estimates with a known upward bias (stated on the page). The proof is the exhaustive test, not the live number.
- [Certain] Two-pictures mode pays the usual contrast cost of extended visual cryptography: the covers themselves are only 50% versus 75% grey. I also chose to let white message cells drop to two black subpixels where both covers are white. That buys contrast there, at the price of a faint ghost of the covers in the overlay. A variant with a uniform three-subpixel white has no ghost and the same per-sheet secrecy (checked exhaustively in `vc.test.mjs`). It reads, but less cleanly than the two-sheet mode.
- [Certain] The message picture is 100×40 cells. Around 14 characters is the comfortable limit; longer text gets thin and hard to read through the noise. Text rasterization differs by platform's fonts.
- [Likely] Printing on transparency film should work: 0.8 mm subpixels are coarse by visual-cryptography standards and the corner marks are crosses 6.4 mm across, centred 4 mm outside each corner of the ink. [Speculative] I have no printer here, so whether a home inkjet's film holds registration well enough for the whole 160 mm message to resolve at once, rather than one region at a time as you flex the sheets, is untested.
- [Certain] Nothing on the page animates, so `prefers-reduced-motion` has nothing to do; the only transitions are two 160 ms colour fades, disabled under that preference.

## Where it could go next

- **Greyscale and photographs** by halftoning the secret before sharing it, and the dual: covers that are real photographs.
- **General access structures**: a sheet for each board member such that only the chair plus any two others can read it. The `(k, n)` constructions in the papers above fit the same cell-and-key framework.
- **Two screens**: hold a phone showing sheet B over a laptop showing sheet A, with the phone's camera doing the alignment. (Screens emit rather than transmit, so it would need the phone to composite, which stops being quite the same trick.)
- **SVG export** so the sheets can be cut or etched rather than printed, and the message appears when two pieces of glass are stacked.
- **A dead drop**: print sheet A today, seal it in an envelope, and make sheet B next year. Within one visit the page already lets you: save sheet A, then type the message and save B. Across visits it would need the key saved somewhere safe, which it does not do.
- **A live leak meter**: show, for the slip on the table right now, how much a camera would still get, using `leak.js`.

## Revision note

An independent reviewer rebuilt the three constructions and enumerated every key. Single-sheet secrecy, pair reconstruction and unbiased key sampling all held. It found real problems elsewhere, all now fixed:

- **The misalignment claims were wrong, and labelled [Certain].** I had measured the information in the black-subpixel *count* per cell. That is what the eye averages, but it throws away which subpixels are black. I wrote it up as "about 3% survives a one-subpixel slip" and "a one-cell slip leaves no measurable information". The full overlay of a random message keeps 0.51 bits per cell at a one-subpixel slip and 0.55 at a whole-cell slip, about half the message; the reviewer's local estimates of 30–40% were floors. `leak.js` now measures this with exact likelihoods, checked against brute force. The page and this README now say a misaligned pair is not secret, and that only a single sheet is.
- **"Nothing to read" at a one-subpixel slip was false.** A texture ghost of short words can show. The status line says so now.
- **The key-reuse rule was incomplete.** Reprinting the *same* message in another scheme, or after a cover edit, leaks it too. The page now draws a fresh key on a scheme switch and on the first change after printing or saving a non-key sheet.
- **Attribution.** Sheets with pictures of their own go back to Naor and Shamir, not to Ateniese et al., who generalised the idea.
- **Smaller fixes:**
  - The noise floor shown in two-pictures mode was 2.25× too high (0.0032 bits, now 0.0014).
  - The cover ghost is a choice I made, not a cost every extended scheme pays.
  - "Sheet A is a function of the key alone" now notes A's own picture in two-pictures mode.
  - Without `crypto.getRandomValues`, the page now refuses to print or save.
