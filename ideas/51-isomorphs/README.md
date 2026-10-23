# Isomorphs
> Three puzzles, each hard the way it is drawn. Redraw each one with your own hands and the hard part leaves. A proof shows nothing changed; you feel that everything did.

**Kind:** explorable
**Run:** open `index.html` in a browser (plain scripts, works from `file://`; no server, build or network). Tests, from the repo root: `node --test ideas/51-isomorphs/isomorphs.test.mjs ideas/51-isomorphs/ui.test.mjs` (Node 18+; the browser test uses the global Playwright and skips itself if it is missing).
**Made by:** Vellum

## What it is

A single page with three rooms and a coda. Every room has the same three steps, *Play it*, *Redraw it* and *Play again*, and in every room the middle step is something you do with your own hands. Nothing is shown to you as a slideshow.

**I. Fifteen: relabel it.** You and a machine take turns choosing numbers from 1 to 9, and the first to hold three numbers that add up to 15 wins. The machine plays perfectly and sets traps: in the games it starts, only one of your eight possible replies to its first move avoids a forced loss. Then you lay the nine numbers out on a 3&times;3 grid, by dragging or by tapping, so that every row, column and diagonal adds up to 15. Line sums appear as lines fill, lines that make 15 glow, and three hints are there if you want them. When the eighth line comes good, the numbers slide into the corners of their squares and four lines draw in between them: a noughts-and-crosses board. Then you play the machine again on your own board. Choosing a number puts your cross in its square, and the machine's numbers appear as noughts.

**II. Four knights: untangle it.** This is Guarini's problem from 1512. Two white and two black knights stand on the corners of a 3&times;3 board, and you have to swap them. A second target (whites on one diagonal, blacks on the other) can never be reached, and nothing on the board tells you so. After six moves you can lift the squares off the board. They become round buttons, joined by one string for each knight move (Henry Dudeney's "buttons and string" method), and you drag them until no two strings cross. The knights ride along on their buttons. What you are left with is a ring, and you play again on it. Now the swap is plainly every knight walking four steps the same way round, and the diagonals are plainly impossible.

**III. The pocket: unfold it.** A ball leaves the bottom-left pocket of a table at 45&deg; and bounces off the cushions until it drops into a corner pocket. Which pocket? You call it on three tables (4&times;3, 5&times;4, 7&times;5) and watch each shot. Then you unfold. You tap the cushion the ball is about to hit, a mirror copy of the table turns over across it like a page, and the ball runs straight on into the copy. You keep going until the straight line lands on a corner, which is a copy of the answer. *Play again* unfolds any table up to 12&times;12 at once, then asks about three tables you could never trace by eye: 1000&times;600, 1001&times;1000 and 64&times;48.

The **coda** keeps a before-and-after record of your own results in each room, and ends on the question the page exists for: *what picture would make this easy?* Each room also has a "What is proven here" panel, with a button that reruns the exhaustive checks in your browser: all 362,880 grids, all 255,168 games, all 280 knight positions and every table up to 60&times;60.

## Why I made it

The thing I can't get over about isomorphic problems is that difficulty turns out not to be a property of the problem. Fifteen and noughts and crosses have the same moves, the same wins and the same game tree, number for number. One of them is a children's game, and the other feels like mental arithmetic against the clock. A proof can show you that the two games are one game, but it can't show you that one is hard and the other easy, because that isn't a fact about the game at all. It is a fact about the person playing. That is the coordinator's theme almost word for word: the part that can be proven (the isomorphism) and the part that can only be felt (the relief).

I am not the first to notice. Herbert Simon used Fifteen, under the name *number scrabble*, in *The Sciences of the Artificial* (1969) to make this point. What a book can't do is make you perform the change of representation yourself. Being shown a magic square is not the same as building one, finding that the last 15 clicks into place, and then seeing a board you have known since you were six. I wanted the flip to be something your hands do and your eyes then catch up with.

I built three rooms rather than one because one trick teaches the trick. Three different verbs (rename the pieces, redraw the connections, reflect the space) are meant to teach the question instead.

Candidates I listed and set aside:

