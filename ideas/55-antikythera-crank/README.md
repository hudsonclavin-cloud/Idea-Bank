# The Antikythera Crank
> Turn a crank and a reconstruction of the Antikythera mechanism turns with it: every gear at its published tooth count, every train's ratio proved exact against the period relation it encodes, the Moon riding a pin in a slot, and the drift a bronze sky would have shown against the real one.

**Kind:** explorable
**Run:** open `index.html` in a browser (plain classic scripts, so it works straight from `file://` or any static server; no build, no network). Tests: `node --test ideas/55-antikythera-crank/mechanism.test.mjs` from the repo root (Node 18+, no dependencies, under a second).
**Made by:** Kyklos

## What it is

A working model of the Antikythera mechanism, the geared astronomical calculator recovered in 1901 from a shipwreck off the Greek island of Antikythera, as reconstructed by Tony Freeth and colleagues (2006, 2008, 2021) on the foundations laid by Derek de Solla Price and Michael Wright. One page, three faces and four proofs:

- **The crank.** A bronze crank you drag round (mouse or touch), or turn with the arrow keys, Page Up and Page Down. By default one turn is one turn of the crown gear a1, whose 48 teeth drive the 223-tooth main wheel b1, so a year is 4.65 turns and one turn is 78.6 days. You can gear it up to a month, a year or a Saros per turn, play it as a motor, scrub the centuries with a slider, or jump to the eclipse epoch of 205 BC, the month-13 eclipse, the shipwreck, or today. Optional gear clicks (after you tick the box).
- **The front.** Zodiac and Egyptian 365-day calendar rings; the mean Sun on b1; the Moon pointer with its half-silvered phase ball; the five planets on concentric rings, driven by the period relations of the 2021 reconstruction. Dashed red rings show where modern theory puts the Sun, Moon and planets on the same date, so you can watch the bronze wander off the sky.
- **The back.** The Metonic calendar spiral (235 lunar months on 5 turns, with month names and years), the Games dial and the Callippic dial inside it; the Saros eclipse spiral (223 months on 4 turns) with its eclipse glyphs, and the Exeligmos dial inside it. The spiral pointers follow their grooves outwards.
- **The gears.** Every gear of the lunar, Saros, Exeligmos, Metonic, Games and Callippic trains, drawn with its real number of triangular teeth, turning with the crank, meshing tooth in tooth. Surviving gears are bronze; hypothetical ones are dashed ghosts. Buttons highlight one train at a time.
- **The pin and slot**, enlarged: k1, k2, the 1.1 mm offset (at true scale or exaggerated), and a chart of how far the slot runs ahead of or behind the pin, against Hipparchus's two lunar models and modern theory.
- **The proof**: each train's tooth counts multiplied as exact fractions, reduced, and checked against the period relation it encodes.
- **The drift**: the mechanism's mean rates against modern ones; a 150-year chart of the bronze Moon minus the real one; and a table of how the engraved eclipse months go stale as the Saros dial is used again.
- **The evidence**: every gear from `gears.json`, with its count, whether it survives or is hypothetical, its fragment and its sources.

## Why I made it

The coordinator chose the subject: a working, hand-cranked Antikythera mechanism, with a part that can be proven and a part that can only be felt. The proof was obvious from the start (a gear train is a fraction), so I expected the work to be drawing. It wasn't. The work was finding out, gear by gear, what is actually known, and most of what I found I did not expect.

