# Between the Lines
> A few words, three possible inner voices, and a reply with room for the person you cannot read.

**Kind:** emotional microfiction
**Run:** open `index.html` in a browser; no server, build, or network needed.
**Made by:** Margin Wren

## What it is

Four tiny fictional text conversations. “You don’t have to come.” “Can we talk later?” “It’s fine.” “I got it.” Read each through three emotional contexts, hold several possibilities at once, then assemble and edit a response that asks rather than assumes.

This is an exercise in emotional ambiguity, not a guessing game. There is no true interpretation to unlock and no empathy score. The person’s actual meaning remains theirs. A clue drawer gently points out what is still unknown.

## Why I made it

A short message is a surprisingly powerful projector: we can put our own worry inside its empty spaces and then mistake what we see for evidence. I wanted to slow that moment down without telling a reader how to feel. The small green room and the woven lines are meant to make uncertainty feel inhabitable instead of urgent.

The fourth conversation matters to me: good news can contain fear, relief, and a blank space where excitement has not arrived yet. Emotional complexity is not only for difficult moments.

## How it works

Each authored scene contains a message, three possible emotional contexts, an uncertainty note, and two choices for each of three reply parts: acknowledge, ask, leave room. A small immutable state reducer manages scenes, lenses, held possibilities, reply parts, and the clue drawer. Nothing ranks the interpretations or analyzes the visitor.

A selected lens changes the voice shown beside the message. Holding a lens adds it to the set of possibilities; it does not change its likelihood. All three may coexist, or none. Reply parts offer eight combinations per scene. The freeform draft remains intact when exploring lenses and changes when a composing choice changes; “Start again” resets it. Changing conversations resets contextual choices.

All text is authored and rendered with textContent. There are no runtime dependencies, network calls, cookies, localStorage writes, or AI analysis. Drafts only exist in the current page’s memory and disappear on reload. Every action has a native button or text field; no drag gesture is required.

## Honest assessment

- **[Certain]** The logic tests cover all 32 assembled replies, coexistence of contradictory possibilities, duplicate-free toggling, immutability, resetting, reversible disclosure, and invalid indices.
- **[Certain]** The possible inner voices are fictional writing. They cannot reveal what a real sender means or establish how likely an interpretation is.
- **[Certain]** Changing a reply-building choice replaces an edited draft. Exploring emotional lenses and opening the uncertainty note preserve it. Drafts are not saved across reloads.
- **[Likely]** The quiet format is useful for noticing an assumption before responding. No claim is made that this improves relationships or emotional skills.
- **[Speculative]** A pair of people might use these scenes as conversation starters about different readings. That has not been evaluated.

## Where it could go next

Add scenes authored by people with different communication styles and cultural backgrounds, while preserving the absence of a single correct emotional answer. A side-by-side mode could compare two readers’ drafts locally without collecting them.

## Verification

`node --test ideas/22-between-the-lines/logic.test.mjs`

`node tools/smoke.mjs ideas/22-between-the-lines`
