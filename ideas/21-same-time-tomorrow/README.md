# Same Time Tomorrow
> Catch the Sun at the same clock time every day for a year and it draws a figure-8 on the sky. Bend the orbit, retilt the planet, and find out why the earliest sunset comes before the shortest day.

**Kind:** explorable
**Run:** open `index.html` in a browser (plain classic scripts, so it works straight from `file://` or any static server; no build, no network). Tests: `node --test ideas/21-same-time-tomorrow/*.test.mjs` from the repo root (Node 18+; `page.test.mjs` also needs Playwright and skips itself without it).
**Made by:** Gnomon

## What it is

An instrument for one small, strange fact about the sky as seen from the ground: if you note where the Sun is at the same clock time every day for a year, the positions trace a lopsided figure-8, the *analemma*. The page is four linked figures, all computed live from one small model:

1. **A year of the same minute.** A picture of the sky from your latitude at a clock time you choose: one disc per day of the current year, drawn at the Sun's true angular size (0.53°), with hollow discs for days when the Sun hasn't risen yet at that minute. Press *Expose the year* and the figure develops day by day, like the multi-exposure photographs; or drag across the picture to visit a date and read the Sun's altitude, azimuth and what a sundial would say. The picture is a level rectilinear camera aimed at the figure's centre (a gnomonic projection, which is what a photograph is), so it keeps a photograph's proportions, handles the Sun passing near the zenith at the equator, and keeps the horizon a straight line.
2. **Two reasons, one figure.** The equation of time through the year, split into its two causes (tilt alone, dashed blue; eccentric orbit alone, dashed orange; both, solid), the Sun's declination, and the figure's own shape (equation of time against declination, plotted so that 4 minutes of time = 1° of hour angle, the true shape). Sliders for eccentricity, axial tilt and perihelion date reshape everything on the page; presets for Earth, a circular Earth, an untilted Earth, Mars, Saturn and Jupiter. The readout says whether the figure is a figure-8 or a single loop, and how far a sundial runs fast and slow.
3. **The lopsided solstice.** Sunrise, solar noon and sunset for your latitude across the year, with the earliest sunset, latest sunrise, shortest day and their June counterparts marked, plus a plain-language verdict: at 40°N the shortest day is 21 December, but the earliest sunset is 7 December and the latest sunrise 4 January.
4. **Your noon.** Pick a date; with the longitude, UTC offset and latitude set in section 1, it shows when the Sun is actually highest where you stand, what a sundial reads when your clock says 12:00, and sunrise and sunset.

Everything is clock time in a fixed zone all year, with no daylight-saving jump, which is how the photographs are taken.

## Why I made it

I listed the usual first ideas and crossed them off: an orrery, a star map, a Moon-phase widget, a scale-of-the-universe scroll, retrograde-motion-by-dragging (every astronomy site has one), a parallax ruler, an eclipse-coincidence slider (the Moon's recession history is too poorly constrained to put hard dates on), the Moon at its true size on your screen (needs a screen DPI the browser won't tell me). What stayed was a fact I've known for years and never *seen*: the Sun is never in the same place at the same time twice, and the shape it leaves is a slightly drunk 8.

What hooked me is that the figure is two ideas drawn on top of each other. Its height is the seasons: the tilt. Its width is the equation of time: the Sun running fast and slow against a clock that insists on a perfectly even day. And the width has two separate causes, the ellipse and (less obviously) the tilt again, because even motion along the ecliptic is uneven when projected on the equator. Switch either off with a slider and the figure changes shape in a way you can predict once you've seen it. Give Earth Mars's orbit and the small loop vanishes into a teardrop; give it Jupiter's 3° tilt and there is no crossing at all.

The payoff is something many people in the northern mid-latitudes feel every December without knowing why: the evenings start drawing out a week or two *before* the shortest day (two weeks at the latitude of New York or Madrid, nine days in London), while the mornings keep getting darker for a week or two after it, into January at New York's latitude. That is not folklore; the page computes it and the tests check it against the U.S. Naval Observatory. The first person to photograph the whole figure in the sky was Dennis di Cicco, over 1978–79, in a year-long multiple exposure described in *Sky & Telescope* in 1979; for decades afterwards the saying went that more people had walked on the Moon than had photographed one.

## How it works

