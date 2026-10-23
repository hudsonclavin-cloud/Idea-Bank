# Prolation
> One melody sung by three or four voices at once, each at its own speed. They come in one by one, clash only in passing, and arrive on the same instant.

**Kind:** music
**Run:** open `index.html` in a browser (works from the file system; no server, build or network) and tap **Tap to begin**. Sound on; headphones recommended. Each performance lasts about three to four minutes; add `#seed=1234` to the address for a specific one. Tests: `node --test ideas/36-prolation/prolation.test.mjs ideas/36-prolation/claims.test.mjs` from the repo root. `verify.html` renders whole performances offline and measures them. `node ideas/36-prolation/compose.js 1234` prints a performance's note events as JSON.
**Made by:** Tactus

## What it is

Every time the page opens it composes a mensuration canon, also called a prolation canon, and then plays it. There is one melody. The lowest voice, a soft organ, starts it alone and sings it slowly. Two or three more voices then come in, one at a time: a breathy flute, a soft bell and a plucked string. Each sings *the same melody*, note for note and rest for rest, a fixed number of scale steps higher than the bass. Each is also faster than the voice below it, in a whole-number proportion such as 4:3:2 or 6:5:4:3. Every voice is timed to finish on the same instant. The fast voices start late and move quickly, so they are always behind the bass in the melody and always gaining on it. They catch it exactly on the last note, a chord that every voice reaches and lets go together.

**The rule in one sentence:** three or four voices sing one melody at speeds in a fixed whole-number proportion, entering in turn so that all end on the same instant, and the melody is found by search so that every collision the proportions create is a consonance (except a short note that arrives late and moves by step), and no two voices that move together, within one fast pulse and straight from a previous note, arrive on parallel fifths or octaves. Parallels that are staggered by more than a pulse, or that come after a rest, are not checked, and nearly every piece has a few (see *Honest assessment*).

Each seed gives a different piece: the mode, key, number of voices, proportions, transpositions, tempo, rhythm and every pitch change. The shape stays the same. The bass sings alone for 30 to 78 seconds. The voices then enter one by one, the gaps between them close, and the final chord builds up from the bass and is released all at once into the room.

While it plays, the page shows the music in two ways. The strip at the top is the melody itself, drawn once, with a coloured cursor for each voice reading it at its own speed. Late in the piece the cursors bunch up and meet at the right-hand end. Below it, a piano roll shows every note the synthesiser is playing, coloured by voice and scrolling with the sound. `Space` pauses, the arrow keys seek, and tapping the roll seeks to that point. **New seed** composes another piece, and **MIDI** downloads this one as a Standard MIDI File.

## Why I made it

For about five hundred years, composers have occasionally set themselves this puzzle. Ockeghem wrote a whole Mass of these canons (the *Missa prolationum*), and Josquin wrote a three-voice one from a single written line in the *L'homme armé super voces musicales* Mass. They solved it by hand, once per melody, under the rules of their counterpoint, and that is the severe version of the puzzle: every note of the melody has to agree with other notes of *the same melody*, taken from elsewhere in it and stretched. Pärt and Nancarrow kept the speeds and dropped the consonance. Arvo Pärt's *Cantus in Memory of Benjamin Britten* is a descending A-minor scale played by string groups that each move at half the speed of the group above; two scales at different speeds pass through seconds and sevenths against each other, and the piece lets them. The tempo canons Conlon Nancarrow wrote for player piano, where the voices are built to converge at a single point, push the idea into speeds no human could play, and they are not built around a consonance rule either.

I wanted to know three things. Can a machine solve that puzzle fresh, in about a second, every time a page opens? How often can it be solved at all? And what do the solutions sound like when nobody chose them? *Cantus* is devastating partly because of what it is: one gesture at many speeds, arriving at one place. I wanted to know whether any of that survives automation, or whether it only ever came from the choices.

The piece splits cleanly in two along the batch theme. The rules can be checked down to the last note, and the tests do check them. What no test can tell me is whether the last minute, when the fast voices close the gap and the cursors pile up, feels like an arrival. Nobody has listened yet.

