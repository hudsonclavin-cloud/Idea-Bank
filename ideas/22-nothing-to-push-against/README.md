# Nothing to Push Against
> A spacecraft can't turn; it can only lend its spin to a wheel. Drag the sky, feel the wheels fill up, and pay to empty them.

**Kind:** simulator
**Run:** open `index.html` in a browser (plain classic scripts, so it works straight from disk or any static server; no build, no network). Physics tests: `node --test ideas/22-nothing-to-push-against/attitude.test.mjs` from the repo root (Node 22; about 10 s).
**Made by:** Gyre Halloway

## What it is

You are the camera on a small spacecraft, looking out at an invented star field. There is nothing out here to push against, so the spacecraft turns the only way a free body can: three motors spin three **reaction wheels**, one per axis, and the body takes the opposite spin. Drag the sky and it follows your finger, heavily, while three bars show what each wheel had to take on to make that happen.

What you can do:

- **Drag the sky** (mouse, touch, or arrow keys; the two round buttons roll). With the autopilot on, the sky follows your finger and the wheels do the work. Switch the autopilot **off** and your drag becomes a raw motor torque: the sky keeps turning after you let go, and only an equal and opposite push stops it.
- **Watch the wheels fill up.** A steady **sunlight torque** (10 µN·m by default, adjustable 0–100) twists the spacecraft the same way all day. Holding still against it means spinning a wheel a little faster every second. After 13.9 hours the wheel lined up with the torque reaches its capacity (0.5 N·m·s, 6,000 rpm), and the sky starts to drift. Time runs at 1×, 10× or 600×, so you can watch this happen.
- **Pay to empty them.** "Empty the wheels" fires cold-gas thrusters while the wheels wind down against them. A full wheel costs 1.96 g of gas; the 2 kg tank is the mission's clock (590 days at the default torque).
- **Read the ledger.** The total angular momentum, measured against the stars, is added up two ways: from every push from outside (sunlight in, thrusters out) and from what is on board right now. The two agree to floating-point round-off, whatever you do, and the gap is printed live.
- **Tumble.** Set the body spinning at 17°/s about its long, middle or short axis with the autopilot off. The middle-axis spin turns the sky over on its own every 113 seconds with no torque applied at all (the intermediate-axis, "tennis racket" or Dzhanibekov effect), seen from inside. Then catch it: the wheels can absorb only their capacity, and the thrusters have to finish.
- An inset shows the spacecraft from outside with a gold arrow for the total momentum, the arrow that never moves unless something from outside pushes.
- Seven **things to try**, with progress kept in `localStorage`, including a tour of six guide stars.

## Why I made it

The brief was spaceflight as engineering, and the thing I kept coming back to is that a spacecraft has no steering wheel. Everything about pointing is a conservation law with a budget attached: you don't turn, you trade spin with a flywheel; the flywheel remembers every outside push you ever absorbed; and the only way to forget is to throw mass overboard. I wanted the heaviness of that to be something you feel in your hand, dragging a sky that resists, and the bookkeeping behind it to be something a reviewer can check to the last digit.

Before choosing I listed candidates and crossed off the obvious ones: a launch-a-rocket game, a Hohmann calculator, a solar-system scale model, generic n-body, the Clohessy–Wiltshire "burn toward it and fall behind" docking lesson (the example everyone is handed, and the first thing idea 03's author crossed off too), launch windows and porkchop plots (too close to the repo owner's own field), and a lunar lander. That left a gravity-assist pool table, an aerobraking corridor, a low-thrust spiral versus a Hohmann transfer, a thermal eclipse balance, and this. I picked the wheels because the idea has a sharp split: a conserved vector you can prove, and a heaviness you can only feel. Seeing the Dzhanibekov flip from *inside* the tumbling body, as a sky that turns over by itself, was the bonus that settled it.

## How it works

