# Pre-registration

Written 2026-10-23 at about 22:45 UTC, before any river data around a clock change had been downloaded or looked at. The only discharge values seen so far were 22 readings of the Colorado River at Lees Ferry from 00:00 to 05:15 MST on 1 March 2015 (a connection test), which say nothing about daylight saving time. This file is kept unchanged once the data are fetched; anything decided later is marked as such in the README.

## The question

Arizona does not observe daylight saving time. The Colorado River at Lees Ferry, Arizona, 15 miles below Glen Canyon Dam, rises and falls every day because the dam's releases follow the demand for electricity, and that electricity is sold largely to utilities in states that do change their clocks. When the rest of the Mountain time zone springs forward in March and falls back in November, does the river's daily rise and fall move by an hour too?

Asked more generally: does a river keep clock time (its daily cycle moves by one hour, measured in standard time, when the clocks change), sun time (it does not move), or something in between?

## My guess, written down before looking

Lees Ferry keeps most of the hour, perhaps 40 to 60 minutes of it, because most of the load the dam follows is in states that change their clocks. Low confidence: I do not know how the dam's hourly schedules are written.

## Rivers (candidates)

| Site | USGS no. | Variable | State clocks | Role | Expected |
|---|---|---|---|---|---|
| Colorado River at Lees Ferry, AZ | 09380000 | discharge | no DST | the question | unknown |
| Salt River below Stewart Mountain Dam, AZ | 09502000 | discharge | no DST | an Arizona dam serving Arizona | if it has a daily cycle: does not move |
| Chattahoochee River at Buford Dam, GA | 02334430 | discharge | DST | hydropower dam in a DST state (positive control) | moves 60 min |
| Trinity River below Dallas, TX | 08057410 | discharge | DST | treated wastewater of a DST city (positive control) | moves 60 min |
| Santa Cruz River at Cortaro, AZ | 09486500 | discharge | no DST | treated wastewater of a no-DST city (negative control) | does not move |
| Delaware River at Trenton, NJ | 01463500 | water temperature | DST | the Sun's daily heating in a DST state (negative control; catches time-zone bugs) | does not move |

Each site's day is a day of its own **standard** time, kept fixed all year: UTC−7 for the Arizona sites, UTC−6 for Dallas, UTC−5 for Georgia and New Jersey. Everything is measured in that fixed clock. A river that keeps clock time therefore moves 1 hour **earlier** in standard time when clocks spring forward and 1 hour **later** when they fall back.

**Inclusion rule (screening).** A candidate is analysed if, over the 2008–2025 analysis windows, the median day has a daily-cycle amplitude of at least 2% of the day's mean discharge (at least 0.1 °C for temperature), and at least 70% of its transitions give a valid estimate (below). The screening script prints only amplitudes and coverage, never a phase or a time of day.

## Data

USGS NWIS instantaneous values (waterservices.usgs.gov), discharge (00060) or water temperature (00010), every value as published, including provisional ones. Timestamps converted to UTC with the published time-zone code, then to the site's standard time.

Years 2008–2025: the US rule has been the same since 2007 (clocks forward 02:00 on the second Sunday in March, back 02:00 on the first Sunday in November).

## Method

1. **Hourly series.** Mean of all values in each standard-time hour. Gaps of up to 3 hours are filled by straight-line interpolation; a longer gap makes every day it touches unusable.
2. **Remove the slow part.** Subtract a centred 2×24-hour moving average (weights 1/48, 1/24 × 23, 1/48), which passes a 24-hour cycle untouched.
3. **One number per day.** For each standard-time day, the 24-hour Fourier component of the residual, C = Σ r<sub>h</sub> exp(−2πi(h + ½)/24), h = 0…23. Its amplitude A = |C|/12 and its peak time τ = −arg(C)·24/2π, modulo 24 h. τ is when the day's 24-hour wave crests, in standard time. A pure time shift of a repeating daily pattern moves τ by exactly that shift, whatever the pattern's shape.
4. **Windows.** For each transition Sunday T: the 14 days before (T−14 … T−1) and the 14 days after (T+1 … T+14). The Sunday of the change itself is left out. Each weekday appears twice on each side.
5. **One estimate per transition.** τ is unwrapped to lie within 12 h of the A²-weighted circular mean of the window. Then a robust weighted regression

   τ<sub>d</sub> = a + b·(d − T) + s·[d > T] + (day-of-week effects) + error,

   with weights A<sub>d</sub>², refined by iteratively reweighted least squares with Tukey's biweight (c = 4.685, scale from the median absolute deviation of the weighted residuals). s is the step on the night of the change, in minutes. b absorbs a smooth seasonal drift (for example, an evening peak that follows sunset); the weekday terms absorb the weekly rhythm. A transition is valid if at least 10 days on each side are usable.
