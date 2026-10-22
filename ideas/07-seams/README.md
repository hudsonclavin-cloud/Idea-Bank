# Seams
> Find the invisible column lines in text tables (ps, df, docker, psql…) and cut them into CSV, JSON or Markdown.

**Kind:** tool
**Run:** `python3 ideas/07-seams/seams.py --help`
**Made by:** Selvage

## What it is

`seams` is a single-file command-line tool (Python 3 standard library, nothing to install). You pipe in a table that some program printed for human eyes, and it works out where the columns are. Then it either:

- **converts** the table to `csv`, `tsv`, `json`, `jsonl` or a padded Markdown table (`-f md`, with right-aligned numeric columns marked `--:`), or
- **shows its working** (the default on a terminal). It prints your own text with a `┊` drawn down every seam it found, colours each word by the column it was assigned to, marks rows it had to repair with `~`, and lists the columns it found.

You pick columns by header name (`-c 'Mounted on,Use%'`) or by position (`-c 1,3-5,-1`), instead of counting awk fields. It handles:

- whitespace-aligned output: `ps`, `df`, `free`, `lsblk`, `vmstat`, `top`, `findmnt`, `docker`, `kubectl`;
- tables with ruler lines (`pip list`'s `---- ----`);
- tables with `|` or box-drawing borders: psql, MySQL, Markdown (aligned or not), Python's rich;
- CJK and other double-width text, combining accents, ANSI colour codes, tabs, CRLF line endings and UTF-16 files.

It never writes anywhere except stdout and stderr. It is also importable as a library: `seams.parse(text).records()`.

## Why I made it

I read tables like these all the time. Every `ps`, `df` or `docker ps` I run comes back as text laid out for someone's eyes, and the reflex is `awk '{print $5}'`. That works until a header says `Mounted on`, a cell says `2 hours ago`, or a cell is simply empty. Then every field after it slides one place over, and nothing complains.

A person never makes that mistake. The columns are obvious, because the eye sees the vertical rivers of blank space running down the page. I wanted to find out how much of that "obvious" can actually be recovered from the whitespace alone, which takes more than it looks like. I also wanted a tool that is honest about where its reading fails. That's why the default view on a terminal is the evidence (the seams drawn on your own text) and not just an answer.

## How it works

1. **Cells, not characters.** Each line is cleaned: ANSI escapes are stripped and tabs are expanded to tab stops. Every word is then located in *display cells* using Unicode East Asian Width, so `山田` counts as 4 cells wide and a combining accent counts as 0. Alignment only makes sense in the cells a terminal draws, not in code points.
2. **Line kinds.** Blank lines and ruler lines (`-----`, `+---+`, `├──┼──┤`, `|:--|--:|`) are set aside. The first remaining line is the header unless you pass `--no-header`.
3. **Pick a layout**, in this order:
   - If the header contains standalone `|`/`│` borders, the table is cut on those. Lines without borders (psql's `(3 rows)`, MySQL's `2 rows in set`) are left out, with a note.
   - If a ruler line's dash segments contain at least 80% of the words, the segments are the columns.
   - Otherwise, the columns come from whitespace gutters (step 4).
4. **Gutters.** For every cell position x, count how many body rows have a word covering x, and whether the header does. A seam is a run of cells that nothing covers:

   ```
     Filesystem      Size  Used Avail Use% Mounted on
     tmpfs            16G     0   16G   0% /dev/shm
     /dev/vda        252G  8.7G   31G  23% /
     ##########      ####  #### ##### #### ##########     <- covered cells
                 ^       ^     ^     ^    ^               <- seams drawn here
   ```
   The header then fixes up the raw blocks:
   - A block with no header word is the continuation of the column to its left (`2 hours ago`, a command's arguments). At the far left it is instead an unnamed row-label column, like `free`'s `Mem:`.
   - Two header words that ended up in one block are split back into two columns when the gap between them is a **valley**: few rows cross it, and clearly more rows have data under each word. (A procps `ps` row whose 8-digit VSZ pushes RSS across the gap glues `RSS TTY` together this way.) `Mounted on` is *not* a valley, because the only rows under "on" are the long paths crossing the gap.
   - A column with an empty body whose header word sits one space after its neighbour's is the second word of a two-word name (`Mounted on` when every mount point is short).
5. **Word-order fallback.** Sometimes every line has the same number of words N but the gutters found fewer columns, *and* there's evidence the gutters are wrong. The evidence counts as present when any of these holds: there's no header; the body alone lines up into exactly N columns; header words 2+ spaces apart got glued; or most columns collapsed. In that case word *i* goes to column *i*. This is what rescues `vmstat`, whose header is printed out of line with its data.
6. **Realigning rows that spill.** Rows whose words all sit inside one column's span are taken as they are. Any other row goes through a small dynamic program over (word, column) that keeps the words in order and minimises three costs:
   - the number of cells each word sticks out of its column;
   - plus 6 × (how often this column is filled) for leaving it empty;
   - plus 6 × (how rarely this column holds several words) for each extra word put in it.

   Those fill and word-count rates are learned from the rows that fit cleanly. So a usually-full, one-word column resists being emptied or stuffed, while a free-text column absorbs words freely.

## Example

A real session, captured in a pseudo-terminal (`script`) with `NO_COLOR=1` so it pastes as plain text. With colour on, each column's words get their own colour. `df`, `free`, `vmstat`, `pip` and `git` are live output from this sandbox. `ps_aux_overflow.txt` and `psql.txt` are fixtures in this folder, written to imitate those tools' exact padding, because no `ps aux` with an overflowing VSZ or Postgres was available to capture here.

```
$ alias seams='python3 ideas/07-seams/seams.py'

$ df -h | seams
  Filesystem             ┊ Size┊ Used┊Avail┊Use%┊Mounted on
  tmpfs                  ┊  16G┊    0┊  16G┊  0%┊/dev/shm
  /dev/vda               ┊ 252G┊ 8.9G┊  30G┊ 23%┊/
  /dev/vdc               ┊ 308M┊ 277M┊  25M┊ 92%┊/opt/claude-code
  /dev/vdd               ┊  47M┊  31M┊  16M┊ 67%┊/opt/env-runner
  model_tools_unavailable┊ 4.0K┊    0┊ 4.0K┊  0%┊/mnt/sandboxing/model_tools_env/v1/python
  tmpfs                  ┊ 7.9G┊    0┊ 7.9G┊  0%┊/sys/fs/cgroup
  tmpfs                  ┊ 1.0M┊    0┊ 1.0M┊  0%┊/run/sandbox-telemetry

6 columns × 7 rows · cut along whitespace gutters
  1 Filesystem  2 Size  3 Used  4 Avail  5 Use%  6 Mounted on
  → -f csv|tsv|json|jsonl|md converts · -c NAME,… picks columns

$ df -h | seams -c 'Mounted on,Use%' -f jsonl | head -3
{"Mounted on": "/dev/shm", "Use%": "0%"}
{"Mounted on": "/", "Use%": "23%"}
{"Mounted on": "/opt/claude-code", "Use%": "92%"}

$ free -h | seams -f md
| col1  | total | used  | free | shared | buff/cache | available |
|-------|------:|------:|-----:|-------:|-----------:|----------:|
| Mem:  |  15Gi | 1.0Gi | 14Gi |   14Mi |      925Mi |      14Gi |
| Swap: |    0B |    0B |   0B |        |            |           |

$ seams ideas/07-seams/fixtures/ps_aux_overflow.txt
  USER     ┊   PID┊%CPU┊%MEM┊   VSZ┊  RSS┊TTY   ┊  STAT┊START┊  TIME┊COMMAND
  root     ┊     1┊ 0.0┊ 0.1┊169316┊13140┊?     ┊  Ss  ┊Oct21┊  0:03┊/sbin/init splash
  root     ┊     2┊ 0.0┊ 0.0┊     0┊    0┊?     ┊  S   ┊Oct21┊  0:00┊[kthreadd]
  root     ┊   412┊ 0.0┊ 0.2┊ 47252┊18876┊?     ┊  Ss  ┊Oct21┊  0:01┊/lib/systemd/systemd-journald
  message+ ┊   733┊ 0.0┊ 0.0┊  9612┊ 5512┊?     ┊  Ss  ┊Oct21┊  0:02┊@dbus-daemon --system --addres…
~ alice    ┊  2412┊ 3.1┊ 4.2┊12802724┊693112┊?  ┊  Sl  ┊09:12┊ 12:44┊/usr/lib/firefox/firefox -cont…
  alice    ┊  2533┊ 0.0┊ 0.0┊ 10072┊ 3912┊pts/0 ┊  Ss  ┊09:13┊  0:00┊-bash
~ alice    ┊  2601┊ 0.4┊ 1.1┊1203112┊182220┊?   ┊  Sl  ┊09:20┊  1:02┊/usr/bin/python3 -m http.serve…
  alice    ┊  3001┊ 0.0┊ 0.0┊ 11204┊ 3480┊pts/0 ┊  R+  ┊10:01┊  0:00┊ps aux

11 columns × 8 rows · cut along whitespace gutters
  1 USER  2 PID  3 %CPU  4 %MEM  5 VSZ  6 RSS  7 TTY  8 STAT  9 START  10 TIME  11 COMMAND
~ 2 rows spilled across a seam and were realigned
  → -f csv|tsv|json|jsonl|md converts · -c NAME,… picks columns

$ seams ideas/07-seams/fixtures/ps_aux_overflow.txt -c VSZ,RSS,TTY,COMMAND -f csv | sed -n '1p;6,8p'
VSZ,RSS,TTY,COMMAND
12802724,693112,?,/usr/lib/firefox/firefox -contentproc -childID 4
10072,3912,pts/0,-bash
1203112,182220,?,/usr/bin/python3 -m http.server 8000

$ vmstat 1 2 | seams -f csv > /dev/null
seams: warning: line 1 looks like a banner above the real header (like vmstat's ---memory---); if so, add --skip 1

$ vmstat 1 2 | seams --skip 1 -c free,us,id -f tsv
free	us	id
14711496	49	48
14932352	43	51

$ git ls-tree -l HEAD tools/ | seams --no-header -c 4,5 -f md
| col4  | col5              |
|------:|-------------------|
|  4822 | tools/check.mjs   |
| 11913 | tools/gallery.mjs |
|  8298 | tools/smoke.mjs   |

$ seams ideas/07-seams/fixtures/psql.txt -f jsonl
{"id": "1", "name": "alice", "email": "alice@example.com", "active": "t"}
{"id": "2", "name": "bob", "email": "", "active": "f"}
{"id": "10", "name": "charlie", "email": "c@example.org", "active": "t"}

$ pip list | seams -c Packge
seams: no column named 'Packge'. Did you mean 'Package'?
  columns: Package, Version
```

The long lines end in `…` because the terminal was 100 columns wide; piped output is never truncated. Exit status is 0 on success, 1 for unreadable input (missing file, directory, binary data), and 2 for bad usage (unknown column, bad flag, or a terminal on stdin with no file given).

Tests: `python3 -m unittest discover -s ideas/07-seams -v` (69 tests, about 4 s).

## Honest assessment

- **[Certain]** The 69 tests pass. They cover cell widths, rulers and borders, the layout rules, the realignment DP, column selection, every output format, the CLI's exit codes and messages, `NO_COLOR` and `--color`, a real pseudo-terminal, a closed pipe (`| head`), empty, blank, binary, missing and UTF-16 input, a 200,000-character line, and 30,000 rows.
- **[Certain]** Real captures from this sandbox parse exactly right, and the tests assert them cell by cell: `df -h`, `free -h`, `lsblk`, `ps -eo …`, `vmstat` (with `--skip 1`), `pip list`, `ls -l` (with `--skip 1 --no-header`) and `findmnt -l`.
- **[Likely]** The docker, kubectl, psql, MySQL, Markdown, rich and overflowing-`ps` fixtures follow those tools' padding rules (Go's tabwriter, procps fixed widths), but they are imitations, not captures. I did not have those tools here.
- **[Certain]** Without a header, free text with spaces in the last column can be split into extra columns. In `ls -l`, a file named `my long file name.txt` becomes three cells. Nothing in the whitespace alone tells `disk /` (two lsblk columns) apart from `file name.txt` (one name). `--max-cols N` is the explicit fix, and the seam view makes the problem visible.
- **[Certain]** A banner line above the real header (vmstat's `---memory---`) is not skipped automatically. You get a warning that names the `--skip` value to use.
- **[Likely]** The layout rules (valley split, the `Mounted on` merge, word-order fallback) are heuristics tuned on about 20 real and imitated tables. A strange table can fool them, and when that happens the result is quietly wrong, not an error. The seam view exists to make that visible. One known corner: a strictly empty column whose header sits one space after its neighbour's (`TYPE MOUNTPOINTS` when nothing is mounted) gets merged into that neighbour.
- **[Speculative]** The realigner's weights (6 and 6) work on every misaligned example I had. I don't know how far they generalise.
- **[Certain]** Every value is output as a string. `"0.0"` stays `"0.0"`, and `3.10` is never turned into `3.1`. Emoji built from several code points (skin tones, ZWJ sequences) are measured as the sum of their parts. That can make a table containing them look misaligned to seams; CJK and combining marks are handled correctly.
- **[Certain]** The whole input is read into memory. 100,000 `ps`-style rows (8.5 MB) convert to CSV in about 3.5 s here. The seam view of the same rows takes about 6 s; it is meant for screens, not bulk data.

## Where it could go next

- `--numbers`: opt-in type inference for JSON, per column, so a column is only converted when every value in it round-trips.
- Streaming: decide the layout from the first few hundred rows, then emit as rows arrive (`kubectl get -w`, `watch`-style logs).
- Several tables in one input (netstat prints two, separated by a title and a blank line) and automatic preamble skipping (`top`, `vmstat`).
- A tab-aware mode that tells true TSV apart from text that uses tabs only for alignment.
- `--names a,b,c` to name the columns of a header-less table.
