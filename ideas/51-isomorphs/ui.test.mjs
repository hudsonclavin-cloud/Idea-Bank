// Plays the page through in headless Chromium, from file:// (no server), and checks that every
// state of every room is reachable by the reader's own input:
//   phone: 390 x 844, touch (real touch drags via the DevTools protocol), dark, reduced motion
//   desktop: 1280 x 900, mouse, light, full motion
// Run from the repo root:  node --test ideas/51-isomorphs/ui.test.mjs
// Needs the global Playwright that tools/smoke.mjs uses; skips itself if Playwright is missing.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const URL_ = pathToFileURL(path.join(HERE, 'index.html')).href;
const require = createRequire(import.meta.url);
const { Fifteen, Knights, Pocket } = require('./isomorphs.js');

function loadPlaywright() {
  try { return require('playwright'); } catch { /* fall through to the global install */ }
  try { return createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'noop.js'))('playwright'); } catch { return null; }
}
const playwright = loadPlaywright();

// The 16-move swap, found by walking downhill on distance-to-target (the move graph is undirected).
function swapLine() {
  const toTarget = Knights.distances(Knights.TARGETS.swap);
  const line = [];
  let pos = Knights.START;
  while (pos !== Knights.TARGETS.swap) {
    let step = null;
    for (let i = 0; i < 9 && !step; i++) for (const j of Knights.movesFrom(pos, i)) {
      const q = Knights.move(pos, i, j);
      if (toTarget.get(q) === toTarget.get(pos) - 1) { step = [i, j, q]; break; }
    }
    line.push([step[0], step[1]]);
    pos = step[2];
  }
  return line;
}

async function open(browser, opts) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`console.${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`uncaught: ${e.message}`));
  await page.goto(URL_, { waitUntil: 'load' });
  await page.waitForTimeout(200);
  return { ctx, page, errors };
}

// centre of an element, in viewport coordinates, after scrolling it into view
async function centre(page, selector) {
  const el = page.locator(selector).first();
  await el.scrollIntoViewIfNeeded();
  const b = await el.boundingBox();
  assert.ok(b, `no box for ${selector}`);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
// centre of an element without scrolling (for drags, after the whole stage has been centred)
async function at(page, selector) {
  const b = await page.locator(selector).first().boundingBox();
  assert.ok(b, `no box for ${selector}`);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
async function centreStage(page, id) {
  await page.evaluate((id) => document.getElementById(id).scrollIntoView({ block: 'center', behavior: 'instant' }), id);
  await page.waitForTimeout(30);
}
async function svgToScreen(page, id, x, y) {
  return page.evaluate(([id, x, y]) => {
    const p = new DOMPoint(x, y).matrixTransform(document.getElementById(id).getScreenCTM());
    return { x: p.x, y: p.y };
  }, [id, x, y]);
}

function input(page, touch) {
  let cdp = null;
  return {
    async tap(p) {
      if (touch) await page.touchscreen.tap(p.x, p.y);
      else await page.mouse.click(p.x, p.y);
    },
    async drag(a, b, steps = 10) {
      if (!touch) {
        await page.mouse.move(a.x, a.y);
        await page.mouse.down();
        for (let i = 1; i <= steps; i++) await page.mouse.move(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps);
        await page.mouse.up();
        return;
      }
      if (!cdp) cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y }] });
      for (let i = 1; i <= steps; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps }] });
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      // a person lifts a finger and looks before tapping again; Chrome also swallows a tap that comes
      // within a few milliseconds of a touch drag, which no person can do
      await page.waitForTimeout(350);
    },
  };
}

const ds = (page, id) => page.evaluate((id) => ({ ...document.getElementById(id).dataset }), id);

async function playFifteenGame(page, io, chooser) {
  for (let guard = 0; guard < 20; guard++) {
    await page.waitForFunction(() => { const d = document.getElementById('f-stage').dataset; return d.result || d.turn === 'you'; });
    const d = await ds(page, 'f-stage');
    if (d.result) return d.result;
    const n = chooser(Number(d.you), Number(d.machine));
    const sel = d.phase === 'again' ? `#f-stage .board3 button.cell[data-n="${n}"]` : `#f-stage .pool .num[data-n="${n}"]`;
    await io.tap(await centre(page, sel));
    await page.waitForFunction((you) => { const d = document.getElementById('f-stage').dataset; return d.you !== you; }, d.you);
  }
  throw new Error('game did not end');
}

