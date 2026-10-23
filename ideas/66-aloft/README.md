# Aloft
> A programming language with no variables. To remember a value you throw it, and the height of the throw is how long you'll need it.

**Kind:** language
**Run:** open `index.html` in a browser (classic scripts, works from `file://`; no server, build, network or dependencies). Tests, from the repo root: `node --test ideas/66-aloft/aloft.test.mjs` (Node 18+), and `node ideas/66-aloft/check.mjs` (end to end through the real page in headless Chromium, using the globally installed Playwright that `tools/smoke.mjs` uses). In Node the language is `require('./ideas/66-aloft/aloft.js').run(source)`.
**Made by:** Dwell

## What it is

Aloft is a tiny programming language, and a playground to write it in. It has one idea: **there is no memory except the air.**

A program is a loop of beats. On each beat the juggler catches whatever balls land, names them for that instant, does some arithmetic, and throws every ball back up. Each ball carries one whole number. A throw says how high it goes: `throw total up 3` means "I'll need this again in three beats", and three beats later it lands on whichever beat of the loop is running then. Names vanish at the end of the beat. Nothing else in the language remembers anything.

```
# Fibonacci with two balls.
balls 0 1

catch a b
  say a
  stop when a > 100
  throw b up 1
  throw a + b up 1
```

Heights are numbers written out, never computed, so the whole pattern of throws is known before the program runs. Three things follow from that, and they are the point of the language:

- **The type checker is a juggling theorem.** A throw on beat *i* of an *n*-beat loop with height *h* lands on beat (*i* + *h*) mod *n*. The checker requires every beat to receive exactly as many balls as it catches. That is the rule jugglers use to tell which patterns can be juggled at all; for one ball per beat it is the classic siteswap test, "*i* + *h*ᵢ mod *n* is a permutation". A program that passes can never reach for a ball that isn't there, never has two balls land where it expects one, and never gains or loses a ball.
- **Memory is time.** The number of balls in the air at every moment is the sum of the heights divided by the number of beats. This is the juggler's average theorem. "Memory" here counts values held, as register pressure counts registers, not bits: one ball can carry a 4096-bit number, and the lesson "Everything in one ball" runs a whole computation in a single ball. In the playground's verdict it reads like a typing judgement, `siteswap [311] · 5 balls in the air = (3 + 1 + 1) / 1 beat`, and when `balls` lists the wrong number of starting values the error message is that theorem, with the landing order spelled out.
- **Every program is a juggling pattern.** Its throws are a (multiplex) siteswap, and the playground juggles it: two hands, the values written on the balls, and a timeline of arcs, the ladder diagram jugglers draw, in which the program's memory at any moment is the arcs crossing that moment.

