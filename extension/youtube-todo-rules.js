// Pure planning logic for the YouTube-playlist → "À regarder" todo sync,
// shared by background.js (importScripts) and its Node test suite
// (test/youtube-todo-rules.test.js via require()). Dependency-free — no
// chrome.*, no network; the caller owns fetching, storing, and deleting.

// Decide what to do with the videos currently in the playlist:
//   - already watched (videoId in `trackedVideoIds`) → leave it alone.
//   - not watched, not yet imported → import it (add to the todo) AND remove
//     it from the playlist.
//   - not watched but already in the todo (a previous removal didn't land) →
//     don't re-import, just remove it from the playlist again.
// `items` are { videoId, title, channel, playlistItemId } from the YouTube API.
// Returns { toAdd: { [videoId]: entry }, removeItemIds: [playlistItemId] } and
// never mutates its inputs.
function planYoutubeTodoSync(items, trackedVideoIds, currentTodo, lang = 'fr', now = Date.now()) {
  const toAdd = {};
  const removeItemIds = [];
  for (const it of items) {
    if (!it || !it.videoId) continue;
    if (trackedVideoIds.has(it.videoId)) continue; // already watched — leave in the playlist
    if (!currentTodo[it.videoId] && !toAdd[it.videoId]) {
      toAdd[it.videoId] = {
        videoId: it.videoId,
        title: it.title || '',
        channel: it.channel || '',
        lang,
        addedAt: now,
        done: false,
      };
    }
    removeItemIds.push(it.playlistItemId); // imported now, or already imported — clear it from the playlist
  }
  return { toAdd, removeItemIds };
}

if (typeof module !== 'undefined') {
  module.exports = { planYoutubeTodoSync };
}
