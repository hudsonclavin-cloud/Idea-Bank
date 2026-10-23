# Blinkwheel
> Twelve still drawings borrow a little motion from the gaps between them.

**Kind:** paper object
**Run:** Open `index.html` directly in a browser. No installation, server or network required.
**Made by:** Codex / Afterblink

## What it is

A printable phenakistoscope: a cardstock disk with a ring of drawings and narrow viewing slots. Hold the printed face toward a mirror, look through the slots from the unprinted back, and turn the disk. Brief separated glimpses make successive drawings appear to move.

The browser workshop offers 8–16 even frames, a flapping moth or an orbiting seed,144–176mm disk diameters, A 4 and US Letter sheets, and an idealized frame preview. Download the current cutting sheet as a physically sized SVG, or print the sheet directly. The saved [default.svg](default.svg) is a 176mm twelve-frame moth disk on A 4.

Native controls work with keyboard and touch on a 390px phone. The preview starts paused, including with reduced-motion preference. Nothing is transmitted or saved automatically.

## Why I made it

A video hides its cuts. This object makes them into holes you can hold up to the light. I wanted an animation that was also an inspectable little machine: no battery, no invisible update, just a circle of drawings and a circle of absences.

A moth seemed right for that bargain. The wings change shape, but the body returns to the same small place. The seed takes a calmer circular path around a sprout. Neither loop has an appointed beginning.

## How it works

`model.js` builds an SVG using millimetres as drawing units. A 4 exports are 210×297mm; Letter exports are 215.9×279.4mm. The viewBox matches those physical dimensions exactly. The disk lies within an 8mm printer margin for all offered combinations.

There are equal numbers of frames and viewing slots. Frames sample a periodic authored motion at evenly spaced phases. Slots lie halfway between frame spokes, at 83–95.5% of disk radius, and are 1.6mm wide. They remain inside the outer edge, leaving more than 3mm of continuous rim, and outside the artwork and central web. The 4mm centre hole is the only central cut. The 50mm calibration line is separate from the disk.

`app.js` shows an idealized sequence of individual frames at frame-count × turns-per-second. That preview explains the temporal sampling; it does not simulate a particular viewer's eyesight, mirror geometry, slit blur or illumination. The actual printed disk is viewed from the back with its artwork facing the mirror. Reversing spin reverses the sequence. Viewing angle, hand speed and contrast matter.

## Print and assemble

1. Choose a paper size matching the loaded sheet. Print on 160–220gsm cardstock at **100% / actual size**, with fit-to-page off and headers/footers disabled. The browser print button prints only the sheet, with the chosen page dimensions and zero CSS margins; the drawing itself leaves the printer margin.
2. Measure the printed calibration line: it must be 50mm before cutting. Printer or driver scaling can override browser settings.
3. Cut the outer disk, each narrow white slot rectangle, and the 4mm centre circle. Keep the thin outer rim continuous. The numbered drawings and central decorative circle are not cut lines.
4. Use a smooth 3mm dowel or skewer through the disk's 4mm hole. Cut out the two supplied 10mm card washers (3mm holes). Put a washer on each side and fix the washers to the shaft, leaving a little axial clearance so they do not clamp the disk. The disk rotates around the stationary shaft; do not glue the disk to it. An ordinary unsharpened pencil barrel is too wide for the supplied hole.
5. Hold the artwork toward a mirror in bright diffuse light. Look from the unprinted back through the moving slots at the reflected pictures. Shift your eye and tilt the disk until the pictures are visible, then spin gently. Try both directions. If the frames blur, vary the speed and viewing position.

## Honest assessment

- **[Certain]** Seven model tests check physical page units, margins, continuous rim and web clearances, slit spacing/count, phase periodicity, parameter bounds and exact saved-template reproduction.
- **[Certain]** The downloadable sheet is actual fabrication geometry, not a screenshot. All dimensions are in millimetres, and the calibration bar is 50mm long in the exported coordinates.
- **[Certain]** This is an unprinted, unassembled prototype. Paper stiffness, hand-cut slot quality, axle friction, mirror distance, lighting and actual printer scaling have not been physically evaluated.
- **[Certain]** The on-screen glimpse is an illustrative ideal strobe. It is not a measured prediction of how clean or bright the handmade animation will look. Low-contrast printing and wide hand-cut slots can make the illusion weaker.
- **[Likely]** Stiff light cardstock and carefully cut narrow slots will work better than thin paper, because a flatter disk keeps the frame ring and slots in alignment. This build has not been trialled.
- **[Speculative]** A replaceable drawing ring and a reusable black slotted mask could let a reader author a library of new loops without remaking the axle.

## Where it could go next

Add an editable drawing strip and a separate dark viewing mask, then physically compare slot widths, paper weights and mirror positions. A measured print-and-view trial would be more useful than adding more screen effects.

## Verification

From the repository root:

```sh
node --test ideas/55-blinkwheel/model.test.mjs
node tools/check.mjs ideas/55-blinkwheel
```
