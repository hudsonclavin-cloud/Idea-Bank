# Dividers
> A pair of dividers walks a sheet of graph paper, one quarter turn at a time, and must prick every mark. Each leg can only ever reach half the squares.

**Kind:** puzzle
**Run:** open `index.html` in a browser (plain scripts, works from `file://`; no server, build or network). Tests: `node --test ideas/17-dividers/dividers.test.mjs` from the repo root (Node 18+).
**Made by:** Quarter Pike

## What it is

A puzzle game with one rule. You are a pair of dividers (the drafting tool: two legs on a hinge) standing on graph paper with its legs in two adjacent squares. **One move plants one leg and swings the other a quarter turn around it.** The swinging leg lands on the square beside the planted leg, and on its way it passes through the corner square diagonal to the planted leg, so that corner has to be clear. Prick every mark on the sheet and the level is solved.

Three kinds of thing sit on the paper:

- **Pins** block a leg from landing *and* block any swing that passes through their corner.
- **Holes** block a leg from landing. A leg may swing over them.
- **Marks** are pricked when a leg lands on them.

Fifteen levels. The first nine each teach one thing (you can swing either leg; the far leg can hop over the near one; a pin in the corner stops a swing; a one-wide gap is a wall; a hole stops landing but not swinging; a mark in a nook is reachable only if the squares beside it are holes; four marks round one square want a planted leg in the middle; three squares in an L are enough to climb a staircase of holes). The last six are the puzzles proper: every pin and hole in them matters, and each has one or two shortest solutions.

Each level shows its **par**, which is the length of the shortest solution the built-in solver finds when the level loads. The game doesn't require par: pricking all the marks is the win, par is the mark of a clean solve. Undo (`Z`), restart (`R`), a level picker (`L`), and progress saved in `localStorage` when it's available. Touch: tap a landing dot, or drag a leg to one. Keyboard: `←` `→` swing the ringed leg, `Tab` switches legs. Sound (a tick, a prick, a rising chime per mark, a chord at the end) is synthesised after your first input and can be muted with `M`.

The thing you may notice around level 5, and the game never states outright: the coral leg only ever lands on the faintly warm squares and the blue leg only on the cool ones. That is the parity invariant below, and once you see it the later levels read differently: a mark beside the blue leg may be coral's job, and you plan who goes where before you swing.

## Why I made it

I wanted a movement rule where the body you control doesn't translate at all, only pivots, and where the constraint is *geometric* rather than a list of tile types. Rolling-block and sliding puzzles move a thing through space; here the thing never moves, it steps, and every step is a quarter circle whose interior matters. A pair of dividers "walking" across a chart (navigators step off distances this way) was the picture in my head.

The reason I kept it after the first prototype is the checkerboard fact. A leg at pivot + d swings to pivot + d′ with d′ perpendicular to d, so d′ − d has two odd components and x + y changes by an even number. Each leg is stuck on its own checkerboard colour forever, which means the two legs partition the sheet between them and a mark's colour decides which leg must prick it. The rule never says so, and the board only hints at it with a tint, yet it falls out of the quarter turn with two lines of algebra. That is the kind of secret I like a puzzle to have: fully provable, entirely learnable by feel.

Candidates I listed and crossed off before this one: a hinged three-cell chain (more states, less clarity), a stick that also slides (just a domino), paper-strip folding (provable, not much to feel), a rubber band on pegs (lovely to feel, hard to prove), shadows as the only walkable ground (a Sokoban cousin once you push blocks), and the usual suspects the brief already ruled out.

## How it works

**Rules (`rules.js`).** A level is a grid of floor, pins and holes with marks on floor squares and the two legs on adjacent floor squares; squares off the sheet count as pins. A state is (coral square, blue square, set of pricked marks). From any state there are at most four moves: each leg can swing clockwise or anticlockwise around the other. A move is legal when the landing square is floor (marks are floor) and the corner square between the old and new positions is not a pin. Pricking is a side effect of landing. Every move has an inverse (swing the same leg back the other way), and the inverse is always legal because it needs the same three squares, so the game has no dead ends: from any position the player can reach, every mark is still reachable. The tests check this by brute force on every level.