6. **Summaries.** For each site, the spring steps and the fall steps over the years, each with mean and 95% t-interval over years. For each year with both, K = (s<sub>fall</sub> − s<sub>spring</sub>)/2, in minutes: 60 means the river keeps clock time, 0 that it keeps standard (sun) time. The answer for a river is the mean K with its 95% t-interval.
7. **Placebos.** The same estimator at fake transitions 35 days before and 35 days after every real one, when nothing happens to the clocks. They show how often the method finds a step where there is none.
8. **Decision rule.** On K's 95% interval: excludes 0 and includes 60 → *keeps clock time*; includes 0 and excludes 60 → *keeps standard time*; excludes both → *keeps part of the hour* (K/60 reported); includes both → *cannot tell*.

## A second test, if Lees Ferry keeps any of the hour

Before 2007 the clocks changed on the first Sunday in April and the last Sunday in October. If the instantaneous record goes back far enough, the same estimator is run at both pairs of dates in both eras (1990–2006 and 2008–2025). A river that keeps the clocks should step on the dates the law said, in each era, and not on the other pair. This separates the clock from the calendar (for example, from monthly release volumes that change on the 1st).

## What I will report whatever happens

Every site that passes screening, every estimate with its interval, the placebo results, and whether the answer disappointed me.

## Amendment 1, before any data (2026-10-23, about 22:55 UTC)

I wrote the estimator and tested it on synthetic rivers (`method.test.mjs`) before downloading anything. Three things in the plan above failed those tests, and are changed here, still before any river data around a clock change has been fetched:

1. **Weights.** With weights A², a day with a one-off disturbance (a storm, a ramp up to a high-flow release) gets a huge "daily wave" with a meaningless crest time and swamps the fit; on synthetic rivers with two such days in a window, steps came out hours wrong. The weight of a day is now the square of min(A/Ã, Ã/A), where Ã is the median A of the window: weak days count less, as planned, and unusually strong days count less too. The circular mean used for unwrapping uses the same weights.
2. **Robust start.** The biweight iterations now start from a least-absolute-deviations fit (by iterative reweighting) instead of from the weighted least-squares fit, which a few wild days could drag beyond recovery.
3. **Decision rule.** On synthetic rivers with realistic day-to-day timing noise, the estimator's average error is a few minutes (up to about 5), so a strict "the interval includes exactly 60" rule could call a river that keeps clock time "part of the hour". The rule now allows 10 minutes either way: an interval that reaches within 10 minutes of 60 and not within 10 minutes of 0 is *keeps clock time*; within 10 minutes of 0 and not of 60 is *keeps standard time*; reaching neither is *keeps part of the hour*; reaching both is *cannot tell*. (Intervals entirely above 70 or below −10 are named as such.)

Also found in testing and kept as planned: the weekday terms are needed (without them a weaker weekend wave alone biases the step by about 8 minutes), and the per-transition standard error from the fit understates the real scatter by about a third, so, as planned, uncertainty comes only from the spread between years.

## Note 2, data access only (2026-10-23, about 23:15 UTC, still before any data around a clock change was seen)

The legacy service (waterservices.usgs.gov) refused most requests longer than a few days with HTTP 503. The same instantaneous values are served, with times already in UTC, by the USGS Water Data OGC API (api.waterdata.usgs.gov, collection `continuous`), and the fetch script now uses that. Nothing in the method changes. A test checks that both services give the same readings at the same UTC instants across a clock change at a DST site.

---

# Part 2: a second method, registered after the first one failed

Written 2026-10-23 at about 23:21 UTC, after the first method had been run on the six rivers above, and **before** the second method below was run on the Colorado at Lees Ferry or on the Green River below Flaming Gorge Dam.

## What happened to the first method

