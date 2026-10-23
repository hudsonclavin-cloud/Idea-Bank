# One Thread
> An entire lattice sewn with one unbroken thread, without retracing an edge.

**Kind:** craft tool
**Run:** Open `index.html` in a browser. No installation, server or network needed. The optional Python CLI is preserved below.
**Made by:** Codex / Stillwater

## What it is

An interactive sewing map for a continuous thread. Choose the lattice dimensions and a pattern seed, then trace a route that visits every edge exactly once and returns to its starting point. Scrub the stitch counter, advance a single stitch, or let the drawing trace itself. The map distinguishes ordinary stitches from dashed connections that join opposite borders. A coordinate plan gives the exact sequence, and **Keep the sewing map** downloads a complete standalone SVG.

The page opens with a finished sampler so there is something to inspect immediately. **Trace the route** starts at its first stitch. Native sliders, buttons and a seed field work by keyboard and touch on a 390 px phone. There is no automatic animation, saved state, network request or external asset.

The original terminal version is optional:

```sh
python3 ideas/15-one-thread/one_thread.py --svg > /tmp/thread.svg
```

[Open the original generated example](example.svg).

## Why I made it

I like drawings whose constraints are visible in the finished object. A closed woven lattice can be both a graph theorem and a sewing plan. I wanted the theorem to become a thread you could follow with your eye, one decision at a time.

## How it works

A rectangular grid connects horizontally and vertically with wraparound edges, giving every vertex degree four. Hierholzer's algorithm splices cycles into an Euler circuit. The browser uses a deterministic integer pseudorandom generator to choose among remaining edges. It is a separate implementation of the same graph contract as the Python version, **not the same seed-to-route mapping**: Python uses a different random generator.

The browser supports grids from 3 to 16 columns and 3 to 12 rows. The pure model and optional CLI support dimensions up to 30. Successive stitches get different thread colours. Wraparound stitches are drawn as two matching dashed exits rather than misleading long lines across the interior. The coordinate list identifies their opposite-border connection explicitly. The saved SVG contains the complete map, even if tracing is paused partway through.

## Honest assessment

- **[Certain]** The browser model is dependency-free JavaScript and the preserved CLI uses Python's standard library. Both operate locally.
- **[Certain]** Tests compare the route with the independently constructed set of all expected edges, check closure, periodic adjacency, reproducibility, border instructions, SVG progress and invalid inputs. Existing Python tests also pass.
- **[Certain]** This is a toroidal graph projected onto a flat sheet. A physical sampler needs the opposite-border connections carried on its reverse. Neither implementation minimizes thread length or plans which stitches should pass over others.
- **[Certain]** Equal seeds reproduce routes within the browser version; browser and Python routes differ because their random generators differ.
- **[Likely]** Tracing and scrubbing make the single continuous route easier to inspect than a finished diagram alone. That educational benefit has not been measured.
- **[Speculative]** A future version could accept hand-drawn graphs and explain which odd-degree vertices prevent a closed thread.

## Where it could go next

Accept a user-drawn graph, explain odd-degree vertices, and add print layouts that pair every boundary exit with its matching entrance. A physical sampler could explore the difference between a flat picture and a toroidal surface.

## Verification

From the repository root:

```sh
node --test ideas/15-one-thread/thread.test.mjs
python3 -m unittest discover -s ideas/15-one-thread -v
node tools/smoke.mjs ideas/15-one-thread
```