async function fifteenRoom(page, io, touch) {
  // 1. Play it, choosing the lowest free number every time
  const r1 = await playFifteenGame(page, io, (you, machine) => Fifteen.freeNumbers(you, machine)[0]);
  assert.ok(['you', 'machine', 'draw'].includes(r1));
  // 2. Redraw it: drag four tiles into place, swap two by dragging, then tap the rest into place
  await io.tap(await centre(page, '#f-controls .btn.primary'));
  assert.equal((await ds(page, 'f-stage')).phase, 'redraw');
  const lo = Fifteen.LO_SHU;
  const dragTo = async (from, to) => {
    await centreStage(page, 'f-stage');
    await io.drag(await at(page, from), await at(page, to));
  };
  for (let i = 0; i < 4; i++) await dragTo(`#f-stage .tray [data-tile="${lo[i]}"]`, `#f-stage .cell[data-cell="${i}"]`);
  const cellText = (i) => page.locator(`#f-stage .cell[data-cell="${i}"] .tile`).innerText();
  assert.equal(await cellText(0), String(lo[0]));
  assert.equal(await cellText(3), String(lo[3]));
  await dragTo('#f-stage .cell[data-cell="0"] .tile', '#f-stage .cell[data-cell="1"]');
  assert.equal(await cellText(0), String(lo[1]));
  assert.equal(await cellText(1), String(lo[0]));
  await dragTo('#f-stage .cell[data-cell="0"] .tile', '#f-stage .cell[data-cell="1"]');
  assert.equal(await cellText(0), String(lo[0]));
  // a tile dragged back to the tray leaves the grid
  await dragTo('#f-stage .cell[data-cell="3"] .tile', '#f-stage .tray');
  assert.equal(await page.locator('#f-stage .cell[data-cell="3"] .tile').count(), 0);
  for (let i = 3; i < 9; i++) {
    await io.tap(await centre(page, `#f-stage .tray [data-tile="${lo[i]}"]`));
    await io.tap(await centre(page, `#f-stage .cell[data-cell="${i}"] .cellbtn`));
  }
  assert.equal((await ds(page, 'f-stage')).magic, '1');
  assert.equal(await page.locator('#f-stage .board3.tictac').count(), 1);
  assert.equal(await page.locator('#f-after').isVisible(), true);
  // clearing the finished square afterwards must not break Play again (it keeps the last square)
  await io.tap(await centre(page, '#f-controls button:has-text("Clear")'));
  assert.equal((await ds(page, 'f-stage')).magic, '0');
  // 3. Play again on the board, choosing perfectly: perfect against perfect must draw
  await io.tap(await centre(page, '.step[data-room="f"][data-phase="again"]'));
  assert.deepEqual(await page.locator('#f-stage .board3 .tag').allInnerTexts(), lo.map(String));
  assert.equal((await ds(page, 'f-stage')).phase, 'again');
  const perfect = (you, machine) => Fifteen.optimalMoves(you, machine).moves[0];
  assert.equal(await playFifteenGame(page, io, perfect), 'draw');
  await io.tap(await centre(page, '#f-controls button:has-text("New game")'));
  assert.equal(await playFifteenGame(page, io, perfect), 'draw');
  const row = await page.locator('#ledger tbody tr').nth(0).innerText();
  assert.match(row, /Fifteen\s+1 game: .*\s+2 games: won 0, drew 2, lost 0/);
  void touch;
}

