# Backtime
> Type the time you want to eat. Every dish gets its own start time, the oven and hob are checked for clashes, and a live "next up" card walks you to the table.

**Kind:** product
**Run:** Open `ideas/27-backtime/index.html` in a browser. Double-clicking the file works, and so does any static server. Tests, from the repo root: `node --test ideas/27-backtime/backtime.test.mjs` (pure Node, 30 tests) and `node ideas/27-backtime/ui-check.mjs` (64 checks in headless Chromium, using the globally installed Playwright that `tools/smoke.mjs` uses).
**Made by:** Pilot Light

## What it is

Radio presenters *back-time* a record: they know when the news starts, so they count backwards to find the second the song has to begin. Backtime does that for dinner.

You give it one thing, the time you want to serve, and a list of dishes. Each dish is a few steps in order: *in the oven 200° for 80 min, out to rest for 25, carve for 5*. The page counts back from the serve time and turns the lot into a single timeline of clock times, merged across every dish:

```
16:55  Oven on, 200°C
17:10  Roast chicken: in the oven               200°C · 1 h 20 min
17:50  Roast potatoes: parboil                  12 min · hob
18:02  Roast potatoes: drain, shake, into hot fat
18:05  Roast potatoes: in the oven              200°C · 55 min
18:30  Roast chicken: out to rest, loosely covered
18:33  Yorkshire puddings: batter into the smoking-hot tin
18:35  Yorkshire puddings: in the oven · oven to 220°C
18:45  Carrots: simmer
18:50  Gravy: in the roasting tin
18:55  Roast chicken: carve · Greens: boil
18:57  Yorkshire puddings ready, keep warm
19:00  Serve
```

That is the worked example the page opens with (set to serve two and a half hours from whenever you first open it, so the live view is live). On top of the arithmetic it does the things a good cook does in their head:

- **It switches the oven on for you**, one preheat before the first thing goes in, and notes when the dial has to change ("oven to 220°C" as the Yorkshires go in once the chicken is out). If the oven would be empty for half an hour or less it stays on; longer than that and you get an "oven is free" line.
- **It flags clashes.** Two dishes in the oven at the same time wanting temperatures more than 25° apart. More pans on the hob than you have rings. Two hands-on jobs at once (carving while mashing). Each flag says when, which dishes, and what to do about it.
- **It runs live.** A "Next up" card shows the next job and how long until it is due, a "now" line moves down the timeline, and you tick jobs off as you go. If you fall behind it says so plainly and offers to push the serve time five minutes. "Start now" works the other way round: if you begin this minute, when is the earliest you could eat?
- **Dessert works**: a dish can finish *after* serving. Long leads work too: a brine that starts two days before is shown as "14:30, 2 days before", and midnight is just arithmetic.
- **Everything stays in your browser.** No account, no server. Save a dinner as a `.json` file and load it again, copy a link that carries the whole plan in its hash, or print a one-page sheet with tick boxes for the fridge door.

Light and dark looks, phone and desktop layouts, keyboard and touch, reduced motion respected. No build, no dependencies, no network.

## Why I made it

I wanted to make something for the moment I think of as *the hour before people arrive*. There is a particular kind of stress in cooking several things that all need to be hot at once, and it has almost nothing to do with cooking skill. Every recipe tells you how long its dish takes. None of them tells you when to start, because that depends on everything else you are making, and on one oven that can only be one temperature.

What people actually do is get a pen and work backwards on the back of an envelope. Food magazines publish printable "Christmas dinner timelines" every December, which is an admission that the problem is real and that the tool is still paper. I found that charming and slightly absurd. The computation is trivial, and it was being done by hand, under stress, once a year, badly.

The thing I was curious about was whether the *trivial* computation was the whole product, or whether the feeling came from somewhere else. Having built it, I think the arithmetic is the part that can be proven, and the calm comes from three small things on top: the single merged list (so you never hold more than one next job in your head), the oven-dial notes (the thing you forget), and the "behind by 3 min, serve 5 min later?" button, which turns the one moment of panic into a decision that takes a second. A timeline you trust is a kitchen you can leave for a minute.

## The product

**Who it is for.** One person: the home cook who is making three or more dishes for the same sitting, with one oven. Sunday roast every week in a lot of British households; the Thanksgiving or Christmas cook; anyone hosting dinner for six. Not a chef (they have a brigade and a tacit plan) and not someone making one pan of pasta (nothing to coordinate).

**The one job.** Tell me when to start each thing so that everything is ready together, and keep telling me as I cook.

**The moment they reach for it.** Two hours before guests arrive, with the shopping unpacked and the question "so when does the chicken go in?" Then again at the stove, with wet hands, wanting to know only *what is next and how long have I got*.

**Why what they use now fails them.**

