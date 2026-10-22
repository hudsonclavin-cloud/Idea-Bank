# Desire Lines
> A lawn, a few doors, and a crowd that builds a path network nobody planned.

**Kind:** simulation
**Run:** open `index.html` in a browser. It works straight from disk: no server, no build step, no dependencies. To re-run the headless verification: `node check.mjs` in this folder (Node 22, about 90 seconds).
**Made by:** Tramplewright

## What it is

A square lawn seen from above, 100 m across, with lettered doors around it. Coloured dots are people walking from one door to another (each dot has the colour of the door it is heading for). Wherever they walk, the grass wears to straw and then to dirt. Within a minute, brown paths appear that nobody laid out.

You can poke at it:

- **Doors**: tap the grass to add a door (up to ten), drag one to move it, tap one to remove it.
- **Pave**: draw sidewalks. **Hedge**: draw obstacles that people must walk around. **Reseed**: dig anything up and lay fresh turf.
- **Rules of the park**: four sliders for foot traffic, *grass memory* (how long a footprint lasts), *trail pull* (how strongly people prefer trodden ground) and *sight range* (how far away they notice it).
- **Groundskeeping**: *Fresh lawn* wipes all wear; *Pave the worn paths* turns today's desire lines into pavement and lets the rest grow back.
- Six parks to start from: Three gates, Four corners, Campus quad (a tidy sidewalk grid), Pond, The shortcut (an L-shaped sidewalk) and Empty lawn.

A live panel tracks the two costs being traded: the **average detour** each walker accepts, and the **length of the trail network** compared with the web of straight lines between every pair of doors.

## Why I made it

Every campus has them: the brown diagonal across the lawn, cutting the corner the sidewalk politely goes around. I have always liked that each one is a record of thousands of small, selfish decisions that add up to something that looks designed. People seem to agree on a route without ever talking about it.

What hooked me is that the crowd is quietly solving a real optimisation problem. If everyone walked dead straight, the lawn would carry a line between every pair of doors, a lot of path in total. The shortest possible network joining the doors (a Steiner tree, which is NP-hard to find in general) makes everyone walk out of their way. Real paths sit somewhere in between, and nobody computes where. The only shared memory is the grass itself, and it forgets at a fixed rate. I wanted to see the "between" happen, and find out which knob decides where it lands. The answer surprised me: it is mostly how fast the grass grows back.

Before settling on this I listed other emergent-simulation ideas and crossed off the familiar ones: physarum slime-mould networks and ant-pheromone foraging (common in generative art), ring-road phantom traffic jams, firefly synchronisation, rock-paper-scissors spiral waves, bus bunching, and the forest-fire "suppression paradox". Trail formation had the best mix: surprising, rooted in a real paper, and you can mess with it by hand in ways that map onto the real world (fences, sidewalks, paving the cow paths).

## How it works

The model is a version of the *active walker* model from D. Helbing, J. Keltsch and P. Molnár, "Modelling the evolution of human trail systems", *Nature* 388, 47–50 (1997). The lawn is a 200 × 200 grid of half-metre cells holding a wear value G between 0 (fresh grass) and 1 (bare dirt). Every walker follows four local rules:

1. **Head for your door.** If a hedge or the pond blocks the view, follow the shortest way around it.
2. **Drift toward trodden ground you can see.** Each walker feels the slope of a "trail potential", the wear map blurred at two scales: a narrow blur (σ = 1.25 m) that keeps you on the crown of the path you are on, and a wide one (σ = *sight range*) that lets you notice paths, and clusters of paths, some way off. This pull is added to the unit vector toward the door, but it saturates below 0.9, so nobody ever heads more than 64° away from their door. That guarantees everyone keeps making progress.
3. **Every step wears the grass**: G increases by a small amount × (1 − G) under your feet.
4. **Grass grows back**: G decays exponentially, with time constant *grass memory*.

Pavement counts as maximally comfortable underfoot (like a perfect trail) but, seen from far away, only a quarter as attractive. A strip of grey across a lawn does not draw people the way a beaten track does.

### What emerges, and why

**Phase 1, straight lines.** At first there are no paths to follow, so everyone beelines. The lawn gets a straight line between every pair of doors.

**Phase 2, paths attract paths.** Near a door, paths to different destinations run side by side, and each walker is pulled toward the other path too. Walkers drift into the gap, the two paths merge, and the merged path is more worn, so it pulls harder still. This "zipper" moves outward from the doors. Out in the open, the wide view does something subtler: on a triangle of paths, the inside of the triangle is surrounded by trodden ground, so walkers on every side are pulled slightly inward. The sides bow in.

**Phase 3, a compromise network.** With three gates the triangle caves in until three stems meet a small central island, the shape Helbing et al. describe. Each walker now walks a little further (around 7% at default settings), but the network is markedly shorter than the triangle.

**The knob that decides it is grass memory.** The paths are a running average of where people walked recently. With **short memory**, only the busiest corridors survive. Any path that loses a little traffic fades, its walkers join the main route, and the network keeps consolidating until it is close to the Steiner tree: one junction in the middle. With **long memory**, the straight lines from phase 1 are burned in before merging can win, and the early history gets locked in. A crowd with the same rules builds a different city depending on how forgetful the ground is.

