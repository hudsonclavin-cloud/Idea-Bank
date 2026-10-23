# The Still Canoe
> Sail from Puluwat to Chuuk the way Carolinian navigators reckon it: the canoe stays put, the stars stay put, and an island you never see slides backward under them until you arrive.

**Kind:** explorable
**Run:** open `ideas/52-still-canoe/index.html` in a browser (plain classic scripts; works from `file://` or any static server; no network, nothing stored). Checks, from the repo root: `node --test ideas/52-still-canoe/etak.test.mjs` and `node tools/check.mjs ideas/52-still-canoe`.
**Made by:** Bearing Drift

## What it is

A single-page explorable that lets you use etak, the way of reckoning a voyage that Thomas Gladwin learned on Puluwat from the navigator Hipour and that Edwin Hutchins later analysed as a computation. In etak the canoe is held still; the stars are a fixed ring of rising and setting points around it; the islands move. A reference island, off to one side and below the horizon, slides backward from one star point to the next, and each step is one etak, one stage of the voyage.

The page runs one real, documented crossing: Puluwat to Chuuk Lagoon (Truk), about 151 nautical miles, with Pisaras as the reference island, as Goodenough and Thomas recorded it for the Penn Museum. Seven sections:

1. **The ring that does not move.** The 32-point Carolinian star compass, each point drawn where its star actually rises or sets at Puluwat's latitude, east at the top. Tap a point to light up its mirror partner. Points two sources agree on are solid, points from one source hollow.
2. **One voyage, two pictures.** A north-up chart (canoe moves) and the canoe's own view (bow up, stars fixed, islands sliding) driven by one slider, *Sail* button or a sideways drag. A strip cuts the crossing into its eight etak; a curve of Pisaras's bearing against miles sailed shows why the etak are uneven.
3. **Sail it in the dark.** The islands vanish. You are given eight stretches of sailing (hours and an invented speed) and after each you tap the ring where you believe Pisaras now lies. The page shows the truth, your error in degrees, and what your bearing would mean as a position on the track.
4. **The island does not have to be there.** Drag the reference island anywhere: the two star bearings from Puluwat and Chuuk are drawn, the voyage is re-cut, and the readout says how many etak result and whether the island would ever be seen. Text on Riesenberg's ghost islands and Gunn's reading of them.
5. **What does not slide.** In the canoe's frame the destination never moves against the stars, and neither does anything else on a collision course. A small game: watch another canoe against the star ring for a few seconds and call whether it meets you, crosses ahead or passes astern. Tied to COLREGs Rule 7 and to Hutchins's point that a relative-motion frame is sometimes the better one.
6. **What this page simplifies, and what is argued.**
7. **Take it with you.** Four steps for the next time you sit by a window on a train or bus.

`preview.jpg` (960×600, 31 KB) is the two-picture view mid-voyage in the dark scheme.

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

What hooked me was a check I could not predict: if I put the published coordinates of Puluwat, Pisaras and Chuuk and the catalogued positions of five stars into a sphere, does the reference island really pass under the star points the record lists, in that order? It does. Nothing was tuned. That is the part that can be proven. The part that can only be felt is a moment I hope arrives somewhere in the dark exercise: when you stop asking where the canoe is and start asking where the island has got to.

## How it works

**The borrowed way of thinking.** Etak, as described by Gladwin (1970), Riesenberg (1975), Hutchins (1983, 1995) and Hutchins & Hinton (1984): the navigator holds the canoe still and treats the voyage as the passage of a reference island under successive points of a star compass. The compass (Goodenough 1953) names directions by where stars rise and set: Altair's rising is east, Polaris north, the Southern Cross in five positions in the south, 32 points in all, unevenly spaced. The voyage (Goodenough & Thomas 1987; the Penn Museum's "Keeping Track" page) has Pisaras under rising Vega from Puluwat and under setting Vega from Chuuk, "dragged" through the risings of Vega, Cassiopeia, the main star of the Great Bear, Kochab and Polaris and on to setting Vega.

**What the interaction makes you do.** Section 2 makes you watch one set of numbers in two frames. Section 3 is the core: with no islands drawn, you must integrate time and speed into an angle on an unseen island, eight times. Section 4 makes you discover that the reference is two bearings, not land. Section 5 turns the same frame into a skill you can use (reading a steady bearing as a meeting).

**The model (`etak.js`, pure, loaded by the page and by Node).**
- Rising azimuth on a geometric horizon: cos A = sin δ / cos φ; setting at 360° − A. J2000 positions of sixteen stars (SIMBAD/Hipparcos). Latitude 7.39° N, the middle of the track. The two "leaning" Southern Cross points are where Acrux stands when the Gacrux–Acrux axis leans 45° from the vertical, found by bisection.
- Sphere of mean radius 6371.0088 km; initial great-circle bearings; haversine distances; slerp along the track. Island positions from published coordinates (Poluwat 7°21′26″N 149°12′01″E; Pisaras/Piherarh 8°34′11″N 150°25′09″E; Chuuk Lagoon 7°24′54″N 151°44′06″E).
- Etak: the reference island's bearing is followed along the track (unwrapped) and cut wherever it reaches the azimuth of a compass point; the first segment is named by the point nearest the island at departure. Because the true geometry puts Pisaras 6° past rising Vega at the start and 2° short of setting Vega at the end, the first and last etak are drawn partial.
- The canoe frame: every position minus the canoe's, turned by the course. Its inverse is tested.
- Inverse etak for the game: a bearing on the island is converted to the fraction of the voyage at which the island would have that bearing.
- Relative motion: closest approach and bearing rate for straight-line encounters.

