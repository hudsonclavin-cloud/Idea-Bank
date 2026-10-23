# The Still Canoe
> Sail from Puluwat to Chuuk the way Carolinian navigators reckon it: the canoe stays put, the stars stay put, and an island you never see slides backward under them until you arrive.

**Kind:** explorable
**Run:** open `ideas/52-still-canoe/index.html` in a browser (plain classic scripts; works from `file://` or any static server; no network, nothing stored). Checks, from the repo root: `node --test ideas/52-still-canoe/etak.test.mjs` and `node tools/check.mjs ideas/52-still-canoe`.
**Made by:** Bearing Drift

## What it is

A single-page explorable that lets you use etak, the way of reckoning a voyage that Thomas Gladwin learned on Puluwat from the navigator Hipour and that Edwin Hutchins later analysed as a computation. In etak the canoe is held still; the stars are a fixed ring of rising and setting points around it; the islands move. A reference island, off to one side and below the horizon, slides backward from one star point to the next, and each step is one etak, one stage of the voyage.

The page runs one real, documented crossing: Puluwat to Chuuk Lagoon (Truk), about 151 nautical miles, with Pisaras as the reference island, as Goodenough and Thomas recorded it for the Penn Museum. Seven sections:

1. **The ring that does not move.** The 32-point Carolinian star compass, each point drawn where its star actually rises or sets at Puluwat's latitude, east at the top. This is an astronomical rendering: the Weriyeng compass itself, as McDonald draws it, sets the points evenly. Tap a point to light up its partner on the other side. The two leaning Southern Cross points, which no star's rising or setting fixes, are drawn hollow.
2. **One voyage, two pictures.** A north-up chart (canoe moves) and the canoe's own view (bow up, stars fixed, islands sliding) driven by one slider, *Sail* button or a sideways drag. A strip cuts the crossing into its eight etak; a curve of Pisaras's bearing against miles sailed shows why the etak are uneven.
3. **Sail it in the dark.** The islands vanish. You are given eight stretches of sailing (hours and an invented speed) and after each you tap the ring where you believe Pisaras now lies. The page shows the truth, your error in degrees, and what your bearing would mean as a position on the track.
4. **The island does not have to be there.** Drag the reference island anywhere: the two star bearings from Puluwat and Chuuk are drawn, the voyage is re-cut, and the readout says how many etak result and whether the island would ever be seen. Text on Riesenberg's ghost islands and Gunn's reading of them.
5. **What does not slide.** In the canoe's frame the destination does not slide against the stars (its bearing stays put to within 0.3°, between two star points), and neither does anything else on a collision course. A small game: watch another canoe against the star ring for a few seconds and call whether it meets you, crosses ahead or passes astern. Tied to COLREGs Rule 7 and to Hutchins's point that a relative-motion frame is sometimes the better one.
6. **What this page simplifies, and what is argued.**
7. **Take it with you.** Four steps for the next time you sit by a window on a train or bus.

`preview.jpg` (960×600, 29 KB) is the two-picture view mid-voyage in the dark scheme.

## Why I made it

The brief was to borrow a mind: to let a reader operate with another culture's or discipline's way of thinking until the world rearranges. I listed candidates and asked of each whether *using* it, not reading about it, would change what someone notices afterwards:

- Pacific wayfinding's etak (the canoe still, the reference island moving).
- The Guugu Yimithirr absolute frame of reference (cardinal directions where English would say left and right), with Levinson's rotation task.
- Old Babylonian "cut-and-paste" algebra in Høyrup's reading, with floating sexagesimal place value.
- The end-weighted cycle of Javanese gamelan, where the gong closes the phrase instead of opening it.
- Kaktovik Iñupiaq numerals, whose strokes make base-20 arithmetic visible.
- A honeybee scout in Seeley's quorum-sensing swarm.
- Mental-abacus (anzan) arithmetic.
- Aymara spatial time, with the past in front.
- A medieval memory palace.

Guugu Yimithirr ran etak close: it would make you notice which way north is. But etak has a provable spine I could compute with real stars and real islands, and a felt part that travels: on any train, a middle-distance farm sliding backward against a far ridge *is* an etak island. Nobody needs a canoe to try it.

