# Endpapers
> A bird book passes through three pairs of hands over sixty years. What the first hand writes in it is what the last hand finds.

**Kind:** fiction
**Run:** open `index.html` in a browser (plain classic scripts; works from `file://`, no server, no build, no network). Choices are numbered: tap one or press its number; `L` opens the list in the back of the book, `Esc` closes it. Tests: `node --test ideas/19-endpapers/endpapers.test.mjs` from the repo root.
**Made by:** Ringtail

## What it is

A short piece of interactive fiction, about fifteen minutes the first time and a few minutes after that, set in north Kent between 1964 and 2024.

A copy of the 1954 Collins *Field Guide to the Birds of Britain and Europe* goes from a cement-works clerk who birds on Sundays, to the daughter who clears his house in 1989, to a stranger who buys it in a hospice shop for one pound fifty. You play each pair of hands in turn, in second person, each for one day. The book is the only thing that is in every chapter. What one owner writes in the back of it, tucks into it, or takes out of it is, literally, what the next owner finds: the later chapters are generated from the state the earlier ones left behind.

There are six endings. Some of them are only open to you if an earlier hand did a particular thing. After any ending the page shows the book's *provenance*, written the way an auction catalogue would write it, one line per hand, every line a function of what you did; and it tells you how many distinct ways through the book there are, computed by walking the story file with the same rules the page runs on.

## Why I made it

I wanted a structure where interactivity is not "which way does the plot go" but *what does the next reader find*. Everyone who has bought a second-hand book has found something in it: a name, a date, a bus ticket, a line underlined by somebody who is probably dead. The thing about those traces is that they were never addressed to you, and they say more than they meant to. A bird list is the purest case I could think of, because it is a record of attention: a bird, a place, a date, and nothing else, and the dates are a man's Sundays.

Interactive fiction can do one thing prose cannot: it can make *you* the one who left the trace, and then hand you to the person who finds it. The second chapter is a woman reading a list her father kept and working out, from the one line with a time on it and a note in her dead mother's handwriting, what a Sunday in 1964 was like. You were there. You know whether he came home by two. She doesn't, and she never will, and the same five words on greaseproof paper mean one thing or its opposite depending on a choice you made ten minutes ago that the book cannot show her.

That is also why I liked it for this batch's theme (a part that can be proven, a part that can only be felt). A county records committee in 1964 deciding whether a harrier was a Montagu's harrier is, inside the story, exactly that split: *not proven* is a verdict about evidence, not about what the man saw. Outside the story, the graph can be walked and the state claims checked by anyone; what the note means can't be.

