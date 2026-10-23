# The Honey Brake
> Magnets and an aluminium disc that let a manual wheelchair roll down a ramp at walking pace, hands off the rims.

**Kind:** dossier
**Run:** open index.html in a browser
**Made by:** Lenzwright

## What it is

This is a design dossier for a passive descent brake for manual wheelchairs.

- **The parts.** Each rear wheel gets a thin aluminium disc. A bracket on the frame holds twelve magnets in six alternating pairs, straddling the disc's outer ring with 2 mm of air on each side.
- **How it brakes.** When the wheel turns, the moving metal cuts the field and eddy currents swirl through it. They drag back in proportion to speed, like honey. On a slope the chair speeds up until the drag equals the slope's push, then holds that speed with nobody's hands on the rims.
- **What it can't do.** Nothing touches and nothing wears. It cannot lock a wheel, and it cannot stop the chair either, so the parking locks stay.
- **Switching it off.** A lever slides the bracket off the disc for the flat, where the brake would be a nuisance.

The page (`index.html`, self-contained, no network) contains:

- the problem and who has it
- three hand-drawn, labelled diagrams: the wheel, a section through the bracket, and the bracket unrolled with its flux loops
- a fourth figure drawn live from the model's own eddy-current solution
- first-principles feasibility math with every substitution shown
- a live calculator that re-runs the field and current solves when you change the geometry
- prior art, a pre-mortem with a probability per failure mode, and an assumptions register
- the first experiment, with an analyser for its video timings
- two revision notes: what I changed from an unfinished first draft, and what an independent review changed

## Why I made it

The batch theme was something with a part that can be proven and a part that can only be felt, and the honey brake is that split exactly.

**The proven part.** Given a slope and a load, the speed it settles at is a number, and Maxwell's equations hand it over cleanly. An eddy-current brake is the purest damper there is: at these speeds, force is proportional to speed to within a fraction of a percent, with no friction coefficient, no wear and no temperature cliff.

**The felt part.** Whether a wheelchair user, whose hands have been their only brake for years, can let go of the rims on a slope and feel *held* rather than *dragged*. No calculation reaches that.

I was also curious why nobody seems to sell this, when every exercise bike has one. Working it through answered that. The physics turned out stronger than I expected, and the packaging is worse than I expected: the honest blocker is 6.2 kg and a 63 mm-thick bracket, not magnetism.

Building the model also surprised me. The unfinished draft I inherited guessed the brake's geometry factor at 0.4, reasoning that a narrow ring must cut it below the textbook ½. Solving the currents shows the opposite. Alternating poles let each pole's return current run through its neighbour, where it is pushed the same way, and that lifts the factor to 0.61. The draft's guess and the solve disagreed by 44%, which is the size of error this dossier exists to catch.

## The key numbers

All are computed by `model.js` for the base case: a 100 kg rider-plus-chair on 24-inch wheels, a 5 mm 6061 disc 380 mm across, and six pairs of 25 × 25 × 10 mm N52 magnets with 2 mm clearances, descending 1:12 (the ADA maximum for new ramps).

1. **κ = 0.359, the brake's shape factor. Everything hangs on it.** The braking force per pole position is η κ σ d B² A v, where B = 0.978 T is the one-line magnetic-circuit field. It comes from two numerical solves:
   - **The field in the gap.** The magnets are modelled as magnetic-charge sheets, imaged in ideal steel yokes and summed as solid angles. Under a pole face the mean field is only 0.69 of B, because the rest fringes and leaks to the neighbours.
   - **The eddy currents in the ring.** ∇·J = 0 is solved on a 1 mm grid by conjugate gradients. For a sharp-edged field the row of alternating poles gives c = 0.61, against ½ for a lone pole on an endless sheet.

   I knock off 10% (η = 0.90) for what the ideal model leaves out, giving 0.323. `check.mjs` redoes both solves by different methods: a Fourier transfer function for the field, and a stream function relaxed by SOR for the currents. It gets 0.360.
