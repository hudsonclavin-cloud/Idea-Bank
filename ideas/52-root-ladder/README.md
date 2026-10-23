# Root Ladder
> A little printed bridge that keeps the leaves above the water and leaves the roots a way through.

**Kind:** printable object
**Run:** Open `index.html` directly in a browser. No installation, server, build step or network needed.
**Made by:** Codex / Cotyledon

## What it is

A reusable 3D-printable bridge for a round propagation jar. Three open windows give a cutting somewhere to pass through; a leaf node can rest across a rung. Two small locating tabs sit just inside the jar mouth. An optional loose cotton wick can loop over a rung and trail into the water. The part does not clamp a bare stem, seal a jar or automatically deliver a known amount of water.

The browser is a working designer, not a picture of a proposed product. Set the measured inside mouth diameter, the window width and the minimum radial clearance. Turn the actual triangle mesh by dragging or using left/right keys. **Download this STL** creates a new binary STL for the current settings, in millimetres. **Keep editable SCAD** exports the matching OpenSCAD solid. The browser itself does not need OpenSCAD.

The checked-in [default STL](default.stl) is the 64 mm mouth / 16 mm opening / 1 mm minimum radial-clearance configuration. Its print envelope is **84 × 26 × 7 mm**, with a 3 mm plate and two 4 mm-high locating tabs. The source is [root-ladder.scad](root-ladder.scad).

## Why I made it

Propagation jars often acquire an improvised collar of cardboard, string or a balanced leaf. I wanted to make the small act of supporting a cutting into a deliberate object: a ladder with nothing to climb yet. The print is modest enough to use the jar already on the windowsill, and its empty windows leave the interesting part—the roots—visible.

The geometry is intentionally uncomplicated. There is no snap fit to tune, hidden hinge, sealing lip or claim that a particular plastic makes plants grow. It is a small bridge, and the browser lets its dimensions remain inspectable.

## How it works

`model.js` builds a rectilinear boundary mesh from an occupied three-dimensional grid. Internal faces between occupied cells are omitted. Every exposed quad becomes two outward-oriented triangles, using globally shared grid vertices. This creates one connected closed solid with three through-windows; it is not a collection of intersecting closed boxes.

For mouth diameter `D`, the part is `D+20` mm long. Its width is the selected opening width plus two 5 mm side rails. The three window lengths are `(D−20)/3` mm, separated by 4 mm rungs. The main plate is 3 mm thick. Each locating tab is 3 × 6 × 4 mm.

The clearance control refers to the **worst outer corner of each locating tab**, not just its flat end face. With jar radius `R`, clearance `c` and tab half-depth 3 mm, the outward tab-face distance from the centre is `sqrt((R−c)²−3²)`. Consequently the outer corner lies exactly `c` mm inside the nominal circular mouth. This geometry is checked across the supported range: mouth diameters 40–100 mm, opening widths 8–20 mm, clearance 0.5–1.5 mm.

`stl()` emits finite, outward unit normals and binary STL triangles. The browser draws the same mesh it exports; preview scaling does not change dimensions in the file. The SCAD export independently represents the solid as a union of the plate and tabs minus the three windows. An independent OpenSCAD render of the default model has the same 4584 mm³ volume and 84 × 26 × 7 mm bounds as the browser mesh.

## Print and assembly

1. Measure the **inside** opening of a round jar at the depth the tabs will occupy. An oval or strongly irregular mouth is outside this model. The nominal clearance is geometry, not a guarantee of fit after printing.
2. Download the STL. Import into a slicer in **millimetres**, without scaling. Put the broad flat plate on the bed with both locating tabs pointing upward. The mesh is modelled in that orientation at `z=0`.
3. A reasonable starting point is PLA or PETG, a 0.4 mm nozzle, 0.2 mm layers and at least three perimeters. The 3 mm plate, 4 mm rungs and 5 mm rails have no roofs over their windows; the 4 mm-high tabs grow straight upward. Supports are not required by the geometry. Printer settings and material remain yours to verify.
4. Deburr any sharp edge. **Flip the part** onto the jar: the tabs now point downward into the mouth. The ends overhang the nominal inside opening by 10 mm each. Check that it rests securely on the actual rim and does not rock.
5. Put a suitable cutting through a window and rest a sturdy leaf node across a rung. A thin bare stem without a sufficiently broad node will fall through; this is not a stem clamp. Use a different support if the cutting cannot rest securely without damage.
6. If useful, drape a separate cotton wick over a rung with one end in the water. It is not included in the print and its flow is not predicted here. Keep access to the jar for ordinary water changes.

## Honest assessment

- **[Certain]** The exported geometry is a connected closed oriented triangle mesh. Six Node tests check paired directed edges, nondegenerate triangles, Euler characteristic, positive volume, bounds, wall dimensions, actual circular-corner clearance, parameter limits and saved-default byte parity.
- **[Certain]** The default model's analytic volume is 4584 mm³. Both the browser-generated STL and an independent OpenSCAD rendering passed a separate STL topology/volume/bounds audit. This verifies geometry, not a physical print.
- **[Certain]** The smallest intended solid feature is 3 mm. Tessellation grid cells can be smaller; they are subdivisions of continuous surfaces rather than separate thin walls.
- **[Certain]** This object has **not been physically printed or load-tested**. Actual fit depends on jar shape, measurement, extrusion, shrinkage and surface finish. The stated clearance does not compensate for a particular printer. There is no load rating or claim of resistance to creep, water exposure, UV or cleaning chemicals.
- **[Certain]** There are no biological-performance or water-delivery claims. Different cuttings and leaf nodes can require a different support, and a printed surface is not assumed sterile or watertight.
- **[Likely]** The broad plate and simple vertical walls should be straightforward to slice on an ordinary FDM printer. That judgement still needs a real print and fit test.
- **[Speculative]** A family of interchangeable soft stem cuffs could support cuttings without broad leaf nodes. Such cuffs are not included or validated.

## Where it could go next

Print a dimensional coupon first, compare the measured locating-tab gap with the target jar, then document tested material and printer settings. Rounded rung edges and optional removable soft cuffs are more useful next steps than making the support into an untested smart planter.

## Verification

From the repository root:

```sh
node --test ideas/52-root-ladder/model.test.mjs
node tools/check.mjs ideas/52-root-ladder
```

Optional independent CAD verification: open `root-ladder.scad` in OpenSCAD and render/export. OpenSCAD is not needed to use the browser designer or download its STL.
