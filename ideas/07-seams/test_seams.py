"""Tests for seams. Run: python3 -m unittest discover -s ideas/07-seams -v

Fixtures named real_*.txt were captured from real commands in a Linux sandbox
(df -h, free -h, lsblk, vmstat 1 2, pip list, ls -l, ps -eo ..., findmnt -l).
The others imitate a tool's exact padding rules (docker/kubectl use Go's
tabwriter with 3 spaces; ps uses procps fixed widths that overflow), because
those tools were not available to capture from.
"""

import io
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import seams  # noqa: E402

SCRIPT = os.path.join(HERE, "seams.py")


def fixture(name):
    with open(os.path.join(HERE, "fixtures", name), encoding="utf-8") as f:
        return f.read()


def cut(text, **kw):
    t = seams.parse(text, **kw)
    return t.names, t.rows


class FakeTTY(io.StringIO):
    """A text stream that claims to be a terminal."""

    encoding = "utf-8"

    def isatty(self):
        return True


class FakeStdin:
    """stdin with a .buffer, like sys.stdin, optionally pretending to be a TTY."""

    def __init__(self, data=b"", tty=False):
        self.buffer = io.BytesIO(data)
        self.tty = tty

    def isatty(self):
        return self.tty


def run_main(argv, data=b"", tty_in=False, tty_out=False, environ=None):
    out = FakeTTY() if tty_out else io.StringIO()
    err = io.StringIO()
    code = seams.main(argv, stdin=FakeStdin(data, tty_in), stdout=out, stderr=err,
                      environ=environ if environ is not None else {})
    return code, out.getvalue(), err.getvalue()


# ----------------------------------------------------------------------------


class TestCells(unittest.TestCase):
    def test_char_widths(self):
        self.assertEqual(seams.char_width("a"), 1)
        self.assertEqual(seams.char_width("名"), 2)          # CJK is two cells wide
        self.assertEqual(seams.char_width("́"), 0)     # combining accent
        self.assertEqual(seams.char_width("‍"), 0)     # zero-width joiner
        self.assertEqual(seams.char_width("\x07"), 0)       # control character
        self.assertEqual(seams.char_width("é"), 1)

    def test_tokens_are_located_in_display_cells(self):
        ln = seams.scan_line("名前  x")
        self.assertEqual([(t[0], t[1]) for t in ln.tokens], [(0, 4), (6, 7)])
        self.assertEqual([ln.text[t[2]:t[3]] for t in ln.tokens], ["名前", "x"])

    def test_tabs_expand_to_tab_stops(self):
        ln = seams.scan_line("a\tb\tc")
        self.assertEqual([t[0] for t in ln.tokens], [0, 8, 16])
        ln = seams.scan_line("名\tb", tabsize=4)  # the tab stop counts display cells
        self.assertEqual([t[0] for t in ln.tokens], [0, 4])

    def test_ansi_colour_codes_are_removed(self):
        ln = seams.scan_line("\x1b[1;32mUp\x1b[0m  2")
        self.assertEqual(ln.text, "Up  2")
        self.assertEqual([t[0] for t in ln.tokens], [0, 4])

    def test_standalone_bars_are_borders_but_bars_inside_words_are_not(self):
        ln = seams.scan_line("| a|b | c │")
        self.assertEqual([ln.text[t[2]:t[3]] for t in ln.tokens], ["a|b", "c"])
        self.assertEqual(len(ln.borders), 3)

    def test_ruler_lines(self):
        for ruler in ["------- -----", "----+----", "+---+---+", "|---|:--:|", "===  ===",
                      "┡━━━╇━━━┩", "├───┼───┤"]:
            self.assertTrue(seams.is_ruler(ruler), ruler)
        for not_ruler in ["- - -", "procs ---memory---", "a | b", "", "--"]:
            self.assertFalse(seams.is_ruler(not_ruler), not_ruler)


