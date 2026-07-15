// Service worker: accumulates heartbeats into sessions, decides which videos
// count as French or English, and syncs finished sessions to Supabase (with an
// offline retry queue). All state lives in chrome.storage.local because MV3
// workers unload at any time.

importScripts('config.js', 'supabase.js');

const MIN_SESSION_SECONDS = 30;
const IDLE_FINALIZE_MS = 3 * 60 * 1000;
const MAX_OVERRIDES = 100;

const BADGE_COLORS = { fr: '#2b4fd8', en: '#16a34a' };

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('tick', { periodInMinutes: 1 });
  injectIntoOpenTabs();
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('tick', { periodInMinutes: 1 });
});

// Content scripts only auto-inject into pages loaded AFTER the extension —
// a YouTube tab that was already open would stay invisible until a manual
// refresh. Inject into existing tabs on install/update instead.
async function injectIntoOpenTabs() {
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: 'https://www.youtube.com/*' });
  } catch {
    return;
  }
  for (const tab of tabs) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['page-bridge.js'], world: 'MAIN' });
    } catch { /* tab not injectable (discarded, error page, …) */ }
  }
}

/* ── Helpers ─────────────────────────────── */
// The tracker's day starts at 4am (like Anki's rollover), so late-night
// sessions count toward the previous evening's day.
const ROLLOVER_HOUR = 4;
const pad = (n) => String(n).padStart(2, '0');
function todayKey() {
  const d = new Date(Date.now() - ROLLOVER_HOUR * 3600 * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function asrLanguage(video) {
  const asr = (video.asrLang || '').toLowerCase();
  if (asr.startsWith('fr')) return 'fr';
  if (asr.startsWith('en')) return 'en';
  return null;
}

// Returns { lang: 'fr'|'en', reason: 'override'|'channel'|'asr' } or null.
function trackDecision(video, overrides, trackedChannels) {
  const ov = overrides[video.videoId];
  if (ov !== undefined) return ov ? { lang: ov, reason: 'override' } : null;
  const ch = trackedChannels.find((c) => c.id === video.channelId);
  if (ch) return { lang: ch.lang, reason: 'channel' };
  const lang = asrLanguage(video);
  if (lang) return { lang, reason: 'asr' };
  return null;
}

function setBadge(lang) {
  if (lang) {
    chrome.action.setBadgeText({ text: lang.toUpperCase() });
    chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS[lang] || '#2b4fd8' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

/* ── Message routing ─────────────────────── */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handle(msg)
    .then(sendResponse)
    .catch((e) => sendResponse({ error: String(e) }));
  return true; // async response
});

async function handle(msg) {
  switch (msg.type) {
    case 'heartbeat':   return onHeartbeat(msg);
    case 'left-video':  return finalizeCurrent();
    case 'get-tracking-status': return getTrackingStatus();
    case 'set-override': return setOverride(msg.videoId, msg.value);
    case 'toggle-channel': return toggleChannel(msg.channelId, msg.channel, msg.lang);
    case 'sync-now': return syncPending();
    default: return { error: 'unknown message: ' + msg.type };
  }
}

/* ── Session accumulation ────────────────── */
async function onHeartbeat({ video, seconds, playing }) {
  const { currentSession = null, overrides = {}, trackedChannels = [] } =
    await chrome.storage.local.get(['currentSession', 'overrides', 'trackedChannels']);

  // Shorts are seconds long and scrolled through quickly — individual
  // sessions would all die under MIN_SESSION_SECONDS. Pool them instead.
  if (video.isShort) {
    if (currentSession) await finalizeSession(currentSession);
    const decision = trackDecision(video, overrides, trackedChannels);
    if (decision && seconds > 0) {
      const { shortsBuffer = {} } = await chrome.storage.local.get('shortsBuffer');
      const day = todayKey();
      if (shortsBuffer.date !== day) {
        await flushShortsBuffer(shortsBuffer); // day rolled over — flush old
        shortsBuffer.date = day;
        shortsBuffer.fr = 0;
        shortsBuffer.en = 0;
      }
      shortsBuffer[decision.lang] = (shortsBuffer[decision.lang] || 0) + seconds;
      shortsBuffer.lastBeat = Date.now();
      await chrome.storage.local.set({ shortsBuffer });
    }
    setBadge(decision && playing ? decision.lang : null);
    return {
      tracked: !!decision,
      lang: decision ? decision.lang : null,
      reason: decision ? decision.reason : null,
      sessionSeconds: 0,
    };
  }

  let session = currentSession;
  if (session && session.videoId !== video.videoId) {
    await finalizeSession(session);
    session = null;
  }

  const decision = trackDecision(video, overrides, trackedChannels);
  if (decision) {
    if (!session) {
      session = {
        videoId: video.videoId,
        title: video.title,
        channel: video.channel,
        channelId: video.channelId,
        date: todayKey(),
        seconds: 0,
        startedAt: Date.now(),
      };
    }
    session.seconds += seconds;
    session.lastBeat = Date.now();
    session.lang = decision.lang;
    session.reason = decision.reason;
  }

  await chrome.storage.local.set({ currentSession: session });
  setBadge(decision && playing ? decision.lang : null);
  return {
    tracked: !!decision,
    lang: decision ? decision.lang : null,
    reason: decision ? decision.reason : null,
    sessionSeconds: session ? session.seconds : 0,
  };
}

async function finalizeCurrent() {
  const { currentSession } = await chrome.storage.local.get('currentSession');
  if (currentSession) await finalizeSession(currentSession);
  await chrome.storage.local.set({ currentSession: null });
  setBadge(null);
  return { ok: true };
}

// Write the pooled shorts listening as one row per language, then reset.
async function flushShortsBuffer(buffer) {
  const { shortsBuffer = {} } = buffer ? { shortsBuffer: buffer } : await chrome.storage.local.get('shortsBuffer');
  if (!shortsBuffer.date) return;
  for (const lang of ['fr', 'en']) {
    const seconds = shortsBuffer[lang] || 0;
    if (seconds < MIN_SESSION_SECONDS) continue;
    const row = {
      date: shortsBuffer.date,
      seconds,
      language: lang,
      type: 'youtube',
      title: 'YouTube Shorts',
      channel: 'Shorts',
      video_id: '',
      source: 'auto',
    };
    try {
      await sb.insertSession(row);
    } catch (e) {
      console.warn('Supabase insert failed, queuing:', e);
      const { pendingRows = [] } = await chrome.storage.local.get('pendingRows');
      pendingRows.push(row);
      await chrome.storage.local.set({ pendingRows });
    }
  }
  await chrome.storage.local.set({ shortsBuffer: {} });
}

async function finalizeSession(session) {
  await chrome.storage.local.set({ currentSession: null });
  if (!session || session.seconds < MIN_SESSION_SECONDS) return;
  const row = {
    date: session.date,
    seconds: session.seconds,
    language: session.lang || 'fr',
    type: 'youtube',
    title: session.title,
    channel: session.channel,
    video_id: session.videoId,
    source: 'auto',
  };
  try {
    await sb.insertSession(row);
  } catch (e) {
    console.warn('Supabase insert failed, queuing:', e);
    const { pendingRows = [] } = await chrome.storage.local.get('pendingRows');
    pendingRows.push(row);
    await chrome.storage.local.set({ pendingRows });
  }
}

/* ── Idle finalization + retry queue ─────── */
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'tick') return;
  const { currentSession, pendingRows = [], shortsBuffer = {} } =
    await chrome.storage.local.get(['currentSession', 'pendingRows', 'shortsBuffer']);

  if (currentSession && Date.now() - (currentSession.lastBeat || 0) > IDLE_FINALIZE_MS) {
    await finalizeSession(currentSession);
    setBadge(null);
  }
  // Shorts binge ended (no shorts heartbeat for 3+ min) — flush the pool.
  if (shortsBuffer.date && Date.now() - (shortsBuffer.lastBeat || 0) > IDLE_FINALIZE_MS) {
    await flushShortsBuffer(shortsBuffer);
  }
  if (pendingRows.length) await syncPending();
});

