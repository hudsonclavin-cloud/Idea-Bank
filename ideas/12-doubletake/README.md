# Doubletake
> A printable pot that is a square to your eye and a circle in the mirror behind it. The rim is solved exactly; the double take is yours.

**Kind:** printable
**Run:** open `index.html` in a browser (plain classic scripts, works straight from disk or any static server; no build, no network), pick two shapes, press **Download STL**. A ready-made file for the defaults is `example-square-eye-circle-mirror.stl`. Tests: `node --test ideas/12-doubletake/doubletake.test.mjs` from the repo root (Node 22, about 60 s).
**Made by:** Verso

## What it is

A generator for an *ambiguous cylinder*: a pot with vertical walls whose rim is a carefully bent space curve. Stand it in front of a mirror and look down at it from the angle it was designed for. The rim draws one shape on the pot and a different shape in the mirror, and the two can't both be the pot. Turn the pot half way round and the two shapes swap.

On the page you:

- **pick the two shapes**, one for your eye and one for the mirror, from ten (circle, square, diamond, hexagon, triangle, pentagon, four-point star, heart, crescent, oval); every one of the 100 ordered pairs works, including a shape with itself (that one is just an ordinary pot);
- **set the size and print settings**: viewing angle 30–60°, width 30–80 mm, the height of the lowest rim point, wall 1.2–3.2 mm (in 0.4 mm steps), floor 1.2–4.0 mm, and how many rim vertices to use;
- **watch it** in a small software renderer: the pot on a turntable in front of an upright mirror. Drag sideways to turn the pot, up and down to move your eye. **Design view** puts both back; **Turn around** swaps the shapes; **Spin** turns it slowly with a pause at the front and the back (off when the system asks for reduced motion);
- **read the proof**: each rim vertex projected the way your eye sees it and the way the mirror shows it, drawn over the target shapes, with the worst miss in millimetres;
- **download the STL** and read the numbers a printer cares about: footprint, height, volume and PLA mass, thinnest wall, steepest overhang, triangle count.

The thing that can be proven is the geometry: every rim vertex projects onto both shapes to floating-point rounding, and the solid obeys the printing rules, which the tests check on the written STL. The thing that can only be felt is the double take: knowing exactly why it happens doesn't stop your eye insisting the pot is square while the mirror insists it's round.

## Why I made it

Kokichi Sugihara's ambiguous cylinders are the best physical illusion I know, and the trick is almost embarrassingly linear. Under a parallel view from elevation φ, a rim point's image height is z·cosφ − y·sinφ, and in a mirror behind it, z·cosφ + y·sinφ. Two image heights pin down y and z, so any two outlines you want to see are a 2×2 linear solve away from a rim. I wanted to know whether that solve could be turned into an object a stranger could print without supports and without knowing any of this, and whether the printing rules (vertical walls, a flat base, a minimum wall) would fight the illusion or come for free.

They mostly come for free: the rim lives entirely at the top of the print, so the walls can be dead vertical. The work turned out to be in the unglamorous middle: offsetting a strange outline inward by exactly one wall, triangulating the bands between rings without a single folded triangle, and making the result hold for every pair and every slider setting rather than for the one that photographs well. The part I can't settle from here is the part the brief calls felt: whether the pot does to a real person, in a real mirror, what it does on the screen.

## How it works

**The rim.** Each shape is a top curve and a bottom curve over x ∈ [−1, 1] that meet at the ends (the "pinch points"), scaled to half the pot's width R. The viewer is on the +y side looking down at elevation φ; the mirror is a vertical plane behind the pot. Under parallel projection the eye sees image height h₁ = z·cosφ − y·sinφ and the mirror shows h₂ = z·cosφ + y·sinφ, both at horizontal position x. The near half of the rim must show the eye shape's bottom curve and the mirror shape's top curve; the far half, the eye shape's top and the mirror shape's bottom. So for each x:

  z = (h₁ + h₂) / (2 cosφ),  y = (h₂ − h₁) / (2 sinφ).

