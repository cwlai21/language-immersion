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
    session.lastBeat = now;
    session.lang = decision.lang;
    session.reason = decision.reason;
  }

  return { session, finalized };
}

if (typeof module !== 'undefined') {
  module.exports = { applyHeartbeat };
}
