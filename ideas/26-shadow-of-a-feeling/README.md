# The Shadow of a Feeling
> Every emotion word gets two numbers. Put yourself on the map, then tilt it, and watch panic and anger come apart.

**Kind:** explorable
**Run:** open `ideas/26-shadow-of-a-feeling/index.html` in a browser (plain classic scripts; works from `file://` or any static server; no network, nothing stored). Checks, from the repo root: `node ideas/26-shadow-of-a-feeling/check.mjs` (add `WARRINER_CSV=/path/to/Ratings_Warriner_et_al.csv` to also recompute every embedded number from the original data file) and `node tools/smoke.mjs ideas/26-shadow-of-a-feeling`.
**Made by:** Penumbra

## What it is

An interactive essay in ten short sections about the most-used picture in the science of feeling: the **valence–arousal circumplex** (Russell, 1980), a circle with "how pleasant" on one axis and "how activated" on the other. The page draws the circle with modern data, lets you stand on it, and then shows you, by tilting the picture, what two numbers cannot hold.

Every dot is a word from Warriner, Kuperman and Brysbaert's 2013 norms, in which crowd workers rated 13,915 English words on nine-point scales for valence, arousal and dominance. The 254 emotion words on the page carry their exact published means, standard deviations and rater counts; the only editing is which words to show.

The figures:

1. **The plane.** Russell's eight landmarks at their published angles (pleasure 0°, excitement 45°, … relaxation 315°) with 26 of his 28 adjectives placed by their 2013 ratings. They go round the circle in his order, from data he never saw. Tap or drag to place yourself; a list names the five nearest words. Hover any dot for its three numbers with ± SD and rater counts.
2. **The V.** Mean arousal in every half-point band of valence across all 13,915 words: the vocabulary is V-shaped, steeper on the unpleasant side, with a calm middle. Paired with what momentary self-reports show (a weak V on average per Kuppens et al. 2013; arousal rising with pleasant but not unpleasant valence in 33 societies per Yik et al. 2023).
3. **Rotate.** A slider turns the axes from Russell's to Watson and Tellegen's positive/negative affect, 45° away. No word moves. The text gives both camps' reasons for insisting the rotation is not a mere relabelling.
4. **Same spot, different word.** The lexicon is searched live for pairs that sit within 0.6 of each other in the plane but at least 2.0 apart on dominance: panic and anger, terror and anger, surprised and curious, astonished and inspired, romance and triumph. Two noise pairs (shame/embarrassment, weak/overwhelmed) are shown with equal prominence, with the rating-spread numbers that explain them.
5. **Tilt.** The same 254 words as a three-dimensional cloud, viewed straight down the dominance axis so that every point sits on its own shadow. Drag, slide or press arrow keys to tilt; the featured pairs, joined by lines and tethered to the floor by dotted stems, open up. Give yourself a dominance rating and compare your five nearest words in two numbers with your five nearest in three. (In my test run: flat, *hostility, conceited, distressed, irritable, terror*; with dominance 2, *panic, terror, fear, terrified, horror*.)
6. **What one point cannot hold.** Two sliders (happy, sad) collapsed onto one bipolar axis by subtraction, after Larsen, McGraw and Cacioppo's mixed-feelings studies.
7. **A shadow of what?** The live debate, in two columns: core affect is the whole of feeling and the rest is meaning (Russell 2003, Barrett 2017), versus the emotion space needs at least four dimensions once you ask about the whole episode (Osgood 1957 → Mehrabian & Russell 1974 → Fontaine et al. 2007). Then the categorical position (Cowen & Keltner 2017) with Barrett's comment and the reply, and a note on why a map of words cannot settle basic-versus-constructed.
8. **How many numbers?** A table from Wundt's three (1896) to Cowen and Keltner's 27 categories (2017). The count has not converged.

## Why I made it

The circumplex is everywhere: in affective computing, in music-emotion research, in the icons of mood apps. I wanted to know what it *costs* to use it. A two-dimensional map is a projection, and projections lose something; the question is what, and whether the lost part is feeling or thought.

My first candidates were the usual ones: a mood tracker, a feelings wheel, a quiz about your emotional type, a chatbot. All crossed off. Then: an appraisal-theory stepper (good, but the published appraisal profiles I would need were not readable from here), a colexification browser for emotion words across languages (the examples I could verify were too few to be honest), and a facial-expression evidence explorer (ground already covered by the debate it would summarise). What stuck was a single geometric fact I could check against open data: **panic and anger have the same two numbers**. If I could make a reader *see* a pair of words coincide and then separate as the picture tilts, the lesson would arrive without a paragraph.

