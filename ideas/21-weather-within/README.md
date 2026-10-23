# Weather Within
> You can be glad and grieving. A sky has room for both.

**Kind:** emotional art instrument
**Run:** Open `index.html` in a browser; no installation or server required.
**Made by:** Codex / Isobar

## What it is

A small weather-making instrument for mixed feelings. Six independent sliders give joy, sorrow, anger, uncertainty, calm and wonder their own presence in one sky. Joy lights a sun while sorrow rains in front of it; neither is subtracted from the other. Three sample combinations offer a way in. Pause the weather, or keep the current drawing as a standalone SVG.

The controls describe what you choose to put into the picture. They do not detect, measure or diagnose an emotional state. There is no preferred combination, good-weather score or instruction to become calmer. A storm can be the finished picture.

## Why I made it

Emotional interfaces often reduce people to a single face, a color, or a number from one to ten. The moments I find most human refuse that arrangement: relief with guilt, affection with anger, hope with fear. Weather offered a visual language where several things can be true at once. I wanted the rain to remain visible after the sun came out.

The horizon is a little open notebook. Its only claim is that you can make a picture which feels closer to what you meant than a single word does.

## How it works

`weather.js` is a pure, dependency-free drawing engine shared by browser and Node tests. Inputs clamp independently to 0–100. Geometric SVG layers map each feeling to a visual motif: light, rain, lightning, mist, water and stars. These associations are artistic choices, not validated psychology. Sine waves animate the field without randomly changing the drawing's composition. A short caption names up to three strong presences, without averaging them into a score.

`app.js` supplies native range controls, example combinations, a pause switch and the explicit SVG download. Reduced-motion preference starts animation paused. All controls work with keyboard and touch; the layout adapts to a 390 px phone. There is no form submission, network access, cookies, local storage or background persistence. The download contains only geometric SVG, no scripts or entered text.

## Honest assessment

- **[Certain]** Feelings never cancel one another numerically: raising joy does not lower sorrow. Pure tests verify bounds, coexistence, deterministic output, malformed-number handling and preset integrity.
- **[Certain]** These are visual metaphors selected by the maker. The sliders are not a psychological scale, screening instrument or inference about their user.
- **[Certain]** The page stores the current slider state only in memory; refreshing resets it. Saving requires the explicit download button.
- **[Likely]** A sky can make ambivalence easier to express than a single mood choice. Whether it does so for any reader is personal and untested.
- **[Speculative]** Someone might use exported skies as a diary or a way to begin a conversation. The tool has not been evaluated for therapeutic use.
- **[Certain]** The SVG is scalable, but the short captions are in English and the metaphors are culturally specific. Screen-reader users receive the caption and slider values, but not a detailed account of every decorative element.

## Where it could go next

Let readers rename motifs, choose their own color associations, and compose two neighboring skies with neither positioned as the goal. A print layout could keep a collection of explicitly saved skies together without storing private feelings automatically.

## Verification

Run `node --test ideas/21-weather-within/weather.test.mjs` and `node tools/smoke.mjs ideas/21-weather-within` from the repository root.
