# Open Circuit
> A museum of switches. Every exhibit may be handled, every mechanism is real, and all of them are wired to nothing. Except two.

**Kind:** toy
**Run:** open `ideas/50-open-circuit/index.html` in a browser (double-clicking the file works; so does any static server). Sound on. Mechanism tests: `node --test ideas/50-open-circuit/switches.test.mjs`. Headless walk-through of every exhibit: `node ideas/50-open-circuit/check.mjs` (uses the globally installed Playwright that `tools/smoke.mjs` uses; about two minutes).
**Made by:** Detent

## What it is

Fifteen switches in fifteen glass cases, each with a plaque in the dry voice of a museum label. You can work all of them: drag a handle slowly to feel its mechanism, or tap it to work it quickly. They click. That is the whole exhibit.

| No. | Exhibit | What it does when you work it |
|---|---|---|
| 01 | Toggle switch, bat handle | Over-centre action: nothing happens until the lever passes the middle, then the contacts snap whether you have finished or not. |
| 02 | Rotary selector | Eight detented positions, a click for every one you pass, never rests between two. |
| 03 | Light switch | **Connected to the gallery lighting.** Switches the page between light and dark. |
| 04 | Slide switch | **Connected to the loudspeakers.** OFF, QUIET, FULL. |
| 05 | Bell push | Momentary, with a snap dome: closes at 70% of travel, opens again at 30%. |
| 06 | Push-on, push-off button | A ballpoint-pen cam: a full push latches it part way down; the next lets it up. Only a push that goes all the way takes (on screen, every push does). |
| 07 | Keyboard key, "Any" | Clicks at 2.2 mm of a 4 mm travel, then bottoms out. |
| 08 | DIP switch | Eight tiny rockers. The plaque reads out the binary word they spell. |
| 09 | Pull-chain lamp holder | Beads tick over the collar; one full pull advances the ratchet exactly once. A short pull does nothing, and hanging on does nothing more; let the chain back up, held or not, and the next full pull works again. |
| 10 | Knife switch | Let go on the lower half and it falls home with a clack; on the upper half it swings open. |
| 11 | Miniature circuit breaker | TEST trips it. Tripped, it refuses to go ON and flops back to the middle until pushed fully OFF. A composite (see the assessment). |
| 12 | Guarded toggle | Cannot be worked under its red cover; closing the cover forces it OFF, even while you are still holding the cover down. |
| 13 | Emergency stop | Push to latch, whether you tap it or hold it. Only a twist of 30° or more releases it. |
| 14 | Useless machine | Switch it on; after a pause of its choosing, a lid opens and an arm switches it off. It has moods. Switch it on again before it has shut its lid and it comes straight back out. |
| 15 | Tally counter | Counts every operation of every exhibit during your visit, its own included, and rolls over at 9999. Its drums carry like a real counter's: a drum turns only while the drum below it rolls from 9 to 0. |

Nothing is loaded from the network, no library is used, and every click is synthesized in the browser the moment it happens. The only things the museum remembers between visits are whether you left the lights on and how loud you set the loudspeakers.

## Why I made it

I wanted to make something useless with more care than most useful things get, and I kept coming back to switches. A switch is the smallest machine people have strong opinions about. Nobody loves a particular resistor, but everyone has a toggle they like to flip, a light switch that feels cheap, a pen they click under the desk in meetings. The entire pleasure is in the click, and the click is the part that does nothing: it is the sound of a mechanism arriving somewhere, not the sound of the thing it controls.

So the question was whether the click survives with the thing it controls removed. I think it does. The plaques are there because a label is what turns an object into an exhibit, and because a museum label is allowed to tell the plain truth ("Wired to nothing") in a way that stays funny. The two switches that *are* connected to something are the ones every web page needs anyway, a theme toggle and a mute, and I liked that the only useful controls in the building are themselves part of the collection and say so.

It fits this batch's theme neatly. The part that can be proven is that every mechanism obeys the rule on its plaque, and `switches.test.mjs` proves it. The part that can only be felt is why anyone would flip the bat-handle toggle a twentieth time.

## How it works

