#!/usr/bin/env python3
"""seams: find the invisible column lines in aligned text and cut it into data.

Command-line tools print tables for human eyes: ps, df, docker, kubectl,
pip list, lsblk, psql. seams finds the vertical strips of blank space (or the
| borders) that separate their columns and turns the text into CSV, TSV,
JSON, JSON Lines or Markdown. On a terminal it draws the seams it found over
your text instead, so you can see exactly how it read the table.

    ps aux | python3 seams.py -f json
    df -h  | python3 seams.py -c 'Mounted on,Use%'

Python 3 standard library only. It reads one file or stdin and writes only to
stdout and stderr.
"""

from __future__ import annotations

import argparse
import bisect
import csv
import difflib
import functools
import itertools
import json
import os
import re
import shutil
import sys
import unicodedata

__version__ = "1.0.0"

BIG = 1 << 40  # stands in for "infinitely far left/right" at the open ends of a table
SPILL_TOLERANCE = 0.1  # share of rows that may spill across a gap between two header words
W_SKIP = 6.0  # cost of leaving a usually-filled column empty when realigning a row
W_JOIN = 6.0  # cost of putting a second word into a usually-one-word column

_ANSI = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]")
_CTRL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")
_WORD = re.compile(r"[^ ]+")
_SPAN = re.Match.span
_RULER_RUN = re.compile(r"[-=─━═┄┅┈┉╌╍]{3,}")
_RULER_SEG = re.compile(r"[-=─━═┄┅┈┉╌╍:]+")
_RULER_CHARS = frozenset("-=:+| ") | frozenset(map(chr, range(0x2500, 0x2580)))  # + box drawing
_BANNER = re.compile(r"-{3,}[^\W\d_]|[^\W\d_]-{3,}")
_BORDER_CHARS = frozenset("|│┃║¦╎╏┆┇┊┋")


class UsageError(Exception):
    """The command line asked for something impossible (exit status 2)."""


class InputError(Exception):
    """The input could not be read as text (exit status 1)."""


# ----------------------------------------------------------------------------
# Reading lines into display cells
# ----------------------------------------------------------------------------


@functools.lru_cache(maxsize=8192)
def char_width(ch: str) -> int:
    """How many terminal cells a character occupies (0, 1 or 2)."""
    o = ord(ch)
    if 0x20 <= o < 0x7F:
        return 1
    if o < 0x20 or 0x7F <= o < 0xA0:
        return 0
    if unicodedata.category(ch) in ("Mn", "Me", "Cf") or 0x1160 <= o <= 0x11FF:
        return 0
    return 2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1


def text_width(s: str) -> int:
    return len(s) if s.isascii() else sum(char_width(c) for c in s)


class Line:
    """One input line, cleaned, with its words located in display cells.

    tokens and borders are tuples (start_cell, end_cell, start_char, end_char).
    Borders are standalone | or │ characters; tokens are every other word.
    """

    __slots__ = ("num", "text", "tokens", "borders", "width", "kind")

    def __init__(self, num, text, tokens, borders):
        self.num = num
        self.text = text
        self.tokens = tokens
        self.borders = borders
        last = max(tokens[-1][1] if tokens else 0, borders[-1][1] if borders else 0)
        self.width = last
        self.kind = "row"  # header | row | ruler | blank | skipped | ignored


def split_lines(text: str) -> list[str]:
    if not text:
        return []
    lines = text.split("\n")
    if lines[-1] == "":
        lines.pop()
    return [ln[:-1] if ln.endswith("\r") else ln for ln in lines]


def scan_line(raw: str, num: int = 1, tabsize: int = 8) -> Line:
    text = _ANSI.sub("", raw) if "\x1b" in raw else raw
    if text.isascii() and not _CTRL.search(text):
        if "\t" in text:
            text = text.expandtabs(tabsize)
        spans = [(a, b, a, b) for a, b in map(_SPAN, _WORD.finditer(text))]
        if "|" not in text:
            return Line(num, text, spans, [])
    else:
        text, spans = _scan_unicode(text, tabsize)
    tokens, borders = [], []
    for sp in spans:
        if text[sp[2]] in _BORDER_CHARS and all(c in _BORDER_CHARS for c in text[sp[2]:sp[3]]):
            borders.append(sp)
        else:
            tokens.append(sp)
    return Line(num, text, tokens, borders)


def _scan_unicode(text: str, tabsize: int):
    out, cells, col = [], [], 0
    for ch in text:
        if ch == "\t":
            n = tabsize - col % tabsize
            out.extend(" " * n)
            cells.extend(range(col, col + n))
            col += n
            continue
        out.append(ch)
        cells.append(col)
        col += char_width(ch)
    text = "".join(out)
    spans, i, n = [], 0, len(text)
    while i < n:
        if text[i].isspace():
            i += 1
            continue
        j = i + 1
        while j < n and not text[j].isspace():
            j += 1
        start, end = cells[i], (cells[j] if j < n else col)
        if end > start:  # a run of zero-width characters occupies no cells
            spans.append((start, end, i, j))
        i = j
    return text, spans


