# Kirkwood's Ruler
> A printable ruler of the asteroid belt, made from the orbits of 1,576,490 real asteroids. Its top edge drops into four notches. Kepler's law, given nothing but the length of Jupiter's year, says where they are. No picture of the sky shows them: they are gaps in the sizes of orbits, not in space.

**Kind:** printable object
**Run:** open `ideas/72-kirkwood-ruler/index.html` in a browser (classic scripts, works from `file://`, no network). Choose a population and a stretch of the belt, then *Download STL*. `default.stl` is the default ruler, ready to slice. Settings can also come from the URL: `?pop=big&a0=2&a1=3.5&bin=0.01&scale=sqrt&count=a&length=160&relief=22&depth=14&ledge=1`. Tests: `node --test ideas/72-kirkwood-ruler/belt.test.mjs` from the repo root.
**Made by:** Notchwright

## What it is

A bar 166 mm long with a scale of 100 mm to the astronomical unit (au, the Earth's distance from the Sun), so 1 mm on it is 0.01 au, about 1.5 million km. It spans 1.8 to 3.4 au: the Hungaria group and the main asteroid belt. Its top edge is a histogram: one 1 mm bar for every 0.01 au of orbit size, as tall as the number of known asteroids whose orbits are that size. The tallest bar, 2.64 to 2.65 au, stands for 23,653 asteroids, and in this default the height is proportional to the count, so every cubic millimetre of the relief stands for about 77 asteroids.

In front of the bars runs a two-step ledge. The lower step is a ruler: a bump every 0.1 au, taller at 2.5 and taller still at 2.0 and 3.0. The upper step has a groove at each orbit size where an asteroid would go round the Sun a whole number of times for a whole number of Jupiter's years: 3 for 1 at 2.501 au, 5 for 2 at 2.824 au, 7 for 3 at 2.957 au and 2 for 1 at 3.277 au. Above each groove, the bars drop into a notch. Those are the Kirkwood gaps. The idea is that you find them by running a fingernail along the top, and that each time it drops, a finger of the other hand, on the ledge below, is in a groove. (Nobody has tried that yet: see the honest assessment.)

The page lets you choose what to print within the data:

- **Which asteroids:** every known asteroid (1,576,490), only those with the best-determined orbits (1,141,495), only the larger ones with absolute magnitude H below 15 (84,216), the first 1,000 numbered, or the 91 found by the end of 1866, when Kirkwood saw the gaps.
- **Count each asteroid by** the size of its orbit (the ruler), or by where it is, averaged over its year. The second makes a smooth hill with no notches at all, from the same asteroids. Printing the pair is the point of the page (see *Why I made it*).
- **Which stretch:** anywhere from 1.5 to 5.5 au, from a 0.1 au close-up of one gap to Mars-to-Jupiter, with bins from 0.0025 au, never narrower than 1 mm on the object.
- **Bar height** proportional to the count, its square root, or its logarithm (the last two make the sparse outer belt, with its Hildas and Trojans, something you can feel).
- **The object:** length of the scale (50 to 170 mm), tallest bar (4 to 40 mm), depth (8 to 30 mm), with or without the ledge.

Seven presets cover the interesting cases. A 3D view (drag sideways, or arrow keys) shows the solid exactly as it will be downloaded; below it, the front silhouette can be read bar by bar by touch, mouse or keyboard. Two live tables say what the reader's fingernail will find: the asteroids at each groove compared with their neighbours, and what a notch finder that knows nothing about Jupiter finds in the same counts.

## Why I made it

The brief was a printable object whose shape *is* real space data, something no one could feel before it was printed. I sketched three candidates:

1. **Saturn's rings as a record:** a Cassini occultation profile spun into a disc, the Cassini Division a groove you could feel. The physics is lovely (the B ring's outer edge sits at a resonance with Mimas) but the data host was unreachable from here, and at a printable scale most of the ring structure is finer than a nozzle.
2. **A constellation in depth:** pins standing on a plate, one per star, heights from Hipparcos parallaxes. A familiar idea, and tall thin pins are poor prints.
3. **The asteroid belt by orbit size:** a histogram of real orbits, printed so a finger can run along it.

