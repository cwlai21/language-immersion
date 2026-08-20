// Isolated-world content script: receives video info from page-bridge.js,
// counts playback seconds, and heartbeats them to the background worker,
// which decides whether the video counts as French and stores the session.

(() => {
// Self-heal re-injects this script (see healYouTubeTab) without the page
// reloading. A plain "already loaded?" flag would leave the previous
// instance's timers and listeners running — every stacked copy then sends
// its own heartbeat and finalize, fragmenting one video into many rows and
// duplicating them. Instead, tear the previous instance down and take over,
// so exactly one copy is ever live.
if (typeof window.__ecouteContentTeardown === 'function') window.__ecouteContentTeardown();

let current = null; // { videoId, title, channel, channelId, asrLang, captionLangs }
let pendingSeconds = 0;

const TICK_SECONDS = 5;
const FLUSH_MS = 15000;

function onVideoInfo(e) {
  flush(); // attribute any buffered seconds to the previous video first
  try {
    current = JSON.parse(e.detail);
  } catch {
    current = null;
  }
  flush(); // announce the new video right away so the badge/popup update
}

function onNavigate() {
  if (!location.pathname.startsWith('/watch') && !location.pathname.startsWith('/shorts/')) {
    flush();
    current = null;
    send({ type: 'left-video' });
  }
}

function getVideoEl() {
  // Shorts pages keep preloaded prev/next <video> elements in the DOM, so
  // a bare querySelector often lands on a paused preload and playback
  // never counts — scope to the active shorts player first.
  if (location.pathname.startsWith('/shorts/')) {
    const v = document.querySelector('#shorts-player video');
    if (v) return v;
  }
  return document.querySelector('video.html5-main-video') || document.querySelector('video');
}

function isPlaying() {
  const v = getVideoEl();
  return !!(v && !v.paused && !v.ended && v.currentTime > 0);
}

function count() {
  if (current && isPlaying()) pendingSeconds += TICK_SECONDS;
}

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

// The popup asks the tab what's on screen right now; the worker pings to
// check the scripts are alive (self-healing injection).
function onMessage(msg, _sender, sendResponse) {
  if (msg.type === 'ping') {
    sendResponse({ ok: true });
  }
  if (msg.type === 'get-page-status') {
    sendResponse({ video: current, playing: isPlaying() });
  }
}

window.addEventListener('ecoute-videoinfo', onVideoInfo);
window.addEventListener('yt-navigate-finish', onNavigate);
chrome.runtime.onMessage.addListener(onMessage);
const countTimer = setInterval(count, TICK_SECONDS * 1000);
const flushTimer = setInterval(flush, FLUSH_MS);

window.__ecouteContentTeardown = () => {
  clearInterval(countTimer);
  clearInterval(flushTimer);
  window.removeEventListener('ecoute-videoinfo', onVideoInfo);
  window.removeEventListener('yt-navigate-finish', onNavigate);
  try { chrome.runtime.onMessage.removeListener(onMessage); } catch { /* orphaned context */ }
};
})();
