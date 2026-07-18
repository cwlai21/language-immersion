// Isolated-world content script for streaming sites (Gimy, Netflix,
// Disney+): extracts which series/episode is on screen, counts playback
// seconds, and heartbeats them to the background worker. Language can't be
// sniffed from these players (no ASR-caption trick like YouTube), so the
// worker only stores sessions for series the user has pinned to a language
// once in the popup; after that every episode tracks automatically.
//
// Runs in every frame (all_frames): sites like Gimy mount their H5 player
// inside a same-origin iframe, so the <video> element and the metadata DOM
// live in different frames. Each frame counts seconds for the video it
// owns; only the top frame extracts metadata. The worker merges the two
// streams by tab.

(() => {
if (window.__ecouteSeriesLoaded) return; // double-injection guard
window.__ecouteSeriesLoaded = true;

const TICK_SECONDS = 5;
const FLUSH_MS = 15000;
const isTop = window === window.top;

/* ── Per-site metadata extraction (top frame only) ── */

// 第八季 → 8. Gimy writes seasons with Chinese numerals more often than digits.
function chineseNumeral(s) {
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const digits = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const m = s.match(/^(?:(.)?十)?(.)?$/);
  if (!m) return null;
  const tens = s.includes('十') ? (m[1] ? digits[m[1]] : 1) : 0;
  const ones = m[2] ? digits[m[2]] : 0;
  if (tens === undefined || ones === undefined) return null;
  return tens * 10 + ones || null;
}

function gimyMeta() {
  // The history tracker span carries clean data attributes, but its shape
  // varies by domain generation:
  //   gimytv.biz: <span class="mac_history_set2" data-name="百花殺" data-playname="第5集">
  //   gimyai.tw:  <span class="mac_history_set hide" data-name="校園之外">  (no playname)
  const el = document.querySelector('.mac_history_set2, .mac_history_set');
  let name = el && el.dataset.name;
  let playname = el && el.dataset.playname;
  if (!name) {
    // Title fallbacks: gimytv.biz uses 「{name}線上看第{n}集 | Gimy」,
    // gimyai.tw uses 「{name} 第05集 - {線路} - Gimy TV 劇迷」.
    const m = document.title.match(/^(.+?)線上看(第\d+集)?/) || document.title.match(/^(.+?)\s+(第\d+集)/);
    if (!m) return null;
    name = m[1].trim();
    playname = playname || m[2] || '';
  }
  if (!playname) {
    // data-name without playname (gimyai.tw) — the episode only lives in
    // the title.
    const m = document.title.match(/第(\d+)集/);
    if (m) playname = `第${m[1]}集`;
  }
  const seasonM = name.match(/第([〇一二三四五六七八九十\d]+)季/);
  const epM = (playname || '').match(/第(\d+)集/);
  return {
    site: 'gimy',
    name,
    season: seasonM ? chineseNumeral(seasonM[1]) : null,
    episode: epM ? parseInt(epM[1], 10) : null,
    epTitle: '',
  };
}

function netflixMeta() {
  if (!location.pathname.startsWith('/watch')) return null;
  // Player control bar: <div data-uia="video-title"><h4>Show</h4>
  // <span>S8:E5</span><span>Episode Title</span></div>. Only present once
  // the controls have been shown, so heartbeats keep retrying until it is.
  const t = document.querySelector('[data-uia="video-title"]');
  if (!t) return null;
  const h4 = t.querySelector('h4');
  const name = (h4 ? h4.textContent : t.textContent).trim();
  if (!name) return null;
  let season = null;
  let episode = null;
  let epTitle = '';
  for (const span of t.querySelectorAll('span')) {
    const se = span.textContent.match(/^S(\d+)\s*[:：]\s*E(\d+)$/i);
    if (se) {
      season = parseInt(se[1], 10);
      episode = parseInt(se[2], 10);
    } else if (span.textContent.trim()) {
      epTitle = span.textContent.trim();
    }
  }
  return { site: 'netflix', name, season, episode, epTitle };
}

function disneyMeta() {
  if (!/\/(video|play)\//.test(location.pathname)) return null;
  // Disney+ shuffles its player DOM often — try the known title slots, then
  // give up quietly (session just won't track until selectors are tuned).
  const nameEl =
    document.querySelector('[data-testid="playback-title"]') ||
    document.querySelector('.title-field');
  const subEl =
    document.querySelector('[data-testid="playback-subtitle"]') ||
    document.querySelector('.subtitle-field');
  const name = nameEl && nameEl.textContent.trim();
  if (!name) return null;
  let season = null;
  let episode = null;
  let epTitle = '';
  const sub = subEl ? subEl.textContent.trim() : '';
  const se = sub.match(/S(\d+)\s*[:：]?\s*E(\d+)\s*(.*)/i);
  if (se) {
    season = parseInt(se[1], 10);
    episode = parseInt(se[2], 10);
    epTitle = se[3].trim();
  } else if (sub) {
    epTitle = sub;
  }
  return { site: 'disney', name, season, episode, epTitle };
}

function extractMeta() {
  if (!isTop) return null;
  const host = location.hostname;
  try {
    if (host.includes('gimy')) return gimyMeta(); // gimytv.biz, gimyai.tw — the site hops domains
    if (host.includes('netflix')) return netflixMeta();
    if (host.includes('disneyplus')) return disneyMeta();
  } catch { /* site DOM changed — treat as no metadata */ }
  return null;
}

/* ── Playback counting (every frame) ──────── */

function getVideoEl() {
  return document.querySelector('video');
}

function isPlaying() {
  const v = getVideoEl();
  return !!(v && !v.paused && !v.ended && v.currentTime > 0);
}

let pendingSeconds = 0;

setInterval(() => {
  if (isPlaying()) pendingSeconds += TICK_SECONDS;
}, TICK_SECONDS * 1000);

setInterval(flush, FLUSH_MS);

function flush() {
  const seconds = pendingSeconds;
  pendingSeconds = 0;
  const meta = extractMeta();
  // Child frames report seconds; the top frame reports metadata (and its
  // own seconds, in case the video is top-level like on Netflix). Frames
  // with nothing to say stay quiet.
  if (!seconds && !meta && !isPlaying()) return;
  send({ type: 'series-heartbeat', seconds, playing: isPlaying(), meta });
}

function send(msg) {
  try {
    chrome.runtime.sendMessage(msg).catch(() => {});
  } catch {
    // Extension was reloaded and this context is orphaned — nothing to do.
  }
}

/* ── Popup / self-heal queries ────────────── */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'ping') {
    sendResponse({ ok: true });
  }
  // Only the top frame answers the popup, so the metadata frame wins the
  // first-response race that all_frames would otherwise create.
  if (msg.type === 'get-series-status' && isTop) {
    sendResponse({ meta: extractMeta(), playing: isPlaying() });
  }
});
})();
