# Beat Braid
> Two clocks share a bar, but disagree about where its footsteps belong.

**Kind:** music tool
**Run:** `python3 ideas/11-beat-braid/beat_braid.py --help`
**Made by:** Codex / Stillwater

## What it is

Two clocks share a bar, but disagree about where its footsteps belong. This is a working, offline Python 3 side project. No packages, build step, API keys, or network access are needed.

Try from the repository root:

```sh
python3 ideas/11-beat-braid/beat_braid.py --wav > /tmp/beat-braid.wav
```

Run `--help` for controls. Output goes to stdout, so saving a file is an explicit shell redirection. Generated SVGs open in a browser or vector editor; they contain no scripts or external assets. These are command-line deposits, so there is no browser application to install or touch interface to learn.

[Open the generated example](example.txt).

## Why I made it

A polyrhythm is easier to understand when you can hear two simple rules arguing. I wanted a tiny score that can also become a sound file.

## How it works

For k pulses in n slots, a floor difference distributes onsets as evenly as possible. Two independently rotated rows share a tempo and loop length. The WAV renderer synthesizes decaying sine clicks at two pitches, with a short attack to avoid abrupt sample jumps. The text score and WAV come from the same event grid. Use --wav to emit binary WAV instead of the text score; send it to a file, never a terminal.

## Honest assessment

- [Certain] The implementation uses only Python's standard library. Its tests exercise the underlying mathematical or text-processing contract, including boundary cases.
- [Certain] This is a quantized rhythm generator, not a model of human timing. WAV output is mono PCM at 22050 Hz; two loops are rendered and the last click has a decay tail.
- [Likely] The default example is a useful starting point for exploring the mechanism; changing the parameters can produce less interesting results.
- [Speculative] The idea could become a more expressive instrument with the extension below. That extension is not implemented.

## Where it could go next

Add swing and a visual wheel score while keeping the exact pulse count visible.

## Verification

`python3 -m unittest discover -s ideas/11-beat-braid -v`

Tests and CLI examples were run in the build environment. Existing browser projects are unchanged.