async function syncPending() {
  const { pendingRows = [] } = await chrome.storage.local.get('pendingRows');
  const remaining = [];
  for (const row of pendingRows) {
    try {
      await sb.insertSession(row);
    } catch {
      remaining.push(row);
    }
  }
  await chrome.storage.local.set({ pendingRows: remaining });
  return { synced: pendingRows.length - remaining.length, pending: remaining.length };
}

/* ── Popup queries & settings ────────────── */
async function getTrackingStatus() {
  const { currentSession = null, overrides = {}, trackedChannels = [], pendingRows = [] } =
    await chrome.storage.local.get(['currentSession', 'overrides', 'trackedChannels', 'pendingRows']);
  return { currentSession, overrides, trackedChannels, pendingCount: pendingRows.length };
}

// value: 'fr' | 'en' (track as that language) | false (never track)
async function setOverride(videoId, value) {
  const { overrides = {}, currentSession = null } =
    await chrome.storage.local.get(['overrides', 'currentSession']);

  overrides[videoId] = value;
  const keys = Object.keys(overrides);
  if (keys.length > MAX_OVERRIDES) delete overrides[keys[0]];

  // Turning tracking off mid-session discards what was accumulated.
  if (!value && currentSession && currentSession.videoId === videoId) {
    await chrome.storage.local.set({ currentSession: null });
    setBadge(null);
  }
  await chrome.storage.local.set({ overrides });
  return { ok: true };
}

async function toggleChannel(channelId, channel, lang) {
  if (!channelId) return { error: 'no channel id' };
  const { trackedChannels = [] } = await chrome.storage.local.get('trackedChannels');
  const idx = trackedChannels.findIndex((c) => c.id === channelId);
  if (idx >= 0) trackedChannels.splice(idx, 1);
  else trackedChannels.push({ id: channelId, name: channel, lang: lang || 'fr' });
  await chrome.storage.local.set({ trackedChannels });
  return { trackedChannels };
}