What hooked me was a check: if I put the published coordinates of Puluwat, Pisaras and Chuuk and the catalogued positions of the stars into a sphere, does the reference island really lie under rising Vega from Puluwat and under setting Vega from Chuuk, as the record says? It does, 6.0° and 2.5° from those points and nearer them than any other, with nothing tuned. The star points it passes in between then follow from the compass itself, in the recorded order; they are not a second test. That is the part that can be proven. The part that can only be felt is a moment I hope arrives somewhere in the dark exercise: when you stop asking where the canoe is and start asking where the island has got to.

## How it works

**The borrowed way of thinking.** Etak, as described by Gladwin (1970), Riesenberg (1975), Hutchins (1983, 1995) and Hutchins & Hinton (1984): the navigator holds the canoe still and treats the voyage as the passage of a reference island under successive points of a star compass. The compass (Goodenough 1953) names directions by where stars rise and set: Altair's rising is east, Polaris north, the Southern Cross in five positions in the south, 32 points in all, unevenly spaced where the stars physically rise. The voyage (Goodenough & Thomas 1987; the Penn Museum's "Keeping Track" page) has Pisaras under rising Vega from Puluwat and under setting Vega from Chuuk, "dragged" through the risings of Vega, Cassiopeia, the main star of the Great Bear, Kochab and Polaris and on to setting Vega.

**What the interaction makes you do.** Section 2 makes you watch one set of numbers in two frames. Section 3 is the core: with no islands drawn, you must integrate time and speed into an angle on an unseen island, eight times. Section 4 makes you discover that the reference is two bearings, not land. Section 5 turns the same frame into a skill you can use (reading a steady bearing as a meeting).

**The model (`etak.js`, pure, loaded by the page and by Node).**
- Rising azimuth on a geometric horizon: cos A = sin δ / cos φ; setting at 360° − A. J2000 positions of sixteen stars: the Hipparcos-derived HYG v4.1 values, copied from McDonald's repository. Latitude 7.39° N, the middle of the track. The two "leaning" Southern Cross points are where Acrux stands when the Gacrux–Acrux axis leans 45° from the vertical (the Weriyeng compass's definition), found by bisection. They are not mirror images of each other: the cross's axis is not exactly north–south on the sky, so the pair misses by 4.0°.
- Sphere of mean radius 6371.0088 km; initial great-circle bearings; haversine distances; slerp along the track. Island positions from published coordinates (Poluwat 7°21′26″N 149°12′01″E; Pisaras/Piherarh 8°34′11″N 150°25′09″E; Chuuk Lagoon 7°24′54″N 151°44′06″E).
- Etak: the reference island's bearing is followed along the track (unwrapped) and cut wherever it reaches the azimuth of a compass point; the first segment is named by the point nearest the island at departure. Because the true geometry puts Pisaras 6.0° past rising Vega at the start and 2.5° short of setting Vega at the end, the first and last etak are drawn partial. A point off to one side of a straight track turns one way only, and the compass points are in order round the horizon, so once the two ends are fixed the points in between, and the count of eight gaps from rising to setting Vega, follow.
- The canoe frame: every position minus the canoe's, turned by the course. Its inverse is tested.
- Inverse etak for the game: a bearing on the island is converted to the fraction of the voyage at which the island would have that bearing.
- Relative motion: closest approach and bearing rate for straight-line encounters.

**What is simplified.** No current, leeway or tacking; the canoe sails the great circle. Speeds in the dark exercise are invented (roughly 3 to 7 knots). No refraction in the star azimuths. All 32 points are in the published compass (Goodenough 1953, seen through search extracts). The local names and spellings, the east-up layout and the 45° definition of the leaning Cross come from the Weriyeng list in Kyle McDonald's `polowat-star-compass`, transcribed from a Weriyeng shirt with Polowat spellings corrected under the supervision of Mario Benito of Polowat. I read that repository directly (as data). The ring places each point where its star physically rises; the Weriyeng compass, as McDonald renders it from the shirt, is an even ring of named directions, 11.25° apart.

**Sources.** Every citation on the page links to its entry in the Sources list and has a record in `sources.json` saying what it is cited for, how it was found and how far I could check it. I could not read most of the books and articles in full from this sandbox; I worked from publisher and catalogue records, abstracts and search extracts of the PDFs, and the page paraphrases rather than quotes except where a quotation appeared in an extract (Riesenberg's "about fifty or so miles", COLREGs' wording).

