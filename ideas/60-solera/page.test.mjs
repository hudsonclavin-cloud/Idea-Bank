// Tests for the words the page writes (app.js), run in a stand-in DOM with Node built-ins only.
// Run from the repo root: node --test ideas/60-solera/page.test.mjs
//
// app.js is loaded into a vm context with just enough of a browser for it to run: elements by
// id (only the ids index.html really has), canvases that record the text drawn on them, and a
// query string. No layout, no pixels; the headless smoke test covers those.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, 'index.html'), 'utf8');
const readme = fs.readFileSync(path.join(here, 'README.md'), 'utf8');
const IDS = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const VALUES = Object.fromEntries([...html.matchAll(/<input id="([^"]+)"[^>]*?\bvalue="([^"]*)"/g)].map((m) => [m[1], m[2]]));

function canvasContext(drawn) {
  const target = {
    measureText: (t) => ({ width: String(t).length * 6 }),
    fillText: (t) => drawn.push(String(t)),
    strokeText: () => {},
  };
  return new Proxy(target, {
    get: (o, k) => (k in o ? o[k] : () => {}),
    set: (o, k, v) => ((o[k] = v), true),
  });
}

function element(id, drawn) {
  const listeners = {};
  return {
    id,
    innerHTML: '',
    textContent: '',
    value: VALUES[id] ?? '',
    min: '',
    max: '',
    style: {},
    width: 0,
    height: 0,
    clientWidth: id === 'glass' ? 64 : 358,
    clientHeight: id === 'glass' ? 108 : 300,
    attrs: {},
    listeners,
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] ?? null; },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    getContext: () => canvasContext(drawn),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 358, height: 300 }),
  };
}

/** Load the page with a query string; returns its elements and the text drawn on canvases. */
function load(search) {
  const drawn = [];
  const els = new Map();
  const get = (id) => {
    if (!IDS.has(id)) throw new Error(`app.js asks for #${id}, which index.html does not have`);
    if (!els.has(id)) els.set(id, element(id, drawn));
    return els.get(id);
  };
  const lede = element('lede', drawn);
  const media = { matches: false, addEventListener() {} };
  const store = new Map();
  const ctx = {
    URLSearchParams,
    console,
    Math,
    JSON,
    location: { search },
    document: {
      getElementById: get,
      querySelector: (sel) => (sel === '.lede' ? lede : null),
      querySelectorAll: () => [],
      documentElement: { getAttribute: () => null },
    },
    getComputedStyle: () => ({ getPropertyValue: () => '#888' }),
    matchMedia: () => media,
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) },
    requestAnimationFrame: () => 1,
    setTimeout: () => 0,
    clearTimeout: () => {},
    addEventListener: () => {},
    devicePixelRatio: 1,
  };
  ctx.window = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(here, 'solera.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(here, 'app.js'), 'utf8'), ctx);
  const ENT = { rsquo: '’', divide: '÷', minus: '−', middot: '·', ge: '≥', nbsp: ' ', thinsp: ' ', amp: '&', lt: '<', gt: '>' };
  const text = (id) => (get(id).innerHTML || get(id).textContent).replace(/<[^>]+>/g, '').replace(/&(\w+);/g, (m, k) => ENT[k] ?? m);
  const input = (id, value) => {
    get(id).value = String(value);
    for (const fn of get(id).listeners.input || []) fn({ target: get(id) });
  };
  return { get, text, drawn, lede, input };
}

test('the glass of 2026 with evaporation: the founding wine has gone, and the page says so', () => {
  const p = load('?now=2026');
  const facts = p.text('facts');
  assert.match(facts, /Average age 12 years\. Half of it went in at the top in 2015 or later\. The youngest went in in 2022/);
  assert.match(facts, /a glass has held less than one molecule since 2011, on average\. The chance that this glass holds even one: 0\.5%\. The bottom row is still chalked 1826\./);
  assert.match(facts, /Without evaporation there would be about 21,000 molecules of it in this glass, and less than one only from 2063\./);
  assert.match(facts, /Every year from 1846 to 2022 is in it, at least one molecule of each on average; the scarcest is 1846, with about 1 molecule\. Anything older has, on average, gone\./);
  assert.match(p.lede.textContent, /Each cask loses 3\.5% a year through the wood/);
  const book = p.text('book');
  assert.match(book, /2011 From now on a glass holds less than one molecule of 1826, on average\. The chalk on the bottom row still says 1826\./);
  assert.match(book, /2207 From now on a glass holds less than one molecule of 2026, on average\./);
  assert.match(p.text('g75'), /from 2010/);
});

