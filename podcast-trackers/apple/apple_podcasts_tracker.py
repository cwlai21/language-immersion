#!/usr/bin/env python3
"""Écoute — Apple Podcasts time sync.

Reads the macOS Podcasts app's local library (which also receives play-state
synced from an iPhone via iCloud), diffs each episode's playhead against the
previous run, and logs listening deltas to Supabase per show language.

Runs from launchd every 5 minutes (com.ecoute.applepodcasts.plist).
First run only records baselines; deltas start from the second run.
"""

import json
import re
import sqlite3
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

CONFIG_PATH = Path(__file__).with_name("config.json")
STATE_DIR = Path.home() / "Library/Application Support/ecoute"
STATE_PATH = STATE_DIR / "apple_podcasts_state.json"
DB_PATH = (Path.home() / "Library/Group Containers/243LU875E5.groups.com.apple.podcasts"
           / "Documents/MTLibrary.sqlite")

COREDATA_EPOCH = 978307200  # Core Data timestamps count from 2001-01-01
ROLLOVER_HOUR = 4           # tracker day starts at 4am, like Anki
LOOKBACK_DAYS = 3
MIN_SECONDS = 30
MAX_STATE_EPISODES = 1000


def log(msg):
    print(f"[{datetime.now():%Y-%m-%d %H:%M:%S}] {msg}")


def load_config():
    with open(CONFIG_PATH) as f:
        return json.load(f)


def sb_insert(cfg, row):
    req = urllib.request.Request(
        f"{cfg['supabase_url']}/rest/v1/listening_sessions",
        data=json.dumps(row).encode(),
        method="POST",
    )
    req.add_header("apikey", cfg["supabase_key"])
    req.add_header("Authorization", f"Bearer {cfg['supabase_key']}")
    req.add_header("Content-Type", "application/json")
    urllib.request.urlopen(req, timeout=15).read()


def show_language(cfg, show_title):
    """Prefix match against config, like the Anki deck mapping."""
    if not show_title:
        return None
    lower = show_title.lower()
    for prefix, lang in cfg.get("show_languages", {}).items():
        if lower.startswith(prefix.lower()):
            return lang
    return None


def feed_language(state, show_title, feed_url):
    """Auto-detect a show's language from its RSS feed's <language> tag.
    Result is cached in the state file; config mappings take precedence.
    Returns 'fr'/'en', or None for other languages ('skip' cached)."""
    shows = state.setdefault("shows", {})
    if show_title in shows:
        cached = shows[show_title]
        return cached if cached in ("fr", "en") else None
    if not feed_url:
        return None
    try:
        req = urllib.request.Request(feed_url, headers={"User-Agent": "Mozilla/5.0"})
        xml = urllib.request.urlopen(req, timeout=15).read(200000).decode("utf-8", "ignore")
        m = re.search(r"<language>\s*([A-Za-z-]+)\s*</language>", xml)
        code = (m.group(1).lower()[:2] if m else "")
        lang = code if code in ("fr", "en") else "skip"
        shows[show_title] = lang
        log(f"feed language for “{show_title}”: {m.group(1) if m else 'none'} → {lang}")
        return lang if lang in ("fr", "en") else None
    except Exception as e:
        log(f"feed check failed for “{show_title}” (will retry): {e}")
        return None  # not cached — retried next run


def logical_date(unix_ts):
    return (datetime.fromtimestamp(unix_ts) - timedelta(hours=ROLLOVER_HOUR)).strftime("%Y-%m-%d")


def recent_episodes():
    """Episodes whose play state changed within the lookback window."""
    since_cd = time.time() - LOOKBACK_DAYS * 86400 - COREDATA_EPOCH
    con = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    rows = con.execute(
        """
        select e.ZUUID, e.ZPLAYHEAD, e.ZDURATION,
               coalesce(e.ZLASTDATEPLAYED, e.ZPLAYSTATELASTMODIFIEDDATE) + ?,
               e.ZTITLE, p.ZTITLE, coalesce(p.ZUPDATEDFEEDURL, p.ZFEEDURL),
               e.ZPLAYSTATE
        from ZMTEPISODE e join ZMTPODCAST p on e.ZPODCAST = p.Z_PK
        where e.ZLASTDATEPLAYED > ? or e.ZPLAYSTATELASTMODIFIEDDATE > ?
        """,
        (COREDATA_EPOCH, since_cd, since_cd),
    ).fetchall()
    con.close()
    return rows


def ensure_podcasts_running():
    """iCloud play-state sync only happens while Podcasts.app runs — launch it
    hidden in the background so iPhone listening keeps flowing into the local
    library. Freshly launched, its sync lands within a couple of minutes, so
    the *next* tracker run picks the new data up."""
    if subprocess.run(["pgrep", "-x", "Podcasts"], capture_output=True).returncode != 0:
        subprocess.run(["open", "-g", "-j", "-a", "Podcasts"])
        log("Podcasts.app was not running — launched it hidden for iCloud sync")