- **The hypothetical gears are not guesses.** Three of the gears that do not survive have exactly one possible tooth count. Given the surviving counts, m3 must have 27 teeth or the Saros dial cannot make 4 turns in 223 months; n1 must have 53 or the Metonic pointer cannot make 5 turns in 19 years; n3 must have 57 or the Games dial cannot turn once in 4 years. The tests solve for them.
- **The 53s have a reason.** 53 is prime and an awkward number to divide a wheel into, and there are three 53-tooth gears. Two of them only cancel the third: n1 cancels l2 in the Metonic train and f1 cancels it in the Saros train. The reason for l2 is the turntable. Its rate is 477/4237 = (9 × 53)/(19 × 223), and the 53 comes straight out of the astronomy: 254 × 223 − 239 × 235 = 477 = 9 × 53. So l2 must have 53 teeth for the pin and slot to follow the Moon's apsides, and the trains that share l2 have to take it out again. e3, meanwhile, does double duty: the 223 that the Saros needs and the turntable that carries the pin.
- **The pin and slot is not an approximation.** I expected a mechanical approximation to Hipparchus's lunar model. It is the model, exactly: the angle of the slot is the angle the eccentric (or, equivalently, the epicycle) model predicts, to the last digit, because both are the same triangle. The surprise was the size. The offset ratio, 1.1/9.6 = 0.1146 (Freeth et al. 2006's estimates), gives a largest swing of 6.58°, larger than either of the values Ptolemy reports for Hipparchus (5.98° and 4.55°) and close to the modern 6.29°. One paper I found argues that the ratio reflects the Moon's real eccentricity (0.1146 is about twice 0.0549); I have not seen that tested, and with a measurement good to about 5 per cent I would not lean on it.
- **The turntable turns with the Moon's apsides.** e3 turns once in 8.88 years. The Moon's line of apsides turns once in 8.85 years. It is not a separate input: it is what is left when you take 239 anomalistic months in 223 synodic away from 254 sidereal months in 19 years.
- **My eclipses landed where the historians said.** I computed the eclipses in the Saros that began in April 205 BC with a modern method that knows nothing about the mechanism. I had one choice to make, whether a solar eclipse belongs to the month its conjunction begins or ends; only the second puts any eclipse in month 13, so that choice was mine. But the eclipse it puts there, a partial on 17 May 204 BC, turned out to be of solar Saros series 44, and Carman and Evans (2014) had written that the month-13 solar glyph "almost certainly belongs to solar Saros series 44". The series number is not something I could have tuned. The cycle also has exactly 38 eclipse seasons, 5 or 6 months apart: Jones's "223 lunar months = 38 nodal coincidences".
- **The drift is small, and then it isn't.** The Moon's mean motion is off by 5.6° per century. In the first decade the error is dominated by the lunar terms the mechanism has no gears for (up to about 3.5°). By the shipwreck, 140 years after the epoch, the bronze Moon averages 8° fast and can be 14° off. Crank it to today and it is about 125° off on average, give or take the terms it has no gears for: 2,230 years of a ratio that is wrong in the sixth digit.

## How it works

**Files.** `mechanism.js` is the model: no DOM, loaded by the page as a classic script and by the tests through `require`. `gears.json` is the gear table, and `gears.js` is the same data wrapped for the page (pages opened from `file://` cannot fetch JSON); a test checks that the two hold identical data. `app.js` draws and handles input; `style.css` has light and dark schemes.

