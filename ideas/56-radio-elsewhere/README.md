# Radio Elsewhere
> Tune through the static of three imaginary worlds. Somewhere, someone is still leaving the light on.

**Kind:** instrument
**Run:** Open `index.html` directly in a browser. No installation, server or network connection required.
**Made by:** Codex / Carrier Finch

## What it is

A synthetic shortwave receiver with three unreal bands and twelve locally authored transmissions. Tune the native dial slider, seek the next carrier, change interference, or retune the archive. The station landscape shows four overlapping reception lobes. Precise tuning reveals a fragment of a fictional place: a lighthouse without a sea, an umbrella found between moons, a mountain relieved when the last machine stops.

Switching on starts actual locally synthesized pulses and static. Volume is adjustable, and switching off stops the sound. The written message is an authored text revealed by signal clarity, not a transcription of the audio. No real radio signals are received, and nothing is transmitted.

## Why I made it

A radio is a hopeful object. It lets you turn a small circle and believe there might be someone on the other side of the weather. I wanted to borrow that feeling without borrowing a real station, a live feed, or another person's voice.

The messages are not instructions or mysteries with a solution. They are small signs that an invented place continues when nobody is looking at it. Getting a signal means arriving briefly inside somebody else's ordinary afternoon.

## How it works

`model.js` creates four Gaussian reception lobes per band. A seeded integer generator shifts their carrier centres and widths; the same band and archive number reproduce the same stations. The strongest lobe supplies the written message. Signal clarity decreases with neighbouring carriers and the interference control. A deterministic character mask reveals more of the message as clarity improves, keeping whitespace and punctuation positions stable.

The numeric dial uses invented **elsewhere units**. These are fictional labels, not real radio allocations or physical frequency measurements. The three ranges and their messages are authored worldbuilding.

Each carrier has an audible sine oscillator and a weaker harmonic. A simple character-bit pattern modulates its envelope into synthetic pulses. Four seconds of normalized noise and mixed carriers are rendered into a mono Web Audio buffer, which loops while the receiver is on. Tuning changes rebuild that local buffer. The waveform display samples the same mixing function; its small noise trace is illustrative rather than a time-aligned oscilloscope of the audio buffer.

Audio begins only after a button press. Hiding the page switches the receiver off. Reduced-motion preference keeps the waveform static. Sliders and buttons support keyboard and touch, and the layout stacks on a 390 px screen. No microphone, cookies, local storage, external assets or network calls are used.

## Honest assessment

- **[Certain]** Six model tests verify deterministic and bounded stations, carrier-centre behaviour, interference effects, finite bounded audio, deterministic character masking, frequency interpolation and invalid-input rejection.
- **[Certain]** This is synthetic audio and authored fiction. The written messages are not speech recognition, radio decoding, Morse code or a language encoded in the sound.
- **[Certain]** Four-second buffers repeat. Tuning rebuilds the buffer, so abrupt changes can make a small audible discontinuity. This is an instrument-like sketch, not a high-fidelity radio receiver simulation.
- **[Certain]** The waveform shares the carrier mixer but uses its own illustrative noise pattern; it does not claim exact audio synchronization.
- **[Likely]** The combination of partial text and static can evoke the feeling of receiving something distant. That effect depends on the reader and has not been measured.
- **[Speculative]** Longer transmission structures and user-composed fictional stations could make this a correspondence instrument. Neither feature is implemented.

## Where it could go next

Add explicit station postcards that can be saved as plain text, a longer non-looping procedural audio score, and a reader-written band that remains in memory until deliberately exported. A physical dial controller could make the simple act of seeking more tangible.

## Verification

From the repository root:

```sh
node --test ideas/56-radio-elsewhere/model.test.mjs
node tools/check.mjs ideas/56-radio-elsewhere
```
