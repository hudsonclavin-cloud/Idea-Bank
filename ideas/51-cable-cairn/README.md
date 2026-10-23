# Cable Cairn
> A little ridgeline for the wires that keep falling off your desk.

**Kind:** printable object
**Run:** Open `index.html` in a browser. Change the dimensions and download an STL; no installation, server or network needed.
**Made by:** Codex / Saddlewright

## What it is

A one-piece, 3D-printable desk cable corral with open semicircular saddles. Choose two to eight channels, measured cable diameter, extra space on each side and front-to-back depth. The browser shows an oblique model or the exact channel profile, reports its millimetre dimensions and generates the configured binary STL locally.

This is a resting place, not a snap clip, strain relief or structural clamp. Cables enter from above and can be lifted out. No screws, separate parts or assembly are needed. The saved [default STL](default.stl) and [its dimensions](default-dimensions.json) provide a ready-to-slice four-channel example.

## Why I made it

A cable's natural habitat seems to be just beyond the edge of a desk. I wanted a quiet object whose geometry came from what it holds: a series of small valleys, with enough exposed cable to lift one out without disturbing its neighbours. It could have been a rectangular block with holes. Keeping the channels open makes both the use and the printing simpler, and makes the silhouette feel like a little landscape.

## How it works

`model.js` builds a single simple concave outline in the X/Z plane. A flat bottom supports a continuous base, and 24-segment semicircles cut open saddles into its upper edge. An ear-clipping triangulator caps the outline; an extrusion along Y supplies the two end faces and the continuous side walls. The result is one connected, consistently oriented closed shell, rather than several overlapping solids.

For cable diameter `d` and extra space `c` on **each** side, the nominal saddle diameter is `d + 2c`. The separating walls are 2.8 mm wide and the solid base is 3.2 mm thick. Outer shoulders have 1 mm bevels. Supported ranges are 2–8 channels, 2–12 mm cable diameter, 0–0.8 mm allowance per side and 12–50 mm depth. The model also accepts wall/base changes within guarded ranges for code users; those are intentionally fixed in the beginner-facing controls.

The STL uses coordinates in millimetres, with its broad base at Z=0. STL itself has no unit metadata, so select millimetres in the slicer. Preview mass assumes **solid** PLA at 1.24 g/cm³ and excludes infill, extrusion details and support/brim material; it is not a slicer estimate.

### Printing and use

1. Measure the outside diameter of the actual cable, including its jacket. Begin with the default 0.35 mm extra space per side; it is only a starting allowance, not a calibrated fit for your printer.
2. Download the STL and open it in a slicer at 100% scale, interpreted as millimetres. Put the broad flat base on the bed, with Z up.
3. A plausible starting profile for a 0.4 mm nozzle is PLA, 0.2 mm layers and three perimeters. Choose ordinary infill. This geometry has no channel ceilings, enclosed tunnels or downward overhangs, so it does not require supports. Printer-specific adhesion settings remain your choice.
4. If fit matters, begin with two channels and check the printed allowance before making a larger set. Lay cables in from above. Optional removable tape under the flat base can prevent the light plastic part from moving when cables are pulled.

No assembly is required. This design has not been physically printed or load-tested. It should not be used as a cable anchorage, electrical enclosure or load-bearing fixture.

## Honest assessment

- **[Certain]** Six model tests verify that each undirected mesh edge belongs to two oppositely directed faces, Euler characteristic is 2, every triangle is nondegenerate, volume is positive and agrees with an independently calculated profile-area × depth value, and bounds match the dimensions. The saved default STL is byte-for-byte the browser model's default export.
- **[Certain]** Saddles are open and do not grip or retain a cable against upward movement. The continuous geometry has a minimum 1.2 mm wall/base guard; the browser uses thicker fixed defaults. Polygonal circles approximate the requested diameter, with small chord error rather than perfectly smooth machining surfaces.
- **[Certain]** The browser produces a real binary STL file without a service or geometry library. Native controls work by keyboard and touch; the interface fits a 390 px phone. The preview is an illustrative orthographic projection, not a slicer.
- **[Certain]** Mesh and dimension tests are digital checks. Physical fit, surface finish, durability, stability and printer behaviour have not been measured. A low-mass open corral may need tape or another way of keeping its base still.
- **[Likely]** The open-top shape and broad base make this a straightforward small FDM print with ordinary PLA settings. That printing judgement has not been confirmed by a physical prototype.
- **[Speculative]** A future version could give each saddle its own diameter and add a recessed tape pocket, but neither feature is implemented.

## Where it could go next

Per-channel sizes would let a thin charging lead and a thick monitor cable share the same object. A printed calibration strip could make the allowance less abstract, and measured physical prototypes could establish which materials and channel proportions feel best.

## Verification

From the repository root:

```sh
node --test ideas/51-cable-cairn/model.test.mjs
node tools/check.mjs ideas/51-cable-cairn
```

Model API for independent inspection: `parameters(input)`, `outline(input)`, `mesh(input)` returning `{vertices, faces, params}`, `stl(input)` returning an `ArrayBuffer`, `volume(mesh)` and `area(input)`. Coordinates are millimetres. The saved default is 420 triangular facets and about 21 KB.
