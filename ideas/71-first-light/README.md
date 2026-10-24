# First Light, Last Light
> A printed box cut for your latitude. At sunrise a blade of light crosses it and lands on the date; at sunset it crosses back. On a day you choose, the light goes straight out the other side.

**Kind:** printable instrument
**Run:** open `ideas/71-first-light/index.html` in a browser (classic scripts, works from `file://`, no network, nothing stored). Tests: `node --test ideas/71-first-light/firstlight.test.mjs ideas/71-first-light/ui.test.mjs` (the second drives the page in headless Chromium and skips itself without Playwright). Print checks, from the repo root: `python3 tools/printcheck.py ideas/71-first-light` for the committed STLs, `node ideas/71-first-light/extremes.mjs` for 18 boxes at the ends of every setting, `node ideas/71-first-light/sweep.mjs` for the 6,480-box mesh sweep. `node ideas/71-first-light/build-stl.mjs` rewrites `default.stl` and `coupon.stl`.
**Made by:** Kerbstone

## What it is

A box you print and set outside, facing east and west. Its outline is a pointed oval, 100 × 173 × 30 mm at the default size, with a vertical slit at each end. Each wall is an arc of a circle centred on the opposite slit. That is the figure Euclid draws in *Elements* I.1 to put an equilateral triangle on a line.

At sunrise, light comes in through the east slit as a thin vertical blade and lands on the inside of the west wall as a stripe. Where it lands depends on where on the horizon the Sun rose, and that depends on the date. So the inside of the west wall carries grooves, each cut where the sunrise light falls on a given day of the year at your latitude. At sunset the same happens in reverse, onto the east wall.

The page (`index.html`):

- **Takes your place.** Latitude (58° S to 58° N), longitude, the height of your eastern and western skylines (−1° to 5°), the box size (70 to 102 mm slit to slit) and the slit width (0.8 to 1.6 mm). Optionally it takes a day of your own.
- **Generates the solid** in the browser and downloads it as a binary STL, along with a small test coupon. Nothing is fetched or sent.
- **Shows the box through the year.** A plan with today's morning and evening beams, the two inner walls unrolled with the stripe on them (and any second stripe your slot lets in), a slider and *Play the year*. It also gives the clock times when the stripe appears and when the box is meant to be read.
- **Prints a key.** Which dates each groove stands for, and when the light goes straight through both slits (near the equinoxes).
- **Gives an error budget for your place.** It covers refraction, timing, alignment and stripe width, in degrees and in days.
- **Explains how to set the box up**, including the time of solar noon for aligning it with a plumb line.

There are 13 groove positions per wall: one every 15° of the Sun's ecliptic longitude between the solstices. Each position except the two solstices stands for two of the 24 solar terms of the Chinese calendar. Long grooves mark the solstices and equinoxes, middle ones the four days halfway between, and short ones the rest. A groove is left out when it would sit inside the far slit or crowd its neighbour. With flat horizons, the equinox groove falls inside the far slit and is replaced by it: on the days its light would reach it, the light leaves the box. With *your day* set, the box gets a slot right through each wall. On that morning, and on its twin on the other side of the solstice, the light goes out through the slot instead of stopping on the wall. A slot is an opening both ways, though: on many other mornings and evenings it lets in sunlight from the other end of the day as a second stripe. A strip of opaque tape over the outside of each slot, taken off around your day, stops that.

`default.stl` is the box for 45.0° N, 0° E, flat horizons, 100 mm, 1.2 mm slits. `coupon.stl` is the test coupon: a 76 mm length of the same wall with five slits from 0.8 to 1.6 mm, one groove and one slot, with each slit's width engraved in front of it.

## Why I made it

The brief was an instrument, printable, that someone takes outside to measure something real in the sky, fitted to their own place. This entry was started by an earlier session that was cut off before it wrote tests or a README. Its notes listed three candidates:

