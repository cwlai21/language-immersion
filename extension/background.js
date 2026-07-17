// Service worker: accumulates heartbeats into sessions, decides which videos
// count as French or English, and syncs finished sessions to Supabase (with an
// offline retry queue). All state lives in chrome.storage.local because MV3
// workers unload at any time.

importScripts('config.js', 'supabase.js', 'lang-detect.js', 'tmdb.js');
try {
  importScripts('config.local.js'); // git-ignored personal TMDB key — optional
} catch { /* not present in this checkout, fine */ }

const MIN_SESSION_SECONDS = 30;
const IDLE_FINALIZE_MS = 3 * 60 * 1000;
const SHORTS_FLUSH_IDLE_MS = 90 * 1000; // shorts pool flushes sooner
const MAX_OVERRIDES = 100;

const BADGE_COLORS = { fr: '#2b4fd8', en: '#16a34a' };

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('tick', { periodInMinutes: 1 });
  injectIntoOpenTabs();
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('tick', { periodInMinutes: 1 });
  injectIntoOpenTabs(); // session-restored tabs shouldn't wait for the first tick
});

// Heal a tab the moment the user switches to it, instead of making them
// wait out the minute tick (which read as "needs a manual refresh").
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return;
  }
  if (!tab.url) return;
  if (/^https:\/\/(gimytv\.biz|[^/]*\.netflix\.com|[^/]*\.disneyplus\.com)\//.test(tab.url)) {
    healSeriesTab(tabId);
  } else if (tab.url.startsWith('https://www.youtube.com/')) {
    healYouTubeTab(tabId);
  }
});

// Content scripts only auto-inject into pages loaded AFTER the extension —
// a YouTube tab that was already open would stay invisible until a manual
// refresh. Self-heal: ping every YouTube tab and inject wherever nobody
// answers. Runs on install AND on every minute tick, so a tab that missed
// injection (discarded tab, failed install-time inject, …) recovers alone.
const SERIES_SITE_PATTERNS = [
  'https://gimytv.biz/*',
  'https://*.netflix.com/*',
  'https://*.disneyplus.com/*',
];

async function injectIntoOpenTabs() {
  let tabs = [];
  let seriesTabs = [];
  try {
    tabs = await chrome.tabs.query({ url: 'https://www.youtube.com/*' });
    seriesTabs = await chrome.tabs.query({ url: SERIES_SITE_PATTERNS });
  } catch {
    return;
  }
  for (const tab of tabs) {
    await healYouTubeTab(tab.id);
  }
  for (const tab of seriesTabs) {
    await healSeriesTab(tab.id);
  }
}

async function healYouTubeTab(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'ping' });
    return; // scripts alive in this tab
  } catch { /* no receiver — inject below */ }
  try {
    // The unresponsive script left its double-injection guard flag set on
    // `window` (the MAIN world persists across an extension reload, even
    // though the orphaned script's chrome.* calls are now dead). Clear the
    // flags before re-injecting, or the fresh scripts would see the stale
    // flag and silently no-op.
    await chrome.scripting.executeScript({ target: { tabId }, func: () => { delete window.__ecouteContentLoaded; } });
    await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: () => { delete window.__ecouteBridgeLoaded; } });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['page-bridge.js'], world: 'MAIN' });
  } catch { /* tab not injectable (discarded, error page, …) */ }
}

// Frame-granular healing: a top-frame ping can't see that the <video>
// iframe lost its script — Gimy tears the player frame down and recreates
// it after ads, often as about:blank, which manifest URL matching never
// re-injects. Probe every reachable frame for a live script (the flag is
// only visible inside the current extension instance's isolated world, so
// orphans from before a reload correctly probe as dead) and inject exactly
// where it's missing.
// Popup-triggered: it found the tab unresponsive and wants it fixed now.
async function healTab(tabId) {
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return { ok: false };
  }
  if (tab.url && tab.url.startsWith('https://www.youtube.com/')) await healYouTubeTab(tabId);
  else await healSeriesTab(tabId);
  return { ok: true };
}

async function healSeriesTab(tabId) {
  try {
    const probes = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => window.__ecouteSeriesLoaded === true,
    });
    const dead = probes.filter((p) => !p.result).map((p) => p.frameId);
    if (dead.length) {
      await chrome.scripting.executeScript({
        target: { tabId, frameIds: dead },
        files: ['series-detect.js'],
      });
    }
  } catch { /* tab not injectable (discarded, error page, …) */ }
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

// Returns { lang: 'fr'|'en', reason: 'override'|'channel'|'asr'|'title' } or null.
function trackDecision(video, overrides, trackedChannels) {
  const ov = overrides[video.videoId];
  if (ov !== undefined) return ov ? { lang: ov, reason: 'override' } : null;
  const ch = trackedChannels.find((c) => c.id === video.channelId);
  if (ch) return { lang: ch.lang, reason: 'channel' };
  const lang = asrLanguage(video);
  if (lang) return { lang, reason: 'asr' };
  // No ASR yet — e.g. a video too new for YouTube to have auto-captioned.
  // Fall back to a title guess until the periodic re-probe (page-bridge.js)
  // finds real captions and this session's language self-corrects.
  const hint = guessLangFromTitle(video.title);
  if (hint) return { lang: hint, reason: 'title' };
  return null;
}

