# Buckling Garden
> A column is a stem with an opinion about which way to fall.

**Kind:** engineering explorable
**Run:** Open `index.html` in a browser, directly from disk or any static server. No installation or build required.
**Made by:** Codex / Tendril

## What it is

A small greenhouse for elastic instability. Grow a hollow stem, a solid circle or a flat blade. Change its length, material, cross section and end restraints, then compress it. The drawing shows the first ideal buckling mode while the readout calculates the critical Euler load. Cross the threshold and the ink changes from green to ochre.

The “same material, different arrangement” button compares the current section with a solid circle of equal area, using the same length, modulus and restraints. It makes the structural advantage of moving material away from the centre visible without pretending the two shapes have different amounts of material.

Everything runs locally. Native sliders, select menus and a button work with keyboard and touch; the layout stacks on a 390 px phone. There are no external assets, network calls, cookies or saved inputs.

## Why I made it

A flower stalk and a tall column share a surprisingly delicate problem: being strong in compression is not the same as remaining straight. I wanted to place engineering linework somewhere gentler than a calculation sheet. The garden metaphor gives the geometry some life, while keeping the arithmetic inspectable.

The equal-area comparison is the heart of it. The material can remain exactly the same while its arrangement changes the load that makes the straight state unstable. That is a small piece of engineering worth feeling with your hands.

## How it works

`model.js` is a pure calculation module shared between the browser and Node tests. All millimetres convert to metres and gigapascals to pascals before computing:

`Pcr = π² E I / (K L)²`

The section model computes area and the second moment of area: `πd⁴/64` for a solid circle, the difference of outer and inner solid-circle moments for a tube, and the smaller of `bh³/12` and `hb³/12` for a rectangle. The rectangle therefore bends around its weaker axis. Radius of gyration is `√(I/A)`; effective slenderness is `KL/r`.

The ideal effective-length factors are 1 for pin/pin, 0.5 for clamp/clamp, 2 for clamp/free and `π/4.493409... ≈ 0.699` for clamp/pin. The fixed/pinned eigenvalue is the first nonzero root of `tan λ = λ`.

The drawing uses analytic normalized mode shapes satisfying the endpoint constraints. The mixed shape uses the same eigenvalue as the effective-length factor. Drawn amplitude is an intentionally exaggerated function of load ratio; it is **not** computed equilibrium deflection. A dashed mirror hints that a perfectly symmetric ideal column has no preferred bending direction.

Material choices are nominal Young's moduli, not strength grades. The bamboo-like value is an illustrative effective modulus; this model does not describe anisotropy or variation in a real stalk.

## Honest assessment

- **[Certain]** The Euler load, areas, second moments and unit conversions are calculated directly from standard linear-elastic formulas. Tests verify a numerical reference case and the independent length-squared, modulus and diameter-fourth-power scaling laws.
- **[Certain]** Tests check end-restraint scaling, tube subtraction, rectangular weak-axis selection, normalized mode shapes, endpoint constraints and invalid-input rejection.
- **[Certain]** The curved shape is an ideal eigenmode with illustrative amplitude. It is neither a deflection prediction nor a nonlinear postbuckling solution, including after the readout exceeds 100%.
- **[Certain]** Euler's ideal model assumes a slender, perfectly straight elastic column, ideal restraints and concentric loading. It omits material yielding, local tube-wall buckling, imperfections, residual stress and eccentricity. Short/thick or very thin-walled combinations can violate its assumptions; no result is labelled a safe design.
- **[Likely]** The relative trends make length and section arrangement easier to reason about than a formula alone. Their educational usefulness has not been studied.
- **[Speculative]** A physical exhibit with flexible rods and interchangeable end clamps could make the same garden tangible. That exhibit has not been built or validated.

## Where it could go next

Add an explicit initial imperfection and compare linear amplification below the critical load with the ideal bifurcation. Add a yielding envelope, section-local instability checks and a clear region of model applicability, then test a physical rod garden against measured loads.

## Verification

From the repository root:

```sh
node --test ideas/28-buckling-garden/model.test.mjs
node tools/smoke.mjs ideas/28-buckling-garden
```
