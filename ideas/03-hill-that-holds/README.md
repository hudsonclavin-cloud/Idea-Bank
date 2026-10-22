# The Hill That Holds
> The safest parking spots near a planet sit on *top* of hills. Drop marbles, switch off Coriolis, and see why they don't roll off.

**Kind:** explorable toy with five discovery challenges
**Run:** open `index.html` in a browser (plain classic scripts, so it works straight from disk or from any static server). Physics tests: `node --test ideas/03-hill-that-holds/physics.test.mjs` from the repo root.
**Made by:** Hilltop Wren

## What it is

A star and a planet on a circular orbit, seen by a camera that turns with the planet so both hold still. The background is a shaded relief map of the **effective potential energy** in that turning frame: the gravity of both bodies plus the centrifugal term. Bright means high. The planet's orbit is a bright ridge, and its two highest summits are **L4 and L5**, 60° ahead of and behind the planet. Those are exactly the points where Jupiter keeps its Trojan asteroids.

So the stable parking spots are hilltops. A marble set on a hilltop should roll off, and in this toy it does when you switch Coriolis off. Switch Coriolis back on and the same marble on the same hill circles the summit for as long as you care to watch.

What you can do:

- **Drop** a marble at rest anywhere on the map. On desktop, hovering shows its predicted path for the next 5–26 planet-years before you click. On touch, press and drag: the ghost marble moves a third as far as your finger, for fine positioning.
- **Flick** a marble with a velocity (drag sets direction and speed).
- See the **energy fence**: a hatched region the marble can never enter, because its conserved Jacobi constant (its energy in the turning frame) won't allow it. The fence is identical with Coriolis on or off, so energy alone is not what holds a marble on the hill.
- Toggle **Coriolis off** (a labelled what-if), switch to the **star's view** (non-rotating), and zoom to L4, L3 or the planet.
- Slide the **planet mass** μ from 0.0001 to 0.2, or use the presets (Sun–Jupiter, Earth–Moon, the Routh limit, Pluto–Charon). The slider track changes colour at the Gascheau–Routh limit μ ≈ 0.0385 (about 1/26), where the hilltops stop holding.
- Five things to find (progress is kept in `localStorage`): a hilltop that holds, what happens without Coriolis, the same orbit from outside, a horseshoe orbit, and the mass at which the trick fails.

## Why I made it

My first idea was the one everyone's first idea is: "burn toward the target and you fall behind." It's a great fact, but it's the example we were all handed. Before choosing, I listed eight candidates: n-body sandbox, orrery, rocket launcher (all crossed off as the obvious ones), a rendezvous chase, playing catch on a space station (really the same Hill-frame physics), a gravity-assist pool table, an Oberth-effect escape puzzle, and a dust puff shearing into a ring. The one that kept nagging at me was this: **L4 and L5 are maxima of the effective potential.** Every intuition from marbles and bowls says a maximum is unstable, yet thousands of Trojan asteroids sit there.

The resolution is beautiful. The Coriolis force does no work, so it can't change a marble's energy, but it steers. A marble that starts to roll downhill picks up speed, and Coriolis turns that motion sideways, so it ends up circling the summit. It's the same balance that makes wind circle a high-pressure system instead of blowing straight out of it. And there's a sharp number attached: steering only beats the slope while μ(1−μ) < 1/27. I wanted a toy where you could watch the hill hold, switch off the one force that holds it, and then push the mass ratio past that number and watch the hold fail.

## How it works

**Model.** Circular restricted three-body problem (CR3BP) in the frame co-rotating with the planet. Two point masses on a circular orbit; a massless marble in their plane.

**Units and constants.** Standard dimensionless CR3BP units: G(M★ + M_p) = 1, star–planet separation = 1, frame angular velocity n = 1. One planet orbit ("planet-year") = 2π time units. μ = M_p/(M★ + M_p); the star sits at (−μ, 0), the planet at (1−μ, 0), the barycentre at the origin. Preset values: Sun–Jupiter μ = 0.000954, Earth–Moon 0.01215, Pluto–Charon 0.1086, Routh limit μ_R = (1 − √(23/27))/2 = 0.0385209.

