# After You
> A mirror game for two people on one screen. Each of you is secretly told to lead or to follow; afterwards the trace shows who really went first.

**Kind:** two-player game
**Run:** open `ideas/57-after-you/index.html` in a browser (double-clicking the file works; no server, build or network). Two people, one device. Either lay a phone or tablet flat on the table and sit facing each other across it (each of you owns the half nearest you, and your words face you), or sit side by side at a laptop or a tablet in landscape (Orange on the left, Blue on the right). You each keep one finger on your own half, both moving at once. No touchscreen: Orange steers with W A S D, Blue with the arrow keys, and a mouse works for one of you. Rule tests: `node --test ideas/57-after-you/mirror.test.mjs` (about 6 s). Headless two-player playthrough with two simultaneous touches: `node ideas/57-after-you/check.mjs` (about 70 s; uses the globally installed Playwright that `tools/smoke.mjs` uses).
**Made by:** Tain

## What it is

The screen is a pane of glass with a mirror line across the middle. Orange owns one half, Blue the other. Each of you has a dot under your finger, and in your half a ring shows where your partner's dot would be if it were reflected through the line. The job is to stay mirror images: keep your dot on the ring while you both move. When you manage it, the mirror line glows and each dot sings the same note. When you stop, or drift apart, the glass mists over.

Before each round you each press and hold a card to read a secret order, shielding it with your other hand: **LEAD** or **FOLLOW**. Each order is its own coin toss, so half the time you get the same one. Then the glass is up for 30 seconds, and nobody talks. Afterwards each of you secretly guesses the other's order, and the reveal shows:

- both orders and both guesses;
- a strip of the 30 seconds, coloured half-second by half-second by who was ahead: Orange, Blue, *together* (nobody ahead), *apart*, *too close to call*, or *still*;
- both paths laid over each other, with a scrubber, so you can put the dots back where they were at the moment you are arguing about;
- who moved first, and how far behind the follower typically was.

There are four scored rounds, plus a practice round with no orders that just asks each of you, privately, "who was leading?" and then shows you the trace. The game ends with one question you answer out loud before you are allowed to see the bar: *which of you usually leads?*

## Why I made it

There is an old theatre exercise called the mirror. Two people face each other, one leads, the other copies, and after a while the teacher says "now nobody leads", and they carry on. If it goes well, they report something odd: the movement keeps going and neither of them is making it. Noy, Dekel and Alon turned this into a lab task in 2011 (*PNAS* 108:20947): two people sliding handles along parallel tracks, mirroring each other. As I read the paper, a designated follower trails with jittery, corrective motion, while expert improvisers, told to lead nobody, sometimes reached stretches the authors called *co-confident*: smooth, synchronised and jitter-free, with no apparent leader.

What I wanted to know is whether "who is leading" is a fact about the motion or a feeling about it. Part of it is plainly a fact. If your dot keeps arriving where mine was a quarter of a second ago, you are following me, and that can be measured and proven to be measured right. But the part people care about, *who meant to*, is not in the trace at all. A follower who predicts a regular pattern gets ahead of it and the trace calls them the leader. Two people who were both told to follow can still produce a dance, each convinced the other started it, the way a Ouija planchette moves with nobody pushing. I wanted a game where the measurable part and the felt part are both on the table, and where the gap between them is the thing two people end up arguing about.

The form constraint (two people, one screen) suited it, because a mirror needs exactly two people and cannot be played alone in any meaningful way. The other person's motion *is* your input.

Ideas I listed first and crossed out:

- **Both or neither.** Each of you secretly answers yes or no to a question, and the screen reveals only whether you *both* said yes (the "dating problem", or Bert den Boer's five-card trick). Real cryptography, but on one phone the device sees both answers, so the proof is trivial and it plays like a single tap.
- **The two-handed monochord.** One person frets a string, the other plucks it. Lovely, but the conversation is just "lower… no, higher", and it is mostly a music toy.
- **The hidden-agenda planchette.** A shared pointer moved by the sum of two fingers, each player secretly steering toward a different word. Funny for one round; the vector sum is all there is to prove.
- **Meeting point.** Both secretly pick a spot on a strange map and score if you match (Schelling focal points). Close to existing party games, and nothing happens *between* you while you play.
- **Tangram dictation.** One describes abstract shapes, the other picks them, and your descriptions shrink into private nicknames round by round (Clark and Wilkes-Gibbs). The best "understand each other" idea, but one screen means passing the phone dozens of times.
- **Tap together.** Both tap a beat at once and the screen shows who adjusts to whom (joint-tapping studies find both do). Strong measurement, thin game.
- **After you, the door.** A pure war of attrition: who gives way first. It survived, as the both-follow round inside this game.

The mirror won because it uses both fingers at once, the hidden orders create real standoffs, and the reveal gives you something specific to argue about: *there, at nine seconds, you moved first*.

## How it works

**The glass.** In the *facing* seating (the default when the screen is taller than wide) the mirror line runs across the screen; Orange's half is at the bottom, Blue's at the top, and Blue's words are turned to face Blue. Reflection keeps your position along the line, so when you move to your right your partner moves to *their* left, as in a real mirror. In the *side by side* seating (the default on a landscape screen) the line runs down the middle. The seating can be forced on the title screen, and once a round's glass is up it stays fixed, so turning a phone mid-round cannot swap the geometry under the trace. A finger belongs to whichever half it first touches; a second finger in the same half is ignored. Dots follow your finger's movement rather than jumping to it.

**The mirror holds** at a moment when the two dots are within 12% of the half's shorter side of being mirror images (47 px, about 7 mm, on a 390 px phone), *and* each dot has travelled at least 15% of that side (58 px) in the last 1.5 s. The travel rule stops two people scoring by wiggling on the spot or by both holding still. The rule only looks backwards, so the live glow and fog show exactly the rule that is scored.

**The orders.** Each player's order is the low bit of their own word from `crypto.getRandomValues`, so it is a fair coin independent of the other player's and of every earlier round. Your own order tells you nothing about your partner's.

**The trace.** During the 30 seconds both positions are sampled 50 times a second, in a frame where a perfect mirror means the two dots coincide. Each half-second segment is then judged in two steps:

1. *Is anybody copying anybody?* This is judged on 3 s of motion centred on the segment, because over shorter stretches two people ignoring each other line up by chance too often. Both dots must be moving (an RMS spread of at least 3% of the side), there must be a time shift of under 0.8 s that brings the dots close (RMS distance at most 10% of the side), the dots' velocities must agree at that shift (correlation at least 0.5), and no rival shift that tells a different story may fit nearly as well (within 25%). Otherwise the segment is *still*, *apart* or *too close to call*.
2. *If so, who is ahead right here?* This is judged on the 1 s around the segment, so a moment of leading is credited for about as long as it lasted. If neither dot moved in that second, the segment is *still*. Otherwise the best time shift, refined between samples, is the lag. If the lag is within 40 ms either way, the segment is *together*. Otherwise, whoever's dot gets there first is ahead.

"Ahead" means your dot arrives first: your partner is where you were, some fraction of a second later. **The measured leader** of a round is whoever was ahead for longer, provided it was at least 4 s. Ties or less than 4 s mean nobody led.

**Points, each round, each player:**

| | |
|---|---|
| +1 each | the mirror held for at least 10 of the 30 seconds |
| +1 | you did as you were told: LEAD, and the trace names you the leader; FOLLOW, and it names your partner |
| +1 | you guessed your partner's order |

**Why the orders make a game.** If the orders differ, the round is cooperative: the leader leads, the follower follows, and both keep their orders. If they match, at most one of you can keep yours, because only one of you can be the measured leader. Two followers face a standoff: somebody has to move, and whoever moves first is the one being copied. Two leaders face a tug: somebody has to give way. In both cases the mirror point is the reason to give way, and it has a deadline. Neither of you can score it unless the dots start travelling together in time:

| orders | nobody gives way | one gives way, the other copies (in time to hold 10 s) |
|---|---|---|
| LEAD / FOLLOW | (no reason not to) | both: held +1, kept +1 |
| FOLLOW / FOLLOW | held 0, kept 0 | the one who moved: held +1; the one who waited: held +1, kept +1 |
| LEAD / LEAD | held 0, kept 0 | the one who gave way: held +1; the other: held +1, kept +1 |

As long as the mirror then holds for 10 s, giving way beats a stalemate for the one who gives way, and is better still for the one who waits. Nobody can keep their order alone: a LEAD needs someone copying them, and a FOLLOW needs someone to copy. That makes it a game of chicken with a clock. In simulation, a good follower behind someone who sets off at 8 s still holds the mirror for 10 s in about 90% of rounds; setting off at 14 s, about half; at 20 s or later it is impossible, since no held time is possible before the first move. There is also a third way out of a standoff: moving *together*, with nobody ahead, scores the mirror for both and the order point for neither.

**The guess** is the part where you read each other. With orders from fair, independent coins, no rule for guessing that ignores what happened in the round (your own order, earlier reveals, always guessing LEAD) can do better or worse than exactly 1/2. Everything above that comes from watching: someone who moves off at once was probably told to lead; someone who moves off after five seconds of glaring at you was probably a follower who cracked.

**Hidden information, and how hidden it is.** The page keeps the game state inside a closure and draws only from `view(state)`. That function shows a player's order only while that player's card is held, shows only *that* a guess has been made (never which), and keeps the trace's verdict back until both have guessed. In the DOM, a card that is not being held is identical whatever it hides, and the two answer buttons appear in an independently shuffled order each round, so a glimpse of which side someone tapped tells you nothing. It is still a table game, though: nothing stops you looking at your partner's card when they press it, or reaching over and pressing it yourself. If you do, their card already says "Read ✓" when they come to it, which they will notice. Anyone with browser developer tools can of course read anything.

**The conversation it is built to start.** The reveal names the situation in one sentence, for example "*You were both told to follow. Somebody had to go first, and it was Orange. And each of you thought the other was leading.*", and then hands you a scrubber. The summary asks its last question out loud and makes you answer before it shows the bar: *which of you usually leads?* My guess is that the interesting arguments are not about the points but about the half-second strip: whether a move was a lead or an anticipation, and whether the trace saying "together" matches what it felt like.

**Sound.** Each dot sings a sine tone whose pitch is set by its position along the mirror line, across one octave from 220 Hz. Mirror images sing in unison; slightly apart, the two tones beat against each other, so you can hear the mirror drift before you see it. There are soft clicks on the countdown. Audio starts only after a tap or click, can be turned off on the title screen, and is suspended when the tab is hidden.

**Reduced motion** stops the pulsing start marks and button animations. **Colour schemes** follow the system (warm paper by day, dark glass by night). **Keyboard**: W A S D and the arrow keys steer (with easing), the cards can be held with Space or Enter, and the reveal's strip can be scrubbed with the arrow keys.

**Files.** `mirror.js` holds the rules, the measurement and the state machine: pure, no DOM, no clock, no randomness of its own, and loadable as a plain script or with `require`. `app.js` holds the glass, the input, the sound and the screens. `mirror.test.mjs` tests the rules (27 tests). `check.mjs` is a headless two-player playthrough. Nothing is stored except your seating and sound preferences, and nothing is sent anywhere.

## Honest assessment

- **[Certain] No two humans have played this.** I can't touch a screen, sit across a table, or hear the tones. Every threshold (the 47 px mirror tolerance, the 1.5 s travel rule, 4 s to count as leader, 40 ms for "together", the 10 s needed to hold) was tuned against synthetic motion and judgement, not people. The whole premise (that a both-follow round produces a standoff, that the reveal starts an argument) is a prediction.
- **[Certain] The rules are as described.** `mirror.test.mjs` enumerates every combination of orders, guesses, leader and held (scores, symmetry, and "at most one keeps their order when the orders match"). It checks dealing over every low-bit pattern (four outcomes, each equally likely, each player's order independent of the other's), and all 256 guessing rules that use only your own order and the previous round's reveal (each scores exactly 1/2). A breadth-first search over all 704 reachable states (abstracting away history and totals, which no transition depends on) finds every phase and round reachable, no dead ends, the title and summary reachable from everywhere, refused actions changing nothing, and no action mutating its input. In every reachable state before the reveal, the view is byte-identical across all four order assignments, except a held card's own order, and identical whichever answer an answered player gave. A source check confirms that `app.js` reads nothing off the game state but its phase.
- **[Certain] The page hides what the rules hide, and two simultaneous fingers play it.** `check.mjs` opens the page from `file://` at phone size with the order dice rigged from outside the page. The deal's DOM is identical for all four order combinations, depends only on Orange's order while Orange holds the card, and is identical again once it is released. A full scored round is played with two simultaneous CDP touch points in two tabs at once (LEAD/FOLLOW and FOLLOW/FOLLOW), Orange tracing a slow path and Blue copying 300 ms behind. The guess-phase DOM is identical across the two tabs even though Orange answered differently. The reveals name Orange as leader, measure the lag at about 0.3 s (0.31 s in my runs), award 3/3 and 1/2 as the rules say, and tell the two followers that each thought the other was leading. A keyboard-only practice round on the desktop also names Orange. A whole game, from practice through four rounds to the summary and back to the title, runs with the clock jumped over each round as if the tab were in the background. All 53 checks pass in light and dark, with reduced motion, without console errors, and without sideways scrolling at 390 px. `tools/smoke.mjs` passes at desktop and phone sizes.
- **[Certain] On synthetic motion the measurement is right.** Exact delayed copies are attributed to the right player, with the lag recovered within 15 ms, from 60 to 750 ms of delay. Copies within 30 ms read as *together*, and a lag of 1.1 s, beyond the 0.8 s search, is credited to nobody. Simulated followers who steer toward the leader with a reaction delay and hand tremor are named followers in 200 of 200 rounds. Swapping the players swaps every judgement bit for bit, and zooming or shifting the picture changes nothing. A smooth bump of leading, 1 to 8 s long, is credited within a second of its true length. Taking turns shows up as turns.
- **[Certain] It can find a leader where there was none, rarely.** Two people moving independently in the same space produce a "leader" in under 5% of rounds (the test's bound; 2 in 400 on the test's seeds, 7 in 400 on another set). That is the worst case, since in play people are at least watching each other.
- **[Certain] The trace measures timing, not intent.** A follower who predicts a regular pattern (a steady circle) and runs 150 ms ahead of it is credited as the leader for nearly the whole round; a test pins this. I think that is a true statement about leading, and the game is built around it, but it means a FOLLOW can lose their order point by being too good, and a LEAD in a tug can win by anticipating.
- **[Likely] Real followers fall in the range the measurement handles.** People copying a slow, unpredictable movement should trail by roughly 0.15 to 0.5 s, inside the 0.8 s window. I have no measurement of real finger motion on a phone, including how much touch noise or occlusion by your own finger changes it.
- **[Likely] The mirror is holdable at a slow pace and hard when fast.** At about 60 to 90 px/s on a phone, a simulated 0.2 s follower holds it for a median of 60% or more of the round. A follower 0.3 s behind a leader moving at 200 px/s is 60 px off, outside the 47 px tolerance. That is the point of the exercise ("slow is easier"), but the tolerance may be wrong for real fingers.
- **[Speculative] The both-follow round is the heart of it.** I expect a few seconds of glaring, a twitch, and then an argument about who twitched. It could equally be a dull 30 seconds of two people politely waiting, which the deadline is meant to prevent.
- **[Speculative] The tones help.** Beating between two near-unison sines is a real and very audible effect, but I have not heard these, and on a phone speaker at 220 Hz they may be faint.
- Rough edges: the honour system carries real weight (no peeking, no talking, no telling). The guess point is probably easy when both play straight, since a partner who moves off at once was usually told to lead. One person with two hands can play both sides, which makes the hidden orders meaningless. The finger covers your own dot, which is why the halo is large. Turning a phone mid-round keeps the seating but squashes the halves. Keyboard steering is coarse and following on keys lags more than following by finger. In the practice round, "nobody was leading" counts as matching the trace whenever the trace names no leader, which includes a round where one of you was ahead for 3.5 s.

## Where it could go next

- **A free round.** No orders, three minutes, and the only score is the longest stretch the trace calls *together*: a direct attempt at the co-confident state from the mirror-game research.
- **A third person.** One spectator watches and guesses who is leading, as in the circle game where someone in the middle must spot who starts each movement.
- **One dimension.** Two sliders on parallel tracks, as in the original experiment. The measurement would be cleaner, and the result would be comparable to the published data.
- **Replays worth keeping.** Export a round as a small animated drawing of both paths, coloured by who was ahead: a picture of a conversation with no words in it.
- **Real people.** The honest next step is to watch ten pairs play and find out whether the reveal starts the argument I think it does, and whether the thresholds survive real fingers.
