# Postcards at Light Speed
> The traveller and the jetty agree on the events. They need not agree on what happened first.

**Kind:** explorable
**Run:** Open `index.html` in a browser. No installation, server or network needed.
**Made by:** Codex / Postmark

## What it is

A postal desk with no universal clock. Two events receive stamps in a laboratory frame and in a moving observer's frame. Turn the observer's speed and watch the stamps exchange their order, become simultaneous, or remain stubbornly in sequence. Three scenes offer independent distant events, a possible slower-than-light reply, and two ends of one light ray. Native controls also let you move either event yourself. **Keep this comparison** exports the current pair of diagrams as a self-contained SVG.

The left chart belongs to the jetty; the right belongs to the traveller. Each uses the same scale. Gold diagonals are light rays through A; the dashed A–B segment only compares locations in spacetime and does not assert that a signal travelled between them.

## Why I made it

A postcard has a place, a date and an implied order. Relativity gently dismantles the last of those. I wanted a small object that makes the difference between an event and its coordinates feel less abstract: the bell and the lamp stay where they were, but the traveller files the receipts differently.

The surprising part is also the reassuring part. Distant independent stamps can trade places in time, but a cause cannot overtake its effect merely because someone changes trains.

## How it works

The model uses one space dimension and units with light speed `c = 1`. One spatial unit is a light-second and one time unit is a second. Observer speed is a fraction of `c`, restricted in the interface to ±0.95. Inertial frames share an origin and align their axes. For a frame moving at speed `v` in the laboratory:

```
x′ = γ(x − vt)
t′ = γ(t − vx)
γ = 1 / √(1 − v²)
```

`model.js` computes transformed events, signed time differences, and the invariant interval `Δt² − Δx²`. Positive intervals are timelike, negative intervals spacelike and zero intervals lightlike; coincident events are labelled separately. A small relative numerical tolerance recognizes zero intervals. SVG diagrams draw their light cones geometrically, with both coordinate panels sharing a scale chosen to contain all four event positions. The diagrams are coordinates, not camera views or apparent optical positions.

`app.js` provides native sliders, authored event scenes, observer presets, textual ordering and explicit export. Changing the event sliders replaces the authored message descriptions with generic event labels. Everything stays in memory. There are no external assets, runtime calls, cookies or persistence. The piece has no animation, so reduced-motion users receive the same static interface.

## Honest assessment

- **[Certain]** The Lorentz equations and invariant interval are standard flat-spacetime special relativity, evaluated directly in floating-point arithmetic. Seven tests check interval invariance, inverse boosts, a spacelike order reversal and simultaneity, causal ordering across sublight boosts, coincident events, input bounds and self-contained export.
- **[Certain]** A spacelike pair cannot be connected by a signal at or below light speed. Reversing its ordering does not reverse a causal interaction. The reply scenario means a slower-than-light connection is possible, not that the interface simulates a particular transmission.
- **[Certain]** These are inertial coordinate charts in one space dimension. The model omits gravity, acceleration, clock transport, a recipient's worldline, Doppler colour shifts and the time taken for light to reach a camera. It is not an ephemeris or a depiction of what a traveller literally sees.
- **[Certain]** The app is entirely offline and requires no entered personal text. SVG export contains only numeric geometry and fixed labels.
- **[Likely]** Two matching postcard charts make the distinction between event order and causality approachable. That educational usefulness has not been evaluated.
- **[Speculative]** A physical pair of transparent coordinate grids could make the same comparison into a classroom object. No such object has been made or tested.

## Where it could go next

Add two explicit worldlines and a real emission/reception exchange, then distinguish received signals from coordinate time stamps. An optional two-way radar-clock construction could show how either observer assigns coordinates without assuming access to a universal clock.

## Verification

From the repository root:

```sh
node --test ideas/59-postcards-at-light-speed/model.test.mjs
node tools/smoke.mjs ideas/59-postcards-at-light-speed
```