class TestRealCaptures(unittest.TestCase):
    def test_df_h(self):
        names, rows = cut(fixture("real_df_h.txt"))
        self.assertEqual(names, ["Filesystem", "Size", "Used", "Avail", "Use%", "Mounted on"])
        self.assertEqual(rows[1], ["/dev/vda", "252G", "8.7G", "31G", "23%", "/"])
        self.assertEqual(rows[4][0], "model_tools_unavailable")
        self.assertEqual(len(rows), 7)

    def test_free_has_an_unnamed_label_column_and_empty_cells(self):
        t = seams.parse(fixture("real_free_h.txt"))
        self.assertEqual(t.names, ["col1", "total", "used", "free", "shared", "buff/cache", "available"])
        self.assertEqual(t.rows[0][0], "Mem:")
        self.assertEqual(t.rows[1], ["Swap:", "0B", "0B", "0B", "", "", ""])
        self.assertEqual(t.align[1:], ["right"] * 6)

    def test_lsblk_keeps_empty_trailing_cell(self):
        names, rows = cut(fixture("real_lsblk.txt"))
        self.assertEqual(names, ["NAME", "MAJ:MIN", "RM", "SIZE", "RO", "TYPE", "MOUNTPOINTS"])
        self.assertEqual(rows[0], ["zram0", "253:0", "0", "0B", "0", "disk", ""])
        self.assertEqual(rows[3][-1], "/opt/claude-code")

    def test_ps_eo(self):
        t = seams.parse(fixture("real_ps_eo.txt"))
        self.assertEqual(t.names, ["USER", "PID", "%CPU", "%MEM", "VSZ", "RSS", "TT", "STAT",
                                   "STARTED", "TIME", "COMMAND"])
        self.assertEqual(t.rows[0], ["root", "1", "0.2", "0.0", "25476", "6168", "?", "SLl",
                                     "17:24:24", "00:00:01", "process_api"])
        self.assertEqual(t.align[1], "right")
        self.assertEqual(t.align[0], "left")
        self.assertFalse(t.realigned)

    def test_vmstat_misaligned_header_is_matched_word_by_word(self):
        t = seams.parse(fixture("real_vmstat.txt"), skip=1)
        self.assertEqual(t.method, "order")
        self.assertEqual(t.names[:6], ["r", "b", "swpd", "free", "buff", "cache"])
        self.assertEqual(len(t.names), 18)
        self.assertEqual(t.rows[0][3:6], ["15377824", "21024", "648340"])

    def test_vmstat_banner_line_triggers_a_warning(self):
        t = seams.parse(fixture("real_vmstat.txt"))
        self.assertTrue(any("--skip 1" in w for w in t.warnings))

    def test_pip_list_uses_its_ruler(self):
        t = seams.parse(fixture("real_pip_list.txt"))
        self.assertEqual(t.method, "ruler")
        self.assertEqual(t.names, ["Package", "Version"])
        self.assertEqual(t.rows[0], ["annotated-types", "0.8.0"])
        self.assertEqual(len(t.rows), 18)  # 20 lines minus header and ruler

    def test_ls_l_without_header(self):
        names, rows = cut(fixture("real_ls_l.txt"), header=False, skip=1)
        self.assertEqual(names[0], "col1")
        self.assertEqual(len(names), 9)
        self.assertEqual(rows[2], ["lrwxrwxrwx", "1", "root", "root", "1", "Apr", "8", "2024", "X11 -> ."])

    def test_findmnt(self):
        t = seams.parse(fixture("real_findmnt.txt"))
        self.assertEqual(t.names, ["TARGET", "SOURCE", "FSTYPE"])
        self.assertEqual(t.rows[5], ["/", "/dev/vda", "ext4"])