// The badge is global but heartbeats come from every YouTube tab — paused
// background tabs must not wipe a badge set by the tab that's playing.
async function updateBadge(lang, playing, sender) {
  const tabId = sender && sender.tab ? sender.tab.id : null;
  if (lang && playing) {
    setBadge(lang);
    await chrome.storage.local.set({ badgeOwner: tabId });
    return;
  }
  const { badgeOwner = null } = await chrome.storage.local.get('badgeOwner');
  if (badgeOwner === null || badgeOwner === tabId) setBadge(null);
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
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender)
    .then(sendResponse)
    .catch((e) => sendResponse({ error: String(e) }));
  return true; // async response
});

async function handle(msg, sender) {
  switch (msg.type) {
    case 'heartbeat':   return onHeartbeat(msg, sender);
    case 'left-video':  return finalizeCurrent();
    case 'get-tracking-status': return getTrackingStatus();
    case 'set-override': return setOverride(msg.videoId, msg.value);
    case 'toggle-channel': return toggleChannel(msg.channelId, msg.channel, msg.lang);
    case 'sync-now': return syncPending();
    // Runs in the service worker rather than the popup because the popup
    // (and everything running in it, including in-flight fetches) is
    // killed the instant it loses focus — e.g. clicking over to IMDb to
    // check an episode number mid-lookup. The worker survives that.
    case 'tmdb-lookup': return { info: await tmdbLookupEpisode(msg.name, msg.season, msg.episode) };
    case 'series-heartbeat': return onSeriesHeartbeat(msg, sender);
    case 'set-series-lang': return setSeriesLang(msg.name, msg.lang);
    case 'heal-tab': return healTab(msg.tabId);
    default: return { error: 'unknown message: ' + msg.type };
  }
}