1. **A nocturnal**, the old star clock read off the Plough turning round Polaris. Handheld and works any clear night. But latitude barely changes the object, and it only works in the north.
2. **A Chankillo comb.** A row of posts sighted from a fixed point, like the thirteen towers on the ridge at Chankillo in Peru. Seen from their observing points, the towers span almost exactly the Sun's yearly rising and setting arcs (Ghezzi & Ruggles 2007). Direct and precise, but you have to look at the Sun, and the posts would be pins.
3. **The light box.** It turns the comb inside out: the Sun's rising point is read as a stripe of its own light on a wall.

I read all of it before deciding whether to keep it, and kept the third. You never look at the Sun, only into a box. Latitude changes everything about the walls: the solstice grooves at 58° N sit 85 mm along the wall from the slit, against 40 mm at the equator. It works at both ends of the day and in both hemispheres. And the shape is not a style choice: a wall that is a circle centred on the opposite slit meets every ray very nearly head-on, so a degree of the Sun's swing is very nearly the same length everywhere on it (to within 0.4% at the smallest size, because the light pivots half a land inside the slit). Nothing in the 70 earlier entries reads the date off the horizon. The nearest are a sundial that reads the hour (53) and an explorable of the analemma (41).

The part that can be proven is where the light lands. The Sun's direction comes from a standard model checked against JPL's ephemeris. The wall angles follow from the geometry, and sunlight traced through the triangles of the actual STL lands in the grooves it is cut for. The part that can only be felt is standing outside on a cold morning while the stripe slides onto your day's slot and goes out through it. Or watching it stop: for two weeks around the June solstice it barely moves, the "standing still" in the word solstice, there on the wall.

## How it works

**The Sun** (`firstlight.js`). Meeus's low-accuracy solar coordinates (*Astronomical Algorithms*, 2nd ed., ch. 25), Greenwich sidereal time (ch. 12) and the Julian day (ch. 7), with ΔT fixed at 69 s. Refraction is Bennett's formula (1982): 34.5′ for a body seen on the horizon. A sunrise is the moment the Sun's centre is seen on your horizon, with its upper half above it. `sunEvent` finds it by iteration on the hour angle and returns its azimuth. The amplitude *a* is how far north of due east (or due west) that is. The page also computes the moments the Sun's upper and lower edges touch the horizon, each refracted by its own height. Those give "the stripe appears" and "it is gone".

**The walls.** The box is the intersection of two discs of radius *D* (the size), centred on the two slits, which sit *D* apart. Wall thickness *t* = 2.4 mm, so each inner face is a circle of radius *R* = *D* − *t* about the opposite slit's outer face. Morning light at amplitude *a* lands on the west wall at angle −*a* about the east slit, with one correction. Each slit has a straight land 0.5 mm deep at the outer face, then jaws that flare inwards just wider than the steepest light it must pass. A beam through a slit of finite depth is centred on the middle of the land, not on the outer face. By the sine rule it lands nearer the axis by asin(0.25 sin *a* / *R*): 0.07° at *a* = 30°, about 0.13 mm. At 58° it reaches 0.19 mm. The first draft of this box left that out, and the ray-tracing test below fails on that version by 0.20 mm. Grooves are 1.0 mm wide and 0.6 mm deep, and run down from the wall top: long ones to the floor, middle and short ones two thirds and one third of the way down the part of the wall the stripe can be seen on (all of it, unless the skyline is raised; see below). Your slot is 1.2 mm wide, cut right through, and placed at the mean of four years' amplitudes for that date (a whole leap cycle, 2026 to 2029). Features keep at least 0.8 mm of wall between them on the inner face, and at least 2.4 mm between two cuts that go right through, as the design draws them, and stay 4 mm clear of the tips. The slit's flared jaws meet the curved inner face a little wider than the design assumes, so on the printed solid a pillar between the slit and your slot can be thinner than 2.4 mm: about 2.1 mm in the thinnest case found. A slot near the slit leaves the wall between them as a column that stands on the floor alone; the page warns when it is under 6 mm, because a knock can snap it.