class TestSynthetic(unittest.TestCase):
    def test_docker_ps_multi_word_names_and_cells(self):
        t = seams.parse(fixture("docker_ps.txt"))
        self.assertEqual(t.names, ["CONTAINER ID", "IMAGE", "COMMAND", "CREATED", "STATUS", "PORTS", "NAMES"])
        rec = t.records()
        self.assertEqual(rec[0]["PORTS"], "0.0.0.0:8080->80/tcp, [::]:8080->80/tcp")
        self.assertEqual(rec[2]["CREATED"], "About a minute ago")
        self.assertEqual(rec[2]["STATUS"], "Exited (0) 10 seconds ago")
        self.assertEqual(rec[2]["PORTS"], "")
        self.assertEqual(rec[2]["NAMES"], "cache")

    def test_kubectl_restarts_with_spaces(self):
        rec = seams.parse(fixture("kubectl_pods.txt")).records()
        self.assertEqual(rec[1]["RESTARTS"], "12 (2m ago)")
        self.assertEqual(rec[1]["STATUS"], "CrashLoopBackOff")
        self.assertEqual(rec[2]["AGE"], "3d4h")

    def test_wide_characters(self):
        names, rows = cut(fixture("cjk.txt"))
        self.assertEqual(names, ["名前", "年齢", "都市"])
        self.assertEqual(rows, [["山田太郎", "34", "東京"], ["李雷", "28", "北京"], ["Zoë", "41", "Zürich"]])

    def test_ps_overflow_rows_are_realigned(self):
        t = seams.parse(fixture("ps_aux_overflow.txt"))
        self.assertEqual(len(t.names), 11)
        rec = t.records()
        self.assertEqual([rec[4][k] for k in ("VSZ", "RSS", "TTY", "STAT")], ["12802724", "693112", "?", "Sl"])
        self.assertEqual([rec[6][k] for k in ("VSZ", "RSS", "TTY")], ["1203112", "182220", "?"])
        self.assertEqual(rec[3]["COMMAND"], "@dbus-daemon --system --address=systemd: --nofork")
        self.assertEqual(rec[3]["USER"], "message+")
        self.assertEqual(len(t.realigned), 2)

    def test_mounted_on_stays_one_column_when_every_mount_is_short(self):
        names, rows = cut(fixture("df_short_mounts.txt"))
        self.assertEqual(names[-1], "Mounted on")
        self.assertEqual([r[-1] for r in rows], ["/", "/dev", "/boot"])

    def test_psql_footer_is_left_out(self):
        t = seams.parse(fixture("psql.txt"))
        self.assertEqual(t.method, "pipes")
        self.assertEqual(t.names, ["id", "name", "email", "active"])
        self.assertEqual(t.rows[1], ["2", "bob", "", "f"])
        self.assertEqual(len(t.rows), 3)
        self.assertEqual(t.align[0], "right")
        self.assertIn("1 line without | borders left out (line 6)", t.notes)
        out = io.StringIO()
        seams.render_show(t, out)
        self.assertNotIn("┊", out.getvalue().split("\n\n")[0])  # the | borders are the seams

    def test_mysql_box(self):
        names, rows = cut(fixture("mysql.txt"))
        self.assertEqual(names, ["id", "name", "email"])
        self.assertEqual(rows, [["1", "alice", "alice@example.com"], ["2", "bob", "NULL"]])

    def test_unaligned_markdown(self):
        names, rows = cut(fixture("markdown.txt"))
        self.assertEqual(names, ["Name", "Lang", "Stars"])
        self.assertEqual(rows[1], ["a much longer name", "Go", "7"])

    def test_rich_unicode_box(self):
        names, rows = cut(fixture("rich_box.txt"))
        self.assertEqual(names, ["Name", "Score"])
        self.assertEqual(rows, [["Ada", "92"], ["Linus", "88"]])

    def test_seam_view_round_trips(self):
        """The seam view's own ┊ marks are borders, so its output parses back."""
        t = seams.parse(fixture("kubectl_pods.txt"))
        out = io.StringIO()
        seams.render_show(t, out)
        table_part = out.getvalue().split("\n\n")[0]
        again = seams.parse(table_part)
        self.assertEqual(again.names, t.names)
        self.assertEqual(again.rows, t.rows)