Since y_near − y_far = (height of shape A + height of shape B)/(2 sinφ) ≥ 0, the outline seen from above is always x-monotone: a lower chain (the far rim) and an upper chain (the near rim) over the same x range, meeting at the two pinch points. Rim stations are placed at equal 3-D arc length along each chain, with every corner of either shape kept as an exact station. A pair's square is a superellipse |x|⁶ + |y|⁶ = 1, because the construction needs the top and bottom curves to meet at the ends, and a true square's vertical sides don't.

**The solid.** The pot is that outline extruded straight up as a wall, cut off at the top by the rim, standing on a flat floor:

- *Inner wall.* For an x-monotone region, eroding by the wall thickness d is exact and simple: a disk of radius d fits under the upper chain U iff its centre is below U_d(x) = min over x′ of U(x′) − √(d² − (x′−x)²), and likewise above the lower chain. Along each straight edge of the chain the constraint is convex, so the minimum is at an endpoint or the tangent point. The cavity is L_d ≤ y ≤ U_d, sampled adaptively, with its ends found by bisection where the two envelopes meet. The erosion is run at d + 4 µm, so the straight chords between samples cannot cut into the wall. Then the exact minimum distance between the two outlines is measured (vertex-to-segment both ways). If it is less than d + 0.5 µm, the erosion is rerun with a bigger margin.
- *Rim top.* A band between the outer rim and the inner rim. Each inner vertex takes the rim height at its nearest point of the outline, so the band runs level across the wall.
- *Base chamfer.* The outline eroded by 0.4 mm at z = 0, joined to the outline at z = 0.5 mm. This ring is also sampled directly inside every outline vertex (at the mitre point of its two edges), so the chamfer facets stay near 38.7°.
- *Bands* (rim top, chamfer) are triangulated by dynamic programming over (outer vertex, inner vertex) pairs that accepts only triangles that are counter-clockwise in plan (and, for the chamfer, lean no more than 42° from vertical), minimising total rung length. Such a triangle chain has the two rings as its boundary, so it covers each point of the band exactly as many times as their winding number says: once. It cannot fold or overlap. The same programme triangulates the flat floor and bottom as a ladder between two chains of the ring. It first tries a minimum triangle area of 0.01 mm² and relaxes it only if no triangulation exists. Ear clipping is kept as a fallback; in 3,000 random parameter sets it was never needed.

**Design for printing.** Every choice below follows the FDM rules I worked from, for a 0.4 mm nozzle:

- *Orientation and supports.* It prints upright, as generated. The walls are vertical. The rim and the floor face up, and the rim band is a height field, so every vertical line through the footprint meets the solid in one interval from the bed up. The only downward-facing surface off the bed is the base chamfer.
- *Flat base, chamfered.* The bottom is one flat face at z = 0. The bottom edge is chamfered 0.4 mm in over 0.5 mm up (38.7° from vertical) to absorb elephant's foot and ease removal; a fillet there would start as an unprintable near-horizontal surface. No chamfer facet is allowed past 42°.
- *Walls.* The wall setting moves in 0.4 mm steps from 1.2 mm (3 perimeters) to 3.2 mm (8), so a slicer fills it with whole perimeters. It is a hard minimum, measured. The floor moves in 0.2 mm steps (6 to 20 layers at 0.2 mm).
- *No trapped volume.* One closed shell, and the cavity is open to the top.
- *Size and tipping.* Width is capped at 80 mm, and the depth is at most twice the width (≤ 160 mm). The height you ask for (of the lowest rim point) is lowered if the pot would be taller than 180 mm or more than 4× its narrowest footprint side (the usual tall-and-thin rule); the page says when that happens. Every combination fits a 180 mm cube, the smallest common consumer build volume.
- *Faceting.* Between rim vertices the rim is a straight edge. Its projection strays from the target shapes by at most 0.011 mm at the defaults, and by at most 0.141 mm at the coarsest, widest settings: below what a 0.4 mm line can draw.

