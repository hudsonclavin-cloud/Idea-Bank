# Out of Step
> Everyone says the Millennium Bridge wobbled because the crowd fell into step. Twenty years of work since says the crowd probably only had to keep its balance.

**Kind:** research
**Run:** open index.html in a browser
**Made by:** Pendle Ashby

## What it is

A single-page research memo on one question: *did pedestrians have to fall into step with the sway for the London Millennium Bridge's lateral vibration to begin on 10 June 2000?*

The page contains:

- the question, and why it is narrower than "why did it wobble?"
- the common belief and its three roots (Arup's name for it, Fujino's 1993 film of a Japanese footbridge, and the 2005 *Nature* paper on crowd synchrony)
- what the evidence shows, in five numbered points with confidence tags and eighteen numbered citations
- an inline SVG figure of the balance mechanism (a walker as an inverted pendulum on a still deck and on a sliding one)
- a small interactive toy, "the cancellation that doesn't happen": drag the crowd size past the threshold and see that random step forces add like √N and balance corrections add like N. The "walkers in step" switch turns the first into N as well, and it also moves onset from 165 to 127 walkers, through the second row: in-step balance pulses arrive at twice the deck's frequency and pump it parametrically. So synchrony can lower the threshold, but the bridge reaches one without it
- the strongest case for the common belief (five points, argued as well as I could)
- a conclusion with two probabilities, and what evidence would move each of them
- a timeline, a method note with a revision paragraph, and a reference list in which every entry ends with one line saying what that source found

`sources.json` records, for each of the eighteen citations, the exact search query, the page, and the snippet I relied on, plus a note on which bibliographic fields I saw and which I supplied from memory. `check.mjs` cross-checks the page against that file. `sqrtn.test.mjs` checks the toy's two arithmetic claims outside the browser. `toy.test.mjs` runs the page's own toy code and checks its status line against the simulated sway. `claims.test.mjs` checks every quotation against a recorded snippet and pins the corrections listed in the revision note.

## Why I made it

I listed candidates before choosing: the Hawthorne illumination data, Tufte's Challenger chart, the Ford Pinto memo, the Mpemba effect, the Great Fire "ending" the plague, the stirrup-and-feudalism thesis, Phineas Gage, the 7±2 menu rule, the Vasa's two rulers. I crossed off the ones every listicle has done and the ones where the honest answer was just "it's a myth". The bridge stayed on the list because the story is told, uncritically and in the same words, by people who are otherwise careful: it is in the public lectures, the Wikipedia article, the university press releases, and the phenomenon's own name. And because the real answer is better than the myth. It is not that the crowd didn't synchronise (people saw it do so). It is that the synchrony was probably the *effect*. Two thousand people who have never met, each just trying not to fall over, collectively act as a negative shock absorber on a sway too small for them to feel yet. Nobody has to march. The bridge takes off anyway.

What hooked me, specifically, was the inference at the heart of the myth: random steps cancel, the bridge moved, therefore they must have stopped being random. That inference is wrong in a way you can show in ten lines of arithmetic, and I wanted a page where you could feel it as well as read it.

## How it works

**Searching.** I had only web search (about forty queries, listed per-citation in `sources.json`); every direct fetch of a publisher, repository or university page was blocked by the sandbox proxy with HTTP 403, and PubMed Central served a CAPTCHA. So I worked from journal landing pages, repository records, abstracts, and search summaries quoting them. I did not read the full text of any paper cited. For the revision I ran about twenty more searches, and this time PubMed Central served the open-access copies of references 13 and 16, so I could query them directly for specific passages: the 2021 paper's bridge table and Methods, and the 2017 paper's handling of the 165 threshold (recorded as `seen_in_revision`). I still have not read either in full.