test('the run of years is counted back from the youngest, never from 1826 when 1827 has gone', () => {
  // Without evaporation, 2060: 1827 and 1828 are below one molecule, the founding wine is not.
  let facts = load('?now=2026&evap=0&year=2060').text('facts');
  assert.doesNotMatch(facts, /Every year from 1826/);
  assert.match(facts, /Every year from 1829 to 2056 is in it/);
  assert.match(facts, /1827 and 1828 have, on average, gone, though the founding wine has not/);
  // With evaporation the same happens in 2008-2010.
  facts = load('?now=2026&year=2010').text('facts');
  assert.match(facts, /Every year from 1830 to 2006 is in it/);
  assert.match(facts, /The years 1827 to 1829 have, on average, gone, though the founding wine has not/);
  // Where the run really is unbroken, it starts at the founding.
  facts = load('?now=2026&evap=0&year=2026').text('facts');
  assert.match(facts, /Every year from 1826 to 2022 is in it/);
});

test('one molecule is one molecule', () => {
  const facts = load('?now=2026&evap=0&year=2062').text('facts');
  assert.match(facts, /there is about 1 molecule in a glass/);
  assert.doesNotMatch(facts, /\b1 molecules/);
});

test('"leaves the glass" always carries its "on average"', () => {
  const p = load('?now=2026&your=1990');
  for (const id of ['book', 'yourText', 'knobText']) assert.doesNotMatch(p.text(id), /last of \d{4}[^.]* leaves/, id);
  assert.match(p.text('yourText'), /from 2171 a glass will hold less than one molecule of it, on average/);
  assert.match(p.text('knobText'), /Since 2011 a glass has held less than one molecule of 1826, on average\./);
  assert.match(load('?now=2026&evap=0').text('knobText'), /From 2063 a glass holds less than one molecule of 1826, on average\./);
  assert.doesNotMatch(html, /the last of 1826 leaves/);
  assert.match(html, /from which year a glass holds, on average, not even one molecule of 1826/);
});

test('consistency is argued from the year-to-year change, not from the spread of ages', () => {
  const p = load('?now=2026');
  const k = p.text('knobText');
  assert.doesNotMatch(k, /the rows are what keep one year/);
  assert.match(k, /the change from one year’s glass to the next would be 1\.8 times smaller than with a single cask worked to the same average age/);
  assert.match(k, /that year depends on the evaporation: 2063 with none, 2041 at 1%, 2027 at 2%, 2016 at 3%, 2006 at 4%, 1998 at 5%\./);
  assert.match(load('?now=2026&evap=0').text('knobText'), /2\.3 times smaller/);
});

test('the casks are labelled as they stand after the scales, the glass as drawn before them', () => {
  const p = load('?now=2026');
  assert.ok(p.drawn.includes('Average ages just after this year’s scales'), 'bodega header');
  assert.ok(p.drawn.includes('avg 11 yrs'), 'the bottom row after the scales');
  assert.equal(p.get('yearSub').textContent, 'this year’s glass, drawn before the scales');
});

test('the evaporation slider rewrites the page, and 0 gives back the lossless solera', () => {
  const p = load('?now=2026');
  assert.equal(p.get('evap').value, '35');
  assert.equal(p.get('evapOut').textContent, '3.5%');
  p.input('evap', 0);
  assert.equal(p.get('evapOut').textContent, '0%');
  assert.match(p.text('facts'), /Of 1826, the wine every cask was first filled with, there are about 21,000 molecules in a glass/);
  assert.match(p.text('book'), /2063 From now on a glass holds less than one molecule of 1826, on average/);
  assert.match(p.text('fMean'), /rows ÷ draw = 4 ÷ ¼ = 16 years/);
  p.input('evap', 60);
  p.input('rows', 8);
  p.input('draw', 50);
  assert.match(p.text('fMean'), /1 ÷ 56% \+ /);
});

test('the README quotes the evaporating solera and keeps the lossless one only as a comparison', () => {
  const tagline = readme.split('\n').find((l) => l.startsWith('> '));
  assert.match(tagline, /since 2011/);
  assert.doesNotMatch(tagline, /when the last of 1826 will leave/);
  assert.match(readme, /\| 2171 \| a glass holds less than one molecule of 1990, on average \(with 1990 typed into \*Your year\*\) \|/);
  assert.match(readme, /## Revision note/);
});
