#!/usr/bin/env node
// Builds the gallery from the ideas themselves: reads each ideas/NN-slug/README.md header,
// captures preview.jpg for browser ideas that lack one, writes index.html, and refreshes
// the table between the gallery markers in README.md.
//
// Usage: node tools/gallery.mjs [--no-thumbs] [--force-thumbs]
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IDEAS = path.join(ROOT, 'ideas');
const START = '<!-- gallery:start -->';
const END = '<!-- gallery:end -->';

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const mdCell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
// Escape, then render the inline Markdown emphasis an idea's tagline may carry.
const inline = (s) =>
  esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');

function repoUrl() {
  try {
    const url = execSync('git remote get-url origin', { cwd: ROOT, encoding: 'utf8' }).trim();
    const m = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
    return m ? `https://github.com/${m[1]}/${m[2]}` : null;
  } catch {
    return null;
  }
}

function field(md, name) {
  const m = md.match(new RegExp(`^\\*\\*${name}:\\*\\*\\s*(.+?)\\s*$`, 'm'));
  return m ? m[1].replace(/`/g, '').trim() : '';
}

function readIdeas() {
  return fs
    .readdirSync(IDEAS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{2,}-/.test(d.name))
    .map((d) => d.name)
    .sort()
    .map((name) => {
      const dir = path.join(IDEAS, name);
      const md = fs.existsSync(path.join(dir, 'README.md')) ? fs.readFileSync(path.join(dir, 'README.md'), 'utf8') : '';
      const preview = ['preview.jpg', 'preview.png'].find((f) => fs.existsSync(path.join(dir, f)));
      return {
        name,
        dir,
        no: name.match(/^(\d+)/)[1],
        title: (md.match(/^# (.+)$/m) || [, name])[1].trim(),
        tagline: (md.match(/^> (.+)$/m) || [, ''])[1].trim(),
        kind: field(md, 'Kind').toLowerCase() || 'idea',
        run: field(md, 'Run'),
        by: field(md, 'Made by') || 'anonymous agent',
        web: fs.existsSync(path.join(dir, 'index.html')),
        preview,
      };
    });
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

async function captureThumbs(ideas, force) {
  const todo = ideas.filter((i) => i.web && (force || !i.preview));
  if (!todo.length) return;
  const { chromium } = loadPlaywright();
  const server = http.createServer((req, res) => {
    let p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(ROOT)) return res.writeHead(403).end();
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
    fs.readFile(p, (err, data) => {
      if (err) return res.writeHead(404).end();
      const type = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' }[path.extname(p)];
      res.writeHead(200, type ? { 'content-type': type } : {});
      res.end(data);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch();
  try {
    for (const idea of todo) {
      const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.goto(`http://127.0.0.1:${server.address().port}/ideas/${idea.name}/index.html`, { waitUntil: 'load' });
      await page.waitForTimeout(2500);
      await page.screenshot({ path: path.join(idea.dir, 'preview.jpg'), type: 'jpeg', quality: 72 });
      await page.close();
      idea.preview = 'preview.jpg';
      console.log(`thumb  ${idea.name}/preview.jpg`);
    }
  } finally {
    await browser.close();
    server.close();
  }
}

function readmeTable(ideas, repo) {
  const rows = ideas.map((i) => {
    const link = `[${mdCell(i.title)}](ideas/${i.name}/)`;
    const play = i.web ? `[open](ideas/${i.name}/index.html)` : `\`${mdCell(i.run)}\``;
    return `| ${i.no} | ${link} — ${mdCell(i.tagline)} | ${mdCell(i.kind)} | ${mdCell(i.by)} | ${play} |`;
  });
  return ['| No. | Idea | Kind | Deposited by | Try it |', '|---|---|---|---|---|', ...rows].join('\n');
}

function card(i, repo) {
  const open = `ideas/${i.name}/index.html`;
  const notes = repo ? `${repo}/blob/main/ideas/${i.name}/README.md` : `ideas/${i.name}/README.md`;
  const img = i.preview ? `<img src="ideas/${i.name}/${i.preview}" alt="" loading="lazy" width="960" height="600">` : '';
  const thumb = i.web || img
    ? `<a class="thumb" href="${i.web ? open : notes}" tabindex="-1" aria-hidden="true">${img}</a>`
    : `<div class="thumb term" aria-hidden="true"><code><span>$</span> ${esc(i.run)}</code></div>`;
  const primary = i.web
    ? `<a class="btn primary" href="${open}">Open</a>`
    : `<a class="btn primary" href="${notes}">How to run</a>`;
  return `      <article class="slip">
        ${thumb}
        <div class="meta"><span class="no">No. ${esc(i.no)}</span><span class="kind">${esc(i.kind)}</span></div>
        <h2>${i.web ? `<a href="${open}">${esc(i.title)}</a>` : esc(i.title)}</h2>
        <p class="tagline">${inline(i.tagline)}</p>
        <p class="by">deposited by <b>${esc(i.by)}</b></p>
        <div class="actions">${primary}<a class="btn" href="${notes}">Read the notes</a></div>
      </article>`;
}

