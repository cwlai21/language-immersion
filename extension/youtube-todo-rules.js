// Pure planning logic for the YouTube-playlist → "À regarder" todo sync,
// shared by background.js (importScripts) and its Node test suite
// (test/youtube-todo-rules.test.js via require()). Dependency-free — no
// chrome.*, no network; the caller owns fetching, storing, and deleting.

// Decide what to do with the videos currently in the playlist. The playlist is
// an inbox, so *everything* in it gets cleared out; what differs is the state
// it arrives in:
//   - not yet imported → import it (add to the todo) AND remove it from the
//     playlist. Already watched (videoId in `trackedVideoIds`) means you've
//     played it at least once, so it lands pre-ticked — a record rather than
//     a chore.
//   - already in the todo (a previous removal didn't land) → don't re-import,
//     which would clobber its done state; just remove it from the playlist
//     again.
// `items` are { videoId, title, channel, playlistItemId, position, durationSec }
// from the YouTube API (position = index in the playlist; new saves append, so
// a higher position is more recently added). addedAt folds in the position so
// the list, sorted newest-first, shows the last-added video at the top even
// when a whole batch imports in one sync. Returns { toAdd: { [videoId]: entry },
// removeItemIds: [playlistItemId] } and never mutates its inputs.
function planYoutubeTodoSync(items, trackedVideoIds, currentTodo, lang = 'fr', now = Date.now()) {
  const toAdd = {};
  const removeItemIds = [];
  for (const it of items) {
    if (!it || !it.videoId) continue;
    if (!currentTodo[it.videoId] && !toAdd[it.videoId]) {
      toAdd[it.videoId] = {
        videoId: it.videoId,
        title: it.title || '',
        channel: it.channel || '',
        lang,
        durationSec: typeof it.durationSec === 'number' ? it.durationSec : null,
        addedAt: now + (it.position || 0),
        done: trackedVideoIds.has(it.videoId),
      };
    }
    removeItemIds.push(it.playlistItemId); // imported now, or already imported — clear it from the playlist
  }
  return { toAdd, removeItemIds };
}

// YouTube reports lengths as ISO-8601 durations ("PT1H2M3S"). Returns seconds,
// or null for anything unparseable — a live stream, for instance, reports
// "P0D" and has no meaningful length.
function parseIsoDuration(iso) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(String(iso || ''));
  if (!m) return null;
  const [d, h, min, sec] = m.slice(1).map((v) => (v ? parseFloat(v) : 0));
  const total = Math.round(d * 86400 + h * 3600 + min * 60 + sec);
  return total > 0 ? total : null;
}

// "12:34" / "1:05:03", the way YouTube itself labels a video's length.
function formatDuration(sec) {
  if (!sec || sec < 0) return '';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(rest)}` : `${m}:${pad(rest)}`;
}

if (typeof module !== 'undefined') {
  module.exports = { planYoutubeTodoSync, parseIsoDuration, formatDuration };
}