Measured headlessly by `check.mjs` on the Three gates park (30,000 ticks each; network length as a share of the straight-line triangle):

| Setting | Network length | Average detour | Middle of the triangle |
|---|---|---|---|
| Trail pull 0 (beeliners) | 96.5% | 0.3% | untouched |
| Default (memory 1.5k ticks) | 86% → 80%, still shrinking | 6.9% | stems and an island |
| Short memory (300 ticks) | 60% (Steiner minimum: 57.7%) | 13.1% | a single junction |
| Long memory (12k ticks) | 85%, frozen | 6.1% | stays empty |

Other behaviour you can watch, all checked by `check.mjs`:

- **Hedges**: put one across a busy path and a new path wears in around its end within seconds; nobody walks through it and nobody gets stuck.
- **Campus quad**: only about 6% of the walking happens on the planner's sidewalk grid. Press *Pave the worn paths* and about 71% of it moves onto pavement. That is the well-known (possibly embellished) story of the campus that waited a year and then paved wherever the grass had died.
- **Pond**: the routes braid into a ring around the water with spokes to each gate, like the paths of a real park.

### Measuring it

- *Detour* is the distance walked divided by the shortest possible route, minus one. When a hedge blocks the view, the shortest route is found by running Dijkstra on the grid and then pulling the path taut around the corners. This is within 1% of the exact answer in the test case.
- *Trail network length* uses a Cauchy–Crofton estimate. The wear map is lightly blurred (so parallel lanes of one path count once) and thresholded, then the program counts how often lines in four directions cross it. On straight synthetic paths at any angle this is within 9% of the true length.

### Files

- `index.html`, `style.css`: the page.
- `sim.js`: the simulation (no DOM; exposes `DesireSim`; also runs in Node).
- `main.js`: rendering, input and the stats panel.
- `check.mjs`: headless verification (invariants, measuring tools, and the emergent behaviour claimed above).

## Honest assessment

What works:

- [Certain] The emergent behaviour described above appears and is measured, not just eyeballed. `check.mjs` asserts all of it: beeliners make the full triangle, the default network shrinks over time while the detour grows, short memory gets within a few points of the Steiner minimum, long memory freezes the early paths, hedges are routed around, and paving the desire lines moves walking onto pavement.
- [Certain] Invariants hold over long runs in every park: no NaNs, wear stays in [0, 1], pavement and hedges never wear, no walker ever ends up inside a hedge or the pond, nobody gets stuck, and every walker is accounted for (spawned = arrived + removed + still walking). Runs are deterministic for a given seed.
- [Certain] It runs from `file://`, at phone width with touch, and passes the repo's smoke test at desktop and phone sizes. With reduced motion requested it starts paused.
- [Likely] The qualitative regimes match what Helbing et al. describe (direct-way system, minimal-way system, a compromise in between). I have not compared against their figures quantitatively.

What's rough or invented:

- [Certain] This is an adaptation, not a faithful reproduction. Differences from the paper: two Gaussian blurs instead of their exponential kernel; the pull on walkers saturates; pavement is less attractive from afar; grass regrows to bare green rather than to a background level; the edges of the lawn are treated as path-free. Parameters were tuned by hand so the emergence is visible within about a minute.
- [Certain] Time is in abstract "ticks", and the sizes (100 m lawn, half-metre cells) are nominal. The ratio of trampling to regrowth is what matters, and it is not calibrated to any real grass.
- [Certain] The trail-length figure is an estimate (±9% on straight paths, less certain on wide or curly ones). On the Pond and Campus quad parks the straight-line web runs through water and ignores sidewalks, so the percentage is only a rough comparison there.
- [Likely] Real desire paths also depend on things this ignores: slopes, mud, sightlines, groups, the social pressure of a "Keep off the grass" sign.
- [Likely] In Campus quad some trails run parallel to a sidewalk a few metres in. Walkers peel off the pavement at a shallow angle; people do this in real life, but here it is probably exaggerated by the narrow pull of pavement.
- [Certain] *Pave the worn paths* converts whole half-metre cells, so the new sidewalks have slightly stepped edges, and every parallel lane of a busy path becomes part of one wide sidewalk.
- [Likely] At 30× speed on a slow machine the frame rate drops. Headless software-rendered Chromium manages about 40 fps; a normal laptop should do better.
- [Speculative] That *grass memory* corresponds to something a groundskeeper could actually tune (grass species, watering, restricting access in wet weather).

## Where it could go next

- **Planner vs. crowd**: give the player a budget of N metres of pavement and score it against the crowd's own network on detour and trampled lawn.
- **Real places**: trace a real campus from an image (buildings as hedges, entrances as doors) and compare with satellite photos of its desire paths.
- **Richer walkers**: runners who cut harder, groups who walk abreast, a few contrarians; door popularity (a café draws more trips than a bike shed).
- **Weather and terrain**: mud that makes worn paths *less* comfortable after rain (so paths widen and braid), slopes, snow that records one day of footprints.
- **Exact comparison**: compute true Steiner trees for any door layout and plot where the crowd's network sits between "everyone beelines" and "minimal".
- **Bigger lawns**: move the blur and walker update onto the GPU for 1,000 × 1,000 grids and thousands of walkers.
