## Écoute — Anki time sync

- **supabase_url / supabase_key** — the Supabase project (same as the Chrome
  extension's `config.js`).
- **deck_languages** — maps a deck-name *prefix* to a language code (`fr` or
  `en`). Subdecks are covered automatically because their full name starts
  with the parent's name (e.g. `"Français"` matches `Français::Grammaire`).
  Decks that match no prefix are ignored.
- **sync_interval_minutes** — how often to sync while Anki is open.
- **days_back** — how many recent days to recompute each sync (covers reviews
  done on AnkiMobile/AnkiWeb that arrive later via sync).