The third won on every count. The data is a catalogue anyone can query (JPL's Small-Body Database answered from here, all 1.58 million orbits), it reduces honestly to counts in bins, and the shape it makes is famous on paper; a short search found no printed or tactile version of it. It also has exactly the two halves this bank asks for.

**The part that can be proven.** Where the grooves go is pure arithmetic: Kepler's third law and the length of Jupiter's year, nothing fitted to asteroids. Where the notches are is pure data: 1.58 million orbits, counted. That the two agree can be checked, and the page checks it twice: once by measuring how empty the belt is at each groove, and once with a notch finder that is never told where the resonances are, which on the default ruler puts its four strongest notches 0.0009 to 0.0059 au from them.

**The part that can only be felt.** The Kirkwood gaps cannot be seen in a picture. They are not dark rings in the sky: an asteroid's distance from the Sun swings back and forth through the year (by 0.39 au either side of its orbit size, for the median main-belt asteroid), straight across the gap distances. A picture of the whole belt from far above would show each asteroid where it is, not where its orbit size says; counted by distance from the Sun and averaged over their orbits, the same catalogue makes a smooth hill. The gaps exist only in a list, as missing *orbit sizes*, which is to say missing *lengths of year*. That is why the page has the second count. Print the ruler and its twin, counted by where the asteroids are, and hold one in each hand: same asteroids, same scale, notches in one and not the other. What your fingernail finds is not a place that is empty but a rhythm that is: years that are a simple fraction of Jupiter's. I found that hard to believe even after computing it, and I made the pair so that it could be checked with two hands instead of a chart.

## How it works

**The data.** `reduce.mjs` reads six pages from the JPL Small-Body Database Query API (`sb-kind=a`, `full-prec=1`, fields `pdes, a, e, i, H, condition_code, epoch`), fetched on 23 October 2026, 1,576,490 asteroids, every row unique, the API's own count matched. 1,480,209 of the orbits osculate at JD 2461200.5 (9 June 2026); the rest at 6,368 other epochs. It keeps, for five populations, the number of asteroids whose osculating semi-major axis falls in each 0.0025 au bin from 1.5 to 5.5 au (98.4% of the catalogue; the rest are counted as below or above), and the time-averaged number at each heliocentric distance in the same bins (below). The result, `belt-data.js`, is 52 KB; it records the SHA-256 of every raw page. The raw pages (150 MB) are not bundled; the header of `reduce.mjs` gives the exact URLs. As a check on the reduction, `crosscheck.py` redoes it independently in Python and numpy from the same raw pages: run once, it reproduced every orbit-size count in all five populations exactly, and every distance count to within 0.05 of an asteroid (the rounding to tenths). The populations:

| Population | Rule | Count |
|---|---|---|
| all | every asteroid | 1,576,490 |
| good | orbit condition code 0 (the Minor Planet Center's U parameter, smallest uncertainty) | 1,141,495 |
| big | H < 15, roughly 3 to 6 km and up depending on albedo (D = 1329 km / √p × 10<sup>−H/5</sup>) | 84,216 |
| first1000 | numbered 1 to 1000 (discovered 1801 to 1927, per JPL's discovery dates) | 1,000 |
| by1866 | numbered 1 to 91: every one discovered by 4 November 1866; (92) was found in July 1867, and no asteroid numbered 92 to 1000 was found before 1867 | 91 |

**The second count.** An orbit with semi-major axis *a* and eccentricity *e* spends the fraction (*E* − *e* sin *E*)/π of its year within *r* = *a*(1 − *e* cos *E*) of the Sun (Kepler's equation). `reduce.mjs` spreads every asteroid over the bins between its perihelion and aphelion by that fraction, exactly, and stores the sums to a tenth of an asteroid. Five orbits with *e* ≥ 1 are left out. This is what a snapshot from above would show on average, counted by distance: the same asteroids, smoothed by their own ellipses.

**Kepler.** Jupiter's mean longitude advances 3034.74612775° per century (JPL's *Approximate Positions of the Planets*, Table 1, after Standish & Williams 1992), a sidereal year of 11.8626 years. An asteroid making *p* laps per *q* of Jupiter's has mean motion (*p*/*q*) *n*<sub>J</sub>, and Kepler's third law with the Gaussian constant (*GM*<sub>☉</sub> = *k*²) gives its semi-major axis. The tests check this against the other route, Jupiter's mean semi-major axis 5.20288700 au scaled by (*q*/*p*)<sup>2/3</sup> and corrected for Jupiter's mass (Sun/Jupiter 1047.3486): every resonance agrees within 0.0005 au.

| Resonance | Orbit size | Period | In the data |
|---|---|---|---|
| 3:1 | 2.501 au | 3.95 yr | Kirkwood gap |
| 5:2 | 2.824 au | 4.75 yr | Kirkwood gap |
| 7:3 | 2.957 au | 5.08 yr | Kirkwood gap (the shallowest) |
| 2:1 | 3.277 au | 5.93 yr | Kirkwood gap, the Hecuba gap |
| 3:2 | 3.969 au | 7.91 yr | the Hildas pile up |
| 1:1 | 5.201 au | 11.86 yr | the Trojans share Jupiter's orbit |

**Checking the data against Kepler.** Two measures, both computed live for whatever the reader chooses:

- *Emptiness at a groove:* the asteroids in the 0.005 au slice centred on the resonance, divided by what the belt 0.01 to 0.05 au away on both sides puts in a slice that wide. For every known asteroid: 3:1 holds 6%, 5:2 7%, 7:3 32%, 2:1 16%. For the larger ones (H < 15): 1%, 0%, 25% and 6%. At 3:2 the Hildas make it 189%. Counted by distance instead, all four are between 99.8% and 100.5%.
- *The blind notch finder* (`findNotches`): it slices the chosen stretch into 0.005 au bins. For each bin no fuller than its two neighbours it takes the mean count *B* of the 16 bins 0.015 to 0.05 au away (eight each side) and scores the bin by (*B* − *c*)/√*B*, how many standard deviations it falls below its surroundings if asteroids were scattered at random. It keeps the four highest scores, at least 0.05 au apart. Only then is each compared with a list of 20 resonances (every *p*:*q* with *p* ≤ 9 and order *p* − *q* ≤ 4, inside 1.5 to 5.5 au). On the default ruler it finds 2.8225 au (67 standard deviations, 93% below its surroundings), 2.5025 (66, 95%), 2.9575 (44, 68%) and 3.2825 au (21, 83%): the 5:2, 3:1, 7:3 and 2:1, 0.0012, 0.0020, 0.0009 and 0.0059 au away. It finds the same four from any stretch that contains them (1.5 to 5.5, 2.0 to 3.5, 2.1 to 3.3 au, tested), at 0.0025 au slices too, and in the best-determined orbits. In the larger asteroids it finds the 5:2, 3:1 and 7:3, then a notch at 3.0275 au (10 standard deviations) that is 0.07 au from anything on its list; it sits beside the 9:4 resonance, order 5, which the list leaves out. In the first 1,000 and the 1866 populations nothing scores above 3. Two controls in the tests: slide the catalogue 0.05 au outward and the notches move with it and stop matching (each more than 0.03 au off); give it a flat belt and it finds nothing. Counted by distance, it finds no notch at all in the full catalogue.
- *A change I made after looking.* My first finder ranked slices by fractional depth, 1 − *c*/*B*. On the full catalogue it found the same four, but in sparse populations every empty slice scores 100%, so it filled its list with chance gaps (and, in the larger asteroids, with the sparse inner edge of the belt). I switched to the standard-deviation score after seeing that. The page still shows the fractional depth beside each notch.

**The solid.** `belt.js` lays out the object as terraces running the length of the bar, front to back: the tick step (1.6 mm, with 1 mm-wide bumps to 2.2, 2.6 or 3.0 mm), the groove step (3.8 mm, with 1.2 mm grooves down to 3.0 mm), then the bars (a 4.6 mm base plus the relief). Each terrace is a run of flat-topped segments on a 0.01 mm grid. The mesher builds every top, every vertical wall between terraces and between segments, the four outer walls, a 0.5 mm-high, 0.4 mm-deep bottom chamfer and the flat bottom, zipping each face's two edges so that every vertex on a shared edge belongs to both faces. That closes up exactly as long as each terrace is at least as tall as the one in front of it at every point, which the layout guarantees and the mesher checks. Each triangle is wound to its face's outward normal. The STL writer is about twenty lines: an 80-byte header, a count, then 50 bytes per triangle.

Rules that keep it printable: bins are never narrower than 1 mm on the object (the page widens the bin and says so); minor and half-au ticks are left out when they would come closer than 3 mm; a groove that would come within 2.4 mm of another is left out, and the page names it; the whole thing is at most 176 × 38 × 44.6 mm. The page also counts *fins*, bars under 2 mm wide standing 8 mm or more above both neighbours, and warns when there are any. They appear wherever the counts are sparse: in the 1866 and first-1000 populations, and with fine bins in the thinly populated outer belt (19 of them between 4.4 and 4.9 au at 0.0025 au bins and 40 mm relief).

**The page.** `app.js` draws the mesh itself (orthographic, flat-shaded, back faces culled, painted far to near) and the front silhouette, and writes the tables from `belt.js`. Nothing animates; the view moves only while you drag or press a key, and the switches (presets, population, count, scale, ledge, viewpoints) redraw at most once every 350 ms, so a held key or fast taps cannot make the picture flicker faster than about three times a second. Light and dark schemes follow the system. Nothing is stored or sent.

## Printing it

| | |
|---|---|
| Material | PLA |
| Nozzle, layers | 0.4 mm, 0.2 mm (the slicer rounds bar heights to whole layers; thinner layers keep more of the small differences between neighbouring bars) |
| Perimeters, infill | 3 perimeters, 20% infill, 3 top and bottom layers |
| Orientation | as downloaded: flat base down, ledge towards you |
| Supports | none |
| Default ruler | 166 × 22 × 26.6 mm, 2,852 triangles, 33.96 cm³ solid |
| Print check | `python3 tools/printcheck.py` reports a closed, consistently wound solid on the bed, no overhang or thin-wall warning, walls p5 1.6 mm, and from PrusaSlicer **21.35 g of PLA and 1 h 44 min** (support adds 0.0%) |

Everything is vertical or flat apart from the bottom chamfer, which leans 38.7° from vertical, inside the 45° rule. There are no bridges, holes, fits or moving parts, so there is no calibration coupon to print first.

`sweep.mjs` builds 17 extremes of the controls (shortest, longest, flattest, tallest, thinnest, deepest; the whole belt; 0.0025 au bins at both ends of the data; the sparse 1866 and first-1000 populations; a sparse outer stretch full of fins; coarse bins; no ledge) and runs the same print check on all of them: all 17 pass with no warnings, from 56 × 8 × 8.6 mm (2.45 g, 15 min) to 176 × 38 × 44.6 mm (54.82 g, 3 h 48 min).

## Honest assessment

- **[Certain]** The object has not been physically printed. The parts most likely to need adjusting on a real printer: the 1 mm bars and the 1 mm slots of empty bins (an over-extruding printer may close a slot; a coarser bin or a longer scale widens both); the 0.6 mm tick bumps and 0.8 mm grooves, which are meant to be felt and may need to be deeper for some fingers; and, wherever the counts are sparse (the 1866 and first-1000 populations, or fine bins in the outer belt) at high relief, narrow fins that stand free and may wobble or snap during printing. The page warns about them; it does not prevent them.
- **[Certain]** Every solid the page can make that I tried is a closed, consistently wound solid with Euler characteristic 2 and the volume the layout predicts: the default, the 17 extremes, the 7 presets, 400 random settings and a corner sweep of 1,440 combinations of every population, scale and ledge setting at the ends of length, relief, depth, range and bin (tests). The 17 extremes (the default among them) also pass the repository's trimesh and PrusaSlicer check with no warnings; that check says nothing about whether a free-standing fin survives the nozzle. I have not tested every possible setting, and I make no claim beyond these.
- **[Certain]** `default.stl` is byte-identical to what the code produces, and its float32 coordinates still pair every edge.
- **[Certain]** The grooves are where Kepler's law puts the resonances, for Jupiter's mean motion; the bars are the bundled counts, checked bar by bar against the data.
- **[Certain]** On the default ruler, the four strongest notches the blind finder finds are within 0.0059 au of the 3:1, 5:2, 7:3 and 2:1 resonances, and the slices at those resonances hold 6% to 32% of what their neighbours would put there. This is a measurement on today's catalogue of osculating orbits, made with a finder whose scoring I changed after seeing results (above). Other choices give other lists: in the larger asteroids the fourth notch is not on the list of resonances at all, and the old depth score put the belt's sparse inner edge into the larger asteroids' top four.
- **[Certain]** Counted by distance from the Sun, averaged over their orbits, the same asteroids show no notch at the resonances (99.8% to 100.5% of their neighbours) and the finder finds none. That is a calculation from Kepler's equation over the catalogued orbits, not a photograph; it is what a snapshot would show on average.
- **[Likely]** The H < 15 population is less shaped by which faint asteroids happen to have been found than the full catalogue is. The full catalogue has 0.83 asteroids in the inner belt (2.1 to 2.5 au) for each one in the outer belt (2.83 to 3.27 au); the larger ones have 0.35. Faint asteroids are easier to find nearer the Sun, which I expect is much of that difference, but I have not modelled discovery completeness, and part of it may be real.
- **[Likely]** Proper (long-term averaged) semi-major axes would show the gaps sharper than these osculating ones; Gallardo (2018) shows both kinds of histogram, but I read his review in extracts, and I did not compute proper elements.
- **[Likely]** Kirkwood announced the gaps, and Jupiter as their cause, in 1866. In his 1888 book *The Asteroids* he wrote that when the law was first stated in 1866 only ten asteroids had been found beyond 3 au. With today's orbits I count 13 of the 88 asteroids discovered before July 1866 (from the raw pages) and 14 of the 91 found by the year's end (from the bundled counts) beyond 3.0 au. I do not know which list or orbits he used, and I read his book only through search extracts.
- **[Speculative]** That holding the two rulers, by orbit size and by distance, makes the point that the gaps are in time and not in space land better than a chart does. That is the bet of the whole piece, and no one has held them yet.
- **Rough edges.** The 3D preview sorts triangles by depth, which can show small errors where a long ledge face meets a bar; the STL is not affected. There is no Braille or embossed lettering: the scale is read by counting ticks from the ends, which the page's profile labels. The resonance list in the finder stops at order 4 and *p* ≤ 9, a choice I made to keep the list short; other resonances are real and not marked (the 8:3 at 2.705 au is a visible dip at fine resolution, and the 9:4 at 3.029 au is where the larger asteroids' fourth notch sits).

## Tests

`node --test ideas/72-kirkwood-ruler/belt.test.mjs` runs `belt.test.mjs` (18 tests, Node built-ins only):

- **Data:** every population adds up to its total and nests inside the full catalogue bin by bin; the reduction's bin edges and population rules on hand-made rows; the time-averaged distance spread against brute-force sampling of Kepler's equation.
- **Kepler:** each resonance's period is exactly *p*/*q* of Jupiter's; the second route through Jupiter's semi-major axis and mass agrees within 0.0005 au.
- **Data against Kepler:** the blind finder's four notches on the default ruler and the two controls (shifted catalogue, flat belt); its results for the other populations, as quoted above; the emptiness figures, as quoted; the count by distance shows no notch.
- **The solid:** the default (size, triangle count, volume); bars against counts for all three scales; linear relief volume times asteroids per mm³ gives back the count within 0.2%; tick and groove positions and spacing over 300 random ranges; closure, Euler characteristic, volume, no zero-area triangles, bed contact and fit for the 17 extremes, the 7 presets, 400 random settings and the 1,440-setting corner sweep; input cleaning.
- **The file:** `default.stl` regenerated and compared byte for byte; its float32 edges pair up.
- **Not in the suite:** `crosscheck.py` (needs the raw pages and numpy; result above) and `sweep.mjs` (needs trimesh and PrusaSlicer; result under *Printing it*).
- **The words:** the figures quoted in this README and on the page (finder results, emptiness, swing, 1866 bars, print estimate) and the page's viewport tag.

`node tools/check.mjs ideas/72-kirkwood-ruler` runs these, the print check and the headless smoke test at 1280 px and 390 px. `node ideas/72-kirkwood-ruler/sweep.mjs` runs the print check on the 17 extremes (a few minutes; needs trimesh and PrusaSlicer).

## Where it could go next

- **Print it**, and find out whether a fingernail really does find all four notches, and whether the 7:3, the shallowest, is felt or only seen.
- **A finer print.** The page can already make 2.1 to 3.3 au at 168 mm with 0.0075 au bins (1.05 mm), where the 8:3 dip at 2.705 au shows in the profile. Whether a printer and a fingertip resolve it is untested.
- **Proper elements** from the asteroid families literature, as a sixth population, to see how much sharper the gaps get.
- **Braille labels** on the ledge for the whole-au ticks and the resonances, checked with someone who reads Braille.
- **Saturn's rings**, the candidate I put aside: the same idea, with the outer edge of the B ring at a resonance with Mimas.

## Sources

- NASA/JPL Solar System Dynamics, *SBDB Query API* (ssd-api.jpl.nasa.gov/doc/sbdb_query.html) and the single-object *SBDB API* for discovery dates; field definitions from the API's own `info=field` listing (condition code = MPC "U" parameter).
- JPL Solar System Dynamics, *Approximate Positions of the Planets* (ssd.jpl.nasa.gov/planets/approx_pos.html), "from an article written by E. M. Standish and J. G. Williams in 1992": Table 1, Jupiter, *a* = 5.20288700 au, mean longitude rate 3034.74612775°/century, valid 1800 to 2050. Read directly.
- Minor Planet Center, *Uncertainty parameter U* (docs.minorplanetcenter.net), for the 0 to 9 scale.
- J. Wisdom (1983), "Chaotic behavior and the origin of the 3/1 Kirkwood gap", *Icarus* 56, 51 (volume and first page from citation listings); J. Wisdom (1985), "Meteorites may follow a chaotic route to Earth", *Nature* 315, 731–733. I read abstracts and secondary accounts (which describe eccentricity surges to about 0.35, enough to cross Mars's orbit), not the full papers.
- D. Kirkwood (1888), *The Asteroids, or Minor Planets Between Mars and Jupiter* (Lippincott), via search extracts of the Project Gutenberg text; the 1866 date also from the Wikipedia article *Kirkwood gap*, via search extracts.
- T. Gallardo (2018), "Resonances in the asteroid and trans-Neptunian belts: a brief review", *Planetary and Space Science* 157, 96–103 (arXiv:1803.06245), via extracts.
- JPL's main-belt histogram (ssd.jpl.nasa.gov/diagrams/mb_hist.html), which labels the same four gaps (3:1, 5:2, 7:3, 2:1).
- The diameter formula D = 1329 km × 10<sup>−H/5</sup>/√p appears in many sources (e.g. Harris & Lagerros 2002); I use it only to describe H < 15 in words.