async function knightsRoom(page, io) {
  const line = swapLine();
  assert.equal(line.length, 16);
  const nodeAt = (i) => centre(page, `#k-svg .node[data-node="${i}"] rect`);
  const playLine = async (moves) => {
    for (const [from, to] of moves) {
      const before = Number((await ds(page, 'k-stage')).moves);
      await io.tap(await nodeAt(from));
      await io.tap(await nodeAt(to));
      await page.waitForFunction((b) => Number(document.getElementById('k-stage').dataset.moves) === b + 1, before);
    }
  };
  // 1. Play it on the board: the whole 16-move swap
  assert.equal((await ds(page, 'k-stage')).phase, 'play');
  await playLine(line);
  assert.equal((await ds(page, 'k-stage')).pos, Knights.TARGETS.swap);
  assert.match(await page.locator('#k-status').innerText(), /Swapped in 16 moves/);
  // the centre square can't be jumped to
  await io.tap(await nodeAt(4));
  assert.match(await page.locator('#k-status').innerText(), /centre square/);
  // 2. Redraw it: lift the squares, then drag them round a circle in ring order
  await io.tap(await centre(page, '#k-controls .btn.primary'));
  await page.waitForFunction(() => document.getElementById('k-stage').dataset.phase === 'redraw' && document.getElementById('k-stage').dataset.crossings === '16');
  await page.waitForTimeout(1000); // the lift animation, when motion is on
  const ring = Knights.ringOrder();
  for (let k = 0; k < ring.length; k++) {
    // a circle turned 22.5 degrees, so no target lands on a square that hasn't been moved yet
    const a = -Math.PI / 2 + Math.PI / 8 + (2 * Math.PI * k) / 8;
    await centreStage(page, 'k-stage');
    const target = await svgToScreen(page, 'k-svg', 150 + 112 * Math.cos(a), 150 + 112 * Math.sin(a));
    await io.drag(await at(page, `#k-svg .node[data-node="${ring[k]}"] rect`), target, 12);
  }
  const after = await ds(page, 'k-stage');
  assert.equal(after.crossings, '0');
  assert.equal(after.untangled, '1');
  // 3. Play again on the ring: the same 16 moves, now sliding along strings
  await io.tap(await centre(page, '#k-controls .btn.primary'));
  assert.equal((await ds(page, 'k-stage')).phase, 'again');
  await playLine(line);
  assert.match(await page.locator('#k-status').innerText(), /Swapped in 16 moves\. Sixteen is the fewest possible/);
  assert.equal(await page.locator('#k-after').isVisible(), true);
  await io.tap(await centre(page, '#k-controls .target-pick button:has-text("Diagonals")'));
  assert.match(await page.locator('#k-status').innerText(), /Read the colours/);
  const row = await page.locator('#ledger tbody tr').nth(1).innerText();
  assert.match(row, /swapped in 16 moves\s+swapped in 16 moves/);
}