def char_cells(text: str) -> list[int]:
    """Display cell where each character of an (already tab-expanded) line starts."""
    if text.isascii():
        return list(range(len(text) + 1))
    cells, col = [], 0
    for ch in text:
        cells.append(col)
        col += char_width(ch)
    cells.append(col)
    return cells


def is_ruler(text: str) -> bool:
    s = text.strip()
    return bool(s) and set(s) <= _RULER_CHARS and _RULER_RUN.search(s) is not None


# ----------------------------------------------------------------------------
# The table model
# ----------------------------------------------------------------------------


class Table:
    """What seams made of the text. names/rows are the data; the rest explains it."""

    def __init__(self, lines):
        self.lines = lines  # every input line, each with .kind set
        self.names: list[str] = []
        self.rows: list[list[str]] = []
        self.align: list[str] = []  # "left" or "right" per column
        self.method = "empty"  # gutters | ruler | order | pipes | empty
        self.notes: list[str] = []
        self.warnings: list[str] = []  # signs the cut is probably wrong (also sent to stderr)
        self.seams: list[int] = []  # display cells where a seam is drawn
        self.assign: dict[int, list[int]] = {}  # line number -> column of each token
        self.realigned: set[int] = set()  # line numbers that needed the realigner

    def records(self) -> list[dict]:
        return [dict(zip(self.names, row)) for row in self.rows]


def parse(text: str, *, header: bool = True, skip: int = 0, max_cols: int | None = None,
          tabsize: int = 8, tolerance: float = SPILL_TOLERANCE) -> Table:
    """Cut aligned text into a Table. This is the whole algorithm; see the README."""
    lines = [scan_line(raw, i + 1, tabsize) for i, raw in enumerate(split_lines(text))]
    table = Table(lines)
    content, rulers = [], []
    for i, ln in enumerate(lines):
        if i < skip:
            ln.kind = "skipped"
        elif not ln.tokens and not ln.borders:
            ln.kind = "blank"
        elif is_ruler(ln.text):
            ln.kind = "ruler"
            rulers.append(ln)
        elif not ln.tokens:
            ln.kind = "blank"  # a row made only of borders: an empty spacer row
        else:
            content.append(ln)
    if not content:
        return table
    head = content[0] if header else None
    body = content[1:] if header else content
    if head is not None:
        head.kind = "header"
        if any(_BANNER.search(head.text, t[2], t[3]) for t in head.tokens):
            table.warnings.append(f"line {head.num} looks like a banner above the real header "
                                  f"(like vmstat's ---memory---); if so, add --skip {head.num}")

    k = len(content[0].borders)
    if k and 3 * sum(len(ln.borders) == k for ln in content) >= 2 * len(content):
        _cut_on_pipes(table, head, body, max_cols)
    else:
        _cut_on_spaces(table, head, body, rulers, max_cols, tolerance)
    table.names = unique_names(table.names)
    return table


# ----------------------------------------------------------------------------
# Whitespace tables: find the gutters
# ----------------------------------------------------------------------------


def _coverage(lines, width):
    """cov[x] = how many of these lines have a word covering display cell x."""
    diff = [0] * (width + 1)
    for ln in lines:
        for s, e, _, _ in ln.tokens:
            diff[s] += 1
            diff[e] -= 1
    return list(itertools.accumulate(diff))[:width]


def _runs(is_gap):
    """Maximal runs of non-gap cells, as (start, end) pairs."""
    spans, x, n = [], 0, len(is_gap)
    while x < n:
        if is_gap[x]:
            x += 1
            continue
        s = x
        while x < n and not is_gap[x]:
            x += 1
        spans.append((s, x))
    return spans


