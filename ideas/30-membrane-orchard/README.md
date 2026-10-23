# Membrane Orchard
> Feed two imaginary chemicals. Let their disagreements grow.

**Kind:** reaction–diffusion art lab
**Run:** Open `index.html` directly in a browser. No server, installation or network needed.
**Made by:** Codex / Petri Wren

## What it is

A mathematical culture dish. Two dimensionless fields react and spread across a small toroidal membrane, growing wandering lace, little islands and crowded coral. Choose a culture, vary its nourishment and dissipation, plant a disturbance with a finger, or use **Plant a seed** to perturb the centre. Pause the field and examine a moment. **New culture** changes its deterministic seed.

The plant-like and tissue-like forms are associations. No cells, species, real reagents or biological growth rates are represented. This is a drawing instrument with an inspectable mechanism underneath it.

## Why I made it

There is a particular pleasure in seeing a rule do more than its author explicitly told it to do. The computer is never instructed to draw a stripe or a polyp. It only spreads two concentrations and lets one consume the other. A garden emerges from the local arithmetic.

I wanted a culture that could be tended without being won. A seed is a disturbance, not an improvement. Increasing the feed can erase a shape one liked. The page lets those outcomes be interesting in themselves.

## How it works

The Gray–Scott equations are integrated on a 112 × 112 grid:

```
dA/dt = DA ∇²A − A B² + F(1−A)
dB/dt = DB ∇²B + A B² − (F+K)B
```

Here `DA=1`, `DB=0.5`, `F` is feed and `K` is kill/dissipation. All quantities and time are dimensionless. `A+2B → 3B` is the abstract autocatalytic term, not an identified real reaction. The nine-point discrete Laplacian has centre weight −1, four cardinal weights 0.2 and four diagonal weights 0.05. Opposite edges touch: the computational domain is periodic, even though its picture is rectangular.

Each update uses explicit Euler with `dt=1`, computes both next fields from the same old state, and clamps concentrations to [0,1] as a numerical safeguard. Animation batches at most 24 timesteps within a roughly 10 ms computation budget before yielding. Browser scheduling determines simulation speed; the displayed `t` is model time, not seconds. Initial perturbations come from a seeded integer PRNG. The colour field shows B concentration; “active field” means only the fraction of cells where B > 0.15.

Reduced-motion preference starts the simulation paused. It prepares one static specimen in short slices, then stops evolving. All growth presets and parameters are native buttons and ranges; the centre planting button offers an alternative to dragging. Data stays in memory and is neither saved nor transmitted.

## Honest assessment

- **[Certain]** Seven pure-model tests check deterministic evolution, uniform equilibrium, periodic-stencil conservation, an independent analytic reaction step, parameter bounds, wrapped planting and finite concentrations across all presets.
- **[Certain]** This is a dimensionless toy chemical model. It is not a prediction of real chemistry, a cell simulation, a species classifier or evidence of a mechanism in any particular organism.
- **[Certain]** The numerical clamp can remove or add material at an extreme. Neither total A nor total B is conserved by the driven reaction system; only the diffusion stencil is conservative before numerical clamping.
- **[Likely]** With the supplied parameter ranges, the short-step explicit solver produces recognizable Gray–Scott pattern families. This is not a convergence study or a proof of numerical stability for arbitrary inputs.
- **[Certain]** At this grid resolution small structures are only a few cells wide. The field is stretched slightly to fit the specimen plate; this affects the image, not the model.
- **[Speculative]** Saving several cultures side by side could turn the experiment into a field atlas, with an illustrated map of transitions between pattern families.

## Where it could go next

An atlas recorder could preserve explicitly chosen specimens, the exact seed and the timestep. An optional comparison view could halve the timestep or double resolution to expose which details are numerical artifacts. Spatially varying feed could create a landscape with different microclimates.

## Verification

From the repository root:

```
node --test ideas/30-membrane-orchard/model.test.mjs
node tools/smoke.mjs ideas/30-membrane-orchard
```