async function pocketRoom(page, io) {
  // 1. Play it: guess three tables (once by tapping the pocket on the table itself)
  await io.tap(await centre(page, '#p-svg [data-pocket="B"]'));
  await page.waitForFunction(() => /dropped into/.test(document.getElementById('p-status').innerText));
  assert.match(await page.locator('#p-status').innerText(), /Right\. It dropped into B after 5 bounces/);
  await io.tap(await centre(page, '#p-controls button:has-text("Next table")'));
  await io.tap(await centre(page, '#p-controls .pkey.A'));
  await page.waitForFunction(() => /dropped into/.test(document.getElementById('p-status').innerText));
  assert.match(await page.locator('#p-status').innerText(), /You said A\. It dropped into D after 7 bounces/);
  await io.tap(await centre(page, '#p-controls button:has-text("Next table")'));
  await io.tap(await centre(page, '#p-controls .pkey.C'));
  await page.waitForFunction(() => /dropped into/.test(document.getElementById('p-status').innerText));
  // 2. Unfold. Every cushion of the copy the ball is in can be chosen; the reader has to find the right one.
  await io.tap(await centre(page, '#p-controls .btn.primary'));
  assert.equal((await ds(page, 'p-stage')).phase, 'redraw');
  const nextSide = (m, n, k) => (Pocket.unfoldSteps(m, n)[k].wall === 'v' ? 'right' : 'top');
  const pick = async (side) => {
    await centreStage(page, 'p-stage');
    await io.tap(await at(page, `#p-svg [data-wall="${side}"] .hit`));
  };
  const rest = (k) => page.waitForFunction((k) => {
    const d = document.getElementById('p-stage').dataset;
    return d.k === String(k) && d.miss === '0' && !document.querySelector('#p-svg .flipback') && (document.querySelector('#p-svg [data-wall]') || d.complete === '1');
  }, k);
  // only the four cushions of the table are choosable, and none of them is singled out
  assert.equal(await page.locator('#p-svg [data-wall]').count(), 4);
  assert.equal(await page.locator('#p-svg .wallhint').count(), 0);
  // a wrong cushion folds out a copy the straight line never enters, then folds it back by itself
  await pick('left');
  await page.waitForFunction(() => document.getElementById('p-stage').dataset.miss === '1' && document.querySelector('#p-svg .cloth.miss'));
  assert.match(await page.locator('#p-status').innerText(), /Not that cushion\. The copy that folded out across it is one the straight line never enters/);
  await page.waitForFunction(() => document.querySelector('#p-svg .ghostray'));
  await page.waitForFunction(() => document.getElementById('p-stage').dataset.miss === '0' && !document.querySelector('#p-svg .cloth.miss'), null, { timeout: 6000 });
  assert.equal((await ds(page, 'p-stage')).k, '0');
  assert.equal((await ds(page, 'p-stage')).wrong, '1');
  // the other wrong way ahead (the 4 x 3 ball hits the top first); a tap on the right cushion while it shows
  // cancels the wrong copy and unfolds
  assert.equal(nextSide(4, 3, 0), 'top');
  await pick('right');
  await page.waitForFunction(() => document.getElementById('p-stage').dataset.miss === '1');
  await page.waitForTimeout(600);
  await pick('top');
  await rest(1);
  assert.equal((await ds(page, 'p-stage')).wrong, '2');
  // the cushion it came in through: nothing new to unfold
  await pick('bottom');
  assert.match(await page.locator('#p-status').innerText(), /came in through that cushion/);
  assert.equal((await ds(page, 'p-stage')).k, '1');
  for (let k = 1; k < 5; k++) {
    await pick(nextSide(4, 3, k));
    await rest(k + 1);
  }
  await page.waitForFunction(() => document.getElementById('p-stage').dataset.complete === '1');
  assert.match(await page.locator('#p-status').innerText(), /copy of pocket B\. On the real table that is 5 bounces.* You chose every cushion yourself \(after 2 wrong tries\)\./);
  // the 7 x 5 table: one cushion by hand, one with the hint lit, one unfolded by the hint, then the rest at once
  await io.tap(await centre(page, '#p-controls .ptabs button:has-text("7×5")'));
  await rest(0);
  await pick(nextSide(7, 5, 0));
  await rest(1);
  await io.tap(await centre(page, '#p-controls button:has-text("Hint")'));
  assert.equal(await page.locator(`#p-svg [data-wall="${nextSide(7, 5, 1)}"] .wallhint`).count(), 1);
  assert.match(await page.locator('#p-status').innerText(), /Hint: it.s the glowing cushion/);
  await pick(nextSide(7, 5, 1));
  await rest(2);
  await io.tap(await centre(page, '#p-controls button:has-text("Hint")'));
  await io.tap(await centre(page, '#p-controls button:has-text("Unfold it for me")'));
  await rest(3);
  await io.tap(await centre(page, '#p-controls button:has-text("Unfold the rest")'));
  await page.waitForFunction(() => document.getElementById('p-stage').dataset.complete === '1');
  assert.match(await page.locator('#p-status').innerText(), /copy of pocket C\. On the real table that is 10 bounces.* You chose 1 of the 10 cushions yourself\./);
  // 3. Any table: 6 x 4 by the steppers, then the three big tables. The odd-and-even rule and the
  // explanation stay hidden until all three are called.
  assert.equal(await page.locator('#p-after').isVisible(), false);
  await io.tap(await centre(page, '#p-controls .btn.primary'));
  await io.tap(await centre(page, '#p-controls button[aria-label="Wide: more"]'));
  const before = await page.locator('#p-status').innerText();
  assert.match(before, /A 7\s×\s4 table, unfolded\. .*after 4 tables across and 7 up\. Pocket D, 9 bounces/);
  assert.doesNotMatch(before, /odd|even/);
  await io.tap(await centre(page, '#p-controls button[aria-label="Wide: less"]'));
  assert.match(await page.locator('#p-status').innerText(), /A 6\s×\s4 table, unfolded\. .*Pocket D, 3 bounces/);
  // the ledger's "after" cell for the pocket, which must not give a verdict away before the third call either
  const pocketAfter = () => page.locator('#ledger tbody tr').nth(2).locator('td').nth(1).innerText();
  assert.equal(await pocketAfter(), 'not played yet');
  for (const [q, lab] of [[0, 'C'], [1, 'D'], [2, 'B']]) {
    const shown = (await page.locator('#p-controls .verdict').allInnerTexts()).filter((t) => t.trim()).length;
    assert.equal(shown, 0, 'no verdict before all three are called');
    assert.equal(await page.locator('#p-after').isVisible(), false);
    if (q > 0) assert.equal(await pocketAfter(), `${q} of 3 answered (scored after the last)`, 'the ledger scores no call before the third');
    await io.tap(await centre(page, `#p-controls .qrow[data-q="${q}"] .pkey.${lab}`));
  }
  const verdicts = await page.locator('#p-controls .verdict').allInnerTexts();
  assert.match(verdicts[0], /^Yes, C\. It is a 5\s×\s3 table scaled up 200 times/);
  assert.match(verdicts[1], /^Yes, D\. The line crosses 1,000 tables across \(even, so left\) and 1,001 up \(odd, so top\), after 1,999 bounces/);
  assert.match(verdicts[2], /^Yes, B\. It is a 4\s×\s3 table scaled up 16 times/);
  assert.equal(await page.locator('#p-after').isVisible(), true);
  assert.match(await page.locator('#p-status').innerText(), /2 tables across \(even: left\) and 3 up \(odd: top\)\. Pocket D, 3 bounces/);
  const row = await page.locator('#ledger tbody tr').nth(2).innerText();
  assert.match(row, /called 2 of 3 pockets\s+called 3 of 3 pockets/);
  // the coda says what the ledger can and can't show
  assert.match(await page.locator('.coda .ledger-note').innerText(), /a diary, not an experiment/);
}