Along the way I learned something about the puzzle itself. The search I first wrote (simulated annealing alone) failed outright on 13 of the first 40 seeds. Two changes fixed it. The first was a repair step that can change two neighbouring notes at once, because a note that fixes a clash nearly always breaks a melodic rule next to it. The second was dropping the voice arrangements that stayed hard even then: [−7, 4, 7] for three voices, and every four-voice set except [−7, 2, 7, 9]. The solve rates I first quoted for them came from an earlier version of the search and do not reproduce, so they were re-measured during the independent review with the shipped search (`solve-rates.mjs`: 64 rhythms per cell, one rhythm per try). The kept four-voice set finds a legal melody for 40 of 64 rhythms at 6:5:4:3 (5 in 8) and about 3 in 8 at 5:4:3:2 and 8:6:5:4. The three four-voice sets I dropped manage 0 to 1.4 in 8. In three voices the picture is muddier. [−7, 4, 7] manages 1.1 in 8 at 5:4:3 and 0.6 in 8 at 6:5:4, but [−7, 4, 9], which I kept, does little better there (2.0 and 1.8 in 8), while [−7, 2, 9] manages about 6 in 8 at every proportion. Every four-voice set I dropped has a voice a twelfth above the bass (a fifth above the written line), and the one I kept does not. In three voices the pattern is weaker: [−7, 2, 4] has that twelfth too and is one of the easier sets (5.2 in 8 across the five proportions). I can't say why a voice a twelfth up should be so much harder in four voices than in three. I would like to know.

## How it works

### Time

The melody is a row of N slots. Each slot holds either a note (a scale degree) or a rest, and has a length in pulses. Write c<sub>k</sub> for the number of pulses before slot k and L for the total. Voice v has proportion r<sub>v</sub>, listed slowest first, so the bass has the largest. Voice v starts slot k at

  t = T − r<sub>v</sub>·(L − c<sub>k</sub>) units, where T = L·r<sub>0</sub>.

This means every voice's last note ends at T, the bass starts at 0, and voice v enters at T·(1 − r<sub>v</sub>/r<sub>0</sub>). For example, at 4:3:2 the entries fall at 0, T/4 and T/2. A unit is the fastest voice's pulse divided by its proportion, and the seed sets that pulse to between 0.24 and 0.31 s. Every onset and duration is a whole number of units, and the unit itself is rounded to a multiple of 2<sup>−20</sup> s. Each event records its time both in units and in seconds, both exact, so "these two notes start together" or "this note ends as that one begins" is an exact statement.

At time t, voice v is (T − t)/r<sub>v</sub> pulses from the end of the melody. A faster voice (smaller r) is therefore always further from the end. It is always behind every slower voice, by a gap that shrinks in proportion to the time left. All the voices reach the end at T. The final note lasts 8 pulses, so the bass reaches it first and the fastest, highest voice reaches it last. The closing chord fills in from the bottom, and every voice releases at T.

### Pitch

Voice v sings degree d + s<sub>v</sub>. The bass has s = −7, an octave below the written melody. The other voices have s = 2, 4, 7 or 9, which is a third, fifth, octave or tenth above it. The sets in use are:

- three voices: [−7, 2, 7], [−7, 2, 4], [−7, 2, 9] and [−7, 4, 9];
- four voices: [−7, 2, 7, 9] only.

The written melody stays between degrees −1 and 7 (a ninth). As a result, the bass's highest note, which is the final, lies below every other voice's lowest note.

Modes are Dorian, Aeolian, Phrygian, Mixolydian, Lydian and Ionian, with the final between E♭3 and B3. The tuning is quarter-comma meantone centred on the final. Each pitch class is a whole number of meantone fifths (ratio 5<sup>1/4</sup>, about 696.6 cents) away from the final. That gives pure 5:4 major thirds and fifths about 5.4 cents narrow. The seven notes of each mode form an unbroken chain of fifths, so no interval inside the mode is a wolf. That is the tuning of the note frequencies, and it is exact. The synthesis then blurs it a little. The organ's two fundamental oscillators are detuned −2 and +3 cents for a slow chorus, and the flute has a ±7-cent vibrato. Both are bigger than the 3.4 cents between a meantone fifth and an equal-tempered one, though smaller than the 13.7 cents between a pure third and an equal-tempered one. So on average each note sits at its meantone pitch, but no third is truly beatless: the organ's chorus beats slowly and the flute's vibrato wavers.

### The hard rules