**Model** (`sun.js`, pure, DOM-free, shared by the page and the tests). A planet on a fixed Kepler ellipse with eccentricity *e*, spin axis tilted by the obliquity ε, and the Sun's apparent ecliptic longitude at perihelion *peri*. For a mean longitude *L* (0° at the March equinox, advancing uniformly):

- mean anomaly M = L − peri; Kepler's equation E − e sin E = M by Newton's method (residual < 1e-15);
- true anomaly ν = 2 atan2(√(1+e) sin E/2, √(1−e) cos E/2); equation of centre C = ν − M;
- apparent longitude λ = L + C + aberration; right ascension α = atan2(cos ε sin λ, cos λ); declination δ = asin(sin ε sin λ);
- equation of time EoT = (L + aberration) − α, in degrees; × 4 gives minutes. Sign: EoT > 0 means a sundial reads *ahead* of the clock (early November, about +16 min).

**Earth's constants** (J2000, Meeus, *Astronomical Algorithms*, ch. 22 and 25, with linear drift in T = Julian centuries from J2000.0): L = 280.46646° + 36000.76983°·T (+ 0.0003032°·T²); e = 0.016708634 − 0.000042037·T; ε = 23.4392911° − 0.0130042°·T; peri = L − M = 282.93735° + 1.71954°·T, so perihelion falls on 3 January in 2026. Aberration −0.00569° (−20.5″) is applied to λ, as Meeus does for the apparent Sun. Mean solar time is taken as UTC (UT1 − UTC < 0.9 s). Dates convert to days since J2000 with Meeus's Julian-day algorithm.

**Other worlds.** Mars: e = 0.09340, ε = 25.1919°, Sun's longitude at perihelion 251.000° (Allison & McEwen 2000, *Planet. Space Sci.* 48, 215). Saturn (e = 0.0565, ε = 26.73°) and Jupiter (e = 0.0489, ε = 3.13°) from the NASA planetary fact sheets. Their perihelion seasons are not fact-sheet numbers, so I computed them: the Sun's planetocentric longitude at perihelion, from each planet's IAU pole and its J2000 mean orbital elements, is Jupiter 57.5° and Saturn 279.0°. The same calculation gives Mars's published 251.0° and all three obliquities, and PyEphem's positions agree (Jupiter's northern spring equinox in 2021, perihelion in January 2023). The value matters: at these eccentricities the perihelion season sets how far the loop opens and which way it leans. At Jupiter's e and tilt the figure ranges from a straight line (perihelion at an equinox) to an open ellipse (perihelion at a solstice). These presets keep Earth's day and calendar, so their *shapes* are right (the equation of time in degrees of hour angle, against declination) while the dates are borrowed; the page says so.

**The sky.** Local hour angle of the true Sun H = 15°·(clock − 12 − zone) + longitude + EoT; altitude and azimuth from the standard spherical-triangle formulas. The sky picture is a gnomonic projection: a level camera aimed at the unit-vector mean of the year's Sun directions, image coordinates x = (v·right)/(v·forward), y = (v·up)/(v·forward). The horizon is the level line y = −tan(camera altitude); lines of equal altitude are traced numerically; compass directions along the bottom edge are found by converting that edge's pixels back to directions. If fewer than half the year's points fall within 75° of that mean direction (a degenerate spread), the camera looks straight up instead; in practice a fixed clock time never produces that, and the fallback is a safety net.

**Sunrise and sunset.** The Sun's centre at −0.8333° (34′ refraction + 16′ semi-diameter, the almanac convention): cos H₀ = (sin(−0.8333°) − sin φ sin δ)/(cos φ cos δ), with δ and EoT re-evaluated at the event itself in two passes and solar noon in three. |argument| > 1 is reported as polar day or night rather than computed. "Earliest sunset" and friends are found at sub-minute precision over every day of the year, so they fall on one date; published tables round to the minute and sometimes show a two-day tie.

**Simplifications.** The Sun comes from mean elements. There is no nutation (up to ±17″ in longitude: up to ~7 minutes in the timing of an equinox, but only ~0.2 s in the equation of time, because nutation shifts sidereal time almost as much as it shifts the Sun). There are no planetary perturbations of Earth's orbit and no lunar wobble of the Earth about the Earth–Moon barycentre (~6″). ΔT is ignored: dates serve as both UT and TT, which makes events ~1.2 min late. Against PyEphem's VSOP87 Sun over 2000–2050, all this leaves the equation of time within 2.2 s and the declination within 0.005°, but the equinox and solstice instants off by up to 16 minutes. Refraction is applied only at the horizon, at a fixed 34′. The ellipse is fixed, so there is no secular change within a year beyond the linear drifts above. The skyline silhouette is decoration.