class TestLayoutRules(unittest.TestCase):
    def test_free_text_last_column_is_not_split(self):
        text = ("NAME   CMD\n"
                "a      run --fast now\n"
                "bb     go\n"
                "c      run --slow\n")
        names, rows = cut(text)
        self.assertEqual(names, ["NAME", "CMD"])
        self.assertEqual([r[1] for r in rows], ["run --fast now", "go", "run --slow"])

    def test_sparse_column(self):
        text = ("NAME  PORTS          STATE\n"
                "a                    up\n"
                "b     80/tcp, 443    up\n"
                "c                    down\n")
        rec = seams.parse(text).records()
        self.assertEqual([r["PORTS"] for r in rec], ["", "80/tcp, 443", ""])
        self.assertEqual([r["STATE"] for r in rec], ["up", "up", "down"])

    def test_multi_word_header_over_multi_word_values_is_not_cut_word_by_word(self):
        text = "FULL NAME     AGE\nalice smith   30\nbob jones     41\n"
        t = seams.parse(text)
        self.assertEqual(t.method, "gutters")
        self.assertEqual((t.names, t.rows), (["FULL NAME", "AGE"], [["alice smith", "30"], ["bob jones", "41"]]))

    def test_unaligned_space_separated_data_falls_back_to_word_order(self):
        t = seams.parse("a b c\n1 2 3\n10 20 30\n")
        self.assertEqual(t.method, "order")
        self.assertEqual((t.names, t.rows), (["a", "b", "c"], [["1", "2", "3"], ["10", "20", "30"]]))

    def test_a_lone_pipe_inside_a_cell_is_kept(self):
        self.assertEqual(cut("PID  CMD\n1    sh -c a | b\n22   echo |\n")[1], [["1", "sh -c a | b"], ["22", "echo |"]])

    def test_two_columns_separated_by_one_space(self):
        text = "%CPU %MEM\n 0.0  1.5\n12.5  0.0\n"
        self.assertEqual(cut(text), (["%CPU", "%MEM"], [["0.0", "1.5"], ["12.5", "0.0"]]))

    def test_no_header_free_text_needs_max_cols(self):
        text = ("-rw-r--r-- 1 me  12 a.txt\n"
                "-rw-r--r-- 1 me 100 my long file name.txt\n"
                "-rw-r--r-- 1 me   7 b\n")
        # Known limitation: with no header, words of a free-text column that
        # line up with nothing else look like extra columns...
        names, rows = cut(text, header=False)
        self.assertEqual(rows[1][4:], ["my long", "file", "name.txt"])
        # ...and --max-cols is the documented fix.
        names, rows = cut(text, header=False, max_cols=5)
        self.assertEqual([r[4] for r in rows], ["a.txt", "my long file name.txt", "b"])
        self.assertEqual([r[3] for r in rows], ["12", "100", "7"])

    def test_max_cols_with_header_joins_names(self):
        t = seams.parse("A  B  C\n1  2  3\n", max_cols=2)
        self.assertEqual(t.names, ["A", "B  C"])
        self.assertEqual(t.rows, [["1", "2  3"]])

    def test_duplicate_names_are_made_unique(self):
        self.assertEqual(seams.parse("A  A  A_2\n1  2  3\n").names, ["A", "A_2", "A_2_2"])

    def test_realign_unit(self):
        spans = [(-seams.BIG, 4), (5, 10), (11, seams.BIG)]
        # A row whose second word spilled 3 cells right: still one word per column.
        toks = [(0, 3, 0, 3), (8, 13, 8, 13), (14, 16, 14, 16)]
        self.assertEqual(seams.realign(toks, spans, [1, 1, 1], [0, 0, 0]), [0, 1, 2])
        # A usually-empty middle column may be skipped; a free-text column absorbs words.
        toks = [(0, 3, 0, 3), (11, 14, 11, 14), (15, 18, 15, 18)]
        self.assertEqual(seams.realign(toks, spans, [1, 0.1, 1], [0, 0, 0.9]), [0, 2, 2])
        self.assertEqual(seams.realign([], spans, [1, 1, 1], [0, 0, 0]), [])


