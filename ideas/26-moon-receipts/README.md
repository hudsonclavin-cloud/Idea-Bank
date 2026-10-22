# The Moon Keeps Receipts
> Leave a tiny earthly moment on an imaginary Moon; come back to find the crater softer and the words still there.

**Kind:** poetic instrument
**Run:** open `index.html` in a browser, directly from disk or served as a static page.
**Made by:** Codex / Selenographic Lost & Found

## What it is

A small fictional lunar archive. Write a moment, choose whether it feels like a kindness, a loss, an ordinary wonder, or something unfinished, and leave it on the Moon. The same words and category always make the same crater, terrain, name, and two-line poem. Move the time slider to soften its rim without erasing the receipt. Save a self-contained SVG of the map and receipt.

The initial deposit is a kitchen light left on. The archive does not rank moments, infer your emotions, or require a moral. The category is yours to choose. Its Moon is invented, its coordinates are illustrative, and its small poems come from a finite hand-written grammar.

## Why I made it

An archive usually asks why a thing matters. I wanted one that declines to ask. The lunar surface offered an appealing image: an old, quiet place where even a small impact gets to remain visible. A receipt is the opposite kind of object, mundane and disposable. Putting them together makes the cosmic feel domestic, and gives the domestic a little dignity.

## How it works

The normalized moment (at most 160 Unicode code points) and selected category feed an FNV-style 32-bit hash and seeded PRNG. Those choose crater coordinates inside a bounded disk, radii, background craters, and a name and two lines from the category's local grammar. Normalization collapses whitespace; capitalization remains meaningful. Hash collisions are possible and there is no claim of a unique persistent archive.

A responsive SVG draws the fictional terrain with deterministic craters, latitude-like guide lines, and a marker for the new deposit. Time is an artistic parameter from 0 to 100: relief depth and visibility decay exponentially while a dashed halo broadens. These are visual rules, not lunar erosion physics. The receipt always preserves the words until you replace them or close the tab.

No network requests, local storage, cookies, or external fonts are used. Export runs entirely in the page and saves an SVG only when asked. The exported quote is XML-escaped; on-screen user text uses textContent. Saving the export creates a copy wherever your browser places downloads, so keep that file as privately as you want the moment kept.

## Honest assessment

- **[Certain]** It runs without a server or installed packages and has no runtime network dependencies. The seven pure-model tests check determinism, normalization, geometry bounds, monotonic visual ageing, XML escaping, export repeatability, and long Unicode export wrapping.
- **[Certain]** There is no persistence across reloads. “Archive” is the artwork's metaphor; the downloadable receipt is the actual keepsake. The moment is not sent anywhere by this project.
- **[Certain]** Neither terrain nor coordinates represent Earth's Moon, and the time slider has no physical units. User category selection does not constitute emotional analysis.
- **[Likely]** The contrast between a quiet Moon and a paper receipt gives small moments some space. A finite grammar also means repeated phrases and occasional awkward fit.
- **[Speculative]** With a larger collection of carefully authored fragments, an archive of several moments might feel like a personal night sky rather than a generator. That is not implemented.

## Where it could go next

An explicitly opt-in local album, a printable folding receipt, and a hand-authored soundscape made from household noises. A future persistent mode should clearly explain storage and provide an easy erase function.

## Verification

Run `node --test ideas/26-moon-receipts/model.test.mjs` from the repository root. The browser smoke test is `node tools/smoke.mjs ideas/26-moon-receipts`.
