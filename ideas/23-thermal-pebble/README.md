# Thermal Pebble
> A reusable thermal buffer that spends a change of state to buy a little more time.

**Kind:** product concept / engineering simulator
**Run:** open `index.html` in a browser. No server, packages or build step.
**Made by:** Stillwater / Codex

## What it is

A proposed physical product, and a working digital design bench for it. Thermal Pebble is a sealed phase-change core in a ribbed enclosure, intended to couple thermally to small cargo inside an insulated carrier. It warms to a melting point, absorbs a latent-heat reserve while melting, then resumes warming. Recondition it below its melting point to solidify the core and start again.

The page puts an exploded product sketch beside an energy model. Change core mass, cargo mass, ambient temperature, specific latent heat and package heat leakage. The temperature curve and time to 25°C update immediately. A scrubber inspects temperature and liquid fraction along the journey. The dashed comparison has the **same sensible heat capacity and same mass**, but no latent reserve; it isolates the benefit of phase change rather than quietly changing two properties at once.

This is a product proposal, not a fabricated or validated device. No particular phase-change material has been selected. It makes no claim about food safety, cold-chain compliance, biological sample protection or medical use. The temperatures and dimensions are design choices to explore a mechanism.

## Why I made it

I like physical products that do an intelligible job without an interface. This one would communicate its whole purpose through a temperature plateau: a small object visibly spending something that isn't a battery. A phase transition is a surprisingly good way to store *time*, provided you state the environment and load.

I also wanted the honest part of a product pitch to be beautiful. The graph is allowed to show the reserve running out. Increasing insulation can matter more than choosing a glamorous material. Cargo that starts too warm cannot be rescued by the story being told about the object.

## How it works

The model treats core and cargo as one perfectly coupled node with uniform temperature. The constants are:

- Core sensible heat capacity: 2000 J/(kg·K), fixed in both phases.
- Cargo sensible heat capacity: 3500 J/(kg·K), a water-like illustrative value.
- Initial temperature: 18°C. Melting point: 22°C.
- Constant ambient temperature, 24–45°C.
- Whole-package thermal conductance `G`, 0.20–1.60 W/K. This is a package parameter, not a material conductivity.

Total sensible capacity is `C = m_core cp_core + m_cargo cp_cargo`, in J/K. Latent reserve is `Q_latent = m_core L`, in joules. Newton heat flow is `dH/dt = G (T_ambient − T)`.

Before melting and after melting, the temperature is the exact exponential solution of the lumped model. On the plateau the temperature remains 22°C and the liquid fraction increases linearly. The plateau duration is `Q_latent / [G (T_ambient − 22°C)]`. The implementation calculates transitions analytically, so a large plotting step cannot skip a latent interval or create numerical heat.

`model.js` has no DOM dependency and works as a classic browser script and a Node module. `app.js` draws the graph and connects native range inputs. The SVG cutaway is original local geometry. Everything opens directly from a file, with no network requests. No inputs are stored or transmitted.

The 25°C readout is a chosen comparison threshold, not a safety threshold. If ambient is at or below 25°C, both models approach a temperature below that threshold, so the readout is infinite and extra time has no finite comparison.

## Honest assessment

- **[Certain]** The model conserves its defined enthalpy and implements an exact solution of its stated ordinary differential equation. Tests compare the enthalpy change against independently integrated heat flux, check phase boundaries, zero conductance, zero latent heat, time inversion and monotonic warming.
- **[Certain]** The physical product has not been manufactured. The drawing does not specify dimensions, seals, containment pressure, compatible materials, thermal contact or fatigue life. A ribbed shell alone is not an insulation system.
- **[Certain]** The model ignores gradients between the package, core and cargo, shell heat capacity, crystallization delay, phase segregation, variable conductance, variable heat capacity and leakage. It assumes complete starting solidification and thermal equilibrium at 18°C.
- **[Likely]** A real device would have a rounded and delayed plateau, and cargo could differ appreciably from the core temperature. The one-node model is useful for a first energy budget but cannot establish a holding specification.
- **[Speculative]** A reusable core could provide a useful buffer for small, noncritical temperature-sensitive cargo. Material screening, calorimetry, containment and repeated-cycle tests would decide whether the proposed object is worth making.

## Where it could go next

Replace the one-node model with separate shell, core and cargo nodes and an explicit contact resistance. Then measure a real candidate material's enthalpy curve and cycle stability. A credible next product milestone is a controlled bench comparison with thermocouples, not a more precise-looking marketing number.

## Verification

`node --test ideas/23-thermal-pebble/model.test.mjs`

`node tools/smoke.mjs ideas/23-thermal-pebble`

The interface uses native keyboard-operable sliders and buttons, fits a 390px phone, and contains no animation or sound. Six model tests pass; the browser smoke check covers desktop and phone interactions.
