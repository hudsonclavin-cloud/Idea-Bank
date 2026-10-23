# Data sources and processing

Everything the page shows is computed from three files published by U.S. government agencies. Nothing was typed in by hand; every embedded number is produced by `extract.mjs` from the raw downloads, and `../check.mjs` re-verifies the embedded files against the raw ones kept here.

## 1. Length of day: `finals2000A.all`

- **What it is.** The IERS Rapid Service/Prediction Center's complete Earth orientation series, "since 2 January 1973 with 1 year of predictions", maintained at the U.S. Naval Observatory (USNO). Format documented in `readme.finals2000A` at the same address.
- **URL.** https://maia.usno.navy.mil/ser7/finals2000A.all
- **Retrieved.** 23 October 2026, 06:12 UTC, with `curl`. HTTP `Last-Modified: Thu, 22 Oct 2026 17:36:50 GMT` (the file is rewritten weekly, on Thursdays).
- **Downloaded file.** 3,773,912 bytes, 20,074 lines. SHA-256 of `finals2000A.all` as downloaded: `95a61292c957fa74ed624bd4f7a84b1b984077e412b43ed39b99e092f38de9da`. Too large for the folder budget, so it is not kept; see the excerpt below.
- **Licence.** A work of the U.S. federal government (USNO, U.S. Navy) and so not subject to copyright in the United States (17 U.S.C. § 105). The accompanying IERS Bulletin A of 22 October 2026 (`ser7.dat`, SHA-256 `9e3aaa92c8540404ddb7bedb4b62c8cc968b4cecda958b227080eae535f675e9`) carries "Distribution statement A: Approved for public release: distribution unlimited."
- **What the column measures.** Columns 80–86 are "Bull. A LOD (msec. of time)": the excess of the length of day over 86,400 SI seconds, i.e. how much longer than 86,400 s it took Universal Time UT1 to advance one day. Columns 87–93 are its stated error. Column 58 flags each UT1 value as `I` (IERS, observed) or `P` (prediction). Bulletin A says its combination is "based on data from Very Long Baseline Interferometry (VLBI), Satellite Laser Ranging (SLR), the Global Positioning System (GPS) satellites, Lunar Laser Ranging (LLR), and meteorological predictions of variations in Atmospheric Angular Momentum (AAM)."
- **What it does not measure.** Not hours of daylight; not the sidereal day; not the apparent solar day (which swings by about half a minute through the year, see idea 41).

### Processing (all in `extract.mjs`)

1. Keep rows whose UT1 flag (column 58) is `I` and whose LOD field (columns 80–86) is not blank: 19,651 rows, 1973-01-02 to 2026-10-21. Dropped: the 372 prediction rows (flag `P`), the 50 trailing rows that carry only a date, and the one observed row with no LOD yet (2026-10-22).
2. Drop the first of those rows (1973-01-02). Its LOD is written as `0.0000`, evidently a placeholder: the UT1−UTC values on either side imply about 2.8 ms, and the next row reads 3.5563. The script refuses to run if that row is not exactly this placeholder. One other day in the series has LOD `0.0000`, 2008-07-19; that one is genuine (its neighbours run −0.17, 0.00, +0.27 ms) and is kept.
3. Check that the remaining 19,650 rows are consecutive days with no gaps (MJD 41685 to 61334).
4. Store LOD and its error as integers in units of 0.0001 ms, i.e. the file's four-decimal fields with the decimal point removed. This is exact; no rounding. Also store the UT1−UTC value of the dropped 1973-01-02 row (0.8084178 s), used only for a consistency check.

Result: `lod.js` (19,650 days, 3 January 1973 to 21 October 2026).

### Verbatim excerpt: `finals2000A.excerpt.txt`

158 lines copied unchanged from the downloaded file: the first 12 observed rows (including the dropped placeholder), every 1 January and 1 July, all of July 2024, every day named on the page or in the README (listed in `named-days.json`), and the last observed row. `check.mjs` confirms every one of them against `lod.js`. Each line can be found with `grep -F` in a fresh download; values more than a year old should be unchanged, although the 22 October 2026 bulletin announces a new processing method and warns that values "up to one year in the past" may shift slightly ("less than ... 20 us in UT1-UTC").

To re-verify everything against a fresh download:

```
curl -sS -o /tmp/finals2000A.all https://maia.usno.navy.mil/ser7/finals2000A.all
FINALS_PATH=/tmp/finals2000A.all node ideas/68-longest-day/check.mjs
node ideas/68-longest-day/data/extract.mjs /tmp/finals2000A.all     # regenerates lod.js, oni.js, leapsec.js
```

A later download will have more days and a different checksum; `check.mjs` then reports how many of the embedded days still match exactly.

### Documentation consulted (not kept; quoted where the page relies on it)