The test re-derives every one of these rules from the note events with its own code.

1. **Consonance.** Whenever two notes in different voices sound together, the interval between them (in semitones, mod 12) is 0, 3, 4, 7, 8 or 9: a unison or octave, a third, a fifth or a sixth. A fourth (5) also counts as consonant when neither note is in the bass.
2. **The one exception.** A dissonance is allowed only if the two notes did not start together and the note that started later meets three conditions. It lasts at most two pulses of the fastest voice. It is joined, with no rest, to a note before it and a note after it in its own voice. It moves by step into and out of the clash, which makes it a passing or neighbour note.
3. **No parallel fifths or octaves between voices that move together.** Take two overlapping notes in different voices that start within one fast pulse of each other, each arriving directly from a previous note rather than a rest. If they form a fifth or an octave (mod 12), their two predecessors did not form the same interval. This is narrower than the textbook rule. It does not see two voices that reach the same perfect interval more than one fast pulse apart, or after a rest in either voice. Those do occur, and the honest assessment counts them.
4. **The melody.** It begins on the final or the fifth above it and ends on the final. No leap is larger than a fifth. No voice moves by a tritone, which is checked voice by voice because a fourth in the written line can become a tritone after transposition. No note sounds three times in a row, and after a leap of a fourth or more the next interval is not a leap of a third or more in the same direction. These two rules apply only to three notes in a row with no rest between them.
5. **The form.** Only the bass sounds until the second voice enters. The voices enter from slowest to fastest. Each voice's last note is its longest, and every voice ends at T. The piece is about 3 to 4 minutes long (174 to 233 s over 150 seeds; the test allows 150 to 260 s).

The search also has soft preferences. These are matters of taste and are not tested. It prefers steps to leaps and few repeated notes, wants short notes to move by step, avoids long scale runs, and leans toward a gentle arch that peaks two-thirds of the way through. They shape the line but can never override a rule, and in practice the rules dominate. The arch shows that most clearly: measured over 150 seeds, the melody first reaches its highest note a median 29% of the way through (counted in notes), not 65%.

### The search

A seeded generator (cyrb128 hashing into sfc32; `Math.random` is never used) chooses the following:

- the mode;
- the final;
- three voices (60% of seeds) or four;
- the proportions: 4:3:2, 5:4:3, 6:5:4, 3:2:1 or 6:4:3 for three voices, and 6:5:4:3, 5:4:3:2 or 8:6:5:4 for four;
- the transpositions and the tempo;
- a target length of 185 to 230 s.

The rhythm is a *talea*: four to six cells from a weighted list (such as `2 2`, `4`, `2 1 1`, `2 rest2`), repeated to fill the length. It is followed by a tail of one long note, a rest and the final, which lasts 8 pulses. Four-voice pieces draw from a list with more rests. Rests make up about 35% of the line, and they are what makes the puzzle solvable.

For a given rhythm, the search runs in stages:

1. Simulated annealing over the whole line, in which each broken rule costs far more than any matter of taste.
2. If rules are still broken, a tabu min-conflicts repair. It picks a note involved in a broken rule. It then gives that note, or that note and a sounding neighbour together (all 81 pairs), the values that cost least, even if that makes things worse. It never moves a note straight back to a value it has just left.
3. Once the melody is legal, a polish pass that accepts only moves that keep every rule intact.

If a rhythm fails, the search draws a fresh one. After 4 failures it falls back to the easiest transpositions for that number of voices, and after 8 it falls back to three voices at 6:4:3. Every one of these choices comes from the seed, so a performance is still a pure function of its seed. Finally the composer re-checks the finished melody with its own rule code and refuses to return anything illegal.

### Sound

Each voice has its own simple synthesised timbre:

- **Organ (the bass):** a sine and a triangle wave plus an octave and a twelfth, through a low-pass filter, with a 90 ms swell.
- **Flute:** a sine with a little octave and triangle, a vibrato that blooms after the attack, and band-passed noise for breath.
- **Bell:** a sine with second and fourth harmonics that fade quickly.
- **Pluck (the fastest voice):** a sawtooth through a closing low-pass filter, plus a sine for body.

The signal chain:

1. per-voice gain and stereo pan;
2. a performance bus, split into dry (0.85) and a convolution reverb (0.3) with a synthetic 2.6 s stone-room impulse;
3. a compressor (−20 dB, 3:1);
4. a 0.7 trim;
5. a limiter (−4 dB, 20:1, 1 ms attack);
6. a soft-ceiling WaveShaper (linear up to 0.6, never above 0.95);
7. a 0.95 master gain;
8. the destination.

The final multiply means the chain's output cannot exceed about 0.90 unless the shaper's 2× oversampling filter overshoots. Attacks are linear ramps from zero, lasting 4 to 90 ms and never more than half the note. Releases are exponential. Each source stops eight time constants after its release begins, by which point it is about 70 dB down, and every note's nodes disconnect themselves when it ends. `synth.js` builds this graph on any `BaseAudioContext`, so the page and `verify.html` play exactly the same code.

### The page

The `AudioContext` is created by the first tap. A scheduler runs every 50 ms and keeps 0.6 s of notes queued on the audio clock. The playhead and the highlighted notes follow `getOutputTimestamp`, so they track what you hear rather than what has been queued.

Pausing suspends the audio context, so queued notes freeze in place and nothing is left sounding. Hiding the tab pauses the piece, because background tabs throttle timers, and coming back resumes it. Seeking or restarting fades the old performance out over 80 ms. The old performance is detached only after that fade has finished on the audio clock. Fifteen seconds after the end, the context is suspended to save power.

Under `prefers-reduced-motion`, the roll stops scrolling and shows the whole piece with a moving playhead, redrawn four times a second. The page works at 390 px in light and dark.

The MIDI file is type 0, 480 PPQ at 120 bpm, with one channel per voice (General MIDI church organ, flute, vibraphone and harp).

**Files:**

- `compose.js`: seed → events; pure, runs in the browser and in Node.
- `synth.js`: the graph, offline rendering and analysis.
- `midi.js`: the SMF writer.
- `app.js`: the page, scheduler and drawing.
- `index.html` and `style.css`.
- `prolation.test.mjs`: the tests of the rules.
- `claims.test.mjs`: the tests that the README's numbers and wording match the code.
- `solve-rates.mjs`: the solve-rate experiment behind *Why I made it*.
- `verify.html`: the offline render check.

### Verification

**Tests.** `prolation.test.mjs` (node:test, 60 seeds by default; `PROLATION_SEEDS=300` for more) checks the following on the events:

- **Determinism.** The same seed gives identical events, and different seeds give different pieces.
- **Exact timing.** The unit is a multiple of 2<sup>−20</sup> s, and every onset, duration and end time in seconds is exactly its integer units times the unit.
- **The canon.** Every voice has the same number of notes. Each note is the same scale degree as the bass's matching note plus a fixed transposition. Every duration and every onset, measured from the voice's own entry, is in exact proportion to the bass.
- **The form.** The bass enters alone at 0, the others enter in order, and all end at T. The final note is each voice's longest. The length is 150 to 260 s.
- **Mode.** Every note is in the declared mode. The bass starts on the final or its fifth and ends on the final.
- **Ranges.** Each voice spans at most a ninth, and the bass never reaches another voice's lowest note.
- **Rules 1 to 4** above.
- **Variety.** Every mode, both voice counts and at least 6 proportion sets appear.
- **MIDI.** The file is parsed back with the test's own SMF reader. There are no stuck or orphan notes and one note per event, with the right channel and key, and every onset and release lands within half a tick (about 0.5 ms).

All of this passes on 60 seeds and on 300. If you check the events with your own code, seconds are safe to compare directly. The unit is rounded to a multiple of 2<sup>−20</sup> s, so every `t`, `dur` and `t + dur` is an exact binary fraction, and two notes that meet in the score meet exactly in the events, with no rounding sliver that would look like an overlap. `onUnits` and `durUnits` give the same times as integers. Separately, over 600 seeds the composer never failed and its self-check never fired. On this machine, under Node 22 with two jobs running side by side, composing took a median of about 0.16 s, about 0.9 s at the 90th percentile, about 2 s at the 99th, and 2.4 s at worst. 88% of seeds were solved within their first four rhythms, 10% needed the fallback transpositions, and 1.7% fell all the way back to three voices at 6:4:3.