def _attach_header(spans, head, cov, nb, allow):
    """Use the header's words to fix up raw gutter blocks.

    1. A block with no header word is the continuation of the column to its
       left (free text like "2 hours ago" or a command's arguments), except at
       the far left, where it is a row-label column (free's "Mem:").
    2. Two header words in one block are two columns that a few spilling rows
       glued together when the gap between them is a valley: few rows cross
       it, and clearly more rows have data under each word. ("Mounted on" is
       not a valley: the only rows under "on" are the long ones crossing it.)
    3. A column with an empty body whose header word sits one space after its
       neighbour's is the second word of a two-word header ("Mounted on").
    """
    starts = [s for s, _ in spans]
    groups = [[] for _ in spans]
    for t in head.tokens:
        groups[bisect.bisect_right(starts, t[0]) - 1].append(t)

    cols = []
    for (s, e), g in zip(spans, groups):
        if cols and not g:
            cols[-1][1] = e
        else:
            cols.append([s, e, g])

    split = []
    for s, e, g in cols:
        cur_s, cur_g = s, g[:1]
        for prev, nxt in zip(g, g[1:]):
            lo, hi = prev[1], nxt[0]
            mid = lo + hi - 1
            p = min(range(lo, hi), key=lambda x: (cov[x], abs(2 * x - mid)))
            beside = min(max(cov[prev[0]:prev[1]]), max(cov[nxt[0]:nxt[1]]))
            if cov[p] <= allow or (2 * cov[p] < nb and beside > 2 * cov[p]):
                split.append([cur_s, p, cur_g])
                cur_s, cur_g = p + 1, [nxt]
            else:
                cur_g.append(nxt)
        split.append([cur_s, e, cur_g])

    final = []
    for s, e, g in split:
        if (final and g and final[-1][2] and g[0][0] - final[-1][2][-1][1] == 1
                and max(cov[s:e], default=0) == 0):
            final[-1][1] = e
            final[-1][2] = final[-1][2] + g
        else:
            final.append([s, e, g])
    return [(s, e) for s, e, _ in final]


def _ruler_layout(rulers, body):
    """Column spans from a ruler line such as '------- -----' if it fits the data."""
    best = max((_RULER_SEG_spans(r.text) for r in rulers), key=len, default=[])
    if len(best) < 2:
        return None
    starts = [s for s, _ in best]
    inside = total = 0
    for ln in body:
        for s, e, _, _ in ln.tokens:
            total += 1
            j = bisect.bisect_right(starts, s) - 1
            inside += j >= 0 and e <= best[j][1]
    if total and inside < 0.8 * total:
        return None
    return best


def _RULER_SEG_spans(text):
    return [(m.start(), m.end()) for m in _RULER_SEG.finditer(text)]


