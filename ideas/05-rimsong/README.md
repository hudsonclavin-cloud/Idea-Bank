# Rimsong
> A glass harp you play by tracing circles on the rims, and tune by pouring water.

**Kind:** instrument
**Run:** open `index.html` in a browser (double-clicking works, no server or build needed), tap **Tap to begin**, then put a finger on a rim and go round and round. Sound on; headphones help. `verify.html` renders and measures a scripted performance offline.
**Made by:** Quiet Antinode

## What it is

Eight wine glasses on a dark table, each partly full of water. You don't press them. You **rub** them: put a fingertip (or the mouse) on a rim and trace circles. Like a real glass, it takes a moment to speak, swells as you keep going, and rings on after you lift. Rub faster and it gets louder, up to a point. Rush it and it squeaks and chokes. Rest a still finger on a ringing rim and it hushes. Tap a bowl below the rim and it rings like a struck glass, brighter the closer to the rim you tap.

Switch to **Pour** and drag the water level. More water makes a lower note. If a glass is singing while you pour, it slides. Let go and the water settles onto the nearest semitone. Presets re-pour all eight glasses at once (Pentatonic, A minor, Whole-tone, and *Overtones (just)*, which tunes the glasses to harmonics 4–11 of G2 and shows the cents each one sits away from equal temperament).

Several fingers work at once for chords. On a keyboard, hold `A`–`K` to rub glasses 1–8, tap `Z`–`,` to ring them, and press `Space` to hush.

## Why I made it

What draws me to a singing glass is that playing it is a *rate*, not an event. A piano key is a moment. A glass rim is a process: you keep pumping energy in, and the note is whatever balance the glass reaches between your finger feeding it and the air and stem draining it. I wanted an instrument where the interface is a continuous loop of motion, the circle itself, rather than a set of places to hit.

The details turned out to be the fun part. You tune a glass by adding *mass*, so the instrument's tuning control is a water level, and the pitch barely moves for the first half of the glass and then drops fast (the fill fraction enters to the fourth power). The vibration pattern of a rubbed glass also follows your finger around the rim, so the sound pulses in time with your hand. I wanted to see whether those true-to-life quirks would make something that feels like an object rather than a synth with a skin.

## How it works

**Gesture → energy.** Each finger on a glass is tracked in coordinates where the rim is the unit circle. Every frame, the code measures how much *rim angle* the finger covered and smooths it into revolutions per second. Rubbing in and out doesn't count, only travel around the rim. A saturating curve (`1 − e^(−v/0.6)`) turns rim speed into drive, weighted by how close the finger is to the rim. Above about 2.4 rev/s a squeak term rises, which pushes energy into the next mode up and chokes the main tone by up to 45%.

**Energy dynamics** (`glass.js`, `GlassModel.step`). The glass's ringing amplitude moves toward the drive at different speeds depending on what your finger is doing:

| situation | time constant |
|---|---|
| building up (it "speaks") | 0.3 s + 0.45·amp |
| finger lifted (free ring) | ≈ 2.6 s × (600 Hz / f)^0.35 |
| still finger resting on the rim | 0.14 s (damped) |
| still rubbing, just slower | 0.8 s |

**Pitch from water.** The pitch follows `f = f₀ / √(1 + K·(h/H)⁴)`, the form A. P. French derived for a liquid-loaded wineglass ("In vino veritas", *Am. J. Phys.* 1983), with `K = 1.9` as a plausible thin glass. Each of the eight glasses has its own empty pitch `f₀`, chosen a little above the highest note any preset asks of it. Bigger glasses ring lower. Snapping inverts the formula: `h/H = (((f₀/f)² − 1)/K)^¼`.

**Synthesis chain, per glass** (`audio.js`; persistent nodes, nothing allocated while rubbing):
- Sine at `f` plus a sine at `f + δ`, where δ is 0.45–1.65 Hz and differs per glass. This models the (2,0) mode's near-degenerate pair. The partner's level falls while you rub (the finger pins the pattern) and rises in the free ring-out, which is where the slow beating "wah" lives.
- Faint upper modes at the thin-ring ratios 2.828 and 5.423 (n(n²−1)/√(n²+1), normalised to n = 2), and a faint true 2nd harmonic.
- Friction "breath": shared white noise through a Q=18 band-pass at `f`, scaled by how hard you're rubbing.
- Squeak: noise band-passed around the 2.828·f mode, gated by a 27–41 Hz triangle LFO for stick-slip chatter.
- Tremolo from finger angle: the singing pattern rotates with your finger, so a listener in front hears `1 − D·sin²(2(θ − π/2))`, four pulses per revolution.
- Strike (tap): short-lived oscillators for five modes with 3 ms attack and exponential decays (high modes die fast), plus a 2.5 kHz high-passed noise tick. At most five rings per glass. Older or damped ones fade, their stops are brought forward, and all their nodes are disconnected `onended`.