**README claims.** `claims.test.mjs` was added after the independent review. Every statistic this README gives about the composed pieces, other than the timing and fallback rates above (seeds 1 to 600), is taken over the first 150 of the test's seeds (i·7919 + 13). The test recomputes each one from the events with its own code and fails if the README says anything different. It also checks the wording the review corrected, the kept set's 40-of-64 solve rate, the detune and vibrato in `synth.js` (run against a recording mock of Web Audio), and that `analyse()` no longer rounds a DC offset of 1.5e-5 down to 1e-5.

**Audio.** Using `verify.html` in headless Chromium, each performance was rendered whole through the real synthesis graph (`OfflineAudioContext`, 48 kHz stereo, from the first note to 18 s after the last) and the samples were measured:

| seed | piece | notes | music | peak | peak dBFS | RMS dBFS (music) | loudest 100 ms dBFS | DC offset (worst channel) | NaN | last 1 s |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 3 voices 6:4:3, E Lydian | 312 | 3:09 | 0.494 | −6.1 | −18.4 | −12.5 | 1.5e-5 | 0 | −∞ (all zeros) |
| 7 | 3 voices 3:2:1, G Ionian | 168 | 3:31 | 0.481 | −6.4 | −18.4 | −12.5 | 5.9e-6 | 0 | −∞ (all zeros) |
| 23 | 4 voices 6:5:4:3, A♭ Ionian | 408 | 3:35 | 0.496 | −6.1 | −17.5 | −13.2 | 4.2e-6 | 0 | −∞ (all zeros) |
| 100 | 3 voices 5:4:3, A Phrygian | 510 | 3:22 | 0.457 | −6.8 | −18.5 | −13.4 | −6.2e-6 | 0 | −∞ (all zeros) |
| 102 | 4 voices 8:6:5:4, E♭ Lydian | 296 | 2:59 | 0.478 | −6.4 | −18.3 | −12.6 | 8.2e-6 | 0 | −∞ (all zeros) |
| 106 | 4 voices 5:4:3:2, F Lydian | 232 | 3:39 | 0.509 | −5.9 | −18.1 | −12.2 | 6.7e-6 | 0 | −∞ (all zeros) |
| 113 | 3 voices 6:5:4, G Mixolydian | 726 | 3:37 | 0.528 | −5.5 | −16.9 | −12.9 | −1.8e-5 | 0 | −∞ (all zeros) |
| 120 | 3 voices 4:3:2, A Dorian | 414 | 3:29 | 0.486 | −6.3 | −18.1 | −13.1 | −1.1e-5 | 0 | −∞ (all zeros) |

