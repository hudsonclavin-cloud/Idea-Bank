# Molecular Choir
> Change an atom’s weight. Hear a bond find a lower voice.

**Kind:** chemistry instrument
**Run:** Open `index.html` in a browser. No server, build, or installation needed.
**Made by:** Codex / Overtone

## What it is

A small instrument made from an invisible motion. Two masses share a spring. Change either mass or the spring stiffness and watch their opposite displacements preserve a fixed center of mass. Beside the molecule, a pair of spectral markers compares the chosen pair with a right atom exactly one unified atomic mass unit heavier. Press **Play the isotope duet** to hear the original, then the heavier version.

It is an explorable harmonic analogy, not a database of real molecules or a prediction of infrared spectra. Integer masses are illustrative. The spectral markers show only frequencies: their identical heights are not absorption intensities. The motion is slowed for viewing, while audio uses a fixed frequency division so interval ratios survive.

## Why I made it

An isotope is almost the same chemical character carrying a different amount of inertia. I wanted to make that difference audible without pretending that a molecule literally makes sound at these pitches. The visual molecule is intentionally spare: a bond, two weights, a fixed center, and an interval that moves when the weight changes. It makes one small equation into an instrument.

The two-tone sequence is the central interaction. Adding mass does not merely move a number down a screen; it changes a note that was just in your ear.

## How it works

The pure `molecule.js` model uses reduced mass μ = m₁m₂/(m₁+m₂) and angular frequency ω = √(k/μ). Physical frequency is f = ω/(2π). Inputs are mass in u and spring stiffness in N/m. The conversion uses 1 u ≈ 1.66053906892 × 10⁻²⁷ kg (CODATA 2022, not an exact constant); the speed of light is exactly 299792458 m/s. Wavenumber in cm⁻¹ is f/(100c).

Both displacements come from an analytic sine, divided inversely by the masses, so m₁x₁ + m₂x₂ = 0 relative to equilibrium. There is no numerical time integration to become unstable. The slow drawing preserves the relative change in frequency but has a separate illustrative time scale.

Sonification divides each physical frequency by 2³⁷. All control combinations stay within the playable 20–16000 Hz range. A sine oscillator uses a short attack and decay envelope. Sound starts only after a button press, stops after the two notes, and is interrupted when the page becomes hidden. Changing an input before playing creates a new duet. There are no network calls, stored inputs, microphone access, or external assets.

The controls are native range inputs and buttons usable by keyboard or touch. The bench stacks on a phone. Reduced-motion preference starts the animation paused; motion can always be paused or resumed.

## Honest assessment

- **[Certain]** The two-mass harmonic oscillator equations are implemented in SI units and tested for mass-swap symmetry, stiffness/mass scaling, center-of-mass invariance, unit conversion, input guards and sonification interval preservation.
- **[Certain]** This model omits anharmonicity, coupling to other modes, rotation, electronic structure, selection rules and environment. It is not a computed real-molecule spectrum. A real isotope substitution also changes mass by its actual isotope mass difference, rather than exactly 1 u.
- **[Certain]** The animated motion and audible notes have deliberately different time scales from physical vibrations; the page labels both transformations.
- **[Likely]** Hearing the notes in sequence makes an isotope shift easier to notice than reading a small frequency difference. This is a design judgment, not an evaluated learning result.
- **[Speculative]** A larger choir of coupled masses could turn normal-mode structure into a richer musical instrument. That is not implemented here.
- **[Certain]** Sound depends on browser Web Audio support and permission to start after interaction. Every numerical and visual function remains available without sound.

## Where it could go next

Add a three-mass chain with independently playable normal modes, then explicitly separate frequency predictions from infrared activity. Another direction is a printed isotope-score card that carries the mathematical interval even when no speakers are available.

## Verification

From the repository root:

```sh
node --test ideas/29-molecular-choir/molecule.test.mjs
node tools/smoke.mjs ideas/29-molecular-choir
```
