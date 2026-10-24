#!/usr/bin/env python3
# An independent re-reduction of the raw JPL pages (the ones reduce.mjs reads), in Python and numpy,
# compared with the bundled belt-data.js. Not part of the test suite: it needs the 150 MB of raw
# pages (see reduce.mjs for the URLs) and numpy.   Usage: python3 crosscheck.py <folder with page_*.json>
import json, os, re, sys, glob
import numpy as np
raw = sys.argv[1] if len(sys.argv) > 1 else 'raw'
rows = []
for f in sorted(glob.glob(os.path.join(raw, 'page_*.json')), key=lambda p: int(re.findall(r'\d+', p)[-1])):
    rows += json.load(open(f))['data']
pdes = [r[0] for r in rows]
a = np.array([float(r[1]) for r in rows]); e = np.array([float(r[2]) for r in rows])
H = np.array([float(r[4]) if r[4] not in (None, '') else np.nan for r in rows])
cc = np.array([r[5] for r in rows], dtype=object)
num = np.array([int(p) if p.isdigit() else 0 for p in pdes])
pops = {
  'all': np.ones(len(a), bool), 'good': cc == '0', 'big': H < 15,
  'first1000': (num >= 1) & (num <= 1000), 'by1866': (num >= 1) & (num <= 91),
}
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'belt-data.js')).read()
def arr(pop, key):
    m = re.search(r'\n      ' + pop + r': \{.*?' + key + r': \[([^\]]*)\]', src, re.S)
    return np.array([float(x) for x in m.group(1).split(',')])
edges = 1.5 + np.arange(1601) / 400
def frac(R, a, e):  # time fraction within R, vectorised
    out = np.zeros_like(a)
    q, Q = a * (1 - e), a * (1 + e)
    inside = (R > q) & (R < Q) & (e > 0)
    c = np.clip((1 - R / a[inside]) / e[inside], -1, 1)
    E = np.arccos(c)
    out[inside] = (E - e[inside] * np.sin(E)) / np.pi
    out[R >= Q] = 1
    out[(e == 0) & (R >= a)] = 1
    return out
bound = (a > 0) & (e >= 0) & (e < 1)
for pop, m in pops.items():
    k = np.floor((a[m] - 1.5) * 400)
    ok = (a[m] >= 1.5) & (a[m] < 5.5)
    h = np.bincount(k[ok].astype(int), minlength=1600)
    d = arr(pop, 'counts')
    mm = m & bound
    F = np.array([frac(R, a[mm], e[mm]).sum() for R in edges])
    r = np.diff(F)
    rb = arr(pop, 'rTenths') / 10
    print(pop, 'members', int(m.sum()), 'a-counts identical:', bool(np.array_equal(h, d)), 'max |r diff|', round(float(np.max(np.abs(r - rb))), 3), 'unbound', int((m & ~bound).sum()))