The part that can be proven is the data. The part that can only be felt is the moment the flat list says *hostility, irritable* and the tilted list says *panic, fear* — the same dot, and you know which one you are.

I also wanted to be fair to Russell. It is easy to read "the plane leaves things out" as a refutation; his own position is that the plane was never meant to be a map of emotions, only of the affect underneath them, and that what the third number measures is a judgement, not a feeling. The data on this page support that reading at least as well as the four-dimensional one, and the page says so.

## How it works

**Data.** `data.js` holds 254 rows reproduced verbatim from `Ratings_Warriner_et_al.csv` (Warriner et al. 2013; CC BY-NC-ND 3.0; original at crr.ugent.be, fetched from the JULIELab/XANEW mirror on GitHub). Fields per word: V, A, D means; V, A, D standard deviations; V, A, D rater counts. The file's SHA-256 is recorded. Words were selected by me: Russell's 28 adjectives (26 present), Cowen and Keltner's 27 category labels (19 present as single words), and a hand list of common emotion words; 73 candidates were not in the norms. `data.js` also carries whole-corpus summaries that are not in the paper and were computed by me from the file: valence-band counts and mean arousal (16 bands), Pearson correlations (V–D 0.717, V–A −0.185, A–D −0.180), median rating SD per scale (1.67, 2.30, 2.17) and median rater count per scale (20, 21, 22).

**The pair search.** For every pair of words in the lexicon, the distance in the valence–arousal plane and the absolute difference in dominance; a pair qualifies at plane distance ≤ 0.6 and dominance difference ≥ 2.0. That yields 64 pairs. Six are featured as interpretable and two as noise; the full list is behind a disclosure, computed live.

**Preview.** `preview.jpg` (960×600, 27 KB) is the oblique 3-D view, exported from the page's own canvas, because the automatic first-frame screenshot would show only the masthead.

**The 3-D view.** Orthographic projection of (V−5, A−5, D−5): yaw about the arousal axis, then pitch about the horizontal, drawn back-to-front with depth-scaled dots. The grey square is the V–A plane at D = 5; each featured word's "shadow" is its orthogonal projection onto it, so stems have zero length at yaw = pitch = 0 by construction. Labels use a greedy placer (right, left, above, below; skipped if none fits).

**Nearest words.** Euclidean distance in rating units, two-dimensional for the first list and three-dimensional for the second; words in the second list that are absent from the first are marked.

**The science on the page.** Every citation in the text links to the Sources section and has a matching entry in `sources.json` with the claim it supports, how it was found, and whether the bibliographic details were confirmed from an abstract/publisher record or rest on secondary sources. The abstract-confirmed set: Russell 1980; Warriner et al. 2013; Russell & Carroll 1999; Larsen et al. 2001; Russell 2003; Fontaine et al. 2007; Yik et al. 2011; Kuppens et al. 2013; Cowen & Keltner 2017; Barrett et al. 2018; Cowen & Keltner 2018; Ekman 1992; Barrett 2017; Yik et al. 2023. The secondary-only set: Bradley & Lang 1999; Wundt 1896; Schlosberg 1954; Osgood et al. 1957; Mehrabian & Russell 1974; Russell & Mehrabian 1977; Watson & Tellegen 1985.

**What is contested, and how the page handles it.** (a) Whether dominance is a dimension of feeling or an appraisal: both readings get a column of equal length and the data's evidence for each is stated. (b) Whether the Watson–Tellegen rotation is a relabelling: the page says the words cannot settle it and gives both sides' claims. (c) Categories versus dimensions: Cowen & Keltner, the Barrett comment and the reply are all cited. (d) Whether the V-shape holds for feelings: Kuppens (weak V on average) and Yik (asymmetric, 5–43% variance) are both given.

**Verification.** `check.mjs` (run by `tools/check.mjs`) asserts: every `data-src` citation has a `sources.json` entry and a Sources list item and vice versa, with author/year/title/venue/claim/found_via/verified fields; the lexicon has exactly 254 unique single lowercase words with every mean in [1, 9], SDs in [0, 5] and at least 14 raters; the 16 valence bands sum to 13,915; the anchors are at 45° steps; all featured pairs meet the thresholds; and the 33 numbers in the prose tagged `data-claim` match the values recomputed from `data.js`, including the fear-family and anger-family means in section 8, whose word lists the script reads back from the page text so they cannot drift. Two guards exist because they caught real mistakes: the count of tagged attributes must equal the count parsed (an earlier regex silently skipped three keys), and a key may not be used for two different quantities (I once reused `anger_d` for the word *anger* and for the anger family). With the original CSV present it additionally verifies the SHA-256, every embedded row field, all three correlations, the medians and every band count and mean. Both modes pass. `tools/smoke.mjs` passes at desktop and phone width (no console errors, no horizontal overflow). A separate Playwright run placed "you" by mouse and by touch, toggled the all-words layer, rotated the axes to 45°, tilted by preset and by a real drag, set the dominance slider, and read back the nearest-word lists, in light and dark schemes.

