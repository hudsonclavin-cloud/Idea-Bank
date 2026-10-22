# Out of Step
> Everyone says the Millennium Bridge wobbled because the crowd fell into step. The engineers who measured it, and twenty years of work since, say the crowd only had to keep its balance.

**Kind:** research
**Run:** open index.html in a browser
**Made by:** Pendle Ashby

## What it is

A single-page research memo on one question: *did pedestrians have to fall into step with the sway for the London Millennium Bridge's lateral vibration to begin on 10 June 2000?*

The page contains:

- the question, and why it is narrower than "why did it wobble?"
- the common belief and its three roots (Arup's name for it, Fujino's 1993 film of a Japanese footbridge, and the 2005 *Nature* paper on crowd synchrony)
- what the evidence shows, in five numbered points with confidence tags and seventeen numbered citations
- an inline SVG figure of the balance mechanism (a walker as an inverted pendulum on a still deck and on a sliding one)
- a small interactive toy, "the cancellation that doesn't happen": drag the crowd size past the threshold and see that random step forces add like √N, balance corrections add like N, and the "walkers in step" switch changes the first and not the bridge
- the strongest case for the common belief (four points, argued as well as I could)
- a conclusion with two probabilities, and what evidence would move each of them
- a timeline, a method note, and a reference list in which every entry ends with one line saying what that source found

`sources.json` records, for each of the seventeen citations, the exact search query, the page, and the snippet I relied on, plus a note on which bibliographic fields I saw and which I supplied from memory. `check.mjs` cross-checks the page against that file. `sqrtn.test.mjs` checks the toy's two arithmetic claims outside the browser.

## Why I made it

I listed candidates before choosing: the Hawthorne illumination data, Tufte's Challenger chart, the Ford Pinto memo, the Mpemba effect, the Great Fire "ending" the plague, the stirrup-and-feudalism thesis, Phineas Gage, the 7±2 menu rule, the Vasa's two rulers. I crossed off the ones every listicle has done and the ones where the honest answer was just "it's a myth". The bridge stayed on the list because the story is told, uncritically and in the same words, by people who are otherwise careful: it is in the public lectures, the Wikipedia article, the university press releases, and the phenomenon's own name. And because the real answer is better than the myth. It is not that the crowd didn't synchronise (it did, visibly). It is that the synchrony was the *effect*. Two thousand people who have never met, each just trying not to fall over, collectively act as a negative shock absorber on a 0.5 Hz mode they cannot feel yet. Nobody marches. The bridge takes off anyway.

What hooked me, specifically, was the inference at the heart of the myth: random steps cancel, the bridge moved, therefore they must have stopped being random. That inference is wrong in a way you can show in ten lines of arithmetic, and I wanted a page where you could feel it as well as read it.

## How it works

**Searching.** I had only web search (about forty queries, listed per-citation in `sources.json`); every direct fetch of a publisher, repository or university page was blocked by the sandbox proxy with HTTP 403, and PubMed Central served a CAPTCHA. So I worked from journal landing pages, repository records, abstracts, and search summaries quoting them. I did not read the full text of any paper cited.

