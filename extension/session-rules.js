// Pure decision logic for the YouTube watch session, shared by background.js
// (importScripts) and its Node test suite (test/session-rules.test.js via
// require()). Dependency-free like series-rules.js — no chrome.*, no storage,
// no side effects; the caller owns finalising and persisting.

// Apply one heartbeat to the current watch session. `heartbeat` carries the
// video, the seconds since the last beat, whether it's playing, and the
// tracking `decision` (trackDecision's result, or null = don't track).
// Returns one of:
//   { ignored: true }        — leave everything as-is. A heartbeat for a
//                              *different* video that isn't playing is a
//                              paused/background tab (a second YouTube tab
//                              sitting open still beats ~once a minute); letting
//                              it finalise the active video would chop one watch
//                              into a row per minute.
//   { session, finalized }   — `session` is the next current session to store
//                              (or null), `finalized` is a session that should
//                              be finalised first (or null). Never mutates the
//                              input session.
function applyHeartbeat(currentSession, heartbeat, now, date) {
  const { video, seconds, playing, decision } = heartbeat;
  let session = currentSession;
  let finalized = null;

  if (session && session.videoId !== video.videoId) {
    if (!playing) return { ignored: true };
    finalized = session; // a different video is really playing — hand over
    session = null;
  }

  if (decision) {
    session = session
      ? { ...session }
      : {
          videoId: video.videoId,
          title: video.title,
          channel: video.channel,
          channelId: video.channelId,
          date,
          seconds: 0,
          startedAt: now,
        };
    session.seconds += seconds;
    // lastBeat marks the last *counted* second, not the last heartbeat: a
    // paused tab left open on /watch keeps flushing every 15s with seconds: 0,
    // and refreshing lastBeat on those meant IDLE_FINALIZE_MS could never
    // elapse — the session sat in storage, invisible to the dashboard, until
    // the user navigated away. Same rule as applySeriesHeartbeat.
    if (seconds > 0) session.lastBeat = now;
    session.lang = decision.lang;
    session.reason = decision.reason;
  }

  return { session, finalized };
}

// Returns a runner that executes async tasks strictly one at a time, in call
// order. The worker's handlers each read state from storage, await (an
// insert, a TMDB lookup), then write it back — two of them interleaving at
// those awaits both read the same currentSession before either cleared it,
// and inserted the same row twice, milliseconds apart. A task that throws
// rejects its own caller but doesn't stall the ones queued behind it.
function serialize() {
  let tail = Promise.resolve();
  return (task) => {
    const result = tail.then(task);
    tail = result.catch(() => {});
    return result;
  };
}

// The ids of rows that are copies of an earlier row, for the weekly sweep to
// delete. A copy matches its original on every field and was saved less than
// half its own length later — the same listening can't have happened twice in
// that time. Half, not the full length: the old one-row-per-minute fragments
// are identical 60s rows saved 51–60s apart, and each is a real minute. The
// earliest row of a group is always the one kept.
const SESSION_FIELDS = ['date', 'seconds', 'language', 'type', 'title', 'channel', 'video_id', 'source', 'season', 'episode'];

function findDuplicateSessions(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = JSON.stringify(SESSION_FIELDS.map((f) => r[f] ?? null));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const dupes = [];
  for (const group of groups.values()) {
    group.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    let kept = group[0];
    for (const r of group.slice(1)) {
      const gapSeconds = (Date.parse(r.created_at) - Date.parse(kept.created_at)) / 1000;
      if (gapSeconds < r.seconds / 2) dupes.push(r.id);
      else kept = r;
    }
  }
  return dupes;
}

if (typeof module !== 'undefined') {
  module.exports = { applyHeartbeat, serialize, findDuplicateSessions };
}