**Choosing sources.** I started from the two modern anchors (Macdonald's 2009 *Proc. R. Soc. A* paper and the 2021 *Nature Communications* paper) and walked outward: the Arup paper they both refer to, the Clifton and Changi bridge measurements they cite as precedents, the treadmill experiments, and then the other side (Fujino 1993, Strogatz 2005, Eckhardt 2007, Belykh 2017, Bocian 2017). For each I ran at least one query aimed at the exact title and one aimed at the specific finding I wanted to attribute, and I only attribute what a snippet showed me.

**Weighing.** Full-scale measurements on real bridges outrank laboratory treadmill trials; both outrank models; models outrank press releases. Press releases and Wikipedia appear only to document how the belief is phrased, or to carry the authors' own characterisation of it.

**The page.** Plain HTML with inline CSS, SVG and a little JavaScript; no network, no dependencies. Light and dark schemes follow the system and can be toggled. The toy runs a fixed-step simulation of one damped 0.5 Hz oscillator. The deck feels only the balance row: each walker removes K × (deck velocity) × (1 + 0.6 sin of the walker's sway phase). That a correction follows the deck whatever the walker's phase is assumed, not derived; the step-rhythm row is drawn but not applied. The bridge damping puts onset with random phases at 165 walkers, a number borrowed from Arup's north-span crowd test on a ~1 Hz mode. With the walkers in step, every pulse lands at exactly twice the deck frequency, a principal parametric resonance, and onset falls by a factor 1 + 0.6/2 to 127 walkers. The 0.6 is my choice, so the size of that shift is illustrative. The physics sits in its own `<script id="toy-model">` block so the test can run exactly what the page runs.

**Verification.** `node tools/check.mjs ideas/13-out-of-step` runs `check.mjs` (citation integrity), `sqrtn.test.mjs` (4 tests), `toy.test.mjs` (6 tests: onset at 165 random and 127 in step measured from the page's own simulation; the page's status line agrees with the simulated growth in both modes), `claims.test.mjs` (8 tests), and the headless smoke test at desktop and phone widths. I viewed the screenshots at both widths and in both colour schemes.

## Honest assessment

Claims about the world:

- [Certain] Arup's 2001 paper reports the pedestrian lateral force as related to deck movement and states the "below about 1.3 Hz with enough pedestrians" rule; Arup named the phenomenon "synchronous lateral excitation" and read it as walkers falling into step.
- [Certain] That force-velocity law does not decide the question: the balance model gives it without synchrony, and the 2007 synchrony model (Eckhardt et al.) reproduces it too.
- [Certain] Fujino et al. (1993) found 20% or more of pedestrians synchronised on a congested bridge in Japan; Strogatz et al. (2005) modelled the Millennium Bridge as crowd synchrony and wrote that pedestrians "fell spontaneously into step".
- [Certain] Macdonald (2008) found no significant synchronisation on the Clifton Suspension Bridge under crowd loading; Macdonald (2009) and Bocian et al. (2012) showed an inverted-pendulum walker acts as a negative damper without synchronising, matching full-scale data; Belykh et al. (2021) found the instability emerges from uncorrelated walkers in three models including one built to synchronise, and call coherence a consequence of the instability.
- [Certain] Several modes moved on opening day, from about 0.5 to about 1 Hz. The 2021 paper's table lists 0.5, 0.8 and 1.0 Hz, and Feldman's own letter notes a second centre-span mode at about 1.0 Hz of similar amplitude.
- [Likely] Arup's *Ingenia* account says the movement occurred more often on the south span (0.77 Hz) and in the centre span's first mode (0.49 Hz) than on the north span (1.05 Hz). I saw this sentence quoted in one search summary and could not open the page to check it.
- [Speculative] Feldman's frequency mismatch (0.5 Hz mode versus ~1 Hz sideways rhythm) as evidence that onset needed no synchrony. It covers one mode only, and even there walkers in step at twice the deck frequency could pump it parametrically (Piccardo and Tubino, 2008). I first tagged this Likely and said I could not find the other frequencies, though two of my own sources had them.
- [Likely] The ~165-walker critical crowd is Arup's figure from its December 2000 crowd test on the north span, a ~1 Hz mode that matches walkers' sideways rhythm. The 2005 paper shows that test on the north span, and the 2017 model cites Arup for 165 and is tuned to it. I have not seen the number and the span stated together in one source.
- [Likely] Synchronisation contributed to the *amplitude* once the sway was established. Support: Bocian et al. (2017) measured weak "phase pulling" and suggest it explains why pure balance models underestimate on-site negative damping; Belykh, Jeter and Belykh (2017) conclude that lock-in was necessary for the bridge's large swaying while calling synchrony-as-initiator an oversimplification (first seen in two search summaries; confirmed in revision against the open-access text, which says "crowd phase locking was necessary for the London Millennium Bridge to wobble significantly").
- [Speculative] That design codes would be clearer if the word "synchronous" were dropped from the phenomenon's name. That is my opinion, listed on the page as something that would confirm, not evidence.

Probabilities on the page: 25% that the common story (falling into step caused the onset) is right, up from 15% before the review; 60% that synchronisation materially amplified the sway after onset, unchanged. The onset figure moved because two London-specific arguments I had leaned on (the force law and the frequency mismatch) turned out not to discriminate, the crowd test the models are compared with was on a span where synchrony is most plausible, and synchrony can pump even the 0.5 Hz mode. It stays well below even because Clifton, the treadmill measurements and the 2021 three-model result still say onset needs no synchrony. The amplitude figure stays: the review added ways synchrony could amplify, but no measurement of it, and the 2021 paper's table lists no direct evidence of synchronisation on the London bridge.

Bibliographic fields: after a second verification pass (recorded as `seen_in_followup` in `sources.json`) every field in the reference list was confirmed at source except two. One is the byline of the 2001 *Ingenia* article (reference 6), which two secondary citations credit to Fitzpatrick and Ridsdill Smith of Arup; I could not see it on the Ingenia page. The other is the journal volume and pages of Piccardo and Tubino (reference 18, added in revision), which I supplied from memory. Both references say so on the page.

What I most wanted to read and could not: the body of Dallard et al. (2001), which holds the critical-number formula and the crowd-test details; the rest of Belykh et al. (2021), especially the ~30-bridge comparison (in revision I saw only its Table 1 and Methods); and Bocian et al. (2017), to see how large the phase-pulling correction actually is.

Known limitations of the page: the toy is an illustration of the Arup negative-damping model, not a biomechanical simulation. Its balance row assumes the result it illustrates, its 165 comes from a ~1 Hz span but sits on a 0.5 Hz mode, and the in-step shift to 127 depends on a pulse depth I chose; its parameters are chosen for visibility. I rounded the crowd estimates to a range because sources disagree (80,000–100,000 crossings).

## Where it could go next

- Replace the toy's phenomenological "balance row" with an actual inverted-pendulum walker following Macdonald's foot-placement rule, so the negative damping is computed rather than assumed, and show the frequency-ratio dependence (where walkers become positive dampers). Give the walkers a realistic spread of sway frequencies around twice the deck's, so the parametric shift is sized rather than chosen.
- Add the other bridges in the 2021 data set as a second memo: which of the "almost 30" show any synchrony at all.
- A companion memo on the parallel Feldman drew: the Tacoma Narrows "resonance" story, where the same textbook-versus-literature gap exists.
- Find out which span started moving first on opening day, and at what crowd. More than anything else, that decides what the frequency argument is worth.

## Revision note

An independent reviewer checked the memo, its sources and its toy. I reproduced each finding with my own code or searches before changing anything. All seven held up, and all are now fixed:

- **The toy contradicted its caption.** With "in step" on, every walker's balance pulse arrived at exactly twice the deck frequency and pumped it parametrically. Onset fell from 165 to 127 walkers, while the label still said "net damping positive: sway decays" and the caption said the switch "changes nothing about when the bridge takes off". The page's own code, run with noise off, gives a growth rate of +0.016/s at 140 walkers in step, against −0.024/s out of step. The label now reports onset in both modes, and the caption explains the 2:1 mechanism. `toy.test.mjs` checks the label against the simulation.
- **The 165-walker threshold was misplaced.** It comes from Arup's north-span crowd test on a ~1 Hz mode, not from the centre span. The caption now says the toy borrows it.
- **The frequency-mismatch point covered one mode of several.** It is now limited to the 0.49 Hz mode and tagged Speculative, down from Likely. The frequencies I said I could not find were in two of my own sources.
- **Arup's force law was tagged as Certain evidence for no synchrony.** The synchrony model reproduces the same law, and Arup itself read it as synchronisation. The point is now two-sided, and the conclusion no longer says the engineers' model "said this". The tagline and standfirst no longer credit "the engineers who measured it".
- **The strongest case for synchrony was missing three things.** It now includes the north-span test, the synchronised cases in the 2017 lab trials, and the 2:1 parametric route, which is the new reference 18.
- **Smaller fixes:** a misquotation ("very well" for "very good agreement"); the toy caption now says the balance row is assumed and the step row is not applied; a Wikipedia quotation is trimmed to the words my recorded snippet shows; and the verdict box now uses the full width on a phone.
- **Probabilities:** onset moved from 15% to 25%, and the amplitude estimate stays at 60%. The Honest assessment gives the reasons.

One correction to the review itself: it says *most* movement was on the south span. The *Ingenia* sentence groups the south span (0.77 Hz) with the centre span's 0.49 Hz mode as the more frequent, so the page says that instead.
