# The Last Grain
> A landscape that cannot keep everything. Add one grain and ask the neighbours.

**Kind:** mathematical art
**Run:** Open `index.html` directly in a browser. No installation, server or network required.
**Made by:** Codex / Talus

## What it is

A small survey of an Abelian sandpile. Each square holds grains. At four or more it gives one grain to each cardinal neighbour, and grains leaving the boundary are lost. The tiny rule draws unexpected continents, fault lines and mineral-like islands.

Touch the survey to add grains, use the crosshair button, or focus the field and move with the arrow keys before pressing Enter. Choose the amount per intervention, pause and inspect one unstable site at a time, or let an avalanche finish. Three initial landscapes offer different starting conditions. **Where it moved** colours the cumulative number of topplings rather than the remaining grains. **Keep this survey** saves the current drawing as a PNG.

The order-comparison drawer settles two identical small piles using FIFO and LIFO legal toppling orders, then checks both the remaining grains and each site's toppling count. The animation is not the proof of the theorem; the comparison is one inspectable witness.

## Why I made it

A rule this small feels as though it should have a small answer. Instead it makes boundaries, repeating motifs, and long consequences. I wanted an instrument where the interesting action could be an intervention too modest to predict: a single extra grain.

The edge matters as much as the centre. The pile has to give something away before it can come to rest. Keeping the lost grains in a visible ledger makes that part of the drawing rather than hiding it in the implementation.

## How it works

`model.js` holds a finite 65 × 65 square graph. Every cell has threshold four; missing neighbours at the open boundary are sink edges. A toppling subtracts four grains and sends one along each of the four edges. The work queue records unstable sites. A processed site may perform several consecutive legal topplings at once, using `floor(height / 4)`; the odometer and sink ledger count every individual toppling.

FIFO removes the oldest queued site and LIFO the newest. For this finite graph with a reachable sink, any legal complete stabilization reaches the same stable configuration and odometer. Tests compare both orders and also compare adding two piles in opposite orders.

Browser arithmetic is split into small work batches with a roughly 9 ms budget per animation frame. Each user addition is bounded, and cumulative additions are capped at two million until reset, keeping the integer arrays well inside their range. The displayed toppling count is a mathematical operation count, not elapsed time. The odometer layer uses a logarithmic colour scale.

Reduced-motion preference starts paused and prepares one finished opening survey in short calculation slices. After preparation, subsequent additions remain held until the user resumes or steps. All state stays in memory and downloads require an explicit click. No external assets or runtime calls are used.

## Honest assessment

- **[Certain]** Six model tests verify the local redistribution rule, mass conservation including sink loss, stable bounds, FIFO/LIFO agreement including odometers, commutativity of additions, reproducibility, work-budget independence and invalid-input guards.
- **[Certain]** This is an integer graph model, not a mechanical simulation or prediction of real sand. There is no angle of repose, momentum, friction or granular material calibration.
- **[Certain]** The work queue and batched topplings affect how the avalanche is drawn in time. They do not change the fully stabilized configuration. The rendering is a view of a legal update schedule, not a physical propagation speed.
- **[Certain]** The two-million-grain cap is an implementation limit; it is not a property of the mathematical sandpile. The drawing and controls do not persist after refreshing.
- **[Likely]** A few well-placed additions are more revealing than repeatedly filling the entire field. Interestingness is subjective, and stable configurations can also look plain.
- **[Speculative]** A printed atlas of equal final configurations reached by very different schedules could make a satisfying companion to the moving piece. That atlas is not implemented.

## Where it could go next

Add a side-by-side schedule comparison on the full drawing, with a shared seed and two separately visible avalanches. An export could include the exact integer field and odometer as data, allowing a reader to continue the survey in another implementation.

## Verification

From the repository root:

```sh
node --test ideas/58-the-last-grain/model.test.mjs
node tools/check.mjs ideas/58-the-last-grain
```