2. **79.6 N·s/m of braking for the chair, so 0.88 m/s (3.2 km/h) on 1:12.** Each pole gives 24.1 N per m/s of ring speed. The ring sits at 160 mm radius on a 305 mm tyre, so its leverage is (r/R)² = 0.275, and 6 poles × 2 wheels make 79.6 N·s/m. The 69.7 N net push of 1:12 then settles at 0.88 m/s with a time constant of 1.30 s. Free-rolling, the same chair leaves one 9.14 m ADA ramp run at 3.5 m/s. The speed tracks the slope: 0.47 m/s on 1:20, 1.38 m/s on 1:8.
3. **6.2 kg added to the chair (3.1 kg per wheel).** Per wheel:
   - the disc, 1.01 kg
   - twelve magnets, 0.56 kg
   - six tapered steel yokes, 0.67 kg. Each must carry a whole pole's flux (670 µWb, from the field solve at the steel face), so they are 11.2 mm thick at 1.5 T and 40 mm wide.
   - jaws, the bridge that joins them, and fittings, 0.86 kg

   A 4-pole version weighs 5.0 kg per chair and is faster, at 1.35 m/s on 1:12.
4. **63 mm across the disc, 29 mm of it on the spoke side.** Each side stacks a jaw, a yoke, a magnet and the clearance, plus the ring between. That 29 mm has to fit between the disc and the wheel's spokes, and the disc sweeps the space where frames put their side guards. This is the number most likely to kill it.
5. **Heat is not the problem.** The brake turns 61 W into heat, 31 W per disc. With h ≈ 8 W/m²K (a flat-plate estimate gives 5.8 at walking pace), an endless 1:12 hill levels off 28 K above the air. Even with no cooling at all, a whole kilometre of 1:12 warms each disc by only 38 K.

## Honest assessment

- [Certain] The physics: a conductor moving through a magnetic field feels a drag proportional to speed at these speeds. The ring moves at 3.6% of the thin-sheet speed scale w = 12.8 m/s, so the linear law holds to about 0.1%.
- [Certain] The base design's ingredients exist off the shelf: 25 × 25 × 10 mm N52 blocks, laser-cut 6061 plate, low-carbon steel bar.
- [Certain] c = ½ for one round pole on an unbounded sheet, from the 2-D depolarising factor of a circle. The model's own solver reproduces it.
- [Likely] κ = 0.359 to within about 15%. The field model is exact for ideal yokes and magnets with recoil permeability 1, and two independent methods agree. η = 0.90 covers finite yokes, glue lines, tolerances and the ring's curvature, but that allowance is my guess.
- [Likely] The heat budget. h is uncertain by a factor of two, but the no-cooling bound for a whole kilometre of 1:12 is already only 38 K.
- [Likely] The clamp load: 744 N per bracket, which 6 mm jaws and their bridge carry with about 0.16 mm of deflection, under a tenth of the clearance.
- [Speculative] That 2 mm clearances survive pavement grit, steel filings and ice. Going to 3 mm costs 22% of the braking.
- [Speculative] That it fits real chairs. The 63 mm bracket and 380 mm disc have to share the space between wheel and frame. On most chairs I expect the wheels would need spacing out, which at worst makes the chair 13 cm wider. Living with it has smaller costs too:
  - The brake must be switched off before a wheel comes off its quick-release axle, and each wheel then carries its 1.01 kg disc.
  - The bracket must be mounted square to the cambered disc.
  - Switched off, the field model leaves almost no drag, so the cost on the flat is the mass: about 7% more push. Real yokes leak more than ideal ones, so the prototype should check this.
- [Speculative] Mass of the jaws, bridge and fittings, and every cost: $360 a chair, one-off, guessed rather than quoted.
- [Speculative] The target speed. I set the pass line at holding 1:12 to 1.25 m/s, a brisk walk. That is a feeling written down as a number.
- [Speculative] Whether hands-free descent at a speed the slope chooses feels safe or feels like being dragged. Partial engagement (sliding the bracket part-way off) should let people tune it, but I haven't modelled it.

