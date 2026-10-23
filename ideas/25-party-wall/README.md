# Party Wall
> A wall you share with someone you never see. Knock.

**Kind:** interactive piece
**Run:** open `index.html` in a browser (no server or build step; `file://` works). Sound on if you can: without it the answers are only faint blooms on the plaster, so keep an eye on where you knocked. Tap the wall, then give it a few minutes. Add `?seed=anything` to the URL to fix the neighbour's small hesitations. Tests: `node --test ideas/25-party-wall/*.test.mjs` from the repo root.
**Made by:** Lath

## What it is

A plaster wall, a skirting board, and the word *knock*. That is the whole screen. Tap the wall and it knocks: a dull thud under your finger, a small pressure-mark on the plaster that fades. Nothing else happens. Tap again. Wait.

Someone is on the other side.

They are not clever. They can't talk and they don't try. What they can do is hear you and knock back, and the piece is the two of you working out, in knocks, that the other one is there. It takes two or three minutes on a phone held in one hand, and uses no words except the one on the first screen and the one that appears when it is over. Nothing is stored, nothing is measured, nothing is sent anywhere. The person behind the wall is a few hundred lines of timing rules, and I say so up front because the piece should still work when you know that.

## Why I made it

The emotion I wanted is **being answered**: the specific small lift of a knock coming back through a wall. Not company exactly, and not relief exactly. The moment where a sound you made is returned to you and you realise someone was listening.

I picked it because it is one of the most mechanic-shaped feelings I know. It doesn't live in what the other person says, because through a wall they can't say anything. It lives entirely in *timing*: in the pause before the reply, in the reply having your shape, in the other side waiting for you to finish. Prisoners tapping on pipes, a child knocking through a bedroom wall to a sibling, two strangers in adjoining hotel rooms who never meet: in every version the content is nothing and the feeling is everything. So a piece about it needs no text, no face and no story. It needs a wall, a delay, and a rule for what comes back.

The second reason is that I wanted a feeling that survives honesty. You know this is a web page. This README tells you exactly how the reply is built. I wanted to find out whether being answered still lands when the answerer is admitted to be your own rhythm with a little jitter, the way a rubbed glass still sings when you know it is physics.

Ideas I wrote down first and crossed out: sand you hold, which runs faster the tighter you grip (a proverb, not a piece); a drawing you copy from its own fading copy until it drifts (a reveal you look at, not something you feel while doing it); a radio you tune until a station comes in clear (carries nothing with the sound off); carrying a sleeping animal across the screen without waking it (too close to the pet that dies); pull-starting a stubborn engine until it catches (a slot machine with a guaranteed payout); shouting into a canyon and getting echoes (solitude, which is the opposite); untangling a knot (I could not do the physics justice in the size budget). The wall won because the mechanic *is* the emotion: take away the delay and the echo and there is nothing left to be about.

## How it works

**Knocking.** Any tap on the wall is a knock (so is Space or Enter). It makes a short synthesised thud (a sine sweeping down from about 200 Hz, a click of band-passed noise, a little room) and a mark where your finger landed. Your knocks are grouped into *phrases*: a phrase ends once you have been quiet for 1.4 seconds.

**The other side.** They wait until your phrase is over, think for a moment, and answer. Their knocks come *through* the wall: lower, muffled (a low-pass filter at 280 Hz), a little quieter, with a cool bloom on the plaster where your hand was, as if they had put their hand where yours is. The first time, it is a single knock after a long pause. After that they answer with *your* rhythm: the same number of knocks with the same gaps, give or take a human-sized hesitation (each interval scaled by up to ±7%), and each knock lands where the matching knock of yours did. If you knock while they are still answering, they stop and listen. From the fourth answer they add something small of their own. After the fifth, if you go quiet, they knock first.

What they knock when they knock first, and what happens if you knock with it, is the end of the piece; I would rather you found it. Every number is in the spoiler section below for the reviewer.

**Where the feeling is meant to come from.** Three rules, none of them a message:

1. *The wait.* The first answer takes 4.4 seconds of your silence: 1.4 to end your phrase and 3 more of theirs. Long enough to think no one is there.
2. *The shape.* The answer is your rhythm, so it is unmistakably an answer and not a noise. The jitter is what makes it a person rather than an echo.
3. *The courtesy.* While they are answering you, they never talk over you: knock, and they stop. And the piece never nudges. The only things that move it forward are you knocking and you waiting.

**Reduced motion.** With `prefers-reduced-motion`, marks don't expand or ring; they appear and fade, slightly faster. Timing, sound and the ending are identical, because the feeling is in the timing, not the motion.

**Colour schemes.** A pale plaster wall by day and a dark one by night, following your system setting. In the light scheme your knock is a warm pressure-shadow and theirs a cool bloom; in the dark scheme yours is warm light and theirs cool light.