**The solid.** The plan is a planar map: the wall pieces, the slits and slots (floor height), the grooves, the floor and the engraved lettering are polygons that share their boundary points exactly. Each region is extruded from the bed to its own height. Vertical walls run between neighbours of different heights, split at every height either endpoint is used at, so there are no T-junctions. A 0.4 mm 45° chamfer runs round the bottom edge, and the bed is one flat face. Regions are triangulated by ear clipping with hole bridging, written so that no point is ever dropped, because a neighbour's wall uses it. The lettering (the latitude and a north arrow, 0.6 mm deep in the floor) is a seven-segment stencil, so every stroke is its own convex hole at least 0.8 mm wide. The STL writer is a dozen lines and writes an ASCII header that does not start with `solid`.

**Reading it.** Look into the box, not at the Sun. The stripe appears as the Sun's upper edge clears the skyline, about a minute and a half before the moment the box is cut for (half the Sun up) at 45° N. It then slides about 0.3 mm a minute. With a raised skyline, read the lower part of the far wall. If you cut a slot, keep tape over the outside of both slots except around your day and its twin. The page gives both clock times for any day, in the device's own time zone and in UT. At 45° N the stripe moves up to 0.95 mm a day along the wall near the equinoxes (1.27 mm at 58°), and for 15 days around the June solstice it stays within half a millimetre of the long groove.

**What else the light does.** Three things the first version left out, found by an independent review:

- *A slanting beam is narrower.* Behind the 0.5 mm land, light at angle *a* to the slit passes a beam *w* cos *a* − *l* sin *a* wide. At 58° N with a 0.8 mm slit that is 0.13 mm at the June solstice, 16% of the slit. With a 5° skyline there, the slit is shut on 37 mornings around the December solstice, because it closes to light more than atan(0.8 / 0.5) = 58° off its line. The coupon is seen head-on and cannot show this, so the page gives the share for your place, dims the stripe to match, and says when to choose a wider slit.
- *A raised skyline floods the top of the far wall.* With the Sun *h* degrees up when the box is read, light over the near wall's top lights the far wall directly above about 30 − *R* tan *h* mm: 21.5 mm at 5° on the default box. The stripe can only be told from the wall below that line. So under a raised skyline the middle and short grooves are cut longer, to two thirds and one third of the way down the part below it, and the page draws the sunlit band. Flat and sunken skylines are unchanged, and so is `default.stl`.
- *Your slot lets light in.* A straight cut through the wall passes light both ways, within about 26° of its own line. The slot in the east wall, cut for an evening, lets morning sun onto the west wall, and the west slot lets evening sun onto the east wall. At 45° N with 14 May as your day, that lets a second beam into the box on 339 of the 730 mornings and evenings of 2026. Mostly it makes a second stripe on the far wall; on 28 of them it lands on the flared sides of the far slit, and on 16 of those none of it goes out. 14 of the 339 fall within half a millimetre of a groove. No shape of slot can pass your day's light out and stop light coming the other way along the same line, so the page draws the second stripe, lists the days it falls near a groove, and says to tape the slots except around your day.

**Aligning it.** Three ways, on the page. The best uses one clear sunrise: turn the box until the light lands where the page says it will that day. The others are the shadow of a plumb line at solar noon, whose time the page gives (checked against Horizons to within 3 seconds), or a corrected compass. Near the equinoxes, light passing straight through both slits is the check. The page counts a morning as straight through when the centre of the beam passes inside the far slit's 1.2 mm width, about ±0.35°. At high latitudes the centre can step right over it between one morning and the next, leaving only the edge of the stripe to get out, and the page says so when it does.

### Printing it

