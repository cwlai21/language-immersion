"""Écoute — Spotify podcast poller (runs 24/7 on Fly.io).

Polls Spotify's currently-playing endpoint (server-side state, so it sees
playback on any device — phone, laptop, speaker). When a podcast episode in a
French or English show is playing, wall-clock listening time accumulates and
is flushed to Supabase on episode change, stop, or every FLUSH_SECONDS.

Music is ignored; only podcast episodes count. Show language comes from
Spotify's own show metadata (`languages`).

Required env (set as Fly secrets):
  SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REFRESH_TOKEN,
  SUPABASE_URL, SUPABASE_KEY
Optional env: TZ_NAME (default Asia/Taipei), POLL_SECONDS (default 30)
"""

import os
import sys
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import requests

CLIENT_ID = os.environ["SPOTIFY_CLIENT_ID"]
CLIENT_SECRET = os.environ["SPOTIFY_CLIENT_SECRET"]
REFRESH_TOKEN = os.environ["SPOTIFY_REFRESH_TOKEN"]
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]
TZ = ZoneInfo(os.environ.get("TZ_NAME", "Asia/Taipei"))
POLL_SECONDS = int(os.environ.get("POLL_SECONDS", "30"))

ROLLOVER_HOUR = 4     # tracker day starts at 4am local, like Anki
MIN_SECONDS = 30
FLUSH_SECONDS = 600   # flush a long-running episode every 10 minutes


def log(msg):
    print(f"[{datetime.now(TZ):%Y-%m-%d %H:%M:%S}] {msg}", flush=True)


def logical_date():
    return (datetime.now(TZ) - timedelta(hours=ROLLOVER_HOUR)).strftime("%Y-%m-%d")


# ── Spotify auth ───────────────────────────────────────────────

_token = {"value": None, "expires": 0}


def access_token():
    if time.time() < _token["expires"] - 60:
        return _token["value"]
    res = requests.post(
        "https://accounts.spotify.com/api/token",
        data={"grant_type": "refresh_token", "refresh_token": REFRESH_TOKEN},
        auth=(CLIENT_ID, CLIENT_SECRET),
        timeout=15,
    )
    res.raise_for_status()
    body = res.json()
    _token["value"] = body["access_token"]
    _token["expires"] = time.time() + body.get("expires_in", 3600)
    return _token["value"]


def currently_playing():
    """Returns the playing episode info or None."""
    res = requests.get(
        "https://api.spotify.com/v1/me/player/currently-playing",
        params={"additional_types": "episode"},
        headers={"Authorization": f"Bearer {access_token()}"},
        timeout=15,
    )
    if res.status_code == 204 or not res.text:
        return None
    if res.status_code == 429:
        wait = int(res.headers.get("Retry-After", "30"))
        log(f"rate limited, sleeping {wait}s")
        time.sleep(wait)
        return None
    res.raise_for_status()
    body = res.json()
    item = body.get("item")
    if not body.get("is_playing") or not item or item.get("type") != "episode":
        return None
    show = item.get("show") or {}
    langs = [l.lower() for l in show.get("languages") or []]
    lang = next((code for code in ("fr", "en")
                 for l in langs if l.startswith(code)), None)
    return {
        "id": item["id"],
        "title": item.get("name", ""),
        "show": show.get("name", ""),
        "lang": lang,
    }


# ── Supabase ───────────────────────────────────────────────────

def save_session(ep, seconds):
    requests.post(
        f"{SUPABASE_URL}/rest/v1/listening_sessions",
        json={
            "date": logical_date(),
            "seconds": int(seconds),
            "language": ep["lang"],
            "type": "podcast",
            "title": ep["title"],
            "channel": ep["show"],
            "source": "spotify",
        },
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
        },
        timeout=15,
    ).raise_for_status()


# ── Main loop ──────────────────────────────────────────────────

def main():
    log(f"started (poll every {POLL_SECONDS}s, tz {TZ})")
    current = None      # episode dict being accumulated
    accumulated = 0.0
    last_poll = time.time()

    def flush(reason):
        nonlocal accumulated
        if current and current["lang"] and accumulated >= MIN_SECONDS:
            try:
                save_session(current, accumulated)
                log(f"saved {int(accumulated)}s [{current['lang']}] "
                    f"{current['show']} — {current['title']} ({reason})")
                accumulated = 0.0
            except Exception as e:
                log(f"save failed, keeping buffer: {e}")
        elif reason == "episode change":
            accumulated = 0.0  # too short to keep — discard on switch

    while True:
        try:
            ep = currently_playing()
        except Exception as e:
            log(f"poll error: {e}")
            ep = None

        now = time.time()
        delta = min(now - last_poll, POLL_SECONDS * 2)
        last_poll = now

        if ep is None:
            flush("stopped")
            current = None
        elif current and ep["id"] == current["id"]:
            accumulated += delta
            if accumulated >= FLUSH_SECONDS:
                flush("periodic")
        else:
            flush("episode change")
            current = ep
            accumulated = 0.0
            if ep["lang"]:
                log(f"now playing [{ep['lang']}] {ep['show']} — {ep['title']}")
            else:
                log(f"now playing (untracked language) {ep['show']}")

        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