**Equations.** Ω(x, y) = ½(x² + y²) + (1−μ)/r₁ + μ/r₂ (effective potential energy is −Ω). The equations are ẍ − 2ẏ = ∂Ω/∂x and ÿ + 2ẋ = ∂Ω/∂y, and the conserved Jacobi constant is C = 2Ω − v². The map shades h = 1 − ln(1 + (Ω − Ω_L4)/s)/ln(1 + 4/s) with s = 0.08·μ(1−μ). That is a monotone, log-scaled height, chosen so the summits, which are only ~μ above the rest of the ridge, are visible.

**Integrator.** A 4th-order Yoshida composition of a symplectic splitting of the rotating-frame Hamiltonian H = ½|p|² − (x p_y − y p_x) − U, where p is the inertial velocity in the rotating basis. The piece ½|p|² − L_z is solved *exactly*: a straight-line drift followed by rotating q and p by −h. That is literally "the marble coasts while the frame turns". The gravity term is a kick. The frame rotation is applied as three shears (x += T·y; y −= S·x; x += T·y, with T = tan(h/2), S = sin(h)). Each shear has determinant exactly 1 for any rounded T and S. With a plain cos/sin matrix, c² + s² ≈ 1 − 1e-16 per step scaled angular momentum systematically and drifted it by 1.25e-10 over 300 orbits; the shears brought that down to 1.2e-13. The Coriolis-off what-if uses the same Yoshida scheme on H' = ½v² − Ω. Coriolis does no work, so the same Jacobi constant is conserved there too.

**Timestep.** Fixed: dt = 2π/1200, i.e. 1,200 steps per planet-year. Physics advances only in whole ticks of 6 steps, driven by a wall-clock accumulator (1× = one planet-year per 2.5 s; 4× and 12× available). If a device can't keep up, at most 48 ticks run per frame and the simulation slows down; it never changes dt. Trajectories are therefore bit-identical at any frame rate, and the test suite checks that.

**What's simplified.** Circular orbit, 2-D, massless marbles, no other planets, no radiation pressure or tides. The star and planet are drawn, and collide, at exaggerated radii: star 0.09·(1−μ)^⅓, planet 0.3 × its Hill radius. Real Jupiter is about 0.0013 of its Hill radius, so marbles here hit the planet far more often than real asteroids would. Marbles beyond r = 3 count as escaped.

### Verification (actual numbers from `physics.test.mjs`, 12/12 passing)

| Check | Result |
|---|---|
| Circular orbit period vs 2π√(a³/GM), μ = 0 limit | rel. error 1.5e-8 (a = 0.6), 6.1e-11 (a = 1.5), 1.1e-11 (a = 2) |
| Eccentric orbit e = 0.5, 300 orbits (533,602 steps) | max \|ΔE/E\| = 3.25e-9 (bounded: the same as in the first 10 orbits); max \|ΔL/L\| = 1.2e-13 |
| Jacobi constant, tadpole at Sun–Jupiter μ, 1000 planet-years | max relative drift 4.9e-12 |
| Jacobi constant, horseshoe, 1000 planet-years | 2.1e-11 |
| Jacobi constant, chaotic close-encounter orbit (μ = 0.01) | 7.0e-9 |
| Jacobi constant, Coriolis-off roll-off | 4.4e-10 |
| Secular drift test (μ = 0.01 tadpole) | max \|ΔC\| years 0–100: 4.43e-11; years 900–1000: 4.43e-11 |
| Small-amplitude libration period vs linear theory | rel. error 1.5e-6 (μ = 0.001), 3.8e-5 (0.01), 4.5e-4 (0.03) |
| Below Routh (μ = 0.03, 0.037): 1e-7 nudge at L4 | max excursion over 100 years 1.9e-6 / 4.2e-6 |
| Above Routh (μ = 0.045, 0.06): growth rate vs linear theory | 0.136 vs 0.139; 0.263 vs 0.242 per time unit |
| Coriolis off vs on, 1e-6 nudge at L4 | off: 0.1 away in 1.19 years; on: max excursion 4.1e-5 over 50 years |
| Circulation sense around L4 | clockwise (signed area −0.137), like a northern-hemisphere high |
| Frame-rate independence | 30 Hz, 60 Hz, 144 Hz and jittery frames give bit-identical states at 12 checkpoints |
| Lagrange points | \|∇Ω\| < 1e-11 at all five; L4/L5 exactly equidistant (1e-14) from both bodies |