- *Nim in binary.* It has a big payoff, but the flip is a rule you are told, not a picture you make.
- *Ants on a stick* (ants that bounce off each other behave like ants that pass through each other). It is lovely, but the flip is a toggle, not an act.
- *The monk on the mountain* (overlay the two days). It is the classic insight problem, with nothing left to play once you have seen it.
- *The ballot problem by reflecting paths.* A strong flip, but abstract to do by hand on a phone.
- *Conway's soldiers.* The weighting that proves row five unreachable is beautiful, but it is a proof of impossibility rather than a difficulty vanishing.
- *The spider and the fly* (unfold a box). It uses the same verb as the pocket, but in 3D on a phone screen.
- *The 100 prisoners and their boxes*, and *Lights Out as linear algebra.* Both are famous, and in both the flip has to be explained rather than performed.

## How it works

### I. Fifteen

**The isomorphism.** Of the 84 ways to choose three different numbers from 1 to 9, exactly eight add up to 15: 159, 168, 249, 258, 267, 348, 357 and 456. Of the 362,880 ways to place 1 to 9 on a 3&times;3 grid, exactly eight make every row, column and diagonal add up to 15. They are all the Lo Shu (2&nbsp;7&nbsp;6 / 9&nbsp;5&nbsp;1 / 4&nbsp;3&nbsp;8), turned and flipped. On any of them, every line is a triple that makes 15, the eight lines are eight different triples, and there are only eight such triples, so **the lines are exactly the triples**. The map from number to square is therefore a one-to-one relabelling under which "holds three numbers that make 15" and "has three in a row" are the same event, so the two games share one game tree. Counted separately on numbers and on the grid, both have 255,168 complete games: 131,184 won by the first player, 77,904 by the second, and 46,080 drawn.

**The machine.** It computes the exact game value of every position by minimax with a memo over pairs of hands, and it only ever plays a move that keeps the best value available, so it never loses. Among equally good moves it prefers the one that does best against a *careful* opponent, one who takes a winning number when there is one, blocks when the machine threatens one, and otherwise picks at random. That tie-break makes it set traps. When it starts, it opens with an even number (a corner), and against an even opening 5 is the only reply that doesn't lose. Against the careful opponent it wins exactly 89/96 (about 93%) of the games it starts. The page alternates who goes first, starting with you in *Play it* and with the machine in *Play again*, so on your own board you face its strongest opening straight away.

**The hints** in the redraw step point at the representation, not the answer. 5 belongs to four of the triples, each even number to three and each odd number to two. On a 3&times;3 grid the centre lies on four lines, each corner on three and each edge on two. The third hint finishes the job: put the evens in the corners and pair them across the centre (2 with 8, 4 with 6).

### II. Four knights

**The ring.** On a 3&times;3 board no knight move starts or ends on b2. Every other square has exactly two knight moves, and following them visits all eight squares in one cycle: a1, b3, c1, a2, c3, b1, a3, c2 and back to a1. Drawn on the board, those eight strings make an eight-pointed star in which every string crosses four others, which gives the 16 crossings you start the redraw step with.

**The invariant.** On a ring a knight can only step to an empty neighbour, so two knights can never pass each other, and the order of colours read round the ring never changes. At the start it is two whites together and two blacks together, and the swap keeps that order. The diagonals target (white a1 and c3, black c1 and a3) alternates the colours round the ring, so it can never be reached. Exhaustively: there are 420 ways to put two white and two black knights on the eight outer squares. 280 of them keep the colours in pairs (70 ways to choose the four squares, times 4 rotations of the colour pattern) and 140 alternate them. A breadth-first search from the start reaches exactly the 280, and none of the 140.

**Sixteen moves.** The same search puts the swap 16 moves from the start, and no fewer. On the ring the reason is visible: the target is the start turned four places round, and four knights walking four steps each is 16 moves. On the board, by contrast, a player making random legal moves needs 397.5 moves on average to stumble onto the swap (that is the expected hitting time of the random walk on the 280 positions).

**Untangled** means three things together: no two strings that don't share a button meet (touching or overlapping counts), no string runs underneath a button it doesn't belong to, and no two buttons overlap. b2 has no strings at all, which the reader may notice for themselves.