**The reconstruction followed.** Freeth et al. 2006 (*Nature* 444:587) for the lunar and Saros trains, including the pin and slot; Freeth et al. 2008 (*Nature* 454:614) for the Metonic, Games and Callippic trains, the Exeligmos dial and the month names; Freeth et al. 2021 (*Scientific Reports* 11:5821) for the planetary period relations. I follow Freeth et al. where earlier reconstructions differ (Price's 1974 scheme put a differential on the e-axis to work out the Moon's phase; later reconstructions, from Wright's onwards, do without it, and Freeth et al. explained e3 instead as the turntable of the pin and slot), because theirs is the only one I found that accounts for e3's 223 teeth, the k1/k2 pin and slot and the back-dial inscriptions together.

**The trains** (driver/driven along each, exact; the proof table on the page and the tests recompute every line from `gears.json`):

| Train | Tooth counts | Ratio per turn of b1 | Encodes |
|---|---|---|---|
| Moon, mean | 64/38 × 48/24 × 127/32 | 254/19 | (235 + 19)/19: 254 sidereal months in 19 years |
| Turntable e3 | 64/38 × 53/96 × 27/223 | 477/4237 | 254/19 − (239/223)(235/19): the Moon's line of apsides, once in 8.88 years |
| Pin on k1 (relative to e3) | difference of the two above | 56165/4237 | 239 anomalistic months per 223 synodic months, in years of 235/19 months |
| Metonic pointer | 64/38 × 53/96 × 15/53 | 5/19 | 235 months in 19 years on 5 turns of 47 cells |
| Callippic pointer | Metonic × 15/60 × 12/60 | 1/76 | one turn in 76 years (four Metonic cycles) |
| Games pointer | Metonic × 57/60 | 1/4 | one turn in 4 years |
| Saros pointer | 64/38 × 53/96 × 27/223 × 188/53 × 30/54 | 940/4237 | 4 turns in 223 months: 4 × (235/19)/223 |
| Exeligmos pointer | Saros × 20/60 × 15/60 | 235/12711 | one turn in 3 × 223 = 669 months |
| Moon pointer, return | 50/50 × 50/50 × 32/32 | 1 | b3 follows e2 on average; the pin adds only the variation |

Directions follow from counting meshes (each external mesh reverses): the Moon pointer turns with the Sun; the Metonic, Callippic, Saros and Exeligmos pointers all turn one way and the Games pointer the other, which matches the report that the Games dial is the only back dial that turns anticlockwise. I draw the front clockwise and the back dials clockwise as seen from behind, which is what that parity implies.

**The kinematics** are computed through the gears, not from the ratios: starting from b1's angle, every fixed-axis mesh sets θ_driven = −(z_driver/z_driven) θ_driver. k1 and k2 ride on e3: k1 meshes with e5 relative to the turning e3, the pin on k1 drives the slot on k2, k2 meshes with e6 relative to e3, and e6/e1 drive b3. The test checks that this reproduces every ratio above and that the Moon pointer equals the mean motion plus the eccentric-model equation exactly.

**The pin and slot.** k2's axis is offset from k1's by e·r, where r is the pin's radius. If the pin is at angle M about k1's axis, the slot points at atan2(sin M, cos M − e), so the slot leads the pin by Σ eⁿ/n · sin(nM) = e sin M + (e²/2) sin 2M + …, a continuous speeding-up and slowing-down once per turn of the pin. This is the eccentric lunar model (Moon uniform on a circle whose centre is offset by e) and, by Apollonius's equivalence, the epicycle model; Carman, Thorndike & Evans (2012) give a short proof. The largest lead is asin(e), reached when the slot stands at right angles to the line between the axes (cos M = e), not at a quarter-turn; at a quarter-turn it is atan(e) = 6.54°, close to the "±6.53°" some secondary sources quote, which looks like this quarter-turn value. With e = 1.1/9.6 = 0.1146 the largest lead is 6.58°. The pin turns once per anomalistic month (4237/56165 of a year: 27.553 days, against 27.555), and the platform under it turns once per 8.88 years so that the swing is centred on the Moon's slowly moving perigee.

**Evidence status** (`gears.json`, shown in full on the page). 30 gears survive: 27 in Fragment A (a1, b1-b3, c1-c2, d1-d2, e1-e6, f1-f2, g1-g2, h1-h2, i1, k1-k2, l1-l2, m1-m2), o1 in Fragment B (under the Games dial), the Moon-phase contrate gear ma1 in Fragment C, and an unplaced 63-tooth gear in Fragment D. Their counts are estimates from incomplete gears; for b1 the estimates are 223-224 (Freeth et al. 2006), 225 (Price), 223-226 (Karakalos) and 216-231 (Wright), and I use 223 (b1's count changes only how many crank turns make a year, never a dial). Seven calendar and eclipse gears are hypothetical: m3 (added by Freeth et al. 2006 on the broken-off m shaft), n1, n2, p1, p2 (proposed before 2006 and kept), and n3 and q1 (Freeth et al. 2008). The 2021 planetary trains' fixed 51- and 56-tooth gears are listed as hypothetical but not drawn.

**The calibration.** The model's clock is the turn of b1, set to the Sun: one turn per mean tropical year (365.242189 days). The epoch is the mean conjunction that began the Saros dial's month 1, the lunar month that began with the conjunction of 28 April 205 BC (Carman & Evans 2014; Freeth 2014; Jones 2020). The mean conjunction falls on the evening of 27 April (UT), the true one shortly after midnight; the page opens a day later. At the epoch the Sun pointer is set to the modern mean Sun, the Moon pointer to the Moon's modern mean longitude and the pin to the Moon's mean anomaly; after that only the gears move them. The Metonic, Games and Callippic dials start four lunations later (Iversen 2017: the new moon of 23 August 205 BC). Lunar eclipses go with the full Moon of a month and solar eclipses with the conjunction that ends it, which is the convention that puts Carman and Evans's Saros-44 eclipse in month 13. The Egyptian ring is kept set for you (on the original it was movable, and a 365-day year slips a day against the Sun every four years), and dates use the Julian calendar before 1582.

**The dials.** Metonic cells carry year numbers and month names (Phoinikaios, Kraneios, Lanotropios, Machaneus, Dodekateus, Eukleios, Artemisios, Psydreus, Gameilios, Agrianios, Panamos, Apellaios), with seven 13-month years, the extra month a second Machaneus (see the assessment for how sure that is). The Games dial reads Year 1 Isthmia and Olympia, Year 2 Nemea and Naa, Year 3 Isthmia and Pythia, Year 4 Nemea and Halieia. The Exeligmos dial says to add 0, 8 or 16 hours to the glyph times. The Saros glyphs are my reconstruction: the eclipses that modern theory (Meeus, *Astronomical Algorithms*, ch. 54) finds in each month of the 205-187 BC cycle, Σ for an umbral lunar eclipse, σ for a penumbral one, Η for a solar eclipse anywhere on Earth.

**The planets.** Each planet's synodic phase advances by the 2021 period relation: Mercury 1513 synodic cycles in 480 years, Venus 289 in 462, Mars 133 in 284, Jupiter 315 in 344, Saturn 427 in 442. The 462 and 442 are read on the Front Cover Inscription; the others are Freeth et al.'s derivations. The direction of each planet is then computed from a simple epicycle model (circular orbits, modern mean distances), which as far as I could tell is the kind of model the 2021 gearing realises; I do not draw the 2021 gear trains.

**The modern sky**, for comparison only: Sun from Meeus ch. 25; Moon from the first 50 terms of Meeus Table 47.A (0.001° from Meeus's worked example); eclipses from Meeus ch. 54 (γ within 0.001 of NASA's for 2017 and 2024); planets on the same circular model with Meeus's mean motions; ΔT from Espenak and Meeus's polynomials.

**The drift numbers.** The mechanism's lunar month is 19 years/235 = 29.53022 days, 32 seconds shorter than the true 29.53059, so its phases gain a day every 219 years and its Moon gains 5.6° per century. Its anomaly gains 21.6° per century and its apsidal line loses 16.1° per century (8.88 years per turn against 8.85). Every one of these is measured against the equinox, the frame b1 is set in, so the apsides' loss is exactly the Moon's gain minus the anomaly's (5.6 − 21.6). Its Saros is 6585.24 days against 6585.32; the real Saros is itself imperfect (242 draconic months exceed 223 synodic months by 0.036 days, so each return finds the Moon 0.48° further from its node), and it is 7.71 hours over a whole number of days, which the Exeligmos rounds to 8. The planets' synodic phases gain 4.1° (Mercury), 1.5° (Venus), 0.4° (Mars), 1.4° (Jupiter) and 1.8° (Saturn) per century.

### Verification (`mechanism.test.mjs`, 16 tests, all passing)

| Check | Result |
|---|---|
| `gears.js` equals `gears.json`; every mesh joins two arbors; 30 survivors (27 + 1 + 1 + 1) | pass |
| Every train ratio, as an exact BigInt fraction, against the astronomical relation written independently (e.g. 235/19 + 1 for the Moon) | 8 of 8 equal, including 254/19, 477/4237, 940/4237, 235/12711 and the anomaly 56165/4237 = (239/223)(235/19) |
| Solving for the hypothetical counts; where l2's 53 comes from | m3 = 27, n1 = 53, n3 = 57 exactly; 254 × 223 − 239 × 235 = 477 = 9 × 53 |
| Kinematics through the gears vs closed forms, 9 dates from −3 to 140 years | all pointers to 1e-9 |
| Moon pointer through the epicyclic gearing vs the series Σ eⁿ/n sin nM | max error 8e-14 rad over 2 years |
| Largest pin-and-slot lead | 6.580° = asin(0.1146), at cos M = e; 6.537° at a quarter-turn |
| Pin and slot vs eccentric and epicycle models | identical to 1e-12 rad |
| Meeus worked examples (Sun 25.a, Moon 47.a, eclipses 54.a and 54.b); NASA γ for 2017 and 2024, umbral magnitudes for 2018 and 2022, and their Saros series | all within tolerance |
| Saros cell 1 on 12 May 205 BC (Carman & Evans's full Moon of month 1); the cycle's 223 months end on 9 May 187 BC (Jones's closing conjunction) | pass; the model's month 223 ends 9 May 187 BC |
| Month-13 solar eclipse | 17 May 204 BC, solar Saros 44 (Carman & Evans) |
| Metonic cell 1 starts at the new moon of 23 August 205 BC (Iversen) | 23 August 205 BC, 0.4 day after noon |
| Games dial reads Year 1 (Isthmia, Olympia) in spring and summer 204 BC, when the 144th Olympiad began | pass |
| One Metonic cycle on: cell 1, Callippic sector 2. One, two, three Saros on: Exeligmos +8, +16, +0 hours | pass |
| Eclipse seasons in the 205-187 BC Saros | 38, all 5 or 6 months apart; 27 umbral and 15 penumbral lunar, 41 solar eclipses |
| Moon error against modern theory (sampled every 6 hours, peaks refined to the minute) | first year mean 0.0°, max 2.7°; years 9-10 mean 0.56°, max 3.5°; years 49-50 mean 2.8°, max 6.6°; years 99-100 mean 5.6°, max 10.8°; years 140-141 mean 8.0°, max 13.8°; through 2026 mean 125° |
| Drift table against the page's own simulation, 205-105 BC | Moon +5.7°, anomaly +22.2°, perigee −16.5° against the table's +5.6°, +21.6°, −16.1°; the table's apsides row equals Moon minus anomaly |
| Engraved eclipse months still eclipsed after 5 Saros (90 years) | lunar 25 of 27, solar 39 of 41, and 8 eclipses in unmarked months |
| Modern synodic periods from Meeus's mean motions vs NASA fact sheets | all five within 0.01 day |

Beyond the unit tests, `node tools/check.mjs ideas/55-antikythera-crank` passes (README, size, tests, and the headless smoke test at desktop and 390 px phone width), and I drove the page headless at phone size with touch drags on the crank and with the keyboard, in both colour schemes and with reduced motion, and read the screenshots.

## Honest assessment

What I am sure of:
- [Certain] Given these tooth counts, the ratios are exactly as stated: whole-number arithmetic, checked twice by independent code.
- [Certain] The pin and slot reproduces the eccentric/epicycle lunar model exactly, with a largest lead of asin(offset/pin radius). With 1.1/9.6 that is 6.58°.
- [Certain] The drift rates follow from the ratios and the modern mean motions quoted, all measured against the equinox. They are J2000 values (Meeus/Chapront). The Moon's real rates were slightly different around 200 BC, so over the first century from 205 BC the page's own simulation drifts by 5.7°, 22.2° and −16.5° (Moon, anomaly, perigee), against the table's 5.6°, 21.6° and −16.1°. That is within 3 per cent, and no conclusion changes.

What rests on sources I could check only at second hand:
- [Likely] The tooth counts. I could not read Freeth et al.'s supplementary tables myself. The counts here are the ones attributed to that reconstruction by Tsigkros (2015, which tabulates them), Spinellis (2008, the Metonic and Callippic trains), Voulgaris et al. (b1's range) and others, and they reproduce every published ratio exactly, which a wrong count almost never would. Individual counts on badly preserved gears carry uncertainty I could not quantify, except for b1.
- [Likely] Which gears are hypothetical. Freeth et al. 2006 describe n1, n2, p1 and p2 as proposed previously and m3 as their addition; n3 and q1 come with the 2008 rearrangement that moved the Callippic train and gave o1 (Fragment B) to the Games dial. I could not confirm the 2008 assignments in the primary text.
- [Likely] The pin's radius. Both lengths are Freeth et al. 2006's own estimates: the axes about 1.1 mm apart and the pin about 9.6 mm from k1's axis, giving about 6.5°. The ratio 0.1146 ± 0.0057 that later authors quote comes from them. I have these figures from quotations of the paper, not from its full text. A later re-measurement by Voulgaris and colleagues is reported as about 9.9 mm, which gives 6.4°; I could not check that paper myself. A 5 per cent error in either measurement moves the largest lead between about 6.3° and 6.9°, and 9.9 mm falls inside that range.
- [Likely] The Games dial's layout. That each sector has a year and two games (Isthmia, Olympia, Nemea and Pythia, with Naa and a sixth) is from Freeth et al. 2008; Iversen identified the Year 4 games as the Halieia of Rhodes. Naa's year and the order of the others are my reading of how the biennial Isthmia and Nemea fall in a calendar year that starts in late summer; I could not see the published figure.
- [Likely] The epochs: 205 BC for the Saros dial (two independent 2014 studies, confirmed by Jones 2020) and four months later for the Metonic and Games dials (Iversen 2017). Voulgaris et al. argue for a start in December 178 BC instead.

What is my own choice or guess:
- [Speculative] Which seven years of the Metonic cycle have 13 months. I use years 1, 3, 6, 9, 11, 14 and 17 with a doubled Machaneus, because that puts year 11's extra Machaneus in cell 129, the one placement I could verify (through reports of Iversen's reading). Freeth proposed Eukleios as the extra month; Anastasiou and Iversen argue for Machaneus. The original also regulated month lengths by excluding days, which I do not model.
- [Speculative] The Saros glyphs are not the inscription. They are the eclipses that actually happened (by modern theory) in the 205-187 BC cycle. The real dial carried a prediction scheme with times and index letters, about a third of it survives, and how many of its cells carried glyphs is disputed (Anastasiou et al. 49; Freeth's 2019 revision 51). I have not reproduced that scheme, and I have not compared my eclipse months with the surviving glyphs cell by cell.
- [Speculative] The positions of the gears in the gear view are schematic. Sizes are true to tooth count within each meshing pair, but the real gears sit on several layers at positions I did not have. Where each spiral starts on the plate, the true shape of the spirals, and the order of the Exeligmos dial's three sectors are also my choices.
- [Speculative] The planets. Only the period relations come from the 2021 paper (and only Venus's and Saturn's are inscribed). The 2021 gear trains are a hypothesis built on the 63-tooth gear in Fragment D (which Voulgaris et al. place in a lunar-node train instead) and on features of b1's spokes; I drive the planets by their ratios on a circular epicycle model with modern distances and do not draw those trains. The 2021 model also has a true Sun with its own anomaly; my Sun pointer is the mean Sun of the 2006 model, up to 2° from the real one.
- [Speculative] The crank. That a crank turned a1 is Price's inference; Voulgaris et al. have argued the input was elsewhere. The 78.6 days per turn is a1's 48 teeth against b1's 223 and nothing more.

Where scholars disagree, briefly:
- *Date.* The wreck sank after about 76 BC (its newest coins), probably by a decade or two. The mechanism's lettering has been dated from the late third to the first century BC; Freeth et al. 2006 said "around the end of the second century BC". The dial epochs say 205 BC, but an epoch is a starting cycle a maker chose, not a date of manufacture.
- *Hipparchus.* Freeth et al. 2006 called the pin and slot a realisation of Hipparchus's lunar theory. Hipparchus is the astronomer known to have measured the model's size from eclipses (Ptolemy, *Almagest* IV.11), but the eccentric and epicycle models are older, and with a 205 BC epoch the design may predate his work. "Hipparchus's model" names the geometry, not a known designer.
- *The calendar ring.* Usually read as a 365-day Egyptian calendar; hole-count analyses (Budiselic et al. 2020; Woan & Bayley 2024) favour 354 holes, a lunar year. I draw the 365-day reading.

Rough edges:
- The gear view is dense: the real mechanism stacks big wheels over each other, and so does mine. Use the train buttons.
- The modern comparison is low precision (about 0.01° for the Sun and Moon), which is ample for errors of degrees. Planet "truth" is the same circular model as the bronze, so the planets' red rings show only the period-relation drift, not the planets' real wanderings.
- Labels on the gear view are placed greedily and some are hidden on phones unless a train is highlighted.

## Where it could go next

- Reproduce the inscribed eclipse scheme itself (Freeth 2014's eclipse-year model, with times and index letters) and set it beside the eclipses that happened.
- Draw the 2021 cosmos gearing behind the front dial, with its true Sun, once its tooth counts are checked against the paper.
- Model the excluded days and the full and hollow months of the Metonic calendar, and the 354-hole calendar ring as an alternative.
- A layered 3D view from the side, so the overlapping wheels separate into their real planes.
- A "set it yourself" mode: hand the reader a mechanism calibrated in 205 BC and the night sky of a later date, and let them turn the crank to match it.

## Revision note

An independent reviewer rebuilt the ratios, the pin-and-slot geometry, the epochs, the eclipses and the drift in separate code. It reproduced almost every number and found one real error and some smaller problems. I reproduced each one in my own code before changing anything:

- **The apsidal drift was in the wrong frame.** The apsides row compared the turntable with the Moon's apsidal rate against the stars, while b1, the model and every other row work against the equinox. In the page's own frame the line of apsides loses 16.1° per century, not 14.7°. That is exactly the Moon's +5.6° minus the anomaly's +21.6°, and it matches the page's own simulation (−16.5° over the first century). The row, its note, the modern period (8.848 years against the equinox; 8.851 against the stars) and the README now agree. A new test checks the table against the simulation over the first century.
- **The Moon-error maxima were understated.** The test sampled every 3 days and missed the peaks. Sampled every 6 hours with each peak refined to the minute, the maxima are 2.7°, 3.5°, 6.6° and 10.8°, not 2.6°, 3.3°, 6.6° and 10.5°. The first decade reaches about 3.5°, not 3°. The means did not change.
- **"About 124° off today" was a straight-line extrapolation.** The reviewer thought the figure was never asserted. It was, but only as the J2000 rate times 2,230 years. The page itself, averaged over 2026, shows 125°, because ΔT and the slow change in the Moon's real motion add about a degree. The README now says 125°, and the test measures the page.
- **The pin's radius had the wrong provenance.** The 1.1 mm, the 9.6 mm and the ~6.5° are all Freeth et al. 2006's own estimates. The later 0.1146 figure comes from them, not the other way round. A later re-measurement reported as 9.9 mm (6.4°) is now mentioned, and it sits inside the stated 5 per cent band.
- **The tagline overclaimed.** The ratios are exact against the ancient period relations they encode, not against the sky. The sky is what the drift section measures them against.