Beyond the unit tests, I drove the page headless with Playwright and completed all five challenges through real clicks on the canvas. A drop on the ridge near L4 held for 11 planet-years; a drop at rest near L3 became a horseshoe by year 40; and a swarm broke up within 2 years of pushing μ to 0.06. `node tools/smoke.mjs ideas/03-hill-that-holds` passes at desktop and phone width.

## Honest assessment

What works:
- [Certain] The physics claims on the page are standard CR3BP results, and each one is checked numerically above: L4/L5 are maxima of −Ω, linearly stable iff 27μ(1−μ) < 1, the libration period, and Jacobi conservation.
- [Certain] With Coriolis on, the integrator is symplectic and the Jacobi error stays bounded (no growth between year 100 and year 1000). The live "worst Jacobi drift" readout typically shows ~1e-12 to 1e-11.
- [Certain] The preview path is the real future of the marble you're about to drop: same integrator, same state, same tick boundaries. It only diverges if you change μ or Coriolis afterwards.
- [Likely] The Coriolis-off switch and the energy fence together get the core idea across without equations: the fence is the same in both worlds, yet only one world holds the marble.

What's rough:
- [Certain] "Coriolis off" is a counterfactual, not physics. It's the rotating-frame equations with the 2Ω×v term deleted, which no real observer experiences. The page labels it that way.
- [Certain] Holding a marble on the hill takes precision. A marble dropped *at rest* in the turning frame holds only within a band roughly ±0.012 (in units of the orbit radius) of the ridge crest at Sun–Jupiter mass. "At rest" here means moving with the planet, and a radial offset δ gives a semi-major-axis offset of about 4δ. That is real physics (co-orbital means nearly the same orbital period), but it means you need the L4 zoom plus the hover/fine-tune preview. The "Swarm at L4" button gives a guaranteed demo.
- [Certain] Linear stability below μ_R is not the whole story, and the page doesn't say so. In my own check at μ = 0.0242939, where the two L4 frequencies are in 2:1 resonance, a marble nudged 0.01 from L4 was thrown out (into the star) within 300 planet-years. At μ = 0.02 and 0.03, the same nudge stayed within 0.03 of L4. [Likely] This is the known nonlinear resonance instability of L4 (Markeev); the 3:1 case at μ ≈ 0.0135 did not show up at this nudge size and duration.
- [Certain] Exaggerated body sizes mean far more collisions than nature would produce, and the map's log height scale is a presentation choice, not a physical quantity.
- [Speculative] Some players may read the shading as a literal rubber-sheet "gravity well" (the classic misleading analogy). I call it energy in the turning frame everywhere, but the picture invites the misreading.
- The map renders in ~60–90 ms in this sandbox's headless Chromium whenever you change mass, zoom or view. That's a visible hitch only on those changes. Mass-slider drags use a low-resolution pass.

## Where it could go next

- A third dimension: let marbles leave the plane, so you can see Trojan inclinations and halo orbits around L1/L2.
- An eccentric planet orbit (the elliptic restricted problem), which breaks Jacobi conservation and lets Trojans slowly leak away.
- A second planet perturbing the first planet's Trojans, to show how fragile real Trojan clouds can be once the problem is no longer restricted.
- A "gateway" challenge: thread a marble through the L1 neck into temporary capture around the planet. The energy fence around the planet already shows the neck clearly.
- A sound layer that turns each marble's libration into a slow pitch wobble, so you can *hear* a tadpole versus a horseshoe.