**Levels (`levels.js`).** Levels 1–9 were drawn by hand around one lesson each. For levels 10–15 I drew skeletons (a pond, a meadow, a scatter of marks), let a generator fill in holes and pins at random, kept fills with a long par and at most two shortest solutions, and then ran a minimiser that deletes any pin or hole whose removal leaves par and the solution count unchanged. What remains is the puzzle with nothing decorative in it: the tests assert that removing any single obstacle from a puzzle level, or softening a pin into a hole, changes the par or adds a par solution.

**Solver (`solver.js`).** Breadth-first search over states, which also counts the number of distinct shortest solutions and the number of distinct states reachable within par (the positions a player can be in without having already lost par). The page runs it when a level loads (all fifteen take about 40 ms in Node), so the par shown is computed, not stored.

**Difficulty.** I report `difficulty = par + log2(states within par ÷ par solutions)`: the length of the dance plus a haystack term, how many positions are available inside the move budget against how many of them are needles. It is a proxy, not a measurement of a human (see below). The table is what the tests check, number for number, against both the shipped solver and an independent search written from the rules in prose:

| No. | Level | Sheet | Marks | Par | Par solutions | States within par | Reachable states | Difficulty |
|---|---|---|---|---|---|---|---|---|
| 1 | Swing | 5×5 | 2 | 2 | 1 | 15 | 140 | 5.9 |
| 2 | Hop | 5×5 | 1 | 2 | 2 | 13 | 76 | 4.7 |
| 3 | Walk | 6×5 | 2 | 9 | 5 | 81 | 184 | 13.0 |
| 4 | Corner | 5×5 | 1 | 3 | 1 | 12 | 69 | 6.6 |
| 5 | Hollow | 6×4 | 2 | 7 | 1 | 62 | 106 | 13.0 |
| 6 | Gap | 6×5 | 1 | 13 | 32 | 36 | 75 | 13.2 |
| 7 | Nook | 8×4 | 1 | 3 | 3 | 18 | 75 | 5.6 |
| 8 | Rosette | 7×6 | 4 | 8 | 30 | 172 | 1008 | 10.5 |
| 9 | Stair | 5×5 | 1 | 7 | 2 | 14 | 27 | 9.8 |
| 10 | Garden | 7×7 | 3 | 17 | 1 | 243 | 442 | 24.9 |
| 11 | Islands | 7×7 | 3 | 21 | 1 | 211 | 327 | 28.7 |
| 12 | Meadow | 9×5 | 4 | 23 | 2 | 348 | 476 | 30.4 |
| 13 | Lily pads | 7×7 | 5 | 25 | 1 | 944 | 1920 | 34.9 |
| 14 | Pond | 7×7 | 5 | 26 | 1 | 529 | 670 | 35.0 |
| 15 | Star chart | 8×8 | 5 | 28 | 1 | 860 | 1176 | 37.7 |

The curve is deliberately two-tiered. Lessons 1–9 stay at or below difficulty 13.2 and par 13, with breathers at 2 (Hop), 4 (Corner) and 7 (Nook), each a two- or three-move demonstration of one rule. Puzzles 10–15 rise strictly in both par and difficulty, and every one of them is above every lesson.

**Degenerate strategies.** Swinging only one leg spins the dividers in place (four squares reachable) and solves nothing except Hop and Corner, whose lessons are exactly one leg swinging round the other. A greedy player who always takes the swing that lands nearest to the nearest unpricked mark reaches par on 6 of the 15 levels, all of them lessons, and never finishes any of the six puzzles at all within four times par. The tests run both.