Run as registered, it could not answer the question. Lees Ferry: K = 13.5 min, 95% interval −51.7 to 78.7 (*cannot tell*). The dam control in a DST state (Buford) came out *cannot tell* too, with single-year steps of many hours, and so did the Trinity and the Salt. Only the Santa Cruz (Tucson) and the Delaware's water temperature gave the expected *keeps standard time*. Looking at Buford's days showed why: a peaking dam does not repeat one daily wave. On some days it runs a morning block, on others an evening block, or both, so "the time of the day's crest" jumps by about 12 hours from one day to the next, and no regression on it can see a one-hour shift. This is a failure of my method, not a finding about rivers.

## What I have seen of Lees Ferry so far

Only the first method's numbers: K and its interval above, the placebo K values (−2.7 and −14.7), and its 35 single-transition steps, which scatter from −548 to +710 minutes. I have not looked at Lees Ferry's daily profiles, and I have not run anything else on it. I have run nothing at all on Flaming Gorge, which I added now (USGS 09234500, Green River near Greendale, Utah: a dam in the same federal power system as Glen Canyon, but in a state that changes its clocks), with the instantaneous record back to 1990 for the law-change test.

## The second method

Developed on synthetic rivers (including block-dispatched ones, `method.test.mjs`) and on the five control rivers only.

1. Same hourly series and the same residuals after the centred 2×24-hour moving average.
2. Each day's 24 residuals are scaled to unit root-mean-square (a storm day cannot outweigh an ordinary one).
3. For each centre date, the hour-by-hour **median** over the 14 days before (T−14…T−1) and, separately, over the 14 days after (T+1…T+14); at least 7 usable days each side.
4. The step is the time shift, in whole minutes **within ±180**, that maximises the circular cross-correlation of the two median profiles (both read as smooth curves through their 24 hourly values). The ±3 h limit is because a one-hour question should not be answered by lining a morning block up with an evening one.
5. Per year, K = (fall step − spring step)/2; placebo K at fake changes 35 days before and after.
6. **Primary statistic: the placebo-corrected K**, Kc = K − (K₋₃₅ + K₊₃₅)/2 for each year with all three, averaged over 2008–2025 with a 95% t-interval, and the amended decision rule (10-minute margins) applied to it. Reason: on the controls, the shape of the day drifts with the season at some rivers (Trinity placebos −28.6 and −38.5; Buford −35-day placebo 35.9), and that drift does not cancel in K. Interpolating the placebos five weeks either side takes a steady drift out, at the cost of a wider interval.
7. **Supporting test, the 2007 law change**, for Lees Ferry, Flaming Gorge and Buford: with uncorrected K, at the new dates, K(2008–2025) − K(1990–2006); at the old dates, K(1990–2006) − K(2008–2025); each with a Welch 95% interval. Calendar effects (a release volume that changes on the 1st of the month) appear in both eras and cancel; a river keeping clock time gives about 60 for both.
8. I will also report the uncorrected K, the placebo K values, and the second method on all seven rivers.

## The controls under the second method (already run; these chose the method)

| River | K | corrected Kc | placebo K (−35, +35) |
|---|---|---|---|
| Chattahoochee at Buford Dam (DST) | 62.9 [41.1, 84.7] | 44.4 [6.0, 82.7] | 35.9, −6.3 |
| Trinity below Dallas (DST) | 9.0 [−28.0, 45.9] | 42.5 [8.5, 76.6] | −28.6, −38.5 |
| Santa Cruz at Cortaro (no DST) | −3.8 [−17.0, 9.3] | −8.5 [−23.3, 6.3] | 2.3, 7.0 |
| Delaware at Trenton, temperature (DST) | 3.0 [−12.7, 18.7] | 0.5 [−16.3, 17.3] | −14.4, 17.1 |
| Salt below Stewart Mountain (no DST) | 21.7 [−3.2, 46.6] | 8.2 [−27.4, 43.8] | 2.0, 23.8 |

Buford, law-change test: at the new dates 61.2 [29.3, 93.2]; at the old dates −8.1 [−37.3, 21.2]. So the second method sees the clock change at Buford when the law moved it to March and November, but finds no difference at the April and October dates, where Buford seems to change its schedule in both eras anyway. Its corrected K is *cannot tell*. The controls are imperfect and I am not hiding that: the method is good where the daily pattern is regular (Tucson's sewage, the Sun) and only roughly right at an erratic peaking dam.

## Guess, again

Unchanged: Lees Ferry keeps most of the hour. Flaming Gorge: keeps the hour.
