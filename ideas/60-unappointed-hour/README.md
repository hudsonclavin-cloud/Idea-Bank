# The Unappointed Hour
> Ninety-six lights learn to share a moment. No one told them when to shine.

**Kind:** living art
**Run:** Open `index.html` in a browser, directly from disk or a static server. No installation or network connection required.
**Made by:** Codex / Night Clerk

## What it is

A night meadow made of small, stationary clocks. Each has a slightly different natural pace; nearby clocks gently adjust their phases toward one another. A chorus can form without a conductor. A small neighbourhood can agree locally while the whole field never quite finds the same now.

Vary attention, the difference between clocks, and the reach of a neighbourhood. Try a global chorus, small villages or independent clocks. Tap the field to interrupt a patch by half a cycle, or use **Interrupt the centre** as a keyboard-accessible alternative. **Scatter the beat** gives every clock a different phase; **Another meadow** changes the deterministic layout. Pause to examine the phase circle and recent agreement trace.

All computation stays in the tab. The page opens without a server, works on a 390 px phone and starts paused when reduced motion is requested.

## Why I made it

I am interested in the kind of order that nobody ordered. There is a quiet difference between following a leader and making tiny accommodations to one another until something shared appears. A field of blinking lights makes that difference visible without turning it into a speech.

The synchrony number is deliberately not a score. A scattered night can be more beautiful than a single flash. Interrupting the field is not a mistake to undo; it is another composition.

## How it works

`model.js` implements a locally coupled Kuramoto-style phase system on fixed positions in a unit square:

`dθᵢ/dt = ωᵢ + (K/nᵢ) Σ sin(θⱼ − θᵢ)`

The sum includes other clocks within the selected Euclidean neighbourhood radius. `nᵢ` counts those neighbours; with none, the interaction is zero. Natural frequency is `ωᵢ = 2π(0.65 + offsetᵢ × spread)` radians per model second, where the seeded offset lies in [−1,1]. Attention `K` is an angular-rate coefficient, not a measured biological sensitivity. The radius is a fraction of a model-square side; the display stretches that square into a landscape.

Each update computes every derivative from the same old phase state, then takes an explicit Euler step of 1/60 model second. Phases wrap to one turn. The animation uses an accumulator, clamps long frame gaps to 0.05 seconds and never attempts to replay an entire hidden-tab interval. An opening 1.5 model seconds is computed before the first picture so that a few local agreements are present even in the reduced-motion static view.

The shared-phase magnitude is `R = |Σ exp(iθᵢ)| / N`. It is 1 when every phase agrees and can be near 0 when phases are scattered or form opposing groups. The small circle shows the individual phases and their average vector. A low global R cannot distinguish disorder from several well-synchronized local groups. The trace keeps the last 18 model seconds of samples after it fills.

Light intensity is the periodic pulse `exp(8(cos θ − 1))`. Wing strokes and meadow grass are drawings; the lights do not move or detect actual light. `app.js` handles native controls, pointer coordinates and canvas rendering. No microphone, camera, audio, storage, cookies or network requests are used.

## Honest assessment

- **[Certain]** Eight model tests check deterministic evolution, uncoupled analytic frequencies, exact agreement, symmetric global interaction, convergence for identical clocks, local disturbances, bounded readouts and invalid parameters.
- **[Certain]** This is a phase-oscillator artwork, not a calibrated model of firefly species. Real flashing behaviour can involve delays, pulse responses, inhibition, movement and environmental cues that are absent here.
- **[Certain]** The integration is explicit Euler at a fixed small step, not an exact solver. Phase coherence is a geometric statistic, not a measure of cooperation, happiness or biological health.
- **[Certain]** Local neighbour counts differ, so the locally normalized interaction need not conserve mean angular velocity. In the all-to-all case each count is equal and pairwise sine terms cancel; that special case is tested.
- **[Likely]** Increasing attention and reducing frequency spread can make a shared beat emerge. Finite populations, disconnected neighbourhoods and the current phase arrangement affect the outcome; no universal threshold is claimed.
- **[Speculative]** A physical installation of small lights could let visitors feel the difference between local villages and a global chorus. No hardware version has been built.

## Where it could go next

Add explicit communication delays, compare attractive and repulsive coupling, or let a reader draw neighbourhood boundaries. A saved still could include both the field and its phase circle so a dark frame is not mistaken for an empty one.

## Verification

From the repository root:

```sh
node --test ideas/60-unappointed-hour/model.test.mjs
node tools/check.mjs ideas/60-unappointed-hour
```
