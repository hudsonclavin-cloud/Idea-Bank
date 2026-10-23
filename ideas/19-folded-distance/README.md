# Folded Distance
> A map of numbers that keeps taking the scenic route.

**Kind:** mathematical art
**Run:** Open `index.html` in a browser. No installation, server or network connection required.
**Made by:** Codex / Stillwater

## What it is

An interactive Hilbert-curve print. Change the number of folds, scrub through the ordering, walk one step at a time, or tap any grid point to find its index. The dark marker is your current place in the walk. The amber marker is a spatially adjacent point whose index is furthest from yours. A short dotted line joins two neighbours that can be hundreds or thousands of steps apart in the ordering.

**Find the longest detour** jumps to the strongest such example in the current grid. **Keep this print** downloads the current curve and its markers as a self-contained SVG. The curve itself is drawn as actual vector paths, gradually changing from cool to warm as the walk progresses.

Everything works directly from disk, including on a 390 px phone. Native range controls and previous/next buttons provide alternatives to tapping the drawing. Focus the drawing and use the arrow keys to walk. Nothing is saved automatically or sent anywhere.

The original Python interface is still available when a script or coordinate table is useful:

```sh
python3 ideas/19-folded-distance/folded_distance.py > /tmp/folded.svg
python3 ideas/19-folded-distance/folded_distance.py --order 4 --table
```

[Open the original generated example](example.svg).

## Why I made it

A Hilbert curve is an elegant bargain: fold a one-dimensional walk tightly enough and nearby footsteps stay nearby on the page. The reverse promise is much less reliable. I wanted that asymmetry to be something one could touch: tap two next-door points, then discover how far the walk must travel to connect them.

## How it works

`model.js` decodes an integer Hilbert index by rotating and reflecting quadrants at successively larger powers of two, using exactly the original Python orientation. The inverse lookup reads quadrant bits in the other direction to recover an index from integer coordinates. Tests compare browser-model coordinates numerically with the retained Python generator.

Every point is visited once, and consecutive indices are exactly one Manhattan grid unit apart. At the chosen point the model inspects its up to four edge-sharing neighbours and selects the one with the largest index gap. The longest-detour button searches this same local witness over the complete grid. This makes the reverse-locality limitation visible without suggesting that the Hilbert walk is a shortest route between arbitrary points.

`app.js` connects the pure model to native controls, SVG coordinate transforms for tapping, arrow-key navigation, and explicit download. Orders 1–7 contain 4–16,384 points. The SVG is grouped into at most 32 coloured polyline blocks; selection changes do not require a continuously running animation.

## Honest assessment

- **[Certain]** Six JavaScript tests verify known coordinates, uniqueness, Manhattan adjacency, inverse round trips for all points through order 7, numerical agreement with Python, long-detour witnesses, invalid-input rejection, and self-contained SVG output. The four original Python tests remain intact.
- **[Certain]** This is a finite approximation, not an actual space-filling continuum. Nearby indices are spatially close, but nearby spatial points can have distant indices. It does not claim nearest-neighbour preservation or geographic distance accuracy.
- **[Certain]** The amber point is an edge-sharing neighbour, not a second point chosen from the same numerical interval. The gap is an absolute difference of indices, not a physical distance.
- **[Certain]** The upper order is deliberately bounded. Fine curves have small tap targets on phones; the index slider and previous/next buttons provide exact alternatives. Browser display and printer resolution can make dense lines merge visually.
- **[Likely]** Changing the fold count and walking across a seam communicates the locality tradeoff more clearly than a single static print. Its educational usefulness has not been formally evaluated.
- **[Speculative]** An archive arranged along the walk could make this tradeoff useful for browsing images or documents. No archive integration is implemented.

## Where it could go next

Use the ordering to lay out a personal archive, keeping a visible indicator of where spatial neighbours become distant in the ordering. Compare a Hilbert walk with row-major and Morton orderings using the same set of points.

## Verification

From the repository root:

```sh
node --test ideas/19-folded-distance/model.test.mjs
python3 -m unittest discover -s ideas/19-folded-distance -v
node tools/check.mjs ideas/19-folded-distance
```
