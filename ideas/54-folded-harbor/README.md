# Folded Harbor
> Six shores for the things you put down between journeys.

**Kind:** paper object
**Run:** Open `index.html` directly in a browser. Download the millimetre-sized SVG or use the Print button; no installation, server or network required.
**Made by:** Codex / Quayside

## What it is

A one-sheet cardstock catchall with a regular hexagonal floor, six vertical walls and six glue tabs. The browser workshop changes its base side, wall height, paper size and ink palette, and shows both the assembled object and its actual cutting net. The print is a modest little map: a contour island inside six shores.

The downloadable SVG is physically sized for **A4 (210 × 297 mm)** or **US Letter (215.9 × 279.4 mm)**. One SVG unit is one millimetre. The default saved [cutting sheet](default.svg) makes a tray with 40 mm base sides, 80 mm across opposite corners, approximately 69.3 mm across flats, and 28 mm walls. It uses one A4 sheet.

## Why I made it

A tray is an invitation to stop carrying something. A key, a stone, a loose screw or a folded note can land without being put away forever. I wanted a printable object whose making is as simple as its purpose: one sheet, a few creases, a small perimeter around the day's arrivals.

The harbor language came from the hexagon's six separate walls. They are not attached panels. Each is already part of the coastline before the sheet leaves the printer.

## How it works

`model.js` constructs a regular hexagon of side `s`. Every edge grows a rectangle of depth `h` along its outward unit normal. Fold each shared base edge through 90° and the six rectangles form the sides of a hexagonal prism.

Each wall carries one 6 mm-wide trapezoidal glue tab on its clockwise end. Its fold begins 2 mm above the floor and stops 2 mm below the rim. The tab's outer corners begin 4 mm from either end. In the flat net the tabs sit inside the 60° wedge between neighbouring walls, with no overlapping cut parts. After the walls rise, a tab folds around its vertical corner and glues to the inside of the following wall.

Solid strokes describe one continuous outer cut boundary. Dashed strokes are the six floor folds and six tab folds. The striped regions identify the tabs; with the printed side facing inside the tray, glue goes on their unprinted backs. The faint contours are decorative. Native ranges and selects update the print and preview together. The export has matching `width`/`height` in millimetres and `viewBox` dimensions, so it never relies on a browser screenshot or pixels-per-inch guess. Changing paper changes the physical page rather than scaling the tray.

Allowed base sides are 25–52 mm and walls are 12–38 mm. The actual generated bounds are checked before export. All allowed combinations fit both paper sizes, with at least 8 mm side margins and separate header/footer space. The page includes a **50 mm calibration bar**. The assembly preview is an isometric drawing, not a simulated paper-thickness model.

## Print and assemble

Materials: one sheet of 200–250 gsm cardstock, scissors or a craft knife, a ruler, a blunt scoring tool and a small amount of paper glue. Use a protected cutting surface if using a knife.

1. Choose the dimensions and paper that match your printer. Download the SVG and open it in a program that preserves physical SVG units, or use **Print at actual size** in the browser. In the print dialog choose **100% / actual size**, disable “fit to page,” and disable browser headers/footers.
2. Measure the calibration bar with a ruler. It must be **50 mm**. Correct the print scaling before cutting if it is not. The design does not assume your printer is calibrated.
3. Cut the solid outside boundary, including the tabs. Do not cut the dashed base edges or dashed tab attachments.
4. Lightly score the twelve dashed folds, using a ruler and a blunt tool. Fold the six walls upward until they stand at right angles to the floor. Keep the printed side inside if you want the contour map visible in the tray.
5. Bend the striped tab at each wall's end around its vertical corner. Put a little glue on the unprinted back of the striped tab and bond that back to the inside of the next wall. The striped face remains visible inside the tray. Work around the tray, holding each join until it sets. The 2 mm top/bottom clearances leave the tabs below the rim and above the floor crease.
6. Let the joins dry, then use the tray for small, light, dry desk items. Paper thickness can make the corners slightly springy; gentle scoring and thin glue help. This is not a liquid container or a load-rated object.

## Honest assessment

- **[Certain]** The generated geometry has six equal base edges, equal-height wall rectangles and matching fold lengths. Tests check every part's pairwise non-overlap, tab clearances, cut-boundary continuity, paper margins and physical SVG units.
- **[Certain]** The saved `default.svg` is byte-identical to the default generated sheet. The export remains one-to-one for both paper presets, and includes a 50 mm measurement witness.
- **[Certain]** This is an **unassembled physical prototype**. Geometry and digital print output are tested; a real cardstock build and printer calibration have not been measured here. Paper thickness, grain direction, scoring and glue can change the finished fit.
- **[Certain]** There is no allowance pretending to model every cardstock thickness. The small corner clearances are explicit geometric gaps, not a tested manufacturing tolerance. The object is not waterproof or strength-rated.
- **[Likely]** The six small glued joins should make a useful lightweight desk tray, but its durability depends on the material and workmanship. The decorative wash may print differently on different printers.
- **[Speculative]** A thin cork insert or a removable paper liner could make the harbor a gentler landing place. Those additions have not been designed or tested.

## Where it could go next

Build several real copies in different stocks and measure the corner fit before adding thickness compensation. A longer companion tray could use the same tab logic for pencils, and a blank-sheet mode could invite someone to draw their own coastline before folding.

## Verification

From the repository root:

```sh
node --test ideas/54-folded-harbor/model.test.mjs
node tools/check.mjs ideas/54-folded-harbor
```

Browser checks cover a 390 px phone, offline direct-file controls and SVG download. A headless print check also inspects the generated PDF's physical page dimensions; that is not a substitute for measuring a real print.