**What is simplified.** No current, leeway or tacking; the canoe sails the great circle. Speeds in the dark exercise are invented (roughly 3 to 7 knots). No refraction in the star azimuths. The compass points other than the voyage's own nine (five stars) and all local star names come from one source: the Weriyeng list in Kyle McDonald's `polowat-star-compass`, transcribed from a Weriyeng shirt with Polowat spellings corrected under the supervision of Mario Benito of Polowat. I read that repository directly (as data). The page marks those points hollow.

**Sources.** Every citation on the page links to its entry in the Sources list and has a record in `sources.json` saying what it is cited for, how it was found and how far I could check it. I could not read most of the books and articles in full from this sandbox; I worked from publisher and catalogue records, abstracts and search extracts of the PDFs, and the page paraphrases rather than quotes except where a quotation appeared in an extract (Riesenberg's "about fifty or so miles", COLREGs' wording).

**Verification.** `etak.test.mjs` (17 tests, run by `tools/check.mjs`) checks the model against code that does not call it:
- star declinations against SIMBAD values typed in sexagesimal (all within 1″);
- the rising-azimuth formula against a sky turned about the pole until each star touches the horizon (1e-6°), at five latitudes;
- the compass's mirror symmetry and order;
- the leaning-Cross points against an independent position-angle calculation (0.01°);
- bearings and distances against 3-D vector geometry (1e-9) and against Vincenty's inverse on the WGS84 ellipsoid (bearings within 0.25°, distances within 0.6%);
- the published star sequence for the voyage, eight etak, start under rising Vega and end under setting Vega;
- every etak boundary against brute-force sampling at 40,000 steps;
- the inverse (bearing to position) round trip;
- the canoe-frame round trip (worst error about 5×10⁻⁹ m, so "within a metre" on the page is conservative);
- the closest approach of Pisaras against the cross-track distance formula, and the sighting range with and without refraction;
- the claims in section 4 (nearer reference, more etak; one dead ahead barely moves);
- the invented speed histories (close the voyage exactly, speeds 2.9–7.3 knots);
- closest approach and bearing rate against step-by-step simulation for 300 random encounters;
- all 26 numbers tagged `data-claim` in the page against the model, at the precision printed;
- every citation against `sources.json` and the Sources list, both ways.

`node tools/smoke.mjs ideas/52-still-canoe` passes at desktop and phone. I also drove every control in Playwright at 390 px with touch and at 1280 px, in light and dark schemes, with and without `prefers-reduced-motion`: tapping the ring, scrubbing and sailing the voyage, playing all eight stretches of the dark exercise to landfall, dragging the reference island by touch, and calling a constant-bearing encounter. No console errors and no horizontal overflow.

## Honest assessment

What works:
- [Certain] The geometry is right: star azimuths, bearings, distances, the frame change and the etak cuts all agree with independent calculations, and every number in the prose is machine-checked.
- [Certain] From published coordinates and catalogued star positions, Pisaras passes rising Schedar, rising Dubhe, rising Kochab, Polaris, setting Kochab, setting Dubhe and setting Schedar between rising Vega and setting Vega: the sequence Goodenough and Thomas record, with nothing adjusted. One search summary of the Penn page also reported eight segments for this example; I did not see the figure itself, so I present eight as my geometry's count.
- [Certain] Pisaras never comes nearer than 71 nautical miles to the track, several times the distance at which even a tall-palmed atoll clears the horizon.
- [Likely] The dark exercise is the part that does what the brief asks. Having to put an unseen island somewhere, again and again, is a different act from watching it slide. Whether eight stretches is enough to feel the frame shift I do not know.
- [Likely] The two-picture view makes Hutchins's point (both frames are the same numbers) without a paragraph.

What's rough or uncertain:
- [Certain] No human has tried this page. Everything about how it feels is my guess.
- [Certain] It is an outsider's model built from outsiders' accounts. It is not how Carolinian navigators teach, and it leaves out most of what they use: swells, birds, clouds, current, the sea marks of each route, and the whole system of island-to-island star bearings Riesenberg (1972) describes.
- [Likely] Truk/Chuuk "under rising Altair": the record says so, but by geodesy the lagoon centre bears 88.5° and Altair rises at 81.1° at this latitude. The page says plainly that I do not know how navigators reconcile the two.
- [Likely] Some compass points and all local names rest on one source (a transcription of a Weriyeng-school shirt). Halpern's table, which I could see only as garbled OCR, agrees with it wherever it is legible, except for the Pleiades and Orion's Belt, which two extracts placed inconsistently (those are drawn hollow). The leaning Southern Cross points use my own definition of the lean.
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