**Verification.** `etak.test.mjs` (21 tests, run by `tools/check.mjs`) checks the model against code that does not call it:
- star declinations against catalogued Hipparcos values typed in by hand (all within 0.1″);
- the rising-azimuth formula against a sky turned about the pole until each star touches the horizon (1e-6°), at five latitudes;
- the compass's mirror symmetry and order;
- the leaning-Cross points against an independent position-angle calculation (0.01°); that they miss being mirror images by about 4°, and become exact mirrors if Gacrux is given Acrux's right ascension; that the ring readout says so; and the Weriyeng names of the three Cross points;
- bearings and distances against 3-D vector geometry (1e-9) and against Vincenty's inverse on the WGS84 ellipsoid (bearings within 0.25°, distances within 0.6%);
- the two end bearings: Pisaras nearest rising Vega from Puluwat (3.0° to spare) and nearest setting Vega from Chuuk;
- that the star sequence in between is forced: for random reference islands with the same two ends, followed by brute force, the seven points in between always come in the recorded order, while the etak count (8, 9 or 10) depends on where the ends fall;
- every etak boundary against brute-force sampling at 40,000 steps;
- the inverse (bearing to position) round trip;
- the canoe-frame round trip (worst error about 5×10⁻⁹ m, so "within a metre" on the page is conservative);
- the closest approach of Pisaras against the cross-track distance formula, and the sighting range with and without refraction;
- the claims in section 4 (nearer reference, more etak; one dead ahead barely moves);
- the invented speed histories (close the voyage exactly, speeds 2.9–7.3 knots);
- closest approach and bearing rate against step-by-step simulation for 300 random encounters, and the constant-bearing cases that never meet (no relative motion; a vessel moving away);
- all 35 numbers tagged `data-claim` in the page against the model, at the precision printed;
- every citation against `sources.json` and the Sources list, both ways;
- that the corrections from the independent review stay in the page and this README.

`node tools/smoke.mjs ideas/52-still-canoe` passes at desktop and phone. I also drove every control in Playwright at 390 px with touch and at 1280 px, in light and dark schemes, with and without `prefers-reduced-motion`: tapping the ring, scrubbing and sailing the voyage, playing all eight stretches of the dark exercise to landfall, dragging the reference island by touch, and calling a constant-bearing encounter. No console errors and no horizontal overflow.

## Honest assessment

What works:
- [Certain] The geometry is right: star azimuths, bearings, distances, the frame change and the etak cuts all agree with independent calculations, and every number in the prose is machine-checked.
- [Certain] From published coordinates and catalogued star positions, Pisaras lies nearest rising Vega from Puluwat (6.0° off, with 3.0° to spare before rising Schedar would be nearer) and nearest setting Vega from Chuuk (2.5° off), as Goodenough and Thomas record, with nothing adjusted. That is what the geometry confirms.
- [Certain] It also passes rising Schedar, rising Dubhe, rising Kochab, Polaris, setting Kochab, setting Dubhe and setting Schedar in between, the recorded sequence, but that is not a second confirmation: given the two ends, the compass's own order forces it. Likewise eight etak is the number of gaps between points from rising to setting Vega, with the first and last counted as partial; one search summary of the Penn page also reported eight segments, but I did not see the figure itself.
- [Certain] Pisaras never comes nearer than 71 nautical miles to the track, several times the distance at which even a tall-palmed atoll clears the horizon.
- [Likely] The dark exercise is the part that does what the brief asks. Having to put an unseen island somewhere, again and again, is a different act from watching it slide. Whether eight stretches is enough to feel the frame shift I do not know.
- [Likely] The two-picture view makes Hutchins's point (both frames are the same numbers) without a paragraph.