- **Settings.** PLA (or PETG or ASA for a box that lives outdoors through a summer), 0.4 mm nozzle, 0.2 mm layers, 3 perimeters, 20% infill. Print floor down on the bed as exported, with no supports. On a 180 mm bed, turn the box 45° on the bed, where it is about 132 mm across. Lying straight, a box over about 96 mm puts PrusaSlicer's default skirt (one line, 6 mm out) off the bed. At 102 mm a 2 mm skirt still runs off, by 0.7 mm, in its G-code.
- **What printcheck reports** (`tools/printcheck.py`, PrusaSlicer 2.7.2 with those settings, which are its defaults):
  - `default.stl`: 100 × 173.2 × 30 mm, 51.5 cm³ of solid, 57.3 g, 5 h 9 min.
  - `coupon.stl`: 76 × 20 × 14 mm, 5.3 g, 48 min.
  - Both add 0.0% filament when sliced with supports at 45°, have no overhang or thin-wall warnings, and have p5 wall thickness of 2.0 mm and 1.4 mm.
- **Extreme settings.** The 18 boxes in `extremes.mjs` all pass with no warnings, from 30.4 to 53.1 cm³ (34.5 to 58.9 g). They cover each setting at its ends and three corner combinations.
- **Overhangs and walls.** Every face of every box in the 300-box test sweep is flat on top, vertical, on the bed, or part of the 45° bottom chamfer. There are no bridges and no overhangs beyond the chamfer. Walls are 2.4 mm, 1.8 mm behind a groove; the floor is 2.0 mm, 1.4 mm under the lettering.
- **Print the coupon first.** Hold it up to a window and choose the narrowest slit that shows an even line of light top to bottom, then set that width on the page. The coupon is seen head-on, but the box's steepest light crosses the slit at a slant and gets through less of it. At high latitudes, when the page says so, choose a wider slit.
- **[Certain] This object has not been physically printed.** The parts most likely to need adjusting on a real printer:
  - **The slit width.** A printed 0.8 or 1.0 mm gap can close up or come out ragged; the coupon is there for this.
  - **The 0.5 mm land at the slit.** The nozzle will round its sharp wedge corners, which may shift the beam's centre by a fraction of a millimetre.
  - **The 0.6 mm grooves.** They may print shallow or soft-edged.
  - **The 0.45 mm floor ridges between lettering strokes.** They may not print at all, which leaves the text still legible.

## Honest assessment

What is shown:
- **[Certain]** The Sun model agrees with JPL Horizons (DE441):
  - **Sunrise and sunset directions** within 0.011° at 148 sunrises and sunsets in ten cities from 56° N to 55° S, dated 2026 and 2045. Times are within 5.4 s.
  - **Unrefracted positions** within 0.008° in azimuth (scaled by the cosine of elevation) and 0.005° in elevation at 32 samples.
  - **Raised horizons** of 3° and 5° within 0.012° at 44 events.
  - **Solar noon** within 2.5 s at 32 transits.

  I re-fetched 8 rows of the cached `horizons.json` at random on 2026-10-24, and all 8 were identical.
- **[Certain]** That agreement does not test refraction. Horizons' manual says its refraction is approximate and cites Saemundsson (1986). I computed Saemundsson's formula against Bennett's, the one used here: from 0° to 10° they agree within 0.06′. So both sides assume the same standard air. Below 0° the two formulas part (1′ at −0.5°, 5′ at −1°): the page's horizons below zero rest on Bennett's formula outside the range it was fitted for, with no outside check. The manual itself warns that near the horizon errors can be ±0.3°. Schaefer and Liller (1990) measured horizon refraction from 0.23° to 1.68° against a standard 0.58°. I read that through papers quoting it, not in the original.

  A horizon below 0 is a sea horizon seen from a height. It dips about 1.76′ × √(height in metres), so −1° needs an eye about 1.2 km up. There the light grazes the sea, and is bent by about the horizontal refraction plus 0.13 of the angle its path turns through on the way up to the eye. That rough estimate gives about 43′ at −1°, where Bennett's formula gives 49.8′. I have not checked the estimate against an outside source. The difference, about 7′ in the Sun's height, is about 0.12° of azimuth at 45° N at the equinox and 0.3° at 58° N in summer, so treat horizons below 0 as rough.
