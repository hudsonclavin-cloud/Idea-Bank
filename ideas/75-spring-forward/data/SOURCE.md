# Data source

`rivers.js` is a reduced copy of U.S. Geological Survey instantaneous values, built by
`fetch.mjs` from the USGS Water Data OGC API (`https://api.waterdata.usgs.gov/ogcapi/v0`,
collection `continuous`), retrieved on 23 October 2026. USGS data are in the public domain.
Provisional values were used as published.

| USGS site | parameter | name |
|---|---|---|
| 09380000 | 00060 discharge | Colorado River at Lees Ferry, AZ |
| 09234500 | 00060 discharge | Green River near Greendale, UT (below Flaming Gorge Dam) |
| 09502000 | 00060 discharge | Salt River below Stewart Mountain Dam, AZ |
| 02334430 | 00060 discharge | Chattahoochee River at Buford Dam, near Buford, GA |
| 08057410 | 00060 discharge | Trinity River below Dallas, TX |
| 09486500 | 00060 discharge | Santa Cruz River at Cortaro, AZ |
| 01463500 | 00010 water temperature | Delaware River at Trenton, NJ |

`manifest.txt` lists every request (site, first and last UTC day, number of readings, first 16
hex digits of the response's SHA-256). Each request covers one season of one year. For the three
long-record sites (Lees Ferry, Flaming Gorge, Buford) that means 1990-2025; for the others,
2008-2025.

What is kept, per site (encodings are documented in `rivertime.js`):

- `centres`: for every centre the analyses use (`RiverTime.centresForSite`), the hour-by-hour
  median day of the 14 days before and the 14 after, each day first scaled to unit root mean
  square, at 12 bits an hour; the number of usable days each side; and the coherence of each
  median day.
- `fullSteps`: the second method's step at each centre computed from the unrounded profiles,
  kept only so `data.test.mjs` can check the rounding.
- `runs` (not Flaming Gorge): each day's 24-hour wave (crest time and amplitude) in the 29 days
  around each real clock change of 2008-2025, for the first method. `fetch.mjs --full` also keeps
  the windows around the fake changes 35 days either side.
- `profiles` (Lees Ferry only): every day's hourly shape (6 bits an hour) and mean flow around each
  clock change of 2008-2025, for the page's picture.

`fixtures/` holds responses from both USGS services (the legacy `waterservices` RDB, in local
time with zone codes, with its comment header removed; and the OGC API CSV, in UTC) for 8-9 March
and 1 November 2015 at Buford Dam and 1 November 2015 at Lees Ferry, used by `data.test.mjs` to
check the time handling.