async function proofs(page, io) {
  const run = async (room, expect) => {
    await page.locator(`#${room}-proof summary`).click();
    await io.tap(await centre(page, `#${room}-run`));
    await page.waitForFunction((id) => /in this browser/.test(document.getElementById(id).textContent), `${room}-proof-out`, { timeout: 20000 });
    const text = await page.locator(`#${room}-proof-out`).innerText();
    for (const e of expect) assert.ok(text.includes(e), `${room} proof output lacks "${e}":\n${text}`);
  };
  await run('f', ['adding to 15: 8', 'every line 15: 8', 'games of Fifteen: 255,168 (first wins 131,184, second 77,904, draws 46,080)', 'games of noughts and crosses: 255,168 (first wins 131,184, second 77,904, draws 46,080)', 'value of Fifteen with best play: draw',
    'the machine against every choice you could make, both ways round: 4,272 games; it won 2,528, drew 1,744, lost 0', "your replies that don't lose after it opens 2, 4, 6, 8: 5; 5; 5; 5"]);
  await run('k', ['b2 has 0 knight moves', 'placements of two white and two black knights on the outer squares: 420; reachable from the start: 280 (the search found 280 positions in all)', 'moves to the swap: 16', 'diagonals reachable: no', 'BBWW', 'BWBW']);
  await run('p', ['tables checked: 3,600', 'agrees with the straight line: 3,600', 'came back to A: 0']);
}