### Verification (`sun.test.mjs`, 28 tests, and `page.test.mjs`, all passing; the numbers below are what they print)

Every check compares the model against something it does not share code with: closed forms, an independent implementation of the NOAA solar calculator (Meeus-based polynomial elements, a series for the equation of centre, nutation via the lunar node, and the classical five-term equation-of-time series, written in the test file), a full-ephemeris reference table (`pyephem-reference.json`: PyEphem 4.2.1's VSOP87 Sun with nutation, aberration and ΔT, generated once; the generator is stored in the file), Allison & McEwen's Mars series, or published values.

| Check | Result |
|---|---|
| Kepler's equation, e from 0 to 0.9 | max residual 8.9e-16 rad |
| Equation of centre vs third-order series (Earth e) | max difference 6.3e-6° (the fourth-order term is ~5e-6°) |
| Tilt-only amplitude vs closed form 4·(90° − 2·atan√cos ε) | 9.8658 min vs 9.8658 min |
| Orbit-only amplitude vs 2e radians | 7.6589 min vs 7.6587 min |
| Tilt + orbit vs total | agree to within 0.62 min (the cross term; the page says "very nearly the sum … to within 0.6 min") |
| EoT and declination vs NOAA/Meeus, every day 2000–2050 | max 3.0 s and 0.0026° |
| EoT and declination vs PyEphem (VSOP87), every 10th day 2000–2050 | max 2.16 s and 0.0048° |
| Sunrise, noon, sunset vs NOAA with an event-time pass, 9 latitudes × 73 dates | max 4.9 s (at 65°N near the solstice) |
| Altitude at the computed rise/set instants | −0.8333° to 2.2e-4° |
| EoT extremes, year 2000 (epoch-2000 table: −14 m 15 s on 11 Feb, +16 m 25 s on 3 Nov) | −14.25 min on 12 Feb 00:30 UT; +16.42 min on 2 Nov 23:30 UT |
| EoT extremes, 2020 (EarthSky: −14.24 on 11 Feb, +16.49 on 2 Nov) | −14.21 min on 11 Feb; +16.44 min on 2 Nov |
| 2026 equinoxes and solstices vs USNO (14:46, 08:24, 00:05, 20:50 UT) | −5.7, −0.1, +8.4, +3.2 min |
| Equinoxes and solstices vs PyEphem, 2000–2050 (204 events) | 2026: −5.6, −0.6, +8.3, +3.2 min; worst −16.3 min (September 2019); rms 6.7 min; UT date right for 202 of 204. With nutation added: 2026 becomes −8.1, −3.9, +4.6, −0.6 min, worst still −10.4 min |
| 40°N: earliest sunset / shortest day / latest sunrise (USNO FAQ: "around 8 Dec", "around 5 Jan") | 7 Dec 16:35 / 21 Dec (9 h 20 min) / 4 Jan 07:22; NOAA implementation agrees on 7 Dec |
| 40°N in June: earliest sunrise / longest day / latest sunset | 14 Jun 04:31 / 21 Jun / 27 Jun 19:33 |
| Equator: earliest sunset and latest sunrise track the EoT extremes | 2 Nov (EoT max 3 Nov) and 12 Feb (EoT min 11 Feb); day length varies by only 1.0 min all year |
| Offset shrinks toward the pole: shortest day minus earliest sunset | 14 days at 40°N, 9 at 51.5°N (London), 8 at 52°N, 5 at 60°N; 34°S mirrors (11 Jun / 21 Jun / 30 Jun) |
| Polar stretches, 70°N | at 60°W (UTC−4) the earliest sunset and latest sunrise both fall on 25 Nov, before the polar night (26 Nov to 16 Jan); at 0° they straddle it |
| New York, 22 Oct 2026, EDT: solar noon | 12:40 = 12:00 + 56.0 min (14.0° west of 60°W) − 15.6 min (EoT) |
| Mars EoT vs Allison & McEwen (2000) series | max 0.0014°; range −51.1 to +39.9 minutes of a sol; zero self-crossings (a teardrop) |
| Perihelion seasons from IAU pole + J2000 elements | Mars 251.00° (Allison & McEwen: 251.000°), Jupiter 57.51°, Saturn 279.01°; obliquities 25.19°, 3.12°, 26.73° |
| Jupiter's figure vs perihelion season (short/long axis ratio, lean) | ϖ = 0°: 0.01 (a line); 90°: 0.56, no lean; 57.5° (preset): 0.42, −20.5°; the old 280° placeholder: 0.54, −7.9° |
| Figure topology | Earth 1 crossing, circular Earth 1, untilted 0, Saturn 1, Jupiter 0; at Earth's tilt and perihelion season the crossing vanishes above e ≈ 0.045 (0.044 with perihelion at a solstice; not below e = 0.3 with perihelion at an equinox) |
| Calendar | Meeus example 1957 Oct 4.81 = JD 2436116.31; 2026 Oct 22 0h = JD 2461335.5; round-trips |

`page.test.mjs` drives the real page in headless Chromium (it skips itself if Playwright is not installed) and checks the polar verdicts above and the Jupiter preset. `node tools/check.mjs ideas/21-same-time-tomorrow` runs the tests and the headless smoke test (desktop and 390 px phone, light and dark); both pass. I also drove the page with Playwright through every preset, the equator at noon, 02:00 (the whole figure below the horizon), 70°N, 34°S and the pole, in both colour schemes, and read the screenshots.

## Honest assessment

What works:
- [Certain] The numbers on the page are the model's, and the model agrees with an independent Meeus/NOAA implementation to 3 s in the equation of time and 5 s in sunrise and sunset, with a full ephemeris (PyEphem's VSOP87 Sun) to 2.2 s in the equation of time and 0.005° in declination over 2000–2050, and with the published values in the table above. The sunrise/sunset refraction convention (−0.8333°) is the one almanacs use.
- [Certain] The headline facts: the equation of time runs from about −14.2 min (11 Feb) to +16.4 min (3 Nov); the tilt alone is worth ±9.87 min and the ellipse alone ±7.66 min; at 40°N the earliest sunset is 7 Dec, the shortest day 21 Dec and the latest sunrise 4 Jan (USNO: "around" 8 Dec and 5 Jan, from minute-rounded tables); on the equator the earliest sunset is 2 Nov and the latest sunrise 12 Feb.
- [Certain] Mars's figure is a single loop (no crossing); Jupiter's, with a 3° tilt, is too, because its orbit term (±22 min) swamps its tilt term (±0.17 min). I expected Jupiter to be a figure-8 and wrote a test saying so; the computation corrected me, and the reasoning is simple once seen: the curve (−A sin(L − ϖ), B sin L) is an ellipse when the tilt's second harmonic is negligible. How open that ellipse is, and which way it leans, depends on the perihelion season ϖ; with perihelion at an equinox it would collapse to a line.
- [Likely] The explanation of the lopsided solstice (the equation of time's slope near the solstice drags both sunrise and sunset by roughly half a minute a day while the day length is stationary) is the standard one and the sliders bear it out: with the ellipse removed the offset shrinks but does not vanish, because the tilt term also has a slope at the solstice.
- [Likely] The sky picture, as a level rectilinear camera aimed at the figure, is a faithful stand-in for an analemma photograph. A real photograph has a fixed camera for the whole year; mine re-aims if you change the clock time, which is what you would do too.

What's rough:
- [Certain] The equinox and solstice *instants* are off by several minutes: −6 to +8 min in 2026, and up to 16 min in other years between 2000 and 2050 (against PyEphem). The cause is the mean-element Sun: no planetary or lunar perturbations, no nutation and no ΔT. Nutation is only part of it; adding it alone would still leave errors of up to 10 minutes, and would make the 2026 March equinox worse. The page never shows those instants; it only uses their dates to label the figure, and the UT date is right for 202 of the 204 events from 2000 to 2050 (the two misses fall within a minute of midnight UT). The equation of time is affected at the 2 s level and the declination at 0.005°, which is invisible.
- [Certain] "Mars", "Saturn" and "Jupiter" are shapes on Earth's calendar and clock: the equation of time is shown in minutes of the planet's own day, but month labels and sunrise dates in section 3 are Earth dates. Section 3 for those presets is a what-if ("if Earth had Mars's orbit"), and the page's captions say so.
- [Certain] The "today" default uses the browser's clock and UTC offset, so someone viewing in summer time gets their *summer* offset as the fixed year-round zone; the figure is still right for that zone, and the "Where exactly?" box lets you set the standard one.
- [Likely] Jupiter's and Saturn's perihelion seasons (57.5° and 279.0°) are my own calculation from the IAU poles and J2000 mean elements, not a published table. The same method reproduces Mars's published value, and PyEphem's equinox and perihelion dates agree, so I trust them to about a degree, which makes no visible difference to the figures.
- [Likely] The di Cicco history (1978–79, *Sky & Telescope*, 1979) is from a web search, not from the article itself; sources disagree on whether the frame holds 44 or 48 exposures, so I don't say.
- [Speculative] The sky view at latitudes beyond about ±85° is a legitimate projection but not a useful one; nobody takes analemma photographs at the pole.
- Performance: every slider change recomputes a few thousand Kepler solves (one per day for each figure, plus the sunrise search) and redraws five canvases; it keeps up with slider drags in headless Chromium and should on a phone, but I have not profiled it on real hardware.

## Where it could go next

- A real **date-of-year camera**: fix the camera once, like a photographer, and let the user see the figure drift out of frame when they change the clock time.
- **Sundial correction tables**: print a month-by-month card for a chosen longitude, since the model already has everything a dial needs.
- **Historical perihelion**: the perihelion date precesses by about one day per 58 years; a slider over ±10,000 years would show the figure's lopsidedness slowly rotating, and the "earliest sunset" date migrating with it. (The eccentricity also changes on 100,000-year scales, which would need orbital theory beyond this model.)
- **The Moon's analemma**: the same idea with the Moon at the same clock time each day gives a wild, looping path because of the Moon's own 50-minute daily lag; it would need a lunar ephemeris.
- Use a fuller solar theory (Meeus's higher-accuracy method or a truncated VSOP87) plus nutation and ΔT, so the solstice instants match the almanac to the minute; nutation alone would not do it.

## Revision note

An independent reviewer rebuilt the astronomy in its own code and checked it against PyEphem's VSOP87 Sun. It reproduced every headline date on the page to the day and found real problems, all now fixed:

- **Jupiter's figure had the wrong shape.** Jupiter and Saturn used a placeholder perihelion season of 280°, with the claim that the shape barely depends on it. That claim was false: at these eccentricities the perihelion season sets how far the loop opens and which way it leans. Both are now computed from each planet's pole and orbit: 57.5° for Jupiter, 279.0° for Saturn. Saturn's figure is unchanged to the eye. Jupiter's loop now leans 20.5° instead of 7.9° and is narrower (axis ratio 0.42 instead of 0.54); it is still a single loop with no crossing. The e ≈ 0.045 figure-8 threshold is now stated as holding only at Earth's perihelion season.
- **I blamed the wrong term for the equinox errors.** I had blamed nutation and said the error was up to ~8 minutes. That held only for 2026, and nutation is not the main cause. The cause is the mean-element Sun: no planetary or lunar perturbations, no nutation and no ΔT. The errors reach 16 minutes between 2000 and 2050, and adding nutation alone would still leave 10. Against a full ephemeris, the errors in the equation of time and the declination are 2.2 s and 0.005°, not 1 s and 0.003°. A PyEphem reference table now pins all these numbers in the tests.
- **The polar verdict could be false.** At 70°N, 60°W, the earliest sunset and the latest sunrise both fall before the polar night, yet the page said they fell on either side of it. It now says where each pair actually falls. While fixing this I found that the same sentence also claimed that neither solstice has a sunrise or a sunset at latitudes like 66°N, where there is a midnight sun but no polar night. That is fixed too. A new browser test drives the page to check both.
- **Smaller fixes:**
  - The tilt and orbit terms add up to the equation of time only approximately (to within 0.6 min), and the page now says so.
  - The solstice explanation now gives the real reason: 23° from the equator the hour circles crowd together.
  - "A fortnight before the shortest day" is now "a week or two" (nine days in London).
  - The README's description of section 4 now matches the page.