**`switches.js`** holds the mechanisms, with no DOM in them. Each is a small class with a continuous position (a lever angle, a button depth, a knob angle) and a few discrete states (on, latched, tripped). The page drives it with `grab` / `drag` / `release` / `tap` and advances it with `step(dt)`; every call returns a list of event names (`snap`, `detent`, `clunk`, `refuse`, ...) that happen at exactly the moment the mechanism would make them. Free motion is a damped spring (`settle`), integrated at 240 Hz so it is stable at any frame rate; `step(Infinity)` jumps straight to rest, which is how reduced motion is done. The useless machine is a little script interpreter: when provoked it draws a *mood* from a seeded PRNG (`prompt`, `slow`, `peek`, `fake`, `instant`, `sulk`) and queues phases (wait, lid, arm, flip). Provoked again while it is busy, it lets the plan in hand deal with it if a flip is still to come and the arm is not out; otherwise (arm out, or on its way home with the job done) it drops the plan and goes straight back for a quick flip. Being seeded, its every mood is tested. The page seeds it from the clock, so each visit starts somewhere different.

**`exhibits.js`** draws each switch as inline SVG and says how it is handled. Three helpers cover almost everything: `dragZone` (a handle moved along one axis, relative to where you grabbed it), `turnZone` (a knob, with angle accumulation so turning past the dead zone is sane), and `pressZone` (a button; a very quick tap is held down long enough to click). Everything is seen from the front, so there are two small perspective tricks: the toggle's ball gets bigger as the lever points at you, and the guarded toggle's cover foreshortens as it lifts, passes edge-on at 90°, then shows its underside above the hinge.

**`sound.js`** makes every click from two ingredients: a few milliseconds of white noise through a band-pass filter (the contact) and a damped low sine (the body it is mounted in). A toggle is a 2.8 kHz burst over a 180→90 Hz thump; a DIP switch is a 6.5 kHz burst with almost no body; the knife switch adds two ringing partials at 2.1 and 3.15 kHz; the breaker's trip is a 70→45 Hz thud under the snap; the useless machine's motor is a low sawtooth through a low-pass with a wobble. The audio context is created on the first gesture, as browsers require.

**`index.html`** runs one animation loop for the whole museum, which goes to sleep when nothing is moving and wakes on any input. Events become sounds and tally counts; apart from the tally, the light switch and the slide switch are the only exhibits whose events touch anything outside their own case. Every zone has `touch-action: none` so a finger drags a lever instead of scrolling; the plaques and the wall around each switch still scroll. Each exhibit is keyboard-operable: Tab to it, and Enter or Space works it. The arrows move levers, knobs, covers and the TEST button, and they respect direction. On the breaker, Up pushes toward ON and Down pushes fully OFF, which is how a tripped breaker is reset. On the DIP switch, Left and Right choose a way, Enter flips it, and Up or Down set it.

The exact rules, all pinned by tests:

- A toggle's contacts change at the instant the lever crosses centre and only then; released short of centre it returns to its side.
- A detented control clicks once per position passed and never rests between positions; at an end stop it stays put.
- A momentary button closes at 70% of travel and opens at 30%; the "Any" key at 55% and 40%, with a bottom-out once per press.
- A push-on push-off button changes state only on release after a full (≥ 92%) press, and rests at 45% while latched.
- A pull chain advances once per full stroke (≥ 95%), never twice. The ratchet re-engages only after the chain has returned most of the way (below 30%), whether it sprang back on its own or was let back up still held.
- A knife switch dropped below half falls home and clacks exactly once.
- A breaker's TEST trips it only from ON. Tripped, it will not go ON; it must pass through OFF, whether dragged or pushed with the arrow keys.
- A guarded toggle cannot be worked under its cover, from the keyboard either, until the cover is most of the way up. Closing the cover forces it OFF: when a dragged cover comes within 30% of shut, even before it is let go.
- An e-stop latches on the push itself, whether tapped, held, or pressed by a finger that wanders a few pixels. It releases only with a twist of ≥ 30°; a smaller twist springs back.
- The useless machine switches itself off within 6 s and is tidied away within 10 s for every one of 200 seeds, and never flips a switch that is already off. Switched on again at any moment (about 18,000 timings across those seeds, plus 300 runs of a visitor tapping and dragging at random), it still switches itself off and tidies away.
- The tally reads 0000 after 9999. At rest every drum sits square on its digit and the drums read the count. A drum is carried only while every drum below it shows 9 and the units drum rolls from 9 to 0.
- On the DIP switch, the keyboard flips only the way it has selected.

## Honest assessment