**Haptics.** On browsers that allow it (Android Chrome), their knocks also vibrate the phone for 12 ms (22 ms once the wall has cleared), so you feel them in your hand. iOS doesn't allow this; nothing is lost but the buzz.

**Files.** `wall.js` is the neighbour: a pure state machine with no DOM, timers or audio, loadable as a plain script or with `require`. The page gives it the clock and your taps and plays back the events it returns. `app.js` draws, synthesises and listens. `wall.test.mjs` is the structure test and `app.test.mjs` the page test. Nothing persists between loads and the page makes no network requests.

### The structure, with numbers (spoilers)

Everything in this table is asserted by `wall.test.mjs` against `wall.js`; the lag, the sound of the end and the background catch-up are also asserted by `app.test.mjs` against the page itself.

| | |
|---|---|
| Phrase | ends after 1.4 s of your silence; the last ten knocks are kept |
| Reply 1 | one knock, gain 0.35, 3.0 s after your phrase ends (4.4 s after your last knock), where your hand was |
| Replies 2 and 3 | your rhythm, starting 0.9 s after your phrase ends; each interval ×(1 ± up to 0.07); gain 0.55 ±10%; knock *i* where your knock *i* was |
| Replies 4 onward | the echo, then 0.6 s later a two-knock tag 0.17 s apart ("and you?") |
| Interruption | a knock during a reply drops the rest of it (not during the beat); a reply that has begun still counts |
| Their beat | after 5 replies and 4 s of your quiet (or, at the latest, in place of reply 8): 12 knocks 0.9 s apart, each landing wherever your hand last was |
| On the beat | a knock within ±180 ms of a beat counts (edges inclusive), with the late edge stretched by the lag below; for the first beat of an offering it counts only from the beat onward, because a knock before it is a new phrase and they answer that instead; extra knocks are ignored; a beat you don't join resets the count |
| Lag | how late their knock reaches your ears: one frame (17 ms) plus the audio output latency the browser reports, where it reports one (Chrome 102+, Firefox, Safari 18.4+), up to 200 ms. It only widens the late edge of the window, so a wrong figure makes the beat more lenient, never stricter. It is fixed for each offering when the offering starts |
| Clarity | after each joined beat the next beat comes clearer: the filter opens (clarity 0.25, 0.5, 0.75), their thump, body and click move toward yours, and the knock gets a little louder |
| The end | four consecutive joined beats; then one more knock from them on the next beat, fully clear: no low-pass filter, no pan, and the same thump, body and click as your own knock (only louder), as if there were no wall. The wall lightens and the warmth stays |
| After the end | every knock of yours is answered 40 ms later, clear, where you knocked; *again* appears after 5 s and brings a new neighbour |
| If you don't join | the offering ends after 12 beats, they listen, and after another 4 s of your quiet they offer again, for as long as you like. The piece cannot end without you. A tab left in the background is caught up when you come back, without playing the knocks you missed |
| Determinism | same seed, same knock times and same lag give identical events at any frame rate, through the beat and the end, and in one step over a day; the seed moves only the hesitations and the loudness jitter |
| Persistence | none; a reload is a new neighbour |

## Honest assessment