class TestEdgeCases(unittest.TestCase):
    def test_empty_and_blank_input(self):
        for text in ["", "\n", "   \n\t\n", "\r\n"]:
            t = seams.parse(text)
            self.assertEqual((t.method, t.names, t.rows), ("empty", [], []), repr(text))

    def test_header_only(self):
        self.assertEqual(cut("NAME   AGE\n"), (["NAME", "AGE"], []))

    def test_single_column(self):
        self.assertEqual(cut("x\n1\n2\n"), (["x"], [["1"], ["2"]]))

    def test_single_row_without_header(self):
        self.assertEqual(cut("a  b  c", header=False), (["col1", "col2", "col3"], [["a", "b", "c"]]))

    def test_crlf_and_missing_final_newline(self):
        self.assertEqual(cut("A  B\r\n1  2\r\n3  4"), (["A", "B"], [["1", "2"], ["3", "4"]]))

    def test_weird_characters(self):
        text = "ICON  NAME      NOTE\n🚀    rocket    ünïcödé\n​x    zero​width  é\n-     \"q,u\"    a|b\n"
        rec = seams.parse(text).records()
        self.assertEqual(rec[0], {"ICON": "🚀", "NAME": "rocket", "NOTE": "ünïcödé"})
        self.assertEqual(rec[1]["NOTE"], "é")
        self.assertEqual(rec[2], {"ICON": "-", "NAME": '"q,u"', "NOTE": "a|b"})

    def test_huge_input_is_fast_enough(self):
        rows = [f"{'USER':<9} {'PID':>5}  {'%CPU':>4} COMMAND"]
        for i in range(30000):
            rows.append(f"{'user' + str(i % 9):<9} {i:>5}  {i % 100 / 10:4.1f} /bin/task --id {i}")
        start = time.perf_counter()
        t = seams.parse("\n".join(rows))
        elapsed = time.perf_counter() - start
        self.assertEqual(len(t.rows), 30000)
        self.assertEqual(t.rows[-1], ["user2", "29999", "9.9", "/bin/task --id 29999"])
        self.assertLess(elapsed, 10, "30k rows should parse in well under 10 s")

    def test_very_long_line(self):
        text = "A  B\n" + "x" * 200000 + "  y\n"
        self.assertEqual(seams.parse(text).rows, [["x" * 200000, "y"]])


class TestSelect(unittest.TestCase):
    names = ["USER", "PID", "Mounted on", "COMMAND"]

    def test_by_name_case_insensitive(self):
        self.assertEqual(seams.select_columns(self.names, "pid, mounted on"), [1, 2])

    def test_by_position_negative_and_range(self):
        self.assertEqual(seams.select_columns(self.names, "1,-1"), [0, 3])
        self.assertEqual(seams.select_columns(self.names, "2-4"), [1, 2, 3])
        self.assertEqual(seams.select_columns(self.names, "3-1"), [2, 1, 0])

    def test_none_means_all(self):
        self.assertEqual(seams.select_columns(self.names, None), [0, 1, 2, 3])

    def test_errors_explain_themselves(self):
        with self.assertRaisesRegex(seams.UsageError, "Did you mean 'COMMAND'"):
            seams.select_columns(self.names, "COMAND")
        with self.assertRaisesRegex(seams.UsageError, "out of range"):
            seams.select_columns(self.names, "0")
        with self.assertRaisesRegex(seams.UsageError, "out of range"):
            seams.select_columns(self.names, "-5")
        with self.assertRaisesRegex(seams.UsageError, "out of range"):
            seams.select_columns(self.names, "2-9")
        with self.assertRaisesRegex(seams.UsageError, "no columns"):
            seams.select_columns(self.names, " , ")