Premises I listed and crossed off: a deposition where your earlier answers constrain your later ones (good structure, too cold); translating an ambiguous letter so that it becomes three different letters (I couldn't make the language real enough); a coat passed down through pockets (the book won because a bird list is a record, and a record is state); and the usual suspects, loops and locked rooms and dying parents' bedsides, which were out from the start.

## How it works

Three files do the work and none of them depends on anything.

- **`story.js`** is the passage graph as plain data: 30 passages, 13 variables with their defaults, the register (the list in the back of the book, each line with an optional condition and the hand that wrote it), and the provenance lines. A passage is a list of blocks: paragraphs, a *quote* (something written on paper), a *hand* (a line in the register), the register itself, or an `{if, then, else}` block. Choices can carry conditions, can set variables, and can point at different passages depending on state. Conditions are strings in a tiny language (`entry=tick`, `not opened`, `stayed and watched=bird`, parentheses) with its own parser, so no `eval`, and so a test can list every variable a condition reads.
- **`engine.js`** is pure: it parses conditions, renders a passage against a state, resolves which choices are visible and where they go, and holds the game object (`start`, `choices`, `choose`, `provenance`). It also contains `traverse()`, a depth-first walk over every reachable (passage, state) pair that counts distinct complete paths, finds dead ends, missing links and cycles, and reports word counts. The page calls the same `traverse()` to print the number on the provenance screen.
- **`app.js`** is the only file that touches the DOM: one passage per screen, numbered choice buttons (48 px minimum, keyboard 1–9), a drawer that shows the register as it currently stands, the title and provenance screens. A soft settle on each new page is switched off under `prefers-reduced-motion`. Light and dark follow the system.

**The state model.** Chapter I sets four things: what Ron kept his eyes on when the bird came (the bird, or the book), whether he stayed for the evening, what he wrote (certain, with a question mark, or nothing), and whether a committee's letter ended up in the book, and which. Chapter II reads all of that and sets whether Carol opened the book, whether she added a line, where her mother's note went, and what became of the book. An interleaf in 2024 can add a slip of paper. Chapter III reads everything. Two of the four Chapter III endings are gated on state from the earlier chapters; the text of every Chapter III passage varies with it; and the register, shown in Chapters I, II and III, is the state made visible.

**What the test proves** (`endpapers.test.mjs`, 20 tests): its own traversal, written independently of the engine's, walks the graph through the real choice logic and asserts that every passage is reachable, every ending is reachable, no non-ending passage is ever left without a choice, no choice points at a missing passage, the graph is acyclic (so the path count is exact), every variable read is written and vice versa, and both traversals count the same number of paths. It then checks the specific structural claims: which endings need which earlier state, that Eileen's note reaches the third owner only on the paths where the second never opened the book, that the committee's letter can only exist on the paths where the bird was written down as certain, that the register renders differently under different states, that every date in it is a Sunday, that Carol's and Jas's chapters render different text for different Chapter I states, and that the provenance differs for every ending. Finally it plays two readings through the game object and checks that `start()` resets everything.

## Honest assessment

- **[Certain]** 30 passages; 6 endings, all reachable; 1,380 distinct complete paths (exact, the graph is acyclic); 8,300 words in the story file counting every variant, of which a single reading sees between about 1,800 (the shortest ending) and 5,000. Six to nineteen choices per reading. The tests above pass; `tools/smoke.mjs` passes at desktop and 390 px with no console errors or overflow; a separate Playwright run reached two endings by touch, one by keyboard, confirmed the restart clears state, and confirmed the animation is off under reduced motion.
- **[Certain]** Later text depends on earlier state, not just routing: the test renders Chapter II and III passages under different Chapter I states and asserts they differ in the specific ways the structure claims.
- **[Likely]** The natural history and the places are right to the standard of a careful reader rather than a county recorder. Montagu's harrier bred in Britain in small numbers in the 1950s and 60s and has not bred since 2019; the dark bars on the secondaries and the narrower, four-fingered wing are the field marks birders use against the hen harrier; the little egret first bred in Britain in 1996 and is now common on the Thames; marsh harrier went down to a single pair in 1971 and is now widespread in Kent; Dungeness Bird Observatory dates from 1952 and the Kent Ornithological Society from the same year; the Northfleet works were rebuilt in 1968–70 and the last of them closed in the 2000s. I checked these during the build but not against primary sources, and the detail of the 1954 Peterson (what it says under *Little Egret*, where the harrier plate falls) is invented in its particulars.
- **[Likely]** The piece reads as prose rather than as a branching exercise. I cut several choices that existed only to make a branch exist (what Ron says at the kitchen door, which road he takes, what Jas tells his father) and kept only choices that cost the character something in the moment. The remaining "page turn" choices (*Drive.*, *Chapter II.*, *Go on.*) are chapter beats, not padding; there are eleven of them, and I’d defend each.
- **[Speculative]** Whether the dramatic irony lands as intended, that the reader carries knowledge from Chapter I that Carol cannot have, depends on the reader having made the Chapter I choices with some attention. On a skim it is just a sad note in a book. That is a risk of the form and I accepted it.
- **Rough edges.** The sixty-year reach means three different voices in fifteen minutes, and the third (Jas, 2024) is the one I am least sure of. The *Monday* ending can arrive seven choices in; it is written to be a whole ending rather than a punishment, but a reader who takes it first will have a short first reading. The register is set in a monospace face as a stand-in for pencil; a handwriting font was out of scope (no web fonts, no dependencies). Tested in headless Chromium only.

## Where it could go next

- A fourth hand, or a reader's own: let the person reading add a line to the register at the end, in their own words, and carry it into the next reading on the same device.
- Show the path, not just the count: after the provenance, draw the graph with the reading's route through it and the endings it passed close to.
- The same structure, different object: a road atlas with routes drawn in biro, a cookbook with amounts crossed out, a library book with its date stamps.
- Print it. The engine can enumerate every path, so it could emit each complete reading as a plain text file; a reader who wants the book on paper could have the 1,380 of them, or the one they read.

---

## Structure in detail (spoilers)

The six endings, and what has to be true to reach them:

| Ending | Chapter | Needs | Means |
|---|---|---|---|
| *Monday* | II | Carol leaves the book on the chair for the house clearance | The book ends. Two variants: if she opened it, she keeps the note; if not, "nobody reads the note again." |
| *The flat* | Interleaf | Carol kept the book in 1989, and keeps it again in 2024 | Inheritance accepted, thirty-five years late; if she never wrote the woodpecker, she writes it now. |
| *The next line* | III | always available in Chapter III | Jas writes the egret under the last line; the list is alive again. |
| *The river* | III | Carol kept the book in 1989 and tucked her phone number in it in 2024 | The book goes back; Jas keeps the name. |
| *The tenth* | III | Ron wrote the harrier down, as certain or with a question mark | Jas goes to Dungeness on the same date sixty years on, sees a different harrier, and puts a question mark. |
| *The shelf* | III | always available in Chapter III | Jas keeps it and doesn't write in it; the names were the point. |

The chain of consequence the reviewer should see in the text: Ron's *watched* × *stayed* decide which entries he is allowed to write (a certain entry needs either a proper look or the second view); only a certain entry can go to the committee, and the committee accepts only if he both watched and stayed; the entry's time (*1.40* alone, or *& 6.15*) is what tells Carol whether he was home; the note is in the book for Jas only if Carol never opened it; Carol's woodpecker line and her 2024 slip are what Jas finds in the front and the back; the Recorder's reply in Chapter III has four different outcomes (accepted, *harrier sp.*, *no records*, or just the ring ouzel) depending on all of the above.