- **[Certain] The structure is as described.** `wall.test.mjs` (26 checks, Node built-ins only) drives the state machine with a fake clock and asserts every row of the table: the 4.4 s first wait, the postponement if you knock again, echo count/intervals/positions/gain, the tag timings, interruption, nothing after the fourth answer and the beat after the fifth, the beat offering and re-offering, the ±180 ms window edges and the lag-stretched late edge, a knock just before the first beat, the streak reset, four-in-a-row ending with a clarity-1 final knock, the forced beat at reply 8, the post-end 40 ms answers, the ten-knock memory, a single step over 24 hours, and byte-identical event logs at frame cadences from 1 to 5000 ms, through the beat, the end and after it. `app.test.mjs` (6 checks) runs the page itself in a Node vm with a stub canvas, DOM and Web Audio graph: the first answer, a four-hour background stint and an eight-hour stall without the loop dying or a pile of knocks playing, the lag from reported latency, knocks timed by their event time stamp, and the final knock's sound graph (no filter, your voice).
- **[Certain] It runs.** `node tools/smoke.mjs ideas/25-party-wall` passes at desktop and 390 px phone width with no console errors and no overflow. In headless Chromium I played it to the end by touch from `file://` at phone size in light, dark and reduced-motion modes. A brisk scripted player reaches the end in about 28 s (the reviewer's run took 30 s). The AudioContext reports `running`, there are no console errors or warnings, and `localStorage` and `sessionStorage` stay empty. *again* is visible 5 s after the end and restarts to a fresh wall. With the page clock pushed 2.5, 4 and 24 hours ahead to fake a tab left in the background, it catches up (637, 1,019 and 6,112 unanswered offerings) in under 40 ms on a desktop machine with no error, then plays only the live beats.
- **[Certain] No human has felt it.** I cannot hear or touch it. The timing numbers (1.4 s, 3 s, 0.9 s, ±7%, 0.9 s beats, ±180 ms) are design judgements, not measurements. I tuned the visuals from screenshots and the sound from the synthesis graph alone; it may be too dull, too clicky or too quiet on a phone speaker.
- **[Likely] The first wait is in the right range.** Four-and-a-bit seconds of silence after a knock is long enough to doubt and short enough that most people are still looking at the screen. Someone who keeps knocking without a pause of 4.4 s will never get the first answer, which is the rule working as intended, but it will read as broken to a few people.
- **[Likely] The echo reads as an answer rather than a bug.** Jittered intervals at the same positions should feel like a person. A perfectly steady metronome would not.
- **[Speculative] The ending is discoverable.** Nothing tells you to knock along with their beat, and the first five exchanges teach the opposite: knock while they are answering and they stop. The beat is the one time they keep going when you knock, and only that refusal to stop hints that the rule has changed. I think this tension between learned courtesy and the beat is the bigger risk. I also think the beat is slow enough (67 bpm) and the window generous enough (±180 ms) that people who do try will succeed within one offering, but this is the claim I am least sure of. The window is measured from when the page plays the beat, not when you hear it. The late edge allows for the output latency the browser reports, but where it reports none, slow audio output eats into the late half of the window. Touch-input delay is not corrected anywhere. The beat follows your hand, so where you knock does not matter.
- **[Speculative] The two-knock tag is a question and not a tic.** It is meant to read as "and you?". It may read as cute.
- Rough edges: the only instruction is the word *knock*, so some people will tap once and leave before 4.4 s have passed. Audio output latency (tens of milliseconds, more on some Android phones and over Bluetooth) makes your own knock sound slightly late; the beat window allows for it up to 200 ms where the browser reports it, but nothing makes your own knock sound sooner. Without sound the first answer is easy to miss: 4.4 s after your tap, a cool bloom changes the plaster's brightness by about 7% by day and 8% at night, for about a second. The stereo pan of their knocks (slightly to the right, closing as the wall clears) is a spatial fiction. The post-end "answered at once" state is a little noisy if you drum on it. The first screen is, by design, almost blank, so the gallery preview is a frame from mid-conversation.

## Where it could go next

- **A real neighbour.** The honest version of this piece is two phones, two walls, and a peer connection: every rule stays the same except that the other side is a person. The pacing would have to be rebuilt around actual latency and actual impatience.
- **Memory.** They could keep one of your early phrases and knock it back to you, once, near the end: "I remember how you started."
- **Tap code.** A hidden alphabet (5×5 Polybius tap code) so that two people who both know it could say something, slowly, through the same wall.
- **Mood from the wall itself.** Different walls: lath and plaster, brick, a hollow door. Each would filter and delay differently, and the clearing at the end would mean something slightly different.
- **Letting them leave.** A variant where, after the end, the answers come a little later each time and finally stop. I chose not to build it, because this piece is about being answered, and that one would be about something else.

## Revision note

An independent reviewer drove `wall.js` with about 1,800 assertions of their own and played the page in headless Chromium. Every timing rule in the table held. They found one real bug and several overclaims, all now fixed:

- **A tab left in the background for hours broke the page.** One `step()` call gave up after 10,000 events, which is about 94 minutes of their unanswered beat. Coming back after 2.5 h played 2,874 knocks (and vibrations) at once. After 4 h the animation loop died, and the page stopped redrawing until a reload. The guard now scales with the time being caught up. The page catches up in one-minute slices, does not play or draw knocks more than a second overdue, and schedules the next frame before doing anything that could fail.
- **The spoiler-free paragraph got the beat's trigger wrong.** It said going quiet after the fourth answer makes them knock first. It takes five; after four, nothing happens.
- **The beat window ignored audio latency.** It was centred on when the page plays the beat, so on a phone with slow audio output a player knocking with what they hear landed late. The late edge now stretches by the latency the browser reports, plus a frame, up to 200 ms. Knocks are also timed by the input event's time stamp, not by when the handler ran.
- **"±180 ms" was not true of the first beat of an offering.** A knock before that beat is a new phrase, and it cancels the offering. The table now says so.
- **"As if there were no wall" was not true of the sound.** The filter opened, but their thump, body and click stayed darker than yours at any clarity. Their voice now moves to yours as the wall clears, and the final knock has no filter at all.
- **Smaller corrections:** "they never talk over you" now applies only to their answers, since the beat keeps going when you knock. The honest assessment now names the tension between courtesy and the beat. "It works silently" became a warning that the first answer is faint without sound.
- **Tests:** `wall.test.mjs` grew from 17 to 26 checks, and the new `app.test.mjs` (6 checks) tests the page itself.
