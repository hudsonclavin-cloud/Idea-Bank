# Last Lantern
> How long should you look before choosing something you cannot return to?

**Kind:** decision experiment
**Run:** Open `index.html` directly in a browser. No installation or server required.
**Made by:** Codex / Stillwater

## What it is

A lantern walk on a road with no return. Each stop reveals a lantern and its rank relative to those already seen. Pass it and you cannot come back. Choose it and the whole road becomes visible, including the lantern you were hoping to find. The accompanying chart lets you vary the number of stops and how many to pass before accepting a new record. It calculates the exact success probability and best threshold immediately.

The working browser experiment runs offline with native sliders and buttons, keyboard and touch support, and a responsive phone layout. Changing road length begins a new walk; changing the threshold changes the suggested policy without secretly changing the road. No inputs are saved or sent. A new road advances a local deterministic seed.

The original Python CLI remains available for batch simulations:

```sh
python3 ideas/16-last-lantern/last_lantern.py --candidates 50
```

[Open the generated CLI example](example.txt).

## Why I made it

The famous 37 percent rule sounds like a life hack. I wanted a version that shows exactly what assumptions make it true, and how small the chance of success remains. A lantern is a better place to rehearse an irreversible decision than a person: this is a toy, and the regret stays inside it.

## How it works

There are n candidates in a uniformly random order and only their relative ranks are visible. Pass r, then accept the first record; if no record appears, take the final candidate. Exact success is 1/n when r=0, otherwise (r/n) times the sum of 1/k for k=r..n-1. Every possible skip is evaluated. The browser and Python versions use the same formula and policy, but their seeded shuffles use different PRNGs and do not promise the same road for the same numeric seed.

`model.js` is a pure module shared between browser and Node tests. A seeded Fisher–Yates shuffle creates a permutation; the game reveals only the current candidate's relative rank until a choice is made. The displayed curve is exact, not simulated. The game offers policy guidance but does not automatically choose for you. On the last stop the pass button is disabled, so the final fallback remains available.

## Honest assessment

- [Certain] Seven browser-model tests verify the success formula against exhaustive permutations through n=7, the optimal threshold, seed reproducibility, permutation integrity, hidden-rank behavior, no-recall state transitions and invalid inputs. The existing Python tests remain intact.
- [Certain] The model assumes known pool size, uniformly random ordering, no recall, and a single goal: selecting the absolute best. It says nothing about relationships, hiring fairness, or the value of a good-enough choice.
- [Certain] The game hides absolute brightness until you choose. The road is pseudorandom, not cryptographically random. Its artwork is a metaphor and does not encode the hidden rank.
- [Likely] Comparing a few disappointing walks with the exact curve may make a probability of roughly 37% feel less like a guarantee. This has not been evaluated as a learning intervention.
- [Speculative] Comparing the absolute-best objective with expected selected rank could reveal how much the preferred rule depends on what one counts as success.

## Where it could go next

Compare the absolute-best objective with maximizing expected selected rank. Add an explicitly selected collection of walks so a reader can compare outcomes without introducing background storage.

## Verification

```sh
node --test ideas/16-last-lantern/model.test.mjs
python3 -m unittest discover -s ideas/16-last-lantern -v
node tools/smoke.mjs ideas/16-last-lantern
```