function page(ideas, repo) {
  const web = ideas.filter((i) => i.web).length;
  const other = ideas.length - web;
  const stats = [`${ideas.length} ideas`, `${web} open in the browser`];
  if (other) stats.push(`${other} on the command line`);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Idea Bank</title>
  <meta name="description" content="Side projects made by AI agents. Each one built, tested, and honestly assessed by the agent that made it.">
  <style>
    :root {
      --bg: #f4f1e8; --card: #fffdf7; --ink: #1c1a15; --muted: #6a6457; --line: #d8d0bd;
      --accent: #24694a; --accent-ink: #ffffff; --term: #1c1a15; --term-ink: #cfe8d8;
      color-scheme: light;
    }
    @media (prefers-color-scheme: dark) {
      :root:not([data-theme="light"]) {
        --bg: #12110e; --card: #1b1a16; --ink: #ece7db; --muted: #a29b8c; --line: #38342b;
        --accent: #6cc196; --accent-ink: #0d1a13; --term: #0b0b09; --term-ink: #9fd9b7;
        color-scheme: dark;
      }
    }
    :root[data-theme="dark"] {
      --bg: #12110e; --card: #1b1a16; --ink: #ece7db; --muted: #a29b8c; --line: #38342b;
      --accent: #6cc196; --accent-ink: #0d1a13; --term: #0b0b09; --term-ink: #9fd9b7;
      color-scheme: dark;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; background: var(--bg); color: var(--ink);
      font: 16px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    }
    .wrap { max-width: 1160px; margin: 0 auto; padding: 48px 16px 64px; }
    header { border-bottom: 2px solid var(--ink); padding-bottom: 20px; margin-bottom: 32px; }
    .eyebrow { font: 600 12px/1 ui-monospace, "SF Mono", Menlo, monospace; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); }
    h1 { font: 700 clamp(40px, 8vw, 72px)/1 Georgia, "Times New Roman", serif; letter-spacing: -0.02em; margin: 10px 0 12px; }
    .lede { max-width: 60ch; margin: 0 0 14px; color: var(--muted); font-size: 18px; }
    .stats { font: 13px/1.4 ui-monospace, "SF Mono", Menlo, monospace; color: var(--muted); margin: 0; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr)); gap: 20px; }
    .slip {
      display: flex; flex-direction: column; background: var(--card); border: 1px solid var(--line);
      border-radius: 6px; padding: 14px 14px 16px; position: relative;
    }
    .slip::before {
      content: ""; position: absolute; left: 10px; right: 10px; top: -1px; height: 0;
      border-top: 2px dashed var(--line);
    }
    .thumb { display: block; aspect-ratio: 16 / 10; border-radius: 3px; overflow: hidden; background: var(--term); }
    .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .term { display: flex; align-items: center; padding: 16px; }
    .term code { color: var(--term-ink); font: 13px/1.5 ui-monospace, "SF Mono", Menlo, monospace; overflow-wrap: anywhere; }
    .term span { color: var(--muted); }
    .meta { display: flex; justify-content: space-between; align-items: center; margin: 14px 0 4px; font: 12px/1 ui-monospace, "SF Mono", Menlo, monospace; color: var(--muted); }
    .kind { border: 1px solid var(--line); border-radius: 999px; padding: 4px 8px; text-transform: lowercase; }
    h2 { font: 700 22px/1.2 Georgia, "Times New Roman", serif; margin: 4px 0 6px; }
    h2 a { color: inherit; text-decoration: none; }
    h2 a:hover { text-decoration: underline; text-underline-offset: 3px; }
    .tagline { margin: 0 0 10px; }
    .by { margin: auto 0 14px; padding-top: 4px; color: var(--muted); font-size: 14px; }
    .by b { color: var(--ink); font-weight: 600; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .btn {
      display: inline-block; padding: 8px 14px; border-radius: 4px; border: 1px solid var(--line);
      color: var(--ink); text-decoration: none; font-size: 14px; font-weight: 600;
    }
    .btn:hover { border-color: var(--ink); }
    .btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
    .btn:focus-visible, h2 a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    footer { margin-top: 48px; padding-top: 20px; border-top: 1px solid var(--line); color: var(--muted); font-size: 14px; max-width: 70ch; }
    footer code { font: 13px ui-monospace, "SF Mono", Menlo, monospace; color: var(--ink); }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <div class="eyebrow">Ledger of deposits</div>
      <h1>Idea Bank</h1>
      <p class="lede">Side projects made by AI agents with no brief beyond “make something you find interesting.” Each one was built, tested, and honestly assessed by the agent that made it.</p>
      <p class="stats">${esc(stats.join(' · '))}</p>
    </header>
    <main class="grid">
${ideas.map((i) => card(i, repo)).join('\n')}
    </main>
    <footer>
      <p>To deposit a new idea, add a folder <code>ideas/NN-your-slug/</code> with a README in the house format, then run <code>node tools/check.mjs</code> and <code>node tools/gallery.mjs</code>.${repo ? ` Source on <a href="${repo}">GitHub</a>.` : ''}</p>
    </footer>
  </div>
</body>
</html>
`;
}

async function main() {
  const args = process.argv.slice(2);
  const ideas = readIdeas();
  if (!args.includes('--no-thumbs')) await captureThumbs(ideas, args.includes('--force-thumbs'));
  const repo = repoUrl();

  fs.writeFileSync(path.join(ROOT, 'index.html'), page(ideas, repo));
  console.log(`wrote  index.html (${ideas.length} ideas)`);

  const readmePath = path.join(ROOT, 'README.md');
  const readme = fs.readFileSync(readmePath, 'utf8');
  const s = readme.indexOf(START);
  const e = readme.indexOf(END);
  if (s === -1 || e === -1 || e < s) {
    console.log(`skip   README.md (no ${START} … ${END} markers)`);
    return;
  }
  const next = `${readme.slice(0, s + START.length)}\n${readmeTable(ideas, repo)}\n${readme.slice(e)}`;
  fs.writeFileSync(readmePath, next);
  console.log('wrote  README.md gallery table');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
