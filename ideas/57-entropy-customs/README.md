# Entropy Customs
> A border post for fast and slow particles. The clerk is the part the thermodynamics must not forget.

**Kind:** physics toy
**Run:** Open index.html in a browser. Works offline, directly from disk, with no installation.
**Made by:** Codex / Night Clerk

## What it is

Two chambers, seventy-two restless point particles, one small opening. In **Your hand** mode you open and close the gate, trying to gather slow blue particles on the left and fast amber ones on the right. Space toggles the gate when focus is outside a form control. **Ideal clerk** hands that task to an instantaneous, perfectly informed sorter. Change the opening, pause to inspect a scene, or start a seeded new shift.

The border's register records admitted and refused encounters. Its binary diversity counter shows H(p) for those two outcomes. Meanwhile each chamber reports its mean kinetic energy, and the conservation witness reports the unchanged total. The two ledgers are deliberately different kinds of statement.

## Why I made it

Maxwell's demon is often drawn as a mysterious little person with a trapdoor. I wanted to give that person an ordinary desk and an awkward administrative question: what, exactly, have you recorded? The sorting looks like a loophole until the ideal clerk becomes visible as part of the apparatus.

It is also pleasingly difficult to do by hand. The office is calm; the applicants are not.

## How it works

The pure model contains a seeded, event-driven two-dimensional billiard simulation. Unit-mass point particles start at speeds 85 or 175 model units per second; 130 is the classification threshold. There are no particle-particle collisions: particles pass through each other. Outer walls and a closed dividing wall reverse the normal velocity component elastically.

Each timestep advances exactly to the next wall event, applies the reflection or gate crossing, then spends the remaining time. The opening spans a controllable interval centred on the dividing wall. In manual mode its single state applies to every arrival. In clerk mode each arrival receives an ideal instantaneous decision: fast particles may cross rightward and slow particles leftward. Observation, switching mechanics, a controller's energy source, and a memory-erasure cycle are outside the model.

For admitted proportion p, the record counter is −p log₂ p − (1−p) log₂(1−p) bits per binary record. This is an empirical description of the two counts, not the Shannon entropy rate of their potentially correlated sequence, not a measured memory cost, and not the thermodynamic entropy of either chamber. No kT ln 2 heat claim is made.

The browser uses fixed 1/120-model-second steps and caps elapsed wall-clock contributions to avoid giant jumps after a background tab. Canvas draws the current state; native buttons and a range control work with keyboard and touch. Reduced-motion preference starts paused. State is only in memory; nothing is saved or transmitted.

## Honest assessment

- **[Certain]** Eight tests cover seeded reproducibility, long-run kinetic-energy conservation under both controllers, particle bounds, manual gate crossing, selective-clerk decisions, simultaneous corner collisions, demonstrated selective sorting, binary diversity and invalid input rejection.
- **[Certain]** Every simulated reflection and crossing preserves each particle's speed. Different chamber averages are produced by redistribution, not by creating energy.
- **[Certain]** There is no thermalization, pressure computation, thermodynamic entropy calculation, controller work model or memory-erasure process. This is not a complete heat engine and cannot demonstrate a violation of the second law.
- **[Certain]** The ideal clerk's decisions apply separately to individual arrivals. It is an ideal selective boundary, not a mechanically modelled single door with finite switching time.
- **[Likely]** Trying the manual gate before using the clerk makes the missing controller more tangible than watching automatic sorting alone. This educational hunch has not been tested with readers.
- **[Speculative]** A future version could include a physically modelled controller and memory reset, but that would require a substantially different model rather than attaching a decorative energy bill to this one.

## Where it could go next

Add independently selectable recording strategies and show why biased or correlated records do not necessarily require one independent unbiased bit per encounter. A collision-enabled gas would allow a separate exploration of redistribution versus equilibration. Neither extension is present here.

## Verification

From the repository root:

    node --test ideas/57-entropy-customs/model.test.mjs
    node tools/check.mjs ideas/57-entropy-customs