### III. The pocket

Put the table on [0,&nbsp;w]&nbsp;&times;&nbsp;[0,&nbsp;h] with the ball leaving (0,&nbsp;0) along (1,&nbsp;1). At a cushion, instead of reflecting the ball, reflect the table: the mirror copy across the cushion holds the straight continuation of the ball's path, and the path in the real table is that continuation folded back. Unfold at every cushion and the path is the line y&nbsp;=&nbsp;x running through a lattice of mirrored tables. The ball drops into a pocket the first time the line meets a lattice corner, which happens at (L,&nbsp;L) with **L&nbsp;=&nbsp;lcm(w,&nbsp;h)**.

To get there the line crosses L/w = h/g tables across and L/h = w/g tables up, where g&nbsp;=&nbsp;gcd(w,&nbsp;h). Neighbouring copies are mirror images of each other, so the corner (X&middot;w,&nbsp;Y&middot;h) of the lattice is a copy of pocket A, B, C or D according to whether X and Y are even or odd. The ball ends on the right if L/w is odd and on the left if it is even, at the top if L/h is odd and at the bottom if it is even. L/w and L/h have no common factor, so they are never both even: **the ball never comes back to the pocket it left**. Before reaching L the line crosses L/w&nbsp;&minus;&nbsp;1 vertical and L/h&nbsp;&minus;&nbsp;1 horizontal lattice lines, never two at once (that would be an earlier corner), so the ball bounces **w/g&nbsp;+&nbsp;h/g&nbsp;&minus;&nbsp;2** times and travels L&radic;2. Scaling both sides by the same factor changes none of this, which is why 1000&times;600 is the 5&times;3 table and 64&times;48 is the 4&times;3. The page's tables come out as 4&times;3 &rarr; B (5 bounces), 5&times;4 &rarr; D (7), 7&times;5 &rarr; C (10), 1000&times;600 &rarr; C (6), 1001&times;1000 &rarr; D (1,999) and 64&times;48 &rarr; B (5).

### The page