The playground has twelve lessons that teach the language in order (One ball; Two beats; Higher throws hold more; Catching two at once; Remembering twice costs a ball; Choose the value, not the throw; Who goes where: 531; Broken on purpose; A value you'll need later; A circle of seven; Everything in one ball; e, from fifteen balls). It checks and runs as you type, with live output and errors by line and column. While it replays the run it highlights the beat being juggled in the code and the line just said in the output. There is a beat limit you can raise, keyboard stepping (space to play or pause, ← and → to step a beat), and optional sound: each caught ball plucks a note chosen by its value. Your edits to each lesson are kept in `localStorage` when it is available, and "Reset lesson" brings the original back.

## Why I made it

I have always been fond of delay-line memory. EDSAC (1949) kept its numbers as pulses of sound travelling down tubes of mercury. A number existed only while it was in transit, and a program had to be ready to catch it as it came round. Drum-memory programmers later placed each instruction where the drum would be when they needed it. That is a strange, physical way to think about a variable: as something in flight.

Then I noticed that three formulas I knew from different places are the same equation. A juggler's average theorem says that the number of balls is the average throw height. Little's law says that the number of items in a queue is the arrival rate times the average time each one spends there. And in compilers, the number of registers a software-pipelined loop needs is at least the total lifetime of its values divided by the loop's initiation interval. All three say that **memory is how long you hold things, times how often you start holding a new one** (or, the same thing, divided by the time between starts). I wanted a language in which you can't help feeling that: where keeping a value for longer is literally throwing it higher, and where the type checker is the juggling theorem.

The batch theme asked for a part that can be proven and a part that can only be felt. The proven part here is the checker: two short theorems (the landing rule decides exactly which programs are safe, and the ball count is the average height), with tests that try hard to break both. The felt part is the rhythm. You write `throw sq up 3` because you'll need that square three beats from now, then you watch it go up and come down on time. You watch e come out of fifteen balls.

I listed candidates before choosing, all built around one idea in a tiny language:

- A card-trick language where the spectator is a universal quantifier, and the interpreter proves the trick works for every choice. In the end that is model checking in costume.
- A race-logic language where numbers are arrival times, min is a race and max is a wait. Lovely, but it implements an existing formal system (race logic, the space-time algebra).
- A balance-scale language whose programs are weighing strategies, verified against every counterfeit coin. That is a DSL for one puzzle family.
- A conservation language with nothing but transfers. Linear types and Move already do this.
- A sculptor's language that starts from every possible answer and carves. That is constraint programming.
- A fencepost notation where positions are gaps between elements, so off-by-one errors are unwritable. Half-open ranges and Python slicing are most of the way there.
- A tidal program counter that runs forward and then back. Reversible languages such as Janus own this.
- A quipu language of knotted cords that sum into each other. It doesn't compute much.

Aloft was the one whose core idea surprised me when I first wrote it down.

## How it works

### The language in one paragraph

A program is zero or more `balls` lines, then one or more **beats**. A beat starts with a `catch` line and runs until the next `catch`. The run goes in steps *t* = 0, 1, 2, …, and step *t* runs beat *t* mod *n*, where *n* is the number of beats. A beat catches the balls landing at *t*, runs its statements top to bottom, and throws every ball it caught: `throw e up h` puts a ball carrying the value of `e` in the air, landing at step *t* + *h*. `let` names a value for the rest of the beat. `say` prints a line. `stop` ends the run.

### Grammar

Lexical rules:

- A **line break** is `\n`, `\r\n` or `\r`. Statements end at line breaks. **Inside round brackets, line breaks are ignored**, so an expression can span lines.
- **Whitespace** is spaces, tabs, form feeds and vertical tabs. A **comment** runs from `#` to the end of the line.
- An **integer** is a run of decimal digits (leading zeros allowed). A digit run directly followed by a letter or `_` is an error. Literals must be below 2^4096.
- A **name** is an ASCII letter or `_` followed by ASCII letters, digits and `_`. Names are case-sensitive.
- Any other character outside a string or comment is an error, including invisible ones such as a non-breaking space.
- Keywords (reserved): `balls`, `catch`, `say`, `stop`, `when`, `throw`, `up`, `let`, `if`, `then`, `else`, `and`, `or`, `not`, `min`, `max`, `abs`.
- A **string** is `"` followed by any characters except `"` and line breaks, then `"`. There are no escapes. Strings may only appear as `say` items.
- **Operators**: `+ - * / % ( ) , = == != < <= > >=`.
- **Positions**: lines and columns count from 1, and a column is one character (a tab is one column, and a character outside the Basic Multilingual Plane, such as an emoji, is one column).

Syntax (EBNF; `end` is one or more line breaks, or the end of the input):

```
program    = { balls-line } beat { beat } ;
balls-line = "balls" { [ "-" ] integer } end ;
beat       = "catch" { name } end { statement } ;
statement  = ( let | throw | say | stop ) end ;
let        = "let" name "=" expr ;
throw      = "throw" expr "up" integer ;            (* the integer is from 1 to 9999 *)
say        = "say" [ item { "," item } ] [ "when" expr ] ;
item       = string | expr ;
stop       = "stop" [ "when" expr ] ;

expr       = "if" expr "then" expr "else" expr | or ;
or         = and { "or" and } ;
and        = not { "and" not } ;
not        = "not" not | cmp ;
cmp        = sum [ ( "==" | "!=" | "<" | "<=" | ">" | ">=" ) sum ] ;
sum        = term { ( "+" | "-" ) term } ;
term       = unary { ( "*" | "/" | "%" ) unary } ;
unary      = "-" unary | atom ;
atom       = integer | name | "(" expr ")"
           | ( "min" | "max" | "abs" ) "(" expr { "," expr } ")" ;
```

Blank lines and comment lines may appear anywhere. `balls` lines must come before the first `catch`. A comparison does not chain: `a < b < c` is an error, while `(a < b) < c` is allowed. The branches of `if` are full expressions, so `if c then x else y + 1` means `if c then x else (y + 1)`. Precedence, from loosest to tightest: `if`; `or`; `and`; `not`; comparisons; `+ -`; `* / %`; unary `-`. Binary operators group to the left. An expression may nest at most 200 levels deep. Brackets, `if` parts, function arguments, `not` and unary `-` each add a level as the parser reads them, and each operator, `not`, unary `-`, `if` and call adds a level to the finished tree, so a chain `a + b + c + …` of more than 200 terms is too deep. (The exact limit is `MAX_DEPTH` in `aloft.js`.) Going over is a syntax error, never a crash.

### Semantics

1. **Steps.** Beats are numbered 0 to *n* − 1 in source order. Step *t* runs beat *t* mod *n*.
2. **Catching.** At step *t* the balls that land at *t* are caught. Their values are bound, in **catch order**, to the names on the beat's `catch` line. The checker guarantees that the count matches (see the theorem below).
3. **Catch order.** Among balls landing at the same step, the one thrown at an earlier step is caught first. Balls thrown at the same step (and so with the same height) are caught in the order of their `throw` lines.
4. **Statements** run top to bottom.
   - `let x = e` binds `x` for the rest of the beat.
   - `throw e up h` evaluates `e` and puts a ball with that value in the air, landing at step *t* + *h*.
   - `say items when c`: if there is a `when`, its condition is evaluated first, and if it is 0 nothing else happens. Otherwise the items are evaluated left to right and one output line is appended, with the items joined by single spaces. Strings print as written, and integers print in decimal with a leading `-` when negative. `say` with no items prints an empty line. (A line that reaches the output's character limit is cut there: see `output-limit` below.)
   - `stop when c`: if there is no `when`, or its condition is not 0, the run ends at once. The rest of the beat does not run, and the beat counts as run.
5. **Names last one beat.** Every name is gone when the beat ends. The only things that carry information from one step to the next are the balls in the air.
6. **The start.** The program behaves as though it had always been running. For every step *s* < 0, beat *s* mod *n* "threw" its balls with its heights. The virtual throws that land at a step ≥ 0 are the balls in the air when the program starts. They take the values listed in `balls`, in order of landing step and then catch order (rule 3, applied to the virtual throw steps). Several `balls` lines form one list. For a loop like `catch old sum k` with throws up 3, 1 and 1, the order is: at *t* = 0 `old`, `sum`, `k`; at *t* = 1 `old`; at *t* = 2 `old`. A wrong count is an error that spells this order out.
7. **Numbers** are integers with absolute value below 2^4096.
   - `+ - *` are exact. A result outside the range is a runtime error at that operator.
   - `/` rounds down, and `%` is the matching remainder: `a == (a / b) * b + a % b`, and `a % b` has the sign of `b` or is 0. So −7 / 2 = −4 and −7 % 2 = 1. Dividing or taking a remainder by zero is a runtime error at that operator.
   - Comparisons give 1 or 0. `not x` is 1 if `x` is 0, and 0 otherwise.
   - `a and b` is 0 if `a` is 0, without evaluating `b`; otherwise it is 1 if `b` is not 0, and 0 if it is. `a or b` is 1 if `a` is not 0, without evaluating `b`; otherwise it is 1 if `b` is not 0, and 0 if it is.
   - `if c then x else y` evaluates `c`, then only the branch it picks. Any non-zero value counts as true.
   - `min` and `max` take two or more arguments and `abs` takes exactly one. Arguments, like the two sides of every operator, are evaluated left to right.
8. **Ending.** A run ends with one of these statuses:
   - `stopped`: a `stop` ran.
   - `error`: a runtime error. The output so far is kept, and the error has a line, a column and the step.
   - `limit`: the beat limit was reached. It is 10,000 steps by default, and the playground lets you set it from 1 to 100,000. A program without a `stop` simply juggles until then.
   - `output-limit`: the output reached its line limit (10,000 lines by default, 2,000 in the playground) or its character limit (1,000,000 characters by default, 200,000 in the playground). The run halts at the `say` that reached it. Characters are counted as JavaScript string length, so a character outside the Basic Multilingual Plane counts as two. If a line would take the output past the character limit, it is cut at the limit (never inside a character) and its remaining items are not evaluated. The character limit exists because a few hundred bytes of program can otherwise say tens of megabytes of digits, and a string-only `say` costs no work units at all.
   - `work-limit`: the work budget ran out. Every expression node evaluated (literal, name, operator, call, `if`) costs one unit, and the default budget is 5,000,000.
   - `time-limit`: a wall-clock budget ran out. Arithmetic on 2000-bit numbers costs far more than one unit, so the playground also stops any run whose interpretation takes longer than 0.6 s; without that guard, 100,000 steps of big multiplications take about 4.5 s. That guard covers interpreting only. What the page then has to show is bounded by the output limits above and by the playground itself, which shows at most 2,000 lines and 200,000 characters of output and draws at most 200 balls. The module sets no time limit by default, so outside the playground every result is deterministic.

### The checker

Before a program runs, the checker makes these passes and reports the first failure. Within a pass it goes top to bottom. In the syntax pass the lexer hands the parser one token at a time, so the first failure in reading order is reported, whether it is a bad character or bad grammar: an unterminated string on line 3 can't hide a missing operand on line 2. A `(` that is never closed counts as failing at the bracket itself, so it wins over any error after it; otherwise a forgotten `)` would surface as a puzzling error on a later line.

1. **Syntax**, by the parser.
2. **Names and arity.** In each beat, a name must be bound before it is used, either by `catch` or by a `let` above. Catch names are distinct, and a `let` can't reuse a name already bound in that beat. `min` and `max` need two or more arguments, and `abs` exactly one.
3. **Every ball goes back up.** Each beat has as many `throw`s as names on its `catch` line. Fewer would drop a ball, and more would throw a ball the juggler isn't holding. Throws can't have `when`, which is a syntax error that explains the alternative: choose the value with `if`.
4. **Landing.** For each beat *j*, the number of throws (from any beat *i*, with any height *h*) that have (*i* + *h*) mod *n* = *j* equals the catch count of beat *j*. The error names the throws that land there, by line and height.
5. **Ball count.** `balls` lists exactly (sum of all heights) / *n* values.

**Theorem (no drops, constant memory).** If passes 3 and 4 hold, then at every step of every run exactly the right number of balls lands, and at every moment exactly (Σ*h*)/*n* balls are in the air. *Proof.* Extend the run backwards forever, as rule 6 does. In that periodic history, the throws landing at a step of beat *j* are exactly the throws with (*i* + *h*) mod *n* = *j*, one copy each, so pass 4 says precisely that every catch gets its count. Each step then receives as many balls as it catches and throws as many as it catches (pass 3), so the number of balls in the air never changes. Over one period of *n* steps the flights cover Σ*h* beat-lengths of air time, so that number is Σ*h*/*n*. The real run is that history with the throws before step 0 replaced by the `balls` values, which pass 5 lists one for one. ∎ In particular, (Σ*h*) mod *n* = 0 whenever passes 3 and 4 hold, so the count in pass 5 is always a whole number.

**Converse.** If pass 4 fails, the bare pattern collides or drops within (largest height + *n*) steps, however many balls it starts with and wherever they start. The landing counts add up to the catch counts (every throw lands somewhere), so if one beat is short, another, *j*, receives more throws than it catches. After the largest height, a step of beat *j* gets all of those throws from real throws alone, and start balls can only add to them. Such a step comes round within *n* more steps.

**Counting.** For one ball per beat (each beat catches 0 or 1), the height patterns that pass (the heights each beat throws, ignoring names and arithmetic) with *n* beats and *b* balls correspond one-to-one to juggling sequences, of which there are (*b*+1)^*n* − *b*^*n* (Buhler, Eisenbud, Graham and Wright, 1994). That holds while *b*·*n* ≤ 9999: a juggling sequence can contain a throw as high as *b*·*n*, and Aloft heights stop at 9999, so beyond that some sequences have no Aloft program.

### Errors

Every error has a kind (`syntax`, `check` or `runtime`), a message, a line and a column.

- Syntax errors point at the offending token, or at the opening `"` of an unterminated string, or at the outermost `(` that is never closed. A program with no beats at all is reported at line 1, column 1.
- Name and arity errors point at the name or the function.
- Throw-count and landing errors point at the beat's `catch` line. Ball-count errors point at the first `balls` line, or at the first `catch` line if there is none.
- Runtime errors point at the operator that failed, and also give the step *t*.

Some messages exist to teach the idea. `x = 3` gets "There are no variables in Aloft. To keep "x" for later, throw it…". Using a name on a beat that didn't catch it gets "Names last one beat". `throw … when` explains that the ball has to go up either way.

### Interpreter design

`aloft.js` is pure (no DOM, no I/O). It loads as a classic browser script (`window.Aloft`) and as a CommonJS module in Node. It has five parts:

- **Lexer.** It hands out tokens one at a time as the parser asks for them, drops line breaks inside brackets, and tracks lines and columns in characters.
- **Parser.** Recursive descent, one function per grammar rule, with a depth guard.
- **Checker.** The five passes above. It also returns the siteswap string, the ball count, the heights, and the start schedule, built from the periodic history exactly as rule 6 says.
- **Runner.** The air is a map from landing step to a list of balls. The start balls go in first, and each throw appends to the list for its landing step. Lists therefore fill in throw order, which is catch order, with no sorting. A defensive check that the landed count equals the catch count is unreachable for checked programs, and the tests try to reach it.
- **Formatter.** It prints canonical source with minimal brackets, used by the round-trip tests. A minus directly inside a minus prints as `- -x`, not `-(-x)`, so formatting never adds nesting and any program that parses formats to one that parses.

Arithmetic uses BigInt, with floor division written out. The runner can record a trace (catches, throws and output for each step) for the playground.

`examples.js` holds the lessons with their documented results. `ui.js` is the playground: an auto-growing textarea with a line gutter, bands behind the code for the current beat and the error line, and two canvases. The juggle draws beat *t* in the right hand when *t* is even and the left when it is odd, as in two-handed siteswap, so odd heights cross and even ones return. Two drawing conventions are not semantics. Balls are drawn arriving 0.4 beat before their catch step. And the *k*-th throw of a beat is drawn as the same physical ball as the *k*-th ball caught, which is what keeps ball colours stable.

### Prior art

- **Siteswap** notation (invented independently by Paul Klimek in Santa Cruz in 1981, and around 1985 by Bruce Tiemann and Bengt Magnusson at Caltech and by Mike Day, Colin Wright and Adam Chalcraft in Cambridge) writes a juggling pattern as throw heights. Its permutation test and average theorem are exactly Aloft's checker. The counting theorem is from Buhler, Eisenbud, Graham and Wright, "Juggling drops and descents" (*American Mathematical Monthly*, 1994).
- **Drops**, a juggling animator listed in Philip Wadler's catalogue of real-world functional programs, takes patterns written in a small functional language built on siteswap. That language *describes* juggling patterns to an animator. In Drops the pattern is the output. In Aloft the pattern is the memory of a computation.
- **Delay-line and drum memory.** EDSAC's mercury tanks and Turing's ACE design held values in transit. IBM 650 "optimum programming" placed instructions by rotation time, and the Story of Mel is that craft at its peak. Aloft is a delay line made of air, with the delay chosen per value.
- **Stream and dataflow languages.** Lucid's `fby`, Lustre's `pre`, synchronous dataflow, and Leiserson and Saxe's retiming of systolic arrays all store values on delayed edges. A throw up *h* is a value on an edge of delay *h*. What Aloft adds is the requirement that the delays tile time exactly (the landing rule), and the reading of total delay as the memory bound.
- **Software pipelining** (modulo scheduling): register pressure is at least the total value lifetime divided by the initiation interval. **Little's law** says the same about queues.
- **Linear types** and resource-oriented languages forbid copying and dropping. Aloft's balls can be neither dropped nor made from nothing, but the numbers on them copy freely.
- **Universality.** Conway's FRACTRAN (1987) runs in a single ball thrown up 1, and any Minsky register machine compiles to a one-beat loop with one ball per register plus one for the instruction counter (`catch s r0 r1 …`, every ball thrown up 1). Each instruction *k* adds two flat lines: `let n(k+1) = n(k) + (s == k) * target` builds the next instruction, and one `let` adds (*s* == *k*) to, or takes (*s* == *k* and *r* > 0) from, its register's change. So the expressions stay a few levels deep however long the machine is. (A first version used one nested `if` chain per register instead; it hits the 200-level nesting limit at 100 instructions.)
- **Ball-based esolangs** exist (FallDown, Billiards, Ballang and others), with values riding on moving balls. I found none in which a value's lifetime is a throw height, or whose checker is the siteswap theorem. My search was a few queries, not a survey.

### Verification

`aloft.test.mjs` has 31 tests and takes about 5 s.

- **Lessons.** All 12 lessons produce their documented output, step count, siteswap and ball count. The broken lesson gives its documented error at line 5, column 1. Every claim in the lesson texts is checked: any swap of two heights fixes the broken lesson; in 531 ball 2 only ever goes up 3; FRACTRAN multiplies every *a* × *b* for *a*, *b* ≤ 4; e's digits are e's; Josephus agrees with a direct simulation of the circle; the window column really is the sum of the last three squares.
- **Parser.** Format and parse round-trip on every lesson and on 1500 random programs, and formatting is idempotent. Source nested right up to the limit (199 minus signs in a row) formats to source that still parses. Positions are checked with comments, CRLF, tabs, continuation lines and emoji.
- **Errors.** 61 syntax and check errors, each with its kind, its exact line and column, and its message. Also the landing-order text in ball-count errors, the order of the checker's passes, and 13 programs where the earliest syntax failure in reading order must win, whether it is lexical or grammatical (most have two errors; a `(` that is never closed fails at the bracket). In 400 random programs with one `)` removed, the parser names the same unclosed bracket as a full pass of the lexer.
- **Semantics, rule by rule.** Floor `/` and `%` over a grid of signs against an independent formula; a precedence table; laziness of `and`, `or` and `if`; `say` joining and `when`; `stop` mid-beat; the beat loop; landing at *t* + *h*; catch order (an earlier throw is caught before a later one even when its `throw` line comes second); the start schedule of the excited pattern 51; concatenated `balls` lines; the 2^4096 boundary from both sides.
- **Runaways.** A program with no stop halts at the beat limit, and a 100,000-step run is fine. A flood of output halts at the output limit. With the playground's settings, a 328-byte program that used to say about 28 MB inside the 0.6 s guard stops at 200,000 characters after 4 beats, and two 40,000-character strings per line stop after 3 beats; a line that reaches the limit is cut there and its later items are not evaluated. A 20,000-argument `min` halts at the work budget. Big-number arithmetic halts at a 0.15 s time budget when one is set. Squaring forever is a clean runtime error. Nesting 300 deep is a syntax error, not a stack overflow. A pattern needing 3,999,600 balls is rejected without building them. All of this takes a few seconds.
- **Reference interpreter.** The tests contain a separate interpreter, written from this README. It has its own expression trees, a fully bracketed printer that records operator positions, a start schedule enumerated step by step from the virtual history, catches sorted explicitly by (throw step, throw line), and its own floor arithmetic. On 3000 random valid programs (1 to 4 beats, 0 to 3 balls per catch, random `let`, `say`, `stop` and nested expressions, run for 40 steps) the real interpreter agrees with it on status, every output line, step count, ball count, and every runtime error's kind, line, column and step.
- **Precedence against the spec.** 4000 random expressions are printed with only the brackets the precedence table requires (plus a few spare), and each evaluates to the value of the tree it was printed from.
- **The theorems.** For every one-ball-per-beat program with up to 4 beats and heights up to 6, the checker agrees with the permutation test. The counting formula (*b*+1)^*n* − *b*^*n* holds for *n* ≤ 4 and *b* ≤ 3. On 400 random checked programs run for 300 steps, every catch gets its count and exactly Σ*h*/*n* balls are in the air at every step. On over 200 random rejected patterns, each simulated from 5 random starts, the pattern fails within (largest height + *n*) steps.
- **Universality.** Three Minsky machines (add, multiply, swap) compiled to Aloft agree with a direct simulation on every input pair up to 5, each holding one ball per register plus one for the counter. So do longer machines built from register-to-register moves: 98, 100 and 120 instructions on 5 registers, and 60 instructions on 12. The nested-`if` construction agrees up to 98 instructions and is rejected as too deep from 100 on, which the test also checks. Conway's PRIMEGAME in one ball matches a direct FRACTRAN run for 2000 steps, passing through 2², 2³, 2⁵ and 2⁷.
- **README.** The header and sections are here, the keyword list matches the lexer's, every lesson is named, and the limits quoted here match the code.

`check.mjs` drives the real page in headless Chromium (48 checks, about 25 s):

- **At phone size, with touch,** it types a new program key by key (triangle numbers), using Tab to indent, and checks the output, the verdict and the siteswap. It then breaks the program and checks the ball-count error, the gutter mark and "Go to line". It checks the names-last-one-beat error. It plays, pauses and steps the replay, and checks the current-beat marks and the output highlight. It also checks the sound toggle, the absence of horizontal scroll, that an edit survives a reload, and that Reset restores the lesson.
- **On desktop, in dark mode,** it runs all twelve lessons through the page, and checks that the space key plays and pauses and the arrow keys step.
- **Runaways, at phone size.** It pastes the 328-byte flood and the 80 KB string flood, and checks that the page answers within 2.5 s (it froze for about 5 s and 40 s before the output caps) and shows exactly 200,000 characters with a note saying why. With the interpreter's caps lifted, 10 MB of output still puts only 200 lines and 200,000 characters in the page. A pattern of 9999 balls thrown up 9999 replays at speed, with no long task over 400 ms (each frame took over a second when every ball was drawn).
- It loads the page with `localStorage` throwing on every access, and again with reduced motion.

Both test files run under `node tools/check.mjs ideas/66-aloft`, which passes, as does the headless smoke test at desktop and phone. I looked at the screenshots in both colour schemes.

## Honest assessment

- **No human has programmed in Aloft.** Every program in it was written by me, and every check was run by a machine. Whether a newcomer can read the lessons top to bottom and then modify them is a hope, not a finding.
- [Likely] The interpreter implements the semantics above in every case. [Certain] for every case the tests reach: an independent reference agrees on 3000 random programs, there are rule-by-rule tests, and 61 errors are checked to the column. That is evidence, not a proof. An independent reviewer has since written a second interpreter from this README and found it agreeing on 5,600 random and 49 adversarial programs; what it did find is in the revision note.
- [Certain] The checker's guarantee holds in both directions. A checked program never drops or collides and holds exactly Σ*h*/*n* balls, and a rejected pattern fails within (largest height + *n*) steps from any start. There are short proofs above, and both directions are tested on hundreds of random patterns.
- [Certain] Aloft is Turing-complete in principle: Minsky machines compile into it by the flat construction under Prior art (one ball per register plus one for the counter, two `let` lines per instruction, so no expression grows with the machine), and FRACTRAN runs in one ball. The construction is general by inspection; the tests run it on machines of up to 120 instructions. The implementation caps numbers below 2^4096 and stops at the beat, output and work limits (and, in the playground, a time limit), so in practice it is a very large finite machine.
- [Likely] The idea is new as a programming language: memory as flight time, with the siteswap theorem as the type checker. I found juggling-notation tools, a language for describing juggling patterns (Drops), and esolangs with balls carrying values, but nothing with this core. The search was brief.
- [Speculative] Writing Aloft gives a feel for memory as lifetime: that keeping something longer costs space in proportion, which is the one sentence behind register pressure and Little's law. The "Remembering twice costs a ball" lesson is where that should land, if it lands anywhere.
- [Likely] The catch-order rule is the weakest part of the design. It is deterministic and simple to state ("caught in the order thrown"), but you have to think about it whenever balls of different heights meet. And the `balls` list for a pattern that mixes heights interleaves in a way that surprises: in the e lesson, the first beat takes four values and then eleven more land one per beat. The error message spells the order out, which helps but doesn't make it intuitive.
- [Certain] Ergonomics are deliberately poor in one direction. There is no input, no arrays other than delay lines, and no strings beyond literals. Anything with an index becomes a timing puzzle. That is the experience the language is for, but it makes ordinary programs slow to write.
- Real juggling: every Aloft program is a valid siteswap, but most interesting ones are multiplex patterns full of 1s ([11], [c111]) that no person would actually juggle. The connection to the physical act is honest at the level of the notation, not the hands.
- Playground rough edges:
  - On a phone the code is 16 px, so iOS does not zoom when you tap into the editor, and lines longer than about 30 characters scroll sideways inside the editor.
  - The replay covers the first 400 steps.
  - The page shows at most 2,000 lines and 200,000 characters of output, and the interpreter stops there; the last line can be cut mid-number. Long values in the beat description and the start list are shortened to their first digits and their length.
  - Past 200 balls, the juggle and the timeline draw only the first 200 balls to land, and say so. Drawing all 9999 balls of a `{9999}` pattern made every replay frame take over a second.
  - A run heavy enough to reach the playground's 0.6 s time limit gets further on a faster machine. Only that guard depends on the machine; the module itself is deterministic.
  - The juggling animation fudges the catch (balls arrive 0.4 beat early so that hands visibly hold them) and doesn't model real hand motion.
  - The sound is simple synthesis and was never listened to on a real speaker.
  - There is no syntax highlighting.

## Where it could go next

- **Data-dependent heights.** Allowing `throw x up (expr)` would make sleep sort an honest algorithm ("throw each number as high as its value"), at the price of the theorem: collisions would become runtime errors. A mode that offers both, with the checker proving the cases it can, would make the trade visible.
- **Passing patterns.** Two jugglers who throw to each other are two threads that communicate at statically known times. Passing siteswaps already have a notation, and the landing rule would make every such concurrent program deterministic and free of races by construction.
- **A compiler into Aloft.** Take an ordinary loop and choose heights for its values. That is register allocation and modulo scheduling, and minimising Σ*h* is minimising memory. Showing the juggle of a compiled loop would make software pipelining visible.
- **Retiming.** An optimiser that shortens throws without changing the output, showing the ball count fall as it works.
- **Teach with real balls.** Lessons 1 to 3 and 531 can be juggled by a person holding numbered balls who does the arithmetic aloud. A printable card for that would be a nice classroom object.

## Revision note

An independent reviewer reimplemented Aloft from this README and agreed with it on every program it tried. It found one real bug and a few overstatements, all now fixed:

- **The playground could still freeze.** The 0.6 s guard limited interpreting, not output. A 328-byte program said about 28 MB inside it and froze the page for about 5 s on every edit, and an 80 KB paste of two strings froze it for about 40 s. Output is now capped at 200,000 characters as well as 2,000 lines, both in the interpreter (`maxOutputChars`, 1,000,000 by default) and again in the renderer, with a note in the output when it stops. A `{9999}` pattern took over a second per replay frame; the juggle and timeline now draw at most 200 balls.
- **"One ball per register" was wrong.** The tested Minsky construction needs one more ball, for the instruction counter, and its nested `if` chains stopped parsing at 100 instructions. It is now a flat construction, tested up to 120 instructions, and the README states it.
- **Error order.** The whole source was lexed before parsing, so a bad character or unterminated string on a later line hid a grammar error, and its teaching message, on an earlier one. The lexer is now lazy, and the first failure in reading order wins (an unclosed `(` still fails at the bracket).
- **The slogan was inverted.** Memory is how long you hold things *times* how often you start holding one, as in Little's law, not divided by it.
- **Smaller fixes:** the counting theorem is about height patterns and needs *b*·*n* ≤ 9999; the formatter no longer turns valid deep source (`- - -x`) into source too deep to parse; and "memory" is now said to count values held, not bits, since one ball can carry 4096 bits.
