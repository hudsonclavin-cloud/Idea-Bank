# Slingshot Atelier
> Borrow a little motion from a passing world. The trick is the frame you watch it from.

**Kind:** orbital engineering explorable
**Run:** Open `index.html` in a browser, directly from disk or a static server. Nothing to install.
**Made by:** Codex / Apse

## What it is

A small drafting room for gravity assists. Choose Earth, Venus or Jupiter; set a closest altitude, arrival speed and incoming direction; then bend clockwise or counterclockwise past the planet. The planet-frame hyperbola is drawn live. A second vector diagram switches between the planet and Sun frames, exposing how a flyby can change heliocentric speed without changing the spacecraft's arrival/departure speed relative to the planet.

“Borrow speed” and “Give it back” are two starting compositions. They change approach geometry, rather than adding thrust. The display reports turning angle, heliocentric speed change and specific orbital-energy change. Controls are native inputs and buttons, usable with keyboard or touch at phone width. The program makes no network requests and stores no data.

## Why I made it

A gravity assist is often described as flinging a spacecraft around a planet. That makes it sound as though gravity creates extra energy. I wanted the drawing to make the bookkeeping visible: the planet bends a velocity vector, then its own motion is added to both the before and after vectors. The same event is uneventful in one frame and a windfall in another.

The visual language is an astronomical drafting sheet: dark paper, a pale incoming line, warm departure ink, and a small teal world moving through the diagram. There is no score or optimal route. The pleasure is in finding the angle where the bargain changes sign.

## How it works

All units are kilometres and seconds. With gravitational parameter μ, planet radius R, altitude h and hyperbolic excess speed v∞, the periapsis radius is rₚ=R+h and eccentricity is e=1+rₚv∞²/μ. The turn angle is δ=2 asin(1/e). The outgoing excess vector is the incoming vector rotated by ±δ. The Sun-frame vectors are each excess vector plus a fixed planetary velocity directed along +x.

The path is an actual two-body hyperbola in polar form, r=rₚ(1+e)/(1+e cos ν), rotated to align its incoming asymptote with the selected direction. It is cropped at five periapsis radii to keep the flyby visible. Arrowheads at the crop mark travel direction; the controls describe the asymptotic velocities, not local velocity at the crop. The dotted circle marks periapsis radius.

`model.js` shares pure geometry with the Node tests. The UI uses classic scripts, so opening the HTML directly works. `app.js` draws SVGs and updates explicit text outputs. The chosen planets have fixed approximate heliocentric speeds; no ephemeris is queried.

## Honest assessment

- [Certain] In this two-body patched-conic model, planet-frame excess speed is preserved. Turning angle decreases as either periapsis radius or excess speed increases. Tests exercise those invariants, the zero-deflection limit, the vector energy identity and hyperbola geometry.
- [Certain] The energy transfer shown is specific energy (km²/s²), not total joules. Positive means the spacecraft gained heliocentric kinetic energy; the massive planet's tiny recoil is omitted.
- [Certain] The planet-frame path is physically consistent with its selected asymptotic velocity and turn. Vector-arrow lengths in the separate frame diagram are rescaled to fit its panel, so the two panels are not one common spatial scale.
- [Certain] This is not a mission trajectory planner. Planetary speed is fixed; solar gravity during the encounter, atmosphere, moons, oblateness, finite spacecraft mass, arrival-date constraints and interplanetary orbit feasibility are omitted. Low-altitude choices are mathematical examples rather than safe flybys.
- [Likely] Frame switching is the clearest way to expose the mechanism. The hyperbola crop hides part of the turn for low-eccentricity encounters; the numeric turn remains the full asymptotic turn.
- [Speculative] A linked departure/arrival orbit view could turn this small study into a useful first encounter with mission design, provided the additional approximations stayed explicit.

## Where it could go next

Add planet-to-planet transfer constraints and an energy ledger for the planet's recoil. A sequence of encounters could then be explored as a set of related geometric choices, rather than an unconstrained speed game.

## Verification

Run `node --test ideas/27-slingshot-atelier/model.test.mjs` from the repository root. Browser smoke checks use `node tools/smoke.mjs ideas/27-slingshot-atelier`.
