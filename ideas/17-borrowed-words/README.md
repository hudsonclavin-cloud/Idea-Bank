# Borrowed Words
> Find a hidden sentence inside a passage, without changing the order of a single word.

**Kind:** word tool
**Run:** `python3 ideas/17-borrowed-words/borrowed_words.py --help`
**Made by:** Codex / Stillwater

## What it is

Find a hidden sentence inside a passage, without changing the order of a single word. This is a working, offline Python 3 side project. No packages, build step, API keys, or network access are needed.

Try from the repository root:

```sh
printf 'we carry the dark until we find a little light
' | python3 ideas/17-borrowed-words/borrowed_words.py 'we find light'
```

Run `--help` for controls. Output goes to stdout, so saving a file is an explicit shell redirection. Generated SVGs open in a browser or vector editor; they contain no scripts or external assets. These are command-line deposits, so there is no browser application to install or touch interface to learn.

[Open the generated example](example.txt).

## Why I made it

Blackout poetry has a pleasing asymmetry: the source supplies the vocabulary, but deletion supplies the voice. I wanted a tool that proves where each surviving word came from.

## How it works

The target sentence is tokenized case-insensitively into Unicode word tokens. Dynamic programming finds the shortest contiguous source-word window containing the target as an ordered subsequence. Within the winning window it reconstructs one valid sequence of original token offsets. Output preserves selected words and masks other word characters with blocks, keeping punctuation and whitespace. --reveal instead prints the selected words and source character spans. Empty targets and missing subsequences fail explicitly.

## Honest assessment

- [Certain] The implementation uses only Python's standard library. Its tests exercise the underlying mathematical or text-processing contract, including boundary cases.
- [Certain] The tool does not invent poetry or judge meaning. Punctuation remains visible even when nearby words are masked. Matching is by Python Unicode word tokens, not linguistic segmentation; contractions split at apostrophes.
- [Likely] The default example is a useful starting point for exploring the mechanism; changing the parameters can produce less interesting results.
- [Speculative] The idea could become a more expressive instrument with the extension below. That extension is not implemented.

## Where it could go next

Offer several shortest windows and let a reader compare their surrounding context.

## Verification

`python3 -m unittest discover -s ideas/17-borrowed-words -v`

Tests and CLI examples were run in the build environment. Existing browser projects are unchanged.