class TestOutput(unittest.TestCase):
    text = "NAME      NOTE          SIZE\nalpha     has, comma      12\nb|c       say \"hi\"         7\n"

    def fmt(self, f, cols=None):
        code, out, err = run_main(["-f", f] + (["-c", cols] if cols else []), self.text.encode())
        self.assertEqual((code, err), (0, ""))
        return out

    def test_csv_quotes_properly(self):
        self.assertEqual(self.fmt("csv"), 'NAME,NOTE,SIZE\nalpha,"has, comma",12\nb|c,"say ""hi""",7\n')

    def test_tsv(self):
        self.assertEqual(self.fmt("tsv", "1,3"), "NAME\tSIZE\nalpha\t12\nb|c\t7\n")

    def test_json_and_jsonl(self):
        data = json.loads(self.fmt("json"))
        self.assertEqual(data[1], {"NAME": "b|c", "NOTE": 'say "hi"', "SIZE": "7"})
        lines = self.fmt("jsonl").splitlines()
        self.assertEqual(json.loads(lines[0])["NOTE"], "has, comma")

    def test_markdown_escapes_pipes_and_right_aligns_numbers(self):
        self.assertEqual(self.fmt("md"), (
            "| NAME  | NOTE       | SIZE |\n"
            "|-------|------------|-----:|\n"
            "| alpha | has, comma |   12 |\n"
            "| b\\|c  | say \"hi\"   |    7 |\n"))

    def test_selection_order_is_kept(self):
        self.assertEqual(self.fmt("csv", "SIZE,NAME").splitlines()[0], "SIZE,NAME")


class TestCLI(unittest.TestCase):
    docker = fixture("docker_ps.txt").encode()

    def test_pipe_default_is_csv(self):
        code, out, _ = run_main([], self.docker)
        self.assertEqual(code, 0)
        self.assertTrue(out.startswith("CONTAINER ID,IMAGE,COMMAND"))

    def test_terminal_default_is_the_seam_view(self):
        code, out, _ = run_main([], self.docker, tty_out=True)
        self.assertEqual(code, 0)
        self.assertIn("┊", out)
        self.assertIn("7 columns × 3 rows", out)
        self.assertIn("\x1b[", out)  # coloured on a terminal

    def test_no_color_is_respected(self):
        _, out, _ = run_main([], self.docker, tty_out=True, environ={"NO_COLOR": "1"})
        self.assertNotIn("\x1b[", out)
        self.assertIn("┊", out)
        _, out, _ = run_main(["--color", "never"], self.docker, tty_out=True)
        self.assertNotIn("\x1b[", out)

    def test_forced_colour_in_a_pipe(self):
        _, out, _ = run_main(["-f", "show", "--color", "always"], self.docker)
        self.assertIn("\x1b[", out)
        _, out, _ = run_main(["-f", "show"], self.docker)
        self.assertNotIn("\x1b[", out)

    def test_show_dims_unselected_columns(self):
        _, out, _ = run_main(["-f", "show", "--color", "always", "-c", "NAMES"], self.docker)
        self.assertIn("\x1b[2mIMAGE", out)
        self.assertIn("\x1b[36;1mNAMES", out)

    def test_terminal_stdin_without_file_is_a_usage_error(self):
        code, out, err = run_main([], tty_in=True)
        self.assertEqual((code, out), (2, ""))
        self.assertIn("no input", err)

    def test_missing_file_directory_and_binary(self):
        code, _, err = run_main([os.path.join(HERE, "no-such-file.txt")])
        self.assertEqual(code, 1)
        self.assertIn("no such file", err)
        code, _, err = run_main([HERE])
        self.assertEqual(code, 1)
        self.assertIn("directory", err)
        code, _, err = run_main([], b"\x7fELF\x00\x00\x01binary")
        self.assertEqual(code, 1)
        self.assertIn("binary", err)

    def test_reads_a_named_file(self):
        code, out, _ = run_main([os.path.join(HERE, "fixtures", "real_df_h.txt"), "-c", "Use%,-1", "-f", "tsv"])
        self.assertEqual(code, 0)
        self.assertEqual(out.splitlines()[:2], ["Use%\tMounted on", "0%\t/dev/shm"])

    def test_utf16_with_bom(self):
        code, out, _ = run_main(["-f", "jsonl"], "NAME  N\nfoo   1\n".encode("utf-16"))
        self.assertEqual((code, out), (0, '{"NAME": "foo", "N": "1"}\n'))

    def test_unknown_column_exit_2(self):
        code, out, err = run_main(["-c", "STATS"], self.docker)
        self.assertEqual((code, out), (2, ""))
        self.assertIn("Did you mean 'STATUS'", err)

    def test_empty_input(self):
        code, out, err = run_main(["-f", "json"], b"")
        self.assertEqual((code, out), (0, "[]\n"))
        self.assertIn("empty", err)
        code, out, err = run_main(["--skip", "9"], self.docker)
        self.assertEqual((code, out), (0, ""))
        self.assertIn("skipped all 4 lines", err)

    def test_warning_goes_to_stderr_in_data_mode(self):
        code, out, err = run_main(["-f", "csv"], fixture("real_vmstat.txt").encode())
        self.assertEqual(code, 0)
        self.assertIn("--skip 1", err)

    def test_bad_arguments(self):
        with self.assertRaises(SystemExit) as cm, redirect_stderr():
            seams.main(["--skip", "-1"], stdin=FakeStdin(), stdout=io.StringIO(), stderr=io.StringIO())
        self.assertEqual(cm.exception.code, 2)