What's rough or uncertain:
- [Certain] No human has tried this page. Everything about how it feels is my guess.
- [Certain] It is an outsider's model built from outsiders' accounts. It is not how Carolinian navigators teach, and it leaves out most of what they use: swells, birds, clouds, current, the sea marks of each route, and the whole system of island-to-island star bearings Riesenberg (1972) describes.
- [Certain] Truk/Chuuk "under rising Altair": the record says so, but by geodesy the lagoon centre bears 88.5° and Altair rises at 81.1° at this latitude. On this ring that is a two-point disagreement: the lagoon is nearer rising Orion's Belt (2.7°) than rising Altair (7.5°), with rising Alshain between, and a course held on Altair's rising would pass about 20 nm north of the lagoon's centre, near its northern edge. On an even 32-point ring it is 1.5° from east. The page says plainly that I do not know how navigators reconcile the two.
- [Likely] All 32 points are standard in the published Carolinian compass: search extracts of Goodenough (1953) list the rising points through the Pleiades, Aldebaran, the three Aquila stars and Orion's Belt, and his plates show the Southern Cross in five positions. I could not read his table or Halpern's in full. The local names and spellings rest on one transcription (a Weriyeng-school shirt), and so does the placing of the two leaning Southern Cross points: the Weriyeng compass's own definition (Acrux when the cross leans 45°), which I adopt and could not check against how navigators judge the lean.
- [Likely] Most citations rest on abstracts, catalogue records and search extracts rather than full texts; `sources.json` says which. Three details are only as good as one or two search extracts and should be checked first: Holton et al.'s wording on how the compass is laid out (I moved the east-up attribution to the Weriyeng compass for that reason), Gunn's report that Gaferut was the etak island on Lewis's Saipan–Pikelot leg, and Gladwin's framing of etak as a way of organising information.
- [Speculative] Gunn's reading of ghost islands as filling navigational gaps is his interpretation; the page labels it so.
- The constant-bearing section is my bridge, not the navigators'. Carolinian navigators surely judge meeting canoes, but I found nothing recording how, so the page ties the rule to COLREGs and to Hutchins, not to them.
- `prefers-reduced-motion`: *Sail* jumps one etak per press instead of animating, and the constant-bearing game shows the other canoe's track as dots instead of moving it. Nothing else animates.

## Where it could go next

- **A second voyage with a phantom reference**, if a route that is recorded as reckoned against a ghost island could be found in Riesenberg's tables.
- **Tacking.** A zig-zag course upwind would make the island step back and forth along the ring. How navigators keep etak while tacking is something I could not research from here.
- **Current.** Let a current set the canoe off its track and show what the reference island's bearing reveals, the navigator's real problem.
- **Precession.** A slider of centuries would show the compass slowly turning (a star's rising point drifts with precession), a provable fact with a long-history question attached.
- **Review by a navigator.** The page's most important missing check is someone from the tradition reading it.

## Revision note

An independent reviewer rebuilt the geometry in separate code. It reproduced every number on the page, and found that the page claimed more than it had proven in places. The changes:

- **The star sequence was presented as an independent confirmation, and it is not one.** Seen from a straight track, a point off to one side turns one way only, so once Pisaras starts nearest rising Vega and ends nearest setting Vega, the seven points in between must come in the recorded order. The page now says that only the two ends are tested (6.0° and 2.5° off, with 3.0° to spare at the start). It also says the eight etak are the gaps from rising to setting Vega. A new test sails 37 random reference islands with the same two ends: all pass the same seven points, and their etak counts vary from 8 to 10.
- **Hollow "one source" ticks under-rated well-documented points.** The Pleiades, Aldebaran, Tarazed, Alshain, Orion's Belt and the leaning Cross are standard in the published compass, including Goodenough 1953, which the page already cited. The ticks no longer encode source counts. Only the two leaning-Cross points are hollow, because they are placed by a definition rather than by a star.
- **The Chuuk/Altair gap was understated.** On this ring the lagoon's centre is nearer rising Orion's Belt (2.7°) than rising Altair (7.5°). A course held on Altair's rising passes about 20 nm north of the lagoon's centre. On an even ring the lagoon is 1.5° from east. Section 5 no longer says the destination "sits on the same star": its bearing stays fixed to within 0.3° but falls between two points.
- **Smaller fixes:**
  - The ring readout no longer calls the leaning-Cross pair "the same angle from north"; they miss by 4.0°.
  - The 45° lean is credited to the Weriyeng compass, not to me.
  - The three Cross points carry their own Weriyeng names: Maechmeh, Wenewenenubw and Maechemelotou, not Ubw.
  - The star positions are credited to HYG v4.1, as copied from McDonald's repository, not to SIMBAD. No number changes.
  - The constant-bearing proof now says "approaching vessel", because zero or receding relative motion also holds a bearing steady.
  - Section 1 now says that the physical-azimuth ring is an astronomical rendering; the Weriyeng compass draws its points evenly.
  - `preview.jpg` is re-captured in the same framing, because the hollow ticks changed.