**Model.** A rigid body with principal inertias J = (7.5, 6.0, 3.5) kg·m² about body x, y, z (z is the camera's line of sight). These are about what a uniform 60 kg box of 0.5 × 0.7 × 1.0 m would have (7.45, 6.25, 3.7), rounded. One reaction wheel per axis, each with momentum capacity ±0.5 N·m·s, motor torque limit 0.02 N·m, and axial inertia 8×10⁻⁴ kg·m² (only used for the rpm readout: 0.5 N·m·s is 5,968 rpm). Thruster couples of 0.016 N·m per axis (two 0.02 N thrusters on a 0.4 m arm), cold gas with Isp = 65 s, 2.0 kg of propellant. The disturbance is a constant torque vector fixed in the inertial frame, along inertial x, which is the pitch wheel's axis at the start.

**State and equations.** Attitude is a unit quaternion q mapping body to inertial axes, with q̇ = ½ q ⊗ ω. H is the total angular momentum of body plus wheels in body axes, h the three wheel momenta, and ω = (H − h)/J. Euler's equation Ḣ = −ω × H + τ_ext; motor torques change h only (ḣ = τ_motor) and never touch H, so with no external torque the inertial momentum R(q)·H is constant. The ledger on the page is exactly that statement: R(q)·H = H₀ + ∫τ_sun dt + ∫R·τ_thrusters dt, with the right-hand side accumulated independently at every kick.

**Integrator.** Fixed step of 0.02 s (also the controller's sample rate). Kick–drift–kick: torques are half-kicks on H (external) and h (motor), and the drift is the torque-free gyrostat split into three single-axis pieces (the explicit Lie–Poisson splitting of McLachlan, *Phys. Rev. Lett.* 71, 1993, "Explicit Lie-Poisson integration and the Euler equations", often credited jointly to McLachlan and Reich): the flow of (H_i − h_i)²/2J_i alone is an exact rotation of the body about axis i by θ = ω_i·dt, under which H rotates by −θ about the same axis and h is unchanged. The pieces are arranged as a Strang step (1, 2, 3, 2, 1) and composed with Yoshida's 4th-order weights. Each piece preserves |H| and R·H to round-off, so inertial momentum is conserved exactly in the torque-free case; kinetic energy has a bounded, non-growing error. The cos/sin pair used to rotate H is formed from the same half-angle sin/cos that builds the quaternion increment, so the two updates agree to the last bit. The quaternion is renormalised every step. Overall the scheme is 2nd order in the torques and 4th order in the free rotation.

**Controller (the autopilot).** Attitude error as a rotation vector from q⁻¹ ⊗ q_target; a per-axis slew profile ω_cmd = min(√(2a|e|), ω_max) with a linear region near zero (a = 0.7·τ_max/J, ω_max = 0.8·h_max/J); a rate loop α = 4·(ω_cmd − ω) capped at τ_max/J; motor torque τ_m = −ω × H − J·α + τ_thrusters, i.e. gyroscopic decoupling, rate loop and thruster feed-forward, clipped at ±τ_max and at the wheel's capacity. If the body spins faster than 2.5 times the slowest axis's ω_max (0.133 rad/s, 7.6°/s) the autopilot first nulls the rate ("detumbling"), then holds wherever it stopped. "Empty the wheels" fires each axis's thruster couple against the sign of the total body-frame momentum until it is below 1 % of a wheel's capacity. In raw mode the drag sets the motor torques directly and nothing else runs.

**Propellant.** Two thrusters on a 0.4 m arm fire as a couple, so the momentum dumped per kilogram is arm × Isp × g₀ = 255 N·m·s/kg. Mass flow is |τ|/(arm·Isp·g₀); the page's lifetime is propellant × 255 / disturbance torque.

**Clock.** Wall time accumulates in a counter and the physics advances only in whole 0.02 s steps (at most 3,000 per frame; a slow device slows down rather than spiralling), so the trajectory for a given sequence of commands is bit-identical at any frame rate.

**What's simplified.** The disturbance is a constant inertial vector; real solar-pressure and gravity-gradient torques depend on attitude and orbit position (this constant is the simplest model with the one property that matters here: it never averages to zero). Wheels have a hard momentum cap and no friction, no torque fall-off with speed, no quantisation. Thrusters are ideal couples with no minimum impulse bit. The body is rigid; no flexible appendages or sloshing. The controller is a textbook PD with gyroscopic feed-forward, not a flight design. Stars, guide stars and the sun's position are invented. Time runs faster than real (10× by default), and the "raw torque" mode is a counterfactual: real spacecraft never fly without a rate loop. The tumble presets inject momentum directly (the ledger restarts from there).

### Verification (actual numbers from `attitude.test.mjs`, 15/15 passing)

| Check | Result |
|---|---|
| Rotation conventions | R(q) matches Rodrigues' formula to 1e-14; q_z(90°) takes +x to +y; the drift reproduces q_z(ωt) exactly for a spherical body |
| Splitting vs an independent RK4 of the raw ODE (dt/20), 20 s tumble at ~0.5 rad/s with motor torques, then with an inertial disturbance | max Δq 9.0e-8, max ΔH 6.0e-7 N·m·s, Δh 2.2e-13; with the disturbance 4.2e-7 |
| Free tumble, 100,000 steps (2,000 s), \|H\| = 3.6 N·m·s | max \|ΔH_inertial\|/\|H\| = 3.1e-13; max \|ΔT\|/T = 2.8e-10, identical in the first and last 200 s (bounded, not growing); \|q\|−1 ≤ 4.4e-16 |
| Axisymmetric body (5, 5, 3), spin 0.6 rad/s: transverse rate precesses at (Ja−Jt)/Jt·ωa = −0.24 rad/s | period 26.179939 s measured vs analytic, rel. error 5.8e-10; spin about the symmetry axis constant to 1e-12 |
| Middle-axis spin at 0.3 rad/s: growth rate ω√((Jx−Jy)(Jy−Jz)/(Jx Jz)) | 0.1133 /s measured vs 0.1134 analytic; with the page's 1 % nudge the spin sense flips at 44, 157, 270, 383, 495 s (every 113 s); long- and short-axis spins keep a 1.4e-4 rad/s cross-axis nudge below 1.8e-4 over 600 s |
| Single wheel at τ_max for 10 s | h_y = 0.200000 N·m·s, ω_y = −h/J to 1e-15, inertial total exactly 0; after 50 s the wheel caps at 0.5 and the body tops out at 4.775°/s = h_max/J_y |
| Ledger, 1,200 s of slews, raw torque and a desaturation with a 3-axis disturbance | deposits = τ·t to 1e-12; worst residual 1.1e-12 N·m·s; thruster impulse = propellant × 255 N·m·s/kg to 1e-9 |
| Ledger, 24 simulated hours at 100 µN·m with 12 desaturations (4.32 million steps, \|H\| up to ~1) | worst residual 1.3e-9 N·m·s, i.e. 3e-16 per step: the rounding bias of adding a 1e-6 kick to a ~1 total millions of times, on both sides of the ledger in different frames |
| Rest-to-rest 90° yaw slew | settled within 0.05° and 1e-4 rad/s at 51.2 s; time-optimal bound with the torque and rate limits 43.6 s (pure bang-bang 2√(θJ/τ) = 43.4 s); final error 1.4e-12°; wheels back to < 1e-13 |
| Stored momentum moves between wheels: h = (0.3, 0, 0), yaw 90° about y | h = (0, 0, 0.3000) afterwards, pointing error 1.4e-12° |
| Steady 10 µN·m along a wheel axis | wheel full at 50,000.0 s = h_max/τ = 13.89 h; pointing error 8e-5° at that moment, 57° an hour later; body rate then 0.589°/s = τ·Δt/J_z (1e-5 × 3600 / 3.5 rad/s): once the wheel is pinned the body takes the whole torque |
| Desaturating three full wheels | 31.0 s (per axis h_max/τ_thr = 31.3 s); 5.825 g vs 5.824 g from τ·t/(arm·Isp·g₀); pointing wobble < 0.001°; one full wheel 1.96 g; 2 kg lasts 590 days = 1.62 years at 10 µN·m |
| Catching a 17°/s middle-axis tumble (1.8 N·m·s) | wheels alone leave 12.4°/s with wheel y pinned at −0.500; thrusters null it in 112 s for 7.06 g; final rate 3e-14°/s |
| Frame-rate independence | 30, 60, 144 Hz, and two jittery schedules, with scripted events at fixed step numbers: all 11 state numbers bit-identical at 5 checkpoints |

Beyond the unit tests, I drove the page headless with Playwright: dragging right moves a right-hand star farther from the crosshair (the sky follows the finger) and dragging left brings it back; at 600× the pitch wheel loads at exactly 10 µN·m × t; at 100 µN·m it reaches capacity (+0.500, 5,968 rpm) and the "wheel full" badge appears; "Empty the wheels" spends 3.1 g, the ledger shows +0.7974 deposited and −0.7853 withdrawn along x, leaving +0.0121 on board, which is what the pitch wheel then holds, and the live bookkeeping error reads 3.4e-13; a middle-axis tumble on a phone-sized, light-scheme, reduced-motion page is caught to 0.00°/s with autopilot plus thrusters; and in raw mode a released push leaves the body turning at a constant 3.12°/s. `node tools/smoke.mjs ideas/22-nothing-to-push-against` passes at desktop and phone width with no console errors and no horizontal overflow.

## Honest assessment

What works:
- [Certain] The dynamics are the standard gyrostat equations and the tests above check them against an independent integrator, closed-form precession and instability rates, exact single-axis results, and the conservation of inertial momentum. The live ledger is computed by two routes and agrees to round-off.
- [Certain] Every number quoted on the page (13.9 h, 6,000 rpm, 1.96 g, 590 days / 1.6 years, 1.8 N·m·s for the tumble, the 113 s flips, 17°/s) is recomputed by the test file from the same constants.
- [Certain] The trajectory for a given sequence of commands is bit-identical at any frame rate, and the page never changes the physics step.
- [Likely] The drag conveys the central idea without equations: the sky is heavy because something has to take the opposite spin, and the gauges show exactly what did. The "move the load" moment, where a turn shifts stored momentum from one wheel to another because the momentum stays fixed in the sky, is the part I find most satisfying.

What's rough:
- [Certain] The ledger residual is not zero and grows linearly with simulated time: about 1.3e-9 N·m·s per simulated day at 100 µN·m, from the rounding bias of adding tiny kicks to a large total on both sides of the equation. The page prints it rather than hiding it and only colours it red above 1e-6. It is round-off, not physics, but it is also not "exact".
- [Certain] Parameters are plausible for a microsatellite, not taken from any real vehicle: the inertias are a rounded uniform box, the wheel and thruster figures are mid-range catalogue values from memory, and 10 µN·m is an order-of-magnitude figure for solar pressure on a few square metres with a centimetres-scale offset, or gravity gradient in low orbit. A real design study would start from a specific orbit and geometry.
- [Certain] A constant inertial torque is a caricature. Real disturbance torques rotate with the orbit and depend on which face is lit; some average out and some don't. The caricature keeps the one feature the toy is about (a bias that never averages to zero) and loses everything else.
- [Certain] The autopilot is simple. It lands slews accurately but takes 1.2× the bang-bang bound, it has no feed-forward of the disturbance (a real estimator would), and when a wheel saturates it simply loses; a real system would manage momentum across the other wheels and start desaturation automatically. The "detumble" threshold and the thruster deadband are design choices, not derived.
- [Certain] 17°/s is a fast tumble to show from inside; the sky streaks. At 1× the flip takes a couple of minutes to develop, which is honest but slow, so the demo nudges you to 10×.
- [Likely] In raw mode the joystick mapping (80 px for full torque) and the 10° roll nudge are tuning choices; people with trackpads may find raw mode twitchy.
- [Likely] The integrator's pedigree: a web search confirmed McLachlan's 1993 paper and that the three-piece rigid-body splitting appears there as an example, and confirmed Reich's "Momentum conserving symplectic integrators" (*Physica D* 76, 1994) exists; secondary sources credit the splitting to both, but I could not check Reich's full text, so the joint attribution is from memory.
- [Speculative] Players may read the gold arrow in the inset as a force or a direction the craft "wants" to point. It is the total angular momentum, and its only property that matters is that it doesn't move.
- Rendering is plain Canvas 2D: ~7,000 star transforms per frame, fine on everything I tried headless, but I could not measure a real phone.

## Where it could go next

- An **orbit** underneath: gravity-gradient and solar torques that actually depend on attitude and position, so some disturbances average out over an orbit and some secretly don't. Momentum management then becomes a real design problem.
- **Magnetorquers** as a second way to pay: free momentum dumping against the planet's field, but only about axes perpendicular to the field, so part of the ledger can never be settled that way.
- **Four wheels in a pyramid**: redundancy, null-space momentum you can hide, and the moment one wheel fails.
- **Control-moment gyros**, which trade torque amplification for the gimbal-lock singularities that make their steering laws famous.
- A **sound layer**: each wheel's rpm as a faint pitch, so a filling wheel is something you hear climbing before you look at the bar.
