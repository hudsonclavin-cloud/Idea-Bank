# Gait
> A loop of string rolls over broken ground. You choose how many corners it has, and every corner is a footstep.

**Kind:** game
**Run:** open `index.html` in a browser (no server or build step needed). Add `?seed=123` to the URL for a repeatable course. Rule tests: `node ideas/01-gait/test/logic.test.cjs` from the repo root.
**Made by:** Wren Ashlar

## What it is

You are a closed loop of string, 6 m around, rolling to the right on its own. You can't steer, jump or slow down. The only thing you control is how many corners the loop has: 3, 4, 5 or 6.

A rolling polygon tips over one corner until the next corner hits the ground, so each corner is a footstep and the stride is one side length. With a fixed 6 m of string, a triangle strides 2.0 m, a square 1.5 m, a pentagon 1.2 m and a hexagon 1.0 m. The ground is full of holes. If a corner lands in a hole, you fall in.

The catch is timing. A new shape only takes effect from your next footstep, because the step you're tipping through is already committed. Dotted arcs show where your next corners will land with the shape you've selected: a red cross means a hole. So you're always choosing where your feet go one step before they get there.

- **Controls:** keys `3` `4` `5` `6`, or `↑`/`↓` (also `W`/`S` or the mouse wheel) to add or remove a corner. On a phone, tap the four shape buttons. `Space` starts and restarts, `P` pauses, `M` mutes.
- **Scoring:** 1 point per metre. Land a corner exactly on a gold chime for 10 points × your chain (up to ×5). Stepping over a chime without touching it breaks the chain. Landing on the very lip of a hole is safe and worth +5. A single post between two holes is worth +10.
- **Progression:** speed and hole density rise over the run (100 m takes about 30 s; 1 km takes about 3 minutes). Your best distance is saved and planted as a flag on later runs. When you fall, the card tells you exactly what went wrong: which shape would have saved you, or that the mistake came a step earlier, because you'd already landed in a trap.

## Why I made it

I wanted a mechanic where you don't control the body, only its *shape*, and where the shape has real physical consequences you can learn to feel.

Rolling polygons gave me that. Watching a square tumble, I realised its corners are its feet, so changing the number of corners changes its gait. Then I fixed the perimeter instead of the size, and two things fell out that delighted me:

1. **Speed doesn't depend on shape.** A loop always covers its own perimeter per full turn, whatever shape it's in. Change shape and you keep the same pace but get a different *rhythm*: triangles clomp, hexagons patter. The game is about where your feet land, not how fast you go, and that is what walking over rough ground is actually like.
2. **Sixty is the magic number.** 60 is the smallest number divisible by 3, 4, 5 and 6, so a 60-unit loop gives strides of exactly 20, 15, 12 and 10 units. Every footstep lands on a whole unit, the rules are exact, and a hole either catches a corner or it doesn't. No physics fudge.

Other ideas I wrote down and set aside: a moiré "lever" (phone screens alias their own moiré, so it would break on half the devices), steering the calm lines of a two-source interference pattern (too close to the explorable and sound neighbours), steering a spinning top by gyroscopic precession (strange controls tend to feel unfair rather than masterable), a taut-string geodesic puzzle (too static for five minutes of play) and a "shape the orbit, not the ball" Lissajous dodger (too close to the orbital lens).

## How it works

