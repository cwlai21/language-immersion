/* Keeps the two checkboxes for the same video in step: the one in "À regarder"
 * (kv_state `video-todo`, keyed by videoId) and the one on the dashboard's
 * session list (kv_state `watch-todo`, keyed by watchKey). Ticking either side
 * ticks the other, so a finished video is confirmed once, not twice.
 *
 * The two lists are keyed differently on purpose — the watchlist knows a video
 * before it has ever been played, the dashboard only knows what was actually
 * watched — so the bridge is a lookup through listening_sessions.video_id
 * rather than a shared id. Loaded as a <script> tag by both pages, after
 * rules.js (for watchKey/sessionWatchKeys) and supabase.js (for sbRequest).
 *
 * Every step tolerates being offline: a failed mirror leaves the other list
 * alone rather than throwing at the click that triggered it. The tick the user
 * actually made is already saved by its own page. */

const WATCHLIST_KV = 'video-todo';
const WATCH_TODO_KV = 'watch-todo';

// Read a kv_state row, apply `mutate`, write it back. Re-reading first means a
// mirror never clobbers a change the other device made meanwhile. `mutate`
// returning null means "nothing to do" and skips the write.
async function kvUpdate(key, mutate) {
  let current = {};
  try {
    const rows = await sbRequest(`kv_state?key=eq.${key}&select=value`);
    if (rows.length) current = JSON.parse(rows[0].value);
  } catch {
    return null; // offline — the other list stays as it was
  }
  const next = mutate(current);
  if (!next) return null;
  try {
    await sbRequest('kv_state?on_conflict=key', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: { key, value: JSON.stringify(next), updated_at: new Date().toISOString() },
    });
  } catch {
    return null;
  }
  return next;
}

// À regarder → dashboard. A video with no sessions yet (ticked off without
// ever playing it here) has nothing to mirror, which is not an error.
async function mirrorWatchlistToSessions(videoId, done) {
  if (!videoId) return;
  let rows = [];
  try {
    rows = await sbRequest(
      'listening_sessions?select=title,channel,type,language,season,episode' +
        `&video_id=eq.${encodeURIComponent(videoId)}`,
    );
  } catch {
    return;
  }
  const keys = sessionWatchKeys(rows);
  if (!keys.length) return;
  await kvUpdate(WATCH_TODO_KV, (state) => {
    const next = { ...state };
    for (const k of keys) next[k] = done ? 'done' : 'todo';
    return next;
  });
}

// Dashboard → À regarder. Takes the video ids of the session group that was
// ticked; ids absent from the watchlist (watched without ever being saved to
// the playlist) are skipped rather than invented as new entries.
async function mirrorSessionsToWatchlist(videoIds, done) {
  const ids = [...new Set((videoIds || []).filter(Boolean))];
  if (!ids.length) return;
  await kvUpdate(WATCHLIST_KV, (todo) => {
    const next = { ...todo };
    let changed = false;
    for (const id of ids) {
      if (next[id] && !!next[id].done !== done) {
        next[id] = { ...next[id], done };
        changed = true;
      }
    }
    return changed ? next : null;
  });
}