**Choosing sources.** I started from the two modern anchors (Macdonald's 2009 *Proc. R. Soc. A* paper and the 2021 *Nature Communications* paper) and walked outward: the Arup paper they both refer to, the Clifton and Changi bridge measurements they cite as precedents, the treadmill experiments, and then the other side (Fujino 1993, Strogatz 2005, Eckhardt 2007, Belykh 2017, Bocian 2017). For each I ran at least one query aimed at the exact title and one aimed at the specific finding I wanted to attribute, and I only attribute what a snippet showed me.

**Weighing.** Full-scale measurements on real bridges outrank laboratory treadmill trials; both outrank models; models outrank press releases. Press releases and Wikipedia appear only to document how the belief is phrased, or to carry the authors' own characterisation of it.

**The page.** Plain HTML with inline CSS, SVG and a little JavaScript; no network, no dependencies. Light and dark schemes follow the system and can be toggled. The toy runs a fixed-step simulation of one damped oscillator whose net damping is the bridge's own minus N × (per-walker feedback), with the threshold placed at 165 walkers; its first two rows are literal sums of sinusoids and of velocity-proportional corrections.

**Verification.** `node tools/check.mjs ideas/13-out-of-step` runs `check.mjs` (citation integrity), `sqrtn.test.mjs` (4 tests), and the headless smoke test at desktop and phone widths. I viewed the screenshots at both widths and in both colour schemes.

## Honest assessment

Claims about the world:

- [Certain] Arup's 2001 paper reports the pedestrian lateral force as related to deck movement and states the "below about 1.3 Hz with enough pedestrians" rule; Arup named the phenomenon "synchronous lateral excitation".
- [Certain] Fujino et al. (1993) found 20% or more of pedestrians synchronised on a congested bridge in Japan; Strogatz et al. (2005) modelled the Millennium Bridge as crowd synchrony and wrote that pedestrians "fell spontaneously into step".
- [Certain] Macdonald (2008) found no significant synchronisation on the Clifton Suspension Bridge under crowd loading; Macdonald (2009) and Bocian et al. (2012) showed an inverted-pendulum walker acts as a negative damper without synchronising, matching full-scale data; Belykh et al. (2021) found the instability emerges from uncorrelated walkers in three models including one built to synchronise, and call coherence a consequence of the instability.
- [Likely] Feldman's frequency-mismatch argument (0.5 Hz mode versus ~1 Hz stepping) is correct for the centre span's lowest mode; I could not confirm the frequencies of the other modes that moved, so I weight it modestly and say so on the page.
- [Likely] Synchronisation contributed to the *amplitude* once the sway was established. Support: Bocian et al. (2017) measured weak "phase pulling" and suggest it explains why pure balance models underestimate on-site negative damping; Belykh, Jeter and Belykh (2017) conclude that lock-in was necessary for the bridge's large swaying while calling synchrony-as-initiator an oversimplification (seen in two independent search summaries of the paper, not as verbatim abstract text).
- [Speculative] That design codes would be clearer if the word "synchronous" were dropped from the phenomenon's name. That is my opinion, listed on the page as something that would confirm, not evidence.

Probabilities on the page: 15% that the common story (falling into step caused the onset) is right; 60% that synchronisation materially amplified the sway after onset.

Bibliographic fields: after a second verification pass (recorded as `seen_in_followup` in `sources.json`) every field in the reference list was confirmed at source except the byline of the 2001 *Ingenia* article (reference 6), which two secondary citations credit to Fitzpatrick and Ridsdill Smith of Arup; I could not see it on the Ingenia page and the reference says so.

What I most wanted to read and could not: the body of Dallard et al. (2001), which holds the measured modal frequencies and the critical-number formula; the full text of Belykh et al. (2021), especially the ~30-bridge comparison; and Bocian et al. (2017), to see how large the phase-pulling correction actually is.

Known limitations of the page: the toy is an illustration of the Arup negative-damping model, not a biomechanical simulation; its parameters are chosen for visibility. I rounded the crowd estimates to a range because sources disagree (80,000–100,000 crossings).

## Where it could go next

- Replace the toy's phenomenological "balance row" with an actual inverted-pendulum walker following Macdonald's foot-placement rule, so the negative damping is computed rather than assumed, and show the frequency-ratio dependence (where walkers become positive dampers).
- Add the other bridges in the 2021 data set as a second memo: which of the "almost 30" show any synchrony at all.
- A companion memo on the parallel Feldman drew: the Tacoma Narrows "resonance" story, where the same textbook-versus-literature gap exists.
- If a reviewer with full-text access fills in the three flagged fields and the modal frequencies from Dallard et al., tighten the Likely tag on the frequency-mismatch point one way or the other.
