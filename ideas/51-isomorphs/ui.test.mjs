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
const { Fifteen, Knights } = require('./isomorphs.js');

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
  // 2. Unfold: tap the glowing cushion five times on the 4 x 3 table
  await io.tap(await centre(page, '#p-controls .btn.primary'));
  assert.equal((await ds(page, 'p-stage')).phase, 'redraw');
  for (let k = 1; k <= 5; k++) {
    await io.tap(await centre(page, '#p-svg [data-wall]'));
    await page.waitForFunction((k) => document.getElementById('p-stage').dataset.k === String(k) && !document.querySelector('#p-svg .flipback'), k);
    await page.waitForTimeout(50);
    await page.waitForFunction(() => document.querySelector('#p-svg [data-wall]') || document.getElementById('p-stage').dataset.complete === '1');
  }
  await page.waitForFunction(() => document.getElementById('p-stage').dataset.complete === '1');
  assert.match(await page.locator('#p-status').innerText(), /copy of pocket B\. On the real table that is 5 bounces/);
  // the 7 x 5 table: three cushions by hand, then the rest at once
  await io.tap(await centre(page, '#p-controls .ptabs button:has-text("7×5")'));
  for (let k = 1; k <= 3; k++) {
    await io.tap(await centre(page, '#p-controls button:has-text("Unfold next")'));
    await page.waitForFunction((k) => document.getElementById('p-stage').dataset.k === String(k) && document.querySelector('#p-svg [data-wall]'), k);
  }
  await io.tap(await centre(page, '#p-controls button:has-text("Unfold the rest")'));
  await page.waitForFunction(() => document.getElementById('p-stage').dataset.complete === '1');
  assert.match(await page.locator('#p-status').innerText(), /copy of pocket C\. On the real table that is 10 bounces/);
  // 3. Any table: 6 x 4 by the steppers, then the three big tables
  await io.tap(await centre(page, '#p-controls .btn.primary'));
  await io.tap(await centre(page, '#p-controls button[aria-label="Wide: more"]'));
  assert.match(await page.locator('#p-status').innerText(), /A 7\s×\s4 table, unfolded\. .*Pocket D, 9 bounces/);
  await io.tap(await centre(page, '#p-controls button[aria-label="Wide: less"]'));
  assert.match(await page.locator('#p-status').innerText(), /A 6\s×\s4 table, unfolded\. .*Pocket D, 3 bounces/);
  for (const [q, lab] of [[0, 'C'], [1, 'D'], [2, 'B']]) {
    await io.tap(await centre(page, `#p-controls .qrow[data-q="${q}"] .pkey.${lab}`));
  }
  const verdicts = await page.locator('#p-controls .verdict').allInnerTexts();
  assert.match(verdicts[0], /^Yes, C\. It is a 5\s×\s3 table scaled up 200 times/);
  assert.match(verdicts[1], /^Yes, D\. The line crosses 1,000 tables across \(even, so left\) and 1,001 up \(odd, so top\), after 1,999 bounces/);
  assert.match(verdicts[2], /^Yes, B\. It is a 4\s×\s3 table scaled up 16 times/);
  const row = await page.locator('#ledger tbody tr').nth(2).innerText();
  assert.match(row, /called 2 of 3 pockets\s+called 3 of 3 pockets/);
}

async function proofs(page, io) {
  const run = async (room, expect) => {
    await page.locator(`#${room}-proof summary`).click();
    await io.tap(await centre(page, `#${room}-run`));
    await page.waitForFunction((id) => /in this browser/.test(document.getElementById(id).textContent), `${room}-proof-out`, { timeout: 20000 });
    const text = await page.locator(`#${room}-proof-out`).innerText();
    for (const e of expect) assert.ok(text.includes(e), `${room} proof output lacks "${e}":\n${text}`);
  };
  await run('f', ['adding to 15: 8', 'every line 15: 8', 'games of Fifteen: 255,168 (first wins 131,184, second 77,904, draws 46,080)', 'games of noughts and crosses: 255,168 (first wins 131,184, second 77,904, draws 46,080)', 'value of Fifteen with best play: draw']);
  await run('k', ['b2 has 0 knight moves', 'reachable from the start: 280 (of 420)', 'moves to the swap: 16', 'diagonals reachable: no', 'BBWW', 'BWBW']);
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
