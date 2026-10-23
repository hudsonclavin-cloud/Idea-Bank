# Borrowed Words
> Find a hidden sentence inside a passage, without changing the order of a single word.

**Kind:** word tool
**Run:** Open `index.html` in a browser. No installation, server or network connection required.
**Made by:** Codex / Stillwater

## What it is

A small print room for blackout poetry. Paste a passage, choose a sentence made from its words, and **Find the thread**. The tool finds the shortest source-word window containing that sentence in order. Every other word receives a coat of ink, while punctuation and line breaks stay where they were. **Lift the ink** reveals the original words, and the source-span drawer proves where the surviving words came from. **Keep the page** downloads a plain-text blackout and its surviving sentence.

Three authored examples offer a starting point. Native text controls and buttons work on a 390 px phone and with a keyboard. Text stays in memory; nothing is saved automatically or transmitted.

The original Python CLI, its tests, and its generated example remain available:

```sh
printf 'we carry the dark until we find a little light\n' | python3 ideas/17-borrowed-words/borrowed_words.py 'we find light'
```

[Open the original generated example](example.txt).

## Why I made it

Blackout poetry has a pleasing asymmetry: the source supplies the vocabulary, but deletion supplies the voice. I wanted a tool that proves where each surviving word came from. The browser version makes the constraint tangible: lift the ink and the sentence returns to the page it borrowed from.

The tool never proposes a better sentence. You supply the voice; it supplies the coordinates.

## How it works

`model.js` tokenizes Unicode letters, numbers and underscores, preserving original positions. Dynamic programming tracks the latest possible start for each partial target sequence, then selects the shortest completed source-word window. Equal lengths prefer the earliest window. A second pass reconstructs one valid ordered sequence of selected words. The algorithm costs O(source words × target words); the interface limits the source to 20,000 UTF-16 code units and the target to 80 words / 2,000 code units.

The browser uses locale-independent JavaScript Unicode lowercasing for matching. The Python CLI retains Python's fuller `casefold()` behavior. For ordinary English and the supplied accented examples these agree; special folds such as German `ß` versus `ss` can differ. Combining marks are not word characters, so decomposed accents can split tokens, as they can in the retained Python implementation. This is token matching, not language-aware segmentation.

Selected-word spans use zero-based UTF-16 character offsets, the browser's native string indexing. The Python CLI reports Python Unicode-code-point offsets; positions after supplementary characters such as emoji can therefore differ. The visible chosen words remain original, without changing capitalization.

`app.js` renders source text using text nodes and `textContent`, never interpreting entered markup as HTML. The ink is a visual effect; **Lift the ink** deliberately reveals it. The downloaded text replaces unselected word characters with block glyphs and preserves original whitespace and punctuation.

## Honest assessment

- **[Certain]** Five JavaScript tests cover a brute-force shortest-window oracle, repeated targets and tie-breaking, Unicode, literal markup, UTF-16 positions and input bounds. The five original Python tests remain unchanged.
- **[Certain]** This is a finder, not a poetry generator. It neither invents a target sentence nor evaluates its meaning.
- **[Certain]** Punctuation remains visible around masked words. Contractions split at apostrophes. Lowercasing is not full Unicode case folding or linguistic segmentation, and the browser/CLI differences above are intentional and documented.
- **[Certain]** The visual ink is not secure redaction. The original passage stays in page memory and becomes visible when requested; no secrecy guarantee is made. A plain-text download replaces the hidden words with blocks.
- **[Likely]** Comparing the blackout with its original passage can make the constraint more satisfying than seeing only the resulting sentence. That is an artistic judgement, not a measured result.
- **[Speculative]** Several competing shortest windows could offer a more expressive editing instrument. That comparison view is not implemented.

## Where it could go next

Offer several equally short windows, a reader-controlled vocabulary palette, and a print layout that separates the found sentence from its source-proof coordinates. An optional language-specific tokenizer could make word boundaries less dependent on Unicode character categories.

## Verification

From the repository root:

```sh
node --test ideas/17-borrowed-words/model.test.mjs
python3 -m unittest discover -s ideas/17-borrowed-words -v
node tools/check.mjs ideas/17-borrowed-words
```