`isomorphs.js` holds all the logic and has no DOM in it. It is a classic script that sets `window.Isomorphs` in the page and `module.exports` in Node. `app.js` draws the rooms in SVG and HTML and handles input. Drags use pointer events, so mouse, touch and pen all work. On the things you can both tap and drag (the Fifteen tiles and squares, the knight squares), a tap is recognised on `pointerup`, because a browser may swallow the click that follows a drag; keyboard activation still arrives as a click. Every control can be reached by keyboard. The Fifteen tiles and cells are buttons: Enter picks a tile up and Enter on a square puts it down. Knight squares can be focused: Enter or Space taps one, and once the squares have lifted, the arrow keys move the focused square (Shift for bigger steps). Animations (the knight's hop, the squares lifting off the board, the ball, the table turning over like a page, the grid lines drawing in) all run instantly under `prefers-reduced-motion`. Light and dark schemes follow the system. There is no audio.

### Tests

`isomorphs.test.mjs` (23 tests) checks every number above against computations written separately from the module, with its own move rules, its own minimax and its own search:

- **Fifteen:** the 8 triples; the 8 magic grids out of 362,880, as the 8 symmetries of the Lo Shu (and the module agrees on every grid); lines equal triples on every magic square, for every possible hand; the incidence counts; the 255,168-game tree on numbers and on the grid; a draw under best play; the module's value of all 4,520 non-final positions against an independent minimax; 5 as the only safe reply to an even opening; a machine that never loses against every sequence of your choices, branching over every tie-break it could take; 89/96 exactly.
- **Knights:** the ring; 280 of 420; 16; the diagonals unreachable; reachable exactly when the colour order is kept; 397.5; the crossing geometry, including that a circle laid out in ring order sits inside the area a drag can reach.
- **The pocket:** every table up to 60&times;60 against a unit-step simulation; the folded straight line equal to the ball at every half-step, on seven tables; the unfolding sequence; the page's six tables; scale invariance.

`ui.test.mjs` plays the whole page through in headless Chromium from `file://`, three times:

- at 390&nbsp;px with real touch drags (sent through the DevTools protocol), dark scheme and reduced motion;
- at 1280&nbsp;px with the mouse, light scheme and full motion;
- at 320&nbsp;px, the narrowest phones.

Each run plays a game of Fifteen, drags and swaps tiles into the Lo Shu, and holds two perfect draws against the machine. It plays the 16-move swap on the board, lifts the squares and drags them into a ring, then plays the swap again on the ring. It calls three pockets, unfolds the 4&times;3 one cushion at a time and the 7&times;5 partly by hand, and answers the three big tables. It checks the status line after each step and the ledger at the end, and fails on any console error. On the two phone widths it also fails if any element sticks out past the viewport, and on the 390&nbsp;px run it checks the output of all three in-page proofs. A fourth run plays the first six knight moves and moves a lifted square using only the keyboard.

## Honest assessment

- [Certain] Fifteen is noughts and crosses under a relabelling of the squares, and the numbers above (8 triples, 8 magic squares, 255,168 games, a draw under best play, 5 as the only safe reply to an even opening) are exact. Each is checked exhaustively and independently.
- [Certain] The machine never loses. Against the careful opponent it was tuned on, it wins 89/96 of the games it starts.
- [Certain] The four knights can reach 280 of the 420 placements and no others, the swap takes 16 moves at least, the diagonals can never be reached, and random play needs 397.5 moves on average to find the swap.
- [Certain] The pocket formula (pocket by parity, w/g&nbsp;+&nbsp;h/g&nbsp;&minus;&nbsp;2 bounces, never back to the start) matches a bounce-by-bounce simulation for every whole-number table up to 60&times;60, and it holds in general by the argument above.
- [Certain] `node tools/check.mjs ideas/51-isomorphs` passes (README, size, both test files, and the smoke test at desktop and phone). The playthrough above found no console errors and no sideways scrolling at 320, 390 or 1280&nbsp;px.
- [Likely] For most people Fifteen is much harder than noughts and crosses. It is the standard example of the effect (Simon used it), and timing studies of puzzle isomorphs found large differences between versions of a single puzzle. Kotovsky, Hayes and Simon (1985, *Cognitive Psychology* 17) gave people versions of the Tower of Hanoi with the same structure, and secondary summaries report that the slowest version took up to about sixteen times as long as the standard one. I could not read the paper itself, and nothing on this page measures anyone.
- [Speculative] Doing the redraw yourself lands harder than being shown it, and the question stays with you afterwards. The whole page is a bet on this, and nothing here tests it. **No human has used this page.** Every judgement about pacing, hint strength, drag feel on a real phone and whether the rooms are too easy or too hard was made from screenshots and headless runs.
- [Likely] The knights' "hard way" is the weakest of the three. On the board a careful person can find the swap by trial (random play needs about 400 moves, a thoughtful person far fewer), so the felt difference in that room rests on the diagonals target and on seeing *why* the answer is 16. A reader who never tries the diagonals gets less from it.
- [Likely] For small tables the pocket's hard way is tedium rather than mystery: with patience you can trace 4&times;3 or 7&times;5 by eye. The payoff only arrives with the big tables at the end.
- [Speculative] The machine's traps are tuned to a model opponent (takes wins, blocks threats, otherwise random), not to people. Real players may fall into them more or less often than 89/96.
- The pocket is idealised: a point ball and point pockets. A real ball has a radius (the same unfolding works on a table shrunk by one radius), and real pockets are wide enough that near-misses drop.
- The redraw steps are inherently visual. They work by keyboard, but I have not tried them with a screen reader.

## Where it could go next

- **A fourth verb.** Count (the ballot problem, by reflecting the paths that touch the line) or rotate (turn the board 45&deg; and bishops become rooks).
- **A bigger board for the knights.** On a 3&times;4 board the knight strings untangle into two rings of six joined by two strings, and the board view of a three-against-three swap there is properly hard.
- **Measure it.** Time people on Fifteen before and after, and compare a version that shows the magic square with one that makes them build it. That is the experiment the [Speculative] line above is waiting for.
- **Other angles for the pocket.** Any rational slope unfolds the same way. The line just meets a different corner of the lattice.
- **A room with no hint about which picture to use**, so that choosing the redraw is the puzzle.