- [Certain] Every rule in the list above holds. `switches.test.mjs` (36 tests) checks them in Node. `check.mjs` (117 checks) drives the real page with a mouse, with touch and with the keyboard, and checks the same things on the page. That includes reading the tally's digits off the drawn drums, at rest and mid-carry. It also checks the sounds that should be heard, that the loop sleeps when idle, that hammering every exhibit and resizing mid-drag breaks nothing, and that reduced motion still works and still clicks.
- [Certain] No network, no dependencies, no build; the only persistence is two localStorage keys (lighting and loudspeaker level), wrapped so a browser without storage still works.
- [Certain] Exactly two exhibits are connected to anything outside the collection (lighting and loudspeakers), and the useless machine is connected to itself. The plaques say so. The one other wire is the tally counter's: every exhibit reports its operations to it, and it controls nothing.
- [Likely] The sounds are good. I designed them from how contacts and housings behave, and `check.mjs` confirms that the ones it listens for (most of them) are triggered at the moment the mechanism says, but I cannot listen to them. If one is harsh, the recipes in `sound.js` are a dozen numbers each.
- [Likely] The physical claims are right in spirit: over-centre action is how snap-action toggles work; 2.2 mm / 4 mm is the actuation and travel of a classic clicky key switch; Marvin Minsky designed the "ultimate machine" in 1952 while at Bell Labs and Claude Shannon built one (the plaque's "more than seventy years" is counted from 1952). The breaker is a composite, and its meta line now says so. A plain miniature breaker has no TEST button; TEST belongs to residual-current devices (an RCBO, or a North American GFCI/AFCI breaker). As far as I know, the middle "tripped" position and the push-to-OFF reset are how North American plug-in breakers behave. Most DIN-rail breakers like the one on its label drop straight to OFF when they trip.
- [Speculative] That it is still funny on the tenth visit. The plaques do not change, and the tally starts again from 0000 every visit; only the useless machine's moods vary.
- Rough: everything is a front view, so the useless machine's arm is more crane than arm; the pull-chain lamp holder is the weakest drawing; the rotary knob is easier to turn with a mouse than a thumb; the keyboard mapping is sensible but not shown on screen (only the DIP switch's chosen way is marked, and a tripped breaker tells a screen reader to push it fully OFF). Tested in headless Chromium only. There is no haptic feedback, which on a phone is most of what a switch is. The tally counts per mechanism, not per gesture: a TEST press that trips the breaker counts twice (the button and the breaker), so does closing the guarded cover over an armed toggle, and the rotary knob counts once per position passed. The push buttons always travel all the way on screen, so their partial-press rules (70% / 30%, the cam that only takes on a full push) are visible only in the tests. The useless machine had two faults that were caught late: switched off, its lever could not be grabbed where it is drawn, and switched on again while its arm was on the way home it went to sleep with the switch still on. Both are fixed and now tested.

## Where it could go next

More cases: a key switch whose key only comes out in OFF, a mercury tilt switch you rotate the whole case to work, a telephone hook switch, a car indicator stalk that cancels itself, a game-show plunger. A visitor's book. The Vibration API on phones for the snaps. A touring exhibition: a URL that carries the state of every switch so a visitor can leave the museum exactly as they found it, or not.

## Revision note

An independent reviewer fuzzed the mechanisms and drove the page in its own scripts. The mechanism logic held, but the page did not always do what the plaques said. Every finding below was reproduced before it was fixed, and each fix is pinned by a test that fails on the old code (8 new Node tests, 36 new page checks):

- **The tally counter showed the wrong number.** Every drum turned in proportion to the count, so higher drums sat between digits: 7 read as 0017 and 999 as 1009. For 7 in 8 of the counts from 0 to 9999, at least one drum was half-way or more toward the next digit. The old checks read only the plaque's text, never the drums. Now the drums carry like a real counter's, square at rest, and `check.mjs` reads the digits off the drawing.
- **A keyboard user could not reset a tripped breaker.** Every key except Left and Right was a plain tap, which a tripped breaker always refuses. Down also switched an OFF breaker ON. The arrows now push the lever in their own direction, and Down resets a trip.
- **The e-stop latched only on a quick, still tap.** A press held for 0.4 s or longer, or one whose finger drifted 4 px, did nothing. It now latches on the push itself.
- **The pull chain ignored a second stroke in the same hold.** Its ratchet re-engaged only on a fresh grab. It now re-engages whenever the chain gets back up, held or not.
- **Smaller fixes:**
  - A cover dragged shut and held there left the toggle armed under it, and Up straight after lifting the cover armed the toggle before the cover had moved.
  - The DIP switch's keys flipped a random way; they now choose a way and flip only that one.
  - The light switch's plaque claimed it was the only exhibit connected to the building; the loudspeakers are the other.
  - The breaker's TEST button belongs to an RCBO, not a plain MCB; its meta line and the composite note now say so.
  - The tally is not kept between visits, so it cannot make a tenth visit different.
