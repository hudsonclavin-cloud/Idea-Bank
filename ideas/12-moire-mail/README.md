# Moire Mail
> A postcard whose large waves are made entirely from small straight lines.

**Kind:** generative art
**Run:** Open `index.html` in a browser. No installation, server or network connection required.
**Made by:** Codex / Stillwater

## What it is

An interactive print room for two families of straight lines. Turn one grating with the angle slider, drag directly on the postcard, or focus the print and use the left/right arrow keys. Change the spacing, try long-wave and crosswind presets, and choose oxide, indigo or a single ink. The beat wavelength updates with the drawing. **Keep this postcard** downloads the current composition as a self-contained vector SVG.

All the drawing and controls work offline, directly from the file. The interface fits a 390 px phone, and every drag interaction has a native slider alternative. Nothing is saved automatically or sent anywhere.

The original Python generator remains an optional terminal interface:

```sh
python3 ideas/12-moire-mail/moire_mail.py --angle 4 > /tmp/moire.svg
```

[Open the original generated example](example.svg).

## Why I made it

Moiré feels like a drawing sneaking out from between two other drawings. I wanted to make the interference reproducible enough to print, but also tangible enough to turn with a finger. The big wave is never drawn directly. It appears because two small regularities disagree.

## How it works

Two equal-spacing families of parallel vector lines are clipped to the same rectangular print field. The upper family rotates around the postcard's centre. For line spacing `d` and angle `θ`, the ideal beat wavelength is `d / (2 sin(|θ|/2))`. This is the same geometry as the retained Python generator. The browser additionally supports exact alignment: at zero degrees there is no finite beat wavelength, displayed as infinity. The Python CLI retains its original nonzero-angle requirement.

`model.js` contains the shared browser/Node geometry and SVG generator. `app.js` supplies native controls, pointer capture, keyboard increments, presets and an explicit SVG download. Dragging uses a wrapped angular difference so crossing from +179° to −179° does not cause a full-turn jump. The visual instrument limits rotation to ±45° and the underlying geometry supports ±90°.

The exported print contains actual line paths, a clip rectangle and text labels. It contains no scripts, linked fonts, external assets or raster imitation of interference.

## Honest assessment

- **[Certain]** Five JavaScript tests cover the beat formula, the zero-angle limit, numerical agreement with the original Python implementation, invalid geometry, wrapped dragging and two-grating SVG structure. The three original Python tests are retained.
- **[Certain]** The browser is entirely local and works directly from disk. The desktop and 390 px phone smoke checks pass. Native sliders and the focused postcard's arrow keys offer alternatives to dragging.
- **[Certain]** Screen resampling and printer resolution can introduce additional interference. The wavelength formula describes ideal infinite gratings; the cropped picture can hide most of a long beat. A change in browser zoom can visibly change the apparent pattern.
- **[Certain]** Colours are artistic choices. The ink families are overprinted with ordinary SVG strokes rather than a physical subtractive-ink simulation. The exported dimensions are drawing units, not a calibrated printer measurement.
- **[Likely]** Spacings around 8–12 units and small nonzero angles make the large-scale beat easiest to read. Which settings look best depends on the display.
- **[Speculative]** A separately printed transparent top layer could make a physical version of the same instrument. That physical edition has not been built.

## Where it could go next

Print a second transparent layer so a reader can rotate the physical grating. A two-layer export with registration marks could help align the sheets without turning the digital piece into a fake paper simulation.

## Verification

From the repository root:

```sh
node --test ideas/12-moire-mail/model.test.mjs
python3 -m unittest discover -s ideas/12-moire-mail -v
node tools/check.mjs ideas/12-moire-mail
```
