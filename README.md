# Écoute — French & English Listening Tracker

Tracks hours spent listening to French and English YouTube videos and
podcasts, with daily / weekly / monthly dashboards.

Four trackers, one Supabase table:

- **`extension/`** — Chrome extension (the main app). Auto-detects French and
  English YouTube videos, tracks watch time in the background, and stores
  sessions in **Supabase** (project "Language Immersion").
- **`anki-addon/`** — Anki add-on that syncs daily Anki review time into the
  same Supabase table (already installed to
  `~/Library/Application Support/Anki2/addons21/anki_supabase_sync/`).
- **`podcast-trackers/apple/`** — launchd script (every 15 min) that diffs
  episode playheads in the macOS Podcasts library — which also receives
  iPhone play-state via iCloud sync — and logs listening deltas.
- **`podcast-trackers/spotify-worker/`** — always-on Cloudflare Worker (free
  plan) that watches Spotify's currently-playing state (any device) and logs
  podcast episodes.
- **`index.html` + `app.js` + `style.css`** — the original standalone web app
  (localStorage only, no extension needed). Kept as-is; the extension replaces it.

## Setup (one-time)

1. **Create the database table** — open [Supabase](https://supabase.com) →
   Language Immersion project → SQL Editor → paste and run
   [`setup.sql`](setup.sql). Safe to re-run after every update.
2. **Load the extension** — Chrome → `chrome://extensions` → enable
   *Developer mode* → *Load unpacked* → select the `extension/` folder.

## How auto-detection works

YouTube's auto-generated (ASR) caption track is always in the video's
**spoken** language, so the extension reads the player response and treats an
ASR track with language `fr` as French and `en` as English. While a detected
video plays, a badge appears on the extension icon (blue **FR** / green
**EN**) and seconds accumulate; when you pause for 3+ minutes, navigate away,
or switch videos, the session is saved to Supabase with its language
(sessions under 30 seconds are discarded; failed uploads are queued and
retried automatically).

For videos without captions (or misdetections), the popup offers:

- **Track as 🇫🇷 / Track as 🇬🇧 / Don't track** — per-video override, including
  switching the language when detection gets it wrong.
- **Always track this channel** — channel allowlist, remembered with the
  channel's language.

## Popup

Click the toolbar icon to see: tracking status of the current tab, 🇫🇷/🇬🇧
switchable today / week / month totals with per-language daily-goal progress,
and a quick manual-entry form (for podcasts listened outside the browser).

## Dashboard

*Open Dashboard* in the popup opens a full page with:

- Language filter: **All** (stacked 🇫🇷+🇬🇧 charts) / **Français** / **English**
- Stats cards: today, week, month, day streak, all-time total
- Daily (14 days) / Weekly (12 weeks) / Monthly (12 months) bar charts —
  in single-language view, bars turn green when the daily/weekly goal is met
- YouTube vs Podcast breakdown donut
- Live timer (for podcast sessions) + manual entry, both with language choice
- Separate 🇫🇷 and 🇬🇧 daily goals
- Recent sessions with delete, CSV export, EN / 繁體中文 toggle

## Anki time sync

Anki already records how long you spend answering each card (`revlog.time`,
capped at the deck's *maximum answer seconds*, default 60s). The add-on sums
that per day and per language and upserts **one row per day per language**
(`type = 'anki'`, `source = 'anki'`) — no timer needed, and reviews done on
AnkiMobile/AnkiWeb are picked up after they sync (it recomputes the last 3
days on every run).

Days follow **Anki's rollover hour** ("next day starts at", default 4am), not
midnight, so daily totals match Anki's own stats and heatmap — a 1am review
session counts toward the previous evening's day. The whole tracker uses the
same 4am boundary: YouTube sessions, popup stats, dashboard charts, streaks,
and form date defaults (`ROLLOVER_HOUR` in the extension scripts).

- Deck → language mapping lives in the add-on config (Anki → Tools → Add-ons
  → anki_supabase_sync → Config). Default: decks starting with `Français` → `fr`.
  Deck-name prefixes cover subdecks automatically.
- Syncs on Anki startup, every 10 minutes, after AnkiWeb sync, and on close.
- Deleting an Anki row in the dashboard is futile for recent days — the next
  sync recreates it. Adjust the deck mapping instead.
- Anki time appears in the dashboard as its own donut slice and 📇 sessions,
  and counts toward the per-language daily goals.

## Podcast tracking

**Apple Podcasts** (`podcast-trackers/apple/`, installed as launchd agent
`com.ecoute.applepodcasts`, logs to `~/Library/Logs/ecoute-apple-podcasts.log`):
every 15 minutes it reads the Podcasts app's local `MTLibrary.sqlite`, diffs
each episode's playhead against the previous run, and logs the delta
(`source = 'apple'`). iPhone listening is captured too once iCloud syncs play
state to the Mac. Show → language mapping lives in `apple/config.json`
(name-prefix match, like the Anki deck mapping); unmapped shows (e.g. Chinese
ones) are ignored. Deltas are capped at 2× elapsed wall time and the episode
duration; a run only advances an episode's baseline after a successful upload,
so offline runs retry naturally.

**Spotify** (`podcast-trackers/spotify-worker/`, deployed as Cloudflare Worker
`ecoute-spotify` — free plan, always-on): a cron trigger polls
`currently-playing` every 2 minutes — server-side state, so it sees playback
on **any device**. Podcast episodes only (music ignored); language comes from
Spotify's own show metadata. Each poll that catches a French/English episode
playing credits 2 minutes to that episode's row for the day
(`source = 'spotify'`). Redeploy after changes:
`cd podcast-trackers/spotify-worker && npx wrangler deploy`. Secrets live in
Cloudflare (`wrangler secret put`) and locally in `.dev.vars` (gitignored) for
`wrangler dev --test-scheduled`. The refresh token came from
`../spotify/get_refresh_token.py`; the `../spotify/` folder also holds an
unused Fly.io variant of the same poller.

Note: neither Spotify's API nor Apple's database exposes *historical*
listening durations, so tracking starts from install; Spotify's GDPR
"extended streaming history" export could backfill history later if wanted.

## Data model

```sql
listening_sessions(
  id uuid, date, seconds, language ('fr'|'en'),
  type ('youtube'|'podcast'|'anki'), title, channel, video_id,
  source ('auto'|'manual'|'timer'|'anki'), created_at
)
```

Credentials live in `extension/config.js` (anon key, same open-RLS model as
habit-tracker's `docs/config.js`). Chart.js is vendored in `extension/vendor/`
because Manifest V3 forbids loading remote scripts.