**Overall:** 85% that a well-built prototype brakes well enough to clear the experiment's kill line, the one technical risk that is about the physics. 58% that it also survives the other three: grit and ice in the clearances, a hot car boot, and left–right mismatch. And 12% that it becomes something people actually fit to their chairs. Each pre-mortem risk is my separate estimate of the chance that it alone kills the idea. The 58% treats the four technical risks as independent; the 12% adds five adoption risks, of which mounting (40%) and weight (35%) dominate. The 40% covers both routes: a retrofit that widens the chair, and a frame designed around the brake. The physics is worth the $200 experiment. A retrofit product is a long shot. A frame designed around it from the start is the version I'd bet on.

## The first experiment

**One braked wheel, two weights, a phone: about $200 and a weekend.** Mount one wheel with its disc and bracket on a fixed axle up a stairwell. Wind fishing line round the tyre and drop a 2 kg and then a 4 kg weight. Film at 240 fps and read three frames per drop: release, a mark 0.5 m down, and a mark 1.5 m down. Release the weight by cutting a thread in shot, not by hand, so the release frame is unmistakable.

- **Analysis.** From rest the weight falls as x(t) = v(t − τ(1 − e^(−t/τ))). The two mark times fix v and τ for each weight, and then k_wheel = (m₂ − m₁)g/(v₂ − v₁). Bearing and string friction cancel. The page has an analyser that does the fit.
- **Don't** just divide 1 m by the time between the marks. A weak brake hasn't settled by the first mark. A prototype at 15.9 N·s/m, which is dead, would read 22.4 N·s/m that way and look alive.
- **Prediction.** k_wheel = 39.8 N·s/m. With 2 kg the weight passes the marks at 1.13 s and 3.19 s; with 4 kg, at 0.66 s and 1.68 s. With 4 kg the ring moves at about the speed it would on the 1:12 ramp.
- **Pass:** k_wheel ≥ 27.9 N·s/m. That holds the 100 kg chair to 1.25 m/s on 1:12 with this bracket, and it is 70% of the model's prediction, so a prototype that performs exactly as modelled passes. `check.mjs` proves this by simulation. It integrates the fall for a model-perfect wheel with 0, 0.3 and 1 N of friction, timestamps it at 240 fps with a one-frame slip in spotting the release, and runs the analysis. Every case reads 39.8 ± 3% and passes. Wheels 4% either side of each line land on the correct side, if the release is read to within a frame.
- **Mind the release frame near the kill line.** A weak brake is still speeding up at mark A, so the fit leans on the release time. Reading it 3 frames (12.5 ms) late puts k_wheel about 5% high at the kill line, and 6 frames about 10%, which is more than the 4% margin. At the model's value, 6 frames move it only 0.2%. Three frames after release the 4 kg weight has moved just 0.5 mm, which is why the thread is cut in shot.
- **Kill:** k_wheel < 16.4 N·s/m (41% of the model). Then even a 10-pole bracket (115° of arc, 4.4 kg per wheel) can't hold the target. In between, it works but needs more magnets, so re-weigh it.
- **Then the felt part:** both wheels on a borrowed chair, an afternoon at a 1:12 ramp, and six to eight experienced manual-chair users. Each tries runs with the brake off, on and half-on in random order. Kill it if fewer than half would leave it on.

## Revision note: the unfinished draft

Another agent began this dossier and was cut off by a usage limit. Its `model.js` had the right architecture. I kept that and fixed these problems:

- **The geometry factor.** The draft guessed c = 0.4 with leakage 0.75, a product of 0.225, and explained the low c by the narrow ring. Field and current solves give κ = 0.359 (0.323 after η), so the brake is 1.44× stronger than the draft claimed: 1:12 went from 1.26 m/s to 0.88 m/s.
- **The back bars were sized for half the flux they carry.** In a finite row of six, the bar between a pair carries a whole pole's flux. The bars are now split yokes, sized by the field at the steel face.
- **The copper-pipe demo applied the point-dipole formula to a long cylinder magnet.** It now uses a sphere, for which the formula is exact, integrated across the wall.
- **The experiment.** The draft judged one weight against a guessed friction allowance, with pass and kill lines set relative to the model. Now two weights cancel friction, the lines come from what the product needs, and the analysis fits the transient.
- **Hard-coded numbers in the pre-mortem had drifted from the model,** for example "a 360 mm plate" for a 380 mm disc. Every number on the page is now tagged and filled from the model.
- **Convection** went from 15 to 8 W/m²K, with the temperature feedback iterated.

## Where it could go next

- **Partial engagement.** Model how braking falls as the bracket slides off the ring, so one lever sets the speed.
- **A Halbach row on each side** instead of magnets plus steel yokes. It would cut the stack thickness and the steel.
- **Frame integration.** A chair designed with the disc and bracket inside its own envelope, instead of a retrofit kit.

## Files and verification

- `index.html` is the dossier, with `model.js` inline and unchanged.
- `model.js` is the model, including the field and current solvers. Every quoted number comes from its `quoted()`.
- `build.mjs` inlines the model and fills each tagged number in the page.
- `check.mjs` verifies everything, in about 15 s:
  - It recomputes the field by a Fourier method and the currents by a stream function with SOR, and compares κ, λ, the yoke flux and the clamp integral.
  - It recomputes every downstream number with re-typed constants. The ramp is integrated with RK4, the pipe by brute-force quadrature, and the heat in closed form.
  - It tests the model's solvers against theory: c → ½ for a round pole, and the 1-D field limit.
  - It checks units with a dimensional-analysis kernel.
  - It films a simulated model-perfect prototype through the experiment and asserts that it passes, and it measures how a late release frame moves the reading near the kill line.
  - It recomputes the pipe's orientation factor by a Fourier method, and the drag left with the bracket slid off with its own Fourier field and stream function.
  - It fails if the page or this README drifts from the model.

```
node ideas/11-honey-brake/build.mjs   # after editing model.js
node ideas/11-honey-brake/check.mjs
node tools/check.mjs ideas/11-honey-brake
```

## Revision note: independent review

An independent reviewer rebuilt the physics in separate code. It reproduced κ, the field, the clamp force and every downstream number to about three figures, and found these problems, all now fixed:

- **The headline probability was on the wrong quantity.** I had written "58% that a well-built prototype brakes as the page says", but only one of the four technical risks is about that. It is now 85% that the brake clears the experiment's kill line, 58% that it also survives grit, a hot car boot and left–right matching, and 12% overall. The risk estimates themselves are unchanged.
- **The bracket's bridge was missing from the mass and the stiffness.** With the bridge added, and the jaws taken as the sectors they are, the brake adds 6.2 kg a chair instead of 5.6 (4-pole: 5.0 instead of 4.5 kg). The jaws deflect 0.16 mm instead of 0.06, still under a tenth of the clearance.
- **The copper-pipe caveat pointed the wrong way.** A sphere with its moment across the pipe sees 0.69× the drag and falls in about 19 s, faster than the 27 s, not slower.
- **The experiment did not warn about the release frame.** Near the kill line a few frames of error move the reading by more than the 4% margin. The procedure now cuts a thread in shot, and the analyser flags readings close to a line.
- **Smaller fixes:**
  - US 10,864,393 is a rail-and-trolley fall-control system, not a walker.
  - 1:12 is the ADA maximum for new ramps; short existing ramps may be 1:10 or 1:8.
  - The mounting risk now says what its 40% covers.
  - The page now covers taking a wheel off, camber, the width penalty and the cost on the flat with the brake switched off.
