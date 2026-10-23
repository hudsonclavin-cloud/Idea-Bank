# Solstice Key
> A small clock that borrows its hand from the Sun.

**Kind:** printable object
**Run:** Open `index.html` directly in a browser. No installation, server or network is needed.
**Made by:** Codex / Brass Meridian

## What it is

A printable horizontal sundial with a latitude-specific polar gnomon. The workshop generates an actual dimensioned STL for the selected latitude, hemisphere and base size. A matching, dimensionally calibrated paper hour-face slides over the gnomon and attaches to the flat base. This is a hybrid object: the 3D print supplies the geometry; a normal printer supplies the fine markings.

The live three-dimensional preview shows the actual mesh and an equinox shadow. The solar-hour control moves that shadow. Downloads use the current settings, not a fixed demonstration file. `default.stl` and `default-dial.svg` are saved examples for the initial 45° north, 100 mm design.

## Why I made it

A sundial makes a rather beautiful agreement with its location. One angle in a small solid is also the angle between the ground and the Earth's axis. I wanted an object that lets someone hold that relationship, then leave it outside and watch the sky supply its moving part.

The paper face was a deliberate construction choice. Fine hour lines are much easier to print on paper than to resolve in a small FDM model. Keeping the solid and the markings separate also makes the mesh genuinely continuous instead of hiding overlapping solids inside an STL.

## How it works

`model.js` is a pure browser/Node module. Dimensions are in millimetres. The base is a square plate, 80–140 mm across and 2.4 mm thick by default. The gnomon is a triangular prism with a 24 mm polar edge and a 2.4 mm thickness. Its rise is `24 sin(|latitude|)`; its horizontal run is `24 cos(|latitude|)`. Supported latitude magnitude is 15–75°.

The base's top surface is triangulated around the gnomon's footprint. The footprint surface is omitted and the fin walls join those same vertices, so the export is a single closed, consistently oriented solid, with no internal overlapping faces. Southern meshes reflect the north coordinate and reverse triangle winding. The gnomon has a full flat footprint and narrows as height increases; the shape needs no support material in the stated base-down orientation.

Hour lines follow `tan θ = sin(|latitude|) tan H`, where `H` is solar hour angle from noon. World coordinates keep east on the right and true north at the top. In the southern hemisphere the gnomon and the noon shadow point south; the complete paper face is reflected north–south while morning remains west and afternoon east.

The preview uses the equinox sun direction and projects the polar edge onto the dial. At low solar elevations the real shadow tip falls beyond the plate; the preview caps that line at the plate edge. Hour-line directions work through the year when the polar edge is correctly aligned; the equinox preview does not model seasonal shadow lengths.

The binary STL has 64 triangles. The paper SVG is an A4 sheet with physical dimensions `210mm × 297mm` and the same numerical viewBox, plus a 100 mm calibration line. The trimming square exactly matches the selected base. The gnomon slot adds 0.3 mm clearance on each side; it is a paper cutting allowance, not a tested printer-fit tolerance.

### Print and assembly

1. Download both files at the same settings. Import the STL into a slicer as **millimetres**, base down at Z=0. The initial part is 100 × 100 × 19.37 mm. A 0.4 mm nozzle and 0.2 mm layer height are starting assumptions; select material, walls and infill for your printer and intended environment.
2. The plate and fin are one piece. Print without supports; no separate joint or snap fit is required. The mesh represents a solid volume, while the slicer controls the internal infill. Printer dimensional accuracy and fin durability have not been physically tested.
3. Print the paper SVG at **actual size / 100%**, with no fit-to-page scaling. Measure the calibration line before cutting. Trim the square and the dashed rectangular slot, slide the face over the gnomon, then glue it to the plate. The central slot clearance allows hand cutting; adjust it if your paper or print differs.
4. Level the base in direct sun. The top of the paper points to **true north**, in both hemispheres. The elevated polar edge slopes north in the northern hemisphere and south in the southern. A magnetic compass requires a local declination correction; a phone reading is not an alignment guarantee.
5. Read the shadow of the sloping polar edge. This gives **local solar time**, not time-zone clock time. Longitude, the equation of time and daylight saving all affect comparison with a civil clock. This workshop does not compute those corrections.

## Honest assessment

- **[Certain]** The exported geometry is one closed oriented component. Six model tests cover edge pairing, Euler characteristic and connectedness across sampled latitudes, hemispheres and sizes; independent volume and dimension formulas; the saved binary STL; the calibrated paper template; input bounds; and hour/shadow geometry.
- **[Certain]** The STL and paper face are generated for the current controls, with no server, external libraries, network calls or stored personal data. The SVG contains no scripts or linked assets.
- **[Certain]** This is a dimensioned, geometrically checked prototype. It has not been physically printed or tested outdoors. Geometry checks do not establish printer accuracy, material durability or timekeeping performance.
- **[Certain]** The gnomon must align with the polar axis and the base must be horizontal. The finite plate cannot contain every seasonal shadow tip. The model omits refraction, penumbra, mounting error and seasonal shadow-length calculations.
- **[Likely]** A calibrated paper face and a relatively thick one-piece fin should make a useful first build. That judgement awaits an actual print and comparison against observed local solar time.
- **[Speculative]** A weatherproof replaceable face or a companion longitude/equation-of-time card could turn it into a small outdoor instrument. Neither has been built here.

## Where it could go next

Print the object, measure its polar slope and paper scale, and log observed shadows through a day. Add a physically tested detachable weatherproof face, then a seasonal shadow-length overlay. An optional clock-correction card could expose the difference between local solar noon and the number on a watch.

## Verification

From the repository root:

```sh
node --test ideas/53-solstice-key/model.test.mjs
node tools/check.mjs ideas/53-solstice-key
```

Model API: `parameters(input)`, `mesh(input) → {vertices, faces, params}`, `stl(input) → ArrayBuffer`, `dialSVG(input) → string`, `hourLine(hour,input)`, `shadow(hour,input)`, `volume(mesh)`.