async function noOverflow(page) {
  const r = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    iw: innerWidth,
    wide: [...document.querySelectorAll('body *')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.right > innerWidth + 1 || b.left < -1); })
      .map((e) => `${e.tagName}.${e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className}`).slice(0, 5),
  }));
  assert.ok(r.sw <= r.iw, `page scrolls sideways: ${r.sw} > ${r.iw}`);
  assert.deepEqual(r.wide, [], 'elements stick out past the viewport');
}

test('the whole piece, played through', { skip: playwright ? false : 'Playwright not installed', timeout: 240000 }, async (t) => {
  const browser = await playwright.chromium.launch();
  try {
    await t.test('phone: touch, dark, reduced motion', async () => {
      const { ctx, page, errors } = await open(browser, {
        viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
        colorScheme: 'dark', reducedMotion: 'reduce',
      });
      const io = input(page, true);
      await noOverflow(page);
      await fifteenRoom(page, io, true);
      await noOverflow(page);
      await knightsRoom(page, io);
      await noOverflow(page);
      await pocketRoom(page, io);
      await noOverflow(page);
      await proofs(page, io);
      await noOverflow(page);
      assert.deepEqual(errors, []);
      await ctx.close();
    });
    await t.test('desktop: mouse, light, full motion', async () => {
      const { ctx, page, errors } = await open(browser, { viewport: { width: 1280, height: 900 }, colorScheme: 'light', reducedMotion: 'no-preference' });
      const io = input(page, false);
      await fifteenRoom(page, io, false);
      await knightsRoom(page, io);
      await pocketRoom(page, io);
      assert.deepEqual(errors, []);
      await ctx.close();
    });
    await t.test('keyboard: knights can be moved, and lifted squares nudged, without a pointer', async () => {
      const { ctx, page, errors } = await open(browser, { viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
      const press = async (node, key) => { await page.locator(`#k-svg .node[data-node="${node}"]`).focus(); await page.keyboard.press(key); };
      // the first six moves of the swap: Enter picks a knight up, Space puts it down
      let n = 0;
      for (const [from, to] of swapLine().slice(0, 6)) {
        await press(from, 'Enter');
        await press(to, ' ');
        n++;
        await page.waitForFunction((n) => document.getElementById('k-stage').dataset.moves === String(n), n);
      }
      const moves = Number((await ds(page, 'k-stage')).moves);
      // six moves in: lift the squares and nudge one with the arrow keys
      await page.locator('#k-controls .btn.primary').focus();
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.getElementById('k-stage').dataset.crossings === '16');
      const x0 = await page.locator('#k-svg .node[data-node="2"] rect').getAttribute('x');
      await press(2, 'ArrowRight');
      await page.keyboard.press('Shift+ArrowDown');
      const x1 = await page.locator('#k-svg .node[data-node="2"] rect').getAttribute('x');
      assert.equal(Number(x1) - Number(x0), 10);
      // focus stays on the square being moved
      assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-node')), '2');
      assert.ok(moves >= 6, `only ${moves} moves made by keyboard`);
      assert.deepEqual(errors, []);
      await ctx.close();
    });
    await t.test('keyboard: the pocket\'s cushions can be chosen without a pointer', async () => {
      const { ctx, page, errors } = await open(browser, { viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
      const key = async (sel, k = 'Enter') => { await page.locator(sel).first().focus(); await page.keyboard.press(k); };
      const focused = () => page.evaluate(() => document.activeElement.getAttribute('data-ctl') || document.activeElement.getAttribute('data-wall'));
      const dropped = () => page.waitForFunction(() => /dropped into/.test(document.getElementById('p-status').innerText));
      // the buttons are rebuilt on every render, but focus stays with the reader: after the shot it waits on
      // Next table, and after Next table it is back on the pocket keys
      await key('#p-controls .pkey.A');
      await dropped();
      assert.equal(await focused(), 'next');
      await page.keyboard.press('Enter');
      assert.equal(await focused(), 'pA');
      await page.keyboard.press('Enter');
      await dropped();
      await key('#p-controls .btn.primary');
      await page.waitForFunction(() => document.getElementById('p-stage').dataset.phase === 'redraw');
      // arriving in the redraw step, focus is on a cushion
      assert.equal(await focused(), 'left');
      // Enter on a wrong cushion folds out a wrong copy; Space on the right one unfolds it
      await key('#p-svg [data-wall="right"]');
      await page.waitForFunction(() => document.getElementById('p-stage').dataset.miss === '1');
      await key('#p-svg [data-wall="top"]', ' ');
      await page.waitForFunction(() => document.getElementById('p-stage').dataset.k === '1' && document.querySelector('#p-svg [data-wall]'));
      // focus comes back to the cushions, so the next choice is one key away
      assert.ok(await page.evaluate(() => !!document.activeElement.closest('#p-svg [data-wall]')));
      // Hint, pressed twice on the keyboard: the first press lights the right cushion and leaves focus on the
      // button (not on the last cushion chosen by key, which is the wrong one here), the second unfolds it
      const next1 = Pocket.unfoldSteps(4, 3)[1].wall === 'v' ? 'right' : 'top';
      assert.equal(await focused(), 'top');
      assert.notEqual(next1, 'top');
      await key('#p-controls [data-ctl="hint"]');
      assert.equal(await focused(), 'hint');
      assert.equal(await page.locator(`#p-svg [data-wall="${next1}"] .wallhint`).count(), 1);
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.getElementById('p-stage').dataset.k === '2' && document.querySelector('#p-svg [data-wall]'));
      const d = await ds(page, 'p-stage');
      assert.equal(d.wrong, '1', 'the second press of Hint is not a wrong choice');
      assert.equal(d.miss, '0');
      assert.equal(await focused(), 'hint');
      await page.keyboard.press('Tab');
      assert.deepEqual(errors, []);
      await ctx.close();
    });
    await t.test('keyboard: a cushion chosen by key never pulls focus back once the reader has moved on', async () => {
      // full motion, where the table is redrawn on every frame of a copy folding out and back
      const { ctx, page, errors } = await open(browser, { viewport: { width: 1280, height: 900 }, reducedMotion: 'no-preference' });
      const focused = () => page.evaluate(() => {
        const a = document.activeElement;
        return !a || a === document.body ? 'BODY' : a.getAttribute('data-ctl') || a.getAttribute('data-wall') || a.tagName;
      });
      const inProof = () => page.evaluate(() => !!document.activeElement.closest('#p-proof'));
      const dropped = () => page.waitForFunction(() => /dropped into/.test(document.getElementById('p-status').innerText));
      const settled = () => page.waitForFunction(() => document.getElementById('p-stage').dataset.miss === '0', null, { timeout: 8000 });
      const crossed = () => page.waitForFunction(() => document.querySelector('#p-svg .missx'), null, { timeout: 4000 });
      await page.locator('#p-controls .pkey.A').focus();
      await page.keyboard.press('Enter');
      await dropped();
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      await dropped();
      await page.locator('#p-controls [data-ctl="go-redraw"]').focus();
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.getElementById('p-stage').dataset.phase === 'redraw' && document.querySelector('#p-svg [data-wall]'));
      assert.equal(await focused(), 'left');
      // a wrong cushion by Enter, then Tab (real key presses) to Hint while the wrong copy is out
      await page.keyboard.press('Enter');
      await crossed();
      for (let i = 0; i < 12 && (await focused()) !== 'hint'; i++) await page.keyboard.press('Tab');
      assert.equal(await focused(), 'hint');
      // the wrong copy folds back; focus is still where the reader put it, so Enter means Hint
      await settled();
      await page.waitForTimeout(100);
      assert.equal(await focused(), 'hint', 'focus was pulled back onto the wrong cushion');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(100);
      let d = await ds(page, 'p-stage');
      assert.equal(d.wrong, '1', 'Enter on Hint was taken as a second wrong cushion');
      assert.equal(await page.locator('#p-svg .wallhint').count(), 1);
      // a wrong cushion by Enter, then Tab out of the room to the proof
      await page.locator('#p-svg [data-wall="right"]').focus();
      await page.keyboard.press('Enter');
      await crossed();
      for (let i = 0; i < 20 && !(await inProof()); i++) await page.keyboard.press('Tab');
      assert.ok(await inProof());
      await settled();
      await page.waitForTimeout(100);
      assert.ok(await inProof(), `focus was pulled back to ${await focused()}`);
      // the right cushion by Enter, then Tab out while the copy turns over
      await page.locator('#p-svg [data-wall="top"]').focus();
      await page.keyboard.press('Enter');
      for (let i = 0; i < 20 && !(await inProof()); i++) await page.keyboard.press('Tab');
      await page.waitForFunction(() => document.getElementById('p-stage').dataset.k === '1' && document.querySelector('#p-svg [data-wall]'));
      await page.waitForTimeout(100);
      assert.ok(await inProof(), `focus was pulled back to ${await focused()}`);
      // a reader who stays put keeps the memory: the right cushion by Enter, and focus comes back to the cushions
      const next1 = Pocket.unfoldSteps(4, 3)[1].wall === 'v' ? 'right' : 'top';
      await page.locator(`#p-svg [data-wall="${next1}"]`).focus();
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.getElementById('p-stage').dataset.k === '2' && document.querySelector('#p-svg [data-wall]'));
      await page.waitForTimeout(100);
      assert.equal(await focused(), next1);
      // the right cushion by Enter, then focus goes to another room and falls from there to the page
      const next2 = Pocket.unfoldSteps(4, 3)[2].wall === 'v' ? 'right' : 'top';
      await page.locator(`#p-svg [data-wall="${next2}"]`).focus();
      await page.keyboard.press('Enter');
      await page.evaluate(() => { const b = [...document.querySelectorAll('#k-controls button')].find((x) => !x.disabled); b.focus(); b.blur(); });
      await page.waitForFunction(() => document.getElementById('p-stage').dataset.k === '3' && document.querySelector('#p-svg [data-wall]'));
      await page.waitForTimeout(100);
      assert.equal(await focused(), 'BODY');
      // the right cushion by Enter, then a click on bare page: the reader has left the keyboard
      const next3 = Pocket.unfoldSteps(4, 3)[3].wall === 'v' ? 'right' : 'top';
      await page.locator(`#p-svg [data-wall="${next3}"]`).focus();
      await page.keyboard.press('Enter');
      await page.mouse.click(4, 4);
      await page.waitForFunction(() => document.getElementById('p-stage').dataset.k === '4' && document.querySelector('#p-svg [data-wall]'));
      await page.waitForTimeout(100);
      assert.ok(!(await page.evaluate(() => !!document.activeElement.closest('#p-svg'))), `focus was pulled back to ${await focused()}`);
      d = await ds(page, 'p-stage');
      assert.equal(d.wrong, '2');
      assert.deepEqual(errors, []);
      await ctx.close();
    });
    await t.test('narrowest phones (320 px) do not scroll sideways in any phase', async () => {
      const { ctx, page, errors } = await open(browser, { viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
      const io = input(page, true);
      await noOverflow(page);
      await fifteenRoom(page, io, true);
      await noOverflow(page);
      await knightsRoom(page, io);
      await noOverflow(page);
      await pocketRoom(page, io);
      await noOverflow(page);
      assert.deepEqual(errors, []);
      await ctx.close();
    });
  } finally {
    await browser.close();
  }
});