**STL pipeline.** Vertices are kept in float64 and written as a little-endian binary STL (80-byte header that doesn't start with "solid", triangle count, float32 normal and vertices, zero attribute). Normals are recomputed from the winding. The generator is one file of pure functions (`doubletake.js`), shared by the page and the tests. It is written as a generator, so the page runs it in 8 ms slices and the browser stays responsive. The download is a Blob from that same buffer, named after the parameters.

**The page.** The preview is a small software renderer on a 2-D canvas (about 230 lines): orthographic projection (the illusion is exact in parallel projection, so that's what it shows), flat Lambert shading, back-face culling and a painter's sort. For drawing only, the walls are re-cut into horizontal strips, so the sort keys stay local. The reflection is the same polygons reflected in the mirror plane and clipped to the glass. Render resolution adapts if frames run long. While the view is moving on a slow device, it skips the seam-hiding strokes, and it always draws them when the view comes to rest.

### Verification

`doubletake.test.mjs` builds each mesh, writes the STL, reads it back with its own parser and checks the parsed triangles. It runs 695 meshes: the defaults; both ends of every slider; 32 corners of the parameter box; all 100 ordered pairs at the defaults; all 100 pairs at four hard corners (thin wall and wide, thick wall and narrow, 30° and 60°, tallest height); and 150 seeded random sets. 12/12 tests pass.

| Check (on the parsed STL) | Result |
|---|---|
| Closed 2-manifold | every edge in exactly two triangles, once in each direction; one connected shell; V − E + F = 2; no two vertices merge in float32 |
| Degenerate triangles | none: smallest triangle 1.0 × 10⁻³ mm², shortest edge 20 µm, over all 695 meshes |
| Volume | positive; matches the generator's to 10⁻⁵ relative; stored normals agree with the winding |
| Overhang | every downward-facing triangle off the bed lies within the 0.5 mm chamfer band, at ≤ 42°: 38.7° at the defaults, 40.2° the steepest in the tests (41.7° in the 3,000-set sweep below) |
| Height field | along sampled vertical lines (2,000 at the defaults) the surface is crossed exactly twice inside the footprint and never outside |
| Wall | outer and inner outlines read off the wall triangles at z = 0.5 mm and z = floor; exact minimum distance ≥ the setting in every mesh (by at least 0.6 µm); inner outline inside the outer; both simple polygons; floor top exactly at the floor height; a ray-cast sample from the inner wall and the flat faces agrees |
| Self-intersection | no two triangles that share no vertex intersect or touch (separating-axis test on every pair with overlapping bounding boxes); pairs sharing one vertex meet only there; no folded edge pairs. Run on 133 meshes: 11.9 million close pairs |
| Size | bounding box x = ±width/2 exactly, y and z as reported; tallest 176.5 mm, deepest 160.0 mm; height ÷ narrowest side ≤ 4.000; the cap behaves as stated (crescent on crescent at 60° and 30 mm: 100 mm requested, 19.4 mm given), and can always be met: the smallest cap over every pair and whole-degree angle is 19.4 mm, above the 15 mm minimum |
| The illusion | every rim station is an STL vertex and projects onto both shapes within 7.8 × 10⁻⁶ mm after float32 rounding in every mesh (3.6 × 10⁻⁶ mm at the defaults, 10⁻¹⁴ mm in float64); rim edges stray ≤ 0.141 mm between stations |
| Example file | `example-square-eye-circle-mirror.stl` is byte-identical to the generator's output at the defaults; 133.9 KB |

The defaults (square to the eye, circle in the mirror, 45°, 60 mm wide, lowest rim 70 mm, 1.6 mm wall, 2 mm floor) give 60.0 × 84.85 × 91.18 mm, 2,740 triangles, 38.92 cm³: **48.3 g of PLA** at 1.24 g/cm³ if printed solid. Walls this thin print as solid perimeters anyway, so a real print should come out near that. The bed contact is 4,355 mm².

Beyond the tests:

- A random sweep of 3,000 more parameter sets on the final generator had zero failures and zero ear-clip fallbacks. This sweep only builds each mesh and reads the generator's own measurements of wall, overhang and size; it doesn't parse the STL.
- `node tools/smoke.mjs ideas/12-doubletake` passes at desktop and phone width with no console errors or horizontal overflow, in light and dark.
- Driven headless with Playwright, the **Download STL** button produced files for the defaults and for star/heart at 30° and 80 mm. An independent parser found both closed with consistent winding (0 unmatched directed edges), with volumes matching the generator (38.92 and 55.46 cm³).
- Spin runs by default and stays off under `prefers-reduced-motion`. **Turn around** shows the circle on the pot and the square in the mirror.

## Honest assessment

- [Certain] **It has not been printed.** I have no printer. Nothing here has been sliced, printed or held up to a mirror, and I haven't seen the illusion with a real eye. Everything about the physical object below is inference.
- [Certain] The rim is exact at its vertices, and its straight edges stray at most 0.011 mm at the defaults (0.141 mm at worst), *for a parallel view*. A real eye is a point at a finite distance. With the pot against the mirror, the reflection is farther away than the pot, so the mirror view arrives at a shallower angle than the direct one. For the default pot that is 3.2° shallower at 1 m, 1.7° at 2 m and 0.85° at 4 m. Each degree moves the mirror outline by about 0.5 mm on a 60 mm pot (after the best vertical shift). Perspective adds a smaller error of its own: in the direct view, after the best scale and shift, the outline is off by up to 0.54 mm at 1 m and 0.13 mm at 4 m. Hence the advice to stand far back or zoom a camera in.
- [Likely] A few percent of error doesn't break it: an eye reading a rim as a circle or a square is forgiving, which is why Sugihara's objects survive being filmed. How far the forgiveness stretches I can't say. [Speculative] Pairs with sharp corners (star, diamond) may survive worse than round ones, because a corner that misses is easy to see.
- [Certain] The printing rules hold for every mesh the tests built, measured on the STL: vertical walls of at least the set thickness, one flat base, overhang only in the 0.5 mm chamfer (≤ 42°), one shell with an open cavity, under 180 mm, at most 4× taller than wide. For parameter sets not tested, the generator measures its own wall and refuses to emit a thinner one, and the chamfer triangulation refuses steeper facets. The sweep and the tests found no set that fails.
- [Likely] It prints on a consumer FDM printer without supports. That follows from the rules above, not from a print. The weak spots I expect: the rim's high points are tips, so the last millimetres of a tall spike print as small islands (slow down or use a cooling pause); the 0.5 mm chamfer is only two or three layers; the slicer's Z-seam will draw a line on a visible wall unless you put it at a pinch point or the back. The wall is a hard minimum, but a thin wall printed slowly and cooled hard is still only as stiff as PLA allows.
- [Certain] What you see is a band, not a line. The rim is one wall thick. Its outer edge carries the exact outline, and the inner edge sits a wall's width inside, so you see the shape drawn with a pen that wide. On the default pot that is 1.6 mm against 60 mm.
- [Certain] Compromises in the shapes: the "square" is a rounded superellipse (the construction needs the top and bottom to meet at the ends). The crescent is fatter than a thin moon, because a thinner one paired with itself made a pot too narrow to stand up. A shape with itself gives an ordinary cylinder, which is correct but not an illusion.
- [Certain] The height cap changes what you asked for. The page says so in a note, but the slider still shows your number.
- [Certain] The preview is idealised. It is orthographic and shows the design view exactly as the maths does, with no perspective, so it is more convincing than the real thing will be. It is a painter's-sort renderer, so a few tiny glitches remain at grazing views and spiky shapes. Frame rates were measured only in headless Chromium, whose canvas is software-rendered: about 43 fps at desktop size and 32 fps on a phone-sized canvas while spinning. I didn't measure on a real phone.
- [Certain] Mass is for a solid print (1.24 g/cm³). A slicer's estimate will differ with its infill and perimeter settings, though for walls this thin, probably not by much.

## Where it could go next

- **Design for a distance, not for infinity.** The rim could be solved with perspective: put the eye at a point and its mirror image behind the mirror, and intersect matching rays plane by plane through the line that joins them (an epipolar construction). The pot would then be exact from, say, 80 cm with the pot touching the mirror, and the biggest caveat above would go away. A cheaper halfway step is to solve with two different angles, φ for the eye and the shallower φ′ for the mirror; it is still a 2×2 linear solve.
- **Your own shapes.** Draw two outlines (anything x-monotone with pinched ends, which covers letters like O, D and V) and solve for the rim. Two-letter words that become other words in the mirror.
- **A colour change.** A filament swap a few millimetres below the lowest rim point would colour the whole rim band, so the shapes are drawn in a contrasting colour. The colour band's width would vary around the rim, which is itself a giveaway that the rim isn't flat.
- **Print it and photograph it.** Find the distance at which it starts to work, compare that with the numbers above, and put the photo next to the preview.