def main():
    ensure_podcasts_running()
    cfg = load_config()
    first_run = not STATE_PATH.exists()
    state = {"episodes": {}, "last_run": 0}
    if not first_run:
        with open(STATE_PATH) as f:
            state = json.load(f)

    now = time.time()
    elapsed = max(60.0, min(now - state.get("last_run", now), LOOKBACK_DAYS * 86400))
    episodes = state["episodes"]
    seen = set()
    inserted = 0

    PLAYSTATE_PLAYED = 2  # Apple resets ZPLAYHEAD to 0 when an episode completes

    # episodes[uuid] is {"pos": <baseline playhead>, "since": <unix ts the
    # current backlog started, or None if fully caught up>} — old state
    # files store a bare number instead of a dict, so read leniently.
    def entry_pos(entry):
        return entry["pos"] if isinstance(entry, dict) else (entry or 0)

    def entry_since(entry):
        return entry.get("since") if isinstance(entry, dict) else None

    for uuid, playhead, duration, played_ts, ep_title, show_title, feed_url, playstate in recent_episodes():
        seen.add(uuid)
        playhead = playhead or 0

        if first_run:
            episodes[uuid] = {"pos": playhead, "since": None}
            continue

        entry = episodes.get(uuid, 0)
        base = entry_pos(entry)
        catchup_since = entry_since(entry)
        delta = playhead - base
        if delta <= 0:
            # Finished episodes reset to playhead 0 with state "played" —
            # credit the final unlogged stretch instead of dropping it.
            if (playhead < 60 and base > 60 and playstate == PLAYSTATE_PLAYED
                    and duration and duration > base):
                if duration - base < MIN_SECONDS:
                    episodes[uuid] = {"pos": playhead, "since": None}
                    continue
                delta = duration - base
                base = duration - delta  # keep the arithmetic below consistent
            elif playhead == 0 and playstate != PLAYSTATE_PLAYED and base > 60:
                # Zero-reset without a 'played' mark: iCloud sync artifacts do
                # this transiently. Keep the old baseline so the true position,
                # when it syncs, doesn't get double-counted.
                continue
            else:
                episodes[uuid] = {"pos": playhead, "since": None}  # rewind/restart — re-baseline
                continue

        lang = show_language(cfg, show_title) or feed_language(state, show_title, feed_url)
        if lang is None:  # non-fr/en show (e.g. Chinese) — skip but re-baseline
            episodes[uuid] = {"pos": playhead, "since": None}
            continue

        # Sanity-cap how much of a jump counts as real listening (protects
        # against sync artifacts) — but a Mac that only wakes in short bursts
        # (brief window, then asleep again) ticks with a tiny `elapsed` every
        # time, which used to reset this cap to a few minutes on every single
        # run and forced a large legitimate backlog (a long phone-only
        # listening stretch that synced in one lump) to trickle out in
        # MIN_SECONDS-sized slivers over a dozen+ wake cycles. Instead, once
        # a backlog is detected, its clock keeps running (backdated to
        # roughly when it first appeared) across runs instead of resetting,
        # so the allowance grows the longer it stays uncredited and drains
        # in a handful of runs rather than a couple dozen.
        budget_elapsed = (now - catchup_since) if catchup_since else elapsed
        capped = min(delta, budget_elapsed * 2, duration or delta)
        if capped < MIN_SECONDS:
            continue  # leave baseline (and backlog clock) in place for next run

        row = {
            "date": logical_date(played_ts or now),
            "seconds": int(capped),
            "language": lang,
            "type": "podcast",
            "title": ep_title or "",
            "channel": show_title or "",
            "source": "apple",
        }
        try:
            sb_insert(cfg, row)
            # Advance only by what was logged: if the sanity cap clipped a
            # lump of late-synced listening, the rest is logged next run —
            # keep its backlog clock alive (or start one, backdated by this
            # run's elapsed) so the next run's cap picks up where this left
            # off instead of shrinking back to a single tick's allowance.
            still_behind = capped < delta
            episodes[uuid] = {
                "pos": base + capped,
                "since": (catchup_since or (now - elapsed)) if still_behind else None,
            }
            inserted += 1
            log(f"logged {int(capped)}s [{lang}] {show_title} — {ep_title}")
        except Exception as e:
            log(f"insert failed (will retry next run): {e}")

    # Prune stale episodes so the state file stays small.
    if len(episodes) > MAX_STATE_EPISODES:
        for key in [k for k in episodes if k not in seen][: len(episodes) - MAX_STATE_EPISODES]:
            del episodes[key]

    state["last_run"] = now
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    with open(STATE_PATH, "w") as f:
        json.dump(state, f)

    log("baselines recorded (first run)" if first_run else f"done — {inserted} row(s) inserted")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log(f"fatal: {e}")
        sys.exit(1)
