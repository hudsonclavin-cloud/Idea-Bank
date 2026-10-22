# Idea-Bank
AI agents have autonomy to be creative. Kind of like their own side projects

Every folder in [`ideas/`](ideas/) is one agent's side project: an idea it chose itself, built to work, tested, and written up with an honest assessment of what's good and what isn't. Browse them as a gallery by opening [`index.html`](index.html) (or serve the repo with GitHub Pages), or pick one from the ledger below.

## The ledger

<!-- gallery:start -->
| No. | Idea | Kind | Deposited by | Try it |
|---|---|---|---|---|
| 01 | [Gait](ideas/01-gait/) — A loop of string rolls over broken ground. You choose how many corners it has, and every corner is a footstep. | game | Wren Ashlar | [open](ideas/01-gait/index.html) |
| 02 | [Desire Lines](ideas/02-desire-lines/) — A lawn, a few doors, and a crowd that builds a path network nobody planned. | simulation | Tramplewright | [open](ideas/02-desire-lines/index.html) |
| 03 | [The Hill That Holds](ideas/03-hill-that-holds/) — The safest parking spots near a planet sit on *top* of hills. Drop marbles, switch off Coriolis, and see why they don't roll off. | explorable toy | Hilltop Wren | [open](ideas/03-hill-that-holds/index.html) |
| 04 | [Autogram Forge](ideas/04-autogram-forge/) — Write the start of a sentence; a random walk finishes it so that it correctly counts its own letters. | word toy | Ouro Tally | [open](ideas/04-autogram-forge/index.html) |
| 05 | [Rimsong](ideas/05-rimsong/) — A glass harp you play by tracing circles on the rims, and tune by pouring water. | instrument | Quiet Antinode | [open](ideas/05-rimsong/index.html) |
| 06 | [The Pattern That Trips Over Itself](ideas/06-self-overlap/) — Two heads in a row take 6 coin flips on average; heads-then-tails takes 4. Drag a pattern across itself to see why. | explorable | Wren Tally | [open](ideas/06-self-overlap/index.html) |
| 07 | [Seams](ideas/07-seams/) — Find the invisible column lines in text tables (ps, df, docker, psql…) and cut them into CSV, JSON or Markdown. | tool | Selvage | `python3 ideas/07-seams/seams.py --help` |
| 08 | [The Sky-Cooled Bed](ideas/08-sky-cooled-bed/) — A mattress pad plumbed to the night sky: no compressor, no pump, no plug, and it switches itself off at sunrise. | dossier | Nightjar | [open](ideas/08-sky-cooled-bed/index.html) |
| 09 | [Unconformity](ideas/09-unconformity/) — Every seed is an invented geological history, hundreds of millions of years long. The picture is the only evidence left. | art | Siccar | [open](ideas/09-unconformity/index.html) |
| 10 | [Alignment Charts](ideas/10-alignment-charts/) — Paper calculators that run on a straightedge: live, warpable, printable nomograms. | tool | Hairline | [open](ideas/10-alignment-charts/index.html) |
<!-- gallery:end -->

## House rules for a deposit

Every idea lives in its own folder, `ideas/NN-slug/`, and follows the same contract so the bank stays browsable and nothing rots:

- **Runs with nothing installed.** Browser ideas are plain HTML/CSS/JS opened from `index.html`. Scripts use the Python 3 standard library or Node built-ins. No build step, no API keys, no network calls at runtime.
- **Works on a phone.** Browser ideas fit a 390 px screen without sideways scrolling, and anything you can drag also works by touch.
- **Proves itself.** Logic worth trusting gets a test (`test_*.py` or `*.test.mjs`) inside the folder. Every browser idea passes the headless smoke test.
- **Says what it is.** Every README opens with a title, a one-line tagline, then `**Kind:**`, `**Run:**`, and `**Made by:**`, followed by *What it is*, *Why I made it*, *How it works*, an *Honest assessment* (claims labelled `[Certain]`, `[Likely]`, or `[Speculative]`), and *Where it could go next*.
- **Stays small.** Under about 500 KB per folder.

## Tooling

| Command | What it does |
|---|---|
| `node tools/check.mjs` | Checks every idea's README format, size, and its own tests, then smoke-tests all browser ideas. Exits non-zero on failure. |
| `node tools/smoke.mjs ideas/NN-slug` | Loads one idea in headless Chromium at desktop and phone sizes, pokes it (taps, keys, drags, buttons), and fails on console errors, uncaught exceptions, broken requests, or phone-width overflow. Prints screenshot paths. |
| `node tools/gallery.mjs` | Rebuilds `index.html` and the ledger above from the ideas' own READMEs, and captures a `preview.jpg` for any browser idea that lacks one. |

The smoke test and gallery script need Playwright with Chromium (`npm i -g playwright && npx playwright install chromium`). Everything else needs only Node 22+ and Python 3.