- *Phone timers* count forwards from now. The problem counts backwards from a fixed end. You can set six timers only once you have already done the arithmetic.
- *Recipes* give durations, not clock times, and each one is written as if it were the only thing you are cooking.
- *Paper timelines* (the magazine printables) are for one fixed menu at one fixed time. Change the serve time by twenty minutes and you are back to the pen.
- *Roast apps.* The closest things I could find are built around one joint of meat: Tiny Roast Timer (Apple Watch only, $0.99) counts back from a finish time for a single roast; Roasto (iOS, paid) plans and alarms the timings for a roast; Ian Renton's free web page "The Great Roast Dinner Timing Chart" picks a meat, weight, accompaniments and serving time and draws a chart. None of them take an arbitrary list of dishes with arbitrary steps, model the oven as a shared resource that can only be one temperature, run on any phone from a link, or keep your data local. That gap is the product.

**What it would charge, and why that is fair.** Free to plan and cook one dinner at a time, with everything you see here. A one-off £2.99 / $3.99 "kitchen pass" unlocks a library of saved dinners (so your Christmas plan is there next December), chimes and notifications, and nothing else. No subscription: this is used a handful of times a year, and charging monthly for that would be hostile. $3.99 is about what Paprika charges one-off for its mobile recipe manager and four times what the single-roast watch timer costs, which feels right for something that handles the whole table. The people who pay are the ones who came back, which is the only honest signal that it earned it. First-time Christmas cooks, who need it most, get it free.

**What I would measure to know it is working.** This build measures nothing, because it talks to no server; a shipped version would ask for opt-in, anonymous counts of these five things:

1. *Ready-together rate.* Of cooking sessions with three or more dishes and at least one tick, the share where "Serve" is ticked within five minutes of the planned time. This is the product's whole promise in one number.
2. *Activation.* Share of first visits that change the serve time or edit a dish. If people only look at the example, they did not see the point.
3. *Return within ten days.* Sunday-roast cadence. The free tier only earns the paid one if this is healthy.
4. *Entry friction.* Median seconds from "Add a dish" to that dish's first timeline event, and the share of added dishes removed within a minute. Dish entry is the one place this could be too much work.
5. *Clash resolution.* Of plans that ever showed an oven or hob clash, the share that were cooked without one. If clashes are shown but never fixed, the flags are noise.

## How it works

**Two files do the work.** `backtime.js` is the core: pure functions, no DOM, loaded by the page with a plain `<script>` (so `file://` works) and by Node with `require()` for the tests. `app.js` is the page. Nothing in the core knows what time it is; "now" is passed in.

**Offsets, not clock times.** Every step is placed as minutes relative to the serve time, negative before and positive after. A dish's last step ends at `-readyBefore` and each earlier step is laid end to end before it. Clock times are only produced for display (`clockOf` splits an offset into a day shift and a minute of the day), so a step that starts before midnight, or two days earlier, needs no special case; the test file checks it anyway.

**The oven as a resource.** Oven steps sorted by start are merged into *stretches*: a step joins the current stretch if it starts within `max(30, preheat)` minutes of the stretch's end, otherwise the oven is switched off and preheated again. That rule guarantees an "off" never lands after the next "on". Each stretch gets one preheat event at `start − preheat`, showing the temperature of whatever goes in first. The dial is then taken to be whatever went in last: when a step with a different temperature starts, the step's line carries "oven to T°". Steps with no temperature are allowed and never cause a clash.

**Clashes by sweep.** For each kind of resource, the breakpoints of all its intervals are sorted and each elementary segment between consecutive breakpoints is examined: the oven segments where `max(temp) − min(temp) > tolerance`, the hob segments where active pans exceed the ring count, the hands-on segments with two or more jobs. Adjacent flagged segments merge into one flag. The largest allowed plan (40 dishes × 30 steps) schedules in about 40 ms.

**Live time without a date.** A plan has a serve time but no date, on purpose: the same roast dinner is right every Sunday. So "now" has to be placed relative to the serve time by a rule: a clock time up to 18 hours before serve counts as before it, up to 6 hours after as after it (`nowOffset`). If the serve time has passed and nothing was ticked, the card says the plan is for another day rather than "4 hours behind". Jobs more than 18 hours ahead of serve show a clock time, not a countdown, and the brine is simply the first unticked thing to do.

**Ticks live in the plan**, keyed by dish and step id (`chicken/s2`), so they survive a reload and re-timing. "Next up" is the first unticked job in timeline order, which is deliberately not the same as the first job whose time has passed: if you skip one, it waits for you.

**Import is defensive.** `validatePlan` takes anything, whether a saved file, a link, or `localStorage` from an older version, and returns a plan every other function can trust: numbers coerced and clamped, unknown kinds mapped to hands-on, unicode names cut at 80 characters without splitting an emoji, duplicate ids regenerated, control characters stripped, 500-dish files cut to 40, and a list of what it tidied. Links carry the plan as base64url JSON in the hash; ticks are left out, because a link is a recipe, not a session. After a link loads, the hash is removed so a reload cannot undo your edits.

**Storage is a convenience, not a dependency.** Every `localStorage` call is wrapped; with storage throwing, the page still works for the visit (the UI check does exactly that). Durations can be typed as `90`, `1h20`, `1:20` or `1.5h`. Deleting a step gives an Undo toast; deleting a dish or replacing the plan with the example asks first.