**Page (`game.js`, `style.css`).** SVG board; the swing is a 230 ms eased rotation of the moving leg around the planted one, with the leg lifting slightly off the paper and its arc inked onto the sheet as it goes, so a finished level leaves a drawing of its own solution. Landing gives a ripple and a tick; a prick blooms the mark in the leg's colour with a note that climbs a pentatonic scale; the solve lights the whole trail gold. Tapping where a leg *cannot* land explains why: the blocking pin or hole shakes and a one-line toast says what it did. Input is accepted during an animation (the previous swing snaps to its end), so fast play never waits. With `prefers-reduced-motion` all of this is instant. Light and dark schemes; phone width without horizontal scroll.

**Verification (`dividers.test.mjs`, 12 tests).** The parity invariant by algebra and by brute force over every reachable state of every level; reversibility of every move from every reachable state, and that every reachable state can still reach the goal; every level solvable in at least two moves; the solver's solution replayed move by move through the rules engine to a win; an independent search (its own parser, move rule and BFS, written from the prose) agreeing with the shipped solver on par, solution count and both state counts for every level; the README table matching the solver number for number; the two-tier difficulty claim; obstacle minimality for levels 10–15; the two degenerate strategies; and, for each lesson, a check that the lesson is real (for example, removing Corner's pin drops par from 3 to 1; replacing Nook's holes with pins makes it unsolvable; Rosette's last three swings share the hub as pivot).

## Honest assessment

- [Certain] All fifteen levels are solvable, with the pars in the table, found by two independently written searches that agree on every number. `node tools/check.mjs ideas/17-dividers` and `node tools/smoke.mjs ideas/17-dividers` pass (desktop and phone, no console errors, no phone-width overflow).
- [Certain] The parity invariant holds (each leg keeps its checkerboard colour) and the game has no dead ends: every move is reversible and the goal is reachable from every reachable state of every level.
- [Certain] A headless Playwright run played every level through the real page by tapping landing dots (phone, touch, reduced motion), played levels 1–6 by keyboard (desktop), and exercised undo, restart, level select, the blocked-move feedback, and a run with `localStorage` throwing. No errors in light or dark schemes.
- [Likely] Levels 10–15 are genuinely hard rather than merely long. Each has one or two par solutions in a space of several hundred positions, every obstacle is load-bearing, and greedy play never finishes them. But difficulty here is a solver's proxy, not a human's; a person might find Lily pads easier than Garden because its symmetry suggests the dance.
- [Likely] The lessons teach what they say. Each is tested to depend on its rule (the pin, the hole, the nook, the hub), but whether a person *notices* the rule from the level, rather than from the hint under the board, is unverified.
- [Speculative] The parity insight lands as an "aha" rather than as a frustration. The board tints the two colours very faintly and nothing names it. That felt right to me; a player who never sees it will experience some marks as arbitrarily unreachable until the dots teach them by elimination.
- No human has played this. Pacing, the 230 ms swing, the dot sizes on a phone, and the sound levels were tuned from screenshots and headless runs only.

Rough edges: the difficulty number is a convenience, not a validated model, and the level order among 10–15 follows it; the level hints occasionally give away the idea too plainly; there is no "perfect every level" ending beyond the level picker turning gold; the sound is simple synthesis and was never heard on a real speaker; dragging a leg works but is undiscoverable, tapping dots is the intended control.

## Where it could go next

- **More sheet furniture, carefully.** A pin you can pull out and re-plant (a one-shot bridge for a swing), or a mark that must be pricked by a named leg, would add constraint types without touching the one rule.
- **A daily sheet.** The generator plus the minimiser produce clean puzzles in seconds; a seeded daily level with par and a shareable trail drawing is a small step.
- **Difficulty from people.** Log moves-over-par and undo counts per level (locally) to see whether the solver's proxy matches where players actually stall, then reorder.
- **A longer stick.** A three-square leg span sweeps a bigger arc with a two-cell corner region; the parity invariant survives for any span and the sheet geometry gets stranger.
- **Print it.** The trail of a solved level is a rosette of quarter circles; the win screen could export it as an SVG you can plot.
