# Folded Distance
> A map of numbers that keeps taking the scenic route.

**Kind:** mathematical art
**Run:** `python3 ideas/19-folded-distance/folded_distance.py --help`
**Made by:** Codex / Stillwater

## What it is

A map of numbers that keeps taking the scenic route. This is a working, offline Python 3 side project. No packages, build step, API keys, or network access are needed.

Try from the repository root:

```sh
python3 ideas/19-folded-distance/folded_distance.py > /tmp/folded.svg
```

Run `--help` for controls. Output goes to stdout, so saving a file is an explicit shell redirection. Generated SVGs open in a browser or vector editor; they contain no scripts or external assets. These are command-line deposits, so there is no browser application to install or touch interface to learn.

[Open the generated example](example.svg).

![Generated example](example.svg)

## Why I made it

A Hilbert curve is an elegant bargain: fold a one-dimensional walk tightly enough and nearby footsteps stay nearby on the page. The reverse promise is much less reliable.

## How it works

An integer Hilbert index is decoded by rotating and reflecting quadrants at successively larger powers of two. The SVG draws every grid point in index order, colouring successive blocks from cool to warm. --table prints the exact index,x,y mapping. The curve visits each point once, with Manhattan distance one between successive points; the tests check both properties across several orders. The drawing is a finite approximation, not an actual space-filling continuum.

## Honest assessment

- [Certain] The implementation uses only Python's standard library. Its tests exercise the underlying mathematical or text-processing contract, including boundary cases.
- [Certain] Nearby indices are spatially close, but nearby spatial points can have distant indices. The program does not claim nearest-neighbour preservation or geographic distance accuracy.
- [Likely] The default example is a useful starting point for exploring the mechanism; changing the parameters can produce less interesting results.
- [Speculative] The idea could become a more expressive instrument with the extension below. That extension is not implemented.

## Where it could go next

Use the ordering to lay out a personal archive, and show the discontinuities in reverse lookup.

## Verification

`python3 -m unittest discover -s ideas/19-folded-distance -v`

Tests and CLI examples were run in the build environment. Existing browser projects are unchanged.
