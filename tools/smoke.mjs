#!/usr/bin/env node
// Headless smoke test for browser ideas. Serves the repo root over HTTP, loads each
// page at desktop and phone sizes, pokes it (taps, keys, drag, buttons), and fails on
// console errors, uncaught exceptions, failed local requests, or phone-width overflow.
//
// Usage: node tools/smoke.mjs <idea-dir | page.html>... [--out DIR] [--wait MS]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

const VIEWPORTS = [
  { name: 'desktop', viewport: { width: 1280, height: 800 } },
  { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
];

function parseArgs(argv) {
  const opts = { targets: [], out: path.join(os.tmpdir(), 'idea-bank-smoke'), wait: 1500 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') opts.out = path.resolve(argv[++i]);
    else if (a === '--wait') opts.wait = Number(argv[++i]);
    else if (a === '-h' || a === '--help') {
      console.log('Usage: node tools/smoke.mjs <idea-dir | page.html>... [--out DIR] [--wait MS]');
      process.exit(0);
    } else opts.targets.push(a);
  }
  if (!opts.targets.length) {
    console.error('smoke: give at least one idea folder or HTML file');
    process.exit(2);
  }
  return opts;
}

function loadPlaywright() {
  const req = createRequire(import.meta.url);
  try {
    return req('playwright');
  } catch {
    const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
    return createRequire(path.join(globalRoot, 'noop.js'))('playwright');
  }
}

function resolveTarget(t) {
  let p = path.resolve(t);
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!fs.existsSync(p)) throw new Error(`no such page: ${p}`);
  if (!p.startsWith(ROOT + path.sep)) throw new Error(`page is outside the repo: ${p}`);
  return p;
}

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
      let p = path.join(ROOT, decodeURIComponent(url.pathname));
      if (p !== ROOT && !p.startsWith(ROOT + path.sep)) {
        res.writeHead(403).end();
        return;
      }
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
      fs.readFile(p, (err, data) => {
        if (err) {
          res.writeHead(404).end('not found');
          return;
        }
        res.writeHead(200, { 'content-type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function poke(page, vp) {
  const { width: w, height: h } = vp.viewport;
  if (vp.hasTouch) {
    await page.touchscreen.tap(w / 2, h / 2);
  } else {
    await page.mouse.click(w / 2, h / 2);
  }
  await page.waitForTimeout(200);
  for (const key of ['Space', 'ArrowRight', 'ArrowUp', 'KeyA', 'Enter']) {
    await page.keyboard.press(key);
    await page.waitForTimeout(60);
  }
  await page.mouse.move(w * 0.3, h * 0.5);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(w * (0.3 + 0.04 * i), h * (0.5 + 0.01 * i));
  await page.mouse.up();
  await page.waitForTimeout(200);

  // Exercise up to a dozen visible buttons; a button that is obscured or detached is not a page bug.
  const buttons = page.locator('button:visible');
  const n = Math.min(await buttons.count(), 12);
  for (let i = 0; i < n; i++) {
    try {
      await buttons.nth(i).click({ timeout: 800 });
      await page.waitForTimeout(150);
    } catch {
      /* ignore unclickable buttons */
    }
  }
}

async function checkPage(browser, origin, file, vp, opts) {
  const errors = [];
  const warnings = [];
  const context = await browser.newContext({
    viewport: vp.viewport,
    isMobile: !!vp.isMobile,
    hasTouch: !!vp.hasTouch,
    deviceScaleFactor: vp.deviceScaleFactor || 1,
    acceptDownloads: true,
  });
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`uncaught: ${e.message}`));
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  page.on('requestfailed', (r) => {
    const local = r.url().startsWith(origin);
    (local ? errors : warnings).push(`request failed${local ? '' : ' (external)'}: ${r.url()} ${r.failure()?.errorText || ''}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && r.url().startsWith(origin)) errors.push(`HTTP ${r.status()}: ${r.url()}`);
  });

  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  const slug = rel.replace(/\/index\.html$/, '').replace(/[^a-z0-9]+/gi, '_');
  const shots = [];
  try {
    await page.goto(`${origin}/${rel}`, { waitUntil: 'load', timeout: 20000 });
    await page.waitForTimeout(opts.wait);
    const before = path.join(opts.out, `${slug}-${vp.name}-1-loaded.png`);
    await page.screenshot({ path: before });
    shots.push(before);

    const layout = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      text: (document.body?.innerText || '').trim().length,
      visuals: document.querySelectorAll('canvas, svg, img, video').length,
      viewportMeta: !!document.querySelector('meta[name="viewport"]'),
    }));
    if (vp.name === 'phone' && !layout.viewportMeta) {
      errors.push('missing <meta name="viewport" content="width=device-width, initial-scale=1"> (page renders zoomed-out on phones)');
    }
    if (vp.name === 'phone' && layout.scrollWidth > layout.innerWidth + 1) {
      errors.push(`horizontal overflow at phone width: content ${layout.scrollWidth}px > viewport ${layout.innerWidth}px`);
    }
    if (!layout.text && !layout.visuals) warnings.push('page looks blank (no text, canvas, svg, or image)');

    await poke(page, vp);
    await page.waitForTimeout(800);
    const after = path.join(opts.out, `${slug}-${vp.name}-2-poked.png`);
    await page.screenshot({ path: after });
    shots.push(after);
  } catch (e) {
    errors.push(`harness: ${e.message.split('\n')[0]}`);
  } finally {
    await context.close();
  }
  return { errors, warnings, shots };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  fs.mkdirSync(opts.out, { recursive: true });
  const files = opts.targets.map(resolveTarget);
  const { chromium } = loadPlaywright();
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  let failed = 0;
  try {
    for (const file of files) {
      for (const vp of VIEWPORTS) {
        const r = await checkPage(browser, origin, file, vp, opts);
        const label = `${path.relative(ROOT, file)} [${vp.name}]`;
        console.log(`${r.errors.length ? 'FAIL' : 'ok  '} ${label}`);
        for (const e of r.errors) console.log(`       error: ${e}`);
        for (const w of r.warnings) console.log(`       warn:  ${w}`);
        for (const s of r.shots) console.log(`       shot:  ${s}`);
        if (r.errors.length) failed++;
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