- **[Certain]** In the printed geometry, light lands where the design says. Parallel sunlight traced through the STL's own triangles, at 0.01 mm spacing, lands within 0.006 mm of the middle of the groove it is cut for, at all 89 grooves of four very different boxes. The groove is located separately, by sweeping probe rays across the wall, and the test fails above 0.02 mm. It also leaves through the far slit near the equinox and through your slot on your day. A slanting beam passes the slit at the width its land allows, *w* cos *a* − *l* sin *a*, traced at the steepest settings the page offers, down to none at all.
- **[Certain]** Every box tested is a closed, consistently wound solid with no handles, read back from the STL bytes as float32. That is all 6,480 in `sweep.mjs`, the 300 in the test, and both committed files. It sits on the bed at z = 0 with a flat face and fits a 180 mm cube. The part does; the slicer's default skirt does not at the larger sizes, so on a 180 mm bed turn it 45°. The page's download for the opening settings is byte-identical to `default.stl`, and the coupon's to `coupon.stl` (checked in headless Chromium).
- **[Certain]** Your slot lets light in as well as out. Traced across the whole box through the mesh on 16 sampled days, the second stripe falls where the page draws it, to within 0.05° on plain wall. Where the beam meets the far slit, only the part that passes the slit's land goes out; the rest lands on the slit's flared sides, and the page draws it in the slit's mouth. Traced on every morning and evening of 2026 at 45° N with 14 May as your day, the light that stays in the box and the light that goes out agree with the page's figures within 0.02 mm, and the page counts the same days the trace finds light in the box. Untaped, it could be read as the wrong date; the page lists the days it falls near a groove.
- **[Certain]** Under a raised skyline only the lower part of the far wall shows the stripe. Traced, the sunlit band starts between 0.15 mm below and 0.6 mm above the line the design uses. In the two boxes traced (skylines from 2° to 5°), the shortest length of groove that shows the stripe was 6.5 mm; a short groove used to meet it over 0.8 mm at 5°.
- **[Certain]** A level error matters much less than a turning error. Tilting the box by 2° moves the stripe by at most 0.017° with the Sun on a flat horizon, and 0.18° with it 5° up. Turning it by 2° moves the stripe by 2°.
- **[Certain]** The dates in the key stay within a day of 2026's in every year from 2027 to 2060, checked at six latitudes from 58° S to 58° N. I have not checked every latitude.