/* ── Session accumulation ────────────────── */
async function onHeartbeat({ video, seconds, playing }, sender) {
  const { currentSession = null, overrides = {}, trackedChannels = [] } =
    await chrome.storage.local.get(['currentSession', 'overrides', 'trackedChannels']);

  // Shorts are seconds long and scrolled through quickly — individual
  // sessions would all die under MIN_SESSION_SECONDS. Pool them instead.
  // NOTE: never touch currentSession here — a paused shorts tab pings
  // periodically and would chop an active regular session into fragments;
  // the idle alarm already finalizes abandoned sessions.
  if (video.isShort) {
    const decision = trackDecision(video, overrides, trackedChannels);
    if (decision && seconds > 0) {
      const { shortsBuffer = {} } = await chrome.storage.local.get('shortsBuffer');
      const day = todayKey();
      if (shortsBuffer.date !== day) {
        await flushShortsBuffer(shortsBuffer); // day rolled over — flush old
        shortsBuffer.date = day;
        shortsBuffer.fr = 0;
        shortsBuffer.en = 0;
        shortsBuffer.titles = { fr: {}, en: {} };
      }
      shortsBuffer[decision.lang] = (shortsBuffer[decision.lang] || 0) + seconds;
      shortsBuffer.titles = shortsBuffer.titles || { fr: {}, en: {} };
      const titles = shortsBuffer.titles[decision.lang];
      if (video.title) titles[video.title] = (titles[video.title] || 0) + seconds;
      shortsBuffer.lastBeat = Date.now();
      await chrome.storage.local.set({ shortsBuffer });
    }
    await updateBadge(decision ? decision.lang : null, playing, sender);
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
  await updateBadge(decision ? decision.lang : null, playing, sender);
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

/* ── Series accumulation (Gimy / Netflix / Disney+) ── */
// Streaming players give no language signal (no ASR-caption trick like
// YouTube), so time only counts once the user has pinned the series to a
// language in the popup — the pin lives in storage.sync keyed by series
// name, so it carries across devices and every later episode is automatic.
// Seconds still accumulate while unpinned: a pin set mid-episode (or any
// time before the idle finalize) rescues the whole sitting.
async function onSeriesHeartbeat({ seconds, playing, meta }, sender) {
  const tabId = sender && sender.tab ? sender.tab.id : null;
  if (tabId === null) return {};

  let { currentSeries = null } = await chrome.storage.local.get('currentSeries');
  const { seriesLangs = {} } = await chrome.storage.sync.get('seriesLangs');

  if (meta && meta.name) {
    const changed = currentSeries &&
      (currentSeries.name !== meta.name || currentSeries.episode !== meta.episode);
    if (changed) {
      await finalizeSeries(currentSeries);
      currentSeries = null;
    }
    if (!currentSeries) {
      currentSeries = {
        tabId,
        site: meta.site,
        name: meta.name,
        season: meta.season,
        episode: meta.episode,
        epTitle: meta.epTitle || '',
        date: todayKey(),
        seconds: 0,
        startedAt: Date.now(),
      };
    } else {
      // Metadata can trickle in after playback starts (Netflix's title bar
      // only exists once the controls have been shown) — keep enriching.
      currentSeries.tabId = tabId;
      if (meta.season != null) currentSeries.season = meta.season;
      if (meta.epTitle) currentSeries.epTitle = meta.epTitle;
    }
  }

  // Seconds arrive from whichever frame owns the <video> (Gimy's player is
  // an iframe), which may not be the frame that sent the metadata — match
  // on tab, not frame.
  if (currentSeries && tabId === currentSeries.tabId && seconds > 0) {
    currentSeries.seconds += seconds;
    currentSeries.lastBeat = Date.now();
  }
  await chrome.storage.local.set({ currentSeries });

  // Unpinned series (undefined — as opposed to false, the user's explicit
  // "don't track"): ask TMDB for the show's original language and pin it
  // automatically when it's one we track. Chinese/Korean/etc. shows stay
  // unpinned so the popup keeps offering the manual choice.
  if (currentSeries && seriesLangs[currentSeries.name] === undefined) {
    const auto = await tmdbShowLanguage(currentSeries.name);
    if (auto === 'fr' || auto === 'en') {
      seriesLangs[currentSeries.name] = auto;
      await chrome.storage.sync.set({ seriesLangs });
    }
  }

  const pin = currentSeries ? seriesLangs[currentSeries.name] : null;
  const lang = pin === 'fr' || pin === 'en' ? pin : null;
  await updateBadge(lang, playing, sender);
  return {
    tracked: !!lang,
    lang,
    name: currentSeries ? currentSeries.name : null,
    sessionSeconds: currentSeries ? currentSeries.seconds : 0,
  };
}

async function finalizeSeries(series) {
  await chrome.storage.local.set({ currentSeries: null });
  if (!series || series.seconds < MIN_SESSION_SECONDS) return;
  const { seriesLangs = {} } = await chrome.storage.sync.get('seriesLangs');
  const lang = seriesLangs[series.name];
  if (lang !== 'fr' && lang !== 'en') return; // unpinned or excluded (false) — dropped
  const row = {
    date: series.date,
    seconds: series.seconds,
    language: lang,
    type: 'series',
    title: series.epTitle || (series.episode ? `第${series.episode}集` : ''),
    channel: series.name,
    video_id: '',
    source: 'auto',
    season: series.season || null,
    episode: series.episode || null,
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

// lang: 'fr' | 'en' pins the series; false excludes it (and blocks the
// TMDB auto-pin from re-applying); null forgets it entirely.
async function setSeriesLang(name, lang) {
  if (!name) return { error: 'no series name' };
  const { seriesLangs = {} } = await chrome.storage.sync.get('seriesLangs');
  if (lang === null) delete seriesLangs[name];
  else seriesLangs[name] = lang;
  await chrome.storage.sync.set({ seriesLangs });
  return { ok: true };
}

// Write the pooled shorts listening as one row per language, then reset.
async function flushShortsBuffer(buffer) {
  const { shortsBuffer = {} } = buffer ? { shortsBuffer: buffer } : await chrome.storage.local.get('shortsBuffer');
  if (!shortsBuffer.date) return;
  for (const lang of ['fr', 'en']) {
    const seconds = shortsBuffer[lang] || 0;
    if (seconds < MIN_SESSION_SECONDS) continue;
    // Name the pooled row after what was actually watched: top titles by time.
    const titles = Object.entries((shortsBuffer.titles || {})[lang] || {})
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name);
    const top = titles.slice(0, 3).map((name) => (name.length > 60 ? name.slice(0, 57) + '…' : name));
    const label = top.length
      ? `Shorts: ${top.join(' · ')}${titles.length > 3 ? ` +${titles.length - 3}` : ''}`
      : 'YouTube Shorts';
    const row = {
      date: shortsBuffer.date,
      seconds,
      language: lang,
      type: 'youtube',
      title: label,
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
  injectIntoOpenTabs(); // self-heal tabs that lost/never got their scripts
  const { currentSession, currentSeries, pendingRows = [], shortsBuffer = {} } =
    await chrome.storage.local.get(['currentSession', 'currentSeries', 'pendingRows', 'shortsBuffer']);

  if (currentSession && Date.now() - (currentSession.lastBeat || 0) > IDLE_FINALIZE_MS) {
    await finalizeSession(currentSession);
    setBadge(null);
  }
  if (currentSeries && Date.now() - (currentSeries.lastBeat || currentSeries.startedAt || 0) > IDLE_FINALIZE_MS) {
    await finalizeSeries(currentSeries);
    setBadge(null);
  }
  // Shorts binge ended (no shorts heartbeat for 90s+) — flush the pool.
  if (shortsBuffer.date && Date.now() - (shortsBuffer.lastBeat || 0) > SHORTS_FLUSH_IDLE_MS) {
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
  const { currentSession = null, currentSeries = null, overrides = {}, trackedChannels = [], pendingRows = [] } =
    await chrome.storage.local.get(['currentSession', 'currentSeries', 'overrides', 'trackedChannels', 'pendingRows']);
  const { seriesLangs = {} } = await chrome.storage.sync.get('seriesLangs');
  return { currentSession, currentSeries, overrides, trackedChannels, seriesLangs, pendingCount: pendingRows.length };
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