def _cut_on_spaces(table, head, body, rulers, max_cols, tolerance):
    rows = ([head] if head else []) + body
    for ln in rows:  # without a | layout, a lone | is just a word ("sh -c a | b")
        if ln.borders:
            ln.tokens = sorted(ln.tokens + ln.borders)
            ln.borders = []
    width = max(ln.width for ln in rows)
    nb = len(body)
    allow = int(tolerance * nb + 1e-9)

    spans = _ruler_layout(rulers, body) if rulers else None
    if spans:
        table.method = "ruler"
    else:
        table.method = "gutters"
        cov = _coverage(body, width)
        if head is None:
            spans = _runs([c == 0 for c in cov])
        elif not body:
            spans = _runs([h == 0 for h in _coverage([head], width)])
        else:
            hcov = _coverage([head], width)
            spans = _runs([c == 0 and h == 0 for c, h in zip(cov, hcov)])
            spans = _attach_header(spans, head, cov, nb, allow)
        n = len(rows[0].tokens)
        if (n >= 2 and len(spans) < n and all(len(ln.tokens) == n for ln in rows)
                and _gutters_look_wrong(spans, head, cov, nb, n)):
            _cut_in_order(table, head, body, n, max_cols)
            return

    if max_cols and len(spans) > max_cols:
        spans = spans[: max_cols - 1] + [(spans[max_cols - 1][0], spans[-1][1])]
        table.notes.append(f"everything from column {max_cols} on was kept as one column (--max-cols)")
    table.seams = [e + (s2 - e - 1) // 2 for (_, e), (s2, _) in zip(spans, spans[1:]) if s2 > e]
    spans[0] = (-BIG, spans[0][1])
    spans[-1] = (spans[-1][0], BIG)
    m = len(spans)
    starts = [s for s, _ in spans]

    def fits(ln):
        out = []
        for s, e, _, _ in ln.tokens:
            j = bisect.bisect_right(starts, s) - 1
            if e > spans[j][1]:
                return None
            out.append(j)
        return out

    filled, multi, conforming, pending = [0] * m, [0] * m, 0, []
    for ln in body:
        a = fits(ln)
        if a is None:
            pending.append(ln)
            continue
        table.assign[ln.num] = a
        conforming += 1
        prev = -1
        for j in a:  # count filled cells and cells holding more than one word
            if j != prev:
                filled[j] += 1
                prev, first = j, True
            elif first:
                multi[j] += 1
                first = False
    fill = [f / conforming for f in filled] if conforming else [0.5] * m
    many = [mu / f if f else 0.5 for mu, f in zip(multi, filled)]
    for ln in pending:
        table.assign[ln.num] = realign(ln.tokens, spans, fill, many)
        table.realigned.add(ln.num)

    if head is not None:
        a = fits(head)
        table.assign[head.num] = a if a is not None else realign(head.tokens, spans, [1.0] * m, [0.5] * m)
        table.names = [n or f"col{j + 1}" for j, n in enumerate(_cells(head, table.assign[head.num], m))]
    else:
        table.names = [f"col{j + 1}" for j in range(m)]
    table.rows = [_cells(ln, table.assign[ln.num], m) for ln in body]
    table.align = _alignment(([head] if head else []) + body, table.assign, m)


def _gutters_look_wrong(spans, head, cov, nb, n):
    """Every line has n words but the gutters found fewer columns. Trust the
    word order instead only with evidence that the gutters are wrong: there is
    no header to vouch for them, or the body on its own lines up into exactly
    n columns, or header words two or more spaces apart were glued together,
    or the gutters collapsed most of the columns. ("FULL NAME  AGE" over
    "alice smith  30" has none of these, so it stays two columns.)"""
    if head is None:
        return True
    if nb >= 2 and len(_runs([c == 0 for c in cov])) == n:
        return True
    starts = [s for s, _ in spans]
    toks = head.tokens
    for a, b in zip(toks, toks[1:]):
        same = bisect.bisect_right(starts, a[0]) == bisect.bisect_right(starts, b[0])
        if same and b[0] - a[1] >= 2:
            return True
    return 2 * len(spans) <= n


def _cut_in_order(table, head, body, n, max_cols):
    """Every line has the same number of words: the i-th word is the i-th column."""
    table.method = "order"
    table.notes.append(f"every line has {n} words but they do not line up, so word i went to column i")
    m = min(n, max_cols) if max_cols else n
    a = [min(i, m - 1) for i in range(n)]
    for ln in ([head] if head else []) + body:
        table.assign[ln.num] = a
    table.names = _cells(head, a, m) if head else [f"col{j + 1}" for j in range(m)]
    table.rows = [_cells(ln, a, m) for ln in body]
    table.align = _alignment(([head] if head else []) + body, table.assign, m)


def _cells(ln, a, m):
    first, last = [-1] * m, [-1] * m
    for idx, j in enumerate(a):
        if first[j] < 0:
            first[j] = idx
        last[j] = idx
    toks = ln.tokens
    return [ln.text[toks[first[j]][2]:toks[last[j]][3]] if first[j] >= 0 else "" for j in range(m)]


def _alignment(lines, assign, m, sample=2000):
    """A column is right-aligned when its cells (header included) agree more on
    their right edge than on their left edge."""
    lefts = [{} for _ in range(m)]
    rights = [{} for _ in range(m)]
    for ln in lines[:sample]:
        a = assign.get(ln.num)
        if a is None:
            continue
        toks = ln.tokens
        for j, grp in itertools.groupby(range(len(a)), key=a.__getitem__):
            idx = list(grp)
            left, right = toks[idx[0]][0], toks[idx[-1]][1]
            lefts[j][left] = lefts[j].get(left, 0) + 1
            rights[j][right] = rights[j].get(right, 0) + 1
    out = []
    for lf, rt in zip(lefts, rights):
        out.append("right" if rt and max(rt.values()) > max(lf.values()) else "left")
    return out


def realign(tokens, spans, fill, many, w_skip=W_SKIP, w_join=W_JOIN):
    """Assign a misaligned row's words to columns, keeping their order.

    Dynamic programming over (word, column). Costs: every display cell a word
    sticks out of its column's span, plus w_skip * fill[j] for leaving column j
    empty, plus w_join * (1 - many[j]) for each extra word put in column j.
    fill[j] and many[j] are learned from the rows that fit the layout cleanly.
    """
    n, m = len(tokens), len(spans)
    if m == 1 or n == 0:
        return [0] * n
    skip = [w_skip * f for f in fill]
    join = [w_join * (1.0 - u) for u in many]
    pre = [0.0]
    for c in skip:
        pre.append(pre[-1] + c)

    def place(t, j):
        s, e = spans[j]
        return max(0, s - t[0]) + max(0, t[1] - e)

    inf = float("inf")
    dp = [pre[j] + place(tokens[0], j) for j in range(m)]
    back = [[-1] * m]
    for i in range(1, n):
        t = tokens[i]
        new, ptr = [inf] * m, [-1] * m
        best, arg = inf, -1
        for j in range(m):
            stay = dp[j] + join[j]
            move = best + pre[j] if arg >= 0 else inf
            if stay <= move:
                new[j], ptr[j] = stay, j
            else:
                new[j], ptr[j] = move, arg
            new[j] += place(t, j)
            v = dp[j] - pre[j + 1]
            if v < best:
                best, arg = v, j
        dp = new
        back.append(ptr)
    total = [dp[j] + pre[m] - pre[j + 1] for j in range(m)]
    j = min(range(m), key=total.__getitem__)
    out = [0] * n
    for i in range(n - 1, -1, -1):
        out[i] = j
        j = back[i][j]
    return out


# ----------------------------------------------------------------------------
# Pipe-bordered tables: psql, MySQL, Markdown, box drawing
# ----------------------------------------------------------------------------


def _cut_on_pipes(table, head, body, max_cols):
    table.method = "pipes"
    lines = ([head] if head else []) + body
    k = len(lines[0].borders)
    split, ignored = {}, []
    for ln in lines:
        if not ln.borders:
            ln.kind = "ignored"
            ignored.append(str(ln.num))
            continue
        edges = [b for br in ln.borders for b in (br[2], br[3])]
        bounds = [0] + edges + [len(ln.text)]
        segs = [(bounds[i], bounds[i + 1]) for i in range(0, len(bounds), 2)]
        groups, seg_of = [[] for _ in segs], []
        si = 0
        for idx, t in enumerate(ln.tokens):
            while si < len(segs) - 1 and t[2] >= segs[si][1]:
                si += 1
            groups[si].append(idx)
            seg_of.append(si)
        split[ln.num] = (groups, seg_of)

    if ignored:
        shown = ", ".join(ignored[:6]) + (", ..." if len(ignored) > 6 else "")
        table.notes.append(f"{len(ignored)} line{'s' * (len(ignored) != 1)} without | borders "
                           f"left out (line{'s' * (len(ignored) != 1)} {shown})")
    same = [ln for ln in lines if len(ln.borders) == k]
    lead = int(all(not split[ln.num][0][0] for ln in same))
    trail = int(k + 1 - lead > 1 and all(not split[ln.num][0][-1] for ln in same))
    m = k + 1 - lead - trail
    if max_cols and m > max_cols:
        table.notes.append(f"everything from column {max_cols} on was kept as one column (--max-cols)")
        m = max_cols

    def cells_of(ln):
        groups, seg_of = split[ln.num]
        groups = groups[lead:len(groups) - trail if trail else None]
        texts = [ln.text[ln.tokens[g[0]][2]:ln.tokens[g[-1]][3]] if g else "" for g in groups]
        if len(texts) > m:
            texts = texts[: m - 1] + [" | ".join(t for t in texts[m - 1:] if t)]
        texts += [""] * (m - len(texts))
        table.assign[ln.num] = [min(max(s - lead, 0), m - 1) for s in seg_of]
        return texts

    kept = [ln for ln in body if ln.num in split]
    if head is not None and head.num in split:
        table.names = [n or f"col{j + 1}" for j, n in enumerate(cells_of(head))]
    else:
        table.names = [f"col{j + 1}" for j in range(m)]
    table.rows = [cells_of(ln) for ln in kept]
    table.align = _alignment(([head] if head is not None and head.num in split else []) + kept, table.assign, m)


# ----------------------------------------------------------------------------
# Choosing columns and writing output
# ----------------------------------------------------------------------------


def unique_names(names):
    seen, out = set(), []
    for n in names:
        name, i = n, 2
        while name in seen:
            name, i = f"{n}_{i}", i + 1
        seen.add(name)
        out.append(name)
    return out


def select_columns(names: list[str], spec: str | None) -> list[int]:
    """Turn '-c PID,COMMAND' or '-c 1,3-4,-1' into 0-based column indices."""
    if spec is None:
        return list(range(len(names)))
    by_lower = {}
    for i, n in enumerate(names):
        by_lower.setdefault(n.lower(), i)
    out = []
    for raw in spec.split(","):
        item = raw.strip()
        if not item:
            continue
        if re.fullmatch(r"-?\d+", item):
            k = int(item)
            if k == 0 or abs(k) > len(names):
                raise UsageError(f"column {k} is out of range: the table has {len(names)} column"
                                 f"{'s' if len(names) != 1 else ''} (1..{len(names)}, or -1 for the last)")
            out.append(k - 1 if k > 0 else len(names) + k)
            continue
        rng = re.fullmatch(r"(\d+)-(\d+)", item)
        if rng:
            lo, hi = int(rng.group(1)), int(rng.group(2))
            if not (1 <= lo <= len(names) and 1 <= hi <= len(names)):
                raise UsageError(f"range {item} is out of range: the table has {len(names)} columns")
            out.extend(range(lo - 1, hi) if lo <= hi else range(lo - 1, hi - 2, -1))
            continue
        if item.lower() in by_lower:
            out.append(by_lower[item.lower()])
            continue
        lowered = {n.lower(): n for n in names}
        close = [lowered[c] for c in difflib.get_close_matches(item.lower(), list(lowered), n=3, cutoff=0.5)]
        hint = f" Did you mean {' or '.join(repr(c) for c in close)}?" if close else ""
        raise UsageError(f"no column named {item!r}.{hint}\n  columns: " + ", ".join(names))
    if not out:
        raise UsageError("-c selected no columns; give names or positions, e.g. -c 1,3 or -c NAME")
    return out


def write_data(fmt, table, sel, out):
    names = [table.names[j] for j in sel]
    rows = [[row[j] for j in sel] for row in table.rows]
    if fmt == "csv":
        w = csv.writer(out, lineterminator="\n")
        w.writerow(names)
        w.writerows(rows)
    elif fmt == "tsv":
        for r in [names] + rows:
            out.write("\t".join(r) + "\n")
    elif fmt == "json":
        json.dump([dict(zip(names, r)) for r in rows], out, ensure_ascii=False, indent=2)
        out.write("\n")
    elif fmt == "jsonl":
        for r in rows:
            out.write(json.dumps(dict(zip(names, r)), ensure_ascii=False) + "\n")
    elif fmt == "md":
        align = [table.align[j] if j < len(table.align) else "left" for j in sel]
        grid = [[c.replace("|", "\\|") for c in r] for r in [names] + rows]
        widths = [max(3, *(text_width(r[j]) for r in grid)) for j in range(len(names))]

        def pad(s, w, right):
            gap = " " * (w - text_width(s))
            return gap + s if right else s + gap

        for i, r in enumerate(grid):
            out.write("| " + " | ".join(pad(c, w, a == "right" and i > 0)
                                        for c, w, a in zip(r, widths, align)) + " |\n")
            if i == 0:
                out.write("|" + "|".join(("-" * (w + 1) + ":") if a == "right" else ("-" * (w + 2))
                                         for w, a in zip(widths, align)) + "|\n")


# ----------------------------------------------------------------------------
# The seam view: your own text, with the cuts drawn on it
# ----------------------------------------------------------------------------

PALETTE = ("36", "33", "32", "35", "34", "31")  # cyan yellow green magenta blue red


class Paint:
    def __init__(self, on):
        self.on = on

    def __call__(self, text, *codes):
        if not (self.on and codes and text):
            return text
        return f"\x1b[{';'.join(codes)}m{text}\x1b[0m"


def _clip(pieces, room, ell):
    """Cut a list of (text, codes) pieces to at most `room` display cells."""
    out, used = [], 0
    total = sum(text_width(t) for t, _ in pieces)
    if total <= room:
        return pieces
    room -= 1
    for text, codes in pieces:
        w = text_width(text)
        if used + w <= room:
            out.append((text, codes))
            used += w
            continue
        keep = []
        for ch in text:
            cw = char_width(ch)
            if used + cw > room:
                break
            keep.append(ch)
            used += cw
        out.append(("".join(keep), codes))
        break
    out.append((ell, ("2",)))
    return out


def render_show(table, out, *, color=False, selected=None, width=None, fancy=True):
    paint = Paint(color)
    seam_ch, ell, dot = ("┊", "…", "·") if fancy else ("|", "~", ".")
    sel = set(selected) if selected is not None else None
    ordered = sorted(table.seams)
    base_seams = set(ordered)
    last_seam = ordered[-1] if ordered else -1

    def col_codes(j, bold=False):
        base = ("2",) if sel is not None and j not in sel else (PALETTE[j % len(PALETTE)],)
        return base + (("1",) if bold else ())

    for ln in table.lines:
        if ln.kind in ("skipped", "ruler", "ignored", "blank"):
            margin = (dot + " ") if ln.kind != "blank" else "  "
            pieces = [(ln.text.rstrip(), ("2",))]
        else:
            a = table.assign.get(ln.num, [])
            seams = set() if table.method == "pipes" else _row_seams(ln, a, ordered, base_seams)
            marks = sorted([(t[2], t[3], "tok", i) for i, t in enumerate(ln.tokens)] +
                           [(b[2], b[3], "border", -1) for b in ln.borders])
            cells = char_cells(ln.text)
            pieces, pos = [], 0
            for cs, ce, kind, i in marks:
                pieces.extend(_gap(ln.text, pos, cs, cells, seams, seam_ch))
                if kind == "border":
                    pieces.append((ln.text[cs:ce], ("2",)))
                else:
                    pieces.append((ln.text[cs:ce], col_codes(a[i] if i < len(a) else 0, ln.kind == "header")))
                pos = ce
            col = cells[pos] if pos < len(cells) else text_width(ln.text[:pos])
            for x in range(col, last_seam + 1):  # keep drawing seams through empty trailing cells
                pieces.append((seam_ch, ("2",)) if x in seams else (" ", ()))
            margin = "~ " if ln.num in table.realigned else "  "
        if width:
            pieces = _clip(pieces, max(width - 2, 8), ell)
        while pieces and not pieces[-1][0].strip():
            pieces.pop()
        if not pieces:
            margin = margin.rstrip()
        head = (paint(margin, "33", "1") if margin.startswith("~") else
                paint(margin, "2") if margin.strip() else margin)
        out.write(head + "".join(paint(t, *c) for t, c in pieces) + "\n")
    _footer(table, out, paint, selected, width, fancy)


def _row_seams(ln, a, ordered, seams):
    """The table's seams, plus one between any two neighbouring words that went
    to different columns without a seam between them (realigned rows, order mode)."""
    out = seams
    toks = ln.tokens
    for i in range(min(len(toks), len(a)) - 1):
        if a[i] != a[i + 1]:
            lo, hi = toks[i][1], toks[i + 1][0]
            k = bisect.bisect_left(ordered, lo)
            if not (k < len(ordered) and ordered[k] < hi):
                if out is seams:
                    out = set(seams)
                out.add(hi - 1)
    return out


def _gap(text, a, b, cells, seams, seam_ch):
    """The blank stretch text[a:b], with seam marks where a seam crosses it."""
    pieces, run = [], []
    for c in range(a, b):
        if text[c] == " " and cells[c] in seams:
            if run:
                pieces.append(("".join(run), ()))
                run = []
            pieces.append((seam_ch, ("2",)))
        else:
            run.append(text[c])
    if run:
        pieces.append(("".join(run), ()))
    return pieces


def _footer(table, out, paint, selected, width, fancy):
    how = {
        "gutters": "cut along whitespace gutters",
        "ruler": "cut along the ruler line",
        "order": "cut word by word",
        "pipes": "cut on | borders",
    }[table.method]
    n, r = len(table.names), len(table.rows)
    times, arrow = ("×", "→") if fancy else ("x", "->")
    out.write("\n" + paint(f"{n} column{'s' * (n != 1)} {times} {r} row{'s' * (r != 1)}", "1")
              + paint(f" · {how}" if fancy else f", {how}", "2") + "\n")
    room = (width or 100) - 2
    line, used = "  ", 0
    for j, name in enumerate(table.names):
        label = f"{j + 1} {name}"
        if used and used + len(label) + 2 > room:
            out.write(line.rstrip() + "\n")
            line, used = "  ", 0
        dim = selected is not None and j not in selected
        line += paint(f"{j + 1} ", "2") + paint(name, "2" if dim else PALETTE[j % len(PALETTE)], *(() if dim else ("1",))) + "  "
        used += text_width(label) + 2
    out.write(line.rstrip() + "\n")
    if table.realigned:
        k = len(table.realigned)
        out.write(paint("~", "33", "1") + f" {k} row{'s' * (k != 1)} spilled across a seam and "
                  f"{'were' if k != 1 else 'was'} realigned\n")
    for warning in table.warnings:
        out.write(paint(f"! {warning}", "33") + "\n")
    for note in table.notes[:5]:
        out.write(paint(f"  note: {note}", "2") + "\n")
    out.write(paint(f"  {arrow} -f csv|tsv|json|jsonl|md converts · -c NAME,… picks columns" if fancy else
                    f"  {arrow} -f csv|tsv|json|jsonl|md converts, -c NAME,... picks columns", "2") + "\n")


# ----------------------------------------------------------------------------
# Command line
# ----------------------------------------------------------------------------

EPILOG = """\
examples:
  ps aux | seams                        draw the seams it finds (on a terminal)
  ps aux | seams -f json                every process as a JSON object
  df -h  | seams -c 'Mounted on,Use%'   pick columns by header name
  docker ps | seams -c 1,-1 -f tsv      ...or by position (-1 is the last)
  pip list | seams -f md                ruler lines (---- ----) are used
  psql -c 'select ...' | seams          | borders work too
  ls -l | seams --skip 1 --no-header --max-cols 9
                                        filenames with spaces stay whole

how it works:
  A seam is a vertical strip of cells that is blank in every row. Header
  words name the columns and decide which blocks belong together; rows that
  spill across a seam are realigned by a small dynamic program.

format "auto" draws the seam view on a terminal and writes CSV into a pipe.
Colour follows --color, NO_COLOR and whether output is a terminal.
exit status: 0 ok, 1 unreadable input, 2 bad usage."""


def _nonneg(v):
    try:
        n = int(v)
    except ValueError:
        raise argparse.ArgumentTypeError(f"expected a whole number, got {v!r}")
    if n < 0:
        raise argparse.ArgumentTypeError(f"must be 0 or more, got {n}")
    return n


def _positive(v):
    n = _nonneg(v)
    if n == 0:
        raise argparse.ArgumentTypeError("must be 1 or more")
    return n


def build_parser():
    p = argparse.ArgumentParser(
        prog="seams",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        description="Find the invisible column lines in aligned text (ps, df, docker, pip list,\n"
                    "psql, ...) and cut it into CSV, TSV, JSON, JSON Lines or Markdown.",
        epilog=EPILOG,
    )
    p.add_argument("file", nargs="?", default="-", help="text file to read (default: standard input)")
    p.add_argument("-f", "--format", default="auto",
                   choices=["auto", "show", "csv", "tsv", "json", "jsonl", "md"],
                   help="output format (default: auto = show on a terminal, csv in a pipe)")
    p.add_argument("-c", "--columns", metavar="LIST",
                   help="keep only these columns, by header name or 1-based position: "
                        "'PID,COMMAND', '1,3-5', '-1'")
    p.add_argument("--no-header", action="store_true",
                   help="the first line is data, not names; columns become col1, col2, ...")
    p.add_argument("--skip", type=_nonneg, default=0, metavar="N",
                   help="ignore the first N lines (a preamble such as ls -l's 'total')")
    p.add_argument("--max-cols", type=_positive, metavar="N",
                   help="at most N columns: column N keeps the rest of each line, spaces and "
                        "all (free text such as file names)")
    p.add_argument("--tabsize", type=_positive, default=8, metavar="N",
                   help="tab stops every N cells (default: 8)")
    p.add_argument("--color", choices=["auto", "always", "never"], default="auto",
                   help="colour the seam view (default: auto)")
    p.add_argument("--version", action="version", version=f"seams {__version__}")
    return p


def read_input(path, stdin):
    if path == "-":
        if _isatty(stdin):
            raise UsageError("no input. Pipe a table in (ps aux | seams) or name a file; see --help")
        stream = getattr(stdin, "buffer", stdin)
        data, label = stream.read(), "standard input"
    else:
        label = path
        try:
            with open(path, "rb") as f:
                data = f.read()
        except FileNotFoundError:
            raise InputError(f"{path}: no such file")
        except IsADirectoryError:
            raise InputError(f"{path}: is a directory, not a file")
        except PermissionError:
            raise InputError(f"{path}: permission denied")
        except OSError as e:
            raise InputError(f"{path}: {e.strerror or e}")
    if isinstance(data, str):
        return data
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        return data.decode("utf-16", errors="replace")
    if b"\x00" in data[:8192]:
        raise InputError(f"{label}: looks like binary data, not text")
    return data.decode("utf-8-sig", errors="replace")


def _isatty(stream):
    try:
        return stream.isatty()
    except (AttributeError, ValueError):
        return False


def want_color(mode, stream, environ=os.environ):
    if mode != "auto":
        return mode == "always"
    if environ.get("NO_COLOR") or environ.get("TERM") == "dumb":
        return False
    return _isatty(stream)


def main(argv=None, stdin=None, stdout=None, stderr=None, environ=None) -> int:
    stdin = stdin if stdin is not None else sys.stdin
    stdout = stdout if stdout is not None else sys.stdout
    stderr = stderr if stderr is not None else sys.stderr
    environ = environ if environ is not None else os.environ
    args = build_parser().parse_args(argv)

    try:
        text = read_input(args.file, stdin)
    except UsageError as e:
        print(f"seams: {e}", file=stderr)
        return 2
    except InputError as e:
        print(f"seams: {e}", file=stderr)
        return 1

    table = parse(text, header=not args.no_header, skip=args.skip,
                  max_cols=args.max_cols, tabsize=args.tabsize)
    fmt = args.format
    if fmt == "auto":
        fmt = "show" if _isatty(stdout) else "csv"

    if table.method == "empty":
        n = len(table.lines)
        why = ("the input is empty" if n == 0 else
               f"--skip {args.skip} skipped all {n} line{'s' * (n != 1)}" if args.skip >= n else
               "the input has only blank or ruler lines")
        print(f"seams: no table found: {why}", file=stderr)
        if fmt == "json":
            stdout.write("[]\n")
        return 0

    try:
        sel = select_columns(table.names, args.columns)
    except UsageError as e:
        print(f"seams: {e}", file=stderr)
        return 2

    if fmt != "show":
        for warning in table.warnings:
            print(f"seams: warning: {warning}", file=stderr)
    if fmt == "show":
        enc = (getattr(stdout, "encoding", None) or "utf-8").lower().replace("-", "")
        render_show(table, stdout, color=want_color(args.color, stdout, environ),
                    selected=None if args.columns is None else sel,
                    width=shutil.get_terminal_size().columns if _isatty(stdout) else None,
                    fancy=enc.startswith("utf"))
    else:
        write_data(fmt, table, sel, stdout)
    return 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    try:
        status = main()
        sys.stdout.flush()
    except BrokenPipeError:  # e.g. `seams big.txt | head`: the reader left; leave quietly
        os.dup2(os.open(os.devnull, os.O_WRONLY), sys.stdout.fileno())
        status = 0
    except KeyboardInterrupt:
        status = 130
    sys.exit(status)