What is likely, and what is not known:
- **[Likely]** A well-aligned box could date a morning near the equinox to within about one and a half days at 45° N, and not at all near a solstice. The budget behind that, from the page, with the Sun moving 0.55° a day there:
  - Judging the middle of a stripe 1.2° wide (the slit and the Sun's disc), taken as half its width: 1.1 days.
  - Refraction ±0.3° in height: 0.5 days.
  - Reading a minute off: 0.3 days.

  Those change from morning to morning, and come to 1.3 days as the root of the sum of their squares. A horizon misjudged by half a degree (0.9 days) and a turning error (1.8 days a degree) are the same every morning, and shift every reading on top of that. On mornings when refraction is far from standard, as Schaefer and Liller found, it will be worse. These are figures from the model, not from a dawn.
- **[Likely]** Your slot catches part of the light on your day every year. At 58° the stripe centre was up to 0.77 mm from the slot's centre in 2026–2060, against a slot half-width of 0.6 mm and a stripe 1.5 to 2 mm wide. Those are the largest offsets found at four latitudes and six days, not a bound.
- **[Speculative]** The stripe is easy to see at a real dawn. The low Sun is dim and red, a 1.2 mm slit lets little of it in, and haze on the horizon can hide the moment the box is cut for. A raised horizon setting helps with a skyline, not with haze. Nobody has looked.
- **[Speculative]** The felt part works: the morning your light goes out through your slot, the two weeks the stripe stands still.
- **[Likely]** PLA is the wrong plastic for a box that stays outdoors. It softens at around 60 °C, and a box in strong summer sun may get that hot. PETG or ASA should be safer; I have tested neither.
- **[Certain]** Simplifications:
  - One horizon height per side. A real skyline varies along the Sun's yearly arc.
  - No terrain or local refraction model.
  - The solar-term names are the Hong Kong Observatory's, confirmed through search extracts of its pages; I could not open them directly from here.
  - The 24 solar terms carry northern-hemisphere season names, which the page notes.

## Tests

`firstlight.test.mjs`, 30 tests, Node built-ins only, about 14 s:

- **Against JPL Horizons** (`horizons.json`, fetched 2026-10-23 and 24 through the Horizons API): sunrises and sunsets (148, and the 0.011° and "148" quoted in the page and this README are pinned); unrefracted positions (32); raised horizons (44); solar noon (32).
- **Rising-azimuth formula** against a point turned about the celestial pole until it crosses the horizon (bisection, no shared formula): within 1e-8°.
- **Bennett's refraction** is 34.48′ at the horizon, and its inverse round-trips.
- **The committed STLs** are byte-identical to what the code makes now; the header is ASCII and does not start with `solid`.
- **Closed, flat, supported**: the default box, the coupon and 300 extreme combinations (latitude ±58°, ±23.44°, 0°; size 70 and 102; slit 0.8 and 1.6; horizons −1 and 5; four days including 29 February) are read from STL bytes and checked edge by edge. The check covers Euler characteristic 2, positive volume, lowest point z = 0, a bed face, fit within 180 mm, and every face's normal classified with no overhang beyond the chamfer.
- **Wall left between features** is at least 0.8 mm, and 2.4 mm between through-cuts, over 7 latitudes × 3 sizes × 8 settings of your day. **Engraved strokes** are at least 0.8 mm wide (by rotating calipers) and 0.6 mm deep.
- **The coupon's five slits** measure 0.8 to 1.6 mm.
- **Out-of-range settings** throw.
- **Ray tracing** through the mesh, covering the grooves, the far slit, your slot, and the beam width at the steepest angle against *w* cos *a* − *l* sin *a*.
  - **Grooves:** 89, worst 0.006 mm. Each groove is found by an independent probe, which also confirms its 1.0 mm width, and at least 60% of the beam must land in it.
  - **Mutation check:** replacing the land correction with the first draft's `−amp` makes the groove test fail at 0.20 mm.
- **Key dates** across 2027–2060; each groove gives two dates; the solstice dwell is 12–18 days within half a millimetre at 45° N; every sunrise exists inside the latitude range.
- **Timing**: first gleam to half disc is 1–2.5 min, and the stripe moves 0.25–0.35 mm a minute, at 45° N on the equinox.
- **Tilt**: as above.
- **Light that does not come through the slit as drawn** (added after the independent review):
  - *Your slot's second stripe*: level light traced across the whole box, not just past the near slit, on 16 days at 45° N with 14 May as your day. Wherever the trace shows a second stripe, `slotLeak` predicts it, and wherever `slotLeak` predicts one on plain wall, the trace shows it, its middle within 0.05° and its width within 0.06 mm.
  - *Where it meets the far slit*: every morning and evening of 2026 for the same box, traced 0.005 mm apart across the beam your slot lets in. The width that stays in the box and the width that goes out agree with `slotLeak` within 0.02 mm, and the days counted are the days the trace finds at least 0.05 mm of light in the box. The width check is repeated for the beams that meet the far slit or a slot in the far wall at 0° with 1 March as your day. The counts quoted above are pinned.
  - *Raised skylines*: each groove's floor and the wall 2 mm either side are traced back toward a Sun 2° to 5° up, at two boxes. The design's line for the sunlit band must sit no more than 0.15 mm above, and no more than 0.6 mm below, the traced one, and every groove must show the stripe over at least 5 mm.
  - *A slanting beam*: `aperture` against beams traced 0.002 mm apart at the steepest settings, including a slit shut to the light; the 37 shut mornings are counted. In all five cases the light is less steep than the jaws' flare, so only the land narrows it. The further cut the jaws make on steeper light is checked against the trace only at a made-up angle, 8° past the flare of the box for the equator.
  - *Past the end of the wall*: the light's landing point is on the near wall by the tip, as the trace finds; on the opening box every day lands on the far wall.
  - *Reduced-motion stops* fall within a day of every date in the key, at four latitudes.
  - *The budget*: days per degree of turning swept over every latitude, and the 1.3-day spread quoted above.
  - *Words that carry numbers*: the dip rule, the refraction estimate below 0°, the turned footprint on a 180 mm bed, and the thinnest pillar.

`ui.test.mjs`, 7 tests, drives the page in headless Chromium (it skips itself without Playwright). Each pins something the page said wrongly or not at all before the review or the second check: the second stripe in the readout and the facts, light past the end of the wall, the share of a narrow slit steep light gets through, the sunlit band, a column left by your slot, the days a degree of turning costs at the equator, Play's first stop with reduced motion, a second beam on the far slit's flared sides, and the reason given when your slot is not cut.

`node tools/check.mjs ideas/71-first-light` runs these, printcheck and the headless smoke test at 1280 px and 390 px.

## Where it could go next

- A horizon profile instead of one number per side, drawn from a phone photo of the skyline.
- A lid with a slit for noon: the same idea pointed up, giving declination at midday on any clear day rather than only at sunrise.
- A real print and a season of mornings against the page's predictions. That is the test this entry most needs.

## Revision note: the unfinished draft

This folder was begun by an earlier session that stopped before writing tests. I checked every line it left and kept the design. The changes:

- **The land correction** described above. The draft put every groove too far from the axis, by up to 0.2 mm at 58°.
- **The reading instructions** said to read the stripe "where it first appears". The grooves are cut for half the Sun up, a minute and a half later at 45° N. The page now gives both times.
- **The far-slit check** used the wrong distance. It also assumed the light always passes through on some day, and at high latitudes it can step over.
- **Your slot's row in the key** said "not cut" when the slot was cut but no morning was centred inside it. It now gives the nearest days and how far off they are.
- **The page claimed the solid was ray-traced** before any such test existed. It now is.
- **My own first ray test was too kind.** It found the groove from the rays that landed in it. When the beam is narrower than the groove, every ray lands in it, so the test measured the beam against itself. It passed the draft at 0.12 mm when the real error reached 0.20 mm. The groove is now found by a separate probe that uses no sunlight.
- **The 0.011° Horizons figure** now comes with the fact that both sides use the same refraction.
- **Smaller fixes:**
  - The STL header had turned "°" into "0".
  - A slot could stand 0.8 mm from a slit, leaving a 28 mm pillar that thin.
  - The equinox groove was labelled "south half".
  - Print settings now match the slicer figures quoted.

## Revision note: independent review

An independent reviewer rebuilt the checks with its own code: a ray tracer, fresh JPL Horizons data at eight new sites, and the slicer's own toolpaths. The Sun model, the grooves and the solids held. What it found was light the tests never traced: light that does not come through the slit as drawn, and light the slit itself narrows. I reproduced every finding with my own code before changing anything, and all ten held:

- **Your slot lets light in.** It is a straight cut through the wall, so it is a second slit for the other end of the day. At 45° N with 14 May as your day, my trace found a second stripe on 55 of 122 sampled mornings and 55 evenings, 0.98 mm wide on 1 January. The README had said the light "is stopped otherwise". No shape of slot can let your day's light out and keep the reverse light out, so the page now computes the second stripe (`slotLeak`), draws it with a dashed edge in the plan and on the walls, names it in the readout, and lists the days it falls within half a millimetre of a groove. It also says to keep tape over the slots except around your day.
- **A raised skyline floods the top of the far wall.** At 5° everything above about 21.5 mm is in direct sun when the box is read, and the short grooves (20.7 to 30 mm) met the stripe over 0.8 mm. The reviewer suggested running the grooves up from the floor. That needs a ceiling over each groove, an overhang this support-free extrusion cannot make. So the middle and short grooves are now cut down to two thirds and one third of the part of the wall below the sunlit line, and the page draws the band. Flat and sunken skylines are unchanged, and so are the committed STLs.
- **The land throttles steep light.** Behind the 0.5 mm land a beam at angle *a* is *w* cos *a* − *l* sin *a* wide: 16% of a 0.8 mm slit at 58° N in June, and nothing at all on 37 mornings with a 5° skyline. The README said the steepest light passed "at the full width the slit should allow". The page now gives the share for your place, dims and narrows the drawn stripe to match, uses the narrower beam in the budget, says when no light gets in, and tells you to choose a wider slit than the coupon's narrowest clean one when the share is under 40%.
- **Light past the end of the wall** was reported as landing 106.6 mm along a wall 100.8 mm long (58° N, 5° skylines, 21 December). The page now says it falls on the near wall by a tip, and draws it there. The note on grooves left out now gives each one's real reason, not "crowded" for all.
- **Smaller fixes:**
  - A degree of turning costs up to 2.6 days near the equinoxes at the equator, not "one to two days"; the page gives the figure for your place.
  - Reduced-motion *Play* now stops on both dates of every groove; it used to skip about half of them.
  - The horizon hint gives the dip of a sea horizon (−1° needs an eye about 1.2 km up), and this README gives a rough estimate of the refraction there.
  - On a 180 mm bed the slicer's default skirt runs off the bed at the larger sizes; turn the box 45°. The reviewer's other remedy, a 2 mm skirt, still runs off at 102 mm, so I left it out.
  - "No thin pillars" is now "no pillar thinner than 2.4 mm", and the page warns when your slot leaves one under 6 mm.
  - "About a day at 45° N" is now "about one and a half days": the page's own budget gives 1.3 days for the terms that change from morning to morning, before any fixed error.

The tests in `firstlight.test.mjs` from "your slot lets in a second stripe" onwards are new, and so is `ui.test.mjs`. I put each old behaviour back in a copy of the code, one at a time, and the matching new test fails on it.

**A second check** of these fixes found three more faults. I reproduced each before changing anything:

- **A second beam that met the far slit was counted as leaving.** Any beam from your slot whose middle fell inside the far slit's flared mouth was taken to go out again, and the plan drew it leaving the box. But it reaches the mouth at a slant, and traced, most of it lands on the slit's flared sides. At 45° N with 14 May as your day, none of it goes out on 16 of the 28 such mornings and evenings, and only part of it on the other 12. `slotLeak` now works out how much of the beam passes right through the far slit, land and all (or through a slot in the far wall), and counts the rest as light in the box. Beams under 0.05 mm wide are no longer counted. The count for that box went from 319 to 339 of the 730 mornings and evenings. The readout now names the patch on the slit's sides, and the plan and the walls draw it in the slit's mouth. A new test traces every morning and evening of 2026 for that box.
- **A slot left out near a tip was blamed on the far slit.** At 58° N with 5° skylines and 21 December as your day, both slots are left out because they would sit within 4 mm of a tip, where the light passes the end of the wall. Three places on the page said the day was too close to the far slit. They now give the reason the design records for each wall.
- **The list of tests claimed a case where the jaws cut in.** None of the five slanting-beam cases is steeper than the jaws' flare, so in all of them only the land narrows the beam. The claim is gone. The jaws' further cut is now checked against the trace at a made-up angle past the flare, and the test checks that the five cases stay below it.

I put each of the three old behaviours back in a copy of the code, and the matching new test fails on it.

A last check after those fixes found two sentences that promised more than the box delivers, which the coordinator softened by hand:

- **"Where nothing is cut" was not always true.** At a few corner settings, morning light that passes the end of the far wall lands in a groove cut on the near wall for the evening. The readout no longer says nothing is cut there; it says not to read a stripe there as a date.
- **"No pillar thinner than 2.4 mm" held only for the design as drawn.** The slit's flared jaws meet the curved inner face a little wider than the design assumes, so the pillar between the slit and your slot can be about 2.1 mm on the printed solid. The README says so, and the page's warning gives its figure as "about", "a little less on the printed box".