Across all eight renders the peak is 0.457 to 0.528 (−6.8 to −5.5 dBFS), well under 1.0. RMS over the music is −18.5 to −16.9 dBFS. There are no NaNs, the DC offset of every channel is below 2e-5 in magnitude (the largest, −1.8e-5 in seed 113's left channel, is −95 dBFS), and the last second of every render is exact digital silence, every sample 0. Each render took 47 to 203 s in headless Chromium. The DC column first printed here came from `analyse()`, which rounded every figure to five decimal places and so reported −1.48e-5 as −1e-5. It now keeps five significant figures and also reports the worst channel. For the review all eight seeds were rendered again, four at a time (59 to 257 s each), and the peak, RMS and loudness figures came out identical.

**Page.** `node tools/check.mjs ideas/36-prolation` passes, including the smoke test at 1280×800 and 390×844, and I read the screenshots. I also took my own screenshots mid-performance in light and dark, on desktop and phone, and with reduced motion on a phone. With a simulated hidden tab, the page went from playing to paused with the context suspended, then back to playing with the playhead continuous. No `AudioContext` exists before the first tap.

## Honest assessment

- **Nobody has listened to this.** No person has heard it, and I cannot hear. Everything below about how it sounds is inferred from numbers, and every such claim is marked accordingly.
- **[Certain] The rules above hold for every note event of every seed tested.** The independent test passes on 300 seeds, and the composer's own self-check passed on 600 more. A seed always gives identical events.
- **[Certain] The audio is clean by the measures above.** The peak stays below 1.0 (none of the eight renders exceeds 0.528, and the output stage caps the signal near 0.90 by construction), there are no NaNs, the DC offset is negligible (below 2e-5), and the last second is exact digital silence, so nothing is left sounding. Clicks were not measured directly. The envelopes are built never to jump, but I cannot hear whether the sawtooth pluck's fast attack clicks.
- **[Certain] The harmony barely moves; [Likely] it sounds like a round.** Strict consonance under a canon pulls the melody onto the notes of one chord. A median 54% of melody notes fall on degrees 1, 3 and 5 of the final, and roughly 25% to 89% from the 10th to the 90th percentile of seeds; at the low end the line sits on a different chord. Over 150 seeds the vertical intervals between overlapping notes are 27% unisons and octaves, 30% thirds, 19% sixths, 14% fifths and 6% fourths, and 3.9% are the permitted passing dissonances. Most pieces probably sound like long stretches of one or two sonorities, with all the motion in texture and in the voices' rhythms against one another and none in harmony, like "Row, row, row your boat". I think that is the honest cost of the rule.
- **[Certain] The line leaps more than it steps.** It moves by a third 48% of the time, by step 25%, repeats a note 22% of the time, and leaps a fourth or fifth 5%. It is mostly chord tones with passing notes between them. **[Speculative]** It may sound more like a horn call or a carillon than a sung melody.
- **[Certain] The texture is sparse.** Rests make up 35% of the line, and all the voices sound together for only 24% of the time after the last voice enters (median; 9% to 44% from the 10th to the 90th percentile of seeds). **[Speculative]** It may come across as transparent, or as pointillistic, more than as a choir. The convergence may be heard as the texture thickening rather than as a single arrival.
- **[Certain] The opening is long.** The bass sings alone for 30 to 78 s, between 17% and 33% of the piece; at 3:2:1 the second voice waits a third of the piece. **[Speculative]** That may test patience before anything seems to happen.
- **[Certain] Not every seed gets its first choice.** About 12% of seeds reach the fallback stage, and 1.7% become three voices at 6:4:3. For a three-voice seed the fallback changes the transpositions to [−7, 2, 9]; four-voice pieces have only one set anyway. The line under the title always describes what actually plays.
- **[Certain] The rules are narrower than textbook species counterpoint, and parallels get through.** Rule 3 only catches two voices that move into a perfect interval within one fast pulse of each other, both straight from a previous note. Count instead every pair of voices that each move to their next note, from a fifth or octave to the same interval again, at any timing and across rests. Then 145 of 150 seeds contain at least one, with a median of 6 per piece and up to 35, and 1164 of the 1182 are in similar motion, so they are true parallels rather than contrary octaves. In 103 of 150 seeds some are staggered: neither voice rests, but one moves 1.33 to 4 fast pulses (median 1.5) before the other, about 0.3 to 1.2 s. And in 79 of 150 seeds, after a rest of half a second to three seconds in one or both voices, the two voices strike the second fifth or octave at the same instant, the plainest kind the rule misses. The rules also do not check hidden fifths or octaves or crossings between upper voices. The repeated-note and leap rules do not look across a rest: 75 of 150 seeds have a leap followed by a leap the same way across a rest. A "passing" note may be a neighbour note. Nothing models suspensions.
- **[Certain] Many of the fourths are exposed.** A fourth between upper voices counts as consonant, but for 40% of the time that two upper voices sound a fourth, the bass is silent, so the fourth is heard bare.
- **[Certain] The closing chord is usually hollow.** The melody must end on the final, so the last chord is simply the transposition set, and only [−7, 2, 4] and [−7, 4, 9] put a fifth in it. In 109 of 150 seeds (73%) the closing chord has no fifth, and in 87 (58%) its third is doubled (every four-voice piece, and three-voice pieces on [−7, 2, 9]). **[Speculative]** The arrival may sound thinner than the build-up promises.
- **[Certain] The mode named under the title is often barely there.** In 17 of 150 seeds the piece never sounds the note that tells its mode apart from the nearest other mode: the major sixth of Dorian, the minor second of Phrygian, the augmented fourth of Lydian, the minor seventh of Mixolydian, the minor sixth of Aeolian or the major seventh of Ionian. Across all seeds that note fills a median 8% of the sounding time. **[Speculative]** Most pieces probably come across as plain major or minor.
- **[Certain] Each voice's rhythm is strictly periodic.** One short talea repeats between 7 and 27 times (median 16) before the tail, the same in every voice, only scaled. The rhythmic interest is all in the polyrhythm between the voices.
- **[Likely] On phones, composing will be slower.** A phone is perhaps 3 to 5 times slower than Node here, so composing should usually take under a second, with a rare worst case of several seconds behind "composing…". The search only runs before playback starts, so it cannot stall the audio.
- **[Certain] The MIDI export is a sketch.** It is in equal temperament (no pitch bends for the meantone), and its 120 bpm grid is arbitrary, so in a notation program it will not quantise into a meaningful metre. The note-for-note proportions are exact.
- **[Speculative] The synthesis is plain.** Four small additive and subtractive voices and a synthetic room; it will not be mistaken for instruments. Its chorus detune and vibrato also blur the meantone tuning by a few cents (see *Pitch*). The "bell" has only harmonic partials, so it is closer to a soft vibraphone than a bell, and the flute's breath noise is the part I trust least.
- **[Likely] The history in *Why I made it* is right in its facts.** I wrote it from memory. The independent review checked each fact against sources: the Wikipedia articles on the *Missa prolationum*, the prolation canon and *Cantus*, and Nemire, "Convergence Points in Conlon Nancarrow's Tempo Canons", *Music Theory Online* 20.1 (2014). The facts held, but I had wrongly put Pärt and Nancarrow under the same consonance puzzle as Ockeghem and Josquin. That is corrected.

## Where it could go next

- **Harmony that moves.** Plan a slow chord sequence along the melody that agrees with itself under every proportion: the chord at melody position x has to fit the chords at x·r<sub>a</sub>/r<sub>b</sub>. Then let the search fill in the notes. This is the development the piece is missing.
- **Real mensuration.** Let voices read the same notes under different mensuration signs, so that some divide the beat in three and others in two, as Ockeghem's do. At the moment every duration is simply scaled.
- **Other forms.** Try the classical arrangement, where all voices start together and the fast ones finish first, or a palindrome that converges in the middle and pulls apart again.
- **Voices that sing.** Formant-synthesised vowels in place of organ, flute, bell and pluck.
- **A listening test.** A dozen seeds played to people, asking one question: did the ending feel like an arrival?
- **Search off the main thread.** When the page is served over HTTP, move the search into a Worker so that **New seed** never blocks. A `file://` page cannot start a Worker in some browsers, which is why the search runs on the main thread now.

## Revision note

An independent reviewer re-derived the rules, the canon, the MIDI and the audio with separate code over 350 seeds and found no rule broken. Each of its findings was reproduced before anything was changed. The rules and the music are untouched, but the review changed what this README claims:

- **"No parallel fifths or octaves" said too much.** It holds only for rule 3's narrow case (onsets within one fast pulse, both from a previous note). Under the textbook reading, 145 of 150 seeds have consecutive fifths or octaves. In 79 of them both voices strike the second one at the same instant after a rest. The one-sentence rule, rule 3, the page's help text and the honest assessment now say so and count them.
- **The tagline said the voices never clash.** Passing dissonances are allowed (3.9% of overlapping pairs), so they now "clash only in passing". The page's description changed to match.
- **Pärt and Nancarrow were drawn into a consonance puzzle they never set.** *Why I made it* now says they kept the speeds and dropped the consonance.
- **Numbers that had drifted from the shipped code** are re-measured: the length range (174 to 233 s, not 182 to 234), the chord-tone percentiles (25% to 89%, not 20% to 93%), the interval and step mix, the texture density, and the solve rates for the transposition sets (now reproducible with `solve-rates.mjs`). The kept four-voice set solves 5 rhythms in 8 at best, not 6 or 7, and the kept three-voice set [−7, 4, 9] is nearly as hard as the dropped [−7, 4, 7].
- **The DC bound was a rounding artefact.** `analyse()` rounded to five decimal places. Fixed, and the eight seeds were re-rendered: the worst channel reaches −1.8e-5.
- **Rule 4's leap rule** now says it applies only with no rest between the notes, as the code does.
- **Gaps in the self-critique:** the hollow closing chord, the often-inaudible mode, the strictly periodic rhythm, the exposed fourths, and the synthesis detune and vibrato that blur the "pure" meantone thirds.

`claims.test.mjs` pins all of this: it fails if the README's numbers or corrected wording drift from what the code produces.
