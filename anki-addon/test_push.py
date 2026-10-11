"""Sanity suite for the add-on's upload step.

Run with: python3 anki-addon/test_push.py

The add-on imports `aqt`, which only exists inside Anki, so the module is
loaded with a stub in place. That is worth the trouble for _push: it decides
whether a day's studying is recorded at all, and a day it fails to record is
gone — nothing re-reads the collection for it once the window has passed.
"""

import json
import sys
import types
import unittest
import unittest.mock
from pathlib import Path

# aqt exists only inside Anki. The add-on registers hooks at import time, so
# the stub has to accept .append on each of them.
class _Hook:
    def append(self, _fn):
        pass


_hooks = types.SimpleNamespace(
    profile_did_open=_Hook(), profile_will_close=_Hook(), sync_did_finish=_Hook(),
)
sys.modules.setdefault(
    "aqt",
    types.SimpleNamespace(gui_hooks=_hooks, mw=types.SimpleNamespace(col=None, addonManager=None)),
)
sys.path.insert(0, str(Path(__file__).parent))

from anki_supabase_sync import DAYS_BACK, _push  # noqa: E402


class FakeServer:
    """Stands in for Supabase, and remembers how it was asked."""

    def __init__(self, rows=()):
        self.rows = [dict(r) for r in rows]
        self.requests = []

    def __call__(self, cfg, path, method="GET", body=None):
        self.requests.append((method, path, body))
        if method == "GET":
            return [dict(r) for r in self.rows]
        if method == "POST":
            self.rows.append({"id": f"id{len(self.rows)}", **body})
            return [body]
        if method == "PATCH":
            row_id = path.split("id=eq.")[1]
            for row in self.rows:
                if row["id"] == row_id:
                    row.update(body)
            return None
        raise AssertionError(f"unexpected {method}")

    def stored(self, date, lang):
        for row in self.rows:
            if row["date"] == date and row["language"] == lang:
                return row["seconds"]
        return None

    def counts(self):
        return {m: sum(1 for r in self.requests if r[0] == m) for m in ("GET", "POST", "PATCH")}


CONFIG = {"supabase_url": "https://example.test", "supabase_key": "key"}


def run(totals, rows=()):
    server = FakeServer(rows)
    with unittest.mock.patch("anki_supabase_sync._config", return_value=CONFIG), \
         unittest.mock.patch("anki_supabase_sync._sb_request", server):
        _push(totals)
    return server


class TestPush(unittest.TestCase):
    def test_window_is_two_weeks(self):
        # Three days was the old value, and a day that synced in later than
        # that was never uploaded at all.
        self.assertEqual(DAYS_BACK, 14)
        config = json.loads((Path(__file__).parent / "anki_supabase_sync" / "config.json").read_text())
        self.assertEqual(config["days_back"], DAYS_BACK, "the shipped default must match the code's")

    def test_a_day_with_no_row_yet_is_created(self):
        server = run({("2026-10-08", "fr"): 1317})
        self.assertEqual(server.stored("2026-10-08", "fr"), 1317)

    def test_the_whole_window_costs_one_read(self):
        # Fourteen days, asked about once — not fourteen times, every ten
        # minutes, on two machines.
        totals = {(f"2026-10-{d:02d}", "fr"): 600 for d in range(1, 15)}
        server = run(totals)
        self.assertEqual(server.counts()["GET"], 1)
        self.assertEqual(server.counts()["POST"], 14)

    def test_the_read_covers_the_oldest_day_in_the_window(self):
        totals = {("2026-10-01", "fr"): 60, ("2026-10-14", "fr"): 60}
        server = run(totals)
        self.assertIn("date=gte.2026-10-01", server.requests[0][1])

    def test_an_unchanged_day_is_not_written_again(self):
        # The usual case by far: re-reading old days must be nearly free, or
        # widening the window would cost what it saves.
        rows = [{"id": "a", "date": "2026-10-08", "language": "fr", "seconds": 1317}]
        server = run({("2026-10-08", "fr"): 1317}, rows)
        self.assertEqual(server.counts()["PATCH"], 0)
        self.assertEqual(server.counts()["POST"], 0)

    def test_a_longer_total_raises_the_day(self):
        rows = [{"id": "a", "date": "2026-10-08", "language": "fr", "seconds": 600}]
        server = run({("2026-10-08", "fr"): 1317}, rows)
        self.assertEqual(server.stored("2026-10-08", "fr"), 1317)

    def test_a_shorter_total_never_lowers_the_day(self):
        # Two machines share the row, and while AnkiWeb sync is down each sees
        # only its own reviews. The one that studied less must not erase the
        # other's more complete count.
        rows = [{"id": "a", "date": "2026-10-08", "language": "fr", "seconds": 1317}]
        server = run({("2026-10-08", "fr"): 600}, rows)
        self.assertEqual(server.stored("2026-10-08", "fr"), 1317)
        self.assertEqual(server.counts()["PATCH"], 0)

    def test_languages_keep_their_own_row_on_the_same_day(self):
        rows = [{"id": "a", "date": "2026-10-08", "language": "fr", "seconds": 1317}]
        server = run({("2026-10-08", "en"): 400}, rows)
        self.assertEqual(server.stored("2026-10-08", "fr"), 1317)
        self.assertEqual(server.stored("2026-10-08", "en"), 400)

    def test_nothing_studied_asks_nothing(self):
        server = run({})
        self.assertEqual(server.requests, [])

    def test_a_failed_read_writes_nothing_rather_than_guessing(self):
        # Without the stored totals there is no way to tell "new day" from
        # "already recorded", and guessing wrong duplicates a day.
        def refuse(cfg, path, method="GET", body=None):
            if method == "GET":
                raise OSError("offline")
            raise AssertionError("must not write after a failed read")

        with unittest.mock.patch("anki_supabase_sync._config", return_value=CONFIG), \
             unittest.mock.patch("anki_supabase_sync._sb_request", refuse):
            _push({("2026-10-08", "fr"): 1317})  # must not raise

    def test_one_days_failure_does_not_stop_the_rest(self):
        server = FakeServer()
        real = server.__call__

        def flaky(cfg, path, method="GET", body=None):
            if method == "POST" and body["date"] == "2026-10-02":
                raise OSError("transient")
            return real(cfg, path, method, body)

        with unittest.mock.patch("anki_supabase_sync._config", return_value=CONFIG), \
             unittest.mock.patch("anki_supabase_sync._sb_request", flaky):
            _push({(f"2026-10-{d:02d}", "fr"): 600 for d in (1, 2, 3)})
        self.assertEqual(server.stored("2026-10-01", "fr"), 600)
        self.assertIsNone(server.stored("2026-10-02", "fr"))
        self.assertEqual(server.stored("2026-10-03", "fr"), 600)


if __name__ == "__main__":
    unittest.main(verbosity=2)