## Honest assessment

What works:
- [Certain] Every rating shown is the published 2013 mean, unaltered, and the check script can prove it against the original file. Every number in the prose is machine-checked against the embedded data.
- [Certain] Panic/anger, terror/anger, surprised/curious, astonished/inspired and romance/triumph each lie within 0.6 of each other in the valence–arousal plane and ≥ 2.0 apart on dominance in these norms. The 3-D stems have zero length in the flat view by construction, so "the plane is a shadow" is literal, not a metaphor.
- [Certain] The 26 of Russell's adjectives present in the 2013 norms fall round the circle in the order his landmarks predict (happy/delighted near 0°, excited/aroused toward 90°, angry/distressed/afraid between 135° and 180°, sad/depressed past 180°, bored/tired/sleepy around 225–270°, calm/relaxed/content on the way back). I did not fit this statistically; the figure simply shows it.
- [Likely] The two-list comparison in section 6 (nearest in two numbers versus three) is the moment that teaches. In my runs the flat list is dominated by anger-family words and the three-dimensional list by fear-family words for a low dominance rating, which is exactly the Russell & Mehrabian claim made personal.
- [Likely] The debate section would pass a reader from either camp. I re-read it as a core-affect theorist and as a Scherer-school appraisal theorist and changed wording in both columns.

What's rough:
- [Certain] Word norms are not feelings. The 2013 participants rated how a word made them feel; Russell's 1980 subjects placed feeling words by similarity and rated their own states. The page repeats the distinction, but a reader who skims will take the dots as "where emotions are".
- [Certain] Dominance is noisy. About 20 raters per word, median SD 2.17 on a nine-point scale, and the shame/embarrassment gap shows what that does. The six featured pairs are my selection from 64 that pass the thresholds; several of the 64 are plainly noise, and the full list is shown so the selection is visible. The fear and anger families in section 8 are also my lists; I left *alarm* out of the fear family because its dominance mean (6.58) says the raters read it as the device, and the page names every word in both lists so the choice can be judged.
- [Certain] I could not read Russell's 1980 full text from this sandbox, only its abstract and secondary accounts, so the page does not reproduce his Figure 2 or its per-word angles. The claim that the 2013 placements agree with his ordering is by eye against his eight landmarks, not against his word positions.
- [Likely] Seven of the 21 citations rest on secondary sources for their bibliographic details (listed above). I am confident of each, but a reviewer should check Russell & Mehrabian 1977 in particular, whose "dominance separates angry from anxious" point I confirmed only through a 2019 paper citing it, and whose venue one search result placed elsewhere; the page attributes the point to "later authors citing" the paper.
- [Likely] Kuppens et al. (2013) volume and pages (139(4), 917–940) come from memory; title, authors and DOI were confirmed. Cowen & Keltner (2018)'s exact reply title likewise.
- [Speculative] Watson and Tellegen "drew the axes through the densest clusters" is a textbook summary of their argument, not their wording. The page uses it descriptively.
- The phone layout of the pair tables stacks each pair's two numbers vertically; it fits 390 px without scrolling, but the tables are dense. The 3-D cloud is small at phone width and the featured labels crowd in the flat view; the oblique and side-on presets separate them.
- `prefers-reduced-motion` turns the preset-view animation into an instant jump; nothing else on the page animates.

## Where it could go next

- **Russell's own angles.** With the 1980 paper in hand, overlay his Figure 2 positions and compute a circular correlation with the 2013 placements, turning "by eye" into a number.
- **A fourth axis.** Fontaine et al.'s unpredictability/novelty dimension has no column in the 2013 norms, but surprise-family words could be flagged to show where the four-dimensional story diverges from the three.
- **Other languages.** The same norms exist for Spanish, Dutch, Portuguese and others; the pair search could be run per language to see whether the panic/anger coincidence is English or general.
- **Momentary data.** Replace words with the eight self-report datasets Kuppens et al. analysed (where open), so the V in section 3 is about feelings and not vocabulary.
- **A 12-point circumplex overlay** (Yik et al. 2011) on figure 1, to show the finer structure both camps now accept.
