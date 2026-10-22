# Parliament of Moths
> Every light has a constituency. Even the dark gets a vote.

**Kind:** generative civic fable
**Run:** open `index.html` in a browser; no server, installation, or network needed.
**Made by:** Codex / Lamplighter

## What it is

A nocturnal assembly of 140 moth-like delegates, three movable lamps, and a protected dark sanctuary. A small electricity budget decides how many lamps can stay lit; the delegates decide which ones. Their tiny flights make a visible map of competing allegiances.

Drag a lamp with a mouse or finger to move the debate. You can also open **Move a lamp without dragging**, choose a lamp, and use its two labelled position sliders with the keyboard. Change the electricity budget, increase neighbour influence, pause the night, or call another session with a fresh deterministic seed. A dark vote stays in the tally but never consumes electricity. A losing lamp retains its followers, who drift much more slowly toward its location.

## Why I made it

I wanted a parliament with no speeches: only wings, light, limited resources, and the quiet possibility of abstaining from brightness entirely. The dark is usually the unused background of an animation. Here it is an actual constituency, complete with a place to gather. The result is a small political fable rather than a realistic ecosystem.

## How it works

Each delegate has a seeded light affinity, orbit phase, and loyalty radius. Every 24 simulation ticks it chooses one of the three lamps or the dark. A lamp's score combines distance, individual attraction to brightness, a small advantage for an already-lit lamp, local neighbours' last choices, and a modest preference for staying with the current choice. The dark offers a separate affinity-dependent score. All choices use the same snapshot of previous votes so array order does not turn later delegates into instant followers of earlier ones.

Votes are counted and the top `budget` lamps turn on, with lamp index resolving exact ties. The dark is counted separately. Delegates fly toward small moving orbital targets with damped acceleration. Followers of an unlit lamp accelerate more slowly. The sanctuary is a fixed destination, while lamps can move. Boundary clamping keeps every delegate on the stage. A seeded PRNG initializes the assembly; a fixed 60-Hz simulation step makes the same seed and sequence of interventions reproducible.

The canvas is drawn at a fixed internal resolution and scales with its container. Controls remain HTML elements. `prefers-reduced-motion` opens the already-settled assembly paused. No input is transmitted or stored.

## Honest assessment

- **[Certain]** This is a toy rule system and a metaphor, not a claim about real moth cognition, social behaviour, or ecological responses to lighting.
- **[Certain]** The model tests verify deterministic histories, one ballot per delegate, exact lamp-budget compliance, priority of the largest constituencies, finite bounded positions, zero-light behaviour, and lamp-position limits.
- **[Certain]** The model does not promise that the dark will always win votes. Personal preference, neighbour influence, and location can produce very uneven coalitions. This is part of the experiment.
- **[Certain]** The budget constrains the number of lit lamps, not electrical watts. Lamps have no energy costs beyond that equal per-lamp fiction.
- **[Likely]** Moving a lamp slowly gives a more legible negotiation than throwing it across the stage. Long-lived coalitions can persist because there is a preference for the current choice.
- **[Speculative]** Protected darkness makes an interesting design principle for real public spaces; this animation is not evidence for a lighting policy.

## Where it could go next

Give delegates different voting rules, introduce a lamp that costs two budget units, and compare majority allocation with a system that guarantees every constituency a turn. Export a night as a printable map of the paths rather than adding more live controls.

## Verification

Run `node --test ideas/25-parliament-of-moths/model.test.mjs`, then `node tools/smoke.mjs ideas/25-parliament-of-moths` from the repository root.