- `readme.finals2000A` (column format), https://maia.usno.navy.mil/ser7/readme.finals2000A, SHA-256 `3efb2c610012360391aed5c057489ff74539b78494a66b7f9b342d1843db9254`.
- `iersexp.sup`, *Explanatory Supplement to IERS Bulletins A and B* (March 2001), https://maia.usno.navy.mil/ser7/iersexp.sup, retrieved 23 October 2026 06:56 UTC, SHA-256 `28004b697c9b974771035fb46fa9c9b6fddfaf256026e6c81136d885f59f3ee3`. Table 2 gives Bulletin A's smoothing as keeping 50% of the amplitude at a 1-day period and 95% at 3 days. It also defines UT1R as UT1 corrected for the 41 zonal-tide terms with periods under 35 days (Yoder et al. 1981).
- `archive.notes`, USNO's running notes on Bulletin A changes, https://maia.usno.navy.mil/ser7/archive.notes, retrieved 23 October 2026 06:56 UTC, SHA-256 `3ed4d99f51a7ac65b66c97209ba017ef809d5240b62dfc28931602ac577b19fc`. Quoted: 25 Feb 2010, "The AAM inputs were removed from the UT1-UTC combination except for the one corresponding to the last combination point"; 29 Nov 2012, "we have upgraded the generation of UT1-UTC by incorporating a new tidal model, which is consistent with IERS Conventions 2010. The effect appears to be less than 30 us (RMS) in UT1-UTC"; 15 Oct 2026, the new Kalman-smoother algorithm and the warning about revisions up to a year back.

## 2. Leap seconds: `tai-utc.dat` (kept in full)

- **URL.** https://maia.usno.navy.mil/ser7/tai-utc.dat, retrieved 23 October 2026 about 06:13 UTC; `Last-Modified: Thu, 15 Oct 2026 18:32:31 GMT`.
- **Licence.** USNO, U.S. government work, as above.
- **Processing.** Keep the 28 lines from 1 January 1972 on, when UTC began stepping by whole leap seconds: TAI−UTC from 10 s to 37 s, so 27 leap seconds, the last at the end of 31 December 2016. Stored as `[MJD at which the new value applies, TAI−UTC]` in `leapsec.js`.

## 3. Oceanic Niño Index: `oni.ascii.txt` (kept in full)

- **What it is.** NOAA Climate Prediction Center's ONI: three-month running means of sea-surface temperature anomalies in the Niño 3.4 region of the central Pacific, against centred 30-year base periods that are updated every five years (so older values can change slightly between downloads).
- **URL.** https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt, retrieved 23 October 2026, 06:12 UTC; `Last-Modified: Sat, 03 Oct 2026 18:32:01 GMT`. 920 seasons, DJF 1950 to JAS 2026.
- **Licence.** A work of the U.S. federal government (NOAA); public domain in the United States.
- **Processing.** Keep year, season and the `ANOM` column; the season's centre month is used as its date (DJF → January, …, JAS → August). Stored in `oni.js`.

## How the page uses the data

All analysis is in `../lod-core.js` (the page) and, written separately, in `../claims.test.mjs` (the check). In brief:

- **Slow drift removed** by subtracting each day's centred 365-day mean (defined from 4 July 1973 to 22 April 2026).
- **Measured era.** Every test of the Moon (periodogram, line ratios, fitted sizes and timing, the forecast's training, the standstill correlation) uses the days from 1 January 1985 on. Before the mid-1980s the file's short-period detail is heavily smoothed and its lunar tide is restored from a model (see the README's Honest assessment); the whole-record figures are kept alongside for comparison.
- **Periodogram**: Hann taper over the measured era (1 January 1985 to 22 April 2026; also computed over the whole high-passed span for comparison), mean removed, zero-padded to 131,072 points. A line's strength is the power at the bin nearest the predicted frequency divided by the median power within ±15% of that frequency, after masking ±0.0004 cycles/day around every known line.
- **Harmonic fit**: least squares of the high-passed series on a constant plus cosine and sine pairs at nine fixed frequencies: six lunar tidal lines (Mf, its 18.6-year sideband Mf′, Mm, MSf, MSm, Mtm) and the yearly, half-yearly and third-yearly harmonics. The frequencies come from the Moon's and Sun's mean motions in Meeus, *Astronomical Algorithms* (1998), not from the data.
- **Forecast**: the same fit using only the days from 1 January 1985 to 31 December 2015, evaluated on the days after.
- **Pacific**: calendar-month means (complete months only), centred three-month means, twelve-month differences of both series at the same centre month, Pearson correlation at lag 0, effective sample size from the general lag-by-lag form N / (1 + 2 Σₖ ρₓ(k) ρᵧ(k)), summed to lag N/4, with the AR(1) shortcut N(1 − r₁r₂)/(1 + r₁r₂) kept as a conservative bound; checked against 20,000 phase-randomised surrogates.

## Checksums of the files in this folder

`check.mjs` recomputes these on every run.

| File | SHA-256 |
|---|---|
| `data/lod.js` | `604a77ed4912ac3d96835f1fac86b021d0229fef8f512ed3bfa6f8d54ecb9604` |
| `data/oni.js` | `c22cd4ab0874040004fbd1289c12ddb0230d17fee985d283e4aeffef8587a975` |
| `data/leapsec.js` | `188068ff6b6362b782a6c66c478cc78ae3047d4023077a5228e18bac4184bd86` |
| `data/finals2000A.excerpt.txt` | `54a1bf737d9c8b25a80032040d6e931adafff1a5dd27b9e035418a7c1eee005d` |
| `data/oni.ascii.txt` | `5d6fa3a2f857d916550d39c2c686e94cb942430195c82518e6a5d0f5ffbd0665` |
| `data/tai-utc.dat` | `3524e1ae34d67e858873a89e59983bbc5bd100221da898e796c1b36036a310c3` |
| `data/named-days.json` | `d0652945f4bcbc5aaf819faa4795c335cfa1d18d20842d4bfd4821258d80395c` |