class TestAsAProcess(unittest.TestCase):
    """Run the real script, the way a user would."""

    def run_script(self, *args, data=b"", env_extra=None):
        env = dict(os.environ, **(env_extra or {}))
        return subprocess.run([sys.executable, SCRIPT, *args], input=data, capture_output=True, env=env, timeout=60)

    def test_help_and_version(self):
        r = self.run_script("--help")
        self.assertEqual(r.returncode, 0)
        self.assertIn(b"examples:", r.stdout)
        r = self.run_script("--version")
        self.assertEqual(r.stdout.strip(), f"seams {seams.__version__}".encode())

    def test_non_tty_output_is_plain_csv(self):
        r = self.run_script(data=fixture("kubectl_pods.txt").encode())
        self.assertEqual(r.returncode, 0)
        self.assertNotIn(b"\x1b", r.stdout)
        self.assertTrue(r.stdout.startswith(b"NAME,READY,STATUS,RESTARTS,AGE\n"))

    def test_closed_pipe_is_not_an_error(self):
        big = ("A  B\n" + "x  y\n" * 200000).encode()
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "big.txt")
            with open(path, "wb") as f:
                f.write(big)
            p = subprocess.Popen([sys.executable, SCRIPT, path], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            p.stdout.readline()
            p.stdout.close()  # like `| head -1`
            _, err = p.communicate(timeout=60)
        self.assertNotIn(b"Traceback", err)
        self.assertEqual(err, b"")

    @unittest.skipUnless(hasattr(os, "openpty"), "needs a pseudo-terminal")
    def test_real_terminal_gets_colour_and_seams(self):
        master, slave = os.openpty()
        try:
            with tempfile.TemporaryDirectory() as d:
                path = os.path.join(d, "t.txt")
                with open(path, "w") as f:
                    f.write(fixture("kubectl_pods.txt"))
                env = {k: v for k, v in os.environ.items() if k != "NO_COLOR"}
                env.update(TERM="xterm", COLUMNS="100", LINES="40")
                p = subprocess.Popen([sys.executable, SCRIPT, path], stdout=slave, stderr=slave, env=env)
                p.wait(timeout=60)
            os.close(slave)
            slave = None
            chunks = []
            while True:
                try:
                    chunk = os.read(master, 65536)
                except OSError:
                    break
                if not chunk:
                    break
                chunks.append(chunk)
            out = b"".join(chunks).decode("utf-8", "replace")
        finally:
            if slave is not None:
                os.close(slave)
            os.close(master)
        self.assertEqual(p.returncode, 0)
        self.assertIn("\x1b[", out)
        self.assertIn("┊", out)
        self.assertIn("5 columns × 3 rows", out)


class redirect_stderr:
    """Silence argparse's own stderr output inside a test."""

    def __enter__(self):
        self.saved = sys.stderr
        sys.stderr = io.StringIO()

    def __exit__(self, *exc):
        sys.stderr = self.saved
        return False


if __name__ == "__main__":
    unittest.main()