**The roll.** Each step rotates the loop about its pivot corner by the exterior angle 2π/n. The step lasts stride/speed = 60/(n·v) seconds, so the angular speed is 2πv/60 for *every* shape (the property above, and it's checked in the tests). The angle is eased slightly so the loop tips slowly and then falls onto its next side, with a squash, dust and a note on impact.

**The morph.** Every shape is stored as 60 points, one per unit of string, starting at the pivot corner. Because all four shapes have the same perimeter, point *k* of a triangle and point *k* of a hexagon are the same bit of string. Blending them point by point is a morph that looks like a loop being re-tensioned around the corner it stands on, not like two pictures cross-fading.

**Commit and grace.** The shape for a step is locked the instant the previous corner touches down. To forgive slightly late fingers, a change made within 85 ms after a touchdown still applies to the step that just began (the window shrinks to 30% of a step at top speed). Past that window it waits for the next step.

**Fair holes (the core of the design).** Holes are open intervals on the integer line, so their lips are solid. When the course is generated, a backward dynamic programme labels every spot *viable* (some sequence of shapes survives forever from here) or *doomed*. For doomed spots it also counts how many more safe footsteps are possible before you must fall. Any hole that would create a doomed spot more than one safe step deep is rejected or shrunk. In play:
- every trap springs within two footsteps, so it's at most 4 m beyond the spot you're choosing to land on;
- you choose that spot at most 4 m ahead of you, so seeing 8 m ahead is always enough to avoid every death;
- phones show about 9.2 m ahead of the loop and desktops about 22 m.

Traps are deliberate, though. A player who only checks "does my next corner land on ground?" gets trapped on every test course, so reading two steps ahead is the skill the game teaches.

**Chimes** are placed only on viable spots, weighted toward lips and lone posts. The game-over explanation reuses the same viability table to tell you whether another shape would have saved you or whether you were already doomed.

**Sound** is synthesised with WebAudio after your first input. Each shape plays a note from a G major chord (G3, B3, D4, G4), so your run plays its own rhythm, and chimes climb a pentatonic scale as your chain grows.

**Files:** `logic.js` holds the rules, course generator and planner (no DOM; loads as a plain script or as CommonJS). `game.js` handles rendering, input, sound and flow. `test/logic.test.cjs` runs headless checks using only Node built-ins.

## Honest assessment

What I verified:
- [Certain] `node tools/smoke.mjs ideas/01-gait` passes at desktop and phone sizes. The page also runs from `file://`, at 60 fps in headless Chromium, with no console errors in light, dark and reduced-motion modes or in portrait and landscape.
- [Certain] 38 rule checks pass: stride arithmetic; well-formed holes; the late-shift grace window; the chime-chain rules; and score = metres + bonuses. A separate audit, which rebuilds the course from the hole list and does not reuse the generator's own tables, finds zero unfair traps on 8 courses of 3 km each.
- [Certain] A 3-step-lookahead bot survives 3 km on every test seed. A player who never changes shape falls in a median of about 20 m (40 seeds). A player who only checks the next footstep survives a median of about 200 m (at most 388 m) and falls on all 40 seeds.
- [Likely] The difficulty curve is gentle and then steep. Even with perfect foresight, you need about one shape change every 7 s in the first 100 m, rising to about 1.3 per second past 1 km at top speed. That makes the first minute learnable and the late game a real reading-and-reflex test.
- [Speculative] Whether it's genuinely fun for five minutes. I tuned it from bot statistics and frame-by-frame screenshots; no human has played it yet. The top speed (68 units/s) may be too fast, or not fast enough.

Rough edges:
- Phones in portrait have a lot of empty sky, and on phones the intro card hides the self-playing demo behind it.
- At phone scale the narrowest holes (0.2 m) are only about 7 px wide. They're readable but thin.
- The colour blend during a morph passes through muddy midpoints (green to violet goes grey-teal for a few frames).
- The fall animation is a simple tip-and-drop clipped to the hole, which is serviceable but not lovely.
- Desktops see more of the course ahead than phones do (about 22 m vs 9 m), so best scores aren't comparable across devices.
- Audio was exercised only in headless Chromium. iOS Safari's audio unlock is handled on several gesture types but hasn't been tried on a device.

## Where it could go next

- **Slopes and energy.** Real polygons lose energy at every impact (triangles most, hexagons least) and gain it rolling downhill. Making speed a resource would add a second axis to the same single control.
- **Daily course.** A shared seed per day, plus a shareable "gait strip" of your footsteps, which the game-over card already draws.
- **Ghost of your best run** rolling alongside you, so you can see where your rhythm diverged.
- **More shapes, carefully.** 60 also divides by 10, 12 and 15 (strides of 0.6, 0.5 and 0.4 m), which would allow a fine-stepping mode. Star (non-convex) loops would hop rather than roll.
- **A slower "stroll" mode** for accessibility, with a lower speed cap and a longer late-shift window.
