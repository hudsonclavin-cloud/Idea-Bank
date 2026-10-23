# Beat Braid
> Two clocks share a bar, but disagree about where its footsteps belong.

**Kind:** music tool
**Run:** Open `index.html` directly in a browser. No installation, server, or network required.
**Made by:** Codex / Stillwater

## What it is

A playable polyrhythm instrument. Two concentric clocks share a circle while placing different numbers of evenly spaced footsteps around it. Change their pulse counts, rotate the rose rhythm against the amber one, set a tempo, and press **Play the braid**. The connecting threads and linear scores show how the rhythms meet. Four presets offer a starting point, including an empty amber row to make room for silence.

**Save WAV** downloads two loops as an ordinary sound file. Sound starts only after pressing Play; leaving the tab pauses playback. All controls work with keyboard and touch, including on a 390 px phone. The page keeps no persistent data and makes no network calls.

The original Python command-line tool is still available for scripts:

```sh
python3 ideas/11-beat-braid/beat_braid.py --help
python3 ideas/11-beat-braid/beat_braid.py --wav > /tmp/beat-braid.wav
```

[Open the generated text example](example.txt).

## Why I made it

A polyrhythm is easier to understand when you can hear two simple rules arguing. I wanted a tiny score that can also become a sound file. The browser instrument makes that conversation immediate: the circle is a common promise, and each voice takes a different route around it.

## How it works

For k pulses in n slots, a floor difference distributes onsets as evenly as possible. Both rows share a tempo and loop length; rotating the rose row shifts every onset without changing its count. A slot is one sixteenth note and tempo counts quarter notes, so its duration is `60 / BPM / 4` seconds.

`model.js` ports the original pure Python algorithm and generates mono 16-bit PCM WAV at 22050 Hz, with two loops and a decay tail. The JavaScript score is tested against hundreds of Python-generated cases. Browser playback uses Web Audio's clock with a short scheduling horizon; two decaying sine clicks sound at 660 Hz and 440 Hz. Visual highlighting follows the scheduled audio step. Changing the phrase pauses playback so old and new schedules never overlap.

The connecting threads associate each amber onset with the next rose onset around the circle. They are a visual aid, not another musical voice.

## Honest assessment

- [Certain] Both interfaces run offline without dependencies: vanilla HTML/CSS/JS in the browser, or Python's standard library on the command line. Their score algorithms agree across all cross-language test cases.
- [Certain] This is quantized rhythm, not a model of human timing. The clicks are synthesized sine tones rather than recordings of wood, despite their high/low wood labels.
- [Certain] WAV output is mono PCM at 22050 Hz. The visual animation uses the display clock and can lag slightly behind Web Audio, especially under CPU load.
- [Certain] The browser deliberately pauses when the page is hidden or controls change. It is a small instrument, not a background performance sequencer.
- [Likely] The shared circle makes conflicting rhythms easier to follow than two rows of symbols alone. That educational effect has not been measured.
- [Speculative] Swing and additional voices could make the instrument more expressive; those features are not implemented.

## Where it could go next

Add swing while preserving pulse count, let readers name their two voices, or print the wheel as a small circular score.

## Verification

```sh
node --test ideas/11-beat-braid/model.test.mjs
python3 -m unittest discover -s ideas/11-beat-braid -v
node tools/smoke.mjs ideas/11-beat-braid
```
