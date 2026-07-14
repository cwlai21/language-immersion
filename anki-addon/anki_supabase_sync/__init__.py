"""Écoute — Anki time sync.

Sums the review time Anki already records (revlog.time, ms per answered card)
per day and per language (decks mapped by name prefix in the add-on config),
and upserts one row per day/language into the Supabase `listening_sessions`
table used by the Écoute Chrome extension.

Runs on profile open, every N minutes, after AnkiWeb sync, and on profile
close. Network calls happen on a background thread and fail silently (the
next run retries), so Anki is never blocked.
"""

import json
import urllib.request
from datetime import datetime, timedelta

from aqt import gui_hooks, mw

_timer = None


def _config():
    return mw.addonManager.getConfig(__name__) or {}


def _log(msg):
    print(f"[anki_supabase_sync] {msg}")


# ── Supabase REST (urllib to avoid dependencies) ──────────────


def _sb_request(cfg, path, method="GET", body=None):
    url = f"{cfg['supabase_url']}/rest/v1/{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("apikey", cfg["supabase_key"])
    req.add_header("Authorization", f"Bearer {cfg['supabase_key']}")
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=15) as res:
        text = res.read().decode()
    return json.loads(text) if text else None


# ── Collecting per-day, per-language review seconds ────────────


def _language_deck_ids(col, deck_languages):
    """Map language code -> set of deck ids whose name matches a configured prefix."""
    by_lang = {}
    for deck in col.decks.all_names_and_ids():
        for prefix, lang in deck_languages.items():
            if deck.name.lower().startswith(prefix.lower()):
                by_lang.setdefault(lang, set()).add(deck.id)
                break
    return by_lang


def _rollover(col):
    """Hour at which Anki's day starts ("next day starts at", default 4am)."""
    try:
        return int(col.get_config("rollover", 4) or 4)
    except Exception:
        return 4


def _daily_totals(col, days_back):
    """Return {(date_str, lang): seconds} for the last `days_back` Anki days.

    Days are bounded by Anki's rollover hour (not midnight) so totals match
    Anki's own stats/heatmap — late-night reviews count toward the evening's day.
    """
    cfg = _config()
    by_lang = _language_deck_ids(col, cfg.get("deck_languages", {}))
    if not by_lang:
        return {}

    rollover = _rollover(col)
    now = datetime.now()
    today_start = now.replace(hour=rollover, minute=0, second=0, microsecond=0)
    if now < today_start:
        today_start -= timedelta(days=1)
    start = today_start - timedelta(days=days_back - 1)
    start_ms = int(start.timestamp() * 1000)

    # revlog.id is the review timestamp in ms; revlog.time is ms spent answering.
    # For filtered decks the card's original deck is odid.
    rows = col.db.all(
        """
        select r.id, coalesce(nullif(c.odid, 0), c.did), r.time
        from revlog r join cards c on r.cid = c.id
        where r.id >= ?
        """,
        start_ms,
    )

    totals = {}
    for review_ms, deck_id, time_ms in rows:
        day = (datetime.fromtimestamp(review_ms / 1000) - timedelta(hours=rollover)).strftime("%Y-%m-%d")
        for lang, deck_ids in by_lang.items():
            if deck_id in deck_ids:
                key = (day, lang)
                totals[key] = totals.get(key, 0) + time_ms
                break
    return {k: round(v / 1000) for k, v in totals.items() if v >= 1000}


# ── Upsert into listening_sessions ─────────────────────────────


def _push(totals):
    cfg = _config()
    for (day, lang), seconds in totals.items():
        try:
            existing = _sb_request(
                cfg,
                f"listening_sessions?date=eq.{day}&language=eq.{lang}"
                f"&source=eq.anki&select=id,seconds",
            )
            if existing:
                if existing[0]["seconds"] != seconds:
                    _sb_request(
                        cfg,
                        f"listening_sessions?id=eq.{existing[0]['id']}",
                        method="PATCH",
                        body={"seconds": seconds},
                    )
            else:
                _sb_request(
                    cfg,
                    "listening_sessions",
                    method="POST",
                    body={
                        "date": day,
                        "seconds": seconds,
                        "language": lang,
                        "type": "anki",
                        "title": "Anki reviews",
                        "source": "anki",
                    },
                )
        except Exception as e:  # offline etc. — next sync retries
            _log(f"push failed for {day}/{lang}: {e}")


def sync():
    if mw.col is None:
        return
    cfg = _config()
    if not cfg.get("supabase_url") or not cfg.get("supabase_key"):
        _log("not configured; skipping")
        return
    try:
        totals = _daily_totals(mw.col, int(cfg.get("days_back", 3)))
    except Exception as e:
        _log(f"collection query failed: {e}")
        return
    if totals:
        mw.taskman.run_in_background(lambda: _push(totals))


# ── Hooks ──────────────────────────────────────────────────────


def _on_profile_open():
    global _timer
    minutes = int(_config().get("sync_interval_minutes", 10))
    _timer = mw.progress.timer(minutes * 60 * 1000, sync, True, requiresCollection=True)
    sync()


def _on_profile_close():
    global _timer
    if _timer:
        _timer.stop()
        _timer = None
    sync()


def _on_sync_finished():
    sync()


gui_hooks.profile_did_open.append(_on_profile_open)
gui_hooks.profile_will_close.append(_on_profile_close)
gui_hooks.sync_did_finish.append(_on_sync_finished)
