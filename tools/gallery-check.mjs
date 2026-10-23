#!/usr/bin/env node
// Regression check for missing, broken, and unloaded gallery display images.
// Checks the actual generated gallery over HTTP and file://, including lazy images
// far below the fold. No screenshot can substitute for decoding every asset.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = req('playwright')); }
catch {
  ({ chromium } = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'noop.js'))('playwright'));
}
const ideas = fs.readdirSync(path.join(ROOT, 'ideas'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && /^\d{2,}-/.test(d.name))
  .map((d) => ({ name: d.name, web: fs.existsSync(path.join(ROOT, 'ideas', d.name, 'index.html')) }));
const count = ideas.length;
const types = { '.html': 'text/html; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((request, response) => {
  let file = path.join(ROOT, decodeURIComponent(new URL(request.url, 'http://local').pathname));
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) return response.writeHead(403).end();
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  fs.readFile(file, (error, data) => {
    if (error) return response.writeHead(404).end();
    response.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }).end(data);
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch();
  for (const protocol of ['http', 'file']) {
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      const url = protocol === 'file' ? pathToFileURL(path.join(ROOT, 'index.html')).href
        : `http://127.0.0.1:${server.address().port}/index.html`;
      await page.goto(url);
      const result = await page.evaluate(async (ideas) => {
        const cards = [...document.querySelectorAll('article.slip')];
        const images = [...document.images];
        for (const image of images) image.loading = 'eager';
        const failed = [];
        await Promise.all(images.map(async (image) => {
          try { await image.decode(); }
          catch { failed.push(image.getAttribute('src')); }
          if (!image.naturalWidth || !image.naturalHeight) failed.push(image.getAttribute('src'));
        }));
        const wrongActions = [];
        for (const idea of ideas) {
          const card = cards.find((c) => c.querySelector('img')?.getAttribute('src') === `ideas/${idea.name}/preview.jpg` ||
            c.querySelector('img')?.getAttribute('src') === `ideas/${idea.name}/preview.png`);
          const primary = card?.querySelector('.actions .primary');
          const href = primary?.getAttribute('href');
          if (!primary || primary.textContent !== (idea.web ? 'Open' : 'Run in terminal') ||
            (idea.web && href !== `ideas/${idea.name}/index.html`) ||
            (card?.querySelector('a.thumb')?.getAttribute('href') !== href)) wrongActions.push(idea.name);
        }
        return { cards: cards.length, images: images.length, failed, wrongActions,
          withoutImage: cards.filter((c) => !c.querySelector('img')).map((c) => c.querySelector('h2')?.textContent),
          overflow: document.documentElement.scrollWidth > innerWidth + 1 };
      }, ideas);
      if (result.cards !== count || result.images !== count || result.failed.length || result.wrongActions.length || result.withoutImage.length || result.overflow || errors.length) {
        throw new Error(`${protocol} ${width}px: ${JSON.stringify({ expected: count, ...result, errors })}`);
      }
      console.log(`ok  gallery ${protocol} ${width}px: all ${count} previews decoded; correct launch links; no overflow`);
      await page.close();
    }
  }
} finally {
  if (browser) await browser.close();
  server.close();
}
