// Isolated-world content script: receives video info from page-bridge.js,
// counts playback seconds, and heartbeats them to the background worker,
// which decides whether the video counts as French and stores the session.

(() => {
if (window.__ecouteContentLoaded) return; // double-injection guard
window.__ecouteContentLoaded = true;

let current = null; // { videoId, title, channel, channelId, asrLang, captionLangs }
let pendingSeconds = 0;

const TICK_SECONDS = 5;
const FLUSH_MS = 15000;

window.addEventListener('ecoute-videoinfo', (e) => {
  flush(); // attribute any buffered seconds to the previous video first
  try {
    current = JSON.parse(e.detail);
  } catch {
    current = null;
  }
  flush(); // announce the new video right away so the badge/popup update
});

window.addEventListener('yt-navigate-finish', () => {
  if (!location.pathname.startsWith('/watch')) {
    flush();
    current = null;
    send({ type: 'left-video' });
  }
});

function getVideoEl() {
  return document.querySelector('video.html5-main-video') || document.querySelector('video');
}

function isPlaying() {
  const v = getVideoEl();
  return !!(v && !v.paused && !v.ended && v.currentTime > 0);
}

setInterval(() => {
  if (current && isPlaying()) pendingSeconds += TICK_SECONDS;
}, TICK_SECONDS * 1000);

setInterval(flush, FLUSH_MS);

function flush() {
  if (!current) return;
  const seconds = pendingSeconds;
  pendingSeconds = 0;
  send({ type: 'heartbeat', video: current, seconds, playing: isPlaying() });
}

function send(msg) {
  try {
    chrome.runtime.sendMessage(msg).catch(() => {});
  } catch {
    // Extension was reloaded and this context is orphaned — nothing to do.
  }
}

// The popup asks the tab what's on screen right now.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'get-page-status') {
    sendResponse({ video: current, playing: isPlaying() });
  }
});
})();
