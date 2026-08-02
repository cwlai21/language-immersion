# Écoute — Domain Context

Tracks time spent listening to French and English content (YouTube, podcasts, streaming series, Anki reviews) across four independent trackers that all write into one shared table.

## Language

### Core concepts

**Session**:
Seconds of listening time for one language, on one day, from one type — a YouTube video, a podcast episode, a streaming episode, or Anki's per-day aggregate.
_Avoid_: entry, record

**Type**:
Which activity produced a session: `youtube`, `podcast`, `anki`, or `series`.
_Avoid_: category, kind

**Source**:
How a session was captured: `auto` (detected automatically), `manual` (user-entered), `timer` (live podcast timer), or `anki` (add-on sync).
_Avoid_: origin, method

**Content language**:
`fr` or `en` — the language of a session, either detected or manually assigned.
_Avoid_: language (bare), track language

**Rollover hour**:
The day boundary used for all daily bucketing across the whole project — 4am, matching Anki's own "next day starts at" setting, not midnight.
_Avoid_: day boundary, cutoff, midnight reset

**Tracker**:
One of the four independent subsystems that capture listening time: the Chrome extension, the Anki add-on, the Apple Podcasts tracker, and the Spotify tracker.

### Content-language assignment

**Channel allowlist**:
A YouTube channel the user has marked to always track as a specific language, overriding auto-detection for every video from that channel.
_Avoid_: pinned channel

**Pinned series**:
A streaming-site series (Gimy, Netflix, Disney+) assigned to a language — automatically, from the show's original language, or by hand in the popup when that can't be resolved. Every subsequent episode of that series then tracks under the pinned language. Distinct from a channel allowlist — different mechanism, different sites, kept as a separate term.
_Avoid_: channel allowlist (for series), series override

**Deck/show mapping**:
A rule that assigns a language to a source outside the extension itself — an Anki deck or an Apple Podcasts show — by matching its name.

### Not tracking

**Watch-todo** (trip checklist):
A curated, hand-authored listening checklist, unrelated to session tracking — its checked/unchecked state syncs across devices, but it is not itself a session and doesn't factor into any listening stats.