**Master bus:** 70 Hz high-pass → dry + generated stereo convolution room (2.8 s, darker tail) → compressor (−20 dB, 3:1) → trim → limiter (−4 dB, 20:1, 1 ms attack) → soft safety shaper (linear to 0.6, ceiling ≈0.9) → out.

**Shared code for live and test.** `instrument.js` binds models to voices and is used by both the page and `verify.js`. Every audio method takes an explicit time, so a whole performance can be scheduled into an `OfflineAudioContext` and measured. The scripts are plain (non-module) JavaScript in a `window.Rimsong` namespace so the page also works from `file://`.

## Honest assessment

- **[Certain]** It runs: the repo smoke test (`node tools/smoke.mjs ideas/05-rimsong`) passes at desktop and 390 px phone width with no console errors or overflow. It also loads from `file://` without errors. Headless tests confirmed that circular mouse gestures, two simultaneous CDP touch points, held keys, bowl taps, damping, pour-and-settle (lands at MIDI 71.000) and the Overtones preset (392/490/588/686/784/882/980/1078 Hz) all behave as intended.
- **[Certain]** Offline renders through the real synthesis code at 48 kHz:
  - realistic 16 s performance: peak 0.528 (−5.6 dBFS), RMS −18.8 dBFS
  - deliberate abuse (all 8 glasses rubbed flat-out, 16 full-velocity taps, then all squeaking): peak 0.688, or 0.730 with the safety shaper bypassed
  - all renders: zero NaNs, DC offset ≤ 1e-5
  - stuck-note check: 22 s after lifting, the last second is −79.9 dB
  - one rubbed glass reaches half level in 0.4 s and 90% in 1.2 s, and its upper partials sit at −31 and −38 dB
- **[Certain]** I could not *listen* to it. Everything above is measured, not heard. Whether it sounds beautiful rather than merely clean is unverified by ears. Pure sines at 400–1100 Hz can tip into "test tone". The beating partner, friction band, tremolo and room are there to prevent that, but they may need retuning by someone with headphones.
- **[Certain]** It is tested only in headless Chromium, never on a real phone, Safari or Firefox.
- **[Likely]** The water law's *form* (fourth power of fill) follows French's paper. `K = 1.9` is my estimate for a typical thin glass, not a measurement, so real glasses will differ.
- **[Likely]** The thin-ring partial ratios are a textbook approximation. Real wine glasses deviate from them, sometimes a lot.
- **[Likely]** A rubbed glass's pattern following the finger, and the resulting pulse at four times the circling rate, matches the physics of the (2,0) mode. The tremolo depth (≤20%) is my choice.
- **[Speculative]** The gesture → drive mapping is a hand-tuned heuristic, not a stick-slip friction simulation. The squeak (jump toward the next mode, plus chattering noise) is a sketch of over-driving, not a model of it. The faint 2nd harmonic is a taste decision.
- **[Speculative]** `navigator.audioSession.type = 'playback'` should let iOS play with the mute switch on. It is untested.
- Rough edges: small circles drawn *on* the rim edge give less drive than tracing the whole rim. That is deliberate, since rim travel is what counts, but it might confuse. Android's Web Audio output latency (often 50–150 ms) matters less for a slow-blooming instrument than for drums, but taps will feel a little late there. Physics-wise, the water pitch comes out the same whatever glass shape is drawn.

## Where it could go next

- A real friction model in an AudioWorklet: a bowed-string-style stick-slip curve driving a modal resonator, so squeaks, chatter and mode-jumps emerge rather than being faded in.
- Franklin's armonica: nested bowls spinning on a spindle, where you just touch and the rotation does the rubbing.
- Calibrate to a real glass: tap your own wineglass into the mic, fit `f₀` and `K`, and get a digital twin you tune by pouring.
- Liquid choice (wine vs water vs oil) changing density and so `K`. French's paper title earns this one.
- Tilt to slosh: device orientation tilting the water surface, wobbling the pitch.
- Record and loop layers, or MIDI out so the rim gesture can play other instruments.