**Small details I cared about.** The tab title is the countdown ("In 12 min · Roast potatoes: in the oven"), so the kitchen laptop shows it from across the room. The "now" line pulses unless you prefer reduced motion. Dish colours are consistent between the cards, the timeline and the flags. The printed sheet is black on white regardless of the dark theme and has a tick box per job. Times follow the browser's locale (12-hour in the US, 24-hour in Britain) and can be forced either way.

## Honest assessment

No real user has tried this. I cooked the example in my head, not in a kitchen, and the one person I am sure about is the one I imagined.

What works:

- [Certain] The 30 Node tests pass. They cover the walk-back arithmetic, `readyBefore` before and after serving, event ordering and grouping, empty plans and zero-minute steps, oven stretches (merge, keep-on gap, slow-oven case, off-before-on ordering), dial changes, oven/hob/hands clashes and their merging, the worked example line by line, midnight and multi-day leads, duration and clock formatting in both styles, the `nowOffset` rule, `earliestServe` rounding and wrap, `nextItem`, duration and time parsing, validation of junk, coercion and clamping, unicode safety, the 500-dish cap, and link encode/decode.
- [Certain] The 64 UI checks pass in headless Chromium at phone size: editing a dish and watching the timeline move, invalid durations rejected, remove and Undo, creating and clearing an oven clash, presets, a typed dish, ticking from the card and the list, reload with storage, reload in a clean browser, storage that throws, save to file, load a changed file, load junk, copy link and open it in a fresh browser, the empty state, the "for another day" state, "Start now", keyboard opening, dark mode, reduced motion, print, 12- and 24-hour clocks, desktop layout and `file://`. `tools/smoke.mjs` passes at both sizes with no console errors or overflow.
- [Certain] The folder is about 135 KB, has no dependencies, makes no network requests and needs no build.

What is rough:

- [Certain] Entering a dish is the most work in the product: name, then for each step a kind, a label, minutes and maybe a temperature. The 18 presets cover a roast dinner and a few weeknight things; anything else is typed by hand. The entry friction metric above exists because I expect this to be the weak point.
- [Certain] The preset timings are plausible starting points, not tested recipes, and the page says so. There is no weight-based meat calculator and no food-safety logic. Check meat with a thermometer.
- [Certain] The oven model is simple on purpose. "Whatever went in last sets the dial" is what most cooks do, but it ignores the fact that a dish wanting 180° will carry on at 220° if something hotter goes in later, as long as the difference is within the tolerance. The tolerance (25°C by default) is a guess at "close enough"; it is adjustable, and it is the kind of number only real users can calibrate. Two ovens are not modelled.
- [Certain] The hob check counts pans, not sizes, and hands-on overlap is flagged whenever two hands-on steps touch, which can be pedantic for two 2-minute jobs.
- [Certain] Chimes only sound while the tab is open and the browser lets it; there are no push notifications, so a phone that locks will go quiet. This is the first thing a paid version would need.
- [Certain] Because a plan has no date, the live view assumes you are cooking today. A plan with a two-day brine shows the brine as the next job, with a clock time, and relies on you to tick it. I think that is the right behaviour, but it is a rule, not a certainty.
- [Likely] The competitor facts are from search results in October 2026: Tiny Roast Timer is listed at $0.99 and "only for Watch"; Roasto is listed as a paid iOS app for roast timings with alarms; Ian Renton's chart is a free page with its source on GitHub; Paprika's mobile app is listed at $4.99 one-off. I could not open the App Store or the pages directly, so prices and scope may have moved.
- [Likely] The pricing is reasoning, not evidence: nobody has paid for this, and the free/paid split is a hypothesis to test with the return-visit metric.
- [Speculative] The felt claim, that a merged list plus oven notes plus a "serve 5 min later" button turns panic into calm, is exactly the kind of thing that cannot be proven here. It is what I would test first with a real Sunday roast and a real kitchen.
- I have only seen the page in headless Chromium. The CSS uses `color-mix()` for the dish-name tint, which degrades to no tint in browsers without it.

## Where it could go next

- **Notifications.** A service worker and `Notification` permission, so the phone buzzes at each job even when locked. This is the single feature a paying cook would ask for.
- **Recipe import.** Paste a recipe and pull out the steps and durations with a small parser (the "1h20" parser is a start), so entering a dish is one paste instead of five fields.
- **Two ovens, and ovens with a grill**, as named resources; hob ring sizes; a "keep warm" drawer as a place dishes can wait.
- **A dinner library** with the plans people actually cook (the paid tier), and a "what did I run late on last time?" note per dish, so the next Sunday's timings learn from this one.
- **Shared cooking.** Two phones on the same plan, one link, ticks in sync, so the person on gravy and the person on carving see the same next job. That needs a server, which is why it is not here.
- **A kitchen display mode**: huge type, the next two jobs only, for a tablet propped against the splashback.
